export declare const ZCODE_APP_RESOURCES_ENVIRONMENT: 'CLIWORKER_ZCODE_APP_RESOURCES'
export declare const ZCODE_APP_HOOK_NAME: 'zcode-app-resolve.cjs'
export interface ZCodeAppLayout {
  /** `<…>/ZCode.app` on macOS, the installation directory on Windows. */
  root: string
  resources: string
  /** The app's own binary, run with `ELECTRON_RUN_AS_NODE=1`. */
  electron: string
  builtinConfig: string
}
export interface ZCodeAppRuntime extends ZCodeAppLayout {
  hook: string
}
export interface ZCodeEntryOptions {
  platform?: NodeJS.Platform
  hook?: string
  /** `false` after a failed launch probe: run the entry under the Host's Node. */
  appRuntime?: boolean
}
export declare function zcodeAppLayout(entry: string, platform?: NodeJS.Platform): ZCodeAppLayout | undefined
export declare function zcodeAppHook(here?: string): string | undefined
export declare function zcodeAppRuntime(entry: string, options?: ZCodeEntryOptions): ZCodeAppRuntime | undefined
export declare function zcodeEntryArgv(executable: string, options?: ZCodeEntryOptions): string[]
export declare function zcodeEntryEnvironment(executable: string, options?: ZCodeEntryOptions): Record<string, string>
export declare function isZCodeAppArgv(argv: readonly string[]): boolean
