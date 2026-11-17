/** 模拟：可续传 HTTP 流、5 秒时钟与外部进程；没有真实下载/更新。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadCliArtifact, DOWNLOAD_STALL_MS, DOWNLOAD_RESPONSE_TIMEOUT_MS, DOWNLOAD_SLOW_BYTES_PER_SECOND } from '../src/host/cli-management/download.ts'
import { executeCliOperation } from '../src/host/cli-management/executor.ts'
import { withInterruptionRecovery } from '../src/host/cli-management/recovery.ts'
import { childFixture, control, serviceFixture } from './cli-management-phase-b-fixture.ts'
const roots: string[] = [], fixtures: ReturnType<typeof serviceFixture>[] = []
const temp = () => { const root = realpathSync(mkdtempSync(join(tmpdir(), '慢速-模拟-'))); roots.push(root); return root }
afterEach(async () => { vi.useRealTimers(); for (const f of fixtures.splice(0)) await f.close(); for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })
it('模拟：40 KB/s 的 5 秒窗口重连保留 200000 字节，输出真实速度', async () => {
  vi.useFakeTimers(); const output = vi.fn(), progress = vi.fn(); let controller!: ReadableStreamDefaultController<Uint8Array>
  const fetcher = vi.fn(async (_url, init) => {
    if (fetcher.mock.calls.length === 1) return new Response(new ReadableStream({ start(c) { controller = c; c.enqueue(Buffer.alloc(100_000, 97)) } }), { headers: { 'content-length': '600000', 'accept-ranges': 'bytes' } })
    expect(init.headers.Range).toBe('bytes=200000-')
    return new Response(Buffer.alloc(400_000, 98), { status: 206, headers: { 'content-range': 'bytes 200000-599999/600000' } })
  })
  const pending = downloadCliArtifact({ root: temp(), url: 'https://模拟.invalid/f', expectedBytes: 600000, signal: control(), fetcher, output, progress })
  await vi.waitFor(() => expect(progress.mock.calls.at(-1)![0].downloadedBytes).toBe(100000), { interval: 1 })
  await vi.advanceTimersByTimeAsync(2500); controller.enqueue(Buffer.alloc(100_000, 97))
  await vi.waitFor(() => expect(progress.mock.calls.at(-1)![0].downloadedBytes).toBe(200000), { interval: 1 })
  await vi.advanceTimersByTimeAsync(2500); const file = await pending
  expect(DOWNLOAD_STALL_MS).toBe(5000); expect(DOWNLOAD_RESPONSE_TIMEOUT_MS).toBe(10000); expect(DOWNLOAD_SLOW_BYTES_PER_SECOND).toBe(100_000); expect(readFileSync(file)).toEqual(Buffer.concat([Buffer.alloc(200000, 97), Buffer.alloc(400000, 98)]))
  expect(output).toHaveBeenCalledWith('下载过慢（40.0 KB/s），从 200000 B 处重新连接（第 1 次）\n')
})
it.each(['no-range', 'threshold'])('模拟：%s 不因速度重连', async mode => {
  vi.useFakeTimers(); const progress = vi.fn(), output = vi.fn(); let c!: ReadableStreamDefaultController<Uint8Array>
  const chunk = mode === 'threshold' ? 250000 : 1
  const fetcher = vi.fn(async () => new Response(new ReadableStream({ start(controller) { c = controller; c.enqueue(Buffer.alloc(chunk)) } }), { headers: { 'content-length': String(chunk * 2), ...(mode === 'threshold' ? { 'accept-ranges': 'bytes' } : {}) } }))
  const pending = downloadCliArtifact({ root: temp(), url: 'https://模拟.invalid/f', expectedBytes: chunk * 2, signal: control(), fetcher, progress, output })
  await vi.waitFor(() => expect(progress.mock.calls.at(-1)![0].downloadedBytes).toBe(chunk), { interval: 1 })
  await vi.advanceTimersByTimeAsync(2500); c.enqueue(Buffer.alloc(chunk))
  await vi.waitFor(() => expect(progress.mock.calls.at(-1)![0].downloadedBytes).toBe(chunk * 2), { interval: 1 })
  await vi.advanceTimersByTimeAsync(2500); expect(fetcher).toHaveBeenCalledOnce(); c.close(); await pending; expect(output).not.toHaveBeenCalled()
})
it.each(['complete', 'stall'])('模拟：200 次用完后仍前进不重连，最终 %s', async end => {
  vi.useFakeTimers(); const progress = vi.fn(); let c!: ReadableStreamDefaultController<Uint8Array>
  const fetcher = vi.fn(async (_url, init) => {
    const offset = fetcher.mock.calls.length - 1
    if (offset < 200) return new Response('x', { status: offset ? 206 : 200, headers: offset ? { 'content-range': `bytes ${offset}-204/205`, 'content-length': String(205 - offset) } : { 'content-length': '205', 'accept-ranges': 'bytes' } })
    expect(init.headers.Range).toBe('bytes=200-')
    return new Response(new ReadableStream({ start(controller) { c = controller; c.enqueue(Buffer.from('x')) } }), { status: 206, headers: { 'content-range': 'bytes 200-204/205' } })
  })
  const pending = downloadCliArtifact({ root: temp(), url: 'https://模拟.invalid/f', expectedBytes: 205, signal: control(), fetcher, progress }).catch(e => e)
  await vi.waitFor(() => expect(progress.mock.calls.at(-1)![0].downloadedBytes).toBe(201), { interval: 1, timeout: 3000 })
  for (let n = 202; n <= 204; n++) {
    await vi.advanceTimersByTimeAsync(2500); c.enqueue(Buffer.from('x'))
    await vi.waitFor(() => expect(progress.mock.calls.at(-1)![0].downloadedBytes).toBe(n), { interval: 1 })
  }
  expect(fetcher).toHaveBeenCalledTimes(201); expect(progress.mock.calls.at(-1)![0].resumeCount).toBe(200)
  if (end === 'complete') { c.enqueue(Buffer.from('x')); c.close(); expect(readFileSync(await pending, 'utf8')).toBe('x'.repeat(205)) }
  else { await vi.advanceTimersByTimeAsync(5001); expect((await pending).code).toBe('STALL_LIMIT') }
  expect(fetcher).toHaveBeenCalledTimes(201)
})
it('模拟：外部命令低速输出不会终止或重跑；退出与清理仍正常等待', async () => {
  vi.useFakeTimers(); const f = serviceFixture(); fixtures.push(f); const child = childFixture(), retry = vi.fn()
  vi.mocked(f.backend.spawn).mockReturnValue(child.child as any)
  const pending = withInterruptionRecovery(control(), (signal, evidence) => executeCliOperation(f.backend, f.config, ['/模拟/update'], signal, vi.fn(), undefined, undefined, evidence), retry)
  await vi.waitFor(() => expect(f.backend.spawn).toHaveBeenCalledOnce())
  for (let n = 0; n < 3; n++) { child.child.stdout.write('模拟 40 KB/s\n'); await vi.advanceTimersByTimeAsync(10000) }
  expect(child.child.terminate).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled()
  child.finish(); await vi.waitFor(() => expect(child.child.waitForExit).toHaveBeenCalled()); child.exit(true); await pending
})
it.each(['headers', 'redirect'])('模拟：%s 等待 6 秒且首字节再等 3 秒，不消耗正文 5 秒窗口', async mode => {
  vi.useFakeTimers(); const progress = vi.fn(), output = vi.fn(); let c!: ReadableStreamDefaultController<Uint8Array>
  const fetcher = vi.fn(() => new Promise<Response>(resolve => setTimeout(() => {
    if (mode === 'redirect' && fetcher.mock.calls.length === 1) resolve(new Response(null, { status: 302, headers: { location: 'https://cdn.invalid/file' } }))
    else resolve(new Response(new ReadableStream({ start(controller) { c = controller } }), { headers: { 'content-length': '600000', 'accept-ranges': 'bytes' } }))
  }, mode === 'redirect' ? 3000 : 6000)))
  const pending = downloadCliArtifact({ root: temp(), url: 'https://模拟.invalid/f', redirectHosts: ['cdn.invalid'], expectedBytes: 600000, signal: control(), fetcher, progress, output })
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce(), { interval: 1 })
  await vi.advanceTimersByTimeAsync(6000)
  expect(c).toBeDefined(); await vi.advanceTimersByTimeAsync(3000); c.enqueue(Buffer.alloc(300000))
  await vi.waitFor(() => expect(progress.mock.calls.at(-1)![0].downloadedBytes).toBe(300000), { interval: 1 })
  await vi.advanceTimersByTimeAsync(2500)
  expect(fetcher).toHaveBeenCalledTimes(mode === 'redirect' ? 2 : 1)
  c.enqueue(Buffer.alloc(300000)); c.close(); await pending
  expect(output).not.toHaveBeenCalled()
})
it('模拟：5 秒低速重连后服务器忽略 Range，后续低速窗口不再重连', async () => {
  vi.useFakeTimers(); const progress = vi.fn(), output = vi.fn(); let c!: ReadableStreamDefaultController<Uint8Array>
  const fetcher = vi.fn(async (_url, init) => {
    if (fetcher.mock.calls.length > 1) expect(init.headers.Range).toBe('bytes=200000-')
    return new Response(new ReadableStream({ start(controller) { c = controller; c.enqueue(Buffer.alloc(100000)) } }), { headers: { 'content-length': '600000', 'accept-ranges': 'bytes' } })
  })
  const pending = downloadCliArtifact({ root: temp(), url: 'https://模拟.invalid/f', expectedBytes: 600000, signal: control(), fetcher, progress, output })
  await vi.waitFor(() => expect(progress.mock.calls.at(-1)![0].downloadedBytes).toBe(100000), { interval: 1 })
  await vi.advanceTimersByTimeAsync(2500); c.enqueue(Buffer.alloc(100000))
  await vi.waitFor(() => expect(progress.mock.calls.at(-1)![0].downloadedBytes).toBe(200000), { interval: 1 })
  await vi.advanceTimersByTimeAsync(2500)
  await vi.waitFor(() => expect(progress.mock.calls.at(-1)![0].downloadedBytes).toBe(100000), { interval: 1 })
  for (let n = 2; n <= 6; n++) {
    await vi.advanceTimersByTimeAsync(2500); c.enqueue(Buffer.alloc(100000))
    await vi.waitFor(() => expect(progress.mock.calls.at(-1)![0].downloadedBytes).toBe(n * 100000), { interval: 1 })
  }
  c.close(); await pending; expect(fetcher).toHaveBeenCalledTimes(2); expect(output).toHaveBeenCalledOnce()
})
