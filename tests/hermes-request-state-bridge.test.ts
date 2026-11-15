import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runNativeHermes } from '../src/host/native-hermes.mjs'

// 模拟：HTTP/SSE and process; actual observer file polling runs.
// No external Hermes source, CLI, account, model or network is invoked.
const wire = vi.hoisted(() => ({ root: '', home: '', observer: '', nonce: '', sequence: 0,
  calls: [] as string[], cleanup: vi.fn(), finish: undefined as any,
  done: undefined as any, stop: undefined as any, runtime: {} as any,
  observerMode: 'complete', retry: true, submissions: [] as any[], launches: [] as any[] }))
vi.mock('../src/host/native-hermes-home.mjs', () => ({
  prepareHermesHttpHome: async () => ({ home: wire.home, env: {}, cleanup: wire.cleanup }),
}))
vi.mock('../src/host/native-http.mjs', async load => {
  const actual = await load<Record<string, any>>()
  return { ...actual, vacantPort: async () => 31001,
    httpJson: async (_base: unknown, path: string, options: any) => {
      wire.calls.push(path)
      if (path === '/v1/capabilities') return { object: 'hermes.api_server.capabilities',
        auth: { type: 'bearer', required: true }, features: { run_submission: true, run_status: true,
          run_events_sse: true, run_stop: true, run_approval_response: true, session_resources: true } }
      if (path === '/api/sessions') return { session: { id: 'synthetic-session', source: 'api_server' } }
      if (path === '/v1/runs') {
        wire.submissions.push(options.body)
        await put({ phase: 'ready' })
        if (wire.retry) {
          await put(request)
          await put({ ...request, phase: 'error', status_code: 429, reason: 'upstream_rate_limit', retryable: true })
        }
        return { run_id: 'synthetic-run', status: 'started' }
      }
      if (path.endsWith('/stop')) return { run_id: 'synthetic-run', status: 'stopping' }
      if (path === '/v1/runs/synthetic-run') return { run_id: 'synthetic-run', session_id: 'synthetic-session',
        status: 'completed', output: 'SIMULATED ANSWER', runtime: wire.runtime }
      throw new Error('Unexpected simulated HTTP path')
    },
    openSse: async (_base: unknown, _path: unknown, { signal }: { signal: AbortSignal }) => ({
      consume: async (handle: (record: object) => Promise<void>) => {
        let onAbort: () => void = () => {}
        try {
          await new Promise<void>((resolve, reject) => {
            wire.finish = resolve
            onAbort = () => reject(Object.assign(new Error('SIMULATED stream aborted'), { name: 'AbortError' }))
            signal.addEventListener('abort', onAbort, { once: true })
            if (signal.aborted) onAbort()
          })
          await put({ ...request, phase: 'request' })
          const { retry_count: _retry, ...post } = request
          await put({ ...post, phase: 'response', usage: {} })
          if (wire.observerMode === 'foreign') {
            await put({ ...request, api_request_id: 'foreign-model-request', model: 'different-model' })
          }
          if (wire.observerMode !== 'missing-end') await put({ phase: 'turn_end',
            session_id: request.session_id, task_id: request.task_id, turn_id: request.turn_id,
            model: request.model, completed: true, failed: false, interrupted: false })
          if (wire.observerMode === 'partial') await appendFile(join(wire.observer, 'events.jsonl'), '{')
          await handle({ event: 'run.completed', run_id: 'synthetic-run', session_id: 'synthetic-session', seq: 1 })
        } finally { signal.removeEventListener('abort', onAbort) }
      }, cancel: async () => {},
    }),
  }
})
const request = { phase: 'request', session_id: 'synthetic-session', task_id: 'synthetic-session',
  turn_id: 'synthetic-turn', api_request_id: 'synthetic-request', api_call_count: 1,
  provider: 'synthetic', model: 'synthetic-model', api_mode: 'chat_completions', retry_count: 0 }
async function put(record: object) {
  await appendFile(join(wire.observer, 'events.jsonl'), JSON.stringify({ v: 1, nonce: wire.nonce, seq: ++wire.sequence, ...record }) + '\n')
}
beforeEach(async () => {
  wire.root = await realpath(await mkdtemp(join(tmpdir(), 'cwn-hermes-poll-bridge-SIMULATED-')))
  wire.home = join(wire.root, 'home'); await mkdir(wire.home)
  wire.calls = []; wire.sequence = 0; wire.cleanup = vi.fn(); wire.finish = undefined
  wire.runtime = { provider: 'synthetic', model: 'synthetic-model' }
  wire.observerMode = 'complete'; wire.retry = true; wire.submissions = []; wire.launches = []
  let resolveDone: (value: object) => void = () => {}
  wire.done = new Promise(resolve => { resolveDone = resolve })
  wire.stop = vi.fn(async () => { resolveDone({ exitCode: 0 }) })
})
afterEach(async () => { await rm(wire.root, { recursive: true, force: true }) })

function run(controller: AbortController) {
  const records: any[] = [], events: any[] = [], result = vi.fn()
  const promise = runNativeHermes({ argv: ['SIMULATED', 'chat'], project: wire.root, stateDirectory: wire.root,
    mode: 'accept-edits', prompt: 'SIMULATED TASK', preference: { model: '["synthetic","synthetic-model"]', effort: 'default' },
    timeoutMs: 5000, maxRunBytes: 16777216, maxLineBytes: 1048576 }, {
    signal: controller.signal, native: (value: any) => records.push(value), event: (value: any) => events.push(value),
    session: () => {}, result,
    spawn: (_argv: string[], options: any) => {
      wire.launches.push(options)
      wire.observer = options.env.CLIWORKER_HERMES_OBSERVER_DIR
      wire.nonce = options.env.CLIWORKER_HERMES_OBSERVER_NONCE
      void writeFile(join(wire.home, 'gateway_state.json'), JSON.stringify({ pid: 123, platforms: { api_server: {
        writer_pid: 123, state: 'connected', listener_base: 'http://127.0.0.1:31001', updated_at: new Date().toISOString() } } }))
      return { process: { pid: 123 }, done: wire.done, stop: wire.stop }
    },
  })
  promise.catch(() => {})
  return { promise, records, events, result }
}
describe('模拟 Hermes original bridge observes requests independently of quiet SSE', () => {
  it('publishes real pending/error phases before the first SSE event and clears on native response', async () => {
    const controller = new AbortController(), f = run(controller)
    try {
      await vi.waitFor(() => expect(f.records.filter(record => record.type === 'hermes.request-state')).toHaveLength(2), { timeout: 2000 })
      expect(f.events).toEqual([])
      expect(f.records.filter(record => record.type === 'hermes.request-state').map(record => record.phase))
        .toEqual(['requesting', 'failed'])
      expect((await readFile(join(wire.observer, 'events.jsonl'), 'utf8'))).toContain('upstream_rate_limit')
      wire.finish()
      await f.promise
      expect(f.records.filter(record => record.type === 'hermes.request-state').map(record => record.phase))
        .toEqual(['requesting', 'failed', 'requesting', 'completed'])
      expect(f.result).toHaveBeenCalledWith('SUCCESS', 'SIMULATED ANSWER', undefined, 'response')
      expect(wire.stop).toHaveBeenCalledTimes(1)
      expect(wire.cleanup).toHaveBeenCalledTimes(1)
      expect(existsSync(wire.observer)).toBe(false)
      expect(wire.launches[0].cwd).toBe(wire.root)
      expect(wire.submissions[0].input).toContain(JSON.stringify(wire.root))
      expect(wire.submissions[0].input).toContain('SIMULATED TASK')
    } finally { controller.abort(); await f.promise.catch(() => {}) }
  })
  it('cancels a quiet stream, joins the poll and server, and leaves no late events or observer files', async () => {
    const controller = new AbortController(), f = run(controller)
    try {
      await vi.waitFor(() => expect(f.records.some(record => record.type === 'hermes.request-state')).toBe(true), { timeout: 2000 })
      controller.abort()
      await expect(f.promise).rejects.toMatchObject({ name: 'AbortError' })
      const size = f.records.length
      await new Promise(resolve => setTimeout(resolve, 130))
      expect(f.records).toHaveLength(size)
      expect(f.result).not.toHaveBeenCalled()
      expect(wire.calls.filter(path => path.endsWith('/stop'))).toHaveLength(1)
      expect(wire.stop).toHaveBeenCalledTimes(1)
      expect(wire.cleanup).toHaveBeenCalledTimes(1)
      expect(existsSync(wire.observer)).toBe(false)
    } finally { controller.abort(); await f.promise.catch(() => {}) }
  })
  it.each([
    { runtime: { provider: '', model: '' }, observerMode: 'complete', passes: true },
    { runtime: { provider: 'synthetic', model: '' }, observerMode: 'complete', passes: true },
    { runtime: undefined, observerMode: 'complete', passes: true },
    { runtime: { provider: '', model: '' }, observerMode: 'missing-end', passes: false },
    { runtime: { provider: '', model: '' }, observerMode: 'foreign', passes: false },
    { runtime: { provider: '', model: '' }, observerMode: 'partial', passes: false },
    { runtime: { provider: 'other-provider', model: '' }, observerMode: 'complete', passes: false },
    { runtime: { provider: 'synthetic', model: 'synthetic-model:free' }, observerMode: 'complete', passes: false },
    { runtime: { provider: 'synthetic', model: 'vendor/synthetic-model' }, observerMode: 'complete', passes: false },
  ])('模拟 only complete exact native observation fills missing runtime: %j', async ({ runtime, observerMode, passes }) => {
    wire.runtime = runtime; wire.observerMode = observerMode; wire.retry = false
    const controller = new AbortController(), f = run(controller)
    try {
      await vi.waitFor(() => expect(wire.finish).toBeTypeOf('function'))
      wire.finish()
      if (passes) {
        await f.promise
        expect(f.result).toHaveBeenCalledWith('SUCCESS', 'SIMULATED ANSWER', undefined, 'response')
        expect(f.records.some(record => record.type === 'cliworker.hermes_observer_status')).toBe(false)
      } else {
        await expect(f.promise).rejects.toThrow(/实际执行模型/)
        expect(f.result).not.toHaveBeenCalled()
      }
      expect(wire.submissions).toHaveLength(1)
      expect(wire.stop).toHaveBeenCalledTimes(1)
      expect(wire.cleanup).toHaveBeenCalledTimes(1)
    } finally { controller.abort(); await f.promise.catch(() => {}) }
  })
})
