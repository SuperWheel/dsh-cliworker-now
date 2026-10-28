import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runNativeMimo } from '../src/host/native-mimo.mjs'
import { runNativeOpenCode } from '../src/host/native-opencode.mjs'
import { BridgeProtocol } from '../src/host/bridge-protocol.ts'
import { foldEvents, type WorkerEvent } from '../src/shared/types.ts'

// The HTTP/SSE boundary is explicitly simulated. No server, account or model runs.
const wire = vi.hoisted(() => ({ scenario: 'two-responses', parentID: '', prompt: '', previousID: '', ready: undefined as any,
  release: undefined as any, events: [] as any[], final: [] as any[] }))
vi.mock('../src/host/native-http.mjs', async (load) => {
  const actual = await load<Record<string, any>>()
  return { ...actual,
    startSessionServer: async () => ({ base: 'http://SIMULATED.invalid', headers: {}, managed: { done: new Promise(() => {}) } }),
    closeServer: async () => {},
    httpJson: async (_base: unknown, raw: string, options: any) => {
      const path = raw.split('?')[0]
      if (path === '/doc') return { paths: { '/event': {}, '/session/{sessionID}/prompt_async': {}, '/session/{sessionID}/abort': {} } }
      if (path === '/provider') return { all: [{ id: 'simulated', models: { model: { id: 'model', limit: { context: 1000 } } } }] }
      if (path === '/permission/skip-all' || path === '/permission/auto-approve-delete') return false
      if (path === '/session') return { id: 'ses_SIMULATED', directory: process.cwd() }
      if (path === '/session/ses_SIMULATED') return { id: 'ses_SIMULATED', directory: process.cwd() }
      if (path.endsWith('/prompt_async')) {
        wire.parentID = options.body.messageID
        wire.prompt = options.body.parts[0].text
        buildWire()
        wire.release()
        return
      }
      if (path.endsWith('/message')) return wire.final
      if (path.endsWith('/abort')) return true
      throw new Error(`Unexpected simulated request: ${path}`)
    },
    openSse: async () => ({
      consume: async (handle: (event: any) => Promise<boolean | undefined>) => {
        await wire.ready
        for (const event of wire.events) if (await handle(event)) return
      },
      cancel: async () => {},
    }),
  }
})

function buildWire() {
  const sid = 'ses_SIMULATED'
  const info = (id: string, complete = false) => ({ id, sessionID: sid, parentID: wire.parentID,
    role: 'assistant', providerID: 'simulated', modelID: 'model', time: { created: 1, ...(complete ? { completed: 2 } : {}) },
    ...(complete ? { finish: id === 'message1' ? 'tool-calls' : 'stop', tokens: {
      input: id === 'message1' ? 10 : 20, output: 7, reasoning: 4, cache: { read: 3, write: 2 },
    } } : {}) })
  const part = (id: string, messageID: string, data: any) => ({ id, messageID, sessionID: sid, ...data })
  const updated = (data: any) => ({ type: 'message.part.updated', properties: { part: data } })
  const message = (id: string, complete = false) => ({ type: 'message.updated', properties: { info: info(id, complete) } })
  const thought = part('thought', 'message1', { type: 'reasoning', text: '公开模拟思考', time: { end: 2 }, metadata: { signature: 'OPAQUE_SIGNATURE' } })
  const firstText = part('text1', 'message1', { type: 'text', text: '工具前', time: { end: 2 } })
  const tool = part('tool', 'message1', { type: 'tool', tool: 'read', callID: 'call_SIMULATED', state: { status: 'completed', input: { path: 'fixture.txt' }, output: '模拟文件' } })
  const lastText = part('text2', 'message2', { type: 'text', text: '工具后', time: { end: 2 } })
  wire.events = [message('message1'), updated(thought), updated(firstText), updated({ ...tool, state: { ...tool.state, status: 'running' } }),
    message('message1', true), updated(tool), message('message2'), updated(lastText), message('message2', true),
    { type: 'session.idle', properties: { sessionID: sid } }]
  wire.final = [{ info: info('message1', true), parts: [thought, firstText, tool] }, { info: info('message2', true), parts: [lastText] }]
  if (wire.scenario === 'resume-order' || wire.scenario === 'resume-no-assistant') {
    // Simulate MiMo 0.1.15 existing-assistant classification: an earlier user
    // ID is treated as already answered by the last completed assistant.
    wire.previousID = `msg_g${(BigInt(Date.now() - 1000) * 4096n + 1n).toString(16).padStart(16, '0')}SIMULATED`
    const history = { info: { ...info(wire.previousID, true), parentID: 'msg_SIMULATED_old_user', finish: 'stop' }, parts: [] }
    if (wire.parentID < wire.previousID || wire.scenario === 'resume-no-assistant') {
      wire.events = [{ type: 'session.status', properties: { sessionID: sid, status: { type: 'busy' } } },
        { type: 'session.idle', properties: { sessionID: sid } }]
      wire.final = [history]
    } else wire.final.unshift(history)
  }
  if (wire.scenario === 'final-only-public-blocks') {
    wire.events = [message('message2'), updated(lastText), message('message2', true), { type: 'session.idle', properties: { sessionID: sid } }]
    wire.final = [{ info: info('message2', true), parts: [lastText,
      { ...thought, id: 'thought2', messageID: 'message2' }, { ...tool, id: 'tool2', messageID: 'message2' }] }]
  }
  if (wire.scenario === 'unknown-usage') {
    for (const event of wire.events) if (event.properties?.info?.tokens) delete event.properties.info.tokens.cache.write
    for (const row of wire.final) delete row.info.tokens.cache.write
  }
}

beforeEach(() => {
  wire.scenario = 'two-responses'
  wire.ready = new Promise<void>((resolve) => { wire.release = resolve })
})
async function run(cli: 'mimo' | 'opencode', prompt = 'SIMULATED TASK', resume = false) {
  const events: WorkerEvent[] = [], records: any[] = [], frames: any[] = []
  const parser = new BridgeProtocol((event) => events.push({ ...event, seq: events.length, runId: 'SIMULATED-run', time: new Date(0).toISOString() }), () => {}, 1048576)
  const emit = (frame: any) => { frames.push(frame); parser.feed(JSON.stringify(frame) + '\n') }
  const io = { event: (event: any) => emit({ type: 'event', event }), native: (record: any) => { records.push(record); emit({ type: 'native', record }) },
    session: (id: string, model: string) => emit({ type: 'session', id, model }),
    result: (status: string, response: string, error: unknown, resultScope: string) => emit({ type: 'result', status, response, error, resultScope }) }
  await (cli === 'mimo' ? runNativeMimo : runNativeOpenCode)({ cli, argv: ['SIMULATED'], project: process.cwd(),
    preference: { model: 'simulated/model', effort: 'default' }, mode: 'plan', prompt,
    ...(resume ? { conversationId: 'ses_SIMULATED' } : {}),
    maxLineBytes: 1048576, maxRunBytes: 16777216, timeoutMs: 5000 }, io)
  parser.end()
  return { events, records, rows: foldEvents(events), frames }
}

it.each(['SIMULATED follow-up', '【当前目标】\nSIMULATED goal\n【目标结束】\n\nSIMULATED follow-up'])(
  'MiMo resumes after its previous native reply with the original prompt: %s', async prompt => {
    wire.scenario = 'resume-order'
    const result = await run('mimo', prompt, true)
    expect(wire.parentID).toMatch(/^msg_g[0-9a-f]{16}[0-9A-Za-z]{9}$/)
    expect(wire.parentID > wire.previousID).toBe(true)
    expect(wire.prompt).toBe(prompt)
    expect(result.frames.at(-1)).toMatchObject({ status: 'SUCCESS', response: '工具前工具后' })
    expect(result.events.filter(event => event.response?.complete)).toHaveLength(2)
  },
)

it.each(['SIMULATED follow-up', '【当前目标】\nSIMULATED goal\n【目标结束】\n\nSIMULATED follow-up'])(
  'MiMo still rejects a resumed round with no matching assistant: %s', async prompt => {
    wire.scenario = 'resume-no-assistant'
    await expect(run('mimo', prompt, true)).rejects.toThrow('原生轮次缺少助手终态')
    expect(wire.prompt).toBe(prompt)
  },
)

describe.each(['mimo', 'opencode'] as const)('%s HTTP producer with simulated wire', (cli) => {
  it('projects two precise model responses and their own usage/cache/reasoning/tool blocks', async () => {
    const result = await run(cli)
    expect(result.frames.at(-1)).toMatchObject({ status: 'SUCCESS', response: '工具前工具后', resultScope: 'run' })
    const completions = result.events.filter((event) => event.response?.complete)
    expect(completions.map((event) => event.response?.id)).toEqual([`${cli}:message1`, `${cli}:message2`])
    expect(completions.map((event) => event.response?.usage?.totalTokens)).toEqual([26, 36])
    expect(completions[0]?.response?.usage).toMatchObject({ inputTokens: 10, outputTokens: 11, reasoningTokens: 4, cacheReadTokens: 3, cacheWriteTokens: 2 })
    expect(result.rows.filter((row) => row.kind === 'assistant').map((row) => row.text)).toEqual(['工具前', '工具后'])
    expect(result.rows.find((row) => row.kind === 'tool')).toMatchObject({ response: { id: `${cli}:message1` }, toolCall: { callId: 'call_SIMULATED', output: '模拟文件' } })
    expect(JSON.stringify(result.events)).not.toContain('OPAQUE_SIGNATURE')
    expect(JSON.stringify(result.records)).not.toContain('OPAQUE_SIGNATURE')
    expect(result.records.find((record) => record.type === 'cliworker.model_context')).toMatchObject({ contextCapacity: 1000, source: `${cli}.provider.limit.context` })
  })
  it('does not turn missing cache counters into zero or attach a run total to the last response', async () => {
    wire.scenario = 'unknown-usage'
    const result = await run(cli)
    expect(result.events.filter((event) => event.response?.complete)).toHaveLength(2)
    expect(result.events.some((event) => event.response?.usage)).toBe(false)
  })
  it('reconciles public reasoning and executed tools delivered only by the final native snapshot', async () => {
    wire.scenario = 'final-only-public-blocks'
    const result = await run(cli)
    expect(result.rows.find((row) => row.kind === 'reasoning')).toMatchObject({ detail: '公开模拟思考', response: { id: `${cli}:message2` } })
    expect(result.rows.find((row) => row.kind === 'tool')).toMatchObject({ state: 'COMPLETED', response: { id: `${cli}:message2` } })
    expect(result.events.filter((event) => event.response?.complete)).toHaveLength(1)
  })
})
