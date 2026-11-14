import { CLI_IDS, EFFORTS, type CliId, type ModelChoice, type Preference } from '../shared/types.ts'
import type { AccountStatus } from '../shared/accounts.ts'
import type { SettingsCacheMetadata } from '../shared/settings-cache.ts'
import type { ConnectionCacheInfo } from '../shared/settings-connection.ts'
import { preferenceReadVersion, SettingsPreferenceSaves } from './settings-preference-saves.ts'
import { t } from './i18n.ts'

export interface SettingsCatalog {
  cli: CliId
  models: ModelChoice[]
  preference?: Preference
  notice?: string
  /** Host display receipt; never a configure or dispatch authorization. */
  cache?: ConnectionCacheInfo
}
/** `handles`: read with `refreshAccountStatus`, so its actions and login ids are current. */
export interface SettingsAccountEntry { loading: boolean; data?: AccountStatus; error?: string; handles?: boolean }
export interface SettingsCatalogEntry { loading: boolean; data?: SettingsCatalog; error?: string }

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128

/** An absent capability uses the old Host path; a malformed scope fails closed. */
export function settingsCacheMetadata(value: unknown): SettingsCacheMetadata | undefined {
  if (value === undefined) return
  if (!object(value) || value.policy !== 1 || !id(value.host) || !id(value.project) ||
    !object(value.revisions) || !object(value.preferences) || !object(value.catalogReady))
    throw new Error(t('设置缓存来源无效，请重新打开设置'))
  const revisions = value.revisions
  if (CLI_IDS.some(cli => !id(revisions[cli]))) throw new Error(t('设置缓存来源无效，请重新打开设置'))
  const catalogReady = value.catalogReady
  if (CLI_IDS.some(cli => typeof catalogReady[cli] !== 'boolean')) throw new Error(t('模型目录来源无效，请刷新重试'))
  for (const cli of CLI_IDS) {
    const pref = value.preferences[cli]
    if (pref === undefined) continue
    if (!object(pref) || (pref.cli ?? 'antigravity') !== cli || typeof pref.model !== 'string' || !pref.model || pref.model.length > 2048 ||
      !EFFORTS.includes(pref.effort as Preference['effort'])) throw new Error(t('项目默认设置无效，请刷新重试'))
  }
  return value as unknown as SettingsCacheMetadata
}

/** Completed display receipts only. No timers, processes, secrets or disk storage. */
export class SettingsDisplayCache {
  readonly preferenceSaves = new SettingsPreferenceSaves()
  private accounts: Partial<Record<CliId, SettingsAccountEntry>> = {}
  private catalogs: Partial<Record<CliId, SettingsCatalogEntry>> = {}
  private generations: Partial<Record<CliId, number>> = {}
  constructor(private metadata: SettingsCacheMetadata) { this.metadata = structuredClone(metadata) }

  sync(metadata: SettingsCacheMetadata, enabled: Record<CliId, boolean>, readVersion = preferenceReadVersion()) {
    for (const cli of CLI_IDS) {
      if (!enabled[cli] || metadata.host !== this.metadata.host || metadata.project !== this.metadata.project ||
        metadata.revisions[cli] !== this.metadata.revisions[cli]) this.invalidate(cli)
      else if (!metadata.catalogReady[cli] && this.catalogs[cli]?.data?.models.length) this.invalidate(cli, false)
      this.preferenceSaves.sync(cli, readVersion)
      const catalog = this.catalogs[cli]?.data
      const receipt = this.preferenceSaves.snapshot(cli)
      if (catalog) catalog.preference = structuredClone(receipt.status === 'saved' ? receipt.preference : metadata.preferences[cli])
    }
    this.metadata = structuredClone(metadata)
  }
  invalidate(cli: CliId, discardPreference = true) {
    this.generations[cli] = (this.generations[cli] ?? 0) + 1
    delete this.accounts[cli]; delete this.catalogs[cli]
    if (discardPreference) this.preferenceSaves.invalidate(cli)
  }
  version(cli: CliId) { return this.generations[cli] ?? 0 }
  accountSnapshot() { return structuredClone(this.accounts) }
  catalogSnapshot() { return structuredClone(this.catalogs) }
  account(cli: CliId, entry: SettingsAccountEntry, version = this.version(cli)) {
    if (version !== this.version(cli) || entry.loading || entry.data && entry.data.cli !== cli) return
    this.accounts[cli] = structuredClone(entry)
  }
  catalog(cli: CliId, entry: SettingsCatalogEntry, version = this.version(cli)) {
    if (version !== this.version(cli) || entry.loading || entry.data && entry.data.cli !== cli) return
    this.catalogs[cli] = structuredClone(entry)
  }
  preference(cli: CliId, preference: Preference) {
    const entry = this.catalogs[cli]
    if (entry?.data && (preference.cli ?? 'antigravity') === cli) entry.data.preference = structuredClone(preference)
  }
}

class SettingsDisplayPool {
  private host?: string
  private projects = new Map<string, SettingsDisplayCache>()
  private pendingWrites = new Map<string, SettingsDisplayCache>()
  resolve(metadata: SettingsCacheMetadata, enabled: Record<CliId, boolean>, readVersion = preferenceReadVersion()) {
    if (this.host !== metadata.host) {
      for (const cache of this.projects.values()) cache.preferenceSaves.clear()
      for (const cache of this.pendingWrites.values()) cache.preferenceSaves.clear()
      this.projects.clear(); this.pendingWrites.clear(); this.host = metadata.host
    }
    for (const [project, cache] of this.pendingWrites) if (!cache.preferenceSaves.pending) this.pendingWrites.delete(project)
    const cache = this.projects.get(metadata.project) ?? this.pendingWrites.get(metadata.project) ?? new SettingsDisplayCache(structuredClone(metadata))
    this.pendingWrites.delete(metadata.project)
    cache.sync(metadata, enabled, readVersion)
    this.projects.delete(metadata.project)
    this.projects.set(metadata.project, cache)
    if (this.projects.size > 8) {
      const project = this.projects.keys().next().value!, evicted = this.projects.get(project)!
      if (evicted.preferenceSaves.pending) {
        for (const cli of CLI_IDS) evicted.invalidate(cli, false)
        this.pendingWrites.set(project, evicted)
      }
      this.projects.delete(project)
    }
    return cache
  }
}
const pools = new WeakMap<object, SettingsDisplayPool>()
export function settingsDisplayPool(api: object) {
  let pool = pools.get(api)
  if (!pool) { pool = new SettingsDisplayPool(); pools.set(api, pool) }
  return pool
}
