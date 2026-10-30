import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agyArguments } from '../src/host/process.ts'
import { runNativeAgy } from '../src/host/native-agy.mjs'
import { createNativeIO } from '../src/host/native-transport.mjs'

// 模拟 CLI 和会话；只运行本地 Node 夹具，不登录或调用真实模型。
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const fixture = `import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
if (process.argv.includes('--help')) { console.log('  --mode Set mode (accept-edits, auto, plan)'); process.exit(0); }
const mode = process.argv[process.argv.indexOf('--mode') + 1], scenario = process.env.SCENARIO;
const id = mode === 'auto' ? 'simulated-auto-session' : 'simulated-final-session';
const audit = value => appendFileSync(process.env.AUDIT, JSON.stringify({ mode, ...value }) + '\\n');
const out = value => process.stdout.write(JSON.stringify(value) + '\\n');
const init = () => out({ event: 'init', conversation_id: id, init: { model: 'simulated-flash' } });
const warning = process.env.WARNING === 'host'
  ? 'warning: --mode auto is not available because the terminal sandbox is not available on this host; continuing in the default mode.\\n'
  : 'warning: --mode auto is not available for this account; continuing in the default mode.\\n';
audit({ event: 'start', argv: process.argv.slice(2) });
process.on('SIGTERM', () => { audit({ event: 'stopped' }); process.exit(143); });
if (!['no-init', 'early-no-init', 'cancel'].includes(scenario)) init();
if (scenario === 'readonly') process.stderr.write(warning);
if (scenario === 'early' || scenario === 'early-no-init') {
  setTimeout(() => {
    process.stderr.write(warning.slice(0, 35));
    setTimeout(() => process.stderr.write(warning.slice(35)), 10);
  }, 10);
}
const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  audit({ event: 'input', value: JSON.parse(line) });
  if (scenario.startsWith('late') && mode === 'auto') {
    process.stderr.write(warning);
    if (scenario === 'late-success') out({ event: 'result', result: { conversation_id: id, status: 'SUCCESS', response: '模拟汇总成功但权限失效' } });
    return;
  }
  if (scenario === 'no-init') init();
  out({ event: 'result', result: { conversation_id: id, status: 'SUCCESS', response: '模拟完成' } });
});
lines.on('close', () => {
  audit({ event: 'stdin-closed' });
  if (mode === 'auto' && ['early', 'early-no-init', 'late', 'late-success', 'cancel'].includes(scenario)) setInterval(() => {}, 1000);
  else process.exit(0);
});
`

async function setup(scenario = 'early', warning = 'account') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'agy-account-SIMULATED-')))
  roots.push(root)
  const entry = join(root, 'cli.mjs'), audit = join(root, 'audit.jsonl')
  await writeFile(entry, fixture)
  const preference = { cli: 'antigravity' as const, model: 'simulated-flash', effort: 'default' as const }
  async function task(mode: 'plan' | 'accept-edits' = 'accept-edits', access = 'workspace-write') {
    const stateDirectory = join(root, 'native', randomUUID())
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
    return { cli: 'antigravity', project: root, stateDirectory, preference, mode, access, prompt: '模拟任务',
      argv: [process.execPath, entry, ...agyArguments('simulated-agy', root, preference, mode, '模拟任务', 3000, undefined, access as any).slice(1)],
      env: { AUDIT: audit, SCENARIO: scenario, WARNING: warning }, timeoutMs: 3000, maxLineBytes: 65536, maxRunBytes: 1048576 }
  }
  const rows = async () => (await readFile(audit, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  return { root, task, rows }
}
async function run(task: any, controller = new AbortController(), observe?: (frame: any) => void) {
  const frames: any[] = []
  const io = createNativeIO(task, (line: string) => { const frame = JSON.parse(line); frames.push(frame); observe?.(frame) }, controller.signal)
  let error
  try { await runNativeAgy(task, io) } catch (caught) { error = caught }
  await io.close(error)
  return { frames, error }
}

it.each(['early', 'early-no-init'])('模拟：%s 输入前分块警告先清理旧进程再回退，只发布最终会话且只发送一次任务', async scenario => {
  const f = await setup(scenario), task = await f.task(), { frames, error } = await run(task)
  expect(error).toBeUndefined()
  const rows = await f.rows(), starts = rows.filter(row => row.event === 'start')
  expect(starts.map(row => row.mode)).toEqual(['auto', 'accept-edits'])
  expect(rows.findIndex(row => row.event === 'stopped')).toBeLessThan(rows.indexOf(starts[1]))
  expect(rows.filter(row => row.event === 'input')).toMatchObject([{ mode: 'accept-edits' }])
  expect(starts[1].argv).toContain('--sandbox')
  expect(starts[1].argv).toContain('--dangerously-skip-permissions')
  expect(starts[1].argv).not.toContain('--sandbox=false')
  expect(frames.filter(frame => frame.type === 'session')).toMatchObject([{ id: 'simulated-final-session' }])
  expect(JSON.stringify(frames)).not.toContain('simulated-auto-session')
  expect(frames.some(frame => frame.event?.text === 'Antigravity 原生自动审批不可用，本轮按仅工作区编辑运行')).toBe(true)
  expect(frames.at(-1)).toMatchObject({ status: 'SUCCESS' })
})

it('模拟：主机没有终端沙箱（Windows）时按仅工作区编辑重启，不跳过确认', async () => {
  const f = await setup('early', 'host'), { frames, error } = await run(await f.task())
  expect(error).toBeUndefined()
  const rows = await f.rows(), starts = rows.filter(row => row.event === 'start')
  expect(starts.map(row => row.mode)).toEqual(['auto', 'accept-edits'])
  expect(rows.filter(row => row.event === 'input')).toMatchObject([{ mode: 'accept-edits' }])
  // Without a terminal sandbox, skipping confirmations would run commands unconfined.
  expect(starts[1].argv).toContain('--sandbox')
  expect(starts[1].argv).not.toContain('--dangerously-skip-permissions')
  expect(frames.some(frame => frame.event?.text === 'Antigravity 原生自动审批在此主机不可用（没有终端沙箱），本轮按仅工作区编辑运行，不执行命令')).toBe(true)
  expect(frames.at(-1)).toMatchObject({ status: 'SUCCESS' })
})

it('模拟：主机没有终端沙箱的警告在输入后才出现时停止本轮并说明原因', async () => {
  const f = await setup('late', 'host'), { frames } = await run(await f.task())
  expect(frames.at(-1)).toMatchObject({ status: 'ERROR', error: expect.stringContaining('此主机没有终端沙箱，Antigravity 不能自动审批，本轮已停止且未自动重试') })
  const rows = await f.rows()
  expect(rows.filter(row => row.event === 'start').map(row => row.mode)).toEqual(['auto'])
  expect(rows.filter(row => row.event === 'input')).toHaveLength(1)
})

it.each(['late', 'late-success'])('模拟：%s 输入后才警告时停止本轮，不重发也不重启', async scenario => {
  const f = await setup(scenario), { frames } = await run(await f.task())
  expect(frames.at(-1)).toMatchObject({ status: 'ERROR', error: expect.stringContaining('本轮已停止且未自动重试，请重新派遣') })
  const rows = await f.rows()
  expect(rows.filter(row => row.event === 'start').map(row => row.mode)).toEqual(['auto'])
  expect(rows.filter(row => row.event === 'input')).toHaveLength(1)
  expect(rows.some(row => row.event === 'stopped')).toBe(true)
})

it.each([
  ['plan', 'workspace-write'], ['accept-edits', 'read-only'],
] as const)('模拟：%s / %s 不受账号警告影响', async (mode, access) => {
  const f = await setup('readonly'), task = await f.task(mode, access)
  const { error, frames } = await run(task)
  expect(error).toBeUndefined()
  const start = (await f.rows()).filter(row => row.event === 'start').at(-1)
  expect(start.mode).toBe('plan')
  expect(start.argv).toContain('--sandbox')
  expect(start.argv).not.toContain('--dangerously-skip-permissions')
  expect(frames.some(frame => frame.event?.text?.includes('本轮按'))).toBe(false)
  expect(frames.at(-1)).toMatchObject({ status: 'SUCCESS' })
})

it('模拟：旧版在输入后才发 init 时仍能完成，不将观察超时视为账号不支持', async () => {
  const f = await setup('no-init'), { error, frames } = await run(await f.task())
  expect(error).toBeUndefined()
  expect((await f.rows()).filter(row => row.event === 'start').map(row => row.mode)).toEqual(['auto'])
  expect(frames.at(-1)).toMatchObject({ status: 'SUCCESS' })
})

it('模拟：输入前取消会清理进程，不发布会话、不发送输入或重启', async () => {
  const f = await setup('cancel'), controller = new AbortController()
  const pending = run(await f.task(), controller)
  await vi.waitFor(async () => expect((await f.rows()).some(row => row.event === 'start')).toBe(true), { interval: 5 })
  controller.abort(new Error('模拟取消'))
  const { frames } = await pending
  const rows = await f.rows()
  expect(rows.filter(row => row.event === 'start')).toHaveLength(1)
  expect(rows.filter(row => row.event === 'input')).toHaveLength(0)
  expect(rows.some(row => row.event === 'stopped')).toBe(true)
  expect(frames.filter(frame => frame.type === 'session')).toHaveLength(0)
  expect(frames.at(-1)).toMatchObject({ status: 'ERROR', error: expect.stringContaining('模拟取消') })
})
