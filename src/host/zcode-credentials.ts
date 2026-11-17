import { createDecipheriv, createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { homedir, platform, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Content-free errors: never expose ciphertext, secrets or native exception messages. */
export class ZCodeCredentialError extends Error {
  constructor(readonly state: 'unknown' | 'unavailable' = 'unavailable') {
    super(state === 'unknown' ? 'ZCode 凭据格式不受支持' : '无法安全读取 ZCode 凭据加密密钥')
  }
}
export interface ZCodeCredentialOptions {
  signal?: AbortSignal
  credentialSecret?: string
  env?: NodeJS.ProcessEnv
  /** Read-only, non-interactive store transport; unavailable unless supplied. */
  readOsSecret?: (service: string, account: string, signal: AbortSignal) => Promise<string | undefined>
}
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest()
function legacySecrets(secret?: string): string[] {
  let username = 'unknown'
  try { username = userInfo().username } catch { /* native fallback */ }
  const fallback = `zcode-credential-fallback:${platform()}:${homedir()}:${username}`
  return [...new Set([secret || fallback, secret?.trim() || fallback, fallback])]
}
function decrypt(body: string, key: Buffer): string {
  const parts = body.split('.')
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]*$/.test(part)))
    throw new ZCodeCredentialError('unknown')
  const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64url'))
  if (iv!.length !== 12 || tag!.length !== 16) throw new ZCodeCredentialError('unknown')
  try {
    const cipher = createDecipheriv('aes-256-gcm', key, iv!)
    cipher.setAuthTag(tag!)
    const plain = Buffer.concat([cipher.update(ciphertext!), cipher.final()])
    try { return plain.toString('utf8') } finally { plain.fill(0) }
  } catch { throw new ZCodeCredentialError() }
}
function values(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ZCodeCredentialError('unknown')
  if (Object.values(raw).some((value) => typeof value !== 'string')) throw new ZCodeCredentialError('unknown')
  return raw as Record<string, string>
}
function legacy(value: string, secret?: string): string {
  if (!value.startsWith('enc:')) return value
  if (!value.startsWith('enc:v1:')) throw new ZCodeCredentialError('unknown')
  for (const candidate of legacySecrets(secret)) {
    const key = digest(candidate)
    try { return decrypt(value.slice(7), key) } catch { /* next native legacy candidate */ }
    finally { key.fill(0) }
  }
  throw new ZCodeCredentialError()
}
/** Enumerating names never decrypts a value; only an actual property read does. */
function lazyValues(raw: Record<string, string>, decode: (value: string) => string): Record<string, string> {
  const view: Record<string, string> = Object.create(null)
  for (const [name, value] of Object.entries(raw))
    Object.defineProperty(view, name, { enumerable: true, get: () => decode(value) })
  return view
}
/** Compatibility projection for callers already holding a v1 record, also decoded per key. */
export function decodeZCodeLegacyCredentials(raw: unknown, secret?: string): Record<string, string> {
  return lazyValues(values(raw), (value) => legacy(value, secret))
}

export interface ZCodeCredentialReader {
  /** Lazy view: accessing a required property propagates decryption failure. */
  values: Record<string, string>
  dispose(): void
}

/** Bounded no-follow read, with identity/size/mtime readback. Never creates or migrates files. */
async function readSecretFile(path: string, limit: number, privateMode = false): Promise<string | undefined> {
  let file: Awaited<ReturnType<typeof open>> | undefined
  const bytes = Buffer.alloc(limit + 1)
  try {
    const before = await lstat(path)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > limit ||
      privateMode && platform() !== 'win32' && (before.mode & 0o077) !== 0) throw new ZCodeCredentialError()
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = await file.stat()
    if (stat.dev !== before.dev || stat.ino !== before.ino) throw new ZCodeCredentialError()
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    const after = await file.stat(), current = await lstat(path)
    if (length > limit || length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs ||
      current.dev !== stat.dev || current.ino !== stat.ino || current.isSymbolicLink()) throw new ZCodeCredentialError()
    return bytes.subarray(0, length).toString('utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new ZCodeCredentialError()
  } finally { bytes.fill(0); await file?.close() }
}

/** ZCode 0.17.1 cipher selection, without native initialization/migration side effects. */
export async function createZCodeCredentialReader(
  raw: unknown, filePath: string, options: ZCodeCredentialOptions = {},
): Promise<ZCodeCredentialReader> {
  options.signal?.throwIfAborted()
  const entries = Object.entries(values(raw)), env = options.env ?? process.env
  let secret = options.credentialSecret ?? env.ZCODE_CREDENTIAL_SECRET
  if (secret && env.ZCODE_CREDENTIAL_SECRET_FILE) throw new ZCodeCredentialError()
  if (env.ZCODE_CREDENTIAL_SECRET_FILE) {
    secret = await readSecretFile(env.ZCODE_CREDENTIAL_SECRET_FILE, 4096)
    if (!secret || Buffer.byteLength(secret) < 32) throw new ZCodeCredentialError()
  }
  const hasV2 = entries.some(([, value]) => value.startsWith('enc:v2:'))
  let key: Buffer | undefined, source: 'env' | 'os' = 'env'
  try {
    if (!secret) {
      const marker = await readSecretFile(join(dirname(resolve(filePath)), 'credential-source'), 64)
      if (marker !== undefined && marker !== 'os\n') throw new ZCodeCredentialError()
      const pinned = marker !== undefined || entries.some(([, value]) => value.startsWith('enc:v2:os:'))
      if (!pinned) {
        secret = await readSecretFile(join(dirname(resolve(filePath)), 'credential-secret'), 4096, true)
        if (secret !== undefined && Buffer.byteLength(secret) < 32) throw new ZCodeCredentialError()
      }
      if (hasV2 && !secret) {
        if (!pinned && entries.some(([, value]) => value.startsWith('enc:v2:env:')))
          throw new ZCodeCredentialError()
        // Existing AGY readers are account-specific. macOS security -w may prompt;
        // the Windows helper returns AGY identity, not a generic NAPI keyring secret.
        // Until a proven non-interactive transport exists, fail closed without launching either.
        if (!options.readOsSecret) throw new ZCodeCredentialError()
        const signal = AbortSignal.any([AbortSignal.timeout(3_000), ...(options.signal ? [options.signal] : [])])
        const encoded = await options.readOsSecret('ZCode Credential Encryption', digest(resolve(filePath)).toString('hex'), signal)
        signal.throwIfAborted()
        if (!encoded || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw new ZCodeCredentialError()
        key = Buffer.from(encoded, 'base64url')
        if (key.length !== 32) throw new ZCodeCredentialError()
        source = 'os'
      }
    }
    if (secret) key = digest(secret)
    let disposed = false
    return {
      values: lazyValues(Object.fromEntries(entries), (value) => {
        options.signal?.throwIfAborted()
        if (disposed) throw new ZCodeCredentialError()
        // Unrelated broken records are never inspected; requested envelopes still fail closed.
        if (!value.startsWith('enc:v2:')) return legacy(value, secret)
        if (!/^enc:v2:(os|env):[a-f0-9]{24}:[A-Za-z0-9_.-]+$/.test(value))
          throw new ZCodeCredentialError('unknown')
        const [, , selected, fingerprint, body] = value.split(':')
        if (!key || selected !== source || digest(key).toString('hex').slice(0, 24) !== fingerprint)
          throw new ZCodeCredentialError()
        return decrypt(body!, key)
      }),
      dispose() { disposed = true; key?.fill(0) },
    }
  } catch (error) {
    key?.fill(0)
    options.signal?.throwIfAborted()
    if (error instanceof ZCodeCredentialError) throw error
    throw new ZCodeCredentialError()
  }
}

/** Explicit full-record decoding for isolated format tests; runtime callers use the lazy reader. */
export async function decodeZCodeCredentials(
  raw: unknown, filePath: string, options: ZCodeCredentialOptions = {},
): Promise<Record<string, string>> {
  const reader = await createZCodeCredentialReader(raw, filePath, options)
  try { return Object.fromEntries(Object.entries(reader.values)) }
  finally { reader.dispose() }
}
