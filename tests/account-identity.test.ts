import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { accountEmail, localAccountIdentity } from '../src/host/account-identity.ts'

// Synthetic metadata only. No test accesses the user's login files.
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const jwt = (claims: unknown) =>
  `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic`
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'cwn-identity-'))
  roots.push(home)
  mkdirSync(join(home, '.gemini'))
  mkdirSync(join(home, '.codex'))
  const agyPath = join(home, '.gemini', 'jetski-standalone-oauth-token')
  const codexPath = join(home, '.codex', 'auth.json')
  return {
    home,
    agyPath,
    codexPath,
    source: localAccountIdentity({ home }),
    signal: new AbortController().signal,
  }
}
const agy = (extra = {}) => ({
  auth_method: 'consumer',
  token: { access_token: 'SECRET-ACCESS', refresh_token: 'SECRET-REFRESH', expiry: '2000-01-01T00:00:00Z' },
  id_token: jwt({ email: 'person@example.com', name: 'SECRET-NAME', picture: 'SECRET-PICTURE' }),
  ...extra,
})

describe('bounded account identity projection', () => {
  it('projects only the email from a local AGY login and reports its verification boundary', async () => {
    const f = fixture()
    writeFileSync(f.agyPath, JSON.stringify(agy()))
    const result = await f.source('antigravity', f.signal)
    expect(result).toMatchObject({
      state: 'authenticated',
      authMethod: 'oauth',
      accountLabel: 'person@example.com',
      verification: 'local',
    })
    expect(result?.summary).toBe('已登录 Antigravity')
    expect(JSON.stringify(result)).not.toMatch(/SECRET|eyJ|access_token|refresh_token/)
  })

  it('reads fresh identity after account changes and clears a removed session', async () => {
    const f = fixture()
    writeFileSync(f.agyPath, JSON.stringify(agy()))
    expect((await f.source('antigravity', f.signal))?.accountLabel).toBe('person@example.com')
    writeFileSync(f.agyPath, JSON.stringify(agy({ id_token: jwt({ email: 'other@example.com' }) })))
    expect((await f.source('antigravity', f.signal))?.accountLabel).toBe('other@example.com')
    rmSync(f.agyPath)
    const removed = await f.source('antigravity', f.signal)
    expect(removed?.state).toBe('unconfigured')
    expect(removed?.accountLabel).toBeUndefined()
  })

  it('does not trust stale identity without login materials or an active access token', async () => {
    const f = fixture()
    writeFileSync(
      f.agyPath,
      JSON.stringify(agy({ token: { access_token: 'SECRET', expiry: '2000-01-01T00:00:00Z' } })),
    )
    const expired = await f.source('antigravity', f.signal)
    expect(expired?.state).toBe('unauthenticated')
    expect(expired?.accountLabel).toBeUndefined()
    writeFileSync(
      f.agyPath,
      JSON.stringify(agy({ token: { access_token: 'SECRET', expiry: '2999-01-01T00:00:00Z' } })),
    )
    expect((await f.source('antigravity', f.signal))?.state).toBe('authenticated')
  })

  it.each(['{malformed SECRET', '"SECRET"', 'SECRET'.repeat(12_000)])(
    'degrades malformed or oversized account metadata without disclosure',
    async (input) => {
      const f = fixture()
      writeFileSync(f.agyPath, input)
      const result = await f.source('antigravity', f.signal)
      expect(result?.state).toBe('unavailable')
      expect(JSON.stringify(result)).not.toContain('SECRET')
    },
  )

  it('ignores invalid or malicious ID token identities while preserving known local login state', async () => {
    const f = fixture()
    for (const id_token of [
      'badtoken',
      jwt({ email: '<script>@example.com' }),
      jwt({ email: 'sk-SECRET@example.com' }),
      jwt({ email: 'person\n@example.com' }),
      jwt({ email: { access_token: 'SECRET' } }),
    ]) {
      writeFileSync(f.agyPath, JSON.stringify(agy({ id_token })))
      const result = await f.source('antigravity', f.signal)
      expect(result?.state).toBe('authenticated')
      expect(result?.accountLabel).toBeUndefined()
      expect(JSON.stringify(result)).not.toContain('SECRET')
    }
  })

  it('labels an AGY 1.4.x login that keeps only id_token_email, rejecting unsafe values', async () => {
    const f = fixture()
    writeFileSync(f.agyPath, JSON.stringify(agy({ id_token: undefined, id_token_email: ' person@example.com ' })))
    expect(await f.source('antigravity', f.signal)).toMatchObject({
      state: 'authenticated',
      accountLabel: 'person@example.com',
    })
    // A full ID token keeps precedence over the separate email field.
    writeFileSync(f.agyPath, JSON.stringify(agy({ id_token_email: 'other@example.com' })))
    expect((await f.source('antigravity', f.signal))?.accountLabel).toBe('person@example.com')
    for (const id_token_email of ['<script>@example.com', 'sk-SECRET@example.com', { value: 'SECRET' }]) {
      writeFileSync(f.agyPath, JSON.stringify(agy({ id_token: undefined, id_token_email })))
      const result = await f.source('antigravity', f.signal)
      expect(result?.state).toBe('authenticated')
      expect(result?.accountLabel).toBeUndefined()
      expect(JSON.stringify(result)).not.toContain('SECRET')
    }
  })

  it('preserves unknown native shapes but reports unsafe linked metadata as a read error', async () => {
    const f = fixture()
    writeFileSync(f.agyPath, JSON.stringify({ auth_method: 'future', secret: 'SECRET' }))
    expect(await f.source('antigravity', f.signal)).toMatchObject({ state: 'unknown' })
    const target = join(f.home, 'synthetic-secret')
    writeFileSync(target, JSON.stringify(agy()))
    rmSync(f.agyPath)
    symlinkSync(target, f.agyPath)
    const linked = await f.source('antigravity', f.signal)
    expect(linked).toMatchObject({ state: 'unavailable' })
    expect(JSON.stringify(linked)).not.toContain('SECRET')
  })

  it('never uses a stale Codex auth.json as the effective keyring/auto identity', async () => {
    const f = fixture()
    writeFileSync(
      f.codexPath,
      JSON.stringify({
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        tokens: { access_token: 'SECRET', id_token: jwt({ email: 'codex@example.com' }) },
      }),
    )
    expect(await f.source('codex', f.signal)).toBeUndefined()
    expect(await f.source('kimi', f.signal)).toBeUndefined()
  })

  it('rejects an aliased account directory and recognizes a replaced current source (synthetic files)', async () => {
    const f = fixture()
    writeFileSync(f.agyPath, JSON.stringify(agy()))
    renameSync(f.agyPath, join(f.home, 'retired-account'))
    writeFileSync(f.agyPath, JSON.stringify(agy({ id_token: jwt({ email: 'current@example.com' }) })))
    expect((await f.source('antigravity', f.signal))?.accountLabel).toBe('current@example.com')
    const own = join(f.home, '.gemini'),
      alias = join(f.home, 'other-cli')
    renameSync(own, alias)
    symlinkSync(alias, own, 'junction')
    expect(await f.source('antigravity', f.signal)).toMatchObject({ state: 'unavailable' })
  })

  it('cancels before reading files and accepts only a bounded plain email', async () => {
    const f = fixture()
    const controller = new AbortController()
    controller.abort()
    await expect(f.source('antigravity', controller.signal)).rejects.toThrow()
    expect(accountEmail('person@example.com')).toBe('person@example.com')
    expect(accountEmail('bearer SECRET@example.com')).toBeUndefined()
    expect(accountEmail('a'.repeat(255) + '@example.com')).toBeUndefined()
  })
})

// GitHub issue #13 (2026-11-17, Linux): agy 1.5.x keeps the login in ~/.gemini/antigravity-cli/antigravity-oauth-token.
// Synthetic files only; this order is used on Linux (macOS/Windows keep their keyring-first readers).
describe('Linux agy token file order (simulated)', () => {
  const cliFile = (home: string) => {
    mkdirSync(join(home, '.gemini', 'antigravity-cli'), { recursive: true })
    return join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token')
  }

  it('reads a login kept only in the CLI file store', async () => {
    const f = fixture()
    writeFileSync(cliFile(f.home), JSON.stringify(agy({ id_token: jwt({ email: 'cli@example.com' }) })))
    const result = await f.source('antigravity', f.signal)
    expect(result).toMatchObject({ state: 'authenticated', accountLabel: 'cli@example.com', verification: 'local' })
    expect(JSON.stringify(result)).not.toMatch(/SECRET|eyJ|access_token|refresh_token/)
  })

  it('prefers the CLI file over a legacy file and falls back only when the CLI file is absent', async () => {
    const f = fixture()
    const path = cliFile(f.home)
    writeFileSync(f.agyPath, JSON.stringify(agy({ id_token: jwt({ email: 'legacy@example.com' }) })))
    writeFileSync(path, JSON.stringify(agy({ id_token: jwt({ email: 'cli@example.com' }) })))
    expect((await f.source('antigravity', f.signal))?.accountLabel).toBe('cli@example.com')
    rmSync(path)
    expect((await f.source('antigravity', f.signal))?.accountLabel).toBe('legacy@example.com')
    rmSync(f.agyPath)
    expect((await f.source('antigravity', f.signal))?.state).toBe('unconfigured')
  })

  it('reports an unreadable or linked CLI file as a read error instead of using the legacy file', async () => {
    const f = fixture()
    const path = cliFile(f.home)
    writeFileSync(f.agyPath, JSON.stringify(agy({ id_token: jwt({ email: 'legacy@example.com' }) })))
    writeFileSync(path, 'not-json-SECRET')
    const invalid = await f.source('antigravity', f.signal)
    expect(invalid?.state).toBe('unavailable')
    expect(JSON.stringify(invalid)).not.toMatch(/SECRET|legacy@/)
    rmSync(path)
    symlinkSync(f.agyPath, path)
    expect((await f.source('antigravity', f.signal))?.state).toBe('unavailable')
  })

  it('rejects a linked antigravity-cli directory', async () => {
    const f = fixture()
    const elsewhere = mkdtempSync(join(tmpdir(), 'cwn-identity-elsewhere-'))
    roots.push(elsewhere)
    writeFileSync(join(elsewhere, 'antigravity-oauth-token'), JSON.stringify(agy()))
    symlinkSync(elsewhere, join(f.home, '.gemini', 'antigravity-cli'))
    expect((await f.source('antigravity', f.signal))?.state).toBe('unavailable')
  })
})
