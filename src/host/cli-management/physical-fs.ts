import { createRequire } from 'node:module'
import * as nodeFs from 'node:fs'

let physical: typeof nodeFs | undefined
/**
 * Disk operations on application bundles must bypass Electron's ASAR patch: under the Desktop Host,
 * `fs.rm` treats `Contents/Resources/app.asar` as a virtual directory and fails with ENOTEMPTY
 * (ZCode 3.18.2 update, 2026-11-14). Plain Node (tests, CLI scripts) uses node:fs unchanged.
 */
export function physicalFs(): typeof nodeFs {
  return (physical ??= process.versions.electron
    ? (createRequire(import.meta.url)('original-fs') as typeof nodeFs)
    : nodeFs)
}

