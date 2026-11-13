// One verified Pi package for the Host, account UI, native catalog and RPC entry.
// Resolve installation metadata only; never execute an arbitrary shell launcher.
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { resolveNativeEntry } from './native-launch.mjs'

export const PI_SUPPORTED_VERSIONS = Object.freeze(['1.0.2', '1.0.4', '1.1.0'])
export const isSupportedPiVersion = version => PI_SUPPORTED_VERSIONS.includes(version)
const validManagementVersion = version => typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
const failure = () =>
  Object.assign(
    new Error('Pi 安装身份或原生接口不匹配；需要 Pi Coding Agent 1.0.2、1.0.4 或 1.1.0，不能使用 OMP 入口'),
    { code: 'CLI_IDENTITY_MISMATCH' },
  )
function metadata(path) {
  const info = statSync(path)
  if (!info.isFile() || info.size > 128 * 1024) throw failure()
  return readFileSync(path, 'utf8')
}
// Exact official Windows managed launcher inspected from Pi 1.1.0. It is read as
// installation metadata, never evaluated. Unknown bootstrap code fails closed.
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
      for (const relative of allowUnsupported ? ['cli.js'] : ['cli.js', 'index.js', 'core/model-runtime.js', 'core/auth-storage.js']) {
        if (!statSync(join(dist, relative)).isFile()) throw failure()
      }
      return {
        root: directory,
        dist,
        version: manifest.version,
        executable: realpathSync(join(dist, 'cli.js')),
      }
    }
  } catch {
    throw failure()
  }
  throw failure()
}
