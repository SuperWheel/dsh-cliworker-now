/** 模拟：only temporary package files, no installed Pi / real model calls. */
import { afterEach, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkPiInstallationIntegrity, inspectPiInstallation, piInstallationIntegrityMessage, PiInstallationIntegrityError } from '../src/host/pi-installation.mjs'
import { NativeLoginProviders } from '../src/host/native-login-providers.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
import { resolveNativeEntry } from '../src/host/native-launch.mjs'
import { simulatedPiInstallation } from './pi-installation-integrity-fixture.ts'
import { serviceFixture, checked } from './cli-management-phase-b-fixture.ts'
vi.mock('node:child_process', async load => {
  const actual = await load<typeof import('node:child_process')>()
  return { ...actual, execFile: vi.fn(actual.execFile) }
})
const roots: string[] = []
const services: ReturnType<typeof serviceFixture>[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const f of services.splice(0)) await f.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'simulated-pi-integrity-'))); roots.push(root)
  return { root, ...simulatedPiInstallation(root) }
}
const missing = 'Pi 安装不完整（缺少依赖 @earendil-works/pi-ai），请在「更新 CLI」中重新安装'
it('模拟：empty relative ESM module is valid; a missing relative file still fails', async () => {
  const f = fixture()
  const module = f.write('node_modules/@earendil-works/pi-ai/dist/models.js', '')
  await expect(checkPiInstallationIntegrity(f.entry)).resolves.toMatchObject({ version: '1.5.2' })
  rmSync(module)
  await expect(checkPiInstallationIntegrity(f.entry, { fresh: true })).rejects.toThrow(missing)
})
it('模拟：an empty module previously visited relatively must still fail when used as a package entry', async () => {
  const f = fixture()
  f.write('node_modules/@earendil-works/pi-ai/dist/models.js', '')
  f.write('node_modules/@earendil-works/pi-ai/dist/oauth.js', 'import "./models.js"; import "./late.js";')
  f.write('node_modules/@earendil-works/pi-ai/dist/late.js', 'import "@earendil-works/pi-ai/empty";')
  writeFileSync(f.aiManifest, JSON.stringify({ name: '@earendil-works/pi-ai', type: 'module', exports: {
    '.': './dist/index.js', './oauth': './dist/oauth.js', './empty': './dist/models.js',
  } }))
  await expect(checkPiInstallationIntegrity(f.entry)).rejects.toThrow(missing)
})
it('模拟：selected bundle is checked despite canonical cli.js, including after a cached success', async () => {
  const f = fixture()
  const canonical = join(f.pkg, 'dist/cli.js')
  expect(inspectPiInstallation(f.entry)).toMatchObject({ executable: canonical, launchEntry: f.entry })
  await checkPiInstallationIntegrity(f.entry)
  writeFileSync(f.entry, '')
  await expect(checkPiInstallationIntegrity(f.entry)).rejects.toThrow('原生模块缺失或损坏')
  // Selecting the separate intact launch entry is still valid.
  await expect(checkPiInstallationIntegrity(canonical)).resolves.toMatchObject({ launchEntry: canonical })
})
it('模拟：selected bundle mtime invalidates cached dependency failure after repair', async () => {
  const f = fixture()
  writeFileSync(f.aiEntry, '')
  await expect(checkPiInstallationIntegrity(f.entry)).rejects.toThrow(missing)
  writeFileSync(f.aiEntry, 'export {}')
  writeFileSync(f.entry, '// simulated repaired bundle with a new fingerprint\n')
  await expect(checkPiInstallationIntegrity(f.entry)).resolves.toMatchObject({ launchEntry: f.entry })
})
it.each(['ETIMEDOUT', 'ENOENT'])('模拟：scanner %s is unavailable, never corruption, and is not cached', async code => {
  const f = fixture()
  vi.mocked(execFile).mockImplementationOnce(((_file: unknown, _args: unknown, _options: unknown, callback: any) => {
    queueMicrotask(() => callback(Object.assign(new Error('SIMULATED private native diagnostic'), { code }), '', ''))
    return {} as any
  }) as typeof execFile)
  const failure = await checkPiInstallationIntegrity(f.entry).catch(error => error)
  expect(failure.code).toBe('PI_INSTALLATION_CHECK_UNAVAILABLE')
  expect(piInstallationIntegrityMessage(failure)).toBe('暂时无法核验 Pi 安装完整性，请稍后重试')
  expect(failure.message).not.toContain('安装不完整')
  await expect(checkPiInstallationIntegrity(f.entry)).resolves.toMatchObject({ version: '1.5.2' })
})
it('模拟：healthy Windows npm shape ignores .bin and unreferenced zero-byte history; uses import exports, never evaluates code', async () => {
  const f = fixture()
  f.write('node_modules/@earendil-works/pi-ai/dist/index.js', 'throw new Error("MUST NEVER EXECUTE"); export * from "./models.js";')
  expect(await checkPiInstallationIntegrity(f.entry)).toMatchObject({ version: '1.5.2', root: f.pkg })
})
it('模拟：Windows npm shim uses backslashes and a bundle path without invoking cmd', async () => {
  const f = fixture(), shim = join(f.root, 'AppData/Roaming/npm/pi.cmd')
  writeFileSync(shim, '@echo off\r\nnode "%~dp0\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js" %*\r\n')
  const entry = resolveNativeEntry(shim, 'win32')
  expect(entry).toBe(f.entry)
  await expect(checkPiInstallationIntegrity(entry)).resolves.toMatchObject({ version: '1.5.2' })
})
it.each(['manifest', 'empty-entry', 'missing-entry'] as const)('模拟：truncated %s fails although identity/version-bearing bundle remains valid', async kind => {
  const f = fixture()
  if (kind === 'manifest') rmSync(f.aiManifest)
  else if (kind === 'empty-entry') writeFileSync(f.aiEntry, '')
  else rmSync(f.aiEntry)
  expect(inspectPiInstallation(f.entry).version).toBe('1.5.2')
  await expect(checkPiInstallationIntegrity(f.entry)).rejects.toThrow(missing)
})
it('模拟：checks transitive imports and resolves nested packages from each importing file', async () => {
  const f = fixture()
  f.write('node_modules/@earendil-works/pi-ai/dist/models.js', 'export * from "nested-dependency";')
  const name = 'node_modules/@earendil-works/pi-ai/node_modules/nested-dependency'
  f.write(`${name}/package.json`, '{"name":"nested-dependency","type":"module","exports":"./entry.js"}')
  f.write(`${name}/entry.js`, '')
  // A healthy hoisted copy must not mask the broken nearest dependency.
  f.write('node_modules/nested-dependency/package.json', '{"main":"index.js"}')
  f.write('node_modules/nested-dependency/index.js', 'export {}')
  await expect(checkPiInstallationIntegrity(f.entry)).rejects.toThrow('缺少依赖 nested-dependency')
})
it('模拟：bundle-only layout reports missing SDK, not a successful version-only installation', async () => {
  const f = fixture()
  rmSync(join(f.pkg, 'dist/core'), { recursive: true }); rmSync(join(f.pkg, 'dist/cli.js'))
  expect(inspectPiInstallation(f.entry, { allowUnsupported: true }).executable).toBe(f.entry)
  await expect(checkPiInstallationIntegrity(f.entry)).rejects.toThrow('原生模块缺失或损坏')
})
it('模拟：fresh verification bypasses positive and negative caches after nested truncation/repair', async () => {
  const f = fixture(); await checkPiInstallationIntegrity(f.entry)
  writeFileSync(f.aiEntry, '')
  await expect(checkPiInstallationIntegrity(f.entry, { fresh: true })).rejects.toThrow(missing)
  writeFileSync(f.aiEntry, 'export {}')
  await expect(checkPiInstallationIntegrity(f.entry, { fresh: true })).resolves.toMatchObject({ version: '1.5.2' })
})
it('模拟：entry/core mtime changes invalidate cache; cancellation does not become corruption', async () => {
  const f = fixture(); await checkPiInstallationIntegrity(f.entry)
  f.write('dist/core/auth-storage.js', 'import "missing-auth-dependency";')
  await expect(checkPiInstallationIntegrity(f.entry)).rejects.toThrow('缺少依赖 missing-auth-dependency')
  const c = new AbortController(); c.abort(new Error('cancelled'))
  await expect(checkPiInstallationIntegrity(f.entry, { signal: c.signal })).rejects.toThrow('cancelled')
})
it('模拟：bounds file reads and never exposes native error text or arbitrary package names', async () => {
  const f = fixture(); writeFileSync(f.aiEntry, 'x'.repeat(8 * 1024 * 1024 + 1))
  await expect(checkPiInstallationIntegrity(f.entry)).rejects.toThrow('暂时无法核验 Pi 安装完整性，请稍后重试')
  expect(piInstallationIntegrityMessage(new Error('RAW_NATIVE_ERROR /private/path'))).toBeUndefined()
  expect(new PiInstallationIntegrityError('x\nSECRET').message).not.toContain('SECRET')
})
it('模拟：provider discovery rejects truncated install before native metadata subprocess', async () => {
  const f = fixture(); rmSync(f.aiManifest)
  const spawn = vi.fn()
  const providers = new NativeLoginProviders({ spawn } as any, DEFAULT_CONFIG)
  await expect(providers.read('pi', f.entry, new AbortController().signal)).rejects.toThrow(missing)
  expect(spawn).not.toHaveBeenCalled()
})
it('模拟：standalone login helper emits only the safe missing package notice', async () => {
  const { execFile } = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  const { promisify } = await import('node:util')
  const { fileURLToPath } = await import('node:url')
  const f = fixture(); rmSync(f.aiManifest)
  const result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../src/host/native-login-providers.mjs', import.meta.url)), 'pi', f.entry], {
    cwd: f.root, env: { ...process.env, CLIWORKER_LOGIN_METADATA_HOME: f.root }, timeout: 10_000,
  }).catch(error => error)
  expect(result.code).toBe(1)
  expect(result.stderr).toBe(missing + '\n')
  expect(result.stdout).toBe('')
})
it('模拟：update page shows incomplete installation message instead of generic version error', async () => {
  const f = serviceFixture(['pi']); services.push(f)
  const pi = simulatedPiInstallation(f.root); rmSync(pi.aiManifest)
  const identity = f.identities.get('pi')!
  Object.assign(identity, { executable: pi.entry, packageRoot: pi.pkg, manifestVersion: '1.5.2' })
  const row = (await checked(f.service)).entries.find(e => e.cli === 'pi')!
  expect(row).toMatchObject({ group: 'failed', installed: true, reasonDetail: missing })
})
