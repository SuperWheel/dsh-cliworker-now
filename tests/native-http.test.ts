import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, realpath, rm, writeFile, mkdir, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { createServer } from 'node:http'
import { extractTelemetry } from '../src/host/telemetry.ts'
import { nativeTelemetryProjections } from '../src/client/harness-telemetry-data.ts'
// Native protocols below are simulated by explicit local fixture processes.
import { createNativeIO } from '../src/host/native-transport.mjs'
import { runNativeOpenCode } from '../src/host/native-opencode.mjs'
import { serverConfiguration } from '../src/host/native-session-http.mjs'
import { runNativeMimo } from '../src/host/native-mimo.mjs'
import { runNativeHermes } from '../src/host/native-hermes.mjs'
import { cleanupHermesHttpHome, prepareHermesHttpHome } from '../src/host/native-hermes-home.mjs'
import { startSessionServer } from '../src/host/native-http.mjs'
import { BridgeProtocol } from '../src/host/bridge-protocol.ts'
import { foldEvents, type WorkerEvent } from '../src/shared/types.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const fixture = String.raw`
import { createServer } from 'node:http'
import { writeFileSync, readFileSync } from 'node:fs'
const cli=process.env.CWN_FIXTURE_CLI, mode=process.env.CWN_FIXTURE_MODE, records=[]
const record=value=>{records.push(value);writeFileSync(process.env.CWN_FIXTURE_RECORD,JSON.stringify(records))}
const hermes=cli==='hermes', name=cli==='mimo'?'MIMOCODE':'OPENCODE', username=cli==='mimo'?'mimocode':'opencode'
const expected=hermes?'Bearer '+process.env.API_SERVER_KEY:'Basic '+Buffer.from(username+':'+process.env[name+'_SERVER_PASSWORD']).toString('base64')
let sse, prompt, denied=false
const sid=hermes?'api_SYNTHETIC':'ses_SYNTHETIC', aid='msg_SYNTHETIC_ASSISTANT', run='run_SYNTHETIC'
const info=()=>({id:aid,sessionID:sid,role:'assistant',parentID:prompt?.messageID,providerID:'synthetic',modelID:'model',variant:'low',time:{created:1,completed:2},finish:'stop',tokens:{input:2,output:3,reasoning:0,cache:{read:0,write:0}},cost:0,path:{cwd:process.cwd(),root:process.cwd()},agent:'build',mode:'build'})
const part={id:'prt_SYNTHETIC',sessionID:sid,messageID:aid,type:'text',text:mode==='fragmented'?'开发任务， 好的':'模拟正文'}
const second={...part,id:'prt_SECOND',text:'第二段'}
const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value))}
const LF=String.fromCharCode(10)
function emit(values){sse.write(values.map(value=>'data: '+JSON.stringify(value)+LF+LF).join(''))}
const server=createServer(async(req,res)=>{
 let text='';for await(const chunk of req)text+=chunk
 const body=text?JSON.parse(text):undefined, path=new URL(req.url,'http://localhost').pathname
 record({method:req.method,path,body,authenticated:req.headers.authorization===expected})
 if(req.headers.authorization!==expected)return json(res,{error:'synthetic auth failure'},401)
 if(path==='/v1/capabilities')return json(res,{object:'hermes.api_server.capabilities',auth:{type:'bearer',required:true},features:{run_submission:true,run_status:true,run_events_sse:true,run_stop:true,run_steer:mode!=='steer-unsupported',run_approval_response:true,session_resources:true}})
 if(path==='/doc')return json(res,mode==='incomplete-spec'?{info:{version:'0.0.3'},paths:{'/auth/{providerID}':{},'/log':{}}}:{paths:{'/event':{},'/session/{sessionID}/prompt_async':{},'/session/{sessionID}/abort':{}}})
 if(path==='/global/health')return json(res,{healthy:true,version:'0.1.15'})
 if(path==='/session'&&req.method==='GET')return json(res,[])
 if(path==='/config'&&mode==='context-relay')return json(res,JSON.parse(process.env[name+'_CONFIG_CONTENT']||'{}'))
 if(path==='/provider'&&mode==='context-relay'){
   const config=JSON.parse(process.env[name+'_CONFIG_CONTENT']||'{}'),baseURL=config.provider?.synthetic?.options?.baseURL||process.env.CWN_FIXTURE_PROVIDER_BASE
   return json(res,{all:[{id:'synthetic',options:{baseURL},models:{model:{id:'model',variants:{low:{}},limit:{context:128000},api:{id:'synthetic-api-model',npm:'@ai-sdk/openai-compatible',url:process.env.CWN_FIXTURE_PROVIDER_BASE}}}}]})
 }
 if(path==='/provider')return json(res,{all:[{id:'synthetic',models:{model:{id:'model',variants:{low:{}},limit:{context:128000}}}}]})
 if(path==='/session'&&req.method==='POST')return json(res,{id:sid,directory:process.cwd()})
 if(path==='/session/'+sid&&req.method==='GET')return json(res,{id:sid,directory:process.cwd()})
 if(path==='/api/sessions'&&req.method==='POST')return json(res,{session:{id:sid,source:'api_server'}},201)
 if(path==='/api/sessions/'+sid)return json(res,{session:{id:mode==='wrong-session'?'api_OTHER':sid,source:mode==='foreign-session'?'cli':'api_server'}})
 if(path==='/event'){
   sse=res;res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders();res.write(': synthetic fixture'+LF+LF);return
 }
 if(path==='/session/'+sid+'/prompt_async'){
   prompt=body
   if(mode==='context-relay'){
     const config=JSON.parse(process.env[name+'_CONFIG_CONTENT']||'{}'),baseURL=config.provider?.synthetic?.options?.baseURL||process.env.CWN_FIXTURE_PROVIDER_BASE
     const simulated=await fetch(baseURL+'/chat/completions',{method:'POST',headers:{'content-type':'application/json','x-session-affinity':sid,authorization:'Bearer SIMULATED-not-a-real-key'},body:JSON.stringify({model:'synthetic-api-model',messages:[{role:'system',content:'SIMULATED native system'},{role:'user',content:body.parts[0].text}],tools:[{type:'function',function:{name:'Read',parameters:{type:'object'}}}]})})
     await simulated.arrayBuffer()
   }
   res.writeHead(204);res.end()
   const start=info();if(mode==='wrong-model')start.modelID='other'
   const values=[{type:'message.updated',properties:{info:{...start,id:'msg_HISTORY',parentID:'msg_HISTORY_USER'}}},
    {type:'message.part.delta',properties:{sessionID:sid,messageID:'msg_HISTORY',partID:'prt_HISTORY',field:'text',delta:'不应显示的旧消息'}},
    {type:'message.updated',properties:{info:start}},
    {type:'message.part.updated',properties:{part:{...part,text:''}}},
    ...((mode==='fragmented'?['开','发','任','务','，',' ','好','的']:mode==='snapshot-tail'||mode==='final-tail'?['模拟']:['模拟正文']).map(delta=>({type:'message.part.delta',properties:{sessionID:sid,messageID:aid,partID:part.id,field:'text',delta}})))]
   if(mode==='snapshot-tail'||mode==='duplicate-snapshot'||mode==='snapshot-conflict')for(let i=0;i<2;i++)values.push({type:'message.part.updated',properties:{part:{...part,text:mode==='snapshot-conflict'?'矛盾内容':part.text,time:{end:2}}}})
   if(mode==='multi-part')values.push(
     {type:'message.part.updated',properties:{part:{id:'prt_TOOL',messageID:aid,sessionID:sid,type:'tool',tool:'read',state:{status:'completed'}}}},
     {type:'message.part.updated',properties:{part:{...second,text:''}}},
     {type:'message.part.delta',properties:{sessionID:sid,messageID:aid,partID:second.id,field:'text',delta:second.text}})
   if(mode==='multi-message')values.push(
     {type:'message.updated',properties:{info:{...start,id:'msg_SECOND'}}},
     {type:'message.part.updated',properties:{part:{...second,messageID:'msg_SECOND',text:''}}},
     {type:'message.part.delta',properties:{sessionID:sid,messageID:'msg_SECOND',partID:second.id,field:'text',delta:second.text}})
   if(mode.startsWith('permission'))values.push({type:'permission.asked',properties:{sessionID:sid,id:'per_SYNTHETIC',permission:'bash'}})
   if(mode==='tool-failure'||mode==='permission-tool-failure'||mode==='tool-recovered')for(const status of ['running','error'])values.push({type:'message.part.updated',properties:{part:{id:'prt_TOOL',messageID:aid,sessionID:sid,type:'tool',tool:'bash',state:{status}}}})
   if(mode==='tool-recovered')for(const status of ['running','completed'])values.push({type:'message.part.updated',properties:{part:{id:'prt_RETRY',messageID:aid,sessionID:sid,type:'tool',tool:'write',state:{status}}}})
   if(mode==='tools')for(const status of ['pending','running','completed','completed'])values.push({type:'message.part.updated',properties:{part:{id:'prt_TOOL',messageID:aid,sessionID:sid,type:'tool',tool:'read',state:{status}}}})
   if(mode==='budget-snapshots'){
     // SIMULATED growing public reasoning snapshots and cumulative/replacing tool snapshots.
     for(const text of ['旧','旧值','旧值完成'])values.push({type:'message.part.updated',properties:{part:{id:'prt_THOUGHT',messageID:aid,sessionID:sid,type:'reasoning',text}}});
     for(const output of ['旧','旧值','替换','替换完成'])values.push({type:'message.part.updated',properties:{part:{id:'prt_TOOL',messageID:aid,sessionID:sid,type:'tool',tool:'read',state:{status:'running',output}}}});
     values.push({type:'message.part.updated',properties:{part:{id:'prt_TOOL',messageID:aid,sessionID:sid,type:'tool',tool:'read',state:{status:'completed',output:'替换完成'}}}});
   }
   if(mode==='reasoning')values.push({type:'message.part.updated',properties:{part:{id:'prt_THOUGHT',messageID:aid,sessionID:sid,type:'reasoning',text:'',metadata:{anthropic:{signature:'OPAQUE_SIGNATURE_MUST_NOT_COPY'}}}}},
    {type:'message.part.delta',properties:{sessionID:sid,messageID:aid,partID:'prt_THOUGHT',field:'signature',delta:'OPAQUE_SIGNATURE_MUST_NOT_COPY'}},
    {type:'message.part.delta',properties:{sessionID:sid,messageID:aid,partID:'prt_THOUGHT',field:'text',delta:'公开'}} ,
    {type:'message.part.delta',properties:{sessionID:sid,messageID:aid,partID:'prt_THOUGHT',field:'text',delta:'思考'}})
   if(mode==='partial-failure')values.push({type:'session.error',properties:{sessionID:sid}})
   if(mode!=='cancel'&&mode!=='disconnect'&&mode!=='partial-failure')values.push({type:'session.idle',properties:{sessionID:sid}})
   if(mode==='late')values.push({type:'message.part.delta',properties:{sessionID:sid,messageID:aid,partID:part.id,field:'text',delta:'迟到'}})
   emit(values);if(mode==='disconnect')sse.end();return
 }
 if(path==='/session/'+sid+'/message')return json(res,[{info:info(),parts:mode==='multi-part'?[part,second]:[part]},...(mode==='multi-message'?[{info:{...info(),id:'msg_SECOND'},parts:[{...second,messageID:'msg_SECOND'}]}]:[])])
 if(path.startsWith('/permission/')){denied=true;return json(res,true)}
 if(path==='/session/'+sid+'/abort')return json(res,true)
 if(path==='/v1/runs'&&req.method==='POST'){prompt=body;return json(res,{run_id:run,status:'queued'},202)}
 if(path==='/v1/runs/'+run&&req.method==='GET')return json(res,{run_id:run,session_id:sid,status:mode==='cancel'?'running':mode.startsWith('run-')?mode.slice(4):'completed',output:['tool-boundary','final-unstreamed','interim-boundary'].includes(mode)?'第二段':part.text,runtime:{provider:mode==='wrong-model'?'other':'openrouter',model:'synthetic/model'},usage:{input_tokens:2,output_tokens:3,total_tokens:5}})
 if(path==='/v1/runs/'+run+'/events'){
   sse=res;res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders()
   const values=(mode==='fragmented'?['开','发','任','务','，',' ','好','的']:['模拟正文']).map((delta,i)=>({event:'message.delta',run_id:run,seq:i+1,delta}))
   if(mode.startsWith('permission'))values.push({event:'approval.request',run_id:run,seq:2,request_id:'approval_SYNTHETIC',command:'synthetic --flag',description:'模拟危险命令',choices:mode==='permission-session'?['once','session','always','deny']:['once','deny']})
   if(mode==='tool-failure'||mode==='permission-tool-failure'||mode==='tool-recovered')values.push({event:'tool.started',run_id:run,seq:3,tool:'terminal'},{event:'tool.failed',run_id:run,seq:4,tool:'terminal',error:true})
   if(mode==='tool-recovered')values.push({event:'tool.started',run_id:run,seq:5,tool:'write_file'},{event:'tool.completed',run_id:run,seq:6,tool:'write_file',error:false})
   if(mode==='tools')values.push({event:'tool.started',run_id:run,seq:2,tool:'read_file'},{event:'tool.completed',run_id:run,seq:3,tool:'read_file',error:false})
   if(mode==='tool-boundary'||mode==='final-unstreamed')values.push({event:'tool.started',run_id:run,seq:2,tool:'read_file'},{event:'tool.completed',run_id:run,seq:3,tool:'read_file',error:false})
   if(mode==='tool-boundary')values.push({event:'message.delta',run_id:run,seq:4,delta:'第'},{event:'message.delta',run_id:run,seq:5,delta:'二段'})
   if(mode==='interim-boundary')values.push({event:'message.interim',run_id:run,seq:2,text:'模拟正文',already_streamed:true},{event:'message.delta',run_id:run,seq:3,delta:'第二段'})
   if(mode==='unfinished-tool')values.push({event:'tool.started',run_id:run,seq:2,tool:'read_file'})
   if(mode==='reasoning')values.push({event:'reasoning.available',run_id:run,seq:2,text:'公开思考一'},{event:'reasoning.available',run_id:run,seq:3,text:'公开思考二'})
   if(mode.startsWith('steer-'))setTimeout(()=>emit([{event:'run.completed',run_id:run,seq:4,output:'模拟正文'}]),300)
   else if(mode!=='cancel'&&mode!=='disconnect')values.push({event:mode.startsWith('run-')?'run.'+mode.slice(4):'run.completed',run_id:run,seq:20,output:'模拟正文',usage:{input_tokens:2,output_tokens:3,total_tokens:5}})
   if(mode==='late')values.push({event:'message.delta',run_id:run,seq:5,delta:'迟到'})
   emit(values);if(mode==='disconnect')sse.end();return
 }
 if(path==='/v1/runs/'+run+'/steer'){
   if(mode==='steer-rejected')return json(res,{error:{code:'run_not_accepting_steer'}},409)
   if(mode==='steer-unknown')return json(res,{error:{code:'steer_failed'}},500)
   if(mode==='steer-terminal-first'){emit([{event:'run.completed',run_id:run,seq:4,output:'模拟正文'}]);setTimeout(()=>json(res,{object:'hermes.run.steer',run_id:run,accepted:true}),30);return}
   return json(res,{object:'hermes.run.steer',run_id:mode==='steer-wrong-run'?'run_OTHER':run,accepted:true})
 }
 if(path.endsWith('/approval'))return json(res,{run_id:run,choice:body.choice,resolved:1})
 if(path.endsWith('/stop'))return json(res,{run_id:run,status:'stopping'})
 return json(res,{error:'synthetic unknown route'},404)
})
if(hermes)record({gatewayConfig:readFileSync(process.env.HERMES_HOME+'/config.yaml','utf8'),authProvider:JSON.parse(readFileSync(process.env.HERMES_HOME+'/auth.json','utf8')).active_provider,sharedAuthDirectory:process.env.HERMES_SHARED_AUTH_DIR,args:process.argv.slice(2)})
server.listen(hermes?Number(process.env.API_SERVER_PORT):0,'127.0.0.1',()=>{
 if(!hermes)console.log((cli==='mimo'?'mimocode':'opencode')+' server listening on http://127.0.0.1:'+server.address().port)
 else console.log('[API Server] API server listening on http://127.0.0.1:'+server.address().port)
})
// Match the installed Hermes contract: SIGINT is planned; bare SIGTERM exits 1.
// Other HTTP CLIs retain their existing SIGTERM fixture contract.
process.on(hermes?'SIGINT':'SIGTERM',()=>{record({closed:true});server.closeAllConnections();server.close(()=>process.exit(0))})
if(hermes)process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit(1))})
`

async function setup(cli: 'opencode' | 'mimo' | 'hermes', mode = 'success') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cwn-native-http-SIMULATED-')))
  roots.push(root)
  const entry = join(root, 'synthetic-cli.mjs'),
    record = join(root, 'synthetic-requests.json'),
    source = join(root, 'own-account')
  await writeFile(entry, fixture, { mode: 0o600 })
  await mkdir(source, { mode: 0o700 })
  await writeFile(
    join(source, 'config.yaml'),
    'auth:\n  adopt_external_logins: false\nmodel:\n  provider: openrouter\n  default: synthetic/model\nplatforms:\n  telegram:\n    enabled: true\n',
    { mode: 0o600 },
  )
  await writeFile(
    join(source, 'auth.json'),
    JSON.stringify({ providers: {}, credential_pool: {}, version: 1 }),
    { mode: 0o600 },
  )
  await writeFile(
    join(source, '.env'),
    'OPENROUTER_API_KEY=synthetic-not-a-real-key\nTELEGRAM_BOT_TOKEN=synthetic-never-copy\n',
    { mode: 0o600 },
  )
  const config: any = {
    cli,
    argv: [
      process.execPath,
      entry,
      ...(cli === 'hermes' ? ['--in', root, 'chat', '-q', 'unused'] : ['run', '--model', 'synthetic/model']),
    ],
    env: { HERMES_HOME: source, CWN_FIXTURE_CLI: cli, CWN_FIXTURE_MODE: mode, CWN_FIXTURE_RECORD: record },
    project: root,
    prompt: '明确标注的模拟任务',
    preference: {
      model: cli === 'hermes' ? JSON.stringify(['openrouter', 'synthetic/model']) : 'synthetic/model',
      effort: 'low',
    },
    mode: 'accept-edits',
    stateDirectory: join(root, 'state'),
    timeoutMs: 5000,
    maxLineBytes: 1048576,
    maxRunBytes: 16777216,
  }
  return { config, record, root, source }
}
async function run(cli: 'opencode' | 'mimo' | 'hermes', mode = 'success', resume = false,
  guide?: (io: any, controller: AbortController) => Promise<void>, extraEnv: Record<string, string> = {},
  /** Simulated Host decision; enables the approval channel. */
  decision?: 'allow-once' | 'allow-session' | 'deny') {
  const task = await setup(cli, mode),
    frames: any[] = [],
    controller = new AbortController()
  Object.assign(task.config.env, extraEnv)
  if (resume) task.config.conversationId = cli === 'hermes' ? 'api_SYNTHETIC' : 'ses_SYNTHETIC'
  if (decision) task.config.approvalNonce = 'synthetic-nonce'
  const children: any[] = []
  let guidance: Promise<void> | undefined
  const io: any = createNativeIO(
    task.config,
    (line: string) => {
      const frame = JSON.parse(line)
      frames.push(frame)
      if (decision && frame.type === 'approval')
        setTimeout(() => void io.answerApproval(JSON.stringify({ decision, source: 'user' }), frame.id), 5)
      if (mode === 'cancel' && frame.type === 'event' && frame.event.kind === 'assistant') controller.abort()
      if (guide && !guidance && frame.type === 'event' && frame.event.kind === 'assistant') {
        guidance = guide(io, controller)
        void guidance.catch(() => {})
      }
    },
    controller.signal,
  )
  const nativeSpawn = io.spawn
  io.spawn = (...args: any[]) => {
    const child = nativeSpawn(...args)
    children.push(child)
    return child
  }
  let error
  try {
    await { opencode: runNativeOpenCode, mimo: runNativeMimo, hermes: runNativeHermes }[cli](task.config, io)
  } catch (issue) {
    error = issue
  }
  await io.close(error)
  // Node's Windows kill is TerminateProcess: the POSIX signal callback below
  // cannot write its receipt. Prove each actual owned child exited instead.
  for (const child of children) {
    await child.done
    expect(child.process.exitCode !== null || child.process.signalCode !== null).toBe(true)
    expect(() => process.kill(child.process.pid, 0)).toThrow()
  }
  await guidance
  const saved = await readFile(task.record, 'utf8').catch(() => {
    throw new Error(
      JSON.stringify({ result: frames.at(-1), stderr: children.map((child) => child.stderr()) }),
    )
  })
  return { ...task, frames, requests: JSON.parse(saved) }
}

function expectServerCloseReceipt(requests: any[]) {
  // Native range exit is asserted by run() on every platform. POSIX also
  // delivers the fixture's signal handler and therefore has this extra receipt.
  if (process.platform !== 'win32') expect(requests.at(-1)).toEqual({ closed: true })
}

function timeline(frames: any[]) {
  const events: WorkerEvent[] = []
  const bridge = new BridgeProtocol((event) => events.push({ ...event, seq: events.length + 1, time: '', runId: 'synthetic-run' }), () => {}, 1048576)
  for (const frame of frames) bridge.feed(JSON.stringify(frame) + '\n')
  bridge.end()
  return foldEvents(events)
}

describe('OpenCode / MiMo native HTTP + SSE (simulated local native processes)', () => {
  it.each(['opencode', 'mimo'] as const)(
    '%s: waits for the complete owned listener line before trusting its port',
    async (cli) => {
      let stdout!: (chunk: string) => void,
        stderr!: (chunk: string) => void,
        settled = false
      const result = startSessionServer(
        { argv: ['/synthetic-cli', 'run'], project: process.cwd(), timeoutMs: 1000 },
        {
          signal: new AbortController().signal,
          spawn: (_argv: string[], options: any) => {
            stdout = options.onStdout
            stderr = options.onStderr
            return { done: new Promise(() => {}), stop: async () => {} }
          },
        },
        cli,
      )
      void result.then(() => {
        settled = true
      })
      stdout(`${cli === 'mimo' ? 'mimocode' : 'opencode'} server listening on http://127.0.0.1:123`)
      stderr('Synthetic unrelated diagnostic\n')
      await Promise.resolve()
      expect(settled).toBe(false)
      stdout('45\r\n')
      expect((await result).base).toBe('http://127.0.0.1:12345')
    },
  )
  for (const cli of ['opencode', 'mimo'] as const) {
    it(`${cli}: validates its effective route and projects only numeric native request composition through the shared telemetry chain`, async () => {
      let calls = 0
      const provider = createServer(async (req, res) => { for await (const _chunk of req) {} calls++; res.setHeader('Content-Type', 'application/json'); res.end('{}') })
      await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
      try {
        const base = `http://127.0.0.1:${(provider.address() as any).port}/SIMULATED/v1`
        const { frames } = await run(cli, 'context-relay', false, undefined, { CWN_FIXTURE_PROVIDER_BASE: base, MIMOCODE_PURE: '1', OPENCODE_PURE: '1' })
        expect(frames.at(-1)).toMatchObject({ type: 'result', status: 'SUCCESS' })
        expect(calls).toBe(1)
        const records = frames.filter(frame => frame.type === 'native').map(frame => frame.record)
        const observation = records.filter(record => record.type === 'cliworker.http_context_observation')
        expect(observation).toHaveLength(2)
        expect(observation[0].breakdown).toBeNull()
        expect(observation[1].requestId).toBe(observation[0].requestId)
        expect(observation[1].breakdown).toMatchObject({ estimated: true, basis: 'native-chars-per-token-4' })
        expect(JSON.stringify(observation)).not.toMatch(/SIMULATED native system|SIMULATED-not-a-real-key|明确标注的模拟任务/)
        const telemetry = extractTelemetry(cli, records, { conversationId: 'ses_SYNTHETIC', model: 'synthetic/model' })
        expect(telemetry.contextUsed).toBe(2)
        expect(nativeTelemetryProjections(cli, telemetry).contextBreakdown).toEqual({ systemTokens: observation[1].breakdown.systemTokens, toolsTokens: observation[1].breakdown.toolTokens, messageTokens: observation[1].breakdown.messageTokens })
      } finally { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)) }
    })



    it(`${cli}: folds token-sized text into one reply, preserving punctuation and spaces`, async () => {
      const { frames } = await run(cli, 'fragmented')
      expect(timeline(frames).filter((row) => row.kind === 'assistant')).toMatchObject([{ text: '开发任务， 好的' }])
      expect(timeline(frames).filter((row) => row.kind === 'assistant')).toHaveLength(1)
      expect(frames.find((row) => row.type === 'native' && row.record.type === 'cliworker.model_context')?.record)
        .toMatchObject({ source: `${cli}.provider.limit.context`, providerID: 'synthetic', modelID: 'model', contextCapacity: 128000 })
    })
    it.each(['snapshot-tail', 'final-tail', 'duplicate-snapshot'])(`${cli}: reconciles %s without duplicate text`, async (mode) => {
      const { frames } = await run(cli, mode)
      const replies = timeline(frames).filter((row) => row.kind === 'assistant')
      expect(replies).toHaveLength(1)
      expect(replies[0]?.text).toBe('模拟正文')
    })
    it(`${cli}: preserves separate native parts around a tool`, async () => {
      const { frames } = await run(cli, 'multi-part')
      expect(timeline(frames).filter((row) => ['assistant', 'tool'].includes(row.kind)).map((row) => [row.kind, row.text]))
        .toEqual([['assistant', '模拟正文'], ['tool', 'read'], ['assistant', '第二段']])
    })
    it(`${cli}: preserves distinct native messages without adding aggregate separators to their text`, async () => {
      const { frames } = await run(cli, 'multi-message')
      expect(frames.at(-1).status).toBe('SUCCESS')
      expect(timeline(frames).filter((row) => row.kind === 'assistant').map((row) => row.text))
        .toEqual(['模拟正文', '第二段'])
    })
    it(`${cli}: rejects a conflicting snapshot and keeps one partial reply on failure`, async () => {
      for (const mode of ['snapshot-conflict', 'partial-failure']) {
        const { frames } = await run(cli, mode)
        expect(frames.at(-1).status).toBe('ERROR')
        expect(timeline(frames).filter((row) => row.kind === 'assistant')).toMatchObject([{ text: '模拟正文' }])
        expect(timeline(frames).filter((row) => row.kind === 'assistant')).toHaveLength(1)
      }
    })
    it(`${cli}: authenticates, selects exactly, filters history and waits for owned server exit`, async () => {
      const { frames, requests } = await run(cli)
      expect(frames.at(-1)).toMatchObject({ type: 'result', status: 'SUCCESS', response: '模拟正文' })
      expect(
        frames
          .filter((row) => row.type === 'event' && row.event.kind === 'assistant')
          .map((row) => row.event.text)
          .join(''),
      ).toBe('模拟正文')
      expect(requests.filter((row: any) => row.path).every((row: any) => row.authenticated)).toBe(true)
      expect(requests.find((row: any) => row.path?.endsWith('prompt_async')).body).toMatchObject({
        model: { providerID: 'synthetic', modelID: 'model' },
        variant: 'low',
        agent: 'build',
      })
      expect(requests.find((row: any) => row.path === '/session' && row.method === 'POST').body).toEqual({
        title: 'CLI Worker',
      })
      expectServerCloseReceipt(requests)
    })
    it(`${cli}: restores exactly the existing native session`, async () => {
      const { frames, requests } = await run(cli, 'success', true)
      expect(frames.at(-1).status).toBe('SUCCESS')
      expect(requests.some((row: any) => row.path === '/session' && row.method === 'POST')).toBe(false)
    })
    it(`${cli}: reconciles cumulative and replacing output snapshots`, async () => {
      // SIMULATED HTTP/SSE snapshots, no external service.
      const { frames } = await run(cli, 'budget-snapshots')
      expect(frames.at(-1).status).toBe('SUCCESS')
      const progress = frames.filter(frame => frame.event?.state === 'RUNNING' && ['tool', 'reasoning'].includes(frame.event.kind))
      expect(progress.filter(frame => frame.event.kind === 'tool')
        .map(frame => frame.event.delta ?? frame.event.toolCall.output)).toEqual(['旧', '值', '替换', '完成'])
      expect(progress.filter(frame => frame.event.kind === 'reasoning').map(frame => frame.event.delta)).toEqual(['旧', '值', '完成'])
      const rows = timeline(frames)
      expect(rows.find(row => row.kind === 'reasoning')?.detail).toBe('旧值完成')
      expect(rows.find(row => row.kind === 'tool')?.toolCall?.output).toBe('替换完成')
    })
    it(`${cli}: keeps a stable tool step and deduplicates identical snapshots`, async () => {
      const { frames } = await run(cli, 'tools')
      const tools = frames.filter((row) => row.type === 'event' && row.event.kind === 'tool')
      expect(frames.at(-1).status).toBe('SUCCESS')
      expect(tools.map((row) => row.event.step)).toEqual([1, 1, 1])
      expect(tools.map((row) => row.event.state)).toEqual(['RUNNING', 'RUNNING', 'COMPLETED'])
    })
    it(`${cli}: keeps cumulative public reasoning in the same timeline step`, async () => {
      const { frames } = await run(cli, 'reasoning')
      const reasoning = frames.filter((row) => row.type === 'event' && row.event.kind === 'reasoning')
      expect(frames.at(-1).status).toBe('SUCCESS')
      expect(new Set(reasoning.map((row) => row.event.step)).size).toBe(1)
      expect(reasoning.at(-1).event).toMatchObject({ detail: '公开思考', state: 'COMPLETED' })
      expect(JSON.stringify(frames)).not.toContain('OPAQUE_SIGNATURE_MUST_NOT_COPY')
    })
    it.each(['permission', 'permission-tool-failure'])(`${cli}: reports %s as uncertain when the turn completes`, async (mode) => {
      const { frames, requests } = await run(cli, mode)
      expect(frames.at(-1)).toMatchObject({
        status: 'UNCERTAIN', response: '模拟正文', resultScope: 'run',
        error: '原生额外授权已拒绝，但 CLI 报告本轮已完成；结果待核实，请先核查实际产物，不要自动重试',
      })
      expect(frames.some((row) => row.type === 'event' && row.event.kind === 'diagnostic' && row.event.text === '原生额外授权已拒绝')).toBe(true)
      expect(requests.find((row: any) => row.path?.startsWith('/permission/')).body.reply).toBe('reject')
      expect(requests.filter((row: any) => row.path?.endsWith('prompt_async'))).toHaveLength(1)
      expectServerCloseReceipt(requests)
    })
    it.each([
      ['allow-once', 'once', 'SUCCESS'],
      // `always` can outlive the session, so a session grant is never offered or sent.
      ['allow-session', 'once', 'SUCCESS'],
      ['deny', 'reject', 'UNCERTAIN'],
    ] as const)(`${cli}: relays permission.asked to the Host: %s → %s`, async (decision, reply, status) => {
      const { frames, requests } = await run(cli, 'permission', false, undefined, {}, decision)
      expect(frames.find((row) => row.type === 'approval').request).toEqual({ kind: 'command', summary: 'bash', allowSession: false })
      expect(requests.find((row: any) => row.path?.startsWith('/permission/')).body.reply).toBe(reply)
      expect(frames.at(-1).status).toBe(status)
      expectServerCloseReceipt(requests)
    })
    it(`${cli}: maps the DSH tier to the native permission rules, never wider`, () => {
      const base = { mode: 'accept-edits', preference: { model: 'synthetic/model' }, env: {} }
      const rules = (config: any) => JSON.parse(serverConfiguration(config, cli).env[`${cli === 'mimo' ? 'MIMOCODE' : 'OPENCODE'}_PERMISSION`])
      expect(rules({ ...base, access: 'workspace-write' })).toMatchObject({ '*': 'ask', edit: 'allow', bash: 'ask' })
      expect(rules({ ...base, access: 'danger-full-access' })).toMatchObject({ '*': 'allow', edit: 'allow', bash: 'allow', task: 'deny' })
      expect(rules({ ...base, mode: 'plan', access: 'danger-full-access' })).toMatchObject({ '*': 'ask', edit: 'deny', bash: 'deny' })
      for (const access of ['read-only', 'workspace-write', 'danger-full-access'])
        expect(rules({ ...base, mode: 'plan', access })).toMatchObject({ skill: 'allow', task: 'deny', question: 'deny' })
    })
    it(`${cli}: hands the user's own skill roots to the CLI, keeping the previous config`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'cwn-http-skills-'))
      try {
        const skills = join(root, cli === 'mimo' ? 'mimocode/skills' : 'opencode/skills')
        await mkdir(skills, { recursive: true })
        const name = cli === 'mimo' ? 'MIMOCODE' : 'OPENCODE'
        // OpenCode's Host launch already wrote the roots; MiMo's runner reads its real config root.
        const env = { XDG_CONFIG_HOME: root, ...(cli === 'opencode' ? { OPENCODE_CONFIG_CONTENT: JSON.stringify({ skills: { paths: [skills] }, plugin: [] }) } : {}) }
        const content = JSON.parse(serverConfiguration({ mode: 'plan', access: 'read-only', project: root, preference: { model: 'synthetic/model' }, env }, cli).env[`${name}_CONFIG_CONTENT`])
        expect(content.skills).toEqual({ paths: [skills] })
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
    it(`${cli}: reports a turn that ends right after a tool error as unverified`, async () => {
      const { frames, requests } = await run(cli, 'tool-failure')
      expect(frames.at(-1)).toMatchObject({ status: 'UNCERTAIN', error: '本轮最后的工具步骤失败后 CLI 直接结束；结果待核实，请先核查实际产物，不要自动重试' })
      expect(requests.some((row: any) => row.path?.startsWith('/permission/'))).toBe(false)
      expectServerCloseReceipt(requests)
    })
    it(`${cli}: reports a turn that carries on after a tool error as success with the failed step count`, async () => {
      const { frames } = await run(cli, 'tool-recovered')
      expect(frames.at(-1)).toMatchObject({ status: 'SUCCESS', notice: '本轮有 1 个工具步骤失败，CLI 已自行处理' })
    })
    for (const mode of ['disconnect', 'late', 'wrong-model']) {
      it(`${cli}: fails closed on ${mode} without retrying the prompt`, async () => {
        const { frames, requests } = await run(cli, mode)
        expect(frames.at(-1).status).toBe('ERROR')
        expect(requests.filter((row: any) => row.path?.endsWith('prompt_async'))).toHaveLength(1)
        expectServerCloseReceipt(requests)
      })
    }
    it(`${cli}: sends native abort before owned process cleanup`, async () => {
      const { frames, requests } = await run(cli, 'cancel')
      expect(frames.at(-1).status).toBe('ERROR')
      expect(requests.find((row: any) => row.path?.endsWith('/abort'))).toBeTruthy()
      expectServerCloseReceipt(requests)
    })
  }
  it('recognizes only the verified MiMo 0.1.15 incomplete OpenAPI contract', async () => {
    const { frames, requests } = await run('mimo', 'incomplete-spec')
    expect(frames.at(-1).status).toBe('SUCCESS')
    expect(requests.some((row: any) => row.path === '/global/health')).toBe(true)
    const other = await run('opencode', 'incomplete-spec')
    expect(other.frames.at(-1).status).toBe('ERROR')
    expect(other.requests.some((row: any) => row.path?.endsWith('prompt_async'))).toBe(false)
  })
})

describe('Hermes private gateway Runs API (simulated local native process)', () => {
  it('folds token-sized deltas into one continuous native response', async () => {
    const { frames } = await run('hermes', 'fragmented')
    const replies = timeline(frames).filter((row) => row.kind === 'assistant')
    expect(replies).toHaveLength(1)
    expect(replies[0]?.text).toBe('开发任务， 好的')
  })
  it.each(['tool-boundary', 'final-unstreamed', 'interim-boundary'])(
    'preserves the explicit native %s rather than merging independent replies', async (mode) => {
      const { frames } = await run('hermes', mode)
      expect(frames.at(-1).status).toBe('SUCCESS')
      const rows = timeline(frames).filter((row) => ['assistant', 'tool'].includes(row.kind))
      expect(rows.filter((row) => row.kind === 'assistant').map((row) => row.text)).toEqual(['模拟正文', '第二段'])
      if (mode !== 'interim-boundary') expect(rows.map((row) => row.kind)).toEqual(['assistant', 'tool', 'assistant'])
    },
  )
  it('injects Hermes guidance only into the owned run and deduplicates a native accepted receipt', async () => {
    const { frames, requests } = await run('hermes', 'steer-success', true, async (io) => {
      const first = io.steer('synthetic guidance', 'guidance-one', 'attempt-one')
      expect(io.steer('synthetic guidance', 'guidance-one', 'attempt-two')).toBe(first)
      await expect(io.steer('different text', 'guidance-one', 'attempt-three')).rejects.toThrow('其他消息')
      await first
    })
    expect(frames.at(-1).status).toBe('SUCCESS')
    expect(requests.filter((row: any) => row.path === '/v1/runs' && row.method === 'POST')).toHaveLength(1)
    expect(requests.filter((row: any) => row.path?.endsWith('/steer'))).toHaveLength(1)
    expect(requests.find((row: any) => row.path?.endsWith('/steer')).body).toEqual({ input: 'synthetic guidance' })
    expect(frames.some((frame: any) => frame.type === 'native' && frame.record.object === 'hermes.run.steer' && frame.record.run_id === 'run_SYNTHETIC')).toBe(true)
    expectServerCloseReceipt(requests)
  })
  it.each(['steer-rejected', 'steer-unknown', 'steer-wrong-run', 'steer-terminal-first', 'steer-unsupported'])(
    'never confirms Hermes %s or starts another run to deliver it', async (mode) => {
      const { requests } = await run('hermes', mode, true, async (io) => {
        const submission = io.steer('synthetic guidance', 'guidance-one', 'attempt-one')
        if (['steer-rejected', 'steer-unsupported'].includes(mode))
          await expect(submission).rejects.toMatchObject({ code: 'STEER_REJECTED' })
        else {
          await expect(submission).rejects.toThrow(/未确认|未知/)
          await expect(io.steer('synthetic guidance', 'guidance-one', 'attempt-two')).rejects.toThrow()
        }
      })
      expect(requests.filter((row: any) => row.path === '/v1/runs' && row.method === 'POST')).toHaveLength(1)
      expect(requests.filter((row: any) => row.path?.endsWith('/steer'))).toHaveLength(mode === 'steer-unsupported' ? 0 : 1)
      expectServerCloseReceipt(requests)
    },
  )
  it('uses native runs, exact model/provider/effort, and API-only private home', async () => {
    const { frames, requests, source, root } = await run('hermes')
    expect(frames.at(-1)).toMatchObject({ status: 'SUCCESS', response: '模拟正文' })
    const saved = parse(requests.find((row: any) => row.gatewayConfig).gatewayConfig)
    const gateway = requests.find((row: any) => row.gatewayConfig)
    expect(gateway.authProvider).toBe('openrouter')
    expect(gateway.sharedAuthDirectory).toBe(
      join(await realpath(root), 'state', 'hermes-http-home', 'shared'),
    )
    expect(saved.gateway.multiplex_profiles).toBe(false)
    expect(
      Object.entries(saved.platforms)
        .filter(([, value]: any) => value.enabled)
        .map(([name]) => name),
    ).toEqual(['api_server'])
    expect(saved.platform_toolsets.api_server).toEqual(['terminal', 'file'])
    expect(saved.terminal.cwd).toBe(root)
    expect(requests.find((row: any) => row.path === '/v1/runs' && row.method === 'POST').body).toMatchObject({
      provider: 'openrouter',
      model: 'synthetic/model',
      model_options: { reasoning_effort: 'low' },
      session_id: 'api_SYNTHETIC',
    })
    expect(
      requests.find((row: any) => row.path === '/api/sessions' && row.method === 'POST').body
        .require_model_lock,
    ).toBe(true)
    expect(await readFile(join(source, '.env'), 'utf8')).toContain('TELEGRAM_BOT_TOKEN=synthetic-never-copy')
    await expect(stat(join(root, 'state', 'hermes-http-home', 'auth.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(stat(join(root, 'state', 'hermes-http-home', 'shared'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expectServerCloseReceipt(requests)
  })
  it.each([
    ['permission-session', 'allow-session', 'session', true, 'SUCCESS'],
    // Without a native session choice, a session grant falls back to once; `always` is never sent.
    ['permission', 'allow-session', 'once', false, 'SUCCESS'],
    ['permission-session', 'allow-once', 'once', true, 'SUCCESS'],
    ['permission-session', 'deny', 'deny', true, 'UNCERTAIN'],
  ] as const)('relays a Hermes approval.request (%s) to the Host: %s → %s', async (mode, decision, choice, allowSession, status) => {
    const { frames, requests } = await run('hermes', mode, false, undefined, {}, decision)
    expect(frames.find((row) => row.type === 'approval').request).toEqual({
      kind: 'command', summary: '模拟危险命令', detail: 'synthetic --flag', allowSession,
    })
    expect(requests.find((row: any) => row.path?.endsWith('/approval')).body).toMatchObject({ choice, request_id: 'approval_SYNTHETIC' })
    expect(frames.at(-1).status).toBe(status)
  })
  it.each(['permission', 'permission-tool-failure'])('reports %s as uncertain when the Hermes run completes', async (mode) => {
    const { frames, requests } = await run('hermes', mode)
    expect(frames.at(-1)).toMatchObject({
      status: 'UNCERTAIN', response: '模拟正文', resultScope: 'response',
      error: 'Hermes 额外授权已拒绝，但 CLI 报告本轮已完成；结果待核实，请先核查实际产物，不要自动重试',
    })
    expect(frames.some((row) => row.type === 'event' && row.event.kind === 'diagnostic' && row.event.text === 'Hermes 额外授权已拒绝')).toBe(true)
    expect(frames.some((row) => row.type === 'event' && row.event.kind === 'assistant')).toBe(true)
    expect(requests.find((row: any) => row.path?.endsWith('/approval')).body).toMatchObject({
      choice: 'deny', request_id: 'approval_SYNTHETIC',
    })
    expect(requests.filter((row: any) => row.path === '/v1/runs' && row.method === 'POST')).toHaveLength(1)
    expectServerCloseReceipt(requests)
  })
  it('reports a Hermes run that ends right after a tool error as unverified', async () => {
    const { frames, requests } = await run('hermes', 'tool-failure')
    expect(frames.at(-1)).toMatchObject({ status: 'UNCERTAIN', error: '本轮最后的工具步骤失败后 CLI 直接结束；结果待核实，请先核查实际产物，不要自动重试' })
    expect(requests.some((row: any) => row.path?.endsWith('/approval'))).toBe(false)
    expectServerCloseReceipt(requests)
  })
  it('reports a Hermes run that carries on after a tool error as success with the failed step count', async () => {
    const { frames } = await run('hermes', 'tool-recovered')
    expect(frames.at(-1)).toMatchObject({ status: 'SUCCESS', notice: '本轮有 1 个工具步骤失败，CLI 已自行处理' })
  })
  for (const mode of ['disconnect', 'late', 'wrong-model']) {
    it(`fails closed on ${mode}`, async () => {
      const { frames, requests } = await run('hermes', mode)
      expect(frames.at(-1).status).toBe('ERROR')
      expect(requests.filter((row: any) => row.path === '/v1/runs' && row.method === 'POST')).toHaveLength(1)
      expectServerCloseReceipt(requests)
    })
  }
  it('stops through the runs API before gateway exit', async () => {
    const { requests } = await run('hermes', 'cancel')
    expect(requests.some((row: any) => row.path?.endsWith('/stop'))).toBe(true)
    expectServerCloseReceipt(requests)
  })
  it.each(['failed', 'cancelled', 'interrupted'])(
    'retains native usage on a %s run without treating it as successful',
    async (status) => {
      const { frames, requests } = await run('hermes', `run-${status}`)
      expect(frames.at(-1).status).toBe('ERROR')
      const records = frames.filter((frame) => frame.type === 'native').map((frame) => frame.record)
      expect(records.find((record) => record.event === `run.${status}`)?.usage).toEqual({
        input_tokens: 2,
        output_tokens: 3,
        total_tokens: 5,
      })
      expect(records.find((record) => record.type === 'hermes.run')).toMatchObject({
        run_id: 'run_SYNTHETIC',
        status,
        usage: { total_tokens: 5 },
      })
      expect(requests.filter((row: any) => row.path === '/v1/runs' && row.method === 'POST')).toHaveLength(1)
      expectServerCloseReceipt(requests)
    },
  )
  it('updates the same native tool row on completion', async () => {
    const { frames } = await run('hermes', 'tools')
    const tools = frames.filter((row) => row.type === 'event' && row.event.kind === 'tool')
    expect(frames.at(-1).status).toBe('SUCCESS')
    expect(tools.map((row) => row.event.step)).toEqual([1, 1])
    expect(tools.map((row) => row.event.state)).toEqual(['RUNNING', 'COMPLETED'])
  })
  it('fails if a tool never completes despite a run.completed event', async () => {
    const { frames } = await run('hermes', 'unfinished-tool')
    expect(frames.at(-1)).toMatchObject({ status: 'ERROR', error: 'Hermes 工具缺少完成事件' })
  })
  it('retains cumulative public reasoning in the same timeline step', async () => {
    const { frames } = await run('hermes', 'reasoning')
    const reasoning = frames.filter((row) => row.type === 'event' && row.event.kind === 'reasoning')
    expect(frames.at(-1).status).toBe('SUCCESS')
    expect(new Set(reasoning.map((row) => row.event.step)).size).toBe(1)
    expect(reasoning.filter(row => row.event.state === 'RUNNING').map(row => row.event.delta)).toEqual(['公开思考一', '\n公开思考二'])
    expect(reasoning.at(-1).event).toMatchObject({ detail: '公开思考一\n公开思考二', state: 'COMPLETED' })
  })
  it('does not bind an existing CLI-owned session to HTTP', async () => {
    const { frames, requests } = await run('hermes', 'foreign-session', true)
    expect(frames.at(-1).status).toBe('ERROR')
    expect(requests.some((row: any) => row.path === '/v1/runs' && row.method === 'POST')).toBe(false)
  })
  it('snapshots only own provider credentials with private permissions', async () => {
    const { config, source } = await setup('hermes')
    config.env.HERMES_SHARED_AUTH_DIR = join(source, 'external-shared-must-not-be-used')
    const prepared = await prepareHermesHttpHome(
      config,
      'openrouter',
      'synthetic/model',
      'synthetic-api-secret-at-least-16',
      12345,
    )
    expect(await readFile(join(prepared.home, '.env'), 'utf8')).not.toContain('TELEGRAM')
    expect(prepared.env.HERMES_SHARED_AUTH_DIR).toBe(join(prepared.home, 'shared'))
    expect(JSON.parse(await readFile(join(prepared.home, 'auth.json'), 'utf8')).active_provider).toBe(
      'openrouter',
    )
    expect(await readFile(join(source, 'config.yaml'), 'utf8')).toContain('telegram')
    await expect(stat(config.env.HERMES_SHARED_AUTH_DIR)).rejects.toMatchObject({ code: 'ENOENT' })
    if (process.platform !== 'win32') {
      expect((await stat(prepared.home)).mode & 0o777).toBe(0o700)
      expect((await stat(join(prepared.home, 'auth.json'))).mode & 0o777).toBe(0o600)
    }
    await prepared.cleanup()
  })
  it('cleans simulated hard-kill credential residue from the Host while preserving native sessions', async () => {
    const { config } = await setup('hermes')
    const prepared = await prepareHermesHttpHome(
      config,
      'openrouter',
      'synthetic/model',
      'synthetic-key',
      12345,
    )
    await writeFile(join(prepared.home, 'state.db'), 'SIMULATED_NATIVE_SESSION_DATABASE', { mode: 0o600 })
    await mkdir(join(prepared.home, 'backups', 'config'), { recursive: true, mode: 0o700 })
    await writeFile(
      join(prepared.home, 'backups', 'config', 'config.yaml.good.fixture'),
      'SYNTHETIC_BACKUP_SECRET',
      { mode: 0o600 },
    )
    await writeFile(
      join(prepared.env.HERMES_SHARED_AUTH_DIR, 'nous_auth.json'),
      '{"synthetic":"refresh-material"}',
      { mode: 0o600 },
    )
    const io = createNativeIO(config, () => {}, new AbortController().signal)
    const process = io.spawn([globalThis.process.execPath, '-e', 'setInterval(()=>{},1000)'])
    process.process.kill('SIGKILL')
    await process.done
    await io.close(new Error('SIMULATED bridge hard kill'))
    // The killed process did not call the runner cleanup; this is the Host's fallback.
    await cleanupHermesHttpHome(config.stateDirectory)
    for (const name of ['auth.json', '.env', 'config.yaml', 'shared', 'backups/config'])
      await expect(stat(join(prepared.home, name))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(prepared.home, 'state.db'), 'utf8')).toBe('SIMULATED_NATIVE_SESSION_DATABASE')
  })
  it.each(['home', 'ancestor', 'backups'])(
    'refuses an external symlink in the cleanup %s path',
    async (kind) => {
      const { config, root } = await setup('hermes')
      const outside = join(root, 'external-home')
      await mkdir(outside, { mode: 0o700 })
      await writeFile(join(outside, 'auth.json'), 'SYNTHETIC_EXTERNAL_MUST_REMAIN', { mode: 0o600 })
      if (kind === 'home') {
        await mkdir(config.stateDirectory, { mode: 0o700 })
        await symlink(
          outside,
          join(config.stateDirectory, 'hermes-http-home'),
          globalThis.process.platform === 'win32' ? 'junction' : 'dir',
        )
      } else if (kind === 'ancestor') {
        await symlink(
          outside,
          config.stateDirectory,
          globalThis.process.platform === 'win32' ? 'junction' : 'dir',
        )
      } else {
        const home = join(config.stateDirectory, 'hermes-http-home')
        await mkdir(home, { recursive: true, mode: 0o700 })
        await symlink(
          outside,
          join(home, 'backups'),
          globalThis.process.platform === 'win32' ? 'junction' : 'dir',
        )
      }
      await expect(cleanupHermesHttpHome(config.stateDirectory)).rejects.toThrow('链接')
      expect(await readFile(join(outside, 'auth.json'), 'utf8')).toBe('SYNTHETIC_EXTERNAL_MUST_REMAIN')
    },
  )
  it('removes already written credentials when preparing the snapshot fails partway', async () => {
    const { config } = await setup('hermes')
    const home = join(config.stateDirectory, 'hermes-http-home')
    await mkdir(join(home, '.env'), { recursive: true, mode: 0o700 })
    await expect(
      prepareHermesHttpHome(config, 'openrouter', 'synthetic/model', 'synthetic-key', 12345),
    ).rejects.toThrow()
    for (const name of ['auth.json', 'config.yaml', 'shared'])
      await expect(stat(join(home, name))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
