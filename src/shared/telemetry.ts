/**
 * CLIs whose provider bills in credits. Their usage is shown in credits (an
 * unreadable figure stays unknown); every other CLI keeps the token display.
 * CodeBuddy and WorkBuddy's built-in CLI price models as credit multipliers.
 */
export const CREDIT_BILLED_CLIS = ['qoder', 'qodercn', 'codebuddy', 'workbuddycn', 'workbuddy'] as const
export const creditBilledCli = (cli: string | undefined): boolean =>
  (CREDIT_BILLED_CLIS as readonly string[]).includes(cli ?? '')

/** Counts reported by the CLI. Scope is explicit; snapshots must not be added twice. */
export interface TokenUsage {
  total: number
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  reasoning?: number
  /** OMP's explicit provider orchestration charges, separate from its primary response. */
  orchestration?: { input?: number; output?: number; cacheRead?: number }
  scope: 'response' | 'run' | 'session' | 'reported'
}
/** Last verified cumulative receipt, bound to the CLI session that produced it. */
export interface ConversationTelemetryCheckpoint {
  policy: 1
  cli: import('./types.ts').ActiveCliId
  conversationId: string
  runId: string
  usage: TokenUsage & { scope: 'session' }
  sessionDurationSeconds?: number
}
/** A complete prior invocation receipt; it is never a conversation total. */
export interface LastRunUsageSnapshot {
  policy: 1
  cli: import('./types.ts').ActiveCliId
  conversationId: string
  runId: string
  usage: TokenUsage & { scope: 'run' }
}
/** Last native window, valid only for this exact CLI session and selected model. */
export interface ContextTelemetryCheckpoint {
  policy: 1
  cli: import('./types.ts').CliId
  conversationId: string
  model: string
  observedModel?: string
  runId: string
  contextUsed?: number
  /** A CLI-published proportion; never converted into invented token counts. */
  contextRatio?: number
  contextCapacity?: number
  contextSource?: string
  contextCapacitySource?: string
  contextEstimated?: boolean
  contextBreakdown?: ContextBreakdown
}
/** CLI-owned categories. Missing is unknown; categories need not add up to provider usage. */
export interface ContextBreakdown {
  /** Exact CLI category labels and estimates, including categories outside DSH's three buckets. */
  categories?: { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }[];
  systemTokens?: number
  toolTokens?: number
  messageTokens?: number
  estimated?: boolean
  source?: string
}
export interface Telemetry {
  /** Exact provider credits for this invocation (Qoder, CodeBuddy family); independent from token counters. */
  providerCredits?: number
  /** Source invocation for the shown receipt, including a prior confirmed run snapshot. */
  usageRunId?: string
  /** Upstream AGY conversation duration, not the duration of the current invocation. */
  sessionDurationSeconds?: number
  contextEstimated?: boolean
  contextSource?: string
  contextCapacitySource?: string
  contextBreakdown?: ContextBreakdown
  usage?: TokenUsage
  contextUsed?: number
  contextCapacity?: number
  /** A CLI-published proportion, independent from an unknown numerator/capacity. */
  contextRatio?: number
}
export function compactTokens(value: number): string {
  const scaled = (n: number) => String(n >= 100 ? Math.round(n) : Math.round(n * 10) / 10)
  return value < 1000 ? String(value) : value < 1e6 ? `${scaled(value / 1000)}K` : `${scaled(value / 1e6)}M`
}
/** Same calendar-day/year cuts and Chinese templates as Harness formatMessageClock. */
export function messageClock(time: string, now = new Date()): string {
  const d = new Date(time)
  if (!Number.isFinite(d.getTime())) return '—'
  const clock = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (d.toDateString() === now.toDateString()) return clock
  const day = `${d.getMonth() + 1}月${d.getDate()}日 ${clock}`
  return d.getFullYear() === now.getFullYear() ? day : `${d.getFullYear()}年 ${day}`
}
