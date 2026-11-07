import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { AccountManager } from '../src/host/accounts.ts'
import { captureTraecnMetadata, parseTraecnAccount, traecnAccountArguments, discoverTraecnModels } from '../src/host/traecn-accounts.ts'
import { loginProviders } from '../src/host/account-guide/providers.ts'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
import { catalogFor, validatePreference } from '../src/host/adapters.ts'
import { authorizeSelection } from '../src/host/authorized-catalog.ts'
import { ACCOUNT_LOGIN_HOSTS, SINGLE_ACCOUNT_CLIS, GUIDED_ACCOUNT_CLIS } from '../src/shared/account-links.ts'
import { traecnMetadata } from './fixtures/traecn-metadata.ts'
const roots: string[] = []
const signal = () => new AbortController().signal
const managers: AccountManager[] = []
afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.close())); vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'traecn-SIMULATED-account-'))); roots.push(root)
  vi.stubEnv('TRAE_HOME', root); vi.stubEnv('TRAECLI_HOST', ''); vi.stubEnv('TRAECLI_PERSONAL_ACCESS_TOKEN', '')
  const path = join(root, 'cli/auth.json'); await mkdir(join(root, 'cli'))
  const value = { auth_mode: 'trae', trae: { user_id: 'SIMULATED-user', region: 'cn', login_method: 'personal', credential_kind: 'oauth',
    endpoints: { api_base_url: 'https://api.example.invalid' }, access_token: 'SIMULATED-access-secret', refresh_token: 'SIMULATED-refresh-secret', personal_device: 'SIMULATED-private-device' } }
  const write = () => writeFile(path, JSON.stringify(value), { mode: 0o600 })
  const f = traecnMetadata()
  const binding = () => readCliAccountBinding('traecn', f.backend, DEFAULT_CONFIG, root, signal())
  return { root, path, value, write, binding, ...f }
}
describe('模拟：TRAE 原生账号与模型目录', () => {
  it.each([
    ['Logged in using Trae\n', 'authenticated', '已登录 TRAE（CLI 不区分个人与企业账号）'],
    ['Not logged in\n', 'unconfigured', 'TRAE CN 未登录'],
    ['模拟 unknown output', 'unknown', '无法确认 TRAE CN 登录状态'],
    ['Current Trae enterprise plan does not support CLI usage.', 'unavailable', 'Current Trae enterprise plan does not support CLI usage.'],
  ])('parses %s without inferring account type', (output, state, summary) => {
    expect(parseTraecnAccount(output)).toEqual({ state, summary, verification: 'cli' })
  })
  it('exposes only login/logout and three provider choices, with native domains', async () => {
    const f = await fixture()
    f.backend.spawnTerminal = vi.fn() as any
    const manager = new AccountManager(f.backend, DEFAULT_CONFIG); managers.push(manager)
    const status = await manager.status('traecn', f.root, signal())
    expect(status).toMatchObject({ installed: true, state: 'authenticated', verification: 'cli' })
    expect(status.actions.map(a => a.id)).toEqual(['login', 'logout'])
    expect(status.actions[0]?.providers?.map(p => p.id)).toEqual(['personal', 'enterprise', 'enterprise-pat'])
    expect(loginProviders('traecn', undefined)?.[0]?.label).toContain('开发中特性')
    expect(ACCOUNT_LOGIN_HOSTS.traecn).toEqual(['trae.cn', 'www.trae.cn', 'api.trae.com.cn'])
    expect(SINGLE_ACCOUNT_CLIS.has('traecn')).toBe(true); expect(GUIDED_ACCOUNT_CLIS.has('traecn')).toBe(false)
    expect(() => manager.start('SIMULATED-parent', 'traecn', 'login', f.root, signal())).toThrow('不支持的登录方式')
    expect(() => manager.start('SIMULATED-parent', 'traecn', 'manage', f.root, signal())).toThrow('仅支持登录和退出')
    expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
  })
  it.each([
    ['personal', ['--enable', 'personal_user_login', 'login', '--personal']],
    ['enterprise', ['login', '--enterprise']],
    ['enterprise-pat', ['login', '--with-trae-pat']],
  ] as const)('builds exact %s provider argv and dispatches it to native terminal', async (provider, argv) => {
    expect(traecnAccountArguments('login', provider)).toEqual(argv)
    const f = await fixture(), output = new PassThrough()
    let finish!: (value: any) => void
    const done = new Promise<any>(resolve => { finish = resolve })
    const end = () => { output.end(); finish({ exitCode: 0, signal: null }) }
    f.backend.spawnTerminal = vi.fn(async () => ({ output, done, terminate: end, waitForExit: async () => true,
      write: vi.fn(), resize: vi.fn() })) as any
    const manager = new AccountManager(f.backend, DEFAULT_CONFIG); managers.push(manager)
    const opened = await manager.start('SIMULATED-parent', 'traecn', 'login', f.root, signal(), undefined, provider)
    expect(vi.mocked(f.backend.spawnTerminal!).mock.calls[0]?.[0].argv).toEqual(['traecli', ...argv])
    if (provider === 'enterprise-pat') expect(opened.instruction).toContain('插件不保存')
    await manager.close()
  })
  it('uses logout only and rejects missing or unsupported provider', () => {
    expect(traecnAccountArguments('logout')).toEqual(['logout'])
    expect(() => traecnAccountArguments('login')).toThrow('不支持的登录方式')
    expect(() => traecnAccountArguments('login', 'guessed')).toThrow('不支持的登录方式')
  })
  it.each([false, true])('distinguishes empty directory signed-in=%s', async authenticated => {
    const f = traecnMetadata(argv => ({ output: argv.includes('--version') ? 'traecli 0.213.1\ninstallation: public' :
      argv.includes('status') ? authenticated ? 'Logged in using Trae' : 'Not logged in' : '[]', exitCode: !authenticated && argv.includes('status') ? 1 : 0 }))
    await expect(catalogFor('traecn', f.backend, DEFAULT_CONFIG, '/模拟', signal()))
      .rejects.toThrow(authenticated ? '当前账号暂无可确认模型' : '未登录')
    expect(f.calls.some(call => call.argv.includes('models'))).toBe(authenticated)
    expect(f.calls.some(call => call.argv.includes('acp'))).toBe(false)
  })
  it('returns native config_name/name without efforts and authorizes default sentinel', async () => {
    const f = await fixture(); await f.write()
    const metadata = traecnMetadata(argv => ({ output: argv.includes('--version') ? 'traecli 0.213.1\ninstallation: public' :
      argv.includes('status') ? 'Logged in using Trae' : JSON.stringify([{ config_name: 'SIMULATED-model', name: '模拟模型' }]) }))
    const authorized = await authorizeSelection({ cli: 'traecn', model: 'SIMULATED-model', effort: 'default' }, metadata.backend, DEFAULT_CONFIG, f.root, signal())
    expect(authorized.catalog.models).toEqual([{ id: 'SIMULATED-model', label: '模拟模型', efforts: ['default'] }])
    expect(authorized.catalog.notice).toContain('不提供强度选择')
    expect(() => validatePreference({ cli: 'traecn', model: 'SIMULATED-model', effort: 'high' }, authorized.catalog)).toThrow()
    f.value.trae.user_id = 'SIMULATED-other'; await f.write()
    await expect(authorizeSelection(authorized.preference, metadata.backend, DEFAULT_CONFIG, f.root, signal(), authorized.binding)).rejects.toThrow('账号已变更')
  })
  it('preserves native plan-unsupported reason and rejects malformed models', async () => {
    for (const output of ['Current Trae enterprise plan does not support CLI usage.', '[{"name":"模拟 missing id"}]']) {
      const f = traecnMetadata(argv => ({ output: argv.includes('status') ? 'Logged in using Trae' : output }))
      await expect(discoverTraecnModels(f.backend, DEFAULT_CONFIG, 'traecli', '/模拟', signal()))
        .rejects.toThrow(output.startsWith('Current') ? output : '目录格式无效')
    }
  })
})
describe('模拟：TRAE 只绑定指定的稳定主体字段', () => {
  it('hashes stable identity, ignores credential rotation and changes for user_id', async () => {
    const f = await fixture(); await f.write()
    const first = await f.binding()
    expect(first).toMatch(/^cli-account-v1:[a-f0-9]{64}$/)
    f.value.trae.access_token = 'SIMULATED-rotated-access'; f.value.trae.refresh_token = 'SIMULATED-rotated-refresh'; f.value.trae.personal_device = 'SIMULATED-rotated-device'
    await f.write(); expect(await f.binding()).toBe(first)
    f.value.trae.user_id = 'SIMULATED-other-user'; await f.write(); expect(await f.binding()).not.toBe(first)
    expect(first).not.toMatch(/SIMULATED|secret|token|device/)
    expect(f.spawn).not.toHaveBeenCalled()
  })
  it.each(['auth_mode', 'region', 'login_method', 'credential_kind', 'api_base_url'])('invalidates %s changes', async field => {
    const f = await fixture(); await f.write(); const before = await f.binding()
    if (field === 'auth_mode') f.value.auth_mode = 'changed'
    else if (field === 'api_base_url') f.value.trae.endpoints.api_base_url = 'https://other.example.invalid'
    else (f.value.trae as any)[field] = 'changed'
    await f.write(); expect(await f.binding()).not.toBe(before)
  })
  it.each(['TRAECLI_PERSONAL_ACCESS_TOKEN', 'TRAECLI_HOST'])('hashes route %s without exposing it', async name => {
    const f = await fixture(); await f.write(); const before = await f.binding()
    vi.stubEnv(name, 'SIMULATED-route-secret'); const after = await f.binding()
    expect(after).not.toBe(before); expect(after).not.toContain('SIMULATED-route-secret')
  })
  it('rejects missing, oversized and symlink auth files', async () => {
    const f = await fixture(); await expect(f.binding()).rejects.toThrow('TRAE CN 未登录')
    await writeFile(f.path, ' '.repeat(65537)); await expect(f.binding()).rejects.toThrow()
    await rm(f.path); const target = join(f.root, 'target.json'); await writeFile(target, JSON.stringify(f.value)); await symlink(target, f.path)
    await expect(f.binding()).rejects.toThrow()
  })
})

it('模拟：账号入口保留 TRAE 身份不符提示，不误称 Pi', async () => {
  const f = await fixture()
  const wrong = traecnMetadata(() => ({ output: 'trae-agent 1.0.0' }))
  const manager = new AccountManager(wrong.backend, DEFAULT_CONFIG); managers.push(manager)
  expect(await manager.status('traecn', f.root, signal())).toMatchObject({ state: 'unavailable', summary: '不是官方 TRAE CLI，请检查 traecnExecutable' })
})

it('模拟：取消元数据查询先确认进程范围退出，清理失败不能变成普通账号错误', async () => {
  for (const exits of [true, false]) {
    const stdout = new PassThrough(), stderr = new PassThrough(), controller = new AbortController()
    let settle!: (value: any) => void
    const done = new Promise<any>(resolve => { settle = resolve })
    const terminate = vi.fn(), waitForExit = vi.fn(async () => exits)
    const backend: any = { spawn: vi.fn((spec: any) => {
      spec.signal.addEventListener('abort', () => { stdout.end(); stderr.end(); settle({ exitCode: null, signal: 'SIGTERM' }) }, { once: true })
      return { stdout, stderr, done, terminate, waitForExit }
    }) }
    const pending = captureTraecnMetadata(backend, DEFAULT_CONFIG, ['SIMULATED-traecli', 'login', 'status'], '/模拟', controller.signal, 10000)
    controller.abort(new Error('模拟取消'))
    await expect(pending).rejects.toMatchObject(exits ? { message: '模拟取消' } : { name: 'ProcessCleanupUnconfirmedError' })
    expect(terminate).toHaveBeenCalledOnce(); expect(waitForExit).toHaveBeenCalledOnce()
  }
})
