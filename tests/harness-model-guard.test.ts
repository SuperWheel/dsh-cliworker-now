import { expect, it, vi } from 'vitest'
import { installHarnessModelGuard, withinCliTool } from '../src/host/harness-model-guard.ts'
import { CliWorkerService } from '../src/host/index.ts'
import type { Context } from '@deepseek-ai/cordis'

it('blocks unattributed auxiliary model calls from CLI tools without blocking ordinary DSH calls', async () => {
  let listener: any
  const dispose = vi.fn()
  const context = {
    on: (_name: string, callback: unknown) => {
      listener = callback
      return dispose
    },
  } as unknown as Context
  expect(installHarnessModelGuard(context)).toBe(dispose)
  const backend = vi.fn(async function* () {
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  const drain = async () => {
    for await (const _chunk of listener({}, backend)) {
      /* synthetic stream */
    }
  }
  await expect(
    withinCliTool('current-run', async () => {
      await Promise.resolve()
      await drain()
    }),
  ).rejects.toThrow('禁止 DSH 模型 API')
  expect(backend).not.toHaveBeenCalled()
  await drain()
  expect(backend).toHaveBeenCalledOnce()
})


it('authorized sibling job publication detaches only the old tool guard and retains both runs tool guards', async () => {
  let listener: any
  installHarnessModelGuard({ on: (_name: string, callback: unknown) => { listener = callback; return () => {} } } as any)
  const nativeProjection = vi.fn(async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })
  const drain = async () => { for await (const _frame of listener({}, nativeProjection)) { /* simulated native stream */ } }
  const preference = { cli: 'codex', model: 'selected', effort: 'high' }
  const worker: any = { id: 'sibling', runId: 'sibling-run', parentSessionId: 'main', status: 'running', preference }
  let done!: Promise<any>
  const jobs = { start: vi.fn((spec: any) => { expect(spec.owner).toBe('main'); spec.run(); return 'synthetic-job' }) }
  // Simulated DSH services: jobs, plus the permission state read for the dispatch receipt.
  const services: Record<string, unknown> = { jobs, sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) } }
  const parent: any = { id: 'main', ctx: { get: (name: string) => services[name] } }
  const service: any = Object.assign(Object.create(CliWorkerService.prototype), {
    disposed: new AbortController(), nativeRunDone: new Map(),
    assertExecution: vi.fn(), assertAccessSupported: vi.fn(), project: () => '/synthetic/project',
    accounts: { isBusy: () => false }, authorizeChoice: async () => ({ binding: 'synthetic', preference }),
    runtime: { assertCliEnabled: vi.fn(), assertSiblingCapacity: vi.fn(), attachJob: vi.fn(),
      submit: () => {
        done = Promise.resolve().then(async () => { await drain(); return worker })
        return { worker, done, cancel: vi.fn() }
      },
    },
  })
  await withinCliTool('source-run', async () => {
    const receipt = JSON.parse(await service.launch(parent, 'sibling', 'synthetic', preference, 'accept-edits', undefined,
      { initiator: { kind: 'worker', id: 'source', name: 'Source' } }))
    expect(receipt.workerId).toBe('sibling')
    await done
    await expect(drain()).rejects.toThrow('禁止 DSH 模型 API')
  })
  await expect(withinCliTool('sibling-run', drain)).rejects.toThrow('禁止 DSH 模型 API')
  expect(nativeProjection).toHaveBeenCalledOnce()
})
