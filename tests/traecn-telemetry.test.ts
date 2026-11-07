import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractTelemetry, TelemetryReader } from '../src/host/telemetry.ts'
import { nativeUsageReport } from '../src/shared/native-usage-report.ts'
const identity = { conversationId: 'SIMULATED-session', model: 'SIMULATED-model' }
const common = { source: 'traecn.session/prompt', sessionId: identity.conversationId, model: identity.model }
const prompt = { ...common, type: 'cliworker.traecn_prompt_usage', usage: { inputTokens: 60, outputTokens: 7, totalTokens: 67, cachedReadTokens: 20, cachedWriteTokens: 3, thoughtTokens: 2 } }
const context = { ...common, type: 'cliworker.traecn_context', used: 67, size: 128000 }
const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
describe('模拟：TRAE 用量来源隔离', () => {
  it('reports native input without assuming cache inclusion, never credits', () => {
    const data = extractTelemetry('traecn', [prompt, prompt, context], identity)
    expect(data.usage).toEqual({ input: 60, output: 7, total: 67, cacheRead: 20, cacheWrite: 3, reasoning: 2, scope: 'run' })
    expect(data).toMatchObject({ contextUsed: 67, contextCapacity: 128000, contextEstimated: false })
    expect(data.providerCredits).toBeUndefined()
    expect(nativeUsageReport('traecn', data.usage)).toMatchObject({ totalTokens: 67, inputBasis: 'reported', cacheReadTokens: 20 })
  })
  it.each([{ sessionId: 'other' }, { source: 'qodercn.native-transcript' }, { model: 'other-model' }])('rejects crossed source %j', override => {
    const data = extractTelemetry('traecn', [{ ...prompt, ...override }, { ...context, ...override }], identity)
    expect(data.usage).toBeUndefined(); expect(data.contextUsed).toBeUndefined()
  })
  it.each(['qoder', 'qodercn', 'codex'] as const)('does not attribute TRAE receipts to %s', cli => {
    expect(extractTelemetry(cli, [prompt, context], identity).usage).toBeUndefined()
  })
  it('rejects zero and inconsistent usage, retaining optional data as reported', () => {
    for (const usage of [{ inputTokens: 0, outputTokens: 0, totalTokens: 0 }, { inputTokens: 1, outputTokens: 2, totalTokens: 4 }])
      expect(extractTelemetry('traecn', [{ ...prompt, usage }], identity).usage).toBeUndefined()
    expect(nativeUsageReport('traecn', { input: 0, output: 0, total: 0, scope: 'run' })).toBeUndefined()
  })
  it('preserves only whitelisted fields through disk telemetry reads', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'traecn-SIMULATED-telemetry-'))); roots.push(root)
    const path = join(root, 'native.jsonl')
    writeFileSync(path, [prompt, context].map(record => JSON.stringify({ type: 'native', record: { ...record, secret: 'SIMULATED-secret' } })).join('\n') + '\n')
    const data = new TelemetryReader().read(path, 'traecn', identity)
    expect(data).toMatchObject({ usage: { total: 67 }, contextUsed: 67, contextCapacity: 128000 })
    expect(JSON.stringify(data)).not.toContain('SIMULATED-secret')
  })
})
