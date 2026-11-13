export interface PiInstallation {
  root: string
  dist: string
  version: string
  executable: string
}
export const PI_SUPPORTED_VERSIONS: readonly string[]
export function isSupportedPiVersion(version: string): boolean
export function inspectPiInstallation(entry: string, options?: { allowUnsupported?: boolean }): PiInstallation
