import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { WorkerStorage } from '../src/host/storage.ts'
import { CLI_IDS, foldEvents, isUserInterrupted, type Worker } from '../src/shared/types.ts'

// Explicitly synthetic persisted legacy state; no user accounts or logs are read.
const cleanup: (() => void)[] = []
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close()
})
function fixture(status: Worker['status'] = 'completed') {
  const dir = mkdtempSync(join(tmpdir(), 'cwn-legacy-storage-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const worker: Worker = {
    id: randomUUID(),
    runId: randomUUID(),
    parentSessionId: 'fixture-parent',
    project: dir,
    title: 'Synthetic historical Harness worker',
    preference: { cli: 'harness', model: '["fixture-provider","fixture-model"]', effort: 'low' },
    conversationId: 'original-harness-session',
    mode: 'accept-edits',
    status,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:01.000Z',
  }
  const workerPath = join(dir, `${worker.id}.worker.json`)
  const eventPath = join(dir, `${worker.id}.events.jsonl`)
  writeFileSync(workerPath, JSON.stringify(worker))
  writeFileSync(
    eventPath,
    JSON.stringify({
      seq: 1,
      runId: worker.runId,
      time: worker.updatedAt,
      kind: 'assistant',
      text: 'Synthetic original answer',
    }) + '\n',
  )
  const settings = JSON.stringify({ enabled: { harness: false, codex: false } })
  writeFileSync(join(dir, 'cli-settings.json'), settings)
  const key = createHash('sha256')
    .update(JSON.stringify([dir, 'harness']))
    .digest('hex')
  const preferencePath = join(dir, `${key}.preference.json`)
  writeFileSync(preferencePath, JSON.stringify(worker.preference))
  return { dir, worker, workerPath, eventPath, preferencePath, settings }
}

describe('Hermes migration preserves retired Harness history', () => {
  it('retains only safe request lifecycle fields on a cold history read', () => {
    const f = fixture()
    const requestState = { nativeRunId: 'native-run', sequence: 3, phase: 'failed', statusCode: 429, reason: 'upstream_rate_limit', retryCount: 0, retryable: true }
    const row = JSON.parse(readFileSync(f.eventPath, 'utf8'))
    writeFileSync(f.eventPath, JSON.stringify({ ...row, kind: 'status', requestState: { ...requestState, message: 'NOT_PUBLIC' } }) + '\n')
    const store = new WorkerStorage(f.dir)
    cleanup.push(() => store.close())
    expect(store.history(f.worker.id)[0]?.requestState).toEqual(requestState)
  })
  it('loads legacy settings and history unchanged while giving Hermes independent defaults', () => {
    const f = fixture()
    const original = [f.workerPath, f.eventPath, f.preferencePath].map((p) => readFileSync(p, 'utf8'))
    const store = new WorkerStorage(f.dir)
    cleanup.push(() => store.close())
    expect(CLI_IDS).toContain('hermes')
    expect(CLI_IDS).not.toContain('harness')
    expect(store.cliSettings().enabled.hermes).toBe(true)
    expect(store.cliSettings().enabled.codex).toBe(false)
    expect(store.cliSettings().enabled).not.toHaveProperty('harness')
    expect(store.workers.get(f.worker.id)).toEqual(f.worker)
    expect(store.history(f.worker.id)[0]?.text).toBe('Synthetic original answer')
    expect(store.preference(f.dir, 'hermes')).toBeUndefined()
    expect(store.preference(f.dir, 'harness')).toBeUndefined()
    expect(() => store.setPreference(f.dir, f.worker.preference)).toThrow('入口已移除')
    expect(() => store.setCliEnabled('harness', true)).toThrow('入口已移除')
    expect([f.workerPath, f.eventPath, f.preferencePath].map((p) => readFileSync(p, 'utf8'))).toEqual(
      original,
    )
    expect(readFileSync(join(f.dir, 'cli-settings.json'), 'utf8')).toBe(f.settings)
    store.setPreference(f.dir, { cli: 'hermes', model: 'native-fixture-model', effort: 'default' })
    store.setCliEnabled('hermes', false)
    expect(store.preference(f.dir, 'hermes')?.model).toBe('native-fixture-model')
    expect(readFileSync(f.preferencePath, 'utf8')).toBe(original[2])
    expect(JSON.parse(readFileSync(join(f.dir, 'cli-settings.json'), 'utf8')).enabled).not.toHaveProperty(
      'harness',
    )
  })
  it('marks unfinished legacy work interrupted without suggesting it can resume as Hermes', () => {
    const f = fixture('running')
    const store = new WorkerStorage(f.dir)
    cleanup.push(() => store.close())
    expect(store.workers.get(f.worker.id)).toMatchObject({
      status: 'interrupted',
      conversationId: f.worker.conversationId,
      preference: f.worker.preference,
    })
    expect(store.workers.get(f.worker.id)?.error).toContain('历史记录仅供查看')
    expect(store.history(f.worker.id)).toHaveLength(2)
    expect(store.history(f.worker.id)[1]?.state).toBe('interrupted')
  })
})

it.each(['Error: 用户已停止任务', '用户已取消排队任务'])(
  'normalizes the exact legacy user stop %s without rewriting its history',
  (error) => {
    const f = fixture('interrupted')
    f.worker.preference.cli = 'antigravity'
    f.worker.error = error
    f.worker.conversationId = undefined
    writeFileSync(f.workerPath, JSON.stringify(f.worker))
    const history = readFileSync(f.eventPath, 'utf8')
    const store = new WorkerStorage(f.dir)
    cleanup.push(() => store.close())
    const restored = store.workers.get(f.worker.id)!
    expect(restored).toMatchObject({ status: 'interrupted', interruptionReason: 'user', error: undefined })
    expect(isUserInterrupted(restored)).toBe(true)
    expect(JSON.parse(readFileSync(f.workerPath, 'utf8'))).toMatchObject({ interruptionReason: 'user' })
    expect(readFileSync(f.eventPath, 'utf8')).toBe(history)
  },
)

it.each([
  ['interrupted', 'Error: 任务超时'],
  ['interrupted', '上次 Harness 运行中断；可继续原会话'],
  ['interrupted', 'Error: 用户已停止任务：清理未确认'],
  ['failed', 'Error: 用户已停止任务'],
] as const)('preserves a diagnostic %s outcome: %s', (status, error) => {
  const f = fixture(status)
  f.worker.preference.cli = 'antigravity'
  f.worker.error = error
  writeFileSync(f.workerPath, JSON.stringify(f.worker))
  const store = new WorkerStorage(f.dir)
  cleanup.push(() => store.close())
  const restored = store.workers.get(f.worker.id)!
  expect(restored).toMatchObject({ status, error })
  expect(restored.interruptionReason).toBeUndefined()
  expect(isUserInterrupted(restored)).toBe(false)
})

it('restores exact outbox admission identity into the timeline after reopening persisted history', () => {
  const f = fixture(),
    queuedFollowupId = randomUUID()
  writeFileSync(
    f.eventPath,
    JSON.stringify({
      seq: 1,
      runId: f.worker.runId,
      time: f.worker.updatedAt,
      kind: 'user',
      text: 'Synthetic queued message',
      queuedFollowupId,
    }) + '\n',
  )
  const store = new WorkerStorage(f.dir)
  cleanup.push(() => store.close())
  const events = store.history(f.worker.id)
  expect(events[0]?.queuedFollowupId).toBe(queuedFollowupId)
  expect(foldEvents(events)[0]).toMatchObject({ kind: 'user', queuedFollowupId })
})

it('persists submission states and merges native user identities regardless of append ordering', () => {
  const f = fixture(),
    id = randomUUID(),
    other = randomUUID(),
    client = randomUUID()
  const store = new WorkerStorage(f.dir)
  store.append(f.worker, { kind: 'user', text: 'same text', queuedFollowupId: id })
  store.append(f.worker, {
    kind: 'submission',
    text: 'same text',
    queuedFollowupId: id,
    deliveryState: 'pending',
    submissionClientId: client,
    submissionSequence: 1,
  })
  store.append(f.worker, {
    kind: 'submission',
    text: 'same text',
    queuedFollowupId: id,
    deliveryState: 'superseded',
    deliveryError: '已被后续插队取消',
    submissionClientId: client,
    submissionSequence: 1,
  })
  store.append(f.worker, {
    kind: 'submission',
    text: 'same text',
    queuedFollowupId: other,
    deliveryState: 'admitted',
    admittedRunId: f.worker.runId,
    submissionClientId: client,
    submissionSequence: 2,
  })
  store.append(f.worker, { kind: 'user', text: 'same text', queuedFollowupId: other })
  store.close()
  const reopened = new WorkerStorage(f.dir)
  cleanup.push(() => reopened.close())
  const rows = foldEvents(reopened.history(f.worker.id)).filter((row) => row.kind === 'user')
  expect(rows).toHaveLength(2)
  expect(rows).toMatchObject([
    {
      id: `submission:${id}`,
      queuedFollowupId: id,
      deliveryState: 'superseded',
      deliveryError: '已被后续插队取消',
    },
    {
      id: `submission:${other}`,
      queuedFollowupId: other,
      deliveryState: 'admitted',
      admittedRunId: f.worker.runId,
    },
  ])
})

it('keeps proven response identity and per-call usage when Worker events are reopened', () => {
  const f = fixture()
  f.worker.preference.cli = 'antigravity'
  writeFileSync(f.workerPath, JSON.stringify(f.worker))
  const store = new WorkerStorage(f.dir)
  const response = { id: 'agy:24', blockId: 'text', index: 0, complete: true as const,
    usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 0, totalTokens: 420 } }
  store.append(f.worker, { kind: 'assistant', text: 'Synthetic response', step: 24, response })
  store.close()
  const cold = new WorkerStorage(f.dir)
  cleanup.push(() => cold.close())
  expect(cold.history(f.worker.id).at(-1)?.response).toEqual(response)
  expect(foldEvents(cold.history(f.worker.id)).at(-1)?.response).toEqual(response)
})

describe('over-long tool commands', () => {
  const longCommand = `powershell.exe -Command '${'x'.repeat(40_000)}'`

  it('loads a persisted log whose tool command exceeds the display limit', () => {
    const f = fixture()
    const row = JSON.parse(readFileSync(f.eventPath, 'utf8'))
    const tool = { seq: 2, runId: f.worker.runId, time: f.worker.updatedAt, kind: 'tool', text: 'shell', toolCall: { callId: 'call-1', command: longCommand } }
    writeFileSync(f.eventPath, [row, tool].map((value) => JSON.stringify(value) + '\n').join(''))
    const store = new WorkerStorage(f.dir)
    cleanup.push(() => store.close())
    const history = store.history(f.worker.id)
    expect(history).toHaveLength(2)
    expect(history[1].toolCall?.callId).toBe('call-1')
    expect(history[1].toolCall?.command).toBe(longCommand.slice(0, 32768))
  })

  it('clips a long command when appending so the next start reads it back', () => {
    const f = fixture()
    const store = new WorkerStorage(f.dir)
    store.append(f.worker, { kind: 'tool', text: 'shell', toolCall: { callId: 'call-1', command: longCommand } })
    // A surrogate pair straddling the limit is dropped whole rather than split.
    store.append(f.worker, { kind: 'tool', text: 'shell', toolCall: { command: 'a'.repeat(32767) + '😀tail' } })
    store.close()
    const persisted = readFileSync(f.eventPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    expect(persisted[1].toolCall.command).toHaveLength(32768)
    expect(persisted[2].toolCall.command).toBe('a'.repeat(32767))
    const reopened = new WorkerStorage(f.dir)
    cleanup.push(() => reopened.close())
    expect(reopened.history(f.worker.id).map((event) => event.toolCall?.command?.length)).toEqual([undefined, 32768, 32767])
  })
})
