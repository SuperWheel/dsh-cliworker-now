import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveWorkBuddyInstallation, WorkBuddyUnavailableError } from '../src/host/workbuddy-installation.ts'
import { workbuddyDesktopCommand } from '../src/host/workbuddy-desktop-open.ts'
import { WORKBUDDY_CLIS, isWorkBuddyCli, workbuddyVariant } from '../src/host/workbuddy-variant.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(options: { platform?: 'darwin' | 'win32'; endpoint?: string; folder?: string; pkg?: string; missing?: string; appName?: string; exe?: string } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'wb-install-simulated-')); roots.push(home)
  const platform = options.platform ?? 'darwin'
  const appRoot = join(home, options.appName ?? 'WorkBuddy.app')
  const cliRoot = join(appRoot, ...(platform === 'darwin' ? ['Contents', 'Resources'] : ['resources']), 'app.asar.unpacked', 'cli')
  const runtime = join(appRoot, ...(platform === 'darwin' ? ['Contents', 'MacOS', 'Electron'] : [options.exe ?? 'WorkBuddy.exe']))
  const entry = join(cliRoot, 'dist', 'codebuddy-lite-wb.mjs')
  await mkdir(join(cliRoot, 'dist'), { recursive: true, mode: 0o700 })
  if (platform === 'darwin') await mkdir(join(appRoot, 'Contents', 'MacOS'), { mode: 0o700 })
  for (const [name, content] of [[runtime, 'simulated, never executed'], [entry, '// 模拟'],
    [join(cliRoot, 'package.json'), JSON.stringify({ name: options.pkg ?? '@genie/agent-cli', version: '2.165.0' })],
    [join(cliRoot, 'product.json'), JSON.stringify({ productName: '模拟 WorkBuddy', endpoint: options.endpoint ?? 'https://www.workbuddy.cn', dataFolderName: options.folder ?? '.workbuddy-test' })]])
    if (!name!.endsWith(options.missing ?? '\0')) await writeFile(name!, content!, { mode: 0o600 })
  return { home, appRoot, runtime, entry, options: { platform, home, candidates: [appRoot] } }
}

describe('模拟 WorkBuddy 安装与版本隔离', () => {
  it('模拟注册两版且不把其他 CLI 当成 WorkBuddy', () => {
    expect(WORKBUDDY_CLIS).toEqual(['workbuddycn', 'workbuddy'])
    expect(isWorkBuddyCli('workbuddycn')).toBe(true)
    expect(isWorkBuddyCli('codebuddy')).toBe(false)
    expect(workbuddyVariant('workbuddy').transport).toBe('workbuddy-acp-v1')
  })
  it('模拟只读解析 macOS 包内 runtime、入口与 product 配置根', async () => {
    const f = await fixture()
    expect(await resolveWorkBuddyInstallation('workbuddycn', f.options)).toMatchObject({ cli: 'workbuddycn', runtime: f.runtime, entry: f.entry, configDir: join(f.home, '.workbuddy-test'), cliVersion: '2.165.0' })
    for (const path of [f.appRoot, f.runtime, f.entry])
      expect((await resolveWorkBuddyInstallation('workbuddycn', { ...f.options, path })).appRoot).toBe(f.appRoot)
  })
  it.each(['https://www.workbuddy.ai', 'https://workbuddy.ai'])('模拟按 endpoint 而非 app 名识别国际版 %s', async endpoint => {
    const f = await fixture({ endpoint, folder: '.custom-global' })
    expect((await resolveWorkBuddyInstallation('workbuddy', f.options)).configDir).toBe(join(f.home, '.custom-global'))
    await expect(resolveWorkBuddyInstallation('workbuddycn', f.options)).rejects.toMatchObject({ reason: 'variant-mismatch' })
  })
  it.each(['../escape', '..', '.folder/child', '.folder\\child', 'workbuddy'])('模拟拒绝配置目录穿越 %s', async folder => {
    const f = await fixture({ folder })
    await expect(resolveWorkBuddyInstallation('workbuddycn', f.options)).rejects.toMatchObject({ reason: 'data-folder-invalid' })
  })
  it.each(['https://www.workbuddy.cn.evil.test', 'http://www.workbuddy.cn', 'https://user:password@www.workbuddy.cn'])('模拟拒绝伪造 endpoint %s', async endpoint => {
    const f = await fixture({ endpoint })
    await expect(resolveWorkBuddyInstallation('workbuddycn', f.options)).rejects.toBeInstanceOf(WorkBuddyUnavailableError)
  })
  it.each(['Electron', 'codebuddy-lite-wb.mjs', 'package.json', 'product.json'])('模拟缺少 %s 时无 PATH 回退', async missing => {
    const f = await fixture({ missing })
    await expect(resolveWorkBuddyInstallation('workbuddycn', f.options)).rejects.toBeInstanceOf(WorkBuddyUnavailableError)
  })
  it('模拟包名不匹配与显式路径失败不回退候选', async () => {
    const invalid = await fixture({ pkg: '@codebuddy/codebuddy-code' }), valid = await fixture()
    await expect(resolveWorkBuddyInstallation('workbuddycn', { ...valid.options, manualPath: invalid.appRoot })).rejects.toMatchObject({ reason: 'package-mismatch' })
  })
  it.each(['WorkBuddy.exe', 'WorkBuddy AI.exe', 'OwnApp.exe'])('模拟 Windows 应用自带 runtime %s', async exe => {
    const f = await fixture({ platform: 'win32', exe, appName: 'WorkBuddy AI' })
    expect((await resolveWorkBuddyInstallation('workbuddycn', f.options)).runtime).toBe(f.runtime)
  })
  it('模拟 unsupported 平台与空候选明确失败', async () => {
    await expect(resolveWorkBuddyInstallation('workbuddy', { platform: 'linux' })).rejects.toMatchObject({ reason: 'platform-unsupported' })
    await expect(resolveWorkBuddyInstallation('workbuddy', { platform: 'darwin', candidates: [] })).rejects.toMatchObject({ reason: 'not-installed' })
  })
})


describe('模拟 WorkBuddy GUI argv and per-action installation verification', () => {
  it('opens the verified macOS app root with argv, no -n or CLI arguments', async () => {
    const f = await fixture({ appName: 'WorkBuddy space;$(no-shell).app' })
    for (const path of [f.appRoot, f.runtime, f.entry])
      expect(await workbuddyDesktopCommand('workbuddycn', { ...f.options, manualPath: path })).toEqual({
        file: '/usr/bin/open', args: [f.appRoot], platform: 'darwin',
      })
    await writeFile(join(f.appRoot, 'Contents/Resources/app.asar.unpacked/cli/product.json'), JSON.stringify({
      productName: 'SIMULATED switched edition', endpoint: 'https://www.workbuddy.ai', dataFolderName: '.SIMULATED-global',
    }))
    await expect(workbuddyDesktopCommand('workbuddycn', f.options)).rejects.toMatchObject({ reason: 'variant-mismatch' })
  })
  it.each(['WorkBuddy.exe', 'WorkBuddy AI.exe'])('opens only the verified Windows GUI %s without CLI flags (unverified on Windows hardware)', async exe => {
    const f = await fixture({ platform: 'win32', exe })
    expect(await workbuddyDesktopCommand('workbuddycn', f.options)).toEqual({ file: f.runtime, args: [], platform: 'win32' })
    const arbitrary = join(f.appRoot, 'arbitrary.exe')
    await writeFile(arbitrary, 'SIMULATED never execute')
    expect(await workbuddyDesktopCommand('workbuddycn', { ...f.options, manualPath: arbitrary })).toEqual({ file: f.runtime, args: [], platform: 'win32' })
  })
  it('refuses an unrecognized Windows GUI entry instead of executing a lone arbitrary binary', async () => {
    const f = await fixture({ platform: 'win32', exe: 'Other.exe' })
    await expect(workbuddyDesktopCommand('workbuddycn', f.options)).rejects.toMatchObject({ reason: 'desktop-entry-unverified' })
  })
})
