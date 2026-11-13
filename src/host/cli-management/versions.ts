import { StringDecoder } from 'node:string_decoder'
import { stripVTControlCharacters } from 'node:util'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { ActiveCliId } from '../../shared/types.ts'
import { OFFICIAL_NPM_REGISTRY, NPMMIRROR_REGISTRY, customRegistryProblem } from '../../shared/cli-management.ts'
import { hostFetch } from '../host-fetch.mjs'
import { ProcessCleanupUnconfirmedError, METADATA_EXIT_GRACE_MS, type ProcessBackend, type RuntimeConfig } from '../process.ts'
import type { InstallationIdentity } from './identity.ts'
import { CLI_SOURCES, NATIVE_RELEASES, isDesktopCli } from './sources.ts'
import { isSupportedPiVersion } from '../pi-installation.mjs'

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
export function validVersion(value: unknown): value is string { return typeof value === 'string' && value.length < 128 && semver.test(value) }
export const validAppVersion = (value: unknown): value is string => typeof value === 'string' && value.length < 128 && /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*)){2,3}$/.test(value)
export const validUpdateVersion = (cli: ActiveCliId, value: unknown): value is string => isDesktopCli(cli) ? validAppVersion(value) : validVersion(value)
/** WorkBuddy's public productVersion has a build suffix, while Info.plist/feed
 * conditional queries use the three-component app version (research §3.13). */
export const desktopVersion = (cli: ActiveCliId, version: string) => cli === 'workbuddy' || cli === 'workbuddycn' ? version.split('.').slice(0, 3).join('.') : version
export const piNotice = (cli: ActiveCliId, version?: string) => cli === 'pi' && version && !isSupportedPiVersion(version) ? `插件尚未适配 Pi ${version}，更新后 Pi Worker 要等插件适配后才能使用` : undefined
export function compareVersions(a: string, b: string): number {
  if (validAppVersion(a) && validAppVersion(b)) {
    const x = a.split('.'), y = b.split('.')
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = BigInt(x[i] ?? 0) - BigInt(y[i] ?? 0); if (d) return d > 0 ? 1 : -1 }
    return 0
  }
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
export const updateAvailable = (current: string, next: string) => (validVersion(current) || validAppVersion(current)) && (validVersion(next) || validAppVersion(next)) && !(!semver.exec(current)?.[4] && semver.exec(next)?.[4]) && compareVersions(next, current) > 0
export function compatible(cli: ActiveCliId, version: string): boolean {
  if (!validUpdateVersion(cli, version)) return false
  return CLI_SOURCES[cli].compatibility === 'opencode-v1' ? version.startsWith('1.') : true
}
export function latestCompatible(cli: ActiveCliId, versions: string[], current?: string): string | undefined {
  return versions.filter(v => compatible(cli, v) && (!current || !!semver.exec(current)?.[4] || !semver.exec(v)?.[4])).sort(compareVersions).at(-1)
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
    const [outcome] = await bounded(Promise.all([child.done, ...readers]), control); finished = true
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
  if (cli === 'zcode' && validAppVersion(identity.fingerprint.appVersion)) return identity.fingerprint.appVersion
  if (validVersion(identity.manifestVersion)) return identity.manifestVersion
  const spec = CLI_SOURCES[cli]
  if (background && !spec.backgroundSafe) return
  if (spec.version !== 'kimi' && spec.version !== 'command') return
  const raw = await captureReadOnly(backend, config, [identity.executable, '--version'], signal, background, cli === 'kimi' ? { KIMI_CODE_NO_AUTO_UPDATE: '1' } : undefined)
  if (cli === 'traecn') {
    const channel = /\binstallation:\s*(public|tob|tob-alpha|internal)\b/.exec(stripVTControlCharacters(raw))?.[1]
    if (channel) identity.channel = channel
  }
  return firstVersion(raw)
}
/** Whole tokens only: never turn 01.2.3 or 1.2.3.4 into a guessed SemVer. */
export function firstVersion(raw: string): string | undefined {
  for (const [token] of stripVTControlCharacters(raw).matchAll(/[0-9A-Za-z.+-]+/g)) {
    const value = token.replace(/^v(?=\d)/, '')
    if (validVersion(value)) return value
  }
}
export const RELEASE_JSON_LIMIT = 512 * 1024
// Measured OpenCode packument is 14.7 MB; 32 MiB provides bounded growth room.
// Only compatibility fallback can use this limit. Dist-tags/artifacts stay small.
export const RELEASE_VERSIONS_LIMIT = 32 * 1024 * 1024
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
  constructor(private fetcher: typeof hostFetch = hostFetch, private platform = process.platform, private arch = process.arch) {}
  async json(url: string, signal: AbortSignal): Promise<unknown> {
    return this.readJson(url, signal, RELEASE_JSON_LIMIT)
  }
  private async readJson(url: string, signal: AbortSignal, limit: number): Promise<unknown> {
    try { return JSON.parse(await this.text(url, signal, limit)) } catch (error) { if (error instanceof ReleaseError) throw error; throw new ReleaseError('RELEASE_UNREACHABLE') }
  }
  /** Shared budget for JSON, plain text and the desktop adapter's metadata GET. */
  async text(url: string, signal: AbortSignal, limit = RELEASE_JSON_LIMIT): Promise<string> {
    return (await this.response(url, signal, limit)).text()
  }
  async response(url: string, signal: AbortSignal, limit = RELEASE_JSON_LIMIT): Promise<Response> {
    const address = new URL(url)
    if (address.protocol !== 'https:' || address.username || address.password || address.hash) throw new ReleaseError('RELEASE_UNREACHABLE')
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
      const response = await bounded(this.fetcher(url, { method: 'GET', signal: control, credentials: 'omit', redirect: 'error', headers: { Accept: 'application/vnd.npm.install-v1+json, application/json, text/plain, application/yaml' } }), control)
      reader = response.body?.getReader()
      if (!response.ok || Number(response.headers.get('content-length')) > limit) throw new Error('Invalid response')
      const chunks: Uint8Array[] = []; let bytes = 0
      while (reader) { control.throwIfAborted(); const result = await bounded(reader.read(), control); if (result.done) break; bytes += result.value.byteLength; if (bytes > limit) throw new Error('Response too large'); chunks.push(result.value) }
      control.throwIfAborted()
      return new Response(response.status === 204 ? null : Buffer.concat(chunks), { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/octet-stream' } })
    } catch { throw new ReleaseError(timer.signal.aborted || signal.aborted ? 'RELEASE_TIMEOUT' : 'RELEASE_UNREACHABLE') }
    finally { clearTimeout(timeout); void reader?.cancel().catch(() => undefined); this.active--; this.waiters.values().next().value?.() }
  }
  async native(cli: ActiveCliId, signal: AbortSignal): Promise<ReleaseRecord> {
    const feed = NATIVE_RELEASES[cli]
    if (!feed) throw new ReleaseError('NO_RELEASE_SOURCE')
    const os = this.platform === 'win32' ? 'windows' : this.platform, cpu = this.arch === 'x64' ? 'amd64' : this.arch
    if (!['darwin', 'linux', 'windows'].includes(os) || !['arm64', 'amd64'].includes(cpu) || os === 'windows' && cpu === 'arm64' && (cli === 'qoder' || cli === 'qodercn')) throw new ReleaseError('NO_RELEASE_SOURCE')
    let url = feed.url.replace('{platform}', os).replace('{arch}', cpu)
    let version: unknown
    const sha = (value: unknown, size: number) => typeof value === 'string' && new RegExp(`^[a-fA-F0-9]{${size}}$`).test(value)
    const https = (value: unknown) => typeof value === 'string' && !customRegistryProblem(value)
    try {
      if (feed.kind === 'text') {
        let failure: unknown
        for (const candidate of [url, ...feed.fallbackUrls ?? []]) {
          signal.throwIfAborted()
          try {
            const value = (await this.text(candidate, signal)).trim()
            if (!validVersion(value)) throw new ReleaseError('RELEASE_UNREACHABLE')
            version = value; url = candidate; break
          } catch (error) { signal.throwIfAborted(); failure = error }
        }
        if (!version) throw failure
      }
      else {
        const data = await this.json(url, signal) as Record<string, any>
        switch (feed.kind) {
          case 'antigravity':
            if (!https(data.url) || !sha(data.sha512, 128)) throw new Error('Invalid artifact')
            version = data.version; break
          case 'codex':
            if (typeof data.tag_name !== 'string' || !data.tag_name.startsWith('rust-v')) throw new Error('Invalid tag')
            version = data.tag_name.slice(6); break
          case 'kimi':
            if (data.schemaVersion !== 1) throw new Error('Invalid native schema')
            version = data.version; break
          case 'pi':
            if (data.ok !== true || data.packageName !== CLI_SOURCES.pi.npm) throw new Error('Invalid Pi package')
            version = data.version; break
          case 'hermes':
            if (data.draft !== false || data.prerelease !== false || typeof data.tag_name !== 'string' || !data.tag_name.startsWith('v')) throw new Error('Not a stable release')
            version = data.tag_name.slice(1); break
          case 'qoder': {
            const file = Array.isArray(data.files) && data.files.find((f: any) => f?.os === os && f.arch === cpu)
            if (!file) throw new ReleaseError('NO_RELEASE_SOURCE')
            if (!sha(file.sha256, 64) || !https(file.url)) throw new Error('Invalid artifact')
            version = data.latest; break
          }
          case 'trae': {
            const target = `${os === 'darwin' ? 'macos' : os}-${cpu === 'arm64' ? 'aarch64' : 'x86_64'}`
            const file = Array.isArray(data.artifacts) && data.artifacts.find((f: any) => f?.platform === target)
            if (!file) throw new ReleaseError('NO_RELEASE_SOURCE')
            if (data.channel !== 'public' || data.release_channel !== 'stable' || data.binary_version !== data.version || !sha(file.sha256, 64) || !https(file.url)) throw new Error('Invalid release channel/artifact')
            version = data.version; break
          }
        }
      }
      if (!validVersion(version)) throw new Error('Invalid version')
      return { latest: version, versions: [version], checkedAt: Date.now(), registry: url }
    } catch (error) { if (error instanceof ReleaseError) throw error; throw new ReleaseError('RELEASE_UNREACHABLE') }
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
  async artifact(cli: ActiveCliId, version: string, registry: string, signal: AbortSignal, automaticSources = false): Promise<{ url: string; integrity: string; sources?: string[]; sourceRedirects?: Record<string, string> }> {
    const pkg = CLI_SOURCES[cli].npm
    if (!pkg || !validVersion(version)) throw new ReleaseError('NO_RELEASE_SOURCE')
    const read = async (base: string) => z.object({ name: z.literal(pkg), version: z.literal(version), dist: z.object({ integrity: z.string().max(1024).optional(), tarball: z.string().max(4096) }) }).parse(await this.json(new URL(`${encodeURIComponent(pkg)}/${version}`, base.endsWith('/') ? base : base + '/').href, signal)).dist
    const official = await read(OFFICIAL_NPM_REGISTRY)
    if (!official.integrity) throw new ReleaseError('RELEASE_UNREACHABLE')
    if (automaticSources) {
      const selected = new URL(registry.endsWith('/') ? registry : registry + '/').href
      const registries = [...new Set([selected, OFFICIAL_NPM_REGISTRY, NPMMIRROR_REGISTRY])]
      const name = pkg.split('/').at(-1)!, filename = `${name}-${version}.tgz`
      const sources = registries.map(base => new URL(`${pkg}/-/${filename}`, base).href)
      if (sources.some(customRegistryProblem)) throw new ReleaseError('RELEASE_UNREACHABLE')
      // Anonymous HEAD verified the registry's exact standard-path -> CDN form.
      // Only this generated target may redirect; GET itself remains redirect:error.
      const mirror = new URL(`${pkg}/-/${filename}`, NPMMIRROR_REGISTRY).href
      const sourceRedirects = { [mirror]: `https://cdn.npmmirror.com/packages/${pkg.split('/').map(encodeURIComponent).join('/')}/${version}/${filename}` }
      return { url: sources[0]!, sources, sourceRedirects, integrity: official.integrity }
    }
    const selected = new URL(registry).href === OFFICIAL_NPM_REGISTRY ? official : await read(registry)
    if (customRegistryProblem(selected.tarball)) throw new ReleaseError('RELEASE_UNREACHABLE')
    return { url: selected.tarball, integrity: official.integrity }
  }
  async query(cli: ActiveCliId, registry: string, signal: AbortSignal, source?: string): Promise<ReleaseRecord> {
    const spec = CLI_SOURCES[cli]
    if (source && source !== 'npm' && source !== 'brew' && NATIVE_RELEASES[cli]) return this.native(cli, signal)
    if (source === 'brew' && spec.brew && !spec.brew.tap) {
      const data = z.object({ versions: z.object({ stable: z.string() }).optional(), version: z.string().optional() }).parse(await this.json(`https://formulae.brew.sh/api/${spec.brew.kind}/${spec.brew.name}.json`, signal))
      const version = data.version ?? data.versions?.stable
      if (!validVersion(version)) throw new ReleaseError('RELEASE_UNREACHABLE')
      return { latest: version, versions: [version], checkedAt: Date.now(), registry: 'https://formulae.brew.sh/' }
    }
    if (!spec.npm) throw new ReleaseError('NO_RELEASE_SOURCE')
    const read = async (base: string) => {
      const root = base.endsWith('/') ? base : base + '/', pkg = encodeURIComponent(spec.npm!)
      const tags = z.record(z.string(), z.string()).parse(await this.json(new URL(`-/package/${pkg}/dist-tags`, root).href, signal))
      const latest = tags.latest
      if (!validVersion(latest)) throw new ReleaseError('RELEASE_UNREACHABLE')
      let versions = [latest]
      if (spec.compatibility !== 'any' && !compatible(cli, latest)) {
        const data = z.object({ versions: z.record(z.string(), z.unknown()) }).parse(await this.readJson(new URL(pkg, root).href, signal, RELEASE_VERSIONS_LIMIT))
        // Keep only the best compatible stable/prerelease candidates, not the entire
        // packument in the small persistent cache. latest remains the dist-tag value.
        const available = Object.keys(data.versions).filter(validVersion)
        versions = [...new Set([latest, latestCompatible(cli, available), latestCompatible(cli, available.filter(v => !semver.exec(v)![4]))].filter((v): v is string => !!v))]
      }
      return { latest, versions, checkedAt: Date.now(), registry: base }
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
