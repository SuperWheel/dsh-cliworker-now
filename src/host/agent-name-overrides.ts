/**
 * Plugin-private name overlay (REQ-0138 §7, design 决定 2).
 *
 * DSH rc.5 has no in-place rename. Until `ctx.subagents.rename` exists, a renamed
 * child keeps its DSH catalog name (`registeredName`) and this file records the
 * effective name plus every former name, keyed by parent Session → child Session.
 * Nothing here is written to DSH session logs. Directory 0700, file 0600.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { agentNameKey, assertDshAgentName } from '../shared/agent-names.ts'
import { atomicJSON } from './storage.ts'

export const AGENT_NAME_OVERRIDES_FILE = 'agent-name-overrides.json'
/** Former names are kept forever (occupancy); this only bounds a corrupt or hostile file. */
const MAX_FORMER_NAMES = 512

const looseName = z.string().trim().min(1).max(200)
const entrySchema = z.object({
  /** Effective (display and addressing) name; always satisfies the DSH rule. */
  name: looseName,
  /** Name recorded in the DSH catalog when the override was written; DSH tools still use it. */
  registeredName: looseName.optional(),
  /** Earlier effective names in rename order, de-duplicated, never including `name`. */
  formerNames: z.array(looseName).max(MAX_FORMER_NAMES),
  /** 'worker' for a CLI Worker's display Session; 'native' for a DSH-created child (display only). */
  kind: z.enum(['worker', 'native']),
  updatedAt: z.string(),
})
const fileSchema = z.object({
  version: z.literal(1),
  parents: z.record(z.string(), z.record(z.string(), entrySchema)),
})
export type AgentNameOverride = z.infer<typeof entrySchema>
type OverrideFile = z.infer<typeof fileSchema>

export type OverrideLookup =
  | { kind: 'none' }
  | { kind: 'match'; childId: string; entry: AgentNameOverride; current: boolean }
  | { kind: 'ambiguous'; childIds: string[] }

export class AgentNameOverrides {
  private state?: OverrideFile
  private listeners = new Set<(parent: string) => void>()
  constructor(private directory: string) {}

  private read(): OverrideFile {
    if (!this.state) {
      const file = join(this.directory, AGENT_NAME_OVERRIDES_FILE)
      this.state = existsSync(file)
        ? fileSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
        : { version: 1, parents: Object.create(null) }
    }
    return this.state!
  }
  private commit(next: OverrideFile, parent: string) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    chmodSync(this.directory, 0o700)
    // Persist first; publish only a committed state.
    atomicJSON(join(this.directory, AGENT_NAME_OVERRIDES_FILE), next)
    this.state = next
    for (const notify of this.listeners) notify(parent)
  }

  parents(): string[] {
    return Object.keys(this.read().parents)
  }
  entries(parent: string): Readonly<Record<string, AgentNameOverride>> {
    return this.read().parents[parent] ?? {}
  }
  get(parent: string, childId: string): AgentNameOverride | undefined {
    return this.entries(parent)[childId]
  }
  /** Every current, former and registered name under `parent`, as {@link agentNameKey}s. */
  occupied(parent: string): Set<string> {
    const names = new Set<string>()
    for (const entry of Object.values(this.entries(parent))) {
      names.add(agentNameKey(entry.name))
      for (const former of entry.formerNames) names.add(agentNameKey(former))
      if (entry.registeredName) names.add(agentNameKey(entry.registeredName))
    }
    return names
  }
  /** Exact (case-insensitive) lookup by current or former name within one parent. */
  lookup(parent: string, name: string): OverrideLookup {
    const key = agentNameKey(name)
    const hits: { childId: string; entry: AgentNameOverride; current: boolean }[] = []
    for (const [childId, entry] of Object.entries(this.entries(parent))) {
      if (agentNameKey(entry.name) === key) hits.push({ childId, entry, current: true })
      else if (entry.formerNames.some((former) => agentNameKey(former) === key))
        hits.push({ childId, entry, current: false })
    }
    if (!hits.length) return { kind: 'none' }
    if (hits.length > 1) return { kind: 'ambiguous', childIds: hits.map((hit) => hit.childId) }
    return { kind: 'match', ...hits[0]! }
  }
  /** Map a DSH catalog name of a direct child of `parent` to its effective name, if overridden. */
  effectiveForRegistered(parent: string, registeredName: string): string | undefined {
    for (const entry of Object.values(this.entries(parent)))
      if (entry.registeredName === registeredName) return entry.name
    return undefined
  }

  /**
   * Record `name` as the effective name of `childId`. `expected` is the caller's view of
   * the current effective name; a mismatch means a concurrent rename and is rejected.
   * The previous effective name (and any `alsoFormer`) join `formerNames`.
   * Occupancy across siblings is the caller's responsibility (it needs Workers and the catalog).
   */
  set(
    parent: string,
    childId: string,
    input: {
      name: string
      expected: string
      registeredName?: string
      kind: AgentNameOverride['kind']
      alsoFormer?: readonly string[]
    },
  ): AgentNameOverride {
    assertDshAgentName(input.name)
    const state = this.read()
    const previous = state.parents[parent]?.[childId]
    const current = previous?.name ?? input.expected
    if (agentNameKey(current) !== agentNameKey(input.expected))
      throw new Error('名称已被其他操作修改，请刷新后重试')
    const former = [...(previous?.formerNames ?? []), ...(input.alsoFormer ?? []), current]
    const seen = new Set<string>([agentNameKey(input.name)])
    const formerNames: string[] = []
    for (const name of former) {
      const key = agentNameKey(name)
      if (seen.has(key)) continue
      seen.add(key)
      formerNames.push(name)
    }
    if (formerNames.length > MAX_FORMER_NAMES) throw new Error('改名次数已达上限')
    const entry: AgentNameOverride = {
      name: input.name,
      ...((previous?.registeredName ?? input.registeredName) !== undefined
        ? { registeredName: previous?.registeredName ?? input.registeredName }
        : {}),
      formerNames,
      kind: previous?.kind ?? input.kind,
      updatedAt: new Date().toISOString(),
    }
    const next: OverrideFile = {
      version: 1,
      parents: { ...state.parents, [parent]: { ...(state.parents[parent] ?? {}), [childId]: entry } },
    }
    this.commit(next, parent)
    return entry
  }

  /** Remove one entry (after an official migration was verified). */
  delete(parent: string, childId: string): void {
    const state = this.read()
    if (!state.parents[parent]?.[childId]) return
    const rest = { ...state.parents[parent] }
    delete rest[childId]
    const parents = { ...state.parents }
    if (Object.keys(rest).length) parents[parent] = rest
    else delete parents[parent]
    this.commit({ version: 1, parents }, parent)
  }

  subscribe(listener: (parent: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

/**
 * Names claimed by in-flight plugin creations and renames, per parent, from the
 * occupancy check until DSH commits the catalog row or the attempt fails.
 * The `tools/pre-execute` guard reads it so a native creation cannot take a name mid-flight.
 */
export class PendingAgentNames {
  private pending = new Map<string, Map<string, number>>()
  has(parent: string, name: string): boolean {
    return (this.pending.get(parent)?.get(agentNameKey(name)) ?? 0) > 0
  }
  keys(parent: string): Set<string> {
    return new Set(this.pending.get(parent)?.keys() ?? [])
  }
  /** Reserve; the returned release is idempotent. */
  reserve(parent: string, name: string): () => void {
    const key = agentNameKey(name)
    const names = this.pending.get(parent) ?? new Map<string, number>()
    names.set(key, (names.get(key) ?? 0) + 1)
    this.pending.set(parent, names)
    let released = false
    return () => {
      if (released) return
      released = true
      const count = (names.get(key) ?? 1) - 1
      if (count > 0) names.set(key, count)
      else names.delete(key)
      if (!names.size && this.pending.get(parent) === names) this.pending.delete(parent)
    }
  }
}

/**
 * Optional official in-place rename (future DSH). Detected structurally only;
 * the signature below is the plugin's proposal (`subagent/rename { childId, name }`)
 * and is exercised in tests with a simulated service.
 */
export interface OfficialSubagentRename {
  rename(request: {
    parentSessionId: string
    childSessionId: string
    name: string
    signal?: AbortSignal
  }): Promise<unknown> | unknown
}
export function officialRename(subagents: unknown): OfficialSubagentRename | undefined {
  return typeof subagents === 'object' &&
    subagents !== null &&
    'rename' in subagents &&
    typeof (subagents as { rename?: unknown }).rename === 'function'
    ? (subagents as OfficialSubagentRename)
    : undefined
}
