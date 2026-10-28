import type { Agent } from '@deepseek-ai/dsh-agent'
import type { HarnessConversationApi } from './harness-conversation-types.ts'
import { forkWorkerConversation, readWorkerForkState, writeWorkerForkState, type NativeForkCut, type ForkHistory, type WorkerForkState } from './worker-fork.ts'
import { readClaudeOwnRoute, prepareClaudeWorkerLaunch } from './claude-own-route.ts'
import { extendedLaunch, isExtendedCli } from './extended-adapters.ts'
import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { z } from 'zod'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import {
  active,
  CLI_IDS,
  CLI_LABELS,
  CLI_SHORT_NAMES,
  CARRYOVER_FAILED_NOTICE,
  CARRYOVER_UNREACHABLE_NOTICE,
  CARRYOVER_FORK_REFUSED,
  LEGACY_ACCOUNT_NOTICES,
  isRetiredCli,
  isUserInterrupted,
  RETIRED_HARNESS_NOTICE,
  cliOf,
  workerName,
  foldEvents,
  type Preference,
  type WorkerEvent,
  type TaskMode,
  type Worker,
  type WorkerSnapshot,
  type HistoryPage,
  type TimelineItem,
  type CliId,
  type RoleSnapshot,
  type QueuedFollowup,
  type DeliveryState,
} from '../shared/types.ts'
import {
  agentNameSchema,
  availableAgentName,
  promptForWorker,
  roleSnapshotSchema,
  workerTitleSchema,
} from './roles.ts'
import { protocolFor, resolveCliExecutable, workerArguments, captureCatalogMetadata } from './adapters.ts'
import { spawnManagedAgent } from './managed-agent.ts'
import { prepareNativeWorker, transportFor, usesNativeBridge } from './native-worker.ts'
import { BridgeProtocol } from './bridge-protocol.ts'
import { mkdirSync } from 'node:fs'
import {
  projectDirectory,
  ProcessCleanupUnconfirmedError,
  type ProcessBackend,
  type RuntimeConfig,
  type TaskTimeLimit,
} from './process.ts'
import { bridgeTimeLimit, remainingMs, taskTimeLimit, timeLimitMessage } from './task-time-limit.ts'
import { join } from 'node:path'
import { AgyContextReader } from './agy-context.ts'
import { attachTelemetry, TelemetryReader } from './telemetry.ts'
import {
  addSessionUsage,
  captureConversationTelemetry,
  captureLastRunUsageSnapshot,
  withConversationTelemetry,
} from './conversation-telemetry.ts'
import { captureContextTelemetry, withContextTelemetry, withoutContextTelemetry } from './context-telemetry.ts'
import { NativeSupplementalContextReader } from './native-supplemental-context.ts'
import { HermesSessionTelemetryReader } from './hermes-session-telemetry.ts'
import { effectiveHermesHome } from './hermes-account-context.ts'
import { NativeTimelineReprojector } from './native-timeline-reprojection.ts'
import { projectPublicToolCall } from './public-tool-projection.ts'
import { WorkerStorage } from './storage.ts'
import { authorizeSelection, ACCOUNT_CHANGED } from './authorized-catalog.ts'
import { ownAccountBusy as accountBusy } from './own-account-lease.mjs'
import { codexRouteEnvironment, readCliAccountBinding } from './cli-account-binding.ts'
import { crossAccountResume, nativeSessionReachable } from './cross-account-resume.ts'
import { carryoverContext } from './carryover-context.ts'
import { assertFirstPartyConfiguration, firstPartyEnvironment } from './first-party-models.ts'
import { agyBackgroundEnvironment } from './agy-background-environment.ts'
import { qoderEnvironment } from './qoder-accounts.ts'
import { AgyProtocol } from './protocol.ts'
import { FollowupQueue } from './followup-queue.ts'
import { supportsWorkerNativeSteering, type RunningMessageMode } from '../shared/running-message.ts'
import type { GeneralSettings } from '../shared/cli-settings.ts'
import type { TokenUsage } from '../shared/telemetry.ts'
import type { NativeHarnessConnection } from './native-harness-tools.ts'
import type { NativeAttachment } from './native-attachments.mjs'
import {
  ACCESS_LABELS,
  approvalDecisionText,
  type NativeAccess,
  type NativeApprovalDecision,
  type NativeApprovalRequest,
} from './native-approval-policy.ts'
import { workerPermissionOptions } from '../shared/worker-permissions.ts'
import { GOAL_OBJECTIVE_LIMIT, type WorkerGoal } from '../shared/conversation-features.ts'
import {
  createIsolatedWorkspace,
  isolatedCopyExists,
  isolationPromptNotice,
  isolationRoot,
  IsolationUnavailableError,
  mergeIsolatedWorkspace,
  type MergeResolution,
  removeIsolatedWorkspace,
  workspacePaths,
  type MergeResult,
} from './isolated-workspace.ts'

interface Task {
  attachments?: readonly NativeAttachment[]
  worker: Worker
  prompt: string
  userPrompt: string
  controller: AbortController
  done: Promise<Worker>
  settle: (worker: Worker) => void
  admission: Promise<string>
  admissionFailure?: { error: unknown }
  queuedFollowupId?: string
  priority?: boolean
  generation: number
  submissionId?: string
  spawnAttempted?: boolean
  preserveFollowups?: boolean
  steer?: (message: string, requestId: string, signal?: AbortSignal) => Promise<void>
  nativeStop?: () => Promise<void>
  nativeStopRequested?: boolean
  /** Mode the CLI actually launched in this run (仅可查看 → plan). */
  launchMode?: TaskMode
  /** Withdraws this run's pending authorization prompts on stop or exit. */
  approvals?: AbortController
  steering: Map<string, { prompt: string; done: Promise<void> }>
  steeringController: AbortController
  /** Admission order; a task returned from a refused copy keeps its place. */
  order: number
  /** Drain chose a plugin-owned copy because the main directory is busy. */
  isolate?: boolean
  /** A copy was refused for this turn; it waits for the main directory instead. */
  isolationRefused?: boolean
  /** CLI and admitted account of this turn, once known. */
  accountKey?: string
  /** The account was held exclusively; queued until its holder ends or a retry is due. */
  accountWait?: { retryAt: number }
  /** The account changed between authorization and spawn once; the turn was authorized again. */
  accountRaceRetried?: boolean
  /** Goal frozen at admission; a carried-over prompt is rebuilt with the same goal. */
  goal?: string
  /** A steering message was handed to a native process of this turn. */
  steerSubmitted?: boolean
  /** The admitted message already reached a native process (queue item removed). */
  delivered?: boolean
  /** The turn continues in a new native session after the original could not be resumed. */
  // A Claude branch that never started has no conversation of its own, only its pending fork.
  carryover?: { previousConversationId?: string; previousSessionUsage?: TokenUsage; forkState?: WorkerForkState }
  /** Fixed when the turn first starts; a carried-over attempt keeps the same deadline. */
  timeLimit?: TaskTimeLimit
}
/** A message for a run whose account has since changed is queued instead of steered. */
class AccountChangedDuringRunError extends Error {
  constructor() {
    super('本轮结束后发送')
  }
}
/** Older records read like current ones: no account-change note survives in a timeline. */
function legacyAccountNotes(events: WorkerEvent[]): WorkerEvent[] {
  return events.flatMap((event) => {
    if (event.kind !== 'diagnostic' || !event.text || !Object.hasOwn(LEGACY_ACCOUNT_NOTICES, event.text)) return [event]
    const text = LEGACY_ACCOUNT_NOTICES[event.text]
    return text ? [{ ...event, text }] : []
  })
}
/** Raised before launch when the original session cannot be resumed under the current account. */
class CarryoverRequiredError extends Error {
  constructor() {
    super('原生会话无法在当前账号续接')
  }
}
function withGoal(goal: string | undefined, prompt: string): string {
  return goal ? `【当前目标】\n${goal}\n【目标结束】\n\n${prompt}` : prompt
}
/** Retry for an account held outside this Host's runs, such as a catalog read. */
const ACCOUNT_RETRY_MS = 2000
/** Internal identity distinguishes deliberate cancellation from timeouts and failures. */
class UserStoppedError extends Error {
  constructor() {
    super('用户已停止任务')
  }
}
export interface Submission {
  worker: Worker
  done: Promise<Worker>
  cancel: () => void
}
export interface QueuedAdmission {
  id: string
  expectedRunId: string
  priority?: boolean
}
interface PriorityMessage {
  id: string
  prompt: string
  createdAt: string
  clientId: string
  sequence: number
  state: DeliveryState
  error?: string
  runId?: string
  spawnAttempted?: boolean
  generation: number
  controller: AbortController
}
const deliveryTerminal = (state: DeliveryState) =>
  ['superseded', 'cancelled', 'failed', 'completed'].includes(state)

/**
 * Record one authorization request on the running turn, wait visibly for its
 * decision and record that. A stop, a newer run or a failure is a denial.
 * Shared by native CLI requests and DSH tool requests from the tool bridge.
 */
async function trackApproval(
  runtime: Pick<WorkerRuntime, 'storage' | 'changed'>,
  task: Task,
  request: NativeApprovalRequest,
  decide: (signal: AbortSignal, mode: TaskMode) => Promise<NativeApprovalDecision>,
  /** The asker's own cancellation, such as the DSH tool call's. */
  asker?: AbortSignal,
): Promise<NativeApprovalDecision> {
  const { worker, controller } = task
  const runId = worker.runId
  const approvals = task.approvals ?? new AbortController()
  const signal = AbortSignal.any([controller.signal, approvals.signal, ...(asker ? [asker] : [])])
  // Stopping starts before the controller aborts; deny from that moment.
  const withdrawn = () => signal.aborted || !!task.nativeStopRequested
  runtime.storage.append(worker, {
    kind: 'status',
    text: `CLI 请求授权：${request.summary}`,
    ...(request.detail ? { detail: request.detail } : {}),
  })
  worker.approvalWaiting = (worker.approvalWaiting ?? 0) + 1
  runtime.changed()
  let decided: NativeApprovalDecision
  if (withdrawn()) decided = { decision: 'deny', source: 'stopped' }
  else
    try {
      decided = await decide(signal, task.launchMode ?? worker.mode)
    } catch {
      decided = { decision: 'deny', source: withdrawn() ? 'stopped' : 'unavailable' }
    }
  const current = worker.runId === runId
  const decision: NativeApprovalDecision = withdrawn() || !current ? { decision: 'deny', source: 'stopped' } : decided
  if (worker.approvalWaiting) worker.approvalWaiting -= 1
  if (!worker.approvalWaiting) delete worker.approvalWaiting
  if (current) runtime.storage.append(worker, { kind: 'status', text: approvalDecisionText(decision) })
  runtime.changed()
  return decision
}

export class WorkerRuntime {
  private harnessPreparation?: (
    worker: Worker,
    signal: AbortSignal,
    input: { submissionId?: string; isolated?: boolean; access?: NativeAccess },
  ) => Promise<{ connection?: NativeHarnessConnection; close(): Promise<void> } | undefined>
  setHarnessPreparation(prepare: NonNullable<WorkerRuntime['harnessPreparation']>): () => void {
    this.harnessPreparation = prepare
    return () => {
      if (this.harnessPreparation === prepare) this.harnessPreparation = undefined
    }
  }
  private approvalHandler?: (
    worker: Worker,
    request: NativeApprovalRequest,
    signal: AbortSignal,
    /** The run's launch mode, which decisions must not exceed. */
    mode: TaskMode,
  ) => Promise<NativeApprovalDecision>
  /** Host decision for each native authorization request; absent denies. */
  setApprovalHandler(handler: NonNullable<WorkerRuntime['approvalHandler']>): () => void {
    this.approvalHandler = handler
    return () => {
      if (this.approvalHandler === handler) this.approvalHandler = undefined
    }
  }
  private accessSnapshot?: (worker: Worker) => NativeAccess | undefined
  /** Parent DSH permission tier, read once when a turn launches. */
  setAccessSnapshot(read: NonNullable<WorkerRuntime['accessSnapshot']>): () => void {
    this.accessSnapshot = read
    return () => {
      if (this.accessSnapshot === read) this.accessSnapshot = undefined
    }
  }
  /**
   * Relay one native authorization request to the Host decision and answer the
   * runner. Every path answers: a missing handler, failure or stop is a denial.
   */
  private relayApproval(
    task: Task,
    request: NativeApprovalRequest,
    answer: (decision: NativeApprovalDecision) => Promise<void>,
  ): void {
    const { worker } = task
    const runId = worker.runId
    const withdrawn = () =>
      task.controller.signal.aborted || !!task.approvals?.signal.aborted || !!task.nativeStopRequested
    const handler = this.approvalHandler
    void trackApproval(this, task, request, (signal, mode) =>
      handler ? handler(worker, request, signal, mode) : Promise.resolve({ decision: 'deny', source: 'unavailable' }),
    ).then(async (decision) => {
      await answer(decision).catch(() => {
        // The runner denies on its own once its bridge or run ends.
        if (worker.runId === runId && !withdrawn())
          this.storage.append(worker, { kind: 'diagnostic', text: '授权决定未送达 CLI，CLI 按拒绝处理' })
      })
    })
  }
  /**
   * Record and decide one DSH tool authorization raised through this Worker's
   * tool bridge during run `runId`, like a native request. Without that
   * running turn it is a denial.
   */
  harnessApproval(
    worker: Worker,
    runId: string,
    request: NativeApprovalRequest,
    signal: AbortSignal,
    decide: (signal: AbortSignal, mode: TaskMode) => Promise<NativeApprovalDecision>,
  ): Promise<NativeApprovalDecision> {
    const task = this.tasks.get(worker.id)
    if (!task || task.worker.runId !== runId || !this.running.has(task))
      return Promise.resolve({ decision: 'deny', source: 'stopped' })
    return trackApproval(this, task, request, decide, signal)
  }
  private agyContextReader = new AgyContextReader()
  private hermesSessionReader = new HermesSessionTelemetryReader()
  private telemetryReader = new TelemetryReader()
  private supplementalContextReader = new NativeSupplementalContextReader(() => { if (!this.disposed) this.changed() })
  private nativeTimelineReprojector = new NativeTimelineReprojector()
  private readonly stagedForks = new Map<string, Worker>()
  private tasks = new Map<string, Task>()
  private queue: Task[] = []
  private running = new Set<Task>()
  private accountRetry?: ReturnType<typeof setTimeout>
  private listeners = new Set<() => void>()
  private disposed = false
  private blocked?: string
  private catalogBlocked = new Map<CliId, string>()
  private followups: FollowupQueue
  private followupDispatches = new Map<
    string,
    {
      id: string
      expectedRunId: string
      generation: number
      controller: AbortController
      done?: Promise<void>
      preserveOnAbort?: boolean
    }
  >()
  private followupRuns = new Set<Promise<void>>()
  private followupLauncher?: (
    worker: Worker,
    item: QueuedFollowup,
    admission: QueuedAdmission,
    signal: AbortSignal,
  ) => Promise<void>
  private queuedExecutionGuard?: (worker: Worker) => void
  private preparations = new Map<string, { id: string; controller: AbortController; done: Promise<void> }>()
  private priorityHistory = new Map<string, Map<string, PriorityMessage>>()
  private latestPriority = new Map<string, PriorityMessage>()
  private priorityRunners = new Map<string, Promise<void>>()
  private reservations = new Map<
    string,
    Map<string, { generation: number; controller: AbortController; leases: number }>
  >()
  private stopOperations = new Map<string, Set<symbol>>()
  /** Merge or discard of a Worker's copy; excludes sends and management. */
  private isolationOperations = new Map<string, { kind: 'merging' | 'discarding'; done: Promise<unknown> }>()
  /** Projects whose main directory a merge is writing. */
  private mainWrites = new Set<string>()
  private admissions = 0
  revision = 0
  constructor(
    readonly storage: WorkerStorage,
    private backend: ProcessBackend,
    readonly config: RuntimeConfig,
  ) {
    try {
      this.followups = new FollowupQueue(storage)
    } catch (error) {
      storage.close()
      throw error
    }
    // Submission events are authoritative even if a crash happened before the outbox write.
    for (const worker of storage.workers.values()) {
      const messages = new Map<string, PriorityMessage>()
      for (const event of storage.history(worker.id)) {
        if (
          event.kind !== 'submission' ||
          !event.queuedFollowupId ||
          !event.deliveryState ||
          !event.submissionClientId ||
          event.submissionSequence === undefined
        )
          continue
        const previous = messages.get(event.queuedFollowupId)
        messages.set(event.queuedFollowupId, {
          id: event.queuedFollowupId,
          prompt: event.text,
          createdAt: previous?.createdAt ?? event.time,
          clientId: event.submissionClientId,
          sequence: event.submissionSequence,
          state: event.deliveryState,
          error: event.deliveryError,
          runId: event.admittedRunId,
          generation: this.followups.generation(worker.id),
          controller: new AbortController(),
        })
      }
      if (messages.size) this.priorityHistory.set(worker.id, messages)
      for (const message of messages.values()) {
        this.followups.consume(worker.id, message.prompt, message.id)
        if (!deliveryTerminal(message.state))
          this.updatePriority(worker, message, 'cancelled', 'Host 已重启，本条消息未自动重发')
      }
    }
    const cleanup = storage.cleanupBlockState()
    if (cleanup !== 'none')
      this.blocked =
        cleanup === 'invalid'
          ? '进程清理隔离记录无法核验，已暂停任务和账号操作'
          : '无法确认 CLI 进程已清理，已暂停后续派遣，请先核查进程退出状态'
    for (const cli of CLI_IDS) {
      const state = storage.cleanupBlockState(cli)
      if (state !== 'none') this.catalogBlocked.set(cli, state === 'invalid'
        ? `${CLI_LABELS[cli]} 元数据清理记录无法核验，已暂停此 CLI`
        : `${CLI_LABELS[cli]} 元数据进程清理尚未确认，已暂停此 CLI`)
    }
    for (const worker of storage.workers.values()) this.recoverIsolation(worker)
  }
  /** Settles copies left by an earlier Host process; never deletes a ready copy. */
  private recoverIsolation(worker: Worker): void {
    const isolation = worker.isolation
    if (!isolation) return
    const root = isolationRoot(this.storage.directory)
    let next: Worker['isolation'] = isolation
    if (isolation.state === 'preparing') {
      // An unfinished copy has no reliable baseline. The CLI never ran in it.
      rmSync(join(root, worker.id), { recursive: true, force: true })
      next = worker.conversationId ? { state: 'released', path: isolation.path } : undefined
    } else if (isolation.state === 'merging')
      next = { ...isolation, state: 'ready', message: '上次合并在 Host 关闭时中断，可重新合并；已写回的文件会被跳过' }
    if (next && next.state !== 'released' && !isolatedCopyExists(root, worker.id, worker.project))
      next = { ...next, message: '隔离副本目录已缺失，只能丢弃' }
    if (next === isolation) return
    worker.isolation = next
    this.storage.save(worker)
  }
  /** Explicit construction policy is overridable by legacy protocol regression fixtures. */
  protected initialTransport(cli: CliId): string | undefined {
    return transportFor(cli)
  }
  setFollowupLauncher(launch: NonNullable<WorkerRuntime['followupLauncher']>): void {
    this.followupLauncher = launch
  }
  setQueuedExecutionGuard(guard: (worker: Worker) => void): void {
    this.queuedExecutionGuard = guard
  }
  /** Reserve before the Gateway's first await. This never grants execution authority. */
  reserveSubmission(parent: string, id: string, requestId: string) {
    const worker = this.get(parent, id)
    this.assertCliEnabled(cliOf(worker.preference))
    z.uuid().parse(requestId)
    const entries = this.reservations.get(id) ?? new Map()
    const entry = entries.get(requestId) ?? {
      generation: this.followups.generation(id),
      controller: new AbortController(),
      leases: 0,
    }
    entry.leases++
    entries.set(requestId, entry)
    this.reservations.set(id, entries)
    this.changed()
    let released = false
    return {
      signal: entry.controller.signal,
      assertCurrent: () => {
        entry.controller.signal.throwIfAborted()
        if (this.disposed || entry.generation !== this.followups.generation(id)) throw new UserStoppedError()
      },
      release: () => {
        if (released || entries.get(requestId) !== entry) return
        released = true
        if (--entry.leases) return
        entries.delete(requestId)
        if (!entries.size && this.reservations.get(id) === entries) this.reservations.delete(id)
        this.changed()
        const current = this.storage.workers.get(id)
        if (current && !current.archivedAt) this.dispatchFollowup(current)
      },
    }
  }
  directMessageReceipt(parent: string, id: string, prompt: string, requestId: string) {
    const worker = this.get(parent, id)
    z.uuid().parse(requestId)
    const event = this.storage
      .history(id)
      .find((entry) => entry.kind === 'user' && entry.queuedFollowupId === requestId)
    if (!event) return undefined
    if (event.text !== prompt) throw new Error('重复提交标识对应的消息不同')
    return {
      workerId: id,
      runId: event.runId,
      ...(event.runId === worker.runId && worker.jobId ? { jobId: worker.jobId } : {}),
    }
  }
  private accepting(id: string): boolean {
    return [...(this.reservations.get(id)?.values() ?? [])].some((entry) => !entry.controller.signal.aborted)
  }
  private busyReason(worker: Worker, preparationId?: string): WorkerSnapshot['selectedBusyReason'] {
    if (this.stopOperations.get(worker.id)?.size || worker.status === 'stopping') return 'stopping'
    if (this.latestPriority.has(worker.id) || this.priorityRunners.has(worker.id)) return 'priority'
    if (
      (this.preparations.has(worker.id) && this.preparations.get(worker.id)!.id !== preparationId) ||
      this.followupDispatches.has(worker.id)
    ) return 'preparing'
    if (this.tasks.has(worker.id) || active(worker.status))
      return worker.status === 'queued' ? 'queued' : 'running'
    if (this.accepting(worker.id)) return 'accepting'
    if (this.followups.list(worker.id).some((item) => item.state !== 'paused')) return 'queued'
    return undefined
  }
  /** RPC cancellation can settle at the client before native metadata exits. Stop owns this wait. */
  async prepareFollowup<T>(
    parent: string,
    id: string,
    signal: AbortSignal,
    prepare: (signal: AbortSignal, preparationId: string) => Promise<T>,
    priorityId?: string,
  ): Promise<T> {
    const worker = this.get(parent, id)
    this.assertManagedIdle(worker, priorityId)
    this.assertCliEnabled(cliOf(worker.preference))
    signal.throwIfAborted()
    let settle!: () => void
    const entry = {
      id: randomUUID(),
      controller: new AbortController(),
      done: new Promise<void>((resolve) => {
        settle = resolve
      }),
    }
    this.preparations.set(id, entry)
    this.changed()
    try {
      return await prepare(AbortSignal.any([signal, entry.controller.signal]), entry.id)
    } catch (error) {
      if (error instanceof ProcessCleanupUnconfirmedError) {
        this.blockCatalogOnCleanup(cliOf(worker.preference), error)
      }
      throw error
    } finally {
      if (this.preparations.get(id) === entry) this.preparations.delete(id)
      settle()
      this.changed()
    }
  }
  async sendRunningMessage(
    parent: string,
    id: string,
    prompt: string,
    expectedRunId: string,
    requestId: string,
    signal?: AbortSignal,
    requestedMode?: RunningMessageMode,
  ): Promise<QueuedFollowup | undefined> {
    const worker = this.get(parent, id)
    this.assertCliEnabled(cliOf(worker.preference))
    const mode =
      requestedMode ?? this.storage.runningMessageSettings(worker.project, cliOf(worker.preference)).mode
    if (
      mode === 'interrupt' &&
      (this.priorityHistory.get(id)?.has(requestId) || !this.followups.receipt(id, prompt, requestId))
    ) {
      this.interruptMessage(parent, id, prompt, requestId, requestId, 1, signal)
      return {
        id: requestId,
        prompt,
        createdAt: new Date().toISOString(),
        state: 'sending',
      }
    }
    if (worker.runId !== expectedRunId && (!requestedMode || mode === 'steer'))
      throw new Error('本轮状态已变化，请刷新后重新发送')
    signal?.throwIfAborted()
    if (mode === 'queue' && this.priorityHistory.get(id)?.has(requestId))
      return this.queueFollowup(parent, id, prompt, expectedRunId, requestId, !!requestedMode)
    const priorSteer = this.tasks.get(id)?.steering.get(requestId)
    if (priorSteer) {
      if (priorSteer.prompt !== prompt) throw new Error('重复提交标识对应的消息不同')
      return this.steerOrQueue(priorSteer.done, parent, id, prompt, expectedRunId, requestId)
    }
    const receipt = this.followups.receipt(id, prompt, requestId)
    if (receipt) {
      // A steer queued after an account change answers its retries with the same queue item.
      if (requestedMode === 'steer' && receipt.delivery !== 'steer' && !(receipt.delivery === 'queue' && receipt.item))
        throw new Error('这条消息已经以其他方式提交，请刷新会话')
      if (receipt.delivery === 'steer') {
        if (receipt.acknowledged) return
        throw Object.assign(new Error('该引导请求已提交，接收状态尚未确认，请核查本轮记录'), {
          code: 'STEER_UNKNOWN',
        })
      }
      if (!receipt.item) throw new Error('这条消息已经处理，请刷新会话')
      return receipt.item
    }
    if (mode === 'queue')
      return this.queueFollowup(parent, id, prompt, expectedRunId, requestId, !!requestedMode)
    return this.steerMessage(parent, id, prompt, expectedRunId, requestId, signal)
  }
  /** Current-run native input only. Queue state and queue generations never admit or order steering. */
  async steerMessage(
    parent: string,
    id: string,
    prompt: string,
    expectedRunId: string,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<QueuedFollowup | undefined> {
    const worker = this.get(parent, id)
    this.assertCliEnabled(cliOf(worker.preference))
    z.uuid().parse(requestId)
    if (!prompt.trim() || prompt.length > 100_000) throw new Error('消息须包含 1–100000 个字符')
    if (worker.runId !== expectedRunId) throw new Error('本轮状态已变化，请刷新后重新发送')
    signal?.throwIfAborted()
    const prior = this.tasks.get(id)?.steering.get(requestId)
    if (prior) {
      if (prior.prompt !== prompt) throw new Error('重复提交标识对应的消息不同')
      return this.steerOrQueue(prior.done, parent, id, prompt, expectedRunId, requestId)
    }
    const receipt = this.followups.receipt(id, prompt, requestId)
    if (receipt) {
      // A steer queued after an account change answers its retries with the same queue item.
      if (receipt.delivery === 'queue' && receipt.item) return receipt.item
      if (receipt.delivery !== 'steer') throw new Error('这条消息已经以其他方式提交，请刷新会话')
      if (receipt.acknowledged) return
      throw Object.assign(new Error('该引导请求已提交，接收状态尚未确认，请核查本轮记录'), {
        code: 'STEER_UNKNOWN',
      })
    }
    return this.steerOrQueue(
      this.steerRunningMessage(worker, prompt, requestId, signal),
      parent, id, prompt, expectedRunId, requestId,
    )
  }
  /** Every caller of one steer request gets the same queue item once the run's account changed. */
  private async steerOrQueue(
    steering: Promise<void>,
    parent: string,
    id: string,
    prompt: string,
    expectedRunId: string,
    requestId: string,
  ): Promise<QueuedFollowup | undefined> {
    try {
      await steering
    } catch (error) {
      if (!(error instanceof AccountChangedDuringRunError)) throw error
      return this.queueFollowup(parent, id, prompt, expectedRunId, requestId)
    }
  }
  private async steerRunningMessage(
    worker: Worker,
    prompt: string,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    z.uuid().parse(requestId)
    if (!prompt.trim() || prompt.length > 100_000) throw new Error('消息须包含 1–100000 个字符')
    const task = this.tasks.get(worker.id)
    if (!task?.steer || task.controller.signal.aborted || worker.status !== 'running')
      throw new Error('当前 CLI 引导通路尚未准备好或已经结束，请保留消息稍后重试')
    const prior = task.steering.get(requestId)
    if (prior) {
      if (prior.prompt !== prompt) throw new Error('重复提交标识对应的消息不同')
      return prior.done
    }
    if (task.steering.size >= 200) throw new Error('本轮引导消息过多，请等待本轮结束后再发送')
    const snapshot = structuredClone(worker)
    const control = AbortSignal.any([
      task.controller.signal,
      task.steeringController.signal,
      ...(signal ? [signal] : []),
    ])
    let submitted = false
    const done = (async () => {
      this.queuedExecutionGuard?.(worker)
      const binding = this.storage.accountBinding(worker.id)
      const current = await readCliAccountBinding(
        cliOf(worker.preference),
        this.backend,
        this.config,
        this.executionDirectory(worker),
        control,
      )
      control.throwIfAborted()
      // This run keeps the account it started with; the message waits for the next turn.
      if (!binding || binding !== current) throw new AccountChangedDuringRunError()
      if (
        this.tasks.get(worker.id) !== task ||
        worker.runId !== snapshot.runId ||
        worker.status !== 'running'
      )
        throw new Error('本轮状态已变化，请保留消息稍后重试')
      this.assertCliEnabled(cliOf(worker.preference))
      this.queuedExecutionGuard?.(worker)
      this.followups.recordSteering(worker.id, prompt, requestId, false)
      submitted = true
      // A carried-over prompt cannot repeat this message, so the turn is no longer replayed.
      task.steerSubmitted = true
      await task.steer!(prompt, requestId, control)
      // A matching native receipt acknowledges delivery even if the run ends immediately afterwards.
      this.storage.append(snapshot, {
        kind: 'user',
        text: prompt,
        queuedFollowupId: requestId,
        admittedRunId: snapshot.runId,
      })
      this.followups.recordSteering(worker.id, prompt, requestId, true)
      this.changed()
    })().catch((error) => {
      const rejected =
        error && typeof error === 'object' && 'code' in error && error.code === 'STEER_REJECTED'
      if (!submitted || rejected) task.steering.delete(requestId)
      if (submitted && rejected) this.followups.forgetRejectedSteering(worker.id, requestId)
      if (error instanceof ProcessCleanupUnconfirmedError) {
        if (!submitted) {
          task.admissionFailure ??= { error }
          this.blockCatalogOnCleanup(cliOf(worker.preference), error)
        }
        else this.markCleanupBlocked(error)
        // The live task still owns its own range. Its later cleanup must not
        // reclassify this account-query failure as an unknown task-range fault.
        task.controller.abort(!submitted ? new Error(error.message, { cause: error }) : error)
        this.drain()
      }
      if (submitted && !rejected)
        throw Object.assign(
          new Error(error instanceof Error ? error.message : String(error), {
            cause: error,
          }),
          { code: 'STEER_UNKNOWN' },
        )
      throw error
    })
    task.steering.set(requestId, { prompt, done })
    await done
  }
  /** Accepted intent survives transport cancellation; only an explicit Stop revokes it. */
  interruptMessage(
    parent: string,
    id: string,
    prompt: string,
    requestId: string,
    clientId: string,
    sequence: number,
    signal?: AbortSignal,
  ): { messageId: string; revision: number; state: DeliveryState } {
    const worker = this.get(parent, id)
    this.assertCliEnabled(cliOf(worker.preference))
    signal?.throwIfAborted()
    z.uuid().parse(requestId)
    z.uuid().parse(clientId)
    z.number().int().nonnegative().safe().parse(sequence)
    if (!prompt.trim() || prompt.length > 100_000) throw new Error('消息须包含 1–100000 个字符')
    const messages = this.priorityHistory.get(id) ?? new Map<string, PriorityMessage>()
    const duplicate = messages.get(requestId)
    if (duplicate) {
      if (duplicate.prompt !== prompt) throw new Error('重复提交标识对应的消息不同')
      return {
        messageId: requestId,
        revision: this.revision,
        state: duplicate.state,
      }
    }
    this.queuedExecutionGuard?.(worker)
    const receipt = this.followups.receipt(id, prompt, requestId)
    if (receipt?.delivery === 'steer' || (receipt && !receipt.item))
      throw new Error('这条消息已经处理，请刷新会话')
    if (this.tasks.get(id)?.queuedFollowupId === requestId && this.tasks.get(id)?.spawnAttempted)
      throw new Error('消息已进入执行队列，请使用停止操作')
    const lastSequence = Math.max(
      -1,
      ...[...messages.values()].filter((item) => item.clientId === clientId).map((item) => item.sequence),
    )
    const message: PriorityMessage = {
      id: requestId,
      prompt,
      clientId,
      sequence,
      createdAt: new Date().toISOString(),
      generation: this.followups.generation(id),
      state: sequence <= lastSequence ? 'superseded' : 'pending',
      controller: new AbortController(),
    }
    this.updatePriority(
      worker,
      message,
      message.state,
      message.state === 'superseded' ? '已被后续插队取消' : undefined,
    )
    messages.set(requestId, message)
    this.priorityHistory.set(id, messages)
    try {
      this.followups.consume(id, prompt, requestId)
    } catch (error) {
      this.updatePriority(worker, message, 'failed', `待发送消息状态保存失败：${String(error)}`)
      this.blocked = message.error
      throw error
    }
    if (message.state === 'pending') {
      const previous = this.latestPriority.get(id)
      if (previous && !deliveryTerminal(previous.state)) {
        if (!previous.spawnAttempted) this.updatePriority(worker, previous, 'superseded', '已被后续插队取消')
        previous.controller.abort(new UserStoppedError())
      }
      this.latestPriority.set(id, message)
      if (this.priorityRunners.has(id)) {
        // Stop owns the process/preparation cleanup; newer callers never await an older RPC.
        void this.stopCurrent(parent, id, true).catch(() => undefined)
      } else this.startPriorityRunner(worker)
    }
    this.changed()
    return {
      messageId: requestId,
      revision: this.revision,
      state: message.state,
    }
  }
  private updatePriority(
    worker: Worker,
    message: PriorityMessage,
    state: DeliveryState,
    error?: string,
  ): void {
    this.storage.append(worker, {
      kind: 'submission',
      text: message.prompt,
      queuedFollowupId: message.id,
      deliveryState: state,
      deliveryError: error,
      admittedRunId: message.runId,
      submissionClientId: message.clientId,
      submissionSequence: message.sequence,
    })
    message.state = state
    message.error = error
    this.changed()
  }
  private startPriorityRunner(worker: Worker): void {
    const operation = (async () => {
      while (this.latestPriority.has(worker.id)) {
        let message = this.latestPriority.get(worker.id)!
        try {
          await this.stopCurrent(worker.parentSessionId, worker.id, true)
          const latest = this.latestPriority.get(worker.id)
          if (!latest) break
          message = latest
          message.controller.signal.throwIfAborted()
          this.assertCliEnabled(cliOf(worker.preference))
          this.queuedExecutionGuard?.(worker)
          if (!this.followupLauncher) throw new Error('续聊通路尚未准备好')
          await this.followupLauncher(
            structuredClone(worker),
            {
              id: message.id,
              prompt: message.prompt,
              createdAt: message.createdAt,
              state: 'sending',
            },
            { id: message.id, expectedRunId: worker.runId, priority: true },
            message.controller.signal,
          )
          const task = this.tasks.get(worker.id)
          if (task?.queuedFollowupId === message.id) await task.done
        } catch (error) {
          if (!deliveryTerminal(message.state))
            this.updatePriority(
              worker,
              message,
              message.controller.signal.aborted && !this.blocked ? 'cancelled' : 'failed',
              this.blocked ?? (message.controller.signal.aborted ? '已停止发送' : String(error)),
            )
          if (this.latestPriority.get(worker.id) === message)
            this.pauseFollowups(
              worker.id,
              message.error ?? '插队未完成，请确认后继续发送',
              message.generation,
            )
        } finally {
          if (this.latestPriority.get(worker.id) === message) this.latestPriority.delete(worker.id)
        }
      }
    })().finally(() => {
      this.priorityRunners.delete(worker.id)
      this.changed()
      if (this.latestPriority.has(worker.id) && !this.disposed) this.startPriorityRunner(worker)
      else {
        this.dispatchFollowup(worker)
      }
    })
    this.priorityRunners.set(worker.id, operation)
    void operation.catch(() => undefined)
  }
  interruptQueuedFollowup(
    parent: string,
    id: string,
    queuedId: string,
    _expectedRunId: string,
    signal?: AbortSignal,
  ): Promise<QueuedFollowup> {
    const worker = this.get(parent, id)
    const known = this.priorityHistory.get(id)?.get(queuedId)
    const item =
      this.followups.list(id).find((entry) => entry.id === queuedId) ??
      (known
        ? {
            id: known.id,
            prompt: known.prompt,
            createdAt: known.createdAt,
            state: 'sending' as const,
          }
        : undefined)
    if (!item) throw new Error('消息已发送或已取消，请刷新会话')
    this.interruptMessage(parent, worker.id, item.prompt, item.id, item.id, 1, signal)
    return Promise.resolve({ ...item, state: 'sending' })
  }
  queueFollowup(
    parent: string,
    id: string,
    prompt: string,
    expectedRunId: string,
    requestId: string,
    workerBound = false,
  ): QueuedFollowup {
    const worker = this.get(parent, id)
    this.assertCliEnabled(cliOf(worker.preference))
    const priority = this.priorityHistory.get(id)?.get(requestId)
    if (priority) {
      if (priority.prompt !== prompt) throw new Error('重复提交标识对应的消息不同')
      return {
        id: requestId,
        prompt,
        createdAt: priority.createdAt,
        state: 'sending',
      }
    }
    if (!workerBound && worker.runId !== expectedRunId) throw new Error('本轮状态已变化，请刷新后重新发送')
    const receipt = this.followups.receipt(id, prompt, requestId)
    if (receipt) {
      if (receipt.delivery !== 'queue' || !receipt.item) throw new Error('这条消息已经处理，请刷新会话')
      return receipt.item
    }
    if (
      (!workerBound && worker.status === 'stopping') ||
      (!['queued', 'running', 'completed'].includes(worker.status) &&
        !this.followups.list(id).length &&
        !(workerBound && (isUserInterrupted(worker) || this.stopOperations.get(id)?.size)))
    )
      throw new Error('本轮已暂停或异常，请确认后重新发送')
    const item = this.followups.add(id, prompt, requestId)
    this.changed()
    this.dispatchFollowup(worker)
    return item
  }
  cancelQueuedFollowup(parent: string, id: string, queuedId: string): void {
    this.get(parent, id)
    if (this.disposed) throw new Error('CLI Worker is shutting down')
    const task = this.tasks.get(id)
    if (task?.queuedFollowupId === queuedId && task.spawnAttempted)
      throw new Error('消息已进入执行队列，请使用停止操作')
    this.followups.remove(id, queuedId)
    if (task?.queuedFollowupId === queuedId) {
      task.preserveFollowups = true
      task.controller.abort(new UserStoppedError())
      if (!this.running.has(task)) {
        this.queue = this.queue.filter((entry) => entry !== task)
        void this.finishQueued(task, 'interrupted', '待发送消息已取消')
      }
    }
    const dispatch = this.followupDispatches.get(id)
    if (dispatch?.id === queuedId) dispatch.controller.abort(new Error('待发送消息已取消'))
    this.changed()
  }
  retryQueuedFollowups(parent: string, id: string, expectedRunId: string): void {
    const worker = this.get(parent, id)
    this.assertManagedIdle(worker)
    this.assertCliEnabled(cliOf(worker.preference))
    if (worker.runId !== expectedRunId) throw new Error('本轮状态已变化，请刷新后重试')
    if (!worker.conversationId && !isUserInterrupted(worker))
      throw new Error('尚未收到 CLI 会话标识，无法继续发送')
    if (this.followupDispatches.has(id)) throw new Error('消息正在准备发送，请稍后再试')
    this.followups.update(id, 'pending')
    this.changed()
    this.dispatchFollowup(worker, true)
  }
  private pauseFollowups(
    id: string,
    reason: string,
    throughGeneration = this.followups.generation(id),
  ): void {
    const dispatch = this.followupDispatches.get(id)
    if (dispatch && dispatch.generation <= throughGeneration) dispatch.controller.abort(new Error(reason))
    try {
      this.followups.update(id, 'paused', reason, throughGeneration)
    } catch (error) {
      this.blocked = `待发送消息状态保存失败，已暂停执行：${String(error)}`
    }
  }
  private dispatchFollowup(worker: Worker, explicitlyRetried = false): void {
    if (
      this.disposed ||
      this.blocked ||
      !this.followupLauncher ||
      this.followupDispatches.has(worker.id) ||
      this.preparations.has(worker.id) ||
      this.latestPriority.has(worker.id) ||
      this.priorityRunners.has(worker.id) ||
      this.stopOperations.get(worker.id)?.size ||
      this.accepting(worker.id)
    )
      return
    if (
      this.tasks.has(worker.id) ||
      active(worker.status) ||
      (!explicitlyRetried && worker.status !== 'completed' && !isUserInterrupted(worker))
    )
      return
    let item: QueuedFollowup | undefined
    try {
      item = this.followups.claim(worker.id)
    } catch (error) {
      this.blocked = `待发送消息状态保存失败，已暂停执行：${String(error)}`
      this.changed()
      return
    }
    if (!item) return
    const dispatch: {
      id: string
      expectedRunId: string
      generation: number
      controller: AbortController
      done?: Promise<void>
      preserveOnAbort?: boolean
    } = {
      id: item.id,
      expectedRunId: worker.runId,
      generation: this.followups.generationOf(worker.id, item.id)!,
      controller: new AbortController(),
    }
    this.followupDispatches.set(worker.id, dispatch)
    this.changed()
    const running = this.followupLauncher(structuredClone(worker), item, dispatch, dispatch.controller.signal)
      .catch((error) => {
        if (dispatch.preserveOnAbort && !this.blocked) this.followups.releaseClaim(worker.id, item.id)
        else if (this.followups.list(worker.id).some((entry) => entry.id === item.id))
          this.pauseFollowups(
            worker.id,
            `发送已暂停：${error instanceof Error ? error.message : String(error)}`,
            dispatch.generation,
          )
        this.changed()
      })
      .finally(() => {
        this.followupRuns.delete(running)
        if (this.followupDispatches.get(worker.id) === dispatch) this.followupDispatches.delete(worker.id)
        this.changed()
        const current = this.storage.workers.get(worker.id)
        if (current && !current.archivedAt) this.dispatchFollowup(current, explicitlyRetried)
      })
    this.followupRuns.add(running)
    dispatch.done = running
  }
  subscribe(callback: () => void): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }
  changed(): void {
    this.revision++
    for (const callback of this.listeners) callback()
  }
  assertCliEnabled(cli: CliId): void {
    if (this.disposed) throw new Error('插件正在关闭')
    if (this.blocked) throw new Error(this.blocked)
    if (this.catalogBlocked.has(cli)) throw new Error(this.catalogBlocked.get(cli))
    if (isRetiredCli(cli)) throw new Error(RETIRED_HARNESS_NOTICE)
    if (!this.storage.cliSettings().enabled[cli])
      throw new Error(`${CLI_LABELS[cli]} 已关闭，请先在 CLI Worker 设置中开启`)
  }
  blockOnCleanup(error: ProcessCleanupUnconfirmedError): void {
    this.markCleanupBlocked(error)
    this.drain()
  }
  /** Read-only metadata owns one CLI's account/cache, never another CLI's admission. */
  blockCatalogOnCleanup(cli: CliId, error: ProcessCleanupUnconfirmedError): void {
    let message = `${CLI_LABELS[cli]} 元数据进程清理尚未确认，已暂停此 CLI：${error.message}`
    this.catalogBlocked.set(cli, message)
    try { this.storage.blockCleanup(cli) }
    catch {
      message += '；清理隔离记录保存失败'
      this.catalogBlocked.set(cli, message)
    }
    this.drain()
    this.changed()
  }
  private markCleanupBlocked(error: unknown): void {
    this.blocked = `无法确认 CLI 进程已清理，已暂停后续派遣：${error instanceof Error ? error.message : String(error)}`
    try {
      // The private marker contains no CLI output, paths, identities or credentials.
      this.storage.blockCleanup()
    } catch {
      // Keep this Host closed even when its storage cannot record the quarantine.
      this.blocked += '；清理隔离记录保存失败'
    }
  }
  setCliEnabled(cli: CliId, enabled: boolean) {
    if (isRetiredCli(cli)) throw new Error(RETIRED_HARNESS_NOTICE)
    if (this.disposed) throw new Error('插件正在关闭')
    if (!enabled) this.assertAccountIdle(cli)
    const settings = this.storage.setCliEnabled(cli, enabled)
    this.changed()
    return settings
  }
  /** A saved user choice overrides the deployment config; lowering never stops running work. */
  get maxConcurrent(): number {
    return this.storage.generalSettings().maxConcurrent ?? this.config.maxConcurrent
  }
  generalSettings(): GeneralSettings {
    return {
      maxConcurrent: this.maxConcurrent,
      defaultMaxConcurrent: this.config.maxConcurrent,
      language: this.storage.generalSettings().language ?? 'follow',
      isolatedParallelWrites: this.storage.generalSettings().isolatedParallelWrites ?? false,
      askBeforeDispatch: this.storage.generalSettings().askBeforeDispatch ?? true,
      // The plugin config value stays the initial limit until the user chooses one.
      taskTimeLimitMs: this.storage.generalSettings().taskTimeLimitMs ?? this.config.timeoutMs,
      defaultTaskTimeLimitMs: this.config.timeoutMs,
      idleTimeLimitMs: this.storage.generalSettings().idleTimeLimitMs ?? 0,
    }
  }
  setGeneralSettings(patch: unknown): GeneralSettings {
    if (this.disposed) throw new Error('插件正在关闭')
    this.storage.setGeneralSettings(patch)
    // A raised limit admits already queued tasks at once.
    this.drain()
    this.changed()
    return this.generalSettings()
  }
  /** Account mutation must also respect a prior unconfirmed process cleanup. */
  assertAccountIdle(cli: string): void {
    if (this.disposed) throw new Error('插件正在关闭')
    if (this.blocked) throw new Error(this.blocked)
    if (this.catalogBlocked.has(cli as CliId)) throw new Error(this.catalogBlocked.get(cli as CliId))
    if (
      [...this.storage.workers.values()].some(
        (worker) => !!this.busyReason(worker) && cliOf(worker.preference) === cli,
      )
    )
      throw new Error('此 CLI 还有运行或排队中的任务，请等待结束后再修改此 CLI 设置或管理账号')
  }
  get(parent: string, id: string): Worker {
    const worker = this.storage.workers.get(id) ?? this.stagedForks.get(id)
    if (!worker || worker.parentSessionId !== parent)
      throw new Error('Worker does not belong to this conversation')
    if (worker.archivedAt) throw new Error('此任务已删除，请先恢复')
    return worker
  }
  /** Exact names are scoped to the owning parent; never select a partial or cross-session match. */
  resolveWorker(parent: string, id?: string, name?: string): Worker {
    if (!id && !name) throw new Error('请指定 worker_id 或 worker_name')
    const normalized = name === undefined ? undefined : agentNameSchema.parse(name)
    if (id) {
      const worker = this.get(parent, id)
      if (normalized && !this.matchesName(worker, normalized))
        throw new Error('worker_id 与 worker_name 不匹配')
      return worker
    }
    const matches = [...this.storage.workers.values()].filter(
      (worker) =>
        worker.parentSessionId === parent && !worker.archivedAt && this.matchesName(worker, normalized!),
    )
    if (matches.length !== 1)
      throw new Error(
        matches.length
          ? '智能体名称不唯一，请使用 worker_id'
          : '当前对话中没有此名称的智能体，请检查名称或使用 worker_id',
      )
    return matches[0]!
  }
  private matchesName(worker: Worker, name: string): boolean {
    return workerName(worker) === name || (worker.nameAliases ?? []).includes(name)
  }
  private checkAgentName(parent: string, name: string, excludingId?: string): string {
    const clean = agentNameSchema.parse(name)
    if (
      [...this.storage.workers.values()].some(
        (worker) =>
          worker.parentSessionId === parent &&
          worker.id !== excludingId &&
          [workerName(worker), ...(worker.nameAliases ?? [])].some(
            (name) => name.toLocaleLowerCase() === clean.toLocaleLowerCase(),
          ),
      )
    )
      throw new Error('当前对话已有同名智能体，请换一个名称或续用已有智能体')
    return clean
  }
  renameWorker(parent: string, id: string, name: string): void {
    if (this.disposed) throw new Error('CLI Worker is shutting down')
    const worker = this.get(parent, id)
    const agentName = this.checkAgentName(parent, name, id)
    // Publish the new name only after persistence succeeds. Keep a running task's
    // shared worker reference in sync so its next process event cannot revert it.
    this.storage.save({ ...worker, agentName, agentNameOrigin: 'custom' })
    worker.agentName = agentName
    worker.agentNameOrigin = 'custom'
    this.storage.workers.set(id, worker)
    this.changed()
  }
  renameWorkerTitle(parent: string, id: string, title: string): void {
    if (this.disposed) throw new Error('CLI Worker is shutting down')
    const worker = this.get(parent, id)
    const clean = workerTitleSchema.parse(title)
    this.storage.save({ ...worker, title: clean })
    worker.title = clean
    this.storage.workers.set(id, worker)
    this.changed()
  }
  private goalWorker(parent: string, id: string, expectedRevision: number): Worker {
    if (this.disposed) throw new Error('CLI Worker is shutting down')
    const worker = this.get(parent, id)
    if ((worker.goal?.revision ?? worker.goalRevision ?? 0) !== expectedRevision)
      throw new Error('目标已被修改，请刷新后重试')
    return worker
  }
  setWorkerGoal(parent: string, id: string, objective: string, expectedRevision: number): WorkerGoal {
    const worker = this.goalWorker(parent, id, expectedRevision)
    const clean = objective.trim()
    if (!clean.length || clean.length > GOAL_OBJECTIVE_LIMIT)
      throw new Error(`目标须包含 1–${GOAL_OBJECTIVE_LIMIT} 个字符`)
    return this.saveWorkerGoal(worker, {
      objective: clean,
      status: worker.goal?.status ?? 'active',
      revision: expectedRevision + 1,
      updatedAt: new Date().toISOString(),
    })
  }
  setWorkerGoalStatus(parent: string, id: string, status: WorkerGoal['status'], expectedRevision: number): WorkerGoal {
    const worker = this.goalWorker(parent, id, expectedRevision)
    if (!worker.goal) throw new Error('当前会话尚未设置目标')
    if (status !== 'active' && status !== 'paused') throw new Error('目标状态无效')
    return this.saveWorkerGoal(worker, {
      ...worker.goal,
      status,
      revision: expectedRevision + 1,
      updatedAt: new Date().toISOString(),
    })
  }
  private saveWorkerGoal(worker: Worker, goal: WorkerGoal): WorkerGoal {
    this.storage.save({ ...worker, goal, goalRevision: goal.revision })
    // Keep the in-flight task's shared reference current across process events.
    worker.goal = goal
    worker.goalRevision = goal.revision
    this.storage.workers.set(worker.id, worker)
    this.changed()
    return structuredClone(goal)
  }
  clearWorkerGoal(parent: string, id: string, expectedRevision: number): void {
    const worker = this.goalWorker(parent, id, expectedRevision)
    // Advance past the cleared revision; a new goal never reuses it.
    const updated = { ...worker, goalRevision: expectedRevision + 1 }
    delete updated.goal
    this.storage.save(updated)
    delete worker.goal
    worker.goalRevision = updated.goalRevision
    this.storage.workers.set(worker.id, worker)
    this.changed()
  }
  /** Management cannot hide an in-flight task or a process whose cleanup is unresolved. */
  private assertManagedIdle(worker: Worker, priorityId?: string): void {
    if (this.disposed) throw new Error('CLI Worker is shutting down')
    if (this.blocked) throw new Error(this.blocked)
    const blocked = this.catalogBlocked.get(cliOf(worker.preference))
    if (blocked) throw new Error(blocked)
    if (
      active(worker.status) ||
      this.tasks.has(worker.id) ||
      this.preparations.has(worker.id) ||
      (this.latestPriority.has(worker.id) && this.latestPriority.get(worker.id)!.id !== priorityId)
    )
      throw new Error('请等待任务结束并完成进程清理后再管理此任务')
    if (this.isolationOperations.has(worker.id)) throw new Error('正在合并或丢弃隔离副本，请稍后再试')
  }
  assertLegacyRestart(parent: string, id: string): Worker {
    const worker = this.get(parent, id)
    this.assertManagedIdle(worker)
    this.assertCliEnabled(cliOf(worker.preference))
    if (!worker.conversationId || this.storage.accountBinding(id))
      throw new Error('只有缺少账号记录的历史任务可通过此操作新建对话')
    return worker
  }
  deleteWorker(parent: string, id: string): void {
    const worker = this.get(parent, id)
    this.assertManagedIdle(worker)
    this.storage.save({ ...worker, archivedAt: new Date().toISOString() })
    this.changed()
  }
  restoreWorker(parent: string, id: string): void {
    const worker = this.storage.workers.get(id)
    if (!worker || worker.parentSessionId !== parent)
      throw new Error('Worker does not belong to this conversation')
    this.assertManagedIdle(worker)
    if (!worker.archivedAt) throw new Error('此任务尚未删除')
    const restored = { ...worker }
    delete restored.archivedAt
    this.storage.save(restored)
    this.changed()
  }
  private nativeStateDirectory(worker: Worker): string {
    const state = readWorkerForkState(this.storage.directory, worker.id)
    return join(this.storage.directory, 'native', state?.nativeStateWorkerId ?? worker.id)
  }

  private forkRunSource(worker: Worker, runId: string): { workerId: string; conversationId: string } {
    // Inherited runs map to an ancestor's raw log, yet a carryover still left them behind.
    this.assertAfterCarryover(worker, runId)
    let current = worker.id, conversationId = worker.conversationId!
    const visited = new Set<string>()
    while (!existsSync(join(this.storage.directory, `${current}.${runId}.raw.jsonl`))) {
      if (visited.has(current)) throw new Error('分支历史来源循环')
      visited.add(current)
      const state = readWorkerForkState(this.storage.directory, current)
      if (!state?.historySourceWorkerId || !state.historySourceConversationId) throw new Error('原生完成轮日志缺失，无法映射分支截点')
      current = state.historySourceWorkerId
      conversationId = state.historySourceConversationId
    }
    // A run before a carryover belongs to an older session; the current one has no native copy of it.
    const owner = this.storage.workers.get(current)
    if (owner && owner.conversationId === conversationId) this.assertAfterCarryover(owner, runId)
    return { workerId: current, conversationId }
  }
  private assertAfterCarryover(worker: Worker, runId: string) {
    if (!worker.carryoverRunId || worker.carryoverRunId === runId) return
    const events = this.storage.history(worker.id)
    const at = events.findIndex((event) => event.runId === runId)
    const carried = events.findIndex((event) => event.runId === worker.carryoverRunId)
    if (at >= 0 && carried >= 0 && at < carried) throw new Error(CARRYOVER_FORK_REFUSED)
  }

  /** Metadata only, through the same admitted account, argv builder and owned process backend. */
  private async forkNative(worker: Worker, cut: NativeForkCut, signal: AbortSignal) {
    const cli = cliOf(worker.preference)
    const sourceId = worker.conversationId!
    const operation = async (conversationId: string, action: 'fork' | 'delete', ownSignal: AbortSignal) => {
      const executable = await resolveCliExecutable(cli, this.backend, this.config, ownSignal)
      const nativeState = this.nativeStateDirectory(worker)
      mkdirSync(nativeState, { recursive: true, mode: 0o700 })
      const prompt = '分支元数据操作（不发送模型任务）'
      const relayEnv = cli === 'codex' ? await codexRouteEnvironment(worker.project, ownSignal) : {}
      const launch = isExtendedCli(cli)
        ? await extendedLaunch(cli, executable, worker.project, worker.preference, worker.mode, prompt, nativeState,
            this.config, conversationId,
            (argv, env) => captureCatalogMetadata(this.backend, this.config, argv, worker.project, ownSignal, env),
            { backend: this.backend, signal: ownSignal, graceMs: this.config.graceMs }, true)
        : await prepareNativeWorker({ argv: workerArguments(executable, worker.project, worker.preference, worker.mode,
            prompt, this.config.timeoutMs, conversationId, true),
            env: { ...firstPartyEnvironment(cli), ...relayEnv, ...(['qoder', 'qodercn'].includes(cli) ? qoderEnvironment(cli as 'qoder' | 'qodercn') : {}) } },
            { cli, project: worker.project, preference: worker.preference, mode: worker.mode,
              prompt, conversationId, stateDirectory: nativeState }, this.config)
      let output = '', problem: unknown
      let handle: SubprocessHandle | undefined
      let createdId: string | undefined
      let cleanupUnconfirmed = false
      let readers: Promise<void>[] = []
      try {
        const path = launch.argv.at(-1)!
        const request = JSON.parse(readFileSync(path, 'utf8'))
        writeFileSync(path, JSON.stringify({ ...request, forkOperation: action, forkAt: cut }), { mode: 0o600 })
        if ('activate' in launch && typeof launch.activate === 'function') await launch.activate()
        handle = this.backend.spawn({ argv: launch.argv, cwd: worker.project, env: launch.env,
          stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }, graceMs: this.config.graceMs,
          signal: AbortSignal.any([ownSignal, AbortSignal.timeout(30000)]) })
        void handle.done.catch(() => undefined)
        const decoder = new StringDecoder('utf8')
        let bytes = 0
        const consume = async (stream: SubprocessHandle['stdout'], keep: boolean) => {
          if (!stream) return
          for await (const chunk of stream) {
            bytes += Buffer.byteLength(chunk)
            if (bytes > this.config.maxRunBytes) throw new Error('分支元数据输出超过限制')
            if (keep) output += decoder.write(chunk)
          }
          if (keep) output += decoder.end()
        }
        readers = [consume(handle.stdout, true), consume(handle.stderr, false)]
        await Promise.all(readers)
        const result = await handle.done
        if (result.exitCode !== 0) throw new Error('原生分支元数据操作失败')
        ownSignal.throwIfAborted()
      } catch (error) { problem = error }
      finally {
        if (handle) {
          try { handle.terminate(); if (!await handle.waitForExit()) throw new ProcessCleanupUnconfirmedError() }
          catch (error) {
            cleanupUnconfirmed = true
            this.blockCatalogOnCleanup(cli, new ProcessCleanupUnconfirmedError())
            problem = new AggregateError([problem, error].filter(Boolean), '分支元数据进程清理未确认；保留私有准备资源')
          }
        }
        await Promise.allSettled(readers)
        try { if (!cleanupUnconfirmed) await launch.cleanup() } catch (error) { problem = new AggregateError([problem, error].filter(Boolean), '分支元数据准备资源清理失败') }
      }
      const frames: any[] = []
      for (const line of output.split('\n').filter(Boolean)) {
        try { frames.push(JSON.parse(line)) } catch (error) { problem ??= error }
      }
      const created = frames.filter((frame) => frame.type === 'native' && frame.record?.type === 'cliworker.fork_created')
      if (created.length === 1 && typeof created[0].record.id === 'string' && created[0].record.id !== sourceId)
        createdId = created[0].record.id
      const terminal = frames.filter((frame) => frame.type === 'result').at(-1)
      if (terminal?.status !== 'SUCCESS') problem ??= new Error(terminal?.error ?? '缺少原生分支完成回执')
      if (action === 'fork' && !createdId) problem ??= new Error('原生分支没有返回新的会话 ID')
      if (problem) {
        if (createdId && action === 'fork' && cleanupUnconfirmed)
          throw new AggregateError([problem], `分支进程清理未确认；原生资源 ${createdId} 保留待人工核查`)
        if (createdId && action === 'fork') {
          try { await operation(createdId, 'delete', AbortSignal.timeout(30000)) }
          catch (cleanup) { throw new AggregateError([problem, cleanup], `分支失败；原生资源 ${createdId} 清理说明：${String(cleanup)}`) }
        }
        throw problem
      }
      const notes = frames.filter((frame) => frame.type === 'native' && frame.record?.type === 'cliworker.fork_cleanup')
      if (notes.length) throw new Error(notes.map((frame) => frame.record.note).join('；'))
      return createdId
    }
    // Any signed-in own account may branch; the branch's first turn rebinds to it.
    await readCliAccountBinding(cli, this.backend, this.config, worker.project, signal)
    const conversationId = (await operation(sourceId, 'fork', signal))!
    return { conversationId, rollback: async () => {
      try { await operation(conversationId, 'delete', AbortSignal.timeout(30000)) }
      catch (error) { throw new Error(`原生分支 ${conversationId} 清理说明：${String(error)}`, { cause: error }) }
    } }
  }

  async forkWorker(parent: Agent, id: string, atMessageId: string, bridge: HarnessConversationApi, signal: AbortSignal) {
    const source = this.get(parent.id, id)
    if (source.isolation) throw new Error('隔离副本中的对话暂不支持分支，请先合并或丢弃后新建对话')
    // Paused queued followups still belong to this conversation and prohibit a fork.
    if (this.busyReason(source) || this.followups.list(id).length)
      throw new Error('请等待当前运行结束后再分支')
    return this.prepareFollowup(parent.id, id, signal, async (ownSignal) => {
      const created: string[] = []
      try {
        return await forkWorkerConversation({
          worker: source, workers: () => [...this.storage.workers.values(), ...this.stagedForks.values()],
          assertIdle: () => { ownSignal.throwIfAborted() },
          history: (at) => bridge.forkHistory(source, at, ownSignal),
          raw: (runId) => readFileSync(join(this.storage.directory, `${this.forkRunSource(source, runId).workerId}.${runId}.raw.jsonl`), 'utf8'),
          rawSourceId: (runId) => this.forkRunSource(source, runId).conversationId,
          native: (cut) => this.forkNative(source, cut, ownSignal),
          stage: (worker) => { this.stagedForks.set(worker.id, worker); created.push(worker.id) },
          child: (worker, history) => bridge.createFork(parent, worker, history, ownSignal),
          publish: (worker, history, state) => this.publishFork(source, worker, history, state),
          remove: (worker) => {
            this.storage.workers.delete(worker.id)
            this.stagedForks.delete(worker.id)
            for (const suffix of ['.worker.json', '.events.jsonl', '.account-binding.json', '.fork.json'])
              rmSync(join(this.storage.directory, worker.id + suffix), { force: true })
          },
          changed: () => this.changed(),
          nativeStateWorkerId: readWorkerForkState(this.storage.directory, id)?.nativeStateWorkerId,
        }, atMessageId, ownSignal)
      } finally { for (const workerId of created) this.stagedForks.delete(workerId) }
    })
  }

  private publishFork(source: Worker, worker: Worker, history: ForkHistory, state?: WorkerForkState) {
    const events = this.storage.history(source.id)
    const cutoff = events.findLastIndex((event) => event.runId === history.runId && event.kind !== 'submission')
    if (cutoff < 0) throw new Error('分支运行历史缺失')
    writeFileSync(join(this.storage.directory, `${worker.id}.events.jsonl`), events.slice(0, cutoff + 1)
      .map((event) => JSON.stringify(event)).join('\n') + '\n', { mode: 0o600, flag: 'wx' })
    const binding = this.storage.accountBinding(source.id)
    if (binding) this.storage.bindAccount(worker.id, binding)
    writeWorkerForkState(this.storage.directory, worker.id, state)
    this.storage.save(worker)
  }

  snapshot(parent: string, selected?: string): WorkerSnapshot {
    const owned = [...this.storage.workers.values()]
      .filter((w) => w.parentSessionId === parent)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    const workers = owned.filter((worker) => !worker.archivedAt)
    const archivedWorkers = owned.filter((worker) => !!worker.archivedAt)
    const selectedWorker = selected ? this.storage.workers.get(selected) : undefined
    if (selected && (!selectedWorker || selectedWorker.parentSessionId !== parent))
      throw new Error('Worker does not belong to this conversation')
    const worker = selectedWorker?.archivedAt ? undefined : selectedWorker
    const timeline = worker ? this.timeline(worker) : []
    const telemetry = worker
      ? withContextTelemetry(worker, withConversationTelemetry(worker, this.runTelemetry(worker, worker.runId)))
      : undefined
    const context =
      worker && cliOf(worker.preference) === 'antigravity'
        ? this.agyContextReader.read(worker.conversationId)
        : undefined
    const {
      replies: _replies,
      replyDurations: _replyDurations,
      finalReply: _finalReply,
      runUsage: _runUsage,
      ...publicTelemetry
    } = telemetry ?? { replies: {} }
    return {
      telemetry:
        telemetry || context
          ? {
              ...publicTelemetry,
              ...context,
            }
          : undefined,
      workers,
      archivedWorkers,
      selected: worker,
      selectedBusy: worker ? !!this.busyReason(worker) : false,
      selectedBusyReason: worker ? this.busyReason(worker) : undefined,
      queuedFollowups: worker ? this.followups.list(worker.id) : [],
      runningMessageMode: worker
        ? this.storage.runningMessageSettings(worker.project, cliOf(worker.preference)).mode === 'steer' &&
          !supportsWorkerNativeSteering(worker)
          ? 'queue'
          : this.storage.runningMessageSettings(worker.project, cliOf(worker.preference)).mode
        : undefined,
      runningMessageModeReason:
        worker &&
        this.storage.runningMessageSettings(worker.project, cliOf(worker.preference)).mode === 'steer' &&
        !supportsWorkerNativeSteering(worker)
          ? '此历史会话使用的通信通路不支持原生引导，当前使用排队；不会更换原生会话协议'
          : undefined,
      timeline: timeline.slice(-this.config.maxTimelineItems),
      revision: this.revision,
      truncated: timeline.length > this.config.maxTimelineItems,
      // Absent means `follow`; every open view adopts a saved language live.
      ...(this.storage.generalSettings().language ? { language: this.storage.generalSettings().language } : {}),
    }
  }
  private timeline(worker: Worker): TimelineItem[] {
    const events = this.nativeTimelineReprojector.project(worker, legacyAccountNotes(this.storage.history(worker.id)), (runId) =>
      join(this.storage.directory, `${worker.id}.${runId}.raw.jsonl`),
    )
    const rows = foldEvents(
      events.map((event) => ({
        ...event,
        ...projectPublicToolCall(cliOf(worker.preference), event),
      })),
      active(worker.status) ? undefined : { runId: worker.runId, status: worker.status },
      cliOf(worker.preference),
    )
    for (const runId of new Set(rows.map((row) => row.id.split(':')[0]!)))
      attachTelemetry(rows, runId, this.runTelemetry(worker, runId))
    return rows
  }
  private runTelemetry(bound: Worker, runId: string) {
    // Native session files are keyed by the directory the CLI actually ran in.
    const worker = bound.isolation ? { ...bound, project: bound.isolation.path } : bound
    const rawPath = join(this.storage.directory, `${worker.id}.${runId}.raw.jsonl`)
    const observed = { ...this.telemetryReader.read(
      rawPath,
      cliOf(worker.preference),
      runId === worker.runId
        ? {
            conversationId: worker.conversationId,
            model: worker.observedModel ?? worker.preference.model,
            project: worker.project,
          }
        : undefined,
    ), ...this.supplementalContextReader.read({ worker, runId, rawPath, storageDirectory: this.storage.directory,
      ...(runId === worker.runId ? { currentIdentity: { conversationId: worker.conversationId,
        model: worker.observedModel ?? worker.preference.model } } : {}),
    }) }
    if (runId === worker.runId && worker.contextInvalidatedRunId === runId) return withoutContextTelemetry(observed)
    if (runId === worker.runId && cliOf(worker.preference) === 'hermes') {
      try {
        const native = worker.transport === 'hermes-http-v1'
        const session = this.hermesSessionReader.read(
          native ? join(this.storage.directory, 'native', worker.id, 'hermes-http-home')
            : effectiveHermesHome({ ...this.config, stateDirectory: this.storage.directory }),
          worker.conversationId, native ? 'api_server' : 'oneshot', worker.project,
        )
        // Session totals replace only the cumulative meter. Exact run receipts
        // remain separate and are never relabelled as provider responses.
        if (session) return { ...observed, ...session }
      } catch {
        // Unavailable account/session metadata never changes execution or history.
      }
    }
    return observed
  }
  /** A settled, exact run receipt for the official whole-turn disclosure. */
  runUsage(parent: string, id: string, runId: string) {
    const worker = this.get(parent, id)
    if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(runId)) return
    if (worker.runId === runId && this.busyReason(worker)) return
    const terminal = this.storage.history(id).findLast((event) => event.runId === runId && event.kind === 'status' &&
      ['completed', 'failed', 'interrupted'].includes(event.state ?? ''))
    if (!terminal) return
    const receipt = this.telemetryReader.read(
      join(this.storage.directory, `${worker.id}.${runId}.raw.jsonl`), cliOf(worker.preference),
      { conversationId: worker.conversationId },
    ).runUsage
    return receipt?.scope === 'run' ? receipt : undefined
  }
  /** Independent exact-run credits, using the same bounded native identity checks. */
  runCredits(parent: string, id: string, runId: string) {
    const worker = this.get(parent, id)
    if (!['qoder', 'qodercn'].includes(cliOf(worker.preference)) || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(runId) ||
      (worker.runId === runId && this.busyReason(worker))) return
    if (!this.storage.history(id).some(event => event.runId === runId && event.kind === 'status' &&
      ['completed', 'failed', 'interrupted'].includes(event.state ?? ''))) return
    return this.runTelemetry(worker, runId).providerCredits
  }
  history(parent: string, workerId: string, anchor: string, direction: string): HistoryPage {
    const worker = this.get(parent, workerId)
    if (direction !== 'before' && direction !== 'after') throw new Error('Invalid history direction')
    if (!anchor || anchor.length > 256) throw new Error('缺少有效的历史记录位置，请返回实时记录')
    const timeline = this.timeline(worker)
    const index = timeline.findIndex((item) => item.id === anchor)
    if (index < 0) throw new Error('历史记录位置已不可用，请返回实时记录后重试')
    // Row identity remains stable when later events append or a streamed step grows.
    const end = direction === 'before' ? index : Math.min(timeline.length, index + 201)
    const start = direction === 'before' ? Math.max(0, end - 200) : index + 1
    return {
      workerId,
      items: timeline.slice(start, end),
      start,
      end,
      total: timeline.length,
      hasOlder: start > 0,
      hasNewer: end < timeline.length,
    }
  }
  configureWorker(parent: string, id: string, preference: Preference): Worker {
    if (this.disposed) throw new Error('CLI Worker is shutting down')
    const worker = this.get(parent, id)
    if (isRetiredCli(cliOf(worker.preference))) throw new Error(RETIRED_HARNESS_NOTICE)
    if (this.busyReason(worker)) throw new Error('请等待本轮结束后再修改模型与强度')
    if (this.followups.list(id).length)
      throw new Error('请先发送或取消待发送消息（包含已暂停消息），再修改模型与强度')
    if (cliOf(worker.preference) !== cliOf(preference)) throw new Error('已有会话不能切换 CLI')
    this.assertCliEnabled(cliOf(preference))
    const updated = { ...worker, preference: { ...preference } }
    if (worker.preference.model !== preference.model) {
      updated.contextInvalidatedRunId = worker.runId
      updated.contextTelemetry = undefined
      updated.observedModel = undefined
    }
    this.storage.save(updated)
    this.changed()
    return updated
  }
  configureWorkerPermission(parent: string, id: string, mode: TaskMode, preparationId?: string): Worker {
    if (this.disposed) throw new Error('CLI Worker is shutting down')
    const worker = this.get(parent, id)
    if (isRetiredCli(cliOf(worker.preference))) throw new Error(RETIRED_HARNESS_NOTICE)
    if (!workerPermissionOptions(worker).some((option) => option.value === mode))
      throw new Error('当前 CLI 通路不支持此权限模式')
    if (preparationId) {
      const preparation = this.preparations.get(id)
      if (preparation?.id !== preparationId) throw new Error('权限修改准备已失效，请重试')
      preparation.controller.signal.throwIfAborted()
    }
    if (this.busyReason(worker, preparationId)) throw new Error('请等待本轮结束后再修改权限')
    if (this.followups.list(id).length)
      throw new Error('请先发送或取消待发送消息（包含已暂停消息），再修改权限')
    this.assertCliEnabled(cliOf(worker.preference))
    const updated = { ...worker, mode }
    this.storage.save(updated)
    this.changed()
    return updated
  }
  /** Capability and readiness of this exact run; never starts or retries a request. */
  nativeSteeringState(parent: string, id: string): 'ready' | 'pending' | 'unsupported' {
    const worker = this.get(parent, id)
    if (!supportsWorkerNativeSteering(worker)) return 'unsupported'
    const task = this.tasks.get(id)
    return task?.steer && !task.controller.signal.aborted && worker.status === 'running' ? 'ready' : 'pending'
  }
  submit(
    parent: string,
    project: string,
    title: string,
    prompt: string,
    preference: Preference,
    mode: TaskMode,
    previousId?: string,
    identity?: { agentName?: string; role?: RoleSnapshot },
    authorizedBinding?: string,
    queuedAdmission?: QueuedAdmission,
    preparationId?: string,
    submissionId?: string,
    attachments?: readonly NativeAttachment[],
  ): Submission {
    if (this.disposed) throw new Error('CLI Worker is shutting down')
    if (this.blocked) throw new Error(this.blocked)
    if (!prompt.trim() || prompt.length > 100_000) throw new Error('Task must contain 1–100000 characters')
    const canonical = projectDirectory(project)
    const previous = previousId ? this.get(parent, previousId) : undefined
    if (attachments?.length && previous?.transport === 'legacy')
      throw new Error('旧协议会话尚未接通附件，请使用原生 CLI 会话')
    if (previous && submissionId) {
      z.uuid().parse(submissionId)
      if (this.directMessageReceipt(parent, previous.id, prompt, submissionId))
        throw new Error('这条消息已经受理，请读取原提交回执')
      const prior = this.followups.receipt(previous.id, prompt, submissionId)
      if (prior && !queuedAdmission) throw new Error('这条消息已经处理，请刷新会话')
    }
    if (previous) usesNativeBridge(previous)
    const effective = previous?.preference ?? preference
    this.assertCliEnabled(cliOf(effective))
    if (
      previous &&
      this.preparations.has(previous.id) &&
      this.preparations.get(previous.id)!.id !== preparationId
    )
      throw new Error('此会话正在准备发送，请稍后再试')
    if (previous && (active(previous.status) || this.tasks.has(previous.id)))
      throw new Error('This CLI conversation already has a running or queued turn')
    if (previous && this.isolationOperations.has(previous.id))
      throw new Error('正在合并或丢弃隔离副本，请稍后再发送')
    const freshAfterStop = previous && !previous.conversationId && isUserInterrupted(previous)
    if (previous && !previous.conversationId && !readWorkerForkState(this.storage.directory, previous.id)?.sourceConversationId && !freshAfterStop)
      throw new Error('No CLI conversation_id was received; start a new worker')
    if (previous && previous.project !== canonical)
      throw new Error('Cannot resume a worker in another workspace')
    const nativeAdmission = previous
      ? usesNativeBridge(previous)
      : usesNativeBridge({
          preference: effective,
          transport: this.initialTransport(cliOf(effective)),
        })
    if (cliOf(effective) === 'kimi' && (previous?.mode ?? mode) === 'plan' && !nativeAdmission)
      throw new Error('Kimi 非交互模式不支持只读派遣')
    if (['qoder', 'qodercn'].includes(cliOf(effective)) && (previous?.mode ?? mode) === 'plan')
      throw new Error('Qoder 当前 ACP 未公开只读规划模式，无法安全执行规划任务')
    if (
      previous &&
      this.latestPriority.has(previous.id) &&
      (!queuedAdmission?.priority || this.latestPriority.get(previous.id)!.id !== queuedAdmission.id)
    )
      throw new Error('此会话正在处理插队消息，请稍后再试')
    if (queuedAdmission?.priority) {
      const message = previous && this.latestPriority.get(previous.id)
      if (
        !message ||
        message.id !== queuedAdmission.id ||
        message.controller.signal.aborted ||
        message.state !== 'pending' ||
        previous!.runId !== queuedAdmission.expectedRunId
      )
        throw new Error('插队消息已取消或已被替换')
    } else if (queuedAdmission) {
      const dispatch = previous && this.followupDispatches.get(previous.id)
      if (
        !previous ||
        !dispatch ||
        dispatch.id !== queuedAdmission.id ||
        dispatch.expectedRunId !== queuedAdmission.expectedRunId ||
        previous.runId !== queuedAdmission.expectedRunId ||
        dispatch.controller.signal.aborted ||
        this.followups.list(previous.id).find((item) => item.id === queuedAdmission.id)?.state !== 'sending'
      )
        throw new Error('待发送消息已取消或本轮状态已变化')
    } else if (previous) {
      this.pauseFollowups(previous.id, '已手动发送新消息，请确认后继续队列')
      this.followups.advanceGeneration(previous.id)
      for (const reservation of this.reservations.get(previous.id)?.values() ?? [])
        if (!reservation.controller.signal.aborted)
          reservation.generation = this.followups.generation(previous.id)
    }
    const now = new Date().toISOString()
    const worker: Worker = previous ?? {
      id: randomUUID(),
      parentSessionId: parent,
      project: canonical,
      title: title.slice(0, 160),
      agentName: identity?.agentName
        ? this.checkAgentName(parent, identity.agentName)
        : availableAgentName(this.storage.workers.values(), parent, CLI_SHORT_NAMES[cliOf(preference)]),
      agentNameOrigin: identity?.agentName ? 'custom' : 'auto',
      role: identity?.role ? roleSnapshotSchema.parse(structuredClone(identity.role)) : undefined,
      preference: { ...preference },
      transport: this.initialTransport(cliOf(preference)),
      mode,
      createdAt: now,
      updatedAt: now,
      runId: randomUUID(),
      status: 'queued',
    }
    if (previous) {
      const telemetry = this.runTelemetry(worker, worker.runId)
      worker.conversationTelemetry = captureConversationTelemetry(worker, telemetry)
      worker.lastRunUsageSnapshot = captureLastRunUsageSnapshot(worker, telemetry)
      worker.contextTelemetry = captureContextTelemetry(worker, telemetry)
    }
    worker.runId = randomUUID()
    worker.contextInvalidatedRunId = undefined
    worker.status = 'queued'
    worker.error = undefined
    worker.interruptionReason = undefined
    worker.lastResult = undefined
    worker.observedModel = undefined
    worker.updatedAt = now
    worker.jobId = undefined
    worker.isolationNotice = undefined
    worker.resultNotice = undefined
    this.storage.save(worker)
    if (!queuedAdmission || queuedAdmission.priority) {
      this.storage.append(worker, {
        kind: 'user',
        text: prompt,
        ...((queuedAdmission?.id ?? submissionId)
          ? {
              queuedFollowupId: queuedAdmission?.id ?? submissionId,
              admittedRunId: worker.runId,
            }
          : {}),
      })
      if (submissionId && !queuedAdmission) this.followups.consume(worker.id, prompt, submissionId)
    }
    this.storage.append(worker, {
      kind: 'status',
      text: 'queued',
      state: 'queued',
    })
    let settle!: (worker: Worker) => void
    const done = new Promise<Worker>((resolve) => {
      settle = resolve
    })
    const controller = new AbortController()
    // Start the own-account read at admission, before this task waits in the queue.
    const admission = authorizedBinding
      ? Promise.resolve(authorizedBinding)
      : readCliAccountBinding(cliOf(effective), this.backend, this.config, canonical, controller.signal)
    // Freeze the goal when this turn is admitted, so edits during preparation
    // or execution affect only later turns. Every CLI shares this prompt.
    const forkSource = readWorkerForkState(this.storage.directory, worker.id)?.sourceConversationId
    const cliPrompt = promptForWorker(forkSource ? { ...worker, conversationId: forkSource } : worker, prompt)
    const goal = worker.goal?.status === 'active' ? worker.goal.objective : undefined
    const task: Task = {
      worker,
      ...(attachments?.length ? { attachments: structuredClone(attachments) } : {}),
      prompt: withGoal(goal, cliPrompt),
      goal,
      userPrompt: prompt,
      controller,
      done,
      settle,
      admission,
      queuedFollowupId: queuedAdmission?.id,
      priority: queuedAdmission?.priority,
      generation: queuedAdmission?.priority
        ? this.latestPriority.get(worker.id)!.generation
        : queuedAdmission
          ? this.followupDispatches.get(worker.id)!.generation
          : this.followups.generation(worker.id),
      submissionId,
      steering: new Map(),
      steeringController: new AbortController(),
      order: this.admissions++,
    }
    void admission.catch((error) => {
      if (!controller.signal.aborted) task.admissionFailure = { error }
      if (error instanceof ProcessCleanupUnconfirmedError) {
        task.admissionFailure ??= { error }
        this.blockCatalogOnCleanup(cliOf(worker.preference), error)
      }
    })
    if (task.priority) {
      const message = this.latestPriority.get(worker.id)!
      message.runId = worker.runId
      this.updatePriority(worker, message, 'admitted')
    }
    this.tasks.set(worker.id, task)
    this.queue.push(task)
    this.changed()
    queueMicrotask(() => this.drain())
    return {
      worker,
      done,
      cancel: () => {
        if (this.tasks.get(worker.id) === task)
          void this.stop(parent, worker.id).catch((error) => {
            // The Jobs cancel hook is deliberately synchronous: waiting for a
            // follow-up preparation here would await its own launch callback.
            // Keep any late persistence failure visible after process cleanup.
            this.blocked ??= String(error)
            this.changed()
          })
      },
    }
  }
  attachJob(worker: Worker, jobId: string): void {
    worker.jobId = jobId
    this.storage.save(worker)
    this.changed()
  }
  stop(parent: string, id: string): Promise<Worker> {
    this.get(parent, id)
    const { previous: throughGeneration, persistenceError } = this.followups.revokeGeneration(id)
    for (const reservation of this.reservations.get(id)?.values() ?? [])
      if (reservation.generation <= throughGeneration) reservation.controller.abort(new UserStoppedError())
    const message = this.latestPriority.get(id)
    if (message) {
      message.controller.abort(new UserStoppedError())
      if (!message.spawnAttempted && !deliveryTerminal(message.state))
        this.updatePriority(this.get(parent, id), message, 'cancelled', '已停止发送')
      this.latestPriority.delete(id)
    }
    const token = Symbol('stop'),
      operations = this.stopOperations.get(id) ?? new Set<symbol>()
    operations.add(token)
    this.stopOperations.set(id, operations)
    let stopped = this.stopCurrent(parent, id, false, throughGeneration)
    if (persistenceError)
      // Cancellation has already started. The in-memory generation already
      // revokes earlier items, so only this Stop reports the failed write.
      stopped = stopped.then(() => {
        throw new Error(`任务已完成停止清理，但待发送消息状态持久化失败：${String(persistenceError)}`, {
          cause: persistenceError,
        })
      })
    this.changed()
    return stopped.finally(() => {
      operations.delete(token)
      if (!operations.size && this.stopOperations.get(id) === operations) this.stopOperations.delete(id)
      this.changed()
      const worker = this.storage.workers.get(id)
      if (worker && !worker.archivedAt) this.dispatchFollowup(worker)
    })
  }
  private stopCurrent(
    parent: string,
    id: string,
    preserveFollowups = false,
    throughGeneration = this.followups.generation(id),
  ): Promise<Worker> {
    const worker = this.get(parent, id)
    const before = structuredClone(worker)
    const preparation = this.preparations.get(id)
    preparation?.controller.abort(new UserStoppedError())
    const entry = this.followupDispatches.get(id)
    const dispatch = entry?.done
    if (preserveFollowups && entry) {
      entry.preserveOnAbort = true
      entry.controller.abort(new UserStoppedError())
      this.followups.releaseClaim(id, entry.id)
    } else if (!preserveFollowups) this.pauseFollowups(id, '任务已停止，请确认后继续发送', throughGeneration)
    this.changed()
    const task = this.tasks.get(id)
    if (!task)
      return Promise.all([preparation?.done, dispatch]).then(() => {
        const blocked = this.blocked ?? this.catalogBlocked.get(cliOf(worker.preference))
        if (preparation && blocked) throw new Error(blocked)
        return before
      })
    let persistenceError: unknown
    if (worker.status !== 'stopping') {
      if (preserveFollowups) task.preserveFollowups = true
      worker.status = 'stopping'
      if (task.nativeStop && this.running.has(task)) {
        task.nativeStopRequested = true
        task.approvals?.abort(new UserStoppedError())
        void Promise.resolve()
          .then(() => task.nativeStop?.())
          .catch(() => undefined)
          .finally(() => task.controller.abort(new UserStoppedError()))
      } else task.controller.abort(new UserStoppedError())
      // Persisting the stopping state is not a prerequisite for cancelling the
      // process. A disk failure still crosses the exact task.done barrier.
      try {
        this.storage.save(worker)
      } catch (error) {
        persistenceError = error
      }
      this.changed()
      if (!this.running.has(task)) {
        this.queue = this.queue.filter((t) => t !== task)
        void this.finishQueued(task, 'interrupted', '用户已取消排队任务')
      }
    }
    return Promise.all([task.done, preparation?.done, dispatch]).then(([result]) => {
      if (persistenceError) {
        const failure = new Error(`任务已完成停止清理，但停止状态持久化失败：${String(persistenceError)}`, {
          cause: persistenceError,
        })
        this.blocked ??= failure.message
        throw failure
      }
      return result
    })
  }
  /** A queued task may already own a native account-query process. */
  private async finishQueued(task: Task, status: 'failed' | 'interrupted', reason: string): Promise<void> {
    task.controller.abort(new Error(reason))
    try {
      await task.admission
    } catch (error) {
      if (error instanceof ProcessCleanupUnconfirmedError) {
        task.admissionFailure ??= { error }
        this.blockCatalogOnCleanup(cliOf(task.worker.preference), error)
      }
    }
    const priorFailure = task.admissionFailure
    const blocked = this.blocked ?? this.catalogBlocked.get(cliOf(task.worker.preference))
    const stopped =
      status === 'interrupted' && !priorFailure && task.controller.signal.reason instanceof UserStoppedError
    this.finish(
      task,
      blocked || priorFailure ? 'failed' : status,
      blocked ?? (priorFailure ? String(priorFailure.error) : stopped ? undefined : reason),
      stopped && !blocked ? 'user' : undefined,
    )
  }
  private drain(): void {
    if (this.disposed) return
    if (this.blocked) {
      const queued = this.queue.splice(0)
      for (const task of queued) {
        task.worker.status = 'stopping'
        void this.finishQueued(task, 'failed', this.blocked)
      }
      return
    }
    for (const task of [...this.queue]) {
      const blocked = this.catalogBlocked.get(cliOf(task.worker.preference))
      if (blocked) {
        this.queue.splice(this.queue.indexOf(task), 1)
        task.worker.status = 'stopping'
        void this.finishQueued(task, 'failed', blocked)
        continue
      }
      if (this.running.size >= this.maxConcurrent) break
      if (task.accountWait) {
        // Our own holder admits the next waiter when it ends; another holder is retried.
        if ([...this.running].some((other) => other.accountKey === task.accountKey)) continue
        const remaining = task.accountWait.retryAt - Date.now()
        if (remaining > 0) {
          this.retryDrain(remaining)
          continue
        }
      }
      // A conversation bound to a copy never touches the main directory.
      if (!task.worker.isolation) {
        const conflicts = (other: Task) =>
          other.worker.project === task.worker.project &&
          !other.worker.isolation &&
          !other.isolate &&
          (other.worker.mode === 'accept-edits' || task.worker.mode === 'accept-edits')
        if (
          this.mainWrites.has(task.worker.project) ||
          [...this.running].some(conflicts) ||
          this.queue.slice(0, this.queue.indexOf(task)).some(conflicts)
        ) {
          if (this.mainWrites.has(task.worker.project) || !this.canIsolate(task)) continue
          task.isolate = true
        }
      }
      this.queue.splice(this.queue.indexOf(task), 1)
      this.running.add(task)
      void this.run(task).catch((error) => {
        this.finish(task, 'failed', String(error))
      })
    }
  }
  /**
   * Only a new writer with no native session may move into a copy: CLI
   * sessions are tied to their working directory and cannot change it.
   */
  private canIsolate(task: Task): boolean {
    const worker = task.worker
    return (
      !!this.storage.generalSettings().isolatedParallelWrites &&
      worker.mode === 'accept-edits' &&
      !task.isolationRefused &&
      !worker.conversationId &&
      !readWorkerForkState(this.storage.directory, worker.id)?.sourceConversationId
    )
  }
  /** The CLI's working directory: the bound copy, or the project itself. */
  executionDirectory(worker: Worker): string {
    return worker.isolation?.path ?? worker.project
  }
  /** Metadata processes need an existing directory; a released copy is recreated only for a turn. */
  catalogDirectory(worker: Worker): string {
    return worker.isolation && isolatedCopyExists(isolationRoot(this.storage.directory), worker.id, worker.project)
      ? worker.isolation.path
      : worker.project
  }
  /**
   * Creates (or recreates at the bound path) this Worker's copy. Returns the
   * copy path, or undefined when the task went back to the serial queue.
   */
  private async prepareIsolation(task: Task): Promise<string | undefined> {
    const { worker, controller } = task
    const root = isolationRoot(this.storage.directory)
    const bound = worker.isolation
    if (bound && bound.state !== 'released') {
      if (!isolatedCopyExists(root, worker.id, worker.project)) throw new Error('隔离副本目录已缺失，请丢弃后新建对话')
      return bound.path
    }
    mkdirSync(root, { recursive: true, mode: 0o700 })
    const path = workspacePaths(realpathSync(root), worker.id, worker.project).copy
    if (bound && bound.path !== path) throw new Error('隔离副本路径与会话记录不一致，请新建对话')
    worker.isolation = { state: 'preparing', path }
    this.storage.save(worker)
    this.changed()
    try {
      const created = await createIsolatedWorkspace({
        root,
        workerId: worker.id,
        project: worker.project,
        signal: controller.signal,
      })
      // A stop that lands after the last copy step must not leave a fresh copy behind.
      controller.signal.throwIfAborted()
      worker.isolation = {
        state: 'ready',
        path: created.path,
        createdAt: new Date().toISOString(),
        ...(created.skippedLinks ? { skippedLinks: created.skippedLinks } : {}),
      }
      this.storage.save(worker)
      this.storage.append(worker, {
        kind: 'diagnostic',
        text: bound ? '已重新创建隔离副本' : '已创建隔离副本',
        detail: `本轮在隔离副本中运行：${created.path}${
          created.skippedLinks ? `\n跳过 ${created.skippedLinks} 个指向项目外或无法重建的符号链接` : ''
        }`,
      })
      this.changed()
      // Verify the account against the directory the CLI will actually read.
      const original = task.admission
      task.admission = original.then(() =>
        readCliAccountBinding(cliOf(worker.preference), this.backend, this.config, created.path, controller.signal),
      )
      void task.admission.catch((error) => {
        if (!controller.signal.aborted) task.admissionFailure ??= { error }
        if (error instanceof ProcessCleanupUnconfirmedError) {
          task.admissionFailure ??= { error }
          this.blockCatalogOnCleanup(cliOf(worker.preference), error)
        }
      })
      return created.path
    } catch (error) {
      // No copy existed before this preparation, so whatever is there is ours to remove.
      await removeIsolatedWorkspace(root, worker.id).catch(() => undefined)
      worker.isolation = bound ? { state: 'released', path: bound.path } : undefined
      if (bound || controller.signal.aborted) {
        this.storage.save(worker)
        this.changed()
        throw error
      }
      const reason = error instanceof IsolationUnavailableError ? error.message : `无法创建隔离副本：${String(error)}`
      worker.isolationNotice = `${reason}；已改为排队，等待主目录空闲`
      this.storage.save(worker)
      this.storage.append(worker, { kind: 'diagnostic', text: '未创建隔离副本', detail: worker.isolationNotice })
      this.changed()
      return undefined
    }
  }
  private finish(
    task: Task,
    status: Worker['status'],
    error?: string,
    interruptionReason?: Worker['interruptionReason'],
  ): void {
    const worker = task.worker
    if (task.carryover && !worker.conversationId) {
      // The new session never started (including a stop while waiting for the
      // account); keep the original, its uncombined usage and its rebound state.
      worker.conversationId = task.carryover.previousConversationId
      worker.previousSessionUsage = task.carryover.previousSessionUsage
      if (task.carryover.forkState) writeWorkerForkState(this.storage.directory, worker.id, task.carryover.forkState)
    }
    worker.status = status
    worker.error = error
    worker.interruptionReason = interruptionReason
    worker.updatedAt = new Date().toISOString()
    try {
      const telemetry = this.runTelemetry(worker, worker.runId)
      worker.conversationTelemetry = captureConversationTelemetry(worker, telemetry)
      worker.lastRunUsageSnapshot = captureLastRunUsageSnapshot(worker, telemetry)
      worker.contextTelemetry = captureContextTelemetry(worker, telemetry)
      if (task.priority) {
        const message = this.priorityHistory.get(worker.id)?.get(task.queuedFollowupId!)
        if (message && !deliveryTerminal(message.state))
          this.updatePriority(
            worker,
            message,
            status === 'completed' ? 'completed' : interruptionReason === 'user' ? 'cancelled' : 'failed',
            error ??
              (interruptionReason === 'user'
                ? message.spawnAttempted
                  ? '已停止'
                  : '已停止发送'
                : undefined),
          )
      }
      this.storage.save(worker)
      this.storage.append(worker, {
        kind: 'status',
        text: error ?? (interruptionReason === 'user' ? '已停止' : status),
        state: status,
      })
    } catch (error) {
      worker.status = 'failed'
      worker.error = `状态持久化失败：${String(error)}`
      worker.interruptionReason = undefined
      this.blocked = worker.error
    } finally {
      if (this.tasks.get(worker.id) === task) this.tasks.delete(worker.id)
      this.running.delete(task)
      if (worker.status !== 'completed' && !task.preserveFollowups)
        this.pauseFollowups(
          worker.id,
          isUserInterrupted(worker)
            ? '任务已停止，请确认后继续发送'
            : worker.status === 'uncertain'
              ? '结果待核实，请核查后继续发送'
              : '前轮未正常完成，请确认后继续发送',
          task.generation,
        )
      const outcome = structuredClone(worker)
      this.changed()
      // A later followup mutates the live worker. Completion consumers must retain
      // the exact outcome of this run, including its runId and response.
      task.settle(outcome)
      this.drain()
      if (worker.status === 'completed') this.dispatchFollowup(worker)
    }
  }
  private async run(task: Task): Promise<void> {
    let directory = task.worker.project
    if (task.isolate || task.worker.isolation) {
      let prepared: string | undefined
      try {
        prepared = await this.prepareIsolation(task)
      } catch (error) {
        const stopped = task.controller.signal.aborted
        await this.finishQueued(
          task,
          stopped ? 'interrupted' : 'failed',
          stopped ? '用户已取消排队任务' : String(error instanceof Error ? error.message : error),
        )
        return
      }
      if (!prepared) {
        // Back to the serial queue at its original admission position.
        this.running.delete(task)
        task.isolate = false
        task.isolationRefused = true
        const index = this.queue.findIndex((other) => other.order > task.order)
        this.queue.splice(index < 0 ? this.queue.length : index, 0, task)
        this.changed()
        this.drain()
        return
      }
      directory = prepared
    }
    await this.execute(task, directory)
  }
  private async execute(task: Task, directory: string): Promise<void> {
    const { worker, controller } = task
    const isolated = directory !== worker.project
    const prompt = isolated ? isolationPromptNotice(directory, worker.project) + task.prompt : task.prompt
    let handle: SubprocessHandle | undefined
    let readers: Promise<void>[] = []
    let harnessLease: { connection?: NativeHarnessConnection; close(): Promise<void> } | undefined
    let stderr = ''
    let totalBytes = 0
    // Settings saved while this turn runs apply to later turns only.
    const settings = this.generalSettings()
    const limit = (task.timeLimit ??= taskTimeLimit(settings.taskTimeLimitMs, settings.idleTimeLimitMs))
    const timeout = setTimeout(
      () => controller.abort(new Error(timeLimitMessage('total', limit))),
      remainingMs(limit),
    )
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const pendingFork = readWorkerForkState(this.storage.directory, worker.id)
    const resumeConversation = worker.conversationId ?? pendingFork?.sourceConversationId
    const expectedConversation = worker.conversationId
    const nativeTransport = usesNativeBridge(worker)
    // The native bridge renews its own idle window; other transports are timed on their output here.
    let idleHolds = 0
    const touchIdle =
      !nativeTransport && limit.idleMs > 0
        ? () => {
            clearTimeout(idleTimer)
            // A user deciding an approval is not the CLI going quiet.
            if (idleHolds) return
            idleTimer = setTimeout(() => controller.abort(new Error(timeLimitMessage('idle', limit))), limit.idleMs)
          }
        : undefined
    task.approvals = new AbortController()
    // Bound to the prepared launch's approval mailbox once it exists.
    let answerApproval: ((id: string, decision: NativeApprovalDecision) => Promise<void>) | undefined
    const relay = (id: string, request: NativeApprovalRequest) => {
      idleHolds++
      clearTimeout(idleTimer)
      let released = false
      this.relayApproval(task, request, (decision) => {
        if (!released) {
          released = true
          idleHolds--
          touchIdle?.()
        }
        return answerApproval ? answerApproval(id, decision) : Promise.reject(new Error('授权通路未就绪'))
      })
    }
    // OMP's tool approvals reach the Host through its RPC bridge as well.
    const createProtocol = nativeTransport || cliOf(worker.preference) === 'omp'
      ? (
          _cli: CliId,
          emit: Parameters<typeof protocolFor>[1],
          identify: Parameters<typeof protocolFor>[2],
          limit: number,
        ) => new BridgeProtocol(emit, identify, limit, relay)
      : protocolFor
    // Any reply, reasoning, tool event or delivered result means the resumed turn already started.
    let observed = false
    let spawned = false
    const protocol = createProtocol(
      cliOf(worker.preference),
      (event) => {
        if (
          event.kind === 'assistant' ||
          event.kind === 'reasoning' ||
          event.kind === 'tool' ||
          (event.kind === 'result' && (event.state === 'SUCCESS' || !!event.text.trim()))
        )
          observed = true
        if (event.observedModel) {
          worker.observedModel = event.observedModel
          this.storage.save(worker)
        }
        this.storage.append(worker, projectPublicToolCall(cliOf(worker.preference), event))
        this.changed()
      },
      (id) => {
        if (expectedConversation && id !== expectedConversation)
          throw new Error('Resume conversation_id does not match the requested conversation')
        if (pendingFork?.sourceConversationId === id) throw new Error('原生分支没有创建新的会话 ID')
        const left = task.carryover?.previousConversationId
        if (task.carryover && left !== id && !worker.conversationId) {
          if (left && !worker.previousConversationIds?.includes(left))
            worker.previousConversationIds = [...(worker.previousConversationIds ?? []), left].slice(-64)
          worker.carryoverRunId = worker.runId
          worker.reboundConversationId = undefined
        }
        worker.conversationId = id
        this.storage.save(worker)
        if (pendingFork?.sourceConversationId) {
          const { sourceConversationId: _source, sourceMessageId: _cut, ...settled } = pendingFork
          writeWorkerForkState(this.storage.directory, worker.id, settled)
        }
      },
      this.config.maxLineBytes,
      worker.preference.model,
    )
    let failure: unknown
    let failureBeforeStop = false
    let releaseFailed = false
    let summaryConflict: string | undefined
    let release: (() => void | Promise<void>) | undefined
    let quiescent = false
    let metadataReady = false
    let busyAccount = false
    let accountRaced = false
    let rebound = false
    let reboundResume = false
    try {
      let admitted = await task.admission
      task.accountKey = JSON.stringify([cliOf(worker.preference), admitted])
      controller.signal.throwIfAborted()
      const previousBinding = this.storage.accountBinding(worker.id)
      // Every turn follows the own account signed in now; the selected model and
      // effort are authorized again under it (continue-tasks-across-account-changes).
      const continuing = !!previousBinding || !!resumeConversation
      const authorize = () =>
        authorizeSelection(worker.preference, this.backend, this.config, directory, controller.signal, admitted)
      let authorized: Awaited<ReturnType<typeof authorize>>
      try {
        authorized = await authorize()
      } catch (error) {
        // A turn admitted under the previous account re-reads the current one once.
        if (!(error instanceof Error) || error.message !== ACCOUNT_CHANGED) throw error
        admitted = await readCliAccountBinding(
          cliOf(worker.preference),
          this.backend,
          this.config,
          directory,
          controller.signal,
        )
        task.accountKey = JSON.stringify([cliOf(worker.preference), admitted])
        authorized = await authorize()
      }
      const { binding, preference: authorizedPreference } = authorized
      if (authorizedPreference.model !== worker.preference.model)
        throw new Error('模型与思考强度不匹配，请重新选择')
      controller.signal.throwIfAborted()
      rebound = continuing && previousBinding !== binding
      // Kept until the session resumes under this account, so a retry after a
      // failed carryover can still carry it over.
      // A pending Claude branch resumes its source; a rejected fork is carried over the same way.
      if (rebound && resumeConversation) worker.reboundConversationId = resumeConversation
      reboundResume = !!resumeConversation && worker.reboundConversationId === resumeConversation
      if (
        reboundResume &&
        !task.carryover &&
        (crossAccountResume(cliOf(worker.preference)) === 'carryover' ||
          nativeSessionReachable({
            cli: cliOf(worker.preference),
            transport: worker.transport,
            hermesHome:
              cliOf(worker.preference) === 'hermes'
                ? effectiveHermesHome({ ...this.config, stateDirectory: this.storage.directory })
                : undefined,
          }) === false)
      )
        throw new CarryoverRequiredError()
      this.assertCliEnabled(cliOf(worker.preference))
      const executable = await resolveCliExecutable(
        cliOf(worker.preference),
        this.backend,
        this.config,
        controller.signal,
      )
      controller.signal.throwIfAborted()
      await assertFirstPartyConfiguration(cliOf(worker.preference), directory, controller.signal)
      metadataReady = true
      // One tier snapshot drives both the launch and the bridge catalog built from it.
      const access = this.accessSnapshot?.(worker)
      harnessLease = await this.harnessPreparation?.(worker, controller.signal, { submissionId: task.submissionId, isolated, access })
      if (access) this.storage.append(worker, { kind: 'status', text: `本轮权限：${ACCESS_LABELS[access]}` })
      // No confirmed native full-access mode: the CLI keeps its stricter write mode.
      if (access === 'danger-full-access' && ['kimi', 'hermes', 'antigravity'].includes(cliOf(worker.preference)))
        this.storage.append(worker, { kind: 'status', text: '该 CLI 没有已确认的原生完全权限模式，本轮按其写入模式运行；授权请求自动放行' })
      // 仅可查看 launches every CLI in its native read-only/plan mode.
      const launchMode: TaskMode = access === 'read-only' ? 'plan' : worker.mode
      task.launchMode = launchMode
      const executionConfig = { ...this.config, timeLimit: limit,
        ...(access ? { access } : {}),
        ...(task.attachments?.length ? { attachments: task.attachments } : {}),
        ...(harnessLease?.connection ? { harnessTools: harnessLease.connection } : {}),
      }
      worker.status = 'running'
      this.storage.save(worker)
      this.changed()
      const selectedClaudeRoute =
        cliOf(worker.preference) === 'claude'
          ? await readClaudeOwnRoute(directory, controller.signal)
          : undefined
      // Bind the exact prepared snapshot as well as the current source. A -> B -> A
      // configuration changes must not authorize launching B under A's admission.
      if (
        selectedClaudeRoute &&
        binding !==
          (await readCliAccountBinding(
            'claude',
            this.backend,
            executionConfig,
            directory,
            controller.signal,
            selectedClaudeRoute,
          ))
      )
        throw new Error(ACCOUNT_CHANGED)
      const relayEnv =
        cliOf(worker.preference) === 'codex' ? await codexRouteEnvironment(directory, controller.signal) : {}
      const launch = isExtendedCli(cliOf(worker.preference))
        ? await extendedLaunch(
            cliOf(worker.preference),
            executable,
            directory,
            worker.preference,
            launchMode,
            prompt,
            this.nativeStateDirectory(worker),
            executionConfig,
            resumeConversation,
            (argv, env) =>
              captureCatalogMetadata(this.backend, this.config, argv, directory, controller.signal, env),
            {
              backend: this.backend,
              signal: controller.signal,
              graceMs: this.config.graceMs,
            },
            nativeTransport,
          )
        : cliOf(worker.preference) === 'claude'
          ? await prepareClaudeWorkerLaunch(
              selectedClaudeRoute!,
              workerArguments(
                executable,
                directory,
                worker.preference,
                launchMode,
                prompt,
                Math.max(1000, remainingMs(limit)),
                resumeConversation,
                nativeTransport,
                access,
              ),
              this.storage.directory,
              controller.signal,
            )
          : {
              env: {
                ...firstPartyEnvironment(cliOf(worker.preference)),
                ...relayEnv,
                ...agyBackgroundEnvironment(cliOf(worker.preference)),
                ...(['qoder', 'qodercn'].includes(cliOf(worker.preference)) ? qoderEnvironment(cliOf(worker.preference) as 'qoder' | 'qodercn') : {}),
              },
              argv: workerArguments(
                executable,
                directory,
                worker.preference,
                launchMode,
                prompt,
                Math.max(1000, remainingMs(limit)),
                resumeConversation,
                nativeTransport,
                access,
              ),
            }
      // Preparation can already own a private credential snapshot. Retain its
      // cleanup before any later filesystem or native-bridge setup can fail.
      release = 'cleanup' in launch ? launch.cleanup : undefined
      const nativeState = this.nativeStateDirectory(worker)
      if (nativeTransport) mkdirSync(nativeState, { recursive: true, mode: 0o700 })
      const execution =
        nativeTransport && !isExtendedCli(cliOf(worker.preference))
          ? await prepareNativeWorker(
              launch,
              {
                cli: cliOf(worker.preference),
                project: directory,
                preference: worker.preference,
                mode: launchMode,
                ...(access ? { access } : {}),
                prompt: prompt,
                conversationId: expectedConversation,
                ...(pendingFork?.sourceConversationId ? { forkSource: { conversationId: pendingFork.sourceConversationId, messageId: pendingFork.sourceMessageId! } } : {}),
                stateDirectory: nativeState,
                ...(task.attachments?.length ? { attachments: task.attachments } : {}),
                ...(harnessLease?.connection ? { harnessTools: harnessLease.connection } : {}),
                ...(selectedClaudeRoute?.source
                  ? {
                      claudeModelCandidates: selectedClaudeRoute.source.nativeModels
                        .filter(({ choice }) => choice.id === worker.preference.model)
                        .map(({ choice, remoteId }) => ({
                          value: choice.id,
                          resolvedModel: remoteId,
                        })),
                    }
                  : {}),
              },
              executionConfig,
            )
          : launch
      release = 'cleanup' in execution ? execution.cleanup : undefined
      if ('answerApproval' in execution && typeof execution.answerApproval === 'function')
        answerApproval = execution.answerApproval as typeof answerApproval
      controller.signal.throwIfAborted()
      if (
        binding !==
        (await readCliAccountBinding(
          cliOf(worker.preference),
          this.backend,
          this.config,
          directory,
          controller.signal,
        ))
      )
        throw new Error(ACCOUNT_CHANGED)
      controller.signal.throwIfAborted()
      if ('activate' in execution && typeof execution.activate === 'function') await execution.activate()
      controller.signal.throwIfAborted()
      if (task.queuedFollowupId) this.queuedExecutionGuard?.(worker)
      this.storage.bindAccount(worker.id, binding)
      if (task.queuedFollowupId && !task.priority && !task.delivered) {
        if (
          this.tasks.get(worker.id) !== task ||
          this.followups.list(worker.id).find((item) => item.id === task.queuedFollowupId)?.state !==
            'sending'
        )
          throw new UserStoppedError()
      }
      if (task.priority && !task.delivered) {
        const message = this.latestPriority.get(worker.id)
        if (!message || message.id !== task.queuedFollowupId || message.controller.signal.aborted)
          throw new UserStoppedError()
        // No await separates this ownership check from the native spawn attempt.
        message.spawnAttempted = true
      }
      task.spawnAttempted = true
      spawned = true
      handle = await spawnManagedAgent(this.backend, {
        argv: execution.argv,
        env: 'env' in execution ? execution.env : undefined,
        cwd: directory,
        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
        graceMs: this.config.graceMs,
        signal: controller.signal,
      })
      if (task.queuedFollowupId && !task.priority && !task.delivered) {
        this.storage.append(worker, {
          kind: 'user',
          text: task.userPrompt,
          queuedFollowupId: task.queuedFollowupId,
          admittedRunId: worker.runId,
        })
        this.followups.remove(worker.id, task.queuedFollowupId)
        this.changed()
      }
      if (task.priority && !task.delivered) {
        const message = this.priorityHistory.get(worker.id)!.get(task.queuedFollowupId!)!
        this.updatePriority(worker, message, 'running')
      }
      task.delivered = true
      // Observe spawn rejection immediately even while draining protocol streams.
      void handle.done.catch(() => undefined)
      touchIdle?.()
      controller.signal.throwIfAborted()
      if ('steer' in execution && typeof execution.steer === 'function') {
        task.steer = execution.steer
        this.changed()
      }
      if ('stop' in execution && typeof execution.stop === 'function')
        task.nativeStop = execution.stop as () => Promise<void>
      // Before a CLI process is actually launched, a rejected account/model or
      // permission check must leave the original outbox message recoverable.
      const capture = async (stream: SubprocessHandle['stdout'], isError: boolean) => {
        if (!stream) throw new Error('CLI pipe unavailable')
        const decoder = new StringDecoder('utf8')
        for await (const chunk of stream) {
          touchIdle?.()
          totalBytes += Buffer.byteLength(chunk)
          // The native bridge already bounds what it shows; its cumulative bytes are statistics only.
          if (!nativeTransport && totalBytes > this.config.maxRunBytes)
            throw new Error('CLI output exceeded the configured per-run limit')
          appendFileSync(this.storage.rawPath(worker) + (isError ? '.stderr' : ''), chunk, { mode: 0o600 })
          if (isError) stderr = (stderr + decoder.write(chunk)).slice(-8192)
          else protocol.feed(chunk)
        }
        if (isError) stderr = (stderr + decoder.end()).slice(-8192)
      }
      readers = [capture(handle.stdout, false), capture(handle.stderr, true)]
      await Promise.all(readers)
      const outcome = await handle.done
      controller.signal.throwIfAborted()
      protocol.end()
      // A bridge that ended on its own timer stops the turn like the Host timer does.
      const expired =
        protocol instanceof BridgeProtocol && protocol.result?.status === 'ERROR'
          ? bridgeTimeLimit(protocol.result.error)
          : undefined
      if (expired) controller.abort(new Error(timeLimitMessage(expired, limit)))
      controller.signal.throwIfAborted()
      // Native cancellation may close its bridge before the mailbox sender has
      // polled the receipt and aborted the outer Host range. Warnings on stderr
      // must not replace this exact, run-scoped cancellation evidence.
      if (
        task.nativeStopRequested &&
        protocol.result?.status === 'ERROR' &&
        protocol.result.error === '任务已停止'
      )
        throw new UserStoppedError()
      if (outcome.exitCode !== 0)
        throw new Error(
          `CLI exited with ${outcome.exitCode}: ${stderr || protocol.result?.response || 'no diagnostic'}`,
        )
      if (!protocol.result) throw new Error('CLI exited without a final result')
      if (
        protocol instanceof AgyProtocol &&
        expectedConversation &&
        protocol.result.conversationId === expectedConversation &&
        protocol.result.status === 'ERROR' &&
        protocol.result.completedStepResponse
      )
        summaryConflict = `CLI 汇总状态冲突，结果待核实：本轮回复及已观察步骤均为 DONE，但 CLI 最终报告 ERROR。请核查本轮输出和实际产物，不要自动重试。原始汇总错误：${protocol.result.error || '未提供错误详情'}`
      // Native runners and the Pi/OMP bridge share this frame and its unverified outcome.
      else if (protocol instanceof BridgeProtocol && protocol.result.status === 'UNCERTAIN')
        summaryConflict =
          protocol.result.error || 'CLI 汇总状态冲突，结果待核实，请先核查实际产物，不要自动重试'
      else if (protocol.result.status !== 'SUCCESS')
        throw new Error(
          `CLI ${protocol.result.status}: ${protocol.result.error || protocol.result.response || stderr || '请检查 CLI 认证及模型/强度兼容性'}`,
        )
      else if (protocol instanceof BridgeProtocol && protocol.result.notice) {
        worker.resultNotice = protocol.result.notice
        this.storage.append(worker, { kind: 'diagnostic', text: '本轮结果说明', detail: protocol.result.notice })
      }
    } catch (error) {
      failure = error
      // A bridge timer that expired before any session arrives as the protocol error itself.
      const expired = nativeTransport && !controller.signal.aborted ? bridgeTimeLimit(error) : undefined
      if (expired) controller.abort(new Error(timeLimitMessage(expired, limit)))
      // Per attempt: a carryover after a spawned resume can still wait for its account.
      busyAccount = accountBusy(error) && !spawned
      // Nothing reached a CLI yet, so the turn can be authorized again under the new account.
      accountRaced = !spawned && error instanceof Error && error.message === ACCOUNT_CHANGED
      failureBeforeStop =
        !!task.admissionFailure ||
        (!controller.signal.aborted &&
          !(
            task.nativeStopRequested &&
            (error instanceof UserStoppedError || String(error).includes('任务已停止'))
          ))
      if (error instanceof ProcessCleanupUnconfirmedError) {
        if (!metadataReady) this.blockCatalogOnCleanup(cliOf(worker.preference), error)
        else this.markCleanupBlocked(error)
      }
    } finally {
      clearTimeout(timeout)
      clearTimeout(idleTimer)
      // Withdraw prompts still open when the CLI exits or the protocol fails.
      task.approvals?.abort(new Error('当前运行已结束，授权请求已撤回'))
      if (worker.approvalWaiting) {
        delete worker.approvalWaiting
        this.changed()
      }
      task.steer = undefined
      task.nativeStop = undefined
      task.steeringController.abort(new Error('当前运行已结束，引导通路已关闭'))
      if (handle) {
        handle.terminate()
        try {
          if (!(await handle.waitForExit())) throw new Error('CLI cleanup did not reach quiescence')
          quiescent = true
        } catch (error) {
          failure = error
          this.markCleanupBlocked(error)
        }
        await Promise.allSettled([...readers, handle.done])
      }
      // Preserve only this process's observed AGY text when its aggregate is
      // unsuccessful or absent. Native result text can include older turns.
      if (protocol instanceof AgyProtocol)
        worker.lastResult =
          protocol.result?.status === 'SUCCESS'
            ? protocol.result.response
            : protocol.currentTurnResponse || undefined
      else if (protocol.result) worker.lastResult = protocol.result.response
    }
    await Promise.allSettled([...task.steering.values()].map((entry) => entry.done))
    try {
      await harnessLease?.close()
    } catch (error) {
      failure = error
      releaseFailed = true
    }
    try {
      if ((!handle || quiescent) && !this.blocked) await release?.()
    } catch (error) {
      failure = error
      releaseFailed = true
      if (error instanceof ProcessCleanupUnconfirmedError) this.markCleanupBlocked(error)
    }
    if (stderr.trim())
      this.storage.append(worker, {
        kind: 'diagnostic',
        text: 'CLI 诊断',
        detail: stderr,
      })
    let status: Worker['status'] = 'completed'
    let error: string | undefined
    let interruptionReason: Worker['interruptionReason']
    if (this.blocked) {
      status = 'failed'
      error = this.blocked
    } else if (failureBeforeStop || releaseFailed) {
      status = 'failed'
      error = String(failure)
    } else if (summaryConflict) {
      status = 'uncertain'
      error = summaryConflict
    } else if (controller.signal.aborted || task.nativeStopRequested) {
      status = 'interrupted'
      if (controller.signal.reason instanceof UserStoppedError || task.nativeStopRequested)
        interruptionReason = 'user'
      else error = String(controller.signal.reason)
    } else if (failure) {
      status = 'failed'
      error = String(failure)
    }
    if (busyAccount && failureBeforeStop && !task.admissionFailure && !releaseFailed && !this.blocked && !this.disposed)
      return this.waitForAccount(task)
    if (
      accountRaced &&
      !task.accountRaceRetried &&
      failureBeforeStop &&
      !task.admissionFailure &&
      !releaseFailed &&
      !this.blocked &&
      !this.disposed
    ) {
      task.accountRaceRetried = true
      return this.waitForAccount(task, 0)
    }
    const unreachable = failure instanceof CarryoverRequiredError
    if (
      !task.carryover &&
      !this.blocked &&
      !this.disposed &&
      !releaseFailed &&
      failureBeforeStop &&
      !task.admissionFailure &&
      !controller.signal.aborted &&
      !task.nativeStopRequested &&
      (unreachable ||
        // Only a resume rejected before any reply or tool event is safe to redo in a new session.
        (reboundResume &&
          spawned &&
          quiescent &&
          !observed &&
          !task.steerSubmitted &&
          !(failure instanceof ProcessCleanupUnconfirmedError)))
    )
      return this.carryOver(task, directory, unreachable)
    // The resumed session answered under the current account.
    if (!task.carryover && reboundResume && (observed || status === 'completed')) {
      worker.reboundConversationId = undefined
      this.storage.save(worker)
    }
    this.finish(task, status, error, interruptionReason)
  }
  /** Continue this turn in a new native session with the task's own earlier record. */
  private async carryOver(task: Task, directory: string, unreachable: boolean): Promise<void> {
    const { worker } = task
    const context = carryoverContext(this.storage.history(worker.id), worker.runId)
    const fork = readWorkerForkState(this.storage.directory, worker.id)
    task.carryover = {
      previousConversationId: worker.conversationId,
      previousSessionUsage: worker.previousSessionUsage,
      ...(fork?.sourceConversationId ? { forkState: fork } : {}),
    }
    // The new session starts fresh instead of forking the source again.
    if (fork?.sourceConversationId) {
      const { sourceConversationId: _source, sourceMessageId: _cut, ...settled } = fork
      writeWorkerForkState(this.storage.directory, worker.id, settled)
    }
    // Token usage keeps counting across sessions; the context window is the new session's own.
    const left = captureConversationTelemetry(worker, this.runTelemetry(worker, worker.runId))
    if (left) worker.previousSessionUsage = addSessionUsage(worker.previousSessionUsage, left.usage)
    worker.conversationId = undefined
    this.storage.save(worker)
    this.storage.append(worker, {
      kind: 'diagnostic',
      text: unreachable ? CARRYOVER_UNREACHABLE_NOTICE : CARRYOVER_FAILED_NOTICE,
      detail: context.omitted
        ? `已附带此前 ${context.included} 条记录，省略 ${context.omitted} 条`
        : `已附带此前 ${context.included} 条记录`,
    })
    // A new session receives the role prompt again, then the history, then this message.
    task.prompt = withGoal(task.goal, promptForWorker(worker, context.text + task.userPrompt))
    task.steeringController = new AbortController()
    this.changed()
    return this.execute(task, directory)
  }
  /**
   * A Pi/OMP OAuth account serves one run at a time. Its process never started,
   * so the turn returns to its queue position without holding a slot.
   */
  private waitForAccount(task: Task, delay = ACCOUNT_RETRY_MS): void {
    const { worker } = task
    this.running.delete(task)
    // An account change is retried silently; only a busy account is worth telling.
    if (!task.accountWait && delay > 0)
      this.storage.append(worker, { kind: 'diagnostic', text: '账号正被另一个任务使用，排队等待' })
    task.accountWait = { retryAt: Date.now() + delay }
    // Nothing was spawned; the next attempt opens its own steering channel and time limit.
    task.steeringController = new AbortController()
    task.timeLimit = undefined
    worker.status = 'queued'
    worker.error = undefined
    this.storage.save(worker)
    const index = this.queue.findIndex((other) => other.order > task.order)
    this.queue.splice(index < 0 ? this.queue.length : index, 0, task)
    this.changed()
    this.drain()
  }
  private retryDrain(delay: number): void {
    if (this.accountRetry || this.disposed) return
    this.accountRetry = setTimeout(() => {
      this.accountRetry = undefined
      this.drain()
    }, delay)
  }

  /** Idle, unbound-from-operations Worker with an existing copy. */
  private isolationTarget(parent: string, id: string): Worker {
    const worker = this.get(parent, id)
    if (this.disposed) throw new Error('CLI Worker is shutting down')
    const isolation = worker.isolation
    if (!isolation || isolation.state === 'released' || isolation.state === 'preparing')
      throw new Error('此任务没有待合并的隔离副本')
    if (this.isolationOperations.has(id)) throw new Error('正在合并或丢弃隔离副本，请稍后再试')
    if (this.busyReason(worker) || this.tasks.has(id)) throw new Error('请等待本轮结束后再合并或丢弃隔离副本')
    return worker
  }
  /** Ends the copy binding after its directory is confirmed gone. */
  private releaseIsolation(worker: Worker, text: string): void {
    const path = worker.isolation!.path
    // A conversation never started in the copy has nothing tied to its path.
    worker.isolation = worker.conversationId ? { state: 'released', path } : undefined
    this.storage.save(worker)
    this.storage.append(worker, { kind: 'diagnostic', text })
  }
  /**
   * Three-way merge of the copy into the project as uncommitted changes.
   * Nothing is written while any undecided path conflicts; the copy is then kept.
   */
  async mergeIsolation(
    parent: string,
    id: string,
    signal?: AbortSignal,
    resolutions?: Readonly<Record<string, MergeResolution>>,
  ): Promise<MergeResult> {
    const worker = this.isolationTarget(parent, id)
    const project = worker.project
    if (this.mainWrites.has(project)) throw new Error('该项目正在写回另一个隔离副本，请稍后再试')
    const writer = [...this.running].find(
      (task) => task.worker.project === project && !task.worker.isolation && !task.isolate && task.worker.mode === 'accept-edits',
    )
    if (writer) throw new Error('主目录中有写任务正在运行，请等它结束后再合并')
    const previous = worker.isolation!
    const root = isolationRoot(this.storage.directory)
    const done = (async () => {
      worker.isolation = { ...previous, state: 'merging', message: undefined }
      this.storage.save(worker)
      this.changed()
      try {
        const result = await mergeIsolatedWorkspace({ root, workerId: id, project, signal, resolutions })
        if (result.status === 'conflict') {
          worker.isolation = { ...previous, state: 'conflict', conflicts: result.conflicts.slice(0, 200), message: undefined }
          this.storage.save(worker)
          this.storage.append(worker, {
            kind: 'diagnostic',
            text: `${result.conflicts.length} 个文件两边都改过，等待主 Agent 整合，主目录未改动`,
            detail: result.conflicts.map((item) => `${item.path}：${item.reason}`).join('\n'),
          })
          return result
        }
        await removeIsolatedWorkspace(root, id)
        this.releaseIsolation(
          worker,
          `已合并隔离副本：写回 ${result.written.length} 个、删除 ${result.deleted.length} 个文件（未提交）`,
        )
        return result
      } catch (error) {
        worker.isolation = { ...previous, state: previous.state, message: `合并失败：${error instanceof Error ? error.message : String(error)}` }
        this.storage.save(worker)
        throw error
      }
    })()
    return this.isolationOperation(id, 'merging', done, project)
  }
  /** Deletes the copy; reports success only after the directory is gone. */
  async discardIsolation(parent: string, id: string): Promise<void> {
    const worker = this.isolationTarget(parent, id)
    const root = isolationRoot(this.storage.directory)
    const done = (async () => {
      await removeIsolatedWorkspace(root, id)
      this.releaseIsolation(worker, '已丢弃隔离副本，主目录未改动')
    })()
    return this.isolationOperation(id, 'discarding', done)
  }
  private async isolationOperation<T>(id: string, kind: 'merging' | 'discarding', done: Promise<T>, project?: string): Promise<T> {
    this.isolationOperations.set(id, { kind, done })
    if (project) this.mainWrites.add(project)
    this.changed()
    try {
      return await done
    } finally {
      this.isolationOperations.delete(id)
      if (project) this.mainWrites.delete(project)
      this.changed()
      this.drain()
    }
  }
  async close(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    clearTimeout(this.accountRetry)
    this.accountRetry = undefined
    for (const worker of this.storage.workers.values())
      this.pauseFollowups(worker.id, 'Host 已关闭，请确认后继续发送')
    const workers = new Set([
      ...this.tasks.keys(),
      ...this.preparations.keys(),
      ...this.latestPriority.keys(),
      ...this.reservations.keys(),
      ...this.followupDispatches.keys(),
    ])
    const interruptions = [...this.priorityRunners.values()]
    await Promise.allSettled(
      // A synchronous failure in one stop must not abort the others or skip
      // releasing the store below.
      [...workers].map((id) =>
        Promise.resolve().then(() => {
          const worker = this.storage.workers.get(id)!
          return this.stop(worker.parentSessionId, id)
        }),
      ),
    )
    await Promise.allSettled(interruptions)
    await Promise.allSettled([...this.followupRuns])
    // A merge writes the user's project; let it finish rather than cut it off.
    await Promise.allSettled([...this.isolationOperations.values()].map((operation) => operation.done))
    this.listeners.clear()
    this.supplementalContextReader.clear()
    this.storage.close()
  }
}
