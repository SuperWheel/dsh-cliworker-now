import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { hasOmpNativeContextCommand, parseOmpNativeContextReport, OmpContextInspection } from '../src/host/omp-context-inspection.mjs'

// Explicitly simulated native OMP report and RPC process. No account/model calls.
const commands = [{ name: 'context', source: 'builtin', description: 'Show context usage' }]
const bar = `[${'░'.repeat(24)}] 0%`
const row = (name: string, tokens: number) => `  ${name.padEnd(16)} ${bar}  ${tokens} tokens`
const report = ['Context window: 128000 tokens (1% used)',
  row('System prompt', 200), row('System tools', 300), row('Messages', 734),
  row('Auto-compact buf', 16000), row('Free', 110766)].join('\n')
const usage = { tokens: 1234, contextWindow: 128000 }
const roots: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('OMP native context report', () => {
  it('retains only native categories and a separately reported exact total', () => {
    const result = parseOmpNativeContextReport(report, usage)!
    expect(result).toMatchObject({ contextUsed: 1234, contextCapacity: 128000, basis: 'native-estimate' })
    expect(result.categories).toEqual([
      { name: 'System prompt', tokens: 200, kind: 'used' },
      { name: 'System tools', tokens: 300, kind: 'used' },
      { name: 'Messages', tokens: 734, kind: 'used' },
      { name: 'Auto-compact buf', tokens: 16000, kind: 'buffer' },
      { name: 'Free', tokens: 110766, kind: 'free' },
    ])
    expect(result.categories.some(item => item.name === 'Skills')).toBe(false)
  })
  it('does not derive a used total from category sum, percentage or null fallback', () => {
    expect(parseOmpNativeContextReport(report)?.contextUsed).toBeUndefined()
    expect(parseOmpNativeContextReport(report, { ...usage, tokens: null })?.contextUsed).toBeUndefined()
    expect(parseOmpNativeContextReport('Context\nWindow: 128000\nUsed: 0', usage)).toBeUndefined()
    expect(parseOmpNativeContextReport(report, { ...usage, tokens: 50000 })).toBeUndefined()
    const nonClosing = report.replace('734 tokens', '999 tokens')
    expect(parseOmpNativeContextReport(nonClosing, usage)?.contextUsed).toBe(1234)
  })
  it('ignores native savings prose without reclassifying tokens', () => {
    expect(parseOmpNativeContextReport(report + '\nSnapcompact (estimated wire savings):\n  System prompt: 99999 text tokens', usage))
      .toEqual(parseOmpNativeContextReport(report, usage))
    expect(parseOmpNativeContextReport('\u001b[32m' + report + '\u001b[0m', usage))
      .toEqual(parseOmpNativeContextReport(report, usage))
  })
  it.each([
    report + '\n' + row('Messages', 4),
    report + '\n' + row('Invented category', 20),
    report.replace('200 tokens', '-1 tokens'),
    report.replace('200 tokens', '9007199254740992 tokens'),
    report + '\u001b]arbitrary-control',
    'x'.repeat(32769),
  ])('rejects malformed, ambiguous or oversized reports', value => {
    expect(parseOmpNativeContextReport(value, usage)).toBeUndefined()
  })
  it('requires the unique readonly native builtin advertisement', () => {
    expect(hasOmpNativeContextCommand(commands)).toBe(true)
    for (const value of [[], [...commands, ...commands], [{ ...commands[0], source: 'extension' }],
      [{ ...commands[0], input: { hint: 'arguments' } }], [{ ...commands[0], description: 'Unknown' }]])
      expect(hasOmpNativeContextCommand(value)).toBe(false)
  })
})

describe('OMP bounded local-only inspection receipt', () => {
  function inspector() {
    const send = vi.fn(), emit = vi.fn(), done = vi.fn()
    const query = new OmpContextInspection({ send, emit, done })
    query.observeCommands(commands)
    return { query, send, emit, done }
  }
  const receipt = { type: 'response', id: 'cliworker-context-inspection', command: 'prompt', success: true, data: { agentInvoked: false } }
  it('waits for an exact non-agent receipt before emitting metadata once', () => {
    const { query, send, emit, done } = inspector()
    query.start('session-a', usage)
    expect(send).toHaveBeenCalledExactlyOnceWith({ id: receipt.id, type: 'prompt', message: '/context' })
    query.consume({ type: 'command_output', text: report })
    expect(emit).not.toHaveBeenCalled()
    query.consume({ ...receipt, id: 'unrelated-response' })
    expect(emit).not.toHaveBeenCalled()
    query.consume(receipt)
    query.consume(receipt)
    expect(emit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'cliworker.context_inspection',
      cli: 'omp', source: 'omp.native-context', sessionId: 'session-a', contextUsed: 1234 }))
    expect(done).toHaveBeenCalledTimes(1)
  })
  it.each([
    { ...receipt, data: { agentInvoked: true } }, { ...receipt, data: {} },
    { ...receipt, success: false }, { ...receipt, command: 'steer' },
  ])('rejects a receipt that does not prove local builtin execution', value => {
    const { query, emit, done } = inspector()
    query.start('session-a', usage)
    query.consume({ type: 'command_output', text: report })
    query.consume(value)
    expect(emit).not.toHaveBeenCalled()
    expect(done).toHaveBeenCalledTimes(1)
  })
  it('does not send a prompt without the builtin capability', () => {
    const { query, send, done } = inspector()
    query.observeCommands([{ ...commands[0], source: 'skill' }])
    query.start('session-a', usage)
    expect(send).not.toHaveBeenCalled()
    expect(done).toHaveBeenCalledTimes(1)
  })
  it('finishes within the metadata deadline and ignores a late receipt', () => {
    vi.useFakeTimers()
    const { query, emit, done } = inspector()
    query.start('session-a', usage)
    query.consume({ type: 'command_output', text: report })
    vi.advanceTimersByTime(750)
    query.consume(receipt)
    expect(emit).not.toHaveBeenCalled()
    expect(done).toHaveBeenCalledTimes(1)
  })
  it('rejects multiple outputs and cleans up without finalizing on disposal', () => {
    vi.useFakeTimers()
    const { query, emit, done } = inspector()
    query.start('session-a', usage)
    query.consume({ type: 'command_output', text: report })
    query.consume({ type: 'command_output', text: report })
    query.consume(receipt)
    expect(emit).not.toHaveBeenCalled()
    const second = inspector()
    second.query.start('session-b', usage)
    second.query.dispose()
    vi.advanceTimersByTime(750)
    expect(second.done).not.toHaveBeenCalled()
    expect(done).toHaveBeenCalledTimes(1)
  })
})

describe('OMP original-process bridge integration (simulated CLI)', () => {
  it.each(['builtin', 'unsupported', 'timeout', 'agent-receipt'])('inspects only an advertised builtin: %s', async scenario => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'cwn-omp-context-')))
    roots.push(root)
    const state = join(root, 'state'), native = join(state, 'agent'), requestDir = join(root, 'request'),
      executable = join(root, 'simulated-omp.mjs'), history = join(native, 'sessions', 'fixture.jsonl'),
      calls = join(root, 'calls.json')
    await mkdir(join(native, 'sessions'), { recursive: true })
    await mkdir(requestDir)
    await writeFile(join(native, 'native-env.json'), '{}')
    await writeFile(join(native, 'native-auth.json'), '{}')
    await writeFile(history, 'SIMULATED SESSION: one user message\n')
    await writeFile(executable, `// Simulated RPC, never imports external source or calls a model.
import {createInterface} from 'node:readline';import {writeFileSync} from 'node:fs';
if(process.argv.includes('--help')){process.stdout.write('--approval-mode=<value> (always-ask|write|yolo)');process.exit(0)}
const scenario=${JSON.stringify(scenario)},calls=[],history=${JSON.stringify(history)};
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
if(scenario!=='unsupported')send({type:'available_commands_update',commands:${JSON.stringify(commands)}});
createInterface({input:process.stdin}).on('line',line=>{const c=JSON.parse(line);calls.push(c);writeFileSync(${JSON.stringify(calls)},JSON.stringify(calls));
if(c.type==='get_state')send({type:'response',id:c.id,command:c.type,success:true,data:{sessionId:'fixture',sessionFile:history,model:{provider:'fixture',id:'chat'},thinkingLevel:'off',isStreaming:false}});
if(c.type==='get_session_stats')send({type:'response',id:c.id,command:c.type,success:true,data:{tokens:{input:5,output:4,cacheRead:0,cacheWrite:0,total:9},contextUsage:${JSON.stringify(usage)}}});
if(c.type==='prompt'&&c.message==='/context'){if(scenario==='timeout')return;send({type:'command_output',text:${JSON.stringify(report)}});send({type:'response',id:c.id,command:'prompt',success:true,data:{agentInvoked:scenario==='agent-receipt'}});return;}
if(c.type==='prompt'){send({type:'response',id:c.id,command:'prompt',success:true});send({type:'message_start',message:{role:'assistant'}});send({type:'message_update',assistantMessageEvent:{type:'text_delta',contentIndex:0,delta:'SIMULATED ANSWER'}});send({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'SIMULATED ANSWER'}]}});send({type:'agent_end'});}
}).on('close',()=>process.exit(0));`)
    const request = join(requestDir, 'request.json')
    await writeFile(request, JSON.stringify({ cli: 'omp', executable, stateDirectory: state, nativeRoot: native,
      project: root, mode: 'accept-edits', prompt: 'SIMULATED TASK', preference: { model: 'fixture/chat', effort: 'default' },
      confirmedCatalog: [{ id: 'fixture/chat', efforts: [] }] }))
    const { stdout } = await promisify(execFile)(process.execPath, [resolve('src/host/pi-omp-bridge.mjs'), request], {
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: root, LANG: 'C', ELECTRON_RUN_AS_NODE: '1' }, timeout: 12000,
    }).catch(error => { throw new Error(`Simulated bridge failed: ${error.stdout}\n${error.stderr}`) })
    const frames = stdout.trim().split('\n').map(line => JSON.parse(line))
    expect(frames.at(-1)).toMatchObject({ type: 'result', status: 'SUCCESS', response: 'SIMULATED ANSWER' })
    const observed = JSON.parse(await readFile(calls, 'utf8'))
    expect(observed.filter((call: any) => call.message === '/context')).toHaveLength(scenario === 'unsupported' ? 0 : 1)
    expect(observed.some((call: any) => call.message === '/usage')).toBe(false)
    expect(frames.filter(frame => frame.record?.type === 'cliworker.context_inspection'))
      .toHaveLength(scenario === 'builtin' ? 1 : 0)
    expect(await readFile(history, 'utf8')).toBe('SIMULATED SESSION: one user message\n')
    expect(stdout).not.toContain('Context window:')
    expect(stdout).not.toContain('cliworker-context-inspection')
  })
})
