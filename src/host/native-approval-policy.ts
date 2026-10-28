/**
 * CLI permission tier and authorization decisions derived from the parent
 * conversation's DSH permission state. Pure: callers read DSH services.
 */
import type { TaskMode } from '../shared/types.ts'

/** DSH sandbox modes; also the CLI access tier a run is launched with. */
export type NativeAccess = 'read-only' | 'workspace-write' | 'danger-full-access'
export type ApprovalPolicy = 'ask' | 'never'
/** Who started this run: the parent model's tool call, or the user in the Worker UI. */
export type RunOrigin = 'agent' | 'user'

export interface NativeApprovalRequest {
  kind: 'command' | 'file' | 'network' | 'permission' | 'tool' | 'other'
  summary: string
  detail?: string
  /** The CLI natively offers a session-wide grant for this request. */
  allowSession: boolean
}
export type ApprovalDecisionSource =
  | 'user'
  | 'full-access'
  | 'plan'
  | 'preset'
  | 'unavailable'
  | 'stopped'
  | 'invalid'
export interface NativeApprovalDecision {
  decision: 'allow-once' | 'allow-session' | 'deny'
  source: ApprovalDecisionSource
}
const KINDS = new Set<string>(['command', 'file', 'network', 'permission', 'tool', 'other'])
/** Host-side check of a runner frame (mirrors the runner's own bound). */
export function parseNativeApprovalRequest(value: unknown): NativeApprovalRequest {
  const request = value as Partial<NativeApprovalRequest> | null
  if (!request || typeof request !== 'object' || !KINDS.has(request.kind as string) ||
    typeof request.summary !== 'string' || !request.summary.trim() || request.summary.length > 500 ||
    (request.detail !== undefined && (typeof request.detail !== 'string' || request.detail.length > 4000)) ||
    typeof request.allowSession !== 'boolean')
    throw new Error('Invalid approval frame')
  return {
    kind: request.kind as NativeApprovalRequest['kind'],
    summary: request.summary,
    ...(request.detail ? { detail: request.detail } : {}),
    allowSession: request.allowSession,
  }
}

/** The parent conversation's permission state at one moment. */
export interface PermissionState {
  /** Harness plan mode on the parent conversation. */
  planMode: boolean
  sandbox: NativeAccess
  approval: ApprovalPolicy
}

/**
 * The access tier a run starts with. Plan wins; otherwise the CLI follows the
 * parent's sandbox. Never wider than the parent.
 */
export function runAccess(mode: TaskMode, state: PermissionState): NativeAccess {
  return mode === 'plan' || state.planMode ? 'read-only' : state.sandbox
}

/**
 * Decide one request from the state current when it arrives. `ask` means the
 * user must answer; every other outcome is final and shows no prompt.
 */
export function decideApproval(
  mode: TaskMode,
  state: PermissionState,
): NativeApprovalDecision | 'ask' {
  if (mode === 'plan' || state.planMode) return { decision: 'deny', source: 'plan' }
  if (state.approval === 'never')
    return state.sandbox === 'danger-full-access'
      ? { decision: 'allow-once', source: 'full-access' }
      : { decision: 'deny', source: 'preset' }
  return 'ask'
}

export const ACCESS_LABELS: Record<NativeAccess, string> = {
  'read-only': '仅可查看',
  'workspace-write': '工作区内修改',
  'danger-full-access': '完全权限',
}
const SOURCE_LABELS: Record<ApprovalDecisionSource, string> = {
  user: 'DSH 用户',
  'full-access': '完全权限自动放行',
  plan: '规划模式',
  preset: '权限预设',
  unavailable: '无人应答',
  stopped: '任务停止',
  invalid: '请求无效',
}
const DECISION_LABELS: Record<NativeApprovalDecision['decision'], string> = {
  'allow-once': '允许一次',
  'allow-session': '本会话始终允许',
  deny: '拒绝',
}
export const APPROVAL_OPTIONS = { once: '允许一次', session: '本会话始终允许', deny: '拒绝' } as const

/** Timeline text for one decision. */
export function approvalDecisionText(decision: NativeApprovalDecision): string {
  return `授权决定：${DECISION_LABELS[decision.decision]}（${SOURCE_LABELS[decision.source]}）`
}

/** Worker approval panel copy; the panel shows it as plain text. */
export function approvalPrompt(
  request: NativeApprovalRequest,
  context: { worker: string; cli: string; project: string },
): string {
  return [
    `${context.worker}（${context.cli}）请求授权：${request.summary}`,
    ...(request.detail ? [request.detail] : []),
    `工作目录：${context.project}`,
  ].join('\n')
}

/**
 * Untrusted text as one literal Markdown paragraph: every ASCII punctuation is
 * escaped, so nothing becomes a link, format or HTML, and each line keeps a hard break.
 */
export function literalMarkdown(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/[!-/:-@[-`{-~]/g, '\\$&'))
    .join('\\\n')
}

/**
 * Parent-page question: offers a session grant only when the CLI natively has one.
 * The card's title collapses line breaks; only `detail` is laid out as paragraphs.
 */
export function approvalQuestion(
  request: NativeApprovalRequest,
  context: { worker: string; cli: string; project: string },
) {
  return {
    id: 'cliworker_approval',
    header: 'CLI 授权',
    question: `${context.worker}（${context.cli}）请求授权`,
    detail: [request.summary, request.detail ?? '', `工作目录：${context.project}`]
      .map(literalMarkdown)
      .filter(Boolean)
      .join('\n\n'),
    options: [
      { label: APPROVAL_OPTIONS.once },
      ...(request.allowSession ? [{ label: APPROVAL_OPTIONS.session }] : []),
      { label: APPROVAL_OPTIONS.deny },
    ],
  }
}

/** Map a question answer; anything but an offered allow label is a denial. */
export function decisionFromAnswer(
  request: NativeApprovalRequest,
  answer: { selected: readonly string[]; custom?: string } | undefined,
): NativeApprovalDecision {
  const selected = answer?.custom === undefined && answer?.selected.length === 1 ? answer.selected[0] : undefined
  if (selected === APPROVAL_OPTIONS.once) return { decision: 'allow-once', source: 'user' }
  if (selected === APPROVAL_OPTIONS.session && request.allowSession)
    return { decision: 'allow-session', source: 'user' }
  return { decision: 'deny', source: 'user' }
}

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** Map a DSH approval outcome from the Worker's native panel. */
export function decisionFromOutcome(outcome: ApprovalOutcome): NativeApprovalDecision {
  if (outcome === 'allowed-once') return { decision: 'allow-once', source: 'user' }
  if (outcome === 'rejected') return { decision: 'deny', source: 'user' }
  return { decision: 'deny', source: outcome === 'cancelled' ? 'stopped' : 'unavailable' }
}

/** Map a decision back to the DSH outcome a tool bridge request is waiting for. */
export function outcomeFromDecision(decision: NativeApprovalDecision): ApprovalOutcome {
  if (decision.decision !== 'deny') return 'allowed-once'
  if (decision.source === 'stopped') return 'cancelled'
  return decision.source === 'unavailable' ? 'unavailable' : 'rejected'
}

const clip = (value: string, limit: number) => (value.length > limit ? `${value.slice(0, limit - 1)}…` : value)

/**
 * Summary of one DSH tool approval raised through the tool bridge. DSH sends
 * the reason but not the command, so the command comes from the call itself.
 * DSH has no session-wide grant.
 */
export function harnessApprovalRequest(
  name: string,
  args: unknown,
  reason: { reason?: string; displayReason?: { readonly [locale: string]: string } },
): NativeApprovalRequest {
  const command = args && typeof args === 'object' ? (args as Record<string, unknown>).command : undefined
  const detail = reason.displayReason?.zh ?? reason.reason
  return {
    kind: 'tool',
    summary: clip(
      typeof command === 'string' && command.trim()
        ? `执行命令（DSH 备选工具 ${name}）：${command}`
        : `使用 DSH 备选工具 ${name}`,
      500,
    ),
    ...(detail?.trim() ? { detail: clip(detail, 4000) } : {}),
    allowSession: false,
  }
}
