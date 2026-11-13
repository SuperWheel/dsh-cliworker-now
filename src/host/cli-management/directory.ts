import { constants } from 'node:fs'
import { access, lstat, readdir, realpath, statfs } from 'node:fs/promises'
import { isAbsolute, parse } from 'node:path'
import type { ActiveCliId } from '../../shared/types.ts'
import type { CliInstallDirectoryCheck } from '../../shared/cli-management.ts'
import type { ProcessBackend, RuntimeConfig } from '../process.ts'
import { captureReadOnly } from './versions.ts'

export const DIRECTORY_CLIS: readonly ActiveCliId[] = ['zcode', 'workbuddycn', 'workbuddy']
export const INSTALL_REQUIRED_BYTES = 2 * 1024 ** 3
export const directoryFs = { access, lstat, readdir, realpath, statfs }
export function assertDirectoryCli(cli: ActiveCliId) { if (!DIRECTORY_CLIS.includes(cli)) throw new Error('仅 ZCode、WorkBuddy CN、WorkBuddy 支持选择安装目录') }
export async function checkInstallDirectory(cli: ActiveCliId, path: string, signal: AbortSignal, fs = directoryFs): Promise<CliInstallDirectoryCheck> {
  assertDirectoryCli(cli); signal.throwIfAborted()
  if (!path) return { path: '' }
  const result: CliInstallDirectoryCheck = { path, requiredBytes: INSTALL_REQUIRED_BYTES }
  if (path.length > 4096 || /[\x00-\x1f]/.test(path) || !isAbsolute(path) || path === parse(path).root) return { ...result, problem: 'INVALID', message: '请选择有效的绝对目录路径，不能使用磁盘根目录' }
  try {
    const info = await fs.lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) return { ...result, problem: 'INVALID', message: '请选择实际目录，不能使用文件或符号链接' }
    result.path = await fs.realpath(path)
    await fs.access(path, constants.W_OK | constants.R_OK | constants.X_OK)
    signal.throwIfAborted()
    const space = await fs.statfs(path)
    result.freeBytes = Number(space.bavail) * Number(space.bsize)
    if (result.freeBytes < INSTALL_REQUIRED_BYTES) return { ...result, problem: 'NO_SPACE', message: '可用空间不足，需要至少 2 GB' }
    if ((await fs.readdir(path)).length) return { ...result, problem: 'NOT_EMPTY', message: '目录不是空的，请选择空目录' }
    signal.throwIfAborted(); return result
  } catch (error) {
    signal.throwIfAborted()
    return { ...result, problem: ['EACCES', 'EPERM', 'EROFS'].includes((error as NodeJS.ErrnoException).code ?? '') ? 'ADMIN_REQUIRED' : 'INVALID', message: ['EACCES', 'EPERM', 'EROFS'].includes((error as NodeJS.ErrnoException).code ?? '') ? '此目录需要管理员权限，请选择可写目录' : '目录不可用，请选择已存在的目录' }
  }
}
export function directoryPickerArgv(platform = process.platform): string[] {
  if (platform === 'darwin') return ['/usr/bin/osascript', '-e', 'try\nreturn POSIX path of (choose folder with prompt "选择 CLI 安装目录")\non error number -128\nreturn ""\nend try']
  if (platform === 'win32') return ['powershell.exe', '-NoProfile', '-NonInteractive', '-STA', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; try { if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($picker.SelectedPath) } } finally { $picker.Dispose() }']
  throw new Error('此平台尚未提供目录选择器，请填写完整目录路径')
}
export async function chooseInstallDirectory(cli: ActiveCliId, backend: ProcessBackend, config: RuntimeConfig, signal: AbortSignal): Promise<CliInstallDirectoryCheck> {
  assertDirectoryCli(cli)
  const path = (await captureReadOnly(backend, config, directoryPickerArgv(), signal, false, undefined, 60_000)).trim()
  return checkInstallDirectory(cli, path, signal)
}
