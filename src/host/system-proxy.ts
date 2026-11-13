import { StringDecoder } from 'node:string_decoder'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { bypassesProxy, environmentProxy } from './host-fetch.mjs'

/** A single HTTP proxy, shared by Host requests and the CLIs it starts. */
export interface SystemProxy {
  url: string
  bypass: string[]
}

export interface SystemProxySource {
  current(): SystemProxy | undefined
  fresh(): Promise<SystemProxy | undefined>
  refresh(): Promise<void>
  close(): Promise<void>
}

const PROXY_NAMES = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'])
const LOCAL = ['localhost', '127.0.0.1', '::1']

/** Existing settings, including an explicit removal, decide proxying before the system does. */
export function decidesProxy(...envs: (NodeJS.ProcessEnv | undefined)[]): boolean {
  return envs.some((env) => Object.entries(env ?? {}).some(
    ([key, value]) => PROXY_NAMES.has(key.toUpperCase()) && (value === undefined || !!value.trim()),
  ))
}

export function proxyEnvironment(proxy: SystemProxy, inherited: NodeJS.ProcessEnv = {}): Record<string, string> {
  const existing = Object.entries(inherited).flatMap(([key, value]) =>
    key.toUpperCase() === 'NO_PROXY' && value ? value.split(',').map((entry) => entry.trim()) : [],
  )
  const noProxy = [...new Set([...existing.filter(Boolean), ...LOCAL, ...proxy.bypass])].join(',')
  return { HTTP_PROXY: proxy.url, HTTPS_PROXY: proxy.url, NO_PROXY: noProxy }
}

export function hostProxyLookup(source: SystemProxySource): (target: string) => Promise<string | undefined> {
  return async (target) => {
    if (decidesProxy(process.env)) return environmentProxy(target)
    const proxy = await source.fresh()
    if (!proxy) return undefined
    const bypass = proxyEnvironment(proxy, process.env).NO_PROXY.split(',')
    return bypassesProxy(new URL(target).hostname, bypass) ? undefined : proxy.url
  }
}

/** One on-demand cache for both platforms; stale synchronous spawns never wait. */
export class CachedSystemProxySource implements SystemProxySource {
  private value?: SystemProxy
  private readAt = Number.NEGATIVE_INFINITY
  private pending?: Promise<void>
  private readonly lifetime = new AbortController()

  constructor(
    private readonly read: (signal: AbortSignal) => Promise<SystemProxy | undefined>,
    private readonly ttlMs = 15_000,
    private readonly now = () => Date.now(),
  ) {}

  current(): SystemProxy | undefined {
    if (this.stale()) void this.refresh()
    return this.value
  }

  async fresh(): Promise<SystemProxy | undefined> {
    if (this.stale()) await this.refresh()
    return this.value
  }

  refresh(): Promise<void> {
    if (this.lifetime.signal.aborted) return Promise.resolve()
    this.pending ??= Promise.resolve().then(() => this.read(this.lifetime.signal))
      .then(
        (value) => { this.value = this.lifetime.signal.aborted ? undefined : value },
        () => { this.value = undefined },
      )
      .finally(() => {
        this.readAt = this.now()
        this.pending = undefined
      })
    return this.pending
  }

  async close(): Promise<void> {
    this.lifetime.abort()
    this.value = undefined
    await this.pending
  }

  private stale(): boolean {
    return !this.lifetime.signal.aborted && this.now() - this.readAt >= this.ttlMs
  }
}

/** Bounded, shell-free setting read; never log the command's raw output. */
export async function readSystemProxy(
  spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle,
  argv: string[],
  cwd: string,
  encoding: BufferEncoding,
  parse: (output: string) => SystemProxy | undefined,
  signal: AbortSignal,
): Promise<SystemProxy | undefined> {
  signal.throwIfAborted()
  const child = spawn({
    argv, cwd,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: 500,
    signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
  })
  void child.done.catch(() => undefined)
  try {
    child.stderr?.resume()
    const decoder = new StringDecoder(encoding)
    let output = ''
    let bytes = 0
    for await (const chunk of child.stdout ?? []) {
      bytes += (chunk as Buffer).length
      if (bytes > 64 * 1024) throw new Error('System proxy output too large')
      output += decoder.write(chunk as Buffer)
    }
    const outcome = await child.done
    return outcome.exitCode === 0 ? parse(output + decoder.end()) : undefined
  } finally {
    child.terminate()
    await child.waitForExit()
    await child.done.catch(() => undefined)
  }
}
