/** 模拟微型 tar 夹具，不含真实工件。 */
import { gzipSync } from 'node:zlib'
export function tarFixture(items: { name: string; data?: string; type?: string; link?: string }[]) {
  const chunks: Buffer[] = []
  for (const i of items) {
    const h = Buffer.alloc(512), bytes = Buffer.from(i.data ?? '')
    h.write(i.name, 0, 100); h.write('0000755\0', 100); h.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124); h.fill(32, 148, 156); h.write(i.type ?? '0', 156); h.write(i.link ?? '', 157, 100); h.write('ustar\0', 257)
    h.write(h.reduce((s, n) => s + n, 0).toString(8).padStart(6, '0') + '\0 ', 148)
    chunks.push(h, bytes, Buffer.alloc((512 - bytes.length % 512) % 512))
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]))
}
