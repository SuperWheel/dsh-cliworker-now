/** 模拟：可续传 HTTP 流、10 秒时钟与外部进程；没有真实下载/更新。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadCliArtifact, DOWNLOAD_SLOW_BYTES_PER_SECOND } from '../src/host/cli-management/download.ts'
import { executeCliOperation } from '../src/host/cli-management/executor.ts'
import { withInterruptionRecovery } from '../src/host/cli-management/recovery.ts'
import { childFixture, control, serviceFixture } from './cli-management-phase-b-fixture.ts'
const roots: string[] = [], fixtures: ReturnType<typeof serviceFixture>[] = []
const temp = () => { const root = realpathSync(mkdtempSync(join(tmpdir(), '慢速-模拟-'))); roots.push(root); return root }
afterEach(async () => { vi.useRealTimers(); for (const f of fixtures.splice(0)) await f.close(); for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })
it('模拟：40 KB/s 的 10 秒窗口重连保留 400000 字节，输出真实速度', async () => {
  vi.useFakeTimers(); const output = vi.fn(), progress = vi.fn(); let controller!: ReadableStreamDefaultController<Uint8Array>
  const fetcher = vi.fn(async (_url, init) => {
    if (fetcher.mock.calls.length === 1) return new Response(new ReadableStream({ start(c) { controller = c; c.enqueue(Buffer.alloc(200_000, 97)) } }), { headers: { 'content-length': '600000', 'accept-ranges': 'bytes' } })
    expect(init.headers.Range).toBe('bytes=400000-')
    return new Response(Buffer.alloc(200_000, 98), { status: 206, headers: { 'content-range': 'bytes 400000-599999/600000' } })
  })
  const pending = downloadCliArtifact({ root: temp(), url: 'https://模拟.invalid/f', expectedBytes: 600000, signal: control(), fetcher, output, progress })
  await vi.waitFor(() => expect(progress.mock.calls.at(-1)![0].downloadedBytes).toBe(200000), { interval: 1 })
  await vi.advanceTimersByTimeAsync(5000); controller.enqueue(Buffer.alloc(200_000, 97))
  await vi.waitFor(() => expect(progress.mock.calls.at(-1)![0].downloadedBytes).toBe(400000), { interval: 1 })
  await vi.advanceTimersByTimeAsync(5000); const file = await pending
  expect(DOWNLOAD_SLOW_BYTES_PER_SECOND).toBe(100_000); expect(readFileSync(file)).toEqual(Buffer.concat([Buffer.alloc(400000, 97), Buffer.alloc(200000, 98)]))
  expect(output).toHaveBeenCalledWith('下载过慢（40.0 KB/s），从 400000 B 处重新连接（第 1 次）\n')
})
it.each(['no-range', 'threshold'])('模拟：%s 不因速度重连', async mode => {
  vi.useFakeTimers(); const progress = vi.fn(), output = vi.fn(); let c!: ReadableStreamDefaultController<Uint8Array>
  const chunk = mode === 'threshold' ? 500000 : 1
  const fetcher = vi.fn(async () => new Response(new ReadableStream({ start(controller) { c = controller; c.enqueue(Buffer.alloc(chunk)) } }), { headers: { 'content-length': String(chunk * 2), ...(mode === 'threshold' ? { 'accept-ranges': 'bytes' } : {}) } }))
  const pending = downloadCliArtifact({ root: temp(), url: 'https://模拟.invalid/f', expectedBytes: chunk * 2, signal: control(), fetcher, progress, output })
  await vi.waitFor(() => expect(progress.mock.calls.at(-1)![0].downloadedBytes).toBe(chunk), { interval: 1 })
  await vi.advanceTimersByTimeAsync(5000); c.enqueue(Buffer.alloc(chunk))
  await vi.waitFor(() => expect(progress.mock.calls.at(-1)![0].downloadedBytes).toBe(chunk * 2), { interval: 1 })
  await vi.advanceTimersByTimeAsync(5000); expect(fetcher).toHaveBeenCalledOnce(); c.close(); await pending; expect(output).not.toHaveBeenCalled()
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
    await vi.advanceTimersByTimeAsync(5000); c.enqueue(Buffer.from('x'))
    await vi.waitFor(() => expect(progress.mock.calls.at(-1)![0].downloadedBytes).toBe(n), { interval: 1 })
  }
  expect(fetcher).toHaveBeenCalledTimes(201); expect(progress.mock.calls.at(-1)![0].resumeCount).toBe(200)
  if (end === 'complete') { c.enqueue(Buffer.from('x')); c.close(); expect(readFileSync(await pending, 'utf8')).toBe('x'.repeat(205)) }
  else { await vi.advanceTimersByTimeAsync(10001); expect((await pending).code).toBe('STALL_LIMIT') }
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
