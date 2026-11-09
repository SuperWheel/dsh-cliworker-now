import { afterEach, describe, expect, it, vi } from 'vitest'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import { CliWorkerService } from '../src/host/index.ts'
import { WorkerRuntime } from '../src/host/runtime.ts'
import { runAccess } from '../src/host/native-approval-policy.ts'
import { mountNativeTools } from './fixtures/harness-native-tools.ts'

// Synthetic sessions/catalogs; the registered tools, subject checks and policy are real.
const cleanups: Array<() => unknown> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function fixture() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await mountNativeTools(ctx)
  cleanups.push(() => ctx.fiber.dispose())
  const sessions = new Map<string, any>(), workers = new Map<string, any>()
  let plan = false, sandbox = 'workspace-write'
  const parent: any = { id: 'main', session: { header: { cwd: '/synthetic/main' } }, ctx: { get: (name: string) => ({
    planMode: { get: () => ({ active: plan }) }, sandboxPolicy: { resolve: () => ({ mode: sandbox }) },
    approval: { overrideOf: () => 'ask', config: { policy: 'ask' } },
  })[name] } }
  const child: any = { id: 'child', session: { header: { cwd: '/wrong/child', origin: 'subagent', parentSession: 'main' } }, ctx: parent.ctx }
  sessions.set(parent.id, parent); sessions.set(child.id, child)
  const runtime = { storage: { workers }, assertSiblingCapacity: (id: string) => WorkerRuntime.prototype.assertSiblingCapacity.call(runtime as any, id),
    snapshot: vi.fn((id: string) => ({ workers: [...workers.values()].filter(w => w.parentSessionId === id) })),
    resolveWorker: vi.fn((id: string, workerId: string) => [...workers.values()].find(w => w.parentSessionId === id && w.id === workerId)) }
  // SIMULATION: plugin DSH directory; its own naming/prompt rules are covered in dsh-subagents.test.ts.
  const dshSubagents = {
    list: vi.fn(async () => [] as any[]),
    resolve: vi.fn(async (_parent: string, ref: { id?: string; name?: string }) =>
      ref.name?.toLowerCase() === 'dsh-1' || ref.id === 'native-dsh' ? { id: 'native-dsh', agentName: 'dsh-1', mode: 'continuable', title: '模拟 DSH' } : undefined),
    followup: vi.fn(async (_parent: string, ref: { id?: string; name?: string }) =>
      ref.name?.toLowerCase() === 'dsh-1' ? { kind: 'dsh-subagent', workerId: 'native-dsh', agentName: 'dsh-1', receipt: { messageId: 'sim' } } : undefined),
  }
  const chooseDispatch = vi.fn(async (_agent, _signal, cli, _surface) => ({ preference: { cli, model: 'user-selected', effort: 'high' }, role: null }))
  const launch = vi.fn(async (...args: any[]) => {
    // Assert actual main policy, while publication itself remains simulated.
    service.assertAccessSupported(args[0], args[3].cli, undefined)
    return 'synthetic-background-receipt'
  })
  const service: any = Object.assign(Object.create(CliWorkerService.prototype), {
    ctx: { tools: ctx.tools, agents: sessions, effect: (register: () => unknown) => register(), get: (name: string) => name === 'subagents' ? { listChildren: async () => [{ id: child.id, label: 'Native researcher' }] } : undefined },
    runtime, chooseDispatch, launch, runOrigins: new Map(), runQuestionSessions: new Map(), disposed: new AbortController(),
    dshSubagents,
  })
  service.registerTools()
  const call = (name: string, args: any = {}, caller = child) => ctx.tools.get(name)!.execute(args, { agent: caller, signal: new AbortController().signal } as any)
  const start = (args = {}, caller = child) => call('cliworker_start', { cli: 'codex', title: 'sibling', prompt: 'synthetic', ...args }, caller)
  const source = () => { const worker = { id: 'source', parentSessionId: 'main', agentName: 'Codex-1', runId: 'source-turn', level: 'full', harnessConversation: { sessionId: child.id }, status: 'running' }; workers.set(worker.id, worker); return worker }
  return { ctx, parent, child, sessions, workers, runtime, service, chooseDispatch, launch, start, call, source, dshSubagents,
    plan: () => { plan = true }, viewOnly: () => { sandbox = 'read-only' } }
}

describe('direct children dispatch siblings under the main conversation', () => {
  it('states the actual tier in the dispatch receipt: parent preset when unset, saved level otherwise', async () => {
    const f = await fixture()
    const unset = f.service.permissionReceipt(f.parent, { preference: { cli: 'codebuddy', model: 'm', effort: 'default' }, mode: 'accept-edits', level: undefined })
    expect(unset).toEqual({ permission: { level: 'auto', name: '自动审批', source: 'parent' },
      permissionSummary: '本轮权限：自动审批（此 Worker 未选过档位，跟随主对话权限预设）' })
    expect(f.service.permissionReceipt(f.parent, { preference: { cli: 'codebuddy', model: 'm', effort: 'default' }, mode: 'accept-edits', level: 'ask' }).permission)
      .toEqual({ level: 'ask', name: '询问', source: 'worker' })
    f.viewOnly()
    expect(f.service.permissionReceipt(f.parent, { preference: { cli: 'codex', model: 'm', effort: 'default' }, mode: 'accept-edits', level: undefined }).permission)
      .toMatchObject({ level: 'ask', source: 'parent' })
    expect(f.ctx.tools.get('cliworker_start')!.description).toContain('permission')
  })
  it('uses main project and selected settings, ignores initiator model/role/session/level fields', async () => {
    const f = await fixture(), source = f.source()
    f.service.runOrigins.set(source.runId, 'agent')
    await f.start({ model: 'invented', effort: 'low', role: { name: 'invented' }, sessionId: 'stolen', conversationId: 'stolen', level: 'full' })
    const args = f.launch.mock.calls[0]!
    expect(args[0]).toBe(f.parent)
    expect(args[3]).toEqual({ cli: 'codex', model: 'user-selected', effort: 'high' })
    expect(args[5]).toBeUndefined()
    expect(args[6]).toEqual({ agentName: undefined, role: undefined, initiator: { kind: 'worker', id: 'source', name: 'Codex-1' } })
    expect(args[14]).toBe('main')
    expect(runAccess(args[4], args[6].level, f.service.permissionState(args[0]))).toBe('workspace-write')
  })
  it.each(['agent', 'user'])('routes %s-started Worker turn selection and later approvals to the same surface', async origin => {
    const f = await fixture(), source = f.source()
    f.service.runOrigins.set(source.runId, origin)
    await f.start()
    const surface = origin === 'agent' ? f.parent : f.child
    expect(f.chooseDispatch.mock.calls[0]![3]).toBe(surface)
    expect(f.launch.mock.calls[0]![14]).toBe(surface.id)
  })
  it('attributes a native child by catalog name and asks on main', async () => {
    const f = await fixture()
    expect(await f.start()).toBe('synthetic-background-receipt')
    expect(f.launch.mock.calls[0]![6].initiator).toEqual({ kind: 'subagent', id: f.child.id, name: 'Native researcher' })
    expect(f.chooseDispatch.mock.calls[0]![3]).toBe(f.parent)
  })
  it('allows a sibling initiated by another sibling to dispatch without adding a level', async () => {
    const f = await fixture(), source = f.source()
    Object.assign(source, { initiator: { kind: 'worker', id: 'older', name: 'Older' } })
    await f.start()
    expect(f.launch.mock.calls[0]![0]).toBe(f.parent)
  })
  it.each(['missing', 'third-level'])('rejects %s parent before selection or creation', async kind => {
    const f = await fixture()
    if (kind === 'missing') f.sessions.delete(f.parent.id)
    else f.parent.session.header.origin = 'subagent'
    for (const name of ['cliworker_start', 'cliworker_status'])
      await expect(f.call(name, name === 'cliworker_start' ? { cli: 'codex', title: 'test', prompt: 'synthetic' } : {})).rejects.toThrow(kind === 'missing' ? '无法解析' : '第三层')
    expect(f.chooseDispatch).not.toHaveBeenCalled(); expect(f.launch).not.toHaveBeenCalled()
  })
  it('checks main planning state, while status stays read-only and non-blocking', async () => {
    const f = await fixture(); f.source(); f.plan()
    await expect(f.start()).rejects.toThrow('规划模式')
    expect(JSON.parse(await f.call('cliworker_status') as string)).toHaveLength(1)
    expect(f.runtime.snapshot).toHaveBeenCalledWith('main')
    expect(f.chooseDispatch).not.toHaveBeenCalled()
  })
  it('applies main view-only policy even if the source has full access', async () => {
    const f = await fixture(); f.source(); f.viewOnly()
    await f.start()
    expect(runAccess('accept-edits', undefined, f.service.permissionState(f.launch.mock.calls[0]![0]))).toBe('read-only')
    await expect(f.start({ cli: 'hermes' })).rejects.toThrow('仅可查看')
  })
  it('selection cancellation does not publish a task', async () => {
    const f = await fixture()
    f.chooseDispatch.mockRejectedValueOnce(new Error('用户取消'))
    await expect(f.start()).rejects.toThrow('用户取消')
    expect(f.launch).not.toHaveBeenCalled()
  })
  it('counts six unfinished initiator records per main, excluding main dispatches and terminal states', async () => {
    const f = await fixture()
    for (let i = 0; i < 6; i++) f.workers.set(`s${i}`, { id: `s${i}`, parentSessionId: 'main', status: i % 2 ? 'queued' : 'running', initiator: { kind: 'subagent', id: 'other', name: 'Other' } })
    await expect(f.start()).rejects.toThrow('已达上限')
    expect(f.chooseDispatch).not.toHaveBeenCalled(); expect(f.launch).not.toHaveBeenCalled()
    await f.start({}, f.parent)
    f.workers.get('s0').status = 'completed'
    f.workers.set('other', { parentSessionId: 'elsewhere', status: 'running', initiator: {} })
    await f.start()
    expect(f.launch).toHaveBeenCalledTimes(2)
  })
  it('real DSH scoped schemas already include both plugin tools in a direct child scope', async () => {
    const f = await fixture()
    const scope = createScope(f.ctx, f.child)
    cleanups.push(() => scope.dispose())
    const names = f.ctx.tools.schemas(f.child).map(tool => tool.name)
    expect(names).toContain('cliworker_start'); expect(names).toContain('cliworker_status')
    // An explicit user/preset tool restriction remains authoritative.
    await scope.ctx.inject(['tools'], ctx => ctx.tools.restrict({ deny: ['cliworker_start'] }))
    expect(f.ctx.tools.schemas(f.child).map(tool => tool.name)).not.toContain('cliworker_start')
  })
})

describe('DSH native subagents are addressable by their dsh-N name', () => {
  it('continues dsh-N through cliworker_followup only after no CLI Worker matches; other misses keep the CLI error', async () => {
    const f = await fixture()
    f.runtime.resolveWorker.mockImplementation(() => { throw new Error('当前对话中没有此名称的智能体，请检查名称或使用 worker_id') })
    const reply = JSON.parse(await f.call('cliworker_followup', { worker_name: 'dsh-1', prompt: '模拟续聊' }, f.parent) as string)
    expect(reply).toMatchObject({ kind: 'dsh-subagent', agentName: 'dsh-1' })
    expect(f.dshSubagents.followup).toHaveBeenCalledWith('main', { id: undefined, name: 'dsh-1' }, '模拟续聊', expect.any(AbortSignal))
    await expect(f.call('cliworker_followup', { worker_name: 'codex-9', prompt: 'x' }, f.parent)).rejects.toThrow('没有此名称')
    await expect(f.call('cliworker_followup', { worker_name: 'dsh-7', prompt: 'x' }, f.parent)).rejects.toThrow('没有此名称')
    expect(f.dshSubagents.followup).toHaveBeenCalledTimes(2)
  })
  it('respects the window switch: hidden DSH group means names are not resolved', async () => {
    const f = await fixture()
    f.runtime.resolveWorker.mockImplementation(() => { throw new Error('当前对话中没有此名称的智能体') })
    f.runtime.snapshot.mockImplementation(() => ({ workers: [], showDshSubagents: false }) as any)
    await expect(f.call('cliworker_followup', { worker_name: 'dsh-1', prompt: 'x' }, f.parent)).rejects.toThrow('没有此名称')
    expect(JSON.parse(await f.call('cliworker_status', {}, f.parent) as string)).toEqual([])
    expect(f.dshSubagents.followup).not.toHaveBeenCalled(); expect(f.dshSubagents.list).not.toHaveBeenCalled()
  })
  it('lists DSH rows with their names in status and resolves one by name, read-only', async () => {
    const f = await fixture(); f.source()
    f.dshSubagents.list.mockResolvedValue([{ id: 'native-dsh', agentName: 'dsh-1', name: '模拟 DSH', status: 'completed', mode: 'continuable', model: 'sim-model' }])
    const rows = JSON.parse(await f.call('cliworker_status', {}, f.parent) as string)
    expect(rows.map((row: any) => row.agentName)).toEqual(['Codex-1', 'dsh-1'])
    expect(rows[1]).toEqual({ kind: 'dsh-subagent', workerId: 'native-dsh', agentName: 'dsh-1', title: '模拟 DSH', status: 'completed', model: 'sim-model', mode: 'continuable' })
    f.runtime.resolveWorker.mockImplementation(() => { throw new Error('当前对话中没有此名称的智能体') })
    expect(JSON.parse(await f.call('cliworker_status', { worker_name: 'DSH-1' }, f.parent) as string)).toMatchObject({ kind: 'dsh-subagent', workerId: 'native-dsh' })
    expect(f.dshSubagents.followup).not.toHaveBeenCalled()
  })
})
