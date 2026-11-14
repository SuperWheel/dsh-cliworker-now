import { AsyncLocalStorage } from 'node:async_hooks'
import { dirname, join, resolve } from 'node:path'
import { removeTemporaryTree } from '../temporary-tree.mjs'
import { ProcessCleanupUnconfirmedError } from '../process.ts'
import { physicalFs } from './physical-fs.ts'

const fs = physicalFs().promises
interface Scope {
  paths: Map<string, string>; removed: Map<string, number>; bytes: number; failed: number
  finalized?: boolean; output?: (text: string) => void; quarantined: boolean; notes: Set<string>; finalizers: (() => Promise<void>)[]
}
const operations = new AsyncLocalStorage<Scope>()
export const updateCleanupIo = { remove: (path: string) => removeTemporaryTree(path, fs.rm) }

/** Every parent inside the established boundary must be a real directory. */
export async function cleanupPathSafe(root: string, path: string): Promise<boolean> {
  root = resolve(root); path = resolve(path)
  if (path !== root && !path.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))) return false
  for (let current = dirname(path); ; current = dirname(current)) {
    const info = await fs.lstat(current).catch(() => undefined)
    if (!info?.isDirectory() || info.isSymbolicLink()) return false
    if (current === root) return true
    if (current === dirname(current) || current.length < root.length) return false
  }
}
export function trackUpdateTemporary(path: string, label = '插件临时文件'): string {
  operations.getStore()?.paths.set(path, label)
  return path
}
export function retainUpdateTemporary(path: string) { operations.getStore()?.paths.delete(path) }
export function quarantineUpdateCleanup() { const scope = operations.getStore(); if (scope) scope.quarantined = true }
export function cleanupNote(note: string) { operations.getStore()?.notes.add(note) }
export function afterUpdateCleanup(callback: () => Promise<void>) { operations.getStore()?.finalizers.push(callback) }
export async function temporaryBytes(path: string): Promise<number> {
  const info = await fs.lstat(path)
  if (info.isSymbolicLink()) return 0
  if (info.isFile()) return info.nlink === 1 ? info.size : 0
  if (!info.isDirectory()) return 0
  let bytes = 0
  for (const name of await fs.readdir(path)) bytes += await temporaryBytes(join(path, name))
  return bytes
}
/** Best effort, including failures in counting or the injected filesystem. */
export async function removeUpdateTemporary(path: string, label = '插件临时文件'): Promise<void> {
  const scope = operations.getStore()
  if (scope?.quarantined) return
  try {
    const info = await fs.lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error })
    if (!info) { scope?.paths.delete(path); return }
    const bytes = await temporaryBytes(path)
    if (!await updateCleanupIo.remove(path)) { if (scope) scope.failed++; return }
    if (scope) { scope.bytes += bytes; scope.removed.set(label, (scope.removed.get(label) ?? 0) + 1); scope.paths.delete(path) }
  } catch { if (scope) scope.failed++ }
}
export async function finishUpdateCleanup(): Promise<boolean> {
  const scope = operations.getStore()
  if (!scope || scope.finalized) return scope?.quarantined ?? false
  scope.finalized = true
  try {
    if (!scope.quarantined) for (const callback of scope.finalizers) {
      if (scope.quarantined) break
      try { await callback() } catch (error) { if (error instanceof ProcessCleanupUnconfirmedError) scope.quarantined = true; else scope.failed++ }
    }
    if (!scope.quarantined) for (const [path, label] of [...scope.paths]) await removeUpdateTemporary(path, label)
  } finally {
    const items = [...scope.removed].map(([label, count]) => `${label} ${count} 项`).join('、') || '0 项'
    const notes = [...scope.notes, ...(scope.failed ? ['部分残留未能清理'] : []), ...(scope.quarantined ? ['进程退出未确认，清理延期'] : [])]
    try { scope.output?.(`\n更新清理：已删除 ${items}，释放 ${scope.bytes} B${notes.length ? `；${notes.join('；')}` : ''}。\n`) } catch { /* Preserve result. */ }
  }
  return scope.quarantined
}
export async function withUpdateCleanup<T>(output: (text: string) => void, run: () => Promise<T>): Promise<T> {
  if (operations.getStore() && !operations.getStore()!.finalized) return run()
  const scope: Scope = { output, paths: new Map(), removed: new Map(), bytes: 0, failed: 0, quarantined: false, notes: new Set(), finalizers: [] }
  return operations.run(scope, async () => {
    try { return await run() }
    catch (error) { if (error instanceof ProcessCleanupUnconfirmedError) scope.quarantined = true; throw error }
    finally { await finishUpdateCleanup() }
  })
}
