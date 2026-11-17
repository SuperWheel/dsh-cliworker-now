import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { AsyncLocalStorage } from 'node:async_hooks'
import { win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { captureCatalogMetadata } from './adapters.ts'
import {
  accountEmail,
  agyIdentityFromCredential,
  localAccountIdentity,
  readAgyTokenFile,
  type AccountIdentity,
  type AccountIdentitySource,
} from './account-identity.ts'
import type { ProcessBackend, RuntimeConfig } from './process.ts'
import { macAgyAccountIdentity } from './agy-macos-account.ts'

type WindowsAgyAccount = { identity: AccountIdentity; principalHash?: string }
interface AccountSnapshotScope {
  backend: ProcessBackend
  config: RuntimeConfig
  signal: AbortSignal
  active: boolean
  reading?: Promise<WindowsAgyAccount>
}
const accountSnapshots = new AsyncLocalStorage<AccountSnapshotScope>()

/** Only the initial binding and model precheck may share a native projection.
 * The final binding must be read after this operation has exited its scope. */
export async function withWindowsAgyAccountSnapshot<T>(
  backend: ProcessBackend,
  config: RuntimeConfig,
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> {
  signal.throwIfAborted()
  const scope: AccountSnapshotScope = { backend, config, signal, active: true }
  return accountSnapshots.run(scope, async () => {
    try {
      return await operation()
    } finally {
      // Async descendants can retain the ALS store; they must not reuse a
      // projection after the originating operation has completed or failed.
      scope.active = false
      scope.reading = undefined
    }
  })
}

/** Secret-free projection of the exact native Windows credential target. */
export function projectWindowsAgyAccount(raw: string): WindowsAgyAccount {
  try {
    if (raw.length > 4096) throw new Error('Invalid native account projection')
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid projection')
    if (value.state === 'authenticated')
      return {
        identity: {
          state: 'authenticated',
          authMethod: 'oauth',
          verification: 'local',
          summary: '已登录 Antigravity',
          accountLabel: accountEmail(value.email),
        },
        ...(typeof value.principalHash === 'string' && /^[a-f0-9]{64}$/.test(value.principalHash)
          ? { principalHash: value.principalHash }
          : {}),
      }
    if (value.state === 'unconfigured')
      return { identity: { state: 'unconfigured', verification: 'local', summary: '尚未登录 Antigravity' } }
    if (value.state === 'unauthenticated')
      return {
        identity: { state: 'unauthenticated', verification: 'local', summary: '本地登录已过期，请重新登录' },
      }
    if (value.state === 'unknown')
      return {
        identity: { state: 'unknown', verification: 'local', summary: '登录格式未知，请打开账号终端' },
      }
  } catch {
    /* Fixed safe diagnosis below. */
  }
  return {
    identity: {
      state: 'unavailable',
      verification: 'local',
      summary: '无法读取 Windows 原生账号，请在登录的桌面会话中重试',
    },
  }
}

export async function readWindowsAgyAccount(
  backend: ProcessBackend,
  config: RuntimeConfig,
  signal: AbortSignal,
): Promise<WindowsAgyAccount> {
  signal.throwIfAborted()
  const scope = accountSnapshots.getStore()
  if (!scope?.active || scope.backend !== backend || scope.config !== config || scope.signal !== signal)
    return readNativeWindowsAgyAccount(backend, config, signal)
  const reading = (scope.reading ??= readNativeWindowsAgyAccount(backend, config, signal))
  try {
    const account = await reading
    signal.throwIfAborted()
    // A consumer cannot mutate another precheck's safe projection.
    return { ...account, identity: { ...account.identity } }
  } catch (error) {
    if (scope.reading === reading) scope.reading = undefined
    throw error
  }
}

async function readNativeWindowsAgyAccount(
  backend: ProcessBackend,
  config: RuntimeConfig,
  signal: AbortSignal,
): Promise<WindowsAgyAccount> {
  signal.throwIfAborted()
  const raw = await captureCatalogMetadata(
    backend,
    config,
    [
      win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      // This process only: the default Restricted policy would refuse the unsigned helper.
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      fileURLToPath(new URL('./windows-agy-account.ps1', import.meta.url)),
    ],
    homedir(),
    signal,
    undefined,
    [0, 1],
  )
  signal.throwIfAborted()
  const keyring = projectWindowsAgyAccount(raw)
  const state = keyring.identity.state
  if (state !== 'unconfigured' && state !== 'unavailable') return keyring
  // agy 1.5.x keeps the login in its token file once the Credential Manager timed
  // out or failed a write, and then removes the Credential Manager item.
  return windowsAgyAccountFromFile(keyring, signal)
}

/** The file holds the same JSON as the Credential Manager item. */
export function projectAgyCredential(value: Record<string, unknown>): WindowsAgyAccount {
  const identity = agyIdentityFromCredential(value)
  if (identity.state !== 'authenticated') return { identity }
  const claims = idTokenClaims(value.id_token)
  const subject =
    claims &&
    (claims.iss === 'accounts.google.com' || claims.iss === 'https://accounts.google.com') &&
    typeof claims.sub === 'string' &&
    /^[A-Za-z0-9_-]{6,128}$/.test(claims.sub)
      ? claims.sub
      : undefined
  // Same subject hash as windows-agy-account.ps1, so the store in use never changes the binding.
  return subject
    ? { identity, principalHash: createHash('sha256').update(`google:${subject}`, 'utf8').digest('hex') }
    : { identity }
}

function idTokenClaims(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || value.length > 32 * 1024) return undefined
  const pieces = value.split('.')
  if (pieces.length !== 3 || !pieces.every((piece) => /^[A-Za-z0-9_-]+$/.test(piece))) return undefined
  try {
    const claims: unknown = JSON.parse(Buffer.from(pieces[1]!, 'base64url').toString('utf8'))
    return claims && typeof claims === 'object' && !Array.isArray(claims)
      ? (claims as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

export async function windowsAgyAccountFromFile(
  keyring: WindowsAgyAccount,
  signal: AbortSignal,
  home = homedir(),
): Promise<WindowsAgyAccount> {
  let file: Record<string, unknown> | undefined
  try {
    file = await readAgyTokenFile(signal, home)
  } catch {
    signal.throwIfAborted()
    // A broken file is reported as such only when the Credential Manager had nothing either.
    return keyring.identity.state === 'unconfigured'
      ? { identity: { state: 'unavailable', verification: 'local', summary: '登录状态读取失败，请重试' } }
      : keyring
  }
  return file ? projectAgyCredential(file) : keyring
}

export function nativeAgyAccountIdentity(
  backend: ProcessBackend,
  config: RuntimeConfig,
  platform: NodeJS.Platform = process.platform,
): AccountIdentitySource {
  // macOS keeps the login in the keychain; only Linux still reads the token file.
  if (platform === 'darwin') return macAgyAccountIdentity(backend, config)
  if (platform !== 'win32') return localAccountIdentity()
  return async (cli, signal) =>
    cli === 'antigravity' ? (await readWindowsAgyAccount(backend, config, signal)).identity : undefined
}
