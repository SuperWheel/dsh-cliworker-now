/** 模拟：阶段 B 六项审查回归；HTTP、Node/npm、CLI 和进程全部为夹具，绝不执行真实安装。 */
import { afterEach, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { CliManagementCache } from '../src/host/cli-management/cache.ts'
import { CliManagementService } from '../src/host/cli-management/service.ts'
import { nativeLaunchArgv } from '../src/host/native-launch.mjs'
import { operationArgv, planCliOperation, sameInstallation } from '../src/host/cli-management/planner.ts'
import { resolveNpmRuntime } from '../src/host/cli-management/npm.ts'
import type { InstallationIdentity } from '../src/host/cli-management/identity.ts'
import { checked, finished, serviceFixture, syntheticIdentity, npmFixture, until, sri } from './cli-management-phase-b-fixture.ts'

const fixtures: ReturnType<typeof serviceFixture>[] = []
const fixture = () => { const f = serviceFixture(); fixtures.push(f); return f }
afterEach(async () => { vi.useRealTimers(); for (const f of fixtures.splice(0)) await f.close() })
const exited = () => ({ stdout: Readable.from([]), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), waitForExit: vi.fn(async () => true), terminate: vi.fn() })
const start = (f: ReturnType<typeof fixture>) => f.service.start('codex', 'update', f.service.snapshot().entries.find(e => e.cli === 'codex')!.planToken!, '', '模拟-review')

it.each(['official', 'npmmirror'] as const)('模拟 P1：%s 主包以官方 sha512 验算后才安装本地 tgz', async source => {
  const f = fixture(); f.service.saveDownloadSource({ source }); await checked(f.service)
  let tarball = ''
  vi.mocked(f.backend.spawn).mockImplementation(options => {
    const argv = options.argv
    tarball = argv.find(a => a.endsWith('.tgz'))!
    expect(readFileSync(tarball, 'utf8')).toBe('模拟')
    expect(argv).toEqual([f.npm.node, f.npm.entry, 'install', '--global', '--prefix', '/模拟', tarball, '--registry', source === 'official' ? 'https://registry.npmjs.org/' : 'https://registry.npmmirror.com/', '--prefer-offline', '--include=optional'])
    expect(argv).not.toContain('@openai/codex@1.2.3')
    f.identities.set('codex', syntheticIdentity('codex', '1.2.3')); return exited()
  })
  start(f); const result = (await finished(f.service)).results[0]!
  expect(result).toMatchObject({ phase: 'succeeded', integritySource: 'https://registry.npmjs.org/', progress: { readable: false, byteProgress: false } })
  expect(String(f.artifactFetch.mock.calls[0]![0])).toContain('registry.npmjs.org')
  expect(existsSync(tarball)).toBe(false)
})

it.each(['official', 'npmmirror'] as const)('模拟 P1：%s packument 保留官方摘要但替换 tarball 字节时拒绝并删片段', async source => {
  const f = fixture(); f.service.saveDownloadSource({ source }); await checked(f.service)
  f.metadataFetch.mockImplementation(async () => new Response(JSON.stringify({ name: '@openai/codex', version: '1.2.3', dist: { integrity: sri('模拟'), tarball: 'https://mirror.invalid/replaced.tgz' } })))
  f.artifactFetch.mockImplementation(async (_url, init) => new Response(init?.method === 'HEAD' ? null : '模拟恶意替换内容', { headers: { 'content-length': String(Buffer.byteLength('模拟恶意替换内容')), etag: '"fixture-object"' } }))
  start(f)
  expect((await finished(f.service)).results[0]?.error?.code).toBe('INTEGRITY_MISMATCH')
  expect(f.artifactFetch.mock.calls.filter(call => call[1]?.method !== 'HEAD')).toHaveLength(2)
  expect(f.backend.spawn).not.toHaveBeenCalled()
  expect(f.artifactFetch).toHaveBeenCalledWith('https://registry.npmjs.org/@openai/codex/-/codex-1.2.3.tgz', expect.any(Object))
  expect(f.artifactFetch.mock.calls.some(call => String(call[0]).includes('mirror.invalid'))).toBe(false)
  expect(readdirSync(join(f.root, 'cli-management/downloads'))).toEqual([])
})

it('模拟 P1：npm 主包缺少官方 sha512 时不下载、不安装', async () => {
  const f = fixture(); await checked(f.service)
  f.metadataFetch.mockImplementation(async () => new Response(JSON.stringify({ name: '@openai/codex', version: '1.2.3', dist: { integrity: sri('模拟', 'sha256'), tarball: 'https://mirror.invalid/main.tgz' } })))
  start(f); expect((await finished(f.service)).results[0]?.error?.code).toBe('INTEGRITY_MISMATCH')
  expect(f.artifactFetch).not.toHaveBeenCalled(); expect(f.backend.spawn).not.toHaveBeenCalled()
})

it('模拟 P1：下载期间取消删除片段且不启动 npm', async () => {
  const f = fixture(); await checked(f.service)
  f.artifactFetch.mockImplementation(async (_url, init) => new Response(init?.method === 'HEAD' ? null : new ReadableStream({ start(c) { c.enqueue(Buffer.from('模拟')); } }), { headers: { 'content-length': '6', etag: '"fixture-object"' } }))
  const op = start(f).operation!
  await until(() => (f.service.snapshot().operation?.progress?.downloadedBytes ?? 0) > 0)
  expect(f.service.snapshot().operation?.phase).toBe('downloading'); f.service.cancel(op.id)
  expect((await finished(f.service)).results[0]?.phase).toBe('cancelled')
  expect(f.backend.spawn).not.toHaveBeenCalled(); expect(readdirSync(join(f.root, 'cli-management/downloads'))).toEqual([])
})

it('模拟 P1：主包下载超过准备阶段 30 秒仍可续传、核对并安装', async () => {
  vi.useFakeTimers(); const f = fixture(); f.service.saveDownloadSource({ source: 'custom', customUrl: 'https://registry.npmjs.org/' }); await checked(f.service)
  const bytes = Buffer.from('模拟')
  let n = 0
  f.artifactFetch.mockImplementation(async (_url, init) => {
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'content-length': String(bytes.length), etag: '"fixture-object"' } })
    n++
    if (n === 1) return new Response(new ReadableStream({ start(c) { c.enqueue(bytes.subarray(0, 1)) } }), { headers: { 'content-length': String(bytes.length), etag: '"fixture-object"' } })
    expect((init!.headers as Record<string, string>).Range).toBe('bytes=1-')
    if (n < 5) return new Response(new ReadableStream({ start() {} }), { status: 206, headers: { 'content-range': `bytes 1-${bytes.length - 1}/${bytes.length}`, etag: '"fixture-object"' } })
    return new Response(bytes.subarray(1), { status: 206, headers: { 'content-range': `bytes 1-${bytes.length - 1}/${bytes.length}`, etag: '"fixture-object"' } })
  })
  vi.mocked(f.backend.spawn).mockImplementation(() => { f.identities.set('codex', syntheticIdentity('codex', '1.2.3')); return exited() })
  start(f)
  await vi.waitFor(() => expect(f.service.snapshot().operation?.progress?.downloadedBytes).toBe(1), { interval: 1 })
  await vi.advanceTimersByTimeAsync(40_010)
  const result = (await finished(f.service)).results[0]!
  expect(result).toMatchObject({ phase: 'succeeded', progress: { readable: false, byteProgress: false } })
})

it('模拟 P2：POSIX 自定义全局前缀仅作为安装目标，npm 与 Node 从独立安装解析', async () => {
  const f = fixture(), id = { ...syntheticIdentity(), prefix: join(f.root, '自定义 global prefix') }
  const plan = planCliOperation('codex', 'update', id, '1.0.0', '1.2.3', 'https://registry.npmjs.org/')
  expect(await operationArgv(plan, f.backend, '/模拟/main.tgz')).toEqual([f.npm.node, f.npm.entry, 'install', '--global', '--prefix', id.prefix, '/模拟/main.tgz', '--registry', plan.registry, '--prefer-offline', '--include=optional'])
  expect(f.backend.resolveExecutable).toHaveBeenCalledWith('npm')
  expect(vi.mocked(f.backend.resolveExecutable).mock.calls.some(([path]) => path.startsWith(id.prefix))).toBe(false)
  expect(f.backend.spawn).not.toHaveBeenCalled()
})

it.each(['manifest', 'entry', 'runtime'] as const)('模拟 P2：npm/Node %s 无效时拒绝启动', async field => {
  const f = fixture()
  if (field === 'manifest') writeFileSync(join(f.npm.pkg, 'package.json'), JSON.stringify({ name: 'other', bin: { npm: 'bin/npm-cli.js' } }))
  if (field === 'entry') unlinkSync(f.npm.entry)
  if (field === 'runtime') writeFileSync(f.npm.node, '#!/bin/sh\n# 模拟 wrapper')
  await expect(resolveNpmRuntime(f.backend)).rejects.toMatchObject({ code: 'PREREQUISITE_MISSING' })
  expect(f.backend.spawn).not.toHaveBeenCalled()
})

it('模拟 P2/P3：官方 npm.cmd 结构不交给 inspectBatch，Program Files Node 与 AppData 包前缀分离', async () => {
  const f = fixture(), npm = npmFixture(f.root, 'win32')
  expect(readFileSync(npm.launcher, 'utf8')).toContain('NPM_PREFIX_JS')
  expect(() => nativeLaunchArgv([npm.launcher, 'install'], 'win32')).toThrow()
  vi.mocked(f.backend.resolveExecutable).mockImplementation(async name => name === 'npm.cmd' ? npm.launcher : npm.node)
  const prefix = 'C:\\Users\\模拟 User\\AppData\\Roaming\\npm'
  const plan = planCliOperation('codex', 'update', { ...syntheticIdentity(), prefix }, '1.0.0', '1.2.3', 'https://registry.npmjs.org/')
  const argv = await operationArgv(plan, f.backend, 'C:\\模拟 cache\\verified.tgz', 'win32')
  expect(argv).toEqual([npm.node, npm.entry, 'install', '--global', '--prefix', prefix, 'C:\\模拟 cache\\verified.tgz', '--registry', plan.registry, '--prefer-offline', '--include=optional'])
  expect(nativeLaunchArgv(argv, 'win32')).toEqual(argv)
  expect(argv.join(' ')).not.toMatch(/cmd\.exe|cmd \/c|npm\.cmd/)
  expect(f.backend.spawn).not.toHaveBeenCalled()
})

it('模拟：宿主解析器拒绝官方 npm.cmd 时，改用 node.exe 同目录的官方 npm.cmd，并照旧校验', async () => {
  const f = fixture(), npm = npmFixture(f.root, 'win32')
  vi.mocked(f.backend.resolveExecutable).mockImplementation(async name => { if (name === 'npm.cmd') throw new Error('模拟 inspectBatch 拒绝'); return npm.node })
  expect(await resolveNpmRuntime(f.backend, 'win32')).toEqual([npm.node, npm.entry])
  unlinkSync(npm.entry)
  await expect(resolveNpmRuntime(f.backend, 'win32')).rejects.toMatchObject({ code: 'PREREQUISITE_MISSING' })
  expect(f.backend.spawn).not.toHaveBeenCalled()
})

function brewed(version: string, kind = 'Caskroom', name = 'codex'): InstallationIdentity {
  return { executable: '/模拟 brew/bin/codex', prefix: '/模拟 brew', source: 'brew', manifestVersion: version,
    packageRoot: `/模拟 brew/${kind}/${name}/${version}/lib`, fingerprint: { realpath: `/模拟 brew/${kind}/${name}/${version}/bin/cli`, size: 10, mtimeMs: 100 } }
}
it.each([['Caskroom', 'codex', 'codex'], ['Cellar', 'opencode', 'opencode']] as const)('模拟 P4：%s 同一包版本目录允许变化', (kind, name, cli) => {
  expect(sameInstallation(brewed('1.0.0', kind, name), brewed('1.2.3', kind, name), cli)).toBe(true)
})
it.each(['prefix', 'package', 'kind', 'entry', 'executable', 'source'] as const)('模拟 P4：Homebrew %s 身份变化仍拒绝', change => {
  const before = brewed('1.0.0'), after = brewed('1.2.3')
  if (change === 'prefix') after.prefix = '/other'
  if (change === 'package') after.fingerprint.realpath = after.fingerprint.realpath.replace('/codex/', '/other/')
  if (change === 'kind') after.fingerprint.realpath = after.fingerprint.realpath.replace('/Caskroom/', '/Cellar/')
  if (change === 'entry') after.fingerprint.realpath += '.other'
  if (change === 'executable') after.executable = '/other/bin/codex'
  if (change === 'source') after.source = 'npm'
  expect(sameInstallation(before, after, 'codex')).toBe(false)
})
it('模拟 P4：Homebrew 更新跨版本目录后仍核对目标版本', async () => {
  const f = fixture(); f.identities.set('codex', brewed('1.0.0'))
  vi.spyOn(f.releases, 'query').mockResolvedValue({ latest: '1.2.3', versions: ['1.2.3'], checkedAt: Date.now(), registry: 'https://formulae.brew.sh/' })
  await checked(f.service)
  vi.mocked(f.backend.spawn).mockImplementation(() => { f.identities.set('codex', brewed('1.2.3')); return exited() })
  start(f); expect((await finished(f.service)).results[0]?.phase).toBe('succeeded')
  expect(f.artifactFetch).not.toHaveBeenCalled()
})

it('模拟 P6：成功后分组、徽标数据、身份与版本缓存跨服务重启均更新', async () => {
  const f = fixture(); await checked(f.service)
  expect(f.service.snapshot().entries.filter(e => e.group === 'updatable')).toHaveLength(1)
  vi.mocked(f.backend.spawn).mockImplementation(() => { f.identities.set('codex', syntheticIdentity('codex', '1.2.3')); return exited() })
  start(f); const snapshot = await finished(f.service)
  expect(snapshot.entries.filter(e => e.group === 'updatable')).toHaveLength(0)
  expect(snapshot.entries.find(e => e.cli === 'codex')).toMatchObject({ group: 'latest', source: 'npm', currentVersion: '1.2.3', planToken: undefined, reason: undefined })
  const disk = new CliManagementCache(f.root)
  expect(disk.entries().find(e => e.cli === 'codex')).toMatchObject({ group: 'latest', currentVersion: '1.2.3' })
  expect(disk.version('codex', syntheticIdentity('codex', '1.2.3').fingerprint)).toEqual({ version: '1.2.3' })
  expect((f.service as any).identities.get('codex')).toEqual(syntheticIdentity('codex', '1.2.3'))
  expect(f.service.updateAll('after-success').queue).toEqual([]); expect(f.service.snapshot().operation).toBeUndefined()
  await f.service.close()
  const restored = new CliManagementService((f.service as any).deps)
  try {
    expect(restored.snapshot().entries.find(e => e.cli === 'codex')).toMatchObject({ group: 'latest', currentVersion: '1.2.3' })
    expect(restored.snapshot().entries.filter(e => e.group === 'updatable')).toHaveLength(0)
  } finally { await restored.close() }
})
