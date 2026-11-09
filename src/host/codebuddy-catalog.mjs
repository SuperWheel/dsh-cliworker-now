// Read-only ACP metadata probe. No prompt, account RPC or raw native output.
import { StringDecoder } from 'node:string_decoder'
import { spawnNativeProcess } from './native-spawn.mjs'
import { nativeLaunchArgv } from './native-launch.mjs'
import { codebuddyVerifyInitialize } from './native-codebuddy.mjs'

process.umask(0o077)
const [executable, cwd] = process.argv.slice(2)
const generic = 'CodeBuddy 原生模型目录查询失败；请检查 CLI 版本。\n'
if (!executable || !cwd || process.argv.length !== 4) {
  process.stderr.write(generic)
  process.exitCode = 1
} else {
  await query().catch(() => { process.stderr.write(generic); process.exitCode = 1 })
}
async function query() {
  const argv = nativeLaunchArgv([executable, '--acp', '--no-session-persistence'])
  const child = spawnNativeProcess(argv[0], argv.slice(1), {
    cwd, env: { ...process.env, DISABLE_AUTOUPDATER: '1' }, detached: false, stdio: ['pipe', 'pipe', 'pipe'],
  })
  const decoder = new StringDecoder('utf8')
  let pending = '', bytes = 0, closed = false, received = false, stage = 1, models, failure, auth = false, force
  let complete, reject
  const reply = new Promise((resolve, fail) => { complete = resolve; reject = fail })
  void reply.catch(() => {})
  const done = new Promise((resolve) => child.once('close', (code, signal) => {
    closed = true
    if (!received) reject(new Error('Missing catalog reply'))
    resolve({ code, signal })
  }))
  const stop = () => {
    child.stdin.end()
    if (!closed) {
      child.kill('SIGTERM')
      force ??= setTimeout(() => { if (!closed) child.kill('SIGKILL') }, 1000)
    }
  }
  const abort = () => { failure ??= new Error('Catalog failed'); reject(failure); stop() }
  const send = (value) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n')
  child.on('error', abort)
  child.stdin.on('error', abort)
  process.on('SIGTERM', abort)
  process.on('SIGINT', abort)
  const timeout = setTimeout(abort, 15000)
  const receive = (chunk, stderr = false) => {
    bytes += chunk.length
    if (bytes > 2097152) return abort()
    if (stderr || failure || received) return
    pending += decoder.write(chunk)
    if (Buffer.byteLength(pending) > 1048576) return abort()
    let end
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end).trim()
      pending = pending.slice(end + 1)
      if (!line) continue
      try {
        const message = JSON.parse(line)
        if (message?.jsonrpc !== '2.0') throw new Error('Invalid envelope')
        if (message.method) {
          if (message.id !== undefined) send({ id: message.id, error: { code: -32601, message: 'Catalog is read only' } })
          continue
        }
        if (message.id !== stage) throw new Error('Unexpected reply')
        if (message.error) {
          auth = stage === 2 && (/Authentication required/i.test(message.error.message ?? '') || message.error.data?.category === 'auth')
          throw new Error('Native request failed')
        }
        if (stage === 1) {
          if (codebuddyVerifyInitialize(message.result)) throw new Error('Identity mismatch')
          stage = 2
          send({ id: 2, method: 'session/new', params: { cwd, mcpServers: [] } })
        } else {
          const available = message.result?.models?.availableModels
          if (!Array.isArray(available) || !available.length) throw new Error('Missing models')
          models = available.map((model) => {
            if (typeof model?.modelId !== 'string' || !model.modelId.trim()) throw new Error('Missing model ID')
            return { modelId: model.modelId, name: model.name, description: model.description,
              _meta: { effortOptions: model._meta?.effortOptions, credits: model._meta?.credits } }
          })
          received = true
          complete()
        }
      } catch { abort(); return }
    }
  }
  child.stdout.on('data', (chunk) => receive(chunk))
  child.stderr.on('data', (chunk) => receive(chunk, true))
  try {
    send({ id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {},
      clientInfo: { name: 'cliworker-catalog', version: '1' } } })
    await reply
    stop()
    const outcome = await done
    if (failure || (![0, 143].includes(outcome.code) && outcome.signal !== 'SIGTERM')) throw new Error('Unclean exit')
    process.stdout.write(JSON.stringify({ models }) + '\n')
  } catch {
    process.stderr.write(auth ? 'CodeBuddy 未登录\n' : generic)
    process.exitCode = auth ? 3 : 1
  } finally {
    stop()
    await done
    clearTimeout(force)
    clearTimeout(timeout)
    process.off('SIGTERM', abort)
    process.off('SIGINT', abort)
  }
}
