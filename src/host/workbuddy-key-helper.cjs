'use strict'
const { createHash } = require('node:crypto')
const { createConnection } = require('node:net')

const reasonError = reason => Object.assign(new Error(reason), { reason })
const reasons = new Set(['request-invalid', 'binding-unavailable', 'payload-invalid', 'connect-failed', 'ack-invalid', 'channel-closed', 'timeout'])

/** One bounded line. Neither parse errors nor input bytes escape this process. */
function readLine(stream, invalid, timeoutMs, limit = 8192) {
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0)
    const finish = (error, value) => {
      clearTimeout(timer)
      stream.removeListener('data', data)
      stream.removeListener('end', closed)
      stream.removeListener('close', closed)
      stream.removeListener('error', closed)
      bytes.fill(0)
      error ? reject(reasonError(error)) : resolve(value)
    }
    const closed = () => finish('channel-closed')
    const data = chunk => {
      const previous = bytes
      bytes = Buffer.concat([bytes, Buffer.from(chunk)])
      previous.fill(0)
      if (bytes.length > limit) return finish(invalid)
      const end = bytes.indexOf(10)
      if (end < 0) return
      try {
        if (bytes.subarray(end + 1).toString('utf8').trim()) return finish(invalid)
        const value = JSON.parse(bytes.subarray(0, end).toString('utf8'))
        finish(undefined, value)
      } catch { finish(invalid) }
    }
    const timer = setTimeout(() => finish('timeout'), timeoutMs)
    stream.on('data', data)
    stream.once('end', closed)
    stream.once('close', closed)
    stream.once('error', closed)
  })
}

/** Injection is for in-memory simulated tests; the executable always uses the
 * app runtime's binding. There is no env/file key override or logging channel. */
async function runWorkBuddyKeyHelper({ input = process.stdin, output = process.stdout,
  readBinding = () => process._linkedBinding('electron_browser_workbuddy_storage').loggerGet(),
  connect = createConnection, timeoutMs = 4500, retryMs = 100 } = {}) {
  const buffers = []
  let socket, result, payload, secretText, wire
  try {
    const request = await readLine(input, 'request-invalid', timeoutMs)
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
        Object.keys(request).sort().join(',') !== 'pid,sessionId,socketPath,token' ||
        typeof request.socketPath !== 'string' || !request.socketPath || request.socketPath.includes('\0') ||
        typeof request.token !== 'string' || !/^[a-f0-9]{64}$/.test(request.token) ||
        typeof request.sessionId !== 'string' || !request.sessionId || request.sessionId.length > 200 ||
        !Number.isSafeInteger(request.pid) || request.pid <= 0) throw reasonError('request-invalid')
    try { payload = await readBinding() } catch { throw reasonError('binding-unavailable') }
    try { if (typeof payload === 'string') payload = JSON.parse(payload) } catch { throw reasonError('payload-invalid') }
    secretText = payload?.atRestSecretKey
    if (payload?.version !== 1 || typeof secretText !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(secretText))
      throw reasonError('payload-invalid')
    const decoded = Buffer.from(secretText, 'base64'); buffers.push(decoded)
    if (decoded.length !== 32 || decoded.toString('base64') !== secretText || decoded.every(byte => byte === 0))
      throw reasonError('payload-invalid')
    const textBytes = Buffer.from(secretText, 'utf8'); buffers.push(textBytes)
    const key = createHash('sha256').update(textBytes).digest(); buffers.push(key)
    const keyHash = createHash('sha256').update(key).digest(); buffers.push(keyHash)
    wire = Buffer.from(JSON.stringify({ version: 1, sessionId: request.sessionId, token: request.token, pid: request.pid,
      bootstrap: { version: 1, policy: 'fields', symmetricKey: { keyId: keyHash.toString('hex').slice(0, 16), keyBase64: key.toString('base64') },
        asymmetricUnavailable: 'missing-key' } }) + '\n')
    buffers.push(wire)
    payload = undefined; secretText = undefined
    const deadline = Date.now() + timeoutMs
    while (!socket) {
      if (Date.now() >= deadline) throw reasonError('timeout')
      try {
        socket = await new Promise((resolve, reject) => {
          let candidate
          const timer = setTimeout(() => { candidate?.destroy(); reject(reasonError('timeout')) }, Math.max(1, deadline - Date.now()))
          const failed = error => { clearTimeout(timer); candidate?.destroy(); reject(error) }
          try {
            candidate = connect({ path: request.socketPath })
            candidate.once('error', failed)
            candidate.once('connect', () => {
              clearTimeout(timer); candidate.removeListener('error', failed); resolve(candidate)
            })
          } catch (error) { failed(error) }
        })
      } catch (error) {
        if (error?.reason === 'timeout') throw error
        if (!['ENOENT', 'ECONNREFUSED'].includes(error?.code)) throw reasonError('connect-failed')
        await new Promise(resolve => setTimeout(resolve, Math.min(retryMs, Math.max(1, deadline - Date.now()))))
      }
    }
    const ack = readLine(socket, 'ack-invalid', Math.max(1, deadline - Date.now()))
    // readLine owns socket errors while this write is outstanding.
    socket.write(wire, error => { if (error) socket.destroy() })
    const value = await ack
    if (value?.ok !== true || value?.policy !== 'fields') throw reasonError('ack-invalid')
    result = { ok: true }
  } catch (error) {
    result = { ok: false, reason: reasons.has(error?.reason) ? error.reason : 'payload-invalid' }
  } finally {
    socket?.on('error', () => {})
    socket?.destroy()
    for (const bytes of buffers) bytes.fill(0)
    payload = undefined; secretText = undefined; wire = undefined
  }
  output.write(JSON.stringify(result) + '\n')
  return result
}

module.exports = { runWorkBuddyKeyHelper }
if (require.main === module) {
  process.stdout.on('error', () => { process.exitCode = 1 })
  void runWorkBuddyKeyHelper().then(result => {
    process.stdin.pause()
    process.stdin.destroy()
    if (!result.ok) process.exitCode = 1
  })
}
