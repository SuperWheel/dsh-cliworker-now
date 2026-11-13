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
