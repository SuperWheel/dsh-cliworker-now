import { readdirSync, statSync } from 'node:fs'
import { expect, it } from 'vitest'
import { buildHostCopyManifest } from '../scripts/build-host-copy-manifest.mjs'

const hostFiles = readdirSync(new URL('../src/host/', import.meta.url), { withFileTypes: true })
  .filter(entry => entry.isFile()).map(entry => entry.name)

it('plans every top-level Host runtime resource and authored declaration at its expected destinations', () => {
  const extraUnbundledModules = [
    'codebuddy-context-inspection', 'hermes-observer', 'native-acp', 'native-codebuddy',
    'native-harness-extension', 'native-harness-mcp', 'native-http', 'native-spawn',
    'native-transport', 'private-launch', 'windows-account-launch', 'windows-account-stdio',
    'windows-hidden-launch',
  ].map(name => `${name}.mjs`)
  const declarations = hostFiles.filter(name => name.endsWith('.d.mts'))
  const runtime = hostFiles.filter(name => /\.(mjs|cjs|py|ps1)$/.test(name))
  const expected = [
    ...runtime.map(name => `lib/${name}`),
    ...[
      ...declarations,
      ...declarations.map(name => name.replace(/\.d\.mts$/, '.mjs')),
      ...extraUnbundledModules,
      ...runtime.filter(name => !name.endsWith('.mjs')),
    ].map(name => `lib/types/host/${name}`),
  ]
  const copies = buildHostCopyManifest(hostFiles)
  expect(copies.map(copy => copy.destination).sort()).toEqual(expected.sort())
  for (const { source, destination } of copies) {
    expect(source).toBe(`src/host/${destination.split('/').at(-1)}`)
    expect(statSync(new URL(`../${source}`, import.meta.url)).isFile()).toBe(true)
  }
})

it('discovers new filenames with supported extensions without changing the copy rules', () => {
  const added = [
    'simulated-entry.mjs', 'simulated-companion.mjs', 'simulated-companion.d.mts',
    'simulated-helper.cjs', 'simulated-helper.py', 'simulated-helper.ps1', 'simulated-source.ts',
  ]
  const copies = buildHostCopyManifest([...hostFiles, ...added])
  expect(copies.filter(copy => copy.source.startsWith('src/host/simulated-')).map(copy => copy.destination))
    .toEqual([
      'lib/types/host/simulated-companion.d.mts',
      'lib/simulated-companion.mjs', 'lib/types/host/simulated-companion.mjs',
      'lib/simulated-entry.mjs',
      'lib/simulated-helper.cjs', 'lib/types/host/simulated-helper.cjs',
      'lib/simulated-helper.ps1', 'lib/types/host/simulated-helper.ps1',
      'lib/simulated-helper.py', 'lib/types/host/simulated-helper.py',
    ])
})

it.each(['account-models.mjs', 'native-transport.mjs', 'windows-account-owner.ps1'])(
  'fails when a required Host resource is missing: %s',
  (name) => {
    expect(() => buildHostCopyManifest(hostFiles.filter(file => file !== name)))
      .toThrow(`Missing Host build source: src/host/${name}`)
  },
)
