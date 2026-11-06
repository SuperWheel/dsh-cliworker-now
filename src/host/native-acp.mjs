import { summarizeNativeRecord } from './native-transport.mjs'
// ACP is JSON-RPC 2.0 over NDJSON. Kimi and Grok retain their own config wire.
import { nativeHarnessMcpServers, nativeHarnessAcpApproval, nativeHarnessGuidance } from './native-harness-injection.mjs'
import { nativeAttachmentInput } from './native-attachments.mjs'
import { createToolOutcomes } from './native-tool-outcomes.mjs'
export const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
export const nonempty = (value) => typeof value === 'string' && value.trim().length > 0

/** ACP image blocks require the agent's advertised prompt capability. Other
 * agents receive validated local image paths, without a claim of model vision. */
export async function nativeAcpAttachmentPrompt(config, agentCapabilities, signal) {
  const attachments = config.attachments ?? []
  if (agentCapabilities?.promptCapabilities?.image === true || !attachments.some(item => item.kind === 'image'))
    return nativeAttachmentInput('acp', config.prompt, attachments, signal)
  const text = await nativeAttachmentInput('text', config.prompt, attachments.filter(item => item.kind === 'image'), signal)
  return nativeAttachmentInput('acp', text, attachments.filter(item => item.kind !== 'image'), signal)
}

const ACP_KINDS = { execute: 'command', edit: 'file', delete: 'file', move: 'file', fetch: 'network' }
/** Public summary of one ACP permission request for the DSH prompt. A session
 * grant is offered only when the CLI's own session-scoped option is present. */
export function acpApprovalRequest(params, sessionOption) {
  const call = isRecord(params?.toolCall) ? params.toolCall : {}
  const input = isRecord(call.rawInput) ? call.rawInput : {}
  const paths = Array.isArray(call.locations) ? call.locations.map((item) => item?.path).filter(nonempty) : []
  const detail = nonempty(input.command) ? input.command : nonempty(input.CommandLine) ? input.CommandLine : paths.join('\n')
  const title = nonempty(call.title) ? call.title : '工具调用'
  // Antigravity titles a command request with the command itself; don't show it twice.
  const plain = (text) => text.trim().replace(/^`+|`+$/g, '').trim()
  return {
    kind: ACP_KINDS[call.kind] ?? 'tool',
    summary: title.slice(0, 500),
    ...(detail && plain(detail) !== plain(title) ? { detail: detail.slice(0, 4000) } : {}),
    allowSession: !!sessionOption,
  }
}

/** Remove only known per-turn arguments; retain executable/launcher and other global options. */
export function replaceNativeArguments(argv, pairs, switches, tail) {
  if (!Array.isArray(argv) || !argv.length || argv.some((arg) => typeof arg !== 'string'))
    throw new Error('Invalid native argument array')
  const result = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (pairs.includes(arg)) {
      if (index + 1 >= argv.length) throw new Error('Native option is missing its value')
      index++
    } else if (!switches.includes(arg)) result.push(arg)
  }
  return [...result, ...tail]
}

const optionValues = (options) =>
  Array.isArray(options)
    ? options.flatMap((option) =>
        isRecord(option) && Array.isArray(option.options)
          ? optionValues(option.options)
          : [optionValue(option?.value)],
      )
    : []
const optionValue = (value) => (isRecord(value) ? value.value : value)
const findOption = (state, id) => state?.configOptions?.find((option) => option.id === id)

async function selectOption(peer, sessionId, state, id, value, encode, required = true, force = false) {
  const option = findOption(state, id)
  if (!option) {
    if (required) throw new Error(`ACP does not advertise ${id} selection`)
    return state
  }
  if (!optionValues(option.options).includes(value)) throw new Error(`ACP rejected the selected ${id}`)
  if (!force && optionValue(option.currentValue) === value) return state
  const updated = await peer.request(
    'session/set_config_option',
    { sessionId, configId: id, value: encode(value) },
    { jsonrpc: true },
  )
  if (optionValue(findOption(updated, id)?.currentValue) !== value)
    throw new Error(`ACP did not confirm the selected ${id}`)
  return { ...state, ...updated }
}

/** Runs exactly one turn; restored history is deliberately ignored before prompt admission. */
export async function runNativeAcp(config, io, settings) {
  let wantedMode = config.mode === 'plan' ? 'plan' : settings.editMode
  let permissionDowngraded = false
  let peer,
    sessionId,
    active = false,
    response = '',
    thought = '',
    failure,
    // Background work outlived the bounded checks: unverified, never success or a CLI error.
    backgroundUnconfirmed,
    started = 0,
    // During a background check turn, removes the control marker from streamed text.
    markerFilter,
    lastToolAt = -1,
    denied = false,
    ended = false
  let step = 0, assistantStep = 0, assistantSegmentOpen = false, thoughtStep = 0
  const responses = settings.responseTracker?.(io)
  const emit = (event) => responses
    ? responses.emit(event, event.kind === 'tool' ? `tool:${event.toolCall.callId}` : `${event.kind}:${event.step}`)
    : io.event(event)
  const tools = new Map(),
    // Tool calls whose permission was denied; their failure is the denial itself.
    deniedTools = new Set(),
    seen = new Set(),
    // Native tools that return at dispatch while their work continues in the CLI (Antigravity invoke_subagent).
    background = new Set(),
    early = [],
    toolOutcomes = createToolOutcomes()
  const fail = (message) => {
    failure ??= message
  }
  const emitAssistant = (text) => {
    if (text.trim()) toolOutcomes.succeeded()
    if (!text) return
    if (!assistantSegmentOpen) { assistantStep++; assistantSegmentOpen = true }
    emit({ kind: 'assistant', step: assistantStep, text })
  }
  /** Streams text unchanged except for whole marker occurrences; holds back only a possible marker prefix. */
  const createMarkerFilter = (marker) => {
    let held = ''
    return {
      push(text) {
        held = (held + text).split(marker).join('')
        let keep = 0
        for (let size = Math.min(marker.length - 1, held.length); size > 0; size--)
          if (marker.startsWith(held.slice(-size))) { keep = size; break }
        const out = held.slice(0, held.length - keep)
        held = held.slice(held.length - keep)
        return out
      },
      flush() { const rest = held; held = ''; return rest },
    }
  }
  const finishThought = () => {
    if (!thought) return
    emit({ kind: 'reasoning', step: thoughtStep++, text: `${settings.name} 公开思考`,
      detail: thought, state: 'COMPLETED' })
    thought = ''
  }
  const receive = async (message) => {
    const rawUpdate = message?.params?.update
    io.native(['tool_call', 'tool_call_update'].includes(rawUpdate?.sessionUpdate)
      ? { ...message, params: { ...message.params, update: { ...rawUpdate,
        ...(rawUpdate.rawOutput !== undefined ? { rawOutput: summarizeNativeRecord(rawUpdate.rawOutput, 0) } : {}),
        ...(rawUpdate.content !== undefined ? { content: summarizeNativeRecord(rawUpdate.content, 0) } : {}) } } } : message)
    if (!isRecord(message) || message.jsonrpc !== '2.0') {
      fail('Invalid ACP JSON-RPC envelope')
      throw new Error('Invalid ACP JSON-RPC envelope')
    }
    if (!nonempty(message.method)) return
    if (!peer) {
      early.push(message)
      return
    }
    if (message.id !== undefined) {
      if (message.method === 'session/request_permission') {
        const options = Array.isArray(message.params?.options) ? message.params.options : []
        const reply = (option) => peer.send({ jsonrpc: '2.0', id: message.id,
          result: { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } } })
        const deny = () => {
          if (active && message.params?.sessionId === sessionId) {
            // The CLI may recover from a denial and complete the turn normally.
            denied = true
            if (nonempty(message.params?.toolCall?.toolCallId)) deniedTools.add(message.params.toolCall.toolCallId)
            io.event({ kind: 'diagnostic', text: 'CLI 额外权限请求已拒绝' })
          }
          return reply(options.find((option) => option.kind === 'reject_once'))
        }
        if (!(active && !ended && message.params?.sessionId === sessionId)) return deny()
        const approved = await nativeHarnessAcpApproval(config, message.params, io.signal)
        if (!active || ended || io.signal.aborted) return deny()
        if (approved) return peer.send({ jsonrpc: '2.0', id: message.id,
          result: { outcome: { outcome: 'selected', optionId: approved } } })
        // Other requests go to the Host (DSH preset and user) without blocking this reader.
        const sessionOption = settings.sessionOption?.(options)
        void io.approval(acpApprovalRequest(message.params, sessionOption)).then((answer) => {
          if (!active || ended || io.signal.aborted) return deny()
          // The Host may still hold the requested full-access tier. A native
          // downgrade must not inherit its automatic residual approvals.
          if (permissionDowngraded && answer.source === 'full-access') {
            io.event({ kind: 'diagnostic', text: '原生权限已降级，拒绝沿用完全权限自动放行；请切换 Worker 档位后重试' })
            return deny()
          }
          const option = answer.decision === 'deny' ? undefined
            : answer.decision === 'allow-session' && sessionOption ? sessionOption
              : options.find((item) => item.kind === 'allow_once')
          if (!option) return deny()
          io.event({ kind: 'diagnostic', text: 'CLI 额外权限请求已批准' })
          return reply(option)
        }).catch(() => fail('ACP 授权回复未送达'))
        return
      } else {
        return peer.send({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'Client capability unavailable' },
        })
      }
      return
    }
    if (active && !ended && settings.receive?.(message, sessionId, responses, finishThought)) return
    if (!active || ended || message.method !== 'session/update' || message.params?.sessionId !== sessionId)
      return
    const update = message.params.update
    if (!isRecord(update)) return
    if (update.sessionUpdate === 'current_mode_update') {
      if (wantedMode && update.currentModeId !== wantedMode) {
        fail('ACP 实际权限与所选模式不匹配')
        cancel()
      }
      return
    }
    if (update.sessionUpdate === 'config_option_update') {
      const observed = optionValue(findOption(update, 'model')?.currentValue)
      if (settings.validateConfigUpdate ? !settings.validateConfigUpdate(update) :
        observed !== undefined && observed !== config.preference.model) {
        fail('ACP 实际模型与所选模型不匹配')
        cancel()
      }
      const observedMode = settings.modeConfigId && optionValue(findOption(update, settings.modeConfigId)?.currentValue)
      if (settings.modeConfigId && observedMode !== undefined && observedMode !== wantedMode) {
        fail('ACP 实际权限与所选模式不匹配')
        cancel()
      }
      return
    }
    // Stable ids only: identical token chunks can legitimately repeat without an id.
    const eventId = update.eventId ?? message.params.eventId ?? message.params._meta?.eventId
    if (nonempty(eventId)) {
      if (seen.has(eventId)) return
      seen.add(eventId)
    }
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
      finishThought()
      if (typeof update.content.text !== 'string') {
        fail('Invalid ACP text chunk')
        return
      }
      response += update.content.text
      emitAssistant(markerFilter ? markerFilter.push(update.content.text) : update.content.text)
    } else if (update.sessionUpdate === 'agent_thought_chunk' && update.content?.type === 'text') {
      if (typeof update.content.text === 'string') {
        if (update.content.text) assistantSegmentOpen = false
        thought += update.content.text
        emit({
          kind: 'reasoning',
          step: thoughtStep,
          text: `${settings.name} 公开思考`,
          delta: update.content.text,
          state: 'RUNNING',
        })
      }
    } else if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      finishThought()
      assistantSegmentOpen = false
      if (!nonempty(update.toolCallId)) {
        fail('Invalid ACP tool identity')
        return
      }
      if (settings.background?.isBackgroundTool(update)) background.add(update.toolCallId)
      lastToolAt = response.length
      const previous = tools.get(update.toolCallId) ?? { step: step++, title: '工具', status: 'pending' }
      const value = {
        ...previous,
        ...(nonempty(update.title) ? { title: update.title } : {}),
        ...(nonempty(update.status) ? { status: update.status } : {}),
      }
      const { rawInput: _input, rawOutput, content, ...metadata } = update
      const output = Object.hasOwn(update, 'rawOutput') ? rawOutput : content
      const done = ['completed', 'failed'].includes(value.status)
      const prior = previous.output ?? ''
      const increment = !done && typeof output === 'string' && typeof prior === 'string' && output.startsWith(prior)
      if (output !== undefined) value.output = output
      tools.set(update.toolCallId, value)
      if (value.status === 'failed' && !deniedTools.has(update.toolCallId)) toolOutcomes.failed(update.toolCallId)
      else if (value.status === 'completed' && previous.status !== 'completed') toolOutcomes.succeeded()
      emit({
        kind: 'tool',
        step: value.step,
        text: value.title,
        state: value.status === 'completed' ? 'COMPLETED' : value.status === 'failed' ? 'FAILED' : 'RUNNING',
        detail: JSON.stringify(metadata),
        ...(increment ? { delta: output.slice(prior.length) } : {}),
        toolCall: { callId: update.toolCallId,
          ...(nonempty(settings.toolName?.(update) ?? update.title)
            ? { name: settings.toolName?.(update) ?? update.title } : {}),
          ...(Object.hasOwn(update, 'rawInput') ? { input: update.rawInput } : {}),
          ...(!increment && (output !== undefined || done) && value.output !== undefined ? { output: value.output } : {}) },
      })
    }
  }
  /** The CLI keeps background work private until it receives another prompt (verified on agy 1.5.1):
   * waiting alone never yields it. Keep stdio, approvals and events live, then send bounded,
   * visible same-session checks until the CLI reports instead of the pending marker. */
  const awaitBackground = async (first) => {
    const { pendingMarker, checkPrompt, delaysMs, budgetMs } = settings.background
    const deadline = started + Math.min(budgetMs, config.timeoutMs ?? budgetMs)
    let result = first
    for (const [index, delay] of delaysMs.entries()) {
      const wait = Math.min(delay, deadline - Date.now())
      if (wait <= 0) break
      // Diagnostics, not status: the Worker process view shows them, so automatic turns stay visible.
      io.event({ kind: 'diagnostic', notice: true, text: `${settings.name} 子 Agent 仍在后台运行，${Math.round(wait / 1000)} 秒后由 CLI Worker 自动发送第 ${index + 1} 次跟进检查` })
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { io.signal.removeEventListener('abort', stop); resolve() }, wait)
        const stop = () => { clearTimeout(timer); reject(io.signal.reason ?? new Error('任务已停止')) }
        io.signal.addEventListener('abort', stop, { once: true })
        // The status event above may already have led to a stop.
        if (io.signal.aborted) { io.signal.removeEventListener('abort', stop); stop() }
      })
      io.signal.throwIfAborted()
      if (failure) return result
      const before = response.length
      assistantSegmentOpen = false
      io.event({ kind: 'diagnostic', notice: true, text: `CLI Worker 自动跟进（非用户消息）：请 ${settings.name} 汇报后台子 Agent 结果，不重新派发` })
      await settings.onResult?.(result, sessionId, io)
      markerFilter = createMarkerFilter(pendingMarker)
      try {
        result = await peer.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: checkPrompt }] },
          { jsonrpc: true, timeoutMs: Math.max(1000, deadline - Date.now()) })
      } finally {
        const rest = markerFilter.flush()
        markerFilter = undefined
        emitAssistant(rest)
      }
      if (result?.stopReason !== 'end_turn' || failure) return result
      const turn = response.slice(before)
      if (!turn.includes(pendingMarker)) return result
      // Still waiting only if the marker ended the turn: agy may reply the marker and
      // then, in the same turn, receive the backlog and finish the remaining steps.
      const end = before + turn.lastIndexOf(pendingMarker) + pendingMarker.length
      const pending = !response.slice(end).trim() && lastToolAt < end
      // The marker is a control reply, not task output.
      response = response.slice(0, before) + turn.split(pendingMarker).join('').trim()
      if (!pending) return result
    }
    backgroundUnconfirmed = `${settings.name} 后台子 Agent 未在限定时间内汇报结果，请核查实际产物`
    return result
  }
  const cancel = () => {
    if (peer && sessionId && active && !ended)
      void peer.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } }).catch(() => {})
  }
  io.signal.addEventListener('abort', cancel, { once: true })
  try {
    io.signal.throwIfAborted()
    peer = await io.openStdio(settings.argv(config), {
      env: config.env,
      cwd: config.project,
      onMessage: receive,
    })
    for (const message of early.splice(0)) {
      // It was already supplied to telemetry before the peer became available.
      if (message.id !== undefined)
        await peer.send({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'Client not initialized' },
        })
    }
    const initialized = await peer.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: settings.clientCapabilities ?? {},
        clientInfo: { name: 'dsh-cliworker-now', version: '0.8.7' },
      },
      { jsonrpc: true },
    )
    if (initialized?.protocolVersion !== 1) throw new Error('Unsupported ACP protocol version')
    if (settings.agentName && initialized.agentInfo?.name !== settings.agentName)
      throw new Error(`${settings.name} 原生程序身份不匹配，请检查 CLI 路径`)
    let state
    if (config.conversationId) {
      if (initialized.agentCapabilities?.loadSession !== true)
        throw settings.sessionUnavailable?.() ?? new Error('ACP cannot restore the existing session')
      sessionId = config.conversationId
      const loadParams = { sessionId, cwd: config.project, mcpServers: nativeHarnessMcpServers(config) }
      state = settings.loadSession
        ? await settings.loadSession(peer, loadParams)
        : await peer.request('session/load', loadParams, { jsonrpc: true })
      if (state?.sessionId !== undefined && state.sessionId !== sessionId)
        throw new Error('ACP restored a different session')
    } else {
      // Grok appends _meta.rules to its own prompt; no other ACP CLI has a verified entry.
      const rules = config.cli === 'grok' ? nativeHarnessGuidance(config) : undefined
      state = await peer.request('session/new', { cwd: config.project, mcpServers: nativeHarnessMcpServers(config), ...(rules ? { _meta: { rules } } : {}) }, { jsonrpc: true })
      if (!nonempty(state?.sessionId)) throw new Error('ACP did not return a session identity')
      sessionId = state.sessionId
    }
    if (settings.selectModel) state = await settings.selectModel(peer, sessionId, state)
    else state = await selectOption(peer, sessionId, state, 'model', config.preference.model, settings.encode)
    if (!settings.selectModel && config.preference.effort !== 'default')
      state = await selectOption(
        peer,
        sessionId,
        state,
        settings.effortId,
        config.preference.effort === 'none' ? settings.off : config.preference.effort,
        settings.encode,
      )
    if (wantedMode) {
      const candidates = [wantedMode, ...(config.mode === 'plan' ? [] : settings.fallbackModes ?? [])]
      for (const [index, candidate] of candidates.entries()) {
        try {
          io.signal.throwIfAborted()
          const launchConfirmed = settings.launchModes?.includes(candidate) && state?.modes == null
          if ((settings.requireModeCatalog || !settings.modeConfigId) && !launchConfirmed &&
            !state?.modes?.availableModes?.some((mode) => mode.id === candidate))
            throw new Error('ACP does not advertise the selected permission mode')
          if (settings.modeConfigId) {
            // A rejected selection may already have changed native state. Always
            // send and confirm the fallback, even if the old snapshot matched it.
            state = await selectOption(peer, sessionId, state, settings.modeConfigId, candidate, settings.encode, true, index > 0)
          } else if (!launchConfirmed && (index > 0 || state?.modes?.currentModeId !== candidate)) {
            const updated = await peer.request('session/set_mode', { sessionId, modeId: candidate }, { jsonrpc: true })
            if (updated?.modes?.currentModeId !== undefined && updated.modes.currentModeId !== candidate)
              throw new Error('ACP did not confirm the selected permission mode')
          }
          wantedMode = candidate
          permissionDowngraded = index > 0
          if (permissionDowngraded) io.event({ kind: 'diagnostic', text: `${settings.name} 原生权限模式不可用，本轮按${candidate === 'default' ? '询问' : '自动审批'}运行（${candidate}）` })
          break
        } catch (error) {
          io.signal.throwIfAborted()
          if (index === candidates.length - 1)
            throw new Error(`${settings.name} 无法确认原生权限模式，拒绝启动：${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    io.signal.throwIfAborted()
    if (failure) throw new Error(failure)
    io.session(sessionId, config.preference.model)
    await settings.onReady?.(state, sessionId, io, wantedMode)
    io.signal.throwIfAborted()
    io.event({ kind: 'status', text: `${settings.name} 原生模型已确认` })
    active = true
    started = Date.now()
    let result = await peer.request(
      'session/prompt',
      {
        sessionId,
        prompt: await nativeAcpAttachmentPrompt(config, initialized.agentCapabilities, io.signal),
      },
      { jsonrpc: true, timeoutMs: config.timeoutMs },
    )
    if (settings.background && background.size && result?.stopReason === 'end_turn' && !failure)
      result = await awaitBackground(result)
    ended = true
    // Kimi emits its context snapshot asynchronously AFTER settling prompt.
    // Give that optional native receipt a bounded drain before closing stdio.
    if (settings.awaitPostPromptUsage && peer.waitFor && !io.signal.aborted)
      await peer.waitFor((message) => message.method === 'session/update' &&
        message.params?.sessionId === sessionId &&
        message.params?.update?.sessionUpdate === 'usage_update',
      { timeoutMs: Math.min(config.timeoutMs ?? 15000, 1000) }).catch(() => {})
    finishThought()
    responses?.finish(undefined, false)
    if (result?.sessionId !== undefined && result.sessionId !== sessionId)
      throw new Error('ACP prompt session changed')
    await settings.onResult?.(result, sessionId, io)
    if (result?.stopReason !== 'end_turn')
      fail(`CLI 未成功完成（${String(result?.stopReason ?? 'missing terminal')}）`)
    if ([...tools.values()].some((tool) => !['completed', 'failed'].includes(tool.status)))
      fail('CLI 工具缺少终态')
    if (io.signal.aborted) fail('任务已停止')
    if (failure) io.result('ERROR', response, failure, 'run')
    else if (backgroundUnconfirmed) io.result('UNCERTAIN', response, backgroundUnconfirmed, 'run')
    else if (!response) io.result('UNCERTAIN', response, 'CLI 未返回可核查的本轮正文', 'run')
    else toolOutcomes.settle(io, response, 'run', denied)
  } finally {
    if (active && !ended) cancel()
    ended = true
    io.signal.removeEventListener('abort', cancel)
    active = false
    if (peer) {
      peer.end()
      await peer.close()
    }
  }
}

/** Standard ACP session/fork, confirmed against Kimi and Qoder implementations. */
export async function forkNativeAcp(config, io, argv) {
  const peer = await io.openStdio(argv, { env: config.env, cwd: config.project })
  const unsubscribe = peer.onMessage((message) => {
    if (message.id !== undefined && message.method)
      return peer.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: '分支不接受交互请求' } })
  })
  try {
    const initialized = await peer.request('initialize', { protocolVersion: 1,
      clientCapabilities: {}, clientInfo: { name: 'dsh-cliworker-now', version: '0.8.7' } }, { jsonrpc: true })
    const capabilities = initialized?.agentCapabilities?.sessionCapabilities
    const operation = config.forkOperation === 'delete' ? 'delete' : 'fork'
    if (!capabilities || !Object.hasOwn(capabilities, operation))
      throw new Error(`当前 CLI 未确认原生 session/${operation} 能力`)
    const result = await peer.request(`session/${operation}`, {
      sessionId: config.conversationId, cwd: config.project, mcpServers: [],
    }, { jsonrpc: true })
    if (operation === 'fork') {
      if (typeof result?.sessionId !== 'string' || !result.sessionId.trim() || result.sessionId === config.conversationId)
        throw new Error('ACP 分支回执没有新的原生会话 ID')
      io.native({ type: 'cliworker.fork_created', id: result.sessionId })
      if (Object.hasOwn(capabilities, 'close'))
        await peer.request('session/close', { sessionId: result.sessionId }, { jsonrpc: true })
    }
    io.result('SUCCESS', '')
  } finally { unsubscribe(); await peer.close() }
}
