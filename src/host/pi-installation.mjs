// One verified Pi package for the Host, account UI, native catalog and RPC entry.
// Resolve installation metadata only; never execute an arbitrary shell launcher.
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createRequire, isBuiltin } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { resolveNativeEntry } from './native-launch.mjs'

// Exact releases whose SDK/RPC contract has been reviewed. No implied SemVer range.
export const PI_SUPPORTED_VERSIONS = Object.freeze(['1.0.2', '1.0.4', '1.1.0', '1.5.2'])
export const isSupportedPiVersion = (version) => PI_SUPPORTED_VERSIONS.includes(version)
const validManagementVersion = version => typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
const failure = () =>
  Object.assign(
    new Error(`Pi 安装身份或原生接口不匹配；需要 Pi Coding Agent ${PI_SUPPORTED_VERSIONS.join('、')}，不能使用 OMP 入口`),
    { code: 'CLI_IDENTITY_MISMATCH' },
  )
function metadata(path) {
  const info = statSync(path)
  if (!info.isFile() || info.size > 128 * 1024) throw failure()
  return readFileSync(path, 'utf8')
}
// Exact official Windows managed launcher inspected from Pi 1.1.0. It is read as
// installation metadata, never evaluated. Unknown bootstrap code fails closed.
// 1.5.2's packaged managed updater retains the launcher and changes current-version;
// it does not ship a fresh Windows installer template. Do not guess another hash.
const managedWindowsLauncherSHA256 = '3d8b27bb3f5c07543303b0ee774ce215e4d6ae2b0ae43311c4acf51f517ffd13'
function windowsManagedEntry(launcher, accepts = isSupportedPiVersion) {
  const source = metadata(launcher).trim().replace(/\r\n/g, '\n')
  if (createHash('sha256').update(source).digest('hex') !== managedWindowsLauncherSHA256) throw failure()
  const install = join(dirname(dirname(launcher)), 'install')
  const version = metadata(join(install, 'current-version')).trim()
  if (!accepts(version)) throw failure()
  const directory = resolve(install, 'releases', version, 'node_modules/@earendil-works/pi-coding-agent')
  // A version pointer/package symlink must not select code outside this release.
  if (realpathSync(directory) !== directory) throw failure()
  const manifest = JSON.parse(metadata(join(directory, 'package.json')))
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.pi
  if (manifest.name !== '@earendil-works/pi-coding-agent' || manifest.version !== version ||
    !['dist/cli.js', 'dist/bundle/cli.js'].includes(bin)) throw failure()
  const entry = realpathSync(resolve(directory, bin))
  const inside = relative(directory, entry)
  if (!inside || inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) throw failure()
  return entry
}

export function inspectPiInstallation(entry, { allowUnsupported = false } = {}) {
  // Management can inspect a new release without granting Worker compatibility.
  const accepts = allowUnsupported ? validManagementVersion : isSupportedPiVersion
  try {
    let executable = realpathSync(entry)
    if (
      ['pi', 'pi.cmd', 'pi.bat'].includes(basename(executable).toLowerCase()) &&
      basename(dirname(executable)) === 'bin'
    ) {
      const launcher = metadata(executable)
      if (launcher.includes('PI_MANAGED_INSTALL_ROOT=') && launcher.includes('install/current-version')) {
        const install = join(dirname(dirname(executable)), 'install')
        const version = metadata(join(install, 'current-version')).trim()
        if (!accepts(version)) throw failure()
        executable = realpathSync(
          join(install, 'releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
        )
      }
    }
    executable = realpathSync(resolveNativeEntry(executable))
    if (basename(executable).toLowerCase() === 'pi-launcher.js' && basename(dirname(executable)) === 'bin')
      executable = windowsManagedEntry(executable, accepts)
    let directory = dirname(executable)
    for (let depth = 0; depth < 5; depth++, directory = dirname(directory)) {
      let manifest
      try {
        manifest = JSON.parse(metadata(join(directory, 'package.json')))
      } catch {
        continue
      }
      if (manifest.name !== '@earendil-works/pi-coding-agent' || !accepts(manifest.version))
        throw failure()
      const dist = join(directory, 'dist')
      if (![join(dist, 'cli.js'), join(dist, 'bundle/cli.js')].includes(executable)) throw failure()
      for (const relative of allowUnsupported ? [] : ['cli.js', 'index.js', 'core/model-runtime.js', 'core/auth-storage.js']) {
        if (!statSync(join(dist, relative)).isFile()) throw failure()
      }
      return {
        root: directory,
        dist,
        version: manifest.version,
        launchEntry: executable,
        executable: realpathSync(allowUnsupported && !isFile(join(dist, 'cli.js')) ? executable : join(dist, 'cli.js')),
      }
    }
  } catch {
    throw failure()
  }
  throw failure()
}

function isFile(path) {
  try { return statSync(path).isFile() } catch { return false }
}

// Only these bounded, constructed messages may cross a native error boundary.
const packageNamePattern = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i
export class PiInstallationIntegrityError extends Error {
  code = 'PI_INSTALLATION_INCOMPLETE'
  constructor(packageName) {
    const safe = typeof packageName === 'string' && packageName.length <= 214 && packageNamePattern.test(packageName)
      ? packageName : undefined
    super(safe ? `Pi 安装不完整（缺少依赖 ${safe}），请在「更新 CLI」中重新安装`
      : 'Pi 安装不完整（原生模块缺失或损坏），请在「更新 CLI」中重新安装')
    this.name = 'PiInstallationIntegrityError'
    this.packageName = safe
  }
}
export function piInstallationIntegrityMessage(error) {
  return error instanceof PiInstallationIntegrityError || error instanceof PiInstallationCheckUnavailableError ? error.message : undefined
}
export class PiInstallationCheckUnavailableError extends Error {
  code = 'PI_INSTALLATION_CHECK_UNAVAILABLE'
  constructor() {
    super('暂时无法核验 Pi 安装完整性，请稍后重试')
    this.name = 'PiInstallationCheckUnavailableError'
  }
}

const integrityCache = new Map()
const integrityTTL = 10_000
function stamp(path) {
  try { const s = statSync(path); return [s.size, s.mtimeMs, s.ctimeMs, s.ino] } catch { return null }
}

/** Parse and resolve the static import graph in an isolated Node process. No Pi
 * module is evaluated, linked or instantiated; no account/configuration is read.
 * The cache includes entry/core mtimes, has a short TTL for nested repairs, and
 * installation verification always bypasses it. Cancellation is never cached. */
export async function checkPiInstallationIntegrity(entry, { allowUnsupported = false, fresh = false, signal } = {}) {
  signal?.throwIfAborted()
  const installation = inspectPiInstallation(entry, { allowUnsupported: true })
  if (!allowUnsupported && !isSupportedPiVersion(installation.version)) throw failure()
  for (const path of new Set([installation.launchEntry, installation.executable])) {
    try {
      const info = statSync(path)
      if (!info.isFile() || !info.size) throw 0
      accessSync(path, constants.R_OK)
    } catch { throw new PiInstallationIntegrityError() }
  }
  const roots = ['core/model-runtime.js', 'core/auth-storage.js'].map(name => join(installation.dist, name))
  const key = JSON.stringify([installation.launchEntry, installation.executable,
    ...[installation.launchEntry, installation.executable, join(installation.root, 'package.json'), ...roots].map(stamp)])
  const cached = integrityCache.get(key)
  if (!fresh && cached && Date.now() - cached.at < integrityTTL) {
    if (cached.error) throw new PiInstallationIntegrityError(cached.packageName)
    return installation
  }
  const result = await new Promise((resolveResult, reject) => {
    // Only our own scanner runs. VM modules provide Node's parser, and the flag
    // enables Node's ESM resolver with the actual importing file as parent URL.
    execFile(process.execPath, ['--no-warnings', '--experimental-vm-modules', '--experimental-import-meta-resolve',
      join(dirname(fileURLToPath(import.meta.url)), 'pi-installation.mjs'), '--pi-integrity-check', installation.dist], {
      timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024, windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' }, signal,
    }, (error, stdout) => {
      if (signal?.aborted) { reject(signal.reason); return }
      if (error) { reject(new PiInstallationCheckUnavailableError()); return }
      try { resolveResult(JSON.parse(stdout)) } catch { reject(new PiInstallationCheckUnavailableError()) }
    })
  })
  signal?.throwIfAborted()
  if (result?.unavailable) throw new PiInstallationCheckUnavailableError()
  // Bound both successful and failed entries, including managed release switches.
  if (integrityCache.size >= 16) integrityCache.delete(integrityCache.keys().next().value)
  const error = result?.ok !== true
  integrityCache.set(key, { at: Date.now(), error, packageName: result?.packageName })
  if (error) throw new PiInstallationIntegrityError(result?.packageName)
  return installation
}

async function auditPiImportGraph(dist) {
  const { SourceTextModule, Script } = await import('node:vm')
  const visited = new Set(), manifests = new Map()
  const start = Date.now()
  let bytes = 0
  const read = (path, owner, manifest = false, nonEmpty = false) => {
    if (Date.now() - start > 3500 || visited.size > 4096) throw new PiInstallationCheckUnavailableError()
    let info, source
    try {
      info = statSync(path)
      if (!info.isFile() || (nonEmpty && !info.size)) throw 0
      if (info.size > (manifest ? 128 * 1024 : 8 * 1024 * 1024)) throw new PiInstallationCheckUnavailableError()
      bytes += info.size
      if (bytes > 64 * 1024 * 1024) throw new PiInstallationCheckUnavailableError()
      source = readFileSync(path, 'utf8')
    } catch (error) {
      if (error instanceof PiInstallationCheckUnavailableError) throw error
      throw new PiInstallationIntegrityError(owner)
    }
    return source
  }
  const manifest = (directory, owner) => {
    if (!manifests.has(directory)) {
      try { manifests.set(directory, JSON.parse(read(join(directory, 'package.json'), owner, true, true))) }
      catch (error) {
        if (error instanceof PiInstallationCheckUnavailableError) throw error
        throw new PiInstallationIntegrityError(owner)
      }
    }
    return manifests.get(directory)
  }
  const packageOwner = (specifier, parent) => {
    const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
    if (!packageNamePattern.test(name)) throw new PiInstallationIntegrityError()
    // Node permits a package's exported self-reference without node_modules.
    for (let directory = dirname(fileURLToPath(parent)); ; directory = dirname(directory)) {
      if (isFile(join(directory, 'package.json'))) {
        const value = manifest(directory, name)
        if (value.name === name && value.exports) return name
        break
      }
      if (directory === dirname(directory)) break
    }
    // Resolve package.json independently of exports: many healthy packages hide
    // it. Stop at the first actual package directory, including a truncated one.
    for (const base of createRequire(parent).resolve.paths(name) ?? []) {
      const directory = join(base, name)
      try { if (!statSync(directory).isDirectory()) continue } catch { continue }
      manifest(directory, name)
      return name
    }
    throw new PiInstallationIntegrityError(name)
  }
  const queue = ['core/model-runtime.js', 'core/auth-storage.js'].map(name => ({ url: pathToFileURL(join(dist, name)).href, entry: true }))
  for (let index = 0; index < queue.length; index++) {
    const { url, owner, entry } = queue[index]
    const path = fileURLToPath(url)
    if (visited.has(url)) {
      // A file first reached relatively may later be a package export entry.
      if (entry) read(path, owner, false, true)
      continue
    }
    visited.add(url)
    const source = read(path, owner, false, entry)
    if (/\.(?:json|node)$/i.test(path)) continue
    let requests
    try { requests = new SourceTextModule(source, { identifier: url }).dependencySpecifiers }
    catch {
      // CommonJS permits top-level return in Node's wrapper. Validate its entry
      // without evaluating it; it has no statically linked ESM import requests.
      try { new Script(`(function(exports,require,module,__filename,__dirname){\n${source.replace(/^#![^\n]*/, '')}\n})`); requests = [] }
      catch { throw new PiInstallationIntegrityError(owner) }
    }
    for (const specifier of requests) {
      if (isBuiltin(specifier)) continue
      const bare = !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('file:') && !specifier.startsWith('#')
      const nextOwner = bare ? packageOwner(specifier, url) : owner
      let next
      try { next = import.meta.resolve(specifier, url) } catch { throw new PiInstallationIntegrityError(nextOwner) }
      if (next.startsWith('node:')) continue
      if (!next.startsWith('file:')) throw new PiInstallationIntegrityError(nextOwner)
      queue.push({ url: next, owner: nextOwner, entry: bare })
      if (queue.length > 16384) throw new PiInstallationCheckUnavailableError()
    }
  }
}

if (process.argv[2] === '--pi-integrity-check' && process.argv[1] &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  auditPiImportGraph(process.argv[3]).then(() => {
    process.stdout.write(JSON.stringify({ ok: true }))
  }, error => {
    process.stdout.write(JSON.stringify({ ok: false, unavailable: error instanceof PiInstallationCheckUnavailableError,
      packageName: error instanceof PiInstallationIntegrityError ? error.packageName : undefined }))
  })
}
