import { selectForkHistory, type ForkHistory, type ForkChild } from './worker-fork.ts'
import { bridgedFeatureSupport, type BridgedConversationFeature, type BridgedFeatureSupport } from '../shared/conversation-features.ts'
import { createHash, randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { emitAgentEvent, type Agent } from '@deepseek-ai/dsh-agent'
import {
  LlmAdapter,
  createUserMessage,
  isAgentLoopRequest,
  type GenerateOptions,
  type LlmCallConfig,
  type LlmModelInfo,
  type StreamChunk,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import { cliOf, type HarnessConversationBinding, type Worker, type WorkerEvent } from '../shared/types.ts'
import { HarnessConversationStream } from './harness-conversation-stream.ts'
import { HarnessConversationCommandGuard } from './harness-conversation-commands.ts'
import { bindHarnessTurnRun } from './harness-turn-usage.ts'
import { harnessInputText, harnessInputHash, hasHarnessAttachments } from './harness-attachments.ts'
import { nativeAttachmentCapability } from './native-attachments.mjs'
import { transportFor } from './native-worker.ts'
import type {
  HarnessConversationApi,
  HarnessConversationDependencies,
  HarnessConversationEnsureOptions,
  HarnessConversationRecord,
  HarnessConversationRun,
} from './harness-conversation-types.ts'

export * from './harness-conversation-types.ts'
export const HARNESS_CLI_PROVIDER = 'cliworker-native'
export const HARNESS_CLI_SUBAGENT_PROVIDER = 'cliworker-native-conversation'
const SENTINEL = 'cliworker:attach-existing-run:'
const FORK = 'cliworker:fork-history:'
const PROJECT = 'cliworker:project-admitted-run:'
const marker = (message: UserMessage) =>
  message.content[0]?.type === 'text' ? message.content[0].text : undefined
const notice = (message: UserMessage) => message.source.kind === 'cliworker-continuation'
/** Official retries mint new inbox IDs but retain the browser RPC identity. */
export const harnessSubmissionId = (message: UserMessage): string => {
  const source = message.source
  const identity = 'rpcId' in source && typeof source.rpcId === 'string' ? source.rpcId : message.id
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(identity))
    return identity
  const hash = createHash('sha256').update(`cliworker:native-submission:${identity}`).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
/** Native next-step input is one ordered batch, with one stable execution identity. */
export const harnessBatchSubmissionId = (messages: readonly UserMessage[]): string => {
  if (messages.length === 1) return harnessSubmissionId(messages[0]!)
  if (!messages.length) throw new Error('CLI 原生输入批次为空')
  const hash = createHash('sha256')
    .update(JSON.stringify(messages.map(harnessSubmissionId)))
    .digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
const text = harnessInputText
const promptHash = (prompt: string) => createHash('sha256').update(prompt).digest('hex')
const unknownSteering = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  (('code' in error && error.code === 'STEER_UNKNOWN') ||
    ('details' in error &&
      typeof error.details === 'object' &&
      error.details !== null &&
      'deliveryUnknown' in error.details &&
      error.details.deliveryUnknown === true))

export function harnessConversationBinding(
  record: HarnessConversationRecord,
  nativeSteering = false,
  attachments = false,
  bridged: Record<BridgedConversationFeature, BridgedFeatureSupport> = {
    goal: { supported: false },
    plan: { supported: true },
    feedback: { supported: false },
    fork: { supported: false, reason: '原生分支不会复制 CLI 会话，暂不可用' },
    forkEarlier: { supported: false },
  },
): HarnessConversationBinding {
  const reason = (feature: BridgedConversationFeature) =>
    bridged[feature].supported ? {} : { [feature]: bridged[feature].reason ?? '当前 CLI 不支持此功能' }
  return {
    sessionId: record.sessionId,
    parentSessionId: record.parentSessionId,
    mode: 'continuable',
    capabilities: {
      send: true,
      queue: true,
      steer: true,
      stop: true,
      model: true,
      permission: true,
      plan: bridged.plan.supported,
      attachments,
      fork: bridged.fork.supported,
      forkEarlier: bridged.forkEarlier.supported,
      goal: bridged.goal.supported,
      feedback: bridged.feedback.supported,
      skills: false,
      tools: false,
    },
    reasons: {
      steer: nativeSteering
        ? '通过当前 CLI 的原生引导通道发送，以原生接收回执为准'
        : '该 CLI 当前协议不支持运行中引导；消息在当前运行清理结束后的下一执行步骤接收',
      attachments: '附件尚未接入该 CLI 的原生会话',
      ...reason('plan'),
      ...reason('fork'),
      ...reason('forkEarlier'),
      ...reason('goal'),
      ...reason('feedback'),
      skills: '技能桥尚未完成验证',
      tools: '工具桥尚未完成验证；已执行 CLI 工具仍可查看',
    },
  }
}

/** Metadata only: a missed hook is an explicit error, never a provider fallback. */
class CliConversationAdapter extends LlmAdapter {
  constructor(private readonly models: () => readonly LlmModelInfo[]) {
    super()
  }
  override providerInfo(provider: string) {
    return { id: provider, name: 'CLI Worker' }
  }
  override async listModels() {
    // These per-Worker routes exist only for native child Agent requests.
    // The global catalog feeds the ordinary main conversation's ModelSelect;
    // the child's selector has its own exact CLI directory and save callback.
    return []
  }
  override async resolveModel(provider: string, model: string) {
    const found = this.models().find((item) => item.provider === provider && item.id === model)
    if (!found) throw new Error('CLI 会话选型缺失或已失效')
    return { ...found, inputModalities: found.inputModalities ?? ['text'] as const }
  }
  async *stream(): AsyncGenerator<StreamChunk> {
    throw new Error('CLI 原生流桥未接管请求，已禁止模型回退')
  }
}

type NativeChildSpec = {
  provider: string; label: string; childId: ReturnType<typeof SessionId>; signal: AbortSignal
  request: { parent: Agent; prompt: UserMessage['content']; agentOptions: { provider: string; model: string } }
}
type NativeActivation = { childId: ReturnType<typeof SessionId>; result: Promise<unknown>; dispose(): Promise<void> }
type RegisteredProvider = Parameters<Context['subagents']['registerProvider']>[0]
type ActivationProvider = Omit<RegisteredProvider, 'capabilities'> & {
  capabilities: { agentOptions: boolean; agentPreset: boolean; outputSchema: boolean; depthLimit: boolean }
}
interface ActivationSubagents {
  startActivation(spec: NativeChildSpec & { delivery: 'caller' }): Promise<NativeActivation>
  drainChildren(parent: Agent, children: readonly ReturnType<typeof SessionId>[]): Promise<void>
  registerProvider(provider: ActivationProvider): () => void
}
interface LegacySubagents {
  startContinuable(spec: NativeChildSpec): Promise<{ childId: ReturnType<typeof SessionId> }>
  drainContinuableChildren(parent: Agent, children: ReturnType<typeof SessionId>[]): Promise<void>
}
function activationSubagents(value: unknown): value is ActivationSubagents {
  return typeof value === 'object' && value !== null &&
    'startActivation' in value && typeof value.startActivation === 'function' &&
    'drainChildren' in value && typeof value.drainChildren === 'function' &&
    'registerProvider' in value && typeof value.registerProvider === 'function'
}
function legacySubagents(value: unknown): value is LegacySubagents {
  return typeof value === 'object' && value !== null &&
    'startContinuable' in value && typeof value.startContinuable === 'function' &&
    'drainContinuableChildren' in value && typeof value.drainContinuableChildren === 'function'
}

interface Position {
  agent: Agent
  turn: number
  step: number
  signal: AbortSignal
}
interface PendingTurn {
  messages: UserMessage[]
  prompt: string
  requestId: string
  attachRunId?: string
  noop?: boolean
}
interface SteeringInput {
  message: UserMessage
  runId: string
  done: Promise<void>
}

/** Uses the official continuable manager, preserving its real Activation and Session. */
export class HarnessConversationBridge implements HarnessConversationApi {
  private readonly activations = new Map<string, NativeActivation>()
  private readonly records = new Map<string, HarnessConversationRecord>()
  private readonly creating = new Map<string, Promise<HarnessConversationBinding>>()
  private readonly provisioning = new Map<string, HarnessConversationRecord>()
  private readonly replacements = new Map<string, HarnessConversationRecord>()
  private readonly knownRuns = new Set<string>()
  private readonly nativeSubmissions = new Map<string, Set<string>>()
  private readonly launches = new Set<Promise<HarnessConversationRun>>()
  private readonly projecting = new Map<string, Promise<void>>()
  private readonly recordWrites = new Map<string, Promise<unknown>>()
  private readonly suppressedSettlementWakes = new WeakSet<Agent>()
  private readonly settlementHolds = new Set<Promise<void>>()
  private readonly pending = new Map<string, PendingTurn>()
  private readonly positions = new Map<string, Position>()
  private readonly streams = new Map<string, HarnessConversationStream>()
  private readonly steeringInputs = new Map<string, SteeringInput>()
  private readonly heldSteering = new Set<string>()
  private readonly draining = new Set<Promise<void>>()
  private readonly lifecycleIssues: unknown[] = []
  private readonly disposers: Array<() => unknown> = []
  private readonly lifetime = new AbortController()
  private readonly forkSeeds = new Map<string, ForkHistory>()
  private readonly commandGuard: HarnessConversationCommandGuard
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly deps: HarnessConversationDependencies,
  ) {
    if (!activationSubagents(ctx.subagents) && !legacySubagents(ctx.subagents))
      throw new Error('当前宿主缺少 CLI 子会话所需的生命周期接口')
    for (const record of deps.bindings()) this.remember(record)
    this.commandGuard = new HarnessConversationCommandGuard(
      ctx,
      (agent) => {
        const record = this.ownerOf(agent.id)
        return !!record && agent.session.header.parentSession === record.parentSessionId
      },
      async (agent, mode, signal) => {
        const record = this.records.get(agent.id)
        if (!record || !deps.permission) throw new Error('CLI 真实权限设置入口不可用')
        this.assertLive(record, agent)
        return deps.permission(record, mode, AbortSignal.any([signal, this.lifetime.signal]))
      },
      {
        fork: async (agent, _input, signal) => {
          const record = this.records.get(agent.id)
          if (!record) throw new Error('CLI 子会话绑定缺失')
          this.assertLive(record, agent)
          const support = bridgedFeatureSupport(deps.getWorker(record.parentSessionId, record.workerId)).fork
          if (!support.supported) return support.reason ?? '当前 CLI 不支持会话分支'
          if (!deps.fork) return '当前 CLI 会话分支入口不可用'
          return deps.fork(record, AbortSignal.any([signal, this.lifetime.signal]))
        },
        goal: async (agent, input, signal) => {
          const record = this.records.get(agent.id)
          if (!record || !deps.goal) throw new Error('CLI 目标设置入口不可用')
          this.assertLive(record, agent)
          return deps.goal(record, input, AbortSignal.any([signal, this.lifetime.signal]))
        },
        plan: async (agent, _input, signal) => {
          const record = this.records.get(agent.id)
          if (!record) throw new Error('CLI 子会话绑定缺失')
          this.assertLive(record, agent)
          if (!bridgedFeatureSupport(deps.getWorker(record.parentSessionId, record.workerId)).plan.supported)
            return '当前 CLI 不支持规划模式'
          if (!deps.permission) throw new Error('CLI 真实权限设置入口不可用')
          return deps.permission(record, 'plan', AbortSignal.any([signal, this.lifetime.signal]))
        },
      },
    )
    for (const record of this.records.values()) {
      const agent = ctx.agents?.get(record.sessionId as Agent['id'])
      if (agent) this.commandGuard.protect(agent)
    }
    const models = () =>
      [...this.records.values()].flatMap((record) => {
        try {
          const worker = deps.getWorker(record.parentSessionId, record.workerId)
          return [
            {
              provider: HARNESS_CLI_PROVIDER,
              id: this.model(record),
              name: `${cliOf(worker.preference)} · ${worker.preference.model}`,
              // This private route accepts attachment input for conversion; it
              // does not claim that the downstream CLI model has vision.
              inputModalities: worker.transport === transportFor(cliOf(worker.preference)) && nativeAttachmentCapability(cliOf(worker.preference))
                ? ['text', 'image'] as const : ['text'] as const,
            },
          ]
        } catch {
          // A removed Worker must fail its own route without disabling unrelated
          // CLI conversations.
          return []
        }
      })
    this.disposers.push(ctx.llm.registerAdapter([HARNESS_CLI_PROVIDER], new CliConversationAdapter(models)))
    const legacyCapabilities = { agentOptions: true, outputSchema: false, depthLimit: false,
      toolFilter: true, persona: false, agentPreset: false }
    const provider: RegisteredProvider = {
      name: HARNESS_CLI_SUBAGENT_PROVIDER,
      capabilities: legacyCapabilities,
      inheritsParentContext: false,
      async start() {
        throw new Error('CLI 会话仅支持 continuable 子会话')
      },
      prepareContinuable: async ({ sessionId, parent, signal }) => {
        const record = this.provisioning.get(sessionId)
        if (!record || record.parentSessionId !== parent.id) throw new Error('CLI 子会话创建授权缺失')
        signal.throwIfAborted()
        const previous = this.replacements.get(sessionId)
        if (previous) {
          if (!this.deps.replaceBinding) throw new Error('原生会话安全恢复入口不可用')
          await this.deps.replaceBinding(previous, record)
          this.records.delete(previous.sessionId)
        } else if (!this.forkSeeds.has(sessionId)) await this.deps.bind(record)
        this.remember(record)
        signal.throwIfAborted()
        return this.forkSeeds.has(sessionId) ? { seed: this.forkSeeds.get(sessionId)!.seed } : {}
      },
    }
    this.disposers.push(activationSubagents(ctx.subagents)
      ? ctx.subagents.registerProvider({ ...provider, capabilities: {
        agentOptions: true, agentPreset: false, outputSchema: false, depthLimit: false,
      } })
      : ctx.subagents.registerProvider(provider))
    this.disposers.push(
      ctx.on('agent/created', ({ agent }) => {
        const record = this.records.get(agent.id)
        if (!record || !this.forkSeeds.has(agent.id)) return
        this.assertLive(record, agent)
        // A fork inherits the source Worker's recorded model route. rc.1
        // snapshots that selection before pre-step/request middleware, so
        // AgentOptions and our request override alone cannot rebind the fork.
        // Creation listeners run before queued work; select on the new Session
        // without rewriting its inherited history. Older hosts have no model API.
        agent.model?.select({ provider: HARNESS_CLI_PROVIDER, model: this.model(record) })
      }, { global: true }),
    )
    this.disposers.push(
      ctx.on(
        'agent/inbox/inserted',
        ({ agent, message }) => {
          if (message.source.kind === 'subagent-settled') {
            const senderId = message.source.senderSessionId
            const sender = this.ownerOf(senderId)
            if (sender?.parentSessionId === agent.id) {
              // Official continuation settlement wakes its parent by default.
              // CLI Worker already owns completion; never start a second model
              // turn merely to summarize this display-only child Session.
              const idle = agent.status === 'idle'
              if (idle) this.suppressedSettlementWakes.add(agent)
              agent.inbox.remove(message.id)
              if (idle) {
                try {
                  // The receiving Agent.send has not reached wakeDriver yet.
                  // Public maintenance claims idle synchronously; that wake is
                  // released only if real input remains after this microtask.
                  const held = agent.runMaintenance(async () => {})
                  this.settlementHolds.add(held)
                  void held
                    .catch((error) => this.lifecycleIssues.push(error))
                    .finally(() => this.settlementHolds.delete(held))
                } catch (error) {
                  // Idle also represents someone else's maintenance. Its owner
                  // keeps that slot; the pre-step guard remains the fallback.
                  this.ctx.logger?.debug('CLI 子会话结束通知未取得空闲维护槽，保留空步骤保护', error)
                }
              }
              return
            }
          }
          // The official Inbox owns admission, ordering, editing and cancellation.
          // In particular, a busy next-turn input must remain there until claimed.
          const record = this.records.get(agent.id)
          if (record) this.pumpSteering(record)
        },
        { global: true },
      ),
    )
    this.disposers.push(
      ctx.on(
        'agent/inbox/discarded',
        ({ agent }) => {
          const record = this.records.get(agent.id)
          if (record) this.pumpSteering(record)
        },
        { global: true },
      ),
    )
    if (deps.steer && deps.steering)
      this.disposers.push(
        deps.subscribe(() => {
          for (const sessionId of this.streams.keys()) {
            const record = this.records.get(sessionId)
            if (record) this.pumpSteering(record)
          }
        }),
      )
    this.disposers.push(
      ctx.on(
        'agent/pre-step',
        async (payload, next) => {
          // Agent.send latches an idle wake even if its insertion was removed.
          // Inspect the claimed input before system runtime-context additions:
          // an empty settlement wake must not become a parent model request.
          if (
            this.suppressedSettlementWakes.delete(payload.agent) &&
            payload.step === 1 &&
            payload.messages.length === 0
          )
            return { kind: 'reject' }
          const record = this.records.get(payload.agent.id)
          if (!record) return this.ownerOf(payload.agent.id) ? { kind: 'reject' } : next()
          this.assertLive(record, payload.agent)
          const decision = await next()
          if (decision.kind === 'reject') return decision
          let messages = payload.messages.filter((message) => !notice(message))
          if (!messages.length) {
            if (!this.streams.has(record.sessionId)) return { kind: 'reject' }
            return { ...decision, messages: payload.messages.filter(notice) }
          }
          if (messages.length === 1 && marker(messages[0]!) === `${FORK}${record.workerId}` && this.forkSeeds.has(record.sessionId))
            return this.noop(record, { ...decision, messages: [] })
          const current = this.streams.get(record.sessionId)
          if (current && !current.finished) {
            // A displayed row is not a CLI execution boundary. Keep next-step
            // input in the real native Inbox (with its original IDs) until this
            // complete CLI run reaches its cleanup barrier. Reinsert ahead of
            // arrivals that were admitted while pre-step middleware awaited.
            payload.agent.inbox.splice('next-step', 0, 0, messages)
            this.pumpSteering(record)
            return { ...decision, messages: payload.messages.filter(notice) }
          }
          const attachment = messages.find(
            (item) =>
              this.projection(record, item) ||
              (record.initialPending && marker(item) === `${SENTINEL}${record.initialRunId}`),
          )
          if (attachment && messages.length > 1) {
            payload.agent.inbox.splice(
              'next-step',
              0,
              0,
              messages.filter((item) => item !== attachment),
            )
            messages = [attachment]
          }
          const message = messages[0]!
          let prompt = text(message)
          const projection = this.projection(record, message)
          let attachRunId: string | undefined
          if (projection) {
            if (messages.length !== 1) throw new Error('已有运行投影不能与新输入合并')
            attachRunId = projection.runId
            await this.updateRecord(record.sessionId, (current) => ({
              ...current,
              pendingRuns: current.pendingRuns?.filter((item) => item.requestId !== projection.requestId),
            }))
            const input = await this.admittedInput(record, attachRunId, payload.signal)
            if (input === undefined) return { kind: 'reject' }
            prompt = input
          } else if (prompt.startsWith(SENTINEL)) {
            if (messages.length !== 1) throw new Error('首轮运行挂接不能与新输入合并')
            if (!record.initialPending || marker(message) !== `${SENTINEL}${record.initialRunId}`)
              return { kind: 'reject' }
            attachRunId = record.initialRunId
            if (!attachRunId) return { kind: 'reject' }
            const initial = await this.admittedInput(record, attachRunId, payload.signal)
            if (initial === undefined) return { kind: 'reject' }
            prompt = initial
            // Persist consumption BEFORE attaching. A restart cannot replay a model
            // request or mistake the sentinel for an ordinary follow-up.
            await this.updateRecord(record.sessionId, (current) => ({ ...current, initialPending: false }))
          } else {
            const seen = new Map<string, string>()
            try {
              messages = messages.filter((item) => {
                const id = harnessSubmissionId(item),
                  body = text(item)
                if (this.acceptedInput(record, id, body, harnessInputHash(item))) return false
                const identity = harnessInputHash(item)
                const prior = seen.get(id)
                if (prior !== undefined) {
                  if (prior !== identity) throw new Error('重复原生提交身份对应的消息不同')
                  return false
                }
                seen.set(id, identity)
                return true
              })
            } catch (error) {
              // Native pre-step has already claimed these messages. A receipt
              // failure must leave the draft editable/removable in its Inbox.
              payload.agent.inbox.splice('next-step', 0, 0, messages)
              throw error
            }
            if (!messages.length) return this.noop(record, decision)
            prompt = messages.map(text).join('\n\n')
          }
          if (!prompt.trim()) return { kind: 'reject' }
          const requestId = harnessBatchSubmissionId(messages)
          if (!attachRunId) {
            try {
              if (this.deps.receipt?.(record, prompt, requestId)) return this.noop(record, decision)
            } catch (error) {
              payload.agent.inbox.splice('next-step', 0, 0, messages)
              throw error
            }
          }
          this.pending.set(record.sessionId, { messages, prompt, requestId, attachRunId })
          return {
            ...decision,
            messages: attachRunId ? [{ ...message, content: [{ type: 'text', text: prompt }] }] : messages,
          }
        },
        { prepend: true, global: true },
      ),
    )
    this.disposers.push(
      ctx.on(
        'agent/request',
        async (position, next) => {
          const record = this.records.get(position.agent.id)
          if (!record) {
            if (this.ownerOf(position.agent.id)) throw new Error('旧原生显示会话已保留归档，不能重新执行')
            return next()
          }
          this.assertLive(record, position.agent)
          this.positions.set(record.sessionId, position)
          const base = await next()
          const { reasoningEffort: _effort, maxTokens: _cap, ...rest } = base
          return {
            ...rest,
            provider: HARNESS_CLI_PROVIDER,
            model: this.model(record),
          } satisfies LlmCallConfig
        },
        { prepend: true, global: true },
      ),
    )
    this.disposers.push(
      ctx.on('llm/stream', (options, next) => this.route(options, next), { prepend: true, global: true }),
    )
    this.disposers.push(
      ctx.on(
        'agent/status',
        ({ agent, status }) => {
          if (status !== 'idle' || !this.records.has(agent.id)) return
          this.pending.delete(agent.id)
          this.positions.delete(agent.id)
          const stream = this.streams.get(agent.id)
          if (stream && !stream.finished) this.drain(stream)
        },
        { global: true },
      ),
    )
    this.disposers.push(
      ctx.on(
        'agent/disposed',
        ({ agent }) => {
          const record = this.records.get(agent.id)
          if (!record) return
          this.pending.delete(agent.id)
          this.positions.delete(agent.id)
          const stream = this.streams.get(agent.id)
          if (stream && !stream.finished) this.drain(stream)
          this.streams.delete(agent.id)
        },
        { global: true },
      ),
    )
  }

  private model(record: HarnessConversationRecord) {
    return `worker/${record.workerId}`
  }

  private binding(record: HarnessConversationRecord) {
    const worker = this.deps.getWorker(record.parentSessionId, record.workerId)
    const cli = cliOf(worker.preference)
    return harnessConversationBinding(
      record,
      !!this.deps.steer && !!this.deps.steering && this.deps.steering(record) !== 'unsupported',
      nativeAttachmentCapability(cli) && worker.transport === transportFor(cli),
      bridgedFeatureSupport(worker),
    )
  }

  /** Claim exactly one message through the same durable event as native Inbox.claim. */
  private claimSteering(position: Position, message: UserMessage): boolean {
    const index = position.agent.inbox.nextStep.findIndex((item) => item.id === message.id)
    if (index < 0) return false
    position.agent.session.append('agent/inbox/spliced', {
      target: 'next-step',
      start: index,
      removedCount: 1,
      inserted: [],
    })
    emitAgentEvent(this.ctx, position.agent, 'agent/inbox/claimed', { message, turn: position.turn })
    return true
  }

  private steeringNotice(agent: Agent, summary: string) {
    agent.session.append(
      'user/message',
      createUserMessage({ source: { kind: 'cliworker-steering', form: 'notice', summary }, content: [] }),
      { surfaceOp: 'append' },
    )
  }

  private displaySteering(agent: Agent, message: UserMessage) {
    const id = harnessSubmissionId(message)
    if (
      agent.session.deriveMessages().some((item) => item.role === 'user' && harnessSubmissionId(item) === id)
    )
      return
    agent.session.append('user/message', message, { surfaceOp: 'append' })
  }

  private async projectSteering(
    record: HarnessConversationRecord,
    agent: Agent,
    event: WorkerEvent,
  ): Promise<boolean> {
    const id = event.queuedFollowupId
    if (!id) return false
    const prior = this.records.get(record.sessionId)?.nativeInputs?.find((item) => item.requestId === id)
    if (prior?.delivery !== 'steer') return false
    let message = this.steeringInputs.get(`${record.sessionId}:${id}`)?.message
    message ??= agent.session
      .deriveMessages()
      .find((item): item is UserMessage => item.role === 'user' && harnessSubmissionId(item) === id)
    // The public durable Inbox event retains the original RPC identity even if
    // the process died after CLI acceptance and before the user echo was saved.
    if (!message) {
      const query = this.ctx.get('sessionQuery') as
        | {
            observeSession(
              id: Agent['id'],
              options: { signal: AbortSignal; projectionMode: 'none' },
            ): Promise<Disposable & { events: readonly SessionEvent[] }>
          }
        | undefined
      if (!query) throw new Error('Harness 原生会话只读校验服务未就绪')
      const observation = await query.observeSession(agent.id, {
        signal: this.lifetime.signal,
        projectionMode: 'none',
      })
      try {
        for (const row of observation.events) {
          if (row.type !== 'agent/inbox/spliced') continue
          const candidate = row.data.inserted.find(
            (item) => harnessSubmissionId(item) === id && promptHash(text(item)) === prior.promptHash,
          )
          if (candidate) message = candidate
        }
      } finally {
        observation[Symbol.dispose]()
      }
    }
    if (!message || promptHash(text(message)) !== prior.promptHash)
      throw new Error('已接收引导的原生消息身份缺失，禁止生成替代消息或重新发送')
    this.displaySteering(agent, message)
    return true
  }

  private async settleSteering(sessionId: string, runId: string) {
    // A native reply can arrive before the bridge finishes saving its receipt.
    // Hold the native turn through that final write/restoration as well.
    while (true) {
      const pending = [...this.steeringInputs.entries()]
        .filter(([key, value]) => key.startsWith(`${sessionId}:`) && value.runId === runId)
        .map(([, value]) => value.done)
      if (!pending.length) return
      await Promise.allSettled(pending)
    }
  }

  private async recordSteering(
    record: HarnessConversationRecord,
    message: UserMessage,
    accepted: boolean,
    steeringState?: 'pending' | 'rejected' | 'unknown',
  ) {
    const requestId = harnessSubmissionId(message),
      hash = promptHash(text(message))
    await this.updateRecord(record.sessionId, (current) => {
      const inputs = new Map(current.nativeInputs?.map((item) => [item.requestId, item]))
      const previous = inputs.get(requestId)
      if (previous && previous.promptHash !== hash) throw new Error('重复原生引导身份对应的消息不同')
      inputs.set(requestId, {
        requestId,
        promptHash: hash,
        batchId: requestId,
        accepted,
        delivery: 'steer',
        ...(steeringState ? { steeringState } : {}),
      })
      if (inputs.size > 10000) throw new Error('原生输入回执已达保存上限，未发送 CLI 引导')
      return { ...current, nativeInputs: [...inputs.values()] }
    })
  }

  private pumpSteering(record: HarnessConversationRecord) {
    const stream = this.streams.get(record.sessionId),
      position = this.positions.get(record.sessionId)
    if (
      this.disposed ||
      !stream ||
      stream.finished ||
      !position ||
      position.signal.aborted ||
      !this.deps.steer ||
      this.deps.steering?.(record) !== 'ready'
    )
      return
    const active = [...this.steeringInputs.entries()].find(([key]) =>
      key.startsWith(`${record.sessionId}:`),
    )?.[1]
    if (active) {
      // RPC retries can insert a different Inbox message while its original
      // native receipt is pending. Claim only an identical retry, preserving
      // the original as the single item to restore if delivery is uncertain.
      for (const item of [...position.agent.inbox.nextStep])
        if (
          item.id !== active.message.id &&
          harnessSubmissionId(item) === harnessSubmissionId(active.message) &&
          JSON.stringify(item.content) === JSON.stringify(active.message.content)
        )
          this.claimSteering(position, item)
      return
    }
    const message = position.agent.inbox.nextStep.find(
      (item) => !notice(item) && !marker(item)?.startsWith(SENTINEL) && !this.projection(record, item),
    )
    // Native steering is text-only. Keep the first attachment and all later
    // arrivals in the authoritative Inbox until the current run has settled.
    if (!message || hasHarnessAttachments(message)) return
    const requestId = harnessSubmissionId(message),
      key = `${record.sessionId}:${requestId}`
    if (this.heldSteering.has(key)) {
      for (const item of [...position.agent.inbox.nextStep])
        if (
          item.id !== message.id &&
          harnessSubmissionId(item) === requestId &&
          JSON.stringify(item.content) === JSON.stringify(message.content)
        )
          this.claimSteering(position, item)
      return
    }
    let prompt: string
    try {
      prompt = text(message)
      if (!prompt.trim()) throw new Error('引导消息不能为空')
      if (this.acceptedInput(record, requestId, prompt)) {
        if (this.claimSteering(position, message)) {
          const prior = this.records
            .get(record.sessionId)
            ?.nativeInputs?.find((item) => item.requestId === requestId)
          if (prior?.delivery === 'steer') this.displaySteering(position.agent, message)
          this.pumpSteering(record)
        }
        return
      }
    } catch (error) {
      this.heldSteering.add(key)
      this.steeringNotice(
        position.agent,
        `${String(error)}；原消息保留在待处理队列，请核查后移除此条，再发送新消息`,
      )
      return
    }
    if (!this.claimSteering(position, message)) return
    const signal = AbortSignal.any([position.signal, this.lifetime.signal]),
      runId = stream.run.runId
    const done = Promise.resolve()
      .then(async () => {
        let acknowledged = false
        try {
          // Save an intent before touching the native transport. Absence of an
          // acknowledged receipt can never turn this into a queued new-run send.
          await this.recordSteering(record, message, false, 'pending')
          signal.throwIfAborted()
          await this.deps.steer!(record, prompt, runId, requestId, signal)
          acknowledged = true
          this.displaySteering(position.agent, message)
          await this.recordSteering(record, message, true)
        } catch (error) {
          try {
            acknowledged ||= this.deps.admitted?.(record, requestId) === true
          } catch {
            // A failed receipt read is not evidence of rejection or acceptance.
          }
          if (acknowledged) {
            this.displaySteering(position.agent, message)
            this.steeringNotice(
              position.agent,
              `CLI 已接收引导，但回执登记未完成：${String(error)}；不会重发`,
            )
          } else {
            this.heldSteering.add(key)
            const unknown = unknownSteering(error)
            try {
              await this.recordSteering(record, message, false, unknown ? 'unknown' : 'rejected')
            } catch (writeError) {
              this.ctx.logger?.warn('CLI 引导状态保存失败，原消息保留且禁止自动重发', writeError)
            }
            // The original message remains the only editable/removable queued
            // item. Restoring it does not authorize another native transmission.
            if (!position.agent.inbox.nextStep.some((item) => item.id === message.id))
              position.agent.inbox.splice('next-step', 0, 0, [message])
            this.steeringNotice(
              position.agent,
              `${unknown ? 'CLI 引导接收状态不明' : 'CLI 未确认接收引导'}：${String(error)}；原消息保留在队列，不会自动重发，请核查后移除此条，再发送新消息`,
            )
          }
        }
      })
      .catch((error) => {
        this.lifecycleIssues.push(error)
      })
      .finally(() => {
        this.steeringInputs.delete(key)
        this.pumpSteering(record)
      })
    this.steeringInputs.set(key, { message, runId, done })
  }

  private noop(record: HarnessConversationRecord, decision: { kind: 'enter'; messages: UserMessage[] }) {
    this.pending.set(record.sessionId, { messages: [], prompt: '', requestId: '', noop: true })
    // A rejected pre-step halts the native FIFO. An empty host notice instead
    // settles this already-admitted duplicate without another user echo or CLI
    // execution, then lets the official loop advance to remaining Inbox work.
    return {
      ...decision,
      messages: [
        createUserMessage({
          source: { kind: 'cliworker-continuation', form: 'notice', summary: '该请求已受理，未重复执行' },
          content: [],
        }),
      ],
    }
  }

  private acceptedInput(record: HarnessConversationRecord, requestId: string, prompt: string, inputHash = promptHash(prompt)): boolean {
    const prior = this.records
      .get(record.sessionId)
      ?.nativeInputs?.find((item) => item.requestId === requestId)
    if (!prior) {
      if (this.heldSteering.has(`${record.sessionId}:${requestId}`))
        throw new Error('该引导的本地登记未完成，已禁止自动重发')
      return false
    }
    if (prior.promptHash !== inputHash) throw new Error('重复原生提交身份对应的消息或附件不同')
    if (prior.accepted) return true
    if (prior.delivery === 'steer') {
      if (this.deps.admitted?.(record, requestId)) return true
      throw new Error(
        prior.steeringState === 'rejected'
          ? '该原生引导未送达，已禁止自动重发'
          : '该原生引导接收状态尚未确认，已禁止自动重发',
      )
    }
    if (!this.deps.admitted) throw new Error('原生请求接收状态尚未确认，已禁止自动重发；请核查该批次回执')
    return this.deps.admitted(record, prior.batchId)
  }

  private async recordInputs(record: HarnessConversationRecord, pending: PendingTurn, accepted: boolean) {
    await this.updateRecord(record.sessionId, (current) => {
      const inputs = new Map(current.nativeInputs?.map((item) => [item.requestId, item]))
      for (const message of pending.messages) {
        const requestId = harnessSubmissionId(message),
          hash = harnessInputHash(message)
        const prior = inputs.get(requestId)
        if (prior && (prior.promptHash !== hash || (accepted && prior.batchId !== pending.requestId)))
          throw new Error('原生输入回执身份已变化')
        inputs.set(requestId, { requestId, promptHash: hash, batchId: pending.requestId, accepted })
      }
      if (inputs.size > 10000) throw new Error('原生输入回执已达保存上限，未重新发送 CLI 任务')
      return { ...current, nativeInputs: [...inputs.values()] }
    })
  }

  private ownerOf(sessionId: string): HarnessConversationRecord | undefined {
    return (
      this.records.get(sessionId) ??
      [...this.records.values()].find((record) => record.retiredSessionIds?.includes(sessionId))
    )
  }

  private projection(record: HarnessConversationRecord, message: UserMessage) {
    const rpcId = 'rpcId' in message.source ? message.source.rpcId : undefined
    return record.pendingRuns?.find(
      (item) => item.requestId === rpcId && marker(message) === `${PROJECT}${item.runId}`,
    )
  }

  private async admittedInput(
    record: HarnessConversationRecord,
    runId: string,
    caller: AbortSignal,
  ): Promise<string | undefined> {
    const current = () => this.deps.events(record, runId, -1).find((event) => event.kind === 'user')
    const existing = current()
    if (existing) return existing.text
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    let wake = () => {}
    let settled = false
    let issue: unknown
    const unsubscribe = this.deps.subscribe(() => wake())
    const abort = () => wake()
    signal.addEventListener('abort', abort, { once: true })
    void this.deps.wait(record, runId).then(
      () => {
        settled = true
        wake()
      },
      (error) => {
        issue = error
        wake()
      },
    )
    try {
      while (true) {
        const changed = new Promise<void>((resolve) => {
          wake = resolve
        })
        signal.throwIfAborted()
        const first = current()
        if (first) return first.text
        if (issue) throw issue
        if (settled) return undefined
        await changed
      }
    } finally {
      unsubscribe()
      signal.removeEventListener('abort', abort)
    }
  }

  private updateRecord(
    sessionId: string,
    update: (record: HarnessConversationRecord) => HarnessConversationRecord,
  ): Promise<HarnessConversationRecord> {
    const prior = this.recordWrites.get(sessionId) ?? Promise.resolve()
    const operation = prior
      .catch(() => undefined)
      .then(async () => {
        const current = this.records.get(sessionId)
        if (!current) throw new Error('CLI 原生会话绑定已解除')
        const next = update(current)
        await this.deps.bind(next)
        this.records.set(sessionId, next)
        return next
      })
    this.recordWrites.set(sessionId, operation)
    void operation
      .finally(() => {
        if (this.recordWrites.get(sessionId) === operation) this.recordWrites.delete(sessionId)
      })
      .catch(() => undefined)
    return operation
  }

  private async bindRunTurn(record: HarnessConversationRecord, turn: number, run: HarnessConversationRun, stream?: HarnessConversationStream) {
    try {
      await this.updateRecord(record.sessionId, (current) => {
        if (current.workerId !== record.workerId || current.parentSessionId !== record.parentSessionId)
          throw new Error('CLI turn 绑定的 Worker 身份已变化')
        return bindHarnessTurnRun(current, turn, run.runId)
      })
    } catch (error) {
      const cleanup = await Promise.allSettled([
        Promise.resolve().then(() => stream ? stream.stop() : this.deps.stop(record, run.runId)),
        run.done,
      ])
      if (stream?.finished && this.streams.get(record.sessionId) === stream) this.streams.delete(record.sessionId)
      const failures = cleanup.filter((item): item is PromiseRejectedResult => item.status === 'rejected')
      if (failures.length) throw new AggregateError([error, ...failures.map((item) => item.reason)], 'CLI turn 绑定失败，运行清理报告错误')
      throw error
    }
  }

  private drain(stream: HarnessConversationStream) {
    const operation = stream.stop()
    this.draining.add(operation)
    void operation
      .catch((error) => this.lifecycleIssues.push(error))
      .finally(() => this.draining.delete(operation))
  }

  private remember(record: HarnessConversationRecord) {
    const prior = this.records.get(record.sessionId)
    if (prior && (prior.workerId !== record.workerId || prior.parentSessionId !== record.parentSessionId))
      throw new Error('CLI 原生会话身份冲突')
    if (
      [...this.records.values()].some(
        (row) => row.workerId === record.workerId && row.sessionId !== record.sessionId,
      )
    )
      throw new Error('Worker 已绑定其他原生会话')
    this.records.set(record.sessionId, { ...record })
    if (record.initialRunId) this.knownRuns.add(`${record.sessionId}:${record.initialRunId}`)
    for (const pending of record.pendingRuns ?? []) this.knownRuns.add(`${record.sessionId}:${pending.runId}`)
  }

  private assertLive(record: HarnessConversationRecord, agent: Agent) {
    if (this.disposed) throw new Error('CLI 原生会话桥已关闭')
    if (agent.id !== record.sessionId || agent.session.header.parentSession !== record.parentSessionId)
      throw new Error('CLI 原生会话不属于该父会话')
    const worker = this.deps.getWorker(record.parentSessionId, record.workerId)
    if (worker.parentSessionId !== record.parentSessionId) throw new Error('Worker 父会话身份不匹配')
  }

  lookup(sessionId: string) {
    const record = this.records.get(sessionId)
    return record && structuredClone(record)
  }

  async repairDisplay(
    parent: Agent,
    worker: Worker,
    expectedSessionId: string,
    caller?: AbortSignal,
  ): Promise<HarnessConversationBinding> {
    const record = this.records.get(expectedSessionId)
    const runId = worker.runId
    const signal = caller ? AbortSignal.any([caller, this.lifetime.signal]) : this.lifetime.signal
    const assertIdle = () => {
      signal.throwIfAborted()
      if (
        this.disposed ||
        !record ||
        record.workerId !== worker.id ||
        record.parentSessionId !== parent.id ||
        worker.parentSessionId !== parent.id
      )
        throw new Error('待修复显示会话的归属已变化，请重新打开')
      const current = this.deps.getWorker(parent.id, worker.id)
      if (
        current.runId !== runId ||
        ['queued', 'running', 'stopping'].includes(current.status) ||
        this.deps.busy(record) ||
        this.ctx.agents.get(record.sessionId as Agent['id']) ||
        this.streams.has(record.sessionId)
      )
        throw new Error('请等待当前任务、消息提交及显示会话清理结束后再修复')
    }
    assertIdle()
    if (
      !this.deps.replaceBinding ||
      this.creating.has(worker.id) ||
      [...this.projecting.keys()].some((key) => key.startsWith(`${record!.sessionId}:`))
    )
      throw new Error('显示会话正在准备或安全恢复入口不可用')
    const repair = (async () => {
      let corrupt = false
      try {
        const query = this.ctx.get('sessionQuery') as
          | {
              observeSession(
                id: Agent['id'],
                options: { signal: AbortSignal; projectionMode: 'none' },
              ): Promise<Disposable>
            }
          | undefined
        if (!query) throw new Error('Harness 原生会话只读校验服务未就绪')
        const observation = await query.observeSession(expectedSessionId as Agent['id'], {
          signal,
          projectionMode: 'none',
        })
        observation[Symbol.dispose]()
      } catch (error) {
        signal.throwIfAborted()
        if (
          typeof error !== 'object' ||
          error === null ||
          !('code' in error) ||
          error.code !== 'SESSION_QUERY_CORRUPT_SESSION'
        )
          throw error
        corrupt = true
      }
      if (!corrupt) throw new Error('原生显示会话可正常读取，无需修复；请重新打开')
      assertIdle()
      return this.create(parent, structuredClone(worker), { initialRunId: runId, signal }, record)
    })()
    this.creating.set(worker.id, repair)
    try {
      return await repair
    } finally {
      if (this.creating.get(worker.id) === repair) this.creating.delete(worker.id)
    }
  }

  private recordsForFork(worker: Worker, history: ForkHistory) {
    // Inherited display history has no pending executions; preserve proven turn/run lookup.
    const source = [...this.records.values()].find((record) =>
      record.parentSessionId === worker.parentSessionId && record.turnRuns?.some((entry) => entry.runId === history.runId))
    return structuredClone(source?.turnRuns?.filter((entry) => entry.turn <= history.turn) ?? [])
  }

  async forkHistory(worker: Worker, atMessageId: string, signal: AbortSignal): Promise<ForkHistory> {
    const record = worker.harnessConversation && this.records.get(worker.harnessConversation.sessionId)
    if (!record || record.workerId !== worker.id || record.parentSessionId !== worker.parentSessionId)
      throw new Error('CLI 子会话绑定不匹配，无法分支')
    const query = this.ctx.get('sessionQuery') as {
      observeSession(id: Agent['id'], options: { signal: AbortSignal; projectionMode: 'none' }): Promise<Disposable & { events: readonly SessionEvent[] }>
    } | undefined
    if (!query) throw new Error('Harness 会话历史服务未就绪')
    const observation = await query.observeSession(SessionId(record.sessionId), { signal, projectionMode: 'none' })
    try { return selectForkHistory(observation.events, record, atMessageId) }
    finally { observation[Symbol.dispose]() }
  }

  async createFork(parent: Agent, worker: Worker, history: ForkHistory, signal: AbortSignal): Promise<ForkChild> {
    const binding = await this.create(parent, worker, { signal }, undefined, history)
    const record = this.records.get(binding.sessionId)!
    return {
      binding,
      commit: async () => { await this.deps.bind(record) },
      rollback: async () => {
        await this.drainChildren(parent, [SessionId(record.sessionId)])
        await this.deps.unbind(record)
        this.records.delete(record.sessionId)
        // The public child lifecycle drains its Agent. Durable logs are archived when available.
        const workspaces = this.ctx.get('workspaces') as { archiveSession?(id: ReturnType<typeof SessionId>): Promise<unknown> } | undefined
        if (workspaces?.archiveSession) await workspaces.archiveSession(SessionId(record.sessionId))
        else this.ctx.logger?.warn(`分支子会话 ${record.sessionId} 已解除绑定并释放；宿主未提供归档接口，持久化历史日志保留待清理`)
      },
    }
  }

  async ensure(
    parent: Agent,
    worker: Worker,
    options: HarnessConversationEnsureOptions = {},
  ): Promise<HarnessConversationBinding> {
    if (this.disposed) throw new Error('CLI 原生会话桥已关闭')
    if (worker.parentSessionId !== parent.id) throw new Error('不能跨父会话绑定 CLI 会话')
    const inFlight = this.creating.get(worker.id)
    if (inFlight) return inFlight
    const existing = [...this.records.values()].find((record) => record.workerId === worker.id)
    if (existing) {
      if (existing.parentSessionId !== parent.id) throw new Error('原生会话父身份不匹配')
      const native =
        options.nativeSubmissionId &&
        this.nativeSubmissions.get(existing.sessionId)?.has(options.nativeSubmissionId)
      if (native) this.knownRuns.add(`${existing.sessionId}:${worker.runId}`)
      if (options.projectRun && !native) {
        const key = `${existing.sessionId}:${worker.runId}`
        const operation =
          this.projecting.get(key) ?? this.projectRun(parent, worker, existing, options.signal)
        this.projecting.set(key, operation)
        try {
          await operation
        } catch (error) {
          if (
            !this.disposed &&
            !options.signal?.aborted &&
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'subagent/not-resumable' &&
            !this.ctx.agents.get(existing.sessionId as Agent['id']) &&
            this.deps.replaceBinding
          ) {
            const recovering = this.creating.get(worker.id) ?? this.create(parent, worker, options, existing)
            this.creating.set(worker.id, recovering)
            try {
              return await recovering
            } finally {
              if (this.creating.get(worker.id) === recovering) this.creating.delete(worker.id)
            }
          }
          throw error
        } finally {
          if (this.projecting.get(key) === operation) this.projecting.delete(key)
        }
      }
      return this.binding(existing)
    }
    const creating = this.create(parent, worker, options)
    this.creating.set(worker.id, creating)
    try {
      return await creating
    } finally {
      if (this.creating.get(worker.id) === creating) this.creating.delete(worker.id)
    }
  }

  private async projectRun(
    parent: Agent,
    worker: Worker,
    record: HarnessConversationRecord,
    caller?: AbortSignal,
  ) {
    const key = `${record.sessionId}:${worker.runId}`
    if (this.knownRuns.has(key)) return
    this.knownRuns.add(key)
    const requestId = randomUUID()
    const signal = caller ? AbortSignal.any([caller, this.lifetime.signal]) : this.lifetime.signal
    try {
      await this.updateRecord(record.sessionId, (current) => {
        if ((current.pendingRuns?.length ?? 0) >= 256)
          throw new Error('原生会话显示队列过长，请等待历史显示完成')
        return {
          ...current,
          pendingRuns: [...(current.pendingRuns ?? []), { requestId, runId: worker.runId }],
        }
      })
      signal.throwIfAborted()
      await this.ctx.subagents.prompt(
        {
          requestId: requestId as never,
          parentSessionId: parent.id,
          childSessionId: SessionId(record.sessionId),
          mode: 'continuable',
          delivery: 'queue',
          content: [{ type: 'text', text: `${PROJECT}${worker.runId}` }],
        },
        signal,
      )
    } catch (error) {
      this.knownRuns.delete(key)
      try {
        await this.updateRecord(record.sessionId, (current) => ({
          ...current,
          pendingRuns: current.pendingRuns?.filter((item) => item.requestId !== requestId),
        }))
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'CLI 显示挂接失败且回滚未确认')
      }
      throw error
    }
  }

  private async create(
    parent: Agent,
    worker: Worker,
    options: HarnessConversationEnsureOptions,
    previous?: HarnessConversationRecord,
    forkHistory?: ForkHistory,
  ) {
    const retired = previous ? [...(previous.retiredSessionIds ?? []), previous.sessionId] : undefined
    if (retired && retired.length > 64) throw new Error('原生会话历史引用已达上限，未重新发送 CLI 任务')
    const record: HarnessConversationRecord = {
      workerId: worker.id,
      parentSessionId: parent.id,
      sessionId: randomUUID(),
      initialRunId: options.initialRunId ?? worker.runId,
      initialPending: !forkHistory,
      ...(forkHistory ? { turnRuns: this.recordsForFork(worker, forkHistory) } : {}),
      ...(previous?.nativeInputs ? { nativeInputs: structuredClone(previous.nativeInputs) } : {}),
      ...(retired ? { retiredSessionIds: retired } : {}),
    }
    const signal = options.signal
      ? AbortSignal.any([options.signal, this.lifetime.signal])
      : this.lifetime.signal
    signal.throwIfAborted()
    this.provisioning.set(record.sessionId, record)
    if (forkHistory) this.forkSeeds.set(record.sessionId, forkHistory)
    if (previous) this.replacements.set(record.sessionId, previous)
    try {
      const spec: NativeChildSpec = {
        provider: HARNESS_CLI_SUBAGENT_PROVIDER,
        label: worker.title,
        childId: SessionId(record.sessionId),
        request: {
          parent,
          prompt: [{ type: 'text', text: forkHistory ? `${FORK}${record.workerId}` : `${SENTINEL}${record.initialRunId}` }],
          agentOptions: { provider: HARNESS_CLI_PROVIDER, model: this.model(record) },
          // Preserve the child scope's real tool policy for the controlled MCP
          // bridge. This stream never asks AgentLoop to execute native CLI tools.
        },
        signal,
      }
      let result: { childId: ReturnType<typeof SessionId> }
      if (activationSubagents(this.ctx.subagents)) {
        const activation = await this.ctx.subagents.startActivation({ ...spec, delivery: 'caller' })
        this.activations.set(record.sessionId, activation)
        // Observe settlement exactly once without consuming or replaying input.
        void activation.result.catch((error) => this.lifecycleIssues.push(error))
        result = activation
      } else if (legacySubagents(this.ctx.subagents)) result = await this.ctx.subagents.startContinuable(spec)
      else throw new Error('Harness CLI 子会话生命周期接口已失效')
      if (result.childId !== record.sessionId) throw new Error('Harness 返回了不同的 CLI 子会话身份')
      if (forkHistory && activationSubagents(this.ctx.subagents)) {
        const outcome = await this.activations.get(record.sessionId)!.result as { stopReason?: string }
        if (outcome.stopReason !== 'completed') throw new Error('Harness 分支历史初始化未完成')
      }
      if (forkHistory && !activationSubagents(this.ctx.subagents)) {
        // Legacy continuable startup returns before its first Inbox item settles.
        // Retain the bootstrap marker until the real loop consumed it as a noop.
        const child = this.ctx.agents.get(SessionId(record.sessionId))
        if (!child) throw new Error('Harness 分支子会话未进入可用状态')
        await child.whenIdle()
        const end = child.session.snapshotEvents().slice(forkHistory.seed.length)
          .filter((event) => event.type === 'turn/end').at(-1)
        if (!end || end.type !== 'turn/end' || end.data.reason.kind !== 'completed')
          throw new Error('Harness 分支历史初始化未完成')
      }
      return this.binding(record)
    } catch (error) {
      try {
        await this.drainChildren(parent, [SessionId(record.sessionId)])
        if (previous && this.records.has(record.sessionId)) {
          const rollback = {
            ...previous,
            retiredSessionIds: [...(previous.retiredSessionIds ?? []), record.sessionId],
          }
          await this.deps.replaceBinding!(record, rollback)
          this.records.delete(record.sessionId)
          this.remember(rollback)
        } else if (!previous) {
          await this.deps.unbind(record)
          this.records.delete(record.sessionId)
        }
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'CLI 原生子会话创建失败且清理未确认')
      }
      throw error
    } finally {
      this.forkSeeds.delete(record.sessionId)
      this.provisioning.delete(record.sessionId)
      this.replacements.delete(record.sessionId)
    }
  }

  private async *route(
    options: GenerateOptions,
    next: () => AsyncIterable<StreamChunk>,
  ): AsyncGenerator<StreamChunk> {
    const record = options.sessionId ? this.records.get(options.sessionId) : undefined
    const initiator = this.ctx.agents?.currentInitiator()
    const ownedInitiator = initiator && this.ownerOf(initiator.id)
    if (!record) {
      if (
        options.provider === HARNESS_CLI_PROVIDER ||
        ownedInitiator ||
        (options.sessionId && this.ownerOf(options.sessionId))
      )
        throw new Error('CLI 会话路由缺失，已禁止 DSH 模型回退')
      yield* next()
      return
    }
    if (this.disposed || options.purpose || !isAgentLoopRequest(options))
      throw new Error('CLI 会话辅助生成尚未接通，已禁止 DSH 模型回退')
    const position = this.positions.get(record.sessionId)
    if (!position || options.provider !== HARNESS_CLI_PROVIDER || options.model !== this.model(record))
      throw new Error('CLI 会话模型路由不匹配')
    this.assertLive(record, position.agent)
    let stream = this.streams.get(record.sessionId)
    if (!stream || stream.finished) {
      const pending = this.pending.get(record.sessionId)
      this.pending.delete(record.sessionId)
      if (!pending) throw new Error('CLI 会话没有已授权输入，不能重放或恢复生成')
      if (pending.noop) {
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      let run: HarnessConversationRun | undefined
      if (pending.attachRunId)
        run = { runId: pending.attachRunId, done: this.deps.wait(record, pending.attachRunId) }
      else {
        // Record intent before admission. accepted=false never proves execution;
        // the durable Worker batch receipt resolves a crash/write-failure gap.
        await this.recordInputs(record, pending, false)
        const submissions = this.nativeSubmissions.get(record.sessionId) ?? new Set<string>()
        submissions.add(pending.requestId)
        this.nativeSubmissions.set(record.sessionId, submissions)
        const signal = AbortSignal.any([position.signal, this.lifetime.signal])
        const launching = Promise.resolve().then(() => {
          signal.throwIfAborted()
          return pending.messages.some(hasHarnessAttachments)
            ? this.deps.run(record, pending.prompt, pending.requestId, signal, pending.messages)
            : this.deps.run(record, pending.prompt, pending.requestId, signal)
        })
        this.launches.add(launching)
        try {
          run = await launching
          // Run preparation may start after deps.run returned its receipt. Keep
          // this source identity until its exact run has fully settled.
          void run.done
            .finally(() => {
              submissions.delete(pending.requestId)
              if (!submissions.size) this.nativeSubmissions.delete(record.sessionId)
            })
            .catch(() => {})
          await this.recordInputs(record, pending, true)
          signal.throwIfAborted()
        } catch (error) {
          if (run) {
            const admitted = run
            const cleanup = await Promise.allSettled([
              Promise.resolve().then(() => this.deps.stop(record, admitted.runId)),
              admitted.done,
            ])
            const failed = cleanup.filter(
              (result): result is PromiseRejectedResult => result.status === 'rejected',
            )
            if (failed.length)
              throw new AggregateError(
                [error, ...failed.map((result) => result.reason)],
                '原生输入登记失败；运行已等待结束，但停止清理报告错误',
              )
          } else {
            submissions.delete(pending.requestId)
            if (!submissions.size) this.nativeSubmissions.delete(record.sessionId)
          }
          throw error
        } finally {
          this.launches.delete(launching)
        }
      }
      const runId = run.runId
      stream = new HarnessConversationStream(
        record,
        run,
        this.deps,
        position.signal,
        { provider: options.provider, model: options.model },
        {
          projectUser: (agent, event) => this.projectSteering(record, agent, event),
          settled: () => this.settleSteering(record.sessionId, runId),
        },
      )
      // Own cancellation before awaiting the durable turn association. Disposal
      // must still drain an admitted run while that atomic write is pending.
      this.streams.set(record.sessionId, stream)
      await this.bindRunTurn(record, position.turn, run, stream)
      this.knownRuns.add(`${record.sessionId}:${run.runId}`)
      this.pumpSteering(record)
    } else {
      await this.bindRunTurn(record, position.turn, stream.run, stream)
    }
    try {
      if (stream.finished) {
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      yield* stream.segment(position.agent, position.turn, position.step, position.signal)
    } finally {
      if (stream.finished && this.streams.get(record.sessionId) === stream)
        this.streams.delete(record.sessionId)
    }
  }

  private async drainChildren(parent: Agent, children: ReturnType<typeof SessionId>[]) {
    const handles = children.flatMap(id => {
      const handle = this.activations.get(id)
      return handle ? [{ id, handle }] : []
    })
    const outcomes = await Promise.allSettled(handles.map(async ({ id, handle }) => {
      await handle.dispose()
      if (this.activations.get(id) === handle) this.activations.delete(id)
    }))
    // Catalog draining also covers restored children without a live activation handle.
    if (activationSubagents(this.ctx.subagents)) await this.ctx.subagents.drainChildren(parent, children)
    else if (legacySubagents(this.ctx.subagents)) await this.ctx.subagents.drainContinuableChildren(parent, children)
    else throw new Error('Harness CLI 子会话清理接口已失效')
    const failed = outcomes.filter((item): item is PromiseRejectedResult => item.status === 'rejected')
    if (failed.length) throw new AggregateError(failed.map(item => item.reason), 'CLI activation 清理失败')
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    this.lifetime.abort(new Error('CLI 原生会话桥已关闭'))
    await Promise.allSettled([...this.launches])
    const active = [...this.streams.values()]
    const stopping = Promise.allSettled([...active.map((stream) => stream.stop()), ...this.draining])
    await Promise.allSettled([...this.creating.values(), ...this.projecting.values()])
    await Promise.allSettled([...this.recordWrites.values()])
    const outcomes = await stopping
    outcomes.push(...(await Promise.allSettled([...this.steeringInputs.values()].map((input) => input.done))))
    // Activation handles remain authoritative even if the parent Agent was
    // unloaded before plugin disposal. Release them before catalog draining.
    outcomes.push(...(await Promise.allSettled([...this.activations].map(async ([id, handle]) => {
      this.activations.delete(id)
      await handle.dispose()
    }))))
    const parents = new Map<Agent, string[]>()
    for (const record of this.records.values()) {
      const parent = this.ctx.agents.get(record.parentSessionId as Agent['id'])
      if (!parent) continue
      const children = parents.get(parent) ?? []
      children.push(record.sessionId)
      parents.set(parent, children)
    }
    // Official child release can insert its settlement notice into a live
    // parent. Retain the suppression hooks until every owned release finishes.
    outcomes.push(
      ...(await Promise.allSettled(
        [...parents].map(([parent, children]) =>
          this.drainChildren(parent, children.map(SessionId)),
        ),
      )),
    )
    outcomes.push(...(await Promise.allSettled([...this.settlementHolds])))
    this.streams.clear()
    this.pending.clear()
    this.positions.clear()
    this.nativeSubmissions.clear()
    this.heldSteering.clear()
    for (const dispose of this.disposers.splice(0).reverse()) dispose()
    await this.commandGuard.dispose()
    const failures = outcomes.filter((item): item is PromiseRejectedResult => item.status === 'rejected')
    if (failures.length || this.lifecycleIssues.length)
      throw new AggregateError(
        [...failures.map((item) => item.reason), ...this.lifecycleIssues],
        'CLI 原生会话清理未完成',
      )
  }
}

export function createHarnessConversationBridge(
  ctx: Context,
  deps: HarnessConversationDependencies,
): HarnessConversationApi {
  return new HarnessConversationBridge(ctx, deps)
}
