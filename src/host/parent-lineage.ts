import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Which earlier parent Sessions continue as `parent` (Issue #10). A host that
 * moves a long conversation to a fresh root Session archives the old one, so a
 * Worker bound to it would otherwise be unreachable.
 */
export interface ParentLineage {
  /** Other segments of the one chain whose current segment is `parent`; undefined when unproven. */
  formerSegments(parent: string): ReadonlySet<string> | undefined
}

/** DS Bot rewrites the whole team file; anything larger is not a state file we trust. */
const MAX_STATE_BYTES = 64 * 1024 * 1024
const MAX_ID = 256

interface Chain {
  current: string
  members: Set<string>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_ID

/** Segment lists hold `{ sessionId }` entries; a malformed entry invalidates the chain. */
function segmentIds(value: unknown): string[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const ids: string[] = []
  for (const entry of value) {
    if (!isRecord(entry) || !isId(entry.sessionId)) return undefined
    ids.push(entry.sessionId)
  }
  return ids
}

function chain(current: unknown, ...lists: Array<string[] | undefined>): Chain | undefined {
  if (!isId(current) || lists.some((list) => list === undefined)) return undefined
  return { current, members: new Set([current, ...lists.flat() as string[]]) }
}

/**
 * Chains of a DS Bot `state.json` (Fei2411/DS-Bot `src/host/store.js`):
 * a Bot's own chat, each member's Session in a group, and a group's own Session.
 * Ids claimed by two chains drop both chains, so a mismatch never widens access.
 */
export function dsBotChains(state: unknown): Chain[] {
  if (!isRecord(state) || state.version !== 1) return []
  const chains: Chain[] = []
  if (state.bots !== undefined && !isRecord(state.bots)) return []
  for (const bot of Object.values(state.bots ?? {})) {
    if (!isRecord(bot) || !isId(bot.id)) continue
    const found = chain(bot.sessionId ?? bot.id, [bot.id], segmentIds(bot.segments))
    if (found) chains.push(found)
  }
  if (state.rooms !== undefined && !isRecord(state.rooms)) return []
  for (const room of Object.values(state.rooms ?? {})) {
    if (!isRecord(room) || !isId(room.id)) continue
    const own = chain(room.sessionId ?? room.id, [room.id], segmentIds(room.parts))
    if (own) chains.push(own)
    if (room.sessions !== undefined && !isRecord(room.sessions)) continue
    const segments = isRecord(room.segments) ? room.segments : {}
    for (const [botId, sessionId] of Object.entries(room.sessions ?? {})) {
      const member = chain(sessionId, segmentIds(segments[botId]))
      if (member) chains.push(member)
    }
  }
  const owners = new Map<string, number>()
  for (const found of chains) for (const id of found.members) owners.set(id, (owners.get(id) ?? 0) + 1)
  return chains.filter((found) => [...found.members].every((id) => owners.get(id) === 1))
}

/** Read-only view of DS Bot's team file, re-parsed only when its mtime or size changes. */
export class DsBotLineage implements ParentLineage {
  private stamp = ''
  private chains: Chain[] = []
  constructor(
    readonly path = join(resolve(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')), 'bot', 'state.json'),
  ) {}
  formerSegments(parent: string): ReadonlySet<string> | undefined {
    const found = this.load().find((entry) => entry.current === parent)
    if (!found || found.members.size < 2) return undefined
    const former = new Set(found.members)
    former.delete(parent)
    return former
  }
  private load(): Chain[] {
    let stamp: string
    let size: number
    try {
      const stat = statSync(this.path)
      if (!stat.isFile()) return this.reset()
      size = stat.size
      stamp = `${stat.mtimeMs}:${stat.size}`
    } catch {
      return this.reset()
    }
    if (stamp === this.stamp) return this.chains
    this.stamp = stamp
    if (size > MAX_STATE_BYTES) return (this.chains = [])
    try {
      this.chains = dsBotChains(JSON.parse(readFileSync(this.path, 'utf8')))
    } catch {
      this.chains = []
    }
    return this.chains
  }
  private reset(): Chain[] {
    this.stamp = ''
    return (this.chains = [])
  }
}
