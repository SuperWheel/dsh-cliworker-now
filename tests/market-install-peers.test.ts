import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it } from 'vitest'
import { clientBundleDependencies, clientBundleDefines, selectBuildDependencies } from '../scripts/build-dependencies.mjs'
import type { NativeCliModelDirectory } from '../src/client/native-cli-model-directory.ts'
import type { Worker } from '../src/shared/types.ts'

interface Manifest {
  name: string
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}
const root = resolve('.')
const manifest = (path: string): Manifest => JSON.parse(readFileSync(path, 'utf8'))
const temporary: string[] = []
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }) })

function resolveManifest(name: string, declarer: string): string | undefined {
  // Match app-boot's packageDirFromAnchor: Node search paths from the
  // declarer, including packages whose exports hide package.json/the entry.
  for (const directory of createRequire(declarer).resolve.paths(name) ?? []) {
    const path = join(directory, name, 'package.json')
    if (existsSync(path)) return realpathSync(path)
  }
}

/** Installer scope: app + dependencies/peers only; no devDependencies or root fallback. */
function hostVisibleScope(appManifest: string): Set<string> {
  const seen = new Set<string>(), names = new Set<string>(), queue = [realpathSync(appManifest)]
  while (queue.length) {
    const path = queue.shift()!
    if (seen.has(path)) continue
    seen.add(path)
    const pkg = manifest(path)
    if (names.has(pkg.name)) continue
    names.add(pkg.name)
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })) {
      if (names.has(name)) continue
      const dependency = resolveManifest(name, path)
      if (dependency) queue.push(dependency)
    }
  }
  return names
}
function missingRequiredHostPeers(pkg: Manifest, scope: Set<string>): string[] {
  return Object.keys(pkg.peerDependencies ?? {}).filter(name =>
    (name === 'react' || name === 'react-dom' || name.startsWith('@deepseek-ai/')) &&
    !pkg.peerDependenciesMeta?.[name]?.optional && !scope.has(name),
  )
}

it('limits required host peers to the installed Harness closure and reproduces the old store failure', () => {
  const pkg = manifest(join(root, 'package.json'))
  const app = join(root, 'node_modules/@deepseek-ai/dsh/package.json')
  expect(manifest(app).version).toBe(pkg.devDependencies?.['@deepseek-ai/dsh'])
  const scope = hostVisibleScope(app)
  expect(scope.has('@deepseek-ai/dsh-client-store')).toBe(false)
  // Desktop 0.12.1 singletons (recomputed from its app.asar scope) absent from the npm SDK's app
  // manifest closure. This explicit allowlist does NOT extend the calculator's
  // scope, and must never include the dev-only snapshot store. All other
  // required singleton peers still fail strictly when outside the real closure.
  const desktopOnlyPeers = new Set([
    'react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-slots',
  ])
  expect(missingRequiredHostPeers(pkg, scope).filter(name => !desktopOnlyPeers.has(name))).toEqual([])
  expect(missingRequiredHostPeers({ name: 'old-plugin', peerDependencies: {
    '@deepseek-ai/dsh-client-store': '*',
  } }, scope)).toEqual(['@deepseek-ai/dsh-client-store'])
  expect(pkg.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-client-store')
  expect(pkg.peerDependenciesMeta ?? {}).not.toHaveProperty('@deepseek-ai/dsh-client-store')
})

it('follows nested declarers and cycles, ignores dev-only packages, and tolerates missing optional peers', () => {
  // Synthetic installer graph; no Desktop profile or external account is used.
  const directory = mkdtempSync(join(tmpdir(), 'cwn-peer-scope-')); temporary.push(directory)
  function pkg(path: string, value: Manifest, hideManifest = false) {
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'package.json'), JSON.stringify({ ...value,
      ...(hideManifest ? { exports: './index.js' } : {}),
    }))
    writeFileSync(join(path, 'index.js'), '')
  }
  pkg(directory, { name: 'app', dependencies: { branch: '*' }, devDependencies: { '@deepseek-ai/dev-only': '*' } })
  const branch = join(directory, 'node_modules/branch')
  pkg(branch, { name: 'branch', dependencies: { nested: '*' }, peerDependencies: { '@deepseek-ai/peer': '*' } })
  pkg(join(branch, 'node_modules/nested'), { name: 'nested', dependencies: { branch: '*' } }, true)
  pkg(join(branch, 'node_modules/@deepseek-ai/peer'), { name: '@deepseek-ai/peer' })
  pkg(join(directory, 'node_modules/nested'), { name: 'nested', dependencies: { '@deepseek-ai/root-only': '*' } })
  pkg(join(directory, 'node_modules/@deepseek-ai/root-only'), { name: '@deepseek-ai/root-only' })
  pkg(join(directory, 'node_modules/@deepseek-ai/dev-only'), { name: '@deepseek-ai/dev-only' })
  const scope = hostVisibleScope(join(directory, 'package.json'))
  expect([...scope].sort()).toEqual(['@deepseek-ai/peer', 'app', 'branch', 'nested'])
  expect(missingRequiredHostPeers({ name: 'plugin', peerDependencies: {
    '@deepseek-ai/peer': '*', '@deepseek-ai/missing': '*', '@deepseek-ai/optional': '*', 'ordinary-peer': '*',
  }, peerDependenciesMeta: { '@deepseek-ai/optional': { optional: true } } }, scope)).toEqual(['@deepseek-ai/missing'])
})

it('bundles the real model directory store and its engine while preserving host singleton imports', async () => {
  const selected = selectBuildDependencies(root, {})
  const { build } = await import(pathToFileURL(selected.require.resolve('tsdown')).href)
  const singletons = ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-primitives']
  const localPackages = ['@deepseek-ai/dsh-client-store', 'zustand', 'immer']
  mkdirSync(join(root, '.test-data'), { recursive: true })
  const directory = realpathSync.native(mkdtempSync(join(root, '.test-data/market-peer-bundle-')))
  temporary.push(directory)
  const entry = join(directory, 'entry.mjs')
  writeFileSync(entry, [
    `export * from ${JSON.stringify(pathToFileURL(join(root, 'src/client/native-cli-model-directory.ts')).href)}`,
    ...singletons.map((name, index) => `export * as singleton${index} from ${JSON.stringify(name)}`),
  ].join('\n'))
  let emitted = '', imports: string[] = [], modules: string[] = []
  await build({ entry: { regression: entry }, write: false, clean: false, dts: false,
    platform: 'browser', format: 'cjs', logLevel: 'silent', deps: clientBundleDependencies(), define: clientBundleDefines(),
    plugins: [{
      name: 'inspect-real-model-directory-and-singleton-probes',
      generateBundle(_options: unknown, bundle: Record<string, {
        type: string; code?: string; imports?: string[]; moduleIds?: string[]
      }>) {
        const chunks = Object.values(bundle).filter(item => item.type === 'chunk')
        emitted = chunks.map(item => item.code).join('\n')
        imports = chunks.flatMap(item => item.imports ?? [])
        modules = chunks.flatMap(item => item.moduleIds ?? []).map(id => id.replaceAll('\\', '/'))
      },
    }],
  })
  for (const name of localPackages) {
    expect(imports.some(id => id === name || id.startsWith(`${name}/`)), name).toBe(false)
    expect(modules.some(id => id.includes(`/node_modules/${name}/`)), name).toBe(true)
  }
  expect(emitted).not.toMatch(/(?:require\s*\(|\bfrom\s*|\bimport\s*\(?)\s*['"]@deepseek-ai\/dsh-client-store(?:\/[^'"]*)?['"]/)
  expect(emitted).not.toMatch(/\bprocess\.env|\bimport\.meta/)
  for (const name of singletons) expect(imports, name).toContain(name)
  expect(modules.filter(id => /\/node_modules\/(?:react|react-dom|@deepseek-ai\/(?:cordis|dsh-client-ui-primitives))\//.test(id))).toEqual([])
  // Exercise the emitted CJS engine too (including Zustand's import.meta
  // conversion), rather than assuming a successful build proves runtime use.
  const module = { exports: {} as { NativeCliModelDirectory: typeof NativeCliModelDirectory } }
  runInNewContext(emitted, { module, exports: module.exports, AbortController, console,
    require(name: string) {
      // Simulated host provides the singleton probes; only the real React
      // exports can be used by the bundled engine's shallow helper.
      if (!singletons.includes(name)) throw new Error(`Unexpected external import: ${name}`)
      return name === 'react' ? selected.require(name) : {}
    },
  })
  const worker = { id: 'synthetic-worker', parentSessionId: 'synthetic-parent',
    preference: { cli: 'codex', model: 'synthetic-model', effort: 'low' } } as Worker
  const directoryStore = new module.exports.NativeCliModelDirectory({} as never, worker.parentSessionId, worker)
  const store = directoryStore.store, before = store.getSnapshot()
  let notifications = 0
  const unsubscribe = store.subscribe(() => { notifications++ })
  const next = { ...before, status: 'loading' as const }
  store.set(next)
  expect(store.getSnapshot()).toBe(next)
  expect(notifications).toBe(1)
  store.set(next)
  expect(notifications).toBe(1)
  unsubscribe()
  store.set(before)
  expect(notifications).toBe(1)
  directoryStore.dispose()
})
