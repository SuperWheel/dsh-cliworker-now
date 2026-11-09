// Build an isolated package so UI acceptance cannot hot-reload the installed Desktop plugin.
import { cpSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { selectBuildDependencies } from './build-dependencies.mjs'
import { execFileSync } from 'node:child_process'

const root = resolve('.')
const dependencies = selectBuildDependencies(root)
const preview = join(root, '.cache/preview-package')
rmSync(preview, { recursive: true, force: true })
mkdirSync(preview, { recursive: true })
for (const file of [
  'src',
  'scripts/build.mjs',
  'scripts/build-dependencies.mjs',
  'scripts/host-runtime.mjs',
  'scripts/host-extension-guard.mjs',
  'runtime-host',
  'package.json',
  'cordis.patch.yml',
  'icon.png',
  'README.md',
  'README.en.md',
  'LICENSE',
  'tsconfig.base.json',
  'tsconfig.host-build.json',
  'tsconfig.client.json',
]) {
  cpSync(join(root, file), join(preview, file), { recursive: true })
}
symlinkSync(dependencies.modules, join(preview, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: preview, stdio: 'inherit', env: { ...process.env, CLIWORKER_BUILD_DEPS: dependencies.directory } })
console.log(`Isolated package ready: ${preview}`)
