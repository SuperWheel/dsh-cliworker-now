// Shared by the Host, the resume helper and the native bridge: how a ZCode
// desktop installation runs its own bundled CLI. Path shape and file presence
// only; application identity and the launch probe live in zcode-launch.ts.
import { existsSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Read once by the preload, then removed from the CLI's environment. */
export const ZCODE_APP_RESOURCES_ENVIRONMENT = 'CLIWORKER_ZCODE_APP_RESOURCES'
export const ZCODE_APP_HOOK_NAME = 'zcode-app-resolve.cjs'

const same = (left, right, platform) =>
  platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right

/**
 * `<app>/Contents/Resources/glm/zcode.cjs` (macOS) or `<root>\resources\glm\zcode.cjs`
 * (Windows). Any other entry, including the plugin's old private runtime, has no app.
 */
export function zcodeAppLayout(entry, platform = process.platform) {
  if (typeof entry !== 'string' || !isAbsolute(entry) || !same(basename(entry), 'zcode.cjs', platform)) return undefined
  const glm = dirname(entry)
  if (!same(basename(glm), 'glm', platform)) return undefined
  const resources = dirname(glm)
  const builtinConfig = join(resources, 'config', 'provider', 'zcode-builtin.json')
  if (platform === 'darwin') {
    const contents = dirname(resources)
    const root = dirname(contents)
    if (basename(resources) !== 'Resources' || basename(contents) !== 'Contents' || !root.endsWith('.app'))
      return undefined
    return { root, resources, electron: join(contents, 'MacOS', 'ZCode'), builtinConfig }
  }
  if (platform === 'win32') {
    if (!same(basename(resources), 'resources', platform)) return undefined
    const root = dirname(resources)
    if (dirname(root) === root) return undefined
    return { root, resources, electron: join(root, 'ZCode.exe'), builtinConfig }
  }
  return undefined
}

/** The preload ships beside the Host bundle and beside its unbundled modules. */
export function zcodeAppHook(here = dirname(fileURLToPath(import.meta.url))) {
  for (const path of [join(here, ZCODE_APP_HOOK_NAME), resolve(here, '../..', ZCODE_APP_HOOK_NAME)])
    if (existsSync(path)) return path
  return undefined
}

const file = (path) => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** The app's own runtime, when its binary and the plugin's preload are both present. */
export function zcodeAppRuntime(entry, options = {}) {
  const layout = zcodeAppLayout(entry, options.platform)
  if (!layout) return undefined
  const hook = options.hook ?? zcodeAppHook()
  if (!hook || !file(layout.electron)) return undefined
  return { ...layout, hook }
}

/**
 * argv prefix for one ZCode entry. JavaScript entries inside a desktop app run
 * under that app's Electron with the preload; other JavaScript entries, and an
 * app whose runtime failed its probe (`appRuntime: false`), run under this
 * Host's Node. A native entry runs as itself.
 */
export function zcodeEntryArgv(executable, options = {}) {
  if (!/\.[cm]?js$/i.test(executable)) return [executable]
  const runtime = options.appRuntime === false ? undefined : zcodeAppRuntime(executable, options)
  return runtime ? [runtime.electron, '--require', runtime.hook, executable] : [process.execPath, executable]
}

/** Variables the app runtime needs beyond the CLI's own; empty for any other prefix. */
export function zcodeEntryEnvironment(executable, options = {}) {
  const runtime = options.appRuntime === false ? undefined : zcodeAppRuntime(executable, options)
  return runtime ? { ELECTRON_RUN_AS_NODE: '1', [ZCODE_APP_RESOURCES_ENVIRONMENT]: runtime.resources } : {}
}

/** True for `[<electron>, '--require', <…/zcode-app-resolve.cjs>, <…/zcode.cjs>, …]`. */
export function isZCodeAppArgv(argv) {
  return (
    Array.isArray(argv) &&
    argv.length >= 4 &&
    argv[1] === '--require' &&
    typeof argv[2] === 'string' &&
    basename(argv[2]) === ZCODE_APP_HOOK_NAME &&
    typeof argv[3] === 'string' &&
    /[\\/]zcode\.cjs$/i.test(argv[3])
  )
}
