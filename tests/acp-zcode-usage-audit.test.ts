import { describe, expect, it } from 'vitest'
import { runNativeKimi } from '../src/host/native-kimi.mjs'
import { runNativeGrok } from '../src/host/native-grok.mjs'
import { GrokProtocol } from '../src/host/grok-adapter.ts'
import { ZCodeProtocol } from '../src/host/zcode-adapter.ts'
import { grokResponseUsage } from '../src/host/grok-response.mjs'
import { zcodeResponseUsage } from '../src/host/zcode-response.mjs'
import { foldEvents, type WorkerEvent } from '../src/shared/types.ts'

// All protocol records are synthetic; no CLI account or model is called.
const grokUsage = { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 10,
  cache_creation_input_tokens: 3, reasoning_tokens: 2, total_tokens: 38 }
const zcodeUsage = { inputTokens: 33, outputTokens: 5, cacheReadTokens: 10,
  cacheWriteTokens: 3, reasoningTokens: 2, totalTokens: 38 }
function events() {
  const rows: WorkerEvent[] = []
  return { rows, emit: (event: any) => rows.push({ ...event, seq: rows.length + 1, runId: 'synthetic-run', time: '2026-10-16T00:00:00Z' }) }
}

describe('Kimi/Grok/ZCode protocol audit (offline synthetic evidence)', () => {
  it('normalizes Grok disjoint buckets and ZCode inclusive input to the same native usage', () => {
    const expected = { inputTokens: 20, outputTokens: 5, cacheReadTokens: 10,
      cacheWriteTokens: 3, reasoningTokens: 2, totalTokens: 38 }
    expect(grokResponseUsage(grokUsage)).toEqual(expected)
    expect(zcodeResponseUsage(zcodeUsage)).toEqual(expected)
    expect(zcodeResponseUsage({ ...zcodeUsage, cacheWriteTokens: undefined })).toBeUndefined()
    expect(zcodeResponseUsage({ ...zcodeUsage, inputTokens: 2, totalTokens: 7 })).toBeUndefined()
    expect(grokResponseUsage({ ...grokUsage, total_tokens: 999 })).toBeUndefined()
    expect(grokResponseUsage({ ...grokUsage, reasoning_tokens: 6 })).toBeUndefined()
  })

  it('settles Grok usage at native response boundaries and never attaches end aggregate to the last response', () => {
    const f = events(), parser = new GrokProtocol(f.emit, () => {}, 16384)
    for (const row of [
      { type: 'thought', data: 'Synthetic public reasoning' },
      { type: 'text', data: 'first' },
      { type: 'usage', messageId: 'resp-a', usage: grokUsage, signature: 'DO_NOT_PROJECT' },
      { type: 'text', data: 'second' },
      { type: 'usage', messageId: 'resp-b', usage: { ...grokUsage, output_tokens: 6, total_tokens: 39 } },
      { type: 'end', sessionId: 'synthetic', stopReason: 'end_turn', usage: { ...grokUsage, total_tokens: 99999 } },
    ]) parser.feed(JSON.stringify(row) + '\n')
    parser.end()
    const settled = f.rows.filter((row) => row.response?.usage)
    expect(settled.map((row) => row.response?.usage?.totalTokens)).toEqual([38, 39])
    expect(new Set(settled.map((row) => row.response?.id)).size).toBe(2)
    expect(foldEvents(f.rows).filter((row) => row.kind === 'assistant').map((row) => row.text)).toEqual(['first', 'second'])
    expect(JSON.stringify(f.rows)).not.toContain('DO_NOT_PROJECT')
  })

  it('preserves ZCode public reasoning, exact message identity and model_complete usage in the legacy stream', () => {
    const f = events(), parser = new ZCodeProtocol(f.emit, () => {}, 16384)
    const send = (type: string, payload: unknown) => parser.feed(JSON.stringify({ type, sessionId: 'synthetic', payload }) + '\n')
    send('model.streaming', { kind: 'reasoning_delta', assistantMessageId: 'native-message', delta: 'Synthetic reasoning' })
    send('model.streaming', { kind: 'text_delta', assistantMessageId: 'native-message', delta: 'answer' })
    // Background/helper model completions must not own the visible main response.
    send('session.updated', { querySource: 'title', content: 'helper', toolCallCount: 0, stopReason: 'stop', usage: zcodeUsage })
    send('session.updated', { querySource: 'main_turn', content: 'answer', toolCallCount: 0, stopReason: 'stop', usage: zcodeUsage })
    send('turn.completed', { resultType: 'success', usage: { ...zcodeUsage, totalTokens: 99999 } })
    parser.feed(JSON.stringify({ type: 'result', sessionId: 'synthetic', response: 'answer' }) + '\n')
    parser.end()
    const settled = f.rows.filter((row) => row.response?.usage)
    expect(settled).toHaveLength(1)
    expect(settled[0]?.response).toMatchObject({ id: 'zcode:native-message', complete: true, usage: {
      inputTokens: 20, outputTokens: 5, cacheReadTokens: 10, cacheWriteTokens: 3, totalTokens: 38,
    } })
    expect(foldEvents(f.rows).filter((row) => row.kind === 'reasoning').map((row) => row.detail)).toEqual(['Synthetic reasoning'])
  })

  it.each(['kimi', 'grok'] as const)('%s separates public thought spans and retains ACP content-only tool receipts', async (cli) => {
    const f = events(), native: any[] = []
    let receive!: (message: any) => void
    const state = { sessionId: 'synthetic', modes: { currentModeId: 'yolo', availableModes: [{ id: 'default' }, { id: 'yolo' }] },
      configOptions: [{ id: 'model', currentValue: 'model', options: [{ value: 'model' }] },
        { id: 'mode', currentValue: 'yolo', options: [{ value: 'default' }, { value: 'yolo' }] }] }
    const peer = {
      async request(method: string) {
        if (method === 'initialize') return { protocolVersion: 1 }
        if (method === 'session/new') return state
        if (method === 'session/prompt') {
          const push = (update: any) => receive({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'synthetic', update } })
          push({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'first thought' } })
          push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'first answer' } })
          push({ sessionUpdate: 'tool_call', toolCallId: 'native-call', title: 'Synthetic read', status: 'in_progress', rawInput: { path: 'synthetic' } })
          push({ sessionUpdate: 'tool_call_update', toolCallId: 'native-call', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'synthetic result' } }] })
          push({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'second thought' } })
          push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'second answer' } })
          push({ sessionUpdate: 'usage_update', used: 71, size: 200 })
          return { stopReason: 'end_turn' }
        }
        return {}
      },
      send: async () => {}, end: () => {}, close: async () => {},
    }
    const io = { signal: new AbortController().signal, event: f.emit, native: (record: any) => native.push(record),
      session: () => {}, result: () => {}, openStdio: async (_: any, options: any) => { receive = options.onMessage; return peer } }
    await (cli === 'kimi' ? runNativeKimi : runNativeGrok)({ argv: ['synthetic'], preference: { model: 'model', effort: 'default' }, mode: 'accept-edits', prompt: 'synthetic' }, io)
    expect(foldEvents(f.rows).filter((row) => row.kind === 'reasoning').map((row) => [row.detail, row.state])).toEqual([
      ['first thought', 'COMPLETED'], ['second thought', 'COMPLETED'],
    ])
    const foldedTool = foldEvents(f.rows).find((row) => row.kind === 'tool')
    // ACP completion updates legitimately omit title/rawInput. The native
    // sidebar must retain the observed declaration together with the result.
    expect(foldedTool).toMatchObject({ text: 'Synthetic read', state: 'COMPLETED', toolCall: {
      callId: 'native-call', name: 'Synthetic read', input: { path: 'synthetic' },
      output: [{ type: 'content', content: { type: 'text', text: 'synthetic result' } }],
    } })
    expect(f.rows.some((row) => row.response?.usage)).toBe(false)
    expect(native.at(-1).params.update).toEqual({ sessionUpdate: 'usage_update', used: 71, size: 200 })
  })
})
