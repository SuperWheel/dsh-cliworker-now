/** 模拟：官方布局、发布源、分发器更新与进程退出回执；不运行真实 CLI、不联网。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { classifyInstallation, identifyInstallation } from '../src/host/cli-management/identity.ts'
import { operationArgv } from '../src/host/cli-management/planner.ts'
import { executeCliOperation } from '../src/host/cli-management/executor.ts'
import { serviceFixture, control, checked } from './cli-management-phase-b-fixture.ts'

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
