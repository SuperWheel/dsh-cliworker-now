/** 模拟：Phase B 服务、进程、网络和平台行为；没有真实安装、更新或 CLI --version。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { CliExecutablePathStore } from '../src/host/cli-executable-paths.ts'
import { ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
import { identifyInstallation } from '../src/host/cli-management/identity.ts'
import { CliManagementService } from '../src/host/cli-management/service.ts'
import { CliManagementCache } from '../src/host/cli-management/cache.ts'
import { planCliOperation, operationArgv } from '../src/host/cli-management/planner.ts'
import { executeCliOperation, outputTail } from '../src/host/cli-management/executor.ts'
import { ReleaseClient } from '../src/host/cli-management/versions.ts'
import { CLI_IDS } from '../src/shared/types.ts'
import { control, syntheticIdentity, serviceFixture, childFixture, checked, finished, until, sri } from './cli-management-phase-b-fixture.ts'
const fixtures: ReturnType<typeof serviceFixture>[] = []
const fixture = (clis?: Parameters<typeof serviceFixture>[0]) => { const f = serviceFixture(clis); fixtures.push(f); return f }
afterEach(async () => { vi.useRealTimers(); for (const f of fixtures.splice(0)) await f.close() })

describe('模拟：Phase A 四项回归', () => {
  it('npm registry 清理未确认后不再探测，包括预加载、页面及设置查询', async () => {
    const f = fixture(); f.service.saveDownloadSource({ source: 'follow' })
    vi.mocked(f.backend.spawn).mockReturnValue({ stdout: Readable.from(['https://registry.npmjs.org/']), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0 }), terminate: vi.fn(), waitForExit: vi.fn(async () => false) } as any)
    await expect(f.service.downloadSource(control())).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
    expect(f.globalCleanup).toHaveBeenCalledTimes(1)
    await expect(f.service.downloadSource(control())).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
    expect(() => f.service.check('all')).toThrow(ProcessCleanupUnconfirmedError)
    await expect((f.service as any).local('codex', control(), true, false)).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
    expect(f.backend.spawn).toHaveBeenCalledTimes(1); expect(f.identify).not.toHaveBeenCalled()
    await expect(f.service.close()).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
  })
  it('清单版本变化即使启动器指纹未变也替换旧缓存并跨重启保留', async () => {
    const f = fixture(); await checked(f.service)
    f.identities.get('codex')!.manifestVersion = '1.1.0'
    expect((await checked(f.service)).entries.find(e => e.cli === 'codex')?.currentVersion).toBe('1.1.0')
    expect(new CliManagementCache(f.root).entries().find(e => e.cli === 'codex')?.currentVersion).toBe('1.1.0')
  })
  it('自动路径失效：后台不搜索，前台只读重找且保留记录', async () => {
    const f = fixture(), pkg = join(f.root, 'lib/node_modules/@openai/codex'), entry = join(pkg, 'bin/codex.js')
    mkdirSync(join(pkg, 'bin'), { recursive: true }); writeFileSync(entry, '// 模拟'); writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@openai/codex', version: '1.0.0' }))
    const store = new CliExecutablePathStore(f.root); store.remember('codex', join(f.root, 'gone'), store.revision('codex'))
    const config = { ...f.config, cliExecutablePaths: store }
    vi.mocked(f.backend.resolveExecutable).mockResolvedValue(entry)
    await expect(identifyInstallation('codex', f.backend, config, control(), true)).rejects.toThrow()
    expect(f.backend.resolveExecutable).not.toHaveBeenCalled()
    expect((await identifyInstallation('codex', f.backend, config, control()))?.manifestVersion).toBe('1.0.0')
    expect(store.read('codex')?.path).toBe(join(f.root, 'gone'))
  })
  it('manual 变成 npm 后恢复远端查询', async () => {
    const f = fixture(); f.identities.get('codex')!.source = 'unknown'; await checked(f.service)
    expect(f.service.snapshot().entries.find(e => e.cli === 'codex')?.group).toBe('manual')
    f.identities.get('codex')!.source = 'npm'
    expect((await checked(f.service)).entries.find(e => e.cli === 'codex')?.group).toBe('updatable')
  })
})

describe('模拟：受控更新计划与服务', () => {
  it('所有方法仅按 sources 与归属生成：精确 npm、同前缀 brew、自带命令、兼容限制', async () => {
    const f = fixture(), id = syntheticIdentity()
    const p = planCliOperation('codex', 'update', id, '1.0.0', '1.2.3', 'https://mirror.invalid/')
    expect(await operationArgv(p, f.backend, '/模拟/verified.tgz')).toEqual([f.npm.node, f.npm.entry, 'install', '--global', '--prefix', '/模拟', '/模拟/verified.tgz', '--registry', 'https://mirror.invalid/', '--prefer-offline', '--include=optional'])
    expect(await operationArgv({ ...p, method: 'brew' }, f.backend)).toEqual(['/模拟/bin/brew', 'upgrade', '--cask', 'codex'])
    expect(await operationArgv({ ...p, method: 'self-update', cli: 'qoder' }, f.backend)).toEqual(['/模拟/bin/codex', 'update'])
    expect(planCliOperation('pi', 'update', { ...id, source: 'self-update' }, '1.0.2', '1.1.0', p.registry).pinsVersion).toBe(false)
    expect(() => planCliOperation('codex', 'update', { ...id, source: 'unknown' }, '1.0.0', '1.2.3', p.registry)).toThrow('尚未核实')
    await expect(operationArgv(p, f.backend)).rejects.toThrow('缺少已校验')
  })
  it('requestId 幂等，关闭 watch 不停止操作；成功核对及缓存失效', async () => {
    const f = fixture(); await checked(f.service); const token = f.service.snapshot().entries.find(e => e.cli === 'codex')!.planToken!
    const child = childFixture(); vi.mocked(f.backend.spawn).mockReturnValue(child.child as any)
    const first = f.service.start('codex', 'update', token, '', 'req')
    const reader = new AbortController(), stream = f.service.watch(reader.signal); await stream.next(); reader.abort(); await stream.next()
    expect(f.service.start('codex', 'update', token, '', 'req').operation!.id).toBe(first.operation!.id)
    expect(() => f.service.start('codex', 'update', token, '', 'other')).toThrow('CLI_BUSY')
    await until(() => vi.mocked(f.backend.spawn).mock.calls.length === 1)
    f.identities.set('codex', syntheticIdentity('codex', '1.2.3')); child.finish(); await until(() => child.child.waitForExit.mock.calls.length > 0); child.exit(true)
    const result = (await finished(f.service)).results[0]!
    expect(result).toMatchObject({ id: first.operation!.id, phase: 'succeeded', beforeVersion: '1.0.0', afterVersion: '1.2.3', integritySource: 'https://registry.npmjs.org/', progress: { readable: false, byteProgress: false } })
    expect(f.invalidateModels).not.toHaveBeenCalled(); expect(f.service.cache.version('codex', syntheticIdentity().fingerprint)).toBeUndefined()
    expect(f.service.start('codex', 'update', token, '', 'req').operation?.id).toBe(result.id); expect(f.backend.spawn).toHaveBeenCalledTimes(1)
    expect(() => f.service.start('codex', 'update', token + 'a', '', 'req')).toThrow('requestId')
  })
  it.each(['fingerprint', 'registry', 'version', 'target'] as const)('开始前 %s 变化拒绝启动', async change => {
    const f = fixture(); await checked(f.service); const token = f.service.snapshot().entries.find(e => e.cli === 'codex')!.planToken!
    if (change === 'fingerprint') f.identities.get('codex')!.fingerprint.mtimeMs++
    if (change === 'version') f.identities.get('codex')!.manifestVersion = '1.1.0'
    if (change === 'registry') f.service.saveDownloadSource({ source: 'npmmirror' })
    if (change === 'target') (f.service as any).entry('codex').latestCompatibleVersion = '1.3.0'
    f.service.start('codex', 'update', token, '', 'req')
    expect((await finished(f.service)).results[0]?.error?.code).toBe('PLAN_EXPIRED'); expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it('CLI_BUSY 带 busyWorkers，同步维护租约拒绝账号或元数据占用', async () => {
    const f = fixture(); await checked(f.service); const token = f.service.snapshot().entries.find(e => e.cli === 'codex')!.planToken!
    f.busy.mockReturnValue({ workers: 2, accounts: false })
    try { f.service.start('codex', 'update', token, '', 'busy') } catch (error) { expect(error).toMatchObject({ code: 'CLI_BUSY', busyWorkers: 2 }) }
    f.busy.mockReturnValue({ workers: 0, accounts: true }); expect(() => f.service.start('codex', 'update', token, '', 'busy')).toThrow('CLI_BUSY')
    f.busy.mockReturnValue({ workers: 0, accounts: false }); const release = f.config.cliMaintenance.using('codex')
    expect(() => f.service.start('codex', 'update', token, '', 'busy')).toThrow('CLI_BUSY'); release()
    f.service.start('codex', 'update', token, '', 'busy')
    expect(() => f.config.cliMaintenance.using('codex')).toThrow('MAINTENANCE')
    await finished(f.service)
  })
  it('全部更新按显示顺序排队；CLI id 移除待运行项；失败后继续', async () => {
    const f = fixture(['codex', 'kimi', 'mimo']), child = childFixture(); await checked(f.service)
    vi.mocked(f.backend.spawn).mockReturnValueOnce(child.child as any)
    const initial = f.service.updateAll('batch')
    expect(initial.operation?.cli).toBe('codex'); expect(initial.queue).toEqual(['kimi', 'mimo'])
    expect(f.service.updateAll('batch').queue).toEqual(['kimi', 'mimo'])
    expect(f.service.cancel('kimi').queue).toEqual(['mimo'])
    await until(() => vi.mocked(f.backend.spawn).mock.calls.length === 1); child.finish(1); await until(() => child.child.waitForExit.mock.calls.length > 0); child.exit(true)
    const final = await finished(f.service)
    expect(final.results.map(op => op.cli)).toEqual(['codex', 'mimo']); expect(final.results[0]?.error?.code).toBe('EXIT_CODE'); expect(f.backend.spawn).toHaveBeenCalledTimes(2)
  })
  it.each(['unchanged', 'mismatch', 'identity'] as const)('结果核对：%s', async mode => {
    const f = fixture(); await checked(f.service)
    vi.mocked(f.backend.spawn).mockImplementation(() => {
      if (mode !== 'unchanged') f.identities.set('codex', syntheticIdentity('codex', mode === 'mismatch' ? '1.3.0' : '1.2.3'))
      if (mode === 'identity') f.identities.get('codex')!.fingerprint.realpath = '/other/cli.js'
      return { done: Promise.resolve({ exitCode: 0 }), stdout: Readable.from([]), stderr: Readable.from([]), waitForExit: vi.fn(async () => true), terminate: vi.fn() } as any
    })
    f.service.start('codex', 'update', f.service.snapshot().entries.find(e => e.cli === 'codex')!.planToken!, '', 'req')
    expect((await finished(f.service)).results[0]?.error?.code).toBe({ unchanged: 'VERSION_UNCHANGED', mismatch: 'VERSION_MISMATCH', identity: 'IDENTITY_CHANGED' }[mode]); expect(f.invalidateModels).not.toHaveBeenCalled()
  })
  it.each([true, false])('取消等整个进程树退出：确认=%s', async confirmed => {
    const f = fixture(), child = childFixture(); await checked(f.service); vi.mocked(f.backend.spawn).mockReturnValue(child.child as any)
    const op = f.service.start('codex', 'update', f.service.snapshot().entries.find(e => e.cli === 'codex')!.planToken!, '', 'req').operation!
    await until(() => vi.mocked(f.backend.spawn).mock.calls.length === 1)
    expect(f.service.cancel(op.id).operation?.phase).toBe('cancelling')
    await until(() => child.child.waitForExit.mock.calls.length > 0)
    expect(f.service.snapshot().results).toEqual([]); expect(() => f.config.cliMaintenance.assertAvailable('codex')).toThrow('MAINTENANCE')
    child.finish(); child.exit(confirmed)
    const result = (await finished(f.service)).results[0]!
    expect(result.phase).toBe(confirmed ? 'cancelled' : 'cleanup-unconfirmed')
    // 模拟：更新结束（含取消）不作废账号与模型显示；隔离清理不发布可用状态。
    expect(f.invalidateModels).not.toHaveBeenCalled()
    if (!confirmed) { expect(f.cleanup).toHaveBeenCalled(); expect(() => f.config.cliMaintenance.assertAvailable('codex')).toThrow('MAINTENANCE') }
    else expect(() => f.config.cliMaintenance.assertAvailable('codex')).not.toThrow()
  })
  it('插件停用清空队列且等待清理', async () => {
    const f = fixture(['codex', 'kimi']), child = childFixture(); await checked(f.service); vi.mocked(f.backend.spawn).mockReturnValue(child.child as any)
    f.service.updateAll('batch'); await until(() => vi.mocked(f.backend.spawn).mock.calls.length === 1)
    let closed = false; const pending = f.service.close().then(() => { closed = true })
    await until(() => child.child.waitForExit.mock.calls.length > 0); expect(closed).toBe(false)
    child.finish(); child.exit(true); await pending
    expect(f.backend.spawn).toHaveBeenCalledTimes(1); expect(f.service.snapshot().queue).toEqual([]); expect(f.service.snapshot().results[0]?.phase).toBe('cancelled')
  })
  it('模拟：缺少本机路径存储时所有 17 CLI 不启动安装', () => {
    const f = fixture()
    for (const cli of CLI_IDS) expect(() => f.service.start(cli, 'install', '', '', 'install')).toThrow('缺少本机路径存储')
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
})

describe('模拟：输出与官方 integrity', () => {
  it('跨 chunk 令牌、Cookie、Authorization、URL 凭据均脱敏，32 KiB 字节上限', async () => {
    const f = fixture(), child = childFixture(), chunks: string[] = []
    vi.mocked(f.backend.spawn).mockReturnValue(child.child as any)
    const pending = executeCliOperation(f.backend, f.config, ['模拟'], control(), value => chunks.push(value))
    child.child.stdout.write('\x1b[31mAuthorization: Bea'); child.child.stdout.write('rer SECRET\nCookie: SESSION\nhttps://alice:PASS@example.invalid/path?token=TOKEN\napi_key=KEY\n')
    child.finish(); await until(() => child.child.waitForExit.mock.calls.length > 0); child.exit(true); await pending
    expect(chunks.join('')).not.toMatch(/SECRET|SESSION|alice|PASS|TOKEN|KEY|\x1b/)
    expect(Buffer.byteLength(outputTail('中'.repeat(40000)))).toBeLessThanOrEqual(32768)
  })
  it('安装超时也终止进程树', async () => {
    vi.useFakeTimers(); const f = fixture(), child = childFixture(); vi.mocked(f.backend.spawn).mockReturnValue(child.child as any)
    const pending = executeCliOperation(f.backend, f.config, ['模拟'], control(), () => {}, 100).catch(error => error)
    await vi.advanceTimersByTimeAsync(101); expect(child.child.terminate).toHaveBeenCalled(); child.finish(); child.exit(true)
    expect((await pending).code).toBe('INSTALL_TIMEOUT')
  })
  it('镜像 integrity 必须匹配官方源，无官方值时不更新', async () => {
    const fetcher = vi.fn(async url => new Response(JSON.stringify({ name: '@openai/codex', version: '1.2.3', dist: { integrity: sri(String(url).includes('npmjs') ? '官方' : '镜像') } })))
    const client = new ReleaseClient(fetcher)
    await expect(client.integrity('codex', '1.2.3', 'https://mirror.invalid/', control())).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
    expect(fetcher.mock.calls[0]![0]).toContain('registry.npmjs.org')
  })
})
it('模拟：更新暂停后台当前项并等待其清理，之后才执行', async () => {
  vi.useFakeTimers(); const f = fixture(); (f.service as any).deps.enabled = () => true
  // The preloader captured the enabled function at construction; replace its fixture option.
  const preloader = (f.service as any).preloader
  preloader.options.enabled = () => true
  let sample = 0; preloader.options.sample = () => [{ model: '模拟', speed: 1, times: { user: ++sample * 10, idle: sample * 90, sys: 0, nice: 0, irq: 0 } }]
  let settle!: () => void, probeSignal!: AbortSignal
  f.identify.mockImplementation(async (cli, _backend, _config, signal) => {
    if (cli === 'antigravity') { probeSignal = signal; return new Promise(resolve => { settle = () => resolve(undefined) }) }
    return structuredClone(f.identities.get(cli))
  })
  const plan = planCliOperation('codex', 'update', f.identities.get('codex'), '1.0.0', '1.2.3', 'https://registry.npmjs.org/')
  Object.assign((f.service as any).entry('codex'), { group: 'updatable', latestCompatibleVersion: '1.2.3', planToken: plan.token })
  await vi.advanceTimersByTimeAsync(62_000); expect(settle).toBeDefined()
  f.service.start('codex', 'update', plan.token, '', 'pause')
  expect(probeSignal.aborted).toBe(true); await vi.advanceTimersByTimeAsync(1000); expect(f.backend.spawn).not.toHaveBeenCalled()
  settle(); await finished(f.service); expect(f.backend.spawn).toHaveBeenCalledTimes(1)
})
it('模拟：已受理操作固定下载源，设置变更只影响下一次更新', async () => {
  const f = fixture(); await checked(f.service)
  const token = f.service.snapshot().entries.find(e => e.cli === 'codex')!.planToken!
  f.service.start('codex', 'update', token, '', 'fixed-registry'); f.service.saveDownloadSource({ source: 'npmmirror' })
  await finished(f.service)
  expect(vi.mocked(f.backend.spawn).mock.calls[0]![0].argv).toContain('https://registry.npmjs.org/')
})
it('模拟：并发 follow registry 读取共享一个进程，清理失败后拒绝所有重试', async () => {
  const f = fixture(), child = childFixture(); f.service.saveDownloadSource({ source: 'follow' }); vi.mocked(f.backend.spawn).mockReturnValue(child.child as any)
  const first = f.service.downloadSource(control()).catch(error => error), second = f.service.downloadSource(control()).catch(error => error)
  await until(() => vi.mocked(f.backend.spawn).mock.calls.length > 0)
  child.child.stdout.write('https://registry.npmjs.org/'); child.finish()
  await until(() => child.child.waitForExit.mock.calls.length === 1); child.exit(false)
  await until(() => child.child.waitForExit.mock.calls.length === 2); child.exit(false)
  expect(await first).toBeInstanceOf(ProcessCleanupUnconfirmedError); expect(await second).toBeInstanceOf(ProcessCleanupUnconfirmedError)
  expect(f.backend.spawn).toHaveBeenCalledTimes(1)
})
