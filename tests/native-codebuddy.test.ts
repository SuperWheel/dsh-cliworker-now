import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeIO } from '../src/host/native-transport.mjs'
import { runNativeAcp } from '../src/host/native-acp.mjs'
import { codebuddyAcpArgv, codebuddyModeFor, codebuddyFallbackModes, codebuddyVerifyInitialize,
  codebuddySessionOption, codebuddyRunnerSettings, runNativeCodebuddy } from '../src/host/native-codebuddy.mjs'
import { workerArguments } from '../src/host/adapters.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
// 模拟 CodeBuddy 2.181.0 stdio peer. No installation, credential or network access.
const source = String.raw`
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const scenario=process.env.SCENARIO;
const log=value=>appendFileSync(process.env.AUDIT,JSON.stringify(value)+'\n',{mode:0o600});
const out=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
const reply=(q,result)=>out({id:q.id,result});
const sessionId='codebuddy-simulated-session';
const modes=['default','auto','bypassPermissions','plan'].filter(id=>scenario!=='missing-'+id);
const state={sessionId,modes:{currentModeId:'default',availableModes:modes.map(id=>({id}))},configOptions:[
 {id:'model',currentValue:'before',options:[{value:'before'},{value:'hy4free'}]},
 {id:'thought_level',currentValue:'high',options:[{value:'high'},{value:'enabled'}]},
 {id:'mode',currentValue:'before',options:modes.map(value=>({value}))}]};
const update=value=>out({method:'session/update',params:{sessionId,update:value}});
const text=value=>update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:value}});
const tool=(value={})=>update({sessionUpdate:'tool_call',toolCallId:'cmd',title:'Bash',kind:'other',status:'in_progress',_meta:{'codebuddy.ai/toolName':'Bash'},...value});
let pending;
log({fixture:'模拟 CodeBuddy',pid:process.pid,env:process.env.DISABLE_AUTOUPDATER,argv:process.argv.slice(2)});
createInterface({input:process.stdin}).on('line',line=>{
 const q=JSON.parse(line);log(q);
 if(!q.method){
  if(q.id==='sensitive'){text('DONE');reply(pending,{stopReason:'end_turn'});return;}
  if(q.id==='permission'){
   const rejected=q.result?.outcome?.optionId==='reject';
   if(!rejected)update({sessionUpdate:'tool_call_update',toolCallId:'cmd',status:'completed',rawOutput:'ok'});
   if(scenario==='deny-recover'){update({sessionUpdate:'tool_call_update',toolCallId:'cmd',status:'failed'});text('RECOVERED');reply(pending,{stopReason:'end_turn'});}
   else reply(pending,{stopReason:rejected?'cancelled':'end_turn',_meta:{'codebuddy.ai/outcome':rejected?'PERMISSION_DENIED':'SUCCESS'}});
  }
  return;
 }
 if(q.method==='initialize')return reply(q,{protocolVersion:scenario==='bad-version'?2:1,
  authMethods:scenario==='bad-identity'?[]:[{id:'internal'},{id:'external'}],agentCapabilities:{loadSession:true}});
 if(q.method==='session/new'||q.method==='session/load'){
  if(scenario==='load-error')return out({id:q.id,error:{code:-32603,message:'模拟 load failure'}});
  if(q.method==='session/load'){text('OLD HISTORY');tool({toolCallId:'old',status:'pending'});}
  return reply(q,state);
 }
 if(q.method==='session/set_config_option'){
  const {configId,value}=q.params;
  state.configOptions.find(x=>x.id===configId).currentValue=scenario==='unconfirmed-'+configId?'wrong':value;
  return reply(q,{configOptions:state.configOptions});
 }
 if(q.method==='session/prompt'){
  pending=q;
  text('HELLO');
  if(scenario==='cancel')return;
  if(scenario==='cancelled')return reply(q,{stopReason:'cancelled',_meta:{'codebuddy.ai/outcome':'PERMISSION_DENIED'}});
  if(scenario==='changed-mode')return update({sessionUpdate:'current_mode_update',currentModeId:'fullAccess'});
  if(scenario==='unknown')return out({id:'sensitive',method:'_codebuddy.ai/requestSensitiveApproval',params:{sessionId}});
  if(scenario==='streaming'){
   update({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'公开思考（模拟）'}});
   tool({rawInput:{}});
   update({sessionUpdate:'tool_call_update',toolCallId:'cmd',rawInput:{command:'echo probe'}});
   tool({title:'Run probe',kind:'execute',status:'pending',rawInput:{command:'echo probe'}});
   update({sessionUpdate:'tool_call_update',toolCallId:'cmd',status:'completed',rawOutput:'probe',_meta:{'codebuddy.ai/toolName':'Bash'}});
   text('AFTER');
  }
  if(scenario==='missing-terminal')tool();
  if(scenario.startsWith('permission')||scenario==='deny-recover'){
   tool();
   tool({title:'\x60echo probe-cmd > cmd.txt\x60',kind:'execute',locations:[{path:'cmd.txt'}],status:'pending'});
   update({sessionUpdate:'tool_call_update',toolCallId:'cmd',rawInput:{command:'echo probe-cmd > cmd.txt'}});
   return out({id:'permission',method:'session/request_permission',params:{sessionId,
    toolCall:{toolCallId:scenario==='permission-unmatched'?'other':'cmd',rawInput:{command:'echo probe-cmd > cmd.txt'},
      ...(scenario==='permission-override'?{title:'Explicit title',kind:'edit',locations:[]}:{}),_meta:{'codebuddy.ai/toolName':'Bash'}},
    options:[{kind:'allow_always',optionId:'allow_always'},{kind:'allow_once',optionId:'allow'},{kind:'reject_once',optionId:'reject'}]}});
  }
  return reply(q,{stopReason:'end_turn'});
 }
 if(q.method==='session/cancel'&&pending)reply(pending,{stopReason:'cancelled',_meta:{'codebuddy.ai/outcome':'CANCELLED'}});
});
`
async function fixture(scenario = 'success', options: { access?: string; mode?: string; effort?: string; continuation?: boolean;
  decision?: string; source?: string; legacy?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'codebuddy-acp-simulated-')); roots.push(root)
  const script = join(root, 'simulated-codebuddy.mjs'), audit = join(root, 'audit.ndjson')
  await writeFile(script, source, { mode: 0o600 })
  const config = { cli: 'codebuddy', project: root, stateDirectory: root, prompt: '模拟请求', mode: options.mode ?? 'accept-edits',
    preference: { model: 'hy4free', effort: options.effort ?? 'default' }, access: options.access ?? 'read-only',
    argv: [process.execPath, script, '--acp'], env: { SCENARIO: scenario, AUDIT: audit, DISABLE_AUTOUPDATER: '0' },
    timeoutMs: 2000, maxLineBytes: 1024 * 1024, maxRunBytes: 8 * 1024 * 1024,
    ...(options.continuation ? { conversationId: 'codebuddy-simulated-session' } : {}),
    approvalNonce: 'simulated-nonce' }
  const controller = new AbortController(), frames: any[] = []
  const io: any = createNativeIO(config, (line: string) => {
    const frame = JSON.parse(line); frames.push(frame)
    if (frame.type === 'approval') setTimeout(() => void io.answerApproval(JSON.stringify({ decision: options.decision ?? 'deny', source: options.source ?? 'user' }), frame.id), 1)
    if (scenario === 'cancel' && frame.event?.kind === 'assistant') controller.abort(new Error('模拟用户停止'))
  }, controller.signal)
  let error
  try {
    if (options.legacy) {
      const settings = codebuddyRunnerSettings(config)
      delete settings.deniedCancelEndsTurn; delete settings.defaultEffort; delete settings.approvalFromToolCall; delete settings.verifyInitialize
      await runNativeAcp(config, io, settings)
    } else await runNativeCodebuddy(config, io)
  } catch (value) { error = value }
  await io.close(error)
  const records = (await readFile(audit, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  const pid = records[0].pid
  expect(() => process.kill(pid, 0)).toThrow()
  return { frames, records, result: frames.at(-1) }
}
const methods = (records: any[], method: string) => records.filter(record => record.method === method)
describe('CodeBuddy ACP（模拟）', () => {
  it('checks the native initialize identity without requiring agentInfo', () => {
    expect(codebuddyVerifyInitialize({ protocolVersion: 1, authMethods: [{ id: 'internal' }, { id: 'external' }] })).toBeUndefined()
    expect(codebuddyVerifyInitialize({ protocolVersion: 1 })).toContain('身份不匹配')
    expect(codebuddySessionOption([{ kind: 'allow_always', optionId: 'persistent' }])).toBeUndefined()
  })
  it.each(['bad-version', 'bad-identity'])('refuses %s before session creation', async scenario => {
    const { records, result } = await fixture(scenario)
    expect(result.status).toBe('ERROR'); expect(JSON.stringify(result)).toContain('身份不匹配')
    expect(methods(records, 'session/new')).toEqual([])
  })
  it('selects and confirms model, default effort and mode before prompt and disables updater', async () => {
    const { records, result } = await fixture()
    expect(result.status).toBe('SUCCESS'); expect(records[0].env).toBe('1')
    expect(methods(records, 'session/set_config_option').map(q => [q.params.configId, q.params.value])).toEqual([
      ['model', 'hy4free'], ['thought_level', 'enabled'], ['mode', 'default'],
    ])
    expect(records.findIndex(q => q.method === 'session/prompt')).toBeGreaterThan(records.findLastIndex(q => q.method === 'session/set_config_option'))
    const argv = workerArguments('/simulated/codebuddy', '/project', { cli: 'codebuddy', model: 'hy4free', effort: 'default' }, 'plan', '模拟', 1000, undefined, true, 'read-only')
    expect(argv).toEqual(['/simulated/codebuddy', '--acp']); expect(codebuddyAcpArgv({ argv })).toEqual(argv)
    expect(() => workerArguments('/simulated', '/', { cli: 'codebuddy', model: 'hy4free', effort: 'default' }, 'accept-edits', '', 1000)).toThrow('原生 ACP')
  })
  it.each([['read-only', 'default'], ['workspace-write', 'auto'], ['danger-full-access', 'bypassPermissions']])('maps %s to %s and supports plan', async (access, mode) => {
    expect(codebuddyModeFor(access)).toBe(mode)
    expect(codebuddyFallbackModes(access)).toEqual(access === 'read-only' ? [] : access === 'workspace-write' ? ['default'] : ['auto', 'default'])
    for (const planning of [false, true]) {
      const { records, result } = await fixture('success', { access, mode: planning ? 'plan' : 'accept-edits' })
      expect(result.status).toBe('SUCCESS')
      expect(methods(records, 'session/set_config_option').at(-1).params.value).toBe(planning ? 'plan' : mode)
    }
  })
  it('falls back from missing auto and reports 按询问运行', async () => {
    const { records, frames, result } = await fixture('missing-auto', { access: 'workspace-write' })
    expect(result.status).toBe('SUCCESS')
    expect(methods(records, 'session/set_config_option').at(-1).params.value).toBe('default')
    expect(JSON.stringify(frames)).toContain('按询问运行')
  })
  it.each(['missing-plan', 'unconfirmed-model', 'unconfirmed-thought_level'])('refuses %s without prompt', async scenario => {
    const { records, result } = await fixture(scenario, { mode: scenario === 'missing-plan' ? 'plan' : 'accept-edits' })
    expect(result.status).toBe('ERROR'); expect(methods(records, 'session/prompt')).toEqual([])
  })
  it('streams text, thought, repeated tool snapshots and terminal output', async () => {
    const { frames, result } = await fixture('streaming')
    expect(result.status).toBe('SUCCESS'); expect(result.response).toBe('HELLOAFTER')
    expect(frames.some(f => f.event?.kind === 'reasoning' && f.event.state === 'COMPLETED')).toBe(true)
    const events = frames.filter(f => f.event?.kind === 'tool').map(f => f.event)
    expect(new Set(events.map(e => e.toolCall.callId))).toEqual(new Set(['cmd']))
    expect(events.at(-1)).toMatchObject({ state: 'COMPLETED', toolCall: { name: 'Bash', output: 'probe' } })
  })
  it.each([['allow-once', 'allow'], ['allow-session', 'allow_always'], ['deny', 'reject']])('relays %s with matched tool title and no duplicate detail', async (decision, optionId) => {
    const { frames, records, result } = await fixture('permission', { decision })
    const approval = frames.find(f => f.type === 'approval')
    expect(JSON.stringify(approval)).toContain('`echo probe-cmd > cmd.txt`')
    expect(approval.request ?? approval).toMatchObject({ kind: 'command' })
    expect(approval.request ?? approval).not.toHaveProperty('detail')
    expect(records.find(q => q.id === 'permission')?.result.outcome.optionId).toBe(optionId)
    if (decision === 'deny') {
      expect(result).toMatchObject({ status: 'SUCCESS', notice: '因拒绝审批而结束：被拒操作未执行，可续聊继续' })
      expect(JSON.stringify(result)).not.toContain('缺少终态')
      expect(frames.some(f => f.event?.state === 'FAILED' && f.event.toolCall?.output === '已拒绝')).toBe(true)
    } else expect(result.status).toBe('SUCCESS')
  })
  it.each(['permission-unmatched', 'permission-override'])('never guesses metadata and respects request fields (%s)', async scenario => {
    const { frames } = await fixture(scenario)
    const approval = frames.find(f => f.type === 'approval')
    expect(approval.request ?? approval).toMatchObject(scenario === 'permission-unmatched'
      ? { summary: '工具调用', kind: 'tool', detail: 'echo probe-cmd > cmd.txt' }
      : { summary: 'Explicit title', kind: 'file' })
  })
  it('keeps preset and plan denials distinct from user cancellation', async () => {
    const { result } = await fixture('permission', { mode: 'plan', source: 'plan', decision: 'deny' })
    expect(result).toMatchObject({ status: 'SUCCESS', notice: '因拒绝审批而结束：被拒操作未执行，可续聊继续' })
  })
  it.each(['cancel', 'cancelled'])('does not classify %s as a denied turn', async scenario => {
    const { records, result } = await fixture(scenario)
    expect(result.status).toBe('ERROR'); expect(JSON.stringify(result)).not.toContain('因拒绝审批而结束')
    if (scenario === 'cancel') expect(methods(records, 'session/cancel')).toHaveLength(1)
    else expect(JSON.stringify(result)).toContain('CLI 未成功完成')
  })
  it('loads the same session, ignores replay, and resets default effort', async () => {
    const { records, result } = await fixture('success', { continuation: true })
    expect(result.status).toBe('SUCCESS'); expect(result.response).toBe('HELLO')
    expect(methods(records, 'session/load')).toHaveLength(1); expect(methods(records, 'session/new')).toEqual([])
    expect(methods(records, 'session/set_config_option').find(q => q.params.configId === 'thought_level')?.params.value).toBe('enabled')
  })
  it('never replaces a failed load with a new session', async () => {
    const { records, result } = await fixture('load-error', { continuation: true })
    expect(result.status).toBe('ERROR'); expect(methods(records, 'session/new')).toEqual([]); expect(methods(records, 'session/prompt')).toEqual([])
  })
  it('cancels on current_mode_update mismatch', async () => {
    const { records, result } = await fixture('changed-mode')
    expect(result.status).toBe('ERROR'); expect(JSON.stringify(result)).toContain('实际权限')
    expect(methods(records, 'session/cancel')).toHaveLength(1)
  })
  it('rejects private requests with -32601', async () => {
    const { records, result } = await fixture('unknown')
    expect(result.status).toBe('SUCCESS'); expect(records.find(q => q.id === 'sensitive')?.error.code).toBe(-32601)
  })
  it('rejects nonterminal tools without a permission denial', async () => {
    const { result } = await fixture('missing-terminal')
    expect(result.status).toBe('ERROR'); expect(JSON.stringify(result)).toContain('缺少终态')
  })
  it('preserves original ACP default-effort and denial behavior without opt-in settings', async () => {
    const failed = await fixture('permission', { legacy: true })
    expect(JSON.stringify(failed.result)).toContain('CLI 未成功完成')
    expect(JSON.stringify(failed.result)).not.toContain('因拒绝审批而结束')
    expect(methods(failed.records, 'session/set_config_option').some(q => q.params.configId === 'thought_level')).toBe(false)
    expect(failed.frames.some(f => f.event?.toolCall?.output === '已拒绝')).toBe(false)
    const recovered = await fixture('deny-recover', { legacy: true })
    expect(recovered.result.status).toBe('SUCCESS')
  })
})
