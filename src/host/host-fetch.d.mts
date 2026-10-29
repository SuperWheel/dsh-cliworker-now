export function setHostProxy(lookup: ((target: string) => Promise<string | undefined>) | undefined): void
export function bypassesProxy(hostname: string, entries: readonly string[]): boolean
export function environmentProxy(target: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string | undefined
export function hostFetch(input: string | URL, init?: RequestInit): Promise<Response>
