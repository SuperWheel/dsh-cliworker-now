import { syntheticNativeAcl, exposeSyntheticNativePath, recordSyntheticNativePrivacy } from './fixtures/native-file-privacy.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KimiDurableUsageObserver, inspectKimiDurableTurn, kimiDurableUsage, kimiJournalBaseline, kimiWorkspaceKey } from '../src/host/kimi-durable-usage.mjs'
import { runNativeKimi } from '../src/host/native-kimi.mjs'

// Synthetic current Kimi Code 2.1.1 durable records. No CLI/model/account is used.
const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
const header = { type: 'metadata', protocol_version: '1.5', created_at: 0 }
const usage = { inputOther: 11, output: 3, inputCacheRead: 7, inputCacheCreation: 2 }
const expected = { prompt: 'SYNTHETIC_PRIVATE_PROMPT', model: 'chosen' }
const row = (type: string, fields: Record<string, unknown> = {}) => ({ type, agentId: 'main', ...fields })
const prompt = (turnId = 0) => row('turn.prompt', { turnId, promptId: `prompt-${turnId}`, origin: { kind: 'user' }, input: [{ type: 'text', text: expected.prompt }] })
const loop = (type: string, fields: Record<string, unknown> = {}) => row('context.append_loop_event', { event: { type, turnId: '0', step: 1, uuid: 'step-a', ...fields } })
const terminal = (reason = 'completed') => row('turn.ended', { turnId: 0, reason })
function turn() {
  return [prompt(), loop('step.begin'), row('llm.request', { modelAlias: 'chosen', kind: 'loop', turnStep: '0.1' }),
    row('usage.record', { model: 'chosen', usage, usageScope: 'turn' }),
    loop('step.end', { usage, messageId: 'provider-response-a', finishReason: 'end_turn' }), terminal()]
}
const baseline = () => kimiJournalBaseline([header])
const inspect = (rows = turn(), options = {}) => inspectKimiDurableTurn(baseline(), rows, { ...expected, ...options })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kimi-durable-synthetic-')); roots.push(root)
  const home = join(root, 'private-cli-home'), project = join(root, 'project')
  const directory = join(home, 'sessions', kimiWorkspaceKey(project), 'session', 'agents', 'main')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const session = join(directory, '..', '..'), statePath = join(session, 'state.json'), wire = join(directory, 'wire.jsonl')
  const metadata = { version: 2, id: 'session', cwd: project, agents: { main: { type: 'main' } } }
  writeFileSync(statePath, JSON.stringify(metadata), { mode: 0o600 })
  writeFileSync(wire, JSON.stringify(header) + '\n', { mode: 0o600 })
  syntheticNativeAcl([home, join(home, 'sessions'), join(home, 'sessions', kimiWorkspaceKey(project)), session,
    join(session, 'agents'), directory, statePath, wire].map(path => ({ path })))
  const config = { cli: 'kimi', argv: ['synthetic'], project, prompt: expected.prompt, mode: 'accept-edits',
    preference: { model: 'chosen', effort: 'default' }, env: { KIMI_CODE_HOME: home } }
  const observer = new KimiDurableUsageObserver(config), records: any[] = []
  const controller = new AbortController()
  const io = { signal: controller.signal, native: (record: unknown) => records.push(record) }
  return { root, home, directory, session, statePath, metadata, wire, config, observer, records, io, controller,
    append: (rows = turn()) => appendFileSync(wire, rows.map((row) => JSON.stringify(row)).join('\n') + '\n') }
}

describe('Kimi current durable usage: identity, scope and native unknowns', () => {
  it('keeps absent/invalid provider receipts unknown, including the CLI four-zero normalization', () => {
    expect(kimiDurableUsage(usage)).toEqual(usage)
    expect(kimiDurableUsage({ ...usage, output: 0 })).toEqual({ ...usage, output: 0 })
    for (const invalid of [{}, { ...usage, inputCacheCreation: undefined }, { ...usage, output: -1 },
      { ...usage, output: 1.5 }, { ...usage, inputOther: Number.MAX_SAFE_INTEGER },
      { inputOther: 0, output: 0, inputCacheRead: 0, inputCacheCreation: 0 }])
      expect(kimiDurableUsage(invalid)).toBeUndefined()
  })
  it('uses actual prompt, turn, step and provider message ids, with no historical totals', () => {
    expect(inspect()).toEqual({ turnId: '0', scope: 'run', usage,
      responses: [{ stepId: 'step-a', responseId: 'provider-response-a', usage }] })
    const before = kimiJournalBaseline([header, ...turn()])
    const next = turn().map((record: any) => ({ ...record, ...(record.turnId !== undefined ? { turnId: 1 } : {}),
      ...(record.type === 'turn.prompt' ? { promptId: 'prompt-1' } : {}),
      ...(record.event ? { event: { ...record.event, turnId: '1' } } : {}),
      ...(record.type === 'llm.request' ? { turnStep: '1.1' } : {}) }))
    expect(inspectKimiDurableTurn(before, next, expected)?.usage).toEqual(usage)
    expect(inspectKimiDurableTurn(before, turn(), expected)).toBeUndefined()
  })
  it('adds complete independent responses exactly once', () => {
    const second = [loop('step.begin', { uuid: 'step-b', step: 2 }),
      row('llm.request', { modelAlias: 'chosen', kind: 'loop', turnStep: '0.2' }),
      row('usage.record', { model: 'chosen', usage, usageScope: 'turn' }),
      loop('step.end', { uuid: 'step-b', step: 2, usage, messageId: 'provider-response-b' })]
    const result = inspect([...turn().slice(0, -1), ...second, terminal()])
    expect(result?.scope).toBe('run')
    expect(result?.usage).toEqual({ inputOther: 22, output: 6, inputCacheRead: 14, inputCacheCreation: 4 })
    expect(result?.responses.map((record) => record.responseId)).toEqual(['provider-response-a', 'provider-response-b'])
  })
  it('can prove a complete run without inventing a missing provider response id', () => {
    const result = inspect(turn().map((r: any) => r.event?.type === 'step.end' ? { ...r, event: { ...r.event, messageId: undefined } } : r))
    expect(result?.scope).toBe('run')
    expect(result?.usage).toEqual(usage)
    expect(result?.responses).toEqual([])
  })
  it.each([
    ['multiple turns', () => [prompt(9), ...turn()]],
    ['steering', () => [row('turn.steer', { turnId: 0 }), ...turn()]],
    ['branch switch', () => [{ type: 'agent.switched', branch: 'b1' }, ...turn()]],
    ['foreign terminal', () => [...turn().slice(0, -1), row('turn.ended', { turnId: 8, reason: 'completed' })]],
    ['no terminal', () => turn().slice(0, -1)],
    ['wrong prompt', () => [{ ...prompt(), input: [{ type: 'text', text: 'other' }] }, ...turn().slice(1)]],
    ['wrong model', () => turn().map((r) => r.type === 'usage.record' ? { ...r, model: 'other' } : r)],
    ['wrong request model', () => turn().map((r) => r.type === 'llm.request' ? { ...r, modelAlias: 'other' } : r)],
    ['duplicate step', () => [prompt(), loop('step.begin'), ...turn().slice(1)]],
  ] as const)('rejects ambiguous %s', (_name, rows) => { expect(inspect(rows())).toBeUndefined() })
  it('requires an idle, unmigrated and branch-consistent pre-prompt baseline', () => {
    expect(kimiJournalBaseline([header, prompt()])).toBeUndefined()
    expect(kimiJournalBaseline([{ ...header, protocol_version: '1.4' }])).toBeUndefined()
    expect(kimiJournalBaseline([header, { type: 'agent.switched' }])).toBeUndefined()
    expect(kimiJournalBaseline([header, terminal()])).toBeUndefined()
  })
  it.each([
    ['children', () => turn(), { hasChildren: true }],
    ['delegation tool', () => [prompt(), loop('tool.call', { name: 'Agent' }), ...turn().slice(1)], {}],
    ['auxiliary call', () => turn().map((r) => r.type === 'usage.record' ? { ...r, usageScope: 'session' } : r), {}],
    ['retry', () => [prompt(), ...turn().slice(1, 3), turn()[2], ...turn().slice(3)], {}],
    ['missing request coverage', () => turn().filter((r) => r.type !== 'llm.request'), {}],
    ['failed terminal', () => [...turn().slice(0, -1), terminal('failed')], {}],
    ['inconsistent step vs bill', () => turn().map((r: any) => r.event?.type === 'step.end' ? { ...r, event: { ...r.event, usage: { ...usage, output: 99 } } } : r), {}],
    ['missing step cache', () => turn().map((r: any) => r.event?.type === 'step.end' ? { ...r, event: { ...r.event, usage: { ...usage, inputCacheRead: undefined } } } : r), {}],
  ] as const)('preserves observed receipts without claiming a complete run for %s', (_name, rows, options) => {
    expect(inspect(rows(), options)?.scope).toBe('reported')
  })
})

describe('Kimi ACP supplemental reader remains private, bounded and read only', () => {
  it('reads only an exact private CLI home/project/session path and emits sanitized receipt fields', async () => {
    const f = fixture(); await f.observer.prepare('session'); f.append()
    const before = readFileSync(f.wire)
    await f.observer.finish({ stopReason: 'end_turn' }, 'session', f.io)
    expect(f.records).toEqual([
      { type: 'cliworker.kimi_response_usage', source: 'kimi.durable.main-wire', sessionId: 'session', model: 'chosen', turnId: '0', stepId: 'step-a', responseId: 'provider-response-a', usage },
      { type: 'cliworker.kimi_usage', source: 'kimi.durable.main-wire', sessionId: 'session', model: 'chosen', turnId: '0', scope: 'run', usage },
    ])
    expect(JSON.stringify(f.records)).not.toContain('PRIVATE')
    expect(readFileSync(f.wire)).toEqual(before)
  })
  it('waits for a late durable terminal flush before taking a complete receipt', async () => {
    const f = fixture(); await f.observer.prepare('session'); f.append(turn().slice(0, -1))
    const later = setTimeout(() => f.append([terminal()]), 40)
    try { await f.observer.finish({ stopReason: 'end_turn' }, 'session', f.io) }
    finally { clearTimeout(later) }
    expect(f.records.at(-1)?.scope).toBe('run')
  })
  it.each(['replacement', 'rewrite', 'truncated', 'incomplete-line', 'foreign-session', 'wrong-project', 'public-directory', 'symlink', 'symlink-directory'] as const)('rejects %s instead of borrowing another session or guessing a baseline', async (scenario) => {
    const f = fixture(); await f.observer.prepare('session'); f.append()
    if (scenario === 'replacement') { renameSync(f.wire, f.wire + '.old'); writeFileSync(f.wire, readFileSync(f.wire + '.old'), { mode: 0o600 }) }
    if (scenario === 'rewrite') writeFileSync(f.wire, readFileSync(f.wire, 'utf8').replace('created_at":0', 'created_at":1'))
    if (scenario === 'truncated') writeFileSync(f.wire, '')
    if (scenario === 'incomplete-line') appendFileSync(f.wire, '{')
    if (scenario === 'foreign-session') writeFileSync(f.statePath, JSON.stringify({ ...f.metadata, id: 'foreign' }))
    if (scenario === 'wrong-project') writeFileSync(f.statePath, JSON.stringify({ ...f.metadata, cwd: '/other' }))
    if (scenario === 'public-directory') exposeSyntheticNativePath(f.directory)
    if (scenario === 'symlink') { renameSync(f.wire, f.wire + '.old'); symlinkSync(f.wire + '.old', f.wire) }
    if (scenario === 'symlink-directory') { renameSync(f.directory, f.directory + '.old'); symlinkSync(f.directory + '.old', f.directory) }
    f.controller.abort()
    await f.observer.finish({ stopReason: 'end_turn' }, 'session', f.io)
    expect(f.records).toEqual([])
  })
  it('does not read path traversal, foreign homes or cancelled prompts', async () => {
    const f = fixture()
    await f.observer.prepare('../session'); f.append()
    await f.observer.finish({ stopReason: 'end_turn' }, '../session', f.io)
    const foreign = new KimiDurableUsageObserver({ ...f.config, env: { KIMI_CODE_HOME: join(f.root, 'other') } })
    await foreign.prepare('session'); await foreign.finish({ stopReason: 'end_turn' }, 'session', f.io)
    await f.observer.prepare('session'); await f.observer.finish({ stopReason: 'cancelled' }, 'session', f.io)
    expect(f.records).toEqual([])
  })
  it('preserves valid completed-step bills after cancellation without claiming a complete run', async () => {
    const f = fixture(); await f.observer.prepare('session'); f.append([...turn().slice(0, -1), terminal('cancelled')])
    await f.observer.finish({ stopReason: 'cancelled' }, 'session', f.io)
    expect(f.records[0]?.responseId).toBe('provider-response-a')
    expect(f.records.at(-1)?.scope).toBe('reported')
  })
  it('captures its cursor before the ACP prompt and emits bills before process close', async () => {
    const f = fixture(), order: string[] = []
    const state = { sessionId: 'session', modes: { currentModeId: 'yolo', availableModes: [{ id: 'default' }, { id: 'yolo' }] },
      configOptions: [{ id: 'model', currentValue: 'chosen', options: [{ value: 'chosen' }] },
        { id: 'mode', currentValue: 'yolo', options: [{ value: 'default' }, { value: 'yolo' }] }] }
    const peer = { request: async (method: string) => {
      if (method === 'initialize') return { protocolVersion: 1 }
      if (method === 'session/new') return state
      if (method === 'session/prompt') { f.append(); return { stopReason: 'end_turn' } }
      return {}
    }, send: async () => {}, end: () => order.push('end'), close: async () => { order.push('close') } }
    await runNativeKimi(f.config, { ...f.io, event() {}, session() {}, result() { order.push('result') },
      native: (record: any) => { f.records.push(record); order.push(record.type) }, openStdio: async () => peer })
    expect(f.records.at(-1)?.scope).toBe('run')
    expect(order).toEqual(['cliworker.kimi_response_usage', 'cliworker.kimi_usage', 'result', 'end', 'close'])
  })
})

afterEach(() => recordSyntheticNativePrivacy('kimi'))
