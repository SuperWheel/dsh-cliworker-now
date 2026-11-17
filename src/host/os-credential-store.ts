import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { captureCatalogMetadata } from './adapters.ts'
import { ProcessCleanupUnconfirmedError, type ProcessBackend, type RuntimeConfig } from './process.ts'

/**
 * Read-only access to one generic password of the operating system credential store,
 * the way keyring-rs (`keyring` 3.x, `keyring-core` 1.x with the apple-native and
 * windows-native stores) and go-keyring address it:
 *
 * - macOS: login keychain generic password, service = `service`, account = `account`,
 *   value = the UTF-8 password bytes.
 * - Windows: Credential Manager generic credential (CRED_TYPE_GENERIC) whose target
 *   name is `<account>.<service>`, blob = the password in UTF-16LE.
 * - Linux: Secret Service item with the attributes `service` and `username`.
 *
 * Nothing here writes, migrates or deletes an item. The value only travels over the
 * child's stdout pipe into this process; it is never logged and no error carries it.
 */
export interface OsCredentialQuery {
  service: string
  account: string
}
export interface OsCredentialReadOptions {
  platform?: NodeJS.Platform
  /** Upper bound of one read; the metadata capture itself never waits past 15 s. */
  timeoutMs?: number
}

/** Content-free: neither the item, its names nor a native message is carried. */
export class OsCredentialStoreError extends Error {
  constructor() {
    super('无法读取系统凭据库，请稍后重试')
    this.name = 'OsCredentialStoreError'
  }
}

const LIMIT = 64 * 1024
const MAC_ITEM_NOT_FOUND = 44
const TIMEOUT_MS = 15_000
/**
 * macOS asks the user before `/usr/bin/security` may read an item another program
 * created (ZCode, traex and Codex create theirs through the keychain API, so
 * `security` is not on the item's access list until the user chooses "Always Allow").
 * A read that is denied or runs into the timeout is reported as a failure, never as
 * a missing item, and that item (service + account) is then not read again by any
 * background or polling path until the Host restarts, so the prompt cannot come back
 * on its own. Only an explicit user action (`explicitCredentialRead`) asks again, and
 * the reads of one such action share a single attempt. A missing item is an answer,
 * not a denial, and is never suppressed.
 */
const EXPLICIT_RETRY_GAP_MS = 30_000
const denied = new Map<string, number>()
const readScope = new AsyncLocalStorage<{ explicit: boolean }>()

/** A user-initiated account action (account window, refresh, dispatch admission).
 * An enclosing scope decides, so background work stays background throughout. */
export function explicitCredentialRead<T>(operation: () => T): T {
  return readScope.getStore() ? operation() : readScope.run({ explicit: true }, operation)
}
/** Polling, preloading and other work the user did not ask for just now. */
export function backgroundCredentialRead<T>(operation: () => T): T {
  return readScope.run({ explicit: false }, operation)
}

const valid = (value: string) =>
  typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value)

/** Exactly the argument array agy's own keychain read has always used. */
export const macGenericPasswordArguments = (query: OsCredentialQuery): string[] => [
  '/usr/bin/security',
  'find-generic-password',
  '-s',
  query.service,
  '-a',
  query.account,
  '-w',
]
/** keyring-rs default target name: `{user}.{service}`. */
export const windowsCredentialTarget = (query: OsCredentialQuery) => `${query.account}.${query.service}`

/**
 * The raw `security … -w` output. Exit code 44 (item not found) yields an empty
 * string; every other failure is thrown as the capture reports it, so that callers
 * with their own error contract (agy) keep it unchanged.
 */
export function captureMacGenericPassword(
  backend: ProcessBackend,
  config: RuntimeConfig,
  query: OsCredentialQuery,
  signal: AbortSignal,
): Promise<string> {
  return captureCatalogMetadata(
    backend,
    config,
    macGenericPasswordArguments(query),
    homedir(),
    signal,
    undefined,
    [0, MAC_ITEM_NOT_FOUND],
  )
}

/** `security -w` prints a value that is not plain printable ASCII as one hex string. */
export function decodeMacSecurityHex(output: string): string {
  if (!/^(?:[0-9a-f]{2})+$/i.test(output)) return output
  const bytes = Buffer.from(output, 'hex')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return output
  } finally {
    bytes.fill(0)
  }
}

function windowsBlob(raw: string): string | undefined {
  if (raw.length > LIMIT * 2) throw new OsCredentialStoreError()
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OsCredentialStoreError()
  const { state, blob } = value as Record<string, unknown>
  if (state === 'missing') return undefined
  if (state !== 'found' || typeof blob !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(blob))
    throw new OsCredentialStoreError()
  const bytes = Buffer.from(blob, 'base64')
  try {
    // keyring-rs stores passwords as UTF-16LE; anything else is not an item it wrote.
    if (!bytes.length || bytes.length % 2 || bytes.length > LIMIT) throw new OsCredentialStoreError()
    return new TextDecoder('utf-16le', { fatal: true }).decode(bytes)
  } finally {
    bytes.fill(0)
  }
}

async function readNative(
  backend: ProcessBackend,
  config: RuntimeConfig,
  query: OsCredentialQuery,
  signal: AbortSignal,
  platform: NodeJS.Platform,
): Promise<string | undefined> {
  if (platform === 'darwin') {
    const output = (await captureMacGenericPassword(backend, config, query, signal)).replace(/\r?\n$/, '')
    if (output.length > LIMIT) throw new OsCredentialStoreError()
    return output || undefined
  }
  if (platform === 'win32') {
    const raw = await captureCatalogMetadata(
      backend,
      config,
      [
        win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        // For this one process only: the default Restricted policy would refuse the
        // unsigned helper before it runs. The persistent policy is never changed.
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        fileURLToPath(new URL('./windows-credential-read.ps1', import.meta.url)),
        // Not a secret; base64url keeps `|`, spaces and quotes out of the command line.
        Buffer.from(windowsCredentialTarget(query), 'utf8').toString('base64url'),
      ],
      homedir(),
      signal,
    )
    return windowsBlob(raw)
  }
  if (platform === 'linux') {
    // libsecret's CLI: exit 0 prints the secret, exit 1 without output means no such item.
    // It cannot tell "no item" from "no Secret Service"; both read as missing here.
    const output = (
      await captureCatalogMetadata(
        backend,
        config,
        ['secret-tool', 'lookup', 'service', query.service, 'username', query.account],
        homedir(),
        signal,
        undefined,
        [0, 1],
      )
    ).replace(/\r?\n$/, '')
    if (output.length > LIMIT) throw new OsCredentialStoreError()
    return output || undefined
  }
  throw new OsCredentialStoreError()
}

/**
 * One generic password: the value, `undefined` when the store has no such item, or
 * an `OsCredentialStoreError` when the store could not be read (locked, denied,
 * timed out, unsupported). A failure must be shown as "unavailable", not "signed out".
 */
export async function readGenericPassword(
  backend: ProcessBackend,
  config: RuntimeConfig,
  query: OsCredentialQuery,
  signal: AbortSignal,
  options: OsCredentialReadOptions = {},
): Promise<string | undefined> {
  signal.throwIfAborted()
  if (!valid(query.service) || !valid(query.account)) throw new OsCredentialStoreError()
  const platform = options.platform ?? process.platform
  const key = JSON.stringify([platform, query.service, query.account])
  const refused = denied.get(key)
  if (refused !== undefined && !(readScope.getStore()?.explicit && Date.now() - refused >= EXPLICIT_RETRY_GAP_MS))
    throw new OsCredentialStoreError()
  const control = AbortSignal.any([signal, AbortSignal.timeout(Math.min(options.timeoutMs ?? TIMEOUT_MS, TIMEOUT_MS))])
  try {
    const value = await readNative(backend, config, query, control, platform)
    signal.throwIfAborted()
    denied.delete(key)
    return value
  } catch (error) {
    if (error instanceof ProcessCleanupUnconfirmedError) throw error
    signal.throwIfAborted()
    // Only macOS has the prompt; elsewhere a failed read is simply tried again.
    if (platform === 'darwin') denied.set(key, Date.now())
    throw new OsCredentialStoreError()
  }
}

export type OsSecretReader = (service: string, account: string, signal: AbortSignal) => Promise<string | undefined>

let installed: { reader: OsSecretReader } | undefined

/**
 * Readers that are not handed a process backend (ZCode's credential cipher) use the
 * Host's one; until the Host installs it they stay unavailable and start no process.
 * Every read through it also ends with the Host: the returned release aborts the
 * reads still running (some callers pass no signal of their own) and resolves only
 * after their process ranges have been cleaned up. It belongs to the Host's lifetime cleanup.
 */
export function installOsCredentialStore(
  backend: ProcessBackend,
  config: RuntimeConfig,
  options: OsCredentialReadOptions = {},
): () => Promise<void> {
  const lifetime = new AbortController()
  const active = new Set<Promise<ProcessCleanupUnconfirmedError | undefined>>()
  const entry = {
    reader: ((service, account, signal) => {
      const reading = readGenericPassword(
        backend, config, { service, account }, AbortSignal.any([signal, lifetime.signal]), options,
      )
      const tracked = reading.then(
        () => undefined,
        (error) => (error instanceof ProcessCleanupUnconfirmedError ? error : undefined),
      )
      active.add(tracked)
      void tracked.then(() => active.delete(tracked))
      return reading
    }) satisfies OsSecretReader,
  }
  installed = entry
  return async () => {
    if (installed === entry) installed = undefined
    lifetime.abort(new OsCredentialStoreError())
    // Each read settles only after its capture has terminated and awaited its process range.
    const unconfirmed = (await Promise.all([...active])).find((error) => error)
    denied.clear()
    if (unconfirmed) throw unconfirmed
  }
}
export const installedOsSecretReader = (): OsSecretReader | undefined => installed?.reader

/**
 * Rust's `Path::canonicalize()` text, which Codex and its forks hash into keyring
 * account names. On Windows the standard library returns the verbatim form
 * (`\\?\C:\…`, `\\?\UNC\server\share\…`); a path that cannot be resolved is used as given.
 */
export async function rustCanonicalPath(path: string, platform: NodeJS.Platform = process.platform): Promise<string> {
  let canonical: string
  try {
    canonical = await realpath(path)
  } catch {
    return path
  }
  if (platform !== 'win32' || canonical.startsWith('\\\\?\\')) return canonical
  return canonical.startsWith('\\\\') ? `\\\\?\\UNC\\${canonical.slice(2)}` : `\\\\?\\${canonical}`
}
/** `sha256(canonical home)` as hex, first 16 characters: Codex's `compute_store_key` digest. */
export async function keyringHomeDigest(home: string, platform: NodeJS.Platform = process.platform): Promise<string> {
  return createHash('sha256').update(await rustCanonicalPath(home, platform), 'utf8').digest('hex').slice(0, 16)
}
