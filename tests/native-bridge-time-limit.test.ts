import { afterEach, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    /** Runs once the synthetic CLI has started under the bridge. */
    whileRunning?: (launch: Awaited<ReturnType<typeof prepareNativeWorker>>) => Promise<void>
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
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))
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
  try {
    const child = spawn(launch.argv[0]!, launch.argv.slice(1), {
      cwd: directory,
      env: { ...process.env, ...launch.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk))
    child.stderr.resume()
    const closed = new Promise<number | null>((resolve) => child.once('close', resolve))
    if (output.whileRunning) {
      while (!existsSync(pidFile)) await new Promise((resolve) => setTimeout(resolve, 10))
      await output.whileRunning(launch)
    }
    const code = await closed
    const pid = Number(readFileSync(pidFile, 'utf8'))
    const frames = stdout.trim().split('\n').map((line) => JSON.parse(line))
    return { code, frames, result: frames.at(-1), elapsed: Date.now() - startedAt, cliAlive: alive(pid) }
  } finally {
    await launch.cleanup()
  }
}

it('stops a silent CLI on the idle window and exits only after the CLI process is gone', async () => {
  const run = await bridge({ totalMs: 20_000, idleMs: 400 })
  expect(run.code).toBe(0)
  expect(run.result).toMatchObject({ type: 'result', status: 'ERROR', error: 'Native task idle timed out' })
  expect(run.elapsed).toBeLessThan(15_000)
  expect(run.cliAlive).toBe(false)
}, 30_000)

it('renews the idle window on native output and stops on the shared deadline instead', async () => {
  const run = await bridge({ totalMs: 1500, idleMs: 600 }, { stderrEveryMs: 100 })
  expect(run.result).toMatchObject({ type: 'result', status: 'ERROR', error: 'Native task timed out' })
  expect(run.elapsed).toBeGreaterThanOrEqual(1400)
  expect(run.cliAlive).toBe(false)
}, 30_000)

it('renews the idle window on heartbeats a runner drops before forwarding', async () => {
  // Claude keep_alive frames never reach a public event, yet the CLI is alive.
  const run = await bridge({ totalMs: 1500, idleMs: 600 }, { cli: 'claude', keepAliveEveryMs: 100 })
  expect(run.result).toMatchObject({ type: 'result', status: 'ERROR', error: 'Native task timed out' })
  expect(run.frames.some((frame) => JSON.stringify(frame).includes('keep_alive'))).toBe(false)
  expect(run.cliAlive).toBe(false)
}, 30_000)

it('pauses the idle window while the Host holds it for a DSH tool approval', async () => {
  let releasedAt = 0
  const run = await bridge({ totalMs: 20_000, idleMs: 400 }, {
    whileRunning: async (launch) => {
      await launch.holdIdle('idle-1', 'hold')
      // Three idle windows pass while the user decides.
      await new Promise((resolve) => setTimeout(resolve, 1200))
      releasedAt = Date.now()
      await launch.holdIdle('idle-1', 'release')
    },
  })
  expect(run.result).toMatchObject({ type: 'result', status: 'ERROR', error: 'Native task idle timed out' })
  expect(releasedAt).toBeGreaterThan(0)
  expect(run.elapsed).toBeGreaterThanOrEqual(1500)
  expect(run.cliAlive).toBe(false)
}, 30_000)
