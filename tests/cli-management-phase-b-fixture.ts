/** 模拟：所有 CLI、发布源、账号和进程退出都由夹具提供，不调用本机 CLI。 */
import { vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, PassThrough } from 'node:stream'
import { createHash } from 'node:crypto'
import { CliManagementService } from '../src/host/cli-management/service.ts'
import { CliMaintenance } from '../src/host/cli-management/maintenance.ts'
import { ReleaseClient } from '../src/host/cli-management/versions.ts'
import { CLI_SOURCES } from '../src/host/cli-management/sources.ts'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
import type { hostFetch } from '../src/host/host-fetch.mjs'
import type { InstallationIdentity } from '../src/host/cli-management/identity.ts'
import type { ActiveCliId } from '../src/shared/types.ts'
export const control = () => new AbortController().signal
export const sri = (value: string | Buffer, algorithm = 'sha512') => `${algorithm}-${createHash(algorithm).update(value).digest('base64')}`
// 模拟：官方 npm.cmd 的结构，含 npm-prefix.js 与 FOR /F；不是 cmd-shim。
export const officialNpmCmd = String.raw`:: Created by npm, please don't edit manually.
@ECHO OFF
SETLOCAL
SET "NODE_EXE=%~dp0\node.exe"
IF NOT EXIST "%NODE_EXE%" (
  SET "NODE_EXE=node"
)
SET "NPM_PREFIX_JS=%~dp0\node_modules\npm\bin\npm-prefix.js"
SET "NPM_CLI_JS=%~dp0\node_modules\npm\bin\npm-cli.js"
FOR /F "delims=" %%F IN ('CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"') DO (
  SET "NPM_PREFIX_NPM_CLI_JS=%%F\node_modules\npm\bin\npm-cli.js"
)
IF EXIST "%NPM_PREFIX_NPM_CLI_JS%" (
  SET "NPM_CLI_JS=%NPM_PREFIX_NPM_CLI_JS%"
)
"%NODE_EXE%" "%NPM_CLI_JS%" %*
`
export function npmFixture(root: string, platform = process.platform) {
  const distribution = join(root, platform === 'win32' ? 'Program Files/模拟 Node' : '模拟 node-distribution')
  const bin = platform === 'win32' ? distribution : join(distribution, 'bin')
  const pkg = join(distribution, platform === 'win32' ? 'node_modules/npm' : 'lib/node_modules/npm')
  mkdirSync(bin, { recursive: true }); mkdirSync(join(pkg, 'bin'), { recursive: true })
  const node = join(bin, platform === 'win32' ? 'node.exe' : 'node'), entry = join(pkg, 'bin/npm-cli.js')
  writeFileSync(node, platform === 'win32' ? Buffer.from('MZ模拟') : Buffer.from('cffaedfe', 'hex'), { mode: 0o755 })
  writeFileSync(entry, '#!/usr/bin/env node\n// 模拟：never executed\n')
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'npm', version: '10.0.0', bin: { npm: 'bin/npm-cli.js' } }))
  const launcher = join(bin, platform === 'win32' ? 'npm.cmd' : 'npm')
  if (platform === 'win32') writeFileSync(launcher, officialNpmCmd)
  else symlinkSync(entry, launcher)
  return { node, entry, launcher, pkg }
}
export function syntheticIdentity(cli: ActiveCliId = 'codex', version = '1.0.0'): InstallationIdentity {
  return { executable: `/模拟/bin/${cli}`, prefix: '/模拟', packageRoot: `/模拟/lib/node_modules/${CLI_SOURCES[cli].npm ?? cli}`, source: 'npm', manifestVersion: version,
    fingerprint: { realpath: `/模拟/lib/node_modules/${CLI_SOURCES[cli].npm ?? cli}/cli.js`, size: 10, mtimeMs: 100, manifestVersion: version } }
}
export function childFixture() {
  const stdout = new PassThrough(), stderr = new PassThrough()
  let done!: (value: { exitCode: number; signal: null }) => void, exit!: (value: boolean) => void
  const child = { stdout, stderr, done: new Promise<{ exitCode: number; signal: null }>(resolve => { done = resolve }),
    waitForExit: vi.fn(() => new Promise<boolean>(resolve => { exit = resolve })), terminate: vi.fn() }
  const finish = (code = 0) => { stdout.end(); stderr.end(); done({ exitCode: code, signal: null }) }
  return { child, finish, exit: (value: boolean) => exit(value) }
}
export function serviceFixture(clis: ActiveCliId[] = ['codex']) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cli-update-phase-b-')))
  const npm = npmFixture(root)
  const identities = new Map(clis.map(cli => [cli, syntheticIdentity(cli)]))
  const backend: ProcessBackend = { resolveExecutable: vi.fn(async name => name === 'npm' || name === 'npm.cmd' ? npm.launcher : name === 'node' || name === 'node.exe' ? npm.node : name), spawn: vi.fn(() => ({ stdout: Readable.from([]), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), waitForExit: vi.fn(async () => true), terminate: vi.fn() }) as any) }
  const config = { ...DEFAULT_CONFIG, cliMaintenance: new CliMaintenance() }
  const metadataFetch = vi.fn<typeof hostFetch>(async url => {
    if (String(url).includes('/channels/manifest.json')) return new Response(JSON.stringify({ latest: '1.2.3', files: [{ os: process.platform === 'win32' ? 'windows' : process.platform, arch: process.arch === 'x64' ? 'amd64' : process.arch, url: 'https://example.invalid/模拟.tgz', sha256: 'a'.repeat(64) }] }))
    if (String(url) === 'https://x.ai/cli/stable') return new Response('1.2.3')
    if (String(url).endsWith('/dist-tags')) return new Response(JSON.stringify({ latest: '1.2.3' }))
    const exact = String(url).endsWith('/1.2.3')
    return new Response(JSON.stringify(exact ? { name: decodeURIComponent(new URL(String(url)).pathname.split('/')[1]!), version: '1.2.3', dist: { integrity: sri('模拟'), tarball: new URL('/模拟.tgz', String(url)).href } } : { 'dist-tags': { latest: '1.2.3' }, versions: { '1.0.0': {}, '1.2.3': {} } }))
  })
  const releases = new ReleaseClient(metadataFetch)
  const artifactFetch = vi.fn<typeof hostFetch>(async (_url, init) => new Response(init?.method === 'HEAD' ? null : '模拟', { headers: { 'content-length': String(Buffer.byteLength('模拟')), etag: '"fixture-object"' } }))
  const integrity = vi.spyOn(releases, 'integrity').mockResolvedValue(sri('模拟'))
  const identify = vi.fn(async (cli: ActiveCliId) => structuredClone(identities.get(cli)))
  const version = vi.fn(async (_cli: ActiveCliId, identity: InstallationIdentity) => identity.manifestVersion)
  const busy = vi.fn(() => ({ workers: 0, accounts: false })), invalidateModels = vi.fn(), cleanup = vi.fn(), globalCleanup = vi.fn()
  // 模拟：generic service tests inject all discovery/verification; in-place tests use the real guard.
  const piGuard = vi.fn(async (identity: InstallationIdentity) => ({ beforeVersion: identity.manifestVersion!, env: {}, verify: async () => (await identify('pi'))?.manifestVersion! }))
  const service = new CliManagementService({ piGuard, root, backend, config, idle: () => true, enabled: () => false, cliEnabled: () => true, account: vi.fn(), identify, version, npmRuntimeHost: async () => ({ platform: process.platform, arch: process.arch, libc: process.platform === 'linux' ? 'glibc' : undefined }), npmCheck: vi.fn(async () => {}), releases, artifactFetch, busy, invalidateModels, cleanup, globalCleanup })
  service.saveDownloadSource({ source: 'official' })
  return { root, service, config, backend, identities, releases, integrity, identify, version, busy, invalidateModels, cleanup, globalCleanup, npm, metadataFetch, artifactFetch,
    async close() { await service.close().catch(() => undefined); rmSync(root, { recursive: true, force: true }) } }
}
export async function checked(service: CliManagementService, scope: 'all' | 'missing' = 'all') {
  service.check(scope)
  for await (const s of service.watch(control())) if (s.activity === 'idle') return s
  throw new Error('模拟 check did not finish')
}
export async function finished(service: CliManagementService) {
  for await (const s of service.watch(control())) if (!s.operation && !s.queue.length) return s
  throw new Error('模拟 operation did not finish')
}
export async function until(test: () => boolean) { for (let i = 0; i < 300 && !test(); i++) await new Promise(resolve => setTimeout(resolve, 1)); if (!test()) throw new Error('模拟 fixture did not reach expected state') }
