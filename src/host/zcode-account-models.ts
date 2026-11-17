import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { createZCodeCredentialReader, type ZCodeCredentialOptions, type ZCodeCredentialReader } from './zcode-credentials.ts'
import { join } from 'node:path'

/** Native identity binding. OAuth may have no legacy key; API secrets stay in the Host. */
export async function readZCodeAccountBindings(
  authDirectory: string,
  providerIds: string[],
  options: ZCodeCredentialOptions = {},
): Promise<Map<string, { identity: string; key: string; authSource: 'oauth' | 'manual' | 'legacy' }>> {
  const result = new Map<string, { identity: string; key: string; authSource: 'oauth' | 'manual' | 'legacy' }>()
  if (!providerIds.length) return result
  options.signal?.throwIfAborted()
  let file: Awaited<ReturnType<typeof open>> | undefined
  let credentials: ZCodeCredentialReader | undefined
  const buffer = Buffer.alloc(64 * 1024 + 1)
  try {
    for (const directory of [
      authDirectory,
      join(authDirectory, '.zcode'),
      join(authDirectory, '.zcode/v2'),
    ]) {
      const info = await lstat(directory)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe ZCode credential directory')
    }
    file = await open(
      join(authDirectory, '.zcode/v2/credentials.json'),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    const info = await file.stat()
    if (!info.isFile() || info.nlink !== 1 || info.size > 64 * 1024 || !info.size)
      throw new Error('Unsafe ZCode credential file')
    let length = 0
    while (length < buffer.length) {
      options.signal?.throwIfAborted()
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    const after = await file.stat()
    if (
      length > 64 * 1024 ||
      length !== info.size ||
      info.size !== after.size ||
      info.mtimeMs !== after.mtimeMs
    )
      throw new Error('ZCode credentials changed during read')
    const raw: unknown = JSON.parse(buffer.subarray(0, length).toString('utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid ZCode credentials')
    credentials = await createZCodeCredentialReader(raw, join(authDirectory, '.zcode/v2/credentials.json'), options)
    const values = credentials.values
    const decode = (id: string) => values[id]?.trim() || undefined
    for (const providerId of new Set(providerIds)) {
      options.signal?.throwIfAborted()
      const identity = decode(`account-provider:${providerId}:identity`)
      if (!identity) continue
      const source = decode(`account-provider:${providerId}:auth-source`)
      if (source && !['oauth', 'manual'].includes(source)) throw new Error('Unsupported ZCode auth source')
      const family = /^account:(bigmodel|zai)-individual-coding-plan$/.exec(providerId)?.[1]
      const access = family && source !== 'manual' ? decode(`oauth:${family}:access_token`) : undefined
      const apiKey = decode(
        `account-provider:coding-plan:${providerId}:account:${encodeURIComponent(identity)}:api-key`,
      )
      // Native 0.17.1 uses the project-token flow. Until supported, retain the
      // identity-scoped legacy key for OAuth too (REQ-0136: no regression).
      // Lqn in native ZCode creates manual identities as key-<sha256 hex slice(0, 24)>.
      if (source === 'oauth' || source !== 'manual' && access && !/^key-[a-f0-9]{24}$/.test(identity)) {
        if (access && !/^key-[a-f0-9]{24}$/.test(identity)) result.set(providerId, { identity, key: apiKey ?? '', authSource: 'oauth' })
        continue
      }
      if (apiKey) result.set(providerId, { identity, key: apiKey, authSource: source === 'manual' ? 'manual' : 'legacy' })
    }
    return result
  } catch (error) {
    options.signal?.throwIfAborted()
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result
    throw new Error('无法安全读取 ZCode 当前账号的 Worker 凭据，请在原生登录设置中检查')
  } finally {
    credentials?.dispose()
    buffer.fill(0)
    await file?.close()
  }
}

/** Key-only view retained for account-scoped metadata queries. */
export async function readZCodeAccountApiKeys(
  authDirectory: string,
  providerIds: string[],
  options: ZCodeCredentialOptions = {},
): Promise<Map<string, string>> {
  return new Map(
    [...(await readZCodeAccountBindings(authDirectory, providerIds, options))].filter(([, value]) => !!value.key).map(([provider, value]) => [
      provider,
      value.key,
    ]),
  )
}
