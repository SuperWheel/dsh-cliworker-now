import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Worker } from '../src/shared/types.ts'
import type { HarnessConversationRecord } from '../src/host/harness-conversation-types.ts'
import { forkWorkerConversation, forkWorkerName, nativeForkCut, selectForkHistory,
  readWorkerForkState, writeWorkerForkState, type WorkerForkDependencies } from '../src/host/worker-fork.ts'
import { bridgedFeatureSupport } from '../src/shared/conversation-features.ts'
import { WorkerRuntime } from '../src/host/runtime.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'

// 模拟：所有原生会话 ID、CLI 回执和 Harness 历史；不调用账号、CLI 或模型。
const cleanup: Array<() => unknown> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
function fixture(cli: Worker['preference']['cli'] = 'codex') {
  const worker: Worker = { id: randomUUID(), runId: randomUUID(), parentSessionId: '模拟父会话', project: '/模拟项目',
    title: '原任务', agentName: '会计', preference: { cli, model: '模拟模型', effort: 'high' }, mode: 'plan',
    transport: ({ codex: 'codex-app-v1', claude: 'claude-stream-v1', kimi: 'kimi-acp-v1', mimo: 'mimo-http-v1',
      pi: 'pi-rpc-v1', opencode: 'opencode-http-v1', zcode: 'zcode-app-v1', qoder: 'qoder-acp-v1', qodercn: 'qodercn-acp-v1' } as Record<string, string>)[cli!],
    status: 'completed', conversationId: '原生原会话', createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z',
    goal: { objective: '模拟目标', status: 'paused', revision: 8, updatedAt: '2026-10-20T00:00:00Z' },
    harnessConversation: { sessionId: '模拟子会话', parentSessionId: '模拟父会话', mode: 'continuable', capabilities: {
      send: true, queue: true, steer: false, stop: true, model: true, permission: true,
      plan: true, attachments: false, fork: true, skills: false, tools: false,
      goal: false, feedback: false, forkEarlier: false,
    } } }
  const firstRun = randomUUID()
  const record: HarnessConversationRecord = { workerId: worker.id, parentSessionId: worker.parentSessionId,
    sessionId: worker.harnessConversation!.sessionId, turnRuns: [{ turn: 1, runId: firstRun }, { turn: 2, runId: worker.runId }] }
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'assistant/message', data: { turn: 1, step: 1, message: { id: '助手1', role: 'assistant', content: [] } } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'assistant/message', data: { turn: 2, step: 1, message: { id: '助手2', role: 'assistant', content: [] } } },
    { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
  ].map((event, seq) => ({ ...event, seq, time: 0 })) as unknown as SessionEvent[]
  const nativeRollback = vi.fn(async () => {})
  const childRollback = vi.fn(async () => {})
  const commit = vi.fn(async () => {})
  const deps: WorkerForkDependencies = { worker, workers: () => [worker], assertIdle: vi.fn(),
    history: vi.fn(async (at) => selectForkHistory(events, record, at)),
    raw: vi.fn(() => JSON.stringify({ type: 'native', record: { method: 'turn/completed', params: {
      threadId: worker.conversationId, turn: { id: '原生轮2', status: 'completed' } } } }) + '\n'),
    native: vi.fn(async () => ({ conversationId: '原生新会话', rollback: nativeRollback })), stage: vi.fn(),
    child: vi.fn(async () => ({ binding: { ...worker.harnessConversation!, sessionId: '分支子会话' }, commit, rollback: childRollback })),
    publish: vi.fn(), remove: vi.fn(), changed: vi.fn() }
  return { worker, firstRun, events, record, deps, commit, nativeRollback, childRollback }
}
const signal = () => new AbortController().signal

describe('模拟：完成轮与原生截点', () => {
  it('empty and latest message IDs resolve to the same complete turn; earlier includes its end', () => {
    const f = fixture()
    expect(selectForkHistory(f.events, f.record, '')).toEqual(selectForkHistory(f.events, f.record, '助手2'))
    const early = selectForkHistory(f.events, f.record, '助手1')
    expect(early).toMatchObject({ earlier: true, runId: f.firstRun, turn: 1 })
    expect(early.seed).toHaveLength(3)
    expect(early.seed.at(-1)?.type).toBe('turn/end')
    expect(f.events).toHaveLength(6)
  })
  it.each(['别人的消息', 'user-id'])('rejects unknown or non-assistant cutoff %s', (at) => {
    const f = fixture(); expect(() => selectForkHistory(f.events, f.record, at)).toThrow('助手消息')
  })
  it('rejects a non-final assistant within a completed turn', () => {
    const f = fixture()
    f.events.splice(2, 0, { ...f.events[1]!, data: { ...(f.events[1] as any).data, message: { id: '后续助手' } } } as never)
    expect(() => selectForkHistory(f.events, f.record, '助手1')).toThrow('最后一条')
  })
  it('ignores a settled fork-bootstrap noop, preserving the last real completed turn', () => {
    const f = fixture(); f.events.push({ type: 'turn/end', seq: 6, data: { turn: 3, reason: { kind: 'completed' } } } as never)
    expect(selectForkHistory(f.events, f.record, '').runId).toBe(f.worker.runId)
  })
  it('refuses missing run associations and ambiguous native completion receipts', () => {
    const f = fixture(); f.record.turnRuns = []
    expect(() => selectForkHistory(f.events, f.record, '助手2')).toThrow()
    const raw = f.deps.raw(f.worker.runId)
    expect(nativeForkCut('codex', raw, f.worker.conversationId!)).toEqual({ turnId: '原生轮2' })
    expect(() => nativeForkCut('codex', raw + raw, f.worker.conversationId!)).toThrow('唯一')
    expect(() => nativeForkCut('codex', raw, '别的会话')).toThrow('唯一')
  })
  it('never fabricates Pi/OpenCode/ZCode native cutoff IDs', () => {
    for (const cli of ['pi', 'opencode', 'zcode']) expect(() => nativeForkCut(cli, '', 'id')).toThrow('可靠')
  })
})

describe('模拟：分支事务', () => {
  it('copies settings and resets goal revision; publishes only after native and child success', async () => {
    const f = fixture(), source = structuredClone(f.worker)
    const result = await forkWorkerConversation(f.deps, '', signal())
    const child = vi.mocked(f.deps.publish).mock.calls[0]![0]
    expect(result).toEqual({ workerId: child.id, childSessionId: '分支子会话' })
    expect(child).toMatchObject({ preference: source.preference, mode: source.mode, transport: source.transport,
      project: source.project, parentSessionId: source.parentSessionId, agentName: 'codex-fork-1', conversationId: '原生新会话',
      goal: { objective: '模拟目标', status: 'paused', revision: 1 } })
    expect(child.preference).not.toBe(source.preference)
    expect(f.worker).toEqual(source)
    expect(f.deps.native).toHaveBeenCalledWith({ turnId: '原生轮2' })
    expect(vi.mocked(f.deps.native).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.deps.child).mock.invocationCallOrder[0]!)
    expect(vi.mocked(f.deps.child).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.deps.publish).mock.invocationCallOrder[0]!)
    expect(f.nativeRollback).not.toHaveBeenCalled()
  })
  it('names are unique within their parent, including archived names and aliases', () => {
    const f = fixture()
    expect(forkWorkerName(f.worker, [f.worker, { ...f.worker, agentName: 'codex-fork-1', archivedAt: '旧' },
      { ...f.worker, agentName: '其他', nameAliases: ['codex-fork-2'] },
      { ...f.worker, parentSessionId: '另一个父', agentName: 'codex-fork-3' }])).toBe('codex-fork-3')
  })
  it.each(['assertIdle', 'history', 'native', 'stage', 'child', 'publish'])('cleans up after %s fails without resending any task', async (step) => {
    const f = fixture(), before = structuredClone(f.worker)
    vi.mocked(f.deps[step as keyof WorkerForkDependencies] as any).mockImplementation(() => { throw new Error(`模拟-${step}`) })
    await expect(forkWorkerConversation(f.deps, '', signal())).rejects.toThrow(`模拟-${step}`)
    expect(f.deps.changed).not.toHaveBeenCalled()
    if (['stage', 'child', 'publish'].includes(step)) expect(f.nativeRollback).toHaveBeenCalledOnce()
    if (step === 'publish') expect(f.childRollback).toHaveBeenCalledOnce()
    expect(f.worker).toEqual(before)
  })
  it('rolls back Worker, child and native resource after binding commit failure', async () => {
    const f = fixture(); f.commit.mockRejectedValue(new Error('模拟绑定失败'))
    await expect(forkWorkerConversation(f.deps, '', signal())).rejects.toThrow('模拟绑定失败')
    expect(f.childRollback).toHaveBeenCalledOnce(); expect(f.deps.remove).toHaveBeenCalledOnce()
    expect(f.nativeRollback).toHaveBeenCalledOnce(); expect(f.deps.changed).not.toHaveBeenCalled()
  })
  it('reports undeletable native resources without hiding the original failure', async () => {
    const f = fixture(); f.commit.mockRejectedValue(new Error('模拟绑定失败'))
    f.nativeRollback.mockRejectedValue(new Error('模拟原生分支已归档，不能永久删除'))
    const error = await forkWorkerConversation(f.deps, '', signal()).catch((error) => error)
    expect(error).toBeInstanceOf(AggregateError); expect(error.errors.map(String).join()).toContain('模拟绑定失败')
    expect(error.message).toContain('不能永久删除')
  })
  it.each(['antigravity', 'hermes', 'grok', 'omp'] as const)('rejects unsupported %s before native/child operations', async (cli) => {
    const f = fixture(cli)
    await expect(forkWorkerConversation(f.deps, '', signal())).rejects.toThrow('不支持')
    expect(f.deps.native).not.toHaveBeenCalled(); expect(f.deps.child).not.toHaveBeenCalled()
  })
  it.each(['pi', 'opencode', 'zcode', 'kimi', 'mimo', 'qoder', 'qodercn', 'claude'] as const)('downgrades earlier %s cutoffs before any native operation', async (cli) => {
    const f = fixture(cli)
    await expect(forkWorkerConversation(f.deps, '助手1', signal())).rejects.toThrow('最新一轮')
    expect(f.deps.native).not.toHaveBeenCalled()
  })
  it('defers Claude with the exact saved UUID and never replays the old user task', async () => {
    const f = fixture('claude')
    vi.mocked(f.deps.raw).mockReturnValue(JSON.stringify({ type: 'native', record: { type: 'assistant', uuid: '原生助手UUID', session_id: f.worker.conversationId } }) + '\n')
    await forkWorkerConversation(f.deps, '', signal())
    expect(f.deps.native).not.toHaveBeenCalled()
    const [worker, , state] = vi.mocked(f.deps.publish).mock.calls[0]!
    expect(worker.conversationId).toBeUndefined()
    expect(state).toMatchObject({ sourceConversationId: '原生原会话', sourceMessageId: '原生助手UUID' })
    expect(f.worker.conversationId).toBe('原生原会话')
  })
  it('refuses a native latest fork that would accidentally include a later failed run', async () => {
    const f = fixture('opencode')
    f.worker.runId = randomUUID()
    await expect(forkWorkerConversation(f.deps, '', signal())).rejects.toThrow('后续失败运行之前')
    expect(f.deps.native).not.toHaveBeenCalled()
  })
  it('rejects legacy transports and aborted requests before native work', async () => {
    const f = fixture(); f.worker.transport = 'legacy'
    expect(bridgedFeatureSupport(f.worker).fork.supported).toBe(false)
    await expect(forkWorkerConversation(f.deps, '', signal())).rejects.toThrow('通信协议')
    const g = fixture(), controller = new AbortController(); controller.abort(new Error('模拟取消'))
    await expect(forkWorkerConversation(g.deps, '', controller.signal)).rejects.toThrow('模拟取消')
    expect(g.deps.native).not.toHaveBeenCalled()
  })
  it('persists pending fork state privately and clears it after the real session receipt', () => {
    const directory = mkdtempSync(join(tmpdir(), '模拟分支状态-')); cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
    const id = randomUUID(), state = { sourceConversationId: '原ID', sourceMessageId: 'UUID', historySourceWorkerId: randomUUID() }
    writeWorkerForkState(directory, id, state)
    expect(readWorkerForkState(directory, id)).toEqual(state)
    if (process.platform !== 'win32') expect(statSync(join(directory, `${id}.fork.json`)).mode & 0o777).toBe(0o600)
    writeWorkerForkState(directory, id)
    expect(readWorkerForkState(directory, id)).toBeUndefined()
  })
})

describe('模拟：Runtime 归属、忙碌和持久化', () => {
  function runtimeFixture(cli: Worker['preference']['cli'] = 'codex') {
    const f = fixture(cli), directory = mkdtempSync(join(tmpdir(), '模拟分支Runtime-'))
    const storage = new WorkerStorage(join(directory, 'state'))
    const backend = { resolveExecutable: vi.fn(), spawn: vi.fn(() => { throw new Error('不允许启动真实 CLI') }) }
    const runtime = new WorkerRuntime(storage, backend, DEFAULT_CONFIG)
    cleanup.push(async () => { await runtime.close(); rmSync(directory, { recursive: true, force: true }) })
    storage.save(f.worker); storage.bindAccount(f.worker.id, '模拟账号epoch')
    storage.append(f.worker, { kind: 'user', text: '模拟旧任务' })
    storage.append(f.worker, { kind: 'assistant', text: '模拟旧回复' })
    const bridge = { forkHistory: (_worker: Worker, at: string) => f.deps.history(at),
      createFork: (_parent: unknown, worker: Worker, history: any) => f.deps.child(worker, history) } as any
    return { ...f, storage, runtime, backend, bridge, parent: { id: f.worker.parentSessionId } as any }
  }
  it.each(['opencode', 'zcode', 'pi'] as const)('%s forks retain the native session store through restart and nested forks', async (cli) => {
    const f = runtimeFixture(cli), original = structuredClone(f.worker)
    vi.spyOn(f.runtime as any, 'forkNative').mockResolvedValue({ conversationId: '模拟分支ID', rollback: f.nativeRollback })
    const first = await f.runtime.forkWorker(f.parent, f.worker.id, '', f.bridge, signal())
    const root = join(f.storage.directory, 'native', f.worker.id)
    expect(readWorkerForkState(f.storage.directory, first.workerId)?.nativeStateWorkerId).toBe(f.worker.id)
    // Reload private metadata and Worker snapshots, as on Host restart. Both task
    // launch and metadata fork use nativeStateDirectory to locate the same DB.
    await f.runtime.close()
    const storage = new WorkerStorage(f.storage.directory)
    const runtime = new WorkerRuntime(storage, f.backend, DEFAULT_CONFIG)
    cleanup.push(() => runtime.close())
    const child = runtime.get(f.worker.parentSessionId, first.workerId)
    expect((runtime as any).nativeStateDirectory(child)).toBe(root)
    vi.spyOn(runtime as any, 'forkNative').mockResolvedValue({ conversationId: '模拟孙分支ID', rollback: f.nativeRollback })
    const second = await runtime.forkWorker(f.parent, child.id, '', f.bridge, signal())
    const grandchild = runtime.get(f.worker.parentSessionId, second.workerId)
    expect(readWorkerForkState(storage.directory, grandchild.id)?.nativeStateWorkerId).toBe(f.worker.id)
    expect((runtime as any).nativeStateDirectory(grandchild)).toBe(root)
    expect(runtime.get(original.parentSessionId, original.id)).toEqual(original)
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it('rejects foreign parents and unknown Workers without starting native metadata', async () => {
    const f = runtimeFixture()
    await expect(f.runtime.forkWorker({ id: '其他父会话' } as any, f.worker.id, '', f.bridge, signal())).rejects.toThrow('does not belong')
    await expect(f.runtime.forkWorker(f.parent, randomUUID(), '', f.bridge, signal())).rejects.toThrow('does not belong')
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it.each(['running', 'queued', 'stopping'] as const)('rejects %s with the required wait message', async (status) => {
    const f = runtimeFixture(); f.worker.status = status
    await expect(f.runtime.forkWorker(f.parent, f.worker.id, '', f.bridge, signal())).rejects.toThrow('请等待当前运行结束后再分支')
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it('rejects even paused queued followups', async () => {
    const f = runtimeFixture(); vi.spyOn((f.runtime as any).followups, 'list').mockReturnValue([{ state: 'paused' }])
    await expect(f.runtime.forkWorker(f.parent, f.worker.id, '', f.bridge, signal())).rejects.toThrow('请等待当前运行结束后再分支')
  })
  it('publishes copied history only through the cutoff and preserves the old Worker', async () => {
    const f = runtimeFixture(), original = structuredClone(f.worker)
    vi.mocked(f.deps.raw).mockClear()
    // Native metadata is simulated; inspect raw mapping independently in the tests above.
    const rawPath = f.storage.rawPath(f.worker)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(rawPath, f.deps.raw(f.worker.runId))
    vi.spyOn(f.runtime as any, 'forkNative').mockResolvedValue({ conversationId: '分支真实回执ID（模拟）', rollback: f.nativeRollback })
    const later = { ...f.worker, runId: randomUUID() }; f.storage.append(later, { kind: 'assistant', text: '不可复制的后续回复' })
    const result = await f.runtime.forkWorker(f.parent, f.worker.id, '', f.bridge, signal())
    const child = f.runtime.get(f.worker.parentSessionId, result.workerId)
    expect(f.storage.history(child.id).map((event) => event.text)).toEqual(['模拟旧任务', '模拟旧回复'])
    expect(f.storage.accountBinding(child.id)).toBe('模拟账号epoch')
    expect(f.runtime.get(original.parentSessionId, original.id)).toEqual(original)
    expect(readFileSync(join(f.storage.directory, `${child.id}.worker.json`), 'utf8')).toContain('分支真实回执ID')
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
})
