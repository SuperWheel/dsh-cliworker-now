import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeIO } from '../src/host/native-transport.mjs'
import { runNativeZcode } from '../src/host/native-zcode.mjs'
import { foldNativeFrames } from './fixtures/bridge-timeline.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const source = String.raw`
// Simulated ZCode app-server. This fixture never invokes a model.
import { createInterface } from 'node:readline';import { appendFileSync,readFileSync,writeFileSync } from 'node:fs';
const out=x=>process.stdout.write(JSON.stringify(x)+'\n'), log=x=>appendFileSync(process.env.AUDIT,JSON.stringify(x.id==='headers'?{id:x.id,headersApplied:x.result?.headersApplied,headerAccepted:x.result?.requestAuth?.apiKey==='SYNTHETIC_ACCOUNT_KEY'}:x)+'\n',{mode:0o600});
const scenario=process.env.SCENARIO, sessionId=scenario.startsWith('context-')?'sess_context-fixture':'zcode-fixture', project=process.env.PROJECT;
const state={session:{sessionId,workspace:{workspacePath:project}},settings:{model:{current:{providerId:'chosen',modelId:'model'},available:[{ref:{providerId:'chosen',modelId:'model'},reasoning:{defaultLevel:'high',levels:[{value:'high'},{value:'low'}]}}]},mode:{current:'edit'}},runtime:{pendingRequestIds:[]},projection:{status:'idle',pendingPermissions:[],activeToolCalls:[]}};
let inputId, awaiting, stopped=false;
log({argv:process.argv.slice(2),leakedAccountEnvironment:!!process.env.CLIWORKER_ZCODE_NATIVE_ACCOUNT});
if(process.argv.indexOf('app-server')>process.argv.indexOf('--disallowedTools'))process.exit(22);
const reply=(q,result)=>out({id:q.id,result});
const event=(type,payload,extra={})=>out({method:'session/event',params:{sessionId,turnId:'turn-fixture',type,payload,...extra}});
const finish=()=>{event('turn.completed',{inputId,resultType:stopped?'cancelled':'success',response:scenario==='tool-boundary'||scenario==='model-usage'?'AFTER':'HELLO',usage:scenario==='model-usage'?{inputTokens:99999,outputTokens:1}:undefined});out({method:'state.updated',params:{sessionId,reason:'prompt_completed'}});};
createInterface({input:process.stdin}).on('line',line=>{
 const q=JSON.parse(line);log(q);
 if(!q.method){if(q.id==='preferences'){if(q.result?.memoryEnabled!==false)process.exit(23);reply(awaiting,state);awaiting=undefined;}else if(q.id==='permission'){event('permission.resolved',{toolCallId:'denied-tool',decision:q.result?.decision});if(q.result?.decision==='allow'){event('tool.updated',{kind:'result',toolCallId:'denied-tool',toolName:'Bash',result:{success:true,text:'synthetic'}});event('tool.updated',{kind:'batch',toolCallIds:['denied-tool'],successCount:1,errorCount:0});finish();return;}event('tool.updated',{kind:'batch',toolCallIds:scenario==='permission-other-failure'?['denied-tool','other-tool']:['denied-tool'],successCount:0,errorCount:scenario==='permission-other-failure'?2:1});if(scenario==='permission-failed'){event('turn.failed',{inputId});out({method:'state.updated',params:{sessionId,reason:'prompt_failed'}});}else finish();}else if(q.id==='headers')finish();return;}
 if(q.jsonrpc!==undefined)process.exit(20);
 if(q.method==='runtime/capabilities')return reply(q,{protocol:{name:'zcode',version:1}});
 if(q.method==='provider/updateAccountConfig')return reply(q,{receivedRevision:q.params.revision,providerCount:1,status:'received'});
 if(q.method==='session/create'||q.method==='session/resume'){
   if(q.method==='session/create'&&q.params.model)return out({id:q.id,error:{code:-32603,message:'Simulated 0.16.9 initial model drops required reasoning options'}});
   awaiting=q;return out({id:'preferences',method:'session/requestRuntimePreferences',params:{sessionId}});
 }
 if(q.method==='session/setModel'){state.settings.model.current=scenario==='wrong-model'?{providerId:'wrong',modelId:'wrong'}:q.params.model;return reply(q,state);}
 if(q.method==='session/setMode'){
   if((scenario==='no-edit'&&q.params.mode==='edit')||(scenario==='no-yolo'&&q.params.mode==='yolo')||scenario==='no-modes')return out({id:q.id,error:{code:-32602,message:'Synthetic unavailable mode'}});
   state.settings.mode.current=scenario==='wrong-mode'||(scenario==='wrong-edit'&&q.params.mode==='edit')?'yolo':q.params.mode;return reply(q,state);
 }
 if(q.method==='session/read'){if(scenario==='mode-drift-final'&&inputId)state.settings.mode.current='yolo';if(scenario==='active-final'&&inputId)state.runtime.activeTurnId='still-active';return reply(q,state);}
 if(q.method==='session/subscribe')return reply(q,{sessionId,eventSeq:0,events:[]});
 if(q.method==='session/close')return reply(q,{closed:true});
 if(q.method==='session/send'){
  inputId=q.params.inputId;reply(q,{accepted:true,sessionId,stateRevision:1});
  event('turn.started',{inputId:'OLD INPUT'},{turnId:'old-turn'});
  event('model.streaming',{kind:'text_delta',delta:'OLD',inputId:'OLD INPUT'},{turnId:'old-turn'});
  event('turn.started',{inputId});
  if(scenario.startsWith('context-')){
   const base={querySource:'main_turn',sessionId,providerId:'chosen',modelId:'model',traceId:'trace-context',requestId:'request-context-1'};
   event('session.updated',{...base,type:'model_request_started'},{traceId:'trace-context'});
   writeFileSync(process.env.ROLLOUT_FILE,JSON.stringify({type:'model_io',sessionId,turnId:'turn-fixture',traceId:'trace-context',requestId:'request-context-1',querySource:'main_turn',model:{providerId:'chosen',modelId:'model'},request:{messagesKind:'full',messageOffset:0,messageCount:2,messages:[{role:'system',content:'SIMULATED SYSTEM NO DUPLICATION'},{role:'user',content:'SIMULATED HELLO'}],body:{model:'model',system:[{type:'text',text:'SIMULATED SYSTEM'}],tools:[{name:'simulated-read',input_schema:{type:'object'}}]}}})+'\n');
   event('session.updated',{...base,type:'model_request_completed'},{traceId:'trace-context'});
   if(scenario==='context-next-unknown')event('session.updated',{...base,type:'model_request_started',requestId:'request-context-2'},{traceId:'trace-context'});
  }
  event('model.streaming',{kind:'text_delta',delta:'FOREIGN'},{sessionId:'foreign'});
  event('model.streaming',{kind:'text_delta',delta:'HELLO',...(['model-usage','tool-before-complete'].includes(scenario)?{assistantMessageId:'message-a'}:{})},{eventId:'delta-one'});
  if(scenario==='thought-boundary'){
   event('model.streaming',{kind:'reasoning_delta',delta:'Synthetic public thought'});
   event('model.streaming',{kind:'text_delta',delta:'AFTER'});
  }
  if(scenario==='streamed-tool-input'){
   event('model.streaming',{kind:'tool_call',toolCallId:'streamed-tool',assistantMessageId:'streamed-assistant',toolName:'Write',done:false,delta:'',input:{file_path:'artifact.json',content:'explicit synthetic content'}});
   event('tool.updated',{kind:'scheduled',toolCallId:'streamed-tool',assistantMessageId:'streamed-assistant',toolName:'Write',inputOmitted:true,inputRef:'synthetic-ref',inputByteLength:123});
   event('tool.updated',{kind:'started',toolCallId:'streamed-tool',toolName:'Write'});
   event('tool.updated',{kind:'result',toolCallId:'streamed-tool',result:{success:true,content:'explicit synthetic result'}});
   finish();return;
  }
  if(scenario==='model-usage'){
   const usage={inputTokens:33,outputTokens:5,cacheReadTokens:10,cacheWriteTokens:3,reasoningTokens:2,totalTokens:38};
   event('session.updated',{querySource:'main_turn',content:'HELLO',stopReason:'tool-calls',toolCallCount:1,usage});
   event('tool.updated',{kind:'started',toolCallId:'usage-tool',toolName:'read',input:{path:'synthetic'}});
   event('tool.updated',{kind:'result',toolCallId:'usage-tool',toolName:'read',result:{success:true,text:'safe result'}});
   event('model.streaming',{kind:'reasoning_delta',assistantMessageId:'message-b',delta:'synthetic public thought'});
   event('model.streaming',{kind:'text_delta',assistantMessageId:'message-b',delta:'AFTER'});
   event('session.updated',{querySource:'main_turn',content:'AFTER',stopReason:'stop',toolCallCount:0,usage:{...usage,outputTokens:6,totalTokens:39}});
   finish();return;
  }
  if(scenario==='tool-before-complete'){
   // Observed real order: a read-only tool is scheduled and started before its message's model_complete.
   event('tool.updated',{kind:'scheduled',toolCallId:'early-tool',assistantMessageId:'message-a',toolName:'Read',input:{file_path:'synthetic'}});
   event('tool.updated',{kind:'started',toolCallId:'early-tool',toolName:'Read'});
   event('session.updated',{querySource:'main_turn',content:'HELLO',stopReason:'tool-calls',toolCallCount:1});
   event('tool.updated',{kind:'result',toolCallId:'early-tool',result:{success:true,content:'synthetic result'}});
   event('tool.updated',{kind:'batch',toolCallIds:['early-tool'],successCount:1,errorCount:0});
   finish();return;
  }
  if(scenario==='tool-boundary'){
   event('tool.updated',{kind:'call',toolCallId:'tool-test',toolName:'read',input:{path:'synthetic'}});
   event('tool.updated',{kind:'result',toolCallId:'tool-test',toolName:'read',result:{success:true,text:'safe result'}});
   event('model.streaming',{kind:'text_delta',delta:'AF'});event('model.streaming',{kind:'text_delta',delta:'TER'});
  }
  if(scenario.startsWith('account-')){
   const params={requestId:'fixture-header',sessionId,turnId:'turn-fixture',workspace:{workspaceKey:project,workspacePath:project},providerId:'chosen',modelSelection:{providerId:'chosen',modelId:'model'},accountAccess:{type:'zhipu-account',accountType:'bigmodel',mode:'individual-coding-plan',entitled:true},reason:'model-request'};
   if(scenario==='account-provider')params.providerId='foreign';
   if(scenario==='account-model')params.modelSelection.modelId='foreign';
   if(scenario==='account-session')params.sessionId='foreign';
   if(scenario==='account-workspace')params.workspace.workspaceKey='foreign';
   if(scenario==='account-access')params.accountAccess.accountType='zai';
   if(scenario==='account-reason')params.reason='foreign';
   if(scenario==='account-rotated'){const credentials=JSON.parse(readFileSync(process.env.CREDENTIAL_FILE,'utf8'));credentials['account-provider:chosen:identity']='DIFFERENT_IDENTITY';writeFileSync(process.env.CREDENTIAL_FILE,JSON.stringify(credentials));}
   return out({id:'headers',method:'interaction/requestProviderRuntimeHeaders',params});
  }
  if(scenario==='changed-model'){event('session.updated',{providerId:'wrong',modelId:'wrong'});return;}
  event('model.streaming',{kind:'text_delta',delta:'HELLO'},{eventId:'delta-one'});
  if(scenario==='cancel')return;
  if(scenario.startsWith('permission')){event('tool.updated',{toolCallId:'denied-tool',toolName:'Bash',kind:'scheduled'});return out({id:'permission',method:'interaction/requestPermission',params:{sessionId,toolCallId:'denied-tool',toolName:'Bash',reason:'Run synthetic command',riskLevel:'medium',input:{command:'synthetic --flag'},options:[]}});}
  if(['tool-failure','tool-recovered','batch-failure'].includes(scenario)){
   // Simulated order: a write fails, the batch closes it, and the CLI may carry on.
   event('tool.updated',{kind:'call',toolCallId:'write-tool',toolName:'write',input:{path:'synthetic'}});
   if(scenario!=='batch-failure')event('tool.updated',{kind:'error',toolCallId:'write-tool',toolName:'write',result:{success:false,text:'synthetic failure'}});
   else event('tool.updated',{kind:'result',toolCallId:'write-tool',toolName:'write',result:{success:true,text:'synthetic result'}});
   event('tool.updated',{kind:'batch',toolCallIds:['write-tool'],successCount:0,errorCount:1});
   if(scenario==='tool-recovered'){
    event('tool.updated',{kind:'call',toolCallId:'retry-tool',toolName:'edit',input:{path:'synthetic'}});
    event('tool.updated',{kind:'result',toolCallId:'retry-tool',toolName:'edit',result:{success:true,text:'synthetic edit'}});
    event('model.streaming',{kind:'text_delta',delta:'AFTER'});
   }
  }
  if(scenario==='missing-terminal')return out({method:'state.updated',params:{sessionId,reason:'prompt_completed'}});
  finish();return;
 }
 if(q.method==='session/stop'){stopped=true;reply(q,{});finish();return;}
 out({id:q.id,error:{code:-32601,message:'Unknown fixture method'}});
});
`

async function fixture(scenario = 'success', continuation = false,
  host: { access?: string; mode?: string; decision?: 'allow-once' | 'allow-session' | 'deny' } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cliworker-native-zcode-fixture-')))
  roots.push(root)
  const script = join(root, 'agent.mjs'),
    audit = join(root, 'audit.ndjson')
  await writeFile(script, source, { mode: 0o600 })
  const credentials = {
      'account-provider:chosen:identity': 'SYNTHETIC_IDENTITY',
      key: 'SYNTHETIC_ACCOUNT_KEY',
    },
    credentialFile = join(root, '.zcode/v2/credentials.json')
  await mkdir(join(root, '.zcode/v2'), { recursive: true, mode: 0o700 })
  await writeFile(credentialFile, JSON.stringify(credentials), { mode: 0o600 })
  const account = {
    schema: 1,
    createdAt: scenario === 'account-expired' ? Date.now() - 10000 : Date.now(),
    selection: { providerId: 'chosen', modelId: 'model', options: { reasoningLevel: 'high' } },
    accountAccess: {
      type: 'zhipu-account',
      accountType: 'bigmodel',
      mode: 'individual-coding-plan',
      entitled: true,
    },
    binding: { identity: 'SYNTHETIC_IDENTITY', key: 'SYNTHETIC_ACCOUNT_KEY' },
    credential: {
      authDirectory: root,
      sha256: createHash('sha256').update(JSON.stringify(credentials)).digest('hex'),
    },
    snapshot: {
      revision: 'fixture-account-v1',
      basedOnZCodeBuiltinRevision: 'fixture-builtin-v1',
      providers: { chosen: { access: { type: 'zhipu-account', entitled: true } } },
      states: { chosen: { availability: 'available', entitled: true, current: true } },
    },
  }
  const rollout = join(root, 'storage/cli/rollout')
  await mkdir(rollout, { recursive: true, mode: 0o700 })
  const config = {
    cli: 'zcode',
    project: root,
    stateDirectory: root,
    prompt: 'Simulated request',
    mode: 'accept-edits',
    preference: { model: 'chosen/model', effort: 'high' },
    argv: [
      process.execPath,
      script,
      '--cwd',
      root,
      '--mode',
      'edit',
      '--output-format',
      'stream-json',
      '--disallowedTools',
      'Task,AskUserQuestion',
      ...(continuation ? ['--resume', 'zcode-fixture'] : []),
      '--prompt',
      'Simulated request',
    ],
    env: {
      SCENARIO: scenario,
      PROJECT: root,
      AUDIT: audit,
      CREDENTIAL_FILE: credentialFile,
      ZCODE_STORAGE_DIR: join(root, 'storage'),
      ROLLOUT_FILE: join(rollout, 'model-io-sess_context-fixture.jsonl'),
      ...(scenario === 'account-env' ? { CLIWORKER_ZCODE_NATIVE_ACCOUNT: JSON.stringify(account) } : {}),
    },
    ...(scenario.startsWith('account-') && scenario !== 'account-env' ? { zcodeNativeAccount: account } : {}),
    timeoutMs: 600,
    maxLineBytes: 1024 * 1024,
    maxRunBytes: 8 * 1024 * 1024,
    ...(continuation ? { conversationId: 'zcode-fixture' } : {}),
    ...(host.access ? { access: host.access } : {}),
    ...(host.mode ? { mode: host.mode } : {}),
    ...(host.decision ? { approvalNonce: 'synthetic-nonce' } : {}),
  }
  const controller = new AbortController(),
    frames: any[] = []
  const io: any = createNativeIO(
    config,
    (line: string) => {
      const frame = JSON.parse(line)
      frames.push(frame)
      if (host.decision && frame.type === 'approval')
        setTimeout(() => void io.answerApproval(JSON.stringify({ decision: host.decision, source: 'user' }), frame.id), 5)
      if (scenario === 'cancel' && frame.type === 'event' && frame.event.kind === 'assistant')
        controller.abort(new Error('Simulated stop'))
    },
    controller.signal,
  )
  let error
  try {
    await runNativeZcode(config, io)
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

describe('Native ZCode app-server (simulated native processes)', () => {
  it.each(['context-composition', 'context-next-unknown'])('publishes exact native request estimates and newer explicit unknown (%s)', async scenario => {
    const { frames, result } = await fixture(scenario)
    expect(result.status).toBe('SUCCESS')
    const observations = frames.filter(frame => frame.record?.type === 'cliworker.zcode_context_observation').map(frame => frame.record)
    expect(observations[0]).toMatchObject({ sessionId: 'sess_context-fixture', requestId: 'request-context-1', breakdown: null })
    expect(observations[1]).toMatchObject({ sessionId: 'sess_context-fixture', requestId: 'request-context-1',
      model: 'chosen/model', breakdown: { systemTokens: 6, estimated: true, basis: 'zcode.estimateTokens.v1.actual-request' } })
    expect(JSON.stringify(observations)).not.toMatch(/SIMULATED HELLO|input_schema|NO DUPLICATION/)
    expect(observations.every(row => row.contextUsed === undefined && row.contextCapacity === undefined)).toBe(true)
    if (scenario === 'context-next-unknown') {
      expect(observations).toHaveLength(3)
      expect(observations[2]).toMatchObject({ requestId: 'request-context-2', breakdown: null })
    } else expect(observations).toHaveLength(2)
  })
  it('preserves a public thought between two answer spans without a tool', async () => {
    const { frames, result } = await fixture('thought-boundary')
    expect(result.status).toBe('SUCCESS')
    const rows = foldNativeFrames(frames).filter((row) => ['assistant', 'reasoning'].includes(row.kind))
    expect(rows.map((row) => [row.kind, row.kind === 'reasoning' ? row.detail : row.text])).toEqual([
      ['assistant', 'HELLO'], ['reasoning', 'Synthetic public thought'], ['assistant', 'AFTER'],
    ])
  })
  it('preserves complete model.streaming tool inputs across input-omitting updates without executing tools', async () => {
    const { frames, records, result } = await fixture('streamed-tool-input')
    expect(result.status).toBe('SUCCESS')
    const tools = frames.filter((frame) => frame.event?.kind === 'tool').map((frame) => frame.event)
    expect(tools).toHaveLength(3)
    expect(new Set(tools.map((event) => event.step)).size).toBe(1)
    for (const event of tools) expect(event.toolCall.input).toEqual({ file_path: 'artifact.json', content: 'explicit synthetic content' })
    expect(tools.at(-1)).toMatchObject({ state: 'COMPLETED', toolCall: {
      callId: 'streamed-tool', output: { success: true, content: 'explicit synthetic result' },
    } })
    expect(records.filter((record: any) => record.method === 'session/send')).toHaveLength(1)
    expect(records.some((record: any) => /tool.*execute|execute.*tool/i.test(record.method ?? ''))).toBe(false)
  })
  it('settles each native model_complete usage once while the final result remains run scoped', async () => {
    const { frames, result } = await fixture('model-usage')
    expect(result).toMatchObject({ status: 'SUCCESS', response: 'AFTER', resultScope: 'run' })
    const settled = frames.filter((frame) => frame.event?.response?.usage)
    expect(settled.map((frame) => [frame.event.response.id, frame.event.response.usage.totalTokens])).toEqual([
      ['zcode:message-a', 38], ['zcode:message-b', 39],
    ])
    expect(settled[0].event.response.usage.inputTokens).toBe(20)
    expect(foldNativeFrames(frames).filter((row) => row.kind === 'assistant').map((row) => row.text)).toEqual(['HELLO', 'AFTER'])
  })
  it('holds a tool started before its message completion until after that response boundary', async () => {
    const { frames, result } = await fixture('tool-before-complete')
    expect(result.status).toBe('SUCCESS')
    const events = frames.filter((frame) => frame.event).map((frame) => frame.event)
    const complete = events.findIndex((event) => event.response?.complete)
    const tools = events.flatMap((event, index) => (event.kind === 'tool' ? [[index, event.state]] : []))
    expect(complete).toBeGreaterThanOrEqual(0)
    expect(tools.map(([, state]) => state)).toEqual(['RUNNING', 'RUNNING', 'COMPLETED'])
    expect(tools.every(([index]) => index > complete)).toBe(true)
    expect(events.slice(0, complete).some((event) => event.kind === 'tool')).toBe(false)
  })
  it('preserves tool-separated text segments instead of merging them into step zero', async () => {
    const { frames, result } = await fixture('tool-boundary')
    expect(result.status).toBe('SUCCESS')
    expect(foldNativeFrames(frames).filter((row) => ['assistant', 'tool'].includes(row.kind)).map((row) => [row.kind, row.text]))
      .toEqual([['assistant', 'HELLO'], ['tool', 'read'], ['assistant', 'AFTER']])
    expect(frames.find((row) => row.event?.kind === 'tool')?.event.toolCall).toMatchObject({ callId: 'tool-test', input: { path: 'synthetic' } })
  })
  it.each([false, true])(
    'executes/restores through app-server without headless and filters old/foreign/duplicate events (%s)',
    async (continuation) => {
      const { frames, records, result } = await fixture('success', continuation)
      expect(result).toMatchObject({ status: 'SUCCESS', response: 'HELLO' })
      expect(
        frames.filter((frame) => frame.type === 'event' && frame.event.kind === 'assistant'),
      ).toHaveLength(1)
      expect(records[0].argv).toContain('app-server')
      expect(records[0].argv).not.toContain('--prompt')
      expect(records[0].argv).toContain('--disallowedTools')
      expect(
        records.some((record) => record.method === (continuation ? 'session/resume' : 'session/create')),
      ).toBe(true)
      if (!continuation)
        expect(records.find((record) => record.method === 'session/create').params.model).toBeUndefined()
      expect(records.find((record) => record.method === 'session/setModel').params.model).toEqual({
        providerId: 'chosen',
        modelId: 'model',
        options: { reasoningLevel: 'high' },
      })
      expect(records.find((record) => record.method === 'session/send').params.toolDenylist).toEqual([
        'Task',
        'AskUserQuestion',
      ])
      expect(records.find((record) => record.id === 'preferences').result.memoryEnabled).toBe(false)
    },
  )
  it('rejects a selected-model mismatch before prompt', async () => {
    const { result, records } = await fixture('wrong-model')
    expect(result.status).toBe('ERROR')
    expect(records.some((record) => record.method === 'session/send')).toBe(false)
  })
  it.each([
    ['allow-once', 'allow', 'SUCCESS'],
    // No confirmed session-scoped reply; permissionUpdates would persist a project rule.
    ['allow-session', 'allow', 'SUCCESS'],
    ['deny', 'deny', 'SUCCESS'],
  ] as const)('relays a permission request to the Host: %s → %s', async (decision, reply, status) => {
    const { result, records, frames } = await fixture('permission', false, { decision, access: 'read-only' })
    expect(frames.find((frame) => frame.type === 'approval').request).toEqual({
      kind: 'command', summary: 'Bash：Run synthetic command', detail: 'synthetic --flag', allowSession: false,
    })
    const answer = records.find((record) => record.id === 'permission').result
    expect(answer.decision).toBe(reply)
    expect(answer).not.toHaveProperty('permissionUpdates')
    expect(result.status).toBe(status)
  })
  it.each([
    ['read-only', 'build'],
    ['workspace-write', 'edit'],
    ['danger-full-access', 'yolo'],
  ])('selects the native mode for the DSH tier %s → %s', async (access, mode) => {
    const { result, records } = await fixture('success', false, { access })
    expect(result.status).toBe('SUCCESS')
    expect(records.find((record) => record.method === 'session/setMode')?.params.mode ?? 'edit').toBe(mode)
  })
  it.each(['read-only', 'workspace-write', 'danger-full-access'])('keeps plan ahead of %s', async access => {
    const { result, records } = await fixture('success', false, { mode: 'plan', access })
    expect(result.status).toBe('SUCCESS')
    expect(records.find(row => row.method === 'session/create').params.mode).toBe('plan')
    expect(records.find(row => row.method === 'session/setMode').params.mode).toBe('plan')
  })
  it.each(['no-edit', 'wrong-edit'])('falls back to confirmed build before input on %s', async scenario => {
    const { result, records, frames } = await fixture(scenario, false, { access: 'workspace-write' })
    expect(result.status).toBe('SUCCESS')
    expect(records.filter(row => row.method === 'session/setMode').map(row => row.params.mode)).toEqual(['edit', 'build'])
    expect(frames.some(frame => frame.event?.text?.includes('本轮按询问运行'))).toBe(true)
    expect(records.filter(row => row.method === 'session/send')).toHaveLength(1)
  })
  it('falls back from unavailable yolo to confirmed edit', async () => {
    const { result, records, frames } = await fixture('no-yolo', false, { access: 'danger-full-access' })
    expect(result.status).toBe('SUCCESS')
    expect(records.filter(row => row.method === 'session/setMode').map(row => row.params.mode)).toEqual(['yolo', 'edit'])
    expect(frames.some(frame => frame.event?.text?.includes('本轮按仅工作区编辑运行'))).toBe(true)
  })
  it('confirms build on resumed sessions and refuses final mode drift without retrying input', async () => {
    const resumed = await fixture('success', true, { access: 'read-only' })
    expect(resumed.result.status).toBe('SUCCESS')
    expect(resumed.records.find(row => row.method === 'session/setMode').params.mode).toBe('build')
    const drifted = await fixture('mode-drift-final', false, { access: 'read-only' })
    expect(drifted.result.status).toBe('ERROR')
    expect(drifted.records.filter(row => row.method === 'session/send')).toHaveLength(1)
    expect(drifted.records.filter(row => row.method === 'session/setMode')).toHaveLength(1)
  })
  it.each(['no-modes', 'wrong-mode'])('rejects unavailable or unconfirmed build on %s without input', async scenario => {
    const { result, records } = await fixture(scenario, false, { access: 'read-only' })
    expect(result.status).toBe('ERROR')
    expect(records.some(row => row.method === 'session/send')).toBe(false)
  })
  it('denies additional permissions and reports a natively completed turn as completed, without a notice', async () => {
    const { result, records, frames } = await fixture('permission')
    expect(result).toMatchObject({ status: 'SUCCESS', response: 'HELLO' })
    expect(result).not.toHaveProperty('error')
    expect(result).not.toHaveProperty('notice')
    expect(records.find((record) => record.id === 'permission').result.decision).toBe('deny')
    // The denied call is closed by its batch, so it does not stay running in the timeline.
    expect(frames.filter((frame) => frame.event?.toolCall?.callId === 'denied-tool').at(-1)?.event.state).toBe('FAILED')
  })
  it('completes a denied turn without a notice when another tool in the batch fails besides the denied one', async () => {
    const { result } = await fixture('permission-other-failure')
    expect(result).toMatchObject({ status: 'SUCCESS' })
    expect(result).not.toHaveProperty('notice')
  })
  it('counts a failed call once when its batch reports it again, and succeeds after the CLI carries on', async () => {
    const { result, frames } = await fixture('tool-recovered')
    expect(result).toMatchObject({ status: 'SUCCESS', notice: '本轮有 1 个工具步骤失败，CLI 已自行处理' })
    expect(frames.some((frame) => frame.event?.kind === 'tool' && frame.event.state === 'FAILED')).toBe(true)
  })
  it.each(['tool-failure', 'batch-failure'])('reports a turn that ends right after a failed tool (%s) as unverified', async (scenario) => {
    const { result } = await fixture(scenario)
    expect(result).toMatchObject({ status: 'UNCERTAIN', error: '本轮最后的工具步骤失败后 CLI 直接结束；结果待核实，请先核查实际产物，不要自动重试' })
  })
  it('keeps an error when the turn fails after a denied permission', async () => {
    const { result, records } = await fixture('permission-failed')
    expect(result.status).toBe('ERROR')
    expect(records.find((record) => record.id === 'permission').result.decision).toBe('deny')
  })
  it('does not interpret send admission/state updates as a missing turn result', async () => {
    const { result } = await fixture('missing-terminal')
    expect(result).toMatchObject({ status: 'ERROR', response: 'HELLO' })
  })
  it('rejects a still-active final snapshot', async () => {
    expect((await fixture('active-final')).result.status).toBe('ERROR')
  })
  it('sends session/stop during fixture output and waits for the terminal path', async () => {
    const { result, records } = await fixture('cancel')
    expect(result).toMatchObject({ status: 'ERROR', response: 'HELLO' })
    expect(records.some((record) => record.method === 'session/stop')).toBe(true)
  })
  it('rejects an observed model switch and attempts native stop', async () => {
    const { result, records } = await fixture('changed-model')
    expect(result.status).toBe('ERROR')
    expect(records.some((record) => record.method === 'session/stop')).toBe(true)
  })
  it.each(['account-success', 'account-env'])(
    'initializes only the bound native account and replies without credential telemetry (%s)',
    async (scenario) => {
      const { frames, records, result } = await fixture(scenario)
      expect(result.status).toBe('SUCCESS')
      expect(
        records.find((record) => record.method === 'provider/updateAccountConfig').params.providers,
      ).toEqual({ chosen: { access: { type: 'zhipu-account', entitled: true } } })
      expect(records.find((record) => record.id === 'headers')).toMatchObject({
        headersApplied: true,
        headerAccepted: true,
      })
      expect(records[0].leakedAccountEnvironment).toBe(false)
      expect(JSON.stringify(frames)).not.toContain('SYNTHETIC_ACCOUNT_KEY')
      expect(JSON.stringify(records)).not.toContain('SYNTHETIC_ACCOUNT_KEY')
    },
  )
  it.each(['provider', 'model', 'session', 'workspace', 'access', 'reason'])(
    'denies a native account header request outside the selected %s',
    async (boundary) => {
      const { records, result } = await fixture(`account-${boundary}`)
      expect(result.status).toBe('ERROR')
      expect(records.find((record) => record.id === 'headers')).toMatchObject({
        headersApplied: false,
        headerAccepted: false,
      })
    },
  )
  it('denies an account whose current identity changed after session setup', async () => {
    const { records, result } = await fixture('account-rotated')
    expect(result.status).toBe('ERROR')
    expect(records.find((record) => record.id === 'headers')).toMatchObject({ headersApplied: false })
  })
  it('rejects an expired native account bundle before creating or prompting a session', async () => {
    const { records, result } = await fixture('account-expired')
    expect(result.status).toBe('ERROR')
    expect(records.some((record) => record.method === 'session/create')).toBe(false)
    expect(records.some((record) => record.method === 'session/send')).toBe(false)
  })
})
