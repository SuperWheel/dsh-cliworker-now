/** 模拟 Gateway、真实本机文件事务（临时 HOME）；没有账号或网络访问。 */
import { afterEach, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'
import { tmpdir } from 'node:os'
import { CliWorkerService } from '../src/host/index.ts'
import { AccountManager } from '../src/host/accounts.ts'
import { CliMaintenance } from '../src/host/cli-management/maintenance.ts'
import { CliManagementCache } from '../src/host/cli-management/cache.ts'
import { SettingsConnectionCache } from '../src/host/settings-connection-cache.ts'
import { CustomProviders } from '../src/host/custom-provider.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
import { CLI_IDS } from '../src/shared/types.ts'

vi.mock('node:os', async load => ({ ...await load<typeof import('node:os')>() }))

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0)) await close() })
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'custom-provider-remote-synthetic-')))
  const controller = new AbortController(), maintenance = new CliMaintenance(), connections = new SettingsConnectionCache()
  const backend = { spawn: vi.fn(), resolveExecutable: vi.fn() }
  const config = { ...DEFAULT_CONFIG, cliMaintenance: maintenance, stateDirectory: join(root, 'state') }
  const accounts = new AccountManager(backend, config)
  const cache = new CliManagementCache(join(root, 'state'))
  let revision = 1, entry: unknown = { mode: 'auto', path: '/synthetic/pi' }
  const effects: (() => Promise<void>)[] = []
  const parent = { id: 'parent', ctx: { effect: (setup: () => () => Promise<void>) => { const dispose = setup(); effects.push(dispose); return dispose } } }
  const runtime = { assertCliEnabled: vi.fn(), assertAccountIdle: vi.fn() }
  const catalogs = { invalidate: vi.fn() }
  const manager = new CustomProviders({ home: root, env: {}, stateDirectory: join(root, 'state') })
  const service = Object.assign(Object.create(CliWorkerService.prototype), {
    disposed: controller, accounts, accountParents: new Map(), customProviders: manager,
    options: { ...config, cliExecutablePaths: { read: () => entry, revision: () => revision } },
    runtime, assertExecution: vi.fn(), parent: vi.fn(async () => parent),
    connections, cliManagement: { cache }, settingsCatalogs: catalogs,
  }) as CliWorkerService
  const values = { providerId: 'custom-synthetic', baseUrl: 'https://synthetic.invalid/v1', api: 'openai-completions', apiKey: 'synthetic-remote-secret-789', models: ['synthetic-model'] }
  const form = async (cli = 'pi') => JSON.parse(await service.customProviderForm('parent', cli, controller.signal))
  const save = (token: string, input = values) => service.saveCustomProvider('parent', 'pi', token, JSON.stringify(input), controller.signal)
  cleanup.push(async () => { controller.abort(); manager.close(); await connections.close(); await accounts.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, service, form, save, values, runtime, maintenance, accounts, backend, connections, cache, catalogs, controller, effects,
    changeSource: () => { revision++; entry = { mode: 'manual', path: '/synthetic/changed-pi' } },
  }
}
it('模拟：两个 Remote 调用父会话校验；成功仅作废该 CLI 的账号和目录缓存，密钥不进快照或磁盘缓存', async () => {
  const f = fixture(), signal = f.controller.signal
  await f.connections.read(f.root, 'pi', 'account', signal, async () => ({ cli: 'pi', installed: true, state: 'configured', summary: '模拟账号', actions: [] }))
  await f.connections.read(f.root, 'pi', 'catalog', signal, async () => ({ binding: 'synthetic', catalog: { cli: 'pi', models: [] } } as any))
  await f.connections.read(f.root, 'codex', 'account', signal, async () => ({ cli: 'codex', installed: true, state: 'configured', summary: '其他 CLI', actions: [] }))
  f.cache.rememberAccount('pi', f.root, { cli: 'pi', installed: true, state: 'configured', summary: '模拟账号', actions: [] })
  const log = vi.spyOn(console, 'log'), warn = vi.spyOn(console, 'warn'), error = vi.spyOn(console, 'error')
  const form = await f.form(), result = await f.save(form.token)
  expect(JSON.parse(result)).toMatchObject({ ok: true })
  expect((f.service as any).parent).toHaveBeenCalledTimes(2)
  expect(f.connections.fresh(f.root, 'pi', 'account')).toBeUndefined(); expect(f.connections.fresh(f.root, 'pi', 'catalog')).toBeUndefined()
  expect(f.connections.fresh(f.root, 'codex', 'account')).toBeDefined()
  expect(f.cache.accountRevision('pi')).toBe(1); expect(f.catalogs.invalidate).toHaveBeenCalledWith('pi')
  expect(JSON.stringify(f.connections.snapshot(f.root)) + result + JSON.stringify(form)).not.toContain(f.values.apiKey)
  // CliManagementCache itself persists no submitted values; the only call is invalidation.
  const cacheFile = (f.cache as any).file as string
  if (cacheFile && existsSync(cacheFile)) expect(readFileSync(cacheFile, 'utf8')).not.toContain(f.values.apiKey)
  expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled()
  expect(f.backend.spawn).not.toHaveBeenCalled(); expect(f.accounts.isBusy('pi')).toBe(false)
})
it('模拟：过期入口拒绝写入，不失效已存在缓存且租约释放', async () => {
  const f = fixture(), form = await f.form(); f.changeSource()
  expect(JSON.parse(await f.save(form.token))).toMatchObject({ ok: false })
  expect(f.catalogs.invalidate).not.toHaveBeenCalled(); expect(existsSync(join(f.root, '.pi'))).toBe(false)
  const release = f.maintenance.begin('pi', () => ({ workers: 0, accounts: f.accounts.isBusy('pi') })); release()
})
it('模拟：保存后缓存磁盘失败仍作废内存两槽，不把已保存误报成未写入', async () => {
  const f = fixture(), form = await f.form()
  await f.connections.read(f.root, 'pi', 'account', f.controller.signal, async () => ({ cli: 'pi', installed: true, state: 'configured', summary: '模拟旧值', actions: [] }))
  vi.spyOn(f.cache as any, 'save').mockImplementation(() => { throw new Error(f.values.apiKey) })
  const result = await f.save(form.token)
  expect(JSON.parse(result)).toMatchObject({ ok: true, notice: expect.stringContaining('显示缓存持久化失败') })
  expect(result).not.toContain(f.values.apiKey)
  expect(f.connections.fresh(f.root, 'pi', 'account')).toBeUndefined()
  expect(f.catalogs.invalidate).toHaveBeenCalledWith('pi'); expect(f.cache.accountRevision('pi')).toBe(1)
})
it('模拟：坏 JSON 和字段失败返回安全 issues，允许修正后复用同一表单', async () => {
  const f = fixture(), form = await f.form()
  const malformed = await f.service.saveCustomProvider('parent', 'pi', form.token, `{"secret":"${f.values.apiKey}`, f.controller.signal)
  expect(JSON.parse(malformed)).toMatchObject({ ok: false }); expect(malformed).not.toContain(f.values.apiKey)
  expect(JSON.parse(await f.save(form.token, { ...f.values, baseUrl: 'javascript:alert(1)' }))).toMatchObject({ ok: false, issues: [{ field: 'baseUrl' }] })
  expect(JSON.parse(await f.save(form.token))).toMatchObject({ ok: true })
})
it('模拟：维护中、禁用、清理暂停及在运行任务均不能绕过账号写入准入', async () => {
  const f = fixture(), form = await f.form()
  const release = f.maintenance.begin('pi', () => ({ workers: 0, accounts: false }))
  await expect(f.save(form.token)).rejects.toThrow('MAINTENANCE'); release()
  f.runtime.assertCliEnabled.mockImplementationOnce(() => { throw new Error('disabled') })
  await expect(f.save(form.token)).rejects.toThrow('disabled')
  for (const message of ['cleanup paused', 'worker running']) {
    f.runtime.assertAccountIdle.mockImplementationOnce(() => { throw new Error(message) })
    await expect(f.save(form.token)).rejects.toThrow(message)
  }
  expect(f.accounts.isBusy('pi')).toBe(false); expect(existsSync(join(f.root, '.pi'))).toBe(false)
})
it('模拟：宿主规划/只读拒绝写入；已取消请求和 Host 关闭不修改文件', async () => {
  const f = fixture(), form = await f.form()
  ;(f.service as any).assertExecution.mockImplementationOnce(() => { throw new Error('plan mode') })
  await expect(f.save(form.token)).rejects.toThrow('plan mode')
  const aborted = AbortSignal.abort()
  await expect(f.service.saveCustomProvider('parent', 'pi', form.token, JSON.stringify(f.values), aborted)).rejects.toThrow()
  f.controller.abort(); await expect(f.save(form.token)).rejects.toThrow()
  expect(existsSync(join(f.root, '.pi'))).toBe(false)
})
it('模拟：读表单不占账号 reservation；保存与终端、查询、更新互斥，释放幂等', async () => {
  const f = fixture(), form = await f.form(), release = f.accounts.reserveCustomProvider('pi')
  expect(f.accounts.isBusy('pi')).toBe(true)
  expect(await f.form()).not.toBeNull()
  expect(f.accounts.isBusy('pi')).toBe(true)
  await expect(f.save(form.token)).rejects.toThrow('账号操作')
  expect(() => f.accounts.reserveCustomProvider('pi')).toThrow()
  expect(() => f.maintenance.begin('pi', () => ({ workers: 0, accounts: f.accounts.isBusy('pi') }))).toThrow('CLI_BUSY')
  release(); release(); expect(f.accounts.isBusy('pi')).toBe(false)
  let finish!: () => void
  const query = { cli: 'pi', settled: false, operation: new Promise<void>(resolve => { finish = () => { query.settled = true; resolve() } }) }
  ;(f.accounts as any).statusQueries.set('synthetic', query)
  expect(await f.form()).not.toBeNull()
  let saved = false
  const pending = f.save((await f.form()).token).then(value => { saved = true; return value })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(saved).toBe(false)
  finish(); (f.accounts as any).statusQueries.clear()
  await pending
  expect(saved).toBe(true)
  expect(f.accounts.isBusy('pi')).toBe(false)
})
it('模拟：父会话释放作废 token；新父会话无法重用旧 token', async () => {
  const f = fixture(), form = await f.form()
  await f.effects[0]!()
  expect(JSON.parse(await f.save(form.token))).toMatchObject({ ok: false })
  const newForm = await f.form()
  ;(f.service as any).parent.mockResolvedValueOnce({ id: 'another-parent', ctx: { effect: () => async () => {} } })
  expect(JSON.parse(await f.save(newForm.token))).toMatchObject({ ok: false })
})
it('模拟：未核实 CLI 表单统一为 null；非法 CLI 和无效 parent 拒绝', async () => {
  const f = fixture()
  for (const cli of CLI_IDS.filter(id => !['pi', 'hermes', 'opencode'].includes(id))) expect(await f.form(cli)).toBeNull()
  await expect(f.form('invalid')).rejects.toThrow()
  ;(f.service as any).parent.mockRejectedValueOnce(new Error('missing parent'))
  await expect(f.form()).rejects.toThrow('missing parent')
  expect(f.backend.spawn).not.toHaveBeenCalled()
})

it('模拟：Host 实际创建表单管理器时传入运行配置的 stateDirectory', async () => {
  const f = fixture()
  vi.spyOn(os, 'homedir').mockReturnValue(f.root)
  // Exercise production manager creation rather than the pre-injected synthetic manager.
  ;(f.service as any).customProviders = undefined
  const form = await f.form()
  expect(form.target).toBe(`${join(f.root, 'state/accounts/pi/agent/models.json')} + ${join(f.root, 'state/accounts/pi/agent/auth.json')}`)
  expect(existsSync(join(f.root, 'state/accounts/pi'))).toBe(false)
  expect(JSON.parse(await f.save(form.token))).toMatchObject({ ok: true })
  expect(JSON.parse(readFileSync(join(f.root, 'state/accounts/pi/agent/auth.json'), 'utf8'))['custom-synthetic']).toEqual({ type: 'api_key', key: f.values.apiKey })
  expect(existsSync(join(f.root, '.pi'))).toBe(false)
  ;(f.service as any).customProviders.close()
})
