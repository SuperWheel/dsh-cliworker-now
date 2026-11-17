import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { lstat, readFile, realpath, unlink } from 'node:fs/promises'
import type { LocalArtifactOptions } from '../local-artifacts.ts'
import type { ArtifactDescription, ArtifactFile } from './types.ts'
import { compareVersions, validVersion } from '../versions.ts'
import { nativeLayout, digest, invalidArtifact } from './native.ts'
import { officialProbe } from './probes.ts'
import { optionalHeadLength } from './windows.ts'
import { CliOperationError } from '../planner.ts'
const reject = (): never => { throw new CliOperationError('PREREQUISITE_MISSING', 'Grok 归属或版本策略不允许插件接管') }
async function small(path: string) {
  const info = await lstat(path).catch(e => { if (e.code !== 'ENOENT') throw e; return undefined })
  if (!info) return
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 65536) reject()
  return readFile(path, 'utf8')
}
export async function checkGrokPolicy(o: LocalArtifactOptions) {
  const home = o.home ?? homedir(), platform = o.platform ?? process.platform
  if (!nativeLayout('grok', o.identity, platform, o.arch ?? process.arch, home)) reject()
  if (platform !== 'win32' && dirname(await realpath(join(home, '.grok/bin/grok'))) !== join(home, '.grok/downloads')) reject()
  const roots = new Set([join(home, '.cursor'), ...(process.env.CURSOR_CONFIG_DIR ? [process.env.CURSOR_CONFIG_DIR] : []), ...(process.env.XDG_CONFIG_HOME ? [join(process.env.XDG_CONFIG_HOME, 'cursor')] : [])])
  for (const root of roots) {
    const text = await small(join(root, 'grok-switch.json'))
    if (text) { const value = JSON.parse(text); if (['active', 'pending'].includes(value.status) || ['active', 'pending'].includes(value.state) || value.active === true || value.pending === true) reject() }
  }
  const text = await small(join(home, '.grok/config.toml')); if (!text) reject()
  const cli = /(?:^|\n)\[cli\]\s*\r?\n([\s\S]*?)(?=\n\s*\[|$)/.exec(text!)?.[1]
  if (!cli || !/^\s*installer\s*=\s*["']internal["']\s*(?:#.*)?$/m.test(cli)) reject()
  // Parse only the named policy keys. Unknown required_* restrictions fail closed.
  for (const m of text!.matchAll(/^\s*((?:minimum|maximum)_version|required_[A-Za-z_]+)\s*=\s*(.*?)\s*(?:#.*)?$/gm)) {
    const key = m[1]!, value = /^["']([^"']+)["']$/.exec(m[2]!)?.[1]
    if (!value || !validVersion(value) || !['minimum_version', 'maximum_version', 'required_version'].includes(key)) reject()
    const order = compareVersions(o.version, value!)
    if (key === 'minimum_version' && order < 0 || key === 'maximum_version' && order > 0 || key === 'required_version' && order !== 0) reject()
  }
}
export async function describeGrok(o: LocalArtifactOptions): Promise<ArtifactDescription> {
  await checkGrokPolicy(o)
  const platform = o.platform ?? process.platform, win = platform === 'win32', home = o.home ?? homedir(), key = `${win ? 'windows' : platform === 'darwin' ? 'macos' : 'linux'}-${(o.arch ?? process.arch) === 'x64' ? 'x86_64' : 'aarch64'}`, ext = win ? '.exe' : '', name = `grok-${o.version}-${key}${ext}`
  const bases = ['https://x.ai/cli', 'https://storage.googleapis.com/grok-build-public-artifacts/cli'].slice(0, o.allowSourceSwitch === false ? 1 : 2)
  const file = (name: string, dest: string): ArtifactFile => ({ sources: bases.map(b => `${b}/${name}`), bytes: 'HEAD', integrity: 'response-md5', dest })
  const versionFile = join(home, '.grok/downloads', name), targets = ['grok', 'agent'].map(n => join(home, '.grok/bin', n + ext))
  const companions = win ? ['grove', 'grove-fsmonitor', 'grove-credential'].map(n => ({ file: n + '.exe', target: join(home, '.grok/bin', n + '.exe') })) : []
  const files = [file(name, 'grok' + ext), ...companions.map(c => file(`${c.file.slice(0, -4)}-${o.version}-${key}.exe`, c.file))]
  const extras: ArtifactDescription['extras'] = win ? [{ dest: 'verify-signature.ps1', content: 'param([string]$Path)\n$s = Get-AuthenticodeSignature -LiteralPath $Path\n@{Status=$s.Status.ToString(); Subject=$s.SignerCertificate.Subject} | ConvertTo-Json -Compress\n' }] : []
  let mingit: { archive: string; target: string } | undefined
  if (win) {
    const prefix = `grok-${o.version}-${key}-mingit`, version = (await o.releases.text(`${bases[0]}/${prefix}.version`, o.signal)).trim()
    if (!/^\d+\.\d+\.\d+\.windows\.\d+$/.test(version)) invalidArtifact('MinGit 版本格式无效')
    const target = join(o.localAppData ?? process.env.LOCALAPPDATA ?? join(home, 'AppData/Local'), 'grok/git', version), info = await lstat(target).catch(() => undefined)
    if (info && (!info.isDirectory() || info.isSymbolicLink())) invalidArtifact('MinGit 目录不安全')
    if (!info) {
      const hash = (await o.releases.text(`${bases[0]}/${prefix}.zip.sha256`, o.signal)).trim().split(/\s+/)[0]
      files.push({ sources: bases.map(b => `${b}/${prefix}.zip`), bytes: 'HEAD', integrity: digest(hash, 'sha256'), dest: 'mingit.zip' }); mingit = { archive: 'mingit.zip', target }
    }
  }
  const cache = join(home, '.grok/models_cache.json')
  return { manifest: { urls: bases, version: o.version, versionField: 'versioned filename', platformKey: key }, files, extras, platform,
    officialProbe: officialProbe(o, await optionalHeadLength(files[0]!.sources[0]!, o, o.signal)), allowedTargets: [...targets, ...(!win ? [versionFile] : []), ...companions.map(c => c.target), ...(mingit ? [mingit.target] : []), cache],
    placement: { kind: 'native-binary', file: 'grok' + ext, targets, ...(!win ? { versionFile } : {}), companions, mingit, signature: 'grok', smoke: { version: o.version, match: 'contains' } },
    before: () => checkGrokPolicy(o), after: async () => async () => { const info = await lstat(cache).catch(() => undefined); if (info?.isFile() && !info.isSymbolicLink() && info.nlink === 1) await unlink(cache) } }
}
