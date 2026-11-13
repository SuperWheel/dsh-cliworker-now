import { join } from 'node:path'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { CachedSystemProxySource, readSystemProxy, type SystemProxy } from './system-proxy.ts'

// Keep existing imports compatible; both platforms now use the same rules.
export { decidesProxy, proxyEnvironment, hostProxyLookup } from './system-proxy.ts'
export type WindowsSystemProxy = SystemProxy

const SETTINGS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

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

/** Reads Windows Internet Options with the shared bounded cache and process lifecycle. */
export class WindowsSystemProxySource extends CachedSystemProxySource {
  constructor(
    spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle,
    ttlMs = 15_000,
    now = () => Date.now(),
  ) {
    super((signal) => {
      const system = process.env.SystemRoot ?? 'C:\\Windows'
      return readSystemProxy(spawn, [join(system, 'System32', 'reg.exe'), 'query', SETTINGS], system, 'latin1', parseInternetSettings, signal)
    }, ttlMs, now)
  }
}
