import { chmod, lstat, mkdir, mkdtemp, readdir, realpath, rm, rmdir } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

export const TEMPORARY_TREE_MAX_AGE_MS = 60 * 60 * 1000
export const temporaryTreeRemovalOptions = { recursive: true, force: true, maxRetries: 6, retryDelay: 150 }

/** Disk cleanup must never replace a successful probe or its original failure. */
export async function removeTemporaryTree(path, remove = rm) {
  try {
    // Called only after range exit; a failed disk removal must be sweepable later.
    await rmdir(join(path, `.cliworker-owner-${process.pid}`)).catch(() => {})
    await remove(path, temporaryTreeRemovalOptions)
    return true
  } catch { return false }
}

// A name-only owner marker protects long-lived resources across Host instances.
// Unconfirmed cleanup retains it until that Host exits; no credentials are read.
export function markTemporaryTreeActive(path) {
  mkdirSync(join(path, `.cliworker-owner-${process.pid}`), { mode: 0o700 })
}

/** Short-lived CLI queries only; the caller must confirm its whole range exited before release. */
export async function prepareProbeTemporaryEnvironment(env, platform = process.platform) {
  if (platform !== 'win32') return { env, release: async () => {} }
  const root = await mkdtemp(join(tmpdir(), 'cliworker-probe-'))
  try {
    await chmod(root, 0o700)
    markTemporaryTreeActive(root)
    // Windows environment keys are case-insensitive. Replace only TMP/TEMP variants.
    const rest = Object.fromEntries(Object.entries(env ?? {}).filter(([key]) => !/^(tmp|temp)$/i.test(key)))
    return { env: { ...rest, TMP: root, TEMP: root }, release: async () => { await removeTemporaryTree(root) } }
  } catch (error) { await removeTemporaryTree(root); throw error }
}

export async function temporaryTreeHasLiveOwner(path) {
  for (const name of await readdir(path)) {
    const match = /^\.cliworker-owner-([1-9]\d*)$/.exec(name)
    if (!match) continue
    const pid = Number(match[1])
    if (!Number.isSafeInteger(pid)) return true
    try { process.kill(pid, 0); return true }
    catch (error) { if (error?.code !== 'ESRCH') return true }
  }
  return false
}

export async function realDirectory(path) {
  try { const info = await lstat(path); return info.isDirectory() && !info.isSymbolicLink() ? info : undefined }
  catch { return undefined }
}

export async function prepareOmpNativesDirectory(stateDirectory = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'cliworker-now')) {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
  if (!await realDirectory(stateDirectory)) throw new Error('Unsafe plugin state directory')
  const root = join(await realpath(stateDirectory), 'omp-natives')
  await mkdir(root, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
  if (!await realDirectory(root)) throw new Error('Unsafe OMP natives directory')
  await chmod(root, 0o700)
  return root
}

/** Only version subdirectories; young/locked versions may temporarily exceed the cap. */
export async function pruneOmpNativesDirectory(stateDirectory, signal, now = Date.now()) {
  const root = join(stateDirectory, 'omp-natives')
  if (!await realDirectory(root)) return
  const versions = []
  for (const name of await readdir(root)) {
    if (signal?.aborted) return
    if (/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(name) && await realDirectory(join(root, name))) versions.push(name)
  }
  versions.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
  for (const name of versions.slice(3)) {
    if (signal?.aborted) return
    const path = join(root, name), info = await realDirectory(path)
    if (info && now - info.mtimeMs >= TEMPORARY_TREE_MAX_AGE_MS) await removeTemporaryTree(path)
  }
}
