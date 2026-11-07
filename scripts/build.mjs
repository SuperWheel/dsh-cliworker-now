import { cpSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { selectBuildDependencies, buildTypeConfig, clientBundleDependencies, clientBundleDefines, selectedTypertResolver } from './build-dependencies.mjs'
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
for (const name of [
  'private-launch',
  'windows-account-launch',
  'windows-account-stdio',
  'windows-hidden-launch',
  'windows-console-manifest',
  'native-launch',
  'native-spawn',
  'native-bridge',
  'native-time-limit',
  'native-transport',
  'native-tool-outcomes',
  'native-harness-injection',
  'cli-native-capabilities',
  'native-agy-harness',
  'native-attachments',
  'native-harness-mcp',
  'native-harness-extension',
  'native-codex',
  'native-claude',
  'native-agy',
  'native-agy-acp',
  'native-response',
  'primary-response',
  'codex-run-usage',
  'http-rpc-response',
  'grok-response',
  'grok-durable-context',
  'native-file-privacy',
  'zcode-response',
  'zcode-context-observation',
  'native-acp',
  'native-kimi',
  'native-qoder',
  'native-workbuddy',
  'workbuddy-bootstrap',
  'codebuddy-acp-outcome',
  'qoder-durable-context',
  'kimi-durable-usage',
  'omp-context-inspection',
  'pi-context-observer',
  'pi-permission-gate',
  'http-context-observer',
  'http-context-relay',
  'hermes-observer',
  'native-grok',
  'native-zcode',
  'native-http',
  'native-session-http',
  'native-opencode',
  'native-mimo',
  'native-hermes',
  'native-hermes-home',
  'pi-omp-environment',
  'terminal-bridge',
  'pi-omp-bridge',
  'pi-omp-control',
  'pi-native-catalog',
  'native-login-providers',
  'pi-installation',
  'account-models',
  'zcode-resume',
  'pi-login',
  'grok-catalog',
  'own-account-lease',
  'pi-omp-refresh',
  'host-fetch',
]) {
  const source = `src/host/${name}.mjs`
  if (existsSync(source)) cpSync(source, `lib/${name}.mjs`)
}
// WorkBuddy's bootstrap helper must remain beside its plain ESM runner.
cpSync('src/host/workbuddy-key-helper.cjs', 'lib/workbuddy-key-helper.cjs')
// Native metadata helpers are also imported by the emitted adapter declarations/runtime.
if (existsSync('src/host/account-models.mjs')) {
  cpSync('src/host/account-models.mjs', 'lib/types/host/account-models.mjs')
  cpSync('src/host/account-models.d.mts', 'lib/types/host/account-models.d.mts')
}
cpSync('src/host/pi-installation.mjs', 'lib/types/host/pi-installation.mjs')
cpSync('src/host/pi-installation.d.mts', 'lib/types/host/pi-installation.d.mts')
cpSync('src/host/native-launch.mjs', 'lib/types/host/native-launch.mjs')
cpSync('src/host/native-launch.d.mts', 'lib/types/host/native-launch.d.mts')
cpSync('src/host/native-spawn.mjs', 'lib/types/host/native-spawn.mjs')
for (const name of ['native-workbuddy', 'workbuddy-bootstrap', 'codebuddy-acp-outcome', 'native-acp', 'native-transport', 'native-spawn', 'kimi-durable-usage', 'qoder-durable-context', 'omp-context-inspection', 'hermes-observer', 'native-hermes-home', 'native-http', 'native-attachments', 'native-agy-harness', 'native-harness-injection', 'cli-native-capabilities', 'native-harness-mcp', 'native-harness-extension', 'native-response', 'native-tool-outcomes', 'primary-response', 'codex-run-usage', 'http-rpc-response', 'grok-response', 'grok-durable-context', 'zcode-response', 'zcode-context-observation', 'windows-console-manifest']) {
  cpSync(`src/host/${name}.mjs`, `lib/types/host/${name}.mjs`)
  if (existsSync(`src/host/${name}.d.mts`)) cpSync(`src/host/${name}.d.mts`, `lib/types/host/${name}.d.mts`)
}
for (const extension of ['mjs', 'ps1', 'd.mts']) {
  const source = `src/host/native-file-privacy.${extension}`
  if (existsSync(source)) {
    if (extension !== 'd.mts') cpSync(source, `lib/native-file-privacy.${extension}`)
    cpSync(source, `lib/types/host/native-file-privacy.${extension}`)
  }
}
cpSync('src/host/workbuddy-key-helper.cjs', 'lib/types/host/workbuddy-key-helper.cjs')
cpSync('src/host/private-launch.mjs', 'lib/types/host/private-launch.mjs')
cpSync('src/host/pi-omp-environment.mjs', 'lib/types/host/pi-omp-environment.mjs')
cpSync('src/host/pi-omp-environment.d.mts', 'lib/types/host/pi-omp-environment.d.mts')
for (const name of ['own-account-lease', 'pi-omp-refresh', 'pi-omp-control', 'host-fetch']) {
  cpSync(`src/host/${name}.mjs`, `lib/types/host/${name}.mjs`)
  if (existsSync(`src/host/${name}.d.mts`)) cpSync(`src/host/${name}.d.mts`, `lib/types/host/${name}.d.mts`)
}
// The native Hermes bridge is executed by the verified installed Python, both
// from the bundle URL and from emitted unbundled adapter modules.
for (const name of ['hermes-native-entry', 'hermes-nous-refresh', 'hermes-observer']) {
  cpSync(`src/host/${name}.py`, `lib/${name}.py`)
  cpSync(`src/host/${name}.py`, `lib/types/host/${name}.py`)
}
cpSync('src/host/windows-account-owner.ps1', 'lib/windows-account-owner.ps1')
cpSync('src/host/windows-account-owner.ps1', 'lib/types/host/windows-account-owner.ps1')
cpSync('src/host/windows-account-bootstrap.ps1', 'lib/windows-account-bootstrap.ps1')
cpSync('src/host/windows-account-bootstrap.ps1', 'lib/types/host/windows-account-bootstrap.ps1')
cpSync('src/host/windows-account-launch.mjs', 'lib/types/host/windows-account-launch.mjs')
cpSync('src/host/windows-account-stdio.mjs', 'lib/types/host/windows-account-stdio.mjs')
cpSync('src/host/windows-hidden-launch.mjs', 'lib/types/host/windows-hidden-launch.mjs')
cpSync('src/host/windows-agy-account.ps1', 'lib/windows-agy-account.ps1')
cpSync('src/host/windows-agy-account.ps1', 'lib/types/host/windows-agy-account.ps1')
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
