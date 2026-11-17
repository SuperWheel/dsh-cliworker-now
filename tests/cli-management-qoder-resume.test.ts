/** 模拟：2026-11-17 Qoder 1.1.90 OSS 响应头；不访问网络或执行更新。 */
import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactSources } from '../src/host/cli-management/download-sources.ts'
import { downloadCliArtifact } from '../src/host/cli-management/download.ts'
import { control, sri } from './cli-management-phase-b-fixture.ts'
const url = 'https://qoder-ide.oss-accelerate.aliyuncs.com/qodercli/releases/1.1.90/qodercli-darwin-arm64.tar.gz'
const etag = '"A0EA6F418279C9CEFB4ED113B202F98A"'
const head = { etag, 'content-md5': 'oOpvQYJ5yc77TtETsgL5ig==', 'content-length': '68148975', 'content-range': 'bytes 0-68148974/68148975', 'accept-ranges': 'bytes' }
const partial = { etag, 'content-length': '4096', 'content-range': 'bytes 34405730-34409825/68148975', 'accept-ranges': 'bytes' }
const roots: string[] = []
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })) })
const temp = () => { const root = realpathSync(mkdtempSync(join(tmpdir(), 'qoder-resume-模拟-'))); roots.push(root); return root }
const probe = async (requireMd5 = false, headers: HeadersInit = head) => {
  const sources = new ArtifactSources([url], vi.fn(async () => new Response(null, { status: 206, headers })), control(), 100_000_000, requireMd5)
  await sources.select(); return sources
}
it('模拟：OSS HEAD/200 含完整 MD5，206 省略 MD5，强 ETag 和 Content-Range 总长度一致可续传', async () => {
  const sources = await probe()
  expect(() => sources.validate(new Response(null, { headers: head }))).not.toThrow()
  expect(() => sources.validate(new Response(null, { status: 206, headers: partial }))).not.toThrow()
  expect(sources.md5).toBe('a0ea6f418279c9cefb4ed113b202f98a')
  expect(sources.etag).toBe(etag); expect(sources.length).toBe(68148975)
})
it.each([
  { etag: '"different-object"' }, { etag: `W/${etag}` }, { etag: '' },
  { 'content-md5': 'AAAAAAAAAAAAAAAAAAAAAA==' },
  { 'content-range': 'bytes 34405730-34409825/68148976' },
])('模拟：OSS 206 身份发生变化仍拒绝追加 %j', async changed => {
  const sources = await probe()
  expect(() => sources.validate(new Response(null, { status: 206, headers: { ...partial, ...changed } }))).toThrow('下载源工件身份不一致')
})
it('模拟：要求每次 MD5、无强 ETag 或完整 200 缺 MD5 时不放宽', async () => {
  const strict = await probe(true)
  expect(() => strict.validate(new Response(null, { status: 206, headers: partial }))).toThrow()
  const { etag: _, ...digestOnlyHead } = head
  const digestOnly = await probe(false, digestOnlyHead)
  expect(() => digestOnly.validate(new Response(null, { status: 206, headers: partial }))).toThrow()
  const sources = await probe()
  expect(() => sources.validate(new Response(null, { headers: { etag, 'content-length': '68148975' } }))).toThrow()
})
it.each(['valid', 'md5-corrupt', 'sha256-corrupt'])('模拟：OSS 模式按精确 Range/If-Range 续传，保留最终长度及摘要校验 %s', async mode => {
  const md5 = createHash('md5').update('abcdef').digest('base64')
  const headers = { etag, 'content-md5': md5, 'content-length': '6', 'accept-ranges': 'bytes' }
  let gets = 0
  const fetcher = vi.fn(async (_url, init) => {
    if (init?.method === 'HEAD') return new Response(null, { headers })
    if (++gets === 1) return new Response('abc', { headers })
    if (gets === 2) {
      expect(init?.headers).toMatchObject({ Range: 'bytes=3-', 'If-Range': etag, 'Accept-Encoding': 'identity' })
      return new Response(mode === 'md5-corrupt' ? 'deg' : 'def', { status: 206, headers: { etag, 'content-length': '3', 'content-range': 'bytes 3-5/6' } })
    }
    expect(init?.headers.Range).toBeUndefined()
    return new Response(mode === 'md5-corrupt' ? 'abcdeg' : 'abcdef', { headers })
  })
  const pending = downloadCliArtifact({ root: temp(), url, sources: [url], integrity: sri(mode === 'sha256-corrupt' ? 'wrong!' : 'abcdef', 'sha256'), signal: control(), fetcher, progress: vi.fn() })
  if (mode === 'valid') { expect(readFileSync(await pending, 'utf8')).toBe('abcdef'); expect(gets).toBe(2) }
  else { await expect(pending).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' }); expect(gets).toBe(3) }
})
