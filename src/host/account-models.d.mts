export interface AccountModelScope {
  state: 'supported' | 'denied' | 'unknown'
  source: 'account-models' | 'configured-custom' | 'verified-route' | 'unknown'
  /** Safe metadata classification; absent when the server did not establish a specific cause. */
  denialReason?: 'authentication' | 'quota'
  /** Endpoint explicitly returned 404/405; never inferred from network or parse errors. */
  catalogUnavailable?: boolean
  /** Successful metadata response contained an explicitly empty raw model array. */
  catalogEmpty?: boolean
  models: { id: string; name?: string; cost: 'free' | 'paid' | 'unknown'; reasoningEfforts?: string[] }[]
}
export interface AccountModelInput {
  provider: string
  credential: { type: 'api' | 'oauth'; key?: string; access?: string; expires?: number; accountId?: string }
  baseUrl?: string
  /** Installed Codex app-server version from its initialize handshake, never a guessed model version. */
  codexClientVersion?: string
  apiType?: string
  /** Mirror a native route that explicitly sends both Anthropic auth headers. */
  anthropicAuth?: 'api-key-and-bearer' | 'bearer'
  customModelIds?: string[]
  /** The native route's own request headers, merged over the auth headers (validated by the caller). */
  extraHeaders?: Record<string, string>
  verifiedModelIds?: string[]
}
export function probeAccountModels(
  input: AccountModelInput,
  options?: { signal?: AbortSignal; fetch?: typeof fetch; timeoutMs?: number },
): Promise<AccountModelScope>
