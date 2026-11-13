/** 模拟：HTTP 流、时钟和磁盘夹具；不访问发布源或运行安装程序。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, readFileSync, statSync, readdirSync, writeFileSync, utimesSync, truncateSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { downloadCliArtifact, prepareDownloads, DOWNLOAD_TIMEOUT_MS, DOWNLOAD_MAX_BYTES, DOWNLOAD_RETENTION_MS } from '../src/host/cli-management/download.ts'
import { control, sri } from './cli-management-phase-b-fixture.ts'
const roots: string[] = []
const temp = () => { const path = realpathSync(mkdtempSync(join(tmpdir(), 'download-模拟-'))); roots.push(path); return path }
afterEach(() => { vi.useRealTimers(); for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })
const stream = (initial: string, complete = false) => new ReadableStream<Uint8Array>({ start(c) { if (initial) c.enqueue(Buffer.from(initial)); if (complete) c.close() } })

it.each([206, 200, 416])('模拟：10 秒无字节，Range 响应 %s 正确处理并校验', async status => {
  vi.useFakeTimers(); const root = temp(), progress = vi.fn()
  const fetcher = vi.fn(async (_url, init) => {
    if (fetcher.mock.calls.length === 1) return new Response(stream(status === 416 ? 'abcdef' : 'abc'), { headers: { 'content-length': '6' } })
    expect(init.headers.Range).toBe(status === 416 ? 'bytes=6-' : 'bytes=3-')
    if (status === 416) return new Response(null, { status: 416, headers: { 'content-range': 'bytes */6' } })
    return new Response(status === 200 ? 'abcdef' : 'def', { status, headers: status === 206 ? { 'content-range': 'bytes 3-5/6' } : { 'content-length': '6' } })
  })
  const pending = downloadCliArtifact({ root, url: 'https://模拟.invalid/file', integrity: sri('abcdef'), signal: control(), progress, fetcher })
  await vi.waitFor(() => expect(progress).toHaveBeenCalled(), { interval: 1 })
  await vi.advanceTimersByTimeAsync(10_001)
  const file = await pending
  expect(readFileSync(file, 'utf8')).toBe('abcdef'); expect(fetcher).toHaveBeenCalledTimes(2)
  expect(progress.mock.calls.at(-1)![0]).toMatchObject({ downloadedBytes: 6, totalBytes: 6, resumeCount: 1 })
  expect(statSync(file).mode & 0o777).toBe(0o600); expect(statSync(join(root, 'cli-management/downloads')).mode & 0o777).toBe(0o700)
})
it('模拟：200 次续传上限，201 个请求后 STALL_LIMIT', async () => {
  vi.useFakeTimers(); const fetcher = vi.fn(() => new Promise<Response>(() => {})), root = temp()
  const pending = downloadCliArtifact({ root, url: 'https://模拟.invalid/file', integrity: sri(''), signal: control(), progress: vi.fn(), fetcher }).catch(error => error)
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce(), { interval: 1 })
  await vi.advanceTimersByTimeAsync(201 * 10_000 + 1)
  expect((await pending).code).toBe('STALL_LIMIT'); expect(fetcher).toHaveBeenCalledTimes(201)
})
it('模拟：持续有真实字节仍受两小时总预算约束', async () => {
  vi.useFakeTimers(); const root = temp(), progress = vi.fn()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(c) { controller = c } })))
  const pending = downloadCliArtifact({ root, url: 'https://模拟.invalid/file', integrity: sri('unused'), signal: control(), progress, fetcher }).catch(error => error)
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce(), { interval: 1 })
  // Every nine seconds an actual byte arrives; await its disk write before advancing.
  for (let n = 1; n < DOWNLOAD_TIMEOUT_MS / 9000; n++) {
    await vi.advanceTimersByTimeAsync(9000); controller.enqueue(Buffer.from('x'))
    await vi.waitFor(() => expect(progress.mock.calls.at(-1)![0].downloadedBytes).toBe(n), { interval: 1 })
  }
  await vi.advanceTimersByTimeAsync(9001)
  expect((await pending).code).toBe('DOWNLOAD_TIMEOUT'); expect(fetcher).toHaveBeenCalledTimes(1)
}, 15000)
it.each(['sha256', 'sha512'])('模拟：%s 校验与错误摘要删除文件', async algorithm => {
  const root = temp(), options = { root, url: 'https://模拟.invalid/file', signal: control(), progress: vi.fn(), fetcher: vi.fn(async () => new Response('模拟')) }
  const file = await downloadCliArtifact({ ...options, integrity: sri('模拟', algorithm) }); expect(readFileSync(file, 'utf8')).toBe('模拟')
  await expect(downloadCliArtifact({ ...options, integrity: sri('wrong', algorithm) })).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  expect(readdirSync(join(root, 'cli-management/downloads'))).toHaveLength(1)
})
it('模拟：取消删除部分文件，非法 206/416 不能视为完成', async () => {
  const root = temp(), controller = new AbortController(), progress = vi.fn()
  const pending = downloadCliArtifact({ root, url: 'https://模拟.invalid/file', integrity: sri('abc'), signal: controller.signal, progress, fetcher: async () => new Response(stream('abc')) }).catch(error => error)
  await vi.waitFor(() => expect(progress).toHaveBeenCalled()); controller.abort(); await pending
  expect(readdirSync(join(root, 'cli-management/downloads'))).toEqual([])
  for (const [status, range] of [[206, 'bytes 10-12/13'], [416, 'bytes */10']] as const)
    await expect(downloadCliArtifact({ root, url: 'https://模拟.invalid/file', integrity: sri('abc'), signal: control(), progress, fetcher: async () => new Response(null, { status, headers: { 'content-range': range } }) })).rejects.toMatchObject({ code: 'NETWORK' })
})
it('模拟：24 小时与 2 GB 缓存清理，只处理私有目录的普通片段文件', async () => {
  const root = temp(), directory = await prepareDownloads(root), expired = join(directory, `${randomUUID()}.part`), old = join(directory, `${randomUUID()}.part`), recent = join(directory, `${randomUUID()}.part`)
  writeFileSync(expired, 'expired'); utimesSync(expired, new Date(0), new Date(Date.now() - DOWNLOAD_RETENTION_MS - 1000))
  writeFileSync(old, ''); truncateSync(old, DOWNLOAD_MAX_BYTES); utimesSync(old, new Date(), new Date(Date.now() - 1000))
  writeFileSync(recent, 'recent'); writeFileSync(join(directory, 'unrelated.txt'), 'keep')
  await prepareDownloads(root)
  expect(readdirSync(directory).sort()).toEqual([recent.split('/').at(-1)!, 'unrelated.txt'].sort())
})
