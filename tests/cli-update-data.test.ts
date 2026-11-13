import { createElement, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import {
  CLI_UPDATE_RECONNECT_DELAYS_MS,
  parseCliUpdateSnapshot,
  useCliUpdateData,
  type CliUpdateData,
} from '../src/client/cli-update-data.ts'
import type { API } from '../src/client/workers.ts'

// 模拟：Host、Gateway 流与快照全部为测试替身；不探测、不更新、不安装任何 CLI。
const SESSION = 'simulation-parent'
const remote = (data: unknown) => ({ ok: true, value: typeof data === 'string' ? data : JSON.stringify(data) })
const failure = (message: string) => ({ ok: false, error: { message } })
const snapshot = (revision: number, changes: Record<string, unknown> = {}) => ({
  revision,
  activity: 'idle',
  entries: [{ cli: 'codex', group: 'updatable', installed: true, currentVersion: '0.1.0', latestVersion: `0.${revision}.0` }],
  queue: [],
  results: [],
  ...changes,
})

/** One simulated `watchCliUpdates` subscription the test pushes snapshots into. */
function channel(signal: AbortSignal) {
  const queue: string[] = []
  let wake: (() => void) | undefined
  let ended = false
  let error: Error | undefined
  const notify = () => {
    wake?.()
    wake = undefined
  }
  signal.addEventListener('abort', notify, { once: true })
  return {
    signal,
    push(value: unknown) {
      queue.push(JSON.stringify(value))
      notify()
    },
    pushRaw(value: string) {
      queue.push(value)
      notify()
    },
    end() {
      ended = true
      notify()
    },
    fail(reason: Error) {
      error = reason
      notify()
    },
    async *iterate() {
      while (!signal.aborted) {
        if (queue.length) {
          yield queue.shift()!
          continue
        }
        if (error) throw error
        if (ended) return
        await new Promise<void>((resolve) => (wake = resolve))
      }
    },
  }
}

/** Stand-in for the Gateway's `$stream`: one generation, `ended()` when the source stops. */
function simulatedStream(disposed: AbortSignal[]) {
  return (options: { open: (signal: AbortSignal) => AsyncIterable<string>; ended: () => Error }) => {
    const controller = new AbortController()
    disposed.push(controller.signal)
    return {
      async *[Symbol.asyncIterator]() {
        for await (const value of options.open(controller.signal))
          yield { generation: 1, value, signal: controller.signal, accept: () => undefined }
        if (!controller.signal.aborted) throw options.ended()
      },
      dispose: async () => controller.abort(),
    }
  }
}

function simulatedHost(initial: unknown = snapshot(1)) {
  const calls: string[] = []
  const streams: ReturnType<typeof channel>[] = []
  const disposed: AbortSignal[] = []
  const snapshots: unknown[] = [initial]
  const cliUpdateSnapshot = vi.fn(async (_session: string, _signal: AbortSignal) => {
    calls.push('snapshot')
    const next = snapshots.length > 1 ? snapshots.shift() : snapshots[0]
    return next instanceof Error ? failure(next.message) : remote(next)
  })
  const watchCliUpdates = vi.fn((_session: string, signal: AbortSignal) => {
    calls.push('watch')
    const stream = channel(signal)
    streams.push(stream)
    return stream.iterate()
  })
  const checkCliUpdates = vi.fn(async (_session: string, _scope: 'missing' | 'all', _signal: AbortSignal) => remote(snapshot(5)))
  const api = {
    $stream: simulatedStream(disposed),
    cliworker: { cliUpdateSnapshot, watchCliUpdates, checkCliUpdates },
  } as unknown as API
  return { api, calls, streams, disposed, snapshots, cliUpdateSnapshot, watchCliUpdates, checkCliUpdates }
}

const mounted: ReactTestRenderer[] = []
afterEach(async () => {
  await act(async () => {
    for (const renderer of mounted.splice(0)) renderer.unmount()
  })
  vi.useRealTimers()
})
const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  })

async function mount(api: API) {
  const seen: { data?: CliUpdateData } = {}
  function Probe() {
    seen.data = useCliUpdateData(api, SESSION)
    return null
  }
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(Probe))
    mounted.push(renderer)
  })
  await flush()
  return { seen, renderer, data: () => seen.data! }
}

it('reports an older Host without the update methods as unsupported and calls nothing', async () => {
  const $stream = vi.fn()
  const { data } = await mount({ $stream, cliworker: {} } as unknown as API)
  expect(data().supported).toBe(false)
  expect(data().snapshot).toBeUndefined()
  expect(data().error).toBeUndefined()
  await act(async () => data().check('missing'))
  expect($stream).not.toHaveBeenCalled()
})

it('reads the cached snapshot first, then follows the stream and only moves forward by revision', async () => {
  const host = simulatedHost(snapshot(2))
  const { data } = await mount(host.api)
  expect(host.calls).toEqual(['snapshot', 'watch'])
  expect(data().supported).toBe(true)
  expect(data().snapshot?.revision).toBe(2)
  const stream = host.streams[0]!
  // The stream's opening item repeats the cached revision; an older one must not roll back.
  await act(async () => stream.push(snapshot(2)))
  await act(async () => stream.push(snapshot(1)))
  await flush()
  expect(data().snapshot?.revision).toBe(2)
  await act(async () => stream.push(snapshot(3, { activity: 'checking' })))
  await flush()
  expect(data().snapshot?.revision).toBe(3)
  expect(data().snapshot?.activity).toBe('checking')
  expect(host.checkCliUpdates).not.toHaveBeenCalled()
})

it.each([
  ['an unknown CLI', { entries: [{ cli: 'not-a-cli', group: 'latest', installed: true }] }],
  ['an unknown section', { entries: [{ cli: 'codex', group: 'somewhere', installed: true }] }],
  ['a duplicated CLI', { entries: [{ cli: 'codex', group: 'latest', installed: true }, { cli: 'codex', group: 'failed', installed: true }] }],
  ['a queue with an unknown CLI', { queue: ['not-a-cli'] }],
  ['a malformed operation', { operation: { id: 'op', intent: 'update', cli: 'codex', phase: 'flying', outputTail: '' } }],
])('discards a whole snapshot with %s and reports it', async (_name, changes) => {
  expect(() => parseCliUpdateSnapshot(JSON.stringify(snapshot(9, changes)))).toThrow('收到无效的 CLI 更新状态，请重试')
  const host = simulatedHost(snapshot(1))
  const { data } = await mount(host.api)
  await act(async () => host.streams[0]!.push(snapshot(9, changes)))
  await flush()
  expect(data().snapshot?.revision).toBe(1)
  expect(data().error).toBe('收到无效的 CLI 更新状态，请重试')
  // A later valid snapshot clears the error.
  await act(async () => host.streams[0]!.push(snapshot(10)))
  await flush()
  expect(data().snapshot?.revision).toBe(10)
  expect(data().error).toBeUndefined()
})

it('shows a page error when the first snapshot is invalid or unreachable, and retry runs the whole flow again', async () => {
  const host = simulatedHost('{"revision":1}')
  host.snapshots.push(new Error('cliworker/unavailable: 模拟 Gateway 不通'), snapshot(6))
  const { data } = await mount(host.api)
  expect(data().snapshot).toBeUndefined()
  expect(data().error).toBe('收到无效的 CLI 更新状态，请重试')
  expect(host.watchCliUpdates).not.toHaveBeenCalled()
  await act(async () => data().retry())
  await flush()
  expect(data().error).toBe('模拟 Gateway 不通')
  expect(host.watchCliUpdates).not.toHaveBeenCalled()
  await act(async () => data().retry())
  await flush()
  expect(data().error).toBeUndefined()
  expect(data().snapshot?.revision).toBe(6)
  expect(host.calls).toEqual(['snapshot', 'snapshot', 'snapshot', 'watch'])
})

it('after a dropped stream reads the snapshot again before resubscribing, even from a restarted Host', async () => {
  vi.useFakeTimers()
  const host = simulatedHost(snapshot(7))
  host.snapshots.push(snapshot(2))
  const { data } = await mount(host.api)
  expect(data().snapshot?.revision).toBe(7)
  await act(async () => host.streams[0]!.fail(new Error('模拟断线')))
  await flush()
  // Still waiting: the old content stays and no error is shown during the reconnect pause.
  expect(host.calls).toEqual(['snapshot', 'watch'])
  expect(data().error).toBeUndefined()
  expect(host.disposed[0]!.aborted).toBe(true)
  await act(async () => vi.advanceTimersByTimeAsync(CLI_UPDATE_RECONNECT_DELAYS_MS[0]))
  await flush()
  expect(host.calls).toEqual(['snapshot', 'watch', 'snapshot', 'watch'])
  // A restarted Host counts from a lower revision; the resync takes it as the new baseline.
  expect(data().snapshot?.revision).toBe(2)
  await act(async () => host.streams[1]!.push(snapshot(3)))
  await flush()
  expect(data().snapshot?.revision).toBe(3)
})

it('gives up after the reconnect attempts and keeps the last snapshot next to the error', async () => {
  vi.useFakeTimers()
  const host = simulatedHost(snapshot(4))
  const { data } = await mount(host.api)
  host.snapshots.splice(0, host.snapshots.length, new Error('模拟 Host 未响应'))
  await act(async () => host.streams[0]!.end())
  for (const delay of CLI_UPDATE_RECONNECT_DELAYS_MS) {
    await flush()
    expect(data().error).toBeUndefined()
    await act(async () => vi.advanceTimersByTimeAsync(delay))
  }
  await flush()
  expect(data().error).toBe('模拟 Host 未响应')
  expect(data().snapshot?.revision).toBe(4)
  expect(host.cliUpdateSnapshot).toHaveBeenCalledTimes(1 + CLI_UPDATE_RECONNECT_DELAYS_MS.length)
  await act(async () => vi.advanceTimersByTimeAsync(60_000))
  expect(host.cliUpdateSnapshot).toHaveBeenCalledTimes(1 + CLI_UPDATE_RECONNECT_DELAYS_MS.length)
})

it('check() asks the Host with the scope and merges the answer by revision', async () => {
  const host = simulatedHost(snapshot(3))
  const { data } = await mount(host.api)
  await act(async () => data().check('missing'))
  expect(host.checkCliUpdates).toHaveBeenLastCalledWith(SESSION, 'missing', expect.any(AbortSignal))
  expect(data().snapshot?.revision).toBe(5)
  // An answer older than what the stream already showed is ignored.
  await act(async () => host.streams[0]!.push(snapshot(8)))
  await flush()
  await act(async () => data().check('all'))
  expect(host.checkCliUpdates).toHaveBeenLastCalledWith(SESSION, 'all', expect.any(AbortSignal))
  expect(data().snapshot?.revision).toBe(8)
})

it('check() rejects with a readable reason without turning it into a page error', async () => {
  const host = simulatedHost(snapshot(3))
  host.checkCliUpdates.mockResolvedValueOnce(failure('Error: 模拟检查被拒绝') as never)
  const { data } = await mount(host.api)
  await act(async () => {
    await expect(data().check('all')).rejects.toThrow('模拟检查被拒绝')
  })
  expect(data().error).toBeUndefined()
  host.checkCliUpdates.mockResolvedValueOnce(remote({ revision: 'x' }) as never)
  await act(async () => {
    await expect(data().check('all')).rejects.toThrow('收到无效的 CLI 更新状态，请重试')
  })
  expect(data().error).toBe('收到无效的 CLI 更新状态，请重试')
  expect(data().snapshot?.revision).toBe(3)
})

it('a check started by the page before the hook subscribed is kept, not rolled back by the cache', async () => {
  const host = simulatedHost(snapshot(1))
  const seen: { data?: CliUpdateData } = {}
  function Page({ data }: { data: CliUpdateData }) {
    // Children mount first: this runs before the parent hook's own effects.
    useEffect(() => void data.check('missing'), [])
    return null
  }
  function Dialog() {
    seen.data = useCliUpdateData(host.api, SESSION)
    return createElement(Page, { data: seen.data })
  }
  await act(async () => {
    mounted.push(create(createElement(Dialog)))
  })
  await flush()
  expect(host.checkCliUpdates).toHaveBeenCalledTimes(1)
  expect(seen.data!.snapshot?.revision).toBe(5)
})

it('aborts every request and closes the stream on unmount', async () => {
  const host = simulatedHost(snapshot(1))
  let pending!: (value: unknown) => void
  host.checkCliUpdates.mockImplementationOnce(() => new Promise((resolve) => (pending = resolve)) as never)
  const { data, renderer } = await mount(host.api)
  let checked: Promise<void> | undefined
  await act(async () => {
    checked = data().check('all')
  })
  const snapshotSignal = host.cliUpdateSnapshot.mock.calls[0]![1]
  const checkSignal = host.checkCliUpdates.mock.calls[0]![2]
  await act(async () => renderer.unmount())
  mounted.splice(mounted.indexOf(renderer), 1)
  expect(snapshotSignal.aborted).toBe(true)
  expect(checkSignal.aborted).toBe(true)
  expect(host.streams[0]!.signal.aborted).toBe(true)
  expect(host.disposed.every((signal) => signal.aborted)).toBe(true)
  pending(remote(snapshot(9)))
  await expect(checked).resolves.toBeUndefined()
})


it('takes a reopened stream generation as a new baseline after a Host restart, even at a lower revision', async () => {
  const host = simulatedHost(snapshot(1))
  // Stand-in for the Gateway reopening the watch by itself: a source that ends starts generation + 1.
  const reopening = (options: { open: (signal: AbortSignal) => AsyncIterable<string> }) => {
    const controller = new AbortController()
    return {
      async *[Symbol.asyncIterator]() {
        for (let generation = 1; !controller.signal.aborted; generation++)
          for await (const value of options.open(controller.signal))
            yield { generation, value, signal: controller.signal, accept: () => undefined }
      },
      dispose: async () => controller.abort(),
    }
  }
  const api = { ...host.api, $stream: reopening } as unknown as API
  const { data } = await mount(api)
  await act(async () => host.streams[0]!.push(snapshot(101)))
  await flush()
  expect(data().snapshot?.revision).toBe(101)
  await act(async () => host.streams[0]!.end())
  await flush()
  expect(host.streams).toHaveLength(2)
  await act(async () => host.streams[1]!.push(snapshot(0)))
  await flush()
  expect(data().snapshot?.revision).toBe(0)
  await act(async () => host.streams[1]!.push(snapshot(1)))
  await flush()
  expect(data().snapshot?.revision).toBe(1)
  // Within one generation an older revision is still ignored.
  await act(async () => host.streams[1]!.push(snapshot(0)))
  await flush()
  expect(data().snapshot?.revision).toBe(1)
})
