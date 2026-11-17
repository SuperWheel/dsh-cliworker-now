import { rename } from 'node:fs/promises'
import { dirname, join, win32 } from 'node:path'
import type { InstallPlan } from './install.ts'
import type { CliUpdateOperation } from '../../shared/cli-management.ts'
import type { ProcessBackend, RuntimeConfig } from '../process.ts'
import { ProcessCleanupUnconfirmedError } from '../process.ts'
import { identifyInstallation } from './identity.ts'
import { currentVersion, compatible, compareVersions, desktopVersion, validVersion, type ReleaseClient } from './versions.ts'
import { CliOperationError, operationArgv, sameInstallation, samePath, foldPath, boundOfficialEnv } from './planner.ts'
import { downloadCliArtifact } from './download.ts'
import { NATIVE_UPDATES, isDesktopCli } from './sources.ts'
import { runDesktopUpdate } from './desktop-update.ts'
import { DESKTOP_INSTALLER_TIMEOUT_MS, executeCliOperation, outputTail } from './executor.ts'
import { trackUpdateTemporary, removeUpdateTemporary } from './update-cleanup.ts'
import { checkPiInstallationIntegrity } from '../pi-installation.mjs'
import { nativeLaunchArgv } from '../native-launch.mjs'
import { canPrepareLocalUpdate, prepareLocalUpdate, type LocalArtifactInstall } from './local-artifacts.ts'
import { preparePiRepairGuard, PI_REPAIR_SCRIPTS } from './pi-repair.ts'
import { codexInstallerEnv } from './artifacts/codex.ts'

/** Repairs are admitted by the existing owner. No default install or path switching here. */
export async function executeOwnerRepair(deps: {
  root: string; backend: ProcessBackend; config: RuntimeConfig; releases: ReleaseClient; platform: NodeJS.Platform
  fetcher?: Parameters<typeof downloadCliArtifact>[0]['fetcher']; identify?: typeof identifyInstallation; version?: typeof currentVersion
}, plan: InstallPlan, op: CliUpdateOperation, signal: AbortSignal, changed: () => void, recheck: () => Promise<void>) {
  const repair = plan.repair!, before = repair.identity, files: string[] = []
  let local: LocalArtifactInstall | undefined, quarantined = false
  let piGuard: Awaited<ReturnType<typeof preparePiRepairGuard>> | undefined, piVersion: string | undefined, piAttempted = false, piChecked = false
  const output = (value: string) => { op.outputTail = outputTail(op.outputTail + value); changed() }
  const download = async (url: string, script = false, integrity?: string) => {
    const file = await downloadCliArtifact({ root: deps.root, url, integrity, officialScript: script, signal, fetcher: deps.fetcher, output, progress: value => { op.progress = value; changed() } })
    const target = file.replace(/\.part$/, deps.platform === 'win32' ? '.ps1' : '.sh')
    await rename(file, target); files.push(trackUpdateTemporary(target)); return target
  }
  const run = async (argv: string[], control = signal, env?: Record<string, string>) => {
    op.command = nativeLaunchArgv(argv); op.phase = repair.method === 'desktop' && deps.platform === 'win32' ? 'awaiting-user' : 'installing'; changed()
    if (piGuard) piAttempted = true
    await executeCliOperation(deps.backend, deps.config, op.command, control, output,
      repair.method === 'desktop' && deps.platform === 'win32' ? DESKTOP_INSTALLER_TIMEOUT_MS : undefined,
      env ?? { ...local?.env, ...piGuard?.env, ...NATIVE_UPDATES[plan.cli]?.env, ...(plan.cli === 'codex' && repair.method === 'official-script' ? { ...codexInstallerEnv(), ...boundOfficialEnv(plan.cli, before) } : {}) }, undefined, undefined, undefined,
      repair.method === 'desktop' && deps.platform === 'win32' ? {} : undefined)
  }
  try {
    await recheck(); signal.throwIfAborted()
    if (plan.cli === 'pi' && before.source === 'self-update') piGuard = await preparePiRepairGuard(before, deps.backend, deps.config, signal, deps.platform)
    if (plan.cli === 'pi' && before.repairNeeded) {
      // The official installer discovers PATH and may migrate an npm copy. Do not
      // invoke that flow if PATH selects anything outside this managed root.
      const path = deps.platform === 'win32' ? win32 : { join, dirname }
      let discovered: string | undefined
      try { discovered = await deps.backend.resolveExecutable(deps.platform === 'win32' ? 'pi.cmd' : 'pi') }
      catch (error) { if (!['ENOENT', 'ENOTDIR', 'SUBPROCESS_EXECUTABLE_NOT_FOUND'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error }
      const root = before.updateRoot!, launcher = path.join(root, 'bin', deps.platform === 'win32' ? 'pi.cmd' : 'pi')
      if (discovered && !samePath(discovered, launcher) && !foldPath(discovered).startsWith(foldPath(root).replace(/\/$/, '') + '/')) throw new CliOperationError('PREREQUISITE_MISSING', `托管安装需要修复：${root}；PATH 另有 ${discovered}，官方安装器可能迁移该副本，插件不会另装一份；请用 Pi 官方安装器修复原根`)
      const audited = PI_REPAIR_SCRIPTS[deps.platform === 'win32' ? 'win32' : 'unix']
      const script = await download(audited.url, true, `sha256-${Buffer.from(audited.sha256, 'hex').toString('base64')}`)
      await recheck()
      // Recheck PATH after downloading too: the official script discovers it again.
      let current: string | undefined
      try { current = await deps.backend.resolveExecutable(deps.platform === 'win32' ? 'pi.cmd' : 'pi') }
      catch (error) { if (!['ENOENT', 'ENOTDIR', 'SUBPROCESS_EXECUTABLE_NOT_FOUND'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error }
      if (!samePath(current, discovered)) throw new CliOperationError('PLAN_EXPIRED', 'Pi 修复前 PATH 已变化，未执行安装')
      await run(deps.platform === 'win32' ? ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script] : ['/bin/sh', script], signal,
        piGuard!.env)
    } else if (repair.method === 'desktop' && isDesktopCli(plan.cli)) {
      if (!before.appPath || !repair.desktopRelease) throw new CliOperationError('PREREQUISITE_MISSING', '原桌面应用根或发布源无法核实')
      await runDesktopUpdate({ cli: plan.cli, appPath: before.appPath, release: repair.desktopRelease, root: deps.root, signal, platform: deps.platform, fetcher: deps.fetcher,
        run, awaiting: () => { op.phase = 'awaiting-user'; changed() }, download: async (url, expected, control) => {
          const file = await downloadCliArtifact({ root: deps.root, url, integrity: expected.sha512 ? `sha512-${expected.sha512}` : expected.sha256 ? `sha256-${Buffer.from(expected.sha256, 'hex').toString('base64')}` : undefined,
            cos: expected.cos, expectedBytes: expected.size, signal: control, fetcher: deps.fetcher, output, progress: value => { op.progress = value; changed() } })
          files.push(file); return file
        } })
    } else {
      const artifact = repair.method === 'official-script' ? await download(NATIVE_UPDATES[plan.cli]!.script!.url, true) : undefined
      const argv = await operationArgv(repair, deps.backend, artifact, deps.platform)
      if (repair.method === 'brew') argv[1] = 'reinstall'
      await recheck()
      try { await run(argv) }
      catch (error) {
        if (!(error instanceof CliOperationError) || error.code !== 'EXIT_CODE' || !canPrepareLocalUpdate(plan.cli, before, deps.platform) || !validVersion(repair.beforeVersion) || compareVersions(repair.targetVersion, repair.beforeVersion) <= 0) throw error
        local = await prepareLocalUpdate({ ...deps, cli: plan.cli, identity: before, version: repair.targetVersion, beforeVersion: repair.beforeVersion, signal, output,
          progress: value => { op.progress = value; changed() } })
        await recheck()
        if (local.install) await local.install(signal, run); else await run(local.argv)
      }
    }
    if (piGuard) { piChecked = true; piVersion = await piGuard.verify(repair.targetVersion, 'repair') }
    op.phase = 'verifying-installation'; changed()
    const after = await (deps.identify ?? identifyInstallation)(plan.cli, deps.backend, deps.config, signal)
    if (!after || !sameInstallation(before, after, plan.cli) || after.repairNeeded) throw new CliOperationError('IDENTITY_CHANGED', `原安装 ${before.executable} 修复后身份不符；未修改路径记录`)
    if (plan.cli === 'pi') await checkPiInstallationIntegrity(after.executable, { allowUnsupported: true, fresh: true, signal })
    const version = await (deps.version ?? currentVersion)(plan.cli, after, deps.backend, deps.config, signal)
    if (piVersion && version !== piVersion) throw new CliOperationError('VERSION_MISMATCH', 'Pi 运行版本与原托管根 current-version 不符；路径记录未修改')
    if (!validVersion(version) || !compatible(plan.cli, version) || validVersion(before.manifestVersion) && compareVersions(version, before.manifestVersion!) < 0) throw new CliOperationError('VERSION_MISMATCH', '原安装修复后版本不可核实或发生降级')
    if (repair.method === 'desktop' && (!after.fingerprint.appVersion || (plan.cli === 'workbuddy' && after.fingerprint.appVersion.split('.').length === 3 ? after.fingerprint.appVersion !== desktopVersion(plan.cli, repair.targetVersion) : after.fingerprint.appVersion !== repair.targetVersion))) throw new CliOperationError('VERSION_MISMATCH', '原应用未达到修复目标版本')
    signal.throwIfAborted()
    if (deps.config.cliExecutablePaths!.revision(plan.cli) !== plan.pathRevision) throw new CliOperationError('PLAN_EXPIRED', '修复期间路径设置已变化，未覆盖新设置')
    // Keep manual/auto selection and revision when the original entry still works.
    op.afterVersion = version
    return { identity: after, version }
  } catch (error) {
    // A verification probe can itself leave a live process; quarantine that error too.
    if (piGuard && piAttempted && !piChecked && !(error instanceof ProcessCleanupUnconfirmedError) && !signal.aborted) {
      try { await piGuard.verify(undefined, 'repair') } catch (verification) { error = verification }
    }
    quarantined = error instanceof ProcessCleanupUnconfirmedError
    throw error
  }
  finally { if (!quarantined) { if (local) await local.cleanup(); for (const file of files) await removeUpdateTemporary(file) } }
}
