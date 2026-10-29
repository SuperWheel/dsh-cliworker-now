import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { bypassesProxy, environmentProxy } from './host-fetch.mjs'

/** The Internet Options proxy (WinINET) as an HTTP proxy URL plus hosts it skips. */
export interface WindowsSystemProxy {
  url: string
  bypass: string[]
}

const SETTINGS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
const PROXY_NAMES = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'])
// Loopback stays direct so native OAuth callbacks never go through the proxy.
const LOCAL = ['localhost', '127.0.0.1', '::1']
const OUTPUT_LIMIT = 64 * 1024

/** `reg query` output to a proxy, or undefined when the switch is off or the value is not one HTTP proxy. */
export function parseInternetSettings(output: string): WindowsSystemProxy | undefined {
  const values = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+(ProxyEnable|ProxyServer|ProxyOverride)\s+REG_\w+\s+(.*?)\s*$/i.exec(line)
    if (match) values.set(match[1]!.toLowerCase(), match[2]!)
  }
  if (!/^0x0*1$/i.test(values.get('proxyenable') ?? '')) return undefined
  // Either one "host:port" for every protocol, or "http=host:port;https=host:port;socks=host:port".
  const entries = (values.get('proxyserver') ?? '').split(';').map((entry) => entry.trim()).filter(Boolean)
  const scheme = (name: string) =>
    entries.find((entry) => entry.toLowerCase().startsWith(`${name}=`))?.slice(name.length + 1)
  const address =
    entries.length === 1 && !entries[0]!.includes('=') ? entries[0]! : (scheme('https') ?? scheme('http'))
  const match = /^(?:https?:\/\/)?(\[[0-9a-f:.]+\]|[a-z0-9.-]+):(\d{1,5})\/?$/i.exec(address ?? '')
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) return undefined
  // Only entries every CLI reads the same way: hosts and leading-wildcard domains.
  // `<local>` and mid-pattern wildcards such as `10.*` have no NO_PROXY form.
  const bypass = (values.get('proxyoverride') ?? '')
    .split(';')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => /^(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(entry))
    .map((entry) => entry.replace(/^\*\./, '.'))
  return { url: `http://${match[1]}:${match[2]}`, bypass }
}

/** Whether the inherited or explicit environment already decides proxying, including an explicit removal. */
export function decidesProxy(...envs: (NodeJS.ProcessEnv | undefined)[]): boolean {
  return envs.some((env) =>
    Object.entries(env ?? {}).some(
      ([key, value]) => PROXY_NAMES.has(key.toUpperCase()) && (value === undefined || !!value.trim()),
    ),
  )
}

/** The variables a CLI reads on macOS from launchd; Windows keys are case-insensitive, so one spelling each. */
export function proxyEnvironment(proxy: WindowsSystemProxy, inherited: NodeJS.ProcessEnv = {}): Record<string, string> {
  const existing = Object.entries(inherited).flatMap(([key, value]) =>
    key.toUpperCase() === 'NO_PROXY' && value ? value.split(',').map((entry) => entry.trim()) : [],
  )
  const noProxy = [...new Set([...existing.filter(Boolean), ...LOCAL, ...proxy.bypass])].join(',')
  return { HTTP_PROXY: proxy.url, HTTPS_PROXY: proxy.url, NO_PROXY: noProxy }
}

/** The proxy URL for one Host request, under the same rules as a CLI the Host starts. */
export function hostProxyLookup(source: WindowsSystemProxySource): (target: string) => Promise<string | undefined> {
  return async (target) => {
    if (decidesProxy(process.env)) return environmentProxy(target)
    const proxy = await source.fresh()
    if (!proxy) return undefined
    const bypass = proxyEnvironment(proxy, process.env).NO_PROXY.split(',')
    return bypassesProxy(new URL(target).hostname, bypass) ? undefined : proxy.url
  }
}

/** Reads the switch on demand; a proxy turned off or changed applies to CLIs started afterwards. */
export class WindowsSystemProxySource {
  private value?: WindowsSystemProxy
  private readAt = Number.NEGATIVE_INFINITY
  private pending?: Promise<void>

  constructor(
    private readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle,
    private readonly ttlMs = 15_000,
    private readonly now = () => Date.now(),
  ) {}

  /** The last reading, refreshing in the background when stale; for spawns that cannot wait. */
  current(): WindowsSystemProxy | undefined {
    if (this.stale()) void this.refresh()
    return this.value
  }

  /** A reading no older than the TTL. */
  async fresh(): Promise<WindowsSystemProxy | undefined> {
    if (this.stale()) await this.refresh()
    return this.value
  }

  refresh(): Promise<void> {
    this.pending ??= this.read()
      .then(
        (value) => {
          this.value = value
        },
        () => {
          // An unreadable setting never keeps an old proxy alive.
          this.value = undefined
        },
      )
      .finally(() => {
        this.readAt = this.now()
        this.pending = undefined
      })
    return this.pending
  }

  private stale(): boolean {
    return this.now() - this.readAt >= this.ttlMs
  }

  private async read(): Promise<WindowsSystemProxy | undefined> {
    const system = process.env.SystemRoot ?? 'C:\\Windows'
    const child = this.spawn({
      argv: [join(system, 'System32', 'reg.exe'), 'query', SETTINGS],
      cwd: system,
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: 500,
      signal: AbortSignal.timeout(5_000),
    })
    void child.done.catch(() => undefined)
    try {
      child.stderr?.resume()
      // reg.exe prints the value names and these values in ASCII under any console code page.
      const decoder = new StringDecoder('latin1')
      let output = ''
      for await (const chunk of child.stdout ?? []) {
        output += decoder.write(chunk as Buffer)
        if (output.length > OUTPUT_LIMIT) throw new Error('Internet Settings output too large')
      }
      const outcome = await child.done
      return outcome.exitCode === 0 ? parseInternetSettings(output + decoder.end()) : undefined
    } finally {
      child.terminate()
      await child.waitForExit()
      await child.done.catch(() => undefined)
    }
  }
}
