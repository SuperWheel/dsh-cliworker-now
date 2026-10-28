import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeIO } from '../src/host/native-transport.mjs'
import { runNativeKimi } from '../src/host/native-kimi.mjs'
import { grokAcpArgv, runNativeGrok } from '../src/host/native-grok.mjs'
import { runNativeAcp } from '../src/host/native-acp.mjs'
import { foldNativeFrames } from './fixtures/bridge-timeline.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const source = String.raw`
// SIMULATED ACP agent. This fixture never calls a model or uses credentials.
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const out=x=>process.stdout.write(JSON.stringify(x)+'\n');
const log=x=>appendFileSync(process.env.AUDIT,JSON.stringify(x)+'\n',{mode:0o600});
const scenario=process.env.SCENARIO, cli=process.env.FIXTURE_CLI;
const state={sessionId:'session-fixture',modes:{currentModeId:'default',availableModes:[{id:'default'},{id:'plan'},{id:'yolo'},{id:'auto'}]},configOptions:[{id:'model',currentValue:'before',options:[{value:'before'},{value:'chosen/model'}]},{id:cli==='kimi'?'thinking':'reasoning_effort',currentValue:cli==='kimi'?'off':'none',options:[{value:'off'},{value:'none'},{value:'high'}]}]};
if(cli==='kimi')state.configOptions.push({id:'mode',currentValue:'default',options:state.modes.availableModes.map(mode=>({value:mode.id}))});
if(scenario==='missing-yolo'){
 state.modes.availableModes=state.modes.availableModes.filter(mode=>mode.id!=='yolo');
 state.configOptions.find(option=>option.id==='mode').options=state.modes.availableModes.map(mode=>({value:mode.id}));
}
if(scenario==='missing-auto')state.modes.availableModes=state.modes.availableModes.filter(mode=>mode.id!=='auto');
if(scenario==='missing-default')state.modes.availableModes=state.modes.availableModes.filter(mode=>mode.id!=='default');
let pending;
log({argv:process.argv.slice(2)});
const reply=(q,result)=>out({jsonrpc:'2.0',id:q.id,result});
const update=(sessionId,text,eventId)=>out({jsonrpc:'2.0',method:'session/update',params:{sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text},...(eventId?{eventId}:{})}}});
createInterface({input:process.stdin}).on('line',line=>{
 const q=JSON.parse(line);log(q);
 if(!q.method){if(pending){reply(pending,{stopReason:'end_turn'});pending=undefined;}return;}
 if(q.jsonrpc!=='2.0')process.exit(20);
 if(q.method==='initialize')return reply(q,{protocolVersion:1,agentCapabilities:{loadSession:scenario!=='no-restore'}});
 if(q.method==='session/new'||q.method==='session/load'){
  if(q.method==='session/load')update('session-fixture','OLD HISTORY');
  const value={...state};if(scenario==='no-modes')delete value.modes;if(q.method==='session/load'){delete value.sessionId;if(scenario==='wrong-session')value.sessionId='wrong';}
  return reply(q,value);
 }
 if(q.method==='session/set_config_option'){
  // Current Kimi and real Grok 1.0.50 both decode ACP scalar strings. Grok's
  // installed guide incorrectly advertises a nested { value } shape.
  const value=q.params.value;
  if(typeof value!=='string')process.exit(21);
  state.configOptions.find(x=>x.id===q.params.configId).currentValue=scenario==='wrong-model'?'wrong':scenario==='unconfirmed-yolo'&&q.params.configId==='mode'&&value==='yolo'?'auto':value;
  return reply(q,{configOptions:state.configOptions});
 }
 if(q.method==='session/set_mode'){state.modes.currentModeId=q.params.modeId;return reply(q,{});}
 if(q.method==='session/prompt'){
  const extension=(update,eventId)=>out({jsonrpc:'2.0',method:'_x.ai/session_notification',params:{sessionId:'session-fixture',update,_meta:{eventId}}});
  if(scenario==='grok-responses')extension({sessionUpdate:'response_started',message_id:'native-a'},'response-start-a');
  update('foreign-session','FOREIGN');update('session-fixture','HELLO','delta-one');update('session-fixture','HELLO','delta-one');
  if(scenario==='grok-responses'){
   const usage={input_tokens:20,output_tokens:5,cache_read_input_tokens:10,cache_creation_input_tokens:3,reasoning_tokens:2};
   extension({sessionUpdate:'response_completed',message_id:'native-a',usage,signature:'PRIVATE_SIGNATURE'},'response-end-a');
   extension({sessionUpdate:'response_started',message_id:'native-b'},'response-start-b');
   update('session-fixture','AFTER','delta-two');
   extension({sessionUpdate:'response_completed',message_id:'native-b',usage:{...usage,output_tokens:6}},'response-end-b');
   extension({sessionUpdate:'response_completed',message_id:'native-b',usage:{...usage,output_tokens:6}},'response-end-b');
  }
  if(scenario.startsWith('budget-')){
   // SIMULATED cumulative ACP tool snapshots and public thought increments.
   const count=Number(scenario.slice(7)),chunk='思'.repeat(341);
   const emit=update=>out({jsonrpc:'2.0',method:'session/update',params:{sessionId:'session-fixture',update}});
   for(let i=0;i<count;i++)emit({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:chunk}});
   for(let i=1;i<=count;i++)emit({sessionUpdate:'tool_call_update',toolCallId:'budget-tool',title:'Synthetic read',status:'in_progress',rawOutput:chunk.repeat(i)});
   emit({sessionUpdate:'tool_call_update',toolCallId:'budget-tool',title:'Synthetic read',status:'completed',rawOutput:chunk.repeat(count)});
  }
  if(scenario==='tool-boundary'){
   for(const status of ['in_progress','completed'])out({jsonrpc:'2.0',method:'session/update',params:{sessionId:'session-fixture',update:{sessionUpdate:'tool_call',toolCallId:'tool-fixture',title:'Simulated read',status,rawInput:{path:'synthetic'},rawOutput:status==='completed'?'safe result':undefined}}});
   update('session-fixture','AF','delta-two');update('session-fixture','TER','delta-three');
  }
  if(scenario==='thought-boundary'){
   out({jsonrpc:'2.0',method:'session/update',params:{sessionId:'session-fixture',update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'Synthetic public thought'}}}});
   update('session-fixture','AFTER','delta-two');
  }
  if(scenario==='grok-signature-only'){
   // Grok 1.0.62's observed reply shape has reasoning usage and an encrypted
   // signature, but no response_started/message id or public thought chunk.
   extension({sessionUpdate:'response_completed',usage:{input_tokens:20,output_tokens:23,cache_read_input_tokens:10,cache_creation_input_tokens:0,reasoning_tokens:21},signature:'PRIVATE_SIGNATURE_WITHOUT_THOUGHT'},'response-end-private');
  }
  if(scenario==='grok-public-thought'){
   for(const text of ['Synthetic public ', 'thought'])out({jsonrpc:'2.0',method:'session/update',params:{sessionId:'session-fixture',update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text}}}});
   extension({sessionUpdate:'reasoning_completed',signature:'PRIVATE_REASONING_SIGNATURE'},'reasoning-end');
   update('session-fixture','AFTER','delta-two');
  }
  if(scenario==='changed-mode'){pending=q;return out({jsonrpc:'2.0',method:'session/update',params:{sessionId:'session-fixture',update:{sessionUpdate:'current_mode_update',currentModeId:'auto'}}});}
  if(scenario==='changed-model'){pending=q;return out({jsonrpc:'2.0',method:'session/update',params:{sessionId:'session-fixture',update:{sessionUpdate:'config_option_update',configOptions:[{id:'model',currentValue:'wrong'}]}}});}
  if(scenario==='cancel'){pending=q;return;}
  if(scenario==='permission'){pending=q;return out({jsonrpc:'2.0',id:'permission-fixture',method:'session/request_permission',params:{sessionId:'session-fixture',toolCall:{toolCallId:'tool-permission',title:'Run synthetic command',kind:'execute',rawInput:{command:'synthetic --flag'}},options:[{kind:'allow_once',optionId:'allow'},{kind:'allow_always',optionId:cli==='grok'?'always':'approve_always'},{kind:'reject_once',optionId:'reject'}]}});}
  if(scenario==='tool-failure'||scenario==='tool-recovered')out({jsonrpc:'2.0',method:'session/update',params:{sessionId:'session-fixture',update:{sessionUpdate:'tool_call',toolCallId:'tool-fixture',title:'Simulated edit',status:'failed'}}});
  if(scenario==='tool-recovered')update('session-fixture','AFTER','delta-recovered');
  if(scenario==='bad-envelope')return out({id:q.id,result:{stopReason:'end_turn'}});
  if(cli==='kimi'){
   reply(q,{stopReason:'end_turn'});
   const snapshot=()=>out({jsonrpc:'2.0',method:'session/update',params:{sessionId:'session-fixture',update:{sessionUpdate:'usage_update',used:71,size:200}}});
   if(scenario==='late-context')setTimeout(snapshot,30);else snapshot();return;
  }
  const privateReasoning=scenario==='grok-signature-only';
  return reply(q,{stopReason:'end_turn',_meta:{usage:{inputTokens:66,outputTokens:privateReasoning?23:11,totalTokens:privateReasoning?89:77,cachedReadTokens:20,cacheCreationTokens:6,reasoningTokens:privateReasoning?21:4,usageIsIncomplete:scenario==='grok-incomplete',modelUsage:{secret:'DO_NOT_RETAIN'},unrelated:'DO_NOT_RETAIN'}}});
 }
 if(q.method==='session/cancel'){if(pending)reply(pending,{stopReason:'cancelled'});pending=undefined;return;}
 reply(q,{});
});
`

async function fixture(
  cli: 'kimi' | 'grok',
  scenario = 'success',
  continuation = false,
  /** Simulated Host decision; enables the approval channel. */
  decision?: 'allow-once' | 'allow-session' | 'deny',
  permission: { mode?: string; access?: string } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'cliworker-native-acp-fixture-'))
  roots.push(root)
  const script = join(root, 'agent.mjs'),
    audit = join(root, 'audit.ndjson')
  await writeFile(script, source, { mode: 0o600 })
  const uploaded = join(root, '附件 #1.txt')
  if (scenario === 'attachments') await writeFile(uploaded, 'synthetic attachment')
  const config = {
    cli,
    project: root,
    stateDirectory: root,
    prompt: 'Simulated request',
    ...(scenario === 'attachments' ? { attachments: [{ kind: 'file', path: uploaded, name: '附件 #1.txt', bytes: Buffer.byteLength('synthetic attachment') }] } : {}),
    mode: 'plan',
    preference: { model: 'chosen/model', effort: 'high' },
    argv:
      cli === 'kimi'
        ? [
            process.execPath,
            script,
            '--model',
            'chosen/model',
            '--output-format',
            'stream-json',
            '-p',
            'Simulated request',
          ]
        : [
            process.execPath,
            script,
            '--cwd',
            root,
            '--permission-mode',
            'default',
            '--output-format',
            'streaming-json',
            '--single',
            'Simulated request',
          ],
    env: { FIXTURE_CLI: cli, SCENARIO: scenario, AUDIT: audit },
    timeoutMs: 1000,
    maxLineBytes: 1024 * 1024,
    maxRunBytes: 8 * 1024 * 1024,
    ...(continuation ? { conversationId: 'session-fixture' } : {}),
    ...(decision ? { approvalNonce: 'synthetic-nonce', mode: 'accept-edits' } : {}),
    ...permission,
  }
  const controller = new AbortController(),
    frames: any[] = []
  const io: any = createNativeIO(
    config,
    (line: string) => {
      const frame = JSON.parse(line)
      frames.push(frame)
      if (decision && frame.type === 'approval')
        setTimeout(() => void io.answerApproval(JSON.stringify({ decision, source: 'user' }), frame.id), 5)
      if (scenario === 'cancel' && frame.type === 'event' && frame.event.kind === 'assistant')
        controller.abort(new Error('Simulated stop'))
    },
    controller.signal,
  )
  let error
  try {
    await (cli === 'kimi' ? runNativeKimi : runNativeGrok)(config, io)
  } catch (value) {
    error = value
  }
  await io.close(error)
  const records = (await readFile(audit, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  return { frames, records, result: frames.at(-1) }
}

describe('Native ACP runners (simulated native processes)', () => {
  it.each([
    ['plan', 'danger-full-access', 'plan'],
    ['accept-edits', 'read-only', 'default'],
    ['accept-edits', 'workspace-write', 'yolo'],
    ['accept-edits', 'danger-full-access', 'auto'],
  ])('confirms Kimi %s / %s as native %s before prompting', async (mode, access, expected) => {
    const { records, result, frames } = await fixture('kimi', 'success', false, undefined, { mode, access })
    expect(result.status).toBe('SUCCESS')
    const selections = records.filter(record => record.method === 'session/set_config_option' && record.params.configId === 'mode')
    if (expected === 'default') expect(selections).toEqual([])
    else expect(selections.at(-1)?.params.value).toBe(expected)
    expect(records.some(record => record.method === 'session/prompt')).toBe(true)
    // The menu names default 仅工作区编辑, so no per-turn notice repeats it.
    expect(frames.some(frame => frame.event?.text.includes('Git 工作区'))).toBe(false)
  })
  it.each(['missing-yolo', 'unconfirmed-yolo'])('downgrades Kimi to confirmed default (%s)', async scenario => {
    const { records, frames, result } = await fixture('kimi', scenario, true, undefined,
      { mode: 'accept-edits', access: 'workspace-write' })
    expect(result.status).toBe('SUCCESS')
    expect(records.filter(record => record.method === 'session/set_config_option').at(-1)?.params)
      .toMatchObject({ configId: 'mode', value: 'default' })
    expect(frames.some(frame => frame.event?.text.includes('本轮按询问运行'))).toBe(true)
  })
  it('checks the Kimi advertised list even when the selected current mode matches', async () => {
    const { records, result } = await fixture('kimi', 'missing-default', false, undefined,
      { mode: 'accept-edits', access: 'read-only' })
    expect(result.status).toBe('ERROR')
    expect(records.some(record => record.method === 'session/prompt')).toBe(false)
  })
  it('downgrades unavailable Kimi full access to yolo, never assuming mode names mean permission strength', async () => {
    const { records, result, frames } = await fixture('kimi', 'missing-auto', false, undefined,
      { mode: 'accept-edits', access: 'danger-full-access' })
    expect(result.status).toBe('SUCCESS')
    expect(records.filter(record => record.method === 'session/set_config_option').at(-1)?.params.value).toBe('yolo')
    expect(frames.some(frame => frame.event?.text.includes('本轮按自动审批运行'))).toBe(true)
  })
  it('cancels Kimi when a native mode update widens the confirmed ask mode', async () => {
    const { records, result } = await fixture('kimi', 'changed-mode', false, undefined,
      { mode: 'accept-edits', access: 'read-only' })
    expect(result.status).toBe('ERROR')
    expect(records.some(record => record.method === 'session/cancel')).toBe(true)
  })
  it.each([false, true])('leaves Grok auto-review to the private config without an ACP autoMode (resume=%s)', async continuation => {
    const { frames, records, result } = await fixture('grok', 'no-modes', continuation, undefined,
      { mode: 'accept-edits', access: 'workspace-write' })
    expect(result.status).toBe('SUCCESS')
    expect(frames.some(frame => frame.event?.text.includes('本轮按询问运行'))).toBe(false)
    const session = records.find(record => record.method === (continuation ? 'session/load' : 'session/new'))
    expect(session.params._meta?.autoMode).toBeUndefined()
    expect(records.find(record => record.argv).argv).not.toContain('--always-approve')
  })
  it.each(['kimi', 'grok'] as const)('%s ask mode relays denial and continues without a notice', async cli => {
    const { records, result } = await fixture(cli, 'permission', false, 'deny',
      { mode: 'accept-edits', access: 'read-only' })
    expect(result).toMatchObject({ status: 'SUCCESS', response: 'HELLO' })
    expect(result).not.toHaveProperty('notice')
    expect(records.find(record => record.id === 'permission-fixture')?.result.outcome.optionId).toBe('reject')
    expect(records.some(record => record.method === 'session/cancel')).toBe(false)
  })
  it('keeps many ACP output/thought increments linear and folds the complete timeline', async () => {
    // SIMULATED: only a local JSON-RPC fixture, no model or account.
    const sizes: number[] = []
    for (const count of [64, 128]) {
      const { frames, result } = await fixture('kimi', `budget-${count}`)
      expect(result.status).toBe('SUCCESS')
      const rows = foldNativeFrames(frames), body = '思'.repeat(341 * count)
      expect(rows.find(row => row.kind === 'reasoning')?.detail).toBe(body)
      expect(rows.find(row => row.kind === 'tool')?.toolCall?.output).toBe(body)
      const progress = frames.filter(frame => frame.event?.state === 'RUNNING' && ['tool', 'reasoning'].includes(frame.event.kind))
      expect(progress).toHaveLength(count * 2)
      expect(progress.every(frame => frame.event.delta === '思'.repeat(341))).toBe(true)
      expect(progress.every(frame => frame.event.toolCall?.output === undefined)).toBe(true)
      const bytes = Buffer.byteLength(JSON.stringify(frames))
      expect(bytes).toBeLessThan(Buffer.byteLength(body) * 12)
      sizes.push(bytes)
    }
    expect(sizes[1]!).toBeLessThan(sizes[0]! * 2.4)
  })

  it.each(['kimi', 'grok'] as const)('%s transmits a real temporary upload reference in its ACP prompt', async cli => {
    const { records, result } = await fixture(cli, 'attachments')
    expect(result.status).toBe('SUCCESS')
    const prompt = records.find(record => record.method === 'session/prompt').params.prompt
    expect(prompt[1]).toMatchObject({ type: 'resource_link', name: '附件 #1.txt', size: Buffer.byteLength('synthetic attachment') })
    expect(prompt[1].uri).toContain('%20%231.txt')
  })
  it('does not admit a prompt when stopped during asynchronous native preparation', async () => {
    // Synthetic peer exercises the real ACP runner without a process or model.
    const controller = new AbortController(), calls: string[] = []
    let closed = false
    const peer = {
      async request(method: string) {
        calls.push(method)
        if (method === 'initialize') return { protocolVersion: 1 }
        if (method === 'session/new') return {
          sessionId: 'synthetic-session',
          configOptions: [{ id: 'model', currentValue: 'chosen/model', options: [{ value: 'chosen/model' }] }],
        }
        return { stopReason: 'end_turn' }
      },
      async send() { calls.push('send') },
      end() { calls.push('end') },
      async close() { closed = true },
    }
    const stopped = new Error('Synthetic stop during native preparation')
    const io = {
      signal: controller.signal, async openStdio() { return peer },
      session() {}, native() {}, event() {}, result() { calls.push('result') },
    }
    await expect(runNativeAcp({
      project: '/synthetic', prompt: 'Synthetic request',
      preference: { model: 'chosen/model', effort: 'default' },
    }, io, {
      name: 'Synthetic ACP', argv: () => [], encode: (value: string) => value,
      async onReady() { await Promise.resolve(); controller.abort(stopped) },
    })).rejects.toBe(stopped)
    expect(calls).toEqual(['initialize', 'session/new', 'end'])
    expect(closed).toBe(true)
  })
  it('runs a read-only Grok turn from its private config, without ignored global flags, when its ACP lists no modes', async () => {
    const { records, result } = await fixture('grok', 'no-modes')
    expect(result.status).toBe('SUCCESS')
    const argv = records.find(record => record.argv).argv
    expect(argv.slice(-3)).toEqual(['agent', '--no-leader', 'stdio'])
    expect(argv.filter((arg: string) => ['--permission-mode', '--deny', '--allow'].includes(arg))).toEqual([])
    expect(records.some(record => record.method === 'session/set_mode')).toBe(false)
  })
  it('removes ignored global Grok permissions and retains only the full-access agent flag', () => {
    const argv = ['grok', '--cwd', '/synthetic', '--permission-mode', 'default', '--single', 'task']
    expect(grokAcpArgv({ argv, mode: 'accept-edits' })).toEqual(['grok', '--cwd', '/synthetic',
      'agent', '--no-leader', 'stdio'])
    expect(grokAcpArgv({ argv, mode: 'accept-edits', access: 'danger-full-access' })).toEqual(['grok', '--cwd', '/synthetic', 'agent', '--always-approve', '--no-leader', 'stdio'])
    expect(grokAcpArgv({ argv, mode: 'plan' })).toEqual(['grok', '--cwd', '/synthetic', 'agent', '--no-leader', 'stdio'])
  })
  it('still requires an ACP that lists modes to confirm plan, and never assumes it for other CLIs', async () => {
    const listed = await fixture('grok')
    expect(listed.result.status).toBe('SUCCESS')
    expect(listed.records.find(record => record.method === 'session/set_mode')?.params.modeId).toBe('plan')
    const kimi = await fixture('kimi', 'no-modes')
    expect(kimi.result).toMatchObject({ status: 'ERROR', error: expect.stringContaining('ACP does not advertise the selected permission mode') })
    expect(kimi.records.some(record => record.method === 'session/prompt')).toBe(false)
  })
  it('sends Grok model and effort as the scalar values accepted by its native decoder', async () => {
    const { records, result } = await fixture('grok')
    expect(result.status).toBe('SUCCESS')
    expect(records.filter((record) => record.method === 'session/set_config_option').map((record) =>
      [record.params.configId, record.params.value])).toEqual([['model', 'chosen/model'], ['reasoning_effort', 'high']])
  })
  it.each(['kimi', 'grok'] as const)('%s preserves a public thought between two answer spans without a tool', async (cli) => {
    const { frames, result } = await fixture(cli, 'thought-boundary')
    expect(result.status).toBe('SUCCESS')
    const rows = foldNativeFrames(frames).filter((row) => ['assistant', 'reasoning'].includes(row.kind))
    expect(rows.map((row) => [row.kind, row.kind === 'reasoning' ? row.detail : row.text])).toEqual([
      ['assistant', 'HELLO'], ['reasoning', 'Synthetic public thought'], ['assistant', 'AFTER'],
    ])
  })
  it('projects Grok public thought chunks in order and completes them without exposing signatures', async () => {
    const { frames, result } = await fixture('grok', 'grok-public-thought')
    expect(result).toMatchObject({ status: 'SUCCESS', response: 'HELLOAFTER' })
    const events = frames.filter((frame) => frame.type === 'event').map((frame) => frame.event)
    expect(events.filter((event) => event.kind === 'reasoning').map((event) => [event.state, event.delta ?? event.detail])).toEqual([
      ['RUNNING', 'Synthetic public '], ['RUNNING', 'thought'], ['COMPLETED', 'Synthetic public thought'],
    ])
    expect(foldNativeFrames(frames).filter((row) => ['assistant', 'reasoning'].includes(row.kind))
      .map((row) => [row.kind, row.kind === 'reasoning' ? row.detail : row.text])).toEqual([
        ['assistant', 'HELLO'], ['reasoning', 'Synthetic public thought'], ['assistant', 'AFTER'],
      ])
    expect(JSON.stringify(events)).not.toContain('PRIVATE_REASONING_SIGNATURE')
  })
  it('keeps Grok reasoning-token usage without inventing readable thinking from an encrypted signature', async () => {
    const { frames, result } = await fixture('grok', 'grok-signature-only')
    expect(result).toMatchObject({ status: 'SUCCESS', response: 'HELLO' })
    const events = frames.filter((frame) => frame.type === 'event').map((frame) => frame.event)
    expect(events.filter((event) => event.kind === 'reasoning')).toEqual([])
    expect(foldNativeFrames(frames).filter((row) => row.kind === 'reasoning')).toEqual([])
    expect(JSON.stringify(events)).not.toContain('PRIVATE_SIGNATURE_WITHOUT_THOUGHT')
    expect(frames.find((frame) => frame.record?.type === 'cliworker.grok_prompt_usage')?.record.usage).toMatchObject({
      inputTokens: 66, outputTokens: 23, totalTokens: 89, reasoningTokens: 21,
    })
  })
  it('keeps Kimi post-prompt native context receipts before closing the process', async () => {
    const { frames, result } = await fixture('kimi', 'late-context')
    expect(result.status).toBe('SUCCESS')
    expect(frames.filter((frame) => frame.type === 'native').some((frame) =>
      frame.record.params?.update?.sessionUpdate === 'usage_update' && frame.record.params.update.used === 71)).toBe(true)
  })
  it('settles Grok live response receipts once and never projects encrypted signatures', async () => {
    const { frames, result } = await fixture('grok', 'grok-responses')
    expect(result).toMatchObject({ status: 'SUCCESS', response: 'HELLOAFTER', resultScope: 'run' })
    const events = frames.filter((frame) => frame.type === 'event').map((frame) => frame.event)
    expect(events.filter((event) => event.response?.usage).map((event) => [event.response.id, event.response.usage.totalTokens])).toEqual([
      ['grok:native-a', 38], ['grok:native-b', 39],
    ])
    expect(JSON.stringify(events)).not.toContain('PRIVATE_SIGNATURE')
    expect(frames.find((frame) => frame.record?.type === 'cliworker.grok_prompt_usage')?.record).toEqual({
      type: 'cliworker.grok_prompt_usage', sessionId: 'session-fixture', usageIsIncomplete: false,
      usage: { inputTokens: 66, outputTokens: 11, totalTokens: 77, cachedReadTokens: 20, cacheCreationTokens: 6, reasoningTokens: 4 },
    })
  })
  it('marks incomplete Grok prompt ledgers instead of presenting a full bill', async () => {
    const { frames } = await fixture('grok', 'grok-incomplete')
    const receipt = frames.find((frame) => frame.record?.type === 'cliworker.grok_prompt_usage')?.record
    expect(receipt.usageIsIncomplete).toBe(true)
    expect(JSON.stringify(receipt)).not.toContain('DO_NOT_RETAIN')
  })
  it.each(['kimi', 'grok'] as const)('%s folds tiny chunks but preserves the native tool boundary', async (cli) => {
    const { frames, result } = await fixture(cli, 'tool-boundary')
    expect(result.status).toBe('SUCCESS')
    const rows = foldNativeFrames(frames).filter((row) => ['assistant', 'tool'].includes(row.kind))
    expect(rows.map((row) => [row.kind, row.text])).toEqual([['assistant', 'HELLO'], ['tool', 'Simulated read'], ['assistant', 'AFTER']])
    expect(frames.find((row) => row.event?.kind === 'tool')?.event.toolCall).toMatchObject({ callId: 'tool-fixture', input: { path: 'synthetic' } })
  })
  it.each(['kimi', 'grok'] as const)(
    '%s restores context, confirms selection and filters history/other sessions/duplicates',
    async (cli) => {
      const { records, frames, result } = await fixture(cli, 'success', true)
      expect(result).toMatchObject({ status: 'SUCCESS', response: 'HELLO' })
      expect(
        frames.filter((frame) => frame.type === 'event' && frame.event.kind === 'assistant'),
      ).toHaveLength(1)
      expect(records.some((record) => record.method === 'session/load')).toBe(true)
      expect(records.some((record) => record.method === 'session/new')).toBe(false)
      const args = records[0].argv
      expect(args).toContain(cli === 'kimi' ? 'acp' : 'stdio')
      expect(args).not.toContain('stream-json')
      expect(args).not.toContain('streaming-json')
    },
  )
  it.each(['kimi', 'grok'] as const)(
    '%s fails restoration without opening a replacement session',
    async (cli) => {
      const { result, records } = await fixture(cli, 'no-restore', true)
      expect(result.status).toBe('ERROR')
      expect(records.some((record) => ['session/new', 'session/prompt'].includes(record.method))).toBe(false)
    },
  )
  it.each(['kimi', 'grok'] as const)(
    '%s rejects an unconfirmed selected model before prompt',
    async (cli) => {
      const { result, records } = await fixture(cli, 'wrong-model')
      expect(result.status).toBe('ERROR')
      expect(records.some((record) => record.method === 'session/prompt')).toBe(false)
    },
  )
  it.each(['kimi', 'grok'] as const)('%s denies permission and reports a clean end_turn as completed, without a notice', async (cli) => {
    const { result, records } = await fixture(cli, 'permission')
    expect(result).toMatchObject({ status: 'SUCCESS', response: 'HELLO' })
    expect(result).not.toHaveProperty('error')
    expect(result).not.toHaveProperty('notice')
    expect(records.find((record) => record.id === 'permission-fixture')?.result).toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
    })
  })
  it.each([
    ['kimi', 'allow-once', 'allow', 'SUCCESS'],
    ['kimi', 'allow-session', 'approve_always', 'SUCCESS'],
    ['kimi', 'deny', 'reject', 'SUCCESS'],
    // Grok's always-allow persists to the project, so a session grant falls back to once.
    ['grok', 'allow-session', 'allow', 'SUCCESS'],
    ['grok', 'deny', 'reject', 'SUCCESS'],
  ] as const)('%s relays a permission request to the Host: %s → %s', async (cli, decision, optionId, status) => {
    const { frames, records, result } = await fixture(cli, 'permission', false, decision)
    expect(frames.find((frame) => frame.type === 'approval').request).toEqual({
      kind: 'command', summary: 'Run synthetic command', detail: 'synthetic --flag', allowSession: cli === 'kimi',
    })
    expect(records.find((record) => record.id === 'permission-fixture')?.result).toEqual({
      outcome: { outcome: 'selected', optionId },
    })
    expect(result.status).toBe(status)
  })
  it.each(['kimi', 'grok'] as const)(
    '%s attempts native cancel after a real fixture output chunk',
    async (cli) => {
      const { result, records } = await fixture(cli, 'cancel')
      expect(result).toMatchObject({ status: 'ERROR', response: 'HELLO' })
      expect(records.some((record) => record.method === 'session/cancel')).toBe(true)
    },
  )
  it('reports a Kimi turn that ends right after a failed tool as unverified, never successful', async () => {
    expect((await fixture('kimi', 'tool-failure')).result).toMatchObject({
      status: 'UNCERTAIN', error: '本轮最后的工具步骤失败后 CLI 直接结束；结果待核实，请先核查实际产物，不要自动重试' })
  })
  it('reports a Kimi turn that carries on after a failed tool as success with the failed step count', async () => {
    const { result } = await fixture('kimi', 'tool-recovered')
    expect(result).toMatchObject({ status: 'SUCCESS', notice: '本轮有 1 个工具步骤失败，CLI 已自行处理' })
    expect(result.error).toBeUndefined()
  })
  it('rejects a changed native session identity', async () => {
    expect((await fixture('kimi', 'wrong-session', true)).result.status).toBe('ERROR')
  })
  it('rejects a malformed ACP response envelope even when it contains end_turn', async () => {
    expect((await fixture('kimi', 'bad-envelope')).result.status).toBe('ERROR')
  })
  it('rejects an observed model switch and attempts native cancellation', async () => {
    const { result, records } = await fixture('kimi', 'changed-model')
    expect(result.status).toBe('ERROR')
    expect(records.some((record) => record.method === 'session/cancel')).toBe(true)
  })
})
