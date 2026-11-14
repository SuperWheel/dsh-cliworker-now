import { trackUpdateTemporary, removeUpdateTemporary } from '../update-cleanup.ts'
import { extractZip } from './archive.ts'
import { constants } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, realpath, rename, rm, unlink, symlink, readlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join, win32 } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { CliOperationError } from '../planner.ts'
import { DOWNLOAD_MAX_BYTES } from '../download.ts'
import { privatePath } from './download.ts'
import type { ArtifactDescription } from './types.ts'
const invalid = (message: string): never => { throw new CliOperationError('INTEGRITY_MISMATCH', message) }
const same = (a: string, b: string) => win32.normalize(a).toLowerCase() === win32.normalize(b).toLowerCase()
/** Never remove a live destination before rename. Windows sharing violations leave it intact. */
export async function replaceFile(source: string, target: string, signal: AbortSignal, platform: NodeJS.Platform = process.platform) {
  const temporary = trackUpdateTemporary(join(dirname(target), `.${basename(target)}.${randomUUID()}.download`))
  try {
    signal.throwIfAborted()
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await copyFile(source, temporary, constants.COPYFILE_EXCL); await chmod(temporary, platform === 'win32' ? 0o600 : 0o755)
    signal.throwIfAborted()
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted()
      try { await rename(temporary, target); break }
      catch (error) {
        if (attempt >= 2 || !['EBUSY', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        await delay((attempt + 1) * 500, undefined, { signal })
      }
    }
  } finally { await removeUpdateTemporary(temporary) }
}
export async function placeBinary(source: string, target: string, versionFile: string | undefined, signal: AbortSignal, label: string, platform: NodeJS.Platform = process.platform) {
  let wroteVersion = false, rollbackFailed = false, backup: string | undefined
  try {
    try {
      const existing = await realpath(target)
      // Preserve on-disk casing without following an entry outside the exact whitelist.
      if (!(platform === 'win32' ? same(existing, target) : existing === target)) invalid('Windows 实际入口不在已核实的默认位置')
      target = existing
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (versionFile) {
      await mkdir(dirname(versionFile), { recursive: true, mode: 0o700 })
      try {
        const info = await lstat(versionFile)
        if (!info.isFile() || info.isSymbolicLink()) invalid('Claude 版本位置不是普通文件')
        backup = `${versionFile}.${randomUUID()}.backup`
        await copyFile(versionFile, backup, constants.COPYFILE_EXCL); await chmod(backup, 0o600)
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await replaceFile(source, versionFile, signal, platform); wroteVersion = true
    }
    await replaceFile(source, target, signal, platform)
  } catch (error) {
    if (wroteVersion && versionFile) {
      if (backup) { try { await rename(backup, versionFile); backup = undefined } catch { rollbackFailed = true; throw new CliOperationError('FILE_LOCKED', '版本文件回滚失败，原文件备份已保留；请检查文件占用') } }
      else await unlink(versionFile)
    }
    if (['EBUSY', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new CliOperationError('FILE_LOCKED', `${label} 正被其他程序占用，未替换；关闭后重试`)
    throw error
  } finally { if (backup && !rollbackFailed) { trackUpdateTemporary(backup); await removeUpdateTemporary(backup) } }
}

/** Check every existing ancestor: a symlinked parent must not redirect writes outside the allowlist. */
export async function guardTarget(path: string, description: ArtifactDescription) {
  const matches = (p: string) => description.platform === 'win32' ? same(p, path) : p === path
  if (!description.allowedTargets.some(matches)) invalid('放置目标不在白名单')
  let parent = dirname(path)
  for (;;) {
    try {
      const info = await lstat(parent)
      if (info.isSymbolicLink() || !info.isDirectory()) invalid('放置目标的父目录不是普通目录')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const next = dirname(parent); if (next === parent) break; parent = next
  }
}
export async function extractMember(directory: string, archive: string, format: 'zip' | 'tar.gz', member: string, signal: AbortSignal, run: (argv: string[], signal: AbortSignal) => Promise<void>) {
  if (!/^[A-Za-z0-9_-]+(?:\.exe)?$/.test(member)) invalid('归档成员必须是唯一根目录 CLI 文件')
  const path = privatePath(directory, member), source = privatePath(directory, archive)
  try {
    if (format === 'zip' && process.platform === 'win32') await extractZip(source, directory, signal, member)
    else await run(format === 'tar.gz' ? ['/usr/bin/tar', '-xzf', source, '-C', directory, member] : ['/usr/bin/unzip', '-q', source, member, '-d', directory], signal)
  } catch (error) { if (error instanceof CliOperationError && error.code === 'EXIT_CODE') invalid('官方归档结构或解压校验不通过'); throw error }
  signal.throwIfAborted()
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size <= 0 || info.size > DOWNLOAD_MAX_BYTES) invalid('官方归档没有安全的根目录 CLI 文件')
  await chmod(path, 0o600); return path
}
export async function placeArtifact(description: ArtifactDescription, directory: string, signal: AbortSignal, run: (argv: string[], signal: AbortSignal) => Promise<void>) {
  signal.throwIfAborted()
  const p = description.placement
  if (p.kind === 'none') throw new CliOperationError('PREREQUISITE_MISSING', '此描述仅支持官方阶段显示')
  if (p.kind === 'native-binary' || p.kind === 'release-package' || p.kind === 'registry') throw new Error('Special placement requires bundle context')
  await description.before?.(signal)
  for (const target of description.allowedTargets) await guardTarget(target, description)
  if (p.kind !== 'official-local') {
    await guardTarget(p.target, description)
    if (p.kind === 'versioned-link') await guardTarget(p.versionFile, description)
  }
  const after = await description.after?.(signal)
  if (p.kind === 'official-local') await run(p.argv, signal)
  else if (p.kind === 'versioned-link' && p.link) {
    // Existing links may only refer to this version store. Keep the old link intact until rename.
    await readlink(p.target)
    const resolved = await realpath(p.target)
    if (dirname(resolved) !== dirname(p.versionFile)) invalid('启动器未指向版本白名单目录')
    const temporary = trackUpdateTemporary(`${p.target}.${randomUUID()}.link`), backup = `${p.versionFile}.${randomUUID()}.backup`
    let existed = false, wrote = false, rollbackFailed = false
    try {
      try { const info = await lstat(p.versionFile); if (!info.isFile() || info.isSymbolicLink()) invalid('版本文件不是普通文件'); await copyFile(p.versionFile, backup, constants.COPYFILE_EXCL); existed = true } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
      await replaceFile(privatePath(directory, p.file), p.versionFile, signal, description.platform); wrote = true
      await symlink(p.versionFile, temporary); signal.throwIfAborted(); await rename(temporary, p.target)
    } catch (error) {
      if (wrote) { if (existed) { try { await rename(backup, p.versionFile) } catch { rollbackFailed = true; throw new CliOperationError('FILE_LOCKED', '版本文件回滚失败，原文件备份已保留；请检查文件占用') } } else await rm(p.versionFile) }
      throw error
    } finally { await removeUpdateTemporary(temporary); if (!rollbackFailed) { trackUpdateTemporary(backup); await removeUpdateTemporary(backup) } }
  } else {
    const source = p.kind === 'extract-replace' ? await extractMember(directory, p.archive, p.format, p.member, signal, run) : privatePath(directory, p.file)
    await placeBinary(source, p.target, p.kind === 'versioned-link' ? p.versionFile : undefined, signal, 'CLI', description.platform)
  }
  signal.throwIfAborted(); await after?.(signal)
}
