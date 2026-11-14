import { mkdtemp, rm, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { ActiveCliId } from '../../shared/types.ts'
import type { CliChannelReason, CliDownloadProgress } from '../../shared/cli-management.ts'
import { CLI_SOURCES } from './sources.ts'
import { downloadCliArtifact, prepareDownloads, parseIntegrity } from './download.ts'
import { downloadDescription } from './artifacts/download.ts'
import { CliOperationError } from './planner.ts'
import { ChannelMemory, channelMemoryKey } from './channel-memory.ts'
import { npmArtifact, npmManifest, npmDigest, npmPlatformComponents, rememberNpmPlatforms, type NpmHost } from './npm-platform.ts'
import type { ReleaseClient } from './versions.ts'
import type { InstallationIdentity } from './identity.ts'

export const npmDownloadFs = { rm }

/** Same npm runtime, prefix, registry, cwd/environment and cache configuration as install.
 * No --cache override: populate only the cache this npm invocation actually uses. */
export const npmCacheAddArgv = (npm: readonly string[], file: string, prefix: string, registry: string) =>
  [...npm, 'cache', 'add', file, '--global', '--prefix', prefix, '--registry', registry]

export async function prepareNpmDownload(options: {
  cli: ActiveCliId; version: string; registry: string; automaticSources: boolean; root: string
  releases: ReleaseClient; signal: AbortSignal; identity?: InstallationIdentity; host: NpmHost
  fetcher?: Parameters<typeof downloadCliArtifact>[0]['fetcher']; progress(value: CliDownloadProgress): void; output(value: string): void
}) {
  const { releases, registry, signal } = options
  const main = await npmManifest(releases, CLI_SOURCES[options.cli].npm!, options.version, registry, signal)
  if (parseIntegrity(npmDigest(main)).algorithm !== 'sha512') throw new CliOperationError('INTEGRITY_MISMATCH', 'npm 主包缺少官方 sha512 校验值')
  const host = options.host
  const components = await npmPlatformComponents(main, releases, registry, signal, host)
  const entries = [{ alias: main.name, manifest: main }, ...components]
  const files = []
  for (const [i, entry] of entries.entries()) files.push(await npmArtifact(entry.manifest, releases, registry, signal, options.automaticSources, `${i}.tgz`))
  await rememberNpmPlatforms(options.root, main, host, components)
  const directory = await mkdtemp(join(await prepareDownloads(options.root), 'local-'))
  await chmod(directory, 0o700)
  const memory = new ChannelMemory(options.root)
  const key = options.identity ? channelMemoryKey(options.cli, options.identity, host.platform, host.arch) : createHash('sha256').update(JSON.stringify(['npm-install', options.cli, host])).digest('hex')
  const remembered = options.automaticSources ? await memory.get(key) : undefined
  let failure: CliChannelReason | undefined, takeover = !!remembered
  const cleanup = async (successful: boolean, preserveFiles = false) => {
    try {
      if (options.automaticSources) {
        if (!successful || !takeover) await memory.set(key, undefined)
        else if (failure) await memory.set(key, failure)
      }
    } finally { if (!preserveFiles) await npmDownloadFs.rm(directory, { recursive: true, force: true }) }
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
  try {
    await downloadDescription({ files }, { ...options, directory, download,
      progress: p => options.progress({ ...p, stepName: entries[(p.currentStep ?? 1) - 1]?.alias,
        reason: p.channel === 'takeover' ? remembered ? 'OFFICIAL_RECENT_FAILURE' : failure : undefined,
        officialFailedAt: p.channel === 'takeover' ? remembered?.failedAt : undefined }) })
    return { host, main: join(directory, '0.tgz'), platforms: files.slice(1).map(f => join(directory, f.dest)), components, cleanup }
  } catch (error) { await cleanup(false).catch(() => undefined); throw error }
}
export type NpmDownload = Awaited<ReturnType<typeof prepareNpmDownload>>
