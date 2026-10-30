import { execFile } from 'node:child_process'
import { nativeLaunchArgv } from './native-launch.mjs'
import { nativeAgyArgv, probeAgyHostSandbox, runNativeAgy } from './native-agy.mjs'
import { runNativeAcp } from './native-acp.mjs'
import { nativeHarnessMcpServers } from './native-harness-injection.mjs'

const option = (state, id) => state?.configOptions?.find(item => item.id === id)
const values = items => (items ?? []).flatMap(item => Array.isArray(item.options) ? values(item.options) : [item.value])
const modelIds = state => (state?.models?.availableModels ?? []).map(item => item.modelId)
class AgySessionUnavailable extends Error {}

function entry(config) {
  const start = config.argv.indexOf('--add-dir')
  if (start < 1) throw new Error('Antigravity 无法确认原生启动入口')
  return config.argv.slice(0, start)
}

/** Zero-model, bounded discovery against the selected executable, not a version guess. */
export async function probeAgyAcp(config, signal) {
  const [executable, ...args] = nativeLaunchArgv([...entry(config), 'acp', '--help'])
  try {
    const help = await new Promise((resolve, reject) => {
      let failure, output
      const child = execFile(executable, args, { cwd: config.project, env: { ...process.env, ...config.env },
        windowsHide: true, timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 262144, signal },
      (error, stdout, stderr) => { failure = error; output = `${stdout}\n${stderr}` })
      child.once('close', () => failure ? reject(failure) : resolve(output))
    })
    return /^\s*--stdio(?:\s|$)/m.test(String(help))
  } catch (error) {
    signal?.throwIfAborted()
    return false
  }
}

/** `sandbox`: probeAgyHostSandbox's report; only 'available' lets auto skip confirmations. */
export function agyAcpArgv(config, platform = process.platform, sandbox) {
  // Validate the Host-generated selection before discarding stream-only flags.
  nativeAgyArgv(config)
  const directories = []
  for (let index = config.argv.indexOf('--add-dir'); index < config.argv.length - 2; index++) {
    if (config.argv[index] !== '--add-dir') continue
    const directory = config.argv[++index]
    if (!directory) throw new Error('Antigravity 缺少工作区路径')
    if (directory === config.env?.CLIWORKER_AGY_TOOLS_DIR || directory === process.env.CLIWORKER_AGY_TOOLS_DIR)
      throw new Error('Antigravity ACP 不能使用私有工具工作区')
    if (directory !== config.project) directories.push('--add-dir', directory)
  }
  if (config.mode === 'plan' || config.access === 'read-only') throw new Error('Antigravity ACP 未确认原生规划模式')
  const full = config.access === 'danger-full-access'
  // Auto matches the stream fallback: the terminal sandbox confines commands that are no
  // longer confirmed. Without that report every native request goes to DSH.
  const permission = full ? ['--sandbox=false', '--dangerously-skip-permissions']
    : sandbox === 'available' ? ['--sandbox', '--dangerously-skip-permissions']
      : sandbox === 'unavailable' || platform === 'win32' ? [] : ['--sandbox']
  return [...entry(config), 'acp', '--stdio', ...directories, ...permission]
}

/** Exact catalog ID selection followed by native readback; never derive IDs from effort suffixes. */
export async function selectAgyAcpModel(config, peer, sessionId, initial) {
  const model = config.preference.model, effort = config.preference.effort
  if (!modelIds(initial).includes(model)) throw new Error('Antigravity ACP 模型不在原生目录中')
  await peer.request('session/set_model', { sessionId, modelId: model }, { jsonrpc: true })
  const read = async () => {
    const state = await peer.request('session/load', { sessionId, cwd: config.project,
      mcpServers: nativeHarnessMcpServers(config) }, { jsonrpc: true })
    if (state?.sessionId !== sessionId || state?.models?.currentModelId !== model || !modelIds(state).includes(model))
      throw new Error('Antigravity ACP 模型或会话回读不一致')
    return state
  }
  let state = await read()
  if (effort !== 'default') {
    const thought = option(state, 'thought_level')
    if (!values(thought?.options).includes(effort)) throw new Error('Antigravity ACP 未提供所选思考强度')
    if (thought.currentValue !== effort) {
      const updated = await peer.request('session/set_config_option', { sessionId, configId: 'thought_level', value: effort }, { jsonrpc: true })
      if (option(updated, 'thought_level')?.currentValue !== effort) throw new Error('Antigravity ACP 未确认思考强度')
      state = await read()
    }
    if (option(state, 'thought_level')?.currentValue !== effort) throw new Error('Antigravity ACP 思考强度回读不一致')
  }
  return state
}

export async function runNativeAgyAcp(config, io, { sandbox } = {}) {
  let selected
  const argv = value => agyAcpArgv(value, process.platform, sandbox)
  return runNativeAcp(config, io, {
    name: 'Antigravity ACP',
    agentName: 'Antigravity ACP Server',
    argv,
    encode: value => value,
    toolName: update => update.name,
    // No ACP permission-mode catalog or plan agent was advertised by 1.4.11.
    sessionUnavailable: () => new AgySessionUnavailable('Antigravity ACP 未提供会话加载'),
    loadSession: async (peer, params) => {
      try { return await peer.request('session/load', params, { jsonrpc: true }) }
      catch (error) {
        io.signal.throwIfAborted()
        // Only an explicit native rejection is compatibility evidence. Timeouts,
        // transport failures and mismatching successful replies must not retry.
        if (typeof error.code === 'number') throw new AgySessionUnavailable('Antigravity ACP 无法加载原会话')
        throw error
      }
    },
    selectModel: async (peer, sessionId, state) => selected = await selectAgyAcpModel(config, peer, sessionId, state),
    validateConfigUpdate: update => ['model', 'thought_level'].every(id =>
      option(update, id) === undefined || option(update, id)?.currentValue === option(selected, id)?.currentValue),
    onReady: (_state, _id, nativeIo) => {
      nativeIo.event({ kind: 'diagnostic', text: config.access === 'danger-full-access'
        ? 'Antigravity ACP 完全权限：关闭终端沙箱并使用原生跳过确认'
        : sandbox === 'available'
          ? 'Antigravity ACP 自动审批：agy 报告此主机有终端沙箱，命令在沙箱内执行并使用原生跳过确认，与 stream 自动审批一致'
          : sandbox === 'unavailable'
            ? 'Antigravity ACP 自动审批：agy 报告此主机没有终端沙箱，原生请求逐条经 DSH 审批，仅允许一次；工作区编辑是否询问由原生请求决定'
            : 'Antigravity ACP 自动审批：未能确认此主机的终端沙箱，未跳过确认，原生请求逐条经 DSH 审批，仅允许一次' })
      if (argv(config).includes('--add-dir')) nativeIo.event({ kind: 'diagnostic',
        text: 'Antigravity ACP 保留了项目额外工作区；原生命令默认目录可能受工作区排序影响，请核查实际目录' })
    },
    onResult: (result, sessionId, nativeIo) => {
      if (result?.usage) nativeIo.native({ type: 'cliworker.agy_prompt_usage', sessionId,
        model: config.preference.model, usage: result.usage })
    },
  })
}

/** A task is never retried after admission; only help and initial load can fall back. */
export async function runNativeAgyAuto(config, io) {
  nativeAgyArgv(config)
  let reason
  if (config.mode === 'plan' || config.access === 'read-only') reason = 'ACP 未确认原生规划模式，使用 stream --mode plan'
  else if (!await probeAgyAcp(config, io.signal)) reason = '安装版未确认 acp --stdio，使用旧版 stream 后备（ACP 需要 agy 1.4.11 及以上）'
  else {
    const sandbox = config.access === 'danger-full-access' ? undefined : await probeAgyHostSandbox(config, io)
    try { return await runNativeAgyAcp(config, io, { sandbox }) }
    catch (error) {
      if (!(error instanceof AgySessionUnavailable)) throw error
      io.signal.throwIfAborted()
      reason = 'ACP 不兼容原会话，保留同一 conversation_id 使用 stream 后备'
    }
  }
  io.event({ kind: 'diagnostic', text: `Antigravity：${reason}` })
  return runNativeAgy(config, io)
}
