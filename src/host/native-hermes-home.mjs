import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { isAbsolute, join, parse as parsePath, resolve, sep, toNamespacedPath } from 'node:path'
import { parseEnv } from 'node:util'
import { parse, stringify } from 'yaml'
import { object } from './native-http.mjs'

const pathKey = (path) => (process.platform === 'win32' ? toNamespacedPath(path).toLowerCase() : path)
async function directoryPins(path, optional = false) {
  if (!isAbsolute(path ?? '')) throw new Error('Hermes HTTP 私有目录必须为绝对路径')
  const absolute = resolve(path),
    pins = []
  let current = parsePath(absolute).root
  for (const segment of ['', ...absolute.slice(current.length).split(sep).filter(Boolean)]) {
    if (segment) current = join(current, segment)
    let info
    try {
      info = await lstat(current)
    } catch (error) {
      if (optional && error.code === 'ENOENT') return
      throw error
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Hermes HTTP 私有目录包含链接或非目录')
    pins.push({ path: current, info })
  }
  if (pathKey(await realpath(absolute)) !== pathKey(absolute))
    throw new Error('Hermes HTTP 私有目录真实路径不一致')
  return pins
}
async function checkPins(pins) {
  for (const pin of pins) {
    const current = await lstat(pin.path)
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== pin.info.dev ||
      current.ino !== pin.info.ino ||
      (pin.private &&
        process.platform !== 'win32' &&
        ((current.mode & 0o077) !== 0 || (process.getuid && current.uid !== process.getuid())))
    )
      throw new Error('Hermes HTTP 私有目录身份已变化')
  }
}
/** Host calls only after its entire process range has exited. Session databases stay intact. */
export async function cleanupHermesHttpHome(stateDirectory) {
  const root = resolve(stateDirectory ?? ''),
    home = join(root, 'hermes-http-home')
  if (!isAbsolute(stateDirectory ?? '')) throw new Error('Hermes HTTP 清理目录必须为绝对路径')
  const pins = await directoryPins(home, true)
  if (!pins) return
  const backups = await directoryPins(join(home, 'backups'), true)
  if (backups) pins.push(...backups.slice(pins.length))
  for (const path of [root, home]) {
    const pin = pins.find((pin) => pathKey(pin.path) === pathKey(path)),
      info = pin?.info
    if (
      !info ||
      (process.platform !== 'win32' &&
        ((info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())))
    )
      throw new Error('Hermes HTTP 清理目录不是自身私有目录')
    pin.private = true
  }
  let failure
  for (const name of ['auth.json', '.env', 'config.yaml', 'shared', 'backups/config']) {
    await checkPins(pins)
    try {
      await rm(join(home, name), {
        force: true,
        ...(['shared', 'backups/config'].includes(name) ? { recursive: true } : {}),
      })
    } catch (error) {
      failure ??= error
    }
    await checkPins(pins)
  }
  if (failure) throw failure
}
async function directory(path) {
  await directoryPins(path, true)
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Hermes HTTP 私有目录无效')
  await chmod(path, 0o700)
  return realpath(path)
}
async function read(path, optional = false) {
  let file
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const info = await file.stat()
    if (!info.isFile() || info.nlink !== 1 || info.size > 4 * 1024 * 1024)
      throw new Error('Hermes 自身账号文件无效')
    const contents = await file.readFile('utf8'),
      after = await file.stat()
    if (
      info.size !== after.size ||
      info.mtimeMs !== after.mtimeMs ||
      Buffer.byteLength(contents) > 4 * 1024 * 1024
    )
      throw new Error('Hermes 自身账号读取期间发生变化')
    return contents
  } catch (error) {
    if (optional && error.code === 'ENOENT') return ''
    throw error
  } finally {
    await file?.close()
  }
}
async function privateWrite(path, contents) {
  const temporary = `${path}.${randomBytes(12).toString('hex')}.tmp`
  try {
    await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}
const suppressed = (auth, provider, source) => {
  const entries = auth.suppressed_sources?.[provider]
  return Array.isArray(entries) ? entries.includes(source) : object(entries) && Object.hasOwn(entries, source)
}

/** Selected own account snapshot only; never copy cron, skills, messaging or old CLI sessions. */
export async function prepareHermesHttpHome(config, provider, model, key, port) {
  if (config.mode === 'plan' || config.access === 'read-only') throw new Error('Hermes 当前原生通路不支持询问或只读派遣')
  const environment = config.env ?? process.env
  const source = environment.HERMES_HOME
  if (!isAbsolute(source ?? '') || !isAbsolute(config.stateDirectory ?? ''))
    throw new Error('Hermes HTTP 账号目录缺失')
  const sourceInfo = await lstat(source)
  if (sourceInfo.isSymbolicLink() || !sourceInfo.isDirectory()) throw new Error('Hermes 自身账号目录无效')
  for (const name of ['.cliworker-managed', '.op.env']) {
    try {
      await lstat(join(source, name))
      throw new Error('Hermes HTTP 不支持额外账号配置层')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  const nativeConfig = parse(await read(join(source, 'config.yaml'))),
    auth = JSON.parse((await read(join(source, 'auth.json'), true)) || '{}')
  const dotenv = await read(join(source, '.env'), true)
  for (const line of dotenv.split(/\r?\n/)) {
    if (line.trim() && !/^\s*#/.test(line) && !/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line))
      throw new Error('Hermes 自身账号环境格式无法确认')
  }
  const ownEnv = parseEnv(dotenv)
  if (
    !object(nativeConfig) ||
    !object(auth) ||
    (auth.providers !== undefined && !object(auth.providers)) ||
    (auth.credential_pool !== undefined && !object(auth.credential_pool)) ||
    (auth.suppressed_sources !== undefined && !object(auth.suppressed_sources)) ||
    nativeConfig.auth?.adopt_external_logins !== false ||
    ['HOME', 'HERMES_HOME', 'HERMES_PROFILE', 'HERMES_MANAGED_DIR'].some((name) =>
      Object.hasOwn(ownEnv, name),
    ) ||
    Object.values(ownEnv).some(
      (value) => /^(?:op:\/\/|!|__BITWARDEN_MANAGED__)/.test(value) || value.includes('${'),
    )
  )
    throw new Error('Hermes HTTP 自身账号配置无法确认')
  if (nativeConfig.model?.provider !== provider) throw new Error('Hermes 提供商选择已变化')
  if (!['nous', 'openrouter', 'openai-codex'].includes(provider))
    throw new Error('Hermes HTTP 尚未确认此提供商的账号隔离能力')
  if (
    nativeConfig.model?.openai_runtime === 'codex_app_server' ||
    nativeConfig.model?.api_mode === 'codex_app_server'
  )
    throw new Error('Hermes HTTP 不能使用外部 Codex 登录')
  const root = await directory(config.stateDirectory),
    home = await directory(join(root, 'hermes-http-home'))
  if (home === (await realpath(source))) throw new Error('Hermes HTTP 不得覆盖原始账号目录')
  try {
    const sharedAuth = await directory(join(home, 'shared'))
    const singleton = { ...(auth.providers ?? {}) },
      seed = { nous: 'device_code', 'openai-codex': 'device_code' }[provider]
    if (seed && suppressed(auth, provider, seed)) delete singleton[provider]
    const pool = auth.credential_pool?.[provider] ?? []
    if (!Array.isArray(pool)) throw new Error('Hermes 自身账号池格式无效')
    for (const entry of pool) {
      if (!object(entry)) throw new Error('Hermes 自身账号池条目无效')
      const source = entry.source
      const own =
        (entry.auth_type === 'api_key' &&
          (!source ||
            ['manual', 'config'].includes(source) ||
            (provider === 'openrouter' && source === 'manual:openrouter_pkce'))) ||
        (typeof source === 'string' &&
          source.startsWith('env:') &&
          typeof ownEnv[source.slice(4)] === 'string') ||
        (entry.auth_type === 'oauth' &&
          (provider === 'nous' || provider === 'openai-codex') &&
          [
            'manual:device_code',
            'device_code',
            ...(provider === 'openai-codex' ? ['manual:loopback_pkce'] : []),
          ].includes(source))
      if (!own) throw new Error('Hermes HTTP 拒绝非自身来源的账号池')
    }
    const selectedPool = pool.filter(
      (entry) => object(entry) && !suppressed(auth, provider, entry.source ?? 'manual'),
    )
    const envNames = new Set(
      selectedPool.flatMap((entry) =>
        typeof entry.source === 'string' && entry.source.startsWith('env:') ? [entry.source.slice(4)] : [],
      ),
    )
    if (provider === 'openrouter') {
      for (const name of Object.keys(ownEnv))
        if (/^OPENROUTER_(?:API_KEY(?:_\d+)?|BASE_URL)$/.test(name)) envNames.add(name)
    } else if (provider === 'openai-codex') envNames.add('HERMES_CODEX_BASE_URL')
    for (const name of envNames)
      if (
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
        /^(?:HERMES_(?:HOME|PROFILE|MANAGED_DIR)|HOME|API_SERVER_|TELEGRAM_|DISCORD_|SLACK_)/.test(name)
      )
        throw new Error('Hermes 自身账号变量不能重定向网关')
    const envSnapshot = Object.fromEntries(
      [...envNames]
        .filter((name) => ownEnv[name] !== undefined && !suppressed(auth, provider, `env:${name}`))
        .map((name) => [name, ownEnv[name]]),
    )
    const api = {
      enabled: true,
      extra: { key, host: '127.0.0.1', port, max_concurrent_runs: 1, direct_model_requests: true },
    }
    // These are the installed gateway's built-in platform IDs. Explicit disable
    // also wins over inherited credentials; SAFE_MODE disables external plugins.
    const platforms = Object.fromEntries(
      [
        'local',
        'telegram',
        'discord',
        'whatsapp',
        'whatsapp_cloud',
        'slack',
        'signal',
        'mattermost',
        'matrix',
        'email',
        'sms',
        'dingtalk',
        'webhook',
        'msgraph_webhook',
        'feishu',
        'wecom',
        'wecom_callback',
        'weixin',
        'bluebubbles',
        'qqbot',
        'yuanbao',
        'relay',
      ].map((name) => [name, { enabled: false }]),
    )
    platforms.api_server = api
    const safe = {
      auth: { adopt_external_logins: false },
      approvals: { mode: config.access === 'danger-full-access' ? 'off' : 'smart' },
      model: { ...nativeConfig.model, default: model, provider },
      ...(object(nativeConfig.providers?.[provider])
        ? { providers: { [provider]: nativeConfig.providers[provider] } }
        : {}),
      fallback_providers: [],
      fallback_model: null,
      mcp_servers: {},
      platform_toolsets: { api_server: ['terminal', 'file'] },
      terminal: { backend: 'local', cwd: config.project },
      gateway: {
        multiplex_profiles: false,
        platforms,
        api_server: { max_concurrent_runs: 1 },
      },
      platforms,
      agent: { max_iterations: nativeConfig.agent?.max_iterations ?? 90 },
      memory: { memory_enabled: false, user_profile_enabled: false },
      plugins: { enabled: [] },
    }
    await privateWrite(join(home, 'config.yaml'), stringify(safe))
    await privateWrite(
      join(home, 'auth.json'),
      JSON.stringify({
        ...(auth.version === undefined ? {} : { version: auth.version }),
        active_provider: provider,
        providers: singleton[provider] === undefined ? {} : { [provider]: singleton[provider] },
        credential_pool: { [provider]: selectedPool },
        suppressed_sources:
          auth.suppressed_sources?.[provider] === undefined
            ? {}
            : { [provider]: auth.suppressed_sources[provider] },
      }) + '\n',
    )
    await privateWrite(
      join(home, '.env'),
      Object.entries(envSnapshot)
        .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
        .join('\n') + '\n',
    )
    // No external home imports or jobs are present in this worker-owned directory.
    // Explicitly suppress inherited messaging variables in addition to not copying them.
    const disabled = Object.fromEntries(
      Object.keys(process.env)
        .filter((name) =>
          /^(?:TELEGRAM_|DISCORD_|SLACK_|WHATSAPP_|SIGNAL_|MATRIX_|FEISHU_|LARK_|WECOM_|DINGTALK_|QQBOT_|TEAMS_|TWILIO_|EMAIL_|IMAP_|SMTP_|WEBHOOK_|GATEWAY_RELAY_)/.test(
            name,
          ),
        )
        .map((name) => [name, '']),
    )
    return {
      home,
      cleanup: () => cleanupHermesHttpHome(root),
      env: {
        ...environment,
        ...disabled,
        HERMES_HOME: home,
        HERMES_SHARED_AUTH_DIR: sharedAuth,
        HERMES_PROFILE: '',
        HERMES_MANAGED_DIR: join(home, '.cliworker-managed'),
        API_SERVER_ENABLED: 'true',
        API_SERVER_KEY: key,
        API_SERVER_HOST: '127.0.0.1',
        API_SERVER_PORT: String(port),
        HERMES_SAFE_MODE: '1',
        HERMES_IGNORE_RULES: '1',
        HERMES_YOLO_MODE: config.access === 'danger-full-access' ? '1' : '0',
        HERMES_ACCEPT_HOOKS: '0',
        TERMINAL_CWD: config.project,
        MESSAGING_CWD: config.project,
      },
    }
  } catch (error) {
    await cleanupHermesHttpHome(root)
    throw error
  }
}
