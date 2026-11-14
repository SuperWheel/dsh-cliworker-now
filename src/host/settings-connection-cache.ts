import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { CLI_IDS, type ActiveCliId } from '../shared/types.ts'
import type { AccountStatus } from '../shared/accounts.ts'
import type { ConnectionCatalog, ConnectionPart, SettingsConnectionStatus, SettingsConnectionSnapshot } from '../shared/settings-connection.ts'

export const CONNECTION_TTL = 10 * 60_000
export type CatalogReceipt = { catalog: ConnectionCatalog; binding: string }
type Values = { account: AccountStatus; catalog: CatalogReceipt }
type Kind = keyof Values
type Entry = { value?: Values[Kind]; checkedAt?: number; error?: string; pending?: Promise<Values[Kind]>; controller?: AbortController }
/** Memory only: no credentials, raw native outputs, or account handles are persisted. */
export class SettingsConnectionCache {
  private entries = new Map<string, Entry>()
  private revisions = new Map<ActiveCliId, number>()
  private listeners = new Set<() => void>()
  private lifetime = new AbortController()
  private pending = new Set<Promise<unknown>>()
  private cliReads = new Map<ActiveCliId, Promise<unknown>>()
  private sequence = 0
  project(project: string) { return createHash('sha256').update(resolve(project)).digest('hex') }
  revision(cli: ActiveCliId) { return this.revisions.get(cli) ?? 0 }
  private key(project: string, cli: ActiveCliId, kind: Kind) { return JSON.stringify([this.project(project), cli, kind]) }
  private changed() { this.sequence++; for (const notify of this.listeners) notify() }
  private stale(entry: Entry) { return entry.checkedAt === undefined || Date.now() < entry.checkedAt || Date.now() - entry.checkedAt >= CONNECTION_TTL }
  fresh<K extends Kind>(project: string, cli: ActiveCliId, kind: K): Values[K] | undefined {
    const entry = this.entries.get(this.key(project, cli, kind))
    return entry?.value && !entry.pending && !entry.error && !this.stale(entry) ? structuredClone(entry.value) as Values[K] : undefined
  }
  invalidate(cli: ActiveCliId) {
    this.revisions.set(cli, this.revision(cli) + 1)
    for (const [key, entry] of this.entries) if (JSON.parse(key)[1] === cli) {
      entry.controller?.abort()
      // Keep the running operation until cleanup finishes; discard only its display value.
      entry.value = undefined; entry.checkedAt = undefined; entry.error = undefined
      if (!entry.pending) this.entries.delete(key)
    }
    this.changed()
  }
  async read<K extends Kind>(project: string, cli: ActiveCliId, kind: K, signal: AbortSignal,
    load: (signal: AbortSignal) => Promise<Values[K]>, force = false): Promise<Values[K]> {
    signal.throwIfAborted(); this.lifetime.signal.throwIfAborted()
    const key = this.key(project, cli, kind)
    let entry = this.entries.get(key)
    if (entry?.pending) {
      // A forced refresh or invalidation must run after the old process has exited.
      try { await entry.pending } catch { /* retry after cleanup */ }
      signal.throwIfAborted(); this.lifetime.signal.throwIfAborted()
      if (!force) { const value = this.fresh(project, cli, kind); if (value) return value }
      return this.read(project, cli, kind, signal, load, force)
    }
    if (!force) { const value = this.fresh(project, cli, kind); if (value) return value }
    entry ??= {}; this.entries.set(key, entry)
    const current = entry, revision = this.revision(cli), controller = new AbortController()
    current.controller = controller
    const control = AbortSignal.any([signal, controller.signal, this.lifetime.signal])
    // Account and catalog slots (including other projects) share one CLI process lane.
    // Reserve synchronously; even an aborted queued read waits for its predecessor's cleanup.
    const previous = this.cliReads.get(cli)
    const ready = previous ? previous.catch(() => undefined) : Promise.resolve()
    const operation = ready.then(() => {
      control.throwIfAborted(); return load(control)
    }).then(value => {
      control.throwIfAborted()
      if (revision !== this.revision(cli)) throw new Error('CLI 来源已变化，请重试')
      current.value = structuredClone(value); current.checkedAt = Date.now(); current.error = undefined
      return structuredClone(value)
    }).catch(error => {
      if (!control.aborted && revision === this.revision(cli)) {
        current.value = undefined; current.checkedAt = undefined
        current.error = '连接状态读取失败，请刷新重试'
      }
      throw error
    }).finally(() => {
      current.pending = undefined; current.controller = undefined; this.pending.delete(operation)
      if (this.cliReads.get(cli) === operation) this.cliReads.delete(cli)
      this.changed()
    })
    current.pending = operation; this.pending.add(operation); this.cliReads.set(cli, operation); this.changed()
    return operation
  }
  status(project: string, cli: ActiveCliId): SettingsConnectionStatus {
    const part = <K extends Kind>(kind: K): ConnectionPart<K extends 'account' ? AccountStatus : ConnectionCatalog> => {
      const entry = this.entries.get(this.key(project, cli, kind))
      if (!entry) return { loading: false }
      const stale = this.stale(entry), raw = structuredClone(entry.value)
      let value: AccountStatus | ConnectionCatalog | undefined
      if (kind === 'catalog') value = (raw as CatalogReceipt | undefined)?.catalog
      else if (raw) {
        const account = raw as AccountStatus
        value = { ...account, actions: [], logins: account.logins?.map(({ id: _id, ...login }) => login) }
        if (stale && value.state === 'authenticated') value = { ...value, state: 'unknown', summary: '登录状态已过期，等待重新核实' }
        if (value.state === 'authenticated' && !value.verification) value = { ...value, state: 'unknown', summary: '登录状态尚未核实' }
      }
      return { value, loading: !!entry.pending, error: entry.error,
        cache: entry.checkedAt === undefined ? undefined : { checkedAt: entry.checkedAt, stale, project: this.project(project), revision: this.revision(cli), displayOnly: true } } as ReturnType<typeof part<K>>
    }
    return { cli, project: this.project(project), revision: this.revision(cli), account: part('account'), catalog: part('catalog') }
  }
  snapshot(project: string): SettingsConnectionSnapshot {
    return { sequence: this.sequence, project: this.project(project), entries: CLI_IDS.map(cli => this.status(project, cli)) }
  }
  async *watch(project: string, signal: AbortSignal): AsyncIterable<SettingsConnectionSnapshot> {
    const control = AbortSignal.any([signal, this.lifetime.signal]); let wake: (() => void) | undefined, sequence = -1
    const notify = () => wake?.(); this.listeners.add(notify); control.addEventListener('abort', notify)
    try {
      while (!control.aborted) {
        if (sequence !== this.sequence) { const snapshot = this.snapshot(project); sequence = snapshot.sequence; yield snapshot }
        else await new Promise<void>(resolve => { wake = resolve; if (control.aborted || sequence !== this.sequence) resolve() })
        wake = undefined
      }
    } finally { this.listeners.delete(notify); control.removeEventListener('abort', notify) }
  }
  async close() { this.lifetime.abort(); await Promise.allSettled(this.pending); this.entries.clear(); this.listeners.clear() }
}
