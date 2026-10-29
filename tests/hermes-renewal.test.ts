import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PassThrough } from 'node:stream'
import {
  ensureHermesNousFresh,
  reserveHermesAccount,
  hermesNousPrincipalDigest,
} from '../src/host/hermes-renewal.ts'
import * as renewal from '../src/host/hermes-renewal.ts'
import { projectHermesNousSource, NOUS_PORTAL, NOUS_INFERENCE } from '../src/host/hermes-nous.ts'
import { projectHermesIdentity } from '../src/host/hermes-accounts.ts'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import { discoverHermes, prepareHermes } from '../src/host/hermes-adapter.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import { AccountManager } from '../src/host/accounts.ts'
import { effectiveHermesHome, prepareHermesAccountHome } from '../src/host/hermes-account-context.ts'
import { HermesAccountSourceError } from '../src/host/hermes-models.ts'
import { hermesNativeCommand } from '../src/host/hermes-installation.ts'

vi.mock('../src/host/hermes-installation.ts', async (load) => ({
  ...(await load<typeof import('../src/host/hermes-installation.ts')>()),
  hermesNativeCommand: vi.fn(async (_executable: string, args: string[]) => [
    '/synthetic/python',
    '-I',
    fileURLToPath(new URL('../src/host/hermes-native-entry.py', import.meta.url)),
    '/synthetic/checkout',
    '/synthetic/facts.json',
    '/synthetic/environment',
    ...args,
  ]),
}))
vi.mock('../src/host/windows-account-terminal.ts', async (load) => ({
  ...(await load<typeof import('../src/host/windows-account-terminal.ts')>()),
  // This suite tests AccountManager's Hermes reservations with a synthetic PTY,
  // not the Windows Job/ConPTY handshake. The native platform owner requires
  // control receipts and streams absent from this renewal-only backend; its
  // lifecycle is covered independently by windows-account-terminal.test.ts.
  spawnAccountTerminal: (
    backend: ProcessBackend,
    spec: Parameters<NonNullable<ProcessBackend['spawnTerminal']>>[0],
  ) => backend.spawnTerminal!(spec),
}))

// All account/token/HTTP/process data below are synthetic. No native CLI or network runs.
const roots: string[] = []
const managers: AccountManager[] = []
const jwt = (seconds: number, extra: Record<string, unknown> = {}) =>
  `e30.${Buffer.from(
    JSON.stringify({
      sub: 'synthetic-subject',
      org_id: 'synthetic-org',
      iss: NOUS_PORTAL,
      client_id: 'synthetic-client',
      scope: 'inference:invoke',
      exp: Date.now() / 1000 + seconds,
      ...extra,
    }),
  ).toString('base64url')}.synthetic`
function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
function fixture(ttl = -60) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'hermes-renewal-synthetic-')))
  roots.push(home)
  const executable = join(home, 'hermes.cjs')
  writeFileSync(executable, '#!/usr/bin/env node\nprocess.exit(0)\n', { mode: 0o700 })
  const config = {
    auth: { adopt_external_logins: false },
    model: { provider: 'nous', default: 'synthetic/free', base_url: NOUS_INFERENCE },
  }
  writeFileSync(join(home, 'config.yaml'), JSON.stringify(config))
  const token = jwt(ttl)
  const state = {
    access_token: token,
    agent_key: token,
    refresh_token: 'synthetic-refresh',
    scope: 'inference:invoke',
    portal_base_url: NOUS_PORTAL,
    inference_base_url: NOUS_INFERENCE,
  }
  const raw: any = {
    active_provider: 'nous',
    providers: { nous: state },
    credential_pool: {
      nous: [{ ...state, source: 'device_code', auth_type: 'oauth', id: 'synthetic-pool', priority: 1 }],
    },
  }
  const save = () => writeFileSync(join(home, 'auth.json'), JSON.stringify(raw))
  save()
  return {
    home,
    executable,
    raw,
    config,
    save,
    rotate(extra: Record<string, unknown> = {}) {
      const token = jwt(3600, extra)
      for (const row of [raw.providers.nous, ...raw.credential_pool.nous])
        Object.assign(row, {
          access_token: token,
          agent_key: token,
          refresh_token: 'synthetic-rotated',
          client_id: 'hermes-cli',
        })
      save()
    },
    runtime: {
      ...DEFAULT_CONFIG,
      hermesHome: home,
      hermesExecutable: executable,
      stateDirectory: join(home, 'state'),
    },
  }
}
function backend(
  f: ReturnType<typeof fixture>,
  options: {
    gate?: Promise<void>
    cleanup?: Promise<boolean>
    rotate?: () => void
    state?: string
    output?: string
    stderr?: string
    exitCode?: number
  } = {},
) {
  const spawn = vi.fn((spec: any) => {
    const end = deferred<void>()
    const stdout = (async function* () {
      await options.gate
      if ((options.state ?? 'ready') === 'ready' && !options.output) (options.rotate ?? f.rotate)()
      end.resolve()
      yield options.output ?? JSON.stringify({ version: 1, state: options.state ?? 'ready' })
    })()
    return {
      stdout,
      stderr: (async function* () {
        if (options.stderr) yield options.stderr
      })(),
      done: end.promise.then(() => ({ exitCode: options.exitCode ?? 0, signal: null })),
      terminate: vi.fn(),
      waitForExit: vi.fn(async () => await (options.cleanup ?? Promise.resolve(true))),
      spec,
    } as any
  })
  return { resolveExecutable: vi.fn(async () => f.executable), spawn } satisfies ProcessBackend
}
const signal = () => new AbortController().signal
const start = (f: ReturnType<typeof fixture>, b: ProcessBackend, control = signal()) =>
  ensureHermesNousFresh({ home: f.home, executable: f.executable, backend: b, signal: control })
afterEach(async () => {
  await Promise.allSettled(managers.splice(0).map((manager) => manager.close()))
  roots.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
  vi.clearAllMocks()
})

describe('shared native Hermes Nous renewal', () => {
  it('模拟新登录的有效 singleton 尚无凭据池，状态查询不误报未登录或触发续期', async () => {
    const f = fixture(600), b = backend(f)
    delete f.raw.credential_pool
    f.save()
    const manager = new AccountManager(b, f.runtime)
    managers.push(manager)
    expect((await manager.status('hermes', f.home, signal())).state).toBe('authenticated')
    expect(b.spawn).not.toHaveBeenCalled()
    const saved = f.raw.providers.nous
    f.raw.providers = { copilot: {} }
    f.raw.credential_pool = { copilot: [ambientCopilot], nous: [] }
    f.save()
    expect((await manager.status('hermes', f.home, signal())).state).toBe('unconfigured')
    f.raw.providers.nous = saved
    f.raw.credential_pool.nous = [{ ...saved, id: 'a1b2c3', source: 'device_code', auth_type: 'oauth' }]
    f.save()
    expect(await manager.status('hermes', f.home, signal())).toMatchObject({
      state: 'authenticated', logins: [{ id: 'hermes:nous:a1b2c3', providerLabel: 'Nous' }],
    })
    expect(b.spawn).not.toHaveBeenCalled()
  })
  it('leaves healthy credentials read-only and projects expired refreshable login as pending, not revoked', async () => {
    const f = fixture(600),
      b = backend(f)
    await start(f, b)
    expect(b.spawn).not.toHaveBeenCalled()
    const expired = fixture()
    expect(projectHermesIdentity(expired.raw)).toMatchObject({
      state: 'configured',
      summary: 'Hermes 登录已保存，等待自动续期',
    })
    delete expired.raw.providers.nous.refresh_token
    expect(projectHermesIdentity(expired.raw)?.state).toBe('unauthenticated')
  })
  it('preserves unconfigured and other-provider account status without launching or requiring Nous settings', async () => {
    for (const kind of ['missing', 'other']) {
      const f = fixture(),
        b = backend(f)
      if (kind === 'missing') {
        rmSync(join(f.home, 'config.yaml'))
        rmSync(join(f.home, 'auth.json'))
      } else {
        writeFileSync(join(f.home, 'config.yaml'), 'model:\n  provider: openrouter\n')
        f.raw.active_provider = 'openrouter'
        f.raw.providers = {}
        f.raw.credential_pool = {
          openrouter: [{ auth_type: 'api_key', source: 'manual', access_token: 'synthetic-own-api' }],
        }
        f.save()
      }
      await start(f, b)
      const manager = new AccountManager(b, f.runtime)
      managers.push(manager)
      expect((await manager.status('hermes', f.home, signal())).state).toBe(
        kind === 'missing' ? 'unconfigured' : 'authenticated',
      )
      expect(b.spawn).not.toHaveBeenCalled()
    }
  })
  it('does not mistake a stale terminal marker for a revoked newly logged-in account', async () => {
    const f = fixture(600),
      b = backend(f)
    f.raw.providers.nous.last_auth_error = { relogin_required: true }
    f.save()
    expect(projectHermesIdentity(f.raw)?.state).toBe('authenticated')
    await start(f, b)
    expect(b.spawn).not.toHaveBeenCalled()
    const expired = fixture(),
      renewal = backend(expired)
    expired.raw.providers.nous.last_auth_error = { relogin_required: true }
    expired.save()
    await start(expired, renewal)
    expect(projectHermesIdentity(expired.raw)?.state).toBe('authenticated')
    expect(renewal.spawn).toHaveBeenCalledTimes(1)
  })
  it.each(['ready', 'unavailable', 'relogin'])(
    'account status integrates renewal result %s without exposing its protocol',
    async (state) => {
      const f = fixture(),
        b = backend(f, { state }),
        manager = new AccountManager(b, f.runtime)
      managers.push(manager)
      const status = await manager.status('hermes', f.home, signal())
      expect(status.state).toBe(
        state === 'ready' ? 'authenticated' : state === 'relogin' ? 'unauthenticated' : 'unavailable',
      )
      expect(JSON.stringify(status)).not.toMatch(/synthetic|refresh_token|agent_key|version/)
      expect(b.spawn).toHaveBeenCalledTimes(1)
      // Signing in again must still be able to pick Nous (simulated renewal receipt).
      if (state === 'relogin')
        expect(status.actions.find((item) => item.id === 'login')?.providers?.map((item) => item.id)).toContain('nous')
    },
  )
  it('renews once, passes only the principal digest, and rereads native persistence before accepting', async () => {
    const f = fixture(),
      b = backend(f)
    const digest = hermesNousPrincipalDigest(projectHermesNousSource(f.raw, 0, { allowExpired: true }))
    await start(f, b)
    const spec = b.spawn.mock.calls[0]![0]
    expect(spec.argv.slice(-2)).toEqual(['--cliworker-nous-refresh', digest])
    expect(spec.argv[1]).toMatch(/private-launch\.mjs$/)
    expect(spec.stdio).toEqual({ stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    expect(spec.env).toMatchObject({
      HERMES_HOME: f.home,
      HERMES_SHARED_AUTH_DIR: join(f.home, 'shared'),
      HERMES_NOUS_MIN_KEY_TTL_SECONDS: '120',
    })
    expect(JSON.stringify(spec)).not.toContain('synthetic-refresh')
    expect(projectHermesIdentity(f.raw)?.state).toBe('authenticated')
    await start(f, b)
    expect(b.spawn).toHaveBeenCalledTimes(1)
  })
  it.each(['relogin', 'unavailable', 'changed', 'unsupported'])(
    'maps %s to a fixed safe state without echoing native stderr',
    async (state) => {
      const f = fixture(),
        b = backend(f, { state, stderr: 'synthetic-secret-do-not-echo' })
      await expect(start(f, b)).rejects.toMatchObject({ state })
      expect(b.spawn).toHaveBeenCalledTimes(1)
      await expect(start(f, b)).rejects.not.toThrow('synthetic-secret')
      expect(b.spawn).toHaveBeenCalledTimes(2)
    },
  )
  it.each(['{', JSON.stringify({ version: 1, state: 'ready', token: 'synthetic-secret' }), 'x'.repeat(513)])(
    'rejects invalid native receipts without publishing them',
    async (output) => {
      const f = fixture(),
        b = backend(f, { output })
      await expect(start(f, b)).rejects.toMatchObject({ state: 'unavailable' })
      expect(b.spawn.mock.results[0]!.value.waitForExit).toHaveBeenCalledOnce()
    },
  )
  it('never sends the private helper operation to an unsupported standalone installation', async () => {
    const f = fixture(),
      b = backend(f)
    vi.mocked(hermesNativeCommand).mockResolvedValueOnce([f.executable, '--cliworker-nous-refresh'])
    await expect(start(f, b)).rejects.toMatchObject({ state: 'unsupported' })
    expect(b.spawn).not.toHaveBeenCalled()
  })
  it('never refreshes a missing grant, dead pool, suppressed source or active quota cooldown', async () => {
    for (const kind of ['missing', 'dead', 'suppressed', 'cooldown']) {
      const f = fixture(),
        b = backend(f)
      if (kind === 'missing') delete f.raw.providers.nous.refresh_token
      if (kind === 'dead') f.raw.credential_pool.nous[0].last_status = 'dead'
      if (kind === 'suppressed') f.raw.suppressed_sources = { nous: ['device_code'] }
      if (kind === 'cooldown')
        f.raw.credential_pool.nous[0].model_cooldowns = { 'synthetic/free': Date.now() / 1000 + 300 }
      f.save()
      try {
        await start(f, b)
      } catch {
        /* refused without launching */
      }
      expect(b.spawn).not.toHaveBeenCalled()
    }
  })
  it('retains a stable binding across same-principal token rotation and rejects changed subjects', async () => {
    const f = fixture(600),
      b = backend(f)
    const before = await readCliAccountBinding('hermes', b, f.runtime, f.home, signal())
    const expired = jwt(-60)
    for (const row of [f.raw.providers.nous, ...f.raw.credential_pool.nous])
      Object.assign(row, { access_token: expired, agent_key: expired })
    f.save()
    expect(await readCliAccountBinding('hermes', b, f.runtime, f.home, signal())).toBe(before)
    const other = fixture(),
      switched = backend(other, { rotate: () => other.rotate({ sub: 'other-subject' }) })
    await expect(start(other, switched)).rejects.toMatchObject({ state: 'changed' })
  })
  it('shares concurrent status/catalog requests and one reader cancellation does not cancel the rotation', async () => {
    const f = fixture(),
      gate = deferred(),
      b = backend(f, { gate: gate.promise })
    const first = new AbortController(),
      second = new AbortController()
    const one = start(f, b, first.signal),
      two = start(f, b, second.signal)
    await vi.waitFor(() => expect(b.spawn).toHaveBeenCalledTimes(1))
    first.abort()
    await expect(one).rejects.toThrow()
    expect(b.spawn.mock.calls[0]![0].signal.aborted).toBe(false)
    gate.resolve()
    await two
    expect(b.spawn).toHaveBeenCalledTimes(1)
  })
  it('last cancellation and a new request wait for durable rotation and whole-range cleanup', async () => {
    const f = fixture(),
      gate = deferred(),
      cleanup = deferred<boolean>()
    const b = backend(f, { gate: gate.promise, cleanup: cleanup.promise }),
      control = new AbortController()
    let finished = false
    const one = start(f, b, control.signal).catch((error) => {
      finished = true
      throw error
    })
    void one.catch(() => {})
    await vi.waitFor(() => expect(b.spawn).toHaveBeenCalledTimes(1))
    control.abort()
    const two = start(f, b)
    await new Promise((resolve) => setImmediate(resolve))
    expect(finished).toBe(false)
    gate.resolve()
    await new Promise((resolve) => setImmediate(resolve))
    expect(finished).toBe(false)
    cleanup.resolve(true)
    await expect(one).rejects.toThrow()
    await two
    expect(b.spawn).toHaveBeenCalledTimes(1)
  })
  it('account management reserves the home until cleanup and never lets an old renewal resurrect logout', async () => {
    const f = fixture(),
      gate = deferred(),
      cleanup = deferred<boolean>()
    const b = backend(f, { gate: gate.promise, cleanup: cleanup.promise })
    const query = start(f, b)
    void query.catch(() => {})
    await vi.waitFor(() => expect(b.spawn).toHaveBeenCalledTimes(1))
    let reserved = false
    const lease = reserveHermesAccount(f.home, signal()).then((release) => {
      reserved = true
      return release
    })
    await expect(start(f, b)).rejects.toMatchObject({ state: 'busy' })
    gate.resolve()
    expect(reserved).toBe(false)
    cleanup.resolve(true)
    const release = await lease
    await expect(query).rejects.toMatchObject({ state: 'busy' })
    delete f.raw.providers.nous
    f.raw.credential_pool.nous = []
    f.save()
    release()
    await start(f, b)
    expect(b.spawn).toHaveBeenCalledTimes(1)
    expect(f.raw.providers.nous).toBeUndefined()
  })
  it('the actual account manager holds both old and newly selected homes until terminal cleanup completes', async () => {
    const reserve = vi.spyOn(renewal, 'reserveHermesAccount')
    const f = fixture(),
      gate = deferred(),
      cleanup = deferred<boolean>()
    const b = backend(f, { gate: gate.promise, cleanup: cleanup.promise })
    const output = new PassThrough(),
      terminalDone = deferred<any>(),
      terminalCleanup = deferred()
    const spawnTerminal = vi.fn(
      async () =>
        ({
          pid: 100,
          output,
          done: terminalDone.promise,
          write: vi.fn(async () => {}),
          resize: vi.fn(async () => {}),
          terminate: vi.fn(async () => {
            await terminalCleanup.promise
            output.end()
            terminalDone.resolve({ exitCode: 0, signal: null })
          }),
        }) as any,
    )
    const manager = new AccountManager({ ...b, spawnTerminal }, f.runtime)
    managers.push(manager)
    const query = start(f, b)
    void query.catch(() => {})
    await vi.waitFor(() => expect(b.spawn).toHaveBeenCalledTimes(1))
    const opening = manager.start('synthetic-parent', 'hermes', 'manage', f.home, signal())
    await vi.waitFor(() => expect(reserve).toHaveBeenCalledWith(f.home, expect.any(AbortSignal)))
    await expect(start(f, b)).rejects.toMatchObject({ state: 'busy' })
    expect(spawnTerminal).not.toHaveBeenCalled()
    gate.resolve()
    cleanup.resolve(true)
    const terminal = await opening
    expect(spawnTerminal).toHaveBeenCalledTimes(1)
    await expect(query).rejects.toMatchObject({ state: 'busy' })
    const selected = effectiveHermesHome(f.runtime)
    expect(selected).not.toBe(f.home)
    await expect(start(f, b)).rejects.toMatchObject({ state: 'busy' })
    await expect(
      ensureHermesNousFresh({ home: selected, backend: b, signal: signal() }),
    ).rejects.toMatchObject({ state: 'busy' })
    const stopped = manager.stop('synthetic-parent', terminal.id)
    await new Promise((resolve) => setImmediate(resolve))
    await expect(start(f, b)).rejects.toMatchObject({ state: 'busy' })
    terminalCleanup.resolve()
    await stopped
    await start(f, b)
    await ensureHermesNousFresh({ home: selected, backend: b, signal: signal() })
    expect(b.spawn).toHaveBeenCalledTimes(1)
  })
  it('blocks subsequent operations when a managed process range cannot be confirmed exited', async () => {
    const f = fixture(),
      b = backend(f, { cleanup: Promise.resolve(false) })
    await expect(start(f, b)).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
    await expect(start(f, b)).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
    await expect(reserveHermesAccount(f.home, signal())).rejects.toBeInstanceOf(
      ProcessCleanupUnconfirmedError,
    )
    expect(b.spawn).toHaveBeenCalledTimes(1)
  })
  it('independent homes never share renewal or authentication results', async () => {
    const a = fixture(),
      b = fixture(),
      ba = backend(a),
      bb = backend(b)
    await Promise.all([start(a, ba), start(b, bb)])
    expect(ba.spawn).toHaveBeenCalledTimes(1)
    expect(bb.spawn).toHaveBeenCalledTimes(1)
  })
  it('covers direct model discovery and independently prepared tasks before a stale token can reject them', async () => {
    const f = fixture(),
      b = backend(f)
    const http = vi.fn(
      async (url: any) =>
        new Response(
          JSON.stringify(
            String(url).endsWith('/models')
              ? {
                  data: [
                    {
                      id: 'synthetic/free',
                      pricing: { prompt: 0, completion: 0 },
                      supported_parameters: ['tools'],
                    },
                  ],
                }
              : {
                  organisation: { id: 'synthetic-org' },
                  user: { privy_did: 'synthetic-subject' },
                  paid_service_access: { allowed: false },
                },
          ),
        ),
    )
    const models = await discoverHermes(f.executable, vi.fn(), join(f.home, 'runtime'), f.home, {
      fetch: http,
      signal: signal(),
      renewal: { backend: b, signal: signal() },
    })
    expect(models[0]?.id).toBe(JSON.stringify(['nous', 'synthetic/free']))
    expect(b.spawn).toHaveBeenCalledTimes(1)
    const other = fixture(),
      bo = backend(other)
    const launch = await prepareHermes({
      executable: other.executable,
      project: other.home,
      preference: { model: JSON.stringify(['nous', 'synthetic/free']), effort: 'default' },
      mode: 'accept-edits',
      prompt: 'synthetic; not executed',
      stateDirectory: join(other.home, 'runtime'),
      hermesHome: other.home,
      renewal: { backend: bo, signal: signal() },
    })
    expect(launch.argv).toContain('chat')
    expect(bo.spawn).toHaveBeenCalledTimes(1)
  })
})

// Native credential_pool._seed_copilot_singleton writes this row (no secret, only a
// fingerprint) into any HERMES_HOME whenever a picker loads the Copilot pool while the
// user's `gh` CLI is logged in, regardless of auth.adopt_external_logins. Synthetic data.
const ambientCopilot = {
  id: 'synthetic-copilot',
  label: 'gh auth token',
  auth_type: 'api_key',
  priority: 0,
  source: 'gh_cli',
  base_url: 'https://api.githubcopilot.com',
  request_count: 0,
  secret_fingerprint: 'synthetic-fingerprint',
}
function terminalBackend(b: ProcessBackend) {
  const output = new PassThrough()
  const done = deferred<any>()
  const spawnTerminal = vi.fn(
    async () =>
      ({
        pid: 100,
        output,
        done: done.promise,
        write: vi.fn(async () => {}),
        resize: vi.fn(async () => {}),
        terminate: vi.fn(async () => {
          output.end()
          done.resolve({ exitCode: 0, signal: null })
        }),
      }) as any,
  )
  return { ...b, spawnTerminal }
}

describe('Hermes ambient Copilot row seeded by the native picker', () => {
  it('still renews an expired own Nous login and reports it authenticated', async () => {
    const f = fixture(),
      b = backend(f)
    f.raw.credential_pool.copilot = [ambientCopilot]
    f.save()
    await start(f, b)
    expect(b.spawn).toHaveBeenCalledTimes(1)
    const manager = new AccountManager(b, f.runtime)
    managers.push(manager)
    expect((await manager.status('hermes', f.home, signal())).state).toBe('authenticated')
    expect(b.spawn).toHaveBeenCalledTimes(1)
  })
  it('opens the account terminal on the plugin home that already holds the row', async () => {
    const f = fixture(600),
      b = backend(f)
    const own = prepareHermesAccountHome(f.runtime)
    writeFileSync(join(own, 'config.yaml'), JSON.stringify(f.config), { mode: 0o600 })
    writeFileSync(
      join(own, 'auth.json'),
      JSON.stringify({ ...f.raw, credential_pool: { ...f.raw.credential_pool, copilot: [ambientCopilot] } }),
      { mode: 0o600 },
    )
    const host = terminalBackend(b)
    const manager = new AccountManager(host, f.runtime)
    managers.push(manager)
    for (const action of ['login', 'manage'] as const) {
      const terminal = await manager.start('synthetic-parent', 'hermes', action, f.home, signal())
      await manager.stop('synthetic-parent', terminal.id)
    }
    expect(host.spawnTerminal).toHaveBeenCalledTimes(2)
  })
  it.each([
    ['model', { provider: 'copilot', default: 'synthetic/model' }],
    ['auxiliary', { vision: { provider: 'copilot' } }],
    ['fallback_providers', ['copilot']],
  ])('keeps refusing the gh login once %s selects Copilot, with a specific reason', async (key, value) => {
    const f = fixture(),
      b = backend(f)
    const config: any = { ...f.config, [key]: value }
    if (key === 'model') f.raw.active_provider = 'copilot'
    writeFileSync(join(f.home, 'config.yaml'), JSON.stringify(config))
    f.raw.credential_pool.copilot = [ambientCopilot]
    f.save()
    const manager = new AccountManager(terminalBackend(b), f.runtime)
    managers.push(manager)
    if (key !== 'model') {
      await expect(start(f, b)).rejects.toBeInstanceOf(HermesAccountSourceError)
      expect(await manager.status('hermes', f.home, signal())).toMatchObject({
        state: 'unavailable',
        summary: 'Hermes 含外部账号来源，请使用自身登录',
      })
    }
    expect(b.spawn).not.toHaveBeenCalled()
    await expect(
      manager.start('synthetic-parent', 'hermes', 'logout', f.home, signal()),
    ).rejects.toThrow('Hermes 含外部账号来源，请使用自身登录')
  })
})
