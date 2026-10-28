import { afterEach, expect, it } from 'vitest'
import { mkdtemp, realpath, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agyArguments } from '../src/host/process.ts'
import { workerArguments } from '../src/host/adapters.ts'
import { nativeAgyArgv, probeAgyModes, runNativeAgy } from '../src/host/native-agy.mjs'
import { createNativeIO } from '../src/host/native-transport.mjs'
import type { NativeAccess } from '../src/host/native-approval-policy.ts'
import type { TaskMode } from '../src/shared/types.ts'

const preference = { cli: 'antigravity' as const, model: 'synthetic-model', effort: 'default' as const }
function config(mode: TaskMode, access: NativeAccess) {
  return { mode, access, preference, prompt: 'synthetic task', project: '/synthetic',
    argv: agyArguments('/synthetic/agy', '/synthetic', preference, mode, 'synthetic task', 1000, undefined, access) }
}
it.each([
  ['plan', 'danger-full-access', 'plan', true, false],
  ['accept-edits', 'read-only', 'plan', true, false],
  ['accept-edits', 'workspace-write', 'auto', true, false],
  ['accept-edits', 'danger-full-access', 'accept-edits', false, true],
] as const)('maps %s / %s in Host arguments and the native runner', (mode, access, expected, sandbox, skip) => {
  const task = config(mode, access)
  const host = workerArguments('/synthetic/agy', task.project, preference, mode, task.prompt, 1000, undefined, true, access)
  for (const argv of [host, task.argv, nativeAgyArgv(task, ['plan', 'auto', 'accept-edits'])]) {
    expect(argv[argv.indexOf('--mode') + 1]).toBe(expected)
    expect(argv.includes('--sandbox')).toBe(sandbox)
    expect(argv.includes('--sandbox=false')).toBe(!sandbox)
    expect(argv.includes('--dangerously-skip-permissions')).toBe(skip)
  }
})
it('normalizes the legacy read-only combination to plan and removes stale bypass flags', () => {
  const task = config('accept-edits', 'read-only')
  task.argv[task.argv.indexOf('--mode') + 1] = 'accept-edits'
  task.argv.splice(1, 0, '--dangerously-skip-permissions')
  const argv = nativeAgyArgv(task)
  expect(argv[argv.indexOf('--mode') + 1]).toBe('plan')
  expect(argv).not.toContain('--dangerously-skip-permissions')
})

// Executable protocol fixture: --help plus a failed tool followed by a normal answer.
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture(modes: string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'agy-permissions-SIMULATED-')))
  roots.push(root)
  const entry = join(root, 'cli.mjs'), audit = join(root, 'audit.json')
  await writeFile(entry, `import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
if(process.argv.includes('--help')){console.log('  --mode Set mode (${modes})');process.exit(0)}
writeFileSync(process.env.AUDIT,JSON.stringify(process.argv.slice(2)));
const out=x=>console.log(JSON.stringify(x));
createInterface({input:process.stdin}).on('line',()=>{
 out({event:'init',conversation_id:'synthetic-session',init:{model:'synthetic-model'}});
 out({event:'step_update',step_update:{step_index:0,step_type:'tool',state:'ERROR',tool_info:{error:'Synthetic tool failed'}}});
 out({event:'step_update',step_update:{step_index:1,step_type:'agent_response',state:'DONE',text_delta:'Synthetic continued answer'}});
 out({event:'result',result:{conversation_id:'synthetic-session',status:'SUCCESS',response:'Synthetic continued answer'}});
});`, { mode: 0o600 })
  const task: any = { ...config('accept-edits', 'workspace-write'), project: root, stateDirectory: root,
    env: { AUDIT: audit }, timeoutMs: 2000, maxLineBytes: 65536, maxRunBytes: 1048576 }
  task.argv = [process.execPath, entry, ...task.argv.slice(1)]
  return { task, audit }
}
it.each([
  ['accept-edits, auto, plan', 'auto', false, false],
  ['accept-edits, plan', 'accept-edits', true, true],
  ['plan', 'plan', false, true],
])('probes %s, applies fallback before input, and continues after a failed tool', async (modes, mode, skip, fallback) => {
  const { task, audit } = await fixture(modes)
  expect(await probeAgyModes(task)).toContain(mode)
  const frames: any[] = []
  const io = createNativeIO(task, (line: string) => frames.push(JSON.parse(line)), new AbortController().signal)
  let error
  try { await runNativeAgy(task, io) } catch (caught) { error = caught }
  await io.close(error)
  expect(error).toBeUndefined()
  const argv = JSON.parse(await readFile(audit, 'utf8'))
  expect(argv[argv.indexOf('--mode') + 1]).toBe(mode)
  expect(argv.includes('--dangerously-skip-permissions')).toBe(skip)
  expect(argv).toContain('--sandbox')
  expect(frames.some(frame => frame.event?.text?.includes('本轮按'))).toBe(fallback)
  expect(frames.at(-1)).toMatchObject({ status: 'SUCCESS', response: 'Synthetic continued answer' })
  expect(frames.at(-1).notice).toContain('CLI 已自行处理')
})
it('refuses to launch if help confirms no supported mode', async () => {
  const { task, audit } = await fixture('unknown')
  const frames: any[] = []
  const io = createNativeIO(task, (line: string) => frames.push(JSON.parse(line)), new AbortController().signal)
  await expect(runNativeAgy(task, io)).rejects.toThrow('已拒绝启动')
  await io.close()
  await expect(readFile(audit)).rejects.toMatchObject({ code: 'ENOENT' })
})
