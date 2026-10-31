// Development-only Mac -> native Windows verification. No plugin runtime remote API.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, lstat, readFile, writeFile, cp, readdir, open, rm } from 'node:fs/promises'
import { resolve, join, relative, dirname, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OWNER, MARKER, WINDOWS_TESTS, sha256, validateRemoteRoot, createSnapshot, validateSnapshot, validateArchiveEntries, runtimeManifestFromSnapshot, strictSshArgs, encodedPowerShell, assertNoLinksWithin } from './windows-remote-common.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const privateRoot = join(projectRoot, '.test-data', 'windows-remote')

export async function readConfig(path, root = projectRoot) {
  const absolute = resolve(root, path)
  const privateDirectory = join(root, '.test-data', 'windows-remote')
  const withinPrivate = relative(privateDirectory, absolute)
  if (!withinPrivate || isAbsolute(withinPrivate) || withinPrivate === '..' || withinPrivate.startsWith(`..${sep}`)) throw new Error('Config must be inside .test-data/windows-remote (Git ignored)')
  for (let current = absolute; current !== root; current = dirname(current)) {
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`Config path may not contain symlinks: ${current}`)
  }
  const config = JSON.parse(await readFile(absolute, 'utf8'))
  if (Object.keys(config).some((key) => !['host', 'user', 'identity', 'knownHosts', 'remoteRoot'].includes(key))) throw new Error('Unknown connection config field')
  if (typeof config.host !== 'string' || !/^[A-Za-z\d][A-Za-z\d.-]*$/.test(config.host)) throw new Error('An explicit host is required')
  if (typeof config.user !== 'string' || !/^[A-Za-z\d_][A-Za-z\d_.-]*$/.test(config.user)) throw new Error('An explicit SSH user is required')
  validateRemoteRoot(config.remoteRoot)
  for (const key of ['identity', 'knownHosts']) {
    if (typeof config[key] !== 'string' || !isAbsolute(config[key]) || /[\r\n\0]/.test(config[key])) throw new Error(`${key} must be an absolute local file path`)
    const info = await lstat(config[key])
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${key} must be a regular local file`)
    if (key === 'identity' && process.platform !== 'win32' && (info.mode & 0o077)) throw new Error('SSH private key permissions must be 0600 or stricter')
  }
  return config
}

export function bootstrapCommand(config, runId) {
  const data = Buffer.from(JSON.stringify({ root: config.remoteRoot, runId, marker: OWNER }), 'utf8').toString('base64')
  return encodedPowerShell(`$ErrorActionPreference='Stop'
$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}'))|ConvertFrom-Json
$root=$d.root
$marker=Join-Path $root '${MARKER}'
$probe=$root
while($probe){
 if(Test-Path -LiteralPath $probe){if((Get-Item -LiteralPath $probe -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Remote root ancestor may not be a link'}}
 $parent=Split-Path -Path $probe -Parent
 if($parent -eq $probe){break}
 $probe=$parent
}
if(Test-Path -LiteralPath $root){
 if((Get-Item -LiteralPath $root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Remote root may not be a link'}
 if(-not(Test-Path -LiteralPath $marker)){throw 'Existing root has no ownership marker'}
 $markerInfo=Get-Item -LiteralPath $marker -Force
 if($markerInfo.PSIsContainer -or ($markerInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Remote root marker must be a regular file'}
 $owner=Get-Content -LiteralPath $marker -Raw|ConvertFrom-Json
 if($owner.kind -ne $d.marker.kind -or $owner.schema -ne $d.marker.schema){throw 'Remote root marker mismatch'}
}else{
 New-Item -ItemType Directory -Path $root|Out-Null
 $d.marker|ConvertTo-Json -Compress|Set-Content -LiteralPath $marker -Encoding ascii
}
$runs=Join-Path $root 'runs'
if(Test-Path -LiteralPath $runs){if((Get-Item -LiteralPath $runs -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Runs directory may not be a link'}}else{New-Item -ItemType Directory -Path $runs|Out-Null}
$run=Join-Path $runs $d.runId
if(Test-Path -LiteralPath $run){throw 'Run directory already exists'}
New-Item -ItemType Directory -Path $run|Out-Null
@{kind=$d.marker.kind;schema=$d.marker.schema;runId=$d.runId}|ConvertTo-Json -Compress|Set-Content -LiteralPath (Join-Path $run '${MARKER}') -Encoding ascii
Write-Output 'Dedicated Windows run directory ready.'`)
}

export function runnerCommand(config, runId, packageHash, snapshotHash, cancel = false) {
  const args = [...(cancel ? ['--cancel'] : []), config.remoteRoot, runId, ...(cancel ? [] : [packageHash, snapshotHash])]
  const data = Buffer.from(JSON.stringify({ file: `${config.remoteRoot}/runs/${runId}/windows-remote-runner.mjs`, args }), 'utf8').toString('base64')
  return encodedPowerShell(`$ErrorActionPreference='Stop';$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}'))|ConvertFrom-Json;$node=(Get-Command node -CommandType Application -ErrorAction Stop).Source; & $node $d.file @($d.args);exit $LASTEXITCODE`)
}

export async function verifyPreviewSnapshot(preview, snapshot) {
  const hashes = new Map(snapshot.files.map((file) => [file.path, file.sha256]))
  const seen = new Set()
  async function visit(relativePath) {
    const path = join(preview, relativePath)
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error('Preview source contained a link')
    if (info.isDirectory()) {
      for (const name of await readdir(path)) if (name !== '.DS_Store') await visit(`${relativePath}/${name}`)
    } else {
      if (sha256(await readFile(path)) !== hashes.get(relativePath)) throw new Error(`Source changed since preview build: ${relativePath}; rerun verification`)
      seen.add(relativePath)
    }
  }
  await visit('src')
  for (const file of snapshot.files) if (file.path.startsWith('src/') && !seen.has(file.path)) throw new Error(`Source added since preview build: ${file.path}`)
  await visit('runtime-host')
  for (const file of snapshot.files) if (file.path.startsWith('runtime-host/') && !seen.has(file.path)) throw new Error(`Source added since preview build: ${file.path}`)
  for (const file of ['package.json', 'tsconfig.base.json', 'tsconfig.host-build.json', 'tsconfig.client.json', 'cordis.patch.yml',
    'scripts/build.mjs', 'scripts/build-dependencies.mjs', 'scripts/host-runtime.mjs', 'scripts/host-extension-guard.mjs']) await visit(file)
}

export function verifyRemoteReport(report, testBytes, state) {
  const required = ['pnpm-version', 'install', 'typecheck', 'windows-tests', 'package-list', 'package-entries', 'package-unpack', 'mac-contract-types', 'mac-package-host-load']
  if (report.runId !== state.runId || report.platform !== 'win32' || report.success !== true || report.modelCalls !== 0 || report.guiVerified !== false || report.officialCliSmokeExecuted !== false || !report.finishedAt || !report.cleanup?.confirmed || !report.cleanup?.lockReleased) throw new Error('Remote report identity, scope, completion or cleanup mismatch')
  if (report.receivedPackageSha256 !== state.macPackageSha256 || report.macPackageSha256 !== state.macPackageSha256 || report.sourceSnapshotSha256 !== state.sourceSnapshotSha256) throw new Error('Remote transfer hash mismatch')
  for (const name of required) {
    const stages = report.stages?.filter((stage) => stage.name === name)
    if (stages?.length !== 1 || stages[0].exitCode !== 0 || stages[0].signal || stages[0].success !== true) throw new Error(`Remote stage is not confirmed: ${name}`)
  }
  if (!testBytes || sha256(testBytes) !== report.windowsTestsSha256) throw new Error('Windows test evidence hash mismatch or missing')
  const tests = JSON.parse(testBytes.toString())
  if (!tests.success || report.tests?.success !== true || tests.numFailedTests !== 0 || !tests.numPassedTests || tests.numPassedTests + tests.numPendingTests !== tests.numTotalTests) throw new Error('Windows test JSON does not confirm passed tests')
  for (const [key, source] of Object.entries({ passed: 'numPassedTests', failed: 'numFailedTests', pending: 'numPendingTests', total: 'numTotalTests' })) if (report.tests?.[key] !== tests[source]) throw new Error('Windows report and test JSON disagree')
  const paths = tests.testResults?.map((result) => result.name.replaceAll('\\', '/')) ?? []
  if (paths.length !== WINDOWS_TESTS.length || WINDOWS_TESTS.some((file) => !paths.some((path) => path.endsWith(`/${file}`)))) throw new Error('Windows evidence does not cover every Windows CI test file')
  const skipped = tests.testResults.flatMap((result) => result.assertionResults.filter((assertion) => assertion.status === 'pending' || assertion.status === 'skipped').map((assertion) => ({ file: result.name.replaceAll('\\', '/'), title: assertion.title })))
  if (skipped.length !== tests.numPendingTests || skipped.some((skip) => !skip.file.endsWith('/tests/pi-omp-identity.test.ts') || skip.title !== 'uses the POSIX official Pi launcher before an old private runtime and resolves one canonical entry')) throw new Error('Unexpected skipped Windows test; inspect its evidence')
  return true
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(`Usage: node scripts/windows-remote.mjs --config .test-data/windows-remote/config.json

Config (local private JSON; all fields required):
{"host":"WINDOWS-LAN-HOST","user":"WINDOWS-USER","identity":"/absolute/private-key","knownHosts":"/absolute/verified-known-hosts","remoteRoot":"C:/Users/WINDOWS-USER/AppData/Local/cliworker-now-remote"}

Builds an isolated Mac preview, transfers allowlisted source and that package,
runs frozen native dependencies, typecheck, the Windows CI files and Host load.
Evidence: .test-data/windows-remote/runs/<id>. No model calls or Desktop changes.
Requires pnpm and system ssh/scp on Mac, native Node >=22.19 and Windows tar.
Verify the Windows SSH fingerprint before creating knownHosts. Never paste keys into config.`)
    return
  }
  if (args.length !== 2 || args[0] !== '--config') throw new Error('Use --config .test-data/windows-remote/config.json; see --help')
  if (process.platform !== 'darwin') throw new Error('This developer entry currently requires Mac; the remote runner requires native Windows')
  const config = await readConfig(args[1])
  const runId = randomUUID()
  const local = join(privateRoot, 'runs', runId)
  await assertNoLinksWithin(privateRoot, join(privateRoot, 'runs'))
  await mkdir(join(privateRoot, 'runs'), { recursive: true, mode: 0o700 })
  const lockPath = join(privateRoot, 'run.lock')
  const lock = await open(lockPath, 'wx', 0o600)
  await lock.writeFile(JSON.stringify({ runId, pid: process.pid }))
  await lock.close()
  await mkdir(local, { mode: 0o700 })
  for (const folder of [privateRoot, join(privateRoot, 'runs'), local]) await chmod(folder, 0o700)
  await chmod(resolve(projectRoot, args[1]), 0o600)
  const state = { schema: 1, runId, startedAt: new Date().toISOString(), success: false, modelCalls: 0, guiVerified: false, stages: [], remoteCleanupConfirmed: null }
  const stateFile = join(local, 'local-report.json')
  const persist = () => writeFile(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 })
  const sshArgs = strictSshArgs(config)
  const destination = `${config.user}@${config.host}`
  const remote = `${config.remoteRoot}/runs/${runId}`
  let currentChild = null
  let interrupted = false
  let remoteStarted = false
  let remoteReady = false
  let interruptedGroup = null
  const interrupt = () => { interrupted = true; if (currentChild) { interruptedGroup = currentChild.pid; try { process.kill(-currentChild.pid, 'SIGTERM') } catch { currentChild.kill('SIGTERM') } } }
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt)
  async function run(name, file, argv, { cwd = projectRoot, allowInterrupted = false, capture = false } = {}) {
    if (interrupted && !allowInterrupted) throw new Error('Local run interrupted')
    const item = { name, startedAt: new Date().toISOString(), exitCode: null, success: false }
    state.stages.push(item); await persist()
    console.log(`Starting ${name}`)
    const log = createWriteStream(join(local, `${name}.log`), { mode: 0o600 })
    const child = spawn(file, argv, { cwd, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    currentChild = child
    let output = ''
    child.stdout.on('data', (bytes) => { log.write(bytes); if (capture) output += bytes.toString(); if (name === 'windows-run') process.stdout.write(bytes) })
    child.stderr.on('data', (bytes) => log.write(bytes))
    const result = await new Promise((r) => { child.once('error', (error) => r({ code: -1, error: String(error) })); child.once('close', (code, signal) => r({ code, signal })) })
    currentChild = null
    await new Promise((r) => log.end(r))
    Object.assign(item, { exitCode: result.code, signal: result.signal ?? null, success: result.code === 0 && !result.signal, finishedAt: new Date().toISOString() })
    if (result.error) item.error = result.error
    await persist()
    if (!item.success) throw new Error(`${name} failed (${result.code}); inspect ${join(local, `${name}.log`)}`)
    return output
  }
  try {
    await run('mac-preview-build', 'pnpm', ['--config.verifyDepsBeforeRun=false', 'build:preview'])
    const packagePath = join(local, 'plugin.tgz')
    await run('mac-preview-pack', 'pnpm', ['--config.verifyDepsBeforeRun=false', 'pack', '--out', packagePath], { cwd: join(projectRoot, '.cache', 'preview-package') })
    const listing = await run('mac-package-list', 'tar', ['-tzf', packagePath], { capture: true })
    const verbose = await run('mac-package-entries', 'tar', ['-tvzf', packagePath], { capture: true })
    const snapshot = validateSnapshot(await createSnapshot(projectRoot))
    validateArchiveEntries(listing, verbose, runtimeManifestFromSnapshot(snapshot))
    await verifyPreviewSnapshot(join(projectRoot, '.cache', 'preview-package'), snapshot)
    state.sourceSnapshotVsPreviewVerified = true
    const snapshotBytes = Buffer.from(JSON.stringify(snapshot))
    await writeFile(join(local, 'snapshot.json'), snapshotBytes, { mode: 0o600 })
    const packageHash = sha256(await readFile(packagePath))
    const snapshotHash = sha256(snapshotBytes)
    Object.assign(state, { macPackageSha256: packageHash, sourceSnapshotSha256: snapshotHash, sourceFiles: snapshot.files.length })
    await run('prepare-remote-run', 'ssh', [...sshArgs, destination, ...bootstrapCommand(config, runId)])
    remoteReady = true
    for (const name of ['windows-remote-runner.mjs', 'windows-remote-common.mjs']) await cp(join(scriptDirectory, name), join(local, name))
    await run('upload', 'scp', [...sshArgs, join(local, 'snapshot.json'), packagePath,
      join(local, 'windows-remote-runner.mjs'), join(local, 'windows-remote-common.mjs'), `${destination}:${remote}/`])
    remoteStarted = true
    await run('windows-run', 'ssh', [...sshArgs, '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', destination, ...runnerCommand(config, runId, packageHash, snapshotHash)])
  } catch (error) {
    state.error = String(error)
    process.exitCode = 1
    if (remoteStarted) {
      try { await run('request-remote-cancel', 'ssh', [...sshArgs, destination, ...runnerCommand(config, runId, '', '', true)], { allowInterrupted: true }) }
      catch (cancelError) { state.cancelError = String(cancelError) }
    }
  } finally {
    // Retain evidence, including partial remote output, even when any stage failed.
    if (remoteReady) {
      try {
        await mkdir(join(local, 'remote'), { mode: 0o700 })
        await run('download-report', 'scp', [...sshArgs, `${destination}:${remote}/report.json`, join(local, 'remote', 'report.json')], { allowInterrupted: true })
        const report = JSON.parse(await readFile(join(local, 'remote', 'report.json'), 'utf8'))
        await run('download-logs', 'scp', [...sshArgs, '-r', `${destination}:${remote}/logs`, join(local, 'remote', 'logs')], { allowInterrupted: true })
        if (report.stages?.some((stage) => stage.name === 'windows-tests')) {
          try { await run('download-tests', 'scp', [...sshArgs, `${destination}:${remote}/windows-tests.json`, join(local, 'remote', 'windows-tests.json')], { allowInterrupted: true }) }
          catch (error) { state.testDownloadError = String(error) }
        }
        state.remoteCleanupConfirmed = report.cleanup?.confirmed === true && report.cleanup?.lockReleased === true
        state.success = !state.error && !interrupted && !state.testDownloadError && verifyRemoteReport(report, await readFile(join(local, 'remote', 'windows-tests.json')), state)
        if (report.error) state.remoteError = report.error
        if (!state.success) process.exitCode = 1
      } catch (error) { state.downloadError = String(error); process.exitCode = 1 }
    }
    async function protect(path) {
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw new Error('Downloaded evidence contained a symlink')
      await chmod(path, info.isDirectory() ? 0o700 : 0o600)
      if (info.isDirectory()) for (const name of await readdir(path)) await protect(join(path, name))
    }
    try { await protect(local) } catch (error) { state.privacyError = String(error); state.success = false; process.exitCode = 1 }
    state.interrupted = interrupted
    state.finishedAt = new Date().toISOString()
    let groupStopped = true
    if (interruptedGroup) {
      try { process.kill(-interruptedGroup, 0); groupStopped = false } catch (error) { groupStopped = error.code === 'ESRCH' }
    }
    state.localCleanupConfirmed = groupStopped
    if (groupStopped) {
      try {
        const own = JSON.parse(await readFile(lockPath, 'utf8'))
        if (own.runId !== runId || own.pid !== process.pid) throw new Error('Local lock ownership changed')
        await rm(lockPath)
      } catch (error) { state.localCleanupConfirmed = false; state.localCleanupError = String(error) }
    }
    if (!state.localCleanupConfirmed) { state.success = false; process.exitCode = 1 }
    await persist()
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt)
    console.log(`Evidence: ${local}\nOverall result: ${state.success ? 'passed' : 'failed'}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.stack ?? String(error)); process.exitCode = 1 })
}
