import { hostFetch } from '../host-fetch.mjs'
import { CliOperationError } from './planner.ts'
import { bounded, ReadOnlyTimeoutError } from './versions.ts'

export const WORKBUDDY_WINDOWS_PUBLISHER = 'Tencent Technology (Shenzhen) Company Limited'
export const WORKBUDDY_COS_POLICY = 'workbuddy-windows-cos' as const
export interface WorkBuddyCosIntegrity { size: number; md5: string; crc64: string }
const invalid = (message: string): never => { throw new CliOperationError('INTEGRITY_MISMATCH', message) }

/** Raw URL equality rejects URL-parser normalization and encoded path aliases. */
export function workbuddyWindowsUrl(value: string, version: string, arch?: string): string {
  const url = new URL(value)
  const match = /^\/workbuddy\/saas\/win32-(x64|arm64)-user\/WorkBuddy-win32-\1-user-(\d+\.\d+\.\d+(?:\.\d+)?)-[a-f0-9]{8}\.exe$/.exec(url.pathname)
  if (url.protocol !== 'https:' || url.hostname !== 'download.codebuddy.ai' || url.username || url.password || url.port ||
      url.search || url.hash || value !== url.href || !match || match[2] !== version || arch && match[1] !== arch || /[?#]/.test(value)) {
    return invalid('国际版 Windows 下载地址不在已核实白名单内')
  }
  return value
}

export async function readWorkBuddyCos(url: string, version: string, feedSize: number | undefined, signal: AbortSignal,
  fetcher: typeof hostFetch = hostFetch): Promise<WorkBuddyCosIntegrity> {
  workbuddyWindowsUrl(url, version)
  const control = AbortSignal.any([signal, AbortSignal.timeout(8000)])
  const response = await bounded(fetcher(url, { method: 'HEAD', redirect: 'error', credentials: 'omit', signal: control }), control)
  try {
    const length = response.headers.get('content-length') ?? '', md5 = response.headers.get('x-cos-meta-md5') ?? '', crc64 = response.headers.get('x-cos-hash-crc64ecma') ?? ''
    if (response.status !== 200 || response.redirected || !/^[1-9]\d*$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > 1024 ** 3 ||
        !/^[a-f\d]{32}$/i.test(md5) || !/^\d{1,20}$/.test(crc64) || BigInt(crc64) > 0xffffffffffffffffn ||
        feedSize !== undefined && feedSize !== Number(length)) return invalid('官方 COS 长度或 MD5 / CRC64 元数据无效或与 feed 不符')
    control.throwIfAborted()
    return { size: Number(length), md5: md5.toLowerCase(), crc64: BigInt(crc64).toString() }
  } finally { await response.body?.cancel() }
}

// CRC-64/XZ: reflected ECMA polynomial, init/xorout all ones. Paired uint32s
// avoid per-byte BigInt allocation for the ~500 MB installer.
const high = new Uint32Array(256), low = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let value = BigInt(i)
  for (let bit = 0; bit < 8; bit++) value = value & 1n ? value >> 1n ^ 0xc96c5795d7870f42n : value >> 1n
  high[i] = Number(value >> 32n); low[i] = Number(value & 0xffffffffn)
}
export class Crc64Xz {
  private hi = 0xffffffff
  private lo = 0xffffffff
  update(bytes: Uint8Array): void {
    let hi = this.hi, lo = this.lo
    for (const byte of bytes) {
      const index = (lo ^ byte) & 255
      lo = (lo >>> 8 | hi << 24) ^ low[index]!
      hi = hi >>> 8 ^ high[index]!
    }
    this.hi = hi; this.lo = lo
  }
  digest(): string { return ((BigInt((this.hi ^ 0xffffffff) >>> 0) << 32n) | BigInt((this.lo ^ 0xffffffff) >>> 0)).toString() }
}

export async function verifyWorkBuddyWindowsSignature(file: string, signal: AbortSignal,
  capture: (argv: string[], signal: AbortSignal) => Promise<string>): Promise<void> {
  signal.throwIfAborted()
  // Only base64 data varies. Never interpolate a path as PowerShell syntax or
  // append it to -Command (whose trailing arguments are parsed as expressions).
  const path = Buffer.from(file, 'utf8').toString('base64')
  const script = `$ErrorActionPreference='Stop'; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${path}')); $s=Get-AuthenticodeSignature -LiteralPath $p; @{Status=[string]$s.Status; Subject=[string]$s.SignerCertificate.Subject} | ConvertTo-Json -Compress`
  let output: string
  try { output = await capture(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], signal) }
  catch (error) {
    // A timeout is not a network or prefix problem: say so instead of the generic failure.
    if (error instanceof ReadOnlyTimeoutError && !signal.aborted) throw new CliOperationError('VERIFY_TIMEOUT', '核对安装包官方签名超时，未运行安装程序；请稍后重试')
    throw error
  }
  signal.throwIfAborted()
  let result: { Status?: unknown; Subject?: unknown }
  try { result = JSON.parse(output.replace(/^\uFEFF/, '').trim()) } catch { return invalid('无法核实安装包 Authenticode 签名') }
  const fields = typeof result?.Subject === 'string' ? result.Subject.split(/,\s*(?=[A-Za-z][A-Za-z0-9.]*=)/) : []
  if (result?.Status !== 'Valid' || !fields.includes(`CN=${WORKBUDDY_WINDOWS_PUBLISHER}`) || !fields.includes(`O=${WORKBUDDY_WINDOWS_PUBLISHER}`)) {
    invalid('安装包 Authenticode 签名状态或发布者不符')
  }
}
