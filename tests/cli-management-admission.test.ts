/** 模拟：真实 Host/Runtime 入口，替身账号与进程，不执行 CLI。 */
import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { WorkerRuntime } from '../src/host/runtime.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { CliWorkerService } from '../src/host/index.ts'
import { AccountManager } from '../src/host/accounts.ts'
import { ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
import { CliManagementService } from '../src/host/cli-management/service.ts'
import { CliExecutablePathStore } from '../src/host/cli-executable-paths.ts'
import { serviceFixture, childFixture, checked, finished, control, until } from './cli-management-phase-b-fixture.ts'
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
function fixture() {
  const f = serviceFixture(), storage = new WorkerStorage(join(f.root, 'workers'))
  f.config.cliExecutablePaths = new CliExecutablePathStore(f.root)
  f.config.stateDirectory = f.root // 模拟：整机探测目录落在夹具内，不触碰真实 ~/.dsh
  const runtime = new WorkerRuntime(storage, f.backend, f.config)
  const accounts = new AccountManager(f.backend, f.config, async () => undefined)
  const parent = { id: 'parent', session: { header: { cwd: f.root } } }
  const service = Object.assign(Object.create(CliWorkerService.prototype), { cliManagement: f.service, runtime, accounts, options: f.config, backend: f.backend, disposed: new AbortController(), parent: vi.fn(async () => parent), assertExecution: vi.fn(), accountParents: new Map() }) as CliWorkerService
  const worker = { id: randomUUID(), runId: randomUUID(), parentSessionId: 'parent', project: f.root, title: '模拟', preference: { cli: 'codex' as const, model: '模拟', effort: 'default' as const }, mode: 'accept-edits' as const, status: 'completed' as const, conversationId: '模拟', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  storage.save(worker)
  ;(f.service as any).deps.busy = (cli: any) => ({ workers: runtime.busyCliWorkers(cli), accounts: accounts.isBusy(cli) || accounts.hasActiveQuery(cli) })
  ;(f.service as any).deps.cleanup = (cli: any, error: any) => runtime.blockCatalogOnCleanup(cli, error)
  cleanup.push(async () => { await runtime.close(); await accounts.close(); await f.close() })
  return { ...f, management: f.service, service, runtime, storage, accounts, worker }
}
it('模拟：维护期间拒绝新派遣、续聊、预留、账号、目录和路径；另一 CLI 可用', async () => {
  const f = fixture(), release = f.config.cliMaintenance.begin('codex', () => ({ workers: 0, accounts: false }))
  try {
    expect(() => f.runtime.submit('parent', f.root, '模拟', '模拟', f.worker.preference, 'accept-edits')).toThrow('MAINTENANCE')
    expect(() => f.runtime.submit('parent', f.root, '模拟', '模拟', f.worker.preference, 'accept-edits', f.worker.id)).toThrow('MAINTENANCE')
    expect(() => f.runtime.reserveSubmission('parent', f.worker.id, randomUUID())).toThrow('MAINTENANCE')
    expect(() => f.accounts.start('parent', 'codex', 'login', f.root, control())).toThrow('MAINTENANCE')
    await expect(f.accounts.status('codex', f.root, control())).rejects.toThrow('MAINTENANCE')
    await expect(f.service.accountStatus('parent', 'codex', control())).rejects.toThrow('MAINTENANCE')
    await expect(f.service.accountStart('parent', 'codex', 'login', control())).rejects.toThrow('MAINTENANCE')
    await expect(f.service.catalogForCli('parent', 'codex', control())).rejects.toThrow('MAINTENANCE')
    await expect(f.service.catalogForWorker('parent', f.worker.id, control())).rejects.toThrow('MAINTENANCE')
    await expect(f.service.refreshCatalogForCli('parent', 'codex', control())).rejects.toThrow('MAINTENANCE')
    await expect(f.service.refreshCliExecutablePath('parent', 'codex', '/模拟/other', 'manual', control())).rejects.toThrow('MAINTENANCE')
    expect(f.config.cliExecutablePaths.read('codex')).toBeUndefined()
    expect(() => f.runtime.assertCliEnabled('kimi')).not.toThrow()
    expect(f.backend.spawn).not.toHaveBeenCalled(); expect(f.backend.resolveExecutable).not.toHaveBeenCalled()
  } finally { release() }
})
it('模拟：运行、排队、停止、待受理、未暂停续聊都纳入占用计数', async () => {
  const f = fixture()
  for (const status of ['running', 'queued', 'stopping'] as const) {
    f.storage.save({ ...f.worker, status }); expect(f.runtime.busyCliWorkers('codex')).toBe(1)
  }
  f.storage.save(f.worker)
  const reservation = f.runtime.reserveSubmission('parent', f.worker.id, randomUUID())
  expect(f.runtime.busyCliWorkers('codex')).toBe(1); reservation.release()
  expect(f.runtime.busyCliWorkers('codex')).toBe(0)
  ;(f.runtime as any).followups.add(f.worker.id, '模拟', randomUUID())
  expect(f.runtime.busyCliWorkers('codex')).toBe(1)
})
it('模拟：已开始的元数据读取保留租约，拒绝中途更新；读完后释放', async () => {
  const f = fixture(); await checked(f.management)
  let resolve!: (value: any) => void
  vi.spyOn(f.accounts, 'status').mockReturnValue(new Promise(r => { resolve = r }))
  const reading = f.service.refreshAccountStatus('parent', 'codex', control())
  await until(() => vi.mocked(f.accounts.status).mock.calls.length > 0)
  const token = f.management.snapshot().entries.find(e => e.cli === 'codex')!.planToken!
  expect(() => f.management.start('codex', 'update', token, '', 'during-read')).toThrow('CLI_BUSY')
  resolve({ cli: 'codex', installed: true, state: 'unknown', summary: '模拟', actions: [] }); await reading
  const started = f.management.start('codex', 'update', token, '', 'after-read'); expect(started.operation?.phase).toBe('preparing'); await finished(f.management)
})
it('模拟：Remote 签名与 JSON 返回、取消及 install 缺少存储；请求 signal 不控制已受理操作', async () => {
  const f = fixture(); await checked(f.management)
  const token = f.management.snapshot().entries.find(e => e.cli === 'codex')!.planToken!, child = childFixture(), controller = new AbortController()
  vi.mocked(f.backend.spawn).mockReturnValue(child.child as any)
  const started = JSON.parse(await f.service.startCliOperation('parent', 'codex', 'update', token, '', 'req', controller.signal))
  controller.abort(); await until(() => vi.mocked(f.backend.spawn).mock.calls.length > 0)
  expect(child.child.terminate).not.toHaveBeenCalled()
  expect(JSON.parse(await f.service.cancelCliOperation('parent', started.operation.id, control())).operation.phase).toBe('cancelling')
  await until(() => child.child.waitForExit.mock.calls.length > 0); child.finish(); child.exit(true); await finished(f.management)
  await expect(f.service.startCliOperation('parent', 'zcode', 'install', '', '', 'install', control())).rejects.toThrow('缺少本机路径存储')
  expect(JSON.parse(await f.service.checkInstallDirectory('parent', 'zcode', '', control()))).toEqual({ path: '' })
  const choose = vi.spyOn(f.management, 'chooseDirectory').mockResolvedValue({ path: '' })
  expect(JSON.parse(await f.service.chooseInstallDirectory('parent', 'workbuddy', control()))).toEqual({ path: '' }); expect(choose).toHaveBeenCalledWith('workbuddy', expect.any(AbortSignal))
  const all = vi.spyOn(f.management, 'updateAll').mockReturnValue(f.management.snapshot())
  expect(JSON.parse(await f.service.updateAllClis('parent', 'all', control())).entries).toHaveLength(17); expect(all).toHaveBeenCalledWith('all')
})
it('模拟：清理隔离 marker 跨 Runtime 重启保留', async () => {
  const f = fixture()
  f.runtime.blockCatalogOnCleanup('codex', new ProcessCleanupUnconfirmedError())
  expect(f.storage.cleanupBlockState('codex')).toBe('blocked'); await f.runtime.close()
  const restored = new WorkerRuntime(new WorkerStorage(join(f.root, 'workers')), f.backend, f.config)
  try { expect(() => restored.assertCliEnabled('codex')).toThrow('此 CLI'); expect(() => restored.assertCliEnabled('kimi')).not.toThrow() }
  finally { await restored.close() }
})
it('模拟：明确确认进程已退出后解除更新维护锁', async () => {
  const f = fixture(), child = childFixture(); await checked(f.management); vi.mocked(f.backend.spawn).mockReturnValue(child.child as any)
  const token = f.management.snapshot().entries.find(e => e.cli === 'codex')!.planToken!
  const op = f.management.start('codex', 'update', token, '', 'cleanup').operation!
  await until(() => vi.mocked(f.backend.spawn).mock.calls.length > 0); f.management.cancel(op.id)
  await until(() => child.child.waitForExit.mock.calls.length > 0); child.finish(); child.exit(false); await finished(f.management)
  expect(() => f.runtime.assertCliEnabled('codex')).toThrow('MAINTENANCE')
  const status = vi.spyOn(f.accounts, 'status'), spawnCount = vi.mocked(f.backend.spawn).mock.calls.length
  for (const method of ['accountStatus', 'refreshAccountStatus'] as const) {
    expect(JSON.parse(await f.service[method]('parent', 'codex', control()))).toMatchObject({ cli: 'codex', cleanupBlocked: true, state: 'unavailable', actions: [] })
  }
  expect(status).not.toHaveBeenCalled(); expect(f.backend.spawn).toHaveBeenCalledTimes(spawnCount)
  expect(JSON.parse(await f.service.recoverCliCleanup('parent', 'codex', control()))).toEqual({ cli: 'codex', recovered: true })
  expect(() => f.runtime.assertCliEnabled('codex')).not.toThrow(); expect(f.storage.cleanupBlockState('codex')).toBe('none')
})
it.each(['accountStatus', 'refreshAccountStatus'] as const)('模拟 P5：%s 优先返回隔离状态，维护锁期间不读取账号或启动进程', async method => {
  const f = fixture(), release = f.config.cliMaintenance.begin('codex', () => ({ workers: 0, accounts: false }))
  f.runtime.blockCatalogOnCleanup('codex', new ProcessCleanupUnconfirmedError())
  const status = vi.spyOn(f.accounts, 'status')
  try {
    expect(JSON.parse(await f.service[method]('parent', 'codex', control()))).toMatchObject({ cleanupBlocked: true, actions: [] })
    expect(status).not.toHaveBeenCalled(); expect(f.backend.spawn).not.toHaveBeenCalled(); expect(f.backend.resolveExecutable).not.toHaveBeenCalled()
  } finally { release() }
})
it('模拟：清理隔离期间 settingsConnectionStatus 直接返回隔离状态，不排账号读取', async () => {
  const f = fixture()
  f.runtime.blockCatalogOnCleanup('codex', new ProcessCleanupUnconfirmedError())
  const status = vi.spyOn(f.accounts, 'status')
  const snapshot = JSON.parse(await f.service.settingsConnectionStatus('parent', 'codex', control()))
  expect(snapshot.account).toMatchObject({ loading: false, value: { cli: 'codex', cleanupBlocked: true, state: 'unavailable', actions: [] } })
  expect(snapshot.catalog.loading).toBe(false)
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(status).not.toHaveBeenCalled(); expect(f.backend.spawn).not.toHaveBeenCalled()
})

it.each(['success', 'failure', 'cancel'] as const)('模拟：更新 %s 结束后不作废账号与模型显示（REQ-0136）', async outcome => {
  const f = fixture(); await checked(f.management); f.invalidateModels.mockClear()
  const child = childFixture(); vi.mocked(f.backend.spawn).mockReturnValue(child.child as any)
  const op = f.management.start('codex', 'update', f.management.snapshot().entries.find(e => e.cli === 'codex')!.planToken!, '', `模拟${outcome}`).operation!
  await until(() => vi.mocked(f.backend.spawn).mock.calls.length > 0)
  if (outcome === 'cancel') {
    f.management.cancel(op.id); await until(() => child.child.waitForExit.mock.calls.length > 0)
    child.finish(); child.exit(true)
  } else {
    if (outcome === 'success') f.identities.get('codex')!.manifestVersion = '1.2.3'
    child.finish(outcome === 'failure' ? 1 : 0); await until(() => child.child.waitForExit.mock.calls.length > 0)
    child.exit(true)
  }
  const result = (await finished(f.management)).results[0]!
  expect(result.phase).toBe(outcome === 'success' ? 'succeeded' : outcome === 'cancel' ? 'cancelled' : 'failed')
  expect(() => f.config.cliMaintenance.assertAvailable('codex')).not.toThrow()
  expect(f.invalidateModels).not.toHaveBeenCalled()
  // 版本指纹变化后再次本地检查，也不作废。
  f.identities.get('codex')!.fingerprint.mtimeMs += 1
  await checked(f.management)
  expect(f.invalidateModels).not.toHaveBeenCalled()
})
