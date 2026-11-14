import { access, open, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { ProcessBackend } from '../process.ts'
import { readManifest } from './identity.ts'

const unavailable = () => Object.assign(new Error('无法核实 Node/npm 安装，请确认 Node 运行时与 npm-cli.js；全局包前缀只用作安装目标'), { code: 'PREREQUISITE_MISSING' })

/** Resolve the Node/npm distribution independently of the CLI's global prefix.
 * npm.cmd is never interpreted: the Windows distribution has a fixed JS entry,
 * verified against npm's manifest. In particular it is not a cmd-shim launcher.
 */
/** The host resolver canonicalizes .cmd files via inspectBatch, which rejects npm.cmd's own
 * (non cmd-shim) script (2026-11-14 Windows 实机：Pi npm 更新报 PREREQUISITE_MISSING). The official
 * Windows distribution ships npm.cmd beside node.exe; every later check still verifies that layout. */
async function npmLauncher(backend: ProcessBackend, platform: NodeJS.Platform): Promise<string> {
  if (platform !== 'win32') return backend.resolveExecutable('npm')
  try { return await backend.resolveExecutable('npm.cmd') }
  catch { return join(dirname(await backend.resolveExecutable('node.exe')), 'npm.cmd') }
}
export async function resolveNpmRuntime(backend: ProcessBackend, platform = process.platform): Promise<[string, string]> {
  try {
    const launcher = await npmLauncher(backend, platform)
    if (!isAbsolute(launcher)) throw unavailable()
    const selected = await realpath(launcher)
    if (!(await stat(selected)).isFile()) throw unavailable()
    const entry = await realpath(platform === 'win32' ? join(dirname(selected), 'node_modules/npm/bin/npm-cli.js') : selected)
    if (basename(entry) !== 'npm-cli.js') throw unavailable()
    const root = dirname(dirname(entry)), manifest = await readManifest(join(root, 'package.json'))
    if (manifest?.name !== 'npm' || manifest.bin?.npm !== 'bin/npm-cli.js' || await realpath(resolve(root, manifest.bin.npm)) !== entry) throw unavailable()
    await access(entry, constants.R_OK)
    if (!(await stat(entry)).isFile()) throw unavailable()

    const name = platform === 'win32' ? 'node.exe' : 'node'
    const sibling = join(dirname(launcher), name)
    let candidate: string
    try { await stat(sibling); candidate = sibling }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      candidate = await backend.resolveExecutable(name)
    }
    if (!isAbsolute(candidate)) throw unavailable()
    const node = await realpath(candidate)
    if (basename(node).toLowerCase() !== name || !(await stat(node)).isFile()) throw unavailable()
    await access(node, platform === 'win32' ? constants.R_OK : constants.R_OK | constants.X_OK)
    // Reject scripts/shims without executing a version probe. Supported native
    // formats: Windows PE, ELF, Mach-O (including universal binaries).
    const file = await open(node, 'r')
    try {
      const header = Buffer.alloc(4), { bytesRead } = await file.read(header, 0, 4, 0)
      const magic = header.toString('hex')
      if (bytesRead !== 4 || (platform === 'win32' ? header.toString('ascii', 0, 2) !== 'MZ' : !['7f454c46', 'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(magic))) throw unavailable()
    } finally { await file.close() }
    return [node, entry]
  } catch { throw unavailable() }
}
