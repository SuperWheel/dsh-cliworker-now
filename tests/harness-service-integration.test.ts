import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import { SandboxPolicyService, setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { CliWorkerService } from '../src/host/index.ts'
import { HARNESS_CLI_PROVIDER } from '../src/host/harness-conversation.ts'
import type { Worker } from '../src/shared/types.ts'

// Actual Host constructor, WorkerRuntime, official AgentLoop/continuations and
// private request preparation. Account decisions, process I/O and tool transport
// lease are explicit simulations; no CLI/model/network/user state is accessed.
const leases = vi.hoisted(() => ({
  gates: [] as Array<Promise<void>>,
  closes: [] as Array<ReturnType<typeof vi.fn>>,
  options: [] as any[],
}))
vi.mock('../src/host/authorized-catalog.ts', () => ({
  ACCOUNT_CHANGED: 'synthetic account changed',
  authorizeSelection: vi.fn(async (preference: unknown) => ({ binding: 'synthetic-account', preference })),
  authorizedCatalog: vi.fn(async () => ({ models: [], notice: 'synthetic' })),
}))
vi.mock('../src/host/cli-account-binding.ts', () => ({
  readCliAccountBinding: vi.fn(async () => 'synthetic-account'),
}))
vi.mock('../src/host/extended-adapters.ts', async (original) => ({
  ...(await original<typeof import('../src/host/extended-adapters.ts')>()),
  extendedLaunch: vi.fn(
    async (cli, executable, project, preference, mode, prompt, stateDirectory, config, conversationId) => {
      const { mkdirSync } = await import('node:fs')
      const { prepareNativeWorker } = await import('../src/host/native-worker.ts')
      mkdirSync(stateDirectory, { recursive: true, mode: 0o700 })
      return prepareNativeWorker(
        { argv: [executable], env: {}, cleanup: async () => {} },
        { cli, project, preference, mode, prompt, stateDirectory, conversationId },
        config,
      )
    },
  ),
}))
vi.mock('../src/host/native-harness-tools.ts', async (original) => ({
  ...(await original<typeof import('../src/host/native-harness-tools.ts')>()),
  createNativeHarnessTools: vi.fn(async (options) => {
    leases.options.push(options)
    const gate = leases.gates.shift()
    const close = vi.fn(async () => {
      await gate
    })
    leases.closes.push(close)
    return { connection: undefined, capabilities: { ready: false, toolCount: 0, skills: false }, close }
  }),
}))
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
  leases.gates.length = 0
  leases.closes.length = 0
  leases.options.length = 0
})
function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('runs real native child submissions through CLI once and preserves owned cleanup and recovery', async () => {
  const [{ default: AgentLoop }, { default: Projections }, { default: Persistence }, { default: Query }] =
    await Promise.all([
      loadRuntime('@deepseek-ai/dsh-agent-loop'),
      loadRuntime('@deepseek-ai/dsh-session-projection'),
      loadRuntime('@deepseek-ai/dsh-session-persistence-jsonl'),
      loadRuntime('@deepseek-ai/dsh-session-query'),
    ])
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-harness-service-')))
  const executable = join(directory, 'synthetic-opencode.mjs')
  writeFileSync(executable, '// Synthetic entry; process I/O is simulated by the backend below.\n')
  const ctx = new Context()
  const releaseFirst = deferred()
  leases.gates.push(releaseFirst.promise)
  cleanup.push(async () => {
    releaseFirst.resolve()
    await ctx.fiber.dispose()
    rmSync(directory, { recursive: true, force: true })
  })
  await ctx.plugin(SessionStore)
  await ctx.plugin(Projections)
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: directory })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(Persistence, { root: join(directory, 'native-sessions'), compression: 'none' })
  await ctx.plugin(Query)
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 2 })
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
  const calls: any[] = []
  const jobRuns: any[] = []
  ctx.provide('jobs', {
    start: (spec: any) => {
      jobRuns.push(spec.run())
      return randomUUID()
    },
  } as never)
  ctx.provide('userQuestions', {} as never)
  ctx.provide('typert', { lookups: new Map() } as never)
  ctx.provide('sessionController', {} as never)
  ctx.provide('subprocess', {
    resolveExecutable: async () => executable,
    spawn: (spec: any) => {
      const stdout = new PassThrough(),
        stderr = new PassThrough(),
        outcome = deferred<{ exitCode: number }>()
      const request = JSON.parse(readFileSync(spec.argv.at(-1), 'utf8'))
      const call = { spec, request, exited: false }
      calls.push(call)
      const close = () => {
        if (call.exited) return
        call.exited = true
        stdout.end()
        stderr.end()
        outcome.resolve({ exitCode: 0 })
      }
      queueMicrotask(() => {
        stdout.write(
          JSON.stringify({ type: 'session', id: 'synthetic-native-session', model: 'saved-model' }) + '\n',
        )
        stdout.write(
          JSON.stringify({
            type: 'event',
            event: { kind: 'assistant', step: 0, text: `reply:${request.prompt}` },
          }) + '\n',
        )
        stdout.write(
          JSON.stringify({
            type: 'result',
            status: 'SUCCESS',
            response: `reply:${request.prompt}`,
            resultScope: 'run',
          }) + '\n',
        )
        close()
      })
      return {
        stdout,
        stderr,
        done: outcome.promise,
        terminate: close,
        waitForExit: async () => {
          await outcome.promise
          return true
        },
      }
    },
  } as never)
  const parent = await ctx.agents.create({
    sessionId: SessionId(randomUUID()),
    meta: { cwd: directory },
    agentOptions: { provider: 'unavailable-real-provider', model: 'must-not-call' },
  })
  await ctx.plugin(CliWorkerService, {
    stateDirectory: join(directory, 'workers'),
    maxConcurrent: 1,
    graceMs: 100,
  })
  const service = ctx.cliworker as any
  await vi.waitFor(() => expect(service.harnessConversation).toBeDefined())
  const receipt = JSON.parse(
    await service.launch(
      parent.agent,
      'Synthetic service task',
      'first',
      { cli: 'opencode', model: 'saved-model', effort: 'default' },
      'accept-edits',
      undefined,
      undefined,
      new AbortController().signal,
    ),
  )
  await vi.waitFor(() =>
    expect(leases.closes[0], service.runtime.get(parent.agent.id, receipt.workerId).error).toBeDefined(),
  )
  await vi.waitFor(() => expect(leases.closes[0]).toHaveBeenCalledTimes(1))
  expect(calls).toHaveLength(1)
  expect(calls[0].request.prompt).toBe('first')
  const activeWorker = service.runtime.get(parent.agent.id, receipt.workerId)
  expect(activeWorker.status).toBe('running')
  expect(activeWorker.harnessConversation?.sessionId).toBeDefined()
  const child = ctx.agents.get(SessionId(activeWorker.harnessConversation.sessionId))!
  // Internal routes remain usable by the real AgentLoop while the ordinary
  // main-conversation catalog has no Worker model to offer for selection.
  expect(await ctx.llm.listModels(HARNESS_CLI_PROVIDER)).toEqual([])
  expect(await ctx.llm.resolveModelInfo(HARNESS_CLI_PROVIDER, `worker/${activeWorker.id}`)).toMatchObject({
    provider: HARNESS_CLI_PROVIDER,
    id: `worker/${activeWorker.id}`,
    name: 'opencode · saved-model',
    inputModalities: ['text', 'image'],
  })
  expect(child.session.header).toMatchObject({ origin: 'subagent', parentSession: parent.agent.id })
  expect(child.status).toBe('running')
  releaseFirst.resolve()
  await jobRuns[0].done
  await child.whenIdle()
  expect(service.runtime.get(parent.agent.id, receipt.workerId).status).toBe('completed')
  expect(calls).toHaveLength(1)
  expect(
    child.session
      .deriveMessages()
      .flatMap((message) =>
        message.role === 'assistant'
          ? message.content.filter((block) => block.type === 'text').map((block) => block.text)
          : [],
      ),
  ).toEqual(['reply:first'])

  await ctx.subagents.prompt(
    {
      requestId: randomUUID() as never,
      parentSessionId: parent.agent.id,
      childSessionId: child.id,
      mode: 'continuable',
      delivery: 'queue',
      content: [{ type: 'text', text: 'native continuation' }],
    },
    new AbortController().signal,
  )
  await child.whenIdle()
  expect(calls).toHaveLength(2)
  expect(calls[1].request.prompt).toBe('native continuation')
  expect(activeWorker.harnessConversation.capabilities.send).toBe(true)
  expect(child.inbox.nextTurn).toHaveLength(0)
  await service.launch(
    parent.agent,
    'Synthetic service task',
    'worker continuation',
    activeWorker.preference,
    activeWorker.mode,
    activeWorker.id,
    undefined,
    new AbortController().signal,
  )
  await jobRuns[2].done
  await child.whenIdle()
  expect(calls).toHaveLength(3)
  expect(calls[2].request).toMatchObject({
    prompt: 'worker continuation',
    conversationId: 'synthetic-native-session',
  })
  expect(leases.closes).toHaveLength(3)
  expect(leases.closes.every((close) => close.mock.calls.length === 1)).toBe(true)
  expect(
    child.session
      .deriveMessages()
      .flatMap((message) =>
        message.role === 'assistant'
          ? message.content.filter((block) => block.type === 'text').map((block) => block.text)
          : [],
      ),
  ).toEqual(['reply:first', 'reply:native continuation', 'reply:worker continuation'])
  expect(calls.every((call) => call.exited)).toBe(true)

  // Old direct/queue controls still launch only through WorkerRuntime. Their
  // native display attachment must neither disappear nor launch a duplicate.
  await service.launch(
    parent.agent,
    'Synthetic service task',
    'external direct',
    activeWorker.preference,
    activeWorker.mode,
    activeWorker.id,
    undefined,
    new AbortController().signal,
  )
  await jobRuns[3].done
  await child.whenIdle()
  expect(calls).toHaveLength(4)
  service.runtime.queueFollowup(
    parent.agent.id,
    activeWorker.id,
    'external queue',
    service.runtime.get(parent.agent.id, activeWorker.id).runId,
    randomUUID(),
    true,
  )
  await vi.waitFor(() => expect(calls).toHaveLength(5))
  await jobRuns[4].done
  await child.whenIdle()
  expect(leases.closes).toHaveLength(5)
  expect(leases.closes.every((close) => close.mock.calls.length === 1)).toBe(true)
  expect(
    child.session
      .deriveMessages()
      .flatMap((message) =>
        message.role === 'assistant'
          ? message.content.filter((block) => block.type === 'text').map((block) => block.text)
          : [],
      ),
  ).toEqual(['reply:first', 'reply:native continuation', 'reply:worker continuation', 'reply:external direct', 'reply:external queue'])
  expect(calls.every((call) => call.exited)).toBe(true)

  const unknownWrite = vi.fn(async () => 'synthetic tool output')
  ctx.tools.register(
    defineTool({
      name: 'synthetic_unknown_write',
      description: 'Synthetic unclassified third-party writer',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: unknownWrite,
    }),
  )
  const planReceipt = JSON.parse(
    await service.launch(
      parent.agent,
      'Synthetic plan',
      'plan input',
      activeWorker.preference,
      'plan',
      undefined,
      undefined,
      new AbortController().signal,
    ),
  )
  await jobRuns[5].done
  const planWorker = service.runtime.get(parent.agent.id, planReceipt.workerId)
  const planChild = ctx.agents.get(SessionId(planWorker.harnessConversation.sessionId))!
  await planChild.whenIdle()
  const planTools = await leases.options.at(-1).tools()
  expect(planTools).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'synthetic_unknown_write', execution: 'host' })]))
  // Catalog visibility inherits the real child scope; it does not execute a tool.
  const revoke = planChild.ctx.tools.restrict({ deny: ['synthetic_unknown_write'] })
  expect(await leases.options.at(-1).tools()).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'synthetic_unknown_write' })]))
  revoke()
  expect(ctx.sandboxPolicy.resolve({ session: planChild.session }).mode).toBe('read-only')
  expect(ctx.sandboxPolicy.resolve({ session: parent.agent.session }).mode).toBe('workspace-write')
  expect(unknownWrite).not.toHaveBeenCalled()

  // An invalid native log can fail Client retain.ready before any composer is
  // shown. Explicit repair therefore owns an idle Runtime preparation lease;
  // it must succeed without a fresh user prompt or native CLI process.
  const oldDisplay = service.runtime.get(parent.agent.id, activeWorker.id).harnessConversation.sessionId
  if ('drainChildren' in ctx.subagents && typeof ctx.subagents.drainChildren === 'function')
    await ctx.subagents.drainChildren(parent.agent, [SessionId(oldDisplay)])
  else await ctx.subagents.drainContinuableChildren(parent.agent, [SessionId(oldDisplay)])
  const observe = ctx.sessionQuery.observeSession.bind(ctx.sessionQuery)
  const corrupt = vi.spyOn(ctx.sessionQuery, 'observeSession').mockImplementation(async (id, options) => {
    if (id === oldDisplay)
      throw Object.assign(new Error('Synthetic corrupt display'), { code: 'SESSION_QUERY_CORRUPT_SESSION' })
    return observe(id, options)
  })
  try {
    const repaired = JSON.parse(
      await service.repairHarnessConversation(
        parent.agent.id,
        activeWorker.id,
        oldDisplay,
        new AbortController().signal,
      ),
    )
    const display = ctx.agents.get(SessionId(repaired.sessionId))!
    await display.whenIdle()
    expect(repaired.sessionId).not.toBe(oldDisplay)
    expect(calls).toHaveLength(6)
    expect(service.runtime.get(parent.agent.id, activeWorker.id).conversationId).toBe(
      'synthetic-native-session',
    )
    expect(service.runtime.snapshot(parent.agent.id, activeWorker.id).selectedBusy).toBe(false)
  } finally {
    corrupt.mockRestore()
  }

  // Stop exactly while official initial acceptance is waking the projection,
  // before startContinuable/ensure has returned to Runtime preparation. The
  // callback must never await the same Runtime.done from that admission stack.
  let stopped: Promise<Worker> | undefined
  const removeStopProbe = ctx.on(
    'agent/inbox/inserted',
    ({ agent, message }) => {
      if (
        stopped ||
        agent.session.header.parentSession !== parent.agent.id ||
        message.content[0]?.type !== 'text' ||
        !message.content[0].text.startsWith('cliworker:attach-existing-run:')
      )
        return
      const pending = [...service.runtime.storage.workers.values()].find(
        (worker: Worker) => worker.title === 'Stop during child publication',
      ) as Worker | undefined
      if (pending) stopped = service.runtime.stop(parent.agent.id, pending.id)
    },
    { global: true },
  )
  try {
    const stopReceipt = JSON.parse(
      await service.launch(
        parent.agent,
        'Stop during child publication',
        'must never spawn',
        activeWorker.preference,
        activeWorker.mode,
        undefined,
        undefined,
        new AbortController().signal,
      ),
    )
    await vi.waitFor(() => expect(stopped).toBeDefined())
    await stopped
    await jobRuns[6].done
    expect(service.runtime.get(parent.agent.id, stopReceipt.workerId).status).toBe('interrupted')
    expect(calls).toHaveLength(6)
    expect(leases.closes.every((close) => close.mock.calls.length === 1)).toBe(true)
  } finally {
    removeStopProbe()
  }
  // Once Runtime has admitted a request, a failed job binding must cancel and
  // drain it before the caller sees an error, even though no receipt was sent.
  const brokenJob = vi.spyOn(service.runtime, 'attachJob').mockImplementationOnce(() => {
    throw new Error('Synthetic job binding write failed')
  })
  try {
    await expect(service.launch(
      parent.agent,
      'Failed job binding',
      'must drain without a receipt',
      activeWorker.preference,
      activeWorker.mode,
      undefined,
      undefined,
      new AbortController().signal,
    )).rejects.toThrow('Synthetic job binding write failed')
    const admitted = [...service.runtime.storage.workers.values()].find(
      (worker: any) => worker.title === 'Failed job binding',
    ) as Worker
    expect(admitted.status).toBe('interrupted')
    expect(service.runtime.snapshot(parent.agent.id, admitted.id).selectedBusy).toBe(false)
    expect(service.nativeRunDone.has(admitted.runId)).toBe(false)
    expect(calls).toHaveLength(6)
  } finally {
    brokenJob.mockRestore()
  }
  // 仅可查看 admits read-only dispatch, except a CLI without whole-process read-only.
  setSandboxMode(parent.agent.session, 'read-only')
  await expect(
    service.launch(
      parent.agent,
      'Rejected write',
      'blocked',
      { ...activeWorker.preference, cli: 'antigravity' },
      'accept-edits',
      undefined,
      undefined,
      new AbortController().signal,
    ),
  ).rejects.toThrow('没有整进程只读模式')
  for (const [cli, message] of [['hermes', 'Hermes 未公开只读模式'], ['qoder', 'Qoder 未公开只读模式']] as const)
    await expect(
      service.launch(parent.agent, 'Rejected read-only', 'blocked', { ...activeWorker.preference, cli },
        'plan', undefined, undefined, new AbortController().signal),
    ).rejects.toThrow(message)
  expect(calls).toHaveLength(6)
})
