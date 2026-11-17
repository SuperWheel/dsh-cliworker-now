import { createZCodeCredentialReader, decodeZCodeLegacyCredentials, ZCodeCredentialError, type ZCodeCredentialOptions, type ZCodeCredentialReader } from './zcode-credentials.ts'
import { spawnProbe } from './probe-process.ts'
import { chmod, lstat, mkdir, open, realpath } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { stripVTControlCharacters } from 'node:util'
import { fileURLToPath } from 'node:url'
import type { AccountAction, ZCodeLoginProvider } from '../shared/accounts.ts'
import { accountEmail, localTokenExpired, type AccountIdentity } from './account-identity.ts'
import type { AccountLogin } from '../shared/accounts.ts'
import { ProcessCleanupUnconfirmedError, type ProcessBackend, type RuntimeConfig } from './process.ts'
import { readZCodePersonalIdentity, zcodeAuthDirectory, zcodeEnvironment } from './zcode-adapter.ts'
import { zcodeProviderLogins, zcodeProviderTarget } from './zcode-custom-provider.ts'
import { assertGrokNativeEnvironment, selectGrokOwnAccount } from './grok-models.ts'
import { grokRenewalRejected } from './grok-renewal.ts'

export type ZCodeGrokCli = 'zcode' | 'grok'
export interface ZCodeGrokAccountLaunch {
  argv: string[]
  env: Record<string, string>
  cwd: string
  instruction: string
}

/** Safe to show in the UI; never constructed from native CLI output. */
export class ZCodeAccountCapabilityError extends Error {}

// Set umask in a dedicated child, never in the shared Harness Host process.
const privateArgv = (argv: string[]) => [
  process.execPath,
  fileURLToPath(new URL('./private-launch.mjs', import.meta.url)),
  ...argv,
]

export function zcodeGrokInstruction(cli: ZCodeGrokCli, action: AccountAction): string {
  if (cli === 'zcode') {
    if (action === 'login')
      return '按当前 ZCode 原生能力完成授权；终端会注明使用 Z.AI 或 BigModel。此账号供本插件的 ZCode 任务使用。'
    if (action === 'logout') return '此操作会退出该独立配置中的 Z.AI 和 BigModel Coding Plan 账号。'
    return '在 ZCode 原生终端输入 /login 或 /logout 管理账号。'
  }
  if (action === 'login') return '按 Grok 原生提示完成浏览器授权；使用 Grok 本机账号，插件任务读取同一账号。'
  if (action === 'logout') return '按 Grok 原生流程退出本机账号；其他使用该 Grok 账号的终端也将受到影响。'
  return '在 Grok 原生终端管理账号。'
}

function storageRoot(config: RuntimeConfig, home: string): string {
  return config.stateDirectory ?? join(process.env.DSH_HOME ?? join(home, '.dsh'), 'cliworker-now')
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim()

/** Synchronous legacy projection retained for existing callers and fixtures. */
export function projectZCodeIdentity(raw: unknown, secret: string): AccountIdentity {
  return projectDecodedZCodeIdentity(decodeZCodeLegacyCredentials(raw, secret))
}
function projectDecodedZCodeIdentity(raw: Record<string, string>): AccountIdentity {
  const decode = (value: unknown): string => typeof value === 'string' ? value : ''
  const provider = decode(raw['oauth:active_provider']).trim()
  const userInfo = (family: string): Record<string, unknown> | undefined => {
    try {
      const info: unknown = JSON.parse(decode(raw[`oauth:${family}:user_info`]))
      return record(info) ? info : undefined
    } catch (error) {
      if (error instanceof ZCodeCredentialError) throw error
      return undefined
    }
  }
  const label = (info: Record<string, unknown> | undefined): string | undefined => {
    const profile = record(info?.rawProfile) ? info.rawProfile : undefined
    const email = accountEmail(profile?.email) || accountEmail(info?.email) || accountEmail(info?.username)
    const name = info?.displayName
    const display =
      typeof name === 'string' && name.length <= 80 && !/[\p{C}<>]|(?:Bearer|sk-|enc:v1:)/iu.test(name)
        ? name.trim()
        : undefined
    return email || display || undefined
  }
  let bound = false
  let apiBinding = false
  for (const family of ['bigmodel', 'zai']) {
    const nativeProvider = `account:${family}-individual-coding-plan`
    const identity = decode(raw[`account-provider:${nativeProvider}:identity`]).trim()
    if (!identity) continue
    const apiKey = decode(
      raw[`account-provider:coding-plan:${nativeProvider}:account:${encodeURIComponent(identity)}:api-key`],
    ).trim()
    const authSource = decode(raw[`account-provider:${nativeProvider}:auth-source`])
    const oauth = authSource === 'oauth' || !authSource && !!decode(raw[`oauth:${family}:access_token`]).trim() && !/^key-[a-f0-9]{24}$/.test(identity)
    if (authSource && !['oauth', 'manual'].includes(authSource))
      return { state: 'unknown', verification: 'local', summary: 'ZCode 账号授权来源未知' }
    const access = authSource === 'manual' ? '' : decode(raw[`oauth:${family}:access_token`]).trim()
    if (oauth ? !access : !apiKey) continue
    bound = true
    if (authSource === 'manual') {
      apiBinding = true
      continue
    }
    // Native API setup also persists a binding, using a fingerprint identity.
    // It remains API configuration rather than an OAuth login.
    if (/^key-[a-f0-9]{24}$/.test(identity)) {
      apiBinding ||= identity === `key-${createHash('sha256').update(apiKey).digest('hex').slice(0, 24)}`
      continue
    }
    const info = userInfo(family)
    const profile = record(info?.rawProfile) ? info.rawProfile : undefined
    const userIds = (family === 'zai' ? [info?.user_id] : [info?.id, profile?.user_id]).filter(
      (id) => id !== undefined,
    )
    if (
      (provider === family || authSource === 'oauth' && !provider) &&
      (userIds.length || authSource === 'oauth' && !info) &&
      userIds.every((id) => nonempty(id) && id.trim() === identity)
    ) {
      // 0.17.1 OAuth is identified by its stable native identity, not the legacy API key.
      return {
        state: 'authenticated',
        authMethod: 'oauth',
        verification: 'local',
        accountLabel: label(info),
        summary: '已登录 ZCode',
      }
    }
  }
  if (bound)
    return {
      state: 'configured',
      verification: 'local',
      ...(apiBinding ? { authMethod: 'api' as const } : {}),
      summary: apiBinding ? '已配置 ZCode API' : 'ZCode 账号绑定未确认，请重新登录',
    }
  if (
    !provider &&
    Object.keys(raw).some((name) => {
      const match = /^account-provider:(.+):identity$/.exec(name)
      return (
        match &&
        !['account:bigmodel-individual-coding-plan', 'account:zai-individual-coding-plan'].includes(
          match[1]!,
        ) &&
        nonempty(raw[name])
      )
    })
  )
    return { state: 'unknown', verification: 'local', summary: '账号类型未知' }
  if (provider !== 'bigmodel' && provider !== 'zai')
    return provider
      ? { state: 'unknown', verification: 'local', summary: '登录服务商未知' }
      : { state: 'unconfigured', verification: 'local', summary: '尚未登录 ZCode' }
  const access = decode(raw[`oauth:${provider}:access_token`])
  const refresh = decode(raw[`oauth:${provider}:refresh_token`])
  if (!access && !refresh)
    return { state: 'unauthenticated', verification: 'local', summary: '本地登录凭据已清除' }
  if (localTokenExpired(access))
    return {
      state: 'unauthenticated',
      verification: 'local',
      authMethod: 'oauth',
      summary: '登录已过期，请重新登录',
    }
  return {
    state: 'configured',
    authMethod: 'oauth',
    verification: 'local',
    accountLabel: label(userInfo(provider)),
    summary: access ? 'ZCode 登录凭据已保存，账号绑定未确认，请重新登录' : '已保存 ZCode 续期凭据',
  }
}

/** Distinct, content-free reasons; none of them claims the user never logged in. */
function grokReadFailure(error: unknown): AccountIdentity {
  if (error instanceof SyntaxError) return { state: 'unknown', verification: 'local', summary: 'Grok 凭据格式不受支持' }
  const message = error instanceof Error ? error.message : ''
  if (/^(Invalid account (directory|file)|Account file (changed during read|too large))$/.test(message))
    return { state: 'unavailable', verification: 'local', summary: 'Grok 凭据文件未通过安全检查' }
  return { state: 'unavailable', verification: 'local', summary: 'Grok 凭据读取失败，请刷新' }
}
export function projectGrokIdentity(raw: unknown, now = Date.now(), activeOnly = false): AccountIdentity {
  if (!record(raw)) throw new Error('Invalid account metadata')
  const account = selectGrokOwnAccount(raw, now)
  if (account && (account.active || !activeOnly && account.refresh)) {
    return {
      state: 'authenticated',
      authMethod: 'oauth',
      verification: 'local',
      accountLabel: account.email,
      summary: '已登录 Grok',
    }
  }
  return {
    state: account ? 'unauthenticated' : Object.keys(raw).length ? 'unknown' : 'unconfigured',
    verification: 'local',
    summary: account ? '登录已过期，请重新登录' : Object.keys(raw).length ? '登录格式未知' : '尚未登录 Grok',
  }
}

/**
 * ZCode keeps the BigModel / Z.AI login and the user's own API-key providers side by side. When any
 * API-key provider exists the account window lists each one; the login (if any) keeps its own row.
 * An expired login does not hide working keys: the state becomes `configured` and the summary says both.
 */
export function withZCodeProviderRows(identity: AccountIdentity, rows: AccountLogin[]): AccountIdentity {
  if (!rows.length || identity.state === 'unknown' || identity.state === 'unavailable') return identity
  if (identity.state === 'authenticated')
    return { ...identity, logins: [{ providerLabel: 'BigModel / Z.AI', authMethod: identity.authMethod ?? 'oauth',
      ...(identity.accountLabel ? { accountLabel: identity.accountLabel } : {}), source: 'plugin' }, ...rows] }
  return {
    state: 'configured',
    authMethod: 'api',
    verification: 'local',
    summary: identity.state === 'unauthenticated' ? `已配置 ZCode API；${identity.summary}` : '已配置 ZCode API',
    logins: rows,
  }
}
function zcodeRows(config: RuntimeConfig, home: string, nativeHome?: string): AccountLogin[] {
  try {
    return zcodeProviderLogins(zcodeProviderTarget(zcodeAuthDirectory(config.zcodeAuthDirectory, storageRoot(config, home)), nativeHome))
  } catch {
    // The identity read reports an unreadable personal configuration on its own.
    return []
  }
}

/** Bounded, no-follow local read; never returns credentials or native parse errors. */
export async function zcodeGrokAccountStatus(
  cli: ZCodeGrokCli,
  config: RuntimeConfig,
  signal: AbortSignal,
  options: ZCodeCredentialOptions & { home?: string; activeOnly?: boolean } = {},
): Promise<AccountIdentity> {
  signal.throwIfAborted()
  const home = options.home ?? homedir()
  const path =
    cli === 'zcode'
      ? join(
          zcodeAuthDirectory(config.zcodeAuthDirectory, storageRoot(config, home)),
          '.zcode/v2/credentials.json',
        )
      : join(home, '.grok/auth.json')
  let file: Awaited<ReturnType<typeof open>> | undefined
  let credentials: ZCodeCredentialReader | undefined
  const buffer = Buffer.alloc(64 * 1024 + 1)
  try {
    if (cli === 'grok') {
      assertGrokNativeEnvironment(home)
      const directory = join(home, '.grok')
      const info = await lstat(directory)
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        (await realpath(directory)) !== join(await realpath(home), '.grok')
      )
        throw new Error('Invalid account directory')
    }
    const location = await lstat(path)
    if (location.isSymbolicLink() || !location.isFile()) throw new Error('Invalid account file')
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const info = await file.stat()
    if (
      !info.isFile() ||
      info.dev !== location.dev ||
      info.ino !== location.ino ||
      info.nlink !== 1 ||
      info.size > 64 * 1024 ||
      !info.size
    )
      throw new Error('Invalid account file')
    let offset = 0
    while (offset < buffer.length) {
      signal.throwIfAborted()
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, null)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset > 64 * 1024) throw new Error('Account file too large')
    const current = await lstat(path)
    const after = await file.stat()
    if (
      current.isSymbolicLink() ||
      current.dev !== info.dev ||
      current.ino !== info.ino ||
      after.size !== info.size ||
      after.mtimeMs !== info.mtimeMs
    )
      throw new Error('Account file changed during read')
    const raw: unknown = JSON.parse(buffer.subarray(0, offset).toString('utf8'))
    signal.throwIfAborted()
    if (cli === 'zcode') credentials = await createZCodeCredentialReader(raw, path, { ...options, signal })
    const projected =
      cli === 'grok'
        ? projectGrokIdentity(raw, Date.now(), options.activeOnly)
        : undefined
    // Grok refused to renew exactly this file: show it as expired until a new login rewrites it.
    const identity =
      projected
        ? projected.state === 'authenticated' &&
          grokRenewalRejected(createHash('sha256').update(buffer.subarray(0, offset)).digest('hex'))
          ? ({
              state: 'unauthenticated',
              authMethod: 'oauth',
              verification: 'local',
              summary: 'Grok 登录已失效，请在账号终端重新登录',
            } satisfies AccountIdentity)
          : projected
        : projectDecodedZCodeIdentity(credentials!.values)
    if (cli !== 'zcode') return identity
    return withZCodeProviderRows(identity.state === 'unconfigured'
      ? readZCodePersonalIdentity(
          zcodeAuthDirectory(config.zcodeAuthDirectory, storageRoot(config, home)),
          options.home ? { nativeHome: home } : {},
        )
      : identity, zcodeRows(config, home, options.home))
  } catch (error) {
    if (error instanceof ProcessCleanupUnconfirmedError) throw error
    signal.throwIfAborted()
    if (cli === 'zcode' && error instanceof ZCodeCredentialError)
      return { state: error.state, verification: 'local', summary: error.message }
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? cli === 'zcode'
        ? withZCodeProviderRows(readZCodePersonalIdentity(
            zcodeAuthDirectory(config.zcodeAuthDirectory, storageRoot(config, home)),
            options.home ? { nativeHome: home } : {},
          ), zcodeRows(config, home, options.home))
        : { state: 'unconfigured', verification: 'local', summary: '尚未登录' }
      : cli === 'grok'
        ? grokReadFailure(error)
        : { state: 'unavailable', verification: 'local', summary: '登录配置读取失败，请重试' }
  } finally {
    credentials?.dispose()
    buffer.fill(0)
    await file?.close()
  }
}

const entryArgv = (executable: string) =>
  /\.[cm]?js$/i.test(executable) ? [process.execPath, executable] : [executable]

/** The two installed 0.16.9 builds differ; version strings alone are not a capability check. */
export function supportsBigModelLogin(help: string): boolean {
  return /^\s*login\s+\[zai\|bigmodel\]/m.test(stripVTControlCharacters(help))
}

async function privateDirectory(path: string): Promise<string> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('账号目录必须是独立的本地目录')
  await chmod(path, 0o700)
  return path
}

async function zcodeHelp(
  executable: string,
  cwd: string,
  backend: ProcessBackend,
  config: RuntimeConfig,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted()
  const control = AbortSignal.any([signal, AbortSignal.timeout(5_000)])
  const child = await spawnProbe(backend, {
    argv: [...entryArgv(executable), '--help'],
    cwd,
    env: { ELECTRON_RUN_AS_NODE: '1' },
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: config.graceMs,
    signal: control,
  })
  void child.done.catch(() => undefined)
  let output = '',
    bytes = 0
  const read = async (stream: typeof child.stdout, keep: boolean) => {
    if (!stream) return
    const decoder = new StringDecoder('utf8')
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      bytes += buffer.length
      if (bytes > 64 * 1024) throw new Error('CLI help too large')
      if (keep) output += decoder.write(buffer)
    }
    if (keep) output += decoder.end()
  }
  const readers = [read(child.stdout, true), read(child.stderr, false)]
  for (const reader of readers) void reader.catch(() => undefined)
  let cancel: () => void = () => undefined
  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => reject(new Error('CLI help cancelled'))
    control.addEventListener('abort', cancel, { once: true })
    if (control.aborted) cancel()
  })
  try {
    const [outcome] = await Promise.race([Promise.all([child.done, ...readers]), cancelled])
    control.throwIfAborted()
    if (outcome.exitCode !== 0) throw new Error('CLI help failed')
    return output
  } catch {
    signal.throwIfAborted()
    throw new ZCodeAccountCapabilityError('无法确认 ZCode 账号功能，请检查完整 CLI 安装后重试')
  } finally {
    control.removeEventListener('abort', cancel)
    child.terminate()
    if (!(await child.waitForExit())) throw new Error('ZCode 能力检查进程未完成清理')
    await Promise.allSettled([child.done, ...readers])
    output = ''
  }
}

/** Build a user-operated terminal spec. Never starts login or injects terminal input. */
export async function zcodeGrokAccountLaunch(
  cli: ZCodeGrokCli,
  action: AccountAction,
  executable: string,
  config: RuntimeConfig,
  backend: ProcessBackend,
  signal: AbortSignal,
  options: { home?: string; platform?: NodeJS.Platform; loginProvider?: ZCodeLoginProvider } = {},
): Promise<ZCodeGrokAccountLaunch> {
  signal.throwIfAborted()
  if (
    options.loginProvider !== undefined &&
    (cli !== 'zcode' || action !== 'login' || !['bigmodel', 'zai'].includes(options.loginProvider))
  )
    throw new ZCodeAccountCapabilityError('授权来源只支持 ZCode 登录时选择智谱 BigModel 或 Z.AI')
  const home = options.home ?? homedir()
  const root = storageRoot(config, home)
  const state = await privateDirectory(join(root, 'accounts', `${cli}-terminal`))
  // Native ZCode auth commands load .env from cwd/ancestors. Explicit auth/config
  // variables take precedence; a private empty cwd avoids loading the user's project.
  const cwd = await privateDirectory(join(state, 'workspace'))
  if (cli === 'grok') {
    signal.throwIfAborted()
    return {
      argv: privateArgv([executable, ...(action === 'manage' ? [] : [action])]),
      env: { GROK_HOME: join(home, '.grok'), ELECTRON_RUN_AS_NODE: '1' },
      cwd,
      instruction: zcodeGrokInstruction(cli, action),
    }
  }
  const help = await zcodeHelp(executable, cwd, backend, config, signal)
  const plainHelp = stripVTControlCharacters(help)
  const bigmodel = supportsBigModelLogin(help)
  const zai = /^\s*login\s+Sign in with Z\.AI OAuth\b/m.test(plainHelp)
  // The installed Windows opener passes the URL through cmd.exe start, which
  // truncates its native OAuth query at '&'. Keep init/poll in ZCode and let
  // the shared terminal open its complete URL without shell parsing.
  const noBrowser =
    action === 'login' &&
    (options.platform ?? platform()) === 'win32' &&
    /^\s*--no-browser\s+/m.test(plainHelp)
  if (action === 'login' && !bigmodel && !zai)
    throw new ZCodeAccountCapabilityError('当前 ZCode 未声明原生登录能力，请检查 CLI 安装')
  if (options.loginProvider === 'bigmodel' && !bigmodel)
    throw new ZCodeAccountCapabilityError(
      '当前 ZCode CLI 不支持智谱 BigModel 授权，请更新为支持 login bigmodel 的官方完整 CLI 后重试；不会改用 Z.AI 登录。',
    )
  if (action === 'manage' && !/^\s*tui\s+/m.test(plainHelp))
    throw new ZCodeAccountCapabilityError('当前 ZCode 未声明原生终端界面，请检查 CLI 安装')
  if (action === 'logout' && !/^\s*logout\s+/m.test(plainHelp))
    throw new ZCodeAccountCapabilityError('当前 ZCode 未声明原生退出登录能力，请检查 CLI 安装')
  const auth = await privateDirectory(zcodeAuthDirectory(config.zcodeAuthDirectory, root))
  let env: Record<string, string>
  try {
    env = {
      ...zcodeEnvironment(executable, state, auth, config.zcodeBuiltinConfig),
      ELECTRON_RUN_AS_NODE: '1',
    }
  } catch {
    throw new ZCodeAccountCapabilityError('ZCode 配套资源不可用，请检查 CLI 安装或配置 zcodeBuiltinConfig')
  }
  signal.throwIfAborted()
  // Preserve the previous caller's default, but an explicit choice must be
  // passed to the native provider-aware command rather than inferred from an
  // existing Desktop account. Older Z.AI-only builds ignore positional args.
  const loginProvider = options.loginProvider ?? (bigmodel ? 'bigmodel' : 'zai')
  return {
    argv: privateArgv([
      ...entryArgv(executable),
      ...(action === 'manage'
        ? ['tui']
        : action === 'login'
          ? ['login', ...(bigmodel ? [loginProvider] : []), ...(noBrowser ? ['--no-browser'] : [])]
          : ['logout']),
    ]),
    env,
    cwd,
    instruction:
      (noBrowser ? '终端显示授权链接后会打开浏览器，也可点击终端网址重新打开。' : '') +
      (action === 'login'
        ? loginProvider === 'bigmodel'
          ? '按 ZCode 原生提示完成 BigModel 授权；此账号供本插件的 ZCode 任务使用。'
          : (bigmodel ? '' : '当前 ZCode 版本的原生登录仅支持 Z.AI OAuth，不支持 BigModel 登录。') +
            '按 ZCode 原生提示完成 Z.AI 授权；此账号供本插件的 ZCode 任务使用。'
        : action === 'logout' && !bigmodel
          ? '此操作会退出该独立配置中的 Z.AI 账号。'
          : zcodeGrokInstruction(cli, action)),
  }
}
