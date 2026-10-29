import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { LlmRuntime, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionStore, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { SandboxPolicyService, setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { PlanModeController } from '@deepseek-ai/dsh-plan-mode'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { CliWorkerService } from '../src/host/index.ts'
import { WorkerRuntime } from '../src/host/runtime.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
import { cliLevelOptions, effectiveLevel, runsUnderViewOnly, workerLevelOptions, workerPlanSupported } from '../src/shared/worker-permissions.ts'
import type { Worker } from '../src/shared/types.ts'

// Actual rc.2 Agents, Session/Inbox and sandbox policies; actual Host permission
// methods and durable WorkerRuntime. CLI/model execution is forbidden by this
// fixture, and every directory/account identity is synthetic.
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
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function fixture(cli: Worker['preference']['cli'] = 'codex') {
  const [{ default: AgentLoop }, { default: Projections }, { default: Persistence }, { default: Query }] = await Promise.all([
    loadRuntime('@deepseek-ai/dsh-agent-loop'),
    loadRuntime('@deepseek-ai/dsh-session-projection'),
    loadRuntime('@deepseek-ai/dsh-session-persistence-jsonl'),
    loadRuntime('@deepseek-ai/dsh-session-query'),
  ])
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-worker-permissions-')))
  const ctx = new Context()
  let runtime: WorkerRuntime | undefined
  cleanups.push(async () => {
    await runtime?.close()
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
  await ctx.plugin(PlanModeController, { section: 'Synthetic plan-mode guidance; no model is called.' })
  ctx.provide('typert', { lookups: new Map() } as never)
  const parent = await ctx.agents.create({
    sessionId: SessionId(randomUUID()),
    meta: { cwd: directory },
    agentOptions: { provider: 'unavailable-fixture', model: 'must-not-call' },
  })
  const child = await ctx.agents.create({
    sessionId: SessionId(randomUUID()),
    parentAgent: parent.agent,
    meta: { cwd: directory, origin: 'subagent', parentSession: parent.agent.id },
    agentOptions: { provider: 'unavailable-fixture', model: 'must-not-call' },
  })
  const storage = new WorkerStorage(join(directory, 'workers'))
  const backend: ProcessBackend = {
    resolveExecutable: vi.fn(async () => {
      throw new Error('A permission change must not resolve a CLI executable')
    }),
    spawn: vi.fn(() => {
      throw new Error('A permission change must not start a CLI')
    }),
  }
  runtime = new WorkerRuntime(storage, backend, DEFAULT_CONFIG)
  const worker: Worker = {
    id: randomUUID(),
    parentSessionId: parent.agent.id,
    project: directory,
    title: 'Synthetic permission worker',
    preference: { cli, model: 'reported-model', effort: 'default' },
    mode: 'accept-edits',
    status: 'completed',
    runId: randomUUID(),
    conversationId: 'synthetic-cli-conversation',
    transport: cli === 'kimi' ? 'kimi-acp-v1' : `${cli}-fixture`,
    harnessConversation: {
      sessionId: child.agent.id,
      parentSessionId: parent.agent.id,
      mode: 'continuable',
      capabilities: {
        send: true,
        queue: true,
        steer: false,
        stop: true,
        model: true,
        permission: true,
        plan: true,
        attachments: false,
        fork: false,
        skills: true,
        tools: true,
      },
    },
    createdAt: '2026-10-16T00:00:00Z',
    updatedAt: '2026-10-16T00:00:00Z',
  }
  storage.save(worker)
  storage.bindAccount(worker.id, 'synthetic-account')
  storage.append(worker, { kind: 'user', text: 'Synthetic historical user message' })
  storage.append(worker, { kind: 'assistant', text: 'Synthetic historical answer' })
  const service: CliWorkerService = Object.create(CliWorkerService.prototype)
  Object.defineProperties(service, {
    ctx: { value: ctx },
    runtime: { value: runtime },
    options: { value: DEFAULT_CONFIG },
    disposed: { value: new AbortController() },
    harnessConversation: { value: {
      lookup: (id: string) => id === child.agent.id ? {
        sessionId: child.agent.id, parentSessionId: parent.agent.id, workerId: worker.id,
      } : undefined,
    } },
  })
  const signal = new AbortController().signal
  const read = async () => JSON.parse(await service.permissionForWorker(parent.agent.id, worker.id, signal))
  const save = async (mode: string) =>
    JSON.parse(await service.configureWorkerPermission(parent.agent.id, worker.id, mode, signal)) as Worker
  return {
    ctx,
    directory,
    parent: parent.agent,
    child: child.agent,
    storage,
    runtime,
    backend,
    worker,
    service,
    signal,
    read,
    save,
    cool: async () => {
      await ctx.sessions.flush(child.agent.session)
      await child.dispose()
      expect(ctx.agents.get(child.agent.id)).toBeUndefined()
      expect(ctx.sessions.get(child.agent.id)).toBeUndefined()
    },
  }
}

describe('Host Worker permission changes', () => {
  it('updates a cold child through real persisted projections and notifications without resuming any Agent', async () => {
    const f = await fixture()
    await f.cool()
    const parentSeq = f.parent.session.seq
    const history = f.storage.history(f.worker.id)
    const resume = vi.spyOn(f.ctx.agents, 'resume')
    const observed: unknown[] = []
    f.ctx.sessionProjections.onChanged((session, key, value) => {
      if (session.id === f.child.id && key === 'plan') observed.push(value)
    })
    for (const [mode, active] of [['plan', true], ['accept-edits', false]] as const) {
      expect((await f.save(mode)).mode).toBe(mode)
      expect(observed.at(-1)).toEqual({ active, pending: false })
      expect(f.ctx.agents.get(f.child.id)).toBeUndefined()
      expect(f.ctx.sessions.get(f.child.id)).toBeUndefined()
      const observation = await f.ctx.sessionQuery.observeSession(f.child.id)
      try {
        expect(observation.source).toBe('prepared')
        expect(observation.projections?.values.plan).toEqual({ active, pending: false })
        expect(observation.events.filter((event) => event.type === 'plan/mode').at(-1)?.data)
          .toEqual({ active })
      } finally { observation[Symbol.dispose]() }
      // A fresh exclusive writer proves the temporary lifecycle has released
      // ownership; native continuation can resume normally after the setting.
      const writer = await f.ctx.sessionPersistence.open(f.child.id, 'write')
      await writer.close()
    }
    expect(f.parent.session.seq).toBe(parentSeq)
    expect(f.storage.history(f.worker.id)).toEqual(history)
    expect(resume).not.toHaveBeenCalled()
    expect(f.backend.resolveExecutable).not.toHaveBeenCalled()
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it.each(['next-turn', 'next-step', 'open-turn'] as const)(
    'refuses a cold %s without consuming messages, closing a turn or saving permission', async (target) => {
      const f = await fixture()
      await f.cool()
      const writer = await f.ctx.sessionPersistence.open(f.child.id, 'write')
      const source = await writer.read()
      const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Synthetic retained cold draft' }] })
      await writer.append([target === 'open-turn' ? {
        type: 'turn/start', seq: SessionSeq(source.events.length), time: Date.now(), data: { turn: 1 },
      } : {
        type: 'agent/inbox/spliced', seq: SessionSeq(source.events.length), time: Date.now(),
        data: { target, start: 0, inserted: [message] },
      }])
      await writer.close()
      const before = await f.ctx.sessionPersistence.open(f.child.id, 'read')
      const original = await before.read()
      await before.close()
      await expect(f.save('plan')).rejects.toThrow('原生待发')
      expect(f.runtime.get(f.parent.id, f.worker.id).mode).toBe('accept-edits')
      const after = await f.ctx.sessionPersistence.open(f.child.id, 'read')
      expect((await after.read()).events).toEqual(original.events)
      await after.close()
      expect(f.ctx.sessions.get(f.child.id)).toBeUndefined()
      expect(f.ctx.agents.get(f.child.id)).toBeUndefined()
      expect(f.backend.spawn).not.toHaveBeenCalled()
    },
  )
  it('does not invent completion for an interrupted cold plan command', async () => {
    const f = await fixture()
    await f.cool()
    const writer = await f.ctx.sessionPersistence.open(f.child.id, 'write')
    const source = await writer.read()
    await writer.append([{
      type: 'command/run', seq: SessionSeq(source.events.length), time: Date.now(),
      data: { commandId: randomUUID() as never, name: 'plan', args: 'on', source: { kind: 'user' } },
    }])
    await writer.close()
    await expect(f.save('plan')).rejects.toThrow('原生规划命令尚未完成')
    expect(f.runtime.get(f.parent.id, f.worker.id).mode).toBe('accept-edits')
    const check = await f.ctx.sessionPersistence.open(f.child.id, 'read')
    try {
      expect((await check.read()).events.at(-1)?.type).toBe('command/run')
    } finally { await check.close() }
    expect(f.ctx.agents.get(f.child.id)).toBeUndefined()
    expect(f.ctx.sessions.get(f.child.id)).toBeUndefined()
  })
  it('revalidates parent permissions and the exact binding after a cold read awaits', async () => {
    const f = await fixture()
    await f.cool()
    const open = f.ctx.sessionPersistence.open.bind(f.ctx.sessionPersistence)
    vi.spyOn(f.ctx.sessionPersistence, 'open').mockImplementationOnce(async (...args) => {
      const writer = await open(...args)
      f.parent.ctx.get('planMode')!.set(f.parent, true)
      return writer
    })
    await expect(f.save('plan')).rejects.toThrow('规划模式')
    expect(f.runtime.get(f.parent.id, f.worker.id).mode).toBe('accept-edits')
    const writer = await open(f.child.id, 'write')
    await writer.close()
    expect(f.ctx.sessions.get(f.child.id)).toBeUndefined()
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it.each(['worker-save', 'native-flush'] as const)(
    'reports a cold %s failure and releases the writer, Session and Worker lease', async (failure) => {
      const f = await fixture()
      await f.cool()
      if (failure === 'worker-save') vi.spyOn(f.storage, 'save').mockImplementationOnce(() => {
        throw new Error('Synthetic Worker save failure')
      })
      else vi.spyOn(f.ctx.sessions, 'flush').mockRejectedValueOnce(new Error('Synthetic native flush failure'))
      await expect(f.save('plan')).rejects.toThrow(failure === 'worker-save' ? 'Synthetic Worker save failure' : 'Synthetic native flush failure')
      // The two stores are not an atomic transaction. A failed durability
      // checkpoint must reject even when the Worker choice already committed.
      expect(f.runtime.get(f.parent.id, f.worker.id).mode)
        .toBe(failure === 'worker-save' ? 'accept-edits' : 'plan')
      expect(f.runtime.snapshot(f.parent.id, f.worker.id).selectedBusy).toBe(false)
      expect(f.ctx.sessions.get(f.child.id)).toBeUndefined()
      expect(f.ctx.agents.get(f.child.id)).toBeUndefined()
      const writer = await f.ctx.sessionPersistence.open(f.child.id, 'write')
      const events = (await writer.read()).events
      await writer.close()
      if (failure === 'worker-save') expect(events.some((event) => event.type === 'plan/mode')).toBe(false)
      expect(f.backend.spawn).not.toHaveBeenCalled()
    },
  )
  it('rejects a cold binding replaced during the storage read and releases its original writer', async () => {
    const f = await fixture()
    await f.cool()
    const replacement = randomUUID()
    const open = f.ctx.sessionPersistence.open.bind(f.ctx.sessionPersistence)
    vi.spyOn(f.ctx.sessionPersistence, 'open').mockImplementationOnce(async (...args) => {
      const writer = await open(...args)
      f.storage.save({ ...f.worker, harnessConversation: { ...f.worker.harnessConversation!, sessionId: replacement } })
      return writer
    })
    await expect(f.save('plan')).rejects.toThrow('所属主对话不匹配')
    expect(f.runtime.get(f.parent.id, f.worker.id)).toMatchObject({ mode: 'accept-edits', harnessConversation: { sessionId: replacement } })
    const writer = await open(f.child.id, 'write')
    await writer.close()
    expect(f.ctx.sessions.get(f.child.id)).toBeUndefined()
    expect(f.ctx.agents.get(f.child.id)).toBeUndefined()
  })
  it('only permits the exact live preparation token and rejects stale or cancelled settings saves', async () => {
    const f = await fixture()
    let token = ''
    await f.runtime.prepareFollowup(f.parent.id, f.worker.id, f.signal, async (_signal, preparationId) => {
      token = preparationId
      expect(() => f.runtime.configureWorkerPermission(f.parent.id, f.worker.id, 'plan')).toThrow()
      expect(() => f.runtime.configureWorkerPermission(f.parent.id, f.worker.id, 'plan', randomUUID())).toThrow()
      expect(f.runtime.configureWorkerPermission(f.parent.id, f.worker.id, 'plan', preparationId).mode).toBe('plan')
    })
    expect(() => f.runtime.configureWorkerPermission(f.parent.id, f.worker.id, 'accept-edits', token)).toThrow()
    await f.runtime.prepareFollowup(f.parent.id, f.worker.id, f.signal, async (signal, preparationId) => {
      const stopping = f.runtime.stop(f.parent.id, f.worker.id)
      expect(signal.aborted).toBe(true)
      expect(() => f.runtime.configureWorkerPermission(f.parent.id, f.worker.id, 'accept-edits', preparationId)).toThrow()
      // Stop owns the preparation's final settlement; do not wait for it inside
      // the preparation itself.
      cleanups.push(() => stopping)
    })
    expect(f.runtime.get(f.parent.id, f.worker.id).mode).toBe('plan')
  })
  it('reads and saves supported modes without launching anything or changing conversation/history identities', async () => {
    const f = await fixture()
    const originalHistory = f.storage.history(f.worker.id)
    const parentSeq = f.parent.session.seq
    const childSeq = f.child.session.seq
    // A Worker without a level follows 工作区内修改; the menu lists every level.
    expect(await f.read()).toMatchObject({
      currentValue: 'auto',
      writable: true,
      options: [{ value: 'ask', name: '询问' }, { value: 'auto', name: '自动审批' }, { value: 'full', name: '完全权限' }],
      plan: { supported: true, active: false },
    })
    const saved = await f.save('plan')
    expect(saved).toEqual({ ...f.worker, mode: 'plan' })
    expect(f.runtime.get(f.parent.id, f.worker.id)).toEqual(saved)
    expect(f.storage.history(f.worker.id)).toEqual(originalHistory)
    expect(f.parent.session.seq).toBe(parentSeq)
    expect(f.child.session.seq).toBeGreaterThan(childSeq)
    expect(f.ctx.sessionProjections.snapshot(f.child.session, ['plan']).values.plan).toEqual({
      active: true,
      pending: false,
    })
    expect(f.child.status).toBe('idle')
    expect(f.backend.resolveExecutable).not.toHaveBeenCalled()
    expect(f.backend.spawn).not.toHaveBeenCalled()
    expect((await f.save('accept-edits')).harnessConversation).toEqual(f.worker.harnessConversation)
    // Levels are saved apart from the plan switch.
    expect(await f.save('ask')).toMatchObject({ mode: 'accept-edits', level: 'ask' })
    expect(await f.read()).toMatchObject({ currentValue: 'ask', plan: { active: false } })
    // The user's own choice may sit above the parent's tier.
    expect(await f.save('full')).toMatchObject({ mode: 'accept-edits', level: 'full' })
    expect(await f.read()).toMatchObject({ currentValue: 'full' })
  })
  it("runs a level the user chose whatever the parent's tier", async () => {
    const f = await fixture()
    await f.save('full')
    expect(f.child.ctx.get('sandboxPolicy')!.resolve({ session: f.child.session }).mode).toBe('danger-full-access')
    for (const tier of ['read-only', 'workspace-write', 'danger-full-access'] as const) {
      setSandboxMode(f.parent.session, tier)
      const state = await f.read()
      expect(state.currentValue).toBe('full')
      expect(state.options.map((option: { value: string }) => option.value)).toEqual(['ask', 'auto', 'full'])
      expect(state.options.every((option: { description: string }) => !option.description.includes('主对话为'))).toBe(true)
    }
    expect(f.runtime.get(f.parent.id, f.worker.id).level).toBe('full')
  })
  it('sets the child sandbox from the saved level, below the parent when the Worker asks', async () => {
    const f = await fixture()
    const policy = () => f.child.ctx.get('sandboxPolicy')!.resolve({ session: f.child.session }).mode
    await f.save('ask')
    expect(policy()).toBe('read-only')
    await f.save('auto')
    expect(policy()).toBe('workspace-write')
    await f.save('plan')
    expect(policy()).toBe('read-only')
    await f.save('accept-edits')
    expect(policy()).toBe('workspace-write')
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it('updates the actual child plan projection and sandbox immediately in both directions without changing the parent', async () => {
    const f = await fixture()
    const plan = (agent: typeof f.child) =>
      f.ctx.sessionProjections.snapshot(agent.session, ['plan']).values.plan
    const policy = (agent: typeof f.child) =>
      agent.ctx.get('sandboxPolicy')!.resolve({ session: agent.session }).mode
    const parentSeq = f.parent.session.seq
    const parentPlan = plan(f.parent)
    const parentPolicy = policy(f.parent)
    expect(f.ctx.agents.isOwnedBy(f.child.id, f.parent)).toBe(true)
    expect(plan(f.child)).toEqual({ active: false, pending: false })

    await f.save('plan')
    expect(plan(f.child)).toEqual({ active: true, pending: false })
    expect(f.child.ctx.get('planMode')!.get(f.child)).toEqual({ active: true })
    expect(policy(f.child)).toBe('read-only')
    const childSeq = f.child.session.seq
    await f.save('plan')
    expect(f.child.session.seq).toBe(childSeq)

    await f.save('accept-edits')
    expect(plan(f.child)).toEqual({ active: false, pending: false })
    expect(f.child.ctx.get('planMode')!.get(f.child)).toEqual({ active: false })
    expect(policy(f.child)).toBe(parentPolicy)
    expect(f.parent.session.seq).toBe(parentSeq)
    expect(plan(f.parent)).toEqual(parentPlan)
    expect(policy(f.parent)).toBe(parentPolicy)
    expect(f.child.status).toBe('idle')
    expect(f.child.inbox.nextTurn).toHaveLength(0)
    expect(f.child.inbox.nextStep).toHaveLength(0)
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it('does not touch native plan or sandbox state when saving the Worker fails', async () => {
    const f = await fixture()
    const parentSeq = f.parent.session.seq
    const childSeq = f.child.session.seq
    vi.spyOn(f.storage, 'save').mockImplementationOnce(() => {
      throw new Error('Synthetic storage failure')
    })
    await expect(f.save('plan')).rejects.toThrow('Synthetic storage failure')
    expect(f.runtime.get(f.parent.id, f.worker.id)).toEqual(f.worker)
    expect(f.child.ctx.get('planMode')!.get(f.child)).toEqual({ active: false })
    expect(f.child.ctx.get('sandboxPolicy')!.resolve({ session: f.child.session }).mode).toBe(
      'workspace-write',
    )
    expect(f.parent.session.seq).toBe(parentSeq)
    expect(f.child.session.seq).toBe(childSeq)
  })
  it.each(['parent', 'foreign-child', 'unowned-child'] as const)(
    'rejects a %s display identity before saving or changing any native permissions',
    async (target) => {
      const f = await fixture()
      const foreignParent = await f.ctx.agents.create({
        sessionId: SessionId(randomUUID()),
        meta: { cwd: f.directory },
        agentOptions: { provider: 'unavailable-fixture', model: 'must-not-call' },
      })
      const foreignChild = await f.ctx.agents.create({
        sessionId: SessionId(randomUUID()),
        ...(target === 'foreign-child' ? { parentAgent: foreignParent.agent } : {}),
        meta: {
          cwd: f.directory,
          origin: 'subagent',
          parentSession: target === 'foreign-child' ? foreignParent.agent.id : f.parent.id,
        },
        agentOptions: { provider: 'unavailable-fixture', model: 'must-not-call' },
      })
      const wrong = target === 'parent' ? f.parent : foreignChild.agent
      const stored = {
        ...f.worker,
        harnessConversation: { ...f.worker.harnessConversation!, sessionId: wrong.id },
      }
      f.storage.save(stored)
      const sequences = [f.parent, f.child, foreignParent.agent, foreignChild.agent].map(
        (agent) => agent.session.seq,
      )
      await expect(f.save('plan')).rejects.toThrow('所属主对话不匹配')
      expect(f.runtime.get(f.parent.id, f.worker.id)).toEqual(stored)
      expect(
        [f.parent, f.child, foreignParent.agent, foreignChild.agent].map((agent) => agent.session.seq),
      ).toEqual(sequences)
      expect(wrong.ctx.get('planMode')!.get(wrong)).toEqual({ active: false })
      expect(f.backend.spawn).not.toHaveBeenCalled()
    },
  )
  it('follows a read-only parent until the user picks a level', async () => {
    const f = await fixture()
    const policy = () => f.child.ctx.get('sandboxPolicy')!.resolve({ session: f.child.session }).mode
    setSandboxMode(f.parent.session, 'read-only')
    expect(await f.read()).toMatchObject({ writable: true, currentValue: 'ask', options: [{ value: 'ask' }, { value: 'auto' }, { value: 'full' }] })
    await f.save('accept-edits')
    expect(policy()).toBe('read-only')
    await f.save('auto')
    expect(policy()).toBe('workspace-write')
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it('does not advertise or save a plan mode for Hermes at either Host or runtime boundary', async () => {
    const f = await fixture('hermes')
    // Hermes has no first item.
    expect(await f.read()).toMatchObject({ writable: true, options: [{ value: 'auto' }, { value: 'full' }], plan: { supported: false } })
    await expect(f.save('plan')).rejects.toThrow('不支持')
    expect(() => f.runtime.configureWorkerPermission(f.parent.id, f.worker.id, 'plan')).toThrow('不支持')
    await expect(f.save('ask')).rejects.toThrow('不支持')
    expect((await f.save('accept-edits')).conversationId).toBe(f.worker.conversationId)
    // Under 仅可查看 the user can still pick a level; until then a run is refused.
    setSandboxMode(f.parent.session, 'read-only')
    expect(await f.read()).toMatchObject({ writable: true, options: [{ value: 'auto' }, { value: 'full' }] })
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it.each(['next-turn', 'next-step'] as const)(
    'keeps original native %s messages editable while locking permission changes',
    async (target) => {
      const f = await fixture()
      const message = createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'Synthetic native queued text' }],
      })
      f.child.send(message, target, false)
      const queue = target === 'next-turn' ? f.child.inbox.nextTurn : f.child.inbox.nextStep
      expect(queue.map((entry) => entry.id)).toEqual([message.id])
      expect(await f.read()).toMatchObject({ writable: false, reason: expect.stringContaining('原生待发') })
      await expect(f.save('plan')).rejects.toThrow('原生待发')
      expect(
        (target === 'next-turn' ? f.child.inbox.nextTurn : f.child.inbox.nextStep).map((entry) => entry.id),
      ).toEqual([message.id])
      expect(f.runtime.get(f.parent.id, f.worker.id)).toEqual(f.worker)
      expect(f.child.inbox.splice(target, 0, 1, []).map((entry) => entry.id)).toEqual([message.id])
      expect((await f.save('plan')).mode).toBe('plan')
      expect(f.backend.spawn).not.toHaveBeenCalled()
    },
  )
  it('locks on a paused legacy outbox, preserves its text and identity, then saves after explicit removal', async () => {
    const f = await fixture()
    const queued = f.runtime.queueFollowup(
      f.parent.id,
      f.worker.id,
      'Synthetic paused draft',
      f.worker.runId,
      randomUUID(),
    )
    await f.runtime.stop(f.parent.id, f.worker.id)
    const original = f.runtime.get(f.parent.id, f.worker.id)
    const draft = f.runtime.snapshot(f.parent.id, f.worker.id).queuedFollowups
    expect(draft).toMatchObject([{ id: queued.id, prompt: 'Synthetic paused draft', state: 'paused' }])
    expect(await f.read()).toMatchObject({
      writable: false,
      reason: expect.stringContaining('包含已暂停消息'),
    })
    await expect(f.save('plan')).rejects.toThrow('包含已暂停消息')
    expect(f.runtime.snapshot(f.parent.id, f.worker.id).queuedFollowups).toEqual(draft)
    expect(f.runtime.get(f.parent.id, f.worker.id)).toEqual(original)
    f.runtime.cancelQueuedFollowup(f.parent.id, f.worker.id, queued.id)
    expect(await f.save('plan')).toEqual({ ...original, mode: 'plan' })
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it('locks permission changes while a message admission lease is outstanding', async () => {
    const f = await fixture()
    const reservation = f.runtime.reserveSubmission(f.parent.id, f.worker.id, randomUUID())
    try {
      expect(await f.read()).toMatchObject({ writable: false })
      await expect(f.save('plan')).rejects.toThrow('本轮结束')
      expect(f.runtime.get(f.parent.id, f.worker.id)).toEqual(f.worker)
    } finally {
      reservation.release()
    }
    expect((await f.save('plan')).mode).toBe('plan')
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it('rejects foreign ownership, invalid modes and cancelled saves without modifying persisted choices', async () => {
    const f = await fixture()
    await expect(f.service.permissionForWorker(f.child.id, f.worker.id, f.signal)).rejects.toThrow()
    await expect(
      f.service.configureWorkerPermission(f.child.id, f.worker.id, 'plan', f.signal),
    ).rejects.toThrow()
    for (const mode of ['danger-full-access', 'full-access', 'unknown']) await expect(f.save(mode)).rejects.toThrow()
    const abort = new AbortController()
    abort.abort()
    await expect(
      f.service.configureWorkerPermission(f.parent.id, f.worker.id, 'plan', abort.signal),
    ).rejects.toThrow()
    expect(f.runtime.get(f.parent.id, f.worker.id)).toEqual(f.worker)
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it('advertises Kimi plan only for the verified native ACP route', () => {
    expect(workerPlanSupported({ preference: { cli: 'kimi', model: 'fixture', effort: 'default' } })).toBe(false)
    expect(workerPlanSupported({ preference: { cli: 'kimi', model: 'fixture', effort: 'default' }, transport: 'kimi-acp-v1' })).toBe(true)
  })
  it('names each CLI level for what it really does', () => {
    const names = (cli: NonNullable<Worker['preference']['cli']>) => cliLevelOptions(cli).map((option) => option.name)
    expect(names('codex')).toEqual(['询问', '自动审批', '完全权限'])
    expect(names('antigravity')).toEqual(['仅规划', '自动审批', '完全权限'])
    expect(names('pi')).toEqual(['询问', '自动批准编辑', '完全权限'])
    expect(names('hermes')).toEqual(['自动审批', '完全权限'])
    expect(names('zcode')).toEqual(['询问', '仅工作区编辑', '完全权限'])
    expect(names('opencode')).toEqual(['询问', '仅工作区编辑', '完全权限'])
    expect(names('omp')).toEqual(['询问', '自动批准编辑', '完全权限'])
    // Kimi's native default auto-approves edits inside a Git workspace.
    expect(names('kimi')).toEqual(['仅工作区编辑', '自动审批', '完全权限'])
    expect(names('harness')).toEqual([])
    const codex = { preference: { cli: 'codex' as const, model: 'fixture', effort: 'default' as const } }
    expect(workerLevelOptions(codex).map((option) => option.value)).toEqual(['ask', 'auto', 'full'])
    // Without its own level, a first item that would not ask before every change is refused under 仅可查看.
    for (const cli of ['kimi', 'antigravity', 'hermes'] as const) expect(runsUnderViewOnly(cli)).toBe(false)
    for (const cli of ['codex', 'claude', 'qoder', 'qodercn', 'grok', 'mimo', 'zcode', 'opencode', 'pi', 'omp'] as const)
      expect(runsUnderViewOnly(cli)).toBe(true)
    expect(workerLevelOptions(codex).every((option) => !option.description.includes('主对话为'))).toBe(true)
    expect(effectiveLevel(undefined, 'workspace-write')).toBe('auto')
    expect(effectiveLevel('ask', 'danger-full-access')).toBe('ask')
    // The user's choice runs as chosen, above the parent too.
    expect(effectiveLevel('full', 'read-only')).toBe('full')
    expect(effectiveLevel('auto', 'read-only')).toBe('auto')
  })
})
