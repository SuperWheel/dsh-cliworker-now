import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { WorkerRuntime as NativeWorkerRuntime } from '../src/host/runtime.ts'
import { WorkerRuntime as LegacyWorkerRuntime } from './fixtures/legacy-runtime.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
import { BRIDGE_TIME_LIMIT_ERRORS } from '../src/host/task-time-limit.ts'
// @ts-expect-error The bridge helper is plain ESM without declarations.
import { createIdleHolds, readTimeLimit, startRunTimers, TIME_LIMIT_ERRORS } from '../src/host/native-time-limit.mjs'
import { LAST_TOOL_FAILED } from '../src/host/native-tool-outcomes.mjs'
import type { Worker } from '../src/shared/types.ts'

// SIMULATED: fake clock, synthetic process records and account admission only.
// No CLI is resolved, no model is called and no user state is read.
vi.mock('../src/host/cli-account-binding.ts', () => ({ readCliAccountBinding: async () => 'synthetic-account' }))
vi.mock('../src/host/authorized-catalog.ts', () => ({
  ACCOUNT_CHANGED: 'synthetic account changed',
  authorizeSelection: async (preference: unknown) => ({ binding: 'synthetic-account', preference }),
}))
const MINUTE = 60_000
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.useRealTimers()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const fakeClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: Date.parse('2026-10-28T00:00:00Z') })
// Real-loop turns let the Host's promise chains settle without moving the fake clock.
const settle = async (turns = 20) => {
  for (let index = 0; index < turns; index++) await new Promise((resolve) => setImmediate(resolve))
}
async function until(check: () => boolean) {
  for (let index = 0; index < 500 && !check(); index++) await settle(1)
  expect(check()).toBe(true)
}
const line = (value: unknown) => JSON.stringify(value) + '\n'

describe('native bridge run timers', () => {
  it('keeps the bridge error texts the Host recognizes', () => {
    expect(TIME_LIMIT_ERRORS).toEqual(BRIDGE_TIME_LIMIT_ERRORS)
  })

  it('reads the Host deadline and counts an older request from its own start', () => {
    const now = Date.parse('2026-10-28T00:00:00Z')
    expect(readTimeLimit({ timeoutMs: 120 * MINUTE, deadlineAt: now + 90 * MINUTE, idleTimeoutMs: 10 * MINUTE }, now))
      .toEqual({ deadlineAt: now + 90 * MINUTE, idleMs: 10 * MINUTE })
    expect(readTimeLimit({ timeoutMs: 30 * MINUTE }, now)).toEqual({ deadlineAt: now + 30 * MINUTE, idleMs: 0 })
    for (const config of [
      { timeoutMs: 0 },
      { timeoutMs: 86_400_001 },
      { timeoutMs: 1000, deadlineAt: now + 86_400_001 },
      { timeoutMs: 1000, deadlineAt: 1.5 },
      { timeoutMs: 1000, idleTimeoutMs: -1 },
      { timeoutMs: 1000, idleTimeoutMs: '600000' },
    ])
      expect(readTimeLimit(config, now)).toBeUndefined()
  })

  it('does not stop a run before a deadline longer than 30 minutes', () => {
    fakeClock()
    const expired = vi.fn()
    const timers = startRunTimers({ deadlineAt: Date.now() + 120 * MINUTE, idleMs: 0 }, expired)
    vi.advanceTimersByTime(45 * MINUTE)
    expect(expired).not.toHaveBeenCalled()
    vi.advanceTimersByTime(75 * MINUTE - 1)
    expect(expired).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(expired).toHaveBeenCalledExactlyOnceWith('total')
    timers.close()
  })

  it('renews the idle window on every native frame and stops after a silent window', () => {
    fakeClock()
    const expired = vi.fn()
    const timers = startRunTimers({ deadlineAt: Date.now() + 120 * MINUTE, idleMs: 10 * MINUTE }, expired)
    for (let index = 0; index < 6; index++) {
      vi.advanceTimersByTime(9 * MINUTE)
      timers.touch()
    }
    expect(expired).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10 * MINUTE)
    expect(expired).toHaveBeenCalledExactlyOnceWith('idle')
    // Neither the total timer nor later frames report a second limit.
    timers.touch()
    vi.advanceTimersByTime(120 * MINUTE)
    expect(expired).toHaveBeenCalledOnce()
  })

  it('stops counting once the run has closed', () => {
    fakeClock()
    const expired = vi.fn()
    const timers = startRunTimers({ deadlineAt: Date.now() + MINUTE, idleMs: MINUTE }, expired)
    timers.close()
    vi.advanceTimersByTime(10 * MINUTE)
    expect(expired).not.toHaveBeenCalled()
  })

  it('pauses the idle window per Host hold id and ignores a hold after its release', () => {
    fakeClock()
    const expired = vi.fn()
    const timers = startRunTimers({ deadlineAt: Date.now() + 120 * MINUTE, idleMs: 10 * MINUTE }, expired)
    const command = createIdleHolds(() => timers.hold())
    expect(command('hold', 'idle-1')).toBe(true)
    // A replayed hold does not stack a second pause.
    expect(command('hold', 'idle-1')).toBe(true)
    vi.advanceTimersByTime(30 * MINUTE)
    expect(expired).not.toHaveBeenCalled()
    expect(command('release', 'idle-1')).toBe(true)
    vi.advanceTimersByTime(10 * MINUTE - 1)
    expect(expired).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(expired).toHaveBeenCalledExactlyOnceWith('idle')
    // A release that overtook its hold settles the id.
    const late = vi.fn(() => () => {})
    const other = createIdleHolds(late)
    expect(other('release', 'idle-2')).toBe(true)
    expect(other('hold', 'idle-2')).toBe(true)
    expect(late).not.toHaveBeenCalled()
    expect(other('pause', 'idle-3')).toBe(false)
    timers.close()
  })
})

interface Call {
  spec: SubprocessSpawnSpec
  stdout: PassThrough
  terminated: boolean
  /** Lets the simulated process range report its exit. */
  exit: () => void
}
function fixture(options: { native?: boolean; timeoutMs?: number; records?: (call: Call) => void } = {}) {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-time-limit-')))
  cleanups.push(() => rmSync(project, { recursive: true, force: true }))
  const executable = join(project, 'synthetic-cli.mjs')
  writeFileSync(executable, '// SIMULATED launcher identity only\n', { mode: 0o700 })
  const calls: Call[] = []
  const requests: any[] = []
  const backend: ProcessBackend = {
    resolveExecutable: async () => executable,
    spawn(spec) {
      const stdout = new PassThrough(),
        stderr = new PassThrough()
      if (spec.argv.some((arg) => arg.replaceAll('\\', '/').endsWith('/native-bridge.mjs')))
        requests.push(JSON.parse(readFileSync(spec.argv.at(-1)!, 'utf8')))
      let exited!: () => void
      const range = new Promise<void>((resolve) => {
        exited = resolve
      })
      let resolveDone!: (outcome: { exitCode: number }) => void
      const done = new Promise<{ exitCode: number }>((resolve) => {
        resolveDone = resolve
      })
      const call: Call = { spec, stdout, terminated: false, exit: exited }
      const end = (exitCode: number) => {
        if (!stdout.writableEnded) stdout.end()
        if (!stderr.writableEnded) stderr.end()
        resolveDone({ exitCode })
      }
      const terminate = () => {
        call.terminated = true
        end(143)
      }
      spec.signal?.addEventListener('abort', terminate, { once: true })
      calls.push(call)
      options.records?.(call)
      void range.then(() => end(0))
      return {
        stdout,
        stderr,
        done,
        terminate,
        // The process range is reported only after the simulated exit.
        waitForExit: async () => {
          await range
          return true
        },
      } as SubprocessHandle
    },
  }
  const storage = new WorkerStorage(join(project, 'state'))
  const Runtime = options.native ? NativeWorkerRuntime : LegacyWorkerRuntime
  const runtime = new Runtime(storage, backend, { ...DEFAULT_CONFIG, timeoutMs: options.timeoutMs ?? DEFAULT_CONFIG.timeoutMs })
  cleanups.push(() => runtime.close())
  // A failed assertion must not leave a simulated process range waiting forever.
  cleanups.push(() => calls.forEach((call) => call.exit()))
  const preference = { cli: 'antigravity' as const, model: 'synthetic-model', effort: 'low' as const }
  const start = (title = 'SIMULATED long task') =>
    runtime.submit('parent', project, title, 'SIMULATED prompt', preference, 'plan')
  const status = (worker: Worker) => runtime.get('parent', worker.id).status
  return { project, storage, runtime, calls, requests, start, status }
}
const agyStep = (text: string) =>
  line({
    event: 'step_update',
    step_update: { conversation_id: 'synthetic-conversation', step_index: 1, step_type: 'agent_response', state: 'ACTIVE', text_delta: text },
  })
const printTimeout = (argv: string[]) => argv[argv.indexOf('--print-timeout') + 1]

describe('Host task time limit', () => {
  it('runs past 30 minutes under a 2 hour limit, keeps its deadline when the setting shrinks, and reports after exit', async () => {
    fakeClock()
    const f = fixture()
    f.runtime.setGeneralSettings({ taskTimeLimitMs: 120 * MINUTE })
    const task = f.start()
    let finished = false
    void task.done.then(() => (finished = true))
    await until(() => f.calls.length === 1)
    const call = f.calls[0]!
    expect(printTimeout(call.spec.argv)).toBe('7200s')
    call.stdout.write(agyStep('SIMULATED progress'))
    await settle()
    vi.advanceTimersByTime(45 * MINUTE)
    await settle()
    expect(call.terminated).toBe(false)
    expect(f.status(task.worker)).toBe('running')
    // Shortening the limit applies to later tasks only.
    expect(f.runtime.setGeneralSettings({ taskTimeLimitMs: 30 * MINUTE }).taskTimeLimitMs).toBe(30 * MINUTE)
    vi.advanceTimersByTime(75 * MINUTE - 1)
    await settle()
    expect(call.terminated).toBe(false)
    vi.advanceTimersByTime(1)
    await until(() => call.terminated)
    // Terminated but its process range has not exited: nothing is reported yet.
    await settle()
    expect(finished).toBe(false)
    expect(f.status(task.worker)).toBe('running')
    call.exit()
    const worker = await task.done
    expect(worker.status).toBe('interrupted')
    expect(worker.error).toBe('Error: 任务超时：已达到总时限 2 小时')
    expect(worker.interruptionReason).toBeUndefined()
    // The next task starts with the setting saved meanwhile.
    const next = f.start('SIMULATED next task')
    await until(() => f.calls.length === 2)
    expect(printTimeout(f.calls[1]!.spec.argv)).toBe('1800s')
    vi.advanceTimersByTime(30 * MINUTE)
    await until(() => f.calls[1]!.terminated)
    f.calls[1]!.exit()
    expect((await next.done).error).toBe('Error: 任务超时：已达到总时限 30 分钟')
  })

  it('keeps an earlier plugin config timeoutMs as the initial limit without saving over it', async () => {
    fakeClock()
    const f = fixture({ timeoutMs: 45 * MINUTE })
    expect(f.runtime.generalSettings()).toMatchObject({
      taskTimeLimitMs: 45 * MINUTE,
      defaultTaskTimeLimitMs: 45 * MINUTE,
      idleTimeLimitMs: 0,
    })
    const task = f.start()
    await until(() => f.calls.length === 1)
    expect(printTimeout(f.calls[0]!.spec.argv)).toBe('2700s')
    vi.advanceTimersByTime(45 * MINUTE)
    await until(() => f.calls[0]!.terminated)
    f.calls[0]!.exit()
    expect((await task.done).error).toBe('Error: 任务超时：已达到总时限 45 分钟')
    expect(f.storage.generalSettings()).toEqual({})
  })

  it('stops a transport without the native bridge after an idle window of its own output', async () => {
    fakeClock()
    const f = fixture()
    f.runtime.setGeneralSettings({ taskTimeLimitMs: 120 * MINUTE, idleTimeLimitMs: 10 * MINUTE })
    const task = f.start()
    await until(() => f.calls.length === 1)
    const call = f.calls[0]!
    for (let index = 0; index < 4; index++) {
      vi.advanceTimersByTime(9 * MINUTE)
      call.stdout.write(agyStep(`SIMULATED step ${index}`))
      await settle()
    }
    expect(call.terminated).toBe(false)
    vi.advanceTimersByTime(10 * MINUTE)
    await until(() => call.terminated)
    call.exit()
    const worker = await task.done
    expect(worker.status).toBe('interrupted')
    expect(worker.error).toBe('Error: 任务超时：连续 10 分钟没有收到 CLI 事件（空闲时限）')
  })

  it('pauses its own idle window while a DSH fallback tool waits for approval', async () => {
    fakeClock()
    const f = fixture()
    f.runtime.setGeneralSettings({ taskTimeLimitMs: 120 * MINUTE, idleTimeLimitMs: 10 * MINUTE })
    const task = f.start()
    await until(() => f.calls.length === 1)
    const call = f.calls[0]!
    call.stdout.write(agyStep('SIMULATED step'))
    await settle()
    let answer!: (decision: { decision: 'allow-once'; source: 'user' }) => void
    const decided = f.runtime.harnessApproval(
      task.worker,
      f.runtime.get('parent', task.worker.id).runId!,
      { kind: 'tool', summary: 'SIMULATED DSH tool', allowSession: false },
      new AbortController().signal,
      () => new Promise((resolve) => (answer = resolve)),
    )
    await settle()
    vi.advanceTimersByTime(25 * MINUTE)
    await settle()
    expect(call.terminated).toBe(false)
    answer({ decision: 'allow-once', source: 'user' })
    expect(await decided).toEqual({ decision: 'allow-once', source: 'user' })
    vi.advanceTimersByTime(10 * MINUTE - 1)
    await settle()
    expect(call.terminated).toBe(false)
    vi.advanceTimersByTime(1)
    await until(() => call.terminated)
    call.exit()
    expect((await task.done).error).toBe('Error: 任务超时：连续 10 分钟没有收到 CLI 事件（空闲时限）')
  })

  it.each([
    ['idle', true, 'Native task idle timed out', '任务超时：连续 5 分钟没有收到 CLI 事件（空闲时限）'],
    ['total', true, 'Native task timed out', '任务超时：已达到总时限 8 小时'],
    // A CLI that stays silent from the start never reports a session.
    ['idle', false, 'Native task idle timed out', '任务超时：连续 5 分钟没有收到 CLI 事件（空闲时限）'],
  ])('writes one deadline into the bridge request and reports its %s timeout only after exit (session %s)', async (_kind, session, bridgeError, message) => {
    fakeClock()
    const f = fixture({
      native: true,
      records: (call) =>
        queueMicrotask(() => {
          if (session) call.stdout.write(line({ type: 'session', id: 'synthetic-session', model: 'synthetic-model' }))
          call.stdout.write(line({ type: 'result', status: 'ERROR', response: '', resultScope: 'run', error: bridgeError }))
        }),
    })
    f.runtime.setGeneralSettings({ taskTimeLimitMs: 480 * MINUTE, idleTimeLimitMs: 5 * MINUTE })
    const startedAt = Date.now()
    const task = f.start()
    let finished = false
    void task.done.then(() => (finished = true))
    await until(() => f.requests.length === 1)
    expect(f.requests[0]).toMatchObject({ timeoutMs: 480 * MINUTE, deadlineAt: startedAt + 480 * MINUTE, idleTimeoutMs: 5 * MINUTE })
    await settle()
    expect(finished).toBe(false)
    f.calls[0]!.exit()
    const worker = await task.done
    expect(worker.status).toBe('interrupted')
    expect(worker.error).toBe(`Error: ${message}`)
  })
})

describe('DSH fallback tool approvals in a native bridge run', () => {
  const request = { kind: 'tool' as const, summary: 'SIMULATED DSH tool', allowSession: false }
  const commands = (directory: string) =>
    readdirSync(directory)
      .filter((name) => name.endsWith('.request.json'))
      .map((name) => ({ name, ...JSON.parse(readFileSync(join(directory, name), 'utf8')) }))
  async function command(directory: string, message: string) {
    for (let index = 0; index < 200; index++) {
      const found = commands(directory).find((item) => item.message === message)
      if (found) return found
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`no ${message} command`)
  }
  // Stands in for the runner's receipt of one mailbox command.
  const receipt = (directory: string, sent: { name: string; nonce: string; id: string; attempt: string; message: string }) =>
    writeFileSync(
      join(directory, sent.name.replace('.request.', '.receipt.')),
      JSON.stringify({ nonce: sent.nonce, id: sent.id, attempt: sent.attempt, digest: createHash('sha256').update(sent.message).digest('hex'), success: true }),
      { mode: 0o600 },
    )
  async function running(idleTimeLimitMs: number) {
    const f = fixture({ native: true })
    f.runtime.setGeneralSettings({ taskTimeLimitMs: 120 * MINUTE, idleTimeLimitMs })
    const task = f.start()
    await until(() => f.calls.length === 1)
    return { f, task, runId: f.runtime.get('parent', task.worker.id).runId! }
  }

  it('asks the runner to hold its idle window, and releases only after the hold was received', async () => {
    const { f, task, runId } = await running(5 * MINUTE)
    const directory = f.requests[0].approvalDirectory
    let answer!: (decision: { decision: 'deny'; source: 'user' }) => void
    const decided = f.runtime.harnessApproval(task.worker, runId, request, new AbortController().signal,
      () => new Promise((resolve) => (answer = resolve)))
    const hold = await command(directory, 'hold')
    expect(hold).toMatchObject({ nonce: f.requests[0].approvalNonce, id: 'idle-1:hold', type: 'approval' })
    answer({ decision: 'deny', source: 'user' })
    await decided
    await settle()
    expect(commands(directory).map((item) => item.message)).toEqual(['hold'])
    receipt(directory, hold)
    expect(await command(directory, 'release')).toMatchObject({ id: 'idle-1:release', type: 'approval' })
  })

  it('sends nothing to the runner when no idle limit is set', async () => {
    const { f, task, runId } = await running(0)
    await f.runtime.harnessApproval(task.worker, runId, request, new AbortController().signal,
      async () => ({ decision: 'allow-once', source: 'user' }))
    await settle()
    expect(commands(f.requests[0].approvalDirectory)).toEqual([])
  })

  const recovered = '本轮有 1 个工具步骤失败，CLI 已自行处理'
  const noReply = 'CLI 未返回可核查的本轮正文'
  it.each([
    // A denial is the user's decision: the refused tool is not a failure the CLI recovered from.
    ['deny', 'SUCCESS', recovered, 'completed', undefined],
    // The refused tool was the last step before the CLI ended.
    ['deny', 'UNCERTAIN', LAST_TOOL_FAILED, 'completed', undefined],
    ['deny', 'UNCERTAIN', noReply, 'uncertain', noReply],
    ['deny', 'ERROR', 'SIMULATED failure', 'failed', undefined],
    ['allow-once', 'SUCCESS', recovered, 'completed', recovered],
    ['allow-once', 'UNCERTAIN', LAST_TOOL_FAILED, 'uncertain', LAST_TOOL_FAILED],
  ] as const)('a %s DSH tool decision then a CLI %s (%s) ends the run %s', async (decision, status, text, expected, shown) => {
    const { f, task, runId } = await running(0)
    await f.runtime.harnessApproval(task.worker, runId, request, new AbortController().signal,
      async () => ({ decision, source: 'user' }))
    const call = f.calls[0]!
    call.stdout.write(line({ type: 'session', id: 'synthetic-session', model: 'synthetic-model' }))
    call.stdout.write(line({ type: 'result', status, response: 'SIMULATED reply', resultScope: 'run',
      ...(status === 'SUCCESS' ? { notice: text } : { error: text }) }))
    call.exit()
    const worker = await task.done
    expect(worker.status).toBe(expected)
    if (expected === 'completed') {
      expect(worker.error).toBeUndefined()
      expect(worker.resultNotice).toBe(shown)
    }
    if (expected === 'uncertain') expect(worker.error).toBe(shown)
  })
})
