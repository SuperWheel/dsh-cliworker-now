import { ClaudeResponseTracker } from './primary-response.mjs'
import { createToolOutcomes } from './native-tool-outcomes.mjs'

const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
const string = (value) => typeof value === 'string' && value.trim().length > 0
const fail = (message) => new Error(`Claude stream-json: ${message}`)

function modelEvidence(config, initialized) {
  if (!object(initialized) || !Array.isArray(initialized.models)) throw fail('初始化未返回公开模型映射')
  const selected = config.preference.model, canonical = new Set(), rows = []
  for (const row of initialized.models) {
    if (!object(row) || !string(row.value) || !string(row.resolvedModel)) continue
    if (row.value === selected || row.resolvedModel === selected) {
      canonical.add(row.resolvedModel)
      rows.push(row)
    }
  }
  // These exact IDs came from the Host's already admitted private route snapshot.
  // They establish identity only; they do not prove a remote provider is available.
  for (const row of config.claudeModelCandidates ?? []) {
    if (object(row) && row.value === selected && string(row.resolvedModel)) canonical.add(row.resolvedModel)
  }
  if (canonical.size !== 1) throw fail('当前选型缺少唯一、可确认的原生模型映射')
  if (config.preference.effort !== 'default' && !rows.some((row) =>
    row.supportsEffort === true && Array.isArray(row.supportedEffortLevels) && row.supportedEffortLevels.includes(config.preference.effort)))
    throw fail('原生初始化未确认所选思考强度')
  return new Set([selected, ...canonical])
}

/** Native permission mode for the run's DSH tier; plan wins. */
export const claudePermissionMode = (config) =>
  config.mode === 'plan' ? 'plan' : config.access === 'danger-full-access' ? 'bypassPermissions' : 'acceptEdits'

const CLAUDE_KINDS = { Bash: 'command', Edit: 'file', MultiEdit: 'file', Write: 'file', NotebookEdit: 'file', WebFetch: 'network', WebSearch: 'network' }
/** Public summary of one can_use_tool request; a session grant needs native suggestions. */
export function claudeApprovalRequest(request) {
  const input = object(request.input) ? request.input : {}
  const target = [input.command, input.file_path, input.notebook_path, input.url, input.query, request.blocked_path].find(string)
  return {
    kind: CLAUDE_KINDS[request.tool_name] ?? 'tool',
    summary: `${string(request.title) ? request.title : request.tool_name}`.slice(0, 500),
    ...(target ? { detail: target.slice(0, 4000) } : {}),
    allowSession: Array.isArray(request.permission_suggestions) && request.permission_suggestions.length > 0 && request.suppress_always_allow_rule !== true,
  }
}

/** Keep the selected route's private --settings path and native permission mode. */
export function nativeClaudeArgv(config) {
  const argv = config.argv
  if (!Array.isArray(argv) || argv.at(-1) !== `任务：\n${config.prompt}` || !argv.includes('--print')) throw fail('不支持的原生命令参数')
  const args = argv.slice(0, -1)
  if (args[args.indexOf('--output-format') + 1] !== 'stream-json' || args[args.indexOf('--model') + 1] !== config.preference.model)
    throw fail('原生输出格式或模型与选型不一致')
  if (args[args.indexOf('--permission-mode') + 1] !== claudePermissionMode(config)) throw fail('原生权限模式与任务不一致')
  if (config.preference.effort === 'default' ? args.includes('--effort') : args[args.indexOf('--effort') + 1] !== config.preference.effort) throw fail('原生思考强度与选型不一致')
  const resumeId = config.conversationId ?? config.forkSource?.conversationId
  if (resumeId && args[args.indexOf('--resume') + 1] !== resumeId) throw fail('恢复参数与会话不一致')
  if (!resumeId && args.includes('--resume')) throw fail('缺少恢复会话绑定')
  if (['--input-format', '--permission-prompts', '--permission-prompt-tool'].some((flag) => args.includes(flag))) throw fail('重复的原生输入或权限控制选项')
  if (config.forkSource && (!string(config.forkSource.messageId) || config.conversationId)) throw fail('延迟分支截点无效')
  return [...args, ...(config.forkSource ? ['--fork-session', '--resume-session-at', config.forkSource.messageId] : []), '--input-format', 'stream-json', ...(args.includes('--include-partial-messages') ? [] : ['--include-partial-messages']), '--permission-prompts', config.approvalNonce ? 'host' : 'none',
    // Claude 2.1.287 sends can_use_tool over stdio only with this tool; `host` alone auto-denies.
    ...(config.approvalNonce ? ['--permission-prompt-tool', 'stdio'] : [])]
}

export async function runNativeClaude(config, io) {
  const peer = await io.openStdio(nativeClaudeArgv(config), { env: config.env, cwd: config.project })
  let sessionId, result, response = '', failure, submitted = false, models
  const steps = new Map(), text = new Map(), thinking = new Map(), finished = new Set(), tools = new Set(), answers = new Map(), toolMetadata = new Map()
  const childEvents = []
  const toolOutcomes = createToolOutcomes()
  let childFrame = false
  const emit = (event) => {
    if (childFrame && !event.response && responses.id) childEvents.push(event)
    else io.event(event)
  }
  const flushChildren = () => { for (const event of childEvents.splice(0)) io.event(event) }
  const responses = new ClaudeResponseTracker((event) => emit(event))
  const toolResponses = new Map(), streams = new Map()
  const step = (id) => {
    if (!steps.has(id)) steps.set(id, steps.size)
    return steps.get(id)
  }
  const identify = (id, model) => {
    if (id === undefined) return
    if (!string(id) || (sessionId && sessionId !== id) || (config.conversationId && config.conversationId !== id)) throw fail('原生会话身份与绑定不一致')
    if (config.forkSource?.conversationId === id) throw fail('分支回执仍指向原会话')
    if (!sessionId) { sessionId = id; io.session(id, model) }
  }
  const abort = () => {
    if (!submitted || result) return
    try { Promise.resolve(peer.send({ type: 'control_request', request_id: 'cliworker-interrupt', request: { subtype: 'interrupt' } })).catch(() => {}) } catch {}
  }
  io.signal?.addEventListener('abort', abort, { once: true })
  const unsubscribe = peer.onMessage((value) => {
    if (!object(value) || !string(value.type)) throw fail('无效的消息')
    // Task subagents can interleave stream frames with the main response.
    // Their message/block identity must never replace the main loop's identity.
    const scope = string(value.parent_tool_use_id) ? value.parent_tool_use_id : null
    childFrame = scope !== null
    if (!streams.has(scope)) streams.set(scope, {})
    const stream = streams.get(scope)
    if (value.type === 'control_request') {
      if (!string(value.request_id)) throw fail('反向请求缺少标识')
      const request = value.request
      // Tool authorization goes to the Host; a request needing user interaction stays unsupported.
      if (request?.subtype === 'can_use_tool' && string(request.tool_name) && request.requires_user_interaction !== true) {
        void io.approval(claudeApprovalRequest(request)).then((answer) => {
          if (answer.decision === 'deny') {
            // Denial interrupts the native turn, so the run stays failed.
            failure ??= 'CLI 额外授权被拒绝，本轮已中断'
            io.event({ kind: 'diagnostic', text: 'Claude 原生授权请求已拒绝', state: 'FAILED' })
            return peer.send({ type: 'control_response', response: { subtype: 'success', request_id: value.request_id,
              response: { behavior: 'deny', message: 'DSH 未批准此授权', interrupt: true } } })
          }
          io.event({ kind: 'diagnostic', text: 'Claude 原生授权请求已批准' })
          const session = answer.decision === 'allow-session' && Array.isArray(request.permission_suggestions)
            ? request.permission_suggestions.filter(object).map((update) => ({ ...update, destination: 'session' }))
            : []
          return peer.send({ type: 'control_response', response: { subtype: 'success', request_id: value.request_id,
            response: { behavior: 'allow', updatedInput: object(request.input) ? request.input : {},
              ...(session.length ? { updatedPermissions: session } : {}) } } })
        }).catch(() => { failure ??= 'Claude 授权回复未送达' })
        return
      }
      failure ??= 'CLI 请求额外交互授权，插件未批准'
      io.event({ kind: 'diagnostic', text: 'Claude 原生交互请求已拒绝', state: 'FAILED' })
      return peer.send({ type: 'control_response', response: value.request?.subtype === 'can_use_tool'
        ? { subtype: 'success', request_id: value.request_id, response: { behavior: 'deny', message: 'CLI Worker 未提供额外交互授权', interrupt: true } }
        : { subtype: 'error', request_id: value.request_id, error: 'CLI Worker does not provide interactive callbacks' } })
    }
    if (['control_response', 'control_cancel_request', 'keep_alive'].includes(value.type)) return
    if (value.type === 'system' && value.subtype === 'init' && (!string(value.model) || !models?.has(value.model)))
      throw fail('原生初始化模型与明确选型不一致')
    identify(value.session_id, value.type === 'system' && value.subtype === 'init' ? value.model : undefined)
    if (result) {
      if (['result', 'assistant', 'user', 'stream_event', 'error'].includes(value.type)) throw fail('原生终态后仍有对话输出')
      return
    }
    if (value.type === 'system' && value.subtype === 'init') {
      if (!sessionId) throw fail('初始化缺少会话身份')
      if (value.permissionMode !== undefined && value.permissionMode !== claudePermissionMode(config)) throw fail('原生初始化权限模式不一致')
      io.event({ kind: 'status', text: 'Claude Code 原生流已连接', observedModel: typeof value.model === 'string' ? value.model : undefined })
    } else if (value.type === 'stream_event') {
      const event = value.event
      if (!object(event)) throw fail('无效的增量事件')
      if (event.type === 'message_start') {
        stream.message = event.message?.id; stream.block = undefined
        if (value.parent_tool_use_id == null) { responses.finish(); flushChildren(); responses.start(stream.message, event.message?.usage) }
      } else if (event.type === 'message_delta') {
        if (value.parent_tool_use_id == null) responses.delta(event.usage)
      }
      else if (event.type === 'content_block_start') {
        if (!string(stream.message) || !Number.isSafeInteger(event.index) || event.index < 0 || !string(event.content_block?.type)) throw fail('无效的回复块起点')
        stream.block = { index: event.index, type: event.content_block.type }
        const key = `${stream.message}:${event.index}`, block = event.content_block
        if (block.type === 'text' && typeof block.text === 'string' && block.text) {
          text.set(key, block.text)
          responses.emit({ kind: 'assistant', step: step(key), text: block.text, state: 'RUNNING' }, value.parent_tool_use_id == null ? stream.message : undefined, event.index)
        } else if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking && block.redacted !== true) {
          thinking.set(key, block.thinking)
          responses.emit({ kind: 'reasoning', step: step(`thinking:${key}`), text: 'Claude Code 公开思考', delta: block.thinking, state: 'RUNNING' }, value.parent_tool_use_id == null ? stream.message : undefined, event.index)
        }
      } else if (event.type === 'content_block_stop') {
        if (stream.block?.index === event.index) stream.block = undefined
      } else if (event.type === 'message_stop') {
        if (value.parent_tool_use_id == null) { responses.finish(true); flushChildren() }
        stream.message = undefined; stream.block = undefined
      }
      else if (event.type === 'content_block_delta') {
        if (!string(stream.message) || !Number.isSafeInteger(event.index) || event.index < 0) throw fail('增量缺少回复块身份')
        const key = `${stream.message}:${event.index}`, delta = event.delta
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          if (finished.has(`text:${key}`)) throw fail('回复块完成后收到增量')
          text.set(key, (text.get(key) ?? '') + delta.text)
          responses.emit({ kind: 'assistant', step: step(key), text: delta.text, state: 'RUNNING' }, value.parent_tool_use_id == null ? stream.message : undefined, event.index)
        } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          if (finished.has(`thinking:${key}`)) throw fail('思考块完成后收到增量')
          thinking.set(key, (thinking.get(key) ?? '') + delta.thinking)
          responses.emit({ kind: 'reasoning', step: step(`thinking:${key}`), text: 'Claude Code 公开思考', delta: delta.thinking, state: 'RUNNING' }, value.parent_tool_use_id == null ? stream.message : undefined, event.index)
        }
      }
    } else if (value.type === 'assistant') {
      if (!string(value.message?.id) || !Array.isArray(value.message.content)) throw fail('无效的回复消息')
      // Native Task subagents may use their own explicitly chosen model; this binding owns the main loop.
      if (value.parent_tool_use_id == null && value.message.model !== undefined && !models?.has(value.message.model)) throw fail('原生回复模型与明确选型不一致')
      if (value.parent_tool_use_id == null && responses.id && responses.id !== value.message.id) responses.finish()
      value.message.content.forEach((block, index) => {
        // Assistant frames contain one completed block, not the API message's
        // whole content array. The live stream supplies its authoritative index.
        const blockIndex = value.message.content.length === 1 && stream.message === value.message.id && stream.block?.type === block.type ? stream.block.index : index
        const key = `${value.message.id}:${blockIndex}`
        if (block.type === 'text' && typeof block.text === 'string') {
          if (finished.has(`text:${key}`)) {
            if (text.get(key) !== block.text) throw fail('重复回复块内容不一致')
            return
          }
          const previous = text.get(key) ?? ''
          if (!block.text.startsWith(previous)) throw fail('增量回复与完成消息不一致')
          responses.emit({ kind: 'assistant', step: step(key), text: block.text.slice(previous.length), state: 'COMPLETED' }, value.parent_tool_use_id == null ? value.message.id : undefined, blockIndex)
          text.set(key, block.text)
          finished.add(`text:${key}`)
          if (!answers.has(value.message.id)) answers.set(value.message.id, new Map())
          answers.get(value.message.id).set(key, block.text)
          response = [...answers.get(value.message.id).values()].join('')
          if (value.parent_tool_use_id == null && block.text.trim()) toolOutcomes.succeeded()
        } else if (block.type === 'thinking' && typeof block.thinking === 'string' && block.redacted !== true) {
          if (!finished.has(`thinking:${key}`)) responses.emit({ kind: 'reasoning', step: step(`thinking:${key}`), text: 'Claude Code 公开思考', detail: block.thinking, state: 'COMPLETED' }, value.parent_tool_use_id == null ? value.message.id : undefined, blockIndex)
          finished.add(`thinking:${key}`)
        } else if (block.type === 'tool_use') {
          if (!string(block.id) || !string(block.name)) throw fail('无效的工具调用')
          if (!tools.has(block.id) && !finished.has(`tool:${block.id}`)) {
            tools.add(block.id)
            const toolCall = { callId: block.id, name: block.name, input: block.input,
              ...(string(value.parent_tool_use_id) ? { parentCallId: value.parent_tool_use_id } : {}),
              ...(typeof block.input?.command === 'string' ? { command: block.input.command } : {}) }
            toolMetadata.set(block.id, toolCall)
            const identity = responses.emit({ kind: 'tool', step: step(`tool:${block.id}`), text: block.name, state: 'RUNNING', toolCall }, value.parent_tool_use_id == null ? value.message.id : undefined, blockIndex)
            if (identity) toolResponses.set(block.id, identity)
          }
        }
      })
      if (value.error) failure ??= 'Claude 原生回复报告错误'
    } else if (value.type === 'user' && Array.isArray(value.message?.content)) {
      for (const block of value.message.content) if (block.type === 'tool_result') {
        if (!string(block.tool_use_id)) throw fail('工具结果缺少调用标识')
        if (finished.has(`tool:${block.tool_use_id}`)) continue
        tools.delete(block.tool_use_id)
        finished.add(`tool:${block.tool_use_id}`)
        if (block.is_error) toolOutcomes.failed(block.tool_use_id)
        else toolOutcomes.succeeded()
        emit({ kind: 'tool', step: step(`tool:${block.tool_use_id}`), text: '工具结果', state: block.is_error ? 'FAILED' : 'COMPLETED',
          ...(toolResponses.has(block.tool_use_id) ? { response: toolResponses.get(block.tool_use_id) } : {}),
          toolCall: { ...toolMetadata.get(block.tool_use_id), callId: block.tool_use_id, output: block.content,
            ...(string(value.parent_tool_use_id) ? { parentCallId: value.parent_tool_use_id } : {}) } })
      }
    } else if (value.type === 'result') {
      if (!sessionId || !string(value.subtype)) throw fail('终态缺少会话或状态')
      responses.finish()
      flushChildren()
      result = value
      if (Array.isArray(value.permission_denials) && value.permission_denials.length) failure ??= '工具权限被拒绝；未执行的操作不能视为完成'
      if (value.is_error || value.subtype !== 'success') failure ??= Array.isArray(value.errors) ? value.errors.filter((entry) => typeof entry === 'string').join('; ') || 'Claude 原生任务失败' : 'Claude 原生任务失败'
      if (tools.size) failure ??= '原生任务结束时仍有未完成工具'
      if (typeof value.result === 'string' && value.result.trim()) response = value.result
    } else if (value.type === 'error') failure ??= 'Claude 原生任务错误'
    // Control frames and initialization/account metadata never enter private raw logs.
    if (value.type === 'assistant') io.native({ ...value, message: { ...value.message, content: value.message.content.filter((block) => block.type !== 'redacted_thinking' && block.redacted !== true).map((block) => block.type === 'thinking' ? { type: 'thinking', thinking: block.thinking } : block) } })
    else if (value.type === 'stream_event') {
      if (value.event?.delta?.type !== 'signature_delta' && value.event?.content_block?.type !== 'redacted_thinking') {
        if (value.event?.content_block?.type === 'thinking') io.native({ ...value, event: { ...value.event, content_block: { type: 'thinking', thinking: value.event.content_block.thinking } } })
        else io.native(value)
      }
    } else if (['user', 'result'].includes(value.type)) io.native(value)
  })
  try {
    io.signal?.throwIfAborted()
    const initialization = peer.waitFor((value) => value.type === 'control_response' && value.response?.request_id === 'cliworker-initialize', { timeoutMs: Math.min(config.timeoutMs, 15000) })
    initialization.catch(() => {})
    await peer.send({ type: 'control_request', request_id: 'cliworker-initialize', request: {
      subtype: 'initialize', hooks: {}, sdkMcpServers: [], promptSuggestions: false, agentProgressSummaries: false,
    } })
    const initialized = (await initialization).response
    if (initialized.subtype !== 'success') throw fail('原生初始化被拒绝')
    models = modelEvidence(config, initialized.response)
    if (failure) throw fail(failure)
    io.signal?.throwIfAborted()
    const completion = peer.waitFor((value) => value.type === 'result', { timeoutMs: config.timeoutMs })
    completion.catch(() => {})
    submitted = true
    const content = config.attachments?.length ? await nativeAttachmentInput('claude', `任务：\n${config.prompt}`, config.attachments, io.signal) : `任务：\n${config.prompt}`
    await peer.send({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, ...(config.conversationId ? { session_id: config.conversationId } : {}) })
    await completion
    if (!result) throw fail('缺少原生终态')
    // Native summary uses the last response and local estimates. Never request
    // the "full" token-count API or run a synthetic user/model turn for metrics.
    try {
      const inspected = peer.waitFor((value) => value.type === 'control_response' && value.response?.request_id === 'cliworker-context-summary', { timeoutMs: Math.min(config.timeoutMs, 750) })
      inspected.catch(() => {})
      await peer.send({ type: 'control_request', request_id: 'cliworker-context-summary', request: { subtype: 'get_context_usage', detail: 'summary' } })
      const receipt = (await inspected).response, value = receipt?.response
      const count = (value) => Number.isSafeInteger(value) && value >= 0
      if (receipt?.subtype === 'success' && object(value) && models?.has(value.model) && count(value.totalTokens) && count(value.maxTokens) && value.maxTokens > 0) {
        const categories = Array.isArray(value.categories) ? value.categories.filter((category) => object(category) && typeof category.name === 'string' && category.name.length <= 120 && count(category.tokens) && ['used', 'free', 'buffer', 'deferred'].includes(category.kind)).slice(0, 128).map(({ name, tokens, kind }) => ({ name, tokens, kind })) : []
        io.native({ type: 'cliworker.context_inspection', cli: 'claude', source: 'claude.get_context_usage.summary',
          sessionId, model: value.model, contextUsed: value.totalTokens, contextCapacity: value.maxTokens,
          ...(categories.length ? { categories } : {}) })
      }
    } catch {
      // Unsupported/late optional metadata does not change native generation success.
    }
    peer.end()
    const outcome = await peer.done
    io.signal?.throwIfAborted()
    if (outcome.exitCode !== 0) failure ??= 'Claude 原生进程非零退出'
    if (failure) io.result('ERROR', response, failure, 'response')
    else toolOutcomes.settle(io, response, 'response')
  } finally {
    io.signal?.removeEventListener('abort', abort)
    unsubscribe()
    await peer.close()
    // Process closure proves the stream cannot continue, including on cancel or
    // parser failure. Preserve public child content without inventing usage.
    childFrame = false
    responses.finish()
    flushChildren()
  }
}
import { nativeAttachmentInput } from './native-attachments.mjs'
