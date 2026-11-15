/** 模拟：PRD 5.3.1 全部更新来源、命令、版本核对与桌面接口；无真实 CLI/网络。 */
import { afterEach, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { mkdirSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ActiveCliId } from '../src/shared/types.ts'
import { CLI_IDS } from '../src/shared/types.ts'
import { CLI_SOURCES, NATIVE_RELEASES, NATIVE_UPDATES, isDesktopCli } from '../src/host/cli-management/sources.ts'
import { ReleaseClient, RELEASE_JSON_LIMIT, currentVersion, piNotice } from '../src/host/cli-management/versions.ts'
import { planCliOperation, operationArgv, verifyUpdatedVersion, sameInstallation, updateProblem } from '../src/host/cli-management/planner.ts'
import { identifyInstallation, classifyInstallation, type InstallationIdentity } from '../src/host/cli-management/identity.ts'
import { PI_SUPPORTED_VERSIONS, inspectPiInstallation } from '../src/host/pi-installation.mjs'
import { readDesktopRelease, runDesktopUpdate, DesktopUnavailableError } from '../src/host/cli-management/desktop-update.ts'
import { localCheckTimeoutMs, LOCAL_CHECK_TIMEOUT_DETAIL } from '../src/host/cli-management/service.ts'
import { ChannelMemory } from '../src/host/cli-management/channel-memory.ts'
import { serviceFixture, syntheticIdentity, checked, control, finished, sri } from './cli-management-phase-b-fixture.ts'
import { simulatedPiInstallation } from './pi-installation-integrity-fixture.ts'

vi.mock('../src/host/cli-management/desktop-update.ts', () => ({
  readDesktopRelease: vi.fn(), runDesktopUpdate: vi.fn(),
  DesktopUnavailableError: class extends Error { constructor(readonly reason: string) { super(reason) } },
}))
const fixtures: ReturnType<typeof serviceFixture>[] = []
const json = (value: unknown) => new Response(JSON.stringify(value))
const exited = () => ({ stdout: Readable.from([]), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), terminate: vi.fn(), waitForExit: vi.fn(async () => true) })
const identity = (cli: ActiveCliId): InstallationIdentity => ({ ...syntheticIdentity(cli), source: isDesktopCli(cli) ? 'desktop-app' : cli === 'codex' ? 'official-installer' : 'self-update', channel: cli === 'traecn' ? 'public' : cli === 'hermes' ? 'canary' : undefined,
  ...(cli === 'codebuddy' ? { executable: '/模拟/.local/bin/codebuddy', updateRoot: '/模拟/.local/share/codebuddy', fingerprint: { realpath: '/模拟/.local/share/codebuddy/versions/1.0.0/codebuddy', size: 10, mtimeMs: 1 } } : {}),
  ...(isDesktopCli(cli) ? { appPath: `/模拟/${cli}.app`, fingerprint: { realpath: `/模拟/${cli}.app/Contents/cli`, size: 10, mtimeMs: 1, appVersion: '1.0.0' } } : {}) })
function sample(cli: ActiveCliId): unknown {
  const artifact = { url: 'https://example.invalid/模拟.tgz', sha256: 'a'.repeat(64) }
  return ({
    antigravity: { version: '1.2.3', url: artifact.url, sha512: 'a'.repeat(128) },
    codex: { tag_name: 'rust-v1.2.3' }, kimi: { schemaVersion: 1, version: '1.2.3' },
    mimo: '1.2.3', grok: '1.2.3', pi: { ok: true, version: '1.2.3', packageName: CLI_SOURCES.pi.npm },
    hermes: { tag_name: 'v1.2.3', draft: false, prerelease: false },
    qoder: { latest: '1.2.3', files: [{ os: 'darwin', arch: 'arm64', ...artifact }] },
    qodercn: { latest: '1.2.3', files: [{ os: 'darwin', arch: 'arm64', ...artifact }] },
    traecn: { version: '1.2.3', binary_version: '1.2.3', channel: 'public', release_channel: 'stable', artifacts: [{ platform: 'macos-aarch64', ...artifact }] },
  } as Partial<Record<ActiveCliId, unknown>>)[cli]
}
function fixture(cli: ActiveCliId) {
  const f = serviceFixture([cli]); fixtures.push(f); f.identities.set(cli, identity(cli))
  if (cli === 'pi') {
    const pi = simulatedPiInstallation(f.root, '1.0.0')
    f.identities.set(cli, { ...identity(cli), executable: pi.entry, packageRoot: pi.pkg })
  }
  // 模拟 Hermes 的日志/缓存必须完全隔离，不读取宿主真实更新回执与依赖缓存。
  if (cli === 'hermes') vi.stubEnv('HERMES_HOME', join(f.root, 'simulated-hermes-home'))
  f.metadataFetch.mockImplementation(async url => {
    for (const [id, feed] of Object.entries(NATIVE_RELEASES)) {
      const address = feed.url.replace('{platform}', 'darwin').replace('{arch}', 'arm64').replace('{musl}', '')
      if (String(url) === address) { const value = sample(id as ActiveCliId); return typeof value === 'string' ? new Response(value) : json(value) }
    }
    if (String(url).endsWith('/dist-tags')) return json({ latest: '1.2.3' })
    throw new Error(`模拟未提供的元数据 ${url}`)
  })
  // Fixtures are explicitly macOS arm64 even on another test host.
  Object.assign(f.releases, { platform: 'darwin', arch: 'arm64' })
  return f
}
afterEach(async () => { vi.useRealTimers(); for (const f of fixtures.splice(0)) await f.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.mocked(readDesktopRelease).mockReset(); vi.mocked(runDesktopUpdate).mockReset() })

it.each(Object.keys(NATIVE_RELEASES) as ActiveCliId[])('模拟：%s 官方原生源解析成功且仅 GET、无凭据', async cli => {
  const fetcher = vi.fn(async () => { const value = sample(cli); return typeof value === 'string' ? new Response(value) : json(value) })
  expect(await new ReleaseClient(fetcher, 'darwin', 'arm64').query(cli, 'https://registry.npmjs.org/', control(), 'self-update')).toMatchObject({ latest: '1.2.3', versions: ['1.2.3'] })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher).toHaveBeenCalledWith(NATIVE_RELEASES[cli]!.url.replace('{platform}', 'darwin').replace('{arch}', 'arm64').replace('{musl}', ''), expect.objectContaining({ method: 'GET', credentials: 'omit', redirect: 'error' }))
})
it.each(Object.keys(NATIVE_RELEASES) as ActiveCliId[])('模拟：%s 错误格式不当作最新版', async cli => {
  await expect(new ReleaseClient(async () => json({ version: 'not-a-version' }), 'darwin', 'arm64').native(cli, control())).rejects.toThrow()
})
it.each(['antigravity', 'qoder', 'qodercn', 'traecn'] as const)('模拟：%s 官方清单空摘要拒绝', async cli => {
  const value = sample(cli) as any
  if (cli === 'antigravity') value.sha512 = ''
  else if (cli === 'traecn') value.artifacts[0].sha256 = ''
  else value.files[0].sha256 = ''
  await expect(new ReleaseClient(async () => json(value), 'darwin', 'arm64').native(cli, control())).rejects.toThrow('RELEASE_UNREACHABLE')
})
it.each(['v1.2.3', 'rust-v01.2.3', '1.2.3'])('模拟：Codex 非 rust-v 合法版本拒绝（%s）', async tag_name => {
  await expect(new ReleaseClient(async () => json({ tag_name })).native('codex', control())).rejects.toThrow('RELEASE_UNREACHABLE')
})
it.each(['mimo', 'grok', 'codex', 'kimi', 'qoder', 'traecn', 'hermes', 'antigravity', 'pi'] as const)('模拟：%s 响应实际字节超过 512 KiB 拒绝', async cli => {
  await expect(new ReleaseClient(async () => new Response(' '.repeat(RELEASE_JSON_LIMIT + 1))).native(cli, control())).rejects.toThrow('RELEASE_UNREACHABLE')
})
it('模拟：纯文本发布源仍受 8 秒超时与跨请求 3 并发限制', async () => {
  vi.useFakeTimers(); let calls = 0
  const client = new ReleaseClient(async () => { calls++; return new Response(new ReadableStream({ pull: () => new Promise(() => {}) })) })
  const operations = Array.from({ length: 4 }, () => client.native('grok', control()).catch(error => error))
  await vi.advanceTimersByTimeAsync(1); expect(calls).toBe(3)
  await vi.advanceTimersByTimeAsync(8000); expect(calls).toBe(4)
  await vi.advanceTimersByTimeAsync(8000)
  expect((await Promise.all(operations)).every(error => error.code === 'RELEASE_TIMEOUT')).toBe(true)
})
it.each(['kimi', 'mimo', 'pi', 'qoder', 'qodercn', 'codex'] as const)('模拟：%s npm 安装保持 npm 来源', async cli => {
  const fetcher = vi.fn(async url => { expect(String(url)).toContain('/dist-tags'); return json({ latest: '1.5.2' }) })
  expect((await new ReleaseClient(fetcher).query(cli, 'https://registry.npmjs.org/', control(), 'npm')).latest).toBe('1.5.2')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

const args: Partial<Record<ActiveCliId, string[]>> = {
  antigravity: ['update'], claude: ['update'], kimi: ['update', '-y'], mimo: ['upgrade', '1.2.3', '--method', 'curl'], grok: ['update', '--version', '1.2.3'], omp: ['update'], pi: ['update', '--self'], hermes: ['update', '--yes'], opencode: ['upgrade'], qoder: ['update'], qodercn: ['update'], codebuddy: ['update'], traecn: ['update', '--channel', 'public', '--version', '1.2.3'],
}
it.each(Object.keys(args) as ActiveCliId[])('模拟：%s 自带更新 argv 与原安装归属', async cli => {
  const f = fixture(cli), id = identity(cli)
  const plan = planCliOperation(cli, 'update', id, '1.0.0', '1.2.3', 'https://registry.npmjs.org/')
  expect(await operationArgv(plan, f.backend)).toEqual([id.executable, ...args[cli]!])
  expect(plan.pinsVersion).toBe(['mimo', 'grok', 'traecn'].includes(cli))
})
it.each(['1.2.3', '1.2.4', '1.1.0'])('模拟：浮动更新实际前进到 %s 均成功', version => {
  const plan = planCliOperation('qoder', 'update', identity('qoder'), '1.0.0', '1.2.3', 'https://registry.npmjs.org/')
  expect(() => verifyUpdatedVersion(plan, version)).not.toThrow()
})
it.each([['1.0.0', 'VERSION_UNCHANGED'], ['0.9.0', 'VERSION_MISMATCH'], [undefined, 'VERSION_MISMATCH']])('模拟：浮动更新 %s 未前进或未知仍失败', (version, code) => {
  const plan = planCliOperation('qoder', 'update', identity('qoder'), '1.0.0', '1.2.3', 'https://registry.npmjs.org/')
  expect(() => verifyUpdatedVersion(plan, version)).toThrow(code)
})
it('模拟：OpenCode 浮动更新到 V2 仍拒绝核对；精确版本方法不能接受其他版', () => {
  expect(() => verifyUpdatedVersion(planCliOperation('opencode', 'update', identity('opencode'), '1.0.0', '1.2.3', 'https://registry.npmjs.org/'), '2.0.0')).toThrow('VERSION_MISMATCH')
  expect(() => verifyUpdatedVersion(planCliOperation('grok', 'update', identity('grok'), '1.0.0', '1.2.3', 'https://registry.npmjs.org/'), '1.2.4')).toThrow('VERSION_MISMATCH')
})
it.each(Object.keys(args) as ActiveCliId[])('模拟：%s 预加载只读 GET、可更新，前台执行后以实际版本重算', async cli => {
  const f = fixture(cli)
  await (f.service as any).local(cli, control(), true, false)
  await (f.service as any).remote(cli, control(), true)
  expect(f.backend.spawn).not.toHaveBeenCalled()
  const row = f.service.snapshot().entries.find(e => e.cli === cli)!
  expect(row.group).toBe('updatable')
  vi.mocked(f.backend.spawn).mockImplementation(() => { f.identities.set(cli, { ...f.identities.get(cli)!, manifestVersion: '1.2.3' }); return exited() })
  f.service.start(cli, 'update', row.planToken!, '', `模拟-${cli}`)
  const result = (await finished(f.service)).results.find(r => r.cli === cli)!
  expect(result).toMatchObject({ phase: 'succeeded', afterVersion: '1.2.3' })
  expect(f.service.snapshot().entries.find(e => e.cli === cli)?.group).toBe('latest')
  if (cli === 'kimi') expect(f.backend.spawn).toHaveBeenCalledWith(expect.objectContaining({ env: { KIMI_CODE_NO_AUTO_UPDATE: '1' } }))
})
it('模拟：Codex 官方脚本私有下载、锁版无交互执行、成功清理', async () => {
  const f = fixture('codex'); const row = (await checked(f.service)).entries.find(e => e.cli === 'codex')!
  let script = ''
  vi.mocked(f.backend.spawn).mockImplementation(command => {
    expect(command.argv[0]).toBe('/bin/sh'); script = command.argv[1]!
    expect(command.argv.slice(2)).toEqual(['--release', '1.2.3']); expect(command.env).toEqual({ CODEX_NON_INTERACTIVE: '1' })
    expect(statSync(script).mode & 0o777).toBe(0o600); expect(statSync(join(script, '..')).mode & 0o777).toBe(0o700)
    f.identities.set('codex', { ...identity('codex'), manifestVersion: '1.2.3' }); return exited()
  })
  f.service.start('codex', 'update', row.planToken!, '', '模拟-codex-script')
  expect((await finished(f.service)).results[0]?.phase).toBe('succeeded')
  expect(f.artifactFetch).toHaveBeenCalledWith(NATIVE_UPDATES.codex!.script!.url, expect.anything()); expect(existsSync(script)).toBe(false)
})
it('模拟：Pi 更新目标取 latest，通知来自同一个支持集合，Worker 核对不放宽', async () => {
  const f = fixture('pi'); const row = (await checked(f.service)).entries.find(e => e.cli === 'pi')!
  expect(row).toMatchObject({ group: 'updatable', latestCompatibleVersion: '1.2.3', notice: '插件尚未适配 Pi 1.2.3，更新后 Pi Worker 要等插件适配后才能使用' })
  for (const supported of PI_SUPPORTED_VERSIONS) expect(piNotice('pi', supported)).toBeUndefined()
  const pkg = join(f.root, 'pi-package'), entry = join(pkg, 'dist/cli.js')
  mkdirSync(join(pkg, 'dist'), { recursive: true }); writeFileSync(entry, '// 模拟，不执行')
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: CLI_SOURCES.pi.npm, version: '9.0.0' }))
  expect(inspectPiInstallation(entry, { allowUnsupported: true }).version).toBe('9.0.0')
  expect(() => inspectPiInstallation(entry)).toThrow('Pi 安装身份或原生接口不匹配')
})
it('模拟：Pi update exits zero and version advances, but fresh integrity verification rejects a truncated dependency', async () => {
  const f = fixture('pi'), row = (await checked(f.service)).entries.find(e => e.cli === 'pi')!
  vi.mocked(f.backend.spawn).mockImplementation(() => {
    f.identities.get('pi')!.manifestVersion = '1.2.3'
    writeFileSync(join(f.identities.get('pi')!.packageRoot!, 'node_modules/@earendil-works/pi-ai/dist/index.js'), '')
    return exited()
  })
  f.service.start('pi', 'update', row.planToken!, '', 'truncated-pi-update')
  expect((await finished(f.service)).results[0]).toMatchObject({ phase: 'failed', error: { message: 'Pi 安装不完整（缺少依赖 @earendil-works/pi-ai），请在「更新 CLI」中重新安装' } })
})
it('模拟：Hermes 只读 install-stamp，不把 pyproject 的占位版本当真', async () => {
  const f = fixture('hermes'), root = join(f.root, 'checkout'), entry = join(root, '.hermes/bin/hermes')
  mkdirSync(join(entry, '..'), { recursive: true }); writeFileSync(entry, '#!/bin/sh\n# 模拟 bootstrap', { mode: 0o700 })
  writeFileSync(join(root, 'install-stamp.json'), JSON.stringify({ baseVersion: '0.21.7', commit: 'a'.repeat(40), channel: 'canary' }))
  const config = { ...f.config, hermesExecutable: entry }
  const id = await identifyInstallation('hermes', f.backend, config, control(), true)
  expect(id).toMatchObject({ manifestVersion: '0.21.7', channel: 'canary' })
  expect(await currentVersion('hermes', id!, f.backend, config, control(), true)).toBe('0.21.7')
  expect(f.backend.spawn).not.toHaveBeenCalled()
  expect(NATIVE_UPDATES.hermes?.notice).toContain('迁移配置')
})
it('模拟：本机版本读取超时写明原因；Windows 时限 15 秒', async () => {
  expect(localCheckTimeoutMs('win32')).toBe(15_000); expect(localCheckTimeoutMs('darwin')).toBe(5_000)
  vi.useFakeTimers()
  try {
    const f = fixture('omp')
    f.version.mockImplementation((_cli, _id, _b, _c, signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })))
    const pending = checked(f.service)
    await vi.advanceTimersByTimeAsync(localCheckTimeoutMs() + 10)
    const row = (await pending).entries.find(e => e.cli === 'omp')!
    expect(row).toMatchObject({ group: 'failed', reason: 'UNKNOWN_VERSION', reasonDetail: LOCAL_CHECK_TIMEOUT_DETAIL })
  } finally { vi.useRealTimers() }
})
it('模拟：Windows Hermes 启动器在 bin，install-stamp 在同级 hermes-agent 检出目录', async () => {
  // 2026-11-14 Windows 实机布局：%LOCALAPPDATA%\\hermes\\bin\\hermes.exe + hermes\\hermes-agent\\install-stamp.json
  const f = fixture('hermes'), root = join(f.root, 'hermes'), entry = join(root, 'bin/hermes.exe')
  mkdirSync(join(entry, '..'), { recursive: true }); writeFileSync(entry, 'MZ 模拟启动器', { mode: 0o700 })
  mkdirSync(join(root, 'hermes-agent'), { recursive: true })
  writeFileSync(join(root, 'hermes-agent/install-stamp.json'), JSON.stringify({ baseVersion: '0.21.7', commit: 'b'.repeat(40) }))
  const config = { ...f.config, hermesExecutable: entry }
  const id = await identifyInstallation('hermes', f.backend, config, control(), true)
  expect(id).toMatchObject({ manifestVersion: '0.21.7', channel: 'unknown' })
  expect(await currentVersion('hermes', id!, f.backend, config, control(), true)).toBe('0.21.7')
  expect(f.backend.spawn).not.toHaveBeenCalled()
  expect(classifyInstallation('hermes', 'C:/Users/admin/AppData/Local/hermes/bin/hermes.exe', undefined, 'C:\\Users\\admin'))
    .toMatchObject({ source: 'self-update', updateRoot: 'C:/Users/admin/AppData/Local/hermes' })
})
it('模拟：Hermes 只在 bin 的上一级找同级检出，不向更高层乱找', async () => {
  const f = fixture('hermes'), root = join(f.root, 'outer'), entry = join(root, 'tools/bin/hermes.exe')
  mkdirSync(join(entry, '..'), { recursive: true }); writeFileSync(entry, 'MZ 模拟', { mode: 0o700 })
  mkdirSync(join(root, 'hermes-agent'), { recursive: true })
  writeFileSync(join(root, 'hermes-agent/install-stamp.json'), JSON.stringify({ baseVersion: '9.9.9' }))
  const id = await identifyInstallation('hermes', f.backend, { ...f.config, hermesExecutable: entry }, control(), true)
  expect(id?.manifestVersion).toBeUndefined()
})
it('模拟：没有桌面应用对应时，ZCode 插件 runtime 从 INSTALL-MANIFEST 读版本并标为手动', async () => {
  const f = fixture('zcode'), home = join(f.root, 'home'), previous = process.env.HOME
  process.env.HOME = home
  try {
    const runtime = join(home, '.local/share/cliworker-now/runtimes/zcode'), entry = join(runtime, 'cli/zcode.cjs')
    mkdirSync(join(entry, '..'), { recursive: true }); writeFileSync(entry, '// 模拟')
    // 实际清单带全部 npm 包的 integrity，Windows 版 723 KB，超过普通元数据 128 KB 上限
    const npmPackages = Array.from({ length: 3000 }, (_, i) => ({ name: `模拟包-${i}`, integrity: 'sha512-' + 'a'.repeat(200) }))
    writeFileSync(join(runtime, 'INSTALL-MANIFEST.json'), JSON.stringify({ version: '0.16.9', target: 'win32-x64', source: { origin: 'https://github.com/zai-org/ZCode' }, npmPackages }))
    expect(statSync(join(runtime, 'INSTALL-MANIFEST.json')).size).toBeGreaterThan(128 * 1024)
    const id = await identifyInstallation('zcode', f.backend, { ...f.config, zcodeExecutable: entry }, control(), true)
    expect(id).toMatchObject({ source: 'plugin-runtime', manifestVersion: '0.16.9' })
    expect(await currentVersion('zcode', id!, f.backend, f.config, control(), true)).toBe('0.16.9')
    expect(updateProblem('zcode', id!)).toContain('由 CLI Worker 按官方源码部署')
    // 来源不对的清单不认
    writeFileSync(join(runtime, 'INSTALL-MANIFEST.json'), JSON.stringify({ version: '0.16.9', source: { origin: 'https://example.invalid/fork' } }))
    const other = await identifyInstallation('zcode', f.backend, { ...f.config, zcodeExecutable: entry }, control(), true)
    expect(other?.source).toBe('unknown'); expect(other?.manifestVersion).toBeUndefined()
    expect(f.backend.spawn).not.toHaveBeenCalled()
  } finally { if (previous === undefined) delete process.env.HOME; else process.env.HOME = previous }
})
it('模拟：ZCode Info.plist 应用版本优先于内部 CLI 版本', async () => {
  const f = fixture('zcode'), root = join(f.root, 'ZCode.app'), entry = join(root, 'Contents/Resources/glm/zcode.cjs')
  mkdirSync(join(entry, '..'), { recursive: true }); writeFileSync(entry, '// 模拟')
  writeFileSync(join(root, 'Contents/Info.plist'), '<plist><key>CFBundleShortVersionString</key><string>3.17.2</string></plist>')
  const id = await identifyInstallation('zcode', f.backend, { ...f.config, zcodeExecutable: entry }, control(), true)
  expect(await currentVersion('zcode', id!, f.backend, f.config, control())).toBe('3.17.2'); expect(id?.appPath).toBe(root)
})
it.each(['winget', 'scoop', 'nix', 'bun', 'pnpm', 'unknown'] as const)('模拟：外部渠道 %s 保持具体手动原因', async source => {
  const f = fixture('grok'); f.identities.set('grok', { ...identity('grok'), source })
  const row = (await checked(f.service)).entries.find(e => e.cli === 'grok')!
  expect(row.group).toBe('manual'); expect(row.manual?.note).toContain(source === 'unknown' ? '没有识别出' : source)
  expect(f.metadataFetch).not.toHaveBeenCalled()
})
it('模拟：平台与 TRAE 安装通道不猜测，不跨 public 更新', () => {
  expect(updateProblem('qoder', identity('qoder'), 'win32', 'arm64')).toContain('ARM64')
  expect(updateProblem('codex', identity('codex'), 'win32')).toContain('尚未核实')
  expect(updateProblem('traecn', { ...identity('traecn'), channel: 'internal' })).toContain('不能切换')
  expect(updateProblem('traecn', { ...identity('traecn'), channel: undefined })).toContain('未知')
})
it('模拟：受管目录升级可移动版本目录，但其他根/入口仍拒绝', () => {
  const before = { ...identity('grok'), updateRoot: '/模拟/.grok' }, after = { ...before, fingerprint: { ...before.fingerprint, realpath: '/模拟/.grok/downloads/grok-1.2.3' } }
  expect(sameInstallation(before, after, 'grok')).toBe(true)
  expect(sameInstallation(before, { ...after, updateRoot: '/模拟/other' }, 'grok')).toBe(false)
  expect(sameInstallation(before, { ...after, executable: '/模拟/other/grok' }, 'grok')).toBe(false)
  expect(classifyInstallation('omp', '/模拟/.local/bin/omp', undefined, '/模拟').source).toBe('self-update')
})
it.each(['zcode', 'workbuddycn', 'workbuddy'] as const)('模拟：%s 调用任务 B 接口，完整下载已校验，保留 CLI 与 App 两种版本', async cli => {
  const f = fixture(cli), release = { version: '1.2.3', url: 'https://example.invalid/模拟.zip', sha512: sri('模拟').slice(7) }
  vi.mocked(readDesktopRelease).mockResolvedValue(release)
  vi.mocked(runDesktopUpdate).mockImplementation(async options => {
    expect(options.appPath).toBe(identity(cli).appPath); expect(options.release).toEqual(release)
    const file = await options.download(release.url, release, options.signal)
    expect(file.endsWith('.part')).toBe(true); expect(existsSync(file)).toBe(true)
    await options.run(['/模拟/installer'], options.signal); options.awaiting()
    f.identities.set(cli, { ...identity(cli), manifestVersion: '0.5.0', fingerprint: { ...identity(cli).fingerprint, appVersion: '1.2.3' } })
    return { appPath: options.appPath }
  })
  const row = (await checked(f.service)).entries.find(e => e.cli === cli)!
  expect(row).toMatchObject({ group: 'updatable', appVersion: '1.0.0' })
  expect(readDesktopRelease).toHaveBeenCalledWith(cli, { appVersion: '1.0.0' }, expect.any(AbortSignal), expect.objectContaining({ fetcher: expect.any(Function) }))
  f.service.start(cli, 'update', row.planToken!, '', `模拟-${cli}`)
  expect((await finished(f.service)).results[0]).toMatchObject({ phase: 'succeeded', afterVersion: '1.2.3' })
  expect(f.service.snapshot().entries.find(e => e.cli === cli)).toMatchObject({ currentVersion: '0.5.0', appVersion: '1.2.3', group: 'latest' })
})
it.each(['workbuddy', 'workbuddycn'] as const)('模拟：%s feed 204 映射 latest，没有更新计划', async cli => {
  const f = fixture(cli)
  vi.mocked(readDesktopRelease).mockRejectedValue(new DesktopUnavailableError('官方更新源未提供更新，当前应用可能已是最新版本'))
  const row = (await checked(f.service)).entries.find(e => e.cli === cli)!
  expect(row).toMatchObject({ group: 'latest', latestVersion: '1.0.0', latestCompatibleVersion: '1.0.0' }); expect(row.planToken).toBeUndefined()
  expect(runDesktopUpdate).not.toHaveBeenCalled()
})
it('模拟：任务 B 缺摘要原因保留，后台不启动更新程序', async () => {
  const f = fixture('workbuddy')
  vi.mocked(readDesktopRelease).mockRejectedValue(new DesktopUnavailableError('官方更新源没有提供校验值，暂不能自动更新'))
  await (f.service as any).local('workbuddy', control(), true, false); await (f.service as any).remote('workbuddy', control(), true)
  expect(f.service.snapshot().entries.find(e => e.cli === 'workbuddy')).toMatchObject({ group: 'manual', manual: { note: '官方更新源没有提供校验值，暂不能自动更新' } })
  expect(runDesktopUpdate).not.toHaveBeenCalled(); expect(f.backend.spawn).not.toHaveBeenCalled()
})

it.each([
  ['follow', undefined], ['official', 'https://registry.npmjs.org/'], ['npmmirror', 'https://registry.npmmirror.com/'], ['custom', 'https://registry.example.invalid/npm/'],
] as const)('模拟：Hermes 下载源 %s 在首次运行与失败重跑传递 registry，follow 不设置', async (source, registry) => {
  const memoryGet = vi.spyOn(ChannelMemory.prototype, 'get'), memorySet = vi.spyOn(ChannelMemory.prototype, 'set')
  const f = fixture('hermes')
  f.service.saveDownloadSource({ source, ...(source === 'custom' ? { customUrl: registry } : {}) })
  await (f.service as any).local('hermes', control(), true, false)
  await (f.service as any).remote('hermes', control(), true)
  const row = f.service.snapshot().entries.find(e => e.cli === 'hermes')!
  let calls = 0
  vi.mocked(f.backend.spawn).mockClear() // follow 的模拟 npm config get 属于前面的只读查询。
  vi.mocked(f.backend.spawn).mockImplementation(spec => {
    if (!spec.argv.includes('--yes')) return { ...exited(), stdout: Readable.from(['https://registry.npmjs.org/\n']) }
    calls++
    if (calls === 2) f.identities.set('hermes', { ...identity('hermes'), manifestVersion: '1.2.3' })
    return { ...exited(), done: Promise.resolve({ exitCode: calls === 1 ? 1 : 0, signal: null }) }
  })
  f.service.start('hermes', 'update', row.planToken!, '', `模拟-registry-${source}`)
  expect((await finished(f.service)).results.find(r => r.cli === 'hermes')).toMatchObject({ phase: 'succeeded' })
  expect(calls).toBe(2)
  expect(memoryGet).not.toHaveBeenCalled(); expect(memorySet).not.toHaveBeenCalled()
  expect(existsSync(join(f.root, 'cli-management/channel-memory.json'))).toBe(false)
  const updates = vi.mocked(f.backend.spawn).mock.calls.filter(([spec]) => spec.argv.includes('--yes'))
  expect(updates).toHaveLength(2)
  for (const [spec] of updates) {
    expect(spec.argv.slice(-2)).toEqual(['update', '--yes'])
    expect(spec.env).toMatchObject({ HERMES_HOME: join(f.root, 'simulated-hermes-home'), HERMES_UPDATE_STATUS_FILE: expect.any(String) })
    if (source === 'follow') expect(spec.env).not.toHaveProperty('npm_config_registry')
    else expect(spec.env).toHaveProperty('npm_config_registry', registry)
    for (const key of Object.keys(spec.env ?? {})) expect(/proxy/i.test(key)).toBe(false)
  }
})

it.each([[1, false], [2, false], [1, true]] as const)('模拟：Hermes 官方退出 %s、旧安装记录=%s，检出已到目标时回读成功', async (exitCode, staleStamp) => {
  const f = fixture('hermes'), root = join(f.root, '.hermes/hermes-agent'), entry = join(root, '.venv/bin/hermes')
  mkdirSync(join(entry, '..'), { recursive: true }); writeFileSync(entry, '#!/bin/sh\n# 模拟 Hermes 启动器', { mode: 0o700 })
  const stamp = join(root, 'install-stamp.json')
  writeFileSync(stamp, JSON.stringify({ baseVersion: '1.0.0', commit: 'a'.repeat(40), channel: 'canary' }))
  f.config.hermesExecutable = entry
  f.identify.mockImplementation(async () => ({ ...(await identifyInstallation('hermes', f.backend, f.config, control(), true))!, source: 'self-update', updateRoot: root }))
  f.version.mockImplementation((_cli, id) => currentVersion('hermes', id, f.backend, f.config, control()))
  await (f.service as any).local('hermes', control(), true, false)
  await (f.service as any).remote('hermes', control(), true)
  const row = f.service.snapshot().entries.find(e => e.cli === 'hermes')!
  vi.mocked(f.backend.spawn).mockClear()
  vi.mocked(f.backend.spawn).mockImplementation(spec => {
    expect(spec.argv).toEqual([entry, 'update', '--yes'])
    if (staleStamp) {
      mkdirSync(join(root, '.git'), { recursive: true })
      writeFileSync(join(root, '.git/HEAD'), 'b'.repeat(40) + '\n')
      writeFileSync(join(root, '.git/packed-refs'), 'c'.repeat(40) + ' refs/tags/v1.2.3\n^' + 'b'.repeat(40) + '\n')
    } else writeFileSync(stamp, JSON.stringify({ baseVersion: '1.2.3', commit: 'b'.repeat(40), channel: 'canary' }))
    return { ...exited(), done: Promise.resolve({ exitCode, signal: null }) }
  })
  f.service.start('hermes', 'update', row.planToken!, '', `模拟-exit-${exitCode}-installed`)
  const state = await finished(f.service)
  expect(state.results.find(r => r.cli === 'hermes')).toMatchObject({ phase: 'succeeded', afterVersion: '1.2.3' })
  expect(state.entries.find(e => e.cli === 'hermes')).toMatchObject({ currentVersion: '1.2.3', group: 'latest' })
  expect(f.backend.spawn).toHaveBeenCalledTimes(1)
})
it('模拟：Hermes 失败且版本未前进仍报失败，不绕过 verifyUpdatedVersion', async () => {
  const f = fixture('hermes')
  await (f.service as any).local('hermes', control(), true, false); await (f.service as any).remote('hermes', control(), true)
  const row = f.service.snapshot().entries.find(e => e.cli === 'hermes')!
  vi.mocked(f.backend.spawn).mockImplementation(() => ({ ...exited(), done: Promise.resolve({ exitCode: 2, signal: null }) }))
  f.service.start('hermes', 'update', row.planToken!, '', '模拟-exit-unchanged')
  expect((await finished(f.service)).results.find(r => r.cli === 'hermes')).toMatchObject({ phase: 'failed', error: { code: 'EXIT_CODE' } })
})
