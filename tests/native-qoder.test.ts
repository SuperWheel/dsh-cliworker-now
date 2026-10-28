import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeIO } from '../src/host/native-transport.mjs'
import { runNativeQoder } from '../src/host/native-qoder.mjs'
import { foldNativeFrames } from './fixtures/bridge-timeline.ts'
import { workerArguments } from '../src/host/adapters.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const source = String.raw`
// Simulated Qoder ACP process, based on the documented 1.1.73 wire shape.
// No Qoder installation, credentials, network, or real model is used.
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const scenario=process.env.SCENARIO;
const out=value=>process.stdout.write(JSON.stringify(value)+'\n');
const log=value=>appendFileSync(process.env.AUDIT,JSON.stringify(value)+'\n',{mode:0o600});
const sessionId='qoder-simulated-session';
const model={id:'model',type:'select',category:'model',currentValue:'before',options:[{value:'before'},{value:'native/model-key',name:'Human model display name'}]};
const mode={id:'mode',type:'select',category:'mode',currentValue:'default',options:[{value:'default'},{value:'acceptEdits'},{value:'auto'},{value:'dontAsk'},{value:'yolo'}]};
const state={sessionId,modes:{currentModeId:'default',availableModes:[{id:'default'},{id:'acceptEdits'},{id:'auto'},{id:'dontAsk'},{id:'yolo'}]},configOptions:[...(scenario==='missing-model'?[]:[model]),...(scenario==='missing-mode'?[]:[mode])]};
if(scenario==='missing-auto')mode.options=mode.options.filter(option=>option.value!=='auto');
if(scenario==='missing-yolo'||scenario==='permission-downgraded')mode.options=mode.options.filter(option=>option.value!=='yolo');
if(scenario==='missing-default')mode.options=mode.options.filter(option=>option.value!=='default');
if(scenario==='resume-yolo'||scenario==='unconfirmed-mode')mode.currentValue='yolo';
if(scenario==='unavailable-model')model.options=[{value:'before'}];
let pending;
log({fixture:'simulated-qoder',pid:process.pid,argv:process.argv.slice(2)});
process.on('exit',code=>log({fixtureLifecycle:'exit',code}));
const reply=(request,result)=>out({jsonrpc:'2.0',id:request.id,result});
const reject=(request,message)=>out({jsonrpc:'2.0',id:request.id,error:{code:-32603,message}});
const update=(value,extra={})=>out({jsonrpc:'2.0',method:'session/update',params:{sessionId,...extra,update:value}});
const text=(value,eventId,extra={})=>update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:value},...(eventId?{eventId}:{})},extra);
const finish=request=>{
 const usage=scenario==='missing-usage'?undefined:['masked-zero-usage','quota-only'].includes(scenario)?{inputTokens:0,outputTokens:0,totalTokens:0}:{inputTokens:60,outputTokens:7,totalTokens:scenario==='invalid-usage'?68:67,cachedReadTokens:999,contextUsed:999,secret:'SYNTHETIC_NOT_USAGE'};
 const token_count=scenario==='quota-only'?{input_tokens:41,output_tokens:5,total_tokens:46}:{input_tokens:99999,output_tokens:99999,total_tokens:1};
 reply(request,{stopReason:scenario.startsWith('stop-')?scenario.slice(5):'end_turn',...(scenario==='prompt-wrong-session'?{sessionId:'different-session'}:{}),...(usage?{usage}:{}),_meta:{quota:{token_count}}});
};
createInterface({input:process.stdin}).on('line',line=>{
 const request=JSON.parse(line);log(request);
 if(!request.method){if(pending){if(scenario.startsWith('permission'))update({sessionUpdate:'tool_call_update',toolCallId:'denied-simulated',status:['allow','proceed_always'].includes(request.result?.outcome?.optionId)?'completed':'failed'});if(scenario==='permission-other-failure')update({sessionUpdate:'tool_call',toolCallId:'other-simulated',title:'Edit synthetic.txt',status:'failed',_meta:{qoder:{toolName:'Edit'}}});finish(pending);pending=undefined;}return;}
 if(request.jsonrpc!=='2.0')process.exit(20);
 if(request.method==='initialize')return reply(request,{protocolVersion:1,agentInfo:{name:process.env.QODER_TEST_AGENT||'qoder-cli'},agentCapabilities:{loadSession:scenario!=='no-restore'}});
 if(request.method==='session/new'||request.method==='session/load'){
  if(scenario==='session-error')return reject(request,'Simulated Qoder authentication/session error');
  if(request.method==='session/load'){
   text('SIMULATED OLD HISTORY','old-answer');
   update({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'SIMULATED OLD THOUGHT'}});
   update({sessionUpdate:'tool_call',toolCallId:'old-tool',title:'Old read',status:'completed',_meta:{qoder:{toolName:'Read'}}});
   update({sessionUpdate:'usage_update',used:99999,size:200000});
  }
  const value={...state};
  if(request.method==='session/load')delete value.sessionId;
  if(scenario==='missing-session')delete value.sessionId;
  if(scenario==='wrong-session')value.sessionId='different-session';
  return reply(request,value);
 }
 if(request.method==='session/set_config_option'){
  const {configId,value}=request.params;
  // Qoder accepts scalar strings, not Claude-style or nested option objects.
  if(typeof value!=='string')process.exit(21);
  const option=state.configOptions.find(item=>item.id===configId);
  if(!option)return reject(request,'Simulated unknown option');
  option.currentValue=(scenario==='unconfirmed-model'&&configId==='model')?'wrong':
   (scenario==='unconfirmed-mode'&&configId==='mode')?'dontAsk':
   (scenario==='unconfirmed-auto'&&configId==='mode'&&value==='auto')?'yolo':value;
  if(configId==='model')state.configOptions.push({id:'reasoning_effort',type:'select',category:'thought_level',currentValue:'none',options:scenario==='unsupported-effort'?[{value:'none'}]:[{value:'none'},{value:'high'}]});
  return reply(request,{configOptions:state.configOptions});
 }
 if(request.method==='session/set_mode')return reject(request,'Simulated fixture requires mode configuration confirmation');
 if(request.method==='session/prompt'){
  text('FOREIGN','foreign-answer',{sessionId:'foreign-session'});
  text('HELLO','answer-one');text('HELLO','answer-one');
  if(scenario==='streaming'){
   update({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'Synthetic public '}});
   update({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'thought'}});
   update({sessionUpdate:'tool_call',toolCallId:'read-simulated',title:'Read synthetic.txt',status:'in_progress',rawInput:{file_path:'synthetic.txt'},_meta:{qoder:{toolName:'Read'}}});
   update({sessionUpdate:'tool_call_update',toolCallId:'read-simulated',title:'Read synthetic.txt',status:'completed',rawOutput:'synthetic content',_meta:{qoder:{toolName:'Read'}}});
   text('AF','answer-two');text('TER','answer-three');
  }
  if(scenario==='tool-failure'||scenario==='tool-pending'||scenario==='tool-recovered')update({sessionUpdate:'tool_call',toolCallId:'failed-simulated',title:'Edit synthetic.txt',status:scenario==='tool-pending'?'in_progress':'failed',rawInput:{file_path:'synthetic.txt'},_meta:{qoder:{toolName:'Edit'}}});
  if(scenario==='tool-recovered')text('AFTER','answer-after');
  if(scenario==='changed-model'||scenario==='changed-mode'){
   pending=request;return update({sessionUpdate:'config_option_update',configOptions:[{id:scenario==='changed-model'?'model':'mode',currentValue:scenario==='changed-model'?'wrong':'yolo'}]});
  }
  if(scenario==='cancel'){pending=request;return;}
  if(scenario==='permission'||scenario==='permission-no-reject'||scenario==='permission-other-failure'||scenario==='permission-downgraded'){
   update({sessionUpdate:'tool_call',toolCallId:'denied-simulated',title:'Run synthetic shell',status:'pending',_meta:{qoder:{toolName:'Bash'}}});
   pending=request;return out({jsonrpc:'2.0',id:'permission-simulated',method:'session/request_permission',params:{sessionId,toolCall:{toolCallId:'denied-simulated'},options:[{kind:'allow_once',optionId:'allow'},{kind:'allow_always',optionId:'proceed_always'},{kind:'allow_always',optionId:'proceed_always_and_save'},...(scenario==='permission'?[{kind:'reject_once',optionId:'reject'}]:[])]}});
  }
  finish(request);
  if(scenario==='nonzero-exit')process.exitCode=23;
  return;
 }
 if(request.method==='session/cancel'){
  if(pending)reply(pending,{stopReason:'cancelled'});pending=undefined;return;
 }
 reply(request,{});
});
`

async function fixture(
  scenario = 'success',
  options: { continuation?: boolean; mode?: string; effort?: string; cli?: 'qoder' | 'qodercn'; agentName?: string
    access?: string; decision?: 'allow-once' | 'allow-session' | 'deny'; source?: string } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'cliworker-native-qoder-simulated-'))
  roots.push(root)
  const script = join(root, 'simulated-qoder.mjs')
  const audit = join(root, 'audit.ndjson')
  await writeFile(script, source, { mode: 0o600 })
  const uploaded = join(root, 'Qoder 附件.txt')
  if (scenario === 'attachments') await writeFile(uploaded, 'synthetic attachment')
  const config = {
    cli: options.cli ?? 'qoder',
    project: root,
    stateDirectory: root,
    prompt: 'Simulated Qoder request',
    ...(scenario === 'attachments' ? { attachments: [{ kind: 'file', path: uploaded, name: 'Qoder 附件.txt', bytes: Buffer.byteLength('synthetic attachment') }] } : {}),
    mode: options.mode ?? 'accept-edits',
    preference: { model: 'native/model-key', effort: options.effort ?? 'high' },
    argv: [process.execPath, script, '--acp'],
    env: { SCENARIO: scenario, AUDIT: audit, QODER_TEST_AGENT: options.agentName ?? (options.cli === 'qodercn' ? 'qoder-cli-cn' : 'qoder-cli') },
    timeoutMs: 1000,
    maxLineBytes: 1024 * 1024,
    maxRunBytes: 8 * 1024 * 1024,
    ...(options.continuation ? { conversationId: 'qoder-simulated-session' } : {}),
    ...(options.access ? { access: options.access } : {}),
    ...(options.decision ? { approvalNonce: 'synthetic-nonce' } : {}),
  }
  const controller = new AbortController()
  const frames: any[] = []
  const io: any = createNativeIO(
    config,
    (line: string) => {
      const frame = JSON.parse(line)
      frames.push(frame)
      if (options.decision && frame.type === 'approval')
        setTimeout(() => void io.answerApproval(JSON.stringify({ decision: options.decision, source: options.source ?? 'user' }), frame.id), 5)
      if (scenario === 'cancel' && frame.event?.kind === 'assistant')
        controller.abort(new Error('Simulated user stop'))
    },
    controller.signal,
  )
  let error
  try {
    await runNativeQoder(config, io)
  } catch (value) {
    error = value
  }
  await io.close(error)
  const auditText = await readFile(audit, 'utf8').catch((value) => {
    if (value.code === 'ENOENT') return ''
    throw value
  })
  const records = auditText.trim()
    ? auditText
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : []
  const pid = records.find((record) => record.fixture === 'simulated-qoder')?.pid
  let processExited = !pid
  if (pid) {
    try {
      process.kill(pid, 0)
    } catch (value: any) {
      processExited = value.code === 'ESRCH'
    }
  }
  return { frames, records, result: frames.at(-1), processExited }
}

const methods = (records: any[], name: string) => records.filter((record) => record.method === name)
const usageReceipts = (frames: any[]) =>
  frames.filter((frame) => frame.record?.type === 'cliworker.qoder_prompt_usage').map((frame) => frame.record)

describe('Native Qoder ACP runner (simulated native processes; no real model)', () => {
  describe.each(['qoder', 'qodercn'] as const)('%s permission tiers', cli => {
    it.each([
      ['read-only', 'default', 'default'],
      ['workspace-write', 'auto', 'auto'],
      ['danger-full-access', 'bypass_permissions', 'yolo'],
    ] as const)('maps %s to CLI %s and ACP %s', async (access, flag, acp) => {
      const preference = { cli, model: 'native/model-key', effort: 'high' as const }
      const argv = workerArguments(cli, '/synthetic', preference, 'accept-edits', 'synthetic', 1000, undefined, true, access)
      expect(argv.slice(1, 4)).toEqual(['--acp', '--permission-mode', flag])
      const { records, result } = await fixture('resume-yolo', { cli, access, continuation: true })
      expect(result.status).toBe('SUCCESS')
      const changes = methods(records, 'session/set_config_option').filter(record => record.params.configId === 'mode')
      if (acp === 'yolo') expect(changes).toEqual([])
      else expect(changes.at(-1)?.params.value).toBe(acp)
    })
    it('rejects planning before starting the process', async () => {
      const { records, result } = await fixture('success', { cli, mode: 'plan' })
      expect(result.status).toBe('ERROR')
      expect(records).toEqual([])
    })
    it.each(['missing-auto', 'unconfirmed-auto'])('confirms a stricter fallback before prompt (%s)', async scenario => {
      const { records, frames, result } = await fixture(scenario, { cli, access: 'workspace-write' })
      expect(result.status).toBe('SUCCESS')
      expect(methods(records, 'session/set_config_option').at(-1)?.params).toMatchObject({ configId: 'mode', value: 'default' })
      expect(frames.some(frame => frame.event?.text.includes('本轮按询问运行'))).toBe(true)
      expect(methods(records, 'session/prompt')).toHaveLength(1)
    })
    it('downgrades unavailable full access to native auto', async () => {
      const { records, result } = await fixture('missing-yolo', { cli, access: 'danger-full-access' })
      expect(result.status).toBe('SUCCESS')
      expect(methods(records, 'session/set_config_option').at(-1)?.params.value).toBe('auto')
    })
    it.each(['missing-default', 'missing-mode', 'unconfirmed-mode'])('rejects an unconfirmed ask mode (%s)', async scenario => {
      const { records, result } = await fixture(scenario, { cli, access: 'read-only', continuation: true })
      expect(result.status).toBe('ERROR')
      expect(methods(records, 'session/prompt')).toEqual([])
    })
    it('continues after denial in ask mode and never sends persistent permission grants', async () => {
      const { records, result } = await fixture('permission', { cli, access: 'read-only', decision: 'deny' })
      expect(result.status).toBe('SUCCESS')
      expect(result).not.toHaveProperty('notice')
      expect(records.find(record => record.id === 'permission-simulated')?.result.outcome.optionId).toBe('reject')
      expect(methods(records, 'session/cancel')).toEqual([])
    })
    it('rejects stale Host full-access auto-approval after a native downgrade', async () => {
      const { records, result, frames } = await fixture('permission-downgraded',
        { cli, access: 'danger-full-access', decision: 'allow-once', source: 'full-access' })
      expect(result.status).toBe('SUCCESS')
      expect(records.find(record => record.id === 'permission-simulated')?.result.outcome).toEqual({ outcome: 'cancelled' })
      expect(frames.some(frame => frame.event?.text.includes('拒绝沿用完全权限自动放行'))).toBe(true)
    })
  })
  it('passes uploaded files through the actual Qoder runner without losing ACP content blocks', async () => {
    const { records, result } = await fixture('attachments')
    expect(result.status).toBe('SUCCESS')
    expect(methods(records, 'session/prompt')[0].params.prompt[1]).toMatchObject({ type: 'resource_link', name: 'Qoder 附件.txt', mimeType: 'text/plain' })
  })
  it('confirms native model, dynamic effort, and auto scalar configuration before prompt', async () => {
    const { records, result, processExited } = await fixture()
    expect(result).toMatchObject({ status: 'SUCCESS', response: 'HELLO', resultScope: 'run' })
    expect(records[0].argv).toEqual(['--acp'])
    expect(methods(records, 'initialize')[0].params).toMatchObject({
      protocolVersion: 1,
      clientCapabilities: {},
    })
    expect(methods(records, 'session/new')).toHaveLength(1)
    expect(methods(records, 'session/load')).toHaveLength(0)
    expect(
      methods(records, 'session/set_config_option').map((record) => [
        record.params.configId,
        record.params.value,
      ]),
    ).toEqual([
      ['model', 'native/model-key'],
      ['reasoning_effort', 'high'],
      ['mode', 'auto'],
    ])
    expect(methods(records, 'session/set_mode')).toHaveLength(0)
    const lastSelection = records.findLastIndex((record) => record.method === 'session/set_config_option')
    expect(records.findIndex((record) => record.method === 'session/prompt')).toBeGreaterThan(lastSelection)
    expect(methods(records, 'session/prompt')[0].params).toEqual({
      sessionId: 'qoder-simulated-session',
      prompt: [{ type: 'text', text: 'Simulated Qoder request' }],
    })
    expect(processExited).toBe(true)
  })

  it('selects the native yolo mode under 完全权限 and confirms it before prompt', async () => {
    const { records, result } = await fixture('success', { access: 'danger-full-access' })
    expect(result.status).toBe('SUCCESS')
    expect(methods(records, 'session/set_config_option').at(-1).params).toMatchObject({ configId: 'mode', value: 'yolo' })
  })
  it.each([
    ['allow-once', 'allow', 'SUCCESS'],
    // proceed_always is session-scoped; proceed_always_and_save would persist and is never chosen.
    ['allow-session', 'proceed_always', 'SUCCESS'],
    ['deny', 'reject', 'SUCCESS'],
  ] as const)('relays a permission request to the Host: %s → %s', async (decision, optionId, status) => {
    const { frames, records, result } = await fixture('permission', { decision })
    expect(frames.find((frame) => frame.type === 'approval').request).toMatchObject({ allowSession: true })
    expect(records.find((record) => record.id === 'permission-simulated')?.result).toEqual({
      outcome: { outcome: 'selected', optionId },
    })
    expect(result.status).toBe(status)
  })
  it('preserves the native effort when the user chooses default', async () => {
    const { records, result } = await fixture('success', { effort: 'default' })
    expect(result.status).toBe('SUCCESS')
    expect(methods(records, 'session/set_config_option').map((record) => record.params.configId)).toEqual([
      'model',
      'mode',
    ])
  })

  it('supplements hidden primary counters from an independently consistent native quota receipt', async () => {
    const { frames, result } = await fixture('quota-only')
    expect(result.status).toBe('SUCCESS')
    expect(usageReceipts(frames)[0]?.usage).toEqual({ inputTokens: 41, outputTokens: 5, totalTokens: 46 })
  })

  it('restores the same session without counting replayed history as this turn', async () => {
    const { frames, records, result } = await fixture('success', { continuation: true })
    expect(result).toMatchObject({ status: 'SUCCESS', response: 'HELLO' })
    expect(methods(records, 'session/load')[0].params).toMatchObject({ sessionId: 'qoder-simulated-session' })
    expect(methods(records, 'session/new')).toHaveLength(0)
    expect(frames.filter((frame) => frame.type === 'session')).toEqual([
      { type: 'session', id: 'qoder-simulated-session', model: 'native/model-key' },
    ])
    const publicEvents = frames.filter((frame) => frame.type === 'event')
    expect(publicEvents.filter((frame) => frame.event.kind === 'assistant')).toHaveLength(1)
    expect(JSON.stringify(publicEvents)).not.toMatch(/OLD HISTORY|OLD THOUGHT|old-tool|FOREIGN/)
    expect(usageReceipts(frames)).toEqual([
      {
        type: 'cliworker.qoder_prompt_usage',
        sessionId: 'qoder-simulated-session',
        model: 'native/model-key',
        usage: { inputTokens: 60, outputTokens: 7, totalTokens: 67 },
      },
    ])
  })

  it('preserves public thought and tool boundaries with the actual Qoder tool name', async () => {
    const { frames, result } = await fixture('streaming')
    expect(result).toMatchObject({ status: 'SUCCESS', response: 'HELLOAFTER' })
    const rows = foldNativeFrames(frames).filter((row) =>
      ['assistant', 'reasoning', 'tool'].includes(row.kind),
    )
    expect(rows.map((row) => [row.kind, row.kind === 'reasoning' ? row.detail : row.text])).toEqual([
      ['assistant', 'HELLO'],
      ['reasoning', 'Synthetic public thought'],
      ['tool', 'Read synthetic.txt'],
      ['assistant', 'AFTER'],
    ])
    const tools = frames.filter((frame) => frame.event?.kind === 'tool').map((frame) => frame.event)
    expect(tools[0].toolCall).toEqual({
      callId: 'read-simulated',
      name: 'Read',
      input: { file_path: 'synthetic.txt' },
    })
    expect(tools.at(-1)).toMatchObject({
      state: 'COMPLETED',
      toolCall: { callId: 'read-simulated', name: 'Read', output: 'synthetic content' },
    })
    expect(usageReceipts(frames)).toHaveLength(1)
    expect(JSON.stringify(usageReceipts(frames))).not.toMatch(
      /cachedReadTokens|contextUsed|SYNTHETIC_NOT_USAGE|99999/,
    )
  })

  it.each(['missing-usage', 'invalid-usage', 'masked-zero-usage'])(
    'leaves unreported or invalid accounting unknown (%s)',
    async (scenario) => {
      const { frames, result } = await fixture(scenario)
      expect(result.status).toBe('SUCCESS')
      expect(usageReceipts(frames)).toEqual([])
    },
  )

  it('rejects planning before spawning or submitting any task', async () => {
    const { records, result, processExited } = await fixture('success', { mode: 'plan' })
    expect(result).toMatchObject({ status: 'ERROR', response: '' })
    expect(result.error).toMatch(/规划/)
    expect(records).toEqual([])
    expect(processExited).toBe(true)
  })

  it.each(['permission', 'permission-no-reject'])(
    'denies extra permissions and reports the finished turn as completed, without a notice (%s)',
    async (scenario) => {
      const { records, result } = await fixture(scenario)
      expect(result).toMatchObject({ status: 'SUCCESS', response: 'HELLO' })
      expect(result).not.toHaveProperty('error')
      expect(result).not.toHaveProperty('notice')
      expect(records.find((record) => record.id === 'permission-simulated')?.result).toEqual({
        outcome:
          scenario === 'permission' ? { outcome: 'selected', optionId: 'reject' } : { outcome: 'cancelled' },
      })
    },
  )

  it('completes a denied turn without a notice when a tool other than the denied one fails', async () => {
    const { result } = await fixture('permission-other-failure')
    expect(result).toMatchObject({ status: 'SUCCESS' })
    expect(result).not.toHaveProperty('notice')
  })

  it('reports a turn that carries on after a failed tool as success with the failed step count', async () => {
    const { result } = await fixture('tool-recovered')
    expect(result).toMatchObject({ status: 'SUCCESS', notice: '本轮有 1 个工具步骤失败，CLI 已自行处理' })
  })

  it.each(['tool-failure', 'tool-pending'])(
    'never reports failed or unterminated tools as success despite end_turn (%s)',
    async (scenario) => {
      const { frames, result } = await fixture(scenario)
      // A last failed step is unverified; a tool without a terminal fails the turn.
      expect(result.status).toBe(scenario === 'tool-failure' ? 'UNCERTAIN' : 'ERROR')
      expect(frames.find((frame) => frame.event?.kind === 'tool')?.event).toMatchObject({
        state: scenario === 'tool-failure' ? 'FAILED' : 'RUNNING',
      })
    },
  )

  it('sends native cancellation and waits for actual process exit', async () => {
    const { records, result, processExited } = await fixture('cancel')
    expect(result).toMatchObject({ status: 'ERROR', response: 'HELLO' })
    expect(methods(records, 'session/cancel')).toEqual([
      { jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 'qoder-simulated-session' } },
    ])
    expect(processExited).toBe(true)
  })

  it('rejects an unsuccessful process exit even after an ACP success receipt', async () => {
    const { records, result, processExited } = await fixture('nonzero-exit')
    expect(records.find((record) => record.fixtureLifecycle === 'exit')).toEqual({
      fixtureLifecycle: 'exit',
      code: 23,
    })
    expect(result).toMatchObject({ status: 'ERROR', response: 'HELLO' })
    expect(result.error).toMatch(/23/)
    expect(processExited).toBe(true)
  })

  it.each([
    'missing-model',
    'unavailable-model',
    'unconfirmed-model',
    'unsupported-effort',
    'missing-mode',
    'unconfirmed-mode',
    'missing-session',
    'session-error',
  ])('rejects missing or unconfirmed native selections/session before prompt (%s)', async (scenario) => {
    const { records, result } = await fixture(scenario)
    expect(result.status).toBe('ERROR')
    expect(methods(records, 'session/prompt')).toHaveLength(0)
  })

  it.each(['no-restore', 'wrong-session', 'session-error'])(
    'never substitutes a new session after a restore failure (%s)',
    async (scenario) => {
      const { records, result } = await fixture(scenario, { continuation: true })
      expect(result.status).toBe('ERROR')
      expect(methods(records, 'session/new')).toHaveLength(0)
      expect(methods(records, 'session/prompt')).toHaveLength(0)
    },
  )

  it.each(['changed-model', 'changed-mode'])(
    'cancels observed model or permission drift (%s)',
    async (scenario) => {
      const { records, result, processExited } = await fixture(scenario)
      expect(result.status).toBe('ERROR')
      expect(methods(records, 'session/cancel')).toHaveLength(1)
      expect(processExited).toBe(true)
    },
  )

  it('rejects a different session identity in the prompt receipt', async () => {
    expect((await fixture('prompt-wrong-session')).result.status).toBe('ERROR')
  })

  it.each(['cancelled', 'refusal', 'max_turn_requests'])(
    'requires a successful native stop reason (%s)',
    async (reason) => {
      expect((await fixture(`stop-${reason}`)).result.status).toBe('ERROR')
    },
  )
})


describe('Native Qoder CN ACP runner (simulated processes; no native login or real model)', () => {
  it.each([false, true])('uses the selected CN agent and dynamic model/effort for continuation=%s', async continuation => {
    const { records, frames, result, processExited } = await fixture('success', { cli: 'qodercn', continuation })
    expect(result).toMatchObject({ status: 'SUCCESS', response: 'HELLO' })
    expect(methods(records, continuation ? 'session/load' : 'session/new')).toHaveLength(1)
    expect(methods(records, continuation ? 'session/new' : 'session/load')).toHaveLength(0)
    expect(methods(records, 'session/set_config_option').map(record => [record.params.configId, record.params.value])).toEqual([
      ['model', 'native/model-key'], ['reasoning_effort', 'high'], ['mode', 'auto'],
    ])
    expect(frames.filter(frame => frame.record?.type === 'cliworker.qodercn_prompt_usage').map(frame => frame.record)).toEqual([
      { type: 'cliworker.qodercn_prompt_usage', sessionId: 'qoder-simulated-session', model: 'native/model-key',
        usage: { inputTokens: 60, outputTokens: 7, totalTokens: 67 } },
    ])
    expect(usageReceipts(frames)).toEqual([])
    expect(JSON.stringify(frames.filter(frame => frame.type === 'event'))).not.toMatch(/OLD HISTORY|OLD THOUGHT|old-tool|FOREIGN/)
    expect(processExited).toBe(true)
  })

  it.each([
    { cli: 'qodercn' as const, agentName: 'qoder-cli' },
    { cli: 'qoder' as const, agentName: 'qoder-cli-cn' },
  ])('rejects a crossed native executable before creating a session or sending a prompt: %j', async options => {
    const { records, frames, result, processExited } = await fixture('success', options)
    expect(result).toMatchObject({ status: 'ERROR', response: '' })
    expect(methods(records, 'initialize')).toHaveLength(1)
    for (const method of ['session/new', 'session/load', 'session/prompt']) expect(methods(records, method)).toHaveLength(0)
    expect(frames.filter(frame => frame.record?.type?.endsWith('_prompt_usage'))).toEqual([])
    expect(processExited).toBe(true)
  })

  it.each(['permission', 'permission-no-reject'])('denies CN extra permissions (%s)', async scenario => {
    const { records, result, processExited } = await fixture(scenario, { cli: 'qodercn' })
    expect(result).toMatchObject({ status: 'SUCCESS', response: 'HELLO' })
    expect(records.find(record => record.id === 'permission-simulated')?.result).toEqual({ outcome:
      scenario === 'permission' ? { outcome: 'selected', optionId: 'reject' } : { outcome: 'cancelled' } })
    expect(processExited).toBe(true)
  })

  it('sends native CN cancellation and confirms process exit', async () => {
    const { records, result, processExited } = await fixture('cancel', { cli: 'qodercn' })
    expect(result).toMatchObject({ status: 'ERROR', response: 'HELLO' })
    expect(methods(records, 'session/cancel')).toHaveLength(1)
    expect(processExited).toBe(true)
  })

  it.each(['unavailable-model', 'unsupported-effort', 'unconfirmed-model'])('never submits CN with unconfirmed selection (%s)', async scenario => {
    const { records, result } = await fixture(scenario, { cli: 'qodercn' })
    expect(result.status).toBe('ERROR')
    expect(methods(records, 'session/prompt')).toHaveLength(0)
  })

  it.each(['missing-usage', 'invalid-usage', 'masked-zero-usage'])('keeps missing or masked CN accounting unknown (%s)', async scenario => {
    const { frames, result } = await fixture(scenario, { cli: 'qodercn' })
    expect(result.status).toBe('SUCCESS')
    expect(frames.filter(frame => frame.record?.type?.endsWith('_prompt_usage'))).toEqual([])
  })
})
