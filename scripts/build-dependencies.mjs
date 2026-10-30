// Select a single verified SDK graph without replacing the repository's installed links.
import { existsSync, readFileSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'

const json = path => JSON.parse(readFileSync(path, 'utf8'))
export function selectBuildDependencies(root, environment = process.env) {
  const manifest = json(join(root, 'package.json'))
  const target = manifest.devDependencies?.['@deepseek-ai/dsh']
  const isolatedRoots = { '0.2.0-rc.2': '.cache/cliworker-build-deps-020rc2',
    '0.2.1-rc.1': '.cache/cliworker-build-deps-021rc1', '0.2.1-rc.2': '.cache/cliworker-build-deps-021rc2', '0.2.1-rc.3': '.cache/cliworker-build-deps-021rc3',
    '0.2.1-rc.5': '.cache/cliworker-build-deps-021rc5' }
  if (!Object.hasOwn(isolatedRoots, target)) throw new Error('Unsupported pinned DSH build target')
  const candidate = environment.CLIWORKER_BUILD_DEPS
    ? resolve(environment.CLIWORKER_BUILD_DEPS)
    : existsSync(join(root, 'node_modules/@deepseek-ai/dsh/package.json')) && json(join(root, 'node_modules/@deepseek-ai/dsh/package.json')).version === target
      ? root : join(root, isolatedRoots[target])
  const modules = realpathSync(join(candidate, 'node_modules'))
  const sdk = json(join(modules, '@deepseek-ai/dsh/package.json'))
  if (sdk.name !== '@deepseek-ai/dsh' || sdk.version !== target) throw new Error('Build dependency SDK differs from the pinned target')
  for (const [name, version] of Object.entries(manifest.devDependencies ?? {})) {
    if (!name.startsWith('@deepseek-ai/')) continue
    const installed = json(join(modules, name, 'package.json'))
    if (installed.version !== version) throw new Error(`Build dependency differs: ${name}@${version}`)
  }
  return { target, modules, directory: candidate, require: createRequire(join(candidate, 'package.json')) }
}

export function buildTypeConfig(root, dependencies, project, noEmit = false) {
  const paths = {}
  const manifest = json(join(root, 'package.json'))
  for (const name of Object.keys(manifest.devDependencies ?? {})) {
    if (!name.startsWith('@deepseek-ai/')) continue
    const directory = realpathSync(join(dependencies.modules, name))
    const pkg = json(join(directory, 'package.json'))
    for (const [key, value] of Object.entries(pkg.exports ?? {})) {
      const target = typeof value?.types === 'string' ? value.types : undefined
      if (target) paths[name + (key === '.' ? '' : key.slice(1))] = [join(directory, target)]
    }
  }
  const directory = join(root, '.cache/build-configs')
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `${project.replace(/\.json$/, '')}-${dependencies.target}${noEmit ? '-check' : ''}.json`)
  writeFileSync(path, JSON.stringify({ extends: join(root, project), compilerOptions: {
    paths, composite: false, incremental: false, ...(noEmit ? { noEmit: true } : {}),
  } }, null, 2) + '\n')
  return path
}

/** Official client preset marks typert-protocol as inline-safe, not a platform seed.
 * Generated rc.1 remote descriptors import its pure remote-info subpath. */
export function clientBundleDependencies() {
  return {
    alwaysBundle: ['zod', '@xterm/xterm', '@xterm/addon-fit', 'dsh-cliworker-now/remote',
      // Per-instance model directory state: official packages inline this dev-only
      // engine; it is not a host-visible singleton in market installations.
      '@deepseek-ai/dsh-client-store', 'zustand/vanilla', 'zustand/middleware', 'zustand/shallow', 'immer',
      /^@deepseek-ai\/dsh-typert-protocol(?:\/|$)/],
    neverBundle: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-ui-primitives'],
  }
}

/** Inlined browser state engines must not depend on Node's process global or
 * Vite's import.meta.env at runtime in the Harness CJS module factory. */
export function clientBundleDefines() {
  return { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"MODE":"production"}' }
}

/** Resolve generated Typert imports from the selected SDK, even when the entry
 * lives under a repository that still has an older installed SDK. */
export function selectedTypertResolver(dependencies) {
  return {
    name: 'cliworker-selected-typert-sdk',
    resolveId: {
      order: 'pre',
      handler(id) {
        if (!/^@deepseek-ai\/dsh-typert(?:-|\/|$)/u.test(id)) return null
        // Do not fall back to the importer/root graph if the selected SDK lacks an export.
        return dependencies.require.resolve(id)
      },
    },
  }
}
