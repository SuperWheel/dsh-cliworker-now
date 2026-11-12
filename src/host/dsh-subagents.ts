import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  SubagentRuntime,
  SubagentCatalogEntry,
  SubagentTimingProjection,
  SubagentPromptRequest,
} from '@deepseek-ai/dsh-subagent'
import { DSH_AGENT_NAME, type DshSubagent, type Worker } from '../shared/types.ts'
import type { HarnessConversationRecord } from './harness-conversation-types.ts'
import { atomicJSON } from './storage.ts'

/** Narrow public SessionQuery observation; reading projections never copies the log. */
export interface DshObservation extends Disposable {
  header: { origin?: string; parentSession?: string }
  cursor: number
  projections?: {
    values: {
      subagentCatalog?: SubagentCatalogEntry[]
      subagentTiming?: SubagentTimingProjection
      modelSelection?: { next: { model: string } | null; lastUsed: { model: string } | null }
    }
  }
}
export interface DshSubagentServices {
  subagents(): Pick<SubagentRuntime, 'prompt' | 'interruptByUser'> | undefined
  query():
    | { observeSession(id: SessionId, options: { signal: AbortSignal }): Promise<DshObservation> }
    | undefined
  ownedSessions(): ReadonlySet<string>
  /** All stored Workers, including archived Workers and Workers of other parents. */
  hasWorker(id: string): boolean
  assertLiveChild?(parent: string, id: string): void
  /** Undefined means this host has no public event source. */
  subscribe?(notify: (sessionId: string) => void): () => void
  log(reason: string): void
}
/** Current and replaced display Sessions remain plugin-owned across segment changes. */
export function ownedHarnessSessions(
  workers: Iterable<Pick<Worker, 'harnessConversation'>>,
  records: readonly Pick<HarnessConversationRecord, 'sessionId' | 'retiredSessionIds'>[] = [],
): ReadonlySet<string> {
  return new Set([
    ...[...workers].flatMap(worker => worker.harnessConversation ? [worker.harnessConversation.sessionId] : []),
    ...records.flatMap(record => [record.sessionId, ...(record.retiredSessionIds ?? [])]),
  ])
}
/** rc.2 list-children.ts reads this public projection; preserve direct rows and createdAt. */
export async function readDshChildren(
  query: ReturnType<DshSubagentServices['query']>, parent: string, signal: AbortSignal,
): Promise<SubagentCatalogEntry[]> {
  if (!query) throw new Error('DSH sessionQuery service unavailable')
  signal.throwIfAborted()
  const observation = await query.observeSession(SessionId(parent), { signal })
  try {
    signal.throwIfAborted()
    if (observation.header.origin === 'subagent') throw new Error('DSH 目录只接受主会话')
    const catalog = observation.projections?.values.subagentCatalog
    if (!catalog) throw new Error('DSH public catalog projection unavailable')
    return catalog
  } finally {
    observation[Symbol.dispose]()
  }
}
const hiddenSchema = z.record(z.string(), z.array(z.string()))
const namesSchema = z.record(z.string(), z.record(z.string(), z.string().regex(DSH_AGENT_NAME)))
export function dshStatus(timing?: SubagentTimingProjection): DshSubagent['status'] {
  if (timing?.active) return 'running'
  if (timing?.lastTurnCompleted === true) return 'completed'
  if (timing?.lastTurnCompleted === false) return 'failed'
  return 'unknown'
}

/** Native children remain DSH-owned. Only the hidden directory is written here. */
export class DshSubagents {
  private hidden?: Record<string, string[]>
  private names?: Record<string, Record<string, string>>
  private lifetime = new AbortController()
  private listeners = new Set<() => void>()
  private cleanups = new Set<() => void>()
  private stopped = new Map<string, number>()
  private warned = new Set<string>()
  constructor(
    private directory: string,
    private services: DshSubagentServices,
  ) {}
  private warn(reason: string) {
    if (this.warned.has(reason)) return
    this.warned.add(reason)
    this.services.log(reason)
  }
  private readHidden() {
    if (!this.hidden) {
      const file = join(this.directory, 'dsh-hidden.json')
      this.hidden = existsSync(file)
        ? hiddenSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
        : Object.create(null)
    }
    return this.hidden!
  }
  private readNames() {
    if (!this.names) {
      const file = join(this.directory, 'dsh-names.json')
      this.names = existsSync(file)
        ? namesSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
        : Object.create(null)
    }
    return this.names!
  }
  private persist(file: string, value: unknown) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    chmodSync(this.directory, 0o700)
    atomicJSON(join(this.directory, file), value)
  }
  private isInternalSession(
    child: Pick<SubagentCatalogEntry, 'id' | 'label'>,
    owned = this.services.ownedSessions(),
  ): boolean {
    if (owned.has(child.id)) return true
    // A label alone is not ownership: match the entire label and a stored Worker ID.
    const workerId = /^worker\/([^/]+)$/u.exec(child.label ?? '')?.[1]
    return workerId !== undefined && this.services.hasWorker(workerId)
  }
  /** Stable `dsh-N` per main conversation in creation order; hidden children keep theirs so names never move. */
  private nameChildren(parent: string, catalog: readonly SubagentCatalogEntry[], owned = this.services.ownedSessions()) {
    const current = this.readNames()[parent] ?? {}
    const missing = catalog
      .filter((child) => !current[child.id] && !this.isInternalSession(child, owned))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    if (!missing.length) return current
    let next = Math.max(0, ...Object.values(current).map((name) => Number(name.slice(4))))
    const named = { ...current }
    for (const child of missing) named[child.id] = `dsh-${++next}`
    const all = { ...this.readNames(), [parent]: named }
    this.persist('dsh-names.json', all)
    this.names = all
    return named
  }
  private async catalog(parent: string, signal: AbortSignal) {
    if (!parent.trim()) throw new Error('DSH 主会话无效')
    const service = this.services.subagents(),
      query = this.services.query()
    if (!service || !query) throw new Error('DSH subagents/sessionQuery service unavailable')
    return readDshChildren(query, parent, signal)
  }

  private async projection(id: string, parent: string, signal: AbortSignal) {
    const query = this.services.query()
    if (!query) throw new Error('DSH public projections unavailable')
    const observation = await query.observeSession(SessionId(id), { signal })
    try {
      if (observation.header.origin !== 'subagent' || observation.header.parentSession !== parent)
        throw new Error('DSH 子会话所属主对话不匹配')
      if (!observation.projections) throw new Error('DSH public projections unavailable')
      return { ...observation.projections.values, cursor: observation.cursor }
    } finally {
      observation[Symbol.dispose]()
    }
  }
  async list(parent: string, caller: AbortSignal): Promise<DshSubagent[]> {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    try {
      signal.throwIfAborted()
      const catalog = await this.catalog(parent, signal)
      const owned = this.services.ownedSessions(),
        hidden = this.readHidden()[parent] ?? [],
        names = this.nameChildren(parent, catalog, owned)
      const rows: DshSubagent[] = []
      for (const child of catalog) {
        if (this.isInternalSession(child, owned) || hidden.includes(child.id)) continue
        const row: DshSubagent = {
          id: child.id,
          parentSessionId: parent,
          name: child.label || child.id,
          agentName: names[child.id]!,
          createdAt: child.createdAt,
          mode: child.mode,
          status: 'unknown',
        }
        if (child.mode !== 'external') {
          try {
            const projection = await this.projection(child.id, parent, signal)
            row.status = dshStatus(projection.subagentTiming)
            row.model = (projection.modelSelection?.next ?? projection.modelSelection?.lastUsed)?.model
            row.stopped =
              (this.stopped.get(child.id) === projection.cursor && row.status !== 'running') || undefined
            if (!row.stopped) this.stopped.delete(child.id)
          } catch {
            signal.throwIfAborted()
            this.warn('DSH child projection unavailable; status remains unknown')
          }
        }
        rows.push(row)
      }
      signal.throwIfAborted()
      return rows
    } catch (error) {
      signal.throwIfAborted()
      // Never include native content or raw service errors in logs.
      this.warn(
        error instanceof Error && /unavailable/.test(error.message)
          ? 'DSH directory service/projection unavailable; returning an empty group'
          : 'DSH directory read failed; returning an empty group',
      )
      return []
    }
  }
  private async requireChild(parent: string, id: string, signal: AbortSignal, writable = false) {
    const child = (await this.catalog(parent, signal)).find((entry) => entry.id === id)
    if (!child || this.isInternalSession(child) || this.readHidden()[parent]?.includes(id))
      throw new Error('DSH 子 Agent 不在当前主会话列表中')
    if (writable) {
      if (child.mode !== 'continuable') throw new Error('此 DSH 子 Agent 只读')
      // User interruption no longer checks a supplied parent address in rc.2.
      // Validate durable direct lineage and live ownership before either mutation.
      await this.projection(id, parent, signal)
      this.services.assertLiveChild?.(parent, id)
    }
    return child
  }
  async prompt(parent: string, request: SubagentPromptRequest, caller: AbortSignal) {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    await this.requireChild(parent, request.childSessionId, signal, true)
    signal.throwIfAborted()
    return this.services.subagents()!.prompt(request, signal)
  }
  /** Exact `dsh-N` (case-insensitive) or child ID among this conversation's visible native children. */
  async resolve(parent: string, ref: { id?: string; name?: string }, caller: AbortSignal) {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    const catalog = await this.catalog(parent, signal)
    const names = this.nameChildren(parent, catalog)
    const wanted = ref.name?.trim().toLowerCase()
    const id = ref.id ?? Object.keys(names).find((key) => names[key] === wanted)
    if (!id || !catalog.some((entry) => entry.id === id) || (ref.id && wanted && names[ref.id] !== wanted)) return undefined
    const child = await this.requireChild(parent, id, signal)
    return { id: child.id, agentName: names[child.id]!, mode: child.mode, title: child.label || child.id }
  }
  /** Main-agent follow-up by name. The reply arrives through DSH's own child→parent message. */
  async followup(parent: string, ref: { id?: string; name?: string }, text: string, caller: AbortSignal) {
    const child = await this.resolve(parent, ref, caller)
    if (!child) return undefined
    if (child.mode !== 'continuable') throw new Error('此 DSH 子 Agent 只读')
    const receipt = await this.prompt(parent, {
      childSessionId: SessionId(child.id),
      requestId: randomUUID() as SubagentPromptRequest['requestId'],
      delivery: 'queue', content: [{ type: 'text', text }],
    }, caller)
    return { kind: 'dsh-subagent' as const, workerId: child.id, agentName: child.agentName, title: child.title, receipt,
      guidance: '已交给 DSH 原生子 Agent；回复会以 DSH 子 Agent 消息回到本对话，不需要轮询。' }
  }
  async hide(parent: string, id: string, caller: AbortSignal) {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    await this.requireChild(parent, id, signal)
    signal.throwIfAborted()
    const current = this.readHidden()
    const next = { ...current, [parent]: [...new Set([...(current[parent] ?? []), id])] }
    this.persist('dsh-hidden.json', next)
    this.hidden = next
    this.listeners.forEach((notify) => notify())
  }
  async stop(parent: string, id: string, caller: AbortSignal): Promise<{ stopped: true }> {
    // Bound an unconfirmed stop; a timeout is an error, never success.
    const timeout = new AbortController()
    const deadline = setTimeout(() => timeout.abort(new Error('DSH 停止尚未确认，请重试')), 30_000)
    const signal = AbortSignal.any([caller, this.lifetime.signal, timeout.signal])
    try {
      await this.requireChild(parent, id, signal, true)
      signal.throwIfAborted()
      const receipt = this.services
        .subagents()!
        .interruptByUser(SessionId(id))
      if (!receipt.accepted) throw new Error('DSH 中断请求未获确认')
      // Re-read immutable public cuts until the turn is demonstrably closed. An
      // absent child, absent timing or inactive directory row is not proof.
      while (true) {
        signal.throwIfAborted()
        const projection = await this.projection(id, parent, signal)
        const state = dshStatus(projection.subagentTiming)
        if (state === 'completed' || state === 'failed') {
          signal.throwIfAborted()
          this.stopped.set(id, projection.cursor)
          this.listeners.forEach((notify) => notify())
          return { stopped: true }
        }
        await new Promise<void>((resolve, reject) => {
          const finish = () => {
            clearTimeout(timer)
            signal.removeEventListener('abort', abort)
            resolve()
          }
          const abort = () => {
            clearTimeout(timer)
            signal.removeEventListener('abort', abort)
            reject(signal.reason)
          }
          const timer = setTimeout(finish, 100)
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
        })
      }
    } finally {
      clearTimeout(deadline)
    }
  }
  /** The client owns this stream only while its panel/document is visible. */
  async *watch(parent: string, caller: AbortSignal): AsyncIterable<string> {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    let dirty = true,
      wake: (() => void) | undefined
    let children = new Set<string>()
    const notify = () => {
      dirty = true
      wake?.()
    }
    const unsubscribe = this.services.subscribe?.((id) => {
      if (id === parent || children.has(id)) notify()
    })
    const timer = unsubscribe ? undefined : setInterval(notify, 2000)
    this.listeners.add(notify)
    signal.addEventListener('abort', notify)
    let released = false
    const release = () => {
      if (released) return
      released = true
      unsubscribe?.()
      clearInterval(timer)
      this.listeners.delete(notify)
      signal.removeEventListener('abort', notify)
      this.cleanups.delete(release)
    }
    this.cleanups.add(release)
    try {
      while (!signal.aborted) {
        if (!dirty)
          await new Promise<void>((resolve) => {
            wake = resolve
          })
        wake = undefined
        if (signal.aborted) return
        dirty = false
        const rows = await this.list(parent, signal)
        children = new Set(rows.map((row) => row.id))
        yield JSON.stringify(rows)
      }
    } finally {
      release()
    }
  }
  dispose() {
    this.lifetime.abort()
    for (const release of this.cleanups) release()
    this.listeners.clear()
    this.stopped.clear()
  }
}
