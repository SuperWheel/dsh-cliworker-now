import { ownsDirectSubagent } from './native-subagent-ownership.ts'
import { z as validate } from 'zod'
import { readNativeColdSessionState } from './native-cold-session-state.ts'
import { readHostPlanActive } from './host-plan-state.ts'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type { ApprovalRequestEvent } from '@deepseek-ai/dsh-user-approval/types'
import {
  approvalPrompt,
  approvalQuestion,
  decideApproval,
  decisionFromAnswer,
  decisionFromOutcome,
  harnessApprovalRequest,
  outcomeFromDecision,
  runAccess,
  workerApproval,
  type ApprovalOutcome,
  type NativeApprovalDecision,
  type PermissionState,
} from './native-approval-policy.ts'
import {
  CLI_LABELS,
  cliOf,
  workerName,
  type CliId,
  type TaskMode,
  type Worker,
  type WorkerLevel,
} from '../shared/types.ts'
import {
  runsUnderViewOnly,
  cliLevelOptions,
  effectiveLevel,
  workerLevelOptions,
  workerPlanSupported,
  workerPermissionReceipt,
  type WorkerPermissionState,
} from '../shared/worker-permissions.ts'
import { failure, waitForInput } from './service-errors.ts'
import type { ServiceContext } from './service-context.ts'

/**
 * @param dispatch - A CLI run (or its control), which view-only mode admits in the
 * CLI's native read-only mode. Other project or account writes (merging an
 * isolated copy, account login) stay refused under read-only.
 */
export function assertExecution(this: ServiceContext, agent: Agent, dispatch = false): void {
  if (agent.session.header.origin === 'subagent') throw new Error('MVP 只支持主对话下的直接 CLI 子 Agent')
  if (this.hostPlanActive(agent))
    throw new Error('请先退出 Harness 规划模式，再运行外部 CLI；本插件不会绕过规划边界')
  if (!dispatch && agent.ctx.get('sandboxPolicy')!.resolve({ session: agent.session }).mode === 'read-only')
    throw new Error('Harness 当前为只读权限；此操作会写入项目或账号状态，请先明确切换项目权限')
}

/**
 * In view-only mode a Worker without its own level runs at its first item: the
 * CLI's native ask mode, or Pi's tool_call gate. A CLI whose first item
 * cannot ask before a change is refused rather than silently weakened: agy's
 * plan launch keeps its terminal sandbox state writable, Kimi's default
 * auto-approves Git workspace edits, and Hermes offers no first item. A level
 * the user picked in the Worker menu runs as picked.
 */
export function assertAccessSupported(
  this: ServiceContext,
  agent: Agent,
  cli: CliId,
  level: WorkerLevel | undefined,
): void {
  if (level !== undefined || this.permissionState(agent).sandbox !== 'read-only') return
  if (cli === 'antigravity')
    throw new Error('Harness 当前为仅可查看；Antigravity 无法把授权请求转给你，请切换权限预设或改用其他 CLI')
  if (cli === 'hermes')
    throw new Error('Harness 当前为仅可查看；Hermes 没有可询问的档位，请切换权限预设或改用其他 CLI')
  if (!runsUnderViewOnly(cli))
    throw new Error(
      'Harness 当前为仅可查看；Kimi 的第一项会自动批准 Git 仓库内的编辑，请切换权限预设或改用其他 CLI',
    )
}

/** The child session's DSH sandbox and approval policy for a Worker's plan switch and level. */
export function childPermission(
  this: ServiceContext,
  parent: Agent,
  worker: Pick<Worker, 'mode' | 'level'>,
): Pick<PermissionState, 'sandbox' | 'approval'> {
  const state = this.permissionState(parent)
  const sandbox = runAccess(worker.mode, worker.level, state)
  return { sandbox, approval: workerApproval(sandbox, state) }
}

/** The tier this turn actually runs with, for the main Agent's dispatch/follow-up receipt. */
export function permissionReceipt(
  this: ServiceContext,
  parent: Agent,
  worker: Pick<Worker, 'preference' | 'mode' | 'level'>,
) {
  const receipt = workerPermissionReceipt(
    cliOf(worker.preference),
    worker.mode,
    worker.level,
    this.permissionState(parent),
  )
  return {
    permission: { level: receipt.level, name: receipt.name, source: receipt.source },
    permissionSummary: receipt.summary,
  }
}

/** Whether the parent conversation is in DSH plan mode; see {@link readHostPlanActive}. */
export function hostPlanActive(this: ServiceContext, agent: Agent): boolean {
  // Only consulted when the parent cannot see the plan service; synthetic hosts may omit `get`.
  return readHostPlanActive(agent, () => this.ctx?.get?.('sessionProjections'))
}

/** The parent's DSH permission state now: plan mode, sandbox and approval policy. */
export function permissionState(this: ServiceContext, agent: Agent): PermissionState {
  const approval = agent.ctx.get('approval')
  return {
    planMode: this.hostPlanActive(agent),
    sandbox: agent.ctx.get('sandboxPolicy')!.resolve({ session: agent.session }).mode,
    // Without an approval service nothing can be asked; DSH fails closed.
    approval: approval ? (approval.overrideOf(agent.session) ?? approval.config.policy ?? 'ask') : 'never',
  }
}

/**
 * Decide one native authorization request from the parent's current state.
 * A parent-started turn asks on the parent page; a Worker-UI turn asks in the
 * Worker's own native conversation. Any failure to ask is a denial.
 */
export async function decideNativeApproval(
  this: ServiceContext,
  worker: Worker,
  request: Parameters<typeof approvalQuestion>[0],
  signal: AbortSignal,
  /** The run's launch mode: a 仅可查看 run launched as plan denies. */
  mode: TaskMode,
): Promise<NativeApprovalDecision> {
  const parent = this.ctx.agents.get(worker.parentSessionId as Agent['id'])
  if (!parent) return { decision: 'deny', source: 'unavailable' }
  const decided = decideApproval(mode, worker.level, this.permissionState(parent))
  if (decided !== 'ask') return decided
  const cli = cliOf(worker.preference)
  const context = { worker: workerName(worker), cli: CLI_LABELS[cli], project: worker.project }
  const control = AbortSignal.any([signal, this.disposed.signal])
  const surface = this.runQuestionSessions?.get(worker.runId)
  if (surface === parent.id || (!surface && this.runOrigins?.get(worker.runId ?? '') === 'agent')) {
    const response = await waitForInput(
      parent.ctx
        .get('userQuestions')!
        .ask({ agent: parent, signal: control, questions: [approvalQuestion(request, context)] }),
      control,
    )
    return decisionFromAnswer(
      request,
      response.answers.find((item) => item.id === 'cliworker_approval'),
    )
  }
  const binding = worker.harnessConversation
  const child = this.ctx.agents.get((surface ?? binding?.sessionId) as Agent['id'])
  const approval = child?.ctx.get('approval')
  if (!child || !approval) return { decision: 'deny', source: 'unavailable' }
  // The parent may have switched presets since preparation: ask with its policy now.
  if (approval.overrideOf(child.session) !== 'ask') setApprovalPolicy(child.session, 'ask')
  const outcome = await approval.request({
    agent: child,
    toolName: `cliworker:${cli}`,
    reason: approvalPrompt(request, context),
    signal: control,
  })
  return decisionFromOutcome(outcome)
}

/**
 * Answer a DSH tool approval raised by a tool bridge call like a native
 * request: a parent-started turn asks on the parent page, a Worker-UI turn
 * keeps the child's own panel. Any other request is not ours.
 */
export async function answerHarnessApproval(
  this: ServiceContext,
  request: ApprovalRequestEvent,
  next: () => Promise<ApprovalOutcome>,
): Promise<ApprovalOutcome> {
  const call = request.callId === undefined ? undefined : this.bridgeCalls.get(request.callId)
  if (!call || call.child !== request.agent) return next()
  const { worker, runId } = call
  const summary = harnessApprovalRequest(call.name, call.arguments, request)
  const decision = await this.runtime.harnessApproval(
    worker,
    runId,
    summary,
    request.signal ?? this.disposed.signal,
    async (signal, mode) => {
      if (this.runQuestionSessions?.has(runId) || this.runOrigins?.get(runId) === 'agent')
        return this.decideNativeApproval(worker, summary, signal, mode)
      // The child's own panel answers, after the same plan and preset rules.
      const parent = this.ctx.agents.get(worker.parentSessionId as Agent['id'])
      if (!parent) return { decision: 'deny', source: 'unavailable' }
      const decided = decideApproval(mode, worker.level, this.permissionState(parent))
      if (decided !== 'ask') return decided
      // A stop must not wait on a panel nobody may answer.
      return decisionFromOutcome(await waitForInput(next(), signal))
    },
  )
  return outcomeFromDecision(decision)
}

export function assertNativeWorkerSettingsIdle(this: ServiceContext, worker: Worker): void {
  const id = worker.harnessConversation?.sessionId
  if (!id) return
  const child = this.ctx.agents.get(id as Agent['id'])
  if (child && (child.status !== 'idle' || child.inbox.nextTurn.length || child.inbox.nextStep.length))
    throw new Error('请等待原生对话结束，并发送或移除原生待发消息后再修改设置')
}

/** Update a cold child's real Session without activating an Agent or delivering input. */
export async function configureColdWorkerPermission(
  this: ServiceContext,
  parent: Agent,
  worker: Worker,
  selected: TaskMode | WorkerLevel,
  signal: AbortSignal,
): Promise<Worker> {
  const sessionId = SessionId(worker.harnessConversation!.sessionId)
  return this.runtime.prepareFollowup(
    parent.id,
    worker.id,
    AbortSignal.any([signal, this.disposed.signal]),
    async (control, preparationId) => {
      const persistence = this.ctx.get('sessionPersistence')
      const sessions = this.ctx.get('sessions')
      const query = this.ctx.get('sessionQuery')
      const projections = this.ctx.get('sessionProjections')
      if (!persistence || !sessions || !query || !projections)
        throw new Error('原生历史会话服务尚未就绪，未修改权限')
      const validateCurrent = () => {
        control.throwIfAborted()
        if (this.ctx.agents.get(parent.id) !== parent) throw new Error('所属主对话已关闭，未修改权限')
        this.assertExecution(parent, true)
        const current = this.runtime.get(parent.id, worker.id)
        const record = this.harnessConversation?.lookup(sessionId)
        if (
          this.project(parent) !== current.project ||
          current.project !== worker.project ||
          current.harnessConversation?.sessionId !== sessionId ||
          current.harnessConversation.parentSessionId !== parent.id ||
          record?.sessionId !== sessionId ||
          record.workerId !== worker.id ||
          record.parentSessionId !== parent.id
        )
          throw new Error('CLI 子会话所属主对话不匹配，未修改权限')
        this.assertNativeWorkerSettingsIdle(current)
      }
      validateCurrent()
      // The public writer is the exclusive cold-session mutation lease. It
      // also prevents a concurrent native resume from using an older mode.
      const writer = await persistence.open(sessionId, 'write', { signal: control })
      let detach: (() => void) | undefined
      try {
        validateCurrent()
        const read = await writer.read(0, undefined, { signal: control })
        validateCurrent()
        if (
          writer.header.origin !== 'subagent' ||
          writer.header.parentSession !== parent.id ||
          writer.header.cwd !== worker.project ||
          this.ctx.agents.get(sessionId)
        )
          throw new Error('CLI 子会话所属主对话不匹配，未修改权限')
        const session = sessions.prepare(sessionId, {
          seed: read.events,
          meta: structuredClone(writer.header),
          inheritedEventCount: writer.inheritedEventCount,
          eventState: read.eventState,
        })
        const { inbox, turn, plan } = readNativeColdSessionState(
          projections.stateOf(session, 'inbox'),
          projections.stateOf(session, 'turnBoundary'),
          projections.stateOf(session, 'plan'),
        )
        if (plan.running !== null) throw new Error('原生规划命令尚未完成，未修改权限')
        if (inbox['next-turn'].length || inbox['next-step'].length || turn.openTurnStartSeq !== null)
          throw new Error('请等待原生对话结束，并发送或移除原生待发消息后再修改设置')
        detach = sessions.enter(session)
        // Native restore may append a lifecycle marker before publication.
        // Read that suffix through the public query rather than private logs.
        const observation = await query.observeSession(sessionId, {
          signal: control,
          projectionMode: 'none',
        })
        try {
          const suffix = observation.events.slice(read.events.length)
          if (suffix.length) await writer.append(suffix, { signal: control })
        } finally {
          observation[Symbol.dispose]()
        }
        validateCurrent()
        sessions.announce(session)
        validateCurrent()
        const saved = this.runtime.configureWorkerPermission(parent.id, worker.id, selected, preparationId)
        const { sandbox } = this.childPermission(parent, saved)
        if (parent.ctx.get('sandboxPolicy')!.resolve({ session }).mode !== sandbox)
          setSandboxMode(session, sandbox)
        // This is the native persisted collaboration event. There is no
        // Agent to queue a pending intent or inject a synthetic user message.
        if (plan.active !== (saved.mode === 'plan') || plan.wanted !== null)
          session.append('plan/mode', { active: saved.mode === 'plan' })
        if (!(await sessions.flush(session)))
          throw new Error('原生会话权限持久化服务不可用，请重新读取当前状态')
        return saved
      } finally {
        // Finish the writer even on cancellation/failure before releasing the
        // Session and the outer Worker preparation lease.
        try {
          await writer.close()
        } finally {
          detach?.()
        }
      }
    },
  )
}

export async function permissionForWorker(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const parent = await host.parent(parentSessionId)
    signal.throwIfAborted()
    const worker = host.runtime.get(parent.id, workerId)
    if (host.project(parent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
    let reason: string | undefined
    try {
      host.assertExecution(parent, true)
      host.assertNativeWorkerSettingsIdle(worker)
      const snapshot = host.runtime.snapshot(parent.id, worker.id)
      if (snapshot.selectedBusy) throw new Error('请等待本轮结束后再修改权限')
      if (snapshot.queuedFollowups?.length)
        throw new Error('请先发送或取消待发送消息（包含已暂停消息），再修改权限')
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error)
    }
    const state: WorkerPermissionState = {
      currentValue: effectiveLevel(worker.level, host.permissionState(parent).sandbox),
      options: workerLevelOptions(worker),
      plan: { supported: workerPlanSupported(worker), active: worker.mode === 'plan' },
      writable: !reason,
      ...(reason ? { reason } : {}),
    }
    return JSON.stringify(state)
  } catch (error) {
    throw failure(error)
  }
}

export async function configureWorkerPermission(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  mode: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const parent = await host.parent(parentSessionId)
    signal.throwIfAborted()
    host.assertExecution(parent, true)
    const worker = host.runtime.get(parent.id, workerId)
    if (host.project(parent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
    const selected = validate.enum(['plan', 'accept-edits', 'ask', 'auto', 'full']).parse(mode)
    if (selected === 'plan' && !workerPlanSupported(worker)) throw new Error('当前 CLI 不支持规划模式')
    if (
      selected !== 'plan' &&
      selected !== 'accept-edits' &&
      !cliLevelOptions(cliOf(worker.preference)).some((option) => option.value === selected)
    )
      throw new Error('当前 CLI 通路不支持此权限模式')
    host.assertNativeWorkerSettingsIdle(worker)
    const binding = worker.harnessConversation
    const child = binding && host.ctx.agents.get(binding.sessionId as Agent['id'])
    if (
      binding &&
      (binding.parentSessionId !== parent.id ||
        binding.sessionId === parent.id ||
        (child &&
          (child.session.header.origin !== 'subagent' ||
            child.session.header.parentSession !== parent.id ||
            !ownsDirectSubagent(host.ctx.get('subagents'), parent, child))))
    )
      throw new Error('CLI 子会话所属主对话不匹配，未修改权限')
    if (binding && !child)
      return JSON.stringify(await host.configureColdWorkerPermission(parent, worker, selected, signal))
    const saved = host.runtime.configureWorkerPermission(parent.id, worker.id, selected)
    if (child) {
      // Keep the real session projection and tool policy aligned with the
      // saved setting while idle; the next run rechecks the same parent policy.
      const { sandbox } = host.childPermission(parent, saved)
      if (child.ctx.get('sandboxPolicy')!.resolve({ session: child.session }).mode !== sandbox)
        setSandboxMode(child.session, sandbox)
      child.ctx.get('planMode')?.set(child, saved.mode === 'plan')
    }
    return JSON.stringify(saved)
  } catch (error) {
    throw failure(error)
  }
}
