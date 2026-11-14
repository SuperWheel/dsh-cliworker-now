/** 模拟：真实 Host/AccountManager/连接缓存，只有账号读取与 PTY 是替身；不访问真实账号。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { CliWorkerService } from '../src/host/index.ts'
import { AccountManager } from '../src/host/accounts.ts'
import { WorkerRuntime } from '../src/host/runtime.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import { CliMaintenance } from '../src/host/cli-management/maintenance.ts'
import { readCodexAccount } from '../src/host/codex-account.ts'
import { readCodebuddyAccount } from '../src/host/codebuddy-account.ts'

vi.mock('../src/host/codex-account.ts', () => ({ readCodexAccount: vi.fn() }))
vi.mock('../src/host/codebuddy-account.ts', async load => ({
  ...await load<typeof import('../src/host/codebuddy-account.ts')>(), readCodebuddyAccount: vi.fn(),
}))
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); vi.resetAllMocks() })
const identity = { state: 'unconfigured' as const, verification: 'cli' as const, summary: '模拟未登录' }
async function fixture(cli: 'codex' | 'codebuddy') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'account-settings-simulated-')))
  const disposed = new AbortController(), signal = disposed.signal
  vi.mocked(readCodexAccount).mockResolvedValue(identity)
  vi.mocked(readCodebuddyAccount).mockResolvedValue(identity)
  const output = new PassThrough()
  let finish!: (value: { exitCode: number; signal: null }) => void
  const done = new Promise<{ exitCode: number; signal: null }>(resolve => { finish = resolve })
  const terminal = { pid: 123, output, done, write: vi.fn(async () => {}), resize: vi.fn(async () => {}),
    inspectForeground: async () => undefined, inspectActivity: async () => ({ state: 'unknown' as const, revision: 0 }),
    signalForeground: vi.fn(async () => { finish({ exitCode: 0, signal: null }); return 123 }),
    terminate: vi.fn(async () => { output.end(); finish({ exitCode: 0, signal: null }) }),
  }
  const backend: ProcessBackend = { resolveExecutable: vi.fn(async () => `/simulated/${cli}`),
    spawn: vi.fn(() => { throw new Error('模拟测试禁止启动真实进程') }), spawnTerminal: vi.fn(async () => terminal) }
  const options = { ...DEFAULT_CONFIG, stateDirectory: root, cliMaintenance: new CliMaintenance() }
  const runtime = new WorkerRuntime(new WorkerStorage(root), backend, options)
  const accounts = new AccountManager(backend, options, async () => undefined, (id, error) => runtime.blockCatalogOnCleanup(id, error))
  const parent = { id: 'simulation-parent', session: { header: { cwd: root } }, ctx: { effect: () => () => {} } }
  const host = Object.assign(Object.create(CliWorkerService.prototype), {
    disposed, options, backend, accounts, accountParents: new Map(), parent: async () => parent, assertExecution: vi.fn(),
    runtime,
  }) as CliWorkerService
  // Same reservation invalidation hook as the production Host constructor.
  const off = accounts.subscribeActivity(id => (host as any).invalidateSettingsDisplay(id))
  const cache = (host as any).connectionCache()
  cleanups.push(async () => { disposed.abort(); off(); await accounts.close(); await runtime.close(); await cache.close(); rmSync(root, { recursive: true, force: true }) })
  await cache.read(root, cli, 'catalog', signal, async () => ({ catalog: { cli, models: [], notice: '模拟' }, binding: 'simulated' }))
  return { host, accounts, cache, root, signal, backend, terminal, pause: () => runtime.blockCatalogOnCleanup(cli, new ProcessCleanupUnconfirmedError()) }
}
it.each(['codex', 'codebuddy'] as const)('模拟：%s 设置快照命中后刷新取得动作，真实 AccountManager 启动并回收模拟 PTY', async cli => {
  const f = await fixture(cli)
  await f.host.accountStatus('simulation-parent', cli, f.signal)
  const settings = JSON.parse(await f.host.cliSettings('simulation-parent', f.signal))
  const cached = settings.settingsCache.connections.entries.find((entry: any) => entry.cli === cli).account
  expect(cached.value.actions).toEqual([])
  expect(cached.cache).toMatchObject({ displayOnly: true, stale: false })
  expect(JSON.parse(await f.host.settingsConnectionStatus('simulation-parent', cli, f.signal)).account.loading).toBe(false)
  expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
  const fresh = JSON.parse(await f.host.refreshAccountStatus('simulation-parent', cli, f.signal))
  expect(fresh.actions.some((action: any) => action.id === 'login')).toBe(true)
  const started = JSON.parse(await f.host.accountStart('simulation-parent', cli, 'login', f.signal))
  expect(started.id).toEqual(expect.any(String))
  expect(f.backend.spawnTerminal).toHaveBeenCalledTimes(1)
  expect(vi.mocked(f.backend.spawnTerminal!).mock.calls[0]![0].argv).toEqual(cli === 'codex' ? ['/simulated/codex', 'login'] : ['/simulated/codebuddy'])
  expect(f.accounts.isBusy(cli)).toBe(true)
  await expect(f.host.accountStart('simulation-parent', cli, 'login', f.signal)).rejects.toThrow('已有账号终端')
  expect(f.backend.spawnTerminal).toHaveBeenCalledTimes(1)
  expect(f.cache.status(f.root, cli).account.value).toBeUndefined()
  const stream = f.host.accountWatch('simulation-parent', started.id, f.signal)
  expect(JSON.parse((await stream.next()).value!).status).toBe('running')
  await stream.return(undefined)
  expect(f.terminal.write).not.toHaveBeenCalled()
  expect(await f.host.accountStop('simulation-parent', started.id)).toBe(true)
  expect(f.accounts.isBusy(cli)).toBe(false)
  expect(f.backend.spawn).not.toHaveBeenCalled()
})
it.each(['codex', 'codebuddy'] as const)('模拟：%s 强制刷新等待已有读取结束，不能复用后台/快照动作', async cli => {
  const f = await fixture(cli)
  let finish!: () => void
  const reading = cli === 'codex' ? vi.mocked(readCodexAccount) : vi.mocked(readCodebuddyAccount)
  reading.mockImplementationOnce(async () => { await new Promise<void>(resolve => { finish = resolve }); return identity })
  const background = f.cache.read(f.root, cli, 'account', f.signal, (control: AbortSignal) => f.accounts.status(cli, f.root, control))
  await vi.waitFor(() => expect(reading).toHaveBeenCalledTimes(1))
  const refreshed = f.host.refreshAccountStatus('simulation-parent', cli, f.signal)
  await Promise.resolve(); expect(reading).toHaveBeenCalledTimes(1)
  finish(); await background
  const fresh = JSON.parse(await refreshed)
  expect(reading).toHaveBeenCalledTimes(2)
  expect(fresh.actions.some((action: any) => action.id === 'login')).toBe(true)
  expect(f.cache.snapshot(f.root).entries.find((entry: any) => entry.cli === cli).account.value.actions).toEqual([])
})
it.each(['codex', 'codebuddy'] as const)('模拟：%s 清理暂停时刷新和快速状态均明确无动作，不能伪装成功登录', async cli => {
  const f = await fixture(cli)
  await f.host.accountStatus('simulation-parent', cli, f.signal)
  f.pause()
  const fresh = JSON.parse(await f.host.refreshAccountStatus('simulation-parent', cli, f.signal))
  expect(fresh).toMatchObject({ cleanupBlocked: true, state: 'unavailable', actions: [] })
  expect(fresh.cache).toBeUndefined()
  const quick = JSON.parse(await f.host.settingsConnectionStatus('simulation-parent', cli, f.signal))
  expect(quick.account).toMatchObject({ loading: false, value: fresh })
  expect(quick.catalog.loading).toBe(false)
  await expect(f.host.accountStart('simulation-parent', cli, 'login', f.signal)).rejects.toThrow('暂停')
  expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
})
it.each(['codex', 'codebuddy'] as const)('模拟：%s 排队刷新被取消后不发新查询、不启动终端', async cli => {
  const f = await fixture(cli), controller = new AbortController()
  let finish!: () => void
  const reading = cli === 'codex' ? vi.mocked(readCodexAccount) : vi.mocked(readCodebuddyAccount)
  reading.mockImplementationOnce(async () => { await new Promise<void>(resolve => { finish = resolve }); return identity })
  const old = f.cache.read(f.root, cli, 'account', f.signal, (control: AbortSignal) => f.accounts.status(cli, f.root, control))
  await vi.waitFor(() => expect(reading).toHaveBeenCalledTimes(1))
  const refresh = f.host.refreshAccountStatus('simulation-parent', cli, controller.signal)
  const rejected = expect(refresh).rejects.toThrow()
  controller.abort(); finish(); await old; await rejected
  expect(reading).toHaveBeenCalledTimes(1)
  expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
})
it.each(['codex', 'codebuddy'] as const)('模拟：%s 终端清理失败后刷新返回暂停，拒绝再次启动直到清理确认', async cli => {
  const f = await fixture(cli)
  const started = JSON.parse(await f.host.accountStart('simulation-parent', cli, 'login', f.signal))
  await f.host.accountStatus('simulation-parent', cli, f.signal)
  expect(f.cache.fresh(f.root, cli, 'account')).toBeDefined()
  f.terminal.terminate.mockRejectedValueOnce(new Error('模拟清理失败'))
  await expect(f.host.accountStop('simulation-parent', started.id)).rejects.toThrow()
  expect(f.cache.fresh(f.root, cli, 'account')).toBeUndefined()
  const fresh = JSON.parse(await f.host.refreshAccountStatus('simulation-parent', cli, f.signal))
  expect(fresh).toMatchObject({ cleanupBlocked: true, state: 'unavailable', actions: [] })
  expect(() => f.accounts.assertCleanupRecoverable(cli)).toThrow('账号终端仍在运行')
  await expect(f.host.accountStart('simulation-parent', cli, 'login', f.signal)).rejects.toThrow('暂停')
  expect(f.backend.spawnTerminal).toHaveBeenCalledTimes(1)
  // The next stop confirms simulated cleanup; no real terminal or account was touched.
  expect(await f.host.accountStop('simulation-parent', started.id)).toBe(true)
  expect(f.accounts.isBusy(cli)).toBe(false)
  expect(f.cache.fresh(f.root, cli, 'account')).toBeUndefined()
  const recovered = JSON.parse(await f.host.refreshAccountStatus('simulation-parent', cli, f.signal))
  expect(recovered.cleanupBlocked).toBeUndefined()
  expect(recovered.actions.some((action: any) => action.id === 'login')).toBe(true)
})
