// Owned loopback transports only. Mutating requests are never retried.
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'

export const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
export const string = (value) => typeof value === 'string' && value.length > 0 && !value.includes('\0')
export function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  promise.catch(() => {})
  return { promise, resolve, reject }
}
export function commandPrefix(argv, command) {
  const index = argv.indexOf(command)
  if (index < 1) throw new Error('原生服务启动入口无法确认')
  return argv.slice(0, index)
}
export function loopback(value) {
  const url = new URL(value)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !Number(url.port) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('原生服务没有返回受管回环地址')
  return url.origin
}
export async function vacantPort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return port
}
export async function closeServer(managed) {
  await managed.stop()
  const exit = await managed.done
  // Windows Node terminates with the requested SIGINT rather than delivering
  // Hermes' POSIX handler. Accept it only with this managed child's own stop
  // receipt; a spontaneous SIGINT/nonzero exit still fails.
  const ownedInterrupt = exit.signal === 'SIGINT' && managed.ownsPlannedStop?.(exit) === true
  if (exit.exitCode !== 0 && exit.exitCode !== 143 && !['SIGTERM', 'SIGKILL'].includes(exit.signal) && !ownedInterrupt)
    throw new Error('原生 HTTP 服务异常退出')
  return exit
}
export function httpLimits(config) {
  let used = 0
  const maximum = config.maxRunBytes ?? 16 * 1024 * 1024
  const line = config.maxLineBytes ?? 1024 * 1024
  return {
    line,
    // One SSE frame is the native inbound unit, bounded separately from display budgets.
    frame: config.maxNativeLineBytes ?? line,
    json: maximum,
    // Cumulative inbound bytes are statistics only; they never stop a run.
    add(bytes) {
      used += bytes
    },
  }
}
const frameTooLarge = (limit) => new Error(`原生 CLI 单个入站协议帧超过上限（${limit} 字节），已停止运行`)
export async function httpJson(
  base,
  path,
  { headers, method = 'GET', body, signal, limit, timeoutMs = 15000 } = {},
) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw Object.assign(new Error(`原生 HTTP ${method} 请求失败 (${response.status})`), { status: response.status })
  }
  if (response.status === 204) return undefined
  if (!response.body) throw new Error('原生 HTTP 响应为空')
  const reader = response.body.getReader(),
    decoder = new TextDecoder('utf-8', { fatal: true })
  let text = '',
    bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      limit?.add(value.byteLength)
      if (bytes > (limit?.json ?? 1024 * 1024)) throw new Error('原生 HTTP JSON 超过限制')
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
export async function openSse(base, path, { headers, signal, limit }) {
  const response = await fetch(base + path, { headers, signal, redirect: 'error' })
  if (
    !response.ok ||
    !response.headers.get('content-type')?.includes('text/event-stream') ||
    !response.body
  ) {
    await response.body?.cancel()
    throw new Error('原生 SSE 订阅失败')
  }
  const reader = response.body.getReader()
  return {
    async consume(handler) {
      const decoder = new TextDecoder('utf-8', { fatal: true })
      let pending = '',
        data = [],
        eventName = '',
        frameBytes = 0,
        complete = false
      const line = async (raw) => {
        const value = raw.endsWith('\r') ? raw.slice(0, -1) : raw
        if (!value) {
          if (data.length) {
            const payload = JSON.parse(data.join('\n'))
            if (await handler(payload, eventName, complete)) complete = true
          }
          data = []
          eventName = ''
          frameBytes = 0
          return
        }
        frameBytes += Buffer.byteLength(value)
        if (frameBytes > limit.frame) throw frameTooLarge(limit.frame)
        if (value.startsWith(':')) return
        const colon = value.indexOf(':')
        const field = colon < 0 ? value : value.slice(0, colon)
        const contents = colon < 0 ? '' : value.slice(colon + 1).replace(/^ /, '')
        if (field === 'data') data.push(contents)
        else if (field === 'event') eventName = contents
      }
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) {
            pending += decoder.decode()
            if (pending || data.length) throw new Error('原生 SSE 在帧中断开')
            if (!complete) throw new Error('原生 SSE 在轮次结束前断开')
            return
          }
          limit.add(value.byteLength)
          pending += decoder.decode(value, { stream: true })
          let index
          while ((index = pending.indexOf('\n')) >= 0) {
            const raw = pending.slice(0, index)
            pending = pending.slice(index + 1)
            await line(raw)
          }
          if (Buffer.byteLength(pending) > limit.frame) throw frameTooLarge(limit.frame)
          if (complete) {
            if (pending || data.length) throw new Error('原生终态后仍有不完整 SSE 帧')
            return
          }
        }
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
    },
    cancel: () => reader.cancel().catch(() => {}),
  }
}
export async function startSessionServer(config, io, cli) {
  const name = cli === 'mimo' ? 'MIMOCODE' : 'OPENCODE'
  const username = cli === 'mimo' ? 'mimocode' : 'opencode'
  const password = randomBytes(32).toString('hex'),
    ready = deferred()
  const pending = { stdout: '', stderr: '' },
    marker = cli === 'mimo' ? 'mimocode' : 'opencode'
  let received = 0,
    readyFound = false
  const receive = (channel) => (chunk) => {
    if (readyFound) return
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    received += Buffer.byteLength(text)
    if (received > (config.maxLineBytes ?? 1024 * 1024)) {
      ready.reject(new Error('原生服务启动输出超过限制'))
      return
    }
    pending[channel] += text
    let end
    while ((end = pending[channel].indexOf('\n')) >= 0) {
      const line = pending[channel].slice(0, end).replace(/\r$/, '')
      pending[channel] = pending[channel].slice(end + 1)
      const match = line.match(
        new RegExp(`${marker} server listening on (http://127\\.0\\.0\\.1:\\d+)(?=\\s|$)`),
      )
      if (match) {
        try {
          readyFound = true
          ready.resolve(loopback(match[1]))
        } catch (error) {
          ready.reject(error)
        }
        return
      }
    }
  }
  const argv = [...commandPrefix(config.argv, 'run'), 'serve', '--hostname', '127.0.0.1', '--port', '0']
  const env = { ...config.env, [`${name}_SERVER_PASSWORD`]: password, [`${name}_SERVER_USERNAME`]: username }
  const managed = io.spawn(argv, {
    cwd: config.project,
    env,
    onStdout: receive('stdout'),
    onStderr: receive('stderr'),
  })
  managed.done.then(
    () => ready.reject(new Error('原生 HTTP 服务在就绪前退出')),
    (error) => ready.reject(error),
  )
  const timer = setTimeout(
    () => ready.reject(new Error('原生 HTTP 服务启动超时')),
    Math.min(config.timeoutMs ?? 30000, 30000),
  )
  const abort = () => ready.reject(new Error('任务已停止'))
  io.signal?.addEventListener('abort', abort, { once: true })
  try {
    io.signal?.throwIfAborted()
    const base = await ready.promise
    return {
      managed,
      base,
      headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
    }
  } catch (error) {
    await managed.stop()
    throw error
  } finally {
    clearTimeout(timer)
    io.signal?.removeEventListener('abort', abort)
  }
}
