import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeIO } from '../../src/host/native-transport.mjs'
import { runNativeTraecn } from '../../src/host/native-traecn.mjs'

// 模拟 TRAE CLI 0.213.1 ACP peer. Only this Node fixture executes; no installed CLI, credentials or model.
const source = String.raw`
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const scenario=process.env.SCENARIO, sessionId='SIMULATED-trae-session';
const out=v=>process.stdout.write(JSON.stringify(v)+'\n');
const log=v=>appendFileSync(process.env.AUDIT,JSON.stringify(v)+'\n');
const reply=(r,result)=>out({jsonrpc:'2.0',id:r.id,result});
const error=(r)=>out({jsonrpc:'2.0',id:r.id,error:{code:-32603,message:'模拟 load failure'}});
const update=v=>out({jsonrpc:'2.0',method:'session/update',params:{sessionId,update:v}});
const text=t=>update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:t}});
const model={id:'model',type:'select',category:'model',currentValue:'before',options:[{value:'before'},{value:'SIMULATED-model'}]};
const mode={id:'mode',type:'select',category:'mode',currentValue:'default',options:['default','plan','auto','bypass_permissions'].map(value=>({value}))};
if(scenario==='model-missing')model.options=[{value:'before'}];
if(scenario==='fallback')mode.options=mode.options.filter(v=>v.value!=='bypass_permissions');
if(scenario==='default-missing')mode.options=mode.options.filter(v=>v.value!=='default');
// 0.213.1: a -c sandbox_mode launch advertises only the model option and no modes.
const sandboxed=process.argv.slice(2).includes('-c');
const state=sandboxed?{sessionId,configOptions:[model]}:{sessionId,configOptions:[model,mode],modes:{currentModeId:'default',availableModes:mode.options.map(v=>({id:v.value}))}};
let pending;
const finish=(r,stopReason='end_turn')=>reply(r,{stopReason,usage:scenario==='zero'||stopReason!=='end_turn'?{inputTokens:0,outputTokens:0,totalTokens:0}:{inputTokens:60,outputTokens:7,totalTokens:67,thoughtTokens:2,cachedReadTokens:20,cachedWriteTokens:3},_meta:{'_trae/tokenUsage':{contextWindow:{used:67,size:128000}}}});
log({fixture:'模拟',pid:process.pid,argv:process.argv.slice(2)});
process.on('exit',code=>log({exit:code}));
createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line);log(r);
 if(!r.method){
  const allow=r.result?.outcome?.optionId==='approved';
  update({sessionUpdate:'tool_call_update',toolCallId:'SIMULATED-write',status:allow?'completed':'failed'});
  if(scenario==='permission-other-failure')update({sessionUpdate:'tool_call',toolCallId:'SIMULATED-other-failure',title:'模拟其他失败',status:'failed'});
  if(scenario==='permission-pending')update({sessionUpdate:'tool_call',toolCallId:'SIMULATED-pending',title:'模拟未结束工具',status:'in_progress'});
  if(pending){finish(pending,allow?'end_turn':'cancelled');pending=undefined;}return;
 }
 if(r.method==='initialize')return reply(r,{protocolVersion:1,agentInfo:{name:scenario==='wrong-agent'?'other-cli':'traecli-acp'},agentCapabilities:{loadSession:true,promptCapabilities:{image:true},sessionCapabilities:{fork:{},close:{}}}});
 if(r.method==='session/new'||r.method==='session/load'){
  if(scenario==='load-error')return error(r);
  if(r.method==='session/load'){text('SIMULATED OLD HISTORY');update({sessionUpdate:'tool_call',toolCallId:'old',title:'模拟历史',status:'completed'});}
  return reply(r,state);
 }
 if(r.method==='session/set_config_option'){
  const option=r.params.configId==='model'?model:mode;option.currentValue=scenario==='unconfirmed-mode'&&option===mode?'auto':r.params.value;
  if(option===mode)update({sessionUpdate:'current_mode_update',currentModeId:option.currentValue});
  update({sessionUpdate:'config_option_update',configOptions:[option]});
  return reply(r,{configOptions:state.configOptions});
 }
 if(r.method==='session/prompt'){
  pending=r;
  if(scenario==='mode-mismatch'){update({sessionUpdate:'current_mode_update',currentModeId:'auto'});return;}
  if(scenario==='config-mode-mismatch'){update({sessionUpdate:'config_option_update',configOptions:[{id:'mode',currentValue:'auto'}]});return;}
  if(scenario==='cancel'){text('模拟等待');return;}
  if(scenario.startsWith('permission')){
   if(scenario==='permission-text')text('模拟拒绝前正文');
   update({sessionUpdate:'tool_call',toolCallId:'SIMULATED-write',title:'模拟写入工作区外文件',status:'pending',rawInput:{command:['/bin/zsh','-lc','SIMULATED command']},locations:[{path:'/SIMULATED/outside.txt'}]});
   return out({jsonrpc:'2.0',id:'SIMULATED-approval',method:'session/request_permission',params:{sessionId,toolCall:{toolCallId:'SIMULATED-write',title:'模拟写入工作区外文件',rawInput:{command:['/bin/zsh','-lc','SIMULATED command']},locations:[{path:'/SIMULATED/outside.txt'}]},options:[{optionId:'approved',kind:'allow_once'},{optionId:'abort',kind:'reject_once'}]}});
  }
  update({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'模拟公开思考'}});
  text('模拟新正文');finish(r);pending=undefined;return;
 }
 if(r.method==='session/cancel'){if(pending){finish(pending,'cancelled');pending=undefined;}return;}
 if(r.method==='session/fork')return reply(r,{sessionId:'SIMULATED-fork'});
 if(r.method==='session/close')return reply(r,{});
});
`
export async function traecnFixture(scenario: string, options: Record<string, any> = {}, runner = runNativeTraecn) {
  const root = await mkdtemp(join(tmpdir(), 'traecn-SIMULATED-'))
  const script = join(root, 'peer.mjs'), audit = join(root, 'audit.jsonl')
  await writeFile(script, source)
  const config = { cli: 'traecn', argv: [process.execPath, script], project: root, prompt: '模拟任务',
    preference: { cli: 'traecn', model: 'SIMULATED-model', effort: options.effort ?? 'default' },
    mode: options.mode ?? 'accept-edits', access: options.access ?? 'workspace-write',
    env: { SCENARIO: scenario, AUDIT: audit }, timeoutMs: 2000, maxLineBytes: 1048576, maxRunBytes: 8388608,
    approvalNonce: 'SIMULATED-nonce', ...(options.resume ? { conversationId: 'SIMULATED-trae-session' } : {}),
    ...(options.fork ? { forkOperation: 'fork', conversationId: 'SIMULATED-trae-session' } : {}) }
  const controller = new AbortController(), frames: any[] = []
  const io: any = createNativeIO(options.fork ? { ...config, conversationId: undefined } : config, (line: string) => {
    const frame = JSON.parse(line); frames.push(frame)
    if (frame.type === 'approval') {
      if (options.abortAtApproval) controller.abort(new Error('模拟用户停止'))
      else void io.answerApproval(JSON.stringify({ decision: options.decision ?? 'deny', source: options.source ?? 'user' }), frame.id)
    }
    if (scenario === 'cancel' && frame.event?.kind === 'assistant') controller.abort(new Error('模拟用户停止'))
  }, controller.signal)
  let caught
  try { await runner(config, io) } catch (error) { caught = error }
  await io.close(caught)
  const raw = await readFile(audit, 'utf8').catch(() => '')
  const records = raw.trim() ? raw.trim().split('\n').map(line => JSON.parse(line)) : []
  const pid = records[0]?.pid
  let exited = !pid
  if (pid) try { process.kill(pid, 0) } catch (error: any) { exited = error.code === 'ESRCH' }
  await rm(root, { recursive: true, force: true })
  return { config, records, frames, exited, result: frames.findLast(frame => frame.type === 'result') }
}
