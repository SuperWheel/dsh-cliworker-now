import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DshSubagents,
  dshStatus,
  type DshObservation,
  type DshSubagentServices,
} from '../src/host/dsh-subagents.ts'

// SIMULATION: public catalog/projection cuts and interrupt admission only.
// No real Agent, model, CLI, Desktop or ~/.dsh data is touched.
const cleanup: (() => void)[] = []
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((close) => close())
  vi.useRealTimers()
})
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'cwn-dsh-simulated-'))
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  const signal = new AbortController().signal
  const catalog: any[] = [
    { id: 'native', createdAt: 1, label: '模拟原生任务', mode: 'continuable' },
    { id: 'cli', createdAt: 2, label: '模拟 CLI', mode: 'continuable' },
    { id: 'once', createdAt: 3, label: '模拟一次性', mode: 'one-shot' },
    { id: 'unknown', createdAt: 4, mode: 'unknown' },
  ]
  let timing: any = { settledMs: 0, active: { since: 1, through: 2 } },
    cursor = 10
  const released = vi.fn(),
    events = new Set<(id: string) => void>()
  const query = {
    observeSession: vi.fn(
      async (id: string) =>
        ({
          header: id === 'parent' || id === 'other' ? {} : { origin: 'subagent', parentSession: 'parent' },
          cursor,
          projections: {
            values:
              id === 'parent' || id === 'other'
                ? {}
                : {
                    subagentTiming: id === 'unknown' ? undefined : timing,
                    modelSelection: { next: null, lastUsed: { model: 'simulation-model' } },
                  },
          },
          [Symbol.dispose]: released,
        }) as DshObservation,
    ),
  }
  const subagents = {
    listChildren: vi.fn(async () => catalog),
    prompt: vi.fn(async () => ({ messageId: 'simulated-inbox-id' })),
    interruptByParent: vi.fn(() => ({ accepted: true })),
  }
  const owned = new Set(['cli'])
  const services: DshSubagentServices = {
    query: () => query as any,
    subagents: () => subagents as any,
    ownedSessions: () => owned,
    subscribe: (notify) => {
      events.add(notify)
      return () => {
        events.delete(notify)
      }
    },
    log: vi.fn(),
  }
  const manager = new DshSubagents(directory, services)
  cleanup.push(() => manager.dispose())
  return {
    manager,
    directory,
    services,
    subagents,
    query,
    catalog,
    signal,
    released,
    events,
    owned,
    settle: (completed = false) => {
      timing = { settledMs: 2, lastTurnCompleted: completed }
      cursor++
    },
    emit: (id: string) => events.forEach((notify) => notify(id)),
  }
}
it.each([
  [undefined, 'unknown'],
  [{ settledMs: 0 }, 'unknown'],
  [{ settledMs: 0, active: { since: 1, through: 2 } }, 'running'],
  [{ settledMs: 2, lastTurnCompleted: true }, 'completed'],
  [{ settledMs: 2, lastTurnCompleted: false }, 'failed'],
])('maps only public timing (%j) to %s', (projection, expected) => {
  expect(dshStatus(projection as any)).toBe(expected)
})
it('lists direct children, excludes owned CLI sessions, and releases all native observations', async () => {
  const f = fixture()
  const rows = await f.manager.list('parent', f.signal)
  expect(rows.map((row) => row.id)).toEqual(['native', 'once', 'unknown'])
  expect(rows[0]).toMatchObject({ status: 'running', model: 'simulation-model', parentSessionId: 'parent' })
  expect(rows[2].status).toBe('unknown')
  expect(f.subagents.listChildren).toHaveBeenCalledWith('parent', expect.any(AbortSignal))
  expect(f.released).toHaveBeenCalledTimes(4)
  f.owned.add('native') // Includes archived/owned sessions too, regardless of status.
  expect((await f.manager.list('parent', f.signal)).map((row) => row.id)).toEqual(['once', 'unknown'])
})
it('names children dsh-N per main conversation in creation order, persists privately and never renumbers', async () => {
  const f = fixture()
  const rows = await f.manager.list('parent', f.signal)
  expect(rows.map((row) => [row.id, row.agentName])).toEqual([['native', 'dsh-1'], ['once', 'dsh-2'], ['unknown', 'dsh-3']])
  const file = join(f.directory, 'dsh-names.json')
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ parent: { native: 'dsh-1', once: 'dsh-2', unknown: 'dsh-3' } })
  if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
  await f.manager.hide('parent', 'once', f.signal)
  f.catalog.push({ id: 'later', createdAt: 0, label: '模拟后到', mode: 'continuable' })
  const reloaded = new DshSubagents(f.directory, f.services)
  cleanup.push(() => reloaded.dispose())
  // A late (even older-timestamped) child takes the next number; hidden "dsh-2" is never reused.
  expect((await reloaded.list('parent', f.signal)).map((row) => [row.id, row.agentName]))
    .toEqual([['native', 'dsh-1'], ['unknown', 'dsh-3'], ['later', 'dsh-4']])
  // Another main conversation numbers independently, by creation time (rows stay in native order).
  expect((await reloaded.list('other', f.signal)).map((row) => [row.id, row.agentName]))
    .toEqual([['native', 'dsh-2'], ['once', 'dsh-3'], ['unknown', 'dsh-4'], ['later', 'dsh-1']])
})
it('continues a visible continuable child by its exact dsh name; unknown/hidden/read-only names never prompt', async () => {
  const f = fixture()
  await f.manager.list('parent', f.signal)
  const receipt = await f.manager.followup('parent', { name: 'DSH-1' }, '模拟续聊', f.signal)
  expect(receipt).toMatchObject({ kind: 'dsh-subagent', workerId: 'native', agentName: 'dsh-1', receipt: { messageId: 'simulated-inbox-id' } })
  expect(f.subagents.prompt).toHaveBeenCalledWith(expect.objectContaining({
    parentSessionId: 'parent', childSessionId: 'native', mode: 'continuable', delivery: 'queue',
    content: [{ type: 'text', text: '模拟续聊' }], requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  }), expect.any(AbortSignal))
  expect(await f.manager.followup('parent', { name: 'dsh-9' }, 'x', f.signal)).toBeUndefined()
  expect(await f.manager.resolve('parent', { id: 'not-a-child' }, f.signal)).toBeUndefined()
  expect(await f.manager.resolve('parent', { id: 'native', name: 'dsh-2' }, f.signal)).toBeUndefined()
  await expect(f.manager.followup('parent', { name: 'dsh-2' }, 'x', f.signal)).rejects.toThrow('此 DSH 子 Agent 只读')
  await f.manager.hide('parent', 'native', f.signal)
  await expect(f.manager.followup('parent', { name: 'dsh-1' }, 'x', f.signal)).rejects.toThrow('不在当前主会话列表中')
  expect(f.subagents.prompt).toHaveBeenCalledTimes(1)
})
it('hides only in a private parent-scoped plugin file and survives reload', async () => {
  const f = fixture()
  await f.manager.hide('parent', 'native', f.signal)
  expect((await f.manager.list('parent', f.signal)).map((row) => row.id)).not.toContain('native')
  expect((await f.manager.list('other', f.signal)).map((row) => row.id)).toContain('native')
  const saved = JSON.parse(readFileSync(join(f.directory, 'dsh-hidden.json'), 'utf8'))
  expect(saved).toEqual({ parent: ['native'] })
  if (process.platform !== 'win32') {
    expect(statSync(f.directory).mode & 0o777).toBe(0o700)
    expect(statSync(join(f.directory, 'dsh-hidden.json')).mode & 0o777).toBe(0o600)
  }
  const reloaded = new DshSubagents(f.directory, f.services)
  cleanup.push(() => reloaded.dispose())
  expect((await reloaded.list('parent', f.signal)).map((row) => row.id)).not.toContain('native')
  expect(f.subagents.prompt).not.toHaveBeenCalled()
  expect(f.subagents.interruptByParent).not.toHaveBeenCalled()
})
it('delivers continuable prompts with the exact native identity and surfaces rejection', async () => {
  const f = fixture(),
    request: any = {
      parentSessionId: 'parent',
      childSessionId: 'native',
      mode: 'continuable',
      requestId: 'synthetic-request',
      delivery: 'queue',
      content: [{ type: 'text', text: '模拟续聊' }],
    }
  await expect(f.manager.prompt(request, f.signal)).resolves.toEqual({ messageId: 'simulated-inbox-id' })
  expect(f.subagents.prompt).toHaveBeenCalledWith(request, expect.any(AbortSignal))
  f.subagents.prompt.mockRejectedValueOnce(new Error('simulation: parent unavailable'))
  await expect(f.manager.prompt(request, f.signal)).rejects.toThrow('parent unavailable')
})
it.each(['once', 'unknown', 'cli', 'foreign'])(
  'refuses follow-up and stop for non-continuable/non-owned child %s',
  async (id) => {
    const f = fixture()
    await expect(
      f.manager.prompt({ parentSessionId: 'parent', childSessionId: id } as any, f.signal),
    ).rejects.toThrow()
    await expect(f.manager.stop('parent', id, f.signal)).rejects.toThrow()
    expect(f.subagents.prompt).not.toHaveBeenCalled()
    expect(f.subagents.interruptByParent).not.toHaveBeenCalled()
  },
)
it('does not report stop on acknowledgement; succeeds only after a settled projection', async () => {
  vi.useFakeTimers()
  const f = fixture(),
    done = vi.fn()
  const stop = f.manager.stop('parent', 'native', f.signal).then(done)
  await vi.advanceTimersByTimeAsync(200)
  expect(f.subagents.interruptByParent).toHaveBeenCalledWith('native', 'parent', 'continuable')
  expect(done).not.toHaveBeenCalled()
  expect((await f.manager.list('parent', f.signal))[0].stopped).toBeUndefined()
  f.settle()
  await vi.advanceTimersByTimeAsync(100)
  await stop
  expect(done).toHaveBeenCalledWith({ stopped: true })
  expect((await f.manager.list('parent', f.signal))[0]).toMatchObject({ status: 'failed', stopped: true })
  expect(vi.getTimerCount()).toBe(0)
})
it('surfaces interrupt failure and unconfirmed/unknown stop rather than success', async () => {
  vi.useFakeTimers()
  const f = fixture()
  f.subagents.interruptByParent.mockImplementationOnce(() => {
    throw new Error('simulation: interrupt refused')
  })
  await expect(f.manager.stop('parent', 'native', f.signal)).rejects.toThrow('interrupt refused')
  const abort = new AbortController()
  const stop = f.manager.stop('parent', 'native', abort.signal)
  const rejected = expect(stop).rejects.toThrow('simulation: cancelled')
  await vi.advanceTimersByTimeAsync(100)
  abort.abort(new Error('simulation: cancelled'))
  await rejected
  expect((await f.manager.list('parent', f.signal))[0].stopped).toBeUndefined()
  expect(vi.getTimerCount()).toBe(0)
})
it.each(['service', 'projection', 'catalog'])(
  'degrades %s failure to an empty group and logs without native content',
  async (kind) => {
    const f = fixture()
    if (kind === 'service') f.services.subagents = () => undefined
    if (kind === 'projection')
      f.query.observeSession.mockResolvedValue({ header: {}, cursor: 0, [Symbol.dispose]: f.released })
    if (kind === 'catalog')
      f.subagents.listChildren.mockRejectedValue(new Error('simulation: private native content'))
    expect(await f.manager.list('parent', f.signal)).toEqual([])
    expect(f.services.log).toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(f.services.log).mock.calls)).not.toContain('private native content')
  },
)
it('keeps an unreadable child unknown without hiding its readable siblings', async () => {
  const f = fixture(),
    original = f.query.observeSession.getMockImplementation()!
  f.query.observeSession.mockImplementation(async (id) => {
    if (id === 'native') throw new Error('simulation: unreadable')
    return original(id)
  })
  expect((await f.manager.list('parent', f.signal)).map((row) => row.status)).toEqual([
    'unknown',
    'running',
    'unknown',
  ])
})
it('refreshes on exact native events/hide and removes subscriptions on disposal', async () => {
  const f = fixture(),
    stream = f.manager.watch('parent', f.signal)[Symbol.asyncIterator]()
  await stream.next()
  expect(f.events.size).toBe(1)
  let received = false
  const next = stream.next().then((result) => {
    received = true
    return result
  })
  f.emit('unrelated')
  await Promise.resolve()
  expect(received).toBe(false)
  f.settle(true)
  f.emit('native')
  expect(JSON.parse((await next).value!)[0].status).toBe('completed')
  const hidden = stream.next()
  await f.manager.hide('parent', 'native', f.signal)
  expect(JSON.parse((await hidden).value!).map((row: any) => row.id)).not.toContain('native')
  const ended = stream.next()
  f.manager.dispose()
  expect(await ended).toEqual({ done: true, value: undefined })
  expect(f.events.size).toBe(0)
})
it('polls only for the caller-owned stream without events and cancels its timer', async () => {
  vi.useFakeTimers()
  const f = fixture()
  f.services.subscribe = undefined
  const abort = new AbortController(),
    stream = f.manager.watch('parent', abort.signal)[Symbol.asyncIterator]()
  await stream.next()
  const next = stream.next()
  f.settle(true)
  await vi.advanceTimersByTimeAsync(2000)
  expect(JSON.parse((await next).value!)[0].status).toBe('completed')
  const ended = stream.next()
  abort.abort()
  await ended
  expect(vi.getTimerCount()).toBe(0)
})

it('times out an unknown stop without a success marker and releases its wait timer', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const original = f.query.observeSession.getMockImplementation()!
  f.query.observeSession.mockImplementation(async (id) => {
    const cut = await original(id)
    if (id === 'native') cut.projections = { values: {} }
    return cut
  })
  const result = expect(f.manager.stop('parent', 'native', f.signal)).rejects.toThrow('DSH 停止尚未确认')
  await vi.advanceTimersByTimeAsync(30_000)
  await result
  expect(vi.getTimerCount()).toBe(0)
  expect((await f.manager.list('parent', f.signal))[0].stopped).toBeUndefined()
})
it('disposes event subscriptions even while the stream consumer is paused at a yield', async () => {
  const f = fixture(),
    stream = f.manager.watch('parent', f.signal)[Symbol.asyncIterator]()
  await stream.next()
  f.manager.dispose()
  expect(f.events.size).toBe(0)
  await stream.return?.()
})
