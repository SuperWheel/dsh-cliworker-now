import type { AccountStatus } from './accounts.ts'
import type { ActiveCliId, CliId, ModelChoice } from './types.ts'

/** Host-lifetime display receipt; never execution authorization. Machine-wide: one per CLI, no project. */
export interface ConnectionCacheInfo {
  checkedAt: number
  stale: boolean
  revision: number
  displayOnly: true
}
export interface ConnectionPart<T> {
  value?: T
  cache?: ConnectionCacheInfo
  loading: boolean
  error?: string
}
export interface ConnectionCatalog { cli: CliId; models: ModelChoice[]; notice: string }
export interface SettingsConnectionStatus {
  cli: ActiveCliId
  revision: number
  account: ConnectionPart<AccountStatus>
  catalog: ConnectionPart<ConnectionCatalog>
}
export interface SettingsConnectionSnapshot {
  sequence: number
  entries: SettingsConnectionStatus[]
}
