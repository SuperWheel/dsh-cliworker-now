import { createDecipheriv, createHmac, hkdfSync, scrypt, timingSafeEqual } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { join } from 'node:path'
import {
  OsCredentialStoreError,
  decodeMacSecurityHex,
  keyringHomeDigest,
  readGenericPassword,
  type OsCredentialReadOptions,
} from './os-credential-store.ts'
import type { ProcessBackend, RuntimeConfig } from './process.ts'

/**
 * Read-only view of the keyring side of Codex's own auth storage
 * (openai/codex rust-v0.169.0, `login/src/auth/storage.rs`, `secrets/src/local.rs`):
 *
 * - direct backend: keyring service `Codex Auth`, account `cli|<digest>`, value = the
 *   AuthDotJson as compact JSON;
 * - secrets backend (feature `secret_auth_storage`, on by default on Windows only):
 *   `CODEX_HOME/secrets/codex_auth.age`, an age file for one scrypt recipient whose
 *   passphrase is the keyring item service `codex`, account `secrets|<digest>`; its
 *   plaintext is `{ version, secrets }` and the login is `secrets["global/CODEX_AUTH"]`.
 *
 * `<digest>` is the first 16 hex characters of SHA-256 over the canonical CODEX_HOME.
 * Nothing is refreshed, written, migrated or created (native creates a missing
 * passphrase; this reader reports the store as unreadable instead).
 */
const AGE_INTRO = 'age-encryption.org/v1\n'
const AGE_SCRYPT_LABEL = 'age-encryption.org/v1/scrypt'
const AGE_CHUNK = 64 * 1024
const AGE_TAG = 16
/**
 * Native Codex (age 0.12.1, `scrypt::Recipient::new`) writes no fixed work factor: it
 * takes the first `log_n >= 10` whose derivation lasts a second on that machine and
 * accepts up to four more when reading. That is 20 on current desktop hardware
 * (2^19 measured at ~0.76 s on an Apple M-series), so 20 is the least this reader can
 * accept; it is also the most, because 2^20 already costs 1 GiB inside the Host.
 * The header is not authenticated before the derivation, so the cost is bounded here.
 */
const AGE_MAX_WORK_FACTOR = 20
/** Queue wait, derivation and decryption of one secrets read. */
const SECRETS_TIMEOUT_MS = 30_000

let derivations: Promise<void> = Promise.resolve()
/**
 * One scrypt derivation at a time for the whole Host: at most 1 GiB (2^20) is ever
 * in use, however many account and catalog reads overlap. An abort rejects the
 * caller at once; a derivation that has not started never starts. One that is
 * already running cannot be interrupted: Node's scrypt is a native libuv job, and
 * a worker thread would not help, since `terminate()` only takes effect when native
 * code returns. It is left to finish (seconds at most, by the cap above), its key
 * is wiped, and the queue stays held until then so the memory bound still holds.
 */
function deriveAgeKey(passphrase: string, salt: Buffer, workFactor: number, signal?: AbortSignal): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    let settled = false
    const abort = () => {
      if (settled) return
      settled = true
      reject(signal!.reason)
    }
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
    const cost = 2 ** workFactor
    derivations = derivations.then(() => new Promise<void>((done) => {
      if (settled) return done()
      scrypt(passphrase, salt, 32, { N: cost, r: 8, p: 1, maxmem: 2 * 128 * 8 * cost + 1024 * 1024 }, (error, key) => {
        done()
        signal?.removeEventListener('abort', abort)
        if (settled) return void key?.fill(0)
        settled = true
        if (error) reject(unreadable())
        else resolve(key)
      })
    }))
  })
}
const SECRETS_LIMIT = 1024 * 1024

const unreadable = () => new OsCredentialStoreError()
const base64 = (value: string, length: number): Buffer => {
  // age uses unpadded standard base64 in canonical form.
  if (!/^[A-Za-z0-9+/]+$/.test(value)) throw unreadable()
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length !== length || bytes.toString('base64').replace(/=+$/, '') !== value) throw unreadable()
  return bytes
}
const chacha = (key: Buffer, nonce: Buffer, sealed: Buffer): Buffer => {
  if (sealed.length < AGE_TAG) throw unreadable()
  const cipher = createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: AGE_TAG })
  cipher.setAuthTag(sealed.subarray(sealed.length - AGE_TAG))
  return Buffer.concat([cipher.update(sealed.subarray(0, sealed.length - AGE_TAG)), cipher.final()])
}

/** age v1, binary encoding, exactly one scrypt recipient. Errors carry no content. */
export async function decryptAgeScrypt(ciphertext: Buffer, passphrase: string, signal?: AbortSignal): Promise<Buffer> {
  const keys: Buffer[] = []
  try {
    signal?.throwIfAborted()
    const macLine = ciphertext.indexOf('\n--- ')
    if (macLine < 0 || ciphertext.subarray(0, AGE_INTRO.length).toString('latin1') !== AGE_INTRO) throw unreadable()
    const macEnd = ciphertext.indexOf('\n', macLine + 1)
    if (macEnd < 0) throw unreadable()
    const lines = ciphertext.subarray(AGE_INTRO.length, macLine).toString('latin1').split('\n')
    const stanza = /^-> scrypt ([A-Za-z0-9+/]+) ([1-9][0-9]?)$/.exec(lines[0] ?? '')
    // The wrapped 16-byte file key is one 43-character body line; a scrypt stanza stands alone.
    if (!stanza || lines.length !== 2) throw unreadable()
    const workFactor = Number(stanza[2])
    if (workFactor > AGE_MAX_WORK_FACTOR) throw unreadable()
    const salt = base64(stanza[1]!, 16)
    const wrapped = base64(lines[1]!, 16 + AGE_TAG)
    const mac = base64(ciphertext.subarray(macLine + 5, macEnd).toString('latin1'), 32)
    const wrapKey = await deriveAgeKey(passphrase, Buffer.concat([Buffer.from(AGE_SCRYPT_LABEL), salt]), workFactor, signal)
    keys.push(wrapKey)
    signal?.throwIfAborted()
    const fileKey = chacha(wrapKey, Buffer.alloc(12), wrapped)
    keys.push(fileKey)
    const macKey = Buffer.from(hkdfSync('sha256', fileKey, Buffer.alloc(0), 'header', 32))
    keys.push(macKey)
    const expected = createHmac('sha256', macKey).update(ciphertext.subarray(0, macLine + 4)).digest()
    if (!timingSafeEqual(expected, mac)) throw unreadable()
    const payload = ciphertext.subarray(macEnd + 1)
    if (payload.length < 16 + AGE_TAG) throw unreadable()
    const payloadKey = Buffer.from(hkdfSync('sha256', fileKey, payload.subarray(0, 16), 'payload', 32))
    keys.push(payloadKey)
    const chunks: Buffer[] = []
    const sealedChunk = AGE_CHUNK + AGE_TAG
    for (let offset = 16, counter = 0; offset < payload.length; offset += sealedChunk, counter++) {
      const last = offset + sealedChunk >= payload.length
      const nonce = Buffer.alloc(12)
      nonce.writeUIntBE(counter, 5, 6)
      nonce[11] = last ? 1 : 0
      const chunk = chacha(payloadKey, nonce, payload.subarray(offset, offset + sealedChunk))
      // Only a wholly empty payload may end in an empty chunk.
      if (last && !chunk.length && counter) throw unreadable()
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof OsCredentialStoreError) throw error
    throw unreadable()
  } finally {
    for (const key of keys) key.fill(0)
  }
}

/** Bounded, no-follow read of the encrypted secrets file; `undefined` when it does not exist. */
async function readSecretsFile(path: string, signal: AbortSignal): Promise<Buffer | undefined> {
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    const entry = await lstat(path)
    if (entry.isSymbolicLink() || !entry.isFile() || entry.size > SECRETS_LIMIT) throw unreadable()
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const before = await file.stat()
    if (!before.isFile() || before.dev !== entry.dev || before.ino !== entry.ino || before.size > SECRETS_LIMIT)
      throw unreadable()
    const bytes = Buffer.alloc(before.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      signal.throwIfAborted()
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    const after = await file.stat()
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw unreadable()
    return bytes.subarray(0, offset)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    signal.throwIfAborted()
    throw unreadable()
  } finally {
    await file?.close()
  }
}

function authDocument(serialized: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    // Native: "failed to deserialize CLI auth from keyring".
    throw unreadable()
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unreadable()
  return value as Record<string, unknown>
}

export interface CodexKeyringReadOptions extends OsCredentialReadOptions {
  /** Bound of the secrets backend's queue wait, derivation and decryption. */
  secretsTimeoutMs?: number
}
export interface CodexKeyringQuery {
  /** Effective CODEX_HOME. */
  root: string
  /** Codex's `secret_auth_storage` feature: the encrypted secrets file instead of a direct item. */
  secrets: boolean
}

/**
 * The AuthDotJson Codex's keyring storage would load: the object, `undefined` when
 * that storage holds no login, or `OsCredentialStoreError` when it cannot be read.
 */
export async function readCodexKeyringAuth(
  backend: ProcessBackend,
  config: RuntimeConfig,
  query: CodexKeyringQuery,
  signal: AbortSignal,
  options: CodexKeyringReadOptions = {},
): Promise<Record<string, unknown> | undefined> {
  signal.throwIfAborted()
  const platform = options.platform ?? process.platform
  const digest = await keyringHomeDigest(query.root, platform)
  if (!query.secrets) {
    const serialized = await readGenericPassword(
      backend, config, { service: 'Codex Auth', account: `cli|${digest}` }, signal, options,
    )
    if (serialized === undefined) return undefined
    return authDocument(platform === 'darwin' && !serialized.startsWith('{') ? decodeMacSecurityHex(serialized) : serialized)
  }
  // Native reads no keyring item at all while the secrets file does not exist.
  const ciphertext = await readSecretsFile(join(query.root, 'secrets', 'codex_auth.age'), signal)
  if (!ciphertext) return undefined
  const passphrase = await readGenericPassword(
    backend, config, { service: 'codex', account: `secrets|${digest}` }, signal, options,
  )
  if (!passphrase) throw unreadable()
  // The store read is bounded by its own timeout; this one covers the derivation.
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(options.secretsTimeoutMs ?? SECRETS_TIMEOUT_MS)])
  let plaintext: Buffer
  try {
    plaintext = await decryptAgeScrypt(ciphertext, passphrase, deadline)
  } catch (error) {
    signal.throwIfAborted()
    throw error instanceof OsCredentialStoreError ? error : unreadable()
  }
  try {
    const file = authDocument(plaintext.toString('utf8'))
    const version = file.version ?? 0
    const secrets = file.secrets
    if (typeof version !== 'number' || version > 1 || !secrets || typeof secrets !== 'object' || Array.isArray(secrets))
      throw unreadable()
    const serialized = (secrets as Record<string, unknown>)['global/CODEX_AUTH']
    if (serialized === undefined) return undefined
    if (typeof serialized !== 'string') throw unreadable()
    return authDocument(serialized)
  } finally {
    plaintext.fill(0)
  }
}
