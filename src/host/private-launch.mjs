// Set a private file-creation mask without mutating the shared Harness process.
import { forwardNativeStdio, spawnNativeProcess } from './native-spawn.mjs'
import { nativeLaunchArgv } from './native-launch.mjs'
import { setPriority, constants } from 'node:os'
process.umask(0o077)
const args = process.argv.slice(2)
const lowPriority = args[0] === '--cliworker-low-priority'
if (lowPriority) args.shift()
const lowerPriority = pid => {
  if (lowPriority && pid) try { setPriority(pid, process.platform === 'win32' ? constants.priority.PRIORITY_BELOW_NORMAL : 10) } catch { /* A best-effort scheduling hint. */ }
}
lowerPriority(process.pid)
const [executable, ...argv] = nativeLaunchArgv(args)
// This helper is also used under POSIX PTYs, whose original handles must stay.
// Windows ConPTY account launch unwraps it in windows-account-launch.mjs.
const backgroundPipes = process.platform === 'win32'
const child = spawnNativeProcess(executable, argv, { env: process.env, stdio: backgroundPipes ? ['pipe', 'pipe', 'pipe'] : 'inherit' })
lowerPriority(child.pid)
if (backgroundPipes) forwardNativeStdio(child)
let stopped = false
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    stopped = true
    child.kill(signal)
  })
child.on('error', () => {
  process.stderr.write('CLI launch failed\n')
  process.exitCode = 1
})
child.on('close', (code, signal) => {
  process.exitCode = stopped || signal ? 143 : (code ?? 1)
})
