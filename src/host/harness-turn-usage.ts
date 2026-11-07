import { z } from 'zod'
import type { HarnessConversationRecord } from './harness-conversation-types.ts'
import type { ExternalRunTurnUsage, ExternalTurnUsage, NativeRunBuckets } from '../shared/native-turn-usage.ts'
import type { TokenUsage } from '../shared/telemetry.ts'
import type { Worker, WorkerEvent } from '../shared/types.ts'
import { cliOf } from '../shared/types.ts'
import { nativeUsageReport, type NativeUsageReport } from '../shared/native-usage-report.ts'
import { nativeTokenUsage } from '../shared/native-token-usage.ts'
import { nativeModelDisplay } from '../shared/native-model-display.ts'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'

const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const uuid = z.uuid()
const terminal = (value: unknown) => ['completed', 'failed', 'interrupted'].includes(String(value))

export interface HarnessTurnObservation {
  header: Pick<SessionHeader, 'id' | 'parentSession' | 'origin'>
  inheritedEventCount: number
  events: readonly SessionEvent[]
}

/** Read-only migration: accepted RPC identities and entered, closed turns are the only evidence. */
export function recoverHarnessTurnRuns(
  record: HarnessConversationRecord,
  worker: Worker,
  workerEvents: readonly WorkerEvent[],
  observation: HarnessTurnObservation,
): HarnessConversationRecord {
  if (record.workerId !== worker.id || record.parentSessionId !== worker.parentSessionId ||
    record.sessionId !== worker.harnessConversation?.sessionId ||
    worker.harnessConversation.parentSessionId !== record.parentSessionId ||
    observation.header.id !== record.sessionId || observation.header.parentSession !== record.parentSessionId ||
    observation.header.origin !== 'subagent' || !count(observation.inheritedEventCount)) return record
  const requestTurns = new Map<string, Set<number>>()
  const uncertainRequests = new Set<string>()
  let openTurn: number | undefined, openStep: number | undefined, previousSeq = -1
  let entered = new Set<string>()
  for (const event of observation.events.slice(observation.inheritedEventCount)) {
    if (!count(event.seq) || (previousSeq >= 0 && event.seq !== previousSeq + 1)) return record
    previousSeq = event.seq
    if (event.type === 'turn/start') {
      if (openTurn !== undefined || !count(event.data.turn)) return record
      openTurn = event.data.turn; entered = new Set()
    } else if (event.type === 'step/start') {
      if (openTurn !== event.data.turn || openStep !== undefined || !count(event.data.step)) return record
      openStep = event.data.step
    } else if (event.type === 'step/end') {
      if (openTurn !== event.data.turn || openStep !== event.data.step) return record
      openStep = undefined
    } else if (event.type === 'user/message') {
      const source = event.data.source
      if (source.kind === 'user' && 'rpcId' in source && typeof source.rpcId === 'string') {
        if (openTurn !== undefined && openStep !== undefined) entered.add(source.rpcId)
        else uncertainRequests.add(source.rpcId)
      }
    } else if (event.type === 'turn/end') {
      if (openTurn !== event.data.turn || openStep !== undefined) return record
      for (const id of entered) {
        const turns = requestTurns.get(id) ?? new Set<number>()
        turns.add(openTurn!); requestTurns.set(id, turns)
      }
      openTurn = undefined; entered = new Set()
    }
  }
  for (const id of entered) uncertainRequests.add(id)
  const batches = new Map<string, NonNullable<HarnessConversationRecord['nativeInputs']>>()
  for (const input of record.nativeInputs ?? []) {
    const entries = batches.get(input.batchId) ?? []
    entries.push(input); batches.set(input.batchId, entries)
  }
  const candidates = new Map<string, Set<number>>()
  const ended = new Set(workerEvents.filter((event) => event.kind === 'status' && terminal(event.state ?? event.text)).map((event) => event.runId))
  for (const [batchId, inputs] of batches) {
    if (inputs.some((input) => !input.accepted || input.steeringState || uncertainRequests.has(input.requestId))) continue
    const receipts = workerEvents.filter((event) => event.kind === 'user' && event.queuedFollowupId === batchId)
    if (!receipts.length || receipts.some((event) => event.admittedRunId !== event.runId || !uuid.safeParse(event.runId).success)) continue
    const runs = new Set(receipts.map((event) => event.runId))
    if (runs.size !== 1) continue
    const runId = [...runs][0]!
    if (!ended.has(runId)) continue
    const turns = inputs.map((input) => requestTurns.get(input.requestId))
    if (turns.some((value) => value?.size !== 1)) continue
    const allTurns = new Set(turns.flatMap((value) => [...value!]))
    if (allTurns.size !== 1) continue
    const found = candidates.get(runId) ?? new Set<number>()
    found.add([...allTurns][0]!); candidates.set(runId, found)
  }
  let recovered = record
  for (const [runId, turns] of candidates) {
    if (turns.size !== 1 || record.turnRuns?.some((entry) => entry.runId === runId)) continue
    recovered = bindHarnessTurnRun(recovered, [...turns][0]!, runId)
  }
  return recovered
}

/** The route calls this inside its serialized updateRecord transaction. */
export function bindHarnessTurnRun(record: HarnessConversationRecord, turn: number, runId: string): HarnessConversationRecord {
  if (!count(turn) || !uuid.safeParse(runId).success) throw new Error('CLI turn 与运行身份无效')
  const previous = record.turnRuns?.filter((entry) => entry.runId === runId)
  if (previous?.length) {
    if (previous.some((entry) => entry.turn !== turn)) throw new Error('同一 CLI run 不能绑定不同 Harness turn')
    return record
  }
  return { ...record, turnRuns: [...(record.turnRuns ?? []), { turn, runId }] }
}

/** No Session logs are rewritten. Missing aggregate sources preserve native response receipts. */
export function projectExternalTurnUsage(
  record: HarnessConversationRecord | undefined,
  worker: Worker,
  busy: boolean,
  events: readonly WorkerEvent[],
  readRunUsage: (runId: string) => TokenUsage | undefined,
  readRunCredits?: (runId: string) => number | undefined,
): ExternalTurnUsage {
  const result: Record<string, ExternalRunTurnUsage | null> = {}
  if (!record || record.workerId !== worker.id || record.parentSessionId !== worker.parentSessionId ||
    record.sessionId !== worker.harnessConversation?.sessionId ||
    worker.harnessConversation.parentSessionId !== worker.parentSessionId) return result
  const groups = new Map<number, Set<string>>()
  const runTurns = new Map<string, number>()
  const conflicts = new Set<number>()
  for (const { turn, runId } of record.turnRuns ?? []) {
    if (!count(turn) || !uuid.safeParse(runId).success) continue
    if (runTurns.has(runId) && runTurns.get(runId) !== turn) {
      conflicts.add(turn); conflicts.add(runTurns.get(runId)!)
    }
    runTurns.set(runId, turn)
    const runs = groups.get(turn) ?? new Set<string>()
    runs.add(runId); groups.set(turn, runs)
  }
  const ended = new Set(events.filter((event) => event.kind === 'status' && terminal(event.state ?? event.text)).map((event) => event.runId))
  for (const [turn, runIds] of groups) {
    if (conflicts.has(turn)) { result[String(turn)] = null; continue }
    const displayRoutes = [...new Set(events.filter(event => runIds.has(event.runId)).map(event =>
      nativeModelDisplay(cliOf(worker.preference), event.observedModel)).filter((value): value is string => value !== undefined))]
    const identity = { basis: 'external-run' as const, runIds: [...runIds], label: 'CLI 运行合计',
      ...(displayRoutes.length ? { displayRoutes } : {}) }
    // traecn uses reported token accounting below; it has no Qoder Credits path.
    if (['qoder', 'qodercn'].includes(cliOf(worker.preference)) && readRunCredits) {
      let credits: number | undefined = 0
      for (const runId of runIds) {
        if ((worker.runId === runId && busy) || !(ended.has(runId) || (worker.runId === runId && terminal(worker.status)))) {
          credits = undefined; break
        }
        let value: number | undefined
        try { value = readRunCredits(runId) } catch { /* Unreadable is unknown. */ }
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isFinite(credits + value)) {
          credits = undefined; break
        }
        credits += value
      }
      result[String(turn)] = { ...identity, usageUnit: 'credits', ...(credits === undefined ? {} : { credits }) }
      continue
    }
    const receipts: NativeRunBuckets[] = []
    const reports: NativeUsageReport[] = []
    let partial = false
    let invalid = false, missing = false
    for (const runId of runIds) {
      if ((worker.runId === runId && busy) ||
        !(ended.has(runId) || (worker.runId === runId && terminal(worker.status)))) { invalid = true; continue }
      let receipt: TokenUsage | undefined
      try { receipt = readRunUsage(runId) } catch { invalid = true; continue }
      // Qoder's ACP all-zero triple is a redacted/ambiguous counter. Do not
      // fall back to the native adapter's zero placeholder on older turns.
      if (!receipt) { if (['qoder', 'qodercn'].includes(cliOf(worker.preference))) invalid = true; else missing = true; continue }
      if (receipt.scope !== 'run') { invalid = true; continue }
      const buckets = nativeTokenUsage(cliOf(worker.preference), receipt)
      const report = nativeUsageReport(cliOf(worker.preference), receipt)
      if (report) reports.push(report)
      if (!buckets) {
        if (report) partial = true
        else invalid = true
        continue
      }
      if (receipt.reasoning !== undefined && (!count(receipt.reasoning) || receipt.reasoning > buckets.outputTokens)) { invalid = true; continue }
      const totalTokens = buckets.uncachedInputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
      if (!count(totalTokens)) { invalid = true; continue }
      receipts.push({ ...buckets, totalTokens, ...(receipt.reasoning !== undefined ? { reasoningTokens: receipt.reasoning } : {}) })
    }
    if (invalid) { result[String(turn)] = null; continue }
    if (missing) {
      if (displayRoutes.length) result[String(turn)] = { ...identity, nativeUsage: true }
      continue
    }
    if (partial) {
      if (reports.length !== runIds.size || reports.some((report) => report.inputBasis !== reports[0]!.inputBasis)) {
        result[String(turn)] = null; continue
      }
      const externalUsage: NativeUsageReport = { totalTokens: reports.reduce((sum, report) => sum + report.totalTokens, 0),
        inputBasis: reports[0]!.inputBasis }
      for (const field of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const)
        if (reports.every((report) => report[field] !== undefined))
          externalUsage[field] = reports.reduce((sum, report) => sum + report[field]!, 0)
      if (reports.some((report) => report.orchestration)) {
        externalUsage.orchestration = {}
        for (const field of ['input', 'output', 'cacheRead'] as const)
          if (reports.some((report) => report.orchestration?.[field] !== undefined))
            externalUsage.orchestration[field] = reports.reduce((sum, report) => sum + (report.orchestration?.[field] ?? 0), 0)
      }
      if (Object.entries(externalUsage).some(([key, value]) => key !== 'inputBasis' && key !== 'orchestration' && !count(value)) ||
        Object.values(externalUsage.orchestration ?? {}).some((value) => !count(value))) { result[String(turn)] = null; continue }
      result[String(turn)] = { ...identity, externalUsage }
      continue
    }
    if (receipts.length !== runIds.size) continue
    const usage: NativeRunBuckets = { uncachedInputTokens: 0, outputTokens: 0, totalTokens: 0 }
    usage.uncachedInputTokens = receipts.reduce((sum, receipt) => sum + receipt.uncachedInputTokens, 0)
    usage.outputTokens = receipts.reduce((sum, receipt) => sum + receipt.outputTokens, 0)
    usage.totalTokens = receipts.reduce((sum, receipt) => sum + receipt.totalTokens, 0)
    for (const field of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const)
      if (receipts.every((receipt) => receipt[field] !== undefined))
        usage[field] = receipts.reduce((sum, receipt) => sum + receipt[field]!, 0)
    if (!Object.values(usage).every(count)) { result[String(turn)] = null; continue }
    result[String(turn)] = { ...identity, usage }
  }
  return result
}
