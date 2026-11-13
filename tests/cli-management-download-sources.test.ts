/** 模拟：多源 HEAD/GET、时钟、摘要与私有磁盘；不访问真实源或执行安装器。 */
import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadCliArtifact } from '../src/host/cli-management/download.ts'
import { contentMd5 } from '../src/host/cli-management/download-sources.ts'
import { MIMO_RELEASE_SOURCES, MIMO_SOURCE_POLICY } from '../src/host/cli-management/sources.ts'
import { ReleaseClient } from '../src/host/cli-management/versions.ts'
import { control } from './cli-management-phase-b-fixture.ts'
const roots: string[] = []
const temp = () => { const root = realpathSync(mkdtempSync(join(tmpdir(), 'sources-模拟-'))); roots.push(root); return root }
afterEach(() => { vi.useRealTimers(); roots.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })) })
const sources = MIMO_RELEASE_SOURCES.map(base => `${base}v0.1.17/mimocode-darwin-arm64.zip`)
const md5 = createHash('md5').update('abcdef').digest('hex')
const headers = { 'content-length': '6', etag: '"same-object"', 'content-md5': md5, 'accept-ranges': 'bytes' }
const opts = () => ({ root: temp(), url: sources[0]!, sources, requireContentMd5: true, signal: control(), progress: vi.fn(), output: vi.fn() })
it('模拟：MiMo 首选 API 官方源成功，无备用 GET，长度和 MD5/结构准备前完整校验', async () => {
  const fetcher = vi.fn(async (url, init) => {
    expect(String(url)).toBe(sources[0]); expect(init?.credentials).toBe('omit'); expect(init?.redirect).toBe('error')
    return new Response(init?.method === 'HEAD' ? null : 'abcdef', { headers })
  })
  const file = await downloadCliArtifact({ ...opts(), fetcher })
  expect(readFileSync(file, 'utf8')).toBe('abcdef'); expect(fetcher).toHaveBeenCalledTimes(2)
  expect(MIMO_SOURCE_POLICY).toEqual({ hosts: ['cnbj1.fds.api.xiaomi.com', 'mimocode.cnbj1.mi-fds.com'], pathPrefix: '/mimocode/mimocode/releases/' })
})
it.each(['EOF', 'ECONNRESET'])('模拟：%s 中断轮换源，从已落盘字节 Range/If-Range 续传', async error => {
  const options = opts()
  const fetcher = vi.fn(async (url, init) => {
    if (init?.method === 'HEAD') return new Response(null, { headers })
    if (String(url) === sources[0]) {
      let sent = false
      return new Response(new ReadableStream<Uint8Array>({ pull(c) { if (!sent) { c.enqueue(Buffer.from('abc')); sent = true } else if (error === 'EOF') c.close(); else c.error(Object.assign(new Error('reset'), { code: error })) } }), { headers })
    }
    expect(init?.headers).toMatchObject({ Range: 'bytes=3-', 'If-Range': '"same-object"' })
    return new Response('def', { status: 206, headers: { ...headers, 'content-length': '3', 'content-range': 'bytes 3-5/6' } })
  })
  const file = await downloadCliArtifact({ ...options, fetcher })
  expect(readFileSync(file, 'utf8')).toBe('abcdef'); expect(fetcher).toHaveBeenCalledTimes(4)
  expect(options.output).toHaveBeenCalledWith('切换到 mimocode.cnbj1.mi-fds.com 继续下载（第 1 次）\n')
  expect(options.progress.mock.calls.at(-1)![0].resumeCount).toBe(1)
})
it('模拟：仅 HEAD 声明 Range 时低于 100 KB/s 的 10 秒窗口换源保留已下字节', async () => {
  vi.useFakeTimers(); const options = opts(); let stream!: ReadableStreamDefaultController<Uint8Array>
  const fetcher = vi.fn(async (url, init) => {
    if (init?.method === 'HEAD') return new Response(null, { headers })
    if (String(url) === sources[0]) return new Response(new ReadableStream<Uint8Array>({ start(c) { stream = c; c.enqueue(Buffer.from('abc')) } }), { headers: { 'content-length': '6', etag: headers.etag, 'content-md5': md5 } })
    expect(init?.headers).toMatchObject({ Range: 'bytes=4-', 'If-Range': '"same-object"' })
    return new Response('ef', { status: 206, headers: { ...headers, 'content-length': '2', 'content-range': 'bytes 4-5/6' } })
  })
  const pending = downloadCliArtifact({ ...options, fetcher })
  await vi.waitFor(() => expect(options.progress.mock.calls.at(-1)?.[0].downloadedBytes).toBe(3), { interval: 1 })
  await vi.advanceTimersByTimeAsync(5000); stream.enqueue(Buffer.from('d'))
  await vi.waitFor(() => expect(options.progress.mock.calls.at(-1)?.[0].downloadedBytes).toBe(4), { interval: 1 })
  await vi.advanceTimersByTimeAsync(5000)
  expect(readFileSync(await pending, 'utf8')).toBe('abcdef')
  expect(options.output).toHaveBeenCalledWith(expect.stringContaining('下载过慢'))
  expect(options.output).toHaveBeenCalledWith('切换到 mimocode.cnbj1.mi-fds.com 继续下载（第 1 次）\n')
})
it.each(['etag', 'content-md5', 'content-length'])('模拟：备用 HEAD %s 不同拒绝换源，绝不 GET 拼接', async field => {
  const fetcher = vi.fn(async (url, init) => {
    if (init?.method !== 'HEAD') return new Response('abc', { headers })
    return new Response(null, { headers: String(url) === sources[0] ? headers : { ...headers, [field]: field === 'etag' ? '"changed"' : field === 'content-length' ? '7' : '0'.repeat(32) } })
  })
  await expect(downloadCliArtifact({ ...opts(), fetcher })).rejects.toMatchObject({ code: 'NETWORK' })
  expect(fetcher).toHaveBeenCalledTimes(3)
})
it('模拟：备用 GET ETag 变化即使 HEAD 一致也拒绝追加', async () => {
  const fetcher = vi.fn(async (url, init) => init?.method === 'HEAD' ? new Response(null, { headers }) : String(url) === sources[0] ? new Response('abc', { headers }) : new Response('def', { status: 206, headers: { ...headers, etag: '"changed"', 'content-length': '3', 'content-range': 'bytes 3-5/6' } }))
  await expect(downloadCliArtifact({ ...opts(), fetcher })).rejects.toMatchObject({ code: 'NETWORK' })
  expect(fetcher).toHaveBeenCalledTimes(4)
})
it.each(['hex', 'base64'])('模拟：content-md5 %s 不符干净重下一次，不消耗恢复预算', async encoding => {
  let gets = 0; const options = opts(), h = { ...headers, 'content-md5': createHash('md5').update('abcdef').digest(encoding as 'hex' | 'base64') }
  const fetcher = vi.fn(async (_url, init) => {
    if (init?.method === 'HEAD') return new Response(null, { headers: h })
    expect((init?.headers as Record<string, string>).Range).toBeUndefined()
    return new Response(++gets === 1 ? 'abcdeg' : 'abcdef', { headers: h })
  })
  expect(readFileSync(await downloadCliArtifact({ ...options, fetcher }), 'utf8')).toBe('abcdef')
  expect(gets).toBe(2); expect(options.progress.mock.calls.at(-1)![0].resumeCount).toBe(0)
  expect(options.output).toHaveBeenCalledWith(expect.stringContaining('干净重新下载一次'))
})
it('模拟：两次 MD5 错误后删除文件并失败', async () => {
  const options = opts(), fetcher = vi.fn(async (_url, init) => new Response(init?.method === 'HEAD' ? null : 'abcdeg', { headers }))
  await expect(downloadCliArtifact({ ...options, fetcher })).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  expect(fetcher).toHaveBeenCalledTimes(4); expect(readdirSync(join(options.root, 'cli-management/downloads'))).toEqual([])
})
it('模拟：首选 HEAD 网络失败才从可用备用建立初始身份', async () => {
  const fetcher = vi.fn(async (url, init) => { if (String(url) === sources[0]) throw new TypeError('fetch failed'); return new Response(init?.method === 'HEAD' ? null : 'abcdef', { headers }) })
  expect(readFileSync(await downloadCliArtifact({ ...opts(), fetcher }), 'utf8')).toBe('abcdef'); expect(fetcher).toHaveBeenCalledTimes(3)
})
it('模拟：全部源 HEAD 失败不开始下载', async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 503 }))
  await expect(downloadCliArtifact({ ...opts(), fetcher })).rejects.toMatchObject({ code: 'NETWORK' })
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('模拟：全部源 GET 中断也只共用 200 次，非每源重新计数', async () => {
  let gets = 0
  const options = opts(), fetcher = vi.fn(async (_url, init) => { if (init?.method === 'HEAD') return new Response(null, { headers }); gets++; throw new TypeError('fetch failed') })
  await expect(downloadCliArtifact({ ...options, fetcher })).rejects.toMatchObject({ code: 'STALL_LIMIT' })
  expect(gets).toBe(201); expect(options.progress.mock.calls.at(-1)![0].resumeCount).toBe(200)
})
it.each(['hex', 'base64', 'invalid'])('模拟：content-md5 %s 解析与字节一致性', mode => {
  if (mode === 'invalid') expect(() => contentMd5('not-a-digest')).toThrow()
  else expect(contentMd5(createHash('md5').update('abcdef').digest(mode as 'hex' | 'base64'))).toBe(md5)
})
it.each(['primary', 'fallback', 'all-failed'])('模拟：MiMo latest %s 使用 API 优先及原域名回落', async mode => {
  const fetcher = vi.fn(async url => mode === 'all-failed' || mode === 'fallback' && String(url).startsWith(MIMO_RELEASE_SOURCES[0]!) ? new Response('', { status: 503 }) : new Response('0.1.17'))
  const pending = new ReleaseClient(fetcher, 'darwin', 'arm64').native('mimo', control())
  if (mode === 'all-failed') await expect(pending).rejects.toThrow()
  else expect(await pending).toMatchObject({ latest: '0.1.17', registry: `${MIMO_RELEASE_SOURCES[mode === 'primary' ? 0 : 1]}latest` })
  expect(fetcher).toHaveBeenCalledTimes(mode === 'primary' ? 1 : 2)
})

it('模拟：两个源 MD5 分别为 hex/base64 时按同一摘要比较，Range 被忽略的 200 覆盖旧片段', async () => {
  const options = opts()
  const fetcher = vi.fn(async (url, init) => {
    const first = String(url) === sources[0], h = { ...headers, 'content-md5': first ? md5 : Buffer.from(md5, 'hex').toString('base64') }
    if (init?.method === 'HEAD') return new Response(null, { headers: h })
    if (!first) expect(init?.headers).toMatchObject({ Range: 'bytes=3-' })
    return new Response(first ? 'abc' : 'abcdef', { headers: h })
  })
  expect(readFileSync(await downloadCliArtifact({ ...options, fetcher }), 'utf8')).toBe('abcdef')
  expect(fetcher).toHaveBeenCalledTimes(4)
})
it('模拟：校验重下前 HEAD 身份变化拒绝悄悄接受新对象', async () => {
  let heads = 0
  const fetcher = vi.fn(async (_url, init) => init?.method === 'HEAD' ? new Response(null, { headers: { ...headers, etag: ++heads === 1 ? headers.etag : '"changed"' } }) : new Response('abcdeg', { headers }))
  await expect(downloadCliArtifact({ ...opts(), fetcher })).rejects.toMatchObject({ code: 'NETWORK' })
  expect(fetcher).toHaveBeenCalledTimes(3)
})
it('模拟：多源取消不回落或重试', async () => {
  const controller = new AbortController(), fetcher = vi.fn(async () => { controller.abort(new Error('模拟取消')); throw new TypeError('fetch failed') })
  await expect(downloadCliArtifact({ ...opts(), signal: controller.signal, fetcher })).rejects.toThrow('模拟取消')
  expect(fetcher).toHaveBeenCalledOnce()
})

it('模拟：多源完整响应长度与 HEAD 不符也仅干净重下一次', async () => {
  let gets = 0
  const fetcher = vi.fn(async (_url, init) => {
    if (init?.method === 'HEAD') return new Response(null, { headers })
    return ++gets === 1 ? new Response('abcde', { headers: { ...headers, 'content-length': '5' } }) : new Response('abcdef', { headers })
  })
  expect(readFileSync(await downloadCliArtifact({ ...opts(), fetcher }), 'utf8')).toBe('abcdef')
  expect(gets).toBe(2)
})
