import { describe, expect, it, vi } from 'vitest'
import { PassThrough, Writable } from 'node:stream'
import { createHash } from 'node:crypto'
import { readCodexAccount, readCodexAccountBinding } from '../src/host/codex-account.ts'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
import type { SubprocessOutcome, SubprocessHandle } from '@deepseek-ai/dsh-subprocess'

// A synthetic app-server; never reads local auth files or invokes a real CLI.
function fixture(account: unknown, options: {
  error?: boolean; oversized?: boolean; stall?: boolean
  authStatus?: unknown; authError?: boolean; authStall?: boolean; authOversized?: boolean
} = {}) {
  const output = new PassThrough(),
    errors = new PassThrough()
  const messages: any[] = []
  let finish!: (outcome: SubprocessOutcome) => void
  const done = new Promise<SubprocessOutcome>((resolve) => {
    finish = resolve
  })
  const child: SubprocessHandle = {
    stdin: new Writable({
      write(chunk, _encoding, callback) {
        const message = JSON.parse(String(chunk))
        messages.push(message)
        callback()
        if (message.method === 'initialize') output.write(JSON.stringify({ id: 1, result: {} }) + '\n')
        if (message.method === 'account/read' && !options.stall) {
          if (options.oversized) output.write('SECRET'.repeat(12_000))
          else
            output.write(
              JSON.stringify(
                options.error
                  ? { id: 2, error: { message: 'SECRET' } }
                  : { id: 2, result: { account, requiresOpenaiAuth: true } },
              ) + '\n',
            )
        }
        if (message.method === 'getAuthStatus' && !options.authStall) {
          if (options.authOversized) output.write('SECRET'.repeat(12_000))
          else output.write(JSON.stringify(options.authError
            ? { id: 3, error: { message: 'SECRET' } }
            : { id: 3, result: options.authStatus ?? { authMethod: 'apikey', authToken: 'synthetic-native-api' } }) + '\n')
        }
      },
    }),
    stdout: output,
    stderr: errors,
    control: undefined,
    collected: {},
    done,
    terminate: vi.fn(() => {
      output.end()
      errors.end()
      finish({ exitCode: 0, signal: null })
    }),
    waitForExit: vi.fn(async () => true),
  }
  const backend: ProcessBackend = { resolveExecutable: vi.fn(), spawn: vi.fn(() => child) }
  return {
    backend,
    messages,
    child,
    binding: (signal = new AbortController().signal) =>
      readCodexAccountBinding(backend, DEFAULT_CONFIG, '/synthetic/codex', '/synthetic/project', signal),
    run: (signal = new AbortController().signal) =>
      readCodexAccount(backend, DEFAULT_CONFIG, '/synthetic/codex', '/synthetic/project', signal),
  }
}

describe('Codex effective-account read-only handshake', () => {
  it('模拟：Codex native OAuth projects email and workspace name without requesting tokens', async () => {
    const f = fixture({ type: 'chatgpt', email: 'current@example.com', workspaceName: 'Workspace A', accountId: 'unreported-id', access_token: 'SECRET' })
    expect(await f.binding()).toEqual({
      identity: { state: 'authenticated', summary: '已通过 ChatGPT 登录', authMethod: 'oauth', accountLabel: 'current@example.com', verification: 'cli' },
      workspaceName: 'Workspace A',
    })
    expect(f.messages.map(message => message.method)).toEqual(['initialize', 'initialized', 'account/read'])
  })

  it('模拟：Codex native API binding hashes only the effective native key and never refreshes', async () => {
    const f = fixture({ type: 'apiKey', key: 'ignored-SECRET' })
    const result = await f.binding()
    expect(result?.apiKeyHash).toBe(createHash('sha256').update('synthetic-native-api').digest('hex'))
    expect(JSON.stringify(result)).not.toMatch(/synthetic-native-api|SECRET/)
    expect(f.messages.map(message => message.method)).toEqual(['initialize', 'initialized', 'account/read', 'getAuthStatus'])
    expect(f.messages[3].params).toEqual({ includeToken: true, refreshToken: false })
    expect(f.child.terminate).toHaveBeenCalledOnce()
    expect(f.child.waitForExit).toHaveBeenCalledOnce()
    const status = fixture({ type: 'apiKey' })
    expect(await status.run()).not.toHaveProperty('apiKeyHash')
    expect(status.messages.some(message => message.method === 'getAuthStatus')).toBe(false)
  })

  it.each([
    { authError: true }, { authOversized: true },
    { authStatus: { authMethod: 'chatgpt', authToken: 'synthetic-native-api' } },
    { authStatus: { authMethod: 'apikey', authToken: null } },
    { authStatus: { authMethod: 'apikey', authToken: 'placeholder-key' } },
    { authStatus: { authMethod: 'apikey', authToken: 'unsafe\nkey' } },
  ])('模拟：Codex API binding rejects unavailable or invalid native credentials: %j', async options => {
    const f = fixture({ type: 'apiKey' }, options)
    expect(await f.binding()).toBeUndefined()
    expect(f.child.terminate).toHaveBeenCalledOnce()
    expect(f.child.waitForExit).toHaveBeenCalledOnce()
  })

  it('模拟：Codex cancels stalled native key retrieval and waits for cleanup', async () => {
    const f = fixture({ type: 'apiKey' }, { authStall: true })
    const control = new AbortController()
    const result = f.binding(control.signal)
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(f.messages.at(-1).method).toBe('getAuthStatus')
    control.abort()
    await expect(result).rejects.toThrow()
    expect(f.child.terminate).toHaveBeenCalledOnce()
    expect(f.child.waitForExit).toHaveBeenCalledOnce()
  })

  it('gets current account through Codex and never asks for a task, login, or token refresh', async () => {
    const f = fixture({
      type: 'chatgpt',
      email: 'current@example.com',
      planType: 'plus',
      access_token: 'SECRET',
    })
    expect(await f.run()).toMatchObject({
      state: 'authenticated',
      authMethod: 'oauth',
      accountLabel: 'current@example.com',
      verification: 'cli',
    })
    expect(f.messages.map((message) => message.method)).toEqual(['initialize', 'initialized', 'account/read'])
    expect(f.messages[0].params.capabilities.explicitGatewayOauth).toBe(true)
    expect(f.messages[2].params).toEqual({ refreshToken: false })
    expect(vi.mocked(f.backend.spawn).mock.calls[0]![0].argv).toEqual([
      '/synthetic/codex',
      'app-server',
      '--stdio',
    ])
    expect(f.child.terminate).toHaveBeenCalledOnce()
    expect(f.child.waitForExit).toHaveBeenCalledOnce()
  })

  it('does not expose API account metadata or any raw credential-shaped fields', async () => {
    const f = fixture({ type: 'apiKey', email: 'old@example.com', key: 'sk-SECRET' })
    const result = await f.run()
    expect(result).toMatchObject({ state: 'authenticated', authMethod: 'api', summary: 'API 登录' })
    expect(result?.accountLabel).toBeUndefined()
    expect(JSON.stringify(result)).not.toMatch(/SECRET|old@example/)
  })

  it('reports logout from the effective store rather than any stale local identity', async () => {
    expect(await fixture(null).run()).toMatchObject({ state: 'unconfigured', verification: 'cli' })
  })

  it.each([{ error: true }, { oversized: true }])(
    'unsupported/error/oversized results safely omit identity: %j',
    async (options) => {
      const f = fixture({ type: 'chatgpt', email: 'old@example.com' }, options)
      expect(await f.run()).toBeUndefined()
      expect(f.child.terminate).toHaveBeenCalledOnce()
      expect(f.child.waitForExit).toHaveBeenCalledOnce()
    },
  )

  it('rejects unsafe email fields without losing confirmed login state', async () => {
    const value = await fixture({ type: 'chatgpt', email: 'sk-SECRET@example.com' }).run()
    expect(value?.state).toBe('authenticated')
    expect(value?.accountLabel).toBeUndefined()
    expect(JSON.stringify(value)).not.toContain('SECRET')
  })

  it('cancels a stalled server and waits for cleanup', async () => {
    const f = fixture(null, { stall: true }),
      control = new AbortController()
    const result = f.run(control.signal)
    await new Promise<void>((resolve) => setImmediate(resolve))
    control.abort()
    await expect(result).rejects.toThrow()
    expect(f.child.terminate).toHaveBeenCalledOnce()
    expect(f.child.waitForExit).toHaveBeenCalledOnce()
  })

  it.each(['false', 'throw'])('does not conceal unconfirmed process cleanup: %s', async (failure) => {
    const f = fixture({ type: 'chatgpt', email: 'current@example.com' })
    if (failure === 'false') vi.mocked(f.child.waitForExit).mockResolvedValue(false)
    else vi.mocked(f.child.waitForExit).mockRejectedValue(new Error('synthetic cleanup failure'))
    await expect(f.run()).rejects.toMatchObject({ name: 'ProcessCleanupUnconfirmedError' })
  })
})
