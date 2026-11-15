import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { AGENT_EXIT_GRACE_MS, cleanupManagedAgent, waitForNaturalAgentExit } from '../src/host/managed-agent.ts'

// 模拟 process handles only; no CLI, account, model or Windows process is launched.
afterEach(() => vi.useRealTimers())
function fixture() {
  const terminate = vi.fn()
  const waitForExit = vi.fn(async (_signal?: AbortSignal) => true)
  const handle = { done: Promise.resolve({ exitCode: 0, signal: null }), terminate, waitForExit } as unknown as SubprocessHandle
  return { handle, terminate, waitForExit }
}

describe('模拟 managed process natural exit boundaries', () => {
  it('terminates range survivors only after the bounded grace and still checks range exit', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.waitForExit.mockImplementationOnce(signal => new Promise(resolve => {
      signal!.addEventListener('abort', () => resolve(false), { once: true })
    }))
    const cleanup = cleanupManagedAgent(f.handle, true, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(AGENT_EXIT_GRACE_MS - 1)
    expect(f.terminate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await cleanup).toBe(true)
    expect(f.terminate).toHaveBeenCalledTimes(1)
    expect(f.waitForExit).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('abort interrupts the range grace without waiting for its timeout', async () => {
    vi.useFakeTimers()
    const f = fixture(), control = new AbortController()
    f.waitForExit.mockImplementationOnce(signal => new Promise(resolve => {
      signal!.addEventListener('abort', () => resolve(false), { once: true })
    }))
    const cleanup = cleanupManagedAgent(f.handle, true, control.signal)
    control.abort()
    expect(await cleanup).toBe(true)
    expect(f.terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('abort interrupts direct exit grace and removes its timer', async () => {
    vi.useFakeTimers()
    const f = fixture(), control = new AbortController()
    const handle = { ...f.handle, done: new Promise<never>(() => {}) }
    const waiting = waitForNaturalAgentExit(handle, control.signal)
    control.abort()
    expect(await waiting).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('genuine EPIPE still attempts termination and remains a rejected cleanup', async () => {
    const f = fixture()
    f.waitForExit.mockRejectedValueOnce(new Error('write EPIPE'))
    await expect(cleanupManagedAgent(f.handle, true, new AbortController().signal)).rejects.toThrow('write EPIPE')
    expect(f.terminate).toHaveBeenCalledTimes(1)
  })
})
