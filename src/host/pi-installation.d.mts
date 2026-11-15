export const PI_SUPPORTED_VERSIONS: readonly ['1.0.2', '1.0.4', '1.1.0', '1.5.2']
export type SupportedPiVersion = (typeof PI_SUPPORTED_VERSIONS)[number]
export function isSupportedPiVersion(version: unknown): version is SupportedPiVersion
export interface PiInstallation {
  root: string
  dist: string
  version: string
  /** Actual resolved selected launcher before SDK/RPC entry normalization. */
  launchEntry: string
  executable: string
}
export function inspectPiInstallation(entry: string, options?: { allowUnsupported?: boolean }): PiInstallation
export class PiInstallationIntegrityError extends Error {
  readonly code: 'PI_INSTALLATION_INCOMPLETE'
  readonly packageName?: string
  constructor(packageName?: string)
}
export function piInstallationIntegrityMessage(error: unknown): string | undefined
export class PiInstallationCheckUnavailableError extends Error {
  readonly code: 'PI_INSTALLATION_CHECK_UNAVAILABLE'
  constructor()
}
export function checkPiInstallationIntegrity(entry: string, options?: {
  allowUnsupported?: boolean
  fresh?: boolean
  signal?: AbortSignal
}): Promise<PiInstallation>
