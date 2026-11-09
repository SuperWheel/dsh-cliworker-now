import { mkdtemp, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:net'

const unavailable = reason => Object.assign(new Error(`WorkBuddy 暂不可用：${reason}`), { code: 'WORKBUDDY_UNAVAILABLE', reason })
const helperReasons = new Set(['request-invalid', 'binding-unavailable', 'payload-invalid', 'connect-failed', 'ack-invalid', 'channel-closed', 'timeout'])
const clearVariable = name => /^(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|WORKBUDDY_AT_REST_ENCRYPTION|CODEBUDDY_API_KEY|CODEBUDDY_AUTH_TOKEN|CODEBUDDY_INTERNET_ENVIRONMENT)$/i.test(name) ||
  /^(?:CODEBUDDY_SIDECAR_|CODEBUDDY_GATEWAY_|ACC_PRODUCT_CONFIG_)/i.test(name)

/** Tombstones matter: createNativeIO merges process.env again before spawning. */
export function workbuddyChildEnv(base, install) {
  const env = { ...base }
  for (const name of Object.keys({ ...process.env, ...base })) if (clearVariable(name)) env[name] = undefined
  return { ...env, ELECTRON_RUN_AS_NODE: '1', CODEBUDDY_FORCE_LITE_WB_BUNDLE: '1',
    CODEBUDDY_CONFIG_DIR: install.configDir, WORKBUDDY_CONFIG_DIR: install.configDir,
    WORKBUDDY_DATA_FOLDER_NAME: install.dataFolderName ?? basename(install.configDir),
    DISABLE_AUTOUPDATER: '1', CODEBUDDY_DISABLE_CRON: '1', CODEBUDDY_DISABLE_IDE: '1',
    CODEBUDDY_GIT_REPO_SCAN_DISABLED: '1', CODEBUDDY_PROMPT_SUGGESTION_DISABLED: '1',
    WORKBUDDY_AT_REST_ENCRYPTION: 'fields' }
}

/** Strip even config.env overrides; the helper has no credential/environment fallback. */
function helperEnv(base) {
  const source = { ...process.env, ...base }, env = Object.fromEntries(Object.keys(source).map(key => [key, undefined]))
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TMPDIR', 'TEMP']) {
    const actual = Object.keys(source).find(name => name.toLowerCase() === key.toLowerCase())
    if (actual && typeof source[actual] === 'string') env[key] = source[actual]
  }
  env.ELECTRON_RUN_AS_NODE = '1'
  return env
}

export async function createWorkBuddyLaunch({ install, platform = process.platform, baseEnv = {}, signal }) {
  signal?.throwIfAborted()
  const directory = await mkdtemp(join(tmpdir(), 'dshwb-'))
  const id = randomUUID(), token = randomBytes(32).toString('hex'), sessionId = randomUUID()
  const bootstrapPath = platform === 'win32' ? `\\\\.\\pipe\\dsh-wb-${id}-b` : join(directory, 'b.sock')
  const readyPath = platform === 'win32' ? `\\\\.\\pipe\\dsh-wb-${id}-r` : join(directory, 'r.sock')
  const sockets = new Set()
  let expectedPid, accepted = false, settled = false, timer, closing, helper
  let resolveReady, rejectReady
  const pending = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  void pending.catch(() => {})
  const fail = reason => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    rejectReady(unavailable(reason))
    for (const socket of sockets) socket.destroy()
  }
  const server = createServer(socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => fail('ready-channel-closed'))
    if (accepted || settled) { socket.destroy(); fail('ready-invalid'); return }
    accepted = true
    let buffer = Buffer.alloc(0), received = false
    socket.on('data', chunk => {
      if (received) return fail('ready-invalid')
      if (buffer.length + chunk.length > 8192) return fail('ready-invalid')
      buffer = Buffer.concat([buffer, chunk])
      const end = buffer.indexOf(10)
      if (end < 0) return
      let message
      try {
        if (buffer.subarray(end + 1).toString('utf8').trim()) return fail('ready-invalid')
        message = JSON.parse(buffer.subarray(0, end).toString('utf8'))
      } catch { return fail('ready-invalid') }
      buffer.fill(0)
      const params = message?.params
      if (message?.jsonrpc !== '2.0' || message.method !== 'session.ready' ||
          (message.id !== undefined && typeof message.id !== 'string' && !Number.isSafeInteger(message.id)) ||
          params?.protocolVersion !== 1 || params.token !== token || params.sessionId !== sessionId ||
          !Number.isSafeInteger(expectedPid) || params.pid !== expectedPid ||
          !Number.isSafeInteger(params.port) || params.port < 1 || params.port > 65535) return fail('ready-invalid')
      received = true
      socket.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\n', () => {
        socket.destroy()
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolveReady({ port: params.port })
      })
    })
    socket.once('end', () => { if (!received) fail('ready-channel-closed') })
  })
  server.on('error', () => fail('ready-listen-failed'))
  const abort = () => fail('stopped')
  signal?.addEventListener('abort', abort, { once: true })
  const close = () => closing ??= (async () => {
    fail('closed')
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  })()
  try {
    await chmod(directory, 0o700)
    await new Promise((resolve, reject) => {
      const error = () => reject(unavailable('ready-listen-failed'))
      server.once('error', error)
      server.listen(readyPath, () => { server.removeListener('error', error); resolve() })
    })
    if (platform !== 'win32') await chmod(readyPath, 0o600)
    signal?.throwIfAborted()
  } catch (error) { await close(); throw error }

  const env = { ...workbuddyChildEnv(baseEnv, install),
    CODEBUDDY_SIDECAR_CREDENTIAL_BOOTSTRAP_SOCKET: bootstrapPath, CODEBUDDY_SIDECAR_READY_SOCKET: readyPath,
    // Names read from @genie/agent-cli 2.165.0 (WorkBuddy 5.9.3); all four must be present.
    CODEBUDDY_SIDECAR_READY_TOKEN: token, CODEBUDDY_SIDECAR_READY_SESSION_ID: sessionId }
  return {
    env,
    async deliver(io, pid) {
      if (expectedPid !== undefined || !Number.isSafeInteger(pid) || pid <= 0 || closing) throw unavailable('request-invalid')
      expectedPid = pid
      const helperSignal = io.signal ?? signal
      let helperTimer, stop, buffer = '', result, helperIssue
      let rejectResult, resolveResult
      const answer = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
      void answer.catch(() => {})
      let rejectControl
      const control = new Promise((_, reject) => { rejectControl = reject })
      void control.catch(() => {})
      const reject = reason => {
        helperIssue ??= unavailable(reason)
        rejectResult(helperIssue)
        rejectControl(helperIssue)
      }
      try {
        helperSignal?.throwIfAborted()
        stop = () => reject('stopped')
        helperSignal?.addEventListener('abort', stop, { once: true })
        helperTimer = setTimeout(() => reject('helper-timeout'), 8000)
        helper = io.spawn([install.runtime, fileURLToPath(new URL('./workbuddy-key-helper.cjs', import.meta.url))], {
          env: helperEnv(baseEnv), reportStderr: false,
          onStdout(chunk) {
            if (result || Buffer.byteLength(buffer) + chunk.length > 1024) return reject('helper-result-invalid')
            buffer += chunk.toString('utf8')
            const end = buffer.indexOf('\n')
            if (end < 0) return
            try {
              if (buffer.slice(end + 1).trim()) return reject('helper-result-invalid')
              result = JSON.parse(buffer.slice(0, end)); buffer = ''
              if (result?.ok === true && Object.keys(result).join(',') === 'ok') resolveResult()
              else if (result?.ok === false && helperReasons.has(result.reason)) reject(result.reason)
              else reject('helper-result-invalid')
            } catch { reject('helper-result-invalid') }
          },
        })
        void helper.done.then(() => { if (!result) reject('helper-channel-closed') }, () => reject('helper-failed'))
        helper.process.stdin.end(JSON.stringify({ socketPath: bootstrapPath, token, sessionId, pid }) + '\n')
        await Promise.race([Promise.all([answer, helper.done]), control, pending.then(() => new Promise(() => {}))])
        if (helperIssue) throw helperIssue
        helper.assertHealthy()
      } catch (error) {
        if (error?.code === 'WORKBUDDY_UNAVAILABLE') throw error
        throw unavailable(helperSignal?.aborted ? 'stopped' : 'helper-failed')
      } finally {
        clearTimeout(helperTimer)
        if (stop) helperSignal?.removeEventListener('abort', stop)
        if (helper) await helper.stop()
      }
    },
    async ready(timeoutMs = 20000) {
      if (!settled && !timer) timer = setTimeout(() => fail('ready-timeout'), timeoutMs)
      const value = await pending
      // Both sockets are one-shot; remove their paths before ACP admission.
      await close()
      return value
    },
    close,
  }
}
