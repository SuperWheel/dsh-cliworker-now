import { afterEach, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { existsSync } from 'node:fs'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { agyBackgroundEnvironment } from '../src/host/agy-background-environment.ts'
import { firstPartyEnvironment } from '../src/host/first-party-models.ts'
import { DEFAULT_CONFIG, discoverModels, type ProcessBackend } from '../src/host/process.ts'

// Synthetic environment and process fixtures only; no real CLI or account.
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  vi.unstubAllEnvs()
})

it('AGY background updater suppression is Windows-only and leaves global and shared account environments unchanged', () => {
  vi.stubEnv('AGY_CLI_DISABLE_AUTO_UPDATE', 'false')
  const mimo = firstPartyEnvironment('mimo')
  expect(agyBackgroundEnvironment('antigravity', 'win32')).toEqual({ AGY_CLI_DISABLE_AUTO_UPDATE: 'true' })
  for (const cli of ['codex', 'claude', 'mimo', 'agy', 'unknown'])
    expect(agyBackgroundEnvironment(cli, 'win32')).toEqual({})
  for (const system of ['darwin', 'linux'] as const)
    expect(agyBackgroundEnvironment('antigravity', system)).toEqual({})
  expect(process.env.AGY_CLI_DISABLE_AUTO_UPDATE).toBe('false')
  expect(firstPartyEnvironment('antigravity')).toEqual({})
  expect(firstPartyEnvironment('mimo')).toEqual(mimo)
  expect(mimo).toMatchObject({ MIMOCODE_DISABLE_PROVIDER_ENV: '1', MIMOCODE_PURE: '1' })
})

it.each(['win32', 'darwin', 'linux'] as const)('AGY background legacy model discovery preserves metadata and cleanup on %s', async system => {
  Object.defineProperty(process, 'platform', { ...platform, value: system })
  vi.stubEnv('AGY_CLI_DISABLE_AUTO_UPDATE', 'false')
  const child: SubprocessHandle = {
    stdin: undefined,
    stdout: Readable.from(['synthetic-model\tSynthetic Model\n']),
    stderr: Readable.from([]),
    control: undefined,
    collected: {},
    done: Promise.resolve({ exitCode: 0, signal: null }),
    terminate: vi.fn(),
    waitForExit: vi.fn(async () => true),
  }
  const backend: ProcessBackend = {
    resolveExecutable: vi.fn(async () => '/synthetic/custom-agy'),
    spawn: vi.fn(() => child),
  }
  await expect(discoverModels(backend, DEFAULT_CONFIG, '/synthetic/project', new AbortController().signal))
    .resolves.toEqual([{ id: 'synthetic-model', label: 'Synthetic Model' }])
  const launch = vi.mocked(backend.spawn).mock.calls[0]![0]
  expect(launch.argv).toEqual(['/synthetic/custom-agy', 'models'])
  if (system === 'win32') {
    expect(launch.env).toEqual({ AGY_CLI_DISABLE_AUTO_UPDATE: 'true', TEMP: expect.any(String), TMP: expect.any(String) })
    expect(launch.env!.TEMP).toMatch(/[/\\]cliworker-probe-[^/\\]+$/)
    expect(launch.env!.TMP).toBe(launch.env!.TEMP)
    expect(existsSync(launch.env!.TEMP!)).toBe(false)
  } else expect(launch.env).toEqual({})
  expect(launch.stdio).toEqual({ stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  expect(child.terminate).toHaveBeenCalledOnce()
  expect(child.waitForExit).toHaveBeenCalledOnce()
  expect(process.env.AGY_CLI_DISABLE_AUTO_UPDATE).toBe('false')
})
