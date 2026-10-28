import { afterEach, expect, it, vi } from 'vitest'
import {
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  statSync,
  renameSync,
  chmodSync,
  linkSync,
  symlinkSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { WorkerRuntime } from './fixtures/legacy-runtime.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { CliWorkerService } from '../src/host/index.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import { authorizeSelection } from '../src/host/authorized-catalog.ts'
import { CARRYOVER_FAILED_NOTICE, type Worker } from '../src/shared/types.ts'
import { OWN_ACCOUNT_BUSY } from '../src/host/own-account-lease.mjs'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import { extendedLaunch } from '../src/host/extended-adapters.ts'

// Synthetic account, process protocol and model checks only; no CLI/model is called.
vi.mock('../src/host/cli-account-binding.ts', () => ({
  readCliAccountBinding: vi.fn(async () => 'synthetic-account'),
}))
vi.mock('../src/host/extended-adapters.ts', async (original) => ({
  ...(await original<typeof import('../src/host/extended-adapters.ts')>()),
  extendedLaunch: vi.fn(),
}))
vi.mock('../src/host/pi-omp-identity.ts', () => ({
  verifyPiOmpExecutable: async (_cli: string, executable: string) => executable,
}))
vi.mock('../src/host/authorized-catalog.ts', () => ({
  ACCOUNT_CHANGED: 'synthetic account changed',
  authorizeSelection: vi.fn(async (preference: unknown) => ({ binding: 'synthetic-account', preference })),
}))
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.mocked(readCliAccountBinding).mockReset().mockResolvedValue('synthetic-account')
  vi.mocked(extendedLaunch).mockReset()
})
function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function fixture(
  options: {
    cleanup?: boolean
    cleanupGate?: ReturnType<typeof deferred>
    cleanupStarted?: () => void
    selectionGate?: ReturnType<typeof deferred>
    spawnReturnGate?: ReturnType<typeof deferred>
    cli?: 'pi' | 'omp'
    steer?: (message: string, requestId: string, signal?: AbortSignal) => Promise<void>
  } = {},
) {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-followup-queue-')))
  cleanups.push(() => rmSync(project, { recursive: true, force: true }))
  const directory = join(project, 'state'),
    storage = new WorkerStorage(directory)
  const calls: Array<{ spec: SubprocessSpawnSpec; finish: (status?: string, response?: string) => void }> = []
  const backend: ProcessBackend = {
    resolveExecutable: async () => '/synthetic/agy',
    spawn: (spec) => {
      const stdout = new PassThrough(),
        stderr = new PassThrough(),
        outcome = deferred<{ exitCode: number }>()
      const close = () => {
        stdout.end()
        stderr.end()
        outcome.resolve({ exitCode: 0 })
      }
      calls.push({
        spec,
        finish: (status = 'SUCCESS', response = 'synthetic answer') => {
          if (options.cli) {
            stdout.write(JSON.stringify({ type: 'result', status, response }) + '\n')
            close()
            return
          }
          if (status === 'UNCERTAIN')
            stdout.write(
              JSON.stringify({
                event: 'step_update',
                step_update: {
                  conversation_id: 'synthetic-session',
                  step_index: 1,
                  step_type: 'agent_response',
                  state: 'DONE',
                  text_delta: 'synthetic answer',
                },
              }) + '\n',
            )
          stdout.write(
            JSON.stringify({
              event: 'result',
              result: {
                conversation_id: 'synthetic-session',
                status: status === 'UNCERTAIN' ? 'ERROR' : status,
                response: 'synthetic answer',
                error: status === 'SUCCESS' ? undefined : 'synthetic failure',
              },
            }) + '\n',
          )
          close()
        },
      })
      if (options.cli) stdout.write(JSON.stringify({ type: 'session', id: 'synthetic-session' }) + '\n')
      spec.signal?.addEventListener('abort', close, { once: true })
      const handle = {
        stdout,
        stderr,
        done: outcome.promise,
        terminate: close,
        waitForExit: async () => {
          options.cleanupStarted?.()
          await options.cleanupGate?.promise
          return options.cleanup !== false
        },
      } as SubprocessHandle
      return options.spawnReturnGate && calls.length === 2
        ? options.spawnReturnGate.promise.then(() => handle)
        : handle
    },
  }
  const runtime = new WorkerRuntime(storage, backend, DEFAULT_CONFIG)
  if (options.cli)
    vi.mocked(extendedLaunch).mockResolvedValue({
      argv: ['/synthetic/native-rpc'],
      env: {},
      cleanup: async () => {},
      steer: options.steer,
    })
  cleanups.push(() => runtime.close())
  const worker: Worker = {
    id: randomUUID(),
    runId: randomUUID(),
    parentSessionId: 'parent',
    project,
    title: 'Synthetic queue',
    preference: { cli: options.cli ?? 'antigravity', model: 'synthetic-model', effort: 'low' },
    mode: 'plan',
    status: 'completed',
    conversationId: 'synthetic-session',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  }
  storage.save(worker)
  storage.bindAccount(worker.id, 'synthetic-account')
  const agent = {
    id: 'parent',
    ctx: {
      get: () => ({
        start: ({ run }: any) => {
          run()
          return randomUUID()
        },
      }),
    },
  }
  const service: any = Object.create(CliWorkerService.prototype)
  Object.assign(service, {
    nativeRunDone: new Map(),
    runtime,
    backend,
    options: DEFAULT_CONFIG,
    disposed: new AbortController(),
    accounts: { isBusy: () => false },
    parent: vi.fn(async () => agent),
    project: () => project,
    assertExecution: vi.fn(),
    assertAccessSupported: vi.fn(),
    querySelection: vi.fn(
      async (
        preference: unknown,
        _backend: unknown,
        _config: unknown,
        _project: unknown,
        signal: AbortSignal,
      ) => {
        if (options.selectionGate) await options.selectionGate.promise
        signal.throwIfAborted()
        return { binding: 'synthetic-account', preference }
      },
    ),
  })
  runtime.setFollowupLauncher(async (current, item, admission, signal) => {
    await service.launch(
      agent,
      current.title,
      item.prompt,
      current.preference,
      current.mode,
      current.id,
      undefined,
      signal,
      undefined,
      admission,
    )
  })
  const start = () =>
    runtime.submit('parent', project, worker.title, 'initial', worker.preference, worker.mode, worker.id)
  const queue = (prompt: string, requestId = randomUUID()) =>
    runtime.queueFollowup('parent', worker.id, prompt, worker.runId, requestId)
  const items = () => runtime.snapshot('parent', worker.id).queuedFollowups!
  const ready = async (count: number) => {
    await vi.waitFor(() => expect(calls, worker.error).toHaveLength(count))
    return calls[count - 1]!
  }
  return { runtime, storage, directory, worker, calls, service, start, queue, items, ready }
}

it('drains two messages FIFO after clean completion without a subscribed Panel, reauthorizing each turn', async () => {
  const f = fixture(),
    first = f.start()
  await f.ready(1)
  f.queue('second')
  f.queue('third')
  expect(f.items().map((item) => item.state)).toEqual(['pending', 'pending'])
  expect(f.storage.history(f.worker.id).filter((event) => event.kind === 'user')).toHaveLength(1)
  f.calls[0]!.finish()
  expect((await first.done).status).toBe('completed')
  const second = await f.ready(2)
  expect(second.spec.argv.at(-1)).toBe('任务：\nsecond')
  expect(second.spec.argv).toContain('synthetic-session')
  expect(f.items().map((item) => item.prompt)).toEqual(['third'])
  second.finish()
  const third = await f.ready(3)
  expect(third.spec.argv.at(-1)).toBe('任务：\nthird')
  expect(f.service.querySelection).toHaveBeenCalledTimes(2)
  third.finish()
  await vi.waitFor(() => expect(f.worker.status).toBe('completed'))
  expect(f.items()).toEqual([])
})

it('waits for process-scope cleanup, and preserves messages when cleanup fails', async () => {
  const cleanupGate = deferred(),
    f = fixture({ cleanup: false, cleanupGate }),
    task = f.start()
  await f.ready(1)
  f.queue('must not run')
  f.calls[0]!.finish()
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(f.calls).toHaveLength(1)
  expect(f.items()[0]?.state).toBe('pending')
  cleanupGate.resolve()
  expect((await task.done).status).toBe('failed')
  expect(f.items()[0]).toMatchObject({ prompt: 'must not run', state: 'paused' })
  expect(f.service.querySelection).not.toHaveBeenCalled()
})

it('pauses failures and stop, keeps appended text paused, and resumes only on explicit retry', async () => {
  const f = fixture(),
    first = f.start()
  await f.ready(1)
  f.queue('after failure')
  f.calls[0]!.finish('ERROR')
  await first.done
  expect(f.items()[0]?.state).toBe('paused')
  f.queue('also paused')
  expect(f.items().map((item) => item.state)).toEqual(['paused', 'paused'])
  f.runtime.retryQueuedFollowups('parent', f.worker.id, f.worker.runId)
  await f.ready(2)
  await f.runtime.stop('parent', f.worker.id)
  expect(f.items()).toMatchObject([{ prompt: 'also paused', state: 'paused' }])
  expect(f.calls).toHaveLength(2)
})

it('never follows an uncertain native outcome automatically', async () => {
  const f = fixture(),
    first = f.start()
  await f.ready(1)
  f.queue('wait for verification')
  f.calls[0]!.finish('UNCERTAIN')
  expect((await first.done).status).toBe('uncertain')
  expect(f.items()[0]).toMatchObject({ state: 'paused', prompt: 'wait for verification' })
  expect(f.items()[0]?.pauseReason).toContain('结果待核实')
  expect(f.service.querySelection).not.toHaveBeenCalled()
})

it('retains an unsent message if no native conversation was received', async () => {
  const f = fixture()
  f.worker.conversationId = undefined
  f.queue('no invented session')
  await vi.waitFor(() => expect(f.items()[0]?.state).toBe('paused'))
  expect(f.items()[0]?.prompt).toBe('no invented session')
  expect(f.calls).toHaveLength(0)
  expect(() => f.runtime.retryQueuedFollowups('parent', f.worker.id, f.worker.runId)).toThrow('会话标识')
})

it.each(['stop', 'cancel'] as const)(
  'cannot dispatch after %s wins a metadata validation race',
  async (action) => {
    const selectionGate = deferred(),
      f = fixture({ selectionGate }),
      first = f.start()
    await f.ready(1)
    const item = f.queue('must not start')
    f.calls[0]!.finish()
    await first.done
    await vi.waitFor(() => expect(f.items()[0]?.state).toBe('sending'))
    let stopped: Promise<Worker> | undefined,
      stopResolved = false
    if (action === 'stop') {
      stopped = f.runtime.stop('parent', f.worker.id).then((worker) => {
        stopResolved = true
        return worker
      })
      await Promise.resolve()
      expect(stopResolved).toBe(false)
    } else f.runtime.cancelQueuedFollowup('parent', f.worker.id, item.id)
    selectionGate.resolve()
    await stopped
    await vi.waitFor(() => expect((f.runtime as any).followupDispatches.size).toBe(0))
    expect(f.calls).toHaveLength(1)
    expect(f.items()).toHaveLength(action === 'stop' ? 1 : 0)
    if (action === 'stop') expect(f.items()[0]?.state).toBe('paused')
  },
)

it('rejects foreign and stale operations and deduplicates submitted requests', async () => {
  const f = fixture(),
    first = f.start()
  await f.ready(1)
  const id = randomUUID(),
    item = f.queue('once', id)
  expect(f.queue('once', id)).toEqual(item)
  expect(() => f.queue('different', id)).toThrow('消息不同')
  expect(() => f.runtime.queueFollowup('other', f.worker.id, 'x', f.worker.runId, randomUUID())).toThrow(
    'belong',
  )
  expect(() => f.runtime.queueFollowup('parent', f.worker.id, 'x', randomUUID(), randomUUID())).toThrow(
    '状态已变化',
  )
  expect(() => f.runtime.cancelQueuedFollowup('other', f.worker.id, id)).toThrow('belong')
  f.runtime.cancelQueuedFollowup('parent', f.worker.id, id)
  expect(() => f.queue('once', id)).toThrow('已经处理')
  await f.runtime.stop('parent', f.worker.id)
  await first.done
  expect(f.calls).toHaveLength(1)
})

it('restores private pending text as paused after Host restart without replay', async () => {
  const f = fixture()
  f.start()
  await f.ready(1)
  f.queue('survive restart')
  await f.runtime.close()
  if (process.platform !== 'win32')
    expect(statSync(join(f.directory, `${f.worker.id}.followups.json`)).mode & 0o777).toBe(0o600)
  const storage = new WorkerStorage(f.directory)
  const backend = { resolveExecutable: vi.fn(), spawn: vi.fn() } as unknown as ProcessBackend
  const runtime = new WorkerRuntime(storage, backend, DEFAULT_CONFIG)
  cleanups.push(() => runtime.close())
  const launcher = vi.fn(async () => {})
  runtime.setFollowupLauncher(launcher)
  expect(runtime.snapshot('parent', f.worker.id).queuedFollowups).toMatchObject([
    { prompt: 'survive restart', state: 'paused', pauseReason: 'Host 已重启，请确认后继续发送' },
  ])
  await Promise.resolve()
  expect(launcher).not.toHaveBeenCalled()
  expect(backend.spawn).not.toHaveBeenCalled()
})

it('preserves text when the actual launch rejects changed account, model or planning permission', async () => {
  const f = fixture(),
    first = f.start()
  await f.ready(1)
  f.queue('retain rejected message')
  f.service.querySelection.mockRejectedValueOnce(new Error('账号或模型已变更'))
  f.calls[0]!.finish()
  await first.done
  await vi.waitFor(() => expect(f.items()[0]?.state).toBe('paused'))
  expect(f.items()[0]?.pauseReason).toContain('账号或模型已变更')
  f.service.assertExecution.mockImplementation(() => {
    throw new Error('规划模式不可执行')
  })
  f.runtime.retryQueuedFollowups('parent', f.worker.id, f.worker.runId)
  await vi.waitFor(() => expect(f.items()[0]?.pauseReason).toContain('规划模式不可执行'))
  expect(f.calls).toHaveLength(1)
})

it('keeps the original queued item when execution-time authorization fails after Host admission', async () => {
  const f = fixture(),
    first = f.start()
  await f.ready(1)
  const item = f.queue('keep original request identity')
  vi.mocked(authorizeSelection).mockRejectedValueOnce(new Error('执行时模型目录已失效'))
  f.calls[0]!.finish()
  await first.done
  await vi.waitFor(() => expect(f.worker.status).toBe('failed'))
  expect(f.items()).toMatchObject([{ id: item.id, prompt: item.prompt, state: 'paused' }])
  expect(f.worker.error).toContain('执行时模型目录已失效')
  expect(f.calls).toHaveLength(1)
  const failedAdmission = f.runtime
    .snapshot('parent', f.worker.id)
    .timeline.filter((row) => row.kind === 'user' && row.queuedFollowupId === item.id)
  expect(failedAdmission).toHaveLength(0)
  f.runtime.retryQueuedFollowups('parent', f.worker.id, f.worker.runId)
  const resumed = await f.ready(2)
  expect(f.items()).toEqual([])
  const attempts = f.runtime
    .snapshot('parent', f.worker.id)
    .timeline.filter((row) => row.kind === 'user' && row.queuedFollowupId === item.id)
  expect(attempts).toHaveLength(1)
  resumed.finish()
})

it('accepts a queue item for idle legacy history without account binding; its turn binds the current account', () => {
  const f = fixture()
  rmSync(join(f.directory, `${f.worker.id}.account-binding.json`))
  expect(f.queue('legacy continuation').prompt).toBe('legacy continuation')
})

it.each(['hardlink', 'symlink'] as const)(
  'rejects a %s outbox without changing its external target',
  async (kind) => {
    const f = fixture()
    f.start()
    await f.ready(1)
    f.queue('private queued text')
    await f.runtime.close()
    const path = join(f.directory, `${f.worker.id}.followups.json`),
      external = join(f.worker.project, 'external.json')
    renameSync(path, external)
    chmodSync(external, 0o644)
    const originalMode = statSync(external).mode & 0o777
    const originalContent = readFileSync(external)
    if (kind === 'hardlink') linkSync(external, path)
    else symlinkSync(external, path)
    const storage = new WorkerStorage(f.directory)
    expect(
      () =>
        new WorkerRuntime(
          storage,
          { resolveExecutable: vi.fn(), spawn: vi.fn() } as unknown as ProcessBackend,
          DEFAULT_CONFIG,
        ),
    ).toThrow('无法核验')
    expect(statSync(external).mode & 0o777).toBe(originalMode)
    expect(readFileSync(external)).toEqual(originalContent)
  },
)

it('rechecks parent execution permissions after waiting behind another write task', async () => {
  const f = fixture(),
    first = f.start()
  await f.ready(1)
  f.queue('must retain while plan blocks execution')
  const blocker = f.runtime.submit(
    'other-parent',
    f.worker.project,
    'Synthetic blocker',
    'hold directory',
    f.worker.preference,
    'accept-edits',
  )
  let planning = false
  f.runtime.setQueuedExecutionGuard(() => {
    if (planning) throw new Error('宿主已切换规划模式')
  })
  f.calls[0]!.finish()
  await first.done
  await f.ready(2)
  await vi.waitFor(() => expect(f.worker.status).toBe('queued'))
  planning = true
  f.calls[1]!.finish()
  await blocker.done
  await vi.waitFor(() => expect(f.worker.status).toBe('failed'))
  expect(f.worker.error).toContain('规划模式')
  expect(f.items()).toMatchObject([{ prompt: 'must retain while plan blocks execution', state: 'paused' }])
  expect(f.calls).toHaveLength(2)
})

it('uses saved queue mode and reports it without calling a native steering channel', async () => {
  const steer = vi.fn(async () => {}),
    f = fixture({ cli: 'pi', steer })
  f.storage.setRunningMessageMode(f.worker.project, 'pi', 'queue')
  f.start()
  await f.ready(1)
  const id = randomUUID()
  await f.runtime.sendRunningMessage('parent', f.worker.id, 'wait for this turn', f.worker.runId, id)
  expect(f.runtime.snapshot('parent', f.worker.id).runningMessageMode).toBe('queue')
  expect(f.items()).toMatchObject([{ id, prompt: 'wait for this turn', state: 'pending' }])
  expect(steer).not.toHaveBeenCalled()
  expect(f.worker.status).toBe('running')
})

it.each(['pi', 'omp'] as const)(
  'delivers %s steering only once after an acknowledged receipt, preserving the native run',
  async (cli) => {
    const ack = deferred(),
      steer = vi.fn(async () => ack.promise),
      f = fixture({ cli, steer })
    const first = f.start()
    await f.ready(1)
    const runId = f.worker.runId,
      requestId = randomUUID()
    const send = () => f.runtime.sendRunningMessage('parent', f.worker.id, 'new direction', runId, requestId)
    const accepted = send(),
      repeated = send()
    await vi.waitFor(() => expect(steer).toHaveBeenCalledTimes(1))
    expect(f.storage.history(f.worker.id).filter((event) => event.kind === 'user')).toHaveLength(1)
    ack.resolve()
    await Promise.all([accepted, repeated])
    expect(f.worker).toMatchObject({ runId, conversationId: 'synthetic-session', status: 'running' })
    expect(f.calls).toHaveLength(1)
    expect(f.items()).toEqual([])
    expect(
      f.storage
        .history(f.worker.id)
        .filter((event) => event.kind === 'user')
        .map((event) => event.text),
    ).toEqual(['initial', 'new direction'])
    await expect(
      f.runtime.sendRunningMessage('parent', f.worker.id, 'different', runId, requestId),
    ).rejects.toThrow('消息不同')
    f.calls[0]!.finish()
    await first.done
  },
)

it('retains rejected steering as a failed request without queue fallback or a duplicate native send', async () => {
  const steer = vi.fn(async () => {
      throw new Error('synthetic steer rejected')
    }),
    f = fixture({ cli: 'pi', steer })
  f.start()
  await f.ready(1)
  const id = randomUUID(),
    send = () => f.runtime.sendRunningMessage('parent', f.worker.id, 'draft must remain', f.worker.runId, id)
  await expect(send()).rejects.toThrow('synthetic steer rejected')
  await expect(send()).rejects.toThrow('synthetic steer rejected')
  expect(steer).toHaveBeenCalledTimes(1)
  expect(f.items()).toEqual([])
  expect(f.storage.history(f.worker.id).filter((event) => event.kind === 'user')).toHaveLength(1)
})

it('rejects steering before the native channel is attached and after a run is stopped', async () => {
  const steer = vi.fn(async () => {}),
    f = fixture({ cli: 'pi', steer })
  f.start()
  await expect(
    f.runtime.sendRunningMessage('parent', f.worker.id, 'early', f.worker.runId, randomUUID()),
  ).rejects.toThrow('尚未准备好')
  await f.ready(1)
  await f.runtime.stop('parent', f.worker.id)
  await expect(
    f.runtime.sendRunningMessage('parent', f.worker.id, 'late', f.worker.runId, randomUUID()),
  ).rejects.toThrow('已经结束')
  expect(steer).not.toHaveBeenCalled()
  expect(f.items()).toEqual([])
})

it('rechecks account, parent ownership, run identity and execution permission before native steering', async () => {
  const steer = vi.fn(async () => {}),
    f = fixture({ cli: 'pi', steer })
  f.start()
  await f.ready(1)
  await expect(
    f.runtime.sendRunningMessage('other', f.worker.id, 'foreign', f.worker.runId, randomUUID()),
  ).rejects.toThrow('belong')
  await expect(
    f.runtime.sendRunningMessage('parent', f.worker.id, 'stale', randomUUID(), randomUUID()),
  ).rejects.toThrow('状态已变化')
  // A run keeps its starting account; after a switch the message is queued for the next turn.
  vi.mocked(readCliAccountBinding).mockResolvedValueOnce('another-account')
  expect(
    await f.runtime.sendRunningMessage('parent', f.worker.id, 'account', f.worker.runId, randomUUID()),
  ).toMatchObject({ prompt: 'account', state: 'pending' })
  expect(f.items().map((item) => item.prompt)).toEqual(['account'])
  const gate = deferred<string>()
  vi.mocked(readCliAccountBinding).mockReturnValueOnce(gate.promise)
  let planning = false
  f.runtime.setQueuedExecutionGuard(() => {
    if (planning) throw new Error('planning changed')
  })
  const pending = f.runtime.sendRunningMessage(
    'parent',
    f.worker.id,
    'permission',
    f.worker.runId,
    randomUUID(),
  )
  planning = true
  gate.resolve('synthetic-account')
  await expect(pending).rejects.toThrow('planning changed')
  expect(steer).not.toHaveBeenCalled()
})

it('answers duplicate and retried steers with the one queue item they became after an account switch', async () => {
  const steer = vi.fn(async () => {}),
    f = fixture({ cli: 'pi', steer })
  f.start()
  await f.ready(1)
  const gate = deferred<string>()
  vi.mocked(readCliAccountBinding).mockReturnValueOnce(gate.promise)
  const requestId = randomUUID()
  const send = () => f.runtime.steerMessage('parent', f.worker.id, 'switched', f.worker.runId, requestId)
  const first = send(),
    duplicate = send()
  gate.resolve('another-account')
  const [a, b] = await Promise.all([first, duplicate])
  expect(a).toMatchObject({ id: requestId, prompt: 'switched', state: 'pending' })
  expect(b).toEqual(a)
  expect(await send()).toEqual(a)
  expect(
    await f.runtime.sendRunningMessage('parent', f.worker.id, 'switched', f.worker.runId, requestId, undefined, 'steer'),
  ).toEqual(a)
  expect(f.items().map((item) => item.id)).toEqual([requestId])
  expect(steer).not.toHaveBeenCalled()
})

/** The task's stored account is synthetic-account; the CLI is now signed in to another one. */
function switchAccount() {
  vi.mocked(readCliAccountBinding).mockResolvedValue('another-account')
  vi.mocked(authorizeSelection).mockImplementation(async (preference) => ({ binding: 'another-account', preference }) as any)
  cleanups.push(() => {
    vi.mocked(authorizeSelection).mockImplementation(async (preference) => ({ binding: 'synthetic-account', preference }) as any)
  })
}
const carried = (f: ReturnType<typeof fixture>) =>
  f.storage.history(f.worker.id).filter((event) => event.text === CARRYOVER_FAILED_NOTICE)

it('waits for a busy account before a carryover after a spawned resume, then continues in a new session', async () => {
  switchAccount()
  const f = fixture({ cli: 'pi' })
  const task = f.start()
  // The rebound resume is refused before any reply.
  ;(await f.ready(1)).finish('ERROR', '')
  vi.mocked(extendedLaunch).mockRejectedValueOnce(new Error(OWN_ACCOUNT_BUSY))
  await vi.waitFor(() =>
    expect(f.storage.history(f.worker.id).map((event) => event.text)).toContain('账号正被另一个任务使用，排队等待'),
  )
  expect(f.worker.status).toBe('queued')
  expect(f.worker.conversationId).toBeUndefined()
  const fresh = await vi.waitFor(() => {
    expect(f.calls).toHaveLength(2)
    return f.calls[1]!
  }, { timeout: 5000 })
  expect(fresh.spec.argv).not.toContain('synthetic-session')
  fresh.finish()
  expect((await task.done).status).toBe('completed')
  expect(carried(f)).toHaveLength(1)
})

it('restores the original session when a carryover waiting for its account is stopped', async () => {
  switchAccount()
  const f = fixture({ cli: 'pi' })
  const task = f.start()
  ;(await f.ready(1)).finish('ERROR', '')
  vi.mocked(extendedLaunch).mockRejectedValueOnce(new Error(OWN_ACCOUNT_BUSY))
  await vi.waitFor(() => expect(f.worker.status).toBe('queued'))
  await f.runtime.stop('parent', f.worker.id)
  expect((await task.done).conversationId).toBe('synthetic-session')
  expect(f.storage.workers.get(f.worker.id)?.conversationId).toBe('synthetic-session')
  expect(f.calls).toHaveLength(1)
})

it('does not replay a rebound turn in a new session once a steer reached its native process', async () => {
  switchAccount()
  const steer = vi.fn(async () => {}),
    f = fixture({ cli: 'pi', steer })
  const task = f.start()
  const resumed = await f.ready(1)
  await vi.waitFor(() => expect((f.runtime as any).tasks.get(f.worker.id)?.steer).toBeDefined())
  expect(await f.runtime.steerMessage('parent', f.worker.id, 'only once', f.worker.runId, randomUUID())).toBeUndefined()
  expect(steer).toHaveBeenCalledTimes(1)
  resumed.finish('ERROR', '')
  expect(await task.done).toMatchObject({ status: 'failed', conversationId: 'synthetic-session' })
  expect(f.calls).toHaveLength(1)
  expect(carried(f)).toEqual([])
})

it('closes an in-flight steering admission when its run ends, without sending to a later run', async () => {
  const steer = vi.fn(async () => {}),
    f = fixture({ cli: 'pi', steer })
  const task = f.start()
  await f.ready(1)
  const gate = deferred<string>()
  vi.mocked(readCliAccountBinding).mockReturnValueOnce(gate.promise)
  const sending = f.runtime.sendRunningMessage(
    'parent',
    f.worker.id,
    'too late',
    f.worker.runId,
    randomUUID(),
  )
  const rejected = expect(sending).rejects.toThrow('已结束')
  f.calls[0]!.finish()
  await vi.waitFor(() =>
    expect((f.runtime as any).tasks.get(f.worker.id).steeringController.signal.aborted).toBe(true),
  )
  gate.resolve('synthetic-account')
  await rejected
  expect((await task.done).status).toBe('completed')
  expect(steer).not.toHaveBeenCalled()
})

it('prioritizes a selected card only after confirmed cleanup and preserves the remaining order', async () => {
  const cleanupGate = deferred(),
    f = fixture({ cleanupGate }),
    first = f.start()
  await f.ready(1)
  const older = f.queue('older'),
    urgent = f.queue('urgent'),
    later = f.queue('later')
  const runId = f.worker.runId
  const sending = f.runtime.interruptQueuedFollowup('parent', f.worker.id, urgent.id, runId)
  await Promise.resolve()
  expect(f.calls).toHaveLength(1)
  expect(f.items().map((item) => item.prompt)).toEqual(['older', 'later'])
  expect(f.worker.status).toBe('stopping')
  cleanupGate.resolve()
  await sending
  expect(await first.done).toMatchObject({
    status: 'interrupted',
    interruptionReason: 'user',
    error: undefined,
  })
  const priority = await f.ready(2)
  expect(priority.spec.argv.at(-1)).toBe('任务：\nurgent')
  expect(priority.spec.argv).toContain('synthetic-session')
  expect(f.items().map((item) => [item.id, item.state])).toEqual([
    [older.id, 'pending'],
    [later.id, 'pending'],
  ])
  priority.finish()
  const next = await f.ready(3)
  expect(next.spec.argv.at(-1)).toBe('任务：\nolder')
})

it('keeps previously paused messages paused when explicitly prioritizing one card', async () => {
  const f = fixture(),
    first = f.start()
  await f.ready(1)
  const older = f.queue('remain paused'),
    urgent = f.queue('one explicit message')
  await f.runtime.stop('parent', f.worker.id)
  await first.done
  await f.runtime.interruptQueuedFollowup('parent', f.worker.id, urgent.id, f.worker.runId)
  const priority = await f.ready(2)
  expect(f.items()).toMatchObject([{ id: older.id, state: 'paused' }])
  priority.finish()
  await vi.waitFor(() => expect(f.worker.status).toBe('completed'))
  expect(f.calls).toHaveLength(2)
})

it('accepts A/B/C immediately during cleanup, keeps cancelled history and runs only latest', async () => {
  const cleanupGate = deferred(),
    f = fixture({ cleanupGate }),
    client = randomUUID()
  f.start()
  await f.ready(1)
  const a = f.queue('A'),
    ordinary = f.queue('ordinary'),
    b = f.queue('B'),
    c = f.queue('C')
  const send = (item: typeof a, sequence: number) =>
    f.runtime.interruptMessage('parent', f.worker.id, item.prompt, item.id, client, sequence)
  send(a, 1)
  send(b, 2)
  send(c, 3)
  expect(send(c, 3).state).toBe('pending')
  expect(f.items().map((item) => item.id)).toEqual([ordinary.id])
  expect(
    f.runtime.snapshot('parent', f.worker.id).timeline.filter((row) => row.queuedFollowupId),
  ).toMatchObject([
    { text: 'A', deliveryState: 'superseded' },
    { text: 'B', deliveryState: 'superseded' },
    { text: 'C', deliveryState: 'pending' },
  ])
  expect(f.calls).toHaveLength(1)
  cleanupGate.resolve()
  const latest = await f.ready(2)
  expect(latest.spec.argv.at(-1)).toBe('任务：\nC')
  latest.finish()
  expect((await f.ready(3)).spec.argv.at(-1)).toBe('任务：\nordinary')
})

it('deduplicates legacy running interrupt retries and allows replacing during cleanup', async () => {
  const cleanupGate = deferred(),
    f = fixture({ cleanupGate })
  f.storage.setRunningMessageMode(f.worker.project, 'antigravity', 'interrupt')
  f.start()
  await f.ready(1)
  const id = randomUUID(),
    runId = f.worker.runId
  await f.runtime.sendRunningMessage('parent', f.worker.id, 'old priority', runId, id)
  await f.runtime.sendRunningMessage('parent', f.worker.id, 'old priority', runId, id)
  await f.runtime.sendRunningMessage('parent', f.worker.id, 'new priority', runId, randomUUID())
  expect(f.items()).toEqual([])
  cleanupGate.resolve()
  expect((await f.ready(2)).spec.argv.at(-1)).toBe('任务：\nnew priority')
  expect(
    f.runtime.snapshot('parent', f.worker.id).timeline.filter((row) => row.text === 'old priority'),
  ).toMatchObject([{ deliveryState: 'superseded' }])
})

it('explicit Stop cancels accepted priority but transport abort does not revoke durable intent', async () => {
  const cleanupGate = deferred(),
    f = fixture({ cleanupGate }),
    signal = new AbortController()
  f.start()
  await f.ready(1)
  const id = randomUUID()
  f.runtime.interruptMessage('parent', f.worker.id, 'durable', id, randomUUID(), 1, signal.signal)
  signal.abort(new Error('synthetic transport disconnected'))
  const stopping = f.runtime.stop('parent', f.worker.id)
  const next = randomUUID()
  f.runtime.interruptMessage('parent', f.worker.id, 'after explicit stop', next, randomUUID(), 1)
  cleanupGate.resolve()
  await stopping
  expect((await f.ready(2)).spec.argv.at(-1)).toBe('任务：\nafter explicit stop')
  expect(
    f.runtime.snapshot('parent', f.worker.id).timeline.find((row) => row.queuedFollowupId === id),
  ).toMatchObject({ deliveryState: 'cancelled' })
  expect(f.items()).toEqual([])
})

it('continues an accepted priority after only its RPC signal aborts', async () => {
  const cleanupGate = deferred(),
    f = fixture({ cleanupGate }),
    signal = new AbortController()
  f.start()
  await f.ready(1)
  f.runtime.interruptMessage('parent', f.worker.id, 'accepted', randomUUID(), randomUUID(), 1, signal.signal)
  signal.abort()
  cleanupGate.resolve()
  expect((await f.ready(2)).spec.argv.at(-1)).toBe('任务：\naccepted')
})

it.each(['cleanup', 'permission'] as const)(
  'keeps priority text in conversation when %s fails',
  async (failure) => {
    const cleanupGate = deferred(),
      f = fixture({ cleanupGate, cleanup: failure !== 'cleanup' })
    f.start()
    await f.ready(1)
    const item = f.queue('retain priority text')
    let allowed = true
    f.runtime.setQueuedExecutionGuard(() => {
      if (!allowed) throw new Error('execution permission changed')
    })
    await f.runtime.interruptQueuedFollowup('parent', f.worker.id, item.id, f.worker.runId)
    allowed = false
    cleanupGate.resolve()
    await vi.waitFor(() =>
      expect(
        f.runtime.snapshot('parent', f.worker.id).timeline.find((row) => row.queuedFollowupId === item.id)
          ?.deliveryState,
      ).toBe('failed'),
    )
    expect(f.items()).toEqual([])
    expect(f.calls).toHaveLength(1)
  },
)

it('starts a fresh native session when the interrupted initial run never received a session id', async () => {
  const f = fixture()
  f.start()
  await f.ready(1)
  f.worker.conversationId = undefined
  f.runtime.interruptMessage('parent', f.worker.id, 'fresh after stop', randomUUID(), randomUUID(), 1)
  const next = await f.ready(2)
  expect(next.spec.argv).not.toContain('--conversation')
  expect(next.spec.argv.at(-1)).toBe('任务：\nfresh after stop')
})

it.each(['send', 'card'] as const)(
  'checks Gateway permission, project and account-terminal admission for %s',
  async (kind) => {
    const f = fixture()
    f.start()
    await f.ready(1)
    const item = f.queue('existing card')
    const call = () =>
      kind === 'send'
        ? f.service.sendRunningMessage(
            'parent',
            f.worker.id,
            'not admitted',
            f.worker.runId,
            randomUUID(),
            new AbortController().signal,
          )
        : f.service.interruptQueuedFollowup(
            'parent',
            f.worker.id,
            item.id,
            f.worker.runId,
            new AbortController().signal,
          )
    f.service.assertExecution.mockImplementation(() => {
      throw new Error('planning blocked')
    })
    await expect(call()).rejects.toThrow('planning blocked')
    f.service.assertExecution.mockReset()
    f.service.project = () => '/another-project'
    await expect(call()).rejects.toThrow('项目已变更')
    f.service.project = () => f.worker.project
    f.service.accounts.isBusy = () => true
    await expect(call()).rejects.toThrow('账号终端')
    expect(f.worker.status).toBe('running')
    expect(f.items()).toHaveLength(1)
  },
)

it('never reroutes a retried submission after the saved mode changes', async () => {
  const steer = vi.fn(async () => {}),
    f = fixture({ cli: 'pi', steer })
  const task = f.start()
  await f.ready(1)
  const steeringId = randomUUID(),
    queuedId = randomUUID()
  await f.runtime.sendRunningMessage('parent', f.worker.id, 'steered once', f.worker.runId, steeringId)
  f.storage.setRunningMessageMode(f.worker.project, 'pi', 'queue')
  await f.runtime.sendRunningMessage('parent', f.worker.id, 'steered once', f.worker.runId, steeringId)
  await f.runtime.sendRunningMessage('parent', f.worker.id, 'queued once', f.worker.runId, queuedId)
  f.storage.setRunningMessageMode(f.worker.project, 'pi', 'steer')
  await f.runtime.sendRunningMessage('parent', f.worker.id, 'queued once', f.worker.runId, queuedId)
  expect(steer).toHaveBeenCalledTimes(1)
  expect(f.items()).toMatchObject([{ id: queuedId, prompt: 'queued once' }])
  f.runtime.cancelQueuedFollowup('parent', f.worker.id, queuedId)
  f.calls[0]!.finish()
  await task.done
  f.storage.setRunningMessageMode(f.worker.project, 'pi', 'queue')
  await f.runtime.sendRunningMessage('parent', f.worker.id, 'steered once', f.worker.runId, steeringId)
  expect(f.items()).toEqual([])
  expect(f.calls).toHaveLength(1)
})

it('blocks further execution if a steering account query cannot confirm its process cleanup', async () => {
  const steer = vi.fn(async () => {}),
    f = fixture({ cli: 'pi', steer }),
    task = f.start()
  await f.ready(1)
  vi.mocked(readCliAccountBinding).mockRejectedValueOnce(new ProcessCleanupUnconfirmedError())
  await expect(
    f.runtime.sendRunningMessage('parent', f.worker.id, 'not delivered', f.worker.runId, randomUUID()),
  ).rejects.toThrow('quiescence')
  expect((await task.done).status).toBe('failed')
  expect(f.storage.cleanupBlockState()).toBe('none')
  expect(f.storage.cleanupBlockState(f.worker.preference.cli ?? 'antigravity')).toBe('blocked')
  expect(() => f.runtime.assertCliEnabled('codex')).not.toThrow()
  expect(() => f.runtime.assertAccountIdle('pi')).toThrow('清理')
  expect(steer).not.toHaveBeenCalled()
  expect(f.calls).toHaveLength(1)
})

it('allows retrying the same steering identity after a permission or metadata failure before native delivery', async () => {
  const steer = vi.fn(async () => {}),
    f = fixture({ cli: 'pi', steer })
  f.start()
  await f.ready(1)
  const requestId = randomUUID(),
    send = () =>
      f.runtime.sendRunningMessage('parent', f.worker.id, 'retry unchanged draft', f.worker.runId, requestId)
  vi.mocked(readCliAccountBinding).mockRejectedValueOnce(new Error('temporary metadata failure'))
  await expect(send()).rejects.toThrow('temporary metadata failure')
  f.runtime.setQueuedExecutionGuard(() => {
    throw new Error('planning permission denied')
  })
  await expect(send()).rejects.toThrow('planning permission denied')
  f.runtime.setQueuedExecutionGuard(() => {})
  await send()
  expect(steer).toHaveBeenCalledTimes(1)
  expect(f.storage.history(f.worker.id).filter((event) => event.kind === 'user')).toHaveLength(2)
})

it.each(['STEER_REJECTED'])(
  'allows the unchanged draft to retry after explicit %s but not unknown delivery',
  async (code) => {
    const steer = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('synthetic explicit rejection'), { code }))
      .mockResolvedValue(undefined)
    const f = fixture({ cli: 'pi', steer })
    f.start()
    await f.ready(1)
    const id = randomUUID(),
      send = () =>
        f.runtime.sendRunningMessage(
          'parent',
          f.worker.id,
          'retry rejected native command',
          f.worker.runId,
          id,
        )
    await expect(send()).rejects.toThrow('explicit rejection')
    expect(f.storage.history(f.worker.id).filter((event) => event.kind === 'user')).toHaveLength(1)
    await send()
    await send()
    expect(steer).toHaveBeenCalledTimes(2)
    expect(f.storage.history(f.worker.id).filter((event) => event.kind === 'user')).toHaveLength(2)
    expect(f.items()).toEqual([])
  },
)

it('keeps pending queue IDs deduplicated even when bounded delivery receipts rotate', async () => {
  const f = fixture()
  f.start()
  await f.ready(1)
  const id = randomUUID(),
    original = f.queue('still pending', id)
  const outbox = (f.runtime as any).followups
  for (let i = 0; i < 200; i++)
    outbox.recordSteering(f.worker.id, `synthetic steering ${i}`, randomUUID(), true)
  expect(f.queue('still pending', id)).toEqual(original)
  expect(() => f.queue('changed text', id)).toThrow('消息不同')
  const duplicate = await f.runtime.sendRunningMessage(
    'parent',
    f.worker.id,
    'still pending',
    f.worker.runId,
    id,
  )
  expect(duplicate).toEqual(original)
  expect(f.items()).toHaveLength(1)
})

it('treats a confirmed user stop as normal and resumes the same native conversation', async () => {
  const f = fixture(),
    first = f.start()
  await f.ready(1)
  const runId = f.worker.runId
  const stopped = await f.runtime.stop('parent', f.worker.id)
  expect(stopped).toMatchObject({ status: 'interrupted', interruptionReason: 'user', error: undefined })
  expect(await first.done).toEqual(stopped)
  expect(f.storage.history(f.worker.id).at(-1)).toMatchObject({
    kind: 'status',
    state: 'interrupted',
    text: '已停止',
  })
  await f.service.followup('parent', f.worker.id, 'after stop', new AbortController().signal)
  const next = await f.ready(2)
  expect(next.spec.argv).toContain('synthetic-session')
  expect(f.worker.runId).not.toBe(runId)
  expect(f.worker.interruptionReason).toBeUndefined()
  next.finish()
})

it('reopens a normally stopped worker without a native id as a fresh native session', async () => {
  const f = fixture(),
    first = f.start()
  await f.ready(1)
  f.worker.conversationId = undefined
  await f.runtime.stop('parent', f.worker.id)
  await first.done
  const originalId = f.worker.id
  await f.service.followup('parent', f.worker.id, 'new native session', new AbortController().signal)
  const next = await f.ready(2)
  expect(f.worker.id).toBe(originalId)
  expect(next.spec.argv).not.toContain('--conversation')
  expect(f.storage.history(originalId).filter((event) => event.kind === 'user')).toHaveLength(2)
  next.finish()
})

it('can start again after cancellation before native account binding, without bypassing fresh selection', async () => {
  const f = fixture()
  f.worker.conversationId = undefined
  f.worker.status = 'interrupted'
  f.worker.interruptionReason = 'user'
  rmSync(join(f.directory, `${f.worker.id}.account-binding.json`))
  await f.service.followup('parent', f.worker.id, 'new after preparation stop', new AbortController().signal)
  const next = await f.ready(1)
  expect(f.service.querySelection).toHaveBeenCalled()
  expect(next.spec.argv).not.toContain('--conversation')
  expect(f.storage.accountBinding(f.worker.id)).toBe('synthetic-account')
  next.finish()
})

it.each([
  ['ERROR', 'failed', 'synthetic failure'],
  ['UNCERTAIN', 'uncertain', '结果待核实'],
])(
  'preserves an observed %s result when Stop arrives during cleanup',
  async (nativeStatus, status, error) => {
    const cleanupGate = deferred(),
      cleanupStarted = vi.fn(),
      f = fixture({ cleanupGate, cleanupStarted }),
      first = f.start()
    const call = await f.ready(1)
    call.finish(nativeStatus)
    await vi.waitFor(() => expect(cleanupStarted).toHaveBeenCalled())
    const stopping = f.runtime.stop('parent', f.worker.id)
    cleanupGate.resolve()
    const result = await stopping
    expect(result).toMatchObject({ status, interruptionReason: undefined })
    expect(result.error).toContain(error)
    expect(await first.done).toEqual(result)
  },
)

it('waits for cancelled Gateway preparation cleanup before Stop completes or another message starts', async () => {
  const selectionGate = deferred(),
    f = fixture({ selectionGate }),
    signal = new AbortController()
  const send = f.service.followup('parent', f.worker.id, 'cancel preparation', signal.signal)
  const rejected = expect(send).rejects.toThrow()
  await vi.waitFor(() => expect(f.service.querySelection).toHaveBeenCalledTimes(1))
  signal.abort(new Error('synthetic client disconnected'))
  let stopped = false
  const stop = f.runtime.stop('parent', f.worker.id).then(() => {
    stopped = true
  })
  await Promise.resolve()
  expect(stopped).toBe(false)
  expect(f.calls).toHaveLength(0)
  expect(() => f.runtime.assertAccountIdle('antigravity')).toThrow('运行或排队')
  expect(() =>
    f.runtime.configureWorker('parent', f.worker.id, {
      ...f.worker.preference,
      model: 'different-model',
    }),
  ).toThrow('结束后再修改')
  await expect(
    f.service.followup('parent', f.worker.id, 'too early', new AbortController().signal),
  ).rejects.toThrow('清理')
  selectionGate.resolve()
  await rejected
  await stop
  expect(stopped).toBe(true)
  expect(f.calls).toHaveLength(0)
  await f.service.followup('parent', f.worker.id, 'after cleanup', new AbortController().signal)
  ;(await f.ready(1)).finish()
})

it('blocks later messages if cancelled Gateway preparation cannot confirm cleanup', async () => {
  const gate = deferred(),
    f = fixture()
  f.service.querySelection.mockImplementation(async () => {
    await gate.promise
    throw new ProcessCleanupUnconfirmedError()
  })
  const send = f.service.followup(
    'parent',
    f.worker.id,
    'cancel unsafe preparation',
    new AbortController().signal,
  )
  const rejected = expect(send).rejects.toThrow(ProcessCleanupUnconfirmedError)
  await vi.waitFor(() => expect(f.service.querySelection).toHaveBeenCalledTimes(1))
  const stop = f.runtime.stop('parent', f.worker.id)
  const stopRejected = expect(stop).rejects.toThrow('清理')
  gate.resolve()
  await rejected
  await stopRejected
  expect(f.calls).toHaveLength(0)
  await expect(
    f.service.followup('parent', f.worker.id, 'blocked', new AbortController().signal),
  ).rejects.toThrow('清理')
})

it('preserves a queued account admission failure that occurred before the user pressed Stop', async () => {
  const f = fixture()
  f.start()
  await f.ready(1)
  vi.mocked(readCliAccountBinding).mockRejectedValueOnce(new Error('synthetic account lookup failed'))
  const queued = f.runtime.submit(
    'parent',
    f.worker.project,
    'queued synthetic writer',
    'synthetic queued prompt',
    f.worker.preference,
    'accept-edits',
  )
  await Promise.resolve()
  expect(queued.worker.status).toBe('queued')
  const stopped = await f.runtime.stop('parent', queued.worker.id)
  expect(stopped).toMatchObject({ status: 'failed', interruptionReason: undefined })
  expect(stopped.error).toContain('synthetic account lookup failed')
  expect(await queued.done).toEqual(stopped)
  expect(f.calls).toHaveLength(1)
})

it('returns an interrupt revision receipt before metadata completes and associates identical queued text by exact id', async () => {
  const selectionGate = deferred(),
    f = fixture({ selectionGate })
  f.start()
  await f.ready(1)
  const older = f.queue('identical queued prompt'),
    urgent = f.queue('identical queued prompt')
  const receipt = JSON.parse(
    await f.service.interruptQueuedFollowup(
      'parent',
      f.worker.id,
      urgent.id,
      f.worker.runId,
      new AbortController().signal,
    ),
  ) as { queuedId: string; revision: number }
  const accepted = f.runtime.snapshot('parent', f.worker.id)
  expect(receipt.queuedId).toBe(urgent.id)
  expect(receipt.revision).toBeLessThanOrEqual(accepted.revision)
  expect(accepted.queuedFollowups?.map((item) => item.id)).toEqual([older.id])
  expect(accepted.timeline.find((row) => row.queuedFollowupId === urgent.id)).toMatchObject({
    deliveryState: 'pending',
  })
  expect(f.calls).toHaveLength(1)
  selectionGate.resolve()
  const priority = await f.ready(2)
  const admitted = f.runtime.snapshot('parent', f.worker.id)
  expect(admitted.timeline.filter((row) => row.kind === 'user' && row.text === urgent.prompt)).toMatchObject([
    { queuedFollowupId: urgent.id },
  ])
  expect(
    f.storage
      .history(f.worker.id)
      .filter((event) => event.kind === 'user' && event.queuedFollowupId === urgent.id),
  ).toHaveLength(1)
  priority.finish()
  const remaining = await f.ready(3)
  expect(
    f.runtime
      .snapshot('parent', f.worker.id)
      .timeline.filter((row) => row.kind === 'user' && row.text === urgent.prompt)
      .map((row) => row.queuedFollowupId),
  ).toEqual([urgent.id, older.id])
  remaining.finish()
})

it('keeps the accepted priority in conversation when permission fails after its receipt', async () => {
  const selectionGate = deferred(),
    f = fixture({ selectionGate })
  f.start()
  await f.ready(1)
  const item = f.queue('recover after accepted interrupt')
  const receipt = JSON.parse(
    await f.service.interruptQueuedFollowup(
      'parent',
      f.worker.id,
      item.id,
      f.worker.runId,
      new AbortController().signal,
    ),
  ) as { queuedId: string; revision: number }
  f.service.assertExecution.mockImplementation(() => {
    throw new Error('synthetic permission changed')
  })
  selectionGate.resolve()
  await vi.waitFor(() =>
    expect(
      f.runtime.snapshot('parent', f.worker.id).timeline.find((row) => row.queuedFollowupId === item.id)
        ?.deliveryState,
    ).toBe('failed'),
  )
  const rejected = f.runtime.snapshot('parent', f.worker.id)
  expect(rejected.revision).toBeGreaterThanOrEqual(receipt.revision)
  expect(rejected.queuedFollowups).toEqual([])
  expect(rejected.timeline.find((row) => row.queuedFollowupId === item.id)).toMatchObject({
    text: item.prompt,
    deliveryState: 'failed',
    deliveryError: expect.stringContaining('permission changed'),
  })
  expect(f.calls).toHaveLength(1)
})

it('replaces metadata preparation with the latest request after the old cleanup settles', async () => {
  const f = fixture(),
    gate = deferred(),
    client = randomUUID(),
    a = randomUUID(),
    b = randomUUID(),
    c = randomUUID()
  f.start()
  await f.ready(1)
  const ordinary = f.queue('ordinary sibling')
  f.service.querySelection.mockImplementationOnce(async () => {
    await gate.promise
    throw new Error('late old preparation rejection')
  })
  f.runtime.interruptMessage('parent', f.worker.id, 'prepare A', a, client, 1)
  await vi.waitFor(() => expect(f.service.querySelection).toHaveBeenCalledTimes(1))
  f.runtime.interruptMessage('parent', f.worker.id, 'prepare B', b, client, 2)
  f.runtime.interruptMessage('parent', f.worker.id, 'prepare C', c, client, 3)
  expect(f.service.querySelection).toHaveBeenCalledTimes(1)
  expect(f.calls).toHaveLength(1)
  gate.resolve()
  expect((await f.ready(2)).spec.argv.at(-1)).toBe('任务：\nprepare C')
  expect(f.service.querySelection).toHaveBeenCalledTimes(2)
  expect(f.items()).toMatchObject([{ id: ordinary.id, state: 'pending' }])
  expect(
    f.runtime.snapshot('parent', f.worker.id).timeline.filter((row) => row.queuedFollowupId),
  ).toMatchObject([
    { queuedFollowupId: a, deliveryState: 'superseded' },
    { queuedFollowupId: b, deliveryState: 'superseded' },
    { queuedFollowupId: c, deliveryState: 'running' },
  ])
})

it('supersedes an admitted run before native spawn even when its worker already says running', async () => {
  const f = fixture(),
    gate = deferred<string>(),
    client = randomUUID(),
    a = randomUUID(),
    b = randomUUID()
  f.start()
  await f.ready(1)
  const staleRun = f.worker.runId
  vi.mocked(readCliAccountBinding).mockImplementationOnce(async () => gate.promise)
  f.runtime.interruptMessage('parent', f.worker.id, 'admitted A', a, client, 1)
  await vi.waitFor(() => {
    expect(f.worker.status).toBe('running')
    expect(f.worker.runId).not.toBe(staleRun)
    expect(
      f.runtime.snapshot('parent', f.worker.id).timeline.find((row) => row.queuedFollowupId === a)
        ?.deliveryState,
    ).toBe('admitted')
  })
  f.runtime.interruptMessage('parent', f.worker.id, 'latest B', b, client, 2)
  expect(f.calls).toHaveLength(1)
  gate.resolve('synthetic-account')
  expect((await f.ready(2)).spec.argv.at(-1)).toBe('任务：\nlatest B')
  expect(
    f.runtime.snapshot('parent', f.worker.id).timeline.filter((row) => row.queuedFollowupId === a),
  ).toMatchObject([{ text: 'admitted A', deliveryState: 'superseded' }])
})

it('preserves ordinary messages added after an earlier priority has started', async () => {
  const f = fixture(),
    client = randomUUID(),
    a = randomUUID(),
    b = randomUUID()
  f.start()
  await f.ready(1)
  f.runtime.interruptMessage('parent', f.worker.id, 'running A', a, client, 1)
  await f.ready(2)
  const ordinary = f.queue('added while A running')
  f.runtime.interruptMessage('parent', f.worker.id, 'running B', b, client, 2)
  const latest = await f.ready(3)
  expect(
    f.runtime.snapshot('parent', f.worker.id).timeline.find((row) => row.queuedFollowupId === a),
  ).toMatchObject({
    deliveryState: 'cancelled',
    deliveryError: '已停止',
  })
  expect(f.items()).toMatchObject([{ id: ordinary.id, state: 'pending' }])
  latest.finish()
  expect((await f.ready(4)).spec.argv.at(-1)).toBe('任务：\nadded while A running')
})

it('consumes local pending queue identities and prevents a late original queue RPC or old sequence from replacing latest', async () => {
  const cleanupGate = deferred(),
    f = fixture({ cleanupGate }),
    client = randomUUID(),
    a = randomUUID(),
    b = randomUUID()
  f.start()
  await f.ready(1)
  const staleRun = f.worker.runId
  f.runtime.interruptMessage('parent', f.worker.id, 'late B', b, client, 2)
  expect(f.runtime.interruptMessage('parent', f.worker.id, 'late A', a, client, 1).state).toBe('superseded')
  f.runtime.queueFollowup('parent', f.worker.id, 'late A', staleRun, a)
  f.runtime.queueFollowup('parent', f.worker.id, 'late B', staleRun, b)
  expect(f.items()).toEqual([])
  expect(() => f.runtime.interruptMessage('parent', f.worker.id, 'changed', b, client, 2)).toThrow('消息不同')
  cleanupGate.resolve()
  expect((await f.ready(2)).spec.argv.at(-1)).toBe('任务：\nlate B')
  // A consumed identity remains recognized after the run changes.
  f.runtime.queueFollowup('parent', f.worker.id, 'late A', staleRun, a)
  expect(f.items()).toEqual([])
  expect(
    f.runtime.snapshot('parent', f.worker.id).timeline.filter((row) => row.queuedFollowupId),
  ).toMatchObject([
    { queuedFollowupId: b, deliveryState: 'running' },
    { queuedFollowupId: a, deliveryState: 'superseded' },
  ])
})

it('restores submission history across the append-before-outbox-consume crash window without resending', async () => {
  const f = fixture(),
    id = randomUUID(),
    client = randomUUID()
  const item = f.queue('synthetic durable intent', id)
  // Simulate a process exit after durable append but before consume, without a live task.
  f.storage.append(f.worker, {
    kind: 'submission',
    text: item.prompt,
    queuedFollowupId: id,
    deliveryState: 'pending',
    submissionClientId: client,
    submissionSequence: 2,
  })
  await f.runtime.close()
  const storage = new WorkerStorage(f.directory)
  const spawn = vi.fn(() => {
    throw new Error('restart must not spawn')
  })
  const restarted = new WorkerRuntime(storage, { spawn } as unknown as ProcessBackend, DEFAULT_CONFIG)
  cleanups.push(() => restarted.close())
  const snapshot = restarted.snapshot('parent', f.worker.id)
  expect(snapshot.queuedFollowups).toEqual([])
  expect(snapshot.timeline.find((row) => row.queuedFollowupId === id)).toMatchObject({
    text: item.prompt,
    deliveryState: 'cancelled',
    deliveryError: 'Host 已重启，本条消息未自动重发',
  })
  restarted.queueFollowup('parent', f.worker.id, item.prompt, f.worker.runId, id)
  expect(restarted.snapshot('parent', f.worker.id).queuedFollowups).toEqual([])
  expect(
    restarted.interruptMessage('parent', f.worker.id, 'late earlier click', randomUUID(), client, 1).state,
  ).toBe('superseded')
  expect(spawn).not.toHaveBeenCalled()
})

it('waits for a pending native spawn handle and cleanup before replacing that executed priority', async () => {
  const spawnReturnGate = deferred(),
    f = fixture({ spawnReturnGate }),
    client = randomUUID(),
    a = randomUUID(),
    b = randomUUID()
  f.start()
  await f.ready(1)
  f.runtime.interruptMessage('parent', f.worker.id, 'spawn attempted A', a, client, 1)
  await f.ready(2)
  f.runtime.interruptMessage('parent', f.worker.id, 'latest B', b, client, 2)
  expect(
    f.runtime.snapshot('parent', f.worker.id).timeline.find((row) => row.queuedFollowupId === a)
      ?.deliveryState,
  ).toBe('admitted')
  expect(f.calls).toHaveLength(2)
  spawnReturnGate.resolve()
  expect((await f.ready(3)).spec.argv.at(-1)).toBe('任务：\nlatest B')
  expect(
    f.runtime.snapshot('parent', f.worker.id).timeline.find((row) => row.queuedFollowupId === a),
  ).toMatchObject({
    deliveryState: 'cancelled',
    deliveryError: '已停止',
  })
})

it('keeps later priority blocked when superseded metadata cannot confirm cleanup', async () => {
  const f = fixture(),
    gate = deferred(),
    client = randomUUID(),
    a = randomUUID(),
    b = randomUUID()
  f.start()
  await f.ready(1)
  f.service.querySelection.mockImplementationOnce(async () => {
    await gate.promise
    throw new ProcessCleanupUnconfirmedError()
  })
  f.runtime.interruptMessage('parent', f.worker.id, 'old metadata', a, client, 1)
  await vi.waitFor(() => expect(f.service.querySelection).toHaveBeenCalledTimes(1))
  f.runtime.interruptMessage('parent', f.worker.id, 'must not spawn', b, client, 2)
  gate.resolve()
  await vi.waitFor(() =>
    expect(
      f.runtime.snapshot('parent', f.worker.id).timeline.find((row) => row.queuedFollowupId === b)
        ?.deliveryState,
    ).toBe('failed'),
  )
  expect(f.storage.cleanupBlockState()).toBe('none')
  expect(f.storage.cleanupBlockState(f.worker.preference.cli ?? 'antigravity')).toBe('blocked')
  expect(() => f.runtime.assertCliEnabled('codex')).not.toThrow()
  expect(f.calls).toHaveLength(1)
  expect(
    f.runtime.snapshot('parent', f.worker.id).timeline.find((row) => row.queuedFollowupId === a)
      ?.deliveryState,
  ).toBe('superseded')
})

it('promotes an ordinary admitted queue identity before spawn without duplicate conversation bubbles', async () => {
  const f = fixture(),
    gate = deferred<string>(),
    client = randomUUID()
  cleanups.push(() => gate.resolve('synthetic-account'))
  f.start()
  await f.ready(1)
  const queued = f.queue('ordinary becomes priority')
  const previousRun = f.worker.runId
  vi.mocked(readCliAccountBinding).mockImplementationOnce(async () => gate.promise)
  f.calls[0]!.finish()
  await vi.waitFor(() => {
    expect(f.worker.runId).not.toBe(previousRun)
    expect(f.worker.status).toBe('running')
  })
  expect(f.items()).toMatchObject([{ id: queued.id, state: 'sending' }])
  expect(
    f.storage
      .history(f.worker.id)
      .some((event) => event.kind === 'user' && event.queuedFollowupId === queued.id),
  ).toBe(false)
  f.runtime.interruptMessage('parent', f.worker.id, queued.prompt, queued.id, client, 1)
  gate.resolve('synthetic-account')
  expect((await f.ready(2)).spec.argv.at(-1)).toBe('任务：\nordinary becomes priority')
  expect(
    f.runtime.snapshot('parent', f.worker.id).timeline.filter((row) => row.queuedFollowupId === queued.id),
  ).toMatchObject([{ kind: 'user', text: queued.prompt, deliveryState: 'running' }])
  expect(f.items()).toEqual([])
})

it('projects acceptance before preparation and stops only reservations preceding the Stop boundary', async () => {
  const f = fixture(),
    old = f.runtime.reserveSubmission('parent', f.worker.id, randomUUID())
  expect(f.runtime.snapshot('parent', f.worker.id)).toMatchObject({
    selectedBusy: true,
    selectedBusyReason: 'accepting',
  })
  expect(() => f.runtime.configureWorker('parent', f.worker.id, f.worker.preference)).toThrow('结束后再修改')
  const stopping = f.runtime.stop('parent', f.worker.id)
  const fresh = f.runtime.reserveSubmission('parent', f.worker.id, randomUUID())
  await stopping
  expect(old.signal.aborted).toBe(true)
  expect(() => old.assertCurrent()).toThrow()
  expect(fresh.signal.aborted).toBe(false)
  fresh.assertCurrent()
  old.release()
  expect(f.runtime.snapshot('parent', f.worker.id).selectedBusy).toBe(true)
  fresh.release()
  expect(f.runtime.snapshot('parent', f.worker.id).selectedBusy).toBe(false)
})

it('keeps a fixed queue mode Worker-bound despite changed settings and a completed observed run', async () => {
  const f = fixture(),
    id = randomUUID(),
    reservation = f.runtime.reserveSubmission('parent', f.worker.id, id)
  f.storage.setRunningMessageMode(f.worker.project, 'antigravity', 'interrupt')
  const item = await f.runtime.sendRunningMessage(
    'parent',
    f.worker.id,
    'fixed queue',
    randomUUID(),
    id,
    reservation.signal,
    'queue',
  )
  expect(item).toMatchObject({ id, state: 'pending' })
  expect(f.runtime.snapshot('parent', f.worker.id)).toMatchObject({
    selectedBusy: true,
    selectedBusyReason: 'accepting',
  })
  expect(
    f.runtime.snapshot('parent', f.worker.id).timeline.some((event) => event.queuedFollowupId === id),
  ).toBe(false)
  expect(f.calls).toHaveLength(0)
  reservation.release()
  ;(await f.ready(1)).finish()
})

it.each(['stop', 'failure'] as const)(
  'keeps the %s-paused old queue independent of a later explicit round and new FIFO items',
  async (prior) => {
    const f = fixture(),
      first = f.start()
    await f.ready(1)
    const older = f.queue('old paused')
    if (prior === 'stop') await f.runtime.stop('parent', f.worker.id)
    else f.calls[0]!.finish('ERROR')
    await first.done
    expect(f.items()).toMatchObject([{ id: older.id, state: 'paused' }])
    expect(f.runtime.snapshot('parent', f.worker.id).selectedBusy).toBe(false)
    const next = f.start()
    const current = await f.ready(2),
      a = f.queue('same text'),
      b = f.queue('same text')
    expect(a.id).not.toBe(b.id)
    expect(f.items().map((item) => item.state)).toEqual(['paused', 'pending', 'pending'])
    current.finish()
    await next.done
    ;(await f.ready(3)).finish()
    ;(await f.ready(4)).finish()
    await vi.waitFor(() => expect(f.worker.status).toBe('completed'))
    expect(f.items()).toMatchObject([{ id: older.id, state: 'paused' }])
    expect(
      f.storage
        .history(f.worker.id)
        .filter((event) => event.kind === 'user' && [a.id, b.id].includes(event.queuedFollowupId ?? ''))
        .map((event) => event.queuedFollowupId),
    ).toEqual([a.id, b.id])
  },
)

it('does not let late Stop cleanup pause or cancel a fresh queued message and reservation', async () => {
  const gate = deferred(),
    f = fixture({ cleanupGate: gate }),
    first = f.start()
  cleanups.push(() => gate.resolve())
  await f.ready(1)
  const old = f.queue('old before stop'),
    stopping = f.runtime.stop('parent', f.worker.id)
  const id = randomUUID(),
    reservation = f.runtime.reserveSubmission('parent', f.worker.id, id)
  await f.runtime.sendRunningMessage(
    'parent',
    f.worker.id,
    'fresh after stop',
    f.worker.runId,
    id,
    reservation.signal,
    'queue',
  )
  expect(f.runtime.snapshot('parent', f.worker.id)).toMatchObject({
    selectedBusy: true,
    selectedBusyReason: 'stopping',
  })
  reservation.release()
  expect(f.items()).toMatchObject([
    { id: old.id, state: 'paused' },
    { id, state: 'pending' },
  ])
  gate.resolve()
  await stopping
  await first.done
  expect(reservation.signal.aborted).toBe(false)
  expect((await f.ready(2)).spec.argv.at(-1)).toBe('任务：\nfresh after stop')
  expect(f.items()).toMatchObject([{ id: old.id, state: 'paused' }])
  f.calls[1]!.finish()
})

it('cancels an ordinary prepared task before spawn without a bubble or replay', async () => {
  const f = fixture(),
    gate = deferred<string>(),
    first = f.start()
  cleanups.push(() => gate.resolve('synthetic-account'))
  await f.ready(1)
  const item = f.queue('cancel before native spawn'),
    priorRun = f.worker.runId
  vi.mocked(readCliAccountBinding).mockImplementationOnce(async () => gate.promise)
  f.calls[0]!.finish()
  await first.done
  await vi.waitFor(() => expect(f.worker.runId).not.toBe(priorRun))
  expect(f.items()).toMatchObject([{ id: item.id, state: 'sending' }])
  f.runtime.cancelQueuedFollowup('parent', f.worker.id, item.id)
  gate.resolve('synthetic-account')
  await vi.waitFor(() => expect(f.runtime.snapshot('parent', f.worker.id).selectedBusy).toBe(false))
  expect(f.items()).toEqual([])
  expect(f.calls).toHaveLength(1)
  expect(
    f.storage
      .history(f.worker.id)
      .filter((event) => event.kind === 'user' && event.queuedFollowupId === item.id),
  ).toHaveLength(0)
  expect(() => f.queue(item.prompt, item.id)).toThrow('已经处理')
})

it('requires Stop after a spawn attempt and never promotes or replays the same queue identity', async () => {
  const gate = deferred(),
    f = fixture({ spawnReturnGate: gate }),
    first = f.start()
  cleanups.push(() => gate.resolve())
  await f.ready(1)
  const item = f.queue('one spawn only')
  f.calls[0]!.finish()
  await first.done
  await f.ready(2)
  expect(f.items()).toMatchObject([{ id: item.id, state: 'sending' }])
  expect(() => f.runtime.cancelQueuedFollowup('parent', f.worker.id, item.id)).toThrow('停止操作')
  expect(() =>
    f.runtime.interruptMessage('parent', f.worker.id, item.prompt, item.id, randomUUID(), 1),
  ).toThrow('停止操作')
  const stopping = f.runtime.stop('parent', f.worker.id)
  gate.resolve()
  await stopping
  expect(f.calls).toHaveLength(2)
  expect(f.items()).toEqual([])
  expect(
    f.storage
      .history(f.worker.id)
      .filter((event) => event.kind === 'user' && event.queuedFollowupId === item.id),
  ).toHaveLength(1)
})

it('correlates direct submissions by id and preserves two separate identical-text operations', async () => {
  const f = fixture(),
    id = randomUUID(),
    reservation = f.runtime.reserveSubmission('parent', f.worker.id, id)
  const submit = (messageId: string) =>
    f.runtime.submit(
      'parent',
      f.worker.project,
      f.worker.title,
      'identical direct',
      f.worker.preference,
      f.worker.mode,
      f.worker.id,
      undefined,
      undefined,
      undefined,
      undefined,
      messageId,
    )
  const first = submit(id)
  reservation.assertCurrent()
  reservation.release()
  await f.ready(1)
  expect(f.runtime.directMessageReceipt('parent', f.worker.id, 'identical direct', id)).toMatchObject({
    workerId: f.worker.id,
    runId: first.worker.runId,
  })
  expect(() => submit(id)).toThrow('已经受理')
  expect(() => f.runtime.directMessageReceipt('parent', f.worker.id, 'different', id)).toThrow('消息不同')
  f.calls[0]!.finish()
  await first.done
  const secondId = randomUUID(),
    second = submit(secondId)
  ;(await f.ready(2)).finish()
  await second.done
  expect(
    f.storage
      .history(f.worker.id)
      .filter((event) => event.kind === 'user')
      .map((event) => event.queuedFollowupId),
  ).toEqual([id, secondId])
})

it('reserves a unified Remote before parent lookup and cancels both retries when Stop wins that lookup', async () => {
  const f = fixture(),
    parentGate = deferred<any>(),
    agent = await f.service.parent('parent')
  cleanups.push(() => parentGate.resolve(agent))
  f.service.parent.mockClear()
  f.service.parent.mockImplementationOnce(() => parentGate.promise)
  const request = JSON.stringify({
    id: randomUUID(),
    clientId: randomUUID(),
    sequence: 1,
    prompt: 'not after stop',
    mode: 'queue',
    intent: 'direct',
    expectedRunId: f.worker.runId,
  })
  const first = f.service.submitMessage('parent', f.worker.id, request, new AbortController().signal)
  const duplicate = f.service.submitMessage('parent', f.worker.id, request, new AbortController().signal)
  const firstRejected = expect(first).rejects.toThrow(),
    duplicateRejected = expect(duplicate).rejects.toThrow()
  expect(f.runtime.snapshot('parent', f.worker.id)).toMatchObject({
    selectedBusy: true,
    selectedBusyReason: 'accepting',
  })
  expect(f.service.parent).toHaveBeenCalledTimes(1)
  await f.runtime.stop('parent', f.worker.id)
  parentGate.resolve(agent)
  await Promise.all([firstRejected, duplicateRejected])
  expect(f.calls).toHaveLength(0)
  expect(f.service.querySelection).not.toHaveBeenCalled()
  expect(f.runtime.snapshot('parent', f.worker.id).selectedBusy).toBe(false)
})

it('deduplicates unified Remote admission and a later retry with the same direct message id', async () => {
  const gate = deferred(),
    f = fixture({ selectionGate: gate }),
    id = randomUUID()
  cleanups.push(() => gate.resolve())
  const request = JSON.stringify({
    id,
    clientId: randomUUID(),
    sequence: 1,
    prompt: 'one direct Remote',
    mode: 'queue',
    intent: 'direct',
    expectedRunId: f.worker.runId,
  })
  const first = f.service.submitMessage('parent', f.worker.id, request, new AbortController().signal)
  const duplicate = f.service.submitMessage('parent', f.worker.id, request, new AbortController().signal)
  await vi.waitFor(() => expect(f.service.querySelection).toHaveBeenCalledTimes(1))
  expect(f.runtime.snapshot('parent', f.worker.id)).toMatchObject({
    selectedBusy: true,
    selectedBusyReason: 'preparing',
  })
  gate.resolve()
  expect(await first).toBe(await duplicate)
  await f.ready(1)
  const receipt = JSON.parse(
    await f.service.submitMessage('parent', f.worker.id, request, new AbortController().signal),
  )
  expect(receipt).toMatchObject({ workerId: f.worker.id, runId: f.worker.runId })
  expect(f.calls).toHaveLength(1)
  expect(f.service.querySelection).toHaveBeenCalledTimes(1)
  expect(
    f.storage.history(f.worker.id).filter((event) => event.kind === 'user' && event.queuedFollowupId === id),
  ).toHaveLength(1)
  f.calls[0]!.finish()
})

it('uses the unified Remote click-time mode after settings change during parent lookup', async () => {
  const f = fixture(),
    first = f.start(),
    parentGate = deferred<any>(),
    agent = await f.service.parent('parent')
  cleanups.push(() => parentGate.resolve(agent))
  await f.ready(1)
  f.service.parent.mockImplementationOnce(() => parentGate.promise)
  const id = randomUUID(),
    request = JSON.stringify({
      id,
      clientId: randomUUID(),
      sequence: 1,
      prompt: 'frozen queue Remote',
      mode: 'queue',
      intent: 'running',
      expectedRunId: f.worker.runId,
    })
  const sending = f.service.submitMessage('parent', f.worker.id, request, new AbortController().signal)
  f.storage.setRunningMessageMode(f.worker.project, 'antigravity', 'interrupt')
  parentGate.resolve(agent)
  await sending
  expect(f.items()).toMatchObject([{ id, state: 'pending' }])
  expect(
    f.runtime.snapshot('parent', f.worker.id).timeline.some((event) => event.queuedFollowupId === id),
  ).toBe(false)
  expect(f.calls).toHaveLength(1)
  f.calls[0]!.finish()
  await first.done
  ;(await f.ready(2)).finish()
})

it('requires sending or cancelling paused outbox text before changing its model and effort', async () => {
  const f = fixture(),
    first = f.start()
  await f.ready(1)
  const item = f.queue('must retain original selection')
  await f.runtime.stop('parent', f.worker.id)
  await first.done
  const preference = { ...f.worker.preference, model: 'new-model' }
  expect(() => f.runtime.configureWorker('parent', f.worker.id, preference)).toThrow('包含已暂停消息')
  expect(f.worker.preference.model).toBe('synthetic-model')
  expect(f.items()).toMatchObject([{ id: item.id, state: 'paused' }])
  f.runtime.cancelQueuedFollowup('parent', f.worker.id, item.id)
  expect(f.runtime.configureWorker('parent', f.worker.id, preference).preference.model).toBe('new-model')
})

it('keeps a same-message reservation until every upgrade lease releases, and Stop cancels all leases', async () => {
  const f = fixture(),
    id = randomUUID(),
    first = f.runtime.reserveSubmission('parent', f.worker.id, id),
    upgraded = f.runtime.reserveSubmission('parent', f.worker.id, id)
  expect(first.signal).toBe(upgraded.signal)
  first.release()
  first.release()
  expect(f.runtime.snapshot('parent', f.worker.id)).toMatchObject({
    selectedBusy: true,
    selectedBusyReason: 'accepting',
  })
  await f.runtime.stop('parent', f.worker.id)
  expect(upgraded.signal.aborted).toBe(true)
  upgraded.release()
  expect(f.runtime.snapshot('parent', f.worker.id).selectedBusy).toBe(false)
})

it('upgrades a unified queue Remote before its parent lookup returns without replay or a late card', async () => {
  const f = fixture(),
    first = f.start(),
    gate = deferred<any>(),
    agent = await f.service.parent('parent')
  cleanups.push(() => gate.resolve(agent))
  await f.ready(1)
  f.service.parent.mockImplementationOnce(() => gate.promise)
  const request = {
    id: randomUUID(),
    clientId: randomUUID(),
    sequence: 1,
    prompt: 'queue upgraded while accepting',
    mode: 'queue',
    intent: 'running',
    expectedRunId: f.worker.runId,
  }
  const queuing = f.service.submitMessage(
    'parent',
    f.worker.id,
    JSON.stringify(request),
    new AbortController().signal,
  )
  const upgraded = await f.service.submitMessage(
    'parent',
    f.worker.id,
    JSON.stringify({ ...request, mode: 'interrupt', sequence: 2 }),
    new AbortController().signal,
  )
  expect(JSON.parse(upgraded).messageId).toBe(request.id)
  const priority = await f.ready(2)
  await first.done
  expect(f.items()).toEqual([])
  gate.resolve(agent)
  await queuing
  expect(f.items()).toEqual([])
  expect(f.calls).toHaveLength(2)
  expect(
    f.storage
      .history(f.worker.id)
      .filter((event) => event.kind === 'user' && event.queuedFollowupId === request.id),
  ).toHaveLength(1)
  expect(
    f.runtime
      .snapshot('parent', f.worker.id)
      .timeline.filter((event) => event.queuedFollowupId === request.id),
  ).toMatchObject([{ kind: 'user', text: request.prompt }])
  priority.finish()
})

it('does not let a stale Harness job cancel callback stop a later explicit round', async () => {
  const f = fixture(),
    first = f.start()
  ;(await f.ready(1)).finish()
  await first.done
  const second = f.start()
  await f.ready(2)
  first.cancel()
  expect(f.calls[1]!.spec.signal?.aborted).toBe(false)
  expect(f.worker.status).toBe('running')
  f.calls[1]!.finish()
  expect((await second.done).status).toBe('completed')
})

it('preserves unknown steering after attempted delivery and never redelivers an unacknowledged receipt', async () => {
  const steer = vi.fn(async () => {
      throw new Error('synthetic receipt timeout')
    }),
    f = fixture({ cli: 'pi', steer }),
    first = f.start()
  await f.ready(1)
  const id = randomUUID(),
    runId = f.worker.runId
  const send = () =>
    f.runtime.sendRunningMessage('parent', f.worker.id, 'unknown delivery', runId, id, undefined, 'steer')
  await expect(send()).rejects.toMatchObject({ code: 'STEER_UNKNOWN' })
  await expect(send()).rejects.toMatchObject({ code: 'STEER_UNKNOWN' })
  f.calls[0]!.finish()
  await first.done
  await expect(send()).rejects.toMatchObject({ code: 'STEER_UNKNOWN' })
  expect(steer).toHaveBeenCalledTimes(1)
  expect(f.items()).toEqual([])
})

it('preserves attempted steering unknown delivery in the unified Remote error details', async () => {
  const steer = vi.fn(async () => {
      throw new Error('synthetic unknown native receipt')
    }),
    f = fixture({ cli: 'pi', steer })
  f.start()
  await f.ready(1)
  const request = JSON.stringify({
    id: randomUUID(),
    clientId: randomUUID(),
    sequence: 1,
    prompt: 'unknown via Remote',
    mode: 'steer',
    intent: 'running',
    expectedRunId: f.worker.runId,
  })
  await expect(
    f.service.submitMessage('parent', f.worker.id, request, new AbortController().signal),
  ).rejects.toMatchObject({ details: { deliveryUnknown: true } })
  expect(steer).toHaveBeenCalledTimes(1)
  expect(f.items()).toEqual([])
})

it('steers the current native run independently of an older paused queue', async () => {
  const steer = vi.fn(async () => {}),
    f = fixture({ cli: 'pi', steer }),
    first = f.start()
  await f.ready(1)
  const queued = f.queue('old queue remains paused')
  await f.runtime.stop('parent', f.worker.id)
  await first.done
  const next = f.start()
  await f.ready(2)
  const runId = f.worker.runId,
    requestId = randomUUID()
  await f.runtime.steerMessage('parent', f.worker.id, 'independent native direction', runId, requestId)
  expect(steer).toHaveBeenCalledTimes(1)
  expect(f.worker.runId).toBe(runId)
  expect(f.items()).toMatchObject([{ id: queued.id, state: 'paused' }])
  expect(f.calls).toHaveLength(2)
  f.calls[1]!.finish()
  await next.done
  expect(f.items()).toMatchObject([{ id: queued.id, state: 'paused' }])
})

it('accepts a different native steering id without waiting for the earlier acknowledgement', async () => {
  const ack = deferred(),
    steer = vi
      .fn()
      .mockImplementationOnce(async () => ack.promise)
      .mockResolvedValue(undefined),
    f = fixture({ cli: 'pi', steer })
  cleanups.push(() => ack.resolve())
  const first = f.start()
  await f.ready(1)
  const runId = f.worker.runId,
    a = randomUUID(),
    b = randomUUID()
  let firstAcknowledged = false
  const firstSend = f.runtime.steerMessage('parent', f.worker.id, 'first direction', runId, a).then(() => {
    firstAcknowledged = true
  })
  await vi.waitFor(() => expect(steer).toHaveBeenCalledTimes(1))
  await f.runtime.steerMessage('parent', f.worker.id, 'second direction', runId, b)
  expect(steer).toHaveBeenCalledTimes(2)
  expect(firstAcknowledged).toBe(false)
  expect(f.worker.runId).toBe(runId)
  expect(f.items()).toEqual([])
  ack.resolve()
  await firstSend
  f.calls[0]!.finish()
  await first.done
})

it('rejects independent steering when its pinned run ends during authorization without creating a queue', async () => {
  const gate = deferred<string>(),
    steer = vi.fn(async () => {}),
    f = fixture({ cli: 'pi', steer }),
    first = f.start()
  cleanups.push(() => gate.resolve('synthetic-account'))
  await f.ready(1)
  let authorizationSignal: AbortSignal | undefined
  vi.mocked(readCliAccountBinding).mockImplementationOnce(
    async (_cli, _backend, _config, _project, signal) => {
      authorizationSignal = signal
      return gate.promise
    },
  )
  const send = f.runtime.steerMessage(
    'parent',
    f.worker.id,
    'must not reach an ended run',
    f.worker.runId,
    randomUUID(),
  )
  const rejected = expect(send).rejects.toThrow()
  await vi.waitFor(() => expect(authorizationSignal).toBeDefined())
  f.calls[0]!.finish()
  await vi.waitFor(() => expect(authorizationSignal?.aborted).toBe(true))
  gate.resolve('synthetic-account')
  await rejected
  await first.done
  expect(steer).not.toHaveBeenCalled()
  expect(f.items()).toEqual([])
  expect(f.calls).toHaveLength(1)
})

it('preserves unknown delivery on the dedicated steering Remote without queue admission', async () => {
  const steer = vi.fn(async () => {
      throw new Error('synthetic missing native ACK')
    }),
    f = fixture({ cli: 'pi', steer })
  f.start()
  await f.ready(1)
  const queueAdmission = vi.spyOn(f.runtime, 'queueFollowup')
  await expect(
    f.service.steerMessage(
      'parent',
      f.worker.id,
      'dedicated unknown',
      f.worker.runId,
      randomUUID(),
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ details: { deliveryUnknown: true } })
  expect(steer).toHaveBeenCalledTimes(1)
  expect(queueAdmission).not.toHaveBeenCalled()
  expect(f.items()).toEqual([])
})

it('rejects a dedicated steering Remote that loses its target during parent lookup without scheduling later', async () => {
  const steer = vi.fn(async () => {}),
    f = fixture({ cli: 'pi', steer }),
    first = f.start()
  await f.ready(1)
  const agent = await f.service.parent('parent'),
    gate = deferred<any>()
  cleanups.push(() => gate.resolve(agent))
  f.service.parent.mockImplementationOnce(() => gate.promise)
  const sending = f.service.steerMessage(
    'parent',
    f.worker.id,
    'current turn only',
    f.worker.runId,
    randomUUID(),
    new AbortController().signal,
  )
  const rejected = expect(sending).rejects.toThrow('尚未准备好或已经结束')
  f.calls[0]!.finish()
  await first.done
  gate.resolve(agent)
  await rejected
  expect(steer).not.toHaveBeenCalled()
  expect(f.items()).toEqual([])
  expect(f.calls).toHaveLength(1)
})

// Simulated disk failure: the outbox path is replaced by a non-empty directory,
// so only follow-up queue writes fail (atomic rename onto a directory).
function breakQueueWrites(directory: string, workerId: string) {
  const path = join(directory, `${workerId}.followups.json`)
  rmSync(path, { force: true })
  mkdirSync(path)
  writeFileSync(join(path, 'occupied'), 'simulated')
  return () => rmSync(path, { recursive: true, force: true })
}

it('cancels the run and earlier reservations even when the Stop outbox write fails', async () => {
  const f = fixture(),
    task = f.start()
  const first = await f.ready(1)
  f.queue('must not be sent after stop')
  const reservation = f.runtime.reserveSubmission('parent', f.worker.id, randomUUID())
  cleanups.push(() => reservation.release())
  cleanups.push(breakQueueWrites(f.directory, f.worker.id))
  const stopping = Promise.resolve().then(() => f.runtime.stop('parent', f.worker.id))
  const rejected = expect(stopping).rejects.toThrow('待发送消息状态持久化失败')
  await vi.waitFor(() => expect(first.spec.signal?.aborted).toBe(true))
  expect(reservation.signal.aborted).toBe(true)
  await rejected
  expect((await task.done).status).toBe('failed')
  expect(f.runtime.snapshot('parent', f.worker.id).queuedFollowups).toMatchObject([
    { prompt: 'must not be sent after stop' },
  ])
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(f.calls).toHaveLength(1)
})

it('still releases launch resources after Stop when only the outbox write fails', async () => {
  const f = fixture({ cli: 'pi' }),
    cleanup = vi.fn(async () => {})
  vi.mocked(extendedLaunch).mockResolvedValue({ argv: ['/synthetic/native-rpc'], env: {}, cleanup })
  const task = f.start()
  await f.ready(1)
  cleanups.push(breakQueueWrites(f.directory, f.worker.id))
  await expect(f.runtime.stop('parent', f.worker.id)).rejects.toThrow('待发送消息状态持久化失败')
  expect((await task.done).status).toBe('interrupted')
  expect(cleanup).toHaveBeenCalledOnce()
})

it('finishes Host close and releases the store when one stop throws synchronously', async () => {
  const f = fixture(),
    task = f.start()
  await f.ready(1)
  const stop = vi.spyOn(f.runtime, 'stop').mockImplementationOnce(() => {
    throw new Error('Simulated synchronous stop failure')
  })
  await expect(f.runtime.close()).resolves.toBeUndefined()
  expect(stop).toHaveBeenCalledTimes(1)
  expect(readdirSync(f.directory).filter((name) => name.startsWith('host.lock'))).toEqual([])
  f.calls[0]!.finish()
  await task.done
})
