import { publishSiblingOutsideTool } from './harness-model-guard.ts'
import type { NativeAttachment } from './native-attachments.mjs'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { type RunOrigin } from './native-approval-policy.ts'
import {
  CLI_LABELS,
  cliOf,
  isUserInterrupted,
  workerName,
  type Preference,
  type TaskMode,
  type RoleSnapshot,
  type Worker,
} from '../shared/types.ts'
import { type WorkerPermissionReceipt } from '../shared/worker-permissions.ts'
import { type Submission } from './runtime.ts'
import { isolationGuidance } from './isolated-merge-decisions.ts'
import type { ServiceContext } from './service-context.ts'

/** Returned to the parent Agent when a Worker run was stopped from the panel or with cliworker_stop. */
export const STOPPED_BY_USER_GUIDANCE =
  '此 Worker 已被手动停止（面板停止按钮或 cliworker_stop），这是用户的决定，不是故障。除非用户在此之后明确要求继续，否则不要调用 cliworker_followup 续聊，也不要重新派遣同一任务。向用户说明进度前，先只读核查实际产物（相关文件、目录或状态），以核查结果为准，不要凭 response 推测已完成或未完成的部分；说明后等待用户指示。'

export async function launch(
  this: ServiceContext,
  agent: Agent,
  title: string,
  prompt: string,
  preference: Preference,
  mode: TaskMode,
  workerId?: string,
  identity?: { agentName?: string; role?: RoleSnapshot; initiator?: Worker['initiator'] },
  signal: AbortSignal = this.disposed.signal,
  restartSourceId?: string,
  queuedAdmission?: { id: string; expectedRunId: string; priority?: boolean },
  preparationId?: string,
  submissionId?: string,
  attachments?: readonly NativeAttachment[],
  origin: RunOrigin = 'user',
  questionSessionId?: string,
): Promise<string> {
  if (workerId && !preparationId)
    return this.runtime.prepareFollowup(
      agent.id,
      workerId,
      signal,
      (control, id) =>
        this.launch(
          agent,
          title,
          prompt,
          preference,
          mode,
          workerId,
          identity,
          control,
          restartSourceId,
          queuedAdmission,
          id,
          submissionId,
          attachments,
          origin,
          questionSessionId,
        ),
      queuedAdmission?.priority ? queuedAdmission.id : undefined,
    )
  this.assertExecution(agent, true)
  this.assertAccessSupported(
    agent,
    cliOf(preference),
    workerId ? this.runtime.get(agent.id, workerId).level : undefined,
  )
  this.runtime.assertCliEnabled(cliOf(preference))
  if (this.accounts.isBusy(cliOf(preference)))
    throw new Error('此 CLI 正在管理账号，请先关闭账号终端再启动任务')
  const project = this.project(agent)
  const selectedProject = this.selectionProjects?.get(preference)
  if (!workerId && selectedProject && selectedProject !== project) throw new Error('项目已变更，请重新选择')
  // An existing task continues under the own account signed in now; a new task's
  // choice is authorized again under it when the account changed after the choice.
  const expected = workerId ? undefined : this.selectionBindings?.get(preference)
  const { binding, preference: authorizedPreference } = await this.authorizeChoice(
    preference,
    this.backend,
    this.options,
    project,
    signal,
    expected,
  )
  if (authorizedPreference.model !== preference.model) throw new Error('模型与思考强度不匹配，请重新选择')
  if (!workerId) await this.dshSubagents.readDirectoryNames(agent.id, signal)
  signal.throwIfAborted()
  this.assertExecution(agent, true)
  this.runtime.assertCliEnabled(cliOf(preference))
  if (this.accounts.isBusy(cliOf(preference))) throw new Error('请先关闭账号终端')
  if (this.project(agent) !== project) throw new Error('项目已变更，请重新选择')
  if (restartSourceId) this.runtime.assertLegacyRestart(agent.id, restartSourceId)
  if (identity?.initiator && !workerId) this.runtime.assertSiblingCapacity(agent.id)
  let submission: Submission | undefined
  // Fixed when the turn is admitted: a later parent change applies from the next turn.
  let permission:
    | { permission: Pick<WorkerPermissionReceipt, 'level' | 'name' | 'source'>; permissionSummary: string }
    | undefined
  const publish = () =>
    agent.ctx.get('jobs')!.start({
      kind: 'cliworker',
      owner: agent.id,
      label: `${CLI_LABELS[cliOf(preference)]} · ${title} · ${workerId ? '续聊' : '新任务'}：${prompt.replace(/\s+/g, ' ').slice(0, 100)}`,
      outputLimitBytes: 12000,
      run: () => {
        const bridge = this.harnessConversation
        const submitted = this.runtime.submit(
          agent.id,
          project,
          title,
          prompt,
          preference,
          mode,
          workerId,
          identity,
          binding,
          queuedAdmission,
          preparationId,
          submissionId,
          attachments,
          bridge?.namesOnActivation && !workerId
            ? async (worker, taskSignal) => {
                signal.throwIfAborted()
                const admission = new AbortController()
                const cancel = () => admission.abort(signal.reason)
                signal.addEventListener('abort', cancel, { once: true })
                try {
                  const accepted = await bridge.ensure(agent, worker, {
                    initialRunId: worker.runId,
                    signal: AbortSignal.any([admission.signal, taskSignal]),
                  })
                  this.runtime.storage.save({ ...worker, harnessConversation: accepted })
                  worker.harnessConversation = accepted
                  this.runtime.storage.workers.set(worker.id, worker)
                  this.runtime.changed()
                } finally {
                  signal.removeEventListener('abort', cancel)
                }
              }
            : undefined,
        )
        submission = submitted
        const admittedPermission = (permission = this.permissionReceipt(agent, submitted.worker))
        // Approvals of this exact turn surface where it was started.
        const runId = submitted.worker.runId
        if (runId) {
          const origins = (this.runOrigins ??= new Map())
          origins.set(runId, origin)
          if (questionSessionId) (this.runQuestionSessions ??= new Map()).set(runId, questionSessionId)
          void submitted.done.finally(() => {
            origins.delete(runId)
            this.runQuestionSessions?.delete(runId)
          })
        }
        return {
          cancel: submitted.cancel,
          done: submitted.done.then((worker) => {
            const stoppedByUser = isUserInterrupted(worker)
            return {
              status:
                worker.status === 'completed'
                  ? ('completed' as const)
                  : worker.status === 'interrupted'
                    ? ('killed' as const)
                    : ('failed' as const),
              detail: worker.error,
              result: JSON.stringify({
                cli: cliOf(worker.preference),
                workerId: worker.id,
                agentName: workerName(worker),
                runId: worker.runId,
                task: prompt.slice(0, 300),
                status: worker.status,
                response: worker.lastResult,
                error: worker.error,
                ...(worker.status === 'completed' && worker.resultNotice
                  ? { notice: worker.resultNotice }
                  : {}),
                ...(stoppedByUser ? { stoppedBy: 'user' as const } : {}),
                ...admittedPermission,
                guidance:
                  [
                    worker.status === 'uncertain'
                      ? '结果待核实；请先核查本轮输出和实际产物，不要自动重试。'
                      : undefined,
                    // A user stop is a decision, not a failure: never resume it on your own.
                    stoppedByUser ? STOPPED_BY_USER_GUIDANCE : undefined,
                    worker.status === 'completed' && worker.resultNotice ? worker.resultNotice : undefined,
                    isolationGuidance(worker),
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined,
              }),
            }
          }),
        }
      },
    })
  const id = identity?.initiator ? publishSiblingOutsideTool(publish) : publish()
  if (!submission) throw new Error('Harness did not publish the worker job')
  this.nativeRunDone.set(submission.worker.runId, submission.done)
  const runId = submission.worker.runId
  void submission.done.then(
    () => {
      this.nativeRunDone.delete(runId)
    },
    () => {
      this.nativeRunDone.delete(runId)
    },
  )
  try {
    this.runtime.attachJob(submission.worker, id)
    await submission.nameReady
  } catch (error) {
    // Admission already happened. Do not leave a process running without a
    // receipt when the job binding cannot be persisted.
    const admitted = submission
    const outcomes = await Promise.allSettled([
      Promise.resolve().then(() => admitted.cancel()),
      admitted.done,
    ])
    const failures = outcomes.filter((item): item is PromiseRejectedResult => item.status === 'rejected')
    if (failures.length)
      throw new AggregateError(
        [error, ...failures.map((item) => item.reason)],
        '任务登记失败；取消或清理报告异常',
      )
    throw error
  }
  return JSON.stringify({
    cli: cliOf(submission.worker.preference),
    workerId: submission.worker.id,
    agentName: workerName(submission.worker),
    runId: submission.worker.runId,
    jobId: id,
    status: submission.worker.status,
    model: submission.worker.preference.model,
    effort: submission.worker.preference.effort,
    // Report this tier as is; a Worker without its own level follows the parent preset.
    ...(permission ?? this.permissionReceipt(agent, submission.worker)),
  })
}
