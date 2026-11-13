import { createHash } from 'node:crypto'
import { join, isAbsolute, win32 } from 'node:path'
import type { ActiveCliId } from '../../shared/types.ts'
import { type CliOperationErrorCode } from '../../shared/cli-management.ts'
import type { ProcessBackend } from '../process.ts'
import type { InstallationIdentity } from './identity.ts'
import { CLI_SOURCES } from './sources.ts'
import { compatible, validVersion, updateAvailable } from './versions.ts'
import { resolveNpmRuntime } from './npm.ts'

export class CliOperationError extends Error {
  constructor(readonly code: CliOperationErrorCode, message: string) { super(`${code}：${message}`) }
}
export type CliMethod = 'npm' | 'brew' | 'self-update'
export interface CliOperationPlan {
  cli: ActiveCliId; intent: 'update'; method: CliMethod; identity: InstallationIdentity
  beforeVersion: string; targetVersion: string; registry: string; token: string
}
export function automaticMethod(cli: ActiveCliId, identity: InstallationIdentity): CliMethod | undefined {
  const s = CLI_SOURCES[cli]
  if (identity.source === 'npm' && s.npm) return 'npm'
  if (identity.source === 'brew' && s.brew && !s.brew.tap) return 'brew'
  if (identity.source === 'self-update' && s.update) return 'self-update'
}
export function operationToken(cli: ActiveCliId, identity: InstallationIdentity, target: string | undefined, registry: string, before = identity.manifestVersion): string {
  return createHash('sha256').update(JSON.stringify([process.platform, cli, 'update', identity, before, target, registry, automaticMethod(cli, identity), CLI_SOURCES[cli].update])).digest('hex')
}
export function planCliOperation(cli: ActiveCliId, intent: 'update', identity: InstallationIdentity | undefined, before: string | undefined, target: string | undefined, registry: string): CliOperationPlan {
  const method = identity && automaticMethod(cli, identity)
  if (!identity || !method) throw new CliOperationError('PREREQUISITE_MISSING', '安装归属或自动更新方法尚未核实，请按官方说明手动更新')
  if (!validVersion(before) || !validVersion(target) || !compatible(cli, target) || !updateAvailable(before, target)) throw new CliOperationError('PLAN_EXPIRED', '目标版本尚未核实或未适配，请重新检查更新')
  if ((method === 'npm' || method === 'brew') && (!identity.prefix || !(isAbsolute(identity.prefix) || win32.isAbsolute(identity.prefix))))
    throw new CliOperationError('PREREQUISITE_MISSING', '无法确认原安装前缀，请按原安装渠道手动更新')
  // These updaters have no verified target-version flag. Never let a latest-only
  // updater cross a compatibility boundary that the npm method can pin safely.
  if (method !== 'npm' && CLI_SOURCES[cli].compatibility !== 'any') throw new CliOperationError('PREREQUISITE_MISSING', '此更新方式无法锁定已适配版本，请使用原安装渠道手动更新')
  return { cli, intent, identity, method, beforeVersion: before, targetVersion: target, registry, token: operationToken(cli, identity, target, registry, before) }
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
  return [plan.identity.executable, ...s.update!]
}
export function sameInstallation(before: InstallationIdentity, after: InstallationIdentity, cli?: ActiveCliId): boolean {
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
