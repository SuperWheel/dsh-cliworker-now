import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs'

/**
 * Where the installed ZCode CLI accepts the client's dynamic workflow choice
 * (openspec/changes/vnext-zcode-custom-key-leeyl).
 *
 * - `preferences`: the strict `session/requestRuntimePreferences` result schema
 *   lists `dynamicWorkflowMode` (the build v0.8.7 was verified against).
 * - `session`: the result schema rejects it, but `session/create` and
 *   `session/resume` accept `dynamicWorkflowEnabled` + `dynamicWorkflowMode` (0.17.1).
 * - `none`: neither is proven (0.16.9, a native binary, or an unreadable entry).
 *   The reply then carries only fields every known version accepts.
 *
 * Every known result schema is `.strict()`, so an unlisted key fails the whole
 * dispatch while an omitted optional key never does. Unknown therefore omits.
 */
export type ZCodeWorkflowSurface = 'preferences' | 'session' | 'none'
export const ZCODE_WORKFLOW_SURFACE_ENVIRONMENT = 'CLIWORKER_ZCODE_WORKFLOW_SURFACE'

const MAX_ENTRY_BYTES = 128 * 1024 * 1024
const cache = new Map<string, ZCodeWorkflowSurface>()

/** Source text only; identifiers are ASCII, so latin1 keeps byte offsets without decoding errors. */
function readEntry(path: string): { key: string; text: string } | undefined {
  let fd: number | undefined
  try {
    const real = realpathSync(path)
    fd = openSync(real, constants.O_RDONLY | constants.O_NONBLOCK)
    const before = fstatSync(fd)
    if (!before.isFile() || before.size <= 0 || before.size > MAX_ENTRY_BYTES) return undefined
    const key = `${real}\0${before.dev}\0${before.ino}\0${before.size}\0${before.mtimeMs}`
    const cached = cache.get(key)
    if (cached) return { key, text: '' }
    const buffer = Buffer.allocUnsafe(before.size)
    let length = 0
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null)
      if (!count) break
      length += count
    }
    const after = fstatSync(fd)
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) return undefined
    return { key, text: buffer.toString('latin1') }
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** Object literals around a required `nativeSearchEnhancementsEnabled: <zod>.boolean(),` field. */
function preferenceSchemas(text: string): string[] {
  const schemas: string[] = []
  const field = /nativeSearchEnhancementsEnabled\s*:\s*[\w$.]+\.boolean\(\)\s*,/g
  for (let match = field.exec(text); match; match = field.exec(text)) {
    const start = text.lastIndexOf('object({', match.index)
    const end = text.indexOf('}).strict()', match.index)
    if (start < 0 || end < 0 || match.index - start > 4096 || end - match.index > 4096) continue
    const schema = text.slice(start, end)
    // Nested objects would make the matched `.strict()` belong to another literal.
    if (schema.indexOf('object({', 8) >= 0) continue
    if (schema.includes('memoryEnabled') && schema.includes('askUserQuestionAutoResolutionEnabled')) schemas.push(schema)
  }
  return schemas
}

/** Pure classification of an entry's source text; exported for synthetic tests. */
export function classifyZCodeWorkflowSurface(text: string): ZCodeWorkflowSurface {
  if (preferenceSchemas(text).some((schema) => /\bdynamicWorkflowMode\s*:/.test(schema))) return 'preferences'
  // session/create and session/resume list the two fields after offPeakToolEnabled.
  if (/offPeakToolEnabled\s*:[^,]{1,80},\s*dynamicWorkflowEnabled\s*:\s*[\w$.]+\.boolean\(\)\.optional\(\)\s*,\s*dynamicWorkflowMode\s*:/.test(text))
    return 'session'
  return 'none'
}

/** Cached by file identity; a reinstall or update at the same path is read again. */
export function zcodeWorkflowSurface(executable: string): ZCodeWorkflowSurface {
  if (!/\.[cm]?js$/i.test(executable)) return 'none'
  const entry = readEntry(executable)
  if (!entry) return 'none'
  const cached = cache.get(entry.key)
  if (cached) return cached
  const surface = classifyZCodeWorkflowSurface(entry.text)
  if (cache.size >= 16) cache.delete(cache.keys().next().value!)
  cache.set(entry.key, surface)
  return surface
}
