import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { authorizedCatalog } from '../src/host/authorized-catalog.ts'
import { catalogFor } from '../src/host/adapters.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'

const state = vi.hoisted(() => ({ home: '', keychain: undefined as string | undefined }))
vi.mock('node:os', async (actual) => ({
  ...(await actual<typeof import('node:os')>()),
  homedir: () => state.home,
}))
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
beforeEach(() => {
  state.home = mkdtempSync(join(tmpdir(), 'cwn-agy-operation-synthetic-'))
  state.keychain = undefined
  mkdirSync(join(state.home, '.gemini/antigravity-cli'), { recursive: true })
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
})
afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  vi.unstubAllEnvs()
  rmSync(state.home, { recursive: true, force: true })
})
const account = (subject = 'a') => ({ state: 'authenticated', principalHash: subject.repeat(64) })
const signal = () => new AbortController().signal

// Exercise the real binding, directory and managed capture chain. Only native
// process handles and home files are synthetic; no account or network is read.
function fixture(projections: object[] = [account(), account()], onModels?: () => void) {
  let accountReads = 0
  let modelReads = 0
  let keychainReads = 0
  const handles: { terminate: ReturnType<typeof vi.fn>; waitForExit: ReturnType<typeof vi.fn> }[] = []
  const backend: ProcessBackend = {
    resolveExecutable: vi.fn(async () => 'synthetic-agy'),
    spawn: vi.fn((spec) => {
      let output: string
      let exitCode = 0
      if (spec.argv.some((arg) => arg.endsWith('windows-agy-account.ps1'))) {
        output = JSON.stringify(projections[accountReads++] ?? { state: 'unconfigured' })
      } else if (spec.argv[0] === '/usr/bin/security') {
        // synthetic keychain item; 44 is security's "item not found".
        keychainReads++
        output = state.keychain === undefined ? '' : state.keychain + '\n'
        if (state.keychain === undefined) exitCode = 44
      } else {
        expect(spec.argv).toEqual(['synthetic-agy', 'models'])
        modelReads++
        onModels?.()
        output = 'synthetic-model\tSynthetic Model'
      }
      const handle = {
        stdout: Readable.from([output]),
        stderr: Readable.from([]),
        done: Promise.resolve({ exitCode }),
        terminate: vi.fn(),
        waitForExit: vi.fn(async () => true),
      }
      handles.push(handle)
      return handle as ReturnType<ProcessBackend['spawn']>
    }),
  }
  return { backend, handles, counts: () => ({ accountReads, modelReads }), keychainReads: () => keychainReads }
}

it.each(['win32', 'darwin'] as const)('AGY background current model discovery scopes updater suppression on %s', async system => {
  Object.defineProperty(process, 'platform', { ...platform, value: system })
  vi.stubEnv('AGY_CLI_DISABLE_AUTO_UPDATE', 'false')
  const login = JSON.stringify({
    auth_method: 'consumer', token: { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' },
  })
  if (system === 'darwin') state.keychain = login
  else writeFileSync(join(state.home, '.gemini/jetski-standalone-oauth-token'), login)
  const f = fixture()
  const catalog = await catalogFor('antigravity', f.backend, DEFAULT_CONFIG, state.home, signal())
  expect(catalog.models.map(model => model.id)).toEqual(['synthetic-model'])
  const launches = vi.mocked(f.backend.spawn).mock.calls.map(([spec]) => spec)
  expect(launches.find(spec => spec.argv[1] === 'models')?.env)
    .toEqual(system === 'win32' ? { AGY_CLI_DISABLE_AUTO_UPDATE: 'true' } : {})
  for (const spec of launches.filter(spec =>
    spec.argv[0] === '/usr/bin/security' || spec.argv.some(arg => arg.endsWith('windows-agy-account.ps1'))))
    expect(spec.env).toBeUndefined()
  expect(process.env.AGY_CLI_DISABLE_AUTO_UPDATE).toBe('false')
  for (const handle of f.handles) expect(handle.waitForExit).toHaveBeenCalledOnce()
})

it('uses two native identity reads per authorized directory and does not reuse them in another request', async () => {
  const f = fixture([account(), account(), account(), account()])
  const first = await authorizedCatalog('antigravity', f.backend, DEFAULT_CONFIG, state.home, signal())
  expect(first.catalog.models.map((model) => model.id)).toEqual(['synthetic-model'])
  expect(f.counts()).toEqual({ accountReads: 2, modelReads: 1 })
  await authorizedCatalog('antigravity', f.backend, DEFAULT_CONFIG, state.home, signal(), first.binding)
  expect(f.counts()).toEqual({ accountReads: 4, modelReads: 2 })
  for (const handle of f.handles) {
    // Each read emptied its own range, so none was terminated.
    expect(handle.terminate).not.toHaveBeenCalled()
    expect(handle.waitForExit).toHaveBeenCalledOnce()
  }
})

it('keeps direct model discovery self-contained without a previous authorization snapshot', async () => {
  const f = fixture()
  await catalogFor('antigravity', f.backend, DEFAULT_CONFIG, state.home, signal())
  await catalogFor('antigravity', f.backend, DEFAULT_CONFIG, state.home, signal())
  expect(f.counts()).toEqual({ accountReads: 2, modelReads: 2 })
})

it('keeps simultaneous authorized requests isolated even with the same backend, config and signal', async () => {
  const f = fixture([account(), account(), account(), account()])
  const sharedSignal = signal()
  const results = await Promise.all([
    authorizedCatalog('antigravity', f.backend, DEFAULT_CONFIG, state.home, sharedSignal),
    authorizedCatalog('antigravity', f.backend, DEFAULT_CONFIG, state.home, sharedSignal),
  ])
  expect(results[0]!.binding).toBe(results[1]!.binding)
  expect(f.counts()).toEqual({ accountReads: 4, modelReads: 2 })
})

it('reads models again under the account signed in at the mandatory final read', async () => {
  const f = fixture([account(), account('b'), account('b'), account('b')])
  await expect(authorizedCatalog('antigravity', f.backend, DEFAULT_CONFIG, state.home, signal())).resolves.toMatchObject({
    binding: expect.stringMatching(/^cli-account-v1:/),
  })
  expect(f.counts()).toEqual({ accountReads: 4, modelReads: 2 })
})

it.each(['unconfigured', 'unauthenticated', 'unknown', 'unavailable'])(
  'rejects native %s after the model query instead of reviving the first identity',
  async (stateAfter) => {
    const f = fixture([account(), { state: stateAfter }])
    await expect(
      authorizedCatalog('antigravity', f.backend, DEFAULT_CONFIG, state.home, signal()),
    ).rejects.toThrow()
    expect(f.counts()).toEqual({ accountReads: 2, modelReads: 1 })
  },
)

it('rejects an obsolete expected binding before starting native models', async () => {
  const f = fixture()
  await expect(
    authorizedCatalog('antigravity', f.backend, DEFAULT_CONFIG, state.home, signal(), 'synthetic-old'),
  ).rejects.toThrow('账号已变更')
  expect(f.counts()).toEqual({ accountReads: 1, modelReads: 0 })
})

it('continues to recheck the native route after models have loaded', async () => {
  const f = fixture(undefined, () =>
    writeFileSync(
      join(state.home, '.gemini/antigravity-cli/settings.json'),
      JSON.stringify({ modelProvider: 'other' }),
    ),
  )
  await expect(
    authorizedCatalog('antigravity', f.backend, DEFAULT_CONFIG, state.home, signal()),
  ).rejects.toThrow()
  expect(f.counts()).toEqual({ accountReads: 1, modelReads: 1 })
})

it('drops cancelled directory output without starting another account query', async () => {
  const controller = new AbortController()
  const cancellation = new Error('Synthetic directory cancellation')
  const f = fixture(undefined, () => controller.abort(cancellation))
  await expect(
    authorizedCatalog('antigravity', f.backend, DEFAULT_CONFIG, state.home, controller.signal),
  ).rejects.toBe(cancellation)
  expect(f.counts()).toEqual({ accountReads: 1, modelReads: 1 })
  expect(f.handles[1]!.waitForExit).toHaveBeenCalledOnce()
})

it.each([true, false])(
  'does not settle cancelled native identity before cleanup (confirmed=%s)',
  async (confirmed) => {
    const controller = new AbortController()
    const stdout = new PassThrough(),
      stderr = new PassThrough()
    let finish!: (result: { exitCode: null }) => void
    let release!: (confirmed: boolean) => void
    const done = new Promise<{ exitCode: null }>((resolve) => {
      finish = resolve
    })
    const cleanup = new Promise<boolean>((resolve) => {
      release = resolve
    })
    const waitForExit = vi.fn(() => cleanup)
    const backend: ProcessBackend = {
      resolveExecutable: vi.fn(async () => 'synthetic-agy'),
      spawn: vi.fn((spec) => {
        spec.signal!.addEventListener(
          'abort',
          () => {
            stdout.end()
            stderr.end()
            finish({ exitCode: null })
          },
          { once: true },
        )
        return { stdout, stderr, done, terminate: vi.fn(), waitForExit } as ReturnType<
          ProcessBackend['spawn']
        >
      }),
    }
    let settled = false
    const result = authorizedCatalog(
      'antigravity',
      backend,
      DEFAULT_CONFIG,
      state.home,
      controller.signal,
    ).then(
      () => {
        settled = true
        return undefined
      },
      (error: unknown) => {
        settled = true
        return error
      },
    )
    await vi.waitFor(() => expect(backend.spawn).toHaveBeenCalledOnce())
    const cancellation = new Error('Synthetic native cancellation')
    controller.abort(cancellation)
    await vi.waitFor(() => expect(waitForExit).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
    release(confirmed)
    if (confirmed) expect(await result).toBe(cancellation)
    else expect(await result).toBeInstanceOf(ProcessCleanupUnconfirmedError)
    expect(backend.spawn).toHaveBeenCalledOnce()
  },
)

it.each(['plain', 'go-keyring-base64:', 'go-keyring-encoded:'] as const)(
  'reads the Mac keychain item (%s), not the stale token file, and never invokes the Windows helper',
  async (encoding) => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' })
    const claims = (sub: string) =>
      Buffer.from(JSON.stringify({ sub, iss: 'https://accounts.google.com' })).toString('base64url')
    const login = (sub: string) => JSON.stringify({
      auth_method: 'consumer',
      token: { refresh_token: 'synthetic-refresh', access_token: 'synthetic-access' },
      id_token: `synthetic.${claims(sub)}.signature`,
    })
    // The stale file belongs to another synthetic account and must not decide the binding.
    writeFileSync(join(state.home, '.gemini/jetski-standalone-oauth-token'), login('synthetic-stale-subject'))
    const raw = login('synthetic-own-subject')
    state.keychain = encoding === 'plain' ? raw
      : encoding + Buffer.from(raw).toString(encoding === 'go-keyring-base64:' ? 'base64' : 'hex')
    const f = fixture([])
    const own = await authorizedCatalog('antigravity', f.backend, DEFAULT_CONFIG, state.home, signal())
    expect(f.counts()).toEqual({ accountReads: 0, modelReads: 1 })
    expect(f.keychainReads()).toBe(3)
    state.keychain = login('synthetic-stale-subject')
    const stale = await authorizedCatalog('antigravity', fixture([]).backend, DEFAULT_CONFIG, state.home, signal())
    expect(stale.binding).not.toBe(own.binding)
  },
)

it('treats a missing Mac keychain item as signed out even when the stale token file remains', async () => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' })
  writeFileSync(join(state.home, '.gemini/jetski-standalone-oauth-token'), JSON.stringify({
    auth_method: 'consumer', token: { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' },
  }))
  const f = fixture([])
  await expect(authorizedCatalog('antigravity', f.backend, DEFAULT_CONFIG, state.home, signal()))
    .rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
  expect(f.counts()).toEqual({ accountReads: 0, modelReads: 0 })
  expect(f.keychainReads()).toBe(1)
})
