import { agentNameKey, assertDshAgentName, firstFreeAgentName } from '../shared/agent-names.ts'
import { AgentNameOverrides, PendingAgentNames, officialRename, type AgentNameOverride } from './agent-name-overrides.ts'
import { renameThroughOfficial } from './agent-name-official.ts'
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
import { DSH_AGENT_NAME, workerName, type DshSubagent, type Worker } from '../shared/types.ts'
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
  namesChanged?(): void
  workers?(parent: string): Iterable<Worker>
  relatedSessions?(workerId: string): readonly string[]
  workerNames?(parent: string, excludingId?: string): Set<string>
  reconcile?(parent: string, catalog: readonly NamedChild[]): void
  assertLiveChild?(parent: string, id: string): void
  /** Undefined means this host has no public event source. */
  subscribe?(notify: (sessionId: string) => void): () => void
  log(reason: string): void
}
type NamedChild = SubagentCatalogEntry & { name?: string; formerNames?: readonly string[] }
type ChildNames = Pick<AgentNameOverride, 'name' | 'registeredName' | 'formerNames' | 'kind'> & { overridden?: true }

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
    if (!Array.isArray(catalog)) throw new Error('DSH public catalog projection unavailable')
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
  private catalogs = new Map<string, readonly NamedChild[]>()
  private catalogVersion = 0
  private cachedVersions = new Map<string, number>()
  private releaseOverrides: () => void
  private committingOverride = false
  private renaming = new Map<string, Set<string>>()
  constructor(
    private directory: string,
    private services: DshSubagentServices,
    readonly overrides = new AgentNameOverrides(directory),
    readonly pending = new PendingAgentNames(),
  ) {
    this.releaseOverrides = overrides.subscribe(() => {
      if (!this.committingOverride) this.notifyNamesChanged()
    })
  }

  private notifyNamesChanged(notifyWorkers = true) {
    if (notifyWorkers) this.services.namesChanged?.()
    this.listeners.forEach(notify => notify())
  }
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
  /** Allocation includes hidden, retired and plugin-owned entries of this parent. */
  occupiedNames(parent: string, excludingChild?: string, excludingWorker?: string, includePending = true): Set<string> {
    const names = this.services.workerNames?.(parent, excludingWorker) ?? new Set<string>()
    const excluded = new Set(excludingWorker ? this.services.relatedSessions?.(excludingWorker) : [])
    if (excludingChild) excluded.add(excludingChild)
    if (includePending) for (const key of this.pending.keys(parent)) names.add(key)
    for (const [id, entry] of Object.entries(this.overrides.entries(parent))) {
      if (excluded.has(id)) continue
      for (const name of [entry.name, entry.registeredName, ...entry.formerNames]) {
        if (name) names.add(agentNameKey(name))
      }
    }
    for (const child of this.catalogs.get(parent) ?? []) {
      if (excluded.has(child.id)) continue
      for (const name of [child.name, ...(child.formerNames ?? [])]) if (name) names.add(agentNameKey(name))
    }
    for (const [id, name] of Object.entries(this.readNames()[parent] ?? {})) {
      if (!excluded.has(id)) names.add(agentNameKey(name))
    }
    return names
  }

  private cacheCatalog(parent: string, catalog: readonly NamedChild[]) {
    this.catalogs.set(parent, catalog)
    const current = this.readNames()[parent] ?? {}
    const owned = this.services.ownedSessions()
    const missing = catalog.filter(child => !child.name && !current[child.id] && !this.isInternalSession(child, owned))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    if (missing.length) {
      const taken = this.occupiedNames(parent)
      const named = { ...current }
      for (const child of missing) {
        named[child.id] = firstFreeAgentName('dsh', taken)
        taken.add(named[child.id]!)
      }
      const all = { ...this.readNames(), [parent]: named }
      this.persist('dsh-names.json', all)
      this.names = all
    }
    this.services.reconcile?.(parent, catalog)
    return catalog
  }

  async readDirectoryNames(parent: string, caller: AbortSignal): Promise<readonly NamedChild[]> {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    signal.throwIfAborted()
    const version = ++this.catalogVersion
    const query = this.services.query()
    let catalog: SubagentCatalogEntry[] = []
    if (query) {
      try {
        catalog = await readDshChildren(query, parent, signal)
      } catch (error) {
        signal.throwIfAborted()
        throw new Error('无法读取 DSH 子 Agent 目录，请重试；任务尚未启动', { cause: error })
      }
    }
    signal.throwIfAborted()
    if ((this.cachedVersions.get(parent) ?? 0) > version) return this.catalogs.get(parent)!
    this.cachedVersions.set(parent, version)
    return this.cacheCatalog(parent, catalog)
  }

  private async catalog(parent: string, signal: AbortSignal) {
    if (!parent.trim()) throw new Error('DSH 主会话无效')
    if (!this.services.subagents() || !this.services.query()) throw new Error('DSH subagents/sessionQuery service unavailable')
    return this.readDirectoryNames(parent, signal)
  }

  private childNames(parent: string, child: NamedChild): ChildNames {
    const override = this.overrides.get(parent, child.id)
    const old = this.readNames()[parent]?.[child.id]
    const name = override?.name ?? child.name ?? old ?? child.id
    const formerNames = [...new Set([...(override?.formerNames ?? []), ...(child.formerNames ?? []), old, child.name, override?.registeredName]
      .filter((former): former is string => !!former && former !== name))]
    return {
      name, formerNames,
      ...(override ? { overridden: true as const, registeredName: child.name ?? override.registeredName } : {}),
      kind: override?.kind ?? (this.isInternalSession(child) ? 'worker' : 'native'),
    }
  }

  async agentNames(parent: string, signal: AbortSignal): Promise<string> {
    const catalog = await this.readDirectoryNames(parent, signal)
    const entries = new Map<string, ChildNames>()
    const workers = new Map<string, Worker>()
    for (const worker of this.services.workers?.(parent) ?? []) {
      const id = worker.harnessConversation?.sessionId
      if (id && worker.parentSessionId === parent) {
        workers.set(id, worker)
        entries.set(id, { name: workerName(worker), formerNames: worker.nameAliases ?? [], kind: 'worker' })
      }
    }
    for (const [id, { name, formerNames, registeredName, kind }] of Object.entries(this.overrides.entries(parent)))
      entries.set(id, { name, formerNames, registeredName, kind, overridden: true })
    for (const child of catalog) {
      const names = this.childNames(parent, child)
      const worker = workers.get(child.id)
      if (worker) {
        names.name = this.overrides.get(parent, child.id)?.name ?? child.name ?? workerName(worker)
        names.formerNames = [...new Set([...names.formerNames, ...(worker.nameAliases ?? [])])].filter(alias => alias !== names.name)
      }
      entries.set(child.id, names)
    }
    return JSON.stringify(Object.fromEntries(entries))
  }

  boundNames(parent: string, childId: string) {
    const child = this.catalogs.get(parent)?.find(entry => entry.id === childId)
    const override = this.overrides.get(parent, childId)
    return {
      registeredName: child?.name ?? override?.registeredName,
      formerNames: [...(override?.formerNames ?? []), ...(child?.formerNames ?? [])],
      effective: override?.name ?? child?.name,
    }
  }

  /** The caller captures expected before reading the directory. Hold the target and new name
   * across an asynchronous official rename, then commit the Worker's derived record. */
  async renameBound(parent: string, childId: string, input: {
    name: string; expected: string; kind: ChildNames['kind']; workerId?: string; aliases?: string[]
  }, caller: AbortSignal, commit?: () => void) {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    signal.throwIfAborted()
    const { name, expected, kind, workerId, aliases } = input
    const { registeredName, effective } = this.boundNames(parent, childId)
    const held = this.renaming.get(parent) ?? new Set<string>()
    if (held.has(childId) || (effective && effective !== expected))
      throw new Error('名称已被其他操作修改，请刷新后重试')
    if (name === expected) return
    assertDshAgentName(name)
    if (this.occupiedNames(parent, childId, workerId).has(agentNameKey(name)))
      throw new Error('当前对话已有同名智能体，请换一个名称')
    this.renaming.set(parent, held)
    held.add(childId)
    const release = this.pending.reserve(parent, name)
    try {
      const official = officialRename(this.services.subagents())
      const prior = this.overrides.get(parent, childId)
      if (official) {
        await renameThroughOfficial(official, { parentSessionId: parent, childSessionId: childId, name, signal })
        signal.throwIfAborted()
        const catalog = this.catalogs.get(parent) ?? []
        this.catalogs.set(parent, catalog.map(child => child.id !== childId ? child : {
          ...child, name, formerNames: [...new Set([...(child.formerNames ?? []), expected])],
        }))
        this.cachedVersions.set(parent, ++this.catalogVersion)
      }
      this.committingOverride = true
      try {
        // An existing compatibility entry may still own historical names that the
        // official service cannot represent. Advance it only after official acceptance.
        if (!official || prior || (aliases?.length ?? 0) > 32) this.overrides.set(parent, childId, { name, expected, registeredName, kind, alsoFormer: aliases })
        try {
          commit?.()
        } catch (error) {
          if (!official) {
            // A failed derived Worker write must not publish or reserve the attempted name.
            this.overrides.delete(parent, childId)
            if (prior) this.overrides.set(parent, childId, {
              ...prior, expected: prior.name, alsoFormer: prior.formerNames,
            })
          }
          throw error
        }
      } finally {
        this.committingOverride = false
      }
      this.notifyNamesChanged(!commit)
    } finally {
      release()
      held.delete(childId)
      if (!held.size) this.renaming.delete(parent)
    }
  }

  async rename(parent: string, id: string, name: string, caller: AbortSignal) {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    const before = this.overrides.get(parent, id)?.name
    const child = await this.requireChild(parent, id, signal)
    const expected = before ?? child.name ?? this.readNames()[parent]?.[id] ?? id
    await this.renameBound(parent, id, { name, expected, kind: 'native' }, signal)
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
        hidden = this.readHidden()[parent] ?? []
      const rows: DshSubagent[] = []
      for (const child of catalog) {
        if (this.isInternalSession(child, owned) || hidden.includes(child.id)) continue
        const names = this.childNames(parent, child)
        const row: DshSubagent = {
          id: child.id,
          parentSessionId: parent,
          name: child.label || child.id,
          agentName: names.name,
          registeredName: names.registeredName,
          formerNames: names.formerNames,
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
  private assertVisible(parent: string, child: NamedChild | undefined): asserts child is NamedChild {
    if (!child || this.isInternalSession(child) || this.readHidden()[parent]?.includes(child.id))
      throw new Error('DSH 子 Agent 不在当前主会话列表中')
  }
  private async requireChild(parent: string, id: string, signal: AbortSignal, writable = false) {
    const child = (await this.catalog(parent, signal)).find((entry) => entry.id === id)
    this.assertVisible(parent, child)
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
  async resolve(parent: string, ref: { id?: string; name?: string }, caller: AbortSignal) {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    const catalog = await this.catalog(parent, signal)
    const wanted = ref.name && agentNameKey(ref.name)
    const id = ref.id && agentNameKey(ref.id)
    const matches = catalog.filter(child => {
      if (id && agentNameKey(child.id) !== id) return false
      if (!wanted) return !!ref.id
      const names = this.childNames(parent, child)
      return [names.name, ...names.formerNames].some(name => agentNameKey(name) === wanted)
    })
    if (matches.length > 1) throw new Error('智能体名称不唯一，请使用 worker_id')
    if (!matches.length) return undefined
    const child = matches[0]!
    this.assertVisible(parent, child)
    if (!id && wanted && this.services.workerNames?.(parent).has(wanted))
      throw new Error('智能体名称不唯一，请使用 worker_id')
    return { id: child.id, agentName: this.childNames(parent, child).name, mode: child.mode, title: child.label || child.id }
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
  async *watch(parent: string, caller: AbortSignal, namesOnly = false): AsyncIterable<string> {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    let dirty = true,
      wake: (() => void) | undefined
    let children = new Set<string>()
    let lastNames: string | undefined
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
        if (namesOnly) {
          const next = await this.agentNames(parent, signal)
          if (next === lastNames) continue
          lastNames = next
          yield next
          continue
        }
        const rows = await this.list(parent, signal)
        children = new Set(rows.map((row) => row.id))
        yield JSON.stringify(rows)
      }
    } finally {
      release()
    }
  }
  dispose() {
    this.releaseOverrides()
    this.lifetime.abort()
    for (const release of this.cleanups) release()
    this.listeners.clear()
    this.stopped.clear()
  }
}
