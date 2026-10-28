import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { WorkerRuntime } from '../src/host/runtime.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
import type { Worker } from '../src/shared/types.ts'

// Synthetic private state only; no CLI is resolved or started successfully.
vi.mock('../src/host/agy-context.ts', () => ({ AgyContextReader: class { read() {} } }))
vi.mock('../src/host/cli-account-binding.ts', () => ({ readCliAccountBinding: async () => 'synthetic-account' }))
vi.mock('../src/host/authorized-catalog.ts', () => ({
  ACCOUNT_CHANGED: 'account changed',
  authorizeSelection: async (preference: unknown) => ({ binding: 'synthetic-account', preference }),
}))
const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
function directory() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-general-settings-')))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  return root
}

it('persists the shared concurrency limit privately and restores the deployment default on null', () => {
  const root = directory()
  const state = join(root, 'state')
  let storage = new WorkerStorage(state)
  expect(storage.generalSettings()).toEqual({})
  expect(storage.setGeneralSettings({ maxConcurrent: 5 })).toEqual({ maxConcurrent: 5 })
  if (process.platform !== 'win32') expect(statSync(join(state, 'general-settings.json')).mode & 0o777).toBe(0o600)
  storage.close()
  storage = new WorkerStorage(state)
  cleanup.push(() => storage.close())
  expect(storage.generalSettings()).toEqual({ maxConcurrent: 5 })
  expect(storage.setGeneralSettings({ maxConcurrent: null })).toEqual({})
  expect(storage.generalSettings()).toEqual({})
})

it('persists the interface language next to the limit and restores follow on null', () => {
  const state = join(directory(), 'state')
  let storage = new WorkerStorage(state)
  storage.setGeneralSettings({ maxConcurrent: 2 })
  expect(storage.setGeneralSettings({ language: 'en' })).toEqual({ maxConcurrent: 2, language: 'en' })
  if (process.platform !== 'win32') expect(statSync(join(state, 'general-settings.json')).mode & 0o777).toBe(0o600)
  storage.close()
  storage = new WorkerStorage(state)
  cleanup.push(() => storage.close())
  expect(storage.generalSettings()).toEqual({ maxConcurrent: 2, language: 'en' })
  expect(storage.setGeneralSettings({ language: null })).toEqual({ maxConcurrent: 2 })
})

it('keeps asking before dispatch for older settings and persists turning it off privately', async () => {
  const state = join(directory(), 'state')
  let storage = new WorkerStorage(state)
  // An older settings file without the field means asking.
  storage.setGeneralSettings({ maxConcurrent: 2 })
  storage.close()
  storage = new WorkerStorage(state)
  let runtime = new WorkerRuntime(storage, { resolveExecutable: vi.fn(), spawn: vi.fn() } as unknown as ProcessBackend, DEFAULT_CONFIG)
  expect(runtime.generalSettings().askBeforeDispatch).toBe(true)
  expect(runtime.setGeneralSettings({ askBeforeDispatch: false }).askBeforeDispatch).toBe(false)
  if (process.platform !== 'win32') {
    expect(statSync(state).mode & 0o777).toBe(0o700)
    expect(statSync(join(state, 'general-settings.json')).mode & 0o777).toBe(0o600)
  }
  await runtime.close()
  storage = new WorkerStorage(state)
  runtime = new WorkerRuntime(storage, { resolveExecutable: vi.fn(), spawn: vi.fn() } as unknown as ProcessBackend, DEFAULT_CONFIG)
  cleanup.push(() => runtime.close())
  expect(storage.generalSettings()).toEqual({ maxConcurrent: 2, askBeforeDispatch: false })
  expect(runtime.setGeneralSettings({ askBeforeDispatch: null }).askBeforeDispatch).toBe(true)
})

it('persists the task time limits privately and falls back to the plugin config timeoutMs', async () => {
  const state = join(directory(), 'state')
  let storage = new WorkerStorage(state)
  const backend = { resolveExecutable: vi.fn(), spawn: vi.fn() } as unknown as ProcessBackend
  let runtime = new WorkerRuntime(storage, backend, { ...DEFAULT_CONFIG, timeoutMs: 2_700_000 })
  expect(runtime.generalSettings()).toMatchObject({
    taskTimeLimitMs: 2_700_000,
    defaultTaskTimeLimitMs: 2_700_000,
    idleTimeLimitMs: 0,
  })
  expect(runtime.setGeneralSettings({ taskTimeLimitMs: 86_400_000, idleTimeLimitMs: 600_000 })).toMatchObject({
    taskTimeLimitMs: 86_400_000,
    defaultTaskTimeLimitMs: 2_700_000,
    idleTimeLimitMs: 600_000,
  })
  if (process.platform !== 'win32') expect(statSync(join(state, 'general-settings.json')).mode & 0o777).toBe(0o600)
  await runtime.close()
  storage = new WorkerStorage(state)
  runtime = new WorkerRuntime(storage, backend, { ...DEFAULT_CONFIG, timeoutMs: 2_700_000 })
  cleanup.push(() => runtime.close())
  expect(storage.generalSettings()).toEqual({ taskTimeLimitMs: 86_400_000, idleTimeLimitMs: 600_000 })
  expect(runtime.setGeneralSettings({ idleTimeLimitMs: 0 }).idleTimeLimitMs).toBe(0)
  expect(runtime.setGeneralSettings({ taskTimeLimitMs: null }).taskTimeLimitMs).toBe(2_700_000)
  expect(storage.generalSettings()).toEqual({ idleTimeLimitMs: 0 })
})

it.each([
  { maxConcurrent: 0 },
  { maxConcurrent: 9 },
  { maxConcurrent: 2.5 },
  { unknown: true },
  null,
  { language: 'fr' },
  { language: '' },
  { language: 1 },
  { askBeforeDispatch: 'no' },
  { taskTimeLimitMs: 999 },
  { taskTimeLimitMs: 86_400_001 },
  { taskTimeLimitMs: 1.5 * 60_000 + 0.5 },
  { idleTimeLimitMs: 30_000 },
  { idleTimeLimitMs: -1 },
  { idleTimeLimitMs: '600000' },
])(
  'rejects an invalid patch without changing the stored value (%j)',
  (patch) => {
    const storage = new WorkerStorage(join(directory(), 'state'))
    cleanup.push(() => storage.close())
    storage.setGeneralSettings({ maxConcurrent: 3 })
    expect(() => storage.setGeneralSettings(patch)).toThrow()
    expect(storage.generalSettings()).toEqual({ maxConcurrent: 3 })
  },
)

it('uses the saved limit over the config and admits queued work as soon as it is raised', async () => {
  const project = directory()
  const storage = new WorkerStorage(join(project, 'private-state'))
  const backend: ProcessBackend = {
    resolveExecutable: vi.fn(async () => {
      throw new Error('Synthetic admission probe')
    }),
    spawn: vi.fn(() => {
      throw new Error('No CLI launch is allowed in this fixture')
    }),
  }
  // Config 0 holds every task in the real queue until the user setting raises the limit.
  const runtime = new WorkerRuntime(storage, backend, { ...DEFAULT_CONFIG, maxConcurrent: 0 })
  cleanup.push(() => runtime.close())
  const worker: Worker = {
    id: randomUUID(), runId: randomUUID(), parentSessionId: 'synthetic-parent', project,
    title: 'Synthetic queued task',
    preference: { cli: 'antigravity', model: 'synthetic-model', effort: 'default' },
    conversationId: 'synthetic-cli-session', mode: 'plan', status: 'completed',
    createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z',
  }
  storage.save(worker)
  storage.bindAccount(worker.id, 'synthetic-account')
  runtime.submit(worker.parentSessionId, project, worker.title, 'synthetic continuation', worker.preference,
    worker.mode, worker.id, undefined, 'synthetic-account')
  await vi.waitFor(() => expect(storage.workers.get(worker.id)?.status).toBe('queued'))
  expect(runtime.generalSettings()).toEqual({
    maxConcurrent: 0,
    defaultMaxConcurrent: 0,
    language: 'follow',
    isolatedParallelWrites: false,
    askBeforeDispatch: true,
    taskTimeLimitMs: 1_800_000,
    defaultTaskTimeLimitMs: 1_800_000,
    idleTimeLimitMs: 0,
  })
  expect(backend.resolveExecutable).not.toHaveBeenCalled()

  expect(runtime.setGeneralSettings({ maxConcurrent: 1 })).toEqual({
    maxConcurrent: 1,
    defaultMaxConcurrent: 0,
    language: 'follow',
    isolatedParallelWrites: false,
    askBeforeDispatch: true,
    taskTimeLimitMs: 1_800_000,
    defaultTaskTimeLimitMs: 1_800_000,
    idleTimeLimitMs: 0,
  })
  await vi.waitFor(() => expect(storage.workers.get(worker.id)?.status).not.toBe('queued'))
})

it('streams a saved interface language to every snapshot and omits follow', () => {
  const storage = new WorkerStorage(join(directory(), 'state'))
  const runtime = new WorkerRuntime(storage, { resolveExecutable: vi.fn(), spawn: vi.fn() } as unknown as ProcessBackend, DEFAULT_CONFIG)
  cleanup.push(() => runtime.close())
  expect(runtime.snapshot('synthetic-parent').language).toBeUndefined()
  expect(runtime.setGeneralSettings({ language: 'en' })).toMatchObject({ language: 'en' })
  expect(runtime.snapshot('synthetic-parent').language).toBe('en')
  expect(runtime.setGeneralSettings({ language: null })).toMatchObject({ language: 'follow' })
  expect(runtime.snapshot('synthetic-parent').language).toBeUndefined()
})
