import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverGrokAccountModels, GROK_SETTINGS_URL, GROK_MODELS_URL } from '../src/host/grok-models.ts'
import {
  ensureGrokAccessFresh,
  GrokRenewalError,
  grokRenewalOutcome,
  reserveGrokAccount,
  resetGrokRenewalState,
} from '../src/host/grok-renewal.ts'
import { zcodeGrokAccountStatus } from '../src/host/zcode-grok-accounts.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import type { ModelChoice } from '../src/shared/types.ts'

// Synthetic fixtures only: no real Grok, network, model call or credential.
const roots: string[] = []
const session = (minutes: number, overrides: Record<string, unknown> = {}) => ({
  auth_mode: 'oidc',
  oidc_issuer: 'https://auth.x.ai',
  oidc_client_id: 'synthetic-client',
  user_id: 'synthetic-user',
  key: `SYNTHETIC_ACCESS_${minutes}`,
  refresh_token: 'SYNTHETIC_REFRESH',
  expires_at: new Date(Date.now() + minutes * 60_000).toISOString(),
  ...overrides,
})
function fixture(minutes = -60) {
  const home = mkdtempSync(join(tmpdir(), 'grok-renewal-synthetic-'))
  roots.push(home)
  mkdirSync(join(home, '.grok'))
  const path = join(home, '.grok/auth.json')
  const write = (auth: unknown) =>
    writeFileSync(path, JSON.stringify({ 'https://auth.x.ai::synthetic-client': auth }), { mode: 0o600 })
  write(session(minutes))
  const logPath = join(home, 'renewal-home', 'logs', 'unified.jsonl')
  mkdirSync(join(home, 'renewal-home', 'logs'), { recursive: true })
  const log = (outcome: string) =>
    writeFileSync(logPath, `{"msg":"other"}\n${JSON.stringify({ msg: 'auth: silent refresh', ctx: { outcome } })}\n`)
  return { home, path, write, logPath, log, config: { ...DEFAULT_CONFIG, stateDirectory: join(home, 'state') } }
}
type Fixture = ReturnType<typeof fixture>
function backend(
  options: { act?: () => void; gate?: Promise<void>; exitCode?: number; cleanup?: boolean } = {},
) {
  const spawn = vi.fn((spec: any) => {
    let finish!: () => void
    const ended = new Promise<void>((resolve) => (finish = resolve))
    const stdout = (async function* () {
      await options.gate
      options.act?.()
      finish()
      yield 'Available models:\n  * grok-a\n'
    })()
    return {
      stdout,
      stderr: (async function* () {})(),
      done: ended.then(() => ({ exitCode: options.exitCode ?? 0, signal: null })),
      terminate: vi.fn(),
      waitForExit: vi.fn(async () => options.cleanup ?? true),
      spec,
    } as any
  })
  return { resolveExecutable: vi.fn(async () => '/bin/grok'), spawn } satisfies ProcessBackend
}
const renew = (f: Fixture, b: ProcessBackend, signal = new AbortController().signal) =>
  ensureGrokAccessFresh({
    backend: b,
    executable: '/bin/grok',
    env: { GROK_HOME: join(f.home, 'renewal-home'), GROK_AUTH_PATH: join(f.home, 'renewal-home', 'auth.json') },
    cwd: f.home,
    logPath: f.logPath,
    signal,
    home: f.home,
  })
const native: ModelChoice[] = [{ id: 'grok-a', label: 'Synthetic A', efforts: ['low'] }]
const directory = vi.fn(async (url: string, init: any) => {
  if (url === GROK_SETTINGS_URL) return Response.json({ allow_access: true })
  expect(url).toBe(GROK_MODELS_URL)
  return Response.json({ data: [{ model: 'grok-a', authorization: init.headers.Authorization }] })
})
afterEach(() => {
  resetGrokRenewalState()
  vi.clearAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Grok native renewal (synthetic process and files)', () => {
  it('lets Grok renew an expired session against the real auth file, then lists the account models', async () => {
    const f = fixture(-854)
    const b = backend({ act: () => f.write(session(360)) })
    const seen: string[] = []
    const models = await discoverGrokAccountModels(native, {
      home: f.home,
      fetch: (async (url: string, init: any) => {
        seen.push(init.headers.Authorization)
        return directory(url, init)
      }) as typeof fetch,
      renew: (signal) => renew(f, b, signal),
    })
    expect(models).toEqual(native)
    expect(b.spawn).toHaveBeenCalledOnce()
    const spec = b.spawn.mock.calls[0]![0]
    expect(spec.argv.slice(-2)).toEqual(['/bin/grok', 'models'])
    expect(spec.argv[1]).toMatch(/private-launch\.mjs$/)
    expect(spec.env.GROK_AUTH_PATH).toBe(join(f.home, '.grok', 'auth.json'))
    expect(spec.env.GROK_HOME).toBe(join(f.home, 'renewal-home'))
    expect(JSON.stringify(spec)).not.toContain('SYNTHETIC_REFRESH')
    expect(JSON.stringify(spec)).not.toContain('SYNTHETIC_ACCESS')
    expect(seen.every((value) => value === 'Bearer SYNTHETIC_ACCESS_360')).toBe(true)
  })

  it('leaves a valid session alone', async () => {
    const f = fixture(120),
      b = backend()
    await renew(f, b)
    expect(b.spawn).not.toHaveBeenCalled()
  })

  it('treats a native ManualLogin refusal as a relogin and shows the account as expired until the file changes', async () => {
    const f = fixture(-60)
    const b = backend({ act: () => f.log('Failed(ManualLogin)') })
    await expect(renew(f, b)).rejects.toMatchObject({ state: 'relogin' })
    const status = await zcodeGrokAccountStatus('grok', f.config, new AbortController().signal, f)
    expect(status).toMatchObject({ state: 'unauthenticated', summary: 'Grok 登录已失效，请在账号终端重新登录' })
    f.write(session(360))
    expect((await zcodeGrokAccountStatus('grok', f.config, new AbortController().signal, f)).state).toBe(
      'authenticated',
    )
  })

  it('reports a temporary failure without demoting the account status', async () => {
    const f = fixture(-60)
    const b = backend({ exitCode: 1 })
    await expect(renew(f, b)).rejects.toMatchObject({ state: 'unavailable' })
    expect((await zcodeGrokAccountStatus('grok', f.config, new AbortController().signal, f)).state).toBe(
      'authenticated',
    )
    await expect(
      discoverGrokAccountModels(native, {
        home: f.home,
        fetch: directory as unknown as typeof fetch,
        renew: (signal) => renew(f, b, signal),
      }),
    ).rejects.toThrow('续期暂时失败')
  })

  it('rejects a renewal that ends with a different account', async () => {
    const f = fixture(-60)
    const b = backend({ act: () => f.write(session(360, { user_id: 'other-user' })) })
    await expect(renew(f, b)).rejects.toMatchObject({ state: 'changed' })
  })

  it('names an installed Grok without the models command as unsupported', async () => {
    const f = fixture(-60)
    await expect(renew(f, backend({ exitCode: 2 }))).rejects.toMatchObject({ state: 'unsupported' })
  })

  it('waits for an open account terminal instead of racing its login', async () => {
    const f = fixture(-60)
    const b = backend({ act: () => f.write(session(360)) })
    const release = await reserveGrokAccount(new AbortController().signal, f.home)
    await expect(renew(f, b)).rejects.toMatchObject({ state: 'busy' })
    expect(b.spawn).not.toHaveBeenCalled()
    release()
    await renew(f, b)
    expect(b.spawn).toHaveBeenCalledOnce()
  })

  it('runs one renewal for concurrent callers; a cancelled caller leaves without killing the write', async () => {
    const f = fixture(-60)
    let open!: () => void
    const gate = new Promise<void>((resolve) => (open = resolve))
    const b = backend({ gate, act: () => f.write(session(360)) })
    const cancelled = new AbortController()
    const first = renew(f, b, cancelled.signal)
    const second = renew(f, b)
    cancelled.abort(new Error('synthetic cancel'))
    await expect(first).rejects.toThrow('synthetic cancel')
    open()
    await second
    expect(b.spawn).toHaveBeenCalledOnce()
    const child = await b.spawn.mock.results[0]!.value
    expect(child.terminate).toHaveBeenCalledOnce()
  })

  it('keeps Grok blocked when the renewal process range cannot be confirmed as exited', async () => {
    const f = fixture(-60)
    const b = backend({ cleanup: false, act: () => f.write(session(360)) })
    await expect(renew(f, b)).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
    await expect(renew(f, backend())).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
    await expect(reserveGrokAccount(new AbortController().signal, f.home)).rejects.toBeInstanceOf(
      ProcessCleanupUnconfirmedError,
    )
  })

  it('uses a still valid token when a pre-expiry renewal fails for a temporary reason', async () => {
    const f = fixture(3)
    const b = backend({ exitCode: 1 })
    expect(
      await discoverGrokAccountModels(native, {
        home: f.home,
        fetch: directory as unknown as typeof fetch,
        renew: (signal) => renew(f, b, signal),
      }),
    ).toEqual(native)
    expect(b.spawn).toHaveBeenCalledOnce()
  })

  it('reads only the native renewal outcome from a bounded log', async () => {
    const f = fixture()
    expect(await grokRenewalOutcome(f.logPath)).toBeUndefined()
    f.log('Renewed')
    expect(await grokRenewalOutcome(f.logPath)).toBe('Renewed')
    expect(await grokRenewalOutcome(join(f.home, 'missing.jsonl'))).toBeUndefined()
    expect(new GrokRenewalError('busy').message).toBe('Grok 账号终端正在运行，请关闭后刷新')
  })
})
