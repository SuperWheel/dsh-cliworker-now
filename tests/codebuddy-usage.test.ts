import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codebuddyProjectKey, codebuddyUsagePaths, inspectCodebuddyDurableUsage, readCodebuddyDurableUsage, sameCodebuddyCwd } from '../src/host/codebuddy-durable-usage.mjs'
import { codebuddyUsageOnResult } from '../src/host/native-codebuddy.mjs'
import { extractTelemetry, TelemetryReader } from '../src/host/telemetry.ts'
import { creditBilledCli } from '../src/shared/telemetry.ts'
import { privateWindowsAcl } from '../src/host/native-file-privacy.mjs'
import { bridgedFeatureSupport } from '../src/shared/conversation-features.ts'

// All transcripts, sessions and credit figures below are SIMULATED; the row shape
// mirrors CodeBuddy 2.181 / WorkBuddy CLI 2.165 durable session files.
const SESSION = '01a1aaaa-0000-7000-8000-00000000000a', USER = '01a1aaaa-0000-7000-8000-0000000000u1', REQ = 'simreq0001'
const user = (id = USER, req = REQ, cwd = '/SIMULATED/project') => ({ id, type: 'message', role: 'user', sessionId: SESSION, cwd,
  providerData: { startsNewUserRequest: true, agent: 'cli', conversationRequestId: req } })
const request = (type: string, messageId: string, input: number, output: number, opts: { cached?: number; reasoning?: number; credit?: unknown; model?: string; req?: string; role?: string; status?: string } = {}) => ({
  id: `row-${messageId}-${type}`, type, ...(opts.role ? { role: opts.role } : {}), ...(opts.status ? { status: opts.status } : {}), sessionId: SESSION,
  providerData: { conversationRequestId: opts.req ?? REQ, messageId, requestModelId: opts.model ?? 'hy4free',
    usage: { requests: 1, inputTokens: input, outputTokens: output, totalTokens: input + output,
      inputTokensDetails: [{ cached_tokens: opts.cached ?? 0 }], outputTokensDetails: [{ reasoning_tokens: opts.reasoning ?? 0 }] },
    rawUsage: { credit: Object.hasOwn(opts, 'credit') ? opts.credit : 0 } },
})
const final = (messageId: string, input: number, output: number, opts: Parameters<typeof request>[4] = {}) =>
  request('message', messageId, input, output, { role: 'assistant', status: 'completed', ...opts })
const binding = { cli: 'codebuddy' as const, sessionId: SESSION, model: 'hy4free', userMessageId: USER, conversationRequestId: REQ, cwd: '/SIMULATED/project' }
const roots: string[] = []
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); vi.useRealTimers() })

describe('模拟：CodeBuddy 系原生会话文件的积分与用量', () => {
  it('sums one turn by native request, deduplicating parallel tool calls of the same request', () => {
    const records = [user(),
      request('function_call', 'm1', 100, 10, { cached: 40, reasoning: 4, credit: 0.25 }),
      request('function_call', 'm1', 100, 10, { cached: 40, reasoning: 4, credit: 0.25 }), // same request, second tool call
      request('function_call', 'm2', 120, 20, { cached: 100, credit: 0.5 }),
      final('m3', 130, 5, { cached: 120, credit: 0.25 }),
      user('next-user', 'simreq0002'), final('m9', 999, 9, { req: 'simreq0002', credit: 7 })]
    expect(inspectCodebuddyDurableUsage(records, binding)).toMatchObject({
      type: 'cliworker.codebuddy_usage', cli: 'codebuddy', source: 'codebuddy.native-transcript', requests: 3,
      usage: { inputTokens: 350, outputTokens: 35, totalTokens: 385, cachedReadTokens: 260, reasoningTokens: 4 }, providerCredits: 1,
    })
  })
  it('free-model zero credits are a real zero, not a missing value', () => {
    expect(inspectCodebuddyDurableUsage([user(), final('m1', 10, 2)], binding)?.providerCredits).toBe(0)
  })
  it('leaves credits unknown when any request lacks a credit figure or sub-agents ran', () => {
    const missing = inspectCodebuddyDurableUsage([user(), request('function_call', 'm1', 10, 1, { credit: undefined }), final('m2', 10, 1)], binding)
    expect(missing?.providerCredits).toBeUndefined()
    const sub = inspectCodebuddyDurableUsage([user(), final('m1', 10, 1, { credit: 2 })], { ...binding, subagentsActive: true })
    expect(sub).toMatchObject({ creditsIncomplete: 'subagents' }); expect(sub?.providerCredits).toBeUndefined()
  })
  it.each([
    ['unsettled turn (last request is a tool call)', [user(), request('function_call', 'm1', 10, 1)]],
    ['different model', [user(), final('m1', 10, 1, { model: 'other-model' })]],
    ['inconsistent totals', [user(), { ...final('m1', 10, 1), providerData: { ...final('m1', 10, 1).providerData, usage: { inputTokens: 10, outputTokens: 1, totalTokens: 99 } } }]],
    ['conflicting duplicate request', [user(), request('function_call', 'm1', 10, 1), request('function_call', 'm1', 11, 1), final('m2', 5, 1)]],
    ['foreign session row', [user(), { ...final('m1', 10, 1), sessionId: 'other-session' }]],
    ['wrong conversation request on the user row', [user(USER, 'other-req'), final('m1', 10, 1)]],
    ['wrong cwd', [user(USER, REQ, '/elsewhere'), final('m1', 10, 1)]],
  ])('rejects %s', (_name, records) => {
    expect(inspectCodebuddyDurableUsage(records as unknown[], binding)).toBeUndefined()
  })
  it('matches a Windows cwd recorded with a lowercase drive letter (CodeBuddy on Windows, 2026-11-09 shape)', () => {
    const win = { ...binding, cwd: 'C:\\Users\\sim\\live', platform: 'win32' }
    expect(inspectCodebuddyDurableUsage([user(USER, REQ, 'c:\\Users\\sim\\live'), final('m1', 10, 2)], win)?.providerCredits).toBe(0)
    expect(inspectCodebuddyDurableUsage([user(USER, REQ, 'c:\\Users\\sim\\other'), final('m1', 10, 2)], win)).toBeUndefined()
    expect(sameCodebuddyCwd('/Users/Sim/p', '/Users/sim/p', 'darwin')).toBe(false)
    expect(sameCodebuddyCwd('/Users/sim/p', '/Users/sim/p', 'darwin')).toBe(true)
  })
  it('accepts the Windows ACL shape of an Administrators-owned ~/.codebuddy only with a direct current-user full-control entry', () => {
    // SIMULATED SIDs; ACE layout mirrors the 2026-11-09 Windows projection (read-only extra group, inherited entries).
    const me = 'S-1-5-21-1-2-3-1001'
    const acl = (aces: { sid: string; mask: number; flags?: number }[]) => ({ owner: 'S-1-5-32-544', nullDacl: false, control: 33796,
      descriptor: 'SIMULATED', aces: aces.map(ace => ({ type: 0, flags: ace.flags ?? 16, sid: ace.sid, mask: ace.mask })) })
    const observed = acl([{ sid: 'S-1-5-21-9-9-9-2001', mask: 0x1200a9 }, { sid: 'S-1-5-18', mask: 0x1f01ff }, { sid: 'S-1-5-32-544', mask: 0x1f01ff }, { sid: me, mask: 0x1f01ff }])
    expect(privateWindowsAcl(observed, me, 0o022, true)).toBe(true)
    expect(privateWindowsAcl(observed, me, 0o022, false)).toBe(false)
    expect(privateWindowsAcl(acl([{ sid: 'S-1-5-18', mask: 0x1f01ff }, { sid: 'S-1-5-32-544', mask: 0x1f01ff }]), me, 0o022, true)).toBe(false)
    expect(privateWindowsAcl(acl([{ sid: 'S-1-5-21-9-9-9-2001', mask: 0x1f01ff }, { sid: me, mask: 0x1f01ff }]), me, 0o022, true)).toBe(false)
  })
  it('derives the native project folder name exactly like CodeBuddy', () => {
    expect(codebuddyProjectKey('/Users/sim/cw-acc-088')).toBe('Users-sim-cw-acc-088')
    expect(codebuddyProjectKey('/Users/sim/repo/.test-data/CLI Worker Demo')).toBe('Users-sim-repo-.test-data-CLI Worker Demo')
    expect(codebuddyProjectKey('C:\\Users\\sim\\proj')).toBe('C-Users-sim-proj')
    expect(codebuddyProjectKey('/private/tmp/a--b/')).toBe('private-tmp-a-b')
    const long = codebuddyProjectKey('/' + 'x'.repeat(300))
    expect(Buffer.byteLength(long)).toBeLessThanOrEqual(180 + 1 + 7)
    expect(long).toMatch(/^x{180}-[0-9a-z]+$/)
    expect(codebuddyUsagePaths({ cli: 'qoder' as never, home: '/h', project: '/p', sessionId: SESSION })).toEqual([])
  })
  it('reads the private native file under the CLI home, waiting for the final row to be flushed', async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'cb-SIMULATED-home-'))); roots.push(home)
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'cb-SIMULATED-project-'))); roots.push(project)
    const bucket = join(home, 'projects', codebuddyProjectKey(project)); mkdirSync(bucket, { recursive: true })
    const file = join(bucket, `${SESSION}.jsonl`)
    const rows = [user(USER, REQ, project), request('function_call', 'm1', 50, 5, { credit: 0.5 })]
    writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n', { mode: 0o644 })
    const config = { cli: 'codebuddy' as const, home, project, sessionId: SESSION, model: 'hy4free', userMessageId: USER, conversationRequestId: REQ }
    expect(await readCodebuddyDurableUsage(config, { attempts: 1 })).toBeUndefined() // not settled yet
    const late = setTimeout(() => writeFileSync(file, [...rows, final('m2', 60, 4, { credit: 0.25 })].map(row => JSON.stringify(row)).join('\n') + '\n'), 20)
    const observed = await readCodebuddyDurableUsage(config, { attempts: 5, delayMs: 30 })
    clearTimeout(late)
    expect(observed).toMatchObject({ providerCredits: 0.75, usage: { totalTokens: 119 } })
    chmodSync(file, 0o666) // writable by others: refused
    expect(await readCodebuddyDurableUsage(config, { attempts: 1 })).toBeUndefined()
  })
  it('the runner hook emits the native receipt only for a completed turn of the exact request', async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'cb-SIMULATED-home-'))); roots.push(home)
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'cb-SIMULATED-project-'))); roots.push(project)
    const bucket = join(home, 'projects', codebuddyProjectKey(project)); mkdirSync(bucket, { recursive: true })
    writeFileSync(join(bucket, `${SESSION}.jsonl`), [user(USER, REQ, project), final('m1', 10, 2, { credit: 0 })].map(row => JSON.stringify(row)).join('\n') + '\n')
    const native = vi.fn(), signal = new AbortController().signal
    const hook = codebuddyUsageOnResult({ cli: 'workbuddycn', project, preference: { model: 'hy4free' } }, home, Date.now())
    await hook({ stopReason: 'cancelled', userMessageId: USER, _meta: { 'codebuddy.ai/conversationRequestId': REQ } }, SESSION, { native, signal })
    expect(native).not.toHaveBeenCalled()
    await hook({ stopReason: 'end_turn', userMessageId: USER, _meta: { 'codebuddy.ai/conversationRequestId': REQ } }, SESSION, { native, signal })
    expect(native).toHaveBeenCalledWith(expect.objectContaining({ type: 'cliworker.codebuddy_usage', cli: 'workbuddycn', source: 'workbuddycn.native-transcript', providerCredits: 0 }))
  })
})

describe('模拟：积分计费 CLI 的呈现与来源隔离', () => {
  const observation = { type: 'cliworker.codebuddy_usage', cli: 'codebuddy', source: 'codebuddy.native-transcript', sessionId: SESSION,
    model: 'hy4free', userMessageId: USER, conversationRequestId: REQ, requests: 2,
    usage: { inputTokens: 30, outputTokens: 3, totalTokens: 33, cachedReadTokens: 10, reasoningTokens: 1 }, providerCredits: 1.5 }
  const identity = { conversationId: SESSION, model: 'hy4free' }
  it('CodeBuddy and WorkBuddy bill credits; TRAE CN keeps the default token display', () => {
    for (const cli of ['qoder', 'qodercn', 'codebuddy', 'workbuddycn', 'workbuddy']) expect(creditBilledCli(cli)).toBe(true)
    for (const cli of ['traecn', 'codex', 'claude', undefined]) expect(creditBilledCli(cli)).toBe(false)
  })
  it('shows credits from the native receipt and never relabels tokens as credits', () => {
    const data = extractTelemetry('codebuddy', [observation], identity)
    expect(data.providerCredits).toBe(1.5)
    expect(data.usage).toBeUndefined()
    expect(extractTelemetry('codebuddy', [{ ...observation, providerCredits: undefined }], identity).providerCredits).toBeUndefined()
    expect(extractTelemetry('codebuddy', [{ ...observation, creditsIncomplete: 'subagents' }], identity).providerCredits).toBeUndefined()
  })
  it.each([{ cli: 'workbuddycn' }, { source: 'workbuddycn.native-transcript' }, { sessionId: 'other' }, { model: 'other' }])('rejects crossed receipt %j', override => {
    expect(extractTelemetry('codebuddy', [{ ...observation, ...override }], identity).providerCredits).toBeUndefined()
  })
  it('attributes a WorkBuddy receipt only to its own edition, and reads WorkBuddy context usage', () => {
    const wb = { ...observation, cli: 'workbuddycn', source: 'workbuddycn.native-transcript' }
    expect(extractTelemetry('workbuddycn', [wb], identity).providerCredits).toBe(1.5)
    expect(extractTelemetry('workbuddy', [wb], identity).providerCredits).toBeUndefined()
    const context = { method: 'session/update', params: { sessionId: SESSION, update: { sessionUpdate: 'usage_update', used: 2800, size: 300000 } } }
    expect(extractTelemetry('workbuddycn', [context], identity)).toMatchObject({ contextUsed: 2800, contextCapacity: 300000, contextSource: 'WorkBuddy CN 原生会话上下文统计' })
  })
  it('keeps only whitelisted fields through a disk telemetry read', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'cb-SIMULATED-telemetry-'))); roots.push(root)
    const path = join(root, 'native.jsonl')
    writeFileSync(path, JSON.stringify({ type: 'native', record: { ...observation, prompt: 'SIMULATED-secret' } }) + '\n')
    const data = new TelemetryReader().read(path, 'codebuddy', identity)
    expect(data.providerCredits).toBe(1.5)
    expect(JSON.stringify(data)).not.toContain('SIMULATED-secret')
  })
})

describe('模拟：CodeBuddy 系分支能力如实声明', () => {
  it.each([['codebuddy', 'codebuddy-acp-v1', 'Method not found'], ['workbuddycn', 'workbuddycn-acp-v1', '没有实现 session/fork'], ['workbuddy', 'workbuddy-acp-v1', '没有实现 session/fork']] as const)(
    '%s explains why it cannot fork', (cli, transport, reason) => {
      const support = bridgedFeatureSupport({ preference: { cli, model: 'hy4free', effort: 'default' }, transport })
      expect(support.fork.supported).toBe(false)
      expect(support.fork.reason).toContain('当前 CLI 不支持会话分支')
      expect(support.fork.reason).toContain(reason)
    })
  it('TRAE CN keeps its confirmed native fork', () => {
    expect(bridgedFeatureSupport({ preference: { cli: 'traecn', model: 'glm-5.3-flash', effort: 'default' }, transport: 'traecn-acp-v1' }).fork.supported).toBe(true)
  })
})
