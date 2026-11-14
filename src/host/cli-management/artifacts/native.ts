import { safeObservation } from './observations.ts'
import { describePi } from './pi.ts'
import { describeCodex } from './codex.ts'
import { describeGrok } from './grok.ts'
import { describeTrae, optionalHeadLength } from './windows.ts'
import { homedir } from 'node:os'
import { join, dirname, win32, relative } from 'node:path'
import { chmod, lstat, readFile, realpath } from 'node:fs/promises'
import type { ActiveCliId } from '../../../shared/types.ts'
import type { InstallationIdentity } from '../identity.ts'
import type { LocalArtifactOptions } from '../local-artifacts.ts'
import type { ArtifactDescription } from './types.ts'
import { NATIVE_RELEASES, WINDOWS_LOCAL_SOURCES, LOCAL_INSTALLERS } from '../sources.ts'
import { captureReadOnly, validVersion } from '../versions.ts'
import { CliOperationError } from '../planner.ts'
import { officialLockState } from '../official-watch.ts'
import { officialProbe } from './probes.ts'
import { isMusl, qoderPlatform, selectQoderFile } from './platform.ts'
import { zstdAvailable } from './download.ts'
export const invalidArtifact = (message: string): never => { throw new CliOperationError('INTEGRITY_MISMATCH', message) }
export const record = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : invalidArtifact('官方清单结构无效')
export function digest(value: unknown, algorithm: 'sha256' | 'sha512') {
  if (typeof value !== 'string' || !new RegExp(`^[a-f0-9]{${algorithm === 'sha256' ? 64 : 128}}$`, 'i').test(value)) invalidArtifact('官方摘要无效')
  return `${algorithm}-${Buffer.from(value as string, 'hex').toString('base64')}`
}
export function safeUrl(value: unknown, base: string) {
  if (typeof value !== 'string') return invalidArtifact('工件地址缺失')
  const u = new URL(value), b = new URL(base)
  if (u.protocol !== 'https:' || u.origin !== b.origin || !u.pathname.startsWith(b.pathname) || u.username || u.password || u.search || u.hash || /%|\\/.test(u.pathname)) invalidArtifact('工件地址不在官方白名单')
  return u.href
}
export function safeName(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.+-]+$/.test(value) || value.includes('..')) return invalidArtifact('工件名无效')
  return value
}
export function nativeLayout(cli: ActiveCliId, identity: InstallationIdentity | undefined, platform: NodeJS.Platform, arch: string, home = homedir()): boolean {
  if (!identity || !['self-update', 'official-installer'].includes(identity.source) || !['darwin', 'linux', 'win32'].includes(platform) || !['x64', 'arm64'].includes(arch)) return false
  const win = platform === 'win32', p = win ? win32 : { normalize: (v: string) => v, relative }, normal = (s: string) => win ? p.normalize(s).toLowerCase() : s
  const same = (s: string) => [identity.executable, identity.fingerprint.realpath].some(v => normal(v) === normal(join(home, s)))
  const inStore = (s: string, pattern: RegExp) => pattern.test(p.relative(normal(join(home, s)), normal(identity.fingerprint.realpath)).replace(/\\/g, '/'))
  if (cli === 'kimi') return (!win || arch === 'x64') && !isMusl(platform) && same(`.kimi-code/bin/kimi${win ? '.exe' : ''}`)
  if (cli === 'mimo') return platform !== 'darwin' && same(`.mimocode/bin/mimo${win ? '.exe' : ''}`)
  if (cli === 'antigravity') return !win && same('.local/bin/agy')
  if (cli === 'claude') return !win && same('.local/bin/claude') && inStore('.local/share/claude/versions', /^[^/.][^/]*$/)
  if (cli === 'qoder' || cli === 'qodercn') {
    if (isMusl(platform) || win && arch !== 'x64') return false
    const root = cli === 'qoder' ? '.qoder' : '.qoder-cn', bin = cli === 'qoder' ? 'qodercli' : 'qoderclicn'
    return inStore(`${root}/bin/${bin}`, new RegExp(`^${bin}(?:-[0-9][^/]*)?(?:\\.exe)?$`)) || same(`${root}/entry/${cli}${win ? '.cmd' : ''}`)
  }
  if (cli === 'codex') return !win && same('.local/bin/codex') && inStore('.codex/packages/standalone/releases', /^[^/]+\/(?:bin\/)?codex$/)
  if (cli === 'pi') return same(`.pi/agent/bin/pi${win ? '.cmd' : ''}`) || inStore('.pi/agent/install/releases', /^[^/]+\/node_modules\/@earendil-works\/pi-coding-agent\/dist\/cli\.js$/)
  if (cli === 'grok') return win ? arch === 'x64' && same('.grok/bin/grok.exe') : same('.grok/bin/grok') && inStore('.grok/downloads', /^grok-[^/]+$/)
  if (cli === 'traecn') return !win && ['public', 'tob', 'tob-alpha', 'internal'].includes(identity.channel ?? '') && inStore('.local/share/traecli/releases', /^[^/]+\/(?:bin\/)?traex$/)
  return false
}
export async function describeNativeUpdate(o: LocalArtifactOptions, directory: string): Promise<ArtifactDescription> {
  const platform = o.platform ?? process.platform, arch = o.arch ?? process.arch, home = o.home ?? homedir(), win = platform === 'win32', { cli, version, signal } = o
  if (!validVersion(version)) invalidArtifact('目标版本无效')
  const probe = officialProbe(o), base: ArtifactDescription = { manifest: { urls: [], version, versionField: 'version', platformKey: `${platform}-${arch}` }, files: [], extras: [], placement: { kind: 'none' }, allowedTargets: [], platform, officialProbe: probe }
  if (cli === 'pi') return describePi(o)
  if (cli === 'codex') return describeCodex(o, directory)
  if (cli === 'grok') return describeGrok(o)
  if (cli === 'traecn') return describeTrae(o, directory, signal, home, o.localAppData)
  if (cli === 'kimi') {
    const sources = ['https://cdn.kimi.com/kimi-code', 'https://cdn.kimi.ai/kimi-code'].slice(0, o.allowSourceSwitch === false ? 1 : 2)
    let m: Record<string, any> | undefined
    for (const source of sources) { try { m = record(await o.releases.json(`${source}/binaries/${version}/manifest.json`, signal)); break } catch { signal.throwIfAborted() } }
    if (!m || m.version !== version) invalidArtifact('Kimi 清单版本不符')
    const a = record(record(m!.platforms)[`${platform}-${arch}`]), zstd = a.zstd && zstdAvailable(), file = zstd ? safeName(record(a.zstd).file) : safeName(a.filename)
    base.manifest.urls = sources.map(s => `${s}/binaries/${version}/manifest.json`)
    base.files = [{ sources: sources.map(s => `${s}/binaries/${version}/${file}`), bytes: 'HEAD', integrity: digest(zstd ? a.zstd.sha256 : a.checksum, 'sha256'), ...(zstd ? { compression: 'zstd', decodedIntegrity: digest(a.checksum, 'sha256') } : {}), dest: win ? 'kimi.exe' : 'kimi' }]
    base.officialProbe.totalForFile = async (relative, control) => optionalHeadLength(`${sources[0]}/binaries/${version}/${relative.endsWith('.zst.part') ? safeName(record(a.zstd).file) : safeName(a.filename)}`, o, control)
    const target = join(home, `.kimi-code/bin/kimi${win ? '.exe' : ''}`)
    base.placement = { kind: 'native-binary', file: base.files[0]!.dest, targets: [target], smoke: { version, match: 'exact', env: { KIMI_CODE_NO_AUTO_UPDATE: '1' } } }; base.allowedTargets = [target]
    return base
  }
  if (cli === 'qoder' || cli === 'qodercn') {
    const bin = cli === 'qoder' ? 'qodercli' : 'qoderclicn', root = join(home, cli === 'qoder' ? '.qoder' : '.qoder-cn'), store = join(root, 'bin', bin)
    const source = NATIVE_RELEASES[cli]!.url.replace('/channels/manifest.json', ''), url = `${source}/channels/${version}/manifest.json`
    const m = record(await o.releases.json(url, signal)), a = selectQoderFile(m.files, await qoderPlatform(platform, arch))
    if (m.latest !== version || !a) invalidArtifact('Qoder 锁定版本或平台条目不符')
    const artifact = safeUrl(a!.url, `${source}/releases/${version}/`), member = bin + (win ? '.exe' : '')
    const target = win ? join(store, member) : join(home, '.local/bin', bin), versionFile = join(store, `${bin}-${version}${win ? '.exe' : ''}`), metadata = join(store, 'version.txt')
    const marker = join(store, `.${bin}-install-resource`)
    if ((await safeObservation(marker, 4096))?.text.trim() !== 'curl-bash') throw new CliOperationError('PREREQUISITE_MISSING', 'Qoder 不是官方 curl-bash 布局')
    base.before = async control => { control.throwIfAborted(); const launcher = await lstat(target).catch(() => undefined); if (launcher?.isSymbolicLink() && dirname(await realpath(target)) !== store) throw new CliOperationError('PREREQUISITE_MISSING', 'Qoder 启动器指向其他安装布局'); const state = await officialLockState(join(root, 'update.lock'), /qodercli|qoderclicn/); if (state === 'active' || state === 'unknown' && await lstat(join(root, 'update.lock')).catch(() => undefined)) throw new CliOperationError('UPDATE_LOCKED', 'Qoder 更新锁仍有效或无法核实') }
    base.manifest.urls = [url]; base.files = [{ sources: [artifact], bytes: 'HEAD', integrity: digest(a!.sha256, 'sha256'), dest: win ? 'package.zip' : 'package.tar.gz' }]
    base.officialProbe.totalBytes = await optionalHeadLength(artifact, o, signal)
    base.extras = [{ dest: 'version.txt', content: `${version}\n` }, { dest: 'install-resource', content: 'curl-bash' }]
    base.placement = { kind: 'native-binary', file: member, extract: { archive: base.files[0]!.dest, format: win ? 'zip' : 'tar.gz', member }, targets: [target], versionFile, copyFallback: true, metadata: [{ file: 'version.txt', target: metadata }, { file: 'install-resource', target: join(dirname(target), `.${bin}-install-resource`) }] }
    base.allowedTargets = [target, versionFile, metadata, join(dirname(target), `.${bin}-install-resource`)]; return base
  }
  if (cli === 'antigravity') {
    const key = `${platform}_${arch === 'x64' ? 'amd64' : arch}${isMusl(platform) ? '_musl' : ''}`, url = NATIVE_RELEASES.antigravity!.url.replace('{platform}_{arch}{musl}', key), m = record(await o.releases.json(url, signal))
    if (m.version !== version) invalidArtifact('Antigravity 清单版本已变化')
    base.manifest.urls = [url]; base.manifest.platformKey = key
    base.files = [{ sources: [safeUrl(m.url, 'https://storage.googleapis.com/antigravity-public/antigravity-cli/')], bytes: 'HEAD', integrity: digest(m.sha512, 'sha512'), dest: 'package.tar.gz' }]
    const target = join(home, '.local/bin/agy'); base.allowedTargets = [target]; base.placement = { kind: 'native-binary', file: 'antigravity', extract: { archive: 'package.tar.gz', format: 'tar.gz', member: 'antigravity' }, targets: [target] }; return base
  }
  if (cli === 'claude') {
    const key = `${platform}-${arch}${isMusl(platform) ? '-musl' : ''}`, url = `${WINDOWS_LOCAL_SOURCES.claude}/${version}/manifest.json`, m = record(await o.releases.json(url, signal)), a = record(record(m.platforms)[key])
    if (m.version !== version || a.binary !== 'claude' || !Number.isSafeInteger(a.size) || a.size <= 0) invalidArtifact('Claude 版本或平台清单无效')
    base.manifest.urls = [url]; base.manifest.platformKey = key
    base.files = [{ sources: [WINDOWS_LOCAL_SOURCES.claude, WINDOWS_LOCAL_SOURCES.claudeFallback].slice(0, o.allowSourceSwitch === false ? 1 : 2).map(s => `${s}/${version}/${key}/claude`), bytes: a.size, integrity: digest(a.checksum, 'sha256'), dest: 'claude' }]
    const target = join(home, '.local/bin/claude'), versionFile = join(home, '.local/share/claude/versions', version)
    base.placement = { kind: 'versioned-link', file: 'claude', target, versionFile, link: true }; base.allowedTargets = [target, versionFile]; return base
  }
  if (cli === 'mimo') {
    const key = `${win ? 'windows' : platform}-${arch}${arch === 'x64' ? '-baseline' : ''}${isMusl(platform) ? '-musl' : ''}`, extension = platform === 'linux' ? 'tar.gz' : 'zip', member = win ? 'mimo.exe' : 'mimo', target = join(home, '.mimocode/bin', member)
    base.files = [{ sources: LOCAL_INSTALLERS.mimo.sources.slice(0, o.allowSourceSwitch === false ? 1 : 2).map(s => `${s}v${version}/mimocode-${key}.${extension}`), bytes: 'HEAD', integrity: 'response-md5', dest: `package.${extension}` }]
    base.placement = { kind: 'native-binary', file: member, extract: { archive: `package.${extension}`, format: extension, member }, targets: [target] }; base.allowedTargets = [target]; return base
  }
  return invalidArtifact('没有对应原生工件描述')
}
export async function smokeBinary(o: LocalArtifactOptions, path: string, signal: AbortSignal, version: string, exact: boolean, env?: Record<string, string>) {
  await chmod(path, 0o755)
  const raw = (await captureReadOnly(o.backend, o.config, [path, '--version'], signal, false, env, 30_000)).trim()
  if (exact ? raw !== version : !raw.split(/[^0-9A-Za-z.+-]+/).some(v => v === version || v === `v${version}`)) invalidArtifact('下载工件冒烟版本与目标不符')
}
