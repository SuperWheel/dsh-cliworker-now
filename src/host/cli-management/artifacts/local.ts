import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { LocalArtifactOptions } from '../local-artifacts.ts'
import { hostFetch } from '../../host-fetch.mjs'
import { DOWNLOAD_MAX_BYTES } from '../download.ts'
import { bounded, validVersion } from '../versions.ts'
import { LOCAL_INSTALLERS } from '../sources.ts'
import { CliOperationError } from '../planner.ts'
import { validateOmpArtifact } from './windows.ts'
import type { ArtifactDescription } from './types.ts'
import { officialProbe } from './probes.ts'
import { toFile } from './legacy.ts'
type Options = LocalArtifactOptions
const invalid = (message: string): never => { throw new CliOperationError('INTEGRITY_MISMATCH', message) }
/** HEAD follows only the official GitHub release -> signed asset redirect. GET
 * remains redirect:error, with no credentials or caller-provided URL. */
async function artifactHead(url: string, options: Options): Promise<{ url: string; expectedBytes: number; officialSignedArtifact?: boolean }> {
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(8000)])
  for (let redirects = 0; redirects < 3; redirects++) {
    const response = await bounded((options.fetcher ?? hostFetch)(url, { method: 'HEAD', signal, credentials: 'omit', redirect: 'manual', headers: { 'Accept-Encoding': 'identity' } }), signal)
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = new URL(response.headers.get('location') ?? '', url)
      if (options.cli !== 'opencode' || location.protocol !== 'https:' || location.hostname !== 'release-assets.githubusercontent.com' || location.port || location.username || location.password || location.hash) invalid('官方工件跳转地址未获核实')
      url = location.href; continue
    }
    const length = response.headers.get('content-length')
    if (response.status !== 200 || !length || !/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) <= 0 || Number(length) > DOWNLOAD_MAX_BYTES) invalid('官方工件没有有效长度，未执行安装')
    return { url, expectedBytes: Number(length), officialSignedArtifact: new URL(url).hostname === 'release-assets.githubusercontent.com' }
  }
  return invalid('官方工件跳转次数超限')
}

export async function describeUnixUpdate(options: LocalArtifactOptions, directory: string): Promise<ArtifactDescription> {
  const { cli, version, signal } = options, platform = options.platform ?? process.platform, arch = options.arch ?? process.arch, home = options.home ?? homedir()
  if (cli !== 'mimo' && cli !== 'opencode' && cli !== 'omp') invalid('没有已核实的 Unix 工件描述')
  const source = LOCAL_INSTALLERS[cli as 'mimo' | 'opencode' | 'omp']
  const script = join(directory, 'install.sh')
  if (!validVersion(version) || cli === 'opencode' && !version.startsWith('1.')) invalid('官方本地工件目标版本无效')
  const musl = platform === 'linux' && !(process.report.getReport() as { header?: { glibcVersionRuntime?: string } }).header?.glibcVersionRuntime
  if (cli === 'omp') {
    const os = platform === 'darwin' ? 'macos' : musl ? 'linux-musl' : 'linux', cpu = arch === 'x64' ? 'x86_64' : arch
    const key = `api/products/omp/versions/${version}/${os}-${cpu}`, url = `${LOCAL_INSTALLERS.omp.base}/${key}`
    const metadata = validateOmpArtifact(await options.releases.json(url, signal), version, os, cpu)
    const file = toFile(metadata, 'omp')
    file.presigned = { version, refresh: async control => {
      const next = validateOmpArtifact(await options.releases.json(url, control), version, os, cpu)
      return { version, sources: [next.url], bytes: next.expectedBytes, integrity: next.integrity }
    } }
    return { manifest: { urls: [url], version, versionField: 'build.version', platformKey: `${os}-${cpu}` }, files: [file],
      extras: [{ dest: 'install.sh', script: source.script }, { dest: key, content: JSON.stringify({ build: metadata.build, file: metadata.file, download: pathToFileURL(join(directory, 'omp')).href }) }],
      placement: { kind: 'official-local', argv: ['/bin/sh', script, '--binary', '--ref', `v${version}`], env: { PI_BUILD_URL: pathToFileURL(directory).href, PI_INSTALL_DIR: join(home, '.local/bin'), PATH: [join(home, '.local/bin'), process.env.PATH ?? ''].join(':') } },
      allowedTargets: [join(home, source.entry)], platform, officialProbe: officialProbe(options, metadata.expectedBytes) }
  }
  const archiveSource = LOCAL_INSTALLERS[cli as 'mimo' | 'opencode']
  const target = `${platform}-${arch}${arch === 'x64' ? '-baseline' : ''}${musl ? '-musl' : ''}`
  const archive = platform === 'linux' ? 'package.tar.gz' : 'package.zip'
  const url = `${source.base}/v${version}/${archiveSource.archive}-${target}${platform === 'linux' ? '.tar.gz' : '.zip'}`
  let file
  if (cli === 'mimo') {
    const spec = LOCAL_INSTALLERS.mimo
    const sources = (options.allowSourceSwitch === false ? spec.sources.slice(0, 1) : spec.sources).map(base => `${base}v${version}/${spec.archive}-${target}${platform === 'linux' ? '.tar.gz' : '.zip'}`)
    for (const value of sources) {
      const address = new URL(value)
      if (address.protocol !== 'https:' || !(spec.policy.hosts as readonly string[]).includes(address.hostname) || !address.pathname.startsWith(spec.policy.pathPrefix) || address.username || address.password || address.port || address.search || address.hash) invalid('MiMo 下载源不在内置 host/路径白名单')
    }
    file = toFile({ url: sources[0]!, sources, requireContentMd5: true }, archive)
  } else file = { ...toFile(await artifactHead(url, options), archive), archiveCrc: true }
  return { manifest: { urls: [url], version, versionField: 'release tag', platformKey: target }, files: [file], extras: [{ dest: 'install.sh', script: source.script }],
    placement: { kind: 'official-local', argv: ['/bin/bash', script, '--binary', join(directory, cli), '--no-modify-path'], extract: { archive, format: platform === 'linux' ? 'tar.gz' : 'zip', member: cli } },
    allowedTargets: [join(home, source.entry)], platform, officialProbe: { ...officialProbe(options, typeof file.bytes === 'number' ? file.bytes : undefined),
      ...(cli === 'mimo' ? { totalForFile: async (relative: string, control: AbortSignal) => {
        const name = relative.split('/').at(-1)!
        if (!/^mimocode-darwin-(?:arm64|x64(?:-baseline)?)\.zip$/.test(name)) return undefined
        // The official updater may choose baseline differently. Use the observed filename.
        for (const base of LOCAL_INSTALLERS.mimo.sources) {
          try { return (await artifactHead(`${base}v${version}/${name}`, { ...options, signal: control })).expectedBytes }
          catch { control.throwIfAborted() }
        }
      } } : {}) } }
}
