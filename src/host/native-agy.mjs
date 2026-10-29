import { execFile } from 'node:child_process'
import { nativeLaunchArgv } from './native-launch.mjs'
import { summarizeNativeRecord } from './native-transport.mjs'
import { agyResponseUsage } from './native-response.mjs'
import { recordAgyHarnessSession } from './native-agy-harness.mjs'
import { createToolOutcomes } from './native-tool-outcomes.mjs'

const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
const string = (value) => typeof value === 'string' && value.trim().length > 0
const fail = (message) => new Error(`Antigravity stream-json: ${message}`)
const autoUnavailable = 'warning: --mode auto is not available for this account; continuing in the default mode.'

/**
 * `--help` lists auto even when the account cannot use it; agy then warns on stderr and
 * runs its headless default, which denies every tool. agy 1.4.x warns about a second
 * before init and before reading input (2026-10-29), so the turn is held back briefly
 * and restarted in the fallback mode. A later warning stops the turn: input is never resent.
 */
async function openAgyInput(config, io, modes) {
  for (;;) {
    const permission = agyPermissionMode(config, modes)
    if (permission.notice) io.event({ kind: 'diagnostic', text: permission.notice })
    let peer, unavailable = false, sent = false, listener, stderr = '', lateError, closing
    let ready, timer, initTimer
    const buffered = []
    const startup = new Promise(resolve => { ready = resolve })
    const stop = () => closing ??= peer.close()
    peer = await io.openStdio(nativeAgyArgv(config, modes), { env: config.env, cwd: config.project,
      onMessage(value) {
        if (listener) return listener(value)
        if (buffered.length >= 256) throw fail('原生初始化事件过多')
        buffered.push(value)
        // stdout/stderr are separate pipes; allow an already emitted warning to drain.
        if (value.event === 'init' && !initTimer) initTimer = setTimeout(ready, 50)
      },
      onStderr(chunk) {
        if (permission.mode !== 'auto' || unavailable) return
        const output = stderr + chunk.toString('utf8')
        stderr = output.slice(-8192)
        if (!output.includes(autoUnavailable)) return
        unavailable = true
        ready()
        if (sent) {
          lateError = fail('Antigravity 账号不支持自动审批，本轮已停止且未自动重试，请重新派遣')
          void stop().catch(() => {})
        }
      },
    })
    const abort = () => ready()
    try {
      if (permission.mode === 'auto') {
        // Older versions may wait for input before init. Bound that observation,
        // and retain the no-retry guard for warnings arriving after this window.
        timer = setTimeout(ready, Math.min(5000, Math.max(1, config.timeoutMs / 4)))
        io.signal?.addEventListener('abort', abort, { once: true })
        io.signal?.throwIfAborted()
        await Promise.race([startup, peer.done.then(() => { throw fail('原生进程在输入前退出') })])
      }
      io.signal?.throwIfAborted()
      if (unavailable) {
        await stop()
        modes = modes.filter(mode => mode !== 'auto')
        continue
      }
      return { ...peer,
        onMessage(callback) {
          listener = callback
          for (const value of buffered.splice(0)) callback(value)
          return () => { listener = () => {} }
        },
        send(value) {
          // This check and the first write must have no asynchronous gap.
          if (unavailable) throw fail('Antigravity 账号不支持自动审批，输入尚未发送，请重新派遣')
          sent = true
          return peer.send(value)
        },
        permissionError: () => lateError,
        close: stop,
      }
    } catch (error) {
      await stop()
      throw error
    } finally {
      clearTimeout(timer)
      clearTimeout(initTimer)
      io.signal?.removeEventListener('abort', abort)
    }
  }
}

export function agyPermissionMode(config, modes) {
  const plan = config.mode === 'plan' || config.access === 'read-only'
  const full = !plan && config.access === 'danger-full-access'
  let mode = plan ? 'plan' : full ? 'accept-edits' : 'auto'
  let skip = full, notice
  if (modes && !modes.includes(mode)) {
    if (!plan && modes.includes('accept-edits')) {
      mode = 'accept-edits'
      skip = true
      notice = 'Antigravity 原生自动审批不可用，本轮按仅工作区编辑运行'
    } else if (!plan && modes.includes('plan')) {
      mode = 'plan'
      skip = false
      notice = 'Antigravity 原生权限模式不可用，本轮按仅规划运行'
    } else throw fail('原生规划模式不可用，已拒绝启动')
  }
  return { mode, skip, sandbox: !full || mode === 'plan', notice }
}

/** Probe help only, before any task input; never retry a task on mode errors. */
export async function probeAgyModes(config, signal) {
  const start = config.argv.indexOf('--add-dir')
  if (start < 1) throw fail('无法确认原生启动入口')
  const [executable, ...args] = nativeLaunchArgv([...config.argv.slice(0, start), '--help'])
  const help = await new Promise((resolve, reject) => {
    let failure, output
    const child = execFile(executable, args, { cwd: config.project, env: { ...process.env, ...config.env },
      windowsHide: true, timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 262144, signal },
    (error, stdout, stderr) => { failure = error; output = `${stdout}\n${stderr}` })
    // An aborted execFile can report its error before close. Await pipe/process cleanup.
    child.once('close', () => failure ? reject(failure) : resolve(output))
  })
  const declaration = String(help).split(/\r?\n/).find(line => /^\s*--mode\s/.test(line)) ?? ''
  return ['accept-edits', 'auto', 'plan'].filter(mode => new RegExp(`(?:^|[\\s,(|])${mode}(?=$|[\\s,)|])`).test(declaration))
}

export function nativeAgyArgv(config, modes) {
  const argv = config.argv
  if (!Array.isArray(argv) || argv.at(-2) !== '--print' || argv.at(-1) !== `任务：\n${config.prompt}`) throw fail('不支持的原生命令参数')
  const args = argv.slice(0, -2)
  const permission = agyPermissionMode(config, modes)
  const requestedMode = agyPermissionMode(config).mode
  const suppliedMode = args[args.indexOf('--mode') + 1]
  if (args.filter(arg => arg === '--mode').length !== 1) throw fail('重复的原生权限模式')
  if (args[args.indexOf('--output-format') + 1] !== 'stream-json' || args[args.indexOf('--model') + 1] !== config.preference.model || (suppliedMode !== requestedMode && suppliedMode !== config.mode))
    throw fail('原生格式、模型或权限模式与任务不一致')
  if (config.preference.effort === 'default' ? args.includes('--effort') : args[args.indexOf('--effort') + 1] !== config.preference.effort) throw fail('原生思考强度与选型不一致')
  if (config.conversationId && args[args.indexOf('--conversation') + 1] !== config.conversationId) throw fail('恢复参数与会话不一致')
  if (!config.conversationId && args.includes('--conversation')) throw fail('缺少恢复会话绑定')
  if (args.includes('--input-format')) throw fail('重复的原生输入选项')
  const normalized = args.filter((arg, index) => index !== args.indexOf('--mode') + 1 && arg !== '--mode' &&
    !/^--(?:sandbox|dangerously-skip-permissions)(?:=|$)/.test(arg))
  return [...normalized, ...(permission.sandbox ? ['--sandbox'] : ['--sandbox=false']),
    ...(permission.skip ? ['--dangerously-skip-permissions'] : []),
    '--mode', permission.mode, '--input-format', 'stream-json']
}

/** One native stdin turn; result and process exit remain separate evidence. */
export async function runNativeAgy(config, io) {
  nativeAgyArgv(config)
  let modes
  try { modes = await probeAgyModes(config, io.signal) }
  catch (error) { throw fail(`无法核实原生权限模式，已拒绝启动：${error.message}`) }
  const content = await nativeAttachmentInput('text', `任务：\n${config.prompt}`, config.attachments, io.signal)
  const peer = await openAgyInput(config, io, modes)
  let sessionId, result, invalidStep = false, failedStep = false
  const steps = new Map(), responses = new Map(), toolOutputs = new Map()
  const toolOutcomes = createToolOutcomes()
  const currentResponse = () => [...responses.values()].filter((text) => text.trim()).join('\n')
  const identify = (id, model) => {
    if (id === undefined) return
    if (!string(id) || (sessionId && sessionId !== id) || (config.conversationId && config.conversationId !== id)) throw fail('原生会话身份与绑定不一致')
    if (!sessionId) { recordAgyHarnessSession(config, id); sessionId = id; io.session(id, model) }
  }
  const abort = () => { if (!result) { try { peer.kill('SIGINT') } catch {} } }
  io.signal?.addEventListener('abort', abort, { once: true })
  let unsubscribe = () => {}
  const onMessage = (value) => {
    if (!object(value) || !string(value.event)) throw fail('无效的原生事件')
    if (result) throw fail('原生终态后仍有事件')
    if (value.event === 'init' && (!string(value.init?.model) || value.init.model !== config.preference.model))
      throw fail('原生初始化模型与明确选型不一致')
    identify(value.conversation_id, value.init?.model)
    if ((value.error !== undefined && value.error !== null && value.error !== '' && value.error !== false) || value.is_error === true) { invalidStep = true; failedStep = true }
    if (value.event === 'init') {
      io.event({ kind: 'status', text: 'Antigravity 原生输入流已连接', observedModel: typeof value.init?.model === 'string' ? value.init.model : undefined })
    } else if (value.event === 'step_update') {
      const item = value.step_update
      if (!object(item)) throw fail('无效的步骤事件')
      identify(item.conversation_id)
      const index = typeof item.step_index === 'number' ? item.step_index : undefined
      const state = typeof item.state === 'string' ? item.state : undefined
      const knownType = ['user_input', 'agent_response', 'tool', 'checkpoint'].includes(item.step_type)
      let invalidItem = false
      if (!Number.isSafeInteger(index) || index < 0) invalidItem = true
      else if (knownType) {
        const previous = steps.get(index)
        if (previous && previous.type !== item.step_type) invalidItem = true
        steps.set(index, { type: item.step_type, state: state ?? previous?.state })
      }
      if (!knownType) {
        // Preserve unrecognized native metadata without claiming all steps
        // were understood. Unknown type alone is not evidence of failure.
        invalidStep = true
        io.event({ kind: 'diagnostic', text: 'Antigravity 存在未识别步骤类型，步骤覆盖尚未完整确认' })
      }
      const toolError = item.step_type === 'tool' && object(item.tool_info) &&
        item.tool_info.error !== undefined && item.tool_info.error !== null && item.tool_info.error !== '' && item.tool_info.error !== false
      // agy ends a failed tool step as state ERROR with tool_info.error (observed 2026-10-28); that is the step's own outcome.
      const failedTool = toolError && state === 'ERROR'
      if (failedTool && steps.get(index)?.type === 'tool') steps.get(index).failedTool = true
      if ((state && !failedTool && !['PENDING', 'QUEUED', 'ACTIVE', 'RUNNING', 'IN_PROGRESS', 'DONE'].includes(state)) ||
        (item.state !== undefined && typeof item.state !== 'string') ||
        (item.text_delta !== undefined && typeof item.text_delta !== 'string') ||
        (item.error !== undefined && item.error !== null && item.error !== '' && item.error !== false) || item.is_error === true) invalidItem = true
      if (invalidItem) { invalidStep = true; failedStep = true }
      // A tool's own error is that step's outcome; it still keeps the steps from proving a summary conflict.
      if (toolError) { invalidStep = true; toolOutcomes.failed(index) }
      else if (!invalidItem && item.step_type === 'tool' && state === 'DONE') toolOutcomes.succeeded()
      if (item.step_type === 'agent_response') {
        const text = typeof item.text_delta === 'string' ? item.text_delta : ''
        responses.set(index, (responses.get(index) ?? '') + text)
        if (!invalidItem && text.trim()) toolOutcomes.succeeded()
        const usage = state === 'DONE' ? agyResponseUsage(item.usage) : undefined
        io.event({ kind: 'assistant', step: index, text, state,
          ...(Number.isSafeInteger(index) && index >= 0 ? { response: {
            id: `agy:${index}`, blockId: 'text', index: 0,
            ...(state === 'DONE' ? { complete: true } : {}), ...(usage ? { usage } : {}),
          } } : {}),
        })
      } else if (item.step_type === 'tool') {
        const info = object(item.tool_info) ? item.tool_info : {}
        const { parameters: _input, output, result, ...metadata } = info
        const body = output ?? result, prior = toolOutputs.get(index) ?? ''
        const increment = state !== 'DONE' && !toolError && typeof body === 'string' && typeof prior === 'string' && body.startsWith(prior)
        if (body !== undefined) toolOutputs.set(index, body)
        io.event({ kind: 'tool', step: index, text: typeof item.tool_name === 'string' ? item.tool_name : '工具', state: toolError ? 'FAILED' : state,
          detail: JSON.stringify(metadata),
          ...(increment ? { delta: body.slice(prior.length) } : {}), toolCall: {
            ...(!increment && (body !== undefined || state === 'DONE' || toolError) && toolOutputs.has(index) ? { output: toolOutputs.get(index) } : {}),
            ...(string(info.name) ? { name: info.name } : string(item.tool_name) ? { name: item.tool_name } : {}),
            ...(Object.hasOwn(info, 'parameters') ? { input: info.parameters } : {}),
            ...(object(info.parameters) && typeof info.parameters.CommandLine === 'string'
              ? { command: info.parameters.CommandLine } : {}),
          },
        })
      }
      if (invalidItem) io.event({ kind: 'diagnostic', text: 'Antigravity 步骤存在失败、非法状态或无效字段', state: 'FAILED' })
    } else if (value.event === 'result') {
      const end = value.result
      if (!object(end) || !string(end.conversation_id) || !string(end.status) || typeof end.response !== 'string') throw fail('无效的原生终态')
      identify(end.conversation_id)
      result = end
      if (end.status !== 'SUCCESS') io.event({ kind: 'diagnostic', text: 'CLI 最终汇总', state: end.status, detail: JSON.stringify({ status: end.status, error: end.error }) })
    } else {
      invalidStep = true
      io.event({ kind: 'diagnostic', text: `未识别事件：${value.event}` })
    }
    const info = value.step_update?.tool_info
    io.native(info ? { ...value, step_update: { ...value.step_update, tool_info: { ...info,
      ...(info.output !== undefined ? { output: summarizeNativeRecord(info.output, 0) } : {}),
      ...(info.result !== undefined ? { result: summarizeNativeRecord(info.result, 0) } : {}) } } } : value)
  }
  try {
    io.signal?.throwIfAborted()
    unsubscribe = peer.onMessage(onMessage)
    const completion = peer.waitFor((value) => value.event === 'result', { timeoutMs: config.timeoutMs })
    completion.catch(() => {})
    await peer.send({ event: 'user', message: { content } })
    await completion
    if (!result || !sessionId) throw fail('缺少原生终态或会话身份')
    peer.end()
    const outcome = await peer.done
    if (peer.permissionError()) throw peer.permissionError()
    io.signal?.throwIfAborted()
    const observed = currentResponse()
    const unfinishedTool = [...steps.values()].some((item) => item.type === 'tool' && item.state !== 'DONE' && !(item.state === 'ERROR' && item.failedTool))
    const allDone = !invalidStep && steps.size > 0 && [...steps.values()].every((item) => item.state === 'DONE') && [...responses].some(([index, text]) => index !== undefined && steps.get(index)?.state === 'DONE' && text.trim()) && (result.error === undefined || typeof result.error === 'string')
    const conflict = outcome.exitCode === 0 && config.conversationId && sessionId === config.conversationId && result.status === 'ERROR' && allDone
    if (conflict) {
      io.result('UNCERTAIN', observed, `CLI 汇总状态冲突，结果待核实：本轮回复及已观察步骤均为 DONE，但 CLI 最终报告 ERROR。请核查本轮输出和实际产物，不要自动重试。原始汇总错误：${result.error || '未提供错误详情'}`, 'run')
    } else if (outcome.exitCode !== 0 || result.status !== 'SUCCESS' || failedStep || unfinishedTool) {
      io.result('ERROR', observed, outcome.exitCode !== 0 ? 'Antigravity 原生进程非零退出' : typeof result.error === 'string' && result.error ? result.error : `Antigravity 原生结果 ${result.status}${failedStep || unfinishedTool ? '，且步骤未全部确认' : ''}`, 'run')
    } else toolOutcomes.settle(io, result.response, 'run')
  } catch (error) {
    unsubscribe()
    await peer.close()
    if (peer.permissionError()) io.event({ kind: 'diagnostic', text: peer.permissionError().message, state: 'FAILED' })
    throw peer.permissionError() ?? error
  } finally {
    io.signal?.removeEventListener('abort', abort)
    unsubscribe()
    await peer.close()
  }
}
import { nativeAttachmentInput } from './native-attachments.mjs'
