import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LocalArtifactOptions } from '../local-artifacts.ts'
import type { OfficialProbe } from './types.ts'
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function officialProbe(options: Pick<LocalArtifactOptions, 'cli' | 'version' | 'platform' | 'home' | 'localAppData'>, totalBytes?: number): OfficialProbe {
  const platform = options.platform ?? process.platform, home = options.home ?? homedir(), local = options.localAppData ?? process.env.LOCALAPPDATA ?? join(home, 'AppData/Local')
  if (platform === 'win32') {
    if (options.cli === 'antigravity') return { kind: 'files', directory: join(local, 'agy/bin'), fileRule: /^\.new$/, totalBytes }
    if (options.cli === 'claude') return { kind: 'files', directory: join(home, '.cache/claude/staging'), directoryRule: new RegExp(`^${escaped(options.version)}\\.[^/]+$`), fileRule: new RegExp(`^${escaped(options.version)}\\.[^/]+/claude\\.exe$`), totalBytes }
    if (options.cli === 'omp') return { kind: 'files', directory: join(local, 'omp'), fileRule: /^omp\.exe\.[^/]+\.new$/, totalBytes, phaseOnlyPattern: /delta|patch|差分/i }
    if (options.cli === 'traecn') return { kind: 'files', directory: process.env.TEMP ?? tmpdir(), directoryRule: /^traecli-install-[^/]+(?:\/(?:artifacts|dependencies|ripgrep))*$/, fileRule: /^traecli-install-[^/]+\/(?:[^/]+\/)*[^/]+\.(?:gz|zip)$/, totalBytes }
  }
  if (options.cli === 'mimo' && platform === 'darwin') return { kind: 'files', privateTemp: 'TMPDIR', directoryRule: /^mimocode_install_\d+$/, fileRule: /^mimocode_install_\d+\/mimocode-[^/]+\.zip$/, totalBytes }
  if (options.cli === 'omp') return { kind: 'files', directory: join(home, '.local/bin'), fileRule: /^omp\.[^/]+\.new$/, totalBytes, phaseOnlyPattern: /delta|patch|差分/i }
  return { kind: 'stage' }
}
