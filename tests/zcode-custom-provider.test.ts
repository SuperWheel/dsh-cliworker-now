/** 模拟：临时 HOME、合成的 ZCode 内置目录与虚构密钥；不运行 ZCode、不读取真实账号、不调用模型。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { CustomProviders } from '../src/host/custom-provider.ts'
import {
  deleteZCodeManagedProvider,
  zcodeManagedProviderExists,
  zcodeProviderLogins,
  zcodeProviderTarget,
} from '../src/host/zcode-custom-provider.ts'
import { withZCodeProviderRows } from '../src/host/zcode-grok-accounts.ts'

vi.mock('node:fs', async (load) => ({ ...(await load<typeof import('node:fs')>()) }))
const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
const write = (path: string, text: string, mode = 0o600) => {
  fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  fs.writeFileSync(path, text, { mode })
}
const read = (path: string) => fs.readFileSync(path, 'utf8')
const SECRET = 'SIMULATED-zcode-own-key-0001'

const builtin = {
  schemaVersion: 1,
  config: {
    providerConfigRules: {
      providerRules: [{ providerId: 'zhipu', providerName: 'BigModel', config: { group: 'zhipu-account', access: { type: 'zhipu-account' }, api: { type: 'anthropic-messages', baseUrl: 'https://bigmodel.invalid' } } }],
      templateRules: [
        { templateId: 'deepseek', templateNameMap: { 'zh-CN': 'DeepSeek' }, config: { access: { type: 'api-key' }, api: { type: 'openai-chat-completions', baseUrl: 'https://deepseek.invalid/v1' }, builtinModelIds: ['ds-chat', 'ds-old'] } },
        { templateId: 'plan', templateNameMap: { 'zh-CN': 'Coding Plan' }, config: { access: { type: 'zhipu-coding-plan-api-key' }, api: { type: 'anthropic-messages', baseUrl: 'https://plan.invalid' }, builtinModelIds: ['p'] } },
        { templateId: 'headers', templateNameMap: { 'zh-CN': 'Headers' }, config: { access: { type: 'api-key' }, api: { type: 'openai-responses', baseUrl: 'https://h.invalid', headers: { 'X-A': 'b' } }, builtinModelIds: ['h'] } },
      ],
    },
    modelConfigRules: { templateModelRules: [{ templateId: 'deepseek', modelId: 'ds-old', config: { enabled: false } }] },
  },
}
const globalDocument = {
  schemaVersion: 1,
  config: {
    providerConfigRules: {
      providerRules: [{ providerId: '11111111-1111-4111-8111-111111111111', providerName: 'Desktop Provider', config: { group: 'standard-personal', access: { type: 'api-key', apiKey: 'SIMULATED-desktop-key' }, api: { type: 'openai-chat-completions', baseUrl: 'https://desktop.invalid/v1' }, personalModelIds: ['m1'] } }],
    },
    modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
  },
}

function fixture() {
  const home = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'zcode-custom-provider-simulated-')))
  roots.push(home)
  const state = join(home, 'state')
  const executable = join(home, 'app', 'glm', 'zcode.cjs')
  const builtinConfig = join(home, 'app', 'builtin.json')
  write(executable, '// simulated entry, never executed\n', 0o644)
  write(builtinConfig, JSON.stringify(builtin), 0o644)
  const globalFile = join(home, '.zcode', 'v2', 'provider_config.json')
  write(globalFile, JSON.stringify(globalDocument, null, 2), 0o600)
  const authDirectory = join(state, 'accounts', 'zcode')
  const target = zcodeProviderTarget(authDirectory, home)
  let now = 1_000_000
  const manager = new CustomProviders({ home, stateDirectory: state, env: {}, zcodeBuiltinConfig: builtinConfig, now: () => now })
  const source = { cli: 'zcode' as const, parent: 'simulated', entry: { path: executable }, revision: 0 }
  const values = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ providerLabel: 'My Gateway', api: 'openai-chat-completions', baseUrl: 'https://gateway.invalid/v1', apiKey: SECRET, models: ['gw-large', 'K2.7 Code'], ...extra })
  return { home, state, target, globalFile, manager, source, values, advance: (ms: number) => { now += ms } }
}
const document = (path: string) => JSON.parse(read(path))
const rules = (path: string) => document(path).config.providerConfigRules.providerRules as Record<string, any>[]

describe('ZCode 「其他服务商」 form (simulated)', () => {
  it('offers only API-key templates as prefills and never puts a secret in the form', () => {
    const f = fixture()
    const form = f.manager.form(f.source)!
    expect(form).toMatchObject({ cli: 'zcode', nativeFallback: false, target: f.target.file })
    expect(form.fields.map((field) => field.id)).toEqual(['providerLabel', 'api', 'baseUrl', 'apiKey', 'models', 'contextWindow'])
    expect(form.presets).toEqual([
      { id: 'deepseek', label: 'DeepSeek', values: { providerLabel: 'DeepSeek', api: 'openai-chat-completions', baseUrl: 'https://deepseek.invalid/v1', models: 'ds-chat' } },
    ])
    expect(JSON.stringify(form)).not.toContain('SIMULATED-desktop-key')
  })

  it('writes the plugin file only (0600), leaves the global file byte-identical and lists a deletable row', () => {
    const f = fixture()
    const before = read(f.globalFile)
    const form = f.manager.form(f.source)!
    const result = f.manager.save(f.source, form.token, f.values({ contextWindow: '200000' }), () => {})
    expect(result).toMatchObject({ ok: true, cli: 'zcode', providerLabel: 'My Gateway' })
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(read(f.globalFile)).toBe(before)
    const [rule] = rules(f.target.file)
    expect(rule).toMatchObject({
      providerId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      providerName: 'My Gateway',
      config: { group: 'standard-personal', access: { type: 'api-key', apiKey: SECRET }, api: { type: 'openai-chat-completions', baseUrl: 'https://gateway.invalid/v1' }, personalModelIds: ['gw-large', 'K2.7 Code'] },
    })
    expect(document(f.target.file).config.modelConfigRules.providerModelRules).toEqual([
      { providerId: rule.providerId, modelId: 'gw-large', config: { properties: { contextWindow: 200000 } } },
      { providerId: rule.providerId, modelId: 'K2.7 Code', config: { properties: { contextWindow: 200000 } } },
    ])
    const receipt = join(f.target.directory, 'cliworker-created-providers.json')
    expect(read(receipt)).not.toContain(SECRET)
    if (process.platform !== 'win32') for (const path of [f.target.file, receipt]) expect(fs.statSync(path).mode & 0o777).toBe(0o600)
    // The ticket is single-use.
    expect(f.manager.save(f.source, form.token, f.values({ providerLabel: 'Other' }), () => {})).toMatchObject({ ok: false })
    const rows = zcodeProviderLogins(f.target)
    expect(rows).toEqual([
      { providerLabel: 'Desktop Provider', authMethod: 'api', source: 'native' },
      { providerLabel: 'My Gateway', authMethod: 'api', source: 'plugin', id: `zcode:${rule.providerId}:plugin.config`, managedConfiguration: true },
    ])
    expect(JSON.stringify(rows)).not.toMatch(/SIMULATED-/)
  })

  it.each([
    ['the global file', 'desktop provider'],
    ['the builtin catalog', 'BIGMODEL'],
  ])('rejects a name already used in %s without writing anything', (_where, name) => {
    const f = fixture()
    const form = f.manager.form(f.source)!
    expect(f.manager.save(f.source, form.token, f.values({ providerLabel: name }), () => {})).toEqual({
      ok: false, issues: [{ field: 'providerLabel', message: '名称已被 ZCode 的其他服务商使用，请换一个名称' }],
    })
    expect(fs.existsSync(f.target.file)).toBe(false)
  })

  it('rejects a name already used in the plugin file', () => {
    const f = fixture()
    expect(f.manager.save(f.source, f.manager.form(f.source)!.token, f.values(), () => {})).toMatchObject({ ok: true })
    const before = read(f.target.file)
    expect(f.manager.save(f.source, f.manager.form(f.source)!.token, f.values({ providerLabel: 'my gateway' }), () => {})).toMatchObject({ ok: false })
    expect(read(f.target.file)).toBe(before)
  })

  it('validates every field and keeps a pasted key out of public fields', () => {
    const f = fixture()
    const save = (extra: Record<string, unknown>) => f.manager.save(f.source, f.manager.form(f.source)!.token, f.values(extra), () => {})
    const fields = (result: ReturnType<typeof save>) => (result.ok ? [] : result.issues.map((issue) => issue.field))
    expect(fields(save({ baseUrl: 'https://user:pw@gateway.invalid/v1' }))).toEqual(['baseUrl'])
    expect(fields(save({ api: 'google-generative-ai' }))).toEqual(['api'])
    expect(fields(save({ apiKey: 'has space' }))).toEqual(['apiKey'])
    expect(fields(save({ models: [] }))).toEqual(['models'])
    expect(fields(save({ models: ['a', 'a'] }))).toEqual(['models'])
    expect(fields(save({ contextWindow: '0' }))).toEqual(['contextWindow'])
    expect(fields(save({ providerLabel: '<b>x</b>' }))).toEqual(['providerLabel'])
    const leaked = save({ models: [`model-${SECRET}`] })
    expect(fields(leaked)).toEqual(['models'])
    expect(JSON.stringify(leaked)).not.toContain(SECRET)
    expect(save({ extra: 'x' })).toEqual({ ok: false, issues: [{ message: '表单内容无效，请重新填写' }] })
    expect(fs.existsSync(f.target.file)).toBe(false)
  })

  it('refuses an expired ticket and a ticket whose entry changed', () => {
    const f = fixture()
    const form = f.manager.form(f.source)!
    f.advance(10 * 60_000 + 1)
    expect(f.manager.save(f.source, form.token, f.values(), () => {})).toMatchObject({ ok: false })
    const next = f.manager.form(f.source)!
    expect(f.manager.save({ ...f.source, revision: 1 }, next.token, f.values(), () => {})).toMatchObject({ ok: false })
    expect(fs.existsSync(f.target.file)).toBe(false)
  })

  it('rolls back the provider file when the receipt cannot be committed', () => {
    const f = fixture()
    expect(f.manager.save(f.source, f.manager.form(f.source)!.token, f.values(), () => {})).toMatchObject({ ok: true })
    const receipt = join(f.target.directory, 'cliworker-created-providers.json')
    const before = [read(f.target.file), read(receipt)]
    const rename = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (to === receipt && String(from).endsWith('.tmp')) throw new Error('simulated disk failure')
      return rename(from, to)
    })
    expect(f.manager.save(f.source, f.manager.form(f.source)!.token, f.values({ providerLabel: 'Second' }), () => {})).toEqual({
      ok: false, issues: [{ message: '保存失败，原生配置未更改；请检查文件格式、权限或原生账号锁后重试' }],
    })
    vi.restoreAllMocks()
    expect([read(f.target.file), read(receipt)]).toEqual(before)
  })
})

describe('ZCode plugin provider deletion (simulated)', () => {
  it('deletes exactly the plugin-created provider with its model rules and never touches the global file', () => {
    const f = fixture()
    const global = read(f.globalFile)
    expect(f.manager.save(f.source, f.manager.form(f.source)!.token, f.values({ contextWindow: '64000' }), () => {})).toMatchObject({ ok: true })
    expect(f.manager.save(f.source, f.manager.form(f.source)!.token, f.values({ providerLabel: 'Keep Me', models: ['k'] }), () => {})).toMatchObject({ ok: true })
    const [gone, kept] = rules(f.target.file)
    const login = `zcode:${gone.providerId}:plugin.config`
    expect(zcodeManagedProviderExists(f.target, login)).toBe(true)
    deleteZCodeManagedProvider(f.target, login, () => {})
    const after = document(f.target.file)
    expect(after.config.providerConfigRules.providerRules.map((rule: any) => rule.providerId)).toEqual([kept.providerId])
    expect(after.config.modelConfigRules.providerModelRules).toEqual([])
    expect(read(join(f.target.directory, 'cliworker-created-providers.json'))).not.toContain(gone.providerId)
    expect(read(f.globalFile)).toBe(global)
    expect(zcodeProviderLogins(f.target).map((row) => row.providerLabel)).toEqual(['Desktop Provider', 'Keep Me'])
  })

  it('refuses edited entries, foreign handles and global providers without changing anything', () => {
    const f = fixture()
    expect(f.manager.save(f.source, f.manager.form(f.source)!.token, f.values(), () => {})).toMatchObject({ ok: true })
    const data = document(f.target.file)
    const id = data.config.providerConfigRules.providerRules[0].providerId
    data.config.providerConfigRules.providerRules[0].config.api.baseUrl = 'https://edited.invalid/v1'
    write(f.target.file, JSON.stringify(data, null, 2))
    const before = read(f.target.file)
    for (const login of [`zcode:${id}:plugin.config`, `zcode:${id}:native.config`, 'zcode:11111111-1111-4111-8111-111111111111:plugin.config', `pi:${id}:plugin.config`])
      expect(() => deleteZCodeManagedProvider(f.target, login, () => {})).toThrow('账号来源已变化，请刷新后重试')
    expect(read(f.target.file)).toBe(before)
    // Edited rows lose their deletion handle and stay read-only.
    expect(zcodeProviderLogins(f.target).find((row) => row.source === 'plugin')).toEqual({ providerLabel: 'My Gateway', authMethod: 'api', source: 'plugin' })
  })
})

describe('ZCode account rows for own API-key providers (simulated)', () => {
  const row = { providerLabel: 'My Gateway', authMethod: 'api' as const, source: 'plugin' as const }
  it('keeps the subscription row when signed in and reports API-only access after expiry', () => {
    expect(withZCodeProviderRows({ state: 'authenticated', authMethod: 'oauth', verification: 'local', summary: 's', accountLabel: 'a' }, [row]).logins).toEqual([
      { providerLabel: 'BigModel / Z.AI', authMethod: 'oauth', accountLabel: 'a', source: 'plugin' }, row,
    ])
    expect(withZCodeProviderRows({ state: 'unauthenticated', verification: 'local', summary: '登录已过期' }, [row])).toEqual({
      state: 'configured', authMethod: 'api', verification: 'local', summary: '已配置 ZCode API；登录已过期', logins: [row],
    })
    const unknown = { state: 'unknown' as const, verification: 'local' as const, summary: 'x' }
    expect(withZCodeProviderRows(unknown, [row])).toBe(unknown)
    const signedOut = { state: 'unauthenticated' as const, verification: 'local' as const, summary: 'x' }
    expect(withZCodeProviderRows(signedOut, [])).toBe(signedOut)
  })
})
