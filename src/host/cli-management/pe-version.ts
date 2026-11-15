import { open } from 'node:fs/promises'

export interface PeVersion {
  /** Four numeric components from VS_FIXEDFILEINFO.dwProductVersionMS/LS. */
  productVersion: string
  productName?: string
  stringProductVersion?: string
}
export const PE_VERSION_READ_LIMIT = 256 * 1024
const align4 = (value: number) => Math.ceil(value / 4) * 4
const invalid = (): never => { throw new Error('Invalid PE version resource') }
const range = (offset: number, length: number, end: number) => {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > end) invalid()
}

/** Bounded positional reads only; never load or execute the image. Malformed files fail closed.
 * Layout: https://learn.microsoft.com/en-us/windows/win32/debug/pe-format
 * Version blocks: https://learn.microsoft.com/en-us/windows/win32/menurc/vs-versioninfo
 */
export async function readPeVersion(path: string): Promise<PeVersion | undefined> {
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    file = await open(path, 'r')
    const info = await file.stat()
    if (!info.isFile()) return
    let total = 0
    const read = async (offset: number, length: number) => {
      range(offset, length, info.size)
      total += length
      if (total > PE_VERSION_READ_LIMIT) invalid()
      const bytes = Buffer.alloc(length)
      if ((await file!.read(bytes, 0, length, offset)).bytesRead !== length) invalid()
      return bytes
    }
    const dos = await read(0, 64)
    if (dos.readUInt16LE(0) !== 0x5a4d) return
    const peOffset = dos.readUInt32LE(60)
    if (peOffset < 64) return
    const pe = await read(peOffset, 24)
    if (pe.readUInt32LE(0) !== 0x4550) return
    const count = pe.readUInt16LE(6), optionalSize = pe.readUInt16LE(20)
    if (!count || count > 96 || optionalSize > 4096) return
    const optional = await read(peOffset + 24, optionalSize)
    const magic = optional.readUInt16LE(0), directories = magic === 0x10b ? 96 : magic === 0x20b ? 112 : invalid()
    range(directories - 4, 4 + 24, optional.length)
    if (optional.readUInt32LE(directories - 4) < 3) return
    const resourceRva = optional.readUInt32LE(directories + 16), resourceSize = optional.readUInt32LE(directories + 20)
    if (!resourceRva || !resourceSize) return
    const sections = await read(peOffset + 24 + optionalSize, count * 40)
    let raw: number | undefined, base = 0, rawSize = 0
    for (let i = 0; i < count; i++) {
      const section = sections.subarray(i * 40, (i + 1) * 40)
      if (section.toString('ascii', 0, 8).replace(/\0.*$/, '') !== '.rsrc') continue
      if (raw !== undefined) invalid()
      base = section.readUInt32LE(12); rawSize = section.readUInt32LE(16); raw = section.readUInt32LE(20)
      range(raw, rawSize, info.size)
    }
    if (raw === undefined || resourceRva < base) return
    const root = resourceRva - base
    range(root, resourceSize, rawSize)
    const resourceRead = (offset: number, length: number) => {
      range(offset, length, resourceSize)
      return read(raw! + root + offset, length)
    }
    const directory = async (offset: number) => {
      const header = await resourceRead(offset, 16)
      const entries = header.readUInt16LE(12) + header.readUInt16LE(14)
      if (!entries || entries > 256) invalid()
      const bytes = await resourceRead(offset + 16, entries * 8)
      return Array.from({ length: entries }, (_, i) => ({ id: bytes.readUInt32LE(i * 8), target: bytes.readUInt32LE(i * 8 + 4) }))
    }
    // Resource hierarchy is type -> name -> language -> data, never recursive.
    const type = (await directory(0)).find(entry => entry.id === 16)
    if (!type || !(type.target & 0x80000000)) return
    const name = (await directory(type.target & 0x7fffffff))[0]!
    if (!(name.target & 0x80000000)) return
    const language = (await directory(name.target & 0x7fffffff))[0]!
    if (language.target & 0x80000000) return
    const data = await resourceRead(language.target, 16)
    const rva = data.readUInt32LE(0), size = data.readUInt32LE(4)
    if (rva < resourceRva || size < 6 || size > 65535) return
    return parseVersion(await resourceRead(rva - resourceRva, size))
  } catch { return undefined }
  finally { await file?.close().catch(() => {}) }
}

function parseVersion(bytes: Buffer): PeVersion {
  interface Block { key: string; type: number; value: number; valueSize: number; children: number; end: number }
  let blocks = 0
  const block = (start: number, limit: number): Block => {
    if (++blocks > 512) invalid()
    range(start, 6, limit)
    const size = bytes.readUInt16LE(start), length = bytes.readUInt16LE(start + 2), type = bytes.readUInt16LE(start + 4)
    if (size < 6 || type > 1) invalid()
    range(start, size, limit)
    const end = start + size
    let cursor = start + 6
    while (true) { range(cursor, 2, end); if (bytes.readUInt16LE(cursor) === 0) break; cursor += 2 }
    const key = bytes.toString('utf16le', start + 6, cursor), value = align4(cursor + 2), valueSize = length * (type === 1 ? 2 : 1)
    range(value, valueSize, end)
    return { key, type, value, valueSize, children: align4(value + valueSize), end }
  }
  const children = (parent: Block) => {
    const result: Block[] = []
    for (let cursor = parent.children; cursor < parent.end;) {
      const child = block(cursor, parent.end); result.push(child); cursor = align4(child.end)
    }
    return result
  }
  const root = block(0, bytes.length)
  if (root.key !== 'VS_VERSION_INFO' || root.type !== 0 || root.valueSize !== 52 || bytes.readUInt32LE(root.value) !== 0xfeef04bd) invalid()
  const ms = bytes.readUInt32LE(root.value + 16), ls = bytes.readUInt32LE(root.value + 20)
  const result: PeVersion = { productVersion: [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff].join('.') }
  for (const child of children(root)) {
    if (child.key !== 'StringFileInfo' && child.key !== 'VarFileInfo') invalid()
    if (child.valueSize) invalid()
    for (const table of children(child)) {
      if (child.key === 'VarFileInfo') continue
      if (table.valueSize || !/^[a-f\d]{8}$/i.test(table.key)) invalid()
      for (const item of children(table)) {
        if (item.type !== 1 || item.valueSize < 2 || bytes.readUInt16LE(item.value + item.valueSize - 2) !== 0 || item.children < item.end) invalid()
        // Like VerQueryValue, a string ends at its first NUL. Electron's rcedit pads some values
        // with an extra terminator (ZCode 3.14.5 SquirrelAwareVersion: 6 bytes for "1").
        const value = bytes.toString('utf16le', item.value, item.value + item.valueSize - 2).split('\0')[0]!
        const field = item.key === 'ProductName' ? 'productName' : item.key === 'ProductVersion' ? 'stringProductVersion' : undefined
        if (field) {
          if (result[field] !== undefined && result[field] !== value) invalid()
          result[field] = value
        }
      }
    }
  }
  return result
}
