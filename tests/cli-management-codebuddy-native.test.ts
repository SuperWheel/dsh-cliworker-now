/** 模拟：路径、版本、进程和更新均为夹具；不访问真实安装，不执行 CLI 或联网。 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync, symlinkSync, unlinkSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { Readable } from 'node:stream'
import { codebuddyNativeLayout } from '../src/host/codebuddy-native-layout.ts'
import { codebuddyEnvironment } from '../src/host/codebuddy-account.ts'
import { classifyInstallation, identifyInstallation, type InstallationIdentity } from '../src/host/cli-management/identity.ts'
import { automaticMethod, operationArgv, planCliOperation, sameInstallation, verifyUpdatedVersion } from '../src/host/cli-management/planner.ts'
import { currentVersion } from '../src/host/cli-management/versions.ts'
import { nativeResidueCandidates } from '../src/host/cli-management/update-residue.ts'
import { isVersionedAutoEntry } from '../src/host/cli-auto-entry.ts'
import { resolveCliExecutable } from '../src/host/adapters.ts'
import { CliExecutablePathStore } from '../src/host/cli-executable-paths.ts'
import { CLI_SOURCES } from '../src/host/cli-management/sources.ts'
import { serviceFixture, checked, finished, control } from './cli-management-phase-b-fixture.ts'

const simulated = vi.hoisted(() => ({ home: '/模拟/home' }))
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => simulated.home }))
const fixtures: ReturnType<typeof serviceFixture>[] = []
beforeEach(() => {
  vi.stubEnv('XDG_DATA_HOME', undefined); vi.stubEnv('LOCALAPPDATA', undefined)
  for (const name of ['CODEBUDDY_AUTH_TOKEN', 'CODEBUDDY_API_KEY', 'CODEBUDDY_API_KEY_HELPER_DISABLED',
    'CODEBUDDY_API_KEY_DISABLED', 'CODEBUDDY_INTERNET_ENVIRONMENT', 'CODEBUDDY_COPILOT_INTERNET_ENVIRONMENT']) vi.stubEnv(name, undefined)
})
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); simulated.home = '/模拟/home' })
const homes = ['/Users/模拟', '/home/模拟', 'C:/Users/模拟']
const layouts = homes.flatMap(home => {
  const win = home.startsWith('C:'), root = `${home}/${win ? 'AppData/Local/codebuddy' : '.local/share/codebuddy'}`
  return [
    { home, root, path: win ? `${root}/bin/codebuddy.exe` : `${home}/.local/bin/codebuddy`, versioned: false },
    { home, root, path: `${root}/${win ? 'Data/' : ''}versions/2.183.0/codebuddy${win ? '.exe' : ''}`, versioned: true },
  ]
})
function identity(path: string, home: string): InstallationIdentity {
  return { executable: path, fingerprint: { realpath: path, size: 10, mtimeMs: 1 }, ...classifyInstallation('codebuddy', path, undefined, home) }
}
it.each(layouts)('模拟：官方原生 $path 识别、迁移标记与官方更新 argv', async ({ home, root, path, versioned }) => {
  const id = identity(path, home)
  expect(id).toMatchObject({ source: 'self-update', updateRoot: root })
  expect(automaticMethod('codebuddy', id)).toBe('self-update')
  expect(isVersionedAutoEntry('codebuddy', path, home)).toBe(versioned)
  const plan = planCliOperation('codebuddy', 'update', id, '2.183.0', '2.184.0', '')
  expect(plan.pinsVersion).toBe(false)
  expect(await operationArgv(plan, {} as any)).toEqual([path, 'update'])
})
it('模拟：Windows 大小写与分隔符、环境根按官方规则处理', () => {
  const home = 'C:/Users/模拟', path = 'c:\\users\\模拟\\APPDATA\\LOCAL\\CODEBUDDY\\DATA\\VERSIONS\\2.184.0\\CODEBUDDY.EXE'
  expect(identity(path, home).source).toBe('self-update')
  expect(isVersionedAutoEntry('codebuddy', path, home)).toBe(true)
  expect(codebuddyNativeLayout('D:/Local/codebuddy/bin/codebuddy.exe', home, { LOCALAPPDATA: 'D:\\Local' })?.root).toBe('D:/Local/codebuddy')
  expect(codebuddyNativeLayout('/custom/data/codebuddy/versions/2.184.0/codebuddy', '/home/模拟', { XDG_DATA_HOME: '/custom/data' })?.stableEntry).toBe('/custom/bin/codebuddy')
  expect(codebuddyNativeLayout('/custom/data/codebuddy/versions/2.184.0/codebuddy', '/home/模拟', {})).toBeUndefined()
  expect(codebuddyNativeLayout('/home/模拟/.local/bin/codebuddy', '/home/模拟', { XDG_DATA_HOME: 'relative' })).toBeUndefined()
})
it.each([
  '.local/bin/codebuddy-lite', '.local/bin/CodeBuddy', '.codebuddy/bin/codebuddy',
  '.local/share/codebuddy-other/versions/2.184.0/codebuddy', '.local/share/codebuddy/versions/2.184.0',
  '.local/share/codebuddy/versions/2.184.0/codebuddy.old', '.local/share/codebuddy/versions/2.184.0/codebuddy-lite-wb.mjs',
  '.local/share/codebuddy/versions/2.184.0/nested/codebuddy', '.local/share/codebuddy/versions/../codebuddy',
  '.local/share/codebuddy/versions/latest/codebuddy', '.local/share/codebuddy/versions/2.184.0/../codebuddy',
  '.local/share/codebuddy/versions/2.184.0-../codebuddy', '.local/share/codebuddy/versions/2.184.0-01/codebuddy',
  '.local/share/codebuddy/versions/02.184.0/codebuddy',
  'AppData/Local/codebuddy/bin/codebuddy.exe', '.local/share/CodeBuddy/versions/2.184.0/codebuddy',
])('模拟：近似 Unix 路径 %s 不赋予原生更新资格', relative => {
  const home = '/home/模拟', path = `${home}/${relative}`
  expect(identity(path, home).source).toBe('unknown')
  expect(isVersionedAutoEntry('codebuddy', path, home)).toBe(false)
})
it.each([
  'codebuddy/bin/codebuddy-lite.exe', 'codebuddy/Data/versions/2.184.0/codebuddy.exe.old',
  'codebuddy/versions/2.184.0/codebuddy.exe', 'codebuddy/Data/versions/2.184.0/codebuddy',
  'codebuddy-other/bin/codebuddy.exe', 'WorkBuddy/resources/app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs',
])('模拟：近似 Windows 路径 %s 无 CodeBuddy 自更新', relative => {
  const id = identity(`C:/Users/模拟/AppData/Local/${relative}`, 'C:/Users/模拟')
  expect(automaticMethod('codebuddy', id)).toBeUndefined()
})
it('模拟：其他用户、CLI 与 WorkBuddy 内置入口不能套用原生规则', () => {
  const path = '/home/模拟/.local/share/codebuddy/versions/2.184.0/codebuddy'
  expect(identity(path, '/home/other').source).toBe('unknown')
  for (const cli of ['omp', 'kimi', 'workbuddy', 'workbuddycn'] as const) {
    expect(classifyInstallation(cli, path, undefined, '/home/模拟').source).toBe('unknown')
    expect(isVersionedAutoEntry(cli, path, '/home/模拟')).toBe(false)
  }
  const embedded = identity('/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs', '/home/模拟')
  expect(automaticMethod('codebuddy', embedded)).toBeUndefined()
})
it.each([
  ['/opt/homebrew/lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy', '/opt/homebrew/bin/codebuddy', '/Users/模拟'],
  ['C:/Users/模拟/AppData/Roaming/npm/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy', 'C:/Users/模拟/AppData/Roaming/npm/codebuddy.cmd', 'C:/Users/模拟'],
])('模拟：npm %s 保持 npm', (path, selected, home) => {
  const id = { ...identity(path, home), ...classifyInstallation('codebuddy', path, CLI_SOURCES.codebuddy.npm, home, selected) }
  expect(id.source).toBe('npm'); expect(automaticMethod('codebuddy', id)).toBe('npm')
})
it.each(homes)('模拟：%s 同根版本迁移与稳定复制，跨根/来源/通道/入口拒绝', home => {
  const [stable, versioned] = layouts.filter(l => l.home === home)
  const old = identity(versioned!.path, home), next = identity(versioned!.path.replace('2.183.0', '2.184.0'), home)
  expect(sameInstallation(old, next, 'codebuddy')).toBe(true)
  expect(sameInstallation(old, identity(stable!.path, home), 'codebuddy')).toBe(true)
  const linked = { ...old, executable: stable!.path }
  expect(sameInstallation(linked, { ...next, executable: stable!.path }, 'codebuddy')).toBe(true)
  expect(sameInstallation(linked, { ...linked, fingerprint: { ...linked.fingerprint, size: 20, mtimeMs: 2 } }, 'codebuddy')).toBe(true)
  for (const bad of [
    { ...next, updateRoot: `${next.updateRoot}-other` }, { ...next, source: 'npm' as const },
    { ...next, channel: 'other' }, { ...next, executable: `${next.executable}.old` },
    { ...next, fingerprint: { ...next.fingerprint, realpath: '/outside/codebuddy' } },
  ]) expect(sameInstallation(linked, bad, 'codebuddy')).toBe(false)
  const plan = planCliOperation('codebuddy', 'update', old, '2.183.0', '2.184.0', '')
  expect(() => verifyUpdatedVersion(plan, '2.183.0')).toThrow('VERSION_UNCHANGED')
  expect(() => verifyUpdatedVersion(plan, '2.184.0')).not.toThrow()
})

function fixture() {
  const f = serviceFixture(['codebuddy']); fixtures.push(f); simulated.home = f.root
  const file = (path: string, content = '# 模拟 binary; never executed') => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content, { mode: 0o700 }); return path }
  const old = file(join(f.root, '.local/share/codebuddy/versions/1.0.0/codebuddy'))
  const entry = join(f.root, '.local/bin/codebuddy'); mkdirSync(dirname(entry), { recursive: true }); symlinkSync(old, entry)
  const store = new CliExecutablePathStore(join(f.root, 'paths')); f.config.cliExecutablePaths = store
  vi.mocked(f.backend.resolveExecutable).mockImplementation(async name => { const path = isAbsolute(name) ? name : entry; if (!statSync(path).isFile()) throw new Error('模拟 missing'); return path })
  return { ...f, file, old, entry, store }
}
it.each([false, true])('模拟：旧 auto 实体已删除=%s 时同根稳定入口优先于 PATH 中 npm', async removed => {
  const f = fixture(); f.store.remember('codebuddy', f.old, 0)
  const next = f.file(f.old.replace('1.0.0', '1.2.3')); unlinkSync(f.entry); symlinkSync(next, f.entry)
  if (removed) unlinkSync(f.old)
  vi.mocked(f.backend.resolveExecutable).mockImplementation(async name => isAbsolute(name) ? name : '/other/npm/codebuddy')
  const id = await identifyInstallation('codebuddy', f.backend, f.config, control())
  expect(id).toMatchObject({ executable: f.entry, source: 'self-update', fingerprint: { realpath: next } })
  expect(f.store.read('codebuddy')).toEqual({ mode: 'auto', path: f.old })
  expect(f.backend.spawn).not.toHaveBeenCalled()
})
it('模拟：首次 PATH 为版本实体也记录稳定入口，后台旧记录不查 PATH', async () => {
  const f = fixture(); f.store.remember('codebuddy', f.old, 0)
  expect(await identifyInstallation('codebuddy', f.backend, f.config, control(), true)).toBeUndefined()
  expect(f.backend.resolveExecutable).not.toHaveBeenCalled()
  f.store.reset('codebuddy'); vi.mocked(f.backend.resolveExecutable).mockResolvedValue(f.old)
  expect(await resolveCliExecutable('codebuddy', f.backend, f.config, control())).toBe(f.entry)
  expect(f.store.read('codebuddy')?.path).toBe(f.entry)
})
it.each(['manual', 'deployment'] as const)('模拟：%s 原生实体不迁移', async mode => {
  const f = fixture()
  if (mode === 'manual') f.store.setManual('codebuddy', f.old)
  else f.config.codebuddyExecutable = f.old
  expect(await resolveCliExecutable('codebuddy', f.backend, f.config, control())).toBe(f.old)
  expect(f.store.read('codebuddy')?.path).toBe(mode === 'manual' ? f.old : undefined)
})
it('模拟：稳定入口越界或缺失不覆盖记录，并发手动修改不被迁移覆盖', async () => {
  const f = fixture(); f.store.remember('codebuddy', f.old, 0); unlinkSync(f.entry)
  await expect(resolveCliExecutable('codebuddy', f.backend, f.config, control())).rejects.toThrow()
  expect(f.store.read('codebuddy')?.path).toBe(f.old)
  const outside = f.file(join(f.root, 'other/codebuddy')); symlinkSync(outside, f.entry)
  await expect(resolveCliExecutable('codebuddy', f.backend, f.config, control())).rejects.toThrow('稳定入口已改变')
  expect(f.store.read('codebuddy')?.path).toBe(f.old)
  unlinkSync(f.entry); symlinkSync(f.old, f.entry)
  vi.mocked(f.backend.resolveExecutable).mockImplementation(async () => { f.store.setManual('codebuddy', outside); return f.entry })
  await expect(resolveCliExecutable('codebuddy', f.backend, f.config, control())).rejects.toThrow('路径已更新')
  expect(f.store.read('codebuddy')).toEqual({ mode: 'manual', path: outside })
})
it.each(['relink', 'replace-realpath'] as const)('模拟：服务更新 %s 后重新核对版本，保留旧目录', async mode => {
  const f = fixture(); f.store.remember('codebuddy', f.old, 0)
  let version = '1.0.0'
  f.identify.mockImplementation(async () => identifyInstallation('codebuddy', f.backend, f.config, control()))
  f.version.mockImplementation(async () => version)
  const row = (await checked(f.service)).entries.find(e => e.cli === 'codebuddy')!
  expect(row).toMatchObject({ source: 'self-update', group: 'updatable' })
  vi.mocked(f.backend.spawn).mockImplementation(command => {
    expect(command.argv).toEqual([f.entry, 'update'])
    version = '1.2.3'
    if (mode === 'relink') { const next = f.file(f.old.replace('1.0.0', version)); unlinkSync(f.entry); symlinkSync(next, f.entry) }
    else f.file(f.old, '# 模拟 new binary in old version directory')
    return { stdout: Readable.from([]), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), waitForExit: vi.fn(async () => true), terminate: vi.fn() } as any
  })
  f.service.start('codebuddy', 'update', row.planToken!, '', `模拟-${mode}`)
  expect((await finished(f.service)).results[0]).toMatchObject({ phase: 'succeeded', afterVersion: version })
  expect(f.store.read('codebuddy')?.path).toBe(f.entry)
  expect(statSync(f.old).isFile()).toBe(true)
  expect(await nativeResidueCandidates('codebuddy', { home: f.root })).toEqual([])
})
it('模拟：版本探针禁止后台自动升级且不从目录名取版本', async () => {
  vi.stubEnv('CODEBUDDY_AUTH_TOKEN', 'SIMULATED_VERSION_TOKEN')
  const f = fixture(), id = await identifyInstallation('codebuddy', f.backend, f.config, control())
  vi.mocked(f.backend.spawn).mockImplementation(() => ({ stdout: Readable.from(['2.184.0']), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), waitForExit: vi.fn(async () => true), terminate: vi.fn() } as any))
  expect(await currentVersion('codebuddy', id!, f.backend, f.config, control())).toBe('2.184.0')
  expect(f.backend.spawn).toHaveBeenCalledWith(expect.objectContaining({ argv: [f.entry, '--version'], env: codebuddyEnvironment() }))
  expect(vi.mocked(f.backend.spawn).mock.calls.some(([spec]) => spec.env?.CODEBUDDY_AUTH_TOKEN === 'SIMULATED_VERSION_TOKEN')).toBe(true)
})
it('模拟：稳定入口恰为 npm 符号链接时仍按 npm 分类', async () => {
  const f = fixture(), pkg = join(f.root, 'lib/node_modules/@tencent-ai/codebuddy-code')
  const npm = f.file(join(pkg, 'bin/codebuddy'))
  f.file(join(pkg, 'package.json'), JSON.stringify({ name: CLI_SOURCES.codebuddy.npm, version: '2.184.0' }))
  unlinkSync(f.entry); symlinkSync(npm, f.entry)
  const id = await identifyInstallation('codebuddy', f.backend, f.config, control())
  expect(id?.source).toBe('npm'); expect(automaticMethod('codebuddy', id!)).toBe('npm')
  expect(f.store.read('codebuddy')).toBeUndefined()
})
it('模拟：手动别名不变且实体仍在原生根内，可通过更新后身份核对', () => {
  const before = { ...identity('/home/模拟/.local/share/codebuddy/versions/2.183.0/codebuddy', '/home/模拟'), executable: '/usr/local/bin/custom-codebuddy' }
  const after = { ...before, fingerprint: { ...before.fingerprint, realpath: '/home/模拟/.local/share/codebuddy/versions/2.184.0/codebuddy' } }
  expect(sameInstallation(before, after, 'codebuddy')).toBe(true)
  expect(sameInstallation(before, { ...after, executable: '/other/custom-codebuddy' }, 'codebuddy')).toBe(false)
})
