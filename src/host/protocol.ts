import { StringDecoder } from 'node:string_decoder'
import type { WorkerEvent } from '../shared/types.ts'
import { agyResponseUsage } from './native-response.mjs'

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
export interface ProtocolResult {
  conversationId: string
  status: string
  response: string
  error?: string
  /** Native SUCCESS only: what the main agent should know without changing the status. */
  notice?: string
  /** AGY text observed in this process, independent of its conversation-wide result. */
  currentTurnResponse?: string
  /** Evidence of DONE steps only; this does not establish task success. */
  completedStepResponse?: string
}
export type EventInput = Omit<WorkerEvent, 'seq' | 'runId' | 'time'>

/** Antigravity 1.2.16 NDJSON framing, including split UTF-8 characters. */
export class AgyProtocol {
  private decoder = new StringDecoder('utf8')
  private pending = ''
  result?: ProtocolResult
  conversationId?: string
  private responses = new Map<number | undefined, string>()
  private steps = new Map<number, { type: string; state?: string }>()
  private unclassifiedOrFailed = false
  get currentTurnResponse(): string {
    return [...this.responses.values()].filter((text) => text.trim()).join('\n')
  }
  constructor(
    private emit: (event: EventInput) => void,
    private identify: (id: string) => void,
    private maxLineBytes: number,
  ) {}
  feed(chunk: Buffer | string): void {
    this.pending += typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
    let end: number
    while ((end = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, end).trim()
      this.pending = this.pending.slice(end + 1)
      if (line) this.line(line)
    }
    if (Buffer.byteLength(this.pending) > this.maxLineBytes) throw new Error('CLI event exceeds maxLineBytes')
  }
  end(): void {
    this.pending += this.decoder.end()
    if (this.pending.trim()) this.line(this.pending.trim())
    this.pending = ''
  }
  private id(value: unknown): void {
    if (typeof value !== 'string' || !value.trim()) return
    if (this.conversationId && this.conversationId !== value)
      throw new Error('CLI conversation_id changed during a run')
    this.identify(value)
    this.conversationId = value
  }
  private line(line: string): void {
    if (Buffer.byteLength(line) > this.maxLineBytes) throw new Error('CLI event exceeds maxLineBytes')
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw new Error('Invalid Antigravity stream-json event')
    }
    if (!record(value) || typeof value.event !== 'string')
      throw new Error('Missing Antigravity event discriminator')
    if (this.result) throw new Error('Unexpected event after CLI result')
    this.id(value.conversation_id)
    if (
      (value.error !== undefined && value.error !== null && value.error !== '' && value.error !== false) ||
      value.is_error === true
    )
      this.unclassifiedOrFailed = true
    if (value.event === 'init') {
      this.emit({
        kind: 'status',
        text: 'CLI 已连接',
        detail: JSON.stringify(value.init ?? {}),
        observedModel:
          record(value.init) && typeof value.init.model === 'string' ? value.init.model : undefined,
      })
    } else if (value.event === 'step_update') {
      const step = value.step_update
      if (!record(step)) throw new Error('Invalid step_update payload')
      this.id(step.conversation_id)
      const number = typeof step.step_index === 'number' ? step.step_index : undefined
      const state = typeof step.state === 'string' ? step.state : undefined
      const knownType = step.step_type === 'agent_response' || step.step_type === 'tool'
      if (!knownType || number === undefined || !Number.isSafeInteger(number) || number < 0) {
        this.unclassifiedOrFailed = true
      } else {
        const previous = this.steps.get(number)
        if (previous && previous.type !== step.step_type) this.unclassifiedOrFailed = true
        this.steps.set(number, { type: String(step.step_type), state: state ?? previous?.state })
      }
      if (
        (state && !['PENDING', 'QUEUED', 'ACTIVE', 'RUNNING', 'IN_PROGRESS', 'DONE'].includes(state)) ||
        (step.state !== undefined && typeof step.state !== 'string') ||
        (step.text_delta !== undefined && typeof step.text_delta !== 'string') ||
        (step.error !== undefined && step.error !== null && step.error !== '' && step.error !== false) ||
        step.is_error === true
      )
        this.unclassifiedOrFailed = true
      if (step.step_type === 'agent_response') {
        const text = typeof step.text_delta === 'string' ? step.text_delta : ''
        const usage = state === 'DONE' ? agyResponseUsage(step.usage) : undefined
        this.responses.set(number, (this.responses.get(number) ?? '') + text)
        this.emit({
          kind: 'assistant',
          step: number,
          state,
          text,
          ...(number !== undefined && Number.isSafeInteger(number) && number >= 0 ? { response: {
            id: `agy:${number}`, blockId: 'text', index: 0,
            ...(state === 'DONE' ? { complete: true as const } : {}), ...(usage ? { usage } : {}),
          } } : {}),
        })
      } else if (step.step_type === 'tool') {
        this.emit({
          kind: 'tool',
          step: number,
          state,
          text: String(step.tool_name ?? '工具'),
          detail: JSON.stringify(step.tool_info ?? {}, null, 2),
        })
      }
    } else if (value.event === 'result') {
      const result = value.result
      if (
        !record(result) ||
        typeof result.conversation_id !== 'string' ||
        !result.conversation_id.trim() ||
        typeof result.status !== 'string' ||
        typeof result.response !== 'string'
      )
        throw new Error('Invalid CLI result payload')
      this.id(result.conversation_id)
      this.result = {
        conversationId: result.conversation_id,
        status: result.status,
        response: result.response,
        error: typeof result.error === 'string' ? result.error : undefined,
        currentTurnResponse: this.currentTurnResponse || undefined,
        completedStepResponse:
          !this.unclassifiedOrFailed &&
          this.steps.size > 0 &&
          [...this.steps.values()].every((step) => step.state === 'DONE') &&
          [...this.responses].some(
            ([index, text]) => index !== undefined && this.steps.get(index)?.state === 'DONE' && text.trim(),
          ) &&
          (result.error === undefined || typeof result.error === 'string')
            ? this.currentTurnResponse
            : undefined,
      }
      // ERROR may aggregate older conversation text. Keep it as evidence, never
      // present it as a response observed in the current process.
      if (result.status !== 'SUCCESS')
        this.emit({
          kind: 'diagnostic',
          text: 'CLI 最终汇总',
          state: result.status,
          detail: JSON.stringify(result, null, 2),
        })
      else this.emit({ kind: 'result', text: result.response, state: result.status })
    } else {
      this.unclassifiedOrFailed = true
      this.emit({ kind: 'diagnostic', text: `未识别事件：${value.event}`, detail: line })
    }
  }
}
