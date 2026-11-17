import { access, lstat, readFile, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, isAbsolute, win32 } from 'node:path'
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
import { validAppVersion } from './versions.ts'
import { codebuddyNativeLayout } from '../codebuddy-native-layout.ts'
import { readPeVersion } from './pe-version.ts'

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
  repairNeeded?: boolean
}
/** Same origin as the deployed runtime's INSTALL-MANIFEST (design 2026-10-11): official source tree only. */
export const ZCODE_RUNTIME_MANIFEST_LIMIT = 4 * 1024 * 1024
export const ZCODE_RUNTIME_ORIGIN = 'https://github.com/zai-org/ZCode'
export const ZCODE_PLUGIN_RUNTIME_NOTE = '此 ZCode 完整 runtime 由 CLI Worker 按官方源码部署，不能用 ZCode 桌面安装包或 CLI 自带命令更新；需另行核验并部署新版 runtime。'
export const ZCODE_RUNTIME_NOTICE = '本次只更新 ZCode 桌面应用；Worker 使用独立部署的完整 CLI runtime，不会随应用同步更新，需另行核验并部署配套 runtime。'
const isManagedZCodeEntry = (executable: string) => process.platform === 'win32'
  ? executable.replace(/\\/g, '/').toLowerCase() === managedZCodeEntry().replace(/\\/g, '/').toLowerCase()
  : executable === managedZCodeEntry()
/** Read-only association; a filename alone is not application identity. */
export async function managedZCodeApplication(executable: string, appPath = ZCODE_DEFAULT_APP): Promise<string | undefined> {
  if (!isManagedZCodeEntry(executable)) return
  if (process.platform === 'win32') {
    // Only evidenced defaults. No registry, PATH discovery, or process probes in background checks.
    const candidates = [process.env.ProgramFiles && join(process.env.ProgramFiles, 'ZCode'),
      process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'ZCode')]
    for (const root of candidates) {
      if (!root || !isAbsolute(root)) continue
      try {
        // lstat rejects directory symlinks and Windows junctions, as well as linked executables.
        if (!(await lstat(root)).isDirectory()) continue
        const exe = join(root, 'ZCode.exe')
        if (!(await lstat(exe)).isFile()) continue
        const version = await readPeVersion(exe)
        if (version?.productName !== 'ZCode' || !(await stat(join(root, 'resources', 'glm', 'zcode.cjs'))).isFile()) continue
        return root
      } catch { /* Missing/unrecognized applications are not mapped. */ }
    }
    return
  }
  if (process.platform !== 'darwin') return
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
  const windows = /^[A-Za-z]:\//.test(p) || p.startsWith('//'), fold = (v: string) => windows ? v.toLowerCase() : v
  const h = home.replace(/\\/g, '/')
  // Embedded node_modules retain the managed installation owner and root.
  if (cli === 'pi' && fold(p).startsWith(fold(`${h}/.pi/agent/`))) return { source: 'self-update', updateRoot: `${h}/.pi/agent` }
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
    const marker = `/node_modules/${spec.npm}/`, index = fold(p).lastIndexOf(fold(marker))
    if (index >= 0) {
      const root = p.slice(0, index)
      if (windows || root.endsWith('/lib')) return { source: 'npm', prefix: !windows && root.endsWith('/lib') ? root.slice(0, -4) : root, packageRoot: p.slice(0, index + marker.length - 1) }
    }
  }
  if (cli === 'codebuddy') {
    const native = codebuddyNativeLayout(path, home)
    return native ? { source: 'self-update', updateRoot: native.root } : { source: 'unknown' }
  }
  if (isQoderDispatcher(cli, p, home)) return { source: 'self-update' }
  if (cli === 'grok' && selectedPath?.replace(/\\/g, '/') === `${h}/.grok/bin/grok` && p.startsWith(`${h}/.grok/downloads/`)) return { source: 'self-update', updateRoot: `${h}/.grok` }
  // Windows entries (2026-11-14 实机): official install.ps1 targets; NTFS is case-insensitive (agy.EXE from PATHEXT).
  const exact: Partial<Record<ActiveCliId, string[]>> = {
    antigravity: ['.local/bin/agy', 'AppData/Local/agy/bin/agy.exe'], omp: ['.local/bin/omp', 'AppData/Local/omp/omp.exe'],
    mimo: ['.local/bin/mimo'], claude: ['.local/bin/claude.exe'],
  }
  const same = (a: string, b: string) => windows ? a.toLowerCase() === b.toLowerCase() : a === b
  if (exact[cli]?.some(part => same(p, `${h}/${part}`) && (windows || !part.includes('AppData/') && !part.endsWith('.exe')))) return { source: 'self-update', updateRoot: p }
  const layouts: Partial<Record<ActiveCliId, string[]>> = {
    codex: ['.codex/packages/standalone/'],
    claude: ['.local/share/claude/versions/'], grok: ['.grok/bin/'], kimi: ['.kimi-code/'], mimo: ['.mimocode/bin/'],
    // Windows: %LOCALAPPDATA%\\TraeCLI\\releases\\<ver>\\traex.exe behind the current / Programs\\TraeCLI\\bin junctions.
    traecn: ['.local/share/traecli/', 'AppData/Local/TraeCLI/'], qoder: ['.qoder/bin/'], qodercn: ['.qoder-cn/bin/'], pi: ['.pi/agent/'],
    // Windows official installer: %LOCALAPPDATA%\hermes\bin\hermes.exe + hermes-agent checkout (2026-11-14 Windows 实机).
    hermes: ['.hermes/hermes-agent/', 'AppData/Local/hermes/'],
    opencode: ['.opencode/bin/'],
  }
  const layout = layouts[cli]?.find(part => fold(p).startsWith(fold(`${h}/${part}`)))
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
  let managedPi = cli === 'pi' ? await identifyManagedPi(entry?.mode === 'auto' && !configured && isVersionedAutoEntry(cli, entry.path) ? undefined : remembered) : undefined
  if (managedPi?.repairNeeded) return managedPi
  try {
    if (!background && entry?.mode === 'auto' && !configured) executable = await resolveCliExecutable(cli, backend, config, signal, { management: true, readOnly: true })
    else if (remembered && isAbsolute(remembered)) executable = remembered
    else if (background) return undefined
    else executable = await resolveCliExecutable(cli, backend, config, signal, { management: true, readOnly: true })
  } catch (error) {
    signal.throwIfAborted()
    if (managedPi) return { ...managedPi, repairNeeded: true, notice: 'Pi 托管安装需要修复' }
    throw error
  }
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
    // Windows ships app/package.json inside app.asar. The already site-verified
    // unpacked CLI product.json also records the desktop version as genieVersion.
    if (process.platform === 'win32' && !validAppVersion(appVersion) && validAppVersion(app.appVersion)) appVersion = app.appVersion
  } else if (cli === 'pi') {
    try { const pi = inspectPiInstallation(executable, { allowUnsupported: true }); target = pi.executable; manifestVersion = pi.version }
    catch (error) { if (managedPi) return { ...managedPi, repairNeeded: true, notice: 'Pi 托管安装需要修复' }; throw error }
  } else target = await realpath(resolveNativeEntry(target))
  const managedApp = cli === 'zcode' && entry?.mode !== 'manual' && !configured
    ? await managedZCodeApplication(executable) : undefined
  // Without a verified desktop app the plugin-deployed runtime
  // reports its own version from INSTALL-MANIFEST.json; never run it to ask.
  let pluginRuntime = false
  if (cli === 'zcode' && !managedApp && isManagedZCodeEntry(executable)) {
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
  if (managedApp && process.platform === 'win32') {
    const version = await readPeVersion(join(managedApp, 'ZCode.exe'))
    if (version?.productName === 'ZCode') appVersion = version.productVersion.split('.').slice(0, 3).join('.')
  } else if (appRoot) {
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
  if (cli === 'pi' && identity.source === 'self-update' && !managedPi) {
    managedPi = await identifyManagedPi(target)
    if (!managedPi) throw Object.assign(new Error(`检测到已有安装位于 ${identity.updateRoot}（Pi 官方托管安装管理），无法核实托管标记，插件不会另装一份；请用 Pi 官方安装器修复`), { code: 'CLI_IDENTITY_MISMATCH' })
  }
  if (managedPi && identity.source !== 'self-update') managedPi = undefined
  if (managedPi) {
    if (manifestVersion !== managedPi.manifestVersion) return { ...managedPi, repairNeeded: true, notice: 'Pi 托管安装需要修复' }
    identity.source = 'self-update'; identity.updateRoot = managedPi.updateRoot
    metadataToken = managedPi.fingerprint.metadataToken
  }
  return { executable, ...identity, packageRoot, manifestVersion, appPath: desktopRoot, channel, releaseChannel,
    ...(managedApp ? { notice: ZCODE_RUNTIME_NOTICE } : {}),
    fingerprint: { realpath: target, size: info.size, mtimeMs: info.mtimeMs, ...(appVersion ? { appVersion } : {}), ...(manifestVersion ? { manifestVersion } : {}), ...(metadataToken ? { metadataToken } : {}) } }
}

/** Bounded metadata inspection before launcher discovery; never mistakes a damaged managed tree for absence. */
export async function identifyManagedPi(selected?: string, home = homedir(), platform = process.platform): Promise<InstallationIdentity | undefined> {
  const path = platform === 'win32' ? win32 : { join, dirname }, root = path.join(home, '.pi', 'agent')
  const fold = (v: string) => { const p = v.replace(/\\/g, '/'); return platform === 'win32' ? p.toLowerCase() : p }
  let missingAlias = false
  if (selected && !fold(selected).startsWith(fold(root) + '/')) {
    try { if (!fold(await realpath(selected)).startsWith(fold(root) + '/')) return }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      missingAlias = true
    }
  }
  const install = path.join(root, 'install'), markerFile = path.join(install, 'managed-install.json')
  const marker = await readManifest(markerFile)
  const pointer = path.join(install, 'current-version')
  const evidence = await Promise.all([markerFile, pointer, path.join(install, 'releases')].map(file => lstat(file).catch(error => { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined; throw error })))
  if (!evidence.some(Boolean)) return
  const executable = selected ?? path.join(root, 'bin', platform === 'win32' ? 'pi.cmd' : 'pi')
  const refuse = () => { throw Object.assign(new Error(`检测到已有安装位于 ${root}（Pi 官方托管安装管理），插件不会另装一份；托管安装需要修复，请用 Pi 官方安装器修复，或先卸载后再安装`), { code: 'CLI_IDENTITY_MISMATCH' }) }
  if (missingAlias) return refuse()
  if (evidence.some(item => item?.isSymbolicLink()) || fold(await realpath(root)) !== fold(root)) return refuse()
  if (marker?.kind !== 'pi-managed-install' || marker.layout !== 'releases-v1' || marker.schemaVersion !== 1) return refuse()
  let version: string | undefined
  if (evidence[1]?.isFile() && evidence[1].size <= 128) version = (await readFile(pointer, 'utf8')).trim()
  if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) version = undefined
  let real = executable, info: Awaited<ReturnType<typeof stat>> | undefined
  try { real = await realpath(executable); info = await stat(real) } catch { /* metadata retains the owner */ }
  if (info && !fold(real).startsWith(fold(root) + '/')) return refuse()
  const repairNeeded = !version || !info?.isFile()
  return { source: 'self-update', executable, updateRoot: root, manifestVersion: version, repairNeeded,
    ...(repairNeeded ? { notice: 'Pi 托管安装需要修复' } : {}),
    fingerprint: { realpath: real, size: Number(info?.size ?? 0), mtimeMs: Number(info?.mtimeMs ?? 0), metadataToken: fingerprintToken({ realpath: markerFile, size: evidence[0]!.size, mtimeMs: evidence[0]!.mtimeMs, manifestVersion: version }) } }
}
