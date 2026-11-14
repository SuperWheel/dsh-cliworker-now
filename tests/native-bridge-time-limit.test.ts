import { afterEach, expect, it, onTestFinished } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareNativeWorker } from '../src/host/native-worker.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
import { workerArguments } from '../src/host/adapters.ts'

// SIMULATED: a synthetic silent CLI process under the real bridge script. No
// installed CLI, account or model is used.
const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function bridge(
  limit: { totalMs: number; idleMs: number },
  output: {
    cli?: 'antigravity' | 'claude'
    stderrEveryMs?: number
    keepAliveEveryMs?: number
    /** Runs only after the real synthetic child reports readiness. */
    whileRunning?: (launch: Awaited<ReturnType<typeof prepareNativeWorker>>, clock: { advance: (ms: number, finish?: boolean) => Promise<void>; renewed: () => Promise<void> }) => Promise<void>
  } = {},
) {
  const cli = output.cli ?? 'antigravity'
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-bridge-time-limit-')))
  directories.push(directory)
  const executable = join(directory, 'synthetic-cli.mjs'),
    pidFile = join(directory, 'pid')
  // Never answers; optionally writes diagnostics, which count as native output.
  writeFileSync(
    executable,
    `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
// The runner first confirms Antigravity's native modes from --help.
if (process.argv.includes('--help')) { console.log('  --mode Set mode (accept-edits, auto, plan)'); process.exit(0) }
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))
process.stderr.write('SIMULATED ready\\n')
${output.stderrEveryMs ? `setInterval(() => process.stderr.write('SIMULATED progress\\n'), ${output.stderrEveryMs})` : ''}
${output.keepAliveEveryMs ? `setInterval(() => process.stdout.write(JSON.stringify({ type: 'keep_alive' }) + '\\n'), ${output.keepAliveEveryMs})` : ''}
setInterval(() => {}, 60000)
`,
    { mode: 0o700 },
  )
  const prompt = 'SIMULATED silent task'
  const startedAt = Date.now()
  const preference = { cli, model: 'synthetic-model', effort: 'default' as const }
  const launch = await prepareNativeWorker(
    { argv: workerArguments(executable, directory, preference, 'accept-edits', prompt, limit.totalMs, undefined, true) },
    {
      cli,
      project: directory,
      preference,
      mode: 'accept-edits',
      prompt,
      stateDirectory: directory,
    },
    { ...DEFAULT_CONFIG, timeLimit: { deadlineAt: startedAt + limit.totalMs, ...limit } },
  )
  const bootstrap = fileURLToPath(new URL('./fixtures/clocked-native-bridge.mjs', import.meta.url))
  const child = spawn(launch.argv[0]!, [bootstrap, ...launch.argv.slice(1), String(startedAt)], {
    cwd: directory,
    env: { ...process.env, ...launch.env },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let stdout = '', stderr = '', elapsed = 0, sequence = 0
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk))
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  // A failed startup reports the bridge evidence instead of polling a missing PID forever.
  const exitedEarly = closed.then(() => { throw new Error(`Bridge exited before readiness: ${stdout} ${stderr}`) })
  void exitedEarly.catch(() => {})
  const waitMessage = (matches: (message: any) => boolean) => {
    let listener: (message: any) => void
    const received = new Promise<any>(resolve => {
      listener = message => { if (matches(message)) resolve(message) }
      child.on('message', listener)
    })
    return Promise.race([received, exitedEarly]).finally(() => child.off('message', listener))
  }
  const clock = {
    async advance(milliseconds: number, finish = false) {
      const id = ++sequence
      const advanced = waitMessage(message => message.type === 'advanced' && message.id === id)
      child.send({ id, milliseconds, finish })
      elapsed = (await advanced).now - startedAt
    },
    async renewed() {
      // Observe the real runner rearming the idle timer after consuming native output.
      await waitMessage(message => message.type === 'scheduled' && message.delay === limit.idleMs)
    },
  }
  const ready = new Promise<void>(resolve => {
    child.stderr.setEncoding('utf8').on('data', chunk => {
      stderr += chunk
      if (stderr.includes('SIMULATED ready')) resolve()
    })
  })
  let cleanup: Promise<void> | undefined
  const close = () => cleanup ??= (async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      await closed
    }
    await launch.cleanup()
  })()
  onTestFinished(close)
  try {
    await Promise.race([ready, exitedEarly])
    if (output.whileRunning) await output.whileRunning(launch, clock)
    else if (output.stderrEveryMs || output.keepAliveEveryMs) {
      // Advance less than one idle window, then wait for native output to renew it.
      // Total time still reaches exactly the original shared deadline.
      while (elapsed + 500 < limit.totalMs) {
        await clock.advance(500)
        await clock.renewed()
      }
      await clock.advance(limit.totalMs - elapsed, true)
    } else await clock.advance(limit.idleMs, true)
    const code = await closed
    const pid = Number(readFileSync(pidFile, 'utf8'))
    const frames = stdout.trim().split('\n').map((line) => JSON.parse(line))
    return { code, frames, result: frames.at(-1), elapsed, cliAlive: alive(pid) }
  } finally {
    // Preserve process cleanup even if a readiness/control assertion fails.
    await close()
  }
}

it('stops a silent CLI on the idle window and exits only after the CLI process is gone', async () => {
  const run = await bridge({ totalMs: 20_000, idleMs: 400 })
  expect(run.code).toBe(0)
  expect(run.result).toMatchObject({ type: 'result', status: 'ERROR', error: 'Native task idle timed out' })
  expect(run.elapsed).toBe(400)
  expect(run.cliAlive).toBe(false)
}, 30_000)

it('renews the idle window on native output and stops on the shared deadline instead', async () => {
  const run = await bridge({ totalMs: 1500, idleMs: 600 }, { stderrEveryMs: 100 })
  expect(run.result).toMatchObject({ type: 'result', status: 'ERROR', error: 'Native task timed out' })
  expect(run.elapsed).toBe(1500)
  expect(run.cliAlive).toBe(false)
}, 30_000)

it('renews the idle window on heartbeats a runner drops before forwarding', async () => {
  // Claude keep_alive frames never reach a public event, yet the CLI is alive.
  const run = await bridge({ totalMs: 1500, idleMs: 600 }, { cli: 'claude', keepAliveEveryMs: 100 })
  expect(run.result).toMatchObject({ type: 'result', status: 'ERROR', error: 'Native task timed out' })
  expect(run.frames.some((frame) => JSON.stringify(frame).includes('keep_alive'))).toBe(false)
  expect(run.elapsed).toBe(1500)
  expect(run.cliAlive).toBe(false)
}, 30_000)

it('pauses the idle window while the Host holds it for a DSH tool approval', async () => {
  let releasedAt = 0
  const run = await bridge({ totalMs: 20_000, idleMs: 400 }, {
    whileRunning: async (launch, clock) => {
      await launch.holdIdle('idle-1', 'hold')
      // Three idle windows pass while the user decides.
      await clock.advance(1200)
      releasedAt = Date.now()
      await launch.holdIdle('idle-1', 'release')
      await clock.advance(399)
      await clock.advance(1, true)
    },
  })
  expect(run.result).toMatchObject({ type: 'result', status: 'ERROR', error: 'Native task idle timed out' })
  expect(releasedAt).toBeGreaterThan(0)
  expect(run.elapsed).toBe(1600)
  expect(run.cliAlive).toBe(false)
}, 30_000)
