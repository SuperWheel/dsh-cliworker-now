import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, rename, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  readKimiOAuthModelSources,
  probeKimiOAuthModels,
  kimiQuotaRemaining,
} from '../src/host/kimi-oauth-models.ts'
import { discoverFirstPartySources, readFirstPartyModelSources } from '../src/host/first-party-models.ts'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
import { readKimiAccount } from '../src/host/kimi-accounts.ts'

// Synthetic own native config, OAuth files and HTTP responses; never uses a real account.
const roots: string[] = []
const signal = () => new AbortController().signal
const jwt = (claims: unknown) =>
  `${Buffer.from('{"alg":"synthetic"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic`
const access = () =>
  jwt({ iss: 'kimi-auth', sub: 'synthetic-kimi-user', exp: Math.floor(Date.now() / 1000) + 3600 })
const native = () => ({
  providers: {
    'managed:kimi-code': {
      type: 'kimi',
      baseUrl: 'https://api.kimi.com/coding/v1',
      oauth: { storage: 'file', key: 'oauth/kimi-code' },
    },
  },
  models: {
    'kimi-code/k3': { provider: 'managed:kimi-code', model: 'k3', displayName: 'Synthetic K3' },
    'kimi-code/native-only': { provider: 'managed:kimi-code', model: 'native-only' },
    'unmanaged-alias': { provider: 'managed:kimi-code', model: 'server-only' },
  },
})
const modelPayload = () => ({
  data: [
    { id: 'k3', context_length: 262144 },
    { id: 'server-only', context_length: 131072 },
  ],
})
const usagePayload = () => ({ usages: { limit_5h: { used_ratio: 0.1 }, limit_7d: { used_ratio: '0.2' } } })
const replies = (usage: unknown = usagePayload(), models: unknown = modelPayload(), status = 200) =>
  vi.fn<typeof fetch>(
    async (url) => new Response(JSON.stringify(String(url).endsWith('/usages') ? usage : models), { status }),
  )
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'cwn-kimi-oauth-'))
  roots.push(home)
  await mkdir(join(home, 'credentials'))
  vi.stubEnv('KIMI_CODE_HOME', home)
  const path = join(home, 'credentials/kimi-code.json')
  const token = {
    access_token: access(),
    refresh_token: 'synthetic-refresh-never-use',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'Bearer',
  }
  await writeFile(path, JSON.stringify(token))
  return {
    home,
    path,
    token,
    read: (raw: unknown = native()) => readKimiOAuthModelSources(raw, join(home, 'config.toml'), signal()),
  }
}

describe('native Kimi managed OAuth uses only its own stable identity and verified route', () => {
  it('模拟：reads the native token without changing or propagating refresh material and integrates native aliases', async () => {
    const f = await fixture(),
      before = await readFile(f.path)
    const sources = await readFirstPartyModelSources(
      'kimi',
      '/synthetic/kimi',
      '/synthetic/project',
      async () => JSON.stringify(native()),
      signal(),
    )
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      provider: 'managed:kimi-code',
      apiType: 'kimi-managed-oauth',
      credential: { type: 'oauth', accountId: 'synthetic-kimi-user' },
    })
    expect(sources[0]!.nativeModels.map((item) => item.choice.id)).toEqual([
      'kimi-code/k3',
      'kimi-code/native-only',
    ])
    expect(JSON.stringify(sources)).not.toContain('synthetic-refresh-never-use')
    const fetch = replies()
    expect(await discoverFirstPartySources(sources, signal(), { fetch })).toEqual([
      { id: 'kimi-code/k3', label: 'Synthetic K3', efforts: ['default'], cost: 'unknown' },
    ])
    expect(fetch).toHaveBeenCalledTimes(2)
    for (const call of fetch.mock.calls) {
      expect(call[1]?.redirect).toBe('error')
      expect(new Headers(call[1]?.headers).get('Authorization')).toBe(`Bearer ${f.token.access_token}`)
    }
    expect(await readFile(f.path)).toEqual(before)
  })

  it.each(['route', 'slot', 'storage', 'host', 'api', 'api-env', 'headers', 'environment'])(
    '模拟：refuses an unverified %s without an HTTP request',
    async (kind) => {
      const f = await fixture(),
        raw: any = native(),
        provider = raw.providers['managed:kimi-code']
      if (kind === 'route') provider.baseUrl = 'https://foreign.example/coding/v1'
      if (kind === 'slot') provider.oauth.key = '../../other-account'
      if (kind === 'storage') provider.oauth.storage = 'keyring'
      if (kind === 'host') provider.oauth.oauthHost = 'https://foreign.example'
      if (kind === 'api') provider.apiKey = 'synthetic-foreign-api'
      if (kind === 'api-env') provider.apiKeyEnv = 'SYNTHETIC_FOREIGN_API'
      if (kind === 'headers') provider.customHeaders = { Authorization: 'synthetic-foreign-bearer' }
      if (kind === 'environment') vi.stubEnv('KIMI_CODE_BASE_URL', 'https://foreign.example')
      await expect(f.read(raw)).rejects.toThrow('配置来源暂无法核验')
    },
  )

  it.each(['missing', 'tombstone', 'expired', 'near-expiry', 'issuer', 'conflict'])(
    '模拟：rejects %s credentials without native refresh',
    async (kind) => {
      const f = await fixture()
      if (kind === 'missing') await rm(f.path)
      else {
        if (kind === 'tombstone') f.token.access_token = ''
        if (kind === 'expired') f.token.expires_at = Math.floor(Date.now() / 1000) - 1
        if (kind === 'near-expiry') f.token.expires_at = Math.floor(Date.now() / 1000) + 20
        if (kind === 'issuer') f.token.access_token = jwt({ iss: 'other-auth', sub: 'synthetic-kimi-user' })
        if (kind === 'conflict')
          f.token.access_token = jwt({
            iss: 'kimi-auth',
            sub: 'synthetic-kimi-user',
            user_id: 'different-user',
          })
        await writeFile(f.path, JSON.stringify(f.token))
      }
      await expect(f.read()).rejects.toThrow(kind === 'expired' || kind === 'near-expiry' ? '过期' : 'Kimi')
    },
  )

  it('模拟：rejects linked credential files', async () => {
    const f = await fixture(),
      other = join(f.home, 'other.json')
    await writeFile(other, JSON.stringify(f.token))
    await rm(f.path)
    await symlink(other, f.path)
    await expect(f.read()).rejects.toThrow('配置来源暂无法核验')
  })

  it('模拟：binds stable identity across token rotation and preserves account-change and expiry diagnostics', async () => {
    const f = await fixture()
    const backend = {
      resolveExecutable: async () => '/synthetic/kimi',
      spawn: () => ({
        stdout: (async function* () {
          yield JSON.stringify(native())
        })(),
        stderr: (async function* () {})(),
        done: Promise.resolve({ exitCode: 0 }),
        terminate() {},
        waitForExit: async () => true,
      }),
    } as unknown as ProcessBackend
    const binding = () =>
      readCliAccountBinding('kimi', backend, DEFAULT_CONFIG, '/synthetic/project', signal())
    const before = await binding()
    f.token.access_token = jwt({
      iss: 'kimi-auth',
      sub: 'synthetic-kimi-user',
      exp: Math.floor(Date.now() / 1000) + 7200,
    })
    await writeFile(f.path, JSON.stringify(f.token))
    expect(await binding()).toBe(before)
    f.token.access_token = jwt({
      iss: 'kimi-auth',
      sub: 'different-kimi-user',
      exp: Math.floor(Date.now() / 1000) + 7200,
    })
    await writeFile(f.path, JSON.stringify(f.token))
    expect(await binding()).not.toBe(before)
    f.token.expires_at = 1
    await writeFile(f.path, JSON.stringify(f.token))
    await expect(binding()).rejects.toMatchObject({ code: 'KIMI_OAUTH_REFRESH_REQUIRED' })
  })

  it('模拟：自定义槽位贯通状态、模型、缓存与绑定，迁移槽位不换账号', async () => {
    const f = await fixture(),
      raw = native()
    const executable = join(f.home, 'synthetic-kimi'),
      configPath = join(f.home, 'config.toml')
    await writeFile(executable, 'synthetic executable identity')
    await writeFile(configPath, '# synthetic default slot')
    const capture = vi.fn(async () => JSON.stringify(raw))
    const backend = {
      resolveExecutable: async () => executable,
      spawn: () => ({
        stdout: (async function* () {
          yield JSON.stringify(raw)
        })(),
        stderr: (async function* () {})(),
        done: Promise.resolve({ exitCode: 0 }),
        terminate() {},
        waitForExit: async () => true,
      }),
    } as unknown as ProcessBackend
    const project = f.home
    const binding = () => readCliAccountBinding('kimi', backend, DEFAULT_CONFIG, project, signal())
    const read = () => readFirstPartyModelSources('kimi', executable, project, capture, signal())
    const initial = await binding()
    raw.providers['managed:kimi-code'].oauth.key = 'oauth/region-custom'
    const moved = join(f.home, 'credentials/region-custom.json')
    await rename(f.path, moved)
    await writeFile(configPath, '# synthetic custom slot')
    expect(await readKimiAccount(JSON.stringify(raw), signal())).toMatchObject({ state: 'authenticated' })
    const sources = await read()
    expect(await read()).toEqual(sources)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith([executable, 'provider', 'list', '--json'], {
      KIMI_CODE_NO_AUTO_UPDATE: '1',
    })
    expect(await binding()).toBe(initial)
    expect(await discoverFirstPartySources(sources, signal(), { fetch: replies() })).toHaveLength(1)
    // Changing an unrelated default slot must not invalidate custom-slot metadata.
    await writeFile(f.path, JSON.stringify({ ...f.token, access_token: '' }))
    await read()
    expect(capture).toHaveBeenCalledTimes(1)
    // Rotation invalidates the actual file fingerprint, but keeps the principal.
    await writeFile(moved, JSON.stringify({ ...f.token, refresh_token: 'synthetic-rotated-refresh' }))
    await read()
    expect(capture).toHaveBeenCalledTimes(2)
    expect(await binding()).toBe(initial)
    await writeFile(moved, JSON.stringify({ ...f.token, access_token: '' }))
    await expect(read()).rejects.toMatchObject({ code: 'KIMI_OAUTH_UNAVAILABLE' })
    await expect(binding()).rejects.toThrow('尚未登录或已退出')
  })

  it('模拟：过期可续期与原生续期失败保持独立状态，重读成功后恢复模型', async () => {
    const f = await fixture()
    await writeFile(f.path, JSON.stringify({ ...f.token, expires_at: 1 }))
    const before = await readFile(f.path)
    const capture = vi.fn(async () => JSON.stringify(native()))
    const read = () => readFirstPartyModelSources('kimi', '/synthetic/kimi', f.home, capture, signal())
    for (let attempt = 0; attempt < 2; attempt++) {
      // Simulate native network refresh failure: the expired file remains intact.
      await expect(read()).rejects.toMatchObject({
        code: 'KIMI_OAUTH_REFRESH_REQUIRED',
        message: expect.stringContaining('原生终端执行 /usage'),
      })
      expect(await readFile(f.path)).toEqual(before)
      expect(await readKimiAccount(JSON.stringify(native()), signal())).toMatchObject({
        state: 'authenticated',
      })
    }
    expect(
      capture.mock.calls.every(
        ([argv, env]: any[]) =>
          argv.join(' ') === '/synthetic/kimi provider list --json' && env.KIMI_CODE_NO_AUTO_UPDATE === '1',
      ),
    ).toBe(true)
    // Simulate a later successful native refresh, without invoking a CLI/network.
    await writeFile(f.path, JSON.stringify({ ...f.token, refresh_token: 'synthetic-refreshed' }))
    expect(await read()).toHaveLength(1)
    // Native unauthorized refresh may persist a tombstone, even with a stale refresh token.
    await writeFile(f.path, JSON.stringify({ ...f.token, access_token: '', expires_at: 0 }))
    await expect(read()).rejects.toMatchObject({ code: 'KIMI_OAUTH_UNAVAILABLE' })
  })

  it.each([0, undefined])('模拟：原生无到期时间 %s 不误报需要续期', async (expires_at) => {
    const f = await fixture()
    await writeFile(f.path, JSON.stringify({ ...f.token, expires_at }))
    const sources = await f.read()
    await expect(discoverFirstPartySources(sources, signal(), { fetch: replies() })).resolves.toHaveLength(1)
  })

  it.each([0, undefined])(
    '模拟：原生到期时间 %s 可绑定，轮换稳定且普通到期绑定摘要不变',
    async (expires_at) => {
      const f = await fixture()
      const backend = {
        resolveExecutable: async () => '/synthetic/kimi',
        spawn: () => ({
          stdout: (async function* () {
            yield JSON.stringify(native())
          })(),
          stderr: (async function* () {})(),
          done: Promise.resolve({ exitCode: 0 }),
          terminate() {},
          waitForExit: async () => true,
        }),
      } as unknown as ProcessBackend
      const binding = () => readCliAccountBinding('kimi', backend, DEFAULT_CONFIG, f.home, signal())
      // Frozen canonical inputs from the ordinary expiring-token binding contract.
      const entry =
        '{"principal":{"accountId":"synthetic-kimi-user","issuer":"kimi-auth","kind":"oauth","subject":"synthetic-kimi-user"},"provider":"managed:kimi-code","route":{"apiType":"kimi-managed-oauth","baseUrl":"https://api.kimi.com/coding/v1"}}'
      const expected = `cli-account-v1:${createHash('sha256')
        .update(
          JSON.stringify({
            cli: 'kimi',
            entries: [entry],
            sources: [join(f.home, 'config.toml'), f.path, 'native:kimi-managed-oauth'].sort(),
          }),
        )
        .digest('hex')}`
      expect((await f.read())[0]!.credential.expires).toBe(f.token.expires_at * 1000)
      expect(await binding()).toBe(expected)
      for (const revision of [1, 2]) {
        // Even an old JWT exp cannot override the native file's no-expiry meaning.
        await writeFile(
          f.path,
          JSON.stringify({
            ...f.token,
            expires_at,
            refresh_token: undefined,
            access_token: jwt({
              iss: 'kimi-auth',
              sub: 'synthetic-kimi-user',
              exp: revision,
              jti: `synthetic-${revision}`,
            }),
          }),
        )
        const sources = await f.read()
        expect(sources[0]!.credential.expires).toBe(Number.MAX_SAFE_INTEGER)
        expect(await binding()).toBe(expected)
        await expect(
          discoverFirstPartySources(sources, signal(), { fetch: replies() }),
        ).resolves.toHaveLength(1)
      }
      // Switching back to an expiring native token keeps the exact legacy binding.
      await writeFile(f.path, JSON.stringify(f.token))
      expect(await binding()).toBe(expected)
    },
  )
})

describe('Kimi OAuth catalogue requires current subscription allowance', () => {
  it.each([
    [{}, '暂无法确认'],
    [{ usages: {} }, '暂无法确认'],
    [{ usages: { limit_5h: { used_ratio: -0.1 } } }, '暂无法确认'],
    [{ usages: { limit_5h: { used_ratio: '' } } }, '暂无法确认'],
    [{ usages: { limit_5h: { used_ratio: 1 }, limit_7d: { used_ratio: 0 } } }, '已用尽'],
  ])('模拟：does not allow listed models with an unknown or exhausted quota', async (usage, message) => {
    const f = await fixture(),
      sources = await f.read()
    await expect(discoverFirstPartySources(sources, signal(), { fetch: replies(usage) })).rejects.toThrow(
      message,
    )
  })

  it('模拟：rechecks both endpoints and rejects revocation instead of reusing a previous success', async () => {
    const f = await fixture(),
      source = (await f.read())[0]!,
      fetch = replies()
    await expect(probeKimiOAuthModels(source, { fetch })).resolves.toMatchObject({ state: 'supported' })
    fetch.mockImplementation(async () => new Response('synthetic server secret', { status: 401 }))
    await expect(probeKimiOAuthModels(source, { fetch })).rejects.toThrow('登录或订阅授权未通过')
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('模拟：rejects near-expiry credentials before the HTTP request', async () => {
    const f = await fixture(),
      source = (await f.read())[0]!,
      fetch = replies()
    source.credential.expires = Date.now() + 20_000
    await expect(probeKimiOAuthModels(source, { fetch })).rejects.toMatchObject({
      code: 'KIMI_OAUTH_REFRESH_REQUIRED',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('模拟：cancels both requests without retaining native credentials in an error', async () => {
    const f = await fixture(),
      source = (await f.read())[0]!,
      controller = new AbortController()
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new Error('synthetic transport secret')), {
            once: true,
          })
        }),
    )
    const pending = probeKimiOAuthModels(source, { fetch, signal: controller.signal })
    controller.abort(new Error('Synthetic cancelled'))
    await expect(pending).rejects.toThrow('Synthetic cancelled')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('模拟：bounds native payloads and refuses malformed model metadata', async () => {
    const f = await fixture(),
      source = (await f.read())[0]!
    await expect(probeKimiOAuthModels(source, { fetch: replies(usagePayload(), {}) })).rejects.toThrow(
      '目录格式',
    )
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('x'.repeat(1_048_577)))
    await expect(probeKimiOAuthModels(source, { fetch })).rejects.toThrow('响应过大')
  })

  it('模拟：accepts only recognized finite subscription ratios with positive remaining allowance', () => {
    expect(kimiQuotaRemaining({ usages: { limit_month_code: { used_ratio: '0.99' } } })).toBe('available')
    expect(kimiQuotaRemaining({ usages: { new_unknown_limit: { used_ratio: 0 } } })).toBe('unknown')
    expect(kimiQuotaRemaining({ usages: { limit_7d: { used_ratio: 'NaN' } } })).toBe('unknown')
  })
})
