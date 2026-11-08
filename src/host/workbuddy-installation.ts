import { readFile, stat, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, win32 } from 'node:path'
import { workbuddyVariant, type WorkBuddyCliId } from './workbuddy-variant.ts'

export class WorkBuddyUnavailableError extends Error {
  readonly code = 'WORKBUDDY_UNAVAILABLE'
  constructor(readonly reason: string) {
    super(`WorkBuddy 暂不可用：${reason}`)
    this.name = 'WorkBuddyUnavailableError'
  }
}

export interface WorkBuddyInstallation {
  cli: WorkBuddyCliId
  appRoot: string
  runtime: string
  entry: string
  cliVersion: string
  productName: string
  endpoint: string
  configDir: string
  dataFolderName: string
}
export interface WorkBuddyInstallationOptions {
  platform?: NodeJS.Platform
  home?: string
  env?: NodeJS.ProcessEnv
  /** App directory, its runtime, or its built-in entry. Explicit paths never fall back. */
  path?: string
  manualPath?: string
  candidates?: readonly string[]
}

export async function resolveWorkBuddyInstallation(cli: WorkBuddyCliId, options: WorkBuddyInstallationOptions = {}): Promise<WorkBuddyInstallation> {
  const variant = workbuddyVariant(cli), platform = options.platform ?? process.platform
  const home = options.home ?? homedir(), env = options.env ?? process.env
  if (platform !== 'darwin' && platform !== 'win32') throw new WorkBuddyUnavailableError('platform-unsupported')
  const manual = options.manualPath ?? options.path
  const candidates = manual ? [manual] : options.candidates ?? (platform === 'darwin'
    ? ['/Applications', join(home, 'Applications')].flatMap(root => variant.macAppNames.map(name => join(root, name)))
    : [env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs'), env.ProgramFiles, env['ProgramFiles(x86)']]
      .filter((root): root is string => !!root).flatMap(root => variant.windowsDirectoryNames.map(name => join(root, name))))
  let reason = 'not-installed'
  for (const candidate of candidates) {
    try {
      let appRoot = resolve(candidate), runtime: string | undefined
      if (basename(appRoot) === 'codebuddy-lite-wb.mjs')
        appRoot = platform === 'darwin' ? resolve(appRoot, '../../../../../..') : resolve(appRoot, '../../../../..')
      else if (platform === 'darwin' && basename(appRoot) === 'Electron') appRoot = resolve(appRoot, '../../..')
      else if (platform === 'win32' && /\.exe$/i.test(appRoot)) { runtime = appRoot; appRoot = dirname(appRoot) }
      const cliRoot = join(appRoot, ...(platform === 'darwin' ? ['Contents', 'Resources'] : ['resources']), 'app.asar.unpacked', 'cli')
      const entry = join(cliRoot, 'dist', 'codebuddy-lite-wb.mjs')
      if (!(await stat(appRoot)).isDirectory()) throw new WorkBuddyUnavailableError('installation-invalid')
      const readJson = async (name: string) => {
        const file = join(cliRoot, name), info = await stat(file)
        if (!info.isFile() || info.size > 1024 * 1024) throw new WorkBuddyUnavailableError('metadata-invalid')
        return JSON.parse(await readFile(file, 'utf8'))
      }
      const [pkg, product] = await Promise.all([readJson('package.json'), readJson('product.json')])
      if (pkg?.name !== '@genie/agent-cli') throw new WorkBuddyUnavailableError('package-mismatch')
      let endpoint: URL
      try { endpoint = new URL(product.endpoint) } catch { throw new WorkBuddyUnavailableError('endpoint-invalid') }
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || !variant.endpointHosts.includes(endpoint.hostname))
        throw new WorkBuddyUnavailableError('variant-mismatch')
      if (typeof product.dataFolderName !== 'string' || !/^\.[A-Za-z0-9._-]+$/.test(product.dataFolderName) || product.dataFolderName === '..')
        throw new WorkBuddyUnavailableError('data-folder-invalid')
      if (!runtime) {
        if (platform === 'darwin') runtime = join(appRoot, 'Contents', 'MacOS', 'Electron')
        else {
          const names = (await readdir(appRoot)).filter(name => /\.exe$/i.test(name) && !/unins|uninstall|crash|update/i.test(name))
          const preferred = ['WorkBuddy.exe', 'WorkBuddy AI.exe'].find(name => names.includes(name))
          if (!preferred && names.length !== 1) throw new WorkBuddyUnavailableError('runtime-ambiguous')
          runtime = join(appRoot, preferred ?? names[0]!)
        }
      }
      if (!(await stat(runtime)).isFile() || !(await stat(entry)).isFile()) throw new WorkBuddyUnavailableError('entry-missing')
      if (typeof pkg.version !== 'string' || !pkg.version || typeof product.productName !== 'string' || !product.productName)
        throw new WorkBuddyUnavailableError('metadata-invalid')
      return { cli, appRoot, runtime, entry, cliVersion: pkg.version, productName: product.productName,
        endpoint: product.endpoint, configDir: join(home, product.dataFolderName), dataFolderName: product.dataFolderName }
    } catch (error) {
      reason = error instanceof WorkBuddyUnavailableError ? error.reason
        : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-installed' : 'installation-invalid'
    }
  }
  throw new WorkBuddyUnavailableError(reason)
}

/**
 * Fixed read-only registry query for installs outside the vendor's default
 * folders (the installer lets users pick e.g. D:\Software\workbuddy).
 * Reads only InstallLocation/DisplayIcon of Tencent-published WorkBuddy entries;
 * product.json still decides which site (CN or international) it is.
 */
export const WORKBUDDY_WINDOWS_INSTALL_QUERY = String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$rows=[Collections.Generic.List[object]]::new()
$complete=$true
try {
  foreach($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)) {
    foreach($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)) {
      $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
      try {
        $uninstall=$base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall')
        if(!$uninstall){continue}
        try {
          foreach($name in $uninstall.GetSubKeyNames()) {
            if($rows.Count -ge 16){break}
            $key=$uninstall.OpenSubKey($name)
            if(!$key){continue}
            try {
              if([string]$key.GetValue('DisplayName') -notmatch '^WorkBuddy(?: AI)?(?:\s.*)?$'){continue}
              if([string]$key.GetValue('Publisher') -notmatch '^Tencent\b'){continue}
              $rows.Add([ordered]@{root=[string]$key.GetValue('InstallLocation');icon=[string]$key.GetValue('DisplayIcon')})
            } finally {$key.Dispose()}
          }
        } finally {$uninstall.Dispose()}
      } finally {$base.Dispose()}
    }
  }
} catch {$complete=$false}
[Console]::WriteLine(([ordered]@{schema=1;complete=$complete;records=@($rows.ToArray())}|ConvertTo-Json -Depth 4 -Compress))
`

const plainWindowsPath = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  let path = value.trim()
  if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1)
  if (!path || path.length > 1024 || /[\x00-\x1f\x7f"]/.test(path) || !/^[A-Za-z]:[\\/]/.test(path)) return undefined
  return win32.normalize(path)
}

/** Registry hints become ordinary candidates; nothing from them is executed here. */
export function workbuddyWindowsRegistryCandidates(raw: string): string[] {
  let value: unknown
  try { value = JSON.parse(raw.trim()) } catch { return [] }
  const records = (value as { schema?: unknown; records?: unknown })?.schema === 1
    ? (value as { records: unknown }).records : undefined
  if (!Array.isArray(records)) return []
  const candidates: string[] = []
  for (const record of records.slice(0, 16)) {
    if (!record || typeof record !== 'object') continue
    const root = plainWindowsPath((record as { root?: unknown }).root)
    if (root) candidates.push(root)
    const icon = plainWindowsPath(typeof (record as { icon?: unknown }).icon === 'string'
      ? ((record as { icon: string }).icon).replace(/,\s*-?\d+\s*$/, '') : undefined)
    if (icon && /^WorkBuddy(?: AI)?\.exe$/i.test(win32.basename(icon))) candidates.push(icon)
  }
  return [...new Map(candidates.map(path => [path.toLowerCase(), path])).values()]
}

let registryCache: { at: number; candidates: string[] } | undefined
/** Short cache: status polls must not start PowerShell every time. */
export async function findWorkBuddyWindowsCandidates(
  capture: (argv: string[], cwd: string) => Promise<string>,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): Promise<string[]> {
  signal.throwIfAborted()
  if (registryCache && now - registryCache.at < 60_000) return registryCache.candidates
  const root = env.SystemRoot || env.WINDIR || 'C:\\Windows'
  if (!plainWindowsPath(root)) return []
  const command = win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const raw = await capture([command, '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(WORKBUDDY_WINDOWS_INSTALL_QUERY, 'utf16le').toString('base64')], homedir())
  signal.throwIfAborted()
  const candidates = workbuddyWindowsRegistryCandidates(raw)
  registryCache = { at: now, candidates }
  return candidates
}
/** Test hook only. */
export function resetWorkBuddyWindowsCandidateCache(): void { registryCache = undefined }
