import { summarizeNativeRecord } from './native-transport.mjs'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { realpath } from 'node:fs/promises'
import { nativeHttpEndpoint, startHttpContextRelay } from './http-context-relay.mjs'
import { NativeBlockResponses, sessionHttpResponseUsage, sessionHttpSessionUsage } from './http-rpc-response.mjs'
import { HARNESS_MCP_SERVER, nativeHarnessGuidance } from './native-harness-injection.mjs'
import { createToolOutcomes } from './native-tool-outcomes.mjs'
import { readNativeHarnessConnection } from './native-harness-mcp.mjs'
import {
  deferred,
  closeServer,
  httpJson,
  httpLimits,
  object,
  openSse,
  startSessionServer,
  string,
} from './native-http.mjs'

function selection(config) {
  const slash = config.preference.model.indexOf('/')
  if (slash < 1 || !config.preference.model.slice(slash + 1)) throw new Error('请明确选择原生提供商和模型')
  return {
    providerID: config.preference.model.slice(0, slash),
    modelID: config.preference.model.slice(slash + 1),
  }
}
const HTTP_KINDS = { bash: 'command', edit: 'file', write: 'file', webfetch: 'network', websearch: 'network' }
/** Public summary of one permission.asked event for the DSH prompt. */
export function sessionHttpApprovalRequest(properties) {
  const permission = string(properties.permission) ? properties.permission : '工具调用'
  const patterns = Array.isArray(properties.patterns) ? properties.patterns.filter(string) : []
  return {
    kind: HTTP_KINDS[permission] ?? 'tool',
    summary: permission.slice(0, 500),
    ...(patterns.length ? { detail: patterns.join('\n').slice(0, 4000) } : {}),
    allowSession: false,
  }
}
export function serverConfiguration(config, cli) {
  const name = cli === 'mimo' ? 'MIMOCODE' : 'OPENCODE'
  const environment = config.env ?? process.env
  const raw = environment[`${name}_CONFIG_CONTENT`]
  const previous = raw ? JSON.parse(raw) : {}
  if (!object(previous)) throw new Error('原生 HTTP 配置无效')
  // 完全权限 allows every native tool; task/skill/question stay off as before.
  const full = config.mode !== 'plan' && config.access === 'danger-full-access'
  const permission = {
    '*': full ? 'allow' : 'ask',
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    edit: config.mode === 'plan' ? 'deny' : 'allow',
    bash: config.mode === 'plan' ? 'deny' : full ? 'allow' : 'ask',
    task: 'deny',
    skill: 'deny',
    question: 'deny',
    ...(readNativeHarnessConnection(environment)?.executionReady === true ? { [`${HARNESS_MCP_SERVER}_*`]: 'allow' } : {}),
  }
  return {
    ...config,
    env: {
      ...environment,
      [`${name}_CONFIG_CONTENT`]: JSON.stringify({
        ...previous,
        model: config.preference.model,
        small_model: config.preference.model,
        enabled_providers: [selection(config).providerID],
        permission,
      }),
      [`${name}_PERMISSION`]: JSON.stringify(permission),
    },
  }
}
function assertModel(catalog, selected, effort) {
  if (!object(catalog) || !Array.isArray(catalog.all)) throw new Error('原生 HTTP 模型目录无效')
  const provider = catalog.all.find((row) => row?.id === selected.providerID)
  const model = provider?.models?.[selected.modelID]
  if (!object(model) || model.id !== selected.modelID) throw new Error('所选模型不在原生 HTTP 目录中')
  if (effort !== 'default' && !Object.hasOwn(model.variants ?? {}, effort))
    throw new Error('所选强度不在原生 HTTP 模型能力中')
  return model
}
function textParts(parts) {
  return parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
}

/** Shared wire subset verified separately against OpenCode OpenAPI and MiMo 0.1.15 SDK. */
export async function runNativeSessionHttp(original, io, cli) {
  if (!['plan', 'accept-edits'].includes(original.mode)) throw new Error('原生 HTTP 权限模式无效')
  // MiMo 0.1.15 Identifier.create uses g + 8-byte (milliseconds * 4096 +
  // counter) + 9 base62 characters. Its prompt loop compares message IDs to
  // detect an already answered user; random hex IDs sort before old replies.
  const userID = cli === 'mimo'
    ? `msg_g${(BigInt(Date.now()) * 4096n).toString(16).padStart(16, '0')}${Array.from(randomBytes(9), (byte) => '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'[byte % 62]).join('')}`
    : `msg_${randomBytes(18).toString('hex')}`
  let contextRelay
  let config, selected, limit, server
  try {
    config = serverConfiguration(original, cli)
    selected = selection(config)
    limit = httpLimits(config)
    server = await startSessionServer(config, io, cli)
  } catch (error) { throw error }
  const streamAbort = new AbortController(),
    deadline = AbortSignal.timeout(config.timeoutMs ?? 600000)
  const signal = io.signal ? AbortSignal.any([io.signal, deadline]) : deadline
  const request = (path, method = 'GET', body, ownSignal = signal) =>
    httpJson(server.base, path, {
      headers: server.headers,
      method,
      body,
      signal: ownSignal,
      limit,
    })
  const query = `?directory=${encodeURIComponent(config.project)}`
  let sessionID,
    stream,
    streamTask,
    submitted = false,
    failure,
    response = '',
    stopped = false,
    stopPromise
  const finished = deferred(),
    ownMessages = new Set(),
    foreignMessages = new Set(),
    pending = []
  const emitSessionUsage = (session) => {
    if (cli !== 'opencode' || session?.id !== sessionID) return
    const usage = sessionHttpSessionUsage(session.tokens)
    if (usage) io.native({ type: 'cliworker.session_usage', cli,
      source: 'opencode.session.get', sessionId: sessionID, scope: 'session', usage })
  }
  const readSessionUsage = async () => {
    if (cli !== 'opencode') return
    try {
      const session = await request(`/session/${encodeURIComponent(sessionID)}${query}`, 'GET', undefined,
        AbortSignal.any([signal, AbortSignal.timeout(750)]))
      if (session?.id !== sessionID || (session.directory &&
        (await realpath(resolve(session.directory))) !== (await realpath(resolve(config.project))))) return
      emitSessionUsage(session)
    } catch { /* Optional native snapshot cannot change the generation result. */ }
  }
  const parts = new Map(),
    messages = new Map(),
    assistantSteps = new Map(),
    assistantText = new Map(),
    toolSteps = new Map(),
    reasoningSteps = new Map(),
    reasoningText = new Map()
  const responses = new NativeBlockResponses(cli, (event) => io.event(event))
  let activeResponse
  let active = false,
    terminal = false,
    unfinishedTool = false,
    toolOutcomes = createToolOutcomes(),
    permissionDenied = false,
    step = 0
  const abortRun = () =>
    (stopPromise ??= (async () => {
      stopped = true
      if (sessionID && submitted)
        await request(
          `/session/${encodeURIComponent(sessionID)}/abort${query}`,
          'POST',
          {},
          AbortSignal.timeout(5000),
        ).catch(() => {})
      streamAbort.abort()
    })())
  const onAbort = () => {
    finished.reject(new Error('任务已停止'))
    const stopping = abortRun()
    io.trackControl?.(stopping)
    void stopping
  }
  io.signal?.addEventListener('abort', onAbort, { once: true })
  const relevant = (value) =>
    (value?.sessionID ?? value?.info?.sessionID ?? value?.part?.sessionID) === sessionID
  const assistant = (part, text, snapshot = false) => {
    const key = `${part.messageID}:${part.id}`
    const previous = assistantText.get(key) ?? ''
    if (typeof text !== 'string') throw new Error('原生回复内容无效')
    if (snapshot && !text.startsWith(previous) && !previous.startsWith(text))
      throw new Error('原生回复增量与快照冲突')
    const delta = snapshot ? text.slice(previous.length) : text
    const current = snapshot && text.length < previous.length ? previous : snapshot ? text : previous + text
    assistantText.set(key, current)
    if (!assistantSteps.has(key)) assistantSteps.set(key, assistantSteps.size)
    if (delta || (current && Number.isFinite(part.time?.end)))
      responses.event(part.messageID, part.id, { kind: 'assistant', step: assistantSteps.get(key), text: delta,
        ...(Number.isFinite(part.time?.end) ? { state: 'COMPLETED' } : { state: 'RUNNING' }) })
    response += delta
    if (delta.trim()) toolOutcomes.succeeded()
  }
  const reasoning = (part) => {
    const current = reasoningText.get(part.id) ?? ''
    if (!part.text.startsWith(current) && !current.startsWith(part.text))
      throw new Error('原生公开思考快照冲突')
    const detail = part.text.length >= current.length ? part.text : current
    reasoningText.set(part.id, detail)
    if (!detail) return
    if (!reasoningSteps.has(part.id)) reasoningSteps.set(part.id, ++step)
    // Growth since the last shown text is an increment; completion sends one snapshot.
    responses.event(part.messageID, part.id, {
      kind: 'reasoning', step: reasoningSteps.get(part.id), text: '原生公开思考',
      ...(Number.isFinite(part.time?.end) ? { detail } : { delta: detail.slice(current.length) }),
      state: Number.isFinite(part.time?.end) ? 'COMPLETED' : 'RUNNING',
    })
  }
  const tool = (part, previous) => {
    const state = part.state
    if (!object(state) || !['pending', 'running', 'completed', 'error'].includes(state.status))
      throw new Error('原生工具状态无效')
    if (previous?.type === 'tool' && JSON.stringify(previous.state) === JSON.stringify(state)) return
    if (state.status === 'error') toolOutcomes.failed(part.id)
    else if (state.status === 'completed' && previous?.state?.status !== 'completed') toolOutcomes.succeeded()
    if (!toolSteps.has(part.id)) toolSteps.set(part.id, ++step)
    const { input: _input, output, ...metadata } = state
    const prior = previous?.state?.output ?? ''
    const increment = ['pending', 'running'].includes(state.status) && typeof output === 'string' && typeof prior === 'string' && output.startsWith(prior)
    responses.event(part.messageID, part.id, {
      kind: 'tool', text: part.tool ?? '工具', step: toolSteps.get(part.id),
      state: state.status === 'completed' ? 'COMPLETED' : state.status === 'error' ? 'FAILED' : 'RUNNING',
      detail: JSON.stringify(metadata),
      ...(increment ? { delta: output.slice(prior.length) } : {}),
      toolCall: { callId: typeof part.callID === 'string' ? part.callID : part.id,
        ...(typeof part.tool === 'string' ? { name: part.tool } : {}),
        ...(Object.hasOwn(state, 'input') ? { input: state.input } : {}),
        ...(!increment && Object.hasOwn(state, 'output') ? { output } : {}),
        ...(typeof state.input?.command === 'string' ? { command: state.input.command } : {}) },
    })
  }
  async function apply(event) {
    const properties = event.properties
    if (!object(properties) || !relevant(properties)) return
    if (event.type === 'session.error') throw new Error('原生 HTTP 会话报告执行错误')
    if (event.type === 'permission.asked' || event.type === 'question.asked') {
      if (terminal || !submitted) throw new Error('轮次之外收到原生审批请求')
      if (!string(properties.id)) throw new Error('原生审批身份缺失')
      if (event.type === 'permission.asked') {
        // The Host decides from the DSH preset and user. `always` outlives this
        // session in some builds, so only a one-time allow is sent.
        const answer = await io.approval(sessionHttpApprovalRequest(properties))
        if (answer.decision !== 'deny') {
          io.event({ kind: 'diagnostic', text: '原生额外授权已批准' })
          await request(`/permission/${encodeURIComponent(properties.id)}/reply${query}`, 'POST', { reply: 'once' })
          return
        }
      }
      permissionDenied = true
      io.event({ kind: 'diagnostic', text: '原生额外授权已拒绝', detail: JSON.stringify(properties) })
      await request(
        event.type === 'permission.asked'
          ? `/permission/${encodeURIComponent(properties.id)}/reply${query}`
          : `/question/${encodeURIComponent(properties.id)}/reject${query}`,
        'POST',
        event.type === 'permission.asked'
          ? { reply: 'reject', message: 'DSH 未批准此授权。' }
          : {},
      )
      return
    }
    if (event.type === 'message.updated') {
      const info = properties.info
      if (!object(info) || info.sessionID !== sessionID || !string(info.id))
        throw new Error('原生消息身份无效')
      if (info.role !== 'assistant' || info.parentID !== userID) {
        foreignMessages.add(info.id)
        return
      }
      if (terminal) throw new Error('原生终态后收到本轮消息')
      if (info.providerID !== selected.providerID || info.modelID !== selected.modelID)
        throw new Error('原生执行模型与选型不一致')
      if (config.preference.effort !== 'default' && info.variant !== config.preference.effort)
        throw new Error('原生执行强度与选型不一致')
      active = true
      if (activeResponse && activeResponse !== info.id) {
        const previous = messages.get(activeResponse)
        responses.finish(activeResponse, Number.isFinite(previous?.time?.completed) && !previous.error
          ? sessionHttpResponseUsage(previous.tokens) : undefined)
      }
      activeResponse = info.id
      ownMessages.add(info.id)
      messages.set(info.id, info)
      if (info.error) failure ??= '原生模型消息包含错误'
      io.native({ ...event, type: 'message.updated' })
      const matching = pending.filter(
        (waiting) => (waiting.properties.messageID ?? waiting.properties.part?.messageID) === info.id,
      )
      for (let index = pending.length - 1; index >= 0; index--)
        if (matching.includes(pending[index])) pending.splice(index, 1)
      for (const waiting of matching) await apply(waiting)
      return
    }
    if (event.type === 'message.part.updated' || event.type === 'message.part.delta') {
      const part = properties.part,
        messageID = properties.messageID ?? part?.messageID
      if (!string(messageID)) throw new Error('原生片段缺少消息身份')
      if (foreignMessages.has(messageID)) return
      if (!ownMessages.has(messageID)) {
        if (pending.length >= 256) throw new Error('原生未知消息片段超过限制')
        pending.push(event)
        return
      }
      if (terminal) throw new Error('原生终态后收到本轮内容')
      if (event.type === 'message.part.delta') {
        if (!string(properties.partID) || typeof properties.delta !== 'string')
          throw new Error('原生文本增量无效')
        if (properties.field === 'text') {
          const previous = parts.get(properties.partID)
          if (!previous) throw new Error('原生增量缺少片段类型')
          if (previous.messageID !== messageID) throw new Error('原生增量片段消息身份变化')
          if (properties.delta && Number.isFinite(previous.time?.end)) throw new Error('原生片段完成后仍收到增量')
          if (previous.type === 'text') {
            assistant(previous, properties.delta)
          } else if (previous.type === 'reasoning') {
            const detail = (reasoningText.get(properties.partID) ?? previous.text ?? '') + properties.delta
            reasoningText.set(properties.partID, detail)
            if (!reasoningSteps.has(properties.partID)) reasoningSteps.set(properties.partID, ++step)
            responses.event(messageID, properties.partID, {
              kind: 'reasoning',
              step: reasoningSteps.get(properties.partID),
              text: '原生公开思考',
              delta: properties.delta,
              state: 'RUNNING',
            })
          }
        }
        if (properties.field === 'text') io.native({ type: event.type, properties: {
          sessionID, messageID, partID: properties.partID, field: 'text', delta: properties.delta,
        } })
      } else {
        if (!object(part) || !string(part.id) || part.sessionID !== sessionID)
          throw new Error('原生内容片段无效')
        const previous = parts.get(part.id)
        if (part.messageID !== messageID || (previous && (previous.messageID !== messageID || previous.type !== part.type)))
          throw new Error('原生内容片段身份变化')
        parts.set(part.id, part)
        if (part.type === 'text' && typeof part.text === 'string') {
          assistant(part, part.text, true)
        } else if (part.type === 'reasoning' && typeof part.text === 'string') {
          reasoning(part)
        } else if (part.type === 'tool') {
          tool(part, previous)
        }
        // Provider replay metadata may contain opaque reasoning signatures.
        // Only the explicitly public text/time identity enters our raw stream.
        io.native(part.type === 'reasoning' ? { type: event.type, properties: {
          part: { id: part.id, messageID: part.messageID, sessionID: part.sessionID,
            type: part.type, text: summarizeNativeRecord(part.text, 0), ...(part.time ? { time: part.time } : {}) },
        } } : part.type === 'tool' && part.state?.output !== undefined
          ? { ...event, properties: { ...properties, part: { ...part, state: { ...part.state, output: summarizeNativeRecord(part.state.output, 0) } } } } : event)
      }
      return
    }
    if (event.type === 'session.status' && properties.status?.type === 'busy') active = true
    const idle =
      event.type === 'session.idle' || (event.type === 'session.status' && properties.status?.type === 'idle')
    if (idle && submitted && active) {
      if (terminal) return
      terminal = true
      for (const [id, detail] of reasoningText)
        if (detail && !responses.completed(parts.get(id).messageID))
          responses.event(parts.get(id).messageID, id, {
            kind: 'reasoning',
            step: reasoningSteps.get(id),
            text: '原生公开思考',
            detail,
            state: 'COMPLETED',
          })
      finished.resolve()
      return true
    }
  }
  try {
    const doc = await request('/doc')
    const incompleteSchema =
      !object(doc.paths) ||
      !doc.paths['/event'] ||
      !Object.keys(doc.paths).some((path) => /\/session\/\{[^}]+\}\/prompt_async$/.test(path)) ||
      !Object.keys(doc.paths).some((path) => /\/session\/\{[^}]+\}\/abort$/.test(path))
    if (incompleteSchema) {
      // MiMo 0.1.15 wraps subroutes in an error handler and omits their OpenAPI
      // metadata. Its installed SDK and zero-prompt native route probe establish
      // the wire subset; do not accept an arbitrary incomplete schema/version.
      const health = cli === 'mimo' ? await request('/global/health') : undefined
      const keys = object(doc.paths) ? Object.keys(doc.paths).sort() : []
      if (
        cli !== 'mimo' ||
        health?.healthy !== true ||
        health.version !== '0.1.15' ||
        doc.info?.version !== '0.0.3' ||
        JSON.stringify(keys) !== JSON.stringify(['/auth/{providerID}', '/log'])
      )
        throw new Error('安装版缺少所需原生 HTTP 能力')
      if (!Array.isArray(await request(`/session${query}`))) throw new Error('MiMo 会话能力核验失败')
      io.event({
        kind: 'diagnostic',
        text: 'MiMo 0.1.15 使用已核验的原生 HTTP 接口；该版 OpenAPI 漏列子路由。',
      })
    }
    let catalog = await request(`/provider${query}`)
    let model = assertModel(catalog, selected, config.preference.effort)
    // Inspect the native effective route without mutating native config files.
    // PURE/HOME/data/cwd/permissions stay exactly as in the original launch.
    let effective
    try { effective = await request(`/config${query}`) } catch { /* Unsupported metadata leaves request composition unknown. */ }
    const provider = catalog.all.find(row => row?.id === selected.providerID)
    const endpoint = nativeHttpEndpoint(provider, model, effective, selected)
    if (endpoint && object(effective)) {
      const originalServer = server, originalConfig = config
      let candidate, relay, originalStopped = false
      try {
        relay = await startHttpContextRelay(config, cli, selected, endpoint, record => io.native(record))
        config = serverConfiguration(relay.config, cli)
        await closeServer(originalServer.managed)
        originalStopped = true
        candidate = await startSessionServer(config, io, cli)
        server = candidate
        const routedConfig = await request(`/config${query}`)
        catalog = await request(`/provider${query}`)
        const routedModel = assertModel(catalog, selected, config.preference.effort)
        const routedProvider = catalog.all.find(row => row?.id === selected.providerID)
        const routedEndpoint = nativeHttpEndpoint(routedProvider, routedModel, routedConfig, selected)
        if (routedEndpoint?.url !== relay.baseURL || JSON.stringify(routedConfig.permission) !== JSON.stringify(effective.permission))
          throw new Error('原生有效路由或权限未保留，未启用上下文观察')
        model = routedModel
        contextRelay = relay
        io.native({ type: 'cliworker.http_context_route', cli, source: `${cli}.native-provider.run-only-loopback`,
          homePreserved: true, dataPreserved: true, purePreserved: true, permissionsPreserved: true })
      } catch {
        if (candidate) await closeServer(candidate.managed)
        await relay?.close()
        config = originalConfig
        server = originalStopped ? await startSessionServer(originalConfig, io, cli) : originalServer
        // A refused optional route never substitutes another provider or model.
      }
    }
    if (Number.isSafeInteger(model.limit?.context) && model.limit.context > 0)
      io.native({ type: 'cliworker.model_context', scope: 'model',
        source: `${cli}.provider.limit.context`, ...selected, contextCapacity: model.limit.context })
    let initialSession
    if (config.conversationId) {
      if (!/^ses_[A-Za-z0-9]+$/.test(config.conversationId)) throw new Error('原生会话身份格式无效')
      const session = await request(`/session/${encodeURIComponent(config.conversationId)}${query}`)
      if (
        session?.id !== config.conversationId ||
        (session.directory &&
          (await realpath(resolve(session.directory))) !== (await realpath(resolve(config.project))))
      )
        throw new Error('原生恢复会话身份或目录不一致')
      sessionID = session.id
      initialSession = session
    } else {
      // MiMo's create schema does not accept OpenCode's newer model/agent fields.
      const session = await request(`/session${query}`, 'POST', { title: 'CLI Worker' })
      if (!/^ses_[A-Za-z0-9]+$/.test(session?.id)) throw new Error('原生服务未返回会话身份')
      sessionID = session.id
    }
    io.session(sessionID, config.preference.model)
    const inputParts = await nativeAttachmentInput('http', config.prompt, config.attachments, io.signal)
    contextRelay?.bind(sessionID, userID, inputParts[0].text)
    if (initialSession) emitSessionUsage(initialSession)
    else await readSessionUsage()
    stream = await openSse(server.base, `/event${query}`, {
      headers: server.headers,
      signal: AbortSignal.any([signal, streamAbort.signal]),
      limit,
    })
    streamTask = stream.consume(async (event) => {
      if (!object(event) || !string(event.type)) throw new Error('原生 SSE 事件无效')
      return apply(event)
    })
    streamTask.catch((error) => finished.reject(error))
    io.signal?.throwIfAborted()
    submitted = true
    const guidance = nativeHarnessGuidance({ ...config, cli })
    const accepted = await request(`/session/${encodeURIComponent(sessionID)}/prompt_async${query}`, 'POST', {
      messageID: userID,
      model: selected,
      agent: config.mode === 'plan' ? 'plan' : 'build',
      ...(config.preference.effort === 'default' ? {} : { variant: config.preference.effort }),
      // Added after the native agent prompt; MiMo keeps the first turn's value.
      ...(guidance ? { system: guidance, ...(cli === 'mimo' ? { systemMode: 'append' } : {}) } : {}),
      parts: inputParts,
    })
    if (accepted !== undefined) throw new Error('原生 HTTP 没有返回预期的任务受理回执')
    await Promise.race([
      finished.promise,
      server.managed.done.then(() => {
        throw new Error('原生 HTTP 服务在轮次结束前退出')
      }),
    ])
    await streamTask
    const rows = await request(`/session/${encodeURIComponent(sessionID)}/message${query}`)
    if (!Array.isArray(rows)) throw new Error('原生消息终态无效')
    const current = rows.filter((row) => row?.info?.role === 'assistant' && row.info.parentID === userID)
    if (!current.length) throw new Error('原生轮次缺少助手终态')
    for (const row of current) {
      const info = row.info
      if (
        !string(info.id) || info.sessionID !== sessionID ||
        info.providerID !== selected.providerID ||
        info.modelID !== selected.modelID ||
        !Number.isFinite(info.time?.completed) ||
        info.error ||
        (config.preference.effort !== 'default' && info.variant !== config.preference.effort)
      )
        throw new Error('原生助手终态、身份或选型校验失败')
      if (!Array.isArray(row.parts)) throw new Error('原生消息片段无效')
      for (const part of row.parts) {
        if (!object(part) || !string(part.id) || part.messageID !== info.id || part.sessionID !== sessionID)
          throw new Error('原生终态片段身份无效')
        if (part.type === 'text') {
          const observed = assistantText.get(`${part.messageID}:${part.id}`) ?? ''
          if (typeof part.text !== 'string' || !part.text.startsWith(observed))
            throw new Error('原生最终回复与已观察增量冲突')
          if (responses.completed(info.id)) {
            if (part.text !== observed) throw new Error('原生已完成响应正文发生变化')
          } else assistant(part, part.text, true)
        } else if (part.type === 'reasoning' && typeof part.text === 'string' && !responses.completed(info.id)) {
          reasoning(part)
        } else if (part.type === 'tool') {
          tool(part, parts.get(part.id))
        }
        parts.set(part.id, part)
      }
      responses.finish(info.id, sessionHttpResponseUsage(info.tokens))
      if (row.parts.some((part) => part.type === 'tool' && !['completed', 'error'].includes(part.state?.status)))
        unfinishedTool = true
      io.native({ type: 'message.updated', properties: { info } })
    }
    const last = current.at(-1)
    if (last.info.finish !== 'stop') throw new Error('原生轮次未正常完成')
    if ([...parts.values()].some((part) => part.type === 'tool' && !['completed', 'error'].includes(part.state?.status)))
      unfinishedTool = true

    // The run aggregate is the exact concatenation of public segments. Message
    // boundaries live in their steps; synthetic separators must not enter them.
    const finalText = current.map((row) => textParts(row.parts)).join('')
    response = finalText || response
    await readSessionUsage()
    signal.throwIfAborted()
    if (failure) throw new Error(failure)
    if (unfinishedTool) throw new Error('原生轮次结束时仍有未完成工具')
    if (permissionDenied)
      io.result('UNCERTAIN', response, '原生额外授权已拒绝，但 CLI 报告本轮已完成；结果待核实，请先核查实际产物，不要自动重试', 'run')
    else toolOutcomes.settle(io, response, 'run')
  } catch (error) {
    if (submitted && !terminal && !stopped) await abortRun()
    throw error
  } finally {
    io.signal?.removeEventListener('abort', onAbort)
    try {
      await stopPromise
      streamAbort.abort()
      await stream?.cancel()
      await streamTask?.catch(() => {})
    } finally {
      try { await closeServer(server.managed) }
      finally { await contextRelay?.close() }
    }
  }
}
import { nativeAttachmentInput } from './native-attachments.mjs'

/** OpenCode and MiMo SDK SessionForkData, independently verified on this machine. */
export async function forkNativeSessionHttp(config, io, cli) {
  const server = await startSessionServer(config, io, cli)
  const signal = io.signal
  const request = (path, method, body) => httpJson(server.base, path, {
    method, body, headers: server.headers, signal, limit: httpLimits(config),
  })
  const query = `?directory=${encodeURIComponent(config.project)}`
  try {
    const path = `/session/${encodeURIComponent(config.conversationId)}`
    if (config.forkOperation === 'delete') {
      await request(path + query, 'DELETE')
      io.result('SUCCESS', '')
      return
    }
    const result = await request(path + '/fork' + query, 'POST',
      config.forkAt?.messageId ? { messageID: config.forkAt.messageId } : {})
    if (!string(result?.id) || result.id === config.conversationId)
      throw new Error('原生 HTTP 分支回执没有新的会话 ID')
    io.native({ type: 'cliworker.fork_created', id: result.id })
    io.result('SUCCESS', '')
  } finally { await closeServer(server.managed) }
}
