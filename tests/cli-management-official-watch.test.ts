/** 模拟：虚拟时钟策略与临时目录探针；不调用更新器。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, mkdir, writeFile, appendFile, utimes, lstat, rm, symlink, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { OfficialWatch, OfficialWatchdog, officialBudgetMs, officialLockState } from '../src/host/cli-management/official-watch.ts'
import { officialProbe } from '../src/host/cli-management/artifacts/probes.ts'
import { ChannelMemory, CHANNEL_MEMORY_TTL, channelMemoryKey } from '../src/host/cli-management/channel-memory.ts'
import { syntheticIdentity } from './cli-management-phase-b-fixture.ts'
const roots: string[] = [], watches: OfficialWatch[] = []
afterEach(async () => { for (const watch of watches.splice(0)) await watch.stop(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); vi.restoreAllMocks() })
async function fixture() { const root = await realpath(await mkdtemp(join(tmpdir(), 'cli-official-simulated-'))); roots.push(root); return root }
const started = 2_000_000_000_000
async function fresh(path: string, value = 'abc') { await writeFile(path, value); await utimes(path, new Date(started + 1000), new Date(started + 1000)) }
it('模拟：30 秒无增长、大小回落、60 秒低速、30 秒后硬截止预测', () => {
  const stalled = new OfficialWatchdog(0, 50_000_000)
  expect(stalled.check(0, 1)).toBeUndefined(); expect(stalled.check(29_999, 1)).toBeUndefined(); expect(stalled.check(30_000, 1)).toBe('OFFICIAL_STALLED')
  const rewind = new OfficialWatchdog(0); rewind.check(0, 100); expect(rewind.check(1000, 1)).toBe('OFFICIAL_RESTARTED')
  const slow = new OfficialWatchdog(0)
  for (const time of [0, 15_000, 30_000, 45_000]) expect(slow.check(time, time * 10)).toBeUndefined()
  expect(slow.check(60_000, 600_000)).toBe('OFFICIAL_SLOW')
  const deadline = new OfficialWatchdog(0, 100_000_000, 300_000)
  deadline.check(0, 0); expect(deadline.check(29_999, 2_999_900)).toBeUndefined(); expect(deadline.check(30_000, 3_000_000)).toBe('OFFICIAL_DEADLINE')
  const complete = new OfficialWatchdog(0, 100)
  complete.check(0, 100); expect(complete.check(40_000, 100)).toBeUndefined()
})
it('模拟：无暂存不以 20 秒静默判失败，总预算按长度夹到 3–10 分钟', () => {
  expect(officialBudgetMs(1)).toBe(180_000); expect(officialBudgetMs(80_000_000)).toBe(400_000); expect(officialBudgetMs(200_000_000)).toBe(600_000); expect(officialBudgetMs()).toBe(600_000)
  const watch = new OfficialWatchdog(0, 1)
  expect(watch.check(20_000)).toBeUndefined(); expect(watch.check(179_999)).toBeUndefined(); expect(watch.check(180_000)).toBe('OFFICIAL_BUDGET')
})
it('模拟：启动前快照、名称、mtime 缺一不可；不显示或清理旧文件和符号链接', async () => {
  const root = await fixture(), progress = vi.fn(), directory = join(root, 'staging'); await mkdir(directory)
  await fresh(join(directory, 'old.new'))
  const watch = await OfficialWatch.prepare({ kind: 'files', directory, fileRule: /^[^/]+\.new$/, totalBytes: 100 }, root, progress); watches.push(watch); watch.start(started)
  await appendFile(join(directory, 'old.new'), 'changed')
  await fresh(join(directory, 'this.new'), '12345'); await fresh(join(directory, 'not-ours.txt'))
  await writeFile(join(directory, 'stale.new'), '123'); await utimes(join(directory, 'stale.new'), new Date(0), new Date(0))
  await symlink(join(directory, 'not-ours.txt'), join(directory, 'link.new'))
  await watch.poll(started + 1000)
  expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ channel: 'official', byteProgress: true, downloadedBytes: 5, totalBytes: 100, fileCount: 1 }))
  await watch.cleanup()
  await expect(lstat(join(directory, 'this.new'))).rejects.toThrow()
  for (const path of ['old.new', 'not-ours.txt', 'stale.new', 'link.new']) expect(await lstat(join(directory, path))).toBeTruthy()
})
it('模拟：本次暂存已接收字节但无总量时显式报告未知总量，不伪造百分比', async () => {
  const root = await fixture(), progress = vi.fn()
  await fresh(join(root, 'old.new'), 'old')
  const watch = await OfficialWatch.prepare({ kind: 'files', directory: root, fileRule: /^[^/]+\.new$/ }, root, progress); watches.push(watch); watch.start(started)
  await watch.poll(started + 1000)
  expect(progress.mock.calls.at(-1)![0]).toMatchObject({ byteProgressState: 'none', readable: false })
  await fresh(join(root, 'this.new'), '12345'); await watch.poll(started + 2000)
  expect(progress.mock.calls.at(-1)![0]).toMatchObject({ byteProgressState: 'unknown-total', readable: true, byteProgress: true, downloadedBytes: 5 })
  expect(progress.mock.calls.at(-1)![0].totalBytes).toBeUndefined()
  await fresh(join(root, 'this.new'), '123456789'); await watch.poll(started + 3000)
  expect(progress.mock.calls.at(-1)![0]).toMatchObject({ byteProgressState: 'unknown-total', downloadedBytes: 9 })
})
it('模拟：Claude 新 staging 目录清理，保留原目录和无法确认的文件', async () => {
  const root = await fixture(), directory = join(root, '.cache/claude/staging'); await mkdir(directory, { recursive: true })
  const old = join(directory, '1.2.3.old'); await mkdir(old); await fresh(join(old, 'claude.exe'))
  const foreign = join(directory, '1.2.3.preexisting'); await mkdir(foreign)
  const probe = officialProbe({ cli: 'claude', version: '1.2.3', platform: 'win32', home: root }, 100)
  const watch = await OfficialWatch.prepare(probe, root, vi.fn()); watches.push(watch); watch.start(started)
  await fresh(join(foreign, 'claude.exe'), 'foreign') // 模拟其他运行在旧目录中新建文件。
  const newDir = join(directory, '1.2.3.pid.time'); await mkdir(newDir); await utimes(newDir, new Date(started + 1000), new Date(started + 1000)); await fresh(join(newDir, 'claude.exe')); await utimes(newDir, new Date(started + 1000), new Date(started + 1000))
  await watch.poll(started + 1000); await watch.cleanup()
  await expect(lstat(newDir)).rejects.toThrow(); expect(await readFile(join(old, 'claude.exe'), 'utf8')).toBe('abc'); expect(await readFile(join(foreign, 'claude.exe'), 'utf8')).toBe('foreign')
})
it('模拟：MiMo 私有 TMPDIR 与观察到的文件名 HEAD 总量，不猜 baseline', async () => {
  const root = await fixture(), progress = vi.fn(), totalForFile = vi.fn(async () => 42)
  const watch = await OfficialWatch.prepare({ ...officialProbe({ cli: 'mimo', platform: 'darwin', version: '1.2.3' }), totalForFile }, root, progress); watches.push(watch); watch.start(started)
  expect(watch.env.TMPDIR).toContain(root)
  expect((await lstat(watch.env.TMPDIR!)).mode & 0o777).toBe(0o700)
  const directory = join(watch.env.TMPDIR!, 'mimocode_install_123'); await mkdir(directory); await utimes(directory, new Date(started + 1000), new Date(started + 1000))
  await fresh(join(directory, 'mimocode-darwin-x64.zip'), 'abc'); await utimes(directory, new Date(started + 1000), new Date(started + 1000))
  await watch.poll(started + 1000)
  expect(totalForFile).toHaveBeenCalledWith('mimocode_install_123/mimocode-darwin-x64.zip', expect.any(AbortSignal))
  expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ downloadedBytes: 3, totalBytes: 42 }))
  await watch.cleanup(); await expect(lstat(watch.env.TMPDIR!)).rejects.toThrow()
})
it('模拟：私有 TEMP 中 CLI 自带的非下载文件（Qoder natives、Bun DLL）在进程退出后整体删除', async () => {
  const root = await fixture()
  const watch = await OfficialWatch.prepare(officialProbe({ cli: 'mimo', platform: 'darwin', version: '1.2.3' }), root, vi.fn()); watches.push(watch); watch.start(started)
  const natives = join(watch.env.TMPDIR!, 'qodercli-natives-v1.1.73-admin', 'node_modules'); await mkdir(natives, { recursive: true })
  await writeFile(join(natives, 'sharp.node'), 'simulated'); await writeFile(join(watch.env.TMPDIR!, '.b8ff-00000000.dll'), 'simulated')
  await watch.cleanup(); await expect(lstat(watch.env.TMPDIR!)).rejects.toThrow()
})
it('模拟：无法确定属于本次运行时只有阶段；日志、分块中断及 OMP 差分输出', async () => {
  const root = await fixture(), progress = vi.fn(), path = join(root, 'status.log'); await writeFile(path, 'previous')
  const watch = await OfficialWatch.prepare({ kind: 'stage', stageFiles: [path] }, root, progress); watches.push(watch); watch.start(started)
  await fresh(path, 'Extracting files...\n'); await watch.poll(started + 1000)
  expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ readable: false, byteProgress: false, stage: 'Extracting files...' }))
  expect(progress.mock.calls.at(-1)![0]).not.toHaveProperty('downloadedBytes')
  watch.push('curl: ('); watch.push('28) timed out\n'); expect(watch.reason).toBe('OFFICIAL_INTERRUPTED')
  for (const text of ['retrying from GitHub Releases', 'Download stalled', 'timeout: 300000ms']) {
    const another = new OfficialWatch({ kind: 'none' }, vi.fn()); another.push(text); expect(another.reason).toBe('OFFICIAL_INTERRUPTED')
  }
  const directory = join(root, 'omp'); await mkdir(directory)
  const omp = await OfficialWatch.prepare({ kind: 'files', directory, fileRule: /^omp.*\.new$/, phaseOnlyPattern: /delta|patch/i, totalBytes: 500 }, root, progress); watches.push(omp); omp.start(started)
  await fresh(join(directory, 'omp.exe.1.new')); omp.push('Downloading delta patch\n'); await omp.poll(started + 1000)
  expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ byteProgress: false, stage: 'Downloading delta patch' }))
})
it('模拟：符号链接暂存根不显示字节、不清理指向目录', async () => {
  const root = await fixture(), directory = join(root, 'real'); await mkdir(directory); await symlink(directory, join(root, 'staging'))
  const progress = vi.fn(), watch = await OfficialWatch.prepare({ kind: 'files', directory: join(root, 'staging'), fileRule: /\.new$/ }, root, progress); watches.push(watch); watch.start(started)
  await fresh(join(directory, 'ours.new')); await watch.poll(started + 1000); await watch.cleanup()
  expect(progress.mock.calls.at(-1)![0].byteProgress).toBe(false); expect(await readFile(join(directory, 'ours.new'), 'utf8')).toBe('abc')
})
it('模拟：失败记忆 7 天与平台/架构/布局隔离，0600 原子持久化及清除', async () => {
  const root = await fixture(), id = syntheticIdentity('omp'), key = channelMemoryKey('omp', id), memory = new ChannelMemory(root)
  await memory.set(key, 'OFFICIAL_STALLED', 1000)
  expect((await lstat(memory.file)).mode & 0o777).toBe(0o600); expect((await lstat(join(root, 'cli-management'))).mode & 0o777).toBe(0o700)
  const reloaded = new ChannelMemory(root)
  expect(await reloaded.get(key, 1000 + CHANNEL_MEMORY_TTL - 1)).toMatchObject({ reason: 'OFFICIAL_STALLED' })
  expect(await reloaded.get(key, 1000 + CHANNEL_MEMORY_TTL)).toBeUndefined(); expect(await reloaded.get(key, 999)).toBeUndefined()
  for (const other of [channelMemoryKey('omp', { ...id, updateRoot: '/other' }), channelMemoryKey('omp', id, 'win32'), channelMemoryKey('omp', id, 'darwin', 'ia32')]) expect(other).not.toBe(key)
  await memory.set(key, undefined, 1001); expect(await reloaded.get(key, 1002)).toBeUndefined()
  expect(await readFile(memory.file, 'utf8')).not.toContain(id.executable)
})
it('模拟：损坏/符号链接记忆忽略，有效锁和失效 PID 分开处理', async () => {
  const root = await fixture(), memory = new ChannelMemory(root), key = channelMemoryKey('omp', syntheticIdentity('omp'))
  await mkdir(join(root, 'cli-management')); const original = join(root, 'outside'); await writeFile(original, '{}'); await symlink(original, memory.file)
  expect(await memory.get(key)).toBeUndefined(); await memory.set(key, 'OFFICIAL_EXIT'); expect(await readFile(original, 'utf8')).toBe('{}')
  expect((await lstat(memory.file)).isSymbolicLink()).toBe(false)
  const lock = join(root, 'update.lock'); await writeFile(lock, JSON.stringify({ pid: 123456 }))
  vi.spyOn(process, 'kill').mockImplementation(() => true)
  expect(await officialLockState(lock)).toBe('active')
  vi.mocked(process.kill).mockImplementation(() => { throw Object.assign(new Error('模拟 stale'), { code: 'ESRCH' }) })
  expect(await officialLockState(lock)).toBe('stale')
  await writeFile(lock, '{}'); expect(await officialLockState(lock)).toBe('unknown')
})

it('模拟：未完成暂存消失或换名从零重试触发接管，不累计旧的已删除字节', async () => {
  const root = await fixture(), progress = vi.fn(), watch = await OfficialWatch.prepare({ kind: 'files', directory: root, fileRule: /\.new$/, totalBytes: 100 }, root, progress); watches.push(watch); watch.start(started)
  const path = join(root, 'one.new'); await fresh(path, '12345'); await watch.poll(started + 1000)
  await rm(path); await fresh(join(root, 'two.new'), '1'); await watch.poll(started + 2000)
  expect(watch.reason).toBe('OFFICIAL_RESTARTED'); expect(progress.mock.calls.at(-1)![0].downloadedBytes).toBe(1)
})
