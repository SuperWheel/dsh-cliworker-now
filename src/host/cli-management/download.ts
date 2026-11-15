import { Crc64Xz, type WorkBuddyCosIntegrity } from './workbuddy-windows.ts'
import { trackUpdateTemporary, removeUpdateTemporary } from './update-cleanup.ts'
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
import { ArtifactSources, PresignedExpiredError, SourceIdentityError, responseMd5 } from './download-sources.ts'
import { recoverableDownloadError, RECOVERY_LIMIT, RECOVERY_TIMEOUT_MS } from './recovery.ts'

export const DOWNLOAD_STALL_MS = 10_000, DOWNLOAD_RESUMES = RECOVERY_LIMIT, DOWNLOAD_TIMEOUT_MS = RECOVERY_TIMEOUT_MS
/** Decimal KB/s: 1,000,000 new bytes per 10-second window. */
export const DOWNLOAD_SLOW_BYTES_PER_SECOND = 100_000
export const DOWNLOAD_MAX_BYTES = 2 * 1024 ** 3, DOWNLOAD_RETENTION_MS = 24 * 60 * 60_000
export function parseIntegrity(integrity: string) {
  const candidates = integrity.split(/\s+/).map(value => /^(sha512|sha256|sha1|md5)-([A-Za-z0-9+/]+={0,2})$/.exec(value)).filter(value => value !== null)
  const match = candidates.find(m => m[1] === 'sha512') ?? candidates.find(m => m[1] === 'sha256') ?? candidates[0]
  if (!match) throw new CliOperationError('INTEGRITY_MISMATCH', '官方元数据没有受支持的 sha512 / sha256 / sha1 / md5 校验值')
  const digest = Buffer.from(match[2]!, 'base64')
  if (digest.length !== (match[1] === 'sha512' ? 64 : match[1] === 'sha256' ? 32 : match[1] === 'sha1' ? 20 : 16) || digest.toString('base64') !== match[2]) throw new CliOperationError('INTEGRITY_MISMATCH', '官方校验值格式无效')
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
    if (!/^[a-f0-9-]{36}\.(?:part(?:\.decoded)?|tgz|sh|ps1|dmg|zip|exe)$/.test(name)) continue
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
/** Host-owned authenticated files; callers aggregate multi-file download progress. */
export async function downloadCliArtifact(options: {
  cos?: WorkBuddyCosIntegrity
  root: string; url: string; sources?: string[]; sourceRedirects?: Record<string, string>; lengthProbe?: 'HEAD' | 'RANGE'; requireContentMd5?: boolean; integrity?: string; expectedBytes?: number; officialScript?: boolean; signal: AbortSignal
  progress(value: CliDownloadProgress): void
  output?(value: string): void
  /** Only for signed official artifact hosts checked by local-artifacts. */
  officialSignedArtifact?: boolean
  /** Remaining allowance when assembling a multi-file private bundle. */
  maxBytes?: number
  fetcher?: typeof hostFetch
  redirectHosts?: readonly string[]
  refreshSources?: (signal: AbortSignal) => Promise<string[]>
  /** npm's official watchdog changes channel inside this file's resume loop. */
  officialFirst?: { signal: AbortSignal; takeover(): void }
  /** Pinned npm integrity allows a clean restart when transport validators change. */
  restartOnValidatorChange?: boolean
}): Promise<string> {
  const address = new URL(options.url)
  const maxBytes = options.maxBytes ?? DOWNLOAD_MAX_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > DOWNLOAD_MAX_BYTES || options.expectedBytes !== undefined && options.expectedBytes > maxBytes) throw new CliOperationError('INTEGRITY_MISMATCH', '下载文件超过私有缓存剩余空间上限')
  const githubAsset = options.officialSignedArtifact && address.protocol === 'https:' && (OFFICIAL_SIGNED_ARTIFACT_HOSTS as readonly string[]).includes(address.hostname) && !address.username && !address.password && !address.hash && !address.port
  if (!githubAsset && customRegistryProblem(options.url)) throw new CliOperationError('NETWORK', '下载地址必须为不含凭据的 HTTPS 地址')
  const integrity = options.integrity ? parseIntegrity(options.integrity) : undefined
  if (!integrity && !options.officialScript && !options.sources?.length && !(Number.isSafeInteger(options.expectedBytes) && options.expectedBytes! > 0)) throw new CliOperationError('INTEGRITY_MISMATCH', '缺少官方摘要或长度')
  const directory = await prepareDownloads(options.root)
  options.signal.throwIfAborted()
  const file = trackUpdateTemporary(join(directory, `${randomUUID()}.part`))
  let handle = await open(file, 'wx', 0o600)
  let bytes = 0, total: number | undefined, resumes = 0, lastByte = Date.now(), lastReported = lastByte, lastBytes = 0, rangeRejected = false
  const deadline = new AbortController(), deadlineTimer = setTimeout(() => deadline.abort(), DOWNLOAD_TIMEOUT_MS)
  const global = AbortSignal.any([options.signal, deadline.signal])
  let sourceHost = address.host, currentUrl = options.url, headerMd5: string | undefined, singleEtag: string | undefined, refreshes = 0
  const report = () => {
    const now = Date.now(), seconds = (now - lastReported) / 1000
    options.progress({ channel: 'takeover', byteProgress: true, byteProgressState: total === undefined ? 'unknown-total' : 'known-total', readable: true, sourceHost, downloadedBytes: bytes, totalBytes: total, bytesPerSecond: seconds > 0 ? Math.max(0, bytes - lastBytes) / seconds : 0, resumeCount: resumes, stalledSeconds: Math.floor((now - lastByte) / 1000) })
    lastReported = now; lastBytes = bytes
  }
  const reporting = setInterval(report, 1000)
  let remove = false
  try {
    let sources = options.sources && !options.officialFirst ? new ArtifactSources(options.sources, options.fetcher ?? hostFetch, global, maxBytes, options.requireContentMd5, options.sourceRedirects, options.lengthProbe, options.redirectHosts) : undefined
    let official = !!options.officialFirst
    const reset = async () => { await handle.truncate(0); bytes = 0; total = undefined; lastBytes = 0; headerMd5 = undefined; singleEtag = undefined; rangeRejected = false }
    const refresh = async () => {
      if (!options.refreshSources || ++refreshes > 3) throw new CliOperationError('NETWORK', '预签名地址失效，重新取清单后仍不可用')
      const urls = await options.refreshSources(global)
      if (!urls.length || urls.some(url => { const u = new URL(url); return u.protocol !== 'https:' || u.username || u.password || u.hash || u.port || !(OFFICIAL_SIGNED_ARTIFACT_HOSTS as readonly string[]).includes(u.hostname) })) throw new CliOperationError('NETWORK', '清单刷新地址不在官方签名工件白名单')
      currentUrl = urls[0]!; sources?.replaceUrls(urls); sourceHost = new URL(currentUrl).host
    }
    const select = async (rotate = false) => {
      for (;;) {
        try {
          const changed = await sources?.select(rotate, options.restartOnValidatorChange)
          if (changed) await reset()
          return
        } catch (error) {
          if (!(error instanceof PresignedExpiredError) || !options.refreshSources) throw error
          await refresh()
        }
      }
    }
    if (sources) {
      await select()
      sourceHost = new URL(sources.url).host
      if (options.expectedBytes !== undefined && sources.length !== options.expectedBytes) throw new CliOperationError('NETWORK', '下载源长度与官方元数据不一致')
    }
    // A single clean integrity retry shares the deadline and resume count.
    for (let validationAttempt = 0; ; validationAttempt++) {
      for (;;) {
        global.throwIfAborted()
        const stall = new AbortController(), control = AbortSignal.any([global, stall.signal, ...(official ? [options.officialFirst!.signal] : [])])
        let timer = setTimeout(() => stall.abort(), DOWNLOAD_STALL_MS)
        let speedTimer: ReturnType<typeof setInterval> | undefined, slowSpeed: number | undefined
        const heartbeat = () => { clearTimeout(timer); timer = setTimeout(() => stall.abort(), DOWNLOAD_STALL_MS); lastByte = Date.now() }
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, responseEnd: number | undefined
        try {
          let requestUrl = sources?.url ?? currentUrl
          const request = (url: string) => bounded((options.fetcher ?? hostFetch)(url, { signal: control, credentials: 'omit', redirect: options.redirectHosts?.length ? 'manual' : 'error', headers: { 'Accept-Encoding': 'identity', ...(bytes ? { Range: `bytes=${bytes}-`, ...((sources?.etag ?? singleEtag) ? { 'If-Range': sources?.etag ?? singleEtag! } : {}) } : {}) } }), control)
          let response = await request(requestUrl)
          for (let redirects = 0; [301, 302, 303, 307, 308].includes(response.status); redirects++) {
            if (!response.headers.get('location')) throw new CliOperationError('NETWORK', '官方工件跳转缺少地址')
            const next = new URL(response.headers.get('location')!, requestUrl)
            if (redirects >= 3 || next.protocol !== 'https:' || next.username || next.password || next.port || next.hash || !options.redirectHosts?.includes(next.hostname)) throw new CliOperationError('NETWORK', '官方工件跳转不在描述白名单')
            await response.body?.cancel(); requestUrl = next.href; response = await request(requestUrl)
          }
          sourceHost = new URL(requestUrl).host
          if (!sources) currentUrl = requestUrl
          reader = response.body?.getReader()
          if (response.status === 403 && options.refreshSources) { await refresh(); throw new PresignedExpiredError() }
          sources?.validate(response)
          if (response.status === 200 || response.status === 206) {
            const md5 = responseMd5(response.headers), etag = response.headers.get('etag')?.trim()
            if (headerMd5 && (md5 !== undefined || !sources) && md5 !== headerMd5 || !sources && singleEtag && etag !== singleEtag) {
              if (!options.restartOnValidatorChange) throw new CliOperationError('INTEGRITY_MISMATCH', '续传响应摘要或 ETag 已变化')
              await reset()
              // A 206 belongs to the old offset and cannot be appended after reset.
              if (response.status === 206) throw new SourceIdentityError('续传响应摘要或 ETag 已变化')
            }
            headerMd5 ??= md5; singleEtag ??= etag
            if (options.requireContentMd5 && !md5) throw new CliOperationError('INTEGRITY_MISMATCH', '官方响应缺少 MD5')
          }
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
          if (total !== undefined && (!Number.isSafeInteger(total) || total > maxBytes)) throw new CliOperationError('NETWORK', '下载文件超过私有缓存 2 GB 上限或剩余空间上限')
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
            if (bytes + chunk.value.byteLength > maxBytes || total !== undefined && bytes + chunk.value.byteLength > total || responseEnd !== undefined && bytes + chunk.value.byteLength > responseEnd) throw new CliOperationError('NETWORK', '下载长度超出声明或缓存上限')
            let written = 0
            while (written < chunk.value.length) { const result = await handle.write(chunk.value, written, chunk.value.length - written, bytes + written); if (!result.bytesWritten) throw new Error('Download write made no progress'); written += result.bytesWritten }
            bytes += written; heartbeat(); report()
          }
          if (total === undefined || bytes === total) break
          // An incomplete response resumes just like a stalled connection.
        } catch (error) {
          global.throwIfAborted()
          // Undeclared redirects are never followed; report the cause explicitly.
          if (error instanceof TypeError && /unexpected redirect/.test(error.message)) throw new CliOperationError('NETWORK', `官方下载地址 ${new URL(sources?.url ?? currentUrl).host} 已跳转到其他位置，插件不跟随跳转；请等待插件更新下载地址`)
          if (error instanceof SourceIdentityError && options.restartOnValidatorChange) await reset()
          else if (!(error instanceof PresignedExpiredError) && !stall.signal.aborted && !(official && (options.officialFirst!.signal.aborted || error instanceof CliOperationError && error.code === 'NETWORK' && error.message.includes('下载失败（HTTP '))) && !recoverableDownloadError(error)) throw error
        } finally { clearTimeout(timer); clearInterval(speedTimer); void reader?.cancel().catch(() => undefined) }
        if (resumes >= DOWNLOAD_RESUMES) throw new CliOperationError('STALL_LIMIT', '下载停滞或中断，自动续传 200 次仍未完成，请检查网络后重试')
        resumes++
        if (official && (options.officialFirst!.signal.aborted || !stall.signal.aborted && slowSpeed === undefined)) {
          official = false; options.officialFirst!.takeover()
          sources = new ArtifactSources(options.sources ?? [options.url], options.fetcher ?? hostFetch, global, maxBytes, options.requireContentMd5, options.sourceRedirects, options.lengthProbe, options.redirectHosts)
          // Missing validators cannot justify appending a different source. The
          // next request will start clean; with validators it retains exact offset.
          if (bytes && (total === undefined || !(singleEtag && !singleEtag.startsWith('W/')) && !headerMd5)) await reset()
          sources.seed(total, singleEtag, headerMd5)
        }
        if (sources) {
          const previous = sources.url
          await select(true)
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
      if (sources?.md5 ?? headerMd5) {
        const hash = createHash('md5')
        for await (const chunk of createReadStream(file)) { global.throwIfAborted(); hash.update(chunk) }
        mismatch ||= hash.digest('hex') !== (sources?.md5 ?? headerMd5)
      }
      if (options.cos) {
        const md5 = createHash('md5'), crc = new Crc64Xz()
        for await (const chunk of createReadStream(file)) { global.throwIfAborted(); md5.update(chunk); crc.update(chunk as Buffer) }
        mismatch ||= bytes !== options.cos.size || md5.digest('hex') !== options.cos.md5 || crc.digest() !== options.cos.crc64
      }
      if (!mismatch) { report(); return file }
      remove = true
      await handle.close(); await unlink(file)
      if (validationAttempt === 1) throw new CliOperationError('INTEGRITY_MISMATCH', '下载的文件校验不通过')
      global.throwIfAborted()
      handle = await open(file, 'wx', 0o600); remove = false
      if (sources) { await select(); sourceHost = new URL(sources.url).host }
      options.output?.('下载的文件校验不通过，已删除临时文件，干净重新下载一次。\n')
      bytes = 0; total = undefined; lastBytes = 0; lastByte = lastReported = Date.now(); rangeRejected = false
      report()
    }
  } catch (error) {
    if (options.cos) remove = true
    if (options.signal.aborted) { remove = true; throw options.signal.reason }
    if (deadline.signal.aborted) throw new CliOperationError('DOWNLOAD_TIMEOUT', '下载总时长超过 2 小时')
    throw error
  } finally {
    clearInterval(reporting); clearTimeout(deadlineTimer); await handle.close()
    if (remove) await removeUpdateTemporary(file)
  }
}
