import { createConnection } from 'node:net'
import { claudeConfigDirectory } from './first-party-account-paths.ts'
import { homedir } from 'node:os'
import { join, isAbsolute, resolve } from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { safePiOmpAncestors } from './pi-omp-native.ts'
import { accountEmail, type AccountIdentity } from './account-identity.ts'
import {
  readFirstPartyJson,
  claudeManagedSettingsPath,
  type FirstPartyModelSource,
} from './first-party-models.ts'

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const literal = (v: unknown): v is string =>
  typeof v === 'string' && !!v.trim() && !/[\s\x00-\x1f{}$]/.test(v) && !v.startsWith('!')
const authOption =
  /ANTHROPIC|CLAUDE_CODE_(?:OAUTH|USE_|API|SKIP_(?:BEDROCK|VERTEX|FOUNDRY|AWS)_AUTH|PROVIDER_MANAGED_BY_HOST|GATEWAY)|AWS_|GOOGLE_|CLOUD_ML|API_KEY|BEARER_TOKEN/i
const allowed = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'])
const families = ['HAIKU', 'SONNET', 'OPUS', 'FABLE'] as const
const modelOption =
  /^(?:ANTHROPIC_(?:MODEL|DEFAULT_MODEL|SMALL_FAST_MODEL|(?:DEFAULT_(?:HAIKU|SONNET|OPUS|FABLE)_MODEL|CUSTOM_MODEL_OPTION)(?:_NAME|_DESCRIPTION|_SUPPORTED_CAPABILITIES)?)|CLAUDE_CODE_SUBAGENT_MODEL(?:_FORCE)?)$/
const claudeEnvironment =
  /^(?:ANTHROPIC_|CLAUDE_CODE_(?:OAUTH|USE_|API|SKIP_(?:BEDROCK|VERTEX|FOUNDRY|AWS)_AUTH|SUBAGENT_MODEL|MODEL|PROVIDER_MANAGED_BY_HOST|GATEWAY))/i
const officialBase = 'https://api.anthropic.com'
const homeOption = /^(?:CLAUDE_CONFIG_DIR|HOME|USERPROFILE|XDG_CONFIG_HOME)$/i
const modelKeys = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_CUSTOM_MODEL_OPTION',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL_FORCE',
  ...families.flatMap((family) =>
    ['', '_NAME', '_DESCRIPTION', '_SUPPORTED_CAPABILITIES'].map(
      (suffix) => `ANTHROPIC_DEFAULT_${family}_MODEL${suffix}`,
    ),
  ),
  ...['_NAME', '_DESCRIPTION', '_SUPPORTED_CAPABILITIES'].map(
    (suffix) => `ANTHROPIC_CUSTOM_MODEL_OPTION${suffix}`,
  ),
]
const routeEnvironment = {
  CLAUDE_CODE_USE_BEDROCK: '',
  CLAUDE_CODE_USE_VERTEX: '',
  CLAUDE_CODE_USE_FOUNDRY: '',
  CLAUDE_CODE_USE_AWS: '',
  CLAUDE_CODE_OAUTH_TOKEN: '',
  CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '',
  CLAUDE_CODE_SKIP_BEDROCK_AUTH: '',
  CLAUDE_CODE_SKIP_VERTEX_AUTH: '',
  CLAUDE_CODE_SKIP_FOUNDRY_AUTH: '',
  CLAUDE_CODE_SKIP_AWS_AUTH: '',
  ANTHROPIC_AUTH_TOKEN: '',
  ANTHROPIC_API_KEY: '',
  ANTHROPIC_CUSTOM_HEADERS: '',
}

/** Only this Claude child is changed; inherited credentials are never account evidence. */
export function claudeLaunchEnvironment(): Record<string, string> {
  return {
    ...routeEnvironment,
    ...Object.fromEntries(modelKeys.map((key) => [key, ''])),
    ANTHROPIC_BASE_URL: '',
    ...Object.fromEntries(
      Object.keys(process.env)
        .filter((key) => claudeEnvironment.test(key))
        .map((key) => [key, '']),
    ),
  }
}

export function claudeRemoteModelId(value: string): string {
  return value.replace(/\[1m\]$/i, '')
}

/** Exact settings IDs only. Labels and capability metadata never invent a model. */
export function claudeConfiguredModels(
  env: Record<string, unknown>,
  settingsModel?: unknown,
): FirstPartyModelSource['nativeModels'] {
  const secrets = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']
    .map((key) => env[key])
    .filter((value): value is string => typeof value === 'string' && !!value)
  const safe = (value: unknown, maximum: number) =>
    typeof value === 'string' &&
    value.length <= maximum &&
    !/[\x00-\x1f]/.test(value) &&
    !secrets.some((secret) => value === secret || (secret.length >= 12 && value.includes(secret)))
  const valid = (value: unknown): value is string =>
    safe(value, 1024) &&
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:/@-]*(?:\[1m\])?$/i.test(value) &&
    !/^(?:sk-|Bearer|oauth[_-]|PROXY_MANAGED$)/i.test(value)
  const models = new Map<string, FirstPartyModelSource['nativeModels'][number]>()
  const add = (value: unknown, name?: unknown) => {
    if (!valid(value)) return
    const base = claudeRemoteModelId(value),
      alias = base.toLowerCase()
    if (['default', 'best', 'opusplan'].includes(alias)) return
    if (families.some((family) => family.toLowerCase() === alias)) {
      const mapped = env[`ANTHROPIC_DEFAULT_${alias.toUpperCase()}_MODEL`]
      if (
        !valid(mapped) ||
        families.some((family) => family.toLowerCase() === claudeRemoteModelId(mapped).toLowerCase())
      )
        return
      const id = /\[1m\]$/i.test(value) && !/\[1m\]$/i.test(mapped) ? `${mapped}${value.slice(-4)}` : mapped
      add(id, env[`ANTHROPIC_DEFAULT_${alias.toUpperCase()}_MODEL_NAME`])
      return
    }
    if (models.has(value)) return
    models.set(value, {
      remoteId: claudeRemoteModelId(value),
      choice: {
        id: value,
        label: safe(name, 4096) && typeof name === 'string' && name.trim() ? name : value,
        efforts: ['default'],
      },
    })
  }
  for (const family of families)
    add(env[`ANTHROPIC_DEFAULT_${family}_MODEL`], env[`ANTHROPIC_DEFAULT_${family}_MODEL_NAME`])
  add(env.ANTHROPIC_CUSTOM_MODEL_OPTION, env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME)
  add(env.ANTHROPIC_MODEL)
  add(env.ANTHROPIC_DEFAULT_MODEL)
  add(settingsModel)
  return [...models.values()]
}

/** Public errors never interpolate native configuration or credentials. */
export class ClaudeOwnRouteError extends Error {
  readonly code = 'CLI_OWN_ACCOUNT_REQUIRED'
  constructor(message = 'Claude 账号来源无法确认，请检查该 CLI 的配置') {
    super(message)
    this.name = 'ClaudeOwnRouteError'
  }
}
export interface ClaudeOwnRoute {
  kind: 'native' | 'proxy' | 'api'
  sourceIds: string[]
  configDirectory?: string
  /** Host-only current model configuration; included in admission and launch snapshots. */
  modelEnvironment?: Record<string, string>
  model?: string
  /** Field names only, with empty values; native operations suppress own route overrides. */
  suppressedEnvironment?: Record<string, string>
  /** Host-only; never project this material to Gateway. */
  source?: FirstPartyModelSource
}

/** Verified on native 2.1.296: empty settings.env unsets provider selectors for this process. */
export function claudeNativeSettingsArguments(
  configDirectory?: string,
  suppressedEnvironment: Record<string, string> = {},
): string[] {
  return [
    '--settings',
    JSON.stringify({
      apiKeyHelper: '',
      model: 'default',
      env: {
        ...claudeLaunchEnvironment(),
        ...suppressedEnvironment,
        ...(configDirectory ? { CLAUDE_CONFIG_DIR: configDirectory } : {}),
        ANTHROPIC_BASE_URL: officialBase,
      },
    }),
  ]
}

/** TCP only: a listening proxy remains selected even if its HTTP authentication fails. */
export async function claudeLoopbackAvailable(url: URL, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const socket = createConnection({
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    })
    let settled = false
    const done = (value?: boolean, error?: unknown) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      socket.destroy()
      error !== undefined ? reject(error) : resolve(value!)
    }
    const abort = () => done(undefined, signal.reason ?? new Error('查询已取消'))
    signal.addEventListener('abort', abort, { once: true })
    socket.once('connect', () => done(true))
    socket.setTimeout(1200, () => done(false))
    socket.once('error', (error: NodeJS.ErrnoException) => {
      if (['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(error.code ?? '')) done(false)
      else done(undefined, new ClaudeOwnRouteError('Claude 本地代理连接状态无法确认，请检查代理'))
    })
    if (signal.aborted) abort()
  })
}

async function readClaudeSettings(project: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const root = claudeConfigDirectory()
  if (!isAbsolute(root)) throw new ClaudeOwnRouteError('Claude 账号目录必须使用绝对路径')
  const paths = [
    join(root, 'settings.json'),
    join(project, '.claude/settings.json'),
    join(project, '.claude/settings.local.json'),
  ]
  const configured: Record<string, any> = Object.create(null),
    env: Record<string, any> = Object.create(null)
  for (const path of paths) {
    const settings = await readFirstPartyJson(path)
    signal.throwIfAborted()
    Object.assign(configured, settings)
    if (record(settings.env)) Object.assign(env, settings.env)
  }
  const managed = await readFirstPartyJson(claudeManagedSettingsPath())
  signal.throwIfAborted()
  if (
    managed.apiKeyHelper ||
    managed.forceLoginMethod ||
    managed.forceLoginOrgUUID ||
    managed.forceLoginGatewayUrl ||
    (record(managed.env) &&
      Object.entries(managed.env).some(
        ([key, value]) => value && (authOption.test(key) || homeOption.test(key)),
      ))
  )
    throw new ClaudeOwnRouteError()
  if (Object.entries(env).some(([key, value]) => value && homeOption.test(key)))
    throw new ClaudeOwnRouteError()
  const suppressedEnvironment = Object.fromEntries(
    Object.keys(env)
      .filter((key) => claudeEnvironment.test(key))
      .map((key) => [key, '']),
  )
  return { root, paths, configured, env, suppressedEnvironment }
}

/** Official account operations never probe or require an API/proxy route. */
export async function readClaudeOfficialAccountRoute(
  project: string,
  signal: AbortSignal,
): Promise<ClaudeOwnRoute> {
  const { root, suppressedEnvironment } = await readClaudeSettings(project, signal)
  return {
    kind: 'native',
    configDirectory: root,
    sourceIds: [root, 'native:claude-official-login'],
    suppressedEnvironment,
  }
}

export async function readClaudeOwnRoute(
  project: string,
  signal: AbortSignal,
  options: { available?: typeof claudeLoopbackAvailable } = {},
): Promise<ClaudeOwnRoute> {
  const { root, paths, configured, env, suppressedEnvironment } = await readClaudeSettings(project, signal)
  if (configured.apiKeyHelper) throw new ClaudeOwnRouteError()
  if (
    Object.entries(env).some(
      ([key, value]) =>
        value &&
        (homeOption.test(key) || (authOption.test(key) && !allowed.has(key) && !modelOption.test(key))),
    )
  )
    throw new ClaudeOwnRouteError()
  const key = env.ANTHROPIC_API_KEY,
    bearer = env.ANTHROPIC_AUTH_TOKEN
  if (key && bearer) throw new ClaudeOwnRouteError('Claude 同时配置两种令牌，请先明确一种登录来源')
  if ((key && !literal(key)) || (bearer && !literal(bearer))) throw new ClaudeOwnRouteError()
  let url: URL
  try {
    url = new URL(env.ANTHROPIC_BASE_URL || officialBase)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new Error()
  } catch {
    throw new ClaudeOwnRouteError('Claude 服务地址无效，请检查该 CLI 的配置')
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname.toLowerCase())
  if (loopback && !(await (options.available ?? claudeLoopbackAvailable)(url, signal))) {
    signal.throwIfAborted()
    return {
      kind: 'native',
      configDirectory: root,
      sourceIds: [root, 'native:claude-official-login'],
      suppressedEnvironment,
    }
  }
  signal.throwIfAborted()
  if (!key && !bearer) {
    if (loopback || url.href.replace(/\/$/, '') !== officialBase)
      throw new ClaudeOwnRouteError('Claude 服务已配置，但无法确认该服务的自身凭据')
    return {
      kind: 'native',
      configDirectory: root,
      sourceIds: [root, 'native:claude-official-login'],
      suppressedEnvironment,
    }
  }
  const modelEnvironment = Object.fromEntries(
    Object.entries(env).filter(([name, value]) => modelOption.test(name) && typeof value === 'string'),
  ) as Record<string, string>
  const model = typeof configured.model === 'string' ? configured.model : undefined
  const custom = loopback || url.href.replace(/\/$/, '') !== officialBase
  return {
    kind: loopback ? 'proxy' : 'api',
    configDirectory: root,
    sourceIds: paths,
    modelEnvironment,
    model,
    suppressedEnvironment,
    source: {
      provider: 'anthropic',
      credential: { type: 'api', key: bearer || key },
      baseUrl: url.href.replace(/\/$/, ''),
      apiType: 'anthropic-messages',
      ...(bearer ? { anthropicAuth: 'bearer' as const } : {}),
      sourceIds: paths,
      nativeModels: custom ? claudeConfiguredModels(env, model) : [],
      nativeFullModelIds: true,
      claudeRoute: loopback ? 'proxy' : 'api',
      ...(custom ? { claudeConfiguredModels: true } : {}),
      modelEnvironment,
      model,
    },
  }
}

export function claudeRouteStatusArguments(executable: string, route: ClaudeOwnRoute): string[] {
  return [
    executable,
    ...(route.kind === 'native'
      ? claudeNativeSettingsArguments(route.configDirectory, route.suppressedEnvironment)
      : []),
    'auth',
    'status',
    '--json',
  ]
}
export function claudeRouteIdentity(
  route: ClaudeOwnRoute,
  raw: string,
  exitCode: number | null,
): AccountIdentity {
  let status: any
  try {
    status = JSON.parse(raw)
  } catch {
    throw new ClaudeOwnRouteError('Claude 登录状态响应无法确认，请刷新')
  }
  if (!record(status)) throw new ClaudeOwnRouteError('Claude 登录状态响应无法确认，请刷新')
  if (status.apiProvider !== undefined && status.apiProvider !== 'firstParty') throw new ClaudeOwnRouteError()
  if (route.configDirectory && status.configDirectory !== undefined) {
    const normalized = (path: string) =>
      process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
    if (
      typeof status.configDirectory !== 'string' ||
      !isAbsolute(status.configDirectory) ||
      normalized(status.configDirectory) !== normalized(route.configDirectory)
    )
      throw new ClaudeOwnRouteError('Claude 原生账号目录与选定来源不一致')
  }
  if (route.kind === 'native') {
    if ([0, 1].includes(exitCode ?? -1) && status.loggedIn === false)
      return { state: 'unconfigured', summary: 'Claude 官方账号未登录', verification: 'cli' }
    if (exitCode !== 0 || status.loggedIn !== true || status.authMethod !== 'claude.ai')
      throw new ClaudeOwnRouteError('Claude 官方登录来源无法确认，请使用原生登录')
    const email = accountEmail(status.email)
    return {
      state: 'authenticated',
      summary: 'Claude 官方账号登录',
      authMethod: 'oauth',
      accountLabel: email,
      logins: [{ providerLabel: 'Claude 官方', authMethod: 'oauth', accountLabel: email }],
      verification: 'cli',
    }
  }
  const expected = route.source?.anthropicAuth === 'bearer' ? 'oauth_token' : 'api_key'
  if (exitCode !== 0 || status.loggedIn !== true || status.authMethod !== expected)
    throw new ClaudeOwnRouteError()
  const label = route.kind === 'proxy' ? 'Claude 本地代理' : 'Claude 自身配置'
  return {
    state: 'authenticated',
    summary: `${label} API 登录`,
    authMethod: 'api',
    logins: [{ providerLabel: label, authMethod: 'api' }],
    verification: 'cli',
  }
}

/** Pin one route before spawning; secrets are in a private temporary file, never argv. */
export async function prepareClaudeWorkerLaunch(
  route: ClaudeOwnRoute,
  argv: string[],
  stateDirectory: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  if (route.kind === 'native')
    return {
      argv: [
        argv[0]!,
        ...claudeNativeSettingsArguments(route.configDirectory, route.suppressedEnvironment),
        ...argv.slice(1),
      ],
      env: claudeLaunchEnvironment(),
    }
  if (!route.source) throw new ClaudeOwnRouteError()
  const parent = join(stateDirectory, 'claude-route')
  await safePiOmpAncestors(parent)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  await safePiOmpAncestors(parent)
  const directory = await mkdtemp(join(parent, 'run-'))
  try {
    const path = join(directory, 'settings.json')
    await writeFile(
      path,
      JSON.stringify({
        apiKeyHelper: '',
        model: route.model ?? 'default',
        env: {
          ...claudeLaunchEnvironment(),
          ...route.suppressedEnvironment,
          ...route.modelEnvironment,
          ...(route.configDirectory ? { CLAUDE_CONFIG_DIR: route.configDirectory } : {}),
          ANTHROPIC_BASE_URL: route.source.baseUrl,
          ANTHROPIC_AUTH_TOKEN: route.source.anthropicAuth === 'bearer' ? route.source.credential.key : '',
          ANTHROPIC_API_KEY: route.source.anthropicAuth === 'bearer' ? '' : route.source.credential.key,
          CLAUDE_CODE_OAUTH_TOKEN: '',
        },
      }),
      { mode: 0o600, flag: 'wx' },
    )
    signal.throwIfAborted()
    return {
      argv: [argv[0]!, '--settings', path, ...argv.slice(1)],
      env: claudeLaunchEnvironment(),
      cleanup: () => rm(directory, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}
