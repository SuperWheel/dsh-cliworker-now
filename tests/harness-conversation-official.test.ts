import { createNativeHarnessExecutor } from '../src/host/native-harness-executor.ts'
import { mountNativeTools } from './fixtures/harness-native-tools.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry, assembleContextFor } from '@deepseek-ai/dsh-agent'
import { LlmRuntime, ToolCallId, createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { HarnessConversationBridge } from '../src/host/harness-conversation.ts'
import type {
  HarnessConversationDependencies,
  HarnessConversationRecord,
} from '../src/host/harness-conversation-types.ts'
import type { Worker, WorkerEvent } from '../src/shared/types.ts'

// Actual installed rc.2 AgentLoop, continuation manager, Session and tools.
// The worker event source is synthetic. No CLI, model, account or network call.
const runtimeRequire = createRequire(
  process.env.CWN_TEST_HARNESS_PACKAGE ?? realpathSync(new URL('../node_modules/@deepseek-ai/dsh/package.json', import.meta.url)),
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

it('uses real continuable child identity, preserves ordered native history and real child tool policy', async () => {
  const [
    { default: AgentLoop },
    { default: SessionProjectionRegistry },
    { default: JsonlSessionPersistence },
    { default: SessionQueryEngine },
    { default: Commands },
  ] = await Promise.all([
    loadRuntime('@deepseek-ai/dsh-agent-loop'),
    loadRuntime('@deepseek-ai/dsh-session-projection'),
    loadRuntime('@deepseek-ai/dsh-session-persistence-jsonl'),
    loadRuntime('@deepseek-ai/dsh-session-query'),
    loadRuntime('@deepseek-ai/dsh-commands'),
  ])
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-official-conversation-')))
  const ctx = new Context()
  let bridge: HarnessConversationBridge | undefined
  cleanup.push(async () => {
    await bridge?.dispose()
    await ctx.fiber.dispose()
    rmSync(directory, { recursive: true, force: true })
  })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await mountNativeTools(ctx)
  await ctx.plugin(Commands)
  const nativeCommand = vi.fn(() => ({ kind: 'success', text: 'native parent command' }))
  ctx.commands.register({ name: 'plan', description: 'Synthetic native command', handler: nativeCommand })
  const nativeGoal = vi.fn(() => ({ kind: 'success', text: '模拟父会话目标命令' }))
  ctx.commands.register({ name: 'goal', description: '模拟原生目标命令', input: { hint: '[goal]' }, handler: nativeGoal })
  const nativePermission = vi.fn(() => ({ kind: 'success', text: 'synthetic DSH preset only' }))
  ctx.commands.register({
    name: 'permission',
    description: 'Synthetic native permission',
    input: { hint: '<preset>' },
    handler: nativePermission,
  })
  await ctx.plugin(JsonlSessionPersistence, { root: join(directory, 'sessions'), compression: 'none' })
  // The public base supplies exact read/observation; full-text search is unused.
  await ctx.plugin(SessionQueryEngine)
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 2 })
  if (SubagentRuntime.inject?.includes('workingDirectory')) {
    const { default: LocalFs } = await loadRuntime('@deepseek-ai/dsh-fs-local')
    await ctx.plugin(LocalFs)
    const { default: WorkingDirectory } = await loadRuntime('@deepseek-ai/dsh-working-directory')
    await ctx.plugin(WorkingDirectory)
  }
  await ctx.plugin(SubagentRuntime, { maxDepth: 4, maxActiveSubagents: 8 })
  const parent = await ctx.agents.create({
    sessionId: SessionId(randomUUID()),
    meta: { cwd: directory },
    agentOptions: { provider: 'unavailable-dsh-provider', model: 'must-not-call' },
  })
  const parentRequests = vi.fn()
  const parentTurns: number[] = []
  ctx.on(
    'session/event',
    (session, event) => {
      if (session === parent.agent.session && event.type === 'turn/start') parentTurns.push(event.data.turn)
    },
    { global: true },
  )
  ctx.on(
    'llm/stream',
    async function* (options, next) {
      if (options.provider !== 'unavailable-dsh-provider') {
        yield* next()
        return
      }
      parentRequests(options.sessionId)
      yield { type: 'text-delta', index: 0, text: 'synthetic parent reply' } as StreamChunk
      yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
    },
    { global: true },
  )
  const execute = vi.fn(async () => 'official tool result')
  ctx.tools.register(
    defineTool({
      name: 'synthetic_policy_tool',
      description: 'Synthetic permission test',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute,
    }),
  )
  const policy = vi.fn(async (_execution, next) => next())
  ctx.on('tools/pre-execute', policy)
  const worker: Worker = {
    id: randomUUID(),
    parentSessionId: parent.agent.id,
    runId: randomUUID(),
    project: directory,
    title: 'Synthetic official conversation',
    preference: { cli: 'opencode', model: 'saved-model', effort: 'default' },
    mode: 'accept-edits',
    status: 'completed',
    createdAt: '2026-10-16T00:00:00Z',
    updatedAt: '2026-10-16T00:00:00Z',
  }
  const records: HarnessConversationRecord[] = []
  const events: WorkerEvent[] = [
    { kind: 'user', text: 'real user input' },
    { kind: 'assistant', text: 'before', step: 0 },
    {
      kind: 'tool',
      text: 'native_read',
      step: 1,
      state: 'RUNNING',
      toolCall: { callId: 'native-1', name: 'native_read', input: { path: 'synthetic' } },
    },
    {
      kind: 'tool',
      text: 'native_read',
      step: 1,
      state: 'COMPLETED',
      toolCall: { output: 'native file data' },
    },
    { kind: 'assistant', text: 'after', step: 2 },
    { kind: 'result', text: 'beforeafter', resultScope: 'run', state: 'SUCCESS' },
  ].map((event, seq) => ({ ...event, seq, runId: worker.runId, time: worker.updatedAt }) as WorkerEvent)
  const run = vi.fn(
    async (_record: HarnessConversationRecord, prompt: string, _requestId: string, _signal: AbortSignal) => {
      worker.runId = randomUUID()
      // Runtime pre-run preparation during a native composer launch must not
      // enqueue another display attachment of that same run.
      await bridge!.ensure(parent.agent, worker, { projectRun: true, nativeSubmissionId: _requestId })
      for (const event of [
        { kind: 'user', text: prompt },
        { kind: 'assistant', text: `continuation: ${prompt}`, step: 0 },
      ] as const)
        events.push({ ...event, seq: events.length, runId: worker.runId, time: worker.updatedAt })
      return { runId: worker.runId, done: Promise.resolve({ ...worker }) }
    },
  )
  const permission = vi.fn(
    async (_record: HarnessConversationRecord, mode: string | undefined, signal: AbortSignal) => {
      signal.throwIfAborted()
      if (!mode) return `当前 CLI 权限：${worker.mode}；可选：plan、accept-edits`
      if (mode !== 'plan' && mode !== 'accept-edits') throw new Error('Unknown CLI permission mode')
      worker.mode = mode
      return `CLI 权限已保存：${mode}`
    },
  )
  const goal = vi.fn(async (record: HarnessConversationRecord, input: string, signal: AbortSignal) => {
    signal.throwIfAborted()
    expect(record.workerId).toBe(worker.id)
    expect(record.parentSessionId).toBe(worker.parentSessionId)
    return `模拟桥接目标命令：${input || '查询'}`
  })
  const deps: HarnessConversationDependencies = {
    bindings: () => records,
    bind: async (record) => {
      const index = records.findIndex((row) => row.sessionId === record.sessionId)
      if (index < 0) records.push({ ...record })
      else records[index] = { ...record }
    },
    unbind: async (record) => {
      const index = records.findIndex(
        (row) => row.sessionId === record.sessionId && row.workerId === record.workerId,
      )
      if (index >= 0) records.splice(index, 1)
    },
    replaceBinding: async (previous, next) => {
      const index = records.findIndex(
        (row) => row.sessionId === previous.sessionId && row.workerId === previous.workerId,
      )
      if (index < 0) throw new Error('stale synthetic binding')
      records[index] = structuredClone(next)
    },
    getWorker: (parentId, workerId) => {
      if (parentId !== worker.parentSessionId || workerId !== worker.id)
        throw new Error('wrong worker identity')
      return worker
    },
    busy: () => false,
    events: (_record, runId, after) => events.filter((event) => event.runId === runId && event.seq > after),
    subscribe: () => () => {},
    run,
    wait: async () => ({ ...worker }),
    stop: async () => {},
    permission,
    goal,
  }
  bridge = new HarnessConversationBridge(ctx, deps)
  const binding = await bridge.ensure(parent.agent, worker)
  expect(binding.capabilities).toMatchObject({ send: true, queue: true, steer: true, stop: true })
  const child = ctx.agents.get(SessionId(binding.sessionId))!
  expect(child).toBeDefined()
  if ('startActivation' in ctx.subagents) {
    const provider = ctx.subagents.getProvider('cliworker-native-conversation')!
    expect(provider.capabilities).toEqual({ agentOptions: true, agentPreset: false, outputSchema: false, depthLimit: false })
    if ('listChildren' in ctx.subagents && typeof ctx.subagents.listChildren === 'function')
      expect(await ctx.subagents.listChildren(parent.agent.id)).toEqual(expect.arrayContaining([expect.objectContaining({ id: child.id })]))
  }

  expect(child.session.header).toMatchObject({ origin: 'subagent', parentSession: parent.agent.id })
  await child.whenIdle()
  const surface = child.session.deriveMessages()
  const observed = surface.flatMap((message) =>
    message.role === 'assistant' || message.role === 'tool'
      ? message.content.filter((block) => block.type === 'text').map((block) => block.text)
      : [],
  )
  expect(observed).toEqual(['before', 'native file data', 'after'])
  expect(surface.find((message) => message.role === 'user')?.content).toEqual([
    { type: 'text', text: 'real user input' },
  ])
  expect(run).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
  expect((await ctx.commands.execute(child, '/plan', [], new AbortController().signal))?.result)
    .toEqual({ kind: 'success', text: 'CLI 权限已保存：plan' })
  expect(worker.mode).toBe('plan')
  // 模拟 CLI 能力切换；不支持时返回成功提示且不调用权限 API。
  const previousPreference = worker.preference
  worker.preference = { cli: 'qoder', model: '模拟模型', effort: 'default' }
  expect((await ctx.commands.execute(child, '/plan', [], new AbortController().signal))?.result)
    .toEqual({ kind: 'success', text: '当前 CLI 不支持规划模式' })
  expect(permission).toHaveBeenCalledTimes(1)
  worker.preference = previousPreference
  for (const input of ['', '新目标', 'pause', 'resume', 'clear']) {
    expect((await ctx.commands.execute(child, `/goal ${input}`, [], new AbortController().signal))?.result)
      .toEqual({ kind: 'success', text: `模拟桥接目标命令：${input || '查询'}` })
  }
  expect(goal.mock.calls.map(call => call[1])).toEqual(['', '新目标', 'pause', 'resume', 'clear'])
  expect(nativeGoal).not.toHaveBeenCalled()
  expect((await ctx.commands.execute(parent.agent, '/goal', [], new AbortController().signal))?.result)
    .toEqual({ kind: 'success', text: '模拟父会话目标命令' })
  expect(goal).toHaveBeenCalledTimes(5)
  expect(run).not.toHaveBeenCalled()
  expect(nativeCommand).not.toHaveBeenCalled()
  expect(
    (await ctx.commands.execute(parent.agent, '/plan', [], new AbortController().signal))?.result.kind,
  ).toBe('success')
  expect(nativeCommand).toHaveBeenCalledTimes(1)
  expect(
    (await ctx.commands.execute(child, '/permission', [], new AbortController().signal))?.result,
  ).toMatchObject({ kind: 'success', text: expect.stringContaining('当前 CLI 权限') })
  expect(
    (await ctx.commands.execute(child, '/permission plan', [], new AbortController().signal))?.result,
  ).toMatchObject({ kind: 'success', text: 'CLI 权限已保存：plan' })
  expect(worker.mode).toBe('plan')
  expect(
    (await ctx.commands.execute(child, '/permission full-access', [], new AbortController().signal))?.result
      .kind,
  ).toBe('error')
  expect(worker.mode).toBe('plan')
  expect(
    (await ctx.commands.execute(child, '/permission accept-edits', [], new AbortController().signal))?.result
      .kind,
  ).toBe('success')
  expect(nativePermission).not.toHaveBeenCalled()
  expect(permission.mock.calls.map((call) => call[1])).toEqual([
    'plan',
    undefined,
    'plan',
    'full-access',
    'accept-edits',
  ])
  expect(
    (await ctx.commands.execute(parent.agent, '/permission', [], new AbortController().signal))?.result.kind,
  ).toBe('success')
  expect(nativePermission).toHaveBeenCalledTimes(1)
  const lateCommand = vi.fn(() => ({ kind: 'success', text: 'must not clear child' }))
  ctx.commands.register({ name: 'clear', description: 'Late synthetic command', handler: lateCommand })
  expect((await ctx.commands.execute(child, '/clear', [], new AbortController().signal))?.result.kind).toBe(
    'error',
  )
  expect(lateCommand).not.toHaveBeenCalled()
  const readOnlyCommand = vi.fn(() => ({ kind: 'success', text: 'native help' }))
  ctx.commands.register({
    name: 'help',
    description: 'Synthetic read-only command',
    handler: readOnlyCommand,
  })
  expect((await ctx.commands.execute(child, '/help', [], new AbortController().signal))?.result.kind).toBe(
    'success',
  )
  expect(readOnlyCommand).toHaveBeenCalledTimes(1)
  expect(
    child.ctx.tools
      .schemas(assembleContextFor(child))
      .some((schema) => schema.name === 'synthetic_policy_tool'),
  ).toBe(true)
  const executor = await createNativeHarnessExecutor(child.ctx)
  const result = await executor.execute({
    agent: child,
    callId: ToolCallId('controlled-bridge-call'),
    name: 'synthetic_policy_tool',
    arguments: {},
    signal: new AbortController().signal,
  })
  executor.dispose()
  expect(result.isError).toBe(false)
  expect(policy).toHaveBeenCalledTimes(1)
  expect(execute).toHaveBeenCalledTimes(1)
  await ctx.subagents.prompt(
    {
      requestId: 'synthetic-browser-followup' as never,
      parentSessionId: parent.agent.id,
      childSessionId: child.id,
      mode: 'continuable',
      delivery: 'queue',
      content: [{ type: 'text', text: 'ordinary continuation' }],
    },
    new AbortController().signal,
  )
  await child.whenIdle()
  expect(run).toHaveBeenCalledTimes(1)
  expect(run.mock.calls[0]?.[1]).toBe('ordinary continuation')
  await ctx.sessions.flush(child.session)
  expect(
    child.session
      .deriveMessages()
      .filter((message) => message.role === 'assistant')
      .flatMap((message) =>
        message.content.filter((block) => block.type === 'text').map((block) => block.text),
      ),
  ).toEqual(['before', 'after', 'continuation: ordinary continuation'])

  // Actual continuation release notifies its parent with a waking settlement.
  // Removing the inbox row alone is insufficient: idle wakes stay latched, and
  // the native runtime-context could otherwise turn that empty wake into an LLM call.
  if ('drainChildren' in ctx.subagents && typeof ctx.subagents.drainChildren === 'function')
    await ctx.subagents.drainChildren(parent.agent, [child.id])
  else await ctx.subagents.drainContinuableChildren(parent.agent, [child.id])
  await parent.agent.whenIdle()
  expect(parentRequests).not.toHaveBeenCalled()
  expect(parentTurns).toEqual([])
  parent.agent.followup(
    createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'ordinary parent input' }],
    }),
  )
  await parent.agent.whenIdle()
  expect(parentRequests).toHaveBeenCalledTimes(1)
  const unrelatedSource = {
    kind: 'subagent-settled' as const,
    form: 'notice' as const,
    summary: 'Synthetic unrelated child settlement',
    senderSessionId: SessionId(randomUUID()),
  }
  parent.agent.followup(
    createUserMessage({
      source: unrelatedSource,
      content: [{ type: 'text', text: 'unrelated child ended' }],
    }),
  )
  await parent.agent.whenIdle()
  expect(parentRequests).toHaveBeenCalledTimes(2)
  expect(parentTurns).toHaveLength(2)
  parent.agent.followup(
    createUserMessage({
      source: { ...unrelatedSource, senderSessionId: child.id },
      content: [{ type: 'text', text: 'owned settlement concurrent with human input' }],
    }),
  )
  parent.agent.followup(
    createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'ordinary human admitted behind maintenance' }],
    }),
  )
  await parent.agent.whenIdle()
  expect(parentRequests).toHaveBeenCalledTimes(3)
  expect(parentTurns).toHaveLength(3)

  // Release the actual Activation, remount only our bridge, then let the public
  // continuation manager cold-resume the official Agent from its own descriptor.
  if ('drainChildren' in ctx.subagents && typeof ctx.subagents.drainChildren === 'function')
    await ctx.subagents.drainChildren(parent.agent, [child.id])
  else await ctx.subagents.drainContinuableChildren(parent.agent, [child.id])
  expect(ctx.agents.get(child.id)).toBeUndefined()
  await bridge.dispose()
  bridge = new HarnessConversationBridge(ctx, deps)
  expect(await bridge.ensure(parent.agent, worker)).toEqual(binding)
  expect(run).toHaveBeenCalledTimes(1)
  await ctx.subagents.prompt(
    {
      requestId: 'synthetic-cold-followup' as never,
      parentSessionId: parent.agent.id,
      childSessionId: child.id,
      mode: 'continuable',
      delivery: 'queue',
      content: [{ type: 'text', text: 'cold continuation' }],
    },
    new AbortController().signal,
  )
  const resumed = ctx.agents.get(child.id)!
  expect(resumed).not.toBe(child)
  await resumed.whenIdle()
  expect((await ctx.commands.execute(resumed, '/clear', [], new AbortController().signal))?.result.kind).toBe(
    'error',
  )
  expect(lateCommand).not.toHaveBeenCalled()
  expect(run).toHaveBeenCalledTimes(2)
  expect(run.mock.calls[1]?.[1]).toBe('cold continuation')
  expect(
    resumed.session
      .deriveMessages()
      .filter((message) => message.role === 'assistant')
      .flatMap((message) =>
        message.content.filter((block) => block.type === 'text').map((block) => block.text),
      ),
  ).toEqual(['before', 'after', 'continuation: ordinary continuation', 'continuation: cold continuation'])

  // An old Worker queue/direct/interrupt entry already owns this next run.
  // Its native attachment only displays events, including acknowledged steer.
  worker.runId = randomUUID()
  for (const event of [
    { kind: 'user', text: 'external queued input' },
    { kind: 'assistant', text: 'before steer', step: 0 },
    {
      kind: 'user',
      text: 'acknowledged native guidance',
      queuedFollowupId: randomUUID(),
      admittedRunId: worker.runId,
    },
    { kind: 'assistant', text: 'after steer', step: 1 },
  ] as const)
    events.push({ ...event, seq: events.length, runId: worker.runId, time: worker.updatedAt })
  await bridge.ensure(parent.agent, worker, { projectRun: true })
  await resumed.whenIdle()
  expect(run).toHaveBeenCalledTimes(2)
  expect(
    resumed.session
      .deriveMessages()
      .flatMap((message) =>
        message.content.filter((block) => block.type === 'text').map((block) => block.text),
      ),
  ).toEqual(
    expect.arrayContaining([
      'external queued input',
      'before steer',
      'acknowledged native guidance',
      'after steer',
    ]),
  )
  expect(records[0]?.pendingRuns).toEqual([])
  const before = resumed.session.seq
  await bridge.ensure(parent.agent, worker, { projectRun: true })
  expect(resumed.session.seq).toBe(before)
  if ('drainChildren' in ctx.subagents && typeof ctx.subagents.drainChildren === 'function')
    await ctx.subagents.drainChildren(parent.agent, [resumed.id])
  else await ctx.subagents.drainContinuableChildren(parent.agent, [resumed.id])
  const oldHistory = resumed.session.deriveMessages()
  const observe = ctx.sessionQuery.observeSession.bind(ctx.sessionQuery)
  const failedRead = vi.spyOn(ctx.sessionQuery, 'observeSession').mockImplementation(async (id, options) => {
    if (id === resumed.id)
      throw new Error('Synthetic v4 relationship rejection; production logs are never changed')
    return observe(id, options)
  })
  worker.runId = randomUUID()
  for (const event of [
    { kind: 'user', text: 'new admitted input after invalid display' },
    { kind: 'assistant', text: 'recovered projection', step: 0 },
  ] as const)
    events.push({ ...event, seq: events.length, runId: worker.runId, time: worker.updatedAt })
  const recovered = await bridge.ensure(parent.agent, worker, { projectRun: true })
  const recoveredChild = ctx.agents.get(SessionId(recovered.sessionId))!
  await recoveredChild.whenIdle()
  expect(recovered.sessionId).not.toBe(resumed.id)
  expect(records[0]?.retiredSessionIds).toEqual([resumed.id])
  expect(run).toHaveBeenCalledTimes(2)
  expect(resumed.session.deriveMessages()).toEqual(oldHistory)
  expect(
    recoveredChild.session
      .deriveMessages()
      .some((message) =>
        message.content.some((block) => block.type === 'text' && block.text === 'recovered projection'),
      ),
  ).toBe(true)
  failedRead.mockRestore()
  await bridge.dispose()
  await parent.agent.whenIdle()
  expect(parentRequests).toHaveBeenCalledTimes(3)
  expect(parentTurns).toHaveLength(3)
})
