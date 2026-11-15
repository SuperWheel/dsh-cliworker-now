/** 模拟：temporary HOME only, no native CLI or real credential access. */
import { afterEach, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { dirname, join } from 'node:path'
import { AccountManager } from '../src/host/accounts.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
import { commitNativeFiles, readNativeFile } from '../src/host/custom-provider-files.ts'
import { deletePiOmpNativeConfigProvider } from '../src/host/custom-provider-native.ts'
vi.mock('node:fs', async load => ({ ...await load<typeof import('node:fs')>() }))
vi.mock('node:os', async load => ({ ...await load<typeof import('node:os')>() }))
const roots: string[] = []
const managers: AccountManager[] = []
const write = (path: string, text: string) => { fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, text, { mode: 0o600 }) }
const read = (path: string) => fs.readFileSync(path, 'utf8')
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
function fixture(cli: 'pi' | 'omp') {
  const home = fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), 'config-races-simulated-'))); roots.push(home)
  vi.spyOn(os, 'homedir').mockReturnValue(home)
  const stateDirectory = join(home, 'state'), name = cli === 'pi' ? 'models.json' : 'models.yml'
  const native = join(home, '.' + cli, 'agent', name), snapshot = join(stateDirectory, 'accounts', cli, 'agent', name)
  const original = JSON.stringify({ providers: { custom: { apiKey: 'simulated', models: [] }, keep: { apiKey: 'simulated-keep' } } })
  write(native, original); write(snapshot, original)
  const backend = { spawn: vi.fn(() => { throw new Error('No process permitted') }), resolveExecutable: vi.fn(),
    spawnTerminal: vi.fn(async () => { throw new Error('simulated terminal allocation failure') }) }
  const manager = new AccountManager(backend, { ...DEFAULT_CONFIG, stateDirectory }); managers.push(manager)
  return { home, stateDirectory, native, snapshot, original, backend, manager, login: cli + ':custom:native.config' }
}
afterEach(async () => { vi.restoreAllMocks(); for (const m of managers.splice(0)) await m.close(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
it.each(['pi', 'omp'] as const)('simulated %s: readback conflict preserves external provider in native OR snapshot and retains backup', cli => {
  for (const location of ['native', 'snapshot'] as const) {
    const f = fixture(cli), rename = fs.renameSync, target = f[location]
    const external = JSON.stringify({ providers: { keep: { apiKey: 'simulated-keep' }, external: { apiKey: 'simulated-external' } } })
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      rename(from, to)
      if (to === target && String(from).endsWith('.tmp')) write(target, external)
    })
    expect(() => deletePiOmpNativeConfigProvider(cli, f.stateDirectory, f.login, () => {}, f.home)).toThrow(/其他程序修改.*未回滚.*备份保留在/)
    expect(read(target)).toBe(external)
    expect(read(f[location === 'native' ? 'snapshot' : 'native'])).toBe(f.original)
    const backups = fs.readdirSync(dirname(target)).filter(name => name.endsWith('.bak'))
    expect(backups).toHaveLength(1)
    expect(read(join(dirname(target), backups[0]!))).toBe(f.original)
    if (process.platform !== 'win32') expect(fs.statSync(join(dirname(target), backups[0]!)).mode & 0o777).toBe(0o600)
    spy.mockRestore()
  }
})
it('simulated rollback still restores original when content is exactly our write', () => {
  const f = fixture('pi'), file = readNativeFile(f.native)
  expect(() => commitNativeFiles([{ file, text: '{}' }], () => {}, () => { throw new Error('simulated verification failure') })).toThrow('simulated verification failure')
  expect(read(f.native)).toBe(f.original)
})
it.each(['pi', 'omp'] as const)('simulated %s: direct deletion acknowledges readback without allocating a terminal, releases before acknowledgment', async cli => {
  const f = fixture(cli), barrier = deferred()
  const deleting = f.manager.deleteConfiguration('parent', cli, f.login, new AbortController().signal, () => barrier.promise)
  expect(f.manager.isBusy(cli)).toBe(true)
  expect(read(f.native)).toBe(f.original)
  expect(() => f.manager.reserveCustomProvider(cli)).toThrow()
  barrier.resolve()
  expect(await deleting).toEqual({ ok: true })
  expect(f.manager.isBusy(cli)).toBe(false)
  expect(JSON.parse(read(f.native)).providers.custom).toBeUndefined()
  expect(f.backend.spawnTerminal).not.toHaveBeenCalled(); expect(f.backend.spawn).not.toHaveBeenCalled()
})
it.each(['request', 'parent', 'host'] as const)('simulated cancellation by %s before commit preserves configuration while retaining lease until cleanup', async cancel => {
  const f = fixture('pi'), barrier = deferred(), control = new AbortController()
  const deleting = f.manager.deleteConfiguration('parent', 'pi', f.login, control.signal, () => barrier.promise)
  const failed = expect(deleting).rejects.toThrow()
  let closing: Promise<unknown> | undefined
  if (cancel === 'request') control.abort()
  else closing = cancel === 'parent' ? f.manager.closeParent('parent') : f.manager.close()
  expect(f.manager.isBusy('pi')).toBe(true)
  barrier.resolve(); await failed; await closing
  expect(read(f.native)).toBe(f.original); expect(read(f.snapshot)).toBe(f.original)
  expect(f.manager.isBusy('pi')).toBe(false); expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
})
it('simulated: terminal preparation refuses configuration IDs without mutation', async () => {
  const f = fixture('pi'), { preparePiOmpLogout } = await import('../src/host/pi-omp-logout.ts')
  const project = join(f.home, 'project'); fs.mkdirSync(project)
  await expect(preparePiOmpLogout({ cli: 'pi', project, executable: '/simulated', stateDirectory: f.stateDirectory,
    nativeHome: f.home, config: DEFAULT_CONFIG, action: 'logout', login: f.login })).rejects.toThrow()
  expect(read(f.native)).toBe(f.original)
})

it('simulated: direct deletion aborts old status reads but owns the lane until their actual cleanup', async () => {
  const f = fixture('pi'), cleanup = deferred(), controller = new AbortController()
  const query = { cli: 'pi', settled: false, operation: cleanup.promise, controller }
  ;(f.manager as any).statusQueries.set('simulated-query', query)
  const barrier = vi.fn(async () => {})
  const deleting = f.manager.deleteConfiguration('parent', 'pi', f.login, new AbortController().signal, barrier)
  expect(controller.signal.aborted).toBe(true)
  await Promise.resolve()
  expect(f.manager.isBusy('pi')).toBe(true); expect(barrier).not.toHaveBeenCalled()
  expect(read(f.native)).toBe(f.original)
  query.settled = true; cleanup.resolve()
  expect(await deleting).toEqual({ ok: true }); expect(barrier).toHaveBeenCalledOnce()
  expect(f.manager.isBusy('pi')).toBe(false)
})
