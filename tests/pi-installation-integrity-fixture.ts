/** 模拟 Pi 1.5.2 npm tree; no native code or credentials are executed/read. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export function simulatedPiInstallation(root: string, version = '1.5.2') {
  const pkg = join(root, 'AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent')
  const write = (relative: string, source: string) => {
    const path = join(pkg, relative); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, source); return path
  }
  write('package.json', JSON.stringify({ name: '@earendil-works/pi-coding-agent', version, type: 'module', bin: { pi: 'dist/bundle/cli.js' } }))
  write('dist/cli.js', '// 模拟 CLI; never execute\n')
  const entry = write('dist/bundle/cli.js', '// 模拟 bundle can report a version despite damaged SDK dependencies\n')
  write('dist/index.js', 'export {}\n')
  write('dist/core/model-runtime.js', 'import "@earendil-works/pi-ai"; export class ModelRuntime {}\n')
  write('dist/core/auth-storage.js', 'import "@earendil-works/pi-ai/oauth"; export class AuthStorage {}\n')
  const ai = 'node_modules/@earendil-works/pi-ai'
  const aiManifest = write(`${ai}/package.json`, JSON.stringify({ name: '@earendil-works/pi-ai', type: 'module', exports: { '.': { import: './dist/index.js', require: './broken-require.cjs' }, './oauth': './dist/oauth.js' } }))
  const aiEntry = write(`${ai}/dist/index.js`, 'export * from "./models.js";\n')
  write(`${ai}/dist/models.js`, 'import "node:fs"; import "node-domexception"; export const models = [];\n')
  write(`${ai}/dist/oauth.js`, 'export const oauth = [];\n')
  // Real healthy Windows shape: these are NOT reached from the imported graph.
  mkdirSync(join(pkg, 'node_modules/.bin'), { recursive: true })
  write('node_modules/node-domexception/package.json', '{"name":"node-domexception","main":"index.js"}')
  write('node_modules/node-domexception/index.js', 'module.exports = Error;\n')
  write('node_modules/node-domexception/.history/index_20210527203842.js', '')
  write('node_modules/node-domexception/.history/test_20210527205603.js', '')
  return { pkg, entry, aiManifest, aiEntry, write }
}
