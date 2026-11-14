import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TEMPORARY_TREE_MAX_AGE_MS, realDirectory, removeTemporaryTree, temporaryTreeHasLiveOwner, pruneOmpNativesDirectory } from './temporary-tree.mjs'

// Exact mkdtemp families in src/host; do not sweep arbitrary cliworker-* projects.
const temporaryPrefixes = ['cliworker-omp-identity-', 'cliworker-login-options-',
  'cliworker-qoder-metadata-', 'cliworker-qodercn-metadata-', 'cliworker-omp-approval-',
  'cliworker-hermes-statistics-', 'cliworker-native-read-', 'cliworker-codebuddy-catalog-',
  'cwn-', 'dshwb-']

export async function sweepTemporaryTrees(stateDirectory: string, options: {
  temporaryRoot?: string; signal?: AbortSignal; now?: number
} = {}): Promise<void> {
  const { signal, now = Date.now(), temporaryRoot = tmpdir() } = options
  const scan = async (parent: string, matches: (name: string) => boolean, ancestors: string[] = []) => {
    const locationsSafe = async () => (await Promise.all([...ancestors, parent].map(realDirectory))).every(Boolean)
    if (signal?.aborted || !await locationsSafe()) return
    for (const name of await readdir(parent)) {
      if (signal?.aborted) return
      if (!matches(name)) continue
      const path = join(parent, name)
      try {
        const info = await realDirectory(path)
        if (!info || now - info.mtimeMs < TEMPORARY_TREE_MAX_AGE_MS || await temporaryTreeHasLiveOwner(path)) continue
        // Recheck the candidate and parent after asynchronous owner inspection.
        const current = await realDirectory(path)
        if (signal?.aborted || !await locationsSafe() || !current || current.ino !== info.ino || current.dev !== info.dev ||
            now - current.mtimeMs < TEMPORARY_TREE_MAX_AGE_MS) continue
        await removeTemporaryTree(path)
      } catch { /* A locked or concurrently removed entry is retried next sweep. */ }
    }
  }
  try {
    if (await realDirectory(stateDirectory)) {
      const catalog = join(stateDirectory, 'catalog')
      if (await realDirectory(catalog)) for (const cli of await readdir(catalog)) {
        if (signal?.aborted) return
        await scan(join(catalog, cli), name => name.startsWith('query-'), [stateDirectory, catalog])
      }
      if (!signal?.aborted) await pruneOmpNativesDirectory(stateDirectory, signal, now)
    }
  } catch { /* Best effort; still scan system temp if catalog is unavailable. */ }
  try { await scan(temporaryRoot, name => temporaryPrefixes.some(prefix => name.startsWith(prefix))) }
  catch { /* Startup and metadata queries do not depend on reclamation. */ }
}

const sweeps = new Map<string, { at: number; pending: Promise<void>; running: boolean }>()
const lifetimes = new Map<string, { controller: AbortController; temporaryRoot?: string }>()

/** One background operation, no timer; shutdown aborts and joins the latest sweep. */
export function startTemporaryTreeMaintenance(stateDirectory: string, temporaryRoot?: string) {
  const controller = new AbortController()
  lifetimes.set(stateDirectory, { controller, temporaryRoot })
  void sweepTemporaryTreesThrottled(stateDirectory)
  return { async close() {
    controller.abort()
    await sweeps.get(stateDirectory)?.pending
    if (lifetimes.get(stateDirectory)?.controller === controller) {
      lifetimes.delete(stateDirectory)
      sweeps.delete(stateDirectory)
    }
  } }
}
/** Coalesce concurrent queries and bound scans to once per ten minutes per state root. */
export function sweepTemporaryTreesThrottled(stateDirectory: string, signal?: AbortSignal): Promise<void> {
  const lifetime = lifetimes.get(stateDirectory)
  const control = lifetime ? AbortSignal.any([lifetime.controller.signal, ...(signal ? [signal] : [])]) : signal
  if (control?.aborted) return Promise.resolve()
  const previous = sweeps.get(stateDirectory)
  if (previous && (previous.running || Date.now() - previous.at < 10 * 60 * 1000)) return previous.pending
  const pending = sweepTemporaryTrees(stateDirectory, { signal: control, temporaryRoot: lifetime?.temporaryRoot })
  const entry = { at: Date.now(), pending, running: true }
  sweeps.set(stateDirectory, entry)
  void pending.then(() => { entry.running = false }, () => { entry.running = false })
  // No timers or handles. Bound metadata for changing configured state roots.
  if (sweeps.size > 64) for (const key of sweeps.keys()) {
    if (key !== stateDirectory && !lifetimes.has(key) && !sweeps.get(key)?.running) { sweeps.delete(key); break }
  }
  return pending
}
