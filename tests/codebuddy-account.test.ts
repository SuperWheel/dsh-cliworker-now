import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, win32 } from 'node:path'
import { Readable } from 'node:stream'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { codebuddyEnvironment, codebuddyAuthDirectory, readCodebuddyLoginState, codebuddyDeclaredSite, readCodebuddySite, parseCodebuddyModels,
  CodebuddyAccountError, readCodebuddyAccount, readCodebuddyAccountBindingMaterial,
  discoverCodebuddyModels, withCodebuddyCatalogSnapshot } from '../src/host/codebuddy-account.ts'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
import { authorizedCatalog } from '../src/host/authorized-catalog.ts'
import { resolveCliExecutable } from '../src/host/adapters.ts'

// Observe only file paths, never store parsed auth documents or file bytes in mocks.
vi.mock('node:fs/promises', async load => {
  const actual = await load<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open), lstat: vi.fn(actual.lstat) }
})

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'codebuddy-account-simulated-')); roots.push(home)
  vi.stubEnv('HOME', home)
  // Windows homedir() reads USERPROFILE and auth defaults to LOCALAPPDATA; never fall through to the real profile.
  vi.stubEnv('USERPROFILE', home)
  vi.stubEnv('LOCALAPPDATA', win32.join(home, 'AppData', 'Local'))
  vi.stubEnv('CODEBUDDY_INTERNET_ENVIRONMENT', '')
  vi.stubEnv('CODEBUDDY_COPILOT_INTERNET_ENVIRONMENT', '')
  for (const key of ['CODEBUDDY_AUTH_TOKEN', 'CODEBUDDY_API_KEY', 'CODEBUDDY_API_KEY_HELPER_DISABLED',
    'CODEBUDDY_API_KEY_DISABLED', 'CODEBUDDY_CONFIG_DIR', 'CODEBUDDY_PROJECT_CONFIG_DIR']) vi.stubEnv(key, '')
  const options = { home, env: {}, platform: process.platform }
  const file = join(codebuddyAuthDirectory(options.platform, options.env, home), 'Tencent-Cloud.coding-copilot.info')
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  return { home, file, options }
}
const model = (modelId = 'hy4free', credits = 'x0.00 credits') => ({ modelId, name: 'Hy4', _meta: { credits, effortOptions: [{ value: 'high' }] } })
async function saveLoginSettings(root: string, settings: unknown, local = false) {
  await mkdir(join(root, '.codebuddy'), { recursive: true, mode: 0o700 })
  await writeFile(join(root, '.codebuddy', local ? 'settings.local.json' : 'settings.json'),
    JSON.stringify({ _comment: '模拟夹具', ...settings as object }), { mode: 0o600 })
}
function backendFixture(inspect?: (options: any) => Promise<void>) {
  let models = [model()], exitCode = 0
  const calls: any[] = [], directories: Promise<number>[] = []
  const backend = {
    resolveExecutable: vi.fn(async (path: string) => path),
    spawn: vi.fn((options: any) => {
      calls.push(options); directories.push(lstat(options.cwd).then(stat => stat.mode & 0o777))
      return { stdout: Readable.from([JSON.stringify({ models })]), stderr: Readable.from([]),
        done: (inspect?.(options) ?? Promise.resolve()).then(() => ({ exitCode })), waitForExit: vi.fn(async () => true), terminate: vi.fn() }
    }),
  } as unknown as ProcessBackend
  return { backend, calls, directories, set: (value: ReturnType<typeof model>[]) => { models = value }, fail: (code: number) => { exitCode = code } }
}
describe('CodeBuddy 账号与目录（模拟）', () => {
  it.each(['CODEBUDDY_AUTH_TOKEN', 'CODEBUDDY_API_KEY'])('模拟：%s reaches catalog child env only and token rotation invalidates binding', async name => {
    const f = await fixture(), b = backendFixture(), signal = new AbortController().signal
    const project = join(f.home, 'project'); await mkdir(project)
    const env = { [name]: 'SIMULATED_ONLY', CODEBUDDY_API_KEY_HELPER_DISABLED: '1', CODEBUDDY_API_KEY_DISABLED: '',
      CODEBUDDY_INTERNET_ENVIRONMENT: 'external', CODEBUDDY_COPILOT_INTERNET_ENVIRONMENT: '',
      OPENAI_API_KEY: 'SIMULATED_UNRELATED', HTTPS_PROXY: 'http://simulated.invalid' }
    const options = { ...f.options, project, env }
    await withCodebuddyCatalogSnapshot(b.backend, DEFAULT_CONFIG, '/simulated', signal, async () => {
      const first = await readCodebuddyAccountBindingMaterial(b.backend, DEFAULT_CONFIG, '/simulated', signal, options)
      expect(b.calls[0].env).toMatchObject(codebuddyEnvironment(env))
      expect(b.calls[0].env).not.toHaveProperty('OPENAI_API_KEY')
      expect(Object.keys(codebuddyEnvironment(env)).sort()).toEqual(['DISABLE_AUTOUPDATER', name,
        'CODEBUDDY_API_KEY_HELPER_DISABLED', 'CODEBUDDY_API_KEY_DISABLED',
        'CODEBUDDY_INTERNET_ENVIRONMENT', 'CODEBUDDY_COPILOT_INTERNET_ENVIRONMENT'].sort())
      expect(b.calls[0].cwd).not.toBe(project); expect(b.calls[0].argv.at(-1)).toBe(b.calls[0].cwd)
      expect(JSON.stringify([first, b.calls[0].argv])).not.toContain('SIMULATED_ONLY')
      env[name] = 'SIMULATED_CHANGED'
      const second = await readCodebuddyAccountBindingMaterial(b.backend, DEFAULT_CONFIG, '/simulated', signal, options)
      expect(second).not.toEqual(first); expect(b.calls).toHaveLength(2)
      expect(b.calls[1].env[name] === env[name]).toBe(true)
      expect(JSON.stringify(second)).not.toContain('SIMULATED_CHANGED')
    })
    expect((await lstat(project)).isDirectory()).toBe(true)
  })
  it('模拟：no env credentials preserves byte-identical legacy binding material', async () => {
    const f = await fixture(), b = backendFixture(), signal = new AbortController().signal
    await writeFile(f.file, '{"auth":{"domain":"www.codebuddy.cn"}}')
    const catalog = createHash('sha256').update(JSON.stringify([['hy4free', 'x0.00 credits']])).digest('hex')
    const legacy = JSON.stringify({ sourceIds: [f.file], entries: [{ provider: 'codebuddy', principal: { site: 'internal', catalog } }] })
    for (const env of [{}, { CODEBUDDY_AUTH_TOKEN: '', CODEBUDDY_API_KEY: '', CODEBUDDY_API_KEY_DISABLED: '1' }]) {
      expect(JSON.stringify(await readCodebuddyAccountBindingMaterial(b.backend, DEFAULT_CONFIG, '/simulated', signal,
        { ...f.options, env }))).toBe(legacy)
    }
    await rm(f.file); await saveLoginSettings(f.home, { apiKeyHelper: '/simulated/helper', env: { CODEBUDDY_INTERNET_ENVIRONMENT: 'internal' } })
    expect(JSON.stringify(await readCodebuddyAccountBindingMaterial(b.backend, DEFAULT_CONFIG, '/simulated', signal, f.options))).toBe(legacy)
  })
  it.each([
    ['apiKeyHelper', false], ['apiKeyHelper', true], ['env API key', false], ['env API key', true],
  ] as const)('模拟：project-only %s (local=%s) reaches the catalog via private native settings scopes', async (source, local) => {
    const f = await fixture(), project = join(f.home, 'project'), signal = new AbortController().signal
    const settings = source === 'apiKeyHelper' ? { apiKeyHelper: '/simulated/never-execute-helper' }
      : { env: { CODEBUDDY_API_KEY: 'SIMULATED_PROJECT_ONLY', CODEBUDDY_INTERNET_ENVIRONMENT: 'external' } }
    await saveLoginSettings(project, settings, local)
    const filename = local ? 'settings.local.json' : 'settings.json'
    const original = await readFile(join(project, '.codebuddy', filename), 'utf8')
    const before = await readdir(project, { recursive: true })
    const b = backendFixture(async call => {
      const directory = call.env.CODEBUDDY_PROJECT_CONFIG_DIR
      expect(directory).toBe(join(call.cwd, '.codebuddy'))
      expect(await readFile(join(directory, filename), 'utf8')).toBe(original)
      if (process.platform !== 'win32') {
        expect((await lstat(directory)).mode & 0o777).toBe(0o700)
        expect((await lstat(join(directory, filename))).mode & 0o777).toBe(0o600)
      }
      // 模拟原生配置写入：只能写进临时副本，不能修改项目原件。
      await writeFile(join(directory, filename), '{"_comment":"模拟原生写入"}')
    })
    const result = await authorizedCatalog('codebuddy', b.backend, { ...DEFAULT_CONFIG, codebuddyExecutable: '/simulated' }, project, signal)
    expect(result.catalog.models).toHaveLength(1); expect(b.calls).toHaveLength(1)
    expect(b.calls[0].cwd).not.toBe(project); expect(b.calls[0].argv.at(-1)).toBe(b.calls[0].cwd)
    expect(JSON.stringify([b.calls[0].argv, b.calls[0].env, result])).not.toContain('SIMULATED_PROJECT_ONLY')
    expect(JSON.stringify(b.calls[0].argv)).not.toContain('/simulated/never-execute-helper')
    expect(await readFile(join(project, '.codebuddy', filename), 'utf8')).toBe(original)
    expect(await readdir(project, { recursive: true })).toEqual(before)
    await expect(lstat(b.calls[0].cwd)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(b.calls[0].env.CODEBUDDY_PROJECT_CONFIG_DIR)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('模拟：native user -> project -> local scopes retain JSONC bytes and whole-env replacement', async () => {
    const f = await fixture(), project = join(f.home, 'project'), signal = new AbortController().signal
    await saveLoginSettings(f.home, { apiKeyHelper: '/simulated/user-helper', env: { CODEBUDDY_AUTH_TOKEN: 'SIMULATED_USER_TOKEN' } })
    await saveLoginSettings(project, { apiKeyHelper: '', env: { CODEBUDDY_API_KEY: 'SIMULATED_PROJECT_KEY' } })
    const projectRaw = '{ // 模拟 JSONC\n "apiKeyHelper":"", "env":{"CODEBUDDY_API_KEY":"SIMULATED_PROJECT_KEY"}, }'
    await writeFile(join(project, '.codebuddy/settings.json'), projectRaw)
    await saveLoginSettings(project, { apiKeyHelper: '/simulated/local-helper', env: {} }, true)
    const userRaw = await readFile(join(f.home, '.codebuddy/settings.json'), 'utf8')
    const localRaw = await readFile(join(project, '.codebuddy/settings.local.json'), 'utf8')
    const b = backendFixture(async call => {
      expect(await readFile(join(call.env.CODEBUDDY_PROJECT_CONFIG_DIR, 'settings.json'), 'utf8')).toBe(projectRaw)
      expect(await readFile(join(call.env.CODEBUDDY_PROJECT_CONFIG_DIR, 'settings.local.json'), 'utf8')).toBe(localRaw)
      // User stays in its native scope; no flattening into CLI --settings scope.
      expect(await readFile(join(f.home, '.codebuddy/settings.json'), 'utf8')).toBe(userRaw)
      expect(call.argv).not.toContain('--settings')
      expect(call.env).not.toHaveProperty('CODEBUDDY_AUTH_TOKEN')
      expect(call.env).not.toHaveProperty('CODEBUDDY_API_KEY')
    })
    await readCodebuddyAccountBindingMaterial(b.backend, DEFAULT_CONFIG, '/simulated', signal, { ...f.options, project })
    expect(b.calls).toHaveLength(1)
  })
  it.each(['relative', 'absolute'])('模拟：%s configured project directory is copied while the configured user directory stays native', async kind => {
    const f = await fixture(), project = join(f.home, 'project'), user = join(f.home, 'custom-user')
    const configured = kind === 'absolute' ? join(f.home, 'custom-project') : 'custom-project'
    const directory = kind === 'absolute' ? configured : join(project, configured)
    await mkdir(user); await mkdir(directory, { recursive: true })
    const raw = '{"apiKeyHelper":"/simulated/project-helper"}'
    await writeFile(join(directory, 'settings.local.json'), raw)
    const env = { CODEBUDDY_CONFIG_DIR: user, CODEBUDDY_PROJECT_CONFIG_DIR: configured }
    const b = backendFixture(async call => {
      expect(call.env.CODEBUDDY_CONFIG_DIR).toBe(user)
      expect(call.env.CODEBUDDY_PROJECT_CONFIG_DIR).toBe(join(call.cwd, '.codebuddy'))
      expect(await readFile(join(call.env.CODEBUDDY_PROJECT_CONFIG_DIR, 'settings.local.json'), 'utf8')).toBe(raw)
    })
    await readCodebuddyAccountBindingMaterial(b.backend, DEFAULT_CONFIG, '/simulated', new AbortController().signal,
      { ...f.options, env, project })
    expect(await readFile(join(directory, 'settings.local.json'), 'utf8')).toBe(raw)
  })
  it.each(['failure', 'abort'])('模拟：project settings copies are removed on catalog %s', async scenario => {
    const f = await fixture(), project = join(f.home, 'project'), controller = new AbortController()
    await saveLoginSettings(project, { env: { CODEBUDDY_API_KEY: 'SIMULATED_PROJECT_KEY' } })
    const b = backendFixture(async call => {
      expect(await readFile(join(call.env.CODEBUDDY_PROJECT_CONFIG_DIR, 'settings.json'), 'utf8')).toContain('SIMULATED_PROJECT_KEY')
      if (scenario === 'abort') controller.abort()
    })
    if (scenario === 'failure') b.fail(3)
    await expect(discoverCodebuddyModels(b.backend, DEFAULT_CONFIG, '/simulated', controller.signal,
      { ...f.options, project })).rejects.toThrow()
    await expect(lstat(b.calls[0].cwd)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(join(project, '.codebuddy'))).toEqual(['settings.json'])
  })
  it('模拟：project credential rotation invalidates an active catalog snapshot', async () => {
    const f = await fixture(), project = join(f.home, 'project'), signal = new AbortController().signal, b = backendFixture()
    const options = { ...f.options, project }
    await saveLoginSettings(project, { env: { CODEBUDDY_API_KEY: 'SIMULATED_FIRST' } })
    await withCodebuddyCatalogSnapshot(b.backend, DEFAULT_CONFIG, '/simulated', signal, async () => {
      await discoverCodebuddyModels(b.backend, DEFAULT_CONFIG, '/simulated', signal, options)
      await saveLoginSettings(project, { env: { CODEBUDDY_API_KEY: 'SIMULATED_SECOND' } })
      await discoverCodebuddyModels(b.backend, DEFAULT_CONFIG, '/simulated', signal, options)
      expect(b.calls).toHaveLength(2)
    })
  })
  it('模拟：user-only settings retain the native user scope and original catalog argv/environment', async () => {
    const f = await fixture(), b = backendFixture(), signal = new AbortController().signal
    await saveLoginSettings(f.home, { env: { CODEBUDDY_API_KEY: 'SIMULATED_USER_ONLY' } })
    const original = await readFile(join(f.home, '.codebuddy/settings.json'), 'utf8')
    await readCodebuddyAccountBindingMaterial(b.backend, DEFAULT_CONFIG, '/simulated', signal, f.options)
    expect(b.calls[0].argv.slice(2)).toEqual(['/simulated', b.calls[0].cwd])
    expect(b.calls[0].env).not.toHaveProperty('CODEBUDDY_PROJECT_CONFIG_DIR')
    expect(JSON.stringify([b.calls[0].argv, b.calls[0].env])).not.toContain('SIMULATED_USER_ONLY')
    expect(await readFile(join(f.home, '.codebuddy/settings.json'), 'utf8')).toBe(original)
  })
  it.each([
    ['env token', { CODEBUDDY_AUTH_TOKEN: 'SIMULATED_AUTH_TOKEN' }, {}],
    ['settings token', {}, { env: { CODEBUDDY_AUTH_TOKEN: 'SIMULATED_AUTH_TOKEN' } }],
    ['settings helper', {}, { apiKeyHelper: '/simulated/never-execute-helper' }],
    ['env API key', { CODEBUDDY_API_KEY: 'SIMULATED_API_KEY' }, {}],
    ['settings API key', {}, { env: { CODEBUDDY_API_KEY: 'SIMULATED_API_KEY' } }],
  ])('模拟：%s authenticates without a login file and survives a file logout marker', async (_name, env, settings) => {
    const f = await fixture(), options = { ...f.options, env }
    await saveLoginSettings(f.home, settings)
    for (const withFile of [false, true]) {
      if (withFile) {
        await writeFile(f.file, '{"auth":{"domain":"www.codebuddy.cn"}}')
        await writeFile(`${f.file}.logged-out`, '')
      }
      expect(await readCodebuddyLoginState(options)).toBe('authenticated')
      const account = await readCodebuddyAccount(options)
      expect(account).toMatchObject({ state: 'authenticated', verification: 'local', summary: '已登录 · 站点未公开' })
      expect(JSON.stringify(account)).not.toMatch(/SIMULATED_|never-execute-helper/)
      expect(vi.mocked(open).mock.calls.some(call => call[0] === f.file)).toBe(false)
    }
  })
  it.each(['1', '0', 'false'])('模拟：nonempty disabled switches (%s) suppress only their own source', async disabled => {
    const f = await fixture()
    await saveLoginSettings(f.home, { apiKeyHelper: '/simulated/never-execute-helper' })
    const env = { CODEBUDDY_API_KEY_HELPER_DISABLED: disabled }
    expect(await readCodebuddyLoginState({ ...f.options, env })).toBe('unauthenticated')
    expect(await readCodebuddyLoginState({ ...f.options, env: { ...env, CODEBUDDY_API_KEY: 'SIMULATED_KEY' } })).toBe('authenticated')
    expect(await readCodebuddyLoginState({ ...f.options, env: { CODEBUDDY_API_KEY_DISABLED: disabled } })).toBe('authenticated')
    await saveLoginSettings(f.home, { env: { CODEBUDDY_API_KEY: 'SIMULATED_KEY' } })
    expect(await readCodebuddyLoginState({ ...f.options, env: { CODEBUDDY_API_KEY_DISABLED: disabled } })).toBe('unauthenticated')
    await saveLoginSettings(f.home, {})
    expect(await readCodebuddyLoginState({ ...f.options, env: { CODEBUDDY_API_KEY: 'SIMULATED_KEY', CODEBUDDY_API_KEY_DISABLED: disabled } })).toBe('unauthenticated')
    expect(await readCodebuddyLoginState({ ...f.options, env: { CODEBUDDY_AUTH_TOKEN: 'SIMULATED_TOKEN',
      CODEBUDDY_API_KEY_DISABLED: disabled, CODEBUDDY_API_KEY_HELPER_DISABLED: disabled } })).toBe('authenticated')
    await saveLoginSettings(f.home, { env: { CODEBUDDY_AUTH_TOKEN: 'SIMULATED_TOKEN' } })
    expect(await readCodebuddyLoginState({ ...f.options, env: { CODEBUDDY_API_KEY_DISABLED: disabled,
      CODEBUDDY_API_KEY_HELPER_DISABLED: disabled } })).toBe('authenticated')
  })
  it('模拟：empty switches keep helper and API key enabled; default process env is honored', async () => {
    const f = await fixture()
    await saveLoginSettings(f.home, { apiKeyHelper: '/simulated/never-execute-helper' })
    expect(await readCodebuddyLoginState({ ...f.options, env: { CODEBUDDY_API_KEY_HELPER_DISABLED: '' } })).toBe('authenticated')
    await saveLoginSettings(f.home, {})
    vi.stubEnv('CODEBUDDY_API_KEY', 'SIMULATED_KEY')
    expect(await readCodebuddyAccount({ ...f.options, env: undefined })).toMatchObject({ state: 'authenticated' })
    vi.stubEnv('CODEBUDDY_API_KEY_DISABLED', '1')
    expect(await readCodebuddyLoginState({ ...f.options, env: undefined })).toBe('unauthenticated')
    vi.stubEnv('CODEBUDDY_AUTH_TOKEN', 'SIMULATED_TOKEN')
    expect(await readCodebuddyLoginState({ ...f.options, env: undefined })).toBe('authenticated')
  })
  it('模拟：nothing configured, file-only login, logout marker and disabled-source fallback', async () => {
    const f = await fixture()
    await saveLoginSettings(f.home, { apiKeyHelper: '', env: { CODEBUDDY_AUTH_TOKEN: '', CODEBUDDY_API_KEY: '' } })
    expect(await readCodebuddyLoginState(f.options)).toBe('unauthenticated')
    await writeFile(f.file, '{"auth":{"domain":"www.codebuddy.cn"}}')
    const options = { ...f.options, env: { CODEBUDDY_API_KEY: 'SIMULATED_KEY', CODEBUDDY_API_KEY_DISABLED: '1', CODEBUDDY_API_KEY_HELPER_DISABLED: '1' } }
    expect(await readCodebuddyLoginState(options)).toBe('authenticated')
    expect(await readCodebuddyAccount(options)).toMatchObject({ state: 'authenticated', summary: '已登录 · 中国站' })
    await writeFile(`${f.file}.logged-out`, '')
    expect(await readCodebuddyLoginState(options)).toBe('unauthenticated')
  })
  it('模拟：project then local override helper and replace the whole settings env including site', async () => {
    const f = await fixture(), project = join(f.home, 'project'), options = { ...f.options, project,
      env: { CODEBUDDY_INTERNET_ENVIRONMENT: 'ioa' } }
    await saveLoginSettings(f.home, { apiKeyHelper: '/simulated/helper', env: { CODEBUDDY_API_KEY: 'SIMULATED_KEY', CODEBUDDY_INTERNET_ENVIRONMENT: 'internal' } })
    await saveLoginSettings(project, { apiKeyHelper: '', env: { CODEBUDDY_INTERNET_ENVIRONMENT: 'external' } })
    expect(await readCodebuddyLoginState(options)).toBe('unauthenticated')
    expect((await readCodebuddySite(options)).id).toBe('external')
    await saveLoginSettings(project, { apiKeyHelper: '/simulated/local-helper', env: {} }, true)
    expect(await readCodebuddyLoginState(options)).toBe('authenticated')
    expect((await readCodebuddySite(options)).id).toBe('ioa')
    await saveLoginSettings(project, { apiKeyHelper: '', env: { CODEBUDDY_API_KEY: 'SIMULATED_LOCAL_KEY', CODEBUDDY_INTERNET_ENVIRONMENT: 'selfhosted' } }, true)
    expect(await readCodebuddyAccount(options)).toMatchObject({ state: 'authenticated', summary: '已登录 · 企业域' })
    // No project means no guess from host cwd and no user settings.local.json.
    await saveLoginSettings(f.home, { apiKeyHelper: '', env: {} }, true)
    expect((await readCodebuddySite(f.options)).id).toBe('internal')
    expect(await readCodebuddyLoginState(f.options)).toBe('authenticated')
  })
  it('模拟：custom-token file scan survives an overriding settings env and helper disable', async () => {
    const f = await fixture(), project = join(f.home, 'project')
    await saveLoginSettings(f.home, { env: { CODEBUDDY_AUTH_TOKEN: 'SIMULATED_TOKEN' } })
    await saveLoginSettings(project, { env: {} })
    expect(await readCodebuddyLoginState({ ...f.options, project, env: { CODEBUDDY_API_KEY_HELPER_DISABLED: '1' } })).toBe('authenticated')
  })
  it('模拟：JSONC token uses merged env while the early per-file token scan requires strict JSON', async () => {
    const f = await fixture(), project = join(f.home, 'project')
    await saveLoginSettings(f.home, {})
    await writeFile(join(f.home, '.codebuddy/settings.json'), '{ // 模拟 JSONC\n "env": {"CODEBUDDY_AUTH_TOKEN": "SIMULATED_TOKEN"}, }')
    expect(await readCodebuddyLoginState(f.options)).toBe('authenticated')
    await saveLoginSettings(project, { env: {} })
    expect(await readCodebuddyLoginState({ ...f.options, project })).toBe('unauthenticated')
  })
  it('模拟：env token is checked before settings or login files', async () => {
    const f = await fixture()
    vi.mocked(lstat).mockClear()
    expect(await readCodebuddyLoginState({ ...f.options, env: { CODEBUDDY_AUTH_TOKEN: 'SIMULATED_TOKEN' } })).toBe('authenticated')
    expect(open).not.toHaveBeenCalled(); expect(lstat).not.toHaveBeenCalled()
  })
  it('模拟：JSONC settings and configured config directories are read without running helper', async () => {
    const f = await fixture(), config = join(f.home, 'custom-user'), project = join(f.home, 'project'), local = join(project, 'custom-project')
    await mkdir(config, { recursive: true }); await mkdir(local, { recursive: true })
    await writeFile(join(config, 'settings.json'), '{ // 模拟 JSONC\n "apiKeyHelper": "/simulated/never-execute-helper", }')
    await writeFile(join(local, 'settings.local.json'), '{"env":{"CODEBUDDY_INTERNET_ENVIRONMENT":"external"}}')
    const options = { ...f.options, project, env: { CODEBUDDY_CONFIG_DIR: config, CODEBUDDY_PROJECT_CONFIG_DIR: 'custom-project' } }
    expect(await readCodebuddyAccount(options)).toMatchObject({ state: 'authenticated', summary: '已登录 · 国际站' })
    expect((await readCodebuddySite({ ...options, env: { ...options.env, CODEBUDDY_PROJECT_CONFIG_DIR: local } })).id).toBe('external')
    expect(vi.mocked(open).mock.calls.every(call => String(call[0]).startsWith(f.home))).toBe(true)
  })
  it('模拟：env authentication binds protected credential digests and still validates catalog', async () => {
    const f = await fixture(), b = backendFixture(), signal = new AbortController().signal
    const options = { ...f.options, env: { CODEBUDDY_AUTH_TOKEN: 'SIMULATED_TOKEN', CODEBUDDY_INTERNET_ENVIRONMENT: 'external' } }
    const first = await readCodebuddyAccountBindingMaterial(b.backend, DEFAULT_CONFIG, '/simulated', signal, options)
    expect(first.sourceIds).toEqual([f.file])
    expect(first.entries[0]?.principal).toEqual({ site: 'external', catalog: expect.any(String),
      environment: { credentials: { CODEBUDDY_AUTH_TOKEN: createHash('sha256').update('SIMULATED_TOKEN').digest('hex') },
        helperDisabled: false, apiKeyDisabled: false } })
    expect(await readCodebuddyAccountBindingMaterial(b.backend, DEFAULT_CONFIG, '/simulated', signal,
      { ...options, env: { CODEBUDDY_API_KEY: 'SIMULATED_DIFFERENT_KEY', CODEBUDDY_INTERNET_ENVIRONMENT: 'external' } })).not.toEqual(first)
    expect(JSON.stringify(first)).not.toContain('SIMULATED_')
    b.fail(3)
    await expect(readCodebuddyAccountBindingMaterial(b.backend, DEFAULT_CONFIG, '/simulated', signal, options)).rejects.toThrow('/login')
  })
  it('模拟：aborted reads stop before inspecting any source', async () => {
    const f = await fixture(), controller = new AbortController(); controller.abort()
    await expect(readCodebuddyLoginState({ ...f.options, signal: controller.signal, env: { CODEBUDDY_AUTH_TOKEN: 'SIMULATED' } })).rejects.toThrow()
    expect(open).not.toHaveBeenCalled()
  })
  it('uses platform-specific auth paths', () => {
    expect(codebuddyAuthDirectory('darwin', {}, '/synthetic')).toBe(join('/synthetic', 'Library', 'Application Support', 'CodeBuddyExtension', 'Data', 'Public', 'auth'))
    expect(codebuddyAuthDirectory('linux', {}, '/synthetic')).toBe(join('/synthetic', '.local', 'share', 'CodeBuddyExtension', 'Data', 'Public', 'auth'))
    expect(codebuddyAuthDirectory('win32', { LOCALAPPDATA: 'C:\\Local' }, 'C:\\Home')).toBe('C:\\Local\\CodeBuddyExtension\\Data\\Public\\auth')
    expect(codebuddyAuthDirectory('win32', {}, 'C:\\Home')).toContain('C:\\Home\\AppData\\Local')
  })
  // POSIX modes and symlinks: Windows cannot make a file unreadable with chmod or create symlinks unprivileged.
  it.skipIf(process.platform === 'win32')('keeps lstat presence separate from readable login evidence; invalid entries cannot prove logout', async () => {
    const f = await fixture()
    expect(await readCodebuddyLoginState(f.options)).toBe('unauthenticated')
    await writeFile(f.file, '模拟文件；不得读取', { mode: 0o600 }); await chmod(f.file, 0)
    expect((await lstat(f.file)).mode & 0o777).toBe(0)
    expect(await readCodebuddyLoginState(f.options)).toBe('authenticated')
    expect(await readCodebuddyAccount(f.options)).toMatchObject({ state: 'unknown', verification: 'local' })
    await symlink(join(f.home, 'absent-marker-target'), `${f.file}.logged-out`)
    expect(await readCodebuddyLoginState(f.options)).toBe('unknown')
    await rm(`${f.file}.logged-out`); await writeFile(`${f.file}.logged-out`, '')
    expect(await readCodebuddyLoginState(f.options)).toBe('unauthenticated')
    expect((await readCodebuddyAccount(f.options)).summary).toContain('/login')
    await rm(`${f.file}.logged-out`); await rm(f.file)
    await mkdir(f.file); expect(await readCodebuddyLoginState(f.options)).toBe('unknown'); await rm(f.file, { recursive: true })
    const target = join(f.home, 'synthetic-target'); await writeFile(target, '模拟')
    await symlink(target, f.file); expect(await readCodebuddyLoginState(f.options)).toBe('unknown')
  })
  it.each([['internal', 'internal', '中国站'], ['external', 'external', '国际站'], ['IoA', 'ioa', 'iOA'], ['selfhosted', 'selfhosted', '企业域'], ['Custom', 'declared:Custom', 'Custom']])('maps declared site %s', (value, id, label) => {
    expect(codebuddyDeclaredSite({ CODEBUDDY_INTERNET_ENVIRONMENT: value })).toEqual({ id, label })
  })
  it('honors primary site, fallback, and sanitized bounded labels', () => {
    expect(codebuddyDeclaredSite({})).toBeUndefined()
    expect(codebuddyDeclaredSite({ CODEBUDDY_INTERNET_ENVIRONMENT: '__proto__' })).toEqual({ id: 'declared:__proto__', label: '__proto__' })
    expect(codebuddyDeclaredSite({ CODEBUDDY_COPILOT_INTERNET_ENVIRONMENT: 'external' })?.label).toBe('国际站')
    expect(codebuddyDeclaredSite({ CODEBUDDY_INTERNET_ENVIRONMENT: 'internal', CODEBUDDY_COPILOT_INTERNET_ENVIRONMENT: 'external' })?.id).toBe('internal')
    expect(codebuddyDeclaredSite({ CODEBUDDY_INTERNET_ENVIRONMENT: '\x00\n' + 'a'.repeat(100) })?.label).toBe('a'.repeat(64))
  })
  it('parses model-local efforts, explicit cost and duplicate labels', () => {
    const models = parseCodebuddyModels({ models: [model(), model('hy4std', 'x1.25 credits'),
      { modelId: 'hy3', name: 'Hy3', _meta: { credits: 'unknown', effortOptions: [
        { value: 'default' }, { value: 'none' }, { value: 'low' }, { value: 'high' }, { value: 'low' }, { value: 'made-up' }, { value: 'enabled' },
      ] } }, { modelId: 'solo' }] })
    expect(models).toEqual([
      { id: 'hy4free', label: 'Hy4（hy4free）', cost: 'free', efforts: ['default', 'high'] },
      { id: 'hy4std', label: 'Hy4（hy4std）', cost: 'paid', efforts: ['default', 'high'] },
      { id: 'hy3', label: 'Hy3', cost: 'unknown', efforts: ['default', 'low', 'high'] },
      { id: 'solo', label: 'solo', cost: 'unknown', efforts: ['default'] },
    ])
  })
  it.each([[], { models: [] }, [{}], [{ modelId: '' }], [model(), model()]])('rejects invalid catalog %#', raw => {
    expect(() => parseCodebuddyModels(raw)).toThrow(CodebuddyAccountError)
  })
  it.each([['x0 credits', 'free'], ['X0.000 CREDITS', 'free'], ['x0', 'unknown'], ['x0.01 credits', 'paid'], ['free', 'unknown']])('classifies %s only by credits', (credits, cost) => {
    expect(parseCodebuddyModels([model('id', credits)])[0]?.cost).toBe(cost)
  })
  it('queries a private 0700 cwd, disables updates and removes the cwd after exit', async () => {
    await fixture(); const b = backendFixture(), signal = new AbortController().signal
    expect(await discoverCodebuddyModels(b.backend, DEFAULT_CONFIG, '/simulated/codebuddy.mjs', signal)).toHaveLength(1)
    expect(b.calls[0].argv.slice(0, 1)).toEqual([process.execPath])
    expect(b.calls[0].argv[1]).toMatch(/codebuddy-catalog\.mjs$/)
    expect(b.calls[0].argv.slice(2)).toEqual(['/simulated/codebuddy.mjs', b.calls[0].cwd])
    // Windows probes also get a private TMP/TEMP (spawnProbe); other platforms pass only the update switch.
    if (process.platform === 'win32') expect(b.calls[0].env).toEqual({ ...codebuddyEnvironment(), TMP: expect.any(String), TEMP: expect.any(String) })
    else expect(b.calls[0].env).toEqual(codebuddyEnvironment())
    // Windows has no POSIX directory modes; the private directory is still removed after exit.
    if (!(process.platform === 'win32')) expect(await Promise.all(b.directories)).toEqual([0o700])
    await expect(lstat(b.calls[0].cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('maps catalog exit 3 to actionable account error and always removes temporary cwd', async () => {
    await fixture(); const b = backendFixture(); b.fail(3)
    await expect(discoverCodebuddyModels(b.backend, DEFAULT_CONFIG, '/simulated', new AbortController().signal)).rejects.toThrow('CodeBuddy 未登录或认证已失效')
    await expect(lstat(b.calls[0].cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('binds sorted catalog IDs/credits and site, ignoring auth metadata rewrites and names', async () => {
    const f = await fixture(); await writeFile(f.file, '模拟', { mode: 0o000 })
    const b = backendFixture(), signal = new AbortController().signal
    const binding = () => readCodebuddyAccountBindingMaterial(b.backend, DEFAULT_CONFIG, '/simulated', signal, f.options)
    b.set([model('a'), model('b')]); const first = await binding()
    b.set([model('b'), { ...model('a'), name: 'renamed' }]); expect(await binding()).toEqual(first)
    await chmod(f.file, 0o400); expect(await binding()).toEqual(first)
    b.set([model('a'), model('b', 'x2 credits')]); expect(await binding()).not.toEqual(first)
    b.set([model('a'), model('new')]); expect(await binding()).not.toEqual(first)
    expect(first.sourceIds).toEqual([f.file]); expect(first.entries[0]?.principal.site).toBe('undeclared')
    b.set([model('a'), model('b')])
    expect(await readCodebuddyAccountBindingMaterial(b.backend, DEFAULT_CONFIG, '/simulated', signal,
      { ...f.options, env: { CODEBUDDY_INTERNET_ENVIRONMENT: 'internal' } })).not.toEqual(first)
  })
  it('shares one catalog in a snapshot and refreshes outside it; logout still invalidates', async () => {
    const f = await fixture(); await writeFile(f.file, '模拟', { mode: 0o000 })
    const b = backendFixture(), signal = new AbortController().signal
    await withCodebuddyCatalogSnapshot(b.backend, DEFAULT_CONFIG, '/simulated', signal, async () => {
      const first = await readCodebuddyAccountBindingMaterial(b.backend, DEFAULT_CONFIG, '/simulated', signal, f.options)
      b.set([model('changed')])
      const models = await discoverCodebuddyModels(b.backend, DEFAULT_CONFIG, '/simulated', signal)
      models[0]!.id = 'mutated-by-consumer'
      expect(await readCodebuddyAccountBindingMaterial(b.backend, DEFAULT_CONFIG, '/simulated', signal, f.options)).toEqual(first)
      expect(b.calls).toHaveLength(1)
      await writeFile(`${f.file}.logged-out`, '')
      await expect(readCodebuddyAccountBindingMaterial(b.backend, DEFAULT_CONFIG, '/simulated', signal, f.options)).rejects.toThrow('/login')
    })
    expect((await discoverCodebuddyModels(b.backend, DEFAULT_CONFIG, '/simulated', signal))[0]?.id).toBe('changed')
    expect(b.calls).toHaveLength(2)
  })
  it('authorizedCatalog uses one query across both binding reads and models', async () => {
    const f = await fixture(); await writeFile(f.file, '模拟', { mode: 0o000 })
    const b = backendFixture(), config = { ...DEFAULT_CONFIG, codebuddyExecutable: '/simulated/codebuddy' }, signal = new AbortController().signal
    const first = await authorizedCatalog('codebuddy', b.backend, config, f.home, signal)
    expect(first.catalog.cli).toBe('codebuddy'); expect(b.calls).toHaveLength(1)
    await authorizedCatalog('codebuddy', b.backend, config, f.home, signal, first.binding)
    expect(b.calls).toHaveLength(2)
    b.set([model('changed')])
    await expect(authorizedCatalog('codebuddy', b.backend, config, f.home, signal, first.binding)).rejects.toThrow('账号已变更')
    expect(b.calls).toHaveLength(3)
  })
  it('resolves readable JS entries without launching them', async () => {
    const f = await fixture(), script = join(f.home, 'simulated-codebuddy.js')
    await writeFile(script, '// 模拟入口', { mode: 0o600 })
    const b = backendFixture()
    expect(await resolveCliExecutable('codebuddy', b.backend, { ...DEFAULT_CONFIG, codebuddyExecutable: script })).toBe(script)
    expect(b.calls).toEqual([])
  })
  it.skipIf(process.platform !== 'darwin')('checks macOS fallbacks only after missing PATH, preserves explicit failures', async () => {
    await fixture(); const b = backendFixture()
    vi.mocked(b.backend.resolveExecutable).mockImplementation(async path => {
      if (path === '/usr/local/bin/codebuddy') return path
      throw Object.assign(new Error('模拟 not found'), { code: 'ENOENT' })
    })
    expect(await resolveCliExecutable('codebuddy', b.backend, DEFAULT_CONFIG)).toBe('/usr/local/bin/codebuddy')
    expect(vi.mocked(b.backend.resolveExecutable).mock.calls.map(call => call[0])).toEqual(['codebuddy', '/opt/homebrew/bin/codebuddy', '/usr/local/bin/codebuddy'])
    vi.mocked(b.backend.resolveExecutable).mockClear()
    await expect(resolveCliExecutable('codebuddy', b.backend, { ...DEFAULT_CONFIG, codebuddyExecutable: '/explicit/missing' })).rejects.toThrow('模拟 not found')
    expect(b.backend.resolveExecutable).toHaveBeenCalledTimes(1)
  })
})

describe('CodeBuddy 只读站点（模拟）', () => {
  const token = '模拟-不应读出'
  const gatewayPassword = '模拟-网关密码不得读出'
  const auth = (domain?: unknown) => JSON.stringify({ _comment: '模拟夹具', auth: { domain, accessToken: token } })
  const saveAuth = (file: string, domain?: unknown) => writeFile(file, auth(domain), { mode: 0o600 })
  const saveSettings = async (home: string, env: Record<string, unknown>) => {
    await mkdir(join(home, '.codebuddy'), { mode: 0o700, recursive: true })
    await writeFile(join(home, '.codebuddy/settings.json'), JSON.stringify({ _comment: '模拟夹具',
      gateway: { password: gatewayPassword }, env }), { mode: 0o600 })
  }
  const opened = () => vi.mocked(open).mock.calls.map(call => String(call[0]))
  const expectPrivate = (value: unknown, domain: string) => {
    const json = JSON.stringify(value)
    expect(json).not.toContain(token)
    expect(json).not.toContain(gatewayPassword)
    expect(json).not.toContain('accessToken')
    expect(json).not.toContain(domain)
  }
  it.each([
    ['copilot.tencent.com', 'internal', '中国站'],
    ['staging-copilot.tencent.com', 'internal', '中国站'],
    ['www.codebuddy.cn', 'internal', '中国站'],
    ['staging.codebuddy.cn', 'internal', '中国站'],
    ['www.workbuddy.cn', 'internal', '中国站'],
    ['staging.workbuddy.cn', 'internal', '中国站'],
    ['www.codebuddy.ai', 'external', '国际站'],
    ['staging-codebuddy.tencent.com', 'external', '国际站'],
    ['tencent.sso.copilot.tencent.com', 'ioa', 'iOA'],
    ['tencent.sso.copilot-staging.tencent.com', 'ioa', 'iOA'],
    ['tencent.sso.codebuddy.cn', 'ioa', 'iOA'],
    ['tencent.staging-sso.codebuddy.cn', 'ioa', 'iOA'],
    ['company.sso.copilot.tencent.com', 'cloudhosted', '企业域'],
    ['company.sso.copilot-staging.tencent.com', 'cloudhosted', '企业域'],
    ['company.copilot.qq.com', 'cloudhosted', '企业域'],
    ['company.copilot-staging.qq.com', 'cloudhosted', '企业域'],
    ['company.sso.codebuddy.cn', 'cloudhosted', '企业域'],
    ['company.staging-sso.codebuddy.cn', 'cloudhosted', '企业域'],
    ['a.b.sso.codebuddy.cn', 'undeclared', '站点未公开'],
    ['company.sso.codebuddy.cn.attacker.invalid', 'undeclared', '站点未公开'],
    ['https://www.codebuddy.cn', 'undeclared', '站点未公开'],
    ['unmatched.invalid', 'undeclared', '站点未公开'],
    ['www.codebuddy.cn\n', 'undeclared', '站点未公开'],
  ])('maps a simulated auth domain to %s without disclosing it', async (domain, id, label) => {
    const f = await fixture(); await saveAuth(f.file, domain)
    const site = await readCodebuddySite(f.options), account = await readCodebuddyAccount(f.options)
    const b = backendFixture()
    const binding = await readCodebuddyAccountBindingMaterial(b.backend, DEFAULT_CONFIG, '/simulated/missing', new AbortController().signal, f.options)
    expect(site).toEqual({ id, label })
    expect(account.summary).toBe(`已登录 · ${label}`)
    expect(binding.entries[0]?.principal.site).toBe(id)
    expectPrivate([site, account, binding], domain)
  })
  it.each(['{ invalid JSON 模拟-不应读出', '{"_comment":"模拟夹具"}', '{"auth":{"domain":17}}'])('keeps malformed or missing auth.domain private %#', async raw => {
    const f = await fixture(); await writeFile(f.file, raw)
    expect(await readCodebuddySite(f.options)).toEqual({ id: 'undeclared', label: '站点未公开' })
    const result = await readCodebuddyAccount(f.options)
    expect(result.state).toBe('unknown'); expect(JSON.stringify(result)).not.toContain(token)
  })
  it('keeps missing or unreadable auth undeclared without exposing filesystem errors', async () => {
    const f = await fixture()
    expect(await readCodebuddySite(f.options)).toEqual({ id: 'undeclared', label: '站点未公开' })
    if (process.platform === 'win32') return // chmod cannot make a file unreadable on Windows.
    await saveAuth(f.file, 'www.codebuddy.cn'); await chmod(f.file, 0)
    expect(await readCodebuddySite(f.options)).toEqual({ id: 'undeclared', label: '站点未公开' })
  })
  it.each(['CODEBUDDY_INTERNET_ENVIRONMENT', 'CODEBUDDY_COPILOT_INTERNET_ENVIRONMENT'])('settings %s wins after checking readable auth.domain', async key => {
    const f = await fixture(); await saveAuth(f.file, 'www.codebuddy.ai')
    await saveSettings(f.home, { [key]: 'internal' })
    const options = { ...f.options, env: { CODEBUDDY_INTERNET_ENVIRONMENT: 'external' } }
    const account = await readCodebuddyAccount(options), b = backendFixture()
    const binding = await readCodebuddyAccountBindingMaterial(b.backend, DEFAULT_CONFIG, '/simulated', new AbortController().signal, options)
    expect(account.summary).toBe('已登录 · 中国站'); expect(binding.entries[0]?.principal.site).toBe('internal')
    expect(opened()).toContain(f.file)
    expectPrivate([account, binding], 'www.codebuddy.ai')
  })
  it.each(['CODEBUDDY_INTERNET_ENVIRONMENT', 'CODEBUDDY_COPILOT_INTERNET_ENVIRONMENT'])('process %s wins after checking readable auth.domain', async key => {
    const f = await fixture(); await saveAuth(f.file, 'www.codebuddy.cn')
    await saveSettings(f.home, { CODEBUDDY_INTERNET_ENVIRONMENT: 17 })
    vi.stubEnv(key, 'external')
    const account = await readCodebuddyAccount({ ...f.options, env: undefined })
    expect(account.summary).toBe('已登录 · 国际站'); expect(opened()).toContain(f.file)
    expectPrivate(account, 'www.codebuddy.cn')
  })
  it('prefers the primary settings key and keeps explicit selfhosted/custom IDs separate', async () => {
    const f = await fixture(); await saveAuth(f.file, 'www.codebuddy.cn')
    for (const [value, id, label] of [['selfhosted', 'selfhosted', '企业域'], ['Custom', 'declared:Custom', 'Custom'], ['IOA', 'ioa', 'iOA']]) {
      await saveSettings(f.home, { CODEBUDDY_INTERNET_ENVIRONMENT: value, CODEBUDDY_COPILOT_INTERNET_ENVIRONMENT: 'external' })
      expect(await readCodebuddySite(f.options)).toEqual({ id, label })
    }
    expect(opened()).not.toContain(f.file)
  })
  it('continues to the next available source after invalid settings JSON, without leaking its password', async () => {
    const f = await fixture(); await saveAuth(f.file, 'www.codebuddy.cn')
    await saveSettings(f.home, {})
    await writeFile(join(f.home, '.codebuddy/settings.json'), `{ invalid ${gatewayPassword}`)
    const account = await readCodebuddyAccount(f.options)
    expect(account.summary).toBe('已登录 · 中国站'); expectPrivate(account, 'www.codebuddy.cn')
  })
  it('uses injectable HOME for every private source', async () => {
    const f = await fixture(); await saveAuth(f.file, 'www.codebuddy.cn')
    const other = await fixture(); await saveSettings(other.home, { CODEBUDDY_INTERNET_ENVIRONMENT: 'external' })
    expect((await readCodebuddySite(f.options)).id).toBe('internal')
    expect(opened().every(path => path.startsWith(f.home))).toBe(true)
  })
  async function installedProduct(home: string, attributes: unknown) {
    const root = join(home, 'simulated-package'), executable = join(root, 'dist/bin/entry.js')
    await mkdir(dirname(executable), { recursive: true }); await writeFile(executable, '// 模拟 CLI，永不执行')
    await writeFile(join(root, 'product.json'), JSON.stringify({ _comment: '模拟夹具', authentication: { attributes } }))
    const link = join(home, 'simulated-codebuddy'); await symlink(executable, link)
    return { executable: link, product: join(root, 'product.json') }
  }
  const customTable = { internalDomain: ['custom.internal.invalid'], iOADomain: ['special.sso.custom.invalid'],
    cloudHostedDomain: ['*.sso.custom.invalid'], externalDomain: ['custom.external.invalid'] }
  it('reads the installed product table by realpath and applies ordered exact/wildcard matching', async () => {
    const f = await fixture(), installed = await installedProduct(f.home, customTable)
    for (const [domain, id] of [['custom.internal.invalid', 'internal'], ['special.sso.custom.invalid', 'ioa'],
      ['tenant.sso.custom.invalid', 'cloudhosted'], ['a.b.sso.custom.invalid', 'undeclared'],
      ['custom.external.invalid', 'external'], ['www.codebuddy.cn', 'undeclared']]) {
      await saveAuth(f.file, domain)
      const site = await readCodebuddySite({ ...f.options, executable: installed.executable })
      expect(site.id).toBe(id); expectPrivate(site, domain!)
    }
    expect(opened()).toContain(await realpath(installed.product))
  })
  it.each(['missing', 'invalid-json', 'invalid-table'])('falls back to 2.181.0 when product is %s', async scenario => {
    const f = await fixture(), installed = await installedProduct(f.home, customTable)
    if (scenario === 'missing') await rm(installed.product)
    else await writeFile(installed.product, scenario === 'invalid-json' ? '{ 模拟 invalid' : '{"authentication":{"attributes":{}}}')
    await saveAuth(f.file, 'www.codebuddy.cn')
    expect((await readCodebuddySite({ ...f.options, executable: installed.executable })).id).toBe('internal')
  })
  it('changes binding on site switches with an unchanged catalog and invalidates old authorization', async () => {
    const f = await fixture(); await saveAuth(f.file, 'www.codebuddy.cn')
    const b = backendFixture(), config = { ...DEFAULT_CONFIG, codebuddyExecutable: '/simulated/codebuddy' }, signal = new AbortController().signal
    const first = await authorizedCatalog('codebuddy', b.backend, config, f.home, signal)
    await saveAuth(f.file, 'www.codebuddy.ai')
    const second = await authorizedCatalog('codebuddy', b.backend, config, f.home, signal)
    expect(second.catalog).toEqual(first.catalog); expect(second.binding).not.toBe(first.binding)
    await expect(authorizedCatalog('codebuddy', b.backend, config, f.home, signal, first.binding)).rejects.toThrow('账号已变更')
    await saveSettings(f.home, { CODEBUDDY_INTERNET_ENVIRONMENT: 'selfhosted' })
    const third = await authorizedCatalog('codebuddy', b.backend, config, f.home, signal)
    expect(third.binding).not.toBe(second.binding)
    expectPrivate([first, second, third], 'www.codebuddy.cn')
    expectPrivate([first, second, third], 'www.codebuddy.ai')
  })
})

// 模拟 child stays alive after EOF, as measured in CodeBuddy; never invokes the installed CLI.
const catalogPeer = String.raw`
import { createInterface } from 'node:readline';
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
const scenario=process.env.SIMULATED_SCENARIO;
const log=value=>appendFileSync(process.env.SIMULATED_AUDIT,JSON.stringify(value)+'\n');
const out=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
log({pid:process.pid,argv:process.argv.slice(2),updater:process.env.DISABLE_AUTOUPDATER});
if(scenario==='environment')log({authConfigured:process.env.CODEBUDDY_AUTH_TOKEN==='SIMULATED_CATALOG_TOKEN',
 homeMatches:realpathSync(process.env.HOME)===realpathSync(process.cwd())});
if(scenario==='settings')log({
 projectHelper:JSON.parse(readFileSync(join(process.env.CODEBUDDY_PROJECT_CONFIG_DIR,'settings.json'),'utf8')).apiKeyHelper==='/simulated/private-helper',
 localKey:JSON.parse(readFileSync(join(process.env.CODEBUDDY_PROJECT_CONFIG_DIR,'settings.local.json'),'utf8')).env.CODEBUDDY_API_KEY==='SIMULATED_LOCAL_KEY',
 privateCwd:realpathSync(process.cwd())===realpathSync(process.env.HOME),
 proxyKept:process.env.HTTPS_PROXY==='http://simulated.invalid',
});
setInterval(()=>{},1000);
process.on('SIGTERM',()=>{log({terminated:true});if(scenario!=='ignore-term')process.exit(0)});
createInterface({input:process.stdin}).on('line',line=>{
 const q=JSON.parse(line);log(q);
 if(q.method==='initialize')return out({id:q.id,result:{protocolVersion:1,authMethods:[{id:'internal'},{id:'external'}]}});
 if(q.method==='session/new'){
  if(scenario==='auth')return out({id:q.id,error:{code:-1,message:'Authentication required PRIVATE_RAW'}});
  if(scenario==='auth-category')return out({id:q.id,error:{code:-1,message:'PRIVATE_RAW',data:{category:'auth'}}});
  if(scenario==='invalid')return process.stdout.write('PRIVATE_RAW_NOT_JSON\n');
  if(scenario==='overflow')return process.stderr.write('PRIVATE_RAW'.repeat(300000));
  if(scenario==='early-exit')return process.exit(0);
  if(scenario==='timeout')return;
  out({method:'untrusted-notification',params:{private:'PRIVATE_RAW'}});
  out({id:'unknown',method:'_codebuddy.ai/requestSensitiveApproval',params:{}});
 }
 if(q.id==='unknown'){
  out({id:2,result:{models:{availableModels:[{modelId:'hy4free',name:'Hy4',description:'模拟',secret:'PRIVATE_RAW',_meta:{credits:'x0.00 credits',effortOptions:[{value:'high'}],secret:'PRIVATE_RAW'}}]}}});
 }
});
`
describe('CodeBuddy 目录脚本（模拟原生子进程）', () => {
  async function run(scenario = 'success', env: Record<string, string> = {}, prepare?: (home: string) => Promise<Record<string, string>>) {
    const f = await fixture(), script = join(f.home, 'simulated-catalog-peer.mjs'), audit = join(f.home, 'audit.ndjson')
    await writeFile(script, catalogPeer, { mode: 0o600 })
    const preparedEnv = await prepare?.(f.home)
    let stdout = '', stderr = '', code: any = 0
    try {
      const result = await promisify(execFile)(process.execPath, [resolve('src/host/codebuddy-catalog.mjs'), script, f.home], {
        env: { ...process.env, ...env, ...preparedEnv, SIMULATED_SCENARIO: scenario, SIMULATED_AUDIT: audit }, timeout: 18000,
      }); stdout = result.stdout; stderr = result.stderr
    } catch (error: any) { stdout = error.stdout; stderr = error.stderr; code = error.code }
    const records = (await readFile(audit, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(() => process.kill(records[0].pid, 0)).toThrow()
    expect(stdout + stderr).not.toContain('PRIVATE_RAW')
    return { stdout, stderr, code, records, cwd: f.home }
  }
  it('模拟：catalog bridge forwards auth environment and keeps inherited HOME to its native child', async () => {
    const result = await run('environment', codebuddyEnvironment({ CODEBUDDY_AUTH_TOKEN: 'SIMULATED_CATALOG_TOKEN' }))
    expect(result.code).toBe(0)
    expect(result.records[1]).toEqual({ authConfigured: true, homeMatches: true })
    expect(JSON.stringify(result)).not.toContain('SIMULATED_CATALOG_TOKEN')
  })
  it('模拟：catalog bridge forwards the private native settings directory and proxy without exposing settings in argv', async () => {
    const result = await run('settings', { HTTPS_PROXY: 'http://simulated.invalid' }, async home => {
      const directory = join(home, 'private-settings')
      await mkdir(directory, { mode: 0o700 })
      await writeFile(join(directory, 'settings.json'), '{"apiKeyHelper":"/simulated/private-helper"}', { mode: 0o600 })
      await writeFile(join(directory, 'settings.local.json'), '{"env":{"CODEBUDDY_API_KEY":"SIMULATED_LOCAL_KEY"}}', { mode: 0o600 })
      return { CODEBUDDY_PROJECT_CONFIG_DIR: directory }
    })
    expect(result.code).toBe(0)
    expect(result.records[0].argv).toEqual(['--acp', '--no-session-persistence'])
    expect(result.records[1]).toEqual({ projectHelper: true, localKey: true, privateCwd: true, proxyKept: true })
    expect(result.records.find(record => record.method === 'session/new').params.cwd).toBe(result.cwd)
    expect(JSON.stringify(result)).not.toContain('SIMULATED_LOCAL_KEY')
    expect(JSON.stringify(result)).not.toContain('/simulated/private-helper')
  })
  it('outputs one allowlisted JSON line after confirmed SIGTERM exit and rejects agent requests', async () => {
    const result = await run()
    expect(result.code).toBe(0); expect(result.stderr).toBe(''); expect(result.stdout.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(result.stdout)).toEqual({ models: [{ modelId: 'hy4free', name: 'Hy4', description: '模拟', _meta: { credits: 'x0.00 credits', effortOptions: [{ value: 'high' }] } }] })
    expect(result.records[0]).toMatchObject({ updater: '1', argv: ['--acp', '--no-session-persistence'] })
    expect(result.records.filter(q => q.method).map(q => q.method)).toEqual(['initialize', 'session/new'])
    expect(result.records.find(q => q.id === 'unknown')?.error.code).toBe(-32601)
    // Windows SIGTERM is TerminateProcess: the peer's handler never runs.
    if (!(process.platform === 'win32')) expect(result.records.at(-1)).toEqual({ terminated: true })
  })
  it.each(['auth', 'auth-category'])('uses exit 3 for %s without raw error output', async scenario => {
    const result = await run(scenario); expect(result.code).toBe(3); expect(result.stderr).toBe('CodeBuddy 未登录\n'); expect(result.stdout).toBe('')
  })
  // A peer cannot ignore termination on Windows, so ignore-term is POSIX only.
  it.each(['invalid', 'overflow', 'early-exit', ...(process.platform === 'win32' ? [] : ['ignore-term'])])('fails safely and confirms cleanup for %s', async scenario => {
    const result = await run(scenario); expect(result.code).toBe(1); expect(result.stderr).toContain('目录查询失败'); expect(result.stdout).toBe('')
  })
  it('bounds the overall query and terminates an unresponsive peer', async () => {
    const result = await run('timeout'); expect(result.code).toBe(1); expect(result.stdout).toBe('')
  }, 20000)
})


it.each(['EACCES', 'EPERM', 'ENOTDIR'])('模拟：CodeBuddy %s cannot prove sign-out', async code => {
  const f = await fixture()
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(lstat).mockImplementation((path: any, options?: any) => path === f.file
    ? Promise.reject(Object.assign(new Error('SIMULATED denied'), { code })) : actual.lstat(path, options))
  expect(await readCodebuddyLoginState(f.options)).toBe('unavailable')
})
