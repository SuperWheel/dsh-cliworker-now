/** 模拟：122 个微型包清单、环回服务与模拟 Pi 子进程；不访问公网。 */
import { it, expect, vi, afterEach } from 'vitest'
import { mkdtemp, realpath, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describePi, placePi, startVerifiedRegistry } from '../src/host/cli-management/artifacts/pi.ts'
import { ReleaseClient } from '../src/host/cli-management/versions.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
import { control, sri } from './cli-management-phase-b-fixture.ts'
const roots: string[] = []
afterEach(async () => { vi.unstubAllEnvs(); for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }) })
async function fixture() { const root = await realpath(await mkdtemp(join(tmpdir(), 'pi-update-simulated-'))); roots.push(root); return root }
it('模拟：Pi 锁定清单的 122 件均须 SHA-512，8 个缺失摘要从发布清单补齐', async () => {
  const root = await fixture(); await mkdir(join(root, '.pi/agent/install'), { recursive: true }); await writeFile(join(root, '.pi/agent/install/managed-install.json'), '{"kind":"pi-managed-install","layout":"releases-v1"}')
  const integrity = sri('simulated'), packages: Record<string, any> = { '': { version: '1.2.3' } }, release: any[] = []
  for (let i = 0; i < 122; i++) { const name = i < 8 ? `@earendil-works/pi-${i}` : `package-${i}`, resolved = `https://registry.npmjs.org/${name}/-/package-1.2.3.tgz`; packages[`node_modules/${name}`] = { version: '1.2.3', resolved, ...(i < 8 ? {} : { integrity }) }; if (i < 8) release.push({ name, version: '1.2.3', tarball: resolved, integrity }) }
  // 官方样本有 122 个安装条目、121 个 URL：嵌套依赖可以复用同一已校验包。
  packages['node_modules/package-121'] = { ...packages['node_modules/package-120'] }
  const fetcher = vi.fn(async (url: any) => new Response(JSON.stringify(String(url).endsWith('/package-lock.json') ? { version: '1.2.3', lockfileVersion: 3, packages } : { version: '1.2.3', packages: release })))
  const o: any = { root, home: root, version: '1.2.3', platform: 'darwin', identity: { executable: 'simulated-pi' }, signal: control(), releases: new ReleaseClient(fetcher) }
  const d = await describePi(o); expect(d.files).toHaveLength(122); if (d.placement.kind === 'registry') expect(Object.keys(d.placement.paths)).toHaveLength(121); expect(d.files.every(f => f.integrity === integrity && f.bytes === 'RANGE')).toBe(true)
  packages['node_modules/package-121'].integrity = sri('different'); await expect(describePi(o)).rejects.toThrow(); packages['node_modules/package-121'].integrity = integrity
  release[0].integrity = undefined; await expect(describePi(o)).rejects.toThrow()
})
it('模拟：环回 registry 只读、随机令牌、拒绝未登记路径与文件替换，取消关闭', async () => {
  const root = await fixture(), c = new AbortController(); await writeFile(join(root, 'one.tgz'), 'verified')
  const server = await startVerifiedRegistry(root, { '/pkg/-/one.tgz': 'one.tgz' }, c.signal)
  expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}\/$/)
  expect(await (await fetch(server.url + 'pkg/-/one.tgz')).text()).toBe('verified')
  expect((await fetch(new URL('/pkg/-/one.tgz', server.url))).status).toBe(404)
  expect((await fetch(server.url + 'pkg/-/one.tgz', { method: 'POST' })).status).toBe(405)
  expect((await fetch(server.url + '../one.tgz')).status).toBe(404)
  await writeFile(join(root, 'one.tgz'), 'changed'); expect((await fetch(server.url + 'pkg/-/one.tgz')).status).toBe(409)
  c.abort(); await server.close(); await expect(fetch(server.url)).rejects.toThrow()
})
it.each(['success', 'failure', 'cancel'] as const)('模拟：Pi 官方交接 %s 一律关闭环回服务并保留宿主代理', async mode => {
  const root = await fixture(), c = new AbortController(); await writeFile(join(root, 'one.tgz'), 'verified'); vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7890')
  let url = ''
  const backend = { spawn: vi.fn((spec: any) => { url = spec.env.npm_config_registry; expect(process.env.HTTPS_PROXY).toBe('http://127.0.0.1:7890'); expect(spec.env).not.toHaveProperty('HTTPS_PROXY'); expect(spec.env).not.toHaveProperty('PI_INSTALLER_API_BASE'); if (mode === 'cancel') c.abort(); return { stdout: Readable.from([]), stderr: Readable.from([]), done: Promise.resolve({ exitCode: mode === 'failure' ? 1 : 0, signal: null }), waitForExit: async () => true, terminate() {} } }) }
  const d: any = { placement: { kind: 'registry', argv: ['simulated-pi', 'update', '--self'], paths: { '/pkg/-/one.tgz': 'one.tgz' } } }
  const promise = placePi(d, root, c.signal, { backend, config: DEFAULT_CONFIG, output: vi.fn() } as any)
  if (mode === 'success') await promise; else await expect(promise).rejects.toThrow()
  await expect(fetch(url)).rejects.toThrow(); expect(backend.spawn).toHaveBeenCalledTimes(1)
})
