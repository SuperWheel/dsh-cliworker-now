import { expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CliProtocol } from '../src/host/cli-protocol.ts'
import { BridgeProtocol } from '../src/host/bridge-protocol.ts'
import { GrokProtocol } from '../src/host/grok-adapter.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { foldEvents, type Worker, type WorkerEvent } from '../src/shared/types.ts'

// Synthetic native public events, no model execution or user conversation.
function fixture(cli: 'codex' | 'claude' | 'grok' | 'bridge') {
  const events: WorkerEvent[] = []
  const emit = (event: Omit<WorkerEvent, 'seq' | 'runId' | 'time'>) =>
    events.push({ ...event, seq: events.length + 1, runId: 'run', time: '2026-10-15T00:00:00Z' })
  const parser =
    cli === 'grok'
      ? new GrokProtocol(emit, () => {}, 8192)
      : cli === 'bridge'
        ? new BridgeProtocol(emit, () => {}, 8192)
        : new CliProtocol(cli, emit, () => {}, 8192)
  return {
    events,
    parser,
    send: (...rows: unknown[]) => parser.feed(rows.map(JSON.stringify).join('\n') + '\n'),
  }
}

it('projects only the completed Codex public summary, deduplicating it independently of the final answer', () => {
  const f = fixture('codex')
  f.send(
    { type: 'thread.started', thread_id: 'synthetic' },
    { type: 'item.started', item: { id: 'r', type: 'reasoning', text: '尚未完成' } },
    {
      type: 'item.completed',
      item: {
        id: 'r',
        type: 'reasoning',
        text: '模拟公开摘要',
        raw_content: 'RAW_PRIVATE',
        encrypted_content: 'ENCRYPTED',
      },
    },
    { type: 'item.completed', item: { id: 'r', type: 'reasoning', text: '模拟公开摘要' } },
    { type: 'item.completed', item: { id: 'opaque', type: 'reasoning', text: { secret: 'RAW_PRIVATE' } } },
    { type: 'item.completed', item: { id: 'a', type: 'agent_message', text: '模拟最终回复' } },
    { type: 'turn.completed' },
  )
  const rows = foldEvents(f.events)
  expect(rows.filter((row) => row.kind === 'reasoning')).toEqual([
    expect.objectContaining({ text: 'Codex 思考摘要', detail: '模拟公开摘要' }),
  ])
  expect(rows.filter((row) => row.kind === 'assistant')).toHaveLength(1)
  expect(f.parser.result?.response).toBe('模拟最终回复')
  expect(JSON.stringify(f.events)).not.toMatch(/RAW_PRIVATE|ENCRYPTED|尚未完成/)
})

it('projects Claude visible thinking only and keeps multiple blocks distinct', () => {
  const f = fixture('claude')
  const message = {
    type: 'assistant',
    session_id: 'synthetic',
    message: {
      id: 'm',
      content: [
        { type: 'thinking', thinking: '模拟公开思考1', signature: 'SIGNATURE' },
        { type: 'redacted_thinking', data: 'ENCRYPTED', thinking: 'REDACTED' },
        { type: 'thinking', thinking: 'REDACTED', redacted: true },
        { type: 'thinking', thinking: '模拟公开思考2' },
        { type: 'thinking', thinking: { secret: 'PRIVATE' } },
        { type: 'text', text: '模拟最终回复' },
      ],
    },
  }
  f.send(message, message, {
    type: 'result',
    session_id: 'synthetic',
    subtype: 'success',
    result: '模拟最终回复',
  })
  expect(
    foldEvents(f.events)
      .filter((row) => row.kind === 'reasoning')
      .map((row) => row.detail),
  ).toEqual(['模拟公开思考1', '模拟公开思考2'])
  expect(f.parser.result?.response).toBe('模拟最终回复')
  expect(JSON.stringify(f.events)).not.toMatch(/SIGNATURE|ENCRYPTED|REDACTED|PRIVATE/)
})

it('aggregates Grok public chunks by response and renders only plan content fields', () => {
  const f = fixture('grok')
  f.send(
    { type: 'thought', data: '模拟公开' },
    { type: 'thought', data: '过程1' },
    { type: 'usage', signature: 'OPAQUE_SIGNATURE' },
    { type: 'thought', data: '模拟过程2' },
    { type: 'plan', entries: [{ content: '检查结果', status: 'pending', signature: 'OPAQUE_SIGNATURE' }] },
    { type: 'plan', entries: [{ content: '检查结果', status: 'completed' }] },
    { type: 'text', data: '模拟回复' },
    { type: 'end', sessionId: 'synthetic', stopReason: 'end_turn' },
  )
  f.parser.end()
  const rows = foldEvents(f.events)
  expect(rows.filter((row) => row.kind === 'reasoning').map((row) => row.detail)).toEqual([
    '模拟公开过程1',
    '模拟过程2',
  ])
  expect(rows.filter((row) => row.text === 'Grok 工作计划')).toEqual([
    expect.objectContaining({ detail: '[completed] 检查结果' }),
  ])
  expect(f.parser.result?.response).toBe('模拟回复')
  expect(JSON.stringify(f.events)).not.toContain('OPAQUE_SIGNATURE')
})

it('accepts bridge public snapshots, permits withdrawal, and never treats them as successful output', () => {
  const f = fixture('bridge')
  f.send(
    { type: 'session', id: 'synthetic' },
    { type: 'event', event: { kind: 'reasoning', step: 1, text: 'Pi 公开思考', detail: '模拟快照' } },
    { type: 'event', event: { kind: 'reasoning', step: 1, text: 'Pi 公开思考', detail: '模拟快照更新' } },
    { type: 'event', event: { kind: 'reasoning', step: 1, text: 'Pi 公开思考', detail: '' } },
    { type: 'result', status: 'ERROR', response: '', error: '模拟失败' },
  )
  expect(foldEvents(f.events).filter((row) => row.kind === 'reasoning')).toEqual([
    expect.objectContaining({ detail: '' }),
  ])
  expect(f.parser.result).toMatchObject({ status: 'ERROR', response: '' })
  const bad = fixture('bridge')
  expect(() => bad.send({ type: 'event', event: { kind: 'private', text: 'secret' } })).toThrow()
})

it('preserves the last observed partial thought at EOF and marks it interrupted without claiming completion', () => {
  const f = fixture('grok')
  f.send(
    { type: 'thought', sessionId: 'synthetic', data: '模拟部分' },
    { type: 'thought', data: '过程' },
  )
  f.parser.end()
  const thoughts = foldEvents(f.events, { runId: 'run', status: 'interrupted' })
    .filter((row) => row.kind === 'reasoning')
  expect(thoughts).toEqual([
    expect.objectContaining({ detail: '模拟部分过程', state: 'RUNNING', runStatus: 'interrupted' }),
  ])
  expect(f.parser.result?.status).toBe('ERROR')
})

it('reopens persisted public reasoning without losing its event kind', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cwn-public-process-'))
  const worker: Worker = {
    id: randomUUID(),
    runId: randomUUID(),
    parentSessionId: 'synthetic',
    project: directory,
    title: '模拟',
    preference: { cli: 'codex', model: 'synthetic', effort: 'low' },
    mode: 'accept-edits',
    status: 'completed',
    createdAt: '2026-10-15T00:00:00Z',
    updatedAt: '2026-10-15T00:00:00Z',
  }
  let storage: WorkerStorage | undefined
  try {
    storage = new WorkerStorage(directory)
    storage.save(worker)
    storage.append(worker, { kind: 'reasoning', step: 0, text: 'Codex 思考摘要', detail: '模拟摘要' })
    storage.close()
    storage = new WorkerStorage(directory)
    expect(storage.history(worker.id)[0]).toMatchObject({ kind: 'reasoning', detail: '模拟摘要' })
  } finally {
    storage?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('keeps the CLI Worker notice flag only on bridge diagnostics, through storage (synthetic)', () => {
  const f = fixture('bridge')
  f.send(
    { type: 'session', id: 'synthetic' },
    { type: 'event', event: { kind: 'diagnostic', notice: true, text: '模拟自动跟进说明' } },
    { type: 'event', event: { kind: 'diagnostic', notice: 'yes', text: '模拟普通诊断' } },
    { type: 'event', event: { kind: 'assistant', notice: true, text: '模拟正文' } },
  )
  expect(f.events.filter((event) => event.notice).map((event) => event.text)).toEqual(['模拟自动跟进说明'])
  expect(foldEvents(f.events).filter((row) => row.notice).map((row) => row.text)).toEqual(['模拟自动跟进说明'])
  const directory = mkdtempSync(join(tmpdir(), 'cwn-notice-'))
  const worker: Worker = {
    id: randomUUID(),
    runId: randomUUID(),
    parentSessionId: 'synthetic-parent',
    project: directory,
    title: '模拟',
    preference: { cli: 'antigravity', model: 'synthetic', effort: 'low' },
    mode: 'accept-edits',
    status: 'completed',
    createdAt: '2026-10-15T00:00:00Z',
    updatedAt: '2026-10-15T00:00:00Z',
  }
  let storage: WorkerStorage | undefined
  try {
    storage = new WorkerStorage(directory)
    storage.save(worker)
    storage.append(worker, { kind: 'diagnostic', notice: true, text: '模拟自动跟进说明' })
    storage.close()
    storage = new WorkerStorage(directory)
    expect(storage.history(worker.id)[0]).toMatchObject({ kind: 'diagnostic', notice: true })
  } finally {
    storage?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
