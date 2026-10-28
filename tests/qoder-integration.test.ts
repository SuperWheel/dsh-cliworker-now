import { expect, it } from 'vitest'
import { workerArguments } from '../src/host/adapters.ts'
import { CLI_IDS } from '../src/shared/types.ts'
import { requireCliName, invocationResolution } from '../src/host/routing.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { transportFor, usesNativeBridge } from '../src/host/native-worker.ts'
import { cliLevelOptions, workerPlanSupported } from '../src/shared/worker-permissions.ts'
import {
  buildNativeHarnessInjection,
  nativeHarnessToolCapability,
} from '../src/host/native-harness-injection.mjs'
import { extractTelemetry } from '../src/host/telemetry.ts'

const preference = { cli: 'qoder' as const, model: 'synthetic-model', effort: 'default' as const }

it('selects Qoder explicitly, pins ACP and never executes through a legacy adapter', () => {
  expect(CLI_IDS).toContain('qoder')
  expect(requireCliName('Qoder CLI')).toBe('qoder')
  expect(
    invocationResolution([
      createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: '请用 Qoder CLI 检查文件' }],
      }),
    ]),
  ).toMatchObject({ status: 'resolved', cli: 'qoder' })
  expect(transportFor('qoder')).toBe('qoder-acp-v1')
  expect(usesNativeBridge({ preference, transport: transportFor('qoder') })).toBe(true)
  expect(() =>
    workerArguments('qoder', '/synthetic/project', preference, 'accept-edits', 'simulated', 1000),
  ).toThrow('原生 ACP')
  expect(() =>
    workerArguments('qoder', '/synthetic/project', preference, 'plan', 'simulated', 1000, undefined, true),
  ).toThrow('未公开只读规划')
})

it('retains native approval checks, literal model argv and only supported permission controls', () => {
  const argv = workerArguments(
    '/synthetic/qoder',
    '/synthetic/project',
    {
      ...preference,
      model: 'literal;$(must-not-run)',
      effort: 'high',
    },
    'accept-edits',
    'simulated',
    1000,
    undefined,
    true,
  )
  expect(argv).toEqual([
    '/synthetic/qoder',
    '--acp',
    '--permission-mode',
    'auto',
    '--model',
    'literal;$(must-not-run)',
  ])
  expect(argv.join(' ')).not.toMatch(/yolo|bypass|dangerously/)
  expect(
    [workerPlanSupported({ preference, transport: 'qoder-acp-v1' }), cliLevelOptions('qoder').map((option) => option.value)],
  ).toEqual([false, ['ask', 'auto', 'full']])
  expect(nativeHarnessToolCapability('qoder')).toMatchObject({ transport: true, ready: false })
  expect(buildNativeHarnessInjection({ cli: 'qoder', argv }).argv).toEqual(argv)
})

it('projects one owned Qoder prompt receipt as run accounting and leaves response/cache/context unknown', () => {
  // Synthetic accounting receipt; no Qoder process, account or model is used.
  const receipt = (usage: unknown, sessionId = 'synthetic-session', model = preference.model) => ({
    type: 'native',
    record: { type: 'cliworker.qoder_prompt_usage', sessionId, model, usage },
  })
  const usage = { inputTokens: 60, outputTokens: 7, totalTokens: 67 }
  const identity = { conversationId: 'synthetic-session', model: preference.model }
  const result = extractTelemetry('qoder', [receipt(usage), receipt(usage)], identity)
  expect(result.usage).toEqual({ input: 60, output: 7, total: 67, scope: 'run' })
  expect(result.runUsage).toEqual(result.usage)
  expect(result.replies).toEqual({})
  expect(result.contextUsed).toBeUndefined()
  expect(result.contextCapacity).toBeUndefined()
  expect(result.usage?.cacheRead).toBeUndefined()
  expect(result.usage?.cacheWrite).toBeUndefined()
  for (const invalid of [
    receipt(usage, 'foreign-session'),
    receipt(usage, 'synthetic-session', 'foreign-model'),
    receipt({ ...usage, totalTokens: 70 }),
    receipt({ inputTokens: 60, totalTokens: 60 }),
    receipt({ ...usage, inputTokens: -1 }),
  ])
    expect(extractTelemetry('qoder', [invalid], identity).usage).toBeUndefined()
})
