/** 模拟：仅用微型内存响应和测试目录，不访问真实发布源或运行 CLI。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, writeFile, readFile, rm, mkdir, symlink, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import * as zlib from 'node:zlib'
import { downloadDescription, decodeArtifact, privatePath, zstdAvailable } from '../src/host/cli-management/artifacts/download.ts'
import { placeArtifact } from '../src/host/cli-management/artifacts/placement.ts'
import { responseMd5 } from '../src/host/cli-management/download-sources.ts'
import { cliDownloadProgressSchema } from '../src/shared/cli-management.ts'
import { DOWNLOAD_MAX_BYTES, parseIntegrity } from '../src/host/cli-management/download.ts'
import type { ArtifactFile, ArtifactDescription } from '../src/host/cli-management/artifacts/types.ts'
import { sri, control } from './cli-management-phase-b-fixture.ts'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cli-artifact-simulated-'))); roots.push(root)
  const directory = join(root, 'bundle'); await mkdir(directory, { mode: 0o700 })
  return { root, directory, signal: control(), progress: vi.fn(), output: vi.fn() }
}
const file = (dest = 'binary', bytes = 'abcdef'): ArtifactFile => ({ dest, sources: ['https://fixture.invalid/' + dest], bytes: Buffer.byteLength(bytes), integrity: sri(bytes, 'sha256') })
it('模拟：GCS base64 MD5 与 Content-MD5 兼容，拒绝矛盾或无效值', () => {
  const bytes = Buffer.from('abcdefghijklmnop'), hex = bytes.toString('hex'), base64 = bytes.toString('base64')
  expect(responseMd5(new Headers({ 'x-goog-hash': `crc32c=abcd, md5=${base64}` }))).toBe(hex)
  expect(responseMd5(new Headers({ 'content-md5': hex, 'x-goog-hash': `md5=${base64}` }))).toBe(hex)
  expect(responseMd5(new Headers({ 'x-goog-hash': 'crc32c=abcd' }))).toBeUndefined()
  expect(() => responseMd5(new Headers({ 'x-goog-hash': 'md5=bad' }))).toThrow()
  expect(() => responseMd5(new Headers({ 'content-md5': 'a'.repeat(32), 'x-goog-hash': `md5=${base64}` }))).toThrow()
})
it('模拟：单源 GCS 响应头 MD5 确实校验工件内容，错误不放置', async () => {
  const f = await fixture(), item = { ...file(), integrity: 'response-md5' }
  const headers = { 'content-length': '6', 'x-goog-hash': `md5=${createHash('md5').update('abcdef').digest('base64')}` }
  await downloadDescription({ files: [item] }, { ...f, fetcher: vi.fn(async () => new Response('abcdef', { headers })) })
  expect(await readFile(join(f.directory, item.dest), 'utf8')).toBe('abcdef')
  await rm(join(f.directory, item.dest))
  await expect(downloadDescription({ files: [item] }, { ...f, fetcher: vi.fn(async () => new Response('badbad', { headers })) })).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  await expect(lstat(join(f.directory, item.dest))).rejects.toThrow()
})
it('模拟：多文件合计字节、总量与续传次数不随文件重置', async () => {
  const f = await fixture(), seen = new Set<string>()
  await downloadDescription({ files: [file('one'), file('two'), file('three')] }, { ...f, fetcher: vi.fn(async (url, init) => {
    const key = String(url)
    if (!seen.has(key)) { seen.add(key); return new Response('abc', { headers: { 'content-length': '6', etag: '"same"' } }) }
    expect((init?.headers as Record<string, string>).Range).toBe('bytes=3-')
    expect((init?.headers as Record<string, string>)['If-Range']).toBe('"same"')
    return new Response('def', { status: 206, headers: { 'content-length': '3', 'content-range': 'bytes 3-5/6', etag: '"same"' } })
  }) })
  expect(f.progress).toHaveBeenLastCalledWith(expect.objectContaining({ channel: 'takeover', downloadedBytes: 18, totalBytes: 18, resumeCount: 3, fileCount: 3, completedFiles: 3 }))
  const values = f.progress.mock.calls.map(c => c[0].downloadedBytes)
  expect(values.every((v, i) => i === 0 || v >= values[i - 1]!)).toBe(true)
})
it('模拟：122 个 SHA-512 小文件从 Range 0-0 读取长度，合计进度、包步数及续传不重置', async () => {
  const f = await fixture(), partial = new Set<string>(), cancelled = vi.fn()
  const payloads = Array.from({ length: 122 }, (_, i) => `package-${i}`)
  const files: ArtifactFile[] = payloads.map((data, i) => ({ ...file(`package-${i}.tgz`, data), bytes: 'RANGE', integrity: sri(data, 'sha512') }))
  let probes = 0
  const fetcher = vi.fn(async (url, init) => {
    const index = files.findIndex(item => item.sources[0] === String(url)), data = payloads[index]!, etag = `"package-${index}"`
    const range = new Headers(init?.headers).get('range')
    expect(init?.credentials).toBe('omit')
    expect(init?.method).not.toBe('HEAD')
    if (range === 'bytes=0-0') {
      probes++
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(data[0]!)) }, cancel: cancelled }), { status: 206, headers: { 'content-range': `bytes 0-0/${data.length}`, 'content-length': '1', etag } })
    }
    if (range) {
      expect(range).toBe('bytes=3-'); expect(new Headers(init?.headers).get('if-range')).toBe(etag)
      return new Response(data.slice(3), { status: 206, headers: { 'content-range': `bytes 3-${data.length - 1}/${data.length}`, 'content-length': String(data.length - 3), etag } })
    }
    if ((index === 0 || index === 121) && !partial.has(String(url))) {
      partial.add(String(url)); return new Response(data.slice(0, 3), { headers: { 'content-length': String(data.length), etag } })
    }
    // Full GET may omit Content-Length; the one-byte probe is the source of total length.
    return new Response(data, { headers: { etag } })
  })
  await downloadDescription({ files }, { ...f, fetcher })
  const total = payloads.reduce((n, data) => n + data.length, 0)
  expect(probes).toBe(124); expect(cancelled).toHaveBeenCalledTimes(probes)
  expect(f.progress).toHaveBeenLastCalledWith(expect.objectContaining({ byteProgressState: 'known-total', downloadedBytes: total, totalBytes: total, fileCount: 122, completedFiles: 122, currentStep: 122, totalSteps: 122, stepName: 'package-121.tgz', resumeCount: 2 }))
  const values = f.progress.mock.calls.map(([p]) => cliDownloadProgressSchema.parse(p))
  expect(values.some(p => p.downloadedBytes! > 0 && p.byteProgressState === 'unknown-total' && p.totalBytes === undefined)).toBe(true)
  expect(values.every((p, i) => i === 0 || p.downloadedBytes! >= values[i - 1]!.downloadedBytes!)).toBe(true)
  for (const [i, item] of files.entries()) expect(await readFile(join(f.directory, item.dest), 'utf8')).toBe(payloads[i])
})
it.each(['ignored', 'unknown', 'wrong-range', 'wrong-length', 'oversize', 'weak-etag', 'encoded', 'changed-identity'])('模拟：Range 0-0 拒绝不可信长度或身份 %s', async mode => {
  const f = await fixture(), item: ArtifactFile = { ...file(), bytes: 'RANGE' }, cancelled = vi.fn()
  const fetcher = vi.fn(async (_url, init) => {
    if (new Headers(init?.headers).get('range') !== 'bytes=0-0') return new Response('abcdef', { headers: { etag: '"changed"' } })
    const headers: Record<string, string> = { 'content-range': 'bytes 0-0/6', 'content-length': '1', etag: '"object"' }
    if (mode === 'unknown') headers['content-range'] = 'bytes 0-0/*'
    if (mode === 'wrong-range') headers['content-range'] = 'bytes 1-1/6'
    if (mode === 'wrong-length') headers['content-length'] = '6'
    if (mode === 'oversize') headers['content-range'] = `bytes 0-0/${DOWNLOAD_MAX_BYTES + 1}`
    if (mode === 'weak-etag') headers.etag = 'W/"object"'
    if (mode === 'encoded') headers['content-encoding'] = 'gzip'
    return new Response(new ReadableStream({ cancel: cancelled }), { status: mode === 'ignored' ? 200 : 206, headers })
  })
  await expect(downloadDescription({ files: [item] }, { ...f, fetcher })).rejects.toMatchObject({ code: 'NETWORK' })
  expect(cancelled).toHaveBeenCalledOnce()
  await expect(lstat(join(f.directory, item.dest))).rejects.toThrow()
})
it.each(['gzip', 'zstd'] as const)('模拟：%s 压缩摘要与解压后二次摘要均通过才暴露落点', async compression => {
  const f = await fixture(), text = Buffer.from('模拟解压二进制')
  const payload = compression === 'gzip' ? zlib.gzipSync(text) : zlib.zstdCompressSync(text)
  const item: ArtifactFile = { ...file(), bytes: payload.length, integrity: sri(payload, 'sha256'), compression, decodedIntegrity: sri(text, 'sha256'), decodedBytes: text.length }
  await downloadDescription({ files: [item] }, { ...f, fetcher: vi.fn(async () => new Response(payload)) })
  expect(await readFile(join(f.directory, 'binary'))).toEqual(text)
  expect((await lstat(join(f.directory, 'binary'))).mode & 0o777).toBe(0o600)
  await rm(join(f.directory, 'binary'))
  await expect(downloadDescription({ files: [{ ...item, decodedIntegrity: sri('模拟错误', 'sha256') }] }, { ...f, fetcher: vi.fn(async () => new Response(payload)) })).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  await expect(lstat(join(f.directory, 'binary'))).rejects.toThrow()
})
it('模拟：zstd 存在与缺失分支；缺失报告前提不足，压缩炸弹受剩余预算限制', async () => {
  const f = await fixture(), source = join(f.directory, 'compressed'), data = zlib.gzipSync('abcdef')
  await writeFile(source, data)
  const item: ArtifactFile = { ...file(), compression: 'zstd', decodedIntegrity: sri('abcdef', 'sha256') }
  expect(zstdAvailable()).toBe(typeof zlib.createZstdDecompress === 'function')
  await expect(decodeArtifact(source, item, f.signal, 1024, null)).rejects.toMatchObject({ code: 'PREREQUISITE_MISSING' })
  await expect(decodeArtifact(source, { ...item, compression: 'gzip' }, f.signal, 2)).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  await expect(decodeArtifact(source, { ...item, decodedIntegrity: undefined }, f.signal, 1024, null)).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
})
it.each(['same', 'version', 'digest', 'length'] as const)('模拟：OMP 预签名续传 403 重取清单 %s', async mode => {
  const f = await fixture(), base = 'https://d4c085d38fe197a3f20bbeb20222b8b3.r2.cloudflarestorage.com/ompcast/builds/omp/mock'
  const refresh = vi.fn(async () => ({ version: mode === 'version' ? '2.0.0' : '1.2.3', sources: [base + '?new=1'], bytes: mode === 'length' ? 7 : 6, integrity: sri(mode === 'digest' ? 'badbad' : 'abcdef', 'sha256') }))
  const item = { ...file(), sources: [base + '?old=1'], officialSignedArtifact: true, presigned: { version: '1.2.3', refresh } }
  let count = 0
  const pending = downloadDescription({ files: [item] }, { ...f, fetcher: vi.fn(async (url, init) => {
    if (++count === 1) return new Response('abc', { headers: { 'content-length': '6', etag: '"object"' } })
    if (count === 2) return new Response(null, { status: 403 })
    expect(String(url)).toBe(base + '?new=1'); expect((init?.headers as Record<string, string>).Range).toBe('bytes=3-')
    return new Response('def', { status: 206, headers: { 'content-length': '3', 'content-range': 'bytes 3-5/6', etag: '"object"' } })
  }) })
  if (mode === 'same') { await pending; expect(await readFile(join(f.directory, 'binary'), 'utf8')).toBe('abcdef') }
  else await expect(pending).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  expect(refresh).toHaveBeenCalledOnce()
})
it('模拟：路径碰撞、缺少摘要、多文件超过 2 GB 在下载前拒绝', async () => {
  const f = await fixture(), fetcher = vi.fn()
  for (const files of [[file('same'), file('SAME')], [{ ...file(), integrity: undefined }], [{ ...file(), bytes: DOWNLOAD_MAX_BYTES }, file('second')]]) {
    await expect(downloadDescription({ files }, { ...f, fetcher })).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  }
  for (const path of ['../evil', '/evil', 'C:\\evil', 'a/../../b', 'a/NUL.exe', 'a/..']) expect(() => privatePath(f.directory, path)).toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})
const description = (target: string): ArtifactDescription => ({ manifest: { urls: [], version: '1.2.3', versionField: 'version', platformKey: '模拟' }, platform: 'darwin', files: [], extras: [], officialProbe: { kind: 'stage' }, allowedTargets: [target], placement: { kind: 'replace-binary', file: 'binary', target } })
it('模拟：放置 a/b/c 共用入口，白名单与版本链接原子更新', async () => {
  const f = await fixture(), target = join(f.root, 'cli'), versionFile = join(f.root, 'versions/1.2.3')
  await mkdir(join(f.root, 'versions')); await writeFile(join(f.root, 'versions/1.0.0'), 'old')
  await writeFile(join(f.directory, 'binary'), 'new'); await writeFile(target, 'old')
  const desc = description(target), run = vi.fn(async () => {})
  await placeArtifact(desc, f.directory, f.signal, run)
  expect(await readFile(target, 'utf8')).toBe('new'); expect((await lstat(target)).mode & 0o777).toBe(0o755)
  await rm(target); await symlink(join(f.root, 'versions/1.0.0'), target)
  desc.allowedTargets.push(versionFile); desc.placement = { kind: 'versioned-link', file: 'binary', versionFile, target, link: true }
  await placeArtifact(desc, f.directory, f.signal, run)
  expect(await readFile(target, 'utf8')).toBe('new'); expect(await readFile(join(f.root, 'versions/1.0.0'), 'utf8')).toBe('old')
  desc.placement = { kind: 'official-local', argv: ['/模拟/install', '--binary', join(f.directory, 'binary')] }
  await placeArtifact(desc, f.directory, f.signal, run); expect(run).toHaveBeenCalledWith(desc.placement.argv, f.signal)
})
it('模拟：放置拒绝未授权目标及符号链接父目录；d 只取指定成员', async () => {
  const f = await fixture(), target = join(f.root, 'cli'), run = vi.fn(async (argv: string[]) => { expect(argv).toEqual(['/usr/bin/unzip', '-q', join(f.directory, 'archive.zip'), 'tool', '-d', f.directory]); await writeFile(join(f.directory, 'tool'), 'new') })
  const desc = description(target)
  desc.placement = { kind: 'extract-replace', archive: 'archive.zip', format: 'zip', member: 'tool', target }
  await placeArtifact(desc, f.directory, f.signal, run); expect(await readFile(target, 'utf8')).toBe('new')
  desc.allowedTargets = []
  await expect(placeArtifact(desc, f.directory, f.signal, run)).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  await symlink(f.directory, join(f.root, 'linked'))
  desc.allowedTargets = [join(f.root, 'linked/cli')]; desc.placement = { kind: 'replace-binary', file: 'tool', target: desc.allowedTargets[0]! }
  await expect(placeArtifact(desc, f.directory, f.signal, run)).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
})
it('模拟：进度运行时 schema 拒绝非法通道、负数和阶段伪字节', () => {
  expect(cliDownloadProgressSchema.parse({ readable: false, byteProgress: false, resumeCount: 0, channel: 'official', stage: 'Checking' }).stage).toBe('Checking')
  for (const value of [{ channel: 'made-up' }, { downloadedBytes: -1 }, { byteProgress: false, downloadedBytes: 0 }, { fileCount: 1, completedFiles: 2 }]) expect(cliDownloadProgressSchema.safeParse({ readable: false, resumeCount: 0, ...value }).success).toBe(false)
})
it('模拟：Hermes 六步、Pi 122 包与未知总量字节协议相互独立且往返保留', () => {
  const base = { channel: 'official', readable: false, byteProgress: false, byteProgressState: 'none', resumeCount: 0 }
  const phase = { ...base, currentStep: 3, totalSteps: 6, stepName: 'apply', stage: '模拟 Hermes apply' }
  expect(cliDownloadProgressSchema.parse(JSON.parse(JSON.stringify(phase)))).toEqual(phase)
  const packages = { ...base, currentStep: 42, totalSteps: 122, stepName: '模拟包' }
  expect(cliDownloadProgressSchema.parse(packages)).toEqual(packages)
  const fetch = { ...phase, readable: true, byteProgress: true, byteProgressState: 'unknown-total', downloadedBytes: 4096, stage: '模拟 fetch' }
  expect(cliDownloadProgressSchema.parse(fetch)).toEqual(fetch)
  expect(cliDownloadProgressSchema.parse(fetch).totalBytes).toBeUndefined()
})
it('模拟：阶段步数和未知总量状态拒绝缺项、越界和伪造总量', () => {
  for (const fields of [{ currentStep: 1 }, { totalSteps: 6 }, { stepName: 'apply' }, { currentStep: 7, totalSteps: 6, stepName: 'apply' }, { currentStep: 1.5, totalSteps: 6, stepName: 'apply' }, { currentStep: 0, totalSteps: 0, stepName: 'apply' }, { currentStep: 1, totalSteps: 6, stepName: ' ' }]) expect(cliDownloadProgressSchema.safeParse({ readable: false, resumeCount: 0, ...fields }).success).toBe(false)
  for (const fields of [{ byteProgressState: 'unknown-total', totalBytes: 100 }, { byteProgressState: 'known-total' }, { byteProgressState: 'none' }, { byteProgressState: 'unknown-total', downloadedBytes: undefined }, { byteProgressState: 'unknown-total', readable: false }, { byteProgressState: 'unknown-total', byteProgress: false }]) expect(cliDownloadProgressSchema.safeParse({ readable: true, downloadedBytes: 1, resumeCount: 0, ...fields }).success).toBe(false)
})

it.each([true, false])('模拟：工件跳转仅跟随描述中的主机白名单 %s', async allowed => {
  const f = await fixture(), fetcher = vi.fn(async url => String(url).includes('fixture.invalid') ? new Response(null, { status: 302, headers: { location: 'https://cdn.invalid/binary' } }) : new Response('abcdef'))
  const pending = downloadDescription({ files: [{ ...file(), redirectHosts: [allowed ? 'cdn.invalid' : 'different.invalid'] }] }, { ...f, fetcher })
  if (allowed) { await pending; expect(await readFile(join(f.directory, 'binary'), 'utf8')).toBe('abcdef'); expect(f.progress.mock.calls.at(-1)![0].sourceHost).toBe('cdn.invalid') }
  else { await expect(pending).rejects.toMatchObject({ code: 'NETWORK' }); expect(fetcher).toHaveBeenCalledOnce() }
})

it('模拟：多个摘要优先选择 sha512、sha256，MD5 不覆盖较强摘要', () => {
  expect(parseIntegrity([sri('mock', 'md5'), sri('mock', 'sha256')].join(' ')).algorithm).toBe('sha256')
  expect(parseIntegrity([sri('mock', 'sha256'), sri('mock', 'sha512')].join(' ')).algorithm).toBe('sha512')
})
it('模拟：摘要失败后重取遇到 validator/长度变化，不截断已关闭句柄，合计改用新总量', async () => {
  const { downloadCliArtifact } = await import('../src/host/cli-management/download.ts')
  const f = await fixture()
  let heads = 0, gets = 0
  const fetcher = vi.fn(async (_url, init) => {
    if (init?.method === 'HEAD') {
      heads++
      return new Response(null, { headers: { etag: heads === 1 ? '"old"' : '"new"', 'content-length': heads === 1 ? '4' : '6' } })
    }
    gets++
    return new Response(gets === 1 ? 'xxxx' : 'abcdef', { headers: { etag: gets === 1 ? '"old"' : '"new"', 'content-length': gets === 1 ? '4' : '6' } })
  })
  const item = { dest: 'binary', sources: ['https://fixture.invalid/one', 'https://fixture.invalid/two'], integrity: sri('abcdef') }
  await downloadDescription({ files: [item] }, { ...f, fetcher, download: input => downloadCliArtifact({ ...input, restartOnValidatorChange: true }) })
  expect(await readFile(join(f.directory, 'binary'), 'utf8')).toBe('abcdef')
  expect(gets).toBe(2)
  const progress = f.progress.mock.calls.map(([p]) => cliDownloadProgressSchema.parse(p))
  expect(progress.some(p => p.totalBytes === 4)).toBe(true)
  expect(progress.some(p => p.totalBytes === undefined && p.downloadedBytes === 0)).toBe(true)
  expect(progress.at(-1)).toMatchObject({ downloadedBytes: 6, totalBytes: 6, byteProgressState: 'known-total' })
})
