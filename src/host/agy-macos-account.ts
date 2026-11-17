import { homedir } from 'node:os'
import { agyIdentityFromCredential, readAgyTokenFile, type AccountIdentitySource } from './account-identity.ts'
import { ProcessCleanupUnconfirmedError, type ProcessBackend, type RuntimeConfig } from './process.ts'
import { captureMacGenericPassword } from './os-credential-store.ts'

const LIMIT = 64 * 1024
/** agy 1.4.x stores its macOS login through go-keyring; the Windows target is `gemini:antigravity`. */
export const MAC_AGY_KEYCHAIN_ARGUMENTS = [
  '/usr/bin/security',
  'find-generic-password',
  '-s',
  'gemini',
  '-a',
  'antigravity',
  '-w',
] as const

export class MacAgyKeychainError extends Error {
  constructor() {
    super('无法读取 macOS 钥匙串中的 Antigravity 账号，请重试')
    this.name = 'MacAgyKeychainError'
  }
}

/** go-keyring's own encodings for values that `security -w` cannot print verbatim. */
export function decodeMacAgyKeychain(output: string): Record<string, unknown> | undefined {
  const text = output.replace(/\r?\n$/, '')
  if (!text) return undefined
  try {
    if (text.length > LIMIT) throw new Error('oversized')
    const decoded = text.startsWith('go-keyring-base64:')
      ? Buffer.from(text.slice('go-keyring-base64:'.length), 'base64').toString('utf8')
      : text.startsWith('go-keyring-encoded:')
        ? Buffer.from(text.slice('go-keyring-encoded:'.length), 'hex').toString('utf8')
        : text
    const value: unknown = JSON.parse(decoded)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    return value as Record<string, unknown>
  } catch {
    // Neither the item nor a fragment of it is carried by the error.
    throw new MacAgyKeychainError()
  }
}

/** The keychain item alone; `readMacAgyLogin` adds agy's file fallback. */
export async function readMacAgyCredential(
  backend: ProcessBackend,
  config: RuntimeConfig,
  signal: AbortSignal,
): Promise<Record<string, unknown> | undefined> {
  signal.throwIfAborted()
  let output: string
  try {
    // Same argument array as MAC_AGY_KEYCHAIN_ARGUMENTS, built by the shared store reader.
    output = await captureMacGenericPassword(backend, config, { service: 'gemini', account: 'antigravity' }, signal)
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof ProcessCleanupUnconfirmedError) throw error
    throw new MacAgyKeychainError()
  }
  signal.throwIfAborted()
  return decodeMacAgyKeychain(output)
}

/**
 * A readable macOS keychain is authoritative, including a missing item after
 * native logout. Older agy versions can leave a stale token file behind. Only
 * an unreadable keychain permits file fallback; absence alone is not evidence
 * that agy is actively using the file. Windows has its own fallback policy.
 */
export async function readMacAgyLogin(
  backend: ProcessBackend,
  config: RuntimeConfig,
  signal: AbortSignal,
  home = homedir(),
): Promise<Record<string, unknown> | undefined> {
  let failure: MacAgyKeychainError | undefined
  try {
    return await readMacAgyCredential(backend, config, signal)
  } catch (error) {
    if (!(error instanceof MacAgyKeychainError)) throw error
    failure = error
  }
  let file: Record<string, unknown> | undefined
  try {
    file = await readAgyTokenFile(signal, home)
  } catch {
    signal.throwIfAborted()
    throw failure ?? new MacAgyKeychainError()
  }
  if (file) return file
  if (failure) throw failure
  return undefined
}

export function macAgyAccountIdentity(backend: ProcessBackend, config: RuntimeConfig): AccountIdentitySource {
  return async (cli, signal) => {
    if (cli !== 'antigravity') return undefined
    try {
      const credential = await readMacAgyLogin(backend, config, signal)
      return credential
        ? agyIdentityFromCredential(credential)
        : { state: 'unconfigured', verification: 'local', summary: '尚未登录 Antigravity' }
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof ProcessCleanupUnconfirmedError) throw error
      return { state: 'unavailable', verification: 'local', summary: new MacAgyKeychainError().message }
    }
  }
}
