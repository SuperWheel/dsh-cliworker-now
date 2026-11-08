import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkBuddyDesktopAccounts, workbuddyDesktopFailure, type DesktopSnapshot } from '../src/host/workbuddy-desktop.ts'
import { ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
import type { WorkBuddyCliId } from '../src/host/workbuddy-variant.ts'

// All metadata, accounts, clocks and GUI launches in this file are SIMULATED.
const snapshot = (state: 'authenticated' | 'unconfigured' | 'unknown' = 'authenticated'): DesktopSnapshot => ({
  account: { cli: 'workbuddycn', installed: true, state, summary: state === 'authenticated' ? '已登录（www.workbuddy.cn）' : state === 'unconfigured' ? '当前未登录' : '请在桌面端检查登录状态。', actions: [] },
  models: [{ id: 'SIMULATED/model', label: 'SIMULATED model', efforts: ['default'] }],
})
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function fixture() {
  vi.useFakeTimers()
  const held = new Set<string>()
  const deps = {
    reserve: vi.fn((cli: WorkBuddyCliId) => { if (held.has(cli)) throw new Error('SIMULATED busy'); held.add(cli) }),
    release: vi.fn((cli: WorkBuddyCliId) => { held.delete(cli) }),
    verify: vi.fn(async () => '/SIMULATED/WorkBuddy.app/Contents/MacOS/Electron'),
    read: vi.fn(async (_cli: WorkBuddyCliId, _path: string, _project: string, _signal: AbortSignal) => snapshot()),
    open: vi.fn(async () => {}), quarantine: vi.fn(), invalidate: vi.fn(),
  }
  const manager = new WorkBuddyDesktopAccounts(deps)
  const authorize = vi.fn()
  const start = async (cli: WorkBuddyCliId = 'workbuddycn', signal = new AbortController().signal) => {
    const started = await manager.start('SIMULATED/parent', cli, '/SIMULATED/project', signal, authorize)
    const watch = manager.watch('SIMULATED/parent', started.id, new AbortController().signal)
    await watch.next() // Attach; no reconnect/poll creates another query.
    return { ...started, watch }
  }
  return { manager, deps, start, held, authorize }
}
afterEach(() => { vi.useRealTimers() })
describe('模拟 WorkBuddy desktop observation lifetime', () => {
  it('reads once on open, owns the parent, excludes the same CLI and allows the other edition', async () => {
    const f = fixture(), s = await f.start()
    expect(f.deps.read).toHaveBeenCalledTimes(1)
    expect(f.deps.open).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(f.deps.read).toHaveBeenCalledTimes(1)
    await expect(f.start()).rejects.toThrow('busy')
    await f.start('workbuddy')
    await expect(f.manager.respond('OTHER', s.id, 'open')).rejects.toThrow('不属于')
    expect(() => f.manager.stop('OTHER', s.id)).toThrow('不属于')
    await expect(f.manager.watch('OTHER', s.id, new AbortController().signal).next()).rejects.toThrow('不属于')
    await expect(f.manager.respond('SIMULATED/parent', s.id, '/arbitrary/path')).rejects.toThrow('无效')
    await f.manager.close()
    expect(f.held.size).toBe(0)
  })
  it('polls at least 15 seconds after completion, merges manual refresh and invalidates once', async () => {
    const f = fixture(), s = await f.start(), pending = deferred<DesktopSnapshot>()
    await f.manager.respond('SIMULATED/parent', s.id, 'open')
    expect(f.deps.open).toHaveBeenCalledOnce()
    f.deps.read.mockReturnValueOnce(pending.promise)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(f.deps.read).toHaveBeenCalledTimes(2)
    const refresh = f.manager.respond('SIMULATED/parent', s.id, 'refresh')
    const another = f.manager.respond('SIMULATED/parent', s.id, 'refresh')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(f.deps.read).toHaveBeenCalledTimes(2)
    pending.resolve(snapshot()); await refresh; await another
    expect(f.deps.invalidate).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(14_999)
    expect(f.deps.read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(f.deps.read).toHaveBeenCalledTimes(3)
    const frame = (await s.watch.next()).value!
    expect(frame.guide?.text).toBe('已登录（www.workbuddy.cn）')
    expect(frame.guide?.template).toBe('waiting') // Same site is never a switch success.
    expect(frame.data).toBeUndefined()
    await f.manager.close()
  })
  it('stops at five minutes, does at most 20 automatic queries; refresh does not restart and continue is explicit', async () => {
    const f = fixture(), s = await f.start()
    await f.manager.respond('SIMULATED/parent', s.id, 'continue')
    await vi.advanceTimersByTimeAsync(300_000)
    const count = f.deps.read.mock.calls.length
    expect(count).toBeLessThanOrEqual(21)
    expect(count).toBeGreaterThan(1)
    expect((await s.watch.next()).value?.desktop?.observing).toBe(false)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(f.deps.read).toHaveBeenCalledTimes(count)
    await f.manager.respond('SIMULATED/parent', s.id, 'refresh')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(f.deps.read).toHaveBeenCalledTimes(count + 1)
    await f.manager.respond('SIMULATED/parent', s.id, 'continue')
    await vi.advanceTimersByTimeAsync(15_000)
    expect(f.deps.read).toHaveBeenCalledTimes(count + 2)
    await f.manager.close()
  })
  it('the five-minute budget aborts an in-flight final query, with no late login claim', async () => {
    const f = fixture(), s = await f.start(), pending = deferred<DesktopSnapshot>()
    await f.manager.respond('SIMULATED/parent', s.id, 'continue')
    await vi.advanceTimersByTimeAsync(270_000)
    let signal!: AbortSignal
    f.deps.read.mockImplementationOnce(async (_c, _p, _d, control) => { signal = control; return pending.promise })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(signal.aborted).toBe(true)
    pending.resolve(snapshot()); await vi.advanceTimersByTimeAsync(0)
    expect((await s.watch.next()).value?.guide?.text).toContain('观察已暂停')
    const count = f.deps.read.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.deps.read).toHaveBeenCalledTimes(count)
    await f.manager.close()
  })
  it('reverifies every action and rejects a replaced installation without opening it', async () => {
    const f = fixture(), s = await f.start()
    f.deps.verify.mockRejectedValue(new Error('SIMULATED wrong edition SECRET_KEY'))
    for (const action of ['open', 'continue', 'refresh']) await f.manager.respond('SIMULATED/parent', s.id, action)
    expect(f.deps.verify).toHaveBeenCalledTimes(4)
    expect(f.deps.open).not.toHaveBeenCalled()
    expect(f.deps.read).toHaveBeenCalledTimes(1)
    expect(JSON.stringify((await s.watch.next()).value)).not.toContain('SECRET_KEY')
    await f.manager.close()
  })
  it('shows manual instructions and retry after opener failure', async () => {
    const f = fixture(), s = await f.start()
    f.deps.open.mockRejectedValueOnce(new Error('SIMULATED secret launch failure'))
    await f.manager.respond('SIMULATED/parent', s.id, 'open')
    const frame = (await s.watch.next()).value!
    expect(frame.guide?.text).toContain('手动打开对应版本')
    expect(frame.desktop?.observing).toBe(false)
    expect(JSON.stringify(frame)).not.toContain('secret')
    await f.manager.respond('SIMULATED/parent', s.id, 'open')
    expect(f.deps.open).toHaveBeenCalledTimes(2)
    await f.manager.close()
  })
  it.each([['unconfigured', 'authenticated'], ['authenticated', 'unconfigured']] as const)(
    'only confirmed %s -> %s ends observation (simulated explicit evidence)', async (before, after) => {
      const f = fixture(); f.deps.read.mockResolvedValueOnce(snapshot(before))
      const s = await f.start()
      f.deps.read.mockResolvedValue(snapshot(after))
      await f.manager.respond('SIMULATED/parent', s.id, 'continue')
      await vi.advanceTimersByTimeAsync(15_000)
      const frame = (await s.watch.next()).value!
      expect(frame.guide?.template).toBe('result'); expect(frame.desktop?.observing).toBe(false)
      await vi.advanceTimersByTimeAsync(60_000); expect(f.deps.read).toHaveBeenCalledTimes(2)
      await f.manager.close()
    })
  it.each(['CLI_OWN_ACCOUNT_REQUIRED', '-32000', '401', '403', 'NETWORK_ERROR', 'WORKBUDDY_UNAVAILABLE'])(
    'does not turn generic %s into logout or leak native text', code => {
      const account = workbuddyDesktopFailure('workbuddycn', Object.assign(new Error('SIMULATED KEY_MATERIAL'), { code }))
      expect(account.state).not.toBe('unconfigured')
      expect(account.state).not.toBe('unauthenticated')
      expect(JSON.stringify(account)).not.toContain('KEY_MATERIAL')
    })
  it('losing execution permission prevents further opening or automatic reads', async () => {
    const f = fixture(), s = await f.start()
    await f.manager.respond('SIMULATED/parent', s.id, 'continue')
    f.authorize.mockImplementation(() => { throw new Error('SIMULATED permission revoked') })
    await vi.advanceTimersByTimeAsync(15_000)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.deps.read).toHaveBeenCalledTimes(1)
    await expect(f.manager.respond('SIMULATED/parent', s.id, 'open')).rejects.toThrow('revoked')
    expect(f.deps.open).not.toHaveBeenCalled()
    expect(f.held.size).toBe(0)
    await f.manager.close()
  })
  it('cancels a running query and waits for its cleanup before releasing ownership', async () => {
    const f = fixture(), s = await f.start(), pending = deferred<DesktopSnapshot>()
    let signal!: AbortSignal
    f.deps.read.mockImplementationOnce(async (_c, _p, _d, control) => { signal = control; return pending.promise })
    const reading = f.manager.respond('SIMULATED/parent', s.id, 'refresh')
    await vi.advanceTimersByTimeAsync(0)
    const stopped = f.manager.stop('SIMULATED/parent', s.id)
    expect(signal.aborted).toBe(true); expect(f.held.size).toBe(1)
    pending.resolve(snapshot()); await stopped; await reading
    expect(f.held.size).toBe(0)
    expect((await s.watch.next()).value).toMatchObject({ status: 'closed', cleanupConfirmed: true })
    expect(f.deps.open).not.toHaveBeenCalled() // There is no GUI terminate dependency.
    await f.manager.close()
  })
  it('a reopen right after closing waits for the previous window to finish stopping instead of failing', async () => {
    const f = fixture(), s = await f.start(), pending = deferred<DesktopSnapshot>()
    f.deps.read.mockImplementationOnce(async () => pending.promise)
    const reading = f.manager.respond('SIMULATED/parent', s.id, 'refresh')
    await vi.advanceTimersByTimeAsync(0)
    const stopped = f.manager.stop('SIMULATED/parent', s.id)
    let reopened: Awaited<ReturnType<typeof f.start>> | undefined
    const reopening = f.start().then(value => { reopened = value })
    await vi.advanceTimersByTimeAsync(0)
    expect(reopened).toBeUndefined(); expect(f.deps.reserve).toHaveBeenCalledTimes(1) // Not rejected as busy.
    pending.resolve(snapshot()); await stopped; await reading; await reopening
    expect(reopened?.id).not.toBe(s.id)
    expect(f.held.has('workbuddycn')).toBe(true)
    await f.manager.close()
    expect(f.held.size).toBe(0)
  })
  it('waits for an in-flight account status read of the same CLI before reserving it', async () => {
    const f = fixture(), status = deferred<void>()
    const settle = vi.fn(async (_cli: WorkBuddyCliId, _signal: AbortSignal) => status.promise)
    const manager = new WorkBuddyDesktopAccounts({ ...f.deps, settle })
    let started = false
    const starting = manager.start('SIMULATED/parent', 'workbuddycn', '/SIMULATED/project', new AbortController().signal, f.authorize)
      .then(value => { started = true; return value })
    await vi.advanceTimersByTimeAsync(0)
    expect(settle).toHaveBeenCalledWith('workbuddycn', expect.any(AbortSignal))
    expect(f.deps.reserve).not.toHaveBeenCalled(); expect(started).toBe(false)
    status.resolve(); await starting
    expect(f.deps.reserve).toHaveBeenCalledOnce()
    const aborted = new AbortController(), never = vi.fn(async () => new Promise<void>(() => {}))
    const blocked = new WorkBuddyDesktopAccounts({ ...f.deps, settle: never })
    const late = blocked.start('SIMULATED/parent', 'workbuddy', '/SIMULATED/project', aborted.signal, f.authorize)
    aborted.abort(new Error('SIMULATED start lifetime ended'))
    await expect(late).rejects.toThrow('SIMULATED start lifetime ended')
    expect(f.held.has('workbuddy')).toBe(false)
    await manager.close(); await blocked.close()
  })
  it('aborts the whole cycle at 25 seconds and does not release before the read settles', async () => {
    const f = fixture(), pending = deferred<DesktopSnapshot>(); let signal!: AbortSignal
    f.deps.read.mockImplementationOnce(async (_c, _p, _d, control) => { signal = control; return pending.promise })
    const starting = f.start()
    await vi.advanceTimersByTimeAsync(25_000)
    expect(signal.aborted).toBe(true); expect(f.held.size).toBe(1)
    pending.resolve(snapshot()); await starting
    await f.manager.close()
  })
  it('holds a cleanup failure, rejects stop and allows explicit quarantine recovery only after settlement', async () => {
    const f = fixture(), s = await f.start()
    f.deps.read.mockRejectedValueOnce(new ProcessCleanupUnconfirmedError())
    await f.manager.respond('SIMULATED/parent', s.id, 'refresh')
    expect(f.deps.quarantine).toHaveBeenCalledOnce()
    expect((await s.watch.next()).value).toMatchObject({ status: 'failed', cleanupConfirmed: false })
    await expect(f.manager.stop('SIMULATED/parent', s.id)).rejects.toThrow('未能确认')
    await expect(f.manager.close()).rejects.toThrow('未能确认')
    f.manager.recover('workbuddycn')
    await f.manager.close()
  })
  it('watch cancellation closes the owned observation and ends automatic queries', async () => {
    const f = fixture(), s = await f.start(), signal = new AbortController()
    const watch = f.manager.watch('SIMULATED/parent', s.id, signal.signal)
    await watch.next()
    const waiting = watch.next()
    signal.abort()
    expect(await waiting).toMatchObject({ done: true })
    expect(f.held.size).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.deps.read).toHaveBeenCalledTimes(1)
    await f.manager.close()
  })
  it('cleans parent shutdown, startup abort and a lost start response', async () => {
    const f = fixture(), pending = deferred<DesktopSnapshot>(), control = new AbortController()
    f.deps.read.mockReturnValueOnce(pending.promise)
    const starting = f.start('workbuddycn', control.signal)
    await vi.advanceTimersByTimeAsync(0)
    const rejected = expect(starting).rejects.toBeDefined()
    control.abort(); pending.resolve(snapshot()); await rejected
    expect(f.held.size).toBe(0)
    await f.start()
    await f.manager.closeParent('SIMULATED/parent')
    expect(f.held.size).toBe(0)
    await f.manager.start('SIMULATED/parent', 'workbuddycn', '/SIMULATED', new AbortController().signal, () => {})
    await vi.advanceTimersByTimeAsync(30_000)
    expect(f.held.size).toBe(0)
    await f.manager.close()
  })
})
