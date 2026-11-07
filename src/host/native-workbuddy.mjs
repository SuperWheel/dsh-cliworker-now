import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { runNativeAcp } from './native-acp.mjs'
import { createLinePeer, createNativeIO } from './native-transport.mjs'
import { createWorkBuddyLaunch } from './workbuddy-bootstrap.mjs'

const unavailable = reason => Object.assign(new Error(`WorkBuddy 暂不可用：${reason}`), { code: 'WORKBUDDY_UNAVAILABLE', reason })
const efforts = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const cliValid = cli => cli === 'workbuddycn' || cli === 'workbuddy'

export function workbuddyAcpArgv(config) {
  if (!cliValid(config.cli) || !Array.isArray(config.argv) || config.argv.length < 2 ||
      config.argv.some(value => typeof value !== 'string' || !value || value.includes('\0')) ||
      basename(config.argv[1]) !== 'codebuddy-lite-wb.mjs') throw unavailable('entry-invalid')
  return [...config.argv.slice(0, 2), '--acp', '--setting-sources', 'user', '--strict-mcp-config',
    '--serve', '--host', '127.0.0.1', '--port', '0', '--auth', 'password']
}

/** Independent startup identity check. This runtime is copied as plain ESM and
 * intentionally does not import the Host's TypeScript discovery module. */
async function revalidate(config) {
  const argv = workbuddyAcpArgv(config), entry = resolve(argv[1]), runtime = resolve(argv[0])
  const root = dirname(dirname(entry))
  try {
    const read = async name => {
      const file = join(root, name), info = await stat(file)
      if (!info.isFile() || info.size > 1048576) throw unavailable('metadata-invalid')
      return JSON.parse(await readFile(file, 'utf8'))
    }
    const [pkg, product] = await Promise.all([read('package.json'), read('product.json')])
    if (pkg?.name !== '@genie/agent-cli') throw unavailable('package-mismatch')
    const endpoint = new URL(product.endpoint)
    // Defense in depth, matching workbuddy-variant.ts; never accept a Host-provided site override.
    const domain = `workbuddy.${config.cli === 'workbuddycn' ? 'cn' : 'ai'}`
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password ||
        ![domain, `www.${domain}`].includes(endpoint.hostname)) throw unavailable('variant-mismatch')
    if (typeof product.dataFolderName !== 'string' || !/^\.[A-Za-z0-9._-]+$/.test(product.dataFolderName) || product.dataFolderName === '..')
      throw unavailable('data-folder-invalid')
    if (basename(root) !== 'cli' || basename(dirname(root)) !== 'app.asar.unpacked') throw unavailable('entry-invalid')
    const resources = dirname(dirname(root)), mac = basename(resources) === 'Resources' && basename(dirname(resources)) === 'Contents'
    const appRoot = mac ? dirname(dirname(resources)) : dirname(resources)
    if (mac ? runtime !== join(appRoot, 'Contents', 'MacOS', 'Electron')
      : basename(resources) !== 'resources' || dirname(runtime) !== appRoot || !/\.exe$/i.test(runtime) || /unins|uninstall|crash|update/i.test(basename(runtime)))
      throw unavailable('runtime-mismatch')
    if (!(await stat(entry)).isFile() || !(await stat(runtime)).isFile()) throw unavailable('entry-missing')
    return { cli: config.cli, runtime, entry, appRoot, endpoint: product.endpoint, productName: product.productName,
      cliVersion: pkg.version, dataFolderName: product.dataFolderName, configDir: join(config.home ?? homedir(), product.dataFolderName) }
  } catch (error) {
    if (error?.code === 'WORKBUDDY_UNAVAILABLE') throw error
    throw unavailable('installation-invalid')
  }
}

/** Gate stdio before initialize; only the gate sees pre-ready banner bytes. */
async function openWorkBuddy(config, io, options = {}) {
  let launch, owned, peer, isReady = false, issue
  let rejectFailure
  const failed = new Promise((_, reject) => { rejectFailure = reject })
  void failed.catch(() => {})
  const fail = reason => { issue ??= unavailable(reason); rejectFailure(issue) }
  const abort = () => fail('stopped')
  const decoder = new StringDecoder('utf8')
  let buffer = '', lines = 0, bytes = 0
  const beforeReady = chunk => {
    if (isReady) { peer.feed(chunk); return }
    buffer += decoder.write(chunk)
    let end
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end), size = Buffer.byteLength(line) + 1
      buffer = buffer.slice(end + 1)
      try { JSON.parse(line) }
      catch {
        lines++; bytes += size
        if (lines > 32 || bytes > 16384) fail('banner-limit')
        continue
      }
      // JSON is already protocol data, not a banner. Preserve native validation.
      peer.feed(Buffer.from(line + '\n'))
    }
    if (Buffer.byteLength(buffer) + bytes > 16384) fail('banner-limit')
  }
  try {
    io.signal?.throwIfAborted()
    const install = await revalidate(config)
    launch = await createWorkBuddyLaunch({ install, baseEnv: config.env, signal: io.signal })
    io.signal?.addEventListener('abort', abort, { once: true })
    io.signal?.throwIfAborted()
    const early = []
    owned = io.spawn(workbuddyAcpArgv(config), { env: launch.env, cwd: config.project,
      onStdout: chunk => peer ? beforeReady(chunk) : early.push(chunk) })
    peer = createLinePeer(owned, { ...options, signal: io.signal, maxLineBytes: config.maxLineBytes,
      maxInboundLineBytes: config.maxNativeLineBytes ?? config.maxLineBytes })
    for (const chunk of early) beforeReady(chunk)
    void owned.done.then(() => { if (!isReady) fail('cli-exited-before-ready') }, () => fail('cli-failed'))
    await Promise.race([launch.deliver(io, owned.process.pid), failed])
    await Promise.race([launch.ready(Math.min(config.timeoutMs ?? 20000, 20000)), failed])
    if (issue) throw issue
    io.signal?.throwIfAborted()
    // An unterminated pre-ready banner is never fed into JSON parsing/error text.
    buffer += decoder.end()
    if (buffer) {
      if (++lines > 32 || bytes + Buffer.byteLength(buffer) > 16384) throw unavailable('banner-limit')
      buffer = ''
    }
    isReady = true
    const originalClose = peer.close
    let closing
    peer.close = () => closing ??= (async () => {
      try { await originalClose() }
      finally { io.signal?.removeEventListener('abort', abort); await launch.close() }
    })()
    return { peer, install }
  } catch (error) {
    io.signal?.removeEventListener('abort', abort)
    // Stop only registered CLI/helper children, then remove the rendezvous paths.
    try { await io.stopChildren() }
    finally { await launch?.close() }
    if (error?.code === 'WORKBUDDY_UNAVAILABLE') throw error
    throw unavailable(io.signal?.aborted ? 'stopped' : 'launch-failed')
  }
}

export async function runNativeWorkBuddy(config, io) {
  if (!['plan', 'accept-edits'].includes(config.mode) ||
      (config.access !== undefined && !['read-only', 'workspace-write', 'danger-full-access'].includes(config.access)))
    throw unavailable('permission-invalid')
  if (config.preference?.effort !== 'default' && !efforts.includes(config.preference?.effort)) throw unavailable('effort-invalid')
  const wrapped = Object.create(io)
  wrapped.openStdio = async (_argv, options) => (await openWorkBuddy(config, io, options)).peer
  // Option names are shared with the other CodeBuddy-derived ACP runners.
  await runNativeAcp({ ...config, harnessTools: undefined, env: { ...config.env, CLIWORKER_HARNESS_TOOLS: undefined } }, wrapped, {
    name: config.cli === 'workbuddycn' ? 'WorkBuddy' : 'WorkBuddy AI', argv: workbuddyAcpArgv,
    effortId: 'thought_level', modeConfigId: 'mode', encode: value => value,
    editMode: config.access === 'danger-full-access' ? 'bypassPermissions' : config.access === 'read-only' ? 'default' : 'auto',
    fallbackModes: config.access === 'danger-full-access' ? ['auto', 'default'] : config.access === 'read-only' ? [] : ['default'],
    approvalFromToolCall: true,
    deniedCancelEndsTurn: true,
  })
}

/** Plugin efforts this model actually exposes; `default` (no change) is always available.
 * An unreadable list leaves only the native default instead of borrowing another model's. */
export function workbuddyEffortOptions(configOptions, metaEfforts) {
  const native = Array.isArray(configOptions)
    ? values(configOptions.find(option => option?.id === 'thought_level')?.options) : []
  const declared = Array.isArray(metaEfforts) ? metaEfforts : undefined
  return ['default', ...efforts.filter(value => native.includes(value) && (!declared || declared.includes(value)))]
}

const values = options => Array.isArray(options) ? options.flatMap(option => Array.isArray(option?.options)
  ? values(option.options) : typeof option?.value === 'string' ? [option.value] : []) : []

/** This intentionally creates and discards one empty native session. No prompt,
 * account files, model execution, or credential source fingerprint is involved. */
export async function probeWorkBuddyMetadata(input, suppliedIo) {
  const config = { maxLineBytes: 1048576, maxRunBytes: 8388608, timeoutMs: 20000, ...input }
  const signal = input.signal ?? suppliedIo?.signal ?? new AbortController().signal
  const io = suppliedIo ?? createNativeIO(config, () => {}, signal)
  let peer, stopPromise
  const stop = () => {
    stopPromise ??= io.stopChildren()
    void stopPromise.catch(() => {})
  }
  signal.addEventListener('abort', stop, { once: true })
  try {
    signal.throwIfAborted()
    const opened = await openWorkBuddy(config, io, { onMessage: message => {
      if (peer && message?.method && message.id !== undefined)
        return peer.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Metadata probe does not accept requests' } })
    } })
    peer = opened.peer
    const initialized = await peer.request('initialize', { protocolVersion: 1, clientCapabilities: {},
      clientInfo: { name: 'dsh-cliworker-now' } }, { jsonrpc: true, timeoutMs: config.timeoutMs })
    if (initialized?.protocolVersion !== 1) throw unavailable('protocol-invalid')
    let state
    try {
      state = await peer.request('session/new', { cwd: config.project, mcpServers: [] }, { jsonrpc: true, timeoutMs: config.timeoutMs })
    } catch (error) {
      if ([-32000, -32001, 401, 403].includes(error?.code) || /auth|log.?in|sign.?in|unauthori|登录|认证/i.test(error?.message ?? ''))
        throw Object.assign(new Error('请打开 WorkBuddy 桌面端登录后重试'), { code: 'CLI_OWN_ACCOUNT_REQUIRED' })
      throw error
    }
    if (typeof state?.sessionId !== 'string' || !state.sessionId.trim() || !Array.isArray(state?.models?.availableModels))
      throw unavailable('metadata-invalid')
    const effortOptions = workbuddyEffortOptions(state.configOptions)
    const available = state.models.availableModels.filter(model => typeof model?.modelId === 'string' && model.modelId.trim() && typeof model.name === 'string')
    if (!available.length) throw unavailable('models-unavailable')
    // thought_level differs per model (WorkBuddy 5.9.3): read it after switching to each model.
    const models = []
    for (const model of available) {
      signal.throwIfAborted()
      let options
      try {
        options = (await peer.request('session/set_config_option', { sessionId: state.sessionId, configId: 'model', value: model.modelId },
          { jsonrpc: true, timeoutMs: config.timeoutMs }))?.configOptions
      } catch (error) {
        signal.throwIfAborted()
        if (error?.code === undefined) throw error
      }
      models.push({ id: model.modelId, label: model.name, efforts: workbuddyEffortOptions(options, model._meta?.effortOptions) })
    }
    signal.throwIfAborted()
    return { cli: config.cli, endpoint: opened.install.endpoint, authenticated: true, models,
      effortOptions, initialized, session: state }
  } finally {
    signal.removeEventListener('abort', stop)
    try { await peer?.close() }
    finally { await (stopPromise ?? io.stopChildren()) }
  }
}
