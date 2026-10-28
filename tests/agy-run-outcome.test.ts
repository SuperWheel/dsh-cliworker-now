import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { AgyProtocol, type EventInput } from '../src/host/protocol.ts'
import { WorkerRuntime } from './fixtures/legacy-runtime.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { CliWorkerService } from '../src/host/index.ts'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
import { active, foldEvents, type Worker, type WorkerEvent } from '../src/shared/types.ts'

// All process output, account binding and conversations are synthetic. No native
// CLI, user history, login or model request is used in these regressions.
vi.mock('../src/host/cli-account-binding.ts', () => ({
  readCliAccountBinding: async () => 'synthetic-account',
}))
vi.mock('../src/host/authorized-catalog.ts', () => ({
  ACCOUNT_CHANGED: 'synthetic account changed',
  authorizeSelection: async (preference: unknown) => ({ binding: 'synthetic-account', preference }),
}))
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const preference = { cli: 'antigravity' as const, model: 'synthetic-model', effort: 'low' as const }
const line = (event: unknown) => JSON.stringify(event) + '\n'
const step = (patch: Record<string, unknown> = {}) => ({
  event: 'step_update',
  step_update: {
    conversation_id: 'synthetic-conversation',
    step_index: 4,
    step_type: 'agent_response',
    state: 'DONE',
    text_delta: '本轮实际回复',
    ...patch,
  },
})
const aggregate = (patch: Record<string, unknown> = {}) => ({
  event: 'result',
  result: {
    conversation_id: 'synthetic-conversation',
    status: 'ERROR',
    response: '历史汇总正文',
    error: 'upstream EOF',
    duration_seconds: 9000,
    ...patch,
  },
})
const doneSteps = () => [
  step({ step_index: 3, step_type: 'tool', tool_name: 'read_file', text_delta: undefined }),
  step(),
]
function fixture(resume = true, options: { cleanup?: boolean; timeoutMs?: number } = {}) {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-agy-outcome-')))
  cleanups.push(() => rmSync(project, { recursive: true, force: true }))
  const directory = join(project, 'state')
  const storage = new WorkerStorage(directory)
  const calls: Array<{ stdout: PassThrough; finish: (code?: number) => void }> = []
  const backend: ProcessBackend = {
    resolveExecutable: async () => '/synthetic/agy',
    spawn: (spec: SubprocessSpawnSpec) => {
      const stdout = new PassThrough(),
        stderr = new PassThrough()
      let resolve!: (outcome: { exitCode: number }) => void
      const done = new Promise<{ exitCode: number }>((settle) => {
        resolve = settle
      })
      const finish = (exitCode = 0) => {
        stdout.end()
        stderr.end()
        resolve({ exitCode })
      }
      const terminate = () => finish(143)
      spec.signal?.addEventListener('abort', terminate, { once: true })
      calls.push({ stdout, finish })
      return {
        stdout,
        stderr,
        done,
        terminate,
        waitForExit: async () => {
          await done
          return options.cleanup !== false
        },
      } as SubprocessHandle
    },
  }
  const runtime = new WorkerRuntime(storage, backend, {
    ...DEFAULT_CONFIG,
    timeoutMs: options.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
  })
  cleanups.push(() => runtime.close())
  const previous: Worker = {
    id: randomUUID(),
    runId: randomUUID(),
    parentSessionId: 'parent',
    project,
    title: 'Synthetic resume',
    preference,
    mode: 'plan',
    status: 'failed',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:01.000Z',
    conversationId: 'synthetic-conversation',
    lastResult: '上一轮结果',
    error: 'upstream EOF',
  }
  if (resume) {
    storage.save(previous)
    storage.bindAccount(previous.id, 'synthetic-account')
  }
  const start = () =>
    runtime.submit(
      'parent',
      project,
      'Synthetic resume',
      '合成续聊',
      preference,
      'plan',
      resume ? previous.id : undefined,
    )
  const current = async () => {
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0))
    return calls.at(-1)!
  }
  return { project, directory, storage, runtime, previous, start, current }
}

describe('AGY current-process evidence', () => {
  it('keeps ERROR native metadata separate from DONE response and tools', () => {
    const events: EventInput[] = []
    const protocol = new AgyProtocol(
      (event) => events.push(event),
      () => {},
      8192,
    )
    protocol.feed(doneSteps().map(line).join('') + line(aggregate()))
    protocol.end()
    expect(protocol.result).toMatchObject({
      status: 'ERROR',
      response: '历史汇总正文',
      error: 'upstream EOF',
      currentTurnResponse: '本轮实际回复',
      completedStepResponse: '本轮实际回复',
    })
    expect(events.filter((event) => event.kind === 'assistant').map((event) => event.text)).toEqual([
      '本轮实际回复',
    ])
    expect(events.at(-1)).toMatchObject({ kind: 'diagnostic', state: 'ERROR' })
    expect(events.at(-1)?.detail).toContain('历史汇总正文')
    expect(events.at(-1)?.detail).toContain('9000')
  })

  it.each([
    ['only a tool', [step({ step_type: 'tool', text_delta: undefined })]],
    ['empty reply', [step({ text_delta: '  ' })]],
    ['unfinished reply', [step({ state: 'ACTIVE' })]],
    ['missing state', [step({ state: undefined })]],
    ['invalid state', [step({ state: 123 })]],
    ['invalid delta', [step({ text_delta: 123 })]],
    ['unindexed reply', [step({ step_index: undefined })]],
    ['invalid index', [step({ step_index: -1 })]],
    ['unknown step', [step({ step_type: 'future_step' }), step()]],
    ['changed step type', [step({ step_type: 'tool' }), step()]],
    ['failed then done', [step({ state: 'ERROR', text_delta: '' }), step()]],
    ['step error', [step({ error: 'current failure' })]],
    ['error event', [{ event: 'error', error: 'current failure' }, step()]],
    ['unknown event', [{ event: 'future_event' }, step()]],
    ['top-level error', [{ ...step(), error: 'current failure' }]],
  ])('does not infer completion from %s', (_label, events) => {
    const protocol = new AgyProtocol(
      () => {},
      () => {},
      8192,
    )
    protocol.feed(events.map(line).join('') + line(aggregate()))
    protocol.end()
    expect(protocol.result?.completedStepResponse).toBeUndefined()
  })

  it('does not classify an unknown structured error as a summary conflict', () => {
    const protocol = new AgyProtocol(
      () => {},
      () => {},
      8192,
    )
    protocol.feed(line(step()) + line(aggregate({ error: { message: 'current failure' } })))
    protocol.end()
    expect(protocol.result?.completedStepResponse).toBeUndefined()
  })

  it.each(['', '   '])('rejects a final result without a real conversation id: %j', (id) => {
    const protocol = new AgyProtocol(() => {}, () => {}, 8192)
    protocol.feed(line(step()))
    expect(() => protocol.feed(line(aggregate({ conversation_id: id })))).toThrow('Invalid CLI result')
    expect(protocol.result).toBeUndefined()
    expect(protocol.currentTurnResponse).toBe('本轮实际回复')
  })
})

describe('AGY runtime outcomes', () => {
  it('reports only a clean resumed DONE/ERROR conflict as uncertain and restores it durably', async () => {
    const f = fixture(),
      task = f.start(),
      call = await f.current()
    expect(task.worker.lastResult).toBeUndefined()
    call.stdout.write(doneSteps().map(line).join('') + line(aggregate()))
    call.finish()
    const worker = await task.done
    expect(worker).toMatchObject({ status: 'uncertain', lastResult: '本轮实际回复' })
    expect(worker.error).toContain('不要自动重试')
    expect(worker.error).toContain('upstream EOF')
    expect(active(worker.status)).toBe(false)
    const snapshot = f.runtime.snapshot('parent', worker.id)
    expect(snapshot.timeline.filter((row) => row.kind === 'assistant').map((row) => row.text)).toEqual([
      '本轮实际回复',
    ])
    expect(snapshot.timeline.find((row) => row.kind === 'tool')?.state).toBe('DONE')
    expect(snapshot.timeline.at(-1)).toMatchObject({
      runOutcome: 'uncertain',
      runEndedAt: expect.any(String),
    })
    await f.runtime.close()
    const restored = new WorkerStorage(f.directory)
    cleanups.push(() => restored.close())
    expect(restored.workers.get(worker.id)).toMatchObject({ status: 'uncertain', lastResult: '本轮实际回复' })
  })

  it.each([
    ['new conversation', false, [step(), aggregate()], 0],
    ['partial reply', true, [step({ state: 'ACTIVE' }), aggregate()], 0],
    ['tool without a reply', true, [step({ step_type: 'tool' }), aggregate()], 0],
    ['current error event', true, [{ event: 'error', message: 'current failure' }, step(), aggregate()], 0],
    ['nonzero exit', true, [step(), aggregate()], 2],
    ['missing result', true, [step()], 0],
    ['empty final identity', true, [step(), aggregate({ conversation_id: '' })], 0],
    ['blank final identity', true, [step(), aggregate({ conversation_id: '   ' })], 0],
  ] as const)('keeps %s failed with current text only', async (_label, resume, events, code) => {
    const f = fixture(resume),
      task = f.start(),
      call = await f.current()
    call.stdout.write(events.map(line).join(''))
    call.finish(code)
    const worker = await task.done
    expect(worker.status).toBe('failed')
    expect(worker.error).toBeTruthy()
    expect(worker.lastResult ?? '').not.toContain('历史汇总正文')
    expect(worker.lastResult ?? '').not.toContain('上一轮结果')
    if (_label !== 'tool without a reply') expect(worker.lastResult).toBe('本轮实际回复')
  })

  it("does not promote an ERROR aggregate without this turn's observed text to a reply", async () => {
    const f = fixture(),
      task = f.start(),
      call = await f.current()
    call.stdout.write(line(aggregate()))
    call.finish()
    const worker = await task.done
    expect(worker).toMatchObject({ status: 'failed', lastResult: undefined })
    expect(f.runtime.snapshot('parent', worker.id).timeline.some((row) => row.kind === 'assistant')).toBe(
      false,
    )
  })

  it.each(['malformed', 'identity mismatch', 'cleanup'] as const)(
    'keeps %s failure above a plausible conflict',
    async (scenario) => {
      const f = fixture(true, { cleanup: scenario !== 'cleanup' }),
        task = f.start(),
        call = await f.current()
      call.stdout.write(line(step()))
      call.stdout.write(
        scenario === 'malformed'
          ? 'not-json\n'
          : line(aggregate(scenario === 'identity mismatch' ? { conversation_id: 'other' } : {})),
      )
      call.finish()
      const worker = await task.done
      expect(worker).toMatchObject({ status: 'failed', lastResult: '本轮实际回复' })
      expect(worker.error).toBeTruthy()
    },
  )

  it.each(['cancel', 'timeout'] as const)(
    'preserves partial text on %s without turning it into a successful reply',
    async (scenario) => {
      const f = fixture(true, { timeoutMs: scenario === 'timeout' ? 100 : undefined }),
        task = f.start(),
        call = await f.current()
      call.stdout.write(line(step({ state: 'ACTIVE' })))
      await vi.waitFor(() =>
        expect(f.storage.history(task.worker.id).some((event) => event.kind === 'assistant')).toBe(true),
      )
      if (scenario === 'cancel') await f.runtime.stop('parent', task.worker.id)
      const worker = await task.done
      expect(worker).toMatchObject({ status: 'interrupted', lastResult: '本轮实际回复' })
      expect(worker.interruptionReason).toBe(scenario === 'cancel' ? 'user' : undefined)
      if (scenario === 'cancel') expect(worker.error).toBeUndefined()
      else expect(worker.error).toContain('任务超时')
    },
  )

  it('preserves the native SUCCESS final response and ordinary completion rule', async () => {
    const f = fixture(),
      task = f.start(),
      call = await f.current()
    call.stdout.write(
      line(step()) + line(aggregate({ status: 'SUCCESS', response: '正常最终回复', error: undefined })),
    )
    call.finish()
    expect(await task.done).toMatchObject({
      status: 'completed',
      lastResult: '正常最终回复',
      error: undefined,
    })
  })

  it('returns uncertain and separate response/error to the parent while the host job remains failed', async () => {
    const f = fixture()
    let jobDone!: Promise<{ status: string; detail: string; result: string }>
    const agent = {
      id: 'parent',
      ctx: {
        get: () => ({
          start: (spec: any) => {
            jobDone = spec.run().done
            return 'synthetic-job'
          },
        }),
      },
    }
    const service = Object.assign(Object.create(CliWorkerService.prototype), {
      nativeRunDone: new Map(),
      runtime: f.runtime,
      options: DEFAULT_CONFIG,
      disposed: new AbortController(),
      accounts: { isBusy: () => false },
      assertExecution: () => {},
      assertAccessSupported: () => {},
      project: () => f.project,
      querySelection: async () => ({ binding: 'synthetic-account', preference }),
    })
    await service.launch(agent, 'Synthetic', '合成续聊', preference, 'plan', f.previous.id)
    const call = await f.current()
    call.stdout.write(doneSteps().map(line).join('') + line(aggregate()))
    call.finish()
    const job = await jobDone
    expect(job.status).toBe('failed')
    expect(job.detail).toContain('不要自动重试')
    expect(JSON.parse(job.result)).toMatchObject({
      status: 'uncertain',
      response: '本轮实际回复',
      error: expect.stringContaining('upstream EOF'),
      guidance: expect.stringContaining('不要自动重试'),
    })
  })
})

it("folds historical ERROR aggregates as diagnostics and uses uncertain as this run's ending", () => {
  const events = [
    { kind: 'user', text: '合成续聊' },
    { kind: 'assistant', step: 4, state: 'DONE', text: '本轮实际回复' },
    { kind: 'result', state: 'ERROR', text: '历史汇总正文' },
    { kind: 'status', state: 'uncertain', text: '结果待核实' },
  ].map((event, index) => ({
    ...event,
    runId: 'run',
    seq: index + 1,
    time: `2026-10-15T00:00:0${index}Z`,
  })) as WorkerEvent[]
  const rows = foldEvents(events, undefined, 'antigravity')
  expect(rows.filter((row) => row.kind === 'assistant').map((row) => row.text)).toEqual(['本轮实际回复'])
  expect(rows.find((row) => row.kind === 'diagnostic')).toMatchObject({
    detail: '历史汇总正文',
    state: 'ERROR',
  })
  expect(rows[1]).toMatchObject({ runOutcome: 'uncertain', runEndedAt: '2026-10-15T00:00:03Z' })
  expect(foldEvents(events.slice(2, 3), undefined, 'antigravity')[0]?.kind).toBe('diagnostic')
  expect(foldEvents(events.slice(2, 3), undefined, 'hermes')[0]).toMatchObject({
    kind: 'assistant',
    text: '历史汇总正文',
  })
})
