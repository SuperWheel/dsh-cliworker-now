import { StringDecoder } from 'node:string_decoder'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { ActiveCliId } from '../../shared/types.ts'
import { OFFICIAL_NPM_REGISTRY, customRegistryProblem } from '../../shared/cli-management.ts'
import { hostFetch } from '../host-fetch.mjs'
import { ProcessCleanupUnconfirmedError, METADATA_EXIT_GRACE_MS, type ProcessBackend, type RuntimeConfig } from '../process.ts'
import { verifyTraecnExecutable } from '../traecn-executable.ts'
import type { InstallationIdentity } from './identity.ts'
import { CLI_SOURCES } from './sources.ts'

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
export function validVersion(value: unknown): value is string { return typeof value === 'string' && value.length < 128 && semver.test(value) }
export function compareVersions(a: string, b: string): number {
  const x = semver.exec(a), y = semver.exec(b)
  if (!x || !y) throw new Error('Invalid SemVer')
  for (let i = 1; i <= 3; i++) { const d = BigInt(x[i]!) - BigInt(y[i]!); if (d) return d > 0 ? 1 : -1 }
  if (!x[4] || !y[4]) return x[4] ? -1 : y[4] ? 1 : 0
  const xp = x[4].split('.'), yp = y[4].split('.')
  for (let i = 0; i < Math.max(xp.length, yp.length); i++) {
    const l = xp[i], r = yp[i]; if (l === r) continue
    if (l === undefined) return -1; if (r === undefined) return 1
    const ln = /^\d+$/.test(l), rn = /^\d+$/.test(r)
    if (ln && rn) return BigInt(l) > BigInt(r) ? 1 : -1
    if (ln !== rn) return ln ? -1 : 1
    return l > r ? 1 : -1
  }
  return 0
}
export const updateAvailable = (current: string, next: string) => validVersion(current) && validVersion(next) && !(!semver.exec(current)![4] && semver.exec(next)![4]) && compareVersions(next, current) > 0
export function compatible(cli: ActiveCliId, version: string): boolean {
  if (!validVersion(version)) return false
  return CLI_SOURCES[cli].compatibility === 'pi' ? ['1.0.2', '1.0.4', '1.1.0'].includes(version)
    : CLI_SOURCES[cli].compatibility === 'opencode-v1' ? version.startsWith('1.') : true
}
export function latestCompatible(cli: ActiveCliId, versions: string[], current?: string): string | undefined {
  return versions.filter(v => compatible(cli, v) && (!current || !!semver.exec(current)?.[4] || !semver.exec(v)![4])).sort(compareVersions).at(-1)
}
/** Own the abort and await the process range, including when output readers fail. */
export async function captureReadOnly(backend: ProcessBackend, config: RuntimeConfig, argv: string[], signal: AbortSignal, background = false, env?: Record<string, string>, timeoutMs = 5000): Promise<string> {
  signal.throwIfAborted()
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), timeoutMs)
  const control = AbortSignal.any([signal, controller.signal])
  let child: ReturnType<ProcessBackend['spawn']> | undefined
  const readers: Promise<void>[] = []
  let output = '', bytes = 0, finished = false
  const abort = () => child?.terminate()
  try {
    const helper = ['./private-launch.mjs', '../private-launch.mjs'].map(p => fileURLToPath(new URL(p, import.meta.url))).find(existsSync)
    if (background && !helper) throw new Error('Background metadata launcher missing')
    child = backend.spawn({ argv: background ? [process.execPath, helper!, '--cliworker-low-priority', ...argv] : argv, cwd: homedir(), env: background ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : env, signal: control, graceMs: config.graceMs, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' } })
    void child.done.catch(() => undefined)
    control.addEventListener('abort', abort, { once: true })
    if (control.aborted) abort()
    const read = async (stream: ReturnType<ProcessBackend['spawn']>['stdout'], keep: boolean) => {
      if (!stream) return
      const decoder = new StringDecoder('utf8')
      for await (const chunk of stream) { bytes += Buffer.byteLength(chunk); if (bytes > 64 * 1024) throw new Error('Metadata output too large'); if (keep) output += decoder.write(chunk) }
      if (keep) output += decoder.end()
    }
    readers.push(read(child.stdout, true), read(child.stderr, false))
    const [outcome] = await Promise.all([child.done, ...readers]); finished = true
    control.throwIfAborted()
    if (outcome.exitCode !== 0) throw new Error('Version query failed')
    return output
  } finally {
    clearTimeout(timeout); control.removeEventListener('abort', abort)
    if (child) {
      let exited = false
      try {
        if (finished && !control.aborted) exited = await child.waitForExit(AbortSignal.timeout(METADATA_EXIT_GRACE_MS))
        if (!exited) { child.terminate(); exited = await child.waitForExit() }
      } catch (cause) { throw new ProcessCleanupUnconfirmedError({ cause }) }
      if (!exited) throw new ProcessCleanupUnconfirmedError()
      await Promise.allSettled([child.done, ...readers])
    }
  }
}
export async function currentVersion(cli: ActiveCliId, identity: InstallationIdentity, backend: ProcessBackend, config: RuntimeConfig, signal: AbortSignal, background = false): Promise<string | undefined> {
  if (validVersion(identity.manifestVersion)) return identity.manifestVersion
  const spec = CLI_SOURCES[cli]
  if (background && !spec.backgroundSafe) return
  if (spec.version === 'traecn') await verifyTraecnExecutable(identity.executable, backend, config, signal)
  if (spec.version !== 'kimi' && spec.version !== 'traecn') return
  const raw = await captureReadOnly(backend, config, [identity.executable, '--version'], signal, background, cli === 'kimi' ? { KIMI_CODE_NO_AUTO_UPDATE: '1' } : undefined)
  const match = /^(?:kimi(?:-code)?|traecli)?\s*v?(\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?)(?:\s|$)/i.exec(raw.trim())
  return validVersion(match?.[1]) ? match[1] : undefined
}
export class ReleaseError extends Error { constructor(readonly code: 'RELEASE_TIMEOUT' | 'RELEASE_UNREACHABLE' | 'NO_RELEASE_SOURCE') { super(code) } }
export function bounded<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    void pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
/** Three requests across every caller, including connection tests. */
export class ReleaseClient {
  private active = 0
  private waiters = new Set<() => void>()
  constructor(private fetcher: typeof hostFetch = hostFetch) {}
  async json(url: string, signal: AbortSignal): Promise<unknown> {
    if (customRegistryProblem(url)) throw new ReleaseError('RELEASE_UNREACHABLE')
    while (this.active >= 3) {
      signal.throwIfAborted()
      await new Promise<void>((resolve, reject) => {
        const wake = () => { cleanup(); resolve() }, abort = () => { cleanup(); reject(signal.reason) }
        const cleanup = () => { this.waiters.delete(wake); signal.removeEventListener('abort', abort) }
        this.waiters.add(wake); signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })
    }
    signal.throwIfAborted(); this.active++
    const timer = new AbortController(), timeout = setTimeout(() => timer.abort(), 8000)
    const control = AbortSignal.any([signal, timer.signal])
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const response = await bounded(this.fetcher(url, { signal: control, credentials: 'omit', redirect: 'error', headers: { Accept: 'application/vnd.npm.install-v1+json, application/json' } }), control)
      reader = response.body?.getReader()
      if (!response.ok || Number(response.headers.get('content-length')) > 512 * 1024) throw new Error('Invalid response')
      const chunks: Uint8Array[] = []; let bytes = 0
      while (reader) { control.throwIfAborted(); const result = await bounded(reader.read(), control); if (result.done) break; bytes += result.value.byteLength; if (bytes > 512 * 1024) throw new Error('Response too large'); chunks.push(result.value) }
      control.throwIfAborted()
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch { throw new ReleaseError(timer.signal.aborted || signal.aborted ? 'RELEASE_TIMEOUT' : 'RELEASE_UNREACHABLE') }
    finally { clearTimeout(timeout); void reader?.cancel().catch(() => undefined); this.active--; this.waiters.values().next().value?.() }
  }
  async integrity(cli: ActiveCliId, version: string, registry: string, signal: AbortSignal): Promise<string> {
    const pkg = CLI_SOURCES[cli].npm
    if (!pkg || !validVersion(version)) throw new ReleaseError('NO_RELEASE_SOURCE')
    const read = async (base: string) => z.object({ name: z.literal(pkg), version: z.literal(version), dist: z.object({ integrity: z.string().max(1024) }) }).parse(await this.json(new URL(`${encodeURIComponent(pkg)}/${version}`, base.endsWith('/') ? base : base + '/').href, signal)).dist.integrity
    const official = await read(OFFICIAL_NPM_REGISTRY)
    if (new URL(registry).href !== OFFICIAL_NPM_REGISTRY && await read(registry) !== official) throw Object.assign(new Error('下载源校验值与官方源不符'), { code: 'INTEGRITY_MISMATCH' })
    return official
  }
  /** The chosen source supplies bytes; only the official registry supplies trust. */
  async artifact(cli: ActiveCliId, version: string, registry: string, signal: AbortSignal): Promise<{ url: string; integrity: string }> {
    const pkg = CLI_SOURCES[cli].npm
    if (!pkg || !validVersion(version)) throw new ReleaseError('NO_RELEASE_SOURCE')
    const read = async (base: string) => z.object({ name: z.literal(pkg), version: z.literal(version), dist: z.object({ integrity: z.string().max(1024), tarball: z.string().max(4096) }) }).parse(await this.json(new URL(`${encodeURIComponent(pkg)}/${version}`, base.endsWith('/') ? base : base + '/').href, signal)).dist
    const official = await read(OFFICIAL_NPM_REGISTRY)
    const selected = new URL(registry).href === OFFICIAL_NPM_REGISTRY ? official : await read(registry)
    if (selected.integrity !== official.integrity) throw Object.assign(new Error('下载源校验值与官方源不符'), { code: 'INTEGRITY_MISMATCH' })
    if (customRegistryProblem(selected.tarball)) throw new ReleaseError('RELEASE_UNREACHABLE')
    return { url: selected.tarball, integrity: official.integrity }
  }
  async query(cli: ActiveCliId, registry: string, signal: AbortSignal, source?: string): Promise<ReleaseRecord> {
    const spec = CLI_SOURCES[cli]
    if (source === 'brew' && spec.brew && !spec.brew.tap) {
      const data = z.object({ versions: z.object({ stable: z.string() }).optional(), version: z.string().optional() }).parse(await this.json(`https://formulae.brew.sh/api/${spec.brew.kind}/${spec.brew.name}.json`, signal))
      const version = data.version ?? data.versions?.stable
      if (!validVersion(version)) throw new ReleaseError('RELEASE_UNREACHABLE')
      return { latest: version, versions: [version], checkedAt: Date.now(), registry: 'https://formulae.brew.sh/' }
    }
    if (!spec.npm) throw new ReleaseError('NO_RELEASE_SOURCE')
    const read = async (base: string) => {
      const url = new URL(encodeURIComponent(spec.npm!), base.endsWith('/') ? base : base + '/').href
      const data = z.object({ 'dist-tags': z.record(z.string(), z.string()), versions: z.record(z.string(), z.unknown()) }).parse(await this.json(url, signal))
      const latest = data['dist-tags'].latest
      if (!validVersion(latest)) throw new ReleaseError('RELEASE_UNREACHABLE')
      return { latest, versions: Object.keys(data.versions).filter(validVersion), checkedAt: Date.now(), registry: base }
    }
    let selected: ReleaseRecord | undefined, selectedError: unknown
    try { selected = await read(registry) } catch (error) { selectedError = error }
    signal.throwIfAborted()
    if (new URL(registry).href !== OFFICIAL_NPM_REGISTRY) {
      try { return await read(OFFICIAL_NPM_REGISTRY) } catch { signal.throwIfAborted() }
    }
    if (!selected) throw selectedError
    return selected
  }
}
export interface ReleaseRecord { latest: string; versions: string[]; checkedAt: number; registry: string }
