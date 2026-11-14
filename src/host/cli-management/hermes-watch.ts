import { lstat, readdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { CliDownloadProgress } from '../../shared/cli-management.ts'
import type { ProcessBackend, RuntimeConfig } from '../process.ts'
import { ProcessCleanupUnconfirmedError } from '../process.ts'
import { safeObservation } from './artifacts/observations.ts'
import { prepareDownloads } from './download.ts'
import { executeCliOperation, redactOutput } from './executor.ts'
import { CliOperationError } from './planner.ts'
import { OfficialUnavailableError } from './official-watch.ts'
import { cacheGrew, HermesFetchWatchdog, HermesPacks, hermesStage, observeHermesCache, observeTree, pidAlive, treeStamp, type HermesStage, type SlowReason, type TreeObservation } from './hermes-observation.ts'
import { prefetchHermes } from './hermes-prefetch.ts'
export const HERMES_STEPS = ['plan', 'snapshot', 'apply', 'deps', 'build', 'restart'] as const
export class HermesWatch {
  readonly controller = new AbortController()
  private stamps = new Map<string, string>()
  private packs = new HermesPacks()
  private lastBytes = 0
  private cacheStamp?: string
  private partialStamp?: string
  private lastPartialActivity: number
  private completedStamp?: string
  private lastActivity: number
  private lease: number
  private stageAt = 0
  private stageSource = ''
  private logStage = ''
  private logStageAt = 0
  private step?: number
  private stage = '执行 Hermes 官方更新'
  private fetchWatch?: HermesFetchWatchdog
  currentStage: HermesStage = 'unknown'
  stoppedStage?: HermesStage
  reason?: SlowReason
  receiptPidAlive?: boolean
  expectedSha?: string
  stopClass?: string
  exitCode?: number
  constructor(readonly home: string, readonly checkout: string, readonly status: string, readonly startedAt: number, readonly progress: (p: CliDownloadProgress) => void) {
    this.lastActivity = startedAt; this.lastPartialActivity = startedAt; this.lease = startedAt + 20 * 60_000
  }
  async snapshot(cache?: TreeObservation) {
    await this.packs.snapshot(this.checkout)
    this.cacheStamp = treeStamp(cache ?? await observeHermesCache(this.home))
  }
  private setStage(stage: HermesStage | undefined, at: number, source: string, now: number) {
    if (!stage || at < this.stageAt || at === this.stageAt && source === this.stageSource) return
    this.stageAt = at; this.stageSource = source
    if (stage !== this.currentStage) {
      this.currentStage = stage; this.lastActivity = now; this.lastPartialActivity = now
      this.fetchWatch = stage === 'fetch' ? new HermesFetchWatchdog(now) : undefined
    }
  }
  async poll(now = Date.now(), judge = true) {
    let active = false
    const observe = async (path: string, tail = false) => {
      const value = await safeObservation(path, 65536, tail)
      if (!value || value.mtimeMs < this.startedAt) return
      if (this.stamps.get(path) !== value.stamp) { active = true; this.stamps.set(path, value.stamp) }
      return value
    }
    const log = await observe(join(this.home, 'logs/update.log'), true)
    if (log) {
      const lines = log.text.split(/[\r\n]+/)
      const line = lines.filter(l => /^[→✓✗⚠]/.test(l.trim())).at(-1)
      if (line) this.stage = redactOutput(line).slice(0, 2048)
      const stageLine = lines.filter(l => hermesStage(l)).at(-1)
      if (stageLine && stageLine !== this.logStage) { this.logStage = stageLine; this.logStageAt = log.mtimeMs }
      this.setStage(hermesStage(stageLine), this.logStageAt, 'log', now)
    }
    const receipts = join(this.home, 'logs/update_receipts')
    const receiptDir = await lstat(receipts).catch(() => undefined)
    const names = receiptDir?.isDirectory() && !receiptDir.isSymbolicLink() ? (await readdir(receipts)).filter(n => /^(?:latest|update_[A-Za-z0-9_.-]+)\.json$/.test(n)) : []
    // Sort metadata first: filename order does not identify the handoff child (or latest.json).
    const candidates = await Promise.all(names.map(async name => ({ name, stat: await lstat(join(receipts, name)).catch(() => undefined) })))
    candidates.sort((a, b) => (b.stat?.mtimeMs ?? 0) - (a.stat?.mtimeMs ?? 0))
    let latest: { at: number; value: Record<string, any> } | undefined
    for (const { name } of candidates.slice(0, 256)) {
      const receipt = await observe(join(receipts, name)); if (!receipt) continue
      try {
        const value = JSON.parse(receipt.text)
        if (!value || typeof value !== 'object') continue
        const alive = pidAlive(value.pid), writerAlive = pidAlive(value.writer_pid)
        // A dead parent's running receipt is not a current stage. Terminal evidence still matters.
        if (alive === false && writerAlive !== true && value.outcome === 'running') continue
        latest = { at: receipt.mtimeMs, value }; this.receiptPidAlive = writerAlive === true || alive === true ? true : alive
        break
      } catch { /* incomplete receipt: wait for atomic replacement */ }
    }
    if (latest) {
      const r = latest.value, stages = Array.isArray(r.stages) ? r.stages : []
      const last = stages.filter((s: any) => HERMES_STEPS.includes(s?.name) || s?.name === 'fetch').at(-1)
      if (last && HERMES_STEPS.includes(last.name)) this.step = HERMES_STEPS.indexOf(last.name) + 1
      // Native stage marks are END marks. Do not leave a child in its parent's completed apply.
      const next: Record<string, HermesStage> = { plan: 'snapshot', snapshot: 'fetch', fetch: 'apply', apply: 'deps', deps: 'build', build: 'restart', restart: 'restart' }
      const stage = hermesStage(r.stage ?? r.current_stage) ?? (last ? ['success', 'skipped'].includes(last.outcome) ? next[last.name] : hermesStage(last.name) : undefined)
      this.setStage(stage, latest.at, 'receipt', now)
      this.stopClass = typeof r.stop_class === 'string' && /^[a-z][a-z0-9_]{0,100}$/.test(r.stop_class) ? r.stop_class : undefined
      this.exitCode = Number.isInteger(r.exit_code) ? r.exit_code : undefined
      const expected = r.expected_sha ?? r.target_sha ?? r.completion_request?.expected_sha ?? r.plan?.expected_sha
      if (typeof expected === 'string' && /^[a-f0-9]{40}$/i.test(expected)) this.expectedSha = expected.toLowerCase()
    }
    const status = await observe(this.status)
    if (status) {
      try {
        const value = JSON.parse(status.text)
        if (typeof value.message === 'string') this.stage = redactOutput(value.message).slice(0, 2048)
        this.setStage(hermesStage(value.stage) ?? hermesStage(value.message), status.mtimeMs, 'status', now)
      } catch { /* atomic writer may not have published yet */ }
    }
    const dependencies = ['deps', 'tools', 'uv', 'pnpm'].includes(this.currentStage)
    const [pack, cache, partials] = await Promise.all([
      this.packs.poll(this.checkout), judge && (dependencies || this.currentStage === 'unknown') ? observeHermesCache(this.home) : undefined,
      observeTree(join(this.home, 'cache/partials'), n => /\.(?:part|ranges)$/.test(n), false),
    ])
    if (pack.bytes > this.lastBytes) active = true
    this.lastBytes = pack.bytes
    if (cache) {
      const stamp = treeStamp(cache)
      if (!cache.complete || stamp !== this.cacheStamp) active = true
      this.cacheStamp = stamp
      const completed = [...cache.completed.files].map(([p, f]) => `${p}:${f.size}`).sort().join('\n')
      if (completed !== this.completedStamp) this.lastPartialActivity = now
      this.completedStamp = completed
    }
    // _fetch_ranged truncates .part to its final length before writing ranges. In-place
    // writes (mtime/ctime) and durable .ranges checkpoints, not logical size, prove activity.
    const partialStamp = treeStamp(partials)
    if (!partials.complete || partialStamp !== this.partialStamp) this.lastPartialActivity = now
    this.partialStamp = partialStamp
    if (active) { this.lastActivity = now; this.lease = now + 20 * 60_000 }
    const protectedStage = this.currentStage === 'apply' || this.currentStage === 'restart'
    if (judge && !protectedStage && !this.controller.signal.aborted) {
      let reason: SlowReason | undefined
      if (this.currentStage === 'fetch' && pack.complete) reason = this.fetchWatch?.check(now, pack.bytes)
      const tools = this.currentStage === 'tools' || this.currentStage === 'deps' && partials.files.size > 0
      if (tools && partials.complete && cache?.complete && now - this.lastPartialActivity >= 30_000) reason = 'OFFICIAL_STALLED'
      else if (dependencies && now - this.lastActivity >= 120_000) reason = 'OFFICIAL_STALLED'
      if (reason) { this.reason = reason; this.stoppedStage = this.currentStage; this.controller.abort(new OfficialUnavailableError(reason)) }
      else if (now - this.lastActivity >= 5 * 60_000 || now >= this.lease) this.controller.abort(new CliOperationError('INSTALL_TIMEOUT', 'Hermes 日志和回执连续 5 分钟没有活动'))
    }
    const observed = pack.bytes > 0
    this.progress({ channel: 'official', readable: observed, byteProgress: observed, byteProgressState: observed ? 'unknown-total' : 'none', ...(observed ? { downloadedBytes: pack.bytes } : {}), elapsedSeconds: Math.max(0, (now - this.startedAt) / 1000), resumeCount: 0, stage: this.stage,
      ...(this.step ? { currentStep: this.step, totalSteps: 6, stepName: HERMES_STEPS[this.step - 1]! } : {}) })
  }
}
export interface HermesUpdateOptions {
  root: string; home: string; checkout: string; argv: string[]; backend: ProcessBackend; config: RuntimeConfig; signal: AbortSignal
  beforeVersion?: string; targetVersion?: string; targetSha?: string
  npmRegistry?: string
  releaseSha?: (version: string, signal: AbortSignal) => Promise<string>
  platform?: NodeJS.Platform
  arch?: string
  output(s: string): void; progress(p: CliDownloadProgress): void
}
export async function runHermesUpdate(o: HermesUpdateOptions) {
  const privateDir = await mkdtemp(join(await prepareDownloads(o.root), 'local-'))
  let quarantine = false, stopped = false, attempt = 0, depsRetries = 0, fallbackRetries = 0, prefetched = false
  let recoveryFailure: unknown
  try {
    for (;;) {
      o.signal.throwIfAborted()
      const before = await observeHermesCache(o.home)
      const watch = new HermesWatch(o.home, o.checkout, join(privateDir, `status-${attempt}.json`), Date.now(), p => o.progress({ ...p, retryCount: attempt }))
      await watch.snapshot(before); let polling = Promise.resolve(), pending = false
      const timer = setInterval(() => {
        if (pending) return
        pending = true
        polling = watch.poll().catch(() => undefined).finally(() => { pending = false })
      }, 1000)
      let failure: unknown
      try {
        await executeCliOperation(o.backend, o.config, o.argv, AbortSignal.any([o.signal, watch.controller.signal]), o.output, 2147483647, {
          HERMES_HOME: o.home, HERMES_UPDATE_STATUS_FILE: watch.status,
          ...(o.npmRegistry !== undefined ? { npm_config_registry: o.npmRegistry } : {}),
        })
      } catch (error) { failure = error; if (error instanceof ProcessCleanupUnconfirmedError) throw error }
      finally { clearInterval(timer); await polling; stopped ||= watch.controller.signal.aborted || o.signal.aborted; await watch.poll(Date.now(), false).catch(() => undefined) }
      o.signal.throwIfAborted()
      if (recoveryFailure) throw recoveryFailure
      if (!failure) return
      if (watch.stopClass) o.output(`Hermes 更新失败：${watch.stopClass}\n`)
      if (watch.exitCode === 2 || failure instanceof CliOperationError && /退出码 2(?:\D|$)/.test(failure.message)) throw failure
      if (watch.reason && watch.stoppedStage === 'fetch' && !prefetched) {
        prefetched = true
        try { await prefetchHermes(o, watch.reason, o.targetSha ?? watch.expectedSha) }
        catch (error) {
          if (error instanceof ProcessCleanupUnconfirmedError) throw error
          o.signal.throwIfAborted()
          // Windows pauses the gateway before fetch. Give the official updater one recovery run,
          // but a failed integrity/prefetch check must still be reported as a failure.
          if ((o.platform ?? process.platform) !== 'win32') throw error
          recoveryFailure = error
          o.output('Hermes 预取失败，重新启动官方更新以恢复可能暂停的网关。\n')
        }
        attempt++; continue
      }
      if (watch.reason && ['deps', 'tools', 'uv', 'pnpm'].includes(watch.stoppedStage ?? '')) {
        if (depsRetries >= 3 || !cacheGrew(before, await observeHermesCache(o.home))) throw failure
        depsRetries++; attempt++
        o.output(`Hermes 依赖停滞，缓存已有新落盘，官方重跑 ${depsRetries}/3。\n`)
        continue
      }
      if (watch.reason || fallbackRetries++ >= 1) throw failure
      attempt++
      o.output('Hermes 官方更新失败，读取回执后自动重跑一次；由官方恢复残留。\n')
    }
  } catch (error) {
    quarantine = error instanceof ProcessCleanupUnconfirmedError
    if (stopped && (o.platform ?? process.platform) === 'win32') o.output('Hermes 网关可能仍处于暂停状态；请启动一次 Hermes 以恢复网关。\n')
    throw error
  } finally { if (!quarantine) await rm(privateDir, { recursive: true, force: true }) }
}
