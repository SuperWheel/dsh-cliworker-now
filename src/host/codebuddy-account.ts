import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import { chmod, lstat, mkdtemp, open, realpath, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EFFORTS, type Effort, type ModelChoice } from '../shared/types.ts'
import { captureCatalogMetadata } from './adapters.ts'
import type { AccountIdentity } from './account-identity.ts'
import type { ProcessBackend, RuntimeConfig } from './process.ts'
import { parseNativeJsonc } from './opencode-native.ts'

export class CodebuddyAccountError extends Error {
  readonly code = 'CLI_OWN_ACCOUNT_REQUIRED'
  constructor(message = 'CodeBuddy 原生模型目录暂不可用，请在原生终端检查登录') {
    super(message)
    this.name = 'CodebuddyAccountError'
  }
}
const loginRequired = () => new CodebuddyAccountError('CodeBuddy 未登录或认证已失效，请在 CodeBuddy 原生终端使用 /login 登录')
interface AccountOptions { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; home?: string; signal?: AbortSignal; executable?: string; project?: string }
/** DSH scrubs TOKEN/KEY-shaped inherited names. Explicitly forward only this
 * CLI's auth/site variables, in child env only, never request JSON or storage. */
export function codebuddyEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return { DISABLE_AUTOUPDATER: '1', ...Object.fromEntries([
    'CODEBUDDY_AUTH_TOKEN', 'CODEBUDDY_API_KEY', 'CODEBUDDY_API_KEY_HELPER_DISABLED', 'CODEBUDDY_API_KEY_DISABLED',
    'CODEBUDDY_INTERNET_ENVIRONMENT', 'CODEBUDDY_COPILOT_INTERNET_ENVIRONMENT',
  ].flatMap(name => env[name] === undefined ? [] : [[name, env[name]!]])) }
}
export function codebuddyAuthDirectory(platform = process.platform, env = process.env, home = homedir()): string {
  if (platform === 'win32') return win32.join(env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local'), 'CodeBuddyExtension', 'Data', 'Public', 'auth')
  return join(home, ...(platform === 'darwin' ? ['Library', 'Application Support'] : ['.local', 'share']), 'CodeBuddyExtension', 'Data', 'Public', 'auth')
}
function authPath(options: AccountOptions) {
  const path = (options.platform ?? process.platform) === 'win32' ? win32 : { join }
  return path.join(codebuddyAuthDirectory(options.platform, options.env, options.home), 'Tencent-Cloud.coding-copilot.info')
}
export async function readCodebuddyLoginState(options: AccountOptions = {}): Promise<'authenticated' | 'unauthenticated' | 'unknown' | 'unavailable'> {
  if (await hasConfiguredAuthentication(options)) return 'authenticated'
  return readFileLoginState(options)
}
async function readFileLoginState(options: AccountOptions): Promise<'authenticated' | 'unauthenticated' | 'unknown' | 'unavailable'> {
  options.signal?.throwIfAborted()
  try {
    const file = authPath(options)
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink()) return 'unknown'
    try {
      const marker = await lstat(`${file}.logged-out`)
      return marker.isFile() && !marker.isSymbolicLink() ? 'unauthenticated' : 'unknown'
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    options.signal?.throwIfAborted()
    return 'authenticated'
  } catch (error) {
    options.signal?.throwIfAborted()
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'unauthenticated'
    if (['EACCES', 'EPERM', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return 'unavailable'
    throw error
  }
}
export function codebuddyDeclaredSite(env = process.env): { id: string; label: string } | undefined {
  const raw = [env.CODEBUDDY_INTERNET_ENVIRONMENT, env.CODEBUDDY_COPILOT_INTERNET_ENVIRONMENT]
    .map(value => typeof value === 'string' ? value.replace(/\p{C}/gu, '').trim() : undefined).find(Boolean)
  if (!raw) return undefined
  const value = [...raw].slice(0, 64).join('')
  const id = value.toLowerCase()
  const label = new Map([['internal', '中国站'], ['external', '国际站'], ['ioa', 'iOA'], ['selfhosted', '企业域']]).get(id)
  return label ? { id, label } : { id: `declared:${value}`, label: value }
}
/** Project private JSON immediately; never return documents or parser errors.
 * Only the selected fields can escape this function; input bytes are discarded. */
async function projectPrivateJson<T>(path: string, select: (value: any, raw: string) => T, parse: (raw: string) => unknown = JSON.parse): Promise<T | undefined> {
  let file: Awaited<ReturnType<typeof open>> | undefined, bytes: Buffer | undefined
  try {
    const entry = await lstat(path)
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 1024 * 1024) return undefined
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const before = await file.stat()
    if (!before.isFile() || before.dev !== entry.dev || before.ino !== entry.ino || before.size > 1024 * 1024) return undefined
    bytes = Buffer.alloc(before.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      const read = await file.read(bytes, offset, bytes.length - offset, offset)
      if (!read.bytesRead) break
      offset += read.bytesRead
    }
    const after = await file.stat()
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) return undefined
    const raw = bytes.subarray(0, offset).toString('utf8')
    return select(parse(raw), raw)
  } catch {
    // JSON parse errors can contain passwords, tokens or domains. Never expose them.
    return undefined
  } finally {
    bytes?.fill(0)
    await file?.close().catch(() => {})
  }
}
/** CodeBuddy 2.184.0: USER -> PROJECT -> PROJECT_LOCAL. env is replaced as a
 * whole, not merged by key. Only booleans and sanitized site IDs leave the reader.
 * Callers must supply the worker project; the host's cwd is not that project. */
async function readSettings(options: AccountOptions) {
  const env = options.env ?? process.env
  const paths = (options.platform ?? process.platform) === 'win32' ? win32 : { join, isAbsolute }
  const home = env.CODEBUDDY_CONFIG_DIR?.trim() ? env.CODEBUDDY_CONFIG_DIR : paths.join(options.home ?? homedir(), '.codebuddy')
  const files = [paths.join(home, 'settings.json')]
  if (options.project) {
    const configured = env.CODEBUDDY_PROJECT_CONFIG_DIR?.trim() || '.codebuddy'
    const project = paths.isAbsolute(configured) ? configured : paths.join(options.project, configured)
    files.push(paths.join(project, 'settings.json'), paths.join(project, 'settings.local.json'))
  }
  let helper = false, scannedToken = false, token = false, apiKey = false, site: ReturnType<typeof codebuddyDeclaredSite>
  for (const file of files) {
    options.signal?.throwIfAborted()
    const settings = await projectPrivateJson(file, (value, raw) => ({
      hasHelper: Object.hasOwn(value ?? {}, 'apiKeyHelper'),
      helper: typeof value?.apiKeyHelper === 'string' && !!value.apiKeyHelper,
      hasEnv: Object.hasOwn(value ?? {}, 'env'),
      token: typeof value?.env?.CODEBUDDY_AUTH_TOKEN === 'string' && !!value.env.CODEBUDDY_AUTH_TOKEN,
      scannedToken: (() => {
        // The early custom-token scan uses JSON.parse; SettingsManager uses JSONC.
        try { return !!JSON.parse(raw)?.env?.CODEBUDDY_AUTH_TOKEN } catch { return false }
      })(),
      apiKey: typeof value?.env?.CODEBUDDY_API_KEY === 'string' && !!value.env.CODEBUDDY_API_KEY,
      site: codebuddyDeclaredSite({ CODEBUDDY_INTERNET_ENVIRONMENT: value?.env?.CODEBUDDY_INTERNET_ENVIRONMENT,
        CODEBUDDY_COPILOT_INTERNET_ENVIRONMENT: value?.env?.CODEBUDDY_COPILOT_INTERNET_ENVIRONMENT }),
    }), parseNativeJsonc)
    if (!settings) continue
    if (settings.hasHelper) helper = settings.helper
    // CustomTokenAuthenticationStorage also scans each settings file for tokens,
    // in USER -> PROJECT -> PROJECT_LOCAL order, before invoking the helper.
    scannedToken ||= settings.scannedToken
    if (settings.hasEnv) { token = settings.token; apiKey = settings.apiKey; site = settings.site }
  }
  options.signal?.throwIfAborted()
  return { helper, token: scannedToken || token, apiKey, site }
}
async function hasConfiguredAuthentication(options: AccountOptions): Promise<boolean> {
  options.signal?.throwIfAborted()
  const env = options.env ?? process.env
  if (env.CODEBUDDY_AUTH_TOKEN) return true
  const settings = await readSettings(options)
  if (settings.token) return true
  // The CLI checks truthiness, so even "0" or "false" disables the source.
  if (!env.CODEBUDDY_API_KEY_HELPER_DISABLED && settings.helper) return true
  return !env.CODEBUDDY_API_KEY_DISABLED && (settings.apiKey || !!env.CODEBUDDY_API_KEY)
}
const unknownSite = () => ({ id: 'undeclared', label: '站点未公开' })
const DOMAIN_GROUPS = [
  ['internalDomain', 'internal', '中国站'],
  ['iOADomain', 'ioa', 'iOA'],
  ['cloudHostedDomain', 'cloudhosted', '企业域'],
  ['externalDomain', 'external', '国际站'],
] as const
type DomainKey = (typeof DOMAIN_GROUPS)[number][0]
type DomainTable = Record<DomainKey, string[]>
// CodeBuddy 2.181.0 fallback. Do not broaden enterprise wildcards across labels.
const BUILTIN_DOMAINS: DomainTable = {
  internalDomain: ['copilot.tencent.com', 'staging-copilot.tencent.com', 'www.codebuddy.cn',
    'staging.codebuddy.cn', 'www.workbuddy.cn', 'staging.workbuddy.cn'],
  iOADomain: ['tencent.sso.copilot.tencent.com', 'tencent.sso.copilot-staging.tencent.com',
    'tencent.sso.codebuddy.cn', 'tencent.staging-sso.codebuddy.cn'],
  cloudHostedDomain: ['*.sso.copilot.tencent.com', '*.sso.copilot-staging.tencent.com',
    '*.copilot.qq.com', '*.copilot-staging.qq.com', '*.sso.codebuddy.cn', '*.staging-sso.codebuddy.cn'],
  externalDomain: ['www.codebuddy.ai', 'staging-codebuddy.tencent.com'],
}
async function domainTable(executable?: string): Promise<DomainTable> {
  if (!executable) return BUILTIN_DOMAINS
  try {
    let directory = dirname(await realpath(executable))
    while (true) {
      const path = join(directory, 'product.json')
      let found = false
      try { await lstat(path); found = true }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return BUILTIN_DOMAINS }
      if (found) return await projectPrivateJson(path, value => {
        const attributes = value?.authentication?.attributes
        const table = {} as DomainTable
        for (const [key] of DOMAIN_GROUPS) {
          const field = attributes?.[key]
          const patterns = typeof field === 'string' ? [field] : field
          if (!Array.isArray(patterns) || patterns.length > 256 || patterns.some(pattern =>
            typeof pattern !== 'string' || !pattern || pattern.length > 253 || /[^a-z0-9.*-]/i.test(pattern))) return undefined
          table[key] = patterns
        }
        return table
      }) ?? BUILTIN_DOMAINS
      const parent = dirname(directory)
      if (parent === directory) return BUILTIN_DOMAINS
      directory = parent
    }
  } catch { return BUILTIN_DOMAINS }
}
/** Settings declaration > process declaration > auth.domain. No raw domain leaves here. */
export async function readCodebuddySite(options: AccountOptions = {}): Promise<{ id: string; label: string }> {
  options.signal?.throwIfAborted()
  const settingsSite = (await readSettings(options)).site
  options.signal?.throwIfAborted()
  const declared = settingsSite ?? codebuddyDeclaredSite(options.env)
  if (declared) return declared
  // Preserve lstat-only login checks, and do not open absent, logged-out or linked auth.
  if (await readFileLoginState(options) !== 'authenticated') return unknownSite()
  const domain = await projectPrivateJson(authPath(options), value =>
    typeof value?.auth?.domain === 'string' ? value.auth.domain : undefined)
  options.signal?.throwIfAborted()
  if (!domain || domain.length > 253 || /[^a-z0-9.-]/i.test(domain)) return unknownSite()
  const table = await domainTable(options.executable)
  options.signal?.throwIfAborted()
  for (const [key, id, label] of DOMAIN_GROUPS) {
    // Patterns permit only host literals and '*'; every wildcard matches one label.
    if (table[key].some(pattern => new RegExp('^' + pattern.split('*')
      .map(part => part.replaceAll('.', '\\.')).join('[^.]*') + '$', 'i').test(domain))) return { id, label }
  }
  return unknownSite()
}
type RawModel = { modelId: string; name?: string; _meta?: { credits?: unknown; effortOptions?: unknown } }
function rawModels(raw: unknown): RawModel[] {
  const models = Array.isArray(raw) ? raw : (raw as { models?: unknown } | null)?.models
  if (!Array.isArray(models) || !models.length || models.length > 4096 || models.some(model =>
    !model || typeof model.modelId !== 'string' || !model.modelId.trim() || /\p{C}/u.test(model.modelId)))
    throw new CodebuddyAccountError('CodeBuddy 未公开有效的模型目录')
  if (new Set(models.map(model => model.modelId)).size !== models.length) throw new CodebuddyAccountError('CodeBuddy 模型目录包含重复 ID')
  return models
}
export function parseCodebuddyModels(raw: unknown): ModelChoice[] {
  const models = rawModels(raw)
  const nameOf = (model: RawModel) => typeof model.name === 'string' && model.name.trim() ? model.name : model.modelId
  const counts = new Map<string, number>()
  for (const model of models) counts.set(nameOf(model), (counts.get(nameOf(model)) ?? 0) + 1)
  return models.map(model => {
    const efforts: Effort[] = ['default']
    if (Array.isArray(model._meta?.effortOptions)) for (const option of model._meta.effortOptions) {
      const value = option?.value
      if (EFFORTS.includes(value) && value !== 'none' && !efforts.includes(value)) efforts.push(value)
    }
    const credits = typeof model._meta?.credits === 'string' ? model._meta.credits.trim() : ''
    const paid = /^x(\d+(?:\.\d+)?)/i.exec(credits)
    const cost = /^x0(?:\.0+)?\s*credits$/i.test(credits) ? 'free' : paid && Number(paid[1]) > 0 ? 'paid' : 'unknown'
    const name = nameOf(model)
    return { id: model.modelId, label: counts.get(name)! > 1 ? `${name}（${model.modelId}）` : name, efforts, cost }
  })
}
function bridgePath() {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const path of [join(here, 'codebuddy-catalog.mjs'), resolve(here, '../../codebuddy-catalog.mjs')])
    if (existsSync(path)) return path
  throw new CodebuddyAccountError('CodeBuddy catalog bridge 未安装，请重新构建插件')
}
async function queryCatalog(backend: ProcessBackend, config: RuntimeConfig, executable: string, signal: AbortSignal,
  env: Record<string, string>) {
  signal.throwIfAborted()
  // Keep the read-only catalog out of the user's project: an untrusted folder would
  // prompt, and CodeBuddy may write session files there. Env credentials are forwarded
  // explicitly; project-only apiKeyHelper is a known gap (REQ-0136).
  const temporary = await mkdtemp(join(tmpdir(), 'cliworker-codebuddy-catalog-'))
  const cwd = temporary
  try {
    await chmod(temporary, 0o700)
    const output = await captureCatalogMetadata(backend, config, [process.execPath, bridgePath(), executable, cwd], cwd, signal, env)
    let raw: unknown
    try { raw = JSON.parse(output) } catch { throw new CodebuddyAccountError() }
    const models = rawModels(raw)
    return { raw: models, models: parseCodebuddyModels(models) }
  } catch (error) {
    signal.throwIfAborted()
    if ((error as { exitCode?: number }).exitCode === 3) throw loginRequired()
    throw error
  } finally { await rm(temporary, { recursive: true, force: true }) }
}
interface CatalogScope {
  backend: ProcessBackend; config: RuntimeConfig; executable: string; signal: AbortSignal
  active: boolean; reading?: ReturnType<typeof queryCatalog>; readingKey?: string
}
const snapshots = new AsyncLocalStorage<CatalogScope>()
export async function withCodebuddyCatalogSnapshot<T>(backend: ProcessBackend, config: RuntimeConfig, executable: string,
  signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  const scope: CatalogScope = { backend, config, executable, signal, active: true }
  return snapshots.run(scope, async () => {
    try { return await fn() }
    finally { scope.active = false; scope.reading = undefined }
  })
}
async function metadata(backend: ProcessBackend, config: RuntimeConfig, executable: string, signal: AbortSignal, options: AccountOptions = {}) {
  const scope = snapshots.getStore()
  const env = codebuddyEnvironment(options.env)
  // Cache only a protected context digest and models, never environment values.
  const key = createHash('sha256').update(JSON.stringify([options.project ?? null,
    Object.entries(env).filter(([, value]) => value !== '')])).digest('hex')
  if (scope && scope.readingKey !== key) { scope.reading = undefined; scope.readingKey = key }
  const result = scope?.active && scope.backend === backend && scope.config === config && scope.executable === executable && scope.signal === signal
    ? await (scope.reading ??= queryCatalog(backend, config, executable, signal, env))
    : await queryCatalog(backend, config, executable, signal, env)
  signal.throwIfAborted()
  return structuredClone(result)
}
export async function discoverCodebuddyModels(backend: ProcessBackend, config: RuntimeConfig, executable: string, signal: AbortSignal,
  options: AccountOptions = {}): Promise<ModelChoice[]> {
  return (await metadata(backend, config, executable, signal, options)).models
}
export async function readCodebuddyAccountBindingMaterial(backend: ProcessBackend, config: RuntimeConfig, executable: string,
  signal: AbortSignal, options: AccountOptions = {}) {
  if (await readCodebuddyLoginState({ ...options, signal }) !== 'authenticated') throw loginRequired()
  const declared = await readCodebuddySite({ ...options, executable, signal })
  const env = codebuddyEnvironment(options.env)
  const data = await metadata(backend, config, executable, signal, { ...options, env })
  const pairs = data.raw.map(model => [model.modelId, model._meta?.credits ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  const catalog = createHash('sha256').update(JSON.stringify(pairs)).digest('hex')
  const credentials = Object.fromEntries(['CODEBUDDY_AUTH_TOKEN', 'CODEBUDDY_API_KEY']
    .filter(name => !!env[name]).map(name => [name, createHash('sha256').update(env[name]!).digest('hex')]))
  // Preserve the exact legacy material for file/settings-only users. This is a
  // protected credential fingerprint, not a decoded account/principal claim.
  return { sourceIds: [authPath(options)], entries: [{ provider: 'codebuddy', principal: { site: declared.id, catalog,
    ...(Object.keys(credentials).length ? { environment: { credentials,
      helperDisabled: !!env.CODEBUDDY_API_KEY_HELPER_DISABLED, apiKeyDisabled: !!env.CODEBUDDY_API_KEY_DISABLED } } : {}) } }] }
}
export async function readCodebuddyAccount(options: AccountOptions = {}): Promise<AccountIdentity> {
  const configured = await hasConfiguredAuthentication(options)
  let state = configured ? 'authenticated' as const : await readFileLoginState(options)
  // Reuse the authorized auth.domain projection. Unreadable/malformed JSON is not a login.
  if (!configured && state === 'authenticated' && !await projectPrivateJson(authPath(options), value =>
    typeof value?.auth?.domain === 'string' && value.auth.domain.length > 0)) state = 'unknown'
  options.signal?.throwIfAborted()
  const site = state === 'authenticated' ? await readCodebuddySite(options) : undefined
  return { state, verification: 'local', summary: state === 'authenticated'
    ? `已登录 · ${site!.label}` : state === 'unauthenticated' ? '尚未登录 CodeBuddy，请在原生终端使用 /login' : '无法确认 CodeBuddy 登录状态，请检查原生账号文件是否可读' }
}
