/** 模拟：Windows 官方桌面安装程序的窗口呈现与等待时限；不启动真实安装程序。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { VISIBLE_WINDOW, type ProcessBackend } from '../src/host/process.ts'
import { nativeProcessBackend } from '../src/host/native-process.ts'
import { DESKTOP_INSTALLER_TIMEOUT_MS, executeCliOperation } from '../src/host/cli-management/executor.ts'
import { childFixture, control, serviceFixture } from './cli-management-phase-b-fixture.ts'

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
    const proxy = { current: () => ({ http: 'http://127.0.0.1:7890' }), fresh: async () => undefined } as never
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
