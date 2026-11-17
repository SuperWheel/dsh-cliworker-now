import * as npmDownload from '../src/host/cli-management/npm-download.ts'
/** 模拟：npm packument、HEAD/GET、低速时钟、配置与安装进程；无真实安装。 */
import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { downloadCliArtifact } from '../src/host/cli-management/download.ts'
import { ReleaseClient } from '../src/host/cli-management/versions.ts'
import { OFFICIAL_NPM_REGISTRY, NPMMIRROR_REGISTRY } from '../src/shared/cli-management.ts'
import { checked, control, finished, serviceFixture, sri, syntheticIdentity } from './cli-management-phase-b-fixture.ts'
const fixtures: ReturnType<typeof serviceFixture>[] = []
const fixture = () => { const f = serviceFixture(); fixtures.push(f); return f }
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close() })
const hash = createHash('md5').update('abcdef').digest('hex')
const metadata = (url: string) => new Response(JSON.stringify({ name: '@openai/codex', version: '1.2.3', dist: { integrity: url.startsWith(OFFICIAL_NPM_REGISTRY) ? sri('abcdef') : sri('MALICIOUS'), tarball: 'https://attacker.invalid/not-used.tgz' } }))
const urls = { official: `${OFFICIAL_NPM_REGISTRY}@openai/codex/-/codex-1.2.3.tgz`, mirror: `${NPMMIRROR_REGISTRY}@openai/codex/-/codex-1.2.3.tgz`, cdn: 'https://cdn.npmmirror.com/packages/%40openai/codex/1.2.3/codex-1.2.3.tgz' }
const h = (url: string) => url.includes('npmjs') ? { 'content-length': '6', etag: `"${hash}"`, 'accept-ranges': 'bytes' } : { 'content-length': '6', etag: `"${hash.toUpperCase()}"`, 'accept-ranges': 'bytes', 'content-md5': Buffer.from(hash, 'hex').toString('base64') }
it.each(['official', 'mirror'] as const)('模拟：npm %s 慢速轮换，官方 sha512 不被镜像 integrity 替换', async first => {
  vi.useFakeTimers(); const f = fixture(), progress = vi.fn(), output = vi.fn()
  const packument = vi.fn(async url => metadata(String(url))), releases = new ReleaseClient(packument)
  const artifact = await releases.artifact('codex', '1.2.3', first === 'official' ? OFFICIAL_NPM_REGISTRY : NPMMIRROR_REGISTRY, control(), true)
  expect(artifact.integrity).toBe(sri('abcdef')); expect(packument).toHaveBeenCalledOnce()
  expect(String(packument.mock.calls[0]![0])).toContain('registry.npmjs.org')
  let stream!: ReadableStreamDefaultController<Uint8Array>, gets = 0
  const fetcher = vi.fn(async (url, init) => {
    const address = String(url), headers = h(address)
    if (init?.method === 'HEAD') {
      if (address === urls.mirror) return new Response(null, { status: 302, headers: { location: urls.cdn } })
      if (address === urls.official) return new Response(null, { status: 206, headers: { etag: headers.etag, 'content-range': 'bytes 0-5/6' } })
      return new Response(null, { headers })
    }
    expect(init?.redirect).toBe('error')
    if (++gets === 1) {
      expect(address).toBe(first === 'official' ? urls.official : urls.cdn)
      return new Response(new ReadableStream<Uint8Array>({ start(c) { stream = c; c.enqueue(Buffer.from('abc')) } }), { headers })
    }
    expect(address).toBe(first === 'official' ? urls.cdn : urls.official)
    expect(init?.headers).toMatchObject({ Range: 'bytes=4-', 'If-Range': headers.etag })
    return new Response('ef', { status: 206, headers: { ...headers, 'content-length': '2', 'content-range': 'bytes 4-5/6' } })
  })
  const pending = downloadCliArtifact({ ...artifact, root: f.root, signal: control(), fetcher, progress, output })
  await vi.waitFor(() => expect(progress.mock.calls.at(-1)?.[0].downloadedBytes).toBe(3), { interval: 1 })
  await vi.advanceTimersByTimeAsync(2500); stream.enqueue(Buffer.from('d'))
  await vi.waitFor(() => expect(progress.mock.calls.at(-1)?.[0].downloadedBytes).toBe(4), { interval: 1 })
  await vi.advanceTimersByTimeAsync(2500)
  expect(readFileSync(await pending, 'utf8')).toBe('abcdef'); expect(gets).toBe(2)
  const host = first === 'official' ? 'cdn.npmmirror.com' : 'registry.npmjs.org'
  expect(output).toHaveBeenCalledWith(`切换到 ${host} 继续下载（第 1 次）\n`)
  expect(progress.mock.calls.at(-1)![0]).toMatchObject({ sourceHost: host, resumeCount: 1 })
})
it.each(['etag', 'length', 'redirect'])('模拟：npm 备用 %s 不符拒绝换源', async mode => {
  const f = fixture(), releases = new ReleaseClient(async url => metadata(String(url)))
  const artifact = await releases.artifact('codex', '1.2.3', OFFICIAL_NPM_REGISTRY, control(), true)
  const fetcher = vi.fn(async (url, init) => {
    const address = String(url), headers = h(address)
    if (init?.method !== 'HEAD') return new Response('abc', { headers })
    if (address === urls.mirror) return new Response(null, { status: 302, headers: { location: mode === 'redirect' ? 'https://attacker.invalid/evil.tgz' : urls.cdn } })
    return new Response(null, { headers: address === urls.cdn ? { ...headers, ...(mode === 'etag' ? { etag: '"other"', 'content-md5': '0'.repeat(32) } : {}), ...(mode === 'length' ? { 'content-length': '7' } : {}) } : headers })
  })
  await expect(downloadCliArtifact({ ...artifact, root: f.root, signal: control(), fetcher, progress: vi.fn() })).rejects.toMatchObject({ code: 'NETWORK' })
  expect(fetcher.mock.calls.filter(c => c[1]?.method !== 'HEAD')).toHaveLength(1)
})
it('模拟：npm 全部源 HEAD 失败不 GET 安装包', async () => {
  const f = fixture(), releases = new ReleaseClient(async url => metadata(String(url)))
  const artifact = await releases.artifact('codex', '1.2.3', OFFICIAL_NPM_REGISTRY, control(), true)
  const fetcher = vi.fn(async () => new Response(null, { status: 503 }))
  await expect(downloadCliArtifact({ ...artifact, root: f.root, signal: control(), fetcher, progress: vi.fn() })).rejects.toMatchObject({ code: 'NETWORK' })
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('模拟：显式自定义地址不创建多源列表，始终按官方 sha512 校验', async () => {
  const f = fixture(), packument = vi.fn(async url => new Response(JSON.stringify({ name: '@openai/codex', version: '1.2.3', dist: { integrity: String(url).startsWith(OFFICIAL_NPM_REGISTRY) ? sri('abcdef') : sri('MALICIOUS'), tarball: 'https://private.invalid/custom.tgz' } })))
  const artifact = await new ReleaseClient(packument).artifact('codex', '1.2.3', 'https://private.invalid/', control(), false)
  expect(artifact.sources).toBeUndefined(); expect(artifact.integrity).toBe(sri('abcdef'))
  let gets = 0
  const fetcher = vi.fn(async (url, init) => {
    expect(String(url)).toBe('https://private.invalid/custom.tgz'); expect(init?.method).not.toBe('HEAD')
    return ++gets === 1 ? new Response('abc', { headers: { 'content-length': '6' } }) : new Response('def', { status: 206, headers: { 'content-range': 'bytes 3-5/6' } })
  })
  expect(readFileSync(await downloadCliArtifact({ ...artifact, root: f.root, signal: control(), fetcher, progress: vi.fn() }), 'utf8')).toBe('abcdef')
  expect(gets).toBe(2)
})
it.each(['official', 'npmmirror', 'custom', 'follow'] as const)('模拟：服务将 %s 设置传到 npm 主包，follow 以当前 registry 为首选', async source => {
  const f = fixture(); f.service.saveDownloadSource(source === 'custom' ? { source, customUrl: OFFICIAL_NPM_REGISTRY } : { source })
  const child = (text = '') => ({ stdout: Readable.from([text]), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), waitForExit: vi.fn(async () => true), terminate: vi.fn() })
  vi.mocked(f.backend.spawn).mockImplementation(({ argv }) => {
    if (argv.includes('config')) return child(NPMMIRROR_REGISTRY)
    f.identities.set('codex', syntheticIdentity('codex', '1.2.3')); return child()
  })
  const spy = vi.spyOn(npmDownload, 'prepareNpmDownload')
  await checked(f.service)
  f.service.start('codex', 'update', f.service.snapshot().entries.find(e => e.cli === 'codex')!.planToken!, '', `模拟-${source}`)
  expect((await finished(f.service)).results[0]!.phase).toBe('succeeded')
  expect(spy.mock.calls.at(-1)![0].automaticSources).toBe(source !== 'custom')
  expect(spy.mock.calls.at(-1)![0].registry).toBe(source === 'npmmirror' || source === 'follow' ? NPMMIRROR_REGISTRY : OFFICIAL_NPM_REGISTRY)
  if (source === 'custom') expect(f.artifactFetch.mock.calls.some(c => c[1]?.method === 'HEAD')).toBe(false)
})
it.each(['official', 'custom'] as const)('模拟：%s 操作启动后切换设置，仅下一次操作改变自动换源策略', async source => {
  const f = fixture()
  f.service.saveDownloadSource(source === 'custom' ? { source, customUrl: OFFICIAL_NPM_REGISTRY } : { source })
  vi.mocked(f.backend.spawn).mockImplementation(() => {
    f.identities.set('codex', syntheticIdentity('codex', '1.2.3'))
    return { stdout: Readable.from([]), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), waitForExit: vi.fn(async () => true), terminate: vi.fn() }
  })
  await checked(f.service)
  const artifact = vi.spyOn(npmDownload, 'prepareNpmDownload')
  f.service.start('codex', 'update', f.service.snapshot().entries.find(e => e.cli === 'codex')!.planToken!, '', `模拟-锁定-${source}`)
  // Preparation is asynchronous; keep the same registry URL while changing policy.
  f.service.saveDownloadSource(source === 'official' ? { source: 'custom', customUrl: OFFICIAL_NPM_REGISTRY } : { source: 'official' })
  expect((await finished(f.service)).results[0]!.phase).toBe('succeeded')
  expect(artifact.mock.calls.at(-1)![0].automaticSources).toBe(source !== 'custom')
  expect(decodeURI(String(f.artifactFetch.mock.calls[0]![0]))).toBe(source === 'custom' ? 'https://registry.npmjs.org/模拟.tgz' : urls.official)
})
