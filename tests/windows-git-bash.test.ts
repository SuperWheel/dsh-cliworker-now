/** 模拟：静态 Git for Windows 文件布局；不启动 git/bash 或读取真实安装。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { findGitBash } from '../src/host/windows-git-bash.ts'
import { ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'git-bash-模拟-'))); roots.push(root)
  const pe = Buffer.alloc(68); pe.write('MZ'); pe.writeUInt32LE(64, 60); pe.write('PE\0\0', 64)
  const write = (name: string, data = pe) => { const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); return path }
  const backend = { resolveExecutable: vi.fn(async () => { throw new Error('模拟不存在') }), spawn: vi.fn() }
  return { root, write, backend }
}
it.each(['path-bash', 'path-git', 'resolved-git', 'known-location'] as const)('模拟审查 3：%s 发现 Git Bash；不依赖 Git 祖先名或 PATH 首个 bash', async kind => {
  const f = fixture(), folder = kind === 'known-location' ? 'Programs/Git' : '自定义便携工具'
  const bash = f.write(`${folder}/usr/bin/bash.exe`)
  const git = f.write(`${folder}/cmd/git.exe`); f.write(`${folder}/usr/bin/msys-2.0.dll`)
  f.write('Windows/System32/bash.exe')
  const env = { PATH: join(f.root, 'Windows/System32') }
  if (kind === 'path-bash') env.PATH += ';' + dirname(bash)
  if (kind === 'path-git') env.PATH += ';' + dirname(git)
  if (kind === 'resolved-git') f.backend.resolveExecutable.mockResolvedValue(git as never)
  expect(await findGitBash(f.backend, new AbortController().signal, { ...env, ...(kind === 'known-location' ? { LOCALAPPDATA: f.root } : {}) })).toBe(bash)
  expect(f.backend.spawn).not.toHaveBeenCalled()
})
it('模拟审查 3：WSL 和缺失 MSYS/伪装脚本均拒绝；取消与隔离继续传播', async () => {
  const f = fixture(), bash = f.write('Windows/System32/bash.exe')
  expect(await findGitBash(f.backend, new AbortController().signal, { PATH: dirname(bash) })).toBeUndefined()
  const git = f.write('Tools/cmd/git.exe'); f.write('Tools/usr/bin/bash.exe', Buffer.from('模拟脚本'))
  f.write('Tools/usr/bin/msys-2.0.dll')
  expect(await findGitBash(f.backend, new AbortController().signal, { PATH: dirname(git) })).toBeUndefined()
  const controller = new AbortController(); controller.abort()
  await expect(findGitBash(f.backend, controller.signal, {})).rejects.toThrow()
  const error = new ProcessCleanupUnconfirmedError(); f.backend.resolveExecutable.mockRejectedValue(error)
  await expect(findGitBash(f.backend, new AbortController().signal, {})).rejects.toBe(error)
})
