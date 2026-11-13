import { describe, expect, it, vi } from 'vitest'
import { AccountQueryQueue } from '../src/client/account-query-queue.ts'

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
function pending() {
  let finish!: () => void
  const promise = new Promise<void>((resolve) => {
    finish = resolve
  })
  return { promise, finish }
}

describe('dialog account query scheduling (synthetic)', () => {
  it('bounds active reads and promotes the selected CLI before another queued background read', async () => {
    const queue = new AccountQueryQueue<string>(),
      a = pending(),
      b = pending(),
      selected = pending()
    const calls: string[] = [],
      signals = new Map<string, AbortSignal>()
    const query = (id: string, wait: ReturnType<typeof pending>) => async (signal: AbortSignal) => {
      calls.push(id)
      signals.set(id, signal)
      await wait.promise
    }
    queue.prioritize('a')
    queue.enqueue('a', query('a', a))
    queue.enqueue('b', query('b', b))
    queue.enqueue('c', query('c', pending()))
    queue.enqueue('selected', query('selected', selected))
    await tick()
    expect(calls).toEqual(['a', 'b'])
    queue.prioritize('selected')
    expect(signals.get('a')?.aborted).toBe(false)
    expect(signals.get('b')?.aborted).toBe(false)
    await tick()
    expect(calls).toEqual(['a', 'b']) // existing requests keep their slots
    a.finish()
    await tick()
    expect(calls).toEqual(['a', 'b', 'selected'])
    queue.clear()
    b.finish()
    selected.finish()
    await tick()
    expect(calls).toEqual(['a', 'b', 'selected'])
  })

  it('waits for a replaced read and never overlaps reads for one CLI', async () => {
    const queue = new AccountQueryQueue<string>(),
      old = pending(),
      next = vi.fn(async () => {})
    let signal!: AbortSignal
    queue.enqueue('same', async (control) => {
      signal = control
      await old.promise
    })
    await tick()
    queue.enqueue('same', next, true)
    await tick()
    expect(signal.aborted).toBe(true)
    expect(next).not.toHaveBeenCalled()
    old.finish()
    await tick()
    expect(next).toHaveBeenCalledOnce()
  })

  it('cancels disabled queued and active reads without restarting them', async () => {
    const queue = new AccountQueryQueue<string>(1),
      active = pending(),
      queued = vi.fn(async () => {})
    let signal!: AbortSignal
    queue.enqueue('active', async (control) => {
      signal = control
      await active.promise
    })
    queue.enqueue('queued', queued)
    await tick()
    queue.cancel('queued')
    queue.cancel('active')
    expect(signal.aborted).toBe(true)
    active.finish()
    await tick()
    expect(queued).not.toHaveBeenCalled()
    expect(queue.has('active')).toBe(false)
  })

  it('queues one fresh read after cancel without overlapping the unsettled request', async () => {
    const queue = new AccountQueryQueue<string>(),
      old = pending(),
      fresh = vi.fn(async () => {})
    let control!: AbortSignal
    queue.enqueue('same', async (signal) => {
      control = signal
      await old.promise
    })
    await tick()
    queue.cancel('same')
    expect(control.aborted).toBe(true)
    expect(queue.has('same')).toBe(false)
    expect(queue.enqueue('same', fresh)).toBe(true)
    expect(queue.has('same')).toBe(true)
    expect(queue.enqueue('same', fresh)).toBe(false)
    await tick()
    expect(fresh).not.toHaveBeenCalled()
    old.finish()
    await tick()
    expect(fresh).toHaveBeenCalledOnce()
  })

  it('releases failures for an explicit retry and clear prevents late queued work', async () => {
    const queue = new AccountQueryQueue<string>(1),
      retry = vi.fn(async () => {})
    queue.enqueue('failed', async () => {
      throw new Error('synthetic failure')
    })
    await tick()
    expect(queue.has('failed')).toBe(false)
    queue.enqueue('failed', retry)
    await tick()
    expect(retry).toHaveBeenCalledOnce()
    const cancelled = vi.fn(async () => {})
    queue.enqueue('late', cancelled)
    queue.clear()
    await tick()
    expect(cancelled).not.toHaveBeenCalled()
  })
})

describe('whenIdle', () => {
  it('runs at once when idle, otherwise after the key settles, and only the latest callback', async () => {
    const queue = new AccountQueryQueue<string>()
    const now = vi.fn()
    queue.whenIdle('a', now)
    expect(now).toHaveBeenCalledOnce()
    let release!: () => void
    queue.enqueue('a', () => new Promise<void>(resolve => { release = resolve }))
    const first = vi.fn(), second = vi.fn()
    queue.whenIdle('a', first)
    queue.whenIdle('a', second)
    await Promise.resolve(); await Promise.resolve()
    expect(second).not.toHaveBeenCalled()
    release()
    await vi.waitFor(() => expect(second).toHaveBeenCalledOnce())
    expect(first).not.toHaveBeenCalled()
  })

  it('drops pending callbacks on clear', async () => {
    const queue = new AccountQueryQueue<string>()
    queue.enqueue('a', () => new Promise<void>(() => {}))
    const then = vi.fn()
    queue.whenIdle('a', then)
    queue.clear()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(then).not.toHaveBeenCalled()
  })
})
