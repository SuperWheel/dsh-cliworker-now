import { trackUpdateTemporary, removeUpdateTemporary } from './update-cleanup.ts'
import { mkdtemp, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { ActiveCliId } from '../../shared/types.ts'
import type { CliChannelReason, CliDownloadProgress } from '../../shared/cli-management.ts'
import { CLI_SOURCES } from './sources.ts'
import { downloadCliArtifact, prepareDownloads, parseIntegrity } from './download.ts'
import { downloadDescription } from './artifacts/download.ts'
import { CliOperationError } from './planner.ts'
import { ChannelMemory, channelMemoryKey } from './channel-memory.ts'
import { npmArtifact, npmManifestFromSources, npmDigest, npmPlatformComponents, npmRequiredGroups, rememberNpmPlatforms, type NpmComponent, type NpmHost } from './npm-platform.ts'
import type { ReleaseClient } from './versions.ts'
import type { InstallationIdentity } from './identity.ts'

export const npmDownloadFs = { rm: removeUpdateTemporary }

/** Use the same operation-private cache for verified tarballs and install; never the global cache. */
export const npmCacheAddArgv = (npm: readonly string[], file: string, prefix: string, registry: string, cache: string) =>
  [...npm, 'cache', 'add', file, '--global', '--prefix', prefix, '--registry', registry, '--cache', cache]

export async function prepareNpmDownload(options: {
  cli: ActiveCliId; version: string; registry: string; automaticSources: boolean; root: string
  releases: ReleaseClient; signal: AbortSignal; identity?: InstallationIdentity; host: NpmHost
  fetcher?: Parameters<typeof downloadCliArtifact>[0]['fetcher']; progress(value: CliDownloadProgress): void; output(value: string): void
}) {
  const { releases, registry, signal } = options
  const main = await npmManifestFromSources(releases, CLI_SOURCES[options.cli].npm!, options.version, registry, signal, options.automaticSources)
  if (parseIntegrity(npmDigest(main)).algorithm !== 'sha512') throw new CliOperationError('INTEGRITY_MISMATCH', 'npm 主包缺少官方 sha512 校验值')
  const host = options.host
  const unavailable = new Map<string, unknown>()
  const components = await npmPlatformComponents(main, releases, registry, signal, host, {
    automaticSources: options.automaticSources, unavailable: (alias, error) => unavailable.set(alias, error),
  })
  const required = npmRequiredGroups(main, host, components), grouped = new Set(required.flat())
  const optionalFailure = (alias: string) => options.output(`npm 可选平台组件 ${alias} 未能预下载；继续安装，npm 仍可能自行下载。\n`)
  for (const alias of unavailable.keys()) if (!grouped.has(alias)) optionalFailure(alias)
  const steps = [
    { aliases: [main.name], candidates: [{ alias: main.name, manifest: main }], required: true },
    ...required.map(aliases => ({ aliases, candidates: aliases.flatMap(alias => components.filter(c => c.alias === alias)), required: true })),
    ...components.filter(c => !grouped.has(c.alias)).map(c => ({ aliases: [c.alias], candidates: [c], required: false })),
  ]
  // Authenticate the main manifest before any body download. Component failures
  // are handled according to their group below, including metadata failures.
  const mainFile = await npmArtifact(main, releases, registry, signal, options.automaticSources, '0.tgz')
  const directory = trackUpdateTemporary(await mkdtemp(join(await prepareDownloads(options.root), 'local-')))
  await chmod(directory, 0o700)
  const memory = new ChannelMemory(options.root)
  const key = options.identity ? channelMemoryKey(options.cli, options.identity, host.platform, host.arch) : createHash('sha256').update(JSON.stringify(['npm-install', options.cli, host])).digest('hex')
  const remembered = options.automaticSources ? await memory.get(key) : undefined
  let failure: CliChannelReason | undefined, takeover = !!remembered, takeoverSucceeded = false
  const cleanup = async (successful: boolean, preserveFiles = false) => {
    try {
      if (options.automaticSources) {
        if (!successful || !takeover || !takeoverSucceeded) await memory.set(key, undefined)
        else if (failure) await memory.set(key, failure)
      }
    } finally { if (!preserveFiles) await npmDownloadFs.rm(directory) }
  }
  const download: typeof downloadCliArtifact = async input => {
    if (options.automaticSources && !takeover) {
      const controller = new AbortController()
      let lastByte = Date.now(), bytes = 0, windowBytes = 0, windowStart = Date.now()
      const started = Date.now()
      const timer = setInterval(() => {
        const now = Date.now()
        const reason = now - lastByte >= 30_000 ? 'OFFICIAL_STALLED' : now - windowStart >= 60_000 && (bytes - windowBytes) / ((now - windowStart) / 1000) < 100_000 ? 'OFFICIAL_SLOW' : now - started >= 10 * 60_000 ? 'OFFICIAL_BUDGET' : undefined
        if (reason) { failure = reason; controller.abort() }
        if (now - windowStart >= 60_000) { windowBytes = bytes; windowStart = now }
      }, 1000)
      try {
        return await downloadCliArtifact({ ...input, restartOnValidatorChange: true,
          officialFirst: { signal: controller.signal, takeover: () => {
            failure ??= 'OFFICIAL_EXIT'; takeover = true; clearInterval(timer)
            options.output('npm 官方工件下载未完成，改由插件续传与换源下载。\n')
          } },
          progress: p => {
            if ((p.downloadedBytes ?? 0) > bytes) lastByte = Date.now()
            bytes = p.downloadedBytes ?? 0
            input.progress({ ...p, channel: takeover ? 'takeover' : 'official', reason: takeover ? failure : undefined })
          } })
      } finally { clearInterval(timer) }
    }
    return downloadCliArtifact({ ...input, restartOnValidatorChange: true,
      progress: p => input.progress({ ...p, channel: 'takeover', reason: remembered ? 'OFFICIAL_RECENT_FAILURE' : failure, officialFailedAt: remembered?.failedAt }) })
  }
  const verified: NpmComponent[] = [], prepared: string[] = []
  let completedBytes = 0, resumes = 0, skipped = 0, lastPreparedAlias = main.name, lastProgress: CliDownloadProgress | undefined
  const lengths: (number | undefined)[] = steps.map(() => undefined)
  const publish = (p: CliDownloadProgress) => { lastProgress = p; options.progress(p) }
  try {
    for (const [index, step] of steps.entries()) {
      let complete = false, preparationError: unknown = unavailable.get(step.aliases[0]!)
      for (const [candidateIndex, entry] of step.candidates.entries()) {
        signal.throwIfAborted()
        const dest = `${prepared.length}.tgz`
        let lastBytes = 0, lastResumes = 0
        try {
          const file = index === 0 ? mainFile : await npmArtifact(entry.manifest, releases, registry, signal, options.automaticSources, dest)
          if (index !== 0) verified.push(entry)
          lengths[index] = undefined
          await downloadDescription({ files: [file] }, { ...options, directory, download,
            progress: p => {
              lengths[index] = p.totalBytes; lastBytes = p.downloadedBytes ?? 0; lastResumes = p.resumeCount
              const allKnown = lengths.every(v => v !== undefined), fileCount = steps.length - skipped
              publish({ ...p, stage: p.completedFiles ? prepared.length + 1 === fileCount ? '官方工件下载校验完成' : '继续下载下一工件' : `下载官方工件（${prepared.length + 1}/${fileCount}）`, stepName: entry.alias, currentStep: prepared.length + 1, totalSteps: fileCount, fileCount,
                completedFiles: prepared.length + (p.completedFiles ?? 0), downloadedBytes: completedBytes + lastBytes,
                totalBytes: allKnown ? lengths.reduce<number>((n, v) => n + v!, 0) : undefined,
                byteProgressState: allKnown ? 'known-total' : 'unknown-total', resumeCount: resumes + lastResumes,
                reason: p.channel === 'takeover' ? remembered ? 'OFFICIAL_RECENT_FAILURE' : failure : undefined,
                officialFailedAt: p.channel === 'takeover' ? remembered?.failedAt : undefined })
            } }, completedBytes)
          takeoverSucceeded ||= lastProgress?.channel === 'takeover'
          completedBytes += lastBytes; resumes += lastResumes; prepared.push(join(directory, dest)); lastPreparedAlias = entry.alias; complete = true; break
        } catch (error) {
          signal.throwIfAborted(); preparationError = error; resumes += lastResumes; lengths[index] = undefined
          if (step.required && candidateIndex + 1 < step.candidates.length) options.output(`npm 平台组件 ${entry.alias} 未能预下载；尝试同组其他组件。\n`)
        }
      }
      if (!complete) {
        if (step.required) throw preparationError ?? new CliOperationError('PREREQUISITE_MISSING', `无法准备 npm 必需平台组件 ${step.aliases.join(' / ')}`)
        optionalFailure(step.aliases[0]!); skipped++; lengths[index] = 0
      }
    }
    await rememberNpmPlatforms(options.root, main, host, verified)
    if (lastProgress) publish({ ...lastProgress, stage: '官方工件下载校验完成', stepName: lastPreparedAlias, downloadedBytes: completedBytes, totalBytes: completedBytes, byteProgressState: 'known-total',
      completedFiles: prepared.length, fileCount: prepared.length, currentStep: prepared.length, totalSteps: prepared.length, resumeCount: resumes })
    return { host, cache: join(directory, 'npm-cache'), packageName: main.name, bins: typeof main.bin === 'string' ? [main.name.split('/').at(-1)!] : Object.keys(main.bin ?? {}), main: prepared[0]!, platforms: prepared.slice(1), components: verified, cleanup }
  } catch (error) { await cleanup(false).catch(() => undefined); throw error }
}
export type NpmDownload = Awaited<ReturnType<typeof prepareNpmDownload>>
