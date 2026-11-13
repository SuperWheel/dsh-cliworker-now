import { createHash } from 'node:crypto'
import { access, lstat, realpath, rename, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import type { ActiveCliId } from '../../shared/types.ts'
import { OFFICIAL_NPM_REGISTRY, type CliInstallOffer, type CliUpdateOperation } from '../../shared/cli-management.ts'
import { type ProcessBackend, type RuntimeConfig, ProcessCleanupUnconfirmedError } from '../process.ts'
import { identifyInstallation, type InstallationIdentity } from './identity.ts'
import { CLI_SOURCES, installationSource, type InstallSource } from './sources.ts'
import { captureReadOnly, compareVersions, compatible, currentVersion, latestCompatible, ReleaseClient, validVersion } from './versions.ts'
import { resolveNpmRuntime } from './npm.ts'
import { CliOperationError } from './planner.ts'
import { downloadCliArtifact, parseIntegrity } from './download.ts'
import { executeCliOperation, outputTail } from './executor.ts'
import { installDesktop } from './desktop.ts'
import { findGitBash } from '../windows-git-bash.ts'

export interface InstallPlan {
  cli: ActiveCliId; source: InstallSource; target?: string; directory: string; registry: string
  before?: InstallationIdentity; oldPath?: string; pathRevision: number; token: string; npm?: [string, string]
  unusableBefore?: 'CLI_IDENTITY_MISMATCH'
  gitBash?: string
  offer: CliInstallOffer; problem?: 'PREREQUISITE_MISSING' | 'PERMISSION_DENIED'
}
export const installFs = { access, lstat, realpath }
export function nodeSatisfies(version: string, range: string): boolean {
  if (!validVersion(version)) return false
  return range.split('||').some(branch => branch.trim().split(/\s+/).every(part => {
    const m = /^(>=|>|<=|<|=|\^|~)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(part)
    if (!m) return false
    const target = `${m[2]}.${m[3] ?? 0}.${m[4] ?? 0}`, c = compareVersions(version, target)
    if (m[1] === '>=') return c >= 0
    if (m[1] === '>') return c > 0
    if (m[1] === '<=') return c <= 0
    if (m[1] === '<') return c < 0
    if (m[1] === '^' || m[1] === '~') return c >= 0 && version.split('.').slice(0, m[1] === '^' ? 1 : 2).join('.') === target.split('.').slice(0, m[1] === '^' ? 1 : 2).join('.')
    return c === 0
  }))
}
export async function writablePrefix(path: string): Promise<void> {
  if (!isAbsolute(path) || path === dirname(path) || /[\x00-\x1f]/.test(path)) throw new CliOperationError('PERMISSION_DENIED', 'npm 全局目录无效，不会提权')
  let parent = path
  for (;;) {
    try { const info = await installFs.lstat(parent); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('invalid prefix'); await installFs.access(parent, constants.W_OK | constants.X_OK); return }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && dirname(parent) !== parent) { parent = dirname(parent); continue }; throw new CliOperationError('PERMISSION_DENIED', 'npm 全局目录不可写，不会提权；请按官方说明配置可写前缀') }
  }
}
export class CliInstaller {
  constructor(private deps: {
    root: string; backend: ProcessBackend; config: RuntimeConfig; releases: ReleaseClient
    fetcher?: Parameters<typeof downloadCliArtifact>[0]['fetcher']; platform?: NodeJS.Platform; arch?: string
    identify?: typeof identifyInstallation; version?: typeof currentVersion
  }) {}
  private get platform() { return this.deps.platform ?? process.platform }
  async inspect(cli: ActiveCliId, signal: AbortSignal): Promise<InstallationIdentity | undefined> {
    try { return await (this.deps.identify ?? identifyInstallation)(cli, this.deps.backend, this.deps.config, signal) }
    catch (error) { if (error instanceof ProcessCleanupUnconfirmedError || signal.aborted) throw error; if (['ENOENT', 'ENOTDIR', 'SUBPROCESS_EXECUTABLE_NOT_FOUND'].includes((error as NodeJS.ErrnoException).code ?? '') || (error as { reason?: string }).reason === 'not-installed') return; throw error }
  }
  async prepare(cli: ActiveCliId, registry: string, directory: string, signal: AbortSignal): Promise<InstallPlan> {
    const source = installationSource(cli, this.platform), store = this.deps.config.cliExecutablePaths!
    if (directory && source.method !== 'desktop' && source.method !== 'manual') throw new CliOperationError('LOCATION_INVALID', '纯 CLI 只使用官方默认安装位置')
    let before: InstallationIdentity | undefined, unusableBefore: InstallPlan['unusableBefore']
    try { before = await this.inspect(cli, signal) }
    catch (error) {
      if (error instanceof ProcessCleanupUnconfirmedError || signal.aborted) throw error
      if (cli !== 'pi' || (error as NodeJS.ErrnoException).code !== 'CLI_IDENTITY_MISMATCH') throw error
      unusableBefore = 'CLI_IDENTITY_MISMATCH'
    }
    const oldPath = store.read(cli)?.path
    const pathRevision = store.revision(cli)
    const offer: CliInstallOffer = { method: source.method, guideUrl: CLI_SOURCES[cli].guideUrl, selectableLocation: source.method === 'desktop', prerequisites: [], scriptUrl: source.script?.url, experimental: CLI_SOURCES[cli].experimental }
    const plan: InstallPlan = { cli, source, registry, directory, before, unusableBefore, oldPath, pathRevision, offer, token: '' }
    const prerequisite = (name: string, required: string, found: string | undefined, satisfied: boolean) => { offer.prerequisites.push({ name, required, found, satisfied }); if (!satisfied) plan.problem = 'PREREQUISITE_MISSING' }
    if (source.method === 'manual') prerequisite('安装方法', source.reason!, undefined, false)
    else if (source.method === 'npm') {
      const release = await this.deps.releases.query(cli, registry, signal, 'npm')
      plan.target = latestCompatible(cli, release.versions.filter(v => !v.includes('-')))
      if (!plan.target) throw new CliOperationError('PREREQUISITE_MISSING', '没有可安装的已适配正式版本')
      try {
        plan.npm = await resolveNpmRuntime(this.deps.backend, this.platform)
        const nodeVersion = (await captureReadOnly(this.deps.backend, this.deps.config, [plan.npm[0], '--version'], signal)).trim().replace(/^v/, '')
        const data = await this.deps.releases.json(new URL(`${encodeURIComponent(CLI_SOURCES[cli].npm!)}/${plan.target}`, OFFICIAL_NPM_REGISTRY).href, signal) as { name?: string; version?: string; engines?: { node?: string } }
        if (data.name !== CLI_SOURCES[cli].npm || data.version !== plan.target) throw new Error('package identity')
        const requirement = data.engines?.node ?? (source.nodeMinimum ? `>=${source.nodeMinimum}` : undefined)
        prerequisite('Node.js', requirement ?? '目标包 engines.node 尚未核实', nodeVersion, !!requirement && nodeSatisfies(nodeVersion, requirement) && (!source.nodeMinimum || nodeSatisfies(nodeVersion, `>=${source.nodeMinimum}`)))
        plan.directory = (await captureReadOnly(this.deps.backend, this.deps.config, [...plan.npm, 'prefix', '-g'], signal)).trim()
        try { await writablePrefix(plan.directory) } catch { plan.problem = 'PERMISSION_DENIED'; prerequisite('npm 全局目录', '当前用户可写（不提权）', plan.directory, false); plan.problem = 'PERMISSION_DENIED' }
      } catch (error) { if (error instanceof ProcessCleanupUnconfirmedError || signal.aborted) throw error; prerequisite('Node/npm', '已核实的原生 Node 与 npm-cli.js', undefined, false) }
    } else if (source.method === 'script') {
      if (directory) throw new CliOperationError('LOCATION_INVALID', '纯 CLI 只使用官方默认安装位置')
      plan.directory = dirname(join(homedir(), source.script!.relativeEntry))
      plan.target = 'official-current'
      for (const program of [source.script!.interpreter[0]!]) {
        try { const found = await this.deps.backend.resolveExecutable(program); prerequisite(program, '已安装', found, true) }
        catch { prerequisite(program, '已安装', undefined, false) }
      }
      if (cli === 'kimi' && this.platform === 'win32') {
        plan.gitBash = await findGitBash(this.deps.backend, signal)
        prerequisite('bash.exe', 'Git for Windows Bash（不是 WSL bash）', plan.gitBash, !!plan.gitBash)
      }
      const arch = this.deps.arch ?? process.arch
      if (this.platform === 'win32' && arch === 'arm64' && (cli === 'qoder' || cli === 'qodercn')) prerequisite('Windows 架构', '非 ARM64', arch, false)
    } else {
      plan.directory ||= this.platform === 'darwin' ? '/Applications' : ''
      plan.target = source.desktop?.version
      if (!source.desktop || !plan.directory) prerequisite('官方安装包', '已核实地址、摘要/长度、开发者与位置', undefined, false)
    }
    signal.throwIfAborted()
    offer.defaultLocation = plan.directory || CLI_SOURCES[cli].defaultLocation
    plan.token = createHash('sha256').update(JSON.stringify([this.platform, cli, 'install', before ?? null, unusableBefore, pathRevision, oldPath, source, plan.target, plan.directory, registry, plan.npm, plan.gitBash])).digest('hex')
    return plan
  }
  async execute(plan: InstallPlan, op: CliUpdateOperation, signal: AbortSignal, changed: () => void, recheck: () => Promise<void>): Promise<{ identity: InstallationIdentity; version: string }> {
    if (plan.problem || plan.source.method === 'manual') throw new CliOperationError(plan.problem ?? 'PREREQUISITE_MISSING', `${plan.source.reason ?? '安装前置条件不满足'}；官方说明：${plan.offer.guideUrl}`)
    const { cli, source } = plan
    let file: string | undefined, quarantined = false
    const run = async (argv: string[], control = signal) => { op.command = argv; changed(); await executeCliOperation(this.deps.backend, this.deps.config, argv, control, text => { op.outputTail = outputTail(op.outputTail + text); changed() }) }
    try {
      op.installDirectory = plan.directory; op.targetVersion = validVersion(plan.target) ? plan.target : undefined; op.phase = 'downloading'; changed()
      let url: string, integrity: string | undefined, expectedBytes: number | undefined
      if (source.method === 'npm') {
        const metadata = await this.deps.releases.artifact(cli, plan.target!, plan.registry, signal)
        if (parseIntegrity(metadata.integrity).algorithm !== 'sha512') throw new CliOperationError('INTEGRITY_MISMATCH', 'npm 主包缺少官方 sha512')
        url = metadata.url; integrity = metadata.integrity; op.integritySource = OFFICIAL_NPM_REGISTRY
      } else if (source.method === 'script') { url = source.script!.url; op.outputTail = outputTail(`官方安装脚本：${url}\n仅验证 HTTPS 传输，官方未提供独立摘要。\n`) }
      else { url = source.desktop!.url; integrity = source.desktop!.integrity; expectedBytes = source.desktop!.bytes }
      file = await downloadCliArtifact({ root: this.deps.root, url, integrity, expectedBytes, officialScript: source.method === 'script', signal, fetcher: this.deps.fetcher, progress: value => { op.progress = value; changed() } })
      const extension = source.method === 'npm' ? '.tgz' : source.method === 'script' ? this.platform === 'win32' ? '.ps1' : '.sh' : this.platform === 'win32' ? '.exe' : '.dmg'
      const renamed = file.replace(/\.part$/, extension); await rename(file, renamed); file = renamed
      await recheck(); signal.throwIfAborted(); op.phase = 'installing'; changed()
      let candidate: string
      if (source.method === 'npm') {
        await writablePrefix(plan.directory)
        await run([...plan.npm!, 'install', '--global', '--prefix', plan.directory, file, '--registry', plan.registry, ...(cli === 'pi' ? ['--ignore-scripts'] : [])])
        candidate = join(plan.directory, this.platform === 'win32' ? '' : 'bin', source.command + (this.platform === 'win32' ? '.cmd' : ''))
      } else if (source.method === 'script') {
        // Re-read the built-in descriptor; a client cannot supply a URL or interpreter.
        if (JSON.stringify(installationSource(cli, this.platform).script) !== JSON.stringify(source.script)) throw new CliOperationError('PLAN_EXPIRED', '官方脚本定义已变化')
        await run([...source.script!.interpreter, file]); candidate = join(homedir(), source.script!.relativeEntry)
      } else {
        const app = await installDesktop({ source: source.desktop!, root: this.deps.root, directory: plan.directory, platform: this.platform, file, signal, run, awaiting: () => { op.phase = 'awaiting-user'; changed() } })
        candidate = join(app, source.desktop!.relativeEntry)
      }
      op.phase = 'verifying-installation'; changed()
      // Override only this verification's path. Do not reset the user's old record before success.
      let identity: InstallationIdentity | undefined
      let config = this.deps.config
      const candidates = [candidate, ...(source.desktop?.commonDirectories ?? []).map(path => join(path, source.desktop!.relativeEntry))]
      for (const path of candidates) {
        try {
          const resolved = await this.deps.backend.resolveExecutable(path)
          config = { ...this.deps.config, cliExecutablePaths: undefined, [cli === 'antigravity' ? 'executable' : `${cli}Executable`]: resolved }
          identity = await (this.deps.identify ?? identifyInstallation)(cli, this.deps.backend, config, signal)
          if (identity) break
        } catch (error) { if (error instanceof ProcessCleanupUnconfirmedError || signal.aborted) throw error }
      }
      if (!identity) throw new CliOperationError('IDENTITY_CHANGED', `安装命令已完成，但在 ${candidate} 找不到 ${cli}`)
      const version = await (this.deps.version ?? currentVersion)(cli, identity, this.deps.backend, config, signal)
      if (!validVersion(version) || !compatible(cli, version)) throw new CliOperationError('VERSION_MISMATCH', '安装命令已完成，但无法确认已适配的 CLI 版本，请检查路径')
      if (source.method === 'npm' && version !== plan.target) throw new CliOperationError('VERSION_MISMATCH', '安装后的版本与目标不一致')
      signal.throwIfAborted()
      const store = this.deps.config.cliExecutablePaths!
      if (store.revision(cli) !== plan.pathRevision) throw new CliOperationError('PLAN_EXPIRED', '安装期间路径设置已变化，未覆盖新设置')
      store.setManual(cli, identity.executable)
      op.afterVersion = version
      if (plan.oldPath && plan.oldPath !== identity.executable) op.outputTail = outputTail(op.outputTail + `\n已改用新位置；旧位置 ${plan.oldPath} 未删除。\n`)
      return { identity, version }
    } catch (error) { quarantined = error instanceof ProcessCleanupUnconfirmedError; throw error }
    finally { if (file && !quarantined) await unlink(file).catch(() => undefined) }
  }
}
