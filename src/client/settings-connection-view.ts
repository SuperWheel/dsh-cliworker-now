import type { AccountStatus } from '../shared/accounts.ts'
import type {
  ConnectionCacheInfo,
  ConnectionCatalog,
  ConnectionPart,
  SettingsConnectionSnapshot,
  SettingsConnectionStatus,
} from '../shared/settings-connection.ts'
import { CLI_IDS, type ActiveCliId, type CliId, type Preference } from '../shared/types.ts'
import type { SettingsAccountEntry, SettingsCatalogEntry } from './settings-display-cache.ts'

/** Host connection receipts are display-only for ten minutes (src/host/settings-connection-cache.ts). */
export const CONNECTION_FRESH_MS = 600_000

/** A receipt the Host marked current and whose age is inside the window; a clock rollback never counts. */
export function freshReceipt(cache: ConnectionCacheInfo | undefined, now: number): boolean {
  if (!cache || cache.stale !== false || typeof cache.checkedAt !== 'number') return false
  const age = now - cache.checkedAt
  return age >= 0 && age < CONNECTION_FRESH_MS
}

/** The earliest moment one of these fresh receipts stops being fresh. */
export function nextExpiry(caches: Iterable<ConnectionCacheInfo | undefined>, now: number): number | undefined {
  let next: number | undefined
  for (const cache of caches) {
    if (!freshReceipt(cache, now)) continue
    const deadline = cache!.checkedAt + CONNECTION_FRESH_MS
    if (next === undefined || deadline < next) next = deadline
  }
  return next
}

export type ConnectionState =
  | 'disabled'
  | 'failed'
  | 'pending'
  | 'unconfigured'
  | 'unknown'
  | 'expired'
  | 'unverified'
  | 'connected'
export interface ConnectionAccountInput {
  loading: boolean
  data?: AccountStatus
  error?: string
}

/**
 * Sidebar and account-row dot. Green only for a verified sign-in whose receipt is current and that
 * is neither loading, failed nor paused; loading shows the spinner. A status without a receipt is a
 * live answer from a Host that predates the connection cache.
 */
export function connectionState(
  enabled: boolean | undefined,
  account: ConnectionAccountInput | undefined,
  settingsError: string,
  now: number,
): ConnectionState {
  if (enabled === false) return 'disabled'
  if (settingsError) return 'failed'
  if (enabled === undefined || !account || account.loading) return 'pending'
  const data = account.data
  if (account.error || !data || data.cleanupBlocked) return 'failed'
  if (data.state === 'unconfigured') return 'unconfigured'
  if (data.state === 'unavailable' || data.state === 'unauthenticated') return 'failed'
  if (data.state === 'configured') return 'unverified'
  if (data.state !== 'authenticated') return 'unknown'
  if (!data.verification) return 'unverified'
  if (data.cache !== undefined && !freshReceipt(data.cache, now)) return 'expired'
  return 'connected'
}

/** What a connection slot still needs: nothing, a first read, or a re-check of an expired receipt. */
export function slotNeed(
  entry: { loading: boolean; error?: string; data?: { cache?: ConnectionCacheInfo } } | undefined,
  now: number,
): string | undefined {
  if (!entry) return 'missing'
  if (entry.loading || entry.error) return undefined
  if (!entry.data) return 'missing'
  const cache = entry.data.cache
  return cache && !freshReceipt(cache, now) ? `expired:${cache.checkedAt}` : undefined
}

export type AccountPart = ConnectionPart<AccountStatus>
export type CatalogPart = ConnectionPart<ConnectionCatalog>
export interface ConnectionChange {
  cli: ActiveCliId
  /** The Host invalidated this CLI: drop its old account, catalog and drafts first. */
  revisionChanged: boolean
  /** Slots that differ from what was last applied; a slot without value, loading or error is cleared. */
  parts: { account?: AccountPart; catalog?: CatalogPart }
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function validCache(value: unknown): boolean {
  return object(value) && finite(value.checkedAt) && typeof value.stale === 'boolean' &&
    finite(value.revision) && value.displayOnly === true
}
function validPart(value: unknown, cli: CliId, kind: 'account' | 'catalog'): boolean {
  if (!object(value) || typeof value.loading !== 'boolean') return false
  if (value.error !== undefined && typeof value.error !== 'string') return false
  if (value.cache !== undefined && !validCache(value.cache)) return false
  if (value.value === undefined) return true
  if (!object(value.value) || value.value.cli !== cli) return false
  return kind === 'account' ? typeof value.value.state === 'string' : Array.isArray(value.value.models)
}
function validStatus(value: unknown): value is SettingsConnectionStatus {
  return object(value) && (CLI_IDS as readonly unknown[]).includes(value.cli) &&
    finite(value.revision) && validPart(value.account, value.cli as CliId, 'account') &&
    validPart(value.catalog, value.cli as CliId, 'catalog')
}
export function parseConnectionStatus(value: unknown): SettingsConnectionStatus | undefined {
  return validStatus(value) ? value : undefined
}
export function parseConnectionSnapshot(value: unknown): SettingsConnectionSnapshot | undefined {
  if (!object(value) || !finite(value.sequence) || !Array.isArray(value.entries)) return
  return value as unknown as SettingsConnectionSnapshot
}

/**
 * Orders Host connection receipts for one open dialog: this machine's CLIs, a monotonic snapshot
 * sequence per subscription generation, and a per-CLI revision. Older receipts are dropped.
 */
export class ConnectionReceipts {
  private sequence = -1
  private generation?: number
  private applied = 0
  private readonly revisions = new Map<CliId, number>()
  private readonly parts = new Map<string, string>()

  /** Changes on every applied snapshot; a quick status answer taken before a newer snapshot is dropped. */
  get ticket(): number { return this.applied }
  revision(cli: CliId): number | undefined { return this.revisions.get(cli) }

  /** The settings snapshot or one watch item. A new stream generation (reconnect or Host restart) resyncs. */
  snapshot(raw: unknown, generation?: number): ConnectionChange[] | undefined {
    const snapshot = parseConnectionSnapshot(raw)
    if (!snapshot) return
    const resync = generation !== undefined && this.generation !== undefined && generation !== this.generation
    if (generation !== undefined) this.generation = generation
    if (!resync && snapshot.sequence < this.sequence) return
    if (resync) this.parts.clear()
    this.sequence = snapshot.sequence
    this.applied++
    const changes: ConnectionChange[] = []
    for (const entry of snapshot.entries) {
      if (!validStatus(entry)) continue
      const change = this.entry(entry, resync)
      if (change) changes.push(change)
    }
    return changes
  }

  /** A `settingsConnectionStatus` answer, requested when `ticket` was current. */
  status(raw: unknown, ticket: number): ConnectionChange | undefined {
    if (ticket !== this.applied || !validStatus(raw)) return
    return this.entry(raw, false)
  }

  /**
   * A direct accountStatus/catalogForCli/refresh answer. `drop`: older than the revision on screen;
   * `newer`: the Host has invalidated since the last snapshot, so the other slot is outdated too.
   */
  read(cli: CliId, cache: ConnectionCacheInfo | undefined): 'same' | 'newer' | 'drop' {
    if (!cache) return 'same'
    if (!finite(cache.revision)) return 'drop'
    const known = this.revisions.get(cli)
    if (known !== undefined && cache.revision < known) return 'drop'
    if (known === cache.revision) return 'same'
    this.revisions.set(cli, cache.revision)
    this.forget(cli)
    return known === undefined ? 'same' : 'newer'
  }

  private forget(cli: CliId) {
    this.parts.delete(`${cli}:account`)
    this.parts.delete(`${cli}:catalog`)
  }

  private entry(entry: SettingsConnectionStatus, resync: boolean): ConnectionChange | undefined {
    const known = this.revisions.get(entry.cli)
    if (known !== undefined && entry.revision < known && !resync) return
    const revisionChanged = known !== undefined && entry.revision !== known
    this.revisions.set(entry.cli, entry.revision)
    if (revisionChanged) this.forget(entry.cli)
    const parts: ConnectionChange['parts'] = {}
    for (const kind of ['account', 'catalog'] as const) {
      const key = `${entry.cli}:${kind}`, json = JSON.stringify(entry[kind])
      if (this.parts.get(key) === json) continue
      this.parts.set(key, json)
      ;(parts as Record<string, unknown>)[kind] = structuredClone(entry[kind])
    }
    if (!revisionChanged && !parts.account && !parts.catalog) return
    return { cli: entry.cli, revisionChanged, parts }
  }
}

/** Snapshot account slot as a dialog entry: display only, never login or sign-out handles. */
export function accountEntryFromPart(part: AccountPart): SettingsAccountEntry | undefined {
  if (part.value)
    return { data: { ...part.value, ...(part.cache ? { cache: part.cache } : {}) }, loading: part.loading,
      ...(part.error ? { error: part.error } : {}) }
  if (part.loading) return { loading: true }
  if (part.error) return { loading: false, error: part.error }
  return undefined
}
/** Snapshot catalog slot as a dialog entry; the saved preference comes from settings, never inferred. */
export function catalogEntryFromPart(part: CatalogPart, preference?: Preference): SettingsCatalogEntry | undefined {
  if (part.value)
    return {
      data: { cli: part.value.cli, models: part.value.models, notice: part.value.notice,
        ...(preference ? { preference } : {}), ...(part.cache ? { cache: part.cache } : {}) },
      loading: part.loading,
      ...(part.error ? { error: part.error } : {}),
    }
  if (part.loading) return { loading: true }
  if (part.error) return { loading: false, error: part.error }
  return undefined
}

/** Actions and login ids are current: read with `refreshAccountStatus`, or a live answer from a Host without receipts. */
export function actionsKnown(entry: { data?: AccountStatus; handles?: boolean } | undefined): boolean {
  return !!entry?.data && (entry.handles === true || entry.data.cache === undefined)
}
