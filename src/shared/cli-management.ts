import type { ActiveCliId } from './types.ts'

/**
 * Contract for the "Update CLI" settings page (openspec change v0-8-10-cli-update-page-leeyl).
 * Plain data only: no executable commands, URLs chosen by the client, or secrets cross this boundary.
 * The Host validates every value it receives; the Client renders every string as untrusted text.
 */

/** Page sections in display order. `checking` holds rows that have no usable result yet. */
export const CLI_UPDATE_GROUPS = ['checking', 'failed', 'updatable', 'manual', 'latest', 'notInstalled'] as const
export type CliUpdateGroup = (typeof CLI_UPDATE_GROUPS)[number]

/** Installation owner recognised from the real executable path. */
export const CLI_INSTALL_SOURCES = [
  'npm',
  'brew',
  'self-update',
  'official-installer',
  'desktop-app',
  'winget',
  'scoop',
  'nix',
  'bun',
  'pnpm',
  'unknown',
] as const
export type CliInstallSource = (typeof CLI_INSTALL_SOURCES)[number]

/** Why a row is not plainly "update available" or "latest". */
export const CLI_UPDATE_REASONS = [
  'NOT_INSTALLED',
  'APP_MANAGED',
  'UNSUPPORTED_MANAGER',
  'UNKNOWN_INSTALLATION',
  'UNKNOWN_VERSION',
  'NO_RELEASE_SOURCE',
  'RELEASE_UNREACHABLE',
  'RELEASE_TIMEOUT',
  'INCOMPATIBLE_TARGET',
  'PREREQUISITE_MISSING',
  'CLI_BUSY',
  'MAINTENANCE',
] as const
export type CliUpdateReason = (typeof CLI_UPDATE_REASONS)[number]

/** A row that is still being read: `local` = installation and current version, `remote` = release source. */
export type CliCheckStage = 'local' | 'remote'

export interface CliPrerequisite {
  /** Display name, e.g. `Node.js`. */
  name: string
  /** Required range in display form, e.g. `≥ 18.20`. */
  required: string
  /** Version found on this machine; absent when not found. */
  found?: string
  satisfied: boolean
}

export interface CliManualMethod {
  /** One short sentence telling the user what to do. */
  note: string
  /** Display-only argv the user can copy into a terminal; never executed by the Client. */
  command?: string[]
  /** Official documentation page from the Host's built-in source list. */
  guideUrl?: string
}

export interface CliInstallOffer {
  method: 'npm' | 'script' | 'desktop' | 'manual'
  /** Where the CLI lands by default, in display form (`~/.local/bin/agy`). */
  defaultLocation?: string
  /** Only ZCode, WorkBuddy CN and WorkBuddy. */
  selectableLocation: boolean
  /** Official script URL shown in the row; from the Host's built-in list. */
  scriptUrl?: string
  prerequisites: CliPrerequisite[]
  guideUrl?: string
  /** Experimental CLIs are marked in the description. */
  experimental?: boolean
}

export interface CliUpdateEntry {
  cli: ActiveCliId
  group: CliUpdateGroup
  /** Present while this row is being read; the row keeps its last group meanwhile. */
  stage?: CliCheckStage
  installed: boolean
  source?: CliInstallSource
  /** True when the npm source is not the official registry (`npm 全局安装 · 国内镜像`). */
  mirrored?: boolean
  currentVersion?: string
  /** Desktop app version is separate from the bundled CLI version. */
  appVersion?: string
  /** Nonblocking compatibility/channel/migration notice, shown before updating. */
  notice?: string
  /** Verified installation channel, never supplied by the Client. */
  channel?: string
  /** Newest release on the source. */
  latestVersion?: string
  /** Newest release this plugin supports; differs from `latestVersion` for OpenCode V1 compatibility. */
  latestCompatibleVersion?: string
  reason?: CliUpdateReason
  /** Short safe text for `failed` rows, e.g. the HTTP status. */
  reasonDetail?: string
  /** Workers currently using this CLI; update is disabled while > 0. */
  busyWorkers?: number
  manual?: CliManualMethod
  install?: CliInstallOffer
  /** Opaque fingerprint digest of the checked installation; `startCliOperation` refuses when it no longer matches. */
  planToken?: string
  /** Epoch ms of the last local read and the last release-source read. */
  checkedAt?: number
  latestCheckedAt?: number
}

/** Download progress built from real bytes only; no invented percentages. */
export interface CliDownloadProgress {
  /** False when the external command does not expose bytes ("下载进度无法读取"). */
  readable: boolean
  downloadedBytes?: number
  totalBytes?: number
  bytesPerSecond?: number
  /** Automatic resumes after a stall, interruption or slow window; at most 200. */
  resumeCount: number
  /** External-command retries, not HTTP Range resumes. */
  retryCount?: number
  /** Host currently supplying the plugin-owned download. */
  sourceHost?: string
  /** Seconds since the last byte, shown while waiting for the stall check. */
  stalledSeconds?: number
}

export const CLI_OPERATION_PHASES = [
  'preparing',
  'downloading',
  'verifying-download',
  'installing',
  'awaiting-user',
  'verifying-installation',
  'cancelling',
  'succeeded',
  'failed',
  'cancelled',
  'cleanup-unconfirmed',
] as const
export type CliOperationPhase = (typeof CLI_OPERATION_PHASES)[number]
export const CLI_OPERATION_TERMINAL: readonly CliOperationPhase[] = ['succeeded', 'failed', 'cancelled', 'cleanup-unconfirmed']

export const CLI_OPERATION_ERRORS = [
  'NETWORK',
  'STALL_LIMIT',
  'DOWNLOAD_TIMEOUT',
  'INSTALL_TIMEOUT',
  'INTEGRITY_MISMATCH',
  'EXIT_CODE',
  'VERSION_UNCHANGED',
  'VERSION_MISMATCH',
  'IDENTITY_CHANGED',
  'PLAN_EXPIRED',
  'PERMISSION_DENIED',
  'PREREQUISITE_MISSING',
  'LOCATION_INVALID',
  'CLI_BUSY',
  'CLEANUP_UNCONFIRMED',
  'UNKNOWN',
] as const
export type CliOperationErrorCode = (typeof CLI_OPERATION_ERRORS)[number]

export interface CliUpdateOperation {
  id: string
  intent: 'update' | 'install'
  cli: ActiveCliId
  phase: CliOperationPhase
  startedAt: number
  finishedAt?: number
  beforeVersion?: string
  targetVersion?: string
  afterVersion?: string
  /** Display-only argv actually run (with `--registry` when a mirror is used). */
  command?: string[]
  /** Where integrity values came from when a mirror was used. */
  integritySource?: string
  progress?: CliDownloadProgress
  /** Plain text, ANSI stripped, secrets redacted, last 32 KiB. */
  outputTail: string
  installDirectory?: string
  error?: { code: CliOperationErrorCode; message: string; retryable: boolean }
}

/** Host-wide page state. `revision` grows on every change and orders stream updates. */
export interface CliUpdateSnapshot {
  revision: number
  /** `preloading` = background low-load pass; `checking` = foreground check the page asked for. */
  activity: 'idle' | 'preloading' | 'checking'
  /** Last finished full check, epoch ms. */
  checkedAt?: number
  entries: CliUpdateEntry[]
  /** The single running operation, if any. */
  operation?: CliUpdateOperation
  /** CLIs waiting in the "update all" queue, in order. */
  queue: ActiveCliId[]
  /** Last finished operation per CLI, shown until the next regroup or a new check. */
  results: CliUpdateOperation[]
}

export const CLI_DOWNLOAD_SOURCES = ['follow', 'official', 'npmmirror', 'custom'] as const
export type CliDownloadSource = (typeof CLI_DOWNLOAD_SOURCES)[number]
export const OFFICIAL_NPM_REGISTRY = 'https://registry.npmjs.org/'
export const NPMMIRROR_REGISTRY = 'https://registry.npmmirror.com/'

export interface CliDownloadSourceSettings {
  source: CliDownloadSource
  /** Only for `custom`: https, no user name or password. */
  customUrl?: string
  /** Registry from this machine's npm config, shown for `follow`. */
  followRegistry?: string
}

/** Result of picking or checking an install directory for ZCode, WorkBuddy CN or WorkBuddy. */
export interface CliInstallDirectoryCheck {
  /** Absolute path; '' when the picker was dismissed or the default location is meant. */
  path: string
  freeBytes?: number
  requiredBytes?: number
  /** Present when the location cannot be used; the Client disables 「开始安装」. */
  problem?: 'ADMIN_REQUIRED' | 'NO_SPACE' | 'NOT_EMPTY' | 'INVALID'
  message?: string
}

export interface CliDownloadSourceTest {
  ok: boolean
  /** Round trip in ms when ok. */
  elapsedMs?: number
  message?: string
}

/** Validation shared by Host and Client for a custom registry. */
export function customRegistryProblem(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return '请输入完整的地址，例如 https://npm.example.com/'
  }
  if (url.protocol !== 'https:') return '只接受 https 地址'
  if (url.username || url.password) return '地址里不能包含用户名或密码'
  if (url.search || url.hash) return '地址里不能包含查询参数'
  return undefined
}

/** Display order inside every section follows the navigation order of CLI_IDS. */
export function cliUpdateGroupLabel(group: CliUpdateGroup): string {
  return {
    checking: '检查中',
    failed: '检查失败',
    updatable: '可更新',
    manual: '需要手动更新',
    latest: '已是最新',
    notInstalled: '未安装',
  }[group]
}
