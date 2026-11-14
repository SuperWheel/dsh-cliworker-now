import { lstat, readdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { CliDownloadProgress } from '../../shared/cli-management.ts'
import type { ProcessBackend, RuntimeConfig } from '../process.ts'
import { ProcessCleanupUnconfirmedError } from '../process.ts'
import { safeObservation } from './artifacts/observations.ts'
import { prepareDownloads } from './download.ts'
import { executeCliOperation, redactOutput } from './executor.ts'
import { CliOperationError } from './planner.ts'
export const HERMES_STEPS = ['plan', 'snapshot', 'apply', 'deps', 'build', 'restart'] as const
export class HermesWatch {
  readonly controller = new AbortController()
  private stamps = new Map<string, string>()
  private packs = new Set<string>()
  private lastActivity: number
  private lease: number
  private step?: number
  private stage = '执行 Hermes 官方更新'
  stopClass?: string
  exitCode?: number
  constructor(readonly home: string, readonly checkout: string, readonly status: string, readonly startedAt: number, readonly progress: (p: CliDownloadProgress) => void) { this.lastActivity = startedAt; this.lease = startedAt + 20 * 60_000 }
  async snapshot() { for (const name of await readdir(join(this.checkout, '.git/objects/pack')).catch(() => [])) if (name.startsWith('tmp_pack_')) this.packs.add(name) }
  async poll(now = Date.now()) {
    let active = false
    const observe = async (path: string, tail = false) => {
      const value = await safeObservation(path, 65536, tail)
      if (!value || value.mtimeMs < this.startedAt) return
      if (this.stamps.get(path) !== value.stamp) { active = true; this.stamps.set(path, value.stamp) }
      return value.text
    }
    const log = await observe(join(this.home, 'logs/update.log'), true)
    if (log) { const line = log.split(/[\r\n]+/).filter(l => /^[→✓✗⚠]/.test(l.trim())).at(-1); if (line) this.stage = redactOutput(line).slice(0, 2048) }
    const receipts = join(this.home, 'logs/update_receipts')
    const receiptDir = await lstat(receipts).catch(() => undefined)
    const names = receiptDir?.isDirectory() && !receiptDir.isSymbolicLink() ? (await readdir(receipts)).filter(n => /^(?:latest|update_[A-Za-z0-9_.-]+)\.json$/.test(n)).slice(-256) : []
    let latest: { at: number; value: Record<string, any> } | undefined
    for (const name of names) {
      const text = await observe(join(receipts, name)); if (!text) continue
      try { const value = JSON.parse(text); const stamp = (await lstat(join(receipts, name))).mtimeMs; if (!latest || stamp >= latest.at) latest = { at: stamp, value } } catch { /* incomplete receipt: wait for atomic replacement */ }
    }
    if (latest) {
      const r = latest.value, stages = Array.isArray(r.stages) ? r.stages : []
      const last = stages.filter((s: any) => HERMES_STEPS.includes(s?.name)).at(-1)
      if (last) this.step = HERMES_STEPS.indexOf(last.name) + 1
      if (typeof r.stop_class === 'string' && /^[a-z][a-z0-9_]{0,100}$/.test(r.stop_class)) this.stopClass = r.stop_class
      if (Number.isInteger(r.exit_code)) this.exitCode = r.exit_code
    }
    const status = await observe(this.status)
    if (status) { try { const value = JSON.parse(status); if (typeof value.message === 'string') this.stage = redactOutput(value.message).slice(0, 2048) } catch { /* atomic writer may not have published yet */ } }
    let bytes = 0, observed = false
    const packDir = join(this.checkout, '.git/objects/pack'), info = await lstat(packDir).catch(() => undefined)
    if (info?.isDirectory() && !info.isSymbolicLink()) for (const name of (await readdir(packDir)).slice(0, 4096)) {
      if (!/^tmp_pack_[A-Za-z0-9]+$/.test(name) || this.packs.has(name)) continue
      const path = join(packDir, name), s = await lstat(path).catch(() => undefined)
      if (s?.isFile() && !s.isSymbolicLink() && s.nlink === 1 && s.mtimeMs >= this.startedAt) { observed = true; bytes += s.size }
    }
    if (active) { this.lastActivity = now; this.lease = now + 20 * 60_000 }
    if (now - this.lastActivity >= 5 * 60_000 || now >= this.lease) this.controller.abort(new CliOperationError('INSTALL_TIMEOUT', 'Hermes 日志和回执连续 5 分钟没有活动'))
    this.progress({ channel: 'official', readable: observed, byteProgress: observed, byteProgressState: observed ? 'unknown-total' : 'none', ...(observed ? { downloadedBytes: bytes } : {}), elapsedSeconds: Math.max(0, (now - this.startedAt) / 1000), resumeCount: 0, stage: this.stage,
      ...(this.step ? { currentStep: this.step, totalSteps: 6, stepName: HERMES_STEPS[this.step - 1]! } : {}) })
  }
}
export async function runHermesUpdate(o: { root: string; home: string; checkout: string; argv: string[]; backend: ProcessBackend; config: RuntimeConfig; signal: AbortSignal; output(s: string): void; progress(p: CliDownloadProgress): void }) {
  const privateDir = await mkdtemp(join(await prepareDownloads(o.root), 'local-'))
  let quarantine = false
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const watch = new HermesWatch(o.home, o.checkout, join(privateDir, `status-${attempt}.json`), Date.now(), p => o.progress({ ...p, retryCount: attempt }))
      await watch.snapshot(); let polling = Promise.resolve()
      const timer = setInterval(() => { polling = polling.then(() => watch.poll()).catch(() => undefined) }, 1000)
      let failure: unknown
      try {
        await executeCliOperation(o.backend, o.config, o.argv, AbortSignal.any([o.signal, watch.controller.signal]), o.output, 2147483647, { HERMES_UPDATE_STATUS_FILE: watch.status })
      } catch (error) { failure = error; if (error instanceof ProcessCleanupUnconfirmedError) { quarantine = true; throw error } }
      finally { clearInterval(timer); await polling; await watch.poll().catch(() => undefined) }
      o.signal.throwIfAborted()
      if (!failure) return
      if (watch.stopClass) o.output(`Hermes 更新失败：${watch.stopClass}\n`)
      if (watch.exitCode === 2 || failure instanceof CliOperationError && /退出码 2(?:\D|$)/.test(failure.message) || attempt === 1) throw failure
      o.output('Hermes 官方更新失败，读取回执后自动重跑一次；由官方恢复残留。\n')
    }
  } finally { if (!quarantine) await rm(privateDir, { recursive: true, force: true }) }
}
