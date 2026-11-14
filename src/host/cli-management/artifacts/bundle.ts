import { trackUpdateTemporary, removeUpdateTemporary } from '../update-cleanup.ts'
import { placePi } from './pi.ts'
import { placeNative, placeRelease } from './transaction.ts'
import { chmod, lstat, mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { downloadCliArtifact, DOWNLOAD_MAX_BYTES, DOWNLOAD_TIMEOUT_MS, prepareDownloads } from '../download.ts'
import { executeCliOperation } from '../executor.ts'
import { CliOperationError } from '../planner.ts'
import { ProcessCleanupUnconfirmedError } from '../../process.ts'
import type { LocalArtifactInstall, LocalArtifactOptions } from '../local-artifacts.ts'
import type { ArtifactDescription } from './types.ts'
import { downloadDescription, privatePath } from './download.ts'
import { extractMember, placeArtifact } from './placement.ts'

/** Resolve -> stage -> placement; all seven callers share this lifecycle and byte budget. */
export async function prepareArtifactBundle(options: LocalArtifactOptions, describe: (directory: string, signal: AbortSignal) => Promise<ArtifactDescription>): Promise<LocalArtifactInstall> {
  const directory = trackUpdateTemporary(await mkdtemp(join(await prepareDownloads(options.root), 'local-')))
  await chmod(directory, 0o700)
  const cleanup = () => removeUpdateTemporary(directory)
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), DOWNLOAD_TIMEOUT_MS)
  const signal = AbortSignal.any([options.signal, deadline.signal])
  try {
    const description = await describe(directory, signal)
    await description.before?.(signal)
    const names = [...description.files, ...description.extras].map(f => privatePath(directory, f.dest).toLowerCase())
    if (new Set(names).size !== names.length) throw new CliOperationError('INTEGRITY_MISMATCH', '离线包路径重复')
    let reserved = description.extras.reduce((sum, e) => sum + ('content' in e ? Buffer.byteLength(e.content) : 0), 0)
    // Reject manifest overflow before downloading even an installer script.
    if (reserved + description.files.reduce((sum, f) => sum + (typeof f.bytes === 'number' ? f.bytes : 0), 0) > DOWNLOAD_MAX_BYTES) throw new CliOperationError('INTEGRITY_MISMATCH', '官方离线工件合计超过 2 GB 私有缓存上限')
    for (const extra of description.extras) {
      const dest = privatePath(directory, extra.dest)
      await mkdir(dirname(dest), { recursive: true, mode: 0o700 })
      if ('content' in extra) await writeFile(dest, extra.content, { flag: 'wx', mode: 0o600 })
      else {
        // Scripts have no publisher digest in the existing contract; never mix their bytes with payload totals.
        const file = await downloadCliArtifact({ root: options.root, url: extra.script, officialScript: true, maxBytes: DOWNLOAD_MAX_BYTES - reserved, signal, fetcher: options.fetcher, output: options.output,
          progress: () => options.progress({ channel: 'takeover', readable: false, byteProgress: false, resumeCount: 0, stage: '准备官方本地安装入口' }) })
        try { reserved += (await lstat(file)).size; await rename(file, dest) } finally { await removeUpdateTemporary(file) }
      }
    }
    await downloadDescription(description, { ...options, directory, signal }, reserved)
    const p = description.placement
    if (p.kind === 'official-local' && p.extract) await extractMember(directory, p.extract.archive, p.extract.format, p.extract.member, signal,
      (argv, control) => executeCliOperation(options.backend, options.config, argv, control, options.output))
    return { targetVersion: description.manifest.version, argv: p.kind === 'official-local' ? p.argv : [], env: p.kind === 'official-local' || p.kind === 'release-package' ? p.env : undefined, cleanup,
      install: (control, run) => p.kind === 'registry' ? placePi(description, directory, control, options) : p.kind === 'native-binary' ? placeNative(description, directory, control, options, run) : p.kind === 'release-package' ? placeRelease(description, directory, control, options, run) : placeArtifact(description, directory, control, run) }
  } catch (error) {
    if (!(error instanceof ProcessCleanupUnconfirmedError)) await cleanup()
    if (deadline.signal.aborted && !options.signal.aborted && !(error instanceof ProcessCleanupUnconfirmedError)) throw new CliOperationError('DOWNLOAD_TIMEOUT', '官方工件下载总时长超过 2 小时')
    throw error
  } finally { clearTimeout(timer) }
}
