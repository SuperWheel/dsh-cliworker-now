/** 模拟：目录权限/空间/内容和平台选择器，不启动 osascript / PowerShell。 */
import { expect, it, vi } from 'vitest'
import { checkInstallDirectory, directoryPickerArgv, chooseInstallDirectory } from '../src/host/cli-management/directory.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
import { Readable } from 'node:stream'
const signal = () => new AbortController().signal
const fs = () => ({ access: vi.fn(async () => {}), lstat: vi.fn(async () => ({ isDirectory: () => true, isSymbolicLink: () => false })), realpath: vi.fn(async path => path), readdir: vi.fn(async () => []), statfs: vi.fn(async () => ({ bavail: 1024 ** 3, bsize: 4 })) })
it.each(['ADMIN_REQUIRED', 'NO_SPACE', 'NOT_EMPTY', 'INVALID'] as const)('模拟：目录检查 %s', async problem => {
  const mock = fs()
  if (problem === 'ADMIN_REQUIRED') mock.access.mockRejectedValue(Object.assign(new Error('模拟 denied'), { code: 'EACCES' }))
  if (problem === 'NO_SPACE') mock.statfs.mockResolvedValue({ bavail: 1, bsize: 1 })
  if (problem === 'NOT_EMPTY') mock.readdir.mockResolvedValue(['existing'] as any)
  const result = await checkInstallDirectory('zcode', problem === 'INVALID' ? '../invalid' : '/模拟/install', signal(), mock as any)
  expect(result.problem).toBe(problem)
})
it('模拟：仅三个桌面 CLI、绝对路径、空目录可用；取消为空路径', async () => {
  for (const cli of ['zcode', 'workbuddycn', 'workbuddy'] as const) {
    expect(await checkInstallDirectory(cli, '', signal(), fs() as any)).toEqual({ path: '' })
    expect((await checkInstallDirectory(cli, '/模拟/install', signal(), fs() as any)).problem).toBeUndefined()
  }
  await expect(checkInstallDirectory('codex', '/模拟/install', signal(), fs() as any)).rejects.toThrow('仅')
  const backend = { resolveExecutable: vi.fn(), spawn: vi.fn(() => ({ stdout: Readable.from(['']), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0 }), waitForExit: vi.fn(async () => true), terminate: vi.fn() }) as any) }
  expect(await chooseInstallDirectory('zcode', backend, DEFAULT_CONFIG, signal())).toEqual({ path: '' })
  expect(backend.spawn.mock.calls[0]![0].argv).toEqual(directoryPickerArgv())
})
it('模拟：macOS / Windows 固定选择器参数，不嵌入用户路径或 shell 拼接', () => {
  expect(directoryPickerArgv('darwin').slice(0, 2)).toEqual(['/usr/bin/osascript', '-e'])
  expect(directoryPickerArgv('darwin')[2]).toContain('on error number -128')
  expect(directoryPickerArgv('win32').slice(0, 5)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-STA', '-Command'])
  expect(directoryPickerArgv('win32')[5]).toContain('FolderBrowserDialog')
})
