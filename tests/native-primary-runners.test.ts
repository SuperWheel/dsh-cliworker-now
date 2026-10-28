import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createNativeIO } from '../src/host/native-transport.mjs'
import { nativeCodexArgv, runNativeCodex } from '../src/host/native-codex.mjs'
import { claudePermissionMode, nativeClaudeArgv, runNativeClaude } from '../src/host/native-claude.mjs'
import { nativeAgyArgv, runNativeAgy } from '../src/host/native-agy.mjs'
import { foldNativeFrames } from './fixtures/bridge-timeline.ts'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

// These executable fixtures simulate protocol transcripts. They never load a CLI account or a model.
const fixture = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const cli=process.env.CWN_NATIVE_FIXTURE_CLI, scenario=process.env.CWN_NATIVE_FIXTURE_SCENARIO;
const log=process.env.CWN_NATIVE_FIXTURE_LOG;
const id='synthetic-session', turn='synthetic-turn';
let waiting=false;
const toolFails=['tool-failure','tool-recovered','tool-failure-turn-failed','tool-failure-nonzero-exit'].includes(scenario);
const cancel=['cancel','tool-failure-cancel'].includes(scenario);
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
const note=(method,params)=>send({method,params});
const thread=()=>({thread:{id:scenario==='identity-mismatch'?'other-session':id},model:scenario==='model-mismatch'?'other-model':'synthetic-model',cwd:process.cwd(),approvalPolicy:'never',sandbox:{type:'workspaceWrite',networkAccess:false},reasoningEffort:'low'});
function codexEnd(status='completed'){
 note('turn/completed',{threadId:id,turn:{id:turn,status,items:[],error:status==='failed'?{message:'synthetic failure'}:null}});
}
function codexTurn(){
 note('turn/started',{threadId:id,turn:{id:turn,status:'inProgress',items:[]}});
 note('item/agentMessage/delta',{threadId:'other-session',turnId:turn,itemId:'other',delta:'MUST NOT APPEAR'});
 note('item/agentMessage/delta',{threadId:id,turnId:'old-turn',itemId:'old',delta:'MUST NOT APPEAR'});
 if(scenario.startsWith('deny')||scenario==='tier-ask'){
  const method=scenario==='deny-file'?'item/fileChange/requestApproval':scenario==='deny-permissions'?'item/permissions/requestApproval':'item/commandExecution/requestApproval';
  send({id:'synthetic-approval',method,params:{threadId:id,turnId:turn,itemId:'command'}});return;
 }
 if(['user-input','unknown-request'].includes(scenario)){send({id:'synthetic-interaction',method:scenario==='user-input'?'item/tool/requestUserInput':'synthetic/unknownRequest',params:{threadId:id,turnId:turn}});return;}
 if(scenario==='tool-failure-cancel')note('item/completed',{threadId:id,turnId:turn,item:{id:'tool',type:'commandExecution',command:'synthetic read',status:'failed',exitCode:1}});
 if(cancel){note('item/agentMessage/delta',{threadId:id,turnId:turn,itemId:'reply',delta:'运行中'});waiting=true;return;}
 if(scenario.startsWith('steer-')){note('item/agentMessage/delta',{threadId:id,turnId:turn,itemId:'reply',delta:'运行中'});return;}
 for(const delta of scenario==='fragmented'?['合','成']:['合成'])note('item/agentMessage/delta',{threadId:id,turnId:turn,itemId:'reply',delta});
 note('item/completed',{threadId:id,turnId:turn,item:{id:'reply',type:'agentMessage',text:'合成回复'}});
 note('item/reasoning/summaryTextDelta',{threadId:id,turnId:turn,itemId:'reason',summaryIndex:0,delta:'公开摘要'});
 note('item/completed',{threadId:id,turnId:turn,item:{id:'reply',type:'agentMessage',text:'合成回复'}});
 note('item/completed',{threadId:id,turnId:turn,item:{id:'reason',type:'reasoning',summary:['公开摘要'],content:['HIDDEN RAW REASONING']}});
 note('item/started',{threadId:id,turnId:turn,item:{id:'tool',type:'commandExecution',command:'synthetic read',status:'inProgress'}});
 if(scenario==='tool-progress'){
  note('item/commandExecution/outputDelta',{threadId:'other-session',turnId:turn,itemId:'tool',delta:'FOREIGN TOOL OUTPUT'});
  note('item/commandExecution/outputDelta',{threadId:id,turnId:turn,itemId:'tool',delta:'模拟'});
  note('item/commandExecution/outputDelta',{threadId:id,turnId:turn,itemId:'tool',delta:'输出'});
 }
 if(scenario!=='unfinished-tool')note('item/completed',{threadId:id,turnId:turn,item:{id:'tool',type:'commandExecution',command:'synthetic read',status:toolFails?'failed':'completed',exitCode:toolFails?1:0}});
 if(scenario==='tool-recovered'){
  note('item/completed',{threadId:id,turnId:turn,item:{id:'retry',type:'commandExecution',command:'synthetic write',status:'completed',exitCode:0}});
  note('item/completed',{threadId:id,turnId:turn,item:{id:'after',type:'agentMessage',text:'模拟恢复后的回复'}});
 }
 if(scenario==='tool-progress'){
  note('item/commandExecution/outputDelta',{threadId:id,turnId:turn,itemId:'tool',delta:'LATE TOOL OUTPUT'});
  note('item/started',{threadId:id,turnId:turn,item:{id:'mcp',type:'mcpToolCall',tool:'synthetic',status:'inProgress',arguments:{}}});
  note('item/mcpToolCall/progress',{threadId:id,turnId:turn,itemId:'mcp',message:'模拟 MCP 进度'});
  note('item/completed',{threadId:id,turnId:turn,item:{id:'mcp',type:'mcpToolCall',tool:'synthetic',status:'completed',result:{content:[]}}});
  note('item/completed',{threadId:id,turnId:turn,item:{id:'dynamic',type:'dynamicToolCall',tool:'synthetic',status:'completed',success:true,contentItems:[{type:'inputText',text:'模拟动态工具结果'}]}});
 }
 if(scenario==='collab-interrupted')note('item/completed',{threadId:id,turnId:turn,item:{id:'collab',type:'collabAgentToolCall',tool:'wait',status:'interrupted',agentsStates:{},receiverThreadIds:[],senderThreadId:id}});
 if(scenario.startsWith('image-')){
  note('item/started',{threadId:id,turnId:turn,item:{id:'image',type:'imageGeneration',status:'inProgress',result:''}});
  if(scenario!=='image-unfinished')note('item/completed',{threadId:id,turnId:turn,item:{id:'image',type:'imageGeneration',status:scenario==='image-in-progress'?'inProgress':scenario==='image-failed'?'failed':'completed',result:'',failure:scenario==='image-failure-receipt'?{type:'usageLimitExceeded',limitId:'synthetic-limit',resetsAt:null}:null}});
 }
 note('thread/tokenUsage/updated',{threadId:id,turnId:turn,tokenUsage:{last:{inputTokens:2,outputTokens:1,totalTokens:3,cachedInputTokens:0},total:{inputTokens:20,outputTokens:10,totalTokens:30,cachedInputTokens:4},modelContextWindow:1000}});
 if(scenario==='no-terminal')return;
 codexEnd(['failure','tool-failure-turn-failed'].includes(scenario)?'failed':'completed');
 if(scenario==='duplicate-terminal')codexEnd();
}
function claudeEnd(error=false){send({type:'result',subtype:'success',session_id:id,is_error:error,result:error?'synthetic failure':'合成回复',permission_denials:scenario==='deny'?[{tool_name:'Bash'}]:[],usage:{input_tokens:2,output_tokens:1}});}
function claudeTurn(){
 const selected=process.argv[process.argv.indexOf('--model')+1];
 const canonical=['claude-alias','claude-proxy','claude-unknown-alias'].includes(scenario)?'synthetic-resolved-model':selected;
 send({type:'system',subtype:'init',session_id:scenario==='identity-mismatch'?'other-session':id,model:scenario==='model-mismatch'?'other-model':canonical});
 if(scenario==='identity-mismatch')return;
 if(scenario==='deny'){send({type:'control_request',request_id:'synthetic-permission',request:{subtype:'can_use_tool',tool_name:'Bash',input:{command:'synthetic'}}});return;}
 if(scenario==='ask'){send({type:'control_request',request_id:'synthetic-permission',request:{subtype:'can_use_tool',tool_name:'Bash',input:{command:'synthetic'},tool_use_id:'tool',permission_suggestions:[{type:'addRules',rules:[{toolName:'Bash',ruleContent:'synthetic'}],behavior:'allow',destination:'localSettings'}]}});return;}
 if(scenario==='child-model')send({type:'assistant',session_id:id,parent_tool_use_id:'synthetic-task',message:{id:'child',model:'synthetic-child-model',content:[{type:'text',text:'子任务公开进度'}]}});
 if(scenario==='tool-failure-cancel'){
  send({type:'assistant',session_id:id,message:{id:'toolmsg',content:[{type:'tool_use',id:'tool',name:'Read',input:{file_path:'synthetic'}}]}});
  send({type:'user',session_id:id,message:{content:[{type:'tool_result',tool_use_id:'tool',content:'synthetic error',is_error:true}]}});
 }
 send({type:'stream_event',session_id:id,event:{type:'message_start',message:{id:'reply'}}});
 if(scenario==='multiple-blocks'){
  send({type:'stream_event',session_id:id,event:{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'',signature:'HIDDEN_SIGNATURE'}}});
  send({type:'stream_event',session_id:id,event:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'公开思考'}}});
  send({type:'stream_event',session_id:id,event:{type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'HIDDEN_SIGNATURE'}}});
  send({type:'assistant',session_id:id,message:{id:'reply',content:[{type:'thinking',thinking:'公开思考',signature:'HIDDEN_SIGNATURE'}]}});
  send({type:'stream_event',session_id:id,event:{type:'content_block_stop',index:0}});
  send({type:'stream_event',session_id:id,event:{type:'content_block_start',index:1,content_block:{type:'text'}}});
  send({type:'stream_event',session_id:id,event:{type:'content_block_delta',index:1,delta:{type:'text_delta',text:'合成'}}});
  send({type:'assistant',session_id:id,message:{id:'reply',content:[{type:'text',text:'合成'}]}});
  send({type:'stream_event',session_id:id,event:{type:'content_block_stop',index:1}});
  send({type:'stream_event',session_id:id,event:{type:'content_block_start',index:2,content_block:{type:'text'}}});
  send({type:'stream_event',session_id:id,event:{type:'content_block_delta',index:2,delta:{type:'text_delta',text:'回复'}}});
  send({type:'assistant',session_id:id,message:{id:'reply',content:[{type:'text',text:'回复'}]}});
  send({type:'stream_event',session_id:id,event:{type:'content_block_stop',index:2}});
  claudeEnd();return;
 }
 send({type:'stream_event',session_id:id,event:{type:'content_block_start',index:0,content_block:{type:'text'}}});
 for(const text of scenario==='fragmented'?['合','成']:[cancel?'运行中':'合成'])send({type:'stream_event',session_id:id,event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text}}});
 if(cancel){waiting=true;return;}
 send({type:'assistant',session_id:id,message:{id:'reply',model:scenario==='assistant-model-mismatch'?'other-model':canonical,content:[{type:'text',text:'合成回复'},{type:'thinking',thinking:'公开思考'}]}});
 if(toolFails||scenario==='unfinished-tool'){
  send({type:'assistant',session_id:id,message:{id:'toolmsg',content:[{type:'tool_use',id:'tool',name:'Read',input:{file_path:'synthetic'}}]}});
  if(scenario!=='unfinished-tool')send({type:'user',session_id:id,message:{content:[{type:'tool_result',tool_use_id:'tool',content:'synthetic error',is_error:true}]}});
 }
 if(scenario==='tool-recovered'){
  send({type:'assistant',session_id:id,message:{id:'retrymsg',content:[{type:'tool_use',id:'retry',name:'Write',input:{file_path:'synthetic'}}]}});
  send({type:'user',session_id:id,message:{content:[{type:'tool_result',tool_use_id:'retry',content:'synthetic written'}]}});
  send({type:'assistant',session_id:id,message:{id:'after',content:[{type:'text',text:'模拟恢复后的回复'}]}});
 }
 if(scenario==='no-terminal')return;
 claudeEnd(['failure','tool-failure-turn-failed'].includes(scenario));
 if(scenario==='duplicate-terminal')claudeEnd();
}
function agyEnd(status='SUCCESS'){
 send({event:'result',result:{conversation_id:id,status,response:status==='ERROR'?'历史汇总文本':'合成回复',error:status==='ERROR'?'synthetic summary failure':undefined,usage:{input_tokens:2,output_tokens:1}}});
}
function agyTurn(){
 send({event:'init',conversation_id:scenario==='identity-mismatch'?'other-session':id,init:{model:scenario==='model-mismatch'?'other-model':'synthetic-model'}});
 if(scenario==='identity-mismatch')return;
 if(scenario==='tool-failure-cancel')send({event:'step_update',step_update:{conversation_id:id,step_index:0,step_type:'tool',state:'DONE',tool_name:'Read',tool_info:{name:'Read',error:{type:'SyntheticToolError',message:'synthetic read failure'}}}});
 if(cancel){send({event:'step_update',step_update:{conversation_id:id,step_index:1,step_type:'agent_response',state:'RUNNING',text_delta:'运行中'}});waiting=true;return;}
 if(scenario==='tool-error-state')send({event:'step_update',step_update:{conversation_id:id,step_index:0,step_type:'tool',state:'ERROR',tool_name:'Read'}});
 if(scenario==='unfinished-tool')send({event:'step_update',step_update:{conversation_id:id,step_index:0,step_type:'tool',state:'RUNNING',tool_name:'Read'}});
 if(scenario==='user-input')send({event:'step_update',step_update:{conversation_id:id,step_index:0,step_type:'user_input',state:'DONE'}});
 if(['metadata','metadata-conflict','unknown','unknown-conflict'].includes(scenario)){
  send({event:'step_update',step_update:{conversation_id:id,step_index:0,step_type:'user_input',state:'DONE'}});
  send({event:'step_update',step_update:{conversation_id:id,step_index:2,step_type:scenario.startsWith('unknown')?'unknown':'checkpoint',state:'DONE'}});
 }
 if(scenario==='tool-info-error')send({event:'step_update',step_update:{conversation_id:id,step_index:0,step_type:'tool',state:'DONE',tool_name:'Read',tool_info:{name:'Read',error:{type:'SyntheticToolError',message:'explicit synthetic failure'}}}});
 if(scenario==='invalid-step-state')send({event:'step_update',step_update:{conversation_id:id,step_index:0,step_type:'checkpoint',state:'NOT_A_NATIVE_STATE'}});
 const chunks=scenario==='fragmented'?['合','成','回','复']:['合成回复'];chunks.forEach((text_delta,index)=>send({event:'step_update',step_update:{conversation_id:id,step_index:1,step_type:'agent_response',state:index===chunks.length-1?'DONE':'RUNNING',text_delta,...(scenario==='response-usage'?{usage:{input_tokens:100,output_tokens:20,cache_read_tokens:300,total_tokens:120,thinking_tokens:0}}:{})}}));
 if(toolFails)send({event:'step_update',step_update:{conversation_id:id,step_index:3,step_type:'tool',state:'DONE',tool_name:'Write',tool_info:{name:'Write',error:{type:'SyntheticToolError',message:'synthetic write failure'}}}});
 if(scenario==='tool-recovered'){
  send({event:'step_update',step_update:{conversation_id:id,step_index:4,step_type:'tool',state:'DONE',tool_name:'Write',tool_info:{name:'Write'}}});
  send({event:'step_update',step_update:{conversation_id:id,step_index:5,step_type:'agent_response',state:'DONE',text_delta:'模拟恢复后的回复'}});
 }
 if(scenario==='no-terminal')return;
 agyEnd(['failure','tool-failure-turn-failed','summary-conflict','metadata-conflict','unknown-conflict'].includes(scenario)?'ERROR':'SUCCESS');
 if(scenario==='duplicate-terminal')agyEnd();
}
process.on('SIGINT',()=>{if(cli==='antigravity'&&waiting){waiting=false;agyEnd('INTERRUPTED');}});
const lines=createInterface({input:process.stdin});
lines.on('line',line=>{
 const value=JSON.parse(line);appendFileSync(log,line+'\\n');
 if(cli==='codex'){
  if(value.method==='initialize')send({id:value.id,result:{userAgent:'synthetic/0.162.1'}});
  else if(['thread/start','thread/resume'].includes(value.method))send({id:value.id,result:scenario.startsWith('tier')?{...thread(),approvalPolicy:value.params.approvalPolicy,sandbox:{type:{'read-only':'readOnly','workspace-write':'workspaceWrite','danger-full-access':'dangerFullAccess'}[value.params.sandbox],networkAccess:scenario==='tier-network'}}:thread()});
  else if(value.method==='turn/start'){send({id:value.id,result:{turn:{id:turn,status:'inProgress',items:[]}}});codexTurn();}
  else if(value.method==='turn/steer'){
   if(scenario==='steer-rejected')send({id:value.id,error:{code:-32600,message:'synthetic inactive turn'}});
   else if(scenario==='steer-unknown')send({id:value.id,error:{code:-32603,message:'synthetic uncertain failure'}});
   else if(scenario==='steer-terminal-first'){codexEnd();setTimeout(()=>send({id:value.id,result:{turnId:turn}}),30);return;}
   else if(scenario==='steer-coalesced'){process.stdout.write(JSON.stringify({id:value.id,result:{turnId:turn}})+'\\n'+JSON.stringify({method:'turn/completed',params:{threadId:id,turn:{id:turn,status:'completed',items:[],error:null}}})+'\\n');return;}
   else send({id:value.id,result:{turnId:scenario==='steer-wrong-turn'?'other-turn':turn}});
   setTimeout(()=>codexEnd(),30);
  }
  else if(['synthetic-approval','synthetic-interaction'].includes(value.id)){
   if(value.id==='synthetic-approval'&&scenario!=='deny-permissions')note('item/completed',{threadId:id,turnId:turn,item:{id:'command',type:scenario==='deny-file'?'fileChange':'commandExecution',...(value.result?.decision==='decline'?{status:'declined'}:{status:'completed',exitCode:0})}});
   note('item/completed',{threadId:id,turnId:turn,item:{id:'reply',type:'agentMessage',text:'合成回复'}});
   if(scenario==='deny-tool-failure')note('item/completed',{threadId:id,turnId:turn,item:{id:'tool',type:'commandExecution',status:'failed',exitCode:1}});
   codexEnd(scenario==='deny-failed'?'failed':scenario==='deny-interrupted'?'interrupted':'completed');
  }
  else if(value.method==='turn/interrupt'){send({id:value.id,result:{}});codexEnd('interrupted');}
 } else if(cli==='claude'){
  if(value.request?.subtype==='initialize'){
   const selected=process.argv[process.argv.indexOf('--model')+1];
   const models=['claude-proxy','claude-unknown-alias'].includes(scenario)?[{value:'unrelated-alias',resolvedModel:'unrelated-model'}]:[{value:selected,resolvedModel:scenario==='claude-alias'?'synthetic-resolved-model':selected,supportsEffort:true,supportedEffortLevels:scenario==='unsupported-effort'?['high']:['low']}];
   if(scenario==='ambiguous-alias')models.push({value:selected,resolvedModel:'other-model'});
   send({type:'control_response',response:{subtype:scenario==='init-rejected'?'error':'success',request_id:value.request_id,response:{models}}});
  }else if(value.request?.subtype==='get_context_usage'){
   if(scenario==='context-timeout')return;
   send({type:'control_response',response:{subtype:scenario==='context-unsupported'?'error':'success',request_id:value.request_id,response:{model:scenario==='context-other-model'?'wrong-model':'synthetic-model',totalTokens:17,maxTokens:128000,categories:[{name:'System prompt',tokens:7,kind:'used'},{name:'Messages',tokens:10,kind:'used'}],systemPromptSections:[{name:'PRIVATE_BODY_MUST_NOT_LEAK',text:'PRIVATE_BODY_MUST_NOT_LEAK'}]}}});
  }else if(value.type==='user')claudeTurn();
  else if(value.type==='control_response')claudeEnd();
  else if(value.request?.subtype==='interrupt'){send({type:'control_response',response:{subtype:'success',request_id:value.request_id,response:{}}});claudeEnd(true);}
 }else if(value.event==='user')agyTurn();
});
lines.on('close',()=>{process.exit(['nonzero-exit','deny-nonzero-exit','tool-failure-nonzero-exit'].includes(scenario)?7:0);});
`

function setup(cli: 'codex' | 'claude' | 'antigravity', scenario = 'success', resume = true) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'native-primary-synthetic-')))
  directories.push(directory)
  const executable = join(directory, 'synthetic-cli.mjs'), log = join(directory, 'messages.jsonl')
  writeFileSync(executable, fixture, { mode: 0o700 })
  const prompt = '保留字面文本 $(touch nope); `echo no`\n第二行'
  const config: any = {
    cli, project: directory, prompt, mode: 'accept-edits',
    preference: { model: 'synthetic-model', effort: 'low' },
    conversationId: resume ? 'synthetic-session' : undefined,
    env: { CWN_NATIVE_FIXTURE_CLI: cli, CWN_NATIVE_FIXTURE_SCENARIO: scenario, CWN_NATIVE_FIXTURE_LOG: log },
    timeoutMs: 3000, maxLineBytes: 65_536, maxRunBytes: 1_048_576, stateDirectory: directory,
  }
  const task = `任务：\n${prompt}`
  if (cli === 'codex') config.argv = [executable, 'exec', ...(resume ? ['resume', config.conversationId] : []), '--json', '--skip-git-repo-check', '--model', 'synthetic-model', '-c', 'sandbox_mode="workspace-write"', '-c', 'approval_policy="never"', task]
  else if (cli === 'claude') {
    if (['claude-proxy', 'claude-unknown-alias'].includes(scenario)) config.preference.effort = 'default'
    if (scenario === 'claude-proxy') config.claudeModelCandidates = [{ value: 'synthetic-model', resolvedModel: 'synthetic-resolved-model' }]
    config.argv = [executable, '--settings', join(directory, 'private-settings.json'), '--print', '--verbose', '--output-format', 'stream-json', '--model', 'synthetic-model', ...(config.preference.effort === 'default' ? [] : ['--effort', 'low']), '--permission-mode', 'acceptEdits', ...(resume ? ['--resume', config.conversationId] : []), task]
  }
  else config.argv = [executable, '--add-dir', directory, '--sandbox', '--dangerously-skip-permissions', '--mode', 'accept-edits', '--model', 'synthetic-model', '--effort', 'low', '--output-format', 'stream-json', '--print-timeout', '1s', ...(resume ? ['--conversation', config.conversationId] : []), '--print', task]
  return { config, log }
}

async function run(cli: 'codex' | 'claude' | 'antigravity', scenario = 'success', resume = true,
  guide?: (io: any, controller: AbortController) => Promise<void>) {
  const { config, log } = setup(cli, scenario, resume)
  const frames: any[] = [], controller = new AbortController()
  let guidance: Promise<void> | undefined
  const io = createNativeIO(config, (line: string) => {
    const frame = JSON.parse(line)
    frames.push(frame)
    if (['cancel', 'tool-failure-cancel'].includes(scenario) && frame.type === 'event' && frame.event.kind === 'assistant') controller.abort(new Error('synthetic stop'))
    if (guide && !guidance && frame.type === 'event' && frame.event.kind === 'assistant') {
      guidance = guide(io, controller)
      void guidance.catch(() => {})
    }
  }, controller.signal)
  const runner = { codex: runNativeCodex, claude: runNativeClaude, antigravity: runNativeAgy }[cli]
  let error
  try { await runner(config, io) } catch (caught) { error = caught }
  await io.close(error)
  await guidance
  const messages = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  return { config, frames, messages, result: frames.at(-1) }
}

describe('native primary runners (synthetic protocol processes, no real accounts/models)', () => {
  it.each([false, true])('requests public Codex summaries for resume=%s without changing the selected model or effort', async resume => {
    const { messages, frames, result } = await run('codex', 'success', resume)
    expect(result.status).toBe('SUCCESS')
    expect(messages.find(message => message.method === 'turn/start').params)
      .toMatchObject({ summary: 'auto', model: 'synthetic-model', effort: 'low', approvalPolicy: 'never' })
    expect(foldNativeFrames(frames).filter(row => row.kind === 'reasoning'))
      .toMatchObject([{ detail: '公开摘要' }])
    expect(JSON.stringify(frames)).not.toContain('HIDDEN RAW REASONING')
  })
  it.each(['codex', 'claude', 'antigravity'] as const)('%s preserves one message through tiny deltas and completion snapshots', async (cli) => {
    const { frames, result } = await run(cli, 'fragmented')
    expect(result.status).toBe('SUCCESS')
    const replies = foldNativeFrames(frames).filter((row) => row.kind === 'assistant')
    expect(replies).toHaveLength(1)
    expect(replies[0]?.text).toBe('合成回复')
  })
  it('reads Claude optional native summary without requesting a full token-count API or exposing prompt bodies', async () => {
    const { frames, messages, result } = await run('claude')
    expect(result.status).toBe('SUCCESS')
    expect(messages.find((value) => value.request?.subtype === 'get_context_usage')?.request).toEqual({ subtype: 'get_context_usage', detail: 'summary' })
    expect(frames.find((frame) => frame.record?.type === 'cliworker.context_inspection')?.record)
      .toMatchObject({ sessionId: 'synthetic-session', model: 'synthetic-model', contextUsed: 17, contextCapacity: 128000, categories: [{ name: 'System prompt', tokens: 7, kind: 'used' }, { name: 'Messages', tokens: 10, kind: 'used' }] })
    expect(JSON.stringify(frames)).not.toContain('PRIVATE_BODY_MUST_NOT_LEAK')
  })
  it.each(['context-unsupported', 'context-timeout', 'context-other-model'])(
    'does not alter Claude generation or invent context after %s', async (scenario) => {
      const { frames, result } = await run('claude', scenario)
      expect(result.status).toBe('SUCCESS')
      expect(frames.some((frame) => frame.record?.type === 'cliworker.context_inspection')).toBe(false)
    },
  )
  it('converts verified native argv while preserving route, permissions and exact resume', () => {
    for (const cli of ['codex', 'claude', 'antigravity'] as const) {
      const { config } = setup(cli)
      const argv = { codex: nativeCodexArgv, claude: nativeClaudeArgv, antigravity: nativeAgyArgv }[cli](config)
      expect(argv).not.toContain(`任务：\n${config.prompt}`)
      expect(argv).not.toContain('--bare')
      if (cli === 'codex') {
        expect(argv.slice(1, 3)).toEqual(['app-server', '--stdio'])
        expect(argv).toContain('approval_policy="never"')
        expect(argv).not.toContain('--model')
      } else {
        expect(argv[argv.indexOf('--input-format') + 1]).toBe('stream-json')
        expect(argv).toContain(config.conversationId)
        expect(argv[argv.indexOf('--model') + 1]).toBe('synthetic-model')
      }
      if (cli === 'claude') {
        expect(argv[argv.indexOf('--settings') + 1]).toMatch(/private-settings\.json$/)
        expect(argv[argv.indexOf('--permission-prompts') + 1]).toBe('none')
      }
    }
  })
  it('runs Codex RPC with exact model/effort/resume, filters foreign turns and deduplicates public output', async () => {
    const { frames, messages, result, config } = await run('codex')
    expect(result, JSON.stringify(result)).toMatchObject({ type: 'result', status: 'SUCCESS', response: '合成回复' })
    expect(messages.find((message) => message.method === 'thread/resume').params).toMatchObject({ threadId: 'synthetic-session', model: 'synthetic-model', approvalPolicy: 'never' })
    expect(messages.find((message) => message.method === 'turn/start').params).toMatchObject({ effort: 'low', input: [{ type: 'text', text: `任务：\n${config.prompt}` }], sandboxPolicy: { type: 'workspaceWrite', networkAccess: false } })
    expect(frames.filter((frame) => frame.type === 'event' && frame.event.kind === 'assistant').map((frame) => frame.event.text).join('')).toBe('合成回复')
    expect(JSON.stringify(frames)).not.toContain('HIDDEN RAW REASONING')
    expect(frames.find((frame) => frame.event?.kind === 'tool' && frame.event.state === 'COMPLETED')?.event.toolCall)
      .toEqual({ callId: 'tool', name: 'commandExecution', command: 'synthetic read', exitCode: 0 })
    expect(result.resultScope).toBe('response')
    expect(JSON.stringify(frames)).not.toContain('MUST NOT APPEAR')
    expect(new Set(frames.filter((frame) => frame.type === 'event' && frame.event.kind === 'reasoning').map((frame) => frame.event.step)).size).toBe(1)
    expect(frames.find((frame) => frame.type === 'native' && frame.record.type === 'turn.completed').record.usage.total_tokens).toBe(30)
  })
  it('preserves current Codex command output and MCP progress while running, plus dynamic tool results', async () => {
    const { result, frames } = await run('codex', 'tool-progress')
    expect(result.status).toBe('SUCCESS')
    const events = frames.filter((frame) => frame.type === 'event').map((frame) => frame.event)
    expect(events.filter((event) => event.toolCall?.callId === 'tool' && event.state === 'RUNNING').at(-1))
      .toMatchObject({ detail: '模拟输出', toolCall: { command: 'synthetic read', output: '模拟输出' } })
    expect(events.find((event) => event.toolCall?.callId === 'tool' && event.state === 'COMPLETED')?.toolCall.output).toBe('模拟输出')
    expect(events.find((event) => event.detail === '模拟 MCP 进度')).toMatchObject({ state: 'RUNNING', toolCall: { callId: 'mcp' } })
    expect(events.find((event) => event.toolCall?.callId === 'dynamic')?.toolCall.output)
      .toEqual([{ type: 'inputText', text: '模拟动态工具结果' }])
    expect(JSON.stringify(frames)).not.toContain('FOREIGN TOOL OUTPUT')
    expect(JSON.stringify(frames)).not.toContain('LATE TOOL OUTPUT')
  })
  it.each(['codex', 'claude', 'antigravity'] as const)('creates a new %s session from native evidence without inventing its ID', async (cli) => {
    const { result, frames } = await run(cli, 'success', false)
    expect(result.status).toBe('SUCCESS')
    expect(frames.filter((frame) => frame.type === 'session')).toEqual([{ type: 'session', id: 'synthetic-session', model: 'synthetic-model' }])
  })
  it.each(['claude', 'antigravity'] as const)('rejects mismatched %s effort and permission before native launch', (cli) => {
    const { config } = setup(cli)
    const builder = cli === 'claude' ? nativeClaudeArgv : nativeAgyArgv
    expect(() => builder({ ...config, preference: { model: 'synthetic-model', effort: 'high' } })).toThrow('思考强度')
    expect(() => builder({ ...config, mode: 'plan' })).toThrow('权限')
  })
  it('keeps Claude routing and native permissions while sending literal structured user input', async () => {
    const { result, frames, messages, config } = await run('claude')
    expect(result).toMatchObject({ status: 'SUCCESS', response: '合成回复' })
    expect(messages[0]).toMatchObject({ type: 'control_request', request: { subtype: 'initialize' } })
    expect(messages.find((value) => value.type === 'user')).toMatchObject({ type: 'user', session_id: 'synthetic-session', message: { role: 'user', content: `任务：\n${config.prompt}` } })
    expect(frames.filter((frame) => frame.type === 'event' && frame.event.kind === 'assistant').map((frame) => frame.event.text).join('')).toBe('合成回复')
    expect(frames.some((frame) => frame.type === 'event' && frame.event.kind === 'reasoning')).toBe(true)
  })
  it('correlates Claude per-block assistant frames sharing one message ID to live stream indices', async () => {
    const { result, frames } = await run('claude', 'multiple-blocks')
    expect(result.status).toBe('SUCCESS')
    const publicEvents = frames.filter((frame) => frame.type === 'event').map((frame) => frame.event)
    expect(publicEvents.filter((event) => event.kind === 'assistant').map((event) => event.text).join('')).toBe('合成回复')
    expect(new Set(publicEvents.filter((event) => event.kind === 'assistant').map((event) => event.step)).size).toBe(2)
    expect(new Set(publicEvents.filter((event) => event.kind === 'reasoning').map((event) => event.step)).size).toBe(1)
    expect(JSON.stringify(frames)).not.toContain('HIDDEN_SIGNATURE')
  })
  it('sends Antigravity native event:user and accepts harmless user_input metadata', async () => {
    const { result, messages, config, frames } = await run('antigravity', 'user-input')
    expect(result).toMatchObject({ status: 'SUCCESS', response: '合成回复' })
    expect(messages).toEqual([{ event: 'user', message: { content: `任务：\n${config.prompt}` } }])
    expect(frames.filter(frame => frame.event?.kind === 'diagnostic')).toHaveLength(0)
  })
  it.each(['metadata', 'unknown'])('preserves Antigravity %s without inventing failures or public thinking', async scenario => {
    const { result, frames } = await run('antigravity', scenario)
    expect(result).toMatchObject({ status: 'SUCCESS', response: '合成回复' })
    expect(frames.filter(frame => frame.event?.kind === 'diagnostic' && frame.event.state === 'FAILED')).toHaveLength(0)
    expect(frames.filter(frame => frame.event?.kind === 'reasoning')).toHaveLength(0)
    expect(frames.filter(frame => frame.event?.kind === 'diagnostic')).toHaveLength(scenario === 'unknown' ? 1 : 0)
    expect(frames.filter(frame => frame.type === 'native' && frame.record?.event === 'step_update')).toHaveLength(3)
  })
  it('never uses an unknown Antigravity step as proof of a fully completed summary conflict', async () => {
    expect((await run('antigravity', 'metadata-conflict')).result.status).toBe('UNCERTAIN')
    expect((await run('antigravity', 'unknown-conflict')).result.status).toBe('ERROR')
  })
  it.each(['tool-error-state', 'invalid-step-state'])('keeps Antigravity %s failed without poisoning later valid reply frames', async scenario => {
    const { result, frames } = await run('antigravity', scenario)
    expect(result.status).toBe('ERROR')
    expect(frames.filter(frame => frame.event?.kind === 'diagnostic' && frame.event.state === 'FAILED')).toHaveLength(1)
    expect(frames.some(frame => frame.event?.kind === 'assistant' && frame.event.text === '合成回复')).toBe(true)
  })
  it('keeps an Antigravity tool_info error as a failed step that a later reply recovers from', async () => {
    const { result, frames } = await run('antigravity', 'tool-info-error')
    expect(result).toMatchObject({ status: 'SUCCESS', notice: '本轮有 1 个工具步骤失败，CLI 已自行处理' })
    expect(frames.find(frame => frame.event?.kind === 'tool')?.event.state).toBe('FAILED')
    expect(frames.some(frame => frame.event?.kind === 'diagnostic' && frame.event.state === 'FAILED')).toBe(false)
  })
  it('publishes Antigravity response-scoped usage without using its aggregate result counters', async () => {
    const { result, frames } = await run('antigravity', 'response-usage')
    expect(result.status).toBe('SUCCESS')
    const events = frames.filter((frame) => frame.type === 'event').map((frame) => frame.event)
    expect(events.find((event) => event.kind === 'assistant')?.response).toEqual({
      id: 'agy:1', blockId: 'text', index: 0, complete: true,
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 0, totalTokens: 420 },
    })
    expect(events.filter((event) => event.kind === 'reasoning')).toHaveLength(0)
  })
  it.each(['deny', 'deny-file', 'deny-permissions'])('denies Codex %s approval and reports a completed turn as uncertain', async (scenario) => {
    const { result, messages, frames } = await run('codex', scenario)
    expect(result).toMatchObject({ status: 'UNCERTAIN', response: '合成回复', resultScope: 'response', error: 'Codex 额外授权已拒绝，但 CLI 报告本轮已完成；结果待核实，请先核查实际产物，不要自动重试' })
    expect(messages.find((value) => value.id === 'synthetic-approval').result)
      .toEqual(scenario === 'deny-permissions' ? { permissions: { network: null, fileSystem: null }, scope: 'turn' } : { decision: 'decline' })
    const diagnostic = frames.find((frame) => frame.event?.kind === 'diagnostic')?.event
    expect(diagnostic?.text).toBe('Codex 原生交互请求已拒绝')
    expect(diagnostic?.state).not.toBe('FAILED')
  })
  it.each(['deny-failed', 'deny-interrupted', 'deny-nonzero-exit'])('keeps Codex %s as an error despite a denied approval', async (scenario) => {
    const { result } = await run('codex', scenario)
    expect(result.status).toBe('ERROR')
  })
  it.each([
    ['read-only', 'accept-edits', 'read-only', 'on-request'],
    ['workspace-write', 'accept-edits', 'workspace-write', 'on-request'],
    ['danger-full-access', 'accept-edits', 'danger-full-access', 'never'],
    ['danger-full-access', 'plan', 'read-only', 'never'],
  ] as const)('maps the DSH tier %s (%s) to Codex %s + %s, never wider', async (access, mode, sandbox, approvalPolicy) => {
    const { config, log } = setup('codex', 'tier', true)
    Object.assign(config, { access, mode })
    const frames: any[] = []
    const io = createNativeIO(config, (line: string) => frames.push(JSON.parse(line)), new AbortController().signal)
    let error
    try { await runNativeCodex(config, io) } catch (caught) { error = caught }
    await io.close(error)
    expect(frames.at(-1).status).toBe('SUCCESS')
    const messages = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    expect(messages.find((m) => m.method === 'thread/resume').params).toMatchObject({ sandbox, approvalPolicy })
    const turn = messages.find((m) => m.method === 'turn/start').params
    expect(turn.approvalPolicy).toBe(approvalPolicy)
    // Tiered runs keep the user's native sandbox details; plan still pins read-only.
    if (mode === 'plan') expect(turn.sandboxPolicy).toEqual({ type: 'readOnly' })
    else expect(turn).not.toHaveProperty('sandboxPolicy')
  })
  it('accepts the user\'s native network setting under 工作区内修改 instead of failing before launch', async () => {
    const { config } = setup('codex', 'tier-network', true)
    config.access = 'workspace-write'
    const frames: any[] = []
    const io = createNativeIO(config, (line: string) => frames.push(JSON.parse(line)), new AbortController().signal)
    let error
    try { await runNativeCodex(config, io) } catch (caught) { error = caught }
    await io.close(error)
    expect(frames.at(-1).status).toBe('SUCCESS')
  })
  it.each([
    ['allow-once', 'accept', 'SUCCESS'],
    ['allow-session', 'acceptForSession', 'SUCCESS'],
    ['deny', 'decline', 'UNCERTAIN'],
  ] as const)('relays a Codex approval to the Host: %s → %s', async (decision, reply, status) => {
    const { config, log } = setup('codex', 'tier-ask', true)
    Object.assign(config, { access: 'workspace-write', approvalNonce: 'synthetic-nonce' })
    const frames: any[] = []
    const io: any = createNativeIO(config, (line: string) => {
      const frame = JSON.parse(line)
      frames.push(frame)
      if (frame.type === 'approval')
        setTimeout(() => void io.answerApproval(JSON.stringify({ decision, source: 'user' }), frame.id), 5)
    }, new AbortController().signal)
    let error
    try { await runNativeCodex(config, io) } catch (caught) { error = caught }
    await io.close(error)
    expect(frames.find((frame) => frame.type === 'approval').request).toMatchObject({ kind: 'command', allowSession: true })
    const messages = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    expect(messages.find((value) => value.id === 'synthetic-approval').result).toEqual({ decision: reply })
    expect(frames.at(-1).status).toBe(status)
  })
  it('keeps a denied Codex turn with another failed tool unverified, never successful', async () => {
    const { result } = await run('codex', 'deny-tool-failure')
    expect(result).toMatchObject({ status: 'UNCERTAIN', error: expect.stringContaining('额外授权已拒绝') })
  })
  it.each(['user-input', 'unknown-request'])('keeps Codex %s server requests as failures even when the turn completes', async (scenario) => {
    const { result, messages, frames } = await run('codex', scenario)
    expect(result).toMatchObject({ status: 'ERROR', error: 'CLI 请求额外交互授权，插件未批准' })
    expect(messages.find((value) => value.id === 'synthetic-interaction').error.code).toBe(-32601)
    expect(frames.find((frame) => frame.event?.kind === 'diagnostic')?.event)
      .toMatchObject({ text: 'Codex 原生交互请求已拒绝', state: 'FAILED' })
  })
  it.each([
    ['allow-once', 'allow', 'SUCCESS'],
    ['allow-session', 'allow', 'SUCCESS'],
    ['deny', 'deny', 'ERROR'],
  ] as const)('relays a Claude can_use_tool request to the Host: %s', async (decision, behavior, status) => {
    const { config, log } = setup('claude', 'ask', true)
    config.approvalNonce = 'synthetic-nonce'
    const frames: any[] = []
    const io: any = createNativeIO(config, (line: string) => {
      const frame = JSON.parse(line)
      frames.push(frame)
      if (frame.type === 'approval')
        setTimeout(() => void io.answerApproval(JSON.stringify({ decision, source: 'user' }), frame.id), 5)
    }, new AbortController().signal)
    let error
    try { await runNativeClaude(config, io) } catch (caught) { error = caught }
    await io.close(error)
    expect(frames.find((frame) => frame.type === 'approval').request).toEqual({ kind: 'command', summary: 'Bash', detail: 'synthetic', allowSession: true })
    const reply = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
      .find((value) => value.type === 'control_response' && value.response?.request_id === 'synthetic-permission').response.response
    expect(reply.behavior).toBe(behavior)
    if (decision === 'allow-session')
      // The CLI's own suggestion, scoped to this session only.
      expect(reply.updatedPermissions).toEqual([{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'synthetic' }], behavior: 'allow', destination: 'session' }])
    else expect(reply).not.toHaveProperty('updatedPermissions')
    // A Claude denial interrupts the native turn, so it stays a failure.
    if (decision === 'deny') expect(reply.interrupt).toBe(true)
    expect(frames.at(-1).status).toBe(status)
  })
  it('lets Claude ask the Host only when the approval channel exists, and maps the DSH tier', () => {
    const { config } = setup('claude', 'success', true)
    expect(nativeClaudeArgv(config).slice(-2)).toEqual(['--permission-prompts', 'none'])
    expect(nativeClaudeArgv({ ...config, approvalNonce: 'synthetic' }).slice(-2)).toEqual(['--permission-prompts', 'host'])
    expect(claudePermissionMode({ mode: 'plan', access: 'danger-full-access' })).toBe('plan')
    expect(claudePermissionMode({ mode: 'accept-edits', access: 'workspace-write' })).toBe('acceptEdits')
    expect(claudePermissionMode({ mode: 'accept-edits', access: 'danger-full-access' })).toBe('bypassPermissions')
    // The launched mode must match the tier, or the run is refused before start.
    expect(() => nativeClaudeArgv({ ...config, access: 'danger-full-access' })).toThrow('原生权限模式与任务不一致')
  })
  it('denies Claude reverse permission requests without upgrading successful native status', async () => {
    const { result, messages } = await run('claude', 'deny')
    expect(result.status).toBe('ERROR')
    expect(messages.find((value) => value.type === 'control_response').response.response.behavior).toBe('deny')
  })
  it.each(['codex', 'claude', 'antigravity'] as const)('%s never promotes native failure, unfinished tools, nonzero exit, missing or duplicate terminal to success', async (cli) => {
    for (const scenario of ['failure', 'tool-failure-turn-failed', 'tool-failure-nonzero-exit', 'unfinished-tool', 'nonzero-exit', 'no-terminal', 'duplicate-terminal']) {
      const { result } = await run(cli, scenario, false)
      expect(result.status, `${cli}: ${scenario}`).toBe('ERROR')
    }
  }, 10_000)
  it.each(['codex', 'claude', 'antigravity'] as const)('%s reports a recovered tool failure as success with the failed step count', async (cli) => {
    const { result, frames } = await run(cli, 'tool-recovered', false)
    expect(result).toMatchObject({ status: 'SUCCESS', notice: '本轮有 1 个工具步骤失败，CLI 已自行处理' })
    expect(result.error).toBeUndefined()
    expect(frames.some((frame) => frame.type === 'event' && frame.event.kind === 'tool' && frame.event.state === 'FAILED')).toBe(true)
  })
  it.each(['codex', 'claude', 'antigravity'] as const)('%s reports a turn that ends right after a failed tool as unverified', async (cli) => {
    const { result } = await run(cli, 'tool-failure', false)
    expect(result).toMatchObject({ status: 'UNCERTAIN', error: '本轮最后的工具步骤失败后 CLI 直接结束；结果待核实，请先核查实际产物，不要自动重试' })
    expect(result.notice).toBeUndefined()
  })
  it.each(['codex', 'claude', 'antigravity'] as const)('rejects %s resume identity changes', async (cli) => {
    const { result, messages } = await run(cli, 'identity-mismatch')
    expect(result.status).toBe('ERROR')
    if (cli === 'codex') expect(messages.some((value) => value.method === 'turn/start')).toBe(false)
  })
  it('rejects a substituted Codex model before submitting a turn', async () => {
    const { result, messages } = await run('codex', 'model-mismatch')
    expect(result.status).toBe('ERROR')
    expect(messages.some((value) => value.method === 'turn/start')).toBe(false)
  })
  it.each(['claude', 'antigravity'] as const)('rejects %s silent model substitution in native initialization', async (cli) => {
    const { result } = await run(cli, 'model-mismatch')
    expect(result.status).toBe('ERROR')
    expect(result.error).toContain('模型与明确选型不一致')
  })
  it('accepts the selected Claude alias only through the same process public resolvedModel mapping', async () => {
    const { result, frames } = await run('claude', 'claude-alias')
    expect(result.status).toBe('SUCCESS')
    expect(frames.find((frame) => frame.type === 'session')?.model).toBe('synthetic-resolved-model')
  })
  it('preserves a selected proxy model with exact identity evidence from the already prepared route', async () => {
    const { result } = await run('claude', 'claude-proxy')
    expect(result.status).toBe('SUCCESS')
  })
  it.each(['claude-unknown-alias', 'ambiguous-alias', 'unsupported-effort', 'init-rejected'])('rejects Claude %s before submitting user input', async (scenario) => {
    const { result, messages } = await run('claude', scenario)
    expect(result.status).toBe('ERROR')
    expect(messages.some((value) => value.type === 'user')).toBe(false)
  })
  it('rejects Claude model substitution after a correctly selected initialization', async () => {
    const { result } = await run('claude', 'assistant-model-mismatch')
    expect(result.status).toBe('ERROR')
    expect(result.error).toContain('原生回复模型与明确选型不一致')
  })
  it('keeps Claude native Task subagent model metadata distinct from the selected main loop', async () => {
    const { result } = await run('claude', 'child-model')
    expect(result).toMatchObject({ status: 'SUCCESS', response: '合成回复' })
  })
  it.each(['collab-interrupted', 'image-failed', 'image-in-progress', 'image-failure-receipt', 'image-unfinished'])('keeps a completed Codex turn with %s from reporting success', async (scenario) => {
    const { result, frames } = await run('codex', scenario)
    // A last failed step is unverified; a tool still in progress at the terminal fails the turn.
    expect(result.status).toBe(['image-in-progress', 'image-unfinished'].includes(scenario) ? 'ERROR' : 'UNCERTAIN')
    const tools = frames.filter((frame) => frame.type === 'event' && frame.event.kind === 'tool')
    if (scenario === 'image-unfinished') expect(result.error).toContain('未完成工具')
    else expect(tools.some((frame) => frame.event.state === 'FAILED')).toBe(true)
  })
  it('projects successful Codex image generation as a completed native tool', async () => {
    const { result, frames } = await run('codex', 'image-success')
    expect(result.status).toBe('SUCCESS')
    expect(frames.some((frame) => frame.type === 'event' && frame.event.kind === 'tool' && frame.event.text === 'imageGeneration' && frame.event.state === 'COMPLETED')).toBe(true)
  })
  it('steers only the active Codex turn, confirms its receipt, and deduplicates repeated submissions', async () => {
    const { result, messages, frames } = await run('codex', 'steer-success', true, async (io) => {
      const first = io.steer('literal guidance $(no shell)', 'guidance-one', 'attempt-one')
      expect(io.steer('literal guidance $(no shell)', 'guidance-one', 'attempt-two')).toBe(first)
      await expect(io.steer('different guidance', 'guidance-one', 'attempt-three')).rejects.toThrow('其他消息')
      await first
    })
    expect(result.status).toBe('SUCCESS')
    expect(messages.filter((message) => message.method === 'turn/start')).toHaveLength(1)
    const steering = messages.filter((message) => message.method === 'turn/steer')
    expect(steering).toHaveLength(1)
    expect(steering[0].params).toEqual({ threadId: 'synthetic-session', expectedTurnId: 'synthetic-turn', clientUserMessageId: 'guidance-one', input: [{ type: 'text', text: 'literal guidance $(no shell)' }] })
    expect(frames.some((frame) => frame.type === 'native' && frame.record.method === 'turn/steer')).toBe(true)
  })
  it('preserves Codex receipt-before-terminal ordering when both frames share one stdout chunk', async () => {
    const { result, messages } = await run('codex', 'steer-coalesced', true,
      async (io) => { await io.steer('synthetic guidance', 'one', 'attempt-one') })
    expect(result.status).toBe('SUCCESS')
    expect(messages.filter((message) => message.method === 'turn/steer')).toHaveLength(1)
  })
  it.each(['steer-rejected', 'steer-unknown', 'steer-wrong-turn', 'steer-terminal-first'])('never confirms Codex %s or automatically resubmits an unknown receipt', async (scenario) => {
    const { messages } = await run('codex', scenario, true, async (io) => {
      const submission = io.steer('synthetic guidance', 'guidance-one', 'attempt-one')
      if (scenario === 'steer-rejected') await expect(submission).rejects.toMatchObject({ code: 'STEER_REJECTED' })
      else {
        await expect(submission).rejects.toThrow(/未确认|未知/)
        await expect(io.steer('synthetic guidance', 'guidance-one', 'attempt-two')).rejects.toThrow()
      }
    })
    expect(messages.filter((message) => message.method === 'turn/steer')).toHaveLength(1)
    expect(messages.filter((message) => message.method === 'turn/start')).toHaveLength(1)
  })
  it('preserves AGY resumed summary conflict as uncertain and uses only current-turn observed text', async () => {
    const resumed = await run('antigravity', 'summary-conflict')
    expect(resumed.result, JSON.stringify(resumed.result)).toMatchObject({ status: 'UNCERTAIN', response: '合成回复' })
    expect(resumed.result.error).toContain('汇总状态冲突')
    expect(resumed.result.response).not.toContain('历史汇总文本')
    const fresh = await run('antigravity', 'summary-conflict', false)
    expect(fresh.result.status).toBe('ERROR')
  })
  it.each(['codex', 'claude', 'antigravity'] as const)('attempts native %s cancellation and closes its owned process', async (cli) => {
    const { result, messages } = await run(cli, 'cancel')
    expect(result.status).toBe('ERROR')
    if (cli === 'codex') expect(messages.some((value) => value.method === 'turn/interrupt')).toBe(true)
    if (cli === 'claude') expect(messages.some((value) => value.request?.subtype === 'interrupt')).toBe(true)
    expect(result.response).toContain('运行中')
  })
  it.each(['codex', 'claude', 'antigravity'] as const)('keeps a stopped %s turn interrupted after an earlier failed tool', async (cli) => {
    const { result } = await run(cli, 'tool-failure-cancel')
    expect(result.status, JSON.stringify(result)).toBe('ERROR')
    expect(result.notice).toBeUndefined()
  })
})

// 模拟 Claude 延迟分支：只发送首轮新输入，不重新投递原任务。
it.each([false, true])('模拟 Claude deferred fork requires a new native identity (source receipt=%s)', async reuseSource => {
  const { config, log } = setup('claude', 'success', true)
  const source = reuseSource ? 'synthetic-session' : 'synthetic-original-source'
  config.argv[config.argv.indexOf('--resume') + 1] = source
  config.conversationId = undefined
  config.forkSource = { conversationId: source, messageId: 'synthetic-pinned-message-uuid' }
  const before = JSON.stringify(config)
  const frames: any[] = []
  const io = createNativeIO(config, line => frames.push(JSON.parse(line)), new AbortController().signal)
  let error
  try { await runNativeClaude(config, io) } catch (caught) { error = caught }
  await io.close(error)
  expect(JSON.stringify(config)).toBe(before)
  expect(frames.at(-1).status).toBe(reuseSource ? 'ERROR' : 'SUCCESS')
  const messages = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  const users = messages.filter(message => message.type === 'user')
  expect(users).toHaveLength(1)
  expect(users[0].session_id).toBeUndefined()
  expect(users[0].message.content).toBe(`任务：\n${config.prompt}`)
  if (!reuseSource) expect(frames.find(frame => frame.type === 'session')?.id).toBe('synthetic-session')
  else expect(frames.some(frame => frame.type === 'session')).toBe(false)
})
