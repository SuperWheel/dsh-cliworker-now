import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { WorkerStorage } from '../src/host/storage.ts'
import { WorkerRuntime } from './fixtures/legacy-runtime.ts'
import { CliWorkerService } from '../src/host/index.ts'
import { authorizedCatalog } from '../src/host/authorized-catalog.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import type { Worker } from '../src/shared/types.ts'

// Bounded synthetic state/streams only. Every native account and model transport is replaced.
const faults = vi.hoisted(() => ({
  admission: false,
  catalog: false,
  prepare: false,
  release: false,
  quiescent: true,
}))
vi.mock('../src/host/pi-omp-identity.ts', () => ({
  verifyPiOmpExecutable: async (_cli: string, executable: string) => executable,
}))
vi.mock('../src/host/cli-account-binding.ts', async () => {
  const { ProcessCleanupUnconfirmedError } = await import('../src/host/process.ts')
  return {
    readCliAccountBinding: async () => {
      if (faults.admission) throw new ProcessCleanupUnconfirmedError()
      return 'synthetic-own-account'
    },
  }
})
vi.mock('../src/host/authorized-catalog.ts', async () => {
  const { ProcessCleanupUnconfirmedError } = await import('../src/host/process.ts')
  return {
    ACCOUNT_CHANGED: 'Synthetic account changed',
    authorizeSelection: async (preference) => ({ binding: 'synthetic-own-account', preference }),
    authorizedCatalog: vi.fn(async (cli) => {
      if (faults.catalog) throw new ProcessCleanupUnconfirmedError()
      return { binding: 'synthetic-own-account', catalog: { cli, notice: 'Synthetic',
        models: [{ id: 'synthetic', label: 'Synthetic model', efforts: ['low'] }] } }
    }),
  }
})
vi.mock('../src/host/extended-adapters.ts', async () => {
  const { ProcessCleanupUnconfirmedError } = await import('../src/host/process.ts')
  return {
    isExtendedCli: (cli) => cli === 'omp',
    extendedLaunch: async () => {
      if (faults.prepare) throw new ProcessCleanupUnconfirmedError()
      if (faults.release)
        return {
          argv: ['/synthetic/omp', '--synthetic-fixture'],
          env: {},
          cleanup: async () => {
            throw new ProcessCleanupUnconfirmedError()
          },
        }
      throw new Error('This synthetic fixture does not run an extended CLI')
    },
  }
})

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  Object.assign(faults, { admission: false, catalog: false, prepare: false, release: false, quiescent: true })
  vi.restoreAllMocks()
  vi.mocked(authorizedCatalog).mockClear()
})
const preference = { cli: 'antigravity' as const, model: 'synthetic-model', effort: 'low' as const }

function fixture() {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-cleanup-persistence-')))
  cleanups.push(() => rmSync(project, { recursive: true, force: true }))
  const directory = join(project, 'state')
  const storage = new WorkerStorage(directory)
  const backend: ProcessBackend = {
    resolveExecutable: vi.fn(async () => '/synthetic/agy'),
    spawn: vi.fn((spec) => {
      const stdout = new PassThrough(),
        stderr = new PassThrough()
      if (spec.argv[0] === '/synthetic/omp')
        stdout.end(
          JSON.stringify({ type: 'session', id: 'synthetic-session', model: preference.model }) +
            '\n' +
            JSON.stringify({ type: 'result', status: 'SUCCESS', response: 'Synthetic result' }) +
            '\n',
        )
      else
        stdout.end(
          JSON.stringify({
            event: 'result',
            result: {
              conversation_id: 'synthetic-new-session',
              status: 'SUCCESS',
              response: 'Synthetic result',
            },
          }) + '\n',
        )
      stderr.end()
      return {
        stdout,
        stderr,
        done: Promise.resolve({ exitCode: 0 }),
        terminate: vi.fn(),
        waitForExit: async () => faults.quiescent,
      } as any
    }),
  }
  const runtime = new WorkerRuntime(storage, backend, DEFAULT_CONFIG)
  cleanups.push(() => runtime.close())
  const serviceFor = (current: WorkerRuntime) => {
    const service: any = Object.create(CliWorkerService.prototype)
    Object.assign(service, {
      nativeRunDone: new Map(),
      runtime: current,
      backend,
      options: DEFAULT_CONFIG,
      parent: async (id) => ({
        id,
        session: { header: { cwd: project, origin: 'user' } },
        ctx: {
          get: (name) =>
            name === 'sandboxPolicy' ? { resolve: () => ({ mode: 'workspace-write' }) } : undefined,
        },
      }),
      disposed: new AbortController(),
    })
    return service
  }
  const signal = new AbortController().signal
  const legacy: Worker = {
    id: randomUUID(),
    runId: randomUUID(),
    parentSessionId: 'parent',
    project,
    title: 'Synthetic legacy',
    agentName: 'legacy-custom',
    agentNameOrigin: 'custom',
    status: 'completed',
    mode: 'accept-edits',
    preference,
    conversationId: 'synthetic-original-session',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:01.000Z',
  }
  const reopen = async () => {
    await runtime.close()
    const reopened = new WorkerStorage(directory)
    const rebuilt = new WorkerRuntime(reopened, backend, DEFAULT_CONFIG)
    cleanups.push(() => rebuilt.close())
    return { reopened, rebuilt, service: serviceFor(rebuilt) }
  }
  return {
    project,
    directory,
    storage,
    runtime,
    backend,
    signal,
    legacy,
    reopen,
    service: serviceFor(runtime),
  }
}

describe('durable Host cleanup quarantine', () => {
  it('persists only a private safety marker and refuses management, restart, accounts and task admission after reconstruction', async () => {
    const f = fixture()
    f.storage.save(f.legacy)
    const archived = {
      ...f.legacy,
      id: randomUUID(),
      agentName: 'archived-custom',
      archivedAt: new Date().toISOString(),
    }
    f.storage.save(archived)
    f.storage.append(f.legacy, { kind: 'assistant', text: 'Synthetic retained history' })
    f.runtime.blockOnCleanup(new ProcessCleanupUnconfirmedError())
    const marker = join(f.directory, 'cleanup-blocked.json')
    expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual({ policy: 1, state: 'cleanup-unconfirmed' })
    if (process.platform !== 'win32') expect(statSync(f.directory).mode & 0o777).toBe(0o700)
    if (process.platform !== 'win32') expect(statSync(marker).mode & 0o777).toBe(0o600)
    const { reopened, rebuilt, service } = await f.reopen()
    expect(reopened.cleanupBlockState()).toBe('blocked')
    expect(() => rebuilt.deleteWorker('parent', f.legacy.id)).toThrow('清理')
    expect(() => rebuilt.restoreWorker('parent', archived.id)).toThrow('清理')
    await expect(service.restartWorker('parent', f.legacy.id, 'Synthetic', f.signal)).rejects.toThrow('清理')
    expect(() => rebuilt.assertAccountIdle('antigravity')).toThrow('清理')
    expect(() => rebuilt.assertCliEnabled('codex')).toThrow('清理')
    expect(() =>
      rebuilt.submit('parent', f.project, 'Synthetic', 'Synthetic', preference, 'accept-edits'),
    ).toThrow('清理')
    expect(reopened.history(f.legacy.id)).toHaveLength(1)
    expect(reopened.accountBinding(f.legacy.id)).toBeUndefined()
    expect(reopened.workers.get(archived.id)?.archivedAt).toBe(archived.archivedAt)
    expect(f.backend.spawn).not.toHaveBeenCalled()
    await rebuilt.close()
    expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual({ policy: 1, state: 'cleanup-unconfirmed' })
  })

  it('a catalog cleanup failure without any Worker preserves only its CLI block after reconstruction', async () => {
    const f = fixture()
    faults.catalog = true
    await expect(f.service.catalogForCli('parent', 'antigravity', f.signal)).rejects.toThrow('cleanup')
    expect(f.storage.workers.size).toBe(0)
    const { rebuilt, reopened, service } = await f.reopen()
    expect(reopened.cleanupBlockState()).toBe('none')
    expect(reopened.cleanupBlockState('antigravity')).toBe('blocked')
    faults.catalog = false
    await expect(service.catalogForCli('parent', 'antigravity', f.signal)).rejects.toThrow('此 CLI')
    await expect(service.catalogForCli('parent', 'codex', f.signal)).resolves.toContain('codex')
    expect(authorizedCatalog).toHaveBeenCalledTimes(2)
    expect(() => rebuilt.assertAccountIdle('codex')).not.toThrow()
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })

  it('reports a CLI pause as account status and releases it, durably, only on the user request', async () => {
    const f = fixture()
    faults.catalog = true
    await expect(f.service.catalogForCli('parent', 'antigravity', f.signal)).rejects.toThrow('cleanup')
    faults.catalog = false
    const { reopened, rebuilt, service } = await f.reopen()
    const accounts = {
      assertCleanupRecoverable: vi.fn(),
      recoverCleanup: vi.fn(),
      status: vi.fn(async (cli: string) => ({ cli, installed: true, state: 'authenticated', actions: [] })),
    }
    service.accounts = accounts
    const held = JSON.parse(await service.accountStatus('parent', 'antigravity', f.signal))
    expect(held).toMatchObject({ cli: 'antigravity', state: 'unavailable', cleanupBlocked: true, actions: [] })
    expect(held.summary).toContain('已暂停此 CLI')
    expect(held.summary).not.toContain('重启')
    expect(accounts.status).not.toHaveBeenCalled()
    expect(JSON.parse(await service.recoverCliCleanup('parent', 'antigravity', f.signal))).toEqual({
      cli: 'antigravity',
      recovered: true,
    })
    expect(accounts.assertCleanupRecoverable).toHaveBeenCalledWith('antigravity')
    expect(accounts.recoverCleanup).toHaveBeenCalledWith('antigravity')
    expect(reopened.cleanupBlockState('antigravity')).toBe('none')
    expect(() => rebuilt.assertCliEnabled('antigravity')).not.toThrow()
    expect(JSON.parse(await service.accountStatus('parent', 'antigravity', f.signal)).state).toBe('authenticated')
    await expect(service.catalogForCli('parent', 'antigravity', f.signal)).resolves.toContain('antigravity')
    await rebuilt.close()
    const again = new WorkerRuntime(new WorkerStorage(f.directory), f.backend, DEFAULT_CONFIG)
    cleanups.push(() => again.close())
    expect(() => again.assertCliEnabled('antigravity')).not.toThrow()
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })

  it('keeps a CLI paused while it has work, while its account terminal refuses, and under the global quarantine', async () => {
    const f = fixture()
    f.runtime.blockCatalogOnCleanup('antigravity', new ProcessCleanupUnconfirmedError())
    const refusing = {
      assertCleanupRecoverable: vi.fn(() => {
        throw new Error('此 CLI 的账号终端仍在运行或等待关闭，请先关闭账号终端')
      }),
      recoverCleanup: vi.fn(),
    }
    f.service.accounts = refusing
    await expect(f.service.recoverCliCleanup('parent', 'antigravity', f.signal)).rejects.toThrow('账号终端')
    expect(f.storage.cleanupBlockState('antigravity')).toBe('blocked')
    f.service.accounts = { assertCleanupRecoverable: vi.fn(), recoverCleanup: vi.fn() }
    f.storage.save({ ...f.legacy, status: 'queued' })
    await expect(f.service.recoverCliCleanup('parent', 'antigravity', f.signal)).rejects.toThrow('排队')
    expect(f.service.accounts.recoverCleanup).not.toHaveBeenCalled()
    expect(f.storage.cleanupBlockState('antigravity')).toBe('blocked')
    expect(() => f.runtime.assertCliEnabled('antigravity')).toThrow('已暂停此 CLI')
    f.storage.save({ ...f.legacy, status: 'completed' })
    f.runtime.blockOnCleanup(new ProcessCleanupUnconfirmedError())
    await expect(f.service.recoverCliCleanup('parent', 'antigravity', f.signal)).rejects.toThrow('清理')
    await expect(f.service.accountStatus('parent', 'antigravity', f.signal)).rejects.toThrow('清理')
    expect(f.storage.cleanupBlockState()).toBe('blocked')
    expect(f.storage.cleanupBlockState('antigravity')).toBe('blocked')
  })

  it('releases a damaged CLI record the same way and never removes a directory in its place', async () => {
    const f = fixture()
    writeFileSync(join(f.directory, 'cleanup-blocked-antigravity.json'), '{synthetic damaged', { mode: 0o600 })
    const { reopened, rebuilt } = await f.reopen()
    expect(reopened.cleanupBlockState('antigravity')).toBe('invalid')
    expect(() => rebuilt.assertCliEnabled('antigravity')).toThrow('无法核验')
    rebuilt.recoverCatalogCleanup('antigravity')
    expect(reopened.cleanupBlockState('antigravity')).toBe('none')
    mkdirSync(join(f.directory, 'cleanup-blocked-grok.json'))
    expect(() => reopened.clearCleanupBlock('grok')).toThrow('不是文件')
    expect(statSync(join(f.directory, 'cleanup-blocked-grok.json')).isDirectory()).toBe(true)
  })

  it.each(['admission', 'prepare', 'process-exit', 'account-release'] as const)(
    'records explicit unconfirmed %s cleanup at its Runtime source',
    async (source) => {
      const f = fixture()
      if (source === 'admission') faults.admission = true
      if (source === 'prepare') faults.prepare = true
      if (source === 'account-release') faults.release = true
      if (source === 'process-exit') faults.quiescent = false
      const selection =
        source === 'prepare' || source === 'account-release'
          ? { ...preference, cli: 'omp' as const }
          : preference
      const task = f.runtime.submit(
        'parent',
        f.project,
        'Synthetic',
        'Synthetic task',
        selection,
        'accept-edits',
      )
      expect((await task.done).status).toBe('failed')
      expect(f.storage.cleanupBlockState()).toBe(source === 'admission' ? 'none' : 'blocked')
      if (source === 'admission') expect(f.storage.cleanupBlockState('antigravity')).toBe('blocked')
      const { rebuilt } = await f.reopen()
      expect(() => rebuilt.assertAccountIdle('antigravity')).toThrow('清理')
      expect(() => rebuilt.deleteWorker('parent', task.worker.id)).toThrow('清理')
      expect(f.backend.spawn).toHaveBeenCalledTimes(
        source === 'process-exit' || source === 'account-release' ? 1 : 0,
      )
    },
  )

  it.each([
    'truncated-json',
    'wrong-policy',
    'unexpected-state',
    'extra-data',
    'oversized',
    'symlink',
  ] as const)('fails closed for %s quarantine data', async (corruption) => {
    const f = fixture()
    const marker = join(f.directory, 'cleanup-blocked.json')
    if (corruption === 'symlink') {
      const target = join(f.project, 'synthetic-target.json')
      writeFileSync(target, JSON.stringify({ policy: 1, state: 'cleanup-unconfirmed' }))
      symlinkSync(target, marker)
    } else {
      const value = {
        'truncated-json': '{',
        'wrong-policy': JSON.stringify({ policy: 2, state: 'cleanup-unconfirmed' }),
        'unexpected-state': JSON.stringify({ policy: 1, state: 'clean' }),
        'extra-data': JSON.stringify({ policy: 1, state: 'cleanup-unconfirmed', unexpected: true }),
        oversized: 'x'.repeat(1025),
      }[corruption]
      writeFileSync(marker, value)
    }
    const { reopened, rebuilt, service } = await f.reopen()
    expect(reopened.cleanupBlockState()).toBe('invalid')
    expect(() => rebuilt.assertAccountIdle('antigravity')).toThrow('隔离记录无法核验')
    expect(() =>
      rebuilt.submit('parent', f.project, 'Synthetic', 'Synthetic', preference, 'accept-edits'),
    ).toThrow('隔离记录无法核验')
    await expect(service.catalogForCli('parent', 'antigravity', f.signal)).rejects.toThrow('隔离记录无法核验')
    expect(authorizedCatalog).not.toHaveBeenCalled()
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })

  it('does not infer quarantine from historical error text when no explicit marker exists', async () => {
    const f = fixture()
    f.storage.save({
      ...f.legacy,
      status: 'failed',
      error: '无法确认 CLI 进程已清理，已暂停后续派遣：Synthetic historical text',
    })
    const { reopened, rebuilt } = await f.reopen()
    expect(reopened.cleanupBlockState()).toBe('none')
    expect(() => rebuilt.assertAccountIdle('antigravity')).not.toThrow()
    expect(() => rebuilt.deleteWorker('parent', f.legacy.id)).not.toThrow()
  })

  it('keeps the current Host closed and reports persistence failure when quarantine cannot be written', () => {
    const f = fixture()
    f.storage.save(f.legacy)
    vi.spyOn(f.storage, 'blockCleanup').mockImplementationOnce(() => {
      throw new Error('Synthetic disk failure')
    })
    f.runtime.blockOnCleanup(new ProcessCleanupUnconfirmedError())
    expect(() => f.runtime.assertAccountIdle('antigravity')).toThrow('隔离记录保存失败')
    expect(() => f.runtime.deleteWorker('parent', f.legacy.id)).toThrow('隔离记录保存失败')
    expect(() =>
      f.runtime.submit('parent', f.project, 'Synthetic', 'Synthetic', preference, 'accept-edits'),
    ).toThrow('隔离记录保存失败')
    expect(f.storage.cleanupBlockState()).toBe('none')
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
})

it.each(['stop', 'job-cancel'] as const)(
  'cancels queued work despite repeated state writes failing through %s',
  async (method) => {
    const f = fixture()
    const task = f.runtime.submit(
      'parent',
      f.project,
      'Synthetic disk fault',
      'must not spawn',
      preference,
      'accept-edits',
    )
    const save = vi.spyOn(f.storage, 'save').mockImplementation(() => {
      throw new Error('Synthetic persistent disk failure')
    })
    try {
      if (method === 'stop')
        await expect(f.runtime.stop('parent', task.worker.id)).rejects.toThrow('停止状态持久化失败')
      else task.cancel()
      const result = await task.done
      expect(result.status).toBe('failed')
      expect(result.error).toContain('持久化失败')
      await vi.waitFor(() => expect(f.runtime.snapshot('parent', task.worker.id).selectedBusy).toBe(false))
      expect(f.backend.spawn).not.toHaveBeenCalled()
      expect(() => f.runtime.assertCliEnabled('antigravity')).toThrow('持久化失败')
    } finally {
      save.mockRestore()
    }
  },
)

it('waits for the running process range to exit before reporting a stop-state write failure', async () => {
  const f = fixture()
  const started = Promise.withResolvers<void>(),
    exit = Promise.withResolvers<{ exitCode: number }>(),
    quiescent = Promise.withResolvers<void>()
  const terminate = vi.fn(() => {})
  vi.mocked(f.backend.spawn).mockImplementationOnce((spec) => {
    const stdout = new PassThrough(),
      stderr = new PassThrough()
    const finish = () => {
      stdout.end()
      stderr.end()
      exit.resolve({ exitCode: 143 })
    }
    terminate.mockImplementation(finish)
    spec.signal?.addEventListener('abort', finish, { once: true })
    started.resolve()
    return {
      stdout,
      stderr,
      done: exit.promise,
      terminate,
      waitForExit: async () => {
        await quiescent.promise
        return true
      },
    } as any
  })
  const task = f.runtime.submit(
    'parent',
    f.project,
    'Synthetic active disk fault',
    'synthetic running',
    preference,
    'accept-edits',
  )
  await started.promise
  const save = vi.spyOn(f.storage, 'save').mockImplementation(() => {
    throw new Error('Synthetic persistent disk failure')
  })
  try {
    let settled = false
    const stopping = f.runtime.stop('parent', task.worker.id)
    const rejected = expect(stopping).rejects.toThrow('停止状态持久化失败')
    void stopping.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    await vi.waitFor(() => expect(terminate).toHaveBeenCalled())
    expect(settled).toBe(false)
    expect(f.runtime.snapshot('parent', task.worker.id).selectedBusy).toBe(true)
    quiescent.resolve()
    await rejected
    await expect(task.done).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('持久化失败'),
    })
    expect(f.runtime.snapshot('parent', task.worker.id).selectedBusy).toBe(false)
    expect(f.backend.spawn).toHaveBeenCalledTimes(1)
  } finally {
    quiescent.resolve()
    save.mockRestore()
  }
})
