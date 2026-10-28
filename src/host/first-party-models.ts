import {
  readClaudeOwnRoute,
  claudeRouteIdentity,
  ClaudeOwnRouteError,
  prepareClaudeWorkerLaunch,
  claudeRemoteModelId,
  claudeLaunchEnvironment,
} from './claude-own-route.ts'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, win32 } from 'node:path'
import { safePiOmpAncestors } from './pi-omp-native.ts'
import { EFFORTS, type ModelChoice } from '../shared/types.ts'
import { probeAccountModels, type AccountModelInput } from './account-models.mjs'
import { parseNativeJsonc } from './opencode-native.ts'
import {
  mimoMetadataCache,
  mimoMetadataKey,
  nativeMetadataKey,
  type MimoOwnSnapshot,
} from './mimo-metadata-cache.ts'
import { metadataFileFingerprint, NativeCapabilityCache } from './native-capability-cache.ts'
import { readKimiOAuthModelSources, probeKimiOAuthModels } from './kimi-oauth-models.ts'
import { readKimiOwnToken } from './kimi-accounts.ts'
import { ProcessCleanupUnconfirmedError } from './process.ts'
import {
  assertMimoConfiguration,
  mimoConfigurationFiles,
  mimoConfigurationPaths,
  MimoConfigurationError,
} from './mimo-configuration.ts'
export { MimoConfigurationError } from './mimo-configuration.ts'

type Capture = (argv: string[], env?: Record<string, string>) => Promise<string>
const claudeHelpCapabilities = new NativeCapabilityCache<true>()
const kimiOAuthCapabilities = new NativeCapabilityCache<Record<string, unknown>>()
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const literal = (v: unknown): v is string =>
  typeof v === 'string' && !!v.trim() && !/[\s\x00-\x1f{}$]/.test(v) && !v.startsWith('!')
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(v)
const authHeaders = (v: unknown) =>
  record(v) &&
  Object.keys(v).some((k) => /authorization|api[-_]?key|token|cookie|organization|project/i.test(k))

function parseMetadata(value: string): Record<string, any> {
  try {
    const parsed: unknown = JSON.parse(value)
    if (record(parsed)) return parsed
  } catch {}
  throw new Error('CLI 配置格式无效，请检查配置')
}

/** Private material only. Never return this structure through Gateway or persist it. */
export interface FirstPartyModelSource extends AccountModelInput {
  sourceIds: string[]
  claudeRoute?: 'proxy' | 'api'
  nativeFullModelIds?: boolean
  /** Claude-only explicit native route declarations, never account entitlement evidence. */
  claudeConfiguredModels?: boolean
  modelEnvironment?: Record<string, string>
  model?: string
  nativeModels: { remoteId: string; choice: ModelChoice }[]
}
export async function readFirstPartyJson(path: string): Promise<Record<string, any>> {
  let file, bytes: Buffer | undefined
  try {
    await safePiOmpAncestors(dirname(path))
    const entry = await lstat(path)
    if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1) throw new Error('账号配置文件不可用')
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = await file.stat()
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.dev !== entry.dev ||
      stat.ino !== entry.ino ||
      stat.size > 1_048_576
    )
      throw new Error('账号配置文件不可用')
    bytes = Buffer.alloc(stat.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    const after = await file.stat()
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
      throw new Error('账号配置读取期间发生变化')
    try {
      const raw = bytes.subarray(0, stat.size).toString('utf8')
      const value: unknown = path.endsWith('.jsonc') ? parseNativeJsonc(raw) : JSON.parse(raw)
      return record(value) ? value : {}
    } finally {
      bytes.fill(0)
    }
  } catch (error: any) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return {}
    throw new Error('账号配置文件不可用')
  } finally {
    bytes?.fill(0)
    await file?.close()
  }
}

/** Current Claude native managed-file location; Windows no longer reads ProgramData. */
export function claudeManagedSettingsPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) {
  return platform === 'darwin'
    ? '/Library/Application Support/ClaudeCode/managed-settings.json'
    : platform === 'win32'
      ? win32.join(
          env.ProgramFiles || env.PROGRAMFILES || 'C:\\Program Files',
          'ClaudeCode',
          'managed-settings.json',
        )
      : '/etc/claude-code/managed-settings.json'
}

/** Disable inherited SDK credentials and cross-CLI plugin/session imports in native MiMo. */
export function firstPartyEnvironment(cli: string): Record<string, string> {
  if (cli !== 'mimo') return {}
  return {
    // mimocode 0.1.15 otherwise copies ~/.claude/projects transcripts into its DB on every start.
    MIMOCODE_DISABLE_CLAUDE_IMPORT: '1',
    MIMOCODE_DISABLE_PROVIDER_ENV: '1',
    MIMOCODE_DISABLE_DEFAULT_PLUGINS: '1',
    MIMOCODE_PURE: '1',
    MIMOCODE_DISABLE_MODELS_FETCH: '1',
    MIMOCODE_AUTH_CONTENT: '',
    MIMOCODE_CONFIG: '',
    MIMOCODE_CONFIG_CONTENT: '',
    MIMOCODE_CONFIG_DEFAULTS: '',
    MIMOCODE_CONFIG_DIR: '',
    MIMOCODE_TEST_MANAGED_CONFIG_DIR: '',
    MIMOCODE_DB: '',
    MIMOCODE_DISABLE_CLAUDE_CODE_MCP: '1',
    MIMOCODE_DISABLE_CLAUDE_CODE_COMMANDS: '1',
  }
}

export async function assertFirstPartyConfiguration(
  cli: string,
  project: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  if (cli === 'mimo') await assertMimoConfiguration(project, signal)
}

export function parseKimiModelSources(raw: unknown, sourceId: string): FirstPartyModelSource[] {
  if (!record(raw) || !record(raw.providers) || !record(raw.models)) return []
  const sources: FirstPartyModelSource[] = []
  for (const [alias, model] of Object.entries(raw.models)) {
    if (!id(alias) || !record(model) || !id(model.model) || typeof model.provider !== 'string') continue
    const provider = raw.providers[model.provider]
    if (
      !record(provider) ||
      provider.oauth ||
      model.oauth ||
      model.providerId ||
      model.apiKey ||
      model.baseUrl
    )
      continue
    const key =
      typeof provider.apiKey === 'string' && provider.apiKey.length
        ? provider.apiKey
        : provider.env?.KIMI_API_KEY
    const protocol = model.protocol ?? provider.protocol ?? provider.type
    if (
      !literal(key) ||
      !literal(provider.baseUrl) ||
      !['openai', 'openai_responses', 'anthropic', 'kimi'].includes(protocol)
    )
      continue
    if (authHeaders(provider.customHeaders) || authHeaders(model.customHeaders)) continue
    sources.push({
      provider: model.provider,
      credential: { type: 'api', key },
      baseUrl: provider.baseUrl,
      apiType:
        provider.type !== 'kimi' && protocol === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
      sourceIds: [sourceId, `provider:${model.provider}`],
      nativeModels: [
        {
          remoteId: model.model,
          choice: {
            id: alias,
            label: typeof model.displayName === 'string' ? model.displayName : alias,
            efforts: ['default'],
          },
        },
      ],
    })
  }
  return sources
}

/** MiMo's verbose records are capability metadata, not an account allow-list. */
export function parseMimoModelRecords(output: string): Record<string, any>[] {
  const records: Record<string, any>[] = []
  let route = '',
    pending = ''
  for (const line of output.split(/\r?\n/)) {
    if (!pending && !route && !line.trim()) continue
    if (!pending && !route) {
      // Native models emits a human-readable context-window suffix before its JSON.
      // Accept that verified header shape, then bind the ID to the JSON below.
      const header = line
        .trim()
        .match(
          /^(\S+)(?: — window [\d.,]+[A-Za-z]*(?:, budget [\d.,]+[A-Za-z]*)?, compacts at [\d.,]+[A-Za-z]*)?$/,
        )
      if (!header || !id(header[1]) || !header[1]!.includes('/')) throw new Error('MiMo 模型目录格式无效')
      route = header[1]!
      continue
    }
    pending += line + '\n'
    let value: unknown
    try {
      value = JSON.parse(pending)
    } catch {
      continue
    }
    if (!record(value) || `${value.providerID}/${value.id}` !== route) throw new Error('MiMo 模型身份不匹配')
    records.push(value)
    route = ''
    pending = ''
  }
  if (route || pending) throw new Error('MiMo 模型目录不完整')
  return records
}
export function mimoModelSources(
  raw: Record<string, any>[],
  config: Record<string, any>,
  auth: Record<string, any>,
  sourceId: string,
  ownInline: Record<string, { key: string; sourceId: string }> = {},
): FirstPartyModelSource[] {
  const sources: FirstPartyModelSource[] = []
  for (const model of raw) {
    const provider = model.providerID,
      options = config.provider?.[provider]?.options ?? {},
      inline = ownInline[provider],
      credential =
        options.apiKey === undefined
          ? auth[provider]
          : inline?.key === options.apiKey
            ? { type: 'api', key: inline.key }
            : undefined
    if (
      !id(provider) ||
      !id(model.id) ||
      !record(credential) ||
      credential.type !== 'api' ||
      !literal(credential.key)
    )
      continue
    if (
      config.disabled_providers?.includes(provider) ||
      (Array.isArray(config.enabled_providers) && !config.enabled_providers.includes(provider))
    )
      continue
    // Resolved keys must also occur literally in this CLI's own config; expanded foreign refs are rejected.
    if (authHeaders(options.headers) || authHeaders(model.headers)) continue
    const api = model.api
    if (
      !record(api) ||
      !id(api.id) ||
      !['@ai-sdk/openai', '@ai-sdk/openai-compatible', '@ai-sdk/anthropic'].includes(api.npm)
    )
      continue
    // MiMo's built-in Xiaomi login plugin loads its own ApiAuth metadata first;
    // explicit provider options are then merged last by the native resolver.
    const loginBase =
      provider === 'xiaomi' && auth[provider]?.type === 'api' ? auth[provider].metadata?.base_url : undefined
    const baseUrl = options.baseURL ?? loginBase ?? api.url
    if (!literal(baseUrl)) continue
    sources.push({
      provider,
      credential: { type: 'api', key: credential.key },
      baseUrl,
      apiType: api.npm === '@ai-sdk/anthropic' ? 'anthropic-messages' : 'openai-completions',
      sourceIds: [options.apiKey === undefined ? sourceId : inline!.sourceId, `provider:${provider}`],
      nativeModels: [
        {
          remoteId: api.id,
          choice: {
            id: `${provider}/${model.id}`,
            label: typeof model.name === 'string' ? model.name : `${provider}/${model.id}`,
            efforts: [
              'default',
              ...EFFORTS.filter(
                (e) => e !== 'default' && record(model.variants?.[e]) && model.variants[e].disabled !== true,
              ),
            ],
          },
        },
      ],
    })
  }
  return sources
}

export async function readFirstPartyModelSources(
  cli: 'kimi' | 'claude' | 'mimo',
  executable: string,
  project: string,
  capture: Capture,
  signal: AbortSignal,
): Promise<FirstPartyModelSource[]> {
  await assertFirstPartyConfiguration(cli, project, signal)
  if (cli === 'kimi') {
    if (
      ['KIMI_CODE_BASE_URL', 'KIMI_CODE_OAUTH_HOST', 'KIMI_OAUTH_HOST', 'KIMI_CODE_CUSTOM_HEADERS'].some(
        (key) => process.env[key],
      )
    )
      return []
    const sourceId = join(process.env.KIMI_CODE_HOME ?? join(homedir(), '.kimi-code'), 'config.toml')
    const keyFor = async () => {
      const fingerprints = await Promise.all([
        metadataFileFingerprint(sourceId, signal),
        metadataFileFingerprint(join(dirname(sourceId), 'credentials/kimi-code.json'), signal),
      ])
      return fingerprints.some((value) => value === undefined)
        ? undefined
        : nativeMetadataKey(executable, project, { cli, sourceId, fingerprints }, signal)
    }
    const key = await keyFor(),
      cached = kimiOAuthCapabilities.get(key)
    if (cached) return readKimiOAuthModelSources(cached, sourceId, signal)
    const raw = parseMetadata(await capture([executable, 'provider', 'list', '--json']))
    signal.throwIfAborted()
    const sources = [
      ...parseKimiModelSources(raw, sourceId),
      ...(await readKimiOAuthModelSources(raw, sourceId, signal)),
    ]
    // Only the proven managed OAuth schema can be rehydrated from a current own
    // token. API providers remain uncached: their native resolver may derive keys.
    if (sources.length === 1 && sources[0]!.apiType === 'kimi-managed-oauth') {
      const source = sources[0]!
      const metadata = {
        providers: {
          'managed:kimi-code': {
            type: 'kimi',
            baseUrl: source.baseUrl,
            oauth: { storage: 'file', key: 'oauth/kimi-code' },
          },
        },
        models: Object.fromEntries(
          source.nativeModels.map(({ remoteId, choice }) => [
            choice.id,
            { provider: 'managed:kimi-code', model: remoteId, displayName: choice.label },
          ]),
        ),
      }
      // Neither tokens nor arbitrary provider fields enter the capability cache.
      const serialized = JSON.stringify(metadata)
      const token = await readKimiOwnToken(join(dirname(sourceId), 'credentials'), 'kimi-code', signal)
      const configFingerprint = await keyFor()
      if (
        source.credential.type === 'oauth' &&
        token?.access_token === source.credential.access &&
        ![token?.access_token, token?.refresh_token].some(
          (value) => typeof value === 'string' && value && serialized.includes(value),
        ) &&
        key === configFingerprint
      )
        kimiOAuthCapabilities.set(key, metadata)
    }
    signal.throwIfAborted()
    return sources
  }
  if (cli === 'mimo') {
    const env = firstPartyEnvironment(cli)
    const expected = mimoConfigurationPaths()
    const own: MimoOwnSnapshot = {
      authPath: join(expected.data, 'auth.json'),
      auth: await readFirstPartyJson(join(expected.data, 'auth.json')),
      configurations: [],
    }
    // Read current own material before every reuse, including logout/account or route changes.
    // The cache stores neither credentials nor raw native config output.
    for (const path of await mimoConfigurationFiles(project)) {
      own.configurations.push({ path, value: await readFirstPartyJson(path) })
      signal.throwIfAborted()
    }
    const key = await mimoMetadataKey(executable, project, own, signal)
    const cached = mimoMetadataCache.get(key, own)
    if (cached) return cached
    const paths = await capture([executable, 'debug', 'paths'], env)
    signal.throwIfAborted()
    const data = paths.match(/^data\s+(.+)$/m)?.[1]?.trim()
    if (!data || !isAbsolute(data) || dirname(data) === data) return []
    if (data !== expected.data || paths.match(/^config\s+(.+)$/m)?.[1]?.trim() !== expected.config)
      throw new MimoConfigurationError('MiMo 配置来源无法确认，请检查配置')
    const authPath = join(data, 'auth.json'),
      auth = await readFirstPartyJson(authPath)
    signal.throwIfAborted()
    await assertFirstPartyConfiguration(cli, project, signal)
    const config = parseMetadata(await capture([executable, 'debug', 'config'], env))
    signal.throwIfAborted()
    const inline: Record<string, { key: string; sourceId: string }> = {}
    for (const path of await mimoConfigurationFiles(project)) {
      const raw = await readFirstPartyJson(path)
      signal.throwIfAborted()
      if (!record(raw.provider)) continue
      for (const [provider, value] of Object.entries(raw.provider)) {
        const key = record(value) ? value.options?.apiKey : undefined
        if (literal(key) && key === config.provider?.[provider]?.options?.apiKey)
          inline[provider] = { key, sourceId: path }
      }
    }
    if (
      !Object.values(auth).some((value) => record(value) && value.type === 'api' && literal(value.key)) &&
      !Object.keys(inline).length
    )
      return []
    await assertFirstPartyConfiguration(cli, project, signal)
    const native = parseMimoModelRecords(await capture([executable, 'models', '--verbose'], env))
    signal.throwIfAborted()
    const sources = mimoModelSources(native, config, auth, authPath, inline)
    // If native discovery overlapped a configuration write, keep the normal result but do
    // not publish it under the older snapshot. Authorization still compares fresh bindings.
    const after: MimoOwnSnapshot = {
      authPath,
      auth: await readFirstPartyJson(authPath),
      configurations: [],
    }
    for (const path of await mimoConfigurationFiles(project)) {
      after.configurations.push({ path, value: await readFirstPartyJson(path) })
      signal.throwIfAborted()
    }
    if (key === (await mimoMetadataKey(executable, project, after, signal)))
      mimoMetadataCache.set(key, sources, after)
    signal.throwIfAborted()
    return sources
  }
  let route
  try {
    route = await readClaudeOwnRoute(project, signal)
  } catch (error) {
    if (error instanceof ClaudeOwnRouteError) return []
    throw error
  }
  if (route.kind === 'native' || !route.source) return []
  const launch = await prepareClaudeWorkerLaunch(
    route,
    [executable, 'auth', 'status', '--json'],
    join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'cliworker-now'),
    signal,
  )
  let raw: string
  try {
    raw = await capture(launch.argv, launch.env)
  } catch (error) {
    if (!(error instanceof ProcessCleanupUnconfirmedError) && 'cleanup' in launch) await launch.cleanup?.()
    throw error
  }
  if ('cleanup' in launch) await launch.cleanup?.()
  signal.throwIfAborted()
  try {
    claudeRouteIdentity(route, raw, 0)
  } catch (error) {
    if (error instanceof ClaudeOwnRouteError) return []
    throw error
  }
  const keyFor = async () => {
    const fingerprints = await Promise.all(
      route.sourceIds.map((path) => metadataFileFingerprint(path, signal)),
    )
    return fingerprints.some((value) => value === undefined)
      ? undefined
      : nativeMetadataKey(executable, project, { cli, source: route.source, fingerprints }, signal)
  }
  const key = await keyFor()
  if (!claudeHelpCapabilities.get(key)) {
    const help = await capture([executable, '--help'], claudeLaunchEnvironment())
    signal.throwIfAborted()
    if (!help.includes('--model') || !help.includes('--output-format') || !help.includes('--settings'))
      throw new Error('Claude 版本不支持原生来源参数，请升级')
    if (key === (await keyFor())) claudeHelpCapabilities.set(key, true)
  }
  signal.throwIfAborted()
  return [route.source]
}

export async function discoverFirstPartySources(
  sources: FirstPartyModelSource[],
  signal: AbortSignal,
  options: Parameters<typeof probeAccountModels>[1] = {},
): Promise<ModelChoice[]> {
  const models = new Map<string, ModelChoice>(),
    scopes = new Map<string, Awaited<ReturnType<typeof probeAccountModels>>>()
  for (const source of sources) {
    signal.throwIfAborted()
    const route = JSON.stringify([
      source.provider,
      source.baseUrl,
      source.apiType,
      source.anthropicAuth,
      source.credential,
    ])
    let scope = scopes.get(route)
    if (!scope) {
      scope =
        source.apiType === 'kimi-managed-oauth'
          ? await probeKimiOAuthModels(source, { ...options, signal })
          : await probeAccountModels(source, { ...options, signal })
      scopes.set(route, scope)
    }
    signal.throwIfAborted()
    if (scope.state !== 'supported') {
      if (source.claudeConfiguredModels && scope.catalogUnavailable) {
        for (const { choice } of source.nativeModels) models.set(choice.id, { ...choice, cost: 'unknown' })
        continue
      }
      if (source.claudeRoute)
        throw new ClaudeOwnRouteError(
          scope.state === 'denied'
            ? source.claudeRoute === 'proxy'
              ? 'Claude 本地代理认证失败，请检查代理配置'
              : 'Claude 路由认证失败，请检查配置'
            : source.claudeRoute === 'proxy'
              ? 'Claude 本地代理模型目录无法确认，请检查代理服务'
              : 'Claude 路由模型目录无法确认，请检查服务',
        )
      continue
    }
    // CC Switch's Claude discovery endpoint lists Stack entries, not its role mappings.
    // A successful empty auxiliary list must not erase explicit local proxy choices.
    // Filtering denied entries to an empty list does not establish catalogEmpty.
    if (source.claudeRoute === 'proxy' && source.claudeConfiguredModels && scope.catalogEmpty) {
      for (const { choice } of source.nativeModels) models.set(choice.id, { ...choice, cost: 'unknown' })
      continue
    }
    const nativeModels = source.nativeFullModelIds
      ? scope.models
          .filter(
            (model) =>
              id(source.claudeRoute ? claudeRemoteModelId(model.id) : model.id) &&
              !['sonnet', 'opus', 'haiku', 'fable'].includes(model.id),
          )
          .map((model) => ({
            remoteId: model.id,
            choice: {
              id: model.id,
              label: model.name ?? model.id,
              efforts: ['default'] as ModelChoice['efforts'],
            },
          }))
      : source.nativeModels
    const candidates = source.claudeConfiguredModels
      ? [...source.nativeModels, ...nativeModels]
      : nativeModels
    for (const { remoteId, choice } of candidates) {
      const available = scope.models.find(
        (model) =>
          model.id === remoteId ||
          (source.claudeConfiguredModels && model.id === claudeRemoteModelId(remoteId)),
      )
      if (available) models.set(choice.id, { ...choice, cost: available.cost })
    }
  }
  return [...models.values()]
}
