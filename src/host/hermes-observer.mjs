import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

const count = (value) => Number.isSafeInteger(value) && value >= 0
const id = (value) => typeof value === 'string' && value.length > 0 && value.length <= 500
const safeReasons = new Set([
  'auth', 'auth_permanent', 'billing', 'rate_limit', 'upstream_rate_limit', 'upstream_blocked',
  'overloaded', 'server_error', 'timeout', 'ssl_cert_verification', 'context_overflow', 'payload_too_large',
  'image_too_large', 'image_corrupt', 'model_not_found', 'provider_policy_blocked', 'content_policy_blocked',
  'model_entitlement', 'incomplete_response', 'format_error', 'role_alternation', 'invalid_encrypted_content',
  'multimodal_tool_content_unsupported', 'reasoning_mandatory', 'thinking_signature', 'long_context_tier',
  'oauth_long_context_beta_forbidden', 'llama_cpp_grammar_pattern', 'unknown', 'invalid_response',
])

function requestContextBreakdown(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.estimated !== true ||
    value.basis !== 'hermes-native-request-estimate') return
  const fields = ['systemTokens', 'toolTokens', 'messageTokens']
  if (Object.keys(value).some(key => ![...fields, 'estimated', 'basis'].includes(key)) ||
    fields.some(key => value[key] !== undefined && !count(value[key]))) return
  const counts = Object.fromEntries(fields.filter(key => value[key] !== undefined).map(key => [key, value[key]]))
  if (!Object.keys(counts).length) return
  return { ...counts, estimated: true, basis: 'hermes-native-request-estimate' }
}

/** Only already-correlated native occurrences reach this public status rail. */
export function hermesObservedRequestState(record, runId, sessionId) {
  const phase = new Map([['request', 'requesting'], ['error', 'failed'], ['response', 'completed']]).get(record?.phase)
  if (!phase || !id(runId) || !id(sessionId) || record.session_id !== sessionId ||
    record.task_id !== sessionId || !count(record.seq) || record.seq < 1) return
  return { type: 'hermes.request-state', runId, sessionId, sequence: record.seq, phase,
    ...(count(record.retry_count) ? { retryCount: record.retry_count } : {}),
    ...(phase === 'failed' ? {
      ...(count(record.status_code) && record.status_code >= 100 && record.status_code <= 599
        ? { statusCode: record.status_code } : {}),
      ...(safeReasons.has(record.reason) ? { reason: record.reason } : {}),
      ...(count(record.max_retries) ? { maxRetries: record.max_retries } : {}),
      ...(typeof record.retryable === 'boolean' ? { retryable: record.retryable } : {}),
    } : {}) }
}

/** Independently validate an exact pre/post pair from the current process. */
export function hermesObservedResponse(start, end) {
  if (!start || !end || start.phase !== 'request' || end.phase !== 'response' ||
    ['session_id', 'task_id', 'turn_id', 'api_request_id', 'model', 'provider', 'api_mode', 'api_call_count']
      .some((key) => start[key] !== end[key]) || !count(end.api_call_count) ||
    end.task_id !== end.session_id ||
    !['session_id', 'task_id', 'turn_id', 'api_request_id', 'model', 'provider', 'api_mode'].every((key) => id(end[key]))) return
  const u = end.usage
  if (!u || end.usage_basis !== 'hermes-canonical' ||
    !['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'prompt_tokens', 'total_tokens'].every((key) => count(u[key])) ||
    u.prompt_tokens !== u.input_tokens + u.cache_read_tokens + u.cache_write_tokens ||
    u.total_tokens !== u.prompt_tokens + u.output_tokens || !count(u.total_tokens) ||
    (u.reasoning_tokens !== undefined && (!count(u.reasoning_tokens) || u.reasoning_tokens > u.output_tokens))) return
  // A canonical zero cache/reasoning may be a normalization default. Preserve
  // the real bill total and positive subcounts; do not claim raw provider zeros.
  const usage = { input: u.prompt_tokens, output: u.output_tokens, total: u.total_tokens,
    ...(u.cache_read_tokens > 0 ? { cacheRead: u.cache_read_tokens } : {}),
    ...(u.cache_write_tokens > 0 ? { cacheWrite: u.cache_write_tokens } : {}),
    ...(u.reasoning_tokens > 0 ? { reasoning: u.reasoning_tokens } : {}) }
  const context = !end.moa && u.prompt_tokens > 0 && count(end.context_length) && end.context_length > 0 && u.prompt_tokens <= end.context_length
    ? { used: u.prompt_tokens, capacity: end.context_length, basis: 'provider-prompt' } : undefined
  const breakdown = start.api_mode === 'chat_completions' && start.provider !== 'moa'
    ? requestContextBreakdown(start.context_breakdown) : undefined
  if (context && breakdown) context.breakdown = breakdown
  return { sessionId: end.session_id, turnId: end.turn_id, requestId: end.api_request_id,
    model: end.model, provider: end.provider, usage, usageBasis: 'cli-normalized',
    source: 'hermes.observer.post_api_request',
    ...(context ? { context } : {}) }
}

/** Per-child, bounded optional observation; every native run owns one directory. */
export async function prepareHermesObserver(stateDirectory, selection) {
  if (!isAbsolute(stateDirectory)) throw new Error('Hermes observer directory must be absolute')
  const directory = await realpath(await mkdtemp(join(stateDirectory, 'hermes-observer-')))
  let file
  const path = join(directory, 'events.jsonl'), nonce = randomBytes(32).toString('hex')
  try {
    await chmod(directory, 0o700)
    await writeFile(path, '', { flag: 'wx', mode: 0o600 })
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
  const original = await file.stat()
  let offset = 0, pending = '', sequence = 0, valid = true, ready = false, sessionId, nativeRunId
  const decoder = new StringDecoder('utf8')
  const starts = new Map(), settled = new Set()
  let turnId, turnEnded = false
  let requestCount = 0, responseCount = 0, errorCount = 0, validResponses = 0, finished = false
  let combinedRequests = false
  let queued = Promise.resolve(), closing = false, closed = false, closePromise, polling
  const serialize = (operation) => {
    const next = queued.then(operation)
    queued = next.catch(() => {})
    return next
  }
  const stopPolling = async () => {
    if (!polling) return
    polling.stop = true
    clearTimeout(polling.timer)
    polling.wake?.()
    await polling.promise
  }
  const totals = { input: 0, output: 0, total: 0 }
  let runtimeConfirmed = false
  const result = {
    env: { CLIWORKER_HERMES_OBSERVER_DIR: directory, CLIWORKER_HERMES_OBSERVER_NONCE: nonce },
    async bind(session) {
      if (closing || closed || sessionId || !id(session)) throw new Error('Hermes observer binding is invalid')
      sessionId = session
      await writeFile(join(directory, 'identity.json'), JSON.stringify({ nonce, sessionId, ...selection }), { flag: 'wx', mode: 0o600 })
    },
    bindRun(run) { if (closing || closed || nativeRunId || !id(run)) throw new Error('Hermes observer run binding is invalid'); nativeRunId = run },
    read(emit) {
      if (closing || closed || finished) return Promise.resolve(false)
      return serialize(() => closed || finished ? false : readRecords(emit))
    },
    startPolling(emit, { signal, intervalMs = 100 } = {}) {
      if (polling || closing || closed || finished || !nativeRunId || !sessionId)
        throw new Error('Hermes observation poll lifecycle is invalid')
      if (!Number.isFinite(intervalMs) || intervalMs < 10 || intervalMs > 1000)
        throw new Error('Hermes observation poll interval is invalid')
      const current = polling = { stop: signal?.aborted === true }
      const stop = () => { current.stop = true; clearTimeout(current.timer); current.wake?.() }
      signal?.addEventListener('abort', stop, { once: true })
      current.promise = (async () => {
        try {
          while (!current.stop && !closing && !closed && !finished && valid) {
            // A finish/close barrier must drain a read already in flight. Only
            // actual run cancellation suppresses its late public status.
            await result.read(record => { if (!signal?.aborted && !closed) emit(record) })
            if (current.stop || closing || closed || finished || !valid) break
            await new Promise(resolve => {
              current.wake = resolve
              current.timer = setTimeout(resolve, intervalMs)
              current.timer.unref?.()
            })
            current.wake = undefined
          }
        } finally { signal?.removeEventListener('abort', stop); clearTimeout(current.timer) }
      })()
      return stopPolling
    },
    async finish(emit) {
      await stopPolling()
      if (closing || closed) return false
      if (finished) return ready && valid
      return serialize(async () => {
        if (closed || finished) return
        await readRecords(emit)
        if (decoder.end()) valid = false
        finished = true
        if (!nativeRunId || !sessionId) return
        const coverageComplete = valid && ready && turnEnded && !pending && starts.size === 0 && requestCount > 0
          && requestCount === responseCount + errorCount
        // Every request/response and the successful turn end passed the exact
        // session/model/provider gates below. Never infer identity from a
        // requested model, an isolated response, or incomplete observation.
        runtimeConfirmed = coverageComplete && !combinedRequests && errorCount === 0 && responseCount > 0
        const usageComplete = coverageComplete && !combinedRequests && errorCount === 0 && responseCount === validResponses
          && Object.values(totals).every(count)
        emit({ type: 'cliworker.hermes_observer_summary', source: 'hermes.observer.summary',
          nativeRunId, sessionId, requestCount, responseCount, errorCount, coverageComplete, usageComplete,
          usageBasis: 'cli-normalized', ...(usageComplete ? { usage: { ...totals } } : {}) })
        return ready && valid
      })
    },
    confirmedRuntime() { return runtimeConfirmed ? { ...selection } : undefined },
    close() {
      if (closePromise) return closePromise
      closing = true
      closePromise = (async () => {
        await stopPolling()
        await serialize(async () => {
          closed = true
          try { await file.close() }
          finally { await rm(directory, { recursive: true, force: true }) }
        })
      })()
      return closePromise
    },
  }
  async function readRecords(emit) {
      if (!valid || closed || finished) return false
      try {
        const info = await file.stat(), current = await lstat(path)
        if (!info.isFile() || current.isSymbolicLink() || current.ino !== original.ino || current.dev !== original.dev ||
          info.nlink !== 1 || current.nlink !== 1 || (process.platform !== 'win32' && (info.mode & 0o077) !== 0) ||
          info.size > 16 * 1024 * 1024 || info.size < offset) throw new Error('Unsafe observation file')
        const buffer = Buffer.alloc(info.size - offset)
        const { bytesRead } = await file.read(buffer, 0, buffer.length, offset)
        offset += bytesRead
        pending += decoder.write(buffer.subarray(0, bytesRead))
        for (;;) {
          const boundary = pending.indexOf('\n')
          if (boundary < 0) break
          const line = pending.slice(0, boundary); pending = pending.slice(boundary + 1)
          if (Buffer.byteLength(line) > 128 * 1024) throw new Error('Oversized observation')
          const record = JSON.parse(line)
          if (record.v !== 1 || record.nonce !== nonce || record.seq !== sequence + 1) throw new Error('Unbound observation')
          sequence = record.seq
          if (!ready) { if (record.phase !== 'ready') throw new Error('Missing observer initialization'); ready = true; continue }
          if (record.phase === 'turn_end') {
            if (record.session_id !== sessionId || record.model !== selection.model || record.turn_id !== turnId ||
              record.task_id !== sessionId || turnEnded || starts.size > 0 ||
              record.completed !== true || record.failed !== false || record.interrupted !== false) throw new Error('Unconfirmed turn end')
            turnEnded = true
            continue
          }
          if (!sessionId || record.session_id !== sessionId || record.task_id !== sessionId ||
            record.provider !== selection.provider || record.model !== selection.model ||
            !count(record.api_call_count) || !id(record.api_mode)) throw new Error('Foreign observation')
          if (turnEnded || !id(record.turn_id) || (turnId && turnId !== record.turn_id)) throw new Error('Foreign observer turn')
          turnId = record.turn_id
          const key = record.api_request_id
          if (!id(key)) throw new Error('Missing request identity')
          if (record.phase === 'request') {
            if (starts.has(key) || settled.has(key) || starts.size >= 1000) throw new Error('Duplicate request identity')
            starts.set(key, record)
            requestCount++
            const state = hermesObservedRequestState(record, nativeRunId, sessionId)
            if (state) emit(state)
          } else if (record.phase === 'response' || record.phase === 'error') {
            const start = starts.get(key)
            if (!start || settled.has(key)) throw new Error('Missing request start')
            if (['session_id', 'task_id', 'turn_id', 'model', 'provider', 'api_mode', 'api_call_count'].some((field) => start[field] !== record[field]) ||
              (record.phase === 'error' && start.retry_count !== record.retry_count)) throw new Error('Foreign request completion')
            starts.delete(key)
            if (record.phase === 'response') { settled.add(key); responseCount++ }
            else errorCount++
            const state = hermesObservedRequestState(record, nativeRunId, sessionId)
            if (state) emit(state)
            const response = record.phase === 'response' ? hermesObservedResponse(start, record) : undefined
            if (record.moa) combinedRequests = true
            if (response) {
              validResponses++
              for (const [bucket, value] of Object.entries(response.usage)) totals[bucket] = (totals[bucket] ?? 0) + value
              if (nativeRunId) emit({ type: 'cliworker.hermes_observation', nativeRunId, ...response })
            }
          } else throw new Error('Unknown observation phase')
        }
        if (Buffer.byteLength(pending) > 128 * 1024) throw new Error('Oversized partial observation')
      } catch { valid = false }
      return ready && valid
  }
  return result
}
