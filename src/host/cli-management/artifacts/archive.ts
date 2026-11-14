import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, chmod, symlink, lstat } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import { createGunzip, createInflateRaw } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { DOWNLOAD_MAX_BYTES } from '../download.ts'
import { CliOperationError } from '../planner.ts'
import { privatePath } from './download.ts'
const fail = (): never => { throw new CliOperationError('INTEGRITY_MISMATCH', '归档成员路径、链接、大小或格式不安全') }
const text = (b: Buffer) => b.toString('utf8').split('\0')[0]!
const nameOf = (name: string) => { name = name.replace(/^\.\//, '').replace(/\/$/, ''); if (!name) return ''; privatePath('/archive', name); return name }
/** Resolve a link chain component by component (never a lexical shortcut); fail when any step leaves the root or loops. */
function resolveInside(links: Map<string, string>, parts: string[], depth = 0): string[] {
  if (depth > 40) fail()
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') { if (!out.length) fail(); out.pop(); continue }
    out.push(part)
    const target = links.get(out.join('/').toLowerCase())
    if (target !== undefined) { const resolved = resolveInside(links, [...out.slice(0, -1), ...target.split('/')], depth + 1); out.splice(0, out.length, ...resolved) }
  }
  return out
}
/** Sequential tar extraction: validate BEFORE creating anything; links created last, never traversed. */
export async function extractTar(source: string, destination: string, signal: AbortSignal, only?: string) {
  await mkdir(destination, { recursive: true, mode: 0o700 })
  const input = createReadStream(source), unzip = createGunzip(); input.on('error', error => unzip.destroy(error)); input.pipe(unzip)
  const abort = () => { input.destroy(); unzip.destroy(signal.reason) }; signal.addEventListener('abort', abort, { once: true })
  const iterator = unzip[Symbol.asyncIterator](); let pending: Buffer = Buffer.alloc(0), total = 0, count = 0
  const take = async (length: number): Promise<Buffer> => {
    while (pending.length < length) { signal.throwIfAborted(); const next = await iterator.next(); if (next.done) return fail(); pending = Buffer.concat([pending, Buffer.from(next.value)]) }
    const out = pending.subarray(0, length); pending = pending.subarray(length); return out
  }
  const seen = new Set<string>(), links: { name: string; target: string }[] = []
  let pendingPath: string | undefined, pendingLink: string | undefined
  try {
    for (;;) {
      const h = await take(512); if (h.every(v => v === 0)) { if (pendingPath !== undefined || pendingLink !== undefined) fail(); break }
      if (++count > 20000) fail()
      const checksum = Number.parseInt(text(h.subarray(148, 156)).trim(), 8)
      if (h.reduce((n, v, i) => n + (i >= 148 && i < 156 ? 32 : v), 0) !== checksum) fail()
      const headerName = [text(h.subarray(345, 500)), text(h.subarray(0, 100))].filter(Boolean).join('/')
      const size = Number.parseInt(text(h.subarray(124, 136)).trim() || '0', 8), type = h[156], mode = Number.parseInt(text(h.subarray(100, 108)).trim() || '0', 8)
      if (!Number.isSafeInteger(size) || size < 0 || (total += size) > DOWNLOAD_MAX_BYTES) fail()
      // PAX and GNU long names are bounded metadata, never filesystem members.
      if ([120, 103, 76, 75].includes(type!)) {
        if (size > 65536) fail()
        const metadata = await take(size); if (size % 512) await take(512 - size % 512)
        if (type === 76 || type === 75) {
          const value = text(metadata).replace(/\n$/, ''); if (!value) fail()
          if (type === 76) pendingPath = value; else pendingLink = value
        } else {
          for (let offset = 0; offset < metadata.length;) {
            const space = metadata.indexOf(32, offset), lengthText = metadata.subarray(offset, space).toString('ascii'), length = Number(lengthText)
            if (space < offset || !/^[1-9][0-9]*$/.test(lengthText) || !Number.isSafeInteger(length) || length <= space - offset + 2 || offset + length > metadata.length || metadata[offset + length - 1] !== 10) fail()
            const entry = metadata.subarray(space + 1, offset + length - 1).toString('utf8'), equal = entry.indexOf('='), key = entry.slice(0, equal), value = entry.slice(equal + 1)
            if (equal < 1 || !value || key === 'size' || /sparse/i.test(key)) fail()
            if (key === 'path' || key === 'linkpath') {
              if (type === 103) fail()
              if (key === 'path') pendingPath = value; else pendingLink = value
            }
            offset += length
          }
        }
        continue
      }
      if (![0, 48, 50, 53].includes(type!) || size && type !== 0 && type !== 48) fail()
      const name = nameOf(pendingPath ?? headerName), linkTarget = pendingLink ?? text(h.subarray(157, 257))
      if (pendingLink !== undefined && type !== 50) fail()
      pendingPath = pendingLink = undefined
      if (!name) { if (type !== 53) fail(); continue }
      const key = name.toLowerCase(); if (seen.has(key)) fail(); seen.add(key)
      const path = privatePath(destination, name)
      if (only && name !== only) {
        if (type === 50) { const link = linkTarget; if (!link || posix.isAbsolute(link) || /[\\:]/.test(link)) fail(); nameOf(posix.normalize(posix.join(posix.dirname(name), link))) }
        for (let left = size + (512 - size % 512) % 512; left > 0;) { const n = Math.min(left, 65536); await take(n); left -= n }
        continue
      }
      if (only && type !== 0 && type !== 48) fail()
      if (links.some(l => name === l.name || name.startsWith(l.name + '/'))) fail()
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      if (type === 53) { await mkdir(path, { recursive: true, mode: 0o700 }); continue }
      if (type === 50) {
        const target = linkTarget; if (!target || /[\\:\x00]/.test(target) || posix.isAbsolute(target)) fail()
        nameOf(posix.normalize(posix.join(posix.dirname(name), target)))
        if ([...seen].some(s => s.startsWith(key + '/'))) fail()
        links.push({ name, target }); continue
      }
      const handle = await open(path, 'wx', 0o600)
      try { for (let left = size; left > 0;) { const n = Math.min(left, 65536); await handle.write(await take(n)); left -= n } } finally { await handle.close() }
      if (size % 512) await take(512 - size % 512)
      await chmod(path, mode & 0o111 ? 0o755 : 0o644)
    }
    if (only && !seen.has(only.toLowerCase())) fail()
    const linkMap = new Map(links.map(l => [l.name.toLowerCase(), l.target]))
    for (const link of links) { const dir = posix.dirname(link.name); resolveInside(linkMap, [...(dir === '.' ? [] : dir.split('/')), ...link.target.split('/')]) }
    for (const link of links) { signal.throwIfAborted(); await symlink(link.target, privatePath(destination, link.name)) }
  } finally { signal.removeEventListener('abort', abort); input.destroy(); unzip.destroy() }
}
/** ZIP central directory is parsed before extraction; reject devices, links, encryption and ZIP64. */
export async function extractZip(source: string, destination: string, signal: AbortSignal, only?: string) {
  const file = await open(source, 'r')
  try {
    const size = (await file.stat()).size, tail = Buffer.alloc(Math.min(size, 65557)); await file.read(tail, 0, tail.length, size - tail.length)
    let end = -1
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break }
    if (end < 0 || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6)) fail()
    const count = tail.readUInt16LE(end + 10), length = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16)
    if (count > 20000 || length > 8 * 1024 * 1024 || offset + length > size - 22 || count === 65535) fail()
    const central = Buffer.alloc(length); if ((await file.read(central, 0, length, offset)).bytesRead !== length) fail()
    const members: { name: string; compressed: number; decoded: number; offset: number; method: number; crc: number; directory: boolean }[] = [], seen = new Set<string>(); let cursor = 0, total = 0
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > length || central.readUInt32LE(cursor) !== 0x02014b50) fail()
      const c = central.subarray(cursor), flags = c.readUInt16LE(8), method = c.readUInt16LE(10), n = c.readUInt16LE(28), extra = c.readUInt16LE(30), comment = c.readUInt16LE(32), mode = c.readUInt32LE(38) >>> 16
      if (flags & 1 || ![0, 8].includes(method) || mode & 0xf000 && ![0x8000, 0x4000].includes(mode & 0xf000) || cursor + 46 + n + extra + comment > length) fail()
      const raw = c.subarray(46, 46 + n).toString('utf8'), name = nameOf(raw), decoded = c.readUInt32LE(24), compressed = c.readUInt32LE(20)
      if (!name || seen.has(name.toLowerCase()) || (total += decoded) > DOWNLOAD_MAX_BYTES) fail(); seen.add(name.toLowerCase())
      members.push({ name, compressed, decoded, offset: c.readUInt32LE(42), method, crc: c.readUInt32LE(16), directory: raw.endsWith('/') }); cursor += 46 + n + extra + comment
    }
    if (only && !members.some(m => m.name === only && !m.directory)) fail()
    for (const m of members) {
      signal.throwIfAborted(); if (only && m.name !== only) continue
      const path = privatePath(destination, m.name); await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      if (m.directory) { await mkdir(path, { recursive: true, mode: 0o700 }); continue }
      const header = Buffer.alloc(30); if ((await file.read(header, 0, 30, m.offset)).bytesRead !== 30 || header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(8) !== m.method || header.readUInt16LE(6) & 1) fail()
      const start = m.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
      if (start + m.compressed > offset) fail()
      if (m.compressed === 0) { if (m.decoded !== 0 || m.crc !== 0) fail(); const empty = await open(path, 'wx', 0o600); await empty.close(); continue }
      let received = 0, crc = 0xffffffff
      const check = new Transform({ transform(chunk: Buffer, _encoding, cb) {
        received += chunk.length
        if (received > m.decoded) { cb(new Error('ZIP size overflow')); return }
        for (const byte of chunk) { crc ^= byte; for (let b = 0; b < 8; b++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0) }
        cb(null, chunk)
      } })
      const stream = createReadStream(source, { start, end: start + m.compressed - 1 }), output = createWriteStream(path, { flags: 'wx', mode: 0o600 })
      if (m.method === 8) await pipeline(stream, createInflateRaw(), check, output, { signal }); else await pipeline(stream, check, output, { signal })
      if (received !== m.decoded || (crc ^ 0xffffffff) >>> 0 !== m.crc) fail()
    }
  } finally { await file.close() }
}
