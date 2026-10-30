import { Agent, request } from 'node:https'
import { Readable } from 'node:stream'

/** @type {((target: string) => Promise<string | undefined>) | undefined} */
let proxyFor
const NULL_BODY = new Set([204, 205, 304])

/** Windows: the Host's own catalog/account reads follow the system proxy the CLIs are given. */
export function setHostProxy(lookup) {
  proxyFor = lookup
}

/** Whether NO_PROXY-style entries (`host`, `.domain`) send a host direct. */
export function bypassesProxy(hostname, entries) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return entries.some((entry) =>
    entry.startsWith('.') ? host.endsWith(entry) || host === entry.slice(1) : host === entry || host.endsWith(`.${entry}`),
  )
}

/**
 * Windows only: the proxy variables a CLI would use for `target`. The Pi/OMP
 * bridge is a child process without the Host's lookup; it receives the system
 * proxy as these variables. macOS keeps plain `fetch`.
 */
export function environmentProxy(target, env = process.env, platform = process.platform) {
  if (platform !== 'win32') return undefined
  const value = env.HTTPS_PROXY?.trim()
  if (!value) return undefined
  try {
    if (!['http:', 'https:'].includes(new URL(value).protocol)) return undefined
  } catch {
    return undefined
  }
  const entries = (env.NO_PROXY ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => {
      const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(entry)
      if (bracketed) return bracketed[1]
      // `host:port` loses its port; a bare IPv6 address keeps its colons.
      return (entry.split(':').length === 2 ? entry.replace(/:\d+$/, '') : entry).replace(/^\*\./, '.')
    })
  if (entries.includes('*')) return undefined
  return bypassesProxy(new URL(target).hostname, entries) ? undefined : value
}

/** `fetch`, except that an HTTPS request the system proxy applies to is tunnelled through it. */
export async function hostFetch(input, init = {}) {
  const target = input instanceof URL ? input : new URL(String(input))
  const proxy = target.protocol === 'https:' ? await (proxyFor ?? environmentProxy)(target.href) : undefined
  return proxy ? proxiedFetch(target, init, proxy) : globalThis.fetch(input, init)
}

// Node 24's Agent tunnels HTTPS through an HTTP proxy with CONNECT; TLS still ends at the target.
function proxiedFetch(target, init, proxy) {
  if (init.body != null) return Promise.reject(new TypeError('Proxied Host requests carry no body'))
  init.signal?.throwIfAborted()
  // https.request has no fetch defaults. Nous rejects a missing User-Agent at
  // its edge; preserve Node fetch's client identity.
  const requestHeaders = new Headers(init.headers)
  if (!requestHeaders.has('user-agent')) requestHeaders.set('user-agent', 'node')
  return new Promise((resolve, reject) => {
    const outgoing = request(
      target,
      {
        method: init.method ?? 'GET',
        headers: Object.fromEntries(requestHeaders),
        agent: new Agent({ proxyEnv: { HTTPS_PROXY: proxy }, keepAlive: false }),
        signal: init.signal,
      },
      (incoming) => {
        const status = incoming.statusCode ?? 0
        if (init.redirect === 'error' && status >= 300 && status < 400) {
          incoming.resume()
          reject(new TypeError('fetch failed: unexpected redirect'))
          return
        }
        const headers = new Headers()
        for (const [name, value] of Object.entries(incoming.headers))
          for (const item of [value ?? []].flat()) headers.append(name, item)
        resolve(
          new Response(NULL_BODY.has(status) ? null : Readable.toWeb(incoming), {
            status,
            statusText: incoming.statusMessage ?? '',
            headers,
          }),
        )
      },
    )
    outgoing.once('error', reject)
    outgoing.end()
  })
}
