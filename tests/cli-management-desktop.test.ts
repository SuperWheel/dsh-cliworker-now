/** 模拟：DMG、codesign、spctl、ditto、Windows 安装器均为 argv 替身；不执行系统程序。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installDesktop, desktopFs } from '../src/host/cli-management/desktop.ts'
import { checkInstallDirectory } from '../src/host/cli-management/directory.ts'
import { executeCliOperation } from '../src/host/cli-management/executor.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
import { childFixture, until, control } from './cli-management-phase-b-fixture.ts'
const roots: string[] = []
const root = () => { const r = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-模拟-'))); roots.push(r); return r }
afterEach(() => { vi.restoreAllMocks(); for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })
const source = { url: 'https://official.invalid/模拟.dmg', bytes: 4, appName: '模拟.app', relativeEntry: 'Contents/bin/cli', teamId: 'ABCDE12345', version: '1.0.0' }
it('模拟审查 5：复制进程清理未确认时，后续删除失败仅追加原因', async () => {
  const directory = root(), isolation = new ProcessCleanupUnconfirmedError({ cause: new Error('模拟复制进程仍在运行') })
  const removeError = new Error('模拟 stage 删除失败')
  vi.spyOn(desktopFs, 'rm').mockRejectedValue(removeError)
  const run = vi.fn(async (argv: string[]) => {
    if (argv[1] === 'attach') mkdirSync(join(argv[argv.indexOf('-mountpoint') + 1]!, source.appName))
    if (argv[0] === '/usr/bin/ditto') throw isolation
  })
  await expect(installDesktop({ source, root: directory, directory: join(directory, 'target'), file: '/模拟/image.dmg', platform: 'darwin', signal: control(), run, awaiting: vi.fn() })).rejects.toBe(isolation)
  expect(isolation.cause).toBeInstanceOf(AggregateError)
  expect((isolation.cause as AggregateError).errors).toContain(removeError)
})
it.each(['attach', 'ditto', 'codesign', 'success'] as const)('模拟：macOS %s 后始终卸载，签名先于复制', async failure => {
  const directory = root(), run = vi.fn(async (argv: string[]) => {
    if (argv[1] === 'attach') { if (failure === 'attach') throw new Error('模拟 attach'); mkdirSync(join(argv[argv.indexOf('-mountpoint') + 1]!, source.appName)) }
    if (failure === 'ditto' && argv[0] === '/usr/bin/ditto' || failure === 'codesign' && argv[0] === '/usr/bin/codesign') throw new Error('模拟 failure')
    if (argv[0] === '/usr/bin/ditto') mkdirSync(argv[2]!)
  })
  const pending = installDesktop({ source, root: directory, file: '/模拟/image.dmg', directory: join(directory, 'target'), platform: 'darwin', signal: control(), run, awaiting: vi.fn() })
  if (failure === 'success') await expect(pending).resolves.toBe(join(directory, 'target', source.appName))
  else await expect(pending).rejects.toThrow('模拟')
  expect(run.mock.calls.at(-1)![0].slice(0, 2)).toEqual(['/usr/bin/hdiutil', 'detach'])
  expect(readdirSync(join(directory, 'cli-management/mounts'))).toEqual([])
  if (failure === 'ditto') expect(readdirSync(join(directory, 'target'))).toEqual([])
  if (failure === 'success') {
    expect(run.mock.calls.map(([a]) => a[0])).toEqual(['/usr/bin/hdiutil', '/usr/bin/codesign', '/usr/sbin/spctl', '/usr/bin/ditto', '/usr/bin/hdiutil'])
    expect(run.mock.calls[1]![0]).toContain('-R=anchor apple generic and certificate leaf[subject.OU] = "ABCDE12345"')
  }
})
it.each([false, true])('模拟：Windows 安装器等待退出及取消=%s，不传静默或位置参数', async cancel => {
  const directory = root(), child = childFixture(), controller = new AbortController(), awaiting = vi.fn()
  const backend = { resolveExecutable: vi.fn(), spawn: vi.fn(() => child.child as any) }
  let done = false
  const pending = installDesktop({ source, root: directory, file: '/模拟/setup.exe', directory: '/模拟/suggested', platform: 'win32', signal: controller.signal, awaiting, run: (argv, signal) => executeCliOperation(backend, DEFAULT_CONFIG, argv, signal, () => {}) }).then(() => { done = true }, error => error)
  await until(() => backend.spawn.mock.calls.length > 0)
  expect(awaiting).toHaveBeenCalledOnce(); expect(backend.spawn.mock.calls[0]![0].argv).toEqual(['/模拟/setup.exe']); expect(done).toBe(false)
  if (cancel) controller.abort(); else child.finish()
  await until(() => child.child.waitForExit.mock.calls.length > 0); expect(done).toBe(false)
  if (cancel) child.finish(); child.exit(true); await pending
  expect(done).toBe(!cancel)
})
it.each(['project', 'workspace', 'account', 'otherWorkBuddy'] as const)('模拟：禁止使用 %s 目录及其别名/子目录', async kind => {
  const directory = root(), protectedPath = join(directory, kind); mkdirSync(protectedPath)
  const policy = kind === 'otherWorkBuddy' ? { otherWorkBuddyDirectory: protectedPath } : { protectedPaths: [protectedPath] }
  expect((await checkInstallDirectory('workbuddy', protectedPath, control(), undefined, policy)).problem).toBe('INVALID')
  expect((await checkInstallDirectory('workbuddy', join(protectedPath, 'new'), control(), undefined, policy)).problem).toBe('INVALID')
})
it('模拟：不存在的目标目录在父目录可写时可用', async () => {
  const directory = root()
  expect((await checkInstallDirectory('zcode', join(directory, 'new'), control())).problem).toBeUndefined()
})
it.each(['success', 'signature', 'extract', 'occupied'] as const)('模拟：官方 zip 首次安装 %s；不挂载，签名失败不复制，清理私有目录', async mode => {
  const directory = root(), target = join(directory, 'target'), zip = { ...source, archive: 'zip' as const }
  if (mode === 'occupied') mkdirSync(join(target, source.appName), { recursive: true })
  const run = vi.fn(async (argv: string[]) => {
    if (argv[1] === '-x') {
      mkdirSync(join(argv[4]!, source.appName))
      if (mode === 'extract') throw new Error('模拟解包失败')
    } else if (argv[0] === '/usr/bin/codesign' && mode === 'signature') throw new Error('模拟签名失败')
    else if (argv[0] === '/usr/bin/ditto') mkdirSync(argv[2]!)
  })
  const task = installDesktop({ source: zip, root: directory, directory: target, file: '/模拟/package.zip', platform: 'darwin', signal: control(), run, awaiting: vi.fn() })
  if (mode === 'success') await expect(task).resolves.toBe(join(target, source.appName))
  else await expect(task).rejects.toThrow()
  expect(run.mock.calls.some(([argv]) => argv[0] === '/usr/bin/hdiutil')).toBe(false)
  expect(readdirSync(join(directory, 'cli-management/mounts'))).toEqual([])
  if (mode === 'signature' || mode === 'extract') expect(run.mock.calls.filter(([argv]) => argv[0] === '/usr/bin/ditto')).toHaveLength(1)
  if (mode === 'success' || mode === 'occupied') expect(readdirSync(target)).toEqual([source.appName])
})
it('模拟：ZIP 解包进程退出未确认时保留隔离目录，不删仍可能使用的工件', async () => {
  const directory = root(), isolation = new ProcessCleanupUnconfirmedError()
  await expect(installDesktop({ source: { ...source, archive: 'zip' }, root: directory, directory: join(directory, 'target'), file: '/模拟/package.zip', platform: 'darwin', signal: control(), awaiting: vi.fn(), run: async argv => {
    if (argv[1] === '-x') { mkdirSync(join(argv[4]!, source.appName)); throw isolation }
  } })).rejects.toBe(isolation)
  expect(readdirSync(join(directory, 'cli-management/mounts'))).toHaveLength(1)
})
