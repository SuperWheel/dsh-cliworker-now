import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, rename, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as zlib from 'node:zlib'
import { downloadCliArtifact, DOWNLOAD_MAX_BYTES, parseIntegrity } from '../download.ts'
import { CliOperationError } from '../planner.ts'
import type { ArtifactDescription, ArtifactDownloadContext, ArtifactFile } from './types.ts'

export function privatePath(directory: string, dest: string): string {
  if (!dest || isAbsolute(dest) || /[\\:\x00]/.test(dest) || dest.split('/').some(p => !p || p === '.' || p === '..' || p.endsWith('.') || p.endsWith(' ') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new CliOperationError('INTEGRITY_MISMATCH', '工件落点不在私有目录内')
  const path = join(directory, dest)
  if (relative(directory, path).startsWith('..')) throw new CliOperationError('INTEGRITY_MISMATCH', '工件路径越界')
  return path
}
export const zstdAvailable = () => typeof (zlib as { createZstdDecompress?: unknown }).createZstdDecompress === 'function'
/** Stream, limit and authenticate the decoded bytes before exposing a placement input. */
export async function decodeArtifact(source: string, file: ArtifactFile, signal: AbortSignal, maxBytes: number, zstd: (() => Transform) | null | undefined = (zlib as { createZstdDecompress?: () => Transform }).createZstdDecompress): Promise<string> {
  if (!file.compression || file.compression === 'none') return source
  if (!file.decodedIntegrity) throw new CliOperationError('INTEGRITY_MISMATCH', '压缩工件缺少解压后摘要')
  if (file.compression === 'zstd' && !zstd) throw new CliOperationError('PREREQUISITE_MISSING', '宿主 Node 缺少 zlib.createZstdDecompress，不能解压此工件')
  const expected = parseIntegrity(file.decodedIntegrity), hash = createHash(expected.algorithm), target = `${source}.decoded`
  let size = 0
  try {
    const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length
      if (size > maxBytes || file.decodedBytes !== undefined && size > file.decodedBytes) return callback(new CliOperationError('INTEGRITY_MISMATCH', '解压工件超过声明或 2 GB 缓存上限'))
      hash.update(chunk); callback(null, chunk)
    } })
    await pipeline(createReadStream(source), file.compression === 'gzip' ? zlib.createGunzip() : zstd!(), limit, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal })
    if (!hash.digest().equals(expected.digest) || file.decodedBytes !== undefined && size !== file.decodedBytes) throw new CliOperationError('INTEGRITY_MISMATCH', '解压后的工件摘要或长度不符')
    await rm(source); return target
  } catch (error) { await rm(target, { force: true }); throw error }
}

/** All migrated CLIs use this single file loop. The transport retains its Range/deadline policy. */
export async function downloadDescription(description: Pick<ArtifactDescription, 'files'>, context: ArtifactDownloadContext, reservedBytes = 0): Promise<void> {
  const files = description.files, seen = new Set<string>()
  let stored = reservedBytes, completed = 0, completedBytes = 0, resumes = 0
  const lengths = files.map(f => typeof f.bytes === 'number' ? f.bytes : undefined)
  for (const file of files) {
    const path = privatePath(context.directory, file.dest), key = path.toLowerCase()
    if (seen.has(key)) throw new CliOperationError('INTEGRITY_MISMATCH', '工件落点重复')
    seen.add(key)
    if (!file.integrity && !file.archiveCrc) throw new CliOperationError('INTEGRITY_MISMATCH', '工件描述缺少摘要')
  }
  if (reservedBytes + lengths.reduce<number>((n, size) => n + (size ?? 0), 0) > DOWNLOAD_MAX_BYTES) throw new CliOperationError('INTEGRITY_MISMATCH', '官方离线工件合计超过 2 GB 私有缓存上限')
  for (const [index, file] of files.entries()) {
    context.signal.throwIfAborted()
    const destination = privatePath(context.directory, file.dest)
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    let channel: 'official' | 'takeover' = 'takeover'
    let path: string | undefined, lastBytes = 0, lastResumes = 0, lastHost = new URL(file.sources[0]!).host
    try {
      path = await (context.download ?? downloadCliArtifact)({ root: context.root, url: file.sources[0]!, sources: file.sources.length > 1 || typeof file.bytes === 'string' ? file.sources : undefined, lengthProbe: file.bytes === 'RANGE' ? 'RANGE' : 'HEAD',
        integrity: file.integrity === 'response-md5' ? undefined : file.integrity, requireContentMd5: file.integrity === 'response-md5',
        expectedBytes: typeof file.bytes === 'number' ? file.bytes : undefined, officialSignedArtifact: file.officialSignedArtifact,
        sourceRedirects: file.sourceRedirects, redirectHosts: file.redirectHosts, maxBytes: DOWNLOAD_MAX_BYTES - stored, signal: context.signal, fetcher: context.fetcher, output: context.output,
        refreshSources: file.presigned ? async signal => {
          const next = await file.presigned!.refresh(signal)
          if (next.version !== file.presigned!.version || next.bytes !== file.bytes || next.integrity !== file.integrity) throw new CliOperationError('INTEGRITY_MISMATCH', '预签名清单版本、长度或摘要已变化')
          return next.sources
        } : undefined,
        progress: p => {
          channel = p.channel ?? 'takeover'; lastHost = p.sourceHost ?? lastHost; lastBytes = p.downloadedBytes ?? 0; lastResumes = p.resumeCount
          lengths[index] ??= p.totalBytes
          context.progress({ ...p, channel, stage: `下载官方工件（${index + 1}/${files.length}）`, byteProgress: true,
            byteProgressState: lengths.every(v => v !== undefined) ? 'known-total' : 'unknown-total', currentStep: index + 1, totalSteps: files.length, stepName: file.dest, fileCount: files.length, completedFiles: completed,
            downloadedBytes: completedBytes + lastBytes, totalBytes: lengths.every(v => v !== undefined) ? lengths.reduce<number>((a, b) => a + b!, 0) : undefined, resumeCount: resumes + lastResumes })
        } })
      const encoded = (await lstat(path)).size
      const decoded = await decodeArtifact(path, file, context.signal, DOWNLOAD_MAX_BYTES - stored - (file.compression && file.compression !== 'none' ? encoded : 0))
      path = decoded
      stored += (await lstat(path)).size
      if (stored > DOWNLOAD_MAX_BYTES) throw new CliOperationError('INTEGRITY_MISMATCH', '官方离线工件合计超过 2 GB 私有缓存上限')
      await rename(path, destination); path = undefined
      completed++; completedBytes += lastBytes; resumes += lastResumes
      context.progress({ readable: true, channel, stage: completed === files.length ? '官方工件下载校验完成' : '继续下载下一工件', byteProgress: true,
        byteProgressState: lengths.every(v => v !== undefined) ? 'known-total' : 'unknown-total', currentStep: index + 1, totalSteps: files.length, stepName: file.dest, fileCount: files.length, completedFiles: completed,
        downloadedBytes: completedBytes, totalBytes: lengths.every(v => v !== undefined) ? lengths.reduce<number>((a, b) => a + b!, 0) : undefined, resumeCount: resumes, sourceHost: lastHost })
    } finally { if (path) await rm(path, { force: true }) }
  }
}
