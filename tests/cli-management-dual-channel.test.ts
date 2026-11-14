/** 模拟：Windows 默认 Claude，进程/元数据/工件均为夹具；只写测试目录。 */
import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Readable } from 'node:stream'
import { ChannelMemory, channelMemoryKey, CHANNEL_MEMORY_TTL } from '../src/host/cli-management/channel-memory.ts'
import { serviceFixture, syntheticIdentity, checked, finished, childFixture } from './cli-management-phase-b-fixture.ts'
const simulated = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => simulated.home || '/模拟/home' }))
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
const fixtures: ReturnType<typeof serviceFixture>[] = []
const data = '模拟new', targetVersion = '1.2.3', checksum = createHash('sha256').update(data).digest('hex')
const child = (text = '', exitCode = 0) => ({ stdout: Readable.from([text]), stderr: Readable.from([]), done: Promise.resolve({ exitCode, signal: null }), terminate: vi.fn(), waitForExit: vi.fn(async () => true) })
function fixture() {
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' })
  const f = serviceFixture(['claude']); fixtures.push(f); simulated.home = f.root
  vi.stubEnv('LOCALAPPDATA', join(f.root, 'AppData/Local'))
  const target = join(f.root, '.local/bin/claude.exe'); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, 'old')
  const id = { ...syntheticIdentity('claude'), source: 'self-update' as const, executable: target, fingerprint: { realpath: target, size: 3, mtimeMs: 1 } }; f.identities.set('claude', id)
  f.version.mockImplementation(async () => readFileSync(target, 'utf8') === data ? targetVersion : '1.0.0')
  f.metadataFetch.mockImplementation(async url => new Response(JSON.stringify(String(url).endsWith('/dist-tags') ? { latest: targetVersion } : { version: targetVersion, platforms: { [`win32-${process.arch}`]: { binary: 'claude.exe', size: Buffer.byteLength(data), checksum } } })))
  f.artifactFetch.mockImplementation(async (_url, init) => new Response(init?.method === 'HEAD' ? null : data, { headers: { 'content-length': String(Buffer.byteLength(data)), etag: '"simulated"' } }))
  const memory = new ChannelMemory(f.root), key = channelMemoryKey('claude', id)
  const start = async () => { await checked(f.service); f.service.start('claude', 'update', f.service.snapshot().entries.find(e => e.cli === 'claude')!.planToken!, '', '模拟' + Math.random()); return (await finished(f.service)).results[0]! }
  return { ...f, memory, key, target, start }
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); simulated.home = ''; Object.defineProperty(process, 'platform', originalPlatform); vi.unstubAllEnvs(); vi.useRealTimers() })
it.each([0, 1])('模拟：先跑官方，版本前进即按官方结果结束（退出码 %s），清除过期记忆', async code => {
  const f = fixture(); await f.memory.set(f.key, 'OFFICIAL_STALLED', Date.now() - CHANNEL_MEMORY_TTL - 1)
  vi.mocked(f.backend.spawn).mockImplementation(spec => { expect(spec.argv).toEqual([f.target, 'update']); writeFileSync(f.target, data); return child('Updated\n', code) as any })
  expect(await f.start()).toMatchObject({ phase: 'succeeded', afterVersion: targetVersion, progress: { channel: 'official' } })
  expect(f.backend.spawn).toHaveBeenCalledOnce(); expect(f.artifactFetch).not.toHaveBeenCalled(); expect(await f.memory.get(f.key)).toBeUndefined()
  expect(readFileSync(f.memory.file, 'utf8')).toBe('{}')
})
it('模拟：官方退出 0 且已是最新，不接管、不记失败、不降级', async () => {
  const f = fixture(); vi.mocked(f.backend.spawn).mockImplementation(() => child('You are already on the latest version.\n') as any)
  expect(await f.start()).toMatchObject({ phase: 'succeeded', afterVersion: '1.0.0', progress: { reason: 'ALREADY_LATEST' } })
  expect(f.artifactFetch).not.toHaveBeenCalled(); expect(await f.memory.get(f.key)).toBeUndefined(); expect(readFileSync(f.target, 'utf8')).toBe('old')
})
it.each(['curl: (28) timeout\n', 'Download stalled\n', 'failure\n'])('模拟：官方失败 %s 只跑一次，切换接管成功后记住 7 天', async text => {
  const f = fixture(); vi.mocked(f.backend.spawn).mockImplementation(() => child(text, 1) as any)
  expect(await f.start()).toMatchObject({ phase: 'succeeded', afterVersion: targetVersion, progress: { channel: 'takeover', downloadedBytes: Buffer.byteLength(data) } })
  expect(f.backend.spawn).toHaveBeenCalledOnce(); expect(await f.memory.get(f.key)).toBeTruthy(); expect(readFileSync(f.target, 'utf8')).toBe(data)
})
it('模拟：近期记忆直接接管；接管自身失败清除记录，下次恢复官方优先', async () => {
  const f = fixture(); await f.memory.set(f.key, 'OFFICIAL_STALLED')
  expect(await f.start()).toMatchObject({ phase: 'succeeded', outputTail: expect.stringContaining('7 天内') }); expect(f.backend.spawn).not.toHaveBeenCalled()
  writeFileSync(f.target, 'old')
  f.artifactFetch.mockImplementation(async (_url, init) => new Response(init?.method === 'HEAD' ? null : 'x'.repeat(Buffer.byteLength(data)), { headers: { 'content-length': String(Buffer.byteLength(data)), etag: '"simulated"' } }))
  expect(await f.start()).toMatchObject({ phase: 'failed', error: { code: 'INTEGRITY_MISMATCH' } }); expect(await f.memory.get(f.key)).toBeUndefined()
  vi.mocked(f.backend.spawn).mockImplementation(() => child('Already up to date\n') as any)
  expect(await f.start()).toMatchObject({ phase: 'succeeded', progress: { channel: 'official' } }); expect(f.backend.spawn).toHaveBeenCalledOnce()
})
it('模拟：首次官方失败但接管校验失败，不留下官方失败记忆', async () => {
  const f = fixture(); vi.mocked(f.backend.spawn).mockImplementation(() => child('failure\n', 1) as any)
  f.artifactFetch.mockImplementation(async (_url, init) => new Response(init?.method === 'HEAD' ? null : 'x'.repeat(Buffer.byteLength(data)), { headers: { 'content-length': String(Buffer.byteLength(data)), etag: '"simulated"' } }))
  expect(await f.start()).toMatchObject({ phase: 'failed', error: { code: 'INTEGRITY_MISMATCH' } }); expect(await f.memory.get(f.key)).toBeUndefined()
})
it('模拟：官方锁冲突不记失败、不接管；零退出无最新证据也不伪报成功', async () => {
  const f = fixture(); vi.mocked(f.backend.spawn).mockImplementation(() => child('Another update process is running\n', 1) as any)
  expect(await f.start()).toMatchObject({ phase: 'failed', error: { code: 'UPDATE_LOCKED' } }); expect(await f.memory.get(f.key)).toBeUndefined(); expect(f.artifactFetch).not.toHaveBeenCalled()
  vi.mocked(f.backend.spawn).mockImplementation(() => child('No confirmation\n') as any)
  expect(await f.start()).toMatchObject({ phase: 'failed', error: { code: 'VERSION_UNCHANGED' } }); expect(f.artifactFetch).not.toHaveBeenCalled()
})
it.each(['confirmed', 'unconfirmed', 'cancel'] as const)('模拟：退出范围 %s 前不清理暂存、不接管，TERM grace 最多 5 秒且保留代理', async mode => {
  const f = fixture(), proc = childFixture()
  vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7890'); f.config.graceMs = 9000
  let spawned!: () => void
  const started = new Promise<void>(resolve => { spawned = resolve })
  const stage = join(f.root, '.cache/claude/staging/1.2.3.123.456/claude.exe')
  vi.mocked(f.backend.spawn).mockImplementation(spec => {
    expect(spec.graceMs).toBe(5000); expect(spec.env).not.toHaveProperty('HTTPS_PROXY'); expect(process.env.HTTPS_PROXY).toBe('http://127.0.0.1:7890')
    mkdirSync(dirname(stage), { recursive: true }); writeFileSync(stage, 'partial')
    spawned(); return proc.child as any
  })
  const pending = f.start(); await started
  if (mode === 'cancel') f.service.cancel(f.service.snapshot().operation!.id)
  else proc.child.stdout.write('curl: (28) download interrupted\n')
  await vi.waitFor(() => expect(proc.child.terminate).toHaveBeenCalled())
  expect(f.service.snapshot().results).toHaveLength(0); expect(f.artifactFetch).not.toHaveBeenCalled(); expect(existsSync(stage)).toBe(true)
  proc.finish(1)
  await vi.waitFor(() => expect(proc.child.waitForExit).toHaveBeenCalled())
  proc.exit(mode !== 'unconfirmed')
  const result = await pending
  if (mode === 'confirmed') { expect(result.phase).toBe('succeeded'); expect(existsSync(stage)).toBe(false); expect(await f.memory.get(f.key)).toBeTruthy() }
  else { expect(result.phase).toBe(mode === 'cancel' ? 'cancelled' : 'cleanup-unconfirmed'); expect(f.artifactFetch).not.toHaveBeenCalled(); expect(await f.memory.get(f.key)).toBeUndefined() }
  if (mode === 'unconfirmed') expect(existsSync(stage)).toBe(true)
})
it('模拟：取消记忆直达的接管下载时清除记录，不放置未完成文件', async () => {
  const f = fixture(); await f.memory.set(f.key, 'OFFICIAL_INTERRUPTED')
  let request!: () => void; const requested = new Promise<void>(resolve => { request = resolve })
  f.artifactFetch.mockImplementation(async (_url, init) => {
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'content-length': String(Buffer.byteLength(data)), etag: '"simulated"' } })
    request()
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); init?.signal?.addEventListener('abort', () => controller.error(new Error('模拟中止')), { once: true }) } }), { headers: { 'content-length': String(Buffer.byteLength(data)), etag: '"simulated"' } })
  })
  const pending = f.start(); await requested; f.service.cancel(f.service.snapshot().operation!.id)
  expect(await pending).toMatchObject({ phase: 'cancelled' }); expect(await f.memory.get(f.key)).toBeUndefined(); expect(readFileSync(f.target, 'utf8')).toBe('old')
})
