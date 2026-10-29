// Read-only account metadata. Never refresh OAuth, submit prompts, or return
// credentials, account IDs, headers, endpoint URLs, or raw exception messages.
import { hostFetch } from './host-fetch.mjs'

const unknown = () => ({ state: 'unknown', source: 'unknown', models: [] })
const denied = (denialReason) => ({
  state: 'denied',
  source: 'unknown',
  models: [],
  ...(denialReason ? { denialReason } : {}),
})
const validId = (id) => typeof id === 'string' && !!id && id.length <= 1024 && !/[\s\x00-\x1f]/.test(id)
const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
const unavailable = (model) =>
  model.supported_in_api === false ||
  model.allowed === false ||
  model.available === false ||
  model.entitled === false ||
  model.enabled === false ||
  model.disabled === true ||
  model.upgrade_required === true ||
  model.visibility === 'hidden' ||
  model.visibility === 'hide' ||
  model.visibility === 'none'
const numericRate = (value) =>
  typeof value === 'number'
    ? value
    : typeof value === 'string' &&
        value.trim() &&
        /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())
      ? Number(value)
      : NaN
const costFor = (model, oauth) => {
  if (oauth) return 'unknown'
  const rates = model.pricing
  if (object(rates)) {
    const input = numericRate(Object.hasOwn(rates, 'input') ? rates.input : rates.prompt),
      output = numericRate(Object.hasOwn(rates, 'output') ? rates.output : rates.completion)
    if (Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0) {
      const additional = Object.entries(rates)
        .filter(([key]) => !['input', 'output', 'prompt', 'completion', 'free'].includes(key))
        .map(([, value]) => numericRate(value))
      if (input > 0 || output > 0 || additional.some((value) => value > 0)) return 'paid'
      if (additional.some((value) => !Number.isFinite(value) || value < 0)) return 'unknown'
      return 'free'
    }
    // Explicit invalid rates cannot be overridden by a contradictory free flag.
    if ('input' in rates || 'prompt' in rates || 'output' in rates || 'completion' in rates) return 'unknown'
  }
  return model.free === true || model.is_free === true || model.pricing?.free === true ? 'free' : 'unknown'
}
function entries(payload) {
  if (Array.isArray(payload)) return payload
  if (!object(payload)) return undefined
  return Array.isArray(payload.models)
    ? payload.models
    : Array.isArray(payload.data)
      ? payload.data
      : undefined
}
function normalize(payload, oauth, token) {
  const list = entries(payload)
  if (!list) return undefined
  const result = new Map()
  for (const model of list) {
    // Availability NUX is informational text, not an account denial.
    if (!object(model) || unavailable(model)) continue
    const id = model.slug ?? model.id
    if (
      !validId(id) ||
      id === token ||
      (token.length >= 12 && id.includes(token)) ||
      (oauth && model.supported_in_api !== true)
    )
      continue
    const name = model.display_name ?? model.name
    const reasoningEfforts =
      oauth && Array.isArray(model.supported_reasoning_levels)
        ? [...new Set(model.supported_reasoning_levels.flatMap((level) =>
            object(level) && typeof level.effort === 'string' && /^[a-z]+$/.test(level.effort)
              ? [level.effort]
              : [],
          ))]
        : []
    result.set(id, {
      id,
      ...(typeof name === 'string' &&
      name.trim() &&
      name.length <= 4096 &&
      name !== token &&
      !(token.length >= 12 && name.includes(token))
        ? { name }
        : {}),
      cost: costFor(model, oauth),
      ...(reasoningEfforts.length ? { reasoningEfforts } : {}),
    })
  }
  return [...result.values()]
}
function metadataBase(input, codex) {
  const url = new URL(codex ? 'https://chatgpt.com/backend-api' : input.baseUrl)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Unsafe metadata endpoint')
  const base = url.toString().replace(/\/+$/, '')
  return input.apiType === 'anthropic-messages' && !/\/v1$/.test(url.pathname.replace(/\/+$/, ''))
    ? `${base}/v1`
    : base
}
async function readResponse(response) {
  if (!response.body) return undefined
  const reader = response.body.getReader()
  let length = 0
  const chunks = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > 2 * 1024 * 1024) {
        await reader.cancel()
        return undefined
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } finally {
    reader.releaseLock()
  }
}
/** Exact current-account model scope, or a narrowly declared API fallback. */
export async function probeAccountModels(input, options = {}) {
  const credential = input.credential
  if (!credential || !['api', 'oauth'].includes(credential.type)) return unknown()
  const oauth = credential.type === 'oauth'
  const token = oauth ? credential.access : credential.key
  if (typeof token !== 'string' || !token.trim() || token.trimStart().startsWith('!')) return unknown()
  // Near-expiry credentials cannot reliably finish the query. Do not renew them.
  if (oauth && (typeof credential.expires !== 'number' || credential.expires <= Date.now() + 30000))
    return denied('authentication')
  const codex = oauth && ['openai', 'openai-codex'].includes(input.provider)
  if (
    input.codexClientVersion !== undefined &&
    (typeof input.codexClientVersion !== 'string' || input.codexClientVersion.length > 64 ||
      !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(input.codexClientVersion))
  )
    return unknown()
  // Other native client integrations retain their existing compatibility query.
  // discoverCodexModels always requires and supplies its own handshake version.
  const codexVersion = input.codexClientVersion ?? '0.144.1'
  // xAI/other subscription catalogs do not expose a verified per-account scope
  // contract here. Do not turn an OAuth login into their whole public catalog.
  if (oauth && !codex) return unknown()
  const parent = options.signal
  if (parent?.aborted) return unknown()
  const controller = new AbortController()
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal
  const timer = setTimeout(() => controller.abort(), Math.max(50, Math.min(options.timeoutMs ?? 8000, 10000)))
  try {
    if (codex && input.baseUrl && input.baseUrl.replace(/\/+$/, '') !== 'https://chatgpt.com/backend-api')
      return unknown()
    const base = metadataBase(input, codex)
    const headers = { accept: 'application/json', Authorization: `Bearer ${token}` }
    if (input.apiType === 'anthropic-messages' && !oauth) {
      // ZCode's native Anthropic factory sends both headers. Other callers keep
      // the ordinary x-api-key contract unless they explicitly mirror that route.
      if (!['api-key-and-bearer', 'bearer'].includes(input.anthropicAuth)) delete headers.Authorization
      if (input.anthropicAuth !== 'bearer') headers['x-api-key'] = token
      headers['anthropic-version'] = '2023-06-01'
    }
    if (codex) {
      let accountId = credential.accountId
      if (!accountId) {
        try {
          accountId = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'))?.[
            'https://api.openai.com/auth'
          ]?.chatgpt_account_id
        } catch {}
      }
      if (typeof accountId === 'string' && accountId) headers['chatgpt-account-id'] = accountId
      headers['OpenAI-Beta'] = 'responses=experimental'
      headers.originator = input.codexClientVersion ? 'cli_worker_models' : 'pi'
      headers.version = codexVersion
    }
    const fetcher = options.fetch ?? hostFetch
    const request = async (path) => {
      const target = `${base}${path}${codex && path !== '/wham/usage' ? `?client_version=${encodeURIComponent(codexVersion)}` : ''}`
      const response = await fetcher(target, { method: 'GET', headers, signal, redirect: 'error' })
      if (!response.ok) {
        await response.body?.cancel()
        return { status: response.status, payload: undefined }
      }
      return { status: response.status, payload: await readResponse(response) }
    }
    let modelResponse
    for (const path of codex
      ? ['/codex/models', '/models']
      : [
          input.provider === 'openrouter' || new URL(base).hostname === 'openrouter.ai'
            ? '/models/user'
            : '/models',
        ]) {
      modelResponse = await request(path)
      if (modelResponse.status === 401 || modelResponse.status === 403) return denied('authentication')
      if (modelResponse.status >= 200 && modelResponse.status < 300) break
      if (![404, 405].includes(modelResponse.status)) return unknown()
    }
    if (modelResponse?.status >= 200 && modelResponse.status < 300) {
      const envelope = modelResponse.payload
      if (envelope?.allowed === false || envelope?.authenticated === false) return denied()
      if (envelope?.success === false || envelope?.error) {
        const code = envelope?.error?.code
        return ['invalid_api_key', 'authentication_failed', 'unauthorized', 'forbidden', 401, 403].includes(
          code,
        )
          ? denied('authentication')
          : unknown()
      }
      const models = normalize(envelope, oauth, token)
      if (models === undefined) return unknown()
      if (codex) {
        const usage = await request('/wham/usage')
        const rate = usage.payload?.rate_limit
        if (usage.status === 401 || usage.status === 403) return denied('authentication')
        // Only the authenticated usage response establishes exhausted quota.
        // Keep an unclassified denial distinct from expiry/401/403 and network failure.
        if (usage.status === 200 && rate?.limit_reached === true) return denied('quota')
        if (rate?.allowed === false || rate?.limit_reached === true) return denied()
        // A catalog/menu is not evidence that the account has an executable quota.
        if (usage.status !== 200 || rate?.allowed !== true || rate?.limit_reached !== false) return unknown()
        const plan =
          typeof usage.payload?.plan_type === 'string'
            ? usage.payload.plan_type
                .trim()
                .toLowerCase()
                .replace(/^chatgpt_/, '')
            : ''
        const cost =
          plan === 'free'
            ? 'free'
            : ['plus', 'pro', 'team', 'business', 'enterprise', 'edu', 'pro_lite', 'prolite'].includes(plan)
              ? 'paid'
              : 'unknown'
        for (const model of models) model.cost = cost
      }
      if (
        !oauth &&
        ([
          'zai-coding-cn',
          'cliworker-zai-cn',
          'zhipu-coding-plan',
          'zhipuai-coding-plan',
          'kimi-coding',
        ].includes(input.provider) ||
          /open\.bigmodel\.cn\/api\/coding\//.test(base))
      ) {
        for (const model of models) if (model.cost === 'free') model.cost = 'unknown'
      }
      return {
        state: 'supported',
        source: 'account-models',
        models,
        ...(!codex && entries(envelope)?.length === 0 ? { catalogEmpty: true } : {}),
      }
    }
    if (!oauth && [404, 405].includes(modelResponse?.status)) {
      // Declaring a custom model is not an account entitlement proof.
      const verified = [...new Set(input.verifiedModelIds ?? [])].filter(
        (id) => validId(id) && id !== token && !(token.length >= 12 && id.includes(token)),
      )
      if (verified.length)
        return {
          state: 'supported',
          source: 'verified-route',
          models: verified.map((id) => ({ id, cost: 'unknown' })),
        }
    }
    return {
      ...unknown(),
      ...([404, 405].includes(modelResponse?.status) ? { catalogUnavailable: true } : {}),
    }
  } catch {
    return unknown()
  } finally {
    clearTimeout(timer)
  }
}
