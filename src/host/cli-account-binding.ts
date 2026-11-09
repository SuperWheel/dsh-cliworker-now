import { readCodebuddyAccountBindingMaterial, CodebuddyAccountError } from './codebuddy-account.ts'
import { isWorkBuddyCli } from './workbuddy-variant.ts'
import { readWorkBuddyMetadata } from './workbuddy-metadata.ts'
import {
  readClaudeOwnRoute,
  claudeRouteStatusArguments,
  claudeRouteIdentity,
  ClaudeOwnRouteError,
  claudeLaunchEnvironment,
  type ClaudeOwnRoute,
} from './claude-own-route.ts'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { CLI_LABELS, type CliId } from '../shared/types.ts'
import { captureCatalogMetadata, resolveCliExecutable } from './adapters.ts'
import { readCodexAccount } from './codex-account.ts'
import { accountEmail } from './account-identity.ts'
import { assertAgyNativeAccountRoute } from './agy-models.ts'
import { readWindowsAgyAccount } from './agy-windows-account.ts'
import { readMacAgyCredential } from './agy-macos-account.ts'
import { readFirstPartyModelSources } from './first-party-models.ts'
import { KimiOAuthModelError } from './kimi-oauth-models.ts'
import { readPiOmpAccountMaterial, safePiOmpAncestors } from './pi-omp-native.ts'
import { readOpenCodeProfile, OPENCODE_OAUTH_UNSUPPORTED } from './opencode-native.ts'
import { openCodeAuthDirectory } from './opencode-adapter.ts'
import { effectiveHermesHome } from './hermes-account-context.ts'
import { assertHermesOwnAccounts, HermesAccountSourceError, hermesPoolEntryUnavailable } from './hermes-models.ts'
import { HermesNousError, selectHermesNousSource } from './hermes-nous.ts'
import { hermesUnsuppressedEnvironment, projectHermesUnsuppressedAuth } from './hermes-suppression.ts'
import { readZCodeBindingMaterial, zcodeAuthDirectory } from './zcode-adapter.ts'
import { ProcessCleanupUnconfirmedError, type ProcessBackend, type RuntimeConfig } from './process.ts'
import { ensureHermesNousFresh, HermesRenewalError } from './hermes-renewal.ts'
import { readQoderAccountBindingMaterial, QoderAccountError } from './qoder-accounts.ts'

const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim()
const literal = (v: unknown): v is string =>
  text(v) && !/^(?:!|\$|op:\/\/|<|your[_ -]|placeholder|changeme)/i.test(v.trim()) && !/[\x00-\x1f]/.test(v)
const hash = (v: string) => createHash('sha256').update(v).digest('hex')
const stable = (v: unknown): string => JSON.stringify(sort(v))
function sort(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sort)
  return object(v)
    ? Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((key) => [key, sort(v[key])]),
      )
    : v
}

/** Safe public error; neither secrets nor native paths are interpolated. */
/** A sign-out is told as such, so a caller asks the user to sign in rather than retrying. */
export const AGY_SIGNED_OUT = '尚未登录 Antigravity，请在「CLI Worker 设置 → Antigravity」点击「登录账号」完成登录后再继续'
export class CliAccountBindingError extends Error {
  readonly code = 'CLI_OWN_ACCOUNT_REQUIRED'
  constructor(cli: CliId, reason?: string) {
    super(reason ?? `${CLI_LABELS[cli]} 无法确认当前自身账号，请检查该 CLI 的登录或 API 配置`)
    this.name = 'CliAccountBindingError'
  }
}

interface BindingEntry {
  provider: string
  principal: unknown
  route?: unknown
}
interface BindingMaterial {
  sourceIds: string[]
  entries: BindingEntry[]
}

/** Unsigned claims are identity labels only; they never establish entitlement. */
function claims(value: unknown): Record<string, any> {
  if (!text(value) || value.length > 64 * 1024) return {}
  const parts = value.split('.')
  if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return {}
  const bytes = Buffer.from(parts[1]!, 'base64url')
  try {
    const parsed: unknown = JSON.parse(bytes.toString('utf8'))
    return object(parsed) ? parsed : {}
  } catch {
    return {}
  } finally {
    bytes.fill(0)
  }
}
function expiry(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(n) ? (n < 1e11 ? n * 1000 : n) : undefined
}
function oauthPrincipal(value: Record<string, any>): unknown {
  const access = value.access ?? value.access_token ?? value.accessToken ?? value.key
  const refresh = value.refresh ?? value.refresh_token ?? value.refreshToken
  const identity = claims(value.id_token ?? value.idToken)
  const token = claims(access)
  const expires =
    expiry(value.expires ?? value.expires_at ?? value.expiresAt ?? value.expiry) ?? expiry(token.exp)
  if (!literal(refresh) && (!literal(access) || expires === undefined || expires <= Date.now())) return
  const accountId =
    value.accountId ?? value.account_id ?? token['https://api.openai.com/auth']?.chatgpt_account_id
  const subject = identity.sub ?? token.sub ?? value.userId ?? value.user_id
  const email = identity.email ?? value.email
  // Access/refresh token text is deliberately excluded: native OAuth may rotate both.
  if (!text(accountId) && !text(subject) && !text(email)) return
  return {
    kind: 'oauth',
    ...(text(accountId) ? { accountId } : {}),
    ...(text(subject) ? { subject } : text(email) ? { email: email.toLowerCase() } : {}),
    ...(text(identity.iss ?? token.iss) ? { issuer: identity.iss ?? token.iss } : {}),
    ...(text(value.organizationId ?? value.organization_id)
      ? { organization: value.organizationId ?? value.organization_id }
      : {}),
  }
}
function credentialEntry(provider: string, credential: any, route?: unknown): BindingEntry | undefined {
  if (!object(credential)) return
  if (['api', 'api_key'].includes(credential.type)) {
    const key = credential.key ?? credential.apiKey
    return literal(key) ? { provider, route, principal: { kind: 'api', key: hash(key) } } : undefined
  }
  if (credential.type === 'oauth') {
    const principal = oauthPrincipal(credential)
    if (principal) return { provider, route, principal }
  }
}

/** Bounded, no-follow local reads; missing files are never replaced by ambient credentials. */
async function read(path: string, signal: AbortSignal): Promise<string | undefined> {
  signal.throwIfAborted()
  let handle: Awaited<ReturnType<typeof open>> | undefined
  let bytes: Buffer | undefined
  try {
    await safePiOmpAncestors(dirname(path))
    const entry = await lstat(path)
    if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1)
      throw new Error('Unsafe account metadata')
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const before = await handle.stat()
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.dev !== entry.dev ||
      before.ino !== entry.ino ||
      before.size > 1024 * 1024
    )
      throw new Error('Unsafe account metadata')
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
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      current.size !== after.size ||
      current.mtimeMs !== after.mtimeMs
    )
      throw new Error('Account metadata changed')
    return bytes.subarray(0, offset).toString('utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  } finally {
    bytes?.fill(0)
    await handle?.close()
  }
}
async function document(path: string, signal: AbortSignal) {
  const raw = await read(path, signal)
  if (raw === undefined) return {}
  const value: unknown = JSON.parse(raw)
  if (!object(value)) throw new Error('Invalid native account')
  return value
}

function codexConfigPaths(root: string, project: string) {
  const ancestors: string[] = []
  for (let directory = resolve(project); ; ) {
    ancestors.unshift(join(directory, '.codex/config.toml'))
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return [...new Set([join(root, 'config.toml'), ...ancestors])]
}
async function codexStore(project: string, signal: AbortSignal) {
  const root = resolve(process.env.CODEX_HOME?.trim() || join(homedir(), '.codex'))
  let store = 'file'
  for (const path of codexConfigPaths(root, project)) {
    const raw = await read(path, signal)
    if (!raw) continue
    for (const line of raw.split(/\r?\n/)) {
      if (!/^\s*cli_auth_credentials_store\s*=/.test(line)) continue
      const match = /^\s*cli_auth_credentials_store\s*=\s*["'](file|keyring|auto)["']\s*(?:#.*)?$/.exec(line)
      if (!match) throw new CliAccountBindingError('codex')
      store = match[1]!
    }
  }
  return { root, store }
}
const CODEX_ROUTE_ENV = [
  'CODEX_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'CODEX_BASE_URL',
  'CHATGPT_BASE_URL',
  'CODEX_PROFILE',
]
const CODEX_ROUTE_LINE =
  /^\s*(?:["']?(?:model_provider|model_providers|openai_base_url|chatgpt_base_url|profile)["']?\s*=|\[\[?\s*(?:profiles|model_providers)(?:\.|\]|\s))/
async function codexConfigs(root: string, project: string, signal: AbortSignal) {
  const configs: [string, string][] = []
  for (const path of codexConfigPaths(root, project)) {
    const raw = await read(path, signal)
    if (raw) configs.push([path, raw])
  }
  return configs
}
/**
 * Codex's own config sends it to another provider, address or profile (a relay).
 * Inherited route variables alone are not Codex's own setting.
 */
async function codexCustomRoute(root: string, project: string, signal: AbortSignal) {
  return (await codexConfigs(root, project, signal)).some(([, raw]) =>
    raw.split(/\r?\n/).some((line) => CODEX_ROUTE_LINE.test(line)),
  )
}
/**
 * A relay has no account the plugin can read, so its version is a digest of what
 * Codex reads for it: the config files, route variables, the `env_key` variables and
 * auth.json. Any change counts as an account change. Raw values never leave here.
 */
const codexEnvKeys = (configs: [string, string][]) =>
  configs.flatMap(([, raw]) =>
    [...raw.matchAll(/^\s*env_key\s*=\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/gm)].map((match) => match[1]!),
  )
async function codexRouteVersion(root: string, project: string, signal: AbortSignal) {
  const configs = await codexConfigs(root, project, signal)
  const keys = codexEnvKeys(configs)
  const auth = await read(join(root, 'auth.json'), signal)
  if (auth !== undefined && !object(JSON.parse(auth))) throw new CliAccountBindingError('codex')
  return hash(
    stable({
      configs: configs.map(([path, raw]) => [path, hash(raw)]),
      env: [...new Set([...CODEX_ROUTE_ENV, ...keys])]
        .sort()
        .map((name) => [name, text(process.env[name]) ? hash(process.env[name]!) : null]),
      auth: auth === undefined ? null : hash(auth),
    }),
  )
}
/** The version of Codex's custom route, or undefined when Codex uses its official account. */
export async function readCodexCustomRouteVersion(project: string, signal: AbortSignal) {
  const { root } = await codexStore(project, signal)
  return (await codexCustomRoute(root, project, signal)) ? codexRouteVersion(root, project, signal) : undefined
}
/**
 * Workers start from a scrubbed environment. A relay's `env_key` variables, named in
 * Codex's own config, are passed on when the Host has them; nothing else is added.
 */
export async function codexRouteEnvironment(project: string, signal: AbortSignal): Promise<Record<string, string>> {
  const { root } = await codexStore(project, signal)
  if (!(await codexCustomRoute(root, project, signal))) return {}
  const env: Record<string, string> = {}
  for (const name of codexEnvKeys(await codexConfigs(root, project, signal)))
    if (text(process.env[name])) env[name] = process.env[name]!
  return env
}
async function requireDefaultCodexRoute(root: string, project: string, signal: AbortSignal) {
  // These native overrides can route model/list and execution to another account.
  // Do not infer their endpoint/provider semantics from an unrelated auth.json.
  if (CODEX_ROUTE_ENV.some((name) => text(process.env[name])) || (await codexCustomRoute(root, project, signal)))
    throw new CliAccountBindingError('codex')
}
/** File-backed Codex auth only. Native keyring/auto cannot use a stale auth.json for model queries. */
export async function readCodexOwnAccountSource(project: string, signal: AbortSignal) {
  const { root, store } = await codexStore(project, signal)
  if (store !== 'file') throw new CliAccountBindingError('codex')
  await requireDefaultCodexRoute(root, project, signal)
  const auth = await document(join(root, 'auth.json'), signal)
  if (literal(auth.OPENAI_API_KEY) && auth.auth_mode !== 'chatgpt')
    return {
      provider: 'openai',
      credential: { type: 'api' as const, key: auth.OPENAI_API_KEY },
      sourceIds: [root],
      baseUrl: 'https://api.openai.com/v1',
      nativeRouteConfirmed: true as const,
    }
  if (object(auth.tokens) && (!auth.auth_mode || auth.auth_mode === 'chatgpt')) {
    const credential = {
      type: 'oauth' as const,
      ...auth.tokens,
      access: auth.tokens.access_token,
      refresh: auth.tokens.refresh_token,
      accountId: auth.tokens.account_id,
      expires:
        expiry(auth.tokens.expires ?? auth.tokens.expires_at) ?? expiry(claims(auth.tokens.access_token).exp),
    }
    if (oauthPrincipal(credential))
      return {
        provider: 'openai-codex',
        credential,
        sourceIds: [root],
        baseUrl: 'https://chatgpt.com/backend-api',
        nativeRouteConfirmed: true as const,
      }
  }
  throw new CliAccountBindingError('codex')
}

const knownPiEnv: Record<string, string> = {
  OPENAI_API_KEY: 'openai',
  ANTHROPIC_API_KEY: 'anthropic',
  GEMINI_API_KEY: 'google',
  XAI_API_KEY: 'xai',
  GROQ_API_KEY: 'groq',
  OPENROUTER_API_KEY: 'openrouter',
  MISTRAL_API_KEY: 'mistral',
  CEREBRAS_API_KEY: 'cerebras',
  ZAI_API_KEY: 'zai',
  ZHIPU_API_KEY: 'zhipu-coding-plan',
  ZAI_CODING_CN_API_KEY: 'zai-coding-cn',
}
function ownKey(value: unknown, env: Record<string, string>): string | undefined {
  if (!literal(value)) return
  return /^[A-Z][A-Z0-9_]*$/.test(value) ? (literal(env[value]) ? env[value] : undefined) : value
}

async function material(
  cli: CliId,
  backend: ProcessBackend,
  config: RuntimeConfig,
  project: string,
  signal: AbortSignal,
  selectedClaudeRoute?: ClaudeOwnRoute,
): Promise<BindingMaterial> {
  const home = homedir()
  if (cli === 'codebuddy') {
    const executable = await resolveCliExecutable(cli, backend, config, signal)
    return readCodebuddyAccountBindingMaterial(backend, config, executable, signal)
  }
  if (cli === 'traecn') {
    const path = join(process.env.TRAE_HOME ?? join(home, '.trae'), 'cli/auth.json')
    await safePiOmpAncestors(dirname(path))
    let handle: Awaited<ReturnType<typeof open>> | undefined, bytes: Buffer | undefined
    try {
      const entry = await lstat(path)
      if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1 || entry.size > 65536) throw new CliAccountBindingError(cli)
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      const before = await handle.stat()
      if (!before.isFile() || before.nlink !== 1 || before.size > 65536 || before.ino !== entry.ino || before.dev !== entry.dev)
        throw new CliAccountBindingError(cli)
      bytes = Buffer.alloc(before.size + 1)
      let offset = 0
      while (offset < bytes.length) {
        signal.throwIfAborted()
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
        if (!bytesRead) break
        offset += bytesRead
      }
      const after = await handle.stat(), current = await lstat(path)
      if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
        current.isSymbolicLink() || current.ino !== before.ino || current.dev !== before.dev || current.size !== before.size || current.mtimeMs !== before.mtimeMs)
        throw new CliAccountBindingError(cli)
      const auth = JSON.parse(bytes.subarray(0, offset).toString('utf8'))
      // Only stable identity fields are accessed. Never inspect credentials or device material.
      if (!object(auth) || !object(auth.trae) || !text(auth.trae.user_id)) throw new CliAccountBindingError(cli)
      const subject = { auth_mode: auth.auth_mode, user_id: auth.trae.user_id, region: auth.trae.region,
        login_method: auth.trae.login_method, credential_kind: auth.trae.credential_kind,
        api_base_url: auth.trae.endpoints?.api_base_url }
      if (Object.values(subject).some(value => value !== undefined && typeof value !== 'string')) throw new CliAccountBindingError(cli)
      const route = Object.fromEntries(['TRAECLI_PERSONAL_ACCESS_TOKEN', 'TRAECLI_HOST']
        .filter(name => process.env[name] !== undefined).map(name => [name, hash(process.env[name]!)]))
      return { sourceIds: [path], entries: [{ provider: 'trae', principal: { kind: 'trae', subjectHash: hash(stable(subject)) }, route }] }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new CliAccountBindingError(cli, 'TRAE CN 未登录')
      throw error
    } finally { bytes?.fill(0); await handle?.close() }
  }
  if ((cli === 'qoder' || cli === 'qodercn')) {
    const executable = await resolveCliExecutable(cli, backend, config, signal)
    return readQoderAccountBindingMaterial(executable, signal, { cli, backend, config, project })
  }
  if (cli === 'antigravity') {
    await assertAgyNativeAccountRoute(signal, home)
    if (process.platform === 'win32') {
      const account = await readWindowsAgyAccount(backend, config, signal)
      if (account.identity.state === 'unconfigured') throw new CliAccountBindingError(cli, AGY_SIGNED_OUT)
      // AGY 1.4.x credentials may carry only id_token_email; bind that local email instead.
      const principal =
        account.identity.state !== 'authenticated'
          ? undefined
          : account.principalHash
            ? { kind: 'oauth', subjectHash: account.principalHash }
            : account.identity.accountLabel
              ? { kind: 'oauth', email: account.identity.accountLabel.toLowerCase() }
              : undefined
      return {
        sourceIds: ['windows-credential:gemini:antigravity'],
        entries: principal ? [{ provider: 'antigravity', principal }] : [],
      }
    }
    const root = join(home, '.gemini')
    // The macOS keychain item holds the Linux file's JSON, but agy 1.4.7 writes it
    // with only `id_token_email`, so its principal is the email.
    const auth =
      process.platform === 'darwin'
        ? await readMacAgyCredential(backend, config, signal)
        : await document(join(root, 'jetski-standalone-oauth-token'), signal)
    if (!auth) throw new CliAccountBindingError(cli, AGY_SIGNED_OUT)
    const principal =
      auth.auth_method === 'consumer' && object(auth.token)
        ? oauthPrincipal({ ...auth.token, id_token: auth.id_token, email: accountEmail(auth.id_token_email) })
        : undefined
    return { sourceIds: [root], entries: principal ? [{ provider: 'antigravity', principal }] : [] }
  }
  if (cli === 'codex') {
    const { root, store } = await codexStore(project, signal)
    // A relay set in Codex's own config: Codex runs it as configured.
    if (await codexCustomRoute(root, project, signal))
      return {
        sourceIds: [root, ...(store === 'file' ? [] : [`native-store:${store}`])],
        entries: [
          {
            provider: 'codex-custom-route',
            principal: { kind: 'route', version: await codexRouteVersion(root, project, signal) },
          },
        ],
      }
    if (store !== 'file') {
      await requireDefaultCodexRoute(root, project, signal)
      const executable = await resolveCliExecutable(cli, backend, config, signal)
      const identity = await readCodexAccount(backend, config, executable, project, signal)
      if (
        identity?.state !== 'authenticated' ||
        identity.authMethod !== 'oauth' ||
        !text(identity.accountLabel)
      )
        throw new CliAccountBindingError(cli)
      return {
        sourceIds: [root, `native-store:${store}`],
        entries: [
          {
            provider: 'openai-codex',
            principal: { kind: 'oauth', email: identity.accountLabel.toLowerCase() },
          },
        ],
      }
    }
    const source = await readCodexOwnAccountSource(project, signal)
    const entry = credentialEntry(source.provider, source.credential)
    return { sourceIds: source.sourceIds, entries: entry ? [entry] : [] }
  }
  if (cli === 'claude' || cli === 'kimi' || cli === 'mimo') {
    const executable = await resolveCliExecutable(cli, backend, config, signal)
    if (cli === 'claude') {
      const route = selectedClaudeRoute ?? (await readClaudeOwnRoute(project, signal))
      if (route.kind === 'native') {
        const status = JSON.parse(
          await captureCatalogMetadata(
            backend,
            config,
            claudeRouteStatusArguments(executable, route),
            project,
            signal,
            claudeLaunchEnvironment(),
            [0, 1],
          ),
        )
        const identity = claudeRouteIdentity(route, JSON.stringify(status), status.loggedIn === true ? 0 : 1)
        if (identity.state === 'authenticated' && identity.accountLabel)
          return {
            sourceIds: [
              resolve(
                route.configDirectory || process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude'),
              ),
              'native:claude-auth-status',
            ],
            entries: [
              {
                provider: 'anthropic',
                route: { source: 'official-native-login' },
                principal: {
                  kind: 'oauth',
                  email: identity.accountLabel.toLowerCase(),
                  ...(text(status.orgId) ? { organization: status.orgId } : {}),
                },
              },
            ],
          }
        throw new ClaudeOwnRouteError('Claude 官方账号未登录，请使用原生登录')
      }
      {
        const source = route.source
        if (!source) throw new ClaudeOwnRouteError()
        const entry = credentialEntry(source.provider, source.credential, {
          baseUrl: source.baseUrl,
          apiType: source.apiType,
          anthropicAuth: source.anthropicAuth,
          modelEnvironment: source.modelEnvironment,
          model: source.model,
        })
        return { sourceIds: source.sourceIds, entries: entry ? [entry] : [] }
      }
    }
    const sources = await readFirstPartyModelSources(
      cli,
      executable,
      project,
      (argv, env) => captureCatalogMetadata(backend, config, argv, project, signal, env),
      signal,
    )
    return {
      sourceIds: sources.flatMap((source) => source.sourceIds),
      entries: sources.flatMap((source) => {
        const entry = credentialEntry(source.provider, source.credential, {
          baseUrl: source.baseUrl,
          apiType: source.apiType,
          anthropicAuth: source.anthropicAuth,
        })
        return entry ? [entry] : []
      }),
    }
  }
  if (cli === 'pi' || cli === 'omp') {
    const source = await readPiOmpAccountMaterial(cli, { accountRoot: config.stateDirectory, signal })
    if (source.configAuth.auth?.broker) throw new CliAccountBindingError(cli)
    const entries: BindingEntry[] = []
    for (const [provider, auth] of Object.entries(source.auth)) {
      if (!object(auth)) throw new CliAccountBindingError(cli)
      const resolved = ['api', 'api_key'].includes(auth.type)
        ? { ...auth, key: ownKey(auth.key ?? auth.apiKey, source.env), apiKey: undefined }
        : auth
      const entry = credentialEntry(provider, resolved)
      if (entry) entries.push(entry)
    }
    for (const row of source.credentials) {
      if (row.disabled_cause) continue
      const value = JSON.parse(row.data)
      const entry = credentialEntry(row.provider, {
        ...value,
        type: row.credential_type,
        ...(['api', 'api_key'].includes(row.credential_type)
          ? { key: ownKey(value.key ?? value.apiKey, source.env), apiKey: undefined }
          : {}),
      })
      if (entry) entries.push(entry)
    }
    for (const [provider, cfg] of Object.entries(source.models.providers ?? {}) as [string, any][]) {
      const key = ownKey(cfg.apiKey, source.env)
      if (key)
        entries.push(credentialEntry(provider, { type: 'api', key }, { baseUrl: cfg.baseUrl, api: cfg.api })!)
    }
    for (const [name, provider] of Object.entries(knownPiEnv))
      if (literal(source.env[name]))
        entries.push(credentialEntry(provider, { type: 'api', key: source.env[name] }, { env: name })!)
    return { sourceIds: source.sourceIds, entries }
  }
  if (cli === 'opencode') {
    const profile = await readOpenCodeProfile(openCodeAuthDirectory(config.stateDirectory), { signal })
    const entries: BindingEntry[] = []
    let hasOAuth = false
    for (const [provider, credential] of Object.entries(profile.auth)) {
      if (profile.disabled.includes(provider) || (profile.enabled && !profile.enabled.includes(provider)))
        continue
      if (credential.type === 'oauth') {
        hasOAuth = true
        continue
      }
      const entry = credentialEntry(provider, credential, {
        baseURL: profile.providers[provider]?.options?.baseURL,
        npm: profile.providers[provider]?.npm,
      })
      if (entry) entries.push(entry)
    }
    if (!entries.length && hasOAuth) throw new CliAccountBindingError(cli, OPENCODE_OAUTH_UNSUPPORTED)
    return { sourceIds: profile.sourceIds, entries }
  }
  if (cli === 'zcode') {
    const executable = await resolveCliExecutable(cli, backend, config, signal)
    const source = await readZCodeBindingMaterial(
      executable,
      zcodeAuthDirectory(config.zcodeAuthDirectory, config.stateDirectory),
      config.zcodeBuiltinConfig,
      { signal },
    )
    return {
      sourceIds: source.sourceIds,
      entries: source.credentials.map((entry) => ({
        provider: entry.provider,
        route: { baseUrl: entry.baseUrl, apiType: entry.apiType },
        principal:
          text(entry.identity) && !/^key-[a-f0-9]{24}$/.test(entry.identity)
            ? { kind: 'oauth', identity: entry.identity }
            : { kind: 'api', key: hash(entry.key) },
      })),
    }
  }
  if (cli === 'grok') {
    const root = join(home, '.grok'),
      auth = await document(join(root, 'auth.json'), signal)
    return {
      sourceIds: [root],
      entries: Object.entries(auth).flatMap(([provider, value]) => {
        if (!object(value) || value.auth_mode !== 'oidc') return []
        const principal = oauthPrincipal(value)
        return principal ? [{ provider, principal }] : []
      }),
    }
  }
  if (cli === 'hermes') {
    const root = effectiveHermesHome(config)
    await ensureHermesNousFresh({
      home: root,
      backend,
      signal,
      graceMs: config.graceMs,
      resolveExecutable: (control) => resolveCliExecutable(cli, backend, config, control),
    })
    const raw = await assertHermesOwnAccounts(root, signal)
    const provider = raw.config.model?.provider
    const source = {
      ...raw,
      auth: projectHermesUnsuppressedAuth(raw.auth),
      env: hermesUnsuppressedEnvironment(raw.auth, raw.env, provider),
    }
    const entries: BindingEntry[] = []
    if (provider === 'nous') {
      try {
        const nous = selectHermesNousSource(source)
        entries.push({ provider, principal: nous.principal, route: nous.route })
      } catch (error) {
        if (error instanceof HermesNousError) throw new CliAccountBindingError(cli, error.message)
        throw error
      }
    } else if (provider === 'openai-codex') {
      const state = source.auth.providers?.[provider]
      if (
        (source.auth.credential_pool?.[provider] ?? []).some((row: any) =>
          hermesPoolEntryUnavailable(row, source.config.model?.default),
        )
      )
        throw new CliAccountBindingError(cli)
      const entry =
        state?.auth_mode === 'chatgpt'
          ? credentialEntry(provider, { ...state.tokens, type: 'oauth' })
          : undefined
      if (entry) entries.push(entry)
    } else if (provider === 'openrouter') {
      for (const [name, key] of Object.entries(source.env))
        if (/^OPENROUTER_API_KEY(?:_\d+)?$/.test(name) && literal(key))
          entries.push(credentialEntry(provider, { type: 'api', key })!)
      for (const row of source.auth.credential_pool?.[provider] ?? []) {
        if (hermesPoolEntryUnavailable(row, source.config.model?.default))
          throw new CliAccountBindingError(cli)
        const key = row.source?.startsWith('env:')
          ? source.env[row.source.slice(4)]
          : row.runtime_api_key || row.access_token
        const entry = credentialEntry(provider, { type: 'api', key }, { baseUrl: row.base_url })
        if (!entry) throw new CliAccountBindingError(cli)
        entries.push(entry)
      }
    }
    return {
      sourceIds: source.sourceIds,
      entries: entries.map((entry) => ({
        ...entry,
        route: { ...(object(entry.route) && entry.route), baseUrl: source.config.model?.base_url },
      })),
    }
  }
  return { sourceIds: [], entries: [] }
}

/** Host-only account epoch. Never return it from a Gateway response or write credentials to storage. */
export async function readCliAccountBinding(
  cli: CliId,
  backend: ProcessBackend,
  config: RuntimeConfig,
  project: string,
  signal: AbortSignal,
  selectedClaudeRoute?: ClaudeOwnRoute,
): Promise<string> {
  signal.throwIfAborted()
  try {
    if (isWorkBuddyCli(cli)) {
      const executable = await resolveCliExecutable(cli, backend, config, signal)
      return (await readWorkBuddyMetadata(cli, executable, project, signal)).binding
    }
    const value = await material(cli, backend, config, project, signal, selectedClaudeRoute)
    signal.throwIfAborted()
    if (!value.entries.length || !value.sourceIds.length) throw new CliAccountBindingError(cli)
    const sources = [
      ...new Set(value.sourceIds.map((path) => (isAbsolute(path) ? resolve(path) : path))),
    ].sort()
    const entries = [...new Set(value.entries.map(stable))].sort()
    return `cli-account-v1:${hash(stable({ cli, sources, entries }))}`
  } catch (error) {
    if (error instanceof ProcessCleanupUnconfirmedError) throw error
    signal.throwIfAborted()
    if (
      error instanceof CliAccountBindingError ||
      error instanceof KimiOAuthModelError ||
      error instanceof ClaudeOwnRouteError ||
      error instanceof HermesRenewalError
      || error instanceof QoderAccountError
      || error instanceof CodebuddyAccountError
    )
      throw error
    if (isWorkBuddyCli(cli)) throw error
    // Keep the binding contract (CLI_OWN_ACCOUNT_REQUIRED) with the actionable reason.
    if (error instanceof HermesAccountSourceError) throw new CliAccountBindingError(cli, error.message)
    throw new CliAccountBindingError(cli)
  }
}
