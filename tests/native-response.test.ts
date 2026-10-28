import { ClaudeResponseTracker } from '../src/host/primary-response.mjs'
import { GrokResponseTracker } from '../src/host/grok-response.mjs'
import { ZcodeResponseTracker } from '../src/host/zcode-response.mjs'
import { NativeBlockResponses } from '../src/host/http-rpc-response.mjs'
import { foldNativeFrames } from './fixtures/bridge-timeline.ts'
import { expect, it } from 'vitest'
import { AgyProtocol } from '../src/host/protocol.ts'
import { BridgeProtocol } from '../src/host/bridge-protocol.ts'
import { agyResponseUsage, parseNativeResponse } from '../src/host/native-response.mjs'
import { foldEvents, type WorkerEvent } from '../src/shared/types.ts'

it('preserves AGY response identity and disjoint per-call usage through both framing paths', () => {
  const events: Partial<WorkerEvent>[] = []
  const protocol = new AgyProtocol(
    (event) => events.push(event),
    () => {},
    8192,
  )
  protocol.feed(
    JSON.stringify({
      event: 'step_update',
      step_update: {
        conversation_id: 'synthetic-agy',
        step_type: 'agent_response',
        step_index: 24,
        state: 'DONE',
        text_delta: 'synthetic answer',
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_tokens: 300,
          total_tokens: 120,
          thinking_tokens: 0,
        },
      },
    }) + '\n',
  )
  expect(events[0]?.response).toEqual({
    id: 'agy:24',
    blockId: 'text',
    index: 0,
    complete: true,
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 300,
      cacheWriteTokens: 0,
      totalTokens: 420,
    },
  })
  const bridged: Partial<WorkerEvent>[] = []
  new BridgeProtocol(
    (event) => bridged.push(event),
    () => {},
    8192,
  ).feed(JSON.stringify({ type: 'event', event: events[0] }) + '\n')
  expect(bridged[0]?.response).toEqual(events[0]?.response)
})

it('does not invent missing/invalid usage or infer a response from an aggregate result', () => {
  expect(agyResponseUsage({ input_tokens: 1, output_tokens: 2 })).toBeUndefined()
  expect(
    agyResponseUsage({ input_tokens: 1, output_tokens: 2, cache_read_tokens: 8, total_tokens: 99 }),
  ).toBeUndefined()
  expect(() =>
    parseNativeResponse({
      id: 'response',
      blockId: 'text',
      index: 0,
      usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 8, cacheWriteTokens: 0, totalTokens: 3 },
    }),
  ).toThrow('Contradictory')
  expect(() => parseNativeResponse({ id: 'response', blockId: 'text', index: -1 })).toThrow()
})

it('folds explicit response blocks independently of legacy display step and retains an empty usage boundary', () => {
  const events: WorkerEvent[] = [
    { seq: 1, kind: 'assistant', text: 'first', response: { id: 'response', blockId: 'a', index: 0 } },
    { seq: 2, kind: 'assistant', text: ' second', response: { id: 'response', blockId: 'b', index: 1 } },
    { seq: 3, kind: 'assistant', text: ' chunk', response: { id: 'response', blockId: 'a', index: 0 } },
    {
      seq: 4,
      kind: 'assistant',
      text: '',
      response: {
        id: 'response',
        blockId: 'b',
        index: 1,
        complete: true,
        usage: { inputTokens: 1, outputTokens: 2 },
      },
    },
  ].map((event) => ({ ...event, runId: 'synthetic', time: '2026-10-16T00:00:00Z' }) as WorkerEvent)
  const rows = foldEvents([...events, { seq: 5, runId: 'synthetic', time: events[0]!.time,
    kind: 'result', text: 'first chunk second aggregate-only suffix', resultScope: 'run' }])
  expect(rows.map((row) => row.text)).toEqual(['first chunk', ' second'])
  expect(rows[1]?.response).toMatchObject({ complete: true, usage: { inputTokens: 1, outputTokens: 2 } })
  expect(() =>
    foldEvents([...events, { ...events[0]!, seq: 5, response: { id: 'response', blockId: 'a', index: 3 } }]),
  ).toThrow('identity changed')
})

it.each(['claude', 'grok', 'zcode', 'rpc'])('%s completion receipts never replay the last reasoning increment', cli => {
  // SIMULATED protocol response identity; no CLI or model.
  const frames: unknown[] = [], emit = (event: unknown) => frames.push({ type: 'event', event })
  const event = { kind: 'reasoning', step: 1, text: '公开思考', delta: '模拟增量', state: 'RUNNING' }
  if (cli === 'claude') {
    const tracker = new ClaudeResponseTracker(emit)
    tracker.start('message'); tracker.emit(event, 'message', 0); tracker.finish()
  } else if (cli === 'grok') {
    const tracker = new GrokResponseTracker(emit)
    tracker.start('message'); tracker.emit(event, 'reasoning'); tracker.finish()
  } else if (cli === 'zcode') {
    const tracker = new ZcodeResponseTracker(emit)
    tracker.emit(event, 'message', 'reasoning', 0); tracker.finish()
  } else {
    const tracker = new NativeBlockResponses('pi', emit)
    tracker.event('message', 'reasoning', event, 0); tracker.finish('message')
  }
  expect(foldNativeFrames(frames).filter(row => row.kind === 'reasoning').map(row => row.detail)).toEqual(['模拟增量'])
})
