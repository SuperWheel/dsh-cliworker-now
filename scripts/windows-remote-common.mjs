import { createHash } from 'node:crypto'
import { lstat, open, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, posix, relative, dirname, resolve } from 'node:path'

export const OWNER = { kind: 'cliworker-now-windows-remote', schema: 1 }
export const MARKER = '.cliworker-remote-owned.json'
export const PNPM_VERSION = '11.25.0'
export const WINDOWS_TESTS = [
  'tests/windows-accounts.test.ts', 'tests/windows-process.test.ts',
  'tests/native-launch.test.ts', 'tests/pi-omp-identity.test.ts',
  'tests/adapters.test.ts', 'tests/account-login.test.ts',
  'tests/model-presentation.test.ts',
  'tests/windows-account-owner.test.ts', 'tests/windows-account-terminal.test.ts',
  'tests/windows-cli-resolution.test.ts', 'tests/windows-codex-launch.test.ts',
  'tests/windows-system-proxy.test.ts', 'tests/opencode-windows-login.test.ts',
  'tests/zcode-grok-windows-regression.test.ts', 'tests/authorized-catalog-windows-agy.test.ts',
  'tests/native-agy-acp.test.ts', 'tests/agy-account-guide.test.ts',
]
export const SOURCE_ROOT_FILES = [
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'tsconfig.base.json', 'tsconfig.host-build.json', 'tsconfig.client.json',
  'vitest.config.ts', 'cordis.patch.yml',
]
// build.mjs imports these helpers and verifies runtime-host before typecheck.
export const SOURCE_SCRIPTS = new Set(['scripts/build.mjs', 'scripts/build-preview.mjs', 'scripts/build-dependencies.mjs',
  'scripts/host-runtime.mjs', 'scripts/host-extension-guard.mjs'])
export const RUNTIME_HOST = 'runtime-host'
const RUNTIME_MANIFEST = `${RUNTIME_HOST}/manifest.json`
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const validRunId = (id) => /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/.test(id)

export function validateWindowsComponents(value) {
  if (value.includes('\\') || /[\x00-\x1f:]/.test(value) || value.split('/').some((part) => /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error(`Unsafe Windows filename: ${value}`)
}

export async function assertNoLinksWithin(root, target) {
  const rel = relative(root, target)
  if (rel.startsWith('..') || rel.includes(':')) throw new Error('Path escapes owned root')
  let current = root
  for (const part of ['', ...rel.split(/[\\/]/).filter(Boolean)]) {
    if (part) current = join(current, part)
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Path contains a link: ${current}`) }
    catch (error) { if (error.code === 'ENOENT') return; throw error }
  }
}

export async function assertNoLinkAncestors(target) {
  let current = resolve(target)
  while (true) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Path contains a link: ${current}`) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}

export function validateRemoteRoot(value) {
  if (typeof value !== 'string' || !/^[A-Z]:\/Users\/[A-Za-z\d_-][A-Za-z\d_.-]*\/AppData\/Local\/cliworker-now-remote$/.test(value))
    throw new Error('remoteRoot must be an explicit Users/<user>/AppData/Local/cliworker-now-remote path')
  if (value.split('/').some((part) => part === '.' || part === '..')) throw new Error('Unsafe remoteRoot')
  return value
}

export function validateSourcePath(value) {
  validateWindowsComponents(value)
  if (typeof value !== 'string' || value.includes('\\') || value.startsWith('/') || posix.normalize(value) !== value || /[\x00-\x1f:]/.test(value))
    throw new Error(`Unsafe source path: ${value}`)
  if (value.split('/').some((part) => part === '..' || part === '.' || part.startsWith('.') || /^(?:node_modules|credentials?|secrets?|auth|tokens?|private[-_]keys?|id_ed25519|id_rsa)(?:\.|$)/i.test(part) || /\.(?:pem|key|pfx|p12|log)$/i.test(part)))
    throw new Error(`Sensitive or excluded source path: ${value}`)
  if (SOURCE_ROOT_FILES.includes(value) || SOURCE_SCRIPTS.has(value)) return value
  if (/^(?:src|tests)\/.+\.(?:ts|tsx|mts|mjs|js|json|py|cmd|ps1|txt)$/.test(value) || /^src\/client\/assets\/.+\.(?:png|svg)$/.test(value)) return value
  if (/^runtime-host\/(?:manifest\.json|README\.md|source\.patch|dsh-client-ui-(?:session|conversation|subagent|chat)\/(?:LICENSE|package\.json|lib\/.+\.(?:js|d\.ts)))$/.test(value)) return value
  throw new Error(`Source path is outside the allowlist: ${value}`)
}

export async function createSnapshot(root) {
  const files = []
  async function collect(relative) {
    const path = join(root, relative)
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error(`Source symlink is forbidden: ${relative}`)
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) if (name !== '.DS_Store') await collect(`${relative}/${name}`)
      return
    }
    if (!info.isFile()) throw new Error(`Source is not a regular file: ${relative}`)
    if (info.nlink !== 1) throw new Error(`Source hardlink is forbidden: ${relative}`)
    validateSourcePath(relative)
    if (info.size > 10 * 1024 * 1024) throw new Error(`Source file is too large: ${relative}`)
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    let bytes
    try {
      const before = await handle.stat()
      if (!before.isFile() || before.nlink !== 1 || before.ino !== info.ino) throw new Error(`Source changed while reading: ${relative}`)
      bytes = await handle.readFile()
      const after = await handle.stat()
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error(`Source changed while reading: ${relative}`)
    } finally { await handle.close() }
    files.push({ path: relative, sha256: sha256(bytes), data: bytes.toString('base64') })
  }
  for (const file of [...SOURCE_ROOT_FILES, ...SOURCE_SCRIPTS, 'src', 'tests', RUNTIME_HOST]) await collect(file)
  return { schema: 1, files }
}

export function validateSnapshot(snapshot) {
  if (snapshot?.schema !== 1 || !Array.isArray(snapshot.files) || snapshot.files.length > 5000) throw new Error('Invalid source snapshot')
  const names = new Set()
  let total = 0
  for (const file of snapshot.files) {
    validateSourcePath(file.path)
    // Windows paths are case insensitive; duplicate paths must not overwrite one another.
    const name = file.path.toLowerCase()
    if (names.has(name)) throw new Error(`Duplicate source path: ${file.path}`)
    names.add(name)
    if (typeof file.data !== 'string' || !/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(file.data)) throw new Error('Invalid base64 source')
    const bytes = Buffer.from(file.data, 'base64')
    total += bytes.length
    if (total > 50 * 1024 * 1024 || sha256(bytes) !== file.sha256) throw new Error(`Source integrity failure: ${file.path}`)
  }
  for (const required of [...SOURCE_ROOT_FILES, ...SOURCE_SCRIPTS, ...WINDOWS_TESTS, RUNTIME_MANIFEST]) if (!names.has(required.toLowerCase())) throw new Error(`Source snapshot missing ${required}`)
  return snapshot
}

/** runtime-host/manifest.json lists every packaged runtime file (paths relative to runtime-host). */
export function validateRuntimeManifest(manifest) {
  if (!Array.isArray(manifest?.files) || !manifest.files.length || manifest.files.length > 500) throw new Error('Invalid runtime-host manifest')
  for (const file of manifest.files) validateSourcePath(`${RUNTIME_HOST}/${file?.path}`)
  return manifest
}

export function runtimeManifestFromSnapshot(snapshot) {
  const file = snapshot.files.find((item) => item.path === RUNTIME_MANIFEST)
  if (!file) throw new Error(`Source snapshot missing ${RUNTIME_MANIFEST}`)
  return validateRuntimeManifest(JSON.parse(Buffer.from(file.data, 'base64').toString('utf8')))
}

/** package/runtime-host/ must hold exactly manifest.json and the files it lists. */
export function validateArchiveEntries(listing, verboseListing, runtimeManifest) {
  const names = listing.trim().split(/\r?\n/).filter(Boolean)
  if (!names.length || names.length > 10000) throw new Error('Invalid package archive')
  const manifest = validateRuntimeManifest(runtimeManifest)
  const runtimeFiles = new Set([RUNTIME_MANIFEST, ...manifest.files.map((file) => `${RUNTIME_HOST}/${file.path}`)].map((path) => `package/${path}`))
  const runtimeDirectories = new Set([...runtimeFiles].flatMap((path) => path.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'))))
  const seenRuntime = new Set()
  for (const name of names) {
    const value = name.replace(/\/$/, '')
    validateWindowsComponents(value)
    if (value.includes('\\') || posix.normalize(value) !== value || value.split('/').some((part) => part === '..' || part === '.') || !/^package(?:\/lib(?:\/.*)?|\/runtime-host(?:\/.*)?|\/package\.json|\/cordis\.patch\.yml|\/README(?:\.en)?\.md|\/LICENSE)?$/.test(value))
      throw new Error(`Unsafe package entry: ${name}`)
    if (!value.startsWith(`package/${RUNTIME_HOST}`)) continue
    if (runtimeFiles.has(value)) {
      if (name.endsWith('/') || seenRuntime.has(value)) throw new Error(`Unexpected runtime-host entry: ${name}`)
      seenRuntime.add(value)
    } else if (!runtimeDirectories.has(value)) throw new Error(`Runtime-host entry is outside its manifest: ${name}`)
  }
  for (const path of runtimeFiles) if (!seenRuntime.has(path)) throw new Error(`Package is missing runtime-host file: ${path}`)
  if (verboseListing.trim().split(/\r?\n/).some((line) => !/^[-d]/.test(line))) throw new Error('Package links or special files are forbidden')
  if (!names.includes('package/lib/index.js') || !names.includes('package/package.json')) throw new Error('Package is missing its Host entry')
  return names
}

export function strictSshArgs(config) {
  return ['-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'PasswordAuthentication=no',
    '-o', 'KbdInteractiveAuthentication=no', '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${config.knownHosts}`, '-o', 'GlobalKnownHostsFile=/dev/null',
    '-o', 'ConnectTimeout=15', '-o', 'ConnectionAttempts=1', '-i', config.identity]
}

export function encodedPowerShell(script) {
  const header = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$OutputEncoding=[Console]::OutputEncoding;$ProgressPreference='SilentlyContinue';"
  return ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(header + script, 'utf16le').toString('base64')]
}
