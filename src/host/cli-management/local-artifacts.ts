import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ActiveCliId } from '../../shared/types.ts'
import type { InstallationIdentity } from './identity.ts'
import type { ProcessBackend, RuntimeConfig } from '../process.ts'
import type { hostFetch } from '../host-fetch.mjs'
import type { downloadCliArtifact } from './download.ts'
import { ReleaseClient, updateAvailable } from './versions.ts'
import { LOCAL_INSTALLERS } from './sources.ts'
import { CliOperationError } from './planner.ts'
import { canPrepareWindowsUpdate, prepareWindowsUpdate } from './windows-artifacts.ts'
import { describeWindowsUpdate } from './artifacts/windows.ts'
import { describeUnixUpdate } from './artifacts/local.ts'
import { prepareArtifactBundle } from './artifacts/bundle.ts'
type DownloadOptions = Parameters<typeof downloadCliArtifact>[0]
export interface LocalArtifactOptions {
  cli: ActiveCliId; version: string; beforeVersion?: string; identity?: InstallationIdentity; root: string
  backend: ProcessBackend; config: RuntimeConfig; releases: ReleaseClient; signal: AbortSignal
  fetcher?: typeof hostFetch; output(value: string): void; progress: DownloadOptions['progress']
  platform?: NodeJS.Platform; arch?: string; allowSourceSwitch?: boolean
  home?: string; localAppData?: string
}
export interface LocalArtifactInstall {
  targetVersion: string; argv: string[]; env?: Record<string, string>; cleanup(): Promise<void>
  /** Host placement or an official offline installer, after the service's admission recheck. */
  install?(signal: AbortSignal, run: (argv: string[], signal: AbortSignal) => Promise<void>): Promise<void>
}
const invalid = (message: string): never => { throw new CliOperationError('INTEGRITY_MISMATCH', message) }


/** Select only layouts the official installer will update in place. Other owners
 * retain their original updater. All remote addresses below are built in. */
export function canPrepareLocalUpdate(cli: ActiveCliId, identity: InstallationIdentity | undefined, platform = process.platform, arch: string = process.arch, home = homedir(), localAppData = process.env.LOCALAPPDATA): boolean {
  if (platform === 'win32') return canPrepareWindowsUpdate(cli, identity, arch, home, localAppData)
  if (!['darwin', 'linux'].includes(platform) || !['arm64', 'x64'].includes(arch)) return false
  // MiMo approval covers the official macOS zip; Linux keeps its native updater.
  if (cli === 'mimo' && platform !== 'darwin') return false
  if (cli !== 'mimo' && cli !== 'opencode' && cli !== 'omp' || !identity || identity.source !== 'self-update') return false
  const expected = join(home, LOCAL_INSTALLERS[cli].entry)
  return identity.executable === expected || identity.fingerprint.realpath === expected
}

export async function describeLocalUpdate(options: LocalArtifactOptions, directory: string) {
  const platform = options.platform ?? process.platform
  if (!canPrepareLocalUpdate(options.cli, options.identity, platform, options.arch, options.home, options.localAppData)) throw new CliOperationError('PREREQUISITE_MISSING', '此安装布局没有已核实的本地工件入口')
  return platform === 'win32' ? describeWindowsUpdate(options, directory) : describeUnixUpdate(options, directory)
}
export async function prepareLocalUpdate(options: LocalArtifactOptions): Promise<LocalArtifactInstall> {
  if (options.beforeVersion && !updateAvailable(options.beforeVersion, options.version)) throw new CliOperationError('PLAN_EXPIRED', '接管目标版本必须高于已装版本')
  const platform = options.platform ?? process.platform
  if (!canPrepareLocalUpdate(options.cli, options.identity, platform, options.arch, options.home, options.localAppData)) throw new CliOperationError('PREREQUISITE_MISSING', '此安装布局没有已核实的本地工件入口')
  if (platform === 'win32') return prepareWindowsUpdate(options)
  const result = await prepareArtifactBundle(options, (directory, signal) => describeUnixUpdate({ ...options, signal }, directory))
  if (options.cli === 'mimo') options.output('MiMo 已校验官方长度、content-md5 与 zip 结构（解压 CRC）；MD5 来自同源响应，不代表独立签名验证。\n')
  options.output(`已接管 ${options.cli} 官方工件下载；安装由官方 --binary 入口执行。\n`)
  return result
}
