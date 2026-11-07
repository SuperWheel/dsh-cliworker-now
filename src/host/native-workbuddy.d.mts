import type { WorkBuddyCliId } from './workbuddy-variant.ts'
import type { ModelChoice } from '../shared/types.ts'
export interface WorkBuddyNativeConfig {
  cli: WorkBuddyCliId
  argv: string[]
  project: string
  env?: Record<string, string | undefined>
  home?: string
  signal?: AbortSignal
  timeoutMs?: number
  maxLineBytes?: number
  maxNativeLineBytes?: number
  maxRunBytes?: number
  mode?: string
  access?: string
  preference?: { model: string; effort: string }
  conversationId?: string
  [key: string]: unknown
}
export function workbuddyAcpArgv(config: WorkBuddyNativeConfig): string[]
export function runNativeWorkBuddy(config: WorkBuddyNativeConfig, io: any): Promise<void>
export function probeWorkBuddyMetadata(config: WorkBuddyNativeConfig, io?: any): Promise<{
  cli: WorkBuddyCliId
  endpoint: string
  authenticated: true
  models: ModelChoice[]
  effortOptions: string[]
  initialized: any
  session: any
}>
