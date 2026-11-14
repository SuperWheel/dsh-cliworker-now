/** 模拟：本地日志/回执/暂存，Hermes 与 Pi 进程均由夹具提供。 */
import { it, expect, afterEach, vi } from 'vitest'
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { HermesWatch, runHermesUpdate } from '../src/host/cli-management/hermes-watch.ts'
import { observedPackages } from '../src/host/cli-management/artifacts/observations.ts'
import { OfficialWatch } from '../src/host/cli-management/official-watch.ts'
import { cliDownloadProgressSchema } from '../src/shared/cli-management.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
import { control } from './cli-management-phase-b-fixture.ts'
const roots: string[] = []
afterEach(async () => { for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }) })
async function fixture() { const root = await realpath(await mkdtemp(join(tmpdir(), 'observation-simulated-'))); roots.push(root); return root }
it('模拟：officialFailedAt 向后兼容，拒绝非近期失败原因、负值和非有限数', () => {
  const old = { readable: false, resumeCount: 0 }; expect(cliDownloadProgressSchema.parse(old)).toEqual(old)
  expect(cliDownloadProgressSchema.parse({ ...old, reason: 'OFFICIAL_RECENT_FAILURE', officialFailedAt: 123 })).toHaveProperty('officialFailedAt', 123)
  for (const officialFailedAt of [-1, Infinity, NaN]) expect(cliDownloadProgressSchema.safeParse({ ...old, reason: 'OFFICIAL_RECENT_FAILURE', officialFailedAt }).success).toBe(false)
  for (const reason of [undefined, 'OFFICIAL_EXIT', 'ALREADY_LATEST']) expect(cliDownloadProgressSchema.safeParse({ ...old, reason, officialFailedAt: 0 }).success).toBe(false)
})
it('模拟：Hermes 回执推进真实六阶段，日志行与 fetch 字节不产生百分比', async () => {
  const root = await fixture(), checkout = join(root, 'hermes-agent'), progress = vi.fn(), now = Date.now() - 1000
  await mkdir(join(root, 'logs/update_receipts'), { recursive: true }); await mkdir(join(checkout, '.git/objects/pack'), { recursive: true })
  const watch = new HermesWatch(root, checkout, join(root, 'status.json'), now, progress); await watch.snapshot()
  await writeFile(join(root, 'logs/update.log'), 'old\n→ Fetching\n')
  await writeFile(join(root, 'logs/update_receipts/update_simulated.json'), JSON.stringify({ outcome: 'running', stages: [{ name: 'plan' }, { name: 'snapshot' }, { name: 'apply' }] }))
  await writeFile(join(checkout, '.git/objects/pack/tmp_pack_simulated'), 'pack')
  await watch.poll(now + 2000)
  expect(cliDownloadProgressSchema.parse(progress.mock.calls.at(-1)![0])).toMatchObject({ currentStep: 3, totalSteps: 6, stepName: 'apply', downloadedBytes: 4, byteProgressState: 'unknown-total', stage: '→ Fetching' })
  expect(progress.mock.calls.at(-1)![0].totalBytes).toBeUndefined()
  await writeFile(join(root, 'logs/update_receipts/update_simulated.json'), JSON.stringify({ outcome: 'failed', stages: [{ name: 'build' }], stop_class: 'fetch_failed', exit_code: 1 }))
  await watch.poll(now + 3000); expect(watch.stopClass).toBe('fetch_failed'); expect(progress.mock.calls.at(-1)![0]).toMatchObject({ currentStep: 5 })
})
it('模拟：Hermes 旧日志不算活动，每次新日志续期，5 分钟无活动中止', async () => {
  const root = await fixture(), now = Date.now(), progress = vi.fn(); await mkdir(join(root, 'logs'), { recursive: true })
  const log = join(root, 'logs/update.log'); await writeFile(log, '→ old'); await utimes(log, new Date(now - 10000), new Date(now - 10000))
  const watch = new HermesWatch(root, join(root, 'hermes-agent'), join(root, 'status.json'), now, progress)
  await watch.poll(now + 240000); expect(watch.controller.signal.aborted).toBe(false)
  await writeFile(log, '→ active'); await utimes(log, new Date(now + 240000), new Date(now + 240000))
  await watch.poll(now + 240001); await watch.poll(now + 500000); expect(watch.controller.signal.aborted).toBe(false)
  await watch.poll(now + 540002); expect(watch.controller.signal.aborted).toBe(true)
})
it.each([1, 2])('模拟：Hermes 退出码 %s 的重跑次数及不清理检出目录', async exitCode => {
  const root = await fixture(), checkout = join(root, 'hermes-agent'); await mkdir(checkout); await writeFile(join(checkout, 'keep'), 'keep')
  const spawn = vi.fn(() => ({ stdout: Readable.from([]), stderr: Readable.from([]), done: Promise.resolve({ exitCode, signal: null }), waitForExit: async () => true, terminate() {} }))
  await expect(runHermesUpdate({ root, home: root, checkout, argv: ['simulated-hermes', 'update', '--yes'], backend: { spawn } as any, config: DEFAULT_CONFIG, signal: control(), output: vi.fn(), progress: vi.fn() })).rejects.toMatchObject({ code: 'EXIT_CODE' })
  expect(spawn).toHaveBeenCalledTimes(exitCode === 2 ? 1 : 2); expect(await readFile(join(checkout, 'keep'), 'utf8')).toBe('keep')
  expect(spawn.mock.calls[0]![0]).toMatchObject({ env: { HERMES_UPDATE_STATUS_FILE: expect.stringContaining('status-0.json') } })
})
it('模拟：Pi 只数本次新暂存内的真实包，不把解压字节伪装成下载', async () => {
  const root = await fixture(), staging = join(root, 'staging'); await mkdir(join(staging, 'update-old/node_modules/old'), { recursive: true }); await writeFile(join(staging, 'update-old/node_modules/old/package.json'), '{}')
  const progress = vi.fn(), watch = await OfficialWatch.prepare({ kind: 'stage', packageDirectory: staging, packageCount: 122 }, root, progress); watch.start(Date.now() - 1000)
  try {
    await mkdir(join(staging, 'update-new/node_modules/@scope/pkg'), { recursive: true }); await writeFile(join(staging, 'update-new/node_modules/@scope/pkg/package.json'), '{}')
    // npm 可以保留归档成员的历史 mtime；本次新 staging 的包仍应计数。
    await utimes(join(staging, 'update-new/node_modules/@scope/pkg/package.json'), new Date(0), new Date(0))
    await watch.poll(); expect(progress.mock.calls.at(-1)![0]).toMatchObject({ readable: false, currentStep: 1, totalSteps: 122, stepName: '第 1/122 个包' }); expect(progress.mock.calls.at(-1)![0].downloadedBytes).toBeUndefined()
  } finally { await watch.stop() }
})
it('模拟：Qoder 活 PID 还须命令行属于 qodercli/qoderclicn，无法检查不当作失效', async () => {
  const { officialLockState } = await import('../src/host/cli-management/official-watch.ts')
  const root = await fixture(), lock = join(root, 'update.lock'); await writeFile(lock, JSON.stringify({ pid: process.pid }))
  expect(await officialLockState(lock, /qodercli|qoderclicn/, async () => 'qoderclicn update')).toBe('active')
  expect(await officialLockState(lock, /qodercli|qoderclicn/, async () => 'unrelated-process')).toBe('stale')
  expect(await officialLockState(lock, /qodercli|qoderclicn/, async () => { throw new Error('inspection denied') })).toBe('unknown')
})
