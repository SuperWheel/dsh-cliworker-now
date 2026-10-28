import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry, type Agent } from '@deepseek-ai/dsh-agent'
import { LlmRuntime, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionStore, SessionId, Session } from '@deepseek-ai/dsh-session'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { createRequire } from 'node:module'
import { existsSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { runNativeClaude } from '../src/host/native-claude.mjs'
import { HarnessConversationStream } from '../src/host/harness-conversation-stream.ts'
import type {
  HarnessConversationDependencies,
  HarnessConversationRecord,
} from '../src/host/harness-conversation-types.ts'
import type { Worker, WorkerEvent } from '../src/shared/types.ts'

// Actual installed rc.2 AgentLoop and Session; synthetic Worker events only.
// No CLI, account, filesystem task, provider or network is invoked.
const runtimeRequire = createRequire(
  realpathSync(new URL('../node_modules/@deepseek-ai/dsh/package.json', import.meta.url)),
)
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

async function fixture(
  options: {
    pendingTool?: boolean
    maxParallelToolCalls?: number
    inputSettlement?: Promise<void>
    sourceEvents?: Array<Omit<WorkerEvent, 'seq' | 'runId' | 'time'>>
    cli?: 'hermes' | 'opencode' | 'claude' | 'codex'
    transport?: string
  } = {},
) {
  const { default: AgentLoop } = await import(
    pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-agent-loop')).href
  )
  const { default: SessionProjectionRegistry } = await import(
    pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-session-projection')).href
  )
  const { default: TokenMeter } = await import(
    pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-token-meter')).href
  )
  const { deriveTurnTokenUsage } = await import(
    pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-token-meter/client')).href
  )
  const ctx = new Context()
  let stream: HarnessConversationStream | undefined
  cleanup.push(async () => {
    stream?.close()
    await ctx.fiber.dispose()
  })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(TokenMeter)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  const realTool = vi.fn(async () => 'must not execute')
  ctx.tools.register({
    name: 'synthetic_cli_tool',
    description: 'Synthetic real tool to detect duplicate dispatch',
    parameters: {},
    output: { schema: {}, render: () => [] },
    execute: realTool,
  })
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: options.maxParallelToolCalls ?? 1 })
  const created = await ctx.agents.create({
    sessionId: SessionId(randomUUID()),
    agentOptions: { provider: 'synthetic-cli-projection', model: 'not-a-model' },
  })
  const agent: Agent = created.agent
  const worker: Worker = {
    id: randomUUID(),
    parentSessionId: 'synthetic-parent',
    runId: randomUUID(),
    project: '/synthetic/no-task',
    title: 'Synthetic stopped CLI run',
    preference: { cli: options.cli ?? 'opencode', model: 'saved-model', effort: 'default' },
    ...(options.transport ? { transport: options.transport } : {}),
    mode: 'accept-edits',
    status: 'running',
    createdAt: '2026-10-16T00:00:00Z',
    updatedAt: '2026-10-16T00:00:00Z',
  }
  const record: HarnessConversationRecord = {
    workerId: worker.id,
    parentSessionId: worker.parentSessionId,
    sessionId: agent.id,
  }
  const events: WorkerEvent[] = (
    options.sourceEvents ?? [
      { kind: 'user', text: 'synthetic input' },
      { kind: 'assistant', text: 'observed CLI prefix', step: 0 },
      ...(options.pendingTool
        ? [
            {
              kind: 'tool',
              text: 'synthetic_cli_tool',
              step: 1,
              state: 'RUNNING',
              toolCall: {
                callId: 'observed-pending-call',
                name: 'synthetic_cli_tool',
                input: { observed: true },
              },
            },
          ]
        : []),
    ]
  ).map((event, seq) => ({ ...event, seq, runId: worker.runId, time: worker.updatedAt }) as WorkerEvent)
  const listeners = new Set<() => void>()
  const outcome = Promise.withResolvers<Worker>()
  const deps: HarnessConversationDependencies = {
    bindings: () => [],
    bind: async () => {},
    unbind: async () => {},
    getWorker: () => worker,
    busy: () => true,
    events: (_record, runId, after) => events.filter((event) => event.runId === runId && event.seq > after),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    run: async () => {
      throw new Error('Synthetic projection must not launch a CLI')
    },
    wait: async () => outcome.promise,
    stop: vi.fn(async () => {}),
  }
  const requestErrors = vi.fn()
  const agentErrors = vi.fn()
  const streamFrames: any[] = []
  ctx.on('agent/assistant-stream', ({ agent: owner, frame }) => {
    if (owner === agent) streamFrames.push(frame)
  }, { global: true })
  ctx.on(
    'agent/request-error',
    async (payload, next) => {
      requestErrors(payload)
      return next()
    },
    { global: true },
  )
  ctx.on('agent/error', (payload) => agentErrors(payload), { global: true })
  const start = Promise.withResolvers<void>()
  let steps = 0
  ctx.on(
    'llm/stream',
    async function* (options) {
      if (options.provider !== 'synthetic-cli-projection' || options.sessionId !== agent.id)
        throw new Error('Unexpected model request')
      start.resolve()
      yield* stream!.segment(agent, 1, ++steps, options.signal!)
    },
    { global: true, prepend: true },
  )
  const inputCleanup = vi.fn(() => options.inputSettlement ?? Promise.resolve())
  let turnSignal!: AbortSignal
  ctx.on(
    'agent/pre-step',
    async (payload, next) => {
      turnSignal = payload.signal
      if (!stream)
        stream = new HarnessConversationStream(
          record,
          { runId: worker.runId, done: outcome.promise },
          deps,
          payload.signal,
          { provider: 'synthetic-cli-projection', model: 'not-a-model' },
          options.inputSettlement ? { projectUser: () => true, settled: inputCleanup } : undefined,
        )
      return next()
    },
    { global: true },
  )
  const cancel = vi.spyOn(agent, 'cancel')
  const begin = async () => {
    agent.followup(
      createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'synthetic input' }] }),
    )
    await start.promise
  }
  const finish = async (status: Worker['status'], error?: string) => {
    worker.status = status
    outcome.resolve({
      ...worker,
      interruptionReason: status === 'interrupted' && !error ? 'user' : undefined,
      ...(error ? { error } : {}),
    })
    for (const listener of listeners) listener()
    await agent.whenIdle()
  }
  return {
    agent,
    deps,
    inputCleanup,
    publish: (event: Omit<WorkerEvent, 'seq' | 'runId' | 'time'>) => {
      events.push({ ...event, seq: events.length, runId: worker.runId, time: worker.updatedAt })
      for (const listener of listeners) listener()
    },
    listeners,
    requestErrors,
    streamFrames,
    agentErrors,
    cancel,
    realTool,
    worker,
    begin,
    finish,
    projections: () => (ctx as any).sessionProjections.snapshot(agent.session).values,
    turnUsage: () => {
      const start = agent.session.log.findIndex((event) => event.type === 'turn/start')
      return deriveTurnTokenUsage(agent.session.log.slice(start))
    },
    get signal() {
      return turnSignal
    },
  }
}

it('settles one proven response with public reasoning/text once and supplies native turn/session usage', async () => {
  const usage = {
    inputTokens: 120,
    outputTokens: 9,
    cacheReadTokens: 300,
    cacheWriteTokens: 0,
    totalTokens: 429,
  }
  const f = await fixture({
    sourceEvents: [
      { kind: 'user', text: 'synthetic input' },
      {
        kind: 'reasoning',
        text: 'public reasoning',
        detail: 'synthetic public summary',
        step: 0,
        state: 'COMPLETED',
        response: { id: 'synthetic-response', blockId: 'reasoning', index: 0 },
      },
      {
        kind: 'assistant',
        text: 'synthetic answer',
        step: 1,
        response: { id: 'synthetic-response', blockId: 'text', index: 1, complete: true, usage },
      },
    ],
  })
  await f.begin()
  await f.finish('completed')
  const messages = f.agent.session.log.filter((event) => event.type === 'assistant/message')
  expect(messages).toHaveLength(1)
  expect(messages[0]?.data).toMatchObject({
    usage,
    message: {
      content: [
        { type: 'reasoning', text: 'synthetic public summary' },
        { type: 'text', text: 'synthetic answer' },
      ],
    },
  })
  expect(f.agent.session.log.filter((event) => event.type === 'step/start')).toHaveLength(1)
  expect(f.turnUsage()).toMatchObject({
    totalTokens: 429,
    uncachedInputTokens: 120,
    outputTokens: 9,
    cacheReadTokens: 300,
  })
  expect(f.projections().tokenUsage).toEqual({
    uncachedInputTokens: 120,
    outputTokens: 9,
    cacheReadTokens: 300,
    cacheWriteTokens: 0,
  })
  const cold = Session.create(
    f.agent.id,
    JSON.parse(JSON.stringify(f.agent.session.log)),
    f.agent.session.header,
  )
  expect(cold.deriveMessages().filter((message) => message.role === 'assistant')).toHaveLength(1)
  expect(f.requestErrors).not.toHaveBeenCalled()
})

it('accounts for two proven responses once each without adding an empty cleanup step', async () => {
  const usage = { inputTokens: 5, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 7 }
  const f = await fixture({
    sourceEvents: [
      { kind: 'user', text: 'synthetic input' },
      {
        kind: 'assistant',
        text: 'response one',
        step: 0,
        response: { id: 'first', blockId: 'text', index: 0, complete: true, usage },
      },
      {
        kind: 'assistant',
        text: 'response two',
        step: 1,
        response: { id: 'second', blockId: 'text', index: 0, complete: true, usage },
      },
    ],
  })
  await f.begin()
  await f.finish('completed')
  expect(f.agent.session.log.filter((event) => event.type === 'assistant/message')).toHaveLength(2)
  expect(f.agent.session.log.filter((event) => event.type === 'step/start')).toHaveLength(2)
  expect(f.turnUsage()?.totalTokens).toBe(14)
  expect(f.projections().tokenUsage).toMatchObject({ uncachedInputTokens: 10, outputTokens: 4 })
})

it('lets the official loop settle an observed tool response once without executing the real tool', async () => {
  const usage = { inputTokens: 5, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 7 }
  const f = await fixture({
    sourceEvents: [
      { kind: 'user', text: 'synthetic input' },
      {
        kind: 'reasoning',
        text: 'public reasoning',
        detail: 'synthetic public summary',
        step: 0,
        state: 'COMPLETED',
        response: { id: 'tool-response', blockId: 'reasoning', index: 0 },
      },
      {
        kind: 'tool',
        text: 'synthetic_cli_tool',
        step: 1,
        state: 'COMPLETED',
        toolCall: {
          callId: 'existing-call',
          name: 'synthetic_cli_tool',
          input: { observed: true },
          output: 'existing output',
        },
        response: { id: 'tool-response', blockId: 'tool', index: 1, complete: true, usage },
      },
      {
        kind: 'assistant',
        text: 'final answer',
        step: 2,
        response: { id: 'answer-response', blockId: 'text', index: 0, complete: true, usage },
      },
    ],
  })
  await f.begin()
  await f.finish('completed')
  expect(f.realTool).not.toHaveBeenCalled()
  expect(f.agent.session.log.filter((event) => event.type === 'assistant/message')).toHaveLength(2)
  expect(f.agent.session.log.filter((event) => event.type === 'tool/call')).toHaveLength(1)
  const results = f.agent.session.log.filter((event) => event.type === 'tool/result')
  expect(results).toHaveLength(1)
  expect(results[0]?.data.message, JSON.stringify(results[0]?.data)).toMatchObject({
    isError: false,
    content: [{ type: 'text', text: 'existing output' }],
  })
  expect(f.turnUsage()?.totalTokens).toBe(14)
  expect(f.requestErrors).not.toHaveBeenCalled()
  expect(f.agentErrors).not.toHaveBeenCalled()
  const cold = Session.create(
    f.agent.id,
    JSON.parse(JSON.stringify(f.agent.session.log)),
    f.agent.session.header,
  )
  expect(cold.deriveMessages().filter((message) => message.role === 'tool')).toHaveLength(1)
  expect(f.agent.ctx.tools.get('synthetic_cli_tool', f.agent)?.description).toBe(
    'Synthetic real tool to detect duplicate dispatch',
  )
})

it('rejects foreign receipt identities and removes the scoped waiter after a tool-only response', async () => {
  const usage = { inputTokens: 5, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 7 }
  const f = await fixture({
    sourceEvents: [
      { kind: 'user', text: 'synthetic input' },
      {
        kind: 'tool',
        text: 'synthetic_cli_tool',
        step: 0,
        state: 'COMPLETED',
        toolCall: {
          callId: 'existing-call',
          name: 'synthetic_cli_tool',
          input: { observed: true },
          output: 'existing output',
        },
        response: { id: 'tool-response', blockId: 'tool', index: 0, complete: true, usage },
      },
    ],
  })
  await f.begin()
  await vi.waitFor(() =>
    expect(f.agent.ctx.tools.get('synthetic_cli_tool', f.agent)?.description).toContain('读取已由 CLI'),
  )
  const rejected = await f.agent.ctx.tools.execute({
    name: 'synthetic_cli_tool',
    callId: ToolCallId('foreign-call'),
    arguments: { observed: true },
    agent: f.agent,
    signal: new AbortController().signal,
  })
  expect(rejected.isError).toBe(true)
  const argumentsRejected = await f.agent.ctx.tools.execute({
    name: 'synthetic_cli_tool',
    callId: ToolCallId(`cliworker:${f.worker.runId}:existing-call`),
    arguments: { observed: false },
    agent: f.agent,
    signal: new AbortController().signal,
  })
  expect(argumentsRejected.isError).toBe(true)
  expect(f.realTool).not.toHaveBeenCalled()
  await f.finish('completed')
  expect(f.agent.session.log.filter((event) => event.type === 'assistant/message')).toHaveLength(1)
  expect(f.agent.session.log.filter((event) => event.type === 'step/start')).toHaveLength(1)
  expect(f.turnUsage()?.totalTokens).toBe(7)
  expect(f.agent.session.log.find((event) => event.type === 'tool/result')?.data.message.content).toEqual([
    { type: 'text', text: 'existing output' },
  ])
  expect(f.agent.ctx.tools.get('synthetic_cli_tool', f.agent)?.description).toBe(
    'Synthetic real tool to detect duplicate dispatch',
  )
})

it('settles parallel observed tools without losing wakeups and waits for the input receipt cleanup barrier', async () => {
  const inputSettlement = Promise.withResolvers<void>()
  const f = await fixture({
    maxParallelToolCalls: 2,
    inputSettlement: inputSettlement.promise,
    sourceEvents: [
      { kind: 'user', text: 'synthetic input' },
      ...[0, 1].map((index) => ({
        kind: 'tool' as const,
        text: 'synthetic_cli_tool',
        step: index,
        state: 'COMPLETED',
        toolCall: {
          callId: `parallel-${index}`,
          name: 'synthetic_cli_tool',
          input: { index },
          output: `output-${index}`,
        },
        response: {
          id: 'parallel-response',
          blockId: `tool-${index}`,
          index,
          ...(index === 1
            ? {
                complete: true as const,
                usage: {
                  inputTokens: 5,
                  outputTokens: 2,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                  totalTokens: 7,
                },
              }
            : {}),
        },
      })),
    ],
  })
  await f.begin()
  await vi.waitFor(() =>
    expect(f.agent.session.log.filter((event) => event.type === 'tool/call')).toHaveLength(2),
  )
  const completion = f.finish('completed')
  await Promise.resolve()
  expect(f.agent.status).toBe('running')
  expect(f.agent.session.log.filter((event) => event.type === 'tool/result')).toHaveLength(0)
  inputSettlement.resolve()
  await completion
  const results = f.agent.session.log.filter((event) => event.type === 'tool/result')
  expect(results).toHaveLength(2)
  expect(results.map((event) => event.data.message.content)).toEqual([
    [{ type: 'text', text: 'output-0' }],
    [{ type: 'text', text: 'output-1' }],
  ])
  expect(f.realTool).not.toHaveBeenCalled()
  expect(f.agent.session.log.filter((event) => event.type === 'step/start')).toHaveLength(1)
  expect(f.turnUsage()?.totalTokens).toBe(7)
  expect(f.agent.ctx.tools.get('synthetic_cli_tool', f.agent)?.description).toBe(
    'Synthetic real tool to detect duplicate dispatch',
  )
  expect(f.listeners.size).toBe(0)
})

it('rechecks following response content published while final input receipts are settling', async () => {
  const inputSettlement = Promise.withResolvers<void>()
  const usage = { inputTokens: 5, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 7 }
  const f = await fixture({
    inputSettlement: inputSettlement.promise,
    sourceEvents: [
      { kind: 'user', text: 'synthetic input' },
      {
        kind: 'tool',
        text: 'synthetic_cli_tool',
        state: 'COMPLETED',
        toolCall: { callId: 'before-receipt', name: 'synthetic_cli_tool', input: {}, output: 'observed' },
        response: { id: 'tool-before-receipt', blockId: 'tool', index: 0, complete: true, usage },
      },
    ],
  })
  await f.begin()
  const completion = f.finish('completed')
  await vi.waitFor(() => expect(f.inputCleanup).toHaveBeenCalledTimes(1))
  f.publish({
    kind: 'assistant',
    text: 'acknowledged final response',
    response: { id: 'after-receipt', blockId: 'text', index: 0, complete: true, usage },
  })
  inputSettlement.resolve()
  await completion
  expect(f.realTool).not.toHaveBeenCalled()
  expect(f.agent.session.deriveMessages().filter((message) => message.role === 'assistant')).toHaveLength(2)
  expect(f.turnUsage()?.totalTokens).toBe(14)
  expect(f.requestErrors).not.toHaveBeenCalled()
  expect(f.listeners.size).toBe(0)
})

it('cancels a known-response tool waiter only after the CLI cleanup and releases its scoped receipt', async () => {
  const f = await fixture({
    sourceEvents: [
      { kind: 'user', text: 'synthetic input' },
      {
        kind: 'tool',
        text: 'synthetic_cli_tool',
        step: 0,
        state: 'RUNNING',
        toolCall: { callId: 'pending', name: 'synthetic_cli_tool', input: {} },
        response: { id: 'pending-response', blockId: 'tool', index: 0, complete: true },
      },
    ],
  })
  await f.begin()
  await vi.waitFor(() =>
    expect(f.agent.session.log.filter((event) => event.type === 'tool/call')).toHaveLength(1),
  )
  f.agent.cancel({ kind: 'user' }, { keepInbox: true })
  await vi.waitFor(() => expect(f.deps.stop).toHaveBeenCalledTimes(1))
  expect(f.agent.status).toBe('running')
  await f.finish('interrupted')
  expect(f.realTool).not.toHaveBeenCalled()
  expect(f.agent.status).toBe('idle')
  expect(f.listeners.size).toBe(0)
  expect(f.agent.ctx.tools.get('synthetic_cli_tool', f.agent)?.description).toBe(
    'Synthetic real tool to detect duplicate dispatch',
  )
  const cold = Session.create(
    f.agent.id,
    JSON.parse(JSON.stringify(f.agent.session.log)),
    f.agent.session.header,
  )
  expect(cold.log.filter((event) => event.type === 'turn/end').at(-1)?.data.reason.kind).toBe('aborted')
})

it('records a normal Worker Stop as native cancellation only after the cleanup outcome, preserving observed text', async () => {
  const f = await fixture()
  await f.begin()
  expect(f.cancel).not.toHaveBeenCalled()
  expect(f.agent.status).toBe('running')
  expect(f.signal.aborted).toBe(false)
  await f.finish('interrupted')
  expect(f.cancel).toHaveBeenCalledExactlyOnceWith({ kind: 'user' }, { keepInbox: true })
  expect(f.agent.session.log.filter((event) => event.type === 'turn/end').at(-1)?.data).toMatchObject({
    reason: { kind: 'aborted', reason: { kind: 'user' } },
  })
  expect(
    f.agent.session
      .deriveMessages()
      .filter((message) => message.role === 'assistant')
      .flatMap((message) =>
        message.content.filter((block) => block.type === 'text').map((block) => block.text),
      ),
  ).toEqual(['observed CLI prefix'])
  expect(f.requestErrors).not.toHaveBeenCalled()
  expect(f.agentErrors).not.toHaveBeenCalled()
  expect(f.deps.stop).not.toHaveBeenCalled()
  expect(f.listeners.size).toBe(0)
})

it('keeps a genuine CLI failure as an error with its original detail', async () => {
  const f = await fixture()
  await f.begin()
  await f.finish('failed', 'synthetic CLI permission failure')
  expect(f.cancel).not.toHaveBeenCalled()
  expect(f.agent.session.log.filter((event) => event.type === 'turn/end').at(-1)?.data).toMatchObject({
    reason: { kind: 'error', error: { code: 'CLI_RUN_FAILED', message: 'synthetic CLI permission failure' } },
  })
  expect(f.requestErrors).toHaveBeenCalledTimes(1)
  expect(f.deps.stop).not.toHaveBeenCalled()
  expect(f.listeners.size).toBe(0)
})

it('ends an unverified CLI outcome without a failure card or an extra empty step', async () => {
  const f = await fixture({
    sourceEvents: [
      { kind: 'user', text: 'synthetic input' },
      {
        kind: 'assistant',
        text: 'synthetic answer after a denied permission',
        step: 0,
        response: { id: 'answer', blockId: 'text', index: 0, complete: true },
      },
    ],
  })
  await f.begin()
  await f.finish('uncertain', 'synthetic 结果待核实 notice')
  expect(f.cancel).not.toHaveBeenCalled()
  expect(f.agent.session.log.filter((event) => event.type === 'turn/end').at(-1)?.data).toMatchObject({
    reason: { kind: 'completed' },
  })
  expect(JSON.stringify(f.agent.session.log)).not.toContain('CLI_RUN_FAILED')
  expect(f.agent.session.log.filter((event) => event.type === 'step/start')).toHaveLength(1)
  expect(f.requestErrors).not.toHaveBeenCalled()
  expect(f.agentErrors).not.toHaveBeenCalled()
  expect(f.deps.stop).not.toHaveBeenCalled()
})

it('retains native completion for a successful CLI outcome without cancelling its turn', async () => {
  const f = await fixture()
  await f.begin()
  await f.finish('completed')
  expect(f.cancel).not.toHaveBeenCalled()
  expect(f.agent.session.log.filter((event) => event.type === 'turn/end').at(-1)?.data).toMatchObject({
    reason: { kind: 'completed' },
  })
  expect(f.requestErrors).not.toHaveBeenCalled()
  expect(f.agentErrors).not.toHaveBeenCalled()
  expect(f.deps.stop).not.toHaveBeenCalled()
})

it('does not relabel an interrupted timeout as a user Stop', async () => {
  const f = await fixture()
  await f.begin()
  await f.finish('interrupted', 'Error: 任务超时')
  expect(f.cancel).not.toHaveBeenCalled()
  expect(f.agent.session.log.filter((event) => event.type === 'turn/end').at(-1)?.data).toMatchObject({
    reason: { kind: 'error', error: { code: 'CLI_RUN_FAILED', message: 'Error: 任务超时' } },
  })
  expect(f.requestErrors).toHaveBeenCalledTimes(1)
  expect(f.deps.stop).not.toHaveBeenCalled()
})

it.each(['interrupted', 'failed'] as const)(
  'conservatively closes an observed RUNNING tool on %s so the native log survives cold validation',
  async (status) => {
    const f = await fixture({ pendingTool: true })
    await f.begin()
    await f.finish(status, status === 'failed' ? 'synthetic CLI failure' : undefined)
    const toolResults = f.agent.session.log.filter((event) => event.type === 'tool/result')
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0]?.data).toMatchObject({
      message: { isError: true },
      error: { code: 'TOOL_OUTCOME_UNKNOWN' },
    })
    const resultText = toolResults[0]?.data.message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
    expect(resultText).toContain('Its outcome is unknown.')
    expect(resultText).toContain('Do not retry blindly.')
    const cold = Session.create(
      f.agent.id,
      JSON.parse(JSON.stringify(f.agent.session.log)),
      f.agent.session.header,
    )
    expect(cold.deriveMessages().filter((message) => message.role === 'tool')).toHaveLength(1)
    expect(cold.log.filter((event) => event.type === 'turn/end').at(-1)?.data.reason.kind).toBe(
      status === 'interrupted' ? 'aborted' : 'error',
    )
    expect(f.deps.stop).not.toHaveBeenCalled()
    expect(f.listeners.size).toBe(0)
  },
)

it('keeps a cancelled native turn open until process completion even if the stop command rejects', async () => {
  const f = await fixture()
  vi.mocked(f.deps.stop).mockRejectedValueOnce(new Error('Synthetic stop-state write failure'))
  await f.begin()
  f.agent.cancel({ kind: 'user' }, { keepInbox: true })
  await vi.waitFor(() => expect(f.deps.stop).toHaveBeenCalledTimes(1))
  expect(f.agent.status).toBe('running')
  await f.finish('interrupted')
  expect(f.agent.status).toBe('idle')
  expect(f.listeners.size).toBe(0)
})

it('streams actual Hermes published reasoning and starts the passive tool before CLI completion', async () => {
  const f = await fixture({ cli: 'hermes', transport: 'hermes-http-v1', sourceEvents: [
    { kind: 'user', text: 'synthetic input' },
    { kind: 'reasoning', step: 1, text: 'Hermes 公开思考', detail: 'synthetic public prefix', state: 'RUNNING' },
  ] })
  await f.begin()
  await vi.waitFor(() => expect(f.streamFrames.some((frame) => frame.chunk?.type === 'reasoning-delta'
    && frame.chunk.text === 'synthetic public prefix')).toBe(true))
  expect(f.worker.status).toBe('running')
  expect(f.agent.session.log.filter((event) => event.type === 'assistant/message')).toHaveLength(0)
  expect(f.turnUsage()).toBeUndefined()
  f.publish({ kind: 'reasoning', step: 1, text: 'Hermes 公开思考', detail: 'synthetic public prefix plus delta', state: 'RUNNING' })
  await vi.waitFor(() => expect(f.streamFrames.some((frame) => frame.chunk?.type === 'reasoning-delta'
    && frame.chunk.text === ' plus delta')).toBe(true))
  f.publish({ kind: 'tool', step: 1, text: 'synthetic_cli_tool', state: 'RUNNING',
    toolCall: { name: 'synthetic_cli_tool', input: { observed: true } } })
  await vi.waitFor(() => expect(f.agent.session.log.filter((event) => event.type === 'tool/call')).toHaveLength(1))
  expect(f.worker.status).toBe('running')
  expect(f.realTool).not.toHaveBeenCalled()
  expect(f.agent.session.log.filter((event) => event.type === 'tool/result')).toHaveLength(0)
  f.publish({ kind: 'tool', step: 1, text: 'synthetic_cli_tool', state: 'COMPLETED',
    toolCall: { name: 'synthetic_cli_tool', output: 'actual synthetic public receipt' } })
  await vi.waitFor(() => expect(f.agent.session.log.filter((event) => event.type === 'tool/result')).toHaveLength(1))
  await f.finish('completed')
  expect(f.realTool).not.toHaveBeenCalled()
  expect(f.requestErrors).not.toHaveBeenCalled()
  expect(f.agentErrors).not.toHaveBeenCalled()
})

it.each(['completed', 'interrupted', 'failed'] as const)('streams Codex public summaries before completion and preserves them once after %s', async (status) => {
  // Same public snapshots emitted by the installed Codex app-server in the
  // isolated Responses fixture. No model, raw reasoning or tool is invoked.
  const f = await fixture({ cli: 'codex', transport: 'codex-app-v1', sourceEvents: [
    { kind: 'user', text: 'synthetic input' },
    { kind: 'reasoning', step: 0, text: 'Codex 思考摘要', detail: 'synthetic public prefix', state: 'RUNNING' },
  ] })
  await f.begin()
  await vi.waitFor(() => expect(f.streamFrames.some((frame) => frame.chunk?.type === 'reasoning-delta'
    && frame.chunk.text === 'synthetic public prefix')).toBe(true))
  expect(f.worker.status).toBe('running')
  expect(f.agent.session.log.filter((event) => event.type === 'assistant/message')).toHaveLength(0)
  f.publish({ kind: 'reasoning', step: 0, text: 'Codex 思考摘要', detail: 'synthetic public prefix plus delta', state: 'RUNNING' })
  await vi.waitFor(() => expect(f.streamFrames.some((frame) => frame.chunk?.type === 'reasoning-delta'
    && frame.chunk.text === ' plus delta')).toBe(true))
  if (status === 'completed') {
    f.publish({ kind: 'reasoning', step: 0, text: 'Codex 思考摘要', detail: 'synthetic public prefix plus delta', state: 'COMPLETED' })
    f.publish({ kind: 'assistant', step: 1, text: 'synthetic final answer', state: 'COMPLETED' })
  }
  await f.finish(status, status === 'failed' ? 'synthetic provider failure' : undefined)
  const reasoning = f.agent.session.log.filter((event) => event.type === 'assistant/message')
    .flatMap((event: any) => event.data.message.content.filter((block: any) => block.type === 'reasoning'))
  expect(reasoning).toEqual([{ type: 'reasoning', text: 'synthetic public prefix plus delta' }])
  expect(f.streamFrames.filter((frame) => frame.chunk?.type === 'reasoning-delta').map((frame) => frame.chunk.text))
    .toEqual(['synthetic public prefix', ' plus delta'])
  expect(f.realTool).not.toHaveBeenCalled()
  expect(f.listeners.size).toBe(0)
})

it.each([{}, { cli: 'hermes', transport: 'legacy' }, { cli: 'codex', transport: 'legacy' }] as const)('retains the withdrawal gate for unverified reasoning snapshots instead of leaking their prefix: %j', async (selection) => {
  const f = await fixture({ ...selection, sourceEvents: [
    { kind: 'user', text: 'synthetic input' },
    { kind: 'reasoning', step: 0, text: 'public reasoning', detail: 'withdrawable snapshot', state: 'RUNNING' },
  ] })
  await f.begin()
  await vi.waitFor(() => expect(f.streamFrames.some((frame) => frame.type === 'start')).toBe(true))
  expect(f.streamFrames.some((frame) => frame.chunk?.type === 'reasoning-delta')).toBe(false)
  f.publish({ kind: 'reasoning', step: 0, text: 'public reasoning', detail: '', state: 'COMPLETED' })
  f.publish({ kind: 'assistant', step: 1, text: 'synthetic answer' })
  await f.finish('completed')
  expect(f.streamFrames.some((frame) => frame.chunk?.type === 'reasoning-delta')).toBe(false)
  expect(JSON.stringify(f.agent.session.log)).not.toContain('withdrawable snapshot')
})

it('publishes a finalized public reasoning snapshot without waiting for another row or run cleanup', async () => {
  const f = await fixture({ sourceEvents: [
    { kind: 'user', text: 'synthetic input' },
    { kind: 'reasoning', step: 0, text: 'public reasoning', detail: 'already final public summary', state: 'COMPLETED' },
  ] })
  await f.begin()
  await vi.waitFor(() => expect(f.streamFrames.some((frame) => frame.chunk?.type === 'reasoning-delta'
    && frame.chunk.text === 'already final public summary')).toBe(true))
  expect(f.worker.status).toBe('running')
  expect(f.agent.session.log.filter((event) => event.type === 'assistant/message')).toHaveLength(0)
  await f.finish('completed')
  expect(f.agent.session.log.filter((event) => event.type === 'step/start')).toHaveLength(1)
  expect(f.agent.session.log.filter((event) => event.type === 'assistant/message')).toHaveLength(1)
})

it('keeps the final reply in the latest native step when Hermes publishes reasoning after its answer', async () => {
  // Replays the observed ordering, with synthetic text and no CLI invocation:
  // answer -> late public reasoning -> completed reasoning -> result -> cleanup.
  const f = await fixture({ cli: 'hermes', transport: 'hermes-http-v1', sourceEvents: [
    { kind: 'user', text: 'synthetic input' },
  ] })
  await f.begin()
  f.publish({ kind: 'assistant', step: 1, text: 'synthetic hello' })
  await vi.waitFor(() => expect(f.streamFrames.some((frame) => frame.chunk?.type === 'text-delta'
    && frame.chunk.text === 'synthetic hello')).toBe(true))
  f.publish({ kind: 'reasoning', step: 1, text: 'Hermes 公开思考', detail: 'synthetic late public summary', state: 'RUNNING' })
  await vi.waitFor(() => expect(f.streamFrames.some((frame) => frame.chunk?.type === 'reasoning-delta'
    && frame.chunk.text === 'synthetic late public summary')).toBe(true))
  f.publish({ kind: 'reasoning', step: 1, text: 'Hermes 公开思考', detail: 'synthetic late public summary', state: 'COMPLETED' })
  f.publish({ kind: 'result', text: 'synthetic hello', state: 'SUCCESS', resultScope: 'response' })
  await f.finish('completed')
  const steps = f.agent.session.log.filter((event) => event.type === 'step/start')
  const assistants = f.agent.session.log.filter((event) => event.type === 'assistant/message')
  expect(steps).toHaveLength(1)
  expect(assistants).toHaveLength(1)
  expect(assistants.at(-1)?.data).toMatchObject({ step: steps.at(-1)?.data.step, message: { content: [
    { type: 'text', text: 'synthetic hello' },
    { type: 'reasoning', text: 'synthetic late public summary' },
  ] } })
  expect(f.requestErrors).not.toHaveBeenCalled()
  expect(f.agentErrors).not.toHaveBeenCalled()
})

it('keeps an identified final response in its step while process cleanup is pending', async () => {
  const f = await fixture({ sourceEvents: [
    { kind: 'user', text: 'synthetic input' },
    { kind: 'assistant', text: 'synthetic final answer',
      response: { id: 'native-final-response', blockId: 'reply', index: 0, complete: true } },
  ] })
  await f.begin()
  await vi.waitFor(() => expect(f.streamFrames.some((frame) => frame.chunk?.type === 'text-delta')).toBe(true))
  expect(f.agent.session.log.filter((event) => event.type === 'step/start')).toHaveLength(1)
  expect(f.agent.session.log.filter((event) => event.type === 'assistant/message')).toHaveLength(0)
  await f.finish('completed')
  expect(f.agent.session.log.filter((event) => event.type === 'step/start')).toHaveLength(1)
  expect(f.agent.session.log.filter((event) => event.type === 'assistant/message').at(-1)?.data.message.content)
    .toEqual([{ type: 'text', text: 'synthetic final answer' }])
})

it('retains a final-result suffix arriving after late reasoning in the same narrative segment', async () => {
  const f = await fixture({ cli: 'hermes', transport: 'hermes-http-v1', sourceEvents: [
    { kind: 'user', text: 'synthetic input' },
    { kind: 'assistant', step: 1, text: 'synthetic hello' },
  ] })
  await f.begin()
  await vi.waitFor(() => expect(f.streamFrames.some((frame) => frame.chunk?.type === 'text-delta')).toBe(true))
  f.publish({ kind: 'reasoning', step: 1, text: 'public summary', detail: 'synthetic late summary', state: 'RUNNING' })
  await vi.waitFor(() => expect(f.streamFrames.some((frame) => frame.chunk?.type === 'reasoning-delta')).toBe(true))
  f.publish({ kind: 'result', text: 'synthetic hello final suffix', state: 'SUCCESS', resultScope: 'response' })
  await f.finish('completed')
  expect(f.agent.session.log.filter((event) => event.type === 'step/start')).toHaveLength(1)
  expect(f.agent.session.log.findLast((event) => event.type === 'assistant/message')?.data.message.content)
    .toEqual([{ type: 'text', text: 'synthetic hello final suffix' }, { type: 'reasoning', text: 'synthetic late summary' }])
})

it('preserves tool and admitted user boundaries between ungrouped narrative blocks', async () => {
  const f = await fixture({ cli: 'hermes', transport: 'hermes-http-v1', sourceEvents: [
    { kind: 'user', text: 'synthetic input' },
    { kind: 'assistant', step: 1, text: 'synthetic progress' },
    { kind: 'reasoning', step: 1, text: 'public summary', detail: 'synthetic summary', state: 'RUNNING' },
    { kind: 'tool', step: 2, text: 'synthetic_cli_tool', state: 'COMPLETED',
      toolCall: { callId: 'observed', name: 'synthetic_cli_tool', output: 'synthetic receipt' } },
    { kind: 'user', text: 'synthetic admitted followup' },
    { kind: 'assistant', step: 2, text: 'synthetic final answer' },
  ] })
  await f.begin()
  await f.finish('completed')
  const assistants = f.agent.session.log.filter((event) => event.type === 'assistant/message')
  expect(assistants[0]?.data.message.content).toEqual([
    { type: 'text', text: 'synthetic progress' },
    { type: 'reasoning', text: 'synthetic summary' },
  ])
  expect(f.agent.session.log.filter((event) => event.type === 'tool/call')).toHaveLength(1)
  expect(f.agent.session.log.filter((event) => event.type === 'tool/result')).toHaveLength(1)
  expect(f.agent.session.log.filter((event) => event.type === 'user/message')
    .some((event) => event.data.content.some((block) => block.type === 'text' && block.text === 'synthetic admitted followup'))).toBe(true)
  const latestStep = f.agent.session.log.findLast((event) => event.type === 'step/start')?.data.step
  expect(assistants.at(-1)?.data).toMatchObject({ step: latestStep,
    message: { content: [{ type: 'text', text: 'synthetic final answer' }] } })
  expect(f.realTool).not.toHaveBeenCalled()
  expect(f.requestErrors).not.toHaveBeenCalled()
})

const officialTurnProcessSource = process.env.CWN_TEST_HARNESS_SOURCE
  ? pathToFileURL(join(process.env.CWN_TEST_HARNESS_SOURCE, 'packages/client/ui-chat/src/client/conversation-nodes/turn-process.ts'))
  : new URL('../.cache/dsh-host-source-rc2/packages/client/ui-chat/src/client/conversation-nodes/turn-process.ts', import.meta.url)
it.skipIf(!existsSync(officialTurnProcessSource))('retains the answer outside folding using the pinned official DSH turn-process projection', async () => {
  // The optional host-extension checkout is the official implementation used
  // for Desktop builds. This integration check is additional to the mandatory
  // AgentLoop checks above and never substitutes a copied folding algorithm.
  const { turnProcessDefinition } = await import(/* @vite-ignore */ officialTurnProcessSource.href)
  const f = await fixture({ cli: 'hermes', transport: 'hermes-http-v1', sourceEvents: [
    { kind: 'user', text: 'synthetic input' },
    { kind: 'assistant', step: 1, text: 'synthetic hello' },
    { kind: 'reasoning', step: 1, text: 'public summary', detail: 'synthetic late summary', state: 'COMPLETED' },
  ] })
  await f.begin()
  await f.finish('completed')
  const log = f.agent.session.log
  const turn: any = { turn: 1, status: 'closed', start: log.find((event) => event.type === 'turn/start'),
    end: log.find((event) => event.type === 'turn/end'), steps: [], data: new Map() }
  for (const start of log.filter((event) => event.type === 'step/start')) {
    const message = log.findLast((event) => event.type === 'assistant/message' && event.data.step === start.data.step)
    const blocks = message?.data.message.content.map(({ type, ...block }: any) => ({ kind: type, ...block })) ?? []
    turn.steps.push({ step: start.data.step, status: 'closed', data: new Map([
      ['assistant-step', { step: start.data.step, turn: 1, blocks,
        finalNode: message ? { seq: message.seq, step: start.data.step } : undefined }],
    ]) })
  }
  const location = { kind: 'turn', turn }
  const matches = log.filter((event) => turnProcessDefinition.match(event)).map((event) => ({ event, location }))
  const projection = turnProcessDefinition.buildLocationData({
    start: matches.find((match) => match.event.type === 'turn/start'), matches, current: new Map(),
  }, 'turn')
  expect(projection?.value).toMatchObject({ answerStep: 1, inlineReasoning: true })
  expect(projection?.value.answerAnchorSeq).toBe(log.findLast((event) => event.type === 'assistant/message')?.seq)
})

it('publishes an identified tool start before response settlement while arguments and usage remain gated', async () => {
  const response = { id: 'synthetic-response-live-tool', blockId: 'tool', index: 0 }
  const f = await fixture({ sourceEvents: [
    { kind: 'user', text: 'synthetic input' },
    { kind: 'tool', step: 0, text: 'synthetic_cli_tool', state: 'RUNNING',
      toolCall: { callId: 'live-call', name: 'synthetic_cli_tool' }, response },
  ] })
  await f.begin()
  await vi.waitFor(() => expect(f.streamFrames.some((frame) => frame.chunk?.type === 'tool-call-delta'
    && frame.chunk.name === 'synthetic_cli_tool' && frame.chunk.argumentsDelta === '')).toBe(true))
  expect(f.worker.status).toBe('running')
  expect(f.agent.session.log.filter((event) => event.type === 'tool/call')).toHaveLength(0)
  expect(f.streamFrames.some((frame) => frame.chunk?.type === 'usage')).toBe(false)
  expect(f.agent.ctx.tools.get('synthetic_cli_tool', f.agent)?.description).toBe('Synthetic real tool to detect duplicate dispatch')
  expect(f.realTool).not.toHaveBeenCalled()
  const usage = { inputTokens: 5, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 7 }
  f.publish({ kind: 'tool', step: 0, text: 'synthetic_cli_tool', state: 'COMPLETED',
    toolCall: { callId: 'live-call', name: 'synthetic_cli_tool', input: { observed: true }, output: 'observed receipt' },
    response: { ...response, complete: true, usage } })
  await vi.waitFor(() => expect(f.agent.session.log.filter((event) => event.type === 'tool/call')).toHaveLength(1))
  await f.finish('completed')
  expect(f.streamFrames.filter((frame) => frame.chunk?.type === 'block-start' && frame.chunk.blockType === 'tool-call')).toHaveLength(1)
  expect(f.streamFrames.filter((frame) => frame.chunk?.type === 'usage')).toHaveLength(1)
  expect(f.agent.session.log.find((event) => event.type === 'tool/call')?.data.arguments).toBe('{"observed":true}')
  expect(f.agent.session.log.filter((event) => event.type === 'tool/result')).toHaveLength(1)
  expect(f.turnUsage()?.totalTokens).toBe(7)
  expect(f.realTool).not.toHaveBeenCalled()
  expect(f.requestErrors).not.toHaveBeenCalled()
})

it('never promotes a live tool preview without a response completion into a dispatched call', async () => {
  const f = await fixture({ sourceEvents: [
    { kind: 'user', text: 'synthetic input' },
    { kind: 'tool', step: 0, text: 'synthetic_cli_tool', state: 'RUNNING',
      toolCall: { callId: 'incomplete-live-call', name: 'synthetic_cli_tool' },
      response: { id: 'incomplete-live-response', blockId: 'tool', index: 0 } },
  ] })
  await f.begin()
  await vi.waitFor(() => expect(f.streamFrames.some((frame) => frame.chunk?.type === 'tool-call-delta')).toBe(true))
  await f.finish('completed')
  expect(f.realTool).not.toHaveBeenCalled()
  expect(f.agent.session.log.filter((event) => event.type === 'tool/call')).toHaveLength(0)
  expect(f.agent.session.log.filter((event) => event.type === 'tool/result')).toHaveLength(0)
  expect(f.turnUsage()).toBeUndefined()
  expect(f.agent.session.log.findLast((event) => event.type === 'turn/end')?.data.reason.kind).toBe('error')
})

it('rejects a changed native call identity after a live preview without registering or dispatching either call', async () => {
  const response = { id: 'identity-response', blockId: 'tool', index: 0 }
  const f = await fixture({ sourceEvents: [
    { kind: 'user', text: 'synthetic input' },
    { kind: 'tool', step: 0, text: 'synthetic_cli_tool', state: 'RUNNING',
      toolCall: { callId: 'original', name: 'synthetic_cli_tool' }, response },
  ] })
  await f.begin()
  await vi.waitFor(() => expect(f.streamFrames.some((frame) => frame.chunk?.type === 'tool-call-delta')).toBe(true))
  f.publish({ kind: 'tool', step: 0, text: 'synthetic_cli_tool', state: 'RUNNING',
    toolCall: { callId: 'foreign', name: 'synthetic_cli_tool' }, response })
  await f.finish('completed')
  expect(f.realTool).not.toHaveBeenCalled()
  expect(f.agent.session.log.filter((event) => event.type === 'tool/call')).toHaveLength(0)
  expect(f.agent.ctx.tools.get('synthetic_cli_tool', f.agent)?.description).toBe('Synthetic real tool to detect duplicate dispatch')
  expect(f.agent.session.log.findLast((event) => event.type === 'turn/end')?.data.reason.kind).toBe('error')
})


it.each(['complete', 'interrupted'])('projects %s interleaved Claude Task streams through the real AgentLoop without attaching child usage to the main response', async (mode) => {
  const f = await fixture({ cli: 'claude', transport: 'claude-stream-v1', sourceEvents: [{ kind: 'user', text: 'synthetic input' }] })
  await f.begin()
  let listener: (frame: any) => void = () => {}
  const waits: Array<{ predicate: (frame: any) => boolean; resolve: (frame: any) => void }> = []
  const deliver = (frame: any) => {
    listener(frame)
    for (const wait of [...waits]) if (wait.predicate(frame)) { waits.splice(waits.indexOf(wait), 1); wait.resolve(frame) }
  }
  const main = (event: any) => ({ type: 'stream_event', session_id: 'SIMULATED-session', event })
  const child = (event: any) => ({ ...main(event), parent_tool_use_id: 'SIMULATED-task' })
  const peer = {
    onMessage(cb: typeof listener) { listener = cb; return () => {} },
    waitFor(predicate: (frame: any) => boolean) { return new Promise(resolve => waits.push({ predicate, resolve })) },
    send(frame: any) {
      if (frame.request?.subtype === 'initialize') deliver({ type: 'control_response', response: { request_id: frame.request_id, subtype: 'success', response: { models: [{ value: 'SIMULATED-model', resolvedModel: 'SIMULATED-model' }] } } })
      else if (frame.request?.subtype === 'get_context_usage') deliver({ type: 'control_response', response: { request_id: frame.request_id, subtype: 'error' } })
      else if (frame.type === 'user') { for (const record of [
        { type: 'system', subtype: 'init', session_id: 'SIMULATED-session', model: 'SIMULATED-model' },
        main({ type: 'message_start', message: { id: 'SIMULATED-main', usage: { input_tokens: 12, output_tokens: 0, cache_read_input_tokens: 20, cache_creation_input_tokens: 3 } } }),
        main({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '模拟主回复' } }),
        child({ type: 'message_start', message: { id: 'SIMULATED-child', usage: { input_tokens: 9999 } } }),
        child({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '模拟子进度' } }),
        child({ type: 'message_stop' }),
        { type: 'assistant', session_id: 'SIMULATED-session', message: { id: 'SIMULATED-main', model: 'SIMULATED-model', content: [{ type: 'text', text: '模拟主回复' }] } },
        ...(mode === 'complete' ? [main({ type: 'message_delta', usage: { output_tokens: 8 } }), main({ type: 'message_stop' }),
        { type: 'result', session_id: 'SIMULATED-session', subtype: 'success', result: '模拟主回复' }] : []),
      ]) deliver(record)
      if (mode === 'interrupted') throw new Error('SIMULATED process interrupted')
      }
    }, end() {}, close: async () => {}, done: Promise.resolve({ exitCode: 0 }),
  }
  const running = runNativeClaude({ argv: ['SIMULATED', '--print', '--output-format', 'stream-json', '--model', 'SIMULATED-model', '--permission-mode', 'acceptEdits', '任务：\nSIMULATED'], preference: { model: 'SIMULATED-model', effort: 'default' }, mode: 'accept-edits', prompt: 'SIMULATED', project: '/tmp', timeoutMs: 1000 }, {
    openStdio: async () => peer, event: (event: any) => f.publish(event), native() {}, session() {}, result() {},
  })
  if (mode === 'interrupted') await expect(running).rejects.toThrow('SIMULATED process interrupted')
  else await running
  await f.finish(mode === 'complete' ? 'completed' : 'interrupted')
  expect(f.requestErrors).not.toHaveBeenCalled()
  expect(f.agentErrors).not.toHaveBeenCalled()
  const log = JSON.stringify(f.agent.session.log)
  expect(log).toContain('模拟主回复')
  expect(log).toContain('模拟子进度')
  expect(log).not.toContain('9999')
  const messages = f.agent.session.log.filter((event) => event.type === 'assistant/message')
  const settled = messages.filter((event) => event.data.usage)
  if (mode === 'complete') {
    expect(settled).toHaveLength(1)
    expect(settled[0]?.data.usage?.totalTokens).toBe(43)
  } else expect(settled).toHaveLength(0)
  expect(f.realTool).not.toHaveBeenCalled()
})

it('names a truncated CLI tool preview in the receipt given to the main agent (synthetic)', async () => {
  const usage = { inputTokens: 5, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 7 }
  const f = await fixture({
    sourceEvents: [
      { kind: 'user', text: 'synthetic input' },
      {
        kind: 'tool',
        text: 'synthetic_cli_tool',
        step: 1,
        state: 'COMPLETED',
        truncated: true,
        outputBytes: 819_200,
        toolCall: { callId: 'existing-call', name: 'synthetic_cli_tool', input: { observed: true }, output: 'preview' },
        response: { id: 'tool-response', blockId: 'tool', index: 0, complete: true, usage },
      },
      {
        kind: 'assistant',
        text: 'final answer',
        step: 2,
        response: { id: 'answer-response', blockId: 'text', index: 0, complete: true, usage },
      },
    ],
  })
  await f.begin()
  await f.finish('completed')
  expect(f.realTool).not.toHaveBeenCalled()
  expect(f.agent.session.log.find((event) => event.type === 'tool/result')?.data.message.content).toEqual([
    { type: 'text', text: 'preview\n\n[输出已截断（共 800 KB），完整内容见 CLI 原生会话或实际产物]' },
  ])
})

it('shows the command of a command-only CLI tool as its call arguments, live and passive (synthetic)', async () => {
  // Codex commandExecution entries carry `command` but no structured input.
  const usage = { inputTokens: 5, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 7 }
  const live = await fixture({ sourceEvents: [
    { kind: 'user', text: 'synthetic input' },
    { kind: 'tool', text: 'printf live', step: 1, state: 'COMPLETED',
      toolCall: { callId: 'live', name: 'commandExecution', command: 'printf live\nsecond', output: 'ok' },
      response: { id: 'tool-response', blockId: 'tool', index: 0, complete: true, usage } },
    { kind: 'tool', text: 'structured', step: 1, state: 'COMPLETED',
      toolCall: { callId: 'structured', name: 'synthetic_cli_tool', input: { path: 'a.txt' }, command: 'ignored', output: 'ok' },
      response: { id: 'tool-response-2', blockId: 'tool', index: 0, complete: true, usage } },
    { kind: 'assistant', text: 'final answer', step: 2,
      response: { id: 'answer-response', blockId: 'text', index: 0, complete: true, usage } },
  ] })
  await live.begin()
  await live.finish('completed')
  expect(live.agent.session.log.filter((event) => event.type === 'tool/call').map((event) => event.data.arguments))
    .toEqual([JSON.stringify({ command: 'printf live\nsecond' }), JSON.stringify({ path: 'a.txt' })])
  const passive = await fixture({ cli: 'hermes', transport: 'hermes-http-v1', sourceEvents: [
    { kind: 'user', text: 'synthetic input' },
    { kind: 'tool', step: 1, text: 'printf passive', state: 'COMPLETED',
      toolCall: { callId: 'passive', name: 'commandExecution', command: 'printf passive', output: 'ok' } },
    { kind: 'assistant', step: 2, text: 'synthetic final answer' },
  ] })
  await passive.begin()
  await passive.finish('completed')
  expect(passive.agent.session.log.filter((event) => event.type === 'tool/call').map((event) => event.data.arguments))
    .toEqual([JSON.stringify({ command: 'printf passive' })])
  expect(live.realTool).not.toHaveBeenCalled()
  expect(passive.realTool).not.toHaveBeenCalled()
})
