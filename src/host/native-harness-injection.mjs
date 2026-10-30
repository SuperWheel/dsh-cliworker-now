import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HARNESS_CONNECTION_ENV, readNativeHarnessConnection, createNativeHarnessClient } from './native-harness-mcp.mjs'
import { nativeFirstGuidance } from './cli-native-capabilities.mjs'

const serverName = 'dsh_worker_tools'
export const HARNESS_MCP_SERVER = serverName
export const nativeHarnessExecutionReady = cli => ['codex', 'claude', 'opencode', 'mimo', 'pi', 'kimi', 'grok', 'qoder', 'qodercn', 'antigravity'].includes(cli)
/** Only provider-reported, fully namespaced bridge tools may cross ACP approval.
 * Titles and rawInput are presentation/model-controlled data, never authority.
 * The Host still performs its own real approval for every tool execution.
 */
/** The run's ready bridge connection for this CLI, or undefined. */
export function nativeHarnessReadyConnection(config, env = process.env) {
  const connection = config.harnessTools ?? readNativeHarnessConnection({ ...env, ...config.env })
  return connection?.executionReady && connection.binding.cli === config.cli ? connection : undefined
}
/** The native-first note for this run's ready bridge, naming only offered tools. */
export function nativeHarnessGuidance(config, env = process.env) {
  return nativeFirstGuidance(nativeHarnessReadyConnection(config, env)?.tools)
}
export async function nativeHarnessAcpApproval(config, params, signal) {
  const connection = nativeHarnessReadyConnection(config)
  if (!connection) return undefined
  const call = params?.toolCall
  const candidates = [call?.name, call?._meta?.qoder?.toolName, call?._meta?.kimi?.toolName, call?._meta?.['x.ai']?.toolName]
    .filter(value => typeof value === 'string' && value.length)
  if (new Set(candidates).size !== 1) return undefined
  const selected = params?.options?.find(option => option.kind === 'allow_once' && typeof option.optionId === 'string')
  if (!selected) return undefined
  const client = createNativeHarnessClient(connection)
  const catalog = await client.request('acp-approval-catalogue', 'tools/list', {}, signal)
  if (!Array.isArray(catalog?.tools)) return undefined
  const authorized = catalog.tools.some(tool => typeof tool.name === 'string' && [
    `mcp__${serverName}__${tool.name}`, `${serverName}.${tool.name}`, `${serverName}_${tool.name}`,
    ...(config.cli === 'antigravity' ? [`mcp_${serverName}_${tool.name}`] : []),
  ].includes(candidates[0]))
  return authorized ? selected.optionId : undefined
}
const reasons = {
  zcode: 'ZCode 工具桥执行尚未核验，未注入 DSH 工具目录',
  hermes: 'Hermes 当前安全隔离运行尚无已验证的临时 DSH 工具注入入口',
  omp: 'OMP 当前安装版在 --no-extensions 隔离模式下忽略显式扩展，尚无安全工具注入入口',
}
export function nativeHarnessToolCapability(cli, connection) {
  if (reasons[cli]) return { transport: false, ready: false, reason: reasons[cli] }
  if (!['codex', 'claude', 'opencode', 'mimo', 'kimi', 'grok', 'zcode', 'pi', 'qoder', 'qodercn', 'antigravity'].includes(cli)) return { transport: false, ready: false, reason: '此 CLI 没有已确认的临时工具接入口' }
  if (!connection) return { transport: true, ready: false, reason: '当前运行尚未建立获准的 DSH 工具桥' }
  return { transport: true, ready: connection.executionReady === true, ...(connection.executionReady === true ? {} : { reason: '临时工具传输可配置，当前原生授权尚未核验' }) }
}
export function buildNativeHarnessInjection({ cli, argv, env = {}, connection, toolTimeoutMs, nodeExecutable = process.execPath, mcpEntryPath = join(dirname(fileURLToPath(import.meta.url)), 'native-harness-mcp.mjs') }) {
  const capability = nativeHarnessToolCapability(cli, connection)
  if (!connection || !capability.transport) return { ...capability, argv: [...argv], env: { ...env } }
  readNativeHarnessConnection({ [HARNESS_CONNECTION_ENV]: JSON.stringify(connection) })
  if (connection.binding.cli !== cli) throw new Error('DSH 工具桥与当前 CLI 身份不匹配')
  const privateEnv = { ...env, [HARNESS_CONNECTION_ENV]: JSON.stringify(connection), ELECTRON_RUN_AS_NODE: '1' }
  // Pi's bridge adds the explicit extension only after fetching its exact
  // tool names; keep this private connection out of its persisted request.
  if (cli === 'pi') return { ...capability, argv: [...argv], env: privateEnv }
  const command = { command: nodeExecutable, args: [mcpEntryPath] }
  const acpMcpServers = [{ name: serverName, ...command, env: [{ name: HARNESS_CONNECTION_ENV, value: JSON.stringify(connection) }, { name: 'ELECTRON_RUN_AS_NODE', value: '1' }] }]
  // Appended to, never replacing, the CLI's own system prompt and instruction files.
  const note = capability.ready ? nativeFirstGuidance(connection.tools) : undefined
  const guidance = flag => (note ? [flag, note] : [])
  // A host approval has no deadline of its own; the run limit bounds every call.
  const timeout = toolTimeoutMs > 0 ? ['-c', `mcp_servers.${serverName}.tool_timeout_sec=${Math.ceil(toolTimeoutMs / 1000)}`] : []
  if (cli === 'codex') return { ...capability, argv: [...argv, '-c', `mcp_servers.${serverName}.command=${JSON.stringify(nodeExecutable)}`, '-c', `mcp_servers.${serverName}.args=${JSON.stringify([mcpEntryPath])}`, '-c', `mcp_servers.${serverName}.env_vars=${JSON.stringify([HARNESS_CONNECTION_ENV, 'ELECTRON_RUN_AS_NODE'])}`, ...timeout, ...(capability.ready ? ['-c', `mcp_servers.${serverName}.default_tools_approval_mode="approve"`] : [])], env: privateEnv }
  if (cli === 'claude') {
    const index = argv.indexOf('--print')
    if (index < 1) throw new Error('无法确认 Claude 原生入口')
    return { ...capability, argv: [...argv.slice(0, index), '--mcp-config', JSON.stringify({ mcpServers: { [serverName]: { ...command,
      env: { [HARNESS_CONNECTION_ENV]: '${CLIWORKER_HARNESS_TOOLS}', ELECTRON_RUN_AS_NODE: '1' } } } }), ...(capability.ready ? ['--allowedTools', `mcp__${serverName}__*`] : []), ...guidance('--append-system-prompt'), ...argv.slice(index)], env: privateEnv }
  }
  if (cli === 'opencode' || cli === 'mimo') {
    const key = `${cli === 'mimo' ? 'MIMOCODE' : 'OPENCODE'}_CONFIG_CONTENT`
    let previous = {}
    if (env[key]) { try { previous = JSON.parse(env[key]) } catch { throw new Error('CLI 临时配置不是有效 JSON') } }
    if (!previous || typeof previous !== 'object' || Array.isArray(previous) || (previous.mcp && (typeof previous.mcp !== 'object' || Array.isArray(previous.mcp)))) throw new Error('CLI 临时 MCP 配置无效')
    if (previous.mcp?.[serverName]) throw new Error('CLI 已存在同名 DSH 工具桥，拒绝覆盖')
    return { ...capability, argv: [...argv], env: { ...privateEnv, [key]: JSON.stringify({ ...previous, mcp: { ...previous.mcp, [serverName]: { type: 'local', command: [nodeExecutable, mcpEntryPath], environment: { [HARNESS_CONNECTION_ENV]: JSON.stringify(connection), ELECTRON_RUN_AS_NODE: '1' }, enabled: true } } }) } }
  }
  return { ...capability, argv: [...argv], env: privateEnv, acpMcpServers: cli === 'zcode' ? acpMcpServers.map(server => ({ ...server, isolation: 'session' })) : acpMcpServers }
}
export function nativeHarnessMcpServers(config, env = process.env) {
  const connection = config.harnessTools ?? readNativeHarnessConnection({ ...env, ...config.env })
  if (!connection) return []
  return buildNativeHarnessInjection({ cli: config.cli, argv: config.argv, connection }).acpMcpServers ?? []
}
