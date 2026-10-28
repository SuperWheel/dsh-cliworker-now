import type { ConversationTelemetryCheckpoint, ContextTelemetryCheckpoint, LastRunUsageSnapshot, Telemetry, TokenUsage } from './telemetry.ts'
import type { RunningMessageMode } from './running-message.ts'
export const EFFORTS = [
  'default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const
export const CLI_IDS = [
  'antigravity',
  'codex',
  'claude',
  'kimi',
  'mimo',
  'zcode',
  'grok',
  'omp',
  'pi',
  'hermes',
  'opencode',
  'qoder',
  'qodercn',
] as const
export type ActiveCliId = (typeof CLI_IDS)[number]
/** Retired IDs remain readable in existing worker history, never selectable for execution. */
export type CliId = ActiveCliId | 'harness'
export const RETIRED_HARNESS_NOTICE =
  '外部 Harness CLI 入口已移除；历史记录仅供查看。请新建 Hermes Agent 任务。'
export const isRetiredCli = (cli: CliId): cli is 'harness' => cli === 'harness'
export const CLI_LABELS: Record<CliId, string> = {
  antigravity: 'Antigravity',
  codex: 'Codex',
  claude: 'Claude Code',
  kimi: 'Kimi',
  mimo: 'MiMo',
  zcode: 'ZCode',
  grok: 'Grok Build',
  omp: 'OMP',
  pi: 'Pi',
  hermes: 'Hermes Agent',
  harness: 'Harness（已移除）',
  opencode: 'OpenCode',
  qoder: 'Qoder CLI',
  qodercn: 'Qoder CN CLI',
}
/** Short CLI stems used for automatic Worker names; protocol IDs remain unchanged. */
export const CLI_SHORT_NAMES: Record<CliId, string> = {
  antigravity: 'agy',
  codex: 'codex',
  claude: 'claude',
  kimi: 'kimi',
  mimo: 'mimo',
  zcode: 'zcode',
  grok: 'grok',
  omp: 'omp',
  pi: 'pi',
  hermes: 'hermes',
  harness: 'harness',
  opencode: 'opencode',
  qoder: 'qoder',
  qodercn: 'qodercn',
}
export const cliOf = (preference: Preference): CliId => preference.cli ?? 'antigravity'
export const effortLabel = (effort: string) =>
  effort === 'default' ? '默认' : effort.charAt(0).toUpperCase() + effort.slice(1)
export const LEGACY_ACCOUNT_RECORD_NOTICE = '此历史任务缺少账号记录，请新建任务'
/** Timeline notes for a task continued in a new native session; an account change itself is never announced. */
export const CARRYOVER_FAILED_NOTICE = '原会话无法续接，已在新会话中继续'
export const CARRYOVER_UNREACHABLE_NOTICE = '原会话记录不可用，已在新会话中继续'
/** Earlier builds' account-change notes: hidden or reworded when an older record is read. */
export const LEGACY_ACCOUNT_NOTICES: Readonly<Record<string, string | null>> = {
  '账号已变更，已改用当前账号继续': null,
  '原会话无法在当前账号续接，已在新会话中继续': CARRYOVER_FAILED_NOTICE,
  '原会话不在当前账号的会话记录中，已在新会话中继续': CARRYOVER_UNREACHABLE_NOTICE,
}
export const CARRYOVER_FORK_REFUSED = '这条消息早于改接到新会话，当前会话中没有它的原生记录，请从改接之后的消息分支'
export type Effort = (typeof EFFORTS)[number]
export type WorkerStatus =
  | 'queued'
  | 'running'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'uncertain'
/** The Worker's plan switch: `plan` runs the CLI in its native plan mode. */
export type TaskMode = 'plan' | 'accept-edits'
/** Worker permission level: first item (ask), middle, full. Capped by the parent per run. */
export type WorkerLevel = 'ask' | 'auto' | 'full'
export interface Preference {
  /** Missing in v0.1.x data means Antigravity. */
  cli?: CliId
  model: string
  effort: Effort
}
export interface ModelChoice {
  id: string
  label: string
  /** Explicit native cost evidence only; missing/default zero prices are unknown. */
  cost?: 'free' | 'paid' | 'unknown'
  efforts?: Effort[]
  /** Exact CLI model IDs for the supported effort variants. */
  variants?: Partial<Record<Effort, string>>
}
/** User-editable role library. Prompts are user instructions, never executable HTML. */
export interface RolePreset {
  id: string
  name: string
  summary: string
  prompt: string
  builtin?: boolean
  source?: string
}
/** Frozen when a worker is created; library edits cannot change an existing conversation. */
export interface RoleSnapshot {
  presetId?: string
  name: string
  summary: string
  prompt: string
}
export interface Worker {
  id: string
  parentSessionId: string
  project: string
  title: string
  agentName?: string
  /** Provenance distinguishes automatic names from user-supplied lookalikes. */
  agentNameOrigin?: 'auto' | 'custom'
  /** Exact former automatic names reserved for compatible historical references. */
  nameAliases?: string[]
  /** Reversible deletion keeps the original Worker, native session and account binding. */
  archivedAt?: string
  role?: RoleSnapshot
  preference: Preference
  mode: TaskMode
  /** The user's chosen level; missing means full, i.e. follow the parent conversation. */
  level?: WorkerLevel
  conversationId?: string
  /** Native sessions this task left when it continued in a new session under another account. */
  previousConversationIds?: string[]
  /** The session rebound to the current account and not yet shown to resume under it;
   * a later turn may still carry it over to a new session. */
  reboundConversationId?: string
  /** Run in which the current session replaced the one before it; earlier runs belong to older sessions. */
  carryoverRunId?: string
  /** A session receipt is replaced, never added to another invocation's cumulative receipt. */
  conversationTelemetry?: ConversationTelemetryCheckpoint
  /** Final cumulative usage of native sessions this task left after an account change;
   * the task's displayed session usage adds it to the current session's receipt. */
  previousSessionUsage?: import('./telemetry.ts').TokenUsage
  /** Last full run receipt, kept independently from session cumulative accounting. */
  lastRunUsageSnapshot?: LastRunUsageSnapshot
  /** Last verified native window; never derived from cumulative accounting. */
  contextTelemetry?: ContextTelemetryCheckpoint
  /** Changing the selected model invalidates this run's context, including after restart. */
  contextInvalidatedRunId?: string
  /** Harness owns this child; the CLI's native conversationId remains separate. */
  harnessConversation?: HarnessConversationBinding
  /** Native transport is pinned per Worker; missing values retain legacy sessions. */
  transport?: string
  /** Plugin-owned persistent objective, injected into each turn (see conversation-features.ts). */
  goal?: import('./conversation-features.ts').WorkerGoal
  /** Last goal revision; kept after clearing so a stale request cannot match a new goal. */
  goalRevision?: number
  status: WorkerStatus
  createdAt: string
  updatedAt: string
  runId: string
  jobId?: string
  error?: string
  /** User-requested stop confirmed after the owned process range exited. */
  interruptionReason?: 'user'
  observedModel?: string
  lastResult?: string
  /** Plugin-owned project copy this conversation runs in; see isolated-workspace.ts. */
  isolation?: WorkerIsolation
  /** Why the last turn waited for the main directory instead of using a copy. */
  isolationNotice?: string
  /** Set on a completed turn whose CLI recovered from failed tool steps. */
  resultNotice?: string
  /** CLI authorization requests of the running turn still awaiting a DSH answer. */
  approvalWaiting?: number
}
/**
 * `released` keeps the conversation bound to its copy path after merge or
 * discard: native CLI sessions are tied to their working directory.
 */
export interface WorkerIsolation {
  state: 'preparing' | 'ready' | 'merging' | 'conflict' | 'released'
  path: string
  createdAt?: string
  conflicts?: { path: string; reason: string }[]
  skippedLinks?: number
  message?: string
}
export type HarnessConversationFeature = 'send' | 'queue' | 'steer' | 'stop' | 'model' | 'permission' | 'plan' | 'attachments' | 'fork' | 'forkEarlier' | 'goal' | 'feedback' | 'skills' | 'tools'
export interface HarnessConversationBinding {
  sessionId: string
  parentSessionId: string
  mode: 'continuable'
  capabilities: Record<HarnessConversationFeature, boolean>
  reasons?: Partial<Record<HarnessConversationFeature, string>>
}
/** Exact legacy stop messages are compatible; other interrupted outcomes stay diagnostic. */
export const isUserInterrupted = (worker: Pick<Worker, 'status' | 'error' | 'interruptionReason'>) =>
  worker.status === 'interrupted' &&
  ((worker.interruptionReason === 'user' && !worker.error) ||
    ['Error: 用户已停止任务', '用户已取消排队任务'].includes(worker.error ?? ''))
/** Stable, non-mutating name for histories created before named workers. */
export const workerName = (worker: Worker): string => worker.agentName || `智能体-${worker.id.slice(0, 6)}`
export type DeliveryState =
  | 'pending'
  | 'admitted'
  | 'running'
  | 'superseded'
  | 'cancelled'
  | 'failed'
  | 'completed'
/** Only explicitly published native tool fields; absent identity never creates a parent edge. */
export interface PublicToolCall {
  callId?: string
  parentCallId?: string
  name?: string
  input?: unknown
  output?: unknown
  command?: string
  exitCode?: number
}
/** One proven CLI model response. Counts are disjoint, never run/session totals. */
export interface NativeResponseUsage {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}
export interface NativeResponseIdentity {
  id: string
  blockId: string
  index: number
  /** The producer observed the response boundary, not merely one display row ending. */
  complete?: true
  usage?: NativeResponseUsage
}
export interface WorkerEvent {
  requestState?: import('./native-request-state.ts').NativeRequestState
  seq: number
  runId: string
  time: string
  kind: 'user' | 'assistant' | 'reasoning' | 'tool' | 'status' | 'diagnostic' | 'result' | 'submission'
  text: string
  observedModel?: string
  step?: number
  state?: string
  detail?: string
  /** A running step's new output or public reasoning only; the timeline appends it. */
  delta?: string
  /** Shown content was cut to the display budget; the full content stays with the CLI. */
  truncated?: true
  /** Byte size of the largest cut content, when known. */
  outputBytes?: number
  toolCall?: PublicToolCall
  response?: NativeResponseIdentity
  /** Whether the terminal body covers all response segments or only the final response. */
  resultScope?: 'run' | 'response'
  /** Exact persisted outbox item admitted into this run; admission is not native delivery. */
  queuedFollowupId?: string
  /** Submission intent is distinct from a native run. */
  deliveryState?: DeliveryState
  deliveryError?: string
  admittedRunId?: string
  submissionClientId?: string
  submissionSequence?: number
}
export interface TimelineItem {
  response?: NativeResponseIdentity
  /** Exact run credits appear only on its final reply. */
  providerCredits?: number
  usage?: TokenUsage
  /** Duration reported for this individual response step; never added to session totals. */
  durationSeconds?: number
  /** Upstream AGY conversation total, distinct from the locally timed run. */
  sessionDurationSeconds?: number
  id: string
  kind: WorkerEvent['kind']
  text: string
  time: string
  state?: string
  detail?: string
  truncated?: true
  outputBytes?: number
  toolCall?: PublicToolCall
  queuedFollowupId?: string
  deliveryState?: DeliveryState
  deliveryError?: string
  admittedRunId?: string
  submissionClientId?: string
  submissionSequence?: number
  /** Run ended without a final tool status; the observed CLI state stays intact. */
  runStatus?: WorkerStatus
  runStartedAt?: string
  runEndedAt?: string
  runOutcome?: WorkerStatus
}
export interface QueuedFollowup {
  id: string
  prompt: string
  createdAt: string
  state: 'pending' | 'sending' | 'paused'
  pauseReason?: string
}
export interface WorkerSnapshot {
  /** Saved interface language; absent means follow the DSH language. */
  language?: import('./cli-settings.ts').LanguagePreference
  externalRequestState?: import('./native-request-state.ts').ExternalRequestState
  /** Exact selected child turn/run totals; never added to native response usage. */
  externalTurnUsage?: import('./native-turn-usage.ts').ExternalTurnUsage
  externalTurnAnswer?: import('./native-turn-answer.ts').ExternalTurnAnswer
  /** Includes early acceptance, preparation, pending work and process cleanup. */
  selectedBusy?: boolean
  selectedBusyReason?: 'accepting' | 'preparing' | 'queued' | 'running' | 'stopping' | 'priority'
  telemetry?: Telemetry
  workers: Worker[]
  archivedWorkers?: Worker[]
  selected?: Worker
  /** Safe selected-Worker admission information; never exposes account identities. */
  resumeBlockedReason?: string
  /** Accepted messages for the selected Worker; not delivered to the CLI yet. */
  queuedFollowups?: QueuedFollowup[]
  /** Current project/CLI preference for submissions during an active turn. */
  runningMessageMode?: RunningMessageMode
  runningMessageModeReason?: string
  timeline: TimelineItem[]
  revision: number
  truncated: boolean
}
/** A bounded, frozen reading page; indexes/count refer to the moment it was read. */
export interface HistoryPage {
  workerId: string
  items: TimelineItem[]
  start: number
  end: number
  total: number
  hasOlder: boolean
  hasNewer: boolean
}
export const active = (status: WorkerStatus) =>
  status === 'queued' || status === 'running' || status === 'stopping'

/** Fold repeated step updates without duplicating streamed text or the final response. */
/** Binary units, matching the configured byte budgets. */
export function outputSizeLabel(bytes: number) {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}
/** Source text of the truncation marker; the Client translates the same keys. */
export const TRUNCATED_SIZED = '输出已截断（共 {size}），完整内容见 CLI 原生会话或实际产物'
export const TRUNCATED_PLAIN = '输出已截断，完整内容见 CLI 原生会话或实际产物'
export function truncationNote(row: { truncated?: true; outputBytes?: number }) {
  if (!row.truncated) return ''
  return row.outputBytes ? TRUNCATED_SIZED.replace('{size}', outputSizeLabel(row.outputBytes)) : TRUNCATED_PLAIN
}
function appendDelta(row: TimelineItem, delta: string) {
  if (row.kind !== 'tool') {
    row.detail = (row.detail ?? '') + delta
    return
  }
  const output = row.toolCall?.output
  row.toolCall = { ...row.toolCall, output: (typeof output === 'string' ? output : '') + delta }
}
export function foldEvents(
  events: readonly WorkerEvent[],
  endedRun?: { runId: string; status: WorkerStatus },
  cli?: CliId,
): TimelineItem[] {
  const rows: TimelineItem[] = []
  const steps = new Map<string, TimelineItem>()
  const submissions = new Map<string, TimelineItem>()
  const submissionIds = new Set(
    events.filter((event) => event.kind === 'submission').map((event) => event.queuedFollowupId),
  )
  const markEnded = (runId: string, status: WorkerStatus) => {
    for (const row of rows) {
      if (
        (row.kind === 'tool' || row.kind === 'reasoning') &&
        row.id.startsWith(runId + ':') &&
        ['ACTIVE', 'RUNNING', 'PENDING', 'QUEUED', 'IN_PROGRESS'].includes(row.state ?? '')
      )
        row.runStatus = status
    }
  }
  for (const event of events) {
    if (event.kind === 'submission' && event.queuedFollowupId) {
      const row = submissions.get(event.queuedFollowupId) ?? {
        id: `submission:${event.queuedFollowupId}`,
        kind: 'user' as const,
        text: event.text,
        time: event.time,
        queuedFollowupId: event.queuedFollowupId,
      }
      if (!submissions.has(event.queuedFollowupId)) rows.push(row)
      Object.assign(row, {
        deliveryState: event.deliveryState,
        deliveryError: event.deliveryError,
        admittedRunId: event.admittedRunId,
        submissionClientId: event.submissionClientId,
        submissionSequence: event.submissionSequence,
      })
      submissions.set(event.queuedFollowupId, row)
      continue
    }
    if (event.kind === 'user' && event.queuedFollowupId && submissionIds.has(event.queuedFollowupId)) continue
    if (event.kind === 'status') {
      const terminal = event.state ?? event.text
      if (
        terminal === 'completed' ||
        terminal === 'failed' ||
        terminal === 'interrupted' ||
        terminal === 'uncertain'
      )
        markEnded(event.runId, terminal)
    }
    if (event.kind === 'result') {
      // A failed aggregate is diagnostic evidence, not a replacement for
      // already observed text (including histories written by older versions).
      if (cli === 'antigravity' && event.state && event.state !== 'SUCCESS') {
        rows.push({
          id: `${event.runId}:event:${event.seq}`,
          kind: 'diagnostic',
          text: 'CLI 最终汇总',
          time: event.time,
          state: event.state,
          detail: event.detail ?? event.text,
        })
        continue
      }
      const lastAssistant = rows.findLast(
        (row) => row.kind === 'assistant' && row.id.startsWith(event.runId + ':'),
      )
      if (lastAssistant) {
        // An aggregate receipt cannot extend a response with its own explicit
        // content identity and boundary. Its body may include earlier calls.
        if (lastAssistant.response) continue
        const earlier = rows.filter(
          (row) => row !== lastAssistant && row.kind === 'assistant' && row.id.startsWith(event.runId + ':'),
        )
        let finalText: string | undefined = event.text
        if (earlier.length && event.resultScope === 'run') {
          const prefix = earlier.map((row) => row.text).join('')
          // An explicit aggregate must agree with every observed segment.
          finalText = event.text.startsWith(prefix) ? event.text.slice(prefix.length) : undefined
        } else if (earlier.length && !event.resultScope && cli === 'antigravity') {
          // Older AGY aggregates insert whitespace between response steps.
          // This compatibility rule is confined to that verified CLI format.
          let remaining = event.text.trimStart()
          for (const row of earlier) {
            const prefix = row.text.trim()
            if (!prefix) continue
            if (!remaining.startsWith(prefix)) {
              remaining = ''
              break
            }
            remaining = remaining.slice(prefix.length).trimStart()
          }
          finalText = remaining || undefined
        } else if (earlier.length && !event.resultScope && !event.text.startsWith(lastAssistant.text)) {
          // Historical receipts without scope cannot prove an aggregate boundary.
          finalText = undefined
        }
        if (event.text && finalText !== undefined && finalText.startsWith(lastAssistant.text))
          lastAssistant.text = finalText
        continue
      }
    }
    const key = event.response
      ? `${event.runId}:response:${JSON.stringify([event.response.id, event.response.blockId])}`
      : event.step === undefined
        ? `${event.runId}:event:${event.seq}`
        : `${event.runId}:${event.kind}:${event.step}`
    const existing = steps.get(key)
    if (existing) {
      if (event.response && (existing.kind !== event.kind || existing.response?.index !== event.response.index))
        throw new Error('CLI response block identity changed')
      if (event.response?.usage && existing.response?.usage &&
        JSON.stringify(event.response.usage) !== JSON.stringify(existing.response.usage))
        throw new Error('CLI response usage changed')
      if (event.kind === 'assistant') existing.text += event.text
      else if (event.text) existing.text = event.text
      if (event.state) existing.state = event.state
      if (event.response) existing.response = { ...existing.response, ...event.response }
      if (event.toolCall)
        existing.toolCall = {
          ...existing.toolCall,
          ...Object.fromEntries(Object.entries(event.toolCall).filter(([, value]) => value !== undefined)),
        }
      // Public reasoning carries a complete visible-text snapshot. An empty
      // snapshot can withdraw a block; never append or retain its older text.
      if (event.detail || (event.kind === 'reasoning' && event.detail !== undefined))
        existing.detail = event.detail
      // Increments extend the shown output (tools) or visible reasoning; a later
      // snapshot above or a completed output replaces them.
      if (event.delta) appendDelta(existing, event.delta)
      if (event.truncated) existing.truncated = true
      if (event.outputBytes) existing.outputBytes = Math.max(existing.outputBytes ?? 0, event.outputBytes)
    } else {
      const row: TimelineItem = {
        id: key,
        kind: event.kind === 'result' ? 'assistant' : event.kind,
        text: event.text,
        time: event.time,
        state: event.state,
        detail: event.detail,
        toolCall: event.toolCall,
        response: event.response,
        queuedFollowupId: event.queuedFollowupId,
        admittedRunId: event.admittedRunId,
        ...(event.truncated ? { truncated: true as const } : {}),
        ...(event.outputBytes ? { outputBytes: event.outputBytes } : {}),
      }
      if (event.delta) appendDelta(row, event.delta)
      steps.set(key, row)
      rows.push(row)
    }
  }
  // Use full persisted events before pagination. Duration includes admission/queue time.
  const timing = new Map<string, { runStartedAt?: string; runEndedAt?: string; runOutcome?: WorkerStatus }>()
  for (const event of events) {
    const run = timing.get(event.runId) ?? {}
    if (
      (event.kind === 'user' || (event.kind === 'status' && (event.state ?? event.text) === 'queued')) &&
      !run.runStartedAt
    )
      run.runStartedAt = event.time
    if (
      event.kind === 'status' &&
      ['completed', 'failed', 'interrupted', 'uncertain'].includes(event.state ?? event.text)
    ) {
      run.runEndedAt = event.time
      run.runOutcome = (event.state ?? event.text) as WorkerStatus
    }
    timing.set(event.runId, run)
  }
  for (const row of rows) Object.assign(row, timing.get(row.admittedRunId ?? row.id.split(':')[0]!))
  if (endedRun) markEnded(endedRun.runId, endedRun.status)
  return rows
}
