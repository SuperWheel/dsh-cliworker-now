import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { hermesTokenUsage } from './hermes-adapter.ts'
import { hermesCanonicalUsage } from './hermes-canonical-usage.ts'
import { grokContextStatus, grokPromptUsage, grokResponseUsage } from './grok-response.mjs'
import type { CliId, TimelineItem } from '../shared/types.ts'
import type { Telemetry, TokenUsage } from '../shared/telemetry.ts'

const obj = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {}
const count = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined
const duration = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
function usage(v: unknown, scope: TokenUsage['scope'], cacheSeparate = false): TokenUsage | undefined {
  const u = obj(v),
    input = count(u.input_tokens),
    output = count(u.output_tokens)
  const cacheRead = count(u.cache_read_tokens ?? u.cache_read_input_tokens ?? u.cached_input_tokens)
  const creation = count(u.cache_creation_input_tokens ?? u.cache_write_tokens ?? u.cache_write_input_tokens)
  const reasoning = count(u.reasoning_tokens ?? u.reasoning_output_tokens)
  const total =
    count(u.total_tokens) ??
    (input !== undefined && output !== undefined
      ? input + output + (cacheSeparate ? (cacheRead ?? 0) + (creation ?? 0) : 0)
      : undefined)
  return total === undefined || !Number.isSafeInteger(total)
    ? undefined
    : {
        total,
        input,
        output,
        cacheRead,
        ...(creation !== undefined ? { cacheWrite: creation } : {}),
        ...(reasoning !== undefined ? { reasoning } : {}),
        scope,
      }
}
/** OpenCode/MiMo split cache and reasoning out of their input/output buckets. */
function messageUsage(value: unknown, scope: TokenUsage['scope']): TokenUsage | undefined {
  const tokens = obj(value),
    cache = obj(tokens.cache)
  const input = count(tokens.input),
    output = count(tokens.output),
    cacheRead = count(cache.read)
  const buckets = [input, output, count(tokens.reasoning), cacheRead, count(cache.write)]
  const total =
    tokens.total !== undefined
      ? count(tokens.total)
      : buckets.every((value) => value !== undefined)
        ? buckets.reduce<number>((sum, value) => sum + value!, 0)
        : undefined
  return total === undefined || !Number.isSafeInteger(total)
    ? undefined
    : {
        total,
        input,
        output,
        cacheRead,
        ...(count(cache.write) !== undefined ? { cacheWrite: count(cache.write) } : {}),
        ...(count(tokens.reasoning) !== undefined ? { reasoning: count(tokens.reasoning) } : {}),
        scope,
      }
}
function sumUsage(values: Iterable<TokenUsage>): TokenUsage | undefined {
  const entries = [...values]
  if (!entries.length) return undefined
  const total = entries.reduce((sum, value) => sum + value.total, 0)
  if (!Number.isSafeInteger(total)) return undefined
  const result: TokenUsage = { total, scope: 'run' }
  for (const field of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'] as const) {
    if (entries.every((value) => value[field] !== undefined)) {
      const sum = entries.reduce((sum, value) => sum + value[field]!, 0)
      if (Number.isSafeInteger(sum)) result[field] = sum
    }
  }
  if (entries.some((value) => value.orchestration)) {
    result.orchestration = {}
    for (const field of ['input', 'output', 'cacheRead'] as const) {
      if (!entries.some((value) => value.orchestration?.[field] !== undefined)) continue
      const sum = entries.reduce((total, value) => total + (value.orchestration?.[field] ?? 0), 0)
      if (!Number.isSafeInteger(sum)) return undefined
      result.orchestration[field] = sum
    }
  }
  return result
}
// Invalid present counts remain invalid, without retaining arbitrary source text.
function metricCounts(value: unknown, fields: readonly string[]): Record<string, number | null> {
  const source = obj(value),
    result: Record<string, number | null> = {}
  for (const field of fields) if (Object.hasOwn(source, field)) result[field] = count(source[field]) ?? null
  return result
}
function messageTokens(value: unknown) {
  const source = obj(value)
  return {
    ...metricCounts(source, ['total', 'input', 'output', 'reasoning']),
    cache: metricCounts(source.cache, ['read', 'write']),
  }
}
const hermesUsageFields = [
  'total_tokens',
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'cache_write_input_tokens',
] as const
export interface RunTelemetry extends Telemetry {
  /** A legacy derived counter did not establish settlement for this run. */
  unsettledRunUsage?: true
  replies: Record<string, TokenUsage>
  replyDurations?: Record<string, number>
  finalReply?: TokenUsage
  /** An authoritative receipt covering this invocation, never a session snapshot. */
  runUsage?: TokenUsage
}
export interface TelemetryIdentity {
  conversationId?: string
  /** Actual confirmed provider/model, when available; never a guessed alias translation. */
  model?: string
  project?: string
}
const textId = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 && v.length <= 1024 ? v : undefined
/** Hermes catalogue IDs are the exact JSON [provider, model] selection, not an alias. */
function hermesModelMatches(selected: string | undefined, model: unknown, provider: unknown): boolean {
  if (!textId(model)) return false
  if (!selected || selected === model) return true
  try {
    const pair: unknown = JSON.parse(selected)
    return Array.isArray(pair) && pair.length === 2 && pair[0] === provider && pair[1] === model
  } catch { return false }
}
function camelUsage(value: unknown, scope: TokenUsage['scope']): TokenUsage | undefined {
  const v = obj(value)
  return usage(
    {
      total_tokens: v.totalTokens,
      input_tokens: v.inputTokens,
      output_tokens: v.outputTokens,
      cached_input_tokens: v.cachedInputTokens,
      cache_write_tokens: v.cacheWriteInputTokens,
      reasoning_output_tokens: v.reasoningOutputTokens,
    },
    scope,
  )
}
function zcodeUsage(value: unknown, scope: TokenUsage['scope']): TokenUsage | undefined {
  const v = obj(value)
  return usage(
    {
      total_tokens: v.totalTokens,
      input_tokens: v.inputTokens,
      output_tokens: v.outputTokens,
      cache_read_tokens: v.cacheReadTokens,
      cache_write_tokens: v.cacheWriteTokens,
      reasoning_tokens: v.reasoningTokens,
    },
    scope,
  )
}
function contextInput(cli: 'mimo' | 'opencode', value: unknown): number | undefined {
  const v = obj(value),
    cache = obj(v.cache)
  // The installed native ACP implementations differ: MiMo counts input +
  // cache.read; OpenCode 1.19.0 also counts cache.write. Do not share a guessed formula.
  const counts = [count(v.input), count(cache.read), ...(cli === 'opencode' ? [count(cache.write)] : [])]
  if (counts.some((n) => n === undefined)) return
  const total = counts.reduce<number>((sum, n) => sum + n!, 0)
  return Number.isSafeInteger(total) ? total : undefined
}
function contextSnapshot(
  result: RunTelemetry,
  used: unknown,
  capacity: unknown,
  source: string,
  estimated: boolean,
) {
  // A new explicit snapshot can make occupancy unknown (notably post-compaction).
  result.contextUsed = count(used)
  result.contextSource = source
  result.contextEstimated = estimated
  const limit = count(capacity)
  if (limit !== undefined && limit > 0) {
    result.contextCapacity = limit
    result.contextCapacitySource = source
  }
  delete result.contextBreakdown
}
function orchestrationMetrics(value: unknown) {
  return obj(value).orchestration ? { orchestration: metricCounts(obj(value).orchestration, ['input', 'output', 'cacheRead']) } : {}
}
const snakeFields = [
  'total_tokens',
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'cache_write_input_tokens',
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
  'cached_input_tokens',
  'reasoning_tokens',
  'reasoning_output_tokens',
] as const
const camelFields = [
  'totalTokens',
  'inputTokens',
  'outputTokens',
  'cachedInputTokens',
  'cacheWriteInputTokens',
  'reasoningOutputTokens',
] as const
/** Validate the existing public counter convention without supplying missing buckets. */
function completeUsage(value: TokenUsage | undefined, convention: 'inclusive' | 'separate' | 'reasoning-separate'): TokenUsage | undefined {
  if (!value || count(value.total) === undefined || count(value.input) === undefined || count(value.output) === undefined)
    return
  for (const field of ['cacheRead', 'cacheWrite', 'reasoning'] as const)
    if (value[field] !== undefined && count(value[field]) === undefined) return
  const input = value.input!, output = value.output!,
    cache = (value.cacheRead ?? 0) + (value.cacheWrite ?? 0)
  if (convention === 'inclusive') {
    if (cache > input || (value.reasoning ?? 0) > output || value.total !== input + output) return
  } else {
    if (convention === 'separate' && (value.reasoning ?? 0) > output) return
    const extra = value.orchestration
    if (extra && Object.values(extra).some((v) => count(v) === undefined)) return
    const known = input + output + cache + Object.values(value.orchestration ?? {}).reduce((sum, v) => sum + v, 0) + (convention === 'reasoning-separate' ? value.reasoning ?? 0 : 0)
    if (!Number.isSafeInteger(known) || value.total < known ||
      (value.cacheRead !== undefined && value.cacheWrite !== undefined &&
        (convention !== 'reasoning-separate' || value.reasoning !== undefined) && value.total !== known)) return
  }
  return { ...value, scope: 'run' }
}
const hasInvalidMetrics = (value: unknown, fields: readonly string[]) => fields.some((field) =>
  Object.hasOwn(obj(value), field) && count(obj(value)[field]) === undefined)
function metricConversationIdentity(v: Record<string, any>) {
  // Preserve an invalid *present* identity as invalid; dropping it would turn a
  // rejected cross-session receipt into an apparently unscoped historical one.
  return Object.hasOwn(v, 'conversation_id')
    ? { conversation_id: textId(v.conversation_id)?.trim() ? v.conversation_id : null }
    : {}
}
/** Whitelist before caching: no prompt, tool payload, signatures or account material. */
function metricRecords(v: Record<string, any>): unknown[] {
  const entries: unknown[] = []
  if (['turn.completed', 'session.updated'].includes(v.type) && Object.hasOwn(v, 'sessionId') && v.payload)
    return metricRecords({ method: 'session/event', params: { sessionId: v.sessionId, type: v.type, payload: v.payload } })
  if (v.type === 'session' && textId(v.id)) entries.push({ type: v.type, id: v.id, model: textId(v.model) })
  else if (v.type === 'cliworker.codex_run_usage') entries.push({
    type: v.type, sessionId: textId(v.sessionId) ?? null, turnId: textId(v.turnId),
    usage: metricCounts(v.usage, camelFields),
  })
  else if (v.type === 'cliworker.kimi_usage' || v.type === 'cliworker.kimi_response_usage') entries.push({
    type: v.type, source: textId(v.source), sessionId: textId(v.sessionId) ?? null,
    model: textId(v.model), turnId: textId(v.turnId), stepId: textId(v.stepId), responseId: textId(v.responseId),
    scope: v.scope === 'run' || v.scope === 'reported' ? v.scope : undefined,
    usage: metricCounts(v.usage, ['inputOther', 'output', 'inputCacheRead', 'inputCacheCreation']),
  })
  else if (v.type === 'cliworker.hermes_observation' || v.type === 'cliworker.hermes_observer_summary') entries.push({
    type: v.type, source: textId(v.source), nativeRunId: textId(v.nativeRunId), sessionId: textId(v.sessionId) ?? null,
    model: textId(v.model), provider: textId(v.provider), turnId: textId(v.turnId), requestId: textId(v.requestId),
    usageBasis: v.usageBasis === 'cli-normalized' ? v.usageBasis : undefined,
    ...metricCounts(v, ['requestCount', 'responseCount', 'errorCount']),
    coverageComplete: v.coverageComplete === true, usageComplete: v.usageComplete === true,
    usage: metricCounts(v.usage, ['input', 'output', 'total', 'cacheRead', 'cacheWrite', 'reasoning']),
    ...(v.context ? { context: { ...metricCounts(v.context, ['used', 'capacity']),
      basis: obj(v.context).basis === 'provider-prompt' ? 'provider-prompt' : undefined,
      ...(obj(v.context).breakdown ? { breakdown: {
        ...metricCounts(obj(v.context).breakdown, ['systemTokens', 'toolTokens', 'messageTokens']),
        estimated: obj(obj(v.context).breakdown).estimated === true,
        basis: obj(obj(v.context).breakdown).basis === 'hermes-native-request-estimate' ? 'hermes-native-request-estimate' : undefined,
      } } : {}),
    } } : {}),
  })
  else if (v.type === 'cliworker.session_usage') entries.push({
    type: v.type, cli: v.cli, source: textId(v.source), sessionId: textId(v.sessionId) ?? null,
    usage: metricCounts(v.usage, ['total', 'input', 'output', 'cacheRead', 'cacheWrite', 'reasoning']),
  })
  else if (v.type === 'thread.started') entries.push({ type: v.type, thread_id: textId(v.thread_id) ?? null })
  else if (['cliworker.qoder_prompt_usage', 'cliworker.qodercn_prompt_usage'].includes(v.type)) entries.push({
    type: v.type, sessionId: textId(v.sessionId) ?? null, model: textId(v.model),
    usage: metricCounts(v.usage, ['inputTokens', 'outputTokens', 'totalTokens']),
  })
  else if (['cliworker.qoder_context', 'cliworker.qodercn_context'].includes(v.type)) entries.push({
    type: v.type, source: v.source === (v.type === 'cliworker.qodercn_context' ? 'qodercn.native-transcript' : 'qoder.native-transcript') ? v.source : undefined,
    basis: v.basis === 'native-ratio' ? v.basis : undefined, sessionId: textId(v.sessionId) ?? null,
    model: textId(v.model), userMessageId: textId(v.userMessageId),
    contextRatio: typeof v.contextRatio === 'number' && Number.isFinite(v.contextRatio) && v.contextRatio >= 0 && v.contextRatio <= 1
      ? v.contextRatio : null,
    providerCredits: duration(v.providerCredits) ?? null,
    contextCapacity: count(v.contextCapacity) ?? null, contextUsed: count(v.contextUsed) ?? null,
    contextCapacitySource: ['qoder.native-runtime-config', 'qoder.native-session-log', 'qodercn.native-runtime-config', 'qodercn.native-session-log'].includes(v.contextCapacitySource)
      ? v.contextCapacitySource : undefined,
  })
  else if (v.type === 'cliworker.agy_prompt_usage') entries.push({
    type: v.type, sessionId: textId(v.sessionId), model: textId(v.model),
    usage: metricCounts(v.usage, ['inputTokens', 'outputTokens', 'totalTokens', 'cachedReadTokens', 'cachedWriteTokens', 'thoughtTokens']),
  })
  else if (v.type === 'cliworker.grok_prompt_usage') entries.push({
    type: v.type, sessionId: textId(v.sessionId) ?? null,
    usageIsIncomplete: v.usageIsIncomplete === true || (v.usageIsIncomplete !== undefined && v.usageIsIncomplete !== false),
    usage: metricCounts(v.usage, ['inputTokens', 'outputTokens', 'totalTokens', 'cachedReadTokens', 'cacheCreationTokens', 'reasoningTokens']),
  })
  else if (v.type === 'cliworker.rpc_response') entries.push({
    type: v.type, cli: v.cli === 'pi' || v.cli === 'omp' ? v.cli : undefined,
    source: textId(v.source), sessionId: textId(v.sessionId) ?? null, responseId: textId(v.responseId),
    usage: { ...metricCounts(v.usage, ['total', 'input', 'output', 'cacheRead', 'cacheWrite', 'reasoning']), ...orchestrationMetrics(v.usage) },
  })
  else if (v.type === 'system' && v.subtype === 'init')
    entries.push({ type: v.type, subtype: v.subtype, session_id: textId(v.session_id) ?? null })
  else if (v.type === 'cliworker.zcode_context_observation')
    entries.push({ type: v.type, cli: v.cli, source: textId(v.source), sessionId: textId(v.sessionId),
      model: textId(v.model), turnId: textId(v.turnId), requestId: textId(v.requestId), traceId: textId(v.traceId),
      breakdown: v.breakdown === null ? null : { ...metricCounts(v.breakdown, ['systemTokens', 'toolTokens', 'messageTokens']),
        estimated: obj(v.breakdown).estimated === true, basis: textId(obj(v.breakdown).basis) } })
  else if (v.type === 'cliworker.grok_context')
    entries.push({ type: v.type, source: textId(v.source), sessionId: textId(v.sessionId), modelId: textId(v.modelId),
      promptId: textId(v.promptId), basis: v.basis === 'native-estimate' ? 'native-estimate' : undefined, contextUsed: count(v.contextUsed) ?? null,
      ...metricCounts(v, ['contextCapacity']) })
  else if (v.method === '_x.ai/session_notification') {
    const p = obj(v.params), u = obj(p.update)
    if (!grokContextStatus(v, { sessionId: p.sessionId, modelId: obj(u.model).id, project: u.cwd })) return entries
    entries.push({ method: v.method, params: { sessionId: textId(p.sessionId), _meta: { isReplay: obj(p._meta).isReplay },
      update: { sessionUpdate: u.sessionUpdate, session_id: textId(u.session_id), schema_version: u.schema_version,
        cwd: textId(u.cwd), workspace: { current_dir: textId(obj(u.workspace).current_dir) },
        model: { id: textId(obj(u.model).id) }, context_window: {
          context_tokens: obj(u.context_window).context_tokens, context_window_size: obj(u.context_window).context_window_size } } } })
  }
  else if (v.type === 'cliworker.grok_model_context')
    entries.push({ type: v.type, sessionId: textId(v.sessionId), modelId: textId(v.modelId),
      contextCapacity: count(v.contextCapacity) ?? null })
  else if (v.type === 'cliworker.model_context')
    entries.push({
      type: v.type,
      source: textId(v.source),
      providerID: textId(v.providerID),
      modelID: textId(v.modelID),
      contextCapacity: count(v.contextCapacity) ?? null,
    })
  else if (v.type === 'cliworker.rpc_usage')
    entries.push({
      type: v.type,
      cli: v.cli === 'pi' || v.cli === 'omp' ? v.cli : undefined,
      source: textId(v.source),
      sessionId: textId(v.sessionId),
      usage: { ...metricCounts(v.usage, ['total', 'input', 'output', 'cacheRead', 'cacheWrite', 'reasoning']), ...orchestrationMetrics(v.usage) },
      ...(v.contextUsage ? { contextUsage: metricCounts(v.contextUsage, ['tokens', 'contextWindow']) } : {}),
    })
  else if (v.type === 'cliworker.http_context_observation')
    entries.push({ type: v.type, cli: v.cli === 'mimo' || v.cli === 'opencode' ? v.cli : undefined,
      source: textId(v.source), sessionId: textId(v.sessionId), model: textId(v.model),
      requestMessageId: textId(v.requestMessageId), requestId: textId(v.requestId),
      breakdown: v.breakdown === null ? null : { ...metricCounts(v.breakdown, ['systemTokens', 'toolTokens', 'messageTokens']),
        estimated: obj(v.breakdown).estimated === true,
        basis: obj(v.breakdown).basis === 'native-chars-per-token-4' ? 'native-chars-per-token-4' : undefined },
    })
  else if (v.type === 'cliworker.context_inspection')
    entries.push({
      type: v.type,
      cli: v.cli === 'claude' || v.cli === 'omp' || v.cli === 'pi' ? v.cli : undefined,
      source: textId(v.source),
      sessionId: textId(v.sessionId),
      model: textId(v.model),
      ...(v.cli === 'pi' ? { provider: textId(v.provider), requestId: textId(v.requestId),
        basis: v.basis === 'native-estimate' ? v.basis : undefined } : {}),
      ...metricCounts(v, ['contextUsed', 'contextCapacity']),
      categories: Array.isArray(v.categories)
        ? v.categories.slice(0, 64).map((category) => {
            const item = obj(category)
            return {
              name: textId(item.name)?.slice(0, 80),
              tokens: count(item.tokens) ?? null,
              kind: ['used', 'free', 'buffer', 'deferred'].includes(item.kind) ? item.kind : undefined,
            }
          })
        : [],
    })
  else if (v.method === 'thread/tokenUsage/updated') {
    const params = obj(v.params),
      tokens = obj(params.tokenUsage)
    entries.push({
      method: v.method,
      params: {
        threadId: textId(params.threadId),
        tokenUsage: {
          total: metricCounts(tokens.total, camelFields),
          last: metricCounts(tokens.last, camelFields),
          modelContextWindow: count(tokens.modelContextWindow) ?? null,
        },
      },
    })
  } else if (v.method === 'session/update') {
    const params = obj(v.params)
    entries.push({
      method: v.method,
      params: {
        sessionId: textId(params.sessionId),
        update: {
          sessionUpdate: textId(obj(params.update).sessionUpdate),
          ...metricCounts(params.update, ['used', 'size']),
        },
        _meta: metricCounts(params._meta, ['totalTokens']),
      },
    })
  } else if (v.method === 'session/event') {
    const params = obj(v.params),
      payload = obj(params.payload)
    if (params.type === 'turn.completed' || (params.type === 'session.updated' && payload.usage))
      entries.push({
        method: v.method,
        params: {
          sessionId: textId(params.sessionId),
          type: params.type,
          payload: {
            type: textId(payload.type),
            querySource: textId(payload.querySource),
            providerId: textId(payload.providerId),
            modelId: textId(payload.modelId),
            usage: metricCounts(payload.usage, [
              'totalTokens',
              'inputTokens',
              'outputTokens',
              'cacheReadTokens',
              'cacheWriteTokens',
              'reasoningTokens',
            ]),
          },
        },
      })
  } else if (obj(v.result).projection) {
    const projection = obj(obj(v.result).projection)
    entries.push({
      result: {
        projection: {
          sessionId: textId(projection.sessionId),
          currentTurnId: textId(projection.currentTurnId),
          ...metricCounts(projection, ['contextUsed', 'contextWindow', 'totalTokenCount', 'turnCount']),
        },
      },
    })
  } else if (v.type === 'stream_event') {
    const event = obj(v.event)
    if (['message_start', 'message_delta', 'message_stop'].includes(event.type)) entries.push({
      type: v.type, session_id: textId(v.session_id) ?? null,
      parent_tool_use_id: v.parent_tool_use_id === null || v.parent_tool_use_id === undefined ? null : textId(v.parent_tool_use_id) ?? '[invalid-parent]',
      event: { type: event.type,
        ...(event.type === 'message_start' ? { message: { id: textId(obj(event.message).id), model: textId(obj(event.message).model), usage: metricCounts(obj(event.message).usage, snakeFields) } } : {}),
        ...(event.type === 'message_delta' ? { usage: metricCounts(event.usage, snakeFields) } : {}) },
    })
  } else if (v.type === 'assistant' && obj(v.message).usage)
    entries.push({
      type: v.type,
      session_id: textId(v.session_id),
      ...(Object.hasOwn(v, 'parent_tool_use_id')
        ? {
            parent_tool_use_id:
              v.parent_tool_use_id === null ? null : (textId(v.parent_tool_use_id) ?? '[invalid-parent]'),
          }
        : {}),
      message: {
        id: textId(obj(v.message).id),
        model: textId(obj(v.message).model),
        usage: metricCounts(obj(v.message).usage, snakeFields),
      },
    })
  else if (v.event === 'step_update') {
    const step = obj(v.step_update)
    if (step.usage || step.duration_seconds !== undefined ||
      Object.hasOwn(v, 'conversation_id') || Object.hasOwn(step, 'conversation_id'))
      entries.push({
        event: v.event,
        ...metricConversationIdentity(v),
        step_update: {
          ...metricConversationIdentity(step),
          step_type: step.step_type === 'agent_response' ? step.step_type : undefined,
          step_index: count(step.step_index),
          usage: metricCounts(step.usage, snakeFields),
          duration_seconds: duration(step.duration_seconds),
        },
      })
  } else if (v.event === 'result')
    entries.push({
      event: v.event,
      ...metricConversationIdentity(v),
      result: {
        ...metricConversationIdentity(obj(v.result)),
        usage: metricCounts(obj(v.result).usage, snakeFields),
        duration_seconds: duration(obj(v.result).duration_seconds),
      },
    })
  else if (v.type === 'result' || v.type === 'turn.completed' || v.type === 'end')
    entries.push({
      type: v.type,
      ...(Object.hasOwn(v, 'session_id') ? { session_id: textId(v.session_id) ?? null } : {}),
      ...(Object.hasOwn(v, 'sessionId') ? { sessionId: textId(v.sessionId) ?? null } : {}),
      ...(Object.hasOwn(v, 'thread_id') ? { thread_id: textId(v.thread_id) ?? null } : {}),
      ...(v.type === 'end' ? { usage_is_incomplete: v.usage_is_incomplete !== undefined && v.usage_is_incomplete !== false } : {}),
      usage: metricCounts(v.usage, snakeFields),
      modelUsage: Object.fromEntries(
        Object.entries(obj(v.modelUsage))
          .slice(0, 16)
          .map(([key, model]) => [key.slice(0, 256), metricCounts(model, ['contextWindow'])]),
      ),
      tokens: metricCounts(v.tokens, ['total', 'input', 'output', 'cache_read', 'cache_write']),
    })
  else if (
    v.type === 'hermes.run' ||
    ['run.completed', 'run.failed', 'run.cancelled', 'run.interrupted'].includes(v.event)
  )
    entries.push({
      type: v.type,
      event: v.event,
      run_id: textId(v.run_id),
      ...(Object.hasOwn(v, 'session_id') ? { session_id: textId(v.session_id) ?? null } : {}),
      usage: metricCounts(v.usage, hermesUsageFields),
    })
  else if (v.type === 'message.updated') {
    const info = obj(obj(v.properties).info)
    entries.push({
      type: v.type,
      properties: {
        info: {
          id: textId(info.id),
          sessionID: textId(info.sessionID),
          role: info.role === 'assistant' ? 'assistant' : undefined,
          providerID: textId(info.providerID),
          modelID: textId(info.modelID),
          tokens: messageTokens(info.tokens),
          time: metricCounts(info.time, ['completed']),
          finish: textId(info.finish),
          ...(info.error ? { error: true } : {}),
        },
      },
    })
  } else if (v.type === 'step_finish')
    entries.push({
      type: v.type,
      ...(Object.hasOwn(v, 'sessionID') ? { sessionID: textId(v.sessionID) ?? null } : {}),
      part: {
        id: textId(obj(v.part).id),
        ...(Object.hasOwn(obj(v.part), 'sessionID') ? { sessionID: textId(obj(v.part).sessionID) ?? null } : {}),
        messageID: textId(obj(v.part).messageID),
        tokens: messageTokens(obj(v.part).tokens),
      },
    })
  if (typeof v.event === 'string' && !entries.length && Object.hasOwn(v, 'conversation_id'))
    entries.push({ event: v.event, ...metricConversationIdentity(v) })
  if (v.context_usage)
    entries.push({
      ...metricConversationIdentity(v),
      context_usage: metricCounts(v.context_usage, ['used_tokens', 'max_tokens']),
    })
  return entries
}
/** Only public, observed CLI envelopes; no model-name capacity guesses. */
export function extractTelemetry(
  cli: CliId,
  records: readonly unknown[],
  identity: TelemetryIdentity = {},
): RunTelemetry {
  const result: RunTelemetry = { replies: {} }
  const mimoSteps = new Map<string, TokenUsage>()
  const messages = new Map<string, TokenUsage>()
  const hermesRuns = new Map<string, TokenUsage>()
  const rpcResponses = new Map<string, TokenUsage>()
  const hermesObservations = new Map<string, TokenUsage>()
  const hermesObserverRuns = new Map<string, TokenUsage>()
  const hermesObserverRunIds = new Set<string>()
  const hermesObservationRuns = new Map<string, string>()
  const ownedMessages = new Set<string>(), completedMessages = new Set<string>()
  const invalidMessages = new Set<string>(), observedHermesRuns = new Set<string>()
  let nativeSessionUsage: TokenUsage | undefined
  // Request composition is independent of provider accounting. Keep it across
  // later usage receipts, but never let its estimates replace context pressure.
  let requestBreakdown: RunTelemetry['contextBreakdown']
  let invalidLegacyStep = false
  let claudeStream: { id: string; usage: Record<string, any>; delta: boolean; valid: boolean } | undefined
  const claudeFinalMessages = new Set<string>()
  let zcodeTurnUsage = false
  let grokStatusObserved = false
  const declared = records.map((record) => obj(record)).findLast((record) => record.type === 'session')
  const session = identity.conversationId ?? textId(declared?.id)
  const model = identity.model ?? textId(declared?.model)
  const ownSession = (id: unknown) => !session || id === session
  // Native compatibility turn.completed contains SESSION totals, even if it precedes the native receipt.
  const codexNativeUsage = cli === 'codex' && records.some((record) => {
    const envelope = obj(record), value = envelope.type === 'native' ? obj(envelope.record) : envelope
    return value.method === 'thread/tokenUsage/updated' && textId(obj(value.params).threadId) && ownSession(obj(value.params).threadId)
  })
  let agySession = identity.conversationId
  let agyIdentityRejected = false
  let hermesSession = identity.conversationId
  let hermesIdentityRejected = false
  for (const record of records) {
    const envelope = obj(record)
    const raw = envelope.type === 'native' ? obj(envelope.record) : envelope
    const v: Record<string, any> = cli === 'zcode' && ['turn.completed', 'session.updated'].includes(raw.type) && raw.payload
      ? { method: 'session/event', params: { sessionId: raw.sessionId, type: raw.type, payload: raw.payload } } : raw
    if (cli === 'hermes') {
      if (hermesIdentityRejected) continue
      const ids = [envelope, v].filter((source) => Object.hasOwn(source, 'session_id')).map((source) => source.session_id)
      if (v.type === 'session') ids.push(v.id)
      if (v.type === 'cliworker.hermes_observation' || v.type === 'cliworker.hermes_observer_summary') ids.push(v.sessionId)
      if (v.type === 'result' && identity.conversationId && !textId(v.session_id)) ids.push(null)
      for (const id of ids) {
        if (!textId(id)?.trim() || (hermesSession && id !== hermesSession)) {
          hermesIdentityRejected = true
          break
        }
        hermesSession = id
      }
      if (hermesIdentityRejected) continue
    }
    if (cli === 'antigravity') {
      if (agyIdentityRejected) continue
      // A result must name its session in the actual AGY protocol. When the
      // caller binds this read to a Worker, a missing result identity is not
      // enough evidence to persist a cumulative checkpoint for that Worker.
      if (v.event === 'result' && identity.conversationId &&
        !textId(obj(v.result).conversation_id)?.trim()) {
        agyIdentityRejected = true
        continue
      }
      const sources = [envelope, v, obj(v.step_update), obj(v.result)]
      const ids = sources.filter((source) => Object.hasOwn(source, 'conversation_id'))
        .map((source) => source.conversation_id)
      if (v.type === 'session') ids.push(v.id)
      for (const id of ids) {
        if (!textId(id)?.trim() || (agySession && id !== agySession)) {
          agyIdentityRejected = true
          break
        }
        agySession = id
      }
      // Legacy capture writes raw bytes before protocol.feed. A mismatch stops
      // the protocol, so later records in that same raw chunk are not receipts.
      if (agyIdentityRejected) continue
    }
    if (cli === 'zcode' && v.type === 'cliworker.zcode_context_observation' && v.cli === cli &&
      v.source === 'zcode.native-model-io' && session && v.sessionId === session && model && v.model === model &&
      textId(v.turnId) && textId(v.requestId) && textId(v.traceId)) {
      requestBreakdown = undefined
      const b = obj(v.breakdown)
      if (b.estimated === true && b.basis === 'zcode.estimateTokens.v1.actual-request' &&
        ['systemTokens', 'toolTokens', 'messageTokens'].every(key => count(b[key]) !== undefined))
        requestBreakdown = { systemTokens: b.systemTokens, toolTokens: b.toolTokens, messageTokens: b.messageTokens,
          estimated: true, source: 'ZCode 原生请求分类估算' }
    }
    if (cli === 'grok' && session && model) {
      const observation = v.type === 'cliworker.grok_context' && v.sessionId === session && v.modelId === model &&
        ['grok.session_status', 'grok.durable.updates'].includes(v.source) && v.basis === 'native-estimate' &&
        (v.contextUsed === null || count(v.contextUsed) !== undefined) ? v :
        identity.project ? grokContextStatus(v, { sessionId: session, modelId: model, project: identity.project }) : undefined
      if (observation && !(grokStatusObserved && observation.source === 'grok.durable.updates')) {
        if (observation.source === 'grok.session_status') grokStatusObserved = true
        contextSnapshot(result, observation.contextUsed, observation.contextCapacity, 'Grok 原生当前上下文估算', true)
      }
    }
    if (cli === 'grok' && !grokStatusObserved && v.type === 'cliworker.grok_model_context' &&
      session && v.sessionId === session && model && v.modelId === model) {
      const capacity = count(v.contextCapacity)
      if (capacity !== undefined && capacity > 0) {
        result.contextCapacity = capacity
        result.contextCapacitySource = 'Grok 原生所选模型窗口'
      }
    }
    if ((cli === 'mimo' || cli === 'opencode') && v.type === 'cliworker.http_context_observation' &&
      v.cli === cli && v.source === `${cli}.request-body.native-token-estimate` &&
      session && v.sessionId === session && model && v.model === model && textId(v.requestMessageId) &&
      textId(v.requestId)?.startsWith(v.requestMessageId + ':') &&
      /^\d{1,9}$/.test(v.requestId.slice(v.requestMessageId.length + 1))) {
      requestBreakdown = undefined
      const b = obj(v.breakdown), keys = ['systemTokens', 'toolTokens', 'messageTokens'] as const
      if (b.estimated === true && b.basis === 'native-chars-per-token-4' && keys.every(key => count(b[key]) !== undefined))
        requestBreakdown = { systemTokens: b.systemTokens, toolTokens: b.toolTokens, messageTokens: b.messageTokens,
          estimated: true, source: `${cli === 'mimo' ? 'MiMo' : 'OpenCode'} 原生请求分类估算` }
    }
    if (cli === 'pi' && v.type === 'cliworker.context_inspection' && v.cli === cli &&
      v.source === 'pi.context_with_system' && v.basis === 'native-estimate' &&
      session && v.sessionId === session && model && model === `${v.provider}/${v.model}` &&
      textId(v.requestId)?.startsWith(session + ':context:')) {
      requestBreakdown = undefined
      const names = ['System prompt', 'System tools', 'Messages']
      const rows = Array.isArray(v.categories) ? v.categories : []
      if (rows.length === 3 && rows.every((row, i) => row?.name === names[i] && row.kind === 'used' && count(row.tokens) !== undefined))
        requestBreakdown = { systemTokens: rows[0].tokens, toolTokens: rows[1].tokens, messageTokens: rows[2].tokens,
          estimated: true, source: 'Pi 原生请求分类估算' }
      if (count(v.contextCapacity) !== undefined && v.contextCapacity > 0) {
        result.contextCapacity = v.contextCapacity
        result.contextCapacitySource = 'Pi 原生模型窗口'
      }
    }
    if (
      v.type === 'cliworker.model_context' &&
      ((cli === 'opencode' || cli === 'mimo')
        ? v.source === `${cli}.provider.limit.context`
        : (cli === 'pi' || cli === 'omp') && v.source === `${cli}.get_state.model.contextWindow`) &&
      textId(v.providerID) &&
      textId(v.modelID) &&
      (!model || model === `${v.providerID}/${v.modelID}`)
    ) {
      const capacity = count(v.contextCapacity)
      if (capacity !== undefined && capacity > 0) {
        result.contextCapacity = capacity
        const name = { opencode: 'OpenCode', mimo: 'MiMo', pi: 'Pi', omp: 'OMP' }[cli as 'opencode' | 'mimo' | 'pi' | 'omp']
        result.contextCapacitySource = `${name} 原生模型目录`
      }
    }
    if (cli === 'opencode' && v.type === 'cliworker.session_usage' && v.cli === cli &&
      v.source === 'opencode.session.get' && textId(v.sessionId) && ownSession(v.sessionId)) {
      const receipt = completeUsage({ ...obj(v.usage), scope: 'session' } as TokenUsage, 'reasoning-separate')
      nativeSessionUsage = receipt ? { ...receipt, scope: 'session' } : undefined
    }
    if (cli === 'kimi' && v.type === 'cliworker.kimi_usage' && v.source === 'kimi.durable.main-wire' &&
      textId(v.sessionId) && ownSession(v.sessionId) && textId(v.turnId) && textId(v.model) &&
      (!model || v.model === model) && (v.scope === 'run' || v.scope === 'reported')) {
      delete result.runUsage
      delete result.usage
      const u = obj(v.usage), fields = ['inputOther', 'output', 'inputCacheRead', 'inputCacheCreation'] as const
      if (fields.every((field) => count(u[field]) !== undefined)) {
        const total = fields.reduce((sum, field) => sum + u[field], 0)
        if (Number.isSafeInteger(total) && total > 0) {
          result.usage = { total, input: u.inputOther, output: u.output,
            cacheRead: u.inputCacheRead, cacheWrite: u.inputCacheCreation, scope: v.scope }
          if (v.scope === 'run') result.runUsage = { ...result.usage }
        }
      }
    }
    if (cli === 'hermes' && (v.type === 'cliworker.hermes_observation' || v.type === 'cliworker.hermes_observer_summary') &&
      textId(v.sessionId) && (!hermesSession || v.sessionId === hermesSession) &&
      textId(v.nativeRunId) && v.usageBasis === 'cli-normalized') {
      hermesObserverRunIds.add(v.nativeRunId)
      const u = obj(v.usage), receipt = hermesCanonicalUsage(completeUsage({ ...u, scope: 'response' } as TokenUsage, 'inclusive'))
      if (v.type === 'cliworker.hermes_observation' && v.source === 'hermes.observer.post_api_request' &&
        textId(v.turnId) && textId(v.requestId) && hermesModelMatches(model, v.model, v.provider)) {
        const key = JSON.stringify([v.nativeRunId, v.turnId, v.requestId])
        hermesObservationRuns.set(key, v.nativeRunId)
        if (receipt) hermesObservations.set(key, receipt)
        else hermesObservations.delete(key)
        const context = obj(v.context)
        if (receipt && context.basis === 'provider-prompt' && context.used === receipt.input &&
          count(context.capacity) !== undefined && context.capacity > 0) {
          contextSnapshot(result, context.used, context.capacity, 'Hermes 官方请求输入 / 模型窗口', false)
          const breakdown = obj(context.breakdown)
          const fields = ['systemTokens', 'toolTokens', 'messageTokens'] as const
          const known = fields.filter(field => breakdown[field] !== undefined)
          if (breakdown.basis === 'hermes-native-request-estimate' && breakdown.estimated === true &&
            known.length > 0 && known.every(field => count(breakdown[field]) !== undefined)) {
            result.contextBreakdown = { ...Object.fromEntries(known.map(field => [field, breakdown[field]])),
              estimated: true, source: 'Hermes 官方请求分类估算' }
          }
        } else if (receipt) {
          // Keeping the last confirmed sample while waiting is safe, but a new
          // successful request with unknown context invalidates that numerator.
          contextSnapshot(result, undefined, undefined, 'Hermes 官方请求输入 / 模型窗口', false)
        }
      } else if (v.type === 'cliworker.hermes_observer_summary' &&
        v.source === 'hermes.observer.summary') {
        hermesObserverRuns.delete(v.nativeRunId)
        if (receipt && v.coverageComplete === true && v.usageComplete === true &&
          count(v.requestCount) !== undefined && v.requestCount > 0 && v.requestCount === v.responseCount && v.errorCount === 0)
          hermesObserverRuns.set(v.nativeRunId, receipt)
      }
    }
    if (cli === 'codex' && v.type === 'cliworker.codex_run_usage' && textId(v.sessionId) && ownSession(v.sessionId) && textId(v.turnId)) {
      const receipt = hasInvalidMetrics(v.usage, camelFields) ? undefined : completeUsage(camelUsage(v.usage, 'run'), 'inclusive')
      // Older producers subtracted an unchanged resume/session counter after
      // interruption. That derived zero is not a settled current-run receipt.
      result.runUsage = receipt && receipt.total > 0 ? receipt : undefined
      if (receipt?.total === 0) result.unsettledRunUsage = true
      else if (receipt) delete result.unsettledRunUsage
    } else if ((cli === 'qoder' || cli === 'qodercn') && v.type === `cliworker.${cli}_prompt_usage` && textId(v.sessionId) && ownSession(v.sessionId) &&
      (!model || v.model === model)) {
      const u = obj(v.usage)
      delete result.runUsage
      delete result.usage
      if (['inputTokens', 'outputTokens', 'totalTokens'].every(key => count(u[key]) !== undefined) && u.totalTokens > 0 &&
        u.totalTokens === u.inputTokens + u.outputTokens)
        result.runUsage = result.usage = { input: u.inputTokens, output: u.outputTokens, total: u.totalTokens, scope: 'run' }
    } else if ((cli === 'qoder' || cli === 'qodercn') && v.type === `cliworker.${cli}_context` && v.source === `${cli}.native-transcript` &&
      v.basis === 'native-ratio' && textId(v.sessionId) && ownSession(v.sessionId) && textId(v.userMessageId) &&
      textId(v.model) && (!model || v.model === model)) {
      if (typeof v.contextRatio === 'number' && Number.isFinite(v.contextRatio) && v.contextRatio >= 0 && v.contextRatio <= 1) {
        result.contextRatio = v.contextRatio
        result.contextSource = `${cli === 'qodercn' ? 'Qoder CN' : 'Qoder'} 原生会话上下文比例`
        result.contextEstimated = true
        if (count(v.contextCapacity) !== undefined && v.contextCapacity > 0 && count(v.contextUsed) !== undefined &&
          v.contextUsed === Math.round(v.contextRatio * v.contextCapacity) &&
          [`${cli}.native-runtime-config`, `${cli}.native-session-log`].includes(v.contextCapacitySource)) {
          result.contextCapacity = v.contextCapacity
          result.contextUsed = v.contextUsed
          result.contextCapacitySource = v.contextCapacitySource === `${cli}.native-runtime-config`
            ? `${cli === 'qodercn' ? 'Qoder CN' : 'Qoder'} 同轮原生运行配置` : `${cli === 'qodercn' ? 'Qoder CN' : 'Qoder'} 同会话同轮原生日志`
          result.contextSource = `${cli === 'qodercn' ? 'Qoder CN' : 'Qoder'} 原生比例 × 已核实窗口（估算）`
        }
      }
      if (duration(v.providerCredits) !== undefined) result.providerCredits = v.providerCredits
    } else if (cli === 'antigravity' && v.type === 'cliworker.agy_prompt_usage' && textId(v.sessionId) && ownSession(v.sessionId) &&
      (!model || v.model === model)) {
      const u = obj(v.usage)
      delete result.runUsage
      delete result.usage
      if (['inputTokens', 'outputTokens', 'totalTokens'].every(key => count(u[key]) !== undefined) && u.totalTokens > 0)
        result.runUsage = result.usage = { input: u.inputTokens, output: u.outputTokens, total: u.totalTokens,
          ...(count(u.cachedReadTokens) !== undefined ? { cacheRead: u.cachedReadTokens } : {}),
          ...(count(u.cachedWriteTokens) !== undefined ? { cacheWrite: u.cachedWriteTokens } : {}),
          ...(count(u.thoughtTokens) !== undefined ? { reasoning: u.thoughtTokens } : {}), scope: 'run' }
    } else if (cli === 'grok' && v.type === 'cliworker.grok_prompt_usage' && textId(v.sessionId) && ownSession(v.sessionId)) {
      const raw = grokPromptUsage({ ...obj(v.usage), usageIsIncomplete: v.usageIsIncomplete })
      delete result.runUsage
      if (raw && !raw.usageIsIncomplete) {
        const u = raw.usage
        result.runUsage = result.usage = { total: u.totalTokens!, input: u.inputTokens, output: u.outputTokens,
          cacheRead: u.cachedReadTokens, cacheWrite: u.cacheCreationTokens, reasoning: u.reasoningTokens, scope: 'run' }
      } else delete result.usage
    } else if (cli === 'grok' && v.type === 'end' && textId(v.sessionId) && ownSession(v.sessionId)) {
      const receipt = grokResponseUsage(v.usage)
      delete result.runUsage
      if ((v.usage_is_incomplete === undefined || v.usage_is_incomplete === false) && receipt?.totalTokens !== undefined &&
        receipt.cacheReadTokens !== undefined && receipt.cacheWriteTokens !== undefined) {
        const input = receipt.inputTokens + receipt.cacheReadTokens + receipt.cacheWriteTokens
        if (Number.isSafeInteger(input)) result.runUsage = result.usage = { total: receipt.totalTokens,
          input, output: receipt.outputTokens, cacheRead: receipt.cacheReadTokens,
          cacheWrite: receipt.cacheWriteTokens, reasoning: receipt.reasoningTokens, scope: 'run' }
      } else delete result.usage
    } else if ((cli === 'pi' || cli === 'omp') && v.type === 'cliworker.rpc_response' && v.cli === cli &&
      v.source === `${cli}.message_end` && textId(v.sessionId) && ownSession(v.sessionId) && textId(v.responseId)) {
      const u = obj(v.usage), receipt = completeUsage({ ...u, scope: 'response' } as TokenUsage, 'separate')
      if (receipt) rpcResponses.set(v.responseId, receipt)
      else rpcResponses.delete(v.responseId)
    } else if (
      (cli === 'claude' || cli === 'omp') &&
      v.type === 'cliworker.context_inspection' &&
      v.cli === cli &&
      v.source === (cli === 'claude' ? 'claude.get_context_usage.summary' : 'omp.native-context') &&
      textId(v.sessionId) &&
      ownSession(v.sessionId) &&
      (!model || !textId(v.model) || model === v.model)
    ) {
      contextSnapshot(result, v.contextUsed, v.contextCapacity, `${cli === 'claude' ? 'Claude' : 'OMP'} 原生上下文分类估算`, true)
      // Claude 2.1.287's native summary emits these exact category names. Other
      // categories (memory, skills, free/buffer/deferred) are never reclassified.
      const categories = new Map<string, number>()
      for (const item of Array.isArray(v.categories) ? v.categories.slice(0, 64) : []) {
        const category = obj(item),
          tokens = count(category.tokens)
        if (
          category.kind === 'used' &&
          tokens !== undefined &&
          ['System prompt', 'System tools', 'MCP tools', 'Messages'].includes(category.name) &&
          !categories.has(category.name)
        )
          categories.set(category.name, tokens)
      }
      const nativeCategories = (Array.isArray(v.categories) ? v.categories.slice(0, 64) : []).flatMap((value: unknown) => {
        const item = obj(value), tokens = count(item.tokens)
        return textId(item.name) && tokens !== undefined && ['used', 'free', 'buffer', 'deferred'].includes(item.kind)
          ? [{ name: item.name.slice(0, 80), tokens, kind: item.kind as 'used' | 'free' | 'buffer' | 'deferred' }] : []
      })
      if (nativeCategories.length) {
        const toolNames = ['System tools', 'MCP tools'].filter((name) => categories.has(name))
        const tools = toolNames.reduce((sum, name) => sum + categories.get(name)!, 0)
        result.contextBreakdown = {
          categories: nativeCategories,
          ...(categories.has('System prompt') ? { systemTokens: categories.get('System prompt') } : {}),
          ...(toolNames.length && Number.isSafeInteger(tools) ? { toolTokens: tools } : {}),
          ...(categories.has('Messages') ? { messageTokens: categories.get('Messages') } : {}),
          estimated: true,
          source: `${cli === 'claude' ? 'Claude 原生 summary' : 'OMP 原生 /context'} 分类估算`,
        }
      }
    } else if (
      (cli === 'pi' || cli === 'omp') &&
      v.type === 'cliworker.rpc_usage' &&
      v.cli === cli &&
      v.source === `${cli}.get_session_stats` &&
      textId(v.sessionId) &&
      ownSession(v.sessionId)
    ) {
      const u = obj(v.usage),
        total = count(u.total)
      if (total !== undefined)
        result.usage = {
          total,
          scope: cli === 'omp' ? 'reported' : 'session',
          ...(cli === 'omp' && u.orchestration ? orchestrationMetrics(u) : {}),
          ...Object.fromEntries(
            ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'].flatMap((key) =>
              count(u[key]) === undefined ? [] : [[key, count(u[key])]],
            ),
          ),
        }
      if (v.contextUsage && Object.hasOwn(obj(v.contextUsage), 'tokens')) {
        const context = obj(v.contextUsage)
        contextSnapshot(
          result,
          context.tokens,
          context.contextWindow,
          `${cli === 'pi' ? 'Pi' : 'OMP'} 原生会话上下文估算`,
          true,
        )
      }
    } else if (
      (cli === 'kimi' || cli === 'grok') &&
      v.method === 'session/update' &&
      textId(obj(v.params).sessionId) &&
      ownSession(obj(v.params).sessionId)
    ) {
      const update = obj(obj(v.params).update)
      if (update.sessionUpdate === 'usage_update')
        contextSnapshot(
          result,
          update.used,
          update.size,
          `${cli === 'kimi' ? 'Kimi' : 'Grok'} 原生会话上下文统计`,
          true,
        )
      else if (cli === 'grok' && Object.hasOwn(obj(obj(v.params)._meta), 'totalTokens'))
        contextSnapshot(result, obj(obj(v.params)._meta).totalTokens, undefined, 'Grok 原生当前上下文估算', true)
    } else if (
      cli === 'zcode' &&
      v.method === 'session/event' &&
      textId(obj(v.params).sessionId) &&
      ownSession(obj(v.params).sessionId)
    ) {
      const params = obj(v.params),
        payload = obj(params.payload)
      if (params.type === 'turn.completed') {
        delete result.runUsage
        const receipt = zcodeUsage(payload.usage, 'run')
        if (receipt) {
          result.usage = receipt
          result.runUsage = hasInvalidMetrics(payload.usage, ['totalTokens', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'])
            ? undefined : completeUsage(receipt, 'inclusive')
          zcodeTurnUsage = true
        }
      } else if (
        params.type === 'session.updated' &&
        payload.type === 'model_request_completed' &&
        payload.querySource === 'main_turn' &&
        textId(payload.providerId) &&
        textId(payload.modelId) &&
        (!model || model === `${payload.providerId}/${payload.modelId}`)
      ) {
        const receipt = zcodeUsage(payload.usage, 'response')
        if (receipt?.input !== undefined && receipt.output !== undefined) {
          const used = receipt.input + receipt.output
          if (Number.isSafeInteger(used))
            contextSnapshot(result, used, undefined, 'ZCode 最近一次主请求的原生窗口统计', true)
        }
      }
    } else if (
      cli === 'zcode' &&
      textId(obj(obj(v.result).projection).sessionId) &&
      ownSession(obj(obj(v.result).projection).sessionId) &&
      obj(obj(v.result).projection).sessionId !== 'unknown'
    ) {
      const projection = obj(obj(v.result).projection)
      // The installed reducer starts each headless process with this empty
      // projection, even when session/read already contains persisted messages.
      // It is not a context reset or an authoritative zero session bill.
      const bootstrap = projection.turnCount === 0 && !textId(projection.currentTurnId) &&
        projection.contextUsed === 0 && projection.totalTokenCount === 0
      if (!bootstrap) {
        contextSnapshot(
          result,
          projection.contextUsed,
          projection.contextWindow,
          'ZCode 原生会话窗口统计',
          true,
        )
        const total = count(projection.totalTokenCount)
        // Native projection totals accumulate only this process's events.
        // The complete turn receipt above retains its full accounting fields.
        if (total !== undefined && !zcodeTurnUsage) result.usage = { total, scope: 'run' }
      }
    } else if (
      cli === 'codex' &&
      v.method === 'thread/tokenUsage/updated' &&
      textId(obj(v.params).threadId) &&
      ownSession(obj(v.params).threadId)
    ) {
      const tokens = obj(obj(v.params).tokenUsage)
      result.usage = camelUsage(tokens.total, 'session') ?? result.usage
      // Native TokenUsage::tokens_in_context_window returns last.total_tokens.
      contextSnapshot(
        result,
        obj(tokens.last).totalTokens,
        tokens.modelContextWindow,
        'Codex 最近一次请求的原生窗口统计',
        true,
      )
    } else if (cli === 'antigravity') {
      const step = obj(v.step_update)
      if (
        v.event === 'step_update' &&
        step.step_type === 'agent_response' &&
        Number.isInteger(step.step_index)
      ) {
        const u = usage(step.usage, 'response')
        if (u) result.replies[String(step.step_index)] = u
        const seconds = duration(step.duration_seconds)
        if (seconds !== undefined) (result.replyDurations ??= {})[String(step.step_index)] = seconds
      }
      if (v.event === 'result') {
        result.usage = usage(obj(v.result).usage, 'session') ?? result.usage
        const seconds = duration(obj(v.result).duration_seconds)
        if (seconds !== undefined) result.sessionDurationSeconds = seconds
      }
    } else if (cli === 'codex' && v.type === 'turn.completed') {
      if (!codexNativeUsage && (!Object.hasOwn(v, 'thread_id') || ownSession(v.thread_id))) {
        const receipt = usage(v.usage, 'run')
        result.usage = receipt ?? result.usage
        result.runUsage = hasInvalidMetrics(v.usage, snakeFields) ? undefined : completeUsage(receipt, 'inclusive')
        if (result.runUsage) delete result.unsettledRunUsage
      }
    } else if (cli === 'hermes' && v.type === 'result') {
      const receipt = hermesCanonicalUsage(hermesTokenUsage(v.tokens))
      result.usage = receipt ?? result.usage
      result.runUsage = hasInvalidMetrics(v.tokens, ['total', 'input', 'output', 'cache_read', 'cache_write'])
        ? undefined : completeUsage(receipt, 'inclusive')
    } else if (
      cli === 'hermes' &&
      (v.type === 'hermes.run' ||
        ['run.completed', 'run.failed', 'run.cancelled', 'run.interrupted'].includes(v.event))
    ) {
      // A fresh Hermes agent accumulates these counters for each run, including cache in input.
      if (typeof v.run_id === 'string' && v.run_id) {
        observedHermesRuns.add(v.run_id)
        delete result.runUsage
        const receipt = !hasInvalidMetrics(v.usage, hermesUsageFields) && count(obj(v.usage).total_tokens) !== undefined
          ? hermesCanonicalUsage(usage(v.usage, 'run')) : undefined
        if (receipt) hermesRuns.set(v.run_id, receipt)
        else hermesRuns.delete(v.run_id)
      }
    } else if (cli === 'claude' && v.type === 'result' && ownSession(v.session_id)) {
      result.usage = usage(v.usage, 'run', true) ?? result.usage
      const u = obj(v.usage)
      result.runUsage = !hasInvalidMetrics(u, snakeFields) &&
        (count(u.total_tokens) !== undefined || [u.cache_read_input_tokens, u.cache_creation_input_tokens].every((v) => count(v) !== undefined))
        ? completeUsage(usage(u, 'run', true), 'separate') : undefined
      const models = Object.values(obj(v.modelUsage))
      if (models.length === 1 && (count(obj(models[0]).contextWindow) ?? 0) > 0) {
        result.contextCapacity = count(obj(models[0]).contextWindow)
        result.contextCapacitySource = 'Claude 原生模型窗口'
      }
    } else if (cli === 'claude' && v.type === 'stream_event' && v.parent_tool_use_id == null &&
      textId(v.session_id) && ownSession(v.session_id)) {
      const event = obj(v.event)
      if (event.type === 'message_start') {
        const message = obj(event.message)
        claudeStream = textId(message.id) && (!model || message.model === model)
          ? { id: message.id, usage: { ...obj(message.usage) }, delta: false,
            valid: !hasInvalidMetrics(message.usage, snakeFields) } : undefined
      } else if (event.type === 'message_delta' && claudeStream) {
        const u = obj(event.usage), output = count(u.output_tokens), previous = count(claudeStream.usage.output_tokens)
        if (output === undefined || (previous !== undefined && output < previous) || hasInvalidMetrics(u, snakeFields))
          claudeStream.valid = false
        Object.assign(claudeStream.usage, u)
        claudeStream.delta = true
      } else if (event.type === 'message_stop' && claudeStream) {
        if (claudeStream.valid && claudeStream.delta) {
          const u = claudeStream.usage, buckets = [u.input_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens]
          const used = buckets.every((v) => count(v) !== undefined) ? buckets.reduce((sum, v) => sum + v, 0) : undefined
          contextSnapshot(result, used, undefined, 'Claude 最近一次完成请求的输入统计', true)
          claudeFinalMessages.add(claudeStream.id)
        } else contextSnapshot(result, undefined, undefined, 'Claude 最近一次完成请求的输入统计', true)
        claudeStream = undefined
      }
    } else if (
      cli === 'claude' &&
      v.type === 'assistant' &&
      v.parent_tool_use_id == null &&
      ownSession(v.session_id) &&
      !claudeFinalMessages.has(obj(v.message).id) &&
      (!model || obj(v.message).model === model)
    ) {
      const message = obj(v.message),
        u = obj(message.usage)
      if (Object.hasOwn(u, 'input_tokens')) {
        const buckets = [
          count(u.input_tokens),
          count(u.cache_read_input_tokens),
          count(u.cache_creation_input_tokens),
        ]
        const used = buckets.every((n) => n !== undefined)
          ? buckets.reduce<number>((sum, n) => sum + n!, 0)
          : undefined
        contextSnapshot(
          result,
          Number.isSafeInteger(used) ? used : undefined,
          undefined,
          'Claude 最近一次请求的输入统计',
          true,
        )
      }
    } else if ((cli === 'mimo' || cli === 'opencode') && v.type === 'message.updated') {
      const info = obj(obj(v.properties).info)
      if (
        info.role === 'assistant' &&
        typeof info.id === 'string' &&
        info.id &&
        typeof info.sessionID === 'string' &&
        info.sessionID
      ) {
        if (model && textId(info.modelID) && textId(info.providerID) && model !== `${info.providerID}/${info.modelID}`) continue
        const key = JSON.stringify([info.sessionID, info.id])
        if (ownSession(info.sessionID)) ownedMessages.add(key)
        if (ownSession(info.sessionID)) {
          if (hasInvalidMetrics(info.tokens, ['total', 'input', 'output', 'reasoning']) || hasInvalidMetrics(obj(info.tokens).cache, ['read', 'write']))
            invalidMessages.add(key)
          else invalidMessages.delete(key)
        }
        const receipt = messageUsage(info.tokens, 'response')
        // Each update replaces a message's cumulative snapshot, including unfinished/failed turns.
        if (receipt && ownSession(info.sessionID))
          messages.set(key, receipt)
        else if (ownSession(info.sessionID)) messages.delete(key)
        if (ownSession(info.sessionID) && count(obj(info.time).completed) !== undefined && !info.error) completedMessages.add(key)
        else completedMessages.delete(key)
        if (
          ownSession(info.sessionID) &&
          (!model ||
            !textId(info.modelID) ||
            !textId(info.providerID) ||
            model === `${info.providerID}/${info.modelID}`)
        ) {
          const used = contextInput(cli, info.tokens)
          // OpenCode 1.19.0 ACP Usage.contextTokens excludes output/reasoning.
          // A freshly created assistant carries zero-filled token placeholders.
          // Only a real usage receipt may replace the prior observed window;
          // a settled reply with missing buckets explicitly invalidates it.
          const hasFinish = !!textId(info.finish)
          const completed = count(obj(info.time).completed) !== undefined
          if (!info.error && ((used !== undefined && (used > 0 || hasFinish)) ||
            (used === undefined && (hasFinish || completed))))
            contextSnapshot(
              result,
              used,
              undefined,
              `${cli === 'opencode' ? 'OpenCode' : 'MiMo'} 最近一次请求的输入统计`,
              true,
            )
        }
      }
    } else if ((cli === 'mimo' || cli === 'opencode') && v.type === 'step_finish') {
      const part = obj(v.part),
        t = obj(part.tokens)
      const id = Object.hasOwn(v, 'sessionID') ? v.sessionID : part.sessionID
      if ((session && (!textId(id) || !ownSession(id))) ||
        (Object.hasOwn(v, 'sessionID') && Object.hasOwn(part, 'sessionID') && v.sessionID !== part.sessionID)) continue
      const u = messageUsage(t, 'response')
      if (!textId(part.id) || !u || hasInvalidMetrics(t, ['total', 'input', 'output', 'reasoning']) ||
        hasInvalidMetrics(t.cache, ['read', 'write'])) invalidLegacyStep = true
      if (u && typeof part.id === 'string') mimoSteps.set(part.id, u)
      const used = contextInput(cli, t)
      contextSnapshot(result, used, undefined, `${cli === 'opencode' ? 'OpenCode' : 'MiMo'} 最近一次请求的输入统计`, true)
    }
    // Only explicit occupancy fields count as context, never cumulative input/total usage.
    const context = obj(v.context_usage)
    const used = count(context.used_tokens),
      capacity = count(context.max_tokens)
    if (used !== undefined) result.contextUsed = used
    if (capacity !== undefined && capacity > 0) result.contextCapacity = capacity
  }
  // HTTP message snapshots supersede legacy step receipts of the same model calls.
  const aggregate = sumUsage(
    hermesRuns.size ? hermesRuns.values() : messages.size ? messages.values() : mimoSteps.values(),
  )
  if (aggregate) {
    result.usage = aggregate
    if (hermesRuns.size && hermesRuns.size === observedHermesRuns.size) result.runUsage = completeUsage(aggregate, 'inclusive')
    else if (messages.size && messages.size === ownedMessages.size &&
      !invalidMessages.size &&
      [...ownedMessages].every((id) => completedMessages.has(id)) &&
      [...messages.values()].every((value) => completeUsage(value, 'reasoning-separate')))
      result.runUsage = aggregate
    else if (!ownedMessages.size && !messages.size && mimoSteps.size && !invalidLegacyStep && [...mimoSteps.values()].every((value) => completeUsage(value, 'reasoning-separate')))
      result.runUsage = aggregate
  }
  // The official Hermes run receipt has priority. Observer receipts supplement
  // only missing usage; physical retries never become an invented complete run.
  if (cli === 'hermes' && !result.usage && !hermesIdentityRejected) {
    const values = [...hermesObserverRuns.values(),
      ...[...hermesObservations].filter(([key]) => !hermesObserverRuns.has(hermesObservationRuns.get(key)!)).map(([, value]) => value)]
    const observed = sumUsage(values)
    const complete = hermesObserverRunIds.size > 0 && hermesObserverRunIds.size === hermesObserverRuns.size
    if (observed) {
      result.usage = { ...observed, scope: complete ? 'run' : 'reported' }
      if (complete) result.runUsage = observed
    }
  }
  if (nativeSessionUsage) result.usage = nativeSessionUsage
  if (rpcResponses.size && !result.usage) result.usage = { ...sumUsage(rpcResponses.values())!, scope: 'reported' }
  if (requestBreakdown && result.contextUsed !== undefined) result.contextBreakdown = requestBreakdown
  return result
}

/** Read-only projection also recovers telemetry from pre-feature private raw logs.
 * Incremental byte reads keep live polling O(new bytes), with bounded cache/line memory.
 * Malformed/torn records affect telemetry only, never conversation restoration.
 */
export class TelemetryReader {
  private cache = new Map<
    string,
    {
      size: number
      mtime: number
      inode: string
      records: unknown[]
      pending: string
      result: RunTelemetry
    }
  >()
  read(path: string, cli: CliId, identity: TelemetryIdentity = {}): RunTelemetry {
    const key = JSON.stringify([path, cli, identity.conversationId, identity.model, identity.project])
    let stat
    try {
      stat = lstatSync(path)
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 64 * 1024 * 1024) return { replies: {} }
    } catch {
      return { replies: {} }
    }
    const inode = `${stat.dev}:${stat.ino}`
    let entry = this.cache.get(key)
    if (entry && entry.inode === inode && entry.size === stat.size && entry.mtime === stat.mtimeMs)
      return entry.result
    if (
      !entry ||
      entry.inode !== inode ||
      stat.size < entry.size ||
      (stat.size === entry.size && stat.mtimeMs !== entry.mtime)
    )
      entry = { size: 0, mtime: 0, inode, records: [], pending: '', result: { replies: {} } }
    let fd: number | undefined
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      const before = fstatSync(fd)
      if (
        !before.isFile() ||
        before.nlink !== 1 ||
        `${before.dev}:${before.ino}` !== inode ||
        before.size !== stat.size ||
        before.mtimeMs !== stat.mtimeMs
      )
        return entry.result
      const buf = Buffer.alloc(stat.size - entry.size)
      const n = readSync(fd, buf, 0, buf.length, entry.size)
      const lines = (entry.pending + buf.subarray(0, n).toString('utf8')).split('\n')
      const pending = lines.pop() ?? ''
      if (Buffer.byteLength(pending) > 1024 * 1024) return entry.result
      const appended: unknown[] = []
      for (const line of lines) {
        if (Buffer.byteLength(line) > 1024 * 1024) return entry.result
        try {
          const envelope = obj(JSON.parse(line))
          appended.push(...metricRecords(envelope.type === 'native' ? obj(envelope.record) : envelope))
        } catch {
          /* Diagnostics and torn records are not telemetry. */
        }
      }
      const after = fstatSync(fd),
        current = lstatSync(path)
      if (
        n !== buf.length ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        !current.isFile() ||
        current.nlink !== 1 ||
        `${current.dev}:${current.ino}` !== inode ||
        current.size !== after.size ||
        current.mtimeMs !== after.mtimeMs
      )
        return entry.result
      const records = [...entry.records, ...appended]
      if (records.length > 10000) return entry.result
      const next = {
        size: stat.size,
        mtime: stat.mtimeMs,
        inode,
        records,
        pending,
        result: extractTelemetry(cli, records, identity),
      }
      this.cache.delete(key)
      this.cache.set(key, next)
      if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!)
      return next.result
    } catch {
      return entry.result
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }
}
export function attachTelemetry(rows: TimelineItem[], runId: string, telemetry: RunTelemetry) {
  const runRows = rows.filter((row) => row.id.startsWith(`${runId}:`))
  if (telemetry.sessionDurationSeconds !== undefined)
    for (const row of runRows) row.sessionDurationSeconds = telemetry.sessionDurationSeconds
  const replies = runRows.filter((row) => row.kind === 'assistant')
  for (const row of replies) {
    const step = row.response
      ? /^agy:(\d+)$/u.exec(row.response.id)?.[1]
      : row.id.split(':')[1] === 'assistant' ? row.id.split(':')[2] : undefined
    if (step !== undefined && telemetry.replies[step]) row.usage = telemetry.replies[step]
    if (step !== undefined && telemetry.replyDurations?.[step] !== undefined)
      row.durationSeconds = telemetry.replyDurations[step]
  }
  const last = replies.at(-1)
  if (last && !last.usage) last.usage = telemetry.finalReply
  if (last && telemetry.providerCredits !== undefined) last.providerCredits = telemetry.providerCredits
}
