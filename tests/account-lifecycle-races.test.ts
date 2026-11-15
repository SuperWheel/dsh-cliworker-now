/** 模拟：受控账号元数据、PTY 和 Promise；不读取真实凭据、不运行 CLI。 */
import { afterEach, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import { tmpdir } from 'node:os'
import { AccountManager, AGY_GUIDE_TIMING } from '../src/host/accounts.ts'
import { rememberLoginCredential } from '../src/host/account-guide/credential-evidence.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import { AccountQueryQueue } from '../src/client/account-query-queue.ts'
import type { AccountStatus } from '../src/shared/accounts.ts'
import { SettingsConnectionCache } from '../src/host/settings-connection-cache.ts'
import { readPiOmpAccount } from '../src/host/harness-opencode-accounts.ts'
import { CliWorkerService } from '../src/host/index.ts'
import { preparePiOmpAccountTerminal } from '../src/host/pi-omp-accounts.ts'

vi.mock('../src/host/native-login-providers.ts', () => ({ NativeLoginProviders: class {
  async read() { return [{ id: 'deepseek', label: 'DeepSeek', multi: true }] }
} }))
vi.mock('../src/host/pi-omp-identity.ts', () => ({ verifyPiOmpExecutable: async (_cli: string, executable: string) => executable }))
vi.mock('../src/host/pi-omp-accounts.ts', () => ({ preparePiOmpAccountTerminal: vi.fn(async () => ({
  argv: ['/simulated/omp'], cwd: tmpdir(), env: {}, instruction: '模拟', cleanup: async () => {},
})) }))
vi.mock('../src/host/harness-opencode-accounts.ts', () => ({
  readPiOmpAccount: vi.fn(), readOpenCodeAccount: vi.fn(),
  prepareOpenCodeAccount: async () => ({ argv: ['/simulated/opencode'], cwd: tmpdir(), cleanup: async () => {} }),
}))
vi.mock('../src/host/windows-account-terminal.ts', async load => ({
  ...await load<typeof import('../src/host/windows-account-terminal.ts')>(),
  spawnAccountTerminal: (backend: ProcessBackend, spec: any) => backend.spawnTerminal!(spec),
}))

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const closers: (() => Promise<unknown>)[] = []
const originalTiming = { ...AGY_GUIDE_TIMING }
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); vi.restoreAllMocks(); Object.assign(AGY_GUIDE_TIMING, originalTiming) })

function fixture(cli: 'codex' | 'omp' | 'opencode' = 'codex') {
  const output = new PassThrough(), done = deferred<{ exitCode: number | null; signal: null }>()
  const terminal = { pid: 123, output, done: done.promise,
    write: vi.fn(async () => {}), resize: vi.fn(async () => {}),
    inspectForeground: async () => undefined,
    inspectActivity: async () => ({ state: 'unknown' as const, revision: 0 }),
    signalForeground: async () => { done.resolve({ exitCode: 0, signal: null }); return 123 },
    terminate: vi.fn(async () => { output.end(); done.resolve({ exitCode: 0, signal: null }) }),
  }
  const backend: ProcessBackend = {
    resolveExecutable: vi.fn(async () => `/simulated/${cli}`),
    spawn: vi.fn(() => { throw new Error('禁止真实进程') }),
    spawnTerminal: vi.fn(async () => terminal),
  }
  const manager = new AccountManager(backend, DEFAULT_CONFIG, async () => undefined)
  const status: AccountStatus = { cli, installed: true, state: 'unconfigured', summary: '模拟', actions: [] }
  const read = vi.spyOn(manager as any, 'readStatus').mockResolvedValue(status)
  closers.push(() => manager.close())
  return { manager, backend, terminal, read, status, exit: (exitCode: number | null) => done.resolve({ exitCode, signal: null }), signal: new AbortController().signal,
    start: () => manager.start('parent', cli, 'login', tmpdir(), new AbortController().signal, undefined,
      cli === 'omp' || cli === 'opencode' ? 'deepseek' : undefined) }
}

function simulatedStoredStatus(status: AccountStatus, key: string): AccountStatus {
  return { ...status, state: 'authenticated', logins: [rememberLoginCredential({
    id: 'opencode:deepseek', providerLabel: 'DeepSeek', authMethod: 'api',
  }, ['api', key])] }
}

it.each([0, 7, null])('模拟：OpenCode 同服务商替换在退出码 %s 时完成清理后发布成功', async code => {
  Object.assign(AGY_GUIDE_TIMING, { pollMs: 2, loginConfirmMs: 100 })
  const f = fixture('opencode')
  f.read.mockResolvedValue(simulatedStoredStatus(f.status, 'SIMULATED-OLD'))
  const started = await f.start(), session = (f.manager as any).sessions.get(started.id)
  f.read.mockResolvedValue(simulatedStoredStatus(f.status, 'SIMULATED-NEW'))
  f.exit(code)
  await vi.waitFor(() => expect(session.state).toBe('closed'))
  expect(session.frames.at(-2).guide).toMatchObject({ step: 'signedIn', template: 'result' })
  expect(f.terminal.terminate).toHaveBeenCalledOnce()
  expect(f.manager.isBusy('opencode')).toBe(false)
})

it.each(['throw', 'unavailable', 'stale'] as const)('模拟：退出后首次证据 %s，继续重试直到凭据替换可读', async failure => {
  Object.assign(AGY_GUIDE_TIMING, { pollMs: 2, loginConfirmMs: 100 })
  const f = fixture('opencode'), before = simulatedStoredStatus(f.status, 'SIMULATED-OLD')
  f.read.mockResolvedValue(before)
  const started = await f.start(), session = (f.manager as any).sessions.get(started.id)
  const count = f.read.mock.calls.length
  if (failure === 'throw') f.read.mockRejectedValueOnce(new Error('模拟锁定，不能将原始错误显示给用户'))
  else f.read.mockResolvedValueOnce(failure === 'unavailable' ? { ...f.status, state: 'unavailable' } : before)
  f.read.mockResolvedValue(simulatedStoredStatus(f.status, 'SIMULATED-NEW'))
  f.exit(7)
  await vi.waitFor(() => expect(session.state).toBe('closed'))
  expect(f.read.mock.calls.length).toBeGreaterThanOrEqual(count + 2)
  expect(session.frames.at(-2).guide.step).toBe('signedIn')
})

it.each(['unchanged', 'throw', 'unavailable', 'baseline-unavailable'] as const)('模拟：最终 %s 显示原因及退出码，不误报成功', async failure => {
  Object.assign(AGY_GUIDE_TIMING, { pollMs: 2, loginConfirmMs: 35 })
  const f = fixture('opencode')
  f.read.mockResolvedValue(failure === 'baseline-unavailable' ? { ...f.status, state: 'unavailable' } : simulatedStoredStatus(f.status, 'SIMULATED-OLD'))
  const started = await f.start(), session = (f.manager as any).sessions.get(started.id)
  if (failure === 'throw') f.read.mockRejectedValue(new Error('模拟敏感诊断不应进入界面'))
  else if (failure === 'unavailable') f.read.mockResolvedValue({ ...f.status, state: 'unavailable' })
  else f.read.mockResolvedValue(simulatedStoredStatus(f.status, 'SIMULATED-OLD'))
  f.exit(7)
  await vi.waitFor(() => expect(session.state).toBe('failed'))
  const result = session.frames.at(-2).guide
  expect(result).toMatchObject({ step: 'unconfirmed', template: 'result', tone: 'warning' })
  expect(result.text).toContain(failure === 'unchanged' ? '未检测到所选服务商的凭据变化' : '无法读取')
  expect(result.text).toContain('退出码 7')
  expect(JSON.stringify(session.frames)).not.toContain('模拟敏感诊断')
  expect(session.frames.some((frame: any) => frame.guide?.step === 'signedIn')).toBe(false)
})

it.each(['codex', 'omp'] as const)('模拟：%s 启动中止旧查询后等待其清理，再分配终端', async cli => {
  const f = fixture(cli), cleanup = deferred()
  let control!: AbortSignal
  f.read.mockImplementationOnce(async (_cli, _cwd, signal) => {
    control = signal as AbortSignal
    await cleanup.promise
    control.throwIfAborted()
    return f.status
  })
  const old = f.manager.status(cli, tmpdir(), f.signal).catch(() => undefined)
  await tick()
  const start = f.start()
  await tick()
  expect(control.aborted).toBe(true)
  const allocatedBeforeCleanup = vi.mocked(f.backend.spawnTerminal!).mock.calls.length
  cleanup.resolve(); await old; await start
  expect(allocatedBeforeCleanup).toBe(0)
  expect(f.backend.spawnTerminal).toHaveBeenCalledOnce()
})

it('模拟：启动等待期间取消不分配终端，旧查询清理仍保留占用', async () => {
  const f = fixture(), cleanup = deferred(), request = new AbortController()
  f.read.mockImplementationOnce(async () => { await cleanup.promise; return f.status })
  const old = f.manager.status('codex', tmpdir(), f.signal).catch(() => undefined)
  await tick()
  const start = f.manager.start('parent', 'codex', 'login', tmpdir(), request.signal).catch(() => undefined)
  request.abort(); await tick()
  const busyDuringCleanup = f.manager.isBusy('codex')
  cleanup.resolve(); await old; await start
  expect(busyDuringCleanup).toBe(true)
  expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
  expect(f.manager.isBusy('codex')).toBe(false)
})

it('模拟：旧查询清理失败隔离此 CLI，不能继续分配终端', async () => {
  const f = fixture(), cleanup = deferred()
  f.read.mockImplementationOnce(async () => {
    await cleanup.promise
    ;(f.manager as any).quarantineQuery('codex', new ProcessCleanupUnconfirmedError())
    throw new ProcessCleanupUnconfirmedError()
  })
  const old = f.manager.status('codex', tmpdir(), f.signal).catch(() => undefined)
  const start = f.start().catch(error => error)
  await tick(); cleanup.resolve(); await old
  const result = await start
  expect(result).toBeInstanceOf(Error)
  expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
})

it('模拟：OMP 原生读取收到取消后尚未返回时，不能提前释放查询占用', async () => {
  const f = fixture('omp'), cleanup = deferred(), request = new AbortController()
  f.read.mockRestore()
  let control!: AbortSignal
  vi.mocked(readPiOmpAccount).mockImplementationOnce(async (_cli, _config, signal) => {
    control = signal
    await cleanup.promise
    return { state: 'unconfigured', summary: '模拟' }
  })
  const status = f.manager.status('omp', tmpdir(), request.signal).catch(() => undefined)
  await vi.waitFor(() => expect(control).toBeDefined())
  request.abort(); await tick()
  const activeBeforeCleanup = f.manager.hasActiveQuery('omp')
  cleanup.resolve(); await status
  expect(activeBeforeCleanup).toBe(true)
  expect(f.manager.hasActiveQuery('omp')).toBe(false)
})

it('模拟：终端占用期间的展示刷新不读取正在修改的存储，结束后可重新读取', async () => {
  const f = fixture('omp'), started = await f.start()
  const reads = f.read.mock.calls.length
  expect(await f.manager.status('omp', tmpdir(), f.signal)).toMatchObject({ state: 'unknown', actions: [] })
  expect(f.read).toHaveBeenCalledTimes(reads)
  await f.manager.stop('parent', started.id)
  await f.manager.status('omp', tmpdir(), f.signal)
  expect(f.read).toHaveBeenCalledTimes(reads + 1)
})

it('模拟：交互及清理期间均保持互斥；清理确认后允许下一次启动', async () => {
  const f = fixture(), started = await f.start(), cleanup = deferred()
  expect(() => f.start()).toThrow('已有账号终端')
  f.terminal.terminate.mockImplementationOnce(async () => { await cleanup.promise; f.terminal.output.end() })
  const stopping = f.manager.stop('parent', started.id)
  await tick()
  expect(() => f.start()).toThrow('已有账号终端')
  const allocatedBeforeCleanup = vi.mocked(f.backend.spawnTerminal!).mock.calls.length
  cleanup.resolve(); await stopping
  const result = await f.start()
  expect(allocatedBeforeCleanup).toBe(1)
  expect(result).toHaveProperty('id')
  expect(f.backend.spawnTerminal).toHaveBeenCalledTimes(2)
})

it.each(['omp', 'opencode'] as const)('模拟：%s 登录前基线必须早于 PTY（快速登录不能成为旧凭据）', async cli => {
  const f = fixture(cli)
  let loggedIn = false
  f.read.mockImplementation(async () => ({ ...f.status, state: loggedIn ? 'authenticated' : 'unconfigured' }))
  vi.mocked(f.backend.spawnTerminal!).mockImplementationOnce(async () => { loggedIn = true; return f.terminal })
  const started = await f.start()
  const session = (f.manager as any).sessions.get(started.id)
  expect((await session.before).state).toBe('unconfigured')
})

it('模拟：成功引导、关闭回执在资源释放及缓存作废之后发布', async () => {
  const f = fixture('omp'), cleanup = deferred(), cache = new SettingsConnectionCache()
  closers.push(() => cache.close())
  await cache.read(tmpdir(), 'omp', 'account', f.signal, async () => f.status)
  const off = f.manager.subscribeActivity(cli => { if (cli !== 'harness') cache.invalidate(cli) })
  closers.push(async () => off())
  const started = await f.start(), session = (f.manager as any).sessions.get(started.id)
  f.terminal.terminate.mockImplementationOnce(async () => {
    await cleanup.promise; f.terminal.output.end()
  })
  const revision = cache.revision('omp')
  const proven = (f.manager as any).proven(session, 'login', session.guideControl.signal)
  await tick()
  const publishedEarly = session.frames.some((frame: any) => frame.guide?.step === 'signedIn')
  cleanup.resolve(); await proven; await session.cleanup
  expect(publishedEarly).toBe(false)
  expect(cache.revision('omp')).toBeGreaterThan(revision)
  expect(f.manager.isBusy('omp')).toBe(false)
  expect(session.frames.at(-1)).toMatchObject({ status: 'closed', cleanupConfirmed: true })
  expect(session.frames.at(-2).guide.step).toBe('signedIn')
})

it('模拟：whenIdle 不能把已取消但尚未清理的请求当作空闲', async () => {
  const queue = new AccountQueryQueue<string>(), cleanup = deferred(), next = vi.fn()
  queue.enqueue('omp', () => cleanup.promise)
  await tick(); queue.cancel('omp'); queue.whenIdle('omp', next)
  const early = next.mock.calls.length
  cleanup.resolve(); await tick()
  expect(early).toBe(0)
  expect(next).toHaveBeenCalledOnce()
})

function hostFixture() {
  const f = fixture('omp'), disposed = new AbortController()
  const catalog = { catalog: { cli: 'omp' as const, models: [], notice: '模拟' }, binding: 'simulated' }
  const get = vi.fn(async (_input: any) => catalog)
  const runtime = { assertCliEnabled: vi.fn(), assertAccountIdle: vi.fn(), catalogCleanupMessage: vi.fn() }
  const parent = { id: 'parent', session: { header: { cwd: tmpdir() } }, ctx: { effect: () => () => {} } }
  const host = Object.assign(Object.create(CliWorkerService.prototype), {
    disposed, options: DEFAULT_CONFIG, backend: f.backend, accounts: f.manager, runtime,
    accountParents: new Map(), parent: async () => parent, assertExecution: vi.fn(),
    settingsCatalogs: { get, invalidate: vi.fn() },
  }) as any
  const cache: SettingsConnectionCache = host.connectionCache()
  const off = f.manager.subscribeActivity(cli => host.invalidateSettingsDisplay(cli))
  closers.push(async () => { await f.manager.close(); off(); disposed.abort(); await cache.close() })
  return { ...f, host, cache, catalog, get, runtime,
    startHost: (signal = f.signal) => host.startAccount('parent', 'omp', 'login', signal, undefined, 'deepseek'),
    load: (cli = 'omp', project = tmpdir()) => host.loadSettingsCatalog(project, cli, f.signal, true),
  }
}

it('模拟：Host 等待跨项目目录清理后才准备 OMP 终端，占用期间拒绝新目录读取，退出后恢复', async () => {
  const f = hostFixture(), cleanup = deferred()
  let control!: AbortSignal
  f.get.mockImplementationOnce(async input => { control = input.signal; await cleanup.promise; return f.catalog })
  const old = f.load().catch((error: unknown) => error)
  await vi.waitFor(() => expect(control).toBeDefined())
  // Another project is already queued behind the same CLI's account lease.
  const queued = f.load('omp', '/simulated-other-project').catch((error: unknown) => error)
  const preparations = vi.mocked(preparePiOmpAccountTerminal).mock.calls.length
  const started = f.startHost()
  await tick()
  const before = { busy: f.manager.isBusy('omp'), spawns: vi.mocked(f.backend.spawnTerminal!).mock.calls.length,
    preparations: vi.mocked(preparePiOmpAccountTerminal).mock.calls.length }
  const held = f.load().then(() => false, () => true)
  // Independent CLIs retain their metadata lane.
  await f.load('codex')
  cleanup.resolve(); await old; await queued
  const result = JSON.parse(await started)
  expect(control.aborted).toBe(true)
  expect(before).toEqual({ busy: true, spawns: 0, preparations })
  expect(await held).toBe(true)
  await expect(f.load()).rejects.toThrow('账号终端')
  expect(f.get).toHaveBeenCalledTimes(2) // old OMP + independent Codex; queued OMP never ran
  await f.manager.stop('parent', result.id)
  await f.load()
  expect(f.get).toHaveBeenCalledTimes(3)
})

it('模拟：等待目录清理时取消启动，保持占用到清理结束且不准备终端', async () => {
  const f = hostFixture(), cleanup = deferred(), request = new AbortController()
  f.get.mockImplementationOnce(async () => { await cleanup.promise; return f.catalog })
  const old = f.load().catch(() => undefined)
  await vi.waitFor(() => expect(f.get).toHaveBeenCalledOnce())
  const preparations = vi.mocked(preparePiOmpAccountTerminal).mock.calls.length
  const started = f.startHost(request.signal).catch((error: unknown) => error)
  await tick(); request.abort(); await tick()
  const held = f.manager.isBusy('omp')
  cleanup.resolve(); await old
  expect(await started).toBeInstanceOf(Error)
  expect(held).toBe(true)
  expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
  expect(vi.mocked(preparePiOmpAccountTerminal).mock.calls.length).toBe(preparations)
  expect(f.manager.isBusy('omp')).toBe(false)
  await f.load()
})

it('模拟：目录清理产生隔离后拒绝准备终端，释放仅限账号占用', async () => {
  const f = hostFixture(), cleanup = deferred()
  f.get.mockImplementationOnce(async () => {
    await cleanup.promise
    f.runtime.assertAccountIdle.mockImplementation(() => { throw new ProcessCleanupUnconfirmedError() })
    throw new ProcessCleanupUnconfirmedError()
  })
  const old = f.load().catch(() => undefined)
  await vi.waitFor(() => expect(f.get).toHaveBeenCalledOnce())
  const started = f.startHost().catch((error: unknown) => error)
  await tick(); cleanup.resolve(); await old
  expect(await started).toBeInstanceOf(Error)
  expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
  expect(f.manager.isBusy('omp')).toBe(false)
  expect(() => f.runtime.assertAccountIdle()).toThrow()
})

it('模拟：终端清理未确认时继续阻止目录，重试清理成功后恢复', async () => {
  const f = hostFixture(), started = JSON.parse(await f.startHost())
  f.terminal.terminate.mockRejectedValueOnce(new Error('模拟清理失败'))
  await expect(f.manager.stop('parent', started.id)).rejects.toThrow()
  await expect(f.load()).rejects.toThrow('账号终端')
  expect(f.get).not.toHaveBeenCalled()
  await f.manager.stop('parent', started.id)
  await f.load()
  expect(f.get).toHaveBeenCalledOnce()
})

it('模拟：终端分配失败释放目录门禁，不遗留 CLI 占用', async () => {
  const f = hostFixture()
  vi.mocked(f.backend.spawnTerminal!).mockRejectedValueOnce(new Error('模拟分配失败'))
  await expect(f.startHost()).rejects.toThrow()
  expect(f.manager.isBusy('omp')).toBe(false)
  await f.load()
  expect(f.get).toHaveBeenCalledOnce()
})
