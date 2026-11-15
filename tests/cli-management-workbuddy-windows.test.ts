/** 模拟：所有 HTTP、Windows 签名/安装进程均为夹具，不执行下载内容。 */
import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { Crc64Xz, WORKBUDDY_WINDOWS_PUBLISHER, readWorkBuddyCos, verifyWorkBuddyWindowsSignature } from '../src/host/cli-management/workbuddy-windows.ts'
import { desktopUpdateIo, readDesktopRelease, runDesktopUpdate } from '../src/host/cli-management/desktop-update.ts'
import { downloadCliArtifact } from '../src/host/cli-management/download.ts'
import { installationSource } from '../src/host/cli-management/sources.ts'
import { CliInstaller } from '../src/host/cli-management/install.ts'
import { CliExecutablePathStore } from '../src/host/cli-executable-paths.ts'
import { identifyInstallation } from '../src/host/cli-management/identity.ts'
import { currentVersion } from '../src/host/cli-management/versions.ts'
import { ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
import { serviceFixture } from './cli-management-phase-b-fixture.ts'

const version = '5.9.4.42593613'
const url = `https://download.codebuddy.ai/workbuddy/saas/win32-x64-user/WorkBuddy-win32-x64-user-${version}-fa0a0901.exe`
const body = Buffer.from('模拟 Windows installer; never execute')
const sha256 = createHash('sha256').update(body).digest('hex')
const crc = new Crc64Xz(); crc.update(body)
const headers = { 'content-length': String(body.length), 'x-cos-meta-md5': createHash('md5').update(body).digest('hex'), 'x-cos-hash-crc64ecma': crc.digest() }
const validSignature = { Status: 'Valid', Subject: `CN=${WORKBUDDY_WINDOWS_PUBLISHER}, O=${WORKBUDDY_WINDOWS_PUBLISHER}, C=CN` }
const roots: string[] = [], closes: (() => Promise<void>)[] = []
const signal = () => new AbortController().signal
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const close of closes.splice(0)) await close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const feed = (overrides = {}) => vi.fn(async () => new Response(JSON.stringify({ version, url, sha256hash: '', ...overrides })))
const release = (overrides = {}) => readDesktopRelease('workbuddy', {}, signal(), { platform: 'win32', arch: 'x64', fetcher: feed(overrides) })
const fetchArtifact = (overrides = {}) => vi.fn(async (_url: any, init?: RequestInit) => new Response(init?.method === 'HEAD' ? null : body, { headers: init?.method === 'HEAD' ? { ...headers, ...overrides } : { 'content-length': String(body.length) } }))

it('CRC-64/XZ known vector, chunk boundaries and empty input', () => {
  const whole = new Crc64Xz(), chunked = new Crc64Xz()
  expect(whole.digest()).toBe('0'); whole.update(Buffer.from('123456789'))
  for (const byte of Buffer.from('123456789')) chunked.update(Uint8Array.of(byte))
  expect(BigInt(whole.digest()).toString(16)).toBe('995dc9bbdf1939fa'); expect(chunked.digest()).toBe(whole.digest())
})
it('only audited x64 international first installation is offered', () => {
  expect(installationSource('workbuddy', 'win32', 'x64').method).toBe('desktop')
  for (const cli of ['workbuddycn', 'zcode'] as const) expect(installationSource(cli, 'win32', 'x64').method).toBe('manual')
  expect(installationSource('workbuddy', 'win32', 'arm64').method).toBe('manual')
})
it.each([undefined, null, 'bad', ' '])('missing/malformed sha256 %s never falls back', async sha256hash => {
  await expect(release({ sha256hash })).rejects.toThrow()
})
it.each([
  url.replace('download.codebuddy.ai', 'download.codebuddy.cn'), url.replace('https:', 'http:'),
  url.replace('/saas/', '/other/'), url.replace(version, '5.9.3'), url.replaceAll('x64', 'arm64'),
  url + '?q=1', url + '#', url + '?', url.replace('/saas/', '/%73aas/'),
  url.replace('/saas/', '/x/../saas/'), url.replace('.exe', '.zip'), url.replace('download.', 'user@download.'),
])('reject non-allowlisted feed URL %s', async value => { await expect(release({ url: value })).rejects.toThrow('白名单') })
it.each([
  { 'content-length': '0' }, { 'content-length': '1073741825' }, { 'x-cos-meta-md5': '' },
  { 'x-cos-hash-crc64ecma': '' }, { 'x-cos-hash-crc64ecma': '18446744073709551616' },
])('reject missing/invalid HEAD metadata %#', async values => {
  await expect(readWorkBuddyCos(url, version, undefined, signal(), fetchArtifact(values))).rejects.toThrow('COS')
})
it('HEAD rejects feed size disagreement and redirects', async () => {
  await expect(readWorkBuddyCos(url, version, body.length + 1, signal(), fetchArtifact())).rejects.toThrow('COS')
  const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.invalid' } }))
  await expect(readWorkBuddyCos(url, version, undefined, signal(), fetcher)).rejects.toThrow('COS')
  expect(fetcher).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'HEAD', redirect: 'error', credentials: 'omit' }))
})

async function updateFixture(sha = '', headerOverrides = {}, signature: unknown = validSignature) {
  const root = await mkdtemp(join(tmpdir(), 'mock-wb-win-')); roots.push(root)
  const fetcher = fetchArtifact(headerOverrides), run = vi.fn(async (_argv: string[], _signal: AbortSignal) => {}), awaiting = vi.fn()
  const capture = vi.spyOn(desktopUpdateIo, 'capture').mockResolvedValue(JSON.stringify(signature))
  const downloaded: string[] = []
  const options = { cli: 'workbuddy' as const, appPath: 'D:\\Apps\\WorkBuddyAI', root, platform: 'win32', signal: signal(), release: await release({ sha256hash: sha }), fetcher, run, awaiting,
    download: async (address: string, expected: any, control: AbortSignal) => {
      const file = await downloadCliArtifact({ root, url: address, signal: control, fetcher, expectedBytes: expected.size, cos: expected.cos,
        integrity: expected.sha256 ? `sha256-${Buffer.from(expected.sha256, 'hex').toString('base64')}` : undefined, progress() {} })
      downloaded.push(file); return file
    } }
  return { root, fetcher, run, awaiting, capture, downloaded, options }
}
it('empty feed + full COS validation + Valid Tencent signature runs only exe and removes execution copy', async () => {
  const f = await updateFixture(); await runDesktopUpdate(f.options)
  expect(f.run).toHaveBeenCalledOnce(); expect(f.run.mock.calls[0]![0]).toHaveLength(1)
  expect(f.awaiting).toHaveBeenCalledOnce(); expect(f.capture).toHaveBeenCalledOnce()
  await expect(readFile(f.run.mock.calls[0]![0][0]!)).rejects.toThrow()
  expect(await readdir(join(f.root, 'cli-management/downloads'))).toHaveLength(1) // verified cache only
})
it.each([
  { 'content-length': String(body.length + 1) }, { 'x-cos-meta-md5': '0'.repeat(32) }, { 'x-cos-hash-crc64ecma': '0' },
])('COS mismatch %# refuses execution and removes failed artifact', async values => {
  const f = await updateFixture('', values); await expect(runDesktopUpdate(f.options)).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  expect(f.run).not.toHaveBeenCalled(); expect(f.capture).not.toHaveBeenCalled(); expect(await readdir(join(f.root, 'cli-management/downloads'))).toEqual([])
})
it.each([
  { ...validSignature, Status: 'NotSigned' }, { ...validSignature, Status: 'HashMismatch' },
  { ...validSignature, Subject: 'CN=Other Company, O=Other Company' },
  { ...validSignature, Subject: `CN=${WORKBUDDY_WINDOWS_PUBLISHER} impostor, O=${WORKBUDDY_WINDOWS_PUBLISHER}` }, null,
])('signature mismatch %# refuses execution and removes execution copy', async signature => {
  const f = await updateFixture('', {}, signature); await expect(runDesktopUpdate(f.options)).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  expect(f.run).not.toHaveBeenCalled(); expect(f.awaiting).not.toHaveBeenCalled()
  expect((await readdir(join(f.root, 'cli-management/downloads'))).filter(name => name.endsWith('.exe'))).toEqual([])
})
it('existing SHA256 uses no COS HEAD and a mismatching digest cannot fall back', async () => {
  const good = await updateFixture(sha256); await runDesktopUpdate(good.options)
  expect(good.fetcher.mock.calls.every(([, init]) => init?.method !== 'HEAD')).toBe(true)
  const bad = await updateFixture('a'.repeat(64)); await expect(runDesktopUpdate(bad.options)).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  expect(bad.run).not.toHaveBeenCalled(); expect(bad.fetcher.mock.calls.every(([, init]) => init?.method !== 'HEAD')).toBe(true)
})
it('signature path is encoded data and cancellation prevents launch', async () => {
  const capture = vi.fn(async () => JSON.stringify(validSignature)), file = "D:\\a';throw 'bad\\$(x).exe"
  await verifyWorkBuddyWindowsSignature(file, signal(), capture)
  const argv = capture.mock.calls[0] as unknown as [string[], AbortSignal]
  const script = Buffer.from(argv[0][4]!, 'base64').toString('utf16le')
  expect(script).toContain('Get-AuthenticodeSignature -LiteralPath $p'); expect(script).not.toContain(file)
  expect(script).toContain(Buffer.from(file).toString('base64'))
  const f = await updateFixture(), controller = new AbortController()
  f.capture.mockImplementation(async () => { controller.abort(); return JSON.stringify(validSignature) })
  await expect(runDesktopUpdate({ ...f.options, signal: controller.signal })).rejects.toThrow()
  expect(f.run).not.toHaveBeenCalled()
})
it('awaits installer process scope; unconfirmed scope retains execution copy', async () => {
  const f = await updateFixture(); let finish!: () => void, done = false
  f.run.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  const pending = runDesktopUpdate(f.options).then(() => { done = true })
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledOnce())
  expect(done).toBe(false); expect(f.awaiting).toHaveBeenCalledOnce(); finish(); await pending
  const blocked = await updateFixture(); blocked.run.mockRejectedValue(new ProcessCleanupUnconfirmedError())
  await expect(runDesktopUpdate(blocked.options)).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
  expect(await readFile(blocked.run.mock.calls[0]![0][0]!)).toEqual(body)
})

it.each(['default', 'selected', 'appended', 'sha256', 'cn', 'wrong-version', 'wrong-build', 'signature-failure', 'cancel', 'scope-unconfirmed'] as const)('first install real identity resolver and path record: %s', async mode => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  const f = serviceFixture(['workbuddy']); closes.push(() => f.close()); f.identities.clear()
  vi.stubEnv('LOCALAPPDATA', f.root); vi.stubEnv('ProgramFiles', join(f.root, 'Program Files'))
  // 'appended': the real 5.9.4 wizard adds its WorkBuddyAI leaf to a picked folder (Windows, 2026-11-15).
  const selected = join(f.root, 'chosen app')
  const app = mode === 'selected' ? selected : mode === 'appended' ? join(selected, 'WorkBuddyAI') : join(f.root, 'Program Files/WorkBuddyAI')
  const config = { ...f.config, cliExecutablePaths: new CliExecutablePathStore(f.root, { platform: 'darwin' }) } // fixture files use POSIX paths on this Mac
  const metadataFetch = feed(mode === 'sha256' ? { sha256hash: sha256 } : {}); f.releases.response = async () => metadataFetch()
  const file = (path: string, text: string) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text) }
  const controller = new AbortController(), artifactFetcher = fetchArtifact()
  const op: any = { outputTail: '' }
  const spawn = vi.mocked(f.backend.spawn).mockImplementation(({ argv }) => {
    let output = ''
    if (argv[0] === 'powershell.exe') output = JSON.stringify(mode === 'signature-failure' ? { ...validSignature, Status: 'NotTrusted' } : validSignature)
    else {
      expect(argv).toHaveLength(1); expect(op.phase).toBe('awaiting-user')
      const cli = join(app, 'resources/app.asar.unpacked/cli')
      file(join(app, 'WorkBuddyAI.exe'), '模拟，不执行'); file(join(cli, 'dist/codebuddy-lite-wb.mjs'), '模拟，不执行')
      file(join(cli, 'package.json'), JSON.stringify({ name: '@genie/agent-cli', version: '2.165.0' }))
      file(join(cli, 'product.json'), JSON.stringify({ endpoint: mode === 'cn' ? 'https://www.workbuddy.cn' : 'https://www.workbuddy.ai', genieVersion: mode === 'wrong-version' ? '5.9.3' : mode === 'wrong-build' ? '5.9.4.42593612' : '5.9.4', productName: 'WorkBuddy AI', dataFolderName: '.workbuddy-ai' }))
    }
    if (mode === 'cancel' && argv[0] !== 'powershell.exe') controller.abort()
    return { stdout: Readable.from([output]), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), terminate: vi.fn(), waitForExit: vi.fn(async () => mode !== 'scope-unconfirmed' || argv[0] === 'powershell.exe') }
  })
  const installer = new CliInstaller({ root: f.root, backend: f.backend, config, releases: f.releases, platform: 'win32', arch: 'x64', fetcher: artifactFetcher,
    identify: async (cli, backend, selected, signal) => selected.cliExecutablePaths ? undefined : identifyInstallation(cli, backend, selected, signal), version: currentVersion })
  const plan = await installer.prepare('workbuddy', 'https://registry.npmjs.org/', mode === 'selected' || mode === 'appended' ? selected : join(f.root, 'page-selection-unused'), signal())
  const pending = installer.execute(plan, op, controller.signal, () => {}, async () => {})
  if (['cn', 'wrong-version', 'wrong-build', 'signature-failure', 'cancel', 'scope-unconfirmed'].includes(mode)) {
    await expect(pending).rejects.toThrow(); expect(config.cliExecutablePaths.read('workbuddy')).toBeUndefined()
  } else {
    await expect(pending).resolves.toMatchObject({ version: '2.165.0', identity: { fingerprint: { appVersion: '5.9.4' } } })
    expect(config.cliExecutablePaths.read('workbuddy')?.path).toBe(join(app, 'resources/app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs'))
  }
  expect(spawn.mock.calls.filter(([spec]) => spec.argv[0]?.endsWith('.exe') && spec.argv[0] !== 'powershell.exe')).toHaveLength(mode === 'signature-failure' ? 0 : 1)
  if (mode === 'sha256') expect(artifactFetcher.mock.calls.every(([, init]) => init?.method !== 'HEAD')).toBe(true)
  if (mode !== 'scope-unconfirmed') expect(await readdir(join(f.root, 'cli-management/downloads'))).toEqual([])
})
