import { hostServiceFixture } from './fixtures/host-service.ts'
/** 模拟：原生账号、目录、进程与时钟均为夹具，不读取真实账号或调用模型。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CliManagementService } from '../src/host/cli-management/service.ts'
import { ReleaseClient } from '../src/host/cli-management/versions.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
import { backgroundConnectionConfig } from '../src/host/settings-connection-background.ts'
import type { ActiveCliId } from '../src/shared/types.ts'

const included = ['codex', 'claude', 'kimi', 'mimo', 'grok', 'omp', 'pi', 'hermes', 'opencode', 'zcode'] as const
const excluded = ['antigravity', 'qoder', 'qodercn', 'traecn', 'workbuddycn', 'workbuddy'] as const
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); vi.useRealTimers() })
const signal = () => new AbortController().signal
const receipt = (cli: ActiveCliId) => ({ binding: 'simulated-binding', catalog: { cli, notice: '模拟目录', models: [{ id: 'simulated', label: '模拟', efforts: ['low', 'high'] }] } })
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'connection-preload-simulated-')))
  const executable = join(root, 'simulated-cli'); writeFileSync(executable, '模拟，不执行')
  const controller = new AbortController()
  const config = { ...DEFAULT_CONFIG, stateDirectory: root, cliExecutablePaths: { read: () => ({ mode: 'manual', path: executable }), revision: () => 0 } }
  const status = vi.fn(async (cli: ActiveCliId) => ({ cli, installed: true, state: 'authenticated', verification: 'cli', summary: '模拟账号', actions: [] }))
  const queryCatalog = vi.fn(async (cli: ActiveCliId) => receipt(cli))
  const backend = { spawn: vi.fn(() => { throw new Error('不得启动真实进程') }), resolveExecutable: vi.fn() }
  const service = hostServiceFixture({
    disposed: controller, options: config, backend,
    parent: vi.fn(async () => ({ session: { header: { cwd: root } } })),
    runtime: { assertCliEnabled: vi.fn(), catalogCleanupMessage: vi.fn(), blockCatalogOnCleanup: vi.fn(), storage: { directory: root, preference: vi.fn() } },
    accounts: { status }, queryCatalog, readAccountBinding: vi.fn(async () => 'simulated-binding'),
  })
  const preload = vi.fn((cli: ActiveCliId, kind: 'account' | 'catalog', control: AbortSignal) => service['host'].preloadSettingsConnection(cli, kind, control))
  const management = new CliManagementService({ root, backend, config: config as any,
    idle: () => true, enabled: () => true, cliEnabled: () => true,
    account: status as any, preloadConnection: preload,
    identify: vi.fn(async () => ({ executable, fingerprint: { realpath: executable, size: 12, mtimeMs: 1 }, source: 'npm', manifestVersion: '1.0.0' })) as any,
    version: vi.fn(async () => '1.0.0'), releases: new ReleaseClient(async () => new Response('{}')),
  })
  management.saveDownloadSource({ source: 'official' }); service['host'].cliManagement = management
  let n = 0
  ;(management as any).preloader.options.sample = () => [{ model: '模拟', speed: 1, times: { idle: ++n * 80, user: n * 20, sys: 0, nice: 0, irq: 0 } }]
  cleanups.push(async () => { controller.abort(); await Promise.all([management.close(), service['host'].connections?.close()]); rmSync(root, { recursive: true, force: true }) })
  return { root, executable, config, service, management, status, queryCatalog, preload, backend }
}

it.each(included)('模拟：%s 后台按 CLI 各排一次账号与目录（不按项目），前台复用模型强度', async cli => {
  vi.useFakeTimers(); const f = fixture()
  f.preload.mockImplementation(async () => {})
  f.management.protectProject(f.root); f.management.protectProject(join(f.root, 'project-b'))
  await vi.advanceTimersByTimeAsync(400_000)
  const calls = f.preload.mock.calls.filter(call => call[0] === cli)
  expect(calls.map(call => call[1])).toEqual(['account', 'catalog'])
  await f.service['host'].preloadSettingsConnection(cli, 'account', signal())
  await f.service['host'].preloadSettingsConnection(cli, 'catalog', signal())
  const before = f.queryCatalog.mock.calls.length
  const result = JSON.parse(await f.service['host'].settingsCatalog('parent', cli, signal(), false))
  expect(result.models[0].efforts).toEqual(['low', 'high'])
  expect(f.queryCatalog).toHaveBeenCalledTimes(before)
  expect(f.queryCatalog.mock.calls.find(call => call[0] === cli)?.[2]).toMatchObject({ [`${cli}Executable`]: f.executable, cliExecutablePaths: undefined })
  expect(f.backend.spawn).not.toHaveBeenCalled()
})

it('模拟：排除名单不入队，CodeBuddy 仅账号；登记多个项目不增加连接项、后台最多一个连接项', async () => {
  vi.useFakeTimers(); const f = fixture(); let running = 0, peak = 0
  f.preload.mockImplementation(async () => {
    peak = Math.max(peak, ++running)
    try { await Promise.resolve() } finally { running-- }
  })
  f.management.protectProject(f.root); f.management.protectProject(join(f.root, 'project-b'))
  await vi.advanceTimersByTimeAsync(550_000)
  expect(peak).toBe(1)
  for (const cli of excluded) expect(f.preload.mock.calls.some(call => call[0] === cli)).toBe(false)
  expect(f.preload.mock.calls.filter(call => call[0] === 'codebuddy').map(call => call[1])).toEqual(['account'])
  for (const cli of included) expect(f.preload.mock.calls.filter(call => call[0] === cli)).toHaveLength(2)
  for (const cli of [...excluded, 'codebuddy'] as const)
    await expect(f.service['host'].preloadSettingsConnection(cli, 'catalog', signal())).rejects.toThrow('保留前台')
})

it.each(['account', 'catalog'] as const)('模拟：后台 %s 和前台同槽合并，显式刷新随后执行', async kind => {
  const f = fixture(); let finish!: (value: any) => void
  const load = kind === 'account' ? f.status : f.queryCatalog
  load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }) as any)
  const background = f.service['host'].preloadSettingsConnection('codex', kind, signal())
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1))
  const foreground = kind === 'account' ? f.service.accountStatus('parent', 'codex', signal()) : f.service['host'].settingsCatalog('parent', 'codex', signal(), false)
  await Promise.resolve(); expect(load).toHaveBeenCalledTimes(1)
  const refresh = kind === 'account' ? f.service.refreshAccountStatus('parent', 'codex', signal()) : f.service.refreshCatalogForCli('parent', 'codex', signal())
  await Promise.resolve(); expect(load).toHaveBeenCalledTimes(1)
  finish(kind === 'account' ? { cli: 'codex', installed: true, state: 'unknown', summary: '模拟', actions: [] } : receipt('codex'))
  await Promise.all([background, foreground, refresh])
  expect(load).toHaveBeenCalledTimes(2)
})

it.each(['account', 'catalog'] as const)('模拟：打断 %s 等待清理，旧结果不进入内存或目录缓存，前台接续', async kind => {
  const f = fixture(), control = new AbortController(); let finish!: (value: any) => void
  const load = kind === 'account' ? f.status : f.queryCatalog
  load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }) as any)
  const background = f.service['host'].preloadSettingsConnection('codex', kind, control.signal)
  const rejected = expect(background).rejects.toThrow()
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1)); control.abort()
  const cached = f.service['host'].connectionCache()
  expect(cached.status('codex')[kind].value).toBeUndefined()
  const foreground = kind === 'account' ? f.service.accountStatus('parent', 'codex', signal()) : f.service['host'].settingsCatalog('parent', 'codex', signal(), false)
  await Promise.resolve(); expect(load).toHaveBeenCalledTimes(1)
  finish(kind === 'account' ? { cli: 'codex', installed: true, state: 'unknown', summary: '模拟旧结果', actions: [] } : receipt('codex'))
  await rejected; await foreground
  expect(load).toHaveBeenCalledTimes(2)
  expect(JSON.stringify(cached.status('codex'))).not.toContain('模拟旧结果')
})

it('模拟：后台账号与前台目录跨槽串行，其他 CLI 失败只写自身槽', async () => {
  const f = fixture(); let finish!: (value: any) => void
  f.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }) as any)
  const background = f.service['host'].preloadSettingsConnection('codex', 'account', signal())
  await vi.waitFor(() => expect(f.status).toHaveBeenCalledTimes(1))
  const foreground = f.service['host'].settingsCatalog('parent', 'codex', signal(), false)
  f.queryCatalog.mockRejectedValueOnce(new Error('模拟失败'))
  await expect(f.service['host'].preloadSettingsConnection('kimi', 'catalog', signal())).rejects.toThrow('模拟失败')
  expect(f.queryCatalog.mock.calls.map(call => call[0])).toEqual(['kimi'])
  const cache = f.service['host'].connectionCache()
  expect(cache.status('kimi').catalog.error).toBeTruthy()
  expect(cache.status('codex').account.error).toBeUndefined()
  finish({ cli: 'codex', installed: true, state: 'unknown', summary: '模拟', actions: [] })
  await Promise.all([background, foreground])
  expect(f.queryCatalog.mock.calls.map(call => call[0])).toEqual(['kimi', 'codex'])
})

it('模拟：目录清理未确认进入 CLI 隔离，后续后台不启动查询', async () => {
  const f = fixture(), error = new ProcessCleanupUnconfirmedError()
  f.queryCatalog.mockRejectedValueOnce(error)
  await expect(f.service['host'].preloadSettingsConnection('codex', 'catalog', signal())).rejects.toThrow()
  expect(f.service['host'].runtime.blockCatalogOnCleanup).toHaveBeenCalledWith('codex', error)
  f.service['host'].runtime.catalogCleanupMessage.mockReturnValue('模拟清理暂停')
  await expect(f.service['host'].preloadSettingsConnection('codex', 'account', signal())).rejects.toThrow('模拟清理暂停')
  expect(f.status).not.toHaveBeenCalled()
})

it('模拟：后台固定已记录入口，缺失不发现路径，取消不能进入原生读取', async () => {
  const f = fixture()
  expect((await backgroundConnectionConfig('codex', f.config as any, signal())).codexExecutable).toBe(f.executable)
  await expect(backgroundConnectionConfig('codex', DEFAULT_CONFIG, signal())).rejects.toThrow('已记录')
  const controller = new AbortController(); controller.abort()
  await expect(backgroundConnectionConfig('codex', f.config as any, controller.signal)).rejects.toThrow()
  expect(f.backend.resolveExecutable).not.toHaveBeenCalled()
})

it('模拟：连接项紧接路径检查、先于版本与发布检查，同一 CLI 账号与目录相邻', async () => {
  vi.useFakeTimers(); const f = fixture()
  const order: string[] = []
  const versions = vi.fn(async (cli: ActiveCliId) => { order.push(`version:${cli}`); return '1.0.0' })
  ;(f.management as any).deps.version = versions
  f.preload.mockImplementation(async (cli: ActiveCliId, kind: string) => { order.push(`${kind}:${cli}`) })
  await vi.advanceTimersByTimeAsync(550_000)
  const firstVersion = order.findIndex(item => item.startsWith('version:'))
  const connection = order.filter(item => !item.startsWith('version:'))
  expect(connection.length).toBeGreaterThan(0)
  expect(order.findIndex(item => !item.startsWith('version:'))).toBeLessThan(firstVersion === -1 ? Infinity : firstVersion)
  expect(order.slice(0, connection.length)).toEqual(connection)
  for (const cli of included) {
    const index = order.indexOf(`account:${cli}`)
    expect(order[index + 1]).toBe(`catalog:${cli}`)
  }
})
