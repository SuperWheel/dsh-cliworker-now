/** 模拟：合成回执、update.log、检出目录与进程后端；不运行 Hermes、Git，不读取用户安装或账号。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, realpath, mkdir, writeFile, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { readHermesIncomplete } from '../src/host/cli-management/hermes-incomplete.ts'
import { hermesDirectoryProcesses } from '../src/host/cli-management/update-residue.ts'
import * as residue from '../src/host/cli-management/update-residue.ts'
import * as hermesUpdate from '../src/host/cli-management/hermes-watch.ts'
import { HermesWatch } from '../src/host/cli-management/hermes-watch.ts'
import { cliDownloadProgressSchema, cliUpdateIncompleteSchema, CLI_OPERATION_TERMINAL } from '../src/shared/cli-management.ts'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
import { serviceFixture, syntheticIdentity, checked, finished } from './cli-management-phase-b-fixture.ts'

const simulated = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => simulated.home || '/模拟/home' }))
const roots: string[] = [], fixtures: ReturnType<typeof serviceFixture>[] = []
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close()
  simulated.home = ''; vi.unstubAllEnvs(); vi.restoreAllMocks()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const HEAD = 'ae2a81ccc00e9b7c06301523e5bb09608397149c', OLD = '3b421578588243f920886e6fe79a6faa87ea026e'
/** 2026-11-17 Windows 实机回执的字段形状（合成值，路径为模拟）。 */
const receipt = (patch: Record<string, unknown> = {}) => ({
  schema: 1, outcome: 'success', update_id: '7f0ce20d57e944a085c866b5334f73b2',
  pre_update: { sha: OLD, version: '0.23.1', source: 'git' }, post_update: { sha: HEAD, version: '0.23.2', source: 'git' },
  stages: [{ name: 'plan', outcome: 'success' }, { name: 'snapshot', outcome: 'skipped' }, { name: 'apply', outcome: 'success' }, { name: 'deps', outcome: 'success' }, { name: 'build', outcome: 'failed' }, { name: 'restart', outcome: 'success' }],
  followups: [{ step: 'build', reason: 'Node dependencies: C:\\模拟\\python.exe -I -S -c import ctypes, subprocess', at: '2026-11-17T12:54:00+00:00' }],
  ...patch,
})
const clean = () => receipt({ update_id: 'b'.repeat(32), stages: [{ name: 'build', outcome: 'success' }], followups: [] })
const eperm = (home: string) => `=== hermes update started 2026-11-14T22:24:55 ===\n  ✓ Preparing Node dependencies\n=== hermes update started 2026-11-17T20:47:47 ===\n  ✗ Preparing Node dependencies failed; last 19 lines of output:\n      Error: EPERM: operation not permitted, rename '${join(home, 'hermes-agent', 'node_modules')}' -> '${join(home, 'hermes-agent', '.cache/node-deps-previous/node_modules')}'\n          at renameSync (node:fs:1357:11)\n✓ Update complete! (v0.23.1 → v0.23.2)\n`
async function installation(value: unknown = receipt(), log?: string) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'hermes-incomplete-simulated-'))); roots.push(home)
  const checkout = join(home, 'hermes-agent')
  await mkdir(join(home, 'logs/update_receipts'), { recursive: true }); await mkdir(join(checkout, '.git'), { recursive: true })
  await writeFile(join(checkout, '.git/HEAD'), HEAD + '\n')
  await writeFile(join(home, 'logs/update_receipts/latest.json'), JSON.stringify(value))
  await writeFile(join(home, 'logs/update.log'), log ?? eperm(home))
  return { home, checkout }
}

it('模拟：回执 success 且 HEAD 相符、build 失败并有 followups 时判为后续步骤未完成，原因取 update.log 的改名行并脱敏截短', async () => {
  const { home, checkout } = await installation()
  const owed = await readHermesIncomplete(home, checkout)
  expect(owed).toMatchObject({ steps: ['build'], renameBusy: true, updateId: '7f0ce20d57e944a085c866b5334f73b2' })
  expect(owed!.detail).toMatch(/^EPERM: operation not permitted, rename '<Hermes 代码目录>.node_modules' -> '<Hermes 代码目录>/)
  // 安装路径（含用户名）与截断的启动命令都不外传。
  expect(owed!.detail).not.toContain(home); expect(owed!.detail).not.toContain('python.exe'); expect(owed!.detail!.length).toBeLessThanOrEqual(240)
  expect(cliUpdateIncompleteSchema.safeParse({ steps: owed!.steps, detail: owed!.detail }).success).toBe(true)
})

it.each([
  ['回执不是 success', receipt({ outcome: 'failed' })],
  ['post_update 不是当前 HEAD', receipt({ post_update: { sha: OLD, version: '0.23.1', source: 'git' } })],
  ['各步成功且没有 followups', clean()],
  ['回执不是 JSON', '{'],
])('模拟：%s 时不判为未完成', async (_name, value) => {
  const { home, checkout } = await installation(value)
  expect(await readHermesIncomplete(home, checkout)).toBeUndefined()
})

it('模拟：没有改名行或改名对象不是 node_modules 时不给原因、不触发自动重试；旧一次运行的 EPERM 不算本次', async () => {
  const previous = '=== hermes update started 2026-11-14T22:24:55 ===\nError: EPERM: operation not permitted, rename \'x/node_modules\' -> \'y\'\n=== hermes update started 2026-11-17T20:47:47 ===\n  ✗ Building the web UI failed\n'
  const other = await installation(receipt(), previous)
  expect(await readHermesIncomplete(other.home, other.checkout)).toEqual({ steps: ['build'], renameBusy: false, updateId: '7f0ce20d57e944a085c866b5334f73b2' })
  const dist = await installation(receipt({ stages: [{ name: 'deps', outcome: 'failed' }], followups: [{ step: 'dependencies' }, { step: 'Bad Step!' }] }), '=== hermes update started x ===\nError: EBUSY: resource busy or locked, rename \'ui-tui/.dist-KE5saz\' -> \'ui-tui/dist\'\n')
  expect(await readHermesIncomplete(dist.home, dist.checkout)).toMatchObject({ steps: ['deps', 'dependencies'], renameBusy: false, detail: expect.stringContaining('EBUSY') })
})

it('模拟：分支 HEAD 经松散引用或 packed-refs 解析后与回执比对', async () => {
  const { home, checkout } = await installation()
  await writeFile(join(checkout, '.git/HEAD'), 'ref: refs/heads/main\n')
  await writeFile(join(checkout, '.git/packed-refs'), `# pack-refs\n${HEAD} refs/heads/main\n`)
  expect(await readHermesIncomplete(home, checkout)).toMatchObject({ steps: ['build'] })
  await mkdir(join(checkout, '.git/refs/heads'), { recursive: true }); await writeFile(join(checkout, '.git/refs/heads/main'), OLD + '\n')
  expect(await readHermesIncomplete(home, checkout)).toBeUndefined()
})

const backendOf = (text: string, exitCode = 0) => ({ resolveExecutable: vi.fn(async (name: string) => name), spawn: vi.fn(() => ({ stdout: Readable.from([text]), stderr: Readable.from([]), done: Promise.resolve({ exitCode, signal: null }), terminate: vi.fn(), waitForExit: vi.fn(async () => true) })) }) as unknown as ProcessBackend
it('模拟：只列出可执行文件或命令行在 Hermes 目录内的进程的名字和 PID；列不出返回 undefined，没有则为空表', async () => {
  const home = 'C:\\Users\\模拟\\AppData\\Local\\hermes', checkout = home + '\\hermes-agent'
  const rows = [
    { ProcessId: 4, Name: 'System', ExecutablePath: null, CommandLine: null },
    { ProcessId: 4321, Name: 'node.exe', ExecutablePath: home + '\\tools\\node-26.12.1-win32-x64\\node.exe', CommandLine: 'node.exe x.mjs' },
    { ProcessId: 5555, Name: 'esbuild.exe', ExecutablePath: 'C:\\Other\\esbuild.exe', CommandLine: `"C:\\Other\\esbuild.exe" --service --cwd=${checkout.toUpperCase()}\\web` },
    { ProcessId: 7777, Name: 'DeepSeek Harness.exe', ExecutablePath: 'C:\\Program Files\\DSH\\DeepSeek Harness.exe', CommandLine: 'x --token=secret' },
    { ProcessId: 8888, Name: 'python.exe', ExecutablePath: 'C:\\Users\\模拟\\AppData\\Local\\hermes-other\\python.exe', CommandLine: 'python.exe' },
  ]
  const windows = backendOf(JSON.stringify(rows))
  expect(await hermesDirectoryProcesses(home, checkout, windows, DEFAULT_CONFIG, 'win32')).toEqual([{ name: 'node.exe', pid: 4321 }, { name: 'esbuild.exe', pid: 5555 }])
  // 只读枚举，参数数组，不拼 shell。
  expect(vi.mocked(windows.spawn).mock.calls[0]![0]).toMatchObject({ argv: expect.arrayContaining(['powershell.exe', '-NoProfile', '-NonInteractive']) })
  expect(await hermesDirectoryProcesses(home, checkout, backendOf(JSON.stringify([rows[0], rows[3]])), DEFAULT_CONFIG, 'win32')).toEqual([])
  expect(await hermesDirectoryProcesses(home, checkout, backendOf('not json'), DEFAULT_CONFIG, 'win32')).toBeUndefined()
  const posix = backendOf('    1 /sbin/launchd\n  321 /模拟/home/.hermes/hermes-agent/venv/bin/python -m gateway\n  322 /usr/bin/node /模拟/home/.hermes-other/x.js\n')
  expect(await hermesDirectoryProcesses('/模拟/home/.hermes', '/模拟/home/.hermes/hermes-agent', posix, DEFAULT_CONFIG, 'darwin')).toEqual([{ name: 'python', pid: 321 }])
  expect(await hermesDirectoryProcesses('/模拟/home/.hermes', '/模拟/home/.hermes/hermes-agent', backendOf(''), DEFAULT_CONFIG, 'darwin')).toBeUndefined()
})

it('模拟：Windows 下活动遍历根不含检出目录内的任何路径', async () => {
  const { home, checkout } = await installation(), cache = join(home, 'npm-cache')
  const watch = new HermesWatch(home, checkout, join(home, 'status.json'), Date.now(), () => {}, undefined, [cache]); watch.platform = 'win32'
  for (const activity of [false, true]) {
    const walked: string[] = (watch as any).workRoots(activity)
    expect(walked.filter(path => path === checkout || path.startsWith(checkout + '/') || path.startsWith(checkout + '\\'))).toEqual([])
  }
  expect((watch as any).workRoots(true)).toEqual([cache])
  watch.platform = 'darwin'
  expect((watch as any).workRoots(false)).toContain(join(checkout, 'node_modules'))
})

it('模拟：从中断处继续的运行在取码阶段静默 60 秒不被停、不提供切换，阶段文字写「从中断处继续」而不是「插件已下载目标代码」', async () => {
  const { home, checkout } = await installation(), now = Date.now() - 1000, status = join(home, 'status.json'), stages: (string | undefined)[] = []
  await mkdir(join(checkout, '.git/objects/pack'), { recursive: true })
  await rm(join(home, 'logs/update_receipts/latest.json'))
  for (const dir of ['cache/partials', 'cache/uv', 'cache/pnpm/store']) await mkdir(join(home, dir), { recursive: true })
  const watch = new HermesWatch(home, checkout, status, now, p => { cliDownloadProgressSchema.parse(p); stages.push(p.stage) }, { version: '0.23.2', sha: HEAD }, [], false, true)
  await watch.snapshot()
  await writeFile(status, JSON.stringify({ stage: 'fetch', message: 'Fetching updates...' })); await utimes(status, new Date(now + 1), new Date(now + 1))
  await watch.poll(now + 1); expect(watch.currentStage).toBe('fetch')
  await watch.poll(now + 60_000)
  expect(watch.controller.signal.aborted).toBe(false); expect(watch.canTakeover).toBe(false); expect(watch.requestTakeover()).toBe(false)
  expect(stages.at(-1)).toBe('从中断处继续，不重新应用代码（Fetching updates...）')
  expect(stages.join('\n')).not.toContain('插件已下载目标代码')
})

/** 服务层：runHermesUpdate 与进程枚举为夹具；回执、日志与 HEAD 写在测试临时目录的模拟 Hermes home。 */
async function service(version: string) {
  const f = serviceFixture(['hermes']); fixtures.push(f); simulated.home = f.root
  const home = join(f.root, 'simulated-hermes-home'), checkout = join(f.root, 'hermes-agent')
  vi.stubEnv('HERMES_HOME', home)
  mkdirSync(join(home, 'logs/update_receipts'), { recursive: true }); mkdirSync(join(checkout, '.git'), { recursive: true })
  const identity = { ...syntheticIdentity('hermes', version), source: 'self-update' as const, updateRoot: checkout }
  f.identities.set('hermes', identity)
  f.metadataFetch.mockImplementation(async () => new Response(JSON.stringify({ draft: false, prerelease: false, tag_name: 'v1.2.3' })))
  const write = (value: unknown, log = eperm(home)) => {
    writeFileSync(join(checkout, '.git/HEAD'), HEAD + '\n'); writeFileSync(join(home, 'logs/update_receipts/latest.json'), JSON.stringify(value)); writeFileSync(join(home, 'logs/update.log'), log)
  }
  const cleanup = vi.spyOn(residue, 'cleanHermesResidues').mockResolvedValue(undefined)
  ;(f.service as any).deps.hermesRetryDelayMs = 1
  const row = () => f.service.snapshot().entries.find(e => e.cli === 'hermes')!
  return { ...f, home, checkout, identity, write, cleanup, row }
}
const owedReceipt = (id = 'a'.repeat(32)) => receipt({ update_id: id, post_update: { sha: HEAD, version: '1.2.3', source: 'git' } })

it('模拟：更新后 Node 依赖改名被占用，等待后自动从中断处重试 1/1；仍未完成时结果为 incomplete、列出目录内进程、不做成功后清理', async () => {
  const f = await service('1.0.0'), runs: hermesUpdate.HermesUpdateOptions[] = []
  vi.spyOn(hermesUpdate, 'runHermesUpdate').mockImplementation(async o => {
    runs.push(o); f.identities.set('hermes', { ...f.identity, manifestVersion: '1.2.3' }); f.write(owedReceipt(String(runs.length).repeat(32)))
    return { receiptSucceeded: true }
  })
  const listed = vi.spyOn(residue, 'hermesDirectoryProcesses').mockResolvedValue([{ name: 'node.exe', pid: 4321 }])
  await checked(f.service)
  expect(f.row()).toMatchObject({ group: 'updatable', currentVersion: '1.0.0' }); expect(f.row().incomplete).toBeUndefined()
  f.service.start('hermes', 'update', f.row().planToken!, '', '模拟owed')
  const result = (await finished(f.service)).results[0]!
  expect(runs.map(o => !!o.resume)).toEqual([false, true])
  expect(runs.every(o => o.argv.slice(-2).join(' ') === 'update --yes')).toBe(true)
  expect(result).toMatchObject({ phase: 'incomplete', afterVersion: '1.2.3', resume: true, incomplete: { steps: ['build'], processes: [{ name: 'node.exe', pid: 4321 }] } })
  expect(result.error).toBeUndefined(); expect(CLI_OPERATION_TERMINAL).toContain('incomplete')
  expect(result.incomplete!.detail).toMatch(/^EPERM: operation not permitted, rename/); expect(result.incomplete!.detail).not.toContain(f.root)
  expect(result.outputTail).toContain('Node 依赖改名被占用，自动从中断处重试 1/1')
  expect(result.outputTail).toContain('Hermes 目录内仍在运行的进程：node.exe（PID 4321）')
  expect(result.outputTail).not.toMatch(/杀毒|安全软件|信任区/)
  expect(listed).toHaveBeenCalledOnce(); expect(f.cleanup).not.toHaveBeenCalled()
  // 行：版本已是最新，仍在「可更新」并带重试用的计划令牌；进程名单不进入行与缓存。
  expect(f.row()).toMatchObject({ group: 'updatable', currentVersion: '1.2.3', incomplete: { steps: ['build'] } })
  expect(f.row().incomplete).not.toHaveProperty('processes'); expect(f.row().planToken).toMatch(/^[a-f0-9]{64}$/)
})

it('模拟：自动重试后回执不再有未完成步骤，结果为成功并照常清理；查不到进程只写「未发现占用进程」', async () => {
  const f = await service('1.0.0'); let count = 0
  vi.spyOn(hermesUpdate, 'runHermesUpdate').mockImplementation(async () => {
    f.identities.set('hermes', { ...f.identity, manifestVersion: '1.2.3' }); f.write(++count === 1 ? owedReceipt() : { ...clean(), post_update: { sha: HEAD, version: '1.2.3', source: 'git' } })
    return { receiptSucceeded: true }
  })
  const listed = vi.spyOn(residue, 'hermesDirectoryProcesses').mockResolvedValue([])
  await checked(f.service); f.service.start('hermes', 'update', f.row().planToken!, '', '模拟cleared')
  const result = (await finished(f.service)).results[0]!
  expect(count).toBe(2); expect(result).toMatchObject({ phase: 'succeeded', afterVersion: '1.2.3' }); expect(result.incomplete).toBeUndefined()
  expect(listed).not.toHaveBeenCalled(); expect(f.cleanup).toHaveBeenCalledOnce()
  expect(f.row()).toMatchObject({ group: 'latest' }); expect(f.row().incomplete).toBeUndefined()

  const g = await service('1.0.0')
  vi.mocked(hermesUpdate.runHermesUpdate).mockImplementation(async () => { g.identities.set('hermes', { ...g.identity, manifestVersion: '1.2.3' }); g.write(owedReceipt()); return { receiptSucceeded: true } })
  await checked(g.service); g.service.start('hermes', 'update', g.row().planToken!, '', '模拟none')
  const none = (await finished(g.service)).results[0]!
  expect(none).toMatchObject({ phase: 'incomplete', incomplete: { processes: [] } }); expect(none.outputTail).toContain('未发现占用进程。')
})

it('模拟：未完成原因不是改名被占用时不自动重试、不枚举进程', async () => {
  const f = await service('1.0.0'), run = vi.spyOn(hermesUpdate, 'runHermesUpdate').mockImplementation(async () => {
    f.identities.set('hermes', { ...f.identity, manifestVersion: '1.2.3' }); f.write(owedReceipt(), '=== hermes update started x ===\n  ✗ Building the web UI failed\n')
    return { receiptSucceeded: true }
  })
  const listed = vi.spyOn(residue, 'hermesDirectoryProcesses')
  await checked(f.service); f.service.start('hermes', 'update', f.row().planToken!, '', '模拟other')
  const result = (await finished(f.service)).results[0]!
  expect(run).toHaveBeenCalledOnce(); expect(listed).not.toHaveBeenCalled()
  expect(result).toMatchObject({ phase: 'incomplete', incomplete: { steps: ['build'] } }); expect(result.incomplete).not.toHaveProperty('detail'); expect(result.resume).toBeUndefined()
})

it('模拟：「检查更新」从回执认出半完成（重启后仍在），版本已是最新也能启动重试；重试只跑官方命令并标记 resume，完成后回到已是最新', async () => {
  const f = await service('1.2.3'); f.write(owedReceipt())
  await checked(f.service)
  expect(f.row()).toMatchObject({ group: 'updatable', currentVersion: '1.2.3', latestCompatibleVersion: '1.2.3', incomplete: { steps: ['build'], detail: expect.stringMatching(/^EPERM/) } })
  // 写入缓存：新建的服务（等同 Desktop 重启）首屏即带未完成状态。
  const cached = new (f.service.constructor as any)({ ...(f.service as any).deps })
  try { expect(cached.snapshot().entries.find((e: any) => e.cli === 'hermes')).toMatchObject({ group: 'updatable', incomplete: { steps: ['build'] } }) } finally { await cached.close().catch(() => undefined) }
  const runs: hermesUpdate.HermesUpdateOptions[] = [], watches: unknown[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  vi.spyOn(hermesUpdate, 'runHermesUpdate').mockImplementation(async o => {
    runs.push(o); o.onWatch?.({ canTakeover: false, currentStage: 'fetch', controller: new AbortController(), requestTakeover: () => false } as any)
    o.progress({ channel: 'official', readable: false, resumeCount: 0, stage: '从中断处继续，不重新应用代码（模拟）' }); watches.push(f.service.snapshot().operation?.officialTakeover)
    await gate
    // 失败的重跑不能凭「版本已是目标」回读成成功。
    expect(await o.verifyInstalled!()).toBe(false)
    o.onWatch?.(undefined); f.write({ ...clean(), post_update: { sha: HEAD, version: '1.2.3', source: 'git' } })
    return { receiptSucceeded: true }
  })
  const id = f.service.start('hermes', 'update', f.row().planToken!, '', '模拟resume').operation!.id
  await vi.waitFor(() => expect(runs).toHaveLength(1))
  expect(f.service.snapshot().operation).toMatchObject({ resume: true, beforeVersion: '1.2.3', targetVersion: '1.2.3' })
  expect(await f.service.requestTakeover('hermes', id)).toMatchObject({ status: 'not-official' })
  release()
  const result = (await finished(f.service)).results[0]!
  expect(runs.map(o => [o.resume, o.argv.slice(-2).join(' ')])).toEqual([[true, 'update --yes']]); expect(watches).toEqual([undefined])
  expect(result).toMatchObject({ phase: 'succeeded', resume: true, afterVersion: '1.2.3' })
  expect(result.outputTail).toContain('从中断处继续，只补做未完成的后续步骤，不重新应用代码')
  expect(result.progress?.channel).not.toBe('takeover'); expect(f.cleanup).toHaveBeenCalledOnce()
  expect(f.row()).toMatchObject({ group: 'latest', currentVersion: '1.2.3' }); expect(f.row().incomplete).toBeUndefined()
})

it('模拟：版本已是最新且回执没有未完成步骤时，仍拒绝启动更新', async () => {
  const f = await service('1.2.3'); f.write({ ...clean(), post_update: { sha: HEAD, version: '1.2.3', source: 'git' } })
  const run = vi.spyOn(hermesUpdate, 'runHermesUpdate')
  await checked(f.service); expect(f.row()).toMatchObject({ group: 'latest' }); expect(f.row().incomplete).toBeUndefined()
  f.service.start('hermes', 'update', f.row().planToken!, '', '模拟latest')
  expect((await finished(f.service)).results[0]).toMatchObject({ phase: 'failed', error: { code: 'PLAN_EXPIRED' } }); expect(run).not.toHaveBeenCalled()
})

it('模拟：重试后回执没有换新时如实说明无法确认，保持未完成', async () => {
  const f = await service('1.2.3'); f.write(owedReceipt(), '=== hermes update started x ===\n  ✗ Building the web UI failed\n')
  vi.spyOn(hermesUpdate, 'runHermesUpdate').mockResolvedValue({ receiptSucceeded: false })
  await checked(f.service); f.service.start('hermes', 'update', f.row().planToken!, '', '模拟stale')
  const result = (await finished(f.service)).results[0]!
  expect(result).toMatchObject({ phase: 'incomplete' }); expect(result.outputTail).toContain('Hermes 没有写出新的回执，无法确认后续步骤已完成。')
})
