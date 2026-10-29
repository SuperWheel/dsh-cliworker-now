import { afterEach, describe, expect, it, vi } from 'vitest'
import piPermissionGate, { PI_GATE_ENV, PI_GATE_TITLE, piGateAllowedTools, piToolCallFacts, preparePiPermissionGate,
  readPiGateConfirm, registerPiPermissionGate } from '../src/host/pi-permission-gate.mjs'

// Explicitly simulated Pi extension API; the real Pi bridge path is covered in pi-omp-adapter.test.ts.
const NONCE = 'a'.repeat(48)
const fakeApi = () => {
  const handlers: Array<(event: any, context: any) => Promise<any>> = []
  return { handlers, on: vi.fn((name: string, handler: any) => { if (name === 'tool_call') handlers.push(handler) }) }
}
const confirmOf = (facts: object, nonce = NONCE) => ({ method: 'confirm', title: `${PI_GATE_TITLE}${nonce}`, message: JSON.stringify(facts) })

afterEach(() => { delete process.env[PI_GATE_ENV] })

describe('Pi permission gate extension', () => {
  it('runs reads directly at 询问 and adds file edits at 自动批准编辑, keeping DSH fallback tools out of the gate', () => {
    expect(piGateAllowedTools('read-only')).toEqual(['read', 'grep', 'find', 'ls'])
    expect(piGateAllowedTools('workspace-write', ['dsh_fixture'])).toEqual(['read', 'grep', 'find', 'ls', 'write', 'edit', 'dsh_fixture'])
  })

  it('carries bounded facts and never file contents', () => {
    const facts = piToolCallFacts({ toolName: 'write', input: { path: 'SIMULATED.txt', content: '中文' } })
    expect(facts).toEqual({ tool: 'write', path: 'SIMULATED.txt', bytes: 6 })
    expect(JSON.stringify(facts)).not.toContain('中文')
    expect(piToolCallFacts({ toolName: 'edit', input: { path: 'a', edits: [{ oldText: 'SECRET', newText: 'x' }, {}] } }))
      .toEqual({ tool: 'edit', path: 'a', edits: 2 })
    expect(piToolCallFacts({ toolName: 'bash', input: { command: 'x'.repeat(5000) } }).command).toHaveLength(4000)
  })

  it('reads only its own confirm as an approval request', () => {
    expect(readPiGateConfirm(confirmOf({ tool: 'bash', command: 'pnpm test' }), NONCE))
      .toEqual({ kind: 'command', summary: '执行命令：pnpm test', allowSession: false })
    expect(readPiGateConfirm(confirmOf({ tool: 'powershell', command: 'dir' }), NONCE)).toMatchObject({ kind: 'command' })
    expect(readPiGateConfirm(confirmOf({ tool: 'edit', path: 'a.ts', edits: 2 }), NONCE))
      .toEqual({ kind: 'file', summary: '编辑文件：a.ts', detail: '2 处编辑', allowSession: false })
    expect(readPiGateConfirm(confirmOf({ tool: 'custom_tool' }), NONCE)).toMatchObject({ kind: 'tool', summary: '调用工具：custom_tool' })
    // Another extension's confirm, a stale nonce or a malformed message are not the gate's.
    expect(readPiGateConfirm(confirmOf({ tool: 'bash' }, 'b'.repeat(48)), NONCE)).toBeUndefined()
    expect(readPiGateConfirm({ ...confirmOf({ tool: 'bash' }), method: 'select' }, NONCE)).toBeUndefined()
    expect(readPiGateConfirm({ ...confirmOf({}), message: 'not json' }, NONCE)).toBeUndefined()
    expect(readPiGateConfirm(confirmOf({ tool: '' }), NONCE)).toBeUndefined()
    expect(readPiGateConfirm(confirmOf({ tool: 'bash' }), undefined)).toBeUndefined()
  })

  it('asks before any call outside the level, blocks unless approved, and reports ready after registering', async () => {
    const api = fakeApi(), emit = vi.fn(() => expect(api.on).toHaveBeenCalled())
    registerPiPermissionGate(api, { nonce: NONCE, allowed: ['read'] }, emit)
    expect(emit).toHaveBeenCalledWith({ type: 'cliworker.pi_permission_gate', nonce: NONCE, ready: true })
    const [handler] = api.handlers
    const confirm = vi.fn()
    expect(await handler({ toolName: 'read', input: { path: 'a' } }, { ui: { confirm } })).toBeUndefined()
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockResolvedValueOnce(true)
    expect(await handler({ toolName: 'write', input: { path: 'a', content: 'x' } }, { ui: { confirm } })).toBeUndefined()
    expect(confirm).toHaveBeenLastCalledWith(`${PI_GATE_TITLE}${NONCE}`, JSON.stringify({ tool: 'write', path: 'a', bytes: 1 }))
    for (const answer of [false, undefined]) {
      confirm.mockResolvedValueOnce(answer)
      expect(await handler({ toolName: 'bash', input: { command: 'rm x' } }, { ui: { confirm } }))
        .toMatchObject({ block: true, reason: expect.stringContaining('denied bash') })
    }
    // A broken relay rejects; Pi blocks a call whose handler fails.
    confirm.mockRejectedValueOnce(new Error('SIMULATED relay failure'))
    await expect(handler({ toolName: 'bash', input: { command: 'x' } }, { ui: { confirm } })).rejects.toThrow()
  })

  it('registers nothing and reports no ready record without a valid run config', () => {
    for (const config of [undefined, { nonce: NONCE, outputFd: 1, allowed: [] }, { nonce: 'short', outputFd: 3, allowed: [] },
      { nonce: NONCE, outputFd: 3, allowed: [1] }, { nonce: NONCE, outputFd: 3 }]) {
      if (config) process.env[PI_GATE_ENV] = JSON.stringify(config)
      else delete process.env[PI_GATE_ENV]
      const api = fakeApi()
      piPermissionGate(api)
      expect(api.on).not.toHaveBeenCalled()
    }
  })

  it('prepares no gate for an executable that is not a Pi install', async () => {
    expect(await preparePiPermissionGate('/nonexistent/SIMULATED/pi', 'read-only')).toBeUndefined()
  })
})
