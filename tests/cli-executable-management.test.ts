import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { resolveCliExecutable } from '../src/host/adapters.ts'
import { CliExecutablePathStore } from '../src/host/cli-executable-paths.ts'
import { CliWorkerService } from '../src/host/index.ts'
import {
  DEFAULT_CONFIG,
  ProcessCleanupUnconfirmedError,
  type ProcessBackend,
  type RuntimeConfig,
} from '../src/host/process.ts'
import { WorkerRuntime } from './fixtures/legacy-runtime.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import type { Worker } from '../src/shared/types.ts'

const environment = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  homedir: () => environment.home,
}))

// All installation files, parent sessions and subprocess lookups are synthetic.
// No native CLI, model, account, or user's home/configuration is read or executed.
const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => (resolve = yes))
  return { promise, resolve }
}
function fixture() {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'synthetic-cli-management-')))
  environment.home = project
  vi.stubEnv('APPDATA', join(project, 'AppData', 'Roaming'))
  vi.stubEnv('LOCALAPPDATA', join(project, 'AppData', 'Local'))
  vi.stubEnv('PNPM_HOME', join(project, 'pnpm'))
  cleanups.push(() => rmSync(project, { recursive: true, force: true }))
  const storage = new WorkerStorage(join(project, 'state'))
  const store = new CliExecutablePathStore(storage.directory)
  const file = (relative: string) => {
    const path = join(project, relative)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '// Synthetic installation fixture; never execute.\n')
    return path
  }
  let discovered = file('automatic/opencode')
  const resolve = vi.fn(async (entry: string) => {
    const path = isAbsolute(entry) ? entry : discovered
    if (!statSync(path).isFile()) throw new Error('Synthetic entry is not a file')
    return path
  })
  const spawn = vi.fn(() => {
    throw new Error('No CLI process may be started by this fixture')
  })
  const backend: ProcessBackend = { resolveExecutable: resolve, spawn }
  const options: RuntimeConfig = { ...DEFAULT_CONFIG, cliExecutablePaths: store }
  const runtime = new WorkerRuntime(storage, backend, options)
  cleanups.push(() => runtime.close())
  const accounts = { isBusy: vi.fn(() => false) }
  const disposed = new AbortController()
  const lookup = vi.fn(async (id: string) => {
    if (id !== 'parent') throw new Error('Synthetic parent access denied')
  })
  const agent = { id: 'parent', session: { header: { cwd: project, origin: 'user' } } }
  const service = Object.create(CliWorkerService.prototype) as CliWorkerService
  Object.defineProperties(service['host'], {
    ctx: {
      value: {
        typert: { lookups: new Map([['agent', { resolve: lookup }]]) },
        agents: { get: (id: string) => (id === 'parent' ? agent : undefined) },
        subprocess: backend,
      },
    },
    backend: { value: backend },
    runtime: { value: runtime },
    accounts: { value: accounts },
    options: { value: options },
    disposed: { value: disposed },
    displayedBindings: { value: new Map() },
  })
  const signal = new AbortController().signal
  return {
    project,
    storage,
    store,
    file,
    backend,
    resolve,
    spawn,
    options,
    runtime,
    accounts,
    service,
    signal,
    disposed,
    lookup,
    agent,
    initialPath: discovered,
    changeDiscovery: (path: string) => {
      discovered = path
    },
    read: () => service.cliExecutablePath('parent', 'opencode', signal).then(JSON.parse),
    update: (path: string, action: string) =>
      service.refreshCliExecutablePath('parent', 'opencode', path, action, signal).then(JSON.parse),
    resolvePath: () => resolveCliExecutable('opencode', backend, options, signal),
  }
}

describe('CLI executable resolver persistence and concurrent choice changes', () => {
  it('remembers discovery across Host store reloads and reuses it after PATH changes', async () => {
    const f = fixture()
    await expect(f.resolvePath()).resolves.toBe(f.initialPath)
    expect(f.store.read('opencode')).toEqual({ mode: 'auto', path: f.initialPath })
    f.changeDiscovery(f.file('new-PATH/opencode'))
    f.options.cliExecutablePaths = new CliExecutablePathStore(f.storage.directory)
    await expect(f.resolvePath()).resolves.toBe(f.initialPath)
    expect(f.resolve).toHaveBeenLastCalledWith(f.initialPath)
    expect(f.spawn).not.toHaveBeenCalled()
  })

  it('rediscovers an automatic entry removed by an application update', async () => {
    const f = fixture()
    await f.resolvePath()
    rmSync(f.initialPath)
    const replacement = f.file('updated application/opencode')
    f.changeDiscovery(replacement)
    await expect(f.resolvePath()).resolves.toBe(replacement)
    expect(f.store.read('opencode')).toEqual({ mode: 'auto', path: replacement })
  })

  it('uses deployment configuration ahead of a remembered automatic entry', async () => {
    const f = fixture()
    await f.resolvePath()
    f.options.opencodeExecutable = f.file('deployment/opencode')
    await expect(f.resolvePath()).resolves.toBe(f.options.opencodeExecutable)
    expect(f.store.read('opencode')).toEqual({ mode: 'auto', path: f.initialPath })
  })

  it('uses a manual file ahead of deployment and automatic choices without changing another CLI', async () => {
    const f = fixture()
    await f.resolvePath()
    f.options.opencodeExecutable = f.file('deployment/opencode')
    const manual = f.file('手动 安装/opencode')
    const other = f.file('other CLI/claude')
    f.store.setManual('claude', other)
    f.store.setManual('opencode', manual)
    await expect(f.resolvePath()).resolves.toBe(manual)
    expect(f.store.read('claude')).toEqual({ mode: 'manual', path: other })
  })

  it('keeps a missing manual choice and does not fall back to deployment or PATH', async () => {
    const f = fixture()
    f.options.opencodeExecutable = f.file('deployment/opencode')
    const missing = join(f.project, 'missing manual', 'opencode')
    f.store.setManual('opencode', missing)
    await expect(f.resolvePath()).rejects.toThrow()
    expect(f.resolve).toHaveBeenCalledExactlyOnceWith(missing)
    expect(f.store.read('opencode')).toEqual({ mode: 'manual', path: missing })
    expect(f.spawn).not.toHaveBeenCalled()
  })

  it('preserves spaces and shell metacharacters as a literal readable script path', async () => {
    const f = fixture()
    const path = f.file('中文 &(literal)/zcode.cjs')
    f.store.setManual('zcode', path)
    await expect(resolveCliExecutable('zcode', f.backend, f.options, f.signal)).resolves.toBe(path)
    expect(f.resolve).not.toHaveBeenCalled()
    expect(f.spawn).not.toHaveBeenCalled()
  })

  it('rejects late discovery after a manual choice replaces its revision', async () => {
    const f = fixture(),
      pending = deferred<string>()
    f.resolve.mockReturnValueOnce(pending.promise)
    const result = f.resolvePath()
    const manual = f.file('chosen after lookup/opencode')
    f.store.setManual('opencode', manual)
    pending.resolve(f.initialPath)
    await expect(result).rejects.toThrow('路径已更新')
    expect(f.store.read('opencode')).toEqual({ mode: 'manual', path: manual })
  })

  it('does not restore an automatic choice from a lookup started before reset', async () => {
    const f = fixture(),
      pending = deferred<string>()
    f.resolve.mockReturnValueOnce(pending.promise)
    const result = f.resolvePath()
    f.store.reset('opencode')
    pending.resolve(f.initialPath)
    await expect(result).rejects.toThrow('路径已更新')
    expect(f.store.read('opencode')).toBeUndefined()
  })

  it('allows concurrent initial discovery only when both lookups find the same file', async () => {
    const f = fixture(),
      pending = deferred<string>()
    f.resolve.mockReturnValue(pending.promise)
    const left = f.resolvePath(),
      right = f.resolvePath()
    pending.resolve(f.initialPath)
    await expect(Promise.all([left, right])).resolves.toEqual([f.initialPath, f.initialPath])
    expect(f.store.read('opencode')).toEqual({ mode: 'auto', path: f.initialPath })
  })

  it('does not save an abandoned lookup when cancellation precedes its result', async () => {
    const f = fixture(),
      pending = deferred<string>(),
      controller = new AbortController()
    f.resolve.mockReturnValueOnce(pending.promise)
    const result = resolveCliExecutable('opencode', f.backend, f.options, controller.signal)
    controller.abort(new Error('Synthetic caller cancelled'))
    await expect(result).rejects.toThrow('caller cancelled')
    pending.resolve(f.initialPath)
    await Promise.resolve()
    expect(f.store.read('opencode')).toBeUndefined()
    expect(f.spawn).not.toHaveBeenCalled()
  })
})

describe('guarded Host CLI executable path endpoints', () => {
  it('returns the discovered current path and automatic source without starting a CLI', async () => {
    const f = fixture()
    expect(await f.read()).toMatchObject({
      cli: 'opencode',
      path: f.initialPath,
      source: 'auto',
      available: true,
    })
    expect(f.lookup).toHaveBeenCalledWith('parent')
    expect(f.spawn).not.toHaveBeenCalled()
  })

  it('reports a deployment source and restores it when a manual override returns to automatic mode', async () => {
    const f = fixture()
    f.options.opencodeExecutable = f.file('deployment/opencode')
    expect(await f.read()).toMatchObject({
      path: f.options.opencodeExecutable,
      source: 'configured',
      available: true,
    })
    const manual = f.file('manual override/opencode')
    expect(await f.update(manual, 'manual')).toMatchObject({
      path: manual,
      source: 'manual',
      available: true,
    })
    expect(await f.update('', 'auto')).toMatchObject({
      path: f.options.opencodeExecutable,
      source: 'configured',
      available: true,
    })
    expect(f.store.read('opencode')).toBeUndefined()
  })

  it('saves a valid absolute manual path even when the file is unavailable and retains it on refresh', async () => {
    const f = fixture(),
      path = join(f.project, 'not yet installed', 'opencode')
    const result = await f.update(path, 'manual')
    expect(result).toMatchObject({ cli: 'opencode', path, source: 'manual', available: false })
    expect(result.error).toEqual(expect.any(String))
    expect(f.store.read('opencode')).toEqual({ mode: 'manual', path })
    expect(await f.update('', 'refresh')).toMatchObject({ path, source: 'manual', available: false })
    expect(f.resolve.mock.calls.every(([selected]) => selected === path)).toBe(true)
  })

  it('can refresh the same manual choice after its file becomes available', async () => {
    const f = fixture(),
      path = join(f.project, 'later installed', 'opencode')
    await f.update(path, 'manual')
    f.file('later installed/opencode')
    expect(await f.update('', 'refresh')).toMatchObject({ path, source: 'manual', available: true })
  })

  it('clears a broken manual selection and saves new automatic discovery', async () => {
    const f = fixture()
    await f.update(join(f.project, 'missing', 'opencode'), 'manual')
    expect(await f.update('', 'auto')).toMatchObject({ path: f.initialPath, source: 'auto', available: true })
    expect(f.store.read('opencode')).toEqual({ mode: 'auto', path: f.initialPath })
  })

  it('returns a safe unavailable state when discovery fails without exposing backend output', async () => {
    const f = fixture()
    f.resolve.mockRejectedValue(new Error('SYNTHETIC PRIVATE BACKEND DETAIL'))
    const result = await f.read()
    expect(result).toMatchObject({ cli: 'opencode', path: '', source: 'none', available: false })
    expect(result.error).toEqual(expect.any(String))
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC PRIVATE BACKEND DETAIL')
    expect(f.store.read('opencode')).toBeUndefined()
  })

  it.each(['relative/opencode', '"/quoted/path"', '/bad\npath', ''])(
    'rejects invalid manual input %j before changing the saved choice',
    async (path) => {
      const f = fixture()
      f.store.setManual('opencode', f.initialPath)
      const revision = f.store.revision('opencode')
      await expect(f.update(path, 'manual')).rejects.toThrow()
      expect(f.store.revision('opencode')).toBe(revision)
      expect(f.store.read('opencode')).toEqual({ mode: 'manual', path: f.initialPath })
      expect(f.resolve).not.toHaveBeenCalled()
    },
  )

  it.each(['manual', 'refresh', 'auto'])(
    'blocks %s while this CLI has an account terminal without modifying its path',
    async (action) => {
      const f = fixture()
      f.store.setManual('opencode', f.initialPath)
      const revision = f.store.revision('opencode')
      f.accounts.isBusy.mockReturnValue(true)
      await expect(f.update(f.file('replacement/opencode'), action)).rejects.toThrow('账号终端')
      expect(f.store.revision('opencode')).toBe(revision)
      expect(f.resolve).not.toHaveBeenCalled()
    },
  )

  it('returns the saved path without probing while an account terminal is active', async () => {
    const f = fixture()
    f.store.setManual('opencode', f.initialPath)
    f.accounts.isBusy.mockReturnValue(true)
    expect(await f.read()).toMatchObject({
      path: f.initialPath,
      source: 'manual',
      available: false,
      error: expect.stringContaining('账号终端'),
    })
    expect(f.resolve).not.toHaveBeenCalled()
  })

  it('blocks a path mutation while a worker for that CLI is queued and preserves other CLI access', async () => {
    const f = fixture()
    const worker: Worker = {
      id: randomUUID(),
      runId: randomUUID(),
      parentSessionId: 'parent',
      project: f.project,
      title: 'Synthetic queued worker',
      preference: { cli: 'opencode', model: 'synthetic', effort: 'default' },
      mode: 'accept-edits',
      status: 'queued',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    f.storage.save(worker)
    await expect(f.update(f.file('replacement/opencode'), 'manual')).rejects.toThrow('运行或排队')
    expect(f.store.read('opencode')).toBeUndefined()
    expect(f.resolve).not.toHaveBeenCalled()
    expect(() => f.runtime.assertAccountIdle('claude')).not.toThrow()
  })

  it('requires parent ownership before reading or changing path selections', async () => {
    const f = fixture(),
      read = vi.spyOn(f.store, 'read'),
      mutate = vi.spyOn(f.store, 'setManual')
    await expect(f.service.cliExecutablePath('foreign-parent', 'opencode', f.signal)).rejects.toThrow(
      'parent access denied',
    )
    await expect(
      f.service.refreshCliExecutablePath('foreign-parent', 'opencode', f.initialPath, 'manual', f.signal),
    ).rejects.toThrow('parent access denied')
    expect(read).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
    expect(f.resolve).not.toHaveBeenCalled()
  })

  it('does not read or mutate when cancelled during parent resolution', async () => {
    const f = fixture(),
      parent = deferred<void>(),
      controller = new AbortController()
    f.lookup.mockReturnValue(parent.promise)
    const read = expect(f.service.cliExecutablePath('parent', 'opencode', controller.signal)).rejects.toThrow(
      'Synthetic closed',
    )
    const write = expect(
      f.service.refreshCliExecutablePath('parent', 'opencode', f.initialPath, 'manual', controller.signal),
    ).rejects.toThrow('Synthetic closed')
    controller.abort(new Error('Synthetic closed'))
    parent.resolve()
    await Promise.all([read, write])
    expect(f.store.read('opencode')).toBeUndefined()
    expect(f.resolve).not.toHaveBeenCalled()
  })

  it('stops availability reporting on Host disposal and cannot save late discovery', async () => {
    const f = fixture(),
      pending = deferred<string>(),
      started = deferred<void>()
    f.resolve.mockImplementationOnce(() => {
      started.resolve()
      return pending.promise
    })
    const result = f.read()
    await started.promise
    f.disposed.abort(new Error('Synthetic Host closing'))
    await expect(result).rejects.toThrow('Host closing')
    pending.resolve(f.initialPath)
    await Promise.resolve()
    expect(f.store.read('opencode')).toBeUndefined()
  })

  it('blocks later mutations after an unconfirmed metadata process cleanup', async () => {
    const f = fixture(),
      block = vi.spyOn(f.runtime, 'blockCatalogOnCleanup')
    const error = new ProcessCleanupUnconfirmedError()
    f.resolve.mockRejectedValueOnce(error)
    await expect(f.read()).rejects.toThrow('cleanup')
    expect(block).toHaveBeenCalledExactlyOnceWith('opencode', error)
    await expect(f.update(f.initialPath, 'manual')).rejects.toThrow('清理')
    expect(f.store.read('opencode')).toBeUndefined()
    expect(f.resolve).toHaveBeenCalledOnce()
    expect(f.spawn).not.toHaveBeenCalled()
  })

  it('rejects unsupported CLI or mutation action without changing choices', async () => {
    const f = fixture()
    await expect(f.service.cliExecutablePath('parent', 'unknown', f.signal)).rejects.toThrow()
    await expect(f.update(f.initialPath, 'launch')).rejects.toThrow()
    expect(f.store.read('opencode')).toBeUndefined()
    expect(f.resolve).not.toHaveBeenCalled()
  })
})
