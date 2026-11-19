import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { validateJsonSchemaValue, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { agentNameKey, DSH_ROOT_AGENT_NAME } from '../shared/agent-names.ts'
import type { AgentNameOverrides, PendingAgentNames } from './agent-name-overrides.ts'

type Subagents = Pick<
  SubagentRuntime,
  'rootOf' | 'listDescendants' | 'resolveName' | 'sendMessage' | 'interrupt'
>

export interface AgentNameToolDependencies {
  overrides: AgentNameOverrides
  pending: PendingAgentNames
  occupied(parent: string): Set<string>
  /** Return the unique child ID, or throw AgentNameResolutionError if several Workers own this alias. */
  workerAlias?(parent: string, name: string): string | undefined
  subagents(): Subagents | undefined
  log(reason: string): void
}

const creationTools = new Set(['subagent'])
const duplicateReason =
  '名称已被同一会话中的子 Agent 使用（含改名前的名称）。This name is already used by a child agent in this session, including former names.'

export class AgentNameResolutionError extends Error {}

async function aliasTarget(
  deps: AgentNameToolDependencies,
  service: Subagents,
  caller: Agent,
  address: string,
  signal: AbortSignal,
) {
  const [head, ...tail] = address.split('/')
  if (!head || head === DSH_ROOT_AGENT_NAME) return
  const parent = service.rootOf(caller).id
  const overlay = deps.overrides.lookup(parent, head)
  if (overlay.kind === 'ambiguous')
    throw new AgentNameResolutionError('子 Agent 名称有歧义，请使用明确的会话 ID')
  const alias = deps.workerAlias?.(parent, head)
  if (overlay.kind === 'match' && alias !== undefined && alias !== overlay.childId)
    throw new AgentNameResolutionError('子 Agent 名称有歧义，请使用明确的会话 ID')
  const childId = overlay.kind === 'match' ? overlay.childId : alias
  if (!childId) return

  // The live catalog can contain names allocated through DSH entry points outside our creation guard.
  const rows = await service.listDescendants(parent, signal)
  signal.throwIfAborted()
  const direct = rows.filter((row) => row.parentId === parent)
  if (direct.some((row) => row.id !== childId && row.path && agentNameKey(row.path) === agentNameKey(head)))
    throw new AgentNameResolutionError('子 Agent 名称有歧义，与其他子会话的登记名冲突')
  const member = direct.find((row) => row.id === childId)
  if (!member) throw new AgentNameResolutionError('无法在当前父会话的目录中确认该子 Agent')
  if (member.path === head) return
  if (!tail.length) return { id: member.id }
  if (!member.path) throw new AgentNameResolutionError('该子 Agent 没有可用于解析后代路径的登记名')
  return { path: [member.path, ...tail].join('/') }
}

export function registerAgentNameTools(ctx: Context, deps: AgentNameToolDependencies): () => void {
  const offPre = ctx.on('tools/pre-execute', async (exec, next) => {
    const args = exec.arguments
    if (
      !creationTools.has(exec.name) ||
      !exec.agent ||
      !args ||
      typeof args !== 'object' ||
      !('name' in args) ||
      typeof args.name !== 'string'
    )
      return next()
    if (exec.signal.aborted) return { kind: 'cancel' }
    try {
      if (!deps.subagents()) return next()
      const parent = exec.agent.id
      const key = agentNameKey(args.name)
      if (
        deps.pending.has(parent, key) ||
        deps.overrides.occupied(parent).has(key) ||
        deps.occupied(parent).has(key)
      )
        return { kind: 'deny', reason: duplicateReason }
    } catch {
      deps.log('无法检查子 Agent 名称占用，交由 DSH 处理')
    }
    return next()
  })

  const offExecute = ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    const args = exec.arguments
    const caller = exec.agent
    if (
      (exec.name !== 'send_message' && exec.name !== 'interrupt_agent') ||
      !caller ||
      !args ||
      typeof args !== 'object' ||
      !('agent' in args) ||
      typeof args.agent !== 'string'
    )
      return next()
    const message = 'message' in args ? args.message : undefined
    if (exec.name === 'send_message' && typeof message !== 'string') return next()
    exec.signal.throwIfAborted()

    let service, target
    try {
      service = deps.subagents()
      // A wrapper runs before the tool body, including the body's input validation and executable lookup.
      const tools = ctx.get('tools')
      const definition = tools?.executable(exec.name, caller, exec.toolSet)
      if (
        !service ||
        !definition ||
        definition !== tools?.get(exec.name) ||
        validateJsonSchemaValue(definition.parameters, args).length
      )
        return next()
      target = await aliasTarget(deps, service, caller, args.agent, exec.signal)
    } catch (error) {
      exec.signal.throwIfAborted()
      if (error instanceof AgentNameResolutionError) throw error
      deps.log('无法读取子 Agent 名称或目录，交由 DSH 处理')
      return next()
    }
    if (!target) return next()

    // From here on, failures belong to this call. Falling through could send twice or bypass a refusal.
    exec.signal.throwIfAborted()
    const id = target.id ?? (await service.resolveName(caller, target.path, exec.signal))
    exec.signal.throwIfAborted()
    if (exec.name === 'send_message' && typeof message === 'string') {
      const messageId = await service.sendMessage(caller, id, [{ type: 'text', text: message }], {
        signal: exec.signal,
      })
      return {
        isError: false,
        value: { messageId },
        content: [{ type: 'text', text: `message delivered to agent ${args.agent}` }],
      }
    }
    service.interrupt(id, { kind: 'ancestor', agent: caller })
    return {
      isError: false,
      value: { accepted: true },
      content: [{ type: 'text', text: `interrupt requested for agent ${args.agent}` }],
    }
  })

  const offPost = ctx.on('tools/post-execute', async (exec, result, next) => {
    if (
      exec.name !== 'list_agents' ||
      !exec.agent ||
      exec.signal.aborted ||
      result.isError ||
      !Array.isArray(result.value)
    )
      return next()
    try {
      const parent = deps.subagents()?.rootOf(exec.agent).id
      if (!parent) return next()
      let changed = false
      const value = result.value.map((row) => {
        if (
          !row ||
          typeof row !== 'object' ||
          Array.isArray(row) ||
          typeof row.name !== 'string' ||
          (row.status !== 'running' && row.status !== 'inactive')
        )
          return row
        const [head] = row.name.split('/')
        if (!head || head === DSH_ROOT_AGENT_NAME) return row
        const effective = deps.overrides.effectiveForRegistered(parent, head)
        if (!effective || effective === head) return row
        changed = true
        return { ...row, name: effective + row.name.slice(head.length) }
      })
      if (changed) return { kind: 'accept', value }
    } catch {
      deps.log('无法读取子 Agent 显示名，保留 DSH 列表')
    }
    return next()
  })

  return () => {
    offPost()
    offExecute()
    offPre()
  }
}
