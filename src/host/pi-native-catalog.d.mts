export interface PiApiCredential {
  configured: boolean
  envOnly: boolean
  key?: string
  env?: Record<string, string>
  missing?: boolean
  fallbackEnv?: Record<string, string>
}
export function readPiApiCredential(value: unknown, ambient?: NodeJS.ProcessEnv): PiApiCredential | undefined
export function snapshotNativeCandidates(candidates: any[], env?: Record<string, string>): any[]
export function projectNativeModel(model: any, cli: 'pi' | 'omp'): any
export function queryNativeCatalog(...args: any[]): Promise<any[]>
export function queryNativeCandidates(...args: any[]): Promise<any[]>
export function accountSupportedChoices(cli: 'pi' | 'omp', directory: string, candidates: any[], env?: NodeJS.ProcessEnv, options?: any): Promise<any[]>
