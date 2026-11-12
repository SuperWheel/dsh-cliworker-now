import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { mountNativeTools } from './fixtures/harness-native-tools.ts'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { HarnessConversationBridge } from '../src/host/harness-conversation.ts'
import type { HarnessConversationDependencies, HarnessConversationRecord } from '../src/host/harness-conversation-types.ts'
import type { Worker, WorkerEvent } from '../src/shared/types.ts'

// 模拟 CLI 输出；使用真实已安装 Harness AgentLoop、子会话生命周期和 JSONL 历史服务。
// 不调用真实 CLI、账号或模型。
const runtimeRequire = createRequire(realpathSync(new URL('../node_modules/@deepseek-ai/dsh/package.json', import.meta.url)))
async function loadRuntime(name: string) {
  const module = await import(pathToFileURL(runtimeRequire.resolve(name)).href)
  return { ...module, default: module.default ?? module }
}
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

it.each([false, true])('模拟 CLI：seeds a real same-parent child and cleans up with legacy startup=%s', async (legacy) => {
  const ctx = new Context(), root = realpathSync(mkdtempSync(join(tmpdir(), '模拟分支Harness-')))
  let bridge: HarnessConversationBridge | undefined
  cleanup.push(async () => { await bridge?.dispose(); await ctx.fiber.dispose(); rmSync(root, { recursive: true, force: true }) })
  const [{ default: AgentLoop }, { default: SessionProjection }, { default: Persistence }, { default: Query }, { default: Commands }] = await Promise.all([
    loadRuntime('@deepseek-ai/dsh-agent-loop'), loadRuntime('@deepseek-ai/dsh-session-projection'),
    loadRuntime('@deepseek-ai/dsh-session-persistence-jsonl'), loadRuntime('@deepseek-ai/dsh-session-query'), loadRuntime('@deepseek-ai/dsh-commands'),
  ])
  await ctx.plugin(SessionStore); await ctx.plugin(SessionProjection); await ctx.plugin(AgentRegistry)
  await ctx.plugin(LlmRuntime); await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await mountNativeTools(ctx); await ctx.plugin(Commands)
  ctx.commands.register({ name: 'fork', description: '模拟父会话分支命令', handler: () => ({ kind: 'error', text: '不应调用宿主原生分支' }) })
  await ctx.plugin(Persistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(Query); await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 2 })
  if (SubagentRuntime.inject?.includes('workingDirectory')) {
    await ctx.plugin((await loadRuntime('@deepseek-ai/dsh-fs-local')).default)
    await ctx.plugin((await loadRuntime('@deepseek-ai/dsh-working-directory')).default)
  }
  await ctx.plugin(SubagentRuntime, { maxDepth: 4, maxActiveSubagents: 8 })
  const parent = await ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd: root }, agentOptions: { provider: '模拟不可用宿主', model: '不可调用' } })
  const worker: Worker = { id: randomUUID(), runId: randomUUID(), parentSessionId: parent.agent.id, project: root,
    title: '模拟源 Worker', preference: { cli: 'codex', model: '模拟模型', effort: 'default' }, transport: 'codex-app-v1',
    mode: 'accept-edits', conversationId: '模拟原生源', status: 'completed', createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z' }
  const workers = new Map([[worker.id, worker]]), records: HarnessConversationRecord[] = []
  const events: WorkerEvent[] = [{ kind: 'user', text: '模拟旧任务' }, { kind: 'assistant', text: '模拟旧回复', step: 0 },
    { kind: 'result', text: '模拟旧回复', state: 'SUCCESS', resultScope: 'run' }].map((event, seq) => ({ ...event, seq, runId: worker.runId, time: worker.createdAt } as WorkerEvent))
  const run = vi.fn(async () => { throw new Error('历史复制不得重发旧任务') })
  const fork = vi.fn(async () => '模拟同一分支入口')
  const deps: HarnessConversationDependencies = {
    bindings: () => records, bind: async (record) => { const index = records.findIndex((row) => row.sessionId === record.sessionId); if (index < 0) records.push(structuredClone(record)); else records[index] = structuredClone(record) },
    unbind: async (record) => { const index = records.findIndex((row) => row.sessionId === record.sessionId); if (index >= 0) records.splice(index, 1) },
    getWorker: (parentId, workerId) => { const w = workers.get(workerId); if (!w || w.parentSessionId !== parentId) throw new Error('归属不匹配'); return w },
    busy: () => false, events: (_record, runId, after) => events.filter((event) => event.runId === runId && event.seq > after),
    subscribe: () => () => {}, run, fork, wait: async () => worker, stop: async () => {},
  }
  const realSubagents = ctx.subagents
  const legacyActivations = new Map<string, Awaited<ReturnType<typeof realSubagents.startActivation>>>()
  const legacyFacade = {
    registerProvider: (provider: any) => realSubagents.registerProvider({ ...provider,
      capabilities: { agentOptions: true, agentPreset: false, outputSchema: false, depthLimit: false } }),
    startContinuable: async (spec: any) => {
      const activation = await realSubagents.startActivation({
        ...spec.request, provider: spec.provider, label: spec.label,
        childId: spec.childId, signal: spec.signal, delivery: 'caller',
      })
      legacyActivations.set(activation.childId, activation)
      return { childId: activation.childId }
    },
    drainContinuableChildren: async (_agent: any, ids: string[]) => {
      await Promise.all(ids.map(id => legacyActivations.get(id)?.dispose()))
    },
    prompt: realSubagents.prompt.bind(realSubagents),
  }
  const bridgeContext = legacy ? new Proxy(ctx, { get: (target, key, receiver) => key === 'subagents' ? legacyFacade : Reflect.get(target, key, receiver) }) : ctx
  bridge = new HarnessConversationBridge(bridgeContext, deps)
  worker.harnessConversation = await bridge.ensure(parent.agent, worker)
  const source = ctx.agents.get(SessionId(worker.harnessConversation.sessionId))!
  await source.whenIdle()
  expect((await ctx.commands.execute(source, '/fork', [], new AbortController().signal))?.result).toEqual({ kind: 'success', text: '模拟同一分支入口' })
  expect(fork).toHaveBeenCalledOnce()
  worker.preference.cli = 'hermes'; worker.transport = 'hermes-http-v1'
  expect((await ctx.commands.execute(source, '/fork', [], new AbortController().signal))?.result).toEqual({ kind: 'success', text: expect.stringContaining('不支持') })
  expect(fork).toHaveBeenCalledOnce()
  worker.preference.cli = 'codex'; worker.transport = 'codex-app-v1'
  const sourceEvents = source.session.snapshotEvents()
  const history = await bridge.forkHistory(worker, '', new AbortController().signal)
  expect(history.seed.at(-1)?.type).toBe('turn/end')
  const forked: Worker = { ...structuredClone(worker), id: randomUUID(), conversationId: '模拟原生分支', title: '模拟分支' }
  delete forked.harnessConversation; workers.set(forked.id, forked)
  let createdChild: typeof source | undefined
  ctx.on('agent/created', ({ agent }) => { if (agent.id !== source.id && agent.id !== parent.agent.id) createdChild = agent }, { global: true })
  const branch = await bridge.createFork(parent.agent, forked, history, new AbortController().signal)
  forked.harnessConversation = branch.binding
  expect(records.some((record) => record.workerId === forked.id)).toBe(false)
  const child = createdChild!
  await child.whenIdle()
  expect(child.session.header.parentSession).toBe(parent.agent.id)
  expect(child.session.header.origin).toBe('subagent')
  expect(child.session.inheritedEventCount).toBeGreaterThan(0)
  const childEvents = child.session.snapshotEvents()
  expect(childEvents.slice(0, history.seed.length)).toEqual(history.seed)
  const ownEvents = childEvents.slice(history.seed.length)
  const selected = ownEvents.find((event) => event.type === 'model/selection')
  expect(selected?.data).toEqual({ provider: 'cliworker-native', model: `worker/${forked.id}` })
  expect(selected!.seq).toBeLessThan(ownEvents.find((event) => event.type === 'turn/start')!.seq)
  expect(child.model.current()).toEqual({ provider: 'cliworker-native', model: `worker/${forked.id}` })
  const text = child.session.deriveMessages().flatMap((message) => message.content.filter((block) => block.type === 'text').map((block) => block.text))
  expect(text).toContain('模拟旧任务'); expect(text).toContain('模拟旧回复')
  expect(run).not.toHaveBeenCalled()
  expect(source.session.snapshotEvents()).toEqual(sourceEvents)
  await branch.commit()
  expect(records.some((record) => record.workerId === forked.id)).toBe(true)
  // A bootstrap noop is not a new native completion and must not shift future fork cutoffs.
  const inherited = await bridge.forkHistory(forked, '', new AbortController().signal)
  expect(inherited.runId).toBe(history.runId)
  await branch.rollback()
  expect(records.some((record) => record.workerId === forked.id)).toBe(false)
  expect(ctx.agents.get(SessionId(branch.binding.sessionId))).toBeUndefined()
  expect(source.session.snapshotEvents()).toEqual(sourceEvents)
  expect(run).not.toHaveBeenCalled()
})
