import { trackUpdateTemporary, retainUpdateTemporary, removeUpdateTemporary } from './update-cleanup.ts'
import { physicalFs } from './physical-fs.ts'
import { join, basename } from 'node:path'
import type { InstallSource } from './sources.ts'
import { CliOperationError } from './planner.ts'
import { ProcessCleanupUnconfirmedError } from '../process.ts'
// App bundles contain app.asar; Electron's patched fs would treat it as a directory.
const { chmod, mkdir, mkdtemp, lstat, rename } = physicalFs().promises
export const desktopFs = { rm: (path: string, _options?: unknown) => removeUpdateTemporary(path) }

/** Signature identities are Host-owned, never taken from the feed. */
export function desktopSignatureRequirement(source: { teamId: string; bundleId?: string }): string {
  if (!/^[A-Z0-9]{10}$/.test(source.teamId) || source.bundleId !== undefined && !/^[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)+$/.test(source.bundleId)) {
    throw new CliOperationError('PREREQUISITE_MISSING', '桌面应用身份尚未核实')
  }
  return `-R=anchor apple generic and certificate leaf[subject.OU] = "${source.teamId}"${source.bundleId ? ` and identifier "${source.bundleId}"` : ''}`
}

/** Only Host-verified official feeds and pinned publisher identities enter here. */
export async function installDesktop(options: {
  source: NonNullable<InstallSource['desktop']>; root: string; file: string; directory: string; platform: string; signal: AbortSignal
  run(argv: string[], signal: AbortSignal): Promise<void>; awaiting(): void
}): Promise<string> {
  const { source, run, signal } = options
  const requirement = desktopSignatureRequirement(source)
  if (!/^[A-Z0-9]{10}$/.test(source.teamId) || basename(source.appName) !== source.appName || !source.appName.endsWith('.app')) throw new CliOperationError('PREREQUISITE_MISSING', '桌面应用身份尚未核实')
  if (options.platform === 'win32') {
    options.awaiting()
    await run([options.file], signal) // No unverified silent/directory arguments.
    return options.directory
  }
  if (options.platform !== 'darwin') throw new CliOperationError('PREREQUISITE_MISSING', '此平台不支持桌面安装')
  const parent = join(options.root, 'cli-management', 'mounts')
  await mkdir(parent, { recursive: true, mode: 0o700 }); await chmod(parent, 0o700)
  if ((await lstat(parent)).isSymbolicLink()) throw new CliOperationError('LOCATION_INVALID', '挂载缓存不是实际目录')
  const mount = await mkdtemp(join(parent, 'image-'))
  let attached = false, confirmed = false
  let stage: string | undefined
  let operationError: unknown
  try {
    if (source.archive === 'zip') {
      await run(['/usr/bin/ditto', '-x', '-k', options.file, mount], signal)
    } else {
      // Mark before attach: a failed command may still have mounted the image.
      attached = true
      await run(['/usr/bin/hdiutil', 'attach', '-readonly', '-nobrowse', '-mountpoint', mount, options.file], signal)
    }
    const app = join(mount, source.appName)
    const info = await lstat(app)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new CliOperationError('IDENTITY_CHANGED', '安装镜像没有预期的应用目录')
    await run(['/usr/bin/codesign', '--verify', '--deep', '--strict', requirement, app], signal)
    await run(['/usr/sbin/spctl', '--assess', '--type', 'execute', app], signal)
    await mkdir(options.directory, { recursive: true, mode: 0o700 })
    stage = trackUpdateTemporary(await mkdtemp(join(options.directory, '.cliworker-install-')))
    await run(['/usr/bin/ditto', app, join(stage, source.appName)], signal)
    signal.throwIfAborted()
    const target = join(options.directory, source.appName)
    try { await lstat(target); throw new CliOperationError('LOCATION_INVALID', '目标应用已存在，不会覆盖') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    await rename(join(stage, source.appName), target)
    return join(options.directory, source.appName)
  } catch (error) { operationError = error; throw error }
  finally {
    let isolation = operationError instanceof ProcessCleanupUnconfirmedError ? operationError : undefined
    const cleanupErrors: unknown[] = []
    if (source.archive === 'zip') confirmed = !(operationError instanceof ProcessCleanupUnconfirmedError)
    if (attached) {
      try { await run(['/usr/bin/hdiutil', 'detach', mount], AbortSignal.timeout(30_000)); confirmed = true }
      catch (cause) { isolation = cause instanceof ProcessCleanupUnconfirmedError ? cause : new ProcessCleanupUnconfirmedError({ cause }) }
    }
    if (stage && isolation) retainUpdateTemporary(stage)
    if (stage && !isolation) await desktopFs.rm(stage, { recursive: true, force: true }).catch(error => cleanupErrors.push(error))
    // Never remove a mountpoint unless detach has been confirmed.
    if (confirmed) trackUpdateTemporary(mount)
    if (confirmed) await desktopFs.rm(mount, { recursive: true, force: true }).catch(error => cleanupErrors.push(error))
    if (isolation) {
      if (cleanupErrors.length) isolation.cause = new AggregateError([isolation.cause, ...cleanupErrors], '卸载与临时目录清理未完成')
      throw isolation
    }
    // Disk cleanup is best effort; detach/rollback errors above retain their safety semantics.
  }
}
