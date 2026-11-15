/** 模拟：all configs/keys live in temporary HOMEs. No real CLI or user file is accessed. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import * as os from 'node:os'
import { AccountManager } from '../src/host/accounts.ts'
import { dirname, join } from 'node:path'
import { parse as yaml } from 'yaml'
import { inspectPiOmpNativeAccount, piOmpStoredLoginExists, snapshotPiOmpNative } from '../src/host/pi-omp-native.ts'
import { deletePiOmpNativeConfigProvider } from '../src/host/custom-provider-native.ts'
const deleteConfig = async (input: { cli: 'pi' | 'omp'; stateDirectory: string; login?: string; nativeHome: string; signal: AbortSignal }) => {
  deletePiOmpNativeConfigProvider(input.cli, input.stateDirectory, input.login!, () => input.signal.throwIfAborted(), input.nativeHome)
}
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
vi.mock('node:os', async load => ({ ...await load<typeof import('node:os')>() }))
vi.mock('../src/host/adapters.ts', async load => ({ ...await load<typeof import('../src/host/adapters.ts')>(), resolveCliExecutable: async () => '/simulated/not-executed' }))
vi.mock('../src/host/windows-account-terminal.ts', async load => ({ ...await load<typeof import('../src/host/windows-account-terminal.ts')>(),
  spawnAccountTerminal: (backend: ProcessBackend, spec: any) => backend.spawnTerminal!(spec),
}))
vi.mock('node:fs', async load => ({ ...await load<typeof import('node:fs')>() }))
const roots: string[] = []
const write = (path: string, text: string) => { fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); fs.writeFileSync(path, text, { mode: 0o640 }) }
const read = (path: string) => fs.readFileSync(path, 'utf8')
const signal = () => new AbortController().signal
function fixture(cli: 'pi' | 'omp') {
  const home = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'native-config-delete-simulated-'))); roots.push(home)
  const state = join(home, 'state'), native = join(home, `.${cli}`, 'agent'), plugin = join(state, 'accounts', cli, 'agent')
  const filename = cli === 'omp' ? 'models.yml' : 'models.json'
  const config = join(native, filename), copy = join(plugin, filename)
  const providers = { custom: { apiKey: 'simulated-private-key', baseUrl: 'https://api.example.invalid/v1', models: [{ id: 'demo' }] },
    keep: { apiKey: 'simulated-keep-key', baseUrl: 'https://keep.invalid', models: [] } }
  const text = cli === 'omp' ? '# keep header\r\nproviders:\r\n  custom:\r\n    apiKey: simulated-private-key\r\n    baseUrl: https://api.example.invalid/v1\r\n    models: [{ id: demo }]\r\n  # keep comment\r\n  keep: { apiKey: simulated-keep-key, baseUrl: https://keep.invalid, models: [] }\r\nuntouched: "exact spacing" # end\r\n'
    : '{\r\n  "providers": {"custom": ' + JSON.stringify(providers.custom) + ', "keep": ' + JSON.stringify(providers.keep) + '},\r\n  "untouched": "exact spacing"\r\n}\r\n'
  write(config, text); write(copy, JSON.stringify({ providers }))
  const input = { cli, project: home, executable: '/simulated/not-executed', stateDirectory: state, nativeHome: home,
    config: DEFAULT_CONFIG, login: `${cli}:custom:native.config`, action: 'logout' as const, signal: signal() }
  return { cli, home, state, native, plugin, config, copy, text, providers, input,
    status: () => inspectPiOmpNativeAccount(cli, state, signal(), { nativeHome: home }) }
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe.each(['omp', 'pi'] as const)('%s native config provider deletion (simulated)', cli => {
  it('labels a native config and its identical snapshot as one removable native row', async () => {
    const f = fixture(cli), status = await f.status()
    const row = status.logins?.find(row => row.id === f.input.login)
    expect(row).toMatchObject({ source: 'native', nativeConfiguration: true })
    expect(status.logins?.filter(item => item.providerLabel === row!.providerLabel)).toHaveLength(1)
  })
  it('backs up original bytes privately, removes one provider in both files, preserves mode, then cannot resurrect it', async () => {
    const f = fixture(cli), mode = fs.statSync(f.config).mode & 0o777
    const originalCopy = read(f.copy)
    await deleteConfig(f.input)
    const result = cli === 'omp' ? yaml(read(f.config)) : JSON.parse(read(f.config))
    expect(result.providers).toEqual({ keep: f.providers.keep })
    expect(result.untouched).toBe('exact spacing')
    expect(JSON.parse(read(f.copy)).providers).toEqual({ keep: f.providers.keep })
    if (process.platform !== 'win32') expect(fs.statSync(f.config).mode & 0o777).toBe(mode)
    if (cli === 'omp') {
      expect(read(f.config)).toContain('# keep header\r\n')
      expect(read(f.config)).toContain('  # keep comment\r\n  keep: { apiKey: simulated-keep-key, baseUrl: https://keep.invalid, models: [] }\r\n')
      expect(read(f.config)).toContain('untouched: "exact spacing" # end\r\n')
    }
    const backups = join(f.state, 'account-config-backups', cli)
    const operation = join(backups, fs.readdirSync(backups)[0]!)
    expect(read(join(operation, 'native-' + (cli === 'pi' ? 'models.json' : 'models.yml')))).toBe(f.text)
    expect(read(join(operation, 'snapshot-' + (cli === 'pi' ? 'models.json' : 'models.yml')))).toBe(originalCopy)
    if (process.platform !== 'win32') {
      expect(fs.statSync(operation).mode & 0o777).toBe(0o700)
      for (const name of fs.readdirSync(operation)) expect(fs.statSync(join(operation, name)).mode & 0o777).toBe(0o600)
    }
    expect(await piOmpStoredLoginExists(cli, f.input.login!, f.state, signal(), { nativeHome: f.home })).toBe(false)
    await snapshotPiOmpNative(cli, f.plugin, { accountRoot: f.state, nativeHome: f.home })
    expect((await f.status()).logins?.some(row => row.id === f.input.login)).toBe(false)
    expect(yaml(read(f.copy)).providers.custom).toBeUndefined()
  })
  it('leaves a different private configuration and auth store untouched', async () => {
    const f = fixture(cli), different = { ...f.providers.custom, apiKey: 'simulated-independent' }
    write(f.copy, JSON.stringify({ providers: { custom: different, keep: f.providers.keep } }))
    const authPath = join(f.native, 'auth.json'); write(authPath, '{"custom":{"type":"api_key","key":"simulated-auth"}}')
    const originalAuth = read(authPath), originalCopy = read(f.copy)
    expect((await f.status()).logins?.some(row => row.id === f.input.login)).toBe(true)
    await deleteConfig(f.input)
    expect(read(f.copy)).toBe(originalCopy); expect(read(authPath)).toBe(originalAuth)
  })
  it('keeps environment-only rows read-only and cannot target an absent file entry', async () => {
    const f = fixture(cli); write(join(f.native, '.env'), 'DEEPSEEK_API_KEY=simulated-env\nZAI_API_KEY=simulated-zai\n')
    const status = await f.status(), env = status.logins?.find(row => row.providerLabel.includes('Z.AI'))
    expect(env).toBeDefined(); expect(env?.id).toBeUndefined(); expect(env?.source).toBeUndefined()
    const before = read(f.config)
    await expect(deleteConfig({ ...f.input, login: `${cli}:zai:native.config` })).rejects.toThrow()
    expect(read(f.config)).toBe(before)
  })
  it('refuses symlinked native config and leaves its target untouched', async () => {
    const f = fixture(cli), outside = join(f.home, 'outside')
    write(outside, f.text); fs.unlinkSync(f.config); fs.symlinkSync(outside, f.config)
    await expect(deleteConfig(f.input)).rejects.toThrow()
    expect(read(outside)).toBe(f.text)
  })
  it('rolls back the native file if snapshot replacement fails, retaining a private original backup', async () => {
    const f = fixture(cli), originalCopy = read(f.copy), rename = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (to === f.copy && String(from).endsWith('.tmp')) throw new Error('simulated failure')
      return rename(from, to)
    })
    await expect(deleteConfig(f.input)).rejects.toThrow()
    expect(read(f.config)).toBe(f.text); expect(read(f.copy)).toBe(originalCopy)
    expect(fs.readdirSync(join(f.state, 'account-config-backups', cli))).toHaveLength(1)
  })
})

it.each([
  'providers: {custom: {apiKey: simulated}, keep: {apiKey: kept}} # end\n',
  'providers: {keep: {apiKey: kept}, custom: {apiKey: simulated},} # end\n',
  'providers: {custom: {apiKey: simulated},} # end\n',
  'providers:\n  custom:\n    apiKey: simulated\nother: true\n',
  '# header\nproviders:\n  keep: {apiKey: kept}\n  custom: {apiKey: simulated} # target\n# tail\nother: true\n',
])('simulated YAML removal preserves other content without full serialization: %s', async text => {
  const { removeNativeConfigProvider } = await import('../src/host/custom-provider-native.ts')
  const expected = yaml(text); delete expected.providers.custom
  const next = removeNativeConfigProvider('omp', text, 'custom')
  expect(yaml(next)).toEqual(expected)
  if (text.includes('# end')) expect(next).toContain('# end\n')
  if (text.includes('# header')) expect(next.startsWith('# header\n')).toBe(true)
  if (text.includes('# tail')) expect(next).toContain('# tail\nother: true\n')
})
it('simulated YAML aliases and malformed documents are refused rather than rewritten', async () => {
  const { removeNativeConfigProvider } = await import('../src/host/custom-provider-native.ts')
  for (const text of ['providers: {custom: {apiKey: a}, custom: {apiKey: b}}',
    'providers:\n  custom: &shared {apiKey: simulated}\nelsewhere: *shared\n'])
    expect(() => removeNativeConfigProvider('omp', text, 'custom')).toThrow()
})
it('simulated backup creation failure does not modify either source', async () => {
  const f = fixture('omp'), copy = read(f.copy)
  vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
    throw new Error('simulated backup failure')
  })
  await expect(deleteConfig(f.input)).rejects.toThrow()
  expect(read(f.config)).toBe(f.text); expect(read(f.copy)).toBe(copy)
})
it('simulated native file changed during backup is preserved, not overwritten', async () => {
  const f = fixture('omp'), copy = read(f.copy), rename = fs.renameSync
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    rename(from, to)
    if (String(to).includes('account-config-backups') && String(to).endsWith('native-models.yml')) write(f.config, f.text + '# external edit\n')
  })
  await expect(deleteConfig(f.input)).rejects.toThrow()
  expect(read(f.config)).toBe(f.text + '# external edit\n'); expect(read(f.copy)).toBe(copy)
})
it('simulated readback mismatch preserves external native bytes and restores the unchanged snapshot', async () => {
  const f = fixture('omp'), copy = read(f.copy), rename = fs.renameSync
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    rename(from, to)
    if (to === f.config && String(from).endsWith('.tmp')) write(f.config, f.text)
  })
  await expect(deleteConfig(f.input)).rejects.toThrow()
  expect(read(f.config)).toBe(f.text); expect(read(f.copy)).toBe(copy)
})
it('simulated linked snapshot is refused before changing the native file', async () => {
  const f = fixture('omp'), target = join(f.home, 'other-models.yml')
  write(target, read(f.copy)); fs.unlinkSync(f.copy); fs.linkSync(target, f.copy)
  await expect(deleteConfig(f.input)).rejects.toThrow()
  expect(read(f.config)).toBe(f.text)
})

it.each(['pi', 'omp'] as const)('simulated %s AccountManager directly acknowledges verified native config removal', async cli => {
  const f = fixture(cli); vi.spyOn(os, 'homedir').mockReturnValue(f.home)
  const backend: ProcessBackend = { resolveExecutable: vi.fn(), spawn: vi.fn(() => { throw new Error('No process allowed') }),
    spawnTerminal: vi.fn(async () => { throw new Error('simulated terminal allocation failure') }) }
  const manager = new AccountManager(backend, { ...DEFAULT_CONFIG, stateDirectory: f.state }, async () => undefined)
  try {
    expect(await manager.deleteConfiguration('parent', cli, f.input.login!, signal())).toEqual({ ok: true })
    expect(manager.isBusy(cli)).toBe(false)
    expect(yaml(read(f.config)).providers.custom).toBeUndefined()
    expect(backend.spawnTerminal).not.toHaveBeenCalled(); expect(backend.spawn).not.toHaveBeenCalled()
  } finally { await manager.close() }
})
