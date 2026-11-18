import { hostServiceFixture } from './fixtures/host-service.ts'
/** Synthetic Gateway/service boundary; no real accounts, network or CLI processes. */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CliWorkerService } from '../src/host/index.ts'
import { CliManagementService } from '../src/host/cli-management/service.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cli-update-rpc-synthetic-'))), controller = new AbortController()
  const spawn = vi.fn(), identify = vi.fn(), status = vi.fn(async () => ({ cli: 'codex', installed: true, state: 'authenticated', summary: 'Synthetic account', authMethod: 'oauth', accountLabel: 'synthetic@example.invalid', actions: [{ id: 'login', label: '登录', description: 'Synthetic' }] }))
  const management = new CliManagementService({ root, backend: { spawn, resolveExecutable: vi.fn() }, config: DEFAULT_CONFIG, idle: () => true, enabled: () => false, cliEnabled: () => true, account: status as any, identify })
  management.saveDownloadSource({ source: 'official' })
  const service = hostServiceFixture({
    cliManagement: management, disposed: controller, options: { stateDirectory: root },
    parent: vi.fn(async () => ({ session: { header: { cwd: root } } })),
    runtime: { assertCliEnabled: vi.fn(), catalogCleanupMessage: vi.fn() }, accounts: { status, isBusy: vi.fn(() => false) },
  }) as CliWorkerService
  cleanup.push(async () => { controller.abort(); await management.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, management, service, identify, spawn, status, control: controller.signal }
}
it('模拟：Agent 工具清单只开放 Worker 操作，不投影任何 CLI 安装、更新或设置 Remote', () => {
  const tools: { name: string }[] = []
  const receiver = { ctx: { effect: (setup: () => unknown) => setup(), tools: { register: (tool: { name: string }) => { tools.push(tool); return () => {} } } } }
  ;hostServiceFixture()['host'].registerTools.call(receiver)
  expect(tools.map(tool => tool.name)).toEqual([
    'cliworker_resolve', 'cliworker_start', 'cliworker_status', 'cliworker_followup',
    'cliworker_stop', 'cliworker_merge', 'cliworker_discard',
  ])
})
it('snapshot and watch validate the parent and never run discovery', async () => {
  const f = fixture(); const snapshot = JSON.parse(await f.service.cliUpdateSnapshot('parent', f.control))
  expect(snapshot.entries).toHaveLength(17)
  const controller = new AbortController(), stream = f.service.watchCliUpdates('parent', controller.signal)
  expect(JSON.parse((await stream.next()).value!)).toMatchObject({ revision: snapshot.revision })
  const next = stream.next(); controller.abort(); expect((await next).done).toBe(true)
  expect(f.identify).not.toHaveBeenCalled(); expect(f.spawn).not.toHaveBeenCalled()
})
it('模拟：主对话的工作目录已被删除时，更新页快照与检查仍可用', async () => {
  // 2026-11-17 Windows 实测：旧测试会话的目录被删后，更新页整页报 ENOENT lstat。
  const f = fixture(), gone = join(f.root, '已删除的项目')
  ;(f.service as any)['host'].parent = vi.fn(async () => ({ session: { header: { cwd: gone } } }))
  const snapshot = JSON.parse(await f.service.cliUpdateSnapshot('parent', f.control))
  expect(snapshot.entries).toHaveLength(17)
  expect(JSON.parse(await f.service.checkCliUpdates('parent', 'missing', f.control)).entries).toHaveLength(17)
})
it('模拟：CLI 连接状态只属于本机——没有目录、目录已删、两个不同项目的主对话得到同一份结果，且只探测一次', async () => {
  // 2026-11-17 Windows 实测：会话目录被删后，设置页 17 个 CLI 的状态全部显示失败。
  const f = fixture(), gone = join(f.root, '已删除的项目')
  const a = join(f.root, 'project-a'), b = join(f.root, 'project-b'); mkdirSync(a); mkdirSync(b)
  f.status.mockImplementation(async () => ({ cli: 'codex', installed: true, state: 'authenticated', verification: 'cli', summary: '模拟账号', authMethod: 'oauth', accountLabel: 'synthetic@example.invalid', actions: [] }) as any)
  const answers: any[] = []
  for (const cwd of [undefined, gone, a, b]) {
    ;(f.service as any)['host'].parent = vi.fn(async () => ({ session: { header: { cwd } } }))
    const direct = JSON.parse(await f.service.accountStatus('parent', 'codex', f.control))
    const quick = JSON.parse(await f.service.settingsConnectionStatus('parent', 'codex', f.control))
    answers.push({ state: direct.state, label: direct.accountLabel, checkedAt: direct.cache?.checkedAt, quick: quick.account.value?.state })
    expect(JSON.stringify([direct.cache ?? {}, quick])).not.toContain('"project"')
  }
  expect(answers[0]).toMatchObject({ state: 'authenticated', label: 'synthetic@example.invalid', quick: 'authenticated' })
  for (const answer of answers.slice(1)) expect(answer).toEqual({ ...answers[0], checkedAt: answers[0].checkedAt })
  // 一次探测：缓存按 CLI 共享，探测进程的工作目录是插件自有的固定目录，不是任何会话目录。
  expect(f.status).toHaveBeenCalledTimes(1)
  const machine = realpathSync(join(f.root, 'machine-scope'))
  expect(f.status.mock.calls[0]!.slice(0, 2)).toEqual(['codex', machine])
  expect(readdirSync(machine)).toEqual([])
  if (process.platform !== 'win32') expect(statSync(machine).mode & 0o777).toBe(0o700)
})
it('模拟：没有可用项目时设置页快照、订阅与模型清单照常返回，不带项目偏好；项目操作仍明确报错', async () => {
  const f = fixture(), gone = join(f.root, '已删除的项目'), binding = vi.fn(async () => 'simulated-binding')
  const catalog = vi.fn(async (cli: string) => ({ binding: 'simulated-binding', catalog: { cli, notice: '模拟目录', models: [{ id: 'simulated', label: '模拟' }] } }))
  const preference = vi.fn(() => ({ cli: 'codex', model: 'simulated' }))
  Object.assign(f.service['host'] as any, { queryCatalog: catalog, readAccountBinding: binding, backend: {},
    runtime: { assertCliEnabled: vi.fn(), catalogCleanupMessage: vi.fn(), storage: { directory: f.root, preference, cliSettings: () => ({ enabled: {} }) } } })
  const machine = join(f.root, 'machine-scope')
  for (const cwd of [undefined, gone]) {
    ;(f.service as any)['host'].parent = vi.fn(async () => ({ session: { header: { cwd } } }))
    const listed = JSON.parse(await f.service.catalogForCli('parent', 'codex', f.control))
    expect(listed.models).toHaveLength(1); expect(listed.preference).toBeUndefined()
    const settings = JSON.parse(await f.service.cliSettings('parent', f.control)).settingsCache
    expect(settings).toMatchObject({ project: 'no-project', preferences: {}, catalogReady: { codex: true } })
    expect(settings.connections.entries.find((entry: any) => entry.cli === 'codex').catalog.value.models).toHaveLength(1)
    const watcher = new AbortController(), stream = f.service.watchSettingsConnections('parent', watcher.signal)
    expect(JSON.parse((await stream.next()).value!).entries).toHaveLength(17)
    watcher.abort(); await stream.return(undefined)
  }
  expect(catalog).toHaveBeenCalledTimes(1); expect(preference).not.toHaveBeenCalled()
  expect(catalog.mock.calls[0]![3]).toBe(realpathSync(machine)); expect(binding.mock.calls.every(call => call[3] === realpathSync(machine))).toBe(true)
  // 有项目的主对话看到同一份整机模型清单，并附带自己项目的偏好。
  ;(f.service as any)['host'].parent = vi.fn(async () => ({ session: { header: { cwd: f.root } } }))
  ;(f.service as any)['host'].project = () => f.root
  expect(JSON.parse(await f.service.catalogForCli('parent', 'codex', f.control)).preference).toEqual({ cli: 'codex', model: 'simulated' })
  expect(catalog).toHaveBeenCalledTimes(1); expect(preference).toHaveBeenCalledWith(f.root, 'codex')
  // 属于项目的操作仍需有效项目，并说明原因。
  const project = hostServiceFixture()['host'].project
  expect(() => project.call({}, { session: { header: { cwd: gone } } })).toThrow(`此主对话的工作目录已不存在（${gone}），请切换到有效项目`)
  expect(() => project.call({}, { session: { header: {} } })).toThrow('此主对话没有工作目录，请先选择项目')
})
it('source Remote saves only validated local settings and rejects credentials', async () => {
  const f = fixture()
  expect(JSON.parse(await f.service.cliDownloadSource('parent', f.control))).toEqual({ source: 'official' })
  expect(JSON.parse(await f.service.saveCliDownloadSource('parent', '{"source":"npmmirror"}', f.control))).toEqual({ source: 'npmmirror' })
  await expect(f.service.saveCliDownloadSource('parent', '{"source":"custom","customUrl":"https://a:b@example.invalid"}', f.control)).rejects.toThrow()
  expect(JSON.parse(await f.service.testCliDownloadSource('parent', 'http://example.invalid', f.control)).ok).toBe(false)
  expect(f.spawn).not.toHaveBeenCalled()
})
it('accountStatus returns display cache metadata; refreshAccountStatus restores fresh actions', async () => {
  const f = fixture()
  const first = JSON.parse(await f.service.accountStatus('parent', 'codex', f.control)); expect(first.actions).toHaveLength(1); expect(f.status).toHaveBeenCalledTimes(1)
  const second = JSON.parse(await f.service.accountStatus('parent', 'codex', f.control)); expect(second.cache).toMatchObject({ stale: false, displayOnly: true }); expect(second.actions).toEqual([]); expect(f.status).toHaveBeenCalledTimes(1)
  await f.service.refreshAccountStatus('parent', 'codex', f.control); expect(f.status).toHaveBeenCalledTimes(2)
  f.management.cache.invalidateAccount('codex'); await f.service.accountStatus('parent', 'codex', f.control); expect(f.status).toHaveBeenCalledTimes(3)
})
it('cached accounts never bypass disabled CLI checks or process cleanup quarantine', async () => {
  const f = fixture(); await f.service.accountStatus('parent', 'codex', f.control)
  ;(f.service as any)['host'].runtime.assertCliEnabled.mockImplementation(() => { throw new Error('synthetic disabled') })
  await expect(f.service.accountStatus('parent', 'codex', f.control)).rejects.toThrow('disabled'); expect(f.status).toHaveBeenCalledTimes(1)
})

it('模拟：连接预加载和账号 Remote 共用缓存，过期重查且保持原摘要', async () => {
  const f = fixture(), cache = (f.service as any)['host'].connectionCache()
  await cache.read('codex', 'account', f.control, async () => ({
    cli: 'codex', installed: true, state: 'authenticated', verification: 'local', summary: '模拟预加载摘要', actions: [],
  }))
  const first = JSON.parse(await f.service.accountStatus('parent', 'codex', f.control))
  expect(first.summary).toBe('模拟预加载摘要'); expect(first.cache).toMatchObject({ stale: false, displayOnly: true })
  expect(f.status).not.toHaveBeenCalled(); expect(f.spawn).not.toHaveBeenCalled()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600_001)
  try {
    await f.service.accountStatus('parent', 'codex', f.control)
    expect(f.status).toHaveBeenCalledTimes(1)
  } finally { clock.mockRestore() }
})
it('模拟：连接快照先返回已有值，再经订阅推送过期重查完成结果', async () => {
  const f = fixture(), cache = (f.service as any)['host'].connectionCache(), watcher = new AbortController()
  ;(f.service as any)['host'].settingsCatalog = vi.fn(async () => '')
  await cache.read('codex', 'account', f.control, async () => ({ cli: 'codex', installed: true,
    state: 'authenticated', verification: 'local', summary: '模拟旧值', actions: [] }))
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600_001)
  try {
    let finish!: (value: unknown) => void
    f.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }) as any)
    const stream = f.service.watchSettingsConnections('parent', watcher.signal)
    await stream.next()
    const old = JSON.parse(await f.service.settingsConnectionStatus('parent', 'codex', f.control))
    expect(old.account.cache.stale).toBe(true); expect(old.account.value.state).toBe('unknown')
    await vi.waitFor(() => expect(f.status).toHaveBeenCalledTimes(1))
    finish({ cli: 'codex', installed: true, state: 'unconfigured', verification: 'local', summary: '模拟新值', actions: [] })
    await vi.waitFor(() => expect(cache.status('codex').account.loading).toBe(false))
    const update = JSON.parse((await stream.next()).value!)
    expect(update.entries.find((x: any) => x.cli === 'codex').account.value.state).toBe('unconfigured')
    watcher.abort(); await stream.return(undefined)
  } finally { clock.mockRestore(); watcher.abort() }
})

it('模拟：读取期间账号 epoch 变化，旧 authenticated 不能作为无 cache 的新结果返回', async () => {
  const f = fixture()
  f.status.mockImplementationOnce(async () => {
    f.management.cache.invalidateAccount('codex')
    return { cli: 'codex', installed: true, state: 'authenticated', verification: 'local', summary: '模拟旧账号', actions: [] } as any
  })
  await expect(f.service.accountStatus('parent', 'codex', f.control)).rejects.toThrow('来源已变化')
  expect((f.service as any)['host'].connectionCache().status('codex').account.value).toBeUndefined()
})
it('模拟：入口 revision 变化清除账号，第一次自动记录入口不误判为切换', async () => {
  const f = fixture(); let revision = 0, entry: any
  ;(f.service as any)['host'].options = { stateDirectory: f.root, cliExecutablePaths: { read: () => entry, revision: () => revision } }
  f.status.mockImplementationOnce(async () => {
    entry = { mode: 'auto', path: '/simulated/codex' }; revision++
    return { cli: 'codex', installed: true, state: 'authenticated', verification: 'local', summary: '模拟首次识别', actions: [] } as any
  })
  expect(JSON.parse(await f.service.accountStatus('parent', 'codex', f.control)).cache.stale).toBe(false)
  entry = { mode: 'manual', path: '/simulated/other' }; revision++
  await f.service.accountStatus('parent', 'codex', f.control)
  expect(f.status).toHaveBeenCalledTimes(2)
})
