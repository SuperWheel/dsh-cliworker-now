import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DsBotLineage, dsBotChains } from '../src/host/parent-lineage.ts'
import { HarnessConversationStore } from '../src/host/harness-conversation-store.ts'
import { replaceWorkerBinding } from '../src/host/worker-binding-replacement.ts'
import { WorkerRuntime } from './fixtures/legacy-runtime.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
import type { Worker } from '../src/shared/types.ts'

// Synthetic DS Bot team files only (shape from Fei2411/DS-Bot src/host/store.js). No DS Bot, CLI or model.
const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
const temp = (prefix: string) => {
  const path = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  cleanup.push(() => rmSync(path, { recursive: true, force: true }))
  return path
}
const team = (bots: Record<string, unknown> = {}, rooms: Record<string, unknown> = {}) => ({ version: 1, mainBotIds: [], bots, rooms })
const segment = (sessionId: string) => ({ sessionId, endedAt: 1 })
const chef = { id: 'bot-first', sessionId: 'bot-third', segments: [segment('bot-first'), segment('bot-second')] }

describe('DS Bot segment chains', () => {
  it('reads own-chat, group member and group chains with their current segments', () => {
    const chains = dsBotChains(team({ chef }, {
      room: { id: 'room-first', sessionId: 'room-second', parts: [segment('room-first')],
        sessions: { chef: 'member-second' }, segments: { chef: [segment('member-first')] } },
    }))
    expect(chains.map(({ current, members }) => [current, [...members].sort()])).toEqual([
      ['bot-third', ['bot-first', 'bot-second', 'bot-third']],
      ['room-second', ['room-first', 'room-second']],
      ['member-second', ['member-first', 'member-second']],
    ])
  })
  it('drops every chain that shares a session id and rejects malformed or foreign files', () => {
    const other = { id: 'other-bot', sessionId: 'other-current', segments: [segment('bot-second')] }
    expect(dsBotChains(team({ chef, other }))).toEqual([])
    expect(dsBotChains({ ...team({ chef }), version: 2 })).toEqual([])
    expect(dsBotChains(team({ chef: { ...chef, segments: [{ endedAt: 1 }] } }))).toEqual([])
    expect(dsBotChains(null)).toEqual([])
    expect(dsBotChains({ version: 1, bots: [] })).toEqual([])
  })
  it('answers only for the current segment and re-reads the file when it changes', () => {
    const root = temp('cwn-dsbot-')
    const path = join(root, 'bot', 'state.json')
    const lineage = new DsBotLineage(path)
    expect(lineage.formerSegments('bot-third')).toBeUndefined()
    mkdirSync(join(root, 'bot'))
    writeFileSync(path, JSON.stringify(team({ chef })))
    expect([...lineage.formerSegments('bot-third')!].sort()).toEqual(['bot-first', 'bot-second'])
    expect(lineage.formerSegments('bot-second')).toBeUndefined()
    // DS Bot reopened an earlier part: it becomes current, the old current joins the segments.
    writeFileSync(path, JSON.stringify(team({ chef: { ...chef, sessionId: 'bot-second', segments: [segment('bot-first'), segment('bot-third')] } })))
    utimesSync(path, new Date(), new Date(Date.now() + 5_000))
    expect([...lineage.formerSegments('bot-second')!].sort()).toEqual(['bot-first', 'bot-third'])
    expect(lineage.formerSegments('bot-third')).toBeUndefined()
    writeFileSync(path, '{ torn')
    utimesSync(path, new Date(), new Date(Date.now() + 10_000))
    expect(lineage.formerSegments('bot-second')).toBeUndefined()
  })
})

describe('rebinding Workers to the current segment (Issue #10)', () => {
  const setup = () => {
    const project = temp('cwn-lineage-runtime-')
    const storage = new WorkerStorage(join(project, 'state'))
    const backend: ProcessBackend = {
      resolveExecutable: vi.fn(async () => '/synthetic/no-cli'),
      spawn: vi.fn(() => {
        throw new Error('Synthetic backend must never start')
      }),
    }
    const runtime = new WorkerRuntime(storage, backend, DEFAULT_CONFIG)
    cleanup.push(() => runtime.close())
    const chains = new Map<string, Set<string>>([['bot-third', new Set(['bot-first', 'bot-second'])]])
    runtime.setParentLineage({ formerSegments: (parent) => chains.get(parent) })
    const worker = (parentSessionId: string, patch: Partial<Worker> = {}): Worker => {
      const value: Worker = {
        id: randomUUID(), runId: randomUUID(), parentSessionId, project,
        title: 'Synthetic segment worker', preference: { cli: 'codex', model: 'synthetic-model', effort: 'default' },
        conversationId: 'native-session-kept', mode: 'accept-edits', status: 'completed',
        createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:01.000Z', ...patch,
      }
      storage.save(value)
      return value
    }
    return { project, storage, runtime, worker, backend, chains }
  }
  it('moves idle Workers of earlier segments to the current one and keeps the CLI session', () => {
    const { storage, runtime, worker, project, backend } = setup()
    const first = worker('bot-first'), second = worker('bot-second', { archivedAt: '2026-11-10T00:00:02.000Z' })
    const unrelated = worker('another-conversation')
    const snapshot = runtime.snapshot('bot-third')
    expect(snapshot.workers.map((entry) => entry.id)).toEqual([first.id])
    expect(snapshot.archivedWorkers.map((entry) => entry.id)).toEqual([second.id])
    expect(runtime.get('bot-third', first.id)).toMatchObject({
      parentSessionId: 'bot-third', formerParentSessionIds: ['bot-first'], conversationId: 'native-session-kept',
    })
    expect(() => runtime.get('bot-first', first.id)).toThrow('Worker does not belong to this conversation')
    expect(() => runtime.get('bot-third', unrelated.id)).toThrow('Worker does not belong to this conversation')
    expect(storage.workers.get(unrelated.id)?.parentSessionId).toBe('another-conversation')
    // The rebinding is durable.
    expect(JSON.parse(readFileSync(join(project, 'state', `${first.id}.worker.json`), 'utf8')))
      .toMatchObject({ parentSessionId: 'bot-third', formerParentSessionIds: ['bot-first'] })
    expect(backend.spawn).not.toHaveBeenCalled()
  })
  it('never moves Workers for a parent that is not the current segment of a proven chain', () => {
    const { storage, runtime, worker } = setup()
    const first = worker('bot-first')
    expect(runtime.snapshot('bot-second').workers).toEqual([])
    expect(() => runtime.resolveWorker('unrelated', first.id)).toThrow('Worker does not belong to this conversation')
    expect(storage.workers.get(first.id)?.parentSessionId).toBe('bot-first')
    expect(storage.workers.get(first.id)?.formerParentSessionIds).toBeUndefined()
  })
  it('leaves a running Worker on its segment until it is idle', () => {
    const { storage, runtime, worker } = setup()
    const running = worker('bot-second', { status: 'running' })
    expect(() => runtime.get('bot-third', running.id)).toThrow('Worker does not belong to this conversation')
    expect(storage.workers.get(running.id)?.parentSessionId).toBe('bot-second')
    storage.save({ ...storage.workers.get(running.id)!, status: 'completed' })
    expect(runtime.get('bot-third', running.id).parentSessionId).toBe('bot-third')
  })
  it('moves Workers back when the user reopens an earlier segment', () => {
    const { runtime, worker, chains } = setup()
    const first = worker('bot-first')
    runtime.snapshot('bot-third')
    chains.clear()
    chains.set('bot-first', new Set(['bot-second', 'bot-third']))
    expect(runtime.get('bot-first', first.id)).toMatchObject({ parentSessionId: 'bot-first', formerParentSessionIds: ['bot-third'] })
  })
  it('resolves rebound Workers by name under the current segment', () => {
    const { runtime, worker } = setup()
    const first = worker('bot-first', { agentName: 'codex-1', agentNameOrigin: 'auto' })
    expect(runtime.resolveWorker('bot-third', undefined, 'codex-1').id).toBe(first.id)
  })
})

describe('display binding reparenting', () => {
  it('accepts a replacement under another parent only when the caller declares the proven reparent', () => {
    const root = temp('cwn-bindings-reparent-')
    const store = new HarnessConversationStore(root)
    const old = { workerId: randomUUID(), parentSessionId: 'bot-first', sessionId: 'old-child' }
    store.save(old)
    const next = { workerId: old.workerId, parentSessionId: 'bot-third', sessionId: 'new-child', retiredSessionIds: ['old-child'] }
    expect(() => store.replace(old, next)).toThrow('原生会话替换身份或历史引用不匹配')
    store.replace(old, next, { reparent: true })
    expect(new HarnessConversationStore(root).list()).toEqual([next])
    expect(() => store.replace(next, { ...next, workerId: randomUUID(), sessionId: 'third-child', retiredSessionIds: ['old-child', 'new-child'] }, { reparent: true })).toThrow()
  })
})

describe('host binding replacement across segments (Issue #10)', () => {
  const setup = (formerParentSessionIds?: string[]) => {
    const project = temp('cwn-lineage-host-')
    const storage = new WorkerStorage(join(project, 'state'))
    const backend: ProcessBackend = {
      resolveExecutable: vi.fn(async () => '/synthetic/no-cli'),
      spawn: vi.fn(() => { throw new Error('Synthetic backend must never start') }),
    }
    const runtime = new WorkerRuntime(storage, backend, DEFAULT_CONFIG)
    cleanup.push(() => runtime.close())
    const records = new HarnessConversationStore(join(project, 'state'))
    const capabilities = { message: true } as never
    const worker: Worker = {
      id: randomUUID(), runId: randomUUID(), parentSessionId: 'bot-third', project,
      title: 'Synthetic rebound worker', preference: { cli: 'codex', model: 'synthetic-model', effort: 'default' },
      conversationId: 'native-session-kept', mode: 'accept-edits', status: 'completed',
      createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:01.000Z',
      ...(formerParentSessionIds ? { formerParentSessionIds } : {}),
      harnessConversation: { sessionId: 'old-child', parentSessionId: 'bot-first', mode: 'continuable', capabilities },
    }
    storage.save(worker)
    const old = { workerId: worker.id, parentSessionId: 'bot-first', sessionId: 'old-child' }
    records.save(old)
    const next = { workerId: worker.id, parentSessionId: 'bot-third', sessionId: 'new-child', retiredSessionIds: ['old-child'] }
    return { project, storage, runtime, records, worker, old, next }
  }
  it('moves the display child of a former segment under the current parent', () => {
    const { project, runtime, records, worker, old, next } = setup(['bot-first'])
    const changed = vi.spyOn(runtime, 'changed')
    replaceWorkerBinding(runtime, records, old, next)
    expect(records.list()).toEqual([next])
    expect(runtime.get('bot-third', worker.id).harnessConversation).toMatchObject({ sessionId: 'new-child', parentSessionId: 'bot-third' })
    expect(JSON.parse(readFileSync(join(project, 'state', `${worker.id}.worker.json`), 'utf8')).harnessConversation)
      .toMatchObject({ sessionId: 'new-child', parentSessionId: 'bot-third' })
    expect(changed).toHaveBeenCalled()
  })
  it('accepts the rollback back to the former segment', () => {
    const { runtime, records, worker, old, next } = setup(['bot-first'])
    replaceWorkerBinding(runtime, records, old, next)
    const rollback = { ...old, retiredSessionIds: ['new-child'] }
    replaceWorkerBinding(runtime, records, next, rollback)
    expect(records.list()).toEqual([rollback])
    expect(runtime.get('bot-third', worker.id).harnessConversation?.parentSessionId).toBe('bot-first')
  })
  it('refuses a parent change that is not a recorded former segment and leaves both stores untouched', () => {
    const { runtime, records, worker, old, next } = setup()
    expect(() => replaceWorkerBinding(runtime, records, old, next)).toThrow('原生会话父身份不匹配')
    const other = setup(['bot-zero'])
    expect(() => replaceWorkerBinding(other.runtime, other.records, other.old, other.next)).toThrow('原生会话父身份不匹配')
    expect(records.list()).toEqual([old])
    expect(runtime.get('bot-third', worker.id).harnessConversation?.sessionId).toBe('old-child')
    expect(() => replaceWorkerBinding(runtime, records, old, { ...next, workerId: randomUUID() }))
      .toThrow('Worker 原生会话替换的当前身份不匹配')
  })
  it('restores the previous binding when the Worker cannot be saved', () => {
    const { storage, runtime, records, worker, old, next } = setup(['bot-first'])
    vi.spyOn(storage, 'save').mockImplementationOnce(() => { throw new Error('synthetic disk full') })
    expect(() => replaceWorkerBinding(runtime, records, old, next)).toThrow('synthetic disk full')
    expect(records.list()).toEqual([{ ...old, retiredSessionIds: ['new-child'] }])
    expect(runtime.get('bot-third', worker.id).harnessConversation).toMatchObject({ sessionId: 'old-child', parentSessionId: 'bot-first' })
  })
})
