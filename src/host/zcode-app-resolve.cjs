'use strict'
/**
 * Preloaded (`--require`) only when a ZCode Worker runs the desktop app's own
 * `glm/zcode.cjs` under that app's Electron (`ELECTRON_RUN_AS_NODE=1`).
 *
 * The bundled CLI imports two packages by bare name which the app ships inside
 * `app.asar`, outside the entry's own lookup chain: `@napi-rs/keyring` and
 * `playwright-core`. After normal resolution has failed, exactly those two
 * names are resolved again from the same installation's `app.asar`. Nothing
 * else is redirected, nothing is downloaded and no file is written.
 *
 * Inert when the resources directory is not given, `app.asar` is absent, or the
 * runtime has no synchronous resolution hooks.
 */
const ENVIRONMENT = 'CLIWORKER_ZCODE_APP_RESOURCES'
const REDIRECTED = new Set(['@napi-rs/keyring', 'playwright-core'])

function install(resources, dependencies = {}) {
  const fs = dependencies.fs ?? require('node:fs')
  const path = dependencies.path ?? require('node:path')
  const registerHooks =
    'registerHooks' in dependencies ? dependencies.registerHooks : require('node:module').registerHooks
  const createRequire = dependencies.createRequire ?? require('node:module').createRequire
  const { pathToFileURL } = require('node:url')
  if (typeof resources !== 'string' || !path.isAbsolute(resources) || typeof registerHooks !== 'function')
    return false
  // Electron presents the archive as a directory; a plain Node reports a file.
  if (!fs.existsSync(path.join(resources, 'app.asar'))) return false
  const parent = path.join(resources, 'app.asar', 'node_modules', 'cliworker-resolve.cjs')
  const parentURL = pathToFileURL(parent).href
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context)
      } catch (error) {
        if (!REDIRECTED.has(specifier)) throw error
        try {
          return nextResolve(specifier, { ...context, parentURL })
        } catch {
          /* require() ignores a substituted parent; resolve it as CommonJS below. */
        }
        try {
          return { url: pathToFileURL(createRequire(parent).resolve(specifier)).href, shortCircuit: true }
        } catch {
          // Report the CLI's own failure, not the fallback's.
          throw error
        }
      }
    },
  })
  return true
}

module.exports = { install, ENVIRONMENT, REDIRECTED }
// As a preload the variable is consumed once; the CLI and its children never see it.
if (require.main !== module && process.env[ENVIRONMENT] !== undefined) {
  const resources = process.env[ENVIRONMENT]
  delete process.env[ENVIRONMENT]
  try {
    install(resources)
  } catch {
    /* A failed preload must not stop the CLI; unresolved imports keep their native error. */
  }
}
