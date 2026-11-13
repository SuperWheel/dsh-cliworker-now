import { chmod, lstat, mkdir, mkdtemp, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ActiveCliId } from '../../shared/types.ts'
import type { InstallationIdentity } from './identity.ts'
import type { ProcessBackend, RuntimeConfig } from '../process.ts'
import { ProcessCleanupUnconfirmedError } from '../process.ts'
import { hostFetch } from '../host-fetch.mjs'
import { downloadCliArtifact, DOWNLOAD_MAX_BYTES, DOWNLOAD_TIMEOUT_MS, prepareDownloads } from './download.ts'
import { executeCliOperation } from './executor.ts'
import { bounded, ReleaseClient, validVersion } from './versions.ts'
import { LOCAL_INSTALLERS, OFFICIAL_SIGNED_ARTIFACT_HOSTS } from './sources.ts'
import { CliOperationError } from './planner.ts'

type DownloadOptions = Parameters<typeof downloadCliArtifact>[0]
interface Options {
  cli: ActiveCliId; version: string; identity?: InstallationIdentity; root: string
  backend: ProcessBackend; config: RuntimeConfig; releases: ReleaseClient; signal: AbortSignal
  fetcher?: typeof hostFetch; output(value: string): void; progress: DownloadOptions['progress']
  platform?: NodeJS.Platform; arch?: string; allowSourceSwitch?: boolean
}
export interface LocalArtifactInstall { targetVersion: string; argv: string[]; env?: Record<string, string>; cleanup(): Promise<void> }
const invalid = (message: string): never => { throw new CliOperationError('INTEGRITY_MISMATCH', message) }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid('官方离线清单格式无效')
const token = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._+-]+$/.test(value) && !value.includes('..')

/** Select only layouts the official installer will update in place. Other owners
 * retain their original updater. All remote addresses below are built in. */
export function canPrepareLocalUpdate(cli: ActiveCliId, identity: InstallationIdentity | undefined, platform = process.platform, arch: string = process.arch): boolean {
  if (!['darwin', 'linux'].includes(platform) || !['arm64', 'x64'].includes(arch)) return false
  // MiMo approval covers the official macOS zip; Linux keeps its native updater.
  if (cli === 'mimo' && platform !== 'darwin') return false
  if (cli !== 'mimo' && cli !== 'opencode' && cli !== 'omp' || !identity || identity.source !== 'self-update') return false
  const expected = join(homedir(), LOCAL_INSTALLERS[cli].entry)
  return identity.executable === expected || identity.fingerprint.realpath === expected
}

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

export async function prepareLocalUpdate(options: Options): Promise<LocalArtifactInstall> {
  const { cli } = options, platform = options.platform ?? process.platform, arch = options.arch ?? process.arch
  if (!canPrepareLocalUpdate(cli, options.identity, platform, arch)) throw new CliOperationError('PREREQUISITE_MISSING', '此安装布局没有已核实的本地工件入口')
  const descriptor = LOCAL_INSTALLERS[cli as keyof typeof LOCAL_INSTALLERS]
  const directory = await mkdtemp(join(await prepareDownloads(options.root), 'local-'))
  const cleanup = () => rm(directory, { recursive: true, force: true })
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), DOWNLOAD_TIMEOUT_MS)
  const signal = AbortSignal.any([options.signal, deadline.signal])
  let stagedBytes = 0
  const download = async (data: Pick<DownloadOptions, 'url' | 'integrity' | 'expectedBytes' | 'officialScript' | 'officialSignedArtifact' | 'sources' | 'requireContentMd5'>, destination: string) => {
    if (data.expectedBytes && stagedBytes + data.expectedBytes > DOWNLOAD_MAX_BYTES) invalid('官方离线工件合计超过 2 GB 私有缓存上限')
    const file = await downloadCliArtifact({ ...data, root: options.root, signal, fetcher: options.fetcher, output: options.output, progress: options.progress })
    stagedBytes += (await lstat(file)).size
    if (stagedBytes > DOWNLOAD_MAX_BYTES) { await unlink(file); invalid('官方离线工件合计超过 2 GB 私有缓存上限') }
    await rename(file, destination)
  }
  try {
    const script = join(directory, 'install.sh')
    await download({ url: descriptor.script, officialScript: true }, script)
    if (cli === 'omp') {
      if (!validVersion(options.version)) invalid('OMP 官方目标版本无效')
      const musl = platform === 'linux' && !(process.report.getReport() as { header?: { glibcVersionRuntime?: string } }).header?.glibcVersionRuntime
      const target = `${platform === 'darwin' ? 'macos' : musl ? 'linux-musl' : 'linux'}-${arch === 'x64' ? 'x86_64' : arch}`
      const key = `api/products/omp/versions/${options.version}/${target}`
      const metadata = object(await options.releases.json(`${LOCAL_INSTALLERS.omp.base}/${key}`, signal)), build = object(metadata.build), file = object(metadata.file)
      if (build.version !== options.version || !token(file.name) || file.platform !== target.slice(0, target.lastIndexOf('-')) || file.arch !== (arch === 'x64' ? 'x86_64' : arch) || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || (file.size as number) <= 0 || typeof metadata.download !== 'string') invalid('OMP 官方构建身份、摘要或长度不符')
      const address = new URL(metadata.download as string)
      if (address.protocol !== 'https:' || address.hostname !== OFFICIAL_SIGNED_ARTIFACT_HOSTS[1] || !address.pathname.startsWith('/ompcast/builds/omp/') || address.username || address.password || address.port || address.hash) invalid('OMP 官方工件地址不在已核实构建源内')
      const binary = join(directory, 'omp')
      await download({ url: address.href, officialSignedArtifact: true, integrity: `sha256-${Buffer.from(file.sha256 as string, 'hex').toString('base64')}`, expectedBytes: file.size as number }, binary)
      const metadataPath = join(directory, key)
      await mkdir(join(directory, `api/products/omp/versions/${options.version}`), { recursive: true, mode: 0o700 })
      // Preserve the official schema; only its download pointer is made local.
      await writeFile(metadataPath, JSON.stringify({ build, file, download: pathToFileURL(binary).href }), { mode: 0o600 })
      options.output('已接管 OMP 官方工件下载；官方 PI_BUILD_URL 读取私有本地清单与文件。\n')
      return { targetVersion: options.version, argv: ['/bin/sh', script, '--binary', '--ref', `v${options.version}`], env: { PI_BUILD_URL: pathToFileURL(directory).href, PI_INSTALL_DIR: join(homedir(), '.local/bin') }, cleanup }
    }
    if (cli !== 'opencode' && cli !== 'mimo' || !validVersion(options.version) || cli === 'opencode' && !options.version.startsWith('1.')) invalid('官方本地工件目标版本无效')
    const source = LOCAL_INSTALLERS[cli as 'mimo' | 'opencode']
    // Baseline x64 runs on both AVX2 and older CPUs. libc comes from this Host,
    // not an assumed CPU capability or from untrusted CLI output.
    const musl = platform === 'linux' && !(process.report.getReport() as { header?: { glibcVersionRuntime?: string } }).header?.glibcVersionRuntime
    const target = `${platform}-${arch}${arch === 'x64' ? '-baseline' : ''}${musl ? '-musl' : ''}`
    const archive = join(directory, platform === 'linux' ? 'package.tar.gz' : 'package.zip')
    const url = `${source.base}/v${options.version}/${source.archive}-${target}${platform === 'linux' ? '.tar.gz' : '.zip'}`
    if (cli === 'mimo') {
      const descriptor = LOCAL_INSTALLERS.mimo
      const sources = (options.allowSourceSwitch === false ? descriptor.sources.slice(0, 1) : descriptor.sources).map(base => `${base}v${options.version}/${descriptor.archive}-${target}.zip`)
      for (const value of sources) {
        const address = new URL(value)
        if (address.protocol !== 'https:' || !(descriptor.policy.hosts as readonly string[]).includes(address.hostname) || !address.pathname.startsWith(descriptor.policy.pathPrefix) || address.username || address.password || address.port || address.search || address.hash) invalid('MiMo 下载源不在内置 host/路径白名单')
      }
      await download({ url: sources[0]!, sources, requireContentMd5: true }, archive)
    } else await download(await artifactHead(url, { ...options, signal }), archive)
    const name = cli, binary = join(directory, name)
    // Select exactly the official root member: never extract arbitrary paths.
    const argv = platform === 'linux' ? ['/usr/bin/tar', '-xzf', archive, '-C', directory, name] : ['/usr/bin/unzip', '-q', archive, name, '-d', directory]
    try { await executeCliOperation(options.backend, options.config, argv, signal, options.output) }
    catch (error) {
      if (error instanceof CliOperationError && error.code === 'EXIT_CODE') invalid('官方归档结构或解压校验不通过')
      throw error
    }
    const info = await lstat(binary)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size <= 0 || info.size > DOWNLOAD_MAX_BYTES) invalid('官方归档没有安全的根目录 CLI 文件')
    await chmod(binary, 0o600)
    if (cli === 'mimo') options.output('MiMo 已校验官方长度、content-md5 与 zip 结构（解压 CRC）；MD5 来自同源响应，不代表独立签名验证。\n')
    options.output(`已接管 ${cli} 官方工件下载；安装由官方 --binary 入口执行。\n`)
    return { targetVersion: options.version, argv: ['/bin/bash', script, '--binary', binary, '--no-modify-path'], cleanup }
  } catch (error) {
    // The service quarantines the lease; do not delete files still in use.
    if (!(error instanceof ProcessCleanupUnconfirmedError)) await cleanup()
    if (deadline.signal.aborted && !options.signal.aborted && !(error instanceof ProcessCleanupUnconfirmedError)) throw new CliOperationError('DOWNLOAD_TIMEOUT', '官方工件下载总时长超过 2 小时')
    throw error
  } finally { clearTimeout(timer) }
}
