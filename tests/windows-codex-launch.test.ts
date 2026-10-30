import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { windowsCodexBackgroundLaunch } from '../src/host/windows-codex-launch.ts'

// Small synthetic installations only: no official wrapper source, CLI, account,
// environment secret, or model request is used. The real hash gate is mocked
// only for the fixture payload, keeping a production API without test bypasses.
const fixtureHash = vi.hoisted(() => ({ recognized: true, value: '61b0194f3bb6534439c8d26a3ed57d0805f84b884588b761795323eeb92fcf70' }))
vi.mock('node:crypto', async importOriginal => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return { ...actual, createHash: (...args: Parameters<typeof actual.createHash>) => {
    const hash = actual.createHash(...args), digest = hash.digest.bind(hash)
    hash.digest = ((encoding?: string) => fixtureHash.recognized && encoding === 'hex'
      ? fixtureHash.value
      : digest(encoding as 'hex')) as typeof hash.digest
    return hash
  } }
})

const roots: string[] = []
const options = { platform: 'win32' as const, arch: 'x64' }
function put(path: string, data: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
  return path
}
function metadata(path: string, value: unknown) { return put(path, JSON.stringify(value)) }
function pe(arch = 'x64', subsystem = 3) {
  const data = Buffer.alloc(256)
  data.write('MZ'); data.writeUInt32LE(64, 0x3c); data.write('PE\0\0', 64)
  data.writeUInt16LE(arch === 'x64' ? 0x8664 : 0xaa64, 68)
  data.writeUInt16LE(112, 84); data.writeUInt16LE(2, 86)
  data.writeUInt16LE(0x20b, 88); data.writeUInt16LE(subsystem, 156)
  return data
}
function fixture(arch = 'x64', main?: string, version = '0.162.1') {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'synthetic-codex-launch-')))
  roots.push(directory)
  const root = main ?? join(directory, '自定义 & 工具', 'node_modules', '@openai', 'codex')
  const entry = put(join(root, 'bin', 'codex.js'), '// Synthetic verified wrapper fixture; never executed.\n')
  const manifestPath = join(root, 'package.json')
  const top = { name: '@openai/codex', version, bin: { codex: 'bin/codex.js' },
    optionalDependencies: { [`@openai/codex-win32-${arch}`]: `npm:@openai/codex@${version}-win32-${arch}` } }
  metadata(manifestPath, top)
  const nativeRoot = join(root, 'node_modules', '@openai', `codex-win32-${arch}`)
  const nativeManifest = join(nativeRoot, 'package.json')
  const platform = { name: '@openai/codex', version: `${version}-win32-${arch}`, os: ['win32'], cpu: [arch] }
  metadata(nativeManifest, platform)
  const triple = arch === 'x64' ? 'x86_64-pc-windows-msvc' : 'aarch64-pc-windows-msvc'
  const executable = put(join(nativeRoot, 'vendor', triple, 'bin', 'codex.exe'), pe(arch))
  return { directory, root, entry, manifestPath, top, nativeRoot, nativeManifest, platform, triple, executable }
}
function launch(f: ReturnType<typeof fixture>, env?: NodeJS.ProcessEnv, arch = 'x64', args: string[] = ['app-server']) {
  return windowsCodexBackgroundLaunch([process.execPath, f.entry, ...args], env, { ...options, arch })
}
beforeEach(() => {
  fixtureHash.recognized = true
  fixtureHash.value = '61b0194f3bb6534439c8d26a3ed57d0805f84b884588b761795323eeb92fcf70'
  vi.stubEnv('npm_config_user_agent', '')
  vi.stubEnv('npm_execpath', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('verified Codex Windows background launch (synthetic offline fixtures)', () => {
  it.each(['x64', 'arm64'])('resolves the official %s npm alias and preserves literal argv and unrelated env', arch => {
    const f = fixture(arch), args = ['', '中文 路径', 'a&b', '%PATH%', '"quoted"', '--model', 'provider/model']
    const env = { Path: 'C:\\custom path;D:\\tools', ELECTRON_RUN_AS_NODE: '1', SYNTHETIC: 'keep' }
    const result = launch(f, env, arch, args)!
    expect(result.argv).toEqual([realpathSync(f.executable), ...args])
    expect(result.env).toMatchObject({ ...env, CODEX_MANAGED_PACKAGE_ROOT: realpathSync(f.root), CODEX_MANAGED_BY_NPM: '1' })
    expect(env).toEqual({ Path: 'C:\\custom path;D:\\tools', ELECTRON_RUN_AS_NODE: '1', SYNTHETIC: 'keep' })
  })
  it('also recognizes the verified 0.166.0 wrapper with its own platform package', () => {
    fixtureHash.value = 'e14fc83739c13c1074b12bd1acce4010c893c7f6fbfc1593b4a31d74cabb57af'
    const f = fixture('x64', undefined, '0.166.0')
    expect(launch(f)!.argv).toEqual([realpathSync(f.executable), 'app-server'])
    fixtureHash.value = '0'.repeat(64)
    expect(launch(f)).toBeUndefined()
  })
  it('keeps unknown wrappers and other platforms/runtimes on their existing path', () => {
    const f = fixture()
    fixtureHash.recognized = false
    expect(launch(f)).toBeUndefined()
    fixtureHash.recognized = true
    expect(windowsCodexBackgroundLaunch([process.execPath, f.entry], {}, { platform: 'darwin' })).toBeUndefined()
    expect(windowsCodexBackgroundLaunch(['other-node.exe', f.entry], {}, options)).toBeUndefined()
    expect(windowsCodexBackgroundLaunch([process.execPath, join(f.root, 'other.js')], {}, options)).toBeUndefined()
  })
  it('only reads a bounded regular wrapper before considering an optimization', () => {
    const f = fixture()
    writeFileSync(f.entry, Buffer.alloc(128 * 1024 + 1))
    expect(launch(f)).toBeUndefined()
    rmSync(f.entry)
    expect(launch(f)).toBeUndefined()
  })
  it('falls back to this main package vendor only when its optional package is absent', () => {
    const f = fixture()
    rmSync(f.nativeRoot, { recursive: true })
    const executable = put(join(f.root, 'vendor', f.triple, 'bin', 'codex.exe'), pe())
    expect(launch(f)!.argv[0]).toBe(realpathSync(executable))
  })
  it('does not fall back to a different native file when the resolved platform package is broken', () => {
    const f = fixture()
    put(join(f.root, 'vendor', f.triple, 'bin', 'codex.exe'), pe())
    rmSync(f.executable)
    expect(() => launch(f)).toThrow('Codex npm 原生入口不可用，请检查安装')
  })
  it('does not treat a present optional package with missing metadata as absent', () => {
    const f = fixture()
    put(join(f.root, 'vendor', f.triple, 'bin', 'codex.exe'), pe())
    rmSync(f.nativeManifest)
    expect(() => launch(f)).toThrow('Codex npm 原生入口不可用')
  })
  it.each([
    { name: '@third-party/codex' },
    { bin: { codex: '../bin/codex.js' } },
    { version: '../../other' },
    { optionalDependencies: { '@openai/codex-win32-x64': 'npm:@openai/codex@0.162.0-win32-x64' } },
  ])('rejects mismatched verified main package metadata: %j', changes => {
    const f = fixture()
    metadata(f.manifestPath, { ...f.top, ...changes })
    expect(() => launch(f)).toThrow('Codex npm 原生入口不可用')
  })
  it.each([
    { name: '@openai/codex-win32-x64' }, { version: '0.161.0-win32-x64' },
    { os: ['linux'] }, { cpu: ['arm64'] }, { cpu: ['x64', 'arm64'] },
  ])('rejects mismatched resolved alias metadata: %j', changes => {
    const f = fixture()
    metadata(f.nativeManifest, { ...f.platform, ...changes })
    expect(() => launch(f)).toThrow('Codex npm 原生入口不可用')
  })
  it.each(['wrong-arch', 'gui', 'dll', 'bad-header', 'truncated'])('rejects native PE %s', defect => {
    const f = fixture(), bytes = pe(defect === 'wrong-arch' ? 'arm64' : 'x64', defect === 'gui' ? 2 : 3)
    if (defect === 'dll') bytes.writeUInt16LE(0x2002, 86)
    if (defect === 'bad-header') bytes.write('NO', 0)
    writeFileSync(f.executable, defect === 'truncated' ? bytes.subarray(0, 100) : bytes)
    expect(() => launch(f)).toThrow('Codex npm 原生入口不可用')
  })
  it('does not guess an older native codex directory or prepend a historical PATH directory', () => {
    const f = fixture()
    rmSync(f.executable)
    put(join(f.nativeRoot, 'vendor', f.triple, 'codex', 'codex.exe'), pe())
    expect(() => launch(f)).toThrow('Codex npm 原生入口不可用')
  })
  it('allows a package-manager linked platform root but rejects a binary escaping its own package', () => {
    const f = fixture(), store = join(f.directory, 'pnpm-store', 'platform')
    mkdirSync(dirname(store), { recursive: true })
    const bytes = readFileSync(f.executable)
    rmSync(f.nativeRoot, { recursive: true })
    metadata(join(store, 'package.json'), f.platform)
    const storedExecutable = put(join(store, 'vendor', f.triple, 'bin', 'codex.exe'), bytes)
    symlinkSync(store, f.nativeRoot, 'junction')
    expect(launch(f)!.argv[0]).toBe(realpathSync(storedExecutable))
    rmSync(storedExecutable)
    const foreign = put(join(f.directory, 'foreign', 'codex.exe'), pe())
    // Link a directory rather than an executable so Windows needs no symlink privilege.
    rmSync(dirname(storedExecutable), { recursive: true })
    symlinkSync(dirname(foreign), dirname(storedExecutable), 'junction')
    expect(() => launch(f)).toThrow('Codex npm 原生入口不可用')
  })
  it('sets only manager deltas, removes all stale flags and does not restore ambient parent variables', () => {
    const f = fixture()
    vi.stubEnv('SYNTHETIC_PARENT_ONLY', 'not forwarded')
    vi.stubEnv('npm_config_user_agent', 'bun/1.3.0')
    const result = launch(f, { CODEX_MANAGED_BY_PNPM: '1', codex_managed_by_vite_plus: '1', KEEP: undefined })!
    expect(result.env.CODEX_MANAGED_BY_BUN).toBe('1')
    expect(result.env.CODEX_MANAGED_BY_NPM).toBeUndefined()
    expect(result.env.CODEX_MANAGED_BY_PNPM).toBeUndefined()
    expect(result.env.CODEX_MANAGED_BY_VITE_PLUS).toBeUndefined()
    expect(Object.hasOwn(result.env, 'CODEX_MANAGED_BY_PNPM')).toBe(true)
    expect(Object.hasOwn(result.env, 'codex_managed_by_vite_plus')).toBe(false)
    expect(Object.hasOwn(result.env, 'SYNTHETIC_PARENT_ONLY')).toBe(false)
    expect(Object.hasOwn(result.env, 'KEEP')).toBe(true)
    expect(Object.hasOwn(result.env, 'PATH')).toBe(false)
    expect(launch(f, { NPM_CONFIG_USER_AGENT: undefined })!.env.CODEX_MANAGED_BY_NPM).toBe('1')
  })
  it('uses the effective explicit npm_execpath and preserves no inferred PATH additions', () => {
    const f = fixture()
    expect(launch(f, { NPM_EXECPATH: 'C:\\bun\\bun.exe', Path: 'literal' })!.env)
      .toMatchObject({ CODEX_MANAGED_BY_BUN: '1', Path: 'literal' })
  })
  it('recognizes pnpm ownership before environment package-manager hints', () => {
    const f = fixture()
    put(join(dirname(dirname(f.root)), '.modules.yaml'), '# Synthetic ownership marker\n')
    expect(launch(f, { npm_config_user_agent: 'bun/1.3.0' })!.env.CODEX_MANAGED_BY_PNPM).toBe('1')
  })
  it.each(['active', '#legacy'])('recognizes Vite+ installation ownership with %s id', id => {
    const outer = realpathSync(mkdtempSync(join(tmpdir(), 'synthetic-vite-codex-')))
    roots.push(outer)
    const packages = join(outer, 'packages')
    const install = id.startsWith('#') ? join(packages, `@openai/codex${id}`) : join(packages, '@openai/codex', id)
    const f = fixture('x64', join(install, 'lib', 'node_modules', '@openai', 'codex'))
    metadata(join(packages, '@openai', 'codex.json'), { name: '@openai/codex', installId: id })
    expect(launch(f, { npm_config_user_agent: 'bun/1.3.0' })!.env.CODEX_MANAGED_BY_VITE_PLUS).toBe('1')
  })
  it('ignores invalid package-manager ownership metadata just like the native wrapper', () => {
    const outer = realpathSync(mkdtempSync(join(tmpdir(), 'synthetic-vite-codex-')))
    roots.push(outer)
    const f = fixture('x64', join(outer, 'packages', '@openai', 'codex', 'active', 'node_modules', '@openai', 'codex'))
    metadata(join(outer, 'packages', '@openai', 'codex.json'), { name: '@other/codex', installId: 'active' })
    expect(launch(f)!.env.CODEX_MANAGED_BY_NPM).toBe('1')
  })
})
