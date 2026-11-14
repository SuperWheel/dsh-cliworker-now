import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, lstat, mkdir, open, readdir, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { CliDownloadProgress } from '../../shared/cli-management.ts'
import { customRegistryProblem } from '../../shared/cli-management.ts'
import { hostFetch } from '../host-fetch.mjs'
import { bounded } from './versions.ts'
import { CliOperationError } from './planner.ts'
import { OFFICIAL_SIGNED_ARTIFACT_HOSTS } from './sources.ts'
import { ArtifactSources } from './download-sources.ts'
import { recoverableDownloadError, RECOVERY_LIMIT, RECOVERY_TIMEOUT_MS } from './recovery.ts'

export const DOWNLOAD_STALL_MS = 10_000, DOWNLOAD_RESUMES = RECOVERY_LIMIT, DOWNLOAD_TIMEOUT_MS = RECOVERY_TIMEOUT_MS
/** Decimal KB/s: 1,000,000 new bytes per 10-second window. */
export const DOWNLOAD_SLOW_BYTES_PER_SECOND = 100_000
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
    if (/^local-[A-Za-z0-9]{6}$/.test(name)) {
      const path = join(directory, name), info = await lstat(path)
      if (info.isDirectory() && !info.isSymbolicLink() && now - info.mtimeMs > DOWNLOAD_RETENTION_MS) await rm(path, { recursive: true, force: true })
      continue
    }
    if (!/^[a-f0-9-]{36}\.(?:part|tgz|sh|ps1|dmg|zip|exe)$/.test(name)) continue
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
  root: string; url: string; sources?: string[]; sourceRedirects?: Record<string, string>; requireContentMd5?: boolean; integrity?: string; expectedBytes?: number; officialScript?: boolean; signal: AbortSignal
  progress(value: CliDownloadProgress): void
  output?(value: string): void
  /** Only for signed official artifact hosts checked by local-artifacts. */
  officialSignedArtifact?: boolean
  fetcher?: typeof hostFetch
}): Promise<string> {
  const address = new URL(options.url)
  const githubAsset = options.officialSignedArtifact && address.protocol === 'https:' && (OFFICIAL_SIGNED_ARTIFACT_HOSTS as readonly string[]).includes(address.hostname) && !address.username && !address.password && !address.hash && !address.port
  if (!githubAsset && customRegistryProblem(options.url)) throw new CliOperationError('NETWORK', '下载地址必须为不含凭据的 HTTPS 地址')
  const integrity = options.integrity ? parseIntegrity(options.integrity) : undefined
  if (!integrity && !options.officialScript && !options.sources?.length && !(Number.isSafeInteger(options.expectedBytes) && options.expectedBytes! > 0)) throw new CliOperationError('INTEGRITY_MISMATCH', '缺少官方摘要或长度')
  const directory = await prepareDownloads(options.root)
  options.signal.throwIfAborted()
  const file = join(directory, `${randomUUID()}.part`)
  let handle = await open(file, 'wx', 0o600)
  let bytes = 0, total: number | undefined, resumes = 0, lastByte = Date.now(), lastReported = lastByte, lastBytes = 0, rangeRejected = false
  const deadline = new AbortController(), deadlineTimer = setTimeout(() => deadline.abort(), DOWNLOAD_TIMEOUT_MS)
  const global = AbortSignal.any([options.signal, deadline.signal])
  let sourceHost = address.host
  const report = () => {
    const now = Date.now(), seconds = (now - lastReported) / 1000
    options.progress({ readable: true, sourceHost, downloadedBytes: bytes, totalBytes: total, bytesPerSecond: seconds > 0 ? Math.max(0, bytes - lastBytes) / seconds : 0, resumeCount: resumes, stalledSeconds: Math.floor((now - lastByte) / 1000) })
    lastReported = now; lastBytes = bytes
  }
  const reporting = setInterval(report, 1000)
  let remove = false
  try {
    const sources = options.sources ? new ArtifactSources(options.sources, options.fetcher ?? hostFetch, global, DOWNLOAD_MAX_BYTES, options.requireContentMd5, options.sourceRedirects) : undefined
    if (sources) {
      await sources.select()
      sourceHost = new URL(sources.url).host
      if (options.expectedBytes !== undefined && sources.length !== options.expectedBytes) throw new CliOperationError('NETWORK', '下载源长度与官方元数据不一致')
    }
    // A single clean integrity retry shares the deadline and resume count.
    for (let validationAttempt = 0; ; validationAttempt++) {
      for (;;) {
        global.throwIfAborted()
        const stall = new AbortController(), control = AbortSignal.any([global, stall.signal])
        let timer = setTimeout(() => stall.abort(), DOWNLOAD_STALL_MS)
        let speedTimer: ReturnType<typeof setInterval> | undefined, slowSpeed: number | undefined
        const heartbeat = () => { clearTimeout(timer); timer = setTimeout(() => stall.abort(), DOWNLOAD_STALL_MS); lastByte = Date.now() }
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, responseEnd: number | undefined
        try {
          const response = await bounded((options.fetcher ?? hostFetch)(sources?.url ?? options.url, { signal: control, credentials: 'omit', redirect: 'error', headers: { 'Accept-Encoding': 'identity', ...(bytes ? { Range: `bytes=${bytes}-`, ...(sources?.etag ? { 'If-Range': sources.etag } : {}) } : {}) } }), control)
          reader = response.body?.getReader()
          sources?.validate(response)
          if (response.status === 416) {
            const match = /^bytes \*\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
            if (!match || Number(match[1]) !== bytes) throw new CliOperationError('NETWORK', '续传长度与服务器不一致')
            total = bytes; break
          }
          if (response.status !== 200 && response.status !== 206) throw new CliOperationError('NETWORK', `下载失败（HTTP ${response.status}）`)
          if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') throw new CliOperationError('NETWORK', '服务器返回了不可续传的压缩响应')
          if (response.status === 200) {
            if (bytes > 0) rangeRejected = true
            await handle.truncate(0); bytes = 0; lastBytes = 0
            const length = response.headers.get('content-length')
            total = length && /^\d+$/.test(length) ? Number(length) : sources?.length
          } else {
            const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
            if (!match || Number(match[1]) !== bytes || Number(match[2]) < bytes || Number(match[3]) <= Number(match[2])) throw new CliOperationError('NETWORK', 'Content-Range 无效，不能安全续传')
            if (total !== undefined && total !== Number(match[3])) throw new CliOperationError('NETWORK', '续传文件总长度已变化')
            total = Number(match[3])
            responseEnd = Number(match[2]) + 1
            const length = response.headers.get('content-length')
            if (length !== null && (!/^\d+$/.test(length) || Number(length) !== responseEnd - bytes)) throw new CliOperationError('NETWORK', 'Content-Range 与响应长度不符')
          }
          if (total !== undefined && (!Number.isSafeInteger(total) || total > DOWNLOAD_MAX_BYTES)) throw new CliOperationError('NETWORK', '下载文件超过私有缓存 2 GB 上限')
          if (!reader) throw new CliOperationError('NETWORK', '下载响应没有文件内容')
          // Never deliberately interrupt a slow connection that would restart at
          // zero. A 206 or explicit Accept-Ranges proves the server's capability;
          // a subsequent ignored Range disables slow reconnections for this file.
          if (!rangeRejected && (sources?.supportsRange || response.status === 206 || response.headers.get('accept-ranges')?.toLowerCase() === 'bytes')) {
            let windowBytes = bytes, windowStarted = Date.now()
            speedTimer = setInterval(() => {
              const now = Date.now(), added = bytes - windowBytes, elapsed = (now - windowStarted) / 1000
              if (added > 0 && elapsed > 0 && added / elapsed < DOWNLOAD_SLOW_BYTES_PER_SECOND && resumes < DOWNLOAD_RESUMES) {
                slowSpeed = added / elapsed / 1000; stall.abort()
              }
              windowBytes = bytes; windowStarted = now
            }, DOWNLOAD_STALL_MS)
          }
          for (;;) {
            const chunk = await bounded(reader.read(), control)
            if (chunk.done) break
            if (!chunk.value.byteLength) continue
            if (bytes + chunk.value.byteLength > DOWNLOAD_MAX_BYTES || total !== undefined && bytes + chunk.value.byteLength > total || responseEnd !== undefined && bytes + chunk.value.byteLength > responseEnd) throw new CliOperationError('NETWORK', '下载长度超出声明或缓存上限')
            let written = 0
            while (written < chunk.value.length) { const result = await handle.write(chunk.value, written, chunk.value.length - written, bytes + written); if (!result.bytesWritten) throw new Error('Download write made no progress'); written += result.bytesWritten }
            bytes += written; heartbeat(); report()
          }
          if (total === undefined || bytes === total) break
          // An incomplete response resumes just like a stalled connection.
        } catch (error) {
          global.throwIfAborted()
          // Redirects are never followed; name the cause instead of the generic failure text.
          if (error instanceof TypeError && /unexpected redirect/.test(error.message)) throw new CliOperationError('NETWORK', `官方下载地址 ${new URL(sources?.url ?? options.url).host} 已跳转到其他位置，插件不跟随跳转；请等待插件更新下载地址`)
          if (!stall.signal.aborted && !recoverableDownloadError(error)) throw error
        } finally { clearTimeout(timer); clearInterval(speedTimer); void reader?.cancel().catch(() => undefined) }
        if (resumes >= DOWNLOAD_RESUMES) throw new CliOperationError('STALL_LIMIT', '下载停滞或中断，自动续传 200 次仍未完成，请检查网络后重试')
        resumes++
        if (sources) {
          const previous = sources.url
          await sources.select(true)
          sourceHost = new URL(sources.url).host
          if (sources.url !== previous) options.output?.(`切换到 ${new URL(sources.url).host} 继续下载（第 ${resumes} 次）\n`)
        }
        options.output?.(slowSpeed !== undefined ? `下载过慢（${slowSpeed.toFixed(1)} KB/s），从 ${bytes} B 处重新连接（第 ${resumes} 次）\n` : `${stall.signal.aborted ? '下载停滞 10 秒' : '下载中断'}，从 ${bytes} B 处续传（第 ${resumes} 次）\n`)
        report()
      }
      await handle.sync(); global.throwIfAborted()
      const expectedBytes = options.expectedBytes ?? sources?.length
      let mismatch = expectedBytes !== undefined && bytes !== expectedBytes
      if (integrity) {
        const hash = createHash(integrity.algorithm)
        for await (const chunk of createReadStream(file)) { global.throwIfAborted(); hash.update(chunk) }
        mismatch ||= !timingSafeEqual(hash.digest(), integrity.digest)
      }
      if (sources?.md5) {
        const hash = createHash('md5')
        for await (const chunk of createReadStream(file)) { global.throwIfAborted(); hash.update(chunk) }
        mismatch ||= hash.digest('hex') !== sources.md5
      }
      if (!mismatch) { report(); return file }
      remove = true
      await handle.close(); await unlink(file)
      if (validationAttempt === 1) throw new CliOperationError('INTEGRITY_MISMATCH', '下载的文件校验不通过')
      global.throwIfAborted()
      if (sources) { await sources.select(); sourceHost = new URL(sources.url).host }
      options.output?.('下载的文件校验不通过，已删除临时文件，干净重新下载一次。\n')
      handle = await open(file, 'wx', 0o600); remove = false
      bytes = 0; total = undefined; lastBytes = 0; lastByte = lastReported = Date.now(); rangeRejected = false
      report()
    }
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
