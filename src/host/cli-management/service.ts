import type { AccountStatus } from '../../shared/accounts.ts'
import { CLI_IDS, type ActiveCliId } from '../../shared/types.ts'
import { customRegistryProblem, NPMMIRROR_REGISTRY, OFFICIAL_NPM_REGISTRY, type CliUpdateEntry, type CliUpdateSnapshot, type CliDownloadSourceSettings, type CliDownloadSourceTest } from '../../shared/cli-management.ts'
import type { ProcessBackend, RuntimeConfig } from '../process.ts'
import { ProcessCleanupUnconfirmedError } from '../process.ts'
import { CliManagementCache } from './cache.ts'
import { identifyInstallation, fingerprintToken, type InstallationIdentity } from './identity.ts'
import { CLI_SOURCES, installOffer, BACKGROUND_ACCOUNT_CLIS } from './sources.ts'
import { bounded, captureReadOnly, currentVersion, ReleaseClient, ReleaseError, compatible, latestCompatible, updateAvailable } from './versions.ts'
import { CliPreloader } from './preload.ts'

/** Audited file-only AccountManager.status branches. All others are skipped:
 * Grok/Hermes renew tokens; WorkBuddy bootstraps keys/config; Claude prepares a
 * route; Codex starts app-server; Qoder/CN and TRAE start native sessions;
 * Pi/OMP discover native login providers; Antigravity may query OS/account services;
 * Kimi provider listing, ZCode status and OpenCode profile discovery have not
 * been audited for background use.
 */
export { BACKGROUND_ACCOUNT_CLIS } from './sources.ts'
interface Dependencies {
  root: string; backend: ProcessBackend; config: RuntimeConfig
  idle(): boolean; enabled(): boolean; cliEnabled(cli: ActiveCliId): boolean
  account(cli: ActiveCliId, project: string, signal: AbortSignal): Promise<AccountStatus>
  cleanup?(cli: ActiveCliId, error: ProcessCleanupUnconfirmedError): void
  identify?: typeof identifyInstallation
  version?: typeof currentVersion
  releases?: ReleaseClient
}
export class CliManagementService {
  readonly cache: CliManagementCache
  private state: CliUpdateSnapshot
  private identities = new Map<ActiveCliId, InstallationIdentity>()
  private listeners = new Set<() => void>()
  private lifetime = new AbortController()
  private preloader: CliPreloader
  private running?: Promise<void>
  private pending = new Set<Promise<unknown>>()
  private foregroundController?: AbortController
  private project?: string
  private followRegistry?: string
  private cleanupFailure?: ProcessCleanupUnconfirmedError
  private readonly releases: ReleaseClient
  constructor(private deps: Dependencies) {
    this.cache = new CliManagementCache(deps.root); this.releases = deps.releases ?? new ReleaseClient()
    const cached = this.cache.entries()
    this.state = { revision: 0, activity: 'idle', entries: CLI_IDS.map(cli => ({ ...(cached.find(e => e.cli === cli) ?? { cli, installed: false, group: 'checking' as const }), install: installOffer(cli) })), queue: [], results: [] }
    // Categories are deliberately separate: all file checks before any version/query work.
    this.preloader = new CliPreloader({ idle: () => deps.idle() && !this.state.operation, enabled: deps.enabled,
      activity: active => { if (!this.running) { this.state.activity = active ? 'preloading' : 'idle'; this.changed() } },
      items: [
        ...CLI_IDS.map(cli => ({ run: (signal: AbortSignal) => this.local(cli, signal, true, true) })),
        ...CLI_IDS.map(cli => ({ run: (signal: AbortSignal) => this.local(cli, signal, true, false) })),
        ...BACKGROUND_ACCOUNT_CLIS.map(cli => ({ run: (signal: AbortSignal) => this.preloadAccount(cli, signal) })),
        ...CLI_IDS.map(cli => ({ run: async (signal: AbortSignal) => { await this.registry(signal, true); await this.remote(cli, signal, false) } })),
        // No catalog discovery is silently treated as read-only: MiMo can invoke
        // models --refresh; native catalogs create sessions/renew credentials.
        // Existing SettingsCatalogCache stays unchanged; missing model discovery
        // remains a foreground operation until a side-effect-free branch is audited.
      ],
    })
    this.preloader.start()
  }
  context(project: string) { this.project = project }
  snapshot(): CliUpdateSnapshot { return structuredClone(this.state) }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private changed() { this.state.revision++; for (const listener of this.listeners) listener() }
  activityChanged() { this.preloader.changed() }
  private entry(cli: ActiveCliId) { return this.state.entries.find(e => e.cli === cli)! }
  private publish(cli: ActiveCliId, patch: Partial<CliUpdateEntry>, persist = false) {
    Object.assign(this.entry(cli), patch); if (persist) this.cache.rememberEntry(this.entry(cli)); this.changed()
  }
  check(scope: 'missing' | 'all'): CliUpdateSnapshot {
    this.lifetime.signal.throwIfAborted()
    if (this.running) return this.snapshot()
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
      await this.pool(CLI_IDS, 3, async cli => { await this.remote(cli, signal, scope === 'all'); unfinished.delete(cli) }, signal)
      // Finish the safe account portion of the handed-off queue as well.
      await this.pool(BACKGROUND_ACCOUNT_CLIS, 3, cli => this.preloadAccount(cli, signal), signal)
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
    signal.throwIfAborted()
    const old = this.entry(cli)
    const timer = new AbortController(), timeout = setTimeout(() => timer.abort(), 5000)
    const control = AbortSignal.any([signal, timer.signal])
    if (!pathOnly) this.publish(cli, { stage: 'local' })
    try {
      const identity = await (this.deps.identify ?? identifyInstallation)(cli, this.deps.backend, this.deps.config, control, background)
      control.throwIfAborted()
      if (!identity) {
        // No recorded background path is not evidence that this CLI is absent.
        if (background) { this.publish(cli, { stage: undefined }); return }
        this.identities.delete(cli); this.publish(cli, { installed: false, group: 'notInstalled', reason: 'NOT_INSTALLED', currentVersion: undefined, source: undefined, planToken: undefined, stage: undefined, checkedAt: Date.now() }, true); return
      }
      this.identities.set(cli, identity)
      if (pathOnly) return
      const cached = this.cache.version(cli, identity.fingerprint)
      const version = cached?.version ?? await (this.deps.version ?? currentVersion)(cli, identity, this.deps.backend, this.deps.config, control, background)
      control.throwIfAborted()
      if (version && !cached) {
        const after = await (this.deps.identify ?? identifyInstallation)(cli, this.deps.backend, this.deps.config, control, background)
        control.throwIfAborted()
        if (!after || fingerprintToken(after.fingerprint) !== fingerprintToken(identity.fingerprint)) throw new Error('CLI identity changed during version read')
        this.cache.rememberVersion(cli, identity.fingerprint, version)
      }
      const manual = ['desktop-app', 'winget', 'scoop', 'nix', 'bun', 'pnpm', 'unknown'].includes(identity.source)
      const group = !version ? 'failed' : manual ? 'manual' : old.group === 'checking' || old.group === 'notInstalled' ? 'checking' : old.group
      this.publish(cli, { installed: true, source: identity.source, currentVersion: version, planToken: fingerprintToken(identity.fingerprint), checkedAt: Date.now(), stage: undefined, group,
        reason: !version ? 'UNKNOWN_VERSION' : identity.source === 'desktop-app' ? 'APP_MANAGED' : identity.source === 'unknown' ? 'UNKNOWN_INSTALLATION' : manual ? 'UNSUPPORTED_MANAGER' : undefined,
        manual: manual ? { note: '请按官方说明在原安装渠道更新，然后重新检查。', guideUrl: CLI_SOURCES[cli].guideUrl } : undefined,
      }, true)
    } catch (error) {
      if (error instanceof ProcessCleanupUnconfirmedError) { this.cleanupFailure = error; this.deps.cleanup?.(cli, error) }
      signal.throwIfAborted()
      const code = (error as NodeJS.ErrnoException)?.code
      const missing = ['ENOENT', 'ENOTDIR', 'SUBPROCESS_EXECUTABLE_NOT_FOUND'].includes(code ?? '') || (error as { reason?: string }).reason === 'not-installed'
      this.identities.delete(cli)
      this.publish(cli, { installed: !missing, group: missing ? 'notInstalled' : 'failed', reason: missing ? 'NOT_INSTALLED' : 'UNKNOWN_VERSION', stage: undefined, currentVersion: undefined, planToken: undefined, checkedAt: Date.now() }, true)
    } finally { clearTimeout(timeout) }
  }
  private async remote(cli: ActiveCliId, signal: AbortSignal, force: boolean) {
    signal.throwIfAborted()
    const row = this.entry(cli)
    if (!row.installed || !row.currentVersion) return
    const spec = CLI_SOURCES[cli]
    if (!spec.npm && !spec.brew || row.group === 'manual') {
      if (row.group !== 'manual') this.publish(cli, { group: 'manual', reason: 'NO_RELEASE_SOURCE', stage: undefined, manual: { note: '发布源尚未核实，请查看官方说明。', guideUrl: spec.guideUrl } }, true)
      return
    }
    const registry = this.effectiveRegistry(), key = this.cache.releaseKey(cli, spec.npm ?? spec.brew!.name, `${row.source}:${registry}`)
    this.publish(cli, { stage: 'remote' })
    try {
      const release = (!force && this.cache.release(key)) || await this.releases.query(cli, registry, signal, row.source)
      signal.throwIfAborted(); this.cache.rememberRelease(key, release)
      const next = latestCompatible(cli, release.versions, row.currentVersion)
      const incompatible = !compatible(cli, release.latest)
      this.publish(cli, { latestVersion: release.latest, latestCompatibleVersion: next, latestCheckedAt: release.checkedAt, mirrored: registry !== OFFICIAL_NPM_REGISTRY && row.source === 'npm', stage: undefined,
        group: !incompatible && next && updateAvailable(row.currentVersion!, next) ? 'updatable' : 'latest', reason: incompatible ? 'INCOMPATIBLE_TARGET' : undefined }, true)
    } catch (error) {
      signal.throwIfAborted()
      this.publish(cli, { group: 'failed', reason: error instanceof ReleaseError ? error.code : 'RELEASE_UNREACHABLE', stage: undefined }, true)
    }
  }
  private async preloadAccount(cli: ActiveCliId, signal: AbortSignal) {
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
  private async registry(signal: AbortSignal, background = false) {
    if (this.cache.settings().source !== 'follow' || this.followRegistry) return
    const timer = new AbortController(), timeout = setTimeout(() => timer.abort(), 5000)
    const control = AbortSignal.any([signal, timer.signal])
    try {
      const npm = await bounded(this.deps.backend.resolveExecutable(process.platform === 'win32' ? 'npm.cmd' : 'npm'), control)
      const value = (await captureReadOnly(this.deps.backend, this.deps.config, [npm, 'config', 'get', 'registry'], control, background)).trim()
      if (!customRegistryProblem(value)) this.followRegistry = new URL(value).href
    } catch (error) { if (error instanceof ProcessCleanupUnconfirmedError) { this.cleanupFailure = error; throw error }; signal.throwIfAborted() }
    finally { clearTimeout(timeout) }
  }
  private track<T>(operation: Promise<T>) { this.pending.add(operation); void operation.finally(() => this.pending.delete(operation)).catch(() => undefined); return operation }
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
  async close() { this.lifetime.abort(); this.foregroundController?.abort(); await this.preloader.close(); await this.running; await Promise.allSettled(this.pending); this.listeners.clear(); if (this.cleanupFailure) throw this.cleanupFailure }
}
