import { execFileSync, spawnSync } from 'node:child_process'
import { lstatSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const prettier = require.resolve('prettier/bin/prettier.cjs')
const pathspec = ['--', ':(exclude,glob)**/.env*', ':(exclude,glob)**/.dev.vars']

function gitPaths(args) {
  return execFileSync('git', [...args, ...pathspec], { cwd, encoding: 'utf8' }).split('\0')
}

const tracked = gitPaths([
  'diff',
  '--merge-base',
  'refs/heads/main',
  '--name-only',
  '--no-renames',
  '--diff-filter=d',
  '-z',
])
const untracked = gitPaths(['ls-files', '--others', '--exclude-standard', '-z'])
const files = [...new Set([...tracked, ...untracked])].filter(
  (path) => path && lstatSync(join(cwd, path), { throwIfNoEntry: false })?.isFile(),
)

if (files.length === 0) console.log('No changed files to check.')

// Keep each Prettier invocation below common command-line length limits.
let batch = []
let batchSize = 0
function checkBatch() {
  const result = spawnSync(process.execPath, [prettier, '--check', '--ignore-unknown', '--', ...batch], {
    cwd,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  process.exitCode = Math.max(process.exitCode ?? 0, result.status ?? 1)
  batch = []
  batchSize = 0
}

for (const path of files) {
  const argument = `./${path}`
  const size = Buffer.byteLength(argument) + 3
  if (batchSize + size > 12_000) checkBatch()
  batch.push(argument)
  batchSize += size
}
if (batch.length) checkBatch()
