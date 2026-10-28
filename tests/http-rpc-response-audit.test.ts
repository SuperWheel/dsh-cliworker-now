import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { NativeBlockResponses, piOmpResponseUsage, piOmpReportedUsage, sessionHttpResponseUsage } from '../src/host/http-rpc-response.mjs'
import { parseNativeResponse } from '../src/host/native-response.mjs'
import { OpenCodeProtocol } from '../src/host/opencode-adapter.ts'
import { BridgeProtocol } from '../src/host/bridge-protocol.ts'
import { foldEvents, type WorkerEvent } from '../src/shared/types.ts'

const execute = promisify(execFile)
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

// Explicitly simulated RPC process: no account discovery, login or model requests.
const rpcFixture = String.raw`
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
if (process.argv.includes('--help')) { process.stdout.write('--approval-mode=<value> (always-ask|write|yolo)'); process.exit(0) }
const root = process.env.PI_CODING_AGENT_DIR, path = join(root,'sessions','simulated.jsonl');
mkdirSync(join(root,'sessions'),{recursive:true});writeFileSync(path,'SIMULATED SESSION');
const cli=process.env.CWN_SIMULATED_CLI, overhead=process.env.CWN_OVERHEAD==='1';
const send = x => process.stdout.write(JSON.stringify(x)+'\n');
const model={provider:'synthetic',id:'model',contextWindow:1000};
const state=()=>({sessionId:'simulated-session',sessionFile:path,model,thinkingLevel:'low',isStreaming:false,pendingMessageCount:0});
const usage={input:10,output:7,cacheRead:3,cacheWrite:2,totalTokens:overhead?25:22,...(overhead?{orchestration:{input:2,output:1,opaque:'MUST_NOT_COPY_USAGE_FIELD'}}:{}),...(cli==='pi'?{reasoning:4}:{reasoningTokens:4}),opaque:'MUST_NOT_COPY_USAGE_FIELD'};
const end=(content,stopReason='stop')=>send({type:'message_end',message:{role:'assistant',provider:model.provider,model:model.id,content,usage,stopReason}});
const lines=createInterface({input:process.stdin});
lines.on('line',line=>{const q=JSON.parse(line);
 if(q.type==='get_state')return send({type:'response',id:q.id,command:q.type,success:true,data:state()});
 if(q.id?.startsWith('cliworker-live-stats-')&&process.env.CWN_LIVE_STATS==='timeout')return;
 if(q.id?.startsWith('cliworker-live-stats-')&&process.env.CWN_LIVE_STATS==='reject')return send({type:'response',id:q.id,command:q.type,success:false});
 if(q.type==='get_session_stats')return send({type:'response',id:q.id,command:q.type,success:true,data:{tokens:{input:20,output:14,cacheRead:6,cacheWrite:4,total:overhead?50:44},contextUsage:{tokens:17,contextWindow:1000,percent:1.7},sessionFile:'PRIVATE_PATH'}});
 if(q.type!=='prompt')throw Error('unexpected simulated request');
 send({type:'response',id:q.id,command:q.type,success:true});
 send({type:'message_start',message:{role:'assistant'}});
 send({type:'message_update',assistantMessageEvent:{type:'thinking_delta',contentIndex:0,delta:'公开模拟思考',partial:{content:[{type:'thinking',thinkingSignature:'OPAQUE_SIGNATURE'}]}}});
 send({type:'message_update',assistantMessageEvent:{type:'text_delta',contentIndex:1,delta:'工具前'}});
 end([{type:'thinking',thinking:'公开模拟思考',thinkingSignature:'OPAQUE_SIGNATURE'},{type:'text',text:'工具前'},{type:'toolCall',id:'simulated-tool',name:'read',arguments:{path:'fixture.txt'}}],'toolUse');
 send({type:'tool_execution_start',toolCallId:'simulated-tool',toolName:'read',args:{path:'fixture.txt'}});
 send({type:'tool_execution_end',toolCallId:'simulated-tool',toolName:'read',isError:false,result:{content:[{type:'text',text:'模拟文件'}]}});
 setTimeout(()=>{
 send({type:'message_start',message:{role:'assistant'}});
 send({type:'message_update',assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'工具后'}});
 end([{type:'text',text:'工具后'}]);
 send({type:'agent_end'});if(cli==='pi')send({type:'agent_settled'});
 },30);
});
lines.on('close',()=>process.exit(0));
`

async function rpc(cli: 'pi' | 'omp', overhead = false, liveStats = 'normal') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cwn-SIMULATED-rpc-response-')))
  roots.push(root)
  const stateDirectory = join(root, 'state'), nativeRoot = join(stateDirectory, 'agent')
  const requests = join(stateDirectory, 'requests', 'run')
  await mkdir(nativeRoot, { recursive: true, mode: 0o700 })
  await mkdir(requests, { recursive: true, mode: 0o700 })
  await writeFile(join(nativeRoot, 'native-env.json'), JSON.stringify({ CWN_SIMULATED_CLI: cli, CWN_OVERHEAD: overhead ? '1' : '0', CWN_LIVE_STATS: liveStats }), { mode: 0o600 })
  await writeFile(join(nativeRoot, 'native-auth.json'), '{}', { mode: 0o600 })
  const executable = join(root, 'simulated-cli.mjs'), request = join(requests, 'request.json')
  await writeFile(executable, rpcFixture, { mode: 0o600 })
  await writeFile(request, JSON.stringify({ cli, executable, project: root, stateDirectory,
    preference: { model: 'synthetic/model', effort: 'low' }, mode: 'plan', prompt: 'SIMULATED TASK',
    confirmedCatalog: [{ id: 'synthetic/model', efforts: ['low'] }] }), { mode: 0o600 })
  const output = await execute(process.execPath, [resolve('src/host/pi-omp-bridge.mjs'), request], { timeout: 10000 })
  const frames = output.stdout.trim().split('\n').map((line) => JSON.parse(line))
  const events: WorkerEvent[] = []
  const parser = new BridgeProtocol((event) => events.push({ ...event, runId: 'simulated-run', seq: events.length,
    time: new Date(0).toISOString() }), () => {}, 1048576)
  parser.feed(output.stdout); parser.end()
  return { frames, events, rows: foldEvents(events), output: output.stdout }
}

describe('installed HTTP/RPC usage contracts', () => {
  it('normalizes disjoint HTTP reasoning exactly once and rejects malformed receipts', () => {
    const source = { input: 10, output: 7, reasoning: 4, cache: { read: 3, write: 2 }, total: 26 }
    expect(sessionHttpResponseUsage(source)).toEqual({ inputTokens: 10, outputTokens: 11,
      reasoningTokens: 4, cacheReadTokens: 3, cacheWriteTokens: 2, totalTokens: 26 })
    expect(sessionHttpResponseUsage({ ...source, total: 22 })).toBeUndefined()
    expect(sessionHttpResponseUsage({ ...source, reasoning: undefined })).toBeUndefined()
    expect(sessionHttpResponseUsage({ ...source, input: -1 })).toBeUndefined()
  })
  it.each(['pi', 'omp'] as const)('%s does not count reasoning twice or fabricate absent reasoning', (cli) => {
    const source = { input: 10, output: 7, cacheRead: 3, cacheWrite: 2, totalTokens: 22,
      ...(cli === 'pi' ? { reasoning: 4 } : { reasoningTokens: 4 }) }
    expect(parseNativeResponse({ id: 'response', blockId: 'block', index: 0, complete: true,
      usage: piOmpResponseUsage(source, cli) }).usage).toEqual({ inputTokens: 10, outputTokens: 7,
        cacheReadTokens: 3, cacheWriteTokens: 2, reasoningTokens: 4, totalTokens: 22 })
    expect(piOmpResponseUsage({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 }, cli)).not.toHaveProperty('reasoningTokens')
  })
  it('keeps orchestration totals outside the native four-bucket response contract', () => {
    expect(piOmpResponseUsage({ input: 10, output: 7, cacheRead: 3, cacheWrite: 2, totalTokens: 25 }, 'omp'))
      .toBeUndefined()
  })
  it('preserves only actual OMP orchestration buckets without manufacturing missing zeros or difference buckets', () => {
    const source = { input: 10, output: 7, cacheRead: 3, cacheWrite: 2, totalTokens: 25 }
    expect(piOmpReportedUsage(source, 'omp')).not.toHaveProperty('orchestration')
    expect(piOmpReportedUsage({ ...source, orchestration: { input: 2, output: 1, private: 'opaque' } }, 'omp'))
      .toMatchObject({ total: 25, orchestration: { input: 2, output: 1 } })
    expect(piOmpReportedUsage({ ...source, orchestration: { input: -1 } }, 'omp')).toBeUndefined()
    expect(piOmpReportedUsage({ ...source, orchestration: 'opaque' }, 'omp')).toBeUndefined()
    // Upstream can still report contradictory totals; keep the original receipt
    // visible but never turn it into a complete native four-bucket response.
    const contradictory = { ...source, totalTokens: 22, orchestration: { input: 2 } }
    expect(piOmpReportedUsage(contradictory, 'omp')).toMatchObject({ total: 22, orchestration: { input: 2 } })
    expect(piOmpResponseUsage(contradictory, 'omp')).toBeUndefined()
  })
  it('settles only once and rejects late public response content while accepting declared tool results', () => {
    const events: any[] = [], responses = new NativeBlockResponses('simulated', (event) => events.push(event))
    responses.event('response', 'tool', { kind: 'tool', text: 'read', state: 'RUNNING' })
    responses.finish('response'); responses.finish('response')
    responses.event('response', 'tool', { kind: 'tool', text: 'read', state: 'COMPLETED' })
    expect(events.filter((event) => event.response.complete)).toHaveLength(1)
    expect(() => responses.event('response', 'new-text', { kind: 'assistant', text: 'late' })).toThrow(/after completion/)
  })
})

describe('Pi/OMP actual bridge with explicitly simulated RPC', () => {
  it.each(['pi', 'omp'] as const)('%s preserves two model responses, public blocks and tool ownership', async (cli) => {
    const result = await rpc(cli)
    expect(result.frames.at(-1)).toMatchObject({ status: 'SUCCESS', response: '工具前工具后', resultScope: 'run' })
    const complete = result.events.filter((event) => event.response?.complete)
    expect(complete.map((event) => event.response?.id)).toEqual([`${cli}:simulated-session:1`, `${cli}:simulated-session:2`])
    expect(complete.map((event) => event.response?.usage?.totalTokens)).toEqual([22, 22])
    expect(result.rows.map((row) => row.kind)).toEqual(['status', 'status', 'reasoning', 'assistant', 'tool', 'assistant'])
    expect(result.rows.find((row) => row.kind === 'tool')).toMatchObject({ state: 'COMPLETED',
      response: { id: `${cli}:simulated-session:1`, index: 2 }, toolCall: { callId: 'simulated-tool', output: { content: [{ text: '模拟文件' }] } } })
    expect(result.output).not.toMatch(/OPAQUE_SIGNATURE|MUST_NOT_COPY_USAGE_FIELD|PRIVATE_PATH/)
    expect(result.frames.filter((frame) => frame.record?.type === 'cliworker.rpc_response')).toHaveLength(2)
    expect(result.frames.find((frame) => frame.record?.type === 'cliworker.rpc_usage').record.usage.total).toBe(44)
    expect(result.frames.find((frame) => frame.record?.type === 'cliworker.rpc_usage').record.basis)
      .toBe(cli === 'omp' ? 'native-active-context' : undefined)
  })
  it.each(['pi', 'omp'] as const)('%s publishes verified capacity and native live stats before model content', async (cli) => {
    const result = await rpc(cli)
    const capacity = result.frames.findIndex(frame => frame.record?.type === 'cliworker.model_context')
    const stats = result.frames.findIndex(frame => frame.record?.type === 'cliworker.rpc_usage')
    const content = result.frames.findIndex(frame => frame.event?.kind === 'assistant')
    expect(result.frames[capacity].record).toMatchObject({ source: `${cli}.get_state.model.contextWindow`,
      providerID: 'synthetic', modelID: 'model', contextCapacity: 1000 })
    expect(capacity).toBeLessThan(stats)
    expect(stats).toBeLessThan(content)
    expect(result.frames[stats].record.contextUsage).toMatchObject({ tokens: 17, contextWindow: 1000 })
    const middle = result.frames.findIndex((frame, index) => index > content && frame.record?.type === 'cliworker.rpc_usage')
    const second = result.frames.findIndex(frame => frame.event?.text === '工具后')
    expect(middle).toBeGreaterThan(content)
    expect(middle).toBeLessThan(second)
  })
  it.each(['reject', 'timeout'])('optional live stats %s cannot fail or delay final native settlement', async (mode) => {
    const result = await rpc('pi', false, mode)
    expect(result.frames.at(-1)).toMatchObject({ status: 'SUCCESS' })
    expect(result.frames.filter(frame => frame.record?.type === 'cliworker.rpc_usage')).toHaveLength(1)
  })
  it('retains OMP reported orchestration total in telemetry without forging a response bucket', async () => {
    const result = await rpc('omp', true)
    expect(result.events.filter((event) => event.response?.complete).every((event) => event.response?.usage === undefined)).toBe(true)
    expect(result.frames.filter((frame) => frame.record?.type === 'cliworker.rpc_response').map((frame) => frame.record.usage.total)).toEqual([25, 25])
    expect(result.frames.filter((frame) => frame.record?.type === 'cliworker.rpc_response').map((frame) => frame.record.usage.orchestration))
      .toEqual([{ input: 2, output: 1 }, { input: 2, output: 1 }])
  })
})

it('legacy OpenCode uses real step/message identities, tokens and only explicit public reasoning', () => {
  const events: any[] = [], parser = new OpenCodeProtocol((event) => events.push(event), () => {}, 1048576)
  const send = (event: unknown) => parser.feed(JSON.stringify(event) + '\n')
  const part = (id: string, messageID: string, value: object) => ({ id, messageID, sessionID: 'ses_simulated', ...value })
  const envelope = (type: string, value: object) => send({ type, sessionID: 'ses_simulated', part: value })
  envelope('step_start', part('start', 'message1', { type: 'step-start' }))
  envelope('reasoning', part('thought', 'message1', { type: 'reasoning', text: '公开模拟', metadata: { signature: 'OPAQUE' } }))
  envelope('tool_use', part('tool', 'message1', { type: 'tool', tool: 'read', callID: 'call1', state: { status: 'completed', input: { path: 'fixture' }, output: '模拟结果' } }))
  envelope('step_finish', part('finish1', 'message1', { reason: 'tool-calls', tokens: { input: 2, output: 3, reasoning: 1, cache: { read: 4, write: 0 } } }))
  envelope('step_start', part('start2', 'message2', { type: 'step-start' }))
  envelope('text', part('text2', 'message2', { type: 'text', text: '最终模拟' }))
  envelope('step_finish', part('finish2', 'message2', { reason: 'stop', tokens: { input: 4, output: 5, reasoning: 2, cache: { read: 6, write: 0 } } }))
  parser.end()
  expect(parser.result?.status).toBe('SUCCESS')
  expect(events.filter((event) => event.response?.complete).map((event) => event.response.usage.totalTokens)).toEqual([10, 17])
  expect(events.find((event) => event.kind === 'tool').toolCall.output).toBe('模拟结果')
  expect(JSON.stringify(events)).not.toContain('OPAQUE')
})
