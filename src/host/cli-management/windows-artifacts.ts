import { constants } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, join, win32 } from 'node:path'
import type { ActiveCliId } from '../../shared/types.ts'
import type { InstallationIdentity } from './identity.ts'
import type { LocalArtifactInstall, LocalArtifactOptions } from './local-artifacts.ts'
import { downloadCliArtifact, DOWNLOAD_MAX_BYTES, DOWNLOAD_TIMEOUT_MS, prepareDownloads } from './download.ts'
import { hostFetch } from '../host-fetch.mjs'
import { bounded, validVersion } from './versions.ts'
import { CliOperationError } from './planner.ts'
import { NATIVE_RELEASES, OFFICIAL_SIGNED_ARTIFACT_HOSTS, WINDOWS_LOCAL_SOURCES } from './sources.ts'

const invalid = (message: string): never => { throw new CliOperationError('INTEGRITY_MISMATCH', message) }
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid('官方 Windows 清单格式无效')
const filename = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._-]+$/.test(v) && !v.includes('..') && !v.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(v)
const size = (v: unknown): number => Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= DOWNLOAD_MAX_BYTES ? v as number : invalid('官方工件长度无效或超过 2 GB')
const integrity = (v: unknown, algorithm: 'sha256' | 'sha512') => {
  if (typeof v !== 'string' || !new RegExp(`^[a-fA-F0-9]{${algorithm === 'sha256' ? 64 : 128}}$`).test(v)) invalid('官方工件摘要无效')
  return `${algorithm}-${Buffer.from(v as string, 'hex').toString('base64')}`
}
function officialUrl(value: unknown, host: string, prefix: string, signed = false): string {
  let url: URL
  try { url = new URL(typeof value === 'string' ? value : '') } catch { return invalid('官方工件地址无效') }
  if (url.protocol !== 'https:' || url.hostname !== host || !url.pathname.startsWith(prefix) || url.username || url.password || url.port || url.hash || !signed && url.search || /%|\\/.test(url.pathname)) invalid('官方工件地址不在已核实 host/路径白名单')
  return url.href
}
const normalized = (p: string) => win32.normalize(p).toLowerCase()
const same = (a: string, b: string) => normalized(a) === normalized(b)
const localData = (home: string, local?: string) => local || join(home, 'AppData', 'Local')
function entry(cli: ActiveCliId, home: string, local?: string): string | undefined {
  if (cli === 'claude') return join(home, '.local', 'bin', 'claude.exe')
  if (cli === 'antigravity') return join(localData(home, local), 'agy', 'bin', 'agy.exe')
  if (cli === 'omp') return join(localData(home, local), 'omp', 'omp.exe')
}
export function canPrepareWindowsUpdate(cli: ActiveCliId, identity: InstallationIdentity | undefined, arch: string, home = homedir(), local = process.env.LOCALAPPDATA): boolean {
  if (!['x64', 'arm64'].includes(arch) || identity?.source !== 'self-update') return false
  const expected = entry(cli, home, local)
  if (expected) return [identity.executable, identity.fingerprint.realpath].some(path => same(path, expected))
  if (cli !== 'traecn' || !['public', 'tob', 'tob-alpha', 'internal'].includes(identity.channel ?? '')) return false
  const relative = win32.relative(normalized(join(localData(home, local), 'TraeCLI', 'releases')), normalized(identity.fingerprint.realpath))
  return /^[^\\]+\\traex\.exe$/.test(relative) && !relative.startsWith('..')
}

/** Shared with the Unix OMP handoff: only the build service may select a signed R2 object. */
export function validateOmpArtifact(value: unknown, version: string, platform: string, arch: string) {
  const metadata = object(value), build = object(metadata.build), file = object(metadata.file)
  const safeName = platform === 'windows' ? filename(file.name) : typeof file.name === 'string' && /^[A-Za-z0-9._+-]+$/.test(file.name) && !file.name.includes('..')
  if (build.version !== version || !safeName || file.platform !== platform || file.arch !== arch) invalid('OMP 官方构建身份不符')
  return { build, file, url: officialUrl(metadata.download, OFFICIAL_SIGNED_ARTIFACT_HOSTS[1], '/ompcast/builds/omp/', true),
    integrity: integrity(file.sha256, 'sha256'), expectedBytes: size(file.size), officialSignedArtifact: true }
}

/** Never remove a live destination before rename. Windows sharing violations leave it intact. */
async function replaceFile(source: string, target: string, signal: AbortSignal) {
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.download`)
  try {
    signal.throwIfAborted()
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await copyFile(source, temporary, constants.COPYFILE_EXCL); await chmod(temporary, 0o600)
    signal.throwIfAborted()
    await rename(temporary, target)
  } finally { await rm(temporary, { force: true }) }
}
async function placeBinary(source: string, target: string, versionFile: string | undefined, signal: AbortSignal, label: string) {
  let wroteVersion = false, backup: string | undefined
  try {
    try {
      const existing = await realpath(target)
      // Preserve on-disk casing without following an entry outside the exact whitelist.
      if (!same(existing, target)) invalid('Windows 实际入口不在已核实的默认位置')
      target = existing
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (versionFile) {
      await mkdir(dirname(versionFile), { recursive: true, mode: 0o700 })
      try {
        const info = await lstat(versionFile)
        if (!info.isFile() || info.isSymbolicLink()) invalid('Claude 版本位置不是普通文件')
        backup = `${versionFile}.${randomUUID()}.backup`
        await copyFile(versionFile, backup, constants.COPYFILE_EXCL); await chmod(backup, 0o600)
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await replaceFile(source, versionFile, signal); wroteVersion = true
    }
    await replaceFile(source, target, signal)
  } catch (error) {
    if (wroteVersion && versionFile) {
      if (backup) { await rename(backup, versionFile); backup = undefined }
      else await unlink(versionFile)
    }
    if (['EBUSY', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new CliOperationError('FILE_LOCKED', `${label} 正被其他程序占用，未替换；关闭后重试`)
    throw error
  } finally { if (backup) await rm(backup, { force: true }) }
}

type Download = (data: Pick<Parameters<typeof downloadCliArtifact>[0], 'url' | 'integrity' | 'expectedBytes' | 'officialScript' | 'officialSignedArtifact' | 'sources'>, destination: string) => Promise<void>
async function optionalHeadLength(url: string, options: LocalArtifactOptions, signal: AbortSignal): Promise<number | undefined> {
  const control = AbortSignal.any([signal, AbortSignal.timeout(8000)])
  try {
    const response = await bounded((options.fetcher ?? hostFetch)(url, { method: 'HEAD', signal: control, credentials: 'omit', redirect: 'error', headers: { 'Accept-Encoding': 'identity' } }), control)
    const length = response.headers.get('content-length')
    if (response.status !== 200 || length === null) return undefined
    if (!/^\d+$/.test(length)) invalid('官方工件 HEAD 长度无效')
    return size(Number(length))
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof CliOperationError && error.code === 'INTEGRITY_MISMATCH') throw error
    return undefined // sha512 remains mandatory when HEAD is unavailable.
  }
}

export async function prepareWindowsUpdate(options: LocalArtifactOptions): Promise<LocalArtifactInstall> {
  const home = options.home ?? homedir(), local = options.localAppData ?? process.env.LOCALAPPDATA
  const arch = options.arch ?? process.arch, { cli, version } = options
  if (!canPrepareWindowsUpdate(cli, options.identity, arch, home, local)) throw new CliOperationError('PREREQUISITE_MISSING', '此 Windows 安装布局没有已核实的下载接管入口')
  if (!validVersion(version)) invalid('官方目标版本无效')
  const directory = await mkdtemp(join(await prepareDownloads(options.root), 'local-'))
  const cleanup = () => rm(directory, { recursive: true, force: true })
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), DOWNLOAD_TIMEOUT_MS)
  const signal = AbortSignal.any([options.signal, deadline.signal])
  let stagedBytes = 0
  const reserve = (bytes: number) => { stagedBytes += bytes; if (stagedBytes > DOWNLOAD_MAX_BYTES) invalid('官方离线工件合计超过 2 GB 私有缓存上限') }
  const download: Download = async (data, destination) => {
    if (data.expectedBytes && stagedBytes + data.expectedBytes > DOWNLOAD_MAX_BYTES) invalid('官方离线工件合计超过 2 GB 私有缓存上限')
    const file = await downloadCliArtifact({ ...data, maxBytes: DOWNLOAD_MAX_BYTES - stagedBytes, root: options.root, signal, fetcher: options.fetcher, output: options.output, progress: options.progress })
    try {
      stagedBytes += (await lstat(file)).size
      if (stagedBytes > DOWNLOAD_MAX_BYTES) invalid('官方离线工件合计超过 2 GB 私有缓存上限')
      await rename(file, destination)
    } finally { await rm(file, { force: true }) }
  }
  try {
    options.output(`插件已接管 ${cli === 'traecn' ? 'TRAE CN' : cli} 官方下载；校验 ${cli === 'antigravity' ? 'sha512' : 'sha256'}（同源发布清单，不等于独立签名）。\n`)
    if (cli === 'traecn') return await prepareTrae(options, directory, download, signal, cleanup, reserve, home, local)
    const binary = join(directory, 'binary.exe')
    if (cli === 'claude') {
      const base = `${WINDOWS_LOCAL_SOURCES.claude}/${version}`, platform = `win32-${arch}`
      const manifest = object(await options.releases.json(`${base}/manifest.json`, signal))
      if (manifest.version !== version) invalid('Claude 官方清单版本与目标不符')
      const artifact = object(object(manifest.platforms)[platform])
      if (artifact.binary !== 'claude.exe') invalid('Claude 官方清单没有目标平台的 claude.exe')
      const url = `${base}/${platform}/claude.exe`
      await download({ url, sources: options.allowSourceSwitch === false ? undefined : [url, `${WINDOWS_LOCAL_SOURCES.claudeFallback}/${version}/${platform}/claude.exe`], integrity: integrity(artifact.checksum, 'sha256'), expectedBytes: size(artifact.size) }, binary)
    } else if (cli === 'antigravity') {
      const url = NATIVE_RELEASES.antigravity!.url.replace('{platform}', 'windows').replace('{arch}', arch === 'x64' ? 'amd64' : 'arm64')
      const manifest = object(await options.releases.json(url, signal))
      if (manifest.version !== version) invalid('Antigravity 官方清单版本与目标不符，请重新检查更新')
      const artifact = officialUrl(manifest.url, 'storage.googleapis.com', '/antigravity-public/antigravity-cli/')
      const digest = integrity(manifest.sha512, 'sha512')
      await download({ url: artifact, integrity: digest, expectedBytes: await optionalHeadLength(artifact, options, signal) }, binary)
    } else if (cli === 'omp') {
      const cpu = arch === 'x64' ? 'x86_64' : 'arm64'
      const manifest = await options.releases.json(`${WINDOWS_LOCAL_SOURCES.omp}/${version}/windows-${cpu}`, signal)
      await download(validateOmpArtifact(manifest, version, 'windows', cpu), binary)
    } else invalid('Windows 下载接管 CLI 无效')
    const target = entry(cli, home, local)!
    const versionFile = cli === 'claude' ? join(home, '.local', 'share', 'claude', 'versions', version) : undefined
    return { targetVersion: version, argv: [], cleanup,
      install: control => placeBinary(binary, target, versionFile, control, cli === 'claude' ? 'Claude Code' : cli === 'omp' ? 'OMP' : 'Antigravity') }
  } catch (error) {
    await cleanup()
    if (deadline.signal.aborted && !options.signal.aborted) throw new CliOperationError('DOWNLOAD_TIMEOUT', '官方工件下载总时长超过 2 小时')
    throw error
  } finally { clearTimeout(timer) }
}

async function prepareTrae(options: LocalArtifactOptions, directory: string, download: Download, signal: AbortSignal, cleanup: () => Promise<void>, reserve: (bytes: number) => void, home: string, local?: string): Promise<LocalArtifactInstall> {
  const { version } = options, channel = options.identity!.channel!, releaseChannel = options.identity!.releaseChannel ?? (channel === 'tob-alpha' ? 'alpha' : 'stable')
  const platform = (options.arch ?? process.arch) === 'x64' ? 'windows-x86_64' : 'windows-aarch64'
  const packageTarget = platform === 'windows-x86_64' ? 'x86_64-pc-windows-msvc' : 'aarch64-pc-windows-msvc'
  const base = WINDOWS_LOCAL_SOURCES.trae, prefix = new URL(base).pathname
  const manifest = object(await options.releases.json(`${base}/v2/releases/${version}/manifest.json`, signal))
  const versionPattern = channel === 'tob' ? /^\d+\.\d+\.\d+-tob(?:\.[1-9]\d*)?$/ : channel === 'tob-alpha' ? /^\d+\.\d+\.\d+-tob-alpha\.[1-9]\d*$/ : releaseChannel === 'alpha' ? /^\d+\.\d+\.\d+-alpha\.[1-9]\d*$/ : /^\d+\.\d+\.\d+$/
  if (manifest.version !== version || !versionPattern.test(version) || !['stable', 'alpha'].includes(releaseChannel)) invalid('TRAE 官方版本或发布通道不符')
  if (channel === 'internal' ? manifest.channel !== releaseChannel : !['internal', 'tob'].includes(String(manifest.build_channel)) || manifest.distribution !== (channel === 'public' ? 'public' : 'tob') || manifest.channel !== channel || channel === 'public' && manifest.release_channel !== releaseChannel) invalid('TRAE 官方清单安装通道不符')
  const select = (records: unknown) => {
    if (!Array.isArray(records)) return invalid('TRAE 官方清单缺少工件列表')
    const matches = records.map(object).filter(a => a.platform === platform)
    return matches.length === 1 ? matches[0]! : invalid('TRAE 官方清单必须恰有一个目标平台工件')
  }
  const artifact = select(manifest.artifacts), sidecars = artifact.sidecars
  if (!Array.isArray(sidecars) || sidecars.length !== 1 || object(sidecars[0]).name !== 'code_mode_host' || object(sidecars[0]).filename !== `traex-code-mode-host-${platform}.exe.gz`) invalid('TRAE 离线包缺少唯一 code mode host')
  const helpers = artifact.windows_sandbox_helpers === undefined ? [] : artifact.windows_sandbox_helpers
  if (!Array.isArray(helpers)) invalid('TRAE Windows 沙箱辅助件列表无效')
  if (artifact.windows_sandbox_helpers !== undefined) {
    if ((helpers as unknown[]).length !== 2) invalid('TRAE Windows 沙箱辅助件不完整')
    for (const name of ['traecli-windows-sandbox-setup', 'traecli-command-runner']) {
      const matches = (helpers as unknown[]).map(object).filter(a => a.name === name)
      if (matches.length !== 1 || matches[0]!.filename !== `${name}-${platform}.exe.gz`) invalid('TRAE Windows 沙箱辅助件身份不符')
    }
  }
  const dependency = object(await options.releases.json(`${base}/v2/deps/ripgrep/latest.json`, signal)), rg = select(dependency.artifacts)
  if (rg.filename !== `rg-${platform}.zip` || typeof rg.archive_path !== 'string' || !/^[0-9A-Za-z._/-]+\/rg\.exe$/.test(rg.archive_path) || rg.archive_path.startsWith('/') || rg.archive_path.includes('..')) invalid('TRAE ripgrep 归档路径无效')
  const records = [artifact, ...(sidecars as unknown[]).map(object), ...(helpers as unknown[]).map(object), rg]
  // Validate the complete bundle before the first large transfer; reject collisions and budget overflow.
  const destinations = new Set<string>()
  let total = 0
  const downloads = records.map(record => {
    const dependency = record === rg, folder = dependency ? 'dependencies/ripgrep' : 'artifacts'
    if (!filename(record.filename) || record.compression !== (dependency ? 'zip' : 'gzip')) invalid('TRAE 工件文件名或压缩格式无效')
    const relative = `${folder}/${record.filename}`, key = relative.toLowerCase()
    if (destinations.has(key)) invalid('TRAE 工件路径重复')
    destinations.add(key)
    const expectedBytes = size(record.size); total += expectedBytes
    const data = { url: officialUrl(record.url, 'lf-cdn.trae.com.cn', `${prefix}/v2/${dependency ? 'deps/ripgrep/' : 'releases/'}`), integrity: integrity(record.sha256, 'sha256'), expectedBytes }
    return { record, relative, data }
  })
  if (total > DOWNLOAD_MAX_BYTES) invalid('官方离线工件合计超过 2 GB 私有缓存上限')
  for (const item of downloads) item.record.url = item.relative
  const dependencyJson = JSON.stringify({ ...dependency, artifacts: [rg] })
  const manifestJson = JSON.stringify({ ...manifest, artifacts: [artifact], offline_channel: channel, release_channel: releaseChannel })
  const metadataBytes = Buffer.byteLength(dependencyJson) + Buffer.byteLength(manifestJson)
  if (total + metadataBytes > DOWNLOAD_MAX_BYTES) invalid('官方离线工件合计超过 2 GB 私有缓存上限')
  reserve(metadataBytes)
  await mkdir(join(directory, 'artifacts'), { mode: 0o700 })
  await mkdir(join(directory, 'dependencies'), { mode: 0o700 })
  await mkdir(join(directory, 'dependencies/ripgrep'), { mode: 0o700 })
  for (const item of downloads) await download(item.data, join(directory, item.relative))
  await writeFile(join(directory, 'dependencies/ripgrep/manifest.json'), dependencyJson, { mode: 0o600 })
  await writeFile(join(directory, 'offline-manifest.json'), manifestJson, { mode: 0o600 })
  const script = join(directory, 'install_v2.ps1')
  await download({ url: `${base}/install_v2.ps1`, officialScript: true }, script)
  const state = join(localData(home, local), 'TraeCLI'), marker = join(state, 'auto-update-version')
  const argv = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, 'offline-install', directory]
  return { targetVersion: version, argv, cleanup,
    env: { TRAECLI_VERSION: version, TRAECLI_CHANNEL: channel, TRAECLI_RELEASE_CHANNEL: releaseChannel,
      TRAECLI_STATE_DIR: state, TRAECLI_INSTALL_DIR: join(localData(home, local), 'Programs/TraeCLI/bin'), TRAEX_RELEASES_DIR: join(state, 'releases'),
      TRAECLI_INSTALL_ASSUME_YES: '1', TRAECLI_INSTALL_SKIP_USER_PATH: '1' },
    install: async (control, run) => {
      control.throwIfAborted()
      let existed = false
      try {
        const info = await lstat(marker)
        if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) invalid('TRAE 自动更新标记不是安全的普通文件')
        await readFile(marker, 'utf8'); existed = true
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await run(argv, control) // Failure/cancellation never rewrites the marker.
      if (existed) {
        // The official installer may append a UUID when an immutable generation already exists.
        const selected = await realpath(join(state, 'current')), release = basename(selected), expected = `${version}-${packageTarget}`
        if (!same(dirname(selected), join(state, 'releases')) || release !== expected && !(release.startsWith(`${expected}.`) && /^[a-f0-9]{32}$/i.test(release.slice(expected.length + 1)))) invalid('TRAE 安装后的 release 目录与目标不符')
        const source = join(directory, 'auto-update-version')
        await writeFile(source, release, { mode: 0o600 }); await replaceFile(source, marker, control)
      } else await rm(marker, { force: true })
    } }
}
