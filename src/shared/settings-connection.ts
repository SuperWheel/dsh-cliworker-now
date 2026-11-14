import type { AccountStatus } from './accounts.ts'
import type { ActiveCliId, CliId, ModelChoice } from './types.ts'

/** Host-lifetime display receipt; never execution authorization. */
export interface ConnectionCacheInfo {
  checkedAt: number
  stale: boolean
  project: string
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
  project: string
  revision: number
  account: ConnectionPart<AccountStatus>
  catalog: ConnectionPart<ConnectionCatalog>
}
export interface SettingsConnectionSnapshot {
  sequence: number
  project: string
  entries: SettingsConnectionStatus[]
}
