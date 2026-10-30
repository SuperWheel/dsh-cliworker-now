import { afterEach, expect, it } from 'vitest'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { normalizeHostClient, verifyHostRuntime } from '../scripts/host-runtime.mjs'
import { inspectHostRuntimeEntries, installHostSettingsAliases } from '../scripts/host-extension-guard.mjs'
import { selectBuildDependencies } from '../scripts/build-dependencies.mjs'

const root = resolve('.')
const ids = ['ui-session', 'ui-conversation', 'ui-subagent', 'ui-chat']
const temporary: string[] = []
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'cwn-native-package-'))
  temporary.push(directory)
  cpSync(join(root, 'runtime-host'), join(directory, 'runtime-host'), { recursive: true })
  return directory
}
function rows(directory = root) {
  return ids.map(id => ({ id: `cliworker-${id}`, name: pathToFileURL(join(directory, 'runtime-host', `dsh-client-${id}`, 'lib/index.js')).href,
    inject: ['cliworkerNativeReady'] }))
}
const stockRows = () => ids.map(id => ({ id, name: `@deepseek-ai/dsh-client-${id}` }))
const entries = (items: ReturnType<typeof rows>, stock = stockRows()) => [
  ...items.map(options => ({ options, disabled: false })), ...stock.map(options => ({ options, disabled: true })),
]

it('ships four canonical browser packages, exact source provenance, licenses and no private build input', () => {
  const manifest = verifyHostRuntime(root)
  expect(manifest.packages.map((pkg: any) => pkg.name)).toEqual(ids.map(id => `@deepseek-ai/dsh-client-${id}`))
  expect(manifest.upstream).toMatchObject({ version: '0.2.1-rc.5', commit: 'b830ec950faba0a46dda564be3e2d854afed94f1' })
  expect(manifest.packages.find((pkg: any) => pkg.id === 'ui-chat').externalRequirements['@tanstack/react-virtual']).toBe('3.14.10')
  expect(manifest.files.some((file: any) => /build-inputs|\.map$|node_modules|\.cache/.test(file.path))).toBe(false)
  for (const pkg of manifest.packages) expect(readFileSync(join(root, 'runtime-host', pkg.directory, 'LICENSE'), 'utf8')).toContain('MIT')
  const json = JSON.stringify(manifest)
  expect(json).not.toMatch(/\/Users\/|\/home\/|installedDesktopBuildCommit/)
})

it('only normalizes generated region comments and removes an unused map link', () => {
  const source = '\t//#region \\0dsh-css:/Users/example/project/.cache/host/packages/client/ui-chat/a.css.mjs\nconst value = 7;\n//# sourceMappingURL=client.js.map\n'
  expect(normalizeHostClient(source)).toBe('\t//#region \\0dsh-css:packages/client/ui-chat/a.css.mjs\nconst value = 7;\n')
  expect(normalizeHostClient('const value = "/Users/example/important";\n')).toBe('const value = "/Users/example/important";\n')
})

it('refuses changed or extra runtime files instead of shipping an unverified extension', () => {
  const directory = fixture()
  writeFileSync(join(directory, 'runtime-host/dsh-client-ui-chat/lib/client.js'), 'changed')
  expect(() => verifyHostRuntime(directory)).toThrow('runtime-content-mismatch')
  cpSync(join(root, 'runtime-host/dsh-client-ui-chat/lib/client.js'), join(directory, 'runtime-host/dsh-client-ui-chat/lib/client.js'))
  writeFileSync(join(directory, 'runtime-host/private.json'), '{}')
  expect(() => verifyHostRuntime(directory)).toThrow('runtime-inventory-mismatch')
})

it('keeps effective per-entry settings and refuses silently discarded earlier settings', () => {
  const selected = rows()
  const stock = stockRows()
  const raw = [...stock, ...selected]
  Object.assign(stock[3]!, { config: { transcriptView: 'detailed' } })
  expect(inspectHostRuntimeEntries(entries(selected, stock), raw, [{ id: 'ui-chat', name: stock[3]!.name, config: { transcriptView: 'detailed' } }], root)).toBe(true)
  expect((stock[3] as any).config).toEqual({ transcriptView: 'detailed' })
  expect(selected[3]).not.toHaveProperty('config')
  Object.assign(raw[0]!, { config: { existing: true } })
  expect(() => inspectHostRuntimeEntries(entries(selected), raw, [], root)).toThrow('preexisting-entry-settings (ui-session)')
})

it('refuses foreign sources, duplicate canonical identities, disabled interfaces and skipped source assertions', () => {
  const selected = rows()
  const active = entries(selected)
  expect(() => inspectHostRuntimeEntries([...active, { options: { ...selected[0], id: 'custom-native-ui-session' }, disabled: false }], selected, [], root)).toThrow('duplicate-module-source (ui-session)')
  expect(() => inspectHostRuntimeEntries(active.map((entry, index) => index ? entry : { ...entry, disabled: true }), selected, [], root)).toThrow('missing-module-source (ui-session)')
  expect(() => inspectHostRuntimeEntries(active, selected, [{ id: 'ui-chat', name: './foreign.js', config: { transcriptView: 'compact' } }], root)).toThrow('setting-source-assertion (ui-chat)')
  const foreign = active.map((entry, index) => index ? entry : { ...entry, options: { id: 'ui-session', name: '@deepseek-ai/dsh-client-ui-session' } })
  expect(() => inspectHostRuntimeEntries(foreign, selected, [], root)).toThrow('external-module-override (ui-session)')
})

it('activates the real official Loader without a ready-service cycle and restores official identities on cold restart', async () => {
  const directory = fixture()
  const guard = join(directory, 'lib/native-runtime-guard')
  mkdirSync(guard, { recursive: true })
  cpSync(join(root, 'scripts/host-extension-guard.mjs'), join(guard, 'index.mjs'))
  cpSync(join(root, 'scripts/host-runtime.mjs'), join(guard, 'host-runtime.mjs'))
  writeFileSync(join(guard, 'package.json'), JSON.stringify({ name: 'dsh-cliworker-native-preflight', type: 'module' }))
  const selected = selectBuildDependencies(root)
  // The in-memory Loader has no launcher interception; give this temporary
  // package the same verified SDK graph without changing its installed files.
  symlinkSync(selected.modules, join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const installAnchor = selected.require.resolve('@deepseek-ai/dsh/package.json')
  const require = createRequire(installAnchor)
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
  const { Loader } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis-plugin-loader')).href)
  const { ClientModuleRegistry } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-modules')).href)
  const { SettingsForms } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-settings')).href)
  const original = stockRows()
  async function mount(embedded: boolean) {
    const ctx = new Context()
    ctx.baseUrl = pathToFileURL(directory + '/').href
    ctx.provide('profileContext', { installAnchor, patchPath: join(directory, 'user.patch.yml'), home: directory, overlays: [] })
    await ctx.plugin(Loader)
    ctx.provide('configEditor', {
      entries: () => [...ctx.loader.entries()],
      configuration() { return this.entries().map(entry => ({ entry, inherited: {}, override: {} })) },
    })
    await ctx.plugin(SettingsForms)
    try {
      const configured = embedded ? [...original.map(row => ({ ...row, disabled: true })), { id: 'cliworker-native-preflight', name: pathToFileURL(join(guard, 'index.mjs')).href }, ...rows(directory)] : original.map(row => ({ ...row, name: pathToFileURL(require.resolve(row.name)).href }))
      await ctx.loader.root.update(configured)
      await ctx.loader.await()
      if (embedded) expect(ctx.cliworkerNativeReady).toEqual({ verified: true })
      // FiberState is a const enum, erased from official runtime exports.
      for (const entry of ctx.loader.entries()) if (!entry.disabled) expect(entry.fiber?.state, `${embedded ? 'embedded' : 'official'} ${entry.options.id}`).toBe(2)
      expect(ctx.settings.describe().map((form: any) => form.ns).sort()).toEqual(['ui-chat', 'ui-conversation'])
      await ctx.plugin(ClientModuleRegistry)
      expect(ctx.clientModules.graph().entries.map((entry: any) => entry.id).sort()).toEqual(ids.map(id => `@deepseek-ai/dsh-client-${id}`).sort())
      const clientPath = ctx.clientModules.clientPath('@deepseek-ai/dsh-client-ui-session')
      expect(clientPath.includes('runtime-host')).toBe(embedded)
    } finally { ctx.loader.root.stop(); await ctx.fiber.dispose() }
  }
  await mount(true)
  await mount(false)
})

it('inserts only plugin-owned ids and restores stock rows when the bundle is omitted', async () => {
  const selected = selectBuildDependencies(root)
  const require = createRequire(selected.require.resolve('@deepseek-ai/dsh/package.json'))
  const { composeEntries, loadOptionalPatches } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
  const patch = loadOptionalPatches('test', join(root, 'cordis.patch.yml'))
  const owned = patch.flatMap((row: any) => row.insert ?? []).map((row: any) => row.id)
  expect(owned).toEqual(['cliworker-native-preflight', ...ids.map(id => `cliworker-${id}`), 'cliworker-now'])
  expect(owned.every((id: string) => id.startsWith('cliworker-'))).toBe(true)
  expect(patch.filter((row: any) => !row.insert)).toEqual(ids.map(id => ({ id, disabled: true })))
  const base = [{ insert: stockRows() }]
  const enabled = composeEntries([base, patch])
  expect(enabled.filter((row: any) => ids.includes(row.id)).every((row: any) => row.disabled === true)).toBe(true)
  // Model the market's name-or-inserted-id ownership replay, including a Loader prefix.
  const owns = (row: any) => row.name === 'dsh-cliworker-now' || row.name.startsWith('dsh-cliworker-now/') || owned.includes(row.id.split(':').at(-1))
  for (const row of stockRows()) expect(owns({ ...row, id: `include:${row.id}` })).toBe(false)
  const disabled = composeEntries([base]).map((row: any) => owns(row) ? { ...row, disabled: true } : row)
  expect(disabled).toEqual(stockRows())
})

it('rejects private settings, stock overrides and incompatible inherited scopes', () => {
  const selected = rows()
  const stock = stockRows()
  const inspect = () => inspectHostRuntimeEntries(entries(selected, stock), stock, [], root)
  Object.assign(selected[3]!, { config: { transcriptView: 'compact' } })
  expect(inspect).toThrow('private-entry-settings (ui-chat)')
  delete (selected[3] as any).config
  Object.assign(stock[3]!, { isolate: { settings: 'other' } })
  expect(inspect).toThrow('preexisting-entry-settings (ui-chat)')
  delete (stock[3] as any).isolate
  Object.assign(stock[3]!, { inject: ['other'] })
  expect(inspect).toThrow('preexisting-entry-inject (ui-chat)')
  delete (stock[3] as any).inject
  stock[3]!.name = 'foreign-ui-chat'
  expect(inspect).toThrow('invalid-stock-settings-source (ui-chat)')
})

it('projects canonical settings through native validation, revisions, reset and disposable aliases', async () => {
  const directory = fixture()
  const selected = selectBuildDependencies(root)
  symlinkSync(selected.modules, join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const require = createRequire(selected.require.resolve('@deepseek-ai/dsh/package.json'))
  const { Context, resolveConfig } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
  const { Loader, interpolate } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis-plugin-loader')).href)
  const { SettingsForms } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-settings')).href)
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(directory + '/').href
  ctx.provide('profileContext', { home: directory })
  await ctx.plugin(Loader)
  const writes: string[] = []
  // Only persistence is simulated; SettingsForms and Loader use the installed SDK.
  const editor = {
    entries: () => [...ctx.loader.entries()],
    configuration() { return this.entries().map(entry => ({ entry, inherited: {}, override: entry.options.config ?? {} })) },
    async edit(entry: any, change: any) {
      const next = change(structuredClone(entry.options.config ?? {}), {})
      writes.push(entry.options.id)
      entry.options.config = next
    },
  }
  ctx.provide('configEditor', editor)
  let dispose: (() => void) | undefined
  try {
    const stock = stockRows().map(row => ({ ...row, disabled: true, ...(row.id === 'ui-chat' ? { config: { transcriptView: 'detailed' } } : {}) }))
    await ctx.loader.root.update([...stock, ...rows(directory).map(({ inject: _inject, ...row }) => row)])
    await ctx.loader.await()
    await ctx.plugin(SettingsForms)
    const original = Object.getOwnPropertyDescriptor(editor, 'entries')
    dispose = installHostSettingsAliases(ctx, { resolveConfig, interpolate }, directory)
    const form = () => ctx.settings.describe().find((form: any) => form.ns === 'ui-chat')!
    expect(form().autoGenerate).toBe(false)
    expect(form().value.transcriptView).toBe('detailed')
    const revision = form().revision
    await ctx.settings.update('ui-chat', { transcriptView: 'compact' }, revision)
    expect(form().value.transcriptView).toBe('compact')
    await expect(ctx.settings.update('ui-chat', { transcriptView: 'verbose' }, revision)).rejects.toThrow('changed since it was read')
    await expect(ctx.settings.update('ui-chat', { unknownField: true })).rejects.toThrow('not volatile')
    await ctx.settings.mutate('ui-chat', [{ op: 'unset', path: ['transcriptView'] }])
    expect(form().value.transcriptView).toBeUndefined()
    await ctx.settings.replace('ui-conversation', { busyEnter: 'steer' })
    expect(writes).toEqual(['ui-chat', 'ui-chat', 'ui-conversation'])
    const native = [...ctx.loader.entries()].find((entry: any) => entry.options.id === 'ui-chat')!
    expect(native.disabled).toBe(true)
    expect(native.fiber).toBeUndefined()
    expect(ctx.settings.describe().map((form: any) => form.ns).sort()).toEqual(['ui-chat', 'ui-conversation'])
    dispose(); dispose = undefined
    expect(Object.getOwnPropertyDescriptor(editor, 'entries')).toEqual(original)
    expect(ctx.settings.describe().map((form: any) => form.ns).sort()).toEqual(['cliworker-ui-chat', 'cliworker-ui-conversation'])
    const detach = installHostSettingsAliases(ctx, { resolveConfig, interpolate }, directory)
    const inner = editor.entries
    const laterWrapper = () => inner.call(editor)
    editor.entries = laterWrapper
    expect(form().ns).toBe('ui-chat')
    detach()
    expect(editor.entries).toBe(laterWrapper)
    expect(ctx.settings.describe().map((form: any) => form.ns).sort()).toEqual(['cliworker-ui-chat', 'cliworker-ui-conversation'])
  } finally { dispose?.(); ctx.loader.root.stop(); await ctx.fiber.dispose() }
})

it('requires a settings compatibility bridge before replacing canonical Loader ids with private ids', async () => {
  // Simulated candidate composition, real official Loader and SettingsForms.
  // A healthy client-module graph alone does not prove native settings still work.
  const directory = fixture()
  const selected = selectBuildDependencies(root)
  symlinkSync(selected.modules, join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const require = createRequire(selected.require.resolve('@deepseek-ai/dsh/package.json'))
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
  const { Loader } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis-plugin-loader')).href)
  const { SettingsForms } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-settings')).href)
  const { ClientModuleRegistry } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-modules')).href)
  for (const privateIds of [false, true]) {
    const ctx = new Context()
    ctx.baseUrl = pathToFileURL(directory + '/').href
    ctx.provide('profileContext', { home: directory })
    await ctx.plugin(Loader)
    // Fixture config-editor projection; no disk write and no model dispatch.
    ctx.provide('configEditor', {
      entries: () => [...ctx.loader.entries()],
      configuration() { return this.entries().map(entry => ({ entry, inherited: {}, override: {} })) },
      edit: () => { throw new Error('fixture must not persist settings') },
    })
    try {
      const stock = privateIds ? ids.map(id => ({ id, name: `@deepseek-ai/dsh-client-${id}`, disabled: true })) : []
      const embedded = rows(directory).map(({ inject: _inject, ...row }) => ({ ...row, id: privateIds ? row.id : row.id.replace(/^cliworker-/, '') }))
      await ctx.loader.root.update([...stock, ...embedded])
      await ctx.loader.await()
      await ctx.plugin(SettingsForms)
      await ctx.plugin(ClientModuleRegistry)
      expect(ctx.clientModules.graph().entries.map((entry: any) => entry.id).sort()).toEqual(ids.map(id => `@deepseek-ai/dsh-client-${id}`).sort())
      const namespaces = ctx.settings.describe().map((form: any) => form.ns)
      expect(namespaces.sort()).toEqual((privateIds ? ['cliworker-ui-chat', 'cliworker-ui-conversation'] : ['ui-chat', 'ui-conversation']).sort())
      if (privateIds) {
        await expect(ctx.settings.update('ui-chat', { transcriptView: 'compact' })).rejects.toThrow('No configurable plugin entry "ui-chat"')
        await expect(ctx.settings.update('ui-conversation', { busyEnter: 'steer' })).rejects.toThrow('No configurable plugin entry "ui-conversation"')
      }
    } finally { ctx.loader.root.stop(); await ctx.fiber.dispose() }
  }
})
