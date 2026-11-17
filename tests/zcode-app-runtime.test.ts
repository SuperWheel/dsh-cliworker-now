/**
 * 模拟：临时目录里的应用目录形状、占位二进制、占位 PE 版本和假进程回执。
 * 不启动真实 ZCode、不读真实账号、不调用模型；真实核对见变更的验收记录。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend, type RuntimeConfig } from '../src/host/process.ts'
import { resolveCliExecutable } from '../src/host/adapters.ts'
import { CliExecutablePathStore } from '../src/host/cli-executable-paths.ts'
import { managedZCodeEntry, prepareZCode, zcodeEnvironment } from '../src/host/zcode-adapter.ts'
import { zcodeAppLayout, zcodeAppRuntime, zcodeEntryArgv, zcodeEntryEnvironment, isZCodeAppArgv, ZCODE_APP_RESOURCES_ENVIRONMENT } from '../src/host/zcode-app-layout.mjs'
import {
  ensureZCodeCredentialSecret, probeZCodeAppRuntime, resetZCodeLaunchState, verifiedZCodeApp, zcodeLaunchEnvironment, zcodeLaunchPrefix,
  zcodeTemporaryEnvironment, ZCodeCredentialSecretError,
  zcodeRuntimeNotice, zcodeTuiResolvable, ZCODE_APP_RUNTIME_FALLBACK_NOTICE, ZCODE_MIGRATION_PENDING_NOTICE,
} from '../src/host/zcode-launch.ts'
import { zcodeGrokAccountLaunch, ZCODE_TUI_UNAVAILABLE } from '../src/host/zcode-grok-accounts.ts'
import { zcodeAppServerArgv } from '../src/host/native-zcode.mjs'
import { nativeProcessBackend } from '../src/host/native-process.ts'
import { currentVersion } from '../src/host/cli-management/versions.ts'
import { identifyInstallation, ZCODE_RUNTIME_NOTICE, type InstallationIdentity } from '../src/host/cli-management/identity.ts'
import { CliManagementCache } from '../src/host/cli-management/cache.ts'
import { CliMaintenance } from '../src/host/cli-management/maintenance.ts'
import { sameInstallation } from '../src/host/cli-management/planner.ts'
import { findWindowsPathCommand } from '../src/host/windows-cli-path.ts'
import { findWindowsDesktopCli } from '../src/host/windows-desktop-cli-installation.ts'

const state = vi.hoisted(() => ({ home: '', product: 'ZCode' }))
vi.mock('node:os', async (actual) => ({ ...(await actual<typeof import('node:os')>()), homedir: () => state.home }))
// 模拟：PE 版本资源读取（真实解析由 cli-management-zcode-windows.test.ts 覆盖）。
vi.mock('../src/host/cli-management/pe-version.ts', async (actual) => ({
  ...(await actual<typeof import('../src/host/cli-management/pe-version.ts')>()),
  readPeVersion: vi.fn(async () => ({ productName: state.product, productVersion: '3.18.2.9000' })),
}))
vi.mock('../src/host/windows-cli-path.ts', async (actual) => ({
  ...(await actual<typeof import('../src/host/windows-cli-path.ts')>()), findWindowsPathCommand: vi.fn(async () => undefined),
}))
vi.mock('../src/host/windows-desktop-cli-installation.ts', async (actual) => ({
  ...(await actual<typeof import('../src/host/windows-desktop-cli-installation.ts')>()), findWindowsDesktopCli: vi.fn(async () => undefined),
}))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const hook = fileURLToPath(new URL('../src/host/zcode-app-resolve.cjs', import.meta.url))
const launcher = fileURLToPath(new URL('../src/host/private-launch.mjs', import.meta.url))
const as = (value: NodeJS.Platform) => Object.defineProperty(process, 'platform', { ...platform, value })
const file = (path: string, content: string | Buffer = '// 模拟，不执行\n') => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); return path }
const route = 'account:bigmodel-individual-coding-plan'
const builtin = JSON.stringify({
  schemaVersion: 1,
  config: {
    providerConfigRules: { providerRules: [{ providerId: route, config: { builtinModelIds: ['GLM-5.3-Flash'], api: { type: 'anthropic-messages', baseUrl: 'https://example.test/api/' } } }] },
    modelConfigRules: {
      modelRules: [{ modelMatch: '.*', config: { enabled: true, optionSpecs: { reasoningLevel: { values: ['low', 'high'] } } } }],
      modelApiRules: [], providerSiteRules: [], templateModelRules: [], builtinProviderModelRules: [],
    },
  },
})
/** 模拟的 macOS 应用包：身份文件、占位二进制、自带 CLI 入口和服务商文件。 */
function macApp(root = join(state.home, 'Applications'), bundleId = 'dev.zcode.app') {
  const app = join(root, 'ZCode.app'), resources = join(app, 'Contents/Resources')
  file(join(app, 'Contents/Info.plist'), `<plist><dict><key>CFBundleIdentifier</key><string>${bundleId}</string><key>CFBundleShortVersionString</key><string>3.18.2</string></dict></plist>`)
  const electron = file(join(app, 'Contents/MacOS/ZCode'), '模拟二进制')
  const entry = file(join(resources, 'glm/zcode.cjs'))
  file(join(resources, 'config/provider/zcode-builtin.json'), builtin)
  return { app, resources, electron, entry }
}
/** 模拟的 Windows 安装目录（磁盘路径沿用测试机格式，只模拟平台判断）。 */
function windowsApp(root = join(state.home, 'Local/Programs/ZCode')) {
  const resources = join(root, 'resources')
  const electron = file(join(root, 'ZCode.exe'), '模拟 PE')
  const entry = file(join(resources, 'glm/zcode.cjs'))
  file(join(resources, 'config/provider/zcode-builtin.json'), builtin)
  return { app: root, resources, electron, entry }
}
/** 模拟进程：只回放给定输出和退出码，记录每次的 argv/env。 */
function fakeBackend(answer: (argv: readonly string[]) => { stdout?: string; exitCode?: number } = () => ({ stdout: '0.17.1\n' })) {
  const calls: { argv: readonly string[]; env?: NodeJS.ProcessEnv }[] = []
  const backend: ProcessBackend = {
    resolveExecutable: vi.fn(async (name: string) => {
      if (name === 'zcode') throw new SubprocessExecutableNotFoundError('模拟：PATH 中没有 zcode')
      return name
    }),
    spawn: vi.fn((spec) => {
      calls.push({ argv: spec.argv, env: spec.env })
      const result = answer(spec.argv)
      return {
        stdin: undefined, control: undefined, collected: {},
        stdout: Readable.from([result.stdout ?? '']), stderr: Readable.from([]),
        done: Promise.resolve({ exitCode: result.exitCode ?? 0, signal: null }),
        terminate: vi.fn(), waitForExit: vi.fn(async () => true),
      } as never
    }),
  }
  return { backend, calls }
}

beforeEach(() => {
  state.home = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-zcode-app-')))
  state.product = 'ZCode'
  resetZCodeLaunchState()
  vi.stubEnv('APPDATA', join(state.home, 'Roaming'))
  vi.stubEnv('LOCALAPPDATA', join(state.home, 'Local'))
  vi.stubEnv('ProgramFiles', join(state.home, 'ProgramFiles'))
  vi.stubEnv('ZCODE_CREDENTIAL_SECRET', '')
  vi.stubEnv('ZCODE_CREDENTIAL_SECRET_FILE', '')
  vi.mocked(findWindowsPathCommand).mockClear()
  vi.mocked(findWindowsDesktopCli).mockClear()
})
afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  vi.unstubAllEnvs()
  resetZCodeLaunchState()
  rmSync(state.home, { recursive: true, force: true })
})

describe('模拟：ZCode 自带 CLI 的启动方式', () => {
  it.each(['darwin', 'win32'] as const)('模拟：%s 用应用自己的 Electron、预加载钩子和同一安装的入口', (target) => {
    as(target)
    const app = target === 'darwin' ? macApp() : windowsApp()
    expect(zcodeAppLayout(app.entry)).toEqual({
      root: app.app, resources: app.resources, electron: app.electron,
      builtinConfig: join(app.resources, 'config/provider/zcode-builtin.json'),
    })
    expect(zcodeEntryArgv(app.entry)).toEqual([app.electron, '--require', hook, app.entry])
    expect(zcodeEntryEnvironment(app.entry)).toEqual({ ELECTRON_RUN_AS_NODE: '1', [ZCODE_APP_RESOURCES_ENVIRONMENT]: app.resources })
    expect(isZCodeAppArgv(zcodeEntryArgv(app.entry))).toBe(true)
    // 探测失败后的回退形状，以及不属于应用的入口，都用宿主自带的 Node。
    expect(zcodeEntryArgv(app.entry, { appRuntime: false })).toEqual([process.execPath, app.entry])
    expect(zcodeEntryEnvironment(app.entry, { appRuntime: false })).toEqual({})
    const legacy = file(managedZCodeEntry())
    expect(zcodeAppLayout(legacy)).toBeUndefined()
    expect(zcodeEntryArgv(legacy)).toEqual([process.execPath, legacy])
    expect(zcodeEntryEnvironment(legacy)).toEqual({})
    expect(zcodeEntryArgv('/模拟/zcode-native')).toEqual(['/模拟/zcode-native'])
    expect(isZCodeAppArgv([process.execPath, legacy, '--version'])).toBe(false)
  })
  it('模拟：缺少应用二进制时不使用应用运行环境，Linux 上不识别应用目录', () => {
    as('darwin')
    const app = macApp()
    rmSync(app.electron)
    expect(zcodeAppRuntime(app.entry)).toBeUndefined()
    expect(zcodeEntryArgv(app.entry)).toEqual([process.execPath, app.entry])
    as('linux')
    expect(zcodeAppLayout(macApp(join(state.home, 'other')).entry)).toBeUndefined()
  })
  it.each(['darwin', 'win32'] as const)('模拟：%s 的 Worker 参数只多出启动前缀，原有参数、cwd 与环境变量不变', async (target) => {
    as(target)
    const app = target === 'darwin' ? macApp() : windowsApp()
    const auth = join(state.home, 'auth')
    mkdirSync(auth, { mode: 0o700 })
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7890')
    const input = {
      executable: app.entry, project: '/模拟项目', preference: { model: `${route}/GLM-5.3-Flash`, effort: 'low' as const },
      mode: 'build' as const, prompt: '模拟任务', stateDirectory: join(state.home, 'state'), nativeHome: join(state.home, 'native-home'), authDirectory: auth,
    }
    const launch = await prepareZCode(input)
    expect(launch.argv.slice(0, 4)).toEqual([app.electron, '--require', hook, app.entry])
    expect(launch.argv.slice(4, 12)).toEqual(['--cwd', '/模拟项目', '--mode', 'edit', '--output-format', 'stream-json', '--disallowedTools', launch.argv[11]])
    expect(launch.argv.slice(-2)).toEqual(['--prompt', '任务：\n模拟任务'])
    expect(launch.env).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1',
      [ZCODE_APP_RESOURCES_ENVIRONMENT]: app.resources,
      ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: join(app.resources, 'config/provider/zcode-builtin.json'),
      ZCODE_DATA_BASE_DIR: auth,
    })
    // 代理变量来自宿主环境，插件既不覆盖也不清除。
    expect(Object.keys(launch.env).filter((key) => /proxy/i.test(key))).toEqual([])
    expect(process.env.HTTPS_PROXY).toBe('http://127.0.0.1:7890')
    // 原生通道：app-server 紧跟在启动前缀之后。
    expect(zcodeAppServerArgv({ argv: launch.argv, project: '/模拟项目' }).slice(0, 7)).toEqual([app.electron, '--require', hook, app.entry, 'app-server', '--disallowedTools', launch.argv[11]])
  })
  it('模拟：进程规范化给 ZCode 自己的二进制补上 Node 模式，其他原生程序不加', () => {
    as('darwin')
    const app = macApp()
    const spawn = vi.fn(() => ({}) as never)
    const backend = nativeProcessBackend({ resolveExecutable: async (name) => name, spawn }, 'darwin')
    backend.spawn({ argv: [...zcodeEntryArgv(app.entry), '--version'], env: { 模拟: '1' }, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' } } as never)
    expect((spawn.mock.calls[0] as any)[0].env).toEqual({ 模拟: '1', ELECTRON_RUN_AS_NODE: '1' })
    backend.spawn({ argv: ['/模拟/其他原生程序', '--version'], env: { 模拟: '1' }, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' } } as never)
    expect((spawn.mock.calls[1] as any)[0].env).toEqual({ 模拟: '1' })
  })
})

describe('模拟：预加载钩子 zcode-app-resolve.cjs', () => {
  const { install, REDIRECTED, ENVIRONMENT } = createRequire(import.meta.url)('../src/host/zcode-app-resolve.cjs')
  const resources = '/模拟/ZCode.app/Contents/Resources'
  const failure = (code: string) => Object.assign(new Error('模拟：解析失败'), { code })
  function installed(options: { asar?: boolean; commonjs?: (specifier: string) => string } = {}) {
    let resolve!: (specifier: string, context: any, next: (specifier: string, context: any) => any) => any
    const registered = install(resources, {
      fs: { existsSync: (path: string) => options.asar !== false && path === join(resources, 'app.asar') },
      registerHooks: (hooks: any) => { resolve = hooks.resolve },
      createRequire: () => ({ resolve: options.commonjs ?? (() => { throw failure('MODULE_NOT_FOUND') }) }),
    })
    return { registered, resolve: (...args: Parameters<typeof resolve>) => resolve(...args) }
  }
  it('模拟：只列出两个包名，变量名与宿主一致', () => {
    expect([...REDIRECTED]).toEqual(['@napi-rs/keyring', 'playwright-core'])
    expect(ENVIRONMENT).toBe(ZCODE_APP_RESOURCES_ENVIRONMENT)
  })
  it('模拟：缺少资源目录、app.asar 或同步钩子能力时不注册任何东西', () => {
    const registerHooks = vi.fn()
    expect(install(undefined, { registerHooks })).toBe(false)
    expect(install('相对路径', { registerHooks })).toBe(false)
    expect(install(resources, { fs: { existsSync: () => false }, registerHooks })).toBe(false)
    expect(install(resources, { fs: { existsSync: () => true }, registerHooks: undefined })).toBe(false)
    expect(registerHooks).not.toHaveBeenCalled()
    expect(installed().registered).toBe(true)
  })
  it('模拟：正常能解析的导入原样通过，不改写', () => {
    const next = vi.fn(() => ({ url: 'file:///模拟/原位置.js' }))
    expect(installed().resolve('@napi-rs/keyring', { parentURL: 'file:///模拟/zcode.cjs' }, next)).toEqual({ url: 'file:///模拟/原位置.js' })
    expect(next).toHaveBeenCalledTimes(1)
  })
  it('模拟：其他包解析失败时保留原错误，不做第二次解析', () => {
    const original = failure('ERR_MODULE_NOT_FOUND')
    const next = vi.fn(() => { throw original })
    for (const specifier of ['@zcode/tui', 'koffi', '@napi-rs/keyring/sub', './relative.js'])
      expect(() => installed().resolve(specifier, { parentURL: 'file:///模拟/zcode.cjs' }, next)).toThrow(original)
    expect(next).toHaveBeenCalledTimes(4)
  })
  it.each(['@napi-rs/keyring', 'playwright-core'])('模拟：%s 先按原路径解析，失败后才改从同一安装的 app.asar 解析', (specifier) => {
    const parent = pathToFileURL(join(resources, 'app.asar/node_modules/cliworker-resolve.cjs')).href
    const next = vi.fn((_specifier: string, context: any) => {
      if (context.parentURL !== parent) throw failure('ERR_MODULE_NOT_FOUND')
      return { url: 'file:///模拟/app.asar/node_modules/已解析.js' }
    })
    expect(installed().resolve(specifier, { parentURL: 'file:///模拟/zcode.cjs', conditions: ['import'] }, next)).toEqual({ url: 'file:///模拟/app.asar/node_modules/已解析.js' })
    expect(next.mock.calls.map((call) => call[1].parentURL)).toEqual(['file:///模拟/zcode.cjs', parent])
    expect(next.mock.calls[1]![1].conditions).toEqual(['import'])
  })
  it('模拟：require() 忽略替换的父模块时按 CommonJS 从 app.asar 解析；仍失败则报原错误', () => {
    const original = failure('MODULE_NOT_FOUND')
    const next = vi.fn(() => { throw original })
    const commonjs = installed({ commonjs: () => '/模拟/app.asar/node_modules/playwright-core/index.js' })
    expect(commonjs.resolve('playwright-core', {}, next)).toEqual({ url: pathToFileURL('/模拟/app.asar/node_modules/playwright-core/index.js').href, shortCircuit: true })
    expect(() => installed().resolve('playwright-core', {}, next)).toThrow(original)
  })
})

describe('模拟：启动检查失败时的回退', () => {
  it('模拟：--version 失败后改用宿主 Node 并给出提示；同一安装只探测一次，应用更新后重新探测', async () => {
    as('darwin')
    const app = macApp()
    const capture = vi.fn(async (_argv: string[], _env: Record<string, string>): Promise<string> => { throw new Error('模拟：应用运行环境无法启动') })
    expect(zcodeLaunchPrefix(app.entry)).toEqual([app.electron, '--require', hook, app.entry])
    expect(await probeZCodeAppRuntime(app.entry, capture)).toEqual({ ok: false })
    expect(capture).toHaveBeenCalledWith([app.electron, '--require', hook, app.entry, '--version'], { ...zcodeTemporaryEnvironment(), ELECTRON_RUN_AS_NODE: '1', [ZCODE_APP_RESOURCES_ENVIRONMENT]: app.resources })
    expect(zcodeLaunchPrefix(app.entry)).toEqual([process.execPath, app.entry])
    expect(zcodeLaunchEnvironment(app.entry)).toEqual(zcodeTemporaryEnvironment())
    expect(zcodeRuntimeNotice(app.entry)).toBe(ZCODE_APP_RUNTIME_FALLBACK_NOTICE)
    await probeZCodeAppRuntime(app.entry, capture)
    expect(capture).toHaveBeenCalledTimes(1)
    // 模拟应用更新：二进制大小和修改时间变化。
    writeFileSync(app.electron, '模拟二进制（新版本）')
    utimesSync(app.electron, new Date(), new Date(Date.now() + 5000))
    capture.mockResolvedValue('0.17.2\n')
    expect(await probeZCodeAppRuntime(app.entry, capture)).toEqual({ ok: true, version: '0.17.2' })
    expect(capture).toHaveBeenCalledTimes(2)
    expect(zcodeLaunchPrefix(app.entry)).toEqual([app.electron, '--require', hook, app.entry])
    expect(zcodeRuntimeNotice(app.entry)).toBeUndefined()
  })
  it('模拟：输出里没有版本号同样算失败；清理未确认和调用方取消照常上抛', async () => {
    as('darwin')
    const app = macApp()
    expect(await probeZCodeAppRuntime(app.entry, async () => 'Usage: 模拟帮助文本\n')).toEqual({ ok: false })
    resetZCodeLaunchState()
    await expect(probeZCodeAppRuntime(app.entry, async () => { throw new ProcessCleanupUnconfirmedError() })).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
    const controller = new AbortController()
    await expect(probeZCodeAppRuntime(app.entry, async () => { controller.abort(new Error('模拟取消')); throw new Error('模拟') }, controller.signal)).rejects.toThrow('模拟取消')
    expect(zcodeLaunchPrefix(app.entry)).toEqual([app.electron, '--require', hook, app.entry])
    // 不属于应用的入口没有可探测的运行环境。
    expect(await probeZCodeAppRuntime(file(managedZCodeEntry()), async () => '0.16.9')).toBeUndefined()
  })
})

describe('模拟：旧独立 runtime 的自动记录迁移', () => {
  function fixture() {
    as('win32')
    const managed = file(managedZCodeEntry())
    const store = new CliExecutablePathStore(join(state.home, 'paths'), { platform: platform.value as NodeJS.Platform })
    const config: RuntimeConfig = { ...DEFAULT_CONFIG, cliExecutablePaths: store }
    return { managed, store, config }
  }
  it('模拟：应用身份和 --version 都通过后，自动记录按版本号比较改写为应用自带的入口', async () => {
    const f = fixture(), app = windowsApp(), { backend, calls } = fakeBackend()
    f.store.remember('zcode', f.managed, 0)
    const revision = f.store.revision('zcode')
    await expect(resolveCliExecutable('zcode', backend, f.config)).resolves.toBe(app.entry)
    expect(f.store.read('zcode')).toEqual({ mode: 'auto', path: app.entry })
    expect(f.store.revision('zcode')).toBe(revision + 1)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.argv).toEqual([app.electron, '--require', hook, app.entry, '--version'])
    expect(calls[0]!.env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1', [ZCODE_APP_RESOURCES_ENVIRONMENT]: app.resources })
    expect(zcodeRuntimeNotice(app.entry)).toBeUndefined()
    // 旧 runtime 文件原样保留，插件不删除。
    expect(existsSync(f.managed)).toBe(true)
    // 之后的解析沿用已核对的结果，不再启动进程。
    await expect(resolveCliExecutable('zcode', backend, f.config)).resolves.toBe(app.entry)
    expect(calls).toHaveLength(1)
  })
  it('模拟：只读解析（更新页的身份识别）不迁移、不探测，仍返回记录中的旧入口', async () => {
    const f = fixture(), { backend, calls } = fakeBackend()
    windowsApp()
    f.store.remember('zcode', f.managed, 0)
    const revision = f.store.revision('zcode')
    await expect(resolveCliExecutable('zcode', backend, f.config, undefined, { readOnly: true })).resolves.toBe(f.managed)
    expect(f.store.read('zcode')).toEqual({ mode: 'auto', path: f.managed })
    expect(f.store.revision('zcode')).toBe(revision)
    expect(calls).toHaveLength(0)
    expect(zcodeRuntimeNotice(f.managed)).toBeUndefined()
  })
  it('模拟：更新操作占用期间不迁移，更新前后识别为同一安装；释放后才迁移', async () => {
    const f = fixture(), app = windowsApp(), { backend, calls } = fakeBackend()
    const maintenance = new CliMaintenance()
    const config: RuntimeConfig = { ...f.config, cliMaintenance: maintenance }
    f.store.remember('zcode', f.managed, 0)
    const signal = new AbortController().signal
    const before = await identifyInstallation('zcode', backend, config, signal)
    const release = maintenance.begin('zcode', () => ({ workers: 0, accounts: false }))
    // 更新期间其他读取（账号状态、路径查询）走普通解析，同样不得改写记录。
    await expect(resolveCliExecutable('zcode', backend, config)).resolves.toBe(f.managed)
    const after = await identifyInstallation('zcode', backend, config, signal)
    expect(before?.executable).toBe(f.managed)
    expect(after?.executable).toBe(f.managed)
    expect(sameInstallation(before!, after!, 'zcode')).toBe(true)
    expect(f.store.read('zcode')).toEqual({ mode: 'auto', path: f.managed })
    expect(calls).toHaveLength(0)
    release()
    await expect(resolveCliExecutable('zcode', backend, config)).resolves.toBe(app.entry)
    expect(f.store.read('zcode')).toEqual({ mode: 'auto', path: app.entry })
  })
  it.each(['首次发现', '旧记录迁移'])('模拟：%s 的启动检查期间路径被改为手动选择时，本次请求作废，不覆盖也不报告可用', async (kind) => {
    const f = fixture(), app = windowsApp()
    const manual = file(join(state.home, '手动/zcode.cjs'))
    if (kind === '旧记录迁移') f.store.remember('zcode', f.managed, 0)
    // 模拟：--version 探测进行中，用户在设置里保存了另一条路径。
    const { backend, calls } = fakeBackend(() => { f.store.setManual('zcode', manual); return { stdout: '0.17.1\n' } })
    await expect(resolveCliExecutable('zcode', backend, f.config)).rejects.toThrow('CLI 路径已更新，请刷新后重试')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.argv).toContain(app.entry)
    expect(f.store.read('zcode')).toEqual({ mode: 'manual', path: manual })
    // 之后的请求按手动路径解析，不再用应用入口。
    await expect(resolveCliExecutable('zcode', backend, f.config)).resolves.toBe(manual)
  })
  it.each(['手动记录', '显式配置'])('模拟：%s 指向旧 runtime 时不迁移、不探测', async (kind) => {
    const f = fixture(), { backend, calls } = fakeBackend()
    windowsApp()
    if (kind === '手动记录') f.store.setManual('zcode', f.managed)
    else f.store.remember('zcode', f.managed, 0)
    const config = kind === '显式配置' ? { ...f.config, zcodeExecutable: f.managed } : f.config
    const before = f.store.read('zcode'), revision = f.store.revision('zcode')
    await expect(resolveCliExecutable('zcode', backend, config)).resolves.toBe(f.managed)
    expect(f.store.read('zcode')).toEqual(before)
    expect(f.store.revision('zcode')).toBe(revision)
    expect(calls).toHaveLength(0)
    expect(zcodeRuntimeNotice(f.managed)).toBeUndefined()
  })
  it.each(['--version 失败', '应用身份不符', '没有桌面应用'])('模拟：%s 时保留旧记录并给出提示', async (reason) => {
    const f = fixture()
    const { backend, calls } = fakeBackend(() => reason === '--version 失败' ? { stdout: '', exitCode: 1 } : { stdout: '0.17.1\n' })
    if (reason !== '没有桌面应用') windowsApp()
    if (reason === '应用身份不符') state.product = 'Other App'
    f.store.remember('zcode', f.managed, 0)
    const before = f.store.read('zcode'), revision = f.store.revision('zcode')
    await expect(resolveCliExecutable('zcode', backend, f.config)).resolves.toBe(f.managed)
    expect(f.store.read('zcode')).toEqual(before)
    expect(f.store.revision('zcode')).toBe(revision)
    expect(zcodeRuntimeNotice(f.managed)).toBe(ZCODE_MIGRATION_PENDING_NOTICE)
    expect(calls).toHaveLength(reason === '--version 失败' ? 1 : 0)
    // 一分钟内不重复检查，避免每次派遣都探测。
    await resolveCliExecutable('zcode', backend, f.config)
    expect(calls).toHaveLength(reason === '--version 失败' ? 1 : 0)
    // 旧记录继续以宿主 Node 运行，并在更新页保留原有的「独立 runtime」说明。
    expect(zcodeLaunchPrefix(f.managed)).toEqual([process.execPath, f.managed])
    if (reason === '--version 失败') {
      const identity = await identifyInstallation('zcode', backend, f.config, new AbortController().signal, true)
      expect(identity).toMatchObject({ executable: f.managed, source: 'desktop-app', notice: ZCODE_RUNTIME_NOTICE })
    }
  })
  it('模拟：已迁移的安装识别为桌面应用，不再带独立 runtime 提示', async () => {
    const f = fixture(), app = windowsApp(), { backend } = fakeBackend()
    f.store.remember('zcode', app.entry, 0)
    const identity = await identifyInstallation('zcode', backend, f.config, new AbortController().signal, true)
    expect(identity).toMatchObject({ executable: app.entry, source: 'desktop-app', appPath: app.app, fingerprint: { appVersion: '3.18.2', realpath: app.entry } })
    expect(identity?.notice).toBeUndefined()
    expect(await verifiedZCodeApp(app.entry)).toMatchObject({ root: app.app })
    state.product = 'Other App'
    expect((await identifyInstallation('zcode', backend, f.config, new AbortController().signal, true))?.source).toBe('unknown')
  })
  it('模拟：macOS 以 bundle id 核对应用身份', async () => {
    as('darwin')
    expect(await verifiedZCodeApp(macApp().entry)).toBeDefined()
    expect(await verifiedZCodeApp(macApp(join(state.home, 'other'), 'com.example.other').entry)).toBeUndefined()
    const app = macApp(join(state.home, 'no-provider'))
    rmSync(join(app.resources, 'config/provider/zcode-builtin.json'))
    expect(await verifiedZCodeApp(app.entry)).toBeUndefined()
  })
})

describe('模拟：账号入口', () => {
  const help = 'zcode 0.17.1\n  login [zai|bigmodel]  Sign in\n  logout  Remove credentials\n  tui  Open terminal\n'
  it('模拟：应用自带入口解析不到 @zcode/tui，账号终端不可用；登录、退出参数只多出启动前缀', async () => {
    as('darwin')
    const app = macApp(), { backend, calls } = fakeBackend(() => ({ stdout: help }))
    const config: RuntimeConfig = { ...DEFAULT_CONFIG, stateDirectory: join(state.home, 'state') }
    const options = { home: state.home, platform: 'darwin' as const }
    const signal = new AbortController().signal
    expect(zcodeTuiResolvable(app.entry)).toBe(false)
    const login = await zcodeGrokAccountLaunch('zcode', 'login', app.entry, config, backend, signal, { ...options, loginProvider: 'zai' })
    expect(login.argv).toEqual([process.execPath, launcher, app.electron, '--require', hook, app.entry, 'login', 'zai'])
    expect(login.env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1', [ZCODE_APP_RESOURCES_ENVIRONMENT]: app.resources })
    const logout = await zcodeGrokAccountLaunch('zcode', 'logout', app.entry, config, backend, signal, options)
    expect(logout.argv.slice(2)).toEqual([app.electron, '--require', hook, app.entry, 'logout'])
    await expect(zcodeGrokAccountLaunch('zcode', 'manage', app.entry, config, backend, signal, options)).rejects.toThrow(ZCODE_TUI_UNAVAILABLE)
    // 能力检查同样在应用运行环境下执行。
    expect(calls.every((call) => call.argv.join('\0') === [app.electron, '--require', hook, app.entry, '--help'].join('\0'))).toBe(true)
    expect(calls[0]!.env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1', [ZCODE_APP_RESOURCES_ENVIRONMENT]: app.resources })
  })
  it('模拟：Windows 登录仍带 --no-browser，参数顺序不变', async () => {
    as('win32')
    const app = windowsApp(), { backend } = fakeBackend(() => ({ stdout: help + '  --no-browser  Print the OAuth URL\n' }))
    const config: RuntimeConfig = { ...DEFAULT_CONFIG, stateDirectory: join(state.home, 'state') }
    const login = await zcodeGrokAccountLaunch('zcode', 'login', app.entry, config, backend, new AbortController().signal, { home: state.home, platform: 'win32', loginProvider: 'bigmodel' })
    expect(login.argv.slice(2)).toEqual([app.electron, '--require', hook, app.entry, 'login', 'bigmodel', '--no-browser'])
  })
  it('模拟：能解析 @zcode/tui 的完整 runtime 保留账号终端', () => {
    const entry = file(join(state.home, 'runtime/cli/zcode.cjs'))
    expect(zcodeTuiResolvable(entry)).toBe(false)
    file(join(state.home, 'runtime/node_modules/@zcode/tui/package.json'), '{}')
    expect(zcodeTuiResolvable(entry)).toBe(true)
    expect(zcodeTuiResolvable('/模拟/zcode-native')).toBeUndefined()
  })
})

describe('模拟：插件账号目录的 credential-secret', () => {
  const directory = () => { const auth = join(state.home, 'accounts/zcode'); mkdirSync(auth, { recursive: true, mode: 0o700 }); return auth }
  const secret = (auth: string) => join(auth, '.zcode/v2/credential-secret')
  it('模拟：未选定密钥来源时创建 0600 的 32 字节 base64url 密钥，之后不再改写', () => {
    const auth = directory()
    file(join(auth, '.zcode/v2/credentials.json'), JSON.stringify({ 模拟旧记录: 'enc:v1:模拟' }))
    expect(ensureZCodeCredentialSecret(auth)).toBe('created')
    const value = readFileSync(secret(auth), 'utf8')
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(value, 'base64url')).toHaveLength(32)
    if (platform.value !== 'win32') expect(statSync(secret(auth)).mode & 0o777).toBe(0o600)
    expect(ensureZCodeCredentialSecret(auth)).toBe('present')
    expect(readFileSync(secret(auth), 'utf8')).toBe(value)
  })
  it.each([
    ['已设置 ZCODE_CREDENTIAL_SECRET', (auth: string) => { vi.stubEnv('ZCODE_CREDENTIAL_SECRET', '模拟密钥'); return auth }],
    ['已设置 ZCODE_CREDENTIAL_SECRET_FILE', (auth: string) => { vi.stubEnv('ZCODE_CREDENTIAL_SECRET_FILE', join(auth, '模拟文件')); return auth }],
    ['目录已标记为系统钥匙串', (auth: string) => { file(join(auth, '.zcode/v2/credential-source'), 'os\n'); return auth }],
    ['已有系统钥匙串加密的记录', (auth: string) => { file(join(auth, '.zcode/v2/credentials.json'), JSON.stringify({ a: 'enc:v2:os:模拟' })); return auth }],
    ['已有其他文件密钥加密的记录', (auth: string) => { file(join(auth, '.zcode/v2/credentials.json'), JSON.stringify({ a: 'enc:v2:env:模拟' })); return auth }],
    ['账号目录尚未创建', (auth: string) => join(auth, '不存在')],
    ['账号目录是链接', (auth: string) => { const link = join(state.home, '链接'); symlinkSync(auth, link); return link }],
  ])('模拟：%s 时不创建', (_name, prepare) => {
    const auth = directory(), target = prepare(auth)
    expect(ensureZCodeCredentialSecret(target)).toBe('skipped')
    expect(existsSync(secret(auth))).toBe(false)
    expect(existsSync(secret(target))).toBe(false)
  })
  const leftovers = (auth: string) => readdirSync(join(auth, '.zcode/v2')).filter((name) => name !== 'credential-secret')
  it('模拟：密钥先写入私有临时文件再原子发布，发布前目标不存在，发布后不留临时文件', () => {
    const auth = directory()
    let seen: string[] = []
    expect(ensureZCodeCredentialSecret(auth, { beforePublish: () => {
      // 并发启动此刻看到的要么没有密钥文件，要么是完整密钥；不会看到空文件。
      expect(existsSync(secret(auth))).toBe(false)
      seen = leftovers(auth)
      const temporary = join(auth, '.zcode/v2', seen[0]!)
      expect(statSync(temporary).size).toBe(43)
      if (platform.value !== 'win32') expect(statSync(temporary).mode & 0o777).toBe(0o600)
    } })).toBe('created')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/^\.credential-secret\.\d+\.[0-9a-f-]{36}\.tmp$/)
    expect(leftovers(auth)).toEqual([])
    expect(statSync(secret(auth)).size).toBe(43)
    expect(statSync(secret(auth)).nlink).toBe(1)
  })
  it('模拟：发布前另一个启动已写好密钥时不覆盖，沿用对方的密钥', () => {
    const auth = directory(), other = randomBytes(32).toString('base64url')
    expect(ensureZCodeCredentialSecret(auth, { beforePublish: () => writeFileSync(secret(auth), other, { mode: 0o600 }) })).toBe('present')
    expect(readFileSync(secret(auth), 'utf8')).toBe(other)
    expect(leftovers(auth)).toEqual([])
  })
  it('模拟：写入与发布之间中断时不留下空的或过短的密钥文件，下次重新创建', () => {
    const auth = directory()
    expect(ensureZCodeCredentialSecret(auth, { beforePublish: () => { throw new Error('模拟：进程在发布前中断') } })).toBe('skipped')
    expect(existsSync(secret(auth))).toBe(false)
    expect(leftovers(auth)).toEqual([])
    expect(ensureZCodeCredentialSecret(auth)).toBe('created')
  })
  it.each([
    ['空文件', ''],
    ['过短', 'x'.repeat(31)],
    ['过长', 'x'.repeat(4097)],
  ])('模拟：已有密钥文件%s时判为不可用：不覆盖，启动环境与账号入口给出明确错误', async (_name, content) => {
    as('darwin')
    const app = macApp(), auth = directory()
    file(secret(auth), content)
    chmodSync(secret(auth), 0o600)
    expect(ensureZCodeCredentialSecret(auth)).toBe('invalid')
    expect(readFileSync(secret(auth), 'utf8')).toBe(content)
    expect(() => zcodeEnvironment(app.entry, join(state.home, 'state-invalid'), auth)).toThrow(ZCodeCredentialSecretError)
    expect(() => zcodeEnvironment(app.entry, join(state.home, 'state-invalid'), auth)).toThrow(secret(auth))
    const { backend } = fakeBackend(() => ({ stdout: 'zcode 0.17.1\n  login [zai|bigmodel]  Sign in\n  logout  Remove credentials\n' }))
    const config: RuntimeConfig = { ...DEFAULT_CONFIG, stateDirectory: join(state.home, 'state'), zcodeAuthDirectory: auth }
    await expect(zcodeGrokAccountLaunch('zcode', 'login', app.entry, config, backend, new AbortController().signal, { home: state.home, platform: 'darwin', loginProvider: 'zai' }))
      .rejects.toThrow(/密钥文件不可用.*credential-secret/)
    expect(readFileSync(secret(auth), 'utf8')).toBe(content)
  })
  it.skipIf(platform.value === 'win32')('模拟：权限不是仅本人可读写的密钥文件同样判为不可用', () => {
    const auth = directory()
    file(secret(auth), randomBytes(32).toString('base64url'))
    chmodSync(secret(auth), 0o644)
    expect(ensureZCodeCredentialSecret(auth)).toBe('invalid')
    chmodSync(secret(auth), 0o600)
    expect(ensureZCodeCredentialSecret(auth)).toBe('present')
  })
  it('模拟：用户自己的 ~/.zcode 不受影响', () => {
    expect(ensureZCodeCredentialSecret(state.home)).toBe('skipped')
    expect(existsSync(join(state.home, '.zcode'))).toBe(false)
  })
  it('模拟：启动环境从不同时带两个密钥来源，文件密钥也不经环境变量传递', () => {
    as('darwin')
    const app = macApp(), auth = directory()
    const created = zcodeEnvironment(app.entry, join(state.home, 'state-a'), auth)
    expect(existsSync(secret(auth))).toBe(true)
    expect(created).not.toHaveProperty('ZCODE_CREDENTIAL_SECRET')
    expect(created).not.toHaveProperty('ZCODE_CREDENTIAL_SECRET_FILE')
    expect(JSON.stringify(created)).not.toContain(readFileSync(secret(auth), 'utf8'))
    const other = join(state.home, 'accounts/other')
    mkdirSync(other, { recursive: true })
    vi.stubEnv('ZCODE_CREDENTIAL_SECRET_FILE', join(state.home, '模拟密钥文件'))
    const external = zcodeEnvironment(app.entry, join(state.home, 'state-b'), other)
    expect(external.ZCODE_CREDENTIAL_SECRET_FILE).toBe(join(state.home, '模拟密钥文件'))
    expect(external).not.toHaveProperty('ZCODE_CREDENTIAL_SECRET')
    expect(existsSync(secret(other))).toBe(false)
    // 未显式给出账号目录（默认目录）时不在这里创建。
    vi.stubEnv('ZCODE_CREDENTIAL_SECRET_FILE', '')
    vi.stubEnv('DSH_HOME', join(state.home, 'dsh'))
    mkdirSync(join(state.home, 'dsh/cliworker-now/accounts/zcode'), { recursive: true })
    zcodeEnvironment(app.entry, join(state.home, 'state-c'))
    expect(existsSync(join(state.home, 'dsh/cliworker-now/accounts/zcode/.zcode'))).toBe(false)
  })
})

describe('模拟：版本读取与缓存', () => {
  const identity = (executable: string, appVersion = '3.18.2'): InstallationIdentity => ({
    executable, source: 'desktop-app', appPath: dirname(dirname(dirname(executable))),
    fingerprint: { realpath: executable, size: statSync(executable).size, mtimeMs: statSync(executable).mtimeMs, appVersion },
  })
  const signal = () => new AbortController().signal
  it('模拟：应用自带入口按启动方式读 CLI 版本，应用版本另行保留', async () => {
    as('darwin')
    const app = macApp(), { backend, calls } = fakeBackend()
    const id = identity(app.entry)
    expect(await currentVersion('zcode', id, backend, DEFAULT_CONFIG, signal())).toBe('0.17.1')
    expect(id.fingerprint.appVersion).toBe('3.18.2')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.argv).toEqual([app.electron, '--require', hook, app.entry, '--version'])
    expect(calls[0]!.env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1', [ZCODE_APP_RESOURCES_ENVIRONMENT]: app.resources })
  })
  it('模拟：应用运行环境不回答时改用宿主 Node 再读一次；都失败则只显示应用版本', async () => {
    as('darwin')
    const app = macApp()
    const recovering = fakeBackend((argv) => argv[0] === app.electron ? { stdout: '', exitCode: 1 } : { stdout: 'zcode 0.17.1\n' })
    expect(await currentVersion('zcode', identity(app.entry), recovering.backend, DEFAULT_CONFIG, signal())).toBe('0.17.1')
    expect(recovering.calls.map((call) => call.argv.slice(0, 2))).toEqual([[app.electron, '--require'], [process.execPath, app.entry]])
    expect(zcodeRuntimeNotice(app.entry)).toBe(ZCODE_APP_RUNTIME_FALLBACK_NOTICE)
    resetZCodeLaunchState()
    const failing = fakeBackend(() => ({ stdout: '', exitCode: 1 }))
    expect(await currentVersion('zcode', identity(app.entry), failing.backend, DEFAULT_CONFIG, signal())).toBe('3.18.2')
    expect(failing.calls).toHaveLength(2)
  })
  it('模拟：仍在旧独立 runtime 上的安装不启动进程，沿用应用版本', async () => {
    as('darwin')
    const legacy = file(managedZCodeEntry()), { backend, calls } = fakeBackend()
    expect(await currentVersion('zcode', identity(legacy), backend, DEFAULT_CONFIG, signal())).toBe('3.18.2')
    expect(calls).toHaveLength(0)
  })
  it('模拟：版本缓存按应用版本、入口大小和修改时间失效', () => {
    as('darwin')
    const app = macApp(), cache = new CliManagementCache(join(state.home, 'cache'))
    const fingerprint = identity(app.entry).fingerprint
    cache.rememberVersion('zcode', fingerprint, '0.17.1')
    expect(cache.version('zcode', { ...fingerprint })).toEqual({ version: '0.17.1' })
    expect(cache.version('zcode', { ...fingerprint, appVersion: '3.19.0' })).toBeUndefined()
    expect(cache.version('zcode', { ...fingerprint, size: fingerprint.size + 1 })).toBeUndefined()
    expect(cache.version('zcode', { ...fingerprint, mtimeMs: fingerprint.mtimeMs + 1000 })).toBeUndefined()
  })
})

describe('模拟：macOS 上每一种 ZCode 启动都带短临时目录', () => {
  const help = 'zcode 0.17.1\n  login [zai|bigmodel]  Sign in\n  logout  Remove credentials\n  tui  Open terminal\n'
  /** macOS sockaddr_un 的 sun_path 为 104 字节（含结尾 0）；ZCode 在 TMPDIR 下建 `znr-<uuid>.sock`。 */
  const fits = (env: NodeJS.ProcessEnv | Record<string, string> | undefined) => {
    expect(env?.TMPDIR).toMatch(/^\/tmp\/cwn-[A-Za-z0-9]{6}$/)
    expect(env?.TMP).toBe(env?.TMPDIR)
    expect(env?.TEMP).toBe(env?.TMPDIR)
    expect(Buffer.byteLength(join(env!.TMPDIR!, `znr-${randomUUID()}.sock`))).toBeLessThan(104)
    expect(statSync(env!.TMPDIR!).isDirectory()).toBe(true)
    expect(statSync(env!.TMPDIR!).mode & 0o777).toBe(0o700)
    return env!.TMPDIR!
  }
  it.skipIf(platform.value !== 'darwin')('模拟：启动检查、--help、登录、退出、账号终端、版本读取和基础环境都使用同一个 /tmp/cwn- 目录', async () => {
    as('darwin')
    const app = macApp(), signal = new AbortController().signal
    const config: RuntimeConfig = { ...DEFAULT_CONFIG, stateDirectory: join(state.home, 'state') }
    const options = { home: state.home, platform: 'darwin' as const }
    const kinds: Record<string, string> = {}
    // 启动检查（--version 探测）
    let probeEnv: Record<string, string> | undefined
    await probeZCodeAppRuntime(app.entry, async (_argv, env) => { probeEnv = env; return '0.17.1\n' })
    kinds['启动检查'] = fits(probeEnv)
    // 账号能力检查（--help）、登录、退出
    const accounts = fakeBackend(() => ({ stdout: help }))
    const login = await zcodeGrokAccountLaunch('zcode', 'login', app.entry, config, accounts.backend, signal, { ...options, loginProvider: 'zai' })
    const logout = await zcodeGrokAccountLaunch('zcode', 'logout', app.entry, config, accounts.backend, signal, options)
    kinds['--help'] = fits(accounts.calls[0]!.env)
    kinds['登录'] = fits(login.env)
    kinds['退出'] = fits(logout.env)
    // 账号终端（完整 runtime 才有）
    const full = file(join(state.home, 'full/cli/zcode.cjs'))
    file(join(state.home, 'full/cli/config/provider/zcode-builtin.json'), builtin)
    file(join(state.home, 'full/node_modules/@zcode/tui/package.json'), '{}')
    const manage = await zcodeGrokAccountLaunch('zcode', 'manage', full, config, accounts.backend, signal, options)
    kinds['账号终端'] = fits(manage.env)
    // 更新页版本读取
    const versions = fakeBackend()
    const stat = statSync(app.entry)
    await currentVersion('zcode', { executable: app.entry, source: 'desktop-app', appPath: app.app,
      fingerprint: { realpath: app.entry, size: stat.size, mtimeMs: stat.mtimeMs, appVersion: '3.18.2' } }, versions.backend, DEFAULT_CONFIG, signal)
    kinds['版本读取'] = fits(versions.calls[0]!.env)
    // Worker、app-server 与模型目录读取的基础环境（它们随后换成各自的 /tmp/cwn- 目录）
    kinds['基础环境'] = fits(zcodeEnvironment(app.entry, join(state.home, 'state-x')))
    kinds['非应用入口'] = fits(zcodeLaunchEnvironment(full))
    expect(new Set(Object.values(kinds)).size).toBe(1)
    // 目录被外部删除后重新建立，不沿用失效路径。
    const first = kinds['基础环境']!
    rmSync(first, { recursive: true, force: true })
    const next = fits(zcodeTemporaryEnvironment())
    expect(next).not.toBe(first)
    resetZCodeLaunchState()
    expect(existsSync(next)).toBe(false)
  })
  it('模拟：继承的 /var/folders 临时目录会超出限制，Windows 与 Linux 不改临时目录', () => {
    const inherited = '/var/folders/zz/zyxvpxvq6csfxvn_n0000000000000/T/cliworker-now-state-000000/tmp'
    expect(Buffer.byteLength(join(inherited, `znr-${randomUUID()}.sock`))).toBeGreaterThanOrEqual(104)
    expect(zcodeTemporaryEnvironment('win32')).toEqual({})
    expect(zcodeTemporaryEnvironment('linux')).toEqual({})
  })
})
