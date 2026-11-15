import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { extendedLaunch } from '../src/host/extended-adapters.ts'
import { WorkerRuntime } from './fixtures/legacy-runtime.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'

// Synthetic preparation only: this suite never invokes an installed CLI or reads its accounts.
vi.mock('../src/host/pi-omp-identity.ts', () => ({
  verifyPiOmpExecutable: async (_cli: string, executable: string) => executable,
}))
vi.mock('../src/host/extended-adapters.ts', () => ({
  isExtendedCli: (cli: string) => cli === 'omp',
  extendedLaunch: vi.fn(),
  extendedCatalog: vi.fn(() => {
    throw new Error('Synthetic runtime suite must not discover native accounts')
  }),
}))

const launch = vi.mocked(extendedLaunch)
const cleanups: (() => void | Promise<void>)[] = []
const preference = { cli: 'omp' as const, model: 'synthetic-provider/model', effort: 'default' as const }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cliworker-runtime-metadata-synthetic-')))
  const project = join(root, 'project')
  const home = join(root, 'home')
  mkdirSync(project, { mode: 0o700 })
  mkdirSync(home, { mode: 0o700 })
  vi.stubEnv('HOME', home)
  vi.stubEnv('XDG_CONFIG_HOME', join(home, 'config'))
  vi.stubEnv('XDG_DATA_HOME', join(home, 'data'))
  vi.stubEnv('DSH_HOME', join(home, 'dsh'))
  const backend: ProcessBackend = {
    resolveExecutable: vi.fn(async () => '/synthetic/omp'),
    spawn: vi.fn(() => {
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      stdout.end(
        JSON.stringify({ type: 'session', id: 'synthetic-session', model: preference.model }) +
          '\n' +
          JSON.stringify({ type: 'result', status: 'SUCCESS', response: 'Synthetic next task completed' }) +
          '\n',
      )
      stderr.end()
      return {
        stdout,
        stderr,
        done: Promise.resolve({ exitCode: 0 }),
        terminate: vi.fn(),
        waitForExit: vi.fn(async () => true),
      } as unknown as SubprocessHandle
    }),
  }
  const storage = new WorkerStorage(join(root, 'state'))
  const runtime = new WorkerRuntime(storage, backend, {
    ...DEFAULT_CONFIG,
    maxConcurrent: 1,
    stateDirectory: join(root, 'state'),
    ompExecutable: '/synthetic/omp',
  })
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  cleanups.push(() => runtime.close())
  const submit = (title = 'Synthetic metadata task') =>
    runtime.submit('synthetic-parent', project, title, 'Synthetic prompt only', preference, 'accept-edits')
  return { runtime, backend, storage, submit }
}

function safeLaunch(cleanup = vi.fn()) {
  return { argv: ['/synthetic/omp', '--synthetic-fixture'], env: {}, cleanup }
}

beforeEach(() => launch.mockReset())
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.unstubAllEnvs()
})

describe('metadata preparation cleanup admission, isolated synthetic fixtures', () => {
  // 模拟 Windows Job: natural exit has begun, but runner IPC is still closing.
  it('模拟 Windows natural completion avoids EPIPE and keeps dispatch admission open', async () => {
    const { runtime, backend, storage, submit } = setup()
    launch.mockResolvedValue(safeLaunch())
    const original = backend.spawn
    const terminate = vi.fn()
    backend.spawn = vi.fn((spec) => {
      const child = original(spec)
      let poisoned = false
      child.terminate = () => { terminate(); poisoned = true }
      child.waitForExit = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 30))
        if (poisoned) throw new Error('write EPIPE')
        return true
      })
      return child
    })
    expect((await submit().done).status).toBe('completed')
    expect(terminate).not.toHaveBeenCalled()
    expect(existsSync(join(storage.directory, 'cleanup-blocked.json'))).toBe(false)
    expect(() => runtime.assertAccountIdle('pi')).not.toThrow()
    expect((await submit('模拟 next run').done).status).toBe('completed')
  })

  it('模拟 delayed natural exit receives a bounded grace before cleanup', async () => {
    const { backend, submit } = setup()
    launch.mockResolvedValue(safeLaunch())
    const original = backend.spawn
    const terminate = vi.fn()
    backend.spawn = vi.fn((spec) => {
      const child = original(spec)
      child.done = new Promise(resolve => setTimeout(() => resolve({ exitCode: 0, signal: null }), 30))
      child.terminate = terminate
      return child
    })
    expect((await submit().done).status).toBe('completed')
    expect(terminate).not.toHaveBeenCalled()
  })

  it('模拟 completed pipes with a lingering process terminate after bounded natural exit grace', async () => {
    const { backend, submit } = setup()
    launch.mockResolvedValue(safeLaunch())
    const original = backend.spawn
    const terminate = vi.fn()
    let started = 0, terminated = 0
    backend.spawn = vi.fn((spec) => {
      const child = original(spec)
      const exit = deferred<{ exitCode: number; signal: null }>()
      child.done = exit.promise
      child.terminate = () => { terminate(); terminated = Date.now(); exit.resolve({ exitCode: 0, signal: null }) }
      spec.signal?.addEventListener('abort', child.terminate, { once: true })
      started = Date.now()
      return child
    })
    expect((await submit().done).status).toBe('completed')
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(terminated - started).toBeGreaterThanOrEqual(2900)
    expect(terminated - started).toBeLessThan(4500)
  }, 7000)

  it('模拟 stop during natural exit grace terminates immediately and waits for range exit', async () => {
    const { runtime, backend, submit } = setup()
    launch.mockResolvedValue(safeLaunch())
    const original = backend.spawn
    const terminate = vi.fn()
    const range = deferred<boolean>()
    backend.spawn = vi.fn((spec) => {
      const child = original(spec)
      const exit = deferred<{ exitCode: number; signal: null }>()
      child.done = exit.promise
      child.terminate = () => { terminate(); exit.resolve({ exitCode: 0, signal: null }) }
      // 模拟 the native backend's abort listener (all real backends own cancellation).
      spec.signal?.addEventListener('abort', child.terminate, { once: true })
      child.waitForExit = vi.fn(() => range.promise)
      return child
    })
    const first = submit()
    await vi.waitFor(() => expect(backend.spawn).toHaveBeenCalledTimes(1))
    const stopping = runtime.stop('synthetic-parent', first.worker.id)
    expect(terminate).toHaveBeenCalled()
    let settled = false
    void stopping.then(() => { settled = true })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(settled).toBe(false)
    range.resolve(true)
    expect((await stopping).status).toBe('interrupted')
  })

  it('模拟 genuine range EPIPE still persists global quarantine and blocks subsequent dispatch', async () => {
    const { runtime, backend, storage, submit } = setup()
    launch.mockResolvedValue(safeLaunch())
    const original = backend.spawn
    backend.spawn = vi.fn(spec => {
      const child = original(spec)
      child.waitForExit = vi.fn(async () => { throw new Error('write EPIPE') })
      return child
    })
    expect(await submit().done).toMatchObject({ status: 'failed', error: expect.stringContaining('write EPIPE') })
    expect(existsSync(join(storage.directory, 'cleanup-blocked.json'))).toBe(true)
    expect(() => submit('模拟 blocked next run')).toThrow('无法确认')
    expect(() => runtime.assertAccountIdle('pi')).toThrow('无法确认')
  })

  it('cancellation during Host account activation waits for activation and releases without spawning', async () => {
    const { runtime, backend, submit } = setup()
    const activated = deferred<void>()
    const activate = vi.fn(() => activated.promise)
    const release = vi.fn()
    launch.mockResolvedValue({ ...safeLaunch(release), activate })
    const first = submit()
    await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(1))
    const stopped = runtime.stop('synthetic-parent', first.worker.id)
    expect(release).not.toHaveBeenCalled()
    expect(backend.spawn).not.toHaveBeenCalled()
    activated.resolve()
    expect((await stopped).status).toBe('interrupted')
    expect(release).toHaveBeenCalledTimes(1)
    expect(backend.spawn).not.toHaveBeenCalled()
  })

  it('an account activation conflict releases preparation, waits without spawning, then runs', async () => {
    const { backend, submit } = setup()
    const release = vi.fn()
    launch
      .mockResolvedValueOnce({
        ...safeLaunch(release),
        activate: vi.fn(async () => {
          throw new Error('账号正被使用，请稍后刷新')
        }),
      })
      .mockResolvedValue(safeLaunch())
    const submission = submit()
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))
    expect(submission.worker.status).toBe('queued')
    expect(backend.spawn).not.toHaveBeenCalled()
    expect((await submission.done).status).toBe('completed')
    expect(backend.spawn).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])(
    'awaits asynchronous account cleanup before settling or dequeuing (stop=%s)',
    async (stop) => {
      const { runtime, backend, submit } = setup()
      const cleanup = deferred<void>()
      const release = vi.fn(() => cleanup.promise)
      launch.mockResolvedValueOnce(safeLaunch(release)).mockResolvedValue(safeLaunch())
      const first = submit()
      const queued = submit('Synthetic queued account cleanup')
      let settled = false
      void first.done.then(() => {
        settled = true
      })
      await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))
      const stopped = stop ? runtime.stop('synthetic-parent', first.worker.id) : undefined
      expect(settled).toBe(false)
      expect(queued.worker.status).toBe('queued')
      expect(backend.spawn).toHaveBeenCalledTimes(1)
      cleanup.resolve()
      expect((await first.done).status).toBe(stop ? 'interrupted' : 'completed')
      if (stopped) await stopped
      expect((await queued.done).status).toBe('completed')
      expect(backend.spawn).toHaveBeenCalledTimes(2)
    },
  )

  it('does not release account state when the native process range has not exited', async () => {
    const { backend, submit } = setup()
    const release = vi.fn()
    launch.mockResolvedValue(safeLaunch(release))
    const original = backend.spawn
    backend.spawn = vi.fn((spec) => {
      const child = original(spec)
      vi.mocked(child.waitForExit).mockResolvedValue(false)
      return child
    })
    expect(await submit().done).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('无法确认'),
    })
    expect(release).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'reports failed and blocks queued work and account mutation after unconfirmed preparation cleanup (stop=%s)',
    async (stopWhilePreparing) => {
      const { runtime, backend, storage, submit } = setup()
      const prepared = deferred<Awaited<ReturnType<typeof extendedLaunch>>>()
      launch.mockImplementationOnce(() => prepared.promise)
      const first = submit()
      const queued = submit('Synthetic queued task')
      await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1))
      expect(first.worker.status).toBe('running')
      expect(queued.worker.status).toBe('queued')
      const stopping = stopWhilePreparing ? runtime.stop('synthetic-parent', first.worker.id) : undefined
      if (stopping) expect(first.worker.status).toBe('stopping')
      const cleanupFailure = new ProcessCleanupUnconfirmedError()
      prepared.reject(cleanupFailure)

      const failed = await first.done
      expect(failed.status).toBe('failed')
      expect(failed.error).toContain(cleanupFailure.message)
      if (stopping) expect(await stopping).toEqual(failed)
      expect(await runtime.stop('synthetic-parent', first.worker.id)).toEqual(failed)
      const rejectedQueue = await queued.done
      expect(rejectedQueue.status).toBe('failed')
      expect(rejectedQueue.error).toBe(failed.error)
      expect(storage.history(first.worker.id).at(-1)).toMatchObject({ state: 'failed', text: failed.error })
      expect(backend.spawn).not.toHaveBeenCalled()
      expect(launch).toHaveBeenCalledTimes(1)
      expect(backend.resolveExecutable).toHaveBeenCalledTimes(1)

      expect(() => submit('Synthetic later task')).toThrow(failed.error!)
      for (const cli of ['omp', 'pi', 'opencode']) {
        expect(() => runtime.assertAccountIdle(cli)).toThrow(failed.error!)
      }
      const enabledBefore = structuredClone(storage.cliSettings())
      expect(() => runtime.setCliEnabled('omp', false)).toThrow(failed.error!)
      expect(storage.cliSettings()).toEqual(enabledBefore)
      expect(backend.spawn).not.toHaveBeenCalled()
    },
  )

  it('safe preparation cleanup after cancellation releases state and permits the next queued task', async () => {
    const { runtime, backend, submit } = setup()
    const prepared = deferred<Awaited<ReturnType<typeof extendedLaunch>>>()
    const release = vi.fn()
    launch.mockImplementationOnce(() => prepared.promise).mockResolvedValue(safeLaunch())
    const first = submit()
    const next = submit('Synthetic next task')
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1))
    const stopped = runtime.stop('synthetic-parent', first.worker.id)
    prepared.resolve(safeLaunch(release))

    expect(await stopped).toMatchObject({
      status: 'interrupted',
      interruptionReason: 'user',
      error: undefined,
    })
    expect(release).toHaveBeenCalledTimes(1)
    expect(await next.done).toMatchObject({
      status: 'completed',
      lastResult: 'Synthetic next task completed',
    })
    expect(backend.spawn).toHaveBeenCalledTimes(1)
    expect(launch).toHaveBeenCalledTimes(2)
    expect(() => runtime.assertAccountIdle('omp')).not.toThrow()
    expect(() => runtime.setCliEnabled('omp', false)).not.toThrow()
  })

  it('an ordinary cancelled preparation rejection does not poison queue or account admission', async () => {
    const { runtime, backend, submit } = setup()
    const prepared = deferred<Awaited<ReturnType<typeof extendedLaunch>>>()
    launch.mockImplementationOnce(() => prepared.promise).mockResolvedValue(safeLaunch())
    const first = submit()
    const next = submit('Synthetic next task')
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1))
    const stopped = runtime.stop('synthetic-parent', first.worker.id)
    prepared.reject(new Error('Synthetic metadata cancelled after confirmed cleanup'))

    expect(await stopped).toMatchObject({
      status: 'interrupted',
      interruptionReason: 'user',
      error: undefined,
    })
    expect((await next.done).status).toBe('completed')
    expect(backend.spawn).toHaveBeenCalledTimes(1)
    expect(() => runtime.assertAccountIdle('omp')).not.toThrow()
    expect(() => runtime.setCliEnabled('omp', false)).not.toThrow()
  })

  it('a normal preparation error fails that task while the queue remains usable', async () => {
    const { runtime, backend, submit } = setup()
    launch
      .mockRejectedValueOnce(new Error('Synthetic invalid model configuration'))
      .mockResolvedValue(safeLaunch())
    const first = submit()
    const next = submit('Synthetic next task')

    expect(await first.done).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Synthetic invalid model configuration'),
    })
    expect((await next.done).status).toBe('completed')
    expect(backend.spawn).toHaveBeenCalledTimes(1)
    expect(launch).toHaveBeenCalledTimes(2)
    expect(() => runtime.assertAccountIdle('omp')).not.toThrow()
    expect((await submit('Synthetic later task').done).status).toBe('completed')
    expect(backend.spawn).toHaveBeenCalledTimes(2)
  })
})

// Synthetic authorization fixture for lifecycle/protocol tests; own-account rules
// are exercised separately by authorized-catalog and runtime-account-isolation.
vi.mock('../src/host/cli-account-binding.ts', () => ({
  readCliAccountBinding: async () => 'synthetic-own-account',
}))
vi.mock('../src/host/authorized-catalog.ts', () => ({
  ACCOUNT_CHANGED: '账号已变更，请重新选择或新建任务',
  authorizeSelection: async (preference: unknown) => ({ binding: 'synthetic-own-account', preference }),
}))
