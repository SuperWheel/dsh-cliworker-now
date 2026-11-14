import type { CliDownloadProgress } from '../../../shared/cli-management.ts'
import type { hostFetch } from '../../host-fetch.mjs'

/** Host-owned descriptions only. No caller-supplied URLs or executable callbacks. */
export interface ArtifactFile {
  sources: string[]
  /** RANGE probes GET bytes=0-0 and reads the whole-object Content-Range length. */
  bytes?: number | 'HEAD' | 'RANGE'
  integrity?: string | 'response-md5'
  compression?: 'none' | 'gzip' | 'zstd'
  decodedIntegrity?: string
  decodedBytes?: number
  dest: string
  presigned?: { refresh(signal: AbortSignal): Promise<{ version: string; sources: string[]; bytes: number; integrity: string }>; version: string }
  redirectHosts?: string[]
  sourceRedirects?: Record<string, string>
  officialSignedArtifact?: boolean
  /** Existing OpenCode contract: HTTPS length plus archive CRC, pending publisher digest. */
  archiveCrc?: boolean
}
export type ArtifactExtra = { dest: string; content: string } | { dest: string; script: string }
export interface OfficialProbe {
  kind: 'files' | 'stage' | 'none'
  directory?: string
  /** Relative paths, slash-normalised. Ancestors are traversed only when directoryRule matches. */
  fileRule?: RegExp
  directoryRule?: RegExp
  totalBytes?: number
  totalForFile?: (relative: string, signal: AbortSignal) => Promise<number | undefined>
  privateTemp?: 'TMPDIR' | 'TEMP'
  hardTimeoutMs?: number
  /** Only explicit update log/status paths; never configuration/credential files. */
  stageFiles?: string[]
  lockFile?: string
  lockCommandPattern?: RegExp
  /** OMP may download a patch instead of the full object. Never mix those units. */
  packageDirectory?: string
  packageCount?: number
  phaseOnly?: boolean
  phaseOnlyPattern?: RegExp
}
export type ArtifactPlacement =
  | { kind: 'official-local'; argv: string[]; env?: Record<string, string>; extract?: { archive: string; format: 'zip' | 'tar.gz'; member: string } }
  | { kind: 'replace-binary'; file: string; target: string }
  | { kind: 'versioned-link'; file: string; target: string; versionFile: string; link?: boolean }
  | { kind: 'extract-replace'; archive: string; format: 'zip' | 'tar.gz'; member: string; target: string }
  | { kind: 'native-binary'; file: string; targets: string[]; versionFile?: string; copyFallback?: boolean; extract?: { archive: string; format: 'zip' | 'tar.gz'; member: string }; smoke?: { version: string; match: 'exact' | 'contains'; env?: Record<string, string> }; metadata?: { file: string; target: string }[]; companions?: { file: string; target: string }[]; signature?: 'grok'; mingit?: { archive: string; target: string } }
  | { kind: 'release-package'; archive: string; target: string; version: string; argv: string[]; env: Record<string, string> }
  | { kind: 'registry'; argv: string[]; paths: Record<string, string> }
  | { kind: 'none' }
export interface ArtifactDescription {
  manifest: { urls: string[]; version: string; versionField: string; platformKey: string }
  files: ArtifactFile[]
  extras: ArtifactExtra[]
  placement: ArtifactPlacement
  /** Exact allowed destinations, not arbitrary parent-directory containment. */
  allowedTargets: string[]
  platform: NodeJS.Platform
  officialProbe: OfficialProbe
  /** Capture before placement, return the action to run only after successful placement. */
  before?: (signal: AbortSignal) => Promise<void>
  after?: (signal: AbortSignal) => Promise<(signal: AbortSignal) => Promise<void>>
}
export interface ArtifactDownloadContext {
  download?: typeof import('../download.ts').downloadCliArtifact
  root: string; directory: string; signal: AbortSignal; fetcher?: typeof hostFetch
  progress(value: CliDownloadProgress): void
  output?(value: string): void
}
