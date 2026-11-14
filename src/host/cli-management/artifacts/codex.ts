import { nativeMacArch } from './platform.ts'
import { optionalHeadLength } from './windows.ts'
import { homedir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import type { LocalArtifactOptions } from '../local-artifacts.ts'
import type { ArtifactDescription } from './types.ts'
import { captureReadOnly } from '../versions.ts'
import { record, digest, invalidArtifact } from './native.ts'
import { officialProbe } from './probes.ts'
/** The standalone finish script must not follow ambient daemon/custom-location switches. */
export function codexInstallerEnv(home = homedir()): Record<string, string> {
  return { CODEX_NON_INTERACTIVE: '1', CODEX_HOME: join(home, '.codex'), CODEX_INSTALL_DIR: join(home, '.local/bin'), CODEX_INSTALL_DAEMON_ONLY: '0', CODEX_INSTALL_DEFER_SELECTION: '0', CODEX_INSTALL_IF_LATEST: '0', CODEX_INSTALL_IF_CURRENT: '0', PATH: [process.env.PATH ?? '', join(home, '.local/bin')].join(':') }
}
export async function describeCodex(o: LocalArtifactOptions, directory: string): Promise<ArtifactDescription> {
  const platform = o.platform ?? process.platform, home = o.home ?? homedir(), arch = await nativeMacArch(platform, o.arch ?? process.arch), target = `${arch === 'x64' ? 'x86_64' : 'aarch64'}-${platform === 'darwin' ? 'apple-darwin' : 'unknown-linux-musl'}`
  const base = `https://releases.openai.com/codex/releases/${o.version}`, url = `${base}/release.json`, manifest = record(await o.releases.json(url, o.signal)), name = `codex-package-${target}.tar.gz`
  if (manifest.tag_name !== `rust-v${o.version}` || !Array.isArray(manifest.assets)) invalidArtifact('Codex release 身份不符')
  const matches = manifest.assets.filter((a: any) => a.name === name)
  if (matches.length !== 1 || !/^sha256:[a-f0-9]{64}$/i.test(matches[0].digest)) invalidArtifact('Codex release 缺少唯一 SHA-256 工件')
  const probe = officialProbe(o, await optionalHeadLength(`${base}/${name}`, o, o.signal))
  if (platform === 'darwin') {
    const temp = (await captureReadOnly(o.backend, o.config, ['/usr/bin/getconf', 'DARWIN_USER_TEMP_DIR'], o.signal)).trim()
    if (!isAbsolute(temp) || /[\r\n\x00]/.test(temp)) invalidArtifact('macOS 用户临时目录无效')
    probe.directory = temp
  }
  const release = join(home, '.codex/packages/standalone/releases', `${o.version}-${target}`)
  return { manifest: { urls: [url], version: o.version, versionField: 'tag_name', platformKey: target },
    files: [{ sources: [`${base}/${name}`, `https://github.com/openai/codex/releases/download/rust-v${o.version}/${name}`].slice(0, o.allowSourceSwitch === false ? 1 : 2), bytes: 'HEAD', integrity: digest(matches[0].digest.slice(7), 'sha256'), redirectHosts: ['release-assets.githubusercontent.com'], dest: 'package.tar.gz' }],
    extras: [{ dest: 'install.sh', script: 'https://releases.openai.com/codex/install.sh' }], allowedTargets: [release], platform, officialProbe: probe,
    placement: { kind: 'release-package', archive: 'package.tar.gz', target: release, version: o.version, argv: ['/bin/sh', join(directory, 'install.sh'), '--release', o.version], env: codexInstallerEnv(home) } }
}
