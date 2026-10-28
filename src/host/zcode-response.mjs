const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
const count = (value) => Number.isSafeInteger(value) && value >= 0

/** Complete tool-call inputs published before input-omitting tool updates. */
export class ZcodeToolInputs {
  records = new Map()
  remember(payload) {
    if (!object(payload) || !object(payload.input) ||
      typeof payload.toolCallId !== 'string' || !payload.toolCallId || payload.toolCallId.length > 500 ||
      typeof payload.assistantMessageId !== 'string' || !payload.assistantMessageId || payload.assistantMessageId.length > 500) return
    const previous = this.records.get(payload.toolCallId)
    if (previous && previous.assistantMessageId !== payload.assistantMessageId) {
      this.records.set(payload.toolCallId, { conflicted: true })
      return
    }
    if (previous?.conflicted || (!previous && this.records.size >= 4096)) return
    this.records.set(payload.toolCallId, { assistantMessageId: payload.assistantMessageId, input: payload.input })
  }
  read(toolCallId, assistantMessageId) {
    const entry = this.records.get(toolCallId)
    return entry && !entry.conflicted && entry.assistantMessageId === assistantMessageId ? entry.input : undefined
  }
}

/** ZCode normalizeUsage preserves SDK input totals: both cache buckets are subsets. */
export function zcodeResponseUsage(value) {
  if (!object(value) || !count(value.inputTokens) || !count(value.outputTokens)) return
  const usage = { inputTokens: value.inputTokens, outputTokens: value.outputTokens }
  for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
    if (value[key] === undefined) continue
    if (!count(value[key])) return
    usage[key] = value[key]
  }
  if (usage.reasoningTokens !== undefined && usage.reasoningTokens > usage.outputTokens) return
  const total = value.inputTokens + value.outputTokens
  if (!count(total) || (value.totalTokens !== undefined && value.totalTokens !== total)) return
  // A missing cache bucket is unknown; do not invent an uncached input count.
  if (usage.cacheReadTokens === undefined || usage.cacheWriteTokens === undefined) return
  usage.inputTokens -= usage.cacheReadTokens + usage.cacheWriteTokens
  if (!count(usage.inputTokens)) return
  usage.totalTokens = total
  return usage
}

/** ModelComplete is an ordered native event; a turn/run total cannot close a response. */
export class ZcodeResponseTracker {
  constructor(emit) { this.output = emit }
  held = []
  emit(event, assistantMessageId, blockId, index) {
    if (typeof assistantMessageId !== 'string' || !assistantMessageId || assistantMessageId.length > 480) {
      this.output(event)
      return
    }
    if (this.id && this.id !== assistantMessageId) this.finish()
    this.id = assistantMessageId
    const response = { id: `zcode:${assistantMessageId}`, blockId, index }
    this.last = { ...event, response }
    this.output(this.last)
  }
  /** ZCode may schedule a tool before its message's model_complete; a passive
   * tool row must not precede that response's completion boundary. */
  tool(event) {
    if (this.last) this.held.push(event)
    else this.output(event)
  }
  complete(payload) {
    // mapSessionEventPayload passes the model_complete payload through, without a type tag.
    if (!object(payload) || payload.querySource !== 'main_turn' ||
      typeof payload.content !== 'string' || !count(payload.toolCallCount) ||
      typeof payload.stopReason !== 'string') return false
    this.finish(zcodeResponseUsage(payload.usage))
    return true
  }
  finish(usage) {
    if (this.last) this.output({ ...this.last, delta: undefined,
      ...(this.last.toolCall ? { toolCall: { ...this.last.toolCall, output: undefined } } : {}),
      ...(this.last.kind === 'assistant' ? { text: '' } : {}),
      response: { ...this.last.response, complete: true, ...(usage ? { usage } : {}) } })
    this.id = undefined
    this.last = undefined
    for (const event of this.held.splice(0)) this.output(event)
  }
}
