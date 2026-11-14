import { lstat, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export type HermesStage = 'unknown' | 'plan' | 'snapshot' | 'fetch' | 'apply' | 'deps' | 'tools' | 'uv' | 'pnpm' | 'build' | 'restart'
export type SlowReason = 'OFFICIAL_SLOW' | 'OFFICIAL_STALLED'
export function hermesStage(text: unknown): HermesStage | undefined {
  if (typeof text !== 'string') return
  if (/\brestart(?:ing)?\b|restarting services/i.test(text)) return 'restart'
  if (/\bapply\b|applying|pulling updates|switching to source commit|checking out|moving checkout/i.test(text)) return 'apply'
  if (/\bfetch(?:ing)?\b|downloading updates/i.test(text)) return 'fetch'
  if (/downloading.*(?:tool|python|node|uv|pnpm)|\btools\b|tool downloads/i.test(text)) return 'tools'
  // The 0.21.7 handoff publishes this BEFORE ensure_tools_for_sync, not just uv sync.
  if (/python dependencies\s*\(PM\)/i.test(text)) return 'deps'
  if (/\bpnpm\b|node(?:\.js)? dependenc|node deps/i.test(text)) return 'pnpm'
  if (/\buv\b|python dependencies|python deps/i.test(text)) return 'uv'
  if (/\bdeps\b|dependencies|syncing.*environment/i.test(text)) return 'deps'
  if (/\bbuild(?:ing)?\b/i.test(text)) return 'build'
  if (/\bsnapshot\b/i.test(text)) return 'snapshot'
  if (/\bplan(?:ning)?\b/i.test(text)) return 'plan'
}
export function pidAlive(pid: unknown): boolean | undefined {
  if (!Number.isSafeInteger(pid) || (pid as number) <= 0) return
  try { process.kill(pid as number, 0); return true }
  catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH' ? false : undefined }
}
export interface FileObservation { size: number; stamp: string }
export interface TreeObservation { files: Map<string, FileObservation>; complete: boolean }
export interface HermesCacheObservation extends TreeObservation { completed: TreeObservation }
/** Bounded metadata-only traversal. Ambiguous/incomplete evidence cannot justify a stall. */
export async function observeTree(root: string, accept: (name: string, path: string) => boolean = () => true, recursive = true, descend: (name: string, depth: number) => boolean = () => true): Promise<TreeObservation> {
  const result: TreeObservation = { files: new Map(), complete: true }
  let visited = 0
  const missing = (e: unknown) => ['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')
  try {
    for (let p = root; ; p = dirname(p)) {
      const s = await lstat(p).catch(e => { if (missing(e)) return; throw e })
      if (s && (!s.isDirectory() || s.isSymbolicLink())) { result.complete = false; return result }
      if (dirname(p) === p) break
    }
    const directories = [{ path: root, depth: 0 }]
    for (let index = 0; index < directories.length; index++) {
      const { path, depth } = directories[index]!
      if (depth > 20) { result.complete = false; continue }
      const entries = await readdir(path, { withFileTypes: true }).catch(e => { if (missing(e)) return []; throw e })
      // Bound outstanding filesystem work as well as total entries. Serial per-file stats made
      // a populated pnpm/uv cache take longer than a poll interval even on a local SSD.
      for (let start = 0; start < entries.length; start += 32) {
        const batch = entries.slice(start, start + 32)
        visited += batch.length
        if (visited > 100_000) { result.complete = false; return result }
        const observations = await Promise.all(batch.map(async entry => {
          if (entry.isSymbolicLink()) return
          const full = join(path, entry.name), s = await lstat(full).catch(e => { if (missing(e)) return; throw e })
          return { entry, full, s }
        }))
        for (const item of observations) {
          if (!item?.s || item.s.isSymbolicLink()) continue
          const { entry, full, s } = item
          if (s.isDirectory() && recursive && descend(entry.name, depth)) directories.push({ path: full, depth: depth + 1 })
          else if (s.isFile() && accept(entry.name, full)) result.files.set(full, { size: s.size, stamp: `${s.ino}:${s.mtimeMs}:${s.ctimeMs}:${s.size}` })
        }
      }
    }
  } catch { result.complete = false }
  return result
}
export async function observeHermesCache(home: string): Promise<HermesCacheObservation> {
  const [partials, ...finished] = await Promise.all([
    observeTree(join(home, 'cache/partials')),
    ...['uv', 'pnpm/store'].map(p => observeTree(join(home, 'cache', p))),
    // PM publishes verified archives as tools/fetch-<sha256>/<filename>, then immutable
    // tool entries. Its .staging-* directories and bookkeeping are not completed content.
    observeTree(join(home, 'tools'), (_name, path) => dirname(path) !== join(home, 'tools'), true, (name, depth) => depth > 0 || !name.startsWith('.')),
  ])
  const completed: TreeObservation = { files: new Map(finished.flatMap(t => [...t.files].filter(([p]) => !/\.(?:part|ranges|download|tmp)$/.test(p)))), complete: finished.every(t => t.complete) }
  const trees = [partials!, ...finished]
  return { files: new Map(trees.flatMap(t => [...t.files])), complete: trees.every(t => t.complete), completed }
}
// Preallocated .part lengths and checkpoint bytes never establish completed work.
export const cacheGrew = (before: HermesCacheObservation, after: HermesCacheObservation) => before.completed.complete && after.completed.complete && [...after.completed.files].some(([p, f]) => !before.completed.files.has(p) || f.size > before.completed.files.get(p)!.size)
export const treeStamp = (tree: TreeObservation) => [...tree.files].map(([p, f]) => `${p}:${f.stamp}`).sort().join('\n')

/** Fetch-only clock: a first-byte grace, then no-growth and rolling 60-second speed. */
export class HermesFetchWatchdog {
  private samples: { at: number; bytes: number }[] = []
  private lastBytes = 0
  private lastGrowth: number
  private firstByte = false
  constructor(readonly startedAt: number) { this.lastGrowth = startedAt }
  check(now: number, bytes: number): SlowReason | undefined {
    if (bytes > this.lastBytes) { this.firstByte = true; this.lastGrowth = now }
    this.lastBytes = bytes
    if (!this.firstByte) return now - this.startedAt >= 60_000 ? 'OFFICIAL_STALLED' : undefined
    this.samples.push({ at: now, bytes })
    while (this.samples.length > 1 && this.samples[1]!.at <= now - 60_000) this.samples.shift()
    if (now - this.lastGrowth >= 30_000) return 'OFFICIAL_STALLED'
    const first = this.samples[0]!, duration = now - first.at
    if (duration >= 60_000 && (bytes - first.bytes) * 1000 / duration < 100_000) return 'OFFICIAL_SLOW'
  }
}
/** Counts growth of this invocation's tmp packs, retaining bytes when Git renames a completed pack. */
export class HermesPacks {
  private baseline = new Map<string, FileObservation>()
  private seen = new Map<string, number>()
  async snapshot(checkout: string) { this.baseline = (await this.read(checkout)).files }
  private read(checkout: string) { return observeTree(join(checkout, '.git/objects/pack'), n => /^tmp_pack_[A-Za-z0-9]+$/.test(n), false) }
  async poll(checkout: string) {
    const tree = await this.read(checkout)
    for (const [path, file] of tree.files) {
      const bytes = Math.max(0, file.size - (this.baseline.get(path)?.size ?? 0))
      this.seen.set(path, Math.max(this.seen.get(path) ?? 0, bytes))
    }
    return { bytes: [...this.seen.values()].reduce((a, b) => a + b, 0), complete: tree.complete }
  }
}
