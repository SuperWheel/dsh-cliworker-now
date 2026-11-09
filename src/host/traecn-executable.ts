import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { captureTraecnMetadata } from './traecn-accounts.ts'
import type { ProcessBackend, RuntimeConfig } from './process.ts'

const verified = new Map<string, number>()
const modified = async (path: string) => { try { const info = await stat(path); return info.isFile() ? info.mtimeMs : undefined } catch { return undefined } }

/** Filename is not identity: even a manually selected alias must identify the official binary. */
export async function verifyTraecnExecutable(executable: string, backend: ProcessBackend, config: RuntimeConfig, signal: AbortSignal): Promise<string> {
  const before = await modified(executable)
  signal.throwIfAborted()
  if (before !== undefined && verified.get(executable) === before) return executable
  const { output, exitCode } = await captureTraecnMetadata(backend, config, [executable, '--version'], homedir(), signal, 10_000)
  if (exitCode !== 0 || !/^traecli \d+\.\d+\.\d+/.test(output.split(/\r?\n/)[0] ?? '') || !output.includes('installation:'))
    throw Object.assign(new Error('不是官方 TRAE CLI，请检查 traecnExecutable'), { code: 'CLI_IDENTITY_MISMATCH' })
  if (before !== undefined && await modified(executable) === before) {
    verified.set(executable, before)
    if (verified.size > 64) verified.delete(verified.keys().next().value!)
  }
  return executable
}
