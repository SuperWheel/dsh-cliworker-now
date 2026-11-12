import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  createUserMessage,
  markAgentLoopRequest,
  type GenerateOptions,
  type StreamChunk,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import {
  HarnessConversationBridge,
  HARNESS_CLI_PROVIDER,
  harnessBatchSubmissionId,
  harnessSubmissionId,
} from '../src/host/harness-conversation.ts'
import type {
  HarnessConversationDependencies,
  HarnessConversationRecord,
} from '../src/host/harness-conversation-types.ts'
import type { Worker, WorkerEvent } from '../src/shared/types.ts'

// Simulated official hook/provider boundaries only. No CLI, model or network.
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const collect = async (stream: AsyncIterable<StreamChunk>) => {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}
function fixture(options: { records?: HarnessConversationRecord[]; unresolved?: boolean; activation?: boolean; unsupported?: boolean; worker?: Partial<Worker> } = {}) {
  const parentId = 'parent-synthetic'
  const worker: Worker = {
    id: randomUUID(),
    parentSessionId: parentId,
    project: '/synthetic/project',
    title: 'Synthetic CLI task',
    preference: { cli: 'opencode', model: 'saved-model', effort: 'default' },
    mode: 'accept-edits',
    status: options.unresolved ? 'running' : 'completed',
    createdAt: '2026-10-16T00:00:00Z',
    updatedAt: '2026-10-16T00:00:00Z',
    runId: randomUUID(),
    ...options.worker,
  }
  const records = options.records ?? []
  const events: WorkerEvent[] = []
  const listeners = new Set<() => void>()
  const hooks = new Map<string, (...args: any[]) => any>()
  const registered = new Map<string, unknown>()
  const stopGate = deferred<void>()
  const outcome = deferred<Worker>()
  if (!options.unresolved) outcome.resolve({ ...worker })
  let busy = !!options.unresolved
  let nextSeq = 0
  let child: Agent
  let provider: any
  const append = (event: Omit<WorkerEvent, 'seq' | 'runId' | 'time'>, runId = worker.runId) => {
    events.push({ ...event, seq: nextSeq++, runId, time: worker.updatedAt })
    for (const listener of listeners) listener()
  }
  append({ kind: 'user', text: 'original human prompt' })
  const log: Array<{ type: string; data: any; opts: any; seq: number }> = []
  const turnInbox: UserMessage[] = [],
    stepInbox: UserMessage[] = []
  const remove = vi.fn((id: string) => {
    for (const target of [turnInbox, stepInbox]) {
      const index = target.findIndex((message) => message.id === id)
      if (index >= 0) {
        target.splice(index, 1)
        return true
      }
    }
    return false
  })
  const ctx = {
    get: (name: string): unknown => (name === 'sessionQuery' ? ctx.sessionQuery : undefined),
    on: vi.fn((name: string, listener: (...args: any[]) => any) => {
      hooks.set(name, listener)
      return () => {
        if (hooks.get(name) === listener) hooks.delete(name)
      }
    }),
    agents: {
      currentInitiator: () => undefined,
      get: (id: string) => (child?.id === id ? child : undefined),
    },
    inject: vi.fn(() => ({ dispose: async () => {} })),
    sessionQuery: { observeSession: vi.fn(async () => ({ [Symbol.dispose]: vi.fn() })) },
    llm: {
      registerAdapter: vi.fn((names: string[], adapter: unknown) => {
        for (const name of names) registered.set(name, adapter)
        return () => {
          for (const name of names) registered.delete(name)
        }
      }),
    },
    subagents: {
      registerProvider: vi.fn((value: unknown) => {
        provider = value
        return () => {
          provider = undefined
        }
      }),
      startContinuable: vi.fn(async (spec: any) => {
        await provider.prepareContinuable({
          sessionId: spec.childId,
          parent: spec.request.parent,
          signal: spec.signal,
        })
        child = {
          id: spec.childId,
          status: 'idle',
          cancel: vi.fn(),
          ctx: { get: () => undefined },
          session: {
            header: { origin: 'subagent', parentSession: parentId },
            append: (type: string, data: unknown, opts?: unknown) => {
              const entry = { type, data, opts, seq: log.length }
              log.push(entry)
              return entry
            },
          },
          inbox: {
            nextTurn: turnInbox,
            nextStep: stepInbox,
            remove,
            splice: (target: string, start: number, count: number, messages: UserMessage[]) => {
              const inbox = target === 'next-step' ? stepInbox : turnInbox
              inbox.splice(start, count, ...messages)
              for (const message of messages) hooks.get('agent/inbox/inserted')?.({ agent: child, message })
            },
          },
          inject: (message: UserMessage) => {
            stepInbox.push(message)
            hooks.get('agent/inbox/inserted')?.({ agent: child, message })
          },
        } as unknown as Agent
        const message = createUserMessage({ source: { kind: 'user' }, content: spec.request.prompt })
        turnInbox.push(message)
        hooks.get('agent/inbox/inserted')?.({ agent: child, message })
        return { childId: spec.childId, messageId: message.id }
      }),
      drainContinuableChildren: vi.fn(async () => {}),
      prompt: vi.fn(async (request: any) => {
        const message = createUserMessage({
          source: { kind: 'user', rpcId: request.requestId },
          content: request.content,
        })
        turnInbox.push(message)
        hooks.get('agent/inbox/inserted')?.({ agent: child, message })
        return { messageId: message.id }
      }),
    },
  }
  const deps: HarnessConversationDependencies = {
    bindings: () => records,
    bind: vi.fn(async (record) => {
      const index = records.findIndex((row) => row.sessionId === record.sessionId)
      if (index < 0) records.push({ ...record })
      else records[index] = { ...record }
    }),
    unbind: vi.fn(async (record) => {
      const index = records.findIndex(
        (row) => row.sessionId === record.sessionId && row.workerId === record.workerId,
      )
      if (index >= 0) records.splice(index, 1)
    }),
    replaceBinding: vi.fn(async (previous, next) => {
      const index = records.findIndex(
        (row) =>
          row.sessionId === previous.sessionId &&
          row.workerId === previous.workerId &&
          row.parentSessionId === previous.parentSessionId,
      )
      if (index < 0) throw new Error('stale replacement')
      records[index] = structuredClone(next)
    }),
    getWorker: vi.fn((parent, id) => {
      if (parent !== worker.parentSessionId || id !== worker.id) throw new Error('wrong worker identity')
      return worker
    }),
    busy: () => busy,
    events: (_record, runId, seq) => events.filter((event) => event.runId === runId && event.seq > seq),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    run: vi.fn(async () => ({ runId: worker.runId, done: outcome.promise })),
    wait: vi.fn(async (_record, runId) => {
      const result = await outcome.promise
      return { ...result, runId }
    }),
    stop: vi.fn(async () => {
      await stopGate.promise
    }),
  }
  const activationDispose = vi.fn(async () => {})
  const startActivation = vi.fn(async (spec: any) => ({
    ...await ctx.subagents.startContinuable(spec), result: outcome.promise, dispose: activationDispose,
  }))
  const drainChildren = vi.fn(async () => {})
  if (options.activation) Object.assign(ctx.subagents, { startActivation, drainChildren })
  if (options.unsupported) Object.assign(ctx.subagents, { startContinuable: undefined })
  const bridge = new HarnessConversationBridge(ctx as unknown as Context, deps)
  cleanups.push(async () => {
    stopGate.resolve()
    outcome.resolve({ ...worker, status: 'interrupted' })
    await bridge.dispose()
  })
  const parent = { id: parentId } as Agent
  const ensure = () => bridge.ensure(parent, worker)
  const preStep = async (messages: UserMessage[], step = 1, signal = new AbortController().signal) =>
    hooks.get('agent/pre-step')!({ agent: child, messages, turn: 1, step, signal }, async () => ({
      kind: 'enter',
      messages,
    }))
  const request = async (step = 1, signal = new AbortController().signal) => {
    const config = await hooks.get('agent/request')!({ agent: child, turn: 1, step, signal }, async () => ({
      provider: 'dsh',
      model: 'must-not-call',
      reasoningEffort: 'inherited',
    }))
    const options = markAgentLoopRequest({
      ...config,
      messages: [],
      sessionId: child.id,
      signal,
    }) as GenerateOptions
    return hooks.get('llm/stream')!(options, async function* () {
      throw new Error('DSH fallback must not run')
    }) as AsyncIterable<StreamChunk>
  }
  const insert = (body: string, target = turnInbox) => {
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: body }] })
    target.push(message)
    hooks.get('agent/inbox/inserted')!({ agent: child, message })
    return message
  }
  return {
    bridge,
    startActivation, activationDispose, drainChildren,
    deps,
    ctx,
    hooks,
    worker,
    parent,
    records,
    events,
    append,
    log,
    listeners,
    registered,
    remove,
    stopGate,
    outcome,
    ensure,
    preStep,
    request,
    insert,
    turnInbox,
    stepInbox,
    get child() {
      return child
    },
    setBusy(value: boolean) {
      busy = value
    },
    forgetChild() {
      child = undefined as unknown as Agent
    },
  }
}

describe('native CLI conversation admission', () => {
  it('uses explicit caller delivery, binds once and disposes the exact activation once', async () => {
    const f = fixture({ activation: true })
    const binding = await f.ensure()
    expect((await f.ensure()).sessionId).toBe(binding.sessionId)
    expect(f.startActivation).toHaveBeenCalledTimes(1)
    expect(f.startActivation.mock.calls[0][0]).toMatchObject({ delivery: 'caller', childId: binding.sessionId })
    expect(f.deps.bind).toHaveBeenCalledTimes(1)
    await f.preStep([f.turnInbox.shift()!]); await collect(await f.request())
    expect(f.deps.run).not.toHaveBeenCalled()
    const get = f.ctx.agents.get
    f.ctx.agents.get = id => id === f.parent.id ? f.parent : get(id)
    await f.bridge.dispose(); await f.bridge.dispose()
    expect(f.activationDispose).toHaveBeenCalledTimes(1)
    expect(f.drainChildren).toHaveBeenCalledTimes(1)
  })
  it('releases its activation when the parent Agent has already unloaded', async () => {
    const f = fixture({ activation: true })
    await f.ensure()
    await f.bridge.dispose()
    expect(f.activationDispose).toHaveBeenCalledTimes(1)
    expect(f.drainChildren).not.toHaveBeenCalled()
  })
  it('fails explicitly when neither supported lifecycle contract is present', () => {
    expect(() => fixture({ unsupported: true })).toThrow('缺少 CLI 子会话所需的生命周期接口')
  })

  it('repairs only an explicitly addressed corrupt idle display without launching or replaying a CLI task', async () => {
    const f = fixture()
    const old = await f.ensure()
    await f.preStep([f.turnInbox.shift()!])
    await collect(await f.request())
    f.forgetChild()
    await expect(f.bridge.repairDisplay(f.parent, f.worker, old.sessionId)).rejects.toThrow('无需修复')
    expect(f.ctx.subagents.startContinuable).toHaveBeenCalledTimes(1)
    await expect(f.bridge.repairDisplay(f.parent, f.worker, 'stale-binding')).rejects.toThrow('归属已变化')
    f.setBusy(true)
    await expect(f.bridge.repairDisplay(f.parent, f.worker, old.sessionId)).rejects.toThrow('清理结束')
    f.setBusy(false)
    f.ctx.sessionQuery.observeSession.mockRejectedValueOnce(
      Object.assign(new Error('io denied'), { code: 'SESSION_QUERY_PERSISTENCE_FAILED' }),
    )
    await expect(f.bridge.repairDisplay(f.parent, f.worker, old.sessionId)).rejects.toThrow('io denied')
    f.ctx.sessionQuery.observeSession.mockRejectedValueOnce(
      Object.assign(new Error('synthetic corrupt v4'), { code: 'SESSION_QUERY_CORRUPT_SESSION' }),
    )
    const binding = await f.bridge.repairDisplay(f.parent, f.worker, old.sessionId)
    expect(binding.sessionId).not.toBe(old.sessionId)
    expect(f.records[0]?.retiredSessionIds).toEqual([old.sessionId])
    await f.preStep([f.turnInbox.shift()!])
    await collect(await f.request())
    expect(f.deps.run).not.toHaveBeenCalled()
    expect(f.worker.runId).toBe(f.records[0]?.initialRunId)
  })
  it('replaces only an officially non-resumable owned display and retains old log references without replay', async () => {
    const f = fixture()
    const old = await f.ensure()
    await f.preStep([f.turnInbox.shift()!])
    await collect(await f.request())
    f.forgetChild()
    f.worker.runId = randomUUID()
    f.append({ kind: 'user', text: 'new explicitly admitted input' })
    vi.mocked(f.ctx.subagents.prompt).mockRejectedValueOnce(
      Object.assign(new Error('unreadable stored projection'), { code: 'subagent/not-resumable' }),
    )
    const next = await f.bridge.ensure(f.parent, f.worker, { projectRun: true })
    expect(next.sessionId).not.toBe(old.sessionId)
    expect(f.records).toHaveLength(1)
    expect(f.records[0]?.retiredSessionIds).toEqual([old.sessionId])
    expect(f.records[0]?.initialRunId).toBe(f.worker.runId)
    expect((await f.preStep([f.turnInbox.shift()!], 2)).messages[0].content).toEqual([
      { type: 'text', text: 'new explicitly admitted input' },
    ])
    await collect(await f.request(2))
    expect(f.deps.run).not.toHaveBeenCalled()
    expect(f.ctx.subagents.startContinuable).toHaveBeenCalledTimes(2)
    const fallback = vi.fn(async function* () {
      yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
    })
    await expect(
      collect(
        f.hooks.get('llm/stream')!(
          { sessionId: old.sessionId, provider: 'ordinary-dsh', model: 'must-not-call' },
          fallback,
        ),
      ),
    ).rejects.toThrow('禁止 DSH 模型回退')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('does not replace on other prompt failures and rolls back a rejected replacement publication', async () => {
    const f = fixture()
    const old = await f.ensure()
    await f.preStep([f.turnInbox.shift()!])
    await collect(await f.request())
    f.forgetChild()
    f.worker.runId = randomUUID()
    vi.mocked(f.ctx.subagents.prompt).mockRejectedValueOnce(
      Object.assign(new Error('permission unavailable'), { code: 'subagent/unauthorized' }),
    )
    await expect(f.bridge.ensure(f.parent, f.worker, { projectRun: true })).rejects.toThrow(
      'permission unavailable',
    )
    expect(f.ctx.subagents.startContinuable).toHaveBeenCalledTimes(1)
    vi.mocked(f.ctx.subagents.prompt).mockRejectedValueOnce(
      Object.assign(new Error('invalid projection'), { code: 'subagent/not-resumable' }),
    )
    const start = f.ctx.subagents.startContinuable.getMockImplementation()!
    f.ctx.subagents.startContinuable.mockImplementationOnce(async (spec) => {
      await start(spec)
      throw new Error('synthetic publication failure')
    })
    await expect(f.bridge.ensure(f.parent, f.worker, { projectRun: true })).rejects.toThrow(
      'synthetic publication failure',
    )
    expect(f.records[0]?.sessionId).toBe(old.sessionId)
    expect(f.records[0]?.retiredSessionIds).toHaveLength(1)
    expect(f.records[0]?.retiredSessionIds?.[0]).not.toBe(old.sessionId)
    expect(f.deps.run).not.toHaveBeenCalled()
  })
  it('recognizes the creation marker before official adjacent-Agent return guidance', async () => {
    const f = fixture()
    await f.ensure()
    const initial = f.turnInbox.shift()!
    const withGuidance = {
      ...initial,
      content: [
        ...initial.content,
        {
          type: 'text' as const,
          text: 'Your parent agent id is synthetic. Before you finish, send_message...',
        },
      ],
    }
    const decision = await f.preStep([withGuidance])
    expect(decision.kind).toBe('enter')
    expect(decision.messages[0].content).toEqual([{ type: 'text', text: 'original human prompt' }])
    await collect(await f.request())
    expect(f.deps.run).not.toHaveBeenCalled()
  })

  it('waits for normal queue spawn admission before projecting its user bubble and never launches again', async () => {
    const f = fixture()
    await f.ensure()
    await f.preStep([f.turnInbox.shift()!])
    await collect(await f.request())
    const nextRun = randomUUID()
    f.worker.runId = nextRun
    f.worker.status = 'queued'
    f.setBusy(true)
    const done = deferred<Worker>()
    vi.mocked(f.deps.wait).mockImplementation(async (_record, runId) => {
      expect(runId).toBe(nextRun)
      return done.promise
    })
    await f.bridge.ensure(f.parent, f.worker, { projectRun: true })
    const pending = f.turnInbox.shift()!
    let entered = false
    const decision = f.preStep([pending], 2).then((value) => {
      entered = true
      return value
    })
    await Promise.resolve()
    expect(entered).toBe(false)
    f.append({ kind: 'user', text: 'queued original input' })
    f.append({ kind: 'assistant', text: 'queued response', step: 0 })
    done.resolve({ ...f.worker, status: 'completed' })
    expect((await decision).messages[0].content).toEqual([{ type: 'text', text: 'queued original input' }])
    expect(await collect(await f.request(2))).toContainEqual({
      type: 'text-delta',
      index: 0,
      text: 'queued response',
    })
    expect(f.deps.run).not.toHaveBeenCalled()
    await f.bridge.ensure(f.parent, f.worker, { projectRun: true })
    expect(f.ctx.subagents.prompt).toHaveBeenCalledTimes(1)
  })
  it('creates one real-provider child, attaches the first run and never resubmits its prompt', async () => {
    const f = fixture()
    f.append({ kind: 'assistant', text: 'already executed', step: 0 })
    const [binding, same] = await Promise.all([f.ensure(), f.ensure()])
    expect(binding).toEqual(same)
    expect(binding.sessionId).not.toBe(f.worker.id)
    expect(binding.capabilities).toMatchObject({ send: true, queue: true, steer: true, stop: true })
    expect(binding.reasons?.steer).toContain('下一执行步骤')
    expect(binding.reasons?.send).toBeUndefined()
    expect(f.ctx.subagents.startContinuable).toHaveBeenCalledTimes(1)
    const message = f.turnInbox.shift()!
    const entered = await f.preStep([message])
    expect(entered.messages[0].content).toEqual([{ type: 'text', text: 'original human prompt' }])
    expect(f.records[0]?.initialPending).toBe(false)
    const chunks = await collect(await f.request())
    expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: 'already executed' })
    expect(f.deps.run).not.toHaveBeenCalled()
    expect(f.deps.wait).toHaveBeenCalledTimes(1)
    await f.ensure()
    expect(f.ctx.subagents.startContinuable).toHaveBeenCalledTimes(1)
    expect(f.listeners.size).toBe(0)
  })

  it('keeps real text/tool/text order using one run and passive tool history', async () => {
    const f = fixture()
    f.append({ kind: 'assistant', text: 'before ', step: 0 })
    f.append({
      kind: 'tool',
      text: 'read_file',
      step: 1,
      state: 'RUNNING',
      toolCall: { callId: 'real-call', name: 'read_file', input: { path: 'file' } },
    })
    f.append({
      kind: 'tool',
      text: 'read_file',
      step: 1,
      state: 'COMPLETED',
      toolCall: { output: 'actual output' },
    })
    f.append({ kind: 'assistant', text: 'after', step: 2 })
    f.append({ kind: 'result', text: 'before after', resultScope: 'run', state: 'SUCCESS' })
    await f.ensure()
    await f.preStep([f.turnInbox.shift()!])
    const first = await collect(await f.request(1))
    expect(first).toContainEqual({ type: 'text-delta', index: 0, text: 'before ' })
    expect(f.log).toHaveLength(0)
    expect((await f.preStep(f.stepInbox.splice(0), 2)).messages).toHaveLength(1)
    const second = await collect(await f.request(2))
    expect(second.some((chunk) => chunk.type === 'tool-call-delta')).toBe(false)
    expect(f.log.map((event) => event.type)).toEqual(['assistant/message', 'tool/call', 'tool/result'])
    expect(f.log[2]?.opts.sourceEventSeqs).toEqual([1])
    expect(f.log[2]?.data.message.content).toEqual([{ type: 'text', text: 'actual output' }])
    await f.preStep(f.stepInbox.splice(0), 3)
    expect(await collect(await f.request(3))).toContainEqual({ type: 'text-delta', index: 0, text: 'after' })
    expect(f.deps.wait).toHaveBeenCalledTimes(1)
    expect(f.deps.run).not.toHaveBeenCalled()
  })

  it('admits an idle continuation through the existing runner once and preserves same-text distinct IDs', async () => {
    const f = fixture()
    await f.ensure()
    await f.preStep([f.turnInbox.shift()!])
    await collect(await f.request())
    for (let step = 2; step <= 3; step++) {
      const message = f.insert('same text')
      f.turnInbox.splice(0)
      expect((await f.preStep([message], step)).kind).toBe('enter')
      await collect(await f.request(step))
    }
    expect(f.deps.run).toHaveBeenCalledTimes(2)
    expect(vi.mocked(f.deps.run).mock.calls.map((call) => call[2])[0]).not.toBe(
      vi.mocked(f.deps.run).mock.calls.map((call) => call[2])[1],
    )
  })

  it('keeps busy native input in its official inbox and consumes it at the next execution boundary', async () => {
    const f = fixture()
    await f.ensure()
    await f.preStep([f.turnInbox.shift()!])
    await collect(await f.request())
    f.setBusy(true)
    const queued = f.insert('busy input')
    f.setBusy(false)
    expect(f.turnInbox).toContain(queued)
    expect((await f.preStep([queued], 2)).kind).toBe('enter')
    await collect(await f.request(2))
    const steering = f.insert('native steer', f.stepInbox)
    expect((await f.preStep([steering], 3)).kind).toBe('enter')
    await collect(await f.request(3))
    expect(f.remove).not.toHaveBeenCalled()
    expect(f.deps.run).toHaveBeenCalledTimes(2)
  })

  it('deduplicates an ordered native batch while preserving distinct user messages', async () => {
    const f = fixture()
    await f.ensure()
    await f.preStep([f.turnInbox.shift()!])
    await collect(await f.request())
    const first = f.insert('first'),
      second = f.insert('second')
    const decision = await f.preStep([first, second], 2)
    expect(decision.messages).toEqual([first, second])
    await collect(await f.request(2))
    expect(vi.mocked(f.deps.run).mock.calls[0]?.slice(1, 3)).toEqual([
      'first\n\nsecond',
      harnessBatchSubmissionId([first, second]),
    ])
    expect(harnessBatchSubmissionId([first, second])).not.toBe(harnessBatchSubmissionId([second, first]))
    expect((await f.preStep([first, second], 3)).messages).toMatchObject([
      { source: { kind: 'cliworker-continuation' } },
    ])
    await collect(await f.request(3))
    expect(f.deps.run).toHaveBeenCalledTimes(1)
  })

  it('suppresses only an owned child settlement and its empty idle-parent wake', async () => {
    const f = fixture()
    await f.ensure()
    const remove = vi.fn()
    const parent = { id: f.parent.id, status: 'idle', inbox: { remove } } as unknown as Agent
    const settlement = (senderSessionId: string) =>
      createUserMessage({
        source: {
          kind: 'subagent-settled',
          form: 'notice',
          summary: 'Synthetic settlement',
          senderSessionId: senderSessionId as Agent['id'],
        },
        content: [{ type: 'text', text: 'synthetic child completed' }],
      })
    const owned = settlement(f.child.id)
    f.hooks.get('agent/inbox/inserted')!({ agent: parent, message: owned })
    expect(remove).toHaveBeenCalledWith(owned.id)
    const next = vi.fn(async () => ({ kind: 'enter', messages: [] }))
    const preStep = (messages: UserMessage[]) =>
      f.hooks.get('agent/pre-step')!(
        { agent: parent, messages, turn: 1, step: 1, signal: new AbortController().signal },
        next,
      )
    expect(await preStep([])).toEqual({ kind: 'reject' })
    expect(next).not.toHaveBeenCalled()

    f.hooks.get('agent/inbox/inserted')!({ agent: parent, message: settlement(f.child.id) })
    const human = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'human' }] })
    await preStep([human])
    expect(next).toHaveBeenCalledTimes(1)
    const unrelated = settlement(randomUUID())
    f.hooks.get('agent/inbox/inserted')!({ agent: parent, message: unrelated })
    expect(remove).not.toHaveBeenCalledWith(unrelated.id)
    const wrongParentRemove = vi.fn()
    const wrongParent = { id: 'other-parent', status: 'idle', inbox: { remove: wrongParentRemove } }
    f.hooks.get('agent/inbox/inserted')!({ agent: wrongParent, message: owned })
    expect(wrongParentRemove).not.toHaveBeenCalled()
  })

  it('uses the durable browser request identity and settles a retry without adding native user history', async () => {
    const f = fixture()
    await f.ensure()
    await f.preStep([f.turnInbox.shift()!])
    await collect(await f.request())
    const rpcId = 'opaque-synthetic-request'
    const make = () =>
      createUserMessage({ source: { kind: 'user', rpcId }, content: [{ type: 'text', text: 'retry' }] })
    const first = make(),
      retry = make()
    expect(first.id).not.toBe(retry.id)
    expect(harnessSubmissionId(first)).toBe(harnessSubmissionId(retry))
    f.deps.receipt = vi.fn((_record, prompt, id) => prompt === 'retry' && id === harnessSubmissionId(first))
    f.turnInbox.push(retry)
    f.hooks.get('agent/inbox/inserted')!({ agent: f.child, message: retry })
    expect(f.remove).not.toHaveBeenCalledWith(retry.id)
    expect((await f.preStep([retry], 2)).messages).toMatchObject([
      { source: { kind: 'cliworker-continuation' } },
    ])
    await collect(await f.request(2))
    expect(f.deps.run).not.toHaveBeenCalled()
  })

  it('refuses cross-parent binding and a replay without newly admitted input', async () => {
    const f = fixture()
    await expect(f.bridge.ensure({ id: 'other-parent' } as Agent, f.worker)).rejects.toThrow('跨父会话')
    await f.ensure()
    await f.preStep([f.turnInbox.shift()!])
    await collect(await f.request())
    await expect(collect(await f.request(2))).rejects.toThrow('没有已授权输入')
    expect(f.deps.run).not.toHaveBeenCalled()
  })

  it('does not regenerate or create another child when restoring a durable binding', async () => {
    const f = fixture()
    const binding = await f.ensure()
    const restoredRecords = f.records.map((record) => ({ ...record, initialPending: false }))
    await f.bridge.dispose()
    const ctx = f.ctx as unknown as Context
    const restored = new HarnessConversationBridge(ctx, { ...f.deps, bindings: () => restoredRecords })
    cleanups.push(() => restored.dispose())
    expect(await restored.ensure(f.parent, f.worker)).toEqual(binding)
    expect(f.ctx.subagents.startContinuable).toHaveBeenCalledTimes(1)
    expect(f.deps.run).not.toHaveBeenCalled()
    expect(f.deps.wait).not.toHaveBeenCalled()
  })

  it('rolls back the exact binding when official child publication fails', async () => {
    const f = fixture()
    const original = f.ctx.subagents.startContinuable.getMockImplementation()!
    f.ctx.subagents.startContinuable.mockImplementationOnce(async (spec: any) => {
      await original(spec)
      throw new Error('synthetic publication failure')
    })
    await expect(f.ensure()).rejects.toThrow('synthetic publication failure')
    expect(f.ctx.subagents.drainContinuableChildren).toHaveBeenCalledTimes(1)
    expect(f.deps.unbind).toHaveBeenCalledTimes(1)
    expect(f.records).toHaveLength(0)
    expect(f.deps.run).not.toHaveBeenCalled()
  })

  it('cancels an in-flight creation and drains its rollback before bridge disposal returns', async () => {
    const f = fixture()
    const bindGate = deferred<void>()
    const original = vi.mocked(f.deps.bind).getMockImplementation()!
    vi.mocked(f.deps.bind).mockImplementationOnce(async (record) => {
      await bindGate.promise
      await original(record)
    })
    const creating = expect(f.ensure()).rejects.toThrow('桥已关闭')
    let disposed = false
    const closing = f.bridge.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)
    bindGate.resolve()
    await creating
    await closing
    expect(f.records).toHaveLength(0)
    expect(f.hooks.size).toBe(0)
  })
})

describe('native CLI model and lifetime isolation', () => {
  it('blocks auxiliary, unmarked and missing-binding virtual routes while ordinary DSH calls pass', async () => {
    const f = fixture()
    const binding = await f.ensure()
    const next = vi.fn(async function* () {
      yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
    })
    const stream = f.hooks.get('llm/stream')!
    await expect(
      collect(
        stream(
          {
            provider: 'real-dsh',
            model: 'model',
            sessionId: binding.sessionId,
            purpose: 'session-title',
            messages: [],
          },
          next,
        ),
      ),
    ).rejects.toThrow('辅助生成')
    await expect(
      collect(stream({ provider: HARNESS_CLI_PROVIDER, model: 'missing', messages: [] }, next)),
    ).rejects.toThrow('路由缺失')
    await expect(
      collect(
        stream(
          { provider: HARNESS_CLI_PROVIDER, model: 'missing', sessionId: binding.sessionId, messages: [] },
          next,
        ),
      ),
    ).rejects.toThrow('辅助生成')
    expect(next).not.toHaveBeenCalled()
    expect(await collect(stream({ provider: 'ordinary', model: 'model', messages: [] }, next))).toHaveLength(
      1,
    )
    expect(next).toHaveBeenCalledTimes(1)
    const adapter = f.registered.get(HARNESS_CLI_PROVIDER) as any
    await expect(collect(adapter.stream())).rejects.toThrow('禁止模型回退')
  })

  it('routes metadata without guessed capacity or inherited DSH effort', async () => {
    const f = fixture()
    await f.ensure()
    const adapter = f.registered.get(HARNESS_CLI_PROVIDER) as any
    const model = `worker/${f.worker.id}`
    // A bound child is resolvable, but must never advertise its internal model
    // as a main-conversation GUI choice in the global provider catalog.
    expect(await adapter.listModels(HARNESS_CLI_PROVIDER)).toEqual([])
    expect(await adapter.resolveModel(HARNESS_CLI_PROVIDER, model)).toMatchObject({
      provider: HARNESS_CLI_PROVIDER,
      id: model,
      name: 'opencode · saved-model',
      inputModalities: ['text'],
    })
    expect(await adapter.resolveModel(HARNESS_CLI_PROVIDER, model)).not.toHaveProperty('context')
    // The hidden router accepts images for protocol/path conversion. This is
    // its input contract, not a vision claim for the user's selected CLI model.
    f.worker.transport = 'opencode-http-v1'
    expect(await adapter.resolveModel(HARNESS_CLI_PROVIDER, model)).toHaveProperty('inputModalities', ['text', 'image'])
    f.worker.transport = 'legacy'
    expect(await adapter.resolveModel(HARNESS_CLI_PROVIDER, model)).toHaveProperty('inputModalities', ['text'])
    await expect(adapter.resolveModel(HARNESS_CLI_PROVIDER, 'other')).rejects.toThrow('选型缺失')
    await expect(adapter.resolveModel('ordinary-provider', model)).rejects.toThrow('选型缺失')
    const config = await f.hooks.get('agent/request')!(
      { agent: f.child, turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ provider: 'old', model: 'old', maxTokens: 99, reasoningEffort: 'old' }),
    )
    expect(config).toEqual({ provider: HARNESS_CLI_PROVIDER, model: `worker/${f.worker.id}` })
    vi.mocked(f.deps.getWorker).mockImplementation(() => {
      throw new Error('worker removed')
    })
    expect(await adapter.listModels(HARNESS_CLI_PROVIDER)).toEqual([])
    await expect(adapter.resolveModel(HARNESS_CLI_PROVIDER, model)).rejects.toThrow('选型缺失')
  })

  it('does not call Stop when the official consumer closes immediately after terminal finish', async () => {
    const f = fixture()
    f.append({ kind: 'assistant', text: 'completed', step: 0 })
    await f.ensure()
    await f.preStep([f.turnInbox.shift()!])
    const iterator = (await f.request())[Symbol.asyncIterator]()
    while (true) {
      const next = await iterator.next()
      if (next.done || next.value.type === 'finish') break
    }
    await iterator.return?.()
    expect(f.deps.stop).not.toHaveBeenCalled()
    expect(f.listeners.size).toBe(0)
  })

  it('awaits owned cleanup and frozen outcome on native cancellation before releasing subscriptions', async () => {
    const f = fixture({ unresolved: true })
    f.append({ kind: 'assistant', text: 'partial', step: 0 })
    await f.ensure()
    const controller = new AbortController()
    await f.preStep([f.turnInbox.shift()!], 1, controller.signal)
    const iterator = (await f.request(1, controller.signal))[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toMatchObject({ type: 'block-start' })
    expect((await iterator.next()).value).toMatchObject({ type: 'text-delta', text: 'partial' })
    let settled = false
    const waiting = iterator.next().finally(() => {
      settled = true
    })
    controller.abort(new Error('synthetic native cancellation'))
    await vi.waitFor(() => expect(f.deps.stop).toHaveBeenCalledTimes(1))
    expect(settled).toBe(false)
    f.stopGate.resolve()
    f.outcome.resolve({ ...f.worker, status: 'interrupted' })
    await expect(waiting).rejects.toThrow('synthetic native cancellation')
    expect(f.listeners.size).toBe(0)
  })

  it('dispose drains only its owned active run and unregisters its hooks and adapter', async () => {
    const f = fixture({ unresolved: true })
    await f.ensure()
    await f.preStep([f.turnInbox.shift()!])
    const iterator = (await f.request())[Symbol.asyncIterator]()
    const waiting = iterator.next()
    let disposed = false
    const closing = f.bridge.dispose().then(() => {
      disposed = true
    })
    await vi.waitFor(() => expect(f.deps.stop).toHaveBeenCalledTimes(1))
    expect(disposed).toBe(false)
    f.outcome.resolve({ ...f.worker, status: 'interrupted' })
    f.stopGate.resolve()
    await closing
    await waiting
    expect(f.hooks.size).toBe(0)
    expect(f.registered.size).toBe(0)
    expect(f.listeners.size).toBe(0)
  })

  it('keeps cancellation ownership between native projection steps', async () => {
    const f = fixture({ unresolved: true })
    f.append({ kind: 'assistant', text: 'before tool', step: 0 })
    f.append({ kind: 'tool', text: 'read', step: 1, state: 'COMPLETED', toolCall: { output: 'observed' } })
    await f.ensure()
    const controller = new AbortController()
    await f.preStep([f.turnInbox.shift()!], 1, controller.signal)
    const first = await collect(await f.request(1, controller.signal))
    expect(first).toContainEqual({ type: 'text-delta', index: 0, text: 'before tool' })
    controller.abort(new Error('between-step cancellation'))
    await vi.waitFor(() => expect(f.deps.stop).toHaveBeenCalledTimes(1))
    expect(f.listeners.size).toBe(1)
    f.stopGate.resolve()
    f.outcome.resolve({ ...f.worker, status: 'interrupted' })
    await vi.waitFor(() => expect(f.listeners.size).toBe(0))
  })

  it('does not stop a newer Worker run when an older native display turn is cancelled late', async () => {
    const f = fixture({ unresolved: true })
    const oldRun = f.worker.runId
    f.append({ kind: 'assistant', text: 'old prefix', step: 0 })
    f.append({ kind: 'tool', text: 'old tool', step: 1, state: 'COMPLETED' })
    await f.ensure()
    const control = new AbortController()
    await f.preStep([f.turnInbox.shift()!], 1, control.signal)
    await collect(await f.request(1, control.signal))
    f.worker.runId = randomUUID()
    control.abort(new Error('old display cancelled'))
    f.outcome.resolve({ ...f.worker, runId: oldRun, status: 'completed' })
    await vi.waitFor(() => expect(f.listeners.size).toBe(0))
    expect(f.deps.stop).not.toHaveBeenCalled()
  })

  it('settles an observed partial reply before surfacing terminal CLI failure', async () => {
    const f = fixture({ unresolved: true })
    f.append({ kind: 'assistant', text: 'observed partial', step: 0 })
    f.outcome.resolve({ ...f.worker, status: 'failed', error: 'synthetic CLI failure' })
    await f.ensure()
    await f.preStep([f.turnInbox.shift()!])
    const first = await collect(await f.request())
    expect(first).toContainEqual({ type: 'text-delta', index: 0, text: 'observed partial' })
    expect(first.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    await f.preStep(f.stepInbox.splice(0), 2)
    expect((await collect(await f.request(2))).at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { message: 'synthetic CLI failure' } },
    })
  })
})

describe('rebinding across DS Bot segments (Issue #10)', () => {
  it('rebuilds the display child under the current segment and retires the old one without resending the task', async () => {
    const id = randomUUID()
    const old: HarnessConversationRecord = { workerId: id, parentSessionId: 'old-segment', sessionId: 'old-display-child' }
    const f = fixture({ records: [old], worker: { id, formerParentSessionIds: ['old-segment'] } })
    const binding = await f.ensure()
    expect(binding.sessionId).not.toBe('old-display-child')
    expect(f.deps.replaceBinding).toHaveBeenCalledTimes(1)
    expect(f.records).toEqual([
      expect.objectContaining({ workerId: id, parentSessionId: f.parent.id, sessionId: binding.sessionId, retiredSessionIds: ['old-display-child'] }),
    ])
    // The second open hits the new record instead of the stale old-parent one.
    expect((await f.ensure()).sessionId).toBe(binding.sessionId)
    expect(f.ctx.subagents.startContinuable).toHaveBeenCalledTimes(1)
    expect(f.deps.run).not.toHaveBeenCalled()
  })
  it('still refuses a display record of a parent that is not a recorded former segment', async () => {
    const id = randomUUID()
    const old: HarnessConversationRecord = { workerId: id, parentSessionId: 'unrelated-parent', sessionId: 'other-display-child' }
    const f = fixture({ records: [old], worker: { id, formerParentSessionIds: ['old-segment'] } })
    await expect(f.ensure()).rejects.toThrow('原生会话父身份不匹配')
    expect(f.deps.replaceBinding).not.toHaveBeenCalled()
    expect(f.records).toEqual([old])
  })
})

it.each(['aborted', 'error'] as const)('joins a cold-resumed rc.2 epoch through its post-cleanup %s edge', async stopReason => {
  // SIMULATION: no caller Activation handle exists for this resumed epoch.
  const parent: any = { id: 'root', session: { header: {} } }
  const cancel = vi.fn()
  const child: any = { id: 'child', session: { header: { origin: 'subagent', parentSession: parent.id } }, cancel }
  const agents = new Map([[parent.id, parent], [child.id, child]])
  let end!: (info: any) => void
  const off = vi.fn(), settled = vi.fn()
  const bridge: any = Object.assign(Object.create(HarnessConversationBridge.prototype), {
    activations: new Map(),
    ctx: { agents, subagents: { rootOf: () => parent, startActivation() {}, registerProvider() {} },
      on: (name: string, callback: any) => { expect(name).toBe('subagent/end'); end = callback; return off } },
  })
  const done = bridge.drainChildren(parent, [child.id]).then(settled)
  // stopReason can describe a failed task; it is not by itself a cleanup failure.
  const assertion = expect(done).resolves.toBeUndefined()
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith({ kind: 'parent' }))
  expect(settled).not.toHaveBeenCalled()
  agents.delete(child.id)
  end({ id: child.id, stopReason })
  await assertion
  expect(off).toHaveBeenCalledOnce()
})
