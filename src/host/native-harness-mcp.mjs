// A run-scoped MCP stdio carrier. It never imports Host tools or user credentials.
import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { pathToFileURL } from 'node:url'

export const HARNESS_CONNECTION_ENV = 'CLIWORKER_HARNESS_TOOLS'
export function readNativeHarnessConnection(env = process.env) {
  if (!env[HARNESS_CONNECTION_ENV]) return undefined
  let value
  try { value = JSON.parse(env[HARNESS_CONNECTION_ENV]) } catch { throw new Error('DSH 工具桥私有配置无效') }
  const url = new URL(value?.url)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/rpc' || url.search || url.hash || url.username || url.password || !/^[A-Za-z0-9_-]{43}$/u.test(value.token ?? '') || !value.binding || typeof value.binding !== 'object')
    throw new Error('DSH 工具桥私有配置无效')
  return value
}
/** One native carrier has a stable client identity. Requests are never retried. */
export function createNativeHarnessClient(connection, { maximum = 1024 * 1024 } = {}) {
  const clientId = randomUUID()
  async function request(id, method, params = {}, signal) {
    signal?.throwIfAborted()
    const body = JSON.stringify({ binding: connection.binding, clientId, id, method, params })
    // Not fetch: it gives up after 300 s without response headers, while a DSH
    // tool may wait longer for a user's approval. The Host answers once done.
    const response = await new Promise((resolve, reject) => {
      const call = httpRequest(connection.url, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${connection.token}` },
      }, (reply) => {
        let length = 0
        const parts = []
        reply.on('data', (part) => {
          length += part.byteLength
          if (length > maximum) {
            reply.destroy()
            reject(new Error('工具桥响应超过限制；未自动重试'))
          } else parts.push(part)
        })
        reply.on('end', () => resolve({ status: reply.statusCode ?? 0, text: Buffer.concat(parts).toString('utf8') }))
        reply.on('close', () => { if (!reply.complete) reject(new Error('工具桥没有响应；未自动重试')) })
        reply.on('error', reject)
      })
      call.on('error', reject)
      call.end(body)
    })
    const result = JSON.parse(response.text)
    if (response.status !== 200 || result.error) throw Object.assign(new Error(typeof result.error === 'string' ? result.error : '工具桥拒绝请求；未自动重试'), { nativeHarnessPublicError: true })
    return result.result
  }
  return { request, cancel: (id, signal) => request(`cancel:${id}`, 'rpc/cancel', { requestId: id }, signal) }
}
export function runNativeHarnessMcp({ input = process.stdin, output = process.stdout, env = process.env, maximum = 1024 * 1024 } = {}) {
  const connection = readNativeHarnessConnection(env)
  if (!connection) throw new Error('DSH 工具桥没有运行身份')
  const client = createNativeHarnessClient(connection, { maximum }), lifetime = new AbortController(), active = new Set()
  let buffer = '', closed = false
  const reply = (id, result, error) => {
    if (closed || lifetime.signal.aborted) return
    const value = JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) })
    if (Buffer.byteLength(value) > maximum) output.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: '工具桥响应超过限制' } })}\n`)
    else output.write(`${value}\n`)
  }
  async function request(value) {
    if (value?.jsonrpc === '2.0' && value.method === 'notifications/cancelled' && ['string', 'number'].includes(typeof value.params?.requestId)) {
      try {
        await client.cancel(value.params.requestId, lifetime.signal)
      } catch { /* Cancellation is never retried or interpreted as a new call. */ }
      return
    }
    if (!value || typeof value !== 'object' || value.jsonrpc !== '2.0' || !['string', 'number'].includes(typeof value.id) || typeof value.method !== 'string') return
    const id = value.id
    try {
      if (value.method === 'initialize') {
        reply(id, { protocolVersion: '2024-11-05', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'dsh-worker-tools', version: '0.8.5' } }); return
      }
      if (value.method === 'ping') { reply(id, {}); return }
      if (!['tools/list', 'tools/call', 'resources/list', 'resources/templates/list', 'resources/read'].includes(value.method)) {
        reply(id, undefined, { code: -32601, message: '工具桥方法不可用' }); return
      }
      reply(id, await client.request(id, value.method, value.params ?? {}, lifetime.signal))
    } catch (error) { reply(id, undefined, { code: -32000, message: error instanceof Error && error.nativeHarnessPublicError === true ? error.message : '工具桥调用状态无法确认；未自动重试' }) }
  }
  function stop() { closed = true; lifetime.abort(); input.off('data', data); input.off('end', end); input.off('error', stop) }
  function end() { if (buffer.trim()) reply(null, undefined, { code: -32700, message: '工具桥输入不是完整 JSON 行' }); void Promise.allSettled([...active]).then(stop) }
  function data(chunk) {
    buffer += String(chunk)
    if (Buffer.byteLength(buffer) > maximum) { reply(null, undefined, { code: -32700, message: '工具桥输入超过限制' }); stop(); return }
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
      if (!line.trim()) continue
      let value
      try { value = JSON.parse(line) } catch { reply(null, undefined, { code: -32700, message: '工具桥输入不是有效 JSON' }); continue }
      const pending = request(value)
      active.add(pending)
      void pending.finally(() => active.delete(pending)).catch(() => {})
    }
  }
  input.setEncoding('utf8'); input.on('data', data); input.once('end', end); input.once('error', stop)
  return { close: async () => { stop(); await Promise.allSettled([...active]) } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { runNativeHarnessMcp() } catch { process.stderr.write('DSH 工具桥无法初始化\n'); process.exitCode = 1 }
}
