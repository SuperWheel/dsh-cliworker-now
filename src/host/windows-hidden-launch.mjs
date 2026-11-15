// A GUI-subsystem Electron root avoids Windows Terminal's console delegation.
// The enclosing Harness Job still owns this root and every native descendant.
import { Socket } from 'node:net'
import { forwardNativeStdio, spawnNativeProcess } from './native-spawn.mjs'

// Pinned Harness 0.2.0-rc.2 public control contract. This helper must remain
// self-contained: an ordinary child does not use the Host's SDK module loader.
const marker = process.env.DSH_SUBPROCESS_CONTROL
delete process.env.DSH_SUBPROCESS_CONTROL
if (marker !== 'pipe') throw new Error('Windows background control channel is unavailable')
// Receipts are write-only. Reading this inherited Windows pipe keeps a read
// operation alive after the receipt flush and prevents the relay from exiting.
const control = new Socket({ fd: 7, readable: false, writable: true, allowHalfOpen: true })
let child, sent = false
function receipt(value) {
  if (sent) return
  sent = true
  control.end(JSON.stringify(value) + '\n', () => control.destroy())
}
control.on('error', () => {
  child?.kill('SIGTERM')
  process.exitCode = 1
})
try {
  const [encoded, executable, ...argv] = process.argv.slice(2)
  const restore = JSON.parse(encoded)
  if (!restore || !Object.hasOwn(restore, 'nodeEnv') ||
      (restore.nodeEnv !== null && typeof restore.nodeEnv !== 'string') || !executable)
    throw new Error('Invalid fixed bootstrap arguments')
  if (restore.privateUmask === true) process.umask(0o077)
  // ELECTRON_RUN_AS_NODE belongs only to this GUI bootstrap. Preserve the
  // original target environment, including an explicit deletion of that value.
  const env = { ...process.env }
  for (const key of Object.keys(env))
    if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[key]
  if (restore.nodeEnv !== null) env.ELECTRON_RUN_AS_NODE = restore.nodeEnv
  child = spawnNativeProcess(executable, argv, { env, stdio: ['pipe', 'pipe', 'pipe'], detached: false },
    { visibleWindow: restore.visibleWindow === true })
  forwardNativeStdio(child)
  child.once('error', error => receipt({
    kind: 'spawn-error',
    code: ['ENOENT', 'EACCES', 'ENOEXEC', 'EINVAL'].includes(error.code) ? error.code : 'UNKNOWN',
  }))
  // A descendant may keep these pipes open after the native parent exits.
  // Report its actual exit now; keep forwarding bytes until the pipes close.
  // The Host's original Job remains responsible for the entire process range.
  child.once('exit', (exitCode, signal) => receipt({ kind: 'exit', exitCode, signal }))
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => child.kill(signal))
} catch {
  receipt({ kind: 'spawn-error', code: 'UNKNOWN' })
}
