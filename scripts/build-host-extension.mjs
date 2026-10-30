#!/usr/bin/env node
/** Build a pinned, explicitly approved Client extension; never touch an installation. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tsImport } from 'tsx/esm/api'
import { build } from 'tsdown'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const targetFlag = process.argv.indexOf('--target')
const targetVersion = targetFlag < 0 ? '0.2.0-rc.2' : process.argv[targetFlag + 1]
if (!['0.2.0-rc.2', '0.2.1-rc.1', '0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.5'].includes(targetVersion)) throw new Error('Unsupported pinned extension target')
const modern = targetVersion.startsWith('0.2.1-')
const suffix = targetVersion === '0.2.1-rc.5' ? '021rc5' : targetVersion === '0.2.1-rc.3' ? '021rc3' : targetVersion === '0.2.1-rc.2' ? '021rc2' : '021rc1'
const buildDeps = join(root, '.cache', modern ? `dsh-host-build-deps-${suffix}` : 'dsh-host-build-deps')
const upstream = {
  repository: 'https://github.com/deepseek-ai/deepseek-harness.git',
  tag: `dsh-v${targetVersion}`,
  commit: targetVersion === '0.2.1-rc.5' ? 'b830ec950faba0a46dda564be3e2d854afed94f1' : targetVersion === '0.2.1-rc.3' ? '1f81c047fc48fa190a683e469daa699857e9afe8' : modern ? (suffix === '021rc2' ? '687f282e8625c6b8d11ff58211a90524be2e4317' : '1600d8a1e140dcde43a1a0941940a0480712c011') : '639ed015397290b3745d163aafe02ffee4aa3f84',
  ...(targetVersion === '0.2.1-rc.3' ? { installedAppBuildIdentity: 'be72761', installedAppBuildCommitStatus: 'not-resolved-to-public-commit' } : {}),
  ...(modern && !['0.2.1-rc.3', '0.2.1-rc.5'].includes(targetVersion) ? { installedDesktopBuildCommit: suffix === '021rc2' ? '332895e0f7c9d4dbfb29729f5eb367fa263ff986' : 'ed75efeffee65f9fe93625bbd76a68cb219aaaf9' } : {}),
}
const packages = ['ui-session', 'ui-conversation', 'ui-subagent', 'ui-chat']
const allowed = [
  ...packages.map((name) => `packages/client/${name}/`),
  'docs/subsystems/slots.md',
  'docs/subsystems/slots.zh.md',
  'docs/subsystems/slots.i18n.yaml',
]
const extensionDir = join(root, `host-extensions/dsh-${targetVersion}`)
const patchFile = join(extensionDir, 'source.patch')
const git = process.platform === 'darwin' ? '/Library/Developer/CommandLineTools/usr/bin/git' : 'git'
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))
const slash = (path) => path.split(sep).join('/')
const inside = (parent, child) => {
  const path = relative(parent, child)
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

function argumentsFor(args) {
  const options = {
    source: join(root, '.cache', modern ? `dsh-host-source-${suffix}` : 'dsh-host-source-rc2'),
    out: join(root, 'artifacts', modern ? `dsh-host-extension-${suffix}-data` : 'dsh-host-extension-rc2'),
    replace: false,
    exportPatch: false,
    verify: false,
    prepareLinks: false,
  }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--target') { index++; continue }
    if (arg === '--source' || arg === '--out') {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
      options[arg.slice(2)] = resolve(root, value)
    } else if (arg === '--replace') options.replace = true
    else if (arg === '--export-patch') options.exportPatch = true
    else if (arg === '--verify') options.verify = true
    else if (arg === '--prepare-links') options.prepareLinks = true
    else throw new Error(`Unknown option: ${arg}`)
  }
  if (!inside(join(root, 'artifacts'), options.out))
    throw new Error('--out must be a child directory of this repository/artifacts')
  for (let path = options.out; path !== root; path = dirname(path))
    if (existsSync(path) && lstatSync(path).isSymbolicLink())
      throw new Error('Output path must not traverse symbolic links')
  if ([options.verify, options.exportPatch, options.prepareLinks].filter(Boolean).length > 1)
    throw new Error('Select only one of --verify, --export-patch, --prepare-links')
  return options
}
function gitRead(source, args) {
  return execFileSync(git, ['-C', source, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}
function sourcePatch(source) {
  if (
    gitRead(source, ['rev-parse', 'HEAD']).trim() !== upstream.commit ||
    gitRead(source, ['rev-parse', `${upstream.tag}^{commit}`]).trim() !== upstream.commit
  )
    throw new Error('Source HEAD/tag does not match the pinned official release commit')
  const changed = gitRead(source, ['diff', '--name-only', upstream.commit, '--'])
    .trim()
    .split('\n')
    .filter(Boolean)
  const untracked = gitRead(source, ['ls-files', '--others', '--exclude-standard'])
    .trim()
    .split('\n')
    .filter(Boolean)
  if (untracked.length)
    throw new Error(`Untracked source inputs must be made reviewable before export: ${untracked.join(', ')}`)
  if (
    !changed.length ||
    changed.some(
      (path) =>
        !allowed.some(
          (prefix) => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`),
        ),
    )
  )
    throw new Error(
      'Source changes are empty or extend beyond the four reviewed UI packages and slot documentation',
    )
  return {
    changed,
    patch: gitRead(source, [
      'diff',
      '--binary',
      '--full-index',
      '--no-ext-diff',
      upstream.commit,
      '--',
      ...allowed,
    ]),
  }
}
function dependencyLinks(source, prepare = false) {
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    const expected = join(extensionDir, 'build-dependencies', name)
    const actual = join(buildDeps, name)
    if (!existsSync(actual) || sha(readFileSync(actual)) !== sha(readFileSync(expected)))
      throw new Error(
        `Isolated build dependency input is missing or differs: ${name}; copy all three build-dependencies files before installing`,
      )
  }
  const inventory = json(join(extensionDir, 'dependency-links.json'))
  const modules = join(source, 'node_modules')
  if (prepare && !inside(join(root, '.cache'), source))
    throw new Error('--prepare-links only writes an isolated checkout under repository/.cache')
  if (existsSync(modules) && lstatSync(modules).isSymbolicLink())
    throw new Error('Source node_modules must be an isolated directory, not an installation symlink')
  for (const item of inventory.dependencies) {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/iu.test(item.name)) throw new Error('Invalid dependency alias')
    const target = item.sourceLocation ? resolve(source, item.sourceLocation) : resolve(root, item.location)
    if (
      ![
        join(root, 'node_modules/.pnpm'),
        join(buildDeps, 'node_modules/.pnpm'),
        ...(modern ? [join(root, '.cache/dsh-host-build-deps/node_modules/.pnpm')] : []),
        join(source, 'packages'),
      ].some((base) => inside(base, target))
    )
      throw new Error('Dependency target is outside the recorded isolated dependency stores')
    if (
      !existsSync(join(target, 'package.json')) ||
      sha(readFileSync(join(target, 'package.json'))) !== item.packageJsonSha256
    )
      throw new Error(`Dependency is absent or differs from recorded metadata: ${item.name}@${item.version}`)
    const alias = join(modules, item.name)
    if (!existsSync(alias)) {
      if (!prepare) throw new Error(`Missing isolated dependency alias: ${item.name}; run --prepare-links`)
      mkdirSync(dirname(alias), { recursive: true })
      symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    }
    if (realpathSync(alias) !== realpathSync(target))
      throw new Error(`Refusing to replace a different dependency alias: ${item.name}`)
  }
  return inventory
}
function filesBelow(dir, base = dir) {
  const files = []
  for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, item.name)
    if (item.isSymbolicLink()) throw new Error(`Unexpected symlink in artifact: ${path}`)
    if (item.isDirectory()) files.push(...filesBelow(path, base))
    else if (item.isFile())
      files.push({
        path: slash(relative(base, path)),
        bytes: lstatSync(path).size,
        sha256: sha(readFileSync(path)),
      })
    else throw new Error(`Unexpected file type in artifact: ${path}`)
  }
  return files
}
function packageVersion(require, name) {
  return json(require.resolve(`${name}/package.json`)).version
}
function verify(out) {
  const manifest = json(join(out, 'manifest.json'))
  if (manifest.schema !== 1 || manifest.upstream.commit !== upstream.commit)
    throw new Error('Invalid extension manifest')
  const actual = filesBelow(out).filter((entry) => entry.path !== 'manifest.json')
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files))
    throw new Error('Artifact file inventory/hash mismatch')
  if (sha(readFileSync(patchFile)) !== manifest.patch.sha256)
    throw new Error('Artifact patch differs from the tracked patch')
  console.log(
    JSON.stringify({
      verified: true,
      out: slash(relative(root, out)),
      packages: manifest.packages.map((item) => item.name),
      files: actual.length,
    }),
  )
}

async function main() {
  const options = argumentsFor(process.argv.slice(2))
  if (options.verify) {
    verify(options.out)
    return
  }
  const source = realpathSync(options.source)
  const { changed, patch } = sourcePatch(source)
  if (options.prepareLinks) {
    dependencyLinks(source, true)
    console.log('Isolated dependency aliases verified/prepared; installed packages unchanged.')
    return
  }
  if (options.exportPatch) {
    mkdirSync(extensionDir, { recursive: true })
    writeFileSync(patchFile, patch)
    console.log(
      JSON.stringify({
        exported: slash(relative(root, patchFile)),
        sha256: sha(patch),
        files: changed.length,
      }),
    )
    return
  }
  if (!existsSync(patchFile) || readFileSync(patchFile, 'utf8') !== patch)
    throw new Error('Source differs from tracked source.patch; export the reviewed frozen patch first')
  if (existsSync(options.out) && !options.replace)
    throw new Error('Output already exists; use a different --out or --replace after review')
  dependencyLinks(source)
  const installed = createRequire(realpathSync(modern ? join(buildDeps, 'node_modules/@deepseek-ai/dsh/package.json') : join(root, 'node_modules/@deepseek-ai/dsh/package.json')))
  if (packageVersion(installed, '@deepseek-ai/dsh') !== targetVersion)
    throw new Error('Installed DSH baseline does not match target')
  const stage = join(root, '.cache', `dsh-host-extension-output-${process.pid}`)
  if (existsSync(stage)) throw new Error('Build staging path already exists')
  mkdirSync(stage, { recursive: true })
  const baselineFiles = []
  const builtPackages = []
  try {
    const { clientBundle } = await tsImport(
      pathToFileURL(join(source, 'packages/client/tsdown.client.ts')).href,
      import.meta.url,
    )
    for (const short of packages) {
      const name = `@deepseek-ai/dsh-client-${short}`
      const packageDir = join(source, 'packages/client', short)
      const original = dirname(realpathSync(installed.resolve(`${name}/package.json`)))
      const manifest = json(join(original, 'package.json'))
      if (
        manifest.name !== name ||
        manifest.version !== targetVersion ||
        json(join(packageDir, 'package.json')).name !== name
      )
        throw new Error(`Unexpected package identity: ${name}`)
      const target = join(stage, `dsh-client-${short}`)
      mkdirSync(target)
      for (const item of ['package.json', 'lib', 'LICENSE', 'LICENSE.md', 'README.md'])
        if (existsSync(join(original, item)))
          cpSync(join(original, item), join(target, item), { recursive: true, dereference: true })
      const baseline = filesBelow(target)
      baselineFiles.push({ original, files: baseline })
      const configs = clientBundle(modern ? packageDir : name, ['lib/types/index.js'])({ env: {} })
      const browserConfig = configs.find((config) => config.platform === 'browser')
      if (!browserConfig) throw new Error(`Official browser config unavailable: ${name}`)
      await build({
        ...browserConfig,
        outDir: join(target, 'lib'),
        config: false,
        workspace: false,
        cwd: packageDir,
      })
      for (const required of [
        'lib/client.js',
        'lib/client.js.map',
        'lib/index.js',
        'lib/types/client/index.d.ts',
      ])
        if (!existsSync(join(target, required))) throw new Error(`Missing artifact ${name}/${required}`)
      for (const entry of baseline.filter(
        (item) => !['lib/client.js', 'lib/client.js.map'].includes(item.path),
      ))
        if (sha(readFileSync(join(target, entry.path))) !== entry.sha256)
          throw new Error(`Original package field changed: ${name}/${entry.path}`)
      const sourceMap = json(join(target, 'lib/client.js.map'))
      if (
        !Array.isArray(sourceMap.sourcesContent) ||
        !sourceMap.sourcesContent.some((content) => typeof content === 'string')
      )
        throw new Error(`Client source map lacks embedded source: ${name}`)
      builtPackages.push({
        name,
        version: manifest.version,
        directory: `dsh-client-${short}`,
        baselineFiles: baseline,
        client: {
          sha256: sha(readFileSync(join(target, 'lib/client.js'))),
          sourceMapSha256: sha(readFileSync(join(target, 'lib/client.js.map'))),
        },
        declarations: { status: `inherited-official-${targetVersion}`, extensionInterfacesGenerated: false },
      })
    }
    // Build reads the official node_modules baseline; assert it remained untouched.
    for (const baseline of baselineFiles)
      for (const file of baseline.files)
        if (sha(readFileSync(join(baseline.original, file.path))) !== file.sha256)
          throw new Error('Installed baseline changed during build')
    if (sourcePatch(source).patch !== patch)
      throw new Error('Source changed during build; retry after it is frozen')
    const provenance = join(stage, 'build-inputs')
    mkdirSync(provenance)
    cpSync(patchFile, join(provenance, 'source.patch'))
    cpSync(join(extensionDir, 'dependency-links.json'), join(provenance, 'dependency-links.json'))
    cpSync(fileURLToPath(import.meta.url), join(provenance, 'build-host-extension.mjs'))
    if (modern) for (const name of ['prepare-client-types.mjs', 'check-client-types.mjs'])
      cpSync(join(extensionDir, name), join(provenance, name))
    for (const [input, output] of [
      [join(root, 'pnpm-lock.yaml'), 'plugin-pnpm-lock.yaml'],
      [join(root, 'package.json'), 'plugin-package.json'],
      [join(buildDeps, 'package.json'), 'extra-build-package.json'],
      [join(buildDeps, 'pnpm-lock.yaml'), 'extra-build-pnpm-lock.yaml'],
      [join(buildDeps, 'pnpm-workspace.yaml'), 'extra-build-pnpm-workspace.yaml'],
    ])
      if (existsSync(input)) cpSync(input, join(provenance, output))
    cpSync(join(extensionDir, 'README.md'), join(stage, 'README.md'))
    const require = createRequire(import.meta.url)
    const outputManifest = {
      schema: 1,
      upstream,
      patch: { sha256: sha(patch), files: changed },
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        nodeEnv: process.env.NODE_ENV ?? 'production',
        nodeEnvSource: process.env.NODE_ENV === undefined ? 'official-preset-default' : 'environment',
        tsdown: packageVersion(require, 'tsdown'),
        tsx: packageVersion(require, 'tsx'),
        typescript: packageVersion(require, 'typescript'),
      },
      officialPresetSha256: sha(readFileSync(join(source, 'packages/client/tsdown.client.ts'))),
      packages: builtPackages,
      files: filesBelow(stage),
    }
    writeFileSync(join(stage, 'manifest.json'), JSON.stringify(outputManifest, null, 2) + '\n')
    mkdirSync(dirname(options.out), { recursive: true })
    if (existsSync(options.out)) rmSync(options.out, { recursive: true })
    renameSync(stage, options.out)
    verify(options.out)
  } finally {
    if (existsSync(stage)) rmSync(stage, { recursive: true })
  }
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
