/** 模拟：发布清单、下载、CLI 进程与版本均为夹具；仅写测试临时目录。 */
import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { cliTakeoverRequestSchema, cliTakeoverResultSchema } from '../src/shared/cli-management.ts'
import { ChannelMemory, channelMemoryKey } from '../src/host/cli-management/channel-memory.ts'
import * as hermesUpdate from '../src/host/cli-management/hermes-watch.ts'
import { CliWorkerService } from '../src/host/index.ts'
import { CliExecutablePathStore } from '../src/host/cli-executable-paths.ts'
import { CliManagementService } from '../src/host/cli-management/service.ts'
import { METADATA_EXIT_GRACE_MS, ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
import { CliInstaller } from '../src/host/cli-management/install.ts'
import { CliOperationError } from '../src/host/cli-management/planner.ts'
import { ReadOnlyTimeoutError, captureReadOnly } from '../src/host/cli-management/versions.ts'
import { serviceFixture, syntheticIdentity, checked, finished, childFixture } from './cli-management-phase-b-fixture.ts'
const simulated = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => simulated.home || '/模拟/home' }))
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
const fixtures: ReturnType<typeof serviceFixture>[] = []
const installerServices: CliManagementService[] = []
const repairProbeRoots = new Set<string>()
const data = '模拟new', targetVersion = '1.2.3', checksum = createHash('sha256').update(data).digest('hex')
function fixture() {
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' })
  const f = serviceFixture(['claude']); fixtures.push(f); simulated.home = f.root
  vi.stubEnv('LOCALAPPDATA', join(f.root, 'AppData/Local'))
  const target = join(f.root, '.local/bin/claude.exe'); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, 'old')
  const id = { ...syntheticIdentity('claude'), source: 'self-update' as const, executable: target, fingerprint: { realpath: target, size: 3, mtimeMs: 1 } }; f.identities.set('claude', id)
  f.version.mockImplementation(async () => readFileSync(target, 'utf8') === data ? targetVersion : '1.0.0')
  f.metadataFetch.mockImplementation(async url => new Response(JSON.stringify(String(url).endsWith('/dist-tags') ? { latest: targetVersion } : { version: targetVersion, platforms: { [`win32-${process.arch}`]: { binary: 'claude.exe', size: Buffer.byteLength(data), checksum } } })))
  f.artifactFetch.mockImplementation(async (_url, init) => new Response(init?.method === 'HEAD' ? null : data, { headers: { 'content-length': String(Buffer.byteLength(data)), etag: '"simulated"' } }))
  const proc = childFixture()
  const stage = join(f.root, '.cache/claude/staging/1.2.3.123.456/claude.exe')
  vi.mocked(f.backend.spawn).mockImplementation(() => { mkdirSync(dirname(stage), { recursive: true }); writeFileSync(stage, 'partial'); return proc.child as any })
  const start = async () => {
    await checked(f.service)
    f.service.start('claude', 'update', f.service.snapshot().entries.find(e => e.cli === 'claude')!.planToken!, '', '模拟manual')
    await vi.waitFor(() => expect(f.backend.spawn).toHaveBeenCalledOnce())
    return f.service.snapshot().operation!.id
  }
  const exit = async (confirmed = true) => {
    proc.finish(1); await vi.waitFor(() => expect(proc.child.waitForExit).toHaveBeenCalled()); proc.exit(confirmed)
  }
  return { ...f, proc, target, stage, start, exit, memory: new ChannelMemory(f.root), key: channelMemoryKey('claude', id) }
}
afterEach(async () => {
  vi.useRealTimers()
  for (const service of installerServices.splice(0)) await service.close().catch(() => undefined)
  for (const f of fixtures.splice(0)) await f.close()
  // 模拟句柄没有真实进程；未确认退出用例留下的探针目录由用例单独清理。
  for (const root of repairProbeRoots) rmSync(root, { recursive: true, force: true })
  repairProbeRoots.clear()
  simulated.home = ''; Object.defineProperty(process, 'platform', originalPlatform); vi.unstubAllEnvs(); vi.restoreAllMocks()
})
it('模拟：协议校验 CLI、操作 ID 与结果状态', () => {
  expect(cliTakeoverRequestSchema.parse({ cli: 'grok', operationId: '模拟op' })).toEqual({ cli: 'grok', operationId: '模拟op' })
  for (const request of [{ cli: 'harness', operationId: 'x' }, { cli: 'unknown', operationId: 'x' }, { cli: 'grok', operationId: '' }, { cli: 'grok', operationId: 'x'.repeat(257) }, { cli: 'grok', operationId: 'x', command: 'ignored' }]) expect(cliTakeoverRequestSchema.safeParse(request).success).toBe(false)
  expect(cliTakeoverResultSchema.safeParse({ operationId: 'x', status: 'switched' }).success).toBe(true)
  expect(cliTakeoverResultSchema.safeParse({ operationId: 'x', status: 'started' }).success).toBe(false)
})
it('模拟：手动切换与双击共享退出屏障，清理后接管且记住 7 天，结束后幂等', async () => {
  const f = fixture(), id = await f.start()
  expect(f.service.snapshot().operation).toMatchObject({ officialTakeover: 'available', progress: { channel: 'official' } })
  let settled = false
  const first = f.service.requestTakeover('claude', id).then(value => { settled = true; return value })
  const second = f.service.requestTakeover('claude', id)
  await vi.waitFor(() => expect(f.proc.child.terminate).toHaveBeenCalledOnce())
  expect(f.service.snapshot().operation?.officialTakeover).toBe('pending')
  expect(settled).toBe(false); expect(existsSync(f.stage)).toBe(true)
  expect(f.artifactFetch.mock.calls.filter(([, init]) => init?.method !== 'HEAD')).toHaveLength(0)
  await f.exit()
  expect(await first).toEqual({ operationId: id, status: 'switched' }); expect(await second).toEqual(await first)
  expect(existsSync(f.stage)).toBe(false)
  const end = await finished(f.service)
  expect(end.results[0]).toMatchObject({ phase: 'succeeded', progress: { channel: 'takeover', reason: 'OFFICIAL_MANUAL' } })
  expect(end.results[0]?.officialTakeover).toBeUndefined()
  expect(await f.memory.get(f.key)).toMatchObject({ reason: 'OFFICIAL_MANUAL' })
  expect(await f.service.requestTakeover('claude', id)).toEqual({ operationId: id, status: 'finished' })
})
it('模拟：过期操作、错误 CLI 与非官方阶段不能切换；接管后幂等', async () => {
  const f = fixture(), id = await f.start()
  expect(await f.service.requestTakeover('grok', id)).toMatchObject({ status: 'finished' })
  expect(await f.service.requestTakeover('claude', '旧操作')).toMatchObject({ status: 'finished' })
  expect(f.proc.child.terminate).not.toHaveBeenCalled()
  let unblock!: () => void
  const held = new Promise<void>(resolve => { unblock = resolve })
  const fetch = f.artifactFetch.getMockImplementation()!
  f.artifactFetch.mockImplementation(async (...args) => { if (args[1]?.method !== 'HEAD') await held; return fetch(...args) })
  const switching = f.service.requestTakeover('claude', id); await f.exit(); await switching
  expect(await f.service.requestTakeover('claude', id)).toMatchObject({ status: 'already-switched' })
  unblock(); await finished(f.service)
})
it('模拟：退出范围无法确认不报告切换成功，不清理半成品、不下载', async () => {
  const f = fixture(), id = await f.start(), switching = f.service.requestTakeover('claude', id)
  await f.exit(false)
  expect(await switching).toMatchObject({ status: 'cleanup-unconfirmed' })
  expect((await finished(f.service)).results[0]?.phase).toBe('cleanup-unconfirmed')
  expect(existsSync(f.stage)).toBe(true)
  expect(f.artifactFetch.mock.calls.filter(([, init]) => init?.method !== 'HEAD')).toHaveLength(0)
})
it.each(['unchanged', 'advanced', 'broken', 'unreadable', 'missing', 'timeout', 'failure'] as const)('模拟：取消后只读核验 %s，在进程退出及清理后执行', async outcome => {
  const f = fixture()
  f.config.cliExecutablePaths = new CliExecutablePathStore(f.root, { platform: 'darwin' })
  f.config.cliExecutablePaths.setManual('claude', f.target)
  const pathBefore = f.config.cliExecutablePaths.read('claude'), revisionBefore = f.config.cliExecutablePaths.revision('claude')
  const remember = vi.spyOn(f.config.cliExecutablePaths, 'remember'), writePath = vi.spyOn(f.config.cliExecutablePaths, 'setManual')
  const id = await f.start()
  const reads = f.identify.mock.calls.length
  f.service.cancel(id)
  await vi.waitFor(() => expect(f.proc.child.terminate).toHaveBeenCalled())
  expect(f.identify).toHaveBeenCalledTimes(reads)
  if (outcome === 'advanced') writeFileSync(f.target, data)
  if (outcome === 'broken') f.identities.get('claude')!.repairNeeded = true
  if (outcome === 'missing') f.identities.delete('claude')
  if (outcome === 'unreadable') f.version.mockResolvedValue(undefined)
  if (outcome === 'timeout') f.version.mockRejectedValue(new ReadOnlyTimeoutError())
  if (outcome === 'failure') f.version.mockRejectedValue(new Error('模拟I/O失败'))
  const identify = f.identify.getMockImplementation()!
  f.identify.mockImplementation(async (...args) => { expect(existsSync(f.stage)).toBe(false); return identify(...args) })
  await f.exit()
  const snapshot = await finished(f.service), op = snapshot.results[0]!
  expect(op.phase).toBe('cancelled')
  expect(f.config.cliExecutablePaths.read('claude')).toEqual(pathBefore); expect(f.config.cliExecutablePaths.revision('claude')).toBe(revisionBefore)
  expect(remember).not.toHaveBeenCalled(); expect(writePath).not.toHaveBeenCalled()
  expect(f.backend.spawn).toHaveBeenCalledOnce()
  expect(f.artifactFetch.mock.calls.filter(([, init]) => init?.method !== 'HEAD')).toHaveLength(0)
  if (outcome === 'unchanged' || outcome === 'advanced') {
    expect(op.cancellationCheck).toEqual({ outcome, version: outcome === 'advanced' ? targetVersion : '1.0.0' })
    expect(snapshot.entries.find(e => e.cli === 'claude')).toMatchObject({ currentVersion: outcome === 'advanced' ? targetVersion : '1.0.0', group: outcome === 'advanced' ? 'latest' : 'updatable' })
  } else if (['broken', 'unreadable', 'missing'].includes(outcome)) {
    expect(op.cancellationCheck).toMatchObject({ outcome: 'broken', reason: expect.any(String) })
    expect(snapshot.entries.find(e => e.cli === 'claude')).toMatchObject({ group: 'failed', reason: 'UNKNOWN_VERSION' })
  } else { expect(op.cancellationCheck).toBeUndefined(); expect(op.outputTail).toContain('已写入的文件不回滚') }
})

it('模拟：非官方准备阶段不切换，服务再次校验非法 CLI', async () => {
  const f = serviceFixture(); fixtures.push(f); await checked(f.service)
  const token = f.service.snapshot().entries.find(e => e.cli === 'codex')!.planToken!
  const id = f.service.start('codex', 'update', token, '', '模拟preparing').operation!.id
  expect(await f.service.requestTakeover('codex', id)).toMatchObject({ status: 'not-official' })
  await expect(f.service.requestTakeover('invalid' as any, id)).rejects.toThrow()
  await finished(f.service)
})
it('模拟：Gateway 校验会话、权限、CLI 与操作 ID，返回明确状态', async () => {
  const management = { requestTakeover: vi.fn(async (_cli, operationId) => ({ operationId, status: 'finished' })) }
  const parent = vi.fn(async () => ({})), assertExecution = vi.fn()
  const host = Object.assign(Object.create(CliWorkerService.prototype), { cliManagement: management, parent, assertExecution }) as CliWorkerService
  const signal = new AbortController().signal
  expect(JSON.parse(await host.requestCliTakeover('模拟parent', 'claude', '模拟op', signal))).toEqual({ operationId: '模拟op', status: 'finished' })
  expect(parent).toHaveBeenCalledWith('模拟parent'); expect(assertExecution).toHaveBeenCalledOnce()
  expect(management.requestTakeover).toHaveBeenCalledWith('claude', '模拟op')
  for (const [cli, id] of [['harness', 'op'], ['invalid', 'op'], ['claude', '']]) await expect(host.requestCliTakeover('模拟parent', cli!, id!, signal)).rejects.toThrow()
  expect(management.requestTakeover).toHaveBeenCalledTimes(1)
  assertExecution.mockImplementationOnce(() => { throw new Error('模拟规划模式') })
  await expect(host.requestCliTakeover('模拟parent', 'claude', '模拟op', signal)).rejects.toThrow('模拟规划模式')
  expect(management.requestTakeover).toHaveBeenCalledTimes(1)
})

it.each([false, true])('模拟：Hermes 仅 fetch 阶段可切换，最近记忆 %s 沿同一路径自动接管', async remembered => {
  const f = serviceFixture(['hermes']); fixtures.push(f); simulated.home = f.root
  const before = { ...syntheticIdentity('hermes'), source: 'self-update' as const, updateRoot: join(f.root, 'hermes-agent') }
  f.identities.set('hermes', before)
  f.metadataFetch.mockResolvedValue(new Response(JSON.stringify({ draft: false, prerelease: false, tag_name: 'v1.2.3' })))
  // Each query needs its own Response body.
  f.metadataFetch.mockImplementation(async () => new Response(JSON.stringify({ draft: false, prerelease: false, tag_name: 'v1.2.3' })))
  const memory = new ChannelMemory(f.root), key = channelMemoryKey('hermes', before), failedAt = Date.now() - 86400000
  if (remembered) await memory.set(key, 'OFFICIAL_MANUAL', failedAt)
  let options!: hermesUpdate.HermesUpdateOptions, unblock!: () => void, replay!: () => void
  const replaying = new Promise<void>(resolve => { replay = resolve })
  const gate = new Promise<void>(resolve => { unblock = resolve })
  const watch = { currentStage: 'deps', controller: new AbortController(), requestTakeover: vi.fn(() => { watch.controller.abort(); return true }) }
  vi.spyOn(hermesUpdate, 'runHermesUpdate').mockImplementation(async o => {
    options = o; o.onWatch?.(watch as any)
    o.progress({ channel: 'official', readable: false, resumeCount: 0, stage: '模拟deps' })
    await gate
    o.onWatch?.(undefined)
    o.progress({ channel: 'takeover', readable: false, resumeCount: 0, reason: 'OFFICIAL_INTERRUPTED', stage: '模拟预取' })
    o.progress({ channel: 'official', readable: false, resumeCount: 0, stage: '模拟交回官方' })
    await replaying
    f.identities.set('hermes', { ...before, manifestVersion: '1.2.3' })
    return { receiptSucceeded: true }
  })
  await checked(f.service)
  const token = f.service.snapshot().entries.find(e => e.cli === 'hermes')!.planToken!
  const id = f.service.start('hermes', 'update', token, '', '模拟hermes').operation!.id
  await vi.waitFor(() => expect(options).toBeDefined())
  expect(f.service.snapshot().operation?.officialTakeover).toBeUndefined()
  expect(await f.service.requestTakeover('hermes', id)).toMatchObject({ status: 'not-official' })
  watch.currentStage = 'fetch'
  options.progress({ channel: 'official', readable: false, resumeCount: 0, stage: '模拟fetch' })
  if (!remembered) expect(f.service.snapshot().operation?.officialTakeover).toBe('available')
  const switching = f.service.requestTakeover('hermes', id)
  expect(watch.requestTakeover).toHaveBeenCalledOnce()
  expect(f.service.snapshot().operation?.officialTakeover).toBe('pending')
  unblock()
  expect(await switching).toMatchObject({ status: 'switched' })
  expect(f.service.snapshot().operation?.officialTakeover).toBeUndefined()
  expect(await f.service.requestTakeover('hermes', id)).toMatchObject({ status: 'already-switched' })
  replay()
  expect((await finished(f.service)).results[0]?.phase).toBe('succeeded')
  expect(await memory.get(key)).toMatchObject({ reason: 'OFFICIAL_MANUAL', ...(remembered ? { failedAt } : {}) })
})


/** 模拟：用同一组替身进程、元数据和身份依赖，创建真正启用 CliInstaller 的服务。 */
async function installedFixture() {
  const f = fixture()
  f.config.cliExecutablePaths = new CliExecutablePathStore(f.root, { platform: 'darwin' })
  expect(f.config.cliExecutablePaths.remember('claude', f.target, f.config.cliExecutablePaths.revision('claude'))).toBe(true)
  const service = new CliManagementService({ ...(f.service as any).deps })
  installerServices.push(service)
  // 仅检查本用例的已装 CLI；不为其余未安装行启动前置条件探针。
  const signal = new AbortController().signal
  await (service as any).local('claude', signal, false, false)
  await (service as any).remote('claude', signal, true)
  const token = service.snapshot().entries.find(e => e.cli === 'claude')!.planToken!
  const id = service.start('claude', 'update', token, '', '模拟cancel-review').operation!.id
  await vi.waitFor(() => expect(f.backend.spawn).toHaveBeenCalledOnce())
  return { f, service, id }
}
it.each(['confirmed', 'unconfirmed', 'never-exits'] as const)('模拟：取消修复入口准备超时，延迟退出确认 %s 前保留维护锁，失败进入隔离', async mode => {
  const confirmed = mode === 'confirmed'
  const { f, service, id } = await installedFixture(), repair = childFixture()
  const pathBefore = f.config.cliExecutablePaths!.read('claude'), revisionBefore = f.config.cliExecutablePaths!.revision('claude')
  const prepare = vi.spyOn(CliInstaller.prototype, 'prepare')
  const timeout = new AbortController(), nativeTimeout = AbortSignal.timeout
  // 模拟 60 秒核验预算到期；实际执行 captureReadOnly 的终止和退出确认路径。
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 60_000 ? timeout.signal : nativeTimeout(ms))
  let started!: () => void
  const repairStarted = new Promise<void>(resolve => { started = resolve })
  vi.mocked(f.backend.spawn).mockImplementation(spec => {
    expect(spec.argv).toEqual(['模拟-repair-probe', '--version'])
    expect(spec.env?.TEMP).toMatch(/[/\\]cliworker-probe-[^/\\]+$/)
    repairProbeRoots.add(spec.env!.TEMP!)
    started(); return repair.child as any
  })
  const identify = f.identify.getMockImplementation()!
  let reads = 0
  f.identify.mockImplementation(async (cli, ...args: any[]) => {
    if (service.snapshot().operation?.phase === 'cancelling') {
      if (++reads === 1) throw new CliOperationError('INTEGRITY_MISMATCH', '模拟取消后安装不完整')
      const signal = args[2] as AbortSignal
      await captureReadOnly(f.backend, f.config, ['模拟-repair-probe', '--version'], signal, false, undefined, 120_000)
    }
    return identify(cli)
  })
  service.cancel(id); await f.exit(); await repairStarted
  expect(prepare).toHaveBeenCalledOnce()
  let settled = false
  const end = finished(service).then(value => { settled = true; return value })
  if (mode === 'never-exits') vi.useFakeTimers()
  timeout.abort(new DOMException('模拟核验超时', 'TimeoutError'))
  if (mode === 'never-exits') { await vi.advanceTimersByTimeAsync(0); expect(repair.child.terminate).toHaveBeenCalled() }
  else await vi.waitFor(() => expect(repair.child.terminate).toHaveBeenCalled())
  expect(settled).toBe(false); expect(service.snapshot().results).toHaveLength(0)
  expect(service.snapshot().operation?.phase).toBe('cancelling')
  expect(service.maintenance.isHeld('claude')).toBe(true)
  expect(() => service.maintenance.begin('claude', () => ({ workers: 0, accounts: false }))).toThrow('MAINTENANCE')
  expect(f.cleanup).not.toHaveBeenCalled()
  if (mode === 'never-exits') {
    // 模拟 done、输出和范围退出永不完成；waitForExit 也忽略传入的退出时限。
    const exitSignal = repair.child.waitForExit.mock.calls[0]![0] as AbortSignal
    expect(exitSignal).toBeInstanceOf(AbortSignal); expect(exitSignal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(f.config.graceMs + METADATA_EXIT_GRACE_MS - 1)
    expect(settled).toBe(false); expect(service.maintenance.isHeld('claude')).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(exitSignal.aborted).toBe(true)
  } else {
    // 模拟主进程先结束，进程范围仍未确认退出，仍不能发布结果或释放维护锁。
    repair.finish(1)
    await vi.waitFor(() => expect(repair.child.waitForExit).toHaveBeenCalled())
    expect(settled).toBe(false); expect(service.maintenance.isHeld('claude')).toBe(true)
    repair.exit(confirmed)
  }
  const result = (await end).results[0]!
  expect(result.phase).toBe(confirmed ? 'cancelled' : 'cleanup-unconfirmed')
  expect(result.cancellationCheck).toMatchObject({ outcome: 'broken' })
  expect(service.maintenance.isHeld('claude')).toBe(!confirmed)
  if (confirmed) expect(f.cleanup).not.toHaveBeenCalled()
  else { expect(result.error?.code).toBe('CLEANUP_UNCONFIRMED'); expect(f.cleanup).toHaveBeenCalledOnce() }
  expect(f.config.cliExecutablePaths!.read('claude')).toEqual(pathBefore)
  expect(f.config.cliExecutablePaths!.revision('claude')).toBe(revisionBefore)
  expect(f.backend.spawn).toHaveBeenCalledTimes(2)
  if (mode === 'never-exits') await expect(service.close()).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
})
it.each([
  { code: 'SUBPROCESS_EXECUTABLE_NOT_FOUND' }, { reason: 'not-installed' },
])('模拟：自动发现的原执行文件缺失 %j 判为损坏，并走真实修复入口准备', async missing => {
  const { f, service, id } = await installedFixture()
  const pathBefore = f.config.cliExecutablePaths!.read('claude'), revisionBefore = f.config.cliExecutablePaths!.revision('claude')
  expect(pathBefore?.mode).toBe('auto')
  const prepare = vi.spyOn(CliInstaller.prototype, 'prepare')
  f.identify.mockRejectedValue(Object.assign(new Error('模拟原执行文件未安装'), missing))
  // 模拟自动发现入口实际消失；保留自动路径记录，准备阶段自行确认缺失。
  const { unlinkSync } = await import('node:fs')
  unlinkSync(f.target)
  service.cancel(id); await f.exit()
  const snapshot = await finished(service), result = snapshot.results[0]!, row = snapshot.entries.find(e => e.cli === 'claude')!
  expect(result).toMatchObject({ phase: 'cancelled', cancellationCheck: { outcome: 'broken', reason: '模拟原执行文件未安装' } })
  expect(prepare).toHaveBeenCalledOnce()
  expect(row).toMatchObject({ group: 'failed', reason: 'UNKNOWN_VERSION', install: { method: 'manual' }, planToken: expect.any(String) })
  expect(f.config.cliExecutablePaths!.read('claude')).toEqual(pathBefore)
  expect(f.config.cliExecutablePaths!.revision('claude')).toBe(revisionBefore)
  expect(f.backend.spawn).toHaveBeenCalledOnce()
  expect(service.maintenance.isHeld('claude')).toBe(false)
})
