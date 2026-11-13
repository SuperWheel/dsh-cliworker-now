import { CliOperationError } from './planner.ts'
import { ProcessCleanupUnconfirmedError } from '../process.ts'

export const RECOVERY_LIMIT = 200, RECOVERY_TIMEOUT_MS = 2 * 60 * 60_000
/** curl exit codes: 18 partial file, 28 timeout, 52 empty reply, 56 receive failure.
 * Node/undici transport errors and the observed MiMo curl(18) output are documented
 * in the change design's task D audit. These are evidence, never a silence timer. */
export const DOWNLOAD_INTERRUPTION_EVIDENCE = /curl:\s*\((?:18|28|52|56)\)|transfer closed|connection (?:reset|closed|timed out)|\b(?:ECONNRESET|ETIMEDOUT|ECONNABORTED|EPIPE|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_RES_CONTENT_LENGTH_MISMATCH)\b|socket hang up|unexpected (?:end of file|EOF)|premature close/i
/** Examine every raw chunk before redaction/truncation, retain no raw log. */
export class InterruptionEvidence {
  interrupted = false
  private suffix = ''
  push(value: string) {
    this.interrupted ||= DOWNLOAD_INTERRUPTION_EVIDENCE.test(this.suffix + value)
    this.suffix = (this.suffix + value).slice(-256)
  }
}
export function recoverableDownloadError(error: unknown): boolean {
  const chain: { code?: string; message?: string; name?: string; cause?: unknown }[] = []
  let current = error
  while (current && typeof current === 'object' && chain.length < 8 && !chain.includes(current)) {
    chain.push(current); current = (current as Error).cause
  }
  // fetch wraps TLS/redirect errors in TypeError; inspect causes before the fallback.
  if (chain.some(e => /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_INVALID_URL/i.test(e.code ?? '') || /certificate|redirect|invalid url/i.test(e.message ?? ''))) return false
  if (error instanceof CliOperationError) return false
  return chain.some(e => DOWNLOAD_INTERRUPTION_EVIDENCE.test(`${e.code ?? ''} ${e.message ?? ''}`)) || error instanceof TypeError
}
/** The attempt MUST await process-range cleanup before returning/throwing. */
export async function withInterruptionRecovery<T>(signal: AbortSignal, attempt: (control: AbortSignal, evidence: InterruptionEvidence) => Promise<T>, retry: (count: number) => void): Promise<T> {
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), RECOVERY_TIMEOUT_MS)
  const control = AbortSignal.any([signal, deadline.signal])
  try {
    for (let count = 0; ; count++) {
      control.throwIfAborted()
      const evidence = new InterruptionEvidence()
      try { return await attempt(control, evidence) }
      catch (error) {
        if (error instanceof ProcessCleanupUnconfirmedError) throw error
        control.throwIfAborted()
        if (!evidence.interrupted || !(error instanceof CliOperationError) || !['EXIT_CODE', 'VERSION_UNCHANGED', 'VERSION_MISMATCH'].includes(error.code)) throw error
        if (count >= RECOVERY_LIMIT) throw new CliOperationError('STALL_LIMIT', '下载中断，已自动重试 200 次仍未完成，请检查网络后重试')
        retry(count + 1)
      }
    }
  } catch (error) {
    if (error instanceof ProcessCleanupUnconfirmedError) throw error
    if (signal.aborted) throw signal.reason
    if (deadline.signal.aborted) throw new CliOperationError('DOWNLOAD_TIMEOUT', '下载恢复总时长超过 2 小时')
    throw error
  } finally { clearTimeout(timer) }
}
