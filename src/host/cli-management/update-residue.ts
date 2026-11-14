import { homedir, tmpdir, userInfo } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
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
async function record(path: string): Promise<any> {
  const value = await info(path)
  if (!value?.isFile() || value.isSymbolicLink() || value.nlink !== 1 || value.size > 1024 * 1024) return
  try { return JSON.parse(await fs.readFile(path, 'utf8')) } catch { return }
}
async function entries(root: string) {
  const value = await info(root)
  return value?.isDirectory() && !value.isSymbolicLink() ? fs.readdir(root) : []
}
/** Enumerate only evidenced names. Candidate links/junctions are always excluded. */
export async function nativeResidueCandidates(cli: ActiveCliId, location: ResidueLocation = {}): Promise<Candidate[]> {
  const home = location.home ?? homedir(), temp = location.temp ?? tmpdir(), win = (location.platform ?? process.platform) === 'win32'
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
  if (cli === 'grok') {
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
  } else if (cli === 'hermes') {
    const root = join(home,win ? 'AppData/Local/hermes' : '.hermes'), tools = join(root,'tools')
    if (!await cleanupPathSafe(root,join(tools,'facts.json'))) return result
    const facts = await record(join(tools,'facts.json')), packages = facts?.packages
    if (!packages || typeof packages !== 'object' || Array.isArray(packages)) return result
    const referenced = new Set<string>()
    for (const value of Object.values(packages) as any[]) {
      if (typeof value?.entry !== 'string' || basename(value.entry) !== value.entry) return result
      referenced.add(value.entry)
    }
    for (const name of ['node','python','uv','npm']) {
      const entry = packages[name]?.entry
      if (typeof entry !== 'string' || !new RegExp(`^${name}-\\d`).test(entry) || !(await info(join(tools,entry)))?.isDirectory()) continue
      await scan(root,tools,new RegExp(`^${name}-(\\d[\\w.+-]*)$`),'Hermes 工具旧版本',false,'directory')
    }
    for (const item of [...result]) if (referenced.has(basename(item.path))) result.splice(result.indexOf(item),1)
    await scan(root,join(root,'bin'),/^hermes\.exe\.deleteme$/, 'Hermes 启动备份',true,'file')
  }
  return result
}
export interface NativeCleanupProof { identity: InstallationIdentity; version: string; runnable: boolean }
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

async function currentIdentityInKnownRoot(cli: ActiveCliId, identity: InstallationIdentity) {
  const home = homedir(), path = identity.fingerprint.realpath
  const roots = cli === 'grok' ? [join(home,'.grok')] : cli === 'qoder' ? [join(home,'.qoder')] : cli === 'qodercn' ? [join(home,'.qoder-cn')] : cli === 'claude' ? [join(home,'.local/share/claude'),join(home,'.local/bin/claude.exe')] : cli === 'traecn' ? [join(home,'.local/share/traecli'),join(home,'AppData/Local/TraeCLI')] : [join(home,'.hermes'),join(home,'AppData/Local/hermes')]
  return roots.some(root => path === root || path.startsWith(root + sep))
}
export async function registerNativeResidueCleanup(options: { cli: ActiveCliId; backend: ProcessBackend; config: RuntimeConfig; success(): boolean; identify?: typeof identifyInstallation; version?: typeof currentVersion }) {
  if (!['grok','qoder','qodercn','claude','hermes','traecn'].includes(options.cli)) return
  let before: Set<string>
  try { before = new Set((await nativeResidueCandidates(options.cli)).map(item => item.path)) } catch { return }
  afterUpdateCleanup(async () => {
    if (!(await nativeResidueCandidates(options.cli)).length) return
    const signal = AbortSignal.timeout(15_000)
    let proof: NativeCleanupProof | undefined
    try {
      const identity = await (options.identify ?? identifyInstallation)(options.cli,options.backend,options.config,signal)
      // Hermes explicitly forbids command probing in sources.ts; a static stamp cannot authorize deletion.
      const known = identity && await currentIdentityInKnownRoot(options.cli, identity)
      if (known && identity && identity.source !== 'npm' && options.cli !== 'hermes') {
        const value = await (options.version ?? currentVersion)(options.cli,{...identity,manifestVersion:undefined},options.backend,options.config,signal,false,5000)
        if (value) proof = {identity,version:value,runnable:true}
      }
    } catch (error) { if (error instanceof ProcessCleanupUnconfirmedError) throw error }
    await cleanNativeResidues(options.cli,before,options.success(),proof)
  })
}
