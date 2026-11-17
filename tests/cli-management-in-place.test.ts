/** 模拟：文件、发布源、安装器、Windows 路径与进程均为夹具；不运行真实安装/更新。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { preparePiRepairGuard } from '../src/host/cli-management/pi-repair.ts'
import { ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
import { checkPiInstallationIntegrity } from '../src/host/pi-installation.mjs'
import { CliInstaller } from '../src/host/cli-management/install.ts'
import { CliManagementService } from '../src/host/cli-management/service.ts'
import { CliExecutablePathStore } from '../src/host/cli-executable-paths.ts'
import { classifyInstallation, identifyInstallation, identifyManagedPi } from '../src/host/cli-management/identity.ts'
import { assertNpmInstallation, boundOfficialEnv, updateProblem } from '../src/host/cli-management/planner.ts'
import { desktopUpdateIo, runDesktopUpdate, installedWindowsAppPaths } from '../src/host/cli-management/desktop-update.ts'
import * as localArtifacts from '../src/host/cli-management/local-artifacts.ts'
import * as workbuddy from '../src/host/workbuddy-installation.ts'
import * as pe from '../src/host/cli-management/pe-version.ts'
import { resolveCliExecutable } from '../src/host/adapters.ts'
import { serviceFixture, npmFixture, syntheticIdentity, control, checked, finished } from './cli-management-phase-b-fixture.ts'
const simulated = vi.hoisted(() => ({ home: '/模拟/home' }))
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => simulated.home }))
vi.mock('../src/host/pi-installation.mjs', async original => ({ ...await original<typeof import('../src/host/pi-installation.mjs')>(), checkPiInstallationIntegrity: vi.fn(async () => {}) }))
const fixtures: ReturnType<typeof serviceFixture>[] = [], services: CliManagementService[] = []
afterEach(async () => { for (const service of services.splice(0)) await service.close().catch(() => {}); for (const f of fixtures.splice(0)) await f.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.mocked(checkPiInstallationIntegrity).mockResolvedValue(undefined) })
function fixture(cli: any = 'codex', platform: NodeJS.Platform = process.platform) {
  const f = serviceFixture([cli]); fixtures.push(f); simulated.home = f.root
  const config = { ...f.config, cliExecutablePaths: new CliExecutablePathStore(f.root, { platform }) }
  const deps = { ...(f.service as any).deps, config, piGuard: preparePiRepairGuard }
  const service = new CliManagementService(deps); services.push(service)
  const installer = new CliInstaller({ ...deps, fetcher: f.artifactFetch })
  return { ...f, config, service, installer }
}
const exited = (text = '') => ({ stdout: Readable.from([text]), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), waitForExit: vi.fn(async () => true), terminate: vi.fn() })
const registry = 'https://registry.npmjs.org/'
const operation = () => ({ id: '模拟修复', cli: 'pi' as const, intent: 'install' as const, phase: 'preparing' as const, startedAt: Date.now(), outputTail: '' })

it.each(['C:/tools/lib', 'D:/custom-prefix'])('模拟：Windows cmd 与内层 JS 均保留 npm 原前缀 %s', prefix => {
  const entry = `${prefix}/node_modules/@openai/codex/bin/codex.js`
  for (const selected of [`${prefix}/codex.cmd`, entry]) {
    const id = classifyInstallation('codex', entry, '@openai/codex', 'C:/Users/admin', selected)
    expect(id).toEqual({ source: 'npm', prefix, packageRoot: `${prefix}/node_modules/@openai/codex` })
    expect(() => assertNpmInstallation('codex', { ...syntheticIdentity(), ...id }, 'win32')).not.toThrow()
    expect(() => assertNpmInstallation('codex', { ...syntheticIdentity(), ...id, prefix: 'C:/tools' }, 'win32')).toThrow('插件不会另装一份')
  }
})
it('模拟：Windows Pi 大小写差异仍是同根 self-update，嵌入 node_modules 不误判 npm', () => {
  expect(classifyInstallation('pi', 'C:/Users/Admin/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent/dist/cli.js', '@earendil-works/pi-coding-agent', 'C:/Users/admin'))
    .toMatchObject({ source: 'self-update', updateRoot: 'C:/Users/admin/.pi/agent' })
})
it('模拟：初次识别 Pi 有效托管元数据但启动器缺失，保留原 owner 和 root', async () => {
  const f = fixture('pi'), root = join(f.root, '.pi/agent'), install = join(root, 'install')
  mkdirSync(join(install, 'releases'), { recursive: true })
  writeFileSync(join(install, 'managed-install.json'), JSON.stringify({ kind: 'pi-managed-install', schemaVersion: 1, layout: 'releases-v1' }))
  writeFileSync(join(install, 'current-version'), '1.1.0\n')
  const id = await identifyInstallation('pi', f.backend, f.config, control())
  expect(id).toMatchObject({ source: 'self-update', updateRoot: root, manifestVersion: '1.1.0', repairNeeded: true, notice: 'Pi 托管安装需要修复' })
  expect(f.backend.resolveExecutable).not.toHaveBeenCalled(); expect(f.config.cliExecutablePaths.revision('pi')).toBe(0)
  await expect(identifyManagedPi(join(f.root, '.local/bin/missing-pi'), f.root)).rejects.toThrow('插件不会另装一份')
  writeFileSync(join(install, 'managed-install.json'), '{}')
  await expect(identifyManagedPi(undefined, f.root)).rejects.toThrow('插件不会另装一份')
})
it.each(['success', 'npm-copy', 'npm-copy-nonzero', 'other-root', 'unchanged', 'script-changed', 'pointer-missing', 'wrong-version', 'custom-command', 'custom-env', 'same-version', 'same-version-broken', 'probe-cleanup'] as const)('模拟：Windows Pi 原根官方修复核验 current-version 与其他副本：%s', async mode => {
  const f = fixture('pi'), root = join(f.root, '.pi/agent'), executable = join(root, 'bin/pi.cmd'), prefix = join(f.root, 'npm-global'), other = join(f.root, 'other-agent')
  const initialVersion = mode.startsWith('same-version') ? '1.5.2' : '1.1.0'
  const before = { ...syntheticIdentity('pi', initialVersion), source: 'self-update' as const, executable, updateRoot: root, repairNeeded: true }
  mkdirSync(join(root, 'install'), { recursive: true })
  writeFileSync(join(root, 'install/managed-install.json'), JSON.stringify({ kind: 'pi-managed-install', schemaVersion: 1, layout: 'releases-v1' }))
  if (mode !== 'pointer-missing') writeFileSync(join(root, 'install/current-version'), initialVersion)
  if (mode === 'custom-command') writeFileSync(join(root, 'settings.json'), JSON.stringify({ selfUpdateCommand: ['npm', 'install', '--prefix', other] }))
  if (mode === 'custom-env') vi.stubEnv('PI_SELF_UPDATE_COMMAND', '模拟更新器 --root ' + other)
  vi.stubEnv('PI_CODING_AGENT_DIR', other)
  vi.stubEnv('PATH', join(f.root, 'simulated-bin'))
  f.identities.set('pi', before); f.config.cliExecutablePaths.setManual('pi', executable)
  const revision = f.config.cliExecutablePaths.revision('pi')
  vi.spyOn(f.releases, 'query').mockResolvedValue({ latest: '1.5.2', versions: ['1.5.2'], checkedAt: Date.now(), registry })
  const npm = npmFixture(f.root, 'win32')
  vi.mocked(f.backend.resolveExecutable).mockImplementation(async name => name === 'pi.cmd' ? executable : name === 'npm.cmd' ? npm.launcher : npm.node)
  const script = readFileSync('tests/fixtures/official-installers/pi-install.ps1')
  f.artifactFetch.mockImplementation(async (_url, init) => new Response(init?.method === 'HEAD' ? null : mode === 'script-changed' ? Buffer.alloc(script.length, 65) : script, { headers: { 'content-length': String(script.length) } }))
  let prefixReads = 0
  vi.mocked(checkPiInstallationIntegrity).mockImplementation(async () => { if (mode === 'same-version-broken') throw new Error('模拟：依赖仍缺失') })
  vi.mocked(f.backend.spawn).mockImplementation(spec => {
    if (spec.argv.includes('prefix')) { prefixReads++; return mode === 'probe-cleanup' && prefixReads > 1 ? { ...exited(prefix), waitForExit: vi.fn(async () => false) } : exited(prefix) }
    if (mode !== 'unchanged') writeFileSync(join(root, 'install/current-version'), mode === 'wrong-version' ? '1.5.1' : '1.5.2')
    if (mode === 'npm-copy' || mode === 'npm-copy-nonzero') { const pkg = join(prefix, 'node_modules/@earendil-works/pi-coding-agent'); mkdirSync(pkg, { recursive: true }); writeFileSync(join(pkg, 'package.json'), '{"name":"@earendil-works/pi-coding-agent"}') }
    if (mode === 'other-root') { mkdirSync(join(other, 'install'), { recursive: true }); writeFileSync(join(other, 'install/managed-install.json'), '{}') }
    f.identities.set('pi', { ...before, repairNeeded: false, manifestVersion: '1.5.2' }); return ['npm-copy-nonzero', 'probe-cleanup'].includes(mode) ? { ...exited(), done: Promise.resolve({ exitCode: 1, signal: null }) } : exited()
  })
  const deps = { ...(f.service as any).deps, platform: 'win32' as const, fetcher: f.artifactFetch }
  const installer = new CliInstaller(deps), plan = await installer.prepare('pi', registry, '', control())
  const pending = installer.execute(plan, operation(), control(), () => {}, async () => {})
  if (mode === 'probe-cleanup') {
    await expect(pending).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
    expect(readdirSync(join(f.root, 'cli-management/downloads')).some(name => name.endsWith('.ps1'))).toBe(true)
  } else if (mode === 'same-version-broken') await expect(pending).rejects.toThrow('依赖仍缺失')
  else if (['success', 'same-version'].includes(mode)) await expect(pending).resolves.toMatchObject({ version: '1.5.2' })
  else await expect(pending).rejects.toMatchObject({ code: mode === 'wrong-version' ? 'VERSION_MISMATCH' : ['pointer-missing', 'custom-command', 'custom-env'].includes(mode) ? 'PREREQUISITE_MISSING' : mode === 'unchanged' ? 'VERSION_MISMATCH' : mode === 'script-changed' ? 'INTEGRITY_MISMATCH' : 'IDENTITY_CHANGED' })
  const runs = vi.mocked(f.backend.spawn).mock.calls.filter(([spec]) => !spec.argv.includes('prefix'))
  expect(runs).toHaveLength(['script-changed', 'pointer-missing', 'custom-command', 'custom-env'].includes(mode) ? 0 : 1)
  if (runs[0]) { expect(runs[0][0].argv[0]).toBe('powershell.exe'); expect(runs[0][0].env).toMatchObject({ PI_LEGACY_INSTALL: '0', PI_MANAGED_INSTALL_ROOT: join(root, 'install'), PI_CODING_AGENT_DIR: root }) }
  if (mode === 'success') { expect(readFileSync(join(root, 'install/current-version'), 'utf8')).toBe('1.5.2'); expect(existsSync(join(prefix, 'node_modules/@earendil-works/pi-coding-agent'))).toBe(false); expect(existsSync(join(other, 'install'))).toBe(false) }
  expect(f.config.cliExecutablePaths.read('pi')?.path).toBe(executable); expect(f.config.cliExecutablePaths.revision('pi')).toBe(revision)
})
it.each(['same-root', 'second-root', 'same-root-takeover', 'unchanged'] as const)('模拟：Pi 1.1.0 托管更新达到原根目标且保留其他安装与记录：%s', async mode => {
  const f = fixture('pi'), root = join(f.root, '.pi/agent'), executable = join(root, 'bin/pi'), prefix = join(f.root, 'npm-global')
  const before = { ...syntheticIdentity('pi', '1.1.0'), executable, source: 'self-update' as const, updateRoot: root }
  mkdirSync(join(root, 'install'), { recursive: true }); mkdirSync(join(root, 'bin'), { recursive: true })
  writeFileSync(executable, '模拟启动器'); writeFileSync(join(root, 'install/current-version'), '1.1.0')
  writeFileSync(join(root, 'install/managed-install.json'), JSON.stringify({ kind: 'pi-managed-install', schemaVersion: 1, layout: 'releases-v1' }))
  vi.stubEnv('PATH', join(root, 'bin'))
  f.identities.set('pi', before); f.config.cliExecutablePaths.setManual('pi', executable)
  const globalFile = join(prefix, 'pi.cmd'); mkdirSync(dirname(globalFile), { recursive: true }); writeFileSync(globalFile, '模拟原全局树')
  const revision = f.config.cliExecutablePaths.revision('pi')
  vi.spyOn(f.releases, 'query').mockResolvedValue({ latest: '1.5.2', versions: ['1.5.2'], checkedAt: Date.now(), registry })
  vi.mocked(f.backend.spawn).mockImplementation(spec => {
    if (spec.argv.includes('prefix')) return exited(prefix)
    if (spec.argv.includes('--self')) {
      expect(spec.env?.PI_MANAGED_INSTALL_ROOT).toBe(join(root, 'install'))
      if (mode === 'unchanged') return exited()
      if (mode === 'same-root-takeover') return { ...exited(), done: Promise.resolve({ exitCode: 1, signal: null }) }
      writeFileSync(join(root, 'install/current-version'), '1.5.2')
      f.identities.set('pi', { ...before, manifestVersion: '1.5.2' })
      if (mode === 'second-root') { const pkg = join(prefix, 'lib/node_modules/@earendil-works/pi-coding-agent'); mkdirSync(pkg, { recursive: true }); writeFileSync(join(pkg, 'package.json'), '{}') }
    }
    return exited()
  })
  const takeover = vi.spyOn(localArtifacts, 'prepareLocalUpdate').mockImplementation(async options => {
    expect(options.identity?.updateRoot).toBe(root)
    return { argv: [], targetVersion: '1.5.2', cleanup: async () => {}, install: async () => {
      // 模拟：已校验 npm tarball 被托管更新器放入原 releases，不改变其他前缀。
      const release = join(root, 'install/releases/1.5.2/node_modules/@earendil-works/pi-coding-agent')
      mkdirSync(release, { recursive: true }); writeFileSync(join(release, 'package.json'), '{"version":"1.5.2"}')
      writeFileSync(join(root, 'install/current-version'), '1.5.2'); f.identities.set('pi', { ...before, manifestVersion: '1.5.2' })
    } }
  })
  const row = (await checked(f.service)).entries.find(e => e.cli === 'pi')!
  f.service.start('pi', 'update', row.planToken!, '', '模拟-managed')
  const result = (await finished(f.service)).results[0]
  expect(result, JSON.stringify(result)).toMatchObject(mode === 'unchanged' ? { phase: 'failed', error: { code: 'VERSION_UNCHANGED' } } : mode !== 'second-root' ? { phase: 'succeeded', afterVersion: '1.5.2' } : { phase: 'failed', error: { code: 'IDENTITY_CHANGED' } })
  expect(readFileSync(join(root, 'install/current-version'), 'utf8')).toBe(mode === 'unchanged' ? '1.1.0' : '1.5.2')
  expect(existsSync(join(prefix, 'lib/node_modules/@earendil-works/pi-coding-agent'))).toBe(mode === 'second-root')
  expect(takeover).toHaveBeenCalledTimes(mode === 'same-root-takeover' ? 1 : 0)
  expect(readFileSync(globalFile, 'utf8')).toBe('模拟原全局树'); expect(f.config.cliExecutablePaths.revision('pi')).toBe(revision)
  expect(f.config.cliExecutablePaths.read('pi')?.path).toBe(executable)
})
it('模拟：npm-global Pi 在非默认原前缀更新，其他前缀与路径记录不变', async () => {
  const f = fixture('pi'), prefix = join(f.root, 'custom-prefix'), executable = join(prefix, 'bin/pi'), pkg = join(prefix, 'lib/node_modules/@earendil-works/pi-coding-agent'), other = join(f.root, 'default-prefix')
  mkdirSync(pkg, { recursive: true }); writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '1.1.0' }))
  const before = { ...syntheticIdentity('pi', '1.1.0'), prefix, packageRoot: pkg, executable }
  f.identities.set('pi', before); f.config.cliExecutablePaths.setManual('pi', executable)
  const revision = f.config.cliExecutablePaths.revision('pi')
  vi.spyOn(f.releases, 'query').mockResolvedValue({ latest: '1.5.2', versions: ['1.5.2'], checkedAt: Date.now(), registry })
  const metadata = f.metadataFetch.getMockImplementation()!
  f.metadataFetch.mockImplementation(async (...args) => { const response = await metadata(...args); const data = await response.json(); if (String(args[0]).endsWith('/1.5.2')) return new Response(JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '1.5.2', dist: { tarball: registry + 'pi.tgz', integrity: await f.releases.integrity('pi', '1.5.2', registry, control()) } })); return new Response(JSON.stringify(data)) })
  vi.mocked(f.backend.spawn).mockImplementation(spec => {
    if (spec.argv.includes('install')) { expect(spec.argv[spec.argv.indexOf('--prefix') + 1]).toBe(prefix); writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '1.5.2' })); f.identities.set('pi', { ...before, manifestVersion: '1.5.2' }) }
    return exited()
  })
  const row = (await checked(f.service)).entries.find(e => e.cli === 'pi')!
  f.service.start('pi', 'update', row.planToken!, '', '模拟-npm-pi')
  expect((await finished(f.service)).results[0]).toMatchObject({ phase: 'succeeded', afterVersion: '1.5.2' })
  expect(JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version).toBe('1.5.2'); expect(existsSync(other)).toBe(false)
  expect(f.config.cliExecutablePaths.read('pi')?.path).toBe(executable); expect(f.config.cliExecutablePaths.revision('pi')).toBe(revision)
})
it.each(['self-update', 'brew'] as const)('模拟：已有 CodeBuddy %s 修复保留原 owner 与安装目录', async source => {
  const f = fixture('codebuddy'), before = { ...syntheticIdentity('codebuddy'), source, executable: '/模拟/home/.local/bin/codebuddy', updateRoot: '/模拟/home/.local/share/codebuddy', prefix: '/模拟/brew', fingerprint: { realpath: '/模拟/home/.local/share/codebuddy/versions/1.0.0/codebuddy', size: 1, mtimeMs: 1 } }
  f.identities.set('codebuddy', before); f.config.cliExecutablePaths.setManual('codebuddy', before.executable)
  vi.spyOn(f.releases, 'query').mockResolvedValue({ latest: '1.2.3', versions: ['1.2.3'], checkedAt: Date.now(), registry })
  const plan = await f.installer.prepare('codebuddy', registry, '', control())
  await f.installer.execute(plan, { ...operation(), cli: 'codebuddy' }, control(), () => {}, async () => {})
  const args = vi.mocked(f.backend.spawn).mock.calls.map(([s]) => s.argv)
  expect(args).toHaveLength(1); expect(args[0]).toEqual(source === 'brew' ? ['/模拟/brew/bin/brew', 'reinstall', 'Tencent-CodeBuddy/tap/codebuddy-code'] : [before.executable, 'update'])
  expect(f.artifactFetch).not.toHaveBeenCalled()
})
it('模拟：未知现有安装失败、无安装进程且记录和 revision 不变', async () => {
  const f = fixture(), before = { ...syntheticIdentity(), source: 'unknown' as const }
  f.identities.set('codex', before); f.config.cliExecutablePaths.setManual('codex', before.executable)
  const revision = f.config.cliExecutablePaths.revision('codex')
  await expect(f.installer.prepare('codex', registry, '', control())).rejects.toThrow('插件不会另装一份')
  expect(f.backend.spawn).not.toHaveBeenCalled(); expect(f.config.cliExecutablePaths.revision('codex')).toBe(revision)
})
it('模拟：更新后发现另一安装时 path 与 revision 不变', async () => {
  const f = fixture(), before = syntheticIdentity(), other = { ...before, executable: '/另一副本/bin/codex', prefix: '/另一副本', manifestVersion: '1.2.3' }
  f.config.cliExecutablePaths.remember('codex', before.executable, 0)
  const revision = f.config.cliExecutablePaths.revision('codex')
  vi.mocked(f.backend.spawn).mockImplementation(spec => { if (spec.argv.includes('install')) f.identities.set('codex', other); return exited() })
  const row = (await checked(f.service)).entries.find(e => e.cli === 'codex')!
  f.service.start('codex', 'update', row.planToken!, '', '模拟-other')
  expect((await finished(f.service)).results[0]).toMatchObject({ phase: 'failed', error: { code: 'IDENTITY_CHANGED' } })
  expect(f.config.cliExecutablePaths.read('codex')?.path).toBe(before.executable); expect(f.config.cliExecutablePaths.revision('codex')).toBe(revision)
})
it('模拟：只读发现不 reset 或 remember 已失效的自动记录', async () => {
  const f = fixture(), old = join(f.root, 'missing'), entry = join(f.root, 'other/lib/node_modules/@openai/codex/bin/codex.js')
  mkdirSync(dirname(entry), { recursive: true }); writeFileSync(entry, '// 模拟')
  writeFileSync(join(dirname(dirname(entry)), 'package.json'), JSON.stringify({ name: '@openai/codex', version: '1.0.0' }))
  f.config.cliExecutablePaths.remember('codex', old, 0); const revision = f.config.cliExecutablePaths.revision('codex')
  vi.mocked(f.backend.resolveExecutable).mockResolvedValue(entry)
  expect(await resolveCliExecutable('codex', f.backend, f.config, control(), { management: true, readOnly: true })).toBe(entry)
  expect(f.config.cliExecutablePaths.read('codex')?.path).toBe(old); expect(f.config.cliExecutablePaths.revision('codex')).toBe(revision)
})
it('模拟：Codex 脚本绑定已核实根，MiMo/OpenCode 未核实自定义根明确拒绝', () => {
  expect(boundOfficialEnv('codex', { ...syntheticIdentity(), executable: '/custom/bin/codex', updateRoot: '/custom/state/packages/standalone' })).toEqual({ CODEX_HOME: '/custom/state', CODEX_INSTALL_DIR: '/custom/bin' })
  for (const cli of ['mimo', 'opencode'] as const) expect(updateProblem(cli, { ...syntheticIdentity(cli), source: 'self-update', executable: '/custom/bin/' + cli }, 'darwin')).toContain('插件不会另装一份')
})
it('模拟：Windows 可见向导装到另一目录，失败且不改原路径记录', async () => {
  const f = fixture('workbuddycn', 'win32'), appPath = 'C:/Original/WorkBuddy', file = join(f.root, '模拟.exe')
  writeFileSync(file, '模拟'); f.config.cliExecutablePaths.setManual('workbuddycn', appPath + '/resources/cli.js')
  const revision = f.config.cliExecutablePaths.revision('workbuddycn'), run = vi.fn(async () => {}), awaiting = vi.fn()
  vi.spyOn(desktopUpdateIo, 'installedPaths').mockResolvedValueOnce([appPath]).mockResolvedValue(['D:/Other/WorkBuddy'])
  await expect(runDesktopUpdate({ cli: 'workbuddycn', appPath, platform: 'win32', root: f.root, signal: control(),
    release: { version: '5.9.3.42398134', url: 'https://download.codebuddy.cn/workbuddy/saas/win32-x64-user/WorkBuddy-win32-x64-user-5.9.3.42398134-fa0a0901.exe', sha256: 'a'.repeat(64) },
    download: async () => file, run, awaiting })).rejects.toThrow('安装程序把新版本装到了 D:/Other/WorkBuddy，原安装 C:/Original/WorkBuddy 未更新')
  expect(run).toHaveBeenCalledWith([file], expect.any(AbortSignal)); expect(awaiting).toHaveBeenCalledOnce()
  expect(f.config.cliExecutablePaths.revision('workbuddycn')).toBe(revision)
})

it.each(['zcode', 'workbuddy', 'workbuddycn'] as const)('模拟：%s 向导完成后读取注册表并按产品身份核实真实目录', async cli => {
  const capture = vi.spyOn(desktopUpdateIo, 'capture').mockResolvedValue(JSON.stringify({ schema: 1, complete: true, records: [{ root: 'D:/实际目录/App' }] }))
  vi.spyOn(pe, 'readPeVersion').mockResolvedValue({ productName: 'ZCode', productVersion: '3.18.2', fileVersion: '3.18.2' } as any)
  vi.spyOn(workbuddy, 'resolveWorkBuddyInstallation').mockResolvedValue({ appRoot: 'D:/实际目录/App', cli } as any)
  const paths = await installedWindowsAppPaths(cli, control())
  expect(paths.map(p => p.replace(/\\/g, '/'))).toEqual(['D:/实际目录/App'])
  const script = capture.mock.calls[0]![0].at(-1)!
  expect(script).toContain('InstallLocation')
  expect(script).toContain(cli === 'zcode' ? '^ZCode' : '^WorkBuddy')
  if (cli === 'zcode') expect(script).not.toContain("-notmatch '^Tencent")
  capture.mockResolvedValue(JSON.stringify({ schema: 1, complete: false, records: [] }))
  await expect(installedWindowsAppPaths(cli, control())).rejects.toThrow('未修改路径记录')
})

const survivingNativeRoots = [
  ['antigravity', 'win32', 'AppData/Local/agy'], ['codex', 'darwin', '.codex/packages/standalone'],
  ['claude', 'darwin', '.local/share/claude/versions'], ['kimi', 'darwin', '.kimi-code/bin'],
  ['mimo', 'win32', '.mimocode/bin'], ['zcode', 'darwin', 'Applications/ZCode.app'],
  ['grok', 'darwin', '.grok/downloads'], ['omp', 'win32', 'AppData/Local/omp'],
  ['pi', 'darwin', '.pi/agent/install'], ['hermes', 'darwin', '.hermes/hermes-agent'],
  ['opencode', 'win32', '.opencode/bin'], ['qoder', 'win32', '.qoder/bin'],
  ['qodercn', 'win32', '.qoder-cn/bin'], ['codebuddy', 'darwin', '.local/share/codebuddy'],
  ['traecn', 'win32', 'AppData/Local/TraeCLI'], ['workbuddycn', 'darwin', 'Applications/WorkBuddy.app'],
  ['workbuddy', 'darwin', 'Applications/WorkBuddy AI.app'],
] as const
it.each(survivingNativeRoots)('模拟：%s 无记录且启动器消失，%s 残留 %s 仍阻止另装', async (cli, platform, relative) => {
  const f = fixture(cli), root = join(f.root, relative)
  f.identities.clear(); mkdirSync(root, { recursive: true })
  vi.stubEnv('LOCALAPPDATA', join(f.root, 'AppData/Local'))
  const installer = new CliInstaller({ ...(f.service as any).deps, platform })
  await expect(installer.prepare(cli, registry, '', control())).rejects.toThrow(root)
  expect(f.backend.spawn).not.toHaveBeenCalled(); expect(f.artifactFetch).not.toHaveBeenCalled()
  expect(f.config.cliExecutablePaths.read(cli)).toBeUndefined(); expect(f.config.cliExecutablePaths.revision(cli)).toBe(0)
})
it('模拟：只有 Codex 账号配置目录且无安装产物，仍可准备首次安装', async () => {
  const f = fixture(); f.identities.clear(); mkdirSync(join(f.root, '.codex'), { recursive: true })
  vi.mocked(f.backend.spawn).mockImplementation(spec => exited(spec.argv.includes('prefix') ? join(f.root, 'fresh-prefix') : 'v22.19.0'))
  const plan = await f.installer.prepare('codex', registry, '', control())
  expect(plan.before).toBeUndefined(); expect(plan.source.method).toBe('npm')
})
it('模拟：Pi 更新失败后的补查进程退出不明，保留维护锁并报告隔离', async () => {
  const f = fixture('pi'), root = join(f.root, '.pi/agent'), executable = join(root, 'bin/pi')
  const before = { ...syntheticIdentity('pi', '1.1.0'), executable, source: 'self-update' as const, updateRoot: root }
  f.identities.set('pi', before); f.config.cliExecutablePaths.setManual('pi', executable)
  const revision = f.config.cliExecutablePaths.revision('pi')
  mkdirSync(join(root, 'install'), { recursive: true }); mkdirSync(join(root, 'bin'), { recursive: true })
  writeFileSync(executable, '模拟启动器'); writeFileSync(join(root, 'install/current-version'), '1.1.0')
  writeFileSync(join(root, 'install/managed-install.json'), JSON.stringify({ kind: 'pi-managed-install', schemaVersion: 1, layout: 'releases-v1' }))
  vi.stubEnv('PATH', join(root, 'bin'))
  let probes = 0
  vi.spyOn(f.releases, 'query').mockResolvedValue({ latest: '1.5.2', versions: ['1.5.2'], checkedAt: Date.now(), registry })
  vi.mocked(f.backend.spawn).mockImplementation(spec => {
    if (spec.argv.includes('prefix')) {
      probes++
      if (probes === 1) return exited(join(f.root, 'npm-global'))
      if (probes === 2) return { ...exited(), done: Promise.resolve({ exitCode: 1, signal: null }) }
      return { ...exited(join(f.root, 'npm-global')), waitForExit: vi.fn(async () => false) }
    }
    return { ...exited(), done: Promise.resolve({ exitCode: 1, signal: null }) }
  })
  const row = (await checked(f.service)).entries.find(e => e.cli === 'pi')!
  f.service.start('pi', 'update', row.planToken!, '', '模拟-cleanup-probe')
  expect((await finished(f.service)).results[0]).toMatchObject({ phase: 'cleanup-unconfirmed', error: { code: 'CLEANUP_UNCONFIRMED' } })
  expect(() => f.config.cliMaintenance.assertAvailable('pi')).toThrow('MAINTENANCE')
  expect(probes).toBe(3); expect(f.cleanup).toHaveBeenCalledWith('pi', expect.any(ProcessCleanupUnconfirmedError))
  expect(f.config.cliExecutablePaths.revision('pi')).toBe(revision)
})
it.each(['unchanged', 'new', 'modified'] as const)('模拟：桌面向导比较既有副本快照：%s', async mode => {
  const f = fixture('zcode'), original = join(f.root, 'Original/ZCode'), other = join(f.root, 'Other/ZCode'), file = join(f.root, 'wizard.exe')
  for (const root of [original, other]) { mkdirSync(join(root, 'resources/app'), { recursive: true }); writeFileSync(join(root, 'resources/app/product.json'), '{"version":"1.0.0"}') }
  writeFileSync(file, '模拟向导')
  vi.spyOn(desktopUpdateIo, 'installedPaths').mockResolvedValueOnce(mode === 'new' ? [original] : [original, other]).mockResolvedValue([original, other])
  const run = vi.fn(async () => { writeFileSync(join(original, 'resources/app/product.json'), '{"version":"1.2.0"}'); if (mode === 'modified') writeFileSync(join(other, 'resources/app/product.json'), '{"version":"1.2.0"}') })
  const pending = runDesktopUpdate({ cli: 'zcode', platform: 'win32', appPath: original, root: f.root, signal: control(),
    release: { version: '3.18.2', url: 'https://cdn-zcode.z.ai/zcode/electron/releases/3.18.2/windows-x64/ZCode-3.18.2-win-x64.exe', sha512: Buffer.alloc(64).toString('base64'), size: 1 }, download: async () => file, run, awaiting: vi.fn() })
  if (mode === 'unchanged') await expect(pending).resolves.toEqual({ appPath: original })
  else await expect(pending).rejects.toMatchObject({ code: 'IDENTITY_CHANGED', message: expect.stringContaining(other) })
})

it.each([
  ['codex', 'CODEX_HOME', 'packages/standalone'], ['codebuddy', 'XDG_DATA_HOME', 'codebuddy'],
  ['hermes', 'HERMES_HOME', 'hermes-agent'], ['omp', 'BUN_INSTALL', 'install/global/node_modules/@oh-my-pi/pi-coding-agent'],
] as const)('模拟：%s 在 %s 指定根残留安装，缺少入口也不另装', async (cli, variable, relative) => {
  const f = fixture(cli), base = join(f.root, 'custom'), root = join(base, relative)
  f.identities.clear(); vi.stubEnv(variable, base); mkdirSync(root, { recursive: true })
  await expect(f.installer.prepare(cli, registry, '', control())).rejects.toThrow(root)
  expect(f.backend.spawn).not.toHaveBeenCalled(); expect(f.artifactFetch).not.toHaveBeenCalled()
})
