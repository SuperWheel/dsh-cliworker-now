// Map the reviewed rc.3 alias inventory onto the 0.2.2-rc.5 isolated install; run from the plugin root.
// Every row is re-read from disk (version and package.json SHA-256); nothing is copied from rc.3.
// Report removed aliases and re-read workspace rows from the pinned checkout.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve('.')
const source = join(root, '.cache/dsh-host-source-022rc5')
const buildDeps = join(root, '.cache/dsh-host-build-deps-022rc5')
const store = join(buildDeps, 'node_modules/.pnpm')
const previous = JSON.parse(
  readFileSync(join(root, 'host-extensions/dsh-0.2.2-rc.3/dependency-links.json'), 'utf8'),
)
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const slash = (path) => path.split(sep).join('/')

function storeTarget(name, location) {
  if (location && existsSync(join(root, location, 'package.json'))) return location
  // Peer-hash suffixes and cordis-family versions change with the release: take the single store
  // entry of the same name and version, otherwise the direct or hoisted link pnpm resolves to.
  const prefix = location
    ? /^\.cache\/dsh-host-build-deps-022rc5\/node_modules\/\.pnpm\/([^/_]+)/.exec(location)?.[1]
    : undefined
  const entries = prefix
    ? readdirSync(store).filter((entry) => entry === prefix || entry.startsWith(`${prefix}_`))
    : []
  const links = [join(buildDeps, 'node_modules', name), join(store, 'node_modules', name)]
  const target =
    entries.length === 1
      ? join(store, entries[0], 'node_modules', name)
      : links.find((link) => existsSync(join(link, 'package.json')))
  return target && existsSync(join(target, 'package.json'))
    ? slash(relative(root, realpathSync(target)))
    : undefined
}

const dropped = []
const dependencies = []
for (const row of previous.dependencies) {
  // The plugin switched its planning CLI to pmspec. The UI build has no OpenSpec import.
  if (row.name === '@fission-ai/openspec') {
    dropped.push(row.name)
    continue
  }
  if (row.sourceLocation) {
    const target = resolve(source, row.sourceLocation)
    if (!existsSync(join(target, 'package.json'))) {
      dropped.push(row.name)
      continue
    }
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
    if (manifest.name !== row.name) throw new Error(`Source alias changed identity: ${row.name}`)
    dependencies.push({
      name: row.name,
      version: manifest.version,
      sourceLocation: row.sourceLocation,
      packageJsonSha256: sha(join(target, 'package.json')),
    })
    continue
  }
  let location = row.location
  if (location.startsWith('.cache/dsh-host-build-deps-022rc3/')) {
    location = storeTarget(
      row.name,
      location
        .replace('.cache/dsh-host-build-deps-022rc3/', '.cache/dsh-host-build-deps-022rc5/')
        .replaceAll('0.2.2-rc.3', '0.2.2-rc.5'),
    )
    if (!location) {
      dropped.push(row.name)
      continue
    }
  } else if (!existsSync(join(root, location, 'package.json')))
    throw new Error(`Missing plugin-root dependency: ${row.name}`)
  const manifest = JSON.parse(readFileSync(join(root, location, 'package.json'), 'utf8'))
  if (manifest.name !== row.name) throw new Error(`Dependency changed identity: ${row.name}`)
  dependencies.push({
    name: row.name,
    version: manifest.version,
    location,
    packageJsonSha256: sha(join(root, location, 'package.json')),
  })
}
dependencies.sort((a, b) => a.name.localeCompare(b.name))

writeFileSync(
  join(root, 'host-extensions/dsh-0.2.2-rc.5/dependency-links.json'),
  JSON.stringify({ schema: 1, dependencies }, null, 2) + '\n',
)
const before = new Map(previous.dependencies.map((row) => [row.name, row.version]))
const changed = dependencies.filter((row) => before.has(row.name) && before.get(row.name) !== row.version)
console.log(
  JSON.stringify(
    {
      rows: dependencies.length,
      dropped,
      added: dependencies.filter((row) => !before.has(row.name)).map((row) => row.name),
      versionChanges: changed.length,
      nonDshVersionChanges: changed
        .filter((row) => !row.name.startsWith('@deepseek-ai/dsh'))
        .map((row) => `${row.name}@${before.get(row.name)}->${row.version}`),
    },
    null,
    1,
  ),
)
