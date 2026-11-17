import { constants } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
/** Only ordinary files below ordinary ancestors can supply observation evidence. */
/** `since` (tail mode): read only bytes appended after this point of the same file; a replaced or truncated file is read from its start. */
export async function safeObservation(path: string, limit = 65536, tail = false, since?: { ino: number; size: number }): Promise<{ text: string; stamp: string; mtimeMs: number; ino: number; size: number } | undefined> {
  try {
    for (let p = dirname(path); ; p = dirname(p)) { const s = await lstat(p); if (!s.isDirectory() || s.isSymbolicLink()) return; if (dirname(p) === p) break }
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const s = await file.stat(); if (!s.isFile() || s.nlink !== 1 || !tail && s.size > limit) return
      const from = tail && since && since.ino === s.ino && since.size <= s.size ? since.size : 0
      const b = Buffer.alloc(Math.min(s.size - from, limit)), { bytesRead } = await file.read(b, 0, b.length, tail ? Math.max(from, s.size - b.length) : 0)
      return { text: b.subarray(0, bytesRead).toString('utf8'), stamp: `${s.ino}:${s.mtimeMs}:${s.size}`, mtimeMs: s.mtimeMs, ino: s.ino, size: s.size }
    } finally { await file.close() }
  } catch { return }
}
export async function observedPackages(root: string, _startedAt: number, baseline: Set<string> = new Set()): Promise<number> {
  let count = 0, scanned = 0
  for (let p = root; ; p = dirname(p)) { const s = await lstat(p).catch(() => undefined); if (!s?.isDirectory() || s.isSymbolicLink()) return 0; if (dirname(p) === p) break }
  const walk = async (path: string, depth: number) => {
    if (depth > 12 || ++scanned > 10000) return
    const stat = await lstat(path).catch(() => undefined); if (!stat?.isDirectory() || stat.isSymbolicLink()) return
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      if (entry.name === 'package.json' && entry.isFile() && path.includes('node_modules')) { const s = await lstat(join(path, entry.name)); if (s.isFile() && !s.isSymbolicLink() && s.nlink === 1) count++ }
      if (entry.isDirectory() && (entry.name === 'node_modules' || path.endsWith('node_modules') || basename(path).startsWith('@'))) await walk(join(path, entry.name), depth + 1)
    }
  }
  const info = await lstat(root).catch(() => undefined); if (!info?.isDirectory() || info.isSymbolicLink()) return 0
  for (const name of await readdir(root)) if (/^update-[A-Za-z0-9]+$/.test(name) && !baseline.has(name)) await walk(join(root, name), 0)
  return count
}
