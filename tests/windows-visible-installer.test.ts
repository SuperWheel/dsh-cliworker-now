/** 模拟：Windows 官方桌面安装程序的窗口呈现与等待时限；不启动真实安装程序。 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { ProcessCleanupUnconfirmedError, VISIBLE_WINDOW, type ProcessBackend } from '../src/host/process.ts'
import { nativeProcessBackend } from '../src/host/native-process.ts'
import { DESKTOP_INSTALLER_TIMEOUT_MS, executeCliOperation } from '../src/host/cli-management/executor.ts'
import { childFixture, control, serviceFixture } from './cli-management-phase-b-fixture.ts'
import { reopenStoppedApp, stoppedApps } from '../src/host/cli-management/windows-installer-apps.ts'

const spawned = vi.hoisted(() => [] as { windowsHide?: boolean }[])
vi.mock('node:child_process', async original => {
  const actual = await original<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn((_file: string, _argv: string[], options: { windowsHide?: boolean }) => { spawned.push(options); return { pid: 1 } }) }
})
const { spawnNativeProcess } = await import('../src/host/native-spawn.mjs')

const fixtures: ReturnType<typeof serviceFixture>[] = []
afterEach(async () => { vi.useRealTimers(); spawned.splice(0); for (const f of fixtures.splice(0)) await f.close() })

function relay() {
  const inner = {
    stdin: undefined, stdout: new PassThrough(), stderr: new PassThrough(), control: new PassThrough(),
    done: new Promise(() => {}), terminate: vi.fn(), waitForExit: vi.fn(async () => true),
  }
  const backend = { resolveExecutable: vi.fn(async (value: string) => value), spawn: vi.fn(() => inner) } as unknown as ProcessBackend
  return { inner, backend }
}
const installer: SubprocessSpawnSpec = { argv: ['C:\\模拟\\downloads\\installer.exe'], cwd: 'C:\\模拟', stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }, graceMs: 500 }
const bootstrapOptions = (backend: ProcessBackend) => {
  const requested = vi.mocked(backend.spawn).mock.calls[0]![0]
  return { requested, options: JSON.parse(requested.argv[2]!) as Record<string, unknown> }
}

describe('Windows 桌面安装程序窗口（模拟）', () => {
  it('只有带 Host 标记的安装程序在 Windows 中继里显示窗口，且标记不会传给 SDK', () => {
    const f = relay()
    nativeProcessBackend(f.backend, 'win32', { electron: true }).spawn({ ...installer, [VISIBLE_WINDOW]: true } as SubprocessSpawnSpec)
    const { requested, options } = bootstrapOptions(f.backend)
    expect(options.visibleWindow).toBe(true)
    expect(Object.getOwnPropertySymbols(requested)).toEqual([])
    expect(requested.argv.slice(3)).toEqual(installer.argv)
  })
  it('普通 Windows CLI 进程仍走隐藏中继', () => {
    const f = relay()
    nativeProcessBackend(f.backend, 'win32', { electron: true }).spawn(installer)
    expect(bootstrapOptions(f.backend).options).not.toHaveProperty('visibleWindow')
  })
  it('代理包装后标记仍保留到 Windows 中继', () => {
    const f = relay()
    const proxy = { current: () => ({ url: 'http://127.0.0.1:7890', bypass: [] }), fresh: async () => undefined } as never
    nativeProcessBackend(f.backend, 'win32', { electron: true, systemProxy: proxy }).spawn({ ...installer, [VISIBLE_WINDOW]: true } as SubprocessSpawnSpec)
    expect(bootstrapOptions(f.backend).options.visibleWindow).toBe(true)
  })
  it('中继启动目标时只对安装程序关闭 windowsHide', () => {
    spawnNativeProcess('installer.exe', [], { stdio: 'ignore' }, { visibleWindow: true })
    spawnNativeProcess('cli.exe', [], { stdio: 'ignore' })
    expect(spawned.map(options => options.windowsHide)).toEqual([false, true])
  })
})

describe('桌面安装程序等待时限（模拟）', () => {
  it('窗口出现后不再计时：超过 10 分钟仍等待用户，不终止安装程序', async () => {
    vi.useFakeTimers(); const f = serviceFixture(); fixtures.push(f); const child = childFixture()
    vi.mocked(f.backend.spawn).mockReturnValue(child.child as any)
    const pending = executeCliOperation(f.backend, f.config, ['C:\\模拟\\installer.exe'], control(), vi.fn(), DESKTOP_INSTALLER_TIMEOUT_MS, undefined, undefined, undefined, undefined, true)
    await vi.waitFor(() => expect(f.backend.spawn).toHaveBeenCalledOnce())
    expect((vi.mocked(f.backend.spawn).mock.calls[0]![0] as never)[VISIBLE_WINDOW]).toBe(true)
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000)
    expect(child.child.terminate).not.toHaveBeenCalled()
    child.finish(); await vi.waitFor(() => expect(child.child.waitForExit).toHaveBeenCalled()); child.exit(true); await pending
  })
  it('普通安装命令仍在 10 分钟后超时', async () => {
    vi.useFakeTimers(); const f = serviceFixture(); fixtures.push(f); const child = childFixture()
    vi.mocked(f.backend.spawn).mockReturnValue(child.child as any)
    child.child.terminate.mockImplementation(() => child.finish(1))
    const pending = executeCliOperation(f.backend, f.config, ['/模拟/update'], control(), vi.fn()).catch(error => error)
    await vi.waitFor(() => expect(f.backend.spawn).toHaveBeenCalledOnce())
    expect((vi.mocked(f.backend.spawn).mock.calls[0]![0] as never)[VISIBLE_WINDOW]).toBeUndefined()
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1)
    await vi.waitFor(() => expect(child.child.waitForExit).toHaveBeenCalled()); child.exit(true)
    expect((await pending).code).toBe('INSTALL_TIMEOUT')
  })
})

describe('安装程序结束页「运行」（模拟）', () => {
  const app = (pid: number, path = 'D:\\模拟\\WorkBuddyAI\\WorkBuddyAI.exe') => ({ pid, created: `1330000000000000${pid}`, path })
  /** Installer process whose own exit is separate from its pipes and from the whole range. */
  function installerChild() {
    const stdout = new PassThrough(), stderr = new PassThrough()
    let exitInstaller!: () => void
    const child = { stdout, stderr, done: new Promise<{ exitCode: number; signal: null }>(resolve => { exitInstaller = () => resolve({ exitCode: 0, signal: null }) }),
      waitForExit: vi.fn(async (_signal?: AbortSignal) => true), terminate: vi.fn() }
    return { child, exitInstaller: () => exitInstaller() }
  }
  const run = (f: ReturnType<typeof serviceFixture>, runningApps?: (signal: AbortSignal) => Promise<ReturnType<typeof app>[]>) =>
    executeCliOperation(f.backend, f.config, ['C:\\模拟\\installer.exe'], control(), vi.fn(), DESKTOP_INSTALLER_TIMEOUT_MS, undefined, undefined, undefined, undefined, { runningApps })

  it('未勾选：安装程序退出、进程范围清空，即判定完成且不结束任何应用', async () => {
    const f = serviceFixture(); fixtures.push(f); const c = installerChild()
    vi.mocked(f.backend.spawn).mockReturnValue(c.child as any)
    const runningApps = vi.fn(async () => [])
    const pending = run(f, runningApps)
    await vi.waitFor(() => expect(f.backend.spawn).toHaveBeenCalledOnce())
    c.child.stdout.end(); c.child.stderr.end(); c.exitInstaller()
    await expect(pending).resolves.toEqual({ stoppedApps: [] })
    expect(c.child.terminate).not.toHaveBeenCalled(); expect(runningApps).not.toHaveBeenCalled()
  })

  it('勾选且应用在 Job 外但继承了输出管道：只等安装程序自身退出加短暂宽限，随后判定完成', async () => {
    vi.useFakeTimers(); const f = serviceFixture(); fixtures.push(f); const c = installerChild()
    vi.mocked(f.backend.spawn).mockReturnValue(c.child as any)
    let settled = false
    const pending = run(f, vi.fn(async () => [])).then(value => { settled = true; return value })
    await vi.waitFor(() => expect(f.backend.spawn).toHaveBeenCalledOnce())
    c.exitInstaller() // pipes stay open
    await vi.advanceTimersByTimeAsync(1000); expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(6000)
    await expect(pending).resolves.toEqual({ stoppedApps: [] })
    expect(c.child.terminate).not.toHaveBeenCalled()
    expect(c.child.stdout.destroyed && c.child.stderr.destroyed).toBe(true)
  })

  it('勾选且应用留在 Job 内：结束进程范围后仍判定完成，并只报告随范围消失的应用', async () => {
    const f = serviceFixture(); fixtures.push(f); const c = installerChild()
    vi.mocked(f.backend.spawn).mockReturnValue(c.child as any)
    c.child.waitForExit.mockImplementationOnce(async () => false) // range still has the started app
    const elsewhere = app(8, 'D:\\模拟\\其他\\WorkBuddyAI.exe')
    const runningApps = vi.fn().mockResolvedValueOnce([app(7), elsewhere]).mockResolvedValueOnce([elsewhere])
    const pending = run(f, runningApps)
    await vi.waitFor(() => expect(f.backend.spawn).toHaveBeenCalledOnce())
    c.child.stdout.end(); c.child.stderr.end(); c.exitInstaller()
    await expect(pending).resolves.toEqual({ stoppedApps: [app(7)] })
    expect(c.child.terminate).toHaveBeenCalledOnce(); expect(runningApps).toHaveBeenCalledTimes(2)
  })

  it('安装程序窗口还开着时输出流出错：不产生未处理的拒绝，安装程序退出后照常判定完成', async () => {
    const f = serviceFixture(); fixtures.push(f); const c = installerChild()
    vi.mocked(f.backend.spawn).mockReturnValue(c.child as any)
    const unhandled = vi.fn(); process.on('unhandledRejection', unhandled)
    try {
      const pending = run(f, vi.fn(async () => []))
      await vi.waitFor(() => expect(f.backend.spawn).toHaveBeenCalledOnce())
      c.child.stdout.destroy(new Error('模拟管道错误')); c.child.stderr.end()
      await new Promise(resolve => setTimeout(resolve, 20))
      c.exitInstaller()
      await expect(pending).resolves.toEqual({ stoppedApps: [] })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(unhandled).not.toHaveBeenCalled()
    } finally { process.off('unhandledRejection', unhandled) }
  })

  it('应用快照自身的进程范围未确认退出：安装程序照常清理，但操作以清理未确认失败', async () => {
    const f = serviceFixture(); fixtures.push(f); const c = installerChild()
    vi.mocked(f.backend.spawn).mockReturnValue(c.child as any)
    c.child.waitForExit.mockImplementationOnce(async () => false)
    const runningApps = vi.fn().mockRejectedValueOnce(new ProcessCleanupUnconfirmedError())
    const pending = run(f, runningApps).catch(error => error)
    await vi.waitFor(() => expect(f.backend.spawn).toHaveBeenCalledOnce())
    c.child.stdout.end(); c.child.stderr.end(); c.exitInstaller()
    expect(await pending).toBeInstanceOf(ProcessCleanupUnconfirmedError)
    expect(c.child.terminate).toHaveBeenCalledOnce()
  })

  it('取消等待中的安装程序时不枚举应用，也不报告需要重新打开', async () => {
    const f = serviceFixture(); fixtures.push(f); const c = installerChild()
    vi.mocked(f.backend.spawn).mockReturnValue(c.child as any)
    c.child.terminate.mockImplementation(() => { c.child.stdout.end(); c.child.stderr.end(); c.exitInstaller() })
    const abort = new AbortController(), runningApps = vi.fn(async () => [app(7)])
    const pending = executeCliOperation(f.backend, f.config, ['C:\\模拟\\installer.exe'], abort.signal, vi.fn(), DESKTOP_INSTALLER_TIMEOUT_MS, undefined, undefined, undefined, undefined, { runningApps }).catch(error => error)
    await vi.waitFor(() => expect(f.backend.spawn).toHaveBeenCalledOnce())
    abort.abort()
    expect(await pending).toBeInstanceOf(Error)
    expect(runningApps).not.toHaveBeenCalled()
  })
})

describe('重新打开被结束的应用（模拟）', () => {
  const root = mkdtempSync(join(tmpdir(), 'cwn-reopen-'))
  const exe = join(root, 'WorkBuddyAI.exe')
  writeFileSync(exe, '模拟')
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  // Windows paths compare case-insensitively; this host's temp path stands in for the app root.
  const stopped = [{ pid: 7, created: '1', path: exe }]

  it('只重新打开已核实安装目录里的主程序，经 explorer.exe 交给系统外壳并以可见方式启动', async () => {
    const f = relay(); const note = vi.fn()
    vi.mocked(f.backend.spawn).mockReturnValue({ ...f.inner, done: Promise.resolve({ exitCode: 1, signal: null }) } as any)
    await reopenStoppedApp({ backend: f.backend, config: { graceMs: 500 } as never, image: 'WorkBuddyAI.exe', stopped, appRoot: root, signal: new AbortController().signal, note })
    const spec = vi.mocked(f.backend.spawn).mock.calls[0]![0] as never as SubprocessSpawnSpec & Record<symbol, unknown>
    expect(spec.argv).toEqual(['explorer.exe', exe]); expect(spec[VISIBLE_WINDOW]).toBe(true)
    expect(note).toHaveBeenCalledWith(expect.stringContaining('已重新打开'))
  })
  it('explorer.exe 启动失败时不声称已重新打开，改为提示手动打开', async () => {
    const f = relay(); const note = vi.fn()
    vi.mocked(f.backend.spawn).mockImplementation(() => ({ ...f.inner, done: Promise.reject(Object.assign(new Error('模拟'), { code: 'ENOENT' })) }) as any)
    await reopenStoppedApp({ backend: f.backend, config: { graceMs: 500 } as never, image: 'WorkBuddyAI.exe', stopped, appRoot: root, signal: new AbortController().signal, note })
    expect(note).toHaveBeenCalledOnce(); expect(note).toHaveBeenCalledWith(expect.stringContaining('请手动打开'))
  })
  it('路径不在已核实目录内或文件名不符时不启动，只提示手动打开', async () => {
    const f = relay(); const note = vi.fn()
    await reopenStoppedApp({ backend: f.backend, config: { graceMs: 500 } as never, image: 'WorkBuddyAI.exe', stopped, appRoot: join(root, '其他'), signal: new AbortController().signal, note })
    await reopenStoppedApp({ backend: f.backend, config: { graceMs: 500 } as never, image: 'WorkBuddy.exe', stopped, appRoot: root, signal: new AbortController().signal, note })
    expect(f.backend.spawn).not.toHaveBeenCalled()
    expect(note).toHaveBeenCalledTimes(2); expect(note).toHaveBeenCalledWith(expect.stringContaining('请手动打开'))
  })
  it('没有被结束的应用时什么都不做', async () => {
    const f = relay(); const note = vi.fn()
    await reopenStoppedApp({ backend: f.backend, config: { graceMs: 500 } as never, image: 'WorkBuddyAI.exe', stopped: [], appRoot: root, signal: new AbortController().signal, note })
    expect(f.backend.spawn).not.toHaveBeenCalled(); expect(note).not.toHaveBeenCalled()
  })
  it('按 PID 与创建时间比对，PID 复用不算同一进程', () => {
    expect(stoppedApps([{ pid: 7, created: '1', path: exe }, { pid: 9, created: '2', path: exe }], [{ pid: 7, created: '5', path: exe }, { pid: 9, created: '2', path: exe }])).toEqual([{ pid: 7, created: '1', path: exe }])
  })
})
