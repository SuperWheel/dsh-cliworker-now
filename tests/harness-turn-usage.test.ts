import { hostServiceFixture } from './fixtures/host-service.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { markAgentLoopRequest, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { HarnessConversationBridge, HARNESS_CLI_PROVIDER } from '../src/host/harness-conversation.ts'
import { HarnessConversationStream } from '../src/host/harness-conversation-stream.ts'
import { HarnessConversationStore } from '../src/host/harness-conversation-store.ts'
import { bindHarnessTurnRun, projectExternalTurnUsage, recoverHarnessTurnRuns, type HarnessTurnObservation } from '../src/host/harness-turn-usage.ts'
import type { HarnessConversationRecord } from '../src/host/harness-conversation-types.ts'
import type { Worker, WorkerEvent } from '../src/shared/types.ts'
import type { TokenUsage } from '../src/shared/telemetry.ts'

// Explicitly simulated Host stores, AgentLoop positions and CLI run receipts.
const roots: string[] = [], closures: Array<() => void> = []
afterEach(() => { for (const close of closures.splice(0)) close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks() })
const temporary = () => { const root = mkdtempSync(join(tmpdir(), 'cwn-SIMULATED-turn-usage-')); roots.push(root); return root }
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }
function state() {
  const record: HarnessConversationRecord = { workerId: randomUUID(), parentSessionId: 'SIMULATED-parent', sessionId: 'SIMULATED-child' }
  const worker = { id: record.workerId, parentSessionId: record.parentSessionId, runId: randomUUID(), status: 'completed',
    preference: { cli: 'claude', model: 'SIMULATED-model', effort: 'default' },
    harnessConversation: { sessionId: record.sessionId, parentSessionId: record.parentSessionId, mode: 'continuable', capabilities: {} },
  } as Worker
  return { record, worker }
}
const usage = (input = 10): TokenUsage => ({ scope: 'run', input, output: 4, cacheRead: 2, cacheWrite: 1, total: input + 7, reasoning: 2 })
const ended = (runId: string, status = 'completed'): WorkerEvent => ({ runId, seq: 1, time: new Date(0).toISOString(), kind: 'status', text: status, state: status })

describe('private turn/run durability', () => {
  it('preserves idempotence and refuses one run in different real turns', () => {
    const { record, worker } = state()
    const bound = bindHarnessTurnRun(record, 7, worker.runId)
    expect(bound.turnRuns).toEqual([{ turn: 7, runId: worker.runId }])
    expect(bindHarnessTurnRun(bound, 7, worker.runId)).toBe(bound)
    expect(() => bindHarnessTurnRun(bound, 8, worker.runId)).toThrow(/不同 Harness turn/)
    expect(() => bindHarnessTurnRun(record, 0.5, worker.runId)).toThrow()
    expect(() => bindHarnessTurnRun(record, 1, 'guessed-run')).toThrow()
  })
  it('round-trips exact bindings privately, deduplicates identical pairs and rejects contradictory persisted pairs', () => {
    const root = temporary(), store = new HarnessConversationStore(root), { record, worker } = state()
    const pair = { turn: 7, runId: worker.runId }
    store.save({ ...record, turnRuns: [pair, pair] })
    expect(new HarnessConversationStore(root).list()[0]?.turnRuns).toEqual([pair])
    expect(() => store.save({ ...record, turnRuns: [pair, { ...pair, turn: 8 }] })).toThrow()
    expect(() => store.save({ ...record, turnRuns: [{ ...pair, turn: 8 }] })).toThrow(/不可删除或改写/)
    expect(() => store.save(record)).toThrow(/不可删除或改写/)
    const read = store.list()[0]!
    read.turnRuns!.push({ turn: 8, runId: randomUUID() })
    expect(store.list()[0]!.turnRuns).toHaveLength(1)
    expect(readFileSync(join(root, 'harness-conversations.json'), 'utf8')).not.toMatch(/prompt|content|tool/)
  })
  it('refuses inherited old-child turn mappings when replacing a display child', () => {
    const store = new HarnessConversationStore(temporary()), { record, worker } = state()
    const old = bindHarnessTurnRun(record, 7, worker.runId)
    store.save(old)
    const next = { ...old, sessionId: 'SIMULATED-new-child', retiredSessionIds: [old.sessionId] }
    expect(() => store.replace(old, next)).toThrow()
    const clean = { ...next, turnRuns: undefined }
    store.replace(old, clean)
    expect(store.list()[0]?.turnRuns).toBeUndefined()
    // A failed publication may restore the old child with its own original mappings.
    store.replace(clean, { ...old, retiredSessionIds: [clean.sessionId] })
    expect(store.list()[0]?.turnRuns).toEqual(old.turnRuns)
  })
})

describe('exact external-run turn projection', () => {
  it('masks Qoder hidden-zero and absent bills while preserving nonzero partial native totals (synthetic)', () => {
    const { record, worker } = state(); worker.preference.cli = 'qoder'
    record.turnRuns = [{ turn: 2, runId: worker.runId }]
    expect(projectExternalTurnUsage(record, worker, false, [], () => undefined)).toEqual({ '2': null })
    expect(projectExternalTurnUsage(record, worker, false, [], () => ({ scope: 'run', total: 0, input: 0, output: 0 }))).toEqual({ '2': null })
    expect(projectExternalTurnUsage(record, worker, false, [], () => ({ scope: 'run', total: 63, input: 60, output: 3 }))['2'])
      .toMatchObject({ externalUsage: { totalTokens: 63, inputTokens: 60, inputBasis: 'reported', outputTokens: 3 } })
  })
  it('deduplicates multiple runs per turn and reports only normalized complete buckets', () => {
    const { record, worker } = state(), previousRun = randomUUID()
    record.turnRuns = [{ turn: 7, runId: previousRun }, { turn: 7, runId: previousRun }, { turn: 7, runId: worker.runId }]
    const result = projectExternalTurnUsage(record, worker, false, [ended(previousRun)], () => usage())
    expect(result['7']).toEqual({ basis: 'external-run', runIds: [previousRun, worker.runId], label: 'CLI 运行合计', usage: {
      uncachedInputTokens: 20, outputTokens: 8, totalTokens: 34, cacheReadTokens: 4, cacheWriteTokens: 2, reasoningTokens: 4,
    } })
  })
  it.each(['completed', 'failed', 'interrupted'] as const)('accepts a settled %s current run and never its busy snapshot', (status) => {
    const { record, worker } = state(); worker.status = status; record.turnRuns = [{ turn: 3, runId: worker.runId }]
    expect(projectExternalTurnUsage(record, worker, false, [], () => usage())['3']?.usage.totalTokens).toBe(17)
    expect(projectExternalTurnUsage(record, worker, true, [], () => usage())['3']).toBeNull()
  })
  it('omits absent aggregate sources so exact native per-response usage can remain authoritative', () => {
    const { record, worker } = state(); record.turnRuns = [{ turn: 2, runId: worker.runId }]
    expect(projectExternalTurnUsage(record, worker, false, [], () => undefined)).toEqual({})
    expect(projectExternalTurnUsage({ ...record, turnRuns: undefined }, worker, false, [], () => usage())).toEqual({})
    const previousRun = randomUUID()
    record.turnRuns.push({ turn: 2, runId: previousRun })
    expect(projectExternalTurnUsage(record, worker, false, [ended(previousRun)], (id) => id === worker.runId ? usage() : undefined)).toEqual({})
  })
  it('masks explicit invalid receipts and any unsettled/conflicting member instead of showing a partial sum', () => {
    const { record, worker } = state(), previousRun = randomUUID()
    record.turnRuns = [{ turn: 2, runId: previousRun }, { turn: 2, runId: worker.runId }]
    expect(projectExternalTurnUsage(record, worker, false, [], () => usage())['2']).toBeNull()
    expect(projectExternalTurnUsage(record, worker, false, [ended(previousRun)], (id) => id === previousRun ? usage() : { ...usage(), cacheRead: -1 })['2']).toBeNull()
    expect(projectExternalTurnUsage(record, worker, false, [ended(previousRun)], () => ({ ...usage(), scope: 'session' }))['2']).toBeNull()
    record.turnRuns.push({ turn: 3, runId: previousRun })
    expect(projectExternalTurnUsage(record, worker, false, [ended(previousRun)], () => usage())).toEqual({ '2': null, '3': null })
  })
  it('keeps a complete run total with partially known cache details in the native external report', () => {
    const { record, worker } = state(); record.turnRuns = [{ turn: 2, runId: worker.runId }]
    const value = projectExternalTurnUsage(record, worker, false, [], () => ({ ...usage(), cacheRead: undefined }))['2']
    expect(value).toMatchObject({ externalUsage: { totalTokens: 17, inputTokens: 10, inputBasis: 'uncached', outputTokens: 4, cacheWriteTokens: 1 } })
    expect(value?.externalUsage).not.toHaveProperty('cacheReadTokens')
    expect(value).not.toHaveProperty('usage')
  })
  it('does not borrow a retired child or another parent, and rejects uncertain termination', () => {
    const { record, worker } = state(); record.turnRuns = [{ turn: 4, runId: worker.runId }]
    expect(projectExternalTurnUsage({ ...record, sessionId: 'retired-child' }, worker, false, [], () => usage())).toEqual({})
    expect(projectExternalTurnUsage({ ...record, parentSessionId: 'another-parent' }, worker, false, [], () => usage())).toEqual({})
    worker.status = 'uncertain'
    expect(projectExternalTurnUsage(record, worker, false, [ended(worker.runId, 'uncertain')], () => usage())['4']).toBeNull()
  })
  it('uses shared CLI bucket normalization for inclusive input and separately reported reasoning', () => {
    const { record, worker } = state(); record.turnRuns = [{ turn: 4, runId: worker.runId }]
    worker.preference.cli = 'codex'
    expect(projectExternalTurnUsage(record, worker, false, [], () => ({ scope: 'run', input: 12, output: 4, cacheRead: 2, total: 16 }))['4']?.usage)
      .toMatchObject({ uncachedInputTokens: 10, totalTokens: 16, cacheWriteTokens: 0 })
    worker.preference.cli = 'mimo'
    expect(projectExternalTurnUsage(record, worker, false, [], () => ({ scope: 'run', input: 10, output: 4, reasoning: 2, cacheRead: 2, cacheWrite: 1, total: 19 }))['4']?.usage)
      .toMatchObject({ uncachedInputTokens: 10, outputTokens: 6, totalTokens: 19, reasoningTokens: 2 })
  })
  it('rejects summed safe-integer overflow', () => {
    const { record, worker } = state(), previousRun = randomUUID()
    record.turnRuns = [{ turn: 4, runId: worker.runId }, { turn: 4, runId: previousRun }]
    expect(projectExternalTurnUsage(record, worker, false, [ended(previousRun)], () => ({ scope: 'run', input: Number.MAX_SAFE_INTEGER - 7, output: 4, cacheRead: 2, cacheWrite: 1, total: Number.MAX_SAFE_INTEGER }))['4']).toBeNull()
  })
})

function routeFixture() {
  const { record, worker } = state(), controller = new AbortController(), gate = deferred<Worker>(), stop = deferred<void>()
  const agent = { id: record.sessionId, session: { header: { parentSession: record.parentSessionId } } }
  const bind = vi.fn(async () => {}), wait = vi.fn(() => gate.promise), deps = { bind, wait, getWorker: () => worker, stop: vi.fn(() => stop.promise),
    subscribe: () => () => {}, events: () => [], run: vi.fn(async () => ({ runId: worker.runId, done: gate.promise })) }
  const bridge: any = Object.create(HarnessConversationBridge.prototype)
  Object.assign(bridge, { records: new Map([[record.sessionId, record]]), recordWrites: new Map(), deps, lifetime: controller,
    positions: new Map([[record.sessionId, { agent, turn: 7, step: 1, signal: controller.signal }]]), streams: new Map(),
    pending: new Map([[record.sessionId, { requestId: randomUUID(), prompt: 'SIMULATED', messages: [], attachRunId: worker.runId }]]),
    knownRuns: new Set(), steeringInputs: new Map(), nativeSubmissions: new Map(), launches: new Set(), disposed: false, ctx: { agents: { currentInitiator: () => undefined } },
    pumpSteering: vi.fn(), recordInputs: vi.fn(async () => {}) })
  const options = markAgentLoopRequest({ provider: HARNESS_CLI_PROVIDER, model: `worker/${record.workerId}`, sessionId: record.sessionId,
    messages: [], signal: controller.signal }) as GenerateOptions
  const run = async () => { const values = []; for await (const item of bridge.route(options, async function* () {})) values.push(item); return values }
  vi.spyOn(HarnessConversationStream.prototype, 'segment').mockImplementation(async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })
  closures.push(() => { gate.resolve({ ...worker }); stop.resolve(); for (const stream of bridge.streams.values()) stream.close() })
  return { record, worker, bridge, deps, gate, stop, run }
}

describe('actual Host route binding transaction', () => {
  it('binds the real route position and run before first output, and remains idempotent across steps', async () => {
    const f = routeFixture(); f.gate.resolve(f.worker)
    await f.run()
    expect(f.bridge.lookup(f.record.sessionId).turnRuns).toEqual([{ turn: 7, runId: f.worker.runId }])
    await f.run()
    expect(f.bridge.lookup(f.record.sessionId).turnRuns).toHaveLength(1)
  })
  it('stops and awaits an admitted run when persistence fails before projecting it', async () => {
    const f = routeFixture(); f.bridge.pending.get(f.record.sessionId).attachRunId = undefined
    f.deps.bind.mockRejectedValueOnce(new Error('SIMULATED disk failure'))
    let settled = false
    const result = f.run().catch((error) => { settled = true; throw error })
    const rejected = expect(result).rejects.toThrow('SIMULATED disk failure')
    await vi.waitFor(() => expect(f.deps.stop).toHaveBeenCalledWith(f.record, f.worker.runId))
    expect(settled).toBe(false)
    f.gate.resolve(f.worker); f.stop.resolve()
    await rejected
    expect(f.bridge.streams.size).toBe(0)
  })
  it('rejects another real turn for the same active run and drains its stream', async () => {
    const f = routeFixture(); f.gate.resolve(f.worker)
    await f.run(); f.bridge.positions.get(f.record.sessionId).turn = 8
    const result = f.run(); const rejected = expect(result).rejects.toThrow(/不同 Harness turn/)
    await vi.waitFor(() => expect(f.deps.stop).toHaveBeenCalledOnce()); f.stop.resolve()
    await rejected
    expect(f.bridge.lookup(f.record.sessionId).turnRuns).toEqual([{ turn: 7, runId: f.worker.runId }])
  })
  it('drains an attached run if its exact binding disappeared before the serialized transaction', async () => {
    const f = routeFixture(); f.gate.resolve(f.worker); f.stop.resolve()
    f.deps.wait.mockImplementationOnce(() => { f.bridge.records.delete(f.record.sessionId); return f.gate.promise })
    await expect(f.run()).rejects.toThrow(/绑定已解除/)
    expect(f.deps.stop).toHaveBeenCalledOnce()
    expect(f.bridge.streams.size).toBe(0)
  })
})

it('refreshes an exact child on native turn settlement and releases its subscription', async () => {
  const { record, worker } = state(); record.turnRuns = [{ turn: 9, runId: worker.runId }]
  let onEvent: any; const off = vi.fn(), release = vi.fn()
  const snapshot = { selected: worker, selectedBusy: false, timeline: [], workers: [worker], revision: 1 }
  const service: any = hostServiceFixture()
  Object.assign(service['host'], { ctx: { on: (_name: string, listener: any) => { onEvent = listener; return off }, get: () => undefined },
    runtime: { subscribe: () => release, snapshot: () => snapshot, runUsage: () => usage(), storage: { history: () => [] } },
    disposed: new AbortController(), pending: new Map(), harnessConversationStore: { list: () => [record] } })
  const controller = new AbortController(), iterator = service.watch(worker.parentSessionId, worker.id, controller.signal)
  await iterator.next()
  const next = iterator.next()
  onEvent({ id: record.sessionId }, { type: 'turn/end' })
  expect((await next).done).toBe(false)
  controller.abort(); await iterator.return(undefined)
  expect(off).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce()
})

it('Gateway watch publishes only the selected child association and omits ordinary sessions', async () => {
  const { record, worker } = state(); record.turnRuns = [{ turn: 9, runId: worker.runId }]
  const source = { ...worker }, snapshot = { selected: source, selectedBusy: false, timeline: [], workers: [source], revision: 1 }
  const service: any = hostServiceFixture()
  const runtime = { subscribe: () => () => {}, snapshot: () => snapshot, runUsage: vi.fn(() => usage()), storage: { history: vi.fn(() => []) } }
  Object.assign(service['host'], { ctx: { on: () => () => {}, get: () => undefined }, runtime, disposed: new AbortController(), pending: new Map(), harnessConversationStore: { list: () => [record] } })
  const controller = new AbortController(), iterator = service.watch(worker.parentSessionId, worker.id, controller.signal)
  const first = JSON.parse((await iterator.next()).value)
  expect(first.externalTurnUsage['9']).toMatchObject({ basis: 'external-run', runIds: [worker.runId] })
  expect(runtime.runUsage).toHaveBeenCalledWith(worker.parentSessionId, worker.id, worker.runId)
  controller.abort(); await iterator.return(undefined)
  source.harnessConversation = undefined
  const plain = new AbortController(), ordinary = service.watch(worker.parentSessionId, worker.id, plain.signal)
  expect(JSON.parse((await ordinary.next()).value)).not.toHaveProperty('externalTurnUsage')
  plain.abort(); await ordinary.return(undefined)
})


function legacyHermes() {
  const { record, worker } = state()
  worker.preference.cli = 'hermes'
  const accepted = randomUUID(), rejected = randomUUID()
  record.nativeInputs = [
    { requestId: rejected, batchId: rejected, promptHash: 'a'.repeat(64), accepted: false },
    { requestId: accepted, batchId: accepted, promptHash: 'a'.repeat(64), accepted: true },
  ]
  const events: WorkerEvent[] = [
    { ...ended(worker.runId), seq: 9, kind: 'user', text: 'SIMULATED identical text', state: undefined, queuedFollowupId: accepted, admittedRunId: worker.runId },
    { ...ended(worker.runId), seq: 17 },
  ]
  const sessionEvents: any[] = []
  const event = (type: string, data: any) => sessionEvents.push({ type, seq: sessionEvents.length, time: new Date(0).toISOString(), data })
  const turn = (turn: number, request: string) => {
    event('turn/start', { turn }); event('step/start', { turn, step: 1 })
    event('user/message', { role: 'user', id: randomUUID(), source: { kind: 'user', rpcId: request }, content: [{ type: 'text', text: 'SIMULATED identical text' }] })
    event('step/end', { turn, step: 1 }); event('turn/end', { turn, reason: { kind: 'completed' } })
  }
  turn(2, rejected); turn(3, accepted)
  const observation = { header: { id: record.sessionId, parentSession: record.parentSessionId, origin: 'subagent' }, inheritedEventCount: 0, events: sessionEvents } as HarnessTurnObservation
  return { record, worker, events, accepted, rejected, observation, sessionEvents, turn, event }
}

describe('read-only legacy Hermes turn recovery from official Session events', () => {
  it('recovers only the unique accepted RPC chain and leaves both original binding and Session events intact', () => {
    const f = legacyHermes(), before = structuredClone(f.record), sourceEvents = structuredClone(f.sessionEvents)
    const recovered = recoverHarnessTurnRuns(f.record, f.worker, f.events, f.observation)
    expect(recovered.turnRuns).toEqual([{ turn: 3, runId: f.worker.runId }])
    expect(f.record).toEqual(before); expect(f.sessionEvents).toEqual(sourceEvents)
  })
  it('never recovers an accepted=false request even with matching text, receipt and turn events', () => {
    const f = legacyHermes(); f.record.nativeInputs!.find((input) => input.requestId === f.accepted)!.accepted = false
    expect(recoverHarnessTurnRuns(f.record, f.worker, f.events, f.observation)).toBe(f.record)
  })
  it('does not use a queued insertion without an entered real turn or an unclosed native turn', () => {
    const f = legacyHermes()
    for (const row of f.sessionEvents) if (row.type === 'turn/start' || row.type === 'step/start') row.type = 'SIMULATED-missing-boundary'
    expect(recoverHarnessTurnRuns(f.record, f.worker, f.events, f.observation)).toBe(f.record)
    const g = legacyHermes(); g.sessionEvents.pop()
    expect(recoverHarnessTurnRuns(g.record, g.worker, g.events, g.observation)).toBe(g.record)
  })
  it('rejects duplicate entered RPC turns and mismatched Worker admission identities', () => {
    const f = legacyHermes(); f.turn(4, f.accepted)
    expect(recoverHarnessTurnRuns(f.record, f.worker, f.events, f.observation)).toBe(f.record)
    const g = legacyHermes(); g.events[0]!.admittedRunId = randomUUID()
    expect(recoverHarnessTurnRuns(g.record, g.worker, g.events, g.observation)).toBe(g.record)
  })
  it('keeps newer durable turn mappings authoritative and never crosses child/parent identity', () => {
    const f = legacyHermes(); f.record.turnRuns = [{ turn: 8, runId: f.worker.runId }]
    expect(recoverHarnessTurnRuns(f.record, f.worker, f.events, f.observation)).toBe(f.record)
    expect(f.record.turnRuns).toEqual([{ turn: 8, runId: f.worker.runId }])
    const g = legacyHermes(); g.observation.header = { ...g.observation.header, id: 'SIMULATED-retired-child' as any }
    expect(recoverHarnessTurnRuns(g.record, g.worker, g.events, g.observation)).toBe(g.record)
    const h = legacyHermes(); h.observation.header = { ...h.observation.header, parentSession: 'SIMULATED-other-parent' as any }
    expect(recoverHarnessTurnRuns(h.record, h.worker, h.events, h.observation)).toBe(h.record)
  })
  it('requires every accepted member of a batch to identify the same unique turn', () => {
    const f = legacyHermes(), other = randomUUID()
    f.record.nativeInputs!.push({ requestId: other, batchId: f.accepted, promptHash: 'b'.repeat(64), accepted: true })
    expect(recoverHarnessTurnRuns(f.record, f.worker, f.events, f.observation)).toBe(f.record)
    f.turn(4, other)
    expect(recoverHarnessTurnRuns(f.record, f.worker, f.events, f.observation)).toBe(f.record)
  })
  it('does not misattribute a reused RPC whose next native turn has not closed', () => {
    const f = legacyHermes(); f.event('turn/start', { turn: 4 }); f.event('step/start', { turn: 4, step: 1 })
    f.event('user/message', { role: 'user', id: randomUUID(), source: { kind: 'user', rpcId: f.accepted }, content: [] })
    expect(recoverHarnessTurnRuns(f.record, f.worker, f.events, f.observation)).toBe(f.record)
  })
  it('Gateway uses one disposable official read and projects only its in-memory association', async () => {
    const f = legacyHermes(), dispose = vi.fn(), observe = vi.fn(async () => ({ ...f.observation, [Symbol.dispose]: dispose }))
    const service: any = hostServiceFixture(), before = structuredClone(f.record)
    const snapshot = { selected: f.worker, selectedBusy: false, timeline: [], workers: [f.worker], revision: 1 }
    Object.assign(service['host'], { ctx: { on: () => () => {}, get: (name: string) => name === 'sessionQuery' ? { observeSession: observe } : undefined },
      runtime: { subscribe: () => () => {}, snapshot: () => snapshot, storage: { history: () => f.events }, runUsage: () => ({ scope: 'run', input: 13, output: 4, cacheRead: 2, cacheWrite: 1, total: 17 }) },
      disposed: new AbortController(), pending: new Map(), harnessConversationStore: { list: () => [f.record] } })
    const controller = new AbortController(), iterator = service.watch(f.worker.parentSessionId, f.worker.id, controller.signal)
    const result = JSON.parse((await iterator.next()).value)
    expect(result.externalTurnUsage['3']).toMatchObject({ basis: 'external-run', runIds: [f.worker.runId], usage: { totalTokens: 17, uncachedInputTokens: 10 } })
    expect(observe).toHaveBeenCalledWith(f.record.sessionId, { signal: expect.any(AbortSignal), projectionMode: 'none' })
    expect(dispose).toHaveBeenCalledOnce(); expect(f.record).toEqual(before)
    controller.abort(); await iterator.return(undefined)
  })
  it('a failed official read stays unknown without mutating the old binding or falling back to text', async () => {
    const f = legacyHermes(), service: any = hostServiceFixture(), before = structuredClone(f.record)
    const snapshot = { selected: f.worker, selectedBusy: false, timeline: [], workers: [f.worker], revision: 1 }
    Object.assign(service['host'], { ctx: { on: () => () => {}, get: () => ({ observeSession: async () => { throw new Error('SIMULATED corrupt read') } }) },
      runtime: { subscribe: () => () => {}, snapshot: () => snapshot, storage: { history: () => f.events }, runUsage: () => usage() },
      disposed: new AbortController(), pending: new Map(), harnessConversationStore: { list: () => [f.record] } })
    const controller = new AbortController(), iterator = service.watch(f.worker.parentSessionId, f.worker.id, controller.signal)
    expect(JSON.parse((await iterator.next()).value).externalTurnUsage).toEqual({})
    expect(f.record).toEqual(before); controller.abort(); await iterator.return(undefined)
  })
})
