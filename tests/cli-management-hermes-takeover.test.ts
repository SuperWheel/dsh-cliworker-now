/** 模拟：临时目录、合成回执与进程后端；不执行 Hermes、Git 或真实网络。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, mkdir, writeFile, rm, utimes, readFile, readdir, truncate, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { HermesWatch, runHermesUpdate, type HermesUpdateOptions } from '../src/host/cli-management/hermes-watch.ts'
import { HermesFetchWatchdog, cacheGrew, observeHermesCache } from '../src/host/cli-management/hermes-observation.ts'
import { hermesSegments, prefetchHermes } from '../src/host/cli-management/hermes-prefetch.ts'
import { resolveHermesGit } from '../src/host/cli-management/hermes-git.ts'
import { cliDownloadProgressSchema } from '../src/shared/cli-management.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError } from '../src/host/process.ts'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const sha = (n: number) => n.toString(16).repeat(40)
const refs = `${sha(3)}\trefs/tags/v0.23.1^{}\n${sha(9)}\trefs/tags/v0.23.1\n${sha(1)}\trefs/tags/v0.21.7\n${sha(2)}\trefs/tags/v0.22.0\n${sha(4)}\trefs/tags/v0.24.0\n${sha(5)}\trefs/tags/v0.23.0-rc.1\n`
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hermes-takeover-simulated-'))); roots.push(root)
  const checkout = join(root, 'hermes-agent')
  for (const dir of ['logs/update_receipts', 'cache/partials', 'cache/uv', 'cache/pnpm/store', 'hermes-agent/.git/objects/pack']) await mkdir(join(root, dir), { recursive: true })
  return { root, checkout }
}
async function put(path: string, value: unknown, at?: number) { await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value)); if (at !== undefined) await utimes(path, new Date(at), new Date(at)) }
async function observer(stage: string) {
  const { root, checkout } = await fixture(), now = Date.now() - 1000, progress = vi.fn(), status = join(root, 'status.json')
  const watch = new HermesWatch(root, checkout, status, now, p => { cliDownloadProgressSchema.parse(p); progress(p) }); await watch.snapshot()
  await put(status, { stage }, now + 1); await watch.poll(now + 1)
  return { root, checkout, now: now + 1, watch, progress, status }
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 2000; i++) { if (predicate()) return; await new Promise<void>(resolve => setImmediate(resolve)) }
  throw new Error('模拟后端未到达预期边界')
}
function finished(text = '', exitCode = 0) {
  return { stdout: Readable.from([text]), stderr: Readable.from([]), done: Promise.resolve({ exitCode, signal: null }), terminate: vi.fn(), waitForExit: vi.fn(async () => true) }
}
function held(confirm: Promise<boolean> = Promise.resolve(true)) {
  let resolve!: (value: { exitCode: number; signal: null }) => void
  const done = new Promise<{ exitCode: number; signal: null }>(r => { resolve = r })
  return { stdout: Readable.from([]), stderr: Readable.from([]), done, terminate: vi.fn(() => resolve({ exitCode: 1, signal: null })), waitForExit: vi.fn(() => confirm) }
}
function options(root: string, checkout: string, spawn = vi.fn(() => finished())): HermesUpdateOptions {
  return { root, home: root, checkout, argv: ['simulated-hermes', 'update', '--yes'], beforeVersion: '0.21.7', targetVersion: '0.23.1', targetSha: sha(3), backend: { spawn, resolveExecutable: vi.fn(async () => '/simulated/git') } as any, config: DEFAULT_CONFIG, signal: new AbortController().signal, output: vi.fn(), progress: p => { cliDownloadProgressSchema.parse(p) } }
}

it.each(['wrong-target','stage-only','missing'])('模拟：清理只接受本轮匹配目标的整体成功回执，%s 撤销证据', async mode => {
  const {root,checkout} = await fixture(), now = Date.now() - 1000
  const watch = new HermesWatch(root,checkout,join(root,'status.json'),now,()=>{},{version:'0.23.1'})
  await watch.snapshot()
  const receipt = join(root,'logs/update_receipts/latest.json')
  await put(receipt,{outcome:'success',post_update:{version:'0.23.1'}},now + 1)
  await watch.poll(now + 1,false); expect(watch.receiptSucceeded).toBe(true)
  if (mode === 'missing') await rm(receipt)
  else await put(receipt,mode === 'wrong-target' ? {outcome:'success',post_update:{version:'0.21.7'}} : {outcome:'running',pid:process.pid,stages:[{name:'apply',outcome:'success'}]},now + 2)
  watch.output('Update complete!')
  await watch.poll(now + 2,false); expect(watch.receiptSucceeded).toBe(false)
})
function captureWatches() {
  const watches: HermesWatch[] = [], original = HermesWatch.prototype.snapshot
  vi.spyOn(HermesWatch.prototype, 'snapshot').mockImplementation(async function (this: HermesWatch, cache) { watches.push(this); await original.call(this, cache) })
  return watches
}
async function stall(watch: HermesWatch, stage = 'fetch', growth?: () => Promise<void>) {
  const now = Date.now()
  await put(watch.status, { stage, ...(stage === 'tools' ? { message: 'Downloading runtime tools' } : {}) }, now)
  await growth?.()
  await watch.poll(now)
  await watch.poll(now + (stage === 'fetch' ? 60_000 : 120_000))
}

it('模拟：fetch 首字节及后续无增长均为 10 秒；60 秒低均速独立判慢', () => {
  const empty = new HermesFetchWatchdog(0)
  expect(empty.check(9_999, 0)).toBeUndefined(); expect(empty.check(10_000, 0)).toBe('OFFICIAL_STALLED')
  const stalled = new HermesFetchWatchdog(0)
  expect(stalled.check(9_999, 1)).toBeUndefined(); expect(stalled.check(19_998, 1)).toBeUndefined(); expect(stalled.check(19_999, 1)).toBe('OFFICIAL_STALLED')
  const slow = new HermesFetchWatchdog(0)
  for (let t = 0; t < 60_000; t += 10_000) expect(slow.check(t, t + 1)).toBeUndefined()
  expect(slow.check(60_000, 60_001)).toBe('OFFICIAL_SLOW')
  const fast = new HermesFetchWatchdog(0)
  for (let t = 0; t <= 120_000; t += 10_000) expect(fast.check(t, t * 100 + 1)).toBeUndefined()
})
it('模拟：按 mtime 跟随存活子回执，跳过死父 running 回执；apply 结束标记进入 deps', async () => {
  const { root, checkout } = await fixture(), now = Date.now() - 1000, progress = vi.fn()
  const watch = new HermesWatch(root, checkout, join(root, 'status.json'), now, progress)
  vi.spyOn(process, 'kill').mockImplementation(((pid: number) => { if (pid === 101) throw Object.assign(new Error('gone'), { code: 'ESRCH' }); return true }) as any)
  await put(join(root, 'logs/update_receipts/update_zzz_parent.json'), { pid: 101, outcome: 'running', stages: [{ name: 'apply' }] }, now + 300)
  await put(join(root, 'logs/update_receipts/update_aaa_child.json'), { pid: 202, outcome: 'running', expected_sha: sha(3), stages: [{ name: 'apply', outcome: 'success' }] }, now + 200)
  await put(join(root, 'logs/update_receipts/latest.json'), { pid: 101, outcome: 'running', stages: [{ name: 'fetch' }] }, now + 100)
  await watch.poll(now + 400)
  expect(watch.currentStage).toBe('deps'); expect(watch.receiptPidAlive).toBe(true); expect(watch.expectedSha).toBe(sha(3))
})
it('模拟：重放 Windows 0.23.0→0.23.1 回执时间线，结束标记显示下一步，构建期间保持第 5 步', async () => {
  const { root, checkout } = await fixture(), progress = vi.fn()
  const at = (time: string) => Date.parse(`2026-11-14T${time}Z`)
  const watch = new HermesWatch(root, checkout, join(root, 'status.json'), at('13:46:37'), p => { cliDownloadProgressSchema.parse(p); progress(p) })
  const stages: { name: string; outcome: string; ended_at: string }[] = []
  // Times/outcomes from the reported real receipt; files and execution are simulated.
  for (const [name, outcome, time, currentStep, stepName] of [
    ['plan', 'success', '13:46:38', 2, 'snapshot'],
    ['snapshot', 'skipped', '13:46:38', 3, 'apply'],
    ['apply', 'success', '13:47:00', 4, 'deps'],
    ['deps', 'success', '13:47:54', 5, 'build'],
    ['build', 'success', '13:52:06', 6, 'restart'],
    ['restart', 'success', '13:52:13', 6, 'restart'],
  ] as const) {
    stages.push({ name, outcome, ended_at: `2026-11-14T${time}Z` })
    await put(join(root, 'logs/update_receipts/latest.json'), { pid: process.pid, outcome: 'running', stages }, at(time))
    await watch.poll(at(time))
    expect(progress.mock.calls.at(-1)![0]).toMatchObject({ currentStep, totalSteps: 6, stepName })
    if (name === 'deps') {
      await watch.poll(at('13:52:05'))
      expect(progress.mock.calls.at(-1)![0]).toMatchObject({ currentStep: 5, totalSteps: 6, stepName: 'build' })
      expect(watch.controller.signal.aborted).toBe(false)
    }
  }
  await put(join(root, 'logs/update_receipts/latest.json'), { pid: process.pid, outcome: 'success', stages }, at('13:52:14'))
  await watch.poll(at('13:52:14'))
  expect(progress.mock.calls.at(-1)![0]).toMatchObject({ currentStep: 6, totalSteps: 6, stepName: 'restart' })
})
it.each(['running', 'failed'])('模拟：%s 阶段不提前下一步，fetch 映射到 apply', async outcome => {
  const { root, checkout } = await fixture(), now = Date.now() - 1000, progress = vi.fn()
  const watch = new HermesWatch(root, checkout, join(root, 'status.json'), now, progress)
  for (const [index, name] of ['plan', 'snapshot', 'fetch', 'apply', 'deps', 'build', 'restart'].entries()) {
    await put(join(root, 'logs/update_receipts/latest.json'), { pid: process.pid, outcome, stages: [{ name, outcome }] }, now + index)
    await watch.poll(now + index)
    expect(progress.mock.calls.at(-1)![0]).toMatchObject({ currentStep: [1, 2, 3, 3, 4, 5, 6][index], totalSteps: 6, stepName: name === 'fetch' ? 'apply' : name })
  }
})
it.each(['success', 'skipped'])('模拟：fetch %s 结束标记显示第 3 步 apply', async outcome => {
  const { root, checkout } = await fixture(), now = Date.now() - 1000, progress = vi.fn()
  const watch = new HermesWatch(root, checkout, join(root, 'status.json'), now, progress)
  await put(join(root, 'logs/update_receipts/latest.json'), { pid: process.pid, outcome: 'running', stages: [{ name: 'fetch', outcome }] }, now + 1)
  await watch.poll(now + 1)
  expect(progress.mock.calls.at(-1)![0]).toMatchObject({ currentStep: 3, totalSteps: 6, stepName: 'apply' })
})
it.each([{ stages: [] }, { stages: [{ name: 'plan', outcome: 'success' }] }])('模拟：整体成功即使阶段记录不全也显示最后一步：%j', async ({ stages }) => {
  const { root, checkout } = await fixture(), now = Date.now() - 1000, progress = vi.fn()
  const watch = new HermesWatch(root, checkout, join(root, 'status.json'), now, progress)
  await put(join(root, 'logs/update_receipts/latest.json'), { outcome: 'success', stages }, now + 1)
  await watch.poll(now + 1)
  expect(progress.mock.calls.at(-1)![0]).toMatchObject({ currentStep: 6, totalSteps: 6, stepName: 'restart' })
})
it.each(['status', 'log', 'output'])('模拟：较新的 %s 旧阶段文本不使回执步数倒退', async source => {
  const { root, checkout } = await fixture(), now = Date.now() - 1000, progress = vi.fn(), status = join(root, 'status.json')
  const watch = new HermesWatch(root, checkout, status, now, progress)
  await put(join(root, 'logs/update_receipts/latest.json'), { pid: process.pid, outcome: 'running', stages: [{ name: 'deps', outcome: 'success' }] }, now + 1)
  await watch.poll(now + 1)
  expect(progress.mock.calls.at(-1)![0]).toMatchObject({ currentStep: 5, stepName: 'build' })
  if (source === 'status') await put(status, { stage: 'deps', message: 'Installing dependencies' }, now + 2)
  else if (source === 'log') await put(join(root, 'logs/update.log'), '→ Installing dependencies\n', now + 2)
  else watch.output('Installing dependencies\n', now + 2)
  await watch.poll(now + 3)
  expect(progress.mock.calls.at(-1)![0]).toMatchObject({ currentStep: 5, totalSteps: 6, stepName: 'build' })
})
it('模拟：状态与新日志能识别 fetch、uv、pnpm，旧 fetch 行不盖过新 apply 回执', async () => {
  const { watch, root, now, status } = await observer('fetch')
  await put(join(root, 'logs/update.log'), '→ Fetching updates...\n', now + 1); await watch.poll(now + 1)
  await put(join(root, 'logs/update_receipts/update_child.json'), { pid: process.pid, stages: [{ name: 'apply', outcome: 'running' }] }, now + 2); await watch.poll(now + 2)
  await put(join(root, 'logs/update.log'), '→ Fetching updates...\nReceiving objects: 1\n', now + 3); await watch.poll(now + 3)
  expect(watch.currentStage).toBe('apply')
  await put(status, { message: 'Installing Python dependencies with uv' }, now + 4); await watch.poll(now + 4); expect(watch.currentStage).toBe('uv')
  await put(status, { message: 'Installing Node dependencies with pnpm' }, now + 5); await watch.poll(now + 5); expect(watch.currentStage).toBe('pnpm')
})
it.each(['apply', 'restart', 'pnpm', 'uv', 'deps', 'build'])('模拟：%s 静默 120 秒与 5 分钟不误停，20 分钟租约兜底', async stage => {
  const { watch, now } = await observer(stage)
  await watch.poll(now + 120_000); expect(watch.controller.signal.aborted).toBe(false)
  await watch.poll(now + 19 * 60_000); expect(watch.controller.signal.aborted).toBe(false)
  await watch.poll(now + 20 * 60_000); expect(watch.controller.signal.reason).toMatchObject({ code: 'INSTALL_TIMEOUT' })
})
it('模拟：tmp_pack 增长计入活动，完成改名不丢字节，未知总量不带百分比', async () => {
  const { watch, now, checkout, progress } = await observer('fetch'), path = join(checkout, '.git/objects/pack/tmp_pack_test')
  await put(path, '1234'); await watch.poll(now + 1000)
  await rm(path); await watch.poll(now + 2000)
  expect(progress.mock.calls.at(-1)![0]).toMatchObject({ downloadedBytes: 4, byteProgressState: 'unknown-total' })
  expect(progress.mock.calls.at(-1)![0].totalBytes).toBeUndefined()
  await watch.poll(now + 11_000); expect(watch.reason).toBe('OFFICIAL_STALLED')
})
it('模拟：工具 .part 无增长 10 秒即停；日志噪声不掩盖工具停滞', async () => {
  const { watch, now, root } = await observer('tools')
  await put(join(root, 'cache/partials/a.part'), '1234'); await watch.poll(now + 1000)
  await put(join(root, 'logs/update.log'), '→ waiting for tools\n', now + 10_999); await watch.poll(now + 10_999)
  expect(watch.reason).toBeUndefined(); await watch.poll(now + 11_000); expect(watch.reason).toBe('OFFICIAL_STALLED')
})
it.each(['part', 'ranges'])('模拟：预分配 part 的 %s 活动持续不误停，全部不变 10 秒才停', async activity => {
  const { watch, now, root } = await observer('tools'), part = join(root, 'cache/partials/a.part'), ranges = join(root, 'cache/partials/a.ranges')
  await put(part, ''); await truncate(part, 128 * 1024 * 1024)
  await put(ranges, { total: 128 * 1024 * 1024, ranges: [] }); await watch.poll(now + 1)
  for (let t = 10_000; t <= 120_000; t += 10_000) {
    if (activity === 'part') await utimes(part, new Date(now + t), new Date(now + t))
    else await put(ranges, { total: 128 * 1024 * 1024, ranges: [[0, t]] }, now + t)
    await watch.poll(now + t); expect(watch.reason).toBeUndefined()
  }
  await watch.poll(now + 129_999); expect(watch.reason).toBeUndefined()
  await watch.poll(now + 130_000); expect(watch.reason).toBe('OFFICIAL_STALLED')
})
it('模拟：PM 完成文件出现延续工具活动，预分配、检查点和 staging 不算完成缓存增长', async () => {
  const { watch, now, root } = await observer('tools'), before = await observeHermesCache(root)
  const part = join(root, 'cache/partials/a.part'), staged = join(root, 'tools/.staging-simulated/fetch-a')
  await put(part, ''); await truncate(part, 128 * 1024 * 1024)
  await put(join(root, 'cache/partials/a.ranges'), { ranges: [[0, 10_000]] })
  await mkdir(staged, { recursive: true }); await put(join(staged, 'archive.zip'), 'not published')
  await put(join(root, 'tools/facts.json'), { packages: {} })
  await watch.poll(now + 1)
  expect(cacheGrew(before, await observeHermesCache(root))).toBe(false)
  const entry = join(root, `tools/fetch-${'a'.repeat(64)}`)
  await mkdir(entry, { recursive: true }); await put(join(entry, 'archive.zip'), 'finished verified content')
  await watch.poll(now + 29_000)
  expect(cacheGrew(before, await observeHermesCache(root))).toBe(true)
  await watch.poll(now + 38_999); expect(watch.reason).toBeUndefined()
  await watch.poll(now + 39_000); expect(watch.reason).toBe('OFFICIAL_STALLED')
})
it.each(['uv', 'pnpm'])('模拟：%s 缓存和日志更新延长 20 分钟租约，不按速度判慢', async stage => {
  const { watch, now, root } = await observer(stage), path = join(root, stage === 'uv' ? 'cache/uv/wheel' : 'cache/pnpm/store/pkg')
  for (let t = 10_000; t <= 130_000; t += 10_000) { await put(path, String(t)); await watch.poll(now + t); expect(watch.reason).toBeUndefined() }
  await put(join(root, 'logs/update.log'), '→ Compiling bytecode\n', now + 249_000); await watch.poll(now + 249_000)
  await watch.poll(now + 368_999); expect(watch.reason).toBeUndefined()
  await watch.poll(now + 369_000); expect(watch.controller.signal.aborted).toBe(false)
  await watch.poll(now + 1_449_000); expect(watch.controller.signal.reason).toMatchObject({ code: 'INSTALL_TIMEOUT' })
})
it('模拟：plan 保留 5 分钟无活动兜底，持续活动可续期超过 20 分钟', async () => {
  const { watch, now, root } = await observer('plan')
  for (let t = 240_000; t <= 1_440_000; t += 240_000) { await put(join(root, 'logs/update.log'), `→ working ${t}`, now + t); await watch.poll(now + t); expect(watch.controller.signal.aborted).toBe(false) }
  await watch.poll(now + 1_740_000); expect(watch.controller.signal.reason).toMatchObject({ code: 'INSTALL_TIMEOUT' })
})
it('模拟：稳定标签严格在 (current,target] 内按语义版本排序，使用 peeled SHA', () => {
  expect(hermesSegments(refs, '0.21.7', '0.23.1')).toEqual([{ tag: 'v0.22.0', sha: sha(2) }, { tag: 'v0.23.1', sha: sha(3) }])
  expect(() => hermesSegments(refs, '0.21.7', '0.23.2')).toThrow('INTEGRITY_MISMATCH')
  expect(() => hermesSegments(refs, 'unknown', '0.23.1')).toThrow('PREREQUISITE_MISSING')
})
it('模拟：fetch 慢→确认进程范围退出→分段预取→cat-file 校验→相同 argv 重跑，保留代理', async () => {
  const { root, checkout } = await fixture(), watches = captureWatches(), calls: any[] = []
  let confirm!: (v: boolean) => void
  const processRange = held(new Promise(r => { confirm = r }))
  const spawn = vi.fn((spec: any) => { calls.push(spec); return calls.length === 1 ? processRange : finished(spec.argv.includes('ls-remote') ? refs : '') })
  const o = options(root, checkout, spawn as any), progress = vi.fn(); o.progress = p => { cliDownloadProgressSchema.parse(p); progress(p) }
  o.npmRegistry = 'https://registry.npmmirror.com/'
  vi.stubEnv('HTTPS_PROXY', 'http://simulated-proxy:7890'); vi.stubEnv('NO_PROXY', 'existing.internal')
  try {
    const run = runHermesUpdate(o); await until(() => spawn.mock.calls.length === 1)
    await stall(watches[0]!); await until(() => processRange.waitForExit.mock.calls.length > 0)
    expect(spawn).toHaveBeenCalledTimes(1); confirm(true); await run
    expect(o.backend.resolveExecutable).toHaveBeenCalledWith('git')
    for (const c of [calls[0], calls.at(-1)]) expect(c.env.npm_config_registry).toBe(o.npmRegistry)
    const prefix = ['/simulated/git', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'fetch.prune=false', '-c', 'fetch.pruneTags=false', '-c', 'remote.origin.prune=false', '-c', 'remote.origin.pruneTags=false']
    expect(calls.map(c => c.argv)).toEqual([o.argv, [...prefix, 'ls-remote', '--tags', 'origin'],
      [...prefix, 'fetch', '--progress', '--no-tags', '--no-write-fetch-head', '--refmap=', '--no-prune', '--negotiation-tip=HEAD', '--negotiation-tip=HEAD', 'origin', 'refs/tags/v0.22.0'],
      [...prefix, 'fetch', '--progress', '--no-tags', '--no-write-fetch-head', '--refmap=', '--no-prune', `--negotiation-tip=${sha(2)}`, '--negotiation-tip=HEAD', 'origin', 'refs/tags/v0.23.1'],
      [...prefix, 'cat-file', '-e', `${sha(3)}^{commit}`], o.argv])
    for (const c of calls.slice(1, -1)) { expect(c.cwd).toBe(checkout); expect(c.env).toMatchObject({ HTTPS_PROXY: 'http://simulated-proxy:7890', NO_PROXY: 'existing.internal', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' }) }
    expect(progress.mock.calls.map(c => c[0])).toContainEqual(expect.objectContaining({ channel: 'takeover', reason: 'OFFICIAL_STALLED', currentStep: 2, totalSteps: 2, stepName: '第 2/2 段（v0.23.1）', byteProgressState: 'unknown-total' }))
    for (const p of progress.mock.calls.map(c => c[0]).filter(p => p.channel === 'takeover')) {
      expect(p.stage).toBe('Hermes 拉取停滞，插件按版本分段拉取代码，完成后交回官方更新')
      expect(p.resumeCount).toBe(0); expect(p).not.toHaveProperty('officialFailedAt')
    }
    expect(await readdir(join(root, 'cli-management/downloads'))).toEqual([])
  } finally { vi.unstubAllEnvs() }
})
it.each(['x64', 'arm64'])('模拟：Windows 使用本安装 PM pin Git（%s），不要求 PATH Git 或已记录 facts', async arch => {
  const { root, checkout } = await fixture(), o = options(root, checkout), target = `win32-${arch}`
  o.platform = 'win32'; o.arch = arch
  const binary = join(root, `tools/git-2.53.0+3-${target}/cmd/git.exe`)
  await mkdir(join(checkout, 'pm')); await put(join(checkout, 'pm/lock.json'), { packages: { git: { version: '2.53.0+3', artifacts: { [target]: { sha256: 'a'.repeat(64) } } } } })
  await mkdir(join(binary, '..'), { recursive: true }); await put(binary, 'simulated binary')
  expect(await resolveHermesGit(o)).toBe(binary); expect(o.backend.resolveExecutable).not.toHaveBeenCalled()
  const spawn = vi.fn((s: any) => finished(s.argv.includes('ls-remote') ? refs : '')); o.backend.spawn = spawn as any
  await prefetchHermes(o, 'OFFICIAL_SLOW', sha(3))
  expect(spawn.mock.calls.every(([s]) => s.argv[0] === binary)).toBe(true)
})
it('模拟：Windows 已记录 PM Git 与 runtimeDir 在 Hermes 根内可解析；缺失时回退 PATH', async () => {
  const { root, checkout } = await fixture(), o = options(root, checkout); o.platform = 'win32'; o.arch = 'x64'
  expect(await resolveHermesGit(o)).toBe('/simulated/git')
  const store = join(root, 'runtime'), entry = 'git-2.52.0+1-win32-x64', binary = join(store, entry, 'cmd/git.exe')
  await mkdir(join(binary, '..'), { recursive: true }); await put(binary, 'simulated binary')
  await put(join(checkout, 'install-stamp.json'), { runtimeDir: store })
  await put(join(store, 'facts.json'), { packages: { git: { version: '2.52.0+1', target: 'win32-x64', entry } } })
  expect(await resolveHermesGit(o)).toBe(binary)
  o.platform = 'linux'; expect(await resolveHermesGit(o)).toBe('/simulated/git')
})
it.each(['file-link', 'directory-link', 'outside-root', 'directory'])('模拟：PM Git %s 不是根内普通文件时回退 PATH', async mode => {
  const { root, checkout } = await fixture(), other = await fixture(), o = options(root, checkout); o.platform = 'win32'; o.arch = 'x64'
  const store = mode === 'outside-root' ? join(other.root, 'tools') : join(root, 'tools'), entry = 'git-2.53.0+3-win32-x64', binary = join(store, entry, 'cmd/git.exe')
  await mkdir(join(binary, '..'), { recursive: true })
  await put(join(store, 'facts.json'), { packages: { git: { version: '2.53.0+3', target: 'win32-x64', entry } } })
  await put(join(checkout, 'install-stamp.json'), { runtimeDir: store })
  if (mode === 'file-link') { const target = join(other.root, 'git.exe'); await put(target, 'simulated'); await symlink(target, binary) }
  else if (mode === 'directory-link') { await rm(join(store, entry), { recursive: true }); await mkdir(join(other.root, 'cmd')); await put(join(other.root, 'cmd/git.exe'), 'simulated'); await symlink(other.root, join(store, entry)) }
  else if (mode === 'directory') await mkdir(binary)
  else await put(binary, 'simulated')
  expect(await resolveHermesGit(o)).toBe('/simulated/git')
})
it.each(['mismatch', 'missing'])('模拟：目标 SHA %s 拒绝预取与安装', async mode => {
  const { root, checkout } = await fixture(), spawn = vi.fn(() => finished(refs)), o = options(root, checkout, spawn)
  o.targetSha = mode === 'mismatch' ? sha(8) : undefined
  await expect(prefetchHermes(o, 'OFFICIAL_SLOW', o.targetSha)).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  expect(spawn).toHaveBeenCalledTimes(1)
})
it('模拟：没有计划 SHA 时使用发布记录，Windows Git 带原生配置；cat-file 失败拒绝交回', async () => {
  const { root, checkout } = await fixture(), spawn = vi.fn((s: any) => finished(s.argv.includes('ls-remote') ? refs : '', s.argv.includes('cat-file') ? 1 : 0)), o = options(root, checkout, spawn as any)
  o.platform = 'win32'; o.targetSha = undefined; o.releaseSha = vi.fn(async () => sha(3))
  await expect(prefetchHermes(o, 'OFFICIAL_SLOW')).rejects.toMatchObject({ code: 'EXIT_CODE' })
  expect(o.releaseSha).toHaveBeenCalledWith('0.23.1', o.signal)
  for (const [s] of spawn.mock.calls) expect(s.argv.slice(0, 7)).toEqual(['/simulated/git', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'windows.appendAtomically=false'])
})
it('模拟：只有慢段重试，已完成段不重取；每段最多 3 次重试', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  const { root, checkout } = await fixture(), ranges: ReturnType<typeof held>[] = [], fetched: string[] = []
  const checks = new WeakMap<HermesFetchWatchdog, number>()
  vi.spyOn(HermesFetchWatchdog.prototype, 'check').mockImplementation(function (this: HermesFetchWatchdog) { const n = (checks.get(this) ?? 0) + 1; checks.set(this, n); return n > 1 ? 'OFFICIAL_SLOW' : undefined })
  const spawn = vi.fn((s: any) => {
    if (!s.argv.includes('fetch')) return finished(s.argv.includes('ls-remote') ? refs : '')
    fetched.push(s.argv.at(-1))
    if (s.argv.at(-1) === 'refs/tags/v0.22.0') return finished()
    const child = held(); ranges.push(child); return child
  })
  const o = options(root, checkout, spawn as any), progress = vi.fn(); o.progress = p => { cliDownloadProgressSchema.parse(p); progress(p) }
  const run = prefetchHermes(o, 'OFFICIAL_SLOW', sha(3)), outcome = run.catch(e => e)
  for (let n = 1; n <= 4; n++) { await until(() => ranges.length === n); await vi.advanceTimersByTimeAsync(1000); await until(() => ranges[n - 1]!.terminate.mock.calls.length > 0) }
  expect(await outcome).toBeInstanceOf(Error)
  expect(fetched).toEqual(['refs/tags/v0.22.0', ...Array(4).fill('refs/tags/v0.23.1')]); expect(vi.getTimerCount()).toBe(0)
  expect([...new Set(progress.mock.calls.map(([p]) => p.retryCount))]).toEqual([0, 1, 2, 3])
  for (const [p] of progress.mock.calls) { expect(p.resumeCount).toBe(0); expect(p).not.toHaveProperty('officialFailedAt'); expect(p.stage).toContain('Hermes 拉取过慢') }
})
it.each([false, true])('模拟：预取取消等待退出确认，清理未确认=%s 时不启动后续进程', async unconfirmed => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  const { root, checkout } = await fixture(), abort = new AbortController()
  let confirm!: (value: boolean) => void
  const child = held(new Promise(resolve => { confirm = resolve })), spawn = vi.fn((s: any) => s.argv.includes('fetch') ? child : finished(refs))
  const o = options(root, checkout, spawn as any); o.signal = abort.signal
  let settled = false
  const result = prefetchHermes(o, 'OFFICIAL_SLOW', sha(3)).catch(e => e).finally(() => { settled = true })
  await until(() => spawn.mock.calls.length === 2); abort.abort(new Error('模拟取消'))
  await until(() => child.waitForExit.mock.calls.length > 0); expect(settled).toBe(false)
  confirm(!unconfirmed)
  const error = await result
  if (unconfirmed) expect(error).toBeInstanceOf(ProcessCleanupUnconfirmedError); else expect(error.message).toBe('模拟取消')
  expect(child.terminate).toHaveBeenCalled(); expect(spawn).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0)
})
it.each([0, 1, 4])('模拟：依赖每次需新增缓存；连续有增长的尝试数 %s，最多重跑 3 次', async grows => {
  const { root, checkout } = await fixture(), watches = captureWatches(), spawn = vi.fn(() => held()), o = options(root, checkout, spawn as any)
  o.platform = 'win32'
  o.npmRegistry = 'https://registry.example.invalid/npm/'
  const run = runHermesUpdate(o).catch(e => e), attempts = Math.min(grows + 1, 4)
  for (let n = 0; n < attempts; n++) {
    await until(() => spawn.mock.calls.length === n + 1)
    await stall(watches[n]!, 'tools', n < grows ? () => put(join(root, `cache/uv/wheel${n}`), 'new cached wheel') : undefined)
  }
  expect(await run).toBeInstanceOf(Error); expect(spawn).toHaveBeenCalledTimes(attempts)
  for (const [spec] of (spawn.mock.calls as any[])) expect(spec.env.npm_config_registry).toBe(o.npmRegistry)
  expect(o.output).toHaveBeenCalledWith(expect.stringContaining('网关可能仍处于暂停'))
  expect(await readdir(join(root, 'cli-management/downloads'))).toEqual([])
})
it('模拟：缓存只改 mtime 不是新落盘；新增文件即使其他文件移除仍算增长', async () => {
  const { root } = await fixture(), a = join(root, 'cache/uv/a'), b = join(root, 'cache/uv/b')
  await put(a, 'old'); const before = await observeHermesCache(root)
  await utimes(a, new Date(0), new Date(0)); expect(cacheGrew(before, await observeHermesCache(root))).toBe(false)
  await rm(a); await put(b, 'n'); expect(cacheGrew(before, await observeHermesCache(root))).toBe(true)
})
it.each([false, true])('模拟：工具停滞仅完成文件允许重跑，预分配本身不算完成：%s', async completed => {
  const { root, checkout } = await fixture(), watches = captureWatches(), spawn = vi.fn(() => held()), o = options(root, checkout, spawn as any)
  const run = runHermesUpdate(o).catch(e => e)
  await until(() => spawn.mock.calls.length === 1)
  await stall(watches[0]!, 'tools', async () => {
    await put(join(root, 'cache/partials/a.part'), ''); await truncate(join(root, 'cache/partials/a.part'), 128 * 1024 * 1024)
    if (completed) { const entry = join(root, `tools/fetch-${'b'.repeat(64)}`); await mkdir(entry, { recursive: true }); await put(join(entry, 'archive.zip'), 'finished') }
  })
  if (completed) { await until(() => spawn.mock.calls.length === 2); await stall(watches[1]!, 'tools') }
  expect(await run).toBeInstanceOf(Error); expect(spawn).toHaveBeenCalledTimes(completed ? 2 : 1)
})
it('模拟：Hermes 清理未确认阻止 Git 接管并保留私有状态', async () => {
  const { root, checkout } = await fixture(), watches = captureWatches(), child = held(Promise.resolve(false)), spawn = vi.fn(() => child), o = options(root, checkout, spawn)
  const result = runHermesUpdate(o).catch(e => e); await until(() => spawn.mock.calls.length === 1); await stall(watches[0]!)
  expect(await result).toBeInstanceOf(ProcessCleanupUnconfirmedError); expect(spawn).toHaveBeenCalledTimes(1)
  expect(o.backend.resolveExecutable).not.toHaveBeenCalled()
  expect((await readdir(join(root, 'cli-management/downloads'))).length).toBe(1)
})
it('模拟：Windows 预取校验失败仍运行一次官方恢复，保留校验失败与网关提示', async () => {
  const { root, checkout } = await fixture(), watches = captureWatches(), calls: any[] = []
  const spawn = vi.fn((s: any) => { calls.push(s); return calls.length === 1 ? held() : finished(s.argv.includes('ls-remote') ? refs : '') }), o = options(root, checkout, spawn as any)
  o.platform = 'win32'; o.targetSha = sha(8)
  const result = runHermesUpdate(o).catch(e => e); await until(() => calls.length === 1); await stall(watches[0]!)
  expect(await result).toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  expect(calls.map(s => s.argv).filter(a => a[0] === 'simulated-hermes')).toEqual([o.argv, o.argv])
  expect(o.output).toHaveBeenCalledWith(expect.stringContaining('网关可能仍处于暂停'))
})
it('模拟：退出码 2 不重跑且保留检出与索引内容', async () => {
  const { root, checkout } = await fixture(), spawn = vi.fn(() => finished('', 2)), o = options(root, checkout, spawn)
  await put(join(checkout, '.git/index'), 'simulated index'); await put(join(checkout, 'worktree'), 'simulated worktree')
  await expect(runHermesUpdate(o)).rejects.toMatchObject({ code: 'EXIT_CODE' }); expect(spawn).toHaveBeenCalledTimes(1)
  expect(await readFile(join(checkout, '.git/index'), 'utf8')).toBe('simulated index'); expect(await readFile(join(checkout, 'worktree'), 'utf8')).toBe('simulated worktree')
})
it('模拟：慢段重试成功后仅推进下一段并完成校验', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  const { root, checkout } = await fixture(), child = held(), fetched: string[] = []
  const checks = new WeakMap<HermesFetchWatchdog, number>()
  vi.spyOn(HermesFetchWatchdog.prototype, 'check').mockImplementation(function (this: HermesFetchWatchdog) { const n = (checks.get(this) ?? 0) + 1; checks.set(this, n); return n > 1 ? 'OFFICIAL_STALLED' : undefined })
  const spawn = vi.fn((s: any) => {
    if (s.argv.includes('fetch')) { fetched.push(s.argv.at(-1)); return fetched.length === 2 ? child : finished() }
    return finished(s.argv.includes('ls-remote') ? refs : '')
  })
  const o = options(root, checkout, spawn as any), result = prefetchHermes(o, 'OFFICIAL_STALLED', sha(3))
  await until(() => fetched.length === 2); await vi.advanceTimersByTimeAsync(1000); await result
  expect(fetched).toEqual(['refs/tags/v0.22.0', 'refs/tags/v0.23.1', 'refs/tags/v0.23.1'])
  expect(spawn.mock.calls.at(-1)![0].argv).toContain('cat-file'); expect(vi.getTimerCount()).toBe(0)
})
it('模拟：完整更新在预取中取消，确认 Git 退出后才移除私有状态，不重跑 Hermes', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  const { root, checkout } = await fixture(), watches = captureWatches(), abort = new AbortController()
  let confirm!: (value: boolean) => void
  const git = held(new Promise(resolve => { confirm = resolve })), calls: any[] = []
  const spawn = vi.fn((s: any) => { calls.push(s); return calls.length === 1 ? held() : s.argv.includes('fetch') ? git : finished(refs) })
  const o = options(root, checkout, spawn as any); o.signal = abort.signal
  let settled = false
  const result = runHermesUpdate(o).catch(e => e).finally(() => { settled = true })
  await until(() => calls.length === 1); await stall(watches[0]!); await until(() => calls.length === 3)
  abort.abort(new Error('模拟取消')); await until(() => git.waitForExit.mock.calls.length > 0)
  expect(settled).toBe(false); expect((await readdir(join(root, 'cli-management/downloads'))).length).toBe(1)
  confirm(true); expect(await result).toMatchObject({ message: '模拟取消' })
  expect(await readdir(join(root, 'cli-management/downloads'))).toEqual([]); expect(calls).toHaveLength(3); expect(vi.getTimerCount()).toBe(0)
})
it('模拟：没有计划 SHA 时使用本次回执 expected_sha，不查询发布源', async () => {
  const { root, checkout } = await fixture(), watches = captureWatches(), calls: any[] = []
  const spawn = vi.fn((s: any) => { calls.push(s); return calls.length === 1 ? held() : finished(s.argv.includes('ls-remote') ? refs : '') })
  const o = options(root, checkout, spawn as any); o.targetSha = undefined; o.releaseSha = vi.fn(async () => sha(8))
  const result = runHermesUpdate(o)
  await until(() => calls.length === 1)
  await put(join(root, 'logs/update_receipts/update_expected.json'), { pid: process.pid, expected_sha: sha(3), stage: 'fetch' })
  await stall(watches[0]!); await result
  expect(o.releaseSha).not.toHaveBeenCalled(); expect(calls.at(-1).argv).toEqual(o.argv)
})
it.each([
  ['计划提交是更新前的提交', { plan: { expected_sha: sha(7), expected_version: '0.21.7' }, pre_update: { sha: sha(7), version: '0.21.7' } }],
  ['顶层提交等于更新前提交', { expected_sha: sha(7), pre_update: { sha: sha(7) } }],
])('模拟：回执%s时不当作目标提交，改查发布记录', async (_name, fields) => {
  // 2026-11-17 Mac 实测：Hermes 0.23.1 回执 plan.expected_sha 等于 pre_update.sha，曾被当作目标提交，导致 INTEGRITY_MISMATCH。
  const { root, checkout } = await fixture(), watches = captureWatches(), calls: any[] = []
  const spawn = vi.fn((s: any) => { calls.push(s); return calls.length === 1 ? held() : finished(s.argv.includes('ls-remote') ? refs : '') })
  const o = options(root, checkout, spawn as any); o.targetSha = undefined; o.releaseSha = vi.fn(async () => sha(3))
  const result = runHermesUpdate(o)
  await until(() => calls.length === 1)
  await put(join(root, 'logs/update_receipts/update_expected.json'), { pid: process.pid, stage: 'fetch', ...fields })
  await stall(watches[0]!); await result
  expect(watches[0]!.expectedSha).toBeUndefined(); expect(o.releaseSha).toHaveBeenCalled(); expect(calls.at(-1).argv).toEqual(o.argv)
})
it('模拟：计划版本就是目标版本时，plan.expected_sha 可作为目标提交', async () => {
  const { root, checkout } = await fixture(), watches = captureWatches(), calls: any[] = []
  const spawn = vi.fn((s: any) => { calls.push(s); return calls.length === 1 ? held() : finished(s.argv.includes('ls-remote') ? refs : '') })
  const o = options(root, checkout, spawn as any); o.targetSha = undefined; o.releaseSha = vi.fn(async () => sha(8))
  const result = runHermesUpdate(o)
  await until(() => calls.length === 1)
  await put(join(root, 'logs/update_receipts/update_expected.json'), { pid: process.pid, stage: 'fetch', plan: { expected_sha: sha(3), expected_version: '0.23.1' }, pre_update: { sha: sha(7) } })
  await stall(watches[0]!); await result
  expect(watches[0]!.expectedSha).toBe(sha(3)); expect(o.releaseSha).not.toHaveBeenCalled()
})
it('模拟：Downloading uv 是工具下载阶段，采用 10 秒无增长规则', async () => {
  const { watch, status, now } = await observer('deps')
  await put(status, { message: 'Downloading uv runtime tool' }, now + 1); await watch.poll(now + 1)
  expect(watch.currentStage).toBe('tools'); await watch.poll(now + 10_001); expect(watch.reason).toBe('OFFICIAL_STALLED')
})
it('模拟：原生 Downloading updates 与旧版 PM 子进程状态区分 fetch、工具下载及 uv', async () => {
  const { watch, status, root, now } = await observer('plan')
  await put(status, { message: 'Downloading updates' }, now + 1); await watch.poll(now + 1); expect(watch.currentStage).toBe('fetch')
  await put(status, { message: 'Updating Python dependencies (PM)' }, now + 2)
  await put(join(root, 'cache/partials/uv.part'), 'partial'); await watch.poll(now + 2); expect(watch.currentStage).toBe('deps')
  await watch.poll(now + 10_002); expect(watch.reason).toBe('OFFICIAL_STALLED')
  const next = new HermesWatch(root, watch.checkout, status, now, () => {})
  await put(join(root, 'logs/update.log'), 'Installing Python dependencies\n', now + 10_003)
  await next.poll(now + 10_003); expect(next.currentStage).toBe('uv')
})

it.each(['stdout', 'log', 'status', 'receipt'])('模拟：%s 完成标记后安静等待退出，只有 20 分钟租约兜底', async source => {
  const { root, checkout } = await fixture(), now = Date.now() - 1000, status = join(root, 'status.json')
  const watch = new HermesWatch(root, checkout, status, now, () => {}, { version: '0.23.1', sha: sha(3) })
  await watch.snapshot(); await put(status, { stage: 'fetch' }, now + 1)
  if (source === 'stdout') { watch.output('✓ Code up', now + 1); watch.output('dated!', now + 1) }
  if (source === 'log') await put(join(root, 'logs/update.log'), '✓ Update complete! (v0.23.1)', now + 1)
  if (source === 'status') await put(status, { stage: 'fetch', message: '✓ Code updated!' }, now + 1)
  if (source === 'receipt') await put(join(root, 'logs/update_receipts/latest.json'), { outcome: 'success', post_update: { commit: sha(3) } }, now + 1)
  await watch.poll(now + 1); await watch.poll(now + 600_000)
  expect(watch.controller.signal.aborted).toBe(false)
  await watch.poll(now + 1_200_001); expect(watch.controller.signal.reason).toMatchObject({ code: 'INSTALL_TIMEOUT' })
})
it.each([
  ['Update complete!', false], ['Code updated!', false],
  ['Update complete!', true], ['Code updated!', true],
] as const)('模拟：完成标记 %s 后接大于 4096 字符（跨块=%s）仍等待退出', async (marker, split) => {
  const { watch, now } = await observer('fetch')
  if (split) watch.output(`✓ ${marker.slice(0, 6)}`, now + 1)
  watch.output(`${split ? marker.slice(6) : `✓ ${marker}`}\n${'x'.repeat(8192)}`, now + 1)
  await watch.poll(now + 600_001)
  expect(watch.controller.signal.aborted).toBe(false)
  await watch.poll(now + 1_200_001)
  expect(watch.controller.signal.reason).toMatchObject({ code: 'INSTALL_TIMEOUT' })
})
it('模拟：非目标成功回执不屏蔽 fetch 停滞', async () => {
  const { root, checkout } = await fixture(), now = Date.now() - 1000, status = join(root, 'status.json')
  const watch = new HermesWatch(root, checkout, status, now, () => {}, { version: '0.23.1' })
  await watch.snapshot(); await put(status, { stage: 'fetch' }, now + 1)
  await put(join(root, 'logs/update_receipts/latest.json'), { outcome: 'success', post_update: { version: '0.21.7' } }, now + 1)
  await watch.poll(now + 1); await watch.poll(now + 60_001); expect(watch.reason).toBe('OFFICIAL_STALLED')
})
it.each(['node_modules', 'web/node_modules', 'ui-tui/node_modules'])('模拟：%s 文件写入延长安静构建租约', async tree => {
  const { watch, checkout, now } = await observer('build'), dir = join(checkout, tree)
  await mkdir(dir, { recursive: true }); await put(join(dir, 'built.js'), 'compiled')
  await watch.poll(now + 1_100_000); await watch.poll(now + 1_300_000)
  expect(watch.controller.signal.aborted).toBe(false)
  await watch.poll(now + 2_300_000); expect(watch.controller.signal.reason).toMatchObject({ code: 'INSTALL_TIMEOUT' })
})
it('模拟：stdout/stderr 无换行的活动直接识别完成，不等待行缓冲或 EOF', async () => {
  const { root, checkout } = await fixture(), watches = captureWatches(), child = held()
  const stdout = new PassThrough(), stderr = new PassThrough(), activity = vi.spyOn(HermesWatch.prototype, 'output')
  child.stdout = stdout; child.stderr = stderr
  const spawn = vi.fn(() => child), o = options(root, checkout, spawn), result = runHermesUpdate(o)
  await until(() => spawn.mock.calls.length === 1)
  stdout.write('✓ Code updated!'); stderr.write('waiting')
  await until(() => activity.mock.calls.length >= 2)
  expect(o.output).not.toHaveBeenCalled()
  await put(watches[0]!.status, { stage: 'fetch' })
  await watches[0]!.poll(); await watches[0]!.poll(Date.now() + 180_000)
  expect(child.terminate).not.toHaveBeenCalled()
  stdout.end(); stderr.end()
  o.verifyInstalled = vi.fn(async () => true); child.terminate(); await result
  expect(o.verifyInstalled).toHaveBeenCalledTimes(1)
})
it('模拟：失败后版本已到目标不重跑；清理未确认不回读成成功', async () => {
  const { root, checkout } = await fixture(), spawn = vi.fn(() => finished('', 2)), o = options(root, checkout, spawn)
  o.verifyInstalled = vi.fn(async () => true)
  await runHermesUpdate(o); expect(spawn).toHaveBeenCalledTimes(1)
  expect(o.verifyInstalled).toHaveBeenCalledTimes(1)
  const blocked = options(root, checkout, vi.fn(() => ({ ...finished('', 1), waitForExit: vi.fn(async () => false) })))
  blocked.verifyInstalled = vi.fn(async () => true)
  await expect(runHermesUpdate(blocked)).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
  expect(blocked.verifyInstalled).not.toHaveBeenCalled()
})
it('模拟：无接管路径的依赖错误如实说明重跑次数', async () => {
  const { root, checkout } = await fixture(), watches = captureWatches(), o = options(root, checkout, vi.fn(() => held()))
  const result = runHermesUpdate(o).catch(e => e)
  await until(() => watches.length === 1); await stall(watches[0]!, 'tools')
  const error = await result
  expect(error.message).toContain('重跑 0 次后仍无进展'); expect(error.message).not.toContain('准备切换插件接管')
})
it('模拟：标准输出无换行也为 plan 的 5 分钟兜底续期', async () => {
  const { watch, now } = await observer('plan')
  for (let t = 240_000; t < 1_500_000; t += 240_000) {
    watch.output('still working', now + t); await watch.poll(now + t)
    expect(watch.controller.signal.aborted).toBe(false)
  }
  await watch.poll(now + 1_740_000); expect(watch.controller.signal.reason).toMatchObject({ code: 'INSTALL_TIMEOUT' })
})
it('模拟：旧的下载分片不是本次 deps 下载证据', async () => {
  const { root, checkout } = await fixture(), status = join(root, 'status.json'), now = Date.now()
  await put(join(root, 'cache/partials/old.part'), 'old', now - 100_000)
  const watch = new HermesWatch(root, checkout, status, now, () => {})
  await watch.snapshot(); await put(status, { stage: 'deps' }, now + 1)
  await watch.poll(now + 1); await watch.poll(now + 180_000)
  expect(watch.controller.signal.aborted).toBe(false)
})
it.each(['npm-cache', 'pnpm-store'])('模拟：显式 %s 文件写入延长 Node 阶段租约', async name => {
  const { root, checkout } = await fixture(), status = join(root, 'status.json'), now = Date.now(), cache = join(root, name)
  await mkdir(cache)
  const watch = new HermesWatch(root, checkout, status, now, () => {}, undefined, [cache])
  await watch.snapshot(); await put(status, { stage: 'pnpm' }, now + 1); await watch.poll(now + 1)
  await put(join(cache, 'package'), 'new cache content'); await watch.poll(now + 1_100_000)
  await watch.poll(now + 1_300_000); expect(watch.controller.signal.aborted).toBe(false)
})

it('模拟：只有 tools 阶段名而无下载文字或本次分片，不按下载停滞中止', async () => {
  const { watch, now } = await observer('tools')
  await watch.poll(now + 180_000); expect(watch.controller.signal.aborted).toBe(false)
})
it('模拟：Fetching release history 不误判为代码 fetch', async () => {
  const { watch, now, root } = await observer('pnpm')
  await put(join(root, 'logs/update.log'), 'Fetching release history (timeout 30 s)', now + 1)
  await watch.poll(now + 1); expect(watch.currentStage).toBe('pnpm')
  await watch.poll(now + 180_000); expect(watch.controller.signal.aborted).toBe(false)
})

it('模拟：仅 stdout 提供 Node 阶段时也使用 20 分钟租约', async () => {
  const { watch, now } = await observer('plan')
  watch.output('Updating Node dependencies', now + 1)
  await watch.poll(now + 360_000)
  expect(watch.currentStage).toBe('pnpm'); expect(watch.controller.signal.aborted).toBe(false)
})

it('模拟：Hermes fetch 在 9999 毫秒等待，10000 毫秒停止；apply 禁用短时钟', async () => {
  const a = await observer('fetch')
  await a.watch.poll(a.now + 9_999); expect(a.watch.reason).toBeUndefined()
  await a.watch.poll(a.now + 10_000); expect(a.watch.reason).toBe('OFFICIAL_STALLED')
  const b = await observer('fetch')
  await put(b.status, { stage: 'apply' }, b.now + 9_999); await b.watch.poll(b.now + 9_999)
  await b.watch.poll(b.now + 60_000); expect(b.watch.reason).toBeUndefined()
})
it.each(['plan', 'apply', 'deps', 'tools', 'uv', 'pnpm', 'build', 'restart'])('模拟：Hermes %s 没有预取接管配方，拒绝手动接管', async stage => {
  const { watch } = await observer(stage)
  expect(watch.requestTakeover()).toBe(false); expect(watch.controller.signal.aborted).toBe(false)
})
it('模拟：update.log 残留上一次「Update complete!」不让本次判为完成，10 秒停滞与手动切换仍可用', async () => {
  // 2026-11-17 Mac 实测复现：Hermes 追加写 update.log，旧尾部的完成行曾让本次 fetch 被判完成。
  const { root, checkout } = await fixture(), now = Date.now() - 1000, log = join(root, 'logs/update.log')
  await put(log, '=== hermes update started 2026-11-14 ===\n✓ Update complete! (v0.21.7 → v0.23.1)\nTip: hermes model\n', now - 60_000)
  const watch = new HermesWatch(root, checkout, join(root, 'status.json'), now, () => {}, { version: '0.23.2' }); await watch.snapshot()
  await put(log, '=== hermes update started 2026-11-14 ===\n✓ Update complete! (v0.21.7 → v0.23.1)\nTip: hermes model\n=== hermes update started 2026-11-17 ===\n→ Fetching updates...\n', now + 1)
  await watch.poll(now + 1)
  expect(watch.currentStage).toBe('fetch'); expect(watch.canTakeover).toBe(true)
  await watch.poll(now + 10_001); expect(watch.reason).toBe('OFFICIAL_STALLED')
  const manual = new HermesWatch(root, checkout, join(root, 'status-2.json'), now + 2, () => {}, { version: '0.23.2' }); await manual.snapshot()
  await writeFile(log, '→ Fetching updates...\n', { flag: 'a' }); await utimes(log, new Date(now + 3), new Date(now + 3))
  await manual.poll(now + 3)
  expect(manual.requestTakeover()).toBe(true)
  // 本次自己写出的完成行仍然生效。
  const done = new HermesWatch(root, checkout, join(root, 'status-3.json'), now + 4, () => {}, { version: '0.23.2' }); await done.snapshot()
  await writeFile(log, '→ Fetching updates...\n✓ Update complete! (v0.23.1 → v0.23.2)\n', { flag: 'a' }); await utimes(log, new Date(now + 5), new Date(now + 5))
  await done.poll(now + 5); expect(done.canTakeover).toBe(false); expect(done.requestTakeover()).toBe(false)
})
it('模拟：Hermes 手动 fetch 接管等待进程树退出才预取，清除公开 watch 句柄', async () => {
  const { root, checkout } = await fixture()
  let confirm!: (exited: boolean) => void
  const child = held(new Promise(resolve => { confirm = resolve })), calls: any[] = []
  const spawn = vi.fn((s: any) => { calls.push(s); return calls.length === 1 ? child : finished(s.argv.includes('ls-remote') ? refs : '') })
  const o = options(root, checkout, spawn as any), onWatch = vi.fn(); o.onWatch = onWatch
  const pending = runHermesUpdate(o)
  await until(() => calls.length === 1)
  const watch = onWatch.mock.calls.at(-1)![0] as HermesWatch
  watch.output('Downloading updates')
  expect(watch.requestTakeover()).toBe(true)
  expect(watch.requestTakeover()).toBe(false)
  await until(() => child.waitForExit.mock.calls.length > 0)
  expect(calls).toHaveLength(1)
  expect(onWatch.mock.calls.at(-1)![0]).toBe(watch)
  expect((await readdir(join(root, 'cli-management/downloads'))).length).toBe(1)
  confirm(true); await pending
  expect(calls.some(s => s.argv.includes('fetch'))).toBe(true)
  expect(onWatch.mock.calls.at(-1)![0]).toBeUndefined()
  expect(await readdir(join(root, 'cli-management/downloads'))).toEqual([])
})
it.each(['Verifying tool signature', 'Extracting runtime archive', 'Installing tool', 'Windows Defender scan'])('模拟：Hermes 工具下载后 %s 即使仍留 part 也不按 10 秒停滞中止', async marker => {
  const { watch, now, root } = await observer('tools')
  watch.output('Downloading uv runtime tool\n', now + 1)
  await put(join(root, 'cache/partials/tool.part'), 'partial'); await watch.poll(now + 1)
  watch.output(marker + '\n', now + 9_000)
  await watch.poll(now + 60_000); expect(watch.reason).toBeUndefined()
})
it('模拟：Hermes 旧下载日志不能覆盖较新的签名阶段，新下载独立获得 10 秒', async () => {
  const { watch, now, root } = await observer('tools'), log = join(root, 'logs/update.log')
  await put(log, 'Downloading uv runtime tool\n', now + 1); await watch.poll(now + 1)
  watch.output('Verifying tool signature\n', now + 9_000)
  await put(log, 'Downloading uv runtime tool\nwaiting\n', now + 10_000)
  await watch.poll(now + 60_000); expect(watch.reason).toBeUndefined()
  watch.output('Downloading node runtime tool\n', now + 60_001)
  await watch.poll(now + 70_000); expect(watch.reason).toBeUndefined()
  await watch.poll(now + 70_001); expect(watch.reason).toBe('OFFICIAL_STALLED')
})
