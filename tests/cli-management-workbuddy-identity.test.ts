/** 模拟：临时安装文件与发布响应，不读真实账号、不执行 CLI 或 PowerShell、不联网。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { identifyInstallation, fingerprintToken } from '../src/host/cli-management/identity.ts'
import { currentVersion } from '../src/host/cli-management/versions.ts'
import { serviceFixture, control } from './cli-management-phase-b-fixture.ts'

const fixtures: ReturnType<typeof serviceFixture>[] = []
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); vi.restoreAllMocks() })
function fixture(cli: 'workbuddycn' | 'workbuddy' = 'workbuddycn', version: unknown = '5.9.3', platform = 'win32') {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
  const f = serviceFixture([cli]); fixtures.push(f)
  const app = join(f.root, platform === 'darwin' ? '模拟 WorkBuddy.app' : '模拟 WorkBuddy with spaces')
  const resources = join(app, ...(platform === 'darwin' ? ['Contents', 'Resources'] : ['resources']))
  const cliRoot = join(resources, 'app.asar.unpacked', 'cli'), entry = join(cliRoot, 'dist/codebuddy-lite-wb.mjs')
  const file = (path: string, text: string) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text) }
  file(entry, '// 模拟：never execute')
  file(join(app, platform === 'darwin' ? 'Contents/MacOS/Electron' : 'WorkBuddy.exe'), '模拟：never execute')
  file(join(cliRoot, 'package.json'), JSON.stringify({ name: '@genie/agent-cli', version: '2.165.0' }))
  const product = (genieVersion: unknown, endpoint = cli === 'workbuddycn' ? 'https://www.workbuddy.cn' : 'https://www.workbuddy.ai') =>
    file(join(cliRoot, 'product.json'), JSON.stringify({ productName: '模拟 WorkBuddy', dataFolderName: '.simulated-workbuddy', endpoint, genieVersion }))
  product(version)
  Object.assign(f.config, { [cli === 'workbuddycn' ? 'workbuddycnExecutable' : 'workbuddyExecutable']: entry })
  const identify = () => identifyInstallation(cli, f.backend, f.config, control(), true)
  f.identify.mockImplementation(identify)
  f.version.mockImplementation((id, identity) => currentVersion(id, identity, f.backend, f.config, control(), true))
  f.backend.spawn = vi.fn(() => { throw new Error('模拟：禁止启动任何进程') })
  f.backend.resolveExecutable = vi.fn(async () => { throw new Error('模拟：禁止 PATH 发现') })
  f.metadataFetch.mockResolvedValue(new Response(null, { status: 204 }))
  return { ...f, cli, app, resources, entry, file, product, identify }
}

it.each(['workbuddycn', 'workbuddy'] as const)('模拟 Windows %s：仅有 ASAR 布局时读取产品应用版本，204 显示最新', async cli => {
  const f = fixture(cli)
  const identity = await f.identify()
  expect(identity).toMatchObject({ appPath: f.app, source: 'desktop-app', manifestVersion: '2.165.0', fingerprint: { appVersion: '5.9.3' } })
  await (f.service as any).local(cli, control(), true, false)
  await (f.service as any).remote(cli, control(), true)
  expect(f.service.snapshot().entries.find(e => e.cli === cli)).toMatchObject({ group: 'latest', currentVersion: '2.165.0', appVersion: '5.9.3', latestVersion: '5.9.3', manual: undefined })
  expect(String(f.metadataFetch.mock.calls[0]![0])).toContain('version=5.9.3')
  expect(f.backend.spawn).not.toHaveBeenCalled(); expect(f.backend.resolveExecutable).not.toHaveBeenCalled()
})
it.each([undefined, null, 593, '', '5.9', '05.9.3', '5.9.3-beta', 'x'.repeat(128)])('模拟 Windows：无有效 genieVersion (%s) 不拿 CLI 版本冒充应用版本', async version => {
  const f = fixture(); f.product(version)
  expect((await f.identify())?.fingerprint.appVersion).toBeUndefined()
  await (f.service as any).local(f.cli, control(), true, false)
  await (f.service as any).remote(f.cli, control(), true)
  expect(f.service.snapshot().entries.find(e => e.cli === f.cli)).toMatchObject({ group: 'manual', manual: { note: '无法核实桌面应用目录或版本，请先修复原安装。' } })
  expect(f.metadataFetch).not.toHaveBeenCalled(); expect(f.backend.spawn).not.toHaveBeenCalled()
})
it('模拟 Windows：产品版本变化使指纹变化，四段版本仍有效', async () => {
  const f = fixture(), before = await f.identify()
  f.product('5.9.4.42593613')
  const after = await f.identify()
  expect(after?.fingerprint.appVersion).toBe('5.9.4.42593613')
  expect(fingerprintToken(after!.fingerprint)).not.toBe(fingerprintToken(before!.fingerprint))
})
it('模拟 Windows：已有有效 app/package.json 优先，非法版本才回退', async () => {
  const f = fixture()
  f.file(join(f.resources, 'app/package.json'), JSON.stringify({ version: '5.9.4' }))
  expect((await f.identify())?.fingerprint.appVersion).toBe('5.9.4')
  f.file(join(f.resources, 'app/package.json'), JSON.stringify({ version: 'invalid' }))
  expect((await f.identify())?.fingerprint.appVersion).toBe('5.9.3')
})
it('模拟 Windows：另一站点的 product.json 不能提供当前版的身份或应用版本', async () => {
  const f = fixture(); f.product('5.9.3', 'https://www.workbuddy.ai')
  await expect(f.identify()).rejects.toMatchObject({ reason: 'variant-mismatch' })
})
it('模拟 macOS：仍以 Info.plist 四段 build 为准，不使用 Windows 产品字段兜底', async () => {
  const f = fixture('workbuddycn', '9.9.9', 'darwin')
  expect((await f.identify())?.fingerprint.appVersion).toBeUndefined()
  f.file(join(f.app, 'Contents/Info.plist'), '<plist><key>CFBundleShortVersionString</key><string>5.9.3</string><key>CFBundleVersion</key><string>5.9.3.42398134</string></plist>')
  expect((await f.identify())?.fingerprint.appVersion).toBe('5.9.3.42398134')
})
