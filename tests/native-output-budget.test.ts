import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createNativeIO } from '../src/host/native-transport.mjs'
import { runNativeCodex } from '../src/host/native-codex.mjs'
import { foldNativeFrames } from './fixtures/bridge-timeline.ts'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

// SIMULATED Codex app-server transcripts: no CLI account, model request or network is used.
const fixture = `#!/usr/bin/env node
import { createInterface } from 'node:readline';
const scenario=process.env.CWN_BUDGET_SCENARIO, id='synthetic-session', turn='synthetic-turn';
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
const note=(method,params)=>send({method,params});
const command=(item,chunks,size,char)=>{
 note('item/started',{threadId:id,turnId:turn,item:{id:item,type:'commandExecution',command:'synthetic read '+item,status:'inProgress',aggregatedOutput:null}});
 let output='';
 for(let i=0;i<chunks;i++){const delta=char.repeat(size);output+=delta;note('item/commandExecution/outputDelta',{threadId:id,turnId:turn,itemId:item,delta});}
 note('item/completed',{threadId:id,turnId:turn,item:{id:item,type:'commandExecution',command:'synthetic read '+item,status:'completed',exitCode:0,aggregatedOutput:output}});
};
function turnBody(){
 note('turn/started',{threadId:id,turn:{id:turn,status:'inProgress',items:[]}});
 if(scenario==='single-400k')command('read',100,4096,'a');
 else if(scenario==='single-800k')command('read',200,4096,'a');
 else if(scenario==='many-64k')for(let n=0;n<50;n++)command('read-'+n,16,4096,'b');
 else if(scenario==='thinking')for(let i=0;i<2000;i++)note('item/reasoning/summaryTextDelta',{threadId:id,turnId:turn,itemId:'reason',summaryIndex:0,delta:'思'.repeat(341)});
 else if(scenario==='oversized-frame')process.stdout.write(JSON.stringify({method:'item/agentMessage/delta',params:{threadId:id,turnId:turn,itemId:'reply',delta:'x'.repeat(200000)}})+'\\n');
 note('item/completed',{threadId:id,turnId:turn,item:{id:'reply',type:'agentMessage',text:'模拟回复'}});
 note('turn/completed',{threadId:id,turn:{id:turn,status:'completed',items:[]}});
}
const lines=createInterface({input:process.stdin});
lines.on('line',line=>{const value=JSON.parse(line);
 if(value.method==='initialize')send({id:value.id,result:{}});
 else if(value.method==='thread/resume')send({id:value.id,result:{thread:{id},model:'synthetic-model',cwd:process.cwd(),approvalPolicy:'never',sandbox:{type:'workspaceWrite',networkAccess:false},reasoningEffort:'low'}});
 else if(value.method==='turn/start'){turnBody();send({id:value.id,result:{turn:{id:turn}}});}
});
lines.on('close',()=>process.exit(0));
`

async function run(scenario: string, limits: Record<string, number> = {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'native-budget-synthetic-')))
  directories.push(directory)
  const executable = join(directory, 'synthetic-codex.mjs')
  writeFileSync(executable, fixture, { mode: 0o700 })
  const prompt = 'SIMULATED TASK'
  const config: any = {
    cli: 'codex', project: directory, prompt, mode: 'accept-edits',
    preference: { model: 'synthetic-model', effort: 'low' }, conversationId: 'synthetic-session',
    env: { CWN_BUDGET_SCENARIO: scenario }, timeoutMs: 20000,
    // Host defaults (process.ts DEFAULT_CONFIG); tests may narrow them.
    maxLineBytes: 1_048_576, maxRunBytes: 16_777_216, ...limits,
    argv: [executable, 'exec', 'resume', 'synthetic-session', '--json', '--model', 'synthetic-model', `任务：\n${prompt}`],
  }
  const frames: any[] = []
  let bytes = 0
  const io = createNativeIO(config, (line: string) => {
    bytes += Buffer.byteLength(line)
    frames.push(JSON.parse(line))
  }, new AbortController().signal)
  let error
  try { await runNativeCodex(config, io) } catch (caught) { error = caught }
  await io.close(error)
  return { frames, bytes, result: frames.at(-1) }
}

describe('native output budget (simulated Codex app-server)', () => {
  it('keeps one 400KB command running with linear transfer and a bounded, marked preview', async () => {
    const small = await run('single-400k')
    expect(small.result).toMatchObject({ type: 'result', status: 'SUCCESS' })
    const large = await run('single-800k')
    expect(large.result).toMatchObject({ type: 'result', status: 'SUCCESS' })
    // Each output byte crosses the bridge a bounded number of times, never once per later delta.
    expect(small.bytes).toBeLessThan(4 * 409_600)
    expect(large.bytes / small.bytes).toBeLessThan(2.5)
    const tool = foldNativeFrames(large.frames).find((row) => row.kind === 'tool')!
    expect(tool.state).toBe('COMPLETED')
    expect(tool.truncated).toBe(true)
    expect(tool.outputBytes).toBe(819_200)
    expect(Buffer.byteLength(String(tool.toolCall?.output))).toBeLessThanOrEqual(262_144)
  })
  it('keeps a turn of fifty 64KB commands running', async () => {
    const { result, bytes, frames } = await run('many-64k')
    expect(result).toMatchObject({ type: 'result', status: 'SUCCESS' })
    expect(bytes).toBeLessThan(4 * 50 * 65_536)
    const tools = foldNativeFrames(frames).filter((row) => row.kind === 'tool')
    expect(tools).toHaveLength(50)
    expect(tools.every((row) => row.toolCall?.output === 'b'.repeat(65_536))).toBe(true)
  })
  it('streams a long public summary as deltas instead of growing snapshots', async () => {
    const { result, bytes, frames } = await run('thinking')
    expect(result).toMatchObject({ type: 'result', status: 'SUCCESS' })
    // 2000 deltas of 1023 bytes: about 2 MB of summary text.
    expect(bytes).toBeLessThan(4 * 2000 * 1023)
    const reasoning = foldNativeFrames(frames).find((row) => row.kind === 'reasoning')!
    expect(reasoning.truncated).toBe(true)
    expect(Buffer.byteLength(reasoning.detail ?? '')).toBeLessThanOrEqual(262_144)
    expect(reasoning.detail?.startsWith('思'.repeat(341))).toBe(true)
  })
  it('degrades display past the run budget without changing the terminal', async () => {
    const { result, frames } = await run('many-64k', { maxLineBytes: 262_144, maxRunBytes: 1_048_576 })
    expect(result).toMatchObject({ type: 'result', status: 'SUCCESS' })
    const rows = foldNativeFrames(frames)
    const tools = rows.filter((row) => row.kind === 'tool')
    expect(tools).toHaveLength(50)
    expect(tools.every((row) => row.state === 'COMPLETED')).toBe(true)
    expect(tools.at(-1)?.truncated).toBe(true)
    expect(rows.some((row) => row.kind === 'diagnostic' && /展示内容已达上限/.test(row.text))).toBe(true)
    // Cumulative inbound bytes (about 3.2 MB) exceed maxRunBytes; they are statistics only.
  })
  it('still stops on one oversized inbound frame and names the limit', async () => {
    const { result } = await run('oversized-frame', { maxNativeLineBytes: 65_536 })
    expect(result).toMatchObject({ type: 'result', status: 'ERROR' })
    expect(result.error).toMatch(/入站.*65536/)
  })
})
