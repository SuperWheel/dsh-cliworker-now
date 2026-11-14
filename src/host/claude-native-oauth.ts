import { spawnProbe } from './probe-process.ts'
import { StringDecoder } from 'node:string_decoder'
import { EFFORTS, type ModelChoice } from '../shared/types.ts'
import { accountEmail } from './account-identity.ts'
import { ProcessCleanupUnconfirmedError, type ProcessBackend, type RuntimeConfig } from './process.ts'
import { claudeLaunchEnvironment } from './claude-own-route.ts'

const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
// Native ids may end in a context-window suffix such as `[1m]`; keep it exactly.
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]*(?:\[[A-Za-z0-9]+\])?$/.test(value)
const text = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value)

export class ClaudeNativeOAuthError extends Error {
  readonly code = 'CLAUDE_NATIVE_OAUTH_UNAVAILABLE'
  constructor(message = 'Claude 原生账号模型或额度暂无法确认，请在账号终端检查后刷新') {
    super(message)
    this.name = 'ClaudeNativeOAuthError'
  }
}

export interface ClaudeNativeOAuthCatalog {
  models: ModelChoice[]
  /** Host-only identity evidence. Do not persist this object or send it through Gateway. */
  account: { email: string; organization?: string }
  /** 'unknown': the CLI returned no usable plan limits; real calls still enforce them. */
  quota: 'confirmed' | 'unknown'
}

/** Native initialize is capability metadata: even an unauthenticated CLI returns models. */
function ownAccount(value: unknown): ClaudeNativeOAuthCatalog['account'] {
  const email = record(value) ? accountEmail(value.email) : undefined
  // Claude 2.1.296 reports tokenSource; 2.1.287 omits it and reports the plan as subscriptionType.
  const claudeAi =
    record(value) &&
    (value.tokenSource === 'claude.ai' || (value.tokenSource === undefined && text(value.subscriptionType)))
  if (
    !record(value) ||
    value.apiProvider !== 'firstParty' ||
    !claudeAi ||
    (value.apiKeySource !== undefined && value.apiKeySource !== 'none') ||
    !email
  )
    throw new ClaudeNativeOAuthError('Claude 尚未通过原生账号登录，请打开账号终端登录')
  if (value.organization !== undefined && !text(value.organization)) throw new ClaudeNativeOAuthError()
  return { email, ...(value.organization !== undefined && { organization: value.organization }) }
}

/**
 * Claude 2.1.296's get_usage can fall back to stale persisted/header observations after a
 * failed endpoint read. That fallback removes `limits`; never authorize from it. A native
 * successful read can still use the CLI's own account-bound snapshot younger than 60s. We add
 * no cache and make no claim of a separate live model entitlement API.
 */
function remainingQuota(value: unknown, now: number): 'confirmed' | 'unknown' {
  if (!record(value) || !['pro', 'max', 'team', 'enterprise'].includes(value.subscription_type))
    throw new ClaudeNativeOAuthError('Claude 原生账号订阅暂无法确认，请检查登录与订阅后刷新')
  // Unknown quota does not hide the models; only a confirmed exhausted window blocks them.
  try {
    checkQuota(value, now)
    return 'confirmed'
  } catch (error) {
    if (error instanceof QuotaUnknown) return 'unknown'
    throw error
  }
}

class QuotaUnknown {}
const unknown = () => new QuotaUnknown()

function checkQuota(value: Record<string, any>, now: number): void {
  if (value.rate_limits_available !== true || !record(value.rate_limits) || !Array.isArray(value.rate_limits.limits))
    throw unknown()
  const limits = value.rate_limits
  const windows = ['five_hour', 'seven_day', 'seven_day_oauth_apps', 'seven_day_opus', 'seven_day_sonnet']
    .filter((key) => limits[key] != null)
    .map((key) => limits[key])
  // A billing balance or extra-usage wallet is not authorization to spend beyond a plan.
  if (limits.five_hour == null || limits.seven_day == null) throw unknown()
  const percentages: number[] = []
  const window = (entry: unknown) => {
    if (
      !record(entry) ||
      typeof entry.utilization !== 'number' ||
      !Number.isFinite(entry.utilization) ||
      entry.utilization < 0 ||
      (entry.resets_at !== null &&
        (typeof entry.resets_at !== 'string' ||
          !Number.isFinite(Date.parse(entry.resets_at)) ||
          Date.parse(entry.resets_at) <= now))
    )
      throw unknown()
    percentages.push(entry.utilization)
  }
  windows.forEach(window)
  if (limits.model_scoped !== undefined) {
    if (!Array.isArray(limits.model_scoped)) throw unknown()
    limits.model_scoped.forEach(window)
  }
  for (const entry of limits.limits) {
    if (
      !record(entry) ||
      typeof entry.percent !== 'number' ||
      !Number.isFinite(entry.percent) ||
      entry.percent < 0 ||
      typeof entry.is_active !== 'boolean'
    )
      throw unknown()
    if (entry.is_active) percentages.push(entry.percent)
  }
  // Conservative across all returned plan windows; do not infer that a model bypasses a limit.
  if (percentages.some((percent) => percent >= 100))
    throw new ClaudeNativeOAuthError('Claude 当前账号存在已用尽的限额，请等待重置或检查订阅')
}

export function parseClaudeNativeOAuthCatalog(
  initialize: unknown,
  usage: unknown,
  now = Date.now(),
): ClaudeNativeOAuthCatalog {
  if (!record(initialize)) throw new ClaudeNativeOAuthError()
  const account = ownAccount(initialize.account)
  const quota = remainingQuota(usage, now)
  if (!Array.isArray(initialize.models)) throw new ClaudeNativeOAuthError()
  const models = new Map<string, ModelChoice>()
  const resolved = new Map<string, string>()
  for (const model of initialize.models) {
    if (
      !record(model) ||
      !id(model.value) ||
      !id(model.resolvedModel) ||
      model.disabled === true ||
      model.hidden === true ||
      model.entitled === false ||
      model.available === false ||
      model.allowed === false
    )
      continue
    const efforts =
      model.supportsEffort === true && Array.isArray(model.supportedEffortLevels)
        ? EFFORTS.filter(
            (effort) =>
              ['low', 'medium', 'high', 'xhigh', 'max'].includes(effort) &&
              model.supportedEffortLevels.includes(effort),
          )
        : []
    // Default leaves the native CLI's own effort policy untouched.
    const choice: ModelChoice = {
      id: model.value,
      label: text(model.displayName) ? model.displayName : model.value,
      efforts: ['default', ...efforts],
    }
    // Claude 2.1.287 repeats the selected `default` entry; only a conflicting duplicate is ambiguous.
    if (resolved.has(choice.id)) {
      if (resolved.get(choice.id) !== model.resolvedModel)
        throw new ClaudeNativeOAuthError('Claude 原生模型目录存在重复选项，请刷新')
      continue
    }
    resolved.set(choice.id, model.resolvedModel)
    models.set(choice.id, choice)
  }
  if (!models.size) throw new ClaudeNativeOAuthError('Claude 原生账号暂未返回可确认的模型，请刷新')
  return { account, models: [...models.values()], quota }
}

/** Only initialize/get_usage controls are sent. No user message, token read, login or model request. */
export async function discoverClaudeNativeOAuth(
  backend: ProcessBackend,
  config: RuntimeConfig,
  executable: string,
  cwd: string,
  signal: AbortSignal,
  prefixArgs: string[],
): Promise<ClaudeNativeOAuthCatalog> {
  signal.throwIfAborted()
  // The caller supplies the same native-route overlay used for actual worker execution.
  if (prefixArgs.length !== 2 || prefixArgs[0] !== '--settings') throw new ClaudeNativeOAuthError()
  let overlay: unknown
  try {
    overlay = JSON.parse(prefixArgs[1]!)
  } catch {
    throw new ClaudeNativeOAuthError()
  }
  if (!record(overlay)) throw new ClaudeNativeOAuthError()
  const control = AbortSignal.any([signal, AbortSignal.timeout(15_000)])
  const child = await spawnProbe(backend, {
    argv: [
      executable,
      '--settings',
      JSON.stringify({ ...overlay, disableAllHooks: true, promptSuggestionEnabled: false }),
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--print',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
    ],
    cwd,
    env: {
      ...claudeLaunchEnvironment(),
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_TELEMETRY: '1',
      DISABLE_ERROR_REPORTING: '1',
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
    },
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    graceMs: config.graceMs,
    signal: control,
  })
  void child.done.catch(() => undefined)
  const inputError = () => undefined
  child.stdin?.on('error', inputError)
  const write = (request_id: string, request: unknown) =>
    new Promise<void>((resolve, reject) => {
      if (!child.stdin || child.stdin.destroyed) return reject(new ClaudeNativeOAuthError())
      child.stdin.write(JSON.stringify({ type: 'control_request', request_id, request }) + '\n', (error) =>
        error ? reject(new ClaudeNativeOAuthError()) : resolve(),
      )
    })
  let bytes = 0
  const count = (chunk: unknown) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    bytes += buffer.length
    if (bytes > Math.min(config.maxRunBytes, 2_097_152))
      throw new ClaudeNativeOAuthError('Claude 账号目录响应过大')
    return buffer
  }
  const errors = (async () => {
    if (child.stderr) for await (const chunk of child.stderr) count(chunk)
  })()
  void errors.catch(() => undefined)
  const output = (async () => {
    if (!child.stdout) throw new ClaudeNativeOAuthError()
    const decoder = new StringDecoder('utf8')
    let pending = '',
      expected = 'native-initialize',
      initialize: unknown
    for await (const chunk of child.stdout) {
      pending += decoder.write(count(chunk))
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        let message: unknown
        try {
          message = JSON.parse(line)
        } catch {
          throw new ClaudeNativeOAuthError()
        }
        if (!record(message)) throw new ClaudeNativeOAuthError()
        if (['assistant', 'user', 'stream_event', 'result', 'control_request'].includes(message.type))
          throw new ClaudeNativeOAuthError('Claude 账号查询返回了非元数据事件，已停止查询')
        if (message.type !== 'control_response') continue
        const response = message.response
        if (!record(response) || response.request_id !== expected) throw new ClaudeNativeOAuthError()
        if (response.subtype !== 'success' || !record(response.response)) throw new ClaudeNativeOAuthError()
        if (expected === 'native-initialize') {
          initialize = response.response
          ownAccount(response.response.account)
          expected = 'native-usage'
          await write(expected, { subtype: 'get_usage', skip_behaviors: true })
        } else return parseClaudeNativeOAuthCatalog(initialize, response.response)
      }
    }
    throw new ClaudeNativeOAuthError('Claude 账号查询提前结束，请刷新')
  })()
  void output.catch(() => undefined)
  let abort = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    abort = () =>
      reject(
        new ClaudeNativeOAuthError(signal.aborted ? 'Claude 账号查询已取消' : 'Claude 账号查询超时，请刷新'),
      )
    control.addEventListener('abort', abort, { once: true })
    if (control.aborted) abort()
  })
  const failed = new Promise<never>((_, reject) => {
    void errors.catch(reject)
    void child.done.catch(() => reject(new ClaudeNativeOAuthError()))
  })
  try {
    await Promise.race([
      write('native-initialize', {
        subtype: 'initialize',
        hooks: {},
        sdkMcpServers: [],
        promptSuggestions: false,
        agentProgressSummaries: false,
      }),
      cancelled,
    ])
    const result = await Promise.race([output, cancelled, failed])
    control.throwIfAborted()
    return result
  } catch (error) {
    if (error instanceof ClaudeNativeOAuthError) throw error
    signal.throwIfAborted()
    throw new ClaudeNativeOAuthError()
  } finally {
    control.removeEventListener('abort', abort)
    try {
      child.terminate()
      if (!(await child.waitForExit())) throw new ProcessCleanupUnconfirmedError()
    } catch {
      throw new ProcessCleanupUnconfirmedError()
    }
    await Promise.allSettled([output, errors, child.done])
    child.stdin?.removeListener('error', inputError)
  }
}
