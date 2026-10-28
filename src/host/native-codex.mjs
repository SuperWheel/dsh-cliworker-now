import { resolve } from 'node:path'
import { CodexRunUsage } from './codex-run-usage.mjs'
import { createToolOutcomes } from './native-tool-outcomes.mjs'
import { nativeHarnessGuidance } from './native-harness-injection.mjs'
import { codexDeveloperInstructionsConfigured } from './cli-native-capabilities.mjs'

const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
const string = (value) => typeof value === 'string' && value.trim().length > 0
const fail = (message) => new Error(`Codex app-server: ${message}`)
const toolTypes = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'collabAgentToolCall', 'imageGeneration'])

/** Convert only the verified native exec argv, before any platform launcher. */
export function nativeCodexArgv(config) {
  const { argv, conversationId, prompt, preference } = config
  if (!Array.isArray(argv) || argv[1] !== 'exec' || argv.at(-1) !== `任务：\n${prompt}`)
    throw fail('不支持的原生命令参数')
  const args = argv.slice(2, -1)
  if (conversationId) {
    if (args.shift() !== 'resume' || args.shift() !== conversationId) throw fail('恢复参数与会话不一致')
  } else if (args[0] === 'resume') throw fail('缺少恢复会话绑定')
  const preserved = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--json' || arg === '--skip-git-repo-check') continue
    if (arg === '--model') {
      if (args[++index] !== preference.model) throw fail('模型参数与选型不一致')
      continue
    }
    if (['-c', '--config', '--enable', '--disable'].includes(arg)) {
      if (!string(args[index + 1])) throw fail('不完整的原生配置参数')
      preserved.push(arg, args[++index])
    } else if (arg === '--strict-config') preserved.push(arg)
    else throw fail('不支持的原生执行选项')
  }
  return [argv[0], 'app-server', '--stdio', ...preserved]
}

const APPROVAL_METHODS = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval']
const SANDBOX_TYPES = { 'read-only': 'readOnly', 'workspace-write': 'workspaceWrite', 'danger-full-access': 'dangerFullAccess' }

/**
 * Native thread settings for this run's DSH tier. Plan never asks; 完全权限
 * uses Codex's own full-access mode; the confined tiers ask on request. A run
 * without a Host tier keeps the historical workspace mapping.
 */
export function codexPermission(config) {
  const plan = config.mode === 'plan'
  const sandbox = plan ? 'read-only' : config.access ?? 'workspace-write'
  const approvalPolicy = plan || !config.access || sandbox === 'danger-full-access' ? 'never' : 'on-request'
  return { sandbox, approvalPolicy, sandboxType: SANDBOX_TYPES[sandbox], legacy: !config.access }
}

/** Public summary of one Codex approval request for the DSH prompt. */
export function codexApprovalRequest(method, params) {
  const reason = string(params.reason) ? `原因：${params.reason}` : undefined
  if (method === 'item/commandExecution/requestApproval') {
    const command = Array.isArray(params.command) ? params.command.join(' ') : params.command
    return { kind: 'command', summary: `执行命令：${string(command) ? command : '（CLI 未提供命令）'}`,
      detail: [reason, string(params.cwd) ? `命令目录：${params.cwd}` : undefined].filter(Boolean).join('\n'), allowSession: true }
  }
  if (method === 'item/fileChange/requestApproval')
    return { kind: 'file', summary: string(params.grantRoot) ? `写入目录：${params.grantRoot}` : '修改文件',
      detail: reason, allowSession: true }
  return { kind: 'permission', summary: '扩大沙箱权限', allowSession: true,
    detail: [reason, object(params.permissions) ? `请求：${JSON.stringify(params.permissions).slice(0, 2000)}` : undefined].filter(Boolean).join('\n') }
}

function safeItem(item) {
  // The app-server exposes raw reasoning separately. Only its public summary is used.
  if (item.type === 'reasoning') return { id: item.id, type: item.type, summary: item.summary }
  return item
}

/** Tool metadata for `detail`; the output body travels once, in `toolCall.output`. */
function toolDetail(item) {
  const { aggregatedOutput: _output, result: _result, contentItems: _items, changes: _changes, ...metadata } = safeItem(item)
  return JSON.stringify(metadata)
}

function publicTool(item) {
  return {
    callId: item.id,
    name: typeof item.tool === 'string' ? item.tool : item.type,
    ...(Object.hasOwn(item, 'arguments') ? { input: item.arguments } : {}),
    ...(item.type === 'fileChange' && Object.hasOwn(item, 'changes') ? { output: item.changes } : {}),
    ...(typeof item.command === 'string' ? { command: item.command } : {}),
    ...(Object.hasOwn(item, 'aggregatedOutput') ? { output: item.aggregatedOutput } : {}),
    ...(Object.hasOwn(item, 'result') ? { output: item.result } : {}),
    ...(Array.isArray(item.contentItems) ? { output: item.contentItems } : {}),
    ...(Number.isSafeInteger(item.exitCode) ? { exitCode: item.exitCode } : {}),
  }
}

export async function runNativeCodex(config, io) {
  const peer = await io.openStdio(nativeCodexArgv(config), { env: config.env, cwd: config.project })
  let threadId, turnId, response = '', failure, denied = false, completed = false, started = false
  const steps = new Map(), messages = new Map(), finished = new Set(), tools = new Set(), receipts = new Map()
  const steerReceipts = new Map(), toolItems = new Map(), toolOutput = new Map()
  // Items whose approval was declined; their declined/failed completion is the denial itself.
  const deniedItems = new Set()
  const runUsage = new CodexRunUsage(config.conversationId)
  const toolOutcomes = createToolOutcomes()
  const step = (id) => {
    if (!steps.has(id)) steps.set(id, steps.size)
    return steps.get(id)
  }
  const markFailure = (message) => { failure ??= message }
  const releaseSteer = io.registerSteer?.(async (message, requestId, attempt) => {
    if (!started || !threadId || !turnId || completed || failure || io.signal?.aborted)
      throw Object.assign(fail('当前轮次未就绪或已结束，未发送引导'), { code: 'STEER_REJECTED' })
    const expected = turnId
    const rpcId = `cliworker-steer-${attempt ?? requestId}`
    const observed = { expected, acceptedBeforeEnd: false }
    steerReceipts.set(rpcId, observed)
    let receipt
    try {
      receipt = await peer.request('turn/steer', {
        threadId, expectedTurnId: expected, clientUserMessageId: requestId,
        input: [{ type: 'text', text: message }],
      }, { id: rpcId, timeoutMs: Math.min(config.timeoutMs, 12000) })
    } catch (error) {
      if ([-32600, -32601, -32602].includes(error?.code))
        throw Object.assign(fail('原生 CLI 明确拒绝引导'), { code: 'STEER_REJECTED' })
      throw fail('引导接收回执未知，请核对当前运行，不要自动重投')
    } finally {
      steerReceipts.delete(rpcId)
    }
    if (receipt?.turnId !== expected || !observed.acceptedBeforeEnd)
      throw fail('引导轮次或接收状态未确认，请核对当前运行，不要自动重投')
    io.native({ method: 'turn/steer', threadId, expectedTurnId: expected, clientUserMessageId: requestId, result: receipt })
  })
  const abort = () => {
    if (threadId && turnId && !completed) {
      try { Promise.resolve(peer.send({ id: 'cliworker-interrupt', method: 'turn/interrupt', params: { threadId, turnId } })).catch(() => {}) } catch {}
    }
  }
  io.signal?.addEventListener('abort', abort, { once: true })
  const completeItem = (item) => {
    if (!object(item) || !string(item.id) || !string(item.type)) throw fail('无效的轮次条目')
    const receipt = JSON.stringify({ type: item.type, text: item.text, summary: item.summary, status: item.status, exitCode: item.exitCode, success: item.success, error: item.error, failure: item.failure })
    if (finished.has(item.id)) {
      if (receipts.get(item.id) !== receipt) throw fail('重复条目完成回执矛盾')
      return
    }
    receipts.set(item.id, receipt)
    finished.add(item.id)
    if (item.type === 'agentMessage') {
      if (typeof item.text !== 'string') throw fail('无效的回复条目')
      const previous = messages.get(item.id) ?? ''
      if (!item.text.startsWith(previous)) throw fail('流式回复与完成条目不一致')
      const remaining = item.text.slice(previous.length)
      if (remaining || previous) io.event({ kind: 'assistant', step: step(item.id), text: remaining, state: 'COMPLETED' })
      messages.set(item.id, item.text)
      if (item.text.trim()) {
        response = item.text
        toolOutcomes.succeeded()
      }
    } else if (item.type === 'reasoning') {
      if (Array.isArray(item.summary)) item.summary.forEach((summary, index) => {
        if (typeof summary === 'string') io.event({ kind: 'reasoning', step: step(`reasoning:${item.id}:${index}`), text: 'Codex 思考摘要', detail: summary, state: 'COMPLETED' })
      })
    } else if (toolTypes.has(item.type)) {
      tools.delete(item.id)
      // Every typed tool except webSearch has an explicit native completion status.
      const failed = (item.type !== 'webSearch' && item.status !== 'completed') || item.success === false || !!item.error || !!item.failure || (typeof item.exitCode === 'number' && item.exitCode !== 0)
      if (item.status === 'inProgress') markFailure('原生轮次结束时仍有未完成工具')
      else if (failed && !deniedItems.has(item.id)) toolOutcomes.failed(item.id)
      else if (!failed) toolOutcomes.succeeded()
      io.event({ kind: 'tool', step: step(item.id), text: item.command ?? item.tool ?? item.type, state: failed ? 'FAILED' : 'COMPLETED', detail: toolDetail(item), toolCall: { ...publicTool(item),
        ...(item.type === 'commandExecution' && item.aggregatedOutput == null && toolOutput.has(item.id) ? { output: toolOutput.get(item.id) } : {}) } })
    }
  }
  const unsubscribe = peer.onMessage((message) => {
    if (!object(message)) throw fail('无效的消息')
    const guidance = steerReceipts.get(message.id)
    if (guidance && typeof message.method !== 'string' && !message.error) {
      // Observe ordering at frame delivery, before promise continuations can run
      // after a coalesced turn/completed frame from the same stdout chunk.
      guidance.acceptedBeforeEnd = message.result?.turnId === guidance.expected && !completed && !failure && !io.signal?.aborted
    }
    if (typeof message.method !== 'string') return
    const params = object(message.params) ? message.params : {}
    // Authorization requests go to the Host (DSH preset and user); other
    // interactive requests (user input, elicitation) remain unsupported.
    if (message.id !== undefined) {
      if (APPROVAL_METHODS.includes(message.method)) {
        const itemId = typeof params.itemId === 'string' ? params.itemId : undefined
        void io.approval(codexApprovalRequest(message.method, params)).then((answer) => {
          const allowed = answer.decision !== 'deny'
          if (!allowed) {
            denied = true
            if (itemId) deniedItems.add(itemId)
          }
          io.event({ kind: 'diagnostic', text: allowed ? 'Codex 原生授权请求已批准' : 'Codex 原生交互请求已拒绝' })
          if (message.method !== 'item/permissions/requestApproval')
            return peer.send({ id: message.id, result: { decision: !allowed ? 'decline' : answer.decision === 'allow-session' ? 'acceptForSession' : 'accept' } })
          return peer.send({ id: message.id, result: allowed && object(params.permissions)
            ? { permissions: params.permissions, scope: answer.decision === 'allow-session' ? 'session' : 'turn' }
            : { permissions: { network: null, fileSystem: null }, scope: 'turn' } })
        }).catch(() => markFailure('Codex 授权回复未送达'))
        return
      }
      markFailure('CLI 请求额外交互授权，插件未批准')
      io.event({ kind: 'diagnostic', text: 'Codex 原生交互请求已拒绝', state: 'FAILED' })
      return peer.send({ id: message.id, error: { code: -32601, message: 'CLI Worker does not provide interactive approvals or user input' } })
    }
    if (!started) {
      runUsage.beforeStart(message.method, params)
      return
    }
    if (params.threadId !== threadId) return
    if (message.method === 'turn/started') {
      if (!string(params.turn?.id) || (turnId && turnId !== params.turn.id)) throw fail('轮次身份不一致')
      turnId = params.turn.id
      return
    }
    const scopedTurn = params.turnId ?? params.turn?.id
    if (!turnId || scopedTurn !== turnId) return
    if (completed) {
      if (message.method === 'turn/completed') throw fail('重复轮次终态')
      return
    }
    if (message.method === 'item/agentMessage/delta') {
      if (!string(params.itemId) || typeof params.delta !== 'string' || finished.has(params.itemId)) throw fail('无效或迟到的回复增量')
      messages.set(params.itemId, (messages.get(params.itemId) ?? '') + params.delta)
      io.event({ kind: 'assistant', step: step(params.itemId), text: params.delta, state: 'RUNNING' })
      io.native(message)
    } else if (message.method === 'item/reasoning/summaryTextDelta') {
      if (!string(params.itemId) || typeof params.delta !== 'string' || finished.has(params.itemId) || (params.summaryIndex !== undefined && (!Number.isSafeInteger(params.summaryIndex) || params.summaryIndex < 0))) throw fail('无效或迟到的公开摘要增量')
      const key = `reasoning:${params.itemId}:${params.summaryIndex ?? 0}`
      io.event({ kind: 'reasoning', step: step(key), text: 'Codex 思考摘要', delta: params.delta, state: 'RUNNING' })
    } else if (message.method === 'item/commandExecution/outputDelta' || message.method === 'item/mcpToolCall/progress') {
      const item = toolItems.get(params.itemId)
      const command = message.method === 'item/commandExecution/outputDelta'
      const delta = command ? params.delta : params.message
      // Only the current turn's still-running typed tool owns its progress.
      // Raw reasoning and unrelated notifications never enter this channel.
      if (!item || !tools.has(params.itemId) || finished.has(params.itemId) ||
        item.type !== (command ? 'commandExecution' : 'mcpToolCall') || typeof delta !== 'string') return
      // Only the increment is sent; the completed item carries the one full output.
      if (command) toolOutput.set(params.itemId, (toolOutput.get(params.itemId) ?? '') + delta)
      io.event({ kind: 'tool', step: step(item.id), text: item.command ?? item.tool ?? item.type, state: 'RUNNING',
        ...(command ? { delta } : { toolCall: { ...publicTool(item), output: delta } }) })
      io.native({ method: message.method, params: { ...params, ...(command ? { delta: { cliworkerOmitted: true, bytes: Buffer.byteLength(delta) } } : {}) } })
    } else if (message.method === 'item/started' || message.method === 'item/completed') {
      const item = params.item
      if (!object(item) || !string(item.id) || !string(item.type)) throw fail('无效的条目通知')
      io.native({ method: message.method, params: { ...params, item: safeItem(item) } })
      if (message.method === 'item/completed') completeItem(item)
      else if (toolTypes.has(item.type)) {
        if (finished.has(item.id)) throw fail('条目完成后再次启动')
        tools.add(item.id)
        toolItems.set(item.id, item)
        io.event({ kind: 'tool', step: step(item.id), text: item.command ?? item.tool ?? item.type, state: 'RUNNING', detail: toolDetail(item), toolCall: publicTool(item) })
      }
    } else if (message.method === 'thread/tokenUsage/updated') {
      runUsage.active(params)
      io.native(message)
      const total = params.tokenUsage?.total
      if (object(total)) io.native({ type: 'turn.completed', usage: { input_tokens: total.inputTokens, output_tokens: total.outputTokens, cached_input_tokens: total.cachedInputTokens, cache_write_tokens: total.cacheWriteInputTokens, reasoning_output_tokens: total.reasoningOutputTokens, total_tokens: total.totalTokens } })
    } else if (message.method === 'error') {
      io.event({ kind: 'diagnostic', text: typeof params.error?.message === 'string' ? params.error.message : 'Codex 原生错误', state: 'FAILED' })
      if (params.willRetry !== true) markFailure('Codex 原生轮次错误')
    } else if (message.method === 'turn/completed') {
      if (!object(params.turn) || !Array.isArray(params.turn.items)) throw fail('无效的轮次终态')
      for (const item of params.turn.items) completeItem(item)
      completed = true
      if (params.turn.status !== 'completed') markFailure(typeof params.turn.error?.message === 'string' ? params.turn.error.message : `原生轮次 ${params.turn.status}`)
      if (tools.size) markFailure('原生轮次结束时仍有未完成工具')
      io.native({ method: message.method, params: { threadId, turn: { id: turnId, status: params.turn.status, error: params.turn.error } } })
    }
  })
  try {
    io.signal?.throwIfAborted()
    await peer.request('initialize', { clientInfo: { name: 'cli_worker_native', title: 'CLI Worker', version: '0.8.4' }, capabilities: { experimentalApi: false, requestAttestation: false, explicitGatewayOauth: true } })
    await peer.send({ method: 'initialized', params: {} })
    const permission = codexPermission(config)
    const options = { cwd: config.project, model: config.preference.model, approvalPolicy: permission.approvalPolicy, sandbox: permission.sandbox }
    const guidance = codexDeveloperInstructionsConfigured(config.project, { ...process.env, ...config.env }) ? undefined : nativeHarnessGuidance(config)
    const result = await peer.request(config.conversationId ? 'thread/resume' : 'thread/start', {
      ...options,
      ...(guidance ? { developerInstructions: guidance } : {}),
      ...(config.conversationId ? { threadId: config.conversationId, excludeTurns: true } : {}),
    })
    if (!string(result?.thread?.id) || (config.conversationId && result.thread.id !== config.conversationId)) throw fail('原生会话身份与绑定不一致')
    if (result.model !== config.preference.model || !string(result.cwd) || resolve(result.cwd) !== resolve(config.project) || result.approvalPolicy !== permission.approvalPolicy || result.sandbox?.type !== permission.sandboxType || (permission.legacy && result.sandbox?.networkAccess === true))
      throw fail('原生会话未保留所选模型、目录或权限')
    if (config.preference.effort !== 'default' && result.reasoningEffort !== undefined && result.reasoningEffort !== null && result.reasoningEffort !== config.preference.effort) throw fail('原生思考强度与选型不一致')
    threadId = result.thread.id
    io.session(threadId, result.model)
    io.signal?.throwIfAborted()
    if (!config.conversationId) runUsage.prepare(threadId, true)
    else if (result.thread.status?.type === 'idle') {
      // Optional metadata only: no history items, account query or model request.
      // Unsupported/late readback leaves this run's billing aggregate unknown.
      try {
        const metadata = await peer.request('thread/read', { threadId, includeTurns: false }, { timeoutMs: Math.min(config.timeoutMs, 750) })
        const latest = await peer.request('thread/turns/list', { threadId, sortDirection: 'desc', limit: 1, itemsView: 'notLoaded' }, { timeoutMs: Math.min(config.timeoutMs, 750) })
        runUsage.prepare(threadId, false, metadata, latest)
      } catch {}
    }
    io.signal?.throwIfAborted()
    runUsage.start()
    started = true
    const completion = peer.waitFor((message) => message.method === 'turn/completed' && message.params?.threadId === threadId && (!turnId || message.params?.turn?.id === turnId), { timeoutMs: config.timeoutMs })
    completion.catch(() => {})
    const turn = await peer.request('turn/start', {
      threadId,
      input: await nativeAttachmentInput('codex', `任务：\n${config.prompt}`, config.attachments, io.signal),
      model: config.preference.model,
      ...(config.preference.effort !== 'default' ? { effort: config.preference.effort } : {}),
      // Public summaries are opt-in (some models default to none). Never request raw reasoning.
      summary: 'auto',
      cwd: config.project,
      approvalPolicy: permission.approvalPolicy,
      // A tiered run keeps the user's native network and writable roots for its
      // sandbox type; plan and legacy runs still pin the stricter turn policy.
      ...(config.mode === 'plan' ? { sandboxPolicy: { type: 'readOnly' } }
        : permission.legacy ? { sandboxPolicy: { type: 'workspaceWrite', writableRoots: [config.project], networkAccess: false } } : {}),
    }, { timeoutMs: config.timeoutMs })
    if (!string(turn?.turn?.id) || (turnId && turn.turn.id !== turnId)) throw fail('启动回执缺少匹配轮次')
    turnId = turn.turn.id
    await completion
    if (!completed) throw fail('缺少原生轮次完成证据')
    const billing = runUsage.finish(turnId)
    if (billing) io.native({ type: 'cliworker.codex_run_usage', sessionId: threadId, turnId, usage: billing })
    peer.end()
    const outcome = await peer.done
    io.signal?.throwIfAborted()
    if (outcome.exitCode !== 0) markFailure('Codex 原生进程非零退出')
    if (failure) io.result('ERROR', response, failure, 'response')
    else toolOutcomes.settle(io, response, 'response', denied)
  } finally {
    releaseSteer?.()
    io.signal?.removeEventListener('abort', abort)
    unsubscribe()
    await peer.close()
  }
}
import { nativeAttachmentInput } from './native-attachments.mjs'

/** Metadata only: thread/fork never starts a turn. lastTurnId is inclusive (native schema). */
export async function forkNativeCodex(config, io) {
  const peer = await io.openStdio(nativeCodexArgv(config), { env: config.env, cwd: config.project })
  const unsubscribe = peer.onMessage((message) => {
    if (message.id !== undefined && message.method)
      return peer.send({ id: message.id, error: { code: -32601, message: '分支不接受交互请求' } })
  })
  try {
    await peer.request('initialize', { clientInfo: { name: 'cli_worker_native', version: '0.8.4' }, capabilities: { experimentalApi: false } })
    await peer.send({ method: 'initialized', params: {} })
    if (config.forkOperation === 'delete') {
      // Codex exposes archive, not deletion. Keep an explicit orphan/archival receipt.
      await peer.request('thread/archive', { threadId: config.conversationId })
      io.native({ type: 'cliworker.fork_cleanup', note: 'Codex 原生分支已归档；原生协议未提供永久删除接口' })
      io.result('SUCCESS', '')
      return
    }
    const result = await peer.request('thread/fork', {
      threadId: config.conversationId,
      ...(config.forkAt?.turnId ? { lastTurnId: config.forkAt.turnId } : {}),
      cwd: config.project, model: config.preference.model, approvalPolicy: 'never',
      sandbox: config.mode === 'plan' ? 'read-only' : 'workspace-write', excludeTurns: true,
    })
    if (!string(result?.thread?.id) || result.thread.id === config.conversationId)
      throw fail('分支回执没有新的原生会话 ID')
    io.native({ type: 'cliworker.fork_created', id: result.thread.id })
    io.result('SUCCESS', '')
  } finally {
    unsubscribe()
    await peer.close()
  }
}
