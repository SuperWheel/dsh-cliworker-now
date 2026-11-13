import { open, realpath } from 'node:fs/promises'
import { dirname, join, win32 } from 'node:path'
import { homedir } from 'node:os'
import type { ProcessBackend } from './process.ts'
import { ProcessCleanupUnconfirmedError } from './process.ts'
import { windowsPathDirectories } from './windows-cli-path.ts'

async function nativeFile(path: string): Promise<string> {
  const canonical = await realpath(path), file = await open(canonical, 'r')
  try {
    const stat = await file.stat(), header = Buffer.alloc(64), signature = Buffer.alloc(4)
    if (!stat.isFile() || (await file.read(header, 0, 64, 0)).bytesRead !== 64 || header.toString('ascii', 0, 2) !== 'MZ') throw new Error('Not PE')
    const offset = header.readUInt32LE(0x3c)
    if (offset < 64 || offset + 4 > stat.size || (await file.read(signature, 0, 4, offset)).bytesRead !== 4 || signature.toString('hex') !== '50450000') throw new Error('Not PE')
    return canonical
  } finally { await file.close() }
}

/** File-only discovery: Git for Windows' MSYS layout, independent of the folder's name.
 * Never launch bash/git and never accept the Windows System32 WSL launcher. */
export async function findGitBash(backend: ProcessBackend, signal: AbortSignal, env = process.env): Promise<string | undefined> {
  signal.throwIfAborted()
  const paths = windowsPathDirectories([env.PATH ?? env.Path ?? ''])
  const candidates = paths.flatMap(path => [join(path, 'bash.exe'), join(path, 'git.exe')])
  try { candidates.push(await backend.resolveExecutable('git.exe')) }
  catch (error) { if (error instanceof ProcessCleanupUnconfirmedError || signal.aborted) throw error }
  const roots = new Set<string>()
  for (const candidate of candidates) {
    // A Git entry can be in bin, cmd, usr/bin or mingw64/bin (portable installs included).
    const path = /^[a-z]:\\/i.test(candidate) ? win32 : { dirname, join }
    const parent = path.dirname(candidate)
    roots.add(path.dirname(parent)); roots.add(path.dirname(path.dirname(parent)))
  }
  for (const root of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')].filter((p): p is string => !!p)) roots.add(join(root, 'Git'))
  roots.add(join(homedir(), 'scoop', 'apps', 'git', 'current'))
  for (const root of roots) {
    signal.throwIfAborted()
    try {
      const bash = await nativeFile(join(root, 'usr', 'bin', 'bash.exe'))
      await nativeFile(join(root, 'usr', 'bin', 'msys-2.0.dll'))
      await nativeFile(join(root, 'cmd', 'git.exe'))
      return bash
    } catch { signal.throwIfAborted() }
  }
  return undefined
}
