import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createToolOutcomes } from './native-tool-outcomes.mjs'
import {
  commandPrefix,
  closeServer,
  deferred,
  httpJson,
  httpLimits,
  object,
  openSse,
  string,
  vacantPort,
} from './native-http.mjs'
import { prepareHermesHttpHome } from './native-hermes-home.mjs'
import { prepareHermesObserver } from './hermes-observer.mjs'

/** Atomic status replacement is not listener proof. Discard stale descriptors and poll again. */
export async function readHermesGatewayBinding(path, limit) {
  let file
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const before = await file.stat()
    if (before.nlink === 0) return
    if (!before.isFile() || before.nlink !== 1 || before.size > limit.line)
      throw new Error('Hermes 网关绑定记录无效')
    const contents = await file.readFile('utf8'),
      after = await file.stat(),
      current = await lstat(path)
    if (
      !after.isFile() ||
      after.nlink > 1 ||
      after.size > limit.line ||
      Buffer.byteLength(contents) > limit.line ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.nlink > 1 ||
      current.size > limit.line
    )
      throw new Error('Hermes 网关绑定记录无效')
    if (
      after.nlink === 0 ||
      current.nlink === 0 ||
      current.ino !== before.ino ||
      current.dev !== before.dev ||
      before.ino !== after.ino ||
      before.dev !== after.dev ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      current.size !== after.size ||
      current.mtimeMs !== after.mtimeMs ||
      Buffer.byteLength(contents) !== before.size
    )
      return
    return JSON.parse(contents)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  } finally {
    await file?.close()
  }
}
function selected(config) {
  const pair = JSON.parse(config.preference.model)
  if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(string)) throw new Error('Hermes 模型选型无效')
  return { provider: pair[0], model: pair[1] }
}
export async function startHermesServer(config, io, home, port, key, limit) {
  const ready = deferred(),
    listening = deferred()
  const prefix = commandPrefix(config.argv, config.argv.includes('--in') ? '--in' : 'chat')
  const ownEntry = prefix[1] === '-I' && prefix[2] === fileURLToPath(new URL('./hermes-native-entry.py', import.meta.url))
  const pidNonce = ownEntry ? randomBytes(16).toString('hex') : undefined
  const pidPrefix = pidNonce && `CLIWORKER_HERMES_GATEWAY_PID ${pidNonce} `
  let startupOutput = '', nativePid
  const observe = (chunk) => {
    if (startupOutput === null) return
    startupOutput += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    if (Buffer.byteLength(startupOutput) > (config.maxLineBytes ?? 1048576)) {
      listening.reject(new Error('Hermes API 网关启动输出超过限制'))
      return
    }
    const marker = `API server listening on http://127.0.0.1:${port}`
    // Windows venv python.exe is a redirector: the gateway runs in its child.
    // Only our verified entry can name that interpreter through this owned pipe,
    // using a per-start nonce. A PID read from disk alone is never sufficient.
    for (const line of startupOutput.split(String.fromCharCode(10)).slice(0, -1)) {
      const text = line.trimEnd()
      if (!pidPrefix || !text.startsWith(pidPrefix)) continue
      const value = text.slice(pidPrefix.length), pid = Number(value)
      if (!/^[1-9]\d{0,9}$/.test(value) || !Number.isSafeInteger(pid) || pid > 0xffffffff ||
          (nativePid !== undefined && nativePid !== pid)) {
        listening.reject(new Error('Hermes API 网关进程回执无效'))
        return
      }
      nativePid = pid
    }
    if (
      startupOutput
        .split(String.fromCharCode(10))
        .slice(0, -1)
        .some((line) => line.includes(marker + ' ') || line.endsWith(marker))
    ) {
      startupOutput = null
      listening.resolve()
    }
  }
  const managed = io.spawn([...prefix, 'gateway', 'run', '--external-supervisor', '--no-supervise'], {
    env: { ...home.env, ...(pidNonce ? { CLIWORKER_HERMES_GATEWAY_NONCE: pidNonce } : {}) },
    cwd: config.project,
    // Hermes treats SIGINT as a planned operator stop. An unmarked SIGTERM
    // deliberately exits 1 so service managers restart it, even after a completed run.
    stopSignal: 'SIGINT',
    onStdout: observe,
    onStderr: observe,
  })
  const base = `http://127.0.0.1:${port}`,
    headers = { Authorization: `Bearer ${key}` }
  const startedAt = Date.now()
  const startup = new AbortController(),
    abort = () => startup.abort()
  startup.signal.addEventListener('abort', () => listening.reject(new Error('Hermes API 网关启动已中止')), {
    once: true,
  })
  io.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => startup.abort(), Math.min(config.timeoutMs ?? 30000, 30000))
  managed.done.then(
    () => {
      const error = new Error('Hermes API 网关在就绪前退出')
      listening.reject(error)
      ready.reject(error)
    },
    (error) => {
      listening.reject(error)
      ready.reject(error)
    },
  )
  const nativeBinding = (async () => {
    for (;;) {
      startup.signal.throwIfAborted()
      try {
        const state = await readHermesGatewayBinding(join(home.home, 'gateway_state.json'), limit),
          api = state?.platforms?.api_server
        if (
          state?.pid === (nativePid ?? managed.process.pid) &&
          api?.writer_pid === (nativePid ?? managed.process.pid) &&
          api.state === 'connected' &&
          api.listener_base === base &&
          Date.parse(api.updated_at) >= startedAt - 1000
        ) {
          listening.resolve()
          return
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  })()
  nativeBinding.catch((error) => ready.reject(error))
  const poll = (async () => {
    // Do not send the bearer secret to a competing listener that raced the
    // vacant-port selection. Only the owned child's successful bind announces it.
    await listening.promise
    for (;;) {
      startup.signal.throwIfAborted()
      io.signal?.throwIfAborted()
      try {
        const capabilities = await httpJson(base, '/v1/capabilities', {
          headers,
          signal: startup.signal,
          timeoutMs: 1000,
          limit,
        })
        if (
          capabilities?.object !== 'hermes.api_server.capabilities' ||
          capabilities.auth?.type !== 'bearer' ||
          capabilities.auth.required !== true
        )
          throw new Error('Hermes API 网关鉴权或能力响应无效')
        ready.resolve(capabilities)
        return
      } catch (error) {
        if (error.message?.includes('鉴权或能力')) throw error
        startup.signal.throwIfAborted()
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  })()
  poll.catch((error) => ready.reject(error))
  try {
    const capabilities = await ready.promise
    for (const feature of [
      'run_submission',
      'run_status',
      'run_events_sse',
      'run_stop',
      'run_approval_response',
      'session_resources',
    ])
      if (capabilities.features?.[feature] !== true) throw new Error(`Hermes 安装版缺少 ${feature} 能力`)
    return { managed, base, headers, capabilities }
  } catch (error) {
    await managed.stop()
    throw error
  } finally {
    clearTimeout(timer)
    startup.abort()
    await poll.catch(() => {})
    await nativeBinding.catch(() => {})
    io.signal?.removeEventListener('abort', abort)
  }
}
function validateIdentity(status, runID, sessionID) {
  if (!object(status) || status.run_id !== runID || status.session_id !== sessionID)
    throw new Error('Hermes 运行或会话身份不一致')
}

/** Only a native session grant; `always` would also write the permanent allowlist. */
export const hermesSessionGrant = (event) => Array.isArray(event.choices) && event.choices.includes('session')
/** Public summary of one Hermes approval.request (command already redacted by Hermes). */
export function hermesApprovalRequest(event) {
  return {
    kind: 'command',
    summary: (string(event.description) ? event.description : '执行危险命令').slice(0, 500),
    ...(string(event.command) ? { detail: event.command.slice(0, 4000) } : {}),
    allowSession: hermesSessionGrant(event),
  }
}

export async function runNativeHermes(config, io) {
  if (config.mode !== 'accept-edits') throw new Error('Hermes 当前原生通路不支持只读派遣')
  const selection = selected(config),
    limit = httpLimits(config)
  const key = randomBytes(32).toString('hex'),
    port = await vacantPort()
  const home = await prepareHermesHttpHome(config, selection.provider, selection.model, key, port)
  let observer
  let server,
    runID,
    sessionID,
    stream,
    streamTask,
    terminal,
    permissionDenied = false,
    toolOutcomes = createToolOutcomes()
  let releaseSteer, stopObserverPolling, acceptedGuidance = false
  let response = '',
    stopped = false,
    stopPromise,
    toolStep = 0,
    sequence = -1
  const activeTools = new Map()
  let reasoningDetail = '',
    reasoningStep
  let assistantStep = 0, assistantSegmentOpen = false
  const assistant = (text) => {
    if (!text) return
    if (!assistantSegmentOpen) { assistantStep++; assistantSegmentOpen = true }
    io.event({ kind: 'assistant', step: assistantStep, text })
  }
  const deadline = AbortSignal.timeout(config.timeoutMs ?? 600000),
    streamAbort = new AbortController()
  const signal = io.signal ? AbortSignal.any([io.signal, deadline]) : deadline
  const request = (path, method = 'GET', body, ownSignal = signal) =>
    httpJson(server.base, path, {
      headers: server.headers,
      method,
      body,
      signal: ownSignal,
      limit,
    })
  const model_options =
    config.preference.effort === 'default' ? {} : { reasoning_effort: config.preference.effort }
  const stopRun = () =>
    (stopPromise ??= (async () => {
      stopped = true
      if (runID && server) {
        await request(
          `/v1/runs/${encodeURIComponent(runID)}/stop`,
          'POST',
          {},
          AbortSignal.timeout(5000),
        ).catch(() => {})
      }
      streamAbort.abort()
    })())
  const onAbort = () => {
    const stopping = stopRun()
    io.trackControl?.(stopping)
    void stopping
  }
  io.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    // Only the already-owned Python entry consumes these observer coordinates.
    // Other installed launchers keep executing unchanged and report unavailable.
    try {
      observer = await prepareHermesObserver(config.stateDirectory, selection)
      Object.assign(home.env, observer.env)
    } catch { /* Optional metadata must not block or repeat a generation. */ }
    server = await startHermesServer(config, io, home, port, key, limit)
    if (config.conversationId) {
      if (!/^[A-Za-z0-9_-]{1,256}$/.test(config.conversationId)) throw new Error('Hermes HTTP 会话身份无效')
      const existing = await request(`/api/sessions/${encodeURIComponent(config.conversationId)}`)
      if (existing?.session?.id !== config.conversationId || existing.session.source !== 'api_server')
        throw new Error('Hermes HTTP 不能恢复其他界面的会话')
      sessionID = existing.session.id
    } else {
      const created = await request('/api/sessions', 'POST', {
        title: 'CLI Worker',
        ...selection,
        model_options,
        require_model_lock: true,
      })
      if (!/^[A-Za-z0-9_-]{1,256}$/.test(created?.session?.id) || created.session.source !== 'api_server')
        throw new Error('Hermes API 未返回自身会话身份')
      sessionID = created.session.id
    }
    io.session(sessionID, config.preference.model)
    try { await observer?.bind(sessionID) } catch { await observer?.close(); observer = undefined }
    io.signal?.throwIfAborted()
    // Do not retry after an ambiguous acceptance, even with the same input.
    const accepted = await request('/v1/runs', 'POST', {
      input: await nativeAttachmentInput('text', config.prompt, config.attachments, io.signal),
      session_id: sessionID,
      ...selection,
      model_options,
    })
    if (!string(accepted?.run_id) || !['queued', 'started', 'running'].includes(accepted.status))
      throw new Error('Hermes API 未确认任务受理')
    runID = accepted.run_id
    try {
      observer?.bindRun(runID)
      stopObserverPolling = observer?.startPolling((record) => io.native(record), { signal })
    } catch { await observer?.close(); observer = undefined }
    const initial = await request(`/v1/runs/${encodeURIComponent(runID)}`)
    validateIdentity(initial, runID, sessionID)
    releaseSteer = io.registerSteer?.(async (message, requestId) => {
      if (terminal || stopped || signal.aborted || server.capabilities.features?.run_steer !== true)
        throw Object.assign(new Error('Hermes 当前运行不接受引导'), { code: 'STEER_REJECTED' })
      let receipt
      try {
        receipt = await request(`/v1/runs/${encodeURIComponent(runID)}/steer`, 'POST', { input: message },
          AbortSignal.any([signal, AbortSignal.timeout(12000)]))
      } catch (error) {
        if ([400, 401, 403, 404, 409].includes(error?.status))
          throw Object.assign(new Error('Hermes 原生运行明确拒绝引导'), { code: 'STEER_REJECTED' })
        throw new Error('Hermes 引导接收回执未知，请核对当前运行，不要自动重投')
      }
      if (receipt?.object !== 'hermes.run.steer' || receipt.run_id !== runID || receipt.accepted !== true || terminal || stopped || signal.aborted)
        throw new Error('Hermes 引导运行或接收状态未确认，请核对当前运行，不要自动重投')
      acceptedGuidance = true
      io.native({ type: 'hermes.steer', requestId, ...receipt })
    })
    stream = await openSse(server.base, `/v1/runs/${encodeURIComponent(runID)}/events`, {
      headers: server.headers,
      signal: AbortSignal.any([signal, streamAbort.signal]),
      limit,
    })
    streamTask = stream.consume(async (event) => {
      await observer?.read((record) => io.native(record))
      if (!object(event) || !string(event.event) || event.run_id !== runID)
        throw new Error('Hermes SSE 运行身份无效')
      if (event.session_id !== undefined && event.session_id !== sessionID)
        throw new Error('Hermes SSE 会话身份变化')
      if (Number.isSafeInteger(event.seq)) {
        if (event.seq <= sequence) throw new Error('Hermes SSE 事件序号重复或倒退')
        sequence = event.seq
      }
      if (terminal) throw new Error('Hermes 终态后仍收到运行事件')
      if (event.event === 'message.delta') {
        if (typeof event.delta !== 'string') throw new Error('Hermes 文本增量无效')
        response += event.delta
        if (event.delta.trim()) toolOutcomes.succeeded()
        assistant(event.delta)
      } else if (event.event === 'message.interim') {
        if (typeof event.text !== 'string') throw new Error('Hermes 公开进度无效')
        if (!event.already_streamed) io.event({ kind: 'status', text: event.text })
        assistantSegmentOpen = false
      } else if (event.event === 'reasoning.available') {
        if (typeof event.text !== 'string') throw new Error('Hermes 公开思考格式无效')
        if (event.text) {
          reasoningStep ??= ++toolStep
          reasoningDetail += (reasoningDetail ? '\n' : '') + event.text
          io.event({
            kind: 'reasoning',
            step: reasoningStep,
            text: 'Hermes 公开思考',
            detail: reasoningDetail,
            state: 'RUNNING',
          })
        }
      } else if (['tool.started', 'tool.completed', 'tool.failed'].includes(event.event)) {
        assistantSegmentOpen = false
        if (!string(event.tool)) throw new Error('Hermes 工具事件缺少名称')
        const queue = activeTools.get(event.tool) ?? []
        let step
        if (event.event === 'tool.started') {
          step = ++toolStep
          queue.push(step)
        } else {
          step = queue.shift()
          if (step === undefined) throw new Error('Hermes 工具结束事件缺少开始记录')
        }
        activeTools.set(event.tool, queue)
        if (event.event !== 'tool.started') {
          if (event.error === true || event.event === 'tool.failed') toolOutcomes.failed(step)
          else toolOutcomes.succeeded()
        }
        io.event({
          kind: 'tool',
          step,
          text: event.tool,
          state:
            event.event === 'tool.started'
              ? 'RUNNING'
              : event.error === true || event.event === 'tool.failed'
                ? 'FAILED'
                : 'COMPLETED',
          detail: JSON.stringify(event),
          toolCall: { name: event.tool,
            ...(typeof event.tool_call_id === 'string' ? { callId: event.tool_call_id } : {}) },
        })
      } else if (event.event === 'approval.request') {
        const requestID = event.request_id ?? event.prompt_id
        if (!string(requestID)) throw new Error('Hermes 审批请求缺少身份')
        // The run waits on this request; the Host decides from the DSH preset and user.
        const answer = await io.approval(hermesApprovalRequest(event))
        const choice = answer.decision === 'deny' ? 'deny' : answer.decision === 'allow-session' && hermesSessionGrant(event) ? 'session' : 'once'
        if (choice === 'deny') {
          permissionDenied = true
          io.event({ kind: 'diagnostic', text: 'Hermes 额外授权已拒绝', detail: JSON.stringify(event) })
        } else io.event({ kind: 'diagnostic', text: 'Hermes 额外授权已批准' })
        await request(`/v1/runs/${encodeURIComponent(runID)}/approval`, 'POST', {
          request_id: requestID,
          choice,
          ...(Number.isSafeInteger(event.execution_generation)
            ? { execution_generation: event.execution_generation }
            : {}),
        })
      } else if (['run.completed', 'run.failed', 'run.cancelled', 'run.interrupted'].includes(event.event)) {
        terminal = event
        io.native(event)
        if (reasoningDetail)
          io.event({
            kind: 'reasoning',
            step: reasoningStep,
            text: 'Hermes 公开思考',
            detail: reasoningDetail,
            state: 'COMPLETED',
          })
        return true
      } else if (event.event === 'stream.truncated')
        throw new Error('Hermes SSE 历史已截断，轮次结果无法确认')
      io.native(event)
    })
    streamTask.catch(() => {})
    await Promise.race([
      streamTask,
      server.managed.done.then(() => {
        throw new Error('Hermes API 网关在轮次结束前退出')
      }),
    ])
    if (!terminal) throw new Error('Hermes SSE 缺少运行终态')
    await stopObserverPolling?.()
    const final = await request(`/v1/runs/${encodeURIComponent(runID)}`)
    await observer?.read((record) => io.native(record))
    validateIdentity(final, runID, sessionID)
    io.native({ ...final, type: 'hermes.run' })
    if (acceptedGuidance && final.pending_steer)
      io.event({ kind: 'diagnostic', text: 'Hermes 本轮结束时仍有未消费的引导；CLI 已接收不代表模型已执行，请核对后明确处理。' })
    if (terminal.event !== `run.${final.status}` || final.status !== 'completed')
      throw new Error('Hermes 原生任务未成功完成')
    if (final.runtime?.provider !== selection.provider || final.runtime?.model !== selection.model)
      throw new Error('Hermes 实际执行模型与明确选型不一致')
    if (typeof final.output !== 'string') throw new Error('Hermes 运行结果缺失')
    if ([...activeTools.values()].some((queue) => queue.length)) throw new Error('Hermes 工具缺少完成事件')
    if (!assistantSegmentOpen && final.output) assistant(final.output)
    response = final.output
    if (permissionDenied)
      io.result('UNCERTAIN', response, 'Hermes 额外授权已拒绝，但 CLI 报告本轮已完成；结果待核实，请先核查实际产物，不要自动重试', 'response')
    else toolOutcomes.settle(io, response, 'response')
  } catch (error) {
    if (runID && !terminal) await stopRun()
    throw error
  } finally {
    releaseSteer?.()
    io.signal?.removeEventListener('abort', onAbort)
    await stopObserverPolling?.()
    await stopPromise
    streamAbort.abort()
    await stream?.cancel()
    await streamTask?.catch(() => {})
    try {
      if (server) await closeServer(server.managed)
    } finally {
      try {
        if (observer) {
          try {
            const available = await observer.read((record) => io.native(record))
            await observer.finish((record) => io.native(record))
            if (!available) io.native({ type: 'cliworker.hermes_observer_status', state: 'unavailable',
              reason: 'official-public-observer-unavailable', ...(sessionID ? { sessionId: sessionID } : {}),
              ...(runID ? { nativeRunId: runID } : {}) })
          } finally { await observer.close() }
        }
      } finally { await home.cleanup() }
    }
  }
}
import { nativeAttachmentInput } from './native-attachments.mjs'
