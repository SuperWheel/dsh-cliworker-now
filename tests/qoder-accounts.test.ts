import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, link, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { readFileSync, statSync } from 'node:fs'
import {
  readQoderAccount, readQoderAccountBindingMaterial, qoderConfigDirectory, qoderEnvironment,
  parseQoderModelState, discoverQoderModels, queryQoderAccountInfo, withQoderCatalogSnapshot,
} from '../src/host/qoder-accounts.ts'
import { authorizedCatalog } from '../src/host/authorized-catalog.ts'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import { SettingsCatalogCache } from '../src/host/settings-catalog-cache.ts'
import { CliExecutablePathStore } from '../src/host/cli-executable-paths.ts'
import { AccountManager } from '../src/host/accounts.ts'
import { DEFAULT_CONFIG, type ProcessBackend, ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'

// All account files and protocol frames below are synthetic. No real CLI, credential or network.
const roots: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'qoder-account-synthetic-')))
  roots.push(directory)
  for (const name of Object.keys(process.env)) if (/^QODER(?:CN|CLI)?_/.test(name)) vi.stubEnv(name, '')
  vi.stubEnv('QODER_CONFIG_DIR', directory)
  await mkdir(join(directory, '.auth'), { mode: 0o700 })
  const user = join(directory, '.auth/user'), machine = join(directory, '.auth/machine_id')
  await writeFile(machine, 'synthetic-machine-identity', { mode: 0o600 })
  const value = { userId: 'synthetic-uid', email: 'user@example.invalid', organization: 'synthetic-org',
    access_token: 'synthetic-access', security_oauth_token: 'synthetic-security', refresh_token: 'synthetic-refresh',
    login_timestamp: 1_900_000_000, expire_time: 2_100_000_000 }
  const options = { directory, project: directory, query: vi.fn(() => value as unknown) }
  return {
    directory, user, machine, value, options,
    set: async () => {
      await writeFile(user, 'synthetic-encrypted-user', { mode: 0o600 })
      await writeFile(machine, 'synthetic-machine-identity', { mode: 0o600 })
    },
    read: () => readQoderAccount('/synthetic/qoder.js', new AbortController().signal, options),
    binding: () => readQoderAccountBindingMaterial('/synthetic/qoder.js', new AbortController().signal, options),
  }
}
it('reports absent native login without reading another CLI account or creating files', async () => {
  const f = await fixture()
  expect(await f.read()).toEqual({ state: 'unconfigured', verification: 'local', summary: '尚未登录 Qoder' })
  expect(f.options.query).not.toHaveBeenCalled()
  await expect(readFile(f.user)).rejects.toMatchObject({ code: 'ENOENT' })
})
it('shows allowlisted local login metadata and binds the stable native principal across token rotation', async () => {
  const f = await fixture(); await f.set()
  expect(await f.read()).toMatchObject({ state: 'authenticated', verification: 'cli', accountLabel: 'user@example.invalid' })
  const before = JSON.stringify(await f.binding())
  f.value.access_token = 'rotated-synthetic-access'; f.value.refresh_token = 'rotated-synthetic-refresh'
  f.value.expire_time++
  expect(JSON.stringify(await f.binding())).toBe(before)
  expect(JSON.stringify(await f.read())).not.toMatch(/synthetic-|access_token|refresh_token|\.auth/)
  expect(await readFile(f.user, 'utf8')).toBe('synthetic-encrypted-user')
  f.value.userId = 'changed-synthetic-user'
  expect(JSON.stringify(await f.binding())).not.toBe(before)
})
it('uses only the selected Qoder PAT, never calls it remote authentication or exposes its text', async () => {
  const f = await fixture(); await f.set()
  vi.stubEnv('QODER_PERSONAL_ACCESS_TOKEN', 'synthetic-qoder-pat')
  const status = await f.read(), binding = await f.binding()
  expect(status).toMatchObject({ state: 'configured', verification: 'local', authMethod: 'api' })
  expect(f.options.query).not.toHaveBeenCalled()
  expect(JSON.stringify([status, binding])).not.toContain('synthetic-qoder-pat')
  expect(qoderEnvironment()).toMatchObject({ QODER_CONFIG_DIR: f.directory, QODER_PERSONAL_ACCESS_TOKEN: 'synthetic-qoder-pat', QODER_SESSION_ID: '', QODER_WORKING_DIR: '' })
  vi.stubEnv('QODER_PERSONAL_ACCESS_TOKEN', 'changed-synthetic-pat')
  expect(await f.binding()).not.toEqual(binding)
})
it('treats native auth_required as an unavailable login and never substitutes another account', async () => {
  const f = await fixture(); await f.set()
  f.options.query.mockReturnValue(null)
  expect((await f.read()).state).toBe('unauthenticated')
  await expect(f.binding()).rejects.toThrow('无法确认')
})
it.each(['link', 'hardlink', 'directory', 'oversized'] as const)('refuses %s account metadata without returning credentials', async (kind) => {
  const f = await fixture(); await f.set(); await rm(f.user)
  if (kind === 'link') await symlink(f.machine, f.user)
  if (kind === 'hardlink') await link(f.machine, f.user)
  if (kind === 'directory') await mkdir(f.user)
  if (kind === 'oversized') await writeFile(f.user, 'x'.repeat(1024 * 1024 + 1))
  expect((await f.read()).state).toBe('unavailable')
  expect(f.options.query).not.toHaveBeenCalled()
})
it('redacts native metadata errors and does not accept credential-shaped display labels', async () => {
  const f = await fixture(); await f.set()
  f.value.email = 'sk-secret@example.invalid'
  expect((await f.read()).accountLabel).toBeUndefined()
  f.options.query.mockImplementation(() => { throw new Error('synthetic-secret-in-native-error') })
  expect(await f.read()).toEqual({ state: 'unavailable', verification: 'local', summary: 'Qoder 登录状态读取失败，请检查原生配置' })
})
it('rejects unsupported SDK/job routes and respects the exact native config root', async () => {
  const f = await fixture()
  vi.stubEnv('QODER_CONFIG_DIR_NAME', 'custom-qoder')
  expect(qoderConfigDirectory()).toBe(f.directory)
  expect(qoderConfigDirectory({ QODER_CLI_HOME: f.directory, QODER_CONFIG_DIR_NAME: 'custom-qoder', QODER_HOME: '/ignored-synthetic-home' })).toBe(join(f.directory, 'custom-qoder'))
  expect(qoderConfigDirectory({ GEMINI_CLI_HOME: f.directory })).toBe(join(f.directory, '.qoder'))
  vi.stubEnv('QODER_JOB_TOKEN', 'synthetic-job-token')
  expect(() => qoderEnvironment()).toThrow('尚未支持')
  expect((await f.read()).state).toBe('unavailable')
  vi.stubEnv('QODER_JOB_TOKEN', ''); vi.stubEnv('QODER_CENTER_ENDPOINT', 'https://synthetic.invalid\n')
  expect(() => qoderEnvironment()).toThrow('尚未支持')
  vi.stubEnv('QODER_CENTER_ENDPOINT', ''); vi.stubEnv('QODERCLI_SITE', 'cn')
  expect(() => qoderEnvironment()).toThrow('国际版')
  vi.stubEnv('QODERCLI_SITE', ''); vi.stubEnv('QODER_PAT', 'synthetic-legacy-pat')
  expect(() => qoderEnvironment()).toThrow('尚未支持')
})
it('propagates cancellation before reading a credential', async () => {
  const f = await fixture(); await f.set()
  const controller = new AbortController(); controller.abort(new Error('synthetic-cancel'))
  await expect(readQoderAccount('/synthetic/qoder.js', controller.signal, f.options)).rejects.toThrow('synthetic-cancel')
  expect(f.options.query).not.toHaveBeenCalled()
})
it('binds configured provider keys, endpoints and encrypted customs across all project setting levels', async () => {
  const f = await fixture(); await f.set()
  const config = { providers: { synthetic: { apiKey: 'synthetic-provider-key', baseURL: 'https://synthetic.invalid' } } }
  await mkdir(join(f.directory, '.qoder'))
  const settings = join(f.directory, '.qoder/settings.local.json')
  await writeFile(settings, JSON.stringify(config), { mode: 0o600 })
  const first = await f.binding()
  expect(JSON.stringify(first)).not.toMatch(/synthetic-provider-key|https:\/\/synthetic/)
  config.providers.synthetic.apiKey = 'changed-synthetic-key'
  await writeFile(settings, JSON.stringify(config))
  expect(await f.binding()).not.toEqual(first)
  const customs = join(f.directory, '.models', f.value.userId, 'customs')
  await mkdir(join(f.directory, '.models', f.value.userId), { recursive: true })
  await writeFile(customs, 'synthetic-encrypted-custom-models', { mode: 0o600 })
  const second = await f.binding()
  await writeFile(customs, 'changed-synthetic-model-route')
  expect(await f.binding()).not.toEqual(second)
  config.providers.synthetic.apiKey = '${SYNTHETIC_DYNAMIC_KEY}'
  await writeFile(settings, JSON.stringify(config))
  await expect(f.binding()).rejects.toThrow('动态凭据')
})
it('binds PAT customs conservatively while ignoring the native .models/default ordinary file', async () => {
  const f = await fixture()
  vi.stubEnv('QODER_PERSONAL_ACCESS_TOKEN', 'synthetic-pat')
  await mkdir(join(f.directory, '.models/synthetic-pat-user'), { recursive: true })
  await writeFile(join(f.directory, '.models/default'), 'synthetic-native-default')
  const path = join(f.directory, '.models/synthetic-pat-user/customs')
  await writeFile(path, 'synthetic-encrypted-custom-models')
  const first = await f.binding()
  expect(f.options.query).not.toHaveBeenCalled()
  await writeFile(path, 'synthetic-changed-route')
  expect(await f.binding()).not.toEqual(first)
  await writeFile(join(f.directory, '.models/default'), 'changed-native-default-model')
  const second = await f.binding()
  await writeFile(join(f.directory, '.models/default'), 'another-default-model')
  expect(await f.binding()).toEqual(second)
})

function accountControlFixture(options: { daemon?: boolean; badHandshake?: boolean; hang?: boolean; unsupported?: 'worker' | 'daemon'; oversized?: boolean; anonymous?: boolean; error?: boolean; stdinError?: 'event' | 'callback'; malformed?: boolean; exitCode?: number; cleanupThrows?: boolean; cleanup?: boolean; terminateThrows?: boolean; endError?: boolean; earlyExit?: boolean; naturalEndExit?: boolean; trailing?: boolean; signal?: string; models?: unknown; abortAtEnd?: AbortController } = {}) {
  const calls: any[] = [], stdout = new PassThrough(), stderr = new PassThrough()
  let resolveDone!: (value: SubprocessOutcome) => void, stopped = false, payloadContent = '', payloadMode = 0
  const done = new Promise<SubprocessOutcome>((resolve) => { resolveDone = resolve })
  const finish = () => {
    if (stopped) return; stopped = true
    if (options.trailing) stdout.write('{"synthetic":"truncated')
    stdout.end(); stderr.end()
    resolveDone({ exitCode: options.exitCode ?? (options.unsupported === 'worker' ? 42 : options.unsupported === 'daemon' ? 1 : options.anonymous ? 41 : 0), signal: options.signal ?? null } as SubprocessOutcome)
  }
  const stdin = new Writable({ write(chunk, _encoding, callback) {
    const value = JSON.parse(String(chunk)); calls.push(value)
    if (options.stdinError) {
      const error = Object.assign(new Error('synthetic-private-stdin-error'), { code: 'EPIPE' })
      if (options.stdinError === 'callback') callback(error)
      else { queueMicrotask(() => stdin.emit('error', error)); callback() }
      return
    }
    queueMicrotask(() => {
      if (options.hang) return
      if (options.unsupported) {
        stderr.write(options.unsupported === 'worker' ? 'sdk_worker_removed: simulated' : "error: unknown option '--sdk'")
        finish(); return
      }
      if (options.oversized) { stdout.write('x'.repeat(2048)); return }
      if (options.anonymous) {
        stdout.write(JSON.stringify({ type: 'result', terminal_reason: 'auth_required', num_turns: 0 }) + '\n'); finish(); return
      }
      if (options.malformed) { stdout.write('synthetic invalid JSON\n'); return }
      if (options.earlyExit) { finish(); return }
      const failed = options.error || options.endError && ['end_session', 'daemon.shutdown'].includes(value.request.type)
      if (['end_session', 'daemon.shutdown'].includes(value.request.type)) options.abortAtEnd?.abort(new Error('synthetic-cancel'))
      stdout.write(JSON.stringify({ type: 'control_response', response: { request_id: value.request_id,
        subtype: failed ? 'error' : 'success', response: options.daemon && value.request.type === 'daemon.initialize' ? { daemon_protocol_version: options.badHandshake ? 1 : 2, daemon_version: '1.1.89', capabilities: ['multi_session_v2', 'daemon_queries_v1'] } : { account: { userId: 'synthetic-native-uid', email: 'native@example.invalid' }, models: options.models ?? modelCatalog.models },
        ...(failed ? { error: 'synthetic-secret-in-error' } : {}),
      } }) + '\n')
      if (options.naturalEndExit && ['end_session', 'daemon.shutdown'].includes(value.request.type)) finish()
    })
    callback()
  } })
  const child = { stdin, stdout, stderr, done, terminate: () => { finish(); if (options.terminateThrows) throw new Error('synthetic-terminate-failed') },
    waitForExit: async () => { if (options.cleanupThrows) throw new Error('synthetic-observation-failed'); return options.cleanup !== false } } as unknown as SubprocessHandle
  const spawn = vi.fn((spec: any) => {
    payloadContent = readFileSync(spec.env.QODER_SDK_AUTH_PAYLOAD_FILE, 'utf8')
    payloadMode = statSync(spec.env.QODER_SDK_AUTH_PAYLOAD_FILE).mode & 0o777
    return child
  })
  return { calls, spawn, stdin, stopped: () => stopped, backend: { spawn, resolveExecutable: async () => '/synthetic/qoder.exe' } as ProcessBackend,
    payload: () => ({ payloadContent, payloadMode }) }
}
describe('synthetic official Qoder account control protocol', () => {
  it.each(['account', 'models'] as const)('accepts the official Windows owned Job exit for %s only after successful protocol completion', async (kind) => {
    const f = await fixture(), transport = accountControlFixture({ exitCode: 1 })
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { ...original, value: 'win32' })
    try {
      const value = kind === 'account'
        ? await queryQoderAccountInfo(transport.backend, DEFAULT_CONFIG, '/synthetic/qoder.exe', f.directory, new AbortController().signal)
        : await discoverQoderModels(transport.backend, DEFAULT_CONFIG, '/synthetic/qoder.exe', f.directory, new AbortController().signal)
      if (kind === 'account') expect(value).toMatchObject({ userId: 'synthetic-native-uid' })
      else expect(value).toHaveLength(2)
      expect(transport.calls.at(-1).request.type).toBe('end_session')
      expect(transport.stopped()).toBe(true)
    } finally { Object.defineProperty(process, 'platform', original) }
  })
  it.each([
    { platform: 'darwin', options: { exitCode: 1 } },
    { platform: 'win32', options: { exitCode: 1, naturalEndExit: true } },
    { platform: 'win32', options: { exitCode: 1, earlyExit: true } },
    { platform: 'win32', options: { exitCode: 1, endError: true } },
  ])('rejects code 1 without Windows owned cleanup proof: %j', async ({ platform, options }) => {
    const f = await fixture(), transport = accountControlFixture(options)
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { ...original, value: platform })
    try {
      await expect(queryQoderAccountInfo(transport.backend, DEFAULT_CONFIG, '/synthetic/qoder.exe', f.directory, new AbortController().signal)).rejects.toThrow('账号查询暂不可用')
    } finally { Object.defineProperty(process, 'platform', original) }
  })
  it('initializes, re-queries account_info and ends the metadata session using private read-only auth payload', async () => {
    const f = await fixture(), transport = accountControlFixture()
    expect(await queryQoderAccountInfo(transport.backend, DEFAULT_CONFIG, '/synthetic/qoder.exe', f.directory, new AbortController().signal))
      .toEqual({ userId: 'synthetic-native-uid', email: 'native@example.invalid' })
    expect(transport.calls.map((value) => value.request.type)).toEqual(['initialize', 'account_info', 'end_session'])
    expect(transport.calls.every((value) => value.type === 'control_request' && value.request.type === value.request.subtype)).toBe(true)
    expect(transport.payload().payloadContent).toBe('{"type":"qodercli"}')
    if (process.platform !== 'win32') expect(transport.payload().payloadMode).toBe(0o600)
    const spec = transport.spawn.mock.calls[0][0]
    expect(spec.env).toMatchObject({ QODER_AGENT_SDK_ENTRYPOINT: 'sdk-ts', QODER_SDK_AUTH_CONFIG_DIR: f.directory })
    expect(spec.env.QODER_CONFIG_DIR).not.toBe(f.directory)
    expect(spec.argv).toContain('--no-session-persistence')
    await expect(readFile(spec.env.QODER_SDK_AUTH_PAYLOAD_FILE)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('recognizes an actual auth_required exit 41 without inventing an account', async () => {
    const f = await fixture(), transport = accountControlFixture({ anonymous: true })
    expect(await queryQoderAccountInfo(transport.backend, DEFAULT_CONFIG, '/synthetic/qoder.exe', f.directory, new AbortController().signal)).toBeNull()
    expect(transport.calls).toHaveLength(1)
  })
  it.each(['error', 'malformed', 'cleanupThrows'] as const)('rejects %s and never exposes native error text', async (kind) => {
    const f = await fixture(), transport = accountControlFixture({ [kind]: true })
    await expect(queryQoderAccountInfo(transport.backend, DEFAULT_CONFIG, '/synthetic/qoder.exe', f.directory, new AbortController().signal)).rejects.toThrow(kind === 'cleanupThrows' ? 'cleanup' : '账号查询暂不可用')
    const path = transport.spawn.mock.calls[0][0].env.QODER_SDK_AUTH_PAYLOAD_FILE
    if (kind === 'cleanupThrows') {
      expect(await readFile(path, 'utf8')).toBe('{"type":"qodercli"}')
      await rm(dirname(path), { recursive: true, force: true })
    } else await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('requires the actual native exit to match successful account metadata', async () => {
    const f = await fixture(), transport = accountControlFixture({ exitCode: 23 })
    await expect(queryQoderAccountInfo(transport.backend, DEFAULT_CONFIG, '/synthetic/qoder.exe', f.directory, new AbortController().signal)).rejects.toThrow('账号查询暂不可用')
  })
  it.each(['event', 'callback'] as const)('contains stdin %s errors, rejects safely and removes its listener after account cleanup', async (stdinError) => {
    const f = await fixture(), transport = accountControlFixture({ stdinError })
    await expect(queryQoderAccountInfo(transport.backend, DEFAULT_CONFIG, '/synthetic/qoder.exe', f.directory, new AbortController().signal))
      .rejects.toThrow('Qoder 原生账号查询暂不可用，请在原生 CLI 中检查登录')
    expect(transport.stopped()).toBe(true)
    expect(transport.stdin.listenerCount('error')).toBe(0)
    const path = transport.spawn.mock.calls[0][0].env.QODER_SDK_AUTH_PAYLOAD_FILE
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

const modelCatalog = { models: [
  { value: 'synthetic-model-a', displayName: 'Synthetic model A', isEnabled: true, efforts: ['high'], supportsDisabled: true },
  { value: 'provider/synthetic-model-b-with-complete-untruncated-id', displayName: 'Synthetic custom model B', isEnabled: true, efforts: [] },
  { value: 'synthetic-disabled-model', displayName: 'Synthetic disabled model', isEnabled: false, efforts: ['max'] },
] }
const discover = (transport: ReturnType<typeof accountControlFixture>, cwd: string, signal = new AbortController().signal) =>
  discoverQoderModels(transport.backend, DEFAULT_CONFIG, '/synthetic/qoder.exe', cwd, signal)
async function cleanRetained(transport: ReturnType<typeof accountControlFixture>) {
  const root = transport.spawn.mock.calls[0]?.[0].env.QODER_CONFIG_DIR
  if (root) await rm(root, { recursive: true, force: true })
}
describe('synthetic Qoder SDK catalog metadata transport', () => {
  it('reads enabled full IDs and native efforts with one catalog-ready initialize and no selection/prompt', async () => {
    const f = await fixture(), transport = accountControlFixture()
    const models = await discover(transport, f.directory)
    expect(models.map((model) => model.efforts)).toEqual([['default', 'none', 'high'], ['default']])
    expect(models[1].id).toBe(modelCatalog.models[1].value)
    expect(transport.calls.map((call) => call.request.type)).toEqual(['initialize', 'end_session'])
    expect(transport.calls[0].request).toMatchObject({ supportsCatalogReadyInitialize: true, skills: [] })
    expect(transport.calls.some((call) => /prompt|authenticate|set_model/.test(call.request.type))).toBe(false)
    expect(transport.spawn.mock.calls[0][0].argv).toContain('--no-session-persistence')
    expect(transport.stopped()).toBe(true)
  })
  it.each(['account', 'models'] as const)('isolates %s settings, env and customs while retaining original auth/cwd and never copying cache/history', async (kind) => {
    const f = await fixture(); await f.set()
    const settings = '{"providers":{"synthetic":{"apiKey":"synthetic-secret","baseUrl":"https://synthetic.invalid"}}}'
    await writeFile(join(f.directory, 'settings.json'), settings)
    await writeFile(join(f.directory, '.env'), 'SYNTHETIC_PROXY=https://synthetic.invalid\n')
    await mkdir(join(f.directory, '.models', 'synthetic-native-uid'), { recursive: true })
    await writeFile(join(f.directory, '.models', 'synthetic-native-uid', 'customs'), 'synthetic-encrypted-customs')
    await writeFile(join(f.directory, '.models', 'default'), 'synthetic-default-cache')
    const transport = accountControlFixture(), originalSpawn = transport.backend.spawn
    let privateRoot = ''
    transport.backend.spawn = (spec) => {
      privateRoot = spec.env!.QODER_CONFIG_DIR!
      expect(privateRoot).not.toBe(f.directory)
      expect(spec.env).toMatchObject({ QODER_SDK_AUTH_CONFIG_DIR: f.directory, QODER_SDK_CUSTOM_BASE_URL_BYOK: '1' })
      expect(spec.cwd).toBe(f.directory)
      expect(readFileSync(join(privateRoot, 'settings.json'), 'utf8')).toBe(settings)
      expect(readFileSync(join(privateRoot, '.env'), 'utf8')).toBe('SYNTHETIC_PROXY=https://synthetic.invalid\n')
      expect(readFileSync(join(privateRoot, '.models', 'synthetic-native-uid', 'customs'), 'utf8')).toBe('synthetic-encrypted-customs')
      expect(() => readFileSync(join(privateRoot, '.auth', 'user'))).toThrow()
      expect(() => readFileSync(join(privateRoot, '.models', 'default'))).toThrow()
      if (process.platform !== 'win32') {
        expect(statSync(privateRoot).mode & 0o777).toBe(0o700)
        expect(statSync(join(privateRoot, 'settings.json')).mode & 0o777).toBe(0o600)
        expect(statSync(join(privateRoot, '.models', 'synthetic-native-uid', 'customs')).mode & 0o777).toBe(0o600)
      }
      return originalSpawn(spec)
    }
    if (kind === 'account') await queryQoderAccountInfo(transport.backend, DEFAULT_CONFIG, '/synthetic/qoder.exe', f.directory, new AbortController().signal)
    else await discover(transport, f.directory)
    await expect(readFile(join(privateRoot, 'settings.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(f.directory, '.models', 'default'), 'utf8')).toBe('synthetic-default-cache')
    expect(await readFile(join(f.directory, 'settings.json'), 'utf8')).toBe(settings)
    expect(await readFile(f.user, 'utf8')).toBe('synthetic-encrypted-user')
  })
  it('uses a private official accessToken payload for the selected PAT without changing execution authentication', async () => {
    const f = await fixture(), transport = accountControlFixture()
    vi.stubEnv('QODER_PERSONAL_ACCESS_TOKEN', 'synthetic-selected-pat')
    await discover(transport, f.directory)
    expect(JSON.parse(transport.payload().payloadContent)).toEqual({ type: 'accessToken', accessToken: 'synthetic-selected-pat' })
    expect(transport.spawn.mock.calls[0][0].env.QODER_PERSONAL_ACCESS_TOKEN).toBe('')
    expect(qoderEnvironment().QODER_PERSONAL_ACCESS_TOKEN).toBe('synthetic-selected-pat')
  })
  it.each([false, true])('keeps PAT machine identity initialization private (existing original: %s)', async (existing) => {
    const f = await fixture(), transport = accountControlFixture()
    if (existing) await f.set()
    else await rm(f.machine)
    vi.stubEnv('QODER_PERSONAL_ACCESS_TOKEN', 'synthetic-selected-pat')
    const originalSpawn = transport.backend.spawn
    transport.backend.spawn = (spec) => {
      const root = spec.env!.QODER_CONFIG_DIR!
      expect(spec.env!.QODER_SDK_AUTH_CONFIG_DIR).toBe(root)
      expect(() => readFileSync(join(root, '.auth', 'user'))).toThrow()
      if (existing) expect(readFileSync(join(root, '.auth', 'machine_id'), 'utf8')).toBe('synthetic-machine-identity')
      else expect(() => readFileSync(join(root, '.auth', 'machine_id'))).toThrow()
      return originalSpawn(spec)
    }
    await discover(transport, f.directory)
    if (existing) expect(await readFile(f.machine, 'utf8')).toBe('synthetic-machine-identity')
    else await expect(readFile(f.machine)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each([
    { general: { disableAutoUpdate: true } },
    { ui: { accessibility: { enableLoadingPhrases: false } } },
    { context: { fileFiltering: { disableFuzzySearch: false } } },
    { tools: { approvalMode: 'default' } },
    { model: { name: 'synthetic', reasoningEffort: 'high' } },
    { model: { preferences: { synthetic: { generation: {} } } } },
  ])('rejects native project migration before spawning and preserves the original %j', async (value) => {
    const f = await fixture(), transport = accountControlFixture()
    await mkdir(join(f.directory, '.qoder'))
    for (const name of ['settings.json', 'settings.local.json']) {
      const path = join(f.directory, '.qoder', name), raw = JSON.stringify(value)
      await writeFile(path, raw)
      await expect(discover(transport, f.directory)).rejects.toThrow('原生迁移')
      expect(transport.spawn).not.toHaveBeenCalled()
      expect(await readFile(path, 'utf8')).toBe(raw)
      await rm(path)
    }
  })
  it.each(['link', 'hardlink', 'oversized'] as const)('rejects %s private configuration inputs before spawning', async (kind) => {
    const f = await fixture(), transport = accountControlFixture(); await f.set()
    const path = join(f.directory, 'settings.json')
    if (kind === 'link') await symlink(f.user, path)
    if (kind === 'hardlink') await link(f.user, path)
    if (kind === 'oversized') await writeFile(path, 'x'.repeat(1024 * 1024 + 1))
    await expect(discover(transport, f.directory)).rejects.toThrow()
    expect(transport.spawn).not.toHaveBeenCalled()
  })
  it('retains current project/local source files and their priority by keeping the original cwd', async () => {
    const f = await fixture(), transport = accountControlFixture()
    await mkdir(join(f.directory, '.qoder'))
    const path = join(f.directory, '.qoder', 'settings.local.json'), raw = '{"model":{"name":"synthetic"},"providers":{"synthetic":{}}}'
    await writeFile(path, raw)
    await discover(transport, f.directory)
    expect(transport.spawn.mock.calls[0][0].cwd).toBe(f.directory)
    expect(transport.spawn.mock.calls[0][0].argv).not.toContain('--setting-sources')
    expect(await readFile(path, 'utf8')).toBe(raw)
  })
  it.each(['QODER_PERSONAL_ACCESS_TOKEN', 'QODER_JOB_TOKEN', 'QODER_SERVER_ENDPOINT', 'QODER_MODEL'])('rejects effective dotenv %s before browser or PAT binding and metadata spawn', async (key) => {
    const f = await fixture(), transport = accountControlFixture(); await f.set()
    const raw = `export ${key} = "synthetic-private-value"\n`
    await writeFile(join(f.directory, '.env'), raw)
    await expect(discover(transport, f.directory)).rejects.toThrow('尚未绑定')
    await expect(f.binding()).rejects.toThrow('尚未绑定')
    vi.stubEnv('QODER_PERSONAL_ACCESS_TOKEN', 'synthetic-host-pat')
    await expect(f.binding()).rejects.toThrow('尚未绑定')
    expect(transport.spawn).not.toHaveBeenCalled()
    expect(await readFile(join(f.directory, '.env'), 'utf8')).toBe(raw)
  })
  it('uses native project dotenv precedence when guarding the selected account source', async () => {
    const f = await fixture(), transport = accountControlFixture()
    await writeFile(join(f.directory, '.env'), 'QODER_PERSONAL_ACCESS_TOKEN=synthetic-ignored-user-pat\n')
    await mkdir(join(f.directory, '.qoder'))
    await writeFile(join(f.directory, '.qoder', '.env'), 'SYNTHETIC_PROXY=https://synthetic.invalid\n')
    await expect(discover(transport, f.directory)).resolves.toHaveLength(2)
    await writeFile(join(f.directory, '.qoder', '.env'), 'QODER_PERSONAL_ACCESS_TOKEN=synthetic-project-pat\n')
    await expect(discover(transport, f.directory)).rejects.toThrow('尚未绑定')
    expect(transport.spawn).toHaveBeenCalledTimes(1)
  })
  it.each(['missing', 'empty'] as const)('does not let read-only browser telemetry initialize a %s original machine identity', async (kind) => {
    const f = await fixture(), transport = accountControlFixture(); await f.set()
    if (kind === 'missing') await rm(f.machine)
    else await writeFile(f.machine, '')
    await expect(discover(transport, f.directory)).rejects.toThrow('机器标识缺失')
    expect(transport.spawn).not.toHaveBeenCalled()
    if (kind === 'missing') await expect(readFile(f.machine)).rejects.toMatchObject({ code: 'ENOENT' })
    else expect(await readFile(f.machine, 'utf8')).toBe('')
  })
  it.each(['malformed', 'error', 'endError', 'trailing'] as const)('rejects %s and removes the confirmed exited private root', async (kind) => {
    const f = await fixture(), transport = accountControlFixture({ [kind]: true })
    await expect(discover(transport, f.directory)).rejects.toThrow('目录暂不可用')
    await expect(readFile(transport.spawn.mock.calls[0][0].env.QODER_SDK_AUTH_PAYLOAD_FILE)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each(['cleanupThrows', 'terminateThrows', 'cleanup'] as const)('retains private files and rejects when %s prevents range confirmation', async (kind) => {
    const f = await fixture(), transport = accountControlFixture({ [kind]: kind === 'cleanup' ? false : true })
    await expect(discover(transport, f.directory)).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
    expect(await readFile(transport.spawn.mock.calls[0][0].env.QODER_SDK_AUTH_PAYLOAD_FILE, 'utf8')).toBe('{"type":"qodercli"}')
    await cleanRetained(transport)
  })
  it.each([{ exitCode: 143 }, { signal: 'SIGTERM' }, { signal: 'SIGKILL' }])('accepts owned native termination only after end_session %j', async (options) => {
    const f = await fixture(), transport = accountControlFixture(options)
    await expect(discover(transport, f.directory)).resolves.toHaveLength(2)
    expect(transport.calls.at(-1).request.type).toBe('end_session')
  })
  it.each([{ exitCode: 143, earlyExit: true }, { exitCode: 23 }, { signal: 'SIGABRT' }])('rejects unowned or unknown exit %j', async (options) => {
    const f = await fixture(), transport = accountControlFixture(options)
    await expect(discover(transport, f.directory)).rejects.toThrow('目录暂不可用')
  })
  it.each([{ exitCode: 143, platform: process.platform }, { exitCode: 1, platform: 'win32' }])('does not turn canceled end_session into owned cleanup: %j', async ({ exitCode, platform }) => {
    const f = await fixture(), controller = new AbortController()
    const transport = accountControlFixture({ exitCode, abortAtEnd: controller })
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { ...original, value: platform })
    try { await expect(discover(transport, f.directory, controller.signal)).rejects.toThrow() }
    finally { Object.defineProperty(process, 'platform', original) }
  })
  it.each(['event', 'callback'] as const)('contains stdin %s errors and removes its listener', async (stdinError) => {
    const f = await fixture(), transport = accountControlFixture({ stdinError })
    await expect(discover(transport, f.directory)).rejects.toThrow('目录暂不可用')
    expect(transport.stopped()).toBe(true)
    expect(transport.stdin.listenerCount('error')).toBe(0)
  })
  it('does not infer IDs or efforts and rejects missing enabled flags', () => {
    expect(() => parseQoderModelState('MODEL\nSynthetic Model\n')).toThrow('结构化')
    expect(() => parseQoderModelState({ models: [{ value: '', displayName: 'Synthetic', isEnabled: true }] })).toThrow('格式')
    expect(() => parseQoderModelState({ models: [{ value: 'synthetic', displayName: 'Synthetic' }] })).toThrow('格式')
    expect(parseQoderModelState({ models: [{ value: 'synthetic', displayName: 'Synthetic', isEnabled: true, efforts: ['unknown-future'] }] })[0].efforts).toEqual(['default'])
  })
})

// Operation snapshots below use real temporary source files and synthetic native transports.
async function snapshotFixture() {
  const f = await fixture(); await f.set()
  const executable = join(f.directory, 'synthetic-qoder.js')
  await writeFile(executable, '/* synthetic executable, never launched */')
  const config = { ...DEFAULT_CONFIG, qoderExecutable: executable }
  const transports: ReturnType<typeof accountControlFixture>[] = []
  let options: Parameters<typeof accountControlFixture>[0] = {}
  const backend: ProcessBackend = {
    resolveExecutable: async () => executable,
    spawn: (spec) => {
      const transport = accountControlFixture(options); transports.push(transport)
      return transport.backend.spawn(spec)
    },
  }
  const signal = new AbortController().signal
  const scope = <T>(operation: () => Promise<T>) => withQoderCatalogSnapshot(backend, config, executable, f.directory, signal, operation)
  const account = () => queryQoderAccountInfo(backend, config, executable, f.directory, signal)
  const models = () => discoverQoderModels(backend, config, executable, f.directory, signal)
  return { ...f, executable, config, transports, backend, signal, scope, account, models, fail: (value: typeof options) => { options = value } }
}
describe('synthetic Qoder operation-scoped settings performance', () => {
  it('uses two processes for cold settings, one for refresh, fresh binding on warm hits and two on reopen', async () => {
    const f = await snapshotFixture(), cache = new SettingsCatalogCache(f.directory)
    const status = () => readQoderAccount(f.executable, f.signal, { backend: f.backend, config: f.config, project: f.directory })
    const input = { cli: 'qoder' as const, project: f.directory, signal: f.signal, selfVerifiedDiscovery: true,
      binding: () => readCliAccountBinding('qoder', f.backend, f.config, f.directory, f.signal),
      discover: () => authorizedCatalog('qoder', f.backend, f.config, f.directory, f.signal) }
    expect((await status()).state).toBe('authenticated')
    const cold = await cache.get(input)
    expect(f.transports).toHaveLength(2)
    expect(f.transports[1]!.calls.map((call) => call.request.type)).toEqual(['initialize', 'end_session'])
    expect(cold.catalog.models).toHaveLength(2)
    expect((await cache.get({ ...input, refresh: true })).binding).toBe(cold.binding)
    expect(f.transports).toHaveLength(3)
    await cache.get(input)
    expect(f.transports).toHaveLength(4)
    expect(f.transports[3]!.calls.map((call) => call.request.type)).toEqual(['initialize', 'account_info', 'end_session'])
    await status(); await cache.get(input)
    expect(f.transports).toHaveLength(6)
    expect(f.transports.every((transport) => transport.stopped())).toBe(true)
    for (const transport of f.transports) {
      expect(transport.calls.some((call) => /prompt|set_model|set_config_option|authenticate/.test(call.request.type))).toBe(false)
      await expect(readFile(transport.spawn.mock.calls[0]![0].env.QODER_SDK_AUTH_PAYLOAD_FILE)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })
  it('preserves the expected Worker binding and never substitutes a new account', async () => {
    const f = await snapshotFixture()
    await expect(authorizedCatalog('qoder', f.backend, f.config, f.directory, f.signal, 'synthetic-obsolete-binding')).rejects.toThrow('账号已变更')
    expect(f.transports).toHaveLength(1)
    const current = await authorizedCatalog('qoder', f.backend, f.config, f.directory, f.signal)
    expect(f.transports).toHaveLength(2)
    expect((await authorizedCatalog('qoder', f.backend, f.config, f.directory, f.signal, current.binding)).binding).toBe(current.binding)
    expect(f.transports).toHaveLength(3)
  })
  it.each(['logout', 'account', 'machine', 'global-settings', 'project-settings', 'local-settings', 'user-env', 'project-env', 'customs-add', 'customs-change', 'customs-delete', 'slot-add', 'slot-delete', 'environment', 'pat', 'executable'] as const)('rejects %s changed during catalog discovery', async (kind) => {
    const f = await snapshotFixture(), slot = join(f.directory, '.models', 'synthetic-native-uid')
    await mkdir(slot, { recursive: true }); await mkdir(join(f.directory, '.qoder'))
    const customs = join(slot, 'customs')
    if (kind !== 'customs-add') await writeFile(customs, 'synthetic-before')
    const mutate = async () => {
      if (kind === 'logout') await rm(f.user)
      if (kind === 'account') await writeFile(f.user, 'synthetic-other-account')
      if (kind === 'machine') await writeFile(f.machine, 'synthetic-other-machine')
      if (kind === 'global-settings') await writeFile(join(f.directory, 'settings.json'), '{}')
      if (kind === 'project-settings') await writeFile(join(f.directory, '.qoder', 'settings.json'), '{}')
      if (kind === 'local-settings') await writeFile(join(f.directory, '.qoder', 'settings.local.json'), '{}')
      if (kind === 'user-env') await writeFile(join(f.directory, '.env'), 'SYNTHETIC_PROXY=changed')
      if (kind === 'project-env') await writeFile(join(f.directory, '.qoder', '.env'), 'SYNTHETIC_PROXY=changed')
      if (kind === 'customs-add' || kind === 'customs-change') await writeFile(customs, 'synthetic-after')
      if (kind === 'customs-delete') await rm(customs)
      if (kind === 'slot-add') await mkdir(join(f.directory, '.models', 'synthetic-added-slot'))
      if (kind === 'slot-delete') await rm(slot, { recursive: true })
      if (kind === 'environment') vi.stubEnv('SYNTHETIC_QODER_PROXY', 'changed')
      if (kind === 'pat') vi.stubEnv('QODER_PERSONAL_ACCESS_TOKEN', 'synthetic-new-pat')
      if (kind === 'executable') await writeFile(f.executable, '/* changed synthetic executable */')
    }
    await expect(f.scope(async () => { await f.account(); await f.models(); await mutate() })).rejects.toThrow('来源已变化')
    expect(f.transports).toHaveLength(1)
  })
  it.each(['symlink', 'oversized', 'missing-executable'] as const)('refuses an unverifiable %s source before launching metadata', async (kind) => {
    const f = await snapshotFixture()
    if (kind === 'symlink') { await rm(f.user); await symlink(f.machine, f.user) }
    if (kind === 'oversized') await writeFile(f.user, 'x'.repeat(1_048_577))
    if (kind === 'missing-executable') await rm(f.executable)
    await expect(f.scope(f.account)).rejects.toThrow('来源已变化')
    expect(f.transports).toHaveLength(0)
  })
  it('rejects saved executable changes even when the previous launcher file is unchanged', async () => {
    const f = await snapshotFixture(), paths = new CliExecutablePathStore(f.directory)
    const config = { ...f.config, cliExecutablePaths: paths }
    await expect(withQoderCatalogSnapshot(f.backend, config, f.executable, f.directory, f.signal, async () => {
      await queryQoderAccountInfo(f.backend, config, f.executable, f.directory, f.signal)
      paths.setManual('qoder', f.executable)
    })).rejects.toThrow('来源已变化')
    expect(f.transports).toHaveLength(1)
  })
  it('does not publish a directory when logout occurs before the native cleanup barrier completes', async () => {
    const f = await snapshotFixture(), cache = new SettingsCatalogCache(f.directory), original = f.backend.spawn
    f.backend.spawn = (spec) => {
      const child = original(spec), wait = child.waitForExit.bind(child)
      child.waitForExit = async () => { const result = await wait(); await rm(f.user); return result }
      return child
    }
    await expect(cache.get({ cli: 'qoder', project: f.directory, signal: f.signal, selfVerifiedDiscovery: true,
      binding: async () => 'unused', discover: () => authorizedCatalog('qoder', f.backend, f.config, f.directory, f.signal),
    })).rejects.toThrow('来源已变化')
    expect(cache.display(f.directory, 'qoder', 'unused')).toBeUndefined()
  })
  it('keeps parallel operations separate and prevents escaped async descendants from reusing a completed account', async () => {
    const f = await snapshotFixture()
    let release!: () => void, descendant!: Promise<unknown>
    const gate = new Promise<void>((resolve) => { release = resolve })
    await Promise.all([f.scope(async () => { await f.account(); await f.models() }), f.scope(async () => {
      await f.account()
      descendant = gate.then(f.account)
      await f.models()
    })])
    expect(f.transports).toHaveLength(2)
    release(); await descendant
    expect(f.transports).toHaveLength(3)
    expect(f.transports[2]!.calls.map((call) => call.request.type)).toEqual(['initialize', 'account_info', 'end_session'])
  })
  it.each(['backend', 'config', 'signal', 'executable', 'project'] as const)('does not share metadata with a different %s context', async (kind) => {
    const f = await snapshotFixture(), other = join(f.directory, 'other')
    await mkdir(other)
    const otherExecutable = join(other, 'synthetic-other-qoder.mjs')
    await writeFile(otherExecutable, '#!/usr/bin/env node\n// Synthetic entry identity; the backend is simulated.\n', { mode: 0o700 })
    await f.scope(async () => {
      await f.account()
      await queryQoderAccountInfo(kind === 'backend' ? { ...f.backend } : f.backend,
        kind === 'config' ? { ...f.config } : f.config,
        kind === 'executable' ? otherExecutable : f.executable,
        kind === 'project' ? other : f.directory,
        kind === 'signal' ? new AbortController().signal : f.signal)
    })
    expect(f.transports).toHaveLength(2)
    expect(f.transports[1]!.calls.map((call) => call.request.type)).toContain('account_info')
  })
  it.each(['error', 'cleanup', 'cancel'] as const)('does not publish %s or reuse a failed operation', async (kind) => {
    const f = await snapshotFixture(), cache = new SettingsCatalogCache(f.directory), controller = new AbortController()
    const signal = kind === 'cancel' ? controller.signal : f.signal
    f.fail(kind === 'cleanup' ? { cleanup: false } : kind === 'cancel' ? { abortAtEnd: controller } : { endError: true })
    const input = { cli: 'qoder' as const, project: f.directory, signal, selfVerifiedDiscovery: true,
      binding: async () => 'unused', discover: () => authorizedCatalog('qoder', f.backend, f.config, f.directory, signal) }
    await expect(cache.get(input)).rejects.toThrow()
    expect(f.transports).toHaveLength(1)
    if (kind === 'cleanup') await cleanRetained(f.transports[0]!)
    f.fail({})
    const freshSignal = new AbortController().signal
    const result = await cache.get({ ...input, signal: freshSignal, discover: () => authorizedCatalog('qoder', f.backend, f.config, f.directory, freshSignal) })
    expect(result.catalog.models).toHaveLength(2)
    expect(f.transports).toHaveLength(2)
  })
})

async function timedStatusFixture(metadataMs: number) {
  const f = await fixture(); await f.set()
  const executable = join(f.directory, 'synthetic-qoder.exe')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const stdout = new PassThrough(), stderr = new PassThrough(), calls: string[] = []
  let complete!: (value: SubprocessOutcome) => void, spawned!: () => void
  let stopping = false, exited = false, childSignal: AbortSignal | undefined
  const done = new Promise<SubprocessOutcome>((resolve) => { complete = resolve })
  const ready = new Promise<void>((resolve) => { spawned = resolve })
  const stdin = new Writable({ write(chunk, _encoding, callback) {
    const message = JSON.parse(String(chunk)), method = message.request.type
    calls.push(method)
    const respond = () => {
      if (stopping) return
      stdout.write(JSON.stringify({ type: 'control_response', response: {
        request_id: message.request_id, subtype: 'success',
        response: { account: { userId: 'synthetic-timed-user', email: 'timed@example.invalid' } },
      } }) + '\n')
    }
    if (method === 'initialize') setTimeout(respond, metadataMs)
    else queueMicrotask(respond)
    callback()
  } })
  const terminate = vi.fn(() => {
    if (stopping) return
    stopping = true
    setTimeout(() => {
      exited = true; stdout.end(); stderr.end()
      complete({ exitCode: null, signal: 'SIGKILL' })
    }, 5_000)
  })
  const backend: ProcessBackend = { resolveExecutable: async () => executable,
    spawn: (spec) => {
      expect(spec.argv[0]).toBe(executable)
      childSignal = spec.signal
      spawned()
      return { stdin, stdout, stderr, done, terminate,
        waitForExit: async () => { await done; return exited },
      } as unknown as SubprocessHandle
    },
  }
  // Pin this simulated entry so Windows never discovers a real user installation.
  const manager = new AccountManager(backend, { ...DEFAULT_CONFIG, qoderExecutable: executable })
  const controller = new AbortController()
  let settled = false
  const result = manager.status('qoder', f.directory, controller.signal)
  void result.then(() => { settled = true }, () => { settled = true })
  await Promise.race([ready, result.then(() => { throw new Error('Synthetic account query did not reach metadata spawn') })])
  return { ...f, manager, controller, result, terminate, calls,
    settled: () => settled, exited: () => exited, aborted: () => childSignal!.aborted }
}
describe('Qoder account status budget includes native cleanup (synthetic clocks)', () => {
  it('publishes authentication only after six seconds of metadata and five seconds of confirmed cleanup', async () => {
    const f = await timedStatusFixture(6_000)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(f.calls).toEqual(['initialize', 'account_info', 'end_session'])
    expect(f.terminate).toHaveBeenCalledTimes(1)
    expect(f.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(f.aborted()).toBe(false)
    expect(f.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await f.result).toMatchObject({ state: 'authenticated', accountLabel: 'timed@example.invalid' })
    expect(f.exited()).toBe(true)
    await f.manager.close()
  })
  it('aborts metadata still incomplete at fifteen seconds and never publishes its later response', async () => {
    const f = await timedStatusFixture(20_000)
    await vi.advanceTimersByTimeAsync(14_999)
    expect(f.aborted()).toBe(false)
    expect(f.terminate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(f.aborted()).toBe(true)
    expect(f.terminate).toHaveBeenCalled()
    expect(f.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await f.result).toMatchObject({ state: 'unavailable', installed: true })
    expect(f.calls).toEqual(['initialize'])
    expect(f.exited()).toBe(true)
    await f.manager.close()
  })
  it('starts cleanup immediately on explicit cancellation and does not report completion before range exit', async () => {
    const f = await timedStatusFixture(6_000)
    await vi.advanceTimersByTimeAsync(1_000)
    const rejected = expect(f.result).rejects.toThrow('查询已取消')
    f.controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.aborted()).toBe(true)
    expect(f.terminate).toHaveBeenCalled()
    expect(f.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(f.exited()).toBe(false)
    expect(f.settled()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await rejected
    expect(f.exited()).toBe(true)
    expect(f.calls).toEqual(['initialize'])
    await f.manager.close()
  })
})


// 以下 daemon 协议及官方包布局均为模拟，不执行真实 CLI。
async function simulatedPackage(directory: string, version: string, name = '@qoder-ai/qodercli') {
  const root = join(directory, 'SIMULATED-package')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name, version }))
  const entry = join(root, 'qoder.exe')
  await writeFile(entry, 'SIMULATED-native-entry')
  return entry
}
describe('模拟 Qoder SDK daemon 元数据', () => {
  it.each(['account', 'models'] as const)('模拟新版 %s：握手、字段、私有权限、代理继承和 shutdown', async kind => {
    const f = await fixture(), transport = accountControlFixture({ daemon: true })
    const executable = await simulatedPackage(f.directory, '1.1.89')
    vi.stubEnv('HTTPS_PROXY', 'http://SIMULATED.invalid:1234')
    const signal = new AbortController().signal
    const value = kind === 'account'
      ? await queryQoderAccountInfo(transport.backend, DEFAULT_CONFIG, executable, f.directory, signal)
      : await discoverQoderModels(transport.backend, DEFAULT_CONFIG, executable, f.directory, signal)
    if (kind === 'models') expect(value).toEqual(parseQoderModelState(modelCatalog))
    else expect(value).toMatchObject({ userId: 'synthetic-native-uid' })
    expect(transport.calls.map(v => v.request.type)).toEqual(['daemon.initialize', 'daemon.account_info', ...(kind === 'models' ? ['daemon.get_models'] : []), 'daemon.shutdown'])
    expect(transport.calls[0].request).toMatchObject({ daemon_protocol_version: 2, sdk_version: '1.0.59', auth: { type: 'qodercli' } })
    expect(transport.calls.every(v => v.session_id === undefined && v.request.subtype === undefined)).toBe(true)
    if (kind === 'models') expect(transport.calls[2].request).toMatchObject({ fetchStrategy: 'live', uid: 'synthetic-native-uid' })
    const spec = transport.spawn.mock.calls[0][0]
    expect(spec.argv).toEqual([executable, '--sdk'])
    expect(spec.env).toMatchObject({ QODER_AGENT_SDK_DAEMON: '1', QODER_AGENT_SDK_VERSION: '1.0.59', QODER_SDK_AUTH_CONFIG_DIR: f.directory })
    expect(spec.env.HTTPS_PROXY).toBeUndefined() // Backend inherits the Host environment.
    expect(process.env.HTTPS_PROXY).toBe('http://SIMULATED.invalid:1234')
    if (process.platform !== 'win32') expect(transport.payload().payloadMode).toBe(0o600)
    expect(transport.stopped()).toBe(true)
    await expect(readFile(spec.env.QODER_SDK_AUTH_PAYLOAD_FILE)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each(['1.1.73', '1.1.80', '1.1.81', '1.2.0', '2.0.0'])('模拟官方包版本分流 %s', async version => {
    const f = await fixture(), daemon = !['1.1.73', '1.1.80'].includes(version)
    const transport = accountControlFixture({ daemon })
    await queryQoderAccountInfo(transport.backend, DEFAULT_CONFIG, await simulatedPackage(f.directory, version), f.directory, new AbortController().signal)
    expect(transport.spawn.mock.calls[0][0].argv).toContain(daemon ? '--sdk' : '--print')
  })
  it('模拟其他包名不能充当 Qoder 版本证据', async () => {
    const f = await fixture(), transport = accountControlFixture()
    await queryQoderAccountInfo(transport.backend, DEFAULT_CONFIG, await simulatedPackage(f.directory, '1.1.89', '@qodercn-ai/qoderclicn'), f.directory, new AbortController().signal)
    expect(transport.spawn.mock.calls[0][0].argv).toContain('--print')
  })
  it.each(['worker', 'daemon'] as const)('模拟 %s 明确不支持时仅切换一次且先清理', async protocol => {
    const f = await fixture(), first = accountControlFixture({ unsupported: protocol }), second = accountControlFixture({ daemon: protocol === 'worker' })
    const executable = protocol === 'daemon' ? await simulatedPackage(f.directory, '1.1.89') : '/synthetic/unknown.exe'
    const spawn = vi.fn((spec:any) => {
      if (spawn.mock.calls.length === 1) return first.spawn(spec)
      expect(first.stopped()).toBe(true)
      expect(() => statSync(first.spawn.mock.calls[0][0].env.QODER_SDK_AUTH_PAYLOAD_FILE)).toThrow()
      return second.spawn(spec)
    })
    await expect(queryQoderAccountInfo({ ...first.backend, spawn }, DEFAULT_CONFIG, executable, f.directory, new AbortController().signal)).resolves.toMatchObject({ userId: 'synthetic-native-uid' })
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(second.stopped()).toBe(true)
  })
  it('模拟两个协议都不支持时保留兼容提示且不启动第三次', async () => {
    const f = await fixture(), first = accountControlFixture({ unsupported: 'worker' }), second = accountControlFixture({ unsupported: 'daemon' })
    const spawn = vi.fn((spec:any) => spawn.mock.calls.length === 1 ? first.spawn(spec) : second.spawn(spec))
    await expect(queryQoderAccountInfo({ ...first.backend, spawn }, DEFAULT_CONFIG, '/synthetic/unknown.exe', f.directory, new AbortController().signal)).rejects.toThrow('插件尚未适配')
    expect(spawn).toHaveBeenCalledTimes(2)
  })
  it.each(['earlyExit', 'endError', 'malformed', 'badHandshake', 'error', 'oversized', 'trailing'] as const)('模拟 daemon %s 失败清理且不重试', async kind => {
    const f = await fixture(), transport = accountControlFixture({ daemon: true, [kind]: true })
    await expect(queryQoderAccountInfo(transport.backend, { ...DEFAULT_CONFIG, maxLineBytes: 1024 }, await simulatedPackage(f.directory, '1.1.89'), f.directory, new AbortController().signal)).rejects.toThrow()
    expect(transport.spawn).toHaveBeenCalledTimes(1)
    expect(transport.stopped()).toBe(true)
    await expect(readFile(transport.spawn.mock.calls[0][0].env.QODER_SDK_AUTH_PAYLOAD_FILE)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('模拟 daemon 在 shutdown 回执时 abort 不返回成功且清理', async () => {
    const f = await fixture(), controller = new AbortController(), transport = accountControlFixture({ daemon: true, abortAtEnd: controller })
    await expect(queryQoderAccountInfo(transport.backend, DEFAULT_CONFIG, await simulatedPackage(f.directory, '1.1.89'), f.directory, controller.signal)).rejects.toThrow()
    expect(transport.stopped()).toBe(true)
    await expect(readFile(transport.spawn.mock.calls[0][0].env.QODER_SDK_AUTH_PAYLOAD_FILE)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each(['account', 'models'] as const)('模拟 %s 预算超时终止并清理', async kind => {
    const f = await fixture(), transport = accountControlFixture({ daemon: true, hang: true }), controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    const executable = await simulatedPackage(f.directory, '1.1.89')
    const pending = kind === 'account'
      ? queryQoderAccountInfo(transport.backend, DEFAULT_CONFIG, executable, f.directory, new AbortController().signal)
      : discoverQoderModels(transport.backend, DEFAULT_CONFIG, executable, f.directory, new AbortController().signal)
    const assertion = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(transport.spawn).toHaveBeenCalledTimes(1))
    expect(timeout).toHaveBeenCalledWith(kind === 'models' ? 30000 : 15000)
    controller.abort(new DOMException('模拟超时', 'TimeoutError'))
    await assertion; timeout.mockRestore()
    expect(transport.stopped()).toBe(true)
    await expect(readFile(transport.spawn.mock.calls[0][0].env.QODER_SDK_AUTH_PAYLOAD_FILE)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('模拟 daemon 清理未确认保留私有文件且不回退', async () => {
    const f = await fixture(), transport = accountControlFixture({ daemon: true, cleanup: false })
    await expect(queryQoderAccountInfo(transport.backend, DEFAULT_CONFIG, await simulatedPackage(f.directory, '1.1.89'), f.directory, new AbortController().signal)).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
    const root = dirname(transport.spawn.mock.calls[0][0].env.QODER_SDK_AUTH_PAYLOAD_FILE); roots.push(root)
    expect(statSync(root).isDirectory()).toBe(true)
    expect(transport.spawn).toHaveBeenCalledTimes(1)
  })
  it('模拟 daemon 启动前拒绝 .env 认证覆盖', async () => {
    const f = await fixture(), transport = accountControlFixture({ daemon: true })
    await writeFile(join(f.directory, '.env'), 'QODER_PAT=SIMULATED')
    await expect(queryQoderAccountInfo(transport.backend, DEFAULT_CONFIG, await simulatedPackage(f.directory, '1.1.89'), f.directory, new AbortController().signal)).rejects.toThrow('.env')
    expect(transport.spawn).not.toHaveBeenCalled()
  })
})

it('模拟 daemon abort 同时范围退出未确认时保留清理错误', async () => {
  const f = await fixture(), controller = new AbortController(), transport = accountControlFixture({ daemon: true, cleanup: false, abortAtEnd: controller })
  await expect(queryQoderAccountInfo(transport.backend, DEFAULT_CONFIG, await simulatedPackage(f.directory, '1.1.89'), f.directory, controller.signal)).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
  roots.push(dirname(transport.spawn.mock.calls[0][0].env.QODER_SDK_AUTH_PAYLOAD_FILE))
  expect(transport.spawn).toHaveBeenCalledTimes(1)
})

it('模拟 daemon PAT 仅经私有 payload 与握手传递，清理后不保留认证文件', async () => {
  const f = await fixture(), transport = accountControlFixture({ daemon: true })
  vi.stubEnv('QODER_PERSONAL_ACCESS_TOKEN', 'SIMULATED-pat')
  const result = await queryQoderAccountInfo(transport.backend, DEFAULT_CONFIG, await simulatedPackage(f.directory, '1.1.89'), f.directory, new AbortController().signal)
  const spec = transport.spawn.mock.calls[0][0]
  expect(spec.env.QODER_SDK_AUTH_CONFIG_DIR).toBe(spec.env.QODER_CONFIG_DIR)
  expect(spec.env.QODER_PERSONAL_ACCESS_TOKEN).toBe('')
  expect(transport.calls[0].request.auth).toEqual({ type: 'accessToken', accessToken: 'SIMULATED-pat' })
  expect(JSON.parse(transport.payload().payloadContent)).toEqual({ type: 'accessToken', accessToken: 'SIMULATED-pat' })
  if (process.platform !== 'win32') expect(transport.payload().payloadMode).toBe(0o600)
  expect(JSON.stringify(result)).not.toContain('SIMULATED-pat')
  await expect(readFile(spec.env.QODER_SDK_AUTH_PAYLOAD_FILE)).rejects.toMatchObject({ code: 'ENOENT' })
})
it('模拟 worker 已移除但清理未确认时禁止 daemon 回退', async () => {
  const f = await fixture(), transport = accountControlFixture({ unsupported: 'worker', cleanup: false })
  await expect(queryQoderAccountInfo(transport.backend, DEFAULT_CONFIG, '/synthetic/unknown.exe', f.directory, new AbortController().signal)).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
  roots.push(dirname(transport.spawn.mock.calls[0][0].env.QODER_SDK_AUTH_PAYLOAD_FILE))
  expect(transport.spawn).toHaveBeenCalledTimes(1)
})
