import { afterEach, expect, it } from 'vitest'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
  symlink,
  link,
  lstat,
  rename,
  readdir,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  readKimiAccount,
  prepareKimiAccountDirectory,
  readKimiOwnToken,
  resolveKimiTokenStorageName,
} from '../src/host/kimi-accounts.ts'

// Explicit synthetic native provider JSON and token files. No CLI or network.
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'kimi-account-synthetic-')))
  roots.push(home)
  await mkdir(join(home, 'credentials'), { mode: 0o700 })
  const path = join(home, 'credentials/kimi-code.json')
  const config = {
    providers: { 'managed:kimi-code': { type: 'kimi', oauth: { storage: 'file', key: 'oauth/kimi-code' } } },
    models: {},
  }
  const now = 2_000_000_000_000
  const token = {
    access_token: 'synthetic-access',
    refresh_token: 'synthetic-refresh',
    expires_at: now / 1000 + 60,
  }
  return {
    home,
    path,
    config,
    token,
    set: (value: unknown) => writeFile(path, JSON.stringify(value), { mode: 0o600 }),
    read: (value: unknown = config, signal = new AbortController().signal) =>
      readKimiAccount(JSON.stringify(value), signal, { home, now }),
  }
}

// The managed Kimi Code OAuth login as one removable row of the account window.
const OAUTH_ROW = { providerLabel: 'Kimi Code', authMethod: 'oauth', id: 'kimi:kimi-code' } as const

it.each([
  ['kimi-code', 'kimi-code'],
  ['oauth/kimi-code', 'kimi-code'],
  ['oauth/custom-slot', 'custom-slot'],
  ['custom-slot', 'custom-slot'],
  [undefined, 'kimi-code'],
] as const)('模拟：原生槽位 %s 在状态与凭据读取中一致', async (key, slot) => {
  const f = await fixture()
  expect(resolveKimiTokenStorageName(key)).toBe(slot)
  await writeFile(join(f.home, 'credentials', `${slot}.json`), JSON.stringify(f.token))
  const raw = { providers: { 'managed:kimi-code': { type: 'kimi', oauth: { storage: 'file', key } } } }
  expect(await f.read(raw)).toMatchObject({ state: 'authenticated', logins: [OAUTH_ROW] })
  expect(
    await readKimiOwnToken(
      join(f.home, 'credentials'),
      key ?? 'oauth/kimi-code',
      new AbortController().signal,
    ),
  ).toEqual(f.token)
})

it('模拟：原生续期网络失败后保留登录，写入撤销墓碑后才退出', async () => {
  const f = await fixture()
  await f.set({ ...f.token, expires_at: 1 })
  const before = await readFile(f.path)
  // Native network failures leave the prior token on disk; no real refresh here.
  expect(await f.read()).toMatchObject({ state: 'authenticated', logins: [OAUTH_ROW] })
  expect(await readFile(f.path)).toEqual(before)
  await f.set({ ...f.token, access_token: '', expires_at: 0 })
  expect(await f.read()).toMatchObject({ state: 'unauthenticated' })
})

function syntheticJwt(claims: unknown) {
  return [
    Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    'synthetic-signature',
  ].join('.')
}

it('模拟：isolates account working directories and project MCP without changing native accounts or trust', async () => {
  const f = await fixture()
  await f.set(f.token)
  await mkdir(join(f.home, '.git'))
  const projectMcp = '{"mcpServers":{"synthetic-project":{"command":"never-run"}}}'
  await writeFile(join(f.home, '.mcp.json'), projectMcp)
  const prepared = await prepareKimiAccountDirectory(
    join(f.home, 'plugin-state'),
    new AbortController().signal,
  )
  if (process.platform !== 'win32') expect((await lstat(prepared.cwd)).mode & 0o777).toBe(0o700)
  expect((await lstat(join(prepared.cwd, '.git'))).isDirectory()).toBe(true)
  for (const path of [join(prepared.cwd, '.mcp.json'), join(prepared.cwd, '.kimi-code/mcp.json')]) {
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ mcpServers: {} })
    if (process.platform !== 'win32') expect((await lstat(path)).mode & 0o777).toBe(0o600)
  }
  expect(await readdir(prepared.cwd)).toEqual(['.git', '.kimi-code', '.mcp.json'])
  expect(await readFile(join(f.home, '.mcp.json'), 'utf8')).toBe(projectMcp)
  expect(JSON.parse(await readFile(f.path, 'utf8'))).toEqual(f.token)
  await prepared.cleanup()
  await prepared.cleanup()
  await expect(lstat(prepared.cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(JSON.parse(await readFile(f.path, 'utf8'))).toEqual(f.token)
})

it('模拟：does not allocate a cancelled login directory or clean a replaced directory', async () => {
  const f = await fixture(),
    state = join(f.home, 'plugin-state')
  const abort = new AbortController()
  abort.abort(new Error('synthetic-cancel'))
  await expect(prepareKimiAccountDirectory(state, abort.signal)).rejects.toThrow('synthetic-cancel')
  await expect(lstat(state)).rejects.toMatchObject({ code: 'ENOENT' })
  const prepared = await prepareKimiAccountDirectory(state, new AbortController().signal)
  await rename(prepared.cwd, prepared.cwd + '-original')
  await mkdir(prepared.cwd)
  await writeFile(join(prepared.cwd, 'keep'), 'synthetic-replacement')
  await expect(prepared.cleanup()).rejects.toThrow('changed before cleanup')
  expect(await readFile(join(prepared.cwd, 'keep'), 'utf8')).toBe('synthetic-replacement')
})

it.each(['current', 'refreshable', 'native-no-expiry'] as const)(
  '模拟：recognizes %s native OAuth without changing token files',
  async (kind) => {
    const f = await fixture()
    await f.set({
      ...f.token,
      expires_at: kind === 'current' ? f.token.expires_at : kind === 'refreshable' ? 1 : 0,
    })
    const before = await readFile(f.path)
    const value = await f.read()
    expect(value).toEqual({
      state: 'authenticated',
      authMethod: 'oauth',
      verification: 'local',
      summary: '已登录 Kimi',
      logins: [OAUTH_ROW],
    })
    expect(JSON.stringify(value)).not.toMatch(/synthetic-|token|credentials|\.json/)
    expect(await readFile(f.path)).toEqual(before)
  },
)

it.each(['current', 'refreshable', 'native-no-expiry'] as const)(
  '模拟：shows only a masked decoded native account ID for %s OAuth',
  async (kind) => {
    const f = await fixture()
    const id = 'synthetic-account-123abc'
    const accessToken = syntheticJwt({ iss: 'kimi-auth', sub: id, user_id: id })
    await f.set({
      ...f.token,
      access_token: accessToken,
      expires_at: kind === 'current' ? f.token.expires_at : kind === 'refreshable' ? 1 : 0,
    })
    const before = await readFile(f.path)
    const value = await f.read()
    expect(value).toEqual({
      state: 'authenticated',
      authMethod: 'oauth',
      verification: 'local',
      summary: '已登录 Kimi',
      accountLabel: 'Kimi ID · …123abc',
      logins: [{ ...OAUTH_ROW, accountLabel: 'Kimi ID · …123abc' }],
    })
    for (const secret of [id, accessToken, f.token.refresh_token, 'synthetic-signature'])
      expect(JSON.stringify(value)).not.toContain(secret)
    expect(await readFile(f.path)).toEqual(before)
  },
)

it.each(['sub', 'user_id'] as const)('模拟：supports the native %s identity field alone', async (field) => {
  const f = await fixture()
  await f.set({ ...f.token, access_token: syntheticJwt({ iss: 'kimi-auth', [field]: 'account-abc123' }) })
  expect((await f.read()).accountLabel).toBe('Kimi ID · …abc123')
})

it.each([
  ['no identity', { iss: 'kimi-auth' }],
  ['unknown issuer', { iss: 'synthetic-other-issuer', sub: 'account-abc123' }],
  ['missing issuer', { sub: 'account-abc123' }],
  ['conflicting identities', { iss: 'kimi-auth', sub: 'account-abc123', user_id: 'account-def456' }],
  ['non-string identity', { iss: 'kimi-auth', sub: 123456789 }],
  ['malformed secondary identity', { iss: 'kimi-auth', sub: 'account-abc123', user_id: null }],
  ['API key shape', { iss: 'kimi-auth', sub: 'sk-secret-abc123' }],
  ['token shape', { iss: 'kimi-auth', sub: 'token-secret-abc123' }],
  ['JWT shape', { iss: 'kimi-auth', sub: 'eyJhbGciOiJFUzI1NiJ9' }],
  ['too short to mask', { iss: 'kimi-auth', sub: 'abc123' }],
  ['too long', { iss: 'kimi-auth', sub: 'a'.repeat(129) }],
  ['control character', { iss: 'kimi-auth', sub: 'account-\nabc123' }],
  ['bidi text', { iss: 'kimi-auth', sub: 'account-\u202eabc123' }],
  ['HTML shape', { iss: 'kimi-auth', sub: '<b>account-abc123</b>' }],
  ['email is not a native ID', { iss: 'kimi-auth', sub: 'synthetic@example.invalid' }],
  ['profile is not an ID', { iss: 'kimi-auth', email: 'synthetic@example.invalid', nickname: 'Synthetic' }],
  ['non-object claims', ['account-abc123']],
] as const)('模拟：omits unsafe or unconfirmed identity metadata: %s', async (_kind, claims) => {
  const f = await fixture()
  const accessToken = syntheticJwt(claims)
  await f.set({ ...f.token, access_token: accessToken })
  expect(await f.read()).toEqual({
    state: 'authenticated',
    authMethod: 'oauth',
    verification: 'local',
    summary: '已登录 Kimi',
    logins: [OAUTH_ROW],
  })
})

it.each([
  'opaque-native-token',
  'header.%%%%.signature',
  'header.bnVsbA.signature',
  'header.e30=.signature',
  `header.${'a'.repeat(16 * 1024 + 1)}.signature`,
])('模拟：keeps native login when access-token identity cannot be decoded (case %#)', async (accessToken) => {
  const f = await fixture()
  await f.set({ ...f.token, access_token: accessToken })
  const value = await f.read()
  expect(value.state).toBe('authenticated')
  expect(value.accountLabel).toBeUndefined()
})

it('模拟：reads a changed account afresh and removes its label after logout, source switch or expiry', async () => {
  const f = await fixture()
  const token = (id: string) => ({ ...f.token, access_token: syntheticJwt({ iss: 'kimi-auth', sub: id }) })
  await f.set(token('account-abc123'))
  expect((await f.read()).accountLabel).toBe('Kimi ID · …abc123')
  await f.set(token('account-def456'))
  expect((await f.read()).accountLabel).toBe('Kimi ID · …def456')
  await f.set({ ...f.token, access_token: '', refresh_token: f.token.refresh_token })
  expect(await f.read()).toMatchObject({ state: 'unauthenticated' })
  expect((await f.read()).accountLabel).toBeUndefined()
  await f.set({ ...token('account-def456'), refresh_token: '', expires_at: 1 })
  expect(await f.read()).toMatchObject({ state: 'unauthenticated' })
  expect((await f.read()).accountLabel).toBeUndefined()
  await f.set(token('account-def456'))
  f.config.providers['managed:kimi-code'].oauth.key = 'oauth/new-slot'
  expect(await f.read()).toMatchObject({ state: 'unconfigured' })
  expect((await f.read()).accountLabel).toBeUndefined()
})

it('模拟：does not treat provider configuration or a stale other slot as logged in', async () => {
  const f = await fixture()
  expect((await f.read()).state).toBe('unconfigured')
  await f.set(f.token)
  f.config.providers['managed:kimi-code'].oauth.key = 'oauth/current-region'
  expect((await f.read()).state).toBe('unconfigured')
  await writeFile(join(f.home, 'credentials/current-region.json'), JSON.stringify(f.token), { mode: 0o600 })
  expect((await f.read()).state).toBe('authenticated')
  await rm(join(f.home, 'credentials/current-region.json'))
  expect((await f.read()).state).toBe('unconfigured')
})

it.each([
  { access_token: '', refresh_token: 'synthetic-old-refresh', expires_at: 0 },
  { refresh_token: 'synthetic-refresh', expires_at: 0 },
  { access_token: 'synthetic-expired', expires_at: 1 },
])('模拟：does not revive revoked, refresh-only or expired native records: %j', async (token) => {
  const f = await fixture()
  await f.set(token)
  expect((await f.read()).state).toBe('unauthenticated')
})

it('模拟：keeps literal own API configuration distinct from native OAuth login', async () => {
  const f = await fixture()
  expect(await f.read({ providers: { own: { type: 'openai', apiKey: 'synthetic-api' } } })).toMatchObject({
    state: 'configured',
    authMethod: 'api',
  })
  expect((await f.read({ providers: { own: { type: 'openai', apiKey: '$OPENAI_API_KEY' } } })).state).toBe(
    'unconfigured',
  )
  await f.set(f.token)
  expect(
    (
      await f.read({
        providers: { other: { type: 'kimi', oauth: f.config.providers['managed:kimi-code'].oauth } },
      })
    ).state,
  ).not.toBe('authenticated')
})

it.each(['../kimi-code', 'oauth/../kimi-code', 'oauth/a/b', '.', 'oauth/.hidden', 'oauth/\\other'])(
  '模拟：rejects unsafe slot %s without exposing it',
  async (slot) => {
    const f = await fixture()
    f.config.providers['managed:kimi-code'].oauth.key = slot
    expect(await f.read()).toEqual({
      state: 'unavailable',
      verification: 'local',
      summary: 'Kimi 登录状态读取失败，请检查配置',
    })
  },
)

it.each(['symlink', 'hardlink', 'parent-symlink', 'malformed', 'oversized', 'wrong-token-type'] as const)(
  '模拟：refuses unsafe token source: %s',
  async (kind) => {
    const f = await fixture()
    const other = join(f.home, 'other.json')
    await writeFile(other, JSON.stringify(f.token), { mode: 0o600 })
    if (kind === 'symlink') await symlink(other, f.path)
    else if (kind === 'hardlink') await link(other, f.path)
    else if (kind === 'parent-symlink') {
      await rm(join(f.home, 'credentials'), { recursive: true })
      await mkdir(join(f.home, 'other'))
      await writeFile(join(f.home, 'other/kimi-code.json'), JSON.stringify(f.token))
      await symlink(join(f.home, 'other'), join(f.home, 'credentials'))
    } else if (kind === 'malformed') await writeFile(f.path, '{synthetic-invalid')
    else if (kind === 'oversized') await writeFile(f.path, 'x'.repeat(64 * 1024 + 1))
    else await f.set({ access_token: {}, refresh_token: f.token.refresh_token })
    expect((await f.read()).state).toBe('unavailable')
  },
)

it('模拟：keeps unknown storage unknown and propagates cancellation', async () => {
  const f = await fixture()
  await f.set(f.token)
  f.config.providers['managed:kimi-code'].oauth.storage = 'keyring'
  expect((await f.read()).state).toBe('unknown')
  const controller = new AbortController()
  controller.abort(new Error('Synthetic cancelled'))
  await expect(f.read(f.config, controller.signal)).rejects.toThrow('Synthetic cancelled')
})

// Synthetic `kimi provider list --json` shapes: the managed OAuth entry plus own API providers.
const apiProviders = {
  'moonshot-cn': { type: 'kimi', baseUrl: 'https://api.moonshot.cn/v1', apiKey: 'synthetic-moonshot-key' },
  deepseek: { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'synthetic-deepseek-key' },
}

it('模拟：lists the Kimi Code login and each own API provider as removable rows, in /logout order', async () => {
  const f = await fixture()
  const id = 'synthetic-account-123abc'
  await f.set({ ...f.token, access_token: syntheticJwt({ iss: 'kimi-auth', sub: id }) })
  const value = await f.read({ providers: { ...apiProviders, ...f.config.providers }, models: {} })
  expect(value).toEqual({
    state: 'authenticated',
    authMethod: 'oauth',
    verification: 'local',
    summary: '已登录 Kimi',
    accountLabel: 'Kimi ID · …123abc',
    logins: [
      { ...OAUTH_ROW, accountLabel: 'Kimi ID · …123abc' },
      { providerLabel: 'DeepSeek', authMethod: 'api', id: 'kimi:deepseek' },
      { providerLabel: 'Moonshot', authMethod: 'api', id: 'kimi:moonshot-cn' },
    ],
  })
  for (const secret of ['synthetic-moonshot-key', 'synthetic-deepseek-key', id, 'api.deepseek.com/v1'])
    expect(JSON.stringify(value)).not.toContain(secret)
})

it('模拟：keeps API-only Kimi configured while listing its API rows, and never a managed row', async () => {
  const f = await fixture()
  const value = await f.read({ providers: { ...apiProviders, ...f.config.providers }, models: {} })
  expect(value).toEqual({
    state: 'configured',
    verification: 'local',
    authMethod: 'api',
    summary: '已配置 Kimi API',
    logins: [
      { providerLabel: 'DeepSeek', authMethod: 'api', id: 'kimi:deepseek' },
      { providerLabel: 'Moonshot', authMethod: 'api', id: 'kimi:moonshot-cn' },
    ],
  })
  // A revoked managed token stays out of the rows; the API rows remain.
  await f.set({ access_token: '', refresh_token: 'synthetic-old-refresh', expires_at: 0 })
  expect(
    (await f.read({ providers: { ...apiProviders, ...f.config.providers } })).logins?.map((row) => row.id),
  ).toEqual(['kimi:deepseek', 'kimi:moonshot-cn'])
})

it('模拟：gives no removal id to a provider key the window cannot address, nor to referenced keys', async () => {
  const f = await fixture()
  const value = await f.read({
    providers: {
      // Named like the managed login: removing it here would be ambiguous.
      'kimi-code': { type: 'kimi', baseUrl: 'https://api.moonshot.cn/v1', apiKey: 'synthetic-key-a' },
      'Upper Case': { type: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'synthetic-key-b' },
      env: { type: 'kimi', env: { KIMI_API_KEY: 'synthetic-key-c' } },
      referenced: { type: 'openai', apiKey: '$OPENAI_API_KEY' },
      oauth: { type: 'kimi', apiKey: 'synthetic-key-d', oauth: { storage: 'file', key: 'oauth/other' } },
    },
  })
  expect(value.state).toBe('configured')
  expect(value.logins).toEqual([
    { providerLabel: 'DeepSeek', authMethod: 'api' },
    { providerLabel: 'env', authMethod: 'api', id: 'kimi:env' },
    { providerLabel: 'Moonshot', authMethod: 'api' },
  ])
  expect(JSON.stringify(value)).not.toMatch(/synthetic-key|referenced|oauth\//)
})

it('模拟：lists no rows when nothing is signed in, or the status cannot be read', async () => {
  const f = await fixture()
  expect(await f.read()).not.toHaveProperty('logins')
  f.config.providers['managed:kimi-code'].oauth.storage = 'keyring'
  expect(await f.read({ providers: { ...apiProviders, ...f.config.providers } })).not.toHaveProperty('logins')
  expect(
    await readKimiAccount('not json', new AbortController().signal, { home: f.home }),
  ).not.toHaveProperty('logins')
})
