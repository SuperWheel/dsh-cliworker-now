import { firstFreeAgentName, isDshAgentName } from '../shared/agent-names.ts'
import { workerNameKeys } from './roles.ts'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { CLI_SHORT_NAMES, cliOf, workerName, type Worker, type HarnessConversationBinding } from '../shared/types.ts'
import { bridgedFeatureSupport } from '../shared/conversation-features.ts'
import type { HarnessConversationRecord } from './harness-conversation-types.ts'

export interface ForkHistory {
  seed: readonly SessionEvent[]
  runId: string
  earlier: boolean
  turn: number
}
export interface NativeForkCut { turnId?: string; messageId?: string }
const forkStateSchema = z.object({
  nativeStateWorkerId: z.uuid().optional(),
  historySourceWorkerId: z.uuid().optional(),
  historySourceConversationId: z.string().min(1).optional(),
  sourceConversationId: z.string().min(1).optional(),
  sourceMessageId: z.string().min(1).optional(),
}).strict()
export type WorkerForkState = z.infer<typeof forkStateSchema>
const statePath = (directory: string, id: string) => join(directory, `${z.uuid().parse(id)}.fork.json`)
export function readWorkerForkState(directory: string, id: string): WorkerForkState | undefined {
  const path = statePath(directory, id)
  return existsSync(path) ? forkStateSchema.parse(JSON.parse(readFileSync(path, 'utf8'))) : undefined
}
export function writeWorkerForkState(directory: string, id: string, state?: WorkerForkState): void {
  const path = statePath(directory, id)
  if (!state || !Object.keys(state).length) { rmSync(path, { force: true }); return }
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(forkStateSchema.parse(state)), { mode: 0o600, flag: 'wx' })
    renameSync(temporary, path)
  } finally { rmSync(temporary, { force: true }) }
}

/** Harness assistant IDs identify a completed Harness turn, never a native CLI ID. */
export function selectForkHistory(
  events: readonly SessionEvent[], record: HarnessConversationRecord, atMessageId: string,
): ForkHistory {
  const completed = events.filter((event) => event.type === 'turn/end' && event.data.reason.kind === 'completed' &&
    record.turnRuns?.some((entry) => entry.turn === event.data.turn) && events.some((row) => row.type === 'assistant/message' && row.data.turn === event.data.turn))
  const latest = completed.at(-1)
  if (!latest || latest.type !== 'turn/end') throw new Error('尚无可分支的完成轮')
  const assistant = atMessageId
    ? events.find((event) => event.type === 'assistant/message' && event.data.message.id === atMessageId)
    : [...events].reverse().find((event) => event.type === 'assistant/message' && event.data.turn === latest.data.turn)
  if (!assistant || assistant.type !== 'assistant/message' || assistant.data.interrupted)
    throw new Error('分支截点必须是已完成轮的助手消息')
  const lastAssistant = events.filter((event) => event.type === 'assistant/message' && event.data.turn === assistant.data.turn).at(-1)
  const end = completed.find((event) => event.type === 'turn/end' && event.data.turn === assistant.data.turn)
  if (lastAssistant !== assistant || !end) throw new Error('分支截点必须是该完成轮的最后一条助手消息')
  const runs = record.turnRuns?.filter((entry) => entry.turn === assistant.data.turn)
  const runId = runs?.at(-1)?.runId
  if (!runId) throw new Error('该完成轮缺少可靠的 CLI 运行关联，无法分支')
  return { seed: structuredClone(events.filter((event) => event.seq <= end.seq)),
    runId, earlier: end !== latest, turn: assistant.data.turn }
}

/** Only native completion receipts from the exact saved run may become a fork cutoff. */
export function nativeForkCut(cli: string, raw: string, sourceId: string): NativeForkCut {
  const records = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line))
    .filter((frame) => frame.type === 'native').map((frame) => frame.record)
  if (cli === 'codex') {
    const turns = records.filter((row) => row.method === 'turn/completed' && row.params?.threadId === sourceId &&
      row.params?.turn?.status === 'completed' && typeof row.params.turn.id === 'string')
    if (turns.length !== 1) throw new Error('该轮缺少唯一的 Codex 原生完成轮 ID，无法分支')
    return { turnId: turns[0].params.turn.id }
  }
  if (cli === 'claude') {
    const message = records.filter((row) => row.type === 'assistant' && row.session_id === sourceId &&
      typeof row.uuid === 'string' && row.uuid.trim()).at(-1)
    if (!message) throw new Error('该轮缺少 Claude 原生助手消息 UUID，无法固定延迟分支截点')
    return { messageId: message.uuid }
  }
  throw new Error('当前 CLI 没有可靠的较早完成轮截点映射')
}

export function forkWorkerName(parent: Worker, workers: readonly Worker[], occupied?: ReadonlySet<string>): string {
  const base = workerName(parent)
  const stem = isDshAgentName(base) ? base : CLI_SHORT_NAMES[cliOf(parent.preference)]
  return firstFreeAgentName(`${stem.slice(0, 25)}-fork`, occupied ?? workerNameKeys(workers, parent.parentSessionId))
}

export interface ForkChild {
  binding: HarnessConversationBinding
  commit(): Promise<void>
  rollback(): Promise<void>
}
export interface WorkerForkDependencies {
  worker: Worker
  occupiedNames?(): ReadonlySet<string>
  workers(): readonly Worker[]
  assertIdle(): void
  history(atMessageId: string): Promise<ForkHistory>
  raw(runId: string): string
  rawSourceId?(runId: string): string
  native(cut: NativeForkCut): Promise<{ conversationId: string; rollback(): Promise<void> }>
  stage(worker: Worker): void
  child(worker: Worker, history: ForkHistory): Promise<ForkChild>
  publish(worker: Worker, history: ForkHistory, state?: WorkerForkState): void
  remove(worker: Worker): void
  changed(): void
  nativeStateWorkerId?: string
}

/** One transaction shared by Remote and /fork. No task is ever launched here. */
export async function forkWorkerConversation(deps: WorkerForkDependencies, atMessageId: string, signal: AbortSignal) {
  const source = structuredClone(deps.worker)
  deps.assertIdle()
  const support = bridgedFeatureSupport(source)
  if (!support.fork.supported) throw new Error(support.fork.reason)
  if (!source.conversationId || !source.harnessConversation) throw new Error('此 Worker 尚无可分支的原生会话')
  signal.throwIfAborted()
  const history = await deps.history(atMessageId)
  if (history.earlier && !support.forkEarlier.supported) throw new Error(support.forkEarlier.reason)
  const cli = cliOf(source.preference)
  if (history.runId !== source.runId && !['codex', 'claude'].includes(cli))
    throw new Error('当前 CLI 无法准确截取后续失败运行之前的最新完成轮，未创建分支')
  const cut = history.earlier || cli === 'claude' || cli === 'codex'
    ? nativeForkCut(cli, deps.raw(history.runId), deps.rawSourceId?.(history.runId) ?? source.conversationId) : {}
  signal.throwIfAborted()
  let native: Awaited<ReturnType<WorkerForkDependencies['native']>> | undefined
  let child: ForkChild | undefined
  let worker: Worker | undefined
  try {
    // Claude's fork occurs only on its first user turn. Pin its source UUID now,
    // so continuing the source before that turn cannot move the fork boundary.
    if (cli !== 'claude') native = await deps.native(cut)
    signal.throwIfAborted()
    const now = new Date().toISOString()
    worker = {
      id: randomUUID(), parentSessionId: source.parentSessionId, project: source.project,
      title: `${source.title.slice(0, 180)}·分支`, agentName: forkWorkerName(source, deps.workers(), deps.occupiedNames?.()), agentNameOrigin: 'custom',
      preference: structuredClone(source.preference), mode: source.mode, transport: source.transport,
      ...(source.role ? { role: structuredClone(source.role) } : {}),
      ...(source.goal ? { goal: { ...structuredClone(source.goal), revision: 1, updatedAt: now } } : {}),
      ...(native ? { conversationId: native.conversationId } : {}),
      status: 'completed', createdAt: now, updatedAt: now, runId: history.runId,
    }
    deps.stage(worker)
    child = await deps.child(worker, history)
    signal.throwIfAborted()
    worker.harnessConversation = child.binding
    const state: WorkerForkState = {
      historySourceWorkerId: source.id, historySourceConversationId: source.conversationId,
      // These CLIs persist sessions in the selected native root (Pi mappings,
      // OpenCode OPENCODE_DB, ZCode ZCODE_SESSION_DB_PATH). Forks live there too.
      ...(['pi', 'opencode', 'zcode'].includes(cli) ? { nativeStateWorkerId: deps.nativeStateWorkerId ?? source.id } : {}),
      ...(cli === 'claude' ? { sourceConversationId: source.conversationId, sourceMessageId: cut.messageId } : {}),
    }
    deps.publish(worker, history, Object.keys(state).length ? state : undefined)
    await child.commit()
    deps.changed()
    return { workerId: worker.id, childSessionId: child.binding.sessionId }
  } catch (error) {
    const issues: unknown[] = [error]
    // Cleanup is not cancelled by caller abort; preserve every failed cleanup report.
    if (child) try { await child.rollback() } catch (cleanup) { issues.push(cleanup) }
    if (worker) try { deps.remove(worker) } catch (cleanup) { issues.push(cleanup) }
    if (native) try { await native.rollback() } catch (cleanup) { issues.push(cleanup) }
    if (issues.length > 1) throw new AggregateError(issues, `会话分支失败；清理说明：${issues.slice(1).map(String).join('；')}`)
    throw error
  }
}
