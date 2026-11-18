import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { WorkerRuntime } from '../src/host/runtime.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { CliWorkerService } from '../src/host/index.ts'
import { workerGoalCommand } from '../src/host/harness-conversation-commands.ts'
import { GOAL_OBJECTIVE_LIMIT } from '../src/shared/conversation-features.ts'
import { CLI_IDS, type CliId, type Worker } from '../src/shared/types.ts'
import { transportFor } from '../src/host/native-worker.ts'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'

// 模拟：仅运行真实 runtime/storage/Remote；账号、CLI 适配与进程均为本地夹具，无模型调用。
const controls = vi.hoisted(() => ({ steer: vi.fn(async () => {}) }))
vi.mock('../src/host/cli-account-binding.ts', () => ({
  readCliAccountBinding: async () => '模拟账号',
  codexRouteEnvironment: async () => ({}),
}))
vi.mock('../src/host/authorized-catalog.ts', () => ({
  ACCOUNT_CHANGED: '模拟账号已改变',
  authorizeSelection: async (preference: unknown) => ({ binding: '模拟账号', preference }),
}))
vi.mock('../src/host/adapters.ts', async original => ({
  ...(await original<object>()),
  resolveCliExecutable: async () => '/模拟-cli',
  workerArguments: (_executable: string, _project: string, _preference: unknown, _mode: unknown, prompt: string) => ['/模拟-cli', prompt],
}))
vi.mock('../src/host/first-party-models.ts', async original => ({
  ...(await original<object>()), assertFirstPartyConfiguration: async () => {}, firstPartyEnvironment: () => ({}),
}))
vi.mock('../src/host/claude-own-route.ts', () => ({
  readClaudeOwnRoute: async () => ({ kind: 'proxy' }),
  prepareClaudeWorkerLaunch: async (_route: unknown, argv: string[]) => ({ argv }),
}))
vi.mock('../src/host/native-worker.ts', async original => ({
  ...(await original<object>()),
  prepareNativeWorker: async (launch: object, input: { prompt: string }) => ({
    ...launch, argv: ['/模拟-cli', input.prompt], steer: controls.steer,
  }),
}))
vi.mock('../src/host/extended-adapters.ts', async original => ({
  ...(await original<object>()),
  extendedLaunch: async (_cli: string, _executable: string, _project: string, _preference: unknown, _mode: unknown, prompt: string) => ({
    argv: ['/模拟-cli', prompt], steer: controls.steer,
  }),
}))

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  controls.steer.mockClear()
})
function fixture(cli: CliId = 'codex') {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-goal-simulated-')))
  cleanup.push(() => rmSync(project, { recursive: true, force: true }))
  const storage = new WorkerStorage(join(project, 'state'))
  const calls: Array<{ spec: SubprocessSpawnSpec; finish(): void }> = []
  const backend: ProcessBackend = {
    resolveExecutable: async () => '/模拟-cli',
    spawn(spec) {
      const stdout = new PassThrough(), stderr = new PassThrough()
      let resolve!: (value: { exitCode: number }) => void
      const done = new Promise<{ exitCode: number }>(settle => { resolve = settle })
      const finish = () => {
        stdout.end(JSON.stringify({ type: 'session', id: '模拟原生会话' }) + '\n' +
          JSON.stringify({ type: 'result', status: 'SUCCESS', response: '模拟回复' }) + '\n')
        stderr.end()
        resolve({ exitCode: 0 })
      }
      calls.push({ spec, finish })
      spec.signal?.addEventListener('abort', finish, { once: true })
      return { stdout, stderr, done, terminate: finish, waitForExit: async () => { await done; return true } } as SubprocessHandle
    },
  }
  const runtime = new WorkerRuntime(storage, backend, DEFAULT_CONFIG)
  cleanup.push(() => runtime.close())
  const worker: Worker = {
    id: randomUUID(), runId: randomUUID(), parentSessionId: '模拟父会话', project,
    title: '模拟目标 Worker', preference: { cli, model: '模拟模型', effort: 'default' },
    transport: transportFor(cli), mode: 'accept-edits', status: 'completed',
    conversationId: '模拟原生会话', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  storage.save(worker)
  storage.bindAccount(worker.id, '模拟账号')
  const service = Object.create(CliWorkerService.prototype) as CliWorkerService
  const parent = vi.fn(async (id: string) => {
    if (id !== worker.parentSessionId) throw new Error('模拟父会话无权访问')
    return { id }
  })
  Object.assign(service['host'], { runtime, parent })
  const signal = new AbortController().signal
  const submit = (prompt: string) => runtime.submit(worker.parentSessionId, project, worker.title,
    prompt, worker.preference, worker.mode, worker.id)
  const ready = async (count: number) => {
    await vi.waitFor(() => expect(calls, worker.error).toHaveLength(count))
    return calls[count - 1]!
  }
  return { project, storage, runtime, worker, service, parent, signal, calls, submit, ready }
}

it('模拟：目标 trim、长度边界与 revision CAS；快照通知后可冷读持久状态', async () => {
  const f = fixture(), changed = vi.fn()
  const off = f.runtime.subscribe(changed)
  cleanup.push(off)
  const set = (text: string, revision: number) => f.runtime.setWorkerGoal(f.worker.parentSessionId, f.worker.id, text, revision)
  expect(() => set('   ', 0)).toThrow('1–4000')
  expect(() => set('字'.repeat(GOAL_OBJECTIVE_LIMIT + 1), 0)).toThrow('1–4000')
  const first = set('  模拟目标  ', 0)
  expect(first).toMatchObject({ objective: '模拟目标', status: 'active', revision: 1 })
  first.objective = '调用者修改不应影响存储'
  expect(f.worker.goal?.objective).toBe('模拟目标')
  expect(changed).toHaveBeenCalledTimes(1)
  expect(() => set('过期编辑', 0)).toThrow('目标已被修改，请刷新后重试')
  expect(() => f.runtime.setWorkerGoalStatus(f.worker.parentSessionId, f.worker.id, 'paused', 0)).toThrow('目标已被修改，请刷新后重试')
  expect(() => f.runtime.clearWorkerGoal(f.worker.parentSessionId, f.worker.id, 0)).toThrow('目标已被修改，请刷新后重试')
  expect(changed).toHaveBeenCalledTimes(1)
  const limit = set(' ' + '字'.repeat(GOAL_OBJECTIVE_LIMIT) + ' ', 1)
  expect(limit.objective).toHaveLength(GOAL_OBJECTIVE_LIMIT)
  expect(limit.revision).toBe(2)
  expect(f.runtime.snapshot(f.worker.parentSessionId).workers[0]?.goal).toEqual(limit)
  await f.runtime.close()
  const cold = new WorkerStorage(f.storage.directory)
  cleanup.push(() => cold.close())
  expect(cold.workers.get(f.worker.id)?.goal).toEqual(limit)
})

it('模拟：清除后 revision 继续递增，旧窗口的过期请求不能删改新目标', async () => {
  const f = fixture(), p = f.worker.parentSessionId, id = f.worker.id
  f.runtime.setWorkerGoal(p, id, '旧目标', 0)
  f.runtime.clearWorkerGoal(p, id, 1)
  expect(f.worker.goal).toBeUndefined()
  expect(() => f.runtime.setWorkerGoal(p, id, '用旧 revision 新建', 0)).toThrow('目标已被修改，请刷新后重试')
  const fresh = f.runtime.setWorkerGoal(p, id, '新目标', 2)
  expect(fresh.revision).toBe(3)
  expect(() => f.runtime.clearWorkerGoal(p, id, 1)).toThrow('目标已被修改，请刷新后重试')
  expect(() => f.runtime.setWorkerGoalStatus(p, id, 'paused', 1)).toThrow('目标已被修改，请刷新后重试')
  expect(f.worker.goal?.objective).toBe('新目标')
  await f.runtime.close()
  const cold = new WorkerStorage(f.storage.directory)
  cleanup.push(() => cold.close())
  expect(cold.workers.get(id)).toMatchObject({ goal: { objective: '新目标', revision: 3 }, goalRevision: 3 })
})

it('模拟：目标 Remote 校验父会话、Worker 归属与取消，返回 JSON 并可暂停、恢复及清除', async () => {
  const f = fixture(), p = f.worker.parentSessionId, id = f.worker.id
  await expect(f.service.setWorkerGoal('其他父会话', id, '不可写', 0, f.signal)).rejects.toThrow('无权访问')
  await expect(f.service.setWorkerGoal(p, randomUUID(), '不存在', 0, f.signal)).rejects.toThrow('does not belong')
  expect(() => f.runtime.setWorkerGoal('其他父会话', id, '越权', 0)).toThrow('does not belong')
  const aborted = AbortSignal.abort(new Error('模拟取消'))
  await expect(f.service.setWorkerGoal(p, id, '取消写入', 0, aborted)).rejects.toThrow('模拟取消')
  await expect(f.service.setWorkerGoalStatus(p, id, 'paused', 0, f.signal)).rejects.toThrow('尚未设置目标')
  expect(JSON.parse(await f.service.setWorkerGoal(p, id, '目标', 0, f.signal))).toMatchObject({ revision: 1, status: 'active' })
  await expect(f.service.setWorkerGoal(p, id, '过期写入', 0, f.signal)).rejects.toThrow('目标已被修改，请刷新后重试')
  expect(JSON.parse(await f.service.setWorkerGoalStatus(p, id, 'paused', 1, f.signal))).toMatchObject({ revision: 2, status: 'paused' })
  expect(JSON.parse(await f.service.setWorkerGoalStatus(p, id, 'active', 2, f.signal))).toMatchObject({ revision: 3, status: 'active' })
  await f.service.clearWorkerGoal(p, id, 3, f.signal)
  expect(f.worker.goal).toBeUndefined()
  expect(JSON.parse(readFileSync(join(f.storage.directory, `${id}.worker.json`), 'utf8'))).not.toHaveProperty('goal')
  expect(f.calls).toHaveLength(0)
})

it('模拟：删除和恢复 Worker 保留目标', () => {
  const f = fixture(), p = f.worker.parentSessionId, id = f.worker.id
  const goal = f.runtime.setWorkerGoal(p, id, '保留目标', 0)
  f.runtime.deleteWorker(p, id)
  expect(f.runtime.snapshot(p).archivedWorkers?.[0]?.goal).toEqual(goal)
  f.runtime.restoreWorker(p, id)
  expect(f.runtime.get(p, id).goal).toEqual(goal)
})

it('模拟：同 revision 并发 Remote 仅一个写入成功', async () => {
  const f = fixture(), p = f.worker.parentSessionId, id = f.worker.id
  const results = await Promise.allSettled([
    f.service.setWorkerGoal(p, id, '并发目标 A', 0, f.signal),
    f.service.setWorkerGoal(p, id, '并发目标 B', 0, f.signal),
  ])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult
  expect(String(rejected.reason)).toContain('目标已被修改，请刷新后重试')
  expect(f.worker.goal?.revision).toBe(1)
  expect(f.calls).toHaveLength(0)
})

it('模拟：准备中的轮次冻结已受理目标；暂停、编辑与清除只影响后续轮且不会被本轮保存覆盖', async () => {
  const f = fixture(), p = f.worker.parentSessionId, id = f.worker.id
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  cleanup.push(() => release())
  const prepare = vi.fn(async () => { await gate; return { close: async () => {} } })
  f.runtime.setHarnessPreparation(prepare)
  f.runtime.setWorkerGoal(p, id, '已受理目标', 0)
  const submission = f.submit('已受理原文')
  await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1))
  f.runtime.setWorkerGoalStatus(p, id, 'paused', 1)
  f.runtime.setWorkerGoal(p, id, '修改后的目标', 2)
  expect(f.worker.goal?.status).toBe('paused')
  f.runtime.clearWorkerGoal(p, id, 3)
  release()
  const call = await f.ready(1)
  expect(call.spec.argv[1]).toBe('【当前目标】\n已受理目标\n【目标结束】\n\n已受理原文')
  call.finish()
  expect((await submission.done).status).toBe('completed')
  expect(f.worker.goal).toBeUndefined()
  const next = f.submit('后续原文'), nextCall = await f.ready(2)
  expect(nextCall.spec.argv[1]).toBe('后续原文')
  nextCall.finish()
  await next.done
})

it.each(CLI_IDS)('模拟：%s 普通轮与续聊统一注入；暂停、清除不注入；目标不会自动续轮', async cli => {
  const f = fixture(cli), p = f.worker.parentSessionId, id = f.worker.id
  const run = async (text: string, expected: string, count: number) => {
    const submission = f.submit(text)
    const call = await f.ready(count)
    expect(call.spec.argv).toEqual(['/模拟-cli', expected])
    call.finish()
    expect((await submission.done).status, f.worker.error).toBe('completed')
  }
  f.runtime.setWorkerGoal(p, id, '持续目标', 0)
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(f.calls).toHaveLength(0)
  await run('用户原文', '【当前目标】\n持续目标\n【目标结束】\n\n用户原文', 1)
  f.runtime.setWorkerGoalStatus(p, id, 'paused', 1)
  await run('暂停后原文', '暂停后原文', 2)
  f.runtime.setWorkerGoalStatus(p, id, 'active', 2)
  await run('恢复后原文', '【当前目标】\n持续目标\n【目标结束】\n\n恢复后原文', 3)
  f.runtime.clearWorkerGoal(p, id, 3)
  await run('清除后原文', '清除后原文', 4)
  const userMessages = f.storage.history(id).filter(event => event.kind === 'user').map(event => event.text)
  expect(userMessages).toEqual(['用户原文', '暂停后原文', '恢复后原文', '清除后原文'])
  expect(f.runtime.snapshot(p, id).timeline.filter(item => item.kind === 'user').map(item => item.text)).toEqual(userMessages)
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(f.calls).toHaveLength(4)
})

it('模拟：运行中可修改目标，当前轮和 steer 保持原文，后续排队轮使用修改后的目标', async () => {
  const f = fixture(), p = f.worker.parentSessionId, id = f.worker.id
  f.runtime.setFollowupLauncher(async (worker, item, admission) => {
    f.runtime.submit(p, worker.project, worker.title, item.prompt, worker.preference, worker.mode,
      worker.id, undefined, undefined, admission)
  })
  const first = f.submit('当前轮原文')
  const firstCall = await f.ready(1)
  expect(firstCall.spec.argv[1]).toBe('当前轮原文')
  f.runtime.setWorkerGoal(p, id, '运行中设置的目标', 0)
  const queued = f.runtime.queueFollowup(p, id, '排队原文', f.worker.runId, randomUUID())
  f.runtime.setWorkerGoal(p, id, '出队时目标', 1)
  await f.runtime.steerMessage(p, id, '运行中插话原文', f.worker.runId, randomUUID())
  expect(controls.steer.mock.calls[0]?.[0]).toBe('运行中插话原文')
  expect(f.calls).toHaveLength(1)
  expect(f.storage.history(id).filter(event => event.kind === 'user').map(event => event.text)).toEqual(['当前轮原文', '运行中插话原文'])
  firstCall.finish()
  await first.done
  const secondCall = await f.ready(2)
  expect(secondCall.spec.argv[1]).toBe('【当前目标】\n出队时目标\n【目标结束】\n\n排队原文')
  secondCall.finish()
  await vi.waitFor(() => expect(f.runtime.snapshot(p, id).selectedBusy).toBe(false))
  expect(f.storage.history(id).find(event => event.kind === 'user' && event.queuedFollowupId === queued.id)?.text).toBe('排队原文')
  expect(f.worker.goal?.objective).toBe('出队时目标')
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(f.calls).toHaveLength(2)
})

it('模拟：/goal 查询、设置替换、暂停恢复及清除均操作插件目标，不创建运行', async () => {
  const f = fixture(), p = f.worker.parentSessionId, id = f.worker.id
  const command = (input: string) => workerGoalCommand(f.worker, input, {
    set: async (text, revision) => JSON.parse(await f.service.setWorkerGoal(p, id, text, revision, f.signal)),
    status: (status, revision) => f.service.setWorkerGoalStatus(p, id, status, revision, f.signal),
    clear: revision => f.service.clearWorkerGoal(p, id, revision, f.signal),
  })
  expect(await command('')).toBe('当前会话尚未设置目标')
  await expect(command('pause')).rejects.toThrow('尚未设置目标')
  expect(await command('  第一目标  ')).toBe('目标已设置：\n第一目标')
  expect(await command('')).toBe('当前目标（进行中）：\n第一目标')
  expect(await command('第二目标')).toBe('目标已设置：\n第二目标')
  expect(await command('pause')).toBe('目标已暂停')
  expect(await command('')).toBe('当前目标（已暂停）：\n第二目标')
  expect(await command('暂停时编辑')).toBe('目标已设置：\n暂停时编辑')
  expect(await command('')).toBe('当前目标（已暂停）：\n暂停时编辑')
  expect(await command('resume')).toBe('目标已恢复')
  expect(await command('clear')).toBe('目标已清除')
  expect(await command('')).toBe('当前会话尚未设置目标')
  expect(f.calls).toHaveLength(0)
})
