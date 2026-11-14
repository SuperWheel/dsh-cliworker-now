/** 模拟：全部文件都在临时 HOME，不读取真实账号、不启动 CLI、不调用模型。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse as yaml } from 'yaml'
import { CustomProviders, type CustomProviderSource } from '../src/host/custom-provider.ts'
import { nativeJson } from '../src/host/custom-provider-files.ts'

vi.mock('node:fs', async load => ({ ...await load<typeof import('node:fs')>() }))
const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
const secret = 'synthetic-provider-credential-4x9'
const write = (file: string, text: string) => { fs.mkdirSync(dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, text, { mode: 0o600 }) }
function fixture(cli: 'pi' | 'opencode' | 'hermes', existing = true) {
  const home = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'custom-provider-synthetic-'))); roots.push(home)
  const manager = new CustomProviders({ home, env: {} })
  const source: CustomProviderSource = { cli, parent: 'parent', entry: { mode: 'auto', path: `/synthetic/${cli}` }, revision: 3 }
  const config = cli === 'pi' ? join(home, '.pi/agent/models.json') : cli === 'hermes' ? join(home, '.hermes/config.yaml') : join(home, '.config/opencode/opencode.json')
  const auth = cli === 'pi' ? join(home, '.pi/agent/auth.json') : cli === 'hermes' ? join(home, '.hermes/.env') : join(home, '.local/share/opencode/auth.json')
  const configBefore = cli === 'hermes' ? '# keep this comment\nmodel: old-model\nproviders:\n  old:\n    api: https://old.invalid/v1\n    models: { old-model: {} }\n' : '{\r\n\t"untouched": { "spacing" : 42 },\r\n\t"' + (cli === 'pi' ? 'providers' : 'provider') + '": {"old": {"name":"Old"}}\r\n}\r\n'
  const authBefore = cli === 'hermes' ? '# keep original env\nOLD_KEY=synthetic-old\n' : '{ "old": {"type":"oauth","access":"synthetic-old","refresh":"synthetic-refresh","expires":9999999999999} }\n'
  if (existing) { write(config, configBefore); write(auth, authBefore) }
  const input = { providerId: 'custom-demo', providerLabel: 'Demo provider', baseUrl: 'https://gateway.invalid/v1', api: cli === 'pi' ? 'openai-completions' : cli === 'hermes' ? 'chat_completions' : '@ai-sdk/openai-compatible', apiKey: secret, models: ['model-a', 'model-b'] }
  const form = manager.form(source)!
  const save = (values: unknown = input, guard = () => {}) => manager.save(source, form.token, JSON.stringify(values), guard)
  const unchanged = () => { expect(fs.readFileSync(config, 'utf8')).toBe(configBefore); expect(fs.readFileSync(auth, 'utf8')).toBe(authBefore) }
  return { home, manager, source, config, auth, input, form, save, unchanged, configBefore, authBefore }
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
