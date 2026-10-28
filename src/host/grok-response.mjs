const count = (value) => Number.isSafeInteger(value) && value >= 0
const object = (value) => value && typeof value === 'object' && !Array.isArray(value)

/** Official x.ai/statusLine is a session-scoped native estimate, not a bill. */
export function grokContextStatus(message, expected) {
  const params = message?.params, value = params?.update
  if (message?.method !== '_x.ai/session_notification' || !object(expected) ||
    !expected.sessionId || !expected.modelId || !expected.project ||
    params?.sessionId !== expected.sessionId || params?._meta?.isReplay === true ||
    value?.sessionUpdate !== 'session_status' || value.session_id !== expected.sessionId ||
    !count(value.schema_version) || value.schema_version < 1 ||
    value.cwd !== expected.project || value.workspace?.current_dir !== expected.project ||
    value.model?.id !== expected.modelId || !object(value.context_window)) return
  const context = value.context_window
  if (context.context_tokens != null && !count(context.context_tokens)) return
  if (context.context_window_size != null && (!count(context.context_window_size) || context.context_window_size === 0)) return
  return { type: 'cliworker.grok_context', source: 'grok.session_status',
    sessionId: expected.sessionId, modelId: expected.modelId,
    contextUsed: context.context_tokens ?? null,
    ...(context.context_window_size == null ? {} : { contextCapacity: context.context_window_size }),
    basis: 'native-estimate' }
}

/** Capacity is model metadata, never a billed token total or a model-name default. */
export function grokModelContext(state, modelId) {
  if (!object(state) || typeof modelId !== 'string' || !modelId) return
  const candidates = [state.models, state._meta?.modelState].filter(object)
  if (candidates.length !== 1) return
  const models = candidates[0]
  if (models.currentModelId !== modelId || !Array.isArray(models.availableModels)) return
  const matches = models.availableModels.filter((model) => object(model) && model.modelId === modelId)
  if (matches.length !== 1 || !object(matches[0]._meta)) return
  const meta = matches[0]._meta
  // The official current selection is valid only if it equals the default or is advertised.
  // A present but malformed/unsupported selection is unknown rather than a silent fallback.
  const capacity = meta.totalContextTokens
  if (Object.hasOwn(meta, 'contextWindow')) {
    const selected = meta.contextWindow
    if (!count(selected) || selected === 0 ||
      (selected !== capacity && (!Array.isArray(meta.contextWindows) || !meta.contextWindows.includes(selected)))) return
    return selected
  }
  return count(capacity) && capacity > 0 ? capacity : undefined
}

/** PromptUsageModel is camelCase and its input includes cache reads and writes. */
export function grokPromptUsage(value) {
  if (!object(value) || (value.usageIsIncomplete !== undefined && typeof value.usageIsIncomplete !== 'boolean')) return
  const usage = {}
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cachedReadTokens', 'cacheCreationTokens', 'reasoningTokens']) {
    if (!count(value[key])) return
    usage[key] = value[key]
  }
  if (!count(usage.inputTokens + usage.outputTokens) || usage.totalTokens !== usage.inputTokens + usage.outputTokens ||
    usage.cachedReadTokens + usage.cacheCreationTokens > usage.inputTokens || usage.reasoningTokens > usage.outputTokens) return
  return { usage, usageIsIncomplete: value.usageIsIncomplete === true }
}

/** Installed Grok headless docs: uncached input, separate cache, reasoning within output. */
export function grokResponseUsage(value) {
  if (!object(value) || !count(value.input_tokens) || !count(value.output_tokens)) return
  const usage = { inputTokens: value.input_tokens, outputTokens: value.output_tokens }
  for (const [from, to] of [['cache_read_input_tokens', 'cacheReadTokens'],
    ['cache_creation_input_tokens', 'cacheWriteTokens'], ['reasoning_tokens', 'reasoningTokens']]) {
    if (value[from] === undefined) continue
    if (!count(value[from])) return
    usage[to] = value[from]
  }
  if (usage.reasoningTokens !== undefined && usage.reasoningTokens > usage.outputTokens) return
  if (usage.cacheReadTokens !== undefined && usage.cacheWriteTokens !== undefined) {
    const total = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
    if (!count(total) || (value.total_tokens !== undefined && value.total_tokens !== total)) return
    usage.totalTokens = total
  }
  return usage
}

/** Local opaque identities count only native `usage` response boundaries.
 * messageId is delivered at the end, so it cannot identify earlier live chunks.
 */
export class GrokResponseTracker {
  sequence = 0
  blocks = new Map()
  tools = new Map()
  constructor(emit, options = {}) {
    this.output = emit
    this.requireStart = options.requireStart === true
    this.enabled = !this.requireStart
  }
  identity() { return this.id ?? `grok:response:${this.sequence}` }
  start(messageId) {
    if (this.last) this.finish()
    this.enabled = true
    this.id = typeof messageId === 'string' && messageId.length > 0 && messageId.length <= 480
      ? `grok:${messageId}` : undefined
  }
  emit(event, key) {
    if (!this.enabled) { this.output(event); return }
    let response = event.kind === 'tool' ? this.tools.get(key) : undefined
    if (!response) {
      if (!this.blocks.has(key)) this.blocks.set(key, this.blocks.size)
      response = { id: this.identity(), blockId: key, index: this.blocks.get(key) }
      if (event.kind === 'tool') this.tools.set(key, response)
    }
    const projected = { ...event, response }
    // Late tool results retain their original response, but cannot become the next usage owner.
    if (response.id === this.identity()) this.last = projected
    this.output(projected)
  }
  finish(usage, complete = true) {
    if (!this.enabled) return
    if (this.last && complete) this.output({ ...this.last, delta: undefined,
      ...(this.last.toolCall ? { toolCall: { ...this.last.toolCall, output: undefined } } : {}),
      ...(this.last.kind === 'assistant' ? { text: '' } : {}),
      response: { ...this.last.response, complete: true, ...(usage ? { usage } : {}) } })
    this.sequence++
    this.id = undefined
    this.blocks.clear()
    this.last = undefined
    if (this.requireStart) this.enabled = false
  }
}
