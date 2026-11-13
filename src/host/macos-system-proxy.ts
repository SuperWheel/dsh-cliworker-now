import { isIP } from 'node:net'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { CachedSystemProxySource, readSystemProxy, type SystemProxy } from './system-proxy.ts'

function hostname(value: string): boolean {
  return value.length <= 253 && value.split('.').every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
  ) && (!/^[\d.]+$/.test(value) || isIP(value) === 4)
}

function proxyHost(value: string): string | undefined {
  if (/^\[[0-9a-f:.]+\]$/i.test(value))
    return isIP(value.slice(1, -1)) === 6 ? new URL(`http://${value}`).hostname : undefined
  return hostname(value) ? value.toLowerCase() : undefined
}

function bypassHost(value: string): string | undefined {
  const entry = value.toLowerCase()
  const bare = entry.replace(/^\[|\]$/g, '')
  if (/^[0-9a-f:.]+$/i.test(bare) && isIP(bare) === 6) return new URL(`http://[${bare}]`).hostname.slice(1, -1)
  if (isIP(entry) === 4) return entry
  const domain = entry.replace(/^\*\./, '')
  return hostname(domain) ? entry.replace(/^\*\./, '.') : undefined
}

/** Parse only the root dictionary, never scoped settings or PAC URLs. */
export function parseScutilProxy(output: string, diagnostic?: (message: string) => void): SystemProxy | undefined {
  const lines = output.trim().split(/\r?\n/)
  if (lines.shift()?.trim() !== '<dictionary> {') return undefined
  const values = new Map<string, string>()
  const exceptions: string[] = []
  let depth = 1
  let inExceptions = false
  for (const raw of lines) {
    const line = raw.trim()
    if (line === '}') {
      if (depth === 2) inExceptions = false
      if (--depth < 0) return undefined
      continue
    }
    const pair = /^(\S+)\s+:\s+(.*?)$/.exec(line)
    if (depth === 0 && line) return undefined
    if (depth === 1 && pair) {
      if (values.has(pair[1]!)) return undefined
      values.set(pair[1]!, pair[2]!)
      inExceptions = pair[1] === 'ExceptionsList' && pair[2] === '<array> {'
    } else if (depth === 2 && inExceptions && pair && /^\d+$/.test(pair[1]!)) {
      exceptions.push(pair[2]!)
    }
    if (/<(?:dictionary|array)> \{$/.test(line)) depth++
  }
  if (depth !== 0) return undefined
  for (const protocol of ['HTTPS', 'HTTP']) {
    if (values.get(`${protocol}Enable`) !== '1') continue
    const host = proxyHost(values.get(`${protocol}Proxy`) ?? '')
    const port = values.get(`${protocol}Port`) ?? ''
    if (!host || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) continue
    const bypass = [...new Set(exceptions.flatMap((entry) => {
      const host = bypassHost(entry)
      return host ? [host] : []
    }))]
    return { url: `http://${host}:${Number(port)}`, bypass }
  }
  if (values.get('ProxyAutoConfigEnable') === '1' || values.get('ProxyAutoDiscoveryEnable') === '1')
    diagnostic?.('macOS 系统代理仅有 PAC/自动发现或没有有效 HTTP(S) 代理；不执行 PAC、不注入代理。')
  else if (values.get('SOCKSEnable') === '1')
    diagnostic?.('macOS 系统代理仅有 SOCKS 或没有有效 HTTP(S) 代理；多数 CLI 不认 SOCKS 变量或语义不一，不注入代理。')
  return undefined
}

export class MacOSSystemProxySource extends CachedSystemProxySource {
  constructor(
    spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle,
    ttlMs = 15_000,
    now = () => Date.now(),
    diagnostic: (message: string) => void = (message) => console.warn(`[CLI Worker / proxy] ${message}`),
  ) {
    let diagnosed = false
    super((signal) => readSystemProxy(spawn, ['/usr/sbin/scutil', '--proxy'], '/', 'utf8', (output) =>
      parseScutilProxy(output, (message) => {
        if (diagnosed) return
        diagnosed = true
        diagnostic(message)
      }), signal), ttlMs, now)
  }
}
