/** 模拟：All process/network results are synthetic fixtures; no installed CLI is executed. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, readFileSync, writeFileSync, rmSync, statSync, mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, type CpuInfo } from 'node:os'
import { Readable, PassThrough } from 'node:stream'
import { CLI_IDS } from '../src/shared/types.ts'
import { customRegistryProblem } from '../src/shared/cli-management.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import { CLI_SOURCES, BACKGROUND_ACCOUNT_CLIS, BACKGROUND_CATALOG_CLIS } from '../src/host/cli-management/sources.ts'
import { classifyInstallation, identifyInstallation, fingerprintToken, type InstallationIdentity } from '../src/host/cli-management/identity.ts'
import { compareVersions, compatible, currentVersion, latestCompatible, updateAvailable, ReleaseClient, captureReadOnly } from '../src/host/cli-management/versions.ts'
import { CliManagementCache, ACCOUNT_TTL, RELEASE_TTL } from '../src/host/cli-management/cache.ts'
import { CliManagementService } from '../src/host/cli-management/service.ts'
import { CliPreloader, cpuBusy } from '../src/host/cli-management/preload.ts'
import { CliExecutablePathStore } from '../src/host/cli-executable-paths.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { AccountManager } from '../src/host/accounts.ts'
const roots: string[] = [], services: CliManagementService[] = [], preloaders: CliPreloader[] = []
const temp = () => { const p = realpathSync(mkdtempSync(join(tmpdir(), 'cli-management-synthetic-'))); roots.push(p); return p }
const signal = () => new AbortController().signal
const backend = (): ProcessBackend => ({ resolveExecutable: vi.fn(async () => { throw new Error('No synthetic npm') }), spawn: vi.fn(() => { throw new Error('Unexpected spawn') }) })
const fingerprint = { realpath: '/synthetic/codex.js', size: 12, mtimeMs: 123 }
const identity: InstallationIdentity = { executable: '/synthetic/codex.js', fingerprint, source: 'npm', manifestVersion: '1.0.0' }
afterEach(async () => { for (const s of services.splice(0)) await s.close(); for (const p of preloaders.splice(0)) await p.close(); vi.useRealTimers(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('source identities', () => {
  it('describes exactly 17 active CLIs and leaves unverified installers manual', () => {
    expect(Object.keys(CLI_SOURCES)).toEqual([...CLI_IDS]); expect(CLI_IDS).toHaveLength(17)
    for (const cli of ['antigravity', 'zcode', 'hermes', 'workbuddy', 'workbuddycn'] as const) expect(CLI_SOURCES[cli].install).toBe('manual')
    expect(CLI_SOURCES.antigravity.update).toEqual(["update"])
  })
  it.each([
    ['codex', '/usr/local/lib/node_modules/@openai/codex/bin/codex.js', '@openai/codex', 'npm'],
    ['codex', '/usr/local/lib/node_modules/not-codex/bin/codex.js', 'not-codex', 'unknown'],
    ['codex', '/project/node_modules/@openai/codex/bin/codex.js', '@openai/codex', 'unknown'],
    ['codex', 'C:/project/node_modules/@openai/codex/bin/codex.js', '@openai/codex', 'unknown'],
    ['codex', 'C:/Users/a/AppData/Roaming/npm/node_modules/@openai/codex/bin/codex.js', '@openai/codex', 'npm'],
    ['codex', '/opt/homebrew/bin/codex', undefined, 'unknown'],
    ['codex', '/opt/homebrew/Caskroom/codex/1.0.0/codex', undefined, 'brew'],
    ['codex', '/opt/homebrew/Cellar/not-codex/1.0.0/bin/codex', undefined, 'unknown'],
    ['codex', '/nix/store/hash-codex/lib/node_modules/@openai/codex/bin/codex.js', '@openai/codex', 'nix'],
    ['codex', '/home/a/.bun/install/global/node_modules/@openai/codex/bin/codex.js', '@openai/codex', 'bun'],
    ['codex', '/home/a/.local/share/pnpm/global/5/node_modules/@openai/codex/bin/codex.js', '@openai/codex', 'pnpm'],
    ['grok', 'C:/Users/a/scoop/apps/grok/current/grok.exe', undefined, 'scoop'],
    ['codex', 'C:/Program Files/WindowsApps/OpenAI/codex.exe', undefined, 'winget'],
    ['zcode', '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs', undefined, 'desktop-app'],
    ['claude', '/home/a/.local/share/claude/versions/2.0.0', undefined, 'self-update'],
    ['claude', '/home/ab/.local/share/claude/versions/2.0.0', undefined, 'unknown'],
  ] as const)('classifies %s %s', (cli, path, name, source) => expect(classifyInstallation(cli, path, name, '/home/a').source).toBe(source))
  it('resolves an actual symlink and manifest without spawning; observes changed fingerprint', async () => {
    const root = temp(), pkg = join(root, 'lib/node_modules/@openai/codex'), entry = join(pkg, 'bin/codex.js'), link = join(root, 'codex')
    mkdirSync(join(pkg, 'bin'), { recursive: true }); writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@openai/codex', version: '1.2.3' })); writeFileSync(entry, '// synthetic'); symlinkSync(entry, link)
    const b = backend(), config = { ...DEFAULT_CONFIG, codexExecutable: link }
    const first = await identifyInstallation('codex', b, config, signal(), true)
    expect(first).toMatchObject({ source: 'npm', manifestVersion: '1.2.3', prefix: root })
    writeFileSync(entry, '// synthetic changed')
    const second = await identifyInstallation('codex', b, config, signal(), true)
    expect(fingerprintToken(first!.fingerprint)).not.toBe(fingerprintToken(second!.fingerprint)); expect(b.spawn).not.toHaveBeenCalled()
  })
  it('background discovery never searches when no saved absolute path exists', async () => {
    const b = backend(); expect(await identifyInstallation('codex', b, DEFAULT_CONFIG, signal(), true)).toBeUndefined()
    expect(b.resolveExecutable).not.toHaveBeenCalled(); expect(b.spawn).not.toHaveBeenCalled()
  })
})

describe('versions and bounded metadata', () => {
  it('compares SemVer including numeric prerelease identifiers and stable channels', () => {
    expect(compareVersions('1.10.0', '1.2.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0+build', '1.0.0')).toBe(0)
    expect(updateAvailable('1.0.0', '2.0.0-beta.1')).toBe(false)
    expect(updateAvailable('1.0.0-beta.1', '1.0.0')).toBe(true)
    expect(() => compareVersions('1.0', '1.0.0')).toThrow()
  })
  it('模拟：Pi updates accept latest while OpenCode remains V1', () => {
    expect(compatible('pi', '1.0.3')).toBe(true); expect(compatible('pi', '1.1.0')).toBe(true)
    expect(compatible('opencode', '2.0.0')).toBe(false)
    expect(latestCompatible('pi', ['1.0.2', '1.1.0', '2.0.0'])).toBe('2.0.0')
    expect(latestCompatible('opencode', ['1.3.0', '2.0.0', '1.4.0-beta.1'], '1.2.0')).toBe('1.3.0')
  })
  const fakeHandle = (out: string, exited = true) => ({ stdout: Readable.from([Buffer.from(out)]), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), waitForExit: vi.fn(async () => exited), terminate: vi.fn() })
  it('suppresses Kimi auto updates and waits for process cleanup', async () => {
    const b = backend(), handle = fakeHandle('kimi 1.2.3\n'); vi.mocked(b.spawn).mockReturnValue(handle as any)
    expect(await currentVersion('kimi', { ...identity, manifestVersion: undefined }, b, DEFAULT_CONFIG, signal())).toBe('1.2.3')
    expect(b.spawn).toHaveBeenCalledWith(expect.objectContaining({ argv: [identity.executable, '--version'], env: { KIMI_CODE_NO_AUTO_UPDATE: '1' } }))
    expect(handle.waitForExit).toHaveBeenCalled()
  })
  it('never runs unaudited background version commands', async () => {
    const b = backend(); expect(await currentVersion('codex', { ...identity, manifestVersion: undefined }, b, DEFAULT_CONFIG, signal(), true)).toBeUndefined(); expect(b.spawn).not.toHaveBeenCalled()
  })
  it('rejects oversized output and unconfirmed cleanup', async () => {
    const b = backend(), h = fakeHandle('x'.repeat(65537)); vi.mocked(b.spawn).mockReturnValue(h as any)
    await expect(captureReadOnly(b, DEFAULT_CONFIG, ['synthetic'], signal())).rejects.toThrow('large'); expect(h.terminate).toHaveBeenCalled()
    vi.mocked(b.spawn).mockReturnValue(fakeHandle('1.0.0', false) as any)
    await expect(captureReadOnly(b, DEFAULT_CONFIG, ['synthetic'], signal())).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
  })
  it('uses the private low-priority helper for background processes', async () => {
    const b = backend(); vi.mocked(b.spawn).mockReturnValue(fakeHandle('1.0.0') as any)
    await captureReadOnly(b, DEFAULT_CONFIG, ['synthetic', '--version'], signal(), true)
    expect(vi.mocked(b.spawn).mock.calls[0]![0].argv).toEqual([process.execPath, expect.stringContaining('private-launch.mjs'), '--cliworker-low-priority', 'synthetic', '--version'])
  })
  it('aborts then awaits range exit, rather than reporting cancellation early', async () => {
    const b = backend(), controller = new AbortController(), out = new PassThrough(); let release!: () => void
    const exited = new Promise<boolean>(resolve => { release = () => resolve(true) })
    const h = { stdout: out, stderr: undefined, done: new Promise(resolve => { controller.signal.addEventListener('abort', () => { out.end(); resolve({ exitCode: 143 }) }) }), terminate: vi.fn(), waitForExit: vi.fn(() => exited) }
    vi.mocked(b.spawn).mockReturnValue(h as any)
    let settled = false; const pending = captureReadOnly(b, DEFAULT_CONFIG, ['synthetic'], controller.signal).catch(() => {}).finally(() => { settled = true })
    controller.abort(); await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false)
    release(); await pending; expect(h.terminate).toHaveBeenCalled()
  })
})

describe('private layered cache', () => {
  it('invalidates versions by every fingerprint component', () => {
    const cache = new CliManagementCache(temp()); cache.rememberVersion('codex', fingerprint, '1.2.3')
    expect(cache.version('codex', fingerprint)?.version).toBe('1.2.3')
    for (const next of [{ ...fingerprint, realpath: '/new' }, { ...fingerprint, size: 13 }, { ...fingerprint, mtimeMs: 124 }, { ...fingerprint, appVersion: '2.0.0' }]) expect(cache.version('codex', next)).toBeUndefined()
  })
  it('uses source-specific release TTL, project-hashed account TTL and private modes', () => {
    const root = temp(), cache = new CliManagementCache(root), now = Date.now(), key = cache.releaseKey('codex', '@openai/codex', 'https://registry.npmjs.org/')
    cache.rememberRelease(key, { latest: '1.2.3', versions: ['1.2.3'], checkedAt: now, registry: 'https://registry.npmjs.org/' })
    expect(cache.release(key, now + RELEASE_TTL - 1)).toBeDefined(); expect(cache.release(key, now + RELEASE_TTL)).toBeUndefined()
    expect(cache.release(cache.releaseKey('codex', '@openai/codex', 'https://mirror.example/'))).toBeUndefined()
    cache.rememberAccount('codex', '/synthetic/project-one', { cli: 'codex', installed: true, state: 'authenticated', authMethod: 'oauth', accountLabel: 'synthetic@example.invalid', summary: 'token=TOPSECRET', actions: [], cookie: 'COOKIESECRET', token: 'TOPSECRET' } as any)
    const cached = cache.account('codex', '/synthetic/project-one')!; expect(cached.cache.stale).toBe(false)
    expect(cache.account('codex', '/synthetic/project-one', cached.cache.checkedAt + ACCOUNT_TTL)?.cache.stale).toBe(true)
    expect(cache.account('codex', '/synthetic/project-two')).toBeUndefined()
    const disk = readFileSync(cache.file, 'utf8'); expect(disk).not.toMatch(/TOPSECRET|COOKIESECRET|project-one|token|cookie|actions/)
    expect(statSync(cache.file).mode & 0o777).toBe(0o600); expect(statSync(join(root, 'cli-management')).mode & 0o777).toBe(0o700)
    expect(new CliManagementCache(root).account('codex', '/synthetic/project-one')).toMatchObject({ accountLabel: 'synthetic@example.invalid' })
  })
  it.each(['not-json', '{"policy":1,"entries":{},"token":"unexpected"}'])('discards the whole corrupt cache', raw => {
    const root = temp(), cache = new CliManagementCache(root); writeFileSync(cache.file, raw)
    expect(new CliManagementCache(root).entries()).toEqual([])
  })
  it('does not resurrect account results after login/path invalidation', () => {
    const cache = new CliManagementCache(temp()), revision = cache.accountRevision('codex'); cache.invalidateAccount('codex')
    cache.rememberAccount('codex', '/synthetic', { cli: 'codex', installed: true, state: 'authenticated', summary: '', actions: [] }, revision)
    expect(cache.account('codex', '/synthetic')).toBeUndefined()
  })
  it('validates source settings and never accepts credentials or client followRegistry', () => {
    const cache = new CliManagementCache(temp())
    expect(cache.settings()).toEqual({ source: 'follow' })
    expect(cache.saveSettings({ source: 'custom', customUrl: 'https://mirror.example/registry/' })).toMatchObject({ source: 'custom' })
    expect(() => cache.saveSettings({ source: 'custom', customUrl: 'https://user:secret@mirror.example/' })).toThrow()
    expect(() => cache.saveSettings({ source: 'follow', followRegistry: 'https://evil.invalid/' })).toThrow()
  })
  it('persists and validates the general setting without changing unrelated fields', () => {
    const store = new WorkerStorage(temp())
    expect(store.setGeneralSettings({ backgroundCliCheck: false, language: 'en' })).toMatchObject({ backgroundCliCheck: false, language: 'en' })
    expect(() => store.setGeneralSettings({ backgroundCliCheck: 'yes' })).toThrow()
    expect(store.setGeneralSettings({ backgroundCliCheck: null })).toEqual({ language: 'en' }); store.close()
  })
})

describe('release HTTP boundaries', () => {
  const document = (v = '1.2.3') => JSON.stringify({ latest: v })
  it('checks a mirror against official metadata without credentials', async () => {
    const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => new Response(document(String(url).includes('npmjs') ? '1.2.3' : '9.9.9')))
    const release = await new ReleaseClient(fetcher).query('codex', 'https://mirror.example/', signal())
    expect(release.latest).toBe('1.2.3'); expect(fetcher).toHaveBeenCalledTimes(2)
    for (const [, init] of fetcher.mock.calls) expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' })
  })
  it('falls back to selected metadata only when official is unreachable', async () => {
    const fetcher = vi.fn(async (url: string | URL) => { if (String(url).includes('npmjs')) throw new Error('synthetic offline'); return new Response(document()) })
    expect((await new ReleaseClient(fetcher).query('codex', 'https://mirror.example/', signal())).registry).toBe('https://mirror.example/')
  })
  it('rejects both declared and streamed responses above 512 KiB', async () => {
    for (const response of [() => new Response('{}', { headers: { 'content-length': String(512 * 1024 + 1) } }), () => new Response(' '.repeat(512 * 1024 + 1))]) {
      await expect(new ReleaseClient(async () => response()).json('https://registry.example/', signal())).rejects.toThrow('RELEASE_UNREACHABLE')
    }
  })
  it('enforces three global concurrent requests and eight-second request timeouts', async () => {
    vi.useFakeTimers(); let active = 0, peak = 0
    const fetcher = vi.fn((_url: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      active++; peak = Math.max(peak, active); init!.signal!.addEventListener('abort', () => { active--; reject(new Error('synthetic abort')) })
    }))
    const client = new ReleaseClient(fetcher), pending = Promise.allSettled(Array.from({ length: 6 }, () => client.json('https://registry.example/', signal())))
    expect(fetcher).toHaveBeenCalledTimes(3); await vi.advanceTimersByTimeAsync(16_001)
    const results = await pending; expect(peak).toBe(3); expect(results.every(r => r.status === 'rejected' && r.reason.code === 'RELEASE_TIMEOUT')).toBe(true)
  })
  it.each(['http://registry.example', 'https://user:pass@registry.example', 'https://registry.example/?token=x', 'https://registry.example/#secret', 'invalid'])('rejects custom URL %s', url => expect(customRegistryProblem(url)).toBeTruthy())
  it('accepts clean HTTPS registries', () => expect(customRegistryProblem('https://registry.example/path/')).toBeUndefined())
})

const cpu = (idle: number, user: number): CpuInfo[] => [{ model: 'Synthetic CPU', speed: 1, times: { idle, user, nice: 0, sys: 0, irq: 0 } }]
const samples = () => { let n = 0; return () => { n++; return cpu(n * 80, n * 20) } }
describe('one-pass idle preloader', () => {
  it('computes cross-platform CPU busy from deltas and fails closed on missing samples', () => {
    expect(cpuBusy(cpu(100, 100), cpu(180, 120))).toBeCloseTo(0.2)
    expect(cpuBusy(cpu(0, 0), cpu(20, 80))).toBeCloseTo(0.8)
    expect(cpuBusy([], [])).toBe(1)
  })
  it('waits 60 seconds even when activity changes, samples for two seconds and runs once', async () => {
    vi.useFakeTimers(); const run = vi.fn(async () => {})
    const p = new CliPreloader({ items: [{ run }, { run }], idle: () => true, enabled: () => true, sample: samples() }); preloaders.push(p); p.start()
    await vi.advanceTimersByTimeAsync(10_000); p.changed(); await vi.advanceTimersByTimeAsync(49_999); expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2001); expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4000); expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(120_000); expect(run).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['worker', 'account', 'operation', 'cpu', 'disabled'])('does not start when %s blocks idle', async blocker => {
    vi.useFakeTimers(); const run = vi.fn(async () => {}); let n = 0
    const p = new CliPreloader({ items: [{ run }], idle: () => !['worker', 'account', 'operation'].includes(blocker), enabled: () => blocker !== 'disabled', sample: () => { n++; return blocker === 'cpu' ? cpu(n * 20, n * 80) : cpu(n * 80, n * 20) } }); preloaders.push(p); p.start()
    await vi.advanceTimersByTimeAsync(150_000); expect(run).not.toHaveBeenCalled(); await p.close(); expect(vi.getTimerCount()).toBe(0)
  })
  it('aborts on busy, waits for cleanup, then resumes the same item after 30 seconds idle', async () => {
    vi.useFakeTimers(); let idle = true, cleanup!: () => void, firstSignal: AbortSignal | undefined
    const run = vi.fn((control: AbortSignal) => { firstSignal = control; return run.mock.calls.length === 1 ? new Promise<void>(resolve => { cleanup = resolve }) : Promise.resolve() })
    const p = new CliPreloader({ items: [{ run }], idle: () => idle, enabled: () => true, sample: samples() }); preloaders.push(p); p.start()
    await vi.advanceTimersByTimeAsync(62_000); expect(run).toHaveBeenCalledTimes(1)
    idle = false; p.changed(); expect(firstSignal!.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(40_000); expect(run).toHaveBeenCalledTimes(1)
    cleanup(); await Promise.resolve(); idle = true; p.changed()
    await vi.advanceTimersByTimeAsync(29_999); expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4001); expect(run).toHaveBeenCalledTimes(2)
  })
  it('page handoff shares the in-flight read and does not start the next item', async () => {
    vi.useFakeTimers(); let finish!: () => void
    const first = vi.fn(() => new Promise<void>(resolve => { finish = resolve })), second = vi.fn(async () => {})
    const p = new CliPreloader({ items: [{ run: first }, { run: second }], idle: () => true, enabled: () => true, sample: samples() }); preloaders.push(p); p.start(); await vi.advanceTimersByTimeAsync(62_000)
    let complete = false; const handoff = p.handoff().then(() => { complete = true }); await Promise.resolve(); expect(complete).toBe(false)
    finish(); await handoff; expect(second).not.toHaveBeenCalled(); expect(first).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
  })
  it('close aborts and does not finish before child cleanup; no timers survive', async () => {
    vi.useFakeTimers(); let finish!: () => void, itemSignal: AbortSignal | undefined
    const p = new CliPreloader({ items: [{ run: control => { itemSignal = control; return new Promise<void>(resolve => { finish = resolve }) } }], idle: () => true, enabled: () => true, sample: samples() }); preloaders.push(p); p.start(); await vi.advanceTimersByTimeAsync(62_000)
    let done = false; const closing = p.close().then(() => { done = true }); await Promise.resolve(); expect(itemSignal!.aborted).toBe(true); expect(done).toBe(false)
    finish(); await closing; expect(vi.getTimerCount()).toBe(0)
  })
})

function serviceFixture(options: { version?: string; identify?: any; releases?: ReleaseClient } = {}) {
  const root = temp(), b = backend(); new CliManagementCache(root).saveSettings({ source: 'official' })
  const identify = options.identify ?? vi.fn(async (cli: string) => cli === 'codex' ? identity : undefined)
  const version = vi.fn(async () => options.version ?? '1.0.0')
  const releases = options.releases ?? new ReleaseClient(async () => new Response(JSON.stringify({ latest: '1.2.3' })))
  const query = vi.spyOn(releases, 'query')
  const service = new CliManagementService({ npmRuntimeHost: async () => ({ platform: process.platform, arch: process.arch, libc: process.platform === 'linux' ? 'glibc' : undefined }), npmCheck: vi.fn(async () => {}), root, backend: b, config: DEFAULT_CONFIG, idle: () => true, enabled: () => true, cliEnabled: () => true, account: vi.fn(), identify, version, releases }); services.push(service)
  return { root, b, service, identify, version, query }
}
async function checked(service: CliManagementService, scope: 'all' | 'missing' = 'missing') {
  service.check(scope)
  for await (const value of service.watch(signal())) if (value.activity === 'idle') return value
  throw new Error('Closed before result')
}
describe('Host page service and lifecycle', () => {
  it('snapshot is read-only and all 17 rows exist before probes', async () => {
    const f = serviceFixture(); const initial = f.service.snapshot(); expect(initial.entries).toHaveLength(17); expect(initial.activity).toBe('idle')
    expect(f.identify).not.toHaveBeenCalled(); expect(f.b.spawn).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled()
    initial.entries[0]!.group = 'failed'; expect(f.service.snapshot().entries[0]!.group).toBe('checking')
    await f.service.close()
  })
  it('returns immediately, publishes revisions, caches versions and only force-refreshes releases', async () => {
    const f = serviceFixture(), initial = f.service.check('missing'); expect(initial.activity).toBe('checking')
    const first = await checked(f.service); const row = first.entries.find(e => e.cli === 'codex')!
    expect(row).toMatchObject({ group: 'updatable', currentVersion: '1.0.0', latestVersion: '1.2.3', latestCompatibleVersion: '1.2.3' }); expect(row.planToken).toMatch(/^[a-f0-9]{64}$/)
    expect(first.revision).toBeGreaterThan(initial.revision)
    await checked(f.service); expect(f.version).toHaveBeenCalledTimes(1); expect(f.query).toHaveBeenCalledTimes(1)
    await checked(f.service, 'all'); expect(f.version).toHaveBeenCalledTimes(1); expect(f.query).toHaveBeenCalledTimes(2)
    f.identify.mockImplementation(async (cli: string) => cli === 'codex' ? { ...identity, fingerprint: { ...fingerprint, size: 15 } } : undefined)
    await checked(f.service); expect(f.version).toHaveBeenCalledTimes(2)
  })
  it('retains an old group during reread and serializes concurrent page checks', async () => {
    const f = serviceFixture(); await checked(f.service)
    let finish!: (value: any) => void; f.query.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    f.service.check('all')
    for await (const s of f.service.watch(signal())) { if (s.entries.find(e => e.cli === 'codex')?.stage === 'remote') break }
    expect(f.service.snapshot().entries.find(e => e.cli === 'codex')?.group).toBe('updatable')
    f.service.check('all'); expect(f.query).toHaveBeenCalledTimes(2)
    finish({ latest: '1.2.3', versions: ['1.2.3'], checkedAt: Date.now(), registry: 'https://registry.npmjs.org/' })
    for await (const s of f.service.watch(signal())) if (s.activity === 'idle') break
  })
  it('bounds the full check to 30 seconds and marks unfinished rows timed out', async () => {
    vi.useFakeTimers()
    const releases = new ReleaseClient(); vi.spyOn(releases, 'query').mockImplementation((_cli, _registry, control) => new Promise((_resolve, reject) => { control.addEventListener('abort', () => reject(new Error('synthetic timeout'))) }))
    const f = serviceFixture({ releases }); f.service.check('all'); await vi.advanceTimersByTimeAsync(30_001)
    expect(f.service.snapshot().entries.find(e => e.cli === 'codex')).toMatchObject({ group: 'failed', reason: 'RELEASE_TIMEOUT' })
    expect(f.service.snapshot().activity).toBe('idle')
  })
  it('reports incompatible targets and unknown versions without claiming updates', async () => {
    const f = serviceFixture({ identify: vi.fn(async (cli: string) => cli === 'pi' ? identity : undefined), releases: new ReleaseClient(async url => new Response(JSON.stringify(String(url).endsWith('/dist-tags') ? { latest: '9.0.0' } : { versions: { '1.0.2': {}, '1.1.0': {}, '9.0.0': {} } }))) })
    const result = await checked(f.service); expect(result.entries.find(e => e.cli === 'pi')).toMatchObject({ group: 'updatable', notice: '插件尚未适配 Pi 9.0.0，更新后 Pi Worker 要等插件适配后才能使用', latestCompatibleVersion: '9.0.0' })
  })
  it('watch abort unsubscribes without launching a probe', async () => {
    const f = serviceFixture(), controller = new AbortController(), stream = f.service.watch(controller.signal)
    expect((await stream.next()).value?.revision).toBe(0); const next = stream.next(); controller.abort(); expect((await next).done).toBe(true)
    expect(f.identify).not.toHaveBeenCalled()
  })
})

it('source changes invalidate even an equal registry URL and cancelled queued fetches never start', async () => {
  const cache = new CliManagementCache(temp()), key = cache.releaseKey('codex', '@openai/codex', 'https://registry.npmjs.org/')
  cache.rememberRelease(key, { latest: '1.0.0', versions: ['1.0.0'], checkedAt: Date.now(), registry: 'https://registry.npmjs.org/' })
  cache.saveSettings({ source: 'official' }); expect(cache.release(key)).toBeUndefined()
  const controls = Array.from({ length: 4 }, () => new AbortController())
  const fetcher = vi.fn((_url: string | URL, options?: RequestInit) => new Promise<Response>((_resolve, reject) => { options!.signal!.addEventListener('abort', () => reject(new Error('synthetic abort'))) }))
  const client = new ReleaseClient(fetcher), requests = controls.map(c => client.json('https://registry.example/', c.signal).catch(() => {}))
  controls[3]!.abort(); for (const c of controls.slice(0, 3)) c.abort(); await Promise.all(requests); expect(fetcher).toHaveBeenCalledTimes(3)
})
it('hard-bounds even a fetch transport that never acknowledges abort', async () => {
  vi.useFakeTimers()
  const client = new ReleaseClient(() => new Promise(() => {}))
  const pending = client.json('https://registry.example/', signal()).catch(error => error)
  await vi.advanceTimersByTimeAsync(8001); expect((await pending).code).toBe('RELEASE_TIMEOUT')
})
it('foreground shutdown awaits every concurrent local cleanup', async () => {
  let release!: () => void
  const identify = vi.fn(async (cli: string, _backend: unknown, _config: unknown, control: AbortSignal) => {
    if (cli === 'antigravity') return new Promise<undefined>((resolve) => { release = () => resolve(undefined) })
    control.throwIfAborted(); return undefined
  })
  const f = serviceFixture({ identify }); f.service.check('missing')
  for (let i = 0; i < 8 && !release; i++) await Promise.resolve()
  expect(release).toBeDefined()
  let done = false; const closing = f.service.close().then(() => { done = true }); await Promise.resolve(); await Promise.resolve(); expect(done).toBe(false)
  release(); await closing; expect(done).toBe(true)
})
it('handoff during CPU sampling starts no additional background item', async () => {
  vi.useFakeTimers(); const run = vi.fn(async () => {})
  const p = new CliPreloader({ items: [{ run }], idle: () => true, enabled: () => true, sample: samples() }); preloaders.push(p); p.start()
  await vi.advanceTimersByTimeAsync(60_001); await p.handoff(); expect(run).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
})
it('follows local npm registry using an argv-only read, never config set', async () => {
  const f = serviceFixture(); f.service.saveDownloadSource({ source: 'follow' })
  vi.mocked(f.b.resolveExecutable).mockResolvedValue('/synthetic/npm')
  vi.mocked(f.b.spawn).mockReturnValue({ stdout: Readable.from(['https://mirror.example/registry/\n']), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), terminate: vi.fn(), waitForExit: vi.fn(async () => true) } as any)
  expect(await f.service.downloadSource(signal())).toEqual({ source: 'follow', followRegistry: 'https://mirror.example/registry/' })
  expect(f.b.spawn).toHaveBeenCalledWith(expect.objectContaining({ argv: ['/synthetic/npm', 'config', 'get', 'registry'] }))
})
it('reads Homebrew cask metadata and rejects invalid versions', async () => {
  const fetcher = vi.fn(async () => new Response('{"version":"1.2.3"}')), client = new ReleaseClient(fetcher)
  expect((await client.query('codex', 'https://mirror.example/', signal(), 'brew')).latest).toBe('1.2.3')
  expect(fetcher.mock.calls[0]![0]).toBe('https://formulae.brew.sh/api/cask/codex.json')
  fetcher.mockImplementation(async () => new Response('{"version":"not-a-version"}'))
  await expect(client.query('codex', 'https://mirror.example/', signal(), 'brew')).rejects.toThrow('RELEASE_UNREACHABLE')
})
it('includes application bundle version changes in the executable fingerprint', async () => {
  const root = temp(), contents = join(root, 'Synthetic.app/Contents'), entry = join(contents, 'Resources/zcode.cjs'), plist = join(contents, 'Info.plist')
  mkdirSync(join(contents, 'Resources'), { recursive: true }); writeFileSync(entry, '// synthetic app entry')
  writeFileSync(plist, '<plist><dict><key>CFBundleShortVersionString</key><string>1.0.0</string></dict></plist>')
  const config = { ...DEFAULT_CONFIG, zcodeExecutable: entry }, b = backend()
  const first = await identifyInstallation('zcode', b, config, signal(), true)
  writeFileSync(plist, '<plist><dict><key>CFBundleShortVersionString</key><string>1.1.0</string></dict></plist>')
  const second = await identifyInstallation('zcode', b, config, signal(), true)
  expect(first?.fingerprint.appVersion).toBe('1.0.0'); expect(second?.fingerprint.appVersion).toBe('1.1.0'); expect(fingerprintToken(first!.fingerprint)).not.toBe(fingerprintToken(second!.fingerprint))
})

it('background account status rejects unaudited branches and never discovers missing paths', async () => {
  const root = temp(), b = backend(), accounts = new AccountManager(b, { ...DEFAULT_CONFIG, stateDirectory: root }, async () => undefined)
  try {
    for (const cli of CLI_IDS.filter(cli => !BACKGROUND_ACCOUNT_CLIS.includes(cli)))
      await expect(accounts.status(cli, root, signal(), { background: true })).rejects.toThrow('保留前台')
    expect((await accounts.status('codebuddy', root, signal(), { background: true })).installed).toBe(false)
    expect(b.resolveExecutable).not.toHaveBeenCalled(); expect(b.spawn).not.toHaveBeenCalled()
  } finally { await accounts.close() }
})
it('foreground handoff finishes and reuses the safe account portion of the background queue', async () => {
  const f = serviceFixture({ identify: vi.fn(async (cli: string) => cli === 'mimo' ? identity : undefined) })
  const account = vi.fn(async () => ({ cli: 'mimo', installed: true, state: 'authenticated', authMethod: 'api', summary: 'Synthetic account', actions: [] }))
  ;(f.service as any).deps.account = account
  f.service.context(f.root)
  await checked(f.service); expect(account).toHaveBeenCalledTimes(1)
  expect(f.service.cache.account('mimo', f.root)?.cache.stale).toBe(false)
  await checked(f.service); expect(account).toHaveBeenCalledTimes(1)
})
it('bounds npm path lookup as well as the registry subprocess', async () => {
  vi.useFakeTimers(); const f = serviceFixture(); f.service.saveDownloadSource({ source: 'follow' })
  vi.mocked(f.b.resolveExecutable).mockImplementation(() => new Promise(() => {}))
  const pending = f.service.downloadSource(signal()); await vi.advanceTimersByTimeAsync(5001)
  expect(await pending).toEqual({ source: 'follow' }); expect(f.b.spawn).not.toHaveBeenCalled()
})
it('idle notifications cannot shorten the two-second CPU sampling window', async () => {
  vi.useFakeTimers(); const run = vi.fn(async () => {})
  const p = new CliPreloader({ items: [{ run }], idle: () => true, enabled: () => true, sample: samples() }); preloaders.push(p); p.start()
  await vi.advanceTimersByTimeAsync(60_500); p.changed(); await vi.advanceTimersByTimeAsync(1499); expect(run).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(501); expect(run).toHaveBeenCalledTimes(1)
})

it('模拟：后台连接工作按项目分开，只交给安全账号与目录回调，跳过关闭的 CLI', async () => {
  const f = serviceFixture({ identify: vi.fn(async () => identity) })
  const load = vi.fn(async () => {})
  ;(f.service as any).deps.preloadConnection = load
  ;(f.service as any).deps.cliEnabled = (cli: string) => cli !== 'mimo'
  f.service.context('/simulated-project-a'); f.service.context('/simulated-project-b')
  await checked(f.service)
  for (const project of ['/simulated-project-a', '/simulated-project-b']) {
    expect(load.mock.calls.filter((call: unknown[]) => call[1] === project).map((call: unknown[]) => [call[0], call[2]])).toEqual([
      ...BACKGROUND_ACCOUNT_CLIS.filter(cli => cli !== 'mimo').map(cli => [cli, 'account']),
      ...BACKGROUND_CATALOG_CLIS.filter(cli => cli !== 'mimo').map(cli => [cli, 'catalog']),
    ])
  }
})
