/** 模拟：官方布局、发布源、分发器更新与进程退出回执；不运行真实 CLI、不联网。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { classifyInstallation, identifyInstallation } from '../src/host/cli-management/identity.ts'
import { operationArgv, automaticMethod, sameInstallation } from '../src/host/cli-management/planner.ts'
import type { InstallationIdentity } from '../src/host/cli-management/identity.ts'
import { isVersionedAutoEntry } from '../src/host/cli-auto-entry.ts'
import { executeCliOperation } from '../src/host/cli-management/executor.ts'
import { serviceFixture, control, checked, syntheticIdentity } from './cli-management-phase-b-fixture.ts'

const simulated = vi.hoisted(() => ({ home: undefined as string | undefined }))
vi.mock('node:os', async importOriginal => {
  const original = await importOriginal<typeof import('node:os')>()
  return { ...original, homedir: () => simulated.home ?? original.homedir() }
})
const fixtures: ReturnType<typeof serviceFixture>[] = []
function fixture(cli: 'qoder' | 'qodercn' | 'grok' = 'qoder') {
  const f = serviceFixture([cli]); fixtures.push(f); simulated.home = f.root; return f
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); simulated.home = undefined; vi.restoreAllMocks() })
const entries = { qoder: '.qoder/entry/qoder', qodercn: '.qoder-cn/entry/qodercn' } as const

it.each(['qoder', 'qodercn'] as const)('模拟：%s 官方分发脚本可检查更新、生成并执行记录入口 argv', async cli => {
  const f = fixture(cli), executable = join(f.root, entries[cli])
  mkdirSync(join(executable, '..'), { recursive: true })
  writeFileSync(executable, '#!/bin/bash\n# 模拟 Qoder Command Dispatcher，不执行\n', { mode: 0o700 })
  f.config.cliExecutablePaths = { read: () => ({ mode: 'manual', path: executable }) } as any
  const identity = await identifyInstallation(cli, f.backend, f.config, control())
  expect(identity).toMatchObject({ source: 'self-update', executable, fingerprint: { realpath: executable } })
  f.identities.set(cli, { ...identity!, manifestVersion: '1.0.0' })
  expect((await checked(f.service)).entries.find(e => e.cli === cli)).toMatchObject({ source: 'self-update', group: 'updatable', currentVersion: '1.0.0' })
  const plan = await f.service.planCliOperation(cli, 'update', control())
  expect(plan.method).toBe('self-update')
  const argv = await operationArgv(plan, f.backend)
  expect(argv).toEqual([executable, 'update'])
  await executeCliOperation(f.backend, f.config, argv, control(), () => {})
  expect(f.backend.spawn).toHaveBeenCalledWith(expect.objectContaining({ argv: [executable, 'update'], cwd: f.root, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' } }))
})

it.each([
  ['qoder', '.qoder/entry/other'], ['qoder', '.qoder/entry/qoder-other'],
  ['qoder', '.qoder/entry/qoder/nested'], ['qoder', '.qoder-other/entry/qoder'],
  ['qoder', '.qoder-cn/entry/qodercn'], ['qodercn', '.qoder-cn/entry/other'],
  ['qodercn', '.qoder-cn/entry/qodercn-other'], ['qodercn', '.qoder/entry/qoder'],
] as const)('模拟：%s 非官方分发入口 %s 保持 unknown', (cli, entry) => {
  expect(classifyInstallation(cli, `/模拟/home/${entry}`, undefined, '/模拟/home').source).toBe('unknown')
})
it('模拟：其他 home 下的同名 Qoder 入口保持 unknown', () => {
  expect(classifyInstallation('qoder', '/模拟/home-other/.qoder/entry/qoder', undefined, '/模拟/home').source).toBe('unknown')
})
it('模拟：Grok 官方 bin 符号链接指向 downloads，使用官方 stable 源自动更新', async () => {
  const f = fixture('grok'), executable = join(f.root, '.grok/bin/grok'), target = join(f.root, '.grok/downloads/grok-1.0.62-macos-aarch64')
  mkdirSync(join(executable, '..'), { recursive: true }); mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, '#!/bin/sh\n# 模拟 Grok，不执行\n', { mode: 0o700 }); symlinkSync(target, executable)
  f.config.cliExecutablePaths = { read: () => ({ mode: 'manual', path: executable }) } as any
  const identity = await identifyInstallation('grok', f.backend, f.config, control())
  expect(identity).toMatchObject({ source: 'self-update', executable, fingerprint: { realpath: target } })
  f.identities.set('grok', { ...identity!, manifestVersion: '1.0.62' })
  expect((await checked(f.service)).entries.find(e => e.cli === 'grok')).toMatchObject({ source: 'self-update', group: 'updatable', currentVersion: '1.0.62' })
  expect(f.metadataFetch).toHaveBeenCalled(); expect(f.backend.spawn).not.toHaveBeenCalled()
})
it.each([
  ['/模拟/home/.grok/downloads/grok', '/模拟/home/.grok/bin/other'],
  ['/模拟/home/.grok/downloads-other/grok', '/模拟/home/.grok/bin/grok'],
  ['/模拟/home-other/.grok/downloads/grok', '/模拟/home/.grok/bin/grok'],
  ['/模拟/home/.grok/downloads/grok', undefined],
] as const)('模拟：Grok downloads 必须同时匹配完整目录和记录入口（%s / %s）', (target, selected) => {
  expect(classifyInstallation('grok', target, undefined, '/模拟/home', selected).source).toBe('unknown')
})
it.each(['qoder', 'qodercn'] as const)('模拟：%s 主目录 update 文件、目录或断链阻止进程启动', async cli => {
  const f = fixture(cli), argv = [join(f.root, entries[cli]), 'update']
  // Each fixture has an independent home; no real home or CLI is touched.
  for (const kind of ['file', 'directory', 'symlink']) {
    const collision = join(f.root, 'update')
    if (kind === 'file') writeFileSync(collision, '模拟')
    else if (kind === 'directory') mkdirSync(collision)
    else symlinkSync(join(f.root, '模拟不存在'), collision)
    await expect(executeCliOperation(f.backend, f.config, argv, control(), () => {})).rejects.toThrow('主目录中存在名为 update')
    expect(f.backend.spawn).not.toHaveBeenCalled()
    rmSync(collision, { recursive: true, force: true })
  }
})
it('模拟：指向官方分发器的别名也检查 update 冲突', async () => {
  const f = fixture(), dispatcher = join(f.root, entries.qoder), alias = join(f.root, 'alias')
  mkdirSync(join(dispatcher, '..'), { recursive: true }); writeFileSync(dispatcher, '# 模拟'); symlinkSync(dispatcher, alias)
  mkdirSync(join(f.root, 'update'))
  await expect(executeCliOperation(f.backend, f.config, [alias, 'update'], control(), () => {})).rejects.toThrow('PREREQUISITE_MISSING')
  expect(f.backend.spawn).not.toHaveBeenCalled()
})
it('模拟：直接 qodercli 实体不受分发器同名路径限制', async () => {
  const f = fixture(), executable = join(f.root, '.qoder/bin/qodercli/qodercli')
  mkdirSync(join(executable, '..'), { recursive: true }); writeFileSync(executable, '# 模拟实体，不执行')
  mkdirSync(join(f.root, 'update'))
  await executeCliOperation(f.backend, f.config, [executable, 'update'], control(), () => {})
  expect(f.backend.spawn).toHaveBeenCalledWith(expect.objectContaining({ argv: [executable, 'update'], cwd: f.root }))
})

// 2026-11-14 Windows 实机布局（路径为模拟字符串，不访问文件系统）
const winHome = 'C:\\Users\\admin'
it.each([
  ['claude', 'C:/Users/admin/.local/bin/claude.exe'],
  ['antigravity', 'C:/Users/admin/AppData/Local/agy/bin/agy.EXE'],
  ['omp', 'C:/Users/admin/AppData/Local/omp/omp.exe'],
] as const)('模拟：Windows %s 官方安装入口识别为自带更新', (cli, path) => {
  const id = classifyInstallation(cli, path, undefined, winHome)
  expect(id).toEqual({ source: 'self-update', updateRoot: path })
  expect(automaticMethod(cli, { ...syntheticIdentity(cli), ...id })).toBe('self-update')
})
it('模拟：Windows 路径规则不套到 macOS，macOS 的 agy 仍区分大小写', () => {
  expect(classifyInstallation('omp', '/Users/a/AppData/Local/omp/omp.exe', undefined, '/Users/a').source).toBe('unknown')
  expect(classifyInstallation('antigravity', '/Users/a/.local/bin/AGY', undefined, '/Users/a').source).toBe('unknown')
  expect(classifyInstallation('claude', 'C:/Users/admin/Downloads/claude.exe', undefined, winHome).source).toBe('unknown')
})
it('模拟：Windows TRAE 版本目录为自带更新，自动入口按版本目录重新发现', () => {
  const path = 'C:/Users/admin/AppData/Local/TraeCLI/releases/0.213.1-x86_64-pc-windows-msvc/traex.exe'
  expect(classifyInstallation('traecn', path, undefined, winHome)).toEqual({ source: 'self-update', updateRoot: 'C:/Users/admin/AppData/Local/TraeCLI' })
  expect(isVersionedAutoEntry('traecn', path.replace(/\//g, '\\'), winHome)).toBe(true)
  expect(isVersionedAutoEntry('traecn', 'C:\\Users\\admin\\AppData\\Local\\Programs\\TraeCLI\\bin\\traecli.cmd', winHome)).toBe(false)
})
it.each(['executable', 'prefix', 'packageRoot', 'realpath'] as const)('模拟：Windows 安装身份的 %s 忽略大小写与分隔符，拒绝不同路径', field => {
  const path = 'C:\\Users\\admin\\AppData\\Local\\agy\\bin\\agy.EXE'
  const before: InstallationIdentity = { source: 'self-update', executable: path, prefix: 'C:\\Users\\admin', packageRoot: 'C:\\Users\\admin\\AppData\\Local\\agy', fingerprint: { realpath: path, size: 10, mtimeMs: 100 } }
  const original = field === 'realpath' ? before.fingerprint.realpath : before[field]!
  const withPath = (value: string): InstallationIdentity => field === 'realpath' ? { ...before, fingerprint: { ...before.fingerprint, realpath: value } } : { ...before, [field]: value }
  const changed = original.replace(/\\/g, '/').toLowerCase()
  expect(sameInstallation(before, withPath(changed), 'antigravity')).toBe(true)
  expect(sameInstallation(withPath(changed), before, 'antigravity')).toBe(true)
  expect(sameInstallation(before, withPath(changed + '-other'), 'antigravity')).toBe(false)
  expect(sameInstallation(before, { ...withPath(changed), source: 'unknown' }, 'antigravity')).toBe(false)
})
it.each(['executable', 'prefix', 'packageRoot', 'realpath'] as const)('模拟：POSIX 安装身份的 %s 保持大小写与分隔符精确匹配', field => {
  const before = { ...syntheticIdentity('codex'), prefix: '/Users/admin' }
  const original = field === 'realpath' ? before.fingerprint.realpath : before[field]!
  for (const value of [original.toUpperCase(), original.replace(/\//g, '\\')]) {
    const after = field === 'realpath' ? { ...before, fingerprint: { ...before.fingerprint, realpath: value } } : { ...before, [field]: value }
    expect(sameInstallation(before, after, 'codex')).toBe(false)
  }
})
it.each(['windows', 'posix'] as const)('模拟：稳定更新根按 %s 路径规则比较，保持来源和通道校验', platform => {
  const path = platform === 'windows' ? 'C:\\Users\\admin\\AppData\\Local\\agy\\bin\\agy.EXE' : '/Users/admin/.local/bin/agy'
  const before: InstallationIdentity = { executable: path, updateRoot: path, source: 'self-update', channel: 'public', fingerprint: { realpath: path, size: 10, mtimeMs: 100 } }
  const changed = platform === 'windows' ? path.replace(/\\/g, '/').toLowerCase() : path.toUpperCase()
  // 不同版本实体强制走 updateRoot 分支，避免通用分支掩盖根路径误判。
  const after = { ...before, executable: changed, updateRoot: changed, fingerprint: { ...before.fingerprint, realpath: path + '-new' } }
  expect(sameInstallation(before, after, 'antigravity')).toBe(platform === 'windows')
  expect(sameInstallation(before, { ...after, updateRoot: changed + '-other' }, 'antigravity')).toBe(false)
  expect(sameInstallation(before, { ...after, source: 'unknown' }, 'antigravity')).toBe(false)
  expect(sameInstallation(before, { ...after, channel: 'internal' }, 'antigravity')).toBe(false)
  expect(sameInstallation(before, { ...after, executable: path }, 'antigravity')).toBe(platform === 'windows')
})
it.each([['qoder', '.qoder', 'qodercli'], ['qodercn', '.qoder-cn', 'qoderclicn']] as const)('模拟：%s Windows 自动入口记录带版本的 exe，更新只换版本号时仍是同一安装', (cli, dir, bin) => {
  const root = `C:/Users/admin/${dir}/bin`
  const at = (file: string, patch: Partial<InstallationIdentity> = {}): InstallationIdentity => ({
    ...syntheticIdentity(cli), source: 'self-update', updateRoot: root, executable: `C:\\Users\\admin\\${dir}\\bin\\${bin}\\${file}`, ...patch })
  expect(sameInstallation(at(`${bin}-1.1.73.exe`), at(`${bin}-1.1.89.exe`), cli)).toBe(true)
  expect(sameInstallation(at(`${bin}-1.1.73.exe`), at(`${bin.toUpperCase()}-1.1.89.EXE`, { updateRoot: root.toUpperCase() }), cli)).toBe(true)
  expect(sameInstallation(at(`${bin}-1.1.73.exe`), at('other-1.1.89.exe'), cli)).toBe(false)
  expect(sameInstallation(at(`${bin}-1.1.73.exe`), at(`${bin}-1.1.89.exe`, { updateRoot: 'C:/Users/admin/other/bin' }), cli)).toBe(false)
  expect(sameInstallation(at(`${bin}-1.1.73.exe`), at(`${bin}-1.1.89.exe`, { source: 'npm' }), cli)).toBe(false)
  expect(sameInstallation(at(`${bin}-1.1.73.exe`), { ...at(''), executable: `C:\\Users\\admin\\${dir}\\bin\\x\\${bin}-1.1.89.exe` }, cli)).toBe(false)
  expect(sameInstallation(at(`${bin}-1.1.73.exe`), at(`${bin}-1.1.89.exe`), cli === 'qoder' ? 'qodercn' : 'qoder')).toBe(false)
})
it('模拟：TRAE 更新只换 releases/<版本> 一层时仍是同一安装', () => {
  const root = 'C:/Users/admin/AppData/Local/TraeCLI'
  const at = (version: string, file = 'traex.exe', patch: Partial<InstallationIdentity> = {}): InstallationIdentity => ({
    ...syntheticIdentity('traecn'), source: 'self-update', updateRoot: root, channel: 'public',
    executable: `C:\\Users\\admin\\AppData\\Local\\TraeCLI\\releases\\${version}-x86_64-pc-windows-msvc\\${file}`, ...patch })
  expect(sameInstallation(at('0.213.1'), at('0.215.0'), 'traecn')).toBe(true)
  expect(sameInstallation(at('0.213.1'), at('0.215.0', 'TRAEX.EXE', {
    updateRoot: root.toUpperCase().replace(/\//g, '\\'),
    executable: `${root.toUpperCase()}/RELEASES/0.215.0-x86_64-pc-windows-msvc/TRAEX.EXE`,
  }), 'traecn')).toBe(true)
  expect(sameInstallation(at('0.213.1'), at('0.215.0', 'other.exe'), 'traecn')).toBe(false)
  expect(sameInstallation(at('0.213.1'), at('0.215.0', 'traex.exe', { channel: 'internal' }), 'traecn')).toBe(false)
  expect(sameInstallation(at('0.213.1'), at('0.215.0', 'traex.exe', { updateRoot: 'C:/Other/TraeCLI' }), 'traecn')).toBe(false)
  expect(sameInstallation(at('0.213.1'), { ...at('0.215.0'), executable: 'C:\\Users\\admin\\AppData\\Local\\TraeCLI\\releases\\x\\y\\traex.exe' }, 'traecn')).toBe(false)
  expect(sameInstallation({ ...at('0.213.1') }, { ...at('0.215.0') }, 'grok')).toBe(false)
})
