import { cpus, type CpuInfo } from 'node:os'
export interface PreloadItem { run(signal: AbortSignal, background: boolean): Promise<void> }
export function cpuBusy(before: CpuInfo[], after: CpuInfo[]): number {
  if (!before.length || before.length !== after.length) return 1
  let idle = 0, total = 0
  for (let i = 0; i < before.length; i++) for (const key of ['user', 'nice', 'sys', 'idle', 'irq'] as const) {
    const delta = after[i]!.times[key] - before[i]!.times[key]
    if (delta < 0) return 1
    total += delta; if (key === 'idle') idle += delta
  }
  return total > 0 ? 1 - idle / total : 1
}
/** One pass per Host. All timers belong to one abortable loop; each item owns cleanup. */
export class CliPreloader {
  private lifetime = new AbortController()
  private startAt = Date.now() + 60_000
  private currentRun?: Promise<void>
  private current?: AbortController
  private wake?: () => void
  private active?: Promise<void>
  private foreground = false
  private resumeAt = 0
  private wasBusy = false
  private index = 0
  private completed = false
  private handedOff = false
  constructor(private options: { items: PreloadItem[]; idle(): boolean; enabled(): boolean; sample?: () => CpuInfo[]; activity?(running: boolean): void; error?(error: unknown): void }) {}
  start() { if (!this.active && !this.completed) this.active = this.loop().finally(() => { this.active = undefined }) }
  enqueue(items: PreloadItem[], after = this.options.items.length) {
    // Never insert ahead of the item that currently owns cleanup.
    this.options.items.splice(Math.max(after, this.index + (this.current ? 1 : 0)), 0, ...items)
    this.completed = false
    if (!this.active && !this.lifetime.signal.aborted) { this.handedOff = false; this.foreground = false; this.start() }
    this.wake?.()
  }
  promote() { this.foreground = true; this.wake?.() }
  /** Synchronous busy notification cancels immediately; the loop awaits run's cleanup before resuming. */
  changed() {
    const busy = !this.options.enabled() || !this.options.idle()
    if (busy || this.wasBusy) this.resumeAt = Date.now() + 30_000
    this.wasBusy = busy
    if (busy && !this.foreground) this.current?.abort()
    this.wake?.()
  }
  private wait(ms: number) {
    if (this.lifetime.signal.aborted) return Promise.resolve()
    return new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); this.lifetime.signal.removeEventListener('abort', finish); if (this.wake === finish) this.wake = undefined; resolve() }
      const timer = setTimeout(finish, ms); timer.unref?.(); this.wake = finish; this.lifetime.signal.addEventListener('abort', finish, { once: true })
    })
  }
  private async loop() {
    const startAt = this.startAt
    while (!this.lifetime.signal.aborted && !this.handedOff && Date.now() < startAt) await this.wait(startAt - Date.now())
    while (!this.lifetime.signal.aborted && this.index < this.options.items.length && !this.handedOff) {
      if (!this.foreground) {
        if (!this.options.enabled() || !this.options.idle()) { this.resumeAt = Date.now() + 30_000; await this.wait(30_000); continue }
        if (Date.now() < this.resumeAt) { await this.wait(this.resumeAt - Date.now()); continue }
        const sampledAt = Date.now(), before = (this.options.sample ?? cpus)(); await this.wait(2000)
        if (this.lifetime.signal.aborted || this.handedOff) break
        // A runtime notification may wake the timer early; never accept a shorter CPU sample.
        if (!this.foreground && Date.now() - sampledAt < 2000) continue
        if (!this.foreground && (!this.options.idle() || !this.options.enabled() || cpuBusy(before, (this.options.sample ?? cpus)()) >= 0.5)) { this.resumeAt = Date.now() + 30_000; await this.wait(30_000); continue }
      }
      if (this.handedOff) break
      this.current = new AbortController()
      const signal = AbortSignal.any([this.current.signal, this.lifetime.signal])
      this.options.activity?.(true)
      try { this.currentRun = this.options.items[this.index]!.run(signal, !this.foreground); await this.currentRun; if (!signal.aborted) this.index++ }
      catch (error) { if (!signal.aborted) { this.options.error?.(error); this.index++ } }
      finally { this.currentRun = undefined; this.current = undefined; this.options.activity?.(false) }
      if (!this.foreground && !this.lifetime.signal.aborted) await this.wait(2000)
    }
    this.completed = this.index === this.options.items.length
  }
  /** Page checking takes over separately, after the current item exits, and shares its cached results. */
  async handoff(): Promise<void> { this.handedOff = true; this.foreground = true; this.wake?.(); await this.active }
  async pause(): Promise<void> { this.changed(); this.current?.abort(); await this.currentRun?.catch(() => undefined) }
  async stop(): Promise<void> { this.lifetime.abort(); this.current?.abort(); this.wake?.(); await this.active }
  async close(): Promise<void> { await this.stop() }
}
