import { summarizeNativeRecord } from './native-transport.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { isAbsolute, join, dirname, basename } from 'node:path'
import { isRecord, nonempty, replaceNativeArguments } from './native-acp.mjs'
import { nativeHarnessMcpServers } from './native-harness-injection.mjs'
import { ZcodeResponseTracker, ZcodeToolInputs } from './zcode-response.mjs'
import { createToolOutcomes } from './native-tool-outcomes.mjs'
import { zcodeContextBinding, unknownZcodeContextInspection, readZcodeContextInspections } from './zcode-context-observation.mjs'

const ZCODE_KINDS = { bash: 'command', shell: 'command', edit: 'file', write: 'file', webfetch: 'network', websearch: 'network' }
/** Public summary of one interaction/requestPermission for the DSH prompt. */
export function zcodeApprovalRequest(params) {
  const input = isRecord(params.input) ? params.input : {}
  const target = [input.command, input.file_path, input.path, input.url].find(nonempty)
  const tool = nonempty(params.toolName) ? params.toolName : '工具调用'
  return {
    kind: ZCODE_KINDS[tool.toLowerCase()] ?? 'tool',
    summary: (nonempty(params.reason) ? `${tool}：${params.reason}` : tool).slice(0, 500),
    ...(target ? { detail: target.slice(0, 4000) } : {}),
    allowSession: false,
  }
}

export function zcodeAppServerArgv(config) {
  const firstOption = config.argv.findIndex((arg) =>
    ['--cwd', '--mode', '--output-format', '--resume', '--prompt', '--disallowedTools'].includes(arg),
  )
  if (firstOption < 1) throw new Error('Cannot identify the native ZCode command prefix')
  // --disallowedTools consumes multiple positional values. Put the command first
  // so the native parser cannot interpret "app-server" as another denied tool.
  return [
    ...config.argv.slice(0, firstOption),
    'app-server',
    ...replaceNativeArguments(
      config.argv.slice(firstOption),
      ['--cwd', '--mode', '--output-format', '--resume', '--prompt'],
      [],
      ['--cwd', config.project],
    ),
  ]
}

const matchingModel = (value, model) =>
  value?.providerId === model.providerId && value?.modelId === model.modelId
const accountEnvironmentKey = 'CLIWORKER_ZCODE_NATIVE_ACCOUNT'
const memoryEnvironmentKey = 'CLIWORKER_ZCODE_NATIVE_MEMORY'
/** The desktop memory switch the adapter read; the native CLI never receives the variable. */
function nativeMemory(config) {
  const environment = config.env ?? process.env
  const value = environment[memoryEnvironmentKey]
  delete environment[memoryEnvironmentKey]
  delete process.env[memoryEnvironmentKey]
  return value === undefined ? config.zcodeNativeMemory === true : value === '1'
}
function nativeAccount(config, model) {
  const environment = config.env ?? process.env
  const encoded = environment[accountEnvironmentKey]
  // The native subprocess must receive the key only in the verified RPC reply.
  delete environment[accountEnvironmentKey]
  delete process.env[accountEnvironmentKey]
  let account = config.zcodeNativeAccount
  try {
    if (encoded !== undefined) {
      if (typeof encoded !== 'string' || encoded.length > 32768) throw new Error()
      account = JSON.parse(encoded)
    }
  } catch {
    throw new Error('ZCode 私有账号材料无效')
  }
  if (account === undefined) {
    if (model.providerId.startsWith('account:')) throw new Error('ZCode 当前账号路由未初始化')
    return
  }
  const provider = model.providerId,
    access = account?.accountAccess,
    snapshot = account?.snapshot
  if (
    account?.schema !== 1 ||
    !Number.isSafeInteger(account.createdAt) ||
    account.createdAt > Date.now() + 1000 ||
    !matchingModel(account.selection, model) ||
    !nonempty(account.binding?.identity) ||
    !nonempty(account.binding?.key) ||
    /[\x00-\x1f\x7f]/.test(account.binding.key) ||
    access?.type !== 'zhipu-account' ||
    access.mode !== 'individual-coding-plan' ||
    !['bigmodel', 'zai'].includes(access.accountType) ||
    access.entitled !== true ||
    !isAbsolute(account.credential?.authDirectory ?? '') ||
    !/^[a-f0-9]{64}$/.test(account.credential?.sha256 ?? '') ||
    !nonempty(snapshot?.revision) ||
    !nonempty(snapshot?.basedOnZCodeBuiltinRevision) ||
    Object.keys(snapshot?.providers ?? {}).length !== 1 ||
    snapshot.providers[provider]?.access?.type !== 'zhipu-account' ||
    snapshot.providers[provider]?.access?.entitled !== true ||
    Object.keys(snapshot?.states ?? {}).length !== 1 ||
    snapshot.states[provider]?.availability !== 'available' ||
    snapshot.states[provider]?.entitled !== true ||
    snapshot.states[provider]?.current !== true
  )
    throw new Error('ZCode 私有账号路由与所选模型不匹配')
  return account
}
async function confirmAccount(account, config) {
  // The bridge turns timeoutMs into the time left at its start; the material lasts until the task's deadline.
  if (Date.now() > (config.deadlineAt ?? account.createdAt + config.timeoutMs)) throw new Error('ZCode 私有账号材料已过期')
  const auth = account.credential.authDirectory
  for (const path of [auth, join(auth, '.zcode'), join(auth, '.zcode/v2')]) {
    const directory = await lstat(path)
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new Error('ZCode 原生账号绑定目录已变化')
  }
  const file = await open(
    join(auth, '.zcode/v2/credentials.json'),
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  )
  const bytes = Buffer.alloc(65537)
  try {
    const before = await file.stat()
    if (!before.isFile() || before.nlink !== 1 || !before.size || before.size > 65536)
      throw new Error('ZCode 原生账号绑定文件无效')
    let length = 0
    while (length < bytes.length) {
      ioCheck(config)
      const read = await file.read(bytes, length, bytes.length - length, null)
      if (!read.bytesRead) break
      length += read.bytesRead
    }
    const after = await file.stat(),
      current = await lstat(join(auth, '.zcode/v2/credentials.json'))
    if (
      length !== before.size ||
      before.ino !== after.ino ||
      before.dev !== after.dev ||
      current.isSymbolicLink() ||
      current.ino !== before.ino ||
      current.dev !== before.dev ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      createHash('sha256')
        .update(JSON.stringify(JSON.parse(bytes.subarray(0, length).toString('utf8'))))
        .digest('hex') !== account.credential.sha256
    )
      throw new Error('ZCode 当前账号身份或凭据已变化')
  } catch {
    throw new Error('ZCode 当前账号身份或凭据无法安全确认')
  } finally {
    bytes.fill(0)
    await file.close()
  }
}
// Kept independent of transport callbacks so a private binding check never emits
// native credentials in an error or diagnostic.
const ioCheck = (config) => config.signal?.throwIfAborted()
const readIdentity = (snapshot, sessionId, project) => {
  if (!nonempty(snapshot?.session?.sessionId) || (sessionId && snapshot.session.sessionId !== sessionId))
    throw new Error('ZCode session identity mismatch')
  if (snapshot.session.workspace?.workspacePath !== project)
    throw new Error('ZCode session workspace mismatch')
  return snapshot.session.sessionId
}
function selectedModel(config, snapshot, model) {
  const entry = snapshot?.settings?.model?.available?.find((value) => matchingModel(value.ref, model))
  if (!entry || entry.disabledReason) throw new Error('ZCode selected model is not available')
  const effort = config.preference.effort
  const level = effort === 'default' ? entry.reasoning?.defaultLevel : effort === 'none' ? 'disabled' : effort
  if (level !== undefined && !entry.reasoning?.levels?.some((choice) => choice.value === level))
    throw new Error('ZCode selected reasoning level is not available')
  return { ...model, ...(level === undefined ? {} : { options: { reasoningLevel: level } }) }
}
function confirmSelection(snapshot, model, mode) {
  const observed = snapshot?.settings?.model?.current
  if (
    !matchingModel(observed, model) ||
    (model.options && observed?.options?.reasoningLevel !== model.options.reasoningLevel)
  )
    throw new Error('ZCode selected model or reasoning level was not confirmed')
  if (snapshot?.settings?.mode?.current !== mode) throw new Error('ZCode permission mode was not confirmed')
}

/** ZCode's own NDJSON has no JSON-RPC version field and send returns admission only. */
export async function runNativeZcode(config, io) {
  const slash = config.preference.model.indexOf('/')
  if (slash < 1) throw new Error('ZCode requires a provider/model selection')
  const model = {
    providerId: config.preference.model.slice(0, slash),
    modelId: config.preference.model.slice(slash + 1),
  }
  const account = nativeAccount(config, model)
  const memory = nativeMemory(config)
  let mode = config.mode === 'plan' ? 'plan' : config.access === 'read-only' ? 'build' : config.access === 'danger-full-access' ? 'yolo' : 'edit'
  const denyIndex = config.argv.indexOf('--disallowedTools')
  const toolDenylist = denyIndex >= 0 ? config.argv[denyIndex + 1]?.split(',').filter(Boolean) : []
  const inputId = randomUUID()
  let peer,
    sessionId,
    active = false,
    ended = false,
    turnId,
    terminal,
    failed,
    denied = false,
    response = '',
    thought = '',
    step = 0,
    assistantStep = 0,
    assistantSegmentOpen = false,
    thoughtStep = 0,
    thoughtMessageId
  let latestContextBinding, lastContextObservation
  const emitContext = observation => {
    if (!observation) return
    const signature = JSON.stringify(observation)
    if (signature === lastContextObservation) return
    lastContextObservation = signature
    io.native(observation)
  }
  const flushContext = () => {
    if (!latestContextBinding) return
    const storage = config.env?.ZCODE_STORAGE_DIR
    if (typeof storage !== 'string' || !isAbsolute(storage) || basename(storage) !== 'storage') return
    const [observation] = readZcodeContextInspections({ nativeDirectory: dirname(storage), bindings: [latestContextBinding] })
    emitContext(observation)
  }
  const responses = new ZcodeResponseTracker((event) => io.event(event))
  const toolInputs = new ZcodeToolInputs()
  const finishThought = () => {
    if (!thought) return
    responses.emit({ kind: 'reasoning', step: thoughtStep++, text: 'ZCode 公开思考',
      detail: thought, state: 'COMPLETED' }, thoughtMessageId, 'reasoning', 0)
    thought = ''
    thoughtMessageId = undefined
  }
  const seen = new Set(),
    tools = new Map(),
    // Tool calls whose permission was denied; their failure is the denial itself.
    deniedTools = new Set(),
    // Calls whose own result frame already reported the failure the batch counts again.
    failedTools = new Set(),
    early = [],
    toolOutcomes = createToolOutcomes()
  const failure = (message) => {
    failed ??= message
  }
  const receive = (message) => {
    // Runtime-header requests may contain native account metadata. No reply secrets enter telemetry.
    if (
      !['interaction/requestProviderRuntimeHeaders', 'interaction/requestOfficialMcpAuthHeaders'].includes(
        message?.method,
      )
    )
      io.native(message?.params?.type === 'tool.updated' && message.params.payload?.result !== undefined
        ? { ...message, params: { ...message.params, payload: { ...message.params.payload,
          result: summarizeNativeRecord(message.params.payload.result, 0) } } } : message)
    if (!isRecord(message) || message.jsonrpc !== undefined) {
      failure('Invalid ZCode NDJSON envelope')
      throw new Error('Invalid ZCode NDJSON envelope')
    }
    if (!nonempty(message.method)) return
    if (!peer) {
      early.push(message)
      return
    }
    if (message.id !== undefined) {
      let result
      if (message.method === 'session/requestRuntimePreferences')
        result = {
          nativeSearchEnhancementsEnabled: false,
          memoryEnabled: memory,
          askUserQuestionAutoResolutionEnabled: false,
        }
      else if (message.method === 'interaction/requestPermission') {
        const deny = () => {
          if (active && message.params?.sessionId === sessionId) {
            denied = true
            if (nonempty(message.params.toolCallId)) deniedTools.add(message.params.toolCallId)
            io.event({ kind: 'diagnostic', text: 'ZCode 额外权限请求已拒绝' })
          }
          return { decision: 'deny', reason: 'DSH 未批准此授权' }
        }
        if (!(active && message.params?.sessionId === sessionId)) result = deny()
        else {
          // The Host decides without blocking this reader. The reverse reply has
          // no confirmed session scope, and permissionUpdates would persist a
          // project rule, so only a plain allow is sent.
          void io.approval(zcodeApprovalRequest(message.params)).then((answer) => {
            if (answer.decision === 'deny') return peer.send({ id: message.id, result: deny() })
            io.event({ kind: 'diagnostic', text: 'ZCode 额外权限请求已批准' })
            return peer.send({ id: message.id, result: { decision: 'allow' } })
          }).catch(() => failure('ZCode 授权回复未送达'))
          return
        }
      } else if (message.method === 'interaction/requestUserInput') {
        result = { action: 'cancel', reason: 'CLI Worker 无额外交互输入' }
        if (active && message.params?.sessionId === sessionId) failure('ZCode 需要额外交互输入')
      } else if (message.method === 'interaction/requestProviderRuntimeHeaders') {
        const params = message.params,
          access = params?.accountAccess
        const authorized =
          account &&
          active &&
          !ended &&
          !io.signal.aborted &&
          params?.sessionId === sessionId &&
          params.workspace?.workspaceKey === config.project &&
          params.workspace?.workspacePath === config.project &&
          params.providerId === model.providerId &&
          matchingModel(params.modelSelection, model) &&
          params.reason === 'model-request' &&
          access?.type === account.accountAccess.type &&
          access.accountType === account.accountAccess.accountType &&
          access.mode === account.accountAccess.mode &&
          access.entitled === true &&
          (!params.turnId || params.turnId === turnId)
        return (async () => {
          let response = { headersApplied: false }
          if (authorized) {
            try {
              await confirmAccount(account, { ...config, signal: io.signal })
              if (io.signal.aborted) throw new Error()
              response = { headersApplied: true, requestAuth: { apiKey: account.binding.key } }
            } catch {
              failure('ZCode 当前账号身份、凭据或授权时效已变化')
            }
          } else if (active) failure('ZCode 原生账号鉴权请求超出所选路由')
          await peer.send({ id: message.id, result: response })
        })()
      }
      return result
        ? peer.send({ id: message.id, result })
        : peer.send({ id: message.id, error: { code: -32601, message: 'Client capability unavailable' } })
    }
    if (!active || ended || message.method !== 'session/event') return
    const event = message.params
    if (!isRecord(event) || event.sessionId !== sessionId) return
    const payload = isRecord(event.payload) ? event.payload : {}
    if (
      event.type === 'session.updated' &&
      nonempty(payload.providerId) &&
      nonempty(payload.modelId) &&
      !matchingModel(payload, model)
    ) {
      failure('ZCode 实际模型与所选模型不匹配')
      cancel()
      return
    }
    if (payload.inputId && payload.inputId !== inputId) return
    if (event.type === 'turn.started') {
      if (!nonempty(event.turnId)) {
        failure('ZCode turn identity missing')
        return
      }
      if (turnId && turnId !== event.turnId) return
      turnId = event.turnId
    }
    if (!turnId || event.turnId !== turnId) return
    if (nonempty(event.eventId)) {
      if (seen.has(event.eventId)) return
      seen.add(event.eventId)
    }
    const contextBinding = zcodeContextBinding(event, { sessionId, turnId, model: config.preference.model })
    if (contextBinding) {
      latestContextBinding = contextBinding
      emitContext(unknownZcodeContextInspection(contextBinding))
    } else if (payload.type === 'model_request_completed' && payload.requestId === latestContextBinding?.requestId) {
      flushContext()
    }
    if (event.type === 'session.updated' && payload.querySource === 'main_turn' &&
      typeof payload.content === 'string' && Number.isSafeInteger(payload.toolCallCount) &&
      typeof payload.stopReason === 'string') {
      finishThought()
      flushContext()
      responses.complete(payload)
      assistantSegmentOpen = false
      return
    }
    if (event.type === 'model.streaming' && payload.kind === 'text_delta') {
      finishThought()
      if (typeof payload.delta !== 'string') {
        failure('Invalid ZCode text delta')
        return
      }
      response += payload.delta
      if (payload.delta.trim()) toolOutcomes.succeeded()
      if (payload.delta) {
        if (!assistantSegmentOpen) { assistantStep++; assistantSegmentOpen = true }
        responses.emit({ kind: 'assistant', step: assistantStep, text: payload.delta },
          payload.assistantMessageId, 'text', 1)
      }
    } else if (
      event.type === 'model.streaming' &&
      payload.kind === 'reasoning_delta' &&
      typeof payload.delta === 'string'
    ) {
      if (payload.delta) assistantSegmentOpen = false
      if (thought && thoughtMessageId !== payload.assistantMessageId) finishThought()
      thoughtMessageId = payload.assistantMessageId
      thought += payload.delta
      responses.emit({ kind: 'reasoning', step: thoughtStep, text: 'ZCode 公开思考',
        delta: payload.delta, state: 'RUNNING' }, thoughtMessageId, 'reasoning', 0)
    } else if (event.type === 'model.streaming' && payload.kind === 'tool_call') {
      // This frame carries a complete structured input even when done=false.
      // Never parse/concatenate text deltas or execute the observed tool.
      toolInputs.remember(payload)
    } else if (event.type === 'tool.updated') {
      finishThought()
      if (payload.kind === 'batch') {
        const batchIds = Array.isArray(payload.toolCallIds) ? payload.toolCallIds : []
        const deniedInBatch = batchIds.filter((id) => deniedTools.has(id))
        const known = deniedInBatch.length + batchIds.filter((id) => failedTools.has(id)).length
        const errors = Number.isSafeInteger(payload.errorCount) ? payload.errorCount : 0
        // Only failures no call result reported are new; the same batch replayed counts once.
        for (let index = known; index < errors; index++) toolOutcomes.failed(`batch:${batchIds.join(',')}:${index}`)
        // A denied call gets no result frame of its own; the batch closes it.
        for (const id of deniedInBatch) {
          const value = tools.get(id)
          if (!value || value.done) continue
          tools.set(id, { ...value, done: true })
          responses.tool({ kind: 'tool', step: value.step, text: value.name, state: 'FAILED', detail: JSON.stringify(payload),
            toolCall: { callId: id, name: value.name, ...(value.input === undefined ? {} : { input: value.input }) } })
        }
      } else if (nonempty(payload.toolCallId)) {
        assistantSegmentOpen = false
        const previous = tools.get(payload.toolCallId) ?? { step: step++, name: '工具', done: false }
        const done = ['result', 'error'].includes(payload.kind)
        const error = payload.kind === 'error' || (done && payload.result?.success !== true)
        const assistantMessageId = payload.assistantMessageId ?? previous.assistantMessageId
        const cachedInput = toolInputs.read(payload.toolCallId, assistantMessageId)
        const explicitInput = Object.hasOwn(payload, 'input')
        const input = Object.hasOwn(payload, 'input') ? payload.input
          : cachedInput ?? (!previous.inputFromStream && previous.assistantMessageId === assistantMessageId ? previous.input : undefined)
        const value = { ...previous, name: payload.toolName ?? previous.name, done, assistantMessageId, input,
          inputFromStream: explicitInput ? false : cachedInput !== undefined || previous.inputFromStream }
        const { input: _input, result, ...metadata } = payload
        const prior = previous.output ?? ''
        const increment = !done && typeof result === 'string' && typeof prior === 'string' && result.startsWith(prior)
        if (Object.hasOwn(payload, 'result')) value.output = result
        tools.set(payload.toolCallId, value)
        if (error && !deniedTools.has(payload.toolCallId)) {
          failedTools.add(payload.toolCallId)
          toolOutcomes.failed(payload.toolCallId)
        } else if (done && !error && !previous.done) toolOutcomes.succeeded()
        responses.tool({
          kind: 'tool',
          step: value.step,
          text: value.name,
          state: done ? (error ? 'FAILED' : 'COMPLETED') : 'RUNNING',
          detail: JSON.stringify(metadata),
          ...(increment ? { delta: result.slice(prior.length) } : {}),
          toolCall: { callId: payload.toolCallId,
            ...(nonempty(payload.toolName) ? { name: payload.toolName } : {}),
            ...(value.input === undefined ? {} : { input: value.input }),
            ...(!increment && (result !== undefined || done) && value.output !== undefined ? { output: value.output } : {}) },
        })
      }
    } else if (
      event.type === 'permission.resolved' &&
      (payload.decision === 'deny' || payload.decision?.decision === 'deny')
    ) {
      // The CLI may recover from a denial; the turn then ends as unverified, not failed.
      denied = true
      if (nonempty(payload.toolCallId)) deniedTools.add(payload.toolCallId)
    } else if (event.type === 'turn.failed') {
      terminal = event
      failure('ZCode 轮次执行失败')
    } else if (event.type === 'turn.completed') {
      terminal = event
      if (payload.resultType !== 'success') failure(`ZCode 未成功完成（${String(payload.resultType)}）`)
      if (typeof payload.response === 'string') response = payload.response
    }
  }
  const cancel = () => {
    if (peer && sessionId && active && !ended)
      void peer.request('session/stop', { sessionId }, { jsonrpc: false, timeoutMs: 1500 }).catch(() => {})
  }
  io.signal.addEventListener('abort', cancel, { once: true })
  try {
    io.signal.throwIfAborted()
    peer = await io.openStdio(zcodeAppServerArgv(config), {
      env: config.env,
      cwd: config.project,
      onMessage: receive,
    })
    for (const message of early.splice(0)) {
      // Before initialization only runtime preferences are expected.
      if (message.id !== undefined)
        await peer.send({
          id: message.id,
          ...(message.method === 'session/requestRuntimePreferences'
            ? {
                result: {
                  nativeSearchEnhancementsEnabled: false,
                  memoryEnabled: memory,
                  askUserQuestionAutoResolutionEnabled: false,
                },
              }
            : { error: { code: -32601, message: 'Client not initialized' } }),
        })
    }
    const capability = await peer.request('runtime/capabilities', {}, { jsonrpc: false })
    if (!isRecord(capability)) throw new Error('ZCode capabilities are unavailable')
    if (account) {
      await confirmAccount(account, { ...config, signal: io.signal })
      const applied = await peer.request('provider/updateAccountConfig', account.snapshot, { jsonrpc: false })
      if (
        applied?.receivedRevision !== account.snapshot.revision ||
        applied.providerCount !== 1 ||
        !['received', 'unchanged'].includes(applied.status)
      )
        throw new Error('ZCode 原生账号状态未被确认')
    }
    const common = { mcpServers: nativeHarnessMcpServers({ ...config, cli: 'zcode' }), toolDenylist, offPeakToolEnabled: false, dynamicWorkflowEnabled: false }
    let snapshot = config.conversationId
      ? await peer.request(
          'session/resume',
          { ...common, sessionId: config.conversationId },
          { jsonrpc: false },
        )
      : await peer.request(
          'session/create',
          {
            ...common,
            workspace: { workspaceKey: config.project, workspacePath: config.project },
            mode: mode === 'plan' ? 'plan' : 'build',
            // 0.16.9 converts an initial model to a provider/model string and
            // discards required reasoning options. prepareZCode already set the
            // complete private default; setModel + readback below are mandatory
            // before any prompt, even when the created snapshot has a default.
            titleGenerationEnabled: false,
          },
          { jsonrpc: false },
        )
    sessionId = readIdentity(snapshot, config.conversationId, config.project)
    const selection = selectedModel(config, snapshot, model)
    await peer.request(
      'session/setModel',
      { sessionId, model: selection, persistAsWorkspaceLastUsed: false },
      { jsonrpc: false },
    )
    const modes = mode === 'yolo' ? ['yolo', 'edit', 'build'] : mode === 'edit' ? ['edit', 'build'] : [mode]
    for (const candidate of modes) {
      try {
        await peer.request('session/setMode', { sessionId, mode: candidate }, { jsonrpc: false })
        snapshot = await peer.request('session/read', { sessionId, messageLimit: 1 }, { jsonrpc: false })
        readIdentity(snapshot, sessionId, config.project)
        confirmSelection(snapshot, selection, candidate)
        if (candidate !== mode) io.event({ kind: 'diagnostic', text: candidate === 'build'
          ? 'ZCode 原生权限模式不可用，本轮按询问运行' : 'ZCode 原生完全权限不可用，本轮按仅工作区编辑运行' })
        mode = candidate
        break
      } catch (error) {
        io.signal?.throwIfAborted()
        if (candidate === modes.at(-1)) throw new Error('ZCode 原生权限模式无法确认，已拒绝启动', { cause: error })
      }
    }
    if (snapshot.runtime?.activeTurnId || snapshot.projection?.status === 'running')
      throw new Error('ZCode session is already running')
    const subscription = await peer.request(
      'session/subscribe',
      { sessionId, deliveryKind: 'desktop-continuous' },
      { jsonrpc: false },
    )
    if (subscription?.sessionId !== sessionId) throw new Error('ZCode event subscription session mismatch')
    io.signal.throwIfAborted()
    if (failed) throw new Error(failed)
    io.session(sessionId, config.preference.model)
    io.event({ kind: 'status', text: 'ZCode 原生模型已确认' })
    active = true
    const accepted = await peer.request(
      'session/send',
      {
        sessionId,
        content: await nativeAttachmentInput('text', config.prompt, config.attachments, io.signal),
        inputId,
        queryId: inputId,
        modelSelection: selection,
        toolDenylist,
      },
      { jsonrpc: false },
    )
    if (accepted?.accepted !== true || accepted.sessionId !== sessionId)
      throw new Error('ZCode did not accept the selected session prompt')
    await peer.waitFor(
      (message) =>
        message.method === 'state.updated' &&
        message.params?.sessionId === sessionId &&
        ['prompt_completed', 'prompt_failed'].includes(message.params.reason),
      { timeoutMs: config.timeoutMs },
    )
    if (!terminal)
      await peer.waitFor(
        (message) =>
          message.method === 'session/event' &&
          message.params?.sessionId === sessionId &&
          message.params?.turnId === turnId &&
          ['turn.completed', 'turn.failed'].includes(message.params.type) &&
          (!message.params.payload?.inputId || message.params.payload.inputId === inputId),
        { timeoutMs: config.timeoutMs },
      )
    ended = true
    flushContext()
    finishThought()
    responses.finish()
    if (!terminal) failure('ZCode 缺少本轮终态')
    snapshot = await peer.request('session/read', { sessionId, messageLimit: 1 }, { jsonrpc: false })
    readIdentity(snapshot, sessionId, config.project)
    confirmSelection(snapshot, selection, mode)
    if (
      snapshot.runtime?.activeTurnId ||
      snapshot.runtime?.pendingRequestIds?.length ||
      ['running', 'waiting', 'error'].includes(snapshot.projection?.status) ||
      snapshot.projection?.pendingPermissions?.length ||
      snapshot.projection?.activeToolCalls?.length ||
      [...tools.values()].some((tool) => !tool.done)
    )
      failure('ZCode 结束状态尚未清空或存在失败')
    flushContext()
    if (io.signal.aborted) failure('任务已停止')
    const closed = await peer.request('session/close', { sessionId }, { jsonrpc: false })
    if (closed?.closed !== true) throw new Error('ZCode session did not close')
    if (failed) io.result('ERROR', response, failed, 'run')
    else toolOutcomes.settle(io, response, 'run', denied)
  } finally {
    io.signal.removeEventListener('abort', cancel)
    active = false
    if (peer) {
      peer.end()
      await peer.close()
    }
  }
}
import { nativeAttachmentInput } from './native-attachments.mjs'

/** ZCode 0.16.9 message targets include the assistant turn and need no checkpoint. */
export async function forkNativeZcode(config, io) {
  const slash = config.preference.model.indexOf('/')
  const model = { providerId: config.preference.model.slice(0, slash), modelId: config.preference.model.slice(slash + 1) }
  const account = nativeAccount(config, model)
  // A branch operation sends no model task; only strip the variable.
  nativeMemory(config)
  const peer = await io.openStdio(zcodeAppServerArgv(config), { env: config.env, cwd: config.project })
  const unsubscribe = peer.onMessage((message) => {
    if (message.id !== undefined && message.method)
      return peer.send({ id: message.id, ...(message.method === 'session/requestRuntimePreferences'
        ? { result: { nativeSearchEnhancementsEnabled: false, memoryEnabled: false, askUserQuestionAutoResolutionEnabled: false } }
        : { error: { code: -32601, message: '分支不接受交互请求' } }) })
  })
  try {
    if (config.forkOperation === 'delete') {
      // session/close releases runtime ownership, not durable history.
      throw new Error('ZCode 未公开永久删除会话接口，原生分支资源保留待人工清理')
    }
    await peer.request('runtime/capabilities', {}, { jsonrpc: false })
    if (account) {
      await confirmAccount(account, { ...config, signal: io.signal })
      await peer.request('provider/updateAccountConfig', account.snapshot, { jsonrpc: false })
    }
    const source = await peer.request('session/resume', { sessionId: config.conversationId, mcpServers: [], offPeakToolEnabled: false, dynamicWorkflowEnabled: false }, { jsonrpc: false })
    readIdentity(source, config.conversationId, config.project)
    let messageId = config.forkAt?.messageId
    if (!messageId) {
      // session/messages returns the active conversation chain in order. Native
      // forkWorkspaceAtMessage -> forkConversationFromMessage copies through the
      // assistant (including sibling responses), even with no workspace edits.
      const history = await peer.request('session/messages', { sessionId: config.conversationId }, { jsonrpc: false })
      messageId = Array.isArray(history?.messages)
        ? history.messages.findLast((message) => message?.info?.role === 'assistant')?.info?.id : undefined
      if (!nonempty(messageId)) throw new Error('ZCode 当前会话没有可分支的原生助手消息，暂无法分支')
    }
    const result = await peer.request('session/fork', {
      sessionId: config.conversationId,
      target: { kind: 'message', messageId },
    }, { jsonrpc: false })
    if (!nonempty(result?.forkedSessionId) || result.forkedSessionId === config.conversationId)
      throw new Error('ZCode 分支回执没有新的原生会话 ID')
    io.native({ type: 'cliworker.fork_created', id: result.forkedSessionId })
    await peer.request('session/close', { sessionId: result.forkedSessionId }, { jsonrpc: false })
    io.result('SUCCESS', '')
  } finally { unsubscribe(); await peer.close() }
}
