import { afterEach, describe, expect, it, vi } from 'vitest'
import { PassThrough, Writable } from 'node:stream'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
import { discoverCodexModels, readCodexNativeModels } from '../src/host/codex-models.ts'
import { readCodexCustomRouteVersion, readCodexOwnAccountSource } from '../src/host/cli-account-binding.ts'
import { probeAccountModels } from '../src/host/account-models.mjs'

vi.mock('../src/host/cli-account-binding.ts', () => ({
  readCodexOwnAccountSource: vi.fn(),
  readCodexCustomRouteVersion: vi.fn(),
}))
vi.mock('../src/host/account-models.mjs', () => ({ probeAccountModels: vi.fn() }))
afterEach(() => vi.resetAllMocks())
// Synthetic app-server and account service: never read native auth or contact a server.
const entry = (model: string, extra: Record<string, unknown> = {}) => ({
  model,
  displayName: model,
  hidden: false,
  supportedReasoningEfforts: [
    { reasoningEffort: 'low' },
    { reasoningEffort: 'high' },
    { reasoningEffort: 'invented' },
  ],
  ...extra,
})
function fixture(
  pages: unknown[][],
  options: { stall?: boolean; cleanup?: boolean; repeated?: boolean; userAgent?: string } = {},
) {
  const stdout = new PassThrough(),
    stderr = new PassThrough(),
    messages: any[] = []
  let finish!: (result: SubprocessOutcome) => void,
    page = 0
  const done = new Promise<SubprocessOutcome>((resolve) => {
    finish = resolve
  })
  const child: SubprocessHandle = {
    stdin: new Writable({
      write(chunk, _encoding, callback) {
        const message = JSON.parse(String(chunk))
        messages.push(message)
        callback()
        if (options.stall) return
        if (message.method === 'initialize')
          stdout.write(JSON.stringify({ id: message.id, result: { userAgent: options.userAgent ?? 'cli_worker_models/0.162.1 (synthetic)' } }) + '\n')
        if (message.method === 'model/list') {
          stdout.write(
            JSON.stringify({
              id: message.id,
              result: {
                data: pages[page++] ?? [],
                nextCursor: options.repeated ? 'repeat' : page < pages.length ? `cursor-${page}` : null,
              },
            }) + '\n',
          )
        }
      },
    }),
    stdout,
    stderr,
    done,
    control: undefined,
    collected: {},
    terminate: vi.fn(() => {
      stdout.end()
      stderr.end()
      finish({ exitCode: 0, signal: null })
    }),
    waitForExit: vi.fn(async () => options.cleanup !== false),
  }
  const backend: ProcessBackend = { resolveExecutable: vi.fn(), spawn: vi.fn(() => child) }
  return {
    backend,
    child,
    messages,
    run: (signal = new AbortController().signal) =>
      readCodexNativeModels(backend, DEFAULT_CONFIG, '/synthetic/codex', '/synthetic', signal),
  }
}
describe('Codex native capability intersection', () => {
  it('lists Codex\'s own models for a relay route without any account query', async () => {
    const f = fixture([[entry('relay-listed')]])
    vi.mocked(readCodexCustomRouteVersion).mockResolvedValue('synthetic-route-v1')
    const models = await discoverCodexModels(f.backend, DEFAULT_CONFIG, '/synthetic/codex', '/synthetic', new AbortController().signal)
    expect(models).toEqual([{ id: 'relay-listed', label: 'relay-listed', efforts: ['low', 'high'], cost: 'unknown' }])
    expect(readCodexOwnAccountSource).not.toHaveBeenCalled()
    expect(probeAccountModels).not.toHaveBeenCalled()
  })
  it('fails a relay listing when the route changes while it is read', async () => {
    const f = fixture([[entry('relay-listed')]])
    vi.mocked(readCodexCustomRouteVersion).mockResolvedValueOnce('synthetic-route-v1').mockResolvedValueOnce('synthetic-route-v2')
    await expect(
      discoverCodexModels(f.backend, DEFAULT_CONFIG, '/synthetic/codex', '/synthetic', new AbortController().signal),
    ).rejects.toThrow('Codex 路由配置已变化，请刷新')
  })
  it('pages native metadata, keeps promoted models and rejects hidden and unsupported effort candidates', async () => {
    const f = fixture([
      [entry('allowed'), entry('hidden', { hidden: true })],
      [entry('promoted', { availabilityNux: { message: 'Try the new model' } }), entry('other')],
    ])
    expect(await f.run()).toEqual(
      ['allowed', 'promoted', 'other'].map((id) => ({ id, label: id, efforts: ['low', 'high'] })),
    )
    expect(f.messages.map((value) => value.method)).toEqual([
      'initialize',
      'initialized',
      'model/list',
      'model/list',
    ])
    expect(f.messages[3].params.cursor).toBe('cursor-1')
    expect(f.child.terminate).toHaveBeenCalledOnce()
    expect(f.child.waitForExit).toHaveBeenCalledOnce()
  })
  it('does not trust the native metadata or old cache without current account permissions', async () => {
    const f = fixture([[entry('allowed'), entry('not-entitled')]])
    const token = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.synthetic`
    vi.mocked(readCodexOwnAccountSource).mockResolvedValue({
      provider: 'openai-codex',
      credential: { type: 'oauth', access: token, accountId: 'synthetic-account' },
      sourceIds: ['/synthetic/codex'],
      nativeRouteConfirmed: true,
      baseUrl: 'https://chatgpt.com/backend-api',
    } as any)
    vi.mocked(probeAccountModels).mockResolvedValue({
      state: 'supported',
      source: 'account-models',
      models: [
        { id: 'allowed', cost: 'unknown' },
        { id: 'server-only', cost: 'unknown' },
      ],
    })
    expect(
      await discoverCodexModels(
        f.backend,
        DEFAULT_CONFIG,
        '/synthetic/codex',
        '/synthetic',
        new AbortController().signal,
      ),
    ).toEqual([{ id: 'allowed', label: 'allowed', efforts: ['low', 'high'] }])
    expect(probeAccountModels).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai-codex',
        credential: expect.objectContaining({ accountId: 'synthetic-account' }),
      }),
      expect.anything(),
    )
  })
  it('uses the actual server version and current remote capabilities when the native catalog is stale', async () => {
    const f = fixture([[entry('gpt-5.6-sol')]])
    vi.mocked(readCodexOwnAccountSource).mockResolvedValue({
      provider: 'openai-codex', credential: { type: 'oauth', access: 'synthetic-token' },
      nativeRouteConfirmed: true, baseUrl: 'https://chatgpt.com/backend-api',
    } as any)
    vi.mocked(probeAccountModels).mockResolvedValue({
      state: 'supported', source: 'account-models', models: [
        { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', cost: 'paid', reasoningEfforts: ['low', 'high', 'max', 'invented'] },
        { id: 'remote-id-without-capabilities', cost: 'unknown' },
      ],
    })
    expect(await discoverCodexModels(f.backend, DEFAULT_CONFIG, '/synthetic/codex', '/synthetic', new AbortController().signal))
      .toEqual([{ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', efforts: ['low', 'high', 'max'], cost: 'paid' }])
    expect(probeAccountModels).toHaveBeenCalledWith(expect.objectContaining({ codexClientVersion: '0.162.1' }), expect.anything())
    expect(f.messages.some((message) => /thread|turn/.test(message.method))).toBe(false)
  })
  it('does not guess a Codex query version when the native handshake is unsupported', async () => {
    const f = fixture([[entry('cached')]], { userAgent: 'unsupported-server' })
    vi.mocked(readCodexOwnAccountSource).mockResolvedValue({
      provider: 'openai-codex', credential: { type: 'oauth', access: 'synthetic-token' },
      nativeRouteConfirmed: true, baseUrl: 'https://chatgpt.com/backend-api',
    } as any)
    await expect(discoverCodexModels(f.backend, DEFAULT_CONFIG, '/synthetic/codex', '/synthetic', new AbortController().signal))
      .rejects.toThrow('版本无法确认')
    expect(probeAccountModels).not.toHaveBeenCalled()
    expect(f.child.waitForExit).toHaveBeenCalledOnce()
  })
  it('unknown/denied account scope never exposes native or cached choices', async () => {
    const f = fixture([[entry('public')]])
    vi.mocked(readCodexOwnAccountSource).mockResolvedValue({
      provider: 'openai-codex',
      credential: { type: 'oauth', access: 'opaque' },
      sourceIds: ['/synthetic'],
      nativeRouteConfirmed: true,
      baseUrl: 'https://chatgpt.com/backend-api',
    } as any)
    vi.mocked(probeAccountModels).mockResolvedValue({ state: 'denied', source: 'unknown', models: [] })
    expect(
      await discoverCodexModels(
        f.backend,
        DEFAULT_CONFIG,
        '/synthetic/codex',
        '/synthetic',
        new AbortController().signal,
      ),
    ).toEqual([])
    expect(f.backend.spawn).toHaveBeenCalledOnce()
  })
  it.each([
    ['quota', 'Codex 当前账号额度已用尽，请等待额度恢复后刷新'],
    ['authentication', 'Codex 当前账号认证不可用或访问被拒绝，请检查登录后刷新'],
  ] as const)(
    'reports confirmed %s denial without publishing native model capabilities',
    async (denialReason, message) => {
      const f = fixture([[entry('public')]])
      vi.mocked(readCodexOwnAccountSource).mockResolvedValue({
        provider: 'openai-codex',
        credential: { type: 'oauth', access: 'synthetic-never-displayed' },
        sourceIds: ['/synthetic'],
        nativeRouteConfirmed: true,
        baseUrl: 'https://chatgpt.com/backend-api',
      } as any)
      vi.mocked(probeAccountModels).mockResolvedValue({
        state: 'denied',
        source: 'unknown',
        models: [],
        denialReason,
      })
      await expect(
        discoverCodexModels(
          f.backend,
          DEFAULT_CONFIG,
          '/synthetic/codex',
          '/synthetic',
          new AbortController().signal,
        ),
      ).rejects.toThrow(message)
      expect(f.child.waitForExit).toHaveBeenCalledOnce()
    },
  )
  it('rereads credentials after native refresh and supports confirmed default file API routing', async () => {
    const f = fixture([[entry('allowed')]])
    vi.mocked(readCodexOwnAccountSource)
      .mockResolvedValueOnce({
        provider: 'openai-codex',
        credential: { type: 'oauth', access: 'old' },
        sourceIds: ['/synthetic'],
        nativeRouteConfirmed: true,
      } as any)
      .mockResolvedValueOnce({
        provider: 'openai',
        credential: { type: 'api', key: 'own-file-api' },
        sourceIds: ['/synthetic'],
        nativeRouteConfirmed: true,
        baseUrl: 'https://api.openai.com/v1',
      } as any)
    vi.mocked(probeAccountModels).mockResolvedValue({
      state: 'supported',
      source: 'account-models',
      models: [{ id: 'allowed', cost: 'unknown' }],
    })
    expect(
      await discoverCodexModels(
        f.backend,
        DEFAULT_CONFIG,
        '/synthetic/codex',
        '/synthetic',
        new AbortController().signal,
      ),
    ).toHaveLength(1)
    expect(readCodexOwnAccountSource).toHaveBeenCalledTimes(2)
    expect(probeAccountModels).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://api.openai.com/v1',
        credential: { type: 'api', key: 'own-file-api' },
      }),
      expect.anything(),
    )
  })
  it('rejects broken pagination and unconfirmed child exit', async () => {
    await expect(fixture([[entry('public')]], { repeated: true }).run()).rejects.toThrow('分页')
    await expect(fixture([[entry('public')]], { cleanup: false }).run()).rejects.toThrow('cleanup')
  })
  it('cancels a stalled metadata process and confirms its cleanup', async () => {
    const f = fixture([], { stall: true }),
      controller = new AbortController(),
      result = f.run(controller.signal)
    controller.abort()
    await expect(result).rejects.toThrow('取消')
    expect(f.child.waitForExit).toHaveBeenCalledOnce()
  })
})
