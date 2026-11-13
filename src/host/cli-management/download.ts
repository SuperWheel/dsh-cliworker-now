import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, lstat, mkdir, open, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { CliDownloadProgress } from '../../shared/cli-management.ts'
import { customRegistryProblem } from '../../shared/cli-management.ts'
import { hostFetch } from '../host-fetch.mjs'
import { bounded } from './versions.ts'
import { CliOperationError } from './planner.ts'

export const DOWNLOAD_STALL_MS = 10_000, DOWNLOAD_RESUMES = 200, DOWNLOAD_TIMEOUT_MS = 2 * 60 * 60_000
export const DOWNLOAD_MAX_BYTES = 2 * 1024 ** 3, DOWNLOAD_RETENTION_MS = 24 * 60 * 60_000
export function parseIntegrity(integrity: string) {
  const candidates = integrity.split(/\s+/).map(value => /^(sha512|sha256)-([A-Za-z0-9+/]+={0,2})$/.exec(value)).filter(value => value !== null)
  const match = candidates.find(m => m[1] === 'sha512') ?? candidates[0]
  if (!match) throw new CliOperationError('INTEGRITY_MISMATCH', '官方元数据没有受支持的 sha512 / sha256 校验值')
  const digest = Buffer.from(match[2]!, 'base64')
  if (digest.length !== (match[1] === 'sha512' ? 64 : 32) || digest.toString('base64') !== match[2]) throw new CliOperationError('INTEGRITY_MISMATCH', '官方校验值格式无效')
  return { algorithm: match[1]!, digest }
}
export async function prepareDownloads(root: string, now = Date.now()): Promise<string> {
  const parent = join(root, 'cli-management'), directory = join(parent, 'downloads')
  for (const path of [parent, directory]) {
    await mkdir(path, { recursive: true, mode: 0o700 })
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('下载缓存目录无效')
    await chmod(path, 0o700)
  }
  const files: { path: string; size: number; mtimeMs: number }[] = []
  for (const name of await readdir(directory)) {
    if (!/^[a-f0-9-]{36}\.(?:part|tgz|sh|ps1|dmg|exe)$/.test(name)) continue
    const path = join(directory, name), info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) continue
    if (now - info.mtimeMs > DOWNLOAD_RETENTION_MS) await unlink(path)
    else files.push({ path, size: info.size, mtimeMs: info.mtimeMs })
  }
  let total = files.reduce((sum, file) => sum + file.size, 0)
  for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= DOWNLOAD_MAX_BYTES) break
    await unlink(file.path); total -= file.size
  }
  return directory
}
/** Host-owned downloads, including npm's main tarball; external dependencies expose no invented progress. */
export async function downloadCliArtifact(options: {
  root: string; url: string; integrity?: string; expectedBytes?: number; officialScript?: boolean; signal: AbortSignal
  progress(value: CliDownloadProgress): void
  fetcher?: typeof hostFetch
}): Promise<string> {
  if (customRegistryProblem(options.url)) throw new CliOperationError('NETWORK', '下载地址必须为不含凭据的 HTTPS 地址')
  const integrity = options.integrity ? parseIntegrity(options.integrity) : undefined
  if (!integrity && !options.officialScript && !(Number.isSafeInteger(options.expectedBytes) && options.expectedBytes! > 0)) throw new CliOperationError('INTEGRITY_MISMATCH', '缺少官方摘要或长度')
  const directory = await prepareDownloads(options.root)
  options.signal.throwIfAborted()
  const file = join(directory, `${randomUUID()}.part`), handle = await open(file, 'wx', 0o600)
  let bytes = 0, total: number | undefined, resumes = 0, lastByte = Date.now(), lastReported = lastByte, lastBytes = 0
  const deadline = new AbortController(), deadlineTimer = setTimeout(() => deadline.abort(), DOWNLOAD_TIMEOUT_MS)
  const global = AbortSignal.any([options.signal, deadline.signal])
  const report = () => {
    const now = Date.now(), seconds = (now - lastReported) / 1000
    options.progress({ readable: true, downloadedBytes: bytes, totalBytes: total, bytesPerSecond: seconds > 0 ? Math.max(0, bytes - lastBytes) / seconds : 0, resumeCount: resumes, stalledSeconds: Math.floor((now - lastByte) / 1000) })
    lastReported = now; lastBytes = bytes
  }
  const reporting = setInterval(report, 1000)
  let remove = false
  try {
    for (;;) {
      global.throwIfAborted()
      const stall = new AbortController(), control = AbortSignal.any([global, stall.signal])
      let timer = setTimeout(() => stall.abort(), DOWNLOAD_STALL_MS)
      const heartbeat = () => { clearTimeout(timer); timer = setTimeout(() => stall.abort(), DOWNLOAD_STALL_MS); lastByte = Date.now() }
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      try {
        const response = await bounded((options.fetcher ?? hostFetch)(options.url, { signal: control, credentials: 'omit', redirect: 'error', headers: { 'Accept-Encoding': 'identity', ...(bytes ? { Range: `bytes=${bytes}-` } : {}) } }), control)
        reader = response.body?.getReader()
        if (response.status === 416) {
          const match = /^bytes \*\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
          if (!match || Number(match[1]) !== bytes) throw new CliOperationError('NETWORK', '续传长度与服务器不一致')
          total = bytes; break
        }
        if (response.status !== 200 && response.status !== 206) throw new CliOperationError('NETWORK', `下载失败（HTTP ${response.status}）`)
        if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') throw new CliOperationError('NETWORK', '服务器返回了不可续传的压缩响应')
        if (response.status === 200) {
          await handle.truncate(0); bytes = 0; lastBytes = 0
          const length = response.headers.get('content-length')
          total = length && /^\d+$/.test(length) ? Number(length) : undefined
        } else {
          const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
          if (!match || Number(match[1]) !== bytes || Number(match[2]) < bytes || Number(match[3]) <= Number(match[2])) throw new CliOperationError('NETWORK', 'Content-Range 无效，不能安全续传')
          total = Number(match[3])
        }
        if (total !== undefined && (!Number.isSafeInteger(total) || total > DOWNLOAD_MAX_BYTES)) throw new CliOperationError('NETWORK', '下载文件超过私有缓存 2 GB 上限')
        if (!reader) throw new CliOperationError('NETWORK', '下载响应没有文件内容')
        for (;;) {
          const chunk = await bounded(reader.read(), control)
          if (chunk.done) break
          if (!chunk.value.byteLength) continue
          if (bytes + chunk.value.byteLength > DOWNLOAD_MAX_BYTES || total !== undefined && bytes + chunk.value.byteLength > total) throw new CliOperationError('NETWORK', '下载长度超出声明或缓存上限')
          let written = 0
          while (written < chunk.value.length) { const result = await handle.write(chunk.value, written, chunk.value.length - written, bytes + written); if (!result.bytesWritten) throw new Error('Download write made no progress'); written += result.bytesWritten }
          bytes += written; heartbeat(); report()
        }
        if (total === undefined || bytes === total) break
        // An incomplete response resumes just like a stalled connection.
      } catch (error) {
        global.throwIfAborted()
        if (!stall.signal.aborted) throw error
      } finally { clearTimeout(timer); void reader?.cancel().catch(() => undefined) }
      if (resumes >= DOWNLOAD_RESUMES) throw new CliOperationError('STALL_LIMIT', '下载停滞，自动续传 200 次仍未完成，请检查网络后重试')
      resumes++; report()
    }
    await handle.sync(); global.throwIfAborted()
    if (options.expectedBytes !== undefined && bytes !== options.expectedBytes) { remove = true; throw new CliOperationError('INTEGRITY_MISMATCH', '下载文件与官方长度不符') }
    if (integrity) {
      const hash = createHash(integrity.algorithm)
      for await (const chunk of createReadStream(file)) { global.throwIfAborted(); hash.update(chunk) }
      if (!timingSafeEqual(hash.digest(), integrity.digest)) { remove = true; throw new CliOperationError('INTEGRITY_MISMATCH', '下载文件与官方校验值不符，已删除临时文件') }
    }
    report(); return file
  } catch (error) {
    if (options.signal.aborted) { remove = true; throw options.signal.reason }
    if (deadline.signal.aborted) throw new CliOperationError('DOWNLOAD_TIMEOUT', '下载总时长超过 2 小时')
    throw error
  } finally {
    clearInterval(reporting); clearTimeout(deadlineTimer); await handle.close()
    if (remove) await unlink(file).catch(() => undefined)
    await prepareDownloads(options.root)
  }
}
