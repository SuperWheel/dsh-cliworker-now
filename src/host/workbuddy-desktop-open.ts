import { spawn } from 'node:child_process'
import { ProcessCleanupUnconfirmedError } from './process.ts'
import { resolveWorkBuddyInstallation, WorkBuddyUnavailableError, type WorkBuddyInstallationOptions } from './workbuddy-installation.ts'
import type { WorkBuddyCliId } from './workbuddy-variant.ts'

/** Read installation metadata only. Also used by the no-launch installation check. */
export async function workbuddyDesktopCommand(cli: WorkBuddyCliId, options: WorkBuddyInstallationOptions = {}) {
  const platform = options.platform ?? process.platform
  const install = await resolveWorkBuddyInstallation(cli, options)
  // Resolve Windows from the app root again: a manually selected arbitrary .exe
  // must not become the GUI entry just because it lives beside a valid CLI.
  const desktop = platform === 'win32'
    ? await resolveWorkBuddyInstallation(cli, { ...options, path: undefined, manualPath: install.appRoot })
    : install
  if (platform === 'win32' && !/^WorkBuddy(?: AI)?\.exe$/i.test(desktop.runtime.split(/[\\/]/).pop()!))
    throw new WorkBuddyUnavailableError('desktop-entry-unverified')
  return { file: platform === 'darwin' ? '/usr/bin/open' : desktop.runtime,
    args: platform === 'darwin' ? [install.appRoot] : [], platform }
}

/** The GUI is independent of query process ranges. Never terminate it on guide close. */
export async function openWorkBuddyDesktop(cli: WorkBuddyCliId, path: string, signal: AbortSignal, platform: NodeJS.Platform = process.platform): Promise<void> {
  const command = await workbuddyDesktopCommand(cli, { manualPath: path, platform })
  signal.throwIfAborted()
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.file, command.args, { shell: false, detached: true, stdio: 'ignore', env })
    let settled = false, aborting = false
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined
    const done = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(cleanupTimer)
      signal.removeEventListener('abort', abort)
      child.unref()
      if (error instanceof ProcessCleanupUnconfirmedError) reject(error)
      else if (error) reject(new Error('无法打开桌面端，请手动打开对应版本后刷新，或重试。'))
      else resolve()
    }
    // Only the short-lived macOS opener is owned here, never the application.
    const abort = () => {
      if (settled || aborting) return
      aborting = true
      if (command.platform !== 'darwin') { done(new Error('cancelled')); return }
      child.kill()
      // Wait for the opener's exit; never signal the GUI it asked LaunchServices to open.
      cleanupTimer = setTimeout(() => done(new ProcessCleanupUnconfirmedError()), 5_000)
    }
    const timer = setTimeout(abort, 5_000)
    child.once('error', done)
    if (command.platform === 'win32') child.once('spawn', () => done())
    else child.once('exit', code => done(code === 0 && !aborting ? undefined : new Error('open failed')))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}
