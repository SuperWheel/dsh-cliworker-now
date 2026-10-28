const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const count = (value) => Number.isSafeInteger(value) && value >= 0

/** MiMo's installed Session.getUsage and OpenCode 1.19.0 split reasoning out of output. */
export function sessionHttpResponseUsage(tokens) {
  if (!object(tokens) || !object(tokens.cache)) return
  const { input, output, reasoning, cache } = tokens
  if (![input, output, reasoning, cache.read, cache.write].every(count)) return
  const outputTokens = output + reasoning
  const totalTokens = input + outputTokens + cache.read + cache.write
  if (!count(outputTokens) || !count(totalTokens) ||
    (tokens.total !== undefined && tokens.total !== totalTokens)) return
  return { inputTokens: input, outputTokens, reasoningTokens: reasoning,
    cacheReadTokens: cache.read, cacheWriteTokens: cache.write, totalTokens }
}

/** Session snapshots retain HTTP's reasoning-exclusive output convention. */
export function sessionHttpSessionUsage(tokens) {
  const usage = sessionHttpResponseUsage(tokens)
  if (!usage) return
  return { input: tokens.input, output: tokens.output, reasoning: tokens.reasoning,
    cacheRead: tokens.cache.read, cacheWrite: tokens.cache.write, total: usage.totalTokens }
}

/** Pi and OMP expose disjoint input/cache buckets; reasoning is already included in output. */
export function piOmpReportedUsage(value, cli) {
  if (!['pi', 'omp'].includes(cli)) return
  if (!object(value) || ![value.input, value.output, value.cacheRead, value.cacheWrite, value.totalTokens].every(count)) return
  const total = value.input + value.output + value.cacheRead + value.cacheWrite
  if (!count(total) || value.totalTokens < total || (cli === 'pi' && value.totalTokens !== total)) return
  const reasoning = cli === 'pi' ? value.reasoning : value.reasoningTokens
  if (reasoning !== undefined && (!count(reasoning) || reasoning > value.output)) return
  let orchestration
  if (cli === 'omp' && value.orchestration !== undefined) {
    if (!object(value.orchestration)) return
    orchestration = {}
    for (const key of ['input', 'output', 'cacheRead']) {
      if (value.orchestration[key] === undefined) continue
      if (!count(value.orchestration[key])) return
      orchestration[key] = value.orchestration[key]
    }
    if (!Object.keys(orchestration).length) orchestration = undefined
  }
  return { input: value.input, output: value.output, cacheRead: value.cacheRead,
    cacheWrite: value.cacheWrite, total: value.totalTokens,
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(orchestration ? { orchestration } : {}) }
}
export function piOmpResponseUsage(value, cli) {
  const reported = piOmpReportedUsage(value, cli)
  if (!reported || reported.total !== reported.input + reported.output + reported.cacheRead + reported.cacheWrite ||
    Object.values(reported.orchestration ?? {}).some(value => value > 0)) return
  // OMP orchestration has no native response bucket. Omitting only total would
  // let DSH synthesize a smaller total, so the entire response usage stays unknown.
  return { inputTokens: reported.input, outputTokens: reported.output,
    cacheReadTokens: reported.cacheRead, cacheWriteTokens: reported.cacheWrite,
    totalTokens: reported.total,
    ...(reported.reasoning !== undefined ? { reasoningTokens: reported.reasoning } : {}) }
}

/** Blocks are grouped by a real protocol response, never by display segmentation. */
export class NativeBlockResponses {
  constructor(cli, emit) { this.cli = cli; this.output = emit; this.responses = new Map() }
  event(id, blockId, event, nativeIndex) {
    let response = this.responses.get(id)
    if (!response) { response = { blocks: new Map() }; this.responses.set(id, response) }
    if (response.complete) {
      // Executed tools can finish after their declaring model response settled.
      if (event.kind !== 'tool') throw new Error('Native response content arrived after completion')
      const block = response.blocks.get(blockId)
      if (!block || block.kind !== 'tool') throw new Error('Unknown late native response tool')
      this.output({ ...event, response: block.response })
      return block.response
    }
    let block = response.blocks.get(blockId)
    if (!block) {
      const index = Number.isSafeInteger(nativeIndex) && nativeIndex >= 0 ? nativeIndex : response.blocks.size
      if (index > 4096 || [...response.blocks.values()].some((entry) => entry.response.index === index))
        throw new Error('Native response block index conflict')
      block = { kind: event.kind, response: { id: `${this.cli}:${id}`, blockId, index } }
      response.blocks.set(blockId, block)
    }
    if (block.kind !== event.kind) throw new Error('Native response block type changed')
    response.last = { ...event, response: block.response }
    if (event.kind !== 'tool') response.lastText = response.last
    this.output(response.last)
    return block.response
  }
  finish(id, usage) {
    const response = this.responses.get(id)
    if (!response || response.complete) return
    response.complete = true
    if (!response.last) return
    const event = response.lastText ?? response.last
    this.output({ ...event, delta: undefined,
      ...(event.toolCall ? { toolCall: { ...event.toolCall, output: undefined } } : {}), ...(event.kind === 'assistant' ? { text: '' } : {}),
      response: { ...event.response, complete: true, ...(usage ? { usage } : {}) } })
  }
  completed(id) { return this.responses.get(id)?.complete === true }
}
