import type { CliId } from './types.ts'

/** Harness-profile preferences; independent from project model defaults. */
export interface CliSettings {
  enabled: Record<CliId, boolean>
}

/** Bounds shared by the Host schema and the settings control. */
export const MAX_CONCURRENT_LIMIT = 8

/** `follow` uses the current DSH language; the others override it for this plugin only. */
export const LANGUAGE_PREFERENCES = ['follow', 'zh', 'en'] as const
export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number]

/** The longest task time limit; "no limit" uses it so a stuck run still ends. */
export const MAX_TASK_TIME_LIMIT_MS = 86_400_000
/** Total time limit choices; the last is "no limit (24 hours at most)". */
export const TASK_TIME_LIMIT_CHOICES = [30, 60, 120, 240, 480, 1440].map((minutes) => minutes * 60_000)
/** Idle time limit choices; 0 turns it off. */
export const IDLE_TIME_LIMIT_CHOICES = [0, 5, 10, 30].map((minutes) => minutes * 60_000)

/** Profile-wide plugin settings shown on the CLI Worker settings page. */
export interface GeneralSettings {
  /** Effective admission limit shared by all CLIs. */
  maxConcurrent: number
  /** Deployment value used when the user has not chosen one. */
  defaultMaxConcurrent: number
  /** Interface language preference; `follow` when never chosen. */
  language: LanguagePreference
  /** Conflicting same-project writers run in plugin-owned copies; off by default. */
  isolatedParallelWrites: boolean
  /** Dispatch questions before a new conversation's first start; on unless turned off. */
  askBeforeDispatch: boolean
  /** Effective total time limit of a task in ms, counted from its start. */
  taskTimeLimitMs: number
  /** Deployment value (the plugin config `timeoutMs`) used when the user has not chosen one. */
  defaultTaskTimeLimitMs: number
  /** A task with no native event for this long is stopped; 0 is off. */
  idleTimeLimitMs: number
}

/** Machine-local executable selection; separate from project model preferences. */
export interface CliExecutablePathStatus {
  cli: CliId
  path: string
  source: 'auto' | 'manual' | 'configured' | 'none'
  available: boolean
  error?: string
}
