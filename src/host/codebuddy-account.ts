import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import { chmod, lstat, mkdtemp, open, realpath, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EFFORTS, type Effort, type ModelChoice } from '../shared/types.ts'
import { captureCatalogMetadata } from './adapters.ts'
import type { AccountIdentity } from './account-identity.ts'
import type { ProcessBackend, RuntimeConfig } from './process.ts'

export class CodebuddyAccountError extends Error {
  readonly code = 'CLI_OWN_ACCOUNT_REQUIRED'
  constructor(message = 'CodeBuddy 原生模型目录暂不可用，请在原生终端检查登录') {
    super(message)
    this.name = 'CodebuddyAccountError'
  }
}
const loginRequired = () => new CodebuddyAccountError('CodeBuddy 未登录或认证已失效，请在 CodeBuddy 原生终端使用 /login 登录')
interface AccountOptions { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; home?: string; signal?: AbortSignal; executable?: string }
export function codebuddyAuthDirectory(platform = process.platform, env = process.env, home = homedir()): string {
  if (platform === 'win32') return win32.join(env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local'), 'CodeBuddyExtension', 'Data', 'Public', 'auth')
  return join(home, ...(platform === 'darwin' ? ['Library', 'Application Support'] : ['.local', 'share']), 'CodeBuddyExtension', 'Data', 'Public', 'auth')
}
function authPath(options: AccountOptions) {
  const path = (options.platform ?? process.platform) === 'win32' ? win32 : { join }
  return path.join(codebuddyAuthDirectory(options.platform, options.env, options.home), 'Tencent-Cloud.coding-copilot.info')
}
export async function readCodebuddyLoginState(options: AccountOptions = {}): Promise<'authenticated' | 'unauthenticated'> {
  options.signal?.throwIfAborted()
  try {
    const file = authPath(options)
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink()) return 'unauthenticated'
    try { await lstat(`${file}.logged-out`); return 'unauthenticated' }
    catch (error) { if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error }
    options.signal?.throwIfAborted()
    return 'authenticated'
  } catch (error) {
    options.signal?.throwIfAborted()
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) return 'unauthenticated'
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
async function projectPrivateJson<T>(path: string, select: (value: any) => T): Promise<T | undefined> {
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
    return select(JSON.parse(bytes.subarray(0, offset).toString('utf8')))
  } catch {
    // JSON parse errors can contain passwords, tokens or domains. Never expose them.
    return undefined
  } finally {
    bytes?.fill(0)
    await file?.close().catch(() => {})
  }
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
  const paths = (options.platform ?? process.platform) === 'win32' ? win32 : { join }
  const settingsSite = await projectPrivateJson(paths.join(options.home ?? homedir(), '.codebuddy', 'settings.json'), value =>
    codebuddyDeclaredSite({ CODEBUDDY_INTERNET_ENVIRONMENT: value?.env?.CODEBUDDY_INTERNET_ENVIRONMENT,
      CODEBUDDY_COPILOT_INTERNET_ENVIRONMENT: value?.env?.CODEBUDDY_COPILOT_INTERNET_ENVIRONMENT }))
  options.signal?.throwIfAborted()
  const declared = settingsSite ?? codebuddyDeclaredSite(options.env)
  if (declared) return declared
  // Preserve lstat-only login checks, and do not open absent, logged-out or linked auth.
  if (await readCodebuddyLoginState(options) !== 'authenticated') return unknownSite()
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
async function queryCatalog(backend: ProcessBackend, config: RuntimeConfig, executable: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const cwd = await mkdtemp(join(tmpdir(), 'cliworker-codebuddy-catalog-'))
  try {
    await chmod(cwd, 0o700)
    const output = await captureCatalogMetadata(backend, config, [process.execPath, bridgePath(), executable, cwd], cwd, signal, { DISABLE_AUTOUPDATER: '1' })
    let raw: unknown
    try { raw = JSON.parse(output) } catch { throw new CodebuddyAccountError() }
    const models = rawModels(raw)
    return { raw: models, models: parseCodebuddyModels(models) }
  } catch (error) {
    signal.throwIfAborted()
    if ((error as { exitCode?: number }).exitCode === 3) throw loginRequired()
    throw error
  } finally { await rm(cwd, { recursive: true, force: true }) }
}
interface CatalogScope {
  backend: ProcessBackend; config: RuntimeConfig; executable: string; signal: AbortSignal
  active: boolean; reading?: ReturnType<typeof queryCatalog>
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
async function metadata(backend: ProcessBackend, config: RuntimeConfig, executable: string, signal: AbortSignal) {
  const scope = snapshots.getStore()
  const result = scope?.active && scope.backend === backend && scope.config === config && scope.executable === executable && scope.signal === signal
    ? await (scope.reading ??= queryCatalog(backend, config, executable, signal))
    : await queryCatalog(backend, config, executable, signal)
  signal.throwIfAborted()
  return structuredClone(result)
}
export async function discoverCodebuddyModels(backend: ProcessBackend, config: RuntimeConfig, executable: string, signal: AbortSignal): Promise<ModelChoice[]> {
  return (await metadata(backend, config, executable, signal)).models
}
export async function readCodebuddyAccountBindingMaterial(backend: ProcessBackend, config: RuntimeConfig, executable: string,
  signal: AbortSignal, options: AccountOptions = {}) {
  if (await readCodebuddyLoginState({ ...options, signal }) !== 'authenticated') throw loginRequired()
  const declared = await readCodebuddySite({ ...options, executable, signal })
  const data = await metadata(backend, config, executable, signal)
  const pairs = data.raw.map(model => [model.modelId, model._meta?.credits ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  const catalog = createHash('sha256').update(JSON.stringify(pairs)).digest('hex')
  return { sourceIds: [authPath(options)], entries: [{ provider: 'codebuddy', principal: { site: declared.id, catalog } }] }
}
export async function readCodebuddyAccount(options: AccountOptions = {}): Promise<AccountIdentity> {
  const state = await readCodebuddyLoginState(options)
  const site = state === 'authenticated' ? await readCodebuddySite(options) : undefined
  return { state, verification: 'local', summary: state === 'authenticated'
    ? `已登录 · ${site!.label}` : '尚未登录 CodeBuddy，请在原生终端使用 /login' }
}
