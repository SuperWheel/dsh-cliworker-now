import { randomUUID } from 'node:crypto'
import type { AccountFrame, AccountGuide, AccountStatus } from '../shared/accounts.ts'
import type { ModelChoice } from '../shared/types.ts'
import type { WorkBuddyCliId } from './workbuddy-variant.ts'
import { ProcessCleanupUnconfirmedError } from './process.ts'

export const desktopActions = () => [{ id: 'manage' as const, target: 'desktop' as const,
  label: '在桌面端管理', description: '登录、退出或切换请在桌面端完成。' }]

/** No native missing-auth receipt has been verified. Generic 401/403/-32000
 * and CLI_OWN_ACCOUNT_REQUIRED are deliberately NOT proof of signing out. */
export function workbuddyDesktopFailure(cli: WorkBuddyCliId, error: unknown): AccountStatus {
  const auth = (error as { code?: unknown })?.code === 'CLI_OWN_ACCOUNT_REQUIRED'
  return { cli, installed: true, state: auth ? 'unknown' : 'unavailable',
    summary: auth ? '请在桌面端检查登录状态。' : 'WorkBuddy 暂不可用', actions: desktopActions() }
}

export interface DesktopSnapshot { account: AccountStatus; models?: ModelChoice[] }
interface Session {
  id: string; parent: string; cli: WorkBuddyCliId; project: string
  controller: AbortController; authorize: () => void; sequence: number; frame: AccountFrame
  changed: Set<() => void>; inFlight?: Promise<void>; opening?: Promise<void>; stopping?: Promise<void>
  manualRefresh?: boolean; snapshot?: DesktopSnapshot; baseline?: AccountStatus['state']; fingerprint?: string
  deadline: number; queries: number; observing: boolean; closed: boolean; unsafe: boolean
  cycle?: AbortController; budgetTimer?: ReturnType<typeof setTimeout>; timer?: ReturnType<typeof setTimeout>; expiry?: ReturnType<typeof setTimeout>; attach?: ReturnType<typeof setTimeout>
}
interface Dependencies {
  reserve: (cli: WorkBuddyCliId) => void
  /** Wait (never abort) until this CLI's in-flight account status read settles. */
  settle?: (cli: WorkBuddyCliId, signal: AbortSignal) => Promise<void>
  release: (cli: WorkBuddyCliId) => void
  verify: (cli: WorkBuddyCliId, signal: AbortSignal) => Promise<string>
  read: (cli: WorkBuddyCliId, path: string, project: string, signal: AbortSignal) => Promise<DesktopSnapshot>
  open: (cli: WorkBuddyCliId, path: string, signal: AbortSignal) => Promise<void>
  quarantine: (cli: WorkBuddyCliId, error: ProcessCleanupUnconfirmedError) => void
  invalidate?: (cli: WorkBuddyCliId) => void
}
const INTERVAL = 15_000, BUDGET = 300_000, QUERIES = 20

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(signal.reason)
    signal.addEventListener('abort', cancel, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel))
  })
}

/** A separate no-PTY lifetime. Frames contain fixed guides and safe account projection only. */
export class WorkBuddyDesktopAccounts {
  private sessions = new Map<string, Session>()
  private closed = false
  constructor(private deps: Dependencies) {}

  current(cli: WorkBuddyCliId): AccountStatus | undefined {
    return [...this.sessions.values()].find(s => s.cli === cli && !s.closed)?.snapshot?.account
  }
  private emit(s: Session, frame: Omit<AccountFrame, 'seq'>) {
    s.frame = { seq: ++s.sequence, ...frame }
    for (const wake of s.changed) wake()
  }
  private guide(s: Session, text: string, template: AccountGuide['template'] = 'choice', tone: AccountGuide['tone'] = 'info') {
    this.emit(s, { status: 'running', guide: { step: 'desktop', template, tone, text,
      plan: ['在桌面端管理账号', '确认当前登录状态'], stage: s.observing ? 1 : 0 },
      desktop: { account: s.snapshot?.account, observing: s.observing } })
  }
  private owned(parent: string, id: string) {
    const s = this.sessions.get(id)
    if (!s || s.parent !== parent) throw new Error('账号操作不属于此主会话')
    return s
  }
  async start(parent: string, cli: WorkBuddyCliId, project: string, signal: AbortSignal, authorize: () => void) {
    if (this.closed) throw new Error('插件正在关闭')
    signal.throwIfAborted(); authorize()
    // Reopening right after closing: the previous window may still be stopping its
    // query, and closing it triggers a settings account re-read of this CLI. Both
    // used to make reserve() reject the second open. Wait for them, bounded by the
    // caller's start lifetime, instead of failing.
    const closing = [...this.sessions.values()].filter(x => x.cli === cli && x.stopping && !x.closed && !x.unsafe)
    if (closing.length) await abortable(Promise.allSettled(closing.map(x => x.stopping)), signal)
    if (this.deps.settle) await abortable(this.deps.settle(cli, signal), signal)
    if (this.closed) throw new Error('插件正在关闭')
    signal.throwIfAborted(); authorize(); this.deps.reserve(cli)
    const s: Session = { id: randomUUID(), parent, cli, project, controller: new AbortController(), authorize,
      sequence: 0, frame: { seq: 0 }, changed: new Set(), deadline: 0, queries: 0, observing: false, closed: false, unsafe: false }
    this.sessions.set(s.id, s)
    const abort = () => { void this.stop(parent, s.id).catch(() => undefined) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      await this.query(s, false)
      signal.throwIfAborted(); s.controller.signal.throwIfAborted()
      // A lost start response cannot keep the CLI locked forever.
      s.attach = setTimeout(abort, 30_000); s.attach.unref?.()
      return { id: s.id, frame: s.frame }
    } catch (error) {
      await this.stop(parent, s.id)
      throw error
    } finally { signal.removeEventListener('abort', abort) }
  }
  async respond(parent: string, id: string, action: string) {
    const s = this.owned(parent, id)
    if (!['open', 'refresh', 'continue'].includes(action)) throw new Error('无效的账号窗口操作')
    if (s.closed || s.controller.signal.aborted) throw new Error('账号窗口已关闭')
    try { s.authorize() } catch (error) { await this.stop(parent, id); throw error }
    if (action === 'refresh') return this.query(s, true)
    if (s.opening) return s.opening
    const operation = (async () => {
      try {
        const path = await this.deps.verify(s.cli, s.controller.signal)
        s.controller.signal.throwIfAborted(); s.authorize()
        if (action === 'open') await this.deps.open(s.cli, path, s.controller.signal)
        s.controller.signal.throwIfAborted()
        if (s.inFlight) await s.inFlight
        s.controller.signal.throwIfAborted(); s.authorize()
        // Repeated opens while observing do not silently reset the budget.
        if (!s.observing) {
          s.deadline = Date.now() + BUDGET; s.queries = 0; s.observing = true
          clearTimeout(s.budgetTimer)
          s.budgetTimer = setTimeout(() => {
            s.observing = false; s.cycle?.abort()
            if (!s.inFlight) this.guide(s, '观察已暂停，可刷新状态或继续观察。')
          }, BUDGET)
          s.budgetTimer.unref?.()
        }
        if (!s.controller.signal.aborted) {
          // An instruction, not a running read: no spinner (the footer says it is watching).
          this.guide(s, '登录、退出或切换请在桌面端完成。')
          this.schedule(s)
        }
      } catch (error) {
        if (error instanceof ProcessCleanupUnconfirmedError) {
          s.unsafe = true; s.observing = false; s.controller.abort()
          clearTimeout(s.timer); clearTimeout(s.budgetTimer)
          this.deps.quarantine(s.cli, error); this.deps.release(s.cli)
          this.emit(s, { status: 'failed', cleanupConfirmed: false,
            guide: { step: 'desktop', template: 'result', tone: 'warning', text: '账号查询未能确认进程已退出，已暂停此 CLI' } })
        } else if (!s.controller.signal.aborted) {
          s.observing = false; clearTimeout(s.timer); clearTimeout(s.budgetTimer)
          this.guide(s, action === 'open' ? '无法打开桌面端，请手动打开对应版本后刷新，或重试。' : 'WorkBuddy 暂不可用', 'choice', 'warning')
        }
      }
    })()
    s.opening = operation
    try { await operation } finally { if (s.opening === operation) s.opening = undefined }
  }
  private schedule(s: Session) {
    clearTimeout(s.timer)
    if (!s.observing || s.controller.signal.aborted) return
    if (s.queries >= QUERIES || Date.now() >= s.deadline) {
      s.observing = false; this.guide(s, '观察已暂停，可刷新状态或继续观察。'); return
    }
    s.timer = setTimeout(() => {
      if (Date.now() >= s.deadline) { s.observing = false; this.guide(s, '观察已暂停，可刷新状态或继续观察。'); return }
      s.queries++
      void this.query(s, false)
    }, Math.min(INTERVAL, s.deadline - Date.now()))
    s.timer.unref?.()
  }
  private query(s: Session, manual: boolean): Promise<void> {
    // Manual refresh shares the exact running cycle, including its invalidation.
    if (s.inFlight) { s.manualRefresh ||= manual; return s.inFlight }
    s.manualRefresh = manual
    clearTimeout(s.timer)
    const operation = Promise.resolve().then(async () => {
      const timeout = s.cycle = new AbortController()
      const timer = setTimeout(() => timeout.abort(), 25_000)
      timer.unref?.()
      const control = AbortSignal.any([s.controller.signal, timeout.signal])
      try {
        control.throwIfAborted(); s.authorize()
        this.guide(s, '正在确认当前登录状态…', 'waiting')
        const path = await this.deps.verify(s.cli, control)
        control.throwIfAborted(); s.authorize()
        const snapshot = await this.deps.read(s.cli, path, s.project, control)
        control.throwIfAborted(); s.authorize()
        const state = snapshot.account.state
        const changed = s.baseline !== undefined && state !== s.baseline
        s.snapshot = snapshot
        const fingerprint = JSON.stringify([state, snapshot.account.summary, snapshot.models])
        if (s.manualRefresh || (s.fingerprint !== undefined && s.fingerprint !== fingerprint)) this.deps.invalidate?.(s.cli)
        s.fingerprint = fingerprint
        const confirmed = changed && ((s.baseline === 'unconfigured' && state === 'authenticated') ||
          (s.baseline === 'authenticated' && state === 'unconfigured'))
        if (state === 'authenticated' || state === 'unconfigured') s.baseline = state
        if (confirmed) { s.observing = false; clearTimeout(s.budgetTimer) }
        // A finished read is shown as its result, never as a spinner: watching for a desktop
        // change is told by the window's footer, not by the account line (2026-11-08).
        this.guide(s, snapshot.account.summary, confirmed ? 'result' : 'choice',
          state === 'authenticated' ? 'success' : state === 'unavailable' ? 'warning' : 'info')
      } catch (error) {
        if (error instanceof ProcessCleanupUnconfirmedError) {
          s.unsafe = true; s.observing = false; s.controller.abort(); this.deps.quarantine(s.cli, error); this.deps.release(s.cli)
          this.emit(s, { status: 'failed', cleanupConfirmed: false,
            guide: { step: 'desktop', template: 'result', tone: 'warning', text: '账号查询未能确认进程已退出，已暂停此 CLI' } })
        } else if (!s.controller.signal.aborted) {
          s.observing = false
          // Permission/installation failure: stop future automatic work, keep retry/close available.
          s.snapshot = { account: workbuddyDesktopFailure(s.cli, error) }
          if (s.manualRefresh || s.fingerprint !== undefined) this.deps.invalidate?.(s.cli)
          this.guide(s, s.deadline && Date.now() >= s.deadline ? '观察已暂停，可刷新状态或继续观察。' : s.snapshot.account.summary, 'choice', 'warning')
        }
      } finally {
        clearTimeout(timer)
        s.cycle = undefined
        if (!s.observing) clearTimeout(s.budgetTimer)
        s.inFlight = undefined
        this.schedule(s)
      }
    })
    s.inFlight = operation
    return operation
  }
  async *watch(parent: string, id: string, signal: AbortSignal): AsyncIterable<AccountFrame> {
    const s = this.owned(parent, id)
    clearTimeout(s.attach)
    let seq = -1
    try {
      while (!signal.aborted) {
        if (s.frame.seq > seq) { seq = s.frame.seq; yield s.frame }
        if (s.closed || s.unsafe) { if (s.frame.seq > seq) continue; return }
        await new Promise<void>(resolve => {
          const wake = () => { s.changed.delete(wake); signal.removeEventListener('abort', wake); resolve() }
          s.changed.add(wake); signal.addEventListener('abort', wake, { once: true })
          if (signal.aborted || s.frame.seq > seq) wake()
        })
      }
    } finally {
      if (this.sessions.get(id) === s) await this.stop(parent, id)
      else await s.stopping
    }
  }
  stop(parent: string, id: string): Promise<void> {
    const s = this.owned(parent, id)
    if (s.stopping) return s.stopping
    s.controller.abort(); s.observing = false; clearTimeout(s.timer); clearTimeout(s.budgetTimer); clearTimeout(s.attach)
    s.stopping = (async () => {
      await Promise.allSettled([s.inFlight, s.opening])
      if (s.unsafe) throw new Error('账号查询未能确认进程已退出，已暂停此 CLI')
      if (!s.closed) {
        s.closed = true; this.deps.release(s.cli)
        this.emit(s, { status: 'closed', cleanupConfirmed: true })
        s.expiry = setTimeout(() => this.sessions.delete(id), 60_000); s.expiry.unref?.()
      }
    })()
    return s.stopping
  }
  recover(cli: WorkBuddyCliId) {
    for (const s of this.sessions.values()) if (s.cli === cli && s.unsafe && !s.inFlight && !s.opening) {
      clearTimeout(s.attach); clearTimeout(s.expiry); this.deps.release(cli); this.sessions.delete(s.id)
    }
  }
  async closeParent(parent: string) {
    const owned = [...this.sessions.values()].filter(s => s.parent === parent)
    const results = await Promise.allSettled(owned.map(s => this.stop(parent, s.id)))
    for (const s of owned) if (!s.unsafe) { clearTimeout(s.expiry); this.sessions.delete(s.id) }
    if (results.some(r => r.status === 'rejected')) throw new Error('账号查询未能确认进程已退出，已暂停此 CLI')
  }
  async close() {
    this.closed = true
    const results = await Promise.allSettled([...new Set([...this.sessions.values()].map(s => s.parent))].map(p => this.closeParent(p)))
    if (results.some(r => r.status === 'rejected')) throw new Error('账号查询未能确认进程已退出，已暂停此 CLI')
  }
}
