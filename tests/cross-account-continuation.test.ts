import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { WorkerRuntime } from './fixtures/legacy-runtime.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { catalogFor } from '../src/host/adapters.ts'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import { readClaudeOwnRoute } from '../src/host/claude-own-route.ts'
import { ACCOUNT_CHANGED } from '../src/host/authorized-catalog.ts'
import * as crossAccount from '../src/host/cross-account-resume.ts'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
import { readWorkerForkState, writeWorkerForkState } from '../src/host/worker-fork.ts'
import {
  CARRYOVER_FAILED_NOTICE, CARRYOVER_FORK_REFUSED, CARRYOVER_UNREACHABLE_NOTICE,
  type Preference,
} from '../src/shared/types.ts'

// synthetic accounts, model metadata and AGY NDJSON processes; real runtime/authorization/storage.
vi.mock('../src/host/adapters.ts', async original => ({
  ...(await original<object>()), catalogFor: vi.fn(),
}))
vi.mock('../src/host/cli-account-binding.ts', () => ({ readCliAccountBinding: vi.fn() }))
vi.mock('../src/host/claude-own-route.ts', async original => ({
  ...(await original<object>()), readClaudeOwnRoute: vi.fn(),
}))

const A = 'synthetic-account-a'
const B = 'synthetic-account-b'
const OLD = 'synthetic-old-session'
const NEW = 'synthetic-new-session'
const PARENT = 'synthetic-parent'
const FIRST = 'synthetic original request'
const NEXT = 'synthetic continuation request'
const ROLE = 'synthetic role instructions'
const preference: Preference = { cli: 'antigravity', model: 'synthetic/model', effort: 'low' }
const cleanup: (() => void | Promise<void>)[] = []
let account: string | undefined
let models: string[]

beforeEach(() => {
  account = A
  models = [preference.model]
  vi.mocked(readClaudeOwnRoute).mockResolvedValue({ kind: 'native', sourceIds: [] })
  vi.mocked(readCliAccountBinding).mockImplementation(async (_cli, _backend, _config, _project, signal) => {
    signal.throwIfAborted()
    if (!account) throw new Error('本 CLI 未登录')
    return account
  })
  vi.mocked(catalogFor).mockImplementation(async cli => ({
    cli, notice: 'synthetic account model scope',
    models: models.map(id => ({ id, label: id, efforts: ['low'] })),
  }))
})

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

function setup() {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-cross-account-synthetic-')))
  cleanup.push(() => rmSync(project, { recursive: true, force: true }))
  type Launch = Parameters<ProcessBackend['spawn']>[0]
  const processes: {
    launch: Launch
    send(event: unknown): void
    finish(exitCode?: number): void
    succeed(id?: string, input?: number): void
  }[] = []
  const backend: ProcessBackend = {
    resolveExecutable: vi.fn(async () => '/synthetic/agy'),
    spawn: vi.fn((launch: Launch) => {
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      let resolve!: (value: { exitCode: number }) => void
      const done = new Promise<{ exitCode: number }>(yes => { resolve = yes })
      let ended = false
      const send = (event: unknown) => stdout.write(JSON.stringify(event) + '\n')
      const abort = () => finish(1)
      const finish = (exitCode = 1) => {
        if (ended) return
        ended = true
        launch.signal?.removeEventListener('abort', abort)
        stdout.end()
        stderr.end()
        resolve({ exitCode })
      }
      processes.push({
        launch, send, finish,
        succeed(id = OLD, input?: number) {
          send({ event: 'init', conversation_id: id })
          send({ event: 'result', result: {
            conversation_id: id, status: 'SUCCESS', response: 'synthetic answer',
            ...(input === undefined ? {} : {
              usage: { input_tokens: input, output_tokens: 7, cache_read_tokens: 40, total_tokens: input + 7 },
            }),
          } })
          finish(0)
        },
      })
      launch.signal?.addEventListener('abort', abort, { once: true })
      return {
        stdout, stderr, done, terminate: vi.fn(() => finish()),
        waitForExit: vi.fn(async () => { await done; return true }),
      } as unknown as SubprocessHandle
    }),
  }
  const storage = new WorkerStorage(join(project, 'state'))
  const runtime = new WorkerRuntime(storage, backend, { ...DEFAULT_CONFIG, maxConcurrent: 1 })
  cleanup.push(() => runtime.close())
  const submit = (previousId?: string, prompt = previousId ? NEXT : FIRST) => runtime.submit(
    PARENT, project, 'synthetic task', prompt, preference, 'accept-edits', previousId,
    { role: { name: 'synthetic role', summary: 'synthetic fixture', prompt: ROLE } },
  )
  const spawned = async (count: number) => {
    await vi.waitFor(() => expect(backend.spawn).toHaveBeenCalledTimes(count))
    return processes[count - 1]!
  }
  const completed = async (input?: number) => {
    const task = submit()
    ;(await spawned(1)).succeed(OLD, input)
    expect((await task.done).status).toBe('completed')
    expect(storage.accountBinding(task.worker.id)).toBe(A)
    return task.worker.id
  }
  return { project, backend, storage, runtime, submit, spawned, completed }
}

const promptOf = (argv: readonly string[]) => argv[argv.indexOf('--print') + 1]!
function expectFresh(argv: readonly string[]) {
  expect(argv).not.toContain('--conversation')
  expect(argv).not.toContain('--resume')
  expect(argv).not.toContain('resume')
  expect(argv).not.toContain(OLD)
}
function expectNoCarryover(storage: WorkerStorage, id: string) {
  expect(storage.history(id).filter(event =>
    [CARRYOVER_FAILED_NOTICE, CARRYOVER_UNREACHABLE_NOTICE].includes(event.text))).toEqual([])
}
const persistedWorker = (storage: WorkerStorage, id: string) =>
  JSON.parse(readFileSync(join(storage.directory, `${id}.worker.json`), 'utf8'))

// An account change is never announced: no event or timeline row mentions it.
const expectSilent = (f: { storage: { history(id: string): { text?: string }[] }; runtime: { snapshot(parent: string, id: string): unknown } }, id: string) => {
  expect(f.storage.history(id).filter(event => /账号已变更|当前账号/.test(event.text ?? ''))).toEqual([])
  expect(JSON.stringify(f.runtime.snapshot(PARENT, id))).not.toMatch(/账号已变更|当前账号/)
}

describe('cross-account continuation with synthetic AGY processes', () => {
  it('rebinds A to B, resumes the same session, and keeps account identities out of the snapshot', async () => {
    const f = setup()
    const id = await f.completed()
    account = B
    const task = f.submit(id)
    const run = await f.spawned(2)
    expect(run.launch.argv.slice(run.launch.argv.indexOf('--conversation'), -2)).toEqual(['--conversation', OLD])
    expect(promptOf(run.launch.argv)).toContain(NEXT)
    run.succeed()
    expect(await task.done).toMatchObject({ id, status: 'completed', conversationId: OLD })
    expect(f.storage.accountBinding(id)).toBe(B)
    expectSilent(f, id)
    const snapshot = f.runtime.snapshot(PARENT, id)
    expect(snapshot.resumeBlockedReason).toBeUndefined()
    for (const binding of [A, B]) expect(JSON.stringify(snapshot)).not.toContain(binding)
    expect(f.backend.spawn).toHaveBeenCalledTimes(2)
    expectNoCarryover(f.storage, id)
  })

  it('reads an older record without its account-change notes', async () => {
    const f = setup()
    const id = await f.completed()
    // synthetic notes as earlier builds wrote them
    const worker = persistedWorker(f.storage, id)
    f.storage.append(worker, { kind: 'diagnostic', text: '账号已变更，已改用当前账号继续' })
    f.storage.append(worker, { kind: 'diagnostic', text: '原会话无法在当前账号续接，已在新会话中继续', detail: '已附带此前 2 条记录' })
    const timeline = JSON.stringify(f.runtime.snapshot(PARENT, id).timeline)
    expect(timeline).not.toMatch(/账号已变更|当前账号/)
    expect(timeline).toContain(CARRYOVER_FAILED_NOTICE)
    expect(timeline).toContain('已附带此前 2 条记录')
  })

  it.each(['logout', 'model unavailable'] as const)('rejects continuation on %s without spawn or rebind', async change => {
    const f = setup()
    const id = await f.completed()
    account = change === 'logout' ? undefined : B
    if (change === 'model unavailable') models = ['synthetic/another-model']
    const task = f.submit(id)
    expect(await task.done).toMatchObject({ status: 'failed', conversationId: OLD,
      error: expect.stringContaining(change === 'logout' ? '未登录' : '模型') })
    expect(f.backend.spawn).toHaveBeenCalledTimes(1)
    expect(f.storage.accountBinding(id)).toBe(A)
    expectSilent(f, id)
    expectNoCarryover(f.storage, id)
  })

  it('starts a new queued task under B after A changes to B, without a notice', async () => {
    const f = setup()
    const first = f.submit()
    const blocker = await f.spawned(1)
    const reads = vi.mocked(readCliAccountBinding).mock.calls.length
    const queued = f.submit()
    await vi.waitFor(() => expect(readCliAccountBinding).toHaveBeenCalledTimes(reads + 1))
    expect(queued.worker.status).toBe('queued')
    account = B
    blocker.succeed()
    expect((await first.done).status).toBe('completed')
    ;(await f.spawned(2)).succeed('synthetic-new-session')
    expect(await queued.done).toMatchObject({ status: 'completed' })
    expect(f.storage.accountBinding(queued.worker.id)).toBe(B)
    expectSilent(f, queued.worker.id)
  })

  it('reauthorizes an existing queued continuation under B when it was admitted under A', async () => {
    const f = setup()
    const id = await f.completed()
    const blocker = f.submit()
    const blockedRun = await f.spawned(2)
    const reads = vi.mocked(readCliAccountBinding).mock.calls.length
    const continuation = f.submit(id)
    await vi.waitFor(() => expect(readCliAccountBinding).toHaveBeenCalledTimes(reads + 1))
    expect(continuation.worker.status).toBe('queued')
    account = B
    blockedRun.succeed('synthetic-blocker-session')
    expect((await blocker.done).status).toBe('completed')
    const resumed = await f.spawned(3)
    expect(resumed.launch.argv).toContain('--conversation')
    expect(resumed.launch.argv).toContain(OLD)
    resumed.succeed()
    expect((await continuation.done).status).toBe('completed')
    expect(f.storage.accountBinding(id)).toBe(B)
    expectSilent(f, id)
  })

  it('continues legacy history with its binding file removed and binds the current account', async () => {
    const f = setup()
    const id = await f.completed()
    rmSync(join(f.storage.directory, `${id}.account-binding.json`))
    account = B
    expect(f.runtime.snapshot(PARENT, id).resumeBlockedReason).toBeUndefined()
    const task = f.submit(id)
    ;(await f.spawned(2)).succeed()
    expect(await task.done).toMatchObject({ status: 'completed', conversationId: OLD })
    expect(f.storage.accountBinding(id)).toBe(B)
    expectSilent(f, id)
  })

  it('still rejects an A-to-B-to-A race when the prepared Claude snapshot belongs to B', async () => {
    const f = setup()
    // synthetic route: admission/catalog/current source are A, but the captured launch source is B.
    const selected = {
      kind: 'proxy' as const,
      sourceIds: ['/synthetic/claude/settings.json'],
      source: {
        provider: 'anthropic', credential: { type: 'api' as const, key: 'synthetic-key-b' },
        sourceIds: ['/synthetic/claude/settings.json'], baseUrl: 'http://127.0.0.1:15721',
        apiType: 'anthropic-messages' as const, anthropicAuth: 'bearer' as const, nativeModels: [],
      },
    }
    vi.mocked(readClaudeOwnRoute).mockResolvedValue(selected)
    vi.mocked(readCliAccountBinding).mockImplementation(async (_cli, _backend, _config, _project, signal, snapshot) => {
      signal.throwIfAborted()
      return snapshot ? B : A
    })
    const task = f.runtime.submit(PARENT, f.project, 'synthetic race', FIRST,
      { ...preference, cli: 'claude' }, 'accept-edits')
    expect(await task.done).toMatchObject({ status: 'failed', error: expect.stringContaining(ACCOUNT_CHANGED) })
    expect(vi.mocked(readCliAccountBinding).mock.calls.some(call => call[5] === selected)).toBe(true)
    expect(f.backend.spawn).not.toHaveBeenCalled()
    expect(f.storage.accountBinding(task.worker.id)).toBeUndefined()
    expectNoCarryover(f.storage, task.worker.id)
  })

  it('carries history into one fresh session after a rebound resume exits before any reply or tool event', async () => {
    const f = setup()
    const id = await f.completed()
    account = B
    const task = f.submit(id)
    const resumed = await f.spawned(2)
    expect(resumed.launch.argv).toContain('--conversation')
    expect(resumed.launch.argv).toContain(OLD)
    resumed.finish(1)
    const fresh = await f.spawned(3)
    expectFresh(fresh.launch.argv)
    const prompt = promptOf(fresh.launch.argv)
    expect(prompt).toContain(ROLE)
    expect(prompt).toContain('【CLI Worker 历史记录】')
    expect(prompt).toContain(FIRST)
    expect(prompt).toContain('synthetic answer')
    expect(prompt).toContain('【历史记录结束】\n\n本次消息：\n' + NEXT)
    expect(prompt.indexOf(ROLE)).toBeLessThan(prompt.indexOf('【CLI Worker 历史记录】'))
    expect(prompt.split(NEXT)).toHaveLength(2)
    expect(fresh.launch.argv).toContain(preference.model)
    expect(fresh.launch.argv).toContain('low')
    expect(fresh.launch.argv[fresh.launch.argv.indexOf('--mode') + 1]).toBe('auto')
    fresh.succeed(NEW)
    expect(await task.done).toMatchObject({ id, status: 'completed', conversationId: NEW, previousConversationIds: [OLD] })
    expect(persistedWorker(f.storage, id)).toMatchObject({ conversationId: NEW, previousConversationIds: [OLD] })
    expect(f.storage.history(id).filter(event => event.text === CARRYOVER_FAILED_NOTICE)).toEqual([
      expect.objectContaining({ kind: 'diagnostic', detail: '已附带此前 2 条记录' }),
    ])
    expect(f.backend.spawn).toHaveBeenCalledTimes(3)
  })

  it.each(['agent_response', 'tool'] as const)('does not retry after a resumed %s event followed by failure', async stepType => {
    const f = setup()
    const id = await f.completed()
    account = B
    const task = f.submit(id)
    const resumed = await f.spawned(2)
    resumed.send({ event: 'step_update', step_update: {
      conversation_id: OLD, step_index: 0, step_type: stepType, state: 'RUNNING',
      text_delta: 'synthetic partial response', tool_name: 'synthetic tool',
    } })
    resumed.finish(1)
    expect(await task.done).toMatchObject({ status: 'failed', conversationId: OLD })
    expect(f.storage.history(id)).toContainEqual(expect.objectContaining({ runId: task.worker.runId,
      kind: stepType === 'tool' ? 'tool' : 'assistant' }))
    expect(f.backend.spawn).toHaveBeenCalledTimes(2)
    expectNoCarryover(f.storage, id)
  })

  it('restores the original conversation when the single carryover attempt also fails without an id', async () => {
    const f = setup()
    const id = await f.completed()
    account = B
    const task = f.submit(id)
    ;(await f.spawned(2)).finish(1)
    const fresh = await f.spawned(3)
    expectFresh(fresh.launch.argv)
    fresh.finish(1)
    expect(await task.done).toMatchObject({ status: 'failed', conversationId: OLD })
    expect(task.worker.previousConversationIds ?? []).toEqual([])
    expect(persistedWorker(f.storage, id).conversationId).toBe(OLD)
    expect(f.storage.history(id).filter(event => event.text === CARRYOVER_FAILED_NOTICE)).toHaveLength(1)
    expect(f.backend.spawn).toHaveBeenCalledTimes(3)
  })

  it('keeps counting token usage from the left session while context is the new session\'s own', async () => {
    const f = setup()
    const id = await f.completed(100)
    const usage = () => f.runtime.snapshot(PARENT, id).telemetry?.usage
    expect(usage()).toMatchObject({ total: 107, scope: 'session' })
    account = B
    const task = f.submit(id)
    ;(await f.spawned(2)).finish(1)
    const fresh = await f.spawned(3)
    expect(task.worker.previousSessionUsage).toMatchObject({ total: 107, input: 100 })
    expect(usage()).toMatchObject({ total: 107 })
    fresh.succeed(NEW, 50)
    expect(await task.done).toMatchObject({ status: 'completed', conversationId: NEW })
    expect(usage()).toEqual({ total: 164, input: 150, output: 14, cacheRead: 80, scope: 'session' })
    expect(persistedWorker(f.storage, id).previousSessionUsage).toMatchObject({ total: 107 })
    await f.runtime.close()
    const reopened = new WorkerRuntime(new WorkerStorage(f.storage.directory), f.backend, DEFAULT_CONFIG)
    cleanup.push(() => reopened.close())
    expect(reopened.snapshot(PARENT, id).telemetry?.usage).toMatchObject({ total: 164 })
  })

  it('does not add the original session to itself when the carryover also fails', async () => {
    const f = setup()
    const id = await f.completed(100)
    account = B
    const task = f.submit(id)
    ;(await f.spawned(2)).finish(1)
    ;(await f.spawned(3)).finish(1)
    expect(await task.done).toMatchObject({ status: 'failed', conversationId: OLD })
    expect(task.worker.previousSessionUsage).toBeUndefined()
    expect(persistedWorker(f.storage, id).previousSessionUsage).toBeUndefined()
    expect(f.runtime.snapshot(PARENT, id).telemetry?.usage).toMatchObject({ total: 107 })
  })

  it('does not replay a rebound resume that delivered a successful result before exiting nonzero', async () => {
    const f = setup()
    const id = await f.completed()
    account = B
    const task = f.submit(id)
    const resumed = await f.spawned(2)
    resumed.send({ event: 'init', conversation_id: OLD })
    resumed.send({ event: 'result', result: { conversation_id: OLD, status: 'SUCCESS', response: 'synthetic done' } })
    resumed.finish(1)
    await task.done
    expect(task.worker.conversationId).toBe(OLD)
    expect(f.backend.spawn).toHaveBeenCalledTimes(2)
    expectNoCarryover(f.storage, id)
  })

  it('still carries over on the next turn after both the resume and the carryover failed under B', async () => {
    const f = setup()
    const id = await f.completed()
    account = B
    const first = f.submit(id)
    ;(await f.spawned(2)).finish(1)
    ;(await f.spawned(3)).finish(1)
    expect(await first.done).toMatchObject({ status: 'failed', conversationId: OLD, reboundConversationId: OLD })
    expect(f.storage.accountBinding(id)).toBe(B)
    const retry = f.submit(id)
    const resumed = await f.spawned(4)
    expect(resumed.launch.argv).toContain(OLD)
    resumed.finish(1)
    const fresh = await f.spawned(5)
    expectFresh(fresh.launch.argv)
    fresh.succeed(NEW)
    expect(await retry.done).toMatchObject({ status: 'completed', conversationId: NEW, previousConversationIds: [OLD] })
    expect(persistedWorker(f.storage, id).reboundConversationId).toBeUndefined()
  })

  it('clears the rebound mark once the resumed session answers under the current account', async () => {
    const f = setup()
    const id = await f.completed()
    account = B
    const task = f.submit(id)
    ;(await f.spawned(2)).succeed(OLD)
    expect(await task.done).toMatchObject({ status: 'completed', conversationId: OLD })
    expect(persistedWorker(f.storage, id).reboundConversationId).toBeUndefined()
    // A later same-account failure before any event is reported, not replayed.
    const next = f.submit(id)
    ;(await f.spawned(3)).finish(1)
    expect((await next.done).status).toBe('failed')
    expectNoCarryover(f.storage, id)
  })

  it('refuses a native branch cut from a run before the carryover, and maps later runs to the new session', async () => {
    const f = setup()
    const id = await f.completed()
    const before = f.storage.workers.get(id)!.runId
    account = B
    const task = f.submit(id)
    ;(await f.spawned(2)).finish(1)
    ;(await f.spawned(3)).succeed(NEW)
    const worker = await task.done
    expect(worker.carryoverRunId).toBe(worker.runId)
    const source = (runId: string) => (f.runtime as any).forkRunSource(worker, runId)
    expect(() => source(before)).toThrow(CARRYOVER_FORK_REFUSED)
    expect(source(worker.runId)).toEqual({ workerId: id, conversationId: NEW })
  })

  it.each([['the same account', A], ['another account', B]] as const)(
    'keeps the session through a sign-out and resumes it natively after signing in to %s',
    async (_label, next) => {
      const f = setup()
      const id = await f.completed()
      account = undefined
      expect(await f.submit(id).done).toMatchObject({ status: 'failed', error: expect.stringContaining('未登录'), conversationId: OLD })
      expect(f.backend.spawn).toHaveBeenCalledTimes(1)
      expect(f.storage.accountBinding(id)).toBe(A)
      account = next
      const task = f.submit(id)
      const resumed = await f.spawned(2)
      expect(resumed.launch.argv).toContain('--conversation')
      expect(resumed.launch.argv).toContain(OLD)
      resumed.succeed(OLD)
      expect(await task.done).toMatchObject({ status: 'completed', conversationId: OLD })
      expect(f.storage.accountBinding(id)).toBe(next)
      expectSilent(f, id)
      expectNoCarryover(f.storage, id)
    },
  )

  // synthetic pending branch: the child resumes its source on its first turn, as a lazy Claude fork does.
  const pendingBranch = async (f: ReturnType<typeof setup>) => {
    const id = await f.completed()
    const worker = f.storage.workers.get(id)!
    const inherited = worker.runId
    worker.conversationId = undefined
    f.storage.save(worker)
    writeWorkerForkState(f.storage.directory, id, { sourceConversationId: OLD, sourceMessageId: 'synthetic-cut' })
    return { id, inherited }
  }

  it('carries a pending branch over once when its first turn under B fails before any event', async () => {
    const f = setup()
    const { id, inherited } = await pendingBranch(f)
    account = B
    const task = f.submit(id)
    const forked = await f.spawned(2)
    expect(forked.launch.argv).toContain(OLD)
    forked.finish(1)
    const fresh = await f.spawned(3)
    expectFresh(fresh.launch.argv)
    expect(promptOf(fresh.launch.argv)).toContain(ROLE)
    expect(promptOf(fresh.launch.argv)).toContain(FIRST)
    fresh.succeed(NEW)
    const worker = await task.done
    expect(worker).toMatchObject({ status: 'completed', conversationId: NEW, carryoverRunId: worker.runId })
    expect(worker.previousConversationIds ?? []).toEqual([])
    expect(worker.reboundConversationId).toBeUndefined()
    expect(readWorkerForkState(f.storage.directory, id)?.sourceConversationId).toBeUndefined()
    expect(f.storage.accountBinding(id)).toBe(B)
    expect(f.storage.history(id).filter(event => event.text === CARRYOVER_FAILED_NOTICE)).toEqual([
      expect.objectContaining({ detail: '已附带此前 2 条记录' }),
    ])
    // The inherited run lives in the source session only; the new session has no native copy.
    expect(() => (f.runtime as any).forkRunSource(worker, inherited)).toThrow(CARRYOVER_FORK_REFUSED)
    expect(f.backend.spawn).toHaveBeenCalledTimes(3)
  })

  it('restores a pending branch when its carryover also fails, and carries it over again next turn', async () => {
    const f = setup()
    const { id } = await pendingBranch(f)
    account = B
    const task = f.submit(id)
    ;(await f.spawned(2)).finish(1)
    ;(await f.spawned(3)).finish(1)
    const worker = await task.done
    expect(worker.status).toBe('failed')
    expect(worker.conversationId).toBeUndefined()
    expect(worker.carryoverRunId).toBeUndefined()
    expect(readWorkerForkState(f.storage.directory, id)).toMatchObject({ sourceConversationId: OLD, sourceMessageId: 'synthetic-cut' })
    const next = f.submit(id)
    const forked = await f.spawned(4)
    expect(forked.launch.argv).toContain(OLD)
    forked.finish(1)
    const fresh = await f.spawned(5)
    expectFresh(fresh.launch.argv)
    fresh.succeed(NEW)
    expect(await next.done).toMatchObject({ status: 'completed', conversationId: NEW })
    expect(f.storage.history(id).filter(event => event.text === CARRYOVER_FAILED_NOTICE)).toHaveLength(2)
  })

  it('does not carry over a pending branch whose first turn fails under the same account', async () => {
    const f = setup()
    const { id } = await pendingBranch(f)
    const task = f.submit(id)
    ;(await f.spawned(2)).finish(1)
    expect((await task.done).status).toBe('failed')
    expect(readWorkerForkState(f.storage.directory, id)?.sourceConversationId).toBe(OLD)
    expectNoCarryover(f.storage, id)
    expect(f.backend.spawn).toHaveBeenCalledTimes(2)
  })

  it('does not carry over after a user stops a rebound resumed run', async () => {
    const f = setup()
    const id = await f.completed()
    account = B
    const task = f.submit(id)
    await f.spawned(2)
    expect(await f.runtime.stop(PARENT, id)).toMatchObject({ status: 'interrupted', interruptionReason: 'user' })
    expect(await task.done).toMatchObject({ status: 'interrupted', conversationId: OLD })
    expect(f.backend.spawn).toHaveBeenCalledTimes(2)
    expectNoCarryover(f.storage, id)
  })

  it('does not carry over a same-account resume that fails before any event', async () => {
    const f = setup()
    const id = await f.completed()
    const task = f.submit(id)
    ;(await f.spawned(2)).finish(1)
    expect(await task.done).toMatchObject({ status: 'failed', conversationId: OLD })
    expect(f.storage.accountBinding(id)).toBe(A)
    expect(f.backend.spawn).toHaveBeenCalledTimes(2)
    expectNoCarryover(f.storage, id)
  })

  it.each(['table', 'preflight'] as const)('starts directly with carryover when %s says native resume is unavailable', async reason => {
    const f = setup()
    const id = await f.completed()
    account = B
    // synthetic policy override; no claim that AGY is known to reject cross-account resume.
    if (reason === 'table') vi.spyOn(crossAccount, 'crossAccountResume').mockReturnValue('carryover')
    else vi.spyOn(crossAccount, 'nativeSessionReachable').mockReturnValue(false)
    const task = f.submit(id)
    const fresh = await f.spawned(2)
    expectFresh(fresh.launch.argv)
    expect(promptOf(fresh.launch.argv)).toContain('【CLI Worker 历史记录】')
    expect(promptOf(fresh.launch.argv)).toContain(NEXT)
    fresh.succeed(NEW)
    expect(await task.done).toMatchObject({ status: 'completed', conversationId: NEW, previousConversationIds: [OLD] })
    expect(f.storage.accountBinding(id)).toBe(B)
    expect(f.storage.history(id)).toContainEqual(expect.objectContaining({ text: CARRYOVER_UNREACHABLE_NOTICE }))
    expect(f.storage.history(id).filter(event => event.text === CARRYOVER_FAILED_NOTICE)).toEqual([])
    expect(f.backend.spawn).toHaveBeenCalledTimes(2)
  })
})

it('uses a synthetic Hermes state.db presence check only for oneshot resume', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-hermes-preflight-synthetic-')))
  cleanup.push(() => rmSync(home, { recursive: true, force: true }))
  expect(crossAccount.nativeSessionReachable({ cli: 'hermes', hermesHome: home })).toBe(false)
  expect(crossAccount.nativeSessionReachable({ cli: 'hermes', hermesHome: home, transport: 'hermes-http-v1' })).toBeUndefined()
  writeFileSync(join(home, 'state.db'), 'synthetic presence only, not a database')
  expect(crossAccount.nativeSessionReachable({ cli: 'hermes', hermesHome: home })).toBeUndefined()
  expect(crossAccount.nativeSessionReachable({ cli: 'antigravity', hermesHome: home })).toBeUndefined()
})
