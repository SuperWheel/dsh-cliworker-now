import { Readable } from 'node:stream'
import { vi } from 'vitest'
import type { ProcessBackend } from '../../src/host/process.ts'

/** 模拟 metadata backend: never starts a CLI or reads the machine's account. */
export function traecnMetadata(output: (argv: readonly string[]) => { output: string; exitCode?: number } = argv => ({
  output: argv.includes('--version') ? 'traecli 0.213.1\ninstallation: public\n' : argv.includes('status') ? 'Logged in using Trae\n' : '[]',
})) {
  const calls: any[] = []
  const spawn = vi.fn((spec: any) => {
    calls.push(spec)
    const result = output(spec.argv)
    return { stdout: Readable.from([Buffer.from(result.output)]), stderr: Readable.from([]),
      done: Promise.resolve({ exitCode: result.exitCode ?? 0, signal: null }), terminate: vi.fn(), waitForExit: vi.fn(async () => true) }
  })
  const backend = { spawn, resolveExecutable: vi.fn(async (name: string) => name) } as unknown as ProcessBackend
  return { backend, calls, spawn }
}
