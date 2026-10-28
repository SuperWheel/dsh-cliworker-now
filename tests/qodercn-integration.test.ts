import { expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { workerArguments } from '../src/host/adapters.ts'
import { CLI_IDS } from '../src/shared/types.ts'
import { requireCliName, invocationResolution } from '../src/host/routing.ts'
import { transportFor, usesNativeBridge } from '../src/host/native-worker.ts'
import { cliLevelOptions, workerPlanSupported } from '../src/shared/worker-permissions.ts'
import { buildNativeHarnessInjection, nativeHarnessToolCapability } from '../src/host/native-harness-injection.mjs'

// Synthetic routing and argv only; no native login, executable launch, or real model.
const preference = { cli: 'qodercn' as const, model: 'synthetic-cn-model', effort: 'default' as const }

it('selects Qoder CN explicitly and keeps its native transport distinct from global Qoder', () => {
  expect(CLI_IDS).toContain('qodercn')
  expect(requireCliName('Qoder CN CLI')).toBe('qodercn')
  expect(requireCliName('Qoder CLI')).toBe('qoder')
  expect(invocationResolution([createUserMessage({ source: { kind: 'user' },
    content: [{ type: 'text', text: '请用 Qoder CN CLI 检查文件' }] })]))
    .toMatchObject({ status: 'resolved', cli: 'qodercn' })
  expect(transportFor('qodercn')).toBe('qodercn-acp-v1')
  expect(transportFor('qodercn')).not.toBe(transportFor('qoder'))
  expect(usesNativeBridge({ preference, transport: transportFor('qodercn') })).toBe(true)
  expect(() => workerArguments('qodercn', '/synthetic/project', preference, 'accept-edits', 'simulated', 1000)).toThrow('原生 ACP')
  expect(() => workerArguments('qodercn', '/synthetic/project', preference, 'plan', 'simulated', 1000, undefined, true)).toThrow('未公开只读规划')
})

it('preserves literal CN model argv and native approval boundaries', () => {
  const argv = workerArguments('/synthetic/qoderclicn', '/synthetic/project',
    { ...preference, model: 'literal;$(must-not-run)', effort: 'high' }, 'accept-edits', 'simulated', 1000, undefined, true)
  expect(argv).toEqual(['/synthetic/qoderclicn', '--acp', '--permission-mode', 'auto', '--model', 'literal;$(must-not-run)'])
  expect(argv.join(' ')).not.toMatch(/yolo|bypass|dangerously/)
  expect(workerPlanSupported({ preference, transport: 'qodercn-acp-v1' })).toBe(false)
  expect(cliLevelOptions('qodercn').map(option => option.value)).toEqual(['ask', 'auto', 'full'])
  expect(nativeHarnessToolCapability('qodercn')).toMatchObject({ transport: true, ready: false })
  expect(buildNativeHarnessInjection({ cli: 'qodercn', argv }).argv).toEqual(argv)
})
