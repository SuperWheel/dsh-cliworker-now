import { afterEach, expect, it, vi } from 'vitest'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { discoverZCode, prepareZCode, readZCodeBindingMaterial } from '../src/host/zcode-adapter.ts'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { catalogNoticeOf } from '../src/host/catalog-notice.ts'
import { decodeZCodeCredentials } from '../src/host/zcode-credentials.ts'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import * as adapters from '../src/host/adapters.ts'
import { projectZCodeIdentity, zcodeGrokAccountStatus } from '../src/host/zcode-grok-accounts.ts'

// Explicit synthetic account bindings and HTTP responses. No user account/network/model call.
const roots: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})
const provider = 'account:bigmodel-individual-coding-plan'
const secret = 'SYNTHETIC_CIPHER_SECRET'
function fixture(selectedProvider = provider) {
  const root = mkdtempSync(join(tmpdir(), 'cwn-zcode-account-models-'))
  roots.push(root)
  const auth = join(root, 'auth'),
    credentials = join(auth, '.zcode/v2/credentials.json'),
    builtin = join(root, 'builtin.json')
  mkdirSync(join(auth, '.zcode/v2'), { recursive: true })
  const config: any = {
    schemaVersion: 1,
    config: {
      providerConfigRules: {
        providerRules: [
          {
            providerId: selectedProvider,
            config: {
              access: {
                type: 'zhipu-account',
                accountType: 'bigmodel',
                mode: 'individual-coding-plan',
                entitled: true,
              },
              api: { type: 'openai-chat-completions', baseUrl: 'https://fixture.test/v1' },
              builtinModelIds: ['supported', 'not-in-account'],
            },
          },
        ],
      },
      modelConfigRules: {
        modelRules: [
          {
            modelMatch: '.*',
            config: { enabled: true, optionSpecs: { reasoningLevel: { values: ['low', 'high'] } } },
          },
        ],
        modelApiRules: [],
        providerSiteRules: [],
        templateModelRules: [],
        builtinProviderModelRules: [],
      },
    },
  }
  writeFileSync(builtin, JSON.stringify(config))
  const save = (values: Record<string, string>) => {
    const raw = Object.fromEntries(
      Object.entries(values).map(([name, value]) => {
        const iv = randomBytes(12),
          cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv)
        const body = Buffer.concat([cipher.update(value), cipher.final()])
        return [
          name,
          `enc:v1:${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${body.toString('base64url')}`,
        ]
      }),
    )
    writeFileSync(credentials, JSON.stringify(raw), { mode: 0o600 })
    return raw
  }
  const values = {
    [`account-provider:${selectedProvider}:identity`]: 'current/identity',
    [`account-provider:coding-plan:${selectedProvider}:account:current%2Fidentity:api-key`]:
      'SYNTHETIC_CURRENT_KEY',
    [`account-provider:coding-plan:${selectedProvider}:account:old:api-key`]: 'SYNTHETIC_OLD_KEY',
  }
  const query = (fetcher: typeof fetch) =>
    discoverZCode('/synthetic/zcode', vi.fn(), join(root, 'query'), auth, builtin, {
      nativeHome: join(root, 'empty-home'),
      credentialSecret: secret,
      probeOptions: { fetch: fetcher },
    })
  return { root, auth, credentials, builtin, config, save, values, query }
}
it('uses the exact native account binding and API origin, keeping only the account model intersection', async () => {
  const f = fixture(),
    raw = f.save(f.values),
    before = readFileSync(f.credentials)
  const fetcher = vi.fn(async (url: any, options: any) => {
    expect(url).toBe('https://fixture.test/v1/models')
    expect(options.headers.Authorization).toBe('Bearer SYNTHETIC_CURRENT_KEY')
    expect(options.method).toBe('GET')
    return new Response(JSON.stringify({ data: [{ id: 'supported', free: true }, { id: 'public-only' }] }))
  })
  expect(await f.query(fetcher)).toEqual([
    {
      id: `${provider}/supported`,
      label: `supported（${provider} · 本机目录）`,
      efforts: ['low', 'high'],
      cost: 'unknown',
    },
  ])
  expect(projectZCodeIdentity(raw, secret)).toMatchObject({ state: 'configured', verification: 'local' })
  expect(fetcher).toHaveBeenCalledOnce()
  expect(readFileSync(f.credentials)).toEqual(before)
})
it('模拟：keeps Host decryption and resumed/headless native execution on the exact environment cipher secret', async () => {
  const f = fixture()
  f.save(f.values)
  vi.stubEnv('ZCODE_CREDENTIAL_SECRET', ` ${secret} `)
  expect(scrubbedParentEnv().ZCODE_CREDENTIAL_SECRET).toBeUndefined()
  const before = readFileSync(f.credentials)
  const models = await discoverZCode('/synthetic/zcode', vi.fn(), join(f.root, 'query'), f.auth, f.builtin, {
    nativeHome: join(f.root, 'empty-home'),
    probeOptions: {
      fetch: async (_url, options) => {
        expect((options!.headers as Record<string, string>).Authorization).toBe(
          'Bearer SYNTHETIC_CURRENT_KEY',
        )
        return new Response(JSON.stringify({ data: [{ id: 'supported' }] }))
      },
    },
  })
  expect(models.map((model) => model.id)).toEqual([`${provider}/supported`])
  expect(JSON.stringify(models)).not.toContain(secret)
  for (const conversationId of [undefined, 'synthetic-session']) {
    const launch = await prepareZCode({
      executable: '/synthetic/zcode',
      project: f.root,
      prompt: 'Synthetic task; never executed',
      stateDirectory: join(f.root, conversationId ? 'resumed' : 'headless'),
      authDirectory: f.auth,
      nativeHome: join(f.root, 'empty-home'),
      builtinConfig: f.builtin,
      preference: { model: models[0]!.id, effort: 'low' },
      mode: 'plan',
      conversationId,
    })
    expect({ ...scrubbedParentEnv(), ...launch.env }.ZCODE_CREDENTIAL_SECRET).toBe(` ${secret} `)
    expect(JSON.stringify(launch.argv)).not.toContain(secret)
    expect(readFileSync(launch.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, 'utf8')).not.toContain(secret)
    if (conversationId) expect(readFileSync(launch.argv[2]!, 'utf8')).not.toContain(secret)
  }
  expect(readFileSync(f.credentials)).toEqual(before)
})
it('mirrors native Anthropic authentication while keeping custom endpoints case-sensitive and credentials private', async () => {
  const f = fixture()
  f.save(f.values)
  const native = f.config.config.providerConfigRules.providerRules[0].config
  native.api = { type: 'anthropic-messages', baseUrl: 'https://fixture.test/anthropic' }
  native.builtinModelIds = ['GLM-5.3', 'GLM-5.3-Flash']
  writeFileSync(f.builtin, JSON.stringify(f.config))
  const before = readFileSync(f.credentials)
  const fetcher = vi.fn(async (url: any, options: any) => {
    expect(url).toBe('https://fixture.test/anthropic/v1/models')
    expect(options.method).toBe('GET')
    expect(options.redirect).toBe('error')
    expect(options.headers).toMatchObject({
      Authorization: 'Bearer SYNTHETIC_CURRENT_KEY',
      'x-api-key': 'SYNTHETIC_CURRENT_KEY',
      'anthropic-version': '2023-06-01',
    })
    return new Response(
      JSON.stringify({
        data: [
          { id: 'GLM-5.3' },
          { id: 'glm-5.3-flash' },
          { id: 'SYNTHETIC_CURRENT_KEY' },
          { id: 'public-only' },
        ],
      }),
    )
  })
  const result = await f.query(fetcher)
  expect(result.map((model) => model.id)).toEqual([`${provider}/GLM-5.3`])
  expect(JSON.stringify(result)).not.toContain('SYNTHETIC_CURRENT_KEY')
  expect(JSON.stringify(result)).not.toContain(secret)
  expect(fetcher).toHaveBeenCalledOnce()
  expect(readFileSync(f.credentials)).toEqual(before)
})
// The 11 IDs were recorded by the authorized read-only query on 2026-10-08.
// All response envelopes, credentials and transports below are explicitly simulated.
const observedOfficialIds = [
  'glm-4.5',
  'glm-4.5-air',
  'glm-4.6',
  'glm-4.7',
  'glm-5',
  'glm-5-turbo',
  'glm-5.1',
  'glm-5.2',
  'glm-5.3',
  'glm-5.3-flash',
  'glm-5.3-flashx',
]
it.each([
  ['bigmodel', 'https://open.bigmodel.cn/api/anthropic'],
  ['zai', 'https://api.z.ai/api/anthropic'],
])(
  'projects verified official %s GLM aliases to the unchanged native execution IDs',
  async (accountType, baseUrl) => {
    const nativeProvider = `account:${accountType}-individual-coding-plan`
    const f = fixture(nativeProvider)
    f.save(f.values)
    const native = f.config.config.providerConfigRules.providerRules[0].config
    native.access.accountType = accountType
    native.api = { type: 'anthropic-messages', baseUrl }
    native.builtinModelIds = ['GLM-5.3', 'GLM-5.3-Flash', 'GLM-5.3-FlashX', 'GLM-5.3-Flash-Pro']
    writeFileSync(f.builtin, JSON.stringify(f.config))
    const before = readFileSync(f.credentials)
    const fetcher = vi.fn(async (url: any, options: any) => {
      expect(url).toBe(`${baseUrl}/v1/models`)
      expect(options.headers.Authorization).toBe('Bearer SYNTHETIC_CURRENT_KEY')
      expect(options.headers['x-api-key']).toBe('SYNTHETIC_CURRENT_KEY')
      return new Response(JSON.stringify({ data: observedOfficialIds.map((id) => ({ id })) }))
    })
    const models = await f.query(fetcher)
    expect(models.map((model) => model.id)).toEqual([
      `${nativeProvider}/GLM-5.3`,
      `${nativeProvider}/GLM-5.3-Flash`,
    ])
    expect(fetcher).toHaveBeenCalledOnce()
    expect(JSON.stringify(models)).not.toContain('SYNTHETIC_CURRENT_KEY')
    for (const model of models) {
      const launch = await prepareZCode({
        executable: '/synthetic/zcode',
        project: f.root,
        prompt: 'Synthetic; never executed',
        stateDirectory: join(f.root, model.id.endsWith('-Flash') ? 'flash' : 'base'),
        authDirectory: f.auth,
        nativeHome: join(f.root, 'empty-home'),
        builtinConfig: f.builtin,
        preference: { model: model.id, effort: 'high' },
        mode: 'plan',
      })
      expect(
        JSON.parse(readFileSync(launch.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, 'utf8')).config
          .defaultModelSelection,
      ).toEqual({
        providerId: nativeProvider,
        modelId: model.id.split('/')[1],
        options: { reasoningLevel: 'high' },
      })
    }
    expect(readFileSync(f.credentials)).toEqual(before)
  },
)
it.each([
  { reason: 'another provider', providerId: 'account:other-individual-coding-plan' },
  { reason: 'a custom endpoint', baseUrl: 'https://fixture.test/anthropic' },
  { reason: 'the other official endpoint', baseUrl: 'https://api.z.ai/api/anthropic' },
  { reason: 'a different account type', accountType: 'zai' },
  { reason: 'an explicit API-key route', accessType: 'api-key' },
  { reason: 'another API protocol', apiType: 'openai-chat-completions' },
])('does not apply official aliases to $reason', async (scope) => {
  const f = fixture(scope.providerId ?? provider)
  f.save(f.values)
  const native = f.config.config.providerConfigRules.providerRules[0].config
  native.api = {
    type: scope.apiType ?? 'anthropic-messages',
    baseUrl: scope.baseUrl ?? 'https://open.bigmodel.cn/api/anthropic',
  }
  native.builtinModelIds = ['GLM-5.3', 'GLM-5.3-Flash']
  if (scope.accountType) native.access.accountType = scope.accountType
  if (scope.accessType) native.access = { type: scope.accessType, apiKey: 'SYNTHETIC_CURRENT_KEY' }
  writeFileSync(f.builtin, JSON.stringify(f.config))
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ data: observedOfficialIds.map((id) => ({ id })) })),
  )
  expect(await f.query(fetcher)).toEqual([])
  expect(fetcher).toHaveBeenCalledOnce()
})
it('does not interpret a similar official suffix as an entitled native model', async () => {
  const f = fixture()
  f.save(f.values)
  const native = f.config.config.providerConfigRules.providerRules[0].config
  native.api = { type: 'anthropic-messages', baseUrl: 'https://open.bigmodel.cn/api/anthropic' }
  native.builtinModelIds = ['GLM-5.3-Flash']
  writeFileSync(f.builtin, JSON.stringify(f.config))
  expect(
    await f.query(async () => new Response(JSON.stringify({ data: [{ id: 'glm-5.3-flashx' }] }))),
  ).toEqual([])
})
it('does not fall back to an old identity key, OAuth access or refresh token', async () => {
  const f = fixture()
  const { [`account-provider:coding-plan:${provider}:account:current%2Fidentity:api-key`]: _, ...values } =
    f.values
  f.save({
    ...values,
    'oauth:active_provider': 'bigmodel',
    'oauth:bigmodel:access_token': 'SYNTHETIC_OAUTH',
    'oauth:bigmodel:refresh_token': 'SYNTHETIC_REFRESH',
  })
  const fetcher = vi.fn()
  expect(await f.query(fetcher)).toEqual([])
  expect(fetcher).not.toHaveBeenCalled()
})
it.each([401, 403, 404])(
  'does not replace account metadata rejection %s with static entitled flags',
  async (status) => {
    const f = fixture()
    f.save(f.values)
    expect(await f.query(async () => new Response('', { status }))).toEqual([])
  },
)
it('supports an explicit native API route without treating configured models as account scope', async () => {
  const f = fixture()
  f.config.config.providerConfigRules.providerRules[0].config.access = {
    type: 'api-key',
    apiKey: 'SYNTHETIC_API_KEY',
  }
  writeFileSync(f.builtin, JSON.stringify(f.config))
  const fetcher = vi.fn(async (_url: any, options: any) => {
    expect(options.headers.Authorization).toBe('Bearer SYNTHETIC_API_KEY')
    return new Response(JSON.stringify({ data: [{ id: 'supported' }] }))
  })
  expect((await f.query(fetcher)).map((model) => model.id)).toEqual([`${provider}/supported`])
  expect(await f.query(async () => new Response(JSON.stringify({ data: [] })))).toEqual([])
})
it('keeps unknown native access modes and credential-altering headers out of the probe', async () => {
  const f = fixture()
  f.save(f.values)
  f.config.config.providerConfigRules.providerRules[0].config.api.headers = {
    Authorization: 'SYNTHETIC_OTHER_ACCOUNT',
  }
  writeFileSync(f.builtin, JSON.stringify(f.config))
  const fetcher = vi.fn()
  expect(await f.query(fetcher)).toEqual([])
  expect(fetcher).not.toHaveBeenCalled()
})

// REQ-0136: native-shaped 0.17.1 envelopes; every secret, keyring and transport is simulated.
function encryptedRecord(values: Record<string, string>, version: 'v1' | 'env' | 'os', key: Buffer) {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
    const body = Buffer.concat([cipher.update(value), cipher.final()])
    const envelope = [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join('.')
    const prefix = version === 'v1' ? 'enc:v1:' : `enc:v2:${version}:${createHash('sha256').update(key).digest('hex').slice(0, 24)}:`
    return [name, prefix + envelope]
  }))
}
const managedSecret = 'SYNTHETIC_32_BYTE_MANAGED_SECRET_WITH_SPACE\n'
const managedKey = () => createHash('sha256').update(managedSecret).digest()
const oauthValues = () => ({
  'oauth:active_provider': 'bigmodel',
  'oauth:bigmodel:access_token': 'SYNTHETIC_OAUTH_NOT_AN_API_KEY',
  'oauth:bigmodel:user_info': JSON.stringify({ id: 'current/identity', email: 'test@example.invalid' }),
  [`account-provider:${provider}:identity`]: 'current/identity',
  [`account-provider:${provider}:auth-source`]: 'oauth',
})

it.each(['v1', 'env'] as const)('模拟：decodes %s credentials without changing any native files', async (version) => {
  const f = fixture()
  const raw = encryptedRecord(oauthValues(), version, managedKey())
  writeFileSync(f.credentials, JSON.stringify(raw))
  const before = readFileSync(f.credentials)
  expect(await decodeZCodeCredentials(raw, f.credentials, { env: { ZCODE_CREDENTIAL_SECRET: managedSecret } })).toEqual(oauthValues())
  expect(readFileSync(f.credentials)).toEqual(before)
  expect(readdirSync(join(f.auth, '.zcode/v2'))).toEqual(['credentials.json'])
})
it.each(['explicit', 'fallback'] as const)('模拟：reads the %s credential-secret file byte-for-byte as v2 env', async (kind) => {
  const f = fixture(), path = join(f.auth, '.zcode/v2/credential-secret')
  writeFileSync(path, managedSecret, { mode: 0o600 })
  const raw = encryptedRecord(oauthValues(), 'env', managedKey()), readOsSecret = vi.fn()
  expect(await decodeZCodeCredentials(raw, f.credentials, {
    env: kind === 'explicit' ? { ZCODE_CREDENTIAL_SECRET_FILE: path } : {}, readOsSecret,
  })).toEqual(oauthValues())
  expect(readOsSecret).not.toHaveBeenCalled()
  expect(readFileSync(path, 'utf8')).toBe(managedSecret)
})
it('模拟：rejects simultaneous explicit secret and secret file before reading either source', async () => {
  const f = fixture(), readOsSecret = vi.fn()
  await expect(decodeZCodeCredentials(oauthValues(), f.credentials, {
    env: { ZCODE_CREDENTIAL_SECRET: managedSecret, ZCODE_CREDENTIAL_SECRET_FILE: join(f.root, 'missing') }, readOsSecret,
  })).rejects.toMatchObject({ state: 'unavailable' })
  expect(readOsSecret).not.toHaveBeenCalled()
})
it.each([false, true])('模拟：v2 os pins the mocked OS key despite credential-secret (marker=%s)', async (marker) => {
  const f = fixture(), key = randomBytes(32), directory = join(f.auth, '.zcode/v2')
  writeFileSync(join(directory, 'credential-secret'), managedSecret, { mode: 0o600 })
  if (marker) writeFileSync(join(directory, 'credential-source'), 'os\n')
  const raw = encryptedRecord(oauthValues(), 'os', key)
  writeFileSync(f.credentials, JSON.stringify(raw))
  const before = readdirSync(directory), readOsSecret = vi.fn(async () => key.toString('base64url'))
  expect(await decodeZCodeCredentials(raw, f.credentials, { env: {}, readOsSecret })).toEqual(oauthValues())
  expect(readOsSecret).toHaveBeenCalledWith('ZCode Credential Encryption', createHash('sha256').update(resolve(f.credentials)).digest('hex'), expect.any(AbortSignal))
  expect(readdirSync(directory)).toEqual(before)
  expect(JSON.parse(readFileSync(f.credentials, 'utf8'))).toEqual(raw)
  // Native never decodes an os envelope using the fallback secret file.
  await expect(decodeZCodeCredentials(raw, f.credentials, { env: {} })).rejects.toMatchObject({ state: 'unavailable' })
})
it('模拟：explicit source overrides the os marker and rejects an os/source mismatch', async () => {
  const f = fixture(), readOsSecret = vi.fn()
  writeFileSync(join(f.auth, '.zcode/v2/credential-source'), 'os\n')
  expect(await decodeZCodeCredentials(encryptedRecord(oauthValues(), 'env', managedKey()), f.credentials, {
    env: { ZCODE_CREDENTIAL_SECRET: managedSecret }, readOsSecret,
  })).toEqual(oauthValues())
  await expect(decodeZCodeCredentials(encryptedRecord(oauthValues(), 'os', managedKey()), f.credentials, {
    env: { ZCODE_CREDENTIAL_SECRET: managedSecret }, readOsSecret,
  })).rejects.toMatchObject({ state: 'unavailable' })
  expect(readOsSecret).not.toHaveBeenCalled()
})
it('模拟：unknown envelopes and mismatched fingerprints never become plaintext or authenticated', async () => {
  const f = fixture()
  const raw = { 'oauth:active_provider': 'enc:v9:UNSUPPORTED' }
  writeFileSync(f.credentials, JSON.stringify(raw))
  expect(await zcodeGrokAccountStatus('zcode', { ...DEFAULT_CONFIG, zcodeAuthDirectory: f.auth }, new AbortController().signal, { home: f.root, env: {} }))
    .toMatchObject({ state: 'unknown' })
  const v2 = encryptedRecord(oauthValues(), 'env', managedKey())
  v2['oauth:active_provider'] = v2['oauth:active_provider']!.replace(/env:[a-f0-9]{24}:/, `env:${'0'.repeat(24)}:`)
  await expect(decodeZCodeCredentials(v2, f.credentials, { env: { ZCODE_CREDENTIAL_SECRET: managedSecret } })).rejects.toMatchObject({ state: 'unavailable' })
})
it.each(['bigmodel', 'zai'])('模拟：OAuth %s authenticates without a bound API key or profile and keeps secrets private', async (family) => {
  const f = fixture(), nativeProvider = `account:${family}-individual-coding-plan`
  const raw = encryptedRecord({
    [`account-provider:${nativeProvider}:identity`]: 'current/identity',
    [`account-provider:${nativeProvider}:auth-source`]: 'oauth',
    [`oauth:${family}:access_token`]: 'SYNTHETIC_OAUTH',
  }, 'env', managedKey())
  writeFileSync(f.credentials, JSON.stringify(raw))
  const status = await zcodeGrokAccountStatus('zcode', { ...DEFAULT_CONFIG, zcodeAuthDirectory: f.auth }, new AbortController().signal,
    { home: f.root, env: { ZCODE_CREDENTIAL_SECRET: managedSecret } })
  expect(status).toMatchObject({ state: 'authenticated', authMethod: 'oauth', verification: 'local' })
  expect(JSON.stringify(status)).not.toMatch(/SYNTHETIC|current\/identity|enc:/)
})
it.each(['unmarked', 'oauth', 'manual'] as const)(
  '模拟：%s account retains its same-identity bound key for catalog and native execution', async (source) => {
    const f = fixture()
    const raw: Record<string, string> = { ...f.values, ...oauthValues() }
    if (source === 'unmarked') delete raw[`account-provider:${provider}:auth-source`]
    else raw[`account-provider:${provider}:auth-source`] = source
    f.save(raw)
    f.config.revision = 1
    writeFileSync(f.builtin, JSON.stringify(f.config))
    const before = readFileSync(f.credentials)
    const fetcher = vi.fn(async (_url: any, options: any) => {
      expect(options.headers.Authorization).toBe('Bearer SYNTHETIC_CURRENT_KEY')
      return new Response(JSON.stringify({ data: [{ id: 'supported' }] }))
    })
    const models = await f.query(fetcher)
    expect(models.map((entry) => entry.id)).toEqual([`${provider}/supported`])
    expect(catalogNoticeOf(models)).toBeUndefined()
    expect(fetcher).toHaveBeenCalledOnce()
    expect(projectZCodeIdentity(raw, secret)).toMatchObject(source === 'manual'
      ? { state: 'configured', authMethod: 'api' }
      : { state: 'authenticated', authMethod: 'oauth' })
    vi.stubEnv('ZCODE_CREDENTIAL_SECRET', secret)
    for (const conversationId of [undefined, 'synthetic-resume']) {
      const launch = await prepareZCode({
        executable: '/synthetic/zcode', project: f.root, prompt: 'Synthetic; never executed',
        stateDirectory: join(f.root, conversationId ?? 'first-turn'), authDirectory: f.auth,
        nativeHome: join(f.root, 'empty-home'), builtinConfig: f.builtin,
        preference: { model: models[0]!.id, effort: 'low' }, mode: 'plan', nativeTransport: true, conversationId,
      })
      const bundle = JSON.parse(launch.env.CLIWORKER_ZCODE_NATIVE_ACCOUNT!)
      expect(bundle.binding).toEqual({ identity: 'current/identity', key: 'SYNTHETIC_CURRENT_KEY' })
      expect(JSON.stringify(bundle)).not.toMatch(/SYNTHETIC_OAUTH|SYNTHETIC_OLD_KEY/)
      expect(JSON.stringify(launch.argv)).not.toContain('SYNTHETIC_CURRENT_KEY')
    }
    expect(readFileSync(f.credentials)).toEqual(before)
  },
)
it.each(['unmarked', 'oauth'] as const)(
  '模拟：%s OAuth without its own bound key reports unsupported and never uses another identity key', async (source) => {
    const f = fixture(), fetcher = vi.fn()
    const raw: Record<string, string> = { ...f.values, ...oauthValues() }
    delete raw[`account-provider:coding-plan:${provider}:account:current%2Fidentity:api-key`]
    if (source === 'unmarked') delete raw[`account-provider:${provider}:auth-source`]
    f.save(raw)
    const models = await f.query(fetcher)
    expect(models).toEqual([])
    expect(catalogNoticeOf(models)).toContain('OAuth 已登录；项目访问令牌目录查询尚未支持')
    expect(fetcher).not.toHaveBeenCalled()
    expect(projectZCodeIdentity(raw, secret)).toMatchObject({ state: 'authenticated', authMethod: 'oauth' })
  },
)
it('模拟：OAuth never overrides an explicitly configured own-API-key route', async () => {
  const f = fixture()
  f.save(oauthValues())
  f.config.config.providerConfigRules.providerRules[0].config.access = { type: 'api-key', apiKey: 'SYNTHETIC_OWN_API' }
  writeFileSync(f.builtin, JSON.stringify(f.config))
  const fetcher = vi.fn(async (_url: any, options: any) => {
    expect(options.headers.Authorization).toBe('Bearer SYNTHETIC_OWN_API')
    return new Response(JSON.stringify({ data: [{ id: 'supported' }] }))
  })
  expect((await f.query(fetcher)).map((entry) => entry.id)).toEqual([`${provider}/supported`])
})
it('模拟：the actual binding hash and source IDs survive v1 to v2 migration, token renewal and key removal', async () => {
  const f = fixture()
  vi.stubEnv('ZCODE_DATA_BASE_DIR', f.auth)
  vi.stubEnv('ZCODE_PERSONAL_PROVIDER_CONFIG_FILE', '')
  vi.stubEnv('ZCODE_CREDENTIAL_SECRET', managedSecret)
  vi.stubEnv('ZCODE_CREDENTIAL_SECRET_FILE', '')
  const resolver = vi.spyOn(adapters, 'resolveCliExecutable').mockResolvedValue('/synthetic/zcode')
  const config = { ...DEFAULT_CONFIG, zcodeAuthDirectory: f.auth, zcodeBuiltinConfig: f.builtin }
  const run = () => readCliAccountBinding('zcode', {} as ProcessBackend, config, f.root, new AbortController().signal)
  try {
    writeFileSync(f.credentials, JSON.stringify(encryptedRecord(f.values, 'v1', managedKey())))
    const old = await run()
    writeFileSync(f.credentials, JSON.stringify(encryptedRecord({ ...f.values, ...oauthValues() }, 'env', managedKey())))
    expect(await run()).toBe(old)
    writeFileSync(f.credentials, JSON.stringify(encryptedRecord(oauthValues(), 'env', managedKey())))
    expect(await run()).toBe(old)
    const material = await readZCodeBindingMaterial('/synthetic/zcode', f.auth, f.builtin, { nativeHome: f.auth })
    expect(material.sourceIds).toEqual([resolve(f.auth)])
    expect(material.credentials[0]).toMatchObject({ identity: 'current/identity', key: '' })
    expect(JSON.stringify(material)).not.toContain('SYNTHETIC_OAUTH')
    vi.stubEnv('ZCODE_CREDENTIAL_SECRET', '')
    writeFileSync(join(f.auth, '.zcode/v2/credential-secret'), managedSecret, { mode: 0o600 })
    expect(await run()).toBe(old)
    writeFileSync(f.credentials, JSON.stringify(encryptedRecord({ ...oauthValues(), 'oauth:bigmodel:access_token': 'SYNTHETIC_RENEWED' }, 'env', managedKey())))
    expect(await run()).toBe(old)
    writeFileSync(f.credentials, JSON.stringify(encryptedRecord({ ...oauthValues(), [`account-provider:${provider}:identity`]: 'different-account' }, 'env', managedKey())))
    expect(await run()).not.toBe(old)
  } finally { resolver.mockRestore() }
})
it('模拟：unmarked OAuth identity no longer requires a legacy bound key', () => {
  const { [`account-provider:${provider}:auth-source`]: _, ...raw } = oauthValues()
  expect(projectZCodeIdentity(raw, secret)).toMatchObject({ state: 'authenticated', authMethod: 'oauth' })
})
it('模拟：the native child receives the unchanged secret-file path and preserves dual-source errors', async () => {
  const f = fixture(), path = join(f.root, 'secret file')
  writeFileSync(path, managedSecret, { mode: 0o600 })
  vi.stubEnv('ZCODE_CREDENTIAL_SECRET_FILE', path)
  vi.stubEnv('ZCODE_CREDENTIAL_SECRET', managedSecret)
  const launch = await prepareZCode({
    executable: '/synthetic/zcode', project: f.root, prompt: 'Synthetic; never executed',
    stateDirectory: join(f.root, 'state'), authDirectory: f.auth, nativeHome: join(f.root, 'empty-home'),
    builtinConfig: f.builtin, preference: { model: `${provider}/supported`, effort: 'low' }, mode: 'plan',
  })
  expect(launch.env).toMatchObject({ ZCODE_CREDENTIAL_SECRET: managedSecret, ZCODE_CREDENTIAL_SECRET_FILE: path })
  expect(JSON.stringify(launch.argv)).not.toContain(managedSecret)
})
it('模拟：OAuth without its same-identity key cannot produce a bridge bundle', async () => {
  const f = fixture()
  f.config.revision = 1
  writeFileSync(f.builtin, JSON.stringify(f.config))
  f.save({ ...oauthValues(), [`account-provider:coding-plan:${provider}:account:old:api-key`]: 'SYNTHETIC_OLD_KEY' })
  vi.stubEnv('ZCODE_CREDENTIAL_SECRET', secret)
  await expect(prepareZCode({
    executable: '/synthetic/zcode', project: f.root, prompt: 'Synthetic; never executed',
    stateDirectory: join(f.root, 'state'), authDirectory: f.auth, nativeHome: join(f.root, 'empty-home'),
    builtinConfig: f.builtin, preference: { model: `${provider}/supported`, effort: 'low' }, mode: 'plan', nativeTransport: true,
  })).rejects.toThrow('OAuth 已登录，但原生桥接尚未支持项目访问令牌')
})
it.each(['missing', 'short', 'symlink', 'oversized', 'public-mode'] as const)('模拟：unavailable %s secret file never falls back to the keychain', async (kind) => {
  const f = fixture(), path = join(f.auth, '.zcode/v2/credential-secret'), readOsSecret = vi.fn()
  if (kind !== 'missing') writeFileSync(path, kind === 'short' ? 'short' : kind === 'oversized' ? 'x'.repeat(4097) : managedSecret, { mode: 0o600 })
  if (kind === 'symlink') {
    rmSync(path)
    const target = join(f.root, 'secret-target')
    writeFileSync(target, managedSecret, { mode: 0o600 })
    symlinkSync(target, path)
  }
  if (kind === 'public-mode') chmodSync(path, 0o644)
  if (kind === 'public-mode' && process.platform === 'win32') return
  await expect(decodeZCodeCredentials(encryptedRecord(oauthValues(), 'env', managedKey()), f.credentials, {
    env: {}, readOsSecret,
  })).rejects.toMatchObject({ state: 'unavailable' })
  expect(readOsSecret).not.toHaveBeenCalled()
})

it.each(['legacy', 'unknown-envelope'] as const)(
  '模拟：unrelated undecryptable %s entries do not affect current status, catalog or binding', async (kind) => {
    const f = fixture()
    const raw = f.save({ ...f.values, ...oauthValues() })
    vi.stubEnv('ZCODE_DATA_BASE_DIR', f.auth)
    vi.stubEnv('ZCODE_PERSONAL_PROVIDER_CONFIG_FILE', '')
    vi.stubEnv('ZCODE_CREDENTIAL_SECRET', secret)
    vi.stubEnv('ZCODE_CREDENTIAL_SECRET_FILE', '')
    const config = { ...DEFAULT_CONFIG, zcodeAuthDirectory: f.auth, zcodeBuiltinConfig: f.builtin }
    const signal = new AbortController().signal
    const resolver = vi.spyOn(adapters, 'resolveCliExecutable').mockResolvedValue('/synthetic/zcode')
    const binding = () => readCliAccountBinding('zcode', {} as ProcessBackend, config, f.root, signal)
    try {
      const beforeBinding = await binding()
      const leftover = kind === 'legacy'
        ? encryptedRecord({ ignored: 'SYNTHETIC_LEFTOVER' }, 'v1', randomBytes(32)).ignored!
        : 'enc:v99:SYNTHETIC_UNSUPPORTED'
      const withLeftovers = {
        ...raw,
        [`account-provider:coding-plan:${provider}:account:old:api-key`]: leftover,
        'oauth:zai:access_token': leftover,
        'oauth:bigmodel:refresh_token': leftover,
      }
      writeFileSync(f.credentials, JSON.stringify(withLeftovers))
      const before = readFileSync(f.credentials)
      expect(await zcodeGrokAccountStatus('zcode', config, signal, { home: f.root, credentialSecret: secret }))
        .toMatchObject({ state: 'authenticated', authMethod: 'oauth' })
      expect(projectZCodeIdentity(withLeftovers, secret)).toMatchObject({ state: 'authenticated', authMethod: 'oauth' })
      const fetcher = vi.fn(async (_url: any, options: any) => {
        expect(options.headers.Authorization).toBe('Bearer SYNTHETIC_CURRENT_KEY')
        return new Response(JSON.stringify({ data: [{ id: 'supported' }] }))
      })
      expect((await f.query(fetcher)).map((model) => model.id)).toEqual([`${provider}/supported`])
      expect(fetcher).toHaveBeenCalledOnce()
      expect(await binding()).toBe(beforeBinding)
      expect(readFileSync(f.credentials)).toEqual(before)
    } finally { resolver.mockRestore() }
  },
)
it.each([
  `account-provider:${provider}:identity`,
  `account-provider:${provider}:auth-source`,
  'oauth:bigmodel:access_token',
  `account-provider:coding-plan:${provider}:account:current%2Fidentity:api-key`,
])('模拟：undecryptable required credential %s fails closed without catalog requests', async (name) => {
  const f = fixture(), raw = f.save({ ...f.values, ...oauthValues() })
  raw[name] = encryptedRecord({ required: 'SYNTHETIC_UNREADABLE_REQUIRED' }, 'v1', randomBytes(32)).required!
  writeFileSync(f.credentials, JSON.stringify(raw))
  const before = readFileSync(f.credentials)
  const status = await zcodeGrokAccountStatus('zcode', { ...DEFAULT_CONFIG, zcodeAuthDirectory: f.auth },
    new AbortController().signal, { home: f.root, credentialSecret: secret })
  expect(status).toMatchObject({ state: 'unavailable' })
  expect(JSON.stringify(status)).not.toMatch(/SYNTHETIC|enc:/)
  const fetcher = vi.fn()
  await expect(f.query(fetcher)).rejects.toThrow('无法安全读取 ZCode 当前账号')
  expect(fetcher).not.toHaveBeenCalled()
  expect(readFileSync(f.credentials)).toEqual(before)
})
it('模拟：a requested profile decryption failure is not swallowed as missing user info', async () => {
  const f = fixture(), raw = f.save({ ...f.values, ...oauthValues() })
  raw['oauth:bigmodel:user_info'] = encryptedRecord({ info: 'SYNTHETIC_BAD_PROFILE' }, 'v1', randomBytes(32)).info!
  writeFileSync(f.credentials, JSON.stringify(raw))
  expect(await zcodeGrokAccountStatus('zcode', { ...DEFAULT_CONFIG, zcodeAuthDirectory: f.auth },
    new AbortController().signal, { home: f.root, credentialSecret: secret })).toMatchObject({ state: 'unavailable' })
})
it('模拟：manual credentials do not decode a leftover OAuth access token', async () => {
  const f = fixture()
  const raw = f.save({ ...f.values, ...oauthValues(), [`account-provider:${provider}:auth-source`]: 'manual' })
  raw['oauth:bigmodel:access_token'] = encryptedRecord({ token: 'SYNTHETIC_BAD_OAUTH' }, 'v1', randomBytes(32)).token!
  writeFileSync(f.credentials, JSON.stringify(raw))
  expect(await zcodeGrokAccountStatus('zcode', { ...DEFAULT_CONFIG, zcodeAuthDirectory: f.auth },
    new AbortController().signal, { home: f.root, credentialSecret: secret })).toMatchObject({ state: 'configured', authMethod: 'api' })
  const fetcher = vi.fn(async (_url: any, options: any) => {
    expect(options.headers.Authorization).toBe('Bearer SYNTHETIC_CURRENT_KEY')
    return new Response(JSON.stringify({ data: [{ id: 'supported' }] }))
  })
  expect((await f.query(fetcher)).map((model) => model.id)).toEqual([`${provider}/supported`])
})
