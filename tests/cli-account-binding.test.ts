import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { CLI_IDS, type CliId } from '../src/shared/types.ts'
import {
  DEFAULT_CONFIG,
  ProcessCleanupUnconfirmedError,
  type ProcessBackend,
  type RuntimeConfig,
} from '../src/host/process.ts'

// Entirely synthetic native homes/materials. No real credentials, subprocesses or HTTP.
const fixture = vi.hoisted(() => ({
  home: '',
  status: {} as any,
  sources: {} as Record<string, any[]>,
  codex: undefined as any,
  windowsAgy: undefined as any,
}))
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  homedir: () => fixture.home,
}))
vi.mock('../src/host/adapters.ts', () => ({
  resolveCliExecutable: vi.fn(async (cli: string) => `/synthetic/${cli}`),
  captureCatalogMetadata: vi.fn(async () => JSON.stringify(fixture.status)),
  catalogFor: vi.fn(),
  validatePreference: vi.fn(),
}))
vi.mock('../src/host/first-party-models.ts', async (original) => ({
  ...(await original<typeof import('../src/host/first-party-models.ts')>()),
  readFirstPartyModelSources: vi.fn(async (cli: string) => fixture.sources[cli] ?? []),
}))
vi.mock('../src/host/claude-own-route.ts', async (original) => ({
  ...(await original<typeof import('../src/host/claude-own-route.ts')>()),
  readClaudeOwnRoute: vi.fn(async () =>
    fixture.sources.claude?.length
      ? {
          kind: 'api',
          sourceIds: fixture.sources.claude[0].sourceIds,
          source: fixture.sources.claude[0],
          modelEnvironment: fixture.sources.claude[0].modelEnvironment,
          model: fixture.sources.claude[0].model,
        }
      : { kind: 'native', sourceIds: [fixture.home] },
  ),
}))
vi.mock('../src/host/codex-account.ts', () => ({ readCodexAccount: vi.fn(async () => fixture.codex) }))
// Windows reads native keyring metadata instead of the POSIX token file below.
// This is the same synthetic identity, never a real Credential Manager read.
vi.mock('../src/host/agy-windows-account.ts', async (original) => ({
  ...(await original<typeof import('../src/host/agy-windows-account.ts')>()),
  readWindowsAgyAccount: vi.fn(async () => fixture.windowsAgy ?? { identity: { state: 'unconfigured' } }),
}))
// macOS keeps the AGY login in the keychain item, which holds the same JSON as the
// token file; these synthetic fixtures stand in for that item, never a real keychain.
vi.mock('../src/host/agy-macos-account.ts', async (original) => {
  const { existsSync, readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  return {
    ...(await original<typeof import('../src/host/agy-macos-account.ts')>()),
    readMacAgyCredential: vi.fn(async () => {
      const path = join(fixture.home, '.gemini/jetski-standalone-oauth-token')
      return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
    }),
  }
})
import {
  codexRouteEnvironment,
  readCliAccountBinding,
  readCodexOwnAccountSource,
} from '../src/host/cli-account-binding.ts'
import { captureCatalogMetadata, catalogFor } from '../src/host/adapters.ts'
import { authorizeSelection } from '../src/host/authorized-catalog.ts'
const backend: ProcessBackend = { resolveExecutable: vi.fn(), spawn: vi.fn() }
let config: RuntimeConfig, project: string
const write = (path: string, value: unknown, raw = false) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, raw ? String(value) : JSON.stringify(value), { mode: 0o600 })
}
const jwt = (sub: string, extra: Record<string, unknown> = {}) =>
  `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub, iss: 'https://synthetic.example', exp: 4e9, ...extra })).toString('base64url')}.synthetic`
const run = (cli: CliId, signal = new AbortController().signal) =>
  readCliAccountBinding(cli, backend, config, project, signal)

it('binds explicit Claude bearer credentials as API material, including endpoint and header mode', async () => {
  fixture.status = { loggedIn: true, authMethod: 'oauth_token', email: 'synthetic@example.test' }
  const source = {
    provider: 'anthropic',
    credential: { type: 'api', key: 'synthetic-claude-bearer' },
    sourceIds: [join(fixture.home, '.claude/settings.json')],
    baseUrl: 'https://own.example.test',
    apiType: 'anthropic-messages',
    anthropicAuth: 'bearer',
  }
  fixture.sources.claude = [source]
  const bearer = await run('claude')
  expect(bearer).toMatch(/^cli-account-v1:/)
  expect(bearer).not.toContain(source.credential.key)
  fixture.status.email = 'unrelated-native-label@example.test'
  expect(await run('claude')).toBe(bearer)
  source.credential.key = 'synthetic-changed-bearer'
  expect(await run('claude')).not.toBe(bearer)
  source.credential.key = 'synthetic-claude-bearer'
  source.baseUrl = 'https://other-own.example.test'
  expect(await run('claude')).not.toBe(bearer)
  source.baseUrl = 'https://own.example.test'
  source.anthropicAuth = 'api-key-and-bearer'
  expect(await run('claude')).not.toBe(bearer)
  fixture.sources.claude = []
  await expect(run('claude')).rejects.toThrow('Claude 官方登录来源无法确认')
  fixture.status = { loggedIn: false, authMethod: 'none' }
  await expect(run('claude')).rejects.toThrow('Claude 官方账号未登录')
})

it('invalidates Claude preferences when CC Switch changes only its synthetic model mapping', async () => {
  fixture.status = { loggedIn: true, authMethod: 'oauth_token' }
  const source = {
    provider: 'anthropic',
    credential: { type: 'api', key: 'synthetic-unchanged-router-key' },
    sourceIds: [join(fixture.home, '.claude/settings.json')],
    baseUrl: 'https://unchanged-router.example.test',
    apiType: 'anthropic-messages',
    anthropicAuth: 'bearer',
    model: 'sonnet',
    modelEnvironment: {
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'synthetic-route-a[1m]',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'synthetic-route-opus',
    },
  }
  fixture.sources.claude = [source]
  const admitted = await run('claude')
  // Object ordering alone is not a route change.
  source.modelEnvironment = {
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'synthetic-route-opus',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'synthetic-route-a[1m]',
  }
  expect(await run('claude')).toBe(admitted)
  source.modelEnvironment.ANTHROPIC_DEFAULT_SONNET_MODEL = 'synthetic-route-b[1m]'
  expect(await run('claude')).not.toBe(admitted)
  await expect(
    authorizeSelection(
      { cli: 'claude', model: 'sonnet', effort: 'default' },
      backend,
      config,
      project,
      new AbortController().signal,
      admitted,
    ),
  ).rejects.toThrow('账号已变更')
  expect(catalogFor).not.toHaveBeenCalled()
  source.modelEnvironment.ANTHROPIC_DEFAULT_SONNET_MODEL = 'synthetic-route-a[1m]'
  source.model = 'opus'
  expect(await run('claude')).not.toBe(admitted)
  expect(admitted).not.toMatch(/synthetic-unchanged-router-key|unchanged-router|synthetic-route-a/)
})

it('binds supported OpenCode API accounts even alongside an unsupported opaque OAuth account', async () => {
  const path = join(fixture.home, '.local/share/opencode/auth.json')
  const api = { type: 'api', key: 'synthetic-own-api-key' }
  write(path, {
    own: api,
    oauth: { type: 'oauth', access: 'synthetic-opaque', refresh: 'synthetic-refresh', expires: 4e12 },
  })
  const binding = await run('opencode')
  write(path, {
    own: api,
    oauth: { type: 'oauth', access: 'synthetic-renewed', refresh: 'synthetic-new-refresh', expires: 4e12 },
  })
  expect(await run('opencode')).toBe(binding)
  write(path, {
    oauth: { type: 'oauth', access: 'synthetic-opaque', refresh: 'synthetic-refresh', expires: 4e12 },
  })
  await expect(run('opencode')).rejects.toThrow('OpenCode OAuth 暂无法安全续期')
})

it('an unsupported Pi OAuth provider does not hide another provider with its own API account', async () => {
  const path = join(fixture.home, '.pi/agent/auth.json')
  write(path, {
    own: { type: 'api_key', key: 'synthetic-own-api-key' },
    oauth: { type: 'oauth', access: 'synthetic-opaque', refresh: 'synthetic-refresh', expires: 4e12 },
  })
  await expect(run('pi')).resolves.toMatch(/^cli-account-v1:/)
  write(path, {
    oauth: { type: 'oauth', access: 'synthetic-opaque', refresh: 'synthetic-refresh', expires: 4e12 },
  })
  await expect(run('pi')).rejects.toThrow('无法确认当前自身账号')
})
beforeEach(() => {
  vi.clearAllMocks()
  fixture.home = mkdtempSync(join(tmpdir(), 'cwn-binding-synthetic-'))
  fixture.sources = {}
  fixture.status = {}
  fixture.codex = undefined
  fixture.windowsAgy = undefined
  config = {
    ...DEFAULT_CONFIG,
    stateDirectory: join(fixture.home, 'plugin'),
    hermesHome: join(fixture.home, '.hermes'),
    zcodeAuthDirectory: join(fixture.home, 'zcode'),
  }
  project = join(fixture.home, 'project')
  mkdirSync(project)
  for (const name of [
    'CODEX_HOME',
    'CLAUDE_CONFIG_DIR',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'OPENCODE_MODELS_PATH',
    'ZCODE_DATA_BASE_DIR',
    'ZCODE_PERSONAL_PROVIDER_CONFIG_FILE',
    'QODER_PERSONAL_ACCESS_TOKEN',
    'QODERCLI_SITE',
    'QODER_JOB_TOKEN',
    'QODER_SERVICE_ACCOUNT_KEY',
    'QODER_SDK_AUTH_PAYLOAD_FILE',
    'QODER_SDK_AUTH_CONFIG_DIR',
    'QODER_CENTER_ENDPOINT',
    'QODER_SERVER_ENDPOINT',
    'QODER_VPC_ENDPOINT',
    'QODER_ENV_VPC_ENABLED',
    'QODER_ENV',
    'QODER_RUNNING_ENV',
  ])
    vi.stubEnv(name, '')
  vi.stubEnv('ZCODE_DATA_BASE_DIR', fixture.home)
  vi.stubEnv('QODER_CONFIG_DIR', join(fixture.home, '.qoder'))
  vi.stubEnv('TRAE_HOME', join(fixture.home, '.trae'))
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(fixture.home, { force: true, recursive: true })
})

function agy(sub = 'own-agy', refresh = 'synthetic-refresh') {
  fixture.windowsAgy = {
    identity: { state: 'authenticated', authMethod: 'oauth', verification: 'local' },
    principalHash: createHash('sha256').update(`google:${sub}`).digest('hex'),
  }
  write(join(fixture.home, '.gemini/jetski-standalone-oauth-token'), {
    auth_method: 'consumer',
    token: { access_token: jwt(sub), refresh_token: refresh, expiry: '2099-01-01T00:00:00Z' },
    id_token: jwt(sub),
  })
}
function zcode(identity = 'own-zcode', key = 'synthetic-zcode-key') {
  const provider = 'account:bigmodel-individual-coding-plan'
  config.zcodeBuiltinConfig = join(fixture.home, 'zcode-builtin.json')
  write(config.zcodeBuiltinConfig, {
    schemaVersion: 1,
    config: {
      providerConfigRules: {
        providerRules: [
          {
            providerId: provider,
            config: {
              access: { type: 'zhipu-account', accountType: 'bigmodel', mode: 'individual-coding-plan' },
              api: { type: 'openai-chat-completions', baseUrl: 'https://synthetic.example/v1' },
              builtinModelIds: ['synthetic-model'],
            },
          },
        ],
      },
      modelConfigRules: {
        modelRules: [{ modelMatch: '.*', config: { enabled: true } }],
        modelApiRules: [],
        providerSiteRules: [],
        templateModelRules: [],
        builtinProviderModelRules: [],
      },
    },
  })
  write(join(config.zcodeAuthDirectory!, '.zcode/v2/credentials.json'), {
    [`account-provider:${provider}:identity`]: identity,
    [`account-provider:coding-plan:${provider}:account:${encodeURIComponent(identity)}:api-key`]: key,
  })
}
function own(cli: CliId) {
  if (cli === 'antigravity') agy()
  else if (cli === 'codex')
    write(join(fixture.home, '.codex/auth.json'), {
      auth_mode: 'chatgpt',
      tokens: {
        access_token: jwt('own-codex'),
        refresh_token: 'synthetic-refresh',
        id_token: jwt('own-codex'),
        account_id: 'own-workspace',
      },
    })
  else if (cli === 'claude')
    fixture.status = {
      loggedIn: true,
      authMethod: 'claude.ai',
      email: 'own@synthetic.example',
      orgId: 'own-org',
    }
  else if (cli === 'kimi' || cli === 'mimo')
    fixture.sources[cli] = [
      {
        provider: `own-${cli}`,
        credential: { type: 'api', key: `synthetic-${cli}-key` },
        sourceIds: [join(fixture.home, `.${cli}`, 'config')],
        baseUrl: 'https://synthetic.example/v1',
        apiType: 'openai-completions',
      },
    ]
  else if (cli === 'pi')
    write(join(fixture.home, '.pi/agent/auth.json'), { own: { type: 'api_key', key: 'synthetic-pi-key' } })
  else if (cli === 'omp') {
    const file = join(fixture.home, '.omp/agent/agent.db')
    mkdirSync(dirname(file), { recursive: true })
    const db = new DatabaseSync(file)
    db.exec(
      'CREATE TABLE auth_credentials(provider TEXT, credential_type TEXT, data TEXT, disabled_cause TEXT)',
    )
    db.prepare('INSERT INTO auth_credentials VALUES(?,?,?,NULL)').run(
      'own',
      'api_key',
      JSON.stringify({ key: 'synthetic-omp-key' }),
    )
    db.close()
  } else if (cli === 'opencode')
    write(join(fixture.home, '.local/share/opencode/auth.json'), {
      own: { type: 'api', key: 'synthetic-opencode-key' },
    })
  else if (cli === 'qoder') vi.stubEnv('QODER_PERSONAL_ACCESS_TOKEN', 'synthetic-own-qoder-pat')
  else if (cli === 'qodercn') vi.stubEnv('QODERCN_PERSONAL_ACCESS_TOKEN', 'synthetic-own-qodercn-pat')
  else if (cli === 'traecn') write(join(fixture.home, '.trae/cli/auth.json'), { auth_mode: 'trae', trae: { user_id: '模拟-trae-user' } })
  else if (cli === 'zcode') zcode()
  else if (cli === 'grok')
    write(join(fixture.home, '.grok/auth.json'), {
      'https://auth.x.ai::synthetic-client': {
        auth_mode: 'oidc',
        key: jwt('own-grok'),
        email: 'own@synthetic.example',
        refresh_token: 'synthetic-refresh',
      },
    })
  else if (cli === 'hermes') {
    write(
      join(fixture.home, '.hermes/config.yaml'),
      'auth:\n  adopt_external_logins: false\nmodel:\n  provider: openrouter\n  default: synthetic-model\n',
      true,
    )
    write(join(fixture.home, '.hermes/.env'), 'OPENROUTER_API_KEY=synthetic-hermes-key\n', true)
  }
}

it.each(CLI_IDS)('binds only synthetic %s own sources and returns a bounded opaque epoch', async (cli) => {
  own(cli)
  const epoch = await run(cli)
  expect(epoch).toMatch(/^cli-account-v1:[a-f0-9]{64}$/)
  expect(epoch).not.toMatch(/synthetic|own-|key|token|@/)
  expect(await run(cli)).toBe(epoch)
})

it.each(CLI_IDS)(
  'rejects %s with no own account even when ambient and Host credentials exist',
  async (cli) => {
    for (const name of [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'KIMI_API_KEY',
      'OPENROUTER_API_KEY',
      'ZAI_CODING_CN_API_KEY',
      'CLAUDE_CODE_OAUTH_TOKEN',
    ])
      vi.stubEnv(name, 'synthetic-host-key')
    const resolver = vi.fn(async () => 'synthetic-host-key')
    config.zaiCredentialRef = 'provider:host'
    config.resolveCredential = resolver
    // Build valid native capability/config data, then remove only its own credential.
    if (cli === 'zcode') {
      zcode()
      rmSync(join(config.zcodeAuthDirectory!, '.zcode/v2/credentials.json'))
    }
    if (cli === 'hermes')
      write(
        join(fixture.home, '.hermes/config.yaml'),
        'auth:\n  adopt_external_logins: false\nmodel:\n  provider: openrouter\n',
        true,
      )
    await expect(run(cli)).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
    expect(resolver).not.toHaveBeenCalled()
  },
)

it('does not let Pi and OMP impersonate each other, including worker snapshots', async () => {
  own('pi')
  write(join(config.stateDirectory!, 'workers/old/agent/auth.json'), {
    own: { type: 'api_key', key: 'synthetic-old-key' },
  })
  await expect(run('omp')).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
  const pi = await run('pi')
  own('omp')
  expect(await run('omp')).not.toBe(pi)
  rmSync(join(fixture.home, '.pi/agent/auth.json'))
  await expect(run('pi')).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
})

it('keeps OAuth rotation stable, but changes on account switch and rejects logout', async () => {
  agy()
  const first = await run('antigravity')
  agy('own-agy', 'synthetic-rotated-refresh')
  expect(await run('antigravity')).toBe(first)
  agy('different-user')
  expect(await run('antigravity')).not.toBe(first)
  rmSync(join(fixture.home, '.gemini/jetski-standalone-oauth-token'))
  fixture.windowsAgy = undefined
  await expect(run('antigravity')).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
})

// AGY 1.4.x keeps only id_token_email (issue #7); field shape is synthetic, values are fake.
function agyEmailOnly(email: unknown, refresh = 'synthetic-refresh') {
  write(join(fixture.home, '.gemini/jetski-standalone-oauth-token'), {
    auth_method: 'consumer',
    token: { access_token: 'synthetic-opaque-access', refresh_token: refresh, expiry: '2099-01-01T00:00:00Z' },
    id_token_email: email,
  })
}

// The POSIX token file; Windows reads its credential store (next test).
it.skipIf(process.platform === 'win32')('binds an Antigravity login that keeps only id_token_email, stable across case and rotation', async () => {
  agyEmailOnly('Own@Example.test')
  const first = await run('antigravity')
  agyEmailOnly('own@example.test', 'synthetic-rotated-refresh')
  expect(await run('antigravity')).toBe(first)
  agyEmailOnly('other@example.test')
  expect(await run('antigravity')).not.toBe(first)
  for (const unsafe of [undefined, '', 'not-an-email', '<script>@example.test', `${'a'.repeat(250)}@example.test`]) {
    agyEmailOnly(unsafe)
    await expect(run('antigravity')).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
  }
})

it('binds a Windows Antigravity credential without id_token by its local email only when logged in', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: 'win32' })
  try {
    const email = (accountLabel?: string, state = 'authenticated') => {
      fixture.windowsAgy = { identity: { state, authMethod: 'oauth', verification: 'local', accountLabel } }
    }
    email('Own@Example.test')
    const first = await run('antigravity')
    email('own@example.test')
    expect(await run('antigravity')).toBe(first)
    email('other@example.test')
    expect(await run('antigravity')).not.toBe(first)
    agy()
    expect(await run('antigravity')).not.toBe(first)
    email(undefined)
    await expect(run('antigravity')).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
    email('own@example.test', 'unauthenticated')
    await expect(run('antigravity')).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
  } finally {
    Object.defineProperty(process, 'platform', platform)
  }
})

it('rejects an Antigravity route change even when its old consumer login file remains', async () => {
  agy()
  await run('antigravity')
  write(join(fixture.home, '.gemini/antigravity-cli/settings.json'), { modelProvider: 'gemini' })
  await expect(run('antigravity')).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
})

it('binds Codex account and workspace, not refreshed access/refresh tokens', async () => {
  own('codex')
  const first = await run('codex')
  const path = join(fixture.home, '.codex/auth.json')
  write(path, {
    tokens: {
      access_token: jwt('own-codex', { exp: 4e9 + 100 }),
      id_token: jwt('own-codex'),
      refresh_token: 'synthetic-new-refresh',
      account_id: 'own-workspace',
    },
  })
  expect(await run('codex')).toBe(first)
  const source = await readCodexOwnAccountSource(project, new AbortController().signal)
  expect(source.credential.expires).toBe((4e9 + 100) * 1000)
  write(path, {
    tokens: {
      access_token: jwt('own-codex'),
      refresh_token: 'synthetic-new-refresh',
      id_token: jwt('own-codex'),
      account_id: 'other-workspace',
    },
  })
  expect(await run('codex')).not.toBe(first)
})

it('uses the effective Codex keyring account rather than an old file or API-only status', async () => {
  own('codex')
  write(join(fixture.home, '.codex/config.toml'), 'cli_auth_credentials_store = "keyring"\n', true)
  fixture.codex = { state: 'authenticated', authMethod: 'oauth', accountLabel: 'current@synthetic.example' }
  const first = await run('codex')
  fixture.codex.accountLabel = 'changed@synthetic.example'
  expect(await run('codex')).not.toBe(first)
  fixture.codex = { state: 'authenticated', authMethod: 'api' }
  await expect(run('codex')).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
  await expect(readCodexOwnAccountSource(project, new AbortController().signal)).rejects.toThrow()
})

it.each([
  'model_provider = "other"',
  '[model_providers.other]\nbase_url = "https://other.synthetic.example"',
  '[profiles.other]\nmodel = "other"',
])('binds a Codex relay route set in its own config: %s', async (toml) => {
  write(join(fixture.home, '.codex/config.toml'), toml, true)
  expect(await run('codex')).toMatch(/^cli-account-v1:/)
  // The official account source still refuses to guess the relay's endpoint.
  await expect(readCodexOwnAccountSource(project, new AbortController().signal)).rejects.toThrow()
})

it('versions a Codex relay route by its config, its env_key value and auth.json', async () => {
  const config = join(fixture.home, '.codex/config.toml')
  write(
    config,
    'model_provider = "relay"\n[model_providers.relay]\nbase_url = "https://relay.synthetic.example/v1"\nenv_key = "SYNTHETIC_RELAY_KEY"\n',
    true,
  )
  vi.stubEnv('SYNTHETIC_RELAY_KEY', 'synthetic-relay-key-1')
  const first = await run('codex')
  expect(await run('codex')).toBe(first)
  expect(first).not.toContain('synthetic-relay-key-1')
  vi.stubEnv('SYNTHETIC_RELAY_KEY', 'synthetic-relay-key-2')
  const rotated = await run('codex')
  expect(rotated).not.toBe(first)
  write(join(fixture.home, '.codex/auth.json'), { OPENAI_API_KEY: 'synthetic-relay-auth' })
  const withAuth = await run('codex')
  expect(withAuth).not.toBe(rotated)
  write(config, 'model = "other"\nmodel_provider = "relay"\n', true)
  expect(await run('codex')).not.toBe(withAuth)
  // A relay's auth.json must still be a JSON object.
  write(join(fixture.home, '.codex/auth.json'), '[]', true)
  await expect(run('codex')).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
})

it('passes only the env_key variables a Codex relay names to its workers', async () => {
  const signal = new AbortController().signal
  vi.stubEnv('SYNTHETIC_RELAY_KEY', 'synthetic-relay-key')
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-host-key')
  expect(await codexRouteEnvironment(project, signal)).toEqual({})
  write(
    join(fixture.home, '.codex/config.toml'),
    'model_provider = "relay"\n[model_providers.relay]\nenv_key = "SYNTHETIC_RELAY_KEY"\n[model_providers.unset]\nenv_key = "SYNTHETIC_UNSET_KEY"\n',
    true,
  )
  expect(await codexRouteEnvironment(project, signal)).toEqual({ SYNTHETIC_RELAY_KEY: 'synthetic-relay-key' })
})

it('rejects an unsafe Codex relay config instead of versioning part of it', async () => {
  const real = join(fixture.home, 'elsewhere.toml')
  write(real, 'model_provider = "relay"\n', true)
  mkdirSync(join(fixture.home, '.codex'), { recursive: true })
  symlinkSync(real, join(fixture.home, '.codex/config.toml'))
  await expect(run('codex')).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
})

it('binds a relay in ancestor config but still rejects inherited route variables alone', async () => {
  own('codex')
  write(join(project, '.codex/config.toml'), 'chatgpt_base_url = "https://other.synthetic.example"', true)
  const child = join(project, 'nested')
  mkdirSync(child)
  await expect(readCodexOwnAccountSource(child, new AbortController().signal)).rejects.toThrow()
  expect(await readCliAccountBinding('codex', backend, config, child, new AbortController().signal)).toMatch(
    /^cli-account-v1:/,
  )
  rmSync(join(project, '.codex/config.toml'))
  vi.stubEnv('OPENAI_BASE_URL', 'https://other.synthetic.example')
  await expect(run('codex')).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
})

it('confirms the default Codex API route from the own file key only', async () => {
  write(join(fixture.home, '.codex/auth.json'), {
    auth_mode: 'apikey',
    OPENAI_API_KEY: 'synthetic-own-api-key',
  })
  const source = await readCodexOwnAccountSource(project, new AbortController().signal)
  expect(source).toMatchObject({
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    nativeRouteConfirmed: true,
  })
  expect(await run('codex')).toMatch(/^cli-account-v1:/)
})

it('keeps ZCode bound identity through key renewal and rejects orphaned old keys', async () => {
  zcode()
  const first = await run('zcode')
  zcode('own-zcode', 'synthetic-renewed-key')
  expect(await run('zcode')).toBe(first)
  zcode('other-zcode')
  expect(await run('zcode')).not.toBe(first)
  write(join(config.zcodeAuthDirectory!, '.zcode/v2/credentials.json'), {
    'account-provider:coding-plan:account:bigmodel-individual-coding-plan:account:old:api-key':
      'synthetic-old-key',
  })
  await expect(run('zcode')).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
})

it('detects API replacement, endpoint changes and source switches independently', async () => {
  own('kimi')
  const first = await run('kimi')
  fixture.sources.kimi![0].credential.key = 'synthetic-new-key'
  const keyChanged = await run('kimi')
  expect(keyChanged).not.toBe(first)
  fixture.sources.kimi![0].baseUrl = 'https://other.synthetic.example/v1'
  const endpointChanged = await run('kimi')
  expect(endpointChanged).not.toBe(keyChanged)
  fixture.sources.kimi![0].sourceIds = [join(fixture.home, 'other-native-home')]
  expect(await run('kimi')).not.toBe(endpointChanged)
})

it('accepts Pi private env references but never resolves them from ambient env', async () => {
  write(join(fixture.home, '.pi/agent/models.json'), {
    providers: { custom: { apiKey: 'CUSTOM_API_KEY', baseUrl: 'https://synthetic.example/v1' } },
  })
  vi.stubEnv('CUSTOM_API_KEY', 'synthetic-global-key')
  await expect(run('pi')).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
  write(join(fixture.home, '.pi/agent/.env'), 'CUSTOM_API_KEY=synthetic-private-key\n', true)
  const first = await run('pi')
  write(join(fixture.home, '.pi/agent/.env'), 'CUSTOM_API_KEY=synthetic-new-private-key\n', true)
  expect(await run('pi')).not.toBe(first)
})

it('detects moving the same Pi key from global to plugin account provenance', async () => {
  own('pi')
  const first = await run('pi')
  rmSync(join(fixture.home, '.pi/agent/auth.json'))
  write(join(config.stateDirectory!, 'accounts/pi/agent/auth.json'), {
    own: { type: 'api_key', key: 'synthetic-pi-key' },
  })
  expect(await run('pi')).not.toBe(first)
})

it('rejects Hermes automatic imports and saved foreign account pools', async () => {
  own('hermes')
  write(join(fixture.home, '.hermes/config.yaml'), 'model:\n  provider: openrouter\n', true)
  await expect(run('hermes')).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
  own('hermes')
  write(join(fixture.home, '.hermes/auth.json'), {
    credential_pool: {
      openrouter: [{ auth_type: 'api_key', source: 'codex', access_token: 'synthetic-foreign-key' }],
    },
  })
  await expect(run('hermes')).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
})

it('rejects a redirected account file without exposing paths or secret values', async () => {
  const path = join(fixture.home, '.codex/auth.json')
  write(join(fixture.home, '.pi/agent/auth.json'), { OPENAI_API_KEY: 'synthetic-foreign-secret' })
  mkdirSync(dirname(path), { recursive: true })
  symlinkSync(join(fixture.home, '.pi/agent/auth.json'), path)
  await expect(run('codex')).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
  try {
    await run('codex')
  } catch (error) {
    expect(String(error)).not.toMatch(/synthetic-foreign|cwn-binding|auth.json/)
  }
})

it('preserves cancellation and unconfirmed metadata cleanup failures', async () => {
  const controller = new AbortController()
  controller.abort(new Error('synthetic-cancelled'))
  await expect(run('pi', controller.signal)).rejects.toThrow('synthetic-cancelled')
  vi.mocked(captureCatalogMetadata).mockRejectedValueOnce(new ProcessCleanupUnconfirmedError())
  await expect(run('claude')).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
})

it('prioritizes cleanup failure over simultaneous cancellation', async () => {
  const controller = new AbortController()
  vi.mocked(captureCatalogMetadata).mockImplementationOnce(async () => {
    controller.abort(new Error('synthetic-cancelled'))
    throw new ProcessCleanupUnconfirmedError()
  })
  await expect(run('claude', controller.signal)).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
})

it('binds the exact selected Claude source snapshot instead of silently rereading a restored configuration', async () => {
  const a = {
    provider: 'anthropic',
    credential: { type: 'api', key: 'synthetic-A' },
    baseUrl: 'http://127.0.0.1:15721',
    apiType: 'anthropic-messages',
    anthropicAuth: 'bearer',
    sourceIds: [join(fixture.home, '.claude/settings.json')],
    nativeModels: [],
    model: 'sonnet',
    modelEnvironment: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'synthetic-model-a' },
  }
  fixture.sources.claude = [a]
  const admitted = await run('claude')
  const b = { ...a, credential: { type: 'api', key: 'synthetic-B' } }
  const prepared = await readCliAccountBinding(
    'claude',
    backend,
    config,
    project,
    new AbortController().signal,
    { kind: 'proxy', sourceIds: b.sourceIds, source: b },
  )
  expect(prepared).not.toBe(admitted)
  expect(await run('claude')).toBe(admitted)
  const remapped = {
    ...a,
    modelEnvironment: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'synthetic-model-b' },
  }
  fixture.sources.claude = [remapped]
  expect(await run('claude')).not.toBe(admitted)
  expect(
    await readCliAccountBinding('claude', backend, config, project, new AbortController().signal, {
      kind: 'proxy',
      sourceIds: a.sourceIds,
      source: a,
      model: a.model,
      modelEnvironment: a.modelEnvironment,
    }),
  ).toBe(admitted)
})
