import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallRecovery } from '@deepseek-ai/dsh-session'
import {
  ToolCallId,
  AssistantStreamAccumulator,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  cliOf,
  foldEvents,
  isUserInterrupted,
  type TimelineItem,
  type NativeResponseUsage,
  type Worker,
  type WorkerEvent,
  truncationNote,
} from '../shared/types.ts'
import type {
  HarnessConversationDependencies,
  HarnessConversationRecord,
  HarnessConversationRun,
} from './harness-conversation-types.ts'
import { HarnessObservedTools, observedToolInput } from './harness-observed-tools.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'cliworker-continuation': { kind: 'cliworker-continuation'; form: 'notice'; summary: string }
    'cliworker-steering': { kind: 'cliworker-steering'; form: 'notice'; summary: string }
  }
}

const terminalTool = (state?: string) =>
  /^(?:COMPLETED|COMPLETE|DONE|SUCCESS|FAILED|ERROR|CANCELLED|CANCELED)$/u.test(state ?? '')
const failedTool = (state?: string) => /^(?:FAILED|ERROR|CANCELLED|CANCELED)$/u.test(state ?? '')
const json = (value: unknown) => JSON.stringify(value) ?? 'null'
const textOf = (row: TimelineItem) => (row.kind === 'reasoning' ? (row.detail ?? row.text) : row.text)

/** One CLI run consumed once across native steps. It never calls an LLM or executes a tool. */
/** The CLI finished its turn; an unverified result still needs the user's check, not a retry. */
const endsNormally = (outcome: { status: string }) => outcome.status === 'completed' || outcome.status === 'uncertain'

export class HarnessConversationStream {
  private readonly history: WorkerEvent[] = []
  private seq = -1
  private row = 0
  private outcome?: Worker
  private issue?: unknown
  private readonly waiters = new Set<() => void>()
  private readonly unsubscribe: () => void
  private closed = false
  private active = false
  private stopping?: Promise<void>
  private readonly abort: () => void
  private readonly settledResponses = new Set<string>()
  private observedTools?: HarnessObservedTools

  constructor(
    readonly record: HarnessConversationRecord,
    readonly run: HarnessConversationRun,
    private readonly deps: HarnessConversationDependencies,
    private readonly signal: AbortSignal,
    private readonly source: { provider: string; model: string },
    private readonly nativeInputs?: {
      /** Original native messages already own the user echo for these Worker receipts. */
      projectUser(agent: Agent, event: WorkerEvent): boolean | Promise<boolean>
      /** Receipt persistence and original-message restoration are part of turn cleanup. */
      settled(): Promise<void>
    },
  ) {
    this.unsubscribe = deps.subscribe(() => this.notify())
    void run.done.then(
      (outcome) => {
        this.outcome = outcome
        this.notify()
      },
      (error) => {
        this.issue = error
        this.notify()
      },
    )
    this.abort = () => {
      void this.stop().catch((error) => {
        this.issue = error
        this.notify()
      })
    }
    signal.addEventListener('abort', this.abort, { once: true })
    if (signal.aborted) this.abort()
  }

  get finished() {
    return this.closed
  }

  /** The turn signal remains owned between projection steps, not only while yielding. */
  stop(): Promise<void> {
    return (this.stopping ??= (async () => {
      try {
        const outcomes = await Promise.allSettled([
          Promise.resolve().then(() => {
            if (
              this.deps.getWorker(this.record.parentSessionId, this.record.workerId).runId === this.run.runId
            )
              return this.deps.stop(this.record, this.run.runId)
          }),
          this.run.done,
          this.nativeInputs?.settled(),
        ])
        const failed = outcomes.filter(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        )
        if (failed.length === 1) throw failed[0]!.reason
        if (failed.length)
          throw new AggregateError(
            failed.map((result) => result.reason),
            'CLI 运行停止清理失败',
          )
      } finally {
        this.close()
      }
    })())
  }

  private rows() {
    const incoming = this.deps.events(this.record, this.run.runId, this.seq)
    for (const event of incoming) {
      if (event.runId !== this.run.runId || !Number.isSafeInteger(event.seq) || event.seq <= this.seq)
        throw new Error('原生会话事件源的运行身份或顺序不匹配')
      if (event.response && event.kind !== 'tool' && this.settledResponses.has(event.response.id))
        throw new Error('CLI 已完成响应收到迟到内容，已停止原生投影')
      this.history.push(event)
      this.seq = event.seq
    }
    const initialUser = this.history.find((event) => event.kind === 'user')
    return foldEvents(
      this.history,
      undefined,
      cliOf(this.deps.getWorker(this.record.parentSessionId, this.record.workerId).preference),
    ).filter(
      (item) =>
        item.kind === 'assistant' ||
        item.kind === 'reasoning' ||
        item.kind === 'tool' ||
        (item.kind === 'user' &&
          item.id.startsWith(`${this.run.runId}:event:`) &&
          item.id !== `${this.run.runId}:event:${initialUser?.seq}`),
    )
  }

  private notify() {
    for (const wake of this.waiters) wake()
  }

  private async changed(signal: AbortSignal) {
    signal.throwIfAborted()
    // Install the waiter before re-reading the source: a notification cannot be lost.
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    this.waiters.add(resolve)
    const abort = () => resolve()
    signal.addEventListener('abort', abort, { once: true })
    try {
      const before = this.seq
      this.rows()
      if (this.seq !== before || this.outcome || this.issue) return
      await promise
      signal.throwIfAborted()
    } finally {
      signal.removeEventListener('abort', abort)
      this.waiters.delete(resolve)
    }
  }

  private continuation(agent: Agent) {
    agent.inject(
      createUserMessage({
        source: { kind: 'cliworker-continuation', form: 'notice', summary: '继续显示当前 CLI 运行' },
        content: [],
      }),
    )
  }

  /** These verified producers only append published public reasoning text.
   * Other protocols may withdraw snapshots and retain their completion gate.
   */
  private appendOnlyReasoning() {
    const worker = this.deps.getWorker(this.record.parentSessionId, this.record.workerId)
    if (worker.runId !== this.run.runId) return false
    const cli = cliOf(worker.preference)
    return (cli === 'hermes' && worker.transport === 'hermes-http-v1')
      || (cli === 'codex' && worker.transport === 'codex-app-v1')
  }

  private finish(agent: Agent): StreamChunk {
    if (this.issue) throw this.issue
    const outcome = this.outcome
    if (!outcome) throw new Error('CLI 运行尚未完成清理')
    if (outcome.runId !== this.run.runId) throw new Error('CLI 运行终态身份不匹配')
    // An unverified outcome is not a failed request: the plugin's own notice
    // carries its 结果待核实 wording, so Harness must not add a failure card.
    if (endsNormally(outcome)) return { type: 'finish', reason: { kind: 'stop' } }
    if (isUserInterrupted(outcome)) {
      // rc.2 treats an aborted model finish as a failed request unless the
      // owning turn was actually cancelled. The Worker outcome is available
      // only after its cleanup barrier, and close() has detached our abort
      // listener, so this public cancellation cannot stop the CLI twice.
      agent.cancel({ kind: 'user' }, { keepInbox: true })
      return {
        type: 'finish',
        reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'CLI 运行已停止' } },
      }
    }
    const failure = { code: 'CLI_RUN_FAILED', message: outcome.error || 'CLI 运行未成功完成' }
    return {
      type: 'finish',
      reason: { kind: 'error', failure },
    }
  }

  /** One proven provider response, preserving its block identities and one usage sample. */
  private async *responseSegment(
    agent: Agent,
    first: TimelineItem,
    signal: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const responseId = first.response!.id
    const blocks = new Map<
      string,
      { index: number; kind: 'text' | 'reasoning'; text: string; started: boolean }
    >()
    const tools = new Map<string, { index: number; serialized: string }>()
    const toolStarts = new Map<string, { index: number; id: ToolCallId; name: string }>()
    let count = 0,
      complete = false
    let usage: NativeResponseUsage | undefined
    while (true) {
      signal.throwIfAborted()
      const rows = this.rows()
      const group: TimelineItem[] = []
      for (let index = this.row; rows[index]?.response?.id === responseId; index++) group.push(rows[index]!)
      count = group.length
      complete = group.some((row) => row.response?.complete)
      for (const row of group) {
        const identity = row.response!
        if (identity.usage) {
          if (!identity.complete) throw new Error('CLI 响应用量缺少完成边界')
          if (usage && json(usage) !== json(identity.usage)) throw new Error('CLI 响应用量回执矛盾')
          usage = identity.usage
        }
        if (row.kind === 'tool') {
          const observedId = row.toolCall?.callId, name = row.toolCall?.name
          if (observedId && name && name !== 'run_code' && /^[a-zA-Z0-9_.:-]{1,128}$/u.test(name)) {
            const id = ToolCallId(`cliworker:${this.run.runId}:${observedId}`)
            const started = toolStarts.get(identity.blockId)
            if (started) {
              if (started.index !== identity.index || started.id !== id || started.name !== name)
                throw new Error('CLI 工具响应块身份发生变化')
            } else {
              if ([...blocks.values(), ...toolStarts.values()].some((entry) => entry.index === identity.index))
                throw new Error('CLI 响应块顺序发生冲突')
              toolStarts.set(identity.blockId, { index: identity.index, id, name })
              // Publish the real start while arguments/usage are still pending.
              // No receipt is registered or dispatched before response completion.
              yield { type: 'block-start', index: identity.index, blockType: 'tool-call' }
              yield { type: 'tool-call-delta', index: identity.index, id, name, argumentsDelta: '' }
            }
          }
          if (!complete) continue
          this.observedTools ??= new HarnessObservedTools(agent, this.record, this.run.runId, this.deps, {
            rows: () => this.rows(),
            changed: (signal) => this.changed(signal),
            settled: () => !!this.outcome || !!this.issue,
            completed: () => this.outcome?.status === 'completed' && !this.issue,
            hasFollowing: () => !!this.rows()[this.row],
            close: () => this.close(),
            inputsSettled: async () => {
              await this.nativeInputs?.settled()
            },
            stop: () => this.stop(),
          })
          const block = this.observedTools.declare(row)
          const previous = tools.get(identity.blockId)
          if (previous) {
            if (previous.index !== identity.index || previous.serialized !== json(block))
              throw new Error('CLI 工具响应块发生变化')
          } else {
            if ([...blocks.values(), ...tools.values()].some((entry) => entry.index === identity.index))
              throw new Error('CLI 响应块顺序发生冲突')
            tools.set(identity.blockId, { index: identity.index, serialized: json(block) })
            if (!toolStarts.has(identity.blockId)) yield { type: 'block-start', index: identity.index, blockType: 'tool-call' }
            yield {
              type: 'tool-call-delta',
              index: identity.index,
              id: block.id,
              name: block.name,
              argumentsDelta: block.arguments,
            }
            yield { type: 'block-end', index: identity.index, block }
          }
          continue
        }
        if (row.kind !== 'assistant' && row.kind !== 'reasoning')
          throw new Error('当前 CLI 响应包含尚未接通回执适配的内容')
        const kind = row.kind === 'reasoning' ? 'reasoning' : 'text'
        let block = blocks.get(identity.blockId)
        if (!block) {
          if ([...blocks.values(), ...toolStarts.values()].some((entry) => entry.index === identity.index))
            throw new Error('CLI 响应块顺序发生冲突')
          block = { index: identity.index, kind, text: '', started: false }
          blocks.set(identity.blockId, block)
        }
        if (block.index !== identity.index || block.kind !== kind) throw new Error('CLI 响应块身份发生变化')
        // Snapshot-based public reasoning can be withdrawn until finalized.
        const text = kind === 'reasoning' && !complete && !terminalTool(row.state) && !this.appendOnlyReasoning() ? '' : textOf(row)
        if (!text.startsWith(block.text)) throw new Error('CLI 公开正文发生不可单调覆盖，已停止原生投影')
        if (text.length > block.text.length) {
          if (!block.started) {
            block.started = true
            yield { type: 'block-start', index: block.index, blockType: kind }
          }
          yield {
            type: kind === 'reasoning' ? 'reasoning-delta' : 'text-delta',
            index: block.index,
            text: text.slice(block.text.length),
          }
          block.text = text
        }
      }
      const next = rows[this.row + count]
      if (next && !complete) throw new Error('CLI 新响应先于当前响应的完成边界')
      // A native step must not be opened merely to wait for process cleanup.
      if ((complete && (next || tools.size)) || this.outcome || this.issue) break
      await this.changed(signal)
    }
    // Open tool previews must never turn into dispatchable calls merely because
    // the CLI run ended. An actual response completion remains mandatory.
    if (!complete && toolStarts.size) throw new Error('CLI 工具响应缺少完成边界，未执行或伪造回执')
    for (const block of [...blocks.values()].sort((left, right) => left.index - right.index))
      if (block.started)
        yield { type: 'block-end', index: block.index, block: { type: block.kind, text: block.text } }
    if (complete && usage) yield { type: 'usage', usage }
    this.settledResponses.add(responseId)
    this.row += count
    if (tools.size) {
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (this.outcome || this.issue) await this.nativeInputs?.settled()
    const rows = this.rows()
    if (rows[this.row] || !this.outcome || !endsNormally(this.outcome) || this.issue) {
      this.continuation(agent)
      yield { type: 'finish', reason: { kind: 'stop' } }
    } else {
      this.close()
      yield this.finish(agent)
    }
  }

  /** Project one native boundary; adjacent ungrouped narrative rows share a step. */
  async *segment(agent: Agent, turn: number, step: number, signal: AbortSignal): AsyncGenerator<StreamChunk> {
    if (this.closed || this.active) throw new Error('当前 CLI 流已关闭或正在被消费')
    this.active = true
    let natural = false
    try {
      let rows = this.rows()
      while (!rows[this.row]) {
        if (this.outcome || this.issue) {
          await this.nativeInputs?.settled()
          rows = this.rows()
          if (rows[this.row]) break
          this.close()
          natural = true
          yield this.finish(agent)
          return
        }
        await this.changed(signal)
        rows = this.rows()
      }
      const first = rows[this.row]!
      if (first.response) {
        yield* this.responseSegment(agent, first, signal)
        natural = true
        return
      }
      if (first.kind === 'user') {
        // Only acknowledged current-run Worker inputs reach this event source.
        // Display them directly; injecting them into the inbox would send twice.
        const event = this.history.find((item) => first.id === `${this.run.runId}:event:${item.seq}`)
        if (!event || !(await this.nativeInputs?.projectUser(agent, event)))
          agent.session.append(
            'user/message',
            createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: first.text }] }),
            { surfaceOp: 'append' },
          )
      } else if (first.kind === 'tool') {
        // These are already executed CLI operations. A passive log entry is not
        // a tool-call stream chunk, so AgentLoop cannot dispatch it a second time.
        const callId = ToolCallId(`cliworker:${this.run.runId}:${first.toolCall?.callId ?? first.id}`)
        const input = first.toolCall && observedToolInput(first.toolCall)
        const block = {
          type: 'tool-call' as const,
          id: callId,
          name: first.toolCall?.name || first.text || 'CLI 工具',
          arguments: input === undefined ? '' : json(input),
        }
        // Released Session v4 requires a model-advertised call before a call
        // lifecycle. Append this observed CLI declaration directly, with a
        // complete projection stream, rather than yielding an executable call
        // through AgentLoop. This also remains valid after JSONL cold reads.
        const projection = new AssistantStreamAccumulator()
        const chunks: StreamChunk[] = [
          { type: 'block-start', index: 0, blockType: 'tool-call' },
          {
            type: 'tool-call-delta',
            index: 0,
            id: callId,
            name: block.name,
            argumentsDelta: block.arguments,
          },
          { type: 'block-end', index: 0, block },
          { type: 'finish', reason: { kind: 'tool-calls' } },
        ]
        const time = Date.now()
        for (const chunk of chunks) projection.push({ time, chunk })
        const declaration = agent.session.append(
          'assistant/message',
          {
            turn,
            step,
            message: createAssistantMessage({ content: [block], source: this.source }),
            stream: [...projection.snapshot()],
          },
          { surfaceOp: 'append' },
        )
        const call = agent.session.append('tool/call', {
          turn,
          step,
          callId,
          name: block.name,
          arguments: block.arguments,
        })
        const recovery = new ToolCallRecovery()
        recovery.observe(declaration)
        recovery.observe(call)
        let current = first
        while (!terminalTool(current.state) && !this.outcome && !this.issue) {
          await this.changed(signal)
          current = this.rows()[this.row]!
        }
        if (terminalTool(current.state)) {
          const output = current.toolCall?.output
          agent.session.append(
            'tool/result',
            {
              turn,
              step,
              message: createToolResultMessage({
                callId,
                isError: failedTool(current.state),
                content: [
                  {
                    type: 'text',
                    // A cut preview names itself, so the main agent never mistakes it for the whole output.
                    text:
                      (output === undefined
                        ? (current.detail ?? current.text)
                        : typeof output === 'string'
                          ? output
                          : json(output)) + (current.truncated ? `\n\n[${truncationNote(current)}]` : ''),
                  },
                ],
              }),
            },
            { surfaceOp: 'append', sourceEventSeqs: [call.seq] },
          )
        } else {
          // The CLI has settled without a public result for this observed
          // call. Use Harness's conservative unknown-outcome repair before
          // closing this step, so a stopped/failed turn remains cold-readable.
          // This neither reports success nor executes/retries the CLI tool.
          for (const event of recovery.results())
            agent.session.append('tool/result', event.data, {
              surfaceOp: 'append',
              ...(event.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: event.sourceEventSeqs }),
            })
        }
      } else {
        // Without a proven response identity, a display row is not an LLM
        // boundary. In particular Hermes can publish public reasoning after
        // its answer. Keep adjacent narrative blocks in one native message so
        // the official latest-step/final-answer rule retains that answer.
        const assistantStepKey = (row: TimelineItem) => row.kind === 'assistant'
          && row.id.startsWith(`${this.run.runId}:assistant:`) ? row.id : undefined
        const blocks = new Map<string, { index: number; kind: 'text' | 'reasoning'; text: string; started: boolean }>()
        let count = 0
        while (true) {
          signal.throwIfAborted()
          rows = this.rows()
          const group: TimelineItem[] = []
          let assistantStep: string | undefined
          for (let cursor = this.row; rows[cursor]; cursor++) {
            const current = rows[cursor]!
            if (current.response || (current.kind !== 'assistant' && current.kind !== 'reasoning')) break
            // Preserve an explicitly distinct CLI assistant step. A reasoning
            // row has its own counter and does not establish such a boundary.
            const currentAssistantStep = assistantStepKey(current)
            if (assistantStep && currentAssistantStep && assistantStep !== currentAssistantStep) break
            assistantStep ??= currentAssistantStep
            group.push(current)
          }
          count = group.length
          const boundary = !!rows[this.row + count] || !!this.outcome || !!this.issue
          for (let index = 0; index < count; index++) {
            const current = group[index]!
            const kind = current.kind === 'reasoning' ? 'reasoning' : 'text'
            let block = blocks.get(current.id)
            if (!block) {
              block = { index, kind, text: '', started: false }
              blocks.set(current.id, block)
            }
            if (block.index !== index || block.kind !== kind) throw new Error('CLI 公开正文块身份发生变化')
            const publicFinal = boundary || index < count - 1 || terminalTool(current.state)
            // A finalized snapshot can be shown immediately without ending
            // this request solely to wait for process cleanup in an empty one.
            const text = kind === 'reasoning' && !publicFinal && !this.appendOnlyReasoning() ? '' : textOf(current)
            if (!text.startsWith(block.text)) throw new Error('CLI 公开正文发生不可单调覆盖，已停止原生投影')
            if (text.length > block.text.length) {
              if (!block.started) {
                block.started = true
                yield { type: 'block-start', index, blockType: kind }
              }
              yield {
                type: kind === 'reasoning' ? 'reasoning-delta' : 'text-delta',
                index,
                text: text.slice(block.text.length),
              }
              block.text = text
            }
          }
          if (boundary) break
          await this.changed(signal)
        }
        // An aggregate may append to an earlier text block after late
        // reasoning arrived. Keep every block open until this segment ends.
        for (const block of blocks.values())
          if (block.started)
            yield { type: 'block-end', index: block.index, block: { type: block.kind, text: block.text } }
        this.row += count - 1
      }
      this.row++
      // Tool/user rows may finish before the run's cleanup barrier. Wait for
      // an actual following row or outcome instead of opening an empty step.
      while (!this.rows()[this.row] && !this.outcome && !this.issue) await this.changed(signal)
      if (this.outcome || this.issue) await this.nativeInputs?.settled()
      rows = this.rows()
      if (rows[this.row] || !this.outcome || !endsNormally(this.outcome) || this.issue) {
        // Settle the observed public prefix before reporting a terminal error
        // in a separate empty attempt. AgentLoop does not put error-attempt
        // blocks on its durable surface, so combining them would lose text.
        this.continuation(agent)
        natural = true
        yield { type: 'finish', reason: { kind: 'stop' } }
      } else {
        this.close()
        natural = true
        yield this.finish(agent)
      }
    } finally {
      this.active = false
      // Early iterator return, cancellation and malformed events all cross the
      // existing Stop barrier before this bridge releases its run ownership.
      if (!natural) {
        await this.stop()
      }
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.observedTools?.close()
    this.signal.removeEventListener('abort', this.abort)
    this.unsubscribe()
    this.notify()
  }
}
