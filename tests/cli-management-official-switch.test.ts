/** 模拟：Windows 默认 Claude，进程/元数据/工件均为夹具；只写测试目录。 */
import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Readable } from 'node:stream'
import { OfficialWatch } from '../src/host/cli-management/official-watch.ts'
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
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); simulated.home = ''; Object.defineProperty(process, 'platform', originalPlatform); vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks() })

it.each(['confirmed', 'unconfirmed', 'cancel', 'takeover-failed'] as const)('模拟：手动官方接管 %s，等待退出后清理并按自动看门狗记录失败记忆', async mode => {
  const f = fixture(), proc = childFixture()
  let watch: OfficialWatch | undefined
  const prepare = OfficialWatch.prepare
  vi.spyOn(OfficialWatch, 'prepare').mockImplementation(async (...args) => { watch = await prepare(...args); return watch })
  const stage = join(f.root, '.cache/claude/staging/1.2.3.123.456/claude.exe')
  vi.mocked(f.backend.spawn).mockImplementation(() => {
    mkdirSync(dirname(stage), { recursive: true }); writeFileSync(stage, 'partial')
    return proc.child as any
  })
  if (mode === 'takeover-failed') f.artifactFetch.mockImplementation(async (_url, init) => new Response(init?.method === 'HEAD' ? null : 'x'.repeat(Buffer.byteLength(data)), { headers: { 'content-length': String(Buffer.byteLength(data)), etag: '"simulated"' } }))
  const pending = f.start()
  await vi.waitFor(() => expect(f.backend.spawn).toHaveBeenCalledOnce())
  watch!.requestTakeover(); watch!.requestTakeover()
  await vi.waitFor(() => expect(proc.child.terminate).toHaveBeenCalled())
  if (mode === 'cancel') f.service.cancel(f.service.snapshot().operation!.id)
  expect(f.service.snapshot().results).toHaveLength(0)
  expect(f.service.snapshot().operation!.progress?.channel).toBe('official')
  expect(f.artifactFetch).not.toHaveBeenCalled()
  expect(existsSync(stage)).toBe(true); expect(await f.memory.get(f.key)).toBeUndefined()
  proc.finish(1)
  await vi.waitFor(() => expect(proc.child.waitForExit).toHaveBeenCalled())
  expect(f.artifactFetch).not.toHaveBeenCalled(); expect(existsSync(stage)).toBe(true)
  proc.exit(mode !== 'unconfirmed')
  const result = await pending
  if (mode === 'confirmed') {
    expect(result).toMatchObject({ phase: 'succeeded', progress: { channel: 'takeover', reason: 'OFFICIAL_INTERRUPTED' } })
    expect(existsSync(stage)).toBe(false)
    expect(await f.memory.get(f.key)).toMatchObject({ reason: 'OFFICIAL_INTERRUPTED' })
  } else {
    expect(result.phase).toBe(mode === 'cancel' ? 'cancelled' : mode === 'unconfirmed' ? 'cleanup-unconfirmed' : 'failed')
    expect(await f.memory.get(f.key)).toBeUndefined()
    if (mode === 'unconfirmed') expect(existsSync(stage)).toBe(true)
    if (mode !== 'takeover-failed') expect(f.artifactFetch).not.toHaveBeenCalled()
  }
  expect(f.backend.spawn).toHaveBeenCalledOnce()
})
