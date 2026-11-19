import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { HarnessConversationBinding, Worker, WorkerEvent } from '../shared/types.ts'

/** Private durable association; the three session identities are deliberately distinct. */
export interface HarnessConversationRecord {
  workerId: string
  parentSessionId: string
  sessionId: string
  /** Only the creation sentinel may attach this already admitted run. */
  initialRunId?: string
  initialPending?: boolean
  /** Authorized display-only messages for runs admitted outside the native composer. */
  pendingRuns?: Array<{ requestId: string; runId: string }>
  /** Preserved, immutable Session logs replaced after official cold-read rejection. */
  retiredSessionIds?: string[]
  /** Actual AgentLoop turn at the point this precise CLI run was routed. */
  turnRuns?: Array<{ turn: number; runId: string }>
  /** Individual native RPC identities; pending entries require a durable Worker batch receipt. */
  nativeInputs?: Array<{
    requestId: string
    promptHash: string
    batchId: string
    accepted: boolean
    /** A submitted steer must never fall back to a new CLI run on cold recovery. */
    delivery?: 'steer'
    steeringState?: 'pending' | 'rejected' | 'unknown'
  }>
}

export interface HarnessConversationRun {
  runId: string
  /** Resolves to the frozen run outcome after owned process cleanup. */
  done: Promise<Worker>
}

/** Execution and persistence remain owned by the existing Host service. */
export interface HarnessConversationDependencies {
  holdNameRegistration?(workerId: string): () => void
  reserveName?(parent: string, name: string): () => void
  retryAutomaticName?(worker: Worker, childId: string, tried: Set<string>, signal: AbortSignal): Promise<void>
  acceptedName?(worker: Worker, childId: string, registered: string, previous?: HarnessConversationRecord): void
  bindings(): readonly HarnessConversationRecord[]
  bind(record: HarnessConversationRecord): Promise<void>
  /** Exact-identity rollback when official child publication failed. */
  unbind(record: HarnessConversationRecord): Promise<void>
  /** Exact-current identity replacement; never changes the CLI conversation or history. */
  replaceBinding?(previous: HarnessConversationRecord, next: HarnessConversationRecord): Promise<void>
  getWorker(parentSessionId: string, workerId: string): Worker
  /** Includes preparation, submission leases, cleanup and non-paused queued work. */
  busy(record: HarnessConversationRecord): boolean
  /** Durable request receipt; prevents native retries from duplicating history. */
  receipt?(record: HarnessConversationRecord, prompt: string, requestId: string): boolean
  /** Read-only durable batch receipt, including after a bridge-record write failure. */
  admitted?(record: HarnessConversationRecord, requestId: string): boolean
  /** Protocol support plus the actual current process channel; no capability guessing. */
  steering?(record: HarnessConversationRecord): 'ready' | 'pending' | 'unsupported'
  /** Native current-run delivery only. Uncertain delivery must reject with STEER_UNKNOWN. */
  steer?(
    record: HarnessConversationRecord,
    prompt: string,
    runId: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<void>
  fork?(record: HarnessConversationRecord, signal: AbortSignal): Promise<string>
  /** Native slash-command query/set through the same authoritative Worker permission API. */
  permission?(
    record: HarnessConversationRecord,
    mode: string | undefined,
    signal: AbortSignal,
  ): Promise<string>
  /** Plugin-owned persistent goal; never arms Harness or CLI automatic rounds. */
  goal?(record: HarnessConversationRecord, input: string, signal: AbortSignal): Promise<string>
  /** Unbounded by the UI row limit, monotonically ordered, and scoped to this exact run. */
  events(record: HarnessConversationRecord, runId: string, afterSeq: number): readonly WorkerEvent[]
  /** Notification only. The bridge reads events with a sequence cursor after subscribing. */
  subscribe(listener: () => void): () => void
  /** Existing launch/authorization path; never a new CLI transport or model selection. */
  run(
    record: HarnessConversationRecord,
    prompt: string,
    requestId: string,
    signal: AbortSignal,
    messages?: readonly UserMessage[],
  ): Promise<HarnessConversationRun>
  /** Existing run, including complete history; never launches a task. */
  wait(record: HarnessConversationRecord, runId: string): Promise<Worker>
  /** Pin this run: a late native projection abort must never cancel a newer Worker run. */
  stop(record: HarnessConversationRecord, runId: string): Promise<void>
}

export interface HarnessConversationEnsureOptions {
  initialRunId?: string
  /** Runtime preparation only: display an admitted run, never launch it. */
  projectRun?: boolean
  /** Exact request accepted by this bridge; prevents projecting its own CLI run twice. */
  nativeSubmissionId?: string
  signal?: AbortSignal
}

export interface HarnessConversationApi {
  readonly namesOnActivation?: boolean
  forkHistory(worker: Worker, atMessageId: string, signal: AbortSignal): Promise<import('./worker-fork.ts').ForkHistory>
  createFork(parent: Agent, worker: Worker, history: import('./worker-fork.ts').ForkHistory, signal: AbortSignal): Promise<import('./worker-fork.ts').ForkChild>

  /** Explicit idle-only repair of a corrupt display Session; never launches a CLI turn. */
  repairDisplay(
    parent: Agent,
    worker: Worker,
    expectedSessionId: string,
    signal?: AbortSignal,
  ): Promise<HarnessConversationBinding>
  ensure(
    parent: Agent,
    worker: Worker,
    options?: HarnessConversationEnsureOptions,
  ): Promise<HarnessConversationBinding>
  lookup(sessionId: string): HarnessConversationRecord | undefined
  /** Stops only this bridge's active runs and releases its registrations. */
  dispose(): Promise<void>
}
