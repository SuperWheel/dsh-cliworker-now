import { mountNativeTools } from './fixtures/harness-native-tools.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { LlmRuntime, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionStore, SessionId, Session } from '@deepseek-ai/dsh-session'
import { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { HarnessConversationBridge, harnessBatchSubmissionId } from '../src/host/harness-conversation.ts'
import type {
  HarnessConversationDependencies,
  HarnessConversationRecord,
} from '../src/host/harness-conversation-types.ts'
import type { Worker, WorkerEvent } from '../src/shared/types.ts'

// Real installed rc.2 AgentLoop, continuable manager, Inbox and queue controller.
// The CLI event producer/cleanup gate and text-only upload retirement are simulated; no model/account/network calls.
const runtimeRequire = createRequire(
  realpathSync(new URL('../node_modules/@deepseek-ai/dsh/package.json', import.meta.url)),
)
const loadRuntime = async (name: string) => {
  const module = await import(pathToFileURL(runtimeRequire.resolve(name)).href)
  const plugin = module.default ?? module
  if (plugin === module && typeof module.apply !== 'function')
    throw new Error(`Official runtime module ${name} has no plugin default or apply export`)
  return { ...module, default: plugin }
}
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

async function fixture(initialSteering: 'ready' | 'pending' | 'unsupported' = 'unsupported') {
  const [
    { default: AgentLoop },
    { default: Projections },
    { default: Persistence },
    { default: Query },
    { SessionCommandController },
  ] = await Promise.all([
    loadRuntime('@deepseek-ai/dsh-agent-loop'),
    loadRuntime('@deepseek-ai/dsh-session-projection'),
    loadRuntime('@deepseek-ai/dsh-session-persistence-jsonl'),
    loadRuntime('@deepseek-ai/dsh-session-query'),
    import(
      pathToFileURL(
        join(dirname(runtimeRequire.resolve('@deepseek-ai/dsh-api-session-controller')), 'types/commands.js'),
      ).href
    ),
  ])
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-official-inbox-')))
  const ctx = new Context()
  // Synthetic admission service; fixtures supply durable refs, never real uploads.
  await ctx.plugin(class extends Service {
    constructor(ctx: Context) { super(ctx, 'attachments') }
    async admitPromptContent(content: unknown) { return content }
    fileHostPath() { return undefined }
  })
  await ctx.plugin(SessionStore)
  await ctx.plugin(Projections)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await mountNativeTools(ctx)
  await ctx.plugin(Persistence, { root: join(directory, 'sessions'), compression: 'none' })
  await ctx.plugin(Query)
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
  // Newer official SubagentRuntime requires the actual working-directory
  // service; retain the older SDK fixture without inventing a service mock.
  if (SubagentRuntime.inject?.includes('workingDirectory')) {
    const [{ default: LocalFs }, { default: WorkingDirectory }] = await Promise.all([
      loadRuntime('@deepseek-ai/dsh-fs-local'),
      loadRuntime('@deepseek-ai/dsh-working-directory'),
    ])
    await ctx.plugin(LocalFs)
    await ctx.plugin(WorkingDirectory)
  }
  await ctx.plugin(SubagentRuntime, { maxDepth: 4, maxActiveSubagents: 8 })
  // Queue remove calls this even for text-only messages; no upload data exists in this fixture.
  Object.defineProperty(ctx, 'fileUploads', { value: { retirePrompt: vi.fn() } })
  const parent = await ctx.agents.create({
    sessionId: SessionId(randomUUID()),
    meta: { cwd: directory },
    agentOptions: { provider: 'must-not-call', model: 'must-not-call' },
  })
  const worker: Worker = {
    id: randomUUID(),
    parentSessionId: parent.agent.id,
    runId: randomUUID(),
    project: directory,
    title: 'Synthetic native Inbox run',
    preference: { cli: 'opencode', model: 'saved-model', effort: 'default' },
    mode: 'accept-edits',
    status: 'running',
    createdAt: '2026-10-16T00:00:00Z',
    updatedAt: '2026-10-16T00:00:00Z',
  }
  const events: WorkerEvent[] = [],
    records: HarnessConversationRecord[] = []
  const listeners = new Set<() => void>()
  const receipts = new Map<string, string>()
  type ControlledRun = {
    done: ReturnType<typeof Promise.withResolvers<Worker>>
    cleanup: ReturnType<typeof Promise.withResolvers<void>>
  }
  const runs = new Map<string, ControlledRun>()
  const newRun = (id: string) => {
    const value = { done: Promise.withResolvers<Worker>(), cleanup: Promise.withResolvers<void>() }
    runs.set(id, value)
    return value
  }
  newRun(worker.runId)
  const append = (event: Omit<WorkerEvent, 'seq' | 'runId' | 'time'>, runId = worker.runId) => {
    events.push({ ...event, seq: events.length, runId, time: worker.updatedAt })
    for (const listener of listeners) listener()
  }
  append({ kind: 'user', text: 'initial admitted task' })
  append({ kind: 'assistant', text: 'initial observed reply', step: 0 })
  let bridge!: HarnessConversationBridge
  const run = vi.fn(async (record: HarnessConversationRecord, prompt: string, requestId: string) => {
    worker.runId = randomUUID()
    worker.status = 'running'
    receipts.set(requestId, prompt)
    const controlled = newRun(worker.runId)
    append({ kind: 'user', text: prompt })
    return { runId: worker.runId, done: controlled.done.promise }
  })
  const stop = vi.fn(async (_record: HarnessConversationRecord, runId: string) => {
    const controlled = runs.get(runId)!
    await controlled.cleanup.promise
    const outcome = { ...worker, runId, status: 'interrupted' as const, interruptionReason: 'user' as const }
    if (worker.runId === runId) Object.assign(worker, outcome)
    controlled.done.resolve(outcome)
  })
  let steeringState = initialSteering
  const steer = vi.fn(
    async (
      _record: HarnessConversationRecord,
      prompt: string,
      runId: string,
      requestId: string,
      _signal: AbortSignal,
    ) => {
      receipts.set(requestId, prompt)
      append({ kind: 'user', text: prompt, queuedFollowupId: requestId, admittedRunId: runId }, runId)
    },
  )
  const deps: HarnessConversationDependencies = {
    bindings: () => records,
    bind: async (record) => {
      const index = records.findIndex((row) => row.sessionId === record.sessionId)
      if (index < 0) records.push(structuredClone(record))
      else records[index] = structuredClone(record)
    },
    unbind: async () => {},
    getWorker: () => worker,
    busy: () => ['queued', 'running', 'stopping'].includes(worker.status),
    receipt: (_record, prompt, id) => {
      const prior = receipts.get(id)
      if (prior !== undefined && prior !== prompt) throw new Error('Different text for receipt')
      return prior !== undefined
    },
    admitted: (_record, id) => receipts.has(id),
    steering: () => (steeringState === 'ready' && worker.status !== 'running' ? 'pending' : steeringState),
    steer,
    events: (_record, runId, after) => events.filter((event) => event.runId === runId && event.seq > after),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    run,
    stop,
    wait: async (_record, runId) => runs.get(runId)!.done.promise,
  }
  bridge = new HarnessConversationBridge(ctx, deps)
  cleanup.push(async () => {
    for (const [runId, controlled] of runs) {
      controlled.cleanup.resolve()
      controlled.done.resolve({ ...worker, runId, status: 'interrupted', interruptionReason: 'user' })
    }
    await bridge.dispose()
    await ctx.fiber.dispose()
    rmSync(directory, { recursive: true, force: true })
  })
  const binding = await bridge.ensure(parent.agent, worker)
  let child = ctx.agents.get(SessionId(binding.sessionId))!
  const queueController = new SessionCommandController(
    ctx,
    {
      resolveAgent: async (id: string) => ({ agent: ctx.agents.get(id as never) }),
    },
    directory,
  )
  const prompt = async (value: string | UserMessage['content'], delivery: 'queue' | 'steer' = 'queue', requestId = randomUUID()) => {
    await ctx.subagents.prompt(
      {
        requestId: requestId as never,
        parentSessionId: parent.agent.id,
        childSessionId: child.id,
        mode: 'continuable',
        delivery,
        content: typeof value === 'string' ? [{ type: 'text', text: value }] : value,
      },
      new AbortController().signal,
    )
    child = ctx.agents.get(SessionId(binding.sessionId))!
  }
  const complete = (value = 'synthetic completed', runId = worker.runId) => {
    append({ kind: 'assistant', text: value, step: 100 }, runId)
    const outcome = { ...worker, runId, status: 'completed' as const }
    if (worker.runId === runId) Object.assign(worker, outcome)
    runs.get(runId)!.done.resolve(outcome)
  }
  const userTexts = () =>
    child.session
      .deriveMessages()
      // The newer official AgentLoop also projects its own runtime-context as
      // a user-role message. Queue echo assertions concern admitted inputs;
      // classify by the native source stamp, never by text or list position.
      .filter((message) => message.role === 'user' && message.source?.kind !== 'runtime-context')
      .flatMap((message) =>
        message.content.filter((block) => block.type === 'text').map((block) => block.text),
      )
  const mutate = (item: UserMessage, action: unknown) =>
    queueController.updateQueue({ sessionId: child.id, itemId: item.id, action })
  const prepareNativeRun = () =>
    bridge.ensure(parent.agent, worker, {
      projectRun: true,
      nativeSubmissionId: run.mock.calls.at(-1)?.[2],
    })
  await vi.waitFor(() => expect(child.session.log.some((event) => event.type === 'step/start')).toBe(true))
  const restartBridge = async () => {
    await bridge.dispose()
    bridge = new HarnessConversationBridge(ctx, deps)
  }
  return {
    ctx,
    parent: parent.agent,
    get child() {
      return child
    },
    worker,
    binding,
    get bridge() {
      return bridge
    },
    run,
    steer,
    setSteering: (state: typeof steeringState) => {
      steeringState = state
      for (const listener of listeners) listener()
    },
    stop,
    runs,
    append,
    prompt,
    complete,
    userTexts,
    mutate,
    prepareNativeRun,
    events,
    records,
    deps,
    receipts,
    restartBridge,
  }
}

it('keeps uploaded files queued during native steering, forwards references once and deduplicates cold retries', async () => {
  const f = await fixture('ready')
  const requestId = randomUUID()
  const content = [{ type: 'file', attachment: { attachmentId: 'a'.repeat(64), name: 'synthetic-upload.txt', bytes: 4 } }] as unknown as UserMessage['content']
  await f.prompt(content, 'steer', requestId)
  expect(f.child.inbox.nextStep).toHaveLength(1)
  expect(f.steer).not.toHaveBeenCalled()
  f.complete()
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledOnce())
  expect((f.run.mock.calls[0] as unknown[])[4]).toEqual([expect.objectContaining({ content })])
  f.complete()
  await f.child.whenIdle()
  await f.restartBridge()
  await f.prompt(content, 'queue', requestId)
  await f.child.whenIdle()
  expect(f.run).toHaveBeenCalledOnce()
  const changed = structuredClone(content) as any; changed[0].attachment.attachmentId = 'b'.repeat(64)
  await f.prompt(changed, 'queue', requestId)
  await f.child.whenIdle()
  expect(f.run).toHaveBeenCalledOnce()
  expect(f.child.inbox.nextStep).toHaveLength(1)
})

it('keeps native next-turn FIFO, edits and removes pending messages, and never projects an internally started run twice', async () => {
  const f = await fixture()
  await f.prompt('first queued')
  await f.prompt('edit me')
  await f.prompt('remove me')
  const queued = [...f.child.inbox.nextTurn]
  expect(queued).toHaveLength(3)
  await f.mutate(queued[1]!, { kind: 'edit', content: [{ type: 'text', text: 'edited queued' }] })
  await f.mutate(queued[2]!, { kind: 'remove' })
  expect(f.run).not.toHaveBeenCalled()
  expect(f.child.inbox.nextTurn.map((item) => item.id)).toEqual([queued[0]!.id, queued[1]!.id])
  f.complete()
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(1))
  expect(f.run.mock.calls[0]?.[1]).toBe('first queued')
  // Deliberately after deps.run returned: preparation need not fit inside a temporary starting window.
  await f.prepareNativeRun()
  expect(f.child.inbox.nextTurn.map((item) => item.id)).toEqual([queued[1]!.id])
  f.complete('first answer')
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(2))
  expect(f.run.mock.calls[1]?.[1]).toBe('edited queued')
  await f.prepareNativeRun()
  f.complete('second answer')
  await f.child.whenIdle()
  expect(f.run).toHaveBeenCalledTimes(2)
  expect(f.userTexts()).toEqual(['initial admitted task', 'first queued', 'edited queued'])
  expect(f.child.inbox.nextTurn).toHaveLength(0)
  expect(f.child.session.header).toMatchObject({ origin: 'subagent', parentSession: f.parent.id })
  expect(f.parent.session.log.filter((event) => event.type === 'turn/start')).toHaveLength(0)
})

it('retains editable next-step messages across display rows and executes their stable batch only after the CLI boundary', async () => {
  const f = await fixture()
  await f.prompt('first next-step', 'steer')
  await f.prompt('remove next-step', 'steer')
  const original = [...f.child.inbox.nextStep].filter((message) => message.source.kind === 'user')
  expect(original).toHaveLength(2)
  for (let step = 1; step <= 3; step++) {
    f.append({ kind: 'assistant', text: `observed row ${step}`, step })
    await vi.waitFor(() =>
      expect(f.child.session.log.filter((event) => event.type === 'step/start').length).toBeGreaterThan(step),
    )
    expect(
      f.child.inbox.nextStep.filter((message) => message.source.kind === 'user').map((message) => message.id),
    ).toEqual(original.map((message) => message.id))
    expect(f.run).not.toHaveBeenCalled()
    expect(f.userTexts()).toEqual(['initial admitted task'])
  }
  await f.mutate(original[0]!, { kind: 'edit', content: [{ type: 'text', text: 'edited next-step' }] })
  await f.mutate(original[1]!, { kind: 'remove' })
  await f.prompt('second next-step', 'steer')
  const expected = [...f.child.inbox.nextStep].filter((message) => message.source.kind === 'user')
  const id = harnessBatchSubmissionId(expected)
  f.complete()
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(1))
  expect(f.run.mock.calls[0]?.slice(1)).toEqual([
    'edited next-step\n\nsecond next-step',
    id,
    expect.any(AbortSignal),
  ])
  await f.prepareNativeRun()
  f.complete('batch result')
  await f.child.whenIdle()
  expect(f.userTexts()).toEqual(['initial admitted task', 'edited next-step', 'second next-step'])
  expect(f.run).toHaveBeenCalledTimes(1)
  expect(f.stop).not.toHaveBeenCalled()
  expect(f.child.session.log.filter((event) => event.type === 'turn/start')).toHaveLength(1)
})

it('waits for real cancellation cleanup, preserves queued work, and resumes it only when native input wakes the child', async () => {
  const f = await fixture()
  const initialRun = f.worker.runId
  f.append({
    kind: 'tool',
    text: 'synthetic_pending_tool',
    step: 1,
    state: 'RUNNING',
    toolCall: { name: 'synthetic_pending_tool', callId: 'pending-tool', input: { synthetic: true } },
  })
  await vi.waitFor(() => expect(f.child.session.log.some((event) => event.type === 'tool/call')).toBe(true))
  await f.prompt('kept queued')
  const pending = f.child.inbox.nextTurn[0]!
  const receipt = f.ctx.subagents.interruptByParent(f.child.id, f.parent.id, 'continuable')
  expect(receipt).toBeDefined()
  await vi.waitFor(() => expect(f.stop).toHaveBeenCalledTimes(1))
  expect(f.child.status).toBe('running')
  expect(f.run).not.toHaveBeenCalled()
  expect(f.child.inbox.nextTurn.map((message) => message.id)).toEqual([pending.id])
  f.runs.get(initialRun)!.cleanup.resolve()
  await f.child.whenIdle()
  expect(f.child.status).toBe('idle')
  expect(f.run).not.toHaveBeenCalled()
  expect(f.child.inbox.nextTurn.map((message) => message.id)).toEqual([pending.id])
  expect(f.child.session.log.filter((event) => event.type === 'turn/end').at(-1)?.data.reason).toMatchObject({
    kind: 'aborted',
    reason: { kind: 'user' },
  })
  expect(f.child.session.log.filter((event) => event.type === 'tool/result')).toHaveLength(1)
  const cold = Session.create(
    f.child.id,
    JSON.parse(JSON.stringify(f.child.session.log)),
    f.child.session.header,
  )
  expect(cold.deriveMessages().filter((message) => message.role === 'tool')).toHaveLength(1)
  await f.prompt('explicit new input')
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(1))
  expect(f.run.mock.calls[0]?.[1]).toBe('kept queued')
  f.complete()
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(2))
  expect(f.run.mock.calls[1]?.[1]).toBe('explicit new input')
  f.complete()
  await f.child.whenIdle()
  expect(f.userTexts()).toEqual(['initial admitted task', 'kept queued', 'explicit new input'])
  expect(f.stop).toHaveBeenCalledTimes(1)
})

it('deduplicates an actual browser request without treating same-text distinct requests as duplicates', async () => {
  const f = await fixture()
  const requestId = randomUUID()
  await f.prompt('repeat', 'queue', requestId)
  await f.prompt('repeat', 'queue', requestId)
  await f.prompt('repeat')
  f.complete()
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(1))
  f.complete()
  // Duplicate no-op settles normally, so the real FIFO advances without an extra wake.
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(2))
  expect(f.run.mock.calls[1]?.[1]).toBe('repeat')
  f.complete()
  await f.child.whenIdle()
  expect(f.child.inbox.nextTurn).toHaveLength(0)
  expect(f.run).toHaveBeenCalledTimes(2)
  expect(f.userTexts()).toEqual(['initial admitted task', 'repeat', 'repeat'])
})

it('remembers each accepted input after a cold bridge restart, including individual retries of an earlier batch', async () => {
  const f = await fixture()
  const first = randomUUID(),
    second = randomUUID()
  await f.prompt('batch first', 'steer', first)
  await f.prompt('batch second', 'steer', second)
  f.complete()
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(1))
  const batchId = f.run.mock.calls[0]![2]
  f.complete()
  await f.child.whenIdle()
  expect(f.records[0]!.nativeInputs).toEqual([
    expect.objectContaining({ requestId: first, batchId, accepted: true }),
    expect.objectContaining({ requestId: second, batchId, accepted: true }),
  ])
  await f.restartBridge()
  await f.prompt('batch first', 'queue', first)
  await f.prompt('batch second', 'queue', second)
  await f.prompt('fresh request')
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(2))
  expect(f.run.mock.calls[1]![1]).toBe('fresh request')
  f.complete()
  await f.child.whenIdle()
  expect(f.userTexts()).toEqual(['initial admitted task', 'batch first', 'batch second', 'fresh request'])
})

it('uses the durable Worker batch receipt when accepted-record persistence failed after admission', async () => {
  const f = await fixture()
  const first = randomUUID(),
    second = randomUUID()
  const bind = f.deps.bind
  let failAcceptedSave = true
  vi.spyOn(f.deps, 'bind').mockImplementation(async (record) => {
    if (failAcceptedSave && record.nativeInputs?.some((input) => input.accepted)) {
      failAcceptedSave = false
      throw new Error('Synthetic accepted-receipt disk failure')
    }
    await bind(record)
  })
  await f.prompt('batch first', 'steer', first)
  await f.prompt('batch second', 'steer', second)
  f.complete()
  await vi.waitFor(() => expect(f.stop).toHaveBeenCalledTimes(1))
  expect(f.child.status).toBe('running')
  const batchId = f.run.mock.calls[0]![2]
  expect(f.receipts.get(batchId)).toBe('batch first\n\nbatch second')
  expect(f.records[0]!.nativeInputs).toEqual([
    expect.objectContaining({ requestId: first, batchId, accepted: false }),
    expect.objectContaining({ requestId: second, batchId, accepted: false }),
  ])
  f.runs.get(f.worker.runId)!.cleanup.resolve()
  await f.child.whenIdle()
  expect(f.child.session.log.filter((event) => event.type === 'turn/end').at(-1)?.data.reason.kind).toBe(
    'error',
  )
  await f.restartBridge()
  await f.prompt('batch first', 'queue', first)
  await f.prompt('batch second', 'queue', second)
  await f.prompt('fresh request')
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(2))
  expect(f.run.mock.calls[1]![1]).toBe('fresh request')
  f.complete()
  await f.child.whenIdle()
  expect(f.userTexts()).toEqual(['initial admitted task', 'batch first', 'batch second', 'fresh request'])
})

it('does not mark a saved intent as execution when Worker admission failed', async () => {
  const f = await fixture()
  const requestId = randomUUID()
  f.run.mockRejectedValueOnce(new Error('Synthetic admission failed before Worker receipt'))
  await f.prompt('retry failed admission', 'queue', requestId)
  f.complete()
  await f.child.whenIdle()
  expect(f.run).toHaveBeenCalledTimes(1)
  expect(f.records[0]!.nativeInputs).toEqual([
    expect.objectContaining({ requestId, batchId: requestId, accepted: false }),
  ])
  expect(f.receipts.has(requestId)).toBe(false)
  await f.restartBridge()
  await f.prompt('retry failed admission', 'queue', requestId)
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(2))
  f.complete()
  await f.child.whenIdle()
  expect(f.records[0]!.nativeInputs).toEqual([
    expect.objectContaining({ requestId, batchId: requestId, accepted: true }),
  ])
})

it('reports an unknown receipt without resending or losing the claimed native message', async () => {
  const f = await fixture()
  const requestId = randomUUID()
  f.run.mockRejectedValueOnce(new Error('Synthetic admission uncertainty'))
  await f.prompt('receipt uncertain', 'queue', requestId)
  f.complete()
  await f.child.whenIdle()
  delete f.deps.admitted
  await f.restartBridge()
  await f.prompt('receipt uncertain', 'queue', requestId)
  await f.child.whenIdle()
  expect(f.run).toHaveBeenCalledTimes(1)
  expect(f.child.inbox.nextStep).toHaveLength(1)
  const kept = f.child.inbox.nextStep[0]!
  expect(kept.source).toMatchObject({ rpcId: requestId })
  expect(f.child.session.log.filter((event) => event.type === 'turn/end').at(-1)?.data.reason.kind).toBe(
    'error',
  )
  await f.mutate(kept, { kind: 'remove' })
  expect(f.child.inbox.nextStep).toHaveLength(0)
  await f.prompt('new request after removal')
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(2))
  f.complete()
  await f.child.whenIdle()
})

it('keeps native cancellation running until a late launch receipt and its process cleanup have settled', async () => {
  const f = await fixture()
  const admitted = Promise.withResolvers<void>()
  const launch = f.run.getMockImplementation()!
  f.run.mockImplementationOnce(async (...args) => {
    await admitted.promise
    return launch(...args)
  })
  await f.prompt('delayed launch')
  await f.prompt('kept after cancellation')
  f.complete()
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(1))
  f.ctx.subagents.interruptByParent(f.child.id, f.parent.id, 'continuable')
  expect(f.child.status).toBe('running')
  admitted.resolve()
  await vi.waitFor(() => expect(f.stop).toHaveBeenCalledTimes(1))
  expect(f.child.status).toBe('running')
  expect(f.child.inbox.nextTurn).toHaveLength(1)
  expect(f.run).toHaveBeenCalledTimes(1)
  f.runs.get(f.worker.runId)!.cleanup.resolve()
  await f.child.whenIdle()
  expect(f.child.status).toBe('idle')
  expect(f.run).toHaveBeenCalledTimes(1)
  expect(f.child.inbox.nextTurn).toHaveLength(1)
})

it('waits for the admitted run even when receipt persistence and its stop command both fail', async () => {
  const f = await fixture()
  const bind = f.deps.bind
  vi.spyOn(f.deps, 'bind').mockImplementation(async (record) => {
    if (record.nativeInputs?.some((input) => input.accepted))
      throw new Error('Synthetic receipt write failure')
    await bind(record)
  })
  f.stop.mockRejectedValueOnce(new Error('Synthetic stop-state write failure'))
  await f.prompt('admitted before write error')
  f.complete()
  await vi.waitFor(() => expect(f.stop).toHaveBeenCalledTimes(1))
  expect(f.child.status).toBe('running')
  f.complete('process outcome after failed stop command')
  await f.child.whenIdle()
  expect(f.child.session.log.filter((event) => event.type === 'turn/end').at(-1)?.data.reason.kind).toBe(
    'error',
  )
  expect(f.run).toHaveBeenCalledTimes(1)
})

it('delivers supported native steering to the current run with the original RPC identity and one user echo', async () => {
  const f = await fixture('ready')
  const runId = f.worker.runId,
    requestId = randomUUID()
  const claimed = vi.fn()
  f.child.ctx.on('agent/inbox/claimed', claimed)
  expect(f.binding.reasons?.steer).toContain('原生引导通道')
  expect(f.binding.capabilities).toMatchObject({ model: true, permission: true, plan: true })
  await f.prompt('current-run direction', 'steer', requestId)
  await vi.waitFor(() => expect(f.steer).toHaveBeenCalledTimes(1))
  expect(f.steer.mock.calls[0]?.slice(1)).toEqual([
    'current-run direction',
    runId,
    requestId,
    expect.any(AbortSignal),
  ])
  expect(
    claimed.mock.calls.map(([payload]) => ({
      agentId: payload.agent.id,
      rpcId: payload.message.source.rpcId,
    })),
  ).toContainEqual({ agentId: f.child.id, rpcId: requestId })
  await vi.waitFor(() => expect(f.records[0]!.nativeInputs?.[0]?.accepted).toBe(true))
  await f.prompt('current-run direction', 'steer', requestId)
  await f.prompt('current-run direction', 'steer')
  await vi.waitFor(() => expect(f.steer).toHaveBeenCalledTimes(2))
  await vi.waitFor(() =>
    expect(f.userTexts()).toEqual([
      'initial admitted task',
      'current-run direction',
      'current-run direction',
    ]),
  )
  expect(f.run).not.toHaveBeenCalled()
  expect(f.stop).not.toHaveBeenCalled()
  expect(f.worker.runId).toBe(runId)
  expect(f.child.inbox.nextStep.filter((message) => message.source.kind === 'user')).toHaveLength(0)
  expect(
    f.child.session
      .snapshotEvents()
      .filter((event) => event.type === 'agent/inbox/spliced' && event.data.outcome === 'canceled'),
  ).toHaveLength(0)
  f.complete()
  await f.child.whenIdle()
  expect(f.userTexts()).toEqual(['initial admitted task', 'current-run direction', 'current-run direction'])
  expect(
    f.child.session
      .snapshotEvents()
      .filter(
        (event) =>
          event.type === 'user/message' &&
          'rpcId' in event.data.source &&
          event.data.source.rpcId === requestId,
      ),
  ).toHaveLength(1)
})

it('keeps not-yet-ready native steering editable and removable until the real channel is ready', async () => {
  const f = await fixture('pending')
  const requestId = randomUUID()
  await f.prompt('edit before native admission', 'steer', requestId)
  await f.prompt('remove before native admission', 'steer')
  const messages = f.child.inbox.nextStep.filter((message) => message.source.kind === 'user')
  await f.mutate(messages[0]!, { kind: 'edit', content: [{ type: 'text', text: 'edited native direction' }] })
  await f.mutate(messages[1]!, { kind: 'remove' })
  expect(f.steer).not.toHaveBeenCalled()
  f.setSteering('ready')
  await vi.waitFor(() => expect(f.steer).toHaveBeenCalledTimes(1))
  expect(f.steer.mock.calls[0]?.slice(1, 4)).toEqual(['edited native direction', f.worker.runId, requestId])
  f.complete()
  await f.child.whenIdle()
  expect(f.userTexts()).toEqual(['initial admitted task', 'edited native direction'])
  expect(f.run).not.toHaveBeenCalled()
})

it.each(['STEER_REJECTED', 'STEER_UNKNOWN', 'REMOTE_STEER_UNKNOWN'])(
  'retains the original native message after %s and never retries it as a later run, including cold recovery',
  async (code) => {
    const f = await fixture('ready')
    const requestId = randomUUID()
    f.steer.mockRejectedValueOnce(
      Object.assign(
        new Error(`Synthetic ${code}`),
        code === 'REMOTE_STEER_UNKNOWN'
          ? { code: 'cliworker/unavailable', details: { deliveryUnknown: true } }
          : { code },
      ),
    )
    await f.prompt('keep this original direction', 'steer', requestId)
    await vi.waitFor(() =>
      expect(f.records[0]!.nativeInputs?.[0]?.steeringState).toBe(
        code !== 'STEER_REJECTED' ? 'unknown' : 'rejected',
      ),
    )
    const kept = f.child.inbox.nextStep.find((message) => message.source.kind === 'user')!
    expect(kept.source).toMatchObject({ rpcId: requestId })
    f.append({ kind: 'assistant', text: 'still running after steering failure', step: 1 })
    await vi.waitFor(() =>
      expect(
        f.child.session.snapshotEvents().filter((event) => event.type === 'step/start').length,
      ).toBeGreaterThan(1),
    )
    expect(f.steer).toHaveBeenCalledTimes(1)
    expect(
      f.child.inbox.nextStep.filter((message) => message.source.kind === 'user').map((message) => message.id),
    ).toEqual([kept.id])
    f.complete()
    await f.child.whenIdle()
    expect(f.run).not.toHaveBeenCalled()
    expect(f.userTexts()).toEqual(['initial admitted task'])
    expect(f.child.inbox.nextStep.some((message) => message.id === kept.id)).toBe(true)
    await f.restartBridge()
    // Native manager disposal clears its Inbox; a browser retry still carries
    // the same RPC identity and must not become a new CLI run after restoration.
    await f.prompt('keep this original direction', 'queue', requestId)
    await f.child.whenIdle()
    expect(f.steer).toHaveBeenCalledTimes(1)
    expect(f.run).not.toHaveBeenCalled()
    const retained = [...f.child.inbox.nextStep, ...f.child.inbox.nextTurn].find(
      (message) => 'rpcId' in message.source && message.source.rpcId === requestId,
    )
    expect(retained?.content).toEqual(kept.content)
    await f.mutate(retained!, { kind: 'remove' })
  },
)

it('uses an acknowledged Worker receipt after the native acceptance save fails without a duplicate projection or cold retry', async () => {
  const f = await fixture('ready')
  const requestId = randomUUID(),
    bind = f.deps.bind
  vi.spyOn(f.deps, 'bind').mockImplementation(async (record) => {
    if (record.nativeInputs?.some((input) => input.delivery === 'steer' && input.accepted))
      throw new Error('Synthetic accepted steering record write failure')
    await bind(record)
  })
  await f.prompt('acknowledged direction', 'steer', requestId)
  await vi.waitFor(() => expect(f.receipts.has(requestId)).toBe(true))
  f.complete()
  await f.child.whenIdle()
  expect(f.child.inbox.nextStep.filter((message) => message.source.kind === 'user')).toHaveLength(0)
  expect(f.userTexts()).toEqual(['initial admitted task', 'acknowledged direction'])
  expect(f.records[0]!.nativeInputs?.[0]).toMatchObject({
    requestId,
    accepted: false,
    delivery: 'steer',
    steeringState: 'pending',
  })
  await f.restartBridge()
  await f.prompt('acknowledged direction', 'queue', requestId)
  await f.child.whenIdle()
  expect(f.run).not.toHaveBeenCalled()
  expect(f.steer).toHaveBeenCalledTimes(1)
  expect(f.userTexts()).toEqual(['initial admitted task', 'acknowledged direction'])
})

it('holds the native execution boundary until a current-run steering acknowledgement has settled', async () => {
  const f = await fixture('ready')
  const receipt = Promise.withResolvers<void>(),
    steer = f.steer.getMockImplementation()!
  f.steer.mockImplementationOnce(async (...args) => {
    await receipt.promise
    await steer(...args)
  })
  await f.prompt('late current-run receipt', 'steer')
  await vi.waitFor(() => expect(f.steer).toHaveBeenCalledTimes(1))
  await f.prompt('next native turn')
  f.complete()
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(f.child.status).toBe('running')
  expect(f.run).not.toHaveBeenCalled()
  receipt.resolve()
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(1))
  expect(f.run.mock.calls[0]?.[1]).toBe('next native turn')
  f.complete()
  await f.child.whenIdle()
  expect(f.userTexts()).toEqual(['initial admitted task', 'late current-run receipt', 'next native turn'])
})

it('waits for canceled steering restoration after CLI cleanup and preserves it under native stop keepInbox', async () => {
  const f = await fixture('ready')
  const release = Promise.withResolvers<void>(),
    initialRun = f.worker.runId
  f.steer.mockImplementationOnce(async (_record, _prompt, _runId, _requestId, signal) => {
    await release.promise
    expect(signal.aborted).toBe(true)
    throw Object.assign(new Error('Synthetic acknowledgment lost on stop'), { code: 'STEER_UNKNOWN' })
  })
  await f.prompt('unconfirmed at stop', 'steer')
  await vi.waitFor(() => expect(f.steer).toHaveBeenCalledTimes(1))
  f.ctx.subagents.interruptByParent(f.child.id, f.parent.id, 'continuable')
  f.runs.get(initialRun)!.cleanup.resolve()
  await vi.waitFor(() => expect(f.stop).toHaveBeenCalledTimes(1))
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(f.child.status).toBe('running')
  release.resolve()
  await f.child.whenIdle()
  expect(f.run).not.toHaveBeenCalled()
  expect(f.child.inbox.nextStep.filter((message) => message.source.kind === 'user')).toHaveLength(1)
  expect(f.userTexts()).toEqual(['initial admitted task'])
})

it('does not call the native transport when the steering intent cannot be persisted', async () => {
  const f = await fixture('ready'),
    bind = f.deps.bind
  vi.spyOn(f.deps, 'bind').mockImplementation(async (record) => {
    if (record.nativeInputs?.some((input) => input.delivery === 'steer'))
      throw new Error('Synthetic steering intent disk failure')
    await bind(record)
  })
  await f.prompt('unsent preserved direction', 'steer')
  await vi.waitFor(() =>
    expect(f.child.inbox.nextStep.filter((message) => message.source.kind === 'user')).toHaveLength(1),
  )
  expect(f.steer).not.toHaveBeenCalled()
  expect(f.run).not.toHaveBeenCalled()
  f.complete()
  await f.child.whenIdle()
  expect(f.run).not.toHaveBeenCalled()
})

it('retains just one original message when browser retries arrive before an uncertain native receipt', async () => {
  const f = await fixture('ready'),
    requestId = randomUUID(),
    release = Promise.withResolvers<void>()
  f.steer.mockImplementationOnce(async () => {
    await release.promise
    throw Object.assign(new Error('Synthetic receipt uncertainty'), { code: 'STEER_UNKNOWN' })
  })
  await f.prompt('one native identity', 'steer', requestId)
  await vi.waitFor(() => expect(f.steer).toHaveBeenCalledTimes(1))
  await f.prompt('one native identity', 'steer', requestId)
  expect(f.child.inbox.nextStep.filter((message) => message.source.kind === 'user')).toHaveLength(0)
  release.resolve()
  await vi.waitFor(() =>
    expect(f.child.inbox.nextStep.filter((message) => message.source.kind === 'user')).toHaveLength(1),
  )
  await f.prompt('one native identity', 'steer', requestId)
  expect(f.child.inbox.nextStep.filter((message) => message.source.kind === 'user')).toHaveLength(1)
  f.complete()
  await f.child.whenIdle()
  expect(f.steer).toHaveBeenCalledTimes(1)
  expect(f.run).not.toHaveBeenCalled()
})
