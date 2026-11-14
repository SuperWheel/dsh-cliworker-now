// SIMULATED clock only. The bridge, control mailboxes, pipes and CLI processes
// remain real. Advance time after observable readiness, never during OS startup.
import { mock } from 'node:test'
import { pathToFileURL } from 'node:url'

const [bridge, request, now] = process.argv.slice(2)
mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Number(now) })
const schedule = globalThis.setTimeout
globalThis.setTimeout = (callback, delay, ...args) => {
  const timer = schedule(callback, delay, ...args)
  process.send?.({ type: 'scheduled', delay })
  return timer
}
let cleanupClock
const resume = () => { cleanupClock ??= setInterval(() => mock.timers.tick(25), 25) }
const advance = ({ id, milliseconds, finish }) => {
  mock.timers.tick(milliseconds)
  process.send?.({ type: 'advanced', id, now: Date.now() })
  // Process termination has its own grace periods. Once the tested expiration
  // fired, let those timers run at real speed rather than freezing cleanup.
  if (finish) resume()
}
process.on('message', advance)
process.on('SIGTERM', resume)
process.argv = [process.execPath, bridge, request]
try {
  await import(pathToFileURL(bridge).href)
} finally {
  clearInterval(cleanupClock)
  mock.timers.reset()
  process.off('message', advance)
  process.off('SIGTERM', resume)
  process.disconnect()
}
