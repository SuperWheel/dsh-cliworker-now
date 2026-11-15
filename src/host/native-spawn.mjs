import { spawn } from 'node:child_process'

/** Native CLI descendants keep their pipes/ConPTY and the enclosing Host Job.
 * Window presentation is per child: hiding a wrapper does not hide its children.
 * Node ignores windowsHide on POSIX, so both platforms use this one boundary.
 */
export function spawnNativeProcess(executable, argv, options, presentation = {}) {
  // Only a Host-verified GUI installer that needs the user (UAC/wizard) is shown.
  return spawn(executable, argv, { ...options, windowsHide: presentation.visibleWindow !== true })
}

/** Relay ordinary background pipes as bytes with Node's stream backpressure.
 * Numeric/inherited descriptors make libuv omit CREATE_NO_WINDOW on Windows.
 * This must never be used for a ConPTY: its console handles stay inherited. */
export function forwardNativeStdio(child) {
  const stopInput = () => {
    process.stdin.unpipe(child.stdin)
    process.stdin.destroy()
  }
  const fail = () => { child.kill('SIGTERM'); process.exitCode = 1 }
  child.stdin.on('error', error => { stopInput(); if (error.code !== 'EPIPE') fail() })
  child.stdin.once('close', stopInput)
  child.once('exit', stopInput)
  child.once('error', stopInput)
  process.stdin.on('error', fail)
  process.stdout.on('error', fail)
  process.stderr.on('error', fail)
  child.stdout.on('error', fail)
  child.stderr.on('error', fail)
  process.stdin.pipe(child.stdin)
  child.stdout.pipe(process.stdout, { end: false })
  child.stderr.pipe(process.stderr, { end: false })
}
