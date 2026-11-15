/** 模拟：全部文件都在临时 HOME，不读取真实账号、不启动 CLI、不调用模型。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import * as os from 'node:os'
import { dirname, join } from 'node:path'
import { parse as yaml } from 'yaml'
import { CustomProviders, type CustomProviderSource } from '../src/host/custom-provider.ts'
import { snapshotPiOmpNative } from '../src/host/pi-omp-native.ts'
import { effectiveHermesHome, prepareHermesAccountHome } from '../src/host/hermes-account-context.ts'
import { assertHermesOwnAccounts } from '../src/host/hermes-models.ts'
import { prepareHermes } from '../src/host/hermes-adapter.ts'
import { openCodeAuthDirectory, prepareOpenCode } from '../src/host/opencode-adapter.ts'
import { readOpenCodeProfile } from '../src/host/opencode-native.ts'
import { nativeJson } from '../src/host/custom-provider-files.ts'

vi.mock('node:fs', async load => ({ ...await load<typeof import('node:fs')>() }))
vi.mock('node:os', async load => ({ ...await load<typeof import('node:os')>() }))
// Synthetic executable identity only: launch preparation never starts a process.
vi.mock('../src/host/hermes-installation.ts', () => ({
  verifyHermesExecutable: async () => undefined,
  hermesNativeCommand: async (executable: string, args: string[]) => [executable, ...args],
  hermesCommandInstallationHome: () => undefined,
}))
const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
const secret = 'synthetic-provider-credential-4x9'
const write = (file: string, text: string) => { fs.mkdirSync(dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, text, { mode: 0o600 }) }
function fixture(cli: 'pi' | 'opencode' | 'hermes', existing = true, privateHermes = true) {
  const home = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'custom-provider-synthetic-'))); roots.push(home)
  vi.spyOn(os, 'homedir').mockReturnValue(home)
  const stateDirectory = join(home, 'plugin-state')
  if (cli === 'hermes' && privateHermes) write(join(stateDirectory, 'accounts/hermes-source.json'), '{"version":1,"source":"plugin-native"}\n')
  const hermesHome = privateHermes ? join(stateDirectory, 'accounts/hermes') : join(home, '.hermes')
  const manager = new CustomProviders({ home, env: {}, stateDirectory })
  const source: CustomProviderSource = { cli, parent: 'parent', entry: { mode: 'auto', path: `/synthetic/${cli}` }, revision: 3 }
  const config = cli === 'pi' ? join(stateDirectory, 'accounts/pi/agent/models.json') : cli === 'hermes' ? join(hermesHome, 'config.yaml') : join(stateDirectory, 'accounts/opencode/config/opencode/opencode.json')
  const auth = cli === 'pi' ? join(stateDirectory, 'accounts/pi/agent/auth.json') : cli === 'hermes' ? join(hermesHome, '.env') : join(stateDirectory, 'accounts/opencode/data/opencode/auth.json')
  const configBefore = cli === 'hermes' ? '# keep this comment\nmodel: old-model\nproviders:\n  old:\n    api: https://old.invalid/v1\n    models: { old-model: {} }\n' : '{\r\n\t"untouched": { "spacing" : 42 },\r\n\t"' + (cli === 'pi' ? 'providers' : 'provider') + '": {"old": {"name":"Old"}}\r\n}\r\n'
  const authBefore = cli === 'hermes' ? '# keep original env\nOLD_KEY=synthetic-old\n' : '{ "old": {"type":"oauth","access":"synthetic-old","refresh":"synthetic-refresh","expires":9999999999999} }\n'
  if (existing) { write(config, configBefore); write(auth, authBefore) }
  const input = { providerId: 'custom-demo', providerLabel: 'Demo provider', baseUrl: 'https://gateway.invalid/v1', api: cli === 'pi' ? 'openai-completions' : cli === 'hermes' ? 'chat_completions' : '@ai-sdk/openai-compatible', apiKey: secret, models: ['model-a', 'model-b'] }
  const form = manager.form(source)!
  const save = (values: unknown = input, guard = () => {}) => manager.save(source, form.token, JSON.stringify(values), guard)
  const unchanged = () => { expect(fs.readFileSync(config, 'utf8')).toBe(configBefore); expect(fs.readFileSync(auth, 'utf8')).toBe(authBefore) }
  return { home, stateDirectory, manager, source, config, auth, input, form, save, unchanged, configBefore, authBefore }
}

describe.each(['pi', 'opencode', 'hermes'] as const)('%s 原生文件（模拟）', cli => {
  it('成功写入原生格式，保留其他字段、注释/格式，密钥只在原生凭据文件', () => {
    const f = fixture(cli)
    const log = vi.spyOn(console, 'log'), error = vi.spyOn(console, 'error'), warn = vi.spyOn(console, 'warn')
    const result = f.save()
    expect(result).toMatchObject({ ok: true, cli, providerId: 'custom-demo' })
    expect(JSON.stringify(result) + JSON.stringify(f.form)).not.toContain(secret)
    const configText = fs.readFileSync(f.config, 'utf8'), authText = fs.readFileSync(f.auth, 'utf8')
    expect(configText).not.toContain(secret); expect(authText).toContain(secret)
    if (cli === 'hermes') {
      expect(configText).toContain('# keep this comment')
      expect(yaml(configText)).toMatchObject({ model: 'old-model', providers: { old: { api: 'https://old.invalid/v1' }, 'custom-demo': { api: f.input.baseUrl, api_mode: 'chat_completions', models: { 'model-a': {}, 'model-b': {} } } } })
      const variable = yaml(configText).providers['custom-demo'].key_env
      expect(authText).toBe(f.authBefore + `${variable}='${secret}'\n`)
    } else {
      expect(configText).toContain('"untouched": { "spacing" : 42 }')
      expect(configText).toContain('\r\n\t'); expect(nativeJson(authText).value.old).toEqual(nativeJson(f.authBefore).value.old)
      const config = nativeJson(configText).value as any
      if (cli === 'pi') {
        expect(config.providers['custom-demo']).toEqual({ name: 'Demo provider', baseUrl: f.input.baseUrl, api: 'openai-completions', models: [{ id: 'model-a' }, { id: 'model-b' }] })
        expect(nativeJson(authText).value['custom-demo']).toEqual({ type: 'api_key', key: secret })
      } else {
        expect(config.provider['custom-demo']).toEqual({ name: 'Demo provider', npm: '@ai-sdk/openai-compatible', options: { baseURL: f.input.baseUrl }, models: { 'model-a': { name: 'model-a' }, 'model-b': { name: 'model-b' } } })
        expect(nativeJson(authText).value['custom-demo']).toEqual({ type: 'api', key: secret })
      }
    }
    expect(fs.statSync(f.auth).mode & 0o777).toBe(0o600)
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled()
    expect(f.save()).toMatchObject({ ok: false }) // token consumed
  })
  it('从空 HOME 创建配置并使用私有目录与凭据权限', () => {
    const f = fixture(cli, false)
    expect(f.save()).toMatchObject({ ok: true })
    expect(fs.statSync(dirname(f.auth)).mode & 0o777).toBe(0o700)
    expect(fs.statSync(f.auth).mode & 0o777).toBe(0o600)
  })
  it('名称冲突返回逐字段问题且原文件不变', () => {
    const f = fixture(cli)
    expect(f.save({ ...f.input, providerId: 'old' })).toMatchObject({ ok: false, issues: [{ field: 'providerId' }] })
    f.unchanged()
  })
  it('回滚新文件时不留下首次创建的凭据', () => {
    const f = fixture(cli, false), rename = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (to === f.config) throw new Error('synthetic disk failure')
      rename(from, to)
    })
    expect(f.save()).toMatchObject({ ok: false })
    expect(fs.existsSync(f.auth)).toBe(false); expect(fs.existsSync(f.config)).toBe(false)
  })
  it('必填、URL、API 与模型列表校验失败不改文件', () => {
    const f = fixture(cli)
    const result = f.save({ providerId: '../escape', baseUrl: 'file:///secret', api: 'other-cli-api', apiKey: '', models: [] })
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.issues.map(x => x.field)).toEqual(expect.arrayContaining(['providerId', 'baseUrl', 'api', 'apiKey', 'models']))
    f.unchanged()
  })
  it('第二个 rename 失败时恢复已写凭据，清除临时文件', () => {
    const f = fixture(cli), rename = fs.renameSync
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (to === f.config && String(from).endsWith('.tmp')) throw new Error(secret)
      return rename(from, to)
    })
    const result = f.save()
    expect(result).toMatchObject({ ok: false }); expect(JSON.stringify(result)).not.toContain(secret)
    f.unchanged(); expect(spy).toHaveBeenCalledTimes(3)
    expect(fs.readdirSync(dirname(f.auth))).not.toEqual(expect.arrayContaining([expect.stringMatching(/\.(tmp|bak|lock)$/)]))
  })
  it('中途取消同样回滚，保留原文', () => {
    const f = fixture(cli); let calls = 0
    const result = f.save(f.input, () => { if (++calls === 3) throw new Error('synthetic cancellation') })
    expect(result).toMatchObject({ ok: false }); f.unchanged()
  })
  it('暂存写入失败不改配置，也不暴露底层异常中的密钥', () => {
    const f = fixture(cli)
    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => { throw new Error(secret) })
    const result = f.save()
    expect(result).toMatchObject({ ok: false }); expect(JSON.stringify(result)).not.toContain(secret)
    f.unchanged()
  })
  it('拒绝把密钥放入公共元数据或结果', () => {
    const f = fixture(cli)
    const result = f.save({ ...f.input, providerId: secret, models: [secret] })
    expect(result).toMatchObject({ ok: false }); expect(JSON.stringify(result)).not.toContain(secret); f.unchanged()
  })
  it('配置在提交前被外部编辑，拒绝覆盖该编辑', () => {
    const f = fixture(cli); let calls = 0
    const result = f.save(f.input, () => { if (++calls === 1) write(f.config, f.configBefore + '\n') })
    expect(result).toMatchObject({ ok: false }); expect(fs.readFileSync(f.config, 'utf8')).toBe(f.configBefore + '\n')
    expect(fs.readFileSync(f.auth, 'utf8')).toBe(f.authBefore)
  })
})

it('模拟：其他 CLI、缺失已记录入口返回 null', () => {
  const f = fixture('pi')
  for (const cli of ['omp', 'kimi', 'traecn', 'codex', 'harness'] as const) expect(f.manager.form({ ...f.source, cli })).toBeNull()
  expect(f.manager.form({ ...f.source, entry: undefined })).toBeNull()
})
it('模拟：token 绑定 parent、CLI、入口及 revision，过期和生命周期清理均拒绝', () => {
  const f = fixture('pi')
  for (const patch of [{ parent: 'other' }, { cli: 'hermes' as const }, { revision: 4 }, { entry: { mode: 'manual', path: '/changed' } }]) {
    const form = f.manager.form(f.source)!
    expect(f.manager.save({ ...f.source, ...patch }, form.token, JSON.stringify(f.input), () => {})).toMatchObject({ ok: false })
  }
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600_001)
  expect(f.save()).toMatchObject({ ok: false }); clock.mockRestore()
  const token = f.manager.form(f.source)!.token
  f.manager.closeParent(f.source.parent)
  expect(f.manager.save(f.source, token, JSON.stringify(f.input), () => {})).toMatchObject({ ok: false })
  const next = f.manager.form(f.source)!.token; f.manager.close()
  expect(f.manager.save(f.source, next, JSON.stringify(f.input), () => {})).toMatchObject({ ok: false }); f.unchanged()
})
it('模拟：JSONC 保留注释、尾逗号、旧字段；重复键及非法内容拒绝', () => {
  const f = fixture('opencode')
  const text = '{\n // outer\n "untouched": [1, true, null,],\n "provider": {"old": {"name":"Old"}, /* keep */},\n}\n'
  fs.unlinkSync(f.config); write(f.config + 'c', text)
  const token = f.manager.form(f.source)!.token
  expect(f.manager.save(f.source, token, JSON.stringify(f.input), () => {})).toMatchObject({ ok: true })
  const result = fs.readFileSync(f.config + 'c', 'utf8')
  expect(result).toContain('// outer'); expect(result).toContain('/* keep */'); expect(result).toContain('"untouched": [1, true, null,]')
  expect((nativeJson(result).value.provider as any)['custom-demo'].npm).toBe('@ai-sdk/openai-compatible')
  for (const text of ['{"x":1,"x":2}', '{"x":}', '{"x":1', '[]', 'null', '{} trailing', '{/* unterminated']) expect(() => nativeJson(text)).toThrow()
})
it('模拟：Pi 原生账号锁拒绝覆盖，命令/环境插值字符按字面值保存', () => {
  const f = fixture('pi'); fs.mkdirSync(f.auth + '.lock')
  expect(f.save()).toMatchObject({ ok: false }); f.unchanged(); fs.rmdirSync(f.auth + '.lock')
  expect(f.save({ ...f.input, apiKey: '!danger${VALUE}' })).toMatchObject({ ok: true })
  expect((nativeJson(fs.readFileSync(f.auth, 'utf8')).value['custom-demo'] as any).key).toBe('$!danger$${VALUE}')
})
it.each([
  ['没有顶层 providers', '# keep this comment\nmodel: old-model\nterminal:\n  timeout: 60\n'],
  ['providers 为空值', '# keep this comment\nmodel: old-model\nproviders:\n  # my-proxy:\n  #   key_env: X\nterminal:\n  timeout: 60\n'],
])('模拟：Hermes 官方配置%s时新建 providers 并保留其他字段', (_name, text) => {
  const f = fixture('hermes'); write(f.config, text)
  expect(f.save()).toMatchObject({ ok: true, providerId: 'custom-demo' })
  const configText = fs.readFileSync(f.config, 'utf8')
  expect(configText).toContain('# keep this comment')
  expect(yaml(configText)).toMatchObject({ model: 'old-model', terminal: { timeout: 60 }, providers: { 'custom-demo': { api: f.input.baseUrl, api_mode: 'chat_completions', models: { 'model-a': {}, 'model-b': {} } } } })
})
it('模拟：Hermes 拒绝 dotenv 插值以及原生/Host 解析不一致的转义密钥', () => {
  const f = fixture('hermes')
  expect(f.save({ ...f.input, apiKey: '${OTHER_KEY}' })).toMatchObject({ ok: false }); f.unchanged()
  expect(f.save({ ...f.input, apiKey: "synthetic'\\key" })).toMatchObject({ ok: false, issues: [{ field: 'apiKey' }] }); f.unchanged()
})
it('模拟：符号链接凭据文件失败关闭且不修改链接目标', () => {
  const f = fixture('pi'), target = join(f.home, 'target.json')
  fs.renameSync(f.auth, target); fs.symlinkSync(target, f.auth)
  expect(f.save()).toMatchObject({ ok: false }); expect(fs.readFileSync(target, 'utf8')).toBe(f.authBefore)
})
it('模拟：显式配置覆盖、双全局配置与命名 profile 保留原生终端', () => {
  const f = fixture('opencode')
  expect(new CustomProviders({ home: f.home, env: { OPENCODE_CONFIG_CONTENT: '{}' } }).form(f.source)).toBeNull()
  write(f.config + 'c', '{}'); expect(f.manager.form(f.source)).toBeNull()
  expect(new CustomProviders({ home: f.home, env: { HERMES_PROFILE: 'work' } }).form({ ...f.source, cli: 'hermes' })).toBeNull()
  expect(new CustomProviders({ home: f.home, env: { PI_CODING_AGENT_DIR: '/other' } }).form({ ...f.source, cli: 'pi' })).toBeNull()
})
it('模拟：回滚再次失败保留私有备份并明确报告，不输出凭据', () => {
  const f = fixture('pi'), rename = fs.renameSync
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (to === f.config || String(from).endsWith('.bak')) throw new Error(secret)
    rename(from, to)
  })
  const result = f.save()
  expect(result).toMatchObject({ ok: false, issues: [{ message: expect.stringContaining('回滚未完成') }] })
  expect(JSON.stringify(result)).not.toContain(secret)
  const backup = fs.readdirSync(dirname(f.auth)).find(name => name.startsWith('auth.json.') && name.endsWith('.bak'))!
  expect(fs.readFileSync(join(dirname(f.auth), backup), 'utf8')).toBe(f.authBefore)
  expect(fs.statSync(join(dirname(f.auth), backup)).mode & 0o777).toBe(0o600)
})
it('模拟：凭据独有名称、显示名称与 Hermes 旧 custom_providers 均禁止覆盖', () => {
  const pi = fixture('pi')
  write(pi.config, '{}')
  expect(pi.save({ ...pi.input, providerId: 'old' })).toMatchObject({ ok: false, issues: [{ field: 'providerId' }] })
  const oc = fixture('opencode')
  expect(oc.save({ ...oc.input, providerLabel: 'Old' })).toMatchObject({ ok: false }); oc.unchanged()
  const h = fixture('hermes'); write(h.config, 'custom_providers:\n  - name: custom-demo\n    base_url: https://old.invalid/v1\n')
  expect(h.save()).toMatchObject({ ok: false, issues: [{ field: 'providerId' }] })
})
it('模拟：拒绝 URL 凭据、参数、片段、反斜杠及无双斜杠形式', () => {
  const f = fixture('pi')
  for (const baseUrl of ['https://u:p@host.invalid', 'https://host.invalid?token=value', 'https://host.invalid#part', 'https:host.invalid', 'https://host.invalid\\path']) {
    expect(f.save({ ...f.input, baseUrl })).toMatchObject({ ok: false, issues: [{ field: 'baseUrl' }] })
  }
  f.unchanged()
})
it('模拟：损坏 JSON、v2 OpenCode 配置和 Hermes 环境重定向均不写入', () => {
  const f = fixture('opencode')
  for (const text of ['{secret:'+secret, '{"providers":{}}']) {
    write(f.config, text)
    const result = f.save()
    expect(result).toMatchObject({ ok: false }); expect(JSON.stringify(result)).not.toContain(secret)
    expect(fs.readFileSync(f.config, 'utf8')).toBe(text); expect(fs.readFileSync(f.auth, 'utf8')).toBe(f.authBefore)
  }
  const h = fixture('hermes'); write(h.auth, 'HERMES_HOME=/other\n')
  expect(h.save()).toMatchObject({ ok: false }); expect(fs.readFileSync(h.config, 'utf8')).toBe(h.configBefore)
})

it.each([true, false])('模拟：Pi 私有账号已存在=%s，表单目标与 Worker 快照一致，全局账号保持原样', async existing => {
  const f = fixture('pi', existing), global = join(f.home, '.pi', 'agent')
  const configBefore = JSON.stringify({ providers: { 'global-demo': { name: 'Global', baseUrl: 'https://global.invalid/v1', api: 'openai-completions', models: [{ id: 'global-model' }] } } })
  const authBefore = JSON.stringify({ 'global-demo': { type: 'api_key', key: 'synthetic-global-key' } })
  write(join(global, 'models.json'), configBefore); write(join(global, 'auth.json'), authBefore)
  expect(f.form.target).toBe(`${f.config} + ${f.auth}`)
  expect(f.save()).toMatchObject({ ok: true })
  const worker = join(f.home, 'worker-agent'); fs.mkdirSync(worker, { mode: 0o700 })
  const snapshot = await snapshotPiOmpNative('pi', worker, { accountRoot: f.stateDirectory, nativeHome: f.home })
  expect(snapshot.directory).toBe(worker)
  expect(snapshot.providers).toEqual(expect.arrayContaining(['global-demo', 'custom-demo']))
  expect(JSON.parse(fs.readFileSync(join(worker, 'models.json'), 'utf8')).providers['custom-demo']).toMatchObject({ baseUrl: f.input.baseUrl, models: [{ id: 'model-a' }, { id: 'model-b' }] })
  expect(JSON.parse(fs.readFileSync(join(worker, 'auth.json'), 'utf8'))['custom-demo']).toEqual({ type: 'api_key', key: secret })
  expect(fs.readFileSync(join(global, 'models.json'), 'utf8')).toBe(configBefore)
  expect(fs.readFileSync(join(global, 'auth.json'), 'utf8')).toBe(authBefore)
  expect(JSON.stringify([...(f.manager as any).tickets.values()])).not.toContain(secret)
})
it.each(['id', 'name', 'auth'])('模拟：Pi 全局来源的 %s 冲突不能被私有目录遮蔽', kind => {
  const f = fixture('pi'), global = join(f.home, '.pi', 'agent')
  const file = join(global, kind === 'auth' ? 'auth.json' : 'models.json')
  const before = JSON.stringify(kind === 'auth' ? { 'custom-demo': { type: 'api_key', key: 'synthetic-global-key' } } : { providers: { [kind === 'id' ? 'custom-demo' : 'another']: { name: kind === 'name' ? 'Demo provider' : 'Other' } } })
  write(file, before)
  expect(f.save()).toMatchObject({ ok: false, issues: [{ field: 'providerId' }] })
  f.unchanged(); expect(fs.readFileSync(file, 'utf8')).toBe(before)
})
it('模拟：Pi 默认插件目录遵循 DSH_HOME，显式 stateDirectory 优先，来源变化使票据失效', () => {
  const f = fixture('pi', false), env = { DSH_HOME: join(f.home, 'dsh-one') }
  const options = { home: f.home, env, stateDirectory: undefined as string | undefined }
  const manager = new CustomProviders(options)
  const first = manager.form(f.source)!
  expect(first.target).toContain(join(env.DSH_HOME, 'cliworker-now/accounts/pi/agent/models.json'))
  env.DSH_HOME = join(f.home, 'dsh-two')
  expect(manager.save(f.source, first.token, JSON.stringify(f.input), () => {})).toMatchObject({ ok: false })
  expect(fs.existsSync(join(f.home, 'dsh-one'))).toBe(false)
  expect(fs.existsSync(env.DSH_HOME)).toBe(false)
  options.stateDirectory = f.stateDirectory
  const second = manager.form(f.source)!
  expect(second.target).toBe(`${f.config} + ${f.auth}`)
  expect(JSON.stringify([...(manager as any).tickets.values()])).not.toContain(secret)
  expect(manager.save(f.source, second.token, JSON.stringify(f.input), () => {})).toMatchObject({ ok: true })
  expect(fs.existsSync(join(f.home, '.pi'))).toBe(false)
  expect(new CustomProviders({ home: f.home, env: {} }).form(f.source)!.target).toContain(join(f.home, '.dsh/cliworker-now/accounts/pi/agent/models.json'))
})
it('模拟：Pi 私有账号目录符号链接拒绝写入且不回落全局目录', () => {
  const f = fixture('pi'), agent = dirname(f.auth), redirected = join(f.home, 'redirected-agent')
  fs.renameSync(agent, redirected); fs.symlinkSync(redirected, agent, 'dir')
  expect(f.save()).toMatchObject({ ok: false })
  expect(fs.readFileSync(join(redirected, 'auth.json'), 'utf8')).toBe(f.authBefore)
  expect(fs.readFileSync(join(redirected, 'models.json'), 'utf8')).toBe(f.configBefore)
  expect(fs.existsSync(join(f.home, '.pi'))).toBe(false)
})
it('模拟：Pi 仅接受默认或已知插件 agent 环境路径，不跟随任意覆盖', () => {
  const f = fixture('pi')
  for (const agent of [join(f.home, '.pi/agent'), dirname(f.auth)]) {
    const manager = new CustomProviders({ home: f.home, env: { PI_CODING_AGENT_DIR: agent }, stateDirectory: f.stateDirectory })
    expect(manager.form(f.source)!.target).toBe(`${f.config} + ${f.auth}`)
  }
})

it.each([true, false])('模拟：Hermes 私有来源=%s，保存后 Worker 启动准备与账号读取使用同一 HOME', async privateHome => {
  const f = fixture('hermes', true, privateHome)
  write(f.config, 'auth:\n  adopt_external_logins: false\n' + f.configBefore)
  const inactive = privateHome ? join(f.home, '.hermes') : join(f.stateDirectory, 'accounts/hermes')
  const inactiveConfig = 'providers:\n  custom-demo:\n    api: https://inactive.invalid/v1\n'
  const inactiveEnv = 'INACTIVE_KEY=synthetic-inactive\n'
  write(join(inactive, 'config.yaml'), inactiveConfig); write(join(inactive, '.env'), inactiveEnv)
  expect(f.form.target).toBe(`${f.config} + ${f.auth}`)
  expect(f.save()).toMatchObject({ ok: true })
  const selected = effectiveHermesHome({ stateDirectory: f.stateDirectory, hermesHome: join(f.home, '.hermes') })
  const launch = await prepareHermes({ executable: '/synthetic/hermes', project: f.home,
    preference: { model: JSON.stringify(['custom-demo', 'model-a']), effort: 'default' },
    prompt: 'synthetic, never executed', mode: 'accept-edits', stateDirectory: join(f.home, 'worker'), hermesHome: selected })
  expect(launch.env.HERMES_HOME).toBe(dirname(f.config))
  const material = await assertHermesOwnAccounts(launch.env.HERMES_HOME!)
  expect(material.config.providers['custom-demo']).toMatchObject({ api: f.input.baseUrl, api_mode: 'chat_completions', models: { 'model-a': {}, 'model-b': {} } })
  expect(material.env[material.config.providers['custom-demo'].key_env]).toBe(secret)
  expect(fs.statSync(f.auth).mode & 0o777).toBe(0o600)
  expect(fs.readFileSync(join(inactive, 'config.yaml'), 'utf8')).toBe(inactiveConfig)
  expect(fs.readFileSync(join(inactive, '.env'), 'utf8')).toBe(inactiveEnv)
})
it('模拟：Hermes 打开表单后登录切换私有 HOME，旧票据失效且新表单跟随来源', () => {
  const f = fixture('hermes', true, false)
  const own = prepareHermesAccountHome({ stateDirectory: f.stateDirectory, hermesHome: dirname(f.config) })
  expect(f.save()).toMatchObject({ ok: false }); f.unchanged()
  const form = f.manager.form(f.source)!
  expect(form.target).toBe(`${join(own, 'config.yaml')} + ${join(own, '.env')}`)
  expect(f.manager.save(f.source, form.token, JSON.stringify(f.input), () => {})).toMatchObject({ ok: true })
  expect(yaml(fs.readFileSync(join(own, 'config.yaml'), 'utf8')).providers['custom-demo'].key_env).toBeDefined()
  f.unchanged()
})
it('模拟：Hermes 私有来源 marker 不因账号文件删除而回落全局', () => {
  const f = fixture('hermes', false)
  const global = join(f.home, '.hermes/config.yaml'); write(global, 'synthetic-global: true\n')
  expect(f.save()).toMatchObject({ ok: true })
  expect(fs.existsSync(f.auth)).toBe(true)
  expect(fs.readFileSync(global, 'utf8')).toBe('synthetic-global: true\n')
})
it.each(['invalid', 'symlink', 'ancestor'])('模拟：Hermes 来源记录 %s 拒绝表单，不回落全局', kind => {
  const f = fixture('hermes'), marker = join(f.stateDirectory, 'accounts/hermes-source.json')
  if (kind === 'invalid') write(marker, '{"version":99}')
  else if (kind === 'symlink') { fs.renameSync(marker, marker + '.target'); fs.symlinkSync(marker + '.target', marker) }
  else { fs.renameSync(f.stateDirectory, f.stateDirectory + '-target'); fs.symlinkSync(f.stateDirectory + '-target', f.stateDirectory, 'dir') }
  expect(f.manager.form(f.source)).toBeNull()
  expect(f.save()).toMatchObject({ ok: false })
  expect(fs.existsSync(join(f.home, '.hermes'))).toBe(false)
})
it('模拟：Hermes 选中全局 HOME 的祖先链接拒绝，不能被 canonicalize 绕过', () => {
  const f = fixture('hermes', true, false), real = join(f.home, 'actual')
  fs.mkdirSync(real); fs.renameSync(dirname(f.config), join(real, 'hermes'))
  fs.symlinkSync(real, join(f.home, 'link'), 'dir')
  const manager = new CustomProviders({ home: f.home, env: {}, stateDirectory: f.stateDirectory, hermesHome: join(f.home, 'link/hermes') })
  expect(manager.form(f.source)).toBeNull()
})
it('模拟：Hermes 原生配置 HOME 与环境选择一致，未选择私有来源时尊重显式配置', () => {
  const f = fixture('hermes', false, false)
  const configured = join(f.home, 'configured'), ambient = join(f.home, 'ambient')
  const manager = new CustomProviders({ home: f.home, stateDirectory: f.stateDirectory, hermesHome: configured, env: { HERMES_HOME: ambient } })
  expect(manager.form(f.source)!.target).toBe(`${join(configured, 'config.yaml')} + ${join(configured, '.env')}`)
  const fromEnv = new CustomProviders({ home: f.home, stateDirectory: f.stateDirectory, env: { HERMES_HOME: ambient } })
  expect(fromEnv.form(f.source)!.target).toBe(`${join(ambient, 'config.yaml')} + ${join(ambient, '.env')}`)
})
it('模拟：Hermes 提交中来源变化时回滚已写凭据', () => {
  const f = fixture('hermes'); let calls = 0
  expect(f.save(f.input, () => {
    if (++calls === 3) fs.unlinkSync(join(f.stateDirectory, 'accounts/hermes-source.json'))
  })).toMatchObject({ ok: false })
  f.unchanged(); expect(fs.existsSync(join(f.home, '.hermes'))).toBe(false)
})
it('模拟：Hermes 私有 HOME 重名和凭据变量名冲突不覆盖旧数据', () => {
  const f = fixture('hermes')
  write(f.config, 'custom_providers:\n  - name: custom-demo\n')
  expect(f.save()).toMatchObject({ ok: false, issues: [{ field: 'providerId' }] })
  write(f.config, f.configBefore)
  expect(f.save()).toMatchObject({ ok: true })
  const variable = yaml(fs.readFileSync(f.config, 'utf8')).providers['custom-demo'].key_env
  write(f.config, f.configBefore)
  const before = fs.readFileSync(f.auth, 'utf8'), token = f.manager.form(f.source)!.token
  expect(f.manager.save(f.source, token, JSON.stringify(f.input), () => {})).toMatchObject({ ok: false, issues: [{ field: 'providerId' }] })
  expect(fs.readFileSync(f.auth, 'utf8')).toBe(before)
  expect(fs.readFileSync(f.config, 'utf8')).toBe(f.configBefore)
  expect(before).toContain(variable)
})
it.each([true, false])('模拟：OpenCode 已有私有来源=%s，保存结果进入 Worker 原生配置及凭据快照', async existing => {
  const f = fixture('opencode', existing), globalConfig = join(f.home, '.config/opencode/opencode.json'), globalAuth = join(f.home, '.local/share/opencode/auth.json')
  const configBefore = JSON.stringify({ provider: { 'global-demo': { name: 'Global', options: { baseURL: 'https://global.invalid/v1' }, models: { 'global-model': {} } } } })
  const authBefore = JSON.stringify({ 'global-demo': { type: 'api', key: 'synthetic-global' } })
  write(globalConfig, configBefore); write(globalAuth, authBefore)
  expect(f.form.target).toBe(`${f.config} + ${f.auth}`)
  expect(f.save()).toMatchObject({ ok: true })
  const launch = await prepareOpenCode({ executable: '/synthetic/opencode', project: f.home,
    preference: { model: 'custom-demo/model-a', effort: 'default' }, prompt: 'synthetic, never executed', mode: 'accept-edits',
    stateDirectory: join(f.home, 'worker'), authDirectory: openCodeAuthDirectory(f.stateDirectory), nativeHome: f.home })
  expect(JSON.parse(fs.readFileSync(launch.env.OPENCODE_CONFIG!, 'utf8')).provider['custom-demo']).toMatchObject({ options: { baseURL: f.input.baseUrl }, models: { 'model-a': { name: 'model-a' } } })
  expect(JSON.parse(fs.readFileSync(join(launch.env.XDG_DATA_HOME!, 'opencode/auth.json'), 'utf8'))['custom-demo']).toEqual({ type: 'api', key: secret })
  expect(fs.readFileSync(globalConfig, 'utf8')).toBe(configBefore); expect(fs.readFileSync(globalAuth, 'utf8')).toBe(authBefore)
})
it.each(['config.json', 'opencode.json', 'opencode.jsonc', 'auth.json'])('模拟：OpenCode 全局 %s 服务商冲突拒绝私有遮蔽', name => {
  const f = fixture('opencode'), path = join(f.home, name === 'auth.json' ? '.local/share/opencode' : '.config/opencode', name)
  const before = JSON.stringify(name === 'auth.json' ? { 'custom-demo': { type: 'api', key: 'synthetic-global' } } : { provider: { 'custom-demo': { options: { baseURL: 'https://global.invalid/v1' } } } })
  write(path, before)
  expect(f.save()).toMatchObject({ ok: false, issues: [{ field: 'providerId' }] })
  f.unchanged(); expect(fs.readFileSync(path, 'utf8')).toBe(before)
})
it('模拟：OpenCode 全局名称冲突同样拒绝；XDG 改变使票据失效', () => {
  const f = fixture('opencode'), env = { XDG_CONFIG_HOME: join(f.home, 'xdg-config'), XDG_DATA_HOME: join(f.home, 'xdg-data') }
  const manager = new CustomProviders({ home: f.home, stateDirectory: f.stateDirectory, env })
  const global = join(env.XDG_CONFIG_HOME, 'opencode/opencode.jsonc')
  write(global, '{// synthetic\n"provider":{"another":{"name":"Demo provider"}}}')
  const first = manager.form(f.source)!
  expect(manager.save(f.source, first.token, JSON.stringify(f.input), () => {})).toMatchObject({ ok: false, issues: [{ field: 'providerId' }] })
  f.unchanged()
  env.XDG_CONFIG_HOME = join(f.home, 'other-xdg')
  expect(manager.save(f.source, first.token, JSON.stringify(f.input), () => {})).toMatchObject({ ok: false, issues: [{ message: expect.stringContaining('来源已变化') }] })
  f.unchanged()
})
it.each(['global-config', 'private-auth'])('模拟：OpenCode %s 文件链接拒绝写入', kind => {
  const f = fixture('opencode'), target = join(f.home, 'linked.json')
  const path = kind === 'private-auth' ? f.auth : join(f.home, '.config/opencode/opencode.json')
  write(target, '{}')
  if (fs.existsSync(path)) fs.unlinkSync(path)
  fs.mkdirSync(dirname(path), { recursive: true }); fs.symlinkSync(target, path)
  expect(f.save()).toMatchObject({ ok: false })
  expect(fs.readFileSync(target, 'utf8')).toBe('{}')
  expect(fs.readFileSync(f.config, 'utf8')).toBe(f.configBefore)
})
it('模拟：OpenCode 读取顺序为全局各配置后私有各配置，私有 auth 覆盖全局 auth', async () => {
  const f = fixture('opencode', false), global = join(f.home, '.config/opencode'), own = dirname(f.config)
  for (const [root, name, tag] of [[global, 'config.json', 'legacy'], [global, 'opencode.json', 'global-json'], [global, 'opencode.jsonc', 'global-jsonc'], [own, 'opencode.json', 'plugin-json'], [own, 'opencode.jsonc', 'plugin-jsonc']]) {
    write(join(root!, name!), JSON.stringify({ provider: { same: { name: tag, options: { baseURL: `https://${tag}.invalid/v1` } } } }))
  }
  write(join(f.home, '.local/share/opencode/auth.json'), JSON.stringify({ same: { type: 'api', key: 'synthetic-global' } }))
  write(f.auth, JSON.stringify({ same: { type: 'api', key: 'synthetic-plugin' } }))
  const profile = await readOpenCodeProfile(openCodeAuthDirectory(f.stateDirectory), { nativeHome: f.home })
  expect(profile.providers.same.name).toBe('plugin-jsonc')
  expect(profile.auth.same).toEqual({ type: 'api', key: 'synthetic-plugin' })
  expect(f.manager.form(f.source)).toBeNull() // Never choose between two writable private overlays.
})
