import { setTimeout as sleep } from 'node:timers/promises'
import { AGY_GUIDES, AgyAccountGuide } from './agy-account-guide.ts'
import {
  GuideResponseError,
  type AccountChange,
  type AccountEvidence,
  type AccountGuideDriver,
  type GuideEvent,
} from './account-guide/engine.ts'
import { createAccountGuide } from './account-guide/flows.ts'
import { isLoginProvider, loginProviders, providerStores } from './account-guide/providers.ts'
import { parseAccountLoginId } from '../shared/account-links.ts'
import {
  readClaudeOwnRoute,
  readClaudeOfficialAccountRoute,
  claudeNativeSettingsArguments,
  claudeLaunchEnvironment,
  prepareClaudeWorkerLaunch,
  claudeRouteIdentity,
  ClaudeOwnRouteError,
} from './claude-own-route.ts'
import { isExtendedCli } from './extended-adapters.ts'
import { nativeAgyAccountIdentity } from './agy-windows-account.ts'
import { firstPartyEnvironment, MimoConfigurationError } from './first-party-models.ts'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { stripVTControlCharacters } from 'node:util'
import { captureCatalogMetadata, executableFor, resolveCliExecutable } from './adapters.ts'
import {
  cleanupCauseText,
  METADATA_EXIT_GRACE_MS,
  projectDirectory,
  ProcessCleanupUnconfirmedError,
  type ProcessBackend,
  type RuntimeConfig,
} from './process.ts'
import { CLI_IDS, type CliId } from '../shared/types.ts'
import type {
  AccountAction,
  AccountFrame,
  AccountResponse,
  AccountSource,
  AccountStatus,
  ZCodeLoginProvider,
} from '../shared/accounts.ts'
import {
  accountEmail,
  localAccountIdentity,
  type AccountIdentity,
  type AccountIdentitySource,
} from './account-identity.ts'
import { readCodexAccount } from './codex-account.ts'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  zcodeGrokAccountLaunch,
  zcodeGrokAccountStatus,
  zcodeGrokInstruction,
  ZCodeAccountCapabilityError,
} from './zcode-grok-accounts.ts'
import { readPiOmpAccount, readOpenCodeAccount, prepareOpenCodeAccount } from './harness-opencode-accounts.ts'
import {
  prepareHermesAccount,
  readHermesAccount,
  listHermesAccountSources,
  selectHermesNousAfterLogin,
} from './hermes-accounts.ts'
import { listPiOmpAccountSources } from './pi-omp-native.ts'
import { verifyHermesExecutable, HermesExecutableError } from './hermes-installation.ts'
import { preparePiOmpAccountTerminal } from './pi-omp-accounts.ts'
import { readKimiAccount, KIMI_CODE_LOGIN, KIMI_MANAGE_LOGIN, prepareKimiAccountDirectory } from './kimi-accounts.ts'
import { readMimoAccount } from './mimo-configuration.ts'
import { prepareMimoAccountTerminal } from './first-party-account-context.ts'
import { spawnAccountTerminal, WindowsAccountTerminalError } from './windows-account-terminal.ts'
import { WindowsCliInstallationError, WindowsCliNotFoundError } from './windows-cli-installation.ts'
import { effectiveHermesHome } from './hermes-account-context.ts'
import { ensureHermesNousFresh, HermesRenewalError, reserveHermesAccount } from './hermes-renewal.ts'
import { HermesAccountSourceError } from './hermes-models.ts'
import { readQoderAccount, qoderEnvironment, QODER_METADATA_ARGUMENTS } from './qoder-accounts.ts'

const STATUS_TIMEOUT = 10_000
const STARTUP_TIMEOUT = 30_000
const TERMINAL_TIMEOUT = 30 * 60_000
const MAX_OUTPUT_BYTES = 256 * 1024
const MAX_FRAMES = 512
const MAX_INPUT_BYTES = 16 * 1024
const ACTIONS: AccountAction[] = ['login', 'logout', 'manage']
/** Guided login window timing; tests shorten it. */
export const AGY_GUIDE_TIMING = {
  commandDelayMs: 400,
  pollMs: 1500,
  loginConfirmMs: 20_000,
  logoutConfirmMs: 20_000,
  /** Output pause that counts as a finished draw; agy pauses ~2 s while signing in. */
  quietMs: 3000,
  /** A screen that keeps animating is still read after this long. */
  settleCapMs: 10_000,
  /** When `/logout` is still pending after this, one more Enter runs a completed slash command. */
  confirmEnterMs: 1500,
  /** Other CLIs' guided windows: a screen this still with no known step goes to the native terminal. */
  flowQuietMs: 8000,
  /** How long a waiting browser/device authorization is watched, and how often. */
  authorizeWatchMs: 15 * 60_000,
  watchPollMs: 3000,
}
// A guided answer's Enter follows its pasted value after the input box takes it.
const ANSWER_ENTER_MS = 300

class AccountLoginGoneError extends Error {
  constructor() {
    super('该账号已不存在，请刷新后重试')
  }
}

const validateCli = (cli: CliId) => {
  if (!(CLI_IDS as readonly string[]).includes(cli)) throw new Error('不支持的 CLI')
}
const instructionFor = (cli: CliId, action: AccountAction): string => {
  if ((cli === 'qoder' || cli === 'qodercn'))
    return action === 'login'
      ? `按 ${cli === 'qodercn' ? 'Qoder CN' : 'Qoder'} 原生提示完成登录；仅使用本版 PAT。`
      : action === 'logout'
        ? `在 ${cli === 'qodercn' ? 'Qoder CN' : 'Qoder'} 原生终端输入 /logout 并确认；本版 PAT 环境变量须由你自行清除。`
        : `在 ${cli === 'qodercn' ? 'Qoder CN' : 'Qoder'} 原生终端使用 /login、/logout 和 /status 管理账号。`
  if (cli === 'zcode' || cli === 'grok') return zcodeGrokInstruction(cli, action)
  if (cli === 'antigravity')
    return action === 'manage'
      ? '在 Antigravity 原生终端中使用 /login 登录，或 /logout 退出。'
      : action === 'login'
        ? '按下方提示在 Antigravity 原生终端中完成登录。'
        : '插件会在 Antigravity 原生终端中自动输入 /logout 退出登录。'
  if (cli === 'kimi' && action !== 'login')
    return action === 'logout'
      ? '在 Kimi 原生终端中输入 /logout 并按 Enter，再选择要退出的提供商。'
      : '在 Kimi 原生终端中使用 /login 或 /logout 管理提供商与账号。'
  if (action === 'manage') return '在原生 CLI 中管理账号。'
  return action === 'login'
    ? '按 CLI 原生提示完成登录；需要浏览器授权时由 CLI 打开浏览器。'
    : '按 CLI 原生流程退出登录。'
}
const actionsFor = (cli: CliId, config: RuntimeConfig): AccountStatus['actions'] => {
  if (cli === 'claude')
    return [
      {
        id: 'login',
        label: '官方登录 / 切换账号',
        description: '打开 Claude 原生官方登录；保留本地代理设置。',
      },
      { id: 'logout', label: '退出官方账号', description: '仅退出 Claude 官方账号；本地代理设置保留。' },
      { id: 'manage', label: '官方账号终端', description: '打开 Claude 官方账号原生终端。' },
    ]
  if (cli === 'pi' || cli === 'omp' || cli === 'hermes')
    return [
      { id: 'login', label: '登录设置', description: '打开原生终端登录界面，选择提供商后由你完成授权。' },
      { id: 'logout', label: '退出登录', description: '选择当前账号来源，在原生菜单中退出或移除凭据。' },
      { id: 'manage', label: '账号终端', description: '打开原生终端管理账号。' },
    ]

  return ACTIONS.map((id) => ({
    id,
    label:
      id === 'login'
        ? cli === 'opencode' || cli === 'kimi'
          ? '登录设置'
          : '登录 / 切换账号'
        : id === 'logout'
          ? '退出登录'
          : '账号终端',
    description: instructionFor(cli, id),
  }))
}

/** Only commands verified against the installed CLIs. Never send a prompt/slash command. */
const argumentsFor = (cli: CliId, action: AccountAction): string[] => {
  if ((cli === 'qoder' || cli === 'qodercn')) return action === 'login' ? ['login'] : []
  if (cli === 'antigravity' || action === 'manage' || (cli === 'kimi' && action === 'logout')) return []
  if (cli === 'codex' || cli === 'kimi') return [action]
  return ['auth', action]
}

/** No raw command output, exception text, account tokens, or key prefixes cross this boundary. */
function summarize(cli: CliId, raw: string, exitCode: number | null): AccountIdentity {
  const text = stripVTControlCharacters(raw)
  if (
    exitCode !== 0 &&
    /\b(?:authentication failed|invalid (?:api key|credentials|token)|(?:credentials|token) (?:have |has )?expired|401\s+Unauthorized)\b/i.test(
      text,
    )
  )
    return { state: 'unauthenticated', summary: 'CLI 报告认证失效，请重新登录或检查凭据' }
  if (cli === 'codex') {
    if (exitCode === 0 && /\bLogged in using ChatGPT\b/.test(text))
      return {
        state: 'authenticated',
        summary: '已通过 ChatGPT 登录',
        authMethod: 'oauth',
        verification: 'cli',
      }
    if (exitCode === 0 && /\bLogged in using (?:an )?API key\b/i.test(text))
      return { state: 'authenticated', summary: 'API 登录', authMethod: 'api', verification: 'cli' }
    if (/^Not logged in\s*$/m.test(text)) return { state: 'unconfigured', summary: '尚未登录' }
  } else if (cli === 'claude') {
    try {
      const value = JSON.parse(text)
      if (value.loggedIn === false) return { state: 'unconfigured', summary: '尚未登录' }
      if (exitCode === 0 && value.loggedIn === true) {
        // Claude's installed auth/status implementation only returns email for
        // claude.ai sessions. Environment OAuth tokens do not identify an account.
        const oauth = value.authMethod === 'claude.ai'
        const api = value.authMethod === 'api_key' || value.authMethod === 'api_key_helper'
        if (value.authMethod === 'oauth_token')
          return { state: 'configured', summary: 'CLI 已配置令牌，账号类型待确认', verification: 'cli' }
        return {
          state: 'authenticated',
          summary: api ? 'API 登录' : oauth ? '已通过 OAuth 登录' : 'CLI 报告已登录',
          authMethod: api ? 'api' : oauth ? 'oauth' : undefined,
          accountLabel: value.authMethod === 'claude.ai' ? accountEmail(value.email) : undefined,
          verification: 'cli',
        }
      }
    } catch {
      return { state: 'unavailable', summary: '账号状态响应无法解析，请在账号终端检查' }
    }
  } else if (cli === 'mimo') {
    if (exitCode === 0 && /Provider: MiMo\b/.test(text)) {
      // Installed whoami source emits User ID only in the type === 'api'
      // metadata branch. Never expose that metadata or a key prefix for API auth.
      if (/\bType:\s*api\b|\bUser ID:/.test(text))
        return {
          state: 'authenticated',
          summary: 'API 登录',
          authMethod: 'api',
          verification: 'local',
        }
      return { state: 'configured', summary: '已配置 MiMo 账号', verification: 'cli' }
    }
    if (/Not logged in\. Run `mimo auth login` to log in\./.test(text))
      return { state: 'unconfigured', summary: '尚未登录 MiMo' }
  }
  if (exitCode !== 0) return { state: 'unavailable', summary: 'CLI 账号状态查询失败，请在账号终端检查' }
  return { state: 'unknown', summary: '登录状态未知，请打开账号终端' }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(signal.reason)
    signal.addEventListener('abort', cancel, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel))
  })
}

interface ParentScope {
  controller: AbortController
  pending: Set<Promise<unknown>>
}

interface StatusQuery {
  cli: CliId
  controller: AbortController
  operation: Promise<AccountStatus>
  subscribers: Set<{ signal: AbortSignal }>
  settled: boolean
}

interface AccountSession {
  id: string
  parent: string
  scope: ParentScope
  cli: CliId
  terminal: SubprocessTerminalHandle
  frames: AccountFrame[]
  bytes: number
  seq: number
  state: 'running' | 'closed' | 'failed'
  stopping: boolean
  changed: Set<() => void>
  output: Promise<void>
  exited: boolean
  /** Step hints and automatic sign-out of a plugin-drawn login/logout window. */
  guide?: AccountGuideDriver
  guideControl?: AbortController
  /** The account before this window, to tell a new sign-in from an existing one. */
  before?: Promise<AccountEvidence | undefined>
  project: string
  settleTimer?: ReturnType<typeof setTimeout>
  firstOutputAt?: number
  cleanup?: Promise<void>
  release?: () => void | Promise<void>
  deadline?: ReturnType<typeof setTimeout>
  attachDeadline?: ReturnType<typeof setTimeout>
  expiry?: ReturnType<typeof setTimeout>
  exitCode?: number
  /** A native step that must follow a proven login before the window reports it. */
  afterLogin?: (signal: AbortSignal) => Promise<unknown>
}

/** User-only auth processes. Only allowlisted identity metadata leaves the Host. */
export class AccountManager {
  private readonly sessions = new Map<string, AccountSession>()
  private readonly reserved = new Set<CliId>()
  /** CLIs whose account read left an unconfirmed range, with its display-safe reason. */
  private readonly unsafeQueries = new Map<CliId, string | undefined>()
  private readonly unsafeTerminals = new Map<CliId, string>()
  private readonly statusQueries = new Map<string, StatusQuery>()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly parents = new Map<string, ParentScope>()
  private readonly parentClosings = new Map<string, Promise<void>>()
  private readonly controller = new AbortController()
  private closing?: Promise<void>

  constructor(
    private backend: ProcessBackend,
    private config: RuntimeConfig,
    private identity: AccountIdentitySource = nativeAgyAccountIdentity(backend, config),
    private onQueryCleanup?: (cli: CliId, error: ProcessCleanupUnconfirmedError) => void,
  ) {}

  isBusy(cli: CliId): boolean {
    validateCli(cli)
    return this.reserved.has(cli) || this.unsafeQueries.has(cli) || this.unsafeTerminals.has(cli)
  }

  /** The paused state a CLI reports while an account process range is unconfirmed. */
  private cleanupHold(cli: CliId): AccountStatus | undefined {
    if (!this.unsafeQueries.has(cli) && !this.unsafeTerminals.has(cli)) return undefined
    const reason = this.unsafeQueries.get(cli)
    return {
      cli,
      installed: true,
      state: 'unavailable',
      summary: this.unsafeQueries.has(cli)
        ? `账号查询未能确认进程已退出，已暂停此 CLI${reason ? `：${reason}` : ''}`
        : '账号终端未能确认完全退出，已暂停此 CLI',
      cleanupBlocked: true,
      actions: [],
    }
  }

  /** An account read whose process range is unconfirmed holds the CLI until the user releases it. */
  private quarantineQuery(cli: CliId, error: ProcessCleanupUnconfirmedError) {
    this.unsafeQueries.set(cli, cleanupCauseText(error))
    this.onQueryCleanup?.(cli, error)
  }

  /** The user confirmed no account process of this CLI is left; refuse while one is still owned here. */
  assertCleanupRecoverable(cli: CliId): void {
    validateCli(cli)
    if (this.controller.signal.aborted) throw new Error('插件正在关闭')
    if (this.reserved.has(cli)) throw new Error('此 CLI 的账号终端仍在运行或等待关闭，请先关闭账号终端')
    for (const query of this.statusQueries.values())
      if (query.cli === cli && !query.settled) throw new Error('此 CLI 的账号状态仍在读取，请稍后再试')
  }

  recoverCleanup(cli: CliId): void {
    this.assertCleanupRecoverable(cli)
    this.unsafeQueries.delete(cli)
    this.unsafeTerminals.delete(cli)
  }

  async status(cli: CliId, cwd: string, signal: AbortSignal): Promise<AccountStatus> {
    validateCli(cli)
    if (signal.aborted || this.controller.signal.aborted) throw new Error('账号状态查询已取消')
    const directory = projectDirectory(cwd)
    const key = JSON.stringify([cli, directory])
    let query = this.statusQueries.get(key)
    if (query && [...query.subscribers].every((reader) => reader.signal.aborted)) query.controller.abort()
    // The abandoned process still owns cleanup; a new reader must not overlap it.
    if (query?.controller.signal.aborted) {
      await abortable(
        query.operation.catch(() => undefined),
        signal,
      )
      return this.status(cli, directory, signal)
    }
    if (!query) {
      const controller = new AbortController()
      query = {
        cli,
        controller,
        operation: this.track(this.readStatus(cli, directory, controller.signal)),
        subscribers: new Set(),
        settled: false,
      }
      this.statusQueries.set(key, query)
      const current = query
      void current.operation
        .finally(() => {
          current.settled = true
          if (this.statusQueries.get(key) === current) this.statusQueries.delete(key)
        })
        .catch(() => undefined)
    }
    const reader = { signal }
    query.subscribers.add(reader)
    try {
      // Share only the running read, never a completed login/authorization result.
      return await abortable(query.operation, signal)
    } catch (error) {
      if (signal.aborted) throw new Error('账号状态查询已取消')
      throw error
    } finally {
      query.subscribers.delete(reader)
      if (!query.subscribers.size && !query.settled) {
        query.controller.abort()
        await query.operation.catch(() => undefined)
      }
    }
  }

  /** `renew: false` reads Hermes' own store as it is, for a window that holds off Nous renewal. */
  private async readStatus(
    cli: CliId,
    cwd: string,
    signal: AbortSignal,
    { renew = true }: { renew?: boolean } = {},
  ): Promise<AccountStatus> {
    const held = this.cleanupHold(cli)
    if (held) return held
    const timer = new AbortController()
    // Qoder's native account budget includes its acknowledged session teardown.
    const timeout = setTimeout(() => timer.abort(), (cli === 'qoder' || cli === 'qodercn') ? 15_000 : STATUS_TIMEOUT)
    timeout.unref?.()
    const control = AbortSignal.any([signal, this.controller.signal, timer.signal])
    let installed = false
    try {
      const executable = await resolveCliExecutable(cli, this.backend, this.config, control)
      installed = true
      control.throwIfAborted()
      if ((cli === 'qoder' || cli === 'qodercn'))
        return {
          cli, installed, ...(await readQoderAccount(executable, control, { cli, backend: this.backend, config: this.config, project: cwd })),
          actions: this.backend.spawnTerminal ? actionsFor(cli, this.config) : [],
        }
      if (cli === 'mimo')
        return {
          cli,
          installed,
          ...(await readMimoAccount(control)),
          actions: this.backend.spawnTerminal ? actionsFor(cli, this.config) : [],
        }
      if (cli === 'hermes') {
        await verifyHermesExecutable(executable, control)
        const local = await readHermesAccount(this.config, control)
        if (
          renew &&
          (local.logins?.some((login) => login.providerLabel === 'Nous') ||
            local.summary === 'Hermes 登录已保存，等待自动续期')
        )
          await ensureHermesNousFresh({
            home: effectiveHermesHome(this.config),
            executable,
            backend: this.backend,
            signal: control,
            graceMs: this.config.graceMs,
          })
      }
      if (isExtendedCli(cli)) {
        const identity = await abortable(
          cli === 'zcode' || cli === 'grok'
            ? zcodeGrokAccountStatus(cli, this.config, control)
            : cli === 'opencode'
              ? readOpenCodeAccount(this.config, control)
              : cli === 'hermes'
                ? readHermesAccount(this.config, control)
                : readPiOmpAccount(cli, this.config, control),
          control,
        )
        const sources =
          cli === 'pi' || cli === 'omp'
            ? await listPiOmpAccountSources(cli, this.config.stateDirectory, control)
            : cli === 'hermes'
              ? await listHermesAccountSources(this.config, control)
              : undefined
        const providers = loginProviders(cli, identity.logins)
        return {
          cli,
          installed,
          ...identity,
          actions: actionsFor(cli, this.config)
            .map((item) =>
              item.id === 'logout' && sources
                ? { ...item, sources }
                : item.id === 'login' && providers
                  ? { ...item, providers }
                  : item,
            )
            .filter((item) => item.target === 'models' || this.backend.spawnTerminal),
        }
      }
      if (cli === 'antigravity') {
        const identity = await abortable(this.identity(cli, control), control)
        return {
          cli,
          installed,
          ...(identity ?? {
            state: 'unknown' as const,
            summary: '已安装，登录状态未知',
          }),
          actions: this.backend.spawnTerminal ? actionsFor(cli, this.config) : [],
        }
      }
      if (cli === 'codex') {
        // One effective-store read handles file/keyring accounts and display
        // identity. Older servers fall back to the native status command below.
        const identity = await readCodexAccount(this.backend, this.config, executable, cwd, control)
        if (identity)
          return {
            cli,
            installed,
            ...identity,
            actions: this.backend.spawnTerminal ? actionsFor(cli, this.config) : [],
          }
      }
      const claudeRoute = cli === 'claude' ? await readClaudeOwnRoute(cwd, control) : undefined
      const argv =
        cli === 'codex'
          ? ['login', 'status']
          : cli === 'claude'
            ? ['auth', 'status', '--json']
            : cli === 'kimi'
              ? ['provider', 'list', '--json']
              : ['auth', 'whoami']
      const launch = claudeRoute
        ? await prepareClaudeWorkerLaunch(
            claudeRoute,
            [executable, ...argv],
            this.config.stateDirectory ??
              join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'cliworker-now'),
            control,
          )
        : { argv: [executable, ...argv], env: firstPartyEnvironment(cli) }
      let child: ReturnType<ProcessBackend['spawn']>
      try {
        control.throwIfAborted()
        child = this.backend.spawn({
          argv: launch.argv,
          env: launch.env,
          cwd,
          stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
          graceMs: this.config.graceMs,
          signal: control,
        })
      } catch (error) {
        if ('cleanup' in launch) await launch.cleanup?.()
        throw error
      }
      void child.done.catch(() => undefined)
      let raw = '',
        bytes = 0
      const read = async (stream: typeof child.stdout) => {
        if (!stream) return
        const decoder = new StringDecoder('utf8')
        for await (const chunk of stream) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
          bytes += buffer.byteLength
          if (bytes > 64 * 1024) throw new Error('状态响应超过限制')
          raw += decoder.write(buffer)
        }
        raw += decoder.end()
      }
      const readers = [read(child.stdout), read(child.stderr)]
      let finished = false
      try {
        const [outcome] = await abortable(Promise.all([child.done, ...readers]), control)
        finished = true
        const status = claudeRoute
          ? claudeRouteIdentity(claudeRoute, raw, outcome.exitCode)
          : cli === 'kimi' && outcome.exitCode === 0
            ? await readKimiAccount(raw, control)
            : summarize(cli, raw, outcome.exitCode)
        return {
          cli,
          installed,
          ...status,
          actions: this.backend.spawnTerminal
            ? actionsFor(cli, this.config).map((item) => {
                if (cli !== 'kimi' || item.id !== 'login') return item
                const providers = loginProviders(cli, status.logins)
                return status.state === 'authenticated'
                  ? { ...item, label: '管理登录', description: '在原生终端管理 Kimi 登录', providers }
                  : { ...item, providers }
              })
            : [],
        }
      } finally {
        let exited = false
        try {
          // A status command that ran to completion normally empties its own range; terminate only what outlives it.
          if (finished && !control.aborted) exited = await child.waitForExit(AbortSignal.timeout(METADATA_EXIT_GRACE_MS))
          if (!exited) {
            child.terminate()
            exited = await child.waitForExit()
          }
        } catch (error) {
          throw new ProcessCleanupUnconfirmedError({ cause: error })
        }
        if (!exited) throw new ProcessCleanupUnconfirmedError()
        await Promise.allSettled([child.done, ...readers])
        raw = ''
        if ('cleanup' in launch) await launch.cleanup?.()
      }
    } catch (error) {
      if (error instanceof ProcessCleanupUnconfirmedError) {
        this.quarantineQuery(cli, error)
        return { ...this.cleanupHold(cli)!, installed }
      }
      if (signal.aborted || this.controller.signal.aborted) throw new Error('账号状态查询已取消')
      const code = (error as NodeJS.ErrnoException)?.code
      if (error instanceof WindowsCliNotFoundError)
        return { cli, installed: false, state: 'unconfigured', summary: error.message, actions: [] }
      if (error instanceof WindowsCliInstallationError)
        return { cli, installed: error.installed, state: 'unavailable', summary: error.message, actions: [] }
      if (error instanceof ClaudeOwnRouteError)
        return {
          cli,
          installed,
          state: 'unavailable',
          summary: error.message,
          actions: this.backend.spawnTerminal ? actionsFor(cli, this.config) : [],
        }
      if (error instanceof MimoConfigurationError)
        return { cli, installed, state: 'unavailable', summary: error.message, actions: [] }
      if (error instanceof HermesExecutableError)
        return { cli, installed, state: 'unavailable', summary: error.message, actions: [] }
      // Signing in again is the way out of both, so the window still offers every provider (Nous included).
      const hermesActions = () =>
        actionsFor(cli, this.config).map((item) =>
          item.id === 'login' ? { ...item, providers: loginProviders(cli, undefined) } : item,
        )
      if (error instanceof HermesAccountSourceError)
        return {
          cli,
          installed,
          state: 'unavailable',
          verification: 'local',
          summary: error.message,
          actions: hermesActions(),
        }
      if (error instanceof HermesRenewalError)
        return {
          cli,
          installed,
          state: error.state === 'relogin' ? 'unauthenticated' : 'unavailable',
          verification: 'local',
          summary: error.message,
          actions: hermesActions(),
        }
      if (code === 'CLI_LAUNCHER_UNSUPPORTED')
        return {
          cli,
          installed: true,
          state: 'unavailable',
          summary: 'CLI 启动入口无法确认，请配置原生程序或固定 Node/Bun 入口',
          actions: [],
        }
      if (code === 'CLI_IDENTITY_MISMATCH')
        return {
          cli,
          installed: true,
          state: 'unavailable',
          summary: `${cli === 'omp' ? 'OMP' : 'Pi'} 执行入口身份不匹配，请检查该 CLI 的安装和路径`,
          actions: [],
        }
      const failed =
        installed ||
        this.hasCustomExecutable(cli) ||
        timer.signal.aborted ||
        (!!code && code !== 'ENOENT' && code !== 'ENOTDIR')
      return {
        cli,
        installed,
        state: failed ? 'unavailable' : 'unconfigured',
        summary: installed
          ? '账号状态暂不可用，可打开账号终端检查'
          : this.hasCustomExecutable(cli)
            ? 'CLI 执行路径配置失败，请检查可执行路径'
            : timer.signal.aborted
              ? 'CLI 安装探测超时，请刷新重试'
              : failed
                ? 'CLI 安装状态读取失败，请检查安装'
                : '尚未安装 CLI，请检查安装',
        actions: installed && this.backend.spawnTerminal ? actionsFor(cli, this.config) : [],
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  /** The login still exists in the native store: a stale window never signs out something else. */
  private async assertLogin(cli: CliId, cwd: string, login: string, signal: AbortSignal) {
    const current = await this.readStatus(cli, cwd, signal)
    signal.throwIfAborted()
    if (!current.logins?.some((item) => item.id === login)) throw new AccountLoginGoneError()
  }

  private hasCustomExecutable(cli: CliId): boolean {
    if (cli !== 'harness' && this.config.cliExecutablePaths?.read(cli)?.mode === 'manual') return true
    if (cli === 'antigravity') return this.config.executable !== 'agy'
    if (cli === 'harness') return false
    const configured = this.config[`${cli}Executable`]
    return !!configured && configured !== cli
  }

  start(
    parent: string,
    cli: CliId,
    action: AccountAction,
    cwd: string,
    signal: AbortSignal,
    source?: AccountSource,
    provider?: string,
    login?: string,
  ): Promise<{ id: string; instruction: string; size: { cols: number; rows: number } }> {
    validateCli(cli)
    if (!ACTIONS.includes(action)) throw new Error('不支持的账号操作')
    if (
      source !== undefined &&
      (!['native', 'plugin'].includes(source) ||
        action !== 'logout' ||
        !['pi', 'omp', 'hermes'].includes(cli))
    )
      throw new Error('不支持的账号来源')
    if (
      provider !== undefined &&
      (action !== 'login' ||
        source !== undefined ||
        login !== undefined ||
        !(cli === 'zcode' ? ['bigmodel', 'zai'].includes(provider) : isLoginProvider(cli, provider)))
    )
      throw new Error(cli === 'zcode' ? '不支持的 ZCode 授权来源' : '不支持的登录服务商')
    // One login of the account window: an OpenCode or Kimi provider, a Hermes pool entry,
    // a Pi provider in one location, or one OMP credential row in one location.
    const target = login === undefined ? undefined : parseAccountLoginId(login)
    const entry = target?.entry
    if (
      login !== undefined &&
      (action !== 'logout' ||
        source !== undefined ||
        !target ||
        target.cli !== cli ||
        !(cli === 'opencode' || cli === 'kimi'
          ? entry === undefined
          : cli === 'hermes'
            ? entry !== undefined
            : cli === 'pi'
              ? entry === 'native' || entry === 'plugin'
              : cli === 'omp' && !!entry && /^(?:native|plugin)\.[1-9][0-9]{0,15}$/.test(entry)))
    )
      throw new Error('不支持单独退出该账号')
    if (!parent || parent.length > 512) throw new Error('无效的父会话')
    this.controller.signal.throwIfAborted()
    signal.throwIfAborted()
    const capability = actionsFor(cli, this.config).find((item) => item.id === action)
    if (!capability || capability.target === 'models')
      throw new Error('此版本 CLI 未提供终端登录或账号管理入口')
    if (!this.backend.spawnTerminal) throw new Error('当前宿主不支持交互终端')
    if (this.unsafeTerminals.has(cli)) throw new Error('账号终端未能确认完全退出，已暂停此 CLI；确认没有残留进程后可在设置中解除暂停')
    if (this.unsafeQueries.has(cli)) throw new ProcessCleanupUnconfirmedError()
    if (this.reserved.has(cli)) throw new Error('此 CLI 已有账号终端，请先关闭后重试')
    const directory = projectDirectory(cwd)
    this.reserved.add(cli)
    for (const query of this.statusQueries.values()) if (query.cli === cli) query.controller.abort()
    let scope = this.parents.get(parent)
    if (!scope) {
      scope = { controller: new AbortController(), pending: new Set() }
      this.parents.set(parent, scope)
    }
    const operation = this.track(
      this.startSession(parent, cli, action, directory, signal, scope, source, provider, login),
    )
    scope.pending.add(operation)
    void operation.finally(() => scope.pending.delete(operation)).catch(() => undefined)
    return operation
  }

  private async startSession(
    parent: string,
    cli: CliId,
    action: AccountAction,
    cwd: string,
    signal: AbortSignal,
    scope: ParentScope,
    source?: AccountSource,
    provider?: string,
    login?: string,
  ) {
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), STARTUP_TIMEOUT)
    timer.unref?.()
    const startup = AbortSignal.any([signal, scope.controller.signal, this.controller.signal, timeout.signal])
    // Provider cancellation belongs to allocation, not the interactive login's
    // lifetime. A completed login terminal must not inherit this request/timer.
    const allocationControl = new AbortController()
    const cancelAllocation = () => allocationControl.abort()
    startup.addEventListener('abort', cancelAllocation, { once: true })
    let session: AccountSession | undefined
    let allocation: Promise<AccountSession> | undefined
    let release: (() => void | Promise<void>) | undefined
    let afterLogin: AccountSession['afterLogin']
    let instruction = instructionFor(cli, action)
    try {
      const executable = await resolveCliExecutable(cli, this.backend, this.config, startup)
      if (cli === 'hermes') await verifyHermesExecutable(executable, startup)
      startup.throwIfAborted()
      let launch: { argv: string[]; cwd: string; env?: Record<string, string> } = {
        argv: [executable, ...argumentsFor(cli, action)],
        env: firstPartyEnvironment(cli),
        cwd,
      }
      if (cli === 'claude') {
        const claudeAccountRoute = await readClaudeOfficialAccountRoute(cwd, startup)
        startup.throwIfAborted()
        // Login/logout always address the native official account; proxy settings remain untouched.
        launch.argv = [
          executable,
          ...claudeNativeSettingsArguments(
            claudeAccountRoute.configDirectory,
            claudeAccountRoute.suppressedEnvironment,
          ),
          ...argumentsFor(cli, action),
          ...(action === 'login' ? ['--claudeai'] : []),
        ]
        launch.env = claudeLaunchEnvironment()
        instruction =
          action === 'logout'
            ? '退出 Claude 官方账号；本地代理设置保留。'
            : '在原生终端登录 Claude 官方账号；本地代理设置保留。'
      } else if ((cli === 'qoder' || cli === 'qodercn')) {
        launch.argv = [executable, ...QODER_METADATA_ARGUMENTS.filter((value) => value !== '--acp'), ...argumentsFor(cli, action)]
        launch.env = qoderEnvironment(cli)
      } else if (cli === 'kimi') {
        if (login) await this.assertLogin(cli, cwd, login, startup)
        const target = login ? parseAccountLoginId(login) : undefined
        if (provider) {
          // A Kimi Code region picked in the window: Kimi's own device login for it.
          launch.argv = [executable, 'login', '--region', provider === 'kimi-code-cn' ? 'mainland-cn' : 'global']
        } else if (target && target.provider !== KIMI_CODE_LOGIN) {
          // One API provider: Kimi's own non-interactive removal, the same call as /logout.
          launch.argv = [executable, 'provider', 'remove', target.provider]
        } else if (action === 'login') {
          const current = await this.readStatus(cli, cwd, startup)
          startup.throwIfAborted()
          if (current.state === 'authenticated' && current.authMethod === 'oauth') {
            launch.argv = [executable]
            instruction = KIMI_MANAGE_LOGIN
          }
        }
        const prepared = await prepareKimiAccountDirectory(
          this.config.stateDirectory ??
            join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'cliworker-now'),
          startup,
        )
        launch.cwd = prepared.cwd
        release = prepared.cleanup
        if (action !== 'login') instruction = `若出现 Trust 提示，请自行确认此空账号目录；${instruction}`
      } else if (cli === 'mimo') {
        const prepared = await prepareMimoAccountTerminal(
          executable,
          action,
          this.config.stateDirectory ??
            join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'cliworker-now'),
          startup,
        )
        launch = prepared
        release = prepared.cleanup
      } else if (cli === 'zcode' || cli === 'grok') {
        const prepared = await zcodeGrokAccountLaunch(
          cli,
          action,
          executable,
          this.config,
          this.backend,
          startup,
          { loginProvider: provider as ZCodeLoginProvider | undefined },
        )
        launch = prepared
        instruction = prepared.instruction
      } else if (cli === 'pi' || cli === 'omp') {
        if (login) await this.assertLogin(cli, cwd, login, startup)
        const prepared = await preparePiOmpAccountTerminal({
          cli,
          action,
          source,
          provider,
          login,
          executable,
          project: cwd,
          stateDirectory:
            this.config.stateDirectory ??
            join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'cliworker-now'),
          config: this.config,
          signal: startup,
        })
        launch = prepared
        instruction = prepared.instruction
        release = prepared.cleanup
      } else if (cli === 'hermes') {
        const oldHome = effectiveHermesHome(this.config)
        const releases = [await reserveHermesAccount(oldHome, startup)]
        release = () => {
          for (const free of releases) free()
        }
        // The reservation holds off Nous renewal, which a full status read would report as busy
        // (no rows): the target is checked in the local native store instead.
        if (login && !(await readHermesAccount(this.config, startup)).logins?.some((item) => item.id === login))
          throw new AccountLoginGoneError()
        const prepared = await prepareHermesAccount(action, executable, cwd, this.config, startup, source, { provider, login })
        const cleanup = release
        release = async () => {
          await prepared.cleanup()
          await cleanup()
        }
        const selectedHome = effectiveHermesHome(this.config)
        if (selectedHome !== oldHome) releases.push(await reserveHermesAccount(selectedHome, startup))
        if (action === 'login' && provider === 'nous')
          afterLogin = (signal) =>
            selectHermesNousAfterLogin(
              this.config,
              executable,
              (argv, home, env) => captureCatalogMetadata(this.backend, this.config, argv, home, signal, env),
              signal,
            )
        launch = prepared
        instruction = prepared.instruction
      } else if (cli === 'opencode') {
        if (login) await this.assertLogin(cli, cwd, login, startup)
        const prepared = await prepareOpenCodeAccount(executable, action, this.config, startup, { provider, login })
        launch = prepared
        instruction = prepared.instruction
        release = prepared.cleanup
      }
      startup.throwIfAborted()
      const guide = createAccountGuide(cli, action, {
        provider,
        login,
        stores: provider ? providerStores(cli, provider) : undefined,
      })
      allocation = spawnAccountTerminal(this.backend, {
        ...launch,
        ...(guide ? guide.size : { rows: 24, cols: 80 }),
        terminalType: 'xterm-256color',
        graceMs: this.config.graceMs,
        signal: allocationControl.signal,
      }).then(
        async (terminal) => {
          session = {
            id: randomUUID(),
            parent,
            scope,
            cli,
            terminal,
            frames: [],
            bytes: 0,
            seq: 0,
            state: 'running',
            stopping: false,
            changed: new Set(),
            output: Promise.resolve(),
            exited: false,
            ...(guide ? { guide, guideControl: new AbortController() } : {}),
            project: cwd,
            release,
            ...(afterLogin ? { afterLogin } : {}),
          }
          const own = session
          void terminal.done.then(
            () => (own.exited = true),
            () => (own.exited = true),
          )
          this.sessions.set(session.id, session)
          if (guide && cli !== 'antigravity')
            session.before = this.evidence(session, session.guideControl!.signal).catch(() => undefined)
          this.emit(session, { status: 'running' })
          session.output = this.readTerminal(session)
          void session.output.catch(() => undefined)
          // Even if an uncooperative provider ignores cancellation, a late PTY
          // is adopted and cleaned up before releasing its CLI reservation.
          if (startup.aborted) {
            await this.finish(session, 'closed', '启动已取消')
            startup.throwIfAborted()
          }
          return session
        },
        async (error) => {
          try {
            if (!(error instanceof ProcessCleanupUnconfirmedError)) await release?.()
          } finally {
            if (error instanceof ProcessCleanupUnconfirmedError) this.unsafeTerminals.set(cli, parent)
            else this.reserved.delete(cli)
          }
          throw error
        },
      )
      this.track(allocation)
      scope.pending.add(allocation)
      const pendingAllocation = allocation
      void allocation.finally(() => scope.pending.delete(pendingAllocation)).catch(() => undefined)
      session = await abortable(allocation, startup)
      if (startup.aborted) {
        await this.finish(session, 'closed', '启动已取消')
        startup.throwIfAborted()
      }
      const published = session
      session.deadline = setTimeout(() => {
        void this.finish(published, 'closed', '账号终端已达到 30 分钟上限，请重新打开').catch(() => undefined)
      }, TERMINAL_TIMEOUT)
      session.deadline.unref?.()
      session.attachDeadline = setTimeout(() => {
        void this.finish(published, 'closed', '账号终端未连接，已自动关闭').catch(() => undefined)
      }, 30_000)
      session.attachDeadline.unref?.()
      void session.terminal.done
        .then(
          async (outcome) => {
            await this.guidedExit(published, outcome.exitCode ?? undefined)
            return this.finish(
              published,
              outcome.exitCode === 0 ? 'closed' : 'failed',
              outcome.exitCode === 0
                ? '账号终端已结束'
                : Number.isInteger(outcome.exitCode)
                  ? `账号终端异常退出（退出码 ${outcome.exitCode}），请在系统终端检查该 CLI 后重试`
                  : '账号终端连接已结束，未返回退出码；请在系统终端检查该 CLI 后重试',
            )
          },
          () => this.finish(published, 'failed', '账号终端连接失败，请重新打开'),
        )
        .catch(() => undefined)
      return { id: session.id, instruction, size: guide?.size ?? { cols: 80, rows: 24 } }
    } catch (error) {
      // An allocation still in flight may own a process already; never permit a
      // second login until its late handle/rejection establishes cleanup.
      if (!session && !allocation) {
        try {
          await release?.()
        } finally {
          this.reserved.delete(cli)
        }
      }
      if (session && startup.aborted && !session.cleanup)
        await this.finish(session, 'closed', '启动已取消').catch(() => undefined)
      if (error instanceof Error && error.message === '此 CLI 已有账号终端，请先关闭后重试') throw error
      if (error instanceof ProcessCleanupUnconfirmedError)
        throw new Error('账号终端未能确认完全退出，已暂停此 CLI；确认没有残留进程后可在设置中解除暂停')
      if (timeout.signal.aborted) throw new Error('账号终端启动超时，正在回收启动过程；请稍后重试')
      if (error instanceof ZCodeAccountCapabilityError) throw error
      if (error instanceof AccountLoginGoneError) throw error
      if (error instanceof WindowsAccountTerminalError) throw error
      if (error instanceof WindowsCliInstallationError) throw error
      if (error instanceof HermesExecutableError) throw error
      if (error instanceof HermesAccountSourceError) throw error
      if (error instanceof MimoConfigurationError) throw error
      if ((error as NodeJS.ErrnoException)?.code === 'CLI_IDENTITY_MISMATCH')
        throw new Error(`${cli === 'omp' ? 'OMP' : 'Pi'} 执行入口身份不匹配，请检查该 CLI 的安装和路径`)
      throw new Error(
        session || startup.aborted
          ? '账号终端启动已取消或清理失败，请关闭设置后重试'
          : '无法启动账号终端，请检查 CLI 安装',
      )
    } finally {
      clearTimeout(timer)
      startup.removeEventListener('abort', cancelAllocation)
    }
  }

  private async readTerminal(session: AccountSession): Promise<void> {
    const decoder = new StringDecoder('utf8')
    try {
      for await (const chunk of session.terminal.output) {
        const text = typeof chunk === 'string' ? chunk : decoder.write(chunk)
        for (let offset = 0; offset < text.length; offset += 4096)
          this.emit(session, { data: text.slice(offset, offset + 4096) })
        if (session.guide) {
          this.guided(session, session.guide.output(text))
          this.settleLater(session)
        }
      }
      const tail = decoder.end()
      if (tail) this.emit(session, { data: tail })
    } catch {
      // Do not await from this reader: finish waits for the reader to settle.
      void this.finish(session, 'failed', '账号终端输出中断，请重新打开').catch(() => undefined)
    }
  }

  private emit(session: AccountSession, frame: Omit<AccountFrame, 'seq'>) {
    const entry = { ...frame, seq: ++session.seq }
    session.frames.push(entry)
    session.bytes += Buffer.byteLength(entry.data ?? '')
    while (session.bytes > MAX_OUTPUT_BYTES || session.frames.length > MAX_FRAMES) {
      const removed = session.frames.shift()!
      session.bytes -= Buffer.byteLength(removed.data ?? '')
    }
    for (const notify of session.changed) notify()
    session.changed.clear()
  }

  private owned(parent: string, id: string): AccountSession {
    const session = this.sessions.get(id)
    if (!session || session.parent !== parent) throw new Error('账号终端不存在或不属于当前会话')
    return session
  }

  async *watch(parent: string, id: string, signal: AbortSignal): AsyncIterable<AccountFrame> {
    const session = this.owned(parent, id)
    clearTimeout(session.attachDeadline)
    let seq = 0
    try {
      while (!signal.aborted) {
        const frames = session.frames.filter((frame) => frame.seq > seq)
        if (frames.length && frames[0].seq > seq + 1)
          yield { seq: frames[0].seq - 1, message: '较早的终端输出已从内存释放' }
        for (const frame of frames) {
          seq = frame.seq
          yield frame
        }
        if (signal.aborted) return
        // Cleanup can append its final frame while the consumer is paused at yield.
        // Drain that frame before ending the stream, even if the session is now closed.
        if (session.frames.some((frame) => frame.seq > seq)) continue
        if (session.state !== 'running') return
        await new Promise<void>((resolve) => {
          const wake = () => {
            signal.removeEventListener('abort', wake)
            session.changed.delete(wake)
            resolve()
          }
          session.changed.add(wake)
          signal.addEventListener('abort', wake, { once: true })
          if (signal.aborted || session.seq > seq || session.state !== 'running') wake()
        })
      }
    } finally {
      if (session.state === 'running') await this.finish(session, 'closed', '账号终端连接已关闭')
    }
  }

  async write(parent: string, id: string, data: string): Promise<void> {
    const session = this.owned(parent, id)
    if (typeof data !== 'string' || Buffer.byteLength(data) > MAX_INPUT_BYTES)
      throw new Error('单次终端输入超过限制')
    if (session.state !== 'running' || session.stopping) throw new Error('账号终端已关闭')
    try {
      await session.terminal.write(data)
    } catch {
      throw new Error('无法写入账号终端，请重新打开')
    }
    if (session.guide) this.guided(session, session.guide.input(data))
  }

  /** The user's answer to the current step of a plugin-drawn window. */
  async respond(parent: string, id: string, response: AccountResponse): Promise<void> {
    const session = this.owned(parent, id)
    if (!session.guide) throw new GuideResponseError()
    if (session.state !== 'running' || session.stopping) throw new Error('账号终端已关闭')
    const events = session.guide.respond(response)
    // Keys go first, so the CLI has the answer before the account is read.
    for (const event of events)
      if ('write' in event) {
        try {
          await session.terminal.write(event.write)
          if (event.enter) {
            await sleep(ANSWER_ENTER_MS)
            if (session.state === 'running' && !session.stopping) await session.terminal.write('\r')
          }
        } catch {
          throw new Error('无法写入账号终端，请重新打开')
        }
      }
    this.guided(
      session,
      events.filter((event) => !('write' in event)),
    )
  }

  private guided(session: AccountSession, events: GuideEvent[]) {
    for (const event of events) {
      if ('guide' in event) {
        this.emit(session, { guide: event.guide })
        if (event.guide.step === 'notSignedIn')
          void this.finish(session, 'closed', '账号终端已关闭').catch(() => undefined)
      } else if ('finish' in event) void this.finish(session, 'closed', '账号终端已关闭').catch(() => undefined)
      else if ('write' in event) void this.autoWrite(session, event.write)
      else if ('command' in event) void this.logOut(session, event.command)
      else if ('identify' in event) void this.identifyScreen(session)
      else if ('watch' in event) void this.watchAccount(session)
      else void this.confirmAccount(session, event.confirm)
    }
  }

  /** A choice the user already made in the window, typed into the menu it belongs to. */
  private async autoWrite(session: AccountSession, keys: string) {
    const signal = session.guideControl!.signal
    try {
      await sleep(AGY_GUIDE_TIMING.commandDelayMs, undefined, { signal })
      if (session.state === 'running' && !session.stopping) await session.terminal.write(keys)
    } catch {
      // Closing the window aborts it; nothing else to undo.
    }
  }

  /** The native account: agy's own credential store, or this CLI's account status. */
  private evidence(session: AccountSession, signal: AbortSignal): Promise<AccountEvidence | undefined> {
    if (session.cli === 'antigravity')
      return this.identity(session.cli, signal).catch((error: unknown) => {
        // readStatus quarantines its own unconfirmed reads; the agy identity read is quarantined here.
        if (error instanceof ProcessCleanupUnconfirmedError) this.quarantineQuery(session.cli, error)
        throw error
      })
    // A Hermes window holds off Nous renewal, which a renewing read reports as busy (no rows):
    // Hermes' own account store shows whether the login or logout took effect.
    return this.readStatus(session.cli, session.project, signal, { renew: session.cli !== 'hermes' })
  }

  /** An ordinary failed read is retried by the caller's poll; an unconfirmed process range ends it. */
  private readEvidence(session: AccountSession, signal: AbortSignal): Promise<AccountEvidence | undefined> {
    return this.evidence(session, signal).catch((error: unknown) => {
      if (error instanceof ProcessCleanupUnconfirmedError) throw error
      return undefined
    })
  }

  /** Report a proven change, after the native step a login still needs. */
  private async proven(session: AccountSession, change: AccountChange, signal: AbortSignal) {
    // The login itself took effect; a failed follow-up leaves the model list to say what is missing.
    if (change === 'login') await session.afterLogin?.(signal).catch(() => undefined)
    signal.throwIfAborted()
    this.guided(session, session.guide!.confirmed(change))
  }

  /** The CLI ended its own login/logout: read the account before reporting the window closed. */
  private async guidedExit(session: AccountSession, exitCode: number | undefined) {
    if (!session.guide || session.stopping) return
    session.exitCode = exitCode
    const events = session.guide.exited(exitCode)
    const confirm = events.find((event): event is { confirm: AccountChange } => 'confirm' in event)
    this.guided(
      session,
      events.filter((event) => !('confirm' in event)),
    )
    if (confirm) await this.confirmAccount(session, confirm.confirm, true)
  }

  private settleLater(session: AccountSession) {
    const now = Date.now()
    session.firstOutputAt ??= now
    clearTimeout(session.settleTimer)
    const agy = session.guide instanceof AgyAccountGuide
    const quiet = agy ? AGY_GUIDE_TIMING.quietMs : AGY_GUIDE_TIMING.flowQuietMs
    // A spinner never lets the screen settle; the cap still reads it once.
    const capped = session.firstOutputAt + (agy ? AGY_GUIDE_TIMING.settleCapMs : quiet + AGY_GUIDE_TIMING.settleCapMs) - now
    session.settleTimer = setTimeout(
      () => {
        session.firstOutputAt = undefined
        if (session.state === 'running' && !session.stopping) this.guided(session, session.guide!.settled())
      },
      Math.max(0, Math.min(quiet, capped)),
    )
  }

  /** A settled screen with no known step: the native account decides whether it is signed in. */
  private async identifyScreen(session: AccountSession) {
    const signal = session.guideControl!.signal
    let identity: AccountEvidence | undefined
    try {
      identity = await this.readEvidence(session, signal)
    } catch {
      // The unconfirmed read is quarantined; nothing is typed on a guess.
      return
    }
    if (signal.aborted || session.state !== 'running' || session.stopping) return
    this.guided(session, session.guide!.identified(identity))
  }

  /** The sign-out command the plugin types for the user (2026-10-26 request) in a CLI without a logout subcommand. */
  private async logOut(session: AccountSession, command: string) {
    const signal = session.guideControl!.signal
    try {
      // Let the input box take focus after its first full draw.
      await sleep(AGY_GUIDE_TIMING.commandDelayMs, undefined, { signal })
      if (session.state !== 'running' || session.stopping) return
      await session.terminal.write(command)
      await sleep(AGY_GUIDE_TIMING.commandDelayMs, undefined, { signal })
      if (session.state !== 'running' || session.stopping) return
      await session.terminal.write('\r')
      // The first Enter may only accept the slash-command completion. Never press it
      // again once the account is gone or agy shows its login menu (Enter would sign in).
      await sleep(AGY_GUIDE_TIMING.confirmEnterMs, undefined, { signal })
      const identity = await this.readEvidence(session, signal)
      signal.throwIfAborted()
      if (
        identity?.state === 'authenticated' &&
        session.guide!.retryEnter() &&
        session.state === 'running' &&
        !session.stopping
      )
        await session.terminal.write('\r')
    } catch {
      if (!signal.aborted) this.guided(session, session.guide!.unconfirmed('logout'))
      return
    }
    await this.confirmAccount(session, 'logout')
  }

  /** A browser or device authorization the CLI waits for without exiting: read the account until it signs in. */
  private async watchAccount(session: AccountSession) {
    const signal = session.guideControl!.signal
    const until = Date.now() + AGY_GUIDE_TIMING.authorizeWatchMs
    const guide = session.guide!
    try {
      const before = await session.before
      while (Date.now() < until && session.state === 'running' && !session.stopping) {
        await sleep(AGY_GUIDE_TIMING.watchPollMs, undefined, { signal })
        const after = await this.readEvidence(session, signal)
        signal.throwIfAborted()
        if (guide.proves('login', before, after, session.exitCode)) {
          await this.proven(session, 'login', signal)
          return
        }
      }
    } catch {
      // Closing the window aborts it; the login stays the user's to finish.
    }
  }

  /** The native account state, not terminal text, decides that a login or logout took effect. */
  private async confirmAccount(session: AccountSession, change: AccountChange, exited = false) {
    const signal = session.guideControl!.signal
    const until = Date.now() + (change === 'login' ? AGY_GUIDE_TIMING.loginConfirmMs : AGY_GUIDE_TIMING.logoutConfirmMs)
    const guide = session.guide!
    try {
      const before = await session.before
      while (Date.now() < until) {
        await sleep(AGY_GUIDE_TIMING.pollMs, undefined, { signal })
        const after = await this.readEvidence(session, signal)
        signal.throwIfAborted()
        if (guide.proves(change, before, after, session.exitCode)) {
          // Nothing is left for the user to do in the native terminal.
          await this.proven(session, change, signal)
          return
        }
        // A finished process will not change the account any more.
        if (exited && after) break
      }
    } catch (error) {
      // Closing the window aborts the poll; an unconfirmed read ends it as unconfirmed.
      if (signal.aborted || !(error instanceof ProcessCleanupUnconfirmedError)) return
    }
    this.guided(session, guide.unconfirmed(change))
  }

  async resize(parent: string, id: string, cols: number, rows: number): Promise<void> {
    const session = this.owned(parent, id)
    if (
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols < 10 ||
      cols > 500 ||
      rows < 5 ||
      rows > 200
    )
      throw new Error('无效的终端尺寸')
    if (session.state !== 'running' || session.stopping) return
    try {
      await session.terminal.resize(cols, rows)
      session.guide?.resize?.(cols, rows)
    } catch {
      throw new Error('无法调整账号终端尺寸，请重新打开')
    }
  }

  async stop(parent: string, id: string): Promise<void> {
    await this.finish(this.owned(parent, id), 'closed', '账号终端已关闭')
  }

  /** Close one Agent lifetime, including startup; a later Agent with the same ID gets a fresh scope. */
  closeParent(parent: string): Promise<void> {
    const scope = this.parents.get(parent)
    const previous = this.parentClosings.get(parent)
    if (!scope && previous) return previous
    if (scope) {
      this.parents.delete(parent)
      scope.controller.abort()
    }
    // Capture this generation before yielding. Never close a newly reactivated
    // parent merely because its ID equals the one whose disposal is in flight.
    const captured = [...this.sessions.values()].filter(
      (session) =>
        session.parent === parent && (!scope || session.scope === scope || session.state === 'failed'),
    )
    const operation = (async () => {
      await Promise.allSettled(scope ? [...scope.pending] : [])
      const owned = new Set(captured)
      if (scope) for (const session of this.sessions.values()) if (session.scope === scope) owned.add(session)
      const cleanup = [...owned].map(async (session) => {
        await this.finish(session, 'closed', '主会话已关闭')
        clearTimeout(session.expiry)
        session.frames.length = 0
        this.sessions.delete(session.id)
      })
      if (previous) cleanup.push(previous)
      const results = await Promise.allSettled(cleanup)
      if (
        results.some((result) => result.status === 'rejected') ||
        [...this.unsafeTerminals.values()].includes(parent)
      )
        throw new Error('此主会话的账号终端尚未确认完全退出')
    })()
    this.parentClosings.set(parent, operation)
    void operation
      .finally(() => {
        if (this.parentClosings.get(parent) === operation) this.parentClosings.delete(parent)
      })
      .catch(() => undefined)
    return operation
  }

  private finish(session: AccountSession, state: 'closed' | 'failed', message: string): Promise<void> {
    if (session.cleanup) return session.cleanup
    session.stopping = true
    session.guideControl?.abort()
    clearTimeout(session.settleTimer)
    clearTimeout(session.deadline)
    clearTimeout(session.attachDeadline)
    session.cleanup = (async () => {
      try {
        await this.endForeground(session)
        await session.terminal.terminate()
        await session.output
        await session.release?.()
        session.state = state
        this.emit(session, { status: state, message, cleanupConfirmed: true })
        this.reserved.delete(session.cli)
        session.expiry = setTimeout(() => {
          session.frames.length = 0
          this.sessions.delete(session.id)
        }, 60_000)
        session.expiry.unref?.()
        const retained = [...this.sessions.values()].filter((item) => item.expiry !== undefined)
        for (const stale of retained.slice(0, Math.max(0, retained.length - 16))) {
          clearTimeout(stale.expiry)
          stale.frames.length = 0
          this.sessions.delete(stale.id)
        }
      } catch {
        session.state = 'failed'
        this.emit(session, { status: 'failed', message: '账号终端清理失败，请重试关闭' })
        session.cleanup = undefined
        throw new Error('账号终端尚未确认完全退出')
      }
    })()
    return session.cleanup
  }

  /**
   * A CLI that never reaped a finished helper (agy's browser opener after
   * /login) keeps a zombie descendant, and the macOS provider then refuses to
   * stop the session without signalling the CLI. Ending it first lets the
   * system reap the zombie; terminate() still owns every remaining member.
   */
  private async endForeground(session: AccountSession): Promise<void> {
    if (process.platform === 'win32' || session.exited) return
    try {
      await session.terminal.signalForeground('SIGTERM')
    } catch {
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      session.terminal.done.then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((resolve) => (timer = setTimeout(resolve, this.config.graceMs))),
    ])
    clearTimeout(timer)
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation)
    void operation.finally(() => this.pending.delete(operation)).catch(() => undefined)
    return operation
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.controller.abort()
    this.closing = (async () => {
      await Promise.allSettled([...this.pending])
      await Promise.allSettled([...this.parentClosings.values()])
      const results = await Promise.allSettled(
        [...this.sessions.values()].map((session) => this.finish(session, 'closed', '插件已关闭')),
      )
      for (const session of this.sessions.values()) {
        clearTimeout(session.deadline)
        clearTimeout(session.attachDeadline)
        clearTimeout(session.expiry)
        session.frames.length = 0
      }
      const failures = results.filter((result) => result.status === 'rejected')
      if (failures.length || this.unsafeTerminals.size) throw new Error('部分账号终端尚未确认完全退出')
      this.sessions.clear()
      this.reserved.clear()
      this.parents.clear()
    })()
    return this.closing
  }
}
