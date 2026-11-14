import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LocalArtifactOptions } from '../local-artifacts.ts'
import type { OfficialProbe } from './types.ts'
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function officialProbe(options: Pick<LocalArtifactOptions, 'cli' | 'version' | 'platform' | 'home' | 'localAppData'>, totalBytes?: number): OfficialProbe {
  const platform = options.platform ?? process.platform, home = options.home ?? homedir(), local = options.localAppData ?? process.env.LOCALAPPDATA ?? join(home, 'AppData/Local')
  const win = platform === 'win32'
  if (options.cli === 'pi') return { kind: 'stage', packageDirectory: join(home, '.pi/agent/install/staging'), packageCount: 122 }
  if (options.cli === 'kimi') return { kind: 'files', directory: join(home, '.kimi-code/bin/.staging'), fileRule: /^kimi-[^/]+\.part$/, lockFile: join(home, '.kimi/updates/install.lock') }
  if (options.cli === 'qoder' || options.cli === 'qodercn') {
    const bin = options.cli === 'qoder' ? 'qodercli' : 'qoderclicn'
    return { kind: 'files', privateTemp: win ? 'TEMP' : 'TMPDIR', fileRule: new RegExp(`^${bin}-update-[a-f0-9-]+\\.(?:tar\\.gz|zip)$`), totalBytes, hardTimeoutMs: 300000, lockCommandPattern: /qodercli|qoderclicn/, lockFile: join(home, options.cli === 'qoder' ? '.qoder' : '.qoder-cn', 'update.lock') }
  }
  if (!win && (options.cli === 'antigravity' || options.cli === 'claude')) return { kind: 'stage', phaseOnly: true } // Unix 暂存路径/字节含义推断，待实机核实。
  if (!win && options.cli === 'traecn') return { kind: 'files', privateTemp: 'TMPDIR', directoryRule: /^traecli-install\.[^/]+(?:\/[^/]+)*$/, fileRule: /^traecli-install\.[^/]+\/(?:[^/]+\/)*[^/]+\.(?:gz|zip)$/, totalBytes }
  if (options.cli === 'codex' && !win) return { kind: 'files', ...(platform === 'linux' ? { privateTemp: 'TMPDIR' as const } : {}), directoryRule: /^tmp\.[^/]+$/, fileRule: /^tmp\.[^/]+\/codex-package-[^/]+\.tar\.gz$/, totalBytes, hardTimeoutMs: 300000 }
  if (platform === 'win32') {
    if (options.cli === 'antigravity') return { kind: 'files', directory: join(local, 'agy/bin'), fileRule: /^\.new$/, totalBytes }
    if (options.cli === 'claude') return { kind: 'files', directory: join(home, '.cache/claude/staging'), directoryRule: new RegExp(`^${escaped(options.version)}\\.[^/]+$`), fileRule: new RegExp(`^${escaped(options.version)}\\.[^/]+/claude\\.exe$`), totalBytes }
    if (options.cli === 'omp') return { kind: 'files', directory: join(local, 'omp'), fileRule: /^omp\.exe\.[^/]+\.new$/, totalBytes, phaseOnlyPattern: /delta|patch|差分/i }
    if (options.cli === 'traecn') return { kind: 'files', directory: process.env.TEMP ?? tmpdir(), directoryRule: /^traecli-install-[^/]+(?:\/(?:artifacts|dependencies|ripgrep))*$/, fileRule: /^traecli-install-[^/]+\/(?:[^/]+\/)*[^/]+\.(?:gz|zip)$/, totalBytes }
  }
  if (options.cli === 'mimo') return { kind: 'files', privateTemp: win ? 'TEMP' : 'TMPDIR', directoryRule: /^mimocode_install_\d+$/, fileRule: /^mimocode_install_\d+\/mimocode-[^/]+\.(?:zip|tar\.gz)$/, totalBytes }
  if (options.cli === 'omp') return { kind: 'files', directory: join(home, '.local/bin'), fileRule: /^omp\.[^/]+\.new$/, totalBytes, phaseOnlyPattern: /delta|patch|差分/i }
  return { kind: 'stage' }
}
