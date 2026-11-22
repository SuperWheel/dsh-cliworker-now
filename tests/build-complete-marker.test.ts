import { afterEach, describe, expect, it } from 'vitest'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { selectBuildDependencies } from '../scripts/build-dependencies.mjs'
import {
  BUILD_COMPLETE_PATCH,
  requiredBuildOutputs,
  writeBuildCompleteMarker,
} from '../scripts/build-complete-marker.mjs'

const root = resolve('.')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const stockIds = ['ui-session', 'ui-conversation', 'ui-subagent', 'ui-chat']
const temps: string[] = []

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cliworker-marker-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// The real DSH 0.2.2-rc.5 profile reader, as selected for the build.
async function appBoot() {
  const selected = selectBuildDependencies(root)
  const require = createRequire(selected.require.resolve('@deepseek-ai/dsh/package.json'))
  return import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
}

/** A desktop profile that selected this plugin, installed from a source tree without lib/. */
function profileWithSourceCheckout() {
  const profile = temp()
  const pkg = join(profile, 'node_modules', manifest.name)
  mkdirSync(pkg, { recursive: true })
  for (const file of ['package.json', 'cordis.patch.yml']) cpSync(join(root, file), join(pkg, file))
  writeFileSync(
    join(profile, 'package.json'),
    JSON.stringify({ name: 'profile', private: true, dsh: { profile: { bundles: [manifest.name] } } }),
  )
  return { profile, pkg }
}

describe('build-complete marker (unbuilt source checkouts cannot replace the stock UI)', () => {
  it('is declared as a required bundle patch after the plugin patch', () => {
    expect(manifest.dsh.bundle.patch).toEqual(['./cordis.patch.yml', `./${BUILD_COMPLETE_PATCH}`])
    expect(manifest.files).toContain('lib')
  })

  it('is written only after every built entry exists, and parses as an empty patch', async () => {
    const dir = temp()
    expect(() => writeBuildCompleteMarker(dir)).toThrow(/Build incomplete, missing: lib\/index\.js/)
    expect(existsSync(join(dir, BUILD_COMPLETE_PATCH))).toBe(false)
    const outputs = requiredBuildOutputs()
    for (const file of outputs.slice(0, -1)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true })
      writeFileSync(join(dir, file), '')
    }
    expect(() => writeBuildCompleteMarker(dir)).toThrow(outputs.at(-1))
    expect(existsSync(join(dir, BUILD_COMPLETE_PATCH))).toBe(false)
    writeFileSync(join(dir, outputs.at(-1)!), '')
    writeBuildCompleteMarker(dir)
    const { loadOverlayPatches } = await appBoot()
    expect(loadOverlayPatches('test', join(dir, BUILD_COMPLETE_PATCH))).toEqual([])
  })

  it('makes DSH rc.5 skip the whole bundle for a source checkout without the marker', async () => {
    const { loadProfileDirectory } = await appBoot()
    const { profile, pkg } = profileWithSourceCheckout()
    const unbuilt = loadProfileDirectory('dsh', profile, profile)
    expect(unbuilt.layers).toEqual([])
    expect(unbuilt.skippedBundles).toHaveLength(1)
    expect(unbuilt.skippedBundles[0].packageName).toBe(manifest.name)
    expect(unbuilt.skippedBundles[0].reason).toContain('build-complete.patch.yml')

    // A completed build: the same bundle loads and disables the stock UI rows.
    mkdirSync(join(pkg, 'lib'), { recursive: true })
    writeFileSync(join(pkg, BUILD_COMPLETE_PATCH), '[]\n')
    const built = loadProfileDirectory('dsh', profile, profile)
    expect(built.skippedBundles).toEqual([])
    expect(built.layers).toHaveLength(1)
    const disabled = built.layers[0].patches
      .filter((row: any) => row.disabled === true)
      .map((row: any) => row.id)
    expect(disabled).toEqual(stockIds)
  })
})
