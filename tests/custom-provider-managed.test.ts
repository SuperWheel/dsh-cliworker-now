/** 模拟：temporary HOME and invented keys only. Never runs a CLI or reads a real account. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse as yaml } from 'yaml'
import { CustomProviders } from '../src/host/custom-provider.ts'
import { commitNativeFiles, nativeJson, readNativeFile } from '../src/host/custom-provider-files.ts'
import { deletePiOmpManagedProvider, managedProviderReceiptChange, managedPiOmpProviders, piOmpManagedProviderExists } from '../src/host/custom-provider-managed.ts'
import { inspectPiOmpNativeAccount, piOmpStoredLoginExists } from '../src/host/pi-omp-native.ts'
import { preparePiOmpLogout } from '../src/host/pi-omp-logout.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
vi.mock('node:fs', async load => ({ ...await load<typeof import('node:fs')>() }))
const roots: string[] = []
const write = (path: string, text: string) => { fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); fs.writeFileSync(path, text, { mode: 0o600 }) }
const read = (path: string) => fs.readFileSync(path, 'utf8')
const signal = () => new AbortController().signal
function fixture(cli: 'pi' | 'omp') {
  const home = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'managed-provider-simulated-'))); roots.push(home)
  const state = join(home, 'state'), directory = join(state, 'accounts', cli, 'agent')
  const config = join(directory, cli === 'pi' ? 'models.json' : 'models.yml'), auth = join(directory, 'auth.json')
  const old = { apiKey: 'simulated-keep', baseUrl: 'https://keep.invalid', models: [] }
  write(config, JSON.stringify({ untouched: { value: 42 }, providers: { old } }))
  write(auth, JSON.stringify({ old: { type: 'api_key', key: 'SIMULATED_OLD' } }))
  const ownership = join(directory, 'cliworker-created-providers.json')
  const login = `${cli}:custom-demo:plugin.config`
  if (cli === 'pi') {
    const manager = new CustomProviders({ home, stateDirectory: state, env: {} })
    const source = { cli, parent: 'simulated', entry: { mode: 'auto' }, revision: 0 }
    const form = manager.form(source)!
    expect(manager.save(source, form.token, JSON.stringify({ providerId: 'custom-demo', providerLabel: 'Simulated',
      api: 'openai-completions', apiKey: 'simulated-custom', baseUrl: 'https://custom.invalid/v1', models: ['demo'] }), () => {})).toMatchObject({ ok: true })
  } else {
    // OMP has no form writer in the current product. Simulate an explicitly
    // recorded plugin write through the same receipt contract; never adopt old config.
    const entry = { api: 'openai-completions', apiKey: 'simulated-custom', baseUrl: 'https://custom.invalid/v1', models: [{ id: 'demo' }] }
    const current = readNativeFile(config, true)
    commitNativeFiles([{ file: current, text: JSON.stringify({ untouched: { value: 42 }, providers: { old, 'custom-demo': entry } }) },
      managedProviderReceiptChange(directory, 'custom-demo', entry)], () => {})
  }
  const status = () => inspectPiOmpNativeAccount(cli, state, signal(), { nativeHome: home })
  return { cli, home, state, directory, config, auth, ownership, login, status }
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe.each(['pi', 'omp'] as const)('%s plugin provider deletion (simulated)', cli => {
  it('projects only receipt-backed config as removable, deletes exactly it, and refreshes the projection', async () => {
    const f = fixture(cli), initial = await f.status()
    expect(initial.logins).toContainEqual(expect.objectContaining({ id: f.login, source: 'plugin', managedConfiguration: true }))
    expect(await piOmpStoredLoginExists(cli, f.login, f.state, signal(), { nativeHome: f.home })).toBe(true)
    const beforeAuth = nativeJson(read(f.auth)).value.old
    deletePiOmpManagedProvider(cli, f.state, f.login, () => {})
    const next = yaml(read(f.config))
    expect(next).toEqual({ untouched: { value: 42 }, providers: { old: { apiKey: 'simulated-keep', baseUrl: 'https://keep.invalid', models: [] } } })
    expect(nativeJson(read(f.auth)).value.old).toEqual(beforeAuth)
    expect((await f.status()).logins?.some(row => row.id === f.login)).toBe(false)
    expect(await piOmpStoredLoginExists(cli, f.login, f.state, signal(), { nativeHome: f.home })).toBe(false)
    expect(read(f.ownership)).not.toContain('SIMULATED_CUSTOM')
    if (process.platform !== 'win32') for (const path of [f.config, f.ownership]) expect(fs.statSync(path).mode & 0o777).toBe(0o600)
  })
  it('does not adopt a hand-written or copied private config without its creation receipt', async () => {
    const f = fixture(cli); fs.unlinkSync(f.ownership)
    const before = read(f.config), auth = read(f.auth)
    expect(managedPiOmpProviders(f.directory, yaml(before), nativeJson(auth).value).size).toBe(0)
    expect((await f.status()).logins?.some(row => row.managedConfiguration)).toBe(false)
    expect(() => deletePiOmpManagedProvider(cli, f.state, f.login, () => {})).toThrow('账号来源已变化')
    expect(read(f.config)).toBe(before); expect(read(f.auth)).toBe(auth)
  })
  it('rejects changed target contents and foreign source handles without deleting anything', () => {
    const f = fixture(cli), data = yaml(read(f.config)); data.providers['custom-demo'].baseUrl = 'https://edited.invalid'
    write(f.config, JSON.stringify(data)); const before = read(f.config)
    expect(piOmpManagedProviderExists(cli, f.state, f.login)).toBe(true)
    for (const login of [f.login, `${cli}:custom-demo:native.config`, 'pi:../escape:plugin.config'])
      expect(() => deletePiOmpManagedProvider(cli, f.state, login, () => {})).toThrow()
    expect(read(f.config)).toBe(before)
  })
  it('rolls back committed files if the receipt rename fails', () => {
    const f = fixture(cli), before = [read(f.config), read(f.auth), read(f.ownership)], rename = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (to === f.ownership && String(from).endsWith('.tmp')) throw new Error('simulated disk failure')
      return rename(from, to)
    })
    expect(() => deletePiOmpManagedProvider(cli, f.state, f.login, () => {})).toThrow('账号来源已变化')
    expect([read(f.config), read(f.auth), read(f.ownership)]).toEqual(before)
    expect(fs.readdirSync(f.directory).some(name => /\.(lock|tmp|bak)$/.test(name))).toBe(false)
  })
  it('refuses concurrent file edits at commit and cancelled operations', () => {
    const f = fixture(cli), before = read(f.config)
    expect(() => deletePiOmpManagedProvider(cli, f.state, f.login, () => { throw new Error('cancelled') })).toThrow()
    expect(read(f.config)).toBe(before)
    let calls = 0
    expect(() => deletePiOmpManagedProvider(cli, f.state, f.login, () => { if (++calls === 2) write(f.config, before + '\n') })).toThrow()
    expect(read(f.config)).toBe(before + '\n'); expect(piOmpManagedProviderExists(cli, f.state, f.login)).toBe(true)
  })
  it('refuses configuration deletion during terminal preparation without touching the provider', async () => {
    const f = fixture(cli)
    await expect(preparePiOmpLogout({ cli, stateDirectory: f.state, executable: '/simulated/not-executed', project: f.home,
      config: DEFAULT_CONFIG, action: 'logout', login: f.login, nativeHome: f.home, signal: signal() })).rejects.toThrow('账号窗口')
    expect(piOmpManagedProviderExists(cli, f.state, f.login)).toBe(true)
  })
})
it('Pi deletion respects a native auth lock', () => {
  const f = fixture('pi'), before = read(f.auth)
  fs.mkdirSync(f.auth + '.lock')
  expect(() => deletePiOmpManagedProvider('pi', f.state, f.login, () => {})).toThrow()
  expect(read(f.auth)).toBe(before); expect(fs.existsSync(f.auth + '.lock')).toBe(true)
})
it.each(['{"a":1,"b":2,"c":3}', '{"a":1,"b":2,"c":3,}', '{\n//keep\n"a":1, /* keep */ "b":2, "c":3\n}'])('lossless JSON removal retains other keys (simulated JSONC %s)', text => {
  for (const key of ['a', 'b', 'c']) {
    const expected = { ...nativeJson(text).value }; delete expected[key]
    expect(nativeJson(nativeJson(text).remove([key])).value).toEqual(expected)
  }
})
