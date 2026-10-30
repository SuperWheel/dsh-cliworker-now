import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { selectBuildDependencies, buildTypeConfig } from '../scripts/build-dependencies.mjs'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(target = '0.2.1-rc.1') {
  const root = mkdtempSync(join(tmpdir(), 'cwn-sdk-build-')); roots.push(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { '@deepseek-ai/dsh': target } }))
  writeFileSync(join(root, 'tsconfig.client.json'), '{}')
  return root
}
function sdk(root: string, version: string) {
  const path = join(root, 'node_modules/@deepseek-ai/dsh')
  mkdirSync(join(path, 'lib'), { recursive: true })
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version,
    exports: { '.': { types: './lib/index.d.ts', default: './lib/index.js' } } }))
  writeFileSync(join(path, 'lib/index.d.ts'), 'export {}')
}
it('builds against the pinned isolated SDK while preserving old installed dependencies', () => {
  const root = fixture(); sdk(root, '0.2.0-rc.2')
  const isolated = join(root, '.cache/cliworker-build-deps-021rc1'); mkdirSync(isolated, { recursive: true })
  writeFileSync(join(isolated, 'package.json'), '{}'); sdk(isolated, '0.2.1-rc.1')
  const old = readFileSync(join(root, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')
  const selected = selectBuildDependencies(root, {})
  expect(selected.directory).toBe(isolated)
  const config = JSON.parse(readFileSync(buildTypeConfig(root, selected, 'tsconfig.client.json', true), 'utf8'))
  expect(config.compilerOptions.paths['@deepseek-ai/dsh'][0]).toContain(isolated)
  expect(config.compilerOptions.noEmit).toBe(true)
  expect(readFileSync(join(root, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).toBe(old)
})
it('rejects an explicit SDK of another version instead of silently falling back', () => {
  const root = fixture(); sdk(root, '0.2.0-rc.2')
  expect(() => selectBuildDependencies(root, { CLIWORKER_BUILD_DEPS: root })).toThrow('differs from the pinned target')
})
it('supports a reproducible ordinary install of the pinned SDK without requiring a cache', () => {
  const root = fixture(); sdk(root, '0.2.1-rc.1')
  expect(selectBuildDependencies(root, {}).directory).toBe(root)
})

it('resolves generated rc1 Typert imports from the actual repository entry without using its old rc2 graph', async () => {
  const { createRequire } = await import('node:module')
  const { resolve } = await import('node:path')
  const { pathToFileURL } = await import('node:url')
  const { selectedTypertResolver, clientBundleDependencies } = await import('../scripts/build-dependencies.mjs')
  const root = resolve('.')
  const selected = selectBuildDependencies(root, {})
  const rootRequire = createRequire(join(root, 'package.json'))
  const id = '@deepseek-ai/dsh-typert-protocol/remote-info'
  // This checkout intentionally retains rc2 root links, reproducing formal-build resolution.
  const rootSdk = JSON.parse(readFileSync(join(root, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version
  if (rootSdk === '0.2.0-rc.2') expect(() => rootRequire.resolve(id)).toThrow()
  else expect(rootRequire.resolve(id)).toBe(selected.require.resolve(id))
  const plugin = selectedTypertResolver(selected)
  expect(plugin.resolveId.handler(id)).toBe(selected.require.resolve(id))
  expect(plugin.resolveId.handler('@deepseek-ai/dsh-client-ui-chat')).toBeNull()
  expect(() => plugin.resolveId.handler('@deepseek-ai/dsh-typert-protocol/nonexistent-export')).toThrow()
  const tsdownRequire = createRequire(selected.require.resolve('tsdown'))
  const { rolldown } = await import(pathToFileURL(tsdownRequire.resolve('rolldown')).href)
  // The importer is the REAL root path; load is virtual to avoid touching installed lib.
  const entry = join(root, 'lib/typert.remote-client.js')
  const bundle = await rolldown({ input: entry, plugins: [plugin, {
    name: 'simulated-generated-descriptor',
    load(path: string) { if (path === entry) return `export * from ${JSON.stringify(id)}` },
  }] })
  try {
    const result = await bundle.generate({ format: 'esm' })
    expect(result.output.some((item: { type: string; code?: string }) => item.type === 'chunk' && item.code?.includes('remote'))).toBe(true)
    expect(result.output.filter((item: { type: string }) => item.type === 'chunk').every((item: { imports: string[] }) => !item.imports.includes(id))).toBe(true)
  } finally { await bundle.close() }
  const { build } = await import(pathToFileURL(selected.require.resolve('tsdown')).href)
  await build({ entry: { regression: entry }, write: false, clean: false, dts: false,
    platform: 'browser', format: 'cjs', logLevel: 'silent',
    deps: clientBundleDependencies(), plugins: [plugin, {
      name: 'simulated-generated-descriptor-tsdown',
      load(path: string) { if (path === entry) return `export * from ${JSON.stringify(id)}` },
    }],
  })
})

it('keeps Host Typert classes external while the resolver is limited to Client', async () => {
  const { resolve } = await import('node:path')
  const { pathToFileURL } = await import('node:url')
  const root = resolve('.')
  const script = readFileSync(join(root, 'scripts/build.mjs'), 'utf8')
  const hostOptions = script.slice(script.indexOf('await build({'), script.indexOf('// The published generator'))
  expect(hostOptions).not.toContain('selectedTypertResolver')
  expect(script.slice(script.lastIndexOf('await build({'))).toContain('plugins: [selectedTypertResolver(dependencies)]')
  const selected = selectBuildDependencies(root, {})
  const { build } = await import(pathToFileURL(selected.require.resolve('tsdown')).href)
  const entry = join(root, 'lib/types/host/index.js')
  let emitted = ''
  await build({ entry: { regression: entry }, write: false, clean: false, dts: false,
    platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{
      name: 'simulated-host-import',
      load(path: string) {
        if (path === entry) return 'export { Remote, RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol"'
      },
      generateBundle(_options: unknown, bundle: Record<string, { type: string; code?: string }>) {
        emitted = Object.values(bundle).filter(x => x.type === 'chunk').map(x => x.code).join('\n')
      },
    }],
  })
  expect(emitted).toContain('from "@deepseek-ai/dsh-typert-protocol"')
  expect(emitted).not.toContain('class TypertRemoteService')
  expect(emitted).not.toContain('class RemoteError')
})

for (const [target, directory] of [['0.2.0-rc.2', '020rc2'], ['0.2.1-rc.1', '021rc1'], ['0.2.1-rc.2', '021rc2'], ['0.2.1-rc.3', '021rc3'], ['0.2.1-rc.5', '021rc5']]) {
  it(`selects only the exact verified ${target} graph without touching root links`, () => {
    const root = fixture(target); sdk(root, '0.0.0-wrong')
    const isolated = join(root, `.cache/cliworker-build-deps-${directory}`)
    mkdirSync(isolated, { recursive: true }); writeFileSync(join(isolated, 'package.json'), '{}'); sdk(isolated, target)
    expect(selectBuildDependencies(root, {}).directory).toBe(isolated)
    expect(JSON.parse(readFileSync(join(root, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version).toBe('0.0.0-wrong')
  })
}
it('rejects an unverified later SDK target without expanding the supported version range', () => {
  const root = fixture('0.2.1-rc.6'); sdk(root, '0.2.1-rc.6')
  expect(() => selectBuildDependencies(root, {})).toThrow('Unsupported pinned')
})

it('uses actual app-boot preflight without a DSH version gate while keeping development SDK exact', async () => {
  const { createRequire } = await import('node:module')
  const { resolve } = await import('node:path')
  const { pathToFileURL } = await import('node:url')
  const root = resolve('.')
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const peers = Object.entries(manifest.peerDependencies).filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
  expect(peers.length).toBeGreaterThan(0)
  expect(peers.every(([, range]) => range === '*')).toBe(true)
  expect(manifest.engines).not.toHaveProperty('dsh')
  expect(manifest.devDependencies['@deepseek-ai/dsh']).toBe('0.2.1-rc.5')
  const selected = selectBuildDependencies(root, {})
  // Resolve through the selected dsh package, never a root/transitive fallback.
  const requireDsh = createRequire(selected.require.resolve('@deepseek-ai/dsh/package.json'))
  const { evaluatePluginCompatibility } = await import(pathToFileURL(requireDsh.resolve('@deepseek-ai/dsh-app-boot')).href)
  // rc.99 checks metadata admission only; it does not claim its runtime APIs work.
  for (const runtime of ['0.2.0-rc.2', '0.2.1-rc.1', '0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.5', '0.2.1-rc.99'])
    expect(evaluatePluginCompatibility(manifest, {}, runtime)).toBeUndefined()
  const gated = structuredClone(manifest)
  gated.peerDependencies['@deepseek-ai/dsh-agent'] = '0.2.1-rc.1'
  expect(evaluatePluginCompatibility(gated, {}, '0.2.1-rc.2')).toMatchObject({
    requirements: { '@deepseek-ai/dsh-agent': '0.2.1-rc.1' }, exempted: false,
  })
})
