import { access, readFile, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import type { ActiveCliId } from '../../shared/types.ts'
import type { CliInstallSource } from '../../shared/cli-management.ts'
import { configuredCliExecutable, resolveCliExecutable } from '../adapters.ts'
import type { ProcessBackend, RuntimeConfig } from '../process.ts'
import { resolveNativeEntry } from '../native-launch.mjs'
import { inspectPiInstallation } from '../pi-installation.mjs'
import { resolveWorkBuddyInstallation } from '../workbuddy-installation.ts'
import { CLI_SOURCES, ZCODE_DEFAULT_APP } from './sources.ts'
import { managedZCodeEntry } from '../zcode-adapter.ts'
import { isVersionedAutoEntry } from '../cli-auto-entry.ts'
import { hermesCheckoutVersion } from './hermes-version.ts'

export interface Fingerprint { realpath: string; size: number; mtimeMs: number; appVersion?: string; manifestVersion?: string; metadataToken?: string }
export interface InstallationIdentity {
  executable: string
  fingerprint: Fingerprint
  source: CliInstallSource
  prefix?: string
  packageRoot?: string
  manifestVersion?: string
  appPath?: string
  updateRoot?: string
  channel?: string
  releaseChannel?: string
  notice?: string
}
/** Same origin as the deployed runtime's INSTALL-MANIFEST (design 2026-10-11): official source tree only. */
export const ZCODE_RUNTIME_MANIFEST_LIMIT = 4 * 1024 * 1024
export const ZCODE_RUNTIME_ORIGIN = 'https://github.com/zai-org/ZCode'
export const ZCODE_PLUGIN_RUNTIME_NOTE = '此 ZCode 完整 runtime 由 CLI Worker 按官方源码部署，不能用 ZCode 桌面安装包或 CLI 自带命令更新；需另行核验并部署新版 runtime。'
export const ZCODE_RUNTIME_NOTICE = '本次只更新 ZCode 桌面应用；Worker 使用独立部署的完整 CLI runtime，不会随应用同步更新，需另行核验并部署配套 runtime。'
/** Read-only association; a filename alone is not application identity. */
export async function managedZCodeApplication(executable: string, appPath = ZCODE_DEFAULT_APP): Promise<string | undefined> {
  if (process.platform !== 'darwin' || executable !== managedZCodeEntry()) return
  try {
    const file = join(appPath, 'Contents/Info.plist'), info = await stat(file)
    if (!info.isFile() || info.size > 128 * 1024) return
    const plist = await readFile(file, 'utf8')
    if (/<key>CFBundleIdentifier<\/key>\s*<string>dev\.zcode\.app<\/string>/.test(plist)) return appPath
  } catch { /* Missing/unrecognized applications are not mapped. */ }
}
export const fingerprintToken = (fingerprint: Fingerprint) => createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex')
export async function readManifest(file: string, limit = 128 * 1024): Promise<Record<string, any> | undefined> {
  try { const info = await stat(file); if (!info.isFile() || info.size > limit) return
    return JSON.parse(await readFile(file, 'utf8'))
  } catch { return }
}
/** Only the two evidenced dispatcher entries, never the entire entry directory. */
export function isQoderDispatcher(cli: ActiveCliId, path: string, home = homedir()): boolean {
  const entry = cli === 'qoder' ? '.qoder/entry/qoder' : cli === 'qodercn' ? '.qoder-cn/entry/qodercn' : undefined
  return entry !== undefined && path.replace(/\\/g, '/') === `${home.replace(/\\/g, '/')}/${entry}`
}
/** Path components, not substrings or command names, decide ownership. */
export function classifyInstallation(cli: ActiveCliId, path: string, packageName?: string, home = homedir(), selectedPath?: string): { source: CliInstallSource; prefix?: string; packageRoot?: string; updateRoot?: string } {
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
  if (cli === 'grok' && selectedPath?.replace(/\\/g, '/') === `${h}/.grok/bin/grok` && p.startsWith(`${h}/.grok/downloads/`)) return { source: 'self-update', updateRoot: `${h}/.grok` }
  // Windows entries (2026-11-14 实机): official install.ps1 targets; NTFS is case-insensitive (agy.EXE from PATHEXT).
  const exact: Partial<Record<ActiveCliId, string[]>> = {
    antigravity: ['.local/bin/agy', 'AppData/Local/agy/bin/agy.exe'], omp: ['.local/bin/omp', 'AppData/Local/omp/omp.exe'],
    mimo: ['.local/bin/mimo'], claude: ['.local/bin/claude.exe'],
  }
  const windows = /^[A-Za-z]:\//.test(p), same = (a: string, b: string) => windows ? a.toLowerCase() === b.toLowerCase() : a === b
  if (exact[cli]?.some(part => same(p, `${h}/${part}`) && (windows || !part.includes('AppData/') && !part.endsWith('.exe')))) return { source: 'self-update', updateRoot: p }
  const layouts: Partial<Record<ActiveCliId, string[]>> = {
    codex: ['.codex/packages/standalone/'],
    claude: ['.local/share/claude/versions/'], grok: ['.grok/bin/'], kimi: ['.kimi-code/'], mimo: ['.mimocode/bin/'],
    // Windows: %LOCALAPPDATA%\\TraeCLI\\releases\\<ver>\\traex.exe behind the current / Programs\\TraeCLI\\bin junctions.
    traecn: ['.local/share/traecli/', 'AppData/Local/TraeCLI/'], qoder: ['.qoder/bin/'], qodercn: ['.qoder-cn/bin/'], pi: ['.pi/agent/'],
    // Windows official installer: %LOCALAPPDATA%\hermes\bin\hermes.exe + hermes-agent checkout (2026-11-14 Windows 实机).
    hermes: ['.hermes/hermes-agent/', 'AppData/Local/hermes/'],
    opencode: ['.opencode/bin/'], codebuddy: ['.codebuddy/bin/'],
  }
  const layout = layouts[cli]?.find(part => p.startsWith(`${h}/${part}`))
  if (layout) return { source: spec.update ? 'self-update' : 'official-installer', updateRoot: `${h}/${layout.slice(0, -1)}` }
  return { source: 'unknown' }
}
/** Background path pass never searches PATH or executes a launcher. */
export async function identifyInstallation(cli: ActiveCliId, backend: ProcessBackend, config: RuntimeConfig, signal: AbortSignal, background = false): Promise<InstallationIdentity | undefined> {
  signal.throwIfAborted()
  const entry = config.cliExecutablePaths?.read(cli)
  const configured = configuredCliExecutable(cli, config)
  const remembered = entry?.mode === 'manual' ? entry.path : configured || entry?.path
  let executable: string
  if (background && entry?.mode === 'auto' && !configured && isVersionedAutoEntry(cli, entry.path)) return undefined
  if (!background && entry?.mode === 'auto' && !configured) executable = await resolveCliExecutable(cli, backend, config, signal, { management: true })
  else if (remembered && isAbsolute(remembered)) executable = remembered
  else if (background) return undefined
  else executable = await resolveCliExecutable(cli, backend, config, signal, { management: true })
  signal.throwIfAborted()
  let target = await realpath(executable), desktopRoot: string | undefined
  if (cli === 'hermes') {
    // Same fixed exec-shim grammar as hermes-installation.ts; inspect, never run.
    for (let depth = 0; depth < 4; depth++) {
      const info = await stat(target)
      if (info.size > 128 * 1024) break
      const source = await readFile(target, 'utf8')
      const shim = /^#![^\r\n]*\b(?:sh|bash|zsh)\s*\r?\n\s*exec\s+(?:"(\/[^"\r\n$`]+)"|(\/[^\s$`"'\\;|&<>]+))\s+"\$@"\s*$/.exec(source)
      if (!shim) break
      target = await realpath(shim[1] ?? shim[2]!)
    }
  }
  let manifestVersion: string | undefined, appVersion: string | undefined, channel: string | undefined, releaseChannel: string | undefined, metadataToken: string | undefined
  if (cli === 'workbuddy' || cli === 'workbuddycn') {
    const app = await resolveWorkBuddyInstallation(cli, { manualPath: executable })
    desktopRoot = app.appRoot
    target = await realpath(app.entry); manifestVersion = app.cliVersion
    const pkg = await readManifest(join(app.appRoot, process.platform === 'darwin' ? 'Contents/Resources/app/package.json' : 'resources/app/package.json'))
    appVersion = typeof pkg?.version === 'string' ? pkg.version : undefined
  } else if (cli === 'pi') {
    const pi = inspectPiInstallation(executable, { allowUnsupported: true }); target = pi.executable; manifestVersion = pi.version
  } else target = await realpath(resolveNativeEntry(target))
  const managedApp = cli === 'zcode' && entry?.mode !== 'manual' && !configured
    ? await managedZCodeApplication(executable) : undefined
  // Without a mapped desktop app (Windows, or macOS without ZCode.app) the plugin-deployed runtime
  // reports its own version from INSTALL-MANIFEST.json; never run it to ask.
  let pluginRuntime = false
  if (cli === 'zcode' && !managedApp && executable === managedZCodeEntry()) {
    // Lists every bundled npm package with integrity: 633 KB (macOS) / 723 KB (Windows) on 2026-11-14.
    const manifest = await readManifest(join(dirname(dirname(executable)), 'INSTALL-MANIFEST.json'), ZCODE_RUNTIME_MANIFEST_LIMIT)
    if (manifest?.source?.origin === ZCODE_RUNTIME_ORIGIN && typeof manifest.version === 'string') { manifestVersion = manifest.version; pluginRuntime = true }
  }
  const appRoot = managedApp ?? /^(.*\.app)\/Contents\//.exec(target)?.[1]
  desktopRoot ??= appRoot
  // Whitelisted installation metadata only. Never invoke Hermes startup/check/fetch.
  if (cli === 'hermes' || cli === 'traecn') {
    for (let dir = dirname(target), depth = 0; depth < 7; dir = dirname(dir), depth++) {
      // Windows keeps the launcher in <root>\\bin and the stamp in the sibling <root>\\hermes-agent checkout.
      const names = cli === 'hermes'
        ? ['install-stamp.json', ...(depth === 1 && /^bin$/i.test(basename(dirname(target))) ? [join('hermes-agent', 'install-stamp.json')] : [])]
        : ['trae-installation.json']
      let record: Record<string, any> | undefined
      let recordPath: string | undefined
      for (const name of names) if ((record = await readManifest(join(dir, name)))) { recordPath = join(dir, name); break }
      if (!record) continue
      if (cli === 'hermes' && typeof record.baseVersion === 'string') {
        const checkout = await hermesCheckoutVersion(dirname(recordPath!), record.commit)
        manifestVersion = checkout?.version ?? record.baseVersion
        channel = typeof record.channel === 'string' && /^[a-z0-9-]{1,32}$/.test(record.channel) ? record.channel : 'unknown'
        metadataToken = createHash('sha256').update(JSON.stringify([manifestVersion, checkout?.commit ?? record.commit, channel])).digest('hex')
      } else if (cli === 'traecn' && ['public', 'tob', 'tob-alpha', 'internal'].includes(record.channel)) {
        channel = record.channel
        releaseChannel = typeof record.release_channel === 'string' ? record.release_channel : undefined
        metadataToken = createHash('sha256').update(JSON.stringify([channel, record.release_channel])).digest('hex')
      }
      break
    }
  }
  if (appRoot) {
    try {
      const file = join(appRoot, 'Contents/Info.plist'), info = await stat(file)
      if (info.isFile() && info.size < 128 * 1024) {
        const plist = await readFile(file, 'utf8')
        const value = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]{1,128})<\/string>/.exec(plist)?.[1]
        if (value) appVersion = value
        const build = /<key>CFBundleVersion<\/key>\s*<string>([^<]{1,128})<\/string>/.exec(plist)?.[1]
        if ((cli === 'workbuddy' || cli === 'workbuddycn') && build && /^\d+\.\d+\.\d+\.\d+$/.test(build)) appVersion = build
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
  if (managedApp) identity.source = 'desktop-app'
  else if (pluginRuntime) identity.source = 'plugin-runtime'
  // A tapped formula must have a matching receipt; basename alone cannot prove the tap.
  if (identity.source === 'brew' && CLI_SOURCES[cli].brew?.tap) {
    const match = /^(.*\/(?:Cellar|Caskroom)\/[^/]+\/[^/]+)\//.exec(target)
    const receipt = match && await readManifest(join(match[1]!, 'INSTALL_RECEIPT.json'))
    if (receipt?.source?.tap?.toLowerCase() !== CLI_SOURCES[cli].brew!.tap!.toLowerCase()) identity.source = 'unknown'
  }
  signal.throwIfAborted()
  return { executable, ...identity, packageRoot, manifestVersion, appPath: desktopRoot, channel, releaseChannel,
    ...(managedApp ? { notice: ZCODE_RUNTIME_NOTICE } : {}),
    fingerprint: { realpath: target, size: info.size, mtimeMs: info.mtimeMs, ...(appVersion ? { appVersion } : {}), ...(manifestVersion ? { manifestVersion } : {}), ...(metadataToken ? { metadataToken } : {}) } }
}
