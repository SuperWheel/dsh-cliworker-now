import { homedir, tmpdir, userInfo } from 'node:os'
import { pidAlive } from './hermes-observation.ts'
import { safeObservation } from './artifacts/observations.ts'
import { basename, dirname, join, resolve, sep, posix, win32 } from 'node:path'
import { physicalFs } from './physical-fs.ts'
import { captureReadOnly, currentVersion, validVersion } from './versions.ts'
import { identifyInstallation, type InstallationIdentity } from './identity.ts'
import type { ActiveCliId } from '../../shared/types.ts'
import type { ProcessBackend, RuntimeConfig } from '../process.ts'
import { ProcessCleanupUnconfirmedError } from '../process.ts'
import { afterUpdateCleanup, cleanupNote, cleanupPathSafe, removeUpdateTemporary } from './update-cleanup.ts'

const fs = physicalFs().promises
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const version = '\\d+\\.\\d+\\.\\d+(?:-[A-Za-z0-9.-]+)?'
interface Candidate { path: string; root: string; label: string; version?: string; backup?: boolean }
export interface ResidueLocation { home?: string; temp?: string; platform?: NodeJS.Platform; username?: string }
const info = (path: string) => fs.lstat(path).catch(() => undefined)
async function entries(root: string) {
  const value = await info(root)
  return value?.isDirectory() && !value.isSymbolicLink() ? fs.readdir(root) : []
}
/** Enumerate only evidenced names. Candidate links/junctions are always excluded. */
export async function nativeResidueCandidates(cli: ActiveCliId, location: ResidueLocation = {}): Promise<Candidate[]> {
  const home = location.home ?? homedir(), temp = location.temp ?? tmpdir(), platform = location.platform ?? process.platform, win = platform === 'win32'
  const result: Candidate[] = []
  const scan = async (boundary: string, directory: string, pattern: RegExp, label: string, backup = false, kind: 'file' | 'directory' | 'either' = 'either') => {
    if (!await cleanupPathSafe(boundary, join(directory, '_candidate'))) return
    for (const name of await entries(directory)) {
      const match = pattern.exec(name)
      if (!match) continue
      const path = join(directory, name), value = await info(path)
      if (!value || value.isSymbolicLink() || !(value.isDirectory() || value.isFile()) || value.isFile() && value.nlink !== 1) continue
      if (kind === 'file' && !value.isFile() || kind === 'directory' && !value.isDirectory()) continue
      result.push({ path, root: boundary, label, version: match[1], backup })
    }
  }
  if (cli === 'omp' && (win || platform === 'darwin')) {
    const root = join(home,win ? 'AppData/Local/omp' : '.local/bin')
    await scan(root,root,win ? /^omp\.exe\.\d+\.\d+\.\d+\.bak$/i : /^omp\.\d+\.\d+\.\d+\.bak$/,'OMP 原生备份',true,'file')
  } else if (cli === 'grok') {
    const root = join(home, '.grok')
    await scan(root, join(root,'downloads'), new RegExp(`^grok(?:-(${version}))?(?:-(?:macos|windows|linux)-(?:aarch64|x86_64))?(?:\\.exe)?$`), 'Grok 下载副本')
    await scan(root,join(root,'bin'),/^grok(?:\.exe)?\.old$/, 'Grok 备份',true,'file')
  } else if (cli === 'qoder' || cli === 'qodercn') {
    const root = join(home,cli === 'qoder' ? '.qoder' : '.qoder-cn'), bin = cli === 'qoder' ? 'qodercli' : 'qoderclicn'
    await scan(root,join(root,'bin',bin),new RegExp(`^${bin}-(${version})(?:\\.exe)?$`),'Qoder 旧版本',false,'file')
    if (cli === 'qoder') await scan(temp,temp,new RegExp(`^qodercli-natives-v(${version})-${escape(location.username ?? userInfo().username)}$`),'Qoder native 缓存',false,'directory')
  } else if (cli === 'claude') {
    await scan(join(home,'.local/share/claude'),join(home,'.local/share/claude/versions'),new RegExp(`^(${version})$`),'Claude 旧版本',false,'file')
  } else if (cli === 'traecn') {
    const root = join(home,win ? 'AppData/Local/TraeCLI' : '.local/share/traecli')
    // The lease format/liveness contract is not established in this repo.
    if ((await entries(root)).some(n => n.startsWith('.traex-release-lease.'))) { cleanupNote('TRAE lease 无法核实，保留原生版本'); return result }
    await scan(root,join(root,'releases'),new RegExp(`^(${version})$`),'TRAE 旧版本',false,'directory')
    for (const item of [...result]) if ((await entries(item.path)).some(n => n.startsWith('.traex-release-lease.'))) result.splice(result.indexOf(item),1)
  }
  return result
}
export interface NativeCleanupProof { identity: InstallationIdentity; version: string; runnable: boolean; targetVersion?: string }

/** Windows and macOS self-update layouts are evidenced; Linux naming is unverified and stays disabled. */
async function ompCurrentEntry(identity: InstallationIdentity, location: ResidueLocation): Promise<string | undefined> {
  const platform = location.platform ?? process.platform, win = platform === 'win32'
  if ((!win && platform !== 'darwin') || identity.source !== 'self-update') return
  const home = location.home ?? homedir(), current = identity.fingerprint.realpath
  const expected = join(home,win ? 'AppData/Local/omp/omp.exe' : '.local/bin/omp')
  if ((win ? current.toLowerCase() !== expected.toLowerCase() : current !== expected) || !await cleanupPathSafe(home,current)) return
  const stat = await info(current)
  return stat?.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 ? current : undefined
}
async function cleanOmpResidues(success: boolean, proof: NativeCleanupProof | undefined, location: ResidueLocation) {
  if (!success) return
  if (!proof?.runnable || !validVersion(proof.targetVersion) || proof.version !== proof.targetVersion) {
    cleanupNote('OMP 目标版本未核验，保留原生备份'); return
  }
  const current = await ompCurrentEntry(proof.identity,location)
  if (!current) { cleanupNote('OMP 当前入口未核验，保留原生备份'); return }
  const root = dirname(current), pattern = new RegExp(`^${escape(basename(current))}\\.\\d+\\.\\d+\\.\\d+\\.bak$`, (location.platform ?? process.platform) === 'win32' ? 'i' : '')
  for (const name of await entries(root)) {
    if (!pattern.test(name)) continue
    const path = join(root,name), stat = await info(path)
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !await cleanupPathSafe(root,path)) continue
    await removeUpdateTemporary(path,'OMP 原生备份')
  }
}
/** Current records must match the actual fresh probe; the manifest alone is not proof. */
async function currentNativePath(cli: ActiveCliId, proof: NativeCleanupProof, location: ResidueLocation): Promise<string | undefined> {
  if (!proof.runnable || !validVersion(proof.version)) return
  const home = location.home ?? homedir(), win = (location.platform ?? process.platform) === 'win32'
  const root = cli === 'grok' ? join(home,'.grok') : cli === 'qoder' ? join(home,'.qoder') : cli === 'qodercn' ? join(home,'.qoder-cn') : cli === 'claude' ? join(home,'.local/share/claude') : cli === 'traecn' ? join(home,win ? 'AppData/Local/TraeCLI' : '.local/share/traecli') : join(home,win ? 'AppData/Local/hermes' : '.hermes')
  const canonical = proof.identity.fingerprint.realpath
  let current = canonical
  if (cli === 'traecn') {
    // This is the sole directory link we resolve: the installer's current pointer.
    if (!await cleanupPathSafe(root,join(root,'current'))) return
    const pointer = await info(join(root,'current'))
    if (!pointer?.isSymbolicLink()) return
    current = await fs.realpath(join(root,'current')).catch(() => '')
    if (current !== join(root,'releases',proof.version)) return
    if (canonical !== current && !canonical.startsWith(current + sep)) return
  } else if (cli === 'qoder' || cli === 'qodercn') {
    const bin = cli === 'qoder' ? 'qodercli' : 'qoderclicn', store = join(root,'bin',bin), stamp = join(store,'version.txt')
    if (!await cleanupPathSafe(root,stamp)) return
    const value = await info(stamp)
    if (!value?.isFile() || value.isSymbolicLink() || value.size > 128 || (await fs.readFile(stamp,'utf8')).trim() !== proof.version) return
    current = join(store,`${bin}-${proof.version}${win ? '.exe' : ''}`)
  } else if (cli === 'claude') current = join(root,'versions',proof.version)
  const within = (path: string) => path === root || path.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))
  // Windows native Claude uses a copy in .local/bin, with the version store as evidence.
  const claudeCopy = cli === 'claude' && win && canonical === join(home,'.local/bin/claude.exe')
  if (!within(canonical) && !claudeCopy || !within(current) || !await cleanupPathSafe(root,current)) return
  const value = await info(current)
  if (!value || value.isSymbolicLink()) return
  return current
}
export async function cleanNativeResidues(cli: ActiveCliId, before: Set<string>, success: boolean, proof: NativeCleanupProof | undefined, location: ResidueLocation = {}) {
  if (cli === 'omp') return cleanOmpResidues(success,proof,location)
  if (cli === 'hermes') return // Hermes requires the update receipt and post-update verification, never a command probe.
  if (!proof) { cleanupNote('当前入口未核验，保留原生副本'); return }
  const current = await currentNativePath(cli,proof,location)
  if (!current) { cleanupNote('当前版本记录不匹配，保留原生副本'); return }
  for (const item of await nativeResidueCandidates(cli,location)) {
    if (item.path === current || item.path === proof.identity.fingerprint.realpath || proof.identity.fingerprint.realpath.startsWith(item.path + sep) || item.version === proof.version || !success && (before.has(item.path) || item.backup)) continue
    if (!await cleanupPathSafe(item.root,item.path)) continue
    const value = await info(item.path)
    if (!value || value.isSymbolicLink()) continue
    await removeUpdateTemporary(item.path,item.label)
  }
}

/** Conservative: any npm process, including one with an implicit prefix, prevents deletion. */
export async function npmPrefixIdle(backend: ProcessBackend, config: RuntimeConfig, platform = process.platform): Promise<boolean> {
  try {
    const argv = platform === 'win32' ? ['powershell.exe','-NoProfile','-NonInteractive','-Command', '$ErrorActionPreference = "Stop"; Get-CimInstance Win32_Process -Filter "Name=\'node.exe\' OR Name=\'npm.exe\' OR Name=\'bun.exe\'" | ForEach-Object { if (-not $_.CommandLine) { throw "Process command line unavailable" }; $_.CommandLine }'] : ['/bin/ps','-axo','command=']
    const raw = await captureReadOnly(backend,config,argv,AbortSignal.timeout(5000))
    return !raw.split(/\r?\n/).some(line => /(?:npm-cli\.[cm]?js|(?:^|[\\/\s])npm(?:\.cmd|\.exe)?(?:\s|$))/i.test(line))
  } catch (error) { if (error instanceof ProcessCleanupUnconfirmedError) throw error; return false }
}
export async function cleanNpmResidues(options: { prefix: string; packageName: string; bins: string[]; idle(): Promise<boolean>; platform?: NodeJS.Platform }) {
  if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_][a-z0-9_.-]*$/i.test(options.packageName)) { cleanupNote('npm 前缀忙或无法核实，保留 reify 残留'); return }
  const win = (options.platform ?? process.platform) === 'win32', root = resolve(options.prefix)
  const modules = join(root,win ? 'node_modules' : 'lib/node_modules'), parts = options.packageName.split('/'), name = parts.pop()!, parent = join(modules,...parts)
  const scan = async (directory: string, pattern: RegExp, directoryOnly: boolean) => {
    if (!await cleanupPathSafe(root,join(directory,'_candidate'))) return
    for (const name of await entries(directory)) {
      if (!pattern.test(name)) continue
      const path = join(directory,name), value = await info(path)
      if (!value || value.isSymbolicLink() || (directoryOnly ? !value.isDirectory() : !value.isFile() || value.nlink !== 1)) continue
      if (!await options.idle()) { cleanupNote('npm 前缀忙或无法核实，保留 reify 残留'); return }
      await removeUpdateTemporary(path,'npm reify 残留')
    }
  }
  await scan(parent,new RegExp(`^\\.${escape(name)}-[A-Za-z0-9]{8}$`),true)
  for (const bin of options.bins) if (/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(bin))
    await scan(join(root,win ? '' : 'bin'),new RegExp(`^\\.${escape(bin)}(?:\\.cmd|\\.ps1)?-[A-Za-z0-9]{8}$`),false)
}

async function currentIdentityInKnownRoot(cli: ActiveCliId, identity: InstallationIdentity, location: ResidueLocation = {}) {
  if (cli === 'omp') return !!await ompCurrentEntry(identity,location)
  const home = location.home ?? homedir(), path = identity.fingerprint.realpath
  const roots = cli === 'grok' ? [join(home,'.grok')] : cli === 'qoder' ? [join(home,'.qoder')] : cli === 'qodercn' ? [join(home,'.qoder-cn')] : cli === 'claude' ? [join(home,'.local/share/claude'),join(home,'.local/bin/claude.exe')] : cli === 'traecn' ? [join(home,'.local/share/traecli'),join(home,'AppData/Local/TraeCLI')] : [join(home,'.hermes'),join(home,'AppData/Local/hermes')]
  return roots.some(root => path === root || path.startsWith(root + sep))
}
export async function registerNativeResidueCleanup(options: { cli: ActiveCliId; backend: ProcessBackend; config: RuntimeConfig; success(): boolean; targetVersion?: string; identify?: typeof identifyInstallation; version?: typeof currentVersion; location?: ResidueLocation }) {
  if (!['omp','grok','qoder','qodercn','claude','traecn'].includes(options.cli)) return
  let before: Set<string>
  try { before = new Set((await nativeResidueCandidates(options.cli,options.location)).map(item => item.path)) } catch { return }
  afterUpdateCleanup(async () => {
    if (options.cli === 'omp' && !options.success()) return
    if (!(await nativeResidueCandidates(options.cli,options.location)).length) return
    const signal = AbortSignal.timeout(15_000)
    let proof: NativeCleanupProof | undefined
    try {
      const identity = await (options.identify ?? identifyInstallation)(options.cli,options.backend,options.config,signal)
      const known = identity && await currentIdentityInKnownRoot(options.cli, identity, options.location)
      if (known && identity && identity.source !== 'npm') {
        const value = await (options.version ?? currentVersion)(options.cli,{...identity,manifestVersion:undefined},options.backend,options.config,signal,false,5000)
        if (value) proof = {identity,version:value,runnable:true,targetVersion:options.targetVersion}
      }
    } catch (error) { if (error instanceof ProcessCleanupUnconfirmedError) throw error }
    await cleanNativeResidues(options.cli,before,options.success(),proof,options.location)
  })
}

/** Hermes permits no command version probe. Only the service's post-update evidence admits cleanup. */
export interface HermesCleanupProof {
  success: boolean
  receiptSucceeded: boolean
  targetVersion: string
  verifiedVersion?: string
}
const hermesStoreName = /^[a-z][a-z0-9_-]*-\d+(?:\.\d+)*(?:[+.-][A-Za-z0-9][A-Za-z0-9.+-]*)?-(?:darwin|linux|win32)-(?:x64|arm64)$/i
const entryName = /^[A-Za-z0-9][A-Za-z0-9_.+-]*$/
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
async function hermesFacts(home: string): Promise<{ entries: Set<string>; stamp: string } | undefined> {
  const tools = join(home,'tools'), path = join(tools,'facts.json')
  if (!await cleanupPathSafe(home,path)) return
  const data = await safeObservation(path,1024 * 1024)
  if (!data) return
  try {
    const facts: unknown = JSON.parse(data.text)
    if (!object(facts) || !object(facts.packages) || !Object.keys(facts.packages).length) return
    const entries = new Set<string>()
    for (const value of Object.values(facts.packages)) {
      if (!object(value) || typeof value.entry !== 'string' || !entryName.test(value.entry)) return
      const stat = await fs.lstat(join(tools,value.entry))
      if (!stat.isDirectory() || stat.isSymbolicLink()) return
      // Windows/macOS may resolve a differently cased entry to the same directory.
      // Conservatively protect case variants on every platform.
      entries.add(value.entry.toLowerCase())
    }
    return {entries,stamp:data.stamp + ':' + data.text}
  } catch { return }
}
type HermesLockState = 'stale' | 'active' | 'unknown'
/** Only executable paths, never process names or command-line substrings, prove an installation owner. */
// Hermes install/update locks are held by its launcher or Python runtime (hermes-native-entry.py,
// `hermes update`). An unreadable path only matters for such images: Windows shows 16 system
// processes (svchost, csrss, …) without ExecutablePath and macOS reports bare names (ssh, node).
const lockHostName = (name: string) => /^(?:hermes|python|pythonw|uv|uvx)(?:[\d.]*)(?:\.exe)?$/i.test(name.trim())
export async function hermesProcessState(home: string, checkout: string, backend: ProcessBackend, config: RuntimeConfig, platform: NodeJS.Platform = process.platform): Promise<HermesLockState> {
  const paths = platform === 'win32' ? win32 : posix
  const normalize = (p: string) => platform === 'win32' ? win32.normalize(p.replace(/^\\\\\?\\/, '')).toLowerCase() : posix.normalize(p)
  const roots = [home,checkout].map(normalize)
  if (!roots.every(root => paths.isAbsolute(root))) return 'unknown'
  const owned = (p: string) => roots.some(root => { const relative = paths.relative(root,normalize(p)); return relative === '' || relative !== '..' && !relative.startsWith('..' + paths.sep) && !paths.isAbsolute(relative) })
  try {
    const argv = platform === 'win32'
      ? ['powershell.exe','-NoProfile','-NonInteractive','-Command','$ErrorActionPreference = "Stop"; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); @(Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath) | ConvertTo-Json -Compress']
      : ['/bin/ps','-axww','-o','pid=,stat=,comm=']
    const raw = await captureReadOnly(backend,config,argv,AbortSignal.timeout(5000))
    let unknown = false
    if (platform === 'win32') {
      const rows: unknown = JSON.parse(raw.replace(/^\uFEFF/,''))
      if (!Array.isArray(rows)) return 'unknown'
      for (const row of rows) {
        if (!object(row) || !Number.isSafeInteger(row.ProcessId) || (row.ProcessId as number) < 0) return 'unknown'
        // Windows Idle/System are kernel processes, not user executables holding a Hermes install lock.
        if (row.ProcessId === 0 || row.ProcessId === 4) continue
        if (typeof row.ExecutablePath !== 'string' || !win32.isAbsolute(row.ExecutablePath)) { if (lockHostName(typeof row.Name === 'string' ? row.Name : '')) unknown = true; continue }
        if (owned(row.ExecutablePath)) return 'active'
      }
    } else {
      if (!raw.trim()) return 'unknown'
      for (const line of raw.trim().split(/\r?\n/)) {
        const row = /^\s*(\d+)\s+(\S+)\s+(.+)$/.exec(line)
        if (!row) return 'unknown'
        if (row[2]!.startsWith('Z') || row[1] === '0') continue
        let executable = row[3]!.trim()
        if (platform === 'linux') {
          try { executable = await fs.readlink(`/proc/${row[1]}/exe`) }
          catch (error) { if (['ENOENT','ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) continue; unknown = true; continue }
        }
        if (!posix.isAbsolute(executable)) { if (lockHostName(posix.basename(executable))) unknown = true; continue }
        if (owned(executable)) return 'active'
      }
    }
    return unknown ? 'unknown' : 'stale'
  } catch (error) { if (error instanceof ProcessCleanupUnconfirmedError) throw error; return 'unknown' }
}
/** PID locks retain tri-state evidence. Readable PID-less locks fall back to a fresh process snapshot. */
export async function hermesResidueLockState(home: string, inspect?: () => Promise<HermesLockState>): Promise<HermesLockState> {
  if (!await cleanupPathSafe(home,join(home,'tools','_candidate'))) return 'unknown'
  try {
    const paths = (await fs.readdir(home)).filter(name => name.startsWith('.hermes-update-in-progress')).map(name=>join(home,name))
    paths.push(join(home,'tools/.install.lock'))
    let state: 'stale' | 'unknown' = 'stale', needsProcesses = false
    for (const path of paths) {
      const stat = await fs.lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error })
      if (!stat) continue
      if (!stat.isFile() || stat.isSymbolicLink()) { state = 'unknown'; continue }
      const data = await safeObservation(path,4096)
      if (!data) { state = 'unknown'; continue }
      let record: unknown
      try { record = JSON.parse(data.text) } catch { /* PID-less formats use process evidence below. */ }
      const owners = object(record) ? ['pid','writer_pid'].filter(key => key in record).map(key => pidAlive(record[key])) : []
      if (owners.includes(true)) return 'active'
      if (!owners.length) needsProcesses = true
      else if (owners.some(value => value !== false)) state = 'unknown'
    }
    if (state === 'unknown') return state
    return needsProcesses ? await inspect?.() ?? 'unknown' : state
  } catch (error) { if (error instanceof ProcessCleanupUnconfirmedError) throw error; return 'unknown' }
}
export async function cleanHermesResidues(home: string, proof: HermesCleanupProof, inspect?: () => Promise<HermesLockState>): Promise<void> {
  if (!proof.success || !proof.receiptSucceeded || !validVersion(proof.targetVersion) || proof.verifiedVersion !== proof.targetVersion) {
    cleanupNote('Hermes 更新成功回执或目标版本未核验，保留原生残留'); return
  }
  const facts = await hermesFacts(home)
  if (!facts) { cleanupNote('Hermes facts 无效或引用目录不完整，保留原生残留'); return }
  const ready = async () => {
    const lock = await hermesResidueLockState(home,inspect)
    if (lock !== 'stale') { cleanupNote(lock === 'active' ? 'Hermes 锁 owner 或安装目录内进程仍存活，保留原生残留' : 'Hermes 锁 PID 或进程枚举无法核实，保留原生残留'); return false }
    if ((await hermesFacts(home))?.stamp !== facts.stamp) { cleanupNote('Hermes facts 或引用目录已变化，停止清理'); return false }
    return true
  }
  if (!await ready()) return
  for (const [directory, directoryOnly, label] of [[join(home,'bin'),false,'Hermes 删除标记'],[join(home,'tools'),true,'Hermes 工具旧版本']] as const) {
    if (!await cleanupPathSafe(home,join(directory,'_candidate'))) continue
    for (const name of await entries(directory)) {
      if (directoryOnly ? !hermesStoreName.test(name) || facts.entries.has(name.toLowerCase()) : name.startsWith('.') || !name.endsWith('.deleteme')) continue
      const path = join(directory,name), stat = await fs.lstat(path).catch(() => undefined)
      if (!stat || stat.isSymbolicLink() || (directoryOnly ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) continue
      if (!await ready() || !await cleanupPathSafe(home,path)) return
      await removeUpdateTemporary(path,label)
    }
  }
}
