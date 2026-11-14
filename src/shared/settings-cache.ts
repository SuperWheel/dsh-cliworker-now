import type { CliId, Preference } from './types.ts'

/** Display scope only; never an account binding or execution authorization. */
export interface SettingsCacheMetadata {
  /** Optional Host connection snapshots; old clients may ignore. */
  connections?: import('./settings-connection.ts').SettingsConnectionSnapshot
  policy: 1
  host: string
  project: string
  revisions: Record<CliId, string>
  catalogReady: Record<CliId, boolean>
  preferences: Partial<Record<CliId, Preference>>
}
