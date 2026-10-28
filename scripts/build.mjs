import { cpSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { selectBuildDependencies, buildTypeConfig, clientBundleDependencies, clientBundleDefines, selectedTypertResolver } from './build-dependencies.mjs'
import { verifyHostRuntime } from './host-runtime.mjs'

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
  'native-transport',
  'native-tool-outcomes',
  'native-harness-injection',
  'native-agy-harness',
  'native-attachments',
  'native-harness-mcp',
  'native-harness-extension',
  'native-codex',
  'native-claude',
  'native-agy',
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
  'qoder-durable-context',
  'kimi-durable-usage',
  'omp-context-inspection',
  'pi-context-observer',
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
  'pi-installation',
  'account-models',
  'zcode-resume',
  'pi-login',
  'grok-catalog',
  'own-account-lease',
  'pi-omp-refresh',
]) {
  const source = `src/host/${name}.mjs`
  if (existsSync(source)) cpSync(source, `lib/${name}.mjs`)
}
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
for (const name of ['kimi-durable-usage', 'qoder-durable-context', 'omp-context-inspection', 'hermes-observer', 'native-hermes-home', 'native-http', 'native-attachments', 'native-agy-harness', 'native-harness-injection', 'native-harness-mcp', 'native-harness-extension', 'native-response', 'primary-response', 'codex-run-usage', 'http-rpc-response', 'grok-response', 'grok-durable-context', 'zcode-response', 'zcode-context-observation', 'windows-console-manifest']) {
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
cpSync('src/host/private-launch.mjs', 'lib/types/host/private-launch.mjs')
cpSync('src/host/pi-omp-environment.mjs', 'lib/types/host/pi-omp-environment.mjs')
cpSync('src/host/pi-omp-environment.d.mts', 'lib/types/host/pi-omp-environment.d.mts')
for (const name of ['own-account-lease', 'pi-omp-refresh', 'pi-omp-control']) {
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
for (const leaf of readdirSync(join(stageModules, '@deepseek-ai')).filter(name => name.startsWith('dsh-')).sort()) {
  const name = `@deepseek-ai/${leaf}`
  const installed = join(stageModules, name)
  const packageManifest = JSON.parse(readFileSync(join(installed, 'package.json')))
  if (!existsSync(join(installed, 'lib/types'))) continue
  const directory = join(stage, 'packages', name.replace('@deepseek-ai/', 'sdk-'))
  mkdirSync(directory, { recursive: true })
  cpSync(join(installed, 'lib/types'), join(directory, 'declarations'), { recursive: true })
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
