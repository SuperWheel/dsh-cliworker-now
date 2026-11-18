import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { selectBuildDependencies, buildTypeConfig, clientBundleDependencies, clientBundleDefines, selectedTypertResolver } from './build-dependencies.mjs'
import { buildHostCopyManifest } from './build-host-copy-manifest.mjs'
import { verifyHostRuntime } from './host-runtime.mjs'

// Declaration emit can elide imports used only inside module augmentations:
// the augmented module's exports are already in scope there. Typert requires an
// explicit import even for those valid references. Resolve symbols with the
// selected SDK's TypeScript, then normalize only the staged declaration copies.
// When a name is used elsewhere, unique aliases preserve binding identity
// without capturing those uses (including shadowed names). Other analyzer errors
// remain errors; this does not filter packages or relax Typert's checks.
export function normalizeAugmentationImports(ts, declarationFiles, compilerOptions) {
  const program = ts.createProgram({ rootNames: declarationFiles, options: { ...compilerOptions, noEmit: true } })
  const checker = program.getTypeChecker()
  const unalias = symbol => symbol?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  const changes = []
  for (const file of declarationFiles) {
    const source = program.getSourceFile(file)
    if (!source?.isDeclarationFile || !ts.isExternalModule(source)) continue
    const identifiers = new Set()
    const identifierCounts = new Map()
    const collect = node => {
      if (ts.isIdentifier(node)) {
        identifiers.add(node.text)
        identifierCounts.set(node.text, (identifierCounts.get(node.text) ?? 0) + 1)
      }
      ts.forEachChild(node, collect)
    }
    collect(source)
    const importedNames = new Set()
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement)) continue
      const clause = statement.importClause
      if (clause?.name) importedNames.add(clause.name.text)
      const bindings = clause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) importedNames.add(bindings.name.text)
      else if (bindings) for (const binding of bindings.elements) importedNames.add(binding.name.text)
    }
    const imports = new Map()
    const edits = []
    for (const statement of source.statements) {
      if (!ts.isModuleDeclaration(statement) || !ts.isStringLiteral(statement.name) || !statement.body) continue
      const moduleSymbol = checker.getSymbolAtLocation(statement.name)
      if (!moduleSymbol) continue
      const exports = new Map(checker.getExportsOfModule(moduleSymbol).map(symbol => [symbol.name, unalias(symbol)]))
      const visit = node => {
        let name = ts.isTypeReferenceNode(node) ? node.typeName
          : ts.isExpressionWithTypeArguments(node) ? node.expression
          : ts.isTypeQueryNode(node) ? node.exprName : undefined
        while (name && (ts.isQualifiedName(name) || ts.isPropertyAccessExpression(name))) {
          name = ts.isQualifiedName(name) ? name.left : name.expression
        }
        if (name && ts.isIdentifier(name) && !importedNames.has(name.text)) {
          const symbol = unalias(checker.getSymbolAtLocation(name))
          if (symbol && exports.get(name.text) === symbol && symbol.declarations?.some(declaration => declaration.getSourceFile() !== source)) {
            const key = `${statement.name.text}\0${name.text}`
            let entry = imports.get(key)
            if (!entry) {
              let alias = `__typertAugmentation${imports.size}`
              while (identifiers.has(alias)) alias += '_'
              identifiers.add(alias)
              entry = { module: statement.name.text, name: name.text, alias }
              imports.set(key, entry)
            }
            edits.push({ start: name.getStart(source), end: name.end, entry })
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(statement.body)
    }
    if (!imports.size) continue
    for (const entry of imports.values()) {
      // Keep authored spelling where every use belongs to this same binding;
      // Typert also retains declaration text in its runtime metadata.
      if (edits.filter(edit => edit.entry === entry).length === identifierCounts.get(entry.name)) entry.alias = entry.name
    }
    let text = source.text
    for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.entry.alias + text.slice(edit.end)
    // Append to preserve leading triple-slash directives and original comments.
    text += '\n' + [...imports.values()].map(entry => `import type { ${entry.name}${entry.alias === entry.name ? '' : ` as ${entry.alias}`} } from ${JSON.stringify(entry.module)};`).join('\n') + '\n'
    writeFileSync(file, text)
    changes.push({ file, imports: [...imports.values()] })
  }
  return changes
}

async function buildPlugin() {
const root = resolve('.')
const dependencies = selectBuildDependencies(root)
const { build } = await import(pathToFileURL(dependencies.require.resolve('tsdown')).href)
const { WorkspaceTypertGenerator } = await import(pathToFileURL(dependencies.require.resolve('@deepseek-ai/dsh-typert-generator')).href)
const typecheckOnly = process.argv.includes('--typecheck-only')
verifyHostRuntime(root)
const tsc = (project) => execFileSync(process.execPath, [
  dependencies.require.resolve('typescript/bin/tsc'), '-p', buildTypeConfig(root, dependencies, project, typecheckOnly),
], { stdio: 'inherit' })
if (typecheckOnly) {
  tsc('tsconfig.host-build.json')
  tsc('tsconfig.client.json')
  console.log(`Host/Client typecheck passed against DSH ${dependencies.target}: ${dependencies.modules}`)
  process.exit(0)
}
const hostFiles = readdirSync('src/host', { withFileTypes: true })
  .filter(entry => !entry.isDirectory()).map(entry => entry.name)
const hostCopies = buildHostCopyManifest(hostFiles)

// Discard only generated outputs so old entry points cannot leak into packages.
rmSync(join(root, 'lib'), { recursive: true, force: true })
rmSync(join(root, '.cache/typert'), { recursive: true, force: true })
mkdirSync(join(root, 'lib'), { recursive: true })
mkdirSync('lib/native-runtime-guard', { recursive: true })
cpSync('scripts/host-extension-guard.mjs', 'lib/native-runtime-guard/index.mjs')
cpSync('scripts/host-runtime.mjs', 'lib/native-runtime-guard/host-runtime.mjs')
writeFileSync('lib/native-runtime-guard/package.json', JSON.stringify({
  name: 'dsh-cliworker-native-preflight', private: true, type: 'module', main: './index.mjs',
}) + '\n')
tsc('tsconfig.host-build.json')
mkdirSync('lib/types/host', { recursive: true })
for (const { source, destination } of hostCopies) {
  copyFileSync(source, destination)
}
await build({
  entry: { index: 'lib/types/host/index.js' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  clean: false,
  sourcemap: true,
  dts: false,
  outputOptions: { entryFileNames: '[name].js' },
})

// The published generator requires a packages/* workspace inventory. Stage our
// single package at build time; no Harness source checkout is needed by users.
const stage = join(root, '.cache/typert')
const owner = join(stage, 'packages/cliworker')
mkdirSync(owner, { recursive: true })
cpSync('src', join(owner, 'src'), { recursive: true })
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const stagedManifest = structuredClone(manifest)
stagedManifest.exports['.'] = { types: './src/host/index.ts', default: './src/host/index.ts' }
writeFileSync(join(owner, 'package.json'), JSON.stringify(stagedManifest))
cpSync('lib/types', join(owner, 'lib/types'), { recursive: true })
const stageModules = join(stage, 'node_modules')
mkdirSync(stageModules, { recursive: true })
for (const base of [dependencies.modules, join(dependencies.modules, '.pnpm/node_modules')]) {
  if (!existsSync(base)) continue
  for (const item of readdirSync(base)) {
    if (item.startsWith('.')) continue
    const names = item.startsWith('@') ? readdirSync(join(base, item)).map(name => `${item}/${name}`) : [item]
    for (const name of names) {
      const target = join(base, name), alias = join(stageModules, name)
      if (!existsSync(join(target, 'package.json')) || existsSync(alias)) continue
      mkdirSync(join(alias, '..'), { recursive: true })
      symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    }
  }
}
writeFileSync(
  join(owner, 'tsconfig.host.json'),
  JSON.stringify({
    ...JSON.parse(readFileSync('tsconfig.base.json')),
    include: ['src/host/**/*.ts', 'src/shared/**/*.ts'],
  }),
)
// The analyzer identifies decorators and merged resource maps by workspace
// ownership. Stage the selected published SDK declaration graph as declarations,
// preserving every actual typed export; never mutate or invent SDK source.
const sdkPaths = {}
const sdkReferences = []
const sdkDeclarations = []
const ts = dependencies.require('typescript')
for (const leaf of readdirSync(join(stageModules, '@deepseek-ai')).filter(name => name.startsWith('dsh-')).sort()) {
  const name = `@deepseek-ai/${leaf}`
  const installed = join(stageModules, name)
  const packageManifest = JSON.parse(readFileSync(join(installed, 'package.json')))
  if (!existsSync(join(installed, 'lib/types'))) continue
  const directory = join(stage, 'packages', name.replace('@deepseek-ai/', 'sdk-'))
  mkdirSync(directory, { recursive: true })
  cpSync(join(installed, 'lib/types'), join(directory, 'declarations'), { recursive: true })
  sdkDeclarations.push(...ts.sys.readDirectory(join(directory, 'declarations'), ['.d.ts']))
  for (const [subpath, value] of Object.entries(packageManifest.exports ?? {})) {
    if (typeof value?.types !== 'string' || !value.types.startsWith('./lib/types/')) continue
    const declaration = value.types.replace('./lib/types/', './declarations/')
    packageManifest.exports[subpath] = { types: declaration, default: declaration }
    sdkPaths[name + (subpath === '.' ? '' : subpath.slice(1))] = [join(directory, declaration)]
  }
  writeFileSync(join(directory, 'package.json'), JSON.stringify(packageManifest))
  writeFileSync(join(directory, 'tsconfig.host.json'), JSON.stringify({ include: ['declarations/**/*.d.ts'] }))
  sdkReferences.push({ path: join(directory, 'tsconfig.host.json') })
}
writeFileSync(join(stage, 'tsconfig.host.json'), JSON.stringify({
  compilerOptions: { ...JSON.parse(readFileSync('tsconfig.base.json')).compilerOptions, paths: sdkPaths },
  files: [], references: [{ path: './packages/cliworker/tsconfig.host.json' }, ...sdkReferences],
}))
const stageConfig = ts.readConfigFile(join(stage, 'tsconfig.host.json'), ts.sys.readFile)
if (stageConfig.error) throw new Error(ts.flattenDiagnosticMessageText(stageConfig.error.messageText, '\n'))
const parsedStageConfig = ts.parseJsonConfigFileContent(stageConfig.config, ts.sys, stage)
const normalized = normalizeAugmentationImports(ts, sdkDeclarations, parsedStageConfig.options)
if (normalized.length) console.log(`Normalized staged augmentation imports in ${normalized.length} SDK declaration files`)
const generator = new WorkspaceTypertGenerator(stage, { checkDiagnostics: false })
const artifacts = generator.generate([manifest.name], ['host'])
if (artifacts.length !== 1 || !artifacts[0].remote) throw new Error('Missing generated Host/Remote contract')
const artifact = artifacts[0]
writeFileSync('lib/typert.host.js', artifact.js)
writeFileSync('lib/typert.host.d.ts', artifact.dts)
writeFileSync('lib/typert.remote-client.js', artifact.remote.js)
writeFileSync('lib/typert.remote-client.d.ts', artifact.remote.dts)
writeFileSync('lib/typert.remote-client.d.ts.map', artifact.remote.dtsMap)
if (process.argv.includes('--host-only')) process.exit(0)
tsc('tsconfig.client.json')
cpSync('src/client/assets', 'lib/types/client/assets', { recursive: true })
await build({
  plugins: [selectedTypertResolver(dependencies)],
  entry: { client: 'lib/types/client/index.js' },
  outDir: 'lib',
  platform: 'browser',
  loader: { '.png': 'dataurl' },
  format: 'cjs',
  clean: false,
  dts: false,
  sourcemap: true,
  deps: clientBundleDependencies(),
  define: clientBundleDefines(),
  outputOptions: {
    banner: 'window.__ModuleLoader__.load({ id: "dsh-cliworker-now", factory: (require) => {',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
    entryFileNames: '[name].js',
  },
})
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await buildPlugin()
