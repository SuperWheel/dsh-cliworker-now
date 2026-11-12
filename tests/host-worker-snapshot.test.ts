import { expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CliWorkerService } from '../src/host/index.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { WorkerRuntime } from '../src/host/runtime.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
import type { Worker } from '../src/shared/types.ts'

it('publishes a completed persisted Worker independently of native directory availability and only for its exact parent', async () => {
  // SIMULATION: synthetic disk record, actual storage/runtime/watch; no account or CLI.
  const directory = mkdtempSync(join(tmpdir(), 'cwn-rc2-snapshot-'))
  let runtime: WorkerRuntime | undefined
  const controller = new AbortController()
  try {
    let storage = new WorkerStorage(directory)
    const worker: Worker = {
      id: randomUUID(), parentSessionId: 'synthetic-main', project: directory,
      title: 'SIMULATED completed worker', preference: { cli: 'codex', model: 'simulated', effort: 'default' },
      mode: 'accept-edits', status: 'completed', runId: randomUUID(),
      createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z',
    }
    storage.save(worker)
    storage.close()
    storage = new WorkerStorage(directory)
    const spawn = vi.fn(() => { throw new Error('CLI execution forbidden') })
    runtime = new WorkerRuntime(storage, { resolveExecutable: async () => { throw new Error('CLI discovery forbidden') }, spawn }, DEFAULT_CONFIG)
    const off = vi.fn(), nativeList = vi.fn(() => { throw new Error('simulation: native directory unavailable') })
    const service: CliWorkerService = Object.assign(Object.create(CliWorkerService.prototype), {
      ctx: { on: () => off }, runtime, disposed: new AbortController(), pending: new Map(),
      dshSubagents: { list: nativeList },
    })
    const stream = service.watch(worker.parentSessionId, '', controller.signal)
    const snapshot = JSON.parse((await stream.next()).value!)
    expect(snapshot.workers).toHaveLength(1)
    expect(snapshot.workers[0]).toMatchObject(worker)
    expect(runtime.snapshot('synthetic-other').workers).toEqual([])
    expect(nativeList).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
    controller.abort()
    await stream.return()
    expect(off).toHaveBeenCalledOnce()
  } finally {
    controller.abort()
    await runtime?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
