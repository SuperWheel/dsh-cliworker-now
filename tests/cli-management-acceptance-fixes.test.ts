/** 模拟：所有安装、路径记录、发布源与进程均为夹具；不读取真实 HOME，不执行真实 CLI。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync, symlinkSync, rmSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { Readable } from 'node:stream'
import type { ActiveCliId } from '../src/shared/types.ts'
import { resolveCliExecutable } from '../src/host/adapters.ts'
import { CliExecutablePathStore } from '../src/host/cli-executable-paths.ts'
import { isVersionedAutoEntry } from '../src/host/cli-auto-entry.ts'
import { CliManagementCache } from '../src/host/cli-management/cache.ts'
import { identifyInstallation, managedZCodeApplication, ZCODE_RUNTIME_NOTICE } from '../src/host/cli-management/identity.ts'
import { currentVersion, ReleaseClient } from '../src/host/cli-management/versions.ts'
import { CLI_SOURCES, installationSource } from '../src/host/cli-management/sources.ts'
import { readDesktopRelease, runDesktopUpdate } from '../src/host/cli-management/desktop-update.ts'
import { serviceFixture, checked, finished, control } from './cli-management-phase-b-fixture.ts'

const environment = vi.hoisted(() => ({ home: '', app: '' }))
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => environment.home }))
vi.mock('../src/host/cli-management/sources.ts', async original => ({ ...await original<typeof import('../src/host/cli-management/sources.ts')>(), get ZCODE_DEFAULT_APP() { return environment.app } }))
vi.mock('../src/host/cli-management/desktop-update.ts', () => ({ readDesktopRelease: vi.fn(), runDesktopUpdate: vi.fn(), DesktopUnavailableError: class extends Error {} }))
const fixtures: ReturnType<typeof serviceFixture>[] = []
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); vi.restoreAllMocks(); vi.mocked(readDesktopRelease).mockReset(); vi.mocked(runDesktopUpdate).mockReset() })
const exited = (text = '') => ({ stdout: Readable.from([text]), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), waitForExit: vi.fn(async () => true), terminate: vi.fn() })
function fixture(cli: ActiveCliId = 'pi') {
  const f = serviceFixture([cli]); fixtures.push(f)
  environment.home = f.root; environment.app = join(f.root, 'Applications/ZCode.app')
  const file = (path: string, text = '// 模拟') => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text, { mode: 0o700 }); return path }
  const store = new CliExecutablePathStore(join(f.root, 'paths'))
  f.config.cliExecutablePaths = store
  const entry = join(f.root, '.local/bin', cli === 'traecn' ? 'traecli' : cli)
  vi.mocked(f.backend.resolveExecutable).mockImplementation(async name => {
    const path = isAbsolute(name) ? name : entry
    if (!statSync(path).isFile()) throw new Error('模拟入口不存在')
    return path
  })
  vi.mocked(f.backend.spawn).mockImplementation(() => { throw new Error('模拟禁止启动真实进程') })
  return { ...f, file, store, entry }
}
function pi(f: ReturnType<typeof fixture>, version: string) {
  const root = join(f.root, '.pi/agent'), pkg = join(root, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent')
  f.file(join(pkg, 'package.json'), JSON.stringify({ name: CLI_SOURCES.pi.npm, version, bin: { pi: 'dist/cli.js' } }))
  for (const path of ['cli.js', 'index.js', 'core/model-runtime.js', 'core/auth-storage.js']) f.file(join(pkg, 'dist', path))
  f.file(join(root, 'install/managed-install.json'), JSON.stringify({ kind: 'pi-managed-install', schemaVersion: 1, layout: 'releases-v1' }))
  const pointer = f.file(join(root, 'install/current-version'), version)
  const launcher = f.file(join(root, 'bin/pi'), '#!/bin/sh\n# 模拟 PI_MANAGED_INSTALL_ROOT= install/current-version\n')
  mkdirSync(dirname(f.entry), { recursive: true })
  try { symlinkSync(launcher, f.entry) } catch (e: any) { if (e.code !== 'EEXIST') throw e }
  return { pointer, target: join(pkg, 'dist/cli.js') }
}
const layouts: [ActiveCliId, string][] = [
  ['codex', '.codex/packages/standalone/releases/0.162.1-darwin-arm64/codex'],
  ['claude', '.local/share/claude/versions/2.1.287'],
  ['grok', '.grok/downloads/grok-1.0.62-darwin-arm64'],
  ['traecn', '.local/share/traecli/releases/0.214.0-macos-aarch64/traecli'],
  ['qoder', '.qoder/bin/qodercli/qodercli-1.1.87'],
  ['qodercn', '.qoder-cn/bin/qoderclicn/qoderclicn-1.1.87'],
  ['codex', 'opt/homebrew/Caskroom/codex/0.162.1/codex'],
  ['claude', 'opt/homebrew/Caskroom/claude-code/2.1.287/claude'],
  ['opencode', 'opt/homebrew/Cellar/opencode/1.19.0/bin/opencode'],
  ['codebuddy', 'opt/homebrew/Cellar/codebuddy-code/2.181.0/bin/codebuddy'],
]
it.each(layouts)('模拟：%s 的旧 auto 版本实体 %s 迁移为入口且持久化权限不变', async (cli, relative) => {
  const f = fixture(cli), old = f.file(join(f.root, relative))
  f.file(f.entry); f.store.remember(cli, old, 0)
  if (cli === 'grok') { const native = join(f.root, '.grok/bin/grok'); f.file(native); vi.mocked(f.backend.resolveExecutable).mockResolvedValue(native) }
  if (cli === 'traecn') vi.mocked(f.backend.spawn).mockImplementation(() => exited('traecli 0.215.0\ninstallation: 模拟'))
  const result = await resolveCliExecutable(cli, f.backend, f.config, control())
  expect(result).not.toBe(old)
  expect(f.store.read(cli)).toEqual({ mode: 'auto', path: result })
  expect(new CliExecutablePathStore(join(f.root, 'paths')).read(cli)?.path).toBe(result)
  expect(statSync(join(f.root, 'paths/cli-executable-paths')).mode & 0o777).toBe(0o700)
})
it.each(layouts)('模拟：%s 的 manual 版本实体 %s 不迁移', async (cli, relative) => {
  const f = fixture(cli), old = f.file(join(f.root, relative)); f.store.setManual(cli, old)
  if (cli === 'traecn') vi.mocked(f.backend.spawn).mockImplementation(() => exited('traecli 0.214.0\ninstallation: 模拟'))
  expect(await resolveCliExecutable(cli, f.backend, f.config, control())).toBe(old)
  expect(f.store.read(cli)).toEqual({ mode: 'manual', path: old })
})
it('模拟：迁移失败与并发 manual 设置均不被旧发现覆盖', async () => {
  const f = fixture('codex'), old = f.file(join(f.root, layouts[0]![1])); f.store.remember('codex', old, 0)
  await expect(resolveCliExecutable('codex', f.backend, f.config, control())).rejects.toThrow()
  expect(f.store.read('codex')?.path).toBe(old)
  const manual = f.file(join(f.root, 'manual/codex'))
  vi.mocked(f.backend.resolveExecutable).mockImplementation(async () => { f.store.setManual('codex', manual); return f.file(f.entry) })
  await expect(resolveCliExecutable('codex', f.backend, f.config, control())).rejects.toThrow('路径已更新')
  expect(f.store.read('codex')).toEqual({ mode: 'manual', path: manual })
})
it('模拟：相似路径、跨 CLI 版本目录及非 home 目录不迁移', () => {
  expect(isVersionedAutoEntry('pi', '/模拟/.pi/agent/install/releases/1.0.4/dist/cli.js', '/模拟')).toBe(true)
  for (const path of ['/other/.pi/agent/install/releases/1.0.4/dist/cli.js', '/模拟/.pi/agent/install/releases-backup/1.0.4/cli.js', '/模拟/.local/share/cliworker-now/runtimes/pi-1.0.2/cli.js']) expect(isVersionedAutoEntry('pi', path, '/模拟')).toBe(false)
  expect(isVersionedAutoEntry('omp', '/模拟/.pi/agent/install/releases/1.0.4/dist/cli.js', '/模拟')).toBe(false)
})
it('模拟：Pi auto 迁移、后台不做 PATH 迁移、current-version 切换使缓存失效且 Worker 读新实体', async () => {
  const f = fixture(), old = pi(f, '1.0.4'); f.store.remember('pi', old.target, 0)
  expect(await identifyInstallation('pi', f.backend, f.config, control(), true)).toBeUndefined()
  expect(f.backend.resolveExecutable).not.toHaveBeenCalled()
  const before = await identifyInstallation('pi', f.backend, f.config, control())
  expect(before).toMatchObject({ executable: f.entry, manifestVersion: '1.0.4' })
  expect(f.store.read('pi')).toEqual({ mode: 'auto', path: old.target })
  // 模拟：通过核验后提交；后台测试继续使用已记录的稳定入口。
  f.store.remember('pi', f.entry, f.store.revision('pi'))
  const cache = new CliManagementCache(join(f.root, 'cache')); cache.rememberVersion('pi', before!.fingerprint, '1.0.4')
  const next = pi(f, '1.1.0')
  const after = await identifyInstallation('pi', f.backend, f.config, control(), true)
  expect(after?.fingerprint.realpath).toBe(next.target); expect(cache.version('pi', after!.fingerprint)).toBeUndefined()
  expect(await resolveCliExecutable('pi', f.backend, f.config, control())).toBe(next.target)
  const supported = pi(f, '1.5.2')
  expect((await identifyInstallation('pi', f.backend, f.config, control()))?.manifestVersion).toBe('1.5.2')
  expect(await resolveCliExecutable('pi', f.backend, f.config, control())).toBe(supported.target)
  // 1.5.2 is adapted since 2026-11-14; 1.6.0 stands in for an unreviewed release.
  pi(f, '1.6.0')
  expect((await identifyInstallation('pi', f.backend, f.config, control()))?.manifestVersion).toBe('1.6.0')
  await expect(resolveCliExecutable('pi', f.backend, f.config, control())).rejects.toMatchObject({ code: 'CLI_IDENTITY_MISMATCH' })
  expect(f.store.read('pi')?.path).toBe(f.entry)
  expect(f.backend.spawn).not.toHaveBeenCalled()
})
it('模拟：首次发现 Pi 写入口，manual 指向旧实体时不切换', async () => {
  const f = fixture(), old = pi(f, '1.0.4')
  expect(await resolveCliExecutable('pi', f.backend, f.config, control())).toBe(old.target)
  expect(f.store.read('pi')?.path).toBe(f.entry)
  f.store.setManual('pi', old.target); pi(f, '1.5.2')
  expect(await resolveCliExecutable('pi', f.backend, f.config, control())).toBe(old.target)
  expect(f.store.read('pi')).toEqual({ mode: 'manual', path: old.target })
})
it('模拟：Pi 更新后的服务核对从入口重新解析，旧 release 保留仍成功', async () => {
  const f = fixture(), old = pi(f, '1.0.4'); f.store.remember('pi', old.target, 0)
  f.identify.mockImplementation(async (cli, ...rest: any[]) => cli === 'pi' ? identifyInstallation(cli, f.backend, f.config, rest[2] ?? control(), rest[3]) : undefined)
  f.metadataFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, packageName: CLI_SOURCES.pi.npm, version: '1.5.2' })))
  const row = (await checked(f.service)).entries.find(e => e.cli === 'pi')!
  expect(row).toMatchObject({ currentVersion: '1.0.4', group: 'updatable' })
  vi.mocked(f.backend.spawn).mockImplementation(command => { expect(command.argv).toEqual([f.entry, 'update', '--self']); pi(f, '1.5.2'); return exited() })
  f.service.start('pi', 'update', row.planToken!, '', '模拟-pointer-update')
  expect((await finished(f.service)).results[0]).toMatchObject({ phase: 'succeeded', afterVersion: '1.5.2' })
  expect(statSync(old.target).isFile()).toBe(true)
  expect(f.store.read('pi')?.path).toBe(f.entry)
})
function zcode(f: ReturnType<typeof fixture>, bundle = 'dev.zcode.app', version = '3.17.2') {
  const runtime = f.file(join(f.root, '.local/share/cliworker-now/runtimes/zcode/cli/zcode.cjs'))
  const plist = f.file(join(environment.app, 'Contents/Info.plist'), `<plist><key>CFBundleIdentifier</key><string>${bundle}</string><key>CFBundleShortVersionString</key><string>${version}</string></plist>`)
  f.store.remember('zcode', runtime, f.store.revision('zcode'))
  return { runtime, plist }
}
it('模拟：ZCode auto runtime 关联已核实 bundle 并读应用版本，后台不启动进程', async () => {
  const f = fixture('zcode'), { runtime } = zcode(f)
  const id = await identifyInstallation('zcode', f.backend, f.config, control(), true)
  expect(id).toMatchObject({ executable: runtime, source: 'desktop-app', appPath: environment.app, notice: ZCODE_RUNTIME_NOTICE, fingerprint: { appVersion: '3.17.2' } })
  expect(await currentVersion('zcode', id!, f.backend, f.config, control(), true)).toBe('3.17.2')
  expect(f.backend.spawn).not.toHaveBeenCalled()
})
it.each(['wrong.bundle', 'missing'])('模拟：ZCode %s 应用身份不符/缺失时不映射', async bundle => {
  const f = fixture('zcode'), { runtime, plist } = zcode(f, bundle)
  if (bundle === 'missing') rmSync(plist)
  expect(await managedZCodeApplication(runtime)).toBeUndefined()
  expect(await identifyInstallation('zcode', f.backend, f.config, control(), true)).toMatchObject({ source: 'unknown', appPath: undefined })
})
it('模拟：ZCode manual 的外部脚本不关联默认应用', async () => {
  const f = fixture('zcode'); zcode(f)
  f.store.setManual('zcode', f.file(join(f.root, 'manual/zcode.cjs')))
  const id = await identifyInstallation('zcode', f.backend, f.config, control(), true)
  expect(id).toMatchObject({ source: 'unknown', appPath: undefined }); expect(id?.notice).toBeUndefined()
})
it('模拟：ZCode 应用更新结果明确 runtime 未同步替换并保留提示', async () => {
  const f = fixture('zcode'); zcode(f)
  f.identify.mockImplementation(async (cli, ...rest: any[]) => cli === 'zcode' ? identifyInstallation(cli, f.backend, f.config, rest[2] ?? control(), rest[3]) : undefined)
  f.version.mockImplementation(async (cli, id) => currentVersion(cli, id, f.backend, f.config, control()))
  vi.mocked(readDesktopRelease).mockResolvedValue({ version: '3.18.2', url: 'https://example.invalid/模拟.zip', sha512: '模拟' })
  vi.mocked(runDesktopUpdate).mockImplementation(async options => { expect(options.appPath).toBe(environment.app); zcode(f, 'dev.zcode.app', '3.18.2'); return { appPath: options.appPath } })
  const row = (await checked(f.service)).entries.find(e => e.cli === 'zcode')!
  expect(row).toMatchObject({ currentVersion: '3.17.2', group: 'updatable', notice: ZCODE_RUNTIME_NOTICE })
  f.service.start('zcode', 'update', row.planToken!, '', '模拟-desktop-update')
  const result = (await finished(f.service)).results[0]!
  expect(result).toMatchObject({ phase: 'succeeded', afterVersion: '3.18.2' }); expect(result.outputTail).toContain(ZCODE_RUNTIME_NOTICE)
  expect(f.service.snapshot().entries.find(e => e.cli === 'zcode')?.notice).toBe(ZCODE_RUNTIME_NOTICE)
})
it('模拟：Kimi 直接使用 CDN、禁止跳转，两个安装脚本均改用最终地址', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 1, version: '2.6.1' })))
  expect((await new ReleaseClient(fetcher).native('kimi', control())).latest).toBe('2.6.1')
  expect(fetcher).toHaveBeenCalledWith('https://cdn.kimi.com/kimi-code/latest.json', expect.objectContaining({ method: 'GET', credentials: 'omit', redirect: 'error' }))
  expect(CLI_SOURCES.kimi.scriptUrl).toBe('https://cdn.kimi.com/kimi-code/install.sh')
  expect(installationSource('kimi', 'darwin').script?.url).toBe('https://cdn.kimi.com/kimi-code/install.sh')
  expect(installationSource('kimi', 'win32').script?.url).toBe('https://cdn.kimi.com/kimi-code/install.ps1')
})
