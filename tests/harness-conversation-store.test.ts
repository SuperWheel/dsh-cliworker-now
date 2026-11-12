import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { HarnessConversationStore } from '../src/host/harness-conversation-store.ts'

const directories: string[] = []
const directory = () => {
  const path = mkdtempSync(join(tmpdir(), 'cwn-bindings-'))
  directories.push(path)
  return path
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})
it('restores independent native identities and initial attach state without changing the CLI identity', () => {
  const root = directory(),
    store = new HarnessConversationStore(root)
  const record = {
    workerId: randomUUID(),
    parentSessionId: 'parent',
    sessionId: 'native-child',
    initialRunId: randomUUID(),
    initialPending: true,
  }
  store.save(record)
  expect(new HarnessConversationStore(root).list()).toEqual([record])
  if (process.platform !== 'win32')
    expect(statSync(join(root, 'harness-conversations.json')).mode & 0o777).toBe(0o600)
  store.save({ ...record, initialPending: false })
  expect(new HarnessConversationStore(root).list()[0]?.initialPending).toBe(false)
  expect(() => store.save({ ...record, parentSessionId: 'other' })).toThrow()
  expect(() => store.save({ ...record, sessionId: 'other-child' })).toThrow()
})
it('rolls back only the exact association and persists the removal', () => {
  const root = directory(),
    store = new HarnessConversationStore(root)
  const record = { workerId: randomUUID(), parentSessionId: 'parent', sessionId: 'native-child' }
  store.save(record)
  expect(() => store.remove({ ...record, workerId: randomUUID() })).toThrow()
  expect(store.list()).toEqual([record])
  store.remove(record)
  expect(new HarnessConversationStore(root).list()).toEqual([])
})
it('preserves up to 64 retired display Sessions and reads legacy bindings without that optional field', () => {
  const root = directory(), store = new HarnessConversationStore(root)
  const legacy = { workerId: randomUUID(), parentSessionId: 'parent', sessionId: 'current-child' }
  store.save(legacy)
  expect(new HarnessConversationStore(root).list()).toEqual([legacy])
  const retiredSessionIds = Array.from({ length: 64 }, (_, index) => `synthetic-retired-${index}`)
  store.save({ ...legacy, retiredSessionIds })
  expect(new HarnessConversationStore(root).list()).toEqual([{ ...legacy, retiredSessionIds }])
  expect(() => store.save({ ...legacy, retiredSessionIds: [...retiredSessionIds, 'overflow'] })).toThrow()
  expect(() => store.save({ ...legacy, retiredSessionIds: [''] })).toThrow()
  expect(new HarnessConversationStore(root).list()[0]?.retiredSessionIds).toEqual(retiredSessionIds)
})
it('atomically replaces only the current owned association and preserves every retired Session reference', () => {
  const root = directory(),
    store = new HarnessConversationStore(root)
  const old = { workerId: randomUUID(), parentSessionId: 'parent', sessionId: randomUUID() }
  store.save(old)
  const replacement = { ...old, sessionId: randomUUID(), retiredSessionIds: [old.sessionId] }
  expect(() => store.replace({ ...old, parentSessionId: 'other' }, replacement)).toThrow()
  expect(() => store.replace(old, { ...replacement, retiredSessionIds: [] })).toThrow()
  store.replace(old, replacement)
  expect(new HarnessConversationStore(root).list()).toEqual([replacement])
  expect(() => store.replace(old, replacement)).toThrow()
  const rollback = { ...old, retiredSessionIds: [replacement.sessionId] }
  store.replace(replacement, rollback)
  expect(new HarnessConversationStore(root).list()).toEqual([rollback])
})
it('persists projection-only admitted runs without exposing mutable internal arrays', () => {
  const root = directory(),
    store = new HarnessConversationStore(root)
  const pending = { requestId: randomUUID(), runId: randomUUID() }
  const record = {
    workerId: randomUUID(),
    parentSessionId: 'parent',
    sessionId: 'native-child',
    pendingRuns: [pending],
  }
  store.save(record)
  const exposed = store.list()[0]!
  exposed.pendingRuns!.splice(0)
  expect(store.list()[0]!.pendingRuns).toEqual([pending])
  expect(new HarnessConversationStore(root).list()[0]!.pendingRuns).toEqual([pending])
  expect(() => store.save({ ...record, pendingRuns: Array(257).fill(pending) })).toThrow()
})
it.skipIf(process.platform === 'win32')('refuses a symlinked association file', () => {
  const root = directory(),
    target = directory()
  symlinkSync(join(target, 'missing'), join(root, 'harness-conversations.json'))
  expect(() => new HarnessConversationStore(root)).toThrow()
})

it('durably saves per-input intent and acceptance without retaining prompt bodies or leaking mutable records', () => {
  const root = directory(),
    store = new HarnessConversationStore(root)
  const input = {
    requestId: randomUUID(),
    promptHash: 'a'.repeat(64),
    batchId: randomUUID(),
    accepted: false,
  }
  const record = {
    workerId: randomUUID(),
    parentSessionId: 'parent',
    sessionId: 'native-child',
    nativeInputs: [input],
  }
  store.save(record)
  expect(new HarnessConversationStore(root).list()).toEqual([record])
  const exposed = store.list()[0]!
  exposed.nativeInputs![0]!.accepted = true
  expect(store.list()[0]!.nativeInputs).toEqual([input])
  const accepted = { ...record, nativeInputs: [{ ...input, accepted: true }] }
  store.save(accepted)
  expect(new HarnessConversationStore(root).list()).toEqual([accepted])
  expect(() => store.save({ ...record, nativeInputs: [{ ...input, promptHash: 'invalid' }] })).toThrow()
  expect(() => store.save({ ...record, nativeInputs: Array(10001).fill(input) })).toThrow()
  const unknown = {
    ...record,
    nativeInputs: [{ ...input, delivery: 'steer' as const, steeringState: 'unknown' as const }],
  }
  store.save(unknown)
  expect(new HarnessConversationStore(root).list()).toEqual([unknown])
})
