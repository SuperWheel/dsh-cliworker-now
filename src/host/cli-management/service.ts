import { randomUUID } from 'node:crypto'
import { rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { nativeLaunchArgv } from '../native-launch.mjs'
import type { AccountStatus } from '../../shared/accounts.ts'
import { CLI_IDS, type ActiveCliId } from '../../shared/types.ts'
import { customRegistryProblem, NPMMIRROR_REGISTRY, OFFICIAL_NPM_REGISTRY, type CliUpdateEntry, type CliUpdateSnapshot, type CliDownloadSourceSettings, type CliDownloadSourceTest, type CliUpdateOperation } from '../../shared/cli-management.ts'
import type { ProcessBackend, RuntimeConfig } from '../process.ts'
import { ProcessCleanupUnconfirmedError } from '../process.ts'
import { CliManagementCache } from './cache.ts'
import { identifyInstallation, fingerprintToken, type InstallationIdentity } from './identity.ts'
import { CLI_SOURCES, NATIVE_RELEASES, NATIVE_UPDATES, isDesktopCli, installOffer, BACKGROUND_ACCOUNT_CLIS, BACKGROUND_CATALOG_CLIS } from './sources.ts'
import { bounded, captureReadOnly, currentVersion, ReleaseClient, ReleaseError, compatible, latestCompatible, updateAvailable, validVersion, validAppVersion, desktopVersion, piNotice } from './versions.ts'
import { CliPreloader } from './preload.ts'
import { CliMaintenance, CliBusyError } from './maintenance.ts'
import { planCliOperation, automaticMethod, operationToken, operationArgv, sameInstallation, CliOperationError, updateProblem, verifyUpdatedVersion } from './planner.ts'
import { executeCliOperation, outputTail } from './executor.ts'
import { withInterruptionRecovery, type InterruptionEvidence } from './recovery.ts'
import { canPrepareLocalUpdate, prepareLocalUpdate, type LocalArtifactInstall } from './local-artifacts.ts'
import { downloadCliArtifact, parseIntegrity, prepareDownloads } from './download.ts'
import { resolveNpmRuntime } from './npm.ts'
import { checkInstallDirectory, chooseInstallDirectory } from './directory.ts'
import { CliInstaller, type InstallPlan } from './install.ts'
import type { CliOperationPlan } from './planner.ts'
import { installationSource } from './sources.ts'
import { codexConfigDirectory, claudeConfigDirectory } from '../first-party-account-paths.ts'
import { mimoConfigurationPaths } from '../mimo-configuration.ts'
import { qoderConfigDirectory } from '../qoder-accounts.ts'
import { codebuddyAuthDirectory } from '../codebuddy-account.ts'
import { effectiveHermesHome } from '../hermes-account-context.ts'
import { zcodeAuthDirectory } from '../zcode-adapter.ts'
import { openCodeAuthDirectory } from '../opencode-adapter.ts'
import { readDesktopRelease, runDesktopUpdate, DesktopUnavailableError, type DesktopRelease } from './desktop-update.ts'

export { BACKGROUND_ACCOUNT_CLIS } from './sources.ts'
interface Dependencies {
  busy?(cli: ActiveCliId): { workers: number; accounts: boolean }
  assertUpdateAllowed?(cli: ActiveCliId): void
  invalidateModels?(cli: ActiveCliId): void
  root: string; backend: ProcessBackend; config: RuntimeConfig
  idle(): boolean; enabled(): boolean; cliEnabled(cli: ActiveCliId): boolean
  preloadConnection?(cli: ActiveCliId, project: string, kind: 'account' | 'catalog', signal: AbortSignal): Promise<void>
  account(cli: ActiveCliId, project: string, signal: AbortSignal): Promise<AccountStatus>
  globalCleanup?(error: ProcessCleanupUnconfirmedError): void
  cleanup?(cli: ActiveCliId, error: ProcessCleanupUnconfirmedError): void
  identify?: typeof identifyInstallation
  version?: typeof currentVersion
  releases?: ReleaseClient
  artifactFetch?: Parameters<typeof downloadCliArtifact>[0]['fetcher']
}
export class CliManagementService {
  readonly maintenance: CliMaintenance
  readonly cache: CliManagementCache
  private operationRun?: Promise<void>
  private operationController?: AbortController
  private requests = new Map<string, { signature: string; operation: CliUpdateOperation }>()
  private batches = new Set<string>()
  private queued = new Map<ActiveCliId, { token: string; requestId: string }>()
  private state: CliUpdateSnapshot
  private identities = new Map<ActiveCliId, InstallationIdentity>()
  private listeners = new Set<() => void>()
  private lifetime = new AbortController()
  private preloader: CliPreloader
  private running?: Promise<void>
  private pending = new Set<Promise<unknown>>()
  private foregroundController?: AbortController
  private project?: string
  private registryTask?: Promise<void>
  private followRegistry?: string
  private cleanupFailure?: ProcessCleanupUnconfirmedError
  private cleanupCli?: ActiveCliId
  private quarantined = new Map<ActiveCliId, () => void>()
  private readonly releases: ReleaseClient
  private readonly installer?: CliInstaller
  private desktopReleases = new Map<ActiveCliId, DesktopRelease>()
  private projects = new Set<string>()
  constructor(private deps: Dependencies) {
    this.maintenance = deps.config.cliMaintenance ?? new CliMaintenance()
    this.cache = new CliManagementCache(deps.root); this.releases = deps.releases ?? new ReleaseClient()
    if (deps.config.cliExecutablePaths) this.installer = new CliInstaller({ root: deps.root, config: deps.config, backend: deps.backend, releases: this.releases, fetcher: deps.artifactFetch, identify: deps.identify, version: deps.version })
    const cached = this.cache.entries()
    this.state = { revision: 0, activity: 'idle', entries: CLI_IDS.map(cli => ({ ...(cached.find(e => e.cli === cli) ?? { cli, installed: false, group: 'checking' as const }), install: installOffer(cli) })), queue: [], results: [] }
    // Categories are deliberately separate: all file checks before any version/query work.
    this.preloader = new CliPreloader({ idle: () => deps.idle() && !this.cleanupFailure && !this.state.operation && !this.state.queue.length, enabled: deps.enabled,
      activity: active => { if (!this.running) { this.state.activity = active ? 'preloading' : 'idle'; this.changed() } },
      items: [
        ...CLI_IDS.map(cli => ({ run: (signal: AbortSignal) => this.local(cli, signal, true, true) })),
        ...CLI_IDS.map(cli => ({ run: (signal: AbortSignal) => this.local(cli, signal, true, false) })),
        ...(!deps.preloadConnection ? BACKGROUND_ACCOUNT_CLIS.map(cli => ({ run: (signal: AbortSignal) => this.preloadAccount(cli, signal) })) : []),
        ...CLI_IDS.map(cli => ({ run: async (signal: AbortSignal) => { await this.remote(cli, signal, false) } })),
      ],
    })
    this.track(prepareDownloads(deps.root)).catch(() => undefined)
    this.preloader.start()
  }
  context(project: string) {
    this.project = project
    if (this.projects.has(project)) return
    this.projects.add(project)
    if (this.deps.preloadConnection) {
      this.preloader.enqueue(BACKGROUND_ACCOUNT_CLIS.map(cli => ({ run: (signal: AbortSignal) => this.preloadConnection(cli, project, 'account', signal) })), CLI_IDS.length * 2)
      this.preloader.enqueue(BACKGROUND_CATALOG_CLIS.map(cli => ({ run: (signal: AbortSignal) => this.preloadConnection(cli, project, 'catalog', signal) })))
    }
  }
  private async preloadConnection(cli: ActiveCliId, project: string, kind: 'account' | 'catalog', signal: AbortSignal) {
    this.assertHealthy()
    if (!this.deps.cliEnabled(cli) || !this.identities.has(cli)) return
    try { await this.deps.preloadConnection?.(cli, project, kind, signal) }
    catch (error) { if (signal.aborted || error instanceof ProcessCleanupUnconfirmedError) throw error }
  }
  snapshot(): CliUpdateSnapshot { return structuredClone(this.state) }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private changed() { this.state.revision++; for (const listener of this.listeners) listener() }
  activityChanged() {
    this.preloader.changed()
    let changed = false
    for (const row of this.state.entries) {
      const count = this.deps.busy?.(row.cli).workers ?? 0
      if ((row.busyWorkers ?? 0) !== count) { row.busyWorkers = count; changed = true }
    }
    if (changed) this.changed()
  }
  private entry(cli: ActiveCliId) { return this.state.entries.find(e => e.cli === cli)! }
  private publish(cli: ActiveCliId, patch: Partial<CliUpdateEntry>, persist = false) {
    Object.assign(this.entry(cli), patch); if (persist) this.cache.rememberEntry(this.entry(cli)); this.changed()
  }
  check(scope: 'missing' | 'all'): CliUpdateSnapshot {
    this.assertHealthy()
    if (this.running || this.state.operation || this.state.queue.length) return this.snapshot()
    this.state.activity = 'checking'; this.changed()
    const controller = new AbortController(); this.foregroundController = controller
    const unfinished = new Set<ActiveCliId>(CLI_IDS)
    const timer = setTimeout(() => {
      controller.abort()
      for (const cli of unfinished) this.publish(cli, { group: 'failed', reason: 'RELEASE_TIMEOUT', stage: undefined })
    }, 30_000)
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal])
    this.running = (async () => {
      // Let an already-running read finish; do not duplicate it or abandon cleanup.
      await this.preloader.handoff(); signal.throwIfAborted()
      await this.registry(signal)
      await this.pool(CLI_IDS, 3, async cli => {
        await this.local(cli, signal, false, false)
        const row = this.entry(cli)
        if (!row.installed || !row.currentVersion || row.group === 'manual') unfinished.delete(cli)
      }, signal)
      await this.pool(CLI_IDS, 3, async cli => { await this.remote(cli, signal, scope === 'all'); if (!this.entry(cli).installed || !this.entry(cli).currentVersion) await this.installEntry(cli, '', signal); unfinished.delete(cli) }, signal)
      // Finish the safe account portion of the handed-off queue as well.
      if (this.deps.preloadConnection) {
        for (const project of this.projects) {
          for (const cli of BACKGROUND_ACCOUNT_CLIS) await this.preloadConnection(cli, project, 'account', signal)
          for (const cli of BACKGROUND_CATALOG_CLIS) await this.preloadConnection(cli, project, 'catalog', signal)
        }
      } else await this.pool(BACKGROUND_ACCOUNT_CLIS, 3, cli => this.preloadAccount(cli, signal), signal)
      if (!signal.aborted) this.state.checkedAt = Date.now()
    })().catch(() => {
      for (const row of this.state.entries) if (row.stage || row.group === 'checking') this.publish(row.cli, { group: 'failed', reason: signal.aborted ? 'RELEASE_TIMEOUT' : 'RELEASE_UNREACHABLE', stage: undefined })
    }).finally(() => { clearTimeout(timer); this.running = undefined; this.foregroundController = undefined; this.state.activity = 'idle'; this.changed() })
    return this.snapshot()
  }
  private async pool<T>(items: readonly T[], concurrency: number, run: (item: T) => Promise<void>, signal: AbortSignal) {
    let index = 0
    const outcomes = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
      while (index < items.length && !signal.aborted) { const item = items[index++]!; await run(item) }
    }))
    const failed = outcomes.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  }
  private async local(cli: ActiveCliId, signal: AbortSignal, background: boolean, pathOnly: boolean) {
    this.assertHealthy(); signal.throwIfAborted()
    const old = this.entry(cli)
    const oldPath = this.deps.config.cliExecutablePaths?.read(cli)?.path
    const timer = new AbortController(), timeout = setTimeout(() => timer.abort(), 5000)
    const control = AbortSignal.any([signal, timer.signal])
    if (!pathOnly) this.publish(cli, { stage: 'local' })
    try {
      const identity = await (this.deps.identify ?? identifyInstallation)(cli, this.deps.backend, this.deps.config, control, background)
      control.throwIfAborted()
      if (!identity) {
        // No recorded background path is not evidence that this CLI is absent.
        if (background) { this.publish(cli, { stage: undefined }); return }
        this.identities.delete(cli); this.publish(cli, { installed: false, group: 'notInstalled', reason: 'NOT_INSTALLED', reasonDetail: oldPath ? `之前记录的路径 ${oldPath} 已找不到` : undefined, currentVersion: undefined, source: undefined, planToken: undefined, stage: undefined, checkedAt: Date.now() }, true); return
      }
      const previous = this.identities.get(cli)
      if (previous && fingerprintToken(previous.fingerprint) !== fingerprintToken(identity.fingerprint)) this.deps.invalidateModels?.(cli)
      this.identities.set(cli, identity)
      if (pathOnly) return
      const cached = this.cache.version(cli, identity.fingerprint)
      this.assertHealthy()
      const reusable = cached && (!validVersion(identity.manifestVersion) || cached.version === identity.manifestVersion)
      const version = reusable ? cached.version : await (this.deps.version ?? currentVersion)(cli, identity, this.deps.backend, this.deps.config, control, background)
      control.throwIfAborted()
      if (!reusable && (!background || CLI_SOURCES[cli].backgroundSafe)) {
        const after = await (this.deps.identify ?? identifyInstallation)(cli, this.deps.backend, this.deps.config, control, background)
        control.throwIfAborted()
        if (!after || fingerprintToken(after.fingerprint) !== fingerprintToken(identity.fingerprint)) throw new Error('CLI identity changed during version read')
        this.cache.rememberVersion(cli, identity.fingerprint, version)
      }
      const problem = updateProblem(cli, identity), manual = !!problem
      const appVersion = identity.fingerprint.appVersion
      const group = !version ? 'failed' : manual ? 'manual' : old.group === 'checking' || old.group === 'notInstalled' || old.group === 'manual' ? 'checking' : old.group
      this.publish(cli, { installed: true, source: identity.source, currentVersion: version, planToken: fingerprintToken(identity.fingerprint), checkedAt: Date.now(), stage: undefined, group,
        appVersion, channel: identity.channel, notice: identity.notice ?? piNotice(cli, version) ?? NATIVE_UPDATES[cli]?.notice,
        reasonDetail: !version ? CLI_SOURCES[cli].versionNote : undefined,
        reason: !version ? 'UNKNOWN_VERSION' : identity.source === 'unknown' ? 'UNKNOWN_INSTALLATION' : manual ? 'UNSUPPORTED_MANAGER' : undefined,
        manual: manual ? { note: problem!, guideUrl: CLI_SOURCES[cli].guideUrl } : undefined,
      }, true)
    } catch (error) {
      if (error instanceof ProcessCleanupUnconfirmedError) { this.cleanupFailure = error; this.cleanupCli = cli; this.preloader.changed(); this.deps.cleanup?.(cli, error) }
      signal.throwIfAborted()
      const code = (error as NodeJS.ErrnoException)?.code
      const missing = ['ENOENT', 'ENOTDIR', 'SUBPROCESS_EXECUTABLE_NOT_FOUND'].includes(code ?? '') || (error as { reason?: string }).reason === 'not-installed'
      this.identities.delete(cli)
      this.publish(cli, { installed: !missing, group: missing ? 'notInstalled' : 'failed', reason: missing ? 'NOT_INSTALLED' : 'UNKNOWN_VERSION', reasonDetail: missing && oldPath ? `之前记录的路径 ${oldPath} 已找不到` : undefined, stage: undefined, currentVersion: undefined, planToken: undefined, checkedAt: Date.now() }, true)
    } finally { clearTimeout(timeout) }
  }
  private async remote(cli: ActiveCliId, signal: AbortSignal, force: boolean) {
    this.assertHealthy(); signal.throwIfAborted()
    const row = this.entry(cli)
    if (!row.installed || !row.currentVersion) return
    const spec = CLI_SOURCES[cli]
    const identity = this.identities.get(cli), method = identity && automaticMethod(cli, identity)
    const problem = identity && updateProblem(cli, identity)
    if (!identity || !method || problem) {
      this.publish(cli, { group: 'manual', reason: identity?.source === 'unknown' ? 'UNKNOWN_INSTALLATION' : 'UNSUPPORTED_MANAGER', stage: undefined, planToken: undefined, manual: { note: problem ?? '没有核实实际安装入口，无法生成更新计划。', guideUrl: spec.guideUrl } }, true)
      return
    }
    const registry = this.effectiveRegistry(), key = this.cache.releaseKey(cli, NATIVE_RELEASES[cli]?.url ?? spec.npm ?? spec.brew?.name ?? cli, `${row.source}:${registry}`)
    this.publish(cli, { stage: 'remote' })
    try {
      let desktop: DesktopRelease | undefined
      if (method === 'desktop' && isDesktopCli(cli)) {
        if (!identity.appPath || !validAppVersion(row.appVersion)) throw new DesktopUnavailableError('无法核实桌面应用目录或版本，请先修复原安装。')
        desktop = !force && this.cache.release(key) ? this.desktopReleases.get(cli) : undefined
        desktop ??= await this.desktopRelease(cli, identity, signal)
        this.desktopReleases.set(cli, desktop)
      }
      const release = desktop ? { latest: desktopVersion(cli, desktop.version), versions: [desktopVersion(cli, desktop.version)], checkedAt: Date.now(), registry: spec.guideUrl }
        : (!force && this.cache.release(key)) || await this.releases.query(cli, registry, signal, row.source)
      signal.throwIfAborted(); this.cache.rememberRelease(key, release)
      const before = method === 'desktop' ? desktopVersion(cli, row.appVersion!) : row.currentVersion!
      const next = latestCompatible(cli, release.versions, before)
      const incompatible = !compatible(cli, release.latest)
      this.publish(cli, { planToken: operationToken(cli, identity, next, registry, before, desktop), latestVersion: release.latest, latestCompatibleVersion: next, latestCheckedAt: release.checkedAt, mirrored: registry !== OFFICIAL_NPM_REGISTRY && row.source === 'npm', stage: undefined,
        notice: identity.notice ?? piNotice(cli, next ?? row.currentVersion) ?? NATIVE_UPDATES[cli]?.notice, manual: undefined,
        group: !incompatible && next && updateAvailable(before, next) ? 'updatable' : 'latest', reason: incompatible ? 'INCOMPATIBLE_TARGET' : undefined }, true)
    } catch (error) {
      signal.throwIfAborted()
      if (isDesktopCli(cli) && error instanceof DesktopUnavailableError && error.message.includes('未提供更新，当前应用可能已是最新版本') && validAppVersion(row.appVersion)) {
        const version = row.appVersion
        this.desktopReleases.delete(cli)
        this.publish(cli, { group: 'latest', latestVersion: version, latestCompatibleVersion: version, latestCheckedAt: Date.now(), reason: undefined, manual: undefined, planToken: undefined, stage: undefined }, true)
        return
      }
      const unavailable = error instanceof DesktopUnavailableError || error instanceof ReleaseError && error.code === 'NO_RELEASE_SOURCE'
      this.publish(cli, { group: unavailable ? 'manual' : 'failed', reason: unavailable ? 'NO_RELEASE_SOURCE' : error instanceof ReleaseError ? error.code : 'RELEASE_UNREACHABLE', stage: undefined, planToken: undefined,
        manual: unavailable ? { note: error instanceof DesktopUnavailableError ? error.message : '官方发布清单没有此平台的可用工件，请按官方说明更新。', guideUrl: spec.guideUrl } : undefined }, true)
    }
  }
  private async desktopRelease(cli: 'zcode' | 'workbuddycn' | 'workbuddy', identity: InstallationIdentity, signal: AbortSignal) {
    const fetcher: NonNullable<NonNullable<Parameters<typeof readDesktopRelease>[3]>['fetcher']> = (url, init) => this.releases.response(String(url), init?.signal ?? signal)
    const deps = { fetcher }
    return readDesktopRelease(cli, { appVersion: identity.fingerprint.appVersion }, signal, deps)
  }
  private async preloadAccount(cli: ActiveCliId, signal: AbortSignal) {
    this.assertHealthy()
    if (!this.project || !this.deps.cliEnabled(cli) || !this.identities.has(cli)) return
    const project = this.project
    if (this.cache.account(cli, project)?.cache.stale === false) return
    const revision = this.cache.accountRevision(cli)
    const status = await this.deps.account(cli, project, signal)
    signal.throwIfAborted(); this.cache.rememberAccount(cli, project, status, revision)
  }
  private effectiveRegistry() {
    const s = this.cache.settings()
    return s.source === 'official' ? OFFICIAL_NPM_REGISTRY : s.source === 'npmmirror' ? NPMMIRROR_REGISTRY : s.source === 'custom' ? s.customUrl! : this.followRegistry ?? OFFICIAL_NPM_REGISTRY
  }
  private assertHealthy() { this.lifetime.signal.throwIfAborted(); if (this.cleanupFailure) throw this.cleanupFailure }
  private async registry(signal: AbortSignal, background = false) {
    this.assertHealthy()
    if (this.cache.settings().source !== 'follow' || this.followRegistry) return
    if (this.registryTask) return this.registryTask
    this.registryTask = this.readRegistry(signal, background)
    try { await this.registryTask } finally { this.registryTask = undefined }
  }
  private async readRegistry(signal: AbortSignal, background: boolean) {
    const timer = new AbortController(), timeout = setTimeout(() => timer.abort(), 5000)
    const control = AbortSignal.any([signal, timer.signal])
    try {
      const npm = process.platform === 'win32' ? await bounded(resolveNpmRuntime(this.deps.backend), control) : [await bounded(this.deps.backend.resolveExecutable('npm'), control)]
      const value = (await captureReadOnly(this.deps.backend, this.deps.config, [...npm, 'config', 'get', 'registry'], control, background)).trim()
      if (!customRegistryProblem(value)) this.followRegistry = new URL(value).href
    } catch (error) { if (error instanceof ProcessCleanupUnconfirmedError) { this.cleanupFailure = error; this.preloader.changed(); this.deps.globalCleanup?.(error); throw error }; signal.throwIfAborted() }
    finally { clearTimeout(timeout) }
  }
  private track<T>(operation: Promise<T>) { this.pending.add(operation); void operation.finally(() => this.pending.delete(operation)).catch(() => undefined); return operation }
  private async installEntry(cli: ActiveCliId, directory: string, signal: AbortSignal) {
    if (!this.installer) return
    this.assertHealthy()
    try {
      const plan = await this.planCliOperation(cli, 'install', signal, { registry: this.effectiveRegistry(), installDirectory: directory })
      this.publish(cli, { install: plan.offer, planToken: plan.token, latestCompatibleVersion: validVersion(plan.target) ? plan.target : undefined,
        reasonDetail: (this.entry(cli).installed && !this.entry(cli).currentVersion ? CLI_SOURCES[cli].versionNote : undefined) ?? plan.source.reason ?? this.entry(cli).reasonDetail })
    } catch (error) {
      if (error instanceof ProcessCleanupUnconfirmedError) { this.cleanupFailure = error; this.cleanupCli = cli; this.deps.cleanup?.(cli, error); this.preloader.changed() }
      signal.throwIfAborted()
      const source = installationSource(cli)
      this.publish(cli, { planToken: undefined, install: { ...installOffer(cli), method: source.method, prerequisites: [{ name: '安装准备', required: '可核实的版本、路径和运行时', satisfied: false }] } })
    }
  }
  downloadSource(signal: AbortSignal): Promise<CliDownloadSourceSettings> {
    return this.track((async () => { await this.registry(AbortSignal.any([signal, this.lifetime.signal])); return { ...this.cache.settings(), ...(this.followRegistry ? { followRegistry: this.followRegistry } : {}) } })())
  }
  saveDownloadSource(value: unknown) {
    this.lifetime.signal.throwIfAborted()
    const before = JSON.stringify(this.cache.settings()), settings = this.cache.saveSettings(value)
    if (before !== JSON.stringify(settings)) {
      for (const row of this.state.entries) { row.latestCheckedAt = undefined; this.cache.rememberEntry(row) }
      this.changed()
    }
    return settings
  }
  testDownloadSource(url: string, signal: AbortSignal): Promise<CliDownloadSourceTest> {
    const problem = customRegistryProblem(url)
    if (problem) return Promise.resolve({ ok: false, message: problem })
    return this.track((async () => {
      const start = Date.now()
      try { await this.releases.json(new URL('-/ping', url.endsWith('/') ? url : url + '/').href, AbortSignal.any([signal, this.lifetime.signal])); return { ok: true, elapsedMs: Date.now() - start } }
      catch { return { ok: false, message: '连接失败或超时，请检查下载源地址' } }
    })())
  }
  /** Host-only planning: inputs never include commands, URLs or environment variables. */
  async planCliOperation(cli: ActiveCliId, intent: 'update', signal: AbortSignal, selected?: { target?: string; registry: string; automaticSources?: boolean }): Promise<CliOperationPlan>
  async planCliOperation(cli: ActiveCliId, intent: 'install', signal: AbortSignal, selected?: { registry: string; installDirectory?: string; automaticSources?: boolean }): Promise<InstallPlan>
  async planCliOperation(cli: ActiveCliId, intent: 'update' | 'install', signal: AbortSignal, selected?: { target?: string; registry: string; installDirectory?: string; automaticSources?: boolean }) {
    this.assertHealthy()
    if (intent === 'install') {
      if (!this.installer) throw new CliOperationError('PREREQUISITE_MISSING', '首次安装不可用：缺少本机路径存储')
      return this.installer.prepare(cli, selected?.registry ?? this.effectiveRegistry(), selected?.installDirectory ?? '', signal, selected?.automaticSources ?? this.cache.settings().source !== 'custom')
    }
    const identity = await (this.deps.identify ?? identifyInstallation)(cli, this.deps.backend, this.deps.config, signal)
    let version = identity && await (this.deps.version ?? currentVersion)(cli, identity, this.deps.backend, this.deps.config, signal)
    const desktop = identity && automaticMethod(cli, identity) === 'desktop' && isDesktopCli(cli) ? await this.desktopRelease(cli, identity, signal) : undefined
    if (desktop && identity?.fingerprint.appVersion) version = desktopVersion(cli, identity.fingerprint.appVersion)
    signal.throwIfAborted()
    return planCliOperation(cli, intent, identity, version, selected ? selected.target : this.entry(cli).latestCompatibleVersion, selected?.registry ?? this.effectiveRegistry(), desktop)
  }
  start(cli: ActiveCliId, intent: 'update' | 'install', token: string, directory: string, requestId: string): CliUpdateSnapshot {
    const signature = JSON.stringify([cli, intent, token, directory]), previous = this.requests.get(`single:${requestId}`)
    if (previous) {
      if (previous.signature !== signature) throw new CliOperationError('PLAN_EXPIRED', 'requestId 已用于不同请求')
      return { ...this.snapshot(), operation: structuredClone(previous.operation) }
    }
    this.assertHealthy()
    if (intent === 'install' && !this.installer) throw new CliOperationError('PREREQUISITE_MISSING', '首次安装不可用：缺少本机路径存储')
    if (!requestId || requestId.length > 256 || !/^[a-f0-9]{64}$/.test(token)) throw new CliOperationError('PLAN_EXPIRED', '请求或计划无效，请重新检查更新')
    if (this.state.operation || this.state.queue.length) throw new CliBusyError(0)
    this.launch(cli, token, `single:${requestId}`, signature, intent, directory)
    return this.snapshot()
  }
  private launch(cli: ActiveCliId, token: string, requestId: string, signature: string, intent: 'update' | 'install' = 'update', directory = '') {
    // Check external workers/accounts and acquire the lease in this same JS turn.
    this.deps.assertUpdateAllowed?.(cli)
    const release = this.maintenance.begin(cli, () => this.deps.busy?.(cli) ?? { workers: 0, accounts: false })
    const selected = { registry: this.effectiveRegistry(), target: this.entry(cli).latestCompatibleVersion, automaticSources: this.cache.settings().source !== 'custom' }
    const op: CliUpdateOperation = { id: randomUUID(), cli, intent, phase: 'preparing', startedAt: Date.now(), outputTail: '' }
    const output = (value: string) => { op.outputTail = outputTail(op.outputTail + value); this.changed() }
    this.requests.set(requestId, { signature, operation: op })
    this.state.operation = op; this.state.results = this.state.results.filter(item => item.cli !== cli)
    this.operationController = new AbortController()
    const signal = AbortSignal.any([this.operationController.signal, this.lifetime.signal])
    this.foregroundController?.abort(); this.preloader.changed(); this.changed()
    this.operationRun = Promise.resolve().then(async () => {
      let quarantine = false
      let artifact: string | undefined, local: LocalArtifactInstall | undefined
      const desktopArtifacts: string[] = []
      try {
        await this.preloader.pause(); await this.running
        this.assertHealthy(); signal.throwIfAborted()
        const preparation = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        await this.registry(preparation)
        if (intent === 'install') {
          const plan = await this.planCliOperation(cli, 'install', preparation, { ...selected, installDirectory: directory })
          if (plan.token !== token) throw new CliOperationError('PLAN_EXPIRED', '安装方法、路径、前缀、目标或运行时已变化，请重新检查')
          const recheck = async () => {
            const control = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
            const fresh = await this.planCliOperation(cli, 'install', control, { ...selected, installDirectory: directory })
            if (fresh.token !== token) throw new CliOperationError('PLAN_EXPIRED', '执行前安装计划已变化')
            if (fresh.problem) throw new CliOperationError(fresh.problem, '安装前置条件已变化，请重新检查')
            if (plan.source.method === 'desktop') {
              const location = await this.checkDirectory(cli, plan.directory, control)
              if (location.problem) throw new CliOperationError('LOCATION_INVALID', location.message!)
            }
          }
          const result = await this.installer!.execute(plan, op, signal, () => this.changed(), recheck)
          this.identities.set(cli, result.identity); this.cache.invalidateVersion(cli); this.cache.rememberVersion(cli, result.identity.fingerprint, result.version); this.deps.invalidateModels?.(cli)
          this.publish(cli, { installed: true, source: result.identity.source, currentVersion: result.version, group: plan.source.method === 'npm' ? 'latest' : 'manual', reason: undefined, reasonDetail: undefined, planToken: undefined, stage: undefined, checkedAt: Date.now() }, true)
          op.phase = 'succeeded'; return
        }
        const plan = await this.planCliOperation(cli, 'update', preparation, selected)
        if (plan.token !== token) throw new CliOperationError('PLAN_EXPIRED', '安装路径、版本、下载源或目标已变化，请重新检查更新')
        op.beforeVersion = plan.beforeVersion; op.targetVersion = plan.targetVersion
        if (plan.method === 'npm') {
          const metadata = await this.releases.artifact(cli, plan.targetVersion, plan.registry, preparation, selected.automaticSources)
          if (parseIntegrity(metadata.integrity).algorithm !== 'sha512') throw new CliOperationError('INTEGRITY_MISMATCH', 'npm 主包缺少官方 sha512 校验值')
          op.integritySource = OFFICIAL_NPM_REGISTRY
          op.phase = 'downloading'; op.progress = { readable: true, downloadedBytes: 0, resumeCount: 0 }; this.changed()
          // The preparation timeout does not consume the downloader's two-hour budget.
          artifact = await downloadCliArtifact({ root: this.deps.root, output, ...metadata, signal, fetcher: this.deps.artifactFetch,
            progress: value => { op.progress = value; this.changed() } })
          const tgz = artifact.replace(/\.part$/, '.tgz')
          await rename(artifact, tgz); artifact = tgz
        }
        if (plan.method === 'official-script') {
          const script = NATIVE_UPDATES[cli]!.script!
          op.phase = 'downloading'; op.progress = { readable: true, downloadedBytes: 0, resumeCount: 0 }; this.changed()
          artifact = await downloadCliArtifact({ root: this.deps.root, output, url: script.url, officialScript: true, signal, fetcher: this.deps.artifactFetch, progress: value => { op.progress = value; this.changed() } })
          const scriptFile = artifact.replace(/\.part$/, '.sh')
          await rename(artifact, scriptFile); artifact = scriptFile
        }
        if (plan.method === 'self-update' && canPrepareLocalUpdate(cli, plan.identity)) {
          op.phase = 'downloading'; this.changed()
          local = await prepareLocalUpdate({ cli, allowSourceSwitch: selected.automaticSources, version: plan.targetVersion, identity: plan.identity, root: this.deps.root, backend: this.deps.backend, config: this.deps.config, releases: this.releases, signal, fetcher: this.deps.artifactFetch, output, progress: value => { op.progress = value; this.changed() } })
        }
        const admission = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        const argv = plan.method === 'desktop' ? undefined : nativeLaunchArgv(local?.argv ?? await bounded(operationArgv(plan, this.deps.backend, artifact), admission))
        // Recheck after metadata/manager resolution, immediately before spawning.
        const fresh = await this.planCliOperation(cli, 'update', admission, selected)
        if (fresh.token !== token) throw new CliOperationError('PLAN_EXPIRED', '执行前安装身份已变化，请重新检查更新')
        signal.throwIfAborted()
        const run = async (command: string[], control: AbortSignal, evidence?: InterruptionEvidence) => {
          op.command = nativeLaunchArgv(command); op.phase = 'installing'; op.progress ??= { readable: false, resumeCount: 0 }; this.changed()
          await executeCliOperation(this.deps.backend, this.deps.config, op.command, control, value => { op.outputTail = outputTail(op.outputTail + value); this.changed() }, undefined,
            local?.env ?? (plan.method === 'self-update' || plan.method === 'official-script' ? NATIVE_UPDATES[cli]?.env : undefined), evidence)
        }
        const verify = async (control: AbortSignal, evidence?: InterruptionEvidence) => {
          control.throwIfAborted(); op.phase = 'verifying-installation'; this.changed()
          const verification = AbortSignal.any([control, AbortSignal.timeout(15_000)])
          const after = await (this.deps.identify ?? identifyInstallation)(cli, this.deps.backend, this.deps.config, verification)
          if (!after || !sameInstallation(plan.identity, after, cli)) throw new CliOperationError('IDENTITY_CHANGED', '命令已完成，但实际路径或安装归属已变化，请重新检查')
          const cliVersion = await (this.deps.version ?? currentVersion)(cli, after, this.deps.backend, this.deps.config, verification)
          const version = plan.method === 'desktop' && after.fingerprint.appVersion ? desktopVersion(cli, after.fingerprint.appVersion) : cliVersion
          op.afterVersion = version
          if (evidence && version && updateAvailable(plan.beforeVersion, version)) evidence.interrupted = false
          verifyUpdatedVersion(local ? { ...plan, pinsVersion: true, targetVersion: local.targetVersion } : plan, version)
          verification.throwIfAborted()
          return { after, cliVersion, version: version! }
        }
        let verified: Awaited<ReturnType<typeof verify>>
        if (plan.method === 'desktop' && isDesktopCli(cli)) {
          if (!plan.identity.appPath || !plan.desktopRelease) throw new CliOperationError('PREREQUISITE_MISSING', '缺少已核实的桌面路径或发布工件')
          await runDesktopUpdate({ cli, appPath: plan.identity.appPath, release: plan.desktopRelease, root: this.deps.root, signal, run,
            awaiting: () => { op.phase = 'awaiting-user'; this.changed() },
            download: async (url, expected, control) => {
              const algorithm = expected.sha512 ? 'sha512' : 'sha256', digest = expected.sha512 ?? expected.sha256
              if (!digest) throw new CliOperationError('INTEGRITY_MISMATCH', '桌面工件缺少官方摘要')
              const value = new RegExp(`^[a-fA-F0-9]{${algorithm === 'sha512' ? 128 : 64}}$`).test(digest) ? Buffer.from(digest, 'hex').toString('base64') : digest
              op.phase = 'downloading'; op.progress = { readable: true, downloadedBytes: 0, resumeCount: 0 }; this.changed()
              const file = await downloadCliArtifact({ root: this.deps.root, output, url, integrity: `${algorithm}-${value}`, expectedBytes: expected.size, signal: control, fetcher: this.deps.artifactFetch,
                progress: progress => { op.progress = progress; this.changed() } })
              desktopArtifacts.push(file); return file
            } })
          if (plan.identity.notice) op.outputTail = outputTail(op.outputTail + '\n' + plan.identity.notice)
          verified = await verify(signal)
        } else verified = await withInterruptionRecovery(signal, async (control, evidence) => {
          let exitError: unknown
          try { await run(argv!, control, evidence) }
          catch (error) { if (!(error instanceof CliOperationError) || error.code !== 'EXIT_CODE') throw error; exitError = error }
          try {
            const result = await verify(control, evidence)
            if (exitError) throw exitError
            return result
          } catch (error) {
            if (exitError && error instanceof CliOperationError && ['VERSION_UNCHANGED', 'VERSION_MISMATCH'].includes(error.code)) throw exitError
            throw error
          }
        }, count => {
          op.progress = { readable: false, resumeCount: 0, retryCount: count }
          output(`\n── 下载中断；已自动重试 ${count} 次 ──\n`)
        })
        const { after, cliVersion, version } = verified
        this.cache.invalidateVersion(cli); this.deps.invalidateModels?.(cli)
        this.identities.set(cli, after)
        this.cache.rememberVersion(cli, after.fingerprint, cliVersion)
        const row = this.entry(cli), next = row.latestCompatibleVersion
        const incompatible = !!row.latestVersion && !compatible(cli, row.latestVersion)
        const updatable = !incompatible && !!next && updateAvailable(version, next)
        this.publish(cli, { installed: true, source: after.source, currentVersion: cliVersion, appVersion: after.fingerprint.appVersion, channel: after.channel, notice: after.notice ?? piNotice(cli, version) ?? NATIVE_UPDATES[cli]?.notice, group: updatable ? 'updatable' : 'latest',
          reason: incompatible ? 'INCOMPATIBLE_TARGET' : undefined, reasonDetail: undefined, manual: undefined, stage: undefined, checkedAt: Date.now(),
          planToken: updatable ? operationToken(cli, after, next, this.effectiveRegistry(), version, plan.desktopRelease) : undefined }, true)
        op.phase = 'succeeded'
      } catch (error) {
        if (error instanceof ProcessCleanupUnconfirmedError) {
          quarantine = true; this.cleanupFailure = error; this.cleanupCli = cli; this.quarantined.set(cli, release); this.deps.cleanup?.(cli, error)
          op.phase = 'cleanup-unconfirmed'; op.error = { code: 'CLEANUP_UNCONFIRMED', message: '无法确认更新进程全部退出，已暂停后续操作', retryable: false }
        } else if (signal.aborted) {
          op.phase = 'cancelled'; op.outputTail = outputTail(op.outputTail + '\n已取消；已写入的文件不回滚，请重新检查。')
        } else {
          op.phase = 'failed'
          const code = error instanceof CliOperationError ? error.code : (error as { code?: string }).code === 'INTEGRITY_MISMATCH' ? 'INTEGRITY_MISMATCH' : 'UNKNOWN'
          op.error = { code, message: error instanceof CliOperationError ? outputTail(error.message) : code === 'INTEGRITY_MISMATCH' ? '下载源校验值与官方源不符，未执行更新' : '更新失败，请检查网络、安装前缀与输出后重试', retryable: true }
        }
      } finally {
        if (local && !quarantine) await local.cleanup()
        if (artifact && !quarantine) await unlink(artifact).catch(() => undefined)
        if (!quarantine) await Promise.all(desktopArtifacts.map(file => unlink(file).catch(() => undefined)))
        op.finishedAt = Date.now(); this.state.results.push(op); this.state.operation = undefined
        this.operationController = undefined; this.operationRun = undefined
        if (!quarantine) release()
        else { this.state.queue = []; this.queued.clear() }
        this.changed(); this.preloader.changed()
        if (!this.lifetime.signal.aborted && !quarantine) this.nextQueued()
      }
    })
    void this.operationRun.catch(() => undefined)
  }
  updateAll(requestId: string): CliUpdateSnapshot {
    if (this.batches.has(requestId)) return this.snapshot()
    this.assertHealthy()
    if (!requestId || requestId.length > 256) throw new Error('requestId 无效')
    if (this.state.operation || this.state.queue.length) throw new CliBusyError(0)
    this.batches.add(requestId)
    for (const cli of CLI_IDS) {
      const row = this.entry(cli)
      if (row.group !== 'updatable' || !row.planToken) continue
      this.state.queue.push(cli); this.queued.set(cli, { token: row.planToken, requestId: `batch:${requestId}:${cli}` })
    }
    this.nextQueued(); this.changed(); return this.snapshot()
  }
  private nextQueued() {
    if (this.state.operation || this.lifetime.signal.aborted || this.cleanupFailure) return
    while (this.state.queue.length) {
      const cli = this.state.queue.shift()!, item = this.queued.get(cli)!
      this.queued.delete(cli)
      try { this.launch(cli, item.token, item.requestId, JSON.stringify([cli, 'update', item.token, ''])); return }
      catch (error) {
        this.state.results = this.state.results.filter(value => value.cli !== cli)
        this.state.results.push({ id: randomUUID(), cli, intent: 'update', phase: 'failed', startedAt: Date.now(), finishedAt: Date.now(), outputTail: '', error: { code: 'CLI_BUSY', message: outputTail(error instanceof Error ? error.message : '此 CLI 正在使用'), retryable: true } })
      }
    }
    this.changed(); this.preloader.changed()
  }
  cancel(target: string): CliUpdateSnapshot {
    if (this.state.operation?.id === target) {
      this.state.operation.phase = 'cancelling'; this.operationController?.abort(); this.changed()
    } else if (this.queued.has(target as ActiveCliId)) {
      this.queued.delete(target as ActiveCliId); this.state.queue = this.state.queue.filter(cli => cli !== target); this.changed()
    }
    return this.snapshot()
  }
  /** Called only after Runtime and AccountManager accepted the user's explicit cleanup confirmation. */
  recoverCleanup(cli: ActiveCliId) {
    if (this.state.operation || this.cleanupCli !== cli) return
    this.quarantined.get(cli)?.(); this.quarantined.delete(cli)
    this.cleanupFailure = undefined; this.cleanupCli = undefined; this.preloader.changed(); this.changed()
  }
  async checkDirectory(cli: ActiveCliId, path: string, signal: AbortSignal) {
    const control = AbortSignal.any([signal, this.lifetime.signal])
    const other = cli === 'workbuddy' ? 'workbuddycn' : cli === 'workbuddycn' ? 'workbuddy' : undefined
    const otherPath = other && this.deps.config.cliExecutablePaths?.read(other)?.path
    const otherDirectory = otherPath ? /^(.*?\.app)(?:\/|$)/.exec(otherPath)?.[1] ?? dirname(otherPath) : undefined
    const mimo = mimoConfigurationPaths()
    const protectedPaths = [...this.projects, this.deps.root,
      codexConfigDirectory(), claudeConfigDirectory(), mimo.config, mimo.data, join(mimo.home, '.mimocode'),
      qoderConfigDirectory(process.env, 'qoder'), qoderConfigDirectory(process.env, 'qodercn'), codebuddyAuthDirectory(),
      effectiveHermesHome(this.deps.config), zcodeAuthDirectory(this.deps.config.zcodeAuthDirectory, this.deps.root), openCodeAuthDirectory(this.deps.root),
      ...['.dsh', '.codex', '.claude', '.kimi', '.kimi-code', '.mimocode', '.grok', '.pi', '.omp', '.hermes', '.qoder', '.qoder-cn', '.codebuddy', '.trae', '.workbuddy', '.workbuddy-cn'].map(p => join(homedir(), p)),
      ...[process.env.KIMI_CODE_HOME, process.env.DSH_HOME].filter((p): p is string => !!p)]
    return this.track(checkInstallDirectory(cli, path, control, undefined, { protectedPaths, otherWorkBuddyDirectory: otherDirectory }).then(async result => {
      if (!result.problem && !this.state.operation && this.installer && (!this.entry(cli).installed || !this.entry(cli).currentVersion)) await this.installEntry(cli, result.path, control)
      return result
    }))
  }
  async chooseDirectory(cli: ActiveCliId, signal: AbortSignal) {
    this.assertHealthy()
    return this.track(chooseInstallDirectory(cli, this.deps.backend, this.deps.config, AbortSignal.any([signal, this.lifetime.signal])).then(result => result.problem || !result.path ? result : this.checkDirectory(cli, result.path, signal)).catch(error => {
      if (error instanceof ProcessCleanupUnconfirmedError) { this.cleanupFailure = error; this.deps.globalCleanup?.(error); this.preloader.changed() }
      throw error
    }))
  }
  async *watch(signal: AbortSignal): AsyncIterable<CliUpdateSnapshot> {
    const control = AbortSignal.any([signal, this.lifetime.signal]); let wake: (() => void) | undefined, revision = -1
    const notify = () => wake?.(), off = this.subscribe(notify)
    control.addEventListener('abort', notify)
    try {
      while (!control.aborted) {
        if (revision !== this.state.revision) { const value = this.snapshot(); revision = value.revision; yield value }
        else await new Promise<void>(resolve => { wake = resolve; if (control.aborted || revision !== this.state.revision) resolve() })
        wake = undefined
      }
    } finally { off(); control.removeEventListener('abort', notify) }
  }
  async close() { this.state.queue = []; this.queued.clear(); this.lifetime.abort(); this.operationController?.abort(); await this.operationRun; this.foregroundController?.abort(); await this.preloader.close(); await this.running; await Promise.allSettled(this.pending); this.listeners.clear(); if (this.cleanupFailure) throw this.cleanupFailure }
}
