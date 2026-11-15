/** 模拟：手工 PE 字节、临时安装目录、HTTP 和进程回执；不执行程序、不读真实账号。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, symlinkSync, statSync, openSync, ftruncateSync, closeSync, utimesSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readPeVersion, PE_VERSION_READ_LIMIT } from '../src/host/cli-management/pe-version.ts'
import { identifyInstallation, managedZCodeApplication, fingerprintToken, ZCODE_RUNTIME_NOTICE, ZCODE_PLUGIN_RUNTIME_NOTE, ZCODE_RUNTIME_ORIGIN } from '../src/host/cli-management/identity.ts'
import { automaticMethod, operationToken, planCliOperation, sameInstallation, updateProblem, verifyUpdatedVersion } from '../src/host/cli-management/planner.ts'
import { currentVersion, desktopVersion, validAppVersion } from '../src/host/cli-management/versions.ts'
import { readDesktopRelease } from '../src/host/cli-management/desktop-update.ts'
import { CliExecutablePathStore } from '../src/host/cli-executable-paths.ts'
import { serviceFixture, checked, finished, control, sri, childFixture, until } from './cli-management-phase-b-fixture.ts'

const environment = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => environment.home }))
const fixtures: ReturnType<typeof serviceFixture>[] = []
const filesystemPlatform = process.platform
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); vi.restoreAllMocks(); vi.unstubAllEnvs() })
const align = (n: number) => Math.ceil(n / 4) * 4
function block(key: string, value: Buffer, type = 1, children: Buffer[] = []) {
  const name = Buffer.from(key + '\0', 'utf16le'), start = align(6 + name.length)
  const end = children.length ? align(start + value.length) + children.reduce((n, child) => n + align(child.length), 0) : start + value.length
  const result = Buffer.alloc(end)
  result.writeUInt16LE(end); result.writeUInt16LE(type === 1 ? value.length / 2 : value.length, 2); result.writeUInt16LE(type, 4)
  name.copy(result, 6); value.copy(result, start)
  let offset = align(start + value.length)
  for (const child of children) { child.copy(result, offset); offset += align(child.length) }
  return result
}
/** Minimal simulated PE32/PE32+ with one .rsrc section and RT_VERSION/name/language directories. */
function pe(productName = 'ZCode', version = '3.14.5.7961', plus = true, extra: Buffer[] = []) {
  const parts = version.split('.').map(Number), fixed = Buffer.alloc(52)
  fixed.writeUInt32LE(0xfeef04bd); fixed.writeUInt32LE(0x10000, 4)
  fixed.writeUInt32LE(0x00010002, 8); fixed.writeUInt32LE(0x00030004, 12) // FileVersion deliberately differs.
  fixed.writeUInt32LE(parts[0]! * 65536 + parts[1]!, 16); fixed.writeUInt32LE(parts[2]! * 65536 + parts[3]!, 20)
  const strings = block('StringFileInfo', Buffer.alloc(0), 1, [block('040904b0', Buffer.alloc(0), 1, [
    block('ProductName', Buffer.from(productName + '\0', 'utf16le')),
    block('ProductVersion', Buffer.from('3.14.5-string\0', 'utf16le')),
    ...extra,
  ])])
  const versionInfo = block('VS_VERSION_INFO', fixed, 0, [strings]), bytes = Buffer.alloc(0x400 + versionInfo.length)
  bytes.write('MZ'); bytes.writeUInt32LE(0x80, 60); bytes.write('PE\0\0', 0x80)
  bytes.writeUInt16LE(plus ? 0x8664 : 0x14c, 0x84); bytes.writeUInt16LE(1, 0x86)
  const optionalSize = plus ? 240 : 224, optional = 0x98, directories = optional + (plus ? 112 : 96)
  bytes.writeUInt16LE(optionalSize, 0x94); bytes.writeUInt16LE(plus ? 0x20b : 0x10b, optional)
  bytes.writeUInt32LE(16, directories - 4); bytes.writeUInt32LE(0x1000, directories + 16); bytes.writeUInt32LE(bytes.length - 0x200, directories + 20)
  const section = optional + optionalSize
  bytes.write('.rsrc', section); bytes.writeUInt32LE(bytes.length - 0x200, section + 8)
  bytes.writeUInt32LE(0x1000, section + 12); bytes.writeUInt32LE(bytes.length - 0x200, section + 16); bytes.writeUInt32LE(0x200, section + 20)
  for (const [offset, id, target] of [[0, 16, 0x80000020], [0x20, 1, 0x80000040], [0x40, 1033, 0x60]]) {
    bytes.writeUInt16LE(1, 0x200 + offset! + 14); bytes.writeUInt32LE(id!, 0x200 + offset! + 16); bytes.writeUInt32LE(target!, 0x200 + offset! + 20)
  }
  bytes.writeUInt32LE(0x1200, 0x260); bytes.writeUInt32LE(versionInfo.length, 0x264); versionInfo.copy(bytes, 0x400)
  return bytes
}
function fixture() {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
  const f = serviceFixture(['zcode']); fixtures.push(f); environment.home = f.root
  vi.stubEnv('ProgramFiles', join(f.root, 'Program Files')); vi.stubEnv('LOCALAPPDATA', join(f.root, 'AppData/Local'))
  const file = (path: string, bytes: string | Buffer = '// 模拟') => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); return path }
  const runtimeRoot = join(f.root, '.local/share/cliworker-now/runtimes/zcode'), runtime = file(join(runtimeRoot, 'cli/zcode.cjs'))
  file(join(runtimeRoot, 'INSTALL-MANIFEST.json'), JSON.stringify({ version: '0.16.9', source: { origin: ZCODE_RUNTIME_ORIGIN } }))
  // The disk fixture uses the runner's paths; only application discovery simulates Windows.
  const store = new CliExecutablePathStore(join(f.root, 'paths'), { platform: filesystemPlatform }); store.remember('zcode', runtime, 0); f.config.cliExecutablePaths = store
  const app = (location = 'ProgramFiles', productName = 'ZCode', version = '3.14.5.7961') => {
    const root = location === 'ProgramFiles' ? join(process.env.ProgramFiles!, 'ZCode') : join(process.env.LOCALAPPDATA!, 'Programs/ZCode')
    file(join(root, 'ZCode.exe'), pe(productName, version)); file(join(root, 'resources/glm/zcode.cjs')); return root
  }
  f.backend.spawn = vi.fn(() => { throw new Error('模拟：后台不得启动进程') })
  f.backend.resolveExecutable = vi.fn(async name => name)
  f.identify.mockImplementation(async (cli, ...rest: any[]) => cli === 'zcode' ? identifyInstallation(cli, f.backend, f.config, rest[2] ?? control(), rest[3]) : undefined)
  f.version.mockImplementation((cli, identity) => currentVersion(cli, identity, f.backend, f.config, control(), true))
  const identify = () => identifyInstallation('zcode', f.backend, f.config, control(), true)
  const url = 'https://cdn-zcode.z.ai/zcode/electron/releases/3.18.2/windows-x64/ZCode-3.18.2-win-x64.exe'
  f.metadataFetch.mockImplementation(async () => new Response(JSON.stringify({ version: '3.18.2', files: [{ url, sha512: sri('模拟').slice(7), size: Buffer.byteLength('模拟') }] })))
  return { ...f, file, runtime, store, app, identify, url }
}

it.each([false, true])('模拟 PE32+ %s：读 ProductName、字符串版本与独立的固定 ProductVersion', async plus => {
  const f = fixture(), path = f.file(join(f.root, 'fixture.exe'), pe('ZCode', '3.14.5.7961', plus))
  expect(await readPeVersion(path)).toEqual({ productName: 'ZCode', productVersion: '3.14.5.7961', stringProductVersion: '3.14.5-string' })
})
const malformed: [string, (bytes: Buffer) => Buffer][] = [
  ['无 .rsrc', b => { b.write('.text', 0x188); return b }],
  ['DOS 截断', b => b.subarray(0, 40)],
  ['资源截断', b => b.subarray(0, b.length - 1)],
  ['PE 偏移越界', b => { b.writeUInt32LE(0xfffffff0, 60); return b }],
  ['节偏移越界', b => { b.writeUInt32LE(0xfffffff0, 0x188 + 20); return b }],
  ['资源目录越界', b => { b.writeUInt32LE(0xfffffff0, 0x214); return b }],
  ['资源数据 RVA 越界', b => { b.writeUInt32LE(0x90000000, 0x260); return b }],
  ['资源数据长度超限', b => { b.writeUInt32LE(PE_VERSION_READ_LIMIT, 0x264); return b }],
  ['资源目录循环', b => { b.writeUInt32LE(0x80000000, 0x214); return b }],
  ['节表数量超限', b => { b.writeUInt16LE(0xffff, 0x86); return b }],
  ['版本块越界', b => { b.writeUInt16LE(0xffff, 0x400); return b }],
  ['固定版本签名错误', b => { b.writeUInt32LE(0, 0x428); return b }],
  ['字符串长度越界', b => { const key = b.indexOf(Buffer.from('ProductName\0', 'utf16le')); b.writeUInt16LE(0xffff, key - 4); return b }],
]
it.each(malformed)('模拟：%s 返回 undefined', async (_name, corrupt) => {
  const f = fixture(), path = f.file(join(f.root, 'fixture.exe'), corrupt(pe()))
  await expect(readPeVersion(path)).resolves.toBeUndefined()
})
it('模拟：字符串值带多余结尾 NUL 时按第一个 NUL 截断（ZCode 3.14.5 实机 SquirrelAwareVersion 为 6 字节的 "1"）', async () => {
  const f = fixture(), path = f.file(join(f.root, 'padded.exe'), pe('ZCode', '3.14.5.7961', true, [
    block('OriginalFilename', Buffer.from('\0', 'utf16le')),
    block('SquirrelAwareVersion', Buffer.from('1\0\0', 'utf16le')),
  ]))
  await expect(readPeVersion(path)).resolves.toMatchObject({ productVersion: '3.14.5.7961', productName: 'ZCode' })
})
it('模拟：缺失文件和目录返回 undefined，200 MB 稀疏文件仍只读取 PE 资源', async () => {
  const f = fixture()
  expect(await readPeVersion(join(f.root, 'missing.exe'))).toBeUndefined(); expect(await readPeVersion(f.root)).toBeUndefined()
  const path = f.file(join(f.root, 'large.exe'), pe()), fd = openSync(path, 'r+')
  try { ftruncateSync(fd, 222_866_328) } finally { closeSync(fd) }
  expect((await readPeVersion(path))?.productVersion).toBe('3.14.5.7961')
})
it.each(['ProgramFiles', 'LOCALAPPDATA'])('模拟：%s 关联且后台不执行任何进程', async location => {
  const f = fixture(), app = f.app(location), id = (await f.identify())!
  expect(id).toMatchObject({ executable: f.runtime, source: 'desktop-app', appPath: app, notice: ZCODE_RUNTIME_NOTICE, fingerprint: { appVersion: '3.14.5', realpath: f.runtime } })
  expect(validAppVersion(id.fingerprint.appVersion)).toBe(true); expect(desktopVersion('zcode', id.fingerprint.appVersion!)).toBe('3.14.5')
  expect(automaticMethod('zcode', id)).toBe('desktop'); expect(updateProblem('zcode', id)).toBeUndefined()
  expect(await currentVersion('zcode', id, f.backend, f.config, control(), true)).toBe('3.14.5')
  expect(await managedZCodeApplication(f.runtime.toUpperCase().replace(/\//g, '\\'))).toBe(app)
  expect(f.backend.spawn).not.toHaveBeenCalled(); expect(f.backend.resolveExecutable).not.toHaveBeenCalled()
})
it('模拟：两候选都没有时保留 plugin-runtime 原提示', async () => {
  const f = fixture(), id = (await f.identify())!
  expect(id).toMatchObject({ source: 'plugin-runtime', manifestVersion: '0.16.9', appPath: undefined })
  expect(updateProblem('zcode', id)).toBe(ZCODE_PLUGIN_RUNTIME_NOTE); expect(automaticMethod('zcode', id)).toBeUndefined()
  await (f.service as any).local('zcode', control(), true, false); await (f.service as any).remote('zcode', control(), true)
  expect(f.service.snapshot().entries.find(e => e.cli === 'zcode')).toMatchObject({ group: 'manual', manual: { note: ZCODE_PLUGIN_RUNTIME_NOTE } })
})
it.each(['目录链接', 'EXE 链接', 'ProductName 不符', '缺少内置 CLI'])('模拟：%s 不关联', async reason => {
  const f = fixture(), app = f.app('ProgramFiles', reason === 'ProductName 不符' ? 'Other App' : 'ZCode')
  if (reason === '目录链接') {
    const other = f.app('LOCALAPPDATA'); rmSync(app, { recursive: true }); symlinkSync(other, app, 'junction')
    vi.stubEnv('LOCALAPPDATA', join(f.root, 'missing'))
  } else if (reason === 'EXE 链接') {
    const target = f.file(join(f.root, 'other.exe'), pe()); rmSync(join(app, 'ZCode.exe')); symlinkSync(target, join(app, 'ZCode.exe'))
  } else if (reason === '缺少内置 CLI') rmSync(join(app, 'resources/glm/zcode.cjs'))
  expect((await f.identify())?.source).toBe('plugin-runtime')
})
it('模拟：首个候选身份不符仍检查当前用户目录，两者有效时优先所有用户目录', async () => {
  const f = fixture(); f.app('ProgramFiles', 'Other App'); const userApp = f.app('LOCALAPPDATA')
  expect((await f.identify())?.appPath).toBe(userApp)
  expect((await readPeVersion(join(process.env.ProgramFiles!, 'ZCode/ZCode.exe')))?.productName).toBe('Other App')
  const systemApp = f.app(); expect((await f.identify())?.appPath).toBe(systemApp)
})
it.each(['manual-runtime', 'manual-custom', 'configured'])('模拟：%s 不关联桌面应用', async mode => {
  const f = fixture(); f.app()
  if (mode === 'configured') Object.assign(f.config, { zcodeExecutable: f.runtime })
  else f.store.setManual('zcode', mode === 'manual-runtime' ? f.runtime : f.file(join(f.root, 'custom/zcode.cjs')))
  const id = await f.identify()
  expect(id?.source).not.toBe('desktop-app'); expect(id?.appPath).toBeUndefined(); expect(id?.notice).toBeUndefined()
})
it('模拟：EXE 替换后读回 3.18.2，计划失效而同一安装核对通过', async () => {
  const f = fixture(), app = f.app(), before = (await f.identify())!
  const plan = planCliOperation('zcode', 'update', before, '3.14.5', '3.18.2', '模拟')
  const oldInfo = statSync(join(app, 'ZCode.exe'))
  f.file(join(app, 'ZCode.exe'), Buffer.concat([pe('ZCode', '3.18.2.9000'), Buffer.alloc(40)]))
  utimesSync(join(app, 'ZCode.exe'), new Date(), new Date(oldInfo.mtimeMs + 5000))
  const after = (await f.identify())!
  expect(statSync(join(app, 'ZCode.exe')).size).not.toBe(oldInfo.size)
  expect(statSync(join(app, 'ZCode.exe')).mtimeMs).not.toBe(oldInfo.mtimeMs)
  expect(after.fingerprint.appVersion).toBe('3.18.2'); expect(after.fingerprint.size).toBe(before.fingerprint.size)
  expect(fingerprintToken(after.fingerprint)).not.toBe(fingerprintToken(before.fingerprint))
  expect(operationToken('zcode', after, '3.18.2', '模拟', '3.14.5')).not.toBe(plan.token)
  expect(sameInstallation(before, after, 'zcode')).toBe(true)
  expect(() => verifyUpdatedVersion(plan, after.fingerprint.appVersion)).not.toThrow()
  const windows = { ...before, executable: 'C:\\Users\\Alice\\runtime\\zcode.cjs', appPath: 'C:\\Program Files\\ZCode', fingerprint: { ...before.fingerprint, realpath: 'C:\\Users\\Alice\\runtime\\zcode.cjs' } }
  expect(sameInstallation(windows, { ...windows, executable: windows.executable.toUpperCase(), appPath: windows.appPath.toUpperCase(), fingerprint: { ...windows.fingerprint, appVersion: '3.18.2', realpath: windows.fingerprint.realpath.toUpperCase() } }, 'zcode')).toBe(true)
  expect(sameInstallation(windows, { ...windows, appPath: 'C:\\Other\\ZCode' }, 'zcode')).toBe(false)
})
it('模拟：官方 Windows feed 到现有安装程序执行与 verify，等待整个进程范围退出', async () => {
  const f = fixture(), app = f.app(), child = childFixture()
  const release = await readDesktopRelease('zcode', { appVersion: '3.14.5' }, control(), { fetcher: f.metadataFetch, platform: 'win32', arch: 'x64' })
  expect(release.url).toBe(f.url)
  const row = (await checked(f.service)).entries.find(e => e.cli === 'zcode')!
  expect(row).toMatchObject({ group: 'updatable', appVersion: '3.14.5', notice: ZCODE_RUNTIME_NOTICE, manual: undefined })
  f.backend.spawn = vi.fn(command => {
    expect(command.argv).toHaveLength(1); expect(command.argv[0]).toMatch(/\.exe$/i)
    // The official wizard needs the user (and UAC), so the phase stays awaiting-user while it runs.
    expect(f.service.snapshot().operation?.phase).toBe('awaiting-user')
    f.file(join(app, 'ZCode.exe'), Buffer.concat([pe('ZCode', '3.18.2.9000'), Buffer.alloc(16)]))
    return child.child
  })
  f.service.start('zcode', 'update', row.planToken!, '', '模拟-windows-update')
  await until(() => vi.mocked(f.backend.spawn).mock.calls.length === 1)
  child.finish(); await until(() => child.child.waitForExit.mock.calls.length > 0)
  expect(f.service.snapshot().operation).toBeDefined()
  child.exit(true)
  expect((await finished(f.service)).results[0]).toMatchObject({ phase: 'succeeded', afterVersion: '3.18.2' })
  expect(f.backend.spawn).toHaveBeenCalledTimes(1)
  expect((await f.identify())?.fingerprint.appVersion).toBe('3.18.2')
})
