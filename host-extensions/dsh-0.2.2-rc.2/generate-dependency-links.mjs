// Map the reviewed rc.1 alias inventory onto the 0.2.2-rc.2 isolated install; run from the plugin root.
// Every row is re-read from disk (version and package.json SHA-256); nothing is copied from rc.1.
// Rows whose package no longer exists in 0.2.2-rc.2 are dropped and reported; the four packages'
// new workspace dependencies are appended from the isolated store (or the checkout for source rows).
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve('.')
const source = join(root, '.cache/dsh-host-source-022rc2')
const buildDeps = join(root, '.cache/dsh-host-build-deps-022rc2')
const store = join(buildDeps, 'node_modules/.pnpm')
const previous = JSON.parse(readFileSync(join(root, 'host-extensions/dsh-0.2.2-rc.1/dependency-links.json'), 'utf8'))
const added = [
  '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-agent-team',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-ui-context-menu',
  '@deepseek-ai/dsh-client-ui-file-drag',
  '@deepseek-ai/dsh-message-quotes',
  '@deepseek-ai/dsh-tool-executor-ptc',
  '@deepseek-ai/dsh-util-file-drag',
]
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const slash = (path) => path.split(sep).join('/')

function storeTarget(name, location) {
  if (location && existsSync(join(root, location, 'package.json'))) return location
  // Peer-hash suffixes and cordis-family versions change with the release: take the single store
  // entry of the same name and version, otherwise the direct or hoisted link pnpm resolves to.
  const prefix = location ? /^\.cache\/dsh-host-build-deps-022rc2\/node_modules\/\.pnpm\/([^/_]+)/.exec(location)?.[1] : undefined
  const entries = prefix ? readdirSync(store).filter((entry) => entry === prefix || entry.startsWith(`${prefix}_`)) : []
  const links = [join(buildDeps, 'node_modules', name), join(store, 'node_modules', name)]
  const target = entries.length === 1 ? join(store, entries[0], 'node_modules', name) : links.find((link) => existsSync(join(link, 'package.json')))
  return target && existsSync(join(target, 'package.json')) ? slash(relative(root, realpathSync(target))) : undefined
}

const dropped = []
const dependencies = []
for (const row of previous.dependencies) {
  if (row.sourceLocation) {
    const target = resolve(source, row.sourceLocation)
    if (!existsSync(join(target, 'package.json'))) { dropped.push(row.name); continue }
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
    if (manifest.name !== row.name) throw new Error(`Source alias changed identity: ${row.name}`)
    dependencies.push({ name: row.name, version: manifest.version, sourceLocation: row.sourceLocation, packageJsonSha256: sha(join(target, 'package.json')) })
    continue
  }
  let location = row.location
  if (location.startsWith('.cache/dsh-host-build-deps-022rc1/')) {
    location = storeTarget(row.name, location.replace('.cache/dsh-host-build-deps-022rc1/', '.cache/dsh-host-build-deps-022rc2/').replaceAll('0.2.2-rc.1', '0.2.2-rc.2'))
    if (!location) { dropped.push(row.name); continue }
  } else if (!existsSync(join(root, location, 'package.json'))) throw new Error(`Missing plugin-root dependency: ${row.name}`)
  const manifest = JSON.parse(readFileSync(join(root, location, 'package.json'), 'utf8'))
  if (manifest.name !== row.name) throw new Error(`Dependency changed identity: ${row.name}`)
  dependencies.push({ name: row.name, version: manifest.version, location, packageJsonSha256: sha(join(root, location, 'package.json')) })
}
for (const name of added) {
  if (dependencies.some((row) => row.name === name)) continue
  const location = storeTarget(name)
  if (!location) throw new Error(`Missing 0.2.2-rc.2 dependency: ${name}`)
  const manifest = JSON.parse(readFileSync(join(root, location, 'package.json'), 'utf8'))
  dependencies.push({ name, version: manifest.version, location, packageJsonSha256: sha(join(root, location, 'package.json')) })
}
dependencies.sort((a, b) => a.name.localeCompare(b.name))

writeFileSync(join(root, 'host-extensions/dsh-0.2.2-rc.2/dependency-links.json'), JSON.stringify({ schema: 1, dependencies }, null, 2) + '\n')
const before = new Map(previous.dependencies.map((row) => [row.name, row.version]))
const changed = dependencies.filter((row) => before.has(row.name) && before.get(row.name) !== row.version)
console.log(JSON.stringify({
  rows: dependencies.length, dropped, added: dependencies.filter((row) => !before.has(row.name)).map((row) => row.name),
  versionChanges: changed.length,
  nonDshVersionChanges: changed.filter((row) => !row.name.startsWith('@deepseek-ai/dsh')).map((row) => `${row.name}@${before.get(row.name)}->${row.version}`),
}, null, 1))
