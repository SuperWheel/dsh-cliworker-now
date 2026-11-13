/** 模拟：7.3 实机发现的回归；全部 HTTP、CLI 输出、Windows 启动器与退出回执均为夹具。 */
import { afterEach, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLI_IDS, type ActiveCliId } from '../src/shared/types.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
import { ReleaseClient, currentVersion, firstVersion, latestCompatible, RELEASE_JSON_LIMIT, RELEASE_VERSIONS_LIMIT } from '../src/host/cli-management/versions.ts'
import { classifyInstallation } from '../src/host/cli-management/identity.ts'
import { CLI_SOURCES } from '../src/host/cli-management/sources.ts'
import { automaticMethod, operationArgv } from '../src/host/cli-management/planner.ts'
import { nativeProcessBackend } from '../src/host/native-process.ts'
import { serviceFixture, syntheticIdentity, control, checked, childFixture } from './cli-management-phase-b-fixture.ts'

const fixtures: ReturnType<typeof serviceFixture>[] = []
const fixture = (cli: ActiveCliId = 'codex') => { const f = serviceFixture([cli]); fixtures.push(f); return f }
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close() })
const response = (data: unknown) => new Response(JSON.stringify(data))
const exited = (raw: string) => ({ stdout: Readable.from([Buffer.from(raw)]), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), terminate: vi.fn(), waitForExit: vi.fn(async () => true) })
const nativeIdentity = (cli: ActiveCliId) => ({ ...syntheticIdentity(cli), manifestVersion: undefined, fingerprint: { realpath: `/模拟/bin/${cli}`, size: 10, mtimeMs: 100 } })

it.each(['codex', 'codebuddy', 'claude', 'opencode', 'pi'] as const)('模拟：%s latest 已适配时只读 dist-tags，拒绝拉大 packument', async cli => {
  const latest = cli === 'pi' ? '1.1.0' : '1.19.0'
  const fetcher = vi.fn(async (url: string | URL) => {
    expect(String(url)).toBe(`https://registry.npmjs.org/-/package/${encodeURIComponent(CLI_SOURCES[cli].npm!)}/dist-tags`)
    return response({ latest })
  })
  expect(await new ReleaseClient(fetcher).query(cli, 'https://registry.npmjs.org/', control())).toMatchObject({ latest, versions: [latest] })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it.each(['opencode'] as const)('模拟：%s latest 不兼容时才读取大版本列表，缓存仅保留候选', async cli => {
  const fetcher = vi.fn(async (url: string | URL) => String(url).endsWith('/dist-tags') ? response({ latest: '2.0.0' }) : response({ versions: { '1.0.2': {}, '1.1.0': {}, '1.19.0': {}, '1.20.0-beta.1': {}, '2.0.0': {} }, padding: '模拟'.repeat(300_000) }))
  const record = await new ReleaseClient(fetcher).query(cli, 'https://registry.npmjs.org/', control())
  expect(latestCompatible(cli, record.versions, '1.0.2')).toBe('1.19.0')
  expect(record.latest).toBe('2.0.0'); expect(record.versions.length).toBeLessThanOrEqual(3)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it.each(['declared', 'streamed'] as const)('模拟：版本列表 %s 超过 32 MiB 仍拒绝并取消流，普通 JSON 仍限 512 KiB', async kind => {
  const cancel = vi.fn(), chunk = new Uint8Array(1024 * 1024)
  const fetcher = vi.fn(async (url: string | URL) => String(url).endsWith('/dist-tags') ? response({ latest: '2.0.0' }) : new Response(new ReadableStream({ pull(controller) { controller.enqueue(chunk) }, cancel }), { headers: kind === 'declared' ? { 'content-length': String(RELEASE_VERSIONS_LIMIT + 1) } : {} }))
  await expect(new ReleaseClient(fetcher).query('opencode', 'https://registry.npmjs.org/', control())).rejects.toThrow('RELEASE_UNREACHABLE')
  expect(cancel).toHaveBeenCalled()
  await expect(new ReleaseClient(async () => new Response(' '.repeat(RELEASE_JSON_LIMIT + 1))).json('https://registry.npmjs.org/x', control())).rejects.toThrow('RELEASE_UNREACHABLE')
})
it('模拟：大版本列表仍受 8 秒超时约束', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn(async (url: string | URL) => String(url).endsWith('/dist-tags') ? response({ latest: '2.0.0' }) : new Response(new ReadableStream({ pull() { return new Promise(() => {}) } })))
  const pending = new ReleaseClient(fetcher).query('opencode', 'https://registry.npmjs.org/', control())
  const assertion = expect(pending).rejects.toThrow('RELEASE_TIMEOUT')
  await vi.advanceTimersByTimeAsync(8001); await assertion
})

const outputs: Partial<Record<ActiveCliId, string>> = {
  antigravity: '1.5.8', codex: 'codex-cli 0.162.1', claude: '2.1.287 (Claude Code)', kimi: '2.4.1', mimo: '0.1.15', grok: 'grok 1.0.62 (1474f9cbdd91)', omp: 'omp/16.4.4', pi: '1.0.4', opencode: '1.19.0', qoder: '1.1.73', qodercn: '1.1.74', codebuddy: '2.181.0', traecn: 'traecli 0.213.1 installation: public',
}
const backgroundCommands = new Set<ActiveCliId>(['antigravity', 'claude', 'kimi', 'mimo', 'grok', 'omp', 'pi', 'opencode', 'codebuddy', 'traecn'])
it.each(CLI_IDS)('模拟：%s 前后台版本命令策略、实际入口、Kimi 环境变量', async cli => {
  const f = fixture(cli), identity = nativeIdentity(cli)
  vi.mocked(f.backend.spawn).mockImplementation(() => exited(`\x1b[32m${outputs[cli] ?? '模拟不应执行'}\x1b[0m`))
  const foreground = await currentVersion(cli, identity, f.backend, f.config, control())
  expect(foreground).toBe(outputs[cli] ? firstVersion(outputs[cli]!) : undefined)
  if (outputs[cli]) expect(f.backend.spawn).toHaveBeenLastCalledWith(expect.objectContaining({ argv: [identity.executable, '--version'], stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }, ...(cli === 'kimi' ? { env: { KIMI_CODE_NO_AUTO_UPDATE: '1' } } : {}) }))
  else expect(f.backend.spawn).not.toHaveBeenCalled()
  vi.mocked(f.backend.spawn).mockClear()
  expect(await currentVersion(cli, identity, f.backend, f.config, control(), true)).toBe(backgroundCommands.has(cli) ? foreground : undefined)
  expect(vi.mocked(f.backend.spawn).mock.calls.length).toBe(backgroundCommands.has(cli) ? 1 : 0)
  if (backgroundCommands.has(cli)) expect(vi.mocked(f.backend.spawn).mock.calls[0]![0].argv).toContain('--cliworker-low-priority')
})
it.each(['01.2.3', '1.2.3.4', '1.2', 'unknown', 'ver1.2.3'])('模拟：无合法完整 SemVer 时不猜测（%s）', raw => expect(firstVersion(raw)).toBeUndefined())
it('模拟：去 ANSI 后返回第一个合法 SemVer，保留预发布/构建号', () => expect(firstVersion('模拟 01.2.3 \x1b[32mv1.2.3-beta.1+build\x1b[0m 9.0.0')).toBe('1.2.3-beta.1+build'))
it('模拟：清单优先，不启动命令', async () => {
  const f = fixture()
  expect(await currentVersion('codex', syntheticIdentity(), f.backend, f.config, control())).toBe('1.0.0')
  expect(f.backend.spawn).not.toHaveBeenCalled()
})
it.each([true, false])('模拟：版本命令 5 秒中止后等待整个进程范围；清理确认=%s', async confirmed => {
  vi.useFakeTimers(); const f = fixture(), child = childFixture()
  vi.mocked(f.backend.spawn).mockReturnValue(child.child as any)
  let settled = false
  const pending = currentVersion('codex', nativeIdentity('codex'), f.backend, f.config, control()).catch(error => error).finally(() => { settled = true })
  await vi.advanceTimersByTimeAsync(4999); expect(child.child.terminate).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(2); expect(child.child.terminate).toHaveBeenCalled(); expect(settled).toBe(false)
  child.finish(); child.exit(confirmed)
  const error = await pending
  if (!confirmed) expect(error).toBeInstanceOf(ProcessCleanupUnconfirmedError)
  else expect(error).toBeInstanceOf(Error)
})
it.each(['1.2.3', '模拟没有版本'])('模拟：指纹未变复用版本读取结果（%s），变化后才再探测', async raw => {
  const f = fixture('mimo'), identity = nativeIdentity('mimo'); f.identities.set('mimo', identity); f.version.mockImplementation(currentVersion as any)
  vi.mocked(f.backend.spawn).mockImplementation(() => exited(raw))
  await (f.service as any).local('mimo', control(), true, false)
  await (f.service as any).local('mimo', control(), true, false)
  await (f.service as any).local('mimo', control(), false, false)
  expect(f.backend.spawn).toHaveBeenCalledTimes(1)
  identity.fingerprint.size++; await (f.service as any).local('mimo', control(), true, false)
  expect(f.backend.spawn).toHaveBeenCalledTimes(2)
})
it('模拟：后台跳过 Codex 不会阻止前台探测；Hermes 明确说明并零进程', async () => {
  const f = fixture(), identity = nativeIdentity('codex'); f.identities.set('codex', identity); f.version.mockImplementation(currentVersion as any)
  vi.mocked(f.backend.spawn).mockImplementation(() => exited('codex-cli 0.162.1'))
  await (f.service as any).local('codex', control(), true, false); expect(f.backend.spawn).not.toHaveBeenCalled()
  await (f.service as any).local('codex', control(), false, false); expect(f.backend.spawn).toHaveBeenCalledTimes(1)
  f.identities.set('hermes', nativeIdentity('hermes'))
  await (f.service as any).local('hermes', control(), false, false)
  expect(f.service.snapshot().entries.find(e => e.cli === 'hermes')?.reasonDetail).toContain('前后台均不执行')
  expect(f.backend.spawn).toHaveBeenCalledTimes(1)
})
it('模拟：Codex standalone 按完整路径组件识别，走锁版官方脚本', () => {
  const home = '/模拟/home'
  const found = classifyInstallation('codex', `${home}/.codex/packages/standalone/0.162.1/codex`, undefined, home)
  expect(found.source).toBe('official-installer'); expect(automaticMethod('codex', { ...nativeIdentity('codex'), ...found })).toBe('official-script')
  for (const path of [`${home}/.codex/packages/standalone-other/codex`, `${home}-other/.codex/packages/standalone/codex`]) expect(classifyInstallation('codex', path, undefined, home).source).toBe('unknown')
})
it('模拟：Claude cask 无清单也能查到版本、进入可更新并生成 brew cask argv', async () => {
  const f = fixture('claude'), path = '/模拟/homebrew/Caskroom/claude-code/2.1.287/claude'
  f.identities.set('claude', { ...nativeIdentity('claude'), ...classifyInstallation('claude', path), executable: '/模拟/homebrew/bin/claude', fingerprint: { realpath: path, size: 10, mtimeMs: 100 } })
  f.version.mockImplementation(currentVersion as any); vi.mocked(f.backend.spawn).mockImplementation(() => exited('2.1.287 (Claude Code)'))
  f.metadataFetch.mockImplementation(async url => { expect(String(url)).toBe('https://formulae.brew.sh/api/cask/claude-code.json'); return response({ version: '2.1.288' }) })
  expect((await checked(f.service)).entries.find(e => e.cli === 'claude')).toMatchObject({ source: 'brew', currentVersion: '2.1.287', group: 'updatable' })
  const plan = await f.service.planCliOperation('claude', 'update', control())
  expect(await operationArgv(plan, f.backend)).toEqual(['/模拟/homebrew/bin/brew', 'upgrade', '--cask', 'claude-code'])
})
it('模拟：Windows cmd 版本探测复用 nativeProcessBackend，不引入 cmd /c', async () => {
  const f = fixture(), entry = join(f.root, 'cli.js'), shim = join(f.root, 'cli.cmd')
  writeFileSync(entry, '#!/usr/bin/env node\n// 模拟：不执行\n')
  writeFileSync(shim, '@ECHO off\nnode "%~dp0cli.js" %*\r\n')
  vi.mocked(f.backend.spawn).mockImplementation(() => exited('codex-cli 0.162.1'))
  const backend = nativeProcessBackend(f.backend, 'win32', { electron: false })
  expect(await currentVersion('codex', { ...nativeIdentity('codex'), executable: shim }, backend, DEFAULT_CONFIG, control())).toBe('0.162.1')
  expect(vi.mocked(f.backend.spawn).mock.calls[0]![0].argv).toEqual([process.execPath, entry, '--version'])
})
