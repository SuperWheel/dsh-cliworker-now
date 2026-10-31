import { afterEach, describe, expect, it, vi } from 'vitest'
import { PassThrough, Readable, Writable } from 'node:stream'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { AccountManager, AGY_GUIDE_TIMING } from '../src/host/accounts.ts'
import { CliExecutablePathStore } from '../src/host/cli-executable-paths.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend, type RuntimeConfig } from '../src/host/process.ts'
import type { CliId } from '../src/shared/types.ts'
import type { AccountIdentitySource } from '../src/host/account-identity.ts'
import * as zcodeAccounts from '../src/host/zcode-grok-accounts.ts'
import { CODEX_APPX_QUERY, WindowsCliInstallationError, WindowsCliNotFoundError } from '../src/host/windows-cli-installation.ts'
import { WINDOWS_PATH_QUERY } from '../src/host/windows-cli-path.ts'
const claudeSettings = vi.hoisted(() => ({ managed: {} as Record<string, unknown> }))
// Synthetic managed settings only; account tests never read this machine's policy.
vi.mock('../src/host/first-party-models.ts', async (load) => {
  const actual = await load<typeof import('../src/host/first-party-models.ts')>()
  return {
    ...actual,
    readFirstPartyJson: async (path: string) =>
      path === actual.claudeManagedSettingsPath() ? claudeSettings.managed : actual.readFirstPartyJson(path),
  }
})
// Manager transport/lifecycle tests use a simulated PTY on every platform.
// Windows Job/ConPTY ownership has its own simulated and real-OS suites.
vi.mock('../src/host/windows-account-terminal.ts', async (load) => ({
  ...(await load<typeof import('../src/host/windows-account-terminal.ts')>()),
  spawnAccountTerminal: (backend: ProcessBackend, spec: SubprocessTerminalSpawnSpec) =>
    backend.spawnTerminal!(spec),
}))
vi.mock('../src/host/pi-omp-identity.ts', () => ({
  verifyPiOmpExecutable: async (_cli: string, executable: string) => executable,
}))
vi.mock('../src/host/hermes-installation.ts', async (load) => ({
  ...(await load<typeof import('../src/host/hermes-installation.ts')>()),
  verifyHermesExecutable: async () => {},
}))

vi.mock('../src/host/zcode-grok-accounts.ts', async (load) => ({
  ...(await load<typeof import('../src/host/zcode-grok-accounts.ts')>()),
  zcodeGrokAccountStatus: async () => ({
    state: 'unconfigured',
    verification: 'local',
    summary: 'Synthetic fixture',
  }),
}))

// This suite exercises the account manager and simulated PTYs, never personal
// global credentials. Native configuration parsing is covered by native fixtures.
vi.mock('../src/host/pi-omp-native.ts', async (load) => {
  const actual = await load<typeof import('../src/host/pi-omp-native.ts')>()
  return {
    ...actual,
    snapshotPiOmpNative: (cli: 'pi' | 'omp', destination: string, options: { accountRoot?: string } = {}) =>
      actual.snapshotPiOmpNative(cli, destination, {
        ...options,
        nativeHome: dirname(options.accountRoot ?? destination),
      }),
    listPiOmpAccountSources: (cli: 'pi' | 'omp', stateDirectory: string, signal: AbortSignal) =>
      actual.listPiOmpAccountSources(cli, stateDirectory, signal, { nativeHome: dirname(stateDirectory) }),
    readPiOmpLogoutSources: (cli: 'pi' | 'omp', stateDirectory: string, signal: AbortSignal) =>
      actual.readPiOmpLogoutSources(cli, stateDirectory, signal, { nativeHome: dirname(stateDirectory) }),
    inspectPiOmpNativeAccount: async () => ({
      state: 'unconfigured',
      verification: 'local',
      summary: 'Synthetic native account fixture',
    }),
  }
})

// All subprocesses in this suite are synthetic. No real login/logout is run.
const roots: string[] = []
const managers: AccountManager[] = []
afterEach(async () => {
  await Promise.allSettled(managers.splice(0).map((manager) => manager.close()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.useRealTimers()
  vi.unstubAllEnvs()
  claudeSettings.managed = {}
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function fixture(overrides: Partial<RuntimeConfig> = {}, onQueryCleanup?: ConstructorParameters<typeof AccountManager>[3]) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-account-test-')))
  roots.push(cwd)
  // Synthetic discovery must never select a real Windows npm/desktop installation.
  vi.stubEnv('APPDATA', join(cwd, 'AppData', 'Roaming'))
  vi.stubEnv('LOCALAPPDATA', join(cwd, 'AppData', 'Local'))
  vi.stubEnv('MIMOCODE_HOME', join(cwd, 'mimo'))
  vi.stubEnv('KIMI_CODE_HOME', join(cwd, 'kimi'))
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(cwd, 'claude'))
  for (const key of Object.keys(process.env))
    if (/ANTHROPIC|CLAUDE_CODE_(?:OAUTH|USE_|API)|AWS_|GOOGLE_|CLOUD_ML|API_KEY|BEARER_TOKEN/.test(key))
      vi.stubEnv(key, '')
  const output = new PassThrough()
  const result = deferred<SubprocessOutcome>()
  const cleanup = deferred<void>()
  let waitCleanup = false
  const terminal: SubprocessTerminalHandle = {
    pid: 123,
    output,
    done: result.promise,
    write: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
    inspectForeground: async () => undefined,
    inspectActivity: async () => ({ state: 'unknown', revision: 0 }),
    // A synthetic CLI that exits on SIGTERM, as the real login CLIs do.
    signalForeground: vi.fn(async (signal) => {
      if (signal === 'SIGTERM') result.resolve({ exitCode: null, signal: 'SIGTERM' })
      return 123
    }),
    terminate: vi.fn(async () => {
      if (waitCleanup) await cleanup.promise
      output.end()
      result.resolve({ exitCode: 0, signal: null })
    }),
  }
  let raw = '',
    exitCode = 0
  let codexAccount: unknown
  const statusProcesses: SubprocessHandle[] = []
  const claudeStatusLaunches: {
    argv: string[]
    env: Record<string, string>
    settings: Record<string, any>
    path?: string
  }[] = []
  const backend: ProcessBackend = {
    resolveExecutable: vi.fn(async (name) => (name.startsWith('/') ? name : `/synthetic/${name}`)),
    spawnTerminal: vi.fn(async () => terminal),
    spawn: vi.fn((spec) => {
      if (spec.argv.includes('auth') && spec.argv.includes('status') && spec.argv.includes('--settings')) {
        const settings = spec.argv[spec.argv.indexOf('--settings') + 1]!
        const inline = settings.startsWith('{')
        claudeStatusLaunches.push({
          argv: [...spec.argv],
          env: { ...spec.env },
          settings: JSON.parse(inline ? settings : readFileSync(settings, 'utf8')),
          ...(inline ? {} : { path: settings }),
        })
      }
      const appServer = spec.argv.includes('app-server')
      const child: SubprocessHandle = {
        stdin: appServer
          ? new Writable({
              write(_chunk, _encoding, callback) {
                callback()
              },
            })
          : undefined,
        stdout: Readable.from(
          appServer
            ? [
                JSON.stringify({ id: 1, result: {} }) + '\n',
                JSON.stringify({ id: 2, result: codexAccount }) + '\n',
              ]
            : [raw],
        ),
        stderr: Readable.from([]),
        control: undefined,
        collected: {},
        done: Promise.resolve({ exitCode, signal: null }),
        terminate: vi.fn(),
        waitForExit: vi.fn(async () => true),
      }
      statusProcesses.push(child)
      return child
    }),
  }
  const identity = vi.fn<AccountIdentitySource>(async () => undefined)
  const config: RuntimeConfig = {
    ...DEFAULT_CONFIG,
    stateDirectory: join(cwd, 'state'),
    zcodeAuthDirectory: join(cwd, 'zcode-auth'),
    zcodeExecutable: '/synthetic/zcode.cjs',
    grokExecutable: '/synthetic/grok',
    ompExecutable: '/synthetic/omp',
    piExecutable: '/synthetic/pi.js',
    hermesExecutable: '/synthetic/hermes',
    hermesHome: join(cwd, 'hermes-home'),
    opencodeExecutable: '/synthetic/opencode',
    ...overrides,
  }
  const manager = new AccountManager(backend, config, identity, onQueryCleanup)
  managers.push(manager)
  return {
    cwd,
    config,
    manager,
    identity,
    backend,
    terminal,
    output,
    result,
    statusProcesses,
    claudeStatusLaunches,
    signal: new AbortController().signal,
    status: (text: string, code = 0) => {
      raw = text
      exitCode = code
    },
    codexAccount: (account: unknown) => {
      codexAccount = { account }
    },
    delayCleanup: () => {
      waitCleanup = true
    },
    finishCleanup: () => cleanup.resolve(),
  }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('account status safety (synthetic CLI output)', () => {
  it('reports a missing manual path as a configuration failure when the SDK error has no ENOENT code', async () => {
    const f = fixture()
    const paths = new CliExecutablePathStore(f.config.stateDirectory!)
    const manual = join(f.cwd, 'missing manual CLI', 'claude')
    f.config.cliExecutablePaths = paths
    paths.setManual('claude', manual)
    const missing = new SubprocessExecutableNotFoundError('SYNTHETIC PRIVATE MISSING PATH')
    vi.mocked(f.backend.resolveExecutable).mockRejectedValue(missing)
    const status = await f.manager.status('claude', f.cwd, f.signal)
    expect(status).toMatchObject({
      cli: 'claude',
      installed: false,
      state: 'unavailable',
      summary: 'CLI 执行路径配置失败，请检查可执行路径',
      actions: [],
    })
    expect(paths.read('claude')).toEqual({ mode: 'manual', path: manual })
    expect(f.backend.resolveExecutable).toHaveBeenCalledExactlyOnceWith(manual)
    expect(f.backend.spawn).not.toHaveBeenCalled()
    expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
    expect(f.identity).not.toHaveBeenCalled()
    expect(JSON.stringify(status)).not.toContain('PRIVATE')
  })

  it.each(['zcode', 'opencode'] as const)(
    'distinguishes Windows desktop discovery absence and failure for %s',
    async (cli) => {
      const f = fixture()
      vi.mocked(f.backend.resolveExecutable).mockRejectedValue(new WindowsCliNotFoundError(cli))
      expect(await f.manager.status(cli, f.cwd, f.signal)).toMatchObject({
        installed: false,
        state: 'unconfigured',
        summary: expect.stringContaining(`${cli}Executable`),
        actions: [],
      })
      const message = `${cli} 桌面已存在，但没有可用独立 CLI，请配置 ${cli}Executable`
      vi.mocked(f.backend.resolveExecutable).mockRejectedValue(new WindowsCliInstallationError(message))
      expect(await f.manager.status(cli, f.cwd, f.signal)).toMatchObject({
        installed: false,
        state: 'unavailable',
        summary: message,
        actions: [],
      })
      expect(f.backend.spawn).not.toHaveBeenCalled()
      expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
    },
  )
  it('keeps MiMo native login available when model configuration contains external references', async () => {
    const f = fixture()
    mkdirSync(join(f.cwd, 'mimo/config'), { recursive: true })
    writeFileSync(
      join(f.cwd, 'mimo/config/mimocode.json'),
      JSON.stringify({
        provider: { openai: { options: { apiKey: '{file:~/.codex/auth.json}' } } },
      }),
    )
    expect(await f.manager.status('mimo', f.cwd, f.signal)).toMatchObject({ state: 'unconfigured' })
    expect(f.backend.spawn).not.toHaveBeenCalled()
    const opened = await f.manager.start('synthetic-parent', 'mimo', 'login', f.cwd, f.signal)
    const spec = vi.mocked(f.backend.spawnTerminal!).mock.calls[0][0]
    expect(spec.cwd).not.toBe(f.cwd)
    expect(spec.env).toMatchObject({ MIMOCODE_DISABLE_PROJECT_CONFIG: '1', MIMOCODE_MIMO_ONLY: '1' })
    await f.manager.stop('synthetic-parent', opened.id)
    expect(f.manager.isBusy('mimo')).toBe(false)
    expect(existsSync(spec.cwd!)).toBe(false)
  })

  it('blocks task/account admission when native status cleanup cannot be confirmed', async () => {
    const onQueryCleanup = vi.fn()
    const f = fixture({}, onQueryCleanup)
    f.status('Logged in using an API key - SYNTHETIC_KEY')
    const original = f.backend.spawn
    f.backend.spawn = vi.fn((spec) => {
      const child = original(spec)
      vi.mocked(child.waitForExit).mockResolvedValue(false)
      return child
    })
    expect(await f.manager.status('codex', f.cwd, f.signal)).toMatchObject({
      state: 'unavailable',
      actions: [],
    })
    expect(f.manager.isBusy('codex')).toBe(true)
    expect(onQueryCleanup).toHaveBeenCalledExactlyOnceWith('codex', expect.objectContaining({
      name: 'ProcessCleanupUnconfirmedError',
    }))
    expect(() => f.manager.start('p', 'codex', 'login', f.cwd, f.signal)).toThrow('cleanup')
    expect(await f.manager.status('codex', f.cwd, f.signal)).toMatchObject({ state: 'unavailable' })
    expect(f.backend.spawn).toHaveBeenCalledTimes(1)
    expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
  })

  it('returns allowlisted summaries without API keys, account fields, or raw exceptions', async () => {
    const f = fixture()
    f.status('Logged in using an API key - sk-SECRET-DO-NOT-EXPOSE')
    const codex = await f.manager.status('codex', f.cwd, f.signal)
    expect(codex).toMatchObject({ state: 'authenticated', summary: 'API 登录', authMethod: 'api' })
    expect(JSON.stringify(codex)).not.toContain('SECRET')
    f.status(
      JSON.stringify({
        loggedIn: true,
        authMethod: 'oauth_token',
        email: 'private@example.com',
        accessToken: 'SECRET',
      }),
    )
    const claude = await f.manager.status('claude', f.cwd, f.signal)
    expect(claude).toMatchObject({
      state: 'unavailable',
      summary: 'Claude 官方登录来源无法确认，请使用原生登录',
    })
    expect(JSON.stringify(claude)).not.toMatch(/SECRET|private@example/)
    // The Codex app-server stays up and is terminated; a finished one-shot read empties its own range.
    expect(f.statusProcesses.map((child) => vi.mocked(child.terminate).mock.calls.length)).toEqual(
      f.statusProcesses.map((child) => (child.stdin ? 1 : 0)),
    )
    expect(f.statusProcesses.every((child) => vi.mocked(child.waitForExit).mock.calls.length === 1)).toBe(
      true,
    )
  })

  it('distinguishes configured, unknown, unconfigured, and query failures without guessing credentials', async () => {
    const f = fixture()
    f.status(
      JSON.stringify({
        providers: {
          'managed:kimi-code': { type: 'kimi', oauth: { storage: 'file', key: 'oauth/kimi-code' } },
        },
      }),
    )
    expect(await f.manager.status('kimi', f.cwd, f.signal)).toMatchObject({ state: 'unconfigured' })
    const kimiCall = vi.mocked(f.backend.spawn).mock.calls.at(-1)![0]
    expect(kimiCall.argv.slice(1)).toEqual(['provider', 'list', '--json'])
    mkdirSync(join(f.cwd, 'mimo/data'), { recursive: true })
    writeFileSync(
      join(f.cwd, 'mimo/data/auth.json'),
      JSON.stringify({
        xiaomi: { type: 'api', key: 'synthetic-mimo-key', metadata: { uid: 'private-uid' } },
      }),
    )
    const mimo = await f.manager.status('mimo', f.cwd, f.signal)
    expect(mimo).toMatchObject({ state: 'authenticated', authMethod: 'api', verification: 'local' })
    expect(JSON.stringify(mimo)).not.toContain('private-uid')
    f.status('Transport error with SECRET', 1)
    expect(await f.manager.status('codex', f.cwd, f.signal)).toMatchObject({ state: 'unavailable' })
    f.status('Not logged in', 1)
    expect(await f.manager.status('codex', f.cwd, f.signal)).toMatchObject({ state: 'unconfigured' })
    const count = vi.mocked(f.backend.spawn).mock.calls.length
    expect(await f.manager.status('antigravity', f.cwd, f.signal)).toMatchObject({
      state: 'unknown',
      installed: true,
    })
    expect(f.backend.spawn).toHaveBeenCalledTimes(count)
  })

  it('only projects the account returned for the current authenticated session', async () => {
    const f = fixture()
    f.identity.mockResolvedValue({
      state: 'authenticated',
      summary: 'Local',
      authMethod: 'oauth',
      accountLabel: 'person@example.com',
      verification: 'local',
    })
    f.codexAccount({ type: 'chatgpt', email: 'person@example.com' })
    f.status('Logged in using ChatGPT')
    expect(await f.manager.status('codex', f.cwd, f.signal)).toMatchObject({
      accountLabel: 'person@example.com',
      authMethod: 'oauth',
      verification: 'cli',
    })
    expect(f.backend.spawn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(f.backend.spawn).mock.calls[0]![0].argv).toContain('app-server')
    f.codexAccount(null)
    f.status('Not logged in', 1)
    const loggedOut = await f.manager.status('codex', f.cwd, f.signal)
    expect(loggedOut.state).toBe('unconfigured')
    expect(loggedOut.accountLabel).toBeUndefined()
    f.codexAccount({ type: 'apiKey' })
    f.status('Logged in using an API key - sk-SECRET')
    const api = await f.manager.status('codex', f.cwd, f.signal)
    expect(api.authMethod).toBe('api')
    expect(api.accountLabel).toBeUndefined()
    expect(f.identity).not.toHaveBeenCalled()
  })

  it('shows Claude email only for a confirmed claude.ai status and clears it after logout', async () => {
    const f = fixture()
    f.status(
      JSON.stringify({
        loggedIn: true,
        authMethod: 'claude.ai',
        email: 'person@example.com',
        accessToken: 'SECRET',
        orgId: 'PRIVATE',
      }),
    )
    const loggedIn = await f.manager.status('claude', f.cwd, f.signal)
    expect(loggedIn).toMatchObject({
      state: 'authenticated',
      accountLabel: 'person@example.com',
      authMethod: 'oauth',
    })
    expect(JSON.stringify(loggedIn)).not.toMatch(/SECRET|PRIVATE/)
    f.status(JSON.stringify({ loggedIn: false, authMethod: 'claude.ai', email: 'person@example.com' }), 1)
    expect((await f.manager.status('claude', f.cwd, f.signal)).accountLabel).toBeUndefined()
    f.status(
      JSON.stringify({
        loggedIn: true,
        authMethod: 'api_key',
        email: 'person@example.com',
        apiKeySource: 'sk-SECRET',
      }),
    )
    mkdirSync(join(f.cwd, 'claude'), { recursive: true })
    writeFileSync(
      join(f.cwd, 'claude/settings.json'),
      JSON.stringify({ env: { ANTHROPIC_API_KEY: 'synthetic-own-key' } }),
    )
    const api = await f.manager.status('claude', f.cwd, f.signal)
    expect(api).toMatchObject({ state: 'authenticated', authMethod: 'api' })
    expect(api.accountLabel).toBeUndefined()
    expect(JSON.stringify(api)).not.toContain('SECRET')
  })

  it('pins Claude status to current synthetic CC Switch settings and clears stale inherited routing', async () => {
    const f = fixture()
    const path = join(f.cwd, 'claude/settings.json')
    const settings = JSON.stringify({
      model: 'synthetic-current-model[1m]',
      env: {
        ANTHROPIC_AUTH_TOKEN: 'synthetic-current-router-key',
        ANTHROPIC_BASE_URL: 'https://current-router.example.test',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'synthetic-current-sonnet[1m]',
      },
    })
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, settings, { mode: 0o600 })
    for (const [key, value] of Object.entries({
      ANTHROPIC_AUTH_TOKEN: 'synthetic-stale-key',
      ANTHROPIC_API_KEY: 'synthetic-stale-api-key',
      ANTHROPIC_BASE_URL: 'https://stale-router.example.test',
      CLAUDE_CODE_USE_BEDROCK: '1',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'synthetic-stale-model',
    }))
      vi.stubEnv(key, value)
    f.status(JSON.stringify({ loggedIn: true, authMethod: 'oauth_token' }))

    expect(await f.manager.status('claude', f.cwd, f.signal)).toMatchObject({
      state: 'authenticated',
      authMethod: 'api',
    })
    const launch = f.claudeStatusLaunches.at(-1)!
    expect(launch.argv.slice(-3)).toEqual(['auth', 'status', '--json'])
    expect(launch.path).toBeDefined()
    expect(launch.settings).toMatchObject({
      model: 'synthetic-current-model[1m]',
      env: {
        ANTHROPIC_AUTH_TOKEN: 'synthetic-current-router-key',
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_BASE_URL: 'https://current-router.example.test',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'synthetic-current-sonnet[1m]',
      },
    })
    expect(launch.env).toMatchObject({
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_BASE_URL: '',
      CLAUDE_CODE_USE_BEDROCK: '',
      ANTHROPIC_DEFAULT_SONNET_MODEL: '',
    })
    expect(JSON.stringify(launch.argv)).not.toMatch(/synthetic-current-router-key|current-router\.example/)
    expect(existsSync(launch.path!)).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(settings)
  })

  it('removes the private Claude status snapshot after an authentication rejection without switching accounts', async () => {
    const f = fixture()
    const path = join(f.cwd, 'claude/settings.json')
    mkdirSync(dirname(path), { recursive: true })
    const settings = JSON.stringify({
      env: { ANTHROPIC_API_KEY: 'synthetic-rejected-route', ANTHROPIC_BASE_URL: 'https://own.example.test' },
    })
    writeFileSync(path, settings, { mode: 0o600 })
    f.status(JSON.stringify({ loggedIn: false, authMethod: 'none' }), 1)
    expect(await f.manager.status('claude', f.cwd, f.signal)).toMatchObject({ state: 'unavailable' })
    expect(f.backend.spawn).toHaveBeenCalledOnce()
    const launch = f.claudeStatusLaunches[0]!
    expect(launch.path).toBeDefined()
    expect(existsSync(launch.path!)).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(settings)
  })

  it('uses safe local Antigravity identity without launching any login or task process', async () => {
    const f = fixture()
    f.identity.mockResolvedValue({
      state: 'authenticated',
      summary: '已登录 Antigravity',
      authMethod: 'oauth',
      accountLabel: 'person@example.com',
      verification: 'local',
    })
    expect(await f.manager.status('antigravity', f.cwd, f.signal)).toMatchObject({
      state: 'authenticated',
      accountLabel: 'person@example.com',
      verification: 'local',
    })
    expect(f.backend.spawn).not.toHaveBeenCalled()
    expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
    f.identity.mockResolvedValue({ state: 'unauthenticated', summary: '尚未登录', verification: 'local' })
    expect((await f.manager.status('antigravity', f.cwd, f.signal)).accountLabel).toBeUndefined()
  })

  it('bounds oversized discovery and turns executable failures into safe unavailable summaries', async () => {
    const f = fixture()
    f.status('SECRET'.repeat(15_000))
    const result = await f.manager.status('claude', f.cwd, f.signal)
    expect(result.state).toBe('unavailable')
    expect(JSON.stringify(result)).not.toContain('SECRET')
    vi.mocked(f.backend.resolveExecutable).mockRejectedValue(new Error('file contains SECRET'))
    const missing = await f.manager.status('codex', f.cwd, f.signal)
    expect(missing).toMatchObject({ state: 'unconfigured', installed: false, actions: [] })
    expect(JSON.stringify(missing)).not.toContain('SECRET')
  })

  it('reports a mismatched CLI identity distinctly and never opens its account terminal', async () => {
    const f = fixture()
    vi.mocked(f.backend.resolveExecutable).mockRejectedValue(
      Object.assign(new Error('SECRET native mismatch'), { code: 'CLI_IDENTITY_MISMATCH' }),
    )
    const status = await f.manager.status('omp', f.cwd, f.signal)
    expect(status).toMatchObject({
      installed: true,
      state: 'unavailable',
      actions: [],
      summary: expect.stringContaining('OMP 执行入口身份不匹配'),
    })
    expect(JSON.stringify(status)).not.toContain('SECRET')
    expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
  })

  it('distinguishes an installed unsupported launcher from a missing installation', async () => {
    const f = fixture()
    vi.mocked(f.backend.resolveExecutable).mockRejectedValue(
      Object.assign(new Error('private installation error'), { code: 'CLI_LAUNCHER_UNSUPPORTED' }),
    )
    expect(await f.manager.status('opencode', f.cwd, f.signal)).toMatchObject({
      installed: true,
      state: 'unavailable',
      actions: [],
      summary: 'CLI 启动入口无法确认，请配置原生程序或固定 Node/Bun 入口',
    })
  })

  it('status lookup can be cancelled before spawn and does not launch an account process', async () => {
    const f = fixture()
    const resolution = deferred<string>()
    vi.mocked(f.backend.resolveExecutable).mockReturnValueOnce(resolution.promise)
    const controller = new AbortController()
    const operation = f.manager.status('codex', f.cwd, controller.signal)
    controller.abort()
    await expect(operation).rejects.toThrow('已取消')
    resolution.resolve('/synthetic/codex')
    await tick()
    expect(f.backend.spawn).not.toHaveBeenCalled()
    expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
  })

  it('shares overlapping status reads while one reader can cancel independently', async () => {
    const f = fixture()
    const resolution = deferred<string>()
    vi.mocked(f.backend.resolveExecutable).mockReturnValueOnce(resolution.promise)
    f.status(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'synthetic@example.com' }))
    const first = new AbortController()
    const a = f.manager.status('claude', f.cwd, first.signal)
    const b = f.manager.status('claude', f.cwd, f.signal)
    first.abort()
    await expect(a).rejects.toThrow('已取消')
    expect(f.backend.resolveExecutable).toHaveBeenCalledTimes(1)
    resolution.resolve('/synthetic/claude')
    await expect(b).resolves.toMatchObject({ state: 'authenticated' })
    expect(f.backend.spawn).toHaveBeenCalledTimes(1)
    f.status(JSON.stringify({ loggedIn: false }))
    await expect(f.manager.status('claude', f.cwd, f.signal)).resolves.toMatchObject({
      state: 'unconfigured',
    })
    expect(f.backend.spawn).toHaveBeenCalledTimes(2)
  })

  it('keeps different CLI/project status requests independent and concurrent', async () => {
    const f = fixture()
    const otherProject = join(f.cwd, 'other-project')
    mkdirSync(otherProject)
    const resolutions = [deferred<string>(), deferred<string>(), deferred<string>()]
    for (const resolution of resolutions)
      vi.mocked(f.backend.resolveExecutable).mockReturnValueOnce(resolution.promise)
    const operations = [
      f.manager.status('claude', f.cwd, f.signal),
      f.manager.status('claude', otherProject, f.signal),
      f.manager.status('kimi', f.cwd, f.signal),
    ]
    expect(f.backend.resolveExecutable).toHaveBeenCalledTimes(3)
    resolutions.forEach((value, i) => value.resolve(`/synthetic/${i === 2 ? 'kimi' : 'claude'}`))
    await Promise.all(operations)
    expect(f.backend.spawn).toHaveBeenCalledTimes(3)
  })

  it('waits for the last cancelled reader cleanup before allowing a fresh query', async () => {
    const f = fixture()
    const output = new PassThrough()
    const done = deferred<SubprocessOutcome>()
    const cleanup = deferred<boolean>()
    const controller = new AbortController()
    vi.mocked(f.backend.spawn).mockReturnValueOnce({
      stdout: output,
      stderr: undefined,
      stdin: undefined,
      control: undefined,
      collected: {},
      done: done.promise,
      terminate: vi.fn(() => {
        output.end()
        done.resolve({ exitCode: null, signal: 'SIGTERM' })
      }),
      waitForExit: () => cleanup.promise,
    })
    const old = f.manager.status('claude', f.cwd, controller.signal)
    const rejection = expect(old).rejects.toThrow('已取消')
    await vi.waitFor(() => expect(f.backend.spawn).toHaveBeenCalledTimes(1))
    controller.abort()
    let cancelled = false
    void old.catch(() => {
      cancelled = true
    })
    const next = f.manager.status('claude', f.cwd, f.signal)
    await tick()
    expect(cancelled).toBe(false)
    expect(f.backend.spawn).toHaveBeenCalledTimes(1)
    cleanup.resolve(true)
    await rejection
    await next
    expect(f.backend.spawn).toHaveBeenCalledTimes(2)
  })

  it('keeps absent default installations grey but reports explicit executable and read errors', async () => {
    const missing = Object.assign(new Error('synthetic SECRET'), { code: 'ENOENT' })
    const absent = fixture()
    // Windows refreshes PATH before Appx discovery. Both synthetic metadata
    // queries report absence, without consulting this machine's installed bins.
    absent.status('null')
    if (process.platform === 'win32') {
      vi.stubEnv('PATH', join(absent.cwd, 'synthetic empty PATH'))
      const spawn = vi.mocked(absent.backend.spawn).getMockImplementation()!
      vi.mocked(absent.backend.spawn).mockImplementation((spec) => {
        const encoded = spec.argv[spec.argv.indexOf('-EncodedCommand') + 1]!
        const query = Buffer.from(encoded, 'base64').toString('utf16le')
        expect([WINDOWS_PATH_QUERY, CODEX_APPX_QUERY]).toContain(query)
        absent.status(query === WINDOWS_PATH_QUERY ? JSON.stringify({ user: '', machine: '' }) : 'null')
        return spawn(spec)
      })
    }
    vi.mocked(absent.backend.resolveExecutable).mockRejectedValue(missing)
    expect(await absent.manager.status('codex', absent.cwd, absent.signal)).toMatchObject({
      state: 'unconfigured',
      installed: false,
      actions: [],
    })
    if (process.platform === 'win32') {
      expect(absent.backend.spawn).toHaveBeenCalledTimes(2)
      for (const [index, query] of [WINDOWS_PATH_QUERY, CODEX_APPX_QUERY].entries()) {
        const lookup = vi.mocked(absent.backend.spawn).mock.calls[index][0]
        expect(lookup.argv[0]).toMatch(/[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/i)
        expect(lookup.argv.slice(1)).toEqual([
          '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
          Buffer.from(query, 'utf16le').toString('base64'),
        ])
        expect(lookup.stdio).toEqual({ stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
        expect(absent.statusProcesses[index].terminate).toHaveBeenCalledOnce()
        expect(absent.statusProcesses[index].waitForExit).toHaveBeenCalledOnce()
      }
    } else {
      expect(absent.backend.spawn).not.toHaveBeenCalled()
    }
    expect(absent.backend.spawnTerminal).not.toHaveBeenCalled()
    // A read error must not start even another metadata query on either platform.
    vi.mocked(absent.backend.spawn).mockClear()
    const custom = fixture({ codexExecutable: '/synthetic/missing-codex' })
    vi.mocked(custom.backend.resolveExecutable).mockRejectedValue(missing)
    const failed = await custom.manager.status('codex', custom.cwd, custom.signal)
    expect(failed).toMatchObject({
      state: 'unavailable',
      installed: false,
      summary: expect.stringContaining('执行路径配置失败'),
    })
    expect(JSON.stringify(failed)).not.toContain('SECRET')
    vi.mocked(absent.backend.resolveExecutable).mockRejectedValue(
      Object.assign(new Error('SECRET'), { code: 'EACCES' }),
    )
    expect(await absent.manager.status('codex', absent.cwd, absent.signal)).toMatchObject({
      state: 'unavailable',
      installed: false,
    })
    expect(absent.backend.spawn).not.toHaveBeenCalled()
    expect(custom.backend.spawn).not.toHaveBeenCalled()
    expect(absent.backend.spawnTerminal).not.toHaveBeenCalled()
    expect(custom.backend.spawnTerminal).not.toHaveBeenCalled()
  })

  it('distinguishes fresh absence, malformed responses and explicit authentication rejection', async () => {
    const f = fixture()
    f.status(JSON.stringify({ providers: {} }))
    expect(await f.manager.status('kimi', f.cwd, f.signal)).toMatchObject({ state: 'unconfigured' })
    f.status('Not logged in. Run `mimo auth login` to log in.')
    expect(await f.manager.status('mimo', f.cwd, f.signal)).toMatchObject({ state: 'unconfigured' })
    f.status('{SECRET malformed')
    expect(await f.manager.status('claude', f.cwd, f.signal)).toMatchObject({ state: 'unavailable' })
    f.status('Authentication failed: invalid token SECRET', 1)
    const invalid = await f.manager.status('codex', f.cwd, f.signal)
    expect(invalid).toMatchObject({ state: 'unauthenticated', summary: expect.stringContaining('认证失效') })
    expect(JSON.stringify(invalid)).not.toContain('SECRET')
    f.status('Logged in using an API key - SECRET')
    expect(await f.manager.status('codex', f.cwd, f.signal)).toMatchObject({ state: 'authenticated' })
    expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
  })

  it('times out a stalled status query and awaits its process cleanup', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const stream = new PassThrough()
    const outcome = deferred<SubprocessOutcome>()
    const child = {
      stdin: undefined,
      stdout: stream,
      stderr: undefined,
      control: undefined,
      collected: {},
      done: outcome.promise,
      terminate: vi.fn(() => {
        stream.end()
        outcome.resolve({ exitCode: null, signal: 'SIGTERM' })
      }),
      waitForExit: vi.fn(async () => true),
    }
    vi.mocked(f.backend.spawn).mockReturnValueOnce(child)
    const reading = f.manager.status('claude', f.cwd, f.signal)
    await vi.waitFor(() => expect(f.backend.spawn).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await reading).toMatchObject({ state: 'unavailable', installed: true })
    expect(child.terminate).toHaveBeenCalledTimes(1)
    expect(child.waitForExit).toHaveBeenCalledTimes(1)
  })
})

describe('user-operated account terminals (synthetic PTY)', () => {
  it.each(['login', 'logout'] as const)(
    'opens Claude official %s despite malformed synthetic CC Switch routing and stale ambient auth',
    async (action) => {
      const f = fixture()
      const path = join(f.cwd, 'claude/settings.json')
      // This is valid settings JSON with unusable API routing, never a real secret.
      const settings = JSON.stringify({
        apiKeyHelper: 'synthetic-unused-helper',
        env: {
          ANTHROPIC_BASE_URL: 'synthetic-invalid-endpoint',
          ANTHROPIC_API_KEY: 'synthetic-own key with spaces',
          ANTHROPIC_AUTH_TOKEN: 'synthetic-own-bearer',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'synthetic-router-model',
        },
      })
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, settings, { mode: 0o600 })
      vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'synthetic-stale-router')
      vi.stubEnv('ANTHROPIC_BASE_URL', 'https://stale.example.test')
      vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'synthetic-stale-oauth')
      vi.stubEnv('CLAUDE_CODE_USE_BEDROCK', '1')
      const opened = await f.manager.start('parent', 'claude', action, f.cwd, f.signal)
      const spec = vi.mocked(f.backend.spawnTerminal!).mock.calls[0]![0]
      expect(spec.argv.slice(3)).toEqual(['auth', action, ...(action === 'login' ? ['--claudeai'] : [])])
      expect(JSON.parse(spec.argv[2]!)).toMatchObject({
        apiKeyHelper: '',
        env: {
          CLAUDE_CONFIG_DIR: join(f.cwd, 'claude'),
          ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
          ANTHROPIC_AUTH_TOKEN: '',
          ANTHROPIC_API_KEY: '',
          CLAUDE_CODE_OAUTH_TOKEN: '',
          CLAUDE_CODE_USE_BEDROCK: '',
          ANTHROPIC_DEFAULT_SONNET_MODEL: '',
        },
      })
      expect(spec.env).toMatchObject({
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_BASE_URL: '',
        CLAUDE_CODE_OAUTH_TOKEN: '',
        CLAUDE_CODE_USE_BEDROCK: '',
      })
      expect(f.backend.spawn).not.toHaveBeenCalled()
      expect(f.terminal.write).not.toHaveBeenCalled()
      expect(JSON.stringify(spec.argv)).not.toContain('synthetic-own-bearer')
      await f.manager.stop('parent', opened.id)
      expect(readFileSync(path, 'utf8')).toBe(settings)
      expect(f.manager.isBusy('claude')).toBe(false)
    },
  )

  it.each(['CLAUDE_CONFIG_DIR', 'HOME', 'USERPROFILE', 'XDG_CONFIG_HOME'])(
    'rejects Claude official login when own settings redirect %s to another account store',
    async (key) => {
      const f = fixture()
      const path = join(f.cwd, 'claude/settings.json')
      mkdirSync(dirname(path), { recursive: true })
      const settings = JSON.stringify({ env: { [key]: join(f.cwd, 'another-account') } })
      writeFileSync(path, settings, { mode: 0o600 })
      await expect(f.manager.start('parent', 'claude', 'login', f.cwd, f.signal)).rejects.toThrow()
      expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
      expect(f.backend.spawn).not.toHaveBeenCalled()
      expect(readFileSync(path, 'utf8')).toBe(settings)
      expect(f.manager.isBusy('claude')).toBe(false)
    },
  )

  it('AGY background updater suppression never changes the Windows interactive account environment', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
    vi.stubEnv('AGY_CLI_DISABLE_AUTO_UPDATE', 'false')
    const f = fixture()
    try {
      const opened = await f.manager.start('parent', 'antigravity', 'login', f.cwd, f.signal)
      const spec = vi.mocked(f.backend.spawnTerminal!).mock.calls[0]![0]
      expect(spec.env).toEqual({})
      expect(process.env.AGY_CLI_DISABLE_AUTO_UPDATE).toBe('false')
      expect(f.backend.spawn).not.toHaveBeenCalled()
      await f.manager.stop('parent', opened.id)
    } finally {
      await f.manager.close()
      Object.defineProperty(process, 'platform', platform)
    }
  })

  it.each([
    { env: { ANTHROPIC_API_KEY: 'synthetic-managed-key' } },
    { env: { CLAUDE_CONFIG_DIR: '/synthetic/managed-account' } },
    { apiKeyHelper: 'synthetic-managed-helper' },
  ])('rejects Claude official login under unoverridable synthetic managed settings %j', async (managed) => {
    const f = fixture()
    claudeSettings.managed = managed
    await expect(f.manager.start('parent', 'claude', 'login', f.cwd, f.signal)).rejects.toThrow()
    expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
    expect(f.backend.spawn).not.toHaveBeenCalled()
    expect(f.manager.isBusy('claude')).toBe(false)
  })

  it('opens an actionable Kimi management TUI for the current login without logging out or forcing auth', async () => {
    const f = fixture({ kimiExecutable: '/synthetic/kimi' })
    mkdirSync(join(f.cwd, 'kimi/credentials'), { recursive: true })
    const tokenPath = join(f.cwd, 'kimi/credentials/kimi-code.json')
    const token = JSON.stringify({
      access_token: 'synthetic-current',
      refresh_token: 'synthetic-refresh',
      expires_at: 0,
    })
    writeFileSync(tokenPath, token, { mode: 0o600 })
    f.status(
      JSON.stringify({
        providers: {
          'managed:kimi-code': { type: 'kimi', oauth: { storage: 'file', key: 'oauth/kimi-code' } },
        },
      }),
    )
    const status = await f.manager.status('kimi', f.cwd, f.signal)
    expect(status.state).toBe('authenticated')
    expect(status.actions.find((item) => item.id === 'login')?.label).toBe('管理登录')
    const opened = await f.manager.start('p', 'kimi', 'login', f.cwd, f.signal)
    const spec = vi.mocked(f.backend.spawnTerminal!).mock.calls[0]![0]
    expect(spec.argv).toEqual(['/synthetic/kimi'])
    expect(spec.cwd).not.toBe(f.cwd)
    expect(existsSync(join(spec.cwd, '.git'))).toBe(true)
    expect(JSON.parse(readFileSync(join(spec.cwd, '.mcp.json'), 'utf8'))).toEqual({ mcpServers: {} })
    expect(opened.instruction).toContain('/logout')
    expect(opened.instruction).toContain('/login')
    expect(opened.instruction).toContain('Trust')
    expect(f.terminal.write).not.toHaveBeenCalled()
    expect(JSON.stringify(spec.argv)).not.toMatch(/logout|force|synthetic-current/)
    await expect((await import('node:fs/promises')).readFile(tokenPath, 'utf8')).resolves.toBe(token)
    await f.manager.stop('p', opened.id)
    expect(existsSync(spec.cwd)).toBe(false)
    await expect((await import('node:fs/promises')).readFile(tokenPath, 'utf8')).resolves.toBe(token)
  })

  it.each([
    ['codex', 'login', ['login']],
    ['claude', 'logout', ['auth', 'logout']],
    ['mimo', 'login', ['auth', 'login']],
    ['kimi', 'login', ['login']],
    ['kimi', 'logout', []],
    ['antigravity', 'login', []],
    ['antigravity', 'logout', []],
  ] as const)('%s %s uses only its verified argv and never injects input', async (cli, action, expected) => {
    const f = fixture()
    const opened = await f.manager.start('parent', cli, action, f.cwd, f.signal)
    const spec = vi.mocked(f.backend.spawnTerminal!).mock.calls[0][0]
    expect(spec.argv.slice(cli === 'claude' ? 3 : 1)).toEqual(expected)
    if (cli === 'mimo' || cli === 'kimi') expect(spec.cwd).not.toBe(f.cwd)
    else expect(spec.cwd).toBe(f.cwd)
    expect(spec.terminalType).toBe('xterm-256color')
    expect(f.terminal.write).not.toHaveBeenCalled()
    if (cli === 'antigravity' && action === 'login') expect(opened.instruction).toContain('完成登录')
    else if (cli === 'antigravity' || (cli === 'kimi' && action === 'logout'))
      expect(opened.instruction).toContain(`/${action}`)
    await f.manager.stop('parent', opened.id)
  })

  it('reserves a CLI before asynchronous startup and isolates every terminal operation by parent', async () => {
    const f = fixture()
    const resolution = deferred<string>()
    vi.mocked(f.backend.resolveExecutable).mockReturnValueOnce(resolution.promise)
    const first = f.manager.start('parent-a', 'codex', 'login', f.cwd, f.signal)
    expect(f.manager.isBusy('codex')).toBe(true)
    expect(f.manager.isBusy('claude')).toBe(false)
    expect(() => f.manager.start('parent-b', 'codex', 'login', f.cwd, f.signal)).toThrow('已有账号终端')
    resolution.resolve('/synthetic/codex')
    const { id } = await first
    await expect(f.manager.write('parent-b', id, 'text')).rejects.toThrow('不属于')
    await expect(f.manager.resize('parent-b', id, 90, 24)).rejects.toThrow('不属于')
    await expect(f.manager.stop('parent-b', id)).rejects.toThrow('不属于')
    await expect(f.manager.watch('parent-b', id, f.signal)[Symbol.asyncIterator]().next()).rejects.toThrow(
      '不属于',
    )
    expect(f.terminal.write).not.toHaveBeenCalled()
    await f.manager.write('parent-a', id, 'input\r')
    expect(f.terminal.write).toHaveBeenCalledWith('input\r')
  })

  it('rejects invalid actions, huge input and invalid terminal sizes', async () => {
    const f = fixture()
    expect(() => f.manager.start('p', 'codex', 'delete' as any, f.cwd, f.signal)).toThrow('不支持')
    expect(() => f.manager.start('p', 'shell' as CliId, 'manage', f.cwd, f.signal)).toThrow('不支持')
    const { id } = await f.manager.start('p', 'codex', 'manage', f.cwd, f.signal)
    await expect(f.manager.write('p', id, 'x'.repeat(16_385))).rejects.toThrow('超过限制')
    await expect(f.manager.resize('p', id, Infinity, 0)).rejects.toThrow('无效')
    expect(f.terminal.write).not.toHaveBeenCalled()
    expect(f.terminal.resize).not.toHaveBeenCalled()
  })

  it('does not report closed or release the CLI until the whole PTY session is gone', async () => {
    const f = fixture()
    const { id } = await f.manager.start('p', 'claude', 'login', f.cwd, f.signal)
    f.delayCleanup()
    let stopped = false
    const stop = f.manager.stop('p', id).then(() => {
      stopped = true
    })
    await tick()
    expect(stopped).toBe(false)
    expect(() => f.manager.start('p', 'claude', 'login', f.cwd, f.signal)).toThrow('已有账号终端')
    await expect(f.manager.write('p', id, 'late')).rejects.toThrow('已关闭')
    f.finishCleanup()
    await stop
    const frames = []
    for await (const frame of f.manager.watch('p', id, f.signal)) frames.push(frame)
    expect(frames.at(-1)).toMatchObject({ status: 'closed', cleanupConfirmed: true })
    expect(f.terminal.terminate).toHaveBeenCalledTimes(1)
  })

  it.each(['closed', 'failed'] as const)('delivers %s after cleanup completes while watch is paused at yield (模拟)', async (status) => {
    const f = fixture()
    const { id } = await f.manager.start('p', 'claude', 'login', f.cwd, f.signal)
    const watch = f.manager.watch('p', id, f.signal)[Symbol.asyncIterator]()
    expect((await watch.next()).value).toMatchObject({ status: 'running' })
    if (status === 'failed') {
      vi.mocked(f.terminal.terminate).mockRejectedValueOnce(new Error('模拟清理失败'))
      await expect(f.manager.stop('p', id)).rejects.toThrow('账号终端尚未确认完全退出')
    } else {
      await f.manager.stop('p', id)
    }
    const frames = []
    for (;;) {
      const next = await watch.next()
      if (next.done) break
      frames.push(next.value)
    }
    expect(frames.at(-1)).toMatchObject({ status })
    expect(frames.at(-1)?.cleanupConfirmed).toBe(status === 'closed' ? true : undefined)
    expect(frames.filter((frame) => frame.status === status)).toHaveLength(1)
  })

  it('ends a paused watch when closed frames have expired (模拟)', async () => {
    const f = fixture()
    const { id } = await f.manager.start('p', 'claude', 'login', f.cwd, f.signal)
    const watch = f.manager.watch('p', id, f.signal)[Symbol.asyncIterator]()
    await watch.next()
    vi.useFakeTimers()
    await f.manager.stop('p', id)
    await vi.advanceTimersByTimeAsync(60_000)
    expect((await watch.next()).done).toBe(true)
  })

  it('bounds retained output and preserves UTF8 chunks without persisting to worker records', async () => {
    const f = fixture()
    const { id } = await f.manager.start('p', 'codex', 'login', f.cwd, f.signal)
    f.output.write('X'.repeat(300_000))
    const bytes = Buffer.from('你好')
    for (const byte of bytes) f.output.write(Buffer.from([byte]))
    await tick()
    await f.manager.stop('p', id)
    const frames = []
    for await (const frame of f.manager.watch('p', id, f.signal)) frames.push(frame)
    const text = frames.map((frame) => frame.data ?? '').join('')
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(256 * 1024)
    expect(text.endsWith('你好')).toBe(true)
    expect(frames[0].message).toContain('已从内存释放')
    expect(frames.every((frame, index) => index === 0 || frame.seq > frames[index - 1].seq)).toBe(true)
  })

  it('watch cancellation stops the owned terminal and waits for cleanup', async () => {
    const f = fixture()
    const { id } = await f.manager.start('p', 'kimi', 'manage', f.cwd, f.signal)
    const controller = new AbortController()
    const watch = f.manager.watch('p', id, controller.signal)[Symbol.asyncIterator]()
    expect((await watch.next()).value).toMatchObject({ status: 'running' })
    const next = watch.next()
    controller.abort()
    expect(await next).toMatchObject({ done: true })
    expect(f.terminal.terminate).toHaveBeenCalledTimes(1)
  })

  it('manager shutdown cancels a pending startup before it can publish a terminal', async () => {
    const f = fixture()
    const allocated = deferred<SubprocessTerminalHandle>()
    vi.mocked(f.backend.spawnTerminal!).mockReturnValueOnce(allocated.promise)
    const opened = f.manager.start('p', 'codex', 'login', f.cwd, f.signal)
    await tick()
    const rejected = expect(opened).rejects.toThrow('已取消')
    const closed = f.manager.close()
    allocated.resolve(f.terminal)
    await rejected
    await closed
    expect(f.terminal.terminate).toHaveBeenCalledTimes(1)
    expect(() => f.manager.start('p', 'codex', 'login', f.cwd, f.signal)).toThrow()
  })

  it('times out a stalled PTY allocation promptly and cleans its late process before allowing retry', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const allocated = deferred<SubprocessTerminalHandle>()
    vi.mocked(f.backend.spawnTerminal!).mockReturnValueOnce(allocated.promise)
    const opening = f.manager.start('p', 'codex', 'login', f.cwd, f.signal)
    const failed = expect(opening).rejects.toThrow('启动超时')
    await vi.advanceTimersByTimeAsync(30_000)
    await failed
    expect(f.manager.isBusy('codex')).toBe(true)
    expect(vi.mocked(f.backend.spawnTerminal!).mock.calls[0]![0].signal?.aborted).toBe(true)
    expect(() => f.manager.start('p', 'codex', 'login', f.cwd, f.signal)).toThrow('已有账号终端')
    allocated.resolve(f.terminal)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.terminal.terminate).toHaveBeenCalledOnce()
    expect(f.manager.isBusy('codex')).toBe(false)
  })

  it('keeps a connected login terminal alive beyond startup timeout and request cancellation', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const request = new AbortController()
    const { id } = await f.manager.start('p', 'antigravity', 'login', f.cwd, request.signal)
    const watching = f.manager.watch('p', id, f.signal)[Symbol.asyncIterator]()
    await watching.next()
    const spec = vi.mocked(f.backend.spawnTerminal!).mock.calls[0]![0]
    await vi.advanceTimersByTimeAsync(31_000)
    request.abort()
    expect(spec.signal?.aborted).toBe(false)
    expect(f.terminal.terminate).not.toHaveBeenCalled()
    await f.manager.write('p', id, '/login\r')
    expect(f.terminal.write).toHaveBeenCalledWith('/login\r')
    await f.manager.stop('p', id)
    await watching.return?.()
  })

  it('returns cancellation before a slow provider settles but retains ownership until cleanup', async () => {
    const f = fixture()
    const allocated = deferred<SubprocessTerminalHandle>()
    vi.mocked(f.backend.spawnTerminal!).mockReturnValueOnce(allocated.promise)
    const request = new AbortController()
    const opening = f.manager.start('p', 'codex', 'login', f.cwd, request.signal)
    await tick()
    const failed = expect(opening).rejects.toThrow('已取消')
    request.abort()
    await failed
    expect(f.manager.isBusy('codex')).toBe(true)
    allocated.resolve(f.terminal)
    await tick()
    expect(f.terminal.terminate).toHaveBeenCalledOnce()
    expect(f.manager.isBusy('codex')).toBe(false)
  })

  it('releases a rejected allocation for retry without exposing provider errors', async () => {
    const f = fixture()
    vi.mocked(f.backend.spawnTerminal!).mockRejectedValueOnce(new Error('SECRET provider details'))
    await expect(f.manager.start('p', 'claude', 'login', f.cwd, f.signal)).rejects.toThrow('无法启动账号终端')
    expect(f.manager.isBusy('claude')).toBe(false)
    expect((await f.manager.start('p', 'claude', 'login', f.cwd, f.signal)).id).toBeTruthy()
  })

  it('closing a parent cancels its pending allocation without affecting a different parent', async () => {
    const f = fixture()
    const other = fixture()
    const allocated = deferred<SubprocessTerminalHandle>()
    vi.mocked(f.backend.spawnTerminal!)
      .mockReturnValueOnce(allocated.promise)
      .mockResolvedValueOnce(other.terminal)
    const opening = f.manager.start('p1', 'codex', 'login', f.cwd, f.signal)
    await tick()
    const running = await f.manager.start('p2', 'claude', 'login', f.cwd, f.signal)
    const failed = expect(opening).rejects.toThrow('已取消')
    const closing = f.manager.closeParent('p1')
    expect(f.manager.isBusy('codex')).toBe(true)
    allocated.resolve(f.terminal)
    await failed
    await closing
    expect(f.manager.isBusy('codex')).toBe(false)
    expect(f.manager.isBusy('claude')).toBe(true)
    expect(f.terminal.terminate).toHaveBeenCalledTimes(1)
    expect(other.terminal.terminate).not.toHaveBeenCalled()
    await f.manager.write('p2', running.id, 'still here')
    expect(other.terminal.write).toHaveBeenCalledWith('still here')
  })

  it('allows a fresh parent lifetime while the old one is waiting for cleanup', async () => {
    const f = fixture()
    const fresh = fixture()
    vi.mocked(f.backend.spawnTerminal!)
      .mockResolvedValueOnce(f.terminal)
      .mockResolvedValueOnce(fresh.terminal)
    await f.manager.start('same-parent', 'codex', 'login', f.cwd, f.signal)
    f.delayCleanup()
    const closing = f.manager.closeParent('same-parent')
    const newTerminal = await f.manager.start('same-parent', 'claude', 'login', f.cwd, f.signal)
    f.finishCleanup()
    await closing
    expect(fresh.terminal.terminate).not.toHaveBeenCalled()
    await f.manager.write('same-parent', newTerminal.id, 'new lifetime')
    expect(fresh.terminal.write).toHaveBeenCalledWith('new lifetime')
    await f.manager.closeParent('same-parent')
    expect(fresh.terminal.terminate).toHaveBeenCalledTimes(1)
  })

  it('closing a parent interrupts executable lookup and a late result cannot spawn', async () => {
    const f = fixture()
    const executable = deferred<string>()
    vi.mocked(f.backend.resolveExecutable).mockReturnValueOnce(executable.promise)
    const opening = f.manager.start('p', 'codex', 'login', f.cwd, f.signal)
    const failed = expect(opening).rejects.toThrow()
    await f.manager.closeParent('p')
    await failed
    executable.resolve('/synthetic/codex')
    await tick()
    expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
    expect(f.manager.isBusy('codex')).toBe(false)
    const opened = await f.manager.start('p', 'codex', 'login', f.cwd, f.signal)
    expect(opened.id).toBeTruthy()
  })

  it('a failed cleanup keeps the CLI reserved and stop retries instead of claiming success', async () => {
    const f = fixture()
    const { id } = await f.manager.start('p', 'codex', 'login', f.cwd, f.signal)
    vi.mocked(f.terminal.terminate).mockRejectedValueOnce(new Error('provider SECRET failure'))
    await expect(f.manager.stop('p', id)).rejects.toThrow('尚未确认完全退出')
    const before = []
    for await (const frame of f.manager.watch('p', id, f.signal)) before.push(frame)
    expect(before.at(-1)).toMatchObject({ status: 'failed' })
    expect(before.at(-1)?.cleanupConfirmed).not.toBe(true)
    expect(() => f.manager.start('p', 'codex', 'login', f.cwd, f.signal)).toThrow('已有账号终端')
    await f.manager.stop('p', id)
    const after = []
    for await (const frame of f.manager.watch('p', id, f.signal)) after.push(frame)
    expect(after.at(-1)).toMatchObject({ status: 'closed', cleanupConfirmed: true })
    expect(f.terminal.terminate).toHaveBeenCalledTimes(2)
  })

  it.skipIf(process.platform === 'win32')(
    'ends the CLI before terminal cleanup so a zombie helper cannot block closing',
    async () => {
      const f = fixture()
      const { id } = await f.manager.start('p', 'antigravity', 'login', f.cwd, f.signal)
      let exited = false
      void f.result.promise.then(() => (exited = true))
      // Synthetic host provider: an unreaped child keeps the session until its parent CLI has exited.
      vi.mocked(f.terminal.terminate).mockImplementationOnce(async () => {
        if (!exited) throw new Error('terminal cleanup failed; surviving pids: 456')
        f.output.end()
      })
      await f.manager.stop('p', id)
      expect(f.terminal.signalForeground).toHaveBeenCalledWith('SIGTERM')
      expect(f.manager.isBusy('antigravity')).toBe(false)
      const frames = []
      for await (const frame of f.manager.watch('p', id, f.signal)) frames.push(frame)
      expect(frames.at(-1)).toMatchObject({ status: 'closed', cleanupConfirmed: true })
    },
  )

  it.skipIf(process.platform === 'win32')('still cleans up a CLI that ignores SIGTERM after the grace period', async () => {
    const f = fixture({ graceMs: 20 })
    const { id } = await f.manager.start('p', 'antigravity', 'login', f.cwd, f.signal)
    vi.mocked(f.terminal.signalForeground).mockResolvedValueOnce(123)
    await f.manager.stop('p', id)
    expect(f.terminal.terminate).toHaveBeenCalledTimes(1)
    expect(f.manager.isBusy('antigravity')).toBe(false)
  })

  it('never signals a CLI that has already exited', async () => {
    const f = fixture()
    await f.manager.start('p', 'antigravity', 'login', f.cwd, f.signal)
    f.result.resolve({ exitCode: 0, signal: null })
    await vi.waitFor(() => expect(f.manager.isBusy('antigravity')).toBe(false))
    expect(f.terminal.signalForeground).not.toHaveBeenCalled()
    expect(f.terminal.terminate).toHaveBeenCalledTimes(1)
  })

  it('a startup cancellation that cannot clean up retains the CLI lock', async () => {
    const f = fixture()
    const allocated = deferred<SubprocessTerminalHandle>()
    vi.mocked(f.backend.spawnTerminal!).mockReturnValueOnce(allocated.promise)
    const controller = new AbortController()
    const opening = f.manager.start('p', 'codex', 'login', f.cwd, controller.signal)
    await tick()
    controller.abort()
    vi.mocked(f.terminal.terminate).mockRejectedValueOnce(new Error('cleanup failed'))
    allocated.resolve(f.terminal)
    await expect(opening).rejects.toThrow('清理失败')
    expect(f.manager.isBusy('codex')).toBe(true)
    expect(() => f.manager.start('p', 'codex', 'login', f.cwd, f.signal)).toThrow('已有账号终端')
    await f.manager.close()
    expect(f.terminal.terminate).toHaveBeenCalledTimes(2)
  })

  it('expires an account terminal after 30 minutes', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const { id } = await f.manager.start('p', 'codex', 'login', f.cwd, f.signal)
    const watching = f.manager.watch('p', id, f.signal)[Symbol.asyncIterator]()
    await watching.next()
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    const frames = []
    for await (const frame of f.manager.watch('p', id, f.signal)) frames.push(frame)
    expect(frames.at(-1)).toMatchObject({ status: 'closed', message: expect.stringContaining('30 分钟') })
    await watching.return?.()
  })

  it('closes an orphan terminal after 30 seconds if the client never attaches', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const { id } = await f.manager.start('p', 'codex', 'login', f.cwd, f.signal)
    await vi.advanceTimersByTimeAsync(30_000)
    const frames = []
    for await (const frame of f.manager.watch('p', id, f.signal)) frames.push(frame)
    expect(frames.at(-1)).toMatchObject({ status: 'closed', message: expect.stringContaining('未连接') })
    expect(f.manager.isBusy('codex')).toBe(false)
  })
})

describe('extended CLI account capabilities (synthetic credentials and PTYs)', () => {
  it.each(['bigmodel', 'zai'] as const)(
    'passes explicit %s to ZCode preparation without changing logout storage sources',
    async (provider) => {
      const f = fixture()
      const prepare = vi.spyOn(zcodeAccounts, 'zcodeGrokAccountLaunch').mockResolvedValueOnce({
        argv: ['/synthetic/zcode.cjs', 'login', provider],
        cwd: f.cwd,
        env: {},
        instruction: 'Synthetic provider-selected login',
      })
      try {
        const opened = await f.manager.start('parent', 'zcode', 'login', f.cwd, f.signal, undefined, provider)
        expect(prepare).toHaveBeenCalledExactlyOnceWith(
          'zcode',
          'login',
          expect.any(String),
          f.config,
          f.backend,
          expect.any(AbortSignal),
          { loginProvider: provider },
        )
        expect(f.backend.spawnTerminal).toHaveBeenCalledOnce()
        expect(f.terminal.write).not.toHaveBeenCalled()
        await f.manager.stop('parent', opened.id)
        expect(f.manager.isBusy('zcode')).toBe(false)
      } finally {
        prepare.mockRestore()
      }
    },
  )
  it.each([
    ['codex', 'login', 'bigmodel', '不支持的登录服务商'],
    ['zcode', 'logout', 'bigmodel', '不支持的 ZCode 授权来源'],
    ['zcode', 'manage', 'zai', '不支持的 ZCode 授权来源'],
    ['zcode', 'login', 'native', '不支持的 ZCode 授权来源'],
    ['zcode', 'login', 'https://foreign.invalid', '不支持的 ZCode 授权来源'],
    ['zcode', 'login', '', '不支持的 ZCode 授权来源'],
    ['opencode', 'login', 'https://foreign.invalid', '不支持的登录服务商'],
    ['opencode', 'login', 'not-in-the-picker', '不支持的登录服务商'],
    ['opencode', 'logout', 'deepseek', '不支持的登录服务商'],
    ['hermes', 'login', 'openai-codex', '不支持的登录服务商'],
    ['kimi', 'login', 'deepseek', '不支持的登录服务商'],
  ])(
    'rejects invalid provider arguments %s/%s/%s before reserving or resolving a process',
    (cli, action, provider, message) => {
      const f = fixture()
      expect(() =>
        f.manager.start('parent', cli as any, action as any, f.cwd, f.signal, undefined, provider as any),
      ).toThrow(message)
      expect(f.manager.isBusy('zcode')).toBe(false)
      expect(f.backend.resolveExecutable).not.toHaveBeenCalled()
      expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
      expect(f.backend.spawn).not.toHaveBeenCalled()
    },
  )
  it.each([
    ['opencode', 'login', 'opencode:deepseek'],
    ['opencode', 'logout', 'hermes:deepseek:a1b2c3'],
    ['opencode', 'logout', 'opencode:deepseek:a1b2c3'],
    ['hermes', 'logout', 'hermes:deepseek'],
    ['hermes', 'logout', 'hermes:deepseek:../../x'],
    ['pi', 'logout', 'pi:anthropic'],
    ['zcode', 'logout', 'zcode:all'],
  ])('rejects a single-login sign-out %s/%s/%s before resolving a process', (cli, action, login) => {
    const f = fixture()
    expect(() =>
      f.manager.start('parent', cli as any, action as any, f.cwd, f.signal, undefined, undefined, login),
    ).toThrow('不支持单独退出该账号')
    expect(f.backend.resolveExecutable).not.toHaveBeenCalled()
    expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
  })
  it('offers account actions for all six extended CLIs without starting any login process', async () => {
    const f = fixture()
    for (const cli of ['zcode', 'grok', 'omp', 'pi', 'hermes', 'opencode'] as const) {
      const account = await f.manager.status(cli, f.cwd, f.signal)
      expect(account.installed).toBe(true)
      {
        expect(account.actions.map((item) => item.id)).toContain('login')
        expect(account.actions.map((item) => item.id)).toContain('manage')
      }
      expect(account.state).not.toBe('authenticated')
    }
    expect(f.backend.spawn).not.toHaveBeenCalled()
    expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
  })

  it.each(['pi', 'omp', 'opencode'] as const)(
    '%s routes login to a terminal even with a managed API reference',
    async (cli) => {
      const f = fixture({
        zaiCredentialRef: 'synthetic-ref',
        resolveCredential: async () => 'SYNTHETIC_SECRET',
      })
      const account = await f.manager.status(cli, f.cwd, f.signal)
      expect(account.actions.find((x) => x.id === 'login')).toMatchObject({ label: '登录设置' })
      expect(account.actions.every((x) => x.target !== 'models')).toBe(true)
      expect(JSON.stringify(account)).not.toContain('SYNTHETIC_SECRET')
      const opened = await f.manager.start('p', cli, 'login', f.cwd, f.signal)
      expect(opened.id).toBeTruthy()
      expect(f.backend.spawnTerminal).toHaveBeenCalledOnce()
    },
  )
  it('rejects removed Harness account operations before any process starts', async () => {
    const f = fixture()
    await expect(f.manager.status('harness', f.cwd, f.signal)).rejects.toThrow('不支持')
    expect(() => f.manager.start('p', 'harness', 'login', f.cwd, f.signal)).toThrow('不支持')
    expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
  })
  it.each(['pi', 'omp'] as const)('%s login works without Host API credentials', async (cli) => {
    const f = fixture()
    const opened = await f.manager.start('p', cli, 'login', f.cwd, f.signal)
    expect(opened.id).toBeTruthy()
    expect(f.backend.spawnTerminal).toHaveBeenCalledOnce()
  })

  it.each(['login', 'manage'] as const)(
    'Grok %s uses its native argv and shared account path',
    async (action) => {
      const f = fixture()
      const opened = await f.manager.start('p', 'grok', action, f.cwd, f.signal)
      const spec = vi.mocked(f.backend.spawnTerminal!).mock.calls[0]![0]
      expect(spec.argv).toEqual([
        process.execPath,
        fileURLToPath(new URL('../src/host/private-launch.mjs', import.meta.url)),
        '/synthetic/grok',
        ...(action === 'login' ? ['login'] : []),
      ])
      expect(spec.env?.GROK_HOME).toMatch(/[\\/]\.grok$/)
      expect(spec.env?.ELECTRON_RUN_AS_NODE).toBe('1')
      expect(spec.cwd).toBe(join(f.config.stateDirectory!, 'accounts/grok-terminal/workspace'))
      expect(f.backend.spawn).not.toHaveBeenCalled()
      expect(f.terminal.write).not.toHaveBeenCalled()
      await f.manager.stop('p', opened.id)
    },
  )

  it.each(['pi', 'omp'] as const)(
    '%s releases its private runtime only after successful terminal cleanup',
    async (cli) => {
      const f = fixture({
        zaiCredentialRef: 'synthetic-host-ref',
        resolveCredential: async () => 'SYNTHETIC_KEY',
      })
      const opened = await f.manager.start('p', cli, 'manage', f.cwd, f.signal)
      const spec = vi.mocked(f.backend.spawnTerminal!).mock.calls[0]![0]
      expect(spec.cwd).not.toBe(f.cwd)
      expect(spec.env?.ZAI_CODING_CN_API_KEY).toBeUndefined()
      expect(spec.argv).not.toContain('SYNTHETIC_KEY')
      expect(existsSync(spec.cwd)).toBe(true)
      f.delayCleanup()
      // Simulate the native TUI exiting by itself; finish still owns process cleanup.
      f.output.end()
      f.result.resolve({ exitCode: 0, signal: null })
      await tick()
      expect(f.terminal.terminate).toHaveBeenCalledOnce()
      expect(f.manager.isBusy(cli)).toBe(true)
      expect(existsSync(spec.cwd)).toBe(true)
      f.finishCleanup()
      await f.manager.stop('p', opened.id)
      expect(existsSync(spec.cwd)).toBe(false)
      expect(f.manager.isBusy(cli)).toBe(false)
      expect(readdirSync(join(f.config.stateDirectory!, 'account-runtime'))).toEqual([])
    },
  )

  it.each(['pi', 'omp'] as const)(
    '%s retains a cancelled runtime for a late PTY until that PTY has actually exited',
    async (cli) => {
      const f = fixture({
        zaiCredentialRef: 'synthetic-host-ref',
        resolveCredential: async () => 'SYNTHETIC_KEY',
      })
      const allocated = deferred<SubprocessTerminalHandle>()
      vi.mocked(f.backend.spawnTerminal!).mockReturnValueOnce(allocated.promise)
      const request = new AbortController()
      const opening = f.manager.start('p', cli, 'manage', f.cwd, request.signal)
      const failed = expect(opening).rejects.toThrow('已取消')
      await vi.waitFor(() => expect(f.backend.spawnTerminal).toHaveBeenCalledOnce())
      const runtime = vi.mocked(f.backend.spawnTerminal!).mock.calls[0]![0].cwd
      request.abort()
      await failed
      expect(existsSync(runtime)).toBe(true)
      expect(f.manager.isBusy(cli)).toBe(true)
      f.delayCleanup()
      allocated.resolve(f.terminal)
      await tick()
      expect(f.terminal.terminate).toHaveBeenCalledOnce()
      expect(existsSync(runtime)).toBe(true)
      f.finishCleanup()
      await f.manager.closeParent('p')
      expect(existsSync(runtime)).toBe(false)
      expect(f.manager.isBusy(cli)).toBe(false)
    },
  )

  it.each(['pi', 'omp'] as const)(
    '%s releases a prepared runtime when terminal allocation fails and permits retry',
    async (cli) => {
      const f = fixture({
        zaiCredentialRef: 'synthetic-host-ref',
        resolveCredential: async () => 'SYNTHETIC_KEY',
      })
      vi.mocked(f.backend.spawnTerminal!).mockRejectedValueOnce(new Error('SYNTHETIC_PROVIDER_SECRET'))
      await expect(f.manager.start('p', cli, 'manage', f.cwd, f.signal)).rejects.toThrow('无法启动账号终端')
      const runtime = vi.mocked(f.backend.spawnTerminal!).mock.calls[0]![0].cwd
      expect(existsSync(runtime)).toBe(false)
      expect(f.manager.isBusy(cli)).toBe(false)
      const opened = await f.manager.start('p', cli, 'manage', f.cwd, f.signal)
      expect(vi.mocked(f.backend.spawnTerminal!).mock.calls[1]![0].cwd).not.toBe(runtime)
      await f.manager.stop('p', opened.id)
    },
  )
})

describe('Antigravity account terminal guide (synthetic agy screens)', () => {
  const timing = { ...AGY_GUIDE_TIMING }
  afterEach(() => Object.assign(AGY_GUIDE_TIMING, timing))
  const fast = () =>
    Object.assign(AGY_GUIDE_TIMING, { commandDelayMs: 1, pollMs: 5, loginConfirmMs: 150, logoutConfirmMs: 150, confirmEnterMs: 5 })
  const READY = '\x1b[3;1H>\x1b[K\r\n\x1b[90m? for shortcuts\x1b[0m'
  const SIGNED_OUT = 'Welcome to the Antigravity CLI. You are currently not signed in.\r\n'
  const METHOD = 'Select login method:\r\n> 1. Google OAuth\r\n'
  const CODE = 'If you aren\'t automatically redirected, paste the authorization code below:'
  // Frames are read without ending the session: watch() closes a running terminal when it stops.
  const frames = (f: ReturnType<typeof fixture>, id: string) => {
    const seen: { guide?: { step: string }; status?: string }[] = []
    void (async () => {
      for await (const frame of f.manager.watch('p', id, f.signal)) seen.push(frame)
    })().catch(() => undefined)
    return { seen, steps: () => seen.flatMap((frame) => (frame.guide ? [frame.guide.step] : [])) }
  }
  const state = (value: 'authenticated' | 'unconfigured') => ({ state: value, verification: 'local' as const, summary: '' })

  it('types /logout once after the main screen, confirms the sign-out and closes the terminal', async () => {
    fast()
    const f = fixture()
    f.identity.mockImplementation(async () =>
      state(vi.mocked(f.terminal.write).mock.calls.some(([data]) => data === '\r') ? 'unconfigured' : 'authenticated'),
    )
    const { id } = await f.manager.start('p', 'antigravity', 'logout', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write('Signing in...')
    await tick()
    expect(f.terminal.write).not.toHaveBeenCalled()
    f.output.write(READY)
    await vi.waitFor(() => expect(watched.seen.at(-1)).toMatchObject({ status: 'closed', cleanupConfirmed: true }))
    expect(vi.mocked(f.terminal.write).mock.calls).toEqual([['/logout'], ['\r']])
    expect(watched.steps()).toEqual(['loggingOut', 'loggedOut'])
    expect(f.manager.isBusy('antigravity')).toBe(false)
  })

  it('stops confirming a sign-out and pauses agy when an identity read cannot confirm its cleanup', async () => {
    fast()
    const onQueryCleanup = vi.fn()
    const f = fixture({}, onQueryCleanup)
    const typed = () => vi.mocked(f.terminal.write).mock.calls.map(([data]) => data)
    f.identity.mockImplementation(async () => {
      if (typed().includes('\r')) throw new ProcessCleanupUnconfirmedError({ cause: new Error('isJobEmpty failed for /Users/synthetic/job') })
      return state('authenticated')
    })
    const { id } = await f.manager.start('p', 'antigravity', 'logout', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write(READY)
    await vi.waitFor(() => expect(watched.steps().at(-1)).toBe('logoutUnconfirmed'))
    const reads = f.identity.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 40))
    // No further read is started once a range is unconfirmed.
    expect(f.identity.mock.calls.length).toBe(reads)
    expect(onQueryCleanup).toHaveBeenCalledExactlyOnceWith('antigravity', expect.any(ProcessCleanupUnconfirmedError))
    expect(typed()).toEqual(['/logout', '\r'])
    await f.manager.stop('p', id)
    const held = await f.manager.status('antigravity', f.cwd, f.signal)
    expect(held).toMatchObject({ state: 'unavailable', cleanupBlocked: true, actions: [] })
    expect(held.summary).toContain('isJobEmpty failed for <path>')
    expect(f.identity.mock.calls.length).toBe(reads)
    f.manager.recoverCleanup('antigravity')
    expect(f.manager.isBusy('antigravity')).toBe(false)
  })

  it('refuses to release an agy pause while its account terminal is open', async () => {
    fast()
    const f = fixture()
    f.identity.mockResolvedValue(state('authenticated'))
    const { id } = await f.manager.start('p', 'antigravity', 'login', f.cwd, f.signal)
    expect(() => f.manager.recoverCleanup('antigravity')).toThrow('账号终端')
    await f.manager.stop('p', id)
    expect(() => f.manager.recoverCleanup('antigravity')).not.toThrow()
  })

  it('skips the agy color scheme, waits for the user to agree to the terms, then signs out', async () => {
    fast()
    const f = fixture()
    const typed = () => vi.mocked(f.terminal.write).mock.calls.map(([data]) => data)
    f.identity.mockImplementation(async () => state(typed().slice(-2).join('') === '/logout\r' ? 'unconfigured' : 'authenticated'))
    const { id } = await f.manager.start('p', 'antigravity', 'logout', f.cwd, f.signal)
    const watched = frames(f, id)
    // Synthetic first-run screens, as agy 1.4.7 drew them on Windows (2026-10-27).
    f.output.write('\x1b[2JWelcome to Antigravity CLI!\r\nChoose your color scheme:\r\n  > terminal\r\n  [Next]\r\n  ↑/↓ Navigate · enter Confirm')
    await vi.waitFor(() => expect(typed()).toEqual(['\r']))
    f.output.write('\x1b[2JTerms of Service & Data Use\r\n  > [x] Yes, I agree to help improve Antigravity CLI\r\n  [Previous]   [Done]')
    await vi.waitFor(() => expect(watched.steps().at(-1)).toBe('terms'))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(typed()).toEqual(['\r'])
    await f.manager.respond('p', id, { agree: 'terms', share: false })
    expect(typed()).toEqual(['\r', '\r\x1b[B\x1b[C'])
    f.output.write('\x1b[26;3H  [Previous]    > \x1b[32;7m Done \x1b[m')
    await vi.waitFor(() => expect(typed()).toEqual(['\r', '\r\x1b[B\x1b[C', '\r']))
    f.output.write(READY)
    await vi.waitFor(() => expect(watched.seen.at(-1)).toMatchObject({ status: 'closed', cleanupConfirmed: true }))
    expect(typed().slice(3)).toEqual(['/logout', '\r'])
    expect(watched.steps()).toEqual(['preparing', 'terms', 'preparing', 'loggingOut', 'loggedOut'])
  })

  it('opens the guided agy terminal large enough to keep every prompt on screen', async () => {
    fast()
    const f = fixture()
    await f.manager.start('p', 'antigravity', 'login', f.cwd, f.signal)
    expect(vi.mocked(f.backend.spawnTerminal!).mock.calls[0][0]).toMatchObject({ cols: 200, rows: 60 })
  })

  it('logs out from a settled main screen it does not recognise once the native account is signed in', async () => {
    fast()
    Object.assign(AGY_GUIDE_TIMING, { quietMs: 5, settleCapMs: 50 })
    const f = fixture()
    f.identity.mockImplementation(async () =>
      state(vi.mocked(f.terminal.write).mock.calls.some(([data]) => data === '\r') ? 'unconfigured' : 'authenticated'),
    )
    const { id } = await f.manager.start('p', 'antigravity', 'logout', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write('\x1b[2Jsynthetic main screen')
    await vi.waitFor(() => expect(watched.seen.at(-1)).toMatchObject({ status: 'closed', cleanupConfirmed: true }))
    expect(vi.mocked(f.terminal.write).mock.calls).toEqual([['/logout'], ['\r']])
    expect(watched.steps()).toEqual(['loggingOut', 'loggedOut'])
  })

  it('types nothing when a settled logout screen belongs to a signed-out account', async () => {
    fast()
    Object.assign(AGY_GUIDE_TIMING, { quietMs: 5, settleCapMs: 50 })
    const f = fixture()
    f.identity.mockResolvedValue(state('unconfigured'))
    const { id } = await f.manager.start('p', 'antigravity', 'logout', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write('synthetic screen')
    await vi.waitFor(() => expect(watched.seen.at(-1)).toMatchObject({ status: 'closed' }))
    expect(f.terminal.write).not.toHaveBeenCalled()
    expect(watched.steps()).toEqual(['notSignedIn'])
  })

  it('types nothing for a signed-out logout terminal and closes it', async () => {
    fast()
    const f = fixture()
    f.identity.mockResolvedValue(state('unconfigured'))
    const { id } = await f.manager.start('p', 'antigravity', 'logout', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write(SIGNED_OUT + METHOD)
    await vi.waitFor(() => expect(watched.seen.at(-1)).toMatchObject({ status: 'closed' }))
    expect(f.terminal.write).not.toHaveBeenCalled()
    expect(watched.steps()).toEqual(['notSignedIn'])
  })

  it('keeps a logout terminal open and untouched when the login menu shows for a signed-in account', async () => {
    fast()
    const f = fixture()
    f.identity.mockResolvedValue(state('authenticated'))
    const { id } = await f.manager.start('p', 'antigravity', 'logout', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write(SIGNED_OUT + METHOD)
    await vi.waitFor(() => expect(watched.steps()).toEqual(['menuUnresolved']))
    f.output.write(READY)
    await tick()
    expect(f.identity).toHaveBeenCalledTimes(1)
    expect(f.terminal.write).not.toHaveBeenCalled()
    expect(watched.seen.at(-1)).not.toMatchObject({ status: 'closed' })
    expect(watched.steps()).toEqual(['menuUnresolved'])
  })

  it('logs out from the real signed-in start, which first prints the signed-out line', async () => {
    fast()
    const f = fixture()
    f.identity.mockImplementation(async () =>
      state(vi.mocked(f.terminal.write).mock.calls.some(([data]) => data === '\r') ? 'unconfigured' : 'authenticated'),
    )
    const { id } = await f.manager.start('p', 'antigravity', 'logout', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write(SIGNED_OUT + '\u28fe  Signing in...')
    await tick()
    expect(watched.steps()).toEqual([])
    f.output.write(READY)
    await vi.waitFor(() => expect(watched.seen.at(-1)).toMatchObject({ status: 'closed' }))
    expect(watched.steps()).toEqual(['loggingOut', 'loggedOut'])
  })

  it('presses Enter once more when /logout only completed the slash command', async () => {
    fast()
    const f = fixture()
    const enters = () => vi.mocked(f.terminal.write).mock.calls.filter(([data]) => data === '\r').length
    f.identity.mockImplementation(async () => state(enters() >= 2 ? 'unconfigured' : 'authenticated'))
    const { id } = await f.manager.start('p', 'antigravity', 'logout', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write(READY)
    await vi.waitFor(() => expect(watched.seen.at(-1)).toMatchObject({ status: 'closed' }))
    expect(vi.mocked(f.terminal.write).mock.calls).toEqual([['/logout'], ['\r'], ['\r']])
  })

  it('never presses Enter again once agy shows its login menu', async () => {
    fast()
    Object.assign(AGY_GUIDE_TIMING, { confirmEnterMs: 300, logoutConfirmMs: 500 })
    const f = fixture()
    f.identity.mockResolvedValue(state('authenticated'))
    const { id } = await f.manager.start('p', 'antigravity', 'logout', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write(READY)
    await vi.waitFor(() => expect(f.terminal.write).toHaveBeenCalledWith('\r'), { interval: 5 })
    f.output.write(METHOD)
    await vi.waitFor(() => expect(watched.steps()).toContain('logoutUnconfirmed'))
    expect(vi.mocked(f.terminal.write).mock.calls).toEqual([['/logout'], ['\r']])
    await f.manager.stop('p', id)
  })

  it('reports an unconfirmed sign-out and leaves the terminal to the user', async () => {
    fast()
    const f = fixture()
    f.identity.mockResolvedValue(state('authenticated'))
    const { id } = await f.manager.start('p', 'antigravity', 'logout', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write(READY)
    await vi.waitFor(() => expect(watched.steps()).toContain('logoutUnconfirmed'))
    expect(f.manager.isBusy('antigravity')).toBe(true)
    await f.manager.stop('p', id)
  })

  it('guides a sign-in to the pasted code and confirms it from the native account, typing nothing itself', async () => {
    fast()
    const f = fixture()
    let signedIn = false
    f.identity.mockImplementation(async () => state(signedIn ? 'authenticated' : 'unconfigured'))
    const { id } = await f.manager.start('p', 'antigravity', 'login', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write(SIGNED_OUT + METHOD)
    await vi.waitFor(() => expect(watched.steps()).toEqual(['method']))
    f.output.write(CODE)
    await vi.waitFor(() => expect(watched.steps()).toEqual(['method', 'code']))
    await f.manager.write('p', id, '\x1b[200~synthetic-authorization-code\x1b[201~')
    await vi.waitFor(() => expect(watched.steps().at(-1)).toBe('pasted'))
    signedIn = true
    await f.manager.write('p', id, '\r')
    await vi.waitFor(() => expect(watched.seen.at(-1)).toMatchObject({ status: 'closed', cleanupConfirmed: true }))
    expect(watched.steps()).toEqual(['method', 'code', 'pasted', 'confirming', 'signedIn'])
    expect(f.manager.isBusy('antigravity')).toBe(false)
    expect(vi.mocked(f.terminal.write).mock.calls).toEqual([['\x1b[200~synthetic-authorization-code\x1b[201~'], ['\r']])
    expect(JSON.stringify(watched.seen.filter((frame) => frame.guide))).not.toContain('synthetic-authorization-code')
    await f.manager.stop('p', id)
  })

  it('asks for a fresh code when the sign-in is not confirmed in time', async () => {
    fast()
    const f = fixture()
    f.identity.mockResolvedValue(state('unconfigured'))
    const { id } = await f.manager.start('p', 'antigravity', 'login', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write(SIGNED_OUT + METHOD + CODE)
    await vi.waitFor(() => expect(watched.steps().at(-1)).toBe('code'))
    await f.manager.write('p', id, '\x1b[200~synthetic-expired-code\x1b[201~')
    await f.manager.write('p', id, '\r')
    await vi.waitFor(() => expect(watched.steps().at(-1)).toBe('unconfirmed'))
    await f.manager.stop('p', id)
  })

  it('stops confirming when the terminal is closed', async () => {
    fast()
    Object.assign(AGY_GUIDE_TIMING, { loginConfirmMs: 60_000 })
    const f = fixture()
    f.identity.mockResolvedValue(state('unconfigured'))
    const { id } = await f.manager.start('p', 'antigravity', 'login', f.cwd, f.signal)
    f.output.write(CODE)
    await tick()
    await f.manager.write('p', id, '\x1b[200~synthetic-code\x1b[201~\r')
    await f.manager.stop('p', id)
    const calls = f.identity.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(f.identity.mock.calls.length).toBe(calls)
  })
})


describe('guided login windows of other CLIs (synthetic screens)', () => {
  const timing = { ...AGY_GUIDE_TIMING }
  afterEach(() => Object.assign(AGY_GUIDE_TIMING, timing))
  const fast = () =>
    Object.assign(AGY_GUIDE_TIMING, {
      commandDelayMs: 1,
      pollMs: 5,
      loginConfirmMs: 150,
      logoutConfirmMs: 150,
      confirmEnterMs: 5,
      flowQuietMs: 5,
      settleCapMs: 50,
    })
  const frames = (f: ReturnType<typeof fixture>, id: string) => {
    const seen: { guide?: { step: string; link?: string }; status?: string }[] = []
    void (async () => {
      for await (const frame of f.manager.watch('p', id, f.signal)) seen.push(frame)
    })().catch(() => undefined)
    return { seen, steps: () => seen.flatMap((frame) => (frame.guide ? [frame.guide.step] : [])) }
  }
  const account = (f: ReturnType<typeof fixture>, signedIn: () => boolean) =>
    vi.spyOn(f.manager as any, 'readStatus').mockImplementation(async () => ({
      state: signedIn() ? 'authenticated' : 'unconfigured',
      verification: 'local',
      summary: '',
      ...(signedIn() ? { accountLabel: 'synthetic@example.com' } : {}),
    }))

  it('opens a guided window large enough for long sign-in links', async () => {
    fast()
    const f = fixture()
    account(f, () => false)
    const started = await f.manager.start('p', 'codex', 'login', f.cwd, f.signal)
    expect(vi.mocked(f.backend.spawnTerminal!).mock.calls[0][0]).toMatchObject({ cols: 200, rows: 60 })
    expect(started.size).toEqual({ cols: 200, rows: 60 })
  })

  it('ignores simulated ConPTY negotiation and emits fallback once despite repeated redraws', async () => {
    fast()
    const f = fixture()
    account(f, () => false)
    const { id } = await f.manager.start('p', 'codex', 'login', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write('\x1b[1t\x1b[c\x1b[?1004h\x1b]0;WindowsPowerShell\x1b\\')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(watched.steps()).toEqual([])
    f.output.write('模拟未知提示')
    await vi.waitFor(() => expect(watched.steps()).toEqual(['native']))
    f.output.write('\r\x1b[K模拟未知提示')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(watched.steps()).toEqual(['native'])
  })

  it('confirms a Codex sign-in from its account status after codex exits, typing nothing', async () => {
    fast()
    const f = fixture()
    let signedIn = false
    account(f, () => signedIn)
    const { id } = await f.manager.start('p', 'codex', 'login', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write(
      'If your browser did not open, navigate to this URL to authenticate:\r\n\r\nhttps://auth.openai.com/oauth/authorize?state=synthetic\r\n',
    )
    await vi.waitFor(() => expect(watched.steps()).toEqual(['browser']))
    expect(watched.seen.at(-1)!.guide!.link).toBe('https://auth.openai.com/oauth/authorize?state=synthetic')
    signedIn = true
    f.result.resolve({ exitCode: 0, signal: null })
    await vi.waitFor(() => expect(watched.seen.at(-1)).toMatchObject({ status: 'closed' }))
    expect(watched.steps()).toEqual(['browser', 'confirming', 'signedIn'])
    expect(f.terminal.write).not.toHaveBeenCalled()
  })

  it('reports an unconfirmed sign-in when the account did not change', async () => {
    fast()
    const f = fixture()
    account(f, () => false)
    const { id } = await f.manager.start('p', 'codex', 'login', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write('navigate to this URL to authenticate:\r\nhttps://auth.openai.com/x\r\n')
    await vi.waitFor(() => expect(watched.steps()).toEqual(['browser']))
    f.result.resolve({ exitCode: 1, signal: null })
    await vi.waitFor(() => expect(watched.seen.at(-1)?.status).toMatch(/closed|failed/))
    expect(watched.steps()).toContain('unconfirmed')
    expect(watched.steps()).not.toContain('signedIn')
  })

  it('types a pasted Claude code and then Enter, keeping the code out of every frame', async () => {
    fast()
    const f = fixture()
    let signedIn = false
    account(f, () => signedIn)
    const { id } = await f.manager.start('p', 'claude', 'login', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write('If the browser didn\'t open, visit: https://claude.com/cai/oauth/authorize?state=synthetic\r\nPaste code here if prompted > ')
    await vi.waitFor(() => expect(watched.steps()).toEqual(['code']))
    signedIn = true
    await f.manager.respond('p', id, { code: 'synthetic-code#synthetic-state' })
    expect(vi.mocked(f.terminal.write).mock.calls).toEqual([['synthetic-code#synthetic-state'], ['\r']])
    await vi.waitFor(() => expect(watched.steps().at(-1)).toBe('signedIn'))
    expect(JSON.stringify(watched.seen)).not.toContain('synthetic-code')
    await expect(f.manager.respond('p', id, { code: 'again' })).rejects.toThrow()
    await f.manager.stop('p', id)
  })

  it('hands an unrecognised screen to the native terminal and types nothing', async () => {
    fast()
    const f = fixture()
    account(f, () => false)
    const { id } = await f.manager.start('p', 'codex', 'login', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write('synthetic screen of a newer codex')
    await vi.waitFor(() => expect(watched.steps()).toEqual(['native']))
    expect(f.terminal.write).not.toHaveBeenCalled()
    await f.manager.stop('p', id)
  })

  // Screen flows only; Windows launch resolution for Qoder and Hermes has its own tests.
  it.skipIf(process.platform === 'win32')('signs out of a settled Qoder TUI with /logout once the account reads as signed in', async () => {
    fast()
    const f = fixture()
    account(f, () => !vi.mocked(f.terminal.write).mock.calls.some(([data]) => data === '\r'))
    const { id } = await f.manager.start('p', 'qoder', 'logout', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write('\x1b[2Jsynthetic Qoder main screen')
    await vi.waitFor(() => expect(watched.steps().at(-1)).toBe('loggedOut'))
    expect(vi.mocked(f.terminal.write).mock.calls).toEqual([['/logout'], ['\r']])
    expect(watched.steps()).toEqual(['loggingOut', 'loggedOut'])
  })

  // Screen flows only; Windows launch resolution for Qoder and Hermes has its own tests.
  it.skipIf(process.platform === 'win32')('waits for the user to trust the Qoder folder before signing out', async () => {
    fast()
    const f = fixture()
    // Signed out only by the Enter that follows /logout.
    account(f, () => !vi.mocked(f.terminal.write).mock.calls.some(([data], index, calls) => data === '\r' && calls[index - 1]?.[0] === '/logout'))
    const { id } = await f.manager.start('p', 'qoder', 'logout', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write('Do you trust the files in this folder?\r\n❯ 1. Trust folder\r\n  2. Don\'t trust and exit')
    await vi.waitFor(() => expect(watched.steps()).toEqual(['trust']))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(f.terminal.write).not.toHaveBeenCalled()
    await f.manager.respond('p', id, { confirm: 'trust' })
    f.output.write('\x1b[2Jsynthetic Qoder main screen')
    await vi.waitFor(() => expect(watched.steps().at(-1)).toBe('loggedOut'))
    expect(vi.mocked(f.terminal.write).mock.calls.map(([data]) => data)).toEqual(['\r', '/logout', '\r'])
  })

  it('closes a Grok sign-out at once when there is no session, typing nothing', async () => {
    fast()
    const f = fixture()
    account(f, () => false)
    const { id } = await f.manager.start('p', 'grok', 'logout', f.cwd, f.signal)
    const watched = frames(f, id)
    f.output.write('No cached session to log out of.\r\n')
    await vi.waitFor(() => expect(watched.seen.at(-1)).toMatchObject({ status: 'closed' }))
    expect(watched.steps()).toEqual(['notSignedIn'])
    expect(f.terminal.write).not.toHaveBeenCalled()
  })

  const logins = (...ids: string[]) =>
    ids.map((id) => ({ providerLabel: id.split(':')[1]!, authMethod: 'api' as const, id }))
  const holding = (f: ReturnType<typeof fixture>, held: () => string[]) =>
    vi.spyOn(f.manager as any, 'readStatus').mockImplementation(async () =>
      held().length
        ? { state: 'authenticated', verification: 'local', summary: '', logins: logins(...held()), actions: [] }
        : { state: 'unconfigured', verification: 'local', summary: '', actions: [] },
    )
  const tail = (f: ReturnType<typeof fixture>) => {
    const argv = vi.mocked(f.backend.spawnTerminal!).mock.calls[0]![0].argv
    return argv.slice(argv.findIndex((item) => item.startsWith('/synthetic/')))
  }

  it('signs in to the OpenCode provider picked in the window with a key typed only into the CLI', async () => {
    fast()
    const f = fixture()
    let saved = false
    holding(f, () => (saved ? ['opencode:deepseek'] : []))
    const { id } = await f.manager.start('p', 'opencode', 'login', f.cwd, f.signal, undefined, 'deepseek')
    expect(tail(f)).toEqual(['/synthetic/opencode', 'auth', 'login', '-p', 'deepseek'])
    const watched = frames(f, id)
    f.output.write('┌ Add credential\r\n│\r\n◆ Enter your API key\r\n│ _\r\n└')
    await vi.waitFor(() => expect(watched.steps().at(-1)).toBe('key'))
    expect(watched.seen.at(-1)!.guide).toMatchObject({ template: 'secret' })
    await f.manager.respond('p', id, { secret: 'simulated-deepseek-key' })
    expect(vi.mocked(f.terminal.write).mock.calls).toEqual([['simulated-deepseek-key'], ['\r']])
    saved = true
    f.result.resolve({ exitCode: 0, signal: null })
    await vi.waitFor(() => expect(watched.seen.at(-1)).toMatchObject({ status: 'closed' }))
    expect(watched.steps().at(-1)).toBe('signedIn')
    expect(JSON.stringify(watched.seen)).not.toContain('simulated-deepseek-key')
  })

  it('signs out exactly one OpenCode provider and confirms only its own removal', async () => {
    fast()
    const f = fixture()
    let removed = false
    holding(f, () => (removed ? ['opencode:openrouter'] : ['opencode:deepseek', 'opencode:openrouter']))
    const { id } = await f.manager.start('p', 'opencode', 'logout', f.cwd, f.signal, undefined, undefined, 'opencode:deepseek')
    expect(tail(f)).toEqual(['/synthetic/opencode', 'auth', 'logout', 'deepseek'])
    const watched = frames(f, id)
    f.output.write('┌ Remove credential\r\n│\r\n└ Logout successful\r\n')
    removed = true
    f.result.resolve({ exitCode: 0, signal: null })
    await vi.waitFor(() => expect(watched.seen.at(-1)).toMatchObject({ status: 'closed' }))
    expect(watched.steps().at(-1)).toBe('loggedOut')
    expect(f.terminal.write).not.toHaveBeenCalled()
  })

  it('does not report a sign-out while the target login is still stored', async () => {
    fast()
    const f = fixture()
    // Another login going away proves nothing about the target.
    let other = true
    holding(f, () => (other ? ['opencode:deepseek', 'opencode:openrouter'] : ['opencode:deepseek']))
    const { id } = await f.manager.start('p', 'opencode', 'logout', f.cwd, f.signal, undefined, undefined, 'opencode:deepseek')
    const watched = frames(f, id)
    other = false
    f.result.resolve({ exitCode: 0, signal: null })
    await vi.waitFor(() => expect(watched.seen.at(-1)?.status).toMatch(/closed|failed/))
    expect(watched.steps()).toContain('logoutUnconfirmed')
    expect(watched.steps()).not.toContain('loggedOut')
  })

  it('refuses to sign out a login the native store no longer holds, before any terminal', async () => {
    fast()
    const f = fixture()
    holding(f, () => ['opencode:openrouter'])
    await expect(
      f.manager.start('p', 'opencode', 'logout', f.cwd, f.signal, undefined, undefined, 'opencode:deepseek'),
    ).rejects.toThrow('该账号已不存在，请刷新后重试')
    expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
    expect(f.manager.isBusy('opencode')).toBe(false)
  })

  // Screen flows only; Windows launch resolution for Qoder and Hermes has its own tests.
  it.skipIf(process.platform === 'win32')('adds a Hermes key as a new pool entry, leaving its label to Hermes', async () => {
    fast()
    const f = fixture()
    let added = false
    holding(f, () => (added ? ['hermes:deepseek:a1b2c3', 'hermes:deepseek:d4e5f6'] : ['hermes:deepseek:a1b2c3']))
    const { id } = await f.manager.start('p', 'hermes', 'login', f.cwd, f.signal, undefined, 'deepseek')
    expect(tail(f).slice(-5)).toEqual(['auth', 'add', 'deepseek', '--type', 'api-key'])
    const watched = frames(f, id)
    f.output.write('Label / account name (optional): ')
    await vi.waitFor(() => expect(f.terminal.write).toHaveBeenCalledWith('\r'))
    f.output.write('\r\nPaste your API key: ')
    await vi.waitFor(() => expect(watched.steps().at(-1)).toBe('key'))
    await f.manager.respond('p', id, { secret: 'simulated-hermes-key' })
    expect(vi.mocked(f.terminal.write).mock.calls).toEqual([['\r'], ['simulated-hermes-key'], ['\r']])
    added = true
    f.result.resolve({ exitCode: 0, signal: null })
    await vi.waitFor(() => expect(watched.seen.at(-1)).toMatchObject({ status: 'closed' }))
    expect(watched.steps().at(-1)).toBe('signedIn')
  })

  // Screen flows only; Windows launch resolution for Qoder and Hermes has its own tests.
  it.skipIf(process.platform === 'win32')('removes one Hermes pool entry by its id', async () => {
    fast()
    const f = fixture()
    let removed = false
    // Simulated pool: Hermes' sign-out first checks the account source it removes from.
    mkdirSync(f.config.hermesHome!, { recursive: true, mode: 0o700 })
    writeFileSync(join(f.config.hermesHome!, 'config.yaml'), 'auth:\n  adopt_external_logins: false\n', { mode: 0o600 })
    writeFileSync(
      join(f.config.hermesHome!, 'auth.json'),
      JSON.stringify({
        credential_pool: {
          deepseek: ['a1b2c3', 'd4e5f6'].map((entry) => ({
            id: entry,
            auth_type: 'api_key',
            source: 'manual',
            access_token: `simulated-deepseek-key-${entry}`,
          })),
        },
      }),
      { mode: 0o600 },
    )
    holding(f, () => (removed ? ['hermes:deepseek:d4e5f6'] : ['hermes:deepseek:a1b2c3', 'hermes:deepseek:d4e5f6']))
    const { id } = await f.manager.start('p', 'hermes', 'logout', f.cwd, f.signal, undefined, undefined, 'hermes:deepseek:a1b2c3')
    expect(tail(f).slice(-4)).toEqual(['auth', 'remove', 'deepseek', 'a1b2c3'])
    const watched = frames(f, id)
    removed = true
    f.result.resolve({ exitCode: 0, signal: null })
    await vi.waitFor(() => expect(watched.seen.at(-1)).toMatchObject({ status: 'closed' }))
    expect(watched.steps().at(-1)).toBe('loggedOut')
  })

  it('advertises the window providers with the ones already signed in', async () => {
    const f = fixture()
    holding(f, () => [])
    vi.mocked((f.manager as any).readStatus).mockRestore()
    const status = await f.manager.status('opencode', f.cwd, f.signal)
    const providers = status.actions.find((item) => item.id === 'login')?.providers
    expect(providers?.map((item) => item.id)).toContain('deepseek')
    expect(providers?.some((item) => item.signedIn)).toBe(false)
  })

  it('refuses answers for the manage terminal, which stays native', async () => {
    fast()
    const f = fixture()
    const { id } = await f.manager.start('p', 'codex', 'manage', f.cwd, f.signal)
    await expect(f.manager.respond('p', id, { code: 'x' })).rejects.toThrow()
    await f.manager.stop('p', id)
  })
})

describe('Kimi account window launches (synthetic terminal and status)', () => {
  const timing = { ...AGY_GUIDE_TIMING }
  afterEach(() => Object.assign(AGY_GUIDE_TIMING, timing))
  const fast = () =>
    Object.assign(AGY_GUIDE_TIMING, {
      commandDelayMs: 1,
      pollMs: 5,
      loginConfirmMs: 150,
      logoutConfirmMs: 150,
      confirmEnterMs: 5,
      flowQuietMs: 5,
      settleCapMs: 50,
    })
  const frames = (f: ReturnType<typeof fixture>, id: string) => {
    const seen: { guide?: { step: string; link?: string; code?: string }; status?: string }[] = []
    void (async () => {
      for await (const frame of f.manager.watch('p', id, f.signal)) seen.push(frame)
    })().catch(() => undefined)
    return { seen, steps: () => seen.flatMap((frame) => (frame.guide ? [frame.guide.step] : [])) }
  }
  const row = (id: string) => ({
    providerLabel: id === 'kimi:kimi-code' ? 'Kimi Code' : id.split(':')[1]!,
    authMethod: id === 'kimi:kimi-code' ? ('oauth' as const) : ('api' as const),
    id,
  })
  const holding = (f: ReturnType<typeof fixture>, held: () => string[]) =>
    vi.spyOn(f.manager as any, 'readStatus').mockImplementation(async () =>
      held().length
        ? { state: held().includes('kimi:kimi-code') ? 'authenticated' : 'configured', verification: 'local', summary: '', logins: held().map(row), actions: [] }
        : { state: 'unconfigured', verification: 'local', summary: '', actions: [] },
    )
  const launched = (f: ReturnType<typeof fixture>) => vi.mocked(f.backend.spawnTerminal!).mock.calls[0]![0]
  const kimi = () => fixture({ kimiExecutable: '/synthetic/kimi' })

  it.each([
    ['kimi-code-cn', 'mainland-cn'],
    ['kimi-code-global', 'global'],
  ])('signs in to the picked region %s with Kimi\'s own device login, typing nothing', async (provider, region) => {
    fast()
    const f = kimi()
    let signedIn = false
    holding(f, () => (signedIn ? ['kimi:kimi-code'] : []))
    const { id } = await f.manager.start('p', 'kimi', 'login', f.cwd, f.signal, undefined, provider)
    expect(launched(f).argv).toEqual(['/synthetic/kimi', 'login', '--region', region])
    expect(launched(f).cwd).not.toBe(f.cwd)
    const watched = frames(f, id)
    // Simulated code; the real one is a one-time value of the Kimi device login.
    f.output.write(
      'Opening browser for Kimi device login: https://www.kimi.com/code/authorize_device?user_code=SYNT-HETC\r\n' +
        'If the browser did not open, paste the URL above and enter code: SYNT-HETC\r\nWaiting for authorization to complete…\r\n',
    )
    await vi.waitFor(() => expect(watched.steps().at(-1)).toBe('device'))
    expect(watched.seen.at(-1)!.guide!.code).toBe('SYNT-HETC')
    signedIn = true
    f.result.resolve({ exitCode: 0, signal: null })
    await vi.waitFor(() => expect(watched.seen.at(-1)).toMatchObject({ status: 'closed' }))
    expect(watched.steps().at(-1)).toBe('signedIn')
    expect(f.terminal.write).not.toHaveBeenCalled()
  })

  it('removes one API provider with `provider remove` and confirms only its own removal', async () => {
    fast()
    const f = kimi()
    let removed = false
    holding(f, () => (removed ? ['kimi:kimi-code', 'kimi:moonshot-cn'] : ['kimi:kimi-code', 'kimi:deepseek', 'kimi:moonshot-cn']))
    const { id } = await f.manager.start('p', 'kimi', 'logout', f.cwd, f.signal, undefined, undefined, 'kimi:deepseek')
    expect(launched(f).argv).toEqual(['/synthetic/kimi', 'provider', 'remove', 'deepseek'])
    const watched = frames(f, id)
    f.output.write('Removed provider "deepseek".\r\n')
    removed = true
    f.result.resolve({ exitCode: 0, signal: null })
    await vi.waitFor(() => expect(watched.seen.at(-1)).toMatchObject({ status: 'closed' }))
    expect(watched.steps().at(-1)).toBe('loggedOut')
    expect(f.terminal.write).not.toHaveBeenCalled()
  })

  it('signs out the Kimi Code login in the bare TUI after the user trusts the folder', async () => {
    fast()
    // The list must stay quiet longer than the test takes to draw the moved-up frame.
    AGY_GUIDE_TIMING.flowQuietMs = 2000
    const f = kimi()
    // Signed out only by the Enter typed on the Kimi Code row.
    holding(f, () =>
      vi.mocked(f.terminal.write).mock.calls.some(([data], index) => data === '\r' && index > 0)
        ? ['kimi:deepseek']
        : ['kimi:kimi-code', 'kimi:deepseek'],
    )
    const { id } = await f.manager.start('p', 'kimi', 'logout', f.cwd, f.signal, undefined, undefined, 'kimi:kimi-code')
    expect(launched(f).argv).toEqual(['/synthetic/kimi'])
    expect(launched(f).cwd).not.toBe(f.cwd)
    const watched = frames(f, id)
    f.output.write(' \x1b[38;5;32m\x1b[1m Trust this folder?\x1b[22m\x1b[39m\r\r\n \x1b[38;5;32m  ❯ \x1b[39mTrust and continue\r\r\n')
    await vi.waitFor(() => expect(watched.steps().at(-1)).toBe('trust'))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(f.terminal.write).not.toHaveBeenCalled()
    await f.manager.respond('p', id, { confirm: 'trust' })
    f.output.write('\x1b[2K   Welcome to Kimi Code!\r\r\n\x1b[2K   context: 0%')
    await vi.waitFor(() => expect(f.terminal.write).toHaveBeenCalledWith('/logout\r'))
    const end = '\x1b[0m\x1b]8;;\x07\r\r\n'
    f.output.write(
      `\x1b[2K \x1b[38;5;32m\x1b[1m Select a provider to log out\x1b[22m\x1b[39m${end}` +
        `\x1b[2K \x1b[38;5;240m ↑↓ navigate · Enter select · Esc cancel\x1b[39m${end}` +
        `\x1b[2K \x1b[38;5;238m    \x1b[39m\x1b[38;5;234mKimi Code\x1b[39m${end}\x1b[2K \x1b[38;5;240m    OAuth login\x1b[39m${end}` +
        `\x1b[2K \x1b[38;5;32m  ❯ \x1b[39m\x1b[38;5;32m\x1b[1mdeepseek\x1b[22m\x1b[39m \x1b[38;5;29m← current\x1b[39m${end}` +
        `\x1b[2K \x1b[38;5;240m    https://api.deepseek.com/v1\x1b[39m${end}\x1b[2K \x1b[38;5;32m${'─'.repeat(198)}\x1b[39m${end}`,
    )
    await vi.waitFor(() => expect(f.terminal.write).toHaveBeenCalledWith('\x1b[A'.repeat(40)))
    expect(f.terminal.write).toHaveBeenCalledTimes(3)
    f.output.write(
      `\x1b[9A\r\x1b[2K \x1b[38;5;32m  ❯ \x1b[39m\x1b[38;5;32m\x1b[1mKimi Code\x1b[22m\x1b[39m${end}` +
        `\x1b[2K \x1b[38;5;240m    OAuth login\x1b[39m${end}\x1b[2K \x1b[38;5;238m    \x1b[39m\x1b[38;5;234mdeepseek\x1b[39m \x1b[38;5;29m← current\x1b[39m\x1b[0m\x1b]8;;\x07`,
    )
    await vi.waitFor(() => expect(watched.steps().at(-1)).toBe('loggedOut'))
    expect(vi.mocked(f.terminal.write).mock.calls.map(([data]) => data)).toEqual(['\r', '/logout\r', '\x1b[A'.repeat(40), '\r'])
  })

  it('refuses a Kimi login the status no longer holds, before any terminal', async () => {
    fast()
    const f = kimi()
    holding(f, () => ['kimi:moonshot-cn'])
    await expect(
      f.manager.start('p', 'kimi', 'logout', f.cwd, f.signal, undefined, undefined, 'kimi:deepseek'),
    ).rejects.toThrow('该账号已不存在，请刷新后重试')
    expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
  })
})
