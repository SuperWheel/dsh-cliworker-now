import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, delimiter } from 'node:path'
import type { InstallationIdentity } from './identity.ts'
import { readManifest } from './identity.ts'
import { CliOperationError, samePath, foldPath } from './planner.ts'
import { captureReadOnly, compareVersions, validVersion } from './versions.ts'
import { resolveNpmRuntime } from './npm.ts'
import type { ProcessBackend, RuntimeConfig } from '../process.ts'

// Audited upstream bytes, archived in tests/fixtures/official-installers/.
// A changed script must be re-audited, never executed with assumed directory semantics.
export const PI_REPAIR_SCRIPTS = {
  win32: { url: 'https://pi.dev/install.ps1', sha256: '3ba23d3451e17649495bdee14414ec1f3616ad7ae7246b4edd2e7166e7b3af51' },
  unix: { url: 'https://pi.dev/install.sh', sha256: 'ff4ed7b1ea1c058f33249a44093863b50cf95224ab4ff654e722fcbbbdaa31df' },
} as const
const pkg = '@earendil-works/pi-coding-agent'
const refuse = (root: string, detail: string): never => { throw new CliOperationError('PREREQUISITE_MISSING', `Pi 托管安装需要修复：${root}；${detail}。插件不会另装一份，请用 Pi 官方安装器修复原目录`) }
const inside = (file: string, root: string) => samePath(file, root) || foldPath(file).startsWith(foldPath(root).replace(/\/$/, '') + '/')
async function exists(file: string) {
  return lstat(file).catch(error => { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return undefined; throw error })
}
async function stamp(file: string, ownedRoot: string): Promise<string | undefined> {
  const info = await exists(file)
  if (!info) return
  const canonical = await realpath(file)
  if (inside(canonical, ownedRoot)) return `managed-alias:${foldPath(ownedRoot)}`
  const manifest = info.isDirectory() ? join(file, 'package.json') : file
  const record = await exists(manifest)
  if (record && (!record.isFile() || record.size > 128 * 1024)) throw new CliOperationError('IDENTITY_CHANGED', `无法核验 Pi 安装证据 ${manifest}`)
  const hash = record ? createHash('sha256').update(await readFile(manifest)).digest('hex') : undefined
  return JSON.stringify([canonical, info.ino, info.size, info.mtimeMs, hash])
}
/** Read only the version pointer and product metadata. */
async function pointer(root: string): Promise<string> {
  const install = join(root, 'install'), file = join(install, 'current-version')
  const markerPath = join(install, 'managed-install.json')
  const [marker, markerInfo, info] = await Promise.all([readManifest(markerPath), exists(markerPath), exists(file)])
  if (!markerInfo?.isFile() || markerInfo.isSymbolicLink() || marker?.kind !== 'pi-managed-install' || marker.schemaVersion !== 1 || marker.layout !== 'releases-v1' || !info?.isFile() || info.isSymbolicLink() || info.size > 128) return refuse(root, '托管标记或 current-version 无法核实')
  if (!samePath(await realpath(root), root) || !samePath(await realpath(install), install)) return refuse(root, '托管根发生重定向')
  const version = (await readFile(file, 'utf8')).trim()
  if (!validVersion(version)) return refuse(root, 'current-version 不是有效版本')
  return version
}
export async function preparePiRepairGuard(identity: InstallationIdentity, backend: ProcessBackend, config: RuntimeConfig, signal: AbortSignal, platform = process.platform) {
  const root = identity.updateRoot
  if (!root || !isAbsolute(root) || identity.source !== 'self-update') return refuse(root ?? identity.executable, '原安装归属无法核实')
  const beforeVersion = await pointer(root)
  // Pi's configured command takes precedence over the managed root (config.js:271,
  // package-manager-cli.js:990). Its arbitrary output locations cannot be bound here.
  if (process.env.PI_SELF_UPDATE_COMMAND?.trim()) return refuse(root, '自定义更新命令的目标无法核实，不能确认在原安装上更新')
  const settingsFile = join(root, 'settings.json'), settingsInfo = await exists(settingsFile)
  if (settingsInfo) {
    if (!settingsInfo.isFile() || settingsInfo.isSymbolicLink() || settingsInfo.size > 128 * 1024) return refuse(root, '无法核实自定义更新命令配置')
    let settings: { selfUpdateCommand?: unknown }
    try { settings = JSON.parse(await readFile(settingsFile, 'utf8')) } catch { return refuse(root, '无法核实自定义更新命令配置') }
    if (!settings || typeof settings !== 'object' || settings.selfUpdateCommand != null && (!Array.isArray(settings.selfUpdateCommand) || settings.selfUpdateCommand.length)) return refuse(root, '自定义更新命令的目标无法核实，不能确认在原安装上更新')
  }
  const bin = join(root, 'bin')
  if (await exists(bin) && !samePath(await realpath(bin), bin)) return refuse(root, '原启动器目录发生重定向')
  const launchers = platform === 'win32' ? ['pi.ps1', 'pi.cmd', 'pi.exe', 'pi.bat'] : ['pi']
  if (!(await Promise.all(launchers.map(name => exists(join(bin, name))))).some(Boolean)) {
    for (const directory of (process.env.PATH ?? '').split(delimiter).filter(isAbsolute)) for (const name of launchers) {
      if (await exists(join(directory, name))) return refuse(root, `原启动器缺失且 PATH 另有 ${join(directory, name)}，拒绝触发官方迁移`)
    }
  }
  if (identity.manifestVersion && beforeVersion !== identity.manifestVersion) return refuse(root, 'current-version 与计划版本不符')
  let npm: [string, string]
  try { npm = await resolveNpmRuntime(backend, platform) } catch { return refuse(root, '无法核实 npm 前缀，不能检查是否新增副本') }
  const prefix = async () => {
    const value = (await captureReadOnly(backend, config, [...npm, 'prefix', '-g'], signal)).trim()
    if (!isAbsolute(value) || /[\x00-\x1f]/.test(value)) return refuse(root, 'npm 全局前缀无效')
    return value
  }
  const candidates = (npmPrefix: string) => {
    const paths = (process.env.PATH ?? '').split(delimiter).filter(isAbsolute)
    if (paths.length > 256) return refuse(root, 'PATH 目录过多，无法完整核对其他安装')
    const npmPrefixes = new Set([npmPrefix, ...(process.env.APPDATA ? [join(process.env.APPDATA, 'npm')] : []), ...paths, ...paths.map(dirname)])
    const roots = new Set([join(homedir(), '.pi/agent'), ...paths.map(dirname), ...(process.env.PI_CODING_AGENT_DIR ? [process.env.PI_CODING_AGENT_DIR] : []), ...(process.env.PI_MANAGED_INSTALL_ROOT ? [dirname(process.env.PI_MANAGED_INSTALL_ROOT)] : [])])
    const files = [...npmPrefixes].flatMap(p => [join(p, 'node_modules', pkg), join(p, 'lib/node_modules', pkg), ...(platform === 'win32' ? launchers.map(name => join(p, name)) : [join(p, 'bin/pi')])])
    files.push(...[...roots].flatMap(p => [join(p, 'install/managed-install.json'), join(p, 'install/current-version')]))
    return [...new Set(files)].filter(p => isAbsolute(p) && !inside(p, root))
  }
  const oldPrefix = await prefix(), baseline = new Map<string, string | undefined>()
  for (const file of candidates(oldPrefix)) { signal.throwIfAborted(); baseline.set(file, await stamp(file, root)) }
  return {
    beforeVersion,
    env: { PI_LEGACY_INSTALL: '0', PI_MANAGED_INSTALL_ROOT: join(root, 'install'), PI_CODING_AGENT_DIR: root, PI_INSTALLER_API_BASE: 'https://pi.dev/api/installer/releases', PATH: [bin, process.env.PATH ?? ''].join(delimiter) },
    async verify(targetVersion?: string, intent: 'update' | 'repair' = 'update') {
      signal.throwIfAborted()
      const nextPrefix = await prefix()
      // A changed prefix/PATH is not allowed to hide a newly selected copy.
      for (const file of new Set([...baseline.keys(), ...candidates(nextPrefix)])) {
        const afterStamp = await stamp(file, root), beforeStamp = baseline.get(file)
        // A new alias into the same managed root is not another installation.
        if (beforeStamp === undefined && afterStamp?.startsWith('managed-alias:')) continue
        if (afterStamp !== beforeStamp) throw new CliOperationError('IDENTITY_CHANGED', `Pi 修复改变了原根之外的安装 ${file}；原安装 ${root} 的路径记录未修改`)
      }
      const after = await pointer(root)
      if (compareVersions(after, beforeVersion) < 0 || intent === 'update' && compareVersions(after, beforeVersion) === 0) throw new CliOperationError('VERSION_UNCHANGED', `Pi 原托管根 ${root} 的 current-version 未前进（${beforeVersion} → ${after}）；路径记录未修改`)
      if (targetVersion && after !== targetVersion) throw new CliOperationError('VERSION_MISMATCH', `Pi 原托管根 ${root} 的 current-version ${after} 未达到目标 ${targetVersion}；路径记录未修改`)
      return after
    },
  }
}
