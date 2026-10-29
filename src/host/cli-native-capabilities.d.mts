export type CapabilityClass = 'file-read' | 'file-write' | 'search' | 'shell' | 'web' | 'image-read' | 'skills'
export interface NativeCliCapabilities {
  cli: string
  classes: CapabilityClass[]
  /** Classes this run withholds on purpose (plan-mode writes); never offered as a fallback. */
  withheld: CapabilityClass[]
  /** Names of MCP servers the CLI loads from its own native config. */
  mcpServers: string[]
  /** The CLI's MCP client passes image tool results to its model. */
  mcpImages: boolean
}
export const CAPABILITY_CLASSES: readonly CapabilityClass[]
export function piOmpNativeTools(cli: string, mode: string, access?: string): string[]
export function nativeSkillPaths(cli: string, options?: { env?: Record<string, string | undefined>; project?: string; home?: string }): string[]
export function shareNativeMemory(privatePath: string, nativePath: string): Promise<void>
export function unshareNativeMemory(privatePath: string): Promise<void>
export function grokTomlMemory(text: string): boolean | undefined
export function grokNativeMemory(options?: { env?: Record<string, string | undefined>; home?: string }): Promise<boolean>
export function hermesNativeMemory(config: unknown): {
  memory_enabled: boolean
  user_profile_enabled: boolean
  memory_char_limit?: number
  user_char_limit?: number
  nudge_interval?: number
}
export const GROK_NATIVE_WEB: boolean
export const GROK_PLAN_TOOLS: readonly string[]
export function nativeCliCapabilities(input: { cli: string; mode: string; access?: string; mcpServers?: readonly string[] }): NativeCliCapabilities
export function dshToolClass(name: string): CapabilityClass | 'dsh-skill' | undefined
export function nativeCoverage(name: string, capabilities?: NativeCliCapabilities): string | undefined
export function codexDeveloperInstructionsConfigured(project: string, env?: Record<string, string | undefined>): boolean
export const HARNESS_FALLBACK_PREFIX: string
export function nativeFirstGuidance(tools?: readonly string[]): string | undefined
export function nativeCliMcpServers(cli: string, project: string, env?: Record<string, string | undefined>): Promise<string[]>
