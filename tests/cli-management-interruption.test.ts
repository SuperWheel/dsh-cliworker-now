/** 模拟：网络流、进程、时间、版本与磁盘夹具；没有真实更新。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { downloadCliArtifact } from '../src/host/cli-management/download.ts'
import { InterruptionEvidence, RECOVERY_TIMEOUT_MS, recoverableDownloadError, withInterruptionRecovery } from '../src/host/cli-management/recovery.ts'
import { CliOperationError } from '../src/host/cli-management/planner.ts'
import { executeCliOperation } from '../src/host/cli-management/executor.ts'
import { ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
import { bounded } from '../src/host/cli-management/versions.ts'
import { checked, childFixture, control, finished, serviceFixture, sri, syntheticIdentity, until } from './cli-management-phase-b-fixture.ts'
const roots: string[] = [], fixtures: ReturnType<typeof serviceFixture>[] = []
const temp = () => { const root = realpathSync(mkdtempSync(join(tmpdir(), '中断-模拟-'))); roots.push(root); return root }
const fixture = () => { const f = serviceFixture(); fixtures.push(f); return f }
afterEach(async () => { vi.useRealTimers(); for (const f of fixtures.splice(0)) await f.close(); for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })
const interrupted = (error?: Error) => { let n = 0; return new ReadableStream<Uint8Array>({ pull(c) { if (!n++) c.enqueue(Buffer.from('abc')); else if (error) c.error(error); else c.close() } }) }

it.each(['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH', 'EOF', 'TypeError'])('模拟：%s 中断保留已写字节并 Range 续传', async code => {
  const error = code === 'EOF' ? undefined : code === 'TypeError' ? new TypeError('fetch failed') : Object.assign(new Error('transport failed'), { code })
  const fetcher = vi.fn(async (_url, init) => fetcher.mock.calls.length === 1 ? new Response(interrupted(error), { headers: { 'content-length': '6' } }) : (expect(init.headers.Range).toBe('bytes=3-'), new Response('def', { status: 206, headers: { 'content-range': 'bytes 3-5/6', 'content-length': '3' } })))
  const output = vi.fn(), progress = vi.fn()
  const file = await downloadCliArtifact({ root: temp(), url: 'https://模拟.invalid/f', integrity: sri('abcdef'), signal: control(), fetcher, output, progress })
  expect(readFileSync(file, 'utf8')).toBe('abcdef'); expect(fetcher).toHaveBeenCalledTimes(2)
  expect(output).toHaveBeenCalledWith('下载中断，从 3 B 处续传（第 1 次）\n')
  expect(progress.mock.calls.at(-1)![0].resumeCount).toBe(1)
})
it('模拟：建立连接失败从零续传；服务器忽略 Range 的 200 覆盖旧片段', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(new Response(interrupted(), { headers: { 'content-length': '6' } })).mockResolvedValueOnce(new Response('abcdef', { headers: { 'content-length': '6' } }))
  const file = await downloadCliArtifact({ root: temp(), url: 'https://模拟.invalid/f', integrity: sri('abcdef'), signal: control(), fetcher, progress: vi.fn() })
  expect(readFileSync(file, 'utf8')).toBe('abcdef'); expect(fetcher.mock.calls[2]![1].headers.Range).toBe('bytes=3-')
})
it.each([403, 404, 500])('模拟：HTTP %s 不作为网络中断重试', async status => {
  const fetcher = vi.fn(async () => new Response('', { status }))
  await expect(downloadCliArtifact({ root: temp(), url: 'https://模拟.invalid/f', expectedBytes: 6, signal: control(), fetcher, progress: vi.fn() })).rejects.toMatchObject({ code: 'NETWORK' })
  expect(fetcher).toHaveBeenCalledOnce()
})
it.each(['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'])('模拟：嵌套 %s 即使 fetch TypeError 也不续传', async code => {
  const error = new TypeError('fetch failed', { cause: Object.assign(new Error('TLS failure'), { code }) }), fetcher = vi.fn().mockRejectedValue(error)
  expect(recoverableDownloadError(error)).toBe(false)
  await expect(downloadCliArtifact({ root: temp(), url: 'https://模拟.invalid/f', expectedBytes: 6, signal: control(), fetcher, progress: vi.fn() })).rejects.toBe(error)
  expect(fetcher).toHaveBeenCalledOnce()
})
it.each(['wrong-start', 'changed-total', 'wrong-length', 'excess-body'])('模拟：%s 不安全 206 不重试', async mode => {
  const range = mode === 'wrong-start' ? 'bytes 2-5/6' : mode === 'changed-total' ? 'bytes 3-5/7' : 'bytes 3-5/6'
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(interrupted(), { headers: { 'content-length': '6' } })).mockResolvedValueOnce(new Response(mode === 'excess-body' ? 'defg' : 'def', { status: 206, headers: { 'content-range': range, 'content-length': mode === 'wrong-length' ? '4' : '3' } }))
  await expect(downloadCliArtifact({ root: temp(), url: 'https://模拟.invalid/f', expectedBytes: 6, signal: control(), fetcher, progress: vi.fn() })).rejects.toMatchObject({ code: 'NETWORK' })
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('模拟：中断与真实停滞共用次数且输出区分', async () => {
  vi.useFakeTimers(); const output = vi.fn(), fetcher = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { c.enqueue(Buffer.from('abc')) } }), { headers: { 'content-length': '6' } })).mockResolvedValueOnce(new Response('def', { status: 206, headers: { 'content-range': 'bytes 3-5/6' } }))
  const pending = downloadCliArtifact({ root: temp(), url: 'https://模拟.invalid/f', expectedBytes: 6, signal: control(), fetcher, progress: vi.fn(), output })
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)); await vi.advanceTimersByTimeAsync(5_001); await pending
  expect(output.mock.calls.map(c => c[0])).toEqual(['下载中断，从 0 B 处续传（第 1 次）\n', '下载停滞 5 秒，从 3 B 处续传（第 2 次）\n'])
})
it.each(['curl: (18)', 'curl: (28)', 'curl: (52)', 'curl: (56)', 'transfer closed', 'Connection reset', 'ECONNRESET', 'ETIMEDOUT', 'socket hang up', 'unexpected EOF', 'premature close'])('模拟：原始证据 %s 跨块识别', evidence => {
  const detector = new InterruptionEvidence()
  for (const character of evidence) detector.push(character)
  expect(detector.interrupted).toBe(true)
})
it('模拟：200 次外部重试后失败，只有同一 attempt 且不吞清理错误', async () => {
  const retry = vi.fn(), attempt = vi.fn(async (_signal, evidence) => { evidence.push('curl: (18)'); throw new CliOperationError('EXIT_CODE', '18') })
  await expect(withInterruptionRecovery(control(), attempt, retry)).rejects.toMatchObject({ code: 'STALL_LIMIT' })
  expect(attempt).toHaveBeenCalledTimes(201); expect(retry).toHaveBeenCalledTimes(200)
  await expect(withInterruptionRecovery(control(), async (_signal, e) => { e.push('ECONNRESET'); throw new ProcessCleanupUnconfirmedError() }, retry)).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
  expect(retry).toHaveBeenCalledTimes(200)
})
it.each(['cancel', 'deadline'])('模拟：外部恢复 %s 终止当前进程范围后不再重跑', async mode => {
  vi.useFakeTimers(); const f = fixture(), controller = new AbortController(), retry = vi.fn(), child = childFixture()
  vi.mocked(f.backend.spawn).mockReturnValue(child.child as any)
  const pending = withInterruptionRecovery(controller.signal, (signal, evidence) => executeCliOperation(f.backend, f.config, ['/模拟/update'], signal, vi.fn(), RECOVERY_TIMEOUT_MS + 1, undefined, evidence), retry).catch(e => e)
  await vi.waitFor(() => expect(f.backend.spawn).toHaveBeenCalledOnce())
  if (mode === 'cancel') controller.abort(new Error('模拟取消')); else await vi.advanceTimersByTimeAsync(RECOVERY_TIMEOUT_MS)
  await vi.waitFor(() => expect(child.child.terminate).toHaveBeenCalled()); child.finish(); child.exit(true)
  const error = await pending
  expect(mode === 'cancel' ? error.message : error.code).toBe(mode === 'cancel' ? '模拟取消' : 'DOWNLOAD_TIMEOUT'); expect(retry).not.toHaveBeenCalled()
})
it.each([0, 18])('模拟：退出 %s 且版本不变，原始超长输出中的中断触发同 argv 重跑', async exitCode => {
  const f = fixture(); await checked(f.service)
  let count = 0, exited = false
  vi.mocked(f.backend.spawn).mockImplementation(() => {
    count++; if (count > 1) { expect(exited).toBe(true); f.identities.set('codex', syntheticIdentity('codex', '1.2.3')) }
    return { stdout: Readable.from(count === 1 ? ['authorization: Bearer PRIVATE ', 'x'.repeat(70_000), ' curl: (18) transfer closed\nDone\n'] : ['模拟成功\n']), stderr: Readable.from([]), done: Promise.resolve({ exitCode: count === 1 ? exitCode : 0, signal: null }), waitForExit: vi.fn(async () => { exited = true; return true }), terminate: vi.fn() }
  })
  f.service.start('codex', 'update', f.service.snapshot().entries.find(e => e.cli === 'codex')!.planToken!, '', '模拟重跑')
  const result = (await finished(f.service)).results[0]!
  expect(result.phase).toBe('succeeded'); expect(result.progress).toMatchObject({ readable: false, resumeCount: 0, retryCount: 1 })
  expect(result.outputTail).toContain('Done\n'); expect(result.outputTail).toContain('已自动重试 1 次'); expect(result.outputTail).not.toContain('PRIVATE')
  expect(f.backend.spawn).toHaveBeenCalledTimes(2)
  expect(vi.mocked(f.backend.spawn).mock.calls[0]![0].argv).toEqual(vi.mocked(f.backend.spawn).mock.calls[1]![0].argv)
})
it.each(['no-evidence', 'advanced', 'cleanup', 'identity'])('模拟：%s 不重跑', async mode => {
  const f = fixture(); await checked(f.service)
  vi.mocked(f.backend.spawn).mockImplementation(() => {
    if (mode === 'advanced') f.identities.set('codex', syntheticIdentity('codex', '1.2.3'))
    if (mode === 'identity') f.identities.get('codex')!.prefix = '/模拟/other'
    return { stdout: Readable.from([mode === 'no-evidence' ? 'permission denied\n' : 'curl: (18) transfer closed\n']), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), waitForExit: vi.fn(async () => mode !== 'cleanup'), terminate: vi.fn() }
  })
  f.service.start('codex', 'update', f.service.snapshot().entries.find(e => e.cli === 'codex')!.planToken!, '', '模拟禁止重跑')
  const result = (await finished(f.service)).results[0]!
  expect(result.phase).toBe(mode === 'advanced' ? 'succeeded' : mode === 'cleanup' ? 'cleanup-unconfirmed' : 'failed')
  expect(f.backend.spawn).toHaveBeenCalledOnce(); expect(result.progress?.retryCount).toBeUndefined()
})
it('模拟：连续网络中断也在第 201 个请求后结束，超大声明不重试', async () => {
  const fetcher = vi.fn().mockRejectedValue(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))
  await expect(downloadCliArtifact({ root: temp(), url: 'https://模拟.invalid/f', expectedBytes: 6, signal: control(), fetcher, progress: vi.fn() })).rejects.toMatchObject({ code: 'STALL_LIMIT' })
  expect(fetcher).toHaveBeenCalledTimes(201)
  fetcher.mockReset().mockResolvedValue(new Response(null, { headers: { 'content-length': '2147483649' } }))
  await expect(downloadCliArtifact({ root: temp(), url: 'https://模拟.invalid/f', expectedBytes: 6, signal: control(), fetcher, progress: vi.fn() })).rejects.toMatchObject({ code: 'NETWORK' })
  expect(fetcher).toHaveBeenCalledOnce()
})
it('模拟：非零退出但版本已前进仍报告退出错误，不重复安装', async () => {
  const f = fixture(); await checked(f.service)
  vi.mocked(f.backend.spawn).mockImplementation(() => {
    f.identities.set('codex', syntheticIdentity('codex', '1.2.3'))
    return { stdout: Readable.from(['curl: (18)\n']), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 18, signal: null }), waitForExit: vi.fn(async () => true), terminate: vi.fn() }
  })
  f.service.start('codex', 'update', f.service.snapshot().entries.find(e => e.cli === 'codex')!.planToken!, '', '模拟非零已更新')
  const result = (await finished(f.service)).results[0]!
  expect(result).toMatchObject({ phase: 'failed', afterVersion: '1.2.3', error: { code: 'EXIT_CODE' } }); expect(f.backend.spawn).toHaveBeenCalledOnce()
})
