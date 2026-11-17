import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { AccountLogin } from '../shared/accounts.ts'
import { accountLoginId } from '../shared/account-links.ts'
import type { AccountIdentity } from './account-identity.ts'
import { providerLogin } from './account-login.ts'
import { safePiOmpAncestors } from './pi-omp-native.ts'

const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
const literal = (value: unknown) =>
  text(value) && !/^(?:!|\$|\{|<|your[_ -]|placeholder|changeme)/i.test(value) && !/[\x00-\x20]/.test(value)
const unavailable = (): AccountIdentity => ({
  state: 'unavailable',
  verification: 'local',
  summary: 'Kimi 登录状态读取失败，请检查配置',
})
/** The account window's id provider for the managed Kimi Code OAuth login (`kimi:kimi-code`). */
export const KIMI_CODE_LOGIN = 'kimi-code'
export const KIMI_MANAGE_LOGIN =
  '已登录 Kimi。若出现 Trust 提示，请自行确认此空账号目录；切换账号输入 /logout，再输入 /login。'

/** Native Kimi has no --no-mcp switch and asks Trust even for an empty folder.
 * Its findGitWorkTree stops at the first .git directory. An empty owned marker
 * keeps project MCP lookup here even when plugin state lives under a repository.
 * Never mark the folder trusted or change the native account home. */
export async function prepareKimiAccountDirectory(stateDirectory: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const parent = join(resolve(stateDirectory), 'account-runtime')
  await safePiOmpAncestors(parent)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  await safePiOmpAncestors(parent)
  const canonicalParent = await realpath(parent)
  const parentIdentity = await lstat(canonicalParent)
  const cwd = await mkdtemp(join(canonicalParent, 'kimi-'))
  const identity = await lstat(cwd)
  let removed = false
  const cleanup = async () => {
    if (removed) return
    const parentNow = await lstat(canonicalParent)
    if (
      parentNow.isSymbolicLink() ||
      parentNow.dev !== parentIdentity.dev ||
      parentNow.ino !== parentIdentity.ino
    )
      throw new Error('Kimi account runtime parent changed before cleanup')
    try {
      const current = await lstat(cwd)
      if (current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino)
        throw new Error('Kimi account runtime changed before cleanup')
      await rm(cwd, { recursive: true, force: true })
      removed = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') removed = true
      else throw error
    }
  }
  try {
    await mkdir(join(cwd, '.git'), { mode: 0o700 })
    await mkdir(join(cwd, '.kimi-code'), { mode: 0o700 })
    for (const path of [join(cwd, '.mcp.json'), join(cwd, '.kimi-code/mcp.json')])
      await writeFile(path, '{"mcpServers":{}}\n', { flag: 'wx', mode: 0o600 })
    signal.throwIfAborted()
    return { cwd, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

/** Installed Kimi toolkit.resolveKimiTokenStorageName, constrained to one own file. */
export function resolveKimiTokenStorageName(key: unknown): string {
  key ??= 'oauth/kimi-code'
  if (key === 'kimi-code' || key === 'oauth/kimi-code') return 'kimi-code'
  if (!text(key)) throw new Error('Unknown Kimi OAuth slot')
  const slot = key.startsWith('oauth/') ? key.slice(6) : key
  if (!slot || basename(slot) !== slot || slot.startsWith('.') || /[\\\x00-\x1f]/.test(slot))
    throw new Error('Unsafe Kimi OAuth slot')
  return slot
}

/** Display metadata only, never a JWT verification or an authentication decision.
 * Native stableJwtSubject uses sub, then user_id. Recognize the observed native
 * kimi-auth issuer and omit ambiguous/unknown identities without changing login.
 * The label contains six decoded account-ID characters, never token characters. */
function kimiAccountLabel(accessToken: string): string | undefined {
  const parts = accessToken.split('.')
  if (
    parts.length !== 3 ||
    !parts.every((part) => part.length > 0 && /^[A-Za-z0-9_-]+$/.test(part)) ||
    parts[1].length > 16 * 1024
  )
    return undefined
  let bytes: Buffer | undefined
  try {
    bytes = Buffer.from(parts[1], 'base64url')
    if (bytes.toString('base64url') !== parts[1]) return undefined
    const claims: unknown = JSON.parse(bytes.toString('utf8'))
    if (!object(claims) || claims.iss !== 'kimi-auth') return undefined
    const safeId = (value: unknown): value is string =>
      typeof value === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9_-]{6,127}$/.test(value) &&
      !/^(?:sk[-_]|pk[-_]|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|bearer|token|eyJ|placeholder|changeme|your[-_])/i.test(
        value,
      )
    if (
      (claims.sub !== undefined && !safeId(claims.sub)) ||
      (claims.user_id !== undefined && !safeId(claims.user_id)) ||
      (claims.sub !== undefined && claims.user_id !== undefined && claims.sub !== claims.user_id)
    )
      return undefined
    const id = claims.sub ?? claims.user_id
    return safeId(id) ? `Kimi ID · …${id.slice(-6)}` : undefined
  } catch {
    return undefined
  } finally {
    bytes?.fill(0)
  }
}

/** No-follow, bounded read; never refreshes, creates or modifies the native token. */
export async function readKimiOwnToken(directory: string, slot: string, signal: AbortSignal) {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  let bytes: Buffer | undefined
  try {
    signal.throwIfAborted()
    slot = resolveKimiTokenStorageName(slot)
    await safePiOmpAncestors(directory)
    const path = join(directory, `${slot}.json`)
    const entry = await lstat(path)
    if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1)
      throw new Error('Unsafe Kimi token file')
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const before = await handle.stat()
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.dev !== entry.dev ||
      before.ino !== entry.ino ||
      before.size > 64 * 1024
    )
      throw new Error('Unsafe Kimi token file')
    bytes = Buffer.alloc(before.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      signal.throwIfAborted()
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    const after = await handle.stat()
    const current = await lstat(path)
    if (
      current.isSymbolicLink() ||
      current.dev !== before.dev ||
      current.ino !== before.ino ||
      current.nlink !== 1 ||
      offset !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      current.size !== after.size ||
      current.mtimeMs !== after.mtimeMs
    )
      throw new Error('Kimi token changed during read')
    signal.throwIfAborted()
    const parsed: unknown = JSON.parse(bytes.subarray(0, offset).toString('utf8'))
    if (!object(parsed)) throw new Error('Invalid Kimi token file')
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  } finally {
    bytes?.fill(0)
    await handle?.close()
  }
}

/** Consume native `provider list --json` internally; only safe identity metadata escapes. */
export async function readKimiAccount(
  raw: string,
  signal: AbortSignal,
  options: { home?: string; now?: number } = {},
): Promise<AccountIdentity> {
  try {
    signal.throwIfAborted()
    const config: unknown = JSON.parse(raw)
    if (!object(config) || !object(config.providers)) return unavailable()
    // One row per own API provider with a literal key, in the order of Kimi's /logout list.
    const apiLogins: AccountLogin[] = Object.entries(config.providers)
      .filter(
        ([, provider]) =>
          object(provider) &&
          !provider.oauth &&
          (literal(provider.apiKey) || literal(provider.env?.KIMI_API_KEY)),
      )
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, provider]) => {
        // `kimi:kimi-code` is the managed OAuth login; an API provider of that name is not removable here.
        const id = key === KIMI_CODE_LOGIN ? undefined : accountLoginId('kimi', key)
        return { ...providerLogin(key, 'api', { baseUrl: provider.baseUrl }), ...(id ? { id } : {}) }
      })
    const api = apiLogins.length > 0
    const configured: AccountIdentity = api
      ? {
          state: 'configured',
          verification: 'local',
          authMethod: 'api',
          summary: '已配置 Kimi API',
          logins: apiLogins,
        }
      : { state: 'unconfigured', verification: 'local', summary: '尚未登录 Kimi' }
    const provider = config.providers['managed:kimi-code']
    if (!object(provider) || provider.oauth === undefined) return configured
    if (provider.type !== 'kimi' || !object(provider.oauth) || provider.oauth.storage !== 'file')
      return { state: 'unknown', verification: 'local', summary: 'Kimi 登录配置暂不支持，请打开账号终端' }
    const slot = resolveKimiTokenStorageName(provider.oauth.key)
    const token = await readKimiOwnToken(
      join(options.home ?? process.env.KIMI_CODE_HOME ?? join(homedir(), '.kimi-code'), 'credentials'),
      slot,
      signal,
    )
    if (!token) return configured
    // Native classifyToken treats an empty access token as a revoked tombstone,
    // including one with an old refresh token. Expiry is negative evidence only.
    if (token.access_token === '' || token.access_token === undefined)
      return api
        ? configured
        : { state: 'unauthenticated', verification: 'local', summary: 'Kimi 登录已失效，请重新登录' }
    if (
      !text(token.access_token) ||
      (token.refresh_token !== undefined && typeof token.refresh_token !== 'string') ||
      (token.expires_at !== undefined &&
        (typeof token.expires_at !== 'number' || !Number.isFinite(token.expires_at) || token.expires_at < 0))
    )
      return unavailable()
    const expires = token.expires_at ?? 0
    if (expires > 0 && expires * 1000 <= (options.now ?? Date.now()) && !text(token.refresh_token))
      return api
        ? configured
        : { state: 'unauthenticated', verification: 'local', summary: 'Kimi 登录已过期，请重新登录' }
    const accountLabel = kimiAccountLabel(token.access_token)
    const oauthLogin: AccountLogin = {
      providerLabel: 'Kimi Code',
      authMethod: 'oauth',
      ...(accountLabel ? { accountLabel } : {}),
      id: `kimi:${KIMI_CODE_LOGIN}`,
    }
    return {
      state: 'authenticated',
      authMethod: 'oauth',
      verification: 'local',
      summary: '已登录 Kimi',
      ...(accountLabel ? { accountLabel } : {}),
      logins: [oauthLogin, ...apiLogins],
    }
  } catch {
    signal.throwIfAborted()
    return unavailable()
  }
}
