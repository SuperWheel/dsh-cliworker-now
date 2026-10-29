import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { readKimiOwnToken } from './kimi-accounts.ts'
import { hostFetch } from './host-fetch.mjs'
import type { FirstPartyModelSource } from './first-party-models.ts'
import type { AccountModelScope, probeAccountModels } from './account-models.mjs'

const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
const BASES = new Set(['https://api.kimi.com/coding/v1', 'https://api.kimi.ai/coding/v1'])
const PROVIDER = 'managed:kimi-code'
const nearExpiry = (expires: unknown, now: number): boolean =>
  typeof expires !== 'number' || !Number.isFinite(expires) || expires <= now + 30_000

export class KimiOAuthModelError extends Error {
  readonly code = 'KIMI_OAUTH_UNAVAILABLE'
  constructor(message: string) {
    super(message)
    this.name = 'KimiOAuthModelError'
  }
}
const unavailable = () => new KimiOAuthModelError('Kimi OAuth 配置来源暂无法核验，请检查该 CLI 配置')
const expired = () =>
  new KimiOAuthModelError('Kimi 登录凭据已过期或即将过期，请打开账号终端完成原生续期或重新登录')

/** JWT fields label the stable account only. The server must independently accept this token. */
function ownPrincipal(access: string): string | undefined {
  const parts = access.split('.')
  if (
    parts.length !== 3 ||
    parts[1]!.length > 16 * 1024 ||
    !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))
  )
    return
  const bytes = Buffer.from(parts[1]!, 'base64url')
  try {
    if (bytes.toString('base64url') !== parts[1]) return
    const claims: unknown = JSON.parse(bytes.toString('utf8'))
    if (!record(claims) || claims.iss !== 'kimi-auth') return
    const subject = claims.sub ?? claims.user_id
    if (typeof subject !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{6,127}$/.test(subject)) return
    if (claims.sub !== undefined && claims.user_id !== undefined && claims.sub !== claims.user_id) return
    return subject
  } catch {
    return
  } finally {
    bytes.fill(0)
  }
}

/** This is host-only credential material. Do not return it through Gateway or persist it. */
export async function readKimiOAuthModelSources(
  raw: unknown,
  sourceId: string,
  signal: AbortSignal,
  options: { home?: string; now?: number } = {},
): Promise<FirstPartyModelSource[]> {
  signal.throwIfAborted()
  if (!record(raw) || !record(raw.providers) || !record(raw.models)) return []
  const provider = raw.providers[PROVIDER]
  if (!record(provider) || provider.oauth === undefined) return []
  const baseUrl = typeof provider.baseUrl === 'string' ? provider.baseUrl.replace(/\/+$/, '') : ''
  if (
    provider.type !== 'kimi' ||
    !BASES.has(baseUrl) ||
    !record(provider.oauth) ||
    provider.oauth.storage !== 'file' ||
    !['oauth/kimi-code', 'kimi-code'].includes(provider.oauth.key) ||
    (provider.oauth.oauthHost !== undefined && provider.oauth.oauthHost !== 'https://auth.kimi.com') ||
    provider.apiKey ||
    provider.apiKeyEnv ||
    provider.env ||
    provider.customHeaders ||
    ['KIMI_CODE_BASE_URL', 'KIMI_CODE_OAUTH_HOST', 'KIMI_OAUTH_HOST', 'KIMI_CODE_CUSTOM_HEADERS'].some(
      (key) => process.env[key],
    )
  )
    throw unavailable()
  const home = options.home ?? process.env.KIMI_CODE_HOME ?? join(homedir(), '.kimi-code')
  if (!isAbsolute(home)) throw unavailable()
  let token: Record<string, any> | undefined
  try {
    token = await readKimiOwnToken(join(home, 'credentials'), 'kimi-code', signal)
  } catch {
    signal.throwIfAborted()
    throw unavailable()
  }
  if (!token || typeof token.access_token !== 'string' || !token.access_token.trim())
    throw new KimiOAuthModelError('Kimi OAuth 尚未登录或已退出，请打开账号终端登录')
  const expires = typeof token.expires_at === 'number' ? token.expires_at * 1000 : undefined
  if (nearExpiry(expires, options.now ?? Date.now())) throw expired()
  const accountId = ownPrincipal(token.access_token)
  if (!accountId || (token.token_type !== undefined && String(token.token_type).toLowerCase() !== 'bearer'))
    throw unavailable()
  const nativeModels: FirstPartyModelSource['nativeModels'] = []
  for (const [alias, model] of Object.entries(raw.models)) {
    if (
      !record(model) ||
      model.provider !== PROVIDER ||
      !id(model.model) ||
      alias !== `kimi-code/${model.model}`
    )
      continue
    if (model.oauth || model.providerId || model.apiKey || model.baseUrl || model.customHeaders) continue
    if (
      model.protocol !== undefined &&
      !['kimi', 'openai', 'openai_responses', 'anthropic'].includes(model.protocol)
    )
      continue
    nativeModels.push({
      remoteId: model.model,
      choice: {
        id: alias,
        label: typeof model.displayName === 'string' ? model.displayName : alias,
        efforts: ['default'],
      },
    })
  }
  signal.throwIfAborted()
  return nativeModels.length
    ? [
        {
          provider: PROVIDER,
          credential: { type: 'oauth', access: token.access_token, expires, accountId },
          baseUrl,
          apiType: 'kimi-managed-oauth',
          sourceIds: [sourceId, join(home, 'credentials/kimi-code.json'), 'native:kimi-managed-oauth'],
          nativeModels,
        },
      ]
    : []
}

async function responseJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new KimiOAuthModelError('Kimi 模型或额度响应格式无法确认，请稍后刷新')
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const item = await reader.read()
      if (item.done) break
      bytes += item.value.byteLength
      if (bytes > 1_048_576) throw new KimiOAuthModelError('Kimi 模型或额度响应过大，请稍后刷新')
      chunks.push(item.value)
    }
    const buffer = Buffer.concat(chunks)
    try {
      return JSON.parse(buffer.toString('utf8'))
    } finally {
      buffer.fill(0)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
    for (const chunk of chunks) chunk.fill(0)
  }
}

/** Current native subscription quota is required; a public models list is never sufficient. */
export function kimiQuotaRemaining(raw: unknown): 'available' | 'exhausted' | 'unknown' {
  if (!record(raw) || !record(raw.usages)) return 'unknown'
  const entries = ['limit_5h', 'limit_7d', 'limit_month_total', 'limit_month_code']
    .filter((key) => raw.usages[key] !== undefined)
    .map((key) => raw.usages[key])
  if (!entries.length) return 'unknown'
  const ratios = entries.map((entry) => {
    if (!record(entry) || (typeof entry.used_ratio !== 'number' && typeof entry.used_ratio !== 'string'))
      return NaN
    if (typeof entry.used_ratio === 'string' && !entry.used_ratio.trim()) return NaN
    return Number(entry.used_ratio)
  })
  if (ratios.some((ratio) => !Number.isFinite(ratio) || ratio < 0)) return 'unknown'
  return ratios.some((ratio) => ratio >= 1) ? 'exhausted' : 'available'
}

export async function probeKimiOAuthModels(
  source: FirstPartyModelSource,
  options: Parameters<typeof probeAccountModels>[1] = {},
): Promise<AccountModelScope> {
  const signal = options.signal ?? new AbortController().signal
  signal.throwIfAborted()
  if (
    source.provider !== PROVIDER ||
    source.apiType !== 'kimi-managed-oauth' ||
    !BASES.has(source.baseUrl || '') ||
    source.credential.type !== 'oauth' ||
    typeof source.credential.access !== 'string' ||
    !source.credential.accountId ||
    ownPrincipal(source.credential.access) !== source.credential.accountId
  )
    throw unavailable()
  if (nearExpiry(source.credential.expires, Date.now())) throw expired()
  const cancel = new AbortController()
  const control = AbortSignal.any([signal, cancel.signal, AbortSignal.timeout(options.timeoutMs ?? 8_000)])
  const request = async (name: 'models' | 'usages') => {
    try {
      const response = await (options.fetch ?? hostFetch)(`${source.baseUrl}/${name}`, {
        headers: { Authorization: `Bearer ${source.credential.access}`, Accept: 'application/json' },
        redirect: 'error',
        signal: control,
      })
      if (!response.ok) {
        await response.body?.cancel()
        if ([401, 403].includes(response.status))
          throw new KimiOAuthModelError('Kimi 登录或订阅授权未通过，请打开账号终端检查登录与额度')
        throw new KimiOAuthModelError('Kimi 模型或额度查询暂不可用，请稍后刷新')
      }
      return await responseJson(response, control)
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof KimiOAuthModelError) throw error
      throw new KimiOAuthModelError('Kimi 模型或额度查询失败，请检查网络后刷新')
    }
  }
  const requests = [request('models'), request('usages')]
  try {
    const [models, usages] = await Promise.all(requests)
    signal.throwIfAborted()
    if (nearExpiry(source.credential.expires, Date.now())) throw expired()
    const quota = kimiQuotaRemaining(usages)
    if (quota === 'exhausted') throw new KimiOAuthModelError('Kimi 当前账号额度已用尽，请等待重置或检查订阅')
    if (quota !== 'available')
      throw new KimiOAuthModelError('Kimi 当前账号剩余额度暂无法确认，请在账号终端检查后刷新')
    if (!record(models) || !Array.isArray(models.data))
      throw new KimiOAuthModelError('Kimi 模型目录格式无法确认，请稍后刷新')
    return {
      state: 'supported',
      source: 'account-models',
      models: models.data
        .filter(
          (model) =>
            record(model) &&
            id(model.id) &&
            Number.isInteger(Number(model.context_length)) &&
            Number(model.context_length) > 0 &&
            model.available !== false &&
            model.allowed !== false &&
            model.disabled !== true &&
            model.entitled !== false,
        )
        .map((model) => ({
          id: model.id,
          name: typeof model.display_name === 'string' ? model.display_name : undefined,
          cost: 'unknown' as const,
        })),
    }
  } finally {
    cancel.abort()
    await Promise.allSettled(requests)
  }
}
