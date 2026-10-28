// What each CLI can do natively under the exact launch this plugin builds.
// Launch builders read the same constants, so re-enabling a native feature here
// also drops the overlapping DSH fallback from the bridge catalog.
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const CAPABILITY_CLASSES = ['file-read', 'file-write', 'search', 'shell', 'web', 'image-read', 'skills']

/** Pi/OMP `--tools`: no native shell or web (no native approval to relay). */
export function piOmpNativeTools(cli, mode) {
  return [...(cli === 'pi' ? ['read', 'grep', 'find', 'ls'] : ['read', 'grep', 'glob']), ...(mode === 'accept-edits' ? ['write', 'edit'] : [])]
}
/** Grok web search/fetch stay off until reenable-native-cli-features decides otherwise. */
export const GROK_NATIVE_WEB = false
/** Grok's plan launch restricts tools to this read-only list. */
export const GROK_PLAN_TOOLS = ['read_file', 'grep', 'list_dir']

const write = mode => (mode === 'plan' ? [] : ['file-write'])
const tables = {
  codex: mode => ['file-read', ...write(mode), 'search', 'shell', 'image-read', 'skills'],
  claude: mode => ['file-read', ...write(mode), 'search', 'shell', 'web', 'image-read', 'skills'],
  opencode: mode => ['file-read', ...write(mode), 'search', 'shell', 'web', 'image-read'],
  mimo: mode => ['file-read', ...write(mode), 'search', 'shell', 'web', 'image-read'],
  pi: mode => ['file-read', ...(piOmpNativeTools('pi', mode).includes('write') ? ['file-write'] : []), 'search', 'image-read'],
  grok: mode => mode === 'plan'
    ? ['file-read', 'search', ...(GROK_NATIVE_WEB ? ['web'] : [])]
    : ['file-read', 'file-write', 'search', 'shell', ...(GROK_NATIVE_WEB ? ['web'] : [])],
  kimi: mode => ['file-read', ...write(mode), 'search', 'shell', 'web'],
  qoder: mode => ['file-read', ...write(mode), 'search', 'shell', 'web'],
  qodercn: mode => ['file-read', ...write(mode), 'search', 'shell', 'web'],
  antigravity: mode => ['file-read', ...write(mode), 'search', 'shell', 'web'],
}
/** Whether the CLI's MCP client hands image content from a tool result to its model (Codex unverified). */
const mcpImages = new Set(['claude', 'opencode', 'mimo'])

/**
 * The run's native capability table. An unknown CLI gets an empty table, which
 * offers every granted DSH tool as before (the documented rollback).
 */
export function nativeCliCapabilities({ cli, mode, mcpServers = [] }) {
  const classes = tables[cli]?.(mode) ?? []
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
const mcpName = name => name.replace(/[^A-Za-z0-9_-]/gu, '_')
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
  const server = capabilities.mcpServers.find(server => name.startsWith(`mcp__${mcpName(server)}__`))
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
  const root = env.CODEX_HOME || join(env.HOME || homedir(), '.codex')
  return [join(root, 'config.toml'), join(project, '.codex', 'config.toml')].some(path => {
    try { return /^\s*developer_instructions\s*=/mu.test(readFileSync(path, 'utf8')) } catch { return false }
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
async function tomlServers(path) {
  let text
  try { text = await readFile(path, 'utf8') } catch { return [] }
  // Names only: `[mcp_servers.<name>]` or `[mcp_servers."<name>"]` tables.
  return [...text.matchAll(/^\s*\[\s*mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\s*\]/gmu)].map(match => match[1] ?? match[2])
}
const keys = value => (value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [])
/**
 * Names of MCP servers the CLI loads from the user's own native config for this
 * project. Only names are read; values (commands, secrets) are never returned.
 */
export async function nativeCliMcpServers(cli, project, env = process.env) {
  const home = env.HOME || homedir()
  if (cli === 'codex') {
    const root = env.CODEX_HOME || join(home, '.codex')
    return [...await tomlServers(join(root, 'config.toml')), ...await tomlServers(join(project, '.codex', 'config.toml'))]
  }
  if (cli === 'claude') {
    const user = await json(join(home, '.claude.json'))
    return [...keys(user?.mcpServers), ...keys(user?.projects?.[project]?.mcpServers), ...keys((await json(join(project, '.mcp.json')))?.mcpServers)]
  }
  return []
}
