import { tarFixture } from './cli-management-task4-fixture.ts'
/** 模拟：微型清单、文件与进程，不调用真实 CLI 或发布源。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm, symlink, lstat, readlink, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import type { ActiveCliId } from '../src/shared/types.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import { ReleaseClient } from '../src/host/cli-management/versions.ts'
import { describeNativeUpdate, nativeLayout } from '../src/host/cli-management/artifacts/native.ts'
import { describeTrae } from '../src/host/cli-management/artifacts/windows.ts'
import { nativeMacArch, selectQoderFile } from '../src/host/cli-management/artifacts/platform.ts'
import { atomicMutations, placeNative, verifyGrokSignature } from '../src/host/cli-management/artifacts/transaction.ts'
import { placeArtifact } from '../src/host/cli-management/artifacts/placement.ts'
import { prepareLocalUpdate } from '../src/host/cli-management/local-artifacts.ts'
import type { LocalArtifactOptions } from '../src/host/cli-management/local-artifacts.ts'
import type { ArtifactDescription } from '../src/host/cli-management/artifacts/types.ts'
import { syntheticIdentity, control } from './cli-management-phase-b-fixture.ts'
const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }) })
async function fixture(cli: ActiveCliId, platform: NodeJS.Platform = 'darwin', arch = 'arm64') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'native-update-simulated-'))); roots.push(root)
  const fetcher = vi.fn(async (_url: any) => new Response('{}'))
  const backend: ProcessBackend = { resolveExecutable: vi.fn(async n => n), spawn: vi.fn(() => ({ stdout: Readable.from(['1.2.3\n']), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), waitForExit: vi.fn(async () => true), terminate: vi.fn() })) as any }
  const o: LocalArtifactOptions = { cli, platform, arch, home: root, root, version: '1.2.3', beforeVersion: '1.0.0', identity: { ...syntheticIdentity(cli), source: 'self-update' }, signal: control(), backend, config: { ...DEFAULT_CONFIG }, releases: new ReleaseClient(fetcher), fetcher: vi.fn(async () => new Response(null, { headers: { 'content-length': '10' } })), output: vi.fn(), progress: vi.fn() }
  return { root, o, fetcher, backend }
}
const desc = (targets: string[], platform: NodeJS.Platform = 'darwin'): ArtifactDescription => ({ manifest: { urls: [], version: '1.2.3', versionField: '', platformKey: '' }, files: [], extras: [], placement: { kind: 'none' }, allowedTargets: targets, platform, officialProbe: { kind: 'stage' } })
it.each(['darwin', 'linux', 'win32'] as const)('模拟：Kimi %s 清单双源、压缩和解压 SHA-256、探针及禁用自动更新冒烟', async platform => {
  const f = await fixture('kimi', platform, 'x64'), key = `${platform}-x64`
  f.fetcher.mockResolvedValue(new Response(JSON.stringify({ version: '1.2.3', platforms: { [key]: { filename: 'kimi.exe', checksum: 'a'.repeat(64), zstd: { file: 'kimi.zst', sha256: 'b'.repeat(64) } } } })))
  const d = await describeNativeUpdate(f.o, f.root)
  expect(d.files[0]).toMatchObject({ sources: ['https://cdn.kimi.com/kimi-code/binaries/1.2.3/kimi.zst', 'https://cdn.kimi.ai/kimi-code/binaries/1.2.3/kimi.zst'], compression: 'zstd', integrity: expect.stringMatching(/^sha256-/), decodedIntegrity: expect.stringMatching(/^sha256-/) })
  expect(d.officialProbe.fileRule?.test('kimi-1.2.3.1.2.0.exe.zst.part')).toBe(true)
  await writeFile(join(f.root, d.files[0]!.dest), 'simulated')
  await placeNative(d, f.root, control(), f.o, vi.fn())
  const spawn = vi.mocked(f.backend.spawn).mock.calls[0]![0]
  expect(spawn.argv[1]).toBe('--version'); expect(spawn.env).toMatchObject({ KIMI_CODE_NO_AUTO_UPDATE: '1' })
  expect(dirname(spawn.argv[0]!)).toBe(join(f.root, '.kimi-code/bin'))
  expect(await readFile(join(f.root, `.kimi-code/bin/kimi${platform === 'win32' ? '.exe' : ''}`), 'utf8')).toBe('simulated')
})
it('模拟：Kimi 冒烟版本不符不替换；相等或较低目标不下载', async () => {
  const f = await fixture('kimi'), target = join(f.root, '.kimi-code/bin/kimi'); await mkdir(dirname(target), { recursive: true }); await writeFile(target, 'old'); await writeFile(join(f.root, 'new'), 'new')
  const d = desc([target]); d.placement = { kind: 'native-binary', file: 'new', targets: [target], smoke: { version: '9.0.0', match: 'exact', env: { KIMI_CODE_NO_AUTO_UPDATE: '1' } } }
  await expect(placeNative(d, f.root, control(), f.o, vi.fn())).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  expect(await readFile(target, 'utf8')).toBe('old'); expect(await readdir(dirname(target))).toEqual(['kimi'])
  await expect(prepareLocalUpdate({ ...f.o, version: '1.0.0' })).rejects.toMatchObject({ code: 'PLAN_EXPIRED' }); expect(f.fetcher).not.toHaveBeenCalled()
})
it('模拟：Qoder Windows legacy 排在前面仍按 build/min_windows_build 选择', () => {
  const legacy = { os: 'windows', arch: 'amd64', variant: 'legacy' }, standard = { os: 'windows', arch: 'amd64', variant: 'standard', min_windows_build: 17763 }
  expect(selectQoderFile([legacy, standard], { platform: 'win32', arch: 'x64', windowsBuild: 22631 })).toBe(standard)
  expect(selectQoderFile([legacy, standard], { platform: 'win32', arch: 'x64', windowsBuild: 17000 })).toBe(legacy)
  expect(selectQoderFile([legacy, { ...standard, min_windows_build: 99999 }], { platform: 'win32', arch: 'x64', windowsBuild: 22631 })).toBeUndefined()
  expect(selectQoderFile([legacy, standard], { platform: 'win32', arch: 'arm64', windowsBuild: 22631 })).toBeUndefined()
})
it('模拟：Qoder Linux 缺任一 CPU 标志选 baseline，musl 不开放', () => {
  const baseline = { os: 'linux', arch: 'amd64-baseline' }, fast = { os: 'linux', arch: 'amd64' }, cpuFlags = ['sse4_2', 'popcnt', 'avx', 'avx2', 'bmi1', 'bmi2', 'fma']
  for (const flag of cpuFlags) expect(selectQoderFile([fast, baseline], { platform: 'linux', arch: 'x64', cpuFlags: cpuFlags.filter(f => f !== flag) })).toBe(baseline)
  expect(selectQoderFile([fast, baseline], { platform: 'linux', arch: 'x64', cpuFlags })).toBe(fast)
  expect(selectQoderFile([fast, baseline], { platform: 'linux', arch: 'x64', musl: true })).toBeUndefined()
})
it.each(['qoder', 'qodercn'] as const)('模拟：%s 锁版清单、版本文件、相对链接与 version.txt', async cli => {
  const f = await fixture(cli), bin = cli === 'qoder' ? 'qodercli' : 'qoderclicn', store = join(f.root, cli === 'qoder' ? '.qoder' : '.qoder-cn', 'bin', bin)
  await mkdir(store, { recursive: true }); await writeFile(join(store, `.${bin}-install-resource`), 'curl-bash')
  const base = cli === 'qoder' ? 'https://qoder-ide.oss-accelerate.aliyuncs.com/qodercli' : 'https://static.qoder.com.cn/qoder-cli-cn'
  f.fetcher.mockResolvedValue(new Response(JSON.stringify({ latest: '1.2.3', files: [{ os: 'darwin', arch: 'arm64', url: `${base}/releases/1.2.3/package.tar.gz`, sha256: 'a'.repeat(64) }] })))
  const d = await describeNativeUpdate(f.o, f.root)
  expect(d.manifest.urls).toEqual([`${base}/channels/1.2.3/manifest.json`]); expect(d.officialProbe.hardTimeoutMs).toBe(300000)
  for (const extra of d.extras) if ('content' in extra) await writeFile(join(f.root, extra.dest), extra.content)
  await writeFile(join(f.root, 'package.tar.gz'), tarFixture([{ name: bin, data: 'new' }]))
  const extract = vi.fn()
  await placeNative(d, f.root, control(), f.o, extract)
  expect(await readFile(join(store, 'version.txt'), 'utf8')).toBe('1.2.3\n')
  expect(await realpath(join(f.root, '.local/bin', bin))).toBe(join(store, `${bin}-1.2.3`))
  expect(await readFile(join(f.root, '.local/bin', `.${bin}-install-resource`), 'utf8')).toBe('curl-bash')
})
it.each(['linux', 'win32'] as const)('模拟：MiMo %s 扩展名与默认布局，npm 保持排除', async platform => {
  const f = await fixture('mimo', platform, 'x64'), d = await describeNativeUpdate(f.o, f.root), extension = platform === 'linux' ? '.tar.gz' : '.zip'
  expect(d.files[0]!.sources.every(s => s.endsWith(extension))).toBe(true)
  expect(d.files[0]!.sources[0]).toContain(platform === 'win32' ? 'windows-x64-baseline' : 'linux-x64-baseline')
  expect(d.placement.kind).toBe('native-binary'); expect(nativeLayout('mimo', syntheticIdentity('mimo'), platform, 'x64', f.root)).toBe(false)
})
it.each(['antigravity', 'claude'] as const)('模拟：%s Unix 描述为阶段探针，平台摘要与布局放置', async cli => {
  const f = await fixture(cli)
  f.fetcher.mockResolvedValue(new Response(JSON.stringify(cli === 'claude' ? { version: '1.2.3', platforms: { 'darwin-arm64': { binary: 'claude', checksum: 'a'.repeat(64), size: 10 } } } : { version: '1.2.3', url: 'https://storage.googleapis.com/antigravity-public/antigravity-cli/a.tar.gz', sha512: 'a'.repeat(128) })))
  const d = await describeNativeUpdate(f.o, f.root); expect(d.officialProbe).toMatchObject({ kind: 'stage', phaseOnly: true })
  if (cli === 'claude') {
    await mkdir(join(f.root, '.local/bin'), { recursive: true }); await writeFile(join(f.root, '.local/bin/claude'), 'not a link'); await writeFile(join(f.root, 'claude'), 'new')
    await expect(placeArtifact(d, f.root, control(), vi.fn())).rejects.toThrow()
    expect(await readFile(join(f.root, '.local/bin/claude'), 'utf8')).toBe('not a link')
  } else expect(d.placement).toMatchObject({ kind: 'native-binary', extract: { member: 'antigravity', format: 'tar.gz' } })
})
it('模拟：多目标事务取消回滚、拒绝父目录符号链接与越界目标', async () => {
  const f = await fixture('grok'), one = join(f.root, 'one'), two = join(f.root, 'two'), source = join(f.root, 'new')
  await writeFile(one, 'old-one'); await writeFile(two, 'old-two'); await writeFile(source, 'new')
  const c = new AbortController()
  await expect(atomicMutations([{ target: one, source }, { target: two, source }], desc([one, two]), c.signal, async () => c.abort())).rejects.toThrow()
  expect(await readFile(one, 'utf8')).toBe('old-one'); expect(await readFile(two, 'utf8')).toBe('old-two')
  await expect(atomicMutations([{ target: two, source }], desc([one]), control())).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  await symlink(f.root, join(f.root, 'linked'))
  await expect(atomicMutations([{ target: join(f.root, 'linked/one'), source }], desc([join(f.root, 'linked/one')]), control())).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
})
it('模拟：Codex release.json 摘要、双源、300 秒及 getconf 暂存目录', async () => {
  const f = await fixture('codex')
  vi.mocked(f.backend.spawn).mockImplementation(() => ({ stdout: Readable.from([f.root + '\n']), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), waitForExit: vi.fn(async () => true), terminate: vi.fn() }) as any)
  f.fetcher.mockResolvedValue(new Response(JSON.stringify({ tag_name: 'rust-v1.2.3', assets: [{ name: 'codex-package-aarch64-apple-darwin.tar.gz', digest: 'sha256:' + 'a'.repeat(64) }] })))
  const d = await describeNativeUpdate(f.o, f.root)
  expect(d.officialProbe).toMatchObject({ directory: f.root, hardTimeoutMs: 300000, totalBytes: 10 }); expect(d.files[0]!.sources).toHaveLength(2)
  expect(d.placement).toMatchObject({ kind: 'release-package', argv: ['/bin/sh', join(f.root, 'install.sh'), '--release', '1.2.3'], env: { CODEX_HOME: join(f.root, '.codex'), CODEX_INSTALL_DIR: join(f.root, '.local/bin'), CODEX_INSTALL_DAEMON_ONLY: '0', CODEX_INSTALL_DEFER_SELECTION: '0' } })
})
it('模拟：Grok macOS 签名验证与团队标识均为必做', async () => {
  const f = await fixture('grok'), file = join(f.root, 'grok')
  vi.mocked(f.backend.spawn).mockImplementation(({ argv }) => ({ stdout: Readable.from([]), stderr: Readable.from(argv.includes('-dv') ? ['TeamIdentifier=WRONG\n'] : []), done: Promise.resolve({ exitCode: 0, signal: null }), waitForExit: vi.fn(async () => true), terminate: vi.fn() }) as any)
  await expect(verifyGrokSignature(f.o, [file], control())).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  expect(vi.mocked(f.backend.spawn).mock.calls.map(c => c[0].argv)).toEqual([['/usr/bin/codesign', '--verify', '--strict', file], ['/usr/bin/codesign', '-dv', '--verbose=4', file]])
})
it.each(['darwin', 'linux', 'win32'] as const)('模拟：TRAE %s 离线包依赖、子进程 PATH、恢复原 auto_update 与标记', async platform => {
  const f = await fixture('traecn', platform, 'x64'), win = platform === 'win32', key = `${win ? 'windows' : platform === 'darwin' ? 'macos' : 'linux'}-x86_64`, base = 'https://lf-cdn.trae.com.cn/obj/trae-com-cn/trae-cli'
  f.o.identity!.channel = 'public'; f.o.identity!.releaseChannel = 'stable'; f.o.localAppData = join(f.root, 'local')
  const artifact = (filename: string, path: string, compression: string) => ({ platform: key, filename, url: `${base}/v2/${path}/${filename}`, compression, size: 10, sha256: 'a'.repeat(64) })
  const main = { ...artifact(`traex-${key}${win ? '.exe' : ''}.gz`, 'releases/1.2.3', 'gzip'), sidecars: [{ ...artifact(`traex-code-mode-host-${key}${win ? '.exe' : ''}.gz`, 'releases/1.2.3', 'gzip'), name: 'code_mode_host' }] }
  f.fetcher.mockImplementation(async (url: any) => new Response(JSON.stringify(String(url).includes('/releases/') ? { version: '1.2.3', channel: 'public', release_channel: 'stable', distribution: 'public', build_channel: 'internal', artifacts: [main] } : { artifacts: [{ ...artifact(`${String(url).includes('bubblewrap') ? 'bwrap' : 'rg'}-${key}.${win ? 'zip' : 'tar.gz'}`, `deps/${String(url).includes('bubblewrap') ? 'bubblewrap' : 'ripgrep'}/1.0.0`, win ? 'zip' : 'tar.gz'), archive_path: `folder/${String(url).includes('bubblewrap') ? 'bwrap' : win ? 'rg.exe' : 'rg'}` }] })))
  const state = win ? join(f.o.localAppData!, 'TraeCLI') : join(f.root, '.local/share/traecli'), suffix = win ? 'x86_64-pc-windows-msvc' : platform === 'darwin' ? 'x86_64-apple-darwin' : 'x86_64-unknown-linux-musl', old = join(state, 'releases', `1.0.0-${suffix}`), next = join(state, 'releases', `1.2.3-${suffix}`)
  await mkdir(old, { recursive: true }); await mkdir(next); await writeFile(join(old, 'trae-installation.json'), '{"auto_update":true,"channel":"public"}'); await symlink(old, join(state, 'current')); await writeFile(join(state, 'auto-update-version'), 'old')
  const d = await describeTrae(f.o, f.root, control(), f.root, f.o.localAppData)
  expect(d.files).toHaveLength(platform === 'linux' ? 4 : 3)
  if (!win && d.placement.kind === 'official-local') { expect(d.placement.argv).toEqual(['/bin/sh', join(f.root, 'install_v2.sh'), 'offline-install', f.root]); expect(d.placement.env!.PATH).toBe([process.env.PATH ?? '', join(f.root, '.local/bin')].join(':')); expect(d.placement.env!.TMPDIR).toBe(f.root) }
  const after = await d.after!(control()); await rm(join(state, 'current')); await symlink(next, join(state, 'current')); await writeFile(join(next, 'trae-installation.json'), '{"auto_update":false,"channel":"public"}')
  await after(control()); expect(JSON.parse(await readFile(join(next, 'trae-installation.json'), 'utf8')).auto_update).toBe(true); expect(await readFile(join(state, 'auto-update-version'), 'utf8')).toBe(`1.2.3-${suffix}`)
})
it.each(['cursor', 'installer', 'minimum', 'maximum', 'required', 'layout'])('模拟：Grok 前提 %s 不满足即拒绝接管', async mode => {
  const f = await fixture('grok'), downloads = join(f.root, '.grok/downloads'), bin = join(f.root, '.grok/bin'), old = join(downloads, 'grok-old')
  await mkdir(downloads, { recursive: true }); await mkdir(bin); await writeFile(old, 'old'); await symlink(old, join(bin, 'grok'))
  f.o.identity = { ...f.o.identity!, executable: join(bin, 'grok'), fingerprint: { realpath: mode === 'layout' ? '/outside/grok' : old, mtimeMs: 1, size: 3 } }
  await writeFile(join(f.root, '.grok/config.toml'), `[cli]\ninstaller = "${mode === 'installer' ? 'npm' : 'internal'}"\n${mode === 'minimum' ? 'minimum_version = "9.0.0"' : mode === 'maximum' ? 'maximum_version = "1.0.0"' : mode === 'required' ? 'required_version = "2.0.0"' : ''}\n`)
  if (mode === 'cursor') { await mkdir(join(f.root, '.cursor')); await writeFile(join(f.root, '.cursor/grok-switch.json'), '{"status":"pending"}') }
  await expect(describeNativeUpdate(f.o, f.root)).rejects.toMatchObject({ code: 'PREREQUISITE_MISSING' }); expect(f.fetcher).not.toHaveBeenCalled()
})
it('模拟：Grok Win32 三个 grove 与 MinGit SHA-256、已有版本跳过', async () => {
  const f = await fixture('grok', 'win32', 'x64'), bin = join(f.root, '.grok/bin'); await mkdir(bin, { recursive: true }); await writeFile(join(bin, 'grok.exe'), 'old'); await writeFile(join(f.root, '.grok/config.toml'), '[cli]\ninstaller = "internal"\n')
  f.o.identity = { ...f.o.identity!, executable: join(bin, 'grok.exe'), fingerprint: { realpath: join(bin, 'grok.exe'), size: 3, mtimeMs: 1 } }; f.o.localAppData = join(f.root, 'local')
  f.fetcher.mockImplementation(async (url: any) => new Response(String(url).endsWith('.version') ? '2.55.0.windows.5' : 'a'.repeat(64)))
  const d = await describeNativeUpdate(f.o, f.root); expect(d.files).toHaveLength(5); expect(d.files[4]!.integrity).toMatch(/^sha256-/)
  expect(d.placement).toMatchObject({ kind: 'native-binary', signature: 'grok', targets: [join(bin, 'grok.exe'), join(bin, 'agent.exe')], companions: expect.any(Array) })
  if (d.placement.kind === 'native-binary') expect(d.placement.companions).toHaveLength(3)
  await mkdir(join(f.o.localAppData, 'grok/git/2.55.0.windows.5'), { recursive: true })
  expect((await describeNativeUpdate(f.o, f.root)).files).toHaveLength(4)
})
it('模拟：Grok Unix 更新 downloads 版本文件、相对双链接并清除旧模型缓存', async () => {
  const f = await fixture('grok', 'linux', 'x64'), downloads = join(f.root, '.grok/downloads'), bin = join(f.root, '.grok/bin'), old = join(downloads, 'grok-old')
  await mkdir(downloads, { recursive: true }); await mkdir(bin); await writeFile(old, 'old'); await symlink('../downloads/grok-old', join(bin, 'grok')); await symlink('../downloads/grok-old', join(bin, 'agent'))
  f.o.identity = { ...f.o.identity!, executable: join(bin, 'grok'), fingerprint: { realpath: old, mtimeMs: 1, size: 3 } }
  await writeFile(join(f.root, '.grok/config.toml'), '[cli]\ninstaller = "internal"\n'); await writeFile(join(f.root, '.grok/models_cache.json'), '{}')
  const d = await describeNativeUpdate(f.o, f.root), after = await d.after!(control()); await writeFile(join(f.root, 'grok'), 'new')
  await placeNative(d, f.root, control(), f.o, vi.fn()); await after(control())
  for (const name of ['grok', 'agent']) expect(await readlink(join(bin, name))).toBe('../downloads/grok-1.2.3-linux-x86_64')
  expect(await readFile(join(downloads, 'grok-1.2.3-linux-x86_64'), 'utf8')).toBe('new')
  await expect(lstat(join(f.root, '.grok/models_cache.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})
it('模拟：Grok Windows 签名状态和签名主体双校验、PowerShell 使用参数数组', async () => {
  const f = await fixture('grok', 'win32', 'x64'), file = join(f.root, 'grok.exe')
  const response = (Status: string, Subject: string) => vi.mocked(f.backend.spawn).mockImplementation(() => ({ stdout: Readable.from([JSON.stringify({ Status, Subject })]), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), waitForExit: async () => true, terminate() {} }) as any)
  response('Valid', 'CN=Wrong'); await expect(verifyGrokSignature(f.o, [file], control())).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  response('NotSigned', 'CN=X.AI LLC'); await expect(verifyGrokSignature(f.o, [file], control())).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  response('Valid', 'CN=X.AI LLC, O=X.AI LLC'); await verifyGrokSignature(f.o, [file], control())
  expect(vi.mocked(f.backend.spawn).mock.calls.at(-1)![0].argv).toEqual(expect.arrayContaining(['-ExecutionPolicy', 'Bypass', '-File', join(f.root, 'verify-signature.ps1'), file]))
})

it('模拟：Qoder 与 Codex 的 macOS Rosetta 选择原生 arm64，原生及未知保持架构', async () => {
  expect(await nativeMacArch('darwin', 'x64', async () => '1\n')).toBe('arm64')
  expect(await nativeMacArch('darwin', 'x64', async () => '0\n')).toBe('x64')
  expect(await nativeMacArch('darwin', 'x64', async () => { throw new Error('unknown') })).toBe('x64')
  const read = vi.fn(); expect(await nativeMacArch('linux', 'x64', read)).toBe('x64'); expect(read).not.toHaveBeenCalled()
})

it('模拟：临时件冒烟进程退出未确认时保留暂存、旧入口不变', async () => {
  const f = await fixture('kimi'), target = join(f.root, 'kimi'), source = join(f.root, 'new'); await writeFile(target, 'old'); await writeFile(source, 'new')
  await expect(atomicMutations([{ target, source }], desc([target]), control(), async () => { throw new ProcessCleanupUnconfirmedError() })).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
  expect(await readFile(target, 'utf8')).toBe('old'); expect((await readdir(f.root)).some(name => name.startsWith('kimi.tmp.'))).toBe(true)
})
