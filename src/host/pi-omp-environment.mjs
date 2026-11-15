import { removeTemporaryTree, prepareOmpNativesDirectory, markTemporaryTreeActive } from './temporary-tree.mjs'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, realpath } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { nativeLaunchArgv } from './native-launch.mjs'

const capture = promisify(execFile)
// Native Pi/OMP shell discovery needs these installation roots even when PATH only has Git/cmd.
export const WINDOWS_PROGRAM_DIRECTORY_KEYS = ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432']
export const windowsProgramDirectories = () => Object.fromEntries(WINDOWS_PROGRAM_DIRECTORY_KEYS
  .flatMap(key => process.env[key] ? [[key, process.env[key]]] : []))

export const OMP_APPROVAL_UNAVAILABLE = 'OMP 原生询问模式不可用，已拒绝启动；请检查安装版本'

/** OMP 18's startup-cwd accepts --cwd; Pi 1.5 uses the spawned process cwd.
 * Git metadata/context may describe an ancestor repository. Name the actual
 * Worker project explicitly without replacing either CLI's native prompt.
 */
export function piOmpWorkspace(cli, project) {
  return {
    argv: cli === 'omp' ? ['--cwd', project] : [],
    env: { PWD: project },
    guidance: `Worker project directory: ${JSON.stringify(project)}.\n` +
      'For this task, "current project" and "project root" mean this Worker directory. ' +
      'Resolve relative file paths and use this directory as the default tool working directory, including an explicit bash cwd. ' +
      'An enclosing Git repository or inherited project instructions do not change the Worker project directory. ' +
      'Work outside it only when explicitly requested by the user.',
  }
}

/** Help is installation evidence only; never expose the account snapshot to this probe. */
export async function probeOmpApprovalModes(executable, signal, nativesDirectory) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cliworker-omp-approval-')))
  markTemporaryTreeActive(root)
  try {
    await mkdir(join(root, 'agent'), { mode: 0o700 })
    const env = Object.fromEntries([...WINDOWS_PROGRAM_DIRECTORY_KEYS, 'PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'ComSpec', 'PATHEXT', ...Object.keys(process.env).filter(key => /^(?:https?|all|no)_proxy$/i.test(key))]
      .flatMap(key => process.env[key] ? [[key, process.env[key]]] : []))
    Object.assign(env, { PI_NATIVES_DIR: nativesDirectory ?? await prepareOmpNativesDirectory(), HOME: root, USERPROFILE: root, PI_CODING_AGENT_DIR: join(root, 'agent'),
      PI_CONFIG_DIR: 'config', OMP_PROFILE: '', PI_PROFILE: '', TMPDIR: root, TMP: root, TEMP: root,
      PI_OFFLINE: '1', PI_TELEMETRY: '0', ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' })
    const argv = nativeLaunchArgv([executable, '--help'])
    const { stdout } = await capture(argv[0], argv.slice(1), { cwd: root, env, signal,
      timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, windowsHide: true })
    const values = /--approval-mode[^\r\n]*\(([^)\r\n]+)\)/u.exec(stdout)?.[1]?.split('|') ?? []
    return ['always-ask', 'write', 'yolo'].filter(mode => values.map(value => value.trim()).includes(mode))
  } catch {
    return []
  } finally {
    await removeTemporaryTree(root)
  }
}

/** Select only a supported mode at or below the requested authority. */
export function ompPermissionSettings(access, supported) {
  const requested = access === 'danger-full-access' ? 'yolo' : access === 'read-only' ? 'always-ask' : 'write'
  const candidates = requested === 'yolo' ? ['yolo', 'write', 'always-ask'] : requested === 'write' ? ['write', 'always-ask'] : ['always-ask']
  const mode = candidates.find(value => supported.includes(value))
  if (!mode) throw new Error(OMP_APPROVAL_UNAVAILABLE)
  return {
    mode,
    // Explicit policies beat inherited per-tool overrides in OMP's config merge.
    tools: { approvalMode: mode, approval: mode === 'always-ask'
      ? { write: 'prompt', edit: 'prompt', bash: 'prompt' }
      : mode === 'write' ? { bash: 'prompt' } : {} },
    ...(mode !== requested ? { notice: mode === 'always-ask'
      ? 'OMP 原生目标权限模式不可用，本轮按询问运行'
      : 'OMP 原生完全权限不可用，本轮按自动批准编辑运行' } : {}),
  }
}

/** OMP 16 resolves its config root with join(os.homedir(), PI_CONFIG_DIR).
 * Windows roots on another drive cannot be expressed relative to the real home.
 * Rebase only this child environment; Host account discovery retains the real home.
 */
export function ompConfigurationEnvironment(configRoot) {
  if (typeof configRoot !== 'string' || !configRoot.trim() || configRoot.includes('\0'))
    throw new Error('Invalid OMP configuration root')
  const root = resolve(configRoot)
  if (process.platform === 'win32')
    return { HOME: dirname(root), USERPROFILE: dirname(root), PI_CONFIG_DIR: basename(root) }
  return { PI_CONFIG_DIR: relative(homedir(), root) }
}
