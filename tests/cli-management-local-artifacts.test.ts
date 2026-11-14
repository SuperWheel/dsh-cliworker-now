/** 模拟：官方脚本、HEAD、归档解包、离线清单与进程均由夹具提供；不执行安装器。 */
import { ChannelMemory, channelMemoryKey } from '../src/host/cli-management/channel-memory.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { canPrepareLocalUpdate, prepareLocalUpdate } from '../src/host/cli-management/local-artifacts.ts'
import { LOCAL_INSTALLERS } from '../src/host/cli-management/sources.ts'
import { checked, control, finished, serviceFixture, syntheticIdentity } from './cli-management-phase-b-fixture.ts'
const fixtures: ReturnType<typeof serviceFixture>[] = []
const fixture = () => { const f = serviceFixture(['mimo', 'opencode', 'traecn']); fixtures.push(f); return f }
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close() })
const identity = (cli: 'mimo' | 'opencode' | 'traecn') => ({ ...syntheticIdentity(cli), source: 'self-update' as const, executable: join(homedir(), cli === 'traecn' ? '.local/bin/traecli' : cli === 'mimo' ? '.mimocode/bin/mimo' : LOCAL_INSTALLERS[cli].entry), channel: cli === 'traecn' ? 'public' : undefined })
const md5Headers = { etag: '"fixture-object"', 'content-md5': createHash('md5').update('模拟').digest('hex'), 'content-length': '6' }
const child = () => ({ stdout: Readable.from([]), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), waitForExit: vi.fn(async () => true), terminate: vi.fn() })
const options = (f: ReturnType<typeof fixture>, cli: 'mimo' | 'opencode' | 'traecn') => ({ cli, version: '1.2.3', identity: identity(cli), root: f.root, backend: f.backend, config: f.config, releases: f.releases, signal: control(), output: vi.fn(), progress: vi.fn(), fetcher: f.artifactFetch, platform: 'darwin' as const, arch: 'arm64' })
function binaryNetwork(f: ReturnType<typeof fixture>) {
  f.artifactFetch.mockImplementation(async (_url, init) => init?.method === 'HEAD' ? new Response(null, { headers: md5Headers }) : new Response('模拟', { headers: md5Headers }))
  vi.mocked(f.backend.spawn).mockImplementation(({ argv }) => { writeFileSync(join(argv.at(-1)!, argv[3]!), '模拟可执行文件', { mode: 0o600 }); return child() })
}
it.each(['opencode', 'mimo'] as const)('模拟：%s 官方包经 HEAD 长度校验，只提取根成员并交给 --binary', async cli => {
  const f = fixture(); binaryNetwork(f)
  const local = await prepareLocalUpdate(options(f, cli)), binary = local.argv[3]!, directory = dirname(binary)
  expect(local.argv).toEqual(['/bin/bash', join(directory, 'install.sh'), '--binary', binary, '--no-modify-path'])
  expect(readFileSync(binary, 'utf8')).toBe('模拟可执行文件'); expect(statSync(directory).mode & 0o777).toBe(0o700)
  expect(statSync(join(directory, 'package.zip')).mode & 0o777).toBe(0o600)
  expect(f.backend.spawn).toHaveBeenCalledOnce(); expect(vi.mocked(f.backend.spawn).mock.calls[0]![0].argv).toEqual(['/usr/bin/unzip', '-q', join(directory, 'package.zip'), cli, '-d', directory])
  const head = f.artifactFetch.mock.calls.find(c => c[1]?.method === 'HEAD')!
  expect(String(head[0])).toBe(`${LOCAL_INSTALLERS[cli].base}/v1.2.3/${LOCAL_INSTALLERS[cli].archive}-darwin-arm64.zip`)
  await local.cleanup(); expect(existsSync(directory)).toBe(false)
})
it.each(['bad-length', 'wrong-host', 'symlink'])('模拟：本地交接拒绝 %s 且只清理私有文件', async mode => {
  const f = fixture(); binaryNetwork(f)
  if (mode === 'bad-length') f.artifactFetch.mockImplementation(async (_url, init) => init?.method === 'HEAD' ? new Response(null) : new Response('模拟'))
  if (mode === 'wrong-host') f.artifactFetch.mockImplementation(async (_url, init) => init?.method === 'HEAD' ? new Response(null, { status: 302, headers: { location: 'https://attacker.invalid/a' } }) : new Response('模拟'))
  if (mode === 'symlink') vi.mocked(f.backend.spawn).mockImplementation(({ argv }) => { symlinkSync('/模拟/不能使用', join(argv.at(-1)!, argv[3]!)); return child() })
  await expect(prepareLocalUpdate(options(f, 'opencode'))).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  expect(readdirSync(join(f.root, 'cli-management/downloads'))).toEqual([])
})
it('模拟：GitHub 签名工件只允许已核实的 HTTPS release-assets 跳转', async () => {
  const f = fixture(); binaryNetwork(f)
  f.artifactFetch.mockImplementation(async (url, init) => {
    if (init?.method === 'HEAD' && String(url).startsWith('https://github.com/')) return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/fixture?signature=fixture' } })
    return new Response(init?.method === 'HEAD' ? null : '模拟', { headers: { 'content-length': '6' } })
  })
  const local = await prepareLocalUpdate(options(f, 'opencode'))
  expect(f.artifactFetch.mock.calls.some(c => String(c[0]).includes('?signature=') && c[1]?.redirect === 'error')).toBe(true)
  await local.cleanup()
})
it('模拟：npm/brew、自定义路径和 Windows 保持原更新器，不套用默认本地安装位置', () => {
  for (const cli of ['mimo', 'opencode'] as const) {
    expect(canPrepareLocalUpdate(cli, { ...identity(cli), source: 'npm' })).toBe(false)
    expect(canPrepareLocalUpdate(cli, { ...identity(cli), executable: '/自定义/bin/tool' })).toBe(false)
    expect(canPrepareLocalUpdate(cli, identity(cli), 'win32')).toBe(false)
  }
  expect(canPrepareLocalUpdate('traecn', { ...identity('traecn'), channel: 'internal' })).toBe(false)
})
it.each(['darwin', 'linux', 'win32'] as const)('模拟：TRAE %s 不接管下载或触发 offline-install', async platform => {
  const f = fixture()
  expect(canPrepareLocalUpdate('traecn', identity('traecn'), platform)).toBe(false)
  expect(canPrepareLocalUpdate('traecn', undefined, platform)).toBe(false)
  await expect(prepareLocalUpdate({ ...options(f, 'traecn'), platform })).rejects.toMatchObject({ code: 'PREREQUISITE_MISSING' })
  expect(f.artifactFetch).not.toHaveBeenCalled(); expect(f.backend.spawn).not.toHaveBeenCalled()
})
it('模拟：MiMo 仅接管已核实 macOS zip，Linux 留原生更新器', () => {
  expect(canPrepareLocalUpdate('mimo', identity('mimo'), 'darwin')).toBe(true)
  expect(canPrepareLocalUpdate('mimo', identity('mimo'), 'linux')).toBe(false)
})
it('模拟：OMP 官方摘要工件通过 PI_BUILD_URL 本地清单交给原脚本，禁止源码安装', async () => {
  const f = fixture(), sha256 = createHash('sha256').update('模拟').digest('hex')
  const id = { ...syntheticIdentity('omp'), source: 'self-update' as const, executable: join(homedir(), '.local/bin/omp') }
  f.metadataFetch.mockResolvedValue(new Response(JSON.stringify({ build: { version: '1.2.3' }, file: { platform: 'macos', arch: 'arm64', name: 'omp-darwin-arm64', sha256, size: 6 }, download: 'https://d4c085d38fe197a3f20bbeb20222b8b3.r2.cloudflarestorage.com/ompcast/builds/omp/fixture/omp?signature=fixture' })))
  f.artifactFetch.mockImplementation(async () => new Response('模拟'))
  const local = await prepareLocalUpdate({ ...options(f, 'mimo'), cli: 'omp', identity: id })
  expect(f.artifactFetch).toHaveBeenCalledWith('https://raw.githubusercontent.com/can1357/oh-my-pi/main/scripts/install.sh', expect.objectContaining({ redirect: 'error', credentials: 'omit' }))
  const directory = dirname(local.argv[1]!), metadata = JSON.parse(readFileSync(join(directory, 'api/products/omp/versions/1.2.3/macos-arm64'), 'utf8'))
  expect(local.argv).toEqual(['/bin/sh', join(directory, 'install.sh'), '--binary', '--ref', 'v1.2.3'])
  expect(local.env?.PI_BUILD_URL).toBe(new URL(`file://${directory}`).href)
  expect(metadata.download).toBe(new URL(`file://${directory}/omp`).href)
  expect(readFileSync(join(directory, 'omp'), 'utf8')).toBe('模拟'); expect(f.backend.spawn).not.toHaveBeenCalled()
  await local.cleanup()
})
it('模拟：TRAE 服务使用原生相同 argv 中断重跑，不调用离线安装器', async () => {
  const f = fixture(); f.identities.clear(); f.identities.set('traecn', identity('traecn'))
  f.metadataFetch.mockResolvedValue(new Response(JSON.stringify({ version: '1.2.3', binary_version: '1.2.3', channel: 'public', release_channel: 'stable', artifacts: [{ platform: 'macos-aarch64', url: 'https://fixture.invalid/trae.gz', size: 6, sha256: 'a'.repeat(64) }] })))
  let attempts = 0
  vi.mocked(f.backend.spawn).mockImplementation(({ argv, env }) => {
    expect(argv).toEqual([identity('traecn').executable, 'update', '--channel', 'public', '--version', '1.2.3'])
    expect(env?.TRAECLI_CHANNEL).toBeUndefined()
    if (++attempts === 2) f.identities.get('traecn')!.manifestVersion = '1.2.3'
    return { ...child(), stdout: Readable.from(attempts === 1 ? ['curl: (18) transfer closed\n'] : []) }
  })
  // 模拟：已有官方失败记忆；保留原接管/核验回归，官方优先另有独立用例。
  for (const [cli, id] of f.identities) {
    if (cli === 'mimo' || cli === 'omp') await new ChannelMemory(f.root).set(channelMemoryKey(cli, id), 'OFFICIAL_INTERRUPTED')
  }
  await checked(f.service)
  f.service.start('traecn', 'update', f.service.snapshot().entries.find(e => e.cli === 'traecn')!.planToken!, '', '模拟TRAE原生重跑')
  const result = (await finished(f.service)).results[0]!
  expect(result).toMatchObject({ phase: 'succeeded', afterVersion: '1.2.3', progress: { retryCount: 1 } })
  expect(f.backend.spawn).toHaveBeenCalledTimes(2); expect(f.artifactFetch).not.toHaveBeenCalled()
})
it('模拟：OMP 本地工件锁定目标，实际版本虽前进但不等于工件目标仍失败', async () => {
  const f = fixture(), sha256 = createHash('sha256').update('模拟').digest('hex')
  f.identities.clear(); f.identities.set('omp', { ...syntheticIdentity('omp'), source: 'self-update', executable: join(homedir(), '.local/bin/omp') })
  const metadataFetch = f.metadataFetch.getMockImplementation()!
  f.metadataFetch.mockImplementation(async (url, init) => String(url).startsWith(LOCAL_INSTALLERS.omp.base) ? new Response(JSON.stringify({ build: { version: '1.2.3' }, file: { platform: 'macos', arch: 'arm64', name: 'omp-darwin-arm64', sha256, size: 6 }, download: 'https://d4c085d38fe197a3f20bbeb20222b8b3.r2.cloudflarestorage.com/ompcast/builds/omp/fixture/omp?signature=fixture' })) : metadataFetch(url, init))
  f.artifactFetch.mockImplementation(async () => new Response('模拟'))
  vi.mocked(f.backend.spawn).mockImplementation(() => { f.identities.get('omp')!.manifestVersion = '1.2.4'; return child() })
  // 模拟：已有官方失败记忆；保留原接管/核验回归，官方优先另有独立用例。
  for (const [cli, id] of f.identities) {
    if (cli === 'mimo' || cli === 'omp') await new ChannelMemory(f.root).set(channelMemoryKey(cli, id), 'OFFICIAL_INTERRUPTED')
  }
  await checked(f.service)
  f.service.start('omp', 'update', f.service.snapshot().entries.find(e => e.cli === 'omp')!.planToken!, '', '模拟锁定版本')
  expect((await finished(f.service)).results[0]).toMatchObject({ phase: 'failed', afterVersion: '1.2.4', error: { code: 'VERSION_MISMATCH' } })
  expect(f.backend.spawn).toHaveBeenCalledOnce()
})

it.each(['success', 'wrong-version', 'wrong-identity'] as const)('模拟：MiMo 本地脚本交接维护锁与安装后核对 %s', async mode => {
  const f = fixture(); f.identities.clear(); f.identities.set('mimo', identity('mimo')); binaryNetwork(f)
  f.metadataFetch.mockResolvedValue(new Response('1.2.3'))
  vi.mocked(f.backend.spawn).mockImplementation(({ argv }) => {
    expect(() => f.config.cliMaintenance.assertAvailable('mimo')).toThrow('MAINTENANCE')
    if (argv[0] === '/usr/bin/unzip') writeFileSync(join(argv.at(-1)!, 'mimo'), '模拟二进制')
    else {
      expect(argv).toEqual(['/bin/bash', expect.stringContaining('/local-'), '--binary', expect.stringContaining('/local-'), '--no-modify-path'])
      expect(readFileSync(argv[1]!, 'utf8')).toBe('模拟')
      f.identities.get('mimo')!.manifestVersion = mode === 'wrong-version' ? '1.2.4' : '1.2.3'
      if (mode === 'wrong-identity') f.identities.get('mimo')!.executable = '/模拟/别的安装/mimo'
    }
    return child()
  })
  // 模拟：已有官方失败记忆；保留原接管/核验回归，官方优先另有独立用例。
  for (const [cli, id] of f.identities) {
    if (cli === 'mimo' || cli === 'omp') await new ChannelMemory(f.root).set(channelMemoryKey(cli, id), 'OFFICIAL_INTERRUPTED')
  }
  await checked(f.service)
  f.service.start('mimo', 'update', f.service.snapshot().entries.find(e => e.cli === 'mimo')!.planToken!, '', '模拟MiMo接管')
  const result = (await finished(f.service)).results[0]!
  expect(result.phase).toBe(mode === 'success' ? 'succeeded' : 'failed')
  if (mode !== 'success') expect(result.error?.code).toBe(mode === 'wrong-version' ? 'VERSION_MISMATCH' : 'IDENTITY_CHANGED')
  expect(result.outputTail).toContain('content-md5 与 zip 结构')
  expect(f.backend.spawn).toHaveBeenCalledTimes(2)
  expect(() => f.config.cliMaintenance.assertAvailable('mimo')).not.toThrow()
  expect(readdirSync(join(f.root, 'cli-management/downloads'))).toEqual([])
})
it('模拟：MiMo zip 中断用 Range 保留字节后才解包，脚本仅来自内置地址', async () => {
  const f = fixture(); binaryNetwork(f); let gets = 0
  const headers = { 'content-length': '6', etag: '"same-object"', 'content-md5': createHash('md5').update('abcdef').digest('base64') }
  f.artifactFetch.mockImplementation(async (url, init) => {
    if (String(url) === LOCAL_INSTALLERS.mimo.script) return new Response('模拟脚本')
    if (init?.method === 'HEAD') return new Response(null, { headers })
    if (++gets === 1) return new Response('abc', { headers })
    expect((init?.headers as Record<string, string>).Range).toBe('bytes=3-')
    return new Response('def', { status: 206, headers: { ...headers, 'content-length': '3', 'content-range': 'bytes 3-5/6' } })
  })
  const opts = options(f, 'mimo'), local = await prepareLocalUpdate(opts)
  expect(readFileSync(join(dirname(local.argv[3]!), 'package.zip'), 'utf8')).toBe('abcdef')
  expect(gets).toBe(2); expect(opts.progress.mock.calls.at(-1)![0].resumeCount).toBe(1)
  await local.cleanup()
})
it('模拟：MiMo zip 解压结构失败不调用安装脚本并清理私有目录', async () => {
  const f = fixture(); binaryNetwork(f)
  vi.mocked(f.backend.spawn).mockImplementation(() => ({ ...child(), done: Promise.resolve({ exitCode: 2, signal: null }) }))
  await expect(prepareLocalUpdate(options(f, 'mimo'))).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  expect(f.backend.spawn).toHaveBeenCalledOnce(); expect(readdirSync(join(f.root, 'cli-management/downloads'))).toEqual([])
})

it.each(['symlink', 'missing', 'cancel'] as const)('模拟：MiMo %s 不交安装器且仅清理私有下载目录', async mode => {
  const f = fixture(); binaryNetwork(f)
  const controller = new AbortController()
  vi.mocked(f.backend.spawn).mockImplementation(({ argv }) => {
    if (mode === 'symlink') symlinkSync('/模拟/外部文件', join(argv.at(-1)!, 'mimo'))
    if (mode === 'cancel') controller.abort(new Error('模拟取消'))
    return child()
  })
  await expect(prepareLocalUpdate({ ...options(f, 'mimo'), signal: controller.signal })).rejects.toThrow()
  expect(f.backend.spawn).toHaveBeenCalledOnce(); expect(readdirSync(join(f.root, 'cli-management/downloads'))).toEqual([])
})

it('模拟：自定义下载设置禁止 MiMo 自动换源，仍在首选源 Range 恢复并校验 MD5', async () => {
  const f = fixture(); binaryNetwork(f); let gets = 0
  const headers = { 'content-length': '6', etag: '"same"', 'content-md5': createHash('md5').update('abcdef').digest('hex') }
  f.artifactFetch.mockImplementation(async (url, init) => {
    if (String(url) === LOCAL_INSTALLERS.mimo.script) return new Response('模拟脚本')
    expect(String(url)).toContain('cnbj1.fds.api.xiaomi.com')
    if (init?.method === 'HEAD') return new Response(null, { headers })
    return ++gets === 1 ? new Response('abc', { headers }) : new Response('def', { status: 206, headers: { ...headers, 'content-length': '3', 'content-range': 'bytes 3-5/6' } })
  })
  const opts = { ...options(f, 'mimo'), allowSourceSwitch: false }, local = await prepareLocalUpdate(opts)
  expect(gets).toBe(2); expect(opts.output.mock.calls.some(c => c[0].includes('切换到'))).toBe(false)
  await local.cleanup()
})
