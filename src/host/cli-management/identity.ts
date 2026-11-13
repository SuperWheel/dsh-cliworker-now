import { access, readFile, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import type { ActiveCliId } from '../../shared/types.ts'
import type { CliInstallSource } from '../../shared/cli-management.ts'
import { configuredCliExecutable, resolveCliExecutable } from '../adapters.ts'
import type { ProcessBackend, RuntimeConfig } from '../process.ts'
import { resolveNativeEntry } from '../native-launch.mjs'
import { inspectPiInstallation } from '../pi-installation.mjs'
import { resolveWorkBuddyInstallation } from '../workbuddy-installation.ts'
import { CLI_SOURCES } from './sources.ts'

export interface Fingerprint { realpath: string; size: number; mtimeMs: number; appVersion?: string; manifestVersion?: string }
export interface InstallationIdentity {
  executable: string
  fingerprint: Fingerprint
  source: CliInstallSource
  prefix?: string
  packageRoot?: string
  manifestVersion?: string
}
export const fingerprintToken = (fingerprint: Fingerprint) => createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex')
export async function readManifest(file: string): Promise<Record<string, any> | undefined> {
  try { const info = await stat(file); if (!info.isFile() || info.size > 128 * 1024) return
    return JSON.parse(await readFile(file, 'utf8'))
  } catch { return }
}
/** Only the two evidenced dispatcher entries, never the entire entry directory. */
export function isQoderDispatcher(cli: ActiveCliId, path: string, home = homedir()): boolean {
  const entry = cli === 'qoder' ? '.qoder/entry/qoder' : cli === 'qodercn' ? '.qoder-cn/entry/qodercn' : undefined
  return entry !== undefined && path.replace(/\\/g, '/') === `${home.replace(/\\/g, '/')}/${entry}`
}
/** Path components, not substrings or command names, decide ownership. */
export function classifyInstallation(cli: ActiveCliId, path: string, packageName?: string, home = homedir(), selectedPath?: string): { source: CliInstallSource; prefix?: string; packageRoot?: string } {
  const p = path.replace(/\\/g, '/'), lower = p.toLowerCase(), spec = CLI_SOURCES[cli]
  // Other managers can embed node_modules. Check those before npm.
  if (lower.includes('/nix/store/')) return { source: 'nix' }
  if (lower.includes('/scoop/apps/')) return { source: 'scoop' }
  if (lower.includes('/microsoft/winget/') || lower.includes('/windowsapps/')) return { source: 'winget' }
  if (lower.includes('/.bun/')) return { source: 'bun' }
  if (lower.includes('/.pnpm/') || lower.includes('/pnpm/global/')) return { source: 'pnpm' }
  const brew = /\/(Cellar|Caskroom)\/([^/]+)\/[^/]+\//.exec(p)
  if (brew && brew[2] === spec.brew?.name) return { source: 'brew', prefix: p.slice(0, brew.index) }
  if (/\.app\/Contents\//.test(p) || /\/resources\/app\.asar(?:\.unpacked)?\//i.test(p)) return { source: 'desktop-app' }
  if (spec.npm && packageName === spec.npm) {
    const marker = `/node_modules/${spec.npm}/`, index = p.lastIndexOf(marker)
    if (index >= 0) {
      const root = p.slice(0, index), windows = /^[A-Za-z]:\//.test(p)
      if (root.endsWith('/lib') || windows && (root.toLowerCase() === selectedPath?.replace(/\\/g, '/').replace(/\/[^/]+$/, '').toLowerCase() || /\/AppData\/Roaming\/npm$/i.test(root))) return { source: 'npm', prefix: root.endsWith('/lib') ? root.slice(0, -4) : root, packageRoot: p.slice(0, index + marker.length - 1) }
    }
  }
  const h = home.replace(/\\/g, '/')
  if (isQoderDispatcher(cli, p, home)) return { source: 'self-update' }
  if (cli === 'grok' && selectedPath?.replace(/\\/g, '/') === `${h}/.grok/bin/grok` && p.startsWith(`${h}/.grok/downloads/`)) return { source: 'self-update' }
  const layouts: Partial<Record<ActiveCliId, string[]>> = {
    codex: ['.codex/packages/standalone/'],
    claude: ['.local/share/claude/versions/'], grok: ['.grok/bin/'], kimi: ['.kimi-code/'], mimo: ['.mimocode/bin/'],
    traecn: ['.local/share/traecli/'], qoder: ['.qoder/bin/'], qodercn: ['.qoder-cn/bin/'], pi: ['.pi/agent/'], hermes: ['.hermes/hermes-agent/'],
  }
  if (layouts[cli]?.some(part => p.startsWith(`${h}/${part}`))) return { source: spec.update ? 'self-update' : 'official-installer' }
  return { source: 'unknown' }
}
/** Background path pass never searches PATH or executes a launcher. */
export async function identifyInstallation(cli: ActiveCliId, backend: ProcessBackend, config: RuntimeConfig, signal: AbortSignal, background = false): Promise<InstallationIdentity | undefined> {
  signal.throwIfAborted()
  const entry = config.cliExecutablePaths?.read(cli)
  const configured = configuredCliExecutable(cli, config)
  const remembered = entry?.mode === 'manual' ? entry.path : configured || entry?.path
  let executable: string
  if (!background && entry?.mode === 'auto' && !configured) executable = await resolveCliExecutable(cli, backend, config, signal)
  else if (remembered && isAbsolute(remembered)) executable = remembered
  else if (background) return undefined
  else executable = await resolveCliExecutable(cli, backend, config, signal)
  signal.throwIfAborted()
  let target = await realpath(executable)
  let manifestVersion: string | undefined, appVersion: string | undefined
  if (cli === 'workbuddy' || cli === 'workbuddycn') {
    const app = await resolveWorkBuddyInstallation(cli, { manualPath: executable })
    target = await realpath(app.entry); manifestVersion = app.cliVersion
    const pkg = await readManifest(join(app.appRoot, process.platform === 'darwin' ? 'Contents/Resources/app/package.json' : 'resources/app/package.json'))
    appVersion = typeof pkg?.version === 'string' ? pkg.version : undefined
  } else if (cli === 'pi') {
    const pi = inspectPiInstallation(executable); target = pi.executable; manifestVersion = pi.version
  } else target = await realpath(resolveNativeEntry(target))
  const appRoot = /^(.*\.app)\/Contents\//.exec(target)?.[1]
  if (appRoot) {
    try {
      const file = join(appRoot, 'Contents/Info.plist'), info = await stat(file)
      if (info.isFile() && info.size < 128 * 1024) {
        const plist = await readFile(file, 'utf8')
        const value = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]{1,128})<\/string>/.exec(plist)?.[1]
        if (value) appVersion = value
      }
    } catch { /* Unknown application version remains absent, never guessed. */ }
  }
  const info = await stat(target)
  if (!info.isFile()) throw new Error('CLI entry is not a file')
  await access(target, /\.[cm]?js$/i.test(target) || process.platform === 'win32' ? constants.R_OK : constants.R_OK | constants.X_OK)
  let packageName: string | undefined, packageRoot: string | undefined
  for (let dir = dirname(target), depth = 0; depth < 7; dir = dirname(dir), depth++) {
    const pkg = await readManifest(join(dir, 'package.json'))
    if (pkg) {
      if (typeof pkg.name === 'string' && (pkg.name === CLI_SOURCES[cli].npm || cli === 'zcode' && pkg.name === '@z_ai/zcode')) {
        packageName = pkg.name; packageRoot = dir
        manifestVersion ??= typeof pkg.version === 'string' ? pkg.version : undefined
      }
      break
    }
  }
  const identity = classifyInstallation(cli, target, packageName, homedir(), executable)
  // A tapped formula must have a matching receipt; basename alone cannot prove the tap.
  if (identity.source === 'brew' && CLI_SOURCES[cli].brew?.tap) {
    const match = /^(.*\/(?:Cellar|Caskroom)\/[^/]+\/[^/]+)\//.exec(target)
    const receipt = match && await readManifest(join(match[1]!, 'INSTALL_RECEIPT.json'))
    if (receipt?.source?.tap?.toLowerCase() !== CLI_SOURCES[cli].brew!.tap!.toLowerCase()) identity.source = 'unknown'
  }
  signal.throwIfAborted()
  return { executable, ...identity, packageRoot, manifestVersion, fingerprint: { realpath: target, size: info.size, mtimeMs: info.mtimeMs, ...(appVersion ? { appVersion } : {}), ...(manifestVersion ? { manifestVersion } : {}) } }
}
