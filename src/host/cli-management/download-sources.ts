import type { hostFetch } from '../host-fetch.mjs'
import { customRegistryProblem } from '../../shared/cli-management.ts'
import { bounded } from './versions.ts'
import { CliOperationError } from './planner.ts'
import { recoverableDownloadError } from './recovery.ts'

class SourceIdentityError extends CliOperationError {
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
interface Identity { length: number; etag?: string; md5?: string; rangeSupported: boolean }
const mismatch = (): never => { throw new SourceIdentityError() }
/** Fixed Host-supplied URLs only. Every connection is preceded by HEAD; identity
 * stays anchored to the first reachable source, even after a clean retry. */
export class ArtifactSources {
  private index = 0
  private rangeCapable = false
  private identity?: Identity
  private current?: Identity
  private resolved = new Map<number, string>()
  constructor(private urls: readonly string[], private fetcher: typeof hostFetch, private signal: AbortSignal, private maxBytes: number, private requireMd5 = false, private redirects: Record<string, string> = {}) {
    if (!urls.length || urls.length > 8 || new Set(urls).size !== urls.length || urls.some(url => customRegistryProblem(url) || new URL(url).port)) throw new CliOperationError('NETWORK', '下载源列表必须是无凭据的 HTTPS 地址')
  }
  get url() { return this.resolved.get(this.index) ?? this.urls[this.index]! }
  get supportsRange() { return this.rangeCapable }
  get length() { return this.identity?.length }
  get md5() { return this.identity?.md5 }
  get etag() { return this.current?.etag }
  private async head(index: number): Promise<Identity> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000)
    const signal = AbortSignal.any([this.signal, controller.signal])
    try {
      let url = this.urls[index]!
      const request = (value: string) => bounded(this.fetcher(value, { method: 'HEAD', signal, credentials: 'omit', redirect: this.redirects[value] ? 'manual' : 'error', headers: { 'Accept-Encoding': 'identity', Range: 'bytes=0-' } }), signal)
      let response = await request(url)
      if ([301, 302, 307, 308].includes(response.status) && this.redirects[url]) {
        const target = this.redirects[url]!
        if (response.headers.get('location') !== target || customRegistryProblem(target)) mismatch()
        url = target; response = await request(url)
      }
      if (response.status !== 200 && response.status !== 206) throw new CliOperationError('NETWORK', `下载源 HEAD 失败（HTTP ${response.status}）`)
      const range = /^bytes 0-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
      const value = response.status === 206 && range && Number(range[1]) + 1 === Number(range[2]) ? range[2]! : response.status === 200 ? response.headers.get('content-length') : null, length = Number(value)
      const etag = response.headers.get('etag')?.trim(), md5 = contentMd5(response.headers.get('content-md5'))
      if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(length) || length <= 0 || length > this.maxBytes || etag?.startsWith('W/') || !etag && !md5 || this.requireMd5 && !md5) mismatch()
      this.resolved.set(index, url)
      return { length, etag, md5, rangeSupported: response.status === 206 || response.headers.get('accept-ranges')?.toLowerCase() === 'bytes' }
    } finally { clearTimeout(timer) }
  }
  async select(rotate = false): Promise<void> {
    let lastError: unknown
    for (let offset = 0; offset < this.urls.length; offset++) {
      this.signal.throwIfAborted()
      const next = (this.index + (rotate ? 1 : 0) + offset) % this.urls.length
      let identity: Identity
      try { identity = await this.head(next) }
      catch (error) {
        this.signal.throwIfAborted()
        // A different object/invalid identity is never a network failover.
        if (error instanceof SourceIdentityError || !(error instanceof CliOperationError) && !recoverableDownloadError(error) && !(error instanceof DOMException && error.name === 'AbortError')) throw error
        lastError = error; continue
      }
      if (this.identity) {
        const digest = (value: Identity) => value.md5 ?? (/^"[a-fA-F0-9]{32}"$/.test(value.etag ?? '') ? value.etag!.slice(1, -1).toLowerCase() : undefined)
        const same = this.requireMd5 ? identity.etag === this.identity.etag && identity.md5 === this.identity.md5
          : !!identity.etag && identity.etag === this.identity.etag || !!digest(identity) && digest(identity) === digest(this.identity)
        if (identity.length !== this.identity.length || !same || identity.md5 && this.identity.md5 && identity.md5 !== this.identity.md5) mismatch()
      }
      this.identity ??= identity; this.current = identity; this.index = next; this.rangeCapable = identity.rangeSupported; return
    }
    throw lastError ?? new CliOperationError('NETWORK', '全部下载源不可用')
  }
  validate(response: Response): void {
    if (response.status !== 200 && response.status !== 206) return
    if (!this.current) mismatch()
    const { length, etag, md5 } = this.current!
    if (etag && response.headers.get('etag')?.trim() !== etag || md5 && contentMd5(response.headers.get('content-md5')) !== md5) mismatch()
    if (response.status === 206 && !response.headers.get('content-range')?.endsWith(`/${length}`)) mismatch()
  }
}
