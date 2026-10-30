import { createHash } from 'node:crypto'
import { constants, lstatSync, openSync, readFileSync, closeSync, fstatSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, isAbsolute, posix, win32 } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { HARNESS_CONNECTION_ENV, readNativeHarnessConnection, createNativeHarnessClient } from './native-harness-mcp.mjs'

export const AGY_HARNESS_SESSION_FILE = 'CLIWORKER_AGY_HARNESS_SESSION_FILE'
const AGY_TOOLS_DIRECTORY = 'CLIWORKER_AGY_TOOLS_DIR', AGY_PROJECT = 'CLIWORKER_AGY_PROJECT'
export function agyHarnessServerName(connection) {
  return `dsh_worker_${createHash('sha256').update(JSON.stringify(connection.binding)).digest('hex').slice(0, 12)}`
}
const sessionFile = config => join(dirname(config.stopDirectory), 'agy-harness-session.json')
function readSession(path) {
  if (!isAbsolute(path ?? '')) throw new Error('AGY 工具桥缺少原生会话身份')
  const before = lstatSync(path)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 16384) throw new Error('AGY 工具桥会话记录无效')
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = fstatSync(fd)
    if (stat.dev !== before.dev || stat.ino !== before.ino) throw new Error('AGY 工具桥会话记录已变化')
    return JSON.parse(readFileSync(fd, 'utf8'))
  } finally { closeSync(fd) }
}
/** Called only after the native init/resume identity has passed the runner checks. */
export function recordAgyHarnessSession(config, id, env = process.env) {
  if (!env[AGY_HARNESS_SESSION_FILE]) return
  const connection = readNativeHarnessConnection(env)
  if (!connection?.executionReady || connection.binding.cli !== 'antigravity' ||
      env[AGY_HARNESS_SESSION_FILE] !== sessionFile(config) || typeof id !== 'string' || !id.trim() || id.length > 8192)
    throw new Error('AGY 工具桥运行身份不匹配')
  const value = { binding: connection.binding, conversationId: id }
  try { writeFileSync(sessionFile(config), JSON.stringify(value), { flag: 'wx', mode: 0o600 }) }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    if (JSON.stringify(readSession(sessionFile(config))) !== JSON.stringify(value)) throw new Error('AGY 工具桥原生会话已变化')
  }
}
/** Add an owned workspace containing only sparse MCP/Hook configuration. */
export function prepareAgyHarnessWorkspace({ directory, argv, connection, nodeExecutable = process.execPath,
  mcpEntryPath = join(dirname(fileURLToPath(import.meta.url)), 'native-harness-mcp.mjs'), platform = process.platform }) {
  if (!connection?.executionReady || connection.binding.cli !== 'antigravity') throw new Error('AGY 工具桥没有本轮执行授权')
  if (connection) {
    readNativeHarnessConnection({ [HARNESS_CONNECTION_ENV]: JSON.stringify(connection) })
    if (connection.binding?.cli !== 'antigravity') throw new Error('AGY 工具桥运行身份不匹配')
  }
  if (argv.at(-2) !== '--print') throw new Error('无法确认 AGY 原生输入入口')
  const workspace = join(directory, 'agy-tools'), agents = join(workspace, '.agents')
  mkdirSync(workspace, { mode: 0o700 }); mkdirSync(agents, { mode: 0o700 })
  if (connection?.executionReady) {
    const server = agyHarnessServerName(connection)
    writeFileSync(join(agents, 'mcp_config.json'), JSON.stringify({ mcpServers: { [server]: {
      command: nodeExecutable, args: [mcpEntryPath], env: { ELECTRON_RUN_AS_NODE: '1' },
    } } }), { flag: 'wx', mode: 0o600 })
  }
  // This function is also bundled into Host index.js. Always launch the
  // standalone carrier, rather than executing the Host plugin as a Hook.
  const hookEntry = join(dirname(fileURLToPath(import.meta.url)), 'native-agy-harness.mjs')
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`
  const command = platform === 'win32' ? '%CLIWORKER_AGY_HOOK_NODE% %CLIWORKER_AGY_HOOK_ENTRY%'
    : `${quote(nodeExecutable)} ${quote(hookEntry)}`
  writeFileSync(join(agents, 'hooks.json'), JSON.stringify({ 'dsh-worker-tools': { PreToolUse: [{
    matcher: '.*', hooks: [{ type: 'command', command, timeout: 10 }],
  }] } }), { flag: 'wx', mode: 0o600 })
  const project = argv[argv.indexOf('--add-dir') + 1]
  return { argv: [...argv.slice(0, -2), '--add-dir', workspace, ...argv.slice(-2)], env: {
    ...(connection?.executionReady ? { [AGY_HARNESS_SESSION_FILE]: join(directory, 'agy-harness-session.json') } : {}),
    [AGY_TOOLS_DIRECTORY]: workspace,
    ...(argv.includes('--add-dir') && project ? { [AGY_PROJECT]: project } : {}),
    CLIWORKER_AGY_HOOK_NODE: `"${nodeExecutable.replaceAll('\\', '/')}"`,
    CLIWORKER_AGY_HOOK_ENTRY: `"${hookEntry.replaceAll('\\', '/')}"`,
  } }
}

const absolute = value => typeof value === 'string' && (posix.isAbsolute(value) || win32.isAbsolute(value))
/**
 * The tools workspace is an `--add-dir` workspace only so agy loads its `.agents` config; the
 * model sees it beside the project and has written task files there, which accept-edits
 * approves and cleanup then deletes. Any argument naming it (path, URI, command or JSON text,
 * whose escaped separators collapse) counts.
 */
function namesToolsWorkspace(call, directory) {
  const windows = /^[A-Za-z]:[\\/]/.test(directory)
  const comparable = value => {
    const path = value.replace(/[\\/]+/g, '/')
    return windows ? path.toLowerCase() : path
  }
  const root = comparable(directory).replace(/\/+$/, '')
  const strings = [], pending = [[call?.args, 0], [call?.input, 0], [call?.parameters, 0], [call?.arguments, 0]]
  while (pending.length && strings.length < 256) {
    const [value, depth] = pending.pop()
    if (typeof value === 'string') strings.push(value)
    else if (value && typeof value === 'object' && depth < 6)
      for (const item of Object.values(value)) pending.push([item, depth + 1])
  }
  return strings.some(value => {
    const path = comparable(value)
    for (let index = path.indexOf(root); index >= 0; index = path.indexOf(root, index + 1))
      if (!/[\w.-]/.test(path[index + root.length] ?? '')) return true
    return false
  })
}

/** Only the current, fully qualified carrier tools may reach Host approval.
 * auto_approve preserves AGY's explicit user deny/ask rules. It is not a grant
 * to execute Host tools: the carrier still enters tools.execute per call.
 */
export async function agyHarnessHookDecision(payload, { env = process.env, signal } = {}) {
  const allow = { decision: 'allow' }, deny = { decision: 'deny', reason: '本轮 Harness 工具桥身份或授权无法确认，未自动重试' }
  try {
    const name = payload?.toolCall?.name
    if (typeof name !== 'string') return deny
    const connection = readNativeHarnessConnection(env)
    const server = connection?.executionReady && connection.binding.cli === 'antigravity' ? agyHarnessServerName(connection) : undefined
    const prefixes = server ? [`mcp_${server}_`, `mcp__${server}__`, `${server}.`] : []
    const carrier = prefixes.some(prefix => name.startsWith(prefix))
    const tools = env[AGY_TOOLS_DIRECTORY], project = env[AGY_PROJECT]
    if (!carrier && absolute(tools) && namesToolsWorkspace(payload.toolCall, tools))
      return { decision: 'deny', reason: `这是本轮 Harness 工具桥的私有目录，不属于项目${absolute(project) ? `；请改在项目目录 ${project} 中操作` : ''}` }
    if (!connection?.executionReady || connection.binding.cli !== 'antigravity') return deny
    // Other native tools retain their original policy, with no permission override.
    if (!carrier) return allow
    const session = readSession(env[AGY_HARNESS_SESSION_FILE])
    if (JSON.stringify(session.binding) !== JSON.stringify(connection.binding) ||
      typeof payload.conversationId !== 'string' || payload.conversationId !== session.conversationId ||
      !Number.isSafeInteger(payload.stepIdx) || payload.stepIdx < 0) return deny
    const client = createNativeHarnessClient(connection)
    const catalog = await client.request('agy-hook-catalogue', 'tools/list', {}, AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(8000)]))
    if (!Array.isArray(catalog?.tools) || !catalog.tools.some(tool => typeof tool.name === 'string' &&
        prefixes.some(prefix => name === prefix + tool.name))) return deny
    return { decision: 'auto_approve', reason: '仅进入本轮 Harness 工具桥，实际执行仍须宿主审批' }
  } catch { return deny }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const maximum = 131072
  let input = '', tooLarge = false
  try {
    process.stdin.setEncoding('utf8')
    for await (const bytes of process.stdin) {
      input += bytes.toString('utf8')
      if (Buffer.byteLength(input) > maximum) { tooLarge = true; break }
    }
    if (tooLarge) throw new Error('Hook input exceeds limit')
    process.stdout.write(JSON.stringify(await agyHarnessHookDecision(JSON.parse(input))))
  } catch { process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'Harness 工具桥准入失败，未自动重试' })) }
}
