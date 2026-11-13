import { createHash } from 'node:crypto'
import { join, isAbsolute, win32 } from 'node:path'
import type { ActiveCliId } from '../../shared/types.ts'
import { type CliOperationErrorCode } from '../../shared/cli-management.ts'
import type { ProcessBackend } from '../process.ts'
import type { InstallationIdentity } from './identity.ts'
import { CLI_SOURCES, NATIVE_UPDATES, isDesktopCli } from './sources.ts'
import { compatible, validUpdateVersion, updateAvailable, compareVersions } from './versions.ts'
import { resolveNpmRuntime } from './npm.ts'
import type { DesktopRelease } from './desktop-update.ts'

export class CliOperationError extends Error {
  constructor(readonly code: CliOperationErrorCode, message: string) { super(`${code}：${message}`) }
}
export type CliMethod = 'npm' | 'brew' | 'self-update' | 'official-script' | 'desktop'
export interface CliOperationPlan {
  cli: ActiveCliId; intent: 'update'; method: CliMethod; identity: InstallationIdentity
  beforeVersion: string; targetVersion: string; registry: string; token: string
  pinsVersion: boolean
  desktopRelease?: DesktopRelease
}
export function automaticMethod(cli: ActiveCliId, identity: InstallationIdentity): CliMethod | undefined {
  const s = CLI_SOURCES[cli]
  if (identity.source === 'npm' && s.npm) return 'npm'
  if (identity.source === 'brew' && s.brew) return 'brew'
  if (identity.source === 'desktop-app' && isDesktopCli(cli)) return 'desktop'
  if (identity.source === 'official-installer' && NATIVE_UPDATES[cli]?.script) return 'official-script'
  if (identity.source === 'official-installer' && s.update) return 'self-update'
  if (identity.source === 'self-update' && s.update) return 'self-update'
}
export function operationToken(cli: ActiveCliId, identity: InstallationIdentity, target: string | undefined, registry: string, before = identity.manifestVersion, desktopRelease?: DesktopRelease): string {
  return createHash('sha256').update(JSON.stringify([process.platform, cli, 'update', identity, before, target, registry, automaticMethod(cli, identity), NATIVE_UPDATES[cli], desktopRelease])).digest('hex')
}
export function updateProblem(cli: ActiveCliId, identity: InstallationIdentity, platform = process.platform, arch = process.arch): string | undefined {
  if (['winget', 'scoop', 'nix', 'bun', 'pnpm'].includes(identity.source)) return `此安装由 ${identity.source} 管理，请使用原包管理器更新。`
  if (identity.source === 'unknown') return '没有识别出安装方式，请核实官方安装入口后重新检查。'
  if (!['darwin', 'linux', 'win32'].includes(platform)) return '此操作系统尚无已核实的官方更新方法。'
  if ((cli === 'qoder' || cli === 'qodercn') && platform === 'win32' && arch === 'arm64') return 'Qoder Windows ARM64 尚未核实支持，不能自动更新。'
  const method = automaticMethod(cli, identity), script = NATIVE_UPDATES[cli]?.script
  if (method === 'official-script' && script && !script.platforms.includes(platform)) return '此平台的官方安装器锁版和无交互参数尚未核实。'
  if (method === 'self-update' && cli === 'traecn' && identity.channel !== 'public') return `TRAE 安装通道 ${identity.channel ?? '未知'} 尚无已核实的对应官方发布源，不能切换为 public。`
  if (!method) return '此安装渠道没有已核实的自动更新方法。'
}
export function planCliOperation(cli: ActiveCliId, intent: 'update', identity: InstallationIdentity | undefined, before: string | undefined, target: string | undefined, registry: string, desktopRelease?: DesktopRelease): CliOperationPlan {
  const method = identity && automaticMethod(cli, identity)
  if (!identity || !method) throw new CliOperationError('PREREQUISITE_MISSING', '安装归属或自动更新方法尚未核实，请按官方说明手动更新')
  const problem = updateProblem(cli, identity)
  if (problem) throw new CliOperationError('PREREQUISITE_MISSING', problem)
  if (!validUpdateVersion(cli, before) || !validUpdateVersion(cli, target) || !compatible(cli, target) || !updateAvailable(before, target)) throw new CliOperationError('PLAN_EXPIRED', '目标版本尚未核实或未适配，请重新检查更新')
  if ((method === 'npm' || method === 'brew') && (!identity.prefix || !(isAbsolute(identity.prefix) || win32.isAbsolute(identity.prefix))))
    throw new CliOperationError('PREREQUISITE_MISSING', '无法确认原安装前缀，请按原安装渠道手动更新')
  const pinsVersion = method === 'npm' || method === 'desktop' || method === 'official-script' || method === 'self-update' && !!NATIVE_UPDATES[cli]?.pinsVersion
  return { cli, intent, identity, method, beforeVersion: before, targetVersion: target, registry, pinsVersion, desktopRelease, token: operationToken(cli, identity, target, registry, before, desktopRelease) }
}
/** npm's runtime is independent; only the target prefix belongs to the CLI. */
export async function operationArgv(plan: CliOperationPlan, backend: ProcessBackend, artifact?: string, platform = process.platform): Promise<string[]> {
  const s = CLI_SOURCES[plan.cli], path = platform === 'win32' ? win32 : { join }
  if (plan.method === 'npm') {
    if (!artifact || !(isAbsolute(artifact) || win32.isAbsolute(artifact)) || !artifact.endsWith('.tgz')) throw new CliOperationError('PREREQUISITE_MISSING', '缺少已校验的本地主包文件')
    let npm: [string, string]
    try { npm = await resolveNpmRuntime(backend, platform) }
    catch { throw new CliOperationError('PREREQUISITE_MISSING', '无法核实 Node/npm 安装，请检查 Node 运行时与 npm-cli.js') }
    return [...npm, 'install', '--global', '--prefix', plan.identity.prefix!, artifact, '--registry', plan.registry]
  }
  if (plan.method === 'brew') {
    const brew = await backend.resolveExecutable(path.join(plan.identity.prefix!, 'bin', 'brew'))
    return [brew, 'upgrade', ...(s.brew!.kind === 'cask' ? ['--cask'] : []), s.brew!.tap ? `${s.brew!.tap}/${s.brew!.name}` : s.brew!.name]
  }
  if (plan.method === 'desktop') throw new CliOperationError('PREREQUISITE_MISSING', '桌面更新必须由专用执行器处理')
  const update = NATIVE_UPDATES[plan.cli]
  if (!update) throw new CliOperationError('PREREQUISITE_MISSING', '缺少官方更新参数')
  const args = update.argv.map(arg => arg === '%VERSION%' ? plan.targetVersion : arg === '%CHANNEL%' ? plan.identity.channel! : arg)
  if (plan.method === 'official-script') {
    if (!artifact || !isAbsolute(artifact) || !artifact.endsWith('.sh')) throw new CliOperationError('PREREQUISITE_MISSING', '缺少已下载的官方脚本')
    return [update.script!.interpreter, artifact, ...args]
  }
  return [plan.identity.executable, ...args]
}
export function verifyUpdatedVersion(plan: CliOperationPlan, version: string | undefined): asserts version is string {
  if (version === plan.beforeVersion) throw new CliOperationError('VERSION_UNCHANGED', `命令已完成，但版本仍是 ${version}`)
  if (!validUpdateVersion(plan.cli, version) || compareVersions(version, plan.beforeVersion) <= 0 || !compatible(plan.cli, version) || plan.pinsVersion && version !== plan.targetVersion)
    throw new CliOperationError('VERSION_MISMATCH', '命令已完成，但版本未前进、未适配或与锁定目标不一致，请重新检查')
}
export function sameInstallation(before: InstallationIdentity, after: InstallationIdentity, cli?: ActiveCliId): boolean {
  if (before.source === after.source && before.executable === after.executable && before.updateRoot && before.updateRoot === after.updateRoot && before.channel === after.channel) return true
  if (before.source === 'brew' && after.source === 'brew' && before.prefix && before.prefix === after.prefix && before.executable === after.executable && cli) {
    const spec = CLI_SOURCES[cli].brew
    const stable = (identity: InstallationIdentity) => {
      const prefix = identity.prefix!.replace(/\\/g, '/').replace(/\/$/, '')
      const real = identity.fingerprint.realpath.replace(/\\/g, '/')
      if (!real.startsWith(prefix + '/')) return undefined
      const parts = real.slice(prefix.length + 1).split('/')
      if (!spec || parts[0] !== (spec.kind === 'cask' ? 'Caskroom' : 'Cellar') || parts[1] !== spec.name || !parts[2] || parts.some(part => !part || part === '.' || part === '..')) return undefined
      // Only the version component may change; the entry within the package
      // must remain the same. identifyInstallation has already checked ownership.
      return [parts[0], parts[1], ...parts.slice(3)].join('/')
    }
    const identity = stable(before)
    return identity !== undefined && identity === stable(after)
  }
  return before.executable === after.executable && before.source === after.source && before.prefix === after.prefix &&
    before.packageRoot === after.packageRoot && before.fingerprint.realpath === after.fingerprint.realpath
}
