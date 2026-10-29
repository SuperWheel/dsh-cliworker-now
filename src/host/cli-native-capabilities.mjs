// What each CLI can do natively under the exact launch this plugin builds.
// Launch builders read the same constants, so re-enabling a native feature here
// also drops the overlapping DSH fallback from the bridge catalog.
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { lstat, mkdir, readdir, readFile, readlink, realpath, rename, rm, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const CAPABILITY_CLASSES = ['file-read', 'file-write', 'search', 'shell', 'web', 'image-read', 'skills']

/**
 * Pi/OMP `--tools`. OMP relays its native approvals in both restricted tiers.
 * Pi asks through the plugin's `tool_call` gate (pi-permission-gate.mjs); an
 * install without that hook (`piGate` false) keeps the stricter old split:
 * reads only for 询问, edits without bash for 自动批准编辑.
 */
export function piOmpNativeTools(cli, mode, access, piGate = true) {
  const writable = mode === 'accept-edits' && !(cli === 'pi' && !piGate && access === 'read-only')
  const bash = mode === 'accept-edits' &&
    (cli === 'pi' && !piGate ? access === 'danger-full-access' : ['read-only', 'workspace-write', 'danger-full-access'].includes(access))
  return [
    ...(cli === 'pi' ? ['read', 'grep', 'find', 'ls'] : ['read', 'grep', 'glob']),
    ...(writable ? ['write', 'edit'] : []),
    ...(bash ? ['bash'] : []),
  ]
}
/** Grok's own web search and fetch (fetch is off unless enabled; grok 1.0.62 docs). */
export const GROK_NATIVE_WEB = true
/** Grok's plan launch restricts tools to this read-only list; web reads are read-only too. */
export const GROK_PLAN_TOOLS = ['read_file', 'grep', 'list_dir', ...(GROK_NATIVE_WEB ? ['web_search', 'web_fetch'] : [])]

/**
 * The user's own OpenCode/MiMo skill directories (opencode 1.19 / mimocode 0.1.15
 * discovery roots), handed over as `skills.paths`. Project config, external
 * (.claude/.agents) skill scans and provider config stay isolated.
 */
export function nativeSkillPaths(cli, { env = process.env, project, home = homedir() } = {}) {
  const name = cli === 'mimo' ? 'mimocode' : 'opencode'
  const config = cli === 'mimo' && env.MIMOCODE_HOME
    ? join(env.MIMOCODE_HOME, 'config')
    : join(env.XDG_CONFIG_HOME || join(home, '.config'), name)
  const roots = [config, join(home, `.${name}`), ...(project ? [join(project, `.${name}`)] : [])]
  return [...new Set(roots.flatMap(root => ['skill', 'skills'].map(directory => join(root, directory))))]
    .filter(path => { try { return statSync(path).isDirectory() } catch { return false } })
}

/**
 * A worker runs in a private home, so a native memory the user turned on is
 * shared, never copied: the private memory path becomes a link to the CLI's
 * own memory directory. A private directory that already holds files is kept
 * aside instead of being deleted.
 */
export async function shareNativeMemory(privatePath, nativePath) {
  await mkdir(nativePath, { recursive: true, mode: 0o700 })
  const target = await realpath(nativePath)
  let info
  try {
    info = await lstat(privatePath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (info?.isSymbolicLink()) {
    if (resolve(dirname(privatePath), await readlink(privatePath)) === target) return
    await rm(privatePath, { force: true })
  } else if (info?.isDirectory()) {
    if (await holdsFiles(privatePath)) await rename(privatePath, `${privatePath}.private-${Date.now()}`)
    else await rm(privatePath, { recursive: true, force: true })
  } else if (info) throw new Error('Worker 私有记忆路径不是目录')
  await mkdir(dirname(privatePath), { recursive: true, mode: 0o700 })
  // Starts that share a private home may link together: publish the link whole.
  const link = `${privatePath}.${randomUUID()}.tmp`
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  try {
    await rename(link, privatePath)
  } finally {
    await rm(link, { force: true })
  }
}
/** Memory off: drop a link left by an earlier run; a private directory stays. */
export async function unshareNativeMemory(privatePath) {
  try {
    if ((await lstat(privatePath)).isSymbolicLink()) await rm(privatePath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}
async function holdsFiles(path) {
  for (const entry of await readdir(path, { withFileTypes: true }))
    if (!entry.isDirectory() || (await holdsFiles(join(path, entry.name)))) return true
  return false
}
const switchValue = value => (/^(?:1|true|yes|on)$/i.test(value ?? '') ? true : /^(?:0|false|no|off)$/i.test(value ?? '') ? false : undefined)
/** `[memory_v2] enabled`, then `[memory] enabled`; anything this cannot read counts as unset. */
export function grokTomlMemory(text) {
  const values = new Map()
  let table = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim()
    if (line.startsWith('[[')) table = '\0'
    else if (line.startsWith('[')) table = /^\[\s*([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\s*\]$/.exec(line)?.[1] ?? '\0'
    else {
      const pair = /^([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\s*=\s*(true|false)$/.exec(line)
      const key = pair && (table ? `${table}.${pair[1]}` : pair[1])
      if (key && !values.has(key)) values.set(key, pair[2] === 'true')
    }
  }
  return values.get('memory_v2.enabled') ?? values.get('memory.enabled')
}
/**
 * Whether the user's own Grok starts with memory (grok 1.0.62 priority order):
 * requirements.toml, then GROK_MEMORY, then config.toml. Memory is off by
 * default; a managed remote setting is not visible here and counts as unset.
 */
export async function grokNativeMemory({ env = process.env, home = homedir() } = {}) {
  const read = async name => {
    try {
      return grokTomlMemory(await readFile(join(home, '.grok', name), 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return undefined
      return false
    }
  }
  return (await read('requirements.toml')) ?? switchValue(env.GROK_MEMORY?.trim()) ?? (await read('config.toml')) ?? false
}
/**
 * Hermes' built-in memory keys as the user's own config sets them. Both stores
 * default to on (hermes-agent `get_builtin_memory_store_flags`); an external
 * memory provider needs plugins, which stay off.
 */
export function hermesNativeMemory(config) {
  const section = config?.memory !== null && typeof config?.memory === 'object' && !Array.isArray(config.memory) ? config.memory : {}
  const flag = value => (value === undefined || value === null ? true : typeof value === 'string' ? /^(?:1|true|yes|on)$/i.test(value.trim()) : Boolean(value))
  return {
    memory_enabled: flag(section.memory_enabled),
    user_profile_enabled: flag(section.user_profile_enabled),
    ...Object.fromEntries(['memory_char_limit', 'user_char_limit', 'nudge_interval']
      .filter(key => Number.isFinite(section[key])).map(key => [key, section[key]])),
  }
}

const write = mode => (mode === 'plan' ? [] : ['file-write'])
const tables = {
  codex: mode => ['file-read', ...write(mode), 'search', 'shell', 'image-read', 'skills'],
  claude: mode => ['file-read', ...write(mode), 'search', 'shell', 'web', 'image-read', 'skills'],
  opencode: mode => ['file-read', ...write(mode), 'search', 'shell', 'web', 'image-read', 'skills'],
  mimo: mode => ['file-read', ...write(mode), 'search', 'shell', 'web', 'image-read', 'skills'],
  pi: (mode, access) => {
    const tools = piOmpNativeTools('pi', mode, access)
    return ['file-read', ...(tools.includes('write') ? ['file-write'] : []), 'search', ...(tools.includes('bash') ? ['shell'] : []), 'image-read']
  },
  omp: (mode, access) => {
    const tools = piOmpNativeTools('omp', mode, access)
    return ['file-read', ...(tools.includes('write') ? ['file-write'] : []), 'search', ...(tools.includes('bash') ? ['shell'] : [])]
  },
  grok: mode => mode === 'plan'
    ? ['file-read', 'search', 'skills', ...(GROK_NATIVE_WEB ? ['web'] : [])]
    : ['file-read', 'file-write', 'search', 'shell', 'skills', ...(GROK_NATIVE_WEB ? ['web'] : [])],
  kimi: mode => ['file-read', ...write(mode), 'search', 'shell', 'web', 'skills'],
  qoder: mode => ['file-read', ...write(mode), 'search', 'shell', 'web', 'skills'],
  qodercn: mode => ['file-read', ...write(mode), 'search', 'shell', 'web', 'skills'],
  // agy retired its grep/glob tools and its web exposure is unverified: DSH keeps both as fallbacks.
  antigravity: mode => ['file-read', ...write(mode), 'shell'],
}
/** Whether the CLI's MCP client hands image content from a tool result to its model (Codex unverified). */
const mcpImages = new Set(['claude', 'opencode', 'mimo', 'kimi'])

/**
 * The run's native capability table. An unknown CLI gets an empty table, which
 * offers every granted DSH tool as before (the documented rollback).
 */
export function nativeCliCapabilities({ cli, mode, access, mcpServers = [] }) {
  const classes = tables[cli]?.(mode, access) ?? []
  // Plan mode withholds native writes on purpose; a DSH write is no fallback there.
  const withheld = tables[cli] && mode === 'plan' ? ['file-write'] : []
  return { cli, classes: [...new Set(classes)], withheld, mcpServers: [...new Set(mcpServers)], mcpImages: mcpImages.has(cli) }
}

// Exact DSH built-in names (dsh-base 0.2.1-rc.2). Unlisted names are DSH-only.
const dshClasses = {
  read: 'file-read',
  write: 'file-write', edit: 'file-write', str_replace_editor: 'file-write',
  grep: 'search', glob: 'search',
  bash: 'shell', pwsh: 'shell', working_directory: 'shell',
  terminal_open: 'shell', terminal_send: 'shell', terminal_read: 'shell', terminal_signal: 'shell', terminal_list: 'shell', terminal_close: 'shell',
  job_list: 'shell', job_output: 'shell', job_kill: 'shell',
  web_search: 'web', web_fetch: 'web',
  read_image: 'image-read',
  // DSH skills reach a CLI only through dsh_list_skills / dsh_read_skill.
  skill: 'dsh-skill',
}
/** A DSH tool's capability class, or undefined for a DSH-only tool. */
export function dshToolClass(name) {
  return Object.hasOwn(dshClasses, name) ? dshClasses[name] : undefined
}
/**
 * Why this DSH tool is not offered to the CLI, or undefined when it is offered
 * as a fallback. Dispatch/model guards stay in native-harness-tools.ts.
 */
export function nativeCoverage(name, capabilities) {
  if (!capabilities) return undefined
  // Only an unambiguous identity counts: DSH keeps a valid server name verbatim,
  // and a remainder with `__` may belong to another server such as `github__x`.
  const server = capabilities.mcpServers.find(server => /^[A-Za-z0-9_-]{1,32}$/u.test(server) &&
    name.startsWith(`mcp__${server}__`) && !name.slice(server.length + 7).includes('__'))
  if (server) return `CLI 原生已配置同名 MCP「${server}」`
  const kind = dshToolClass(name)
  if (kind === 'dsh-skill') return 'DSH 技能只经 dsh_read_skill 按需读取'
  if (kind === 'image-read' && !capabilities.classes.includes('image-read') && !capabilities.mcpImages)
    return '该 CLI 的 MCP 不支持图片结果'
  if (kind && capabilities.withheld.includes(kind)) return '规划模式不提供写入工具'
  if (kind && capabilities.classes.includes(kind)) return 'CLI 原生已具备同类工具'
  return undefined
}

/**
 * Codex's thread developerInstructions replaces a configured
 * developer_instructions instead of appending to it; keep the user's own.
 */
export function codexDeveloperInstructionsConfigured(project, env = process.env) {
  return codexConfigPaths(project, env).some(path => {
    let text
    try { text = readFileSync(path, 'utf8') } catch { return false }
    // Any table (profiles included): withholding the note is the safe side.
    return tomlEntries(text).some(entry => entry.path.at(-1) === 'developer_instructions')
  })
}
export const HARNESS_FALLBACK_PREFIX = '备选（DSH）：仅在 CLI 自身工具无法完成时使用。'
/** Short native-first note listing exactly the offered bridge tools. */
export function nativeFirstGuidance(tools) {
  if (!tools?.length) return undefined
  return [
    'CLI Worker 说明：优先使用你自己的原生工具与 skill 完成任务。',
    `DSH 工具桥（dsh_worker_tools）仅在原生工具缺失或失败时作为备选，当前提供：${tools.join('、')}。`,
    '备选工具的每次执行仍需 DeepSeek Harness 宿主授权。',
  ].join('\n')
}

async function json(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return undefined }
}
/**
 * Codex's config layers, lowest precedence first: CODEX_HOME, then each folder from the
 * nearest project root down to the cwd. Codex 0.162 finds the root by `project_root_markers`
 * (default `.git`); with no root, or `[]`, only the cwd's own layer applies.
 */
function codexConfigPaths(project, env) {
  const user = join(env.CODEX_HOME || join(env.HOME || homedir(), '.codex'), 'config.toml')
  let markers = ['.git']
  try { markers = codexRootMarkers(readFileSync(user, 'utf8')) ?? markers } catch {}
  const start = resolve(project)
  let root = start
  if (markers.length)
    for (let directory = start; ; directory = dirname(directory)) {
      if (markers.some(marker => codexRootMarker(directory, marker))) { root = directory; break }
      if (dirname(directory) === directory) break
    }
  const layers = []
  for (let directory = start; ; directory = dirname(directory)) {
    layers.unshift(join(directory, '.codex', 'config.toml'))
    if (directory === root) break
  }
  return [...new Set([user, ...layers])]
}
/** Top-level `project_root_markers` as a one-line string array; anything else keeps the default. */
function codexRootMarkers(text) {
  const entry = tomlEntries(text).find(({ path }) => path.length === 1 && path[0] === 'project_root_markers')
  const value = entry?.value
  if (!value?.startsWith('[') || !value.endsWith(']')) return undefined
  return [...value.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/gu)].map(match => match[1] ?? match[2])
}
// Codex takes a `.git` file (worktree, submodule) or a `.git` folder with HEAD, not an empty folder.
function codexRootMarker(directory, marker) {
  const path = join(directory, marker)
  try {
    return marker === '.git' && statSync(path).isDirectory() ? existsSync(join(path, 'HEAD')) : existsSync(path)
  } catch { return false }
}
// Dotted TOML key split outside quotes, quotes removed.
function keyPath(text) {
  const parts = []
  let current = '', quote = ''
  for (const char of text.trim()) {
    if (quote) { if (char === quote) quote = ''; else current += char }
    else if (char === '"' || char === "'") quote = char
    else if (char === '.') { parts.push(current.trim()); current = '' }
    else current += char
  }
  return [...parts, current.trim()]
}
// The part of a line before a comment, ignoring `#` inside quoted strings.
function code(line) {
  let quote = ''
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (quote) { if (char === '\\' && quote === '"') index++; else if (char === quote) quote = '' }
    else if (char === '"' || char === "'") quote = char
    else if (char === '#') return line.slice(0, index)
  }
  return line
}
/**
 * Key/value lines of a TOML file with their full key path. Multi-line string
 * bodies are skipped, so table-looking text inside a value never counts.
 */
function tomlEntries(text) {
  const entries = []
  let table = [], multiline = ''
  for (const raw of text.split(/\r?\n/u)) {
    if (multiline) { if (raw.includes(multiline)) multiline = ''; continue }
    const line = code(raw).trim()
    const header = /^\[(?!\[)(.+)\]$/u.exec(line)
    if (header) { table = keyPath(header[1]); entries.push({ path: table, value: undefined }); continue }
    const equals = line.indexOf('=')
    if (equals <= 0) continue
    const value = line.slice(equals + 1).trim()
    entries.push({ path: [...table, ...keyPath(line.slice(0, equals))], value })
    for (const delimiter of ['"""', "'''"])
      if (value.split(delimiter).length === 2) { multiline = delimiter; break }
  }
  return entries
}
/** Enabled `mcp_servers.<name>` across Codex's layers; a later layer's `enabled` wins. */
async function codexServers(project, env) {
  const enabled = new Map()
  for (const path of codexConfigPaths(project, env)) {
    let text
    try { text = await readFile(path, 'utf8') } catch { continue }
    for (const { path: key, value } of tomlEntries(text)) {
      if (key[0] !== 'mcp_servers' || !key[1]) continue
      // A plain value directly under [mcp_servers] is no server definition.
      if (key.length === 2 && value !== undefined && !value.startsWith('{')) continue
      if (!enabled.has(key[1])) enabled.set(key[1], true)
      if (key.length === 3 && key[2] === 'enabled') enabled.set(key[1], !/^false\b/u.test(value))
      // Inline table: `name = { ..., enabled = false }`.
      if (key.length === 2 && value?.startsWith('{') && /\benabled\s*=\s*false\b/u.test(value)) enabled.set(key[1], false)
    }
  }
  return [...enabled].filter(([, on]) => on).map(([name]) => name)
}
const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
// Server names without `disabled: true` / `enabled: false`.
const keys = value => (record(value) ? Object.keys(value).filter(name => !(record(value[name]) && (value[name].disabled === true || value[name].enabled === false))) : [])
const serversIn = async path => keys((await json(path))?.mcpServers)
function gitRoot(project) {
  for (let directory = project; ; directory = dirname(directory)) {
    if (existsSync(join(directory, '.git'))) return directory
    if (dirname(directory) === directory) return project
  }
}
/**
 * Names of MCP servers the CLI loads from the user's own native config for this
 * project. Only names are read; values (commands, secrets) are never returned.
 */
export async function nativeCliMcpServers(cli, project, env = process.env) {
  const home = env.HOME || homedir()
  if (cli === 'codex') return codexServers(project, env)
  if (cli === 'claude') {
    const user = await json(join(home, '.claude.json')), local = user?.projects?.[project]
    const list = value => (Array.isArray(value) ? value.filter(name => typeof name === 'string') : [])
    // Project .mcp.json servers run only once approved for this project.
    const approved = (await serversIn(join(project, '.mcp.json'))).filter(name =>
      !list(local?.disabledMcpjsonServers).includes(name) && (local?.enableAllProjectMcpServers === true || list(local?.enabledMcpjsonServers).includes(name)))
    const disabled = list(local?.disabledMcpServers)
    return [...keys(user?.mcpServers), ...keys(local?.mcpServers), ...approved].filter(name => !disabled.includes(name))
  }
  if (cli === 'kimi') {
    const root = env.KIMI_CODE_HOME || join(home, '.kimi-code')
    return [...await serversIn(join(root, 'mcp.json')), ...await serversIn(join(gitRoot(project), '.mcp.json')), ...await serversIn(join(project, '.kimi-code', 'mcp.json'))]
  }
  // Grok's private GROK_HOME drops ~/.grok, but it still scans these compatible sources.
  if (cli === 'grok')
    return [...keys((await json(join(home, '.claude.json')))?.mcpServers), ...await serversIn(join(home, '.cursor', 'mcp.json')), ...await serversIn(join(project, '.mcp.json'))]
  if (cli === 'antigravity') return serversIn(join(home, '.gemini', 'config', 'mcp_config.json'))
  // Qoder loads user MCP from locations not yet verified; nothing is deduplicated.
  return []
}
