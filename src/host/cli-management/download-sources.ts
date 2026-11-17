import type { hostFetch } from '../host-fetch.mjs'
import { customRegistryProblem } from '../../shared/cli-management.ts'
import { bounded } from './versions.ts'
import { CliOperationError } from './planner.ts'
import { recoverableDownloadError } from './recovery.ts'

export class SourceIdentityError extends CliOperationError {
  constructor(message = '下载源工件身份不一致，拒绝换源或追加文件') { super('NETWORK', message) }
}

/** Content-MD5 is transport integrity, not a publisher signature. */
export function contentMd5(value: string | null): string | undefined {
  if (value === null) return undefined
  const text = value.trim()
  if (/^[a-fA-F0-9]{32}$/.test(text)) return text.toLowerCase()
  const bytes = Buffer.from(text, 'base64')
  if (bytes.length === 16 && bytes.toString('base64') === text) return bytes.toString('hex')
  throw new SourceIdentityError('下载源 content-md5 格式无效')
}
/** GCS can send crc32c and md5 in one header; crc32c alone is not an MD5. */
export function responseMd5(headers: Headers): string | undefined {
  const direct = contentMd5(headers.get('content-md5'))
  const values = (headers.get('x-goog-hash') ?? '').split(',').map(v => v.trim()).filter(v => v.startsWith('md5=')).map(v => { const value = v.slice(4), bytes = Buffer.from(value, 'base64'); if (bytes.length !== 16 || bytes.toString('base64') !== value) mismatch(); return bytes.toString('hex') })
  if (values.some(v => !v || v !== values[0]) || direct && values.length && direct !== values[0]) mismatch()
  return direct ?? values[0]
}
export class PresignedExpiredError extends CliOperationError {
  constructor() { super('NETWORK', '下载地址已失效（HTTP 403）') }
}
interface Identity { length: number; etag?: string; md5?: string; rangeSupported: boolean }
const mismatch = (): never => { throw new SourceIdentityError() }
/** Fixed Host-supplied URLs only. Every connection is preceded by a metadata probe; identity
 * stays anchored to the first reachable source, even after a clean retry. */
export class ArtifactSources {
  private index = 0
  private rangeCapable = false
  private identity?: Identity
  private current?: Identity
  private resolved = new Map<number, string>()
  constructor(private urls: readonly string[], private fetcher: typeof hostFetch, private signal: AbortSignal, private maxBytes: number, private requireMd5 = false, private redirects: Record<string, string> = {}, private lengthProbe: 'HEAD' | 'RANGE' = 'HEAD', private redirectHosts: readonly string[] = []) {
    if (!urls.length || urls.length > 8 || new Set(urls).size !== urls.length || urls.some(url => customRegistryProblem(url) || new URL(url).port)) throw new CliOperationError('NETWORK', '下载源列表必须是无凭据的 HTTPS 地址')
  }
  /** Anchor the initial official GET before takeover, preserving its partial bytes. */
  seed(length: number | undefined, etag?: string, md5?: string) {
    if (length !== undefined && (etag && !etag.startsWith('W/') || md5)) this.identity = { length, etag, md5, rangeSupported: true }
  }
  replaceUrls(urls: string[]) {
    if (!urls.length || urls.length > 8) mismatch()
    this.urls = urls; this.index = 0; this.resolved.clear()
  }
  get url() { return this.resolved.get(this.index) ?? this.urls[this.index]! }
  get supportsRange() { return this.rangeCapable }
  get length() { return this.identity?.length }
  get md5() { return this.identity?.md5 }
  get etag() { return this.current?.etag }
  private async probe(index: number): Promise<Identity> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000)
    const signal = AbortSignal.any([this.signal, controller.signal])
    try {
      let url = this.urls[index]!
      const request = async (value: string) => {
        const response = await bounded(this.fetcher(value, { method: this.lengthProbe === 'RANGE' ? 'GET' : 'HEAD', signal, credentials: 'omit', redirect: this.redirects[value] || this.redirectHosts.length ? 'manual' : 'error', headers: { 'Accept-Encoding': 'identity', Range: this.lengthProbe === 'RANGE' ? 'bytes=0-0' : 'bytes=0-' } }), signal)
        // Metadata only: cancel even an ignored Range response without consuming its body.
        await bounded(response.body?.cancel() ?? Promise.resolve(), signal)
        return response
      }
      let response = await request(url)
      for (let redirects = 0; [301, 302, 303, 307, 308].includes(response.status); redirects++) {
        const location = response.headers.get('location'), pinned = this.redirects[url]
        if (!location) mismatch()
        const target = new URL(location!, url)
        if (redirects >= 3 || target.protocol !== 'https:' || target.username || target.password || target.port || target.hash || (pinned ? target.href !== pinned : !this.redirectHosts.includes(target.hostname))) mismatch()
        url = target.href; response = await request(url)
      }
      if (response.status === 403) throw new PresignedExpiredError()
      if (response.status !== 200 && response.status !== 206) throw new CliOperationError('NETWORK', `下载源 ${this.lengthProbe} 探测失败（HTTP ${response.status}）`)
      const range = /^bytes 0-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
      const value = this.lengthProbe === 'RANGE'
        ? response.status === 206 && range?.[1] === '0' && (!response.headers.has('content-length') || response.headers.get('content-length') === '1') ? range[2]! : null
        : response.status === 206 && range && Number(range[1]) + 1 === Number(range[2]) ? range[2]! : response.status === 200 ? response.headers.get('content-length') : null
      const length = Number(value)
      const etag = response.headers.get('etag')?.trim(), md5 = responseMd5(response.headers)
      if (response.headers.has('content-encoding') && response.headers.get('content-encoding') !== 'identity') mismatch()
      if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(length) || length <= 0 || length > this.maxBytes || etag?.startsWith('W/') || !etag && !md5 || this.requireMd5 && !md5) mismatch()
      this.resolved.set(index, url)
      return { length, etag, md5, rangeSupported: response.status === 206 || response.headers.get('accept-ranges')?.toLowerCase() === 'bytes' }
    } finally { clearTimeout(timer) }
  }
  async select(rotate = false, restartOnChange = false): Promise<boolean> {
    let lastError: unknown
    for (let offset = 0; offset < this.urls.length; offset++) {
      this.signal.throwIfAborted()
      const next = (this.index + (rotate ? 1 : 0) + offset) % this.urls.length
      let identity: Identity
      try { identity = await this.probe(next) }
      catch (error) {
        this.signal.throwIfAborted()
        // A different object/invalid identity is never a network failover.
        if (error instanceof SourceIdentityError || !(error instanceof CliOperationError) && !recoverableDownloadError(error) && !(error instanceof DOMException && error.name === 'AbortError')) throw error
        lastError = error; continue
      }
      let changed = false
      if (this.identity) {
        const digest = (value: Identity) => value.md5 ?? (/^"[a-fA-F0-9]{32}"$/.test(value.etag ?? '') ? value.etag!.slice(1, -1).toLowerCase() : undefined)
        const same = this.requireMd5 ? identity.etag === this.identity.etag && identity.md5 === this.identity.md5
          : !!identity.etag && identity.etag === this.identity.etag || !!digest(identity) && digest(identity) === digest(this.identity)
        if (identity.length !== this.identity.length || !same || identity.md5 && this.identity.md5 && identity.md5 !== this.identity.md5) {
          if (!restartOnChange) mismatch()
          changed = true; this.identity = undefined
        }
      }
      this.identity ??= identity; this.current = identity; this.index = next; this.rangeCapable = identity.rangeSupported; return changed
    }
    throw lastError ?? new CliOperationError('NETWORK', '全部下载源不可用')
  }
  validate(response: Response): void {
    if (response.status !== 200 && response.status !== 206) return
    if (!this.current) mismatch()
    const { length, etag, md5 } = this.current!
    const actualEtag = response.headers.get('etag')?.trim(), actualMd5 = responseMd5(response.headers)
    // OSS omits the whole-object Content-MD5 on partial GETs. Only an unchanged
    // strong ETag can authenticate those fragments without a response digest;
    // keep the HEAD digest anchored for final whole-file verification.
    const partialWithoutMd5 = response.status === 206 && actualMd5 === undefined && !this.requireMd5 && !!etag && !etag.startsWith('W/') && actualEtag === etag
    if (etag && actualEtag !== etag || md5 && actualMd5 !== md5 && !partialWithoutMd5) mismatch()
    if (response.status === 206 && !response.headers.get('content-range')?.endsWith(`/${length}`)) mismatch()
  }
}
