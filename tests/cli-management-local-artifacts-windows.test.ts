/** 模拟：Windows 平台、官方元数据、二进制和文件占用；仅写测试临时目录，不运行真实安装器。 */
import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, win32 } from 'node:path'
import { canPrepareLocalUpdate, prepareLocalUpdate } from '../src/host/cli-management/local-artifacts.ts'
import { WINDOWS_LOCAL_SOURCES } from '../src/host/cli-management/sources.ts'
import { serviceFixture, control, syntheticIdentity, checked, finished } from './cli-management-phase-b-fixture.ts'
import type { ActiveCliId } from '../src/shared/types.ts'

const simulated = vi.hoisted(() => ({ home: undefined as string | undefined, locked: '', code: 'EBUSY' }))
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => simulated.home ?? '/模拟/home' }))
vi.mock('node:fs/promises', async original => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs, rename: async (source: string, target: string) => {
    if (target === simulated.locked) throw Object.assign(new Error('模拟 Windows 文件占用'), { code: simulated.code })
    return fs.rename(source, target)
  } }
})
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
const fixtures: ReturnType<typeof serviceFixture>[] = []
const bytes = '模拟 MZ binary', sha256 = createHash('sha256').update(bytes).digest('hex'), sha512 = createHash('sha512').update(bytes).digest('hex'), size = Buffer.byteLength(bytes)
const version = '1.2.3'
type Cli = 'claude' | 'antigravity' | 'omp' | 'traecn'
function fixture(cli: Cli, arch = 'x64') {
  const f = serviceFixture([cli]); fixtures.push(f); simulated.home = f.root
  const local = join(f.root, 'AppData/Local'), state = join(local, 'TraeCLI')
  const target = join(f.root, cli === 'claude' ? '.local/bin/claude.exe' : cli === 'antigravity' ? 'AppData/Local/agy/bin/agy.exe' : cli === 'omp' ? 'AppData/Local/omp/omp.exe' : 'AppData/Local/TraeCLI/releases/1.0.0-x86_64-pc-windows-msvc/traex.exe')
  mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, '模拟 old')
  const identity = { ...syntheticIdentity(cli), executable: target, source: 'self-update' as const, channel: cli === 'traecn' ? 'public' : undefined,
    fingerprint: { realpath: target, size: 10, mtimeMs: 100 } }
  f.identities.set(cli, identity)
  const options = { cli, version, identity, root: f.root, backend: f.backend, config: f.config, releases: f.releases, signal: control(),
    fetcher: f.artifactFetch, output: vi.fn(), progress: vi.fn(), platform: 'win32' as const, arch, home: f.root, localAppData: local }
  const platform = arch === 'x64' ? 'windows-x86_64' : 'windows-aarch64'
  const record = (name: string, filename: string) => ({ name, filename, url: `${WINDOWS_LOCAL_SOURCES.trae}/v2/releases/${version}/${filename}`, sha256, size, compression: 'gzip' })
  let metadata: any
  if (cli === 'claude') metadata = { version, platforms: { [`win32-${arch}`]: { binary: 'claude.exe', checksum: sha256, size } } }
  if (cli === 'antigravity') metadata = { version, url: 'https://storage.googleapis.com/antigravity-public/antigravity-cli/fixture.exe', sha512 }
  if (cli === 'omp') metadata = { build: { version }, file: { name: 'omp.exe', platform: 'windows', arch: arch === 'x64' ? 'x86_64' : 'arm64', sha256, size }, download: 'https://d4c085d38fe197a3f20bbeb20222b8b3.r2.cloudflarestorage.com/ompcast/builds/omp/fixture?signature=simulated' }
  if (cli === 'traecn') metadata = { version, binary_version: version, channel: 'public', release_channel: 'stable', distribution: 'public', build_channel: 'tob', artifacts: [
    { ...record('traex', `traex-${platform}.exe.gz`), platform, sidecars: [record('code_mode_host', `traex-code-mode-host-${platform}.exe.gz`)],
      windows_sandbox_helpers: ['traecli-windows-sandbox-setup', 'traecli-command-runner'].map(name => record(name, `${name}-${platform}.exe.gz`)) },
    { platform: 'macos-aarch64', url: 'https://模拟不应读取.invalid' }] }
  const rg = { version: '14.1.0', artifacts: [
    { platform, filename: `rg-${platform}.zip`, archive_path: 'ripgrep/bin/rg.exe', url: `${WINDOWS_LOCAL_SOURCES.trae}/v2/deps/ripgrep/rg-${platform}.zip`, sha256, size, compression: 'zip' },
    { platform: 'linux-x86_64', url: 'https://模拟不应读取.invalid' }] }
  f.metadataFetch.mockImplementation(async url => new Response(JSON.stringify(String(url).endsWith('/dist-tags') ? { latest: version } : String(url).includes('/deps/ripgrep/') ? rg : metadata)))
  f.artifactFetch.mockImplementation(async (_url, init) => new Response(init?.method === 'HEAD' ? null : bytes, { headers: { 'content-length': String(size), etag: '"simulated"', 'accept-ranges': 'bytes' } }))
  return { ...f, options, metadata, rg, target, state }
}
afterEach(async () => {
  simulated.locked = ''; simulated.home = undefined; simulated.code = 'EBUSY'
  Object.defineProperty(process, 'platform', platformDescriptor); vi.unstubAllEnvs()
  for (const f of fixtures.splice(0)) await f.close()
})

it.each(['claude', 'antigravity', 'omp'] as const)('模拟：%s x64/arm64 校验下载后同目录原子放置，无子进程和临时文件', async cli => {
  for (const arch of ['x64', 'arm64']) {
    const f = fixture(cli, arch), local = await prepareLocalUpdate(f.options)
    expect(readFileSync(f.target, 'utf8')).toBe('模拟 old')
    await local.install!(control(), vi.fn())
    expect(readFileSync(f.target, 'utf8')).toBe(bytes)
    expect(readdirSync(dirname(f.target))).toEqual([cli === 'claude' ? 'claude.exe' : cli === 'omp' ? 'omp.exe' : 'agy.exe'])
    if (cli === 'claude') {
      const versions = join(f.root, '.local/share/claude/versions')
      expect(readdirSync(versions)).toEqual([version]); expect(readFileSync(join(versions, version), 'utf8')).toBe(bytes)
    }
    expect(f.options.progress).toHaveBeenLastCalledWith(expect.objectContaining({ readable: true, downloadedBytes: size, totalBytes: size, sourceHost: expect.any(String) }))
    expect(f.options.output.mock.calls.flat().join('')).toContain(cli === 'antigravity' ? 'sha512' : 'sha256')
    expect(f.backend.spawn).not.toHaveBeenCalled(); await local.cleanup()
    expect(readdirSync(join(f.root, 'cli-management/downloads'))).toEqual([])
  }
})
it.each(['claude', 'antigravity', 'omp'] as const)('模拟：%s 摘要错误仅干净重下一次，不写安装目录', async cli => {
  const f = fixture(cli)
  f.artifactFetch.mockImplementation(async (_url, init) => new Response(init?.method === 'HEAD' ? null : 'x'.repeat(size), { headers: { 'content-length': String(size), etag: '"simulated"' } }))
  await expect(prepareLocalUpdate(f.options)).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  expect(f.artifactFetch.mock.calls.filter(c => c[1]?.method !== 'HEAD')).toHaveLength(2)
  expect(readFileSync(f.target, 'utf8')).toBe('模拟 old'); expect(readdirSync(join(f.root, 'cli-management/downloads'))).toEqual([])
})
it.each(['EBUSY', 'EPERM', 'EACCES'])('模拟：%s 保留旧 exe，删除临时文件，回滚 Claude 本次版本文件', async code => {
  for (const cli of ['claude', 'antigravity', 'omp'] as const) {
    const f = fixture(cli), local = await prepareLocalUpdate(f.options)
    simulated.locked = f.target; simulated.code = code
    await expect(local.install!(control(), vi.fn())).rejects.toMatchObject({ code: 'FILE_LOCKED', message: expect.stringContaining('正被其他程序占用，未替换；关闭后重试') })
    expect(readFileSync(f.target, 'utf8')).toBe('模拟 old'); expect(readdirSync(dirname(f.target))).toHaveLength(1)
    if (cli === 'claude') expect(readdirSync(join(f.root, '.local/share/claude/versions'))).toEqual([])
    await local.cleanup()
  }
})
it('模拟：Claude 替换失败恢复先前存在的同版本文件，不删用户原文件', async () => {
  const f = fixture('claude'), path = join(f.root, '.local/share/claude/versions', version)
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, '模拟原版本文件')
  const local = await prepareLocalUpdate(f.options); simulated.locked = f.target
  await expect(local.install!(control(), vi.fn())).rejects.toMatchObject({ code: 'FILE_LOCKED' })
  expect(readFileSync(path, 'utf8')).toBe('模拟原版本文件'); expect(readdirSync(dirname(path))).toEqual([version]); await local.cleanup()
})
const invalidCases: [Cli, string, (m: any) => void][] = [
  ['claude', 'version', m => m.version = '9.9.9'], ['claude', 'platform', m => m.platforms = {}],
  ['claude', 'binary', m => m.platforms['win32-x64'].binary = 'other.exe'], ['claude', 'hex', m => m.platforms['win32-x64'].checksum = 'g'.repeat(64)],
  ['claude', 'size', m => m.platforms['win32-x64'].size = 0],
  ['antigravity', 'version', m => m.version = '9.9.9'], ['antigravity', 'hex', m => m.sha512 = '1'],
  ['antigravity', 'host', m => m.url = 'https://evil.invalid/antigravity-public/antigravity-cli/a'],
  ['antigravity', 'path', m => m.url = 'https://storage.googleapis.com/untrusted/a'],
  ['omp', 'version', m => m.build.version = '9.9.9'], ['omp', 'platform', m => m.file.platform = 'linux'],
  ['omp', 'arch', m => m.file.arch = 'aarch64'], ['omp', 'hex', m => m.file.sha256 = 'g'.repeat(64)],
  ['omp', 'size', m => m.file.size = Number.MAX_SAFE_INTEGER + 1], ['omp', 'name', m => m.file.name = '../omp.exe'],
  ['omp', 'host', m => m.download = 'https://evil.invalid/ompcast/builds/omp/a'],
  ['omp', 'path', m => m.download = m.download.replace('/ompcast/', '/other/')],
  ['traecn', 'version', m => m.version = '9.9.9'], ['traecn', 'channel', m => m.channel = 'internal'],
  ['traecn', 'distribution', m => m.distribution = 'private'], ['traecn', 'track', m => m.release_channel = 'alpha'],
  ['traecn', 'platform', m => m.artifacts = []], ['traecn', 'duplicate', m => m.artifacts.push(m.artifacts[0])],
  ['traecn', 'sidecar', m => m.artifacts[0].sidecars = []], ['traecn', 'helpers', m => m.artifacts[0].windows_sandbox_helpers.pop()],
  ['traecn', 'hex', m => m.artifacts[0].sha256 = 'g'.repeat(64)], ['traecn', 'filename', m => m.artifacts[0].filename = '../a'],
  ['traecn', 'host', m => m.artifacts[0].url = 'https://evil.invalid/a'],
  ['traecn', 'path', m => m.artifacts[0].url = `${WINDOWS_LOCAL_SOURCES.trae}/other/a`],
  ['traecn', 'compression', m => m.artifacts[0].compression = 'zip'],
  ['traecn', 'budget', m => { m.artifacts[0].size = 2 * 1024 ** 3; m.artifacts[0].sidecars[0].size = 1 }],
]
it.each(invalidCases)('模拟：%s 拒绝清单 %s 后不下载、不替换', async (cli, _case, mutate) => {
  const f = fixture(cli); mutate(f.metadata)
  await expect(prepareLocalUpdate(f.options)).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  expect(f.artifactFetch).not.toHaveBeenCalled(); expect(readFileSync(f.target, 'utf8')).toBe('模拟 old')
  expect(readdirSync(join(f.root, 'cli-management/downloads'))).toEqual([])
})
it.each(['x64', 'arm64'])('模拟：TRAE %s 完整离线包仅保留目标平台，相对 URL、通道、摘要、权限和 argv', async arch => {
  const f = fixture('traecn', arch), local = await prepareLocalUpdate(f.options), directory = local.argv.at(-1)!
  const m = JSON.parse(readFileSync(join(directory, 'offline-manifest.json'), 'utf8')), rg = JSON.parse(readFileSync(join(directory, 'dependencies/ripgrep/manifest.json'), 'utf8'))
  expect(m).toMatchObject({ offline_channel: 'public', release_channel: 'stable', version }); expect(m.artifacts).toHaveLength(1); expect(rg.artifacts).toHaveLength(1)
  const records = [m.artifacts[0], ...m.artifacts[0].sidecars, ...m.artifacts[0].windows_sandbox_helpers, rg.artifacts[0]]
  for (const record of records) {
    expect(record.url).toBe(`${record === rg.artifacts[0] ? 'dependencies/ripgrep' : 'artifacts'}/${record.filename}`)
    expect(readFileSync(join(directory, record.url), 'utf8')).toBe(bytes)
    expect(statSync(join(directory, record.url)).mode & 0o777).toBe(0o600)
  }
  expect(local.argv).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(directory, 'install_v2.ps1'), 'offline-install', directory])
  expect(local.env).toMatchObject({ TRAECLI_VERSION: version, TRAECLI_INSTALL_SKIP_USER_PATH: '1', TRAECLI_INSTALL_ASSUME_YES: '1' }); expect(local.env).not.toHaveProperty('TRAECLI_INSTALL_AUTO_UPDATE')
  expect(f.artifactFetch.mock.calls.map(c => String(c[0]))).toContain(`${WINDOWS_LOCAL_SOURCES.trae}/install_v2.ps1`)
  expect(statSync(directory).mode & 0o777).toBe(0o700); await local.cleanup()
})
it.each(['absent', 'present', 'uuid', 'failure', 'cancel'] as const)('模拟：TRAE 自动更新标记 %s', async mode => {
  const f = fixture('traecn'), marker = join(f.state, 'auto-update-version')
  if (mode !== 'absent') writeFileSync(marker, '模拟原 release')
  const local = await prepareLocalUpdate(f.options), release = `${version}-x86_64-pc-windows-msvc${mode === 'uuid' ? '.0123456789abcdef0123456789abcdef' : ''}`
  const controller = new AbortController(), run = vi.fn(async (argv: string[]) => {
    expect(argv).toEqual(local.argv)
    if (mode === 'failure') throw new Error('模拟安装失败')
    if (mode === 'cancel') { controller.abort(); controller.signal.throwIfAborted() }
    rmSync(marker, { force: true }) // 模拟官方离线安装成功时移除标记。
    const selected = join(f.state, 'releases', release); mkdirSync(selected); symlinkSync(selected, join(f.state, 'current'))
  })
  if (mode === 'failure' || mode === 'cancel') {
    await expect(local.install!(controller.signal, run)).rejects.toThrow(); expect(readFileSync(marker, 'utf8')).toBe('模拟原 release')
  } else {
    await local.install!(controller.signal, run)
    if (mode === 'absent') expect(existsSync(marker)).toBe(false)
    else expect(readFileSync(marker, 'utf8')).toBe(release)
  }
  expect(readdirSync(f.state).filter(n => n.includes('download'))).toEqual([]); await local.cleanup()
})
it.each(['../rg.exe', '/bin/rg.exe', 'bin\\rg.exe', 'bin/not-rg.exe'])('模拟：TRAE 拒绝不安全 ripgrep archive_path %s', async path => {
  const f = fixture('traecn'); f.rg.artifacts[0]!.archive_path = path
  await expect(prepareLocalUpdate(f.options)).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' }); expect(f.artifactFetch).not.toHaveBeenCalled()
})
it('模拟：Windows 精确布局大小写不敏感，自定义路径、其他 owner、CPU 和 Unix 保留原逻辑', () => {
  const home = 'C:\\Users\\模拟', local = win32.join(home, 'AppData/Local')
  for (const [cli, relative] of [['claude', '.local/bin/claude.exe'], ['antigravity', 'AppData/Local/agy/bin/agy.exe'], ['omp', 'AppData/Local/omp/omp.exe'], ['traecn', 'AppData/Local/TraeCLI/releases/1.0.0/traex.exe']] as const) {
    const path = win32.join(home, relative).toUpperCase(), identity = { ...syntheticIdentity(cli), source: 'self-update' as const, executable: path, channel: 'public', fingerprint: { realpath: path, size: 1, mtimeMs: 1 } }
    expect(canPrepareLocalUpdate(cli, identity, 'win32', 'x64', home, local)).toBe(true)
    expect(canPrepareLocalUpdate(cli, identity, 'win32', 'arm64', home, local)).toBe(true)
    expect(canPrepareLocalUpdate(cli, identity, 'win32', 'ia32', home, local)).toBe(false)
    expect(canPrepareLocalUpdate(cli, { ...identity, source: 'npm' }, 'win32', 'x64', home, local)).toBe(false)
    expect(canPrepareLocalUpdate(cli, { ...identity, executable: 'C:\\custom.exe', fingerprint: { ...identity.fingerprint, realpath: 'C:\\custom.exe' } }, 'win32', 'x64', home, local)).toBe(false)
    expect(canPrepareLocalUpdate(cli, identity, 'darwin', 'x64', home, local)).toBe(false)
  }
})
it('模拟：Claude 中断从已下载字节 Range 恢复并推送进度', async () => {
  const f = fixture('claude'); let gets = 0
  f.artifactFetch.mockImplementation(async (_url, init) => {
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'content-length': String(size), etag: '"simulated"' } })
    if (++gets === 1) return new Response(Buffer.from(bytes).subarray(0, 3), { headers: { 'content-length': String(size), etag: '"simulated"' } })
    expect((init?.headers as Record<string, string>).Range).toBe('bytes=3-')
    return new Response(Buffer.from(bytes).subarray(3), { status: 206, headers: { 'content-length': String(size - 3), 'content-range': `bytes 3-${size - 1}/${size}`, etag: '"simulated"' } })
  })
  const local = await prepareLocalUpdate(f.options)
  expect(f.options.progress).toHaveBeenLastCalledWith(expect.objectContaining({ readable: true, downloadedBytes: size, resumeCount: 1 })); await local.cleanup()
})
it.each(['success', 'wrong-version', 'wrong-identity'] as const)('模拟：Windows 服务接管 Claude 后仍核对身份和精确版本 %s', async mode => {
  const f = fixture('claude', process.arch)
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' }); vi.stubEnv('LOCALAPPDATA', f.options.localAppData)
  f.version.mockImplementation(async (_cli: ActiveCliId, id) => readFileSync(f.target, 'utf8') === bytes ? mode === 'wrong-version' ? '1.2.4' : version : id.manifestVersion)
  const identify = f.identify.getMockImplementation()!
  f.identify.mockImplementation(async cli => {
    const id = await identify(cli)
    if (id && mode === 'wrong-identity' && readFileSync(f.target, 'utf8') === bytes) id.source = 'unknown'
    return id
  })
  await checked(f.service); f.invalidateModels.mockClear()
  const token = f.service.snapshot().entries.find(e => e.cli === 'claude')!.planToken!
  expect(token).toBeTruthy(); f.service.start('claude', 'update', token, '', `模拟${mode}`)
  const result = (await finished(f.service)).results[0]!
  expect(result.phase).toBe(mode === 'success' ? 'succeeded' : 'failed')
  if (mode !== 'success') expect(result.error?.code).toBe(mode === 'wrong-version' ? 'VERSION_MISMATCH' : 'IDENTITY_CHANGED')
  expect(f.backend.spawn).not.toHaveBeenCalled(); expect(f.invalidateModels).toHaveBeenCalledTimes(1)
  expect(result.progress).toMatchObject({ readable: true, downloadedBytes: size })
  expect(readdirSync(join(f.root, 'cli-management/downloads'))).toEqual([])
})

it.each(['same', 'different', 'custom'] as const)('模拟：Claude 内置双源 %s 必须经 HEAD 身份校验，遵守禁用自动换源设置', async mode => {
  const f = fixture('claude'); let gets = 0
  f.artifactFetch.mockImplementation(async (url, init) => {
    const fallback = String(url).startsWith(WINDOWS_LOCAL_SOURCES.claudeFallback), etag = fallback && mode === 'different' ? '"other"' : '"same"'
    if (mode === 'custom') expect(fallback).toBe(false)
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'content-length': String(size), etag } })
    if (++gets === 1) return new Response(Buffer.from(bytes).subarray(0, 3), { headers: { 'content-length': String(size), etag } })
    expect(fallback).toBe(mode !== 'custom'); expect((init?.headers as Record<string, string>).Range).toBe('bytes=3-')
    if (mode !== 'custom') expect((init?.headers as Record<string, string>)['If-Range']).toBe('"same"')
    return new Response(Buffer.from(bytes).subarray(3), { status: 206, headers: { 'content-length': String(size - 3), 'content-range': `bytes 3-${size - 1}/${size}`, etag } })
  })
  const preparation = prepareLocalUpdate({ ...f.options, allowSourceSwitch: mode !== 'custom' })
  if (mode === 'different') {
    await expect(preparation).rejects.toThrow('下载源工件身份不一致'); expect(gets).toBe(1)
  } else {
    const local = await preparation; expect(gets).toBe(2)
    if (mode === 'same') expect(f.options.progress).toHaveBeenLastCalledWith(expect.objectContaining({ sourceHost: 'storage.googleapis.com', resumeCount: 1 }))
    await local.cleanup()
  }
})
it('模拟：多工件剩余预算在响应写盘之前生效，不突破私有缓存上限', async () => {
  const f = fixture('claude'), { downloadCliArtifact } = await import('../src/host/cli-management/download.ts')
  await expect(downloadCliArtifact({ root: f.root, url: `${WINDOWS_LOCAL_SOURCES.claude}/fixture`, officialScript: true, maxBytes: size - 1,
    signal: control(), fetcher: f.artifactFetch, progress: vi.fn() })).rejects.toMatchObject({ code: 'NETWORK' })
  for (const name of readdirSync(join(f.root, 'cli-management/downloads'))) expect(statSync(join(f.root, 'cli-management/downloads', name)).size).toBe(0)
})

it('模拟：TRAE 当前官方格式不含沙箱辅助件时仍生成完整离线包', async () => {
  const f = fixture('traecn'); delete f.metadata.artifacts[0].windows_sandbox_helpers
  const local = await prepareLocalUpdate(f.options)
  expect(readdirSync(join(local.argv.at(-1)!, 'artifacts'))).toHaveLength(2)
  await local.cleanup()
})
it.each(['hex', 'size', 'host', 'path', 'filename', 'missing', 'duplicate'] as const)('模拟：TRAE ripgrep %s 被拒，未开始下载', async mode => {
  const f = fixture('traecn'), rg = f.rg.artifacts[0]!
  if (mode === 'hex') rg.sha256 = 'z'.repeat(64)
  if (mode === 'size') rg.size = -1
  if (mode === 'host') rg.url = 'https://example.invalid/rg.zip'
  if (mode === 'path') rg.url = `${WINDOWS_LOCAL_SOURCES.trae}/v2/releases/rg.zip`
  if (mode === 'filename') rg.filename = 'CON.zip'
  if (mode === 'missing') f.rg.artifacts = []
  if (mode === 'duplicate') f.rg.artifacts.push({ ...rg })
  await expect(prepareLocalUpdate(f.options)).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  expect(f.artifactFetch).not.toHaveBeenCalled()
})
it('模拟：Windows TRAE 服务使用离线 argv 和专用环境，恢复标记并核对目标版本', async () => {
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' })
  const f = fixture('traecn', process.arch), marker = join(f.state, 'auto-update-version')
  vi.stubEnv('LOCALAPPDATA', f.options.localAppData)
  writeFileSync(marker, '模拟旧版本'); f.identities.get('traecn')!.updateRoot = f.state
  const spawn = vi.mocked(f.backend.spawn).getMockImplementation()!
  vi.mocked(f.backend.spawn).mockImplementation(options => {
    expect(options.argv[0]).toBe('powershell.exe'); expect(options.argv.slice(-2)).toEqual(['offline-install', expect.any(String)])
    expect(options.env).toMatchObject({ TRAECLI_VERSION: version, TRAECLI_CHANNEL: 'public', TRAECLI_INSTALL_SKIP_USER_PATH: '1' })
    expect(options.env).not.toHaveProperty('TRAECLI_INSTALL_AUTO_UPDATE')
    expect(() => f.config.cliMaintenance.assertAvailable('traecn')).toThrow('MAINTENANCE')
    const selected = join(f.state, 'releases', `${version}-${process.arch === 'x64' ? 'x86_64' : 'aarch64'}-pc-windows-msvc`)
    mkdirSync(selected); symlinkSync(selected, join(f.state, 'current')); rmSync(marker)
    const target = join(selected, 'traex.exe'); writeFileSync(target, bytes)
    f.identities.set('traecn', { ...f.identities.get('traecn')!, executable: target, manifestVersion: version, fingerprint: { realpath: target, size, mtimeMs: 200 } })
    return spawn(options)
  })
  await checked(f.service); f.invalidateModels.mockClear()
  f.service.start('traecn', 'update', f.service.snapshot().entries.find(e => e.cli === 'traecn')!.planToken!, '', '模拟TRAE服务')
  const result = (await finished(f.service)).results[0]!
  expect(result).toMatchObject({ phase: 'succeeded', afterVersion: version, progress: { readable: true } })
  expect(readFileSync(marker, 'utf8')).toBe(`${version}-${process.arch === 'x64' ? 'x86_64' : 'aarch64'}-pc-windows-msvc`)
  expect(f.backend.spawn).toHaveBeenCalledOnce(); expect(f.invalidateModels).toHaveBeenCalledExactlyOnceWith('traecn')
  expect(readdirSync(join(f.root, 'cli-management/downloads'))).toEqual([])
})
it('模拟：下载期间安装身份变化，服务再次核对计划后拒绝放置', async () => {
  const f = fixture('claude', process.arch)
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' }); vi.stubEnv('LOCALAPPDATA', f.options.localAppData)
  const fetch = f.artifactFetch.getMockImplementation()!
  f.artifactFetch.mockImplementation(async (url, init) => {
    if (init?.method !== 'HEAD') f.identities.get('claude')!.fingerprint.mtimeMs++
    return fetch(url, init)
  })
  await checked(f.service)
  f.service.start('claude', 'update', f.service.snapshot().entries.find(e => e.cli === 'claude')!.planToken!, '', '模拟身份变化')
  expect((await finished(f.service)).results[0]).toMatchObject({ phase: 'failed', error: { code: 'PLAN_EXPIRED' } })
  expect(readFileSync(f.target, 'utf8')).toBe('模拟 old'); expect(f.backend.spawn).not.toHaveBeenCalled()
})
