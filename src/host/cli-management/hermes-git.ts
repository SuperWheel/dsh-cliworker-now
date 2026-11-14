import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { safeObservation } from './artifacts/observations.ts'
import type { HermesUpdateOptions } from './hermes-watch.ts'

const inside = (root: string, path: string) => { const p = relative(root, path); return p !== '..' && !p.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(p) }
async function record(path: string): Promise<Record<string, any> | undefined> {
  const value = await safeObservation(path, 256 * 1024)
  try { const data = JSON.parse(value?.text.replace(/^\uFEFF/, '') ?? 'null'); return data && typeof data === 'object' && !Array.isArray(data) ? data : undefined } catch { return }
}
async function regularBinary(home: string, path: string) {
  if (!inside(home, path)) return false
  try {
    const file = await lstat(path)
    if (!file.isFile() || file.isSymbolicLink()) return false
    for (let p = dirname(path); ; p = dirname(p)) {
      const dir = await lstat(p)
      if (!dir.isDirectory() || dir.isSymbolicLink()) return false
      if (p === home) break
      if (dirname(p) === p) return false
    }
    return inside(await realpath(home), await realpath(path))
  } catch { return false }
}

/** Read-only counterpart of PM's store/pin lookup. Git is PM-managed on Windows only;
 * POSIX deliberately uses PATH. Never run Hermes or install a missing tool to resolve it. */
export async function resolveHermesGit(o: HermesUpdateOptions) {
  if ((o.platform ?? process.platform) === 'win32') {
    const home = resolve(o.home), checkout = resolve(o.checkout), target = `win32-${o.arch ?? process.arch}`
    let store = join(home, 'tools')
    if (process.env.HERMES_RUNTIME_DIR) store = resolve(process.env.HERMES_RUNTIME_DIR)
    else {
      let found = false
      for (const base of [dirname(checkout), checkout]) {
        const payload = await record(join(base, 'manifest.json'))
        if (typeof payload?.repo === 'string' && resolve(base, payload.repo) === checkout && typeof payload.store === 'string' && payload.store) {
          store = resolve(base, payload.store); found = true; break
        }
      }
      if (!found) for (let dir = checkout; inside(home, dir); dir = dirname(dir)) {
        const stamp = await record(join(dir, 'install-stamp.json'))
        if (stamp) { if (typeof stamp.runtimeDir === 'string' && stamp.runtimeDir) store = resolve(stamp.runtimeDir); break }
        if (dir === home || dirname(dir) === dir) break
      }
    }
    if (inside(home, store)) {
      const lock = await record(join(checkout, 'pm/lock.json')), facts = await record(join(store, 'facts.json'))
      const pin = lock?.packages?.git, fact = facts?.packages?.git
      const entries: string[] = []
      // install.ps1 can stage the pinned Git without recording facts yet.
      if (typeof pin?.version === 'string' && /^[A-Za-z0-9.+_-]+$/.test(pin.version) && pin.artifacts?.[target]) entries.push(`git-${pin.version}-${target}`)
      if (fact?.target === target && typeof fact.version === 'string' && /^[A-Za-z0-9.+_-]+$/.test(fact.version) && fact.entry === `git-${fact.version}-${target}`) entries.push(fact.entry)
      for (const entry of entries) {
        o.signal.throwIfAborted()
        const path = join(store, entry, 'cmd/git.exe')
        if (await regularBinary(home, path)) return path
      }
    }
  }
  o.signal.throwIfAborted()
  return o.backend.resolveExecutable('git')
}
