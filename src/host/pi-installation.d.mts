export const PI_SUPPORTED_VERSIONS: readonly ['1.0.2', '1.0.4', '1.1.0', '1.5.2']
export type SupportedPiVersion = (typeof PI_SUPPORTED_VERSIONS)[number]
export function isSupportedPiVersion(version: unknown): version is SupportedPiVersion
export interface PiInstallation {
  root: string
  dist: string
  version: string
  executable: string
}
export function inspectPiInstallation(entry: string, options?: { allowUnsupported?: boolean }): PiInstallation
