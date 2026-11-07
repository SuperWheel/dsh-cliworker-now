import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { runNativeWorkBuddy, probeWorkBuddyMetadata, workbuddyAcpArgv, workbuddyEffortOptions } from '../src/host/native-workbuddy.mjs'
import { createNativeIO } from '../src/host/native-transport.mjs'

const roots: string[] = []
const fakeKey = Buffer.alloc(32, 0x5a).toString('base64')
const fakeDerived = createHash('sha256').update(fakeKey).digest('base64')
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const source = String.raw`
// 模拟 WorkBuddy CLI: no real app, binding, account, credentials or model.
import {createServer,createConnection} from 'node:net';
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
const env=process.env, scenario=env.SCENARIO;
const audit=value=>appendFileSync(env.AUDIT,JSON.stringify(value)+'\n',{mode:0o600});
const out=value=>process.stdout.write(JSON.stringify(value)+'\n');
const reply=(request,result)=>out({jsonrpc:'2.0',id:request.id,result});
const reject=(request,message,code=-32603)=>out({jsonrpc:'2.0',id:request.id,error:{code,message}});
const sessionId='simulated-workbuddy-session';
const update=update=>out({jsonrpc:'2.0',method:'session/update',params:{sessionId,update}});
const model={id:'model',currentValue:'before',options:[{value:'before'},{value:'auto'},{value:'native-model'}]};
const mode={id:'mode',currentValue:'default',options:['default','auto','plan','bypassPermissions','fullAccess'].map(value=>({value}))};
// Per-model thought_level lists, shaped like WorkBuddy 5.9.3 (auto: full; others narrower).
const thoughtFor={before:['enabled','minimal','low','medium','high','xhigh','max','not-supported'],auto:['enabled','minimal','low','medium','high','xhigh','max','not-supported'],
 'native-model':['enabled','low','high','disabled'],'meta-model':['enabled','low','high','max']};
const thought={id:'thought_level',currentValue:'enabled',options:thoughtFor.before.map(value=>({value}))};
if(scenario==='missing-bypass')mode.options=mode.options.filter(x=>x.value!=='bypassPermissions');
if(scenario==='missing-auto')mode.options=mode.options.filter(x=>!['auto','bypassPermissions'].includes(x.value));
if(scenario==='missing-plan')mode.options=mode.options.filter(x=>x.value!=='plan');
if(scenario==='missing-model')model.options=[];
if(scenario==='missing-effort')thought.options=[{value:'enabled'}];
const available=[{modelId:'auto',name:'Auto'},{modelId:'native-model',name:'Native model'}];
if(scenario==='per-model'||scenario==='model-option-error'){model.options.push({value:'meta-model'});available.push({modelId:'meta-model',name:'Meta model',_meta:{effortOptions:['low','max']}});}
const state={sessionId,models:{availableModels:available},configOptions:[model,mode,thought]};
let ready=false,pending;
audit({fixture:'模拟',pid:process.pid,argv:process.argv.slice(2),bootstrap:env.CODEBUDDY_SIDECAR_CREDENTIAL_BOOTSTRAP_SOCKET,readyPath:env.CODEBUDDY_SIDECAR_READY_SOCKET,
 configDir:env.CODEBUDDY_CONFIG_DIR,sameRoot:env.CODEBUDDY_CONFIG_DIR===env.WORKBUDDY_CONFIG_DIR,
 proxyRemoved:!Object.keys(env).some(key=>/^(https?_proxy|all_proxy|no_proxy)$/i.test(key)),
 authRemoved:!env.CODEBUDDY_API_KEY&&!env.CODEBUDDY_AUTH_TOKEN,
 cron:env.CODEBUDDY_DISABLE_CRON,autoUpdate:env.DISABLE_AUTOUPDATER});
process.on('exit',code=>audit({exit:code}));
if(scenario==='exit-early')process.exit(23);
const banners=scenario==='banner-lines'?33:1;
for(let i=0;i<banners;i++)process.stdout.write('Gateway password: SIMULATED_GATEWAY_PASSWORD\n');
if(scenario==='banner-bytes')process.stdout.write('B'.repeat(16385));
const bootstrap=createServer(socket=>{
 let buffer='';socket.on('data',chunk=>{
  buffer+=chunk.toString();if(!buffer.includes('\n'))return;
  const wire=JSON.parse(buffer.trim());
  const valid=Object.keys(wire).sort().join(',')==='bootstrap,pid,sessionId,token,version'&&wire.version===1&&wire.pid===process.pid&&wire.sessionId===env.CODEBUDDY_SIDECAR_READY_SESSION_ID&&wire.token===env.CODEBUDDY_SIDECAR_READY_TOKEN;
  audit({bootstrapValid:valid,policy:wire.bootstrap.policy});
  socket.end(JSON.stringify({ok:valid,policy:'fields'})+'\n');
  bootstrap.close(()=>{
   if(scenario==='ready-timeout')return;
   const client=createConnection(env.CODEBUDDY_SIDECAR_READY_SOCKET);
   client.on('error',()=>{});
   client.once('connect',()=>client.write(JSON.stringify({jsonrpc:'2.0',id:'ready',method:'session.ready',params:{protocolVersion:1,token:env.CODEBUDDY_SIDECAR_READY_TOKEN,sessionId:env.CODEBUDDY_SIDECAR_READY_SESSION_ID,pid:scenario==='wrong-pid'?process.pid+1:process.pid,port:45678}})+'\n'));
   client.on('data',chunk=>{if(JSON.parse(chunk.toString()).result?.ok)ready=true;});
  });
 });
});
bootstrap.listen(env.CODEBUDDY_SIDECAR_CREDENTIAL_BOOTSTRAP_SOCKET);
createInterface({input:process.stdin}).on('line',line=>{
 const request=JSON.parse(line);audit(request);
 if(!request.method){
  if(pending){
   const allowed=request.result?.outcome?.optionId==='allow';
   update({sessionUpdate:'tool_call_update',toolCallId:'call',status:allowed?'completed':'failed'});
   reply(pending,{stopReason:allowed?'end_turn':'cancelled',_meta:{'codebuddy.ai/outcome':allowed?'OK':'PERMISSION_DENIED'}});pending=undefined;
  }return;
 }
 if(!ready){audit({beforeReady:true});process.exit(25);}
 if(request.method==='initialize'){
  if(scenario==='invalid-after-ready')process.stdout.write('not-json-after-ready\n');
  return reply(request,{protocolVersion:1,agentCapabilities:{loadSession:true,promptCapabilities:{image:true}}});
 }
 if(request.method==='session/new'||request.method==='session/load'){
  if(scenario==='probe-cancel'){out({jsonrpc:'2.0',method:'simulated/wait'});return;}
  if(scenario==='auth')return reject(request,'simulated authentication required',-32001);
  if(scenario==='resume-error')return reject(request,'simulated restore failed');
  return reply(request,state);
 }
 if(request.method==='session/set_config_option'){
  const option=state.configOptions.find(value=>value.id===request.params.configId);
  if(!option)return reject(request,'simulated unknown option');
  if(scenario==='model-option-error'&&option.id==='model'&&request.params.value==='native-model')return reject(request,'simulated model switch rejected',-32602);
  if(option.id==='thought_level'&&!option.options.some(value=>value.value===request.params.value))return reject(request,'simulated effort not offered',-32602);
  if(option.id==='model'&&thoughtFor[request.params.value]){thought.options=thoughtFor[request.params.value].map(value=>({value}));if(scenario==='missing-effort')thought.options=[{value:'enabled'}];
   if(!thought.options.some(value=>value.value===thought.currentValue))thought.currentValue='enabled';}
  option.currentValue=scenario==='unconfirmed-model'&&option.id==='model'?'wrong':request.params.value;
  return reply(request,{configOptions:state.configOptions});
 }
 if(request.method==='session/prompt'){
  update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'SIMULATED ANSWER'}});
  if(scenario==='cancel'){pending=request;return;}
  if(scenario==='permission'||scenario==='allow'){
   update({sessionUpdate:'tool_call',toolCallId:'call',title:'Run simulated command',kind:'execute',locations:[{path:'/simulated/file'}],status:'pending'});
   pending=request;
   return out({jsonrpc:'2.0',id:'permission',method:'session/request_permission',params:{sessionId,toolCall:{toolCallId:'call',rawInput:{command:'simulated echo'}},options:[{kind:'allow_once',optionId:'allow'},{kind:'allow_always',optionId:'allow_always'},{kind:'reject_once',optionId:'reject'}]}});
  }
  if(scenario==='unknown-request')out({jsonrpc:'2.0',id:'unknown',method:'fs/write',params:{}});
  return reply(request,{stopReason:'end_turn'});
 }
 if(request.method==='session/cancel'){audit({cancelled:true});if(pending)reply(pending,{stopReason:'cancelled'});pending=undefined;return;}
 reject(request,'simulated unknown request');
}).on('close',()=>{bootstrap.close();});
`

async function fixture(scenario = 'success', options: any = {}) {
  const root = await mkdtemp(join(tmpdir(), 'wbr-')); roots.push(root)
  const app = join(root, 'Simulated.app'), cliRoot = join(app, 'Contents', 'Resources', 'app.asar.unpacked', 'cli')
  const runtime = join(app, 'Contents', 'MacOS', 'Electron'), entry = join(cliRoot, 'dist', 'codebuddy-lite-wb.mjs')
  await mkdir(dirname(runtime), { recursive: true, mode: 0o700 })
  await mkdir(dirname(entry), { recursive: true, mode: 0o700 })
  await symlink(process.execPath, runtime)
  await writeFile(entry, source, { mode: 0o600 })
  await writeFile(join(cliRoot, 'package.json'), JSON.stringify({ name: options.package ?? '@genie/agent-cli', version: '2.165.0' }), { mode: 0o600 })
  await writeFile(join(cliRoot, 'product.json'), JSON.stringify({ productName: '模拟 WorkBuddy', endpoint: options.endpoint ?? (options.cli === 'workbuddy' ? 'https://www.workbuddy.ai' : 'https://www.workbuddy.cn'), dataFolderName: '.simulated-workbuddy' }), { mode: 0o600 })
  const helper = join(root, 'simulated-helper.cjs')
  await writeFile(helper, `// 模拟 helper binding, no real private binding.\nconst {runWorkBuddyKeyHelper}=require(${JSON.stringify(resolve('src/host/workbuddy-key-helper.cjs'))});\nrunWorkBuddyKeyHelper({readBinding:()=>${scenario === 'helper-error' ? '{throw new Error("SIMULATED SECRET ERROR")}' : '({version:1,atRestSecretKey:Buffer.alloc(32,0x5a).toString("base64")})'}}).then(()=>{process.stdin.destroy()});`, { mode: 0o600 })
  const audit = join(root, 'audit.ndjson'), frames: any[] = [], children: any[] = [], controller = new AbortController()
  let stderr = '', error: any, metadata: any
  const config: any = { cli: options.cli ?? 'workbuddycn', argv: [runtime, entry, '--acp'], home: root, project: root,
    prompt: '模拟任务', preference: { model: options.model ?? 'native-model', effort: options.effort ?? 'high' }, mode: options.mode ?? 'accept-edits',
    access: options.access ?? 'read-only', maxLineBytes: 1048576, maxRunBytes: 8388608, timeoutMs: scenario === 'ready-timeout' ? 80 : 2000,
    env: { SCENARIO: scenario, AUDIT: audit, HTTP_PROXY: 'simulated', hTtPs_PrOxY: 'simulated', CODEBUDDY_API_KEY: fakeKey },
    ...(options.resume ? { conversationId: 'simulated-workbuddy-session' } : {}), approvalNonce: 'simulated-approval' }
  const io: any = createNativeIO(config, (line: string) => {
    const frame = JSON.parse(line); frames.push(frame)
    if (frame.type === 'approval') void io.answerApproval(JSON.stringify({ decision: scenario === 'allow' ? 'allow-once' : 'deny', source: 'user' }), frame.id)
    if (scenario === 'cancel' && frame.event?.kind === 'assistant') controller.abort(new Error('模拟停止'))
  }, controller.signal, (chunk: Buffer) => { stderr += chunk.toString() })
  const spawn = io.spawn
  io.spawn = (argv: string[], spawnOptions: any) => {
    // Only substitute the helper executable with a simulated binding wrapper.
    // The runner still performs real framing, sockets and child lifecycle handling.
    const onStdout = spawnOptions.onStdout
    const child = spawn(argv[1]?.endsWith('workbuddy-key-helper.cjs') ? [runtime, helper] : argv, { ...spawnOptions,
      onStdout(chunk: Buffer) {
        onStdout?.(chunk)
        if (scenario === 'probe-cancel' && chunk.toString().includes('simulated/wait'))
          controller.abort(new Error('模拟目录查询停止'))
      } })
    children.push(child)
    return child
  }
  let abortTimer: ReturnType<typeof setTimeout> | undefined
  if (scenario === 'abort-bootstrap') abortTimer = setTimeout(() => controller.abort(new Error('模拟启动期停止')), 20)
  try {
    if (options.probe) metadata = await probeWorkBuddyMetadata(config, io)
    else await runNativeWorkBuddy(config, io)
  } catch (caught) { error = caught }
  finally {
    clearTimeout(abortTimer)
    if (options.probe) await io.stopChildren()
    else await io.close(error)
  }
  const log = await readFile(audit, 'utf8').catch(() => '')
  const records = log.trim() ? log.trim().split('\n').map(line => JSON.parse(line)) : []
  const publicText = JSON.stringify({ frames, log, stderr, error: error?.message, metadata })
  for (const secret of [fakeKey, fakeDerived, 'SIMULATED_GATEWAY_PASSWORD', 'SIMULATED SECRET ERROR']) expect(publicText.includes(secret)).toBe(false)
  expect(children.every(child => child.process.exitCode !== null || child.process.signalCode !== null)).toBe(true)
  const start = records.find(record => record.fixture)
  if (start) await expect(readFile(start.readyPath)).rejects.toMatchObject({ code: 'ENOENT' })
  return { config, root, frames, records, error, metadata, result: frames.at(-1), children }
}
const methods = (records: any[], method: string) => records.filter(record => record.method === method)
const selection = (records: any[], id: string) => methods(records, 'session/set_config_option').filter(record => record.params.configId === id).map(record => record.params.value)

describe('模拟 WorkBuddy ACP runner', () => {
  it.each(['workbuddycn', 'workbuddy'])('模拟 %s 引导后确认模型与强度再发 prompt', async cli => {
    const f = await fixture('success', { cli })
    expect(f.result).toMatchObject({ status: 'SUCCESS', response: 'SIMULATED ANSWER' })
    expect(f.records.find(record => record.fixture)).toMatchObject({ sameRoot: true, proxyRemoved: true, authRemoved: true, cron: '1', autoUpdate: '1' })
    expect(f.records.find(record => record.bootstrapValid)).toMatchObject({ bootstrapValid: true, policy: 'fields' })
    expect(f.records.some(record => record.beforeReady)).toBe(false)
    expect(selection(f.records, 'model')).toEqual(['native-model'])
    expect(selection(f.records, 'thought_level')).toEqual(['high'])
    expect(methods(f.records, 'session/new')[0].params.mcpServers).toEqual([])
    expect(f.children).toHaveLength(2)
  })
  it('模拟固定 argv 不包含用户注入的权限、提示词或其他服务参数', () => {
    const argv = workbuddyAcpArgv({ cli: 'workbuddycn', project: '/simulated', argv: ['/simulated/Electron', '/simulated/dist/codebuddy-lite-wb.mjs', '--full-access', '--host', '0.0.0.0'] })
    expect(argv.slice(2)).toEqual(['--acp', '--setting-sources', 'user', '--strict-mcp-config', '--serve', '--host', '127.0.0.1', '--port', '0', '--auth', 'password'])
  })
  it.each([
    { access: 'read-only', expected: [] }, { access: 'workspace-write', expected: ['auto'] },
    { access: 'danger-full-access', expected: ['bypassPermissions'] }, { access: 'danger-full-access', mode: 'plan', expected: ['plan'] },
  ])('模拟三档与规划模式 %#', async options => {
    const f = await fixture('success', options)
    expect(f.result.status).toBe('SUCCESS')
    expect(selection(f.records, 'mode')).toEqual(options.expected)
    expect(selection(f.records, 'mode')).not.toContain('fullAccess')
  })
  it.each([['missing-bypass', 'auto'], ['missing-auto', 'default']])('模拟权限降级 %s', async (scenario, mode) => {
    const f = await fixture(scenario, { access: 'danger-full-access' })
    expect(f.result.status).toBe('SUCCESS'); expect(selection(f.records, 'mode')).toEqual([mode])
    expect(f.frames.some(frame => frame.event?.text.includes('原生权限模式不可用'))).toBe(true)
  })
  it('模拟默认强度不设置 thought_level，原生 auto 模型 ID 保留', async () => {
    const f = await fixture('success', { effort: 'default', model: 'auto' })
    expect(f.result.status).toBe('SUCCESS'); expect(selection(f.records, 'thought_level')).toEqual([])
    expect(selection(f.records, 'model')).toEqual(['auto'])
  })
  it.each(['missing-model', 'unconfirmed-model', 'missing-effort', 'missing-plan'])('模拟不支持的选型不发 prompt %s', async scenario => {
    const f = await fixture(scenario, { mode: scenario === 'missing-plan' ? 'plan' : 'accept-edits' })
    expect(f.result.status).toBe('ERROR'); expect(methods(f.records, 'session/prompt')).toEqual([])
  })
  it.each([{ effort: 'none' }, { access: 'fullAccess' }, { mode: 'unknown' }])('模拟未支持的参数在启动前拒绝 %#', async options => {
    const f = await fixture('success', options)
    expect(f.result.status).toBe('ERROR'); expect(f.children).toEqual([])
  })
  it('模拟权限标题由 tool_call 补全，拒绝终态保留可续聊会话', async () => {
    const f = await fixture('permission')
    // deniedCancelEndsTurn: a denied operation ends the turn, neither a user stop nor a success.
    expect(f.result).toMatchObject({ status: 'SUCCESS' })
    expect(JSON.stringify(f.result)).toContain('因拒绝审批而结束')
    expect(f.frames.some(frame => frame.event?.kind === 'tool' && frame.event.state === 'FAILED')).toBe(true)
    expect(f.frames.find(frame => frame.type === 'approval').request).toMatchObject({ summary: 'Run simulated command', kind: 'command', detail: 'simulated echo', allowSession: false })
    expect(f.frames.find(frame => frame.type === 'session').id).toBe('simulated-workbuddy-session')
    expect(f.records.find(record => record.id === 'permission' && record.result).result.outcome.optionId).toBe('reject')
  })
  it('模拟允许一次只映射 allow_once', async () => {
    const f = await fixture('allow')
    expect(f.result.status).toBe('SUCCESS')
    expect(f.records.find(record => record.id === 'permission' && record.result).result.outcome.optionId).toBe('allow')
  })
  it('模拟续聊只 load，恢复失败不 new', async () => {
    const success = await fixture('success', { resume: true })
    expect(success.result.status).toBe('SUCCESS'); expect(methods(success.records, 'session/new')).toEqual([])
    expect(methods(success.records, 'session/load')[0].params.sessionId).toBe('simulated-workbuddy-session')
    const failure = await fixture('resume-error', { resume: true })
    expect(failure.result.status).toBe('ERROR'); expect(methods(failure.records, 'session/new')).toEqual([])
    expect(methods(failure.records, 'session/prompt')).toEqual([])
  })
  it('模拟用户取消发送 session/cancel 并等待所有子进程退出', async () => {
    const f = await fixture('cancel')
    expect(f.result.status).toBe('ERROR'); expect(JSON.stringify(f.result)).not.toContain('因拒绝审批而结束')
    expect(methods(f.records, 'session/cancel')).toHaveLength(1)
  })
  it.each(['helper-error', 'wrong-pid', 'ready-timeout', 'banner-lines', 'banner-bytes', 'exit-early', 'abort-bootstrap'])('模拟启动失败清理 %s', async scenario => {
    const f = await fixture(scenario)
    expect(f.result.status).toBe('ERROR'); expect(f.result.error).toContain('WorkBuddy 暂不可用：')
    expect(methods(f.records, 'initialize')).toEqual([])
  })
  it('模拟 ready 后非 JSON 仍由原生 peer 拒绝', async () => {
    const f = await fixture('invalid-after-ready')
    expect(f.result.status).toBe('ERROR'); expect(methods(f.records, 'session/prompt')).toEqual([])
  })
  it.each([{ endpoint: 'https://www.workbuddy.ai' }, { package: '@other/cli' }])('模拟启动前重读身份失败不启动进程 %#', async options => {
    const f = await fixture('success', options)
    expect(f.result.status).toBe('ERROR'); expect(f.children).toEqual([])
  })
  it('模拟未知 ACP 请求拒绝', async () => {
    const f = await fixture('unknown-request')
    expect(f.records.find(record => record.id === 'unknown' && record.error)?.error.code).toBe(-32601)
  })
})

describe('模拟 WorkBuddy 目录与按模型强度', () => {
  it('模拟目录只 initialize/new/切换模型，按模型给出强度且不发 prompt', async () => {
    const f = await fixture('per-model', { probe: true })
    expect(f.error).toBeUndefined()
    expect(f.records.filter(record => record.method).map(record => record.method)).toEqual(['initialize', 'session/new',
      'session/set_config_option', 'session/set_config_option', 'session/set_config_option'])
    expect(selection(f.records, 'model')).toEqual(['auto', 'native-model', 'meta-model'])
    expect(f.metadata).toMatchObject({ authenticated: true, endpoint: 'https://www.workbuddy.cn' })
    expect(Object.fromEntries(f.metadata.models.map((model: any) => [model.id, model.efforts]))).toEqual({
      auto: ['default', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      // 'disabled' and unknown values are never offered; `default` leaves thought_level untouched.
      'native-model': ['default', 'low', 'high'],
      // A declared _meta.effortOptions narrows the switched model's thought_level.
      'meta-model': ['default', 'low', 'max'],
    })
  })
  it('模拟某模型切换被拒时只保留原生默认，不借用其他模型的强度', async () => {
    const f = await fixture('model-option-error', { probe: true })
    expect(f.error).toBeUndefined(); expect(methods(f.records, 'session/prompt')).toEqual([])
    expect(f.metadata.models.find((model: any) => model.id === 'native-model').efforts).toEqual(['default'])
    expect(f.metadata.models.find((model: any) => model.id === 'meta-model').efforts).toEqual(['default', 'low', 'max'])
  })
  it('模拟强度不在所选模型的列表中时不沿用、不发 prompt', async () => {
    const f = await fixture('success', { model: 'native-model', effort: 'medium' })
    expect(f.result.status).toBe('ERROR'); expect(methods(f.records, 'session/prompt')).toEqual([])
    expect(selection(f.records, 'model')).toEqual(['native-model'])
    expect(selection(f.records, 'thought_level')).toEqual([])
  })
  it('强度选项只取插件支持且原生公开的值', () => {
    const options = (values: string[]) => [{ id: 'thought_level', options: values.map(value => ({ value })) }]
    expect(workbuddyEffortOptions(options(['enabled', 'high']))).toEqual(['default', 'high'])
    expect(workbuddyEffortOptions(options(['disabled', 'high', 'xhigh', 'enabled']))).toEqual(['default', 'high', 'xhigh'])
    expect(workbuddyEffortOptions(options(['low', 'high', 'max']), ['high'])).toEqual(['default', 'high'])
    expect(workbuddyEffortOptions(undefined)).toEqual(['default'])
    expect(workbuddyEffortOptions([{ id: 'model', options: [{ value: 'high' }] }])).toEqual(['default'])
  })
  it('模拟未登录返回桌面端登录指引', async () => {
    const f = await fixture('auth', { probe: true })
    expect(f.error).toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED', message: '请打开 WorkBuddy 桌面端登录后重试' })
    expect(methods(f.records, 'session/prompt')).toEqual([])
  })
  it('模拟目录查询中断终止等待并确认子进程退出', async () => {
    const f = await fixture('probe-cancel', { probe: true })
    expect(f.error).toBeDefined()
    expect(f.metadata).toBeUndefined()
    expect(methods(f.records, 'session/prompt')).toEqual([])
    expect(methods(f.records, 'session/new')).toHaveLength(1)
  })
})
