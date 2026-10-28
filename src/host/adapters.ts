import { StringDecoder } from 'node:string_decoder'
import { qoderVariant } from './qoder-variant.ts'
import { readClaudeOwnRoute, claudeNativeSettingsArguments } from './claude-own-route.ts'
import { discoverClaudeNativeOAuth } from './claude-native-oauth.ts'
import { discoverCodexModels } from './codex-models.ts'
import { readCodexCustomRouteVersion } from './cli-account-binding.ts'
import { discoverAgyAccountModels } from './agy-models.ts'
import { agyBackgroundEnvironment } from './agy-background-environment.ts'
import { discoverQoderModels } from './qoder-accounts.ts'
import { discoverFirstPartySources, readFirstPartyModelSources } from './first-party-models.ts'
import { nativeAgyAccountIdentity } from './agy-windows-account.ts'
import { extendedCatalog, isExtendedCli } from './extended-adapters.ts'
import { ZCodeProtocol, managedZCodeEntry } from './zcode-adapter.ts'
import { HermesProtocol } from './hermes-adapter.ts'
import { GrokProtocol } from './grok-adapter.ts'
import { OpenCodeProtocol } from './opencode-adapter.ts'
import { BridgeProtocol } from './bridge-protocol.ts'
import { verifyPiOmpExecutable } from './pi-omp-identity.ts'
import {
  findWindowsCodexAppx,
  hasWindowsHermesInstallDirectory,
  presentWindowsCliCandidate,
  windowsQoderCliEntry,
  rejectWindowsQoderCrossVariant,
  windowsCliCommands,
  validateWindowsCliCandidate,
  WindowsCliInstallationError,
  WindowsCliNotFoundError,
} from './windows-cli-installation.ts'
import { findWindowsPathCommand } from './windows-cli-path.ts'
import { findWindowsDesktopCli, windowsOpenCodeDesktopCli } from './windows-desktop-cli-installation.ts'
import { resolveModel } from '../shared/models.ts'
import { existsSync, statSync, lstatSync, accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import {
  CLI_LABELS,
  EFFORTS,
  cliOf,
  type CliId,
  type ModelChoice,
  type Preference,
  type TaskMode,
} from '../shared/types.ts'
import { AgyProtocol, type EventInput } from './protocol.ts'
import { CliProtocol } from './cli-protocol.ts'
import type { NativeAccess } from './native-approval-policy.ts'
import {
  agyArguments,
  ProcessCleanupUnconfirmedError,
  type ProcessBackend,
  type RuntimeConfig,
} from './process.ts'

export interface Catalog {
  cli: CliId
  models: ModelChoice[]
  notice: string
}
const managedPiEntry = () =>
  join(
    homedir(),
    '.local/share/cliworker-now/runtimes/pi-1.0.2/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
  )
function entryPresent(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error: any) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false
    throw error
  }
}
export const executableFor = (cli: CliId, config: RuntimeConfig): string => {
  if (cli === 'harness') throw new Error('Harness CLI 已移除，请新建 Hermes 任务')
  const configured = configuredCliExecutable(cli, config)
  if (configured) return configured
  // A deployed standalone runtime is shared across platforms.
  if (cli === 'zcode' && entryPresent(managedZCodeEntry())) return managedZCodeEntry()
  if (process.platform === 'win32')
    return presentWindowsCliCandidate(cli) ?? windowsCliCommands(cli)[0]!
  if (cli === 'antigravity') return config.executable
  if (cli === 'zcode') return '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs'
  if (cli === 'grok') return join(homedir(), '.grok/bin/grok')
  if (cli === 'pi') {
    const native = join(homedir(), '.local/bin/pi')
    if (entryPresent(native)) return native
    const official = join(homedir(), '.pi/agent/bin/pi')
    if (entryPresent(official)) return official
  }
  // Desktop processes do not source .zshrc. Recognize official per-user installers.
  const nativeDirectory = cli === 'kimi' ? '.kimi-code/bin' : cli === 'mimo' ? '.mimocode/bin' : '.local/bin'
  const nativePath = join(homedir(), nativeDirectory, cli)
  return existsSync(nativePath) ? nativePath : (configured ?? cli)
}
/** Read-only discovery with bounded output. Never persist or expose provider credentials. */
export async function captureCatalogMetadata(
  backend: ProcessBackend,
  config: RuntimeConfig,
  argv: string[],
  cwd: string,
  signal: AbortSignal,
  env?: Record<string, string>,
  allowedExitCodes: readonly number[] = [0],
) {
  signal.throwIfAborted()
  const control = AbortSignal.any([signal, AbortSignal.timeout(15000)])
  const process = backend.spawn({
    argv,
    cwd,
    env,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: config.graceMs,
    signal: control,
  })
  void process.done.catch(() => undefined)
  let output = '',
    bytes = 0
  const read = async (stream: typeof process.stdout, keep: boolean) => {
    if (!stream) return
    // A multi-byte UTF-8 character may be split across chunks.
    const decoder = new StringDecoder('utf8')
    for await (const chunk of stream) {
      bytes += Buffer.byteLength(chunk)
      if (bytes > config.maxRunBytes) throw new Error('CLI discovery output too large')
      if (keep) output += decoder.write(chunk)
    }
    if (keep) output += decoder.end()
  }
  const readers = [read(process.stdout, true), read(process.stderr, false)]
  try {
    await Promise.all(readers)
    const outcome = await process.done
    control.throwIfAborted()
    if (outcome.exitCode === null || !allowedExitCodes.includes(outcome.exitCode))
      throw new Error('CLI 模型查询失败，请在终端检查该 CLI 配置')
    return output
  } finally {
    let exited = false
    try {
      process.terminate()
      exited = await process.waitForExit()
    } catch {
      throw new ProcessCleanupUnconfirmedError()
    }
    if (!exited) throw new ProcessCleanupUnconfirmedError()
    await Promise.allSettled([...readers, process.done])
  }
}
const capture = captureCatalogMetadata
export async function catalogFor(
  cli: CliId,
  backend: ProcessBackend,
  config: RuntimeConfig,
  cwd: string,
  signal: AbortSignal,
): Promise<Catalog> {
  const executable = await resolveCliExecutable(cli, backend, config, signal)
  signal.throwIfAborted()
  if ((cli === 'qoder' || cli === 'qodercn')) {
    const models = await discoverQoderModels(backend, config, executable, cwd, signal, cli)
    if (!models.length) throw new Error(`${qoderVariant(cli).label} 当前账号暂无可确认模型，请登录或刷新`)
    return { cli, models, notice: `${qoderVariant(cli).label} 原生账号模型目录；调用权限以实际请求为准` }
  }
  if (isExtendedCli(cli)) {
    const models = await extendedCatalog(
      cli,
      executable,
      (argv, env) => capture(backend, config, argv, cwd, signal, env),
      config.stateDirectory ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'cliworker-now'),
      config,
      signal,
      { backend, signal, graceMs: config.graceMs },
    )
    if (!models.length) throw new Error(`${CLI_LABELS[cli]} 当前账号暂无可用模型，请登录或刷新`)
    return {
      cli,
      models,
      notice: '当前账号可用模型',
    }
  }
  if (cli === 'antigravity') {
    const models = await discoverAgyAccountModels(
      () => capture(backend, config, [executable, 'models'], cwd, signal, agyBackgroundEnvironment(cli)),
      signal,
      undefined,
      nativeAgyAccountIdentity(backend, config),
    )
    return { cli, models, notice: '当前账号可用模型' }
  }
  if (cli === 'codex') {
    const relay = (await readCodexCustomRouteVersion(cwd, signal)) !== undefined
    const models = await discoverCodexModels(backend, config, executable, cwd, signal)
    if (!models.length) throw new Error('Codex 当前账号暂无可确认模型，请刷新')
    return { cli, models, notice: relay ? 'Codex 自定义路由模型；来自 Codex 自带列表，中转是否支持以实际调用为准' : '当前账号可用模型' }
  }
  if (cli === 'claude' || cli === 'kimi' || cli === 'mimo') {
    const claudeRoute = cli === 'claude' ? await readClaudeOwnRoute(cwd, signal) : undefined
    if (claudeRoute?.kind === 'native') {
      const { models, quota } = await discoverClaudeNativeOAuth(
        backend,
        config,
        executable,
        cwd,
        signal,
        claudeNativeSettingsArguments(claudeRoute.configDirectory, claudeRoute.suppressedEnvironment),
      )
      return {
        cli,
        models,
        notice:
          quota === 'confirmed'
            ? 'Claude 官方账号当前可用模型'
            : 'Claude 官方账号可用模型；剩余额度暂无法确认，以实际调用为准',
      }
    }
    const sources = await readFirstPartyModelSources(
      cli,
      executable,
      cwd,
      (argv, env) => capture(backend, config, argv, cwd, signal, env),
      signal,
    )
    const models = await discoverFirstPartySources(sources, signal)
    if (!models.length) throw new Error(`${CLI_LABELS[cli]} 当前账号暂无可确认模型，请检查配置`)
    return {
      cli,
      models,
      notice: claudeRoute
        ? 'Claude 路由模型；目录未提供时使用自身配置，远端可用性以实际调用为准'
        : '当前账号可用模型',
    }
  }
  throw new Error('Unsupported CLI')
}
/** Official models --verbose prints provider/model followed by a pretty JSON object. */
export function parseMimoModels(output: string): ModelChoice[] {
  const models: ModelChoice[] = []
  let id = '',
    buffer = ''
  for (const line of output.split(/\r?\n/)) {
    if (!buffer && /^[A-Za-z0-9_.:-]+\/[^\s]+/.test(line)) {
      id = line.split(/\s/)[0]!
      continue
    }
    if (!buffer && line.trim() !== '{') continue
    buffer += line + '\n'
    try {
      const model = JSON.parse(buffer)
      if (id)
        models.push({
          id,
          label: String(model.name ?? id),
          efforts: [
            'default',
            ...Object.keys(model.variants ?? {}).filter((e) => e !== 'default' && EFFORTS.includes(e as any)),
          ] as ModelChoice['efforts'],
        })
      id = ''
      buffer = ''
    } catch {
      /* Wait for the rest of the pretty-printed JSON object. */
    }
  }
  return models
}
export function validatePreference(preference: Preference, catalog: Catalog): void {
  if (cliOf(preference) !== catalog.cli) throw new Error('CLI 配置不匹配')
  resolveModel(preference, catalog.models)
}
export function workerArguments(
  executable: string,
  project: string,
  preference: Preference,
  mode: TaskMode,
  prompt: string,
  timeoutMs: number,
  conversationId?: string,
  nativeTransport = false,
  /** DSH permission tier for this run; absent keeps the historical workspace mapping. */
  access?: NativeAccess,
): string[] {
  const cli = cliOf(preference)
  const task = `任务：\n${prompt}`
  if (cli === 'antigravity')
    return agyArguments(executable, project, preference, mode, prompt, timeoutMs, conversationId)
  if ((cli === 'qoder' || cli === 'qodercn')) {
    if (!nativeTransport) throw new Error('Qoder 仅支持已确认的原生 ACP 通信，请新建任务')
    if (mode === 'plan') throw new Error('Qoder 当前 ACP 未公开只读规划模式，无法安全执行规划任务')
    return [executable, '--acp', '--permission-mode', access === 'danger-full-access' ? 'bypass_permissions' : 'accept_edits', '--model', preference.model]
  }
  if (cli === 'codex')
    return [
      executable,
      'exec',
      ...(conversationId ? ['resume', conversationId] : []),
      '--json',
      '--skip-git-repo-check',
      '--model',
      preference.model,
      '-c',
      `model_reasoning_effort=${JSON.stringify(preference.effort)}`,
      '-c',
      `sandbox_mode=${JSON.stringify(mode === 'plan' ? 'read-only' : (access ?? 'workspace-write'))}`,
      '-c',
      `approval_policy=${JSON.stringify(mode === 'plan' || !access || access === 'danger-full-access' ? 'never' : 'on-request')}`,
      task,
    ]
  if (cli === 'claude')
    return [
      executable,
      '--print',
      '--verbose',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--model',
      preference.model,
      ...(preference.effort !== 'default' ? ['--effort', preference.effort] : []),
      '--permission-mode',
      mode === 'plan' ? 'plan' : access === 'danger-full-access' ? 'bypassPermissions' : 'acceptEdits',
      ...(conversationId ? ['--resume', conversationId] : []),
      task,
    ]
  if (cli === 'kimi') {
    if (mode === 'plan' && !nativeTransport)
      throw new Error('Kimi 当前非交互模式不支持只读派遣，请使用其他 CLI 或明确授权写入任务')
    if (preference.effort !== 'default') throw new Error('Kimi CLI 不支持传入思考强度')
    return [
      executable,
      '--model',
      preference.model,
      '--output-format',
      'stream-json',
      ...(conversationId ? ['--session', conversationId] : []),
      '-p',
      task,
    ]
  }
  if (cli === 'mimo')
    return [
      executable,
      'run',
      '--format',
      'json',
      '--model',
      preference.model,
      '--agent',
      mode === 'plan' ? 'plan' : 'build',
      ...(preference.effort !== 'default' ? ['--variant', preference.effort] : []),
      ...(conversationId ? ['--session', conversationId] : []),
      task,
    ]
  throw new Error(`${CLI_LABELS[cli]} 尚未接入`)
}
export function protocolFor(
  cli: CliId,
  emit: (event: EventInput) => void,
  identify: (id: string) => void,
  maxLineBytes: number,
  expectedModel?: string,
) {
  if (cli === 'harness') throw new Error('Harness CLI 已移除，历史记录仅供查看')
  if ((cli === 'qoder' || cli === 'qodercn')) throw new Error('Qoder 必须通过原生 ACP 桥运行')
  if (cli === 'zcode') return new ZCodeProtocol(emit, identify, maxLineBytes, expectedModel)
  if (cli === 'hermes') return new HermesProtocol(emit, identify, maxLineBytes)
  if (cli === 'grok') return new GrokProtocol(emit, identify, maxLineBytes)
  if (cli === 'opencode') return new OpenCodeProtocol(emit, identify, maxLineBytes)
  if (cli === 'pi' || cli === 'omp') return new BridgeProtocol(emit, identify, maxLineBytes)
  return cli === 'antigravity'
    ? new AgyProtocol(emit, identify, maxLineBytes)
    : new CliProtocol(cli, emit, identify, maxLineBytes)
}

export function configuredCliExecutable(cli: CliId, config: RuntimeConfig): string | undefined {
  if (cli === 'harness') return undefined
  const value = cli === 'antigravity' ? config.executable : config[`${cli}Executable`]
  return value && value !== (cli === 'antigravity' ? 'agy' : cli) ? value : undefined
}

function configWithExecutable(cli: CliId, config: RuntimeConfig, path: string): RuntimeConfig {
  return { ...config, [cli === 'antigravity' ? 'executable' : `${cli}Executable`]: path }
}

/** Reuse a verified location; discovery never overwrites a later manual choice. */
export async function resolveCliExecutable(
  cli: CliId,
  backend: ProcessBackend,
  config: RuntimeConfig,
  signal: AbortSignal = AbortSignal.timeout(15000),
): Promise<string> {
  signal.throwIfAborted()
  const store = config.cliExecutablePaths
  if (!store || cli === 'harness') return resolveUncachedCliExecutable(cli, backend, config, signal)
  let entry = store.read(cli)
  const deployment = configuredCliExecutable(cli, config)
  if (entry?.mode === 'auto' && !deployment) {
    let present: boolean
    try {
      present = statSync(entry.path).isFile()
      if (present) accessSync(entry.path, constants.R_OK)
    } catch (error: any) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error
      present = false
    }
    if (!present) {
      store.reset(cli)
      entry = undefined
    }
  }
  const revision = store.revision(cli)
  const selected = entry?.mode === 'manual' ? entry.path : deployment ? undefined : entry?.path
  const result = await resolveUncachedCliExecutable(
    cli,
    backend,
    selected ? configWithExecutable(cli, config, selected) : config,
    signal,
    entry?.mode === 'auto' && !deployment,
  )
  signal.throwIfAborted()
  const current = store.read(cli)
  if (store.revision(cli) !== revision) {
    // Concurrent identical initial discovery is harmless; a new manual source
    // or any different location must not admit work from this old request.
    if (current?.mode === 'auto' && current.path === result && entry?.mode !== 'manual') return result
    throw new Error('CLI 路径已更新，请刷新后重试')
  }
  if (entry?.mode !== 'manual' && !deployment && !store.remember(cli, result, revision))
    throw new Error('CLI 路径已更新，请刷新后重试')
  return result
}

async function resolveUncachedCliExecutable(
  cli: CliId,
  backend: ProcessBackend,
  config: RuntimeConfig,
  signal: AbortSignal = AbortSignal.timeout(15000),
  automaticSelection = false,
): Promise<string> {
  signal.throwIfAborted()
  const executable = executableFor(cli, config)
  const explicit = !!configuredCliExecutable(cli, config)
  const desktopCli = process.platform === 'win32' && (cli === 'zcode' || cli === 'opencode')
  let resolved: string
  if ((isExtendedCli(cli) || (cli === 'qoder' || cli === 'qodercn')) && /\.[cm]?js$/.test(executable) && existsSync(executable)) {
    // JavaScript launchers run through Node and need readability, not an executable bit.
    // A directory ending in .js is a broken configuration, not an installed CLI.
    if (!statSync(executable).isFile()) throw new Error('CLI 脚本路径不是普通文件')
    accessSync(executable, constants.R_OK)
    resolved = executable
  } else {
    const lookup = async () => {
      try {
        return await backend.resolveExecutable(executable)
      } catch (error: any) {
        // Only an absent default PATH entry can use the legacy private install.
        // A broken or incompatible native/configured entry must remain an error.
        if (cli === 'pi' && executable === 'pi' && ['ENOENT', 'ENOTDIR'].includes(error.code)) {
          const managed = managedPiEntry()
          if (existsSync(managed) && statSync(managed).isFile()) {
            accessSync(managed, constants.R_OK)
            return managed
          }
        }
        throw error
      }
    }
    // Path lookup owns no process; it may be abandoned, but no late resolution
    // may start an identity probe after its caller has cancelled.
    const pathLookup = (read: () => Promise<string>) =>
      new Promise<string>((resolve, reject) => {
        const abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
        void read()
          .then(resolve, reject)
          .finally(() => signal.removeEventListener('abort', abort))
        if (signal.aborted) abort()
      })
    try {
      resolved = await pathLookup(lookup)
    } catch (error: any) {
      signal.throwIfAborted()
      const absent =
        error instanceof SubprocessExecutableNotFoundError || ['ENOENT', 'ENOTDIR'].includes(error.code)
      const refreshPath =
        process.platform === 'win32' && cli !== 'harness' && !explicit &&
        executable === windowsCliCommands(cli)[0] && absent
      const refreshed = refreshPath
        ? await findWindowsPathCommand(
            windowsCliCommands(cli),
            (argv, cwd) => captureCatalogMetadata(
              backend, { ...config, maxRunBytes: Math.min(config.maxRunBytes, 131_072) }, argv, cwd, signal,
            ),
            signal,
          )
        : undefined
      signal.throwIfAborted()
      if (refreshed) {
        const entry = validateWindowsCliCandidate(cli as Exclude<CliId, 'harness'>, refreshed)
        resolved = /\.[cm]?js$/i.test(entry) ? entry : await pathLookup(() => backend.resolveExecutable(entry))
      } else if (refreshPath && cli === 'hermes' && hasWindowsHermesInstallDirectory())
        throw new WindowsCliInstallationError('检测到 Hermes 安装目录，但未找到可用 CLI 入口，请完成安装或配置已有入口')
      else if (process.platform === 'win32' && (cli === 'qoder' || cli === 'qodercn') && executable === qoderVariant(cli).executable && !explicit && absent) {
        try { resolved = await pathLookup(() => backend.resolveExecutable(cli)) } catch (legacy: any) {
          signal.throwIfAborted()
          if (legacy instanceof SubprocessExecutableNotFoundError || ['ENOENT', 'ENOTDIR'].includes(legacy.code))
            throw new WindowsCliNotFoundError(cli)
          throw legacy
        }
      } else if (desktopCli && executable === cli && !explicit && absent) {
        const entry = await findWindowsDesktopCli(
          cli,
          (argv, cwd) =>
            captureCatalogMetadata(
              backend,
              { ...config, maxRunBytes: Math.min(config.maxRunBytes, 65_536) },
              argv,
              cwd,
              signal,
            ),
          signal,
        )
        signal.throwIfAborted()
        if (!entry) throw new WindowsCliNotFoundError(cli)
        // The helper already checked the current, readable CJS file. Do not
        // ask PATH to rediscover it or interpret a Desktop executable as a task.
        resolved = /\.[cm]?js$/i.test(entry)
          ? entry
          : await pathLookup(() => backend.resolveExecutable(entry))
      } else {
        if (process.platform !== 'win32' || cli !== 'codex' || executable !== cli || !absent) throw error
        // Appx metadata owns a child process. Unlike pure PATH lookup, cancellation
        // must await its cleanup and preserve ProcessCleanupUnconfirmedError.
        const entry = await findWindowsCodexAppx(
          (argv, cwd) => captureCatalogMetadata(backend, config, argv, cwd, signal),
          signal,
        )
        signal.throwIfAborted()
        if (!entry) throw error
        resolved = await pathLookup(() => backend.resolveExecutable(entry))
      }
    }
  }
  signal.throwIfAborted()
  if (process.platform === 'win32' && (cli === 'qoder' || cli === 'qodercn')) {
    rejectWindowsQoderCrossVariant(resolved, cli)
    if (!explicit || automaticSelection) resolved = windowsQoderCliEntry(resolved, cli)
  }
  if (process.platform === 'win32' && cli === 'opencode') {
    const bundled = windowsOpenCodeDesktopCli(resolved, explicit)
    if (bundled) resolved = bundled
  }
  if (cli === 'pi' || cli === 'omp')
    return verifyPiOmpExecutable(cli, resolved, (argv, cwd, env) =>
      captureCatalogMetadata(backend, config, argv, cwd, signal, env),
    )
  return resolved
}
