import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, symlink, link, rm, chmod, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  SOURCE_ROOT_FILES, SOURCE_SCRIPTS, WINDOWS_TESTS, sha256, createSnapshot, validateSnapshot,
  validateSourcePath, validateRemoteRoot, validateArchiveEntries, strictSshArgs,
  assertNoLinksWithin, runtimeManifestFromSnapshot,
} from '../scripts/windows-remote-common.mjs'
import { readConfig, verifyRemoteReport, verifyPreviewSnapshot } from '../scripts/windows-remote.mjs'
import { acquireRunLock, isolatedEnvironment, stageOutcome } from '../scripts/windows-remote-runner.mjs'

const roots: string[] = []
// The repository's tracked runtime-host is the real packaged structure (203 manifest files plus manifest.json).
const repositoryRuntime = resolve(import.meta.dirname, '..', 'runtime-host')
const repositoryManifest = JSON.parse(await readFile(join(repositoryRuntime, 'manifest.json'), 'utf8'))
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'windows-remote-test-'))
  roots.push(root)
  for (const file of [...SOURCE_ROOT_FILES, ...WINDOWS_TESTS, 'src/host/index.ts', ...SOURCE_SCRIPTS]) {
    await mkdir(join(root, file, '..'), { recursive: true })
    await writeFile(join(root, file), '')
  }
  await cp(repositoryRuntime, join(root, 'runtime-host'), { recursive: true })
  return root
}
/** Mirrors `tar -tzf` of an npm pack of the current files list: files only, no directory entries. */
function packageListing(runtimeFiles = ['manifest.json', ...repositoryManifest.files.map((file: { path: string }) => file.path)]) {
  return ['package/LICENSE', 'package/package.json', 'package/README.en.md', 'package/README.md', 'package/cordis.patch.yml',
    'package/lib/index.js', 'package/lib/client.js', ...runtimeFiles.map((path) => `package/runtime-host/${path}`)].join('\n') + '\n'
}
const regular = (listing: string) => listing.trim().split('\n').map((name) => `-rw-r--r-- 0 0 0 1 Oct 20 00:00 ${name}`).join('\n')

describe('Windows remote developer safety and evidence boundaries (synthetic fixtures)', () => {
  it('requires private explicit config and bypasses general SSH config/password fallback', async () => {
    const root = await fixture()
    const privateDir = join(root, '.test-data/windows-remote')
    await mkdir(privateDir, { recursive: true })
    const config = { host: 'windows.test', user: 'tester', identity: join(root, 'identity'), knownHosts: join(root, 'hosts'), remoteRoot: 'C:/Users/tester/AppData/Local/cliworker-now-remote' }
    await writeFile(config.identity, 'synthetic-private-key', { mode: 0o600 })
    await writeFile(config.knownHosts, 'synthetic-known-host', { mode: 0o600 })
    const file = join(privateDir, 'config.json')
    await writeFile(file, JSON.stringify(config))
    expect(await readConfig(file, root)).toEqual(config)
    expect(strictSshArgs(config)).toEqual(expect.arrayContaining(['-F', '/dev/null', 'BatchMode=yes', 'StrictHostKeyChecking=yes', 'IdentitiesOnly=yes', 'PasswordAuthentication=no', 'KbdInteractiveAuthentication=no']))
    await expect(readConfig(join(root, 'package.json'), root)).rejects.toThrow('Git ignored')
    await expect(readConfig(join(root, '.test-data', 'windows-remote-other', 'config.json'), root)).rejects.toThrow('Git ignored')
    await writeFile(file, JSON.stringify({ ...config, host: '-oProxyCommand=unsafe' }))
    await expect(readConfig(file, root)).rejects.toThrow('host')
    await writeFile(file, JSON.stringify({ ...config, user: 'name;unsafe' }))
    await expect(readConfig(file, root)).rejects.toThrow('user')
    await writeFile(file, JSON.stringify({ ...config, identity: './identity' }))
    await expect(readConfig(file, root)).rejects.toThrow('absolute')
    await writeFile(file, JSON.stringify({ ...config, password: 'never-accepted' }))
    await expect(readConfig(file, root)).rejects.toThrow('Unknown')
  })

  it.each(['C:/Users/tester', 'C:/Windows/cliworker-now-remote', 'C:/Users/tester/AppData/Local/../cliworker-now-remote', 'C:/Users/tester/AppData/Local/other', '\\\\server\\share'])('rejects unknown remote root %s', (path) => {
    expect(() => validateRemoteRoot(path)).toThrow()
  })

  it.each(['.git/config', 'node_modules/package.json', 'tests/.env', 'src/link/../outside.ts', 'tests/credentials.json', 'tests/secrets.json', 'src/private-key.json', 'tests/id_ed25519.txt', 'tests/auth.json', 'tests/token.json', 'tests/secret.key', 'src/aux.json', 'src/file:stream.ts', 'src/name. /file.ts'])('rejects leakage or Windows unsafe path %s', (path) => {
    expect(() => validateSourcePath(path)).toThrow()
  })

  it('snapshots required workspace/config/fixtures and actual static assets without dependencies', async () => {
    const root = await fixture()
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'node_modules/private.txt'), 'synthetic-sensitive-value')
    await writeFile(join(root, 'tests/.DS_Store'), 'Mac metadata')
    await mkdir(join(root, 'src/client/assets'), { recursive: true })
    await writeFile(join(root, 'src/client/assets/test.png'), Buffer.from([1, 2, 3]))
    const snapshot = validateSnapshot(await createSnapshot(root))
    expect(snapshot.files.map((file: { path: string }) => file.path)).toEqual(expect.arrayContaining(['pnpm-workspace.yaml', 'tsconfig.base.json', ...WINDOWS_TESTS, 'src/client/assets/test.png']))
    expect(JSON.stringify(snapshot)).not.toContain('node_modules')
    expect(snapshot.files.some((file: { path: string }) => file.path.includes('.DS_Store'))).toBe(false)
    const corrupt = structuredClone(snapshot)
    corrupt.files[0].data = Buffer.from('changed').toString('base64')
    expect(() => validateSnapshot(corrupt)).toThrow('integrity')
    expect(() => validateSnapshot({ ...snapshot, files: [...snapshot.files, { ...snapshot.files[0], path: snapshot.files[0].path.toUpperCase() }] })).toThrow()
    expect(() => validateSnapshot({ ...snapshot, files: snapshot.files.filter((file: { path: string }) => file.path !== 'pnpm-workspace.yaml') })).toThrow('missing')
  })

  it.skipIf(process.platform === 'win32')('refuses source symlinks, hardlinks and evidence directory links', async () => {
    const root = await fixture()
    await writeFile(join(root, 'outside.txt'), 'synthetic-secret')
    await symlink(join(root, 'outside.txt'), join(root, 'tests/safe.ts'))
    await expect(createSnapshot(root)).rejects.toThrow('symlink')
    await rm(join(root, 'tests/safe.ts'))
    await link(join(root, 'outside.txt'), join(root, 'tests/safe.ts'))
    await expect(createSnapshot(root)).rejects.toThrow('hardlink')
    await symlink(join(root, 'src'), join(root, 'runs'))
    await expect(assertNoLinksWithin(root, join(root, 'runs/new/log.json'))).rejects.toThrow('link')
    await expect(assertNoLinksWithin(root, join(root, '..', 'outside'))).rejects.toThrow('escapes')
  })

  it('rejects package traversal, special entries and absent Host entry', () => {
    const valid = packageListing()
    expect(validateArchiveEntries(valid, regular(valid), repositoryManifest)).toContain('package/lib/index.js')
    for (const bad of ['package/lib/../../escape', 'package/lib/file:stream', 'package/lib/nul.js', 'package/lib/.. /outside', 'package/runtime-host/../escape', 'package/src/index.ts']) expect(() => validateArchiveEntries(`${valid}${bad}`, '-rw-r--r-- entries', repositoryManifest)).toThrow()
    expect(() => validateArchiveEntries(valid, 'lrwxrwxrwx package/lib/link -> outside', repositoryManifest)).toThrow('links')
    const noHost = valid.replace('package/lib/index.js\n', '')
    expect(() => validateArchiveEntries(noHost, regular(noHost), repositoryManifest)).toThrow('Host')
  })

  it('accepts the real runtime-host package structure and rejects files outside its manifest', async () => {
    const root = await fixture()
    const snapshot = validateSnapshot(await createSnapshot(root))
    const paths = snapshot.files.map((file: { path: string }) => file.path)
    expect(paths).toEqual(expect.arrayContaining([...SOURCE_SCRIPTS, 'runtime-host/manifest.json', 'runtime-host/source.patch', 'runtime-host/dsh-client-ui-chat/lib/client.js']))
    const manifest = runtimeManifestFromSnapshot(snapshot)
    expect(manifest.files).toHaveLength(repositoryManifest.files.length)
    const listing = packageListing()
    expect(validateArchiveEntries(listing, regular(listing), manifest)).toHaveLength(7 + 1 + repositoryManifest.files.length)
    const withDirectories = `package/\npackage/runtime-host/\npackage/runtime-host/dsh-client-ui-chat/lib/\n${listing}`
    expect(() => validateArchiveEntries(withDirectories, regular(withDirectories), manifest)).not.toThrow()
    for (const extra of ['package/runtime-host/extra.js', 'package/runtime-host/dsh-client-ui-chat/lib/injected.js', 'package/runtime-host/dsh-client-ui-other/', 'package/runtime-host/manifest.json/'])
      expect(() => validateArchiveEntries(`${listing}${extra}\n`, regular(listing), manifest)).toThrow(/runtime-host/)
    expect(() => validateArchiveEntries(packageListing(['manifest.json', ...repositoryManifest.files.slice(1).map((file: { path: string }) => file.path)]), regular(listing), manifest)).toThrow('missing runtime-host')
    expect(() => validateArchiveEntries(listing, regular(listing), { ...manifest, files: [...manifest.files, { path: '../escape.js', bytes: 1, sha256: '0'.repeat(64) }] })).toThrow()
    expect(() => validateArchiveEntries(listing, regular(listing), undefined)).toThrow('manifest')
  })

  it('fails on a concurrent run and preserves the existing lock ownership', async () => {
    const root = await fixture()
    await acquireRunLock(root, 'first-synthetic-run')
    const before = await readFile(join(root, 'run.lock'), 'utf8')
    await expect(acquireRunLock(root, 'second-synthetic-run')).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(join(root, 'run.lock'), 'utf8')).toBe(before)
  })

  it('isolates child account/cache/config paths and never forwards secret environment variables', () => {
    const env = isolatedEnvironment({ PATH: 'native-tools', SystemRoot: 'C:\\Windows', USERPROFILE: 'production-home', OPENAI_API_KEY: 'synthetic', ANTHROPIC_API_KEY: 'synthetic', DSH_HOME: 'production-dsh', npm_config_userconfig: 'production-npm' }, 'C:\\owned\\run')
    expect(env.PATH).toBe('native-tools')
    expect(env).not.toHaveProperty('OPENAI_API_KEY')
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(env.USERPROFILE).not.toBe('production-home')
    expect(env.DSH_HOME).not.toBe('production-dsh')
    expect(env.ProgramFiles).toContain('programfiles')
    expect(env.ProgramFiles).toBe(env.PROGRAMFILES)
    expect(env.npm_config_userconfig).not.toBe(env.npm_config_globalconfig)
    expect(stageOutcome(null, 'SIGTERM').success).toBe(false)
    expect(stageOutcome(1, null).success).toBe(false)
  })

  it('detects source edits after preview creation', async () => {
    const root = await fixture()
    const snapshot = await createSnapshot(root)
    await expect(verifyPreviewSnapshot(root, snapshot)).resolves.toBeUndefined()
    await writeFile(join(root, 'src/host/index.ts'), 'changed after build')
    await expect(verifyPreviewSnapshot(root, snapshot)).rejects.toThrow('changed since preview')
  })

  it('requires complete matching Windows raw test evidence, hashes and successful stages', () => {
    const tests = { success: true, numPassedTests: 7, numFailedTests: 0, numPendingTests: 0, numTotalTests: 7, testResults: WINDOWS_TESTS.map((name: string) => ({ name: `C:/owned/source/${name}`, assertionResults: [] })) }
    const bytes = Buffer.from(JSON.stringify(tests))
    const state = { runId: 'synthetic-run', macPackageSha256: 'package-hash', sourceSnapshotSha256: 'snapshot-hash' }
    const report = { ...state, success: true, platform: 'win32', finishedAt: 'synthetic-time', receivedPackageSha256: state.macPackageSha256, modelCalls: 0, guiVerified: false, officialCliSmokeExecuted: false,
      cleanup: { confirmed: true, lockReleased: true }, windowsTestsSha256: sha256(bytes), tests: { success: true, passed: 7, failed: 0, pending: 0, total: 7 },
      stages: ['pnpm-version', 'install', 'typecheck', 'windows-tests', 'package-list', 'package-entries', 'package-unpack', 'mac-contract-types', 'mac-package-host-load'].map((name) => ({ name, exitCode: 0, success: true, signal: null })) }
    expect(verifyRemoteReport(report, bytes, state)).toBe(true)
    expect(() => verifyRemoteReport({ ...report, runId: 'another-run' }, bytes, state)).toThrow('identity')
    expect(() => verifyRemoteReport(report, Buffer.from('changed'), state)).toThrow('hash')
    expect(() => verifyRemoteReport({ ...report, receivedPackageSha256: 'different' }, bytes, state)).toThrow('transfer')
    expect(() => verifyRemoteReport({ ...report, stages: report.stages.map((stage) => stage.name === 'install' ? { ...stage, exitCode: 1 } : stage) }, bytes, state)).toThrow('stage')
    expect(() => verifyRemoteReport({ ...report, tests: { ...report.tests, passed: 6 } }, bytes, state)).toThrow('disagree')
    expect(() => verifyRemoteReport({ ...report, modelCalls: 1 }, bytes, state)).toThrow('scope')
    expect(() => verifyRemoteReport({ ...report, cleanup: { confirmed: false, lockReleased: false } }, bytes, state)).toThrow('cleanup')
    // Newly included suites retain their exact POSIX/macOS-only cases on Windows.
    const skips = [
      ['tests/cli-account-binding.test.ts', 'binds an Antigravity login that keeps only id_token_email, stable across case and rotation'],
      ['tests/os-credential-store.test.ts', '模拟：security 以十六进制输出的非 ASCII 登录文档同样可读'],
      ['tests/zcode-app-runtime.test.ts', '模拟：权限不是仅本人可读写的密钥文件同样判为不可用'],
      ['tests/zcode-app-runtime.test.ts', '模拟：启动检查、--help、登录、退出、账号终端、版本读取和基础环境都使用同一个 /tmp/cwn- 目录'],
    ]
    const withSkips = (entries: string[][]) => ({ ...tests, numPendingTests: entries.length, numTotalTests: tests.numTotalTests + entries.length,
      testResults: WINDOWS_TESTS.map((name: string) => ({ name: `C:/owned/source/${name}`,
        assertionResults: entries.filter(([file]) => file === name).map(([, title]) => ({ status: 'pending', title })) })) })
    const verifySkips = (entries: string[][]) => {
      const skipped = withSkips(entries), skippedBytes = Buffer.from(JSON.stringify(skipped))
      return verifyRemoteReport({ ...report, windowsTestsSha256: sha256(skippedBytes),
        tests: { ...report.tests, pending: skipped.numPendingTests, total: skipped.numTotalTests } }, skippedBytes, state)
    }
    expect(verifySkips(skips)).toBe(true)
    expect(() => verifySkips([[skips[0]![0]!, 'an unexpected skip']])).toThrow('Unexpected skipped')
    expect(() => verifySkips([[skips[0]![0]!, skips[1]![1]!]])).toThrow('Unexpected skipped')
  })
})
