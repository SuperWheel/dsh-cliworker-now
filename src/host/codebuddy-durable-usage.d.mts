export type CodebuddyFamilyCli = 'codebuddy' | 'workbuddycn' | 'workbuddy'
export interface CodebuddyUsageBinding { cli: CodebuddyFamilyCli; home: string; project: string; sessionId: string; model: string; userMessageId: string; conversationRequestId: string; turnStartedAt?: number }
export interface CodebuddyUsageObservation {
  type: 'cliworker.codebuddy_usage'; cli: CodebuddyFamilyCli; source: `${CodebuddyFamilyCli}.native-transcript`
  sessionId: string; model: string; userMessageId: string; conversationRequestId: string; requests: number
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; cachedReadTokens: number; reasoningTokens: number }
  providerCredits?: number; creditsIncomplete?: 'subagents'
}
export function codebuddyProjectKey(project: string): string
export function codebuddyUsagePaths(config: Pick<CodebuddyUsageBinding, 'cli' | 'home' | 'project' | 'sessionId'>): string[]
export function inspectCodebuddyDurableUsage(records: unknown[], config: Omit<CodebuddyUsageBinding, 'home' | 'project'> & { cwd?: string; subagentsActive?: boolean }): CodebuddyUsageObservation | undefined
export function readCodebuddyDurableUsage(config: CodebuddyUsageBinding, options?: { signal?: AbortSignal; budgetMs?: number; attempts?: number; delayMs?: number }): Promise<CodebuddyUsageObservation | undefined>
