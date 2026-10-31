import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agyArguments } from '../src/host/process.ts'
import { createNativeIO } from '../src/host/native-transport.mjs'
import { agyAcpArgv, runNativeAgyAuto, runNativeAgyAcp, probeAgyAcp } from '../src/host/native-agy-acp.mjs'
import { nativeHarnessMcpServers } from '../src/host/native-harness-injection.mjs'
import { createNativeHarnessTools } from '../src/host/native-harness-tools.ts'
import { extractTelemetry } from '../src/host/telemetry.ts'

// 模拟 CLI、模型、会话与审批；不使用真实账号或真实模型。
const roots: string[] = []
afterEach(() => { for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }) })
const fixture = `
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const s=process.env.SCENARIO, log=v=>appendFileSync(process.env.AUDIT,JSON.stringify(v)+'\\n');
if(process.argv.includes('--help')){
 if(process.argv.includes('acp')){if(s==='old')process.exit(1); if(s==='help-timeout')setInterval(()=>{},1000); else console.log('Usage: agy acp\\n  --stdio Use stdio');}
 else console.log('  --mode Set mode (accept-edits, auto, plan)');
 if(s!=='help-timeout')process.exit(0);
}
const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');
log({start:process.pid,argv:process.argv.slice(2),cwd:process.cwd()});
const carriers=[];
let id='simulated-session',model='simulated-high',thought='high',pending;
const state=()=>({sessionId:s==='wrong-session'?'wrong':id,models:{currentModelId:model,availableModels:[{modelId:'simulated-low'},{modelId:'simulated-high'}]},configOptions:[{id:'model',currentValue:'simulated',options:[{value:'simulated'}]},{id:'thought_level',currentValue:thought,options:[{value:'low'},{value:'high'}]}]});
const reply=(v,result)=>send({jsonrpc:'2.0',id:v.id,result});
const update=v=>send({jsonrpc:'2.0',method:'session/update',params:{sessionId:id,update:v}});
const text=()=>update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'模拟回复'}});
const finish=()=>reply(pending,{stopReason:s==='partial'?'max_tokens':'end_turn',usage:{inputTokens:10,outputTokens:2,totalTokens:12,cachedReadTokens:0,thoughtTokens:1}});
if(!process.argv.includes('acp')){
 if(s==='host-sandboxless')process.stderr.write('warning: --mode auto is not available because the terminal sandbox is not available on this host; continuing in the default mode.\\n');
 else if(s!=='probe-silent'){if(s==='account-auto')process.stderr.write('warning: --mode auto is not available for this account; continuing in the default mode.\\n');send({event:'init',conversation_id:id,init:{model:'simulated-low'}});}
}
createInterface({input:process.stdin}).on('line',async line=>{
 const v=JSON.parse(line);log(v);
 if(v.event==='user'){send({event:'result',result:{conversation_id:id,status:'SUCCESS',response:'模拟 stream 完成'}});return;}
 if(v.method==='initialize')reply(v,{protocolVersion:1,agentInfo:{name:'Antigravity ACP Server'},agentCapabilities:{loadSession:true}});
 else if(v.method==='session/new'){
  if(s==='bridge'){
   const server=v.params.mcpServers[0];
   const child=spawn(server.command,server.args,{env:{...process.env,...Object.fromEntries(server.env.map(x=>[x.name,x.value]))},stdio:['pipe','pipe','pipe']});carriers.push(child);
   log({carrier:child.pid});let next=1;const pendingCalls=new Map();
   createInterface({input:child.stdout}).on('line',line=>{const value=JSON.parse(line);pendingCalls.get(value.id)?.(value.result);pendingCalls.delete(value.id);});
   const call=(method,params)=>new Promise(resolve=>{const id=next++;pendingCalls.set(id,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\\n');});
   await call('initialize',{});const catalog=await call('tools/list',{});
   log({carrierResult:await call('tools/call',{name:catalog.tools[0].name,arguments:{}})});
  }
  reply(v,state());
 }
 else if(v.method==='session/load'){
  if(s==='wrong-session'){reply(v,{...state(),sessionId:'other'});return;}
  if(s==='load-rejected'){send({jsonrpc:'2.0',id:v.id,error:{code:-32602,message:'simulated missing session'}});return;}
  if(s==='transport-load'){process.exit(2);return;}
  id=v.params.sessionId;reply(v,state());
 } else if(v.method==='session/set_model'){
  if(s!=='model-mismatch'){model=v.params.modelId;thought='low';}reply(v,{});
 } else if(v.method==='session/set_config_option'){
  if(s!=='effort-mismatch') thought=v.params.value;reply(v,state());
 } else if(v.method==='session/prompt'){
  pending=v;
  if(s==='nonzero'){text();finish();process.exit(7);return;}
  if(s==='cancel'||s==='timeout'){text();return;}
  if(s.startsWith('permission')){
   update({sessionUpdate:'tool_call',toolCallId:'cmd',name:'run_command',title:'模拟只读命令',kind:'execute',status:'pending',rawInput:{CommandLine:'pwd -P'}});
   send({jsonrpc:'2.0',id:'ask',method:'session/request_permission',params:{sessionId:id,toolCall:{toolCallId:'cmd',kind:s==='permission-edit'?'edit':'execute',title:'模拟只读命令',rawInput:{CommandLine:'pwd -P'}},options:[{kind:'allow_once',optionId:'allow'},{kind:'reject_once',optionId:'deny'},{kind:'allow_always',optionId:'persist'}]}});
   if(s==='permission-late'){text();finish();}return;
  }
  if(s==='unfinished')update({sessionUpdate:'tool_call',toolCallId:'cmd',title:'模拟工具',status:'in_progress'});
  if(s==='tool-failure')update({sessionUpdate:'tool_call',toolCallId:'cmd',title:'模拟工具',status:'failed'});
  if(s==='config-drift')update({sessionUpdate:'config_option_update',configOptions:[{id:'thought_level',currentValue:'high'}]});
  if(s!=='empty')text();finish();
 } else if(v.method==='session/cancel') {log({cancelled:true});if(pending)reply(pending,{stopReason:'cancelled'});}
 else if(v.id==='ask'){
  log({answer:v.result});
  if(s==='permission-late')return;
  update({sessionUpdate:'tool_call_update',toolCallId:'cmd',status:v.result.outcome.optionId==='allow'?'completed':'failed'});text();finish();
 }
}).on('close',()=>{for(const child of carriers)child.stdin.end();setTimeout(()=>process.exit(0),50);});
`
function setup(scenario = 'normal', overrides: any = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agy-acp-SIMULATED-'))); roots.push(root)
  const script = join(root, 'cli.mjs'), audit = join(root, 'audit.jsonl')
  writeFileSync(script, fixture)
  const config: any = { cli: 'antigravity', project: root, mode: 'accept-edits', access: 'workspace-write',
    preference: { cli: 'antigravity', model: 'simulated-low', effort: 'low' }, prompt: '模拟任务',
    env: { SCENARIO: scenario, AUDIT: audit }, approvalNonce: 'simulated-nonce', timeoutMs: 1000, maxLineBytes: 1048576, maxRunBytes: 1048576, ...overrides }
  config.argv = [process.execPath, script, ...agyArguments('agy', root, config.preference, config.mode, config.prompt, config.timeoutMs, config.conversationId, config.access).slice(1)]
  return { config, rows: () => readFileSync(audit, 'utf8').trim().split('\n').map(line => JSON.parse(line)) }
}
async function run(f: ReturnType<typeof setup>, decide = 'allow-once', abortAt?: string, auto = true) {
  const controller = new AbortController(), frames: any[] = []; let error: any, stderr = ''
  const io = createNativeIO(f.config, (line: string) => {
    const frame = JSON.parse(line); frames.push(frame)
    if (frame.type === 'approval') {
      if (abortAt === 'approval') controller.abort(new Error('模拟停止'))
      else if (decide !== 'pending') setTimeout(() => void io.answerApproval(JSON.stringify({ decision: decide, source: 'user' }), frame.id).catch(() => {}), f.config.env.SCENARIO === 'permission-late' ? 50 : 0)
    }
    if (abortAt === 'text' && frame.event?.kind === 'assistant') controller.abort(new Error('模拟停止'))
  }, controller.signal, (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  try { await (auto ? runNativeAgyAuto : runNativeAgyAcp)(f.config, io) } catch (e) { error = e }
  await io.close(error)
  return { frames, error, result: frames.at(-1), rows: f.rows(), stderr }
}

it('模拟：按实际 --stdio 能力探测，不猜版本', async () => {
  expect(await probeAgyAcp(setup().config, new AbortController().signal)).toBe(true)
  expect(await probeAgyAcp(setup('old').config, new AbortController().signal)).toBe(false)
})
it.each(['old', 'normal'])('模拟：%s 规划始终 stream plan，不发 ACP prompt', async scenario => {
  const f = setup(scenario, { mode: 'plan' }), r = await run(f)
  expect(r.result.status).toBe('SUCCESS'); expect(r.rows.some(x => x.method === 'session/prompt')).toBe(false)
  expect(r.rows.find(x => x.start).argv).toContain('plan')
})
it('模拟：旧版 stream 后备', async () => {
  const r = await run(setup('old'))
  expect(r.result.status).toBe('SUCCESS'); expect(r.rows.filter(x => x.event === 'user')).toHaveLength(1)
})
it('模拟：cwd、MCP、新会话、精确选型和回读', async () => {
  const f = setup(), r = await run(f)
  expect(r.result.status).toBe('SUCCESS')
  const start = r.rows.find(x => x.start && x.argv.includes('acp'))
  expect(start).toMatchObject({ cwd: f.config.project })
  expect(start.argv).not.toContain('--add-dir')
  expect(r.rows.find(x => x.method === 'session/new').params).toEqual({ cwd: f.config.project, mcpServers: [] })
  expect(r.rows.find(x => x.method === 'session/set_model').params.modelId).toBe('simulated-low')
  expect(r.rows.filter(x => x.method === 'session/load')).toHaveLength(1)
  expect(r.rows.filter(x => x.method === 'session/prompt')).toHaveLength(1)
  expect(r.frames.some(x => x.record?.type === 'cliworker.agy_prompt_usage')).toBe(true)
})
it('模拟：项目额外目录保留，私有目录拒绝，三档不混用', () => {
  const c = setup().config
  c.argv.splice(-2, 0, '--add-dir', '/simulated/extra')
  expect(agyAcpArgv(c, 'darwin')).toContain('--sandbox')
  expect(agyAcpArgv(c, 'darwin')).not.toContain('--dangerously-skip-permissions')
  expect(agyAcpArgv(c, 'win32')).not.toContain('--sandbox')
  for (const platform of ['darwin', 'win32']) {
    expect(agyAcpArgv(c, platform, 'available')).toEqual(expect.arrayContaining(['--sandbox', '--dangerously-skip-permissions']))
    expect(agyAcpArgv(c, platform, 'unavailable')).not.toEqual(expect.arrayContaining(['--sandbox']))
    expect(agyAcpArgv(c, platform, 'unavailable')).not.toContain('--dangerously-skip-permissions')
  }
  expect(agyAcpArgv(c, 'win32')).toContain('/simulated/extra')
  c.env.CLIWORKER_AGY_TOOLS_DIR = '/simulated/extra'
  expect(() => agyAcpArgv(c)).toThrow('私有')
  const full = setup('normal', { access: 'danger-full-access' }).config
  expect(agyAcpArgv(full)).toEqual(expect.arrayContaining(['--sandbox=false', '--dangerously-skip-permissions']))
  expect(() => agyAcpArgv(setup('normal', { access: 'read-only' }).config)).toThrow('规划')
})
it('模拟：mcpServers 使用每轮载体而非工作区配置', () => {
  const c = setup().config
  c.harnessTools = { url: 'http://127.0.0.1:12345/rpc', token: 's'.repeat(43), executionReady: true,
    binding: { cli: 'antigravity', parentSessionId: 'p', harnessSessionId: 'h', workerId: 'w', runId: 'r' }, tools: [] }
  const servers = nativeHarnessMcpServers(c)
  expect(servers).toHaveLength(1)
  expect(servers[0]).toMatchObject({ name: 'dsh_worker_tools', command: process.execPath })
  expect(servers[0].args[0]).toContain('native-harness-mcp.mjs')
})
it.each(['model-mismatch', 'wrong-session', 'config-drift', 'partial', 'unfinished', 'nonzero'])('模拟：%s 不判成功或重试', async scenario => {
  const r = await run(setup(scenario))
  expect(r.result.status).toBe('ERROR')
  expect(r.rows.filter(x => x.method === 'session/prompt').length).toBeLessThanOrEqual(1)
})
it('模拟：强度不存在时不发输入', async () => {
  const f = setup('normal', { preference: { model: 'simulated-low', effort: 'ultra' } }), r = await run(f)
  expect(r.result.status).toBe('ERROR'); expect(r.rows.some(x => x.method === 'session/prompt')).toBe(false)
})
it('模拟：设置强度后实际模型 ID 必须仍等于所选值', async () => {
  const f = setup('normal', { preference: { model: 'simulated-low', effort: 'high' } }), r = await run(f)
  expect(r.result.status).toBe('SUCCESS')
  expect(r.rows.find(x => x.method === 'session/set_config_option').params).toMatchObject({ configId: 'thought_level', value: 'high' })
})
it.each(['normal', 'load-rejected', 'transport-load'])('模拟：旧会话 %s 保持 ID，只有原生加载拒绝可后备', async scenario => {
  const r = await run(setup(scenario, { conversationId: 'simulated-session' }))
  expect(r.rows.some(x => x.method === 'session/new')).toBe(false)
  expect(r.frames.filter(x => x.type === 'session').every(x => x.id === 'simulated-session')).toBe(true)
  expect(r.rows.filter(x => x.event === 'user')).toHaveLength(scenario === 'load-rejected' ? 1 : 0)
  expect(r.result.status).toBe(scenario === 'transport-load' ? 'ERROR' : 'SUCCESS')
})
it.each(['allow-once', 'deny'])('模拟：逐条审批 %s，无会话授权，拒绝是用户决定', async decision => {
  const r = await run(setup('permission'), decision)
  expect(r.result.status).toBe('SUCCESS')
  const request = r.frames.find(x => x.type === 'approval').request
  expect(request).toMatchObject({ allowSession: false, detail: 'pwd -P', kind: 'command' })
  expect(r.rows.find(x => x.answer).answer.outcome.optionId).toBe(decision === 'deny' ? 'deny' : 'allow')
})
it('模拟：编辑请求也转交 DSH（不宣称真实 agy 一定会发起）', async () => {
  const r = await run(setup('permission-edit'))
  expect(r.frames.find(x => x.type === 'approval').request.kind).toBe('file')
})
it.each(['cancel', 'timeout', 'permission'])('模拟：%s 取消或超时后清理进程，发 cancel，不报告成功', async scenario => {
  const r = await run(setup(scenario, { timeoutMs: 150 }), 'pending', scenario === 'cancel' ? 'text' : scenario === 'permission' ? 'approval' : undefined)
  expect(r.result.status).toBe('ERROR')
  expect(r.rows.some(x => x.cancelled)).toBe(true)
  for (const x of r.rows.filter(x => x.start)) expect(() => process.kill(x.start, 0)).toThrow()
})
it('模拟：空回复保持待核实', async () => expect((await run(setup('empty'))).result.status).toBe('UNCERTAIN'))
it('模拟：ACP usage 为本轮，不累加或冒充 stream 累计', () => {
  const receipt = { type: 'cliworker.agy_prompt_usage', sessionId: 'simulated-session', model: 'simulated-low',
    usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedReadTokens: 0, thoughtTokens: 1 } }
  const result = extractTelemetry('antigravity', [receipt, receipt], { sessionId: 'simulated-session', model: 'simulated-low' })
  expect(result.runUsage).toMatchObject({ input: 10, output: 2, total: 12, scope: 'run', reasoning: 1 })
})

it('模拟：审批未答复超时不放行且确认进程退出', async () => {
  const r = await run(setup('permission', { timeoutMs: 120 }), 'pending')
  expect(r.result.status).toBe('ERROR')
  expect(r.rows.some(x => x.cancelled)).toBe(true)
  expect(r.rows.filter(x => x.answer?.outcome?.optionId === 'allow')).toHaveLength(0)
  for (const x of r.rows.filter(x => x.start)) expect(() => process.kill(x.start, 0)).toThrow()
})
it('模拟：原生结束后的迟到允许不发送 allow', async () => {
  const r = await run(setup('permission-late'))
  expect(r.result.status).toBe('ERROR') // pending tool has no terminal
  expect(r.rows.filter(x => x.answer?.outcome?.optionId === 'allow')).toHaveLength(0)
})

it('模拟：ACP 启动真实 stdio 载体，MCP 调用实际到达模拟 Host', async () => {
  let calls = 0
  const lease = await createNativeHarnessTools({ binding: { cli: 'antigravity', parentSessionId: 'p', harnessSessionId: 'h', workerId: 'w', runId: 'r' },
    executionReady: true, authorize: () => {}, tools: () => [{ name: 'synthetic_probe', description: '模拟只读工具', inputSchema: { type: 'object' }, execution: 'host' as const }],
    execute: async () => { calls++; return { isError: false, content: [{ type: 'text', text: '模拟载体回执' }] } } })
  try {
    const r = await run(setup('bridge', { harnessTools: lease.connection }))
    expect(r.result.status).toBe('SUCCESS')
    expect(calls).toBe(1)
    expect(r.rows.find(x => x.carrierResult).carrierResult).toMatchObject({ content: [{ type: 'text', text: '模拟载体回执' }] })
    for (const row of r.rows.filter(x => x.carrier)) expect(() => process.kill(row.carrier, 0)).toThrow()
  } finally { await lease.close() }
})

it('模拟：能力探测取消不当成旧版后备', async () => {
  const controller = new AbortController(); controller.abort(new Error('模拟取消探测'))
  await expect(probeAgyAcp(setup().config, controller.signal)).rejects.toThrow('模拟取消探测')
})
it('模拟：缺模型目录和强度回读失败均在输入前停止', async () => {
  for (const [scenario, preference] of [
    ['normal', { model: 'simulated-missing', effort: 'low' }],
    ['effort-mismatch', { model: 'simulated-low', effort: 'high' }],
  ] as const) {
    const r = await run(setup(scenario, { preference }))
    expect(r.result.status).toBe('ERROR')
    expect(r.rows.some(x => x.method === 'session/prompt')).toBe(false)
  }
})

it.each([
  ['account-auto', 'available', true],
  ['normal', 'available', true],
  ['host-sandboxless', 'unavailable', false],
  ['probe-silent', undefined, false],
] as const)('模拟：%s 的零输入沙箱报告决定自动审批是否跳过确认', async (scenario, report, skip) => {
  const f = setup(scenario, { conversationId: 'simulated-session' }), r = await run(f)
  expect(r.result.status).toBe('SUCCESS')
  const [probe, acp, ...rest] = r.rows.filter(x => x.start)
  expect(rest).toHaveLength(0)
  // The probe is a stream start that never receives input or the bound conversation.
  expect(probe.argv).toEqual(expect.arrayContaining(['--mode', 'auto', '--sandbox']))
  expect(probe.argv).not.toContain('--conversation')
  expect(r.rows.filter(x => x.event === 'user')).toHaveLength(0)
  expect(() => process.kill(probe.start, 0)).toThrow()
  // The probe's warning decides the argv but is not reported as the run's CLI diagnostics.
  expect(r.stderr).not.toMatch(/--mode auto is not available/)
  expect(acp.argv).toContain('acp')
  expect(acp.argv.includes('--dangerously-skip-permissions')).toBe(skip)
  expect(acp.argv.includes('--sandbox')).toBe(report === 'available' || (report === undefined && process.platform !== 'win32'))
  const notice = r.frames.find(x => x.event?.kind === 'diagnostic' && /自动审批/.test(x.event.text))?.event.text
  expect(notice).toContain(report === 'available' ? '有终端沙箱' : report === 'unavailable' ? '没有终端沙箱' : '未能确认')
})
it('模拟：完全权限不做沙箱探测', async () => {
  const r = await run(setup('normal', { access: 'danger-full-access' }))
  expect(r.result.status).toBe('SUCCESS')
  expect(r.rows.filter(x => x.start).map(x => x.argv.includes('acp'))).toEqual([true])
})
