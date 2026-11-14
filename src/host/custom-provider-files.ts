import * as fs from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface NativeFile { path: string; text: string | undefined; mode: number }
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

/** Do not follow user-controlled links when handling credentials. No paths/errors leave this module. */
function ancestors(path: string) {
  const absolute = resolve(path)
  const root = parse(absolute).root
  let current = root
  for (const part of absolute.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part)
    try {
      const info = fs.lstatSync(current)
      if (info.isSymbolicLink()) {
        if (!(['/tmp', '/var'].includes(current) && fs.realpathSync(current) === `/private${current}`)) throw new Error('Unsafe directory')
      } else if (!info.isDirectory()) throw new Error('Unsafe directory')
    } catch (error) { if (!missing(error)) throw error }
  }
}

export function readNativeFile(path: string, secret = false): NativeFile {
  ancestors(dirname(path))
  let fd: number | undefined
  try {
    const entry = fs.lstatSync(path)
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || entry.size > 4 * 1024 * 1024) throw new Error('Unsafe file')
    fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
    const before = fs.fstatSync(fd)
    if (entry.ino !== before.ino || entry.dev !== before.dev) throw new Error('Changed file')
    const text = fs.readFileSync(fd, 'utf8')
    const after = fs.fstatSync(fd)
    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size || Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error('Changed file')
    return { path, text, mode: secret ? 0o600 : entry.mode & 0o777 }
  } catch (error) {
    if (missing(error)) return { path, text: undefined, mode: 0o600 }
    throw error
  } finally { if (fd !== undefined) fs.closeSync(fd) }
}

export class NativeRollbackError extends Error {}

/** Synchronous commit: no await can release the Host reservation between the two renames. */
export function commitNativeFiles(changes: { file: NativeFile; text: string }[], assertCurrent: () => void) {
  const staged: { file: NativeFile; next: string; backup?: string; committed: boolean }[] = []
  const directories: string[] = []
  let retainBackups = false
  const prepareDirectory = (path: string) => {
    ancestors(path)
    if (fs.existsSync(path)) return
    prepareDirectory(dirname(path))
    fs.mkdirSync(path, { mode: 0o700 })
    directories.push(path)
  }
  const stage = (path: string, text: string, mode: number) => {
    const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
    try { fs.writeFileSync(fd, text); fs.fchmodSync(fd, mode); fs.fsyncSync(fd) }
    finally { fs.closeSync(fd) }
  }
  try {
    for (const { file, text } of changes) {
      prepareDirectory(dirname(file.path))
      const next = `${file.path}.${randomUUID()}.tmp`
      const item = { file, next, backup: file.text === undefined ? undefined : `${file.path}.${randomUUID()}.bak`, committed: false }
      staged.push(item)
      stage(next, text, file.mode)
      // Backups may contain credentials even when the native configuration has broad permissions.
      if (item.backup) stage(item.backup, file.text!, 0o600)
    }
    assertCurrent()
    for (const { file } of changes) if (readNativeFile(file.path).text !== file.text) throw new Error('Changed file')
    for (const item of staged) {
      assertCurrent()
      if (readNativeFile(item.file.path).text !== item.file.text) throw new Error('Changed file')
      fs.renameSync(item.next, item.file.path)
      item.committed = true
    }
  } catch (error) {
    for (const item of [...staged].reverse()) {
      if (!item.committed) continue
      try {
        if (item.backup) {
          fs.renameSync(item.backup, item.file.path)
          fs.chmodSync(item.file.path, item.file.mode)
        } else fs.unlinkSync(item.file.path)
      } catch { retainBackups = true }
    }
    if (retainBackups) throw new NativeRollbackError('原生配置回滚未完成，请检查原生配置目录中的私有备份')
    throw error
  } finally {
    for (const item of staged) {
      try { fs.rmSync(item.next, { force: true }) } catch { /* No raw filesystem error can escape. */ }
      if (item.backup && !retainBackups) try { fs.rmSync(item.backup, { force: true }) } catch { /* Private backup. */ }
    }
    for (const path of directories.reverse()) try { fs.rmdirSync(path) } catch { /* Nonempty committed directory. */ }
  }
}

interface JsonNode { value: unknown; end: number; children?: Map<string, JsonNode>; lastEnd?: number; trailing?: boolean }

/** Small JSONC structural reader, used only for additive edits; retains every existing byte. */
export function nativeJson(text = '{}') {
  let position = 0
  const whitespace = () => {
    for (;;) {
      while (/\s/.test(text[position] ?? '') && position < text.length) position++
      if (text.slice(position, position + 2) === '//') {
        const end = text.indexOf('\n', position); position = end < 0 ? text.length : end + 1
      } else if (text.slice(position, position + 2) === '/*') {
        const end = text.indexOf('*/', position + 2)
        if (end < 0) throw new Error('Invalid JSON')
        position = end + 2
      } else break
    }
  }
  const string = (): string => {
    const start = position++
    while (position < text.length) {
      const char = text[position++]
      if (char === '\\') position++
      else if (char === '"') return JSON.parse(text.slice(start, position)) as string
    }
    throw new Error('Invalid JSON')
  }
  const read = (depth = 0): JsonNode => {
    if (depth > 80) throw new Error('Deep JSON')
    whitespace()
    if (text[position] === '"') return { value: string(), end: position }
    if (text[position] === '{' || text[position] === '[') {
      const object = text[position++] === '{', close = object ? '}' : ']'
      const children = new Map<string, JsonNode>(), list: unknown[] = []
      let lastEnd: number | undefined, trailing = false
      whitespace()
      while (text[position] !== close) {
        let key = ''
        if (object) {
          if (text[position] !== '"') throw new Error('Invalid JSON')
          key = string(); whitespace()
          if (children.has(key) || text[position++] !== ':') throw new Error('Invalid JSON')
        }
        const node = read(depth + 1)
        if (object) children.set(key, node); else list.push(node.value)
        lastEnd = position
        whitespace()
        trailing = text[position] === ','
        if (trailing) { position++; whitespace() }
        else if (text[position] !== close) throw new Error('Invalid JSON')
      }
      position++
      return { value: object ? Object.fromEntries([...children].map(([k, v]) => [k, v.value])) : list, end: position,
        ...(object ? { children, lastEnd, trailing } : {}) }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(position))
    if (!match) throw new Error('Invalid JSON')
    position += match[0].length
    return { value: JSON.parse(match[0]), end: position }
  }
  const root = read()
  whitespace()
  if (position !== text.length || !root.children) throw new Error('Invalid JSON object')
  return {
    value: root.value as Record<string, unknown>,
    add(path: string[], value: unknown): string {
      let node = root
      for (let i = 0; i < path.length - 1; i++) {
        const child = node.children?.get(path[i]!)
        if (!child) return this.add(path.slice(0, i + 1), path.slice(i + 1).reduceRight((v, key) => ({ [key]: v }), value))
        if (!child.children) throw new Error('Invalid JSON object')
        node = child
      }
      const key = path.at(-1)!
      if (node.children!.has(key)) throw new Error('Duplicate field')
      const eol = text.includes('\r\n') ? '\r\n' : '\n'
      const indent = /(?:\r?\n)([\t ]+)"/.exec(text)?.[1] ?? '  '
      const addition = `${eol}${indent.repeat(path.length)}${JSON.stringify(key)}: ${JSON.stringify(value, null, indent).replace(/\n/g, eol + indent.repeat(path.length))}${eol}${indent.repeat(path.length - 1)}`
      const offset = node.end - 1
      let prefix = text.slice(0, offset)
      if (node.lastEnd !== undefined && !node.trailing) prefix = prefix.slice(0, node.lastEnd) + ',' + prefix.slice(node.lastEnd)
      return prefix + addition + text.slice(offset)
    },
  }
}
