import { tarFixture } from './cli-management-task4-fixture.ts'
/** 模拟：手工构造微型归档，绝不下载真实工件。 */
import { it, expect, afterEach, vi } from 'vitest'
import { gzipSync, deflateRawSync } from 'node:zlib'
import { mkdtemp, realpath, writeFile, readFile, rm, lstat, readlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { extractTar, extractZip } from '../src/host/cli-management/artifacts/archive.ts'
import { placeRelease } from '../src/host/cli-management/artifacts/transaction.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
import { Readable } from 'node:stream'
import { control } from './cli-management-phase-b-fixture.ts'
const roots: string[] = []
afterEach(async () => { for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }) })
function zipFixture(name: string, body = 'simulated', mode = 0o100644, wrongCrc = false) {
  const data = Buffer.from(body), compressed = deflateRawSync(data), n = Buffer.from(name); let crc = 0xffffffff
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0) } crc = (crc ^ 0xffffffff) >>> 0
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26)
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10); central.writeUInt32LE(wrongCrc ? 0 : crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE((mode << 16) >>> 0, 38)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + n.length, 12); end.writeUInt32LE(local.length + n.length + compressed.length, 16)
  return Buffer.concat([local, n, compressed, central, n, end])
}
async function fixture(bytes: Buffer, extension = 'tar.gz') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'archive-simulated-'))); roots.push(root)
  const source = join(root, `package.${extension}`); await writeFile(source, bytes); return { root, source, dest: join(root, 'extracted') }
}
it('模拟：tar 逐成员流式解压，保留安全内部相对链接和官方执行权限', async () => {
  const f = await fixture(tarFixture([{ name: 'bin/codex', data: 'simulated' }, { name: 'codex', type: '2', link: 'bin/codex' }]))
  await extractTar(f.source, f.dest, control())
  expect(await readFile(join(f.dest, 'codex'), 'utf8')).toBe('simulated'); expect((await lstat(join(f.dest, 'bin/codex'))).mode & 0o777).toBe(0o755)
})
it.each([
  [{ name: '../escape', data: 'x' }], [{ name: '/absolute', data: 'x' }], [{ name: 'link', type: '2', link: '../../escape' }],
  [{ name: 'link', type: '2', link: 'bin' }, { name: 'link/tool', data: 'x' }], [{ name: 'bin/a', data: 'x' }, { name: 'bin', type: '2', link: 'other' }],
  [{ name: 'a', data: 'x' }, { name: 'a', data: 'y' }], [{ name: 'hard', type: '1', link: 'a' }], [{ name: 'device', type: '3' }],
  // 审查发现：词法 normalize 看不出的链式越界（dir/a -> ../other 后再 ../../outside）
  [{ name: 'other/keep', data: 'x' }, { name: 'dir/a', type: '2', link: '../other' }, { name: 'escape', type: '2', link: 'dir/a/../../outside' }],
  [{ name: 'loop1', type: '2', link: 'loop2' }, { name: 'loop2', type: '2', link: 'loop1/x' }]
].map(items => [items]))('模拟：tar 拒绝越界、链接穿透、重复及特殊成员 %#', async items => {
  const f = await fixture(tarFixture(items)); await expect(extractTar(f.source, f.dest, control())).rejects.toThrow()
})
it('模拟：ZIP 校验中央目录、真实 CRC 与单成员结果', async () => {
  const f = await fixture(zipFixture('mimo.exe'), 'zip'); await extractZip(f.source, f.dest, control(), 'mimo.exe'); expect(await readFile(join(f.dest, 'mimo.exe'), 'utf8')).toBe('simulated')
})
it.each(['../escape', '/absolute', 'C:/escape', 'a\\escape'])('模拟：ZIP 拒绝路径 %s', async name => {
  const f = await fixture(zipFixture(name), 'zip'); await expect(extractZip(f.source, f.dest, control())).rejects.toThrow()
})
it.each(['symlink', 'crc'])('模拟：ZIP 拒绝 %s', async mode => {
  const f = await fixture(zipFixture('tool', 'simulated', mode === 'symlink' ? 0o120777 : 0o100644, mode === 'crc'), 'zip'); await expect(extractZip(f.source, f.dest, control())).rejects.toThrow()
})
it('模拟：Codex 预置完整 release 后才以参数数组调用官方脚本', async () => {
  const f = await fixture(tarFixture([{ name: 'codex-package.json', data: '{"execServer":"bin/codex-exec-server"}' }, ...['bin/codex', 'bin/codex-code-mode-host', 'bin/codex-exec-server', 'codex-path/rg', 'codex-resources/bwrap'].map(name => ({ name, data: 'simulated' }))]))
  const target = join(f.root, 'releases/1.2.3-aarch64-unknown-linux-musl'), run = vi.fn(async () => { expect(await readlink(join(target, 'codex'))).toBe('bin/codex') })
  const backend = { spawn: vi.fn(() => ({ stdout: Readable.from(['codex-cli 1.2.3\n']), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), waitForExit: async () => true, terminate() {} })) }
  const d: any = { allowedTargets: [target], platform: 'linux', placement: { kind: 'release-package', archive: 'package.tar.gz', target, version: '1.2.3', argv: ['/bin/sh', 'install.sh', '--release', '1.2.3'] } }
  await placeRelease(d, f.root, control(), { backend, config: DEFAULT_CONFIG } as any, run)
  expect(run).toHaveBeenCalledWith(['/bin/sh', 'install.sh', '--release', '1.2.3'], expect.any(AbortSignal))
})

it.each(['x', 'L'])('模拟：tar %s 长路径元数据仍执行成员安全检查', async type => {
  const pax = (path: string) => { const value = `path=${path}\n`; let size = Buffer.byteLength(value) + 3; while (Buffer.byteLength(`${size} ${value}`) !== size) size = Buffer.byteLength(`${size} ${value}`); return `${size} ${value}` }
  const make = (path: string) => tarFixture([{ name: 'metadata', type, data: type === 'x' ? pax(path) : path + '\0' }, { name: 'placeholder', data: 'simulated' }])
  const f = await fixture(make('bin/tool')); await extractTar(f.source, f.dest, control()); expect(await readFile(join(f.dest, 'bin/tool'), 'utf8')).toBe('simulated')
  const bad = await fixture(make('../escape')); await expect(extractTar(bad.source, bad.dest, control())).rejects.toThrow()
})
