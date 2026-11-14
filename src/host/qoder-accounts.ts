import { qoderVariant, type QoderCliId } from './qoder-variant.ts'
import { constants } from 'node:fs'
import { lstat, open, mkdtemp, mkdir, writeFile, rm, readdir, realpath } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { accountEmail, type AccountIdentity } from './account-identity.ts'
import { safePiOmpAncestors } from './pi-omp-native.ts'
import { nativeLaunchArgv, resolveNativeEntry } from './native-launch.mjs'
import { parseNativeJsonc } from './opencode-native.ts'
import { metadataFileFingerprint } from './native-capability-cache.ts'
import { nativeMetadataKey } from './mimo-metadata-cache.ts'
import { ProcessCleanupUnconfirmedError, type ProcessBackend, type RuntimeConfig } from './process.ts'
import { EFFORTS, type Effort, type ModelChoice } from '../shared/types.ts'

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && !/[\x00-\x1f]/.test(v)
const literal = (v: unknown): v is string => text(v) && !/\s|^(?:!|\$|\{|<|your[_ -]|placeholder|changeme)/i.test(v)
const hash = (v: string) => createHash('sha256').update(v).digest('hex')
export class QoderAccountError extends Error {
  readonly code = 'CLI_OWN_ACCOUNT_REQUIRED'
  constructor(message = 'Qoder 当前账号无法确认，请检查原生登录或 PAT 配置') {
    super(message)
    this.name = 'QoderAccountError'
  }
}

type QoderMetadata = { account: unknown; models: ModelChoice[] }
interface QoderCatalogScope {
  cli: QoderCliId
  backend: ProcessBackend
  config: RuntimeConfig
  executable: string
  cwd: string
  signal: AbortSignal
  active: boolean
  reading?: Promise<QoderMetadata>
}
const catalogSnapshots = new AsyncLocalStorage<QoderCatalogScope>()
const changedSource = () => new QoderAccountError('Qoder 账号或模型来源已变化，请刷新重试')

/** A fresh local proof, never a credential/principal cache. Include absent inputs
 * and the customs directory inventory so additions are observable as well. */
async function qoderMetadataSource(executable: string, cwd: string, config: RuntimeConfig, signal: AbortSignal, cli: QoderCliId) {
  const env = qoderEnvironment(cli), directory = env[qoderVariant(cli).prefix + 'CONFIG_DIR']!
  const name = qoderProjectDirectoryName(cli)
  const paths = [join(directory, '.auth', 'user'), join(directory, '.auth', 'machine_id'),
    join(directory, 'settings.json'), join(directory, '.env'),
    ...['settings.json', 'settings.local.json', '.env'].map((file) => join(cwd, name, file))]
  const models = join(directory, '.models')
  let inventory: unknown = 'missing'
  try {
    await safePiOmpAncestors(models)
    const before = await lstat(models)
    if (!before.isDirectory() || before.isSymbolicLink()) throw changedSource()
    const entries = await readdir(models, { withFileTypes: true })
    if (entries.length > 256 || entries.some((entry) => entry.isSymbolicLink() || !entry.isDirectory() && !entry.isFile())) throw changedSource()
    const items = entries.map((entry) => [entry.name, entry.isDirectory() ? 'directory' : 'file']).sort(([a], [b]) => a!.localeCompare(b!))
    for (const entry of entries) if (entry.isDirectory()) paths.push(join(models, entry.name, 'customs'))
    const after = await lstat(models)
    if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw changedSource()
    inventory = [items, after.dev, after.ino, after.mtimeMs, after.ctimeMs]
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const files: [string, string][] = []
  for (const path of [...new Set(paths)].sort()) {
    const fingerprint = await metadataFileFingerprint(path, signal)
    if (fingerprint === undefined) throw changedSource()
    files.push([path, fingerprint])
  }
  const fingerprint = await nativeMetadataKey(executable, cwd, { env, files, inventory,
    cli, configuredExecutable: config[`${cli}Executable`],
    savedExecutable: config.cliExecutablePaths?.read(cli),
    executableRevision: config.cliExecutablePaths?.revision(cli),
  }, signal)
  if (!fingerprint) throw changedSource()
  return fingerprint
}

/** Only one catalog operation may share its native account/model projection.
 * End-session, range exit and private cleanup precede every consumer. A fresh
 * source proof after leaving the scope rejects concurrent logout/routing changes. */
export async function withQoderCatalogSnapshot<T>(
  backend: ProcessBackend, config: RuntimeConfig, executable: string, cwd: string,
  signal: AbortSignal, operation: () => Promise<T>, cli: QoderCliId = 'qoder',
): Promise<T> {
  const before = await qoderMetadataSource(executable, cwd, config, signal, cli)
  const scope: QoderCatalogScope = { cli, backend, config, executable, cwd, signal, active: true }
  const result = await catalogSnapshots.run(scope, async () => {
    try { return await operation() }
    finally { scope.active = false; scope.reading = undefined }
  })
  signal.throwIfAborted()
  if (before !== await qoderMetadataSource(executable, cwd, config, signal, cli)) throw changedSource()
  return result
}

async function scopedMetadata(backend: ProcessBackend, config: RuntimeConfig, executable: string, cwd: string, signal: AbortSignal, cli: QoderCliId) {
  const scope = catalogSnapshots.getStore()
  if (!scope?.active || scope.cli !== cli || scope.backend !== backend || scope.config !== config || scope.executable !== executable || scope.cwd !== cwd || scope.signal !== signal) return undefined
  const reading = scope.reading ??= queryQoderMetadata(backend, config, executable, cwd, signal, 'models', cli).then((value) => {
    if (!record(value) || !Array.isArray(value.models)) throw new QoderAccountError()
    return value as QoderMetadata
  })
  try {
    const value = await reading
    signal.throwIfAborted()
    return structuredClone(value)
  } catch (error) { if (scope.reading === reading) scope.reading = undefined; throw error }
}

/** These are separate native authentication/routing protocols, not browser/PAT aliases. */
const unsupportedEnvironment = [
  'QODER_PAT', 'QODER_JOB_TOKEN', 'QODER_SERVICE_ACCOUNT_KEY', 'QODER_SDK_AUTH_PAYLOAD_FILE',
  'QODER_SDK_AUTH_CONFIG_DIR', 'QODER_CENTER_ENDPOINT', 'QODER_SERVER_ENDPOINT',
  'QODER_VPC_ENDPOINT', 'QODER_ENV_VPC_ENABLED',
]
export function qoderProjectDirectoryName(cli: QoderCliId = 'qoder'): string {
  return process.env[qoderVariant(cli).prefix + 'CONFIG_DIR_NAME']?.normalize('NFC') || '.qoder'
}
export function qoderConfigDirectory(env = process.env, cli: QoderCliId = 'qoder'): string {
  const variant = qoderVariant(cli)
  if (env.QODERCLI_SITE && env.QODERCLI_SITE !== variant.site)
    throw new QoderAccountError(`当前接入仅支持 ${variant.label}${cli === 'qoder' ? ' 国际版' : ' 中国版'} CLI，请检查原生程序`)
  const name = env[variant.prefix + 'CONFIG_DIR_NAME']?.normalize('NFC') || variant.directory
  if (basename(name) !== name || name === '.' || name === '..' || name !== name.trim() || name.endsWith('.') ||
      [...name].length > 64 || !/^[\p{L}\p{N}\p{M}._ -]+$/u.test(name) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ||
      ['.git', '.svn', '.hg', '.vscode', '.idea', '.husky', '.github', 'node_modules', 'bower_components'].includes(name.toLowerCase()))
    throw new QoderAccountError()
  return resolve(env[variant.prefix + 'CONFIG_DIR']?.trim() || join(env[variant.prefix + 'CLI_HOME']?.trim() || env.GEMINI_CLI_HOME?.trim() || homedir(), name))
}
/** Pin the selected native account root and clear the other brand's controls. */
export function qoderEnvironment(cli: QoderCliId = 'qoder'): Record<string, string> {
  const variant = qoderVariant(cli), prefix = variant.prefix
  const shared = new Set(['QODER_SDK_AUTH_PAYLOAD_FILE', 'QODER_SDK_AUTH_CONFIG_DIR'])
  if (unsupportedEnvironment.some((name) => !!process.env[shared.has(name) ? name : prefix + name.slice('QODER_'.length)]) ||
      ['ENV', 'RUNNING_ENV'].some((name) => !!process.env[prefix + name] && process.env[prefix + name] !== 'prod'))
    throw new QoderAccountError(`${variant.label} 存在尚未支持的认证或服务路由，请在原生 CLI 中检查`)
  const token = process.env[prefix + 'PERSONAL_ACCESS_TOKEN']
  if (token && !literal(token)) throw new QoderAccountError(`${variant.label} PAT 配置无效，请在原生 CLI 中检查`)
  const foreign = cli === 'qodercn' ? 'QODER_' : 'QODERCN_'
  const cleared = Object.fromEntries(Object.keys(process.env).filter(name => name.startsWith(foreign)).map(name => [name, '']))
  return {
    ...cleared,
    QODERCLI_SITE: variant.site,
    [prefix + 'CONFIG_DIR']: qoderConfigDirectory(process.env, cli),
    [prefix + 'WORKING_DIR']: '', [prefix + 'SESSION_ID']: '', [prefix + 'SESSION_NAME']: '', [prefix + 'MODEL']: '', GEMINI_MODEL: '',
    [prefix + 'PERSONAL_ACCESS_TOKEN']: token || '',
    QODER_AGENT_SDK_ENTRYPOINT: '', QODER_AGENT_SDK_VERSION: '', QODER_AGENT_SDK_DAEMON: '',
    QODER_SDK_AUTH_PAYLOAD_FILE: '', QODER_SDK_AUTH_CONFIG_DIR: '',
  }
}

/** Stable no-follow reads. Native account files are never created, refreshed or rewritten here. */
async function read(path: string, signal: AbortSignal, limit = 1024 * 1024, account = true) {
  signal.throwIfAborted()
  let file: Awaited<ReturnType<typeof open>> | undefined, bytes: Buffer | undefined
  try {
    await safePiOmpAncestors(dirname(path))
    const entry = await lstat(path)
    if (!entry.isFile() || entry.isSymbolicLink() || (account && entry.nlink !== 1)) throw new QoderAccountError()
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const before = await file.stat()
    if (!before.isFile() || (account && before.nlink !== 1) || before.dev !== entry.dev || before.ino !== entry.ino || before.size > limit)
      throw new QoderAccountError()
    bytes = Buffer.alloc(before.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      signal.throwIfAborted()
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    const after = await file.stat(), current = await lstat(path)
    if (current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino ||
        (account && current.nlink !== 1) || offset !== before.size || after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs || current.size !== after.size || current.mtimeMs !== after.mtimeMs)
      throw new QoderAccountError()
    signal.throwIfAborted()
    return bytes.subarray(0, offset).toString('utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  } finally {
    bytes?.fill(0)
    await file?.close()
  }
}

/** Native dotenv chooses project first, then user, and may supply authentication
 * or routing absent from the Host environment. Do not bind a different principal
 * by silently masking those declarations in the SDK metadata child. */
async function checkQoderDotEnv(directory: string, cwd: string | undefined, signal: AbortSignal, cli: QoderCliId) {
  const name = qoderProjectDirectoryName(cli)
  const project = cwd ? await read(join(cwd, name, '.env'), signal) : undefined
  const raw = project ?? await read(join(directory, '.env'), signal)
  if (raw !== undefined && /(?:^|\n)\s*(?:export\s+)?(?:QODER(?:CLI|CN)?_[A-Za-z0-9_]*|GEMINI_CLI_HOME|GEMINI_MODEL)\s*(?:=|:)/im.test(raw))
    throw new QoderAccountError('Qoder .env 含尚未绑定的认证或运行控制变量，请在原生配置中确认来源')
}

/** Native G8o/MNu migrations write Project/Local sources during load. Refuse
 * their legacy inputs instead of permitting a read-only query to migrate them. */
async function checkQoderProjectSettings(cwd: string, signal: AbortSignal, cli: QoderCliId) {
  const name = qoderProjectDirectoryName(cli)
  for (const file of ['settings.json', 'settings.local.json']) {
    const raw = await read(join(cwd, name, file), signal)
    if (raw === undefined) continue
    const value: unknown = parseNativeJsonc(raw)
    if (!record(value)) throw new QoderAccountError()
    const legacy = typeof value.general?.disableAutoUpdate === 'boolean' ||
      typeof value.general?.disableUpdateNag === 'boolean' ||
      typeof value.ui?.accessibility?.disableLoadingPhrases === 'boolean' ||
      value.ui?.accessibility?.enableLoadingPhrases === false && value.ui?.loadingPhrases === undefined ||
      typeof value.context?.fileFiltering?.disableFuzzySearch === 'boolean' ||
      value.tools?.approvalMode !== undefined ||
      ['reasoningEffort', 'contextWindow', 'functionSwitchSelections'].some((key) => value.model?.[key] !== undefined) ||
      record(value.model?.preferences) && Object.values(value.model.preferences).some((item) => record(item) && item.generation !== undefined)
    if (legacy) throw new QoderAccountError('Qoder 项目设置需要原生迁移，请先在原生 CLI 打开该项目后重试')
  }
}

/** Copy only native routing inputs. Auth remains in its original read-only root;
 * default-model caches, histories and locks are always private to this query. */
async function copyQoderMetadataSettings(source: string, target: string, signal: AbortSignal) {
  const copy = async (parts: string[]) => {
    const raw = await read(join(source, ...parts), signal)
    if (raw === undefined) return
    const destination = join(target, ...parts)
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    await writeFile(destination, raw, { flag: 'wx', mode: 0o600 })
  }
  await copy(['settings.json'])
  await copy(['.env'])
  const models = join(source, '.models')
  try {
    await safePiOmpAncestors(models)
    const info = await lstat(models)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new QoderAccountError()
    const entries = await readdir(models, { withFileTypes: true })
    if (entries.some((item) => item.isSymbolicLink()) || entries.length > 256) throw new QoderAccountError('Qoder 本地自定义模型目录超过可验证范围或包含不安全链接')
    for (const entry of entries) if (entry.isDirectory()) await copy(['.models', entry.name, 'customs'])
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}

type MetadataProtocol = 'worker' | 'daemon'
class QoderProtocolUnsupportedError extends QoderAccountError {
  constructor(kind: 'account' | 'models') {
    super(`${kind === 'models' ? 'Qoder 原生模型目录暂不可用' : 'Qoder 原生账号查询暂不可用'}：插件尚未适配此 Qoder 版本的元数据协议`)
  }
}

/** Read the selected entry without executing a version/updater dispatcher. */
async function metadataProtocol(executable: string, cli: QoderCliId, signal: AbortSignal): Promise<MetadataProtocol> {
  signal.throwIfAborted()
  const variant = qoderVariant(cli)
  let version: string | undefined
  try {
    const target = await realpath(resolveNativeEntry(await realpath(executable)))
    const nativeRoot = await realpath(join(homedir(), variant.directory, 'bin', variant.executable)).catch(() => '')
    if (dirname(target) === nativeRoot)
      version = new RegExp(`^${variant.executable}-(\\d+\\.\\d+\\.\\d+)(?:\\.exe)?$`).exec(basename(target))?.[1]
    if (!version) for (let dir = dirname(target), depth = 0; depth < 7; dir = dirname(dir), depth++) {
      const raw = await read(join(dir, 'package.json'), signal, 128 * 1024, false)
      if (raw === undefined) continue
      const pkg: unknown = JSON.parse(raw)
      if (record(pkg) && pkg.name === variant.package && typeof pkg.version === 'string') version = pkg.version
      break
    }
  } catch { signal.throwIfAborted() }
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '')?.slice(1).map(Number)
  return parts && (parts[0]! > 1 || parts[0] === 1 && (parts[1]! > 1 || parts[1] === 1 && parts[2]! > 80)) ? 'daemon' : 'worker'
}

async function queryQoderMetadata(backend: ProcessBackend, config: RuntimeConfig, executable: string, cwd: string, signal: AbortSignal, kind: 'account' | 'models', cli: QoderCliId): Promise<unknown> {
  const control = AbortSignal.any([signal, AbortSignal.timeout(kind === 'models' ? 30_000 : 15_000)])
  const protocol = await metadataProtocol(executable, cli, control)
  try { return await queryQoderMetadataAttempt(backend, config, executable, cwd, control, kind, cli, protocol) }
  catch (error) {
    if (error instanceof ProcessCleanupUnconfirmedError) throw error
    if (control.aborted || !(error instanceof QoderProtocolUnsupportedError)) throw error
    // The attempt only rejects after range exit and private-directory cleanup.
    return queryQoderMetadataAttempt(backend, config, executable, cwd, control, kind, cli, protocol === 'worker' ? 'daemon' : 'worker')
  }
}

/** Same installed CLI's SDK control protocol, without a prompt or SDK dependency.
 * qodercli is native readOnly/none; accessToken is native memoryOnly/none. */
async function queryQoderMetadataAttempt(backend: ProcessBackend, config: RuntimeConfig, executable: string, cwd: string, signal: AbortSignal, kind: 'account' | 'models', cli: QoderCliId, protocol: MetadataProtocol): Promise<unknown> {
  signal.throwIfAborted()
  const env = qoderEnvironment(cli)
  await checkQoderDotEnv(env[qoderVariant(cli).prefix + 'CONFIG_DIR']!, cwd, signal, cli)
  await checkQoderProjectSettings(cwd, signal, cli)
  // Native telemetry also asks for a machine ID even in readOnly auth mode.
  // An incomplete browser store must be repaired by the user in the native CLI.
  if (!env[qoderVariant(cli).prefix + 'PERSONAL_ACCESS_TOKEN'] && !(await read(join(env[qoderVariant(cli).prefix + 'CONFIG_DIR']!, '.auth', 'machine_id'), signal))?.trim())
    throw new QoderAccountError('Qoder 原生登录机器标识缺失，请在原生 CLI 检查登录')
  const root = await mkdtemp(join(tmpdir(), `cliworker-${cli}-metadata-`))
  const payload = join(root, 'auth.json')
  let cleanupConfirmed = true
  try {
    await copyQoderMetadataSettings(env[qoderVariant(cli).prefix + 'CONFIG_DIR']!, root, signal)
    if (env[qoderVariant(cli).prefix + 'PERSONAL_ACCESS_TOKEN']) {
      // memoryOnly auth still creates a machine ID for token exchange. Keep that
      // write private, preserving an existing ID only for native customs decryption.
      const machine = await read(join(env[qoderVariant(cli).prefix + 'CONFIG_DIR']!, '.auth', 'machine_id'), signal)
      if (machine !== undefined) {
        await mkdir(join(root, '.auth'), { mode: 0o700 })
        await writeFile(join(root, '.auth', 'machine_id'), machine, { flag: 'wx', mode: 0o600 })
      }
    }
    const auth = env[qoderVariant(cli).prefix + 'PERSONAL_ACCESS_TOKEN']
      ? { type: 'accessToken', accessToken: env[qoderVariant(cli).prefix + 'PERSONAL_ACCESS_TOKEN'] } : { type: 'qodercli' }
    await writeFile(payload, JSON.stringify(auth), { flag: 'wx', mode: 0o600 })
    const control = signal, daemon = protocol === 'daemon'
    control.throwIfAborted()
    const child = backend.spawn({
      argv: nativeLaunchArgv(daemon ? [executable, '--sdk'] : [executable, '--print', '--input-format', 'stream-json', '--output-format', 'stream-json',
        '--no-session-persistence', '--tools', '', '--disable-builtin-skills', '--permission-mode', 'default',
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--settings',
        '{"disableAllHooks":true,"general":{"enableAutoUpdate":false},"aiCodeTracking":{"installGitCommitHook":false}}']),
      cwd, env: { ...env, [qoderVariant(cli).prefix + 'CONFIG_DIR']: root, QODER_SDK_AUTH_CONFIG_DIR: env[qoderVariant(cli).prefix + 'PERSONAL_ACCESS_TOKEN'] ? root : env[qoderVariant(cli).prefix + 'CONFIG_DIR']!,
        [qoderVariant(cli).prefix + 'PERSONAL_ACCESS_TOKEN']: '', QODER_AGENT_SDK_ENTRYPOINT: 'sdk-ts', QODER_AGENT_SDK_VERSION: daemon ? '1.0.59' : '1.0.53',
        QODER_AGENT_SDK_DAEMON: daemon ? '1' : '',
        QODER_SDK_AUTH_PAYLOAD_FILE: payload, QODER_SDK_CUSTOM_BASE_URL_BYOK: '1' },
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }, signal: control, graceMs: config.graceMs,
    })
    let unsupported = false, initializedProtocol = false, diagnosticTail = '', failureDetail = ''
    const failure = () => unsupported && !initializedProtocol ? new QoderProtocolUnsupportedError(kind) : new QoderAccountError((kind === 'models'
      ? 'Qoder 原生模型目录暂不可用，请在原生 CLI 检查登录和网络'
      : 'Qoder 原生账号查询暂不可用，请在原生 CLI 中检查登录') + failureDetail)
    const pending = new Map<string, { type: string; resolve: (value: any) => void; reject: (error: Error) => void }>()
    let bytes = 0, buffer = '', issue: Error | undefined, anonymous = false
    let endAcknowledged = false, exitObserved = false, ownedTermination = false
    const fail = () => { issue ??= failure(); for (const item of pending.values()) item.reject(issue); pending.clear() }
    const cancel = () => { fail(); try { child.terminate() } catch { cleanupConfirmed = false } }
    const inputError = () => fail()
    child.stdin?.on('error', inputError)
    control.addEventListener('abort', cancel, { once: true })
    const request = (type: string, params: Record<string, unknown> = {}): Promise<any> => {
      control.throwIfAborted()
      if (issue) return Promise.reject(issue)
      return new Promise((resolve, reject) => {
        const id = randomUUID(); pending.set(id, { type, resolve, reject })
        if (!child.stdin?.writable || child.stdin.destroyed) { fail(); return }
        child.stdin.write(JSON.stringify({ type: 'control_request', request_id: id, request: daemon ? { ...params, type: `daemon.${type}` } : { ...params, type, subtype: type } }) + '\n', (error) => { if (error) fail() })
      })
    }
    const consume = async (stream: typeof child.stdout, stdout: boolean) => {
      const decoder = new StringDecoder('utf8')
      if (stream) for await (const chunk of stream) {
        bytes += Buffer.byteLength(chunk)
        if (bytes > Math.min(config.maxRunBytes, 4 * 1024 * 1024)) throw failure()
        if (!stdout) {
          // Match only fixed protocol diagnostics, never return raw stderr.
          diagnosticTail += String(chunk)
          if (!initializedProtocol && (protocol === 'worker' && diagnosticTail.includes('sdk_worker_removed') ||
              daemon && /(?:unknown|unrecognized|unexpected|unsupported) (?:option|argument)[^\r\n]{0,80}--sdk/i.test(diagnosticTail))) unsupported = true
          diagnosticTail = diagnosticTail.slice(-1024)
          continue
        }
        buffer += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        if (Buffer.byteLength(buffer) > config.maxLineBytes && !buffer.includes('\n')) throw failure()
        let index: number
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
          if (!line.trim()) continue
          if (Buffer.byteLength(line) > config.maxLineBytes) throw failure()
          const value: unknown = JSON.parse(line)
          if (!record(value) || daemon && value.session_id !== undefined) throw failure()
          if (value.type === 'control_response' && pending.has(value.response?.request_id)) {
            const item = pending.get(value.response.request_id)!; pending.delete(value.response.request_id)
            if (value.response.subtype !== 'success') {
              if (!initializedProtocol && value.response.code === 'sdk_worker_removed') unsupported = true
              const reasons: Record<string, string> = {
                AUTH_REQUIRED: '原生账号未认证', AUTH_PAYLOAD_REQUIRED: '原生认证来源未就绪',
                PROTOCOL_VERSION_UNSUPPORTED: '插件尚未适配此 Qoder 版本的元数据协议',
                METHOD_NOT_FOUND: '插件尚未适配此 Qoder 版本的元数据请求',
                DAEMON_COMMAND_FAILED: '原生 daemon 命令失败',
              }
              if (typeof value.response.code === 'string' && Object.hasOwn(reasons, value.response.code)) failureDetail = `（${reasons[value.response.code]}）`
              fail(); item.reject(failure()); continue
            }
            if (item.type === (daemon ? 'shutdown' : 'end_session')) endAcknowledged = true
            item.resolve(value.response.response ?? {})
          } else if (!daemon && value.type === 'result' && value.terminal_reason === 'auth_required') {
            anonymous = true; for (const item of pending.values()) item.resolve(null); pending.clear()
          } else if (value.type === 'control_request' || value.type === 'protocol_error') throw failure()
        }
      }
      if (stdout) { buffer += decoder.end(); if (buffer.trim()) throw failure() }
    }
    const readers = [consume(child.stdout, true), consume(child.stderr, false)]
    for (const reader of readers) void reader.catch(cancel)
    const completion = child.done.then(async (outcome) => {
      exitObserved = true
      const terminatedHere = ownedTermination
      // Drain the final auth_required/end_session frame before classifying a natural exit.
      await Promise.allSettled(readers)
      if (!initializedProtocol && !daemon && outcome.exitCode === 42 && !control.aborted) unsupported = true
      if (anonymous) {
        if (outcome.exitCode !== 41 && outcome.exitCode !== 0 || outcome.signal != null) fail()
        return
      }
      // Qoder 1.1.73 catches SIGTERM and explicitly exits 143. Accept this only
      // after a successful end_session and our own normal termination request.
      const ownedSignalExit = terminatedHere && (outcome.signal === 'SIGTERM' || outcome.signal === 'SIGKILL' ||
        outcome.exitCode === 143 && outcome.signal == null ||
        // The official Windows subprocess runner uses TerminateJobObject(1),
        // not a POSIX signal. A natural code 1, canceled request or failed
        // end_session never acquires this owned-termination proof.
        process.platform === 'win32' && outcome.exitCode === 1 && outcome.signal == null)
      if (!endAcknowledged || control.aborted || outcome.exitCode !== 0 && !ownedSignalExit || outcome.signal != null && !ownedSignalExit) fail()
    }, fail)
    try {
      if (daemon) {
        const handshake = await request('initialize', { daemon_protocol_version: 2, sdk_version: '1.0.59',
          capabilities: ['multi_session_v2', 'daemon_queries_v1'], auth })
        if (handshake?.daemon_protocol_version !== 2 || !text(handshake.daemon_version) ||
            !Array.isArray(handshake.capabilities) || !['multi_session_v2', 'daemon_queries_v1'].every(capability => handshake.capabilities.includes(capability))) {
          failureDetail = '（插件尚未适配此 Qoder 版本的握手能力）'
          throw failure()
        }
        initializedProtocol = true
        try {
          const result = await request('account_info')
          if (!record(result?.account)) throw failure()
          if (!text(result.account.userId)) return null
          if (kind === 'account') return result.account
          const models = await request('get_models', { fetchStrategy: 'live', uid: result.account.userId })
          return { models: parseQoderModelState(models, qoderVariant(cli).label), account: {
            userId: result.account.userId, email: result.account.email, organization: result.account.organization,
          } }
        } finally { await request('shutdown') }
      }
      const initialized = await request('initialize', { supportsCatalogReadyInitialize: kind === 'models', skills: [] })
      initializedProtocol = true
      if (anonymous) return null
      try {
        if (kind === 'models') return { models: parseQoderModelState(initialized, qoderVariant(cli).label),
          account: record(initialized?.account) ? { userId: initialized.account.userId,
            email: initialized.account.email, organization: initialized.account.organization } : null }
        const result = await request('account_info')
        if (anonymous) return null
        if (!record(result) || !record(result.account)) throw failure()
        return result.account
      } finally { if (!anonymous) await request('end_session') }
    } finally {
      control.removeEventListener('abort', cancel)
      try {
        try {
          ownedTermination = endAcknowledged && !issue && !control.aborted && !exitObserved
          child.terminate()
          if (!(await child.waitForExit())) throw new ProcessCleanupUnconfirmedError()
        } catch { cleanupConfirmed = false; throw new ProcessCleanupUnconfirmedError() }
        const settled = await Promise.allSettled([child.done, completion, ...readers])
        buffer = ''; diagnosticTail = ''
        if (issue || control.aborted || settled.some((value) => value.status === 'rejected')) throw failure()
      } finally { child.stdin?.removeListener('error', inputError) }
    }
  } finally {
    if (cleanupConfirmed) await rm(root, { recursive: true, force: true })
  }
}
export async function queryQoderAccountInfo(backend: ProcessBackend, config: RuntimeConfig, executable: string, cwd: string, signal: AbortSignal, cli: QoderCliId = 'qoder'): Promise<unknown> {
  const snapshot = await scopedMetadata(backend, config, executable, cwd, signal, cli)
  if (snapshot) return snapshot.account
  return queryQoderMetadata(backend, config, executable, cwd, signal, 'account', cli)
}

interface QoderAccountOptions {
  cli?: QoderCliId
  directory?: string
  project?: string
  backend?: ProcessBackend
  config?: RuntimeConfig
  /** Synthetic metadata injection for local tests; production queries the official control protocol. */
  query?: () => Promise<unknown> | unknown
}
async function accountMaterial(executable: string, signal: AbortSignal, options: QoderAccountOptions = {}) {
  const cli = options.cli ?? 'qoder'
  const env = qoderEnvironment(cli), directory = options.directory ?? env[qoderVariant(cli).prefix + 'CONFIG_DIR']!
  await checkQoderDotEnv(directory, options.project, signal, cli)
  if (env[qoderVariant(cli).prefix + 'PERSONAL_ACCESS_TOKEN']) return {
    sourceIds: [directory, `environment:${qoderVariant(cli).prefix}PERSONAL_ACCESS_TOKEN`],
    entries: [{ provider: cli, principal: { kind: 'pat', key: hash(env[qoderVariant(cli).prefix + 'PERSONAL_ACCESS_TOKEN']) } }],
    identity: { state: 'configured', verification: 'local', authMethod: 'api', summary: `已配置 ${qoderVariant(cli).label} PAT，待原生目录验证` } as AccountIdentity,
  }
  const encrypted = await read(join(directory, '.auth/user'), signal)
  if (!encrypted?.trim()) return {
    sourceIds: [directory], entries: [],
    identity: { state: 'unconfigured', verification: 'local', summary: `尚未登录 ${qoderVariant(cli).label}` } as AccountIdentity,
  }
  let value: unknown = options.query ? await options.query() :
    options.backend && options.config && options.project
      ? await queryQoderAccountInfo(options.backend, options.config, executable, options.project, signal, cli)
      : undefined
  signal.throwIfAborted()
  try {
    if (value === null) return {
      sourceIds: [directory], entries: [],
      identity: { state: 'unauthenticated', verification: 'cli', summary: `${qoderVariant(cli).label} 登录不可用，请在原生 CLI 中重新登录` } as AccountIdentity,
    }
    if (!record(value) || !text(value.userId)) throw new QoderAccountError()
    const email = accountEmail(value.email)
    return {
      sourceIds: [directory, `native:${cli}-account-info`],
      entries: [{ provider: cli, principal: { kind: 'native-login', uid: value.userId,
        organization: text(value.organization) ? value.organization : undefined } }],
      identity: { state: 'authenticated', verification: 'cli', summary: `${qoderVariant(cli).label} 原生登录已确认`,
        ...(email ? { accountLabel: email } : {}) } as AccountIdentity,
    }
  } finally { value = undefined }
}
export async function readQoderAccount(executable: string, signal: AbortSignal, options: QoderAccountOptions = {}): Promise<AccountIdentity> {
  try { return (await accountMaterial(executable, signal, options)).identity }
  catch (error) {
    if (error instanceof ProcessCleanupUnconfirmedError) throw error
    signal.throwIfAborted()
    return { state: 'unavailable', verification: 'local', summary: error instanceof QoderAccountError ? error.message : 'Qoder 登录状态读取失败，请检查原生配置' }
  }
}
/** Host-only stable principal; native access/refresh rotation never changes this binding. */
export async function readQoderAccountBindingMaterial(executable: string, signal: AbortSignal, options: QoderAccountOptions = {}) {
  const { sourceIds, entries } = await accountMaterial(executable, signal, options)
  if (!entries.length) throw new QoderAccountError()
  const cli = options.cli ?? 'qoder'
  const directory = options.directory ?? qoderConfigDirectory(process.env, cli)
  const selected = entries[0]!.principal
  const routing = await qoderRouting(directory, options.project, signal, cli)
  let uid = 'uid' in selected && text(selected.uid) ? selected.uid : undefined
  const models = join(directory, '.models')
  try {
    await safePiOmpAncestors(models)
    const info = await lstat(models)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new QoderAccountError()
    // The SDK qodercli read-only strategy selects the saved browser login, not an ambient PAT.
    // A PAT therefore binds a conservative digest of this CLI's local customs stores, never a different browser principal.
    const discovered = uid ? [] : await readdir(models, { withFileTypes: true })
    if (discovered.some((item) => item.isSymbolicLink())) throw new QoderAccountError()
    const slots = uid ? [basename(uid).replace(/^\.+/, '') || 'anon'] : discovered.filter((item) => item.isDirectory()).map((item) => item.name)
    if (slots.length > 256) throw new QoderAccountError('Qoder 本地自定义模型目录超过可验证范围')
    for (const slot of slots.sort()) {
      const path = join(models, slot, 'customs')
      const raw = await read(path, signal)
      // Native startup may create .models for its catalog cache without any
      // custom route. An absent customs file is the same route before/after it.
      if (raw !== undefined) routing.push({ source: path, fingerprint: hash(raw) })
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return { sourceIds, entries: entries.map((entry) => ({ ...entry, route: routing })) }
}

/** Bind all native provider inputs conservatively; higher-priority project/local declarations cannot escape the epoch.
 * Custom-model secret values remain ephemeral and only a digest crosses this Host-private boundary. */
async function qoderRouting(directory: string, project: string | undefined, signal: AbortSignal, cli: QoderCliId) {
  const name = qoderProjectDirectoryName(cli)
  const paths = [join(directory, 'settings.json'), ...(project ? [join(project, name, 'settings.json'), join(project, name, 'settings.local.json')] : [])]
  const routes: { source: string; fingerprint: string }[] = []
  for (const path of paths) {
    const raw = await read(path, signal)
    if (raw === undefined) { routes.push({ source: path, fingerprint: 'absent' }); continue }
    const config: unknown = parseNativeJsonc(raw)
    if (!record(config)) throw new QoderAccountError()
    const auth = config.security?.auth
    if (auth !== undefined && (!record(auth) || auth.useExternal === true ||
        [auth.selectedType, auth.enforcedType].some((value) => value && !['qoder-browser', 'qoder-pat'].includes(value))))
      throw new QoderAccountError('Qoder 当前认证设置不受支持，请检查原生账号配置')
    const routing = { providers: config.providers, modelConfigs: config.modelConfigs, auth }
    const serialized = JSON.stringify(routing)
    if (/\$\{?|%[A-Za-z_][A-Za-z0-9_]*%|op:\/\//.test(serialized))
      throw new QoderAccountError('Qoder 自定义模型使用动态凭据或路由引用，当前无法确认来源')
    routes.push({ source: path, fingerprint: hash(serialized) })
  }
  return routes
}

export const QODER_METADATA_ARGUMENTS = [
  '--acp', '--permission-mode', 'default', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
  '--settings', '{"disableAllHooks":true,"general":{"enableAutoUpdate":false},"aiCodeTracking":{"installGitCommitHook":false}}',
]
export const qoderAllModelsDisabled = (label: string, count: number) =>
  `${label} 返回的 ${count} 个模型在当前账号下均为停用状态，暂无可选模型；请在 ${label} 中确认账号额度或套餐后刷新`
/** Official SDK initialize.models. BHs always exposes isEnabled; disabled SDK
 * entries must not become selectable because ACP getAvailableModels filters them. */
export function parseQoderModelState(state: unknown, label = 'Qoder'): ModelChoice[] {
  if (!record(state) || !Array.isArray(state.models) || state.models.length > 4096) throw new QoderAccountError('Qoder 未公开结构化模型目录')
  const models = new Map<string, ModelChoice>()
  for (const model of state.models) {
    if (!record(model) || !text(model.value) || model.value.length > 512 || !text(model.displayName) || model.displayName.length > 512 ||
        typeof model.isEnabled !== 'boolean' || model.efforts !== undefined && (!Array.isArray(model.efforts) || !model.efforts.every(text)) ||
        model.supportsDisabled !== undefined && typeof model.supportsDisabled !== 'boolean') throw new QoderAccountError('Qoder 模型目录格式不受支持')
    if (!model.isEnabled) continue
    const advertised = new Set<string>(model.efforts ?? [])
    if (model.supportsDisabled === true) advertised.add('none')
    models.set(model.value, { id: model.value, label: model.displayName,
      efforts: ['default', ...EFFORTS.filter((effort) => effort !== 'default' && advertised.has(effort))] as Effort[] })
  }
  // Every entry disabled is the account's answer, not a missing catalog: say so with the count.
  if (!models.size && state.models.length) throw new QoderAccountError(qoderAllModelsDisabled(label, state.models.length))
  if (!models.size) throw new QoderAccountError('Qoder 未公开可用的结构化模型目录')
  return [...models.values()]
}
/** Metadata only: never authenticate, prompt, select a model or create a persisted session. */
export async function discoverQoderModels(backend: ProcessBackend, config: RuntimeConfig, executable: string, cwd: string, signal: AbortSignal, cli: QoderCliId = 'qoder'): Promise<ModelChoice[]> {
  const result = await scopedMetadata(backend, config, executable, cwd, signal, cli) ??
    await queryQoderMetadata(backend, config, executable, cwd, signal, 'models', cli)
  if (!record(result) || !Array.isArray(result.models)) throw new QoderAccountError('Qoder 原生模型目录暂不可用，请在原生 CLI 检查登录和网络')
  return result.models
}
