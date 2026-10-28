import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runNativeOpenCode } from '../src/host/native-opencode.mjs'
import { runNativeMimo } from '../src/host/native-mimo.mjs'
import { sessionHttpSessionUsage } from '../src/host/http-rpc-response.mjs'

// Explicitly simulated HTTP/SSE. No CLI, account or model is invoked.
const wire = vi.hoisted(() => ({ scenario: 'decreased', reads: 0, parentID: '', ready: undefined as any,
  release: undefined as any, calls: [] as string[], controller: undefined as AbortController | undefined }))
const initial = { input: 10, output: 7, reasoning: 4, cache: { read: 3, write: 2 } }
const final = { input: 2, output: 1, reasoning: 1, cache: { read: 0, write: 0 } }
vi.mock('../src/host/native-http.mjs', async load => {
  const actual = await load<Record<string, any>>()
  return { ...actual,
    startSessionServer: async () => ({ base: 'http://SIMULATED.invalid', headers: {}, managed: { done: new Promise(() => {}) } }),
    closeServer: async () => {},
    httpJson: async (_base: unknown, raw: string, options: any) => {
      const path = raw.split('?')[0]
      wire.calls.push(path)
      if (path === '/doc') return { paths: { '/event': {}, '/session/{sessionID}/prompt_async': {}, '/session/{sessionID}/abort': {} } }
      if (path === '/provider') return { all: [{ id: 'simulated', models: { chat: { id: 'chat' } } }] }
      if (path === '/permission/skip-all' || path === '/permission/auto-approve-delete') return false
      if (path === '/session') return { id: 'ses_USAGE', tokens: { input: 9999 } }
      if (path === '/session/ses_USAGE') {
        wire.reads++
        if (wire.reads > 1 && wire.scenario === 'unavailable') throw new Error('SIMULATED missing optional query')
        if (wire.reads > 1 && wire.scenario === 'cancel') { wire.controller!.abort(); throw new Error('SIMULATED cancellation') }
        const tokens: any = structuredClone(wire.reads === 1 ? initial : final)
        if (wire.reads > 1 && wire.scenario === 'missing-cache') delete tokens.cache.write
        if (wire.reads > 1 && wire.scenario === 'zero') Object.assign(tokens, { input: 0, output: 0, reasoning: 0 })
        return { id: wire.reads > 1 && wire.scenario === 'wrong-session' ? 'ses_FOREIGN' : 'ses_USAGE',
          directory: wire.reads > 1 && wire.scenario === 'wrong-project' ? '/nonexistent/SIMULATED' : process.cwd(),
          tokens, cost: 999, private: 'MUST_NOT_COPY' }
      }
      if (path.endsWith('/prompt_async')) { wire.parentID = options.body.messageID; wire.release(); return }
      if (path.endsWith('/message')) return [{ info: assistant(), parts: [part()] }]
      if (path.endsWith('/abort')) return true
      throw new Error('Unexpected simulated request: ' + path)
    },
    openSse: async () => ({
      consume: async (handle: (event: any) => Promise<unknown>) => {
        await wire.ready
        await handle({ type: 'message.updated', properties: { info: assistant() } })
        await handle({ type: 'message.part.updated', properties: { part: part() } })
        await handle({ type: 'session.idle', properties: { sessionID: 'ses_USAGE' } })
      }, cancel: async () => {},
    }),
  }
})
function assistant() { return { id: 'message_USAGE', role: 'assistant', sessionID: 'ses_USAGE', parentID: wire.parentID,
  providerID: 'simulated', modelID: 'chat', time: { created: 1, completed: 2 }, finish: 'stop', tokens: final } }
function part() { return { id: 'part_USAGE', type: 'text', messageID: 'message_USAGE', sessionID: 'ses_USAGE',
  text: 'SIMULATED ANSWER', time: { end: 2 } } }
beforeEach(() => {
  wire.scenario = 'decreased'; wire.reads = 0; wire.calls = []; wire.controller = undefined
  wire.ready = new Promise<void>(resolve => { wire.release = resolve })
})
async function run(cli = 'opencode', resume = false) {
  const records: any[] = [], events: any[] = [], result = vi.fn()
  await (cli === 'opencode' ? runNativeOpenCode : runNativeMimo)({ cli, argv: ['SIMULATED'], project: process.cwd(),
    ...(resume ? { conversationId: 'ses_USAGE' } : {}), preference: { model: 'simulated/chat', effort: 'default' },
    mode: 'plan', prompt: 'SIMULATED TASK', maxLineBytes: 1048576, maxRunBytes: 16777216, timeoutMs: 5000 }, {
    signal: wire.controller?.signal, native: (record: any) => records.push(record), session: () => {},
    event: (event: any) => events.push(event), result,
  })
  return { records: records.filter(record => record.type === 'cliworker.session_usage'), events, result }
}
describe('OpenCode official native session receipt snapshots', () => {
  it.each([false, true])('replaces a lower native snapshot without adding run or response totals, resume=%s', async resume => {
    const { records, events, result } = await run('opencode', resume)
    expect(records.map(record => record.usage.total)).toEqual([26, 4])
    expect(records[0]).toEqual({ type: 'cliworker.session_usage', cli: 'opencode', scope: 'session',
      source: 'opencode.session.get', sessionId: 'ses_USAGE', usage: {
        input: 10, output: 7, reasoning: 4, cacheRead: 3, cacheWrite: 2, total: 26 } })
    expect(events.filter(event => event.response?.complete).map(event => event.response.usage.totalTokens)).toEqual([4])
    expect(result).toHaveBeenCalledWith('SUCCESS', 'SIMULATED ANSWER', undefined, 'run')
    expect(JSON.stringify(records)).not.toMatch(/9999|cost|MUST_NOT_COPY/)
  })
  it.each(['wrong-session', 'wrong-project', 'missing-cache', 'unavailable'])('rejects an unavailable or unowned final snapshot: %s', async scenario => {
    wire.scenario = scenario
    const { records, result } = await run()
    expect(records.map(record => record.usage.total)).toEqual([26])
    expect(result).toHaveBeenCalledWith('SUCCESS', 'SIMULATED ANSWER', undefined, 'run')
  })
  it('retains explicitly reported zero instead of preserving a stale maximum', async () => {
    wire.scenario = 'zero'
    expect((await run()).records.map(record => record.usage.total)).toEqual([26, 0])
  })
  it('does not claim a MiMo session counter or query a missing API', async () => {
    expect((await run('mimo')).records).toEqual([])
    expect(wire.reads).toBe(0)
  })
  it('does not swallow a user stop during optional metadata collection', async () => {
    wire.scenario = 'cancel'; wire.controller = new AbortController()
    await expect(run()).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('requires every native token bucket and safe arithmetic, preserving raw output convention', () => {
    expect(sessionHttpSessionUsage(initial)).toEqual({ input: 10, output: 7, reasoning: 4, cacheRead: 3, cacheWrite: 2, total: 26 })
    expect(sessionHttpSessionUsage({ ...initial, reasoning: undefined })).toBeUndefined()
    expect(sessionHttpSessionUsage({ ...initial, input: Number.MAX_SAFE_INTEGER })).toBeUndefined()
    expect(sessionHttpSessionUsage({ ...initial, total: 25 })).toBeUndefined()
  })
})
