/** 模拟：Windows npm 静默跳过 optionalDependency、发布元数据及下载；不运行真实 CLI。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { npmDependency, npmPlatformMatches, npmPlatformComponents, npmManifest, npmDigest, verifyNpmPlatforms, type NpmManifest } from '../src/host/cli-management/npm-platform.ts'
import { prepareNpmDownload, npmCacheAddArgv, npmDownloadFs } from '../src/host/cli-management/npm-download.ts'
import { currentVersion, ReleaseClient } from '../src/host/cli-management/versions.ts'
import { ChannelMemory, channelMemoryKey, CHANNEL_MEMORY_TTL } from '../src/host/cli-management/channel-memory.ts'
import { parseIntegrity } from '../src/host/cli-management/download.ts'
import { cliDownloadProgressSchema, type CliDownloadProgress } from '../src/shared/cli-management.ts'
import { serviceFixture, checked, finished, sri, control, syntheticIdentity } from './cli-management-phase-b-fixture.ts'
const roots: ReturnType<typeof serviceFixture>[] = []
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); for (const f of roots.splice(0)) await f.close() })
const alias = '@openai/codex-win32-x64'
const main: NpmManifest = { name: '@openai/codex', version: '0.169.0', optionalDependencies: { [alias]: 'npm:@openai/codex@0.169.0-win32-x64', '@openai/codex-linux-x64': 'npm:@openai/codex@0.169.0-linux-x64' }, dist: { tarball: 'https://registry.npmjs.org/main.tgz', integrity: sri('main') } }
const component: NpmManifest = { name: '@openai/codex', version: '0.169.0-win32-x64', os: ['win32'], cpu: ['x64'], dist: { tarball: 'https://registry.npmjs.org/platform.tgz', integrity: sri('platform-platform') } }
const linux = { ...component, version: '0.169.0-linux-x64', os: ['linux'], libc: ['glibc'] }
const host = { platform: 'win32', arch: 'x64' } as const
function write(file: string, value: unknown) { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, JSON.stringify(value)) }
function fixture() {
  const f = serviceFixture(); roots.push(f)
  const manifests = new Map([main, component, linux].map(m => [m.version, m]))
  const fetcher = vi.fn(async (url: unknown) => {
    const version = decodeURIComponent(new URL(String(url)).pathname.split('/').at(-1)!)
    const manifest = manifests.get(version)
    if (!manifest) throw new Error(`Unexpected fixture metadata ${url}`)
    return new Response(JSON.stringify(manifest))
  })
  const releases = new ReleaseClient(fetcher), identity = { ...syntheticIdentity('codex', main.version), prefix: f.root, packageRoot: join(f.root, 'lib/node_modules/@openai/codex') }
  write(join(identity.packageRoot, 'package.json'), main)
  const options = { cli: 'codex' as const, version: main.version, registry: 'https://registry.npmjs.org/', automaticSources: true, root: f.root, releases, signal: control(), identity, host,
    fetcher: vi.fn(async (url: unknown, init?: RequestInit) => { const data = (String(url).includes('main') || String(url).endsWith('codex-0.169.0.tgz')) ? 'main' : 'platform-platform'; return new Response(init?.method === 'HEAD' ? null : data, { headers: { 'content-length': String(Buffer.byteLength(data)), etag: '"test"' } }) }),
    progress: vi.fn<(p: CliDownloadProgress) => void>(), output: vi.fn() }
  return { ...f, releases, manifests, fetcher, identity, options }
}
describe('模拟：npm 平台清单与安装树', () => {
  it('Codex alias 保留安装键但解析真实包名和版本', () => {
    expect(npmDependency(alias, main.optionalDependencies![alias]!)).toEqual({ alias, name: '@openai/codex', range: '0.169.0-win32-x64' })
    expect(npmDependency('opencode-windows-x64', '1.19.5').name).toBe('opencode-windows-x64')
  })
  it.each(['file:/tmp/x', 'https://example.org/a.tgz', 'npm:../x@1.0.0', 'npm:@openai/codex'])('拒绝不可核实的依赖 %s', value => {
    expect(() => npmDependency(alias, value)).toThrow()
  })
  it('从清单选择 os/cpu/libc，包括负列表；不靠包名猜平台', async () => {
    const f = fixture()
    expect((await npmPlatformComponents(main, f.releases, f.options.registry, control(), host)).map(c => c.alias)).toEqual([alias])
    expect(npmPlatformMatches(linux, { platform: 'linux', arch: 'x64', libc: 'musl' })).toBe(false)
    expect(npmPlatformMatches({ ...linux, os: ['!win32'], cpu: ['!arm64'], libc: ['!musl'] }, { platform: 'linux', arch: 'x64', libc: 'glibc' })).toBe(true)
    expect(npmPlatformMatches({ ...linux, cpu: ['x64', '!x64'] }, { platform: 'linux', arch: 'x64', libc: 'glibc' })).toBe(false)
  })
  it('范围依赖从有界 packument 选满足范围的版本', async () => {
    const f = fixture(), releases = new ReleaseClient(async () => new Response(JSON.stringify({ versions: { '1.0.0': { name: 'binary', version: '1.0.0' }, '1.2.0': { name: 'binary', version: '1.2.0' }, '2.0.0': { name: 'binary', version: '2.0.0' } } })))
    expect((await npmManifest(releases, 'binary', '^1.0.0', f.options.registry, control())).version).toBe('1.2.0')
  })
  it('shasum 回退按 SHA-1 校验，绝不当作 sha512', () => {
    const digest = npmDigest({ name: 'binary', version: '1.0.0', dist: { tarball: 'https://example.org/x', shasum: 'a'.repeat(40) } })
    expect(parseIntegrity(digest)).toMatchObject({ algorithm: 'sha1', digest: Buffer.from('a'.repeat(40), 'hex') })
  })
  it('Windows Codex 主包已到目标但缺少平台包必须失败', async () => {
    const f = fixture()
    await expect(verifyNpmPlatforms(f.identity, f.releases, f.options.registry, control(), host)).rejects.toThrow(`平台组件 ${alias} 未安装`)
  })
  it('别名目录中的真实 name/version 匹配才成功，非本机组件不要求安装', async () => {
    const f = fixture(), file = join(f.identity.packageRoot, 'node_modules', alias, 'package.json')
    write(file, component)
    await expect(verifyNpmPlatforms(f.identity, f.releases, f.options.registry, control(), host)).resolves.toBeUndefined()
    write(file, { ...component, name: alias })
    await expect(verifyNpmPlatforms(f.identity, f.releases, f.options.registry, control(), host)).rejects.toThrow('版本不符')
  })
  it('识别同 prefix 下 npm hoist 的平台包', async () => {
    const f = fixture(); write(join(f.root, 'lib/node_modules', alias, 'package.json'), component)
    await expect(verifyNpmPlatforms(f.identity, f.releases, f.options.registry, control(), host)).resolves.toBeUndefined()
  })
  it('背景检查不信任主包版本缓存，损坏条目不能进入 latest', async () => {
    const f = fixture()
    ;(f.service as any).deps.npmCheck = (id: any, _releases: any, registry: string, signal: AbortSignal) => verifyNpmPlatforms(id, f.releases, registry, signal, host)
    f.identities.set('codex', f.identity)
    f.service.cache.rememberVersion('codex', f.identity.fingerprint, main.version)
    await (f.service as any).local('codex', control(), true, false)
    await (f.service as any).remote('codex', control(), true)
    expect(f.service.snapshot().entries.find(e => e.cli === 'codex')).toMatchObject({ installed: true, group: 'failed', reason: 'UNKNOWN_VERSION', currentVersion: undefined, reasonDetail: expect.stringContaining(alias) })
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it('安装后版本路径强制探测，不能用 manifestVersion 绕过失败退出', async () => {
    const f = fixture(); vi.mocked(f.backend.spawn).mockReturnValue({ stdout: Readable.from([]), stderr: Readable.from(['missing platform']), done: Promise.resolve({ exitCode: 1 }), waitForExit: async () => true, terminate() {} } as any)
    await expect(currentVersion('codex', f.identity, f.backend, f.config, control(), false, 5000, true)).rejects.toThrow('Version query failed')
    expect(vi.mocked(f.backend.spawn).mock.calls[0]![0].argv).toEqual([f.identity.executable, '--version'])
  })
})
describe('模拟：统一 npm 多文件下载', () => {
  it('主包完成时仍无总百分比，主包和平台包合计真实字节与最终总量', async () => {
    const f = fixture(), bundle = await prepareNpmDownload(f.options)
    const progress = f.options.progress.mock.calls.map(([p]) => cliDownloadProgressSchema.parse(p))
    expect(progress.find(p => p.completedFiles === 1)).toMatchObject({ downloadedBytes: 4, totalBytes: undefined, byteProgressState: 'unknown-total' })
    expect(progress.at(-1)).toMatchObject({ downloadedBytes: 21, totalBytes: 21, completedFiles: 2, fileCount: 2, channel: 'official' })
    expect(bundle.platforms).toHaveLength(1); expect(existsSync(bundle.main)).toBe(true)
    await bundle.cleanup(true); expect(existsSync(bundle.main)).toBe(false)
  })
  it('选择的镜像摘要与官方不一致时不下载', async () => {
    const f = fixture()
    f.fetcher.mockImplementation(async url => new Response(JSON.stringify({ ...main, dist: { ...main.dist!, integrity: String(url).includes('mirror') ? sri('wrong') : main.dist!.integrity } })))
    f.manifests.set(main.version, { ...main, optionalDependencies: undefined })
    // Separate client to supply no platform edges for this trust-boundary assertion.
    const releases = new ReleaseClient(async url => new Response(JSON.stringify({ ...main, optionalDependencies: undefined, dist: { ...main.dist!, integrity: String(url).includes('mirror') ? sri('wrong') : main.dist!.integrity } })))
    await expect(prepareNpmDownload({ ...f.options, releases, registry: 'https://mirror.example/' })).rejects.toThrow('摘要与官方不符')
    expect(f.options.fetcher).not.toHaveBeenCalled()
  })
  it('平台摘要不符时下载失败，不给 npm 未校验文件', async () => {
    const f = fixture(); f.options.fetcher.mockImplementation(async () => new Response('main', { headers: { 'content-length': '4' } }))
    await expect(prepareNpmDownload(f.options)).rejects.toThrow('校验不通过')
  })
  it('7 天内失败记忆直接接管，接管失败或取消后清除', async () => {
    const f = fixture(), memory = new ChannelMemory(f.root), key = channelMemoryKey('codex', f.identity, host.platform, host.arch)
    await memory.set(key, 'OFFICIAL_STALLED')
    const bundle = await prepareNpmDownload(f.options)
    expect(f.options.progress.mock.calls.at(-1)?.[0]).toMatchObject({ channel: 'takeover', reason: 'OFFICIAL_RECENT_FAILURE' })
    await bundle.cleanup(false); expect(await memory.get(key)).toBeUndefined()
    await memory.set(key, 'OFFICIAL_STALLED', Date.now() - CHANNEL_MEMORY_TTL - 1)
    f.options.progress.mockClear(); const next = await prepareNpmDownload(f.options)
    expect(f.options.progress.mock.calls.at(-1)?.[0].channel).toBe('official'); await next.cleanup(true)
  })
  it('自定义源不越过用户指定的源，cache add 与 install 保持同 runtime/registry/prefix', async () => {
    const f = fixture(), bundle = await prepareNpmDownload({ ...f.options, automaticSources: false })
    expect(f.options.fetcher.mock.calls.every(([url]) => String(url).startsWith('https://registry.npmjs.org/'))).toBe(true)
    expect(npmCacheAddArgv(['C:/node.exe', 'C:/npm-cli.js'], bundle.platforms[0]!, 'C:/Program Files/npm', f.options.registry)).toEqual(['C:/node.exe', 'C:/npm-cli.js', 'cache', 'add', bundle.platforms[0], '--global', '--prefix', 'C:/Program Files/npm', '--registry', f.options.registry])
    await bundle.cleanup(true)
  })
})
it.each([false, true])('模拟服务：npm exit 0，平台 present=%s 必须在核验后才决定成功', async present => {
  const f = fixture(), before = { ...f.identity, manifestVersion: '0.168.0' }
  f.identities.set('codex', before)
  const selectedComponent = component
  ;(f.service as any).deps.npmRuntimeHost = async () => host
  const target = { ...main, optionalDependencies: { [alias]: main.optionalDependencies![alias]! } }
  ;(f.service as any).deps.npmCheck = async (id: any, releases: any, registry: string, signal: AbortSignal, platform?: any, expected?: any) => {
    if (id.manifestVersion === '0.168.0') return
    return verifyNpmPlatforms(id, releases, registry, signal, platform ?? host, expected)
  }
  f.metadataFetch.mockImplementation(async url => {
    if (String(url).endsWith('dist-tags')) return new Response(JSON.stringify({ latest: main.version }))
    const v = decodeURIComponent(new URL(String(url)).pathname.split('/').at(-1)!)
    return new Response(JSON.stringify(v === main.version ? target : selectedComponent))
  })
  f.artifactFetch.mockImplementation(f.options.fetcher as any)
  const commands: string[][] = []
  vi.mocked(f.backend.spawn).mockImplementation(spec => {
    commands.push(spec.argv)
    if (spec.argv.includes('install')) {
      f.identities.set('codex', f.identity); write(join(f.identity.packageRoot, 'package.json'), target)
      if (present) write(join(f.identity.packageRoot, 'node_modules', alias, 'package.json'), selectedComponent)
    }
    return { stdout: Readable.from([]), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0 }), waitForExit: async () => true, terminate() {} } as any
  })
  const row = (await checked(f.service)).entries.find(e => e.cli === 'codex')!
  f.service.start('codex', 'update', row.planToken!, '', 'npm-platform')
  const result = (await finished(f.service)).results[0]!
  expect(result.phase).toBe(present ? 'succeeded' : 'failed')
  if (!present) expect(result.error).toMatchObject({ code: 'VERSION_MISMATCH', message: expect.stringContaining(alias) })
  expect(commands.map(c => c[2])).toEqual(['cache', 'install'])
  expect(commands[1]).toContain('--prefer-offline'); expect(commands[1]).toContain('--include=optional')
  expect(commands[0]).not.toContain('--cache'); expect(commands[1]).not.toContain('--cache')
  expect(result.progress).toMatchObject({ byteProgress: false }); expect(result.progress?.totalBytes).toBeUndefined()
})
it('模拟：官方持续 30 秒无字节后改用接管，安装成功才记忆 7 天', async () => {
  vi.useFakeTimers(); const f = fixture()
  let takeover = false
  f.options.fetcher.mockImplementation(async (url, init) => {
    const isMain = String(url).endsWith('codex-0.169.0.tgz'), data = isMain ? 'main' : 'platform-platform'
    const headers = { 'content-length': String(data.length), etag: '"fixture"' }
    if (init?.method === 'HEAD') { takeover = true; return new Response(null, { headers }) }
    if (isMain && !takeover) return new Response(new ReadableStream({ start() {} }), { headers })
    return new Response(data, { headers })
  })
  const pending = prepareNpmDownload(f.options)
  await vi.waitFor(() => expect(f.options.fetcher).toHaveBeenCalled(), { interval: 1 })
  await vi.advanceTimersByTimeAsync(30_010)
  const bundle = await pending
  expect(f.options.progress.mock.calls.at(-1)![0]).toMatchObject({ channel: 'takeover', reason: 'OFFICIAL_STALLED', completedFiles: 2, downloadedBytes: 21 })
  const memory = new ChannelMemory(f.root), key = channelMemoryKey('codex', f.identity, host.platform, host.arch)
  expect(await memory.get(key)).toBeUndefined()
  await bundle.cleanup(true); expect(await memory.get(key)).toMatchObject({ reason: 'OFFICIAL_STALLED' })
})
it('模拟：首次安装 npm exit 0 但缺平台包，不记录成功路径', async () => {
  const { CliInstaller } = await import('../src/host/cli-management/install.ts')
  const { CliExecutablePathStore } = await import('../src/host/cli-executable-paths.ts')
  const f = fixture(), store = new CliExecutablePathStore(f.root)
  const config = { ...f.config, cliExecutablePaths: store }
  const installer = new CliInstaller({ root: f.root, backend: f.backend, config, releases: f.releases, fetcher: f.options.fetcher, platform: 'win32', arch: 'x64', npmRuntimeHost: async () => host, identify: async () => f.identity, version: f.version })
  const op = { outputTail: '' } as any
  await expect(installer.execute({ cli: 'codex', source: { method: 'npm', command: 'codex' }, target: main.version, directory: f.root, registry: f.options.registry, pathRevision: store.revision('codex'), token: '', npm: [f.npm.node, f.npm.entry], automaticSources: true, offer: { method: 'npm', guideUrl: 'https://example.com', prerequisites: [], selectableLocation: false } }, op, control(), () => {}, async () => {})).rejects.toThrow(`平台组件 ${alias} 未安装`)
  expect(store.read('codex')).toBeUndefined(); expect(op.afterVersion).toBeUndefined()
})

describe('模拟：P2 必需组件分组与离线核验', () => {
  it.each(['opencode-windows-x64', 'opencode-windows-x64-baseline'])('OpenCode 只有 %s 时仍可用', async binary => {
    const f = fixture(), names = ['opencode-windows-x64', 'opencode-windows-x64-baseline']
    const pkg = { name: 'opencode-ai', version: '1.19.5', optionalDependencies: Object.fromEntries(names.map(n => [n, '1.19.5'])) }
    write(join(f.identity.packageRoot, 'package.json'), pkg)
    write(join(f.identity.packageRoot, 'node_modules', binary, 'package.json'), { name: binary, version: pkg.version, os: ['win32'], cpu: ['x64'] })
    await expect(verifyNpmPlatforms(f.identity, f.releases, f.options.registry, control(), host,
      names.map(alias => ({ alias, manifest: { name: alias, version: pkg.version, os: ['win32'], cpu: ['x64'] } })))).resolves.toBeUndefined()
    expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('OpenCode 两种二进制都缺失才失败', async () => {
    const f = fixture()
    write(join(f.identity.packageRoot, 'package.json'), { name: 'opencode-ai', version: '1.19.5', optionalDependencies: { 'opencode-windows-x64': '1.19.5', 'opencode-windows-x64-baseline': '1.19.5' } })
    await expect(verifyNpmPlatforms(f.identity, f.releases, f.options.registry, control(), host)).rejects.toThrow('opencode-windows-x64 / opencode-windows-x64-baseline')
    expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('CodeBuddy 缺少 node-pty 不判损坏，sandbox 仍按必需组件核验', async () => {
    const f = fixture(), sandbox = '@tencent-ai/sandbox-cli-win32-x64', pty = '@lydell/node-pty-win32-x64'
    write(join(f.identity.packageRoot, 'package.json'), { name: '@tencent-ai/codebuddy-code', version: '2.184.0', optionalDependencies: { [sandbox]: '1.0.0', [pty]: '1.0.0' } })
    const component = { name: sandbox, version: '1.0.0', os: ['win32'], cpu: ['x64'] }
    write(join(f.identity.packageRoot, 'node_modules', sandbox, 'package.json'), component)
    await expect(verifyNpmPlatforms(f.identity, f.releases, f.options.registry, control(), host,
      [{ alias: sandbox, manifest: component }, { alias: pty, manifest: { ...component, name: pty } }])).resolves.toBeUndefined()
    expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('注册表完全断网、其他 OS 平台包缺失不影响健康 Codex 本地检查', async () => {
    const f = fixture()
    write(join(f.identity.packageRoot, 'node_modules', alias, 'package.json'), component)
    f.fetcher.mockRejectedValue(new Error('模拟注册表断网'))
    await expect(verifyNpmPlatforms(f.identity, f.releases, f.options.registry, control(), host)).resolves.toBeUndefined()
    expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('持久化验证元数据可在离线重启后发现缺件；元数据缺失本身不是损坏', async () => {
    const { rememberNpmPlatforms } = await import('../src/host/cli-management/npm-platform.ts')
    const f = fixture(), manifest = { name: 'simulated-cli', version: '1.0.0', optionalDependencies: { binary: '1.0.0', 'linux-binary': '1.0.0' } }
    write(join(f.identity.packageRoot, 'package.json'), manifest)
    f.fetcher.mockRejectedValue(new Error('模拟断网'))
    await expect(verifyNpmPlatforms(f.identity, f.releases, f.options.registry, control(), host, undefined, f.root)).resolves.toBeUndefined()
    await rememberNpmPlatforms(f.root, manifest, host, [{ alias: 'binary', manifest: { name: 'binary', version: '1.0.0', os: ['win32'], cpu: ['x64'] } }])
    await expect(verifyNpmPlatforms(f.identity, new ReleaseClient(f.fetcher), f.options.registry, control(), host, undefined, f.root)).rejects.toThrow('平台组件 binary 未安装')
    // A different effective runtime cannot reuse x64 metadata.
    await expect(verifyNpmPlatforms(f.identity, f.releases, f.options.registry, control(), { ...host, arch: 'arm64' }, undefined, f.root)).resolves.toBeUndefined()
    expect(f.fetcher).not.toHaveBeenCalled()
  })
})
it.each([{ platform: 'win32', arch: 'arm64' }, { platform: 'linux', arch: 'x64', libc: 'musl' }])('模拟：使用已解析 npm 的 Node 平台 %j，而非 Harness 架构', async native => {
  const { resolveNpmHost } = await import('../src/host/cli-management/npm.ts')
  const f = fixture()
  vi.mocked(f.backend.spawn).mockReturnValue({ stdout: Readable.from([JSON.stringify(native)]), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0 }), waitForExit: async () => true, terminate() {} } as any)
  await expect(resolveNpmHost(f.backend, f.config, control(), ['C:/native-arm64/node.exe', 'C:/native-arm64/npm-cli.js'])).resolves.toEqual(native)
  const command = vi.mocked(f.backend.spawn).mock.calls[0]![0]
  expect(command.argv.slice(0, 2)).toEqual(['C:/native-arm64/node.exe', '-e'])
  expect(command.env).toBeUndefined() // no proxy environment overrides
})
it('模拟：ARM64 npm 运行时决定实际下载和核验，而非 x64 Harness', async () => {
  const f = fixture(), armAlias = '@openai/codex-win32-arm64', native = { platform: 'win32', arch: 'arm64' } as const
  const arm = { ...component, version: '0.169.0-win32-arm64', cpu: ['arm64'] }
  const target = { ...main, optionalDependencies: { ...main.optionalDependencies, [armAlias]: 'npm:@openai/codex@0.169.0-win32-arm64' } }
  f.manifests.set(main.version, target); f.manifests.set(arm.version, arm)
  const bundle = await prepareNpmDownload({ ...f.options, host: native })
  expect(bundle.components.map(c => c.alias)).toEqual([armAlias])
  write(join(f.identity.packageRoot, 'package.json'), target)
  write(join(f.identity.packageRoot, 'node_modules', armAlias, 'package.json'), arm)
  await expect(verifyNpmPlatforms(f.identity, f.releases, f.options.registry, control(), bundle.host, bundle.components)).resolves.toBeUndefined()
  await expect(verifyNpmPlatforms(f.identity, f.releases, f.options.registry, control(), host)).rejects.toThrow(alias)
  await bundle.cleanup(true)
})

it.each(['stall', 'slow', 'budget'] as const)('模拟：官方 %s 接管保留已收字节，并 Range/If-Range 续传', async mode => {
  vi.useFakeTimers(); const f = fixture(), data = 'platform-platform'
  const requests: { url: string; headers: Record<string, string> }[] = []
  let first = true
  f.options.fetcher.mockImplementation(async (url, init) => {
    const address = String(url), headers = { 'content-length': String(data.length), etag: '"same-content"', 'accept-ranges': 'bytes' }
    if (address.endsWith('codex-0.169.0.tgz')) return new Response('main', { headers: { 'content-length': '4' } })
    if (init?.method === 'HEAD') return new Response(null, { headers })
    const req = (init?.headers ?? {}) as Record<string, string>
    requests.push({ url: address, headers: req })
    if (address.includes('npmjs.org')) {
      const start = first ? 0 : 8; first = false
      return new Response(new ReadableStream({ start(c) {
        if (start === 0) c.enqueue(Buffer.from(data.slice(0, 8)))
      } }), { status: start ? 206 : 200, headers: { ...headers, 'content-length': String(data.length - start), ...(start ? { 'content-range': `bytes ${start}-${data.length - 1}/${data.length}` } : {}) } })
    }
    expect(req).toMatchObject({ Range: 'bytes=8-', 'If-Range': '"same-content"' })
    return new Response(data.slice(8), { status: 206, headers: { ...headers, 'content-length': String(data.length - 8), 'content-range': `bytes 8-${data.length - 1}/${data.length}` } })
  })
  // Independent watchdog reasons use the same transport transition. Exercise
  // 30-second stall end-to-end; slow/budget use the exported transport hook below.
  if (mode !== 'stall') {
    const { downloadCliArtifact } = await import('../src/host/cli-management/download.ts')
    const trigger = new AbortController(), takeover = vi.fn()
    const pending = downloadCliArtifact({ root: f.root, url: 'https://registry.npmjs.org/platform.tgz', sources: ['https://registry.npmjs.org/platform.tgz', 'https://registry.npmmirror.com/platform.tgz'], integrity: sri(data), signal: control(), fetcher: f.options.fetcher, progress: f.options.progress, officialFirst: { signal: trigger.signal, takeover } })
    await vi.waitFor(() => expect(f.options.progress.mock.calls.some(([p]) => p.downloadedBytes === 8)).toBe(true))
    trigger.abort(mode === 'slow' ? 'OFFICIAL_SLOW' : 'OFFICIAL_BUDGET')
    const path = await pending
    expect(existsSync(path)).toBe(true); expect(takeover).toHaveBeenCalledOnce()
  } else {
    const pending = prepareNpmDownload(f.options)
    await vi.waitFor(() => expect(f.options.progress.mock.calls.some(([p]) => p.downloadedBytes === 12)).toBe(true))
    await vi.advanceTimersByTimeAsync(30_010)
    const bundle = await pending
    expect(f.options.progress.mock.calls.at(-1)![0]).toMatchObject({ downloadedBytes: 21, channel: 'takeover', reason: 'OFFICIAL_STALLED' })
    await bundle.cleanup(true)
  }
  const firstPartial = f.options.progress.mock.calls.findIndex(([p]) => (p.downloadedBytes ?? 0) >= (mode === 'stall' ? 12 : 8))
  expect(f.options.progress.mock.calls.slice(firstPartial).every(([p]) => (p.downloadedBytes ?? 0) >= (mode === 'stall' ? 12 : 8))).toBe(true)
  expect(requests.at(-1)!.url).toContain('npmmirror.com')
})
it('模拟 Windows 手动证据：镜像低速后转官方源，保持偏移；无 npm 缓存 packument URL 参与选源', async () => {
  vi.useFakeTimers(); const f = fixture(), data = 'platform-platform'
  await new ChannelMemory(f.root).set(channelMemoryKey('codex', f.identity, host.platform, host.arch), 'OFFICIAL_SLOW')
  let initialOfficial = true, offset = 0
  const requests: { url: string; headers: Record<string, string> }[] = []
  f.options.fetcher.mockImplementation(async (url, init) => {
    const address = String(url), official = address.includes('npmjs.org')
    if (address.endsWith('codex-0.169.0.tgz')) return new Response(init?.method === 'HEAD' ? null : 'main', { headers: { 'content-length': '4', etag: '"main"' } })
    const headers = { 'content-length': String(data.length), etag: '"same"', 'accept-ranges': 'bytes' }
    if (init?.method === 'HEAD') {
      if (official && initialOfficial) { initialOfficial = false; throw new TypeError('fetch failed') }
      return new Response(null, { headers })
    }
    const req = init?.headers as Record<string, string>; requests.push({ url: address, headers: req })
    if (!official) return new Response(new ReadableStream({ start(c) {
      c.enqueue(Buffer.from(data.slice(0, 8))); offset = 8
      // Keep the connection alive at low speed so rotation is speed-triggered.
      setTimeout(() => { c.enqueue(Buffer.from(data.slice(8, 9))); offset = 9 }, 5000)
    } }), { headers })
    expect(req).toMatchObject({ Range: `bytes=${offset}-`, 'If-Range': '"same"' })
    return new Response(data.slice(offset), { status: 206, headers: { ...headers, 'content-length': String(data.length - offset), 'content-range': `bytes ${offset}-${data.length - 1}/${data.length}` } })
  })
  const pending = prepareNpmDownload(f.options)
  await vi.waitFor(() => expect(offset).toBe(8))
  await vi.advanceTimersByTimeAsync(10_010)
  const bundle = await pending
  expect(requests.map(r => new URL(r.url).host)).toEqual(['registry.npmmirror.com', 'registry.npmjs.org'])
  expect(f.options.output.mock.calls.flat().join('')).toContain('下载过慢')
  expect(f.options.progress.mock.calls.at(-1)![0]).toMatchObject({ downloadedBytes: 21, totalBytes: 21 })
  await bundle.cleanup(true)
})
it.each(['ENOSPC', 'EACCES', 'directory'])('模拟：通道记忆或目录清理 %s 不能阻塞结束、锁释放或队列推进', async code => {
  const f = serviceFixture(['codex', 'pi']); roots.push(f)
  vi.mocked(f.backend.spawn).mockImplementation(spec => {
    if (spec.argv.includes('install')) {
      const cli = f.service.snapshot().operation!.cli
      f.identities.set(cli, syntheticIdentity(cli, '1.2.3'))
    }
    return { stdout: Readable.from([]), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0 }), waitForExit: async () => true, terminate() {} } as any
  })
  await checked(f.service)
  if (code === 'directory') vi.spyOn(npmDownloadFs, 'rm').mockRejectedValue(Object.assign(new Error('模拟 rm'), { code: 'EACCES' }))
  else vi.spyOn(ChannelMemory.prototype, 'set').mockRejectedValue(Object.assign(new Error('模拟 cleanup'), { code }))
  f.service.updateAll(`cleanup-${code}`)
  const state = await finished(f.service)
  expect(state.results.map(r => [r.cli, r.phase])).toEqual([['codex', 'succeeded'], ['pi', 'succeeded']])
  expect(state.results.every(r => !!r.finishedAt && r.outputTail.includes('临时文件或下载通道记忆未能清理'))).toBe(true)
  expect((f.service as any).operationRun).toBeUndefined()
  expect(() => f.config.cliMaintenance.assertAvailable('codex')).not.toThrow()
  expect(() => f.config.cliMaintenance.assertAvailable('pi')).not.toThrow()
})
it.each(['changed-validator', 'range-unsupported'])('模拟：仅当 %s 时允许从零重取，仍校验完整摘要', async mode => {
  const { downloadCliArtifact } = await import('../src/host/cli-management/download.ts')
  const f = fixture(), data = 'platform-platform', trigger = new AbortController(), requests: RequestInit[] = []
  const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
    const official = String(url).includes('npmjs.org'), etag = official || mode === 'range-unsupported' ? '"old"' : '"changed"'
    const headers = { 'content-length': String(data.length), etag, 'accept-ranges': 'bytes' }
    if (init?.method === 'HEAD') return new Response(null, { headers })
    if (official) return new Response(new ReadableStream({ start(c) { c.enqueue(Buffer.from(data.slice(0, 8))) } }), { headers })
    requests.push(init!)
    return new Response(data, { headers })
  })
  const pending = downloadCliArtifact({ root: f.root, url: 'https://registry.npmjs.org/platform.tgz', sources: ['https://registry.npmjs.org/platform.tgz', 'https://registry.npmmirror.com/platform.tgz'], integrity: sri(data), signal: control(), fetcher, restartOnValidatorChange: true, progress: f.options.progress, officialFirst: { signal: trigger.signal, takeover() {} } })
  await vi.waitFor(() => expect(f.options.progress.mock.calls.some(([p]) => p.downloadedBytes === 8)).toBe(true))
  trigger.abort(); await pending
  expect(requests).toHaveLength(1)
  expect(new Headers(requests[0]!.headers).get('range')).toBe(mode === 'changed-validator' ? null : 'bytes=8-')
  expect(f.options.progress.mock.calls.at(-1)![0].downloadedBytes).toBe(data.length)
})
it('模拟：单源续传 GET 的 validator 改变，丢弃旧偏移响应后干净重取', async () => {
  const { downloadCliArtifact } = await import('../src/host/cli-management/download.ts')
  const f = fixture(), data = 'platform-platform'
  let calls = 0
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    calls++
    if (calls === 1) return new Response(data.slice(0, 8), { headers: { etag: '"old"', 'content-length': String(data.length) } })
    if (calls === 2) {
      expect(new Headers(init?.headers).get('range')).toBe('bytes=8-')
      return new Response(data.slice(8), { status: 206, headers: { etag: '"new"', 'content-length': String(data.length - 8), 'content-range': `bytes 8-${data.length - 1}/${data.length}` } })
    }
    expect(new Headers(init?.headers).get('range')).toBeNull()
    return new Response(data, { headers: { etag: '"new"', 'content-length': String(data.length) } })
  })
  await downloadCliArtifact({ root: f.root, url: 'https://custom.example/platform.tgz', integrity: sri(data), signal: control(), fetcher, restartOnValidatorChange: true, progress: f.options.progress })
  expect(calls).toBe(3)
})
it('模拟：官方 HTTP 503 仍进入接管，不受新的断点边界阻断', async () => {
  const f = fixture()
  f.options.fetcher.mockImplementation(async (url, init) => {
    if (String(url).includes('npmjs.org')) return new Response(null, { status: 503 })
    const data = String(url).endsWith('codex-0.169.0.tgz') ? 'main' : 'platform-platform'
    return new Response(init?.method === 'HEAD' ? null : data, { headers: { etag: '"same"', 'content-length': String(data.length) } })
  })
  const bundle = await prepareNpmDownload(f.options)
  expect(f.options.progress.mock.calls.at(-1)![0]).toMatchObject({ channel: 'takeover', reason: 'OFFICIAL_EXIT', downloadedBytes: 21 })
  await bundle.cleanup(true)
})
