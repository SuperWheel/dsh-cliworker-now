/** 模拟：首次安装全过程。所有 CLI、Node/npm、官方脚本、HTTP 与安装器均为夹具。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { CliManagementService } from '../src/host/cli-management/service.ts'
import { CliInstaller, installFs, nodeSatisfies } from '../src/host/cli-management/install.ts'
import { CliExecutablePathStore } from '../src/host/cli-executable-paths.ts'
import { installationSource } from '../src/host/cli-management/sources.ts'
import * as sources from '../src/host/cli-management/sources.ts'
import * as desktopRelease from '../src/host/cli-management/desktop-update.ts'
import { windowsCliCandidates } from '../src/host/windows-cli-installation.ts'
import { homedir } from 'node:os'
import { ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
import { desktopFs } from '../src/host/cli-management/desktop.ts'
import { directoryFs } from '../src/host/cli-management/directory.ts'
import { mimoConfigurationPaths } from '../src/host/mimo-configuration.ts'
import { identifyInstallation } from '../src/host/cli-management/identity.ts'
import { currentVersion } from '../src/host/cli-management/versions.ts'
import { CLI_IDS } from '../src/shared/types.ts'
import { serviceFixture, control, finished, syntheticIdentity, childFixture, until, sri } from './cli-management-phase-b-fixture.ts'
const fixtures: ReturnType<typeof serviceFixture>[] = []
const closes: (() => Promise<void>)[] = []
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const close of closes.splice(0)) await close().catch(() => undefined); for (const f of fixtures.splice(0)) await f.close() })
function exited(output = '') { return { stdout: Readable.from([output]), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), waitForExit: vi.fn(async () => true), terminate: vi.fn() } }
function fixture() {
  const f = serviceFixture(); fixtures.push(f)
  f.identities.clear()
  const config = { ...f.config, cliExecutablePaths: new CliExecutablePathStore(f.root) }
  const prefix = join(f.root, 'global'); mkdirSync(prefix)
  let nodeVersion = 'v22.19.0', installed = false
  f.identify.mockImplementation(async (cli, _backend, selectedConfig) => {
    const identity = f.identities.get(cli)
    if (selectedConfig.cliExecutablePaths === undefined && installed) return { ...syntheticIdentity(cli, '1.2.3'), executable: selectedConfig[`${cli}Executable`] ?? selectedConfig.executable }
    return identity && structuredClone(identity)
  })
  const metadata = f.metadataFetch.getMockImplementation()!
  f.metadataFetch.mockImplementation(async (...args) => { const r = await metadata(...args); const data = await r.json(); if (data.version) data.engines = { node: '>=18.0.0' }; return new Response(JSON.stringify(data)) })
  vi.mocked(f.backend.spawn).mockImplementation(spec => {
    if (spec.argv.includes('--version')) return exited(nodeVersion)
    if (spec.argv.includes('prefix')) return exited(prefix)
    installed = true; return exited()
  })
  const deps = { ...(f.service as any).deps, config }
  const service = new CliManagementService(deps), installer = new CliInstaller({ ...deps, fetcher: f.artifactFetch })
  closes.push(() => service.close())
  return { ...f, config, prefix, service, installer, nodeVersion(value: string) { nodeVersion = value }, installed(value: boolean) { installed = value } }
}
const prepare = (f: ReturnType<typeof fixture>, cli: any = 'codex') => f.installer.prepare(cli, 'https://registry.npmjs.org/', '', control())

it('模拟 2.8：Hermes 版本未知的原因不被重新安装说明覆盖', async () => {
  const f = fixture(); f.identities.set('hermes', { ...syntheticIdentity('hermes'), manifestVersion: undefined })
  f.version.mockImplementation(currentVersion as any)
  await (f.service as any).local('hermes', control(), false, false)
  await (f.service as any).installEntry('hermes', '', control())
  expect(f.service.snapshot().entries.find(e => e.cli === 'hermes')?.reasonDetail).toContain('前后台均不执行')
  expect(f.backend.spawn).not.toHaveBeenCalled()
})

it.each(['claude', 'mimo'] as const)('模拟审查 1：%s 首次安装仍仅说明，版本检查修复不自动开放脚本，零下载/进程', async cli => {
  const f = fixture(), plan = await prepare(f, cli)
  expect(plan.offer.method).toBe('manual'); expect(plan.source.reason).toContain('首次安装流程尚待重新核实')
  f.service.start(cli, 'install', plan.token, '', 'manual-native')
  expect((await finished(f.service)).results[0]?.error?.code).toBe('PREREQUISITE_MISSING')
  expect(f.backend.spawn).not.toHaveBeenCalled(); expect(f.artifactFetch).not.toHaveBeenCalled()
  expect(f.config.cliExecutablePaths.read(cli)).toBeUndefined()
})

it.each(['qoder', 'qodercn'] as const)('模拟审查 2：%s 使用发现工具的官方 exe 入口并写回', async cli => {
  const f = fixture(), installer = new CliInstaller({ ...(f.service as any).deps, platform: 'win32', arch: 'x64', fetcher: f.artifactFetch })
  const plan = await installer.prepare(cli, 'https://registry.npmjs.org/', '', control())
  const candidate = windowsCliCandidates(cli)[0]!
  expect(join(homedir(), plan.source.script!.relativeEntry)).toBe(candidate)
  expect(candidate.endsWith(cli === 'qoder' ? '.qoder/bin/qodercli/qodercli.exe' : '.qoder-cn/bin/qoderclicn/qoderclicn.exe')).toBe(true)
  const op = { outputTail: '' } as any
  await installer.execute(plan, op, control(), () => {}, async () => {})
  expect(f.backend.resolveExecutable).toHaveBeenCalledWith(candidate)
  expect(f.config.cliExecutablePaths.read(cli)?.path).toBe(candidate)
})

it.each(['success', 'new-invalid', 'cancel', 'cleanup'] as const)('模拟审查 4：Pi 旧安装损坏允许重装；新核对/取消/隔离不放松（%s）', async mode => {
  const f = fixture(), old = join(f.root, 'broken-pi'); writeFileSync(old, '模拟损坏 Pi')
  f.config.cliExecutablePaths.setManual('pi', old)
  const mismatch = Object.assign(new Error('模拟 Pi 身份损坏'), { code: 'CLI_IDENTITY_MISMATCH' })
  f.identify.mockImplementation(async (_cli, _backend, config, signal) => {
    if (config.cliExecutablePaths) return identifyInstallation('pi', f.backend, config, signal)
    if (mode === 'new-invalid') throw mismatch
    return { ...syntheticIdentity('pi', '1.1.0'), executable: config.piExecutable! }
  })
  vi.spyOn(f.releases, 'query').mockResolvedValue({ latest: '1.1.0', versions: ['1.1.0'], registry: 'https://registry.npmjs.org/', checkedAt: Date.now() })
  f.metadataFetch.mockImplementation(async () => new Response(JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '1.1.0', engines: { node: '>=22.19.0' }, dist: { tarball: 'https://registry.npmjs.org/pi.tgz', integrity: sri('模拟') } })))
  vi.spyOn(f.releases, 'artifact').mockResolvedValue({ url: 'https://registry.npmjs.org/pi.tgz', integrity: sri('模拟') }); f.version.mockResolvedValue('1.1.0')
  if (mode === 'cleanup') {
    const error = new ProcessCleanupUnconfirmedError(); f.identify.mockRejectedValue(error)
    await expect(prepare(f, 'pi')).rejects.toBe(error); return
  }
  if (mode === 'cancel') {
    const controller = new AbortController(); f.identify.mockImplementation(async () => { controller.abort(); throw mismatch })
    await expect(f.installer.prepare('pi', 'https://registry.npmjs.org/', '', controller.signal)).rejects.toBe(mismatch); return
  }
  const plan = await prepare(f, 'pi'); expect(plan.unusableBefore).toBe('CLI_IDENTITY_MISMATCH')
  f.service.start('pi', 'install', plan.token, '', 'repair-pi')
  const result = (await finished(f.service)).results[0]!
  expect(result.phase).toBe(mode === 'success' ? 'succeeded' : 'failed')
  expect(f.config.cliExecutablePaths.read('pi')?.path).toBe(mode === 'success' ? join(f.prefix, 'bin/pi') : old)
  expect(readFileSync(old, 'utf8')).toBe('模拟损坏 Pi')
})

it('模拟审查 5：detach 与 stage 删除同时失败仍隔离，保留镜像与维护锁', async () => {
  const f = fixture(), source = { method: 'desktop' as const, command: 'zcode', desktop: { url: 'https://official.invalid/模拟.dmg', bytes: Buffer.byteLength('模拟'), appName: '模拟.app', relativeEntry: 'Contents/bin/cli', teamId: 'ABCDE12345', version: '1.0.0' } }
  vi.spyOn(sources, 'installationSource').mockReturnValue(source)
  vi.spyOn(f.service, 'checkDirectory').mockImplementation(async (_cli, path) => ({ path }))
  const directory = join(f.root, 'target'), plan = await f.installer.prepare('zcode', 'https://registry.npmjs.org/', directory, control())
  vi.mocked(f.backend.spawn).mockImplementation(spec => {
    const a = spec.argv
    if (a[1] === 'attach') mkdirSync(join(a[a.indexOf('-mountpoint') + 1]!, source.desktop.appName))
    if (a[0] === '/usr/bin/ditto') mkdirSync(a[2]!)
    if (a[1] === 'detach') return { ...exited(), done: Promise.resolve({ exitCode: 1, signal: null }) }
    return exited()
  })
  vi.spyOn(desktopFs, 'rm').mockRejectedValue(new Error('模拟 stage 删除失败'))
  f.service.start('zcode', 'install', plan.token, directory, 'detach-fails')
  expect((await finished(f.service)).results[0]?.phase).toBe('cleanup-unconfirmed')
  expect(() => f.config.cliMaintenance.assertAvailable('zcode')).toThrow('MAINTENANCE')
  expect(readdirSync(join(f.root, 'cli-management/downloads')).some(name => name.endsWith('.dmg'))).toBe(true)
  expect(f.config.cliExecutablePaths.read('zcode')).toBeUndefined()
})

it.each(['default', 'env'] as const)('模拟审查 6：目录 Remote 保护账号路径工具的实际 %s 根目录及子目录', async mode => {
  const f = fixture()
  for (const key of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'MIMOCODE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) vi.stubEnv(key, mode === 'env' ? `/模拟账号/${key}` : '')
  const mimo = mimoConfigurationPaths(), paths = mode === 'env'
    ? ['/模拟账号/CODEX_HOME', '/模拟账号/CLAUDE_CONFIG_DIR', mimo.config, mimo.data]
    : [join(homedir(), '.codex'), join(homedir(), '.claude'), mimo.config, mimo.data]
  vi.spyOn(directoryFs, 'lstat').mockResolvedValue({ isDirectory: () => true, isSymbolicLink: () => false } as any)
  vi.spyOn(directoryFs, 'realpath').mockImplementation(async path => String(path))
  for (const path of paths) for (const target of [path, join(path, 'new')]) expect((await f.service.checkDirectory('zcode', target, control())).problem).toBe('INVALID')
  if (mode === 'env') {
    vi.stubEnv('MIMOCODE_HOME', '')
    const xdg = mimoConfigurationPaths()
    for (const path of [xdg.config, xdg.data]) expect((await f.service.checkDirectory('zcode', path, control())).problem).toBe('INVALID')
  }
  expect(f.backend.spawn).not.toHaveBeenCalled(); expect(f.artifactFetch).not.toHaveBeenCalled()
})

it('模拟：17 CLI 安装方法严格按平台与来源证据选择', () => {
  expect(CLI_IDS.map(cli => installationSource(cli, 'darwin').method)).toEqual(['manual', 'npm', 'manual', 'script', 'manual', 'desktop', 'manual', 'manual', 'npm', 'manual', 'manual', 'manual', 'manual', 'npm', 'script', 'desktop', 'desktop'])
  expect(installationSource('mimo', 'win32').method).toBe('npm'); expect(installationSource('opencode', 'win32').method).toBe('npm')
  expect(installationSource('qoder', 'win32').script?.url).toBe('https://qoder.com/install.ps1')
  for (const cli of ['zcode', 'workbuddycn', 'workbuddy'] as const) expect(installationSource(cli, 'win32').reason).toContain('尚未核实')
})
it('模拟：未安装条目提供安装 offer 与 token；成功后路径写回原存储', async () => {
  const f = fixture()
  await (f.service as any).local('codex', control(), false, false)
  await (f.service as any).installEntry('codex', '', control())
  const row = f.service.snapshot().entries.find(e => e.cli === 'codex')!
  expect(row).toMatchObject({ group: 'notInstalled', install: { method: 'npm', defaultLocation: f.prefix, prerequisites: [{ name: 'Node.js', satisfied: true }] } })
  expect(row.planToken).toMatch(/^[a-f0-9]{64}$/)
  const result = f.service.start('codex', 'install', row.planToken!, '', 'install')
  expect(result.operation?.intent).toBe('install')
  expect(() => f.config.cliMaintenance.assertAvailable('codex')).toThrow('MAINTENANCE')
  const done = await finished(f.service)
  expect(done.results[0]).toMatchObject({ phase: 'succeeded', afterVersion: '1.2.3', installDirectory: f.prefix })
  const path = join(f.prefix, 'bin/codex')
  expect(new CliExecutablePathStore(f.root).read('codex')?.path).toBe(path)
  expect(done.entries.find(e => e.cli === 'codex')).toMatchObject({ group: 'latest', currentVersion: '1.2.3' })
  const install = vi.mocked(f.backend.spawn).mock.calls.find(([s]) => s.argv.includes('install'))![0].argv
  expect(install).toContain(f.prefix); expect(install.some(a => a.endsWith('.tgz'))).toBe(true)
})
it.each(['node', 'prefix'] as const)('模拟：%s 前置条件失败时给出原因且不下载/安装', async kind => {
  const f = fixture()
  if (kind === 'node') f.nodeVersion('v16.0.0')
  else vi.spyOn(installFs, 'access').mockRejectedValue(Object.assign(new Error('模拟 denied'), { code: 'EACCES' }))
  const plan = await prepare(f)
  expect(plan.problem).toBe(kind === 'node' ? 'PREREQUISITE_MISSING' : 'PERMISSION_DENIED')
  expect(plan.offer.prerequisites.some(p => !p.satisfied)).toBe(true)
  f.service.start('codex', 'install', plan.token, '', 'blocked')
  expect((await finished(f.service)).results[0]?.error?.code).toBe(plan.problem)
  expect(f.artifactFetch).not.toHaveBeenCalled()
  expect(vi.mocked(f.backend.spawn).mock.calls.some(([s]) => s.argv.includes('install'))).toBe(false)
})
it('模拟：安装计划绑定当前缺失状态、路径记录、npm 前缀和目标', async () => {
  const f = fixture(), plan = await prepare(f)
  f.config.cliExecutablePaths.setManual('codex', '/模拟/new-path')
  f.service.start('codex', 'install', plan.token, '', 'expired')
  expect((await finished(f.service)).results[0]?.error?.code).toBe('PLAN_EXPIRED')
  expect(f.artifactFetch).not.toHaveBeenCalled()
})
it('模拟：失效旧路径说明与未知版本重新安装；成功改用新路径不删旧文件', async () => {
  const f = fixture(), old = join(f.root, 'old-cli'); writeFileSync(old, '模拟旧文件')
  f.config.cliExecutablePaths.setManual('codex', old)
  f.identities.set('codex', { ...syntheticIdentity(), executable: old, manifestVersion: undefined })
  await (f.service as any).local('codex', control(), false, false)
  expect(f.service.snapshot().entries.find(e => e.cli === 'codex')).toMatchObject({ group: 'failed', reason: 'UNKNOWN_VERSION' })
  const plan = await prepare(f); f.service.start('codex', 'install', plan.token, '', 'reinstall')
  expect((await finished(f.service)).results[0]).toMatchObject({ phase: 'succeeded' })
  expect(f.config.cliExecutablePaths.read('codex')?.path).toBe(join(f.prefix, 'bin/codex')); expect(readFileSync(old, 'utf8')).toBe('模拟旧文件')
  f.identities.clear(); f.config.cliExecutablePaths.setManual('kimi', join(f.root, 'gone'))
  await (f.service as any).local('kimi', control(), false, false)
  expect(f.service.snapshot().entries.find(e => e.cli === 'kimi')?.reasonDetail).toContain('之前记录的路径')
})
it('模拟：安装退出码 0 但找不到入口明确失败，保留旧路径', async () => {
  const f = fixture(), plan = await prepare(f)
  vi.mocked(f.backend.spawn).mockImplementation(spec => spec.argv.includes('--version') ? exited('v22.19.0') : spec.argv.includes('prefix') ? exited(f.prefix) : exited())
  f.service.start('codex', 'install', plan.token, '', 'missing')
  const result = (await finished(f.service)).results[0]!
  expect(result.error?.message).toContain(`安装命令已完成，但在 ${join(f.prefix, 'bin/codex')} 找不到 codex`)
  expect(f.config.cliExecutablePaths.read('codex')).toBeUndefined()
})
it('模拟：官方脚本只取内置地址并以私有文件执行，不接受纯 CLI 自选目录', async () => {
  const f = fixture(), plan = await prepare(f, 'kimi')
  expect(plan.source.script?.url).toBe('https://cdn.kimi.com/kimi-code/install.sh')
  await expect(f.installer.prepare('kimi', plan.registry, '/模拟/自选', control())).rejects.toThrow('纯 CLI')
  let script = ''
  vi.mocked(f.backend.spawn).mockImplementation(spec => {
    expect(spec.argv[0]).toBe('/bin/bash'); expect(spec.argv).toHaveLength(2)
    script = spec.argv[1]!
    expect(statSync(script).mode & 0o777).toBe(0o600); expect(readFileSync(script, 'utf8')).toBe('模拟')
    f.installed(true); return exited()
  })
  f.service.start('kimi', 'install', plan.token, '', 'script')
  expect((await finished(f.service)).results[0]?.phase).toBe('succeeded')
  expect(f.artifactFetch.mock.calls[0]![0]).toBe('https://cdn.kimi.com/kimi-code/install.sh'); expect(existsSync(script)).toBe(false)
})
it('模拟：Pi 取最新版且带 ignore-scripts；Node 范围不可猜测', async () => {
  const f = fixture(); vi.spyOn(f.releases, 'query').mockResolvedValue({ latest: '9.0.0', versions: ['1.0.2', '9.0.0', '9.0.0'], registry: 'https://registry.npmjs.org/', checkedAt: Date.now() })
  f.metadataFetch.mockImplementation(async () => new Response(JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '9.0.0', engines: { node: '>=22.19.0' }, dist: { tarball: 'https://registry.npmjs.org/pi.tgz', integrity: sri('模拟') } })))
  const plan = await prepare(f, 'pi'); expect(plan.target).toBe('9.0.0'); expect(plan.problem).toBeUndefined()
  vi.spyOn(f.releases, 'artifact').mockResolvedValue({ url: 'https://registry.npmjs.org/pi.tgz', integrity: sri('模拟') })
  f.version.mockResolvedValue('9.0.0')
  f.service.start('pi', 'install', plan.token, '', 'pi-install')
  expect((await finished(f.service)).results[0]?.phase).toBe('succeeded')
  expect(vi.mocked(f.backend.spawn).mock.calls.find(([s]) => s.argv.includes('install'))![0].argv).toContain('--ignore-scripts')
  expect(nodeSatisfies('22.19.0', '>=18.0.0 <23.0.0')).toBe(true)
  expect(nodeSatisfies('22.19.0', 'unknown')).toBe(false)
})
it('模拟：Kimi Windows 需要 Git Bash，不能把 WSL bash 当成满足条件', async () => {
  const f = fixture(), installer = new CliInstaller({ ...(f.service as any).deps, platform: 'win32', fetcher: f.artifactFetch })
  vi.stubEnv('PATH', join(f.root, 'Windows/System32')); vi.stubEnv('ProgramFiles', f.root); vi.stubEnv('LOCALAPPDATA', f.root)
  vi.mocked(f.backend.resolveExecutable).mockImplementation(async path => path === 'bash.exe' ? 'C:\\Windows\\System32\\bash.exe' : path)
  const blocked = await installer.prepare('kimi', 'https://registry.npmjs.org/', '', control())
  expect(blocked.offer.prerequisites.find(p => p.name === 'bash.exe')?.satisfied).toBe(false)
  const git = join(f.root, '便携工具'), pe = Buffer.alloc(68); pe.write('MZ'); pe.writeUInt32LE(64, 60); pe.write('PE\0\0', 64)
  for (const entry of ['cmd/git.exe', 'usr/bin/bash.exe', 'usr/bin/msys-2.0.dll']) { const path = join(git, entry); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, pe) }
  vi.stubEnv('PATH', `${join(f.root, 'Windows/System32')};${join(git, 'cmd')}`)
  const allowed = await installer.prepare('kimi', 'https://registry.npmjs.org/', '', control())
  expect(allowed.problem).toBeUndefined(); expect(allowed.source.script?.interpreter).toEqual(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'])
  expect(allowed.gitBash).toBe(join(git, 'usr/bin/bash.exe'))
})
it('模拟：Windows 首次安装签名和实际落点未核实，保持零下载和进程', async () => {
  const f = fixture()
  const installer = new CliInstaller({ ...(f.service as any).deps, platform: 'win32' })
  for (const cli of ['zcode', 'workbuddycn', 'workbuddy'] as const) {
    const plan = await installer.prepare(cli, 'https://registry.npmjs.org/', '', control())
    expect(plan.offer.method).toBe('manual'); expect(plan.problem).toBe('PREREQUISITE_MISSING')
    await expect(installer.execute(plan, {} as any, control(), () => {}, async () => {})).rejects.toMatchObject({ code: 'PREREQUISITE_MISSING' })
  }
  expect(f.artifactFetch).not.toHaveBeenCalled(); expect(f.backend.spawn).not.toHaveBeenCalled()
})
it.each(['zcode', 'workbuddycn', 'workbuddy'] as const)('模拟：%s 首次安装使用官方发布读取器、摘要、固定签名与自选路径', async cli => {
  const f = fixture(), version = cli === 'zcode' ? '3.18.2' : '5.9.4.42593613'
  const feed = vi.spyOn(desktopRelease, 'readDesktopRelease').mockResolvedValue({ version, url: 'https://official.invalid/mock.zip', sha256: 'a'.repeat(64) })
  const directory = join(f.root, 'custom-apps'), plan = await f.installer.prepare(cli, 'https://registry.npmjs.org/', directory, control())
  expect(feed).toHaveBeenCalledWith(cli, {}, expect.any(AbortSignal), expect.objectContaining({ platform: 'darwin' }))
  expect(plan).toMatchObject({ directory, target: version, offer: { method: 'desktop', selectableLocation: true }, source: { desktop: { archive: 'zip', teamId: sources.DESKTOP_INSTALL_SOURCES[cli].teamId, integrity: `sha256-${Buffer.from('a'.repeat(64), 'hex').toString('base64')}` } } })
  feed.mockResolvedValue({ version, url: 'https://official.invalid/replaced.zip', sha256: 'b'.repeat(64) })
  expect((await f.installer.prepare(cli, 'https://registry.npmjs.org/', directory, control())).token).not.toBe(plan.token)
  expect(f.backend.spawn).not.toHaveBeenCalled(); expect(f.artifactFetch).not.toHaveBeenCalled()
})
it.each(['3.18.2', '3.18.1'] as const)('模拟：桌面安装后应用版本 %s；只在匹配官方目标时写路径', async appVersion => {
  const f = fixture(), directory = join(f.root, 'desktop-target'), version = '3.18.2'
  vi.spyOn(desktopRelease, 'readDesktopRelease').mockResolvedValue({ version, url: 'https://official.invalid/mock.zip', sha512: sri('模拟').slice(7) })
  vi.mocked(f.backend.spawn).mockImplementation(({ argv }) => {
    if (argv[1] === '-x') mkdirSync(join(argv[4]!, 'ZCode.app'))
    else if (argv[0] === '/usr/bin/ditto') mkdirSync(argv[2]!)
    return exited()
  })
  f.identify.mockImplementation(async (_cli, _backend, config) => config.cliExecutablePaths ? undefined : ({ ...syntheticIdentity('zcode', appVersion), executable: config.zcodeExecutable!, source: 'desktop-app', fingerprint: { realpath: config.zcodeExecutable!, size: 1, mtimeMs: 1, appVersion } }))
  f.version.mockResolvedValue(appVersion)
  const plan = await f.installer.prepare('zcode', 'https://registry.npmjs.org/', directory, control()), op = { outputTail: '' } as any
  const task = f.installer.execute(plan, op, control(), () => {}, async () => {})
  if (appVersion === version) {
    await expect(task).resolves.toMatchObject({ version }); expect(f.config.cliExecutablePaths.read('zcode')?.path).toBe(join(directory, 'ZCode.app/Contents/Resources/glm/zcode.cjs'))
  } else { await expect(task).rejects.toMatchObject({ code: 'VERSION_MISMATCH' }); expect(f.config.cliExecutablePaths.read('zcode')).toBeUndefined() }
  expect(readdirSync(join(f.root, 'cli-management/downloads'))).toEqual([])
})
it('模拟：桌面官方工件摘要不符时，两次下载均拒绝，零安装进程、不写路径', async () => {
  const f = fixture()
  vi.spyOn(desktopRelease, 'readDesktopRelease').mockResolvedValue({ version: '5.9.4.42593613', url: 'https://official.invalid/mock.zip', sha256: 'a'.repeat(64) })
  const plan = await f.installer.prepare('workbuddy', 'https://registry.npmjs.org/', join(f.root, 'target'), control())
  await expect(f.installer.execute(plan, { outputTail: '' } as any, control(), () => {}, async () => {})).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  expect(f.artifactFetch).toHaveBeenCalledTimes(2); expect(f.backend.spawn).not.toHaveBeenCalled(); expect(f.config.cliExecutablePaths.read('workbuddy')).toBeUndefined()
})
it('模拟：安装与更新共用锁，重复请求幂等，取消等待整个进程退出', async () => {
  const f = fixture(), plan = await prepare(f), child = childFixture()
  vi.mocked(f.backend.spawn).mockImplementation(spec => spec.argv.includes('--version') ? exited('v22.19.0') : spec.argv.includes('prefix') ? exited(f.prefix) : child.child as any)
  const op = f.service.start('codex', 'install', plan.token, '', 'cancel').operation!
  expect(f.service.start('codex', 'install', plan.token, '', 'cancel').operation?.id).toBe(op.id)
  expect(() => f.service.updateAll('during')).toThrow('CLI_BUSY')
  await until(() => vi.mocked(f.backend.spawn).mock.calls.some(([s]) => s.argv.includes('install')))
  f.service.cancel(op.id); await until(() => child.child.waitForExit.mock.calls.length > 0)
  expect(f.service.snapshot().results).toEqual([]); child.finish(); child.exit(true)
  expect((await finished(f.service)).results[0]?.phase).toBe('cancelled'); expect(f.config.cliExecutablePaths.read('codex')).toBeUndefined()
})
