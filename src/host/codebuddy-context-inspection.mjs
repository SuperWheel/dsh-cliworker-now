/**
 * Native context categories for CodeBuddy Code and WorkBuddy's built-in CLI
 * (a CodeBuddy derivative). Their ACP only reports used/size; the per-category
 * split exists only behind the local `/context` command, whose output is
 * written into the session as user-role messages and enters the next model
 * request. So the command never runs in the Worker's own process: a second,
 * `--no-session-persistence` process loads the same session read-only, runs
 * `/context` (local, no model request) and exits. Nothing is written back.
 */
const count = value => Number.isSafeInteger(value) && value >= 0
const nonempty = value => typeof value === 'string' && value.length > 0
const families = new Set(['codebuddy', 'workbuddycn', 'workbuddy'])
export const CODEBUDDY_CONTEXT_SOURCE = 'codebuddy.native-context'

const USED = ['System prompt', 'System tools', 'MCP tools', 'Memory files', 'Skills', 'Messages']

/** formatTokens of CodeBuddy 2.181 / WorkBuddy CLI 2.165: integer, or one decimal with k/m. */
function tokens(text) {
  const match = /^(\d+(?:\.\d)?)([km]?)$/.exec(text)
  if (!match) return
  const value = Math.round(Number(match[1]) * (match[2] === 'm' ? 1e6 : match[2] === 'k' ? 1e3 : 1))
  return count(value) ? value : undefined
}

/** Parse the native `/context` text. Values stay native estimates rounded to 0.1k. */
export function parseCodebuddyContextReport(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 32768) return
  const clean = text.replace(/\r\n/g, '\n').replace(/\x1b\[[0-9;]*m/g, '').replace(/^```\n?|\n?```\s*$/g, '')
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(clean)) return
  const lines = clean.split('\n').map(line => line.trimEnd())
  if (!lines.some(line => line.trim() === 'Context Usage')) return
  let model, contextUsed, contextCapacity
  const categories = [], seen = new Set()
  for (const line of lines) {
    const header = / ([^\s·]+) · (\S+)\/(\S+) tokens \((\d+)%\)$/.exec(line)
    if (header && model === undefined) {
      model = header[1]; contextUsed = tokens(header[2]); contextCapacity = tokens(header[3])
      if (contextUsed === undefined || contextCapacity === undefined || contextCapacity === 0 || contextUsed > contextCapacity) return
      continue
    }
    const used = /[⛁] (System prompt|System tools|MCP tools|Memory files|Skills|Messages): (\S+) tokens \((\d+(?:\.\d+)?)%\)$/.exec(line)
    const free = /[⛶] (Free space): (\S+) \((\d+(?:\.\d+)?)%\)$/.exec(line)
    const buffer = /[⛝] (Autocompact buffer): (\S+) tokens \((\d+(?:\.\d+)?)%\)$/.exec(line)
    const row = used ?? free ?? buffer
    if (!row) continue
    const value = tokens(row[2])
    if (value === undefined || seen.has(row[1])) return
    seen.add(row[1])
    categories.push({ name: row[1], tokens: value, kind: used ? 'used' : free ? 'free' : 'buffer' })
  }
  // System prompt, tools and messages are always printed; a partial report is not accepted.
  if (!model || !['System prompt', 'System tools', 'Messages'].every(name => seen.has(name))) return
  if (categories.some(item => item.kind === 'used' && !USED.includes(item.name))) return
  return { model, contextUsed, contextCapacity, basis: 'native-estimate', categories }
}

/**
 * Run `/context` in a separate non-persistent process. `open(onMessage)` must
 * spawn the CLI with `--no-session-persistence` through the run's own io so
 * stop and cleanup cover it. Any failure, mismatch or timeout emits nothing.
 */
export async function inspectCodebuddyContext({ config, io, sessionId, open, mcpServers = [], timeoutMs = Math.min(8000, config.timeoutMs ?? 8000) }) {
  if (!families.has(config.cli) || !nonempty(sessionId) || io.signal?.aborted) return
  let peer, timer, text = '', listening = false, modelActivity = false
  // CodeBuddy 2.181 marks the output `commandKind: local`; WorkBuddy CLI 2.165 sends it
  // unmarked. Either way a local command carries no model-request ids, thoughts or tools.
  const modelIds = ['codebuddy.ai/requestModelId', 'codebuddy.ai/modelRequestId', 'codebuddy.ai/llmMessageId']
  const onMessage = message => {
    if (message?.id !== undefined && message.method) {
      // Interactive requests are refused; this process never runs tools or prompts the model.
      void peer?.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'not supported' } }).catch(() => {})
      return
    }
    const update = message?.method === 'session/update' && message.params?.sessionId === sessionId ? message.params.update : undefined
    if (!listening || !update) return
    const meta = update._meta ?? {}
    if (['agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan'].includes(update.sessionUpdate) ||
      (update.sessionUpdate === 'agent_message_chunk' && (meta['codebuddy.ai/commandKind'] !== undefined
        ? meta['codebuddy.ai/commandKind'] !== 'local' : modelIds.some(key => meta[key] !== undefined))))
      modelActivity = true
    else if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text' &&
      typeof update.content.text === 'string' && text.length < 65536)
      text += update.content.text
  }
  const work = (async () => {
    peer = await open(onMessage)
    const initialized = await peer.request('initialize', { protocolVersion: 1, clientCapabilities: {},
      clientInfo: { name: 'dsh-cliworker-now', version: '0.8.8' } }, { jsonrpc: true })
    if (initialized?.agentCapabilities?.loadSession !== true) return
    const state = await peer.request('session/load', { sessionId, cwd: config.project, mcpServers }, { jsonrpc: true })
    const model = state?.configOptions?.find(option => option?.id === 'model')
    const current = model?.currentValue && typeof model.currentValue === 'object' ? model.currentValue.value : model?.currentValue
    if (current !== config.preference?.model)
      await peer.request('session/set_config_option', { sessionId, configId: 'model', value: config.preference.model }, { jsonrpc: true })
    listening = true // A replayed history never counts as this command's output.
    const result = await peer.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: '/context' }] }, { jsonrpc: true })
    if (result?.stopReason !== 'end_turn' || result?._meta?.['codebuddy.ai/outcome'] !== 'SUCCESS') return
    if (modelActivity) return
    const report = parseCodebuddyContextReport(text)
    if (!report || report.model !== config.preference?.model || io.signal?.aborted) return
    io.native({ type: 'cliworker.context_inspection', cli: config.cli, source: CODEBUDDY_CONTEXT_SOURCE,
      sessionId, model: report.model, contextUsed: report.contextUsed, contextCapacity: report.contextCapacity, basis: report.basis, categories: report.categories })
  })()
  try {
    await Promise.race([work, new Promise(resolve => { timer = setTimeout(resolve, timeoutMs) })])
  } catch {} finally {
    clearTimeout(timer)
    try { peer?.end?.(); await peer?.close() } catch {}
    void work.catch(() => {})
  }
}
