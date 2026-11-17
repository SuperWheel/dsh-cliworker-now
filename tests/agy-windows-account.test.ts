import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
const capture = vi.hoisted(() => vi.fn())
vi.mock('../src/host/adapters.ts', () => ({ captureCatalogMetadata: capture }))
// A synthetic home: the token-file fallback must never read the developer's real login.
const os = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async (actual) => ({
  ...(await actual<typeof import('node:os')>()),
  homedir: () => os.home,
}))
import {
  nativeAgyAccountIdentity,
  projectAgyCredential,
  projectWindowsAgyAccount,
  readWindowsAgyAccount,
  withWindowsAgyAccountSnapshot,
} from '../src/host/agy-windows-account.ts'
import { discoverAgyAccountModels } from '../src/host/agy-models.ts'
import { mkdtempSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const roots: string[] = []
beforeEach(() => {
  os.home = mkdtempSync(join(tmpdir(), 'cwn-agy-win-home-synthetic-'))
  roots.push(os.home)
})
afterEach(async () => {
  vi.restoreAllMocks()
  capture.mockReset()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const backend = {} as ProcessBackend
const signal = () => new AbortController().signal
it('projects only safe status/email and a private stable subject digest (synthetic credential metadata)', () => {
  const result = projectWindowsAgyAccount(
    JSON.stringify({
      state: 'authenticated',
      email: 'own@example.test',
      principalHash: 'a'.repeat(64),
      access_token: 'SECRET',
      refresh_token: 'SECRET',
      profile: { token: 'SECRET' },
    }),
  )
  expect(result.identity).toEqual({
    state: 'authenticated',
    authMethod: 'oauth',
    verification: 'local',
    summary: '已登录 Antigravity',
    accountLabel: 'own@example.test',
  })
  expect(result.principalHash).toBe('a'.repeat(64))
  expect(JSON.stringify(result)).not.toContain('SECRET')
})
it.each(['unconfigured', 'unauthenticated', 'unknown', 'unavailable'])(
  'keeps %s native state without a stale principal',
  (state) => {
    const result = projectWindowsAgyAccount(
      JSON.stringify({ state, email: 'old@example.test', principalHash: 'a'.repeat(64) }),
    )
    expect(result.identity.state).toBe(state)
    expect(result.identity.accountLabel).toBeUndefined()
    expect(result.principalHash).toBeUndefined()
  },
)
it.each(['not json', 'null', '[]', '{"state":"authenticated"}'.repeat(200)])(
  'fails closed for malformed/bounded projection',
  (raw) => {
    expect(projectWindowsAgyAccount(raw).identity.state).toBe('unavailable')
  },
)
it('keeps the email label of an AGY 1.4.x credential that has no ID token subject (synthetic)', () => {
  const result = projectWindowsAgyAccount(JSON.stringify({ state: 'authenticated', email: 'own@example.test' }))
  expect(result.identity).toMatchObject({ state: 'authenticated', accountLabel: 'own@example.test' })
  expect(result.principalHash).toBeUndefined()
})
it('does not accept unsafe email or an arbitrary principal identifier', () => {
  const result = projectWindowsAgyAccount(
    JSON.stringify({ state: 'authenticated', email: '<script>@example.test', principalHash: 'SECRET' }),
  )
  expect(result.identity.accountLabel).toBeUndefined()
  expect(result.principalHash).toBeUndefined()
})
it('reads only the fixed native helper on every request and clears logout immediately', async () => {
  capture
    .mockResolvedValueOnce(JSON.stringify({ state: 'authenticated', principalHash: 'a'.repeat(64) }))
    .mockResolvedValueOnce('{"state":"unconfigured"}')
  expect((await readWindowsAgyAccount(backend, DEFAULT_CONFIG, signal())).principalHash).toBe('a'.repeat(64))
  expect((await readWindowsAgyAccount(backend, DEFAULT_CONFIG, signal())).identity.state).toBe('unconfigured')
  expect(capture).toHaveBeenCalledTimes(2)
  const argv = capture.mock.calls[0]![2]
  // Process-local Bypass: the default Restricted policy would refuse the unsigned helper.
  expect(argv.slice(1, 7)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'])
  expect(argv).toHaveLength(8)
  expect(argv[7]).toMatch(/windows-agy-account\.ps1$/)
  expect(argv.join(' ')).not.toMatch(/cmd\.exe|CredEnumerate|token/)
})
it('discards a projection returned after cancellation', async () => {
  const c = new AbortController()
  capture.mockImplementationOnce(async () => {
    c.abort()
    return '{"state":"authenticated"}'
  })
  await expect(readWindowsAgyAccount(backend, DEFAULT_CONFIG, c.signal)).rejects.toThrow()
})
it('shares only a safe projection in one operation and isolates consumer mutations', async () => {
  const current = signal()
  capture.mockResolvedValue(
    JSON.stringify({ state: 'authenticated', principalHash: 'a'.repeat(64), token: 'SECRET' }),
  )
  await withWindowsAgyAccountSnapshot(backend, DEFAULT_CONFIG, current, async () => {
    const first = await readWindowsAgyAccount(backend, DEFAULT_CONFIG, current)
    first.identity.state = 'unconfigured'
    first.principalHash = 'b'.repeat(64)
    const second = await readWindowsAgyAccount(backend, DEFAULT_CONFIG, current)
    expect(second.identity.state).toBe('authenticated')
    expect(second.principalHash).toBe('a'.repeat(64))
    expect(JSON.stringify(second)).not.toContain('SECRET')
    expect(capture).toHaveBeenCalledOnce()
  })
  await readWindowsAgyAccount(backend, DEFAULT_CONFIG, current)
  expect(capture).toHaveBeenCalledTimes(2)
})
it('never shares a projection across backend, configuration or cancellation scope', async () => {
  const current = signal()
  capture.mockResolvedValue('{"state":"unconfigured"}')
  await withWindowsAgyAccountSnapshot(backend, DEFAULT_CONFIG, current, async () => {
    await readWindowsAgyAccount(backend, DEFAULT_CONFIG, current)
    await readWindowsAgyAccount({} as ProcessBackend, DEFAULT_CONFIG, current)
    await readWindowsAgyAccount(backend, { ...DEFAULT_CONFIG }, current)
    await readWindowsAgyAccount(backend, DEFAULT_CONFIG, signal())
    await readWindowsAgyAccount(backend, DEFAULT_CONFIG, current)
  })
  expect(capture).toHaveBeenCalledTimes(4)
})
it('does not cache failures or return a cached projection after cancellation', async () => {
  const controller = new AbortController()
  const failure = new Error('Synthetic native failure')
  capture.mockRejectedValueOnce(failure).mockResolvedValue('{"state":"unconfigured"}')
  await withWindowsAgyAccountSnapshot(backend, DEFAULT_CONFIG, controller.signal, async () => {
    await expect(readWindowsAgyAccount(backend, DEFAULT_CONFIG, controller.signal)).rejects.toBe(failure)
    await readWindowsAgyAccount(backend, DEFAULT_CONFIG, controller.signal)
    controller.abort(new Error('Synthetic cancellation'))
    await expect(readWindowsAgyAccount(backend, DEFAULT_CONFIG, controller.signal)).rejects.toThrow(
      'Synthetic cancellation',
    )
  })
  expect(capture).toHaveBeenCalledTimes(2)
})
it('invalidates the scope for an async descendant that outlives its operation', async () => {
  const current = signal()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let late!: Promise<unknown>
  capture.mockResolvedValue('{"state":"unconfigured"}')
  await withWindowsAgyAccountSnapshot(backend, DEFAULT_CONFIG, current, async () => {
    await readWindowsAgyAccount(backend, DEFAULT_CONFIG, current)
    late = gate.then(() => readWindowsAgyAccount(backend, DEFAULT_CONFIG, current))
  })
  release()
  await late
  expect(capture).toHaveBeenCalledTimes(2)
})
it('uses Windows native metadata without requiring a plaintext auth file', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cwn-agy-win-'))
  roots.push(home)
  await mkdir(join(home, '.gemini/antigravity-cli'), { recursive: true })
  capture.mockResolvedValue(JSON.stringify({ state: 'authenticated', principalHash: 'a'.repeat(64) }))
  const models = await discoverAgyAccountModels(
    async () => 'synthetic-model\tSynthetic',
    signal(),
    home,
    nativeAgyAccountIdentity(backend, DEFAULT_CONFIG, 'win32'),
  )
  expect(models[0]?.id).toBe('synthetic-model')
  capture.mockResolvedValue('{"state":"unconfigured"}')
  await expect(
    discoverAgyAccountModels(
      async () => 'old-model\tOld',
      signal(),
      home,
      nativeAgyAccountIdentity(backend, DEFAULT_CONFIG, 'win32'),
    ),
  ).rejects.toThrow('请先登录')
})

// agy 1.5.x falls back to its token file after a Credential Manager timeout or
// write failure and removes the Credential Manager item (issue #13). Synthetic file.
const SECRET = 'synthetic-refresh-secret'
const fileLogin = (extra: Record<string, unknown> = {}) => ({
  auth_method: 'consumer',
  token: { access_token: 'synthetic-access', refresh_token: SECRET, expiry: '2099-01-01T00:00:00Z' },
  ...extra,
})
const writeLogin = async (value: unknown) => {
  await mkdir(join(os.home, '.gemini'), { recursive: true })
  await writeFile(join(os.home, '.gemini/jetski-standalone-oauth-token'), typeof value === 'string' ? value : JSON.stringify(value))
}
it.each(['{"state":"unconfigured"}', '{"state":"unavailable"}'])(
  'reads the token file agy fell back to when the Credential Manager answers %s',
  async (raw) => {
    await writeLogin(fileLogin({ id_token_email: 'Own@Example.test', writer_id: 'synthetic-writer' }))
    capture.mockResolvedValue(raw)
    const account = await readWindowsAgyAccount(backend, DEFAULT_CONFIG, signal())
    expect(account.identity).toMatchObject({ state: 'authenticated', accountLabel: 'Own@Example.test' })
    expect(account.principalHash).toBeUndefined()
    expect(JSON.stringify(account)).not.toContain(SECRET)
  },
)
it('keeps a Credential Manager login and ignores the token file then', async () => {
  await writeLogin(fileLogin({ id_token_email: 'file@example.test' }))
  capture.mockResolvedValue(JSON.stringify({ state: 'authenticated', email: 'keyring@example.test' }))
  expect((await readWindowsAgyAccount(backend, DEFAULT_CONFIG, signal())).identity.accountLabel).toBe('keyring@example.test')
  capture.mockResolvedValue('{"state":"unauthenticated"}')
  expect((await readWindowsAgyAccount(backend, DEFAULT_CONFIG, signal())).identity.state).toBe('unauthenticated')
})
it('stays signed out with neither store, and fails closed on a broken token file', async () => {
  capture.mockResolvedValue('{"state":"unconfigured"}')
  expect((await readWindowsAgyAccount(backend, DEFAULT_CONFIG, signal())).identity.state).toBe('unconfigured')
  await writeLogin('not-json-' + SECRET)
  const broken = await readWindowsAgyAccount(backend, DEFAULT_CONFIG, signal())
  expect(broken.identity.state).toBe('unavailable')
  expect(JSON.stringify(broken)).not.toContain(SECRET)
  capture.mockResolvedValue('{"state":"unavailable"}')
  expect((await readWindowsAgyAccount(backend, DEFAULT_CONFIG, signal())).identity.state).toBe('unavailable')
})
it('derives the same subject digest from a token file as the Credential Manager helper', () => {
  const claims = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', sub: 'synthetic-subject' })).toString('base64url')
  const result = projectAgyCredential(fileLogin({ id_token: `synthetic.${claims}.signature` }))
  expect(result.principalHash).toBe(createHash('sha256').update('google:synthetic-subject').digest('hex'))
  const foreign = Buffer.from(JSON.stringify({ iss: 'https://example.test', sub: 'synthetic-subject' })).toString('base64url')
  expect(projectAgyCredential(fileLogin({ id_token: `synthetic.${foreign}.signature` })).principalHash).toBeUndefined()
  expect(projectAgyCredential({ auth_method: 'consumer', token: {} }).identity.state).toBe('unauthenticated')
})
it('lists models for a Windows login kept only in the token file', async () => {
  await mkdir(join(os.home, '.gemini/antigravity-cli'), { recursive: true })
  await writeLogin(fileLogin({ id_token_email: 'own@example.test' }))
  capture.mockResolvedValue('{"state":"unconfigured"}')
  const models = await discoverAgyAccountModels(
    async () => 'synthetic-model\tSynthetic',
    signal(),
    os.home,
    nativeAgyAccountIdentity(backend, DEFAULT_CONFIG, 'win32'),
  )
  expect(models[0]?.id).toBe('synthetic-model')
})
