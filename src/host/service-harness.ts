import { z as validate } from 'zod'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createHarnessConversationBridge } from './harness-conversation.ts'
import { workerGoalCommand } from './harness-conversation-commands.ts'
import { HarnessConversationStore } from './harness-conversation-store.ts'
import { replaceWorkerBinding } from './worker-binding-replacement.ts'
import type { HarnessConversationRecord } from './harness-conversation-types.ts'
import {
  classifyHarnessTool,
  adoptNativeHarnessLease,
  createNativeHarnessTools,
  type NativeHarnessSkill,
} from './native-harness-tools.ts'
import { nativeHarnessToolCapability, nativeHarnessExecutionReady } from './native-harness-injection.mjs'
import { createNativeHarnessExecutor } from './native-harness-executor.ts'
import { installHarnessModelGuard, withinCliTool } from './harness-model-guard.ts'
import { readHarnessImage, resolveHarnessAttachments } from './harness-attachments.ts'
import { nativeCliCapabilities, nativeCliMcpServers } from './cli-native-capabilities.mjs'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { workerApproval } from './native-approval-policy.ts'
import { cliOf, DSH_AGENT_NAME, type Worker } from '../shared/types.ts'
import { machineDirectory as resolveMachineDirectory, projectDirectory } from './process.ts'
import { askRunsAsPlan, type WorkerPermissionState } from '../shared/worker-permissions.ts'
import { failure } from './service-errors.ts'
import type { ServiceContext } from './index.ts'

export async function parent(this: ServiceContext, id: string): Promise<Agent> {
  // Use the same composition-owned resolution policy as native Remote Agent parameters.
  await this.ctx.typert.lookups.get('agent')?.resolve(id)
  const agent = this.ctx.agents.get(id as Agent['id'])
  if (!agent) throw new Error('请先在主对话发送一条消息以激活会话，然后重试')
  if (agent.session.header.cwd) {
    try {
      this.cliManagement?.protectProject(this.project(agent))
    } catch {
      /* No usable project: nothing to protect. */
    }
  }
  return agent
}

export function project(this: ServiceContext, agent: Agent): string {
  const cwd = agent.session.header.cwd
  if (!cwd) throw new Error('此主对话没有工作目录，请先选择项目')
  if (!existsSync(cwd)) throw new Error(`此主对话的工作目录已不存在（${cwd}），请切换到有效项目`)
  return projectDirectory(cwd)
}

/**
 * The settings page manages this machine's CLIs (installation, version, login, accounts, model lists). None of
 * that belongs to a project or a conversation, so those reads and account terminals neither resolve the
 * conversation's directory nor use it as a cache key; their processes run in the plugin's own fixed directory.
 * Dispatch, follow-ups and project model preferences still go through project().
 */
export function machineDirectory(this: ServiceContext): string {
  return resolveMachineDirectory(this.options?.stateDirectory)
}

/** Where this conversation's project preferences live; undefined when it has no usable project. */
export function preferenceProject(this: ServiceContext, agent: Agent): string | undefined {
  try {
    return this.project(agent)
  } catch {
    return undefined
  }
}

/** Resolve ownership only; child status stays read-only even in plan mode. */
/** CLI Workers win; only an unmatched reference is tried against this conversation's DSH native subagents. */
export async function dshFallback<T>(
  this: ServiceContext,
  parent: string,
  args: { worker_id?: string; worker_name?: string },
  signal: AbortSignal,
  cli: () => T,
  prompt?: string,
): Promise<T | ({ kind: 'dsh-subagent' } & Record<string, unknown>)> {
  try {
    return cli()
  } catch (error) {
    const name = args.worker_name?.trim()
    if (name && !DSH_AGENT_NAME.test(name)) throw error
    if (this.runtime.snapshot(parent).showDshSubagents === false) throw error
    const ref = { id: args.worker_id, name }
    const found =
      prompt === undefined
        ? await this.dshSubagents.resolve(parent, ref, signal).then(
            (child) =>
              child && {
                kind: 'dsh-subagent' as const,
                workerId: child.id,
                agentName: child.agentName,
                title: child.title,
                mode: child.mode,
              },
          )
        : await this.dshSubagents.followup(parent, ref, prompt, signal)
    if (!found) throw error
    return found
  }
}

export function waitHarnessRun(
  this: ServiceContext,
  record: HarnessConversationRecord,
  runId: string,
): Promise<Worker> {
  const running = this.nativeRunDone.get(runId)
  if (running) return running.then((worker) => structuredClone(worker))
  const worker = this.runtime.get(record.parentSessionId, record.workerId)
  if (worker.runId !== runId) return Promise.reject(new Error('原生会话目标轮次已变化，未重放任务'))
  if (['queued', 'running', 'stopping'].includes(worker.status))
    return Promise.reject(new Error('无法接管缺少完成凭据的运行，请等待现有任务结束'))
  return Promise.resolve(structuredClone(worker))
}

export async function ensureHarnessConversation(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const parent = await host.parent(parentSessionId)
    const worker = host.runtime.get(parent.id, workerId)
    if (host.project(parent) !== worker.project) throw new Error('项目已变更，请在原项目打开会话')
    if (!host.harnessConversation) throw new Error('当前 Harness 原生会话服务未就绪')
    const ensured = await host.harnessConversation.ensure(parent, worker, {
      initialRunId: worker.runId,
      signal,
    })
    const current = host.runtime.get(parent.id, workerId)
    const previous = current.harnessConversation
    const binding =
      previous?.sessionId === ensured.sessionId
        ? {
            ...ensured,
            capabilities: {
              ...ensured.capabilities,
              tools: previous.capabilities.tools,
              skills: previous.capabilities.skills,
            },
            reasons: {
              ...ensured.reasons,
              tools: previous.reasons?.tools,
              skills: previous.reasons?.skills,
            },
          }
        : ensured
    current.harnessConversation = binding
    host.runtime.storage.save(current)
    host.runtime.changed()
    return JSON.stringify(binding)
  } catch (error) {
    throw failure(error)
  }
}

export async function repairHarnessConversation(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  expectedSessionId: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const parent = await host.parent(parentSessionId)
    const worker = host.runtime.get(parent.id, workerId)
    if (host.project(parent) !== worker.project) throw new Error('项目已变更，请在原项目修复显示会话')
    if (!host.harnessConversation) throw new Error('当前 Harness 原生会话服务未就绪')
    if (host.runtime.snapshot(parent.id, workerId).selectedBusy)
      throw new Error('当前任务仍在执行、提交或清理，请结束后再修复显示会话')
    return await host.runtime.prepareFollowup(
      parent.id,
      workerId,
      AbortSignal.any([signal, host.disposed.signal]),
      async (control) => {
        host.repairingDisplays.add(workerId)
        try {
          const binding = await host.harnessConversation!.repairDisplay(
            parent,
            worker,
            expectedSessionId,
            control,
          )
          const current = host.runtime.get(parent.id, workerId)
          current.harnessConversation = binding
          host.runtime.storage.save(current)
          host.runtime.changed()
          return JSON.stringify(binding)
        } finally {
          host.repairingDisplays.delete(workerId)
        }
      },
    )
  } catch (error) {
    throw failure(error)
  }
}

export async function listDshSubagents(
  host: ServiceContext,
  parentSessionId: string,
  signal: AbortSignal,
): Promise<string> {
  return JSON.stringify(await host.dshSubagents.list(parentSessionId, signal))
}

export async function* watchDshSubagents(
  host: ServiceContext,
  parentSessionId: string,
  signal: AbortSignal,
): AsyncIterable<string> {
  yield* host.dshSubagents.watch(parentSessionId, signal)
}

export async function promptDshSubagent(
  host: ServiceContext,
  parentSessionId: string,
  childSessionId: string,
  prompt: string,
  requestId: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const text = validate.string().min(1).max(100000).parse(prompt)
    validate.string().uuid().parse(requestId)
    return JSON.stringify(
      await host.dshSubagents.prompt(
        parentSessionId,
        {
          childSessionId: SessionId(childSessionId),
          requestId: requestId as import('@deepseek-ai/dsh-subagent').SubagentPromptRequestId,
          delivery: 'queue',
          content: [{ type: 'text', text }],
        },
        signal,
      ),
    )
  } catch (error) {
    throw failure(error)
  }
}

export async function stopDshSubagent(
  host: ServiceContext,
  parentSessionId: string,
  childSessionId: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    return JSON.stringify(await host.dshSubagents.stop(parentSessionId, childSessionId, signal))
  } catch (error) {
    throw failure(error)
  }
}

export async function hideDshSubagent(
  host: ServiceContext,
  parentSessionId: string,
  childSessionId: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    await host.dshSubagents.hide(parentSessionId, childSessionId, signal)
  } catch (error) {
    throw failure(error)
  }
}

export function registerConversationBridge(host: ServiceContext) {
  host.ctx.inject(['sessionController', 'subagents', 'llm'], (scope) => {
    const records = new HarnessConversationStore(host.runtime.storage.directory)
    host.harnessConversationStore = records
    const bridge = createHarnessConversationBridge(scope, {
      bindings: () => records.list(),
      bind: async (record) => {
        const worker = host.runtime.get(record.parentSessionId, record.workerId)
        // Public capability metadata is derived by the bridge, never used as authority.
        const publicBinding = worker.harnessConversation
        if (publicBinding && publicBinding.sessionId !== record.sessionId)
          throw new Error('Worker 原生会话身份不匹配')
        records.save(record)
        host.runtime.changed()
      },
      unbind: async (record) => {
        records.remove(record)
        const worker = host.runtime.get(record.parentSessionId, record.workerId)
        if (worker.harnessConversation?.sessionId === record.sessionId) {
          delete worker.harnessConversation
          host.runtime.storage.save(worker)
          host.runtime.changed()
        }
      },
      replaceBinding: async (previous, next) => replaceWorkerBinding(host.runtime, records, previous, next),
      getWorker: (parent, id) => host.runtime.get(parent, id),
      busy: (record) => {
        const snapshot = host.runtime.snapshot(record.parentSessionId, record.workerId)
        return (
          !!snapshot.selectedBusy &&
          !(host.repairingDisplays.has(record.workerId) && snapshot.selectedBusyReason === 'preparing')
        )
      },
      events: (record, runId, afterSeq) =>
        host.runtime.storage
          .history(record.workerId)
          .filter((event) => event.runId === runId && event.seq > afterSeq),
      subscribe: (listener) => host.runtime.subscribe(listener),
      receipt: (record, prompt, requestId) =>
        !!host.runtime.directMessageReceipt(record.parentSessionId, record.workerId, prompt, requestId),
      admitted: (record, batchId) =>
        host.runtime.storage
          .history(record.workerId)
          .some((event) => event.kind === 'user' && event.queuedFollowupId === batchId),
      steering: (record) => host.runtime.nativeSteeringState(record.parentSessionId, record.workerId),
      steer: async (record, prompt, runId, requestId, signal) => {
        await host.remote.steerMessage(
          record.parentSessionId,
          record.workerId,
          prompt,
          runId,
          requestId,
          signal,
        )
      },
      fork: async (record, signal) => {
        const result = JSON.parse(
          await host.remote.forkWorker(record.parentSessionId, record.workerId, '', signal),
        ) as { childSessionId: string }
        return `已创建 CLI 会话分支：${result.childSessionId}`
      },
      goal: async (record, input, signal) => {
        const worker = host.runtime.get(record.parentSessionId, record.workerId)
        if (worker.harnessConversation?.sessionId !== record.sessionId)
          throw new Error('CLI 子会话绑定已改变，未修改目标')
        signal.throwIfAborted()
        return workerGoalCommand(worker, input, {
          set: async (objective, revision) =>
            JSON.parse(
              await host.remote.setWorkerGoal(
                record.parentSessionId,
                record.workerId,
                objective,
                revision,
                signal,
              ),
            ),
          status: (status, revision) =>
            host.remote.setWorkerGoalStatus(
              record.parentSessionId,
              record.workerId,
              status,
              revision,
              signal,
            ),
          clear: (revision) =>
            host.remote.clearWorkerGoal(record.parentSessionId, record.workerId, revision, signal),
        })
      },
      permission: async (record, mode, signal) => {
        const worker = host.runtime.get(record.parentSessionId, record.workerId)
        if (worker.harnessConversation?.sessionId !== record.sessionId)
          throw new Error('CLI 子会话绑定已改变，未修改权限')
        if (mode !== undefined)
          await host.remote.configureWorkerPermission(record.parentSessionId, record.workerId, mode, signal)
        const state = JSON.parse(
          await host.remote.permissionForWorker(record.parentSessionId, record.workerId, signal),
        ) as WorkerPermissionState
        const current =
          state.options.find((option) => option.value === state.currentValue)?.name ?? state.currentValue
        return `当前 CLI 权限：${current}${state.plan.active ? '（规划模式）' : ''}。可用档位：${state.options.map((option) => `${option.value}（${option.name}）`).join('、')}${state.reason ? `。${state.reason}` : ''}`
      },
      run: async (record, prompt, requestId, signal, messages = []) => {
        const parent = await host.parent(record.parentSessionId)
        signal.throwIfAborted()
        const worker = host.runtime.get(parent.id, record.workerId)
        if (worker.harnessConversation?.sessionId !== record.sessionId)
          throw new Error('CLI 子会话绑定已改变，未启动任务')
        const previous = host.runtime.directMessageReceipt(parent.id, worker.id, prompt, requestId)
        if (previous?.runId)
          return { runId: previous.runId, done: host.waitHarnessRun(record, previous.runId) }
        const child = host.ctx.agents.get(record.sessionId as Agent['id'])
        if (!child) throw new Error('CLI 子会话已失效，未读取附件')
        const attachments = resolveHarnessAttachments(child.ctx, messages)
        // The native Agent has claimed this message. Reuse the same launch
        // checks and process lifetime, without a second conversation queue.
        const receipt = JSON.parse(
          await host.launch(
            parent,
            worker.title,
            prompt,
            worker.preference,
            worker.mode,
            worker.id,
            undefined,
            signal,
            undefined,
            undefined,
            undefined,
            requestId,
            attachments,
          ),
        ) as { runId: string }
        return { runId: receipt.runId, done: host.waitHarnessRun(record, receipt.runId) }
      },
      wait: (record, runId) => host.waitHarnessRun(record, runId),
      stop: async (record, runId) => {
        const current = host.runtime.get(record.parentSessionId, record.workerId)
        // A late projection from the previous run cannot cancel a new turn.
        if (current.runId === runId) await host.runtime.stop(record.parentSessionId, record.workerId)
      },
    })
    host.harnessConversation = bridge
    const removeModelGuard = installHarnessModelGuard(scope)
    const removePreparation = host.runtime.setHarnessPreparation(async (worker, signal, input) => {
      const parent = await host.parent(worker.parentSessionId)
      const binding = await bridge.ensure(parent, worker, {
        nativeSubmissionId: input.submissionId,
        initialRunId: worker.runId,
        projectRun: true,
        signal,
      })
      // Runtime owns this exact mutable Worker for the duration of the run.
      worker.harnessConversation = binding
      host.runtime.storage.save(worker)
      host.runtime.changed()
      const cli = cliOf(worker.preference)
      const child = host.ctx.agents.get(binding.sessionId as Agent['id'])
      if (!child) throw new Error('原生子 Agent 尚未就绪，未启动 CLI 工具桥')
      // DSH fallback tools in the child follow the run's level, not the parent's tier.
      const permission = host.childPermission(parent, worker)
      setSandboxMode(child.session, input.access ?? permission.sandbox)
      child.ctx.get('planMode')?.set(child, worker.mode === 'plan')
      // Delegation pins a child to `never`; a Worker-UI turn asks in this child.
      // Below full access it always asks. Direct log write: no model notice.
      const childApproval = child.ctx.get('approval')
      const policy = workerApproval(input.access ?? permission.sandbox, host.permissionState(parent))
      if (childApproval && childApproval.overrideOf(child.session) !== policy)
        setApprovalPolicy(child.session, policy)
      // Host tools act on the parent's project; an isolated run must not write there.
      const support = input.isolated
        ? { transport: false, reason: '本轮在隔离副本中运行，未接通 DSH 工具桥，避免写入原项目' }
        : nativeHarnessToolCapability(cli)
      if (!support.transport) {
        worker.harnessConversation = {
          ...binding,
          reasons: {
            ...binding.reasons,
            tools: support.reason,
            skills: support.reason,
          },
        }
        host.runtime.storage.save(worker)
        host.runtime.changed()
        return undefined
      }
      // Native per-call dispatch retains policy/approvals without replacing
      // the child's model executor (which may be PTC).
      const executor = await createNativeHarnessExecutor(child.ctx)
      let lease: Awaited<ReturnType<typeof createNativeHarnessTools>>
      try {
        // The real child scope owns its tool/MCP catalog. Refresh for every
        // bridge operation so an old grant cannot outlive a policy change.
        const tools = () => {
          const schemas = child.ctx.tools.schemas(child)
          return schemas.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.parameters,
            execution: classifyHarnessTool(tool.name, schemas),
          }))
        }
        const skills = child.ctx.get('skills') as
          | {
              list(options: { cwd: string; scope: Agent; signal: AbortSignal }): Promise<
                Array<{
                  name: string
                  description: string
                  invocation: { modelInvocable: boolean }
                }>
              >
              get(
                name: string,
                options: { cwd: string; scope: Agent; signal: AbortSignal },
              ): Promise<
                | (NativeHarnessSkill & {
                    invocation: { modelInvocable: boolean }
                  })
                | undefined
              >
            }
          | undefined
        const skillOptions = (control: AbortSignal) => ({
          cwd: worker.project,
          scope: child,
          signal: control,
        })
        lease = await createNativeHarnessTools({
          binding: {
            parentSessionId: parent.id,
            harnessSessionId: binding.sessionId,
            workerId: worker.id,
            runId: worker.runId,
            cli,
          },
          tools,
          signal,
          executionReady: nativeHarnessExecutionReady(cli),
          // Same inputs as the launch: overlapping DSH tools stay with the CLI.
          // A first item that runs as plan follows the launch, not the stored mode.
          native: nativeCliCapabilities({
            cli,
            mode: input.access === 'read-only' && askRunsAsPlan(cli) ? 'plan' : worker.mode,
            access: input.access,
            mcpServers: await nativeCliMcpServers(cli, worker.project),
          }),
          resolveImage: (attachment, control) => readHarnessImage(child.ctx, attachment, control),
          authorize: async (identity) => {
            signal.throwIfAborted()
            const current = host.runtime.get(parent.id, worker.id)
            if (
              current.runId !== identity.runId ||
              current.harnessConversation?.sessionId !== identity.harnessSessionId ||
              host.ctx.agents.get(binding.sessionId as Agent['id']) !== child ||
              !['queued', 'running'].includes(current.status)
            )
              throw new Error('工具桥运行身份已失效')
            host.assertExecution(parent, true)
            if (host.project(parent) !== worker.project) throw new Error('工具桥项目已变更')
            host.runtime.assertCliEnabled(cli)
          },
          execute: async (call) => {
            // An approval this call raises is matched to its Worker by call id.
            const callId = ToolCallId(`cliworker:${call.callId}`)
            host.bridgeCalls.set(callId, {
              worker,
              runId: call.binding.runId,
              child,
              name: call.name,
              arguments: call.arguments,
            })
            try {
              return await withinCliTool(worker.runId, async () =>
                executor.execute({
                  callId,
                  name: call.name,
                  arguments: call.arguments,
                  agent: child,
                  signal: call.signal,
                }),
              )
            } finally {
              host.bridgeCalls.delete(callId)
            }
          },
          ...(skills
            ? {
                skills: {
                  list: async (control: AbortSignal) =>
                    (await skills.list(skillOptions(control)))
                      .filter((skill) => skill.invocation.modelInvocable)
                      .map(({ name, description }) => ({
                        name,
                        description,
                      })),
                  get: async (name: string, control: AbortSignal) => {
                    const skill = await skills.get(name, skillOptions(control))
                    return skill?.invocation.modelInvocable ? skill : undefined
                  },
                },
              }
            : {}),
        })
      } catch (error) {
        executor.dispose()
        throw error
      }
      const owned = lease
      return adoptNativeHarnessLease(owned, executor.dispose, () => {
        if (worker.harnessConversation) {
          worker.harnessConversation = {
            ...worker.harnessConversation,
            capabilities: {
              ...worker.harnessConversation.capabilities,
              tools: owned.capabilities.ready && owned.capabilities.toolCount > 0,
              skills: owned.capabilities.ready && owned.capabilities.skills,
            },
            reasons: {
              ...worker.harnessConversation.reasons,
              tools: owned.capabilities.ready
                ? 'CLI 原生工具优先；仅提供原生未覆盖的获准 DSH 工具与 MCP 作为备选，每次执行仍走宿主权限和审批链，未接通的模型辅助与递归派遣不可用'
                : owned.capabilities.reason,
              skills: owned.capabilities.ready
                ? '当前子 Agent 没有可供模型读取的 DSH 技能'
                : owned.capabilities.reason,
            },
          }
          host.runtime.storage.save(worker)
        }
        host.runtime.changed()
      })
    })
    scope.effect(() => async () => {
      removePreparation()
      if (host.harnessConversation === bridge) host.harnessConversation = undefined
      if (host.harnessConversationStore === records) host.harnessConversationStore = undefined
      try {
        await bridge.dispose()
      } finally {
        removeModelGuard()
      }
    })
  })
}
