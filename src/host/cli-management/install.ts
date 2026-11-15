import { WORKBUDDY_COS_POLICY, readWorkBuddyCos } from './workbuddy-windows.ts'
import { withUpdateCleanup, quarantineUpdateCleanup, removeUpdateTemporary, trackUpdateTemporary, afterUpdateCleanup } from './update-cleanup.ts'
import { registerNativeResidueCleanup, cleanNpmResidues, npmPrefixIdle } from './update-residue.ts'
import { prepareNpmDownload, npmCacheAddArgv, type NpmDownload } from './npm-download.ts'
import { verifyNpmPlatforms } from './npm-platform.ts'
import { createHash } from 'node:crypto'
import { access, lstat, realpath, rename } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, join, win32 } from 'node:path'
import { homedir } from 'node:os'
import type { ActiveCliId } from '../../shared/types.ts'
import { OFFICIAL_NPM_REGISTRY, type CliInstallOffer, type CliUpdateOperation } from '../../shared/cli-management.ts'
import { type ProcessBackend, type RuntimeConfig, ProcessCleanupUnconfirmedError } from '../process.ts'
import { identifyInstallation, type InstallationIdentity } from './identity.ts'
import { CLI_SOURCES, DESKTOP_INSTALL_SOURCES, installationSource, isDesktopCli, type InstallSource } from './sources.ts'
import { readDesktopRelease } from './desktop-update.ts'
import { captureReadOnly, compareVersions, compatible, currentVersion, desktopVersion, latestCompatible, ReleaseClient, validVersion } from './versions.ts'
import { resolveNpmRuntime, resolveNpmHost } from './npm.ts'
import { CliOperationError } from './planner.ts'
import { downloadCliArtifact } from './download.ts'
import { DESKTOP_INSTALLER_TIMEOUT_MS, executeCliOperation, outputTail } from './executor.ts'
import { listRunningApps, reopenStoppedApp, WINDOWS_APP_IMAGES, type RunningApp } from './windows-installer-apps.ts'
/** Authenticode over a ~500 MB installer; generous so a cold disk or a Defender scan cannot fail a valid package. */
export const WINDOWS_SIGNATURE_TIMEOUT_MS = 120_000
import { withInterruptionRecovery } from './recovery.ts'
import { installDesktop } from './desktop.ts'
import { findGitBash } from '../windows-git-bash.ts'
import { WorkBuddyUnavailableError } from '../workbuddy-installation.ts'

export interface InstallPlan {
  cli: ActiveCliId; source: InstallSource; target?: string; directory: string; registry: string
  before?: InstallationIdentity; oldPath?: string; pathRevision: number; token: string; npm?: [string, string]
  unusableBefore?: 'CLI_IDENTITY_MISMATCH'
  gitBash?: string
  automaticSources: boolean
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
/** International WorkBuddy's Windows wizard defaults, most likely first. */
function workbuddyWindowsDirectories(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.ProgramFiles && join(env.ProgramFiles, 'WorkBuddyAI'), env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'WorkBuddyAI')].filter((path): path is string => !!path)
}
export class CliInstaller {
  constructor(private deps: {
    root: string; backend: ProcessBackend; config: RuntimeConfig; releases: ReleaseClient
    fetcher?: Parameters<typeof downloadCliArtifact>[0]['fetcher']; platform?: NodeJS.Platform; arch?: string
    identify?: typeof identifyInstallation; version?: typeof currentVersion; npmCheck?: typeof verifyNpmPlatforms; npmRuntimeHost?: typeof resolveNpmHost
  }) {}
  private get platform() { return this.deps.platform ?? process.platform }
  async inspect(cli: ActiveCliId, signal: AbortSignal): Promise<InstallationIdentity | undefined> {
    try { return await (this.deps.identify ?? identifyInstallation)(cli, this.deps.backend, this.deps.config, signal) }
    catch (error) { if (error instanceof ProcessCleanupUnconfirmedError || signal.aborted) throw error; if (['ENOENT', 'ENOTDIR', 'SUBPROCESS_EXECUTABLE_NOT_FOUND'].includes((error as NodeJS.ErrnoException).code ?? '') || (error as { reason?: string }).reason === 'not-installed') return; throw error }
  }
  async prepare(cli: ActiveCliId, registry: string, directory: string, signal: AbortSignal, automaticSources = true): Promise<InstallPlan> {
    const source = installationSource(cli, this.platform, this.deps.arch), store = this.deps.config.cliExecutablePaths!
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
    const plan: InstallPlan = { cli, source, registry, directory, automaticSources, before, unusableBefore, oldPath, pathRevision, offer, token: '' }
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
      // The official Windows wizard's own default (observed 5.9.4, 2026-11-15): per-machine Program Files.
      plan.directory ||= this.platform === 'darwin' ? '/Applications' : cli === 'workbuddy' ? workbuddyWindowsDirectories()[0] ?? '' : ''
      if (source.desktopFeed) {
        const descriptor = DESKTOP_INSTALL_SOURCES[source.desktopFeed]
        const release = await readDesktopRelease(source.desktopFeed, {}, signal, { platform: this.platform, arch: this.deps.arch,
          fetcher: (url, init) => this.deps.releases.response(String(url), init?.signal ?? signal) })
        const integrity = release.sha512 ? `sha512-${release.sha512}` : release.sha256 ? `sha256-${Buffer.from(release.sha256, 'hex').toString('base64')}` : undefined
        if (!integrity && release.integrityPolicy !== WORKBUDDY_COS_POLICY) throw new CliOperationError('INTEGRITY_MISMATCH', '官方桌面安装包没有摘要')
        source.desktop = { ...descriptor, archive: source.desktopFeed === 'workbuddy' && this.platform === 'darwin' ? 'dmg' : 'zip', url: release.url, integrity, bytes: release.size, version: release.version, integrityPolicy: release.integrityPolicy }
      }
      if (cli === 'workbuddy' && this.platform === 'win32' && source.desktop) {
        source.desktop.windowsWorkBuddy = true
        source.desktop.relativeEntry = 'resources/app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs'
        source.desktop.commonDirectories = workbuddyWindowsDirectories()
      }
      plan.target = source.desktop?.version
      if (!source.desktop || !plan.directory) prerequisite('官方安装包', '已核实地址、摘要/长度、开发者与位置', undefined, false)
    }
    signal.throwIfAborted()
    offer.defaultLocation = plan.directory || CLI_SOURCES[cli].defaultLocation
    plan.token = createHash('sha256').update(JSON.stringify([this.platform, cli, 'install', before ?? null, unusableBefore, pathRevision, oldPath, source, plan.target, plan.directory, registry, plan.npm, plan.gitBash, plan.automaticSources])).digest('hex')
    return plan
  }
  async execute(plan: InstallPlan, op: CliUpdateOperation, signal: AbortSignal, changed: () => void, recheck: () => Promise<void>): Promise<{ identity: InstallationIdentity; version: string }> {
    return withUpdateCleanup(text => { op.outputTail = outputTail(op.outputTail + text); changed() }, () => this.executeOperation(plan,op,signal,changed,recheck))
  }
  private async executeOperation(plan: InstallPlan, op: CliUpdateOperation, signal: AbortSignal, changed: () => void, recheck: () => Promise<void>): Promise<{ identity: InstallationIdentity; version: string }> {
    if (plan.problem || plan.source.method === 'manual') throw new CliOperationError(plan.problem ?? 'PREREQUISITE_MISSING', `${plan.source.reason ?? '安装前置条件不满足'}；官方说明：${plan.offer.guideUrl}`)
    const { cli, source } = plan
    let file: string | undefined, quarantined = false, npmDownload: NpmDownload | undefined, succeeded = false
    const output = (text: string) => { op.outputTail = outputTail(op.outputTail + text); changed() }
    await registerNativeResidueCleanup({ ...this.deps, cli, success: () => succeeded })
    try {
      op.installDirectory = plan.directory; op.targetVersion = validVersion(plan.target) ? plan.target : undefined; op.phase = 'downloading'; changed()
      if (source.method === 'npm') {
        const host = await (this.deps.npmRuntimeHost ?? resolveNpmHost)(this.deps.backend, this.deps.config, signal, plan.npm)
        op.integritySource = OFFICIAL_NPM_REGISTRY
        npmDownload = await prepareNpmDownload({ cli, version: plan.target!, registry: plan.registry, automaticSources: plan.automaticSources,
          root: this.deps.root, releases: this.deps.releases, signal, identity: plan.before, host, fetcher: this.deps.fetcher,
          output, progress: value => { op.progress = value; changed() } })
        afterUpdateCleanup(() => cleanNpmResidues({ prefix: plan.directory, packageName: npmDownload!.packageName, bins: npmDownload!.bins, platform: this.platform, idle: () => npmPrefixIdle(this.deps.backend,this.deps.config,this.platform) }))
        file = npmDownload.main
      } else {
        let url: string, integrity: string | undefined, expectedBytes: number | undefined
        if (source.method === 'script') { url = source.script!.url; op.outputTail = outputTail(`官方安装脚本：${url}\n仅验证 HTTPS 传输，官方未提供独立摘要。\n`) }
        else { url = source.desktop!.url; integrity = source.desktop!.integrity; expectedBytes = source.desktop!.bytes }
        const cos = source.desktop?.integrityPolicy === WORKBUDDY_COS_POLICY ? await readWorkBuddyCos(url, source.desktop.version, expectedBytes, signal, this.deps.fetcher) : undefined
        expectedBytes = cos?.size ?? expectedBytes
        file = await downloadCliArtifact({ cos, root: this.deps.root, output, url, integrity, expectedBytes, officialScript: source.method === 'script', signal, fetcher: this.deps.fetcher, progress: value => { op.progress = value; changed() } })
        const extension = source.method === 'script' ? this.platform === 'win32' ? '.ps1' : '.sh' : this.platform === 'win32' ? '.exe' : source.desktop?.archive === 'zip' ? '.zip' : '.dmg'
        const renamed = file.replace(/\.part$/, extension); await rename(file, renamed); file = trackUpdateTemporary(renamed)
      }
      await recheck(); signal.throwIfAborted(); op.phase = 'installing'; changed()
      const packageFile = file!
      return await withInterruptionRecovery(signal, async (control, evidence) => {
        let exitError: unknown
        const stoppedDesktopApps: RunningApp[] = [], image = isDesktopCli(cli) ? WINDOWS_APP_IMAGES[cli] : undefined
        const run = async (argv: string[], processSignal = control) => {
          op.command = argv; if (op.phase !== 'awaiting-user') op.phase = 'installing'; changed()
          // Windows desktop installs run the verified official installer, whose window the user must see.
          const installer = source.method === 'desktop' && this.platform === 'win32'
          try {
            const result = await executeCliOperation(this.deps.backend, this.deps.config, argv, processSignal, output, installer ? DESKTOP_INSTALLER_TIMEOUT_MS : undefined, undefined, evidence, undefined, undefined,
              installer && { runningApps: image ? appSignal => listRunningApps(this.deps.backend, this.deps.config, image, appSignal) : undefined })
            stoppedDesktopApps.push(...result.stoppedApps)
          }
          catch (error) { if (source.method === 'desktop' || !(error instanceof CliOperationError) || error.code !== 'EXIT_CODE') throw error; exitError = error }
        }
        let candidate: string
        if (source.method === 'npm') {
          await writablePrefix(plan.directory)
          op.progress = { readable: false, byteProgress: false, resumeCount: 0, stage: 'npm 正在使用本地缓存安装；仍可能查询元数据或下载其他依赖' }; changed()
          for (const file of npmDownload!.platforms) await executeCliOperation(this.deps.backend, this.deps.config, npmCacheAddArgv(plan.npm!, file, plan.directory, plan.registry, npmDownload!.cache), control, output)
          await run([...plan.npm!, 'install', '--global', '--prefix', plan.directory, packageFile, '--registry', plan.registry, '--cache', npmDownload!.cache, '--prefer-offline', '--include=optional', ...(cli === 'pi' ? ['--ignore-scripts'] : [])])
          candidate = join(plan.directory, this.platform === 'win32' ? '' : 'bin', source.command + (this.platform === 'win32' ? '.cmd' : ''))
        } else if (source.method === 'script') {
          // Re-read the built-in descriptor; a client cannot supply a URL or interpreter.
          if (JSON.stringify(installationSource(cli, this.platform).script) !== JSON.stringify(source.script)) throw new CliOperationError('PLAN_EXPIRED', '官方脚本定义已变化')
          await run([...source.script!.interpreter, packageFile]); candidate = join(homedir(), source.script!.relativeEntry)
        } else {
          const app = await installDesktop({ source: source.desktop!, root: this.deps.root, directory: plan.directory, platform: this.platform, file: packageFile, signal: control, run, capture: (argv, signal) => {
            // Get-AuthenticodeSignature hashes the whole ~500 MB installer; with PowerShell start-up
            // and a busy disk this took longer than the 5 s probe default (2026-11-15 Windows).
            op.progress = { readable: false, byteProgress: false, resumeCount: 0, stage: '正在核对安装包的官方签名' }; changed()
            return captureReadOnly(this.deps.backend, this.deps.config, argv, signal, false, undefined, WINDOWS_SIGNATURE_TIMEOUT_MS)
          }, awaiting: () => { op.phase = 'awaiting-user'; changed() } })
          candidate = join(app, source.desktop!.relativeEntry)
        }
        op.phase = 'verifying-installation'; changed()
        // Override only this verification's path. Do not reset the user's old record before success.
        let identity: InstallationIdentity | undefined
        let workbuddyReason: string | undefined
        let config = this.deps.config
        // A folder picked in the NSIS wizard gets the default leaf appended unless it already ends
        // with it (D:\Software\X → D:\Software\X\WorkBuddyAI); check that exact child too.
        const appended = cli === 'workbuddy' && this.platform === 'win32' && win32.basename(plan.directory).toLowerCase() !== 'workbuddyai'
          ? [join(plan.directory, 'WorkBuddyAI', source.desktop!.relativeEntry)] : []
        const candidates = [candidate, ...appended, ...(source.desktop?.commonDirectories ?? []).map(path => join(path, source.desktop!.relativeEntry))]
        for (const path of candidates) {
          try {
            // International WorkBuddy's mjs is a readable 0644 input to its own runtime,
            // not an executable for PATH/X_OK lookup. Identity verifies the bundle.
            const resolved = cli === 'workbuddy' ? path : await this.deps.backend.resolveExecutable(path)
            config = { ...this.deps.config, cliExecutablePaths: undefined, [cli === 'antigravity' ? 'executable' : `${cli}Executable`]: resolved }
            identity = await (this.deps.identify ?? identifyInstallation)(cli, this.deps.backend, config, control)
            if (identity) break
          } catch (error) {
            if (error instanceof ProcessCleanupUnconfirmedError || control.aborted) throw error
            if (error instanceof WorkBuddyUnavailableError) workbuddyReason ??= error.reason
          }
        }
        if (!identity) throw exitError ?? new CliOperationError('VERSION_MISMATCH', `安装命令已完成，但在 ${candidate} 找不到 ${cli}${workbuddyReason ? `（WorkBuddy 原因：${workbuddyReason}）` : ''}`)
        if (source.method === 'npm' && identity.source !== 'npm') throw new CliOperationError('IDENTITY_CHANGED', 'npm 安装后的实际归属不符')
        if (source.method === 'npm') await (this.deps.npmCheck ?? verifyNpmPlatforms)(identity, this.deps.releases, plan.registry, control, npmDownload!.host, npmDownload!.components, this.deps.root)
        const version = await (this.deps.version ?? currentVersion)(cli, identity, this.deps.backend, config, control, false, 45_000, source.method === 'npm')
        if (version && validVersion(version) && (!plan.before?.manifestVersion || compareVersions(version, plan.before.manifestVersion) > 0)) evidence.interrupted = false
        if (exitError) throw exitError
        if (!validVersion(version) || !compatible(cli, version)) throw new CliOperationError('VERSION_MISMATCH', '安装命令已完成，但无法确认已适配的 CLI 版本，请检查路径')
        if (source.method === 'npm' && version !== plan.target) throw new CliOperationError('VERSION_MISMATCH', '安装后的版本与目标不一致')
        if (source.method === 'desktop') {
          const appVersion = identity.fingerprint.appVersion ?? (cli === 'zcode' ? version : undefined)
          // Audited international 5.9.4 DMG/Windows product has only a three-component app version.
          // The exact four-component release is bound by the verified feed digest.
          // Windows additionally passed the pinned Authenticode publisher check.
          // Never collapse a discovered four-component build or alter CN semantics.
          const shortInternationalVersion = cli === 'workbuddy' && source.desktopFeed === 'workbuddy' &&
            (this.platform === 'darwin' && source.desktop?.archive === 'dmg' && source.desktop.integrity?.startsWith('sha256-') ||
              this.platform === 'win32' && source.desktop?.windowsWorkBuddy && (source.desktop.integrity?.startsWith('sha256-') || source.desktop.integrityPolicy === WORKBUDDY_COS_POLICY)) &&
            !!appVersion && /^\d+\.\d+\.\d+$/.test(appVersion) && !!plan.target && /^\d+\.\d+\.\d+\.\d+$/.test(plan.target) &&
            appVersion === desktopVersion(cli, plan.target)
          if (appVersion !== plan.target && !shortInternationalVersion) throw new CliOperationError('VERSION_MISMATCH', '安装后的应用版本与官方目标不一致')
        }
        control.throwIfAborted()
        const store = this.deps.config.cliExecutablePaths!
        if (store.revision(cli) !== plan.pathRevision) throw new CliOperationError('PLAN_EXPIRED', '安装期间路径设置已变化，未覆盖新设置')
        store.setManual(cli, identity.executable)
        op.afterVersion = version
        if (image) await reopenStoppedApp({ backend: this.deps.backend, config: this.deps.config, image, stopped: stoppedDesktopApps, appRoot: identity.appPath, signal: control, note: text => { op.outputTail = outputTail(op.outputTail + text); changed() } })
        if (plan.oldPath && plan.oldPath !== identity.executable) op.outputTail = outputTail(op.outputTail + `\n已改用新位置；旧位置 ${plan.oldPath} 未删除。\n`)
        succeeded = true
        return { identity, version }
      }, count => {
        op.progress = { readable: false, resumeCount: 0, retryCount: count }
        output(`\n── 下载中断；已自动重试 ${count} 次 ──\n`)
      })
    } catch (error) { quarantined = error instanceof ProcessCleanupUnconfirmedError; if (quarantined) quarantineUpdateCleanup(); throw error }
    finally {
      try { if (npmDownload) await npmDownload.cleanup(succeeded, quarantined) }
      catch { op.outputTail = outputTail(op.outputTail + '\n临时文件或下载通道记忆未能清理；操作已结束。\n') }
      finally { if (file && !npmDownload && !quarantined) await removeUpdateTemporary(file) }
    }
  }
}
