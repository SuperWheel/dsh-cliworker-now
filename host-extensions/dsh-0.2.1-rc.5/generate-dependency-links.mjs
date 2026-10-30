// Map the reviewed rc.3 alias inventory onto the rc.5 isolated install; run from the plugin root.
// Every row is re-read from disk (version and package.json SHA-256); nothing is copied from rc.3.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve('.')
const source = join(root, '.cache/dsh-host-source-021rc5')
const buildDeps = join(root, '.cache/dsh-host-build-deps-021rc5')
const previous = JSON.parse(readFileSync(join(root, 'host-extensions/dsh-0.2.1-rc.3/dependency-links.json'), 'utf8'))
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const slash = (path) => path.split(sep).join('/')

const dependencies = previous.dependencies.map((row) => {
  if (row.sourceLocation) {
    const target = resolve(source, row.sourceLocation)
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
    if (manifest.name !== row.name) throw new Error(`Source alias changed identity: ${row.name}`)
    return { name: row.name, version: manifest.version, sourceLocation: row.sourceLocation, packageJsonSha256: sha(join(target, 'package.json')) }
  }
  let location = row.location
  if (location.startsWith('.cache/dsh-host-build-deps-021rc3/')) {
    // Same store layout; only the DSH release in directory names moves to rc.5.
    location = location.replace('.cache/dsh-host-build-deps-021rc3/', '.cache/dsh-host-build-deps-021rc5/').replaceAll('0.2.1-rc.3', '0.2.1-rc.5')
    if (!existsSync(join(root, location, 'package.json'))) {
      // Peer-hash suffixes change with the release: take the single store entry of the
      // same name and version, otherwise the direct or hoisted link pnpm resolves to.
      const store = join(buildDeps, 'node_modules/.pnpm')
      const prefix = /^\.cache\/dsh-host-build-deps-021rc5\/node_modules\/\.pnpm\/([^/_]+)/.exec(location)?.[1]
      const entries = prefix ? readdirSync(store).filter((name) => name === prefix || name.startsWith(`${prefix}_`)) : []
      const links = [join(buildDeps, 'node_modules', row.name), join(store, 'node_modules', row.name)]
      const target = entries.length === 1 ? join(store, entries[0], 'node_modules', row.name) : links.find((link) => existsSync(join(link, 'package.json')))
      if (!target || !existsSync(join(target, 'package.json'))) throw new Error(`Missing rc.5 dependency: ${row.name}`)
      location = slash(relative(root, realpathSync(target)))
    }
  } else if (!existsSync(join(root, location, 'package.json'))) throw new Error(`Missing plugin-root dependency: ${row.name}`)
  const manifest = JSON.parse(readFileSync(join(root, location, 'package.json'), 'utf8'))
  if (manifest.name !== row.name) throw new Error(`Dependency changed identity: ${row.name}`)
  return { name: row.name, version: manifest.version, location, packageJsonSha256: sha(join(root, location, 'package.json')) }
})

writeFileSync(join(root, 'host-extensions/dsh-0.2.1-rc.5/dependency-links.json'), JSON.stringify({ schema: 1, dependencies }, null, 2) + '\n')
const changed = dependencies.filter((row, index) => row.version !== previous.dependencies[index].version)
console.log(JSON.stringify({ rows: dependencies.length, versionChanges: changed.length, nonDshVersionChanges: changed.filter((row) => !row.name.startsWith('@deepseek-ai/dsh')).map((row) => row.name) }))
