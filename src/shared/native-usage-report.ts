import type { CliId } from './types.ts'
import type { TokenUsage } from './telemetry.ts'

/** Provider-reported total with only the accounting details the CLI actually supplies. */
export interface NativeUsageReport {
  totalTokens: number
  inputTokens?: number
  inputBasis: 'inclusive' | 'uncached' | 'reported'
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  orchestration?: { input?: number; output?: number; cacheRead?: number }
}
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/** Partial details never become zero-valued native billing buckets. */
export function nativeUsageReport(cli: CliId, usage?: TokenUsage): NativeUsageReport | undefined {
  if (!usage || !['response', 'run', 'session', 'reported'].includes(usage.scope) || !count(usage.total)) return
  // Qoder's official routes intentionally redact token counts to zero. The
  // ACP zero triple carries no flag proving it was an actual zero request.
  if ((cli === 'qoder' || cli === 'qodercn') && (usage.total === 0 || usage.cacheRead !== undefined || usage.cacheWrite !== undefined)) return
  if (cli === 'antigravity') return // Its native total excludes cache; use the verified complete conversion instead.
  for (const field of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'] as const)
    if (usage[field] !== undefined && !count(usage[field])) return
  if (cli === 'traecn') {
    if (!usage.total || !count(usage.input) || !count(usage.output) || usage.total !== usage.input + usage.output) return
    return { totalTokens: usage.total, inputTokens: usage.input, outputTokens: usage.output, inputBasis: 'reported',
      ...(usage.cacheRead !== undefined ? { cacheReadTokens: usage.cacheRead } : {}),
      ...(usage.cacheWrite !== undefined ? { cacheWriteTokens: usage.cacheWrite } : {}),
      ...(usage.reasoning !== undefined ? { reasoningTokens: usage.reasoning } : {}) }
  }
  const inclusive = ['codex', 'hermes', 'grok', 'zcode', 'qoder', 'qodercn'].includes(cli)
  const reasoningSeparate = cli === 'mimo' || cli === 'opencode'
  const extra = usage.orchestration
  if (extra && (cli !== 'omp' || Object.values(extra).some((v) => !count(v)))) return
  const extraTotal = Object.values(extra ?? {}).reduce((sum, v) => sum + v, 0)
  if (!count(extraTotal)) return
  const cache = (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
  if (inclusive) {
    const known = Math.max(usage.input ?? 0, cache) + Math.max(usage.output ?? 0, usage.reasoning ?? 0)
    if (!count(known) || known > usage.total) return
    if (usage.input !== undefined && cache > usage.input) return
    if (usage.input !== undefined && usage.output !== undefined && usage.total !== usage.input + usage.output) return
  } else {
    const known = (usage.input ?? 0) + (reasoningSeparate ? usage.output ?? 0 : Math.max(usage.output ?? 0, usage.reasoning ?? 0)) + cache + extraTotal + (reasoningSeparate ? usage.reasoning ?? 0 : 0)
    if (!count(known) || known > usage.total) return
    const complete = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite,
      ...(reasoningSeparate ? [usage.reasoning] : [])].every(count)
    if (complete && cli !== 'omp' && known !== usage.total) return
  }
  if (!reasoningSeparate && usage.output !== undefined && (usage.reasoning ?? 0) > usage.output) return
  const output = reasoningSeparate
    ? usage.output !== undefined && usage.reasoning !== undefined ? usage.output + usage.reasoning : undefined
    : usage.output
  if (output !== undefined && !count(output)) return
  return {
    totalTokens: usage.total, inputBasis: (cli === 'qoder' || cli === 'qodercn') ? 'reported' : inclusive ? 'inclusive' : 'uncached',
    ...(usage.input === undefined ? {} : { inputTokens: usage.input }),
    ...(output === undefined ? {} : { outputTokens: output }),
    ...(usage.cacheRead === undefined ? {} : { cacheReadTokens: usage.cacheRead }),
    ...(usage.cacheWrite === undefined ? {} : { cacheWriteTokens: usage.cacheWrite }),
    ...(usage.reasoning === undefined ? {} : { reasoningTokens: usage.reasoning }),
    ...(extra && Object.keys(extra).length ? { orchestration: { ...extra } } : {}),
  }
}
