import { createHash } from 'node:crypto'
import * as nodeFs from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep, win32 } from 'node:path'
import { WindowsCliInstallationError } from './windows-cli-installation.ts'

// Verified official @openai/codex bin/codex.js wrappers: 0.162.1, and 0.166.0,
// whose Windows path (binary lookup, manager flags, async spawn) is unchanged.
// A package name/version alone does not establish a launcher's environment semantics.
const supportedWrappers = new Set([
  '61b0194f3bb6534439c8d26a3ed57d0805f84b884588b761795323eeb92fcf70',
  'e14fc83739c13c1074b12bd1acce4010c893c7f6fbfc1593b4a31d74cabb57af',
])
const packageName = '@openai/codex'
const managerFlags = ['CODEX_MANAGED_BY_NPM', 'CODEX_MANAGED_BY_BUN', 'CODEX_MANAGED_BY_PNPM', 'CODEX_MANAGED_BY_VITE_PLUS'] as const
type Manager = 'NPM' | 'BUN' | 'PNPM' | 'VITE_PLUS'
type RecordValue = Record<string, unknown>
export interface WindowsCodexLaunch {
  argv: string[]
  env: NodeJS.ProcessEnv
}

let physicalFiles: typeof nodeFs | undefined
function files(): typeof nodeFs {
  return physicalFiles ??= process.versions.electron
    ? createRequire(import.meta.url)('original-fs') as typeof nodeFs
    : nodeFs
}
const unavailable = () => new WindowsCliInstallationError('Codex npm 原生入口不可用，请检查安装', true)
const equal = (left: string, right: string) => win32.normalize(left).toLowerCase() === win32.normalize(right).toLowerCase()
const record = (value: unknown): RecordValue | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined

function boundedFile(path: string): Buffer {
  const fs = files(), descriptor = fs.openSync(path, 'r')
  try {
    const before = fs.fstatSync(descriptor)
    if (!before.isFile() || before.size > 128 * 1024) throw unavailable()
    const data = Buffer.alloc(before.size + 1)
    const length = fs.readSync(descriptor, data, 0, data.length, 0)
    const after = fs.fstatSync(descriptor)
    if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw unavailable()
    return data.subarray(0, length)
  } finally {
    fs.closeSync(descriptor)
  }
}
function json(path: string): RecordValue {
  const value = record(JSON.parse(boundedFile(path).toString('utf8')))
  if (!value) throw unavailable()
  return value
}
function contained(root: string, path: string): string {
  const canonical = files().realpathSync(path), inside = relative(root, canonical)
  if (!inside || inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) throw unavailable()
  return canonical
}
function manifest(root: string): RecordValue {
  return json(contained(root, join(root, 'package.json')))
}

function nativeExecutable(root: string, triple: string, arch: 'x64' | 'arm64'): string {
  const path = contained(root, join(root, 'vendor', triple, 'bin', 'codex.exe'))
  const fs = files(), descriptor = fs.openSync(path, 'r')
  try {
    const before = fs.fstatSync(descriptor), dos = Buffer.alloc(64), header = Buffer.alloc(24)
    if (!before.isFile() || fs.readSync(descriptor, dos, 0, 64, 0) !== 64 || dos.toString('ascii', 0, 2) !== 'MZ')
      throw unavailable()
    const offset = dos.readUInt32LE(0x3c)
    if (offset < 64 || offset + 24 > before.size || fs.readSync(descriptor, header, 0, 24, offset) !== 24 ||
        header.toString('hex', 0, 4) !== '50450000' || header.readUInt16LE(4) !== (arch === 'x64' ? 0x8664 : 0xaa64) ||
        !(header.readUInt16LE(22) & 0x0002) || (header.readUInt16LE(22) & 0x2000)) throw unavailable()
    const optionalSize = header.readUInt16LE(20), optional = Buffer.alloc(112)
    if (optionalSize < optional.length || offset + 24 + optionalSize > before.size ||
        fs.readSync(descriptor, optional, 0, optional.length, offset + 24) !== optional.length ||
        optional.readUInt16LE(0) !== 0x20b || optional.readUInt16LE(68) !== 3) throw unavailable()
    const after = fs.fstatSync(descriptor)
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw unavailable()
    return path
  } finally {
    fs.closeSync(descriptor)
  }
}

// Match the verified wrapper's ownership checks, including pnpm's linked store.
// Metadata is read only to decide its native update hint; it never supplies argv.
function pnpmOwned(nodeModules: string, root: string): boolean {
  try {
    return files().existsSync(join(nodeModules, '.modules.yaml')) &&
      equal(files().realpathSync(join(nodeModules, '@openai', 'codex')), root)
  } catch { return false }
}
function viteOwned(packages: string, root: string): boolean {
  if (basename(packages) !== 'packages') return false
  try {
    const data = json(join(packages, '@openai', 'codex.json'))
    if (data.name !== packageName) return false
    const id = data.installId || ''
    if (typeof id !== 'string') return false
    const install = id.startsWith('#') ? join(packages, `@openai/codex${id}`) : join(packages, '@openai/codex', id)
    return [join(install, 'lib', 'node_modules'), join(install, 'node_modules')].some(directory => {
      try { return equal(files().realpathSync(join(directory, '@openai', 'codex')), root) }
      catch { return false }
    })
  } catch { return false }
}
function environmentValue(name: string, extra?: NodeJS.ProcessEnv): string | undefined {
  let value: string | undefined
  for (const source of [process.env, extra ?? {}])
    for (const [key, candidate] of Object.entries(source))
      if (key.toUpperCase() === name.toUpperCase()) value = candidate
  return value
}
function packageManager(root: string, entry: string, env?: NodeJS.ProcessEnv): Manager {
  for (const start of new Set([root, dirname(resolve(entry))])) {
    const filesystemRoot = parse(start).root
    for (let current = start; current !== filesystemRoot; current = dirname(current)) {
      if (viteOwned(current, root)) return 'VITE_PLUS'
      if (pnpmOwned(join(current, 'node_modules'), root)) return 'PNPM'
    }
    if (pnpmOwned(join(filesystemRoot, 'node_modules'), root)) return 'PNPM'
  }
  if (/\bbun\//.test(environmentValue('npm_config_user_agent', env) ?? '') ||
      (environmentValue('npm_execpath', env) ?? '').includes('bun') ||
      dirname(entry).includes('.bun/install/global') || dirname(entry).includes('.bun\\install\\global')) return 'BUN'
  return 'NPM'
}

/** A background-only optimization. It never changes the saved installation entry or the caller's env. */
export function windowsCodexBackgroundLaunch(
  argv: readonly string[],
  env?: NodeJS.ProcessEnv,
  options: { platform?: NodeJS.Platform; arch?: string } = {},
): WindowsCodexLaunch | undefined {
  if ((options.platform ?? process.platform) !== 'win32' || !argv[0] || !equal(argv[0], process.execPath) ||
      !argv[1] || !isAbsolute(argv[1]) || basename(argv[1]).toLowerCase() !== 'codex.js') return undefined
  let source: Buffer
  try { source = boundedFile(argv[1]) } catch { return undefined }
  // Unknown wrappers preserve their existing launch behavior. In particular, do
  // not guess an older vendor layout or inject a historical PATH directory.
  if (!supportedWrappers.has(createHash('sha256').update(source).digest('hex'))) return undefined
  try {
    const arch = options.arch ?? process.arch
    if (arch !== 'x64' && arch !== 'arm64') throw unavailable()
    const root = files().realpathSync(resolve(dirname(argv[1]), '..'))
    const entry = contained(root, argv[1]), data = manifest(root)
    const bin = typeof data.bin === 'string' ? data.bin : record(data.bin)?.codex
    if (data.name !== packageName || bin !== 'bin/codex.js' ||
        !equal(entry, contained(root, resolve(root, bin))) ||
        typeof data.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(data.version)) throw unavailable()
    const requestedPackage = `${packageName}-win32-${arch}`, platformVersion = `${data.version}-win32-${arch}`
    if (record(data.optionalDependencies)?.[requestedPackage] !== `npm:${packageName}@${platformVersion}`) throw unavailable()
    const require = createRequire(entry)
    let platformManifest: string | undefined
    try { platformManifest = require.resolve(`${requestedPackage}/package.json`) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw unavailable()
      // A present but incomplete optional package is a broken installation, not
      // permission to silently substitute the main package's vendor copy.
      for (const directory of require.resolve.paths(requestedPackage) ?? []) {
        try { files().lstatSync(join(directory, requestedPackage)); throw unavailable() }
        catch (candidateError) {
          if (!['ENOENT', 'ENOTDIR'].includes((candidateError as NodeJS.ErrnoException).code ?? '')) throw unavailable()
        }
      }
    }
    let nativeRoot = root
    if (platformManifest) {
      nativeRoot = files().realpathSync(dirname(platformManifest))
      const platformData = manifest(nativeRoot)
      if (platformData.name !== packageName || platformData.version !== platformVersion ||
          !Array.isArray(platformData.os) || platformData.os.length !== 1 || platformData.os[0] !== 'win32' ||
          !Array.isArray(platformData.cpu) || platformData.cpu.length !== 1 || platformData.cpu[0] !== arch) throw unavailable()
    }
    const triple = arch === 'x64' ? 'x86_64-pc-windows-msvc' : 'aarch64-pc-windows-msvc'
    const executable = nativeExecutable(nativeRoot, triple, arch)
    const next = { ...env }
    for (const key of Object.keys(next))
      if ([...managerFlags, 'CODEX_MANAGED_PACKAGE_ROOT'].includes(key.toUpperCase())) delete next[key]
    for (const flag of managerFlags) next[flag] = undefined
    next[`CODEX_MANAGED_BY_${packageManager(root, argv[1], env)}`] = '1'
    next.CODEX_MANAGED_PACKAGE_ROOT = root
    return { argv: [executable, ...argv.slice(2)], env: next }
  } catch {
    // No native diagnostic, package content, or arbitrary path crosses the UI.
    throw unavailable()
  }
}
