import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import type { Worker } from '../shared/types.ts'
import { extractTelemetry, type RunTelemetry } from './telemetry.ts'
import { grokContextStatus } from './grok-response.mjs'
import { readGrokDurableContext, readGrokDurableContextAsync } from './grok-durable-context.mjs'
import { readZcodeContextInspections, zcodeContextBinding, zcodeContextBindings } from './zcode-context-observation.mjs'
import { readQoderDurableContext, readQoderDurableContextAsync, qoderMeteringPaths } from './qoder-durable-context.mjs'
import { qoderConfigDirectory } from './qoder-accounts.ts'

const object = (v: any): any => v && typeof v === 'object' && !Array.isArray(v) ? v : {}
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(v)
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 512 && !/[\x00-\x1f]/.test(v)
function stamp(path: string): string {
  try { const s = lstatSync(path); return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.mode}:${s.nlink}` } catch { return 'missing' }
}
/** Bounded private raw snapshot. No prompt bytes are retained in the cache. */
function rawRecords(path: string): any[] | undefined {
  let fd: number | undefined
  try {
    const s = lstatSync(path)
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > 16 * 1024 * 1024) return
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    const before = fstatSync(fd)
    if (before.ino !== s.ino || before.dev !== s.dev) return
    const bytes = Buffer.alloc(s.size)
    let offset = 0
    while (offset < bytes.length) { const n = readSync(fd, bytes, offset, bytes.length - offset, offset); if (!n) return; offset += n }
    if (stamp(path) !== `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.mode}:${s.nlink}` || fstatSync(fd).size !== s.size) return
    if (bytes.length && bytes.at(-1) !== 10) return
    const lines = new TextDecoder('utf8', { fatal: true }).decode(bytes).trimEnd().split('\n').filter(Boolean)
    if (lines.length > 20000 || lines.some(line => Buffer.byteLength(line) > 2 * 1024 * 1024)) return
    return lines.map(line => { const e = object(JSON.parse(line)); return e.type === 'native' ? object(e.record) : e })
  } catch { return } finally { if (fd !== undefined) closeSync(fd) }
}
export interface NativeSupplementalContextInput {
  worker: Worker
  runId: string
  rawPath: string
  /** WorkerStore root, not a CLI home or an arbitrary search directory. */
  storageDirectory: string
  /** Supply only for the selected/current run. Presence requires exact current identity;
   * historical reads omit this and bind only to their own raw request. */
  currentIdentity?: { conversationId?: string; model?: string }
}
/** Read only exact historical requests; current Worker preferences never identify an old run.
 * Own undefined properties mean an observed request explicitly invalidated an older value.
 * An empty object means no evidence and MUST NOT clear existing context pressure.
 */
export class NativeSupplementalContextReader {
  private cache = new Map<string, { signature: string; result: Partial<RunTelemetry> }>()
  private pending = new Map<string, { signature: string; controller: AbortController }>()
  private completed = new Map<string, { signature: string; value: unknown; retryAfter: number }>()
  private capacityMisses = new Set<string>()
  private generation = 0
  constructor(private readonly onChanged: () => void = () => {}) {}
  clear() {
    this.generation++
    for (const value of this.pending.values()) value.controller.abort()
    this.pending.clear()
    this.completed.clear()
    this.capacityMisses.clear()
    this.cache.clear()
  }
  private windowsObservation<T>(key: string, signature: string, currentSignature: () => string,
    read: (signal: AbortSignal) => Promise<T | undefined>): T | undefined {
    const completed = this.completed.get(key)
    if (completed?.signature === signature && (completed.value !== undefined || Date.now() < completed.retryAfter))
      return completed.value as T | undefined
    this.completed.delete(key)
    const previous = this.pending.get(key)
    if (previous?.signature === signature) return
    previous?.controller.abort()
    this.pending.delete(key)
    // No unbounded queue and no shared cancellation between runtime owners.
    if (this.pending.size >= 4) { this.capacityMisses.add(key); return }
    const generation = this.generation, entry = { signature, controller: new AbortController() }
    this.pending.set(key, entry)
    let notify = false
    const complete = (value: T | undefined) => {
      if (entry.controller.signal.aborted || generation !== this.generation || this.pending.get(key) !== entry ||
        currentSignature() !== signature) return
      // Cache observations, not ACL authorizations. Transient unknowns may retry
      // on a later read; no timer repeatedly probes a rejected private source.
      this.completed.set(key, { signature, value, retryAfter: value === undefined ? Date.now() + 1000 : Infinity })
      if (this.completed.size > 64) this.completed.delete(this.completed.keys().next().value!)
      this.cache.delete(key)
      notify = true
    }
    void read(entry.controller.signal).then(complete, () => complete(undefined)).finally(() => {
      if (this.pending.get(key) === entry) this.pending.delete(key)
      // Release capacity before waking event-driven UI readers.
      if (notify && generation === this.generation && !entry.controller.signal.aborted) this.onChanged()
    }).catch(() => {})
  }
  read(input: NativeSupplementalContextInput): Partial<RunTelemetry> {
    const { worker, runId } = input
    // traecn context comes from its session/prompt receipt; do not inspect Qoder-style durable logs.
    if (!['zcode', 'grok', 'qoder', 'qodercn'].includes(worker.preference.cli ?? '') || !id(worker.id) || !id(runId)) return {}
    try {
      const root = realpathSync(input.storageDirectory)
      if (resolve(input.storageDirectory) !== root || resolve(input.rawPath) !== join(root, `${worker.id}.${runId}.raw.jsonl`)) return {}
      const native = join(root, 'native', worker.id)
      const rawSignature = stamp(input.rawPath)
      const constrained = Object.hasOwn(input, 'currentIdentity')
      const current = input.currentIdentity
      const unknownCurrent: Partial<RunTelemetry> = { contextUsed: undefined, contextCapacity: undefined, contextRatio: undefined,
        contextBreakdown: undefined, contextSource: undefined, contextCapacitySource: undefined, contextEstimated: undefined,
        ...((worker.preference.cli === 'qoder' || worker.preference.cli === 'qodercn') ? { providerCredits: undefined } : {}) }
      const matchesCurrent = (session: unknown, model: unknown) => !constrained ||
        (text(current?.conversationId) && text(current?.model) && session === current.conversationId && model === current.model)
      const qoderHome = (worker.preference.cli === 'qoder' || worker.preference.cli === 'qodercn') ? qoderConfigDirectory(process.env, worker.preference.cli) : ''
      const key = `${worker.id}:${runId}:${root}:${worker.project}:${worker.preference.cli}:${worker.conversationId ?? ''}:${qoderHome}:${constrained ? JSON.stringify(current ?? null) : 'historical'}`
      // Short-lived negative results also cache. File fingerprints below invalidate a
      // successful native supplement immediately when its exact source changes.
      const old = this.cache.get(key)
      const sourceStamp = (paths: string[]) => paths.map(path => `${path}=${stamp(path)}`).join('|')
      const previous = old as (typeof old & { paths?: string[] })
      const negative = this.completed.get(key)
      const negativeExpired = negative?.value === undefined && negative !== undefined && Date.now() >= negative.retryAfter
      if (previous && !this.pending.has(key) && !negativeExpired && previous.signature === `${rawSignature}|${sourceStamp(previous.paths ?? [])}`) return { ...previous.result }
      const records = rawRecords(input.rawPath)
      if (!records) {
        this.cache.set(key, { signature: `${rawSignature}|`, result: {} })
        if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!)
        return {}
      }
      const declared = records.filter(r => r.type === 'session' && text(r.id)).at(-1)
      const sessionId = declared?.id
      let result: Partial<RunTelemetry> = {}, paths: string[] = []
      if ((worker.preference.cli === 'qoder' || worker.preference.cli === 'qodercn')) {
        // ACP returns the native user UUID. This avoids prompt-text matching,
        // current-session guesses, and taking a later turn's context ratio.
        const end = records.findLast(r => r.result?.stopReason === 'end_turn' && id(r.result.userMessageId))?.result
        const model = declared?.model
        if (text(sessionId) && text(model) && id(end?.userMessageId) &&
          (!worker.conversationId || sessionId === worker.conversationId)) {
          if (!matchesCurrent(sessionId, model)) result = { ...unknownCurrent }
          else {
            const binding = { cli: worker.preference.cli, home: qoderHome, project: worker.project, sessionId, model, userMessageId: end.userMessageId }
            paths = qoderMeteringPaths(binding)
            const rawObservation = records.findLast(r => r.type === `cliworker.${worker.preference.cli}_context` &&
              r.source === `${worker.preference.cli}.native-transcript` && r.basis === 'native-ratio' && r.sessionId === sessionId &&
              r.model === model && r.userMessageId === end.userMessageId)
            const signature = () => `${stamp(input.rawPath)}|${sourceStamp(paths)}`
            const observation = (process.platform === 'win32'
              ? this.windowsObservation(key, signature(), signature, signal => readQoderDurableContextAsync(binding, { signal }))
              : readQoderDurableContext(binding)) ?? rawObservation
            if (observation) {
              const t = extractTelemetry(worker.preference.cli, [observation], { conversationId: sessionId, model, project: worker.project })
              if (t.contextRatio !== undefined) result = { contextRatio: t.contextRatio,
                contextSource: t.contextSource, contextEstimated: t.contextEstimated,
                ...(t.contextCapacity === undefined ? {} : { contextCapacity: t.contextCapacity,
                  contextUsed: t.contextUsed, contextCapacitySource: t.contextCapacitySource }) }
              if (t.providerCredits !== undefined) result.providerCredits = t.providerCredits
            }
          }
        }
      } else if (worker.preference.cli === 'zcode') {
        // Native starts carry their own selected provider/model; do not borrow
        // model from today's Worker settings or unrelated subsequent requests.
        const starts = records.map(r => r.method === 'session/event' ? { ...r.params, ...object(r.params) } : r)
          .filter(r => r.type === 'session.updated' && r.payload?.type === 'model_request_started' && r.payload.querySource === 'main_turn')
        const start = starts.at(-1), p = object(start?.payload)
        const boundSession = sessionId ?? start?.sessionId
        const model = text(p.providerId) && text(p.modelId) ? `${p.providerId}/${p.modelId}` : undefined
        const exactStart = text(boundSession) && model ? zcodeContextBinding(start, { sessionId: boundSession, model }) : undefined
        if (exactStart && !matchesCurrent(boundSession, model) && (!worker.conversationId || boundSession === worker.conversationId)) result = { ...unknownCurrent }
        if (text(boundSession) && model && matchesCurrent(boundSession, model) && (!worker.conversationId || boundSession === worker.conversationId)) {
          result = {}
          const bindings = zcodeContextBindings(records, { sessionId: boundSession, model })
          const binding = bindings.at(-1)
          if (binding) {
            paths = [native, join(native, 'storage'), join(native, 'storage', 'cli'), join(native, 'storage', 'cli', 'rollout'), join(native, 'storage', 'cli', 'rollout', `model-io-${boundSession}.jsonl`)]
            const rawObservation = records.findLast(r => r.type === 'cliworker.zcode_context_observation' &&
              r.sessionId === binding.sessionId && r.model === binding.model && r.requestId === binding.requestId &&
              r.turnId === binding.turnId && r.traceId === binding.traceId && r.source === 'zcode.native-model-io' && r.cli === 'zcode')
            // Raw unknown is authoritative too: a late disk write must not resurrect it.
            const observation = rawObservation ?? readZcodeContextInspections({ nativeDirectory: native, bindings: [binding] })[0]
            if (observation) {
              const b = observation.breakdown
              result.contextBreakdown = b && b.estimated === true && b.basis === 'zcode.estimateTokens.v1.actual-request' &&
                ['systemTokens', 'toolTokens', 'messageTokens'].every(k => Number.isSafeInteger(b[k]) && b[k] >= 0)
                ? { systemTokens: b.systemTokens, toolTokens: b.toolTokens, messageTokens: b.messageTokens,
                  estimated: true, source: 'ZCode 原生请求分类估算' } : undefined
            }
          }
        }
      } else {
        const end = records.map(r => r.result?.stopReason === 'end_turn' && text(r.result?._meta?.sessionId)
          ? { ...r.result, sessionId: r.result._meta.sessionId } : r)
          .findLast(r => (r.type === 'end' || r.stopReason === 'end_turn') && text(r.sessionId) && text(r._meta?.modelId) && id(r._meta?.promptId))
        const status = records.findLast(r => r.type === 'cliworker.grok_context' || r.method === '_x.ai/session_notification')
        const boundSession = sessionId ?? end?.sessionId ?? status?.params?.sessionId ?? status?.sessionId
        const model = declared?.model ?? end?._meta?.modelId ?? status?.modelId ?? status?.params?.update?.model?.id
        const exactGrokBinding = text(boundSession) && text(model) && (
          (end?.sessionId === boundSession && end?._meta?.modelId === model) || records.some(r =>
            (r.type === 'cliworker.grok_context' && r.sessionId === boundSession && r.modelId === model &&
              ['grok.session_status', 'grok.durable.updates'].includes(r.source) && r.basis === 'native-estimate' &&
              (r.contextUsed === null || (Number.isSafeInteger(r.contextUsed) && r.contextUsed >= 0))) ||
            !!grokContextStatus(r, { sessionId: boundSession, modelId: model, project: worker.project })))
        if (exactGrokBinding && !matchesCurrent(boundSession, model) && (!worker.conversationId || boundSession === worker.conversationId)) result = { ...unknownCurrent }
        if (text(boundSession) && text(model) && matchesCurrent(boundSession, model) && (!worker.conversationId || boundSession === worker.conversationId)) {
          result = {}
          const observations = records.map(r => r.type === 'cliworker.grok_context' && r.sessionId === boundSession && r.modelId === model &&
            ['grok.session_status', 'grok.durable.updates'].includes(r.source) && r.basis === 'native-estimate' ? r :
            grokContextStatus(r, { sessionId: boundSession, modelId: model, project: worker.project })).filter(Boolean)
          let observation = observations.filter(r => r.source === 'grok.session_status').at(-1) ?? observations.at(-1)
          if (!observation && end?.sessionId === boundSession && end._meta.modelId === model) {
            const project = realpathSync(worker.project)
            const home = join(native, 'grok', createHash('sha256').update(project).digest('hex'), 'home')
            const encoded = encodeURIComponent(project).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
            const dir = join(home, 'sessions', encoded, boundSession)
            paths = [home, join(home, 'sessions'), join(home, 'sessions', encoded), dir, ...['summary.json', 'updates.jsonl', 'signals.json'].map(name => join(dir, name))]
            const binding = { home, project, sessionId: boundSession, modelId: model, promptId: end._meta.promptId }
            const signature = () => `${stamp(input.rawPath)}|${sourceStamp(paths)}`
            observation = process.platform === 'win32'
              ? this.windowsObservation(key, signature(), signature, signal => readGrokDurableContextAsync(binding, undefined, { signal }))
              : readGrokDurableContext(binding)
          }
          if (observation) {
            const t = extractTelemetry('grok', [observation], { conversationId: boundSession, model, project: worker.project })
            result = { contextUsed: t.contextUsed, contextSource: t.contextSource, contextEstimated: t.contextEstimated,
              ...(t.contextCapacity !== undefined ? { contextCapacity: t.contextCapacity, contextCapacitySource: t.contextCapacitySource } : {}),
              ...(observation.contextUsed === null ? { contextBreakdown: undefined } : {}) }
          }
        }
      }
      const cached = { signature: `${rawSignature}|${sourceStamp(paths)}`, result, paths }
      // Capacity exhaustion is pending work, never a terminal unknown cache hit.
      if (this.capacityMisses.delete(key)) return { ...result }
      this.cache.set(key, cached)
      if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!)
      return { ...result }
    } catch { return {} }
  }
}
