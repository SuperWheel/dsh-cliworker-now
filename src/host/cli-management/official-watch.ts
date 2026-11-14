import { trackUpdateTemporary, removeUpdateTemporary } from './update-cleanup.ts'
import { observedPackages } from './artifacts/observations.ts'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lstat, readdir, rmdir, open, mkdtemp, chmod } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, dirname } from 'node:path'
import type { Stats } from 'node:fs'
import type { CliChannelReason, CliDownloadProgress } from '../../shared/cli-management.ts'
import type { OfficialProbe } from './artifacts/types.ts'
import { InterruptionEvidence, OFFICIAL_INTERRUPTION_EVIDENCE } from './recovery.ts'
import { redactOutput } from './executor.ts'
import { prepareDownloads } from './download.ts'
import { CliOperationError } from './planner.ts'

export class OfficialUnavailableError extends CliOperationError {
  constructor(readonly reason: CliChannelReason) { super('OFFICIAL_UNAVAILABLE', `官方渠道不可用（${reason}），准备切换插件接管`) }
}
export const officialBudgetMs = (bytes?: number) => Math.min(600_000, Math.max(180_000, bytes ? bytes / 200_000 * 1000 : 600_000))
const missing = (e: unknown) => ['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')
const matches = (pattern: RegExp | undefined, value: string) => { if (!pattern) return false; pattern.lastIndex = 0; return pattern.test(value) }
interface Sample { time: number; bytes: number }
/** Pure time/byte policy, independent of polling frequency and wall-clock test sleeps. */
export class OfficialWatchdog {
  private samples: Sample[] = []
  private lastBytes?: number
  private lastGrowth: number
  private downloadStarted?: number
  constructor(readonly startedAt: number, public totalBytes?: number, readonly hardTimeoutMs?: number) { this.lastGrowth = startedAt }
  check(now: number, bytes?: number): CliChannelReason | undefined {
    if (bytes !== undefined) {
      if (this.lastBytes !== undefined && bytes < this.lastBytes) return 'OFFICIAL_RESTARTED'
      this.downloadStarted ??= now
      if (this.lastBytes === undefined || bytes > this.lastBytes) this.lastGrowth = now
      this.lastBytes = bytes
      this.samples.push({ time: now, bytes })
      while (this.samples.length > 1 && this.samples[1]!.time <= now - 60_000) this.samples.shift()
      if (!this.totalBytes || bytes < this.totalBytes) {
        if (now - this.lastGrowth >= 30_000) return 'OFFICIAL_STALLED'
        const first = this.samples[0]!, duration = now - first.time, rate = duration > 0 ? (bytes - first.bytes) / duration * 1000 : 0
        if (duration >= 60_000 && rate < 100_000) return 'OFFICIAL_SLOW'
        if (this.totalBytes && this.hardTimeoutMs && now - this.downloadStarted >= 30_000 && rate > 0 && now - this.startedAt + (this.totalBytes - bytes) / rate * 1000 >= this.hardTimeoutMs) return 'OFFICIAL_DEADLINE'
      }
    }
    // No trustworthy bytes: silence is not a 30-second stall. Always allow the bounded full budget.
    if (now - this.startedAt >= (bytes === undefined ? officialBudgetMs(this.totalBytes) : 600_000)) return 'OFFICIAL_BUDGET'
  }
}
interface Owned { path: string; relative: string; stat: Stats }
/** Snapshot first; ambiguous files, pre-existing files, symlinks and hardlinks never supply bytes. */
export class OfficialWatch extends InterruptionEvidence {
  readonly controller = new AbortController()
  readonly env: Record<string, string> = {}
  private baseline = new Set<string>()
  private owned = new Map<string, Owned>()
  private present = new Map<string, Owned>()
  private ownedDirs = new Map<string, Owned>()
  private lengths = new Map<string, number | undefined>()
  private packageBaseline = new Set<string>()
  private packageCount = 0
  private logs = new Map<string, string>()
  private timer?: ReturnType<typeof setInterval>
  private polling: Promise<void> = Promise.resolve()
  private startedAt = 0
  private watchdog?: OfficialWatchdog
  private rawSuffix = ''
  private line = ''
  private stage = '执行官方更新命令'
  private phaseOnly = false
  private lastTotal = 0
  private lastAt = 0
  private disabled = false
  private rootIdentity?: Stats
  alreadyLatest = false
  lockConflict = false
  reason?: CliChannelReason
  constructor(readonly probe: OfficialProbe, private progress: (value: CliDownloadProgress) => void) { super(); this.phaseOnly = probe.phaseOnly ?? false }
  static async prepare(probe: OfficialProbe, root: string, progress: (value: CliDownloadProgress) => void) {
    const watch = new OfficialWatch({ ...probe }, progress)
    if (probe.privateTemp) {
      watch.probe.directory = trackUpdateTemporary(await mkdtemp(join(await prepareDownloads(root), 'local-')))
      await chmod(watch.probe.directory, 0o700)
      watch.env[probe.privateTemp] = watch.probe.directory
      if (probe.privateTemp === 'TEMP') watch.env.TMP = watch.probe.directory
    }
    try {
      if (probe.packageDirectory) watch.packageBaseline = new Set(await readdir(probe.packageDirectory).catch(() => []))
      const entries = await watch.scan()
      watch.baseline = new Set(entries.map(e => e.relative))
      if (watch.probe.directory) watch.rootIdentity = await lstat(watch.probe.directory).catch(() => undefined)
      for (const path of probe.stageFiles ?? []) watch.logs.set(path, await watch.readStage(path) ?? '')
    } catch { watch.disabled = true }
    return watch
  }
  start(now = Date.now()) {
    this.startedAt = now; this.lastAt = now
    this.watchdog = new OfficialWatchdog(now, this.probe.totalBytes, this.probe.hardTimeoutMs)
    this.report(now)
    this.timer = setInterval(() => { this.polling = this.polling.then(() => this.poll()).catch(() => { this.disabled = true }) }, 1000)
  }
  override push(value: string) {
    super.push(value)
    const text = this.rawSuffix + value
    if (OFFICIAL_INTERRUPTION_EVIDENCE.test(text)) this.fail('OFFICIAL_INTERRUPTED')
    if (/already (?:on |at )?(?:the )?latest|already up[- ]to[- ]date|up to date|已是最新/i.test(text)) this.alreadyLatest = true
    if (/another update process is running|already in progress/i.test(text)) this.lockConflict = true
    if (matches(this.probe.phaseOnlyPattern, text)) this.phaseOnly = true
    this.rawSuffix = text.slice(-512)
    this.line += value
    const lines = this.line.split(/[\r\n]+/); this.line = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) this.stage = redactOutput(line).slice(0, 2048)
    if (this.line.length > 64 * 1024) this.line = ''
  }
  private fail(reason: CliChannelReason) { if (!this.reason) { this.reason = reason; this.controller.abort(new OfficialUnavailableError(reason)) } }
  private async scan(): Promise<Owned[]> {
    const root = this.probe.directory
    if (!root || this.probe.kind !== 'files') return []
    // Refuse symlinked ancestors too, not only the candidate itself.
    for (let p = root; ; p = dirname(p)) {
      try { if ((await lstat(p)).isSymbolicLink()) throw new Error('Ambiguous staging directory') } catch (e) { if (!missing(e)) throw e }
      if (dirname(p) === p) break
    }
    let info: Stats
    try { info = await lstat(root) } catch (e) { if (missing(e)) return []; throw e }
    if (!info.isDirectory() || this.rootIdentity && (info.ino !== this.rootIdentity.ino || info.dev !== this.rootIdentity.dev)) throw new Error('Staging root replaced')
    this.rootIdentity ??= info
    const found: Owned[] = []
    let count = 0
    const walk = async (directory: string, prefix: string, depth: number) => {
      if (depth > 5) return
      for (const name of await readdir(directory)) {
        if (++count > 4096) throw new Error('Staging scan too large')
        const rel = prefix + name
        if (!matches(this.probe.fileRule, rel) && !matches(this.probe.directoryRule, rel)) continue
        const path = join(directory, name)
        let stat: Stats
        try { stat = await lstat(path) } catch (e) { if (missing(e)) continue; throw e }
        if (stat.isSymbolicLink()) continue
        if (stat.isDirectory() && matches(this.probe.directoryRule, rel)) { found.push({ path, relative: rel, stat }); await walk(path, rel + '/', depth + 1) }
        else if (stat.isFile() && stat.nlink === 1 && matches(this.probe.fileRule, rel)) found.push({ path, relative: rel, stat })
      }
    }
    await walk(root, '', 0); return found
  }
  private async collect() {
    if (this.disabled) return
    const present = new Map<string, Owned>()
    for (const entry of await this.scan()) {
      const parts = entry.relative.split('/')
      if (parts.some((_, index) => this.baseline.has(parts.slice(0, index + 1).join('/'))) || entry.stat.mtimeMs < this.startedAt) continue
      const entries = entry.stat.isDirectory() ? this.ownedDirs : this.owned
      const before = entries.get(entry.relative)
      if (before && (before.stat.ino !== entry.stat.ino || before.stat.dev !== entry.stat.dev || entry.stat.size < before.stat.size) && !entry.stat.isDirectory()) this.fail('OFFICIAL_RESTARTED')
      entries.set(entry.relative, entry)
      if (entry.stat.isFile()) present.set(entry.relative, entry)
    }
    this.present = present
  }
  async poll(now = Date.now()) {
    await this.collect()
    if (this.probe.packageDirectory) this.packageCount = await observedPackages(this.probe.packageDirectory, this.startedAt, this.packageBaseline)
    for (const path of this.probe.stageFiles ?? []) {
      const stage = await this.readStage(path)
      if (stage !== undefined && stage !== this.logs.get(path)) { this.logs.set(path, stage); this.push(stage + '\n') }
    }
    if (this.probe.totalForFile) {
      for (const entry of this.owned.values()) if (!this.lengths.has(entry.relative)) {
        let length: number | undefined
        try { length = await this.probe.totalForFile(entry.relative, AbortSignal.any([this.controller.signal, AbortSignal.timeout(8000)])) } catch { /* No trusted total: bytes only. */ }
        this.lengths.set(entry.relative, length)
      }
      const lengths = [...this.lengths.values()]
      this.probe.totalBytes = lengths.length && lengths.every(n => n !== undefined) ? lengths.reduce<number>((sum, n) => sum + n!, 0) : undefined
      if (this.watchdog) this.watchdog.totalBytes = this.probe.totalBytes
    }
    let bytes = !this.disabled && !this.phaseOnly && this.present.size ? [...this.present.values()].reduce((sum, e) => sum + e.stat.size, 0) : undefined
    // Disappearing incomplete staging is a restart. Finished staging may be moved during installation.
    if (bytes === undefined && !this.disabled && !this.phaseOnly && this.lastTotal > 0 && this.probe.totalBytes && this.lastTotal < this.probe.totalBytes) bytes = 0
    if (this.lockConflict && !this.controller.signal.aborted) {
      const lock = await officialLockState(this.probe.lockFile, this.probe.lockCommandPattern)
      if (lock !== 'stale') this.controller.abort(new CliOperationError('UPDATE_LOCKED', '官方更新锁仍有效或无法确认归属'))
      else if (now - this.startedAt >= 30_000) this.fail('OFFICIAL_STALLED')
    }
    const reason = this.watchdog?.check(now, bytes)
    if (reason && !this.lockConflict) this.fail(reason)
    this.report(now, bytes)
  }
  private report(now: number, bytes?: number) {
    this.progress({ channel: 'official', stage: this.stage, readable: bytes !== undefined, byteProgress: bytes !== undefined,
      byteProgressState: bytes === undefined ? 'none' : this.probe.totalBytes === undefined ? 'unknown-total' : 'known-total',
      elapsedSeconds: Math.max(0, (now - this.startedAt) / 1000), resumeCount: 0,
      ...(this.probe.packageCount ? { currentStep: Math.min(this.packageCount, this.probe.packageCount), totalSteps: this.probe.packageCount, stepName: `第 ${this.packageCount}/${this.probe.packageCount} 个包` } : {}),
      ...(bytes === undefined ? {} : { downloadedBytes: bytes, totalBytes: this.probe.totalBytes, bytesPerSecond: now > this.lastAt ? Math.max(0, bytes - this.lastTotal) / ((now - this.lastAt) / 1000) : 0, fileCount: this.present.size }), reason: this.reason })
    this.lastAt = now; this.lastTotal = bytes ?? 0
  }
  private async readStage(path: string): Promise<string | undefined> {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => undefined)
    if (!handle) return
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.nlink !== 1 || info.mtimeMs < this.startedAt) return
      const buffer = Buffer.alloc(Math.min(8192, info.size))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, Math.max(0, info.size - buffer.length))
      return buffer.subarray(0, bytesRead).toString('utf8')
    } finally { await handle.close() }
  }
  async stop() { clearInterval(this.timer); await this.polling }
  /** Must only be called AFTER executeCliOperation confirms the managed range is empty. */
  async cleanup() {
    await this.stop()
    if (this.disabled) return
    await this.collect()
    for (const entry of this.owned.values()) {
      const info = await lstat(entry.path).catch(() => undefined)
      if (info?.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.ino === entry.stat.ino && info.dev === entry.stat.dev && info.mtimeMs >= this.startedAt) await removeUpdateTemporary(entry.path)
    }
    for (const entry of [...this.ownedDirs.values()].sort((a, b) => b.path.length - a.path.length)) {
      const info = await lstat(entry.path).catch(() => undefined)
      if (info?.isDirectory() && info.ino === entry.stat.ino && info.dev === entry.stat.dev) await rmdir(entry.path).catch(e => { if (!missing(e) && (e as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw e })
    }
    if (this.probe.privateTemp && this.probe.directory) {
      // Private TEMP is this run's own mkdtemp; once the managed range exited, whatever the CLI left
      // there (Qoder natives ~38 MB, Bun DLLs; 2026-11-14 Windows 实机) is ours to remove. A locked file keeps it.
      const info = await lstat(this.probe.directory).catch(() => undefined)
      if (info?.isDirectory() && !info.isSymbolicLink() && (!this.rootIdentity || info.ino === this.rootIdentity.ino && info.dev === this.rootIdentity.dev))
        await removeUpdateTemporary(this.probe.directory)
    }
  }
}

/** A stale PID is evidence; an unreadable/unknown lock is never permission to overwrite. */
export async function officialLockState(path?: string, commandPattern?: RegExp, readCommand?: (pid: number) => Promise<string>): Promise<'active' | 'stale' | 'unknown'> {
  if (!path) return 'unknown'
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => undefined)
  if (!handle) return 'unknown'
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.nlink !== 1 || info.size > 4096) return 'unknown'
    const buffer = Buffer.alloc(4096), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const value = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as { pid?: number }
    if (!Number.isSafeInteger(value.pid) || value.pid! <= 0) return 'unknown'
    try {
      process.kill(value.pid!, 0)
      if (commandPattern) {
        if (readCommand) return commandPattern.test(await readCommand(value.pid!)) ? 'active' : 'stale'
        const result = process.platform === 'win32'
          ? await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::Write((Get-CimInstance Win32_Process -Filter ("ProcessId=" + $env:CLIWORKER_LOCK_PID)).CommandLine)'], { timeout: 5000, maxBuffer: 65536, env: { ...process.env, CLIWORKER_LOCK_PID: String(value.pid) } })
          : await promisify(execFile)('/bin/ps', ['-p', String(value.pid), '-o', 'command='], { timeout: 5000, maxBuffer: 65536 })
        return commandPattern.test(result.stdout) ? 'active' : 'stale'
      }
      return 'active'
    }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'stale' : 'unknown' }
  } catch { return 'unknown' } finally { await handle.close() }
}
