import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { nativeLaunchArgv } from './native-launch.mjs'

const capture = promisify(execFile)
export const OMP_APPROVAL_UNAVAILABLE = 'OMP 原生询问模式不可用，已拒绝启动；请检查安装版本'

/** Help is installation evidence only; never expose the account snapshot to this probe. */
export async function probeOmpApprovalModes(executable, signal) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cliworker-omp-approval-')))
  try {
    await mkdir(join(root, 'agent'), { mode: 0o700 })
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'ComSpec', 'PATHEXT']
      .flatMap(key => process.env[key] ? [[key, process.env[key]]] : []))
    Object.assign(env, { HOME: root, USERPROFILE: root, PI_CODING_AGENT_DIR: join(root, 'agent'),
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
    await rm(root, { recursive: true, force: true })
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
