// Read-only preflight and disposable settings projection. No migration or disk writes.
import { createRequire } from 'node:module'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { hostRuntimePackages, verifyHostRuntime } from './host-runtime.mjs'

export const inject = ['loader', 'profileContext', 'configEditor', 'settings']
export const readyService = 'cliworkerNativeReady'
const settingsIds = ['ui-chat', 'ui-conversation']
const prefix = 'CLI Worker 原生界面安装冲突'
const fail = (kind, id) => { throw new Error(`${prefix}：${kind}${id ? ` (${id})` : ''}。请保留配置，退出宿主后检查覆盖或卸载本插件；不要反复重启。`) }
const flatten = rows => rows.flatMap(row => [row, ...(row.group && Array.isArray(row.config) ? flatten(row.config) : [])])

function packageOf(name) {
  if (typeof name !== 'string') return undefined
  if (hostRuntimePackages.some(id => name === `@deepseek-ai/dsh-client-${id}`)) return name
  if (!name.startsWith('file:') && !isAbsolute(name)) return undefined
  let directory = dirname(name.startsWith('file:') ? fileURLToPath(name) : name)
  // No directory walks or network lookups: at most twelve ancestor manifests per file entry.
  for (let depth = 0; depth < 12; depth++) {
    const file = join(directory, 'package.json')
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).name
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return undefined
}

/** Entries are the Loader's effective inventory; duplicate config IDs are already reconciled. */
export function inspectHostRuntimeEntries(entries, rawRows, patches, root) {
  const effective = [...entries]
  for (const id of hostRuntimePackages) {
    const canonical = `@deepseek-ai/dsh-client-${id}`
    const sources = effective.filter(entry => !entry.disabled && packageOf(entry.options.name) === canonical)
    if (sources.length !== 1) fail(sources.length ? 'duplicate-module-source' : 'missing-module-source', id)
    const selected = sources[0]
    if (selected.options.id !== `cliworker-${id}`) fail('external-module-override', id)
    const expected = realpathSync(join(root, 'runtime-host', `dsh-client-${id}`, 'lib/index.js'))
    const name = selected.options.name
    if (!name.startsWith('file:') || realpathSync(fileURLToPath(name)) !== expected) fail('external-module-override', id)
    const originals = effective.filter(entry => entry.options.id === id)
    if (originals.length !== 1 || !originals[0].disabled || originals[0].options.name !== canonical) fail('invalid-stock-settings-source', id)
    const stock = originals[0].options
    // These two schemas have canonical settings namespaces. The adapter below
    // projects their stock config without copying or relocating user data.
    const aliased = settingsIds.includes(id)
    if (aliased && selected.options.config !== undefined) fail('private-entry-settings', id)
    // A later name assertion would be silently skipped by the official patch dialect.
    for (const patch of patches)
      if (!patch.insert && patch.name && ((patch.id === id && patch.name !== stock.name) ||
          (patch.id === selected.options.id && patch.name !== name))) fail('setting-source-assertion', id)
    // Do not discard settings attached to a replaced row in an earlier bundle.
    for (const previous of [stock, ...flatten(rawRows).filter(row => row.id === id && row.name !== name)]) {
      for (const key of aliased ? ['isolate', 'intercept'] : ['config', 'isolate', 'intercept'])
        if (previous[key] !== undefined && JSON.stringify(previous[key]) !== JSON.stringify(selected.options[key])) fail('preexisting-entry-settings', id)
      if (previous.inject !== undefined && JSON.stringify(previous.inject) !== JSON.stringify(selected.options.inject)) fail('preexisting-entry-inject', id)
    }
  }
  return true
}

/**
 * Give the native ConfigEditor a canonical settings view, not a second Loader
 * entry. Its own edit transaction still owns locking, validation, revision
 * checks, layer precedence, persistence, rollback and reconciliation.
 * Only the two browser-only UI schemas are projected; no Host task config is
 * forwarded. Their apply() functions only register settings presentation.
 */
/**
 * Register the stock row's no-auto-page policy for its vendor fiber proxy.
 * Hosts up to 0.2.1 key policies by the passed fiber object, so the proxy needs its own.
 * 0.2.2 normalizes both registration and lookup to `owner.ctx.fiber`: the proxy then
 * resolves to the vendor fiber, which the official package already configured itself
 * with `{ auto: false }`, so that policy is reused instead of registered twice.
 */
function configurePresentation(ctx, fiber) {
  const real = fiber.ctx?.fiber
  try {
    return ctx.settings.configure({ auto: false }, fiber)
  } catch (error) {
    if (real === undefined || real === fiber || !/already configured/u.test(String(error?.message))) throw error
    return () => {}
  }
}

export function installHostSettingsAliases(ctx,{ resolveConfig, interpolate }, root) {
  const editor = ctx.configEditor
  const original = editor.entries
  if (typeof original !== 'function' || typeof ctx.settings.configure !== 'function') fail('missing-settings-interface')
  const descriptor = Object.getOwnPropertyDescriptor(editor, 'entries')
  const cached = new Map()
  let active = true
  const expected = new Map(settingsIds.map(id => [id, realpathSync(join(root, 'runtime-host', `dsh-client-${id}`, 'lib/index.js'))]))
  const release = id => { cached.get(id)?.dispose(); cached.delete(id) }
  function entries(...args) {
    const all = original.apply(this, args)
    if (!active) return all
    const hidden = new Set()
    const replacements = new Map()
    for (const id of settingsIds) {
      const stock = all.find(entry => entry.options.id === id)
      const vendor = all.find(entry => entry.options.id === `cliworker-${id}`)
      if (!stock?.disabled || vendor?.disabled || vendor?.fiber?.state !== 2) { release(id); continue }
      if (stock.options.name !== `@deepseek-ai/dsh-client-${id}` ||
          !vendor.options.name.startsWith('file:') || realpathSync(fileURLToPath(vendor.options.name)) !== expected.get(id)) fail('external-module-override', id)
      if (vendor.options.config !== undefined) fail('private-entry-settings', id)
      for (const key of ['isolate', 'intercept'])
        if (stock.options[key] !== undefined && JSON.stringify(stock.options[key]) !== JSON.stringify(vendor.options[key])) fail('preexisting-entry-settings', id)
      if (stock.options.inject !== undefined && JSON.stringify(stock.options.inject) !== JSON.stringify(vendor.options.inject)) fail('preexisting-entry-inject', id)
      let record = cached.get(id)
      if (record?.stock !== stock || record?.vendor !== vendor.fiber) {
        release(id)
        const fiber = new Proxy(vendor.fiber, { get(target, key) {
          // 0.2.2 settings read the resolved `effectiveConfig`; earlier hosts read `config`.
          if (key === 'config' || key === 'effectiveConfig') return resolveConfig(target.runtime, interpolate(target.ctx, stock.options.config ?? {}))
          return Reflect.get(target, key, target)
        } })
        const entry = new Proxy(stock, { get(target, key) {
          return key === 'fiber' ? fiber : Reflect.get(target, key, target)
        } })
        record = { stock, vendor: vendor.fiber, entry, dispose: configurePresentation(ctx, fiber) }
        cached.set(id, record)
      }
      hidden.add(vendor)
      replacements.set(stock, record.entry)
    }
    return all.filter(entry => !hidden.has(entry)).map(entry => replacements.get(entry) ?? entry)
  }
  Object.defineProperty(editor, 'entries', { value: entries, writable: true, configurable: true })
  return () => {
    active = false
    // Do not overwrite a later extension's wrapper during teardown.
    if (Object.getOwnPropertyDescriptor(editor, 'entries')?.value === entries) {
      if (descriptor) Object.defineProperty(editor, 'entries', descriptor)
      else delete editor.entries
    }
    for (const id of [...cached.keys()]) release(id)
  }
}

export async function apply(ctx) {
  const directory = dirname(fileURLToPath(import.meta.url))
  const root = resolve(directory, basename(directory) === 'native-runtime-guard' ? '../..' : '..')
  try {
    verifyHostRuntime(root, { sourcePatch: false })
    const profile = ctx.profileContext
    let patches = []
    if (profile) {
      const require = createRequire(profile.installAnchor)
      const { loadOptionalPatches } = require(require.resolve('@deepseek-ai/dsh-app-boot'))
      if (typeof loadOptionalPatches !== 'function') fail('missing-profile-patch-interface')
      patches = [profile.patchPath, join(profile.home, 'cordis.patch.yml')]
        .flatMap(path => loadOptionalPatches('CLI Worker', path) ?? [])
        .concat(profile.overlays ?? [])
    }
    inspectHostRuntimeEntries(ctx.loader.entries(), ctx.loader.root.data, patches, root)
    const require = createRequire(profile.installAnchor)
    const [{ resolveConfig }, { interpolate }] = await Promise.all([
      import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href),
      import(pathToFileURL(require.resolve('@deepseek-ai/cordis-plugin-loader')).href),
    ])
    ctx.effect(() => installHostSettingsAliases(ctx, { resolveConfig, interpolate }, root))
    ctx.provide(readyService, Object.freeze({ verified: true }))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(prefix)) throw error
    fail('runtime-verification-failed')
  }
}
