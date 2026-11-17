import { trackUpdateTemporary, removeUpdateTemporary, retainUpdateTemporary } from '../update-cleanup.ts'
import { ProcessCleanupUnconfirmedError } from '../../process.ts'
import { copyFile, lstat, mkdir, rename, rm, symlink, chmod, readFile, readlink } from 'node:fs/promises'
import { dirname, relative, join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ArtifactDescription } from './types.ts'
import type { LocalArtifactOptions } from '../local-artifacts.ts'
import { privatePath } from './download.ts'
import { guardTarget, extractMember } from './placement.ts'
import { smokeBinary, invalidArtifact } from './native.ts'
import { captureReadOnly } from '../versions.ts'
import { executeCliOperation } from '../executor.ts'
import { extractTar, extractZip } from './archive.ts'
import { CliOperationError } from '../planner.ts'
export interface Mutation { target: string; source?: string; link?: string; copyFallback?: boolean; mode?: number }
/** Stage all writes beside their destinations; rollback every committed entry on failure. */
export async function atomicMutations(mutations: Mutation[], description: ArtifactDescription, signal: AbortSignal, beforeCommit?: (staged: { change: Mutation; temp: string }[]) => Promise<void>) {
  const staged: { change: Mutation; temp: string; backup: string; backed: boolean; installed: boolean }[] = []
  let rollbackFailed = false, quarantine = false
  try {
    for (const change of mutations) {
      signal.throwIfAborted(); await guardTarget(change.target, description)
      await mkdir(dirname(change.target), { recursive: true, mode: 0o700 })
      const info = await lstat(change.target).catch(e => { if (e.code !== 'ENOENT') throw e; return undefined })
      if (info && !info.isFile() && !info.isSymbolicLink() || info?.isFile() && info.nlink !== 1) invalidArtifact('替换目标不是普通文件或链接')
      const entry = { change, temp: `${change.target}.tmp.${randomUUID()}${description.platform === 'win32' ? '.exe' : ''}`, backup: `${change.target}.old.${Date.now()}.${randomUUID()}`, backed: false, installed: false }; staged.push(entry); trackUpdateTemporary(entry.temp)
      if (change.link) {
        try { await symlink(change.link, entry.temp) } catch (e) {
          if (!change.copyFallback || !['EPERM', 'EACCES', 'ENOTSUP'].includes((e as NodeJS.ErrnoException).code ?? '') || !change.source) throw e
          await copyFile(change.source, entry.temp); await chmod(entry.temp, change.mode ?? 0o755)
        }
      } else { await copyFile(change.source!, entry.temp); await chmod(entry.temp, change.mode ?? 0o755) }
    }
    await beforeCommit?.(staged)
    for (const entry of staged) {
      signal.throwIfAborted()
      // Windows permits renaming a mapped exe, but replacing it in place can fail.
      try {
        if (description.platform === 'win32') await rename(entry.change.target, entry.backup)
        else { const info = await lstat(entry.change.target); if (info.isSymbolicLink()) await symlink(await readlink(entry.change.target), entry.backup); else await copyFile(entry.change.target, entry.backup) }
        entry.backed = true
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
      await rename(entry.temp, entry.change.target); entry.installed = true
    }
    signal.throwIfAborted()
  } catch (error) {
    if (error instanceof ProcessCleanupUnconfirmedError) { quarantine = true; throw error }
    for (const entry of [...staged].reverse()) {
      try { if (entry.installed) await rm(entry.change.target); if (entry.backed) await rename(entry.backup, entry.change.target) }
      catch { rollbackFailed = true }
    }
    if (rollbackFailed) throw new CliOperationError('FILE_LOCKED', '放置回滚失败，原文件 .old 备份已保留')
    throw error
  } finally {
    for (const entry of staged) {
      if (quarantine) { retainUpdateTemporary(entry.temp); continue }
      await removeUpdateTemporary(entry.temp)
      if (!rollbackFailed) { trackUpdateTemporary(entry.backup); await removeUpdateTemporary(entry.backup) }
    }
  }
}
export async function verifyGrokSignature(o: LocalArtifactOptions, files: string[], signal: AbortSignal) {
  for (const file of files) {
    if ((o.platform ?? process.platform) === 'darwin') {
      await executeCliOperation(o.backend, o.config, ['/usr/bin/codesign', '--verify', '--strict', file], signal, () => {})
      let details = ''
      await executeCliOperation(o.backend, o.config, ['/usr/bin/codesign', '-dv', '--verbose=4', file], signal, s => { details += s })
      if (!/^TeamIdentifier=5Y6N3AJ54S\s*$/m.test(details)) invalidArtifact('Grok 签名 TeamIdentifier 不符')
    } else if ((o.platform ?? process.platform) === 'win32') {
      // Script is constant; path is data in argv, never interpolated PowerShell source.
      const script = join(dirname(file), 'verify-signature.ps1')
      const value = await captureReadOnly(o.backend, o.config, ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, file], signal)
      const result = JSON.parse(value)
      // Publisher seen on the real Windows binaries (2026-11-17：1.0.77 与 1.0.88 的 grok/agent/grove* 均为
      // `CN=X Corp., O=X Corp., L=Bastrop, S=Texas, C=US`，GlobalSign GCC R45 CodeSigning CA 2020); X.AI LLC kept for older builds.
      const subject = result.Subject ?? ''
      const publisher = /(?:^|,\s*)CN=X Corp\.,\s*O=X Corp\.(?:,|$)/.test(subject) || /(?:^|,\s*)CN=X\.AI LLC(?:,|$)/.test(subject)
      if (result.Status !== 'Valid' || !publisher) invalidArtifact(result.Status !== 'Valid' ? `Grok Authenticode 无效（${String(result.Status).slice(0, 40)}）` : 'Grok Authenticode 发布者不是 X Corp.')
    }
  }
}
export async function placeNative(description: ArtifactDescription, directory: string, signal: AbortSignal, o: LocalArtifactOptions, run: (argv: string[], signal: AbortSignal) => Promise<void>) {
  const p = description.placement; if (p.kind !== 'native-binary') return
  await description.before?.(signal)
  let source = privatePath(directory, p.file)
  if (p.extract) {
    const extracted = join(directory, `extract-${randomUUID()}`)
    if (p.extract.format === 'zip') await extractZip(privatePath(directory, p.extract.archive), extracted, signal, p.extract.member)
    else await extractTar(privatePath(directory, p.extract.archive), extracted, signal, p.extract.member)
    source = privatePath(extracted, p.extract.member)
    const info = await lstat(source); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || !info.size) invalidArtifact('归档缺少安全的唯一可执行成员')
  }
  if (p.signature) await verifyGrokSignature(o, [source, ...(p.companions ?? []).map(c => privatePath(directory, c.file))], signal)
  const changes: Mutation[] = []
  if (p.versionFile) changes.push({ source, target: p.versionFile })
  for (const target of p.targets) changes.push({ source, target, ...(p.versionFile && description.platform !== 'win32' || p.copyFallback ? { link: relative(dirname(target), p.versionFile!), copyFallback: p.copyFallback } : {}) })
  for (const item of p.companions ?? []) changes.push({ source: privatePath(directory, item.file), target: item.target })
  for (const item of p.metadata ?? []) changes.push({ source: privatePath(directory, item.file), target: item.target, mode: 0o644 })
  let mingit: string | undefined
  if (p.mingit) {
    await guardTarget(p.mingit.target, description)
    if (!await lstat(p.mingit.target).catch(() => undefined)) {
      mingit = trackUpdateTemporary(`${p.mingit.target}.staging.${randomUUID()}`)
      // Cleanup covers both extraction and rename: a cancelled or corrupt extract must not leave staging dirs.
      try { await extractZip(privatePath(directory, p.mingit.archive), mingit, signal); signal.throwIfAborted(); await rename(mingit, p.mingit.target); mingit = undefined } finally { if (mingit) await removeUpdateTemporary(mingit) }
    }
  }
  const after = await description.after?.(signal)
  await atomicMutations(changes, description, signal, async staged => { if (p.smoke) await smokeBinary(o, staged[0]!.temp, signal, p.smoke.version, p.smoke.match === 'exact', p.smoke.env) }); await after?.(signal)
}
export async function placeRelease(description: ArtifactDescription, directory: string, signal: AbortSignal, o: LocalArtifactOptions, run: (argv: string[], signal: AbortSignal) => Promise<void>) {
  const p = description.placement; if (p.kind !== 'release-package') return
  await guardTarget(p.target, description)
  const staging = trackUpdateTemporary(join(dirname(p.target), `.staging.${basename(p.target)}.${process.pid}.${randomUUID()}`))
  let quarantine = false
  try {
    // Refuse an existing destination: never overwrite another process's completed release.
    if (await lstat(p.target).catch(() => undefined)) throw new CliOperationError('UPDATE_LOCKED', 'Codex 目标版本目录已存在，请先用官方更新器确认')
    await extractTar(privatePath(directory, p.archive), staging, signal)
    const metadata = JSON.parse(await readFile(join(staging, 'codex-package.json'), 'utf8'))
    const executables = ['bin/codex', 'bin/codex-code-mode-host', 'codex-path/rg', ...(JSON.stringify(metadata).includes('"execServer"') ? ['bin/codex-exec-server'] : []), ...(description.platform === 'linux' ? ['codex-resources/bwrap'] : [])]
    for (const name of executables) { const info = await lstat(join(staging, name)); if (!info.isFile() || info.isSymbolicLink()) invalidArtifact('Codex 包缺少官方要求的可执行文件'); await chmod(join(staging, name), 0o755) }
    const launcher = join(staging, 'codex'); if (await lstat(launcher).catch(() => undefined)) await rm(launcher)
    await symlink('bin/codex', launcher)
    await smokeBinary(o, join(staging, 'bin/codex'), signal, p.version, false)
    signal.throwIfAborted(); await rename(staging, p.target)
    await run(p.argv, signal)
  } catch (error) { quarantine = error instanceof ProcessCleanupUnconfirmedError; throw error }
  finally { if (!quarantine) await removeUpdateTemporary(staging); else retainUpdateTemporary(staging) }
}
