const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
const count = (value) => Number.isSafeInteger(value) && value >= 0

/** Anthropic input/cache buckets are disjoint; missing cache categories stay unknown. */
export function claudeResponseUsage(value) {
  if (!object(value) || !count(value.input_tokens) || !count(value.output_tokens)) return
  const usage = { inputTokens: value.input_tokens, outputTokens: value.output_tokens }
  for (const [source, target] of [['cache_read_input_tokens', 'cacheReadTokens'], ['cache_creation_input_tokens', 'cacheWriteTokens']]) {
    if (value[source] === undefined) continue
    if (!count(value[source])) return
    usage[target] = value[source]
  }
  // Claude 2.1.287 publishes this optional numeric subset in message_delta.
  // Thinking is already included in output; it must never inflate the total.
  const thinking = object(value.output_tokens_details) ? value.output_tokens_details.thinking_tokens : undefined
  if (count(thinking) && thinking <= usage.outputTokens) usage.reasoningTokens = thinking
  if (usage.cacheReadTokens !== undefined && usage.cacheWriteTokens !== undefined) {
    const total = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
    if (!count(total)) return
    usage.totalTokens = total
  }
  return usage
}

/** Only message_start + message_delta + message_stop establish final response usage.
 * A result envelope is run-scoped and is never consumed by this tracker.
 */
export class ClaudeResponseTracker {
  constructor(emit) { this.output = emit }
  start(id, usage) {
    this.finish()
    this.id = typeof id === 'string' && id.length > 0 && id.length <= 500 ? id : undefined
    this.tokens = object(usage) ? { ...usage } : {}
    this.hasDelta = false
    this.invalidUsage = false
    this.last = undefined
  }
  delta(usage) {
    if (!this.id || !object(usage)) return
    if (!count(usage.output_tokens) || (this.hasDelta && usage.output_tokens < this.tokens.output_tokens)) {
      this.invalidUsage = true
      return
    }
    // Every delta is a cumulative snapshot. Never add consecutive counters.
    Object.assign(this.tokens, usage)
    this.hasDelta = true
  }
  emit(event, id, index) {
    if (!this.id || this.id !== id || !Number.isSafeInteger(index) || index < 0 || index > 4096) {
      this.output(event)
      return
    }
    const response = { id: `claude:${id}`, blockId: `block:${index}`, index }
    this.last = { ...event, response }
    this.output(this.last)
    return response
  }
  finish(final = false) {
    if (this.last) {
      const usage = final && this.hasDelta && !this.invalidUsage ? claudeResponseUsage(this.tokens) : undefined
      this.output({ ...this.last, delta: undefined,
        ...(this.last.toolCall ? { toolCall: { ...this.last.toolCall, output: undefined } } : {}), ...(this.last.kind === 'assistant' ? { text: '' } : {}),
        response: { ...this.last.response, complete: true, ...(usage ? { usage } : {}) } })
    }
    this.id = undefined
    this.last = undefined
  }
}
