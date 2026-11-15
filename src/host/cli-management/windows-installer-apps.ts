import { stat } from 'node:fs/promises'
import { win32 } from 'node:path'
import type { ProcessBackend, RuntimeConfig } from '../process.ts'
import { ProcessCleanupUnconfirmedError, VISIBLE_WINDOW } from '../process.ts'
import { captureReadOnly } from './versions.ts'

/** Main executable of each Windows desktop app (verified in identity.ts / the NSIS audit). */
export const WINDOWS_APP_IMAGES = { zcode: 'ZCode.exe', workbuddycn: 'WorkBuddy.exe', workbuddy: 'WorkBuddyAI.exe' } as const
export type RunningApp = { pid: number; created: string; path: string }
/** Grace wait that never keeps the Host alive on its own. */
export const graceDelay = (ms: number) => new Promise<void>(resolve => { const timer = setTimeout(resolve, ms); (timer as { unref?: () => void }).unref?.() })

/** Read-only snapshot of one app image's processes (pid + creation time guards PID reuse). */
export async function listRunningApps(backend: ProcessBackend, config: RuntimeConfig, image: string, signal: AbortSignal): Promise<RunningApp[]> {
  if (!/^[A-Za-z0-9 ._-]+\.exe$/.test(image)) throw new Error('Invalid image name')
  const output = await captureReadOnly(backend, config, ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
    '$ErrorActionPreference = "Stop"; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); ' +
    '@(Get-CimInstance Win32_Process -Filter ("Name=\'" + $env:CLIWORKER_APP_IMAGE + "\'") | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; created = [string]$_.CreationDate.ToFileTimeUtc(); path = [string]$_.ExecutablePath } }) | ConvertTo-Json -Compress'],
  signal, false, { CLIWORKER_APP_IMAGE: image }, 15_000)
  const text = output.trim()
  if (!text) return []
  const parsed: unknown = JSON.parse(text)
  return (Array.isArray(parsed) ? parsed : [parsed]).flatMap(value => {
    const item = value as Partial<RunningApp>
    return Number.isInteger(item.pid) && typeof item.created === 'string' && typeof item.path === 'string' && item.path ? [{ pid: item.pid!, created: item.created, path: item.path }] : []
  })
}

/** Processes present before the installer range was ended and gone afterwards: the app the
 * finish page started inside the Host's kill-on-close Job. Apps started elsewhere survive. */
export function stoppedApps(before: RunningApp[], after: RunningApp[]): RunningApp[] {
  return before.filter(app => !after.some(other => other.pid === app.pid && other.created === app.created))
}

/** Pick the stopped app's executable only when it is the verified installation's main image. */
export async function reopenablePath(stopped: RunningApp[], appRoot: string | undefined, image: string): Promise<string | undefined> {
  if (!appRoot) return undefined
  const root = win32.normalize(appRoot).replace(/\\+$/, '').toLowerCase() + '\\'
  for (const app of stopped) {
    const path = win32.normalize(app.path)
    if (!path.toLowerCase().startsWith(root) || win32.basename(path).toLowerCase() !== image.toLowerCase()) continue
    try { if ((await stat(app.path)).isFile()) return app.path } catch { /* replaced or removed */ }
  }
  return undefined
}

/** The running shell starts the app, so it is neither in the Host's Job nor elevated.
 * explorer.exe exits with 1 after handing over; only the range exit is checked. Shown, not
 * hidden: a hidden explorer.exe could pass SW_HIDE on to the app it hands over. */
export async function reopenOutsideJob(backend: ProcessBackend, config: RuntimeConfig, path: string, signal: AbortSignal): Promise<void> {
  const child = backend.spawn({ argv: ['explorer.exe', path], cwd: win32.dirname(path), signal, graceMs: config.graceMs, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }, ...{ [VISIBLE_WINDOW]: true as const } })
  void child.done.catch(() => undefined); child.stdout?.resume(); child.stderr?.resume()
  let exited = false, launch: unknown
  try {
    // Exit code 1 is Explorer's normal hand-off; a spawn failure is not.
    await Promise.race([child.done.then(() => undefined, error => { launch = error ?? new Error('explorer.exe 启动失败') }), graceDelay(15_000)])
    exited = await child.waitForExit(AbortSignal.timeout(5000))
    if (!exited) { child.terminate(); exited = await child.waitForExit() }
  } catch (cause) { throw new ProcessCleanupUnconfirmedError({ cause }) }
  if (!exited) throw new ProcessCleanupUnconfirmedError()
  if (launch) throw launch
}

/** After a verified Windows desktop install/update: reopen the app the finish page had started
 * if ending the installer's range took it down. The operation itself already succeeded. */
export async function reopenStoppedApp(o: { backend: ProcessBackend; config: RuntimeConfig; image: string; stopped: RunningApp[]; appRoot: string | undefined; signal: AbortSignal; note(text: string): void }): Promise<void> {
  if (!o.stopped.length) return
  const path = await reopenablePath(o.stopped, o.appRoot, o.image)
  if (path) {
    try {
      await reopenOutsideJob(o.backend, o.config, path, o.signal)
      o.note('\n安装程序结束页打开的应用随安装进程一起被结束，已重新打开。\n'); return
    } catch (error) { if (error instanceof ProcessCleanupUnconfirmedError) throw error }
  }
  o.note('\n安装程序结束页打开的应用随安装进程一起被结束，未能自动重新打开，请手动打开。\n')
}
