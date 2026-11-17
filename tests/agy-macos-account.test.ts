import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'

// Synthetic keychain output and home directory only; no real keychain, CLI or network.
const state = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async (actual) => ({
  ...(await actual<typeof import('node:os')>()),
  homedir: () => state.home,
}))
import {
  MAC_AGY_KEYCHAIN_ARGUMENTS,
  MacAgyKeychainError,
  decodeMacAgyKeychain,
  macAgyAccountIdentity,
  readMacAgyCredential,
  readMacAgyLogin,
} from '../src/host/agy-macos-account.ts'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
beforeEach(() => {
  state.home = mkdtempSync(join(tmpdir(), 'cwn-agy-keychain-synthetic-'))
  mkdirSync(join(state.home, '.gemini/antigravity-cli'), { recursive: true })
})
afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  rmSync(state.home, { recursive: true, force: true })
})
const signal = () => new AbortController().signal
const SECRET = 'synthetic-refresh-secret'
const login = (sub = 'synthetic-subject', email?: string) => ({
  auth_method: 'consumer',
  token: { access_token: 'synthetic-access', refresh_token: SECRET, expiry: '2099-01-01T00:00:00Z' },
  id_token: `synthetic.${Buffer.from(JSON.stringify({ sub, iss: 'https://accounts.google.com', ...(email ? { email } : {}) })).toString('base64url')}.signature`,
})
// agy 1.4.7 writes the macOS keychain item without `id_token`, only `id_token_email` (checked 2026-10-26).
const keychainLogin = (email: string) => ({
  auth_method: 'consumer',
  token: { access_token: 'synthetic-access', refresh_token: SECRET, expiry: '2099-01-01T00:00:00Z', expires_in: 3599 },
  id_token_email: email,
})
function security(output: string, exitCode = 0) {
  const spawn = vi.fn(() => ({
    stdout: Readable.from([output]),
    stderr: Readable.from(['synthetic security diagnostic']),
    done: Promise.resolve({ exitCode }),
    terminate: vi.fn(),
    waitForExit: vi.fn(async () => true),
  }) as unknown as ReturnType<ProcessBackend['spawn']>)
  return { resolveExecutable: vi.fn(), spawn } satisfies ProcessBackend
}

it('reads exactly the go-keyring item through /usr/bin/security with an argument array', async () => {
  const backend = security(JSON.stringify(login()) + '\n')
  expect(await readMacAgyCredential(backend, DEFAULT_CONFIG, signal())).toEqual(login())
  expect(backend.spawn).toHaveBeenCalledOnce()
  expect(vi.mocked(backend.spawn).mock.calls[0]![0]).toMatchObject({
    argv: ['/usr/bin/security', 'find-generic-password', '-s', 'gemini', '-a', 'antigravity', '-w'],
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
  })
  expect(MAC_AGY_KEYCHAIN_ARGUMENTS).toHaveLength(7)
})

it.each([
  ['plain', (raw: string) => raw],
  ['base64', (raw: string) => 'go-keyring-base64:' + Buffer.from(raw).toString('base64')],
  ['hex', (raw: string) => 'go-keyring-encoded:' + Buffer.from(raw).toString('hex')],
])('decodes the %s go-keyring form', (_name, encode) => {
  expect(decodeMacAgyKeychain(encode(JSON.stringify(login())) + '\n')).toEqual(login())
})

it('answers a missing item (exit 44) with no token file as signed out', async () => {
  const backend = security('', 44)
  expect(await readMacAgyCredential(backend, DEFAULT_CONFIG, signal())).toBeUndefined()
  expect(await readMacAgyLogin(backend, DEFAULT_CONFIG, signal())).toBeUndefined()
  expect(await macAgyAccountIdentity(backend, DEFAULT_CONFIG)('antigravity', signal())).toMatchObject({
    state: 'unconfigured',
    summary: '尚未登录 Antigravity',
  })
})

// agy 1.5.x moves the login to its token file after a keychain timeout or write
// failure and clears the keychain item (issue #13); it then loads the file itself.
it.each([
  ['a missing item', '', 44],
  ['an unreadable keychain', '', 51],
])('reads the token file agy fell back to on %s', async (_name, output, exitCode) => {
  writeFileSync(join(state.home, '.gemini/jetski-standalone-oauth-token'), JSON.stringify(keychainLogin('Synthetic@Example.test')))
  const identity = await macAgyAccountIdentity(security(output, exitCode), DEFAULT_CONFIG)('antigravity', signal())
  expect(identity).toMatchObject({ state: 'authenticated', accountLabel: 'Synthetic@Example.test' })
  expect(JSON.stringify(identity)).not.toContain(SECRET)
})

it('prefers the keychain item over a token file, as agy does', async () => {
  writeFileSync(join(state.home, '.gemini/jetski-standalone-oauth-token'), JSON.stringify(keychainLogin('file@example.test')))
  const identity = await macAgyAccountIdentity(security(JSON.stringify(keychainLogin('keychain@example.test'))), DEFAULT_CONFIG)(
    'antigravity',
    signal(),
  )
  expect(identity).toMatchObject({ state: 'authenticated', accountLabel: 'keychain@example.test' })
})

it('keeps one binding when the same login moves between the keychain and the token file', async () => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' })
  const value = keychainLogin('synthetic@example.test')
  const fromKeychain = await readCliAccountBinding('antigravity', security(JSON.stringify(value)), DEFAULT_CONFIG, state.home, signal())
  writeFileSync(join(state.home, '.gemini/jetski-standalone-oauth-token'), JSON.stringify(value))
  const fromFile = await readCliAccountBinding('antigravity', security('', 44), DEFAULT_CONFIG, state.home, signal())
  expect(fromFile).toBe(fromKeychain)
})

it('reports an unreadable token file as an unreadable keychain when the item is also unreadable', async () => {
  writeFileSync(join(state.home, '.gemini/jetski-standalone-oauth-token'), 'not-json-' + SECRET)
  const identity = await macAgyAccountIdentity(security('', 51), DEFAULT_CONFIG)('antigravity', signal())
  expect(identity).toMatchObject({ state: 'unavailable', summary: '无法读取 macOS 钥匙串中的 Antigravity 账号，请重试' })
  expect(JSON.stringify(identity)).not.toContain(SECRET)
})

it.each([
  ['another exit status', '', 51],
  ['unparseable output', 'not-json-' + SECRET, 0],
  ['a non-object value', '["' + SECRET + '"]', 0],
  ['an oversized value', 'x'.repeat(64 * 1024 + 1), 0],
])('reports the keychain as unreadable on %s, without carrying the item', async (_name, output, exitCode) => {
  const backend = security(output, exitCode)
  const failure = await readMacAgyCredential(backend, DEFAULT_CONFIG, signal()).catch((error) => error)
  expect(failure).toBeInstanceOf(MacAgyKeychainError)
  expect(String(failure.message) + String(failure.stack)).not.toContain(SECRET)
  const identity = await macAgyAccountIdentity(backend, DEFAULT_CONFIG)('antigravity', signal())
  expect(identity).toMatchObject({ state: 'unavailable', summary: '无法读取 macOS 钥匙串中的 Antigravity 账号，请重试' })
  expect(JSON.stringify(identity)).not.toContain(SECRET)
})

it('shows the signed-in email and never exposes the token in the identity', async () => {
  const identity = await macAgyAccountIdentity(security(JSON.stringify(login('s', 'Synthetic@Example.test'))), DEFAULT_CONFIG)(
    'antigravity',
    signal(),
  )
  expect(identity).toEqual({
    state: 'authenticated',
    authMethod: 'oauth',
    verification: 'local',
    accountLabel: 'Synthetic@Example.test',
    summary: '已登录 Antigravity',
  })
  expect(JSON.stringify(identity)).not.toContain(SECRET)
})


it('keeps one binding for one keychain account and tells accounts apart', async () => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' })
  const read = (value: object) =>
    readCliAccountBinding('antigravity', security(JSON.stringify(value)), DEFAULT_CONFIG, state.home, signal())
  const first = await read(keychainLogin('synthetic@example.test'))
  expect(await read(keychainLogin('Synthetic@Example.test'))).toBe(first)
  expect(await read(keychainLogin('synthetic-other@example.test'))).not.toBe(first)
  expect(first).not.toContain(SECRET)
  await expect(readCliAccountBinding('antigravity', security('', 44), DEFAULT_CONFIG, state.home, signal()))
    .rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
})

it('changes the binding once when an account moves from the token file to the email-only keychain item', async () => {
  // The task itself continues silently (continue-tasks-across-account-changes); only the version moves.
  writeFileSync(join(state.home, '.gemini/jetski-standalone-oauth-token'), JSON.stringify(login('s', 'synthetic@example.test')))
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' })
  const fromFile = await readCliAccountBinding('antigravity', security('', 44), DEFAULT_CONFIG, state.home, signal())
  Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' })
  const fromKeychain = await readCliAccountBinding(
    'antigravity', security(JSON.stringify(keychainLogin('synthetic@example.test'))), DEFAULT_CONFIG, state.home, signal())
  expect(fromKeychain).not.toBe(fromFile)
})
