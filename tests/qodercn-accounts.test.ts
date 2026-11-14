import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import { authorizeSelection } from '../src/host/authorized-catalog.ts'
import { qoderConfigDirectory, qoderEnvironment, readQoderAccount, readQoderAccountBindingMaterial,
  discoverQoderModels, queryQoderAccountInfo, withQoderCatalogSnapshot } from '../src/host/qoder-accounts.ts'

// Every account, PAT, SDK transport and model below is simulated. No native login or real model.
const roots: string[] = []
const syntheticExecutable = join(tmpdir(), 'qodercn-SIMULATED-entry', 'qoderclicn.exe')
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  for (const name of Object.keys(process.env)) if (/^QODER(?:CN|CLI)?_/.test(name)) vi.stubEnv(name, '')
  const root = await realpath(await mkdtemp(join(tmpdir(), 'qodercn-SIMULATED-account-')))
  roots.push(root)
  const global = join(root, '.qoder'), cn = join(root, '.qoder-cn'), project = join(root, 'project')
  for (const directory of [global, cn]) {
    await mkdir(join(directory, '.auth'), { recursive: true, mode: 0o700 })
    await writeFile(join(directory, '.auth', 'machine_id'), 'SIMULATED-machine', { mode: 0o600 })
  }
  await mkdir(project)
  vi.stubEnv('QODER_CONFIG_DIR', global); vi.stubEnv('QODERCN_CONFIG_DIR', cn)
  const value = { userId: 'SIMULATED-cn-user', email: 'cn@example.invalid', access_token: 'SIMULATED-secret' }
  const query = vi.fn(() => value)
  const options = { cli: 'qodercn' as const, project, query }
  const signal = new AbortController().signal
  return { root, global, cn, project, value, query, signal,
    login: (directory = cn) => writeFile(join(directory, '.auth', 'user'), 'SIMULATED-encrypted-native-login', { mode: 0o600 }),
    read: () => readQoderAccount(syntheticExecutable, signal, options),
    binding: () => readQoderAccountBindingMaterial(syntheticExecutable, signal, options) }
}

function metadataFixture(account = { userId: 'SIMULATED-cn-user', email: 'cn@example.invalid' }, daemon = false) {
  const calls: any[] = [], stdout = new PassThrough(), stderr = new PassThrough()
  let stopped = false, resolveDone!: (value: SubprocessOutcome) => void, payload = ''
  const done = new Promise<SubprocessOutcome>(resolve => { resolveDone = resolve })
  const finish = () => {
    if (stopped) return
    stopped = true; stdout.end(); stderr.end()
    resolveDone({ exitCode: 0, signal: null } as SubprocessOutcome)
  }
  const stdin = new Writable({ write(chunk, _encoding, callback) {
    const request = JSON.parse(String(chunk)); calls.push(request)
    queueMicrotask(() => stdout.write(JSON.stringify({ type: 'control_response', response: {
      request_id: request.request_id, subtype: 'success', response: daemon && request.request.type === 'daemon.initialize' ? { daemon_protocol_version: 2, daemon_version: '1.1.89', capabilities: ['multi_session_v2', 'daemon_queries_v1'] } : {
        account,
        models: [{ value: 'cn/native-full-model-key', displayName: 'Synthetic CN model', isEnabled: true, efforts: ['high'] },
          { value: 'cn/disabled', displayName: 'Synthetic disabled CN model', isEnabled: false, efforts: [] }],
      },
    } }) + '\n'))
    callback()
  } })
  const child = { stdin, stdout, stderr, done, terminate: finish, waitForExit: async () => true } as unknown as SubprocessHandle
  const spawn = vi.fn((spec: any) => {
    payload = readFileSync(spec.env.QODER_SDK_AUTH_PAYLOAD_FILE, 'utf8')
    return child
  })
  return { calls, spawn, payload: () => JSON.parse(payload), stopped: () => stopped,
    backend: { spawn, resolveExecutable: async () => syntheticExecutable } as ProcessBackend }
}

describe('Qoder CN own-account isolation (simulated credentials and metadata)', () => {
  it('selects the exact CN native root and keeps the global default separate', () => {
    const base = join(tmpdir(), 'qodercn-SIMULATED-roots')
    const globalHome = join(base, 'global'), cnHome = join(base, 'cn')
    expect(qoderConfigDirectory({}, 'qodercn')).toBe(join(homedir(), '.qoder-cn'))
    expect(qoderConfigDirectory({ QODER_CONFIG_DIR: globalHome, QODER_CLI_HOME: join(base, 'global-home') }, 'qodercn')).toBe(join(homedir(), '.qoder-cn'))
    expect(qoderConfigDirectory({ QODERCN_CLI_HOME: cnHome, QODERCN_CONFIG_DIR_NAME: 'custom-cn' }, 'qodercn')).toBe(join(cnHome, 'custom-cn'))
    expect(qoderConfigDirectory({ QODERCN_CONFIG_DIR: cnHome })).toBe(join(homedir(), '.qoder'))
  })

  it('never substitutes a global login when CN has no login', async () => {
    const f = await fixture(); await f.login(f.global)
    expect(await f.read()).toEqual({ state: 'unconfigured', verification: 'local', summary: '尚未登录 Qoder CN' })
    expect(f.query).not.toHaveBeenCalled()
    await expect(f.binding()).rejects.toThrow('无法确认')
    await expect(readFile(join(f.cn, '.auth', 'user'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('binds the selected CN native principal independently and keeps token rotation stable', async () => {
    const f = await fixture(); await f.login()
    expect(await f.read()).toMatchObject({ state: 'authenticated', verification: 'cli', accountLabel: 'cn@example.invalid' })
    const before = await f.binding()
    expect(before.entries[0]).toMatchObject({ provider: 'qodercn', principal: { kind: 'native-login', uid: 'SIMULATED-cn-user' } })
    expect(before.sourceIds).toContain('native:qodercn-account-info')
    f.value.access_token = 'SIMULATED-rotated-secret'
    expect(await f.binding()).toEqual(before)
    f.value.userId = 'SIMULATED-other-cn-user'
    expect(await f.binding()).not.toEqual(before)
    expect(JSON.stringify(await f.read())).not.toContain('secret')
  })

  it('chooses its own PAT when both brands are configured and clears foreign child controls', async () => {
    const f = await fixture()
    vi.stubEnv('QODER_PERSONAL_ACCESS_TOKEN', 'SIMULATED-global-pat')
    vi.stubEnv('QODERCN_PERSONAL_ACCESS_TOKEN', 'SIMULATED-cn-pat')
    vi.stubEnv('QODER_MODEL', 'global-model'); vi.stubEnv('QODERCN_MODEL', 'cn-model')
    const env = qoderEnvironment('qodercn'), binding = await f.binding()
    expect(env).toMatchObject({ QODERCLI_SITE: 'cn', QODERCN_CONFIG_DIR: f.cn,
      QODERCN_PERSONAL_ACCESS_TOKEN: 'SIMULATED-cn-pat', QODER_PERSONAL_ACCESS_TOKEN: '', QODER_CONFIG_DIR: '', QODER_MODEL: '', QODERCN_MODEL: '' })
    expect(qoderEnvironment()).toMatchObject({ QODERCLI_SITE: 'global', QODER_PERSONAL_ACCESS_TOKEN: 'SIMULATED-global-pat', QODERCN_PERSONAL_ACCESS_TOKEN: '', QODERCN_CONFIG_DIR: '' })
    expect(await f.read()).toMatchObject({ state: 'configured', verification: 'local', authMethod: 'api' })
    expect(f.query).not.toHaveBeenCalled()
    expect(binding.entries[0]).toMatchObject({ provider: 'qodercn', principal: { kind: 'pat' } })
    expect(JSON.stringify(binding)).not.toMatch(/SIMULATED-(?:global|cn)-pat/)
    vi.stubEnv('QODER_PERSONAL_ACCESS_TOKEN', 'SIMULATED-changed-global-pat')
    expect(await f.binding()).toEqual(binding)
    vi.stubEnv('QODERCN_PERSONAL_ACCESS_TOKEN', 'SIMULATED-changed-cn-pat')
    expect(await f.binding()).not.toEqual(binding)
  })

  it.each(['native-login', 'pat'] as const)('keeps %s binding stable when native startup creates only a model catalog cache', async kind => {
    const f = await fixture(); await f.login()
    if (kind === 'pat') vi.stubEnv('QODERCN_PERSONAL_ACCESS_TOKEN', 'SIMULATED-cn-pat')
    const before = await f.binding()
    const slot = join(f.cn, '.models', f.value.userId)
    await mkdir(slot, { recursive: true })
    await writeFile(join(slot, 'catalog-v7'), '{"SIMULATED":"native model cache"}')
    await writeFile(join(f.cn, '.models', 'default'), 'SIMULATED-native-default')
    expect(await f.binding()).toEqual(before)
    await writeFile(join(f.cn, '.auth', 'user'), 'SIMULATED-refreshed-encrypted-login')
    f.value.access_token = 'SIMULATED-refreshed-token'
    expect(await f.binding()).toEqual(before)
    // Real custom routes and real account changes must still invalidate it.
    const customs = join(slot, 'customs')
    await writeFile(customs, 'SIMULATED-encrypted-custom-route')
    const custom = await f.binding()
    expect(custom).not.toEqual(before)
    await writeFile(customs, 'SIMULATED-changed-custom-route')
    expect(await f.binding()).not.toEqual(custom)
    await rm(customs)
    expect(await f.binding()).toEqual(before)
    if (kind === 'pat') vi.stubEnv('QODERCN_PERSONAL_ACCESS_TOKEN', 'SIMULATED-other-cn-pat')
    else f.value.userId = 'SIMULATED-other-cn-user'
    expect(await f.binding()).not.toEqual(before)
  })

  it('keeps the admitted CN account hash after first-run catalog creation and rejects an actual account switch', async () => {
    const f = await fixture(); await f.login()
    const executable = join(f.root, 'SIMULATED-qoderclicn.js')
    await writeFile(executable, '/* SIMULATED executable, never launched */')
    const config = { ...DEFAULT_CONFIG, qodercnExecutable: executable }
    const account = { userId: f.value.userId, email: 'cn@example.invalid' }
    const spawn = vi.fn((spec: any) => metadataFixture(account).backend.spawn(spec))
    const backend = { spawn, resolveExecutable: async () => executable } as ProcessBackend
    const binding = () => readCliAccountBinding('qodercn', backend, config, f.project, f.signal)
    const preference = { cli: 'qodercn' as const, model: 'cn/native-full-model-key', effort: 'high' as const }
    const admitted = await binding()
    const slot = join(f.cn, '.models', account.userId)
    await mkdir(slot, { recursive: true })
    await writeFile(join(slot, 'catalog-v7'), '{"SIMULATED":"native model cache"}')
    await writeFile(join(f.cn, '.models', 'default'), 'SIMULATED-native-default')
    expect(await binding()).toBe(admitted)
    expect((await authorizeSelection(preference, backend, config, f.project, f.signal, admitted)).binding).toBe(admitted)
    account.userId = 'SIMULATED-switched-cn-user'
    expect(await binding()).not.toBe(admitted)
    await expect(authorizeSelection(preference, backend, config, f.project, f.signal, admitted)).rejects.toThrow('账号已变更')
  })

  it('ignores foreign PAT and unsupported foreign branded routes while requiring its own account', async () => {
    const f = await fixture()
    vi.stubEnv('QODER_PERSONAL_ACCESS_TOKEN', 'SIMULATED-global-pat'); vi.stubEnv('QODER_JOB_TOKEN', 'SIMULATED-global-job')
    expect((await f.read()).state).toBe('unconfigured')
    expect(qoderEnvironment('qodercn').QODER_JOB_TOKEN).toBe('')
    vi.stubEnv('QODERCN_JOB_TOKEN', 'SIMULATED-cn-job')
    expect((await f.read()).state).toBe('unavailable')
    expect(() => qoderEnvironment('qodercn')).toThrow('尚未支持')
  })

  it('binds the official shared project .qoder sources and honors only the CN directory override', async () => {
    const f = await fixture(); await f.login()
    const defaultProject = join(f.project, '.qoder'), ignored = join(f.project, '.qoder-cn')
    await mkdir(defaultProject); await mkdir(ignored)
    const path = join(defaultProject, 'settings.local.json')
    await writeFile(path, '{"providers":{"cn":{"apiKey":"SIMULATED-project-key"}}}')
    const before = await f.binding()
    await writeFile(join(ignored, 'settings.local.json'), '{"providers":{"ignored":{}}}')
    expect(await f.binding()).toEqual(before)
    await writeFile(path, '{"providers":{"cn":{"apiKey":"SIMULATED-changed-key"}}}')
    expect(await f.binding()).not.toEqual(before)
    vi.stubEnv('QODERCN_CONFIG_DIR_NAME', 'custom-cn-project')
    await mkdir(join(f.project, 'custom-cn-project'))
    const overridden = await f.binding()
    await writeFile(path, '{"providers":{"cn":{"apiKey":"SIMULATED-ignored-key"}}}')
    expect(await f.binding()).toEqual(overridden)
    await writeFile(join(f.project, 'custom-cn-project', 'settings.json'), '{"providers":{"cn":{}}}')
    expect(await f.binding()).not.toEqual(overridden)
  })

  it('propagates cancellation before querying CN account metadata', async () => {
    const f = await fixture(); await f.login()
    await expect(readQoderAccount(syntheticExecutable, AbortSignal.abort(new Error('SIMULATED-stop')), { cli: 'qodercn', project: f.project, query: f.query })).rejects.toThrow('SIMULATED-stop')
    expect(f.query).not.toHaveBeenCalled()
  })
})

describe('Qoder CN SDK metadata transport (simulated; no login or real model)', () => {
  it.each(['account', 'models'] as const)('uses official qodercli auth payload and CN paths for %s then removes private files', async kind => {
    const f = await fixture(); await f.login()
    const transport = metadataFixture()
    const value = kind === 'account'
      ? await queryQoderAccountInfo(transport.backend, DEFAULT_CONFIG, syntheticExecutable, f.project, f.signal, 'qodercn')
      : await discoverQoderModels(transport.backend, DEFAULT_CONFIG, syntheticExecutable, f.project, f.signal, 'qodercn')
    expect(transport.payload()).toEqual({ type: 'qodercli' })
    if (kind === 'account') expect(value).toMatchObject({ userId: 'SIMULATED-cn-user' })
    else expect(value).toMatchObject([{ id: 'cn/native-full-model-key', efforts: ['default', 'high'] }])
    const spec = transport.spawn.mock.calls[0][0]
    expect(spec.env).toMatchObject({ QODERCLI_SITE: 'cn', QODER_SDK_AUTH_CONFIG_DIR: f.cn,
      QODER_AGENT_SDK_ENTRYPOINT: 'sdk-ts', QODER_CONFIG_DIR: '' })
    expect(spec.env.QODER_PERSONAL_ACCESS_TOKEN || '').toBe('')
    expect(spec.env.QODERCN_CONFIG_DIR).not.toBe(f.cn)
    expect(spec.argv).toContain('--no-session-persistence')
    expect(transport.calls.map(call => call.request.type)).toEqual(kind === 'account' ? ['initialize', 'account_info', 'end_session'] : ['initialize', 'end_session'])
    expect(transport.calls.some(call => /prompt|authenticate|set_model/.test(call.request.type))).toBe(false)
    expect(transport.stopped()).toBe(true)
    await expect(readFile(spec.env.QODER_SDK_AUTH_PAYLOAD_FILE)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(f.cn, '.auth', 'user'), 'utf8')).toBe('SIMULATED-encrypted-native-login')
  })

  it('passes only the selected CN PAT in a private SDK payload', async () => {
    const f = await fixture(), transport = metadataFixture()
    vi.stubEnv('QODER_PERSONAL_ACCESS_TOKEN', 'SIMULATED-global-pat'); vi.stubEnv('QODERCN_PERSONAL_ACCESS_TOKEN', 'SIMULATED-cn-pat')
    await discoverQoderModels(transport.backend, DEFAULT_CONFIG, syntheticExecutable, f.project, f.signal, 'qodercn')
    expect(transport.payload()).toEqual({ type: 'accessToken', accessToken: 'SIMULATED-cn-pat' })
    expect(transport.spawn.mock.calls[0][0].env).toMatchObject({ QODERCN_PERSONAL_ACCESS_TOKEN: '', QODER_PERSONAL_ACCESS_TOKEN: '' })
    expect(qoderEnvironment('qodercn').QODERCN_PERSONAL_ACCESS_TOKEN).toBe('SIMULATED-cn-pat')
  })

  it('shares one settled CN catalog snapshot for model and own-account queries', async () => {
    const f = await fixture(); await f.login()
    const transport = metadataFixture(), executable = join(f.root, 'SIMULATED-qoderclicn.js')
    await writeFile(executable, '/* SIMULATED executable, never launched */')
    const config = { ...DEFAULT_CONFIG, qodercnExecutable: executable }
    const values = await withQoderCatalogSnapshot(transport.backend, config, executable, f.project, f.signal, async () => ({
      models: await discoverQoderModels(transport.backend, config, executable, f.project, f.signal, 'qodercn'),
      account: await queryQoderAccountInfo(transport.backend, config, executable, f.project, f.signal, 'qodercn'),
    }), 'qodercn')
    expect(values.models[0].id).toBe('cn/native-full-model-key')
    expect(values.account).toMatchObject({ userId: 'SIMULATED-cn-user' })
    expect(transport.spawn).toHaveBeenCalledTimes(1)
    expect(transport.stopped()).toBe(true)
  })
})

it('模拟 Qoder CN daemon 使用中国版包身份与独立认证根并复用单次快照', async () => {
  const f = await fixture(), transport = metadataFixture(undefined, true)
  await f.login()
  const executable = join(f.root, 'qoderclicn.exe')
  await writeFile(executable, 'SIMULATED-native-entry')
  await writeFile(join(f.root, 'package.json'), JSON.stringify({ name: '@qodercn-ai/qoderclicn', version: '1.1.89' }))
  const config = { ...DEFAULT_CONFIG }
  const result = await withQoderCatalogSnapshot(transport.backend, config, executable, f.project, f.signal, async () => ({
    account: await queryQoderAccountInfo(transport.backend, config, executable, f.project, f.signal, 'qodercn'),
    models: await discoverQoderModels(transport.backend, config, executable, f.project, f.signal, 'qodercn'),
  }), 'qodercn')
  expect(result.account).toMatchObject({ userId: 'SIMULATED-cn-user' })
  expect(result.models).toEqual([{ id: 'cn/native-full-model-key', label: 'Synthetic CN model', efforts: ['default', 'high'] }])
  expect(transport.spawn).toHaveBeenCalledTimes(1)
  expect(transport.spawn.mock.calls[0][0].env).toMatchObject({ QODERCLI_SITE: 'cn', QODER_CONFIG_DIR: '', QODER_SDK_AUTH_CONFIG_DIR: f.cn, QODER_AGENT_SDK_VERSION: '1.0.59', QODER_AGENT_SDK_DAEMON: '1' })
  expect(transport.calls.map(v => v.request.type)).toEqual(['daemon.initialize', 'daemon.account_info', 'daemon.get_models', 'daemon.shutdown'])
  expect(transport.stopped()).toBe(true)
  await expect(readFile(transport.spawn.mock.calls[0][0].env.QODER_SDK_AUTH_PAYLOAD_FILE)).rejects.toMatchObject({ code: 'ENOENT' })
})
