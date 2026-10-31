import { expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { captureCatalogMetadata } from '../src/host/adapters.ts'
import { cleanupCauseText, DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'

// Synthetic process boundaries only: no native CLI, credentials or network.
function fixture(wait: () => Promise<boolean>) {
  const stdout = new PassThrough(),
    stderr = new PassThrough()
  stdout.end('[]')
  stderr.end()
  const child: SubprocessHandle = {
    stdin: undefined,
    stdout,
    stderr,
    control: undefined,
    collected: {},
    done: Promise.resolve({ exitCode: 0, signal: null }),
    terminate: vi.fn(),
    waitForExit: vi.fn(wait),
  }
  const backend: ProcessBackend = { resolveExecutable: vi.fn(), spawn: vi.fn(() => child) }
  const run = (signal = new AbortController().signal) =>
    captureCatalogMetadata(
      backend,
      DEFAULT_CONFIG,
      ['/synthetic/native-metadata'],
      '/synthetic/project',
      signal,
    )
  return { backend, child, run }
}

it('rejects metadata success when its process range has not exited', async () => {
  const f = fixture(async () => false)
  await expect(f.run()).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
  // A bounded natural-exit wait first, then terminate and an unbounded wait.
  expect(f.child.terminate).toHaveBeenCalledOnce()
  expect(f.child.waitForExit).toHaveBeenCalledTimes(2)
  expect(vi.mocked(f.child.waitForExit).mock.calls[0]![0]).toBeInstanceOf(AbortSignal)
  expect(vi.mocked(f.child.waitForExit).mock.calls[1]).toEqual([])
})

it('does not terminate a finished query whose range empties on its own', async () => {
  const f = fixture(async () => true)
  await expect(f.run()).resolves.toBeDefined()
  expect(f.child.terminate).not.toHaveBeenCalled()
  expect(f.child.waitForExit).toHaveBeenCalledOnce()
})

it('terminates a finished query that outlives the grace period', async () => {
  const waits: (AbortSignal | undefined)[] = []
  const f = fixture(async () => false)
  vi.mocked(f.child.waitForExit).mockImplementation(async (signal?: AbortSignal) => {
    waits.push(signal)
    return !signal
  })
  await expect(f.run()).resolves.toBeDefined()
  expect(waits).toHaveLength(2)
  expect(f.child.terminate).toHaveBeenCalledOnce()
})

it('keeps the runner failure as the cause, shown only without paths', async () => {
  const f = fixture(async () => {
    throw new Error('isJobEmpty failed for C:\\Users\\synthetic\\AppData\\job.json and /Users/synthetic/.dsh/job')
  })
  const error = await f.run().catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(ProcessCleanupUnconfirmedError)
  expect((error as Error).cause).toBeInstanceOf(Error)
  const shown = cleanupCauseText(error as ProcessCleanupUnconfirmedError)
  expect(shown).toBe('isJobEmpty failed for <path> and <path>')
  expect(shown).not.toMatch(/synthetic/)
})

it('preserves typed cleanup failure without exposing driver diagnostics', async () => {
  const f = fixture(async () => {
    throw new Error('SYNTHETIC_PRIVATE_DRIVER_DIAGNOSTIC')
  })
  let failure: unknown
  try {
    await f.run()
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(ProcessCleanupUnconfirmedError)
  expect(String(failure)).toBe(
    'ProcessCleanupUnconfirmedError: CLI catalog process cleanup did not reach quiescence',
  )
  expect(String(failure)).not.toContain('SYNTHETIC_PRIVATE_DRIVER_DIAGNOSTIC')
})

it('does not spawn metadata for an already cancelled request', async () => {
  const f = fixture(async () => true)
  const controller = new AbortController()
  controller.abort(new Error('Synthetic caller cancelled'))
  await expect(f.run(controller.signal)).rejects.toThrow('Synthetic caller cancelled')
  expect(f.backend.spawn).not.toHaveBeenCalled()
})
