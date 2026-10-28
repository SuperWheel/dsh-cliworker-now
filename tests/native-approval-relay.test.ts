import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  approvalDecisionText,
  approvalQuestion,
  decideApproval,
  decisionFromAnswer,
  decisionFromOutcome,
  parseNativeApprovalRequest,
  runAccess,
  type NativeAccess,
  type PermissionState,
} from '../src/host/native-approval-policy.ts'
import { createNativeIO } from '../src/host/native-transport.mjs'
import { createNativeApprovalControl, receiveNativeApprovalControl } from '../src/host/pi-omp-control.mjs'
import { BridgeProtocol } from '../src/host/bridge-protocol.ts'
import { WorkerRuntime } from '../src/host/runtime.ts'
import { workerArguments } from '../src/host/adapters.ts'
import { claudePermissionMode } from '../src/host/native-claude.mjs'
import { grokAcpArgv } from '../src/host/native-grok.mjs'

// Synthetic fixtures only: no CLI process, model or DSH Desktop is involved.
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})
const presets: Record<string, PermissionState> = {
  'read-only': { planMode: false, sandbox: 'read-only', approval: 'ask' },
  'workspace-write': { planMode: false, sandbox: 'workspace-write', approval: 'ask' },
  'danger-full-access': { planMode: false, sandbox: 'danger-full-access', approval: 'never' },
}
const request = { kind: 'network', summary: '访问 registry.npmjs.org 安装依赖', allowSession: true } as const

describe('permission tier and decisions follow the DSH preset', () => {
  it.each(Object.entries(presets))('%s: tier is never wider than the parent', (name, state) => {
    expect(runAccess('accept-edits', state)).toBe(name as NativeAccess)
    expect(runAccess('plan', state)).toBe('read-only')
    expect(runAccess('accept-edits', { ...state, planMode: true })).toBe('read-only')
  })
  it('asks under 仅可查看 and 工作区内修改, auto-allows the residue under 完全权限', () => {
    expect(decideApproval('accept-edits', presets['read-only']!)).toBe('ask')
    expect(decideApproval('accept-edits', presets['workspace-write']!)).toBe('ask')
    expect(decideApproval('accept-edits', presets['danger-full-access']!)).toEqual({
      decision: 'allow-once',
      source: 'full-access',
    })
  })
  it.each(Object.entries(presets))('plan mode denies first under %s, without a prompt', (_name, state) => {
    expect(decideApproval('plan', state)).toEqual({ decision: 'deny', source: 'plan' })
    expect(decideApproval('accept-edits', { ...state, planMode: true })).toEqual({ decision: 'deny', source: 'plan' })
  })
  it('a confined custom policy with prompts disabled denies by preset', () => {
    expect(decideApproval('accept-edits', { planMode: false, sandbox: 'workspace-write', approval: 'never' })).toEqual({
      decision: 'deny',
      source: 'preset',
    })
  })
  it('each request reads the state current when it arrives (preset switched mid-run)', () => {
    const state = { ...presets['danger-full-access']! }
    expect(decideApproval('accept-edits', state)).toMatchObject({ decision: 'allow-once' })
    Object.assign(state, presets['workspace-write'])
    expect(decideApproval('accept-edits', state)).toBe('ask')
  })
})

describe('answers map to native decisions; anything else is a denial', () => {
  it('offers a session grant only when the CLI natively has one', () => {
    const context = { worker: 'Alice', cli: 'Codex', project: '/repo' }
    expect(approvalQuestion(request, context).options.map((o) => o.label)).toEqual(['允许一次', '本会话始终允许', '拒绝'])
    expect(approvalQuestion({ ...request, allowSession: false }, context).options.map((o) => o.label)).toEqual([
      '允许一次',
      '拒绝',
    ])
    const text = approvalQuestion(request, context).question
    expect(text).toContain('Alice（Codex）')
    expect(text).toContain('registry.npmjs.org')
    expect(text).toContain('工作目录：/repo')
  })
  it.each([
    [{ selected: ['允许一次'] }, 'allow-once'],
    [{ selected: ['本会话始终允许'] }, 'allow-session'],
    [{ selected: ['拒绝'] }, 'deny'],
    [{ selected: ['允许一次'], custom: '先别装' }, 'deny'],
    [{ selected: [] }, 'deny'],
    [undefined, 'deny'],
  ] as const)('question answer %j → %s', (answer, decision) => {
    expect(decisionFromAnswer(request, answer as never)).toEqual({ decision, source: 'user' })
  })
  it('never grants a session the CLI did not offer', () => {
    expect(decisionFromAnswer({ ...request, allowSession: false }, { selected: ['本会话始终允许'] })).toEqual({
      decision: 'deny',
      source: 'user',
    })
  })
  it.each([
    ['allowed-once', { decision: 'allow-once', source: 'user' }],
    ['rejected', { decision: 'deny', source: 'user' }],
    ['cancelled', { decision: 'deny', source: 'stopped' }],
    ['unavailable', { decision: 'deny', source: 'unavailable' }],
  ] as const)('native panel outcome %s', (outcome, expected) => {
    expect(decisionFromOutcome(outcome)).toEqual(expected)
  })
  it('records the decision and its source', () => {
    expect(approvalDecisionText({ decision: 'allow-once', source: 'full-access' })).toBe('授权决定：允许一次（完全权限自动放行）')
    expect(approvalDecisionText({ decision: 'deny', source: 'unavailable' })).toBe('授权决定：拒绝（无人应答）')
  })
})

describe('runner ↔ Host approval channel', () => {
  const directory = () => {
    const path = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-approval-')))
    cleanups.push(() => rmSync(path, { recursive: true, force: true }))
    return path
  }
  const io = (config: Record<string, unknown>, signal = new AbortController().signal) => {
    const frames: any[] = []
    const value = createNativeIO(
      { project: process.cwd(), maxLineBytes: 8192, maxRunBytes: 65536, ...config },
      (line: string) => frames.push(JSON.parse(line)),
      signal,
    )
    return { io: value, frames }
  }
  it('keeps the historical denial when the run has no Host relay', async () => {
    const { io: native, frames } = io({})
    await expect(native.approval(request)).resolves.toEqual({ decision: 'deny', source: 'unavailable' })
    expect(frames).toEqual([])
  })
  it('publishes a bounded request and settles with the Host decision exactly once', async () => {
    const { io: native, frames } = io({ approvalNonce: 'n' })
    const pending = native.approval({ ...request, detail: 'x'.repeat(5000), env: { SECRET: 'no' } })
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ type: 'approval', id: 'approval-1', request: { kind: 'network', allowSession: true } })
    expect(frames[0].request.detail).toHaveLength(4000)
    expect(frames[0].request).not.toHaveProperty('env')
    await native.answerApproval(JSON.stringify({ decision: 'allow-session', source: 'user' }), 'approval-1')
    await expect(pending).resolves.toEqual({ decision: 'allow-session', source: 'user' })
    await expect(native.answerApproval(JSON.stringify({ decision: 'deny', source: 'user' }), 'approval-1')).rejects.toThrow()
  })
  it('treats a malformed Host answer as a denial', async () => {
    const { io: native } = io({ approvalNonce: 'n' })
    const pending = native.approval(request)
    await native.answerApproval(JSON.stringify({ decision: 'yes' }), 'approval-1')
    await expect(pending).resolves.toEqual({ decision: 'deny', source: 'invalid' })
  })
  it('denies a pending request when the run stops or the bridge closes', async () => {
    const controller = new AbortController()
    const { io: native } = io({ approvalNonce: 'n' }, controller.signal)
    const stopped = native.approval(request)
    controller.abort()
    await expect(stopped).resolves.toEqual({ decision: 'deny', source: 'stopped' })
    const { io: other } = io({ approvalNonce: 'n' })
    const closing = other.approval(request)
    await other.close(new Error('synthetic end'))
    await expect(closing).resolves.toEqual({ decision: 'deny', source: 'stopped' })
  })
  it('carries the decision through the run-private mailbox', async () => {
    const root = directory()
    const control = await createNativeApprovalControl(join(root, 'approval'))
    const { io: native } = io({ approvalNonce: control.nonce })
    const receiver = await receiveNativeApprovalControl(join(root, 'approval'), control.nonce, (message, id) =>
      native.answerApproval(message, id),
    )
    cleanups.push(async () => {
      await receiver.close()
      await control.close()
    })
    const pending = native.approval(request)
    await control.steer(JSON.stringify({ decision: 'allow-once', source: 'user' }), 'approval-1')
    await expect(pending).resolves.toEqual({ decision: 'allow-once', source: 'user' })
    // A decision for an unknown or settled request is refused, never applied elsewhere.
    await expect(control.steer(JSON.stringify({ decision: 'allow-once', source: 'user' }), 'approval-9')).rejects.toThrow()
  })
  it('Host framing relays only well-formed approval frames', () => {
    const seen: unknown[] = []
    const protocol = new BridgeProtocol(() => {}, () => {}, 8192, (id, value) => seen.push([id, value]))
    protocol.feed(JSON.stringify({ type: 'approval', id: 'approval-1', request }) + '\n')
    expect(seen).toEqual([['approval-1', request]])
    expect(() => protocol.feed(JSON.stringify({ type: 'approval', id: '../x', request }) + '\n')).toThrow()
    expect(() => parseNativeApprovalRequest({ kind: 'shell', summary: 'x', allowSession: false })).toThrow()
  })
})

describe('Host relay answers every request and records it', () => {
  // Synthetic runtime shell: only the members relayApproval touches.
  const relay = (handler?: (...args: any[]) => Promise<any>) => {
    const events: any[] = []
    const shell = {
      storage: { append: (_worker: unknown, event: unknown) => events.push(event) },
      changed: () => {},
      approvalHandler: handler,
    }
    const worker: any = { id: 'w', runId: 'run-1' }
    const controller = new AbortController()
    const answers: any[] = []
    let failAnswer = false
    const run = (answer = (decision: unknown) => (failAnswer ? Promise.reject(new Error('closed')) : (answers.push(decision), Promise.resolve()))) =>
      (WorkerRuntime.prototype as any).relayApproval.call(shell, { worker, controller }, request, answer)
    return { events, worker, controller, answers, run, failNext: () => (failAnswer = true) }
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  it('records the request, waits visibly, then records and sends the decision', async () => {
    let release!: (value: unknown) => void
    const f = relay(() => new Promise((resolve) => (release = resolve)))
    f.run()
    expect(f.events[0]).toMatchObject({ kind: 'status', text: expect.stringContaining('registry.npmjs.org') })
    expect(f.worker.approvalWaiting).toBe(1)
    release({ decision: 'allow-once', source: 'user' })
    await settle()
    expect(f.worker.approvalWaiting).toBeUndefined()
    expect(f.events.at(-1)).toMatchObject({ text: '授权决定：允许一次（DSH 用户）' })
    expect(f.answers).toEqual([{ decision: 'allow-once', source: 'user' }])
  })
  it('denies without a Host handler or when the handler fails', async () => {
    const none = relay()
    none.run()
    await settle()
    expect(none.answers).toEqual([{ decision: 'deny', source: 'unavailable' }])
    const broken = relay(async () => {
      throw new Error('NO_PROVIDER')
    })
    broken.run()
    await settle()
    expect(broken.answers).toEqual([{ decision: 'deny', source: 'unavailable' }])
  })
  it('a stop or a newer run turns a late approval into a denial', async () => {
    let release!: (value: unknown) => void
    const f = relay(() => new Promise((resolve) => (release = resolve)))
    f.run()
    f.controller.abort()
    release({ decision: 'allow-once', source: 'user' })
    await settle()
    expect(f.answers).toEqual([{ decision: 'deny', source: 'stopped' }])
    const g = relay(() => new Promise((resolve) => (release = resolve)))
    g.run()
    g.worker.runId = 'run-2'
    release({ decision: 'allow-once', source: 'user' })
    await settle()
    expect(g.answers).toEqual([{ decision: 'deny', source: 'stopped' }])
    // The newer run's timeline does not receive the old decision.
    expect(g.events.some((event) => String(event.text).startsWith('授权决定'))).toBe(false)
  })
  it('records an undelivered decision; the runner denies on its own', async () => {
    const f = relay(async () => ({ decision: 'allow-once', source: 'user' }))
    f.failNext()
    f.run()
    await settle()
    await settle()
    expect(f.events.at(-1)).toMatchObject({ kind: 'diagnostic', text: '授权决定未送达 CLI，CLI 按拒绝处理' })
  })
})

describe('each CLI launches no wider than the DSH tier (argument mapping, no process)', () => {
  const tiers: NativeAccess[] = ['read-only', 'workspace-write', 'danger-full-access']
  // The runtime launches 仅可查看 as the CLI's native plan mode (runAccess → plan).
  const launch = (access: NativeAccess) => (access === 'read-only' ? 'plan' : 'accept-edits') as 'plan' | 'accept-edits'
  const value = (argv: string[], flag: string) => argv[argv.indexOf(flag) + 1]
  it.each(tiers)('Codex exec %s', (access) => {
    const argv = workerArguments('codex', '/p', { cli: 'codex', model: 'm', effort: 'high' }, launch(access), 'x', 1, undefined, false, access)
    expect(argv).toContain(`sandbox_mode=${JSON.stringify(access)}`)
    expect(argv).toContain(`approval_policy=${JSON.stringify(access === 'workspace-write' ? 'on-request' : 'never')}`)
  })
  it.each([
    ['read-only', 'plan'],
    ['workspace-write', 'acceptEdits'],
    ['danger-full-access', 'bypassPermissions'],
  ] as const)('Claude Code %s → --permission-mode %s', (access, mode) => {
    const argv = workerArguments('claude', '/p', { cli: 'claude', model: 'm', effort: 'default' }, launch(access), 'x', 1, undefined, true, access)
    expect(value(argv, '--permission-mode')).toBe(mode)
    expect(claudePermissionMode({ mode: launch(access), access })).toBe(mode)
  })
  it.each([
    ['workspace-write', 'accept_edits', 'acceptEdits'],
    ['danger-full-access', 'bypass_permissions', 'yolo'],
  ] as const)('Qoder %s → CLI %s / ACP %s', (access, flag, _acp) => {
    const argv = workerArguments('qoder', '/p', { cli: 'qoder', model: 'm', effort: 'high' }, 'accept-edits', 'x', 1, undefined, true, access)
    expect(value(argv, '--permission-mode')).toBe(flag)
  })
  it.each([
    ['read-only', ['agent', '--no-leader', 'stdio']],
    ['workspace-write', ['--permission-mode', 'acceptEdits', 'agent', '--no-leader', 'stdio']],
    ['danger-full-access', ['--permission-mode', 'acceptEdits', 'agent', '--always-approve', '--no-leader', 'stdio']],
  ] as const)('Grok %s', (access, tail) => {
    const argv = grokAcpArgv({ argv: ['grok', '--permission-mode', 'default', '--single', 'x'], mode: launch(access), access })
    expect(argv).toEqual(['grok', ...tail])
  })
})
