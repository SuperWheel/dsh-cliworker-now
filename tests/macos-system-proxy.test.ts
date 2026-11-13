import { EventEmitter } from 'node:events'
import { request } from 'node:https'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { MacOSSystemProxySource, parseScutilProxy } from '../src/host/macos-system-proxy.ts'
import { decidesProxy, hostProxyLookup, proxyEnvironment } from '../src/host/system-proxy.ts'
import { nativeProcessBackend } from '../src/host/native-process.ts'
import type { ProcessBackend } from '../src/host/process.ts'
import { environmentProxy, hostFetch, setHostProxy } from '../src/host/host-fetch.mjs'

// 模拟：所有 scutil、CLI、终端和 HTTP 夹具均为内存数据，不启动真实 CLI 或连接代理。
vi.mock('node:https', () => ({ Agent: class {}, request: vi.fn() }))

const settings = (lines: string[], exceptions?: string[]) => [
  '<dictionary> {', ...lines.map((line) => `  ${line}`),
  ...(exceptions ? ['  ExceptionsList : <array> {', ...exceptions.map((value, i) => `    ${i} : ${value}`), '  }'] : []),
  '}',
].join('\n')
const HTTPS = ['HTTPSEnable : 1', 'HTTPSProxy : 127.0.0.1', 'HTTPSPort : 7897']
const HTTP = ['HTTPEnable : 1', 'HTTPProxy : proxy.example', 'HTTPPort : 8080']
const ON = settings(HTTPS, ['*.local', '*.corp.example', '169.254/16'])

function handle(output = ON, exitCode = 0) {
  return {
    stdout: Readable.from([Buffer.from(output)]), stderr: Readable.from([]),
    done: Promise.resolve({ exitCode }), terminate: vi.fn(), waitForExit: vi.fn(async () => true),
  } as unknown as SubprocessHandle
}

function clearProxy() {
  for (const key of Object.keys(process.env))
    if (['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'].includes(key.toUpperCase())) vi.stubEnv(key, '')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
  setHostProxy(undefined)
})

describe('模拟：scutil 根字典解析', () => {
  it('prefers HTTPS over HTTP, using a single HTTP proxy URL', () => {
    expect(parseScutilProxy(settings([...HTTP, ...HTTPS]))).toEqual({ url: 'http://127.0.0.1:7897', bypass: [] })
  })

  it('uses HTTP alone, including a disabled HTTPS setting', () => {
    expect(parseScutilProxy(settings([...HTTP, ...HTTPS.map((v) => v.replace('HTTPSEnable : 1', 'HTTPSEnable : 0'))]))?.url)
      .toBe('http://proxy.example:8080')
  })

  it('falls back to valid HTTP when the preferred address is invalid', () => {
    expect(parseScutilProxy(settings([...HTTP, ...HTTPS.map((v) => v.replace('7897', '65536'))]))?.url)
      .toBe('http://proxy.example:8080')
  })

  it.each(['0', '2', '-1'])('does not use disabled/invalid switch %s', (enabled) => {
    expect(parseScutilProxy(settings(HTTPS.map((v) => v.replace('HTTPSEnable : 1', `HTTPSEnable : ${enabled}`))))).toBeUndefined()
  })

  it.each(['0', '-1', '65536', '1.5', '7897abc', '', '999999', '80 81'])('rejects port %s', (port) => {
    expect(parseScutilProxy(settings(['HTTPSEnable : 1', 'HTTPSProxy : proxy.example', `HTTPSPort : ${port}`]))).toBeUndefined()
  })

  it.each(['http://proxy.example', 'user@proxy.example', 'proxy.example:80', 'a;b', 'a b', '-bad.example', 'bad_.example', '999.1.2.3', '::1', '[not-ip]', '[:::1]', '[fe80::1%lo0]'])('rejects proxy host %s', (host) => {
    expect(parseScutilProxy(settings(['HTTPSEnable : 1', `HTTPSProxy : ${host}`, 'HTTPSPort : 80']))).toBeUndefined()
  })

  it.each(['1', '65535'])('accepts port boundary %s and a hostname', (port) => {
    expect(parseScutilProxy(settings(['HTTPSEnable : 1', 'HTTPSProxy : Proxy.Example', `HTTPSPort : ${port}`]))?.url)
      .toBe(`http://proxy.example:${port}`)
  })

  it('accepts bracketed IPv6', () => {
    expect(parseScutilProxy(settings(['HTTPSEnable : 1', 'HTTPSProxy : [2001:db8::1]', 'HTTPSPort : 8080']))?.url)
      .toBe('http://[2001:db8::1]:8080')
  })

  it('normalizes only expressible exceptions and deduplicates them', () => {
    const parsed = parseScutilProxy(settings(HTTPS, [
      'intranet', 'EXAMPLE.com', '*.example.com', '*.local', '192.168.1.2', '2001:db8::1', '[::1]',
      '169.254/16', '10.0.0.0/8', '10.*', 'a*b.example', '<local>', '*', 'host:80', 'bad_.example',
      'example.com',
    ]))!
    expect(parsed.bypass).toEqual(['intranet', 'example.com', '.example.com', '.local', '192.168.1.2', '2001:db8::1', '::1'])
    expect(proxyEnvironment(parsed).NO_PROXY.split(',')).toEqual([
      'localhost', '127.0.0.1', '::1', 'intranet', 'example.com', '.example.com', '.local', '192.168.1.2', '2001:db8::1',
    ])
  })

  it.each(['ProxyAutoConfigEnable', 'ProxyAutoDiscoveryEnable', 'SOCKSEnable'])('does not guess %s or emit raw output', (key) => {
    const diagnostic = vi.fn()
    expect(parseScutilProxy(settings([`${key} : 1`, 'ProxyAutoConfigURLString : https://pac.example/private']), diagnostic)).toBeUndefined()
    expect(diagnostic).toHaveBeenCalledTimes(1)
    expect(diagnostic.mock.calls[0]![0]).not.toContain('pac.example')
  })

  it('ignores PAC and SOCKS if an explicit HTTP proxy exists', () => {
    const diagnostic = vi.fn()
    expect(parseScutilProxy(settings([...HTTP, 'ProxyAutoConfigEnable : 1', 'SOCKSEnable : 1']), diagnostic)?.url).toBe('http://proxy.example:8080')
    expect(diagnostic).not.toHaveBeenCalled()
  })

  it('does not use per-interface scoped settings or nested exceptions', () => {
    expect(parseScutilProxy(settings(['__SCOPED__ : <dictionary> {', 'en0 : <dictionary> {', ...HTTPS, '}', '}']))).toBeUndefined()
  })

  it.each(['', '<dictionary> {\n', '<dictionary> {\n}\n}', '<dictionary> {\n}\nHTTPEnable : 1'])('fails closed on incomplete/malformed output %j', (output) => {
    expect(parseScutilProxy(output)).toBeUndefined()
  })
})

describe('模拟：macOS 来源刷新、边界和清理', () => {
  it('uses array argv, a 15-second cache and one concurrent refresh; disabling clears the proxy', async () => {
    let now = 0
    let output = ON
    const spawn = vi.fn((_spec: SubprocessSpawnSpec) => handle(output))
    const source = new MacOSSystemProxySource(spawn, undefined, () => now)
    expect(source.current()).toBeUndefined()
    await Promise.all([source.refresh(), source.fresh(), source.refresh()])
    expect(spawn).toHaveBeenCalledTimes(1)
    const spec = spawn.mock.calls[0]![0]
    expect(spec.argv).toEqual(['/usr/sbin/scutil', '--proxy'])
    expect(spec.cwd).toBe('/')
    expect(spec.stdio).toEqual({ stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    expect(spec.graceMs).toBe(500)
    output = settings([])
    now = 14_999
    expect(await source.fresh()).toBeDefined()
    now = 15_000
    expect(await source.fresh()).toBeUndefined()
    expect(spawn).toHaveBeenCalledTimes(2)
    await source.close()
  })

  it('limits the read to 5 seconds, aborts it, and waits for cleanup', async () => {
    vi.useFakeTimers()
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      expect(ms).toBe(5_000)
      const timer = new AbortController()
      setTimeout(() => timer.abort(), ms)
      return timer.signal
    })
    let child!: SubprocessHandle
    const source = new MacOSSystemProxySource((spec) => {
      const stdout = new Readable({ read() {} })
      const done = new Promise<{ exitCode: number }>((resolve) => {
        spec.signal!.addEventListener('abort', () => { stdout.push(null); resolve({ exitCode: 1 }) }, { once: true })
      })
      child = { ...handle(''), stdout, done } as unknown as SubprocessHandle
      return child
    })
    const reading = source.fresh()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(child.terminate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await reading).toBeUndefined()
    expect(child.terminate).toHaveBeenCalledTimes(1)
    expect(child.waitForExit).toHaveBeenCalledTimes(1)
    await source.close()
  })

  it('aborts an in-flight read on close and never starts another', async () => {
    let child!: SubprocessHandle
    let signal!: AbortSignal
    const spawn = vi.fn((spec: SubprocessSpawnSpec) => {
      signal = spec.signal!
      const stdout = new Readable({ read() {} })
      const done = new Promise<{ exitCode: number }>((resolve) => {
        signal.addEventListener('abort', () => { stdout.push(null); resolve({ exitCode: 1 }) }, { once: true })
      })
      child = { ...handle(''), stdout, done } as unknown as SubprocessHandle
      return child
    })
    const source = new MacOSSystemProxySource(spawn)
    const reading = source.fresh()
    await Promise.resolve()
    await source.close()
    expect(signal.aborted).toBe(true)
    expect(await reading).toBeUndefined()
    expect(child.terminate).toHaveBeenCalledTimes(1)
    expect(child.waitForExit).toHaveBeenCalledTimes(1)
    await source.refresh()
    expect(source.current()).toBeUndefined()
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it.each(['exit', 'oversize', 'stream', 'spawn'])('clears an old value on %s failure and cleans any child', async (failure) => {
    let fail = false
    let child!: SubprocessHandle
    const source = new MacOSSystemProxySource(() => {
      if (fail && failure === 'spawn') throw new Error('模拟启动失败')
      child = handle(fail && failure === 'oversize' ? 'x'.repeat(65_537) : ON, fail && failure === 'exit' ? 1 : 0)
      if (fail && failure === 'stream') child = { ...child, stdout: Readable.from((async function* () { throw new Error('模拟流失败') })()) } as SubprocessHandle
      return child
    })
    expect(await source.fresh()).toBeDefined()
    fail = true
    await source.refresh()
    expect(source.current()).toBeUndefined()
    expect(child.terminate).toHaveBeenCalledTimes(1)
    expect(child.waitForExit).toHaveBeenCalledTimes(1)
    await source.close()
  })

  it('emits one fixed diagnostic for repeated unsupported settings', async () => {
    const diagnostic = vi.fn()
    const source = new MacOSSystemProxySource(() => handle(settings(['ProxyAutoDiscoveryEnable : 1'])), 15_000, Date.now, diagnostic)
    await source.refresh()
    await source.refresh()
    expect(diagnostic).toHaveBeenCalledTimes(1)
    await source.close()
    await source.refresh()
    expect(source.current()).toBeUndefined()
  })
})

describe('模拟：共享后端与 Host 查找', () => {
  function capture() {
    const specs: { env?: NodeJS.ProcessEnv }[] = []
    const backend: ProcessBackend = {
      resolveExecutable: async (name) => name,
      spawn: (spec) => { specs.push(spec); return handle('') },
      spawnTerminal: async (spec) => { specs.push(spec); return {} as never },
    }
    return { backend, specs }
  }
  const spec = (env: NodeJS.ProcessEnv = {}) => ({ argv: ['/bin/mock-cli'], cwd: '/', env, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' } } as const)

  it('injects into darwin workers/commands/probes and fresh account terminals, retaining loopback', async () => {
    clearProxy()
    const { backend, specs } = capture()
    const source = new MacOSSystemProxySource(() => handle())
    await source.refresh()
    const native = nativeProcessBackend(backend, 'darwin', { systemProxy: source })
    native.spawn(spec({ no_proxy: 'intranet' }))
    await native.spawnTerminal!({ argv: ['/bin/mock-cli', 'login'], cwd: '/' })
    expect(specs[0]!.env).toEqual({ HTTP_PROXY: 'http://127.0.0.1:7897', HTTPS_PROXY: 'http://127.0.0.1:7897', NO_PROXY: 'intranet,localhost,127.0.0.1,::1,.local,.corp.example' })
    expect(specs[1]!.env?.HTTPS_PROXY).toBe('http://127.0.0.1:7897')
    expect(environmentProxy('https://x.example', specs[1]!.env, 'darwin')).toBe('http://127.0.0.1:7897')
    for (const target of ['https://localhost/', 'https://127.0.0.1/', 'https://[::1]/', 'https://api.corp.example/', 'https://printer.local/'])
      expect(environmentProxy(target, specs[0]!.env, 'darwin')).toBeUndefined()
    await source.close()
  })

  it.each(['HTTP_PROXY', 'https_proxy', 'ALL_PROXY'])('preserves inherited %s and explicit deletion', async (key) => {
    clearProxy()
    const { backend, specs } = capture()
    const source = new MacOSSystemProxySource(() => handle())
    await source.refresh()
    const native = nativeProcessBackend(backend, 'darwin', { systemProxy: source })
    const own = { [key]: 'http://own.example:8080' }
    const removed = { [key]: undefined }
    native.spawn(spec(own))
    native.spawn(spec(removed))
    await native.spawnTerminal!({ argv: ['/bin/mock-cli'], cwd: '/', env: removed })
    vi.stubEnv(key, 'http://inherited.example:8080')
    native.spawn(spec())
    expect(specs.map((v) => v.env)).toEqual([own, removed, removed, {}])
    expect(decidesProxy(removed)).toBe(true)
    await source.close()
  })

  it('does not consult or inject a supplied source on linux', async () => {
    clearProxy()
    const { backend, specs } = capture()
    const source = new MacOSSystemProxySource(() => handle())
    const current = vi.spyOn(source, 'current')
    const fresh = vi.spyOn(source, 'fresh')
    const native = nativeProcessBackend(backend, 'linux', { systemProxy: source })
    native.spawn(spec())
    await native.spawnTerminal!({ argv: ['/bin/mock-cli'], cwd: '/' })
    expect(current).not.toHaveBeenCalled()
    expect(fresh).not.toHaveBeenCalled()
    expect(specs.map((v) => v.env)).toEqual([{}, undefined])
    await source.close()
  })

  it('uses fresh system proxy and bypasses for Host requests, yielding to inherited settings', async () => {
    clearProxy()
    const source = new MacOSSystemProxySource(() => handle())
    const lookup = hostProxyLookup(source)
    expect(await lookup('https://example.com/')).toBe('http://127.0.0.1:7897')
    for (const target of ['https://localhost/', 'https://127.0.0.1/', 'https://[::1]/', 'https://api.corp.example/'])
      expect(await lookup(target)).toBeUndefined()
    vi.stubEnv('https_proxy', 'http://explicit.example:8888')
    expect(await lookup('https://example.com/')).toBe(['darwin', 'win32'].includes(process.platform) ? 'http://explicit.example:8888' : undefined)
    await source.close()
  })

  it('keeps the fetch User-Agent on proxied requests and preserves an explicit one', async () => {
    vi.mocked(request).mockImplementation(((_target: unknown, _options: unknown, callback: (incoming: unknown) => void) => {
      const outgoing = new EventEmitter() as EventEmitter & { end(): void }
      outgoing.end = () => callback(Object.assign(Readable.from([]), { statusCode: 200, headers: {} }))
      return outgoing
    }) as typeof request)
    setHostProxy(async () => 'http://127.0.0.1:7897')
    await hostFetch('https://example.invalid/models')
    await hostFetch('https://example.invalid/models', { headers: { 'User-Agent': 'explicit-agent' } })
    expect(vi.mocked(request).mock.calls[0]![1]).toMatchObject({ headers: { 'user-agent': 'node' } })
    expect(vi.mocked(request).mock.calls[1]![1]).toMatchObject({ headers: { 'user-agent': 'explicit-agent' } })
  })
})
