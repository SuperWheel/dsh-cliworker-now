/** Synthetic Gateway/service boundary; no real accounts, network or CLI processes. */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
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
  const service = Object.assign(Object.create(CliWorkerService.prototype), {
    cliManagement: management, disposed: controller,
    parent: vi.fn(async () => ({ session: { header: { cwd: root } } })),
    runtime: { assertCliEnabled: vi.fn(), catalogCleanupMessage: vi.fn() }, accounts: { status, isBusy: vi.fn(() => false) },
  }) as CliWorkerService
  cleanup.push(async () => { controller.abort(); await management.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, management, service, identify, spawn, status, control: controller.signal }
}
it('模拟：Agent 工具清单只开放 Worker 操作，不投影任何 CLI 安装、更新或设置 Remote', () => {
  const tools: { name: string }[] = []
  const receiver = { ctx: { effect: (setup: () => unknown) => setup(), tools: { register: (tool: { name: string }) => { tools.push(tool); return () => {} } } } }
  ;(CliWorkerService.prototype as any).registerTools.call(receiver)
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
  ;(f.service as any).runtime.assertCliEnabled.mockImplementation(() => { throw new Error('synthetic disabled') })
  await expect(f.service.accountStatus('parent', 'codex', f.control)).rejects.toThrow('disabled'); expect(f.status).toHaveBeenCalledTimes(1)
})

it('模拟：连接预加载和账号 Remote 共用缓存，过期重查且保持原摘要', async () => {
  const f = fixture(), cache = (f.service as any).connectionCache()
  await cache.read(f.root, 'codex', 'account', f.control, async () => ({
    cli: 'codex', installed: true, state: 'authenticated', verification: 'local', summary: '模拟预加载摘要', actions: [],
  }))
  const first = JSON.parse(await f.service.accountStatus('parent', 'codex', f.control))
  expect(first.summary).toBe('模拟预加载摘要'); expect(first.cache.project).toBe(cache.project(f.root))
  expect(f.status).not.toHaveBeenCalled(); expect(f.spawn).not.toHaveBeenCalled()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600_001)
  try {
    await f.service.accountStatus('parent', 'codex', f.control)
    expect(f.status).toHaveBeenCalledTimes(1)
  } finally { clock.mockRestore() }
})
it('模拟：连接快照先返回已有值，再经订阅推送过期重查完成结果', async () => {
  const f = fixture(), cache = (f.service as any).connectionCache(), watcher = new AbortController()
  ;(f.service as any).settingsCatalog = vi.fn(async () => '')
  await cache.read(f.root, 'codex', 'account', f.control, async () => ({ cli: 'codex', installed: true,
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
    await vi.waitFor(() => expect(cache.status(f.root, 'codex').account.loading).toBe(false))
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
  expect((f.service as any).connectionCache().status(f.root, 'codex').account.value).toBeUndefined()
})
it('模拟：入口 revision 变化清除账号，第一次自动记录入口不误判为切换', async () => {
  const f = fixture(); let revision = 0, entry: any
  ;(f.service as any).options = { cliExecutablePaths: { read: () => entry, revision: () => revision } }
  f.status.mockImplementationOnce(async () => {
    entry = { mode: 'auto', path: '/simulated/codex' }; revision++
    return { cli: 'codex', installed: true, state: 'authenticated', verification: 'local', summary: '模拟首次识别', actions: [] } as any
  })
  expect(JSON.parse(await f.service.accountStatus('parent', 'codex', f.control)).cache.stale).toBe(false)
  entry = { mode: 'manual', path: '/simulated/other' }; revision++
  await f.service.accountStatus('parent', 'codex', f.control)
  expect(f.status).toHaveBeenCalledTimes(2)
})
