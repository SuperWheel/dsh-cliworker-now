import { hostServiceFixture } from './fixtures/host-service.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CLI_IDS, type Worker } from '../src/shared/types.ts'
import { CliWorkerService } from '../src/host/index.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { WorkerRuntime } from './fixtures/legacy-runtime.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import { catalogFor, type Catalog } from '../src/host/adapters.ts'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import { SettingsCatalogCache } from '../src/host/settings-catalog-cache.ts'

vi.mock('../src/host/adapters.ts', async (original) => ({
  ...(await original<object>()),
  catalogFor: vi.fn(),
}))

// Synthetic storage, parent context and subprocesses; no real CLI/account is changed.
const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.clearAllMocks()
})
const preference = { cli: 'antigravity' as const, model: 'fixture', effort: 'low' as const }
const catalog: Catalog = {
  cli: 'antigravity',
  models: [{ id: 'fixture', label: 'Synthetic fixture', efforts: ['low'] }],
  notice: 'Synthetic fixture',
}
it('returns lightweight Host/project display metadata and latest preferences without any CLI probe', async () => {
  const f = fixture()
  f.storage.setPreference(f.project, preference)
  const first = JSON.parse(await f.service.cliSettings('parent', f.signal))
  const second = JSON.parse(await f.service.cliSettings('parent', f.signal))
  expect(first.settingsCache).toMatchObject({ policy: 1, host: expect.any(String), project: expect.any(String),
    preferences: { antigravity: preference } })
  expect(second.settingsCache.host).toBe(first.settingsCache.host)
  expect(second.settingsCache.project).toBe(first.settingsCache.project)
  expect(f.accounts.status).not.toHaveBeenCalled()
  expect(f.backend.spawn).not.toHaveBeenCalled()
  expect(first.settingsCache).not.toHaveProperty('binding')
  await f.service.setCliEnabled('parent', 'codex', false, f.signal)
  const changed = JSON.parse(await f.service.cliSettings('parent', f.signal))
  expect(changed.settingsCache.revisions.codex).not.toBe(first.settingsCache.revisions.codex)
  expect(changed.settingsCache.revisions.antigravity).toBe(first.settingsCache.revisions.antigravity)
})
it('pins the reused machine-wide list to its original account for another parent without querying auth', async () => {
  const f = fixture(), cache = new SettingsCatalogCache(f.storage.directory)
  cache.remember(f.machine, { catalog, binding: 'SIMULATED-original-account' }, cache.revision('antigravity'))
  ;(f.service as any)['host'].settingsCatalogs = cache
  const settings = JSON.parse(await f.service.cliSettings('another-parent', f.signal))
  expect(settings.settingsCache.catalogReady.antigravity).toBe(true)
  expect((f.service as any)['host'].displayedBindings.get(JSON.stringify(['another-parent', 'antigravity']))).toBe('SIMULATED-original-account')
  expect(f.accounts.status).not.toHaveBeenCalled(); expect(f.backend.spawn).not.toHaveBeenCalled()
  cache.invalidate('antigravity')
  const invalid = JSON.parse(await f.service.cliSettings('another-parent', f.signal))
  expect(invalid.settingsCache.catalogReady.antigravity).toBe(false)
  expect((f.service as any)['host'].displayedBindings.get(JSON.stringify(['another-parent', 'antigravity']))).toBe('SIMULATED-original-account')
})
it('a settings model-query cleanup failure blocks only that CLI metadata and task admission', async () => {
  const f = fixture()
  vi.mocked(catalogFor).mockRejectedValueOnce(new ProcessCleanupUnconfirmedError())
  await expect(
    f.service.catalogForCli('parent', 'antigravity', new AbortController().signal),
  ).rejects.toThrow()
  await expect(
    f.service.catalogForCli('parent', 'antigravity', new AbortController().signal),
  ).rejects.toThrow('清理')
  expect(() =>
    f.runtime.submit('parent', f.project, 'Synthetic', 'Synthetic', preference, 'accept-edits'),
  ).toThrow('清理')
  expect(catalogFor).toHaveBeenCalledTimes(1)
  expect(f.storage.cleanupBlockState()).toBe('none')
  expect(f.storage.cleanupBlockState('antigravity')).toBe('blocked')
  expect(() => f.runtime.assertCliEnabled('codex')).not.toThrow()
  expect(f.backend.spawn).not.toHaveBeenCalled()
})
describe.each(CLI_IDS)('%s refresh failure isolation (synthetic queries, no real CLI)', (failedCli) => {
  const others = CLI_IDS.filter(cli => cli !== failedCli)
  const mockQuery = (f: ReturnType<typeof fixture>) => {
    // Protocol-specific account transports have separate suites. Exercise the
    // actual RPC/cache/runtime boundary with one synthetic account per CLI.
    vi.spyOn(f.service['host'] as any, 'queryCatalog').mockImplementation(async (cli: any) => ({
      binding: 'synthetic-settings-account',
      catalog: await catalogFor(cli, f.backend, DEFAULT_CONFIG, f.project, f.signal),
    }))
  }
  it.each(['renewal', 'denied', 'timeout', 'cancelled', 'invalid-catalog'] as const)(
    'keeps every other CLI query and task admission available after %s', async kind => {
      const f = fixture()
      mockQuery(f)
      const error = kind === 'cancelled' ? new DOMException('Synthetic caller cancelled', 'AbortError')
        : new Error(`Synthetic ${kind} metadata failure`)
      vi.mocked(catalogFor).mockImplementation(async cli => {
        if (cli === failedCli) throw error
        return { ...catalog, cli }
      })
      f.accounts.status.mockImplementation(async cli => ({ cli, state: 'authenticated', actions: [] }))
      await expect(f.service.refreshCatalogForCli('parent', failedCli, f.signal)).rejects.toThrow()
      expect(f.storage.cleanupBlockState()).toBe('none')
      expect(f.storage.cleanupBlockState(failedCli)).toBe('none')
      for (const cli of others) {
        expect(JSON.parse(await f.service.refreshCatalogForCli('parent', cli, f.signal)).cli).toBe(cli)
        expect(JSON.parse(await f.service.accountStatus('parent', cli, f.signal)).cli).toBe(cli)
        const accepted = f.runtime.submit('parent', f.project, 'Synthetic isolation', 'Synthetic no-model',
          { cli, model: 'fixture', effort: 'low' }, 'accept-edits')
        // Verify real Runtime admission, then cancel before any native task spawn.
        await f.runtime.stop('parent', accepted.worker.id)
        expect((await accepted.done).status).toBe('interrupted')
      }
      expect(f.backend.spawn).not.toHaveBeenCalled()
    },
  )
  it.each(['models', 'account'] as const)('quarantines only this CLI after unconfirmed %s cleanup', async entry => {
    const f = fixture()
    mockQuery(f)
    vi.mocked(catalogFor).mockImplementation(async cli => ({ ...catalog, cli }))
    f.accounts.status.mockImplementation(async cli => ({ cli, state: 'authenticated', actions: [] }))
    if (entry === 'models') {
      vi.mocked(catalogFor).mockRejectedValueOnce(new ProcessCleanupUnconfirmedError())
      await expect(f.service.refreshCatalogForCli('parent', failedCli, f.signal)).rejects.toThrow('cleanup')
    } else {
      f.accounts.status.mockRejectedValueOnce(new ProcessCleanupUnconfirmedError())
      await expect(f.service.accountStatus('parent', failedCli, f.signal)).rejects.toThrow('cleanup')
    }
    expect(f.storage.cleanupBlockState()).toBe('none')
    expect(f.storage.cleanupBlockState(failedCli)).toBe('blocked')
    expect(() => f.runtime.assertCliEnabled(failedCli)).toThrow('此 CLI')
    expect(() => f.runtime.assertAccountIdle(failedCli)).toThrow('此 CLI')
    for (const cli of others) {
      expect(JSON.parse(await f.service.refreshCatalogForCli('parent', cli, f.signal)).cli).toBe(cli)
      expect(JSON.parse(await f.service.accountStatus('parent', cli, f.signal)).cli).toBe(cli)
      const accepted = f.runtime.submit('parent', f.project, 'Synthetic isolation', 'Synthetic no-model',
        { cli, model: 'fixture', effort: 'low' }, 'accept-edits')
      await f.runtime.stop('parent', accepted.worker.id)
      expect((await accepted.done).status).toBe('interrupted')
    }
    expect(f.backend.spawn).not.toHaveBeenCalled()
    await f.runtime.close()
    const restored = new WorkerRuntime(new WorkerStorage(f.storage.directory), f.backend, DEFAULT_CONFIG)
    cleanups.push(() => restored.close())
    expect(() => restored.assertCliEnabled(failedCli)).toThrow('此 CLI')
    for (const cli of others) {
      expect(() => restored.assertCliEnabled(cli)).not.toThrow()
      expect(() => restored.assertAccountIdle(cli)).not.toThrow()
    }
  })
})
it('rejects an already queued quarantined CLI without rejecting another CLI queued behind it', async () => {
  const f = fixture()
  const queued = f.runtime.submit('parent', f.project, 'Synthetic Grok', 'Synthetic no-model',
    { cli: 'grok', model: 'fixture', effort: 'low' }, 'accept-edits')
  const other = f.runtime.submit('parent', f.project, 'Synthetic Pi', 'Synthetic no-model',
    { cli: 'pi', model: 'fixture', effort: 'low' }, 'accept-edits')
  f.runtime.blockCatalogOnCleanup('grok', new ProcessCleanupUnconfirmedError())
  await f.runtime.stop('parent', other.worker.id)
  expect(await queued.done).toMatchObject({ status: 'failed', error: expect.stringContaining('此 CLI') })
  expect(await other.done).toMatchObject({ status: 'interrupted' })
  expect(f.storage.cleanupBlockState()).toBe('none')
  expect(f.backend.spawn).not.toHaveBeenCalled()
})
it('keeps a corrupt scoped marker confined to its CLI and rejects unrecognized storage scopes', async () => {
  const f = fixture()
  writeFileSync(join(f.storage.directory, 'cleanup-blocked-grok.json'), '{"policy":999}')
  await f.runtime.close()
  const storage = new WorkerStorage(f.storage.directory)
  const runtime = new WorkerRuntime(storage, f.backend, DEFAULT_CONFIG)
  cleanups.push(() => runtime.close())
  expect(() => runtime.assertCliEnabled('grok')).toThrow('无法核验')
  for (const cli of CLI_IDS.filter(cli => cli !== 'grok')) expect(() => runtime.assertCliEnabled(cli)).not.toThrow()
  expect(() => storage.blockCleanup('../outside' as any)).toThrow()
  expect(() => storage.cleanupBlockState('../outside' as any)).toThrow()
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => (resolve = yes))
  return { promise, resolve }
}
function fixture() {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-enabled-test-')))
  cleanups.push(() => rmSync(project, { recursive: true, force: true }))
  const storage = new WorkerStorage(join(project, 'state'))
  const backend: ProcessBackend = {
    resolveExecutable: vi.fn(async () => '/synthetic/agy'),
    spawn: vi.fn(() => {
      throw new Error('No CLI process should be started by this fixture')
    }),
  }
  const runtime = new WorkerRuntime(storage, backend, DEFAULT_CONFIG)
  cleanups.push(() => runtime.close())
  const accounts = { isBusy: vi.fn(() => false), start: vi.fn(), status: vi.fn() }
  const ask = vi.fn()
  const jobs = { start: vi.fn() }
  const agent = {
    id: 'parent',
    session: { header: { cwd: project, origin: 'user' } },
    ctx: {
      get: (name: string) =>
        ({
          userQuestions: { ask },
          jobs,
          sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) },
        })[name],
    },
  }
  const tools = new Map<string, any>()
  const service = hostServiceFixture() as CliWorkerService
  Object.defineProperties(service['host'], {
    ctx: {
      value: {
        subprocess: backend,
        tools: { register: (tool: any) => tools.set(tool.name, tool) },
        effect: (setup: () => unknown) => setup(),
      },
    },
    parent: { value: vi.fn(async () => agent) },
    runtime: { value: runtime },
    accounts: { value: accounts },
    options: { value: { ...DEFAULT_CONFIG, stateDirectory: join(project, 'state') } },
    disposed: { value: new AbortController() },
    pending: { value: new Map() },
    dispatchWaits: { value: new Map() },
    accountParents: { value: new Map() },
  })
  ;(service as any)['host'].registerTools()
  vi.mocked(catalogFor).mockResolvedValue(catalog)
  const worker: Worker = {
    id: randomUUID(),
    runId: randomUUID(),
    parentSessionId: agent.id,
    project,
    title: 'Synthetic worker',
    preference,
    mode: 'accept-edits',
    status: 'completed',
    conversationId: 'synthetic-conversation',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  storage.save(worker)
  storage.bindAccount(worker.id, 'synthetic-settings-account')
  storage.append(worker, { kind: 'user', text: 'Synthetic question' })
  storage.append(worker, { kind: 'assistant', text: 'Synthetic answer' })
  const signal = new AbortController().signal
  return {
    project,
    /** 模拟：设置页整机读取使用的插件自有目录（按需创建）。 */
    get machine() { return (service as any)['host'].machineDirectory() as string },
    storage,
    backend,
    runtime,
    service,
    worker,
    accounts,
    ask,
    jobs,
    signal,
    start: () =>
      tools
        .get('cliworker_start')
        .execute({ cli: 'antigravity', title: 'Synthetic', prompt: 'Synthetic task' }, { agent, signal }),
  }
}

describe('running message preference Gateway', () => {
  it('reads and saves project choices without querying accounts, models or spawning a task', async () => {
    const f = fixture()
    expect(JSON.parse(await f.service.runningMessageSettings('parent', 'pi', f.signal)))
      .toEqual({ cli: 'pi', mode: 'steer', canSteer: true })
    expect(JSON.parse(await f.service.saveRunningMessageMode('parent', 'pi', 'queue', f.signal)))
      .toEqual({ cli: 'pi', mode: 'queue', canSteer: true })
    expect(f.storage.runningMessageSettings(f.project, 'pi').mode).toBe('queue')
    expect(f.backend.spawn).not.toHaveBeenCalled()
    expect(f.accounts.status).not.toHaveBeenCalled()
    expect(catalogFor).not.toHaveBeenCalled()
    expect(f.jobs.start).not.toHaveBeenCalled()
  })
  it('rejects an aborted save and a CLI without native steering without replacing the prior mode', async () => {
    const f = fixture()
    await f.service.saveRunningMessageMode('parent', 'antigravity', 'interrupt', f.signal)
    await expect(f.service.saveRunningMessageMode('parent', 'antigravity', 'steer', f.signal)).rejects.toThrow('不支持引导')
    const controller = new AbortController()
    controller.abort()
    await expect(f.service.saveRunningMessageMode('parent', 'antigravity', 'queue', controller.signal)).rejects.toThrow()
    expect(f.storage.runningMessageSettings(f.project, 'antigravity').mode).toBe('interrupt')
  })
})

describe('profile-wide CLI enablement', () => {
  it.each(['bigmodel', 'zai'] as const)(
    'forwards the selected ZCode %s provider through the guarded account endpoint',
    async (provider) => {
      const f = fixture()
      ;(f.service as any)['host'].accountParents.set('parent', () => {})
      f.accounts.start.mockResolvedValue({ id: 'synthetic-account', instruction: 'Synthetic login' })
      const result = await f.service.accountStartForProvider('parent', 'zcode', 'login', provider, f.signal)
      expect(JSON.parse(result).id).toBe('synthetic-account')
      expect(f.accounts.start).toHaveBeenCalledExactlyOnceWith(
        'parent',
        'zcode',
        'login',
        f.machine,
        f.signal,
        undefined,
        provider,
        undefined,
        expect.any(Function),
      )
      f.storage.setCliEnabled('zcode', false)
      await expect(
        f.service.accountStartForProvider('parent', 'zcode', 'login', provider, f.signal),
      ).rejects.toThrow('已关闭')
      expect(f.accounts.start).toHaveBeenCalledOnce()
    },
  )
  it.each([
    ['opencode', 'login', { provider: 'deepseek' }, ['deepseek', undefined]],
    ['hermes', 'logout', { login: 'hermes:deepseek:a1b2c3' }, [undefined, 'hermes:deepseek:a1b2c3']],
  ] as const)('forwards a %s account-window %s target unchanged to the account manager', async (cli, action, options, target) => {
    const f = fixture()
    ;(f.service as any)['host'].accountParents.set('parent', () => {})
    f.accounts.start.mockResolvedValue({ id: 'synthetic-account', instruction: 'Synthetic' })
    await f.service.accountStartWith('parent', cli, action, JSON.stringify(options), f.signal)
    expect(f.accounts.start).toHaveBeenCalledExactlyOnceWith('parent', cli, action, f.machine, f.signal, undefined, ...target, expect.any(Function))
  })
  it.each(['null', '[]', '{"provider":1}', '{"provider":""}', '{"source":"native"}', '{"login":"x","extra":"y"}', 'not json'])(
    'rejects malformed account-window options %s before reading the parent',
    async (options) => {
      const f = fixture()
      await expect(f.service.accountStartWith('parent', 'opencode', 'login', options, f.signal)).rejects.toThrow()
      expect((f.service as any)['host'].parent).not.toHaveBeenCalled()
      expect(f.accounts.start).not.toHaveBeenCalled()
    },
  )
  it.each([
    ['codex', 'login', 'bigmodel'],
    ['zcode', 'logout', 'bigmodel'],
    ['zcode', 'manage', 'zai'],
    ['zcode', 'login', 'native'],
    ['zcode', 'login', 'https://foreign.invalid'],
    ['zcode', 'login', ''],
  ])(
    'rejects unsupported provider endpoint arguments %s/%s/%s before reading the parent or launching',
    async (cli, action, provider) => {
      const f = fixture()
      await expect(
        f.service.accountStartForProvider('parent', cli, action, provider, f.signal),
      ).rejects.toThrow()
      expect((f.service as any)['host'].parent).not.toHaveBeenCalled()
      expect(f.accounts.start).not.toHaveBeenCalled()
      expect(f.backend.spawn).not.toHaveBeenCalled()
    },
  )
  it('defaults all CLIs on, persists independently, and stores only private validated booleans', () => {
    const { storage } = fixture()
    expect(storage.cliSettings().enabled).toEqual(Object.fromEntries(CLI_IDS.map((id) => [id, true])))
    storage.setCliEnabled('codex', false)
    const returned = storage.cliSettings()
    returned.enabled.antigravity = false
    expect(storage.cliSettings().enabled.antigravity).toBe(true)
    if (process.platform !== 'win32')
      expect(statSync(join(storage.directory, 'cli-settings.json')).mode & 0o777).toBe(0o600)
    storage.close()
    const restored = new WorkerStorage(storage.directory)
    cleanups.push(() => restored.close())
    expect(restored.cliSettings().enabled.codex).toBe(false)
    expect(restored.cliSettings().enabled.antigravity).toBe(true)
    expect(() => restored.setCliEnabled('codex', 'false' as any)).toThrow()
    expect(() => restored.setCliEnabled('unknown' as any, true)).toThrow()
  })

  it('rejects corrupt settings without silently re-enabling a disabled CLI', () => {
    const { storage } = fixture()
    storage.close()
    writeFileSync(join(storage.directory, 'cli-settings.json'), '{"enabled":{"codex":"false"}}')
    expect(() => new WorkerStorage(storage.directory)).toThrow()
  })

  it('does not read or mutate CLI settings when the caller cancels during parent resolution', async () => {
    const { service, storage } = fixture()
    const parent = deferred<unknown>()
    ;(service as any)['host'].parent.mockReturnValue(parent.promise)
    const controller = new AbortController()
    const read = expect(service.cliSettings('parent', controller.signal)).rejects.toThrow('Caller closed')
    const write = expect(
      service.setCliEnabled('parent', 'antigravity', false, controller.signal),
    ).rejects.toThrow('Caller closed')
    controller.abort(new Error('Caller closed'))
    parent.resolve({ id: 'parent' })
    await Promise.all([read, write])
    expect(storage.cliSettings().enabled.antigravity).toBe(true)
  })

  it('disables dispatch and followup while retaining history, status, stop, and other CLIs', async () => {
    const { service, runtime, storage, project, worker, signal, start, backend, accounts } = fixture()
    const settings = JSON.parse(await service.setCliEnabled('parent', 'antigravity', false, signal))
    expect(settings.enabled.antigravity).toBe(false)
    expect(JSON.parse(await service.cliSettings('parent', signal))).toMatchObject(settings)
    await expect(start()).rejects.toThrow('已关闭')
    await expect(service.followup('parent', worker.id, 'Next', signal)).rejects.toThrow('已关闭')
    await expect(service.catalogForCli('parent', 'antigravity', signal)).rejects.toThrow('已关闭')
    await expect(service.catalogForWorker('parent', worker.id, signal)).rejects.toThrow('已关闭')
    await expect(service.catalog('parent', signal)).rejects.toThrow('已关闭')
    await expect(service.configure('parent', JSON.stringify(preference), signal)).rejects.toThrow('已关闭')
    await expect(
      service.configureWorker('parent', worker.id, JSON.stringify(preference), signal),
    ).rejects.toThrow('已关闭')
    await expect(service.accountStart('parent', 'antigravity', 'login', signal)).rejects.toThrow('已关闭')
    expect(() => runtime.submit('parent', project, 'New', 'Task', preference, 'accept-edits')).toThrow(
      '已关闭',
    )
    expect(catalogFor).not.toHaveBeenCalled()
    expect(backend.spawn).not.toHaveBeenCalled()
    expect(accounts.start).not.toHaveBeenCalled()
    const snapshot = runtime.snapshot('parent', worker.id)
    expect(snapshot.timeline.some((item) => item.text === 'Synthetic answer')).toBe(true)
    const anchor = snapshot.timeline.at(-1)!.id
    const history = JSON.parse(await service.history('parent', worker.id, anchor, 'before'))
    expect(history.items[0].text).toBe('Synthetic question')
    expect(JSON.parse(await service.stop('parent', worker.id)).status).toBe('completed')
    await expect(service.accountStatus('parent', 'antigravity', signal)).rejects.toThrow('已关闭')
    expect(accounts.status).not.toHaveBeenCalled()
    expect(storage.cliSettings().enabled.codex).toBe(true)
  })

  it('refuses disabling active tasks and pending account terminals without interrupting them', async () => {
    const { service, runtime, project, storage, accounts, signal } = fixture()
    const task = runtime.submit('parent', project, 'Queued', 'Task', preference, 'accept-edits')
    expect(() => runtime.setCliEnabled('antigravity', false)).toThrow('还有运行或排队')
    expect(task.worker.status).toBe('queued')
    await runtime.stop('parent', task.worker.id)
    accounts.isBusy.mockReturnValue(true)
    await expect(service.setCliEnabled('parent', 'antigravity', false, signal)).rejects.toThrow('账号终端')
    expect(storage.cliSettings().enabled.antigravity).toBe(true)
    accounts.isBusy.mockReturnValue(false)
    await service.setCliEnabled('parent', 'antigravity', false, signal)
    expect(storage.cliSettings().enabled.antigravity).toBe(false)
    expect(task.worker.status).toBe('interrupted')
  })

  it('does not publish a connected account status after the CLI is disabled during probing', async () => {
    const { service, signal, accounts } = fixture()
    const status = deferred<unknown>()
    accounts.status.mockReturnValueOnce(status.promise)
    const pending = service.accountStatus('parent', 'antigravity', signal)
    const rejected = expect(pending).rejects.toThrow('已关闭')
    await vi.waitFor(() => expect(accounts.status).toHaveBeenCalledTimes(1))
    await service.setCliEnabled('parent', 'antigravity', false, signal)
    status.resolve({ cli: 'antigravity', state: 'authenticated' })
    await rejected
  })

  it('checks disabled state after in-flight model discovery before asking for a model', async () => {
    const { service, start, ask, jobs, signal } = fixture()
    const loading = deferred<Catalog>()
    vi.mocked(catalogFor).mockReturnValueOnce(loading.promise)
    const pending = start()
    const rejected = expect(pending).rejects.toThrow('已关闭')
    await service.setCliEnabled('parent', 'antigravity', false, signal)
    loading.resolve(catalog)
    await rejected
    expect(ask).not.toHaveBeenCalled()
    expect(jobs.start).not.toHaveBeenCalled()
  })

  it('checks disabled state after model selection before persisting or publishing a task', async () => {
    const { service, start, ask, jobs, storage, project, signal } = fixture()
    const answer = deferred<unknown>()
    ask.mockReturnValueOnce(answer.promise)
    const pending = start()
    const rejected = expect(pending).rejects.toThrow('已关闭')
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1))
    await service.setCliEnabled('parent', 'antigravity', false, signal)
    answer.resolve({ answers: [{ id: 'cliworker_model', selected: ['fixture'] }] })
    await rejected
    expect(storage.preference(project, 'antigravity')).toBeUndefined()
    expect(jobs.start).not.toHaveBeenCalled()
  })

  it('refuses a configuration change completed after the CLI was disabled', async () => {
    const { service, signal, storage, project } = fixture()
    const loading = deferred<Catalog>()
    vi.mocked(catalogFor).mockReturnValueOnce(loading.promise)
    const pending = service.configure('parent', JSON.stringify(preference), signal)
    const rejected = expect(pending).rejects.toThrow('已关闭')
    await vi.waitFor(() => expect(catalogFor).toHaveBeenCalledTimes(1))
    await service.setCliEnabled('parent', 'antigravity', false, signal)
    loading.resolve(catalog)
    await rejected
    expect(storage.preference(project, 'antigravity')).toBeUndefined()
  })

  it('refuses disabling during followup preparation until an explicit stop settles', async () => {
    const { service, signal, worker, jobs, runtime } = fixture()
    const loading = deferred<Catalog>()
    vi.mocked(catalogFor).mockReturnValueOnce(loading.promise)
    const pending = service.followup('parent', worker.id, 'Next task', signal)
    const rejected = expect(pending).rejects.toThrow('用户已停止')
    try {
      await vi.waitFor(() => expect(catalogFor).toHaveBeenCalledTimes(1))
      await expect(service.setCliEnabled('parent', 'antigravity', false, signal))
        .rejects.toThrow('运行或排队')
      const stopping = runtime.stop('parent', worker.id)
      loading.resolve(catalog)
      await rejected
      await stopping
    } finally {
      loading.resolve(catalog)
      await pending.catch(() => undefined)
    }
    expect(jobs.start).not.toHaveBeenCalled()
    await service.setCliEnabled('parent', 'antigravity', false, signal)
    await service.setCliEnabled('parent', 'antigravity', true, signal)
    expect(() => runtime.assertCliEnabled('antigravity')).not.toThrow()
    await expect(service.catalogForCli('parent', 'antigravity', signal)).resolves.toContain('fixture')
  })

  it('refuses a followup if enablement changes externally during its in-flight lookup', async () => {
    const { service, signal, worker, jobs, storage } = fixture()
    const loading = deferred<Catalog>()
    vi.mocked(catalogFor).mockReturnValueOnce(loading.promise)
    const pending = service.followup('parent', worker.id, 'Next task', signal)
    const rejected = expect(pending).rejects.toThrow('已关闭')
    try {
      await vi.waitFor(() => expect(catalogFor).toHaveBeenCalledTimes(1))
      // Simulate a separate configuration writer; the public Gateway rejects
      // this change while preparation is active, as covered immediately above.
      storage.setCliEnabled('antigravity', false)
      loading.resolve(catalog)
      await rejected
    } finally {
      loading.resolve(catalog)
      await pending.catch(() => undefined)
    }
    expect(jobs.start).not.toHaveBeenCalled()
  })
})

// Explicit synthetic account-supported catalog. No credential or model request.
describe('account-supported model selection', () => {
  it('authorizes an unbound legacy followup under the current account instead of refusing it', async () => {
    const { service, storage, worker, signal, jobs } = fixture()
    rmSync(join(storage.directory, `${worker.id}.account-binding.json`))
    await service.followup('parent', worker.id, 'Synthetic legacy continuation', signal).catch(() => undefined)
    // The current own account is read and its directory authorizes the saved model.
    expect(readCliAccountBinding).toHaveBeenCalled()
    expect(catalogFor).toHaveBeenCalled()
    expect(jobs.start).toHaveBeenCalledOnce()
  })

  const supported: Catalog = {
    cli: 'antigravity',
    models: [
      { id: 'paid/GLM-5.3-Flash', label: 'GLM-5.3-Flash（付费来源）', efforts: ['default'], cost: 'paid' },
      {
        id: 'native-free/glm-5.3-flash',
        label: 'GLM-5.3-Flash（免费来源）',
        efforts: ['default'],
        cost: 'free',
      },
      { id: 'paid/GLM-5.3', label: 'GLM-5.3 (provider)', efforts: ['default'], cost: 'unknown' },
    ],
    notice: '【模拟】仅已确认账号支持的模型',
  }

  it('asks complete setup using deduplicated names and saves the exact free route only after selection', async () => {
    const { service, ask, storage, project, signal, backend } = fixture()
    vi.mocked(catalogFor).mockResolvedValue(supported)
    ask
      .mockResolvedValueOnce({ answers: [{ id: 'cliworker_model', selected: ['GLM-5.3-Flash'] }] })
      .mockResolvedValueOnce({ answers: [{ id: 'cliworker_role', selected: ['不使用角色预设'] }] })
    const agent = await (service as any)['host'].parent('parent')
    const setup = await (service as any)['host'].chooseDispatch(agent, signal, 'antigravity')
    const chosen = setup.preference
    const options = ask.mock.calls[0]![0].questions[0].options
    expect(options).toEqual([{ label: 'GLM-5.3-Flash' }, { label: 'GLM-5.3' }])
    expect(chosen).toEqual({ cli: 'antigravity', model: 'native-free/glm-5.3-flash', effort: 'default' })
    expect(storage.preference(project, 'antigravity')).toEqual(chosen)
    expect(backend.spawn).not.toHaveBeenCalled()
  })

  it('keeps an explicitly saved valid paid route despite an equivalent free choice', async () => {
    const { service, ask, storage, project, signal, backend } = fixture()
    vi.mocked(catalogFor).mockResolvedValue(supported)
    const saved = { cli: 'antigravity' as const, model: 'paid/GLM-5.3-Flash', effort: 'default' as const }
    storage.setDispatchSetup(project, {
      preference: saved,
      role: null,
      binding: 'synthetic-settings-account',
    })
    ask.mockResolvedValue({ answers: [{ id: 'cliworker_reuse', selected: ['沿用'] }] })
    const agent = await (service as any)['host'].parent('parent')
    expect((await (service as any)['host'].chooseDispatch(agent, signal, 'antigravity')).preference).toEqual(saved)
    expect(storage.preference(project, 'antigravity')).toEqual(saved)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask.mock.calls[0]![0].questions[0].id).toBe('cliworker_reuse')
    expect(backend.spawn).not.toHaveBeenCalled()
  })

  it('refuses obsolete unsupported configure and followup without changing selection or starting a process', async () => {
    const { service, storage, project, worker, signal, backend } = fixture()
    vi.mocked(catalogFor).mockResolvedValue(supported)
    storage.setPreference(project, worker.preference)
    await expect(service.configure('parent', JSON.stringify(worker.preference), signal)).rejects.toThrow(
      '不可用',
    )
    await expect(service.followup('parent', worker.id, '【模拟】继续', signal)).rejects.toThrow('不可用')
    expect(storage.preference(project, 'antigravity')).toEqual(worker.preference)
    expect(backend.spawn).not.toHaveBeenCalled()
  })
})

describe('saved Worker model directory', () => {
  it('reuses a matching persisted directory across Host cache restart without native lookups', async () => {
    const f = fixture()
    const first = JSON.parse(await f.service.catalogForWorker('parent', f.worker.id, f.signal))
    expect(first).toEqual(catalog)
    expect(catalogFor).toHaveBeenCalledOnce()
    ;(f.service as any)['host'].settingsCatalogs = new SettingsCatalogCache(f.storage.directory)
    vi.mocked(catalogFor).mockClear()
    vi.mocked(readCliAccountBinding).mockClear()
    const cached = await f.service.catalogForWorker('parent', f.worker.id, f.signal)
    expect(JSON.parse(cached)).toEqual(catalog)
    expect(cached).not.toContain('synthetic-settings-account')
    expect(catalogFor).not.toHaveBeenCalled()
    expect(readCliAccountBinding).not.toHaveBeenCalled()
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })

  it('reads the choices of the account signed in now when it changes while they load, without an error', async () => {
    const f = fixture()
    let reads = 0
    vi.mocked(readCliAccountBinding).mockImplementation(async () =>
      ++reads === 1 ? 'synthetic-settings-account' : 'synthetic-other-account',
    )
    try {
      expect(JSON.parse(await f.service.catalogForWorker('parent', f.worker.id, f.signal))).toEqual(catalog)
    } finally {
      vi.mocked(readCliAccountBinding).mockImplementation(async () => 'synthetic-settings-account')
    }
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })

  it('saves cached model and effort locally, preserves history, and rejects unavailable choices at send time', async () => {
    const f = fixture()
    const selectable: Catalog = {
      ...catalog,
      models: [
        ...catalog.models,
        {
          id: 'synthetic-next',
          label: 'Synthetic next',
          efforts: ['low', 'high'],
          variants: { high: 'synthetic-next-high' },
        },
      ],
    }
    vi.mocked(catalogFor).mockResolvedValueOnce(selectable)
    await f.service.catalogForWorker('parent', f.worker.id, f.signal)
    vi.mocked(catalogFor).mockClear()
    vi.mocked(readCliAccountBinding).mockClear()
    const originalHistory = f.storage.history(f.worker.id)
    const selected = { cli: 'antigravity', model: 'synthetic-next', effort: 'high' }
    const updated = JSON.parse(
      await f.service.configureWorker('parent', f.worker.id, JSON.stringify(selected), f.signal),
    )
    expect(updated.preference.model).toBe('synthetic-next-high')
    expect(updated.conversationId).toBe(f.worker.conversationId)
    expect(f.storage.history(f.worker.id)).toEqual(originalHistory)
    expect(f.storage.preference(f.project, 'antigravity')).toBeUndefined()
    expect(catalogFor).not.toHaveBeenCalled()
    expect(readCliAccountBinding).not.toHaveBeenCalled()
    expect(f.backend.spawn).not.toHaveBeenCalled()
    await expect(
      f.service.followup('parent', f.worker.id, 'Synthetic unsent question', f.signal),
    ).rejects.toThrow('不可用')
    expect(catalogFor).toHaveBeenCalledOnce()
    expect(readCliAccountBinding).toHaveBeenCalled()
    expect(f.jobs.start).not.toHaveBeenCalled()
    expect(f.storage.history(f.worker.id)).toEqual(originalHistory)
  })

  it('refuses missing directories, invalid combinations, changed account and foreign Worker ownership', async () => {
    const f = fixture()
    await expect(
      f.service.configureWorker('parent', f.worker.id, JSON.stringify(preference), f.signal),
    ).rejects.toThrow('模型目录已失效')
    expect(catalogFor).not.toHaveBeenCalled()
    // A missing saved directory is looked up under the current account only.
    expect(readCliAccountBinding).toHaveBeenCalledOnce()
    await f.service.catalogForWorker('parent', f.worker.id, f.signal)
    await expect(
      f.service.configureWorker(
        'parent',
        f.worker.id,
        JSON.stringify({ ...preference, effort: 'high' }),
        f.signal,
      ),
    ).rejects.toThrow('不可用')
    ;(f.service as any)['host'].settingsCatalogs.invalidate('antigravity')
    vi.mocked(catalogFor).mockClear()
    // After an account change the Worker's choices come from the current account,
    // and viewing them does not rebind the Worker.
    vi.mocked(readCliAccountBinding).mockResolvedValue('synthetic-other-account')
    expect(JSON.parse(await f.service.catalogForWorker('parent', f.worker.id, f.signal))).toEqual(catalog)
    expect(catalogFor).toHaveBeenCalledOnce()
    expect(f.storage.accountBinding(f.worker.id)).toBe('synthetic-settings-account')
    vi.mocked(readCliAccountBinding).mockResolvedValue('synthetic-settings-account')
    ;(f.service as any)['host'].parent.mockResolvedValueOnce({ id: 'other-parent' })
    vi.mocked(readCliAccountBinding).mockClear()
    await expect(f.service.catalogForWorker('parent', f.worker.id, f.signal)).rejects.toThrow()
    expect(readCliAccountBinding).not.toHaveBeenCalled()
    expect(f.runtime.get('parent', f.worker.id).preference).toEqual(preference)
  })

  it('saves the first dispatch directory before its Worker opens the menu', async () => {
    const f = fixture()
    f.ask
      .mockResolvedValueOnce({ answers: [{ id: 'cliworker_model', selected: ['Synthetic fixture'] }] })
      .mockResolvedValueOnce({ answers: [{ id: 'cliworker_role', selected: ['不使用角色预设'] }] })
    const agent = await (f.service as any)['host'].parent('parent')
    await (f.service as any)['host'].chooseDispatch(agent, f.signal, 'antigravity')
    vi.mocked(catalogFor).mockClear()
    vi.mocked(readCliAccountBinding).mockClear()
    expect(JSON.parse(await f.service.catalogForWorker('parent', f.worker.id, f.signal))).toEqual(catalog)
    expect(catalogFor).not.toHaveBeenCalled()
    expect(readCliAccountBinding).not.toHaveBeenCalled()
  })
})

// Account identity is synthetic; these tests exercise actual directory and setting gates.
vi.mock('../src/host/cli-account-binding.ts', () => ({
  readCliAccountBinding: vi.fn(async () => 'synthetic-settings-account'),
}))

it('模拟：后台目录供设置页直接使用，保留模型强度及账号绑定，启用状态改变作废', async () => {
  const f = fixture(), cache = (f.service as any)['host'].connectionCache()
  await cache.read('antigravity', 'catalog', f.signal, async () => ({ catalog, binding: 'SIMULATED-original-account' }))
  const first = JSON.parse(await f.service.catalogForCli('parent', 'antigravity', f.signal))
  expect(first.models).toEqual(catalog.models); expect(first.cache.stale).toBe(false)
  expect(catalogFor).not.toHaveBeenCalled(); expect(readCliAccountBinding).not.toHaveBeenCalled()
  expect((f.service as any)['host'].displayedBindings.get(JSON.stringify(['parent', 'antigravity']))).toBe('SIMULATED-original-account')
  await f.service.setCliEnabled('parent', 'antigravity', false, f.signal)
  expect(cache.status('antigravity').catalog.value).toBeUndefined()
})

it.each(['login', 'logout'] as const)('模拟：账号 %s 入口作废该 CLI 的账号与目录，不影响其他 CLI', async action => {
  const f = fixture(), cache = (f.service as any)['host'].connectionCache()
  ;(f.service as any)['host'].accountParents.set('parent', () => {})
  f.accounts.start.mockResolvedValue({ id: 'simulated-account', instruction: '模拟' })
  await cache.read('zcode', 'account', f.signal, async () => ({ cli: 'zcode', installed: true,
    state: 'authenticated', verification: 'local', summary: '模拟', actions: [] }))
  await cache.read('zcode', 'catalog', f.signal, async () => ({ catalog: { ...catalog, cli: 'zcode' }, binding: 'simulated-binding' }))
  await cache.read('codex', 'account', f.signal, async () => ({ cli: 'codex', installed: true,
    state: 'authenticated', verification: 'local', summary: '模拟其他 CLI', actions: [] }))
  await f.service.accountStart('parent', 'zcode', action, f.signal)
  expect(cache.status('zcode').account.value).toBeUndefined()
  expect(cache.status('zcode').catalog.value).toBeUndefined()
  expect(cache.status('codex').account.value?.state).toBe('authenticated')
})
