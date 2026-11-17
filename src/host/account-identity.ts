import { lstat, open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CliId } from '../shared/types.ts'
import type { AccountStatus } from '../shared/accounts.ts'
import { safePiOmpAncestors } from './pi-omp-native.ts'

export type AccountIdentity = Pick<
  AccountStatus,
  'state' | 'summary' | 'authMethod' | 'accountLabel' | 'verification' | 'logins'
>
export type AccountIdentitySource = (cli: CliId, signal: AbortSignal) => Promise<AccountIdentity | undefined>

const LIMIT = 64 * 1024
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const credentialPresent = (value: unknown) => typeof value === 'string' && value.trim().length > 0

/** Only email is allowlisted. Reject controls/markup/credential-shaped strings outright. */
export function accountEmail(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 254) return undefined
  if (/\p{C}|[<>]|\b(?:Bearer|sk-|sk_|ghp_|ya29\.)/iu.test(value)) return undefined
  const email = value.trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : undefined
}

function idTokenClaims(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || value.length > 32 * 1024) return undefined
  const pieces = value.split('.')
  if (pieces.length !== 3 || !pieces.every((piece) => /^[A-Za-z0-9_-]+$/.test(piece))) return undefined
  try {
    const claims: unknown = JSON.parse(Buffer.from(pieces[1]!, 'base64url').toString('utf8'))
    return record(claims) ? claims : undefined
  } catch {
    return undefined
  }
}

/** Local expiry is negative evidence only; an unsigned claim never proves login. */
export function localTokenExpired(value: unknown, now = Date.now()): boolean {
  const expiry = idTokenClaims(value)?.exp
  return typeof expiry === 'number' && Number.isFinite(expiry) && expiry * 1000 <= now
}

/** Shared by the Linux token file and the macOS keychain item: both hold the same native JSON. */
export function agyIdentityFromCredential(value: Record<string, unknown>): AccountIdentity {
  if (value.auth_method !== 'consumer' || !record(value.token))
    return {
      state: 'unknown',
      verification: 'local',
      summary: '登录格式未知，请打开账号终端',
    }
  const refreshable = credentialPresent(value.token.refresh_token)
  const expiry = typeof value.token.expiry === 'string' ? Date.parse(value.token.expiry) : NaN
  const active = credentialPresent(value.token.access_token) && Number.isFinite(expiry) && expiry > Date.now()
  if (!refreshable && !active)
    return { state: 'unauthenticated', verification: 'local', summary: '本地登录已过期，请重新登录' }
  return {
    state: 'authenticated',
    authMethod: 'oauth',
    verification: 'local',
    // AGY 1.4.x may keep only id_token_email instead of the full ID token.
    accountLabel: accountEmail(idTokenClaims(value.id_token)?.email) ?? accountEmail(value.id_token_email),
    summary: '已登录 Antigravity',
  }
}

/** agy's legacy file store; macOS/Windows read it once agy has fallen back from the OS keyring. */
export const agyTokenFile = (home = homedir()) => join(home, '.gemini', 'jetski-standalone-oauth-token')

/**
 * agy's CLI file store (`auth.cliFileTokenStorage`, path from `auth.CLITokenFilePath` in agy 1.5.10).
 * GitHub issue #13 (2026-11-17, Linux) reports the login there; macOS/Windows keep their keyring order unchanged.
 */
export const agyCliTokenFile = (home = homedir()) => join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token')

/**
 * Linux login: the CLI file store first, then the legacy file for older agy releases.
 * The legacy file is consulted only when the CLI file does not exist, so a newer login is never shadowed.
 */
export async function readLinuxAgyTokenFile(
  signal: AbortSignal,
  home = homedir(),
): Promise<Record<string, unknown> | undefined> {
  return (await readAgyTokenFile(signal, home, agyCliTokenFile(home))) ?? readAgyTokenFile(signal, home)
}

/**
 * Bounded, ephemeral, no-follow read of agy's token file. Resolves undefined when
 * the file does not exist; any other failure throws without carrying file content.
 */
export async function readAgyTokenFile(
  signal: AbortSignal,
  home = homedir(),
  path = agyTokenFile(home),
): Promise<Record<string, unknown> | undefined> {
  let handle
  let buffer: Buffer | undefined
  try {
    signal.throwIfAborted()
    await safePiOmpAncestors(dirname(path))
    const entry = await lstat(path)
    if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1)
      throw new Error('Invalid account metadata')
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = await handle.stat()
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.dev !== entry.dev ||
      stat.ino !== entry.ino ||
      stat.size > LIMIT
    )
      throw new Error('Invalid account metadata')
    buffer = Buffer.alloc(LIMIT + 1)
    let offset = 0
    while (offset <= LIMIT) {
      signal.throwIfAborted()
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset > LIMIT) throw new Error('Invalid account metadata')
    const after = await handle.stat()
    const current = await lstat(path)
    if (
      current.isSymbolicLink() ||
      current.dev !== stat.dev ||
      current.ino !== stat.ino ||
      current.nlink !== 1 ||
      offset !== stat.size ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      current.size !== after.size ||
      current.mtimeMs !== after.mtimeMs
    )
      throw new Error('Account metadata changed during read')
    const value: unknown = JSON.parse(buffer.subarray(0, offset).toString('utf8'))
    signal.throwIfAborted()
    if (!record(value)) throw new Error('Invalid account metadata')
    return value
  } catch (error) {
    signal.throwIfAborted()
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined
    throw new Error('Invalid account metadata')
  } finally {
    buffer?.fill(0)
    await handle?.close().catch(() => undefined)
  }
}

/**
 * This format/path is verified from the installed AGY CLI. Reading is
 * bounded and ephemeral. No credential leaves this function; ID tokens are decoded
 * only for a display email, never treated as a remotely verified assertion.
 */
export function localAccountIdentity(
  options: {
    home?: string
  } = {},
): AccountIdentitySource {
  return async (cli, signal) => {
    if (cli !== 'antigravity') return undefined
    try {
      const value = await readLinuxAgyTokenFile(signal, options.home ?? homedir())
      return value
        ? agyIdentityFromCredential(value)
        : { state: 'unconfigured', verification: 'local', summary: '尚未登录 Antigravity' }
    } catch {
      signal.throwIfAborted()
      return {
        state: 'unavailable',
        verification: 'local',
        summary: '登录状态读取失败，请重试',
      }
    }
  }
}
