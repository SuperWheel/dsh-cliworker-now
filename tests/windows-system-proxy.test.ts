import { createServer, type AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { nativeProcessBackend } from '../src/host/native-process.ts'
import type { ProcessBackend } from '../src/host/process.ts'
import { bypassesProxy, environmentProxy, hostFetch, setHostProxy } from '../src/host/host-fetch.mjs'
import {
  decidesProxy,
  hostProxyLookup,
  parseInternetSettings,
  proxyEnvironment,
  WindowsSystemProxySource,
} from '../src/host/windows-system-proxy.ts'

// 模拟：Windows 10/11 `reg query` 输出格式；地址为虚构的本机代理端口。
const settings = (lines: string[]) =>
  ['', 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', ...lines.map((line) => `    ${line}`), ''].join('\r\n')
const ON = settings([
  'ProxyEnable    REG_DWORD    0x1',
  'ProxyServer    REG_SZ    127.0.0.1:7897',
  'ProxyOverride    REG_SZ    localhost;127.*;10.*;*.corp.example;intranet;<local>',
])

function handle(stdout: string, exitCode = 0): SubprocessHandle {
  return {
    stdout: Readable.from([Buffer.from(stdout, 'latin1')]),
    stderr: Readable.from([]),
    done: Promise.resolve({ exitCode }),
    terminate: () => undefined,
    waitForExit: async () => true,
  } as unknown as SubprocessHandle
}

afterEach(() => {
  vi.unstubAllEnvs()
})

/** The developer Mac exports HTTPS_PROXY through launchd; clear every spelling for these cases. */
function clearInheritedProxy() {
  for (const key of Object.keys(process.env))
    if (['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'].includes(key.toUpperCase())) vi.stubEnv(key, '')
}

describe('Windows system proxy', () => {
  it('reads one proxy for every protocol and keeps only NO_PROXY-expressible bypass entries', () => {
    expect(parseInternetSettings(ON)).toEqual({
      url: 'http://127.0.0.1:7897',
      bypass: ['localhost', '.corp.example', 'intranet'],
    })
  })

  it('prefers the https entry of a per-protocol list and ignores a SOCKS-only list', () => {
    expect(
      parseInternetSettings(settings(['ProxyEnable    REG_DWORD    0x1', 'ProxyServer    REG_SZ    http=127.0.0.1:8080;https=127.0.0.1:8443;socks=127.0.0.1:1080']))?.url,
    ).toBe('http://127.0.0.1:8443')
    expect(parseInternetSettings(settings(['ProxyEnable    REG_DWORD    0x1', 'ProxyServer    REG_SZ    socks=127.0.0.1:1080']))).toBeUndefined()
  })

  it('treats a switched-off, missing or malformed proxy as none', () => {
    expect(parseInternetSettings(ON.replace('0x1', '0x0'))).toBeUndefined()
    expect(parseInternetSettings(settings(['ProxyEnable    REG_DWORD    0x1']))).toBeUndefined()
    expect(parseInternetSettings(ON.replace('127.0.0.1:7897', 'user:pass@127.0.0.1:7897'))).toBeUndefined()
    expect(parseInternetSettings(ON.replace(':7897', ':70000'))).toBeUndefined()
  })

  it('leaves an environment that already decides proxying, including an explicit removal', () => {
    expect(decidesProxy({ https_proxy: 'http://127.0.0.1:1' })).toBe(true)
    expect(decidesProxy({ HTTP_PROXY: undefined })).toBe(true)
    expect(decidesProxy({ HTTPS_PROXY: '  ' }, { PATH: 'x' })).toBe(false)
  })

  it('keeps loopback direct and merges an inherited NO_PROXY', () => {
    expect(proxyEnvironment({ url: 'http://127.0.0.1:7897', bypass: ['.corp.example'] }, { no_proxy: '.local,localhost' })).toEqual({
      HTTP_PROXY: 'http://127.0.0.1:7897',
      HTTPS_PROXY: 'http://127.0.0.1:7897',
      NO_PROXY: '.local,localhost,127.0.0.1,::1,.corp.example',
    })
  })

  it('rereads after the TTL, so turning the switch off reaches later CLIs', async () => {
    let output = ON
    let now = 0
    const spawned: SubprocessSpawnSpec[] = []
    const source = new WindowsSystemProxySource(
      (spec) => {
        spawned.push(spec)
        return handle(output)
      },
      1000,
      () => now,
    )
    expect(source.current()).toBeUndefined()
    await source.refresh()
    expect(source.current()?.url).toBe('http://127.0.0.1:7897')
    expect(spawned[0]!.argv.slice(1)).toEqual(['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'])
    output = ON.replace('0x1', '0x0')
    now = 999
    expect(await source.fresh()).toBeDefined()
    now = 1000
    expect(await source.fresh()).toBeUndefined()
    expect(spawned).toHaveLength(2)
  })

  it('drops the last proxy when the setting cannot be read', async () => {
    let fail = false
    let now = 0
    const source = new WindowsSystemProxySource(() => (fail ? handle('', 1) : handle(ON)), 10, () => now)
    expect(await source.fresh()).toBeDefined()
    fail = true
    now = 10
    expect(await source.fresh()).toBeUndefined()
  })
})

describe('native backend proxy injection', () => {
  const capture = () => {
    const specs: { env?: NodeJS.ProcessEnv }[] = []
    const backend: ProcessBackend = {
      resolveExecutable: async (name) => name,
      spawn: (spec) => {
        specs.push(spec)
        return handle('')
      },
      spawnTerminal: async (spec) => {
        specs.push(spec)
        return {} as never
      },
    }
    return { specs, backend }
  }
  const proxySource = async () => {
    const source = new WindowsSystemProxySource(() => handle(ON), 60_000)
    await source.refresh()
    return source
  }

  it('hands workers and account terminals the system proxy when nothing decides it', async () => {
    clearInheritedProxy()
    const { specs, backend } = capture()
    const native = nativeProcessBackend(backend, 'darwin', { systemProxy: await proxySource() })
    native.spawn({ argv: ['/bin/cli'], cwd: '/', env: { no_proxy: '.local' }, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' } })
    await native.spawnTerminal!({ argv: ['/bin/cli', 'login'], cwd: '/' } as never)
    expect(specs[0]!.env).toEqual({
      HTTP_PROXY: 'http://127.0.0.1:7897',
      HTTPS_PROXY: 'http://127.0.0.1:7897',
      NO_PROXY: '.local,localhost,127.0.0.1,::1,.corp.example,intranet',
    })
    expect(specs[1]!.env?.HTTPS_PROXY).toBe('http://127.0.0.1:7897')
  })

  it('keeps a proxy the user or the CLI launch already chose', async () => {
    clearInheritedProxy()
    const { specs, backend } = capture()
    const native = nativeProcessBackend(backend, 'darwin', { systemProxy: await proxySource() })
    native.spawn({ argv: ['/bin/cli'], cwd: '/', env: { HTTPS_PROXY: 'http://10.0.0.1:3128' }, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' } })
    vi.stubEnv('HTTP_PROXY', 'http://10.0.0.2:3128')
    native.spawn({ argv: ['/bin/cli'], cwd: '/', env: {}, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' } })
    expect(specs[0]!.env).toEqual({ HTTPS_PROXY: 'http://10.0.0.1:3128' })
    expect(specs[1]!.env).toEqual({})
  })

  it('leaves every spawn untouched without a system proxy source', () => {
    clearInheritedProxy()
    const { specs, backend } = capture()
    nativeProcessBackend(backend, 'win32', { electron: false }).spawn({
      argv: ['C:\\cli.exe'],
      cwd: 'C:\\',
      env: {},
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    })
    expect(specs).toHaveLength(1)
    expect(specs[0]!.env).toEqual({})
  })
})

describe('Host HTTPS reads', () => {
  afterEach(() => {
    setHostProxy(undefined)
    vi.unstubAllGlobals()
  })

  it('uses the same bypass rules as the CLIs and yields to an inherited proxy', async () => {
    clearInheritedProxy()
    const lookup = hostProxyLookup(new WindowsSystemProxySource(() => handle(ON), 60_000))
    expect(await lookup('https://chatgpt.com/backend-api/codex/models')).toBe('http://127.0.0.1:7897')
    expect(await lookup('https://localhost:8443/')).toBeUndefined()
    expect(await lookup('https://[::1]:8443/')).toBeUndefined()
    expect(await lookup('https://api.corp.example/')).toBeUndefined()
    // A proxy the user exported wins over the system one; on Windows the Host follows it like the CLIs.
    vi.stubEnv('HTTPS_PROXY', 'http://10.0.0.1:3128')
    expect(await lookup('https://chatgpt.com/')).toBe(process.platform === 'win32' ? 'http://10.0.0.1:3128' : undefined)
    expect(bypassesProxy('corp.example', ['.corp.example'])).toBe(true)
    expect(bypassesProxy('notcorp.example', ['.corp.example', 'corp.example'])).toBe(false)
  })

  it('lets a Windows child process read the proxy the Host handed it', () => {
    const env = { HTTPS_PROXY: 'http://127.0.0.1:7897', NO_PROXY: 'localhost,127.0.0.1,::1,[::1]:8080,*.corp.example,intranet:8443' }
    expect(environmentProxy('https://chatgpt.com/', env, 'win32')).toBe('http://127.0.0.1:7897')
    for (const target of ['https://localhost/', 'https://[::1]:1/', 'https://api.corp.example/', 'https://intranet/'])
      expect(environmentProxy(target, env, 'win32')).toBeUndefined()
    expect(environmentProxy('https://chatgpt.com/', { ...env, NO_PROXY: '*' }, 'win32')).toBeUndefined()
    expect(environmentProxy('https://chatgpt.com/', { HTTPS_PROXY: 'socks5://127.0.0.1:1080' }, 'win32')).toBeUndefined()
    expect(environmentProxy('https://chatgpt.com/', env, 'darwin')).toBeUndefined()
  })

  it('keeps plain fetch when no proxy applies', async () => {
    const fetch = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    const lookup = vi.fn(async () => 'http://127.0.0.1:9')
    setHostProxy(lookup)
    await hostFetch('http://127.0.0.1:1/health')
    expect(lookup).not.toHaveBeenCalled()
    setHostProxy(async () => undefined)
    await hostFetch('https://example.invalid/models', { headers: { accept: 'application/json' } })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('tunnels an HTTPS read through the system proxy with CONNECT', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    // 模拟代理：记录 CONNECT 后拒绝建隧道，验证请求确实交给了代理而非直连。
    const seen: string[] = []
    const proxy = createServer((socket) =>
      socket.once('data', (data) => {
        seen.push(data.toString('latin1').split('\r\n')[0]!)
        socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')
      }),
    )
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
    try {
      setHostProxy(async () => `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`)
      await expect(hostFetch('https://example.invalid/models', { method: 'GET', redirect: 'error' })).rejects.toThrow()
      expect(seen).toEqual(['CONNECT example.invalid:443 HTTP/1.1'])
      expect(fetch).not.toHaveBeenCalled()
      await expect(hostFetch('https://example.invalid/models', { method: 'POST', body: '{}' })).rejects.toThrow(TypeError)
    } finally {
      await new Promise((resolve) => proxy.close(resolve))
    }
  })
})
