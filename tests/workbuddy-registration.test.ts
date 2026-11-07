import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { CLI_IDS, CLI_LABELS, CLI_SHORT_NAMES } from '../src/shared/types.ts'
import { SINGLE_ACCOUNT_CLIS, GUIDED_ACCOUNT_CLIS, ACCOUNT_LOGIN_HOSTS } from '../src/shared/account-links.ts'
import { cliLevelOptions, runsUnderViewOnly, workerPlanSupported } from '../src/shared/worker-permissions.ts'
import { bridgedFeatureSupport } from '../src/shared/conversation-features.ts'
import { nativeAttachmentCapability } from '../src/host/native-attachments.mjs'
import { nativeCliCapabilities } from '../src/host/cli-native-capabilities.mjs'
import { buildNativeHarnessInjection, nativeHarnessToolCapability, nativeHarnessExecutionReady } from '../src/host/native-harness-injection.mjs'
import { resolveCliExecutable, catalogFor, workerArguments, protocolFor } from '../src/host/adapters.ts'
import { authorizedCatalog } from '../src/host/authorized-catalog.ts'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import { AccountManager } from '../src/host/accounts.ts'
import { CliExecutablePathStore } from '../src/host/cli-executable-paths.ts'
import { transportFor, usesNativeBridge, prepareNativeWorker } from '../src/host/native-worker.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import { invocationResolution, requireCliName, isGenericWorkBuddyName, resolveAvailableWorkBuddyName } from '../src/host/routing.ts'
import { CliWorkerService } from '../src/host/index.ts'

const { probe } = vi.hoisted(() => ({ probe: vi.fn() }))
vi.mock('../src/host/native-workbuddy.mjs', async load => ({
  ...await load<typeof import('../src/host/native-workbuddy.mjs')>(), probeWorkBuddyMetadata: probe,
}))
const clis = ['workbuddycn', 'workbuddy'] as const
const roots: string[] = []
const signal = () => new AbortController().signal
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'workbuddy-SIMULATED-registration-')))
  roots.push(root)
  const installs = Object.fromEntries(clis.map(cli => {
    const app = join(root, `${cli} space.app`)
    const cliRoot = join(app, 'Contents/Resources/app.asar.unpacked/cli')
    const runtime = join(app, 'Contents/MacOS/Electron'), entry = join(cliRoot, 'dist/codebuddy-lite-wb.mjs')
    mkdirSync(dirname(runtime), { recursive: true }); mkdirSync(dirname(entry), { recursive: true })
    writeFileSync(runtime, 'SIMULATED: never execute'); writeFileSync(entry, '// SIMULATED: never execute')
    writeFileSync(join(cliRoot, 'package.json'), JSON.stringify({ name: '@genie/agent-cli', version: '2.165.0' }))
    writeFileSync(join(cliRoot, 'product.json'), JSON.stringify({ productName: CLI_LABELS[cli],
      endpoint: `https://www.workbuddy.${cli === 'workbuddycn' ? 'cn' : 'ai'}`, dataFolderName: `.${cli}-SIMULATED` }))
    return [cli, { app, runtime, entry }]
  })) as Record<typeof clis[number], { app: string; runtime: string; entry: string }>
  const backend = { resolveExecutable: vi.fn(() => { throw new Error('SIMULATED: PATH must not be used') }),
    spawn: vi.fn(() => { throw new Error('SIMULATED: backend must not spawn a CLI') }),
    spawnTerminal: vi.fn(() => { throw new Error('SIMULATED: account terminal must not open') }) } as unknown as ProcessBackend
  const config = { ...DEFAULT_CONFIG, workbuddycnExecutable: installs.workbuddycn.app, workbuddyExecutable: installs.workbuddy.app }
  return { root, installs, backend, config }
}
beforeEach(() => { probe.mockReset().mockImplementation(async ({ cli }) => ({ cli, authenticated: true,
  endpoint: `https://www.workbuddy.${cli === 'workbuddycn' ? 'cn' : 'ai'}`,
  models: [{ id: 'SIMULATED/auto', label: 'SIMULATED Auto', efforts: ['default', 'high'] }], effortOptions: ['default', 'high'] })); })
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('模拟 WorkBuddy 注册、权限与原生能力', () => {
  it.each(clis)('%s appends independent identity, transport, native planning and desktop-only accounts', cli => {
    expect(CLI_IDS.slice(CLI_IDS.indexOf('qodercn') + 1)).toEqual(['codebuddy', 'traecn', ...clis])
    expect(CLI_SHORT_NAMES[cli]).toBe(cli)
    expect(CLI_LABELS[cli]).toBe(cli === 'workbuddycn' ? 'WorkBuddy CN' : 'WorkBuddy')
    const worker = { preference: { cli, model: 'SIMULATED/model', effort: 'default' as const }, transport: `${cli}-acp-v1` }
    expect(transportFor(cli)).toBe(worker.transport); expect(usesNativeBridge(worker)).toBe(true)
    expect(cliLevelOptions(cli).map(item => item.value)).toEqual(['ask', 'auto', 'full'])
    expect(runsUnderViewOnly(cli)).toBe(true); expect(workerPlanSupported(worker)).toBe(true)
    expect(bridgedFeatureSupport(worker).fork).toEqual({ supported: false, reason: 'WorkBuddy 内置 CLI 未公开原生分支能力' })
    expect(bridgedFeatureSupport(worker).plan.supported).toBe(true)
    expect(SINGLE_ACCOUNT_CLIS.has(cli)).toBe(true); expect(GUIDED_ACCOUNT_CLIS.has(cli)).toBe(false)
    expect(ACCOUNT_LOGIN_HOSTS).not.toHaveProperty(cli)
    expect(nativeAttachmentCapability(cli)).toBe(true)
    expect(nativeCliCapabilities({ cli, mode: 'accept-edits' }).classes).toEqual(['file-read', 'file-write', 'search', 'shell', 'web', 'skills'])
    expect(nativeCliCapabilities({ cli, mode: 'plan' }).classes).not.toContain('file-write')
    expect(nativeHarnessExecutionReady(cli)).toBe(false)
    expect(nativeHarnessToolCapability(cli)).toEqual({ transport: false, ready: false,
      reason: 'WorkBuddy 内置 CLI 只公开 http/sse MCP，未验证插件工具通道' })
    expect(buildNativeHarnessInjection({ cli, argv: ['SIMULATED/runtime', 'SIMULATED/entry'] }).argv).toEqual(['SIMULATED/runtime', 'SIMULATED/entry'])
    expect(() => workerArguments('SIMULATED/entry', '/SIMULATED', worker.preference, 'plan', 'SIMULATED', 1000)).toThrow('原生 ACP')
    expect(() => protocolFor(cli, () => {}, () => {}, 1024)).toThrow('原生 ACP')
  })
  it('rejects a cross-version transport', () => {
    expect(() => usesNativeBridge({ preference: { cli: 'workbuddycn', model: 'SIMULATED', effort: 'default' }, transport: 'workbuddy-acp-v1' })).toThrow('未知通信协议')
  })
})

describe('模拟 WorkBuddy 发现、目录与账号接线（不启动程序）', () => {
  it.each(clis)('%s discovers and prepares exactly [runtime, entry], preserving native selection/mode', async cli => {
    const f = fixture(), control = signal()
    expect(await resolveCliExecutable(cli, f.backend, f.config, control)).toBe(f.installs[cli].entry)
    const preference = { cli, model: 'SIMULATED/auto', effort: 'high' as const }
    const argv = workerArguments(f.installs[cli].entry, f.root, preference, 'plan', 'SIMULATED', 1000, undefined, true)
    const launch = await prepareNativeWorker({ argv }, { cli, project: f.root, preference, mode: 'plan',
      access: 'read-only', prompt: 'SIMULATED', stateDirectory: f.root }, f.config)
    try {
      const request = JSON.parse(readFileSync(launch.argv.at(-1)!, 'utf8'))
      expect(request.argv).toEqual([f.installs[cli].runtime, f.installs[cli].entry])
      expect(request).toMatchObject({ cli, mode: 'plan', access: 'read-only', preference })
    } finally { await launch.cleanup() }
    expect(f.backend.resolveExecutable).not.toHaveBeenCalled(); expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it('persists discovery independently and rejects a manual path to the opposite site without fallback', async () => {
    const f = fixture(), store = new CliExecutablePathStore(f.root)
    const config = { ...DEFAULT_CONFIG, cliExecutablePaths: store }
    store.setManual('workbuddycn', f.installs.workbuddycn.app)
    store.setManual('workbuddy', f.installs.workbuddy.app)
    for (const cli of clis) expect(await resolveCliExecutable(cli, f.backend, config)).toBe(f.installs[cli].entry)
    store.setManual('workbuddycn', f.installs.workbuddy.app)
    await expect(resolveCliExecutable('workbuddycn', f.backend, config)).rejects.toMatchObject({ code: 'WORKBUDDY_UNAVAILABLE', reason: 'variant-mismatch' })
    expect(await resolveCliExecutable('workbuddy', f.backend, config)).toBe(f.installs.workbuddy.entry)
    expect(probe).not.toHaveBeenCalled(); expect(f.backend.resolveExecutable).not.toHaveBeenCalled()
  })
  it.each(clis)('%s uses one fresh metadata handshake per authorization and returns only native choices', async cli => {
    const f = fixture()
    const a = await authorizedCatalog(cli, f.backend, f.config, f.root, signal())
    expect(a.catalog.models).toEqual([{ id: 'SIMULATED/auto', label: 'SIMULATED Auto', efforts: ['default', 'high'] }])
    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe.mock.calls[0]![0]).toMatchObject({ cli, argv: [f.installs[cli].runtime, f.installs[cli].entry], project: f.root })
    const b = await authorizedCatalog(cli, f.backend, f.config, f.root, signal())
    expect(probe).toHaveBeenCalledTimes(2); expect(b.binding).toBe(a.binding)
    expect(await readCliAccountBinding(cli, f.backend, f.config, f.root, signal())).toMatch(/^cli-account-v1:[a-f0-9]{64}$/)
    expect(probe).toHaveBeenCalledTimes(3)
    const other = cli === 'workbuddycn' ? 'workbuddy' : 'workbuddycn'
    expect((await authorizedCatalog(other, f.backend, f.config, f.root, signal())).binding).not.toBe(a.binding)
  })
  it.each(clis)('%s reports login, authentication failure and bootstrap failure without offering account actions', async cli => {
    const f = fixture(), manager = new AccountManager(f.backend, f.config)
    expect(await manager.status(cli, f.root, signal())).toMatchObject({ state: 'authenticated', installed: true, verification: 'cli', actions: [] })
    probe.mockRejectedValueOnce(Object.assign(new Error('请打开 WorkBuddy 桌面端登录后重试'), { code: 'CLI_OWN_ACCOUNT_REQUIRED' }))
    expect(await manager.status(cli, f.root, signal())).toMatchObject({ summary: '请打开 WorkBuddy 桌面端登录后重试', actions: [] })
    probe.mockRejectedValueOnce(Object.assign(new Error('WorkBuddy 暂不可用：binding-unavailable'), { code: 'WORKBUDDY_UNAVAILABLE', reason: 'binding-unavailable' }))
    expect(await manager.status(cli, f.root, signal())).toMatchObject({ state: 'unavailable', summary: 'WorkBuddy 暂不可用：binding-unavailable', actions: [] })
    for (const action of ['login', 'logout', 'manage'] as const)
      expect(() => manager.start('SIMULATED/parent', cli, action, f.root, signal())).toThrow('请在 WorkBuddy 桌面端登录或退出')
    expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
    await manager.close()
  })
  it('quarantines a native metadata cleanup failure instead of reporting a login failure', async () => {
    const f = fixture(), manager = new AccountManager(f.backend, f.config)
    probe.mockRejectedValueOnce(new Error('Native process exit is unconfirmed'))
    await expect(readCliAccountBinding('workbuddycn', f.backend, f.config, f.root, signal())).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
    probe.mockRejectedValueOnce(new Error('Native process exit is unconfirmed'))
    expect(await manager.status('workbuddycn', f.root, signal())).toMatchObject({ state: 'unavailable', cleanupBlocked: true, actions: [] })
    await manager.close()
  })
  it('propagates authentication and unavailable errors through catalog and binding; abort never probes', async () => {
    const f = fixture(), error = Object.assign(new Error('请打开 WorkBuddy 桌面端登录后重试'), { code: 'CLI_OWN_ACCOUNT_REQUIRED' })
    probe.mockRejectedValue(error)
    await expect(catalogFor('workbuddycn', f.backend, f.config, f.root, signal())).rejects.toBe(error)
    await expect(readCliAccountBinding('workbuddycn', f.backend, f.config, f.root, signal())).rejects.toBe(error)
    probe.mockClear()
    await expect(catalogFor('workbuddycn', f.backend, f.config, f.root, AbortSignal.abort('SIMULATED stop'))).rejects.toBe('SIMULATED stop')
    expect(probe).not.toHaveBeenCalled()
  })
})

const user = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
describe('模拟 WorkBuddy 别名与泛称路由', () => {
  it.each([
    ['workbuddycn', 'workbuddycn'], ['workbuddy-cn', 'workbuddycn'], ['WorkBuddy CN', 'workbuddycn'], ['WorkBuddy 国内版', 'workbuddycn'],
    ['workbuddy 中国版', 'workbuddycn'], ['国内版 WorkBuddy', 'workbuddycn'], ['WorkBuddy AI', 'workbuddy'], ['WorkBuddy（国际版）', 'workbuddy'],
    ['workbuddy-ai', 'workbuddy'], ['WorkBuddy 国际版', 'workbuddy'], ['workbuddy international', 'workbuddy'],
  ])('keeps explicit %s as %s without probing either version', async (name, cli) => {
    const installed = vi.fn()
    expect(requireCliName(name)).toBe(cli)
    expect(await resolveAvailableWorkBuddyName(name, installed)).toMatchObject({ status: 'resolved', cli })
    expect(installed).not.toHaveBeenCalled(); expect(isGenericWorkBuddyName(name)).toBe(false)
    expect(invocationResolution([user(`请用 ${name} CLI 检查模拟文件`)])).toMatchObject({ status: 'resolved', cli })
  })
  it.each([
    [[], 'unavailable', undefined], [['workbuddycn'], 'resolved', 'workbuddycn'],
    [['workbuddy'], 'resolved', 'workbuddy'], [['workbuddycn', 'workbuddy'], 'ambiguous', undefined],
  ])('routes generic WorkBuddy by installed variants %j', async (available, status, cli) => {
    const installed = vi.fn(async id => (available as string[]).includes(id))
    expect(await resolveAvailableWorkBuddyName('WorkBuddy', installed)).toMatchObject({ status, ...(cli ? { cli } : {}) })
    expect(installed.mock.calls.map(([id]) => id)).toEqual(clis)
  })
  it('does not choose another version on a discovery error', async () => {
    const error = new Error('SIMULATED discovery error')
    await expect(resolveAvailableWorkBuddyName('workbuddy', async cli => { if (cli === 'workbuddycn') throw error; return true })).rejects.toBe(error)
  })
  it.each(['WorkBuddy CN', 'WorkBuddy（国际版）'])('asks the native version question and returns selected %s before model selection', async label => {
    const f = fixture(), ask = vi.fn(async () => ({ answers: [{ id: 'cliworker_workbuddy_variant', selected: [label] }] }))
    const agent = { id: 'SIMULATED/parent', session: { header: { cwd: f.root, origin: 'user' } },
      ctx: { get: (key: string) => key === 'userQuestions' ? { ask } : key === 'sandboxPolicy' ? { resolve: () => ({ mode: 'workspace-write' }) } : undefined } }
    const service: any = Object.create(CliWorkerService.prototype)
    Object.assign(service, { options: f.config, backend: f.backend, disposed: new AbortController(), pending: new Map(),
      runtime: { changed: vi.fn(), assertCliEnabled: vi.fn() } })
    expect(await service.chooseWorkBuddyVariant(agent, signal(), 'WorkBuddy')).toBe(label === 'WorkBuddy CN' ? 'workbuddycn' : 'workbuddy')
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask.mock.calls[0]).toEqual(expect.arrayContaining([expect.objectContaining({ questions: [expect.objectContaining({ options: [{ label: 'WorkBuddy CN' }, { label: 'WorkBuddy（国际版）' }] })] })]))
    expect(probe).not.toHaveBeenCalled()
  })
  it('cancels an unanswered version question without probing an account', async () => {
    const f = fixture(), ask = vi.fn(async () => ({ answers: [] }))
    const agent = { id: 'SIMULATED/parent', session: { header: { cwd: f.root, origin: 'user' } },
      ctx: { get: (key: string) => key === 'userQuestions' ? { ask } : key === 'sandboxPolicy' ? { resolve: () => ({ mode: 'workspace-write' }) } : undefined } }
    const service: any = Object.create(CliWorkerService.prototype)
    Object.assign(service, { options: f.config, backend: f.backend, disposed: new AbortController(), pending: new Map(),
      runtime: { changed: vi.fn(), assertCliEnabled: vi.fn() } })
    await expect(service.chooseWorkBuddyVariant(agent, signal(), 'workbuddy')).rejects.toThrow('任务尚未启动')
    expect(probe).not.toHaveBeenCalled(); expect(service.pending.size).toBe(0)
  })
})
