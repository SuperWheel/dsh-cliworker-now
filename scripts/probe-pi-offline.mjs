// Real installed Pi, metadata only. No credentials, prompt, login, or model calls.
// Usage: node scripts/probe-pi-offline.mjs /absolute/path/to/pi
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inspectPiInstallation } from '../src/host/pi-installation.mjs'
import { preparePiPermissionGate } from '../src/host/pi-permission-gate.mjs'
import { preparePiContextObserver } from '../src/host/pi-context-observer.mjs'

process.umask(0o077)
assert(process.argv.length === 3, 'Pass exactly one installed Pi executable')
const installation = inspectPiInstallation(resolve(process.argv[2]))
const root = await realpath(await mkdtemp(join(tmpdir(), 'cliworker-pi-offline-')))
const agent = join(root, 'agent'), workspace = join(root, 'workspace')
for (const dir of [agent, workspace, join(agent, 'sessions')]) await mkdir(dir, { recursive: true, mode: 0o700 })
const save = (file, value) => writeFile(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2), { mode: 0o600 })
await save(join(agent, 'auth.json'), {})
await save(join(agent, 'models.json'), { providers: {} })
await save(join(agent, 'native-env.json'), {})
await save(join(agent, 'settings.json'), { cacheWarming: 'off' })
// Fail any accidental networking in this probe, including native module imports.
const guard = join(root, 'no-network.cjs')
await save(guard, `const net = require('node:net');
net.Socket.prototype.connect = function () { throw new Error('OFFLINE_PROBE_NETWORK_FORBIDDEN') };
globalThis.fetch = async () => { throw new Error('OFFLINE_PROBE_NETWORK_FORBIDDEN') };
require('node:module').syncBuiltinESMExports();
`)
const env = {
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  HOME: root, USERPROFILE: root, PI_CODING_AGENT_DIR: agent,
  XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'),
  TMPDIR: root, TMP: root, TEMP: root, PI_OFFLINE: '1', PI_TELEMETRY: '0',
  ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1', NODE_OPTIONS: `--require=${guard}`,
}
const host = fileURLToPath(new URL('../src/host/', import.meta.url))
const records = []
async function run(name, argv, { commands = [], extraEnv = {}, ready = false, cwd = workspace } = {}) {
  assert(commands.every(c => ['get_state', 'get_available_models', 'get_session_stats', 'get_messages', 'get_commands', 'abort'].includes(c.type)))
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...env, ...extraEnv }, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe', 'pipe'] })
  const events = [], side = [], replies = new Map()
  let stdout = '', stderr = '', partial = '', sidePartial = '', timedOut = false, bytes = 0, force
  const signal = (sig) => { try { process.platform === 'win32' ? child.kill(sig) : process.kill(-child.pid, sig) } catch (e) { if (e.code !== 'ESRCH') throw e } }
  const terminate = () => { signal('SIGTERM'); force ??= setTimeout(() => signal('SIGKILL'), 2000) }
  const interrupted = () => { timedOut = true; terminate() }
  process.once('SIGINT', interrupted)
  process.once('SIGTERM', interrupted)
  const maybeEnd = () => {
    if (commands.length && commands.every(c => replies.has(c.id)) && (!ready || side.some(e => e.type === 'cliworker.pi_permission_gate' && e.ready) && side.some(e => e.type === 'probe.context_loaded'))) child.stdin.end()
  }
  const consume = (chunk, channel) => {
    bytes += Buffer.byteLength(chunk)
    if (bytes > 16 * 1024 * 1024) { terminate(); return }
    if (channel === 'stderr') { stderr += chunk; return }
    if (channel === 'stdout') { stdout += chunk; partial += chunk } else sidePartial += chunk
    let pending = channel === 'stdout' ? partial : sidePartial
    while (pending.includes('\n')) {
      const end = pending.indexOf('\n'), line = pending.slice(0, end); pending = pending.slice(end + 1)
      try {
        const event = JSON.parse(line)
        if (channel === 'stdout') { events.push(event); if (event.type === 'response') replies.set(event.id, event) }
        else side.push(event)
      } catch { /* --version is plain text */ }
    }
    if (channel === 'stdout') partial = pending; else sidePartial = pending
    maybeEnd()
  }
  child.stdout.setEncoding('utf8').on('data', c => consume(c, 'stdout'))
  child.stderr.setEncoding('utf8').on('data', c => consume(c, 'stderr'))
  child.stdio[3].setEncoding('utf8').on('data', c => consume(c, 'side'))
  child.stdin.on('error', () => {})
  const timer = setTimeout(() => { timedOut = true; terminate() }, 25000)
  let exit
  try {
    const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })) })
    for (const c of commands) child.stdin.write(JSON.stringify(c) + '\n')
    if (!commands.length) child.stdin.end()
    exit = await done
  } finally {
    clearTimeout(timer); clearTimeout(force)
    process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted)
  }
  let processGroupExited = true
  if (child.pid && process.platform !== 'win32') {
    try { process.kill(-child.pid, 0); processGroupExited = false; signal('SIGKILL') } catch (e) { if (e.code !== 'ESRCH') throw e }
  }
  await save(join(root, name + '.stdout'), stdout)
  await save(join(root, name + '.stderr'), stderr)
  await save(join(root, name + '.side.json'), side)
  const record = { name, argv, cwd, ...exit, timedOut, processGroupExited, eventTypes: [...new Set(events.map(e => e.type ?? e.phase ?? 'metadata'))], sideTypes: side.map(e => e.type), responses: [...replies.values()].map(e => ({ id: e.id, command: e.command, success: e.success })) }
  records.push(record)
  console.log(JSON.stringify(record))
  assert.equal(exit.code, 0, name + ' exit')
  assert(!timedOut && processGroupExited && bytes <= 16 * 1024 * 1024)
  assert(!stderr.includes('OFFLINE_PROBE_NETWORK_FORBIDDEN'))
  assert(commands.every(c => replies.get(c.id)?.success === true))
  assert(!events.some(e => ['agent_start', 'message_start', 'tool_execution_start', 'extension_error'].includes(e.type)))
  return { stdout, events, side, replies }
}
try {
  const version = await run('version', [process.execPath, installation.executable, '--version'])
  assert.equal(version.stdout.trim(), installation.version)
  const gate = await preparePiPermissionGate(installation.executable, 'read-only')
  const context = await preparePiContextObserver(installation.executable)
  assert(gate && context.nonce, 'Both real extension capabilities must be present')
  // Wrap only to observe registration; invoke the unmodified production extension.
  const contextWrapper = join(root, 'observe-context.mjs')
  await save(contextWrapper, `import observer from ${JSON.stringify(pathToFileURL(join(host, 'pi-context-observer.mjs')).href)};
import { writeSync } from 'node:fs';
export default async function(api) {
 let registered = false;
 await observer(new Proxy(api, { get(target, prop) { if(prop === 'on') return (name, fn) => { if(name === 'context_with_system') registered = true; return target.on(name, fn) }; return target[prop] } }));
 if(registered) writeSync(3, JSON.stringify({type:'probe.context_loaded'})+'\\n');
}
`)
  const isolation = ['--mode', 'rpc', '--no-session', '--no-tools', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-approve']
  const rpc = await run('rpc', [process.execPath, installation.executable, ...isolation, ...gate.argv, '--extension', contextWrapper], {
    extraEnv: { ...gate.env, ...context.env }, ready: true,
    commands: ['get_state', 'get_available_models', 'get_session_stats', 'get_messages', 'get_commands', 'abort'].map(type => ({ id: type, type })),
  })
  assert.equal(rpc.replies.get('get_state').data.isStreaming, false)
  assert.equal(rpc.replies.get('get_messages').data.messages.length, 0)
  assert(rpc.side.some(e => e.type === 'cliworker.pi_permission_gate' && e.ready))
  assert(rpc.side.some(e => e.type === 'probe.context_loaded'))
  const requestDir = join(root, 'request'); await mkdir(requestDir)
  const request = join(requestDir, 'config.json')
  await save(request, { cli: 'pi', executable: installation.executable, stateDirectory: root, project: workspace, metadataPhase: 'native-candidates' })
  const bridge = await run('plugin-native-candidates', [process.execPath, join(host, 'pi-omp-bridge.mjs'), request])
  assert(bridge.events.some(e => e.phase === 'native-candidates' && e.count === 0))
  const providers = await run('plugin-login-providers', [process.execPath, join(host, 'native-login-providers.mjs'), 'pi', installation.executable], { cwd: root, extraEnv: { CLIWORKER_LOGIN_METADATA_HOME: root } })
  assert(JSON.parse(providers.stdout).providers.length > 0)
  const sdkFile = join(root, 'sdk.mjs')
  await save(sdkFile, `import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const sdk = await import(${JSON.stringify(pathToFileURL(join(installation.dist, 'index.js')).href)});
for (const name of ['createAgentSessionServices','createAgentSessionFromServices','createAgentSessionRuntime']) assert.equal(typeof sdk[name], 'function');
for (const name of ['init','handleLoginCommand','showOAuthSelector','run']) assert.equal(typeof sdk.InteractiveMode.prototype[name], 'function');
const {AuthStorage} = await import(${JSON.stringify(pathToFileURL(join(installation.dist, 'core/auth-storage.js')).href)});
const runtime = await sdk.ModelRuntime.create({credentials:AuthStorage.inMemory(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
const models = runtime.getAllModels(); assert(models.length > 0);
assert.equal(runtime.getAvailableSnapshot().length,0);
const sessions = await sdk.SessionManager.list(${JSON.stringify(workspace)},${JSON.stringify(join(agent, 'sessions'))}); assert.equal(sessions.length,0);
const all = await sdk.SessionManager.listAll(${JSON.stringify(join(agent, 'sessions'))}); assert.equal(all.length,0);
console.log(JSON.stringify({version:${JSON.stringify(installation.version)},models:models.length,providers:runtime.getProviders().length,available:0,sessions:sessions.length,allSessions:all.length,loginSdk:true}));
`)
  const sdk = await run('sdk-catalog-sessions', [process.execPath, sdkFile])
  const report = { installation, root, promptCount: 0, modelCalls: 0, authentication: 'empty isolated HOME; no real credentials read', catalog: JSON.parse(sdk.stdout), records }
  await save(join(root, 'report.json'), report)
  console.log(JSON.stringify({ report: join(root, 'report.json'), ...report.catalog, promptCount: 0, modelCalls: 0 }))
} catch (error) {
  await save(join(root, 'failure.json'), { records, error: String(error) })
  console.error('Probe failed; isolated evidence: ' + root)
  throw error
}
