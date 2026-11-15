/** 模拟：isolated files/SDK only; no real login, logout, credentials, or model calls. */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { piOmpStoredLoginExists, listPiOmpAccountSources } from '../src/host/pi-omp-native.ts'
import { preparePiOmpAccountTerminal } from '../src/host/pi-omp-accounts.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
const roots: string[] = []
const write = async (path: string, text: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text, { mode: 0o600 }) }
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pi-account-isolation-simulated-'))); roots.push(root)
  const state = join(root, 'state'), agent = join(state, 'accounts/pi/agent')
  await write(join(agent, 'auth.json'), JSON.stringify({ 'zai-coding-cn': { type: 'api_key', key: 'SIMULATED_KEY' }, other: { type: 'api_key', key: 'SIMULATED_OTHER' } }))
  await write(join(agent, 'models.json'), '{ invalid unrelated model configuration')
  return { root, state, agent, input: { cli: 'pi' as const, executable: '/synthetic/pi.js', project: root, stateDirectory: state, nativeHome: root, config: DEFAULT_CONFIG } }
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
describe('Pi account isolation (simulated)', () => {
  it('targeted verification reads only the selected auth file, even if unrelated models are invalid', async () => {
    const f = await fixture(), signal = new AbortController().signal
    expect(await piOmpStoredLoginExists('pi', 'pi:zai-coding-cn:plugin', f.state, signal, { nativeHome: f.root })).toBe(true)
    await write(join(f.agent, 'auth.json'), '{"other":{"type":"api_key","key":"SIMULATED_OTHER"}}')
    expect(await piOmpStoredLoginExists('pi', 'pi:zai-coding-cn:plugin', f.state, signal, { nativeHome: f.root })).toBe(false)
  })
  it('source discovery does not suppress the provider picker when a model file is broken', async () => {
    const f = await fixture()
    expect(await listPiOmpAccountSources('pi', f.state, new AbortController().signal, { nativeHome: f.root }))
      .toEqual([{ id: 'plugin', label: '插件目录' }])
  })
  it('prepares exact targeted logout without parsing unrelated model/config sources', async () => {
    const f = await fixture()
    const launch = await preparePiOmpAccountTerminal({ ...f.input, action: 'logout', login: 'pi:zai-coding-cn:plugin' })
    try { expect(launch.argv.slice(-3)).toEqual(['logout', join(f.agent, 'auth.json'), 'zai-coding-cn']) }
    finally { await launch.cleanup() }
  })
  it('opens provider login without snapshotting broken model configuration or native credentials', async () => {
    const f = await fixture(), before = await readFile(join(f.agent, 'models.json'), 'utf8')
    const launch = await preparePiOmpAccountTerminal({ ...f.input, action: 'login', provider: 'zai-coding-cn' })
    try { expect(launch.argv.slice(-2)).toEqual(['login', 'zai-coding-cn']); expect(await readFile(join(f.agent, 'models.json'), 'utf8')).toBe(before) }
    finally { await launch.cleanup() }
  })
  it('targeted helper uses native credential storage without initializing model runtime (simulated Pi 1.5.2 SDK)', async () => {
    const f = await fixture(), pkg = join(f.root, 'sdk'), dist = join(pkg, 'dist')
    await write(join(pkg, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '1.5.2', type: 'module', bin: 'dist/cli.js' }))
    for (const name of ['cli.js', 'index.js']) await write(join(dist, name), '')
    await write(join(dist, 'core/model-runtime.js'), `throw new Error('SIMULATED: model initialization must not run during logout')`)
    await write(join(dist, 'core/auth-storage.js'), `import {readFile,writeFile} from 'node:fs/promises'; export class AuthStorage {
      static create(path) {return new AuthStorage(path)} constructor(path){this.path=path}
      async list(){return Object.keys(JSON.parse(await readFile(this.path,'utf8'))).map(providerId=>({providerId,type:'api_key'}))}
      async delete(id){const data=JSON.parse(await readFile(this.path,'utf8'));delete data[id];await writeFile(this.path,JSON.stringify(data))}
    }`)
    const result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../src/host/pi-login.mjs', import.meta.url)), join(dist, 'cli.js'), 'logout', join(f.agent, 'auth.json'), 'zai-coding-cn'], { cwd: f.root, timeout: 10000 })
    expect(result.stderr).toBe(''); expect(result.stdout).toContain('已移除')
    expect(Object.keys(JSON.parse(await readFile(join(f.agent, 'auth.json'), 'utf8')))).toEqual(['other'])
  })
  it('login creates an account-only runtime and opens the selected native provider (simulated Pi 1.5.2 SDK)', async () => {
    const f = await fixture(), pkg = join(f.root, 'sdk'), dist = join(pkg, 'dist')
    await write(join(pkg, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '1.5.2', type: 'module', bin: 'dist/cli.js' }))
    for (const name of ['cli.js', 'core/model-runtime.js', 'core/auth-storage.js']) await write(join(dist, name), '')
    await write(join(dist, 'index.js'), `
      export const ModelRuntime = { create: async options => {
        if(options.modelsPath !== null || options.refreshOnCreate !== false || options.allowModelNetwork !== false)
          throw new Error('SIMULATED account window must not load models');
        return {accountOnly:true};
      }};
      export const SessionManager = {inMemory:()=>({})};
      export const createAgentSessionRuntime = async (factory, context) => factory(context);
      export const createAgentSessionServices = async options => {
        if(!options.modelRuntime?.accountOnly || !options.resourceLoaderOptions.noExtensions) throw new Error('SIMULATED model dependency');
        return {};
      };
      export const createAgentSessionFromServices = async options => {
        if(options.noTools !== 'all') throw new Error('SIMULATED tools must stay disabled'); return {};
      };
      export class InteractiveMode {
        async init() {} async handleLoginCommand(provider) {if(provider !== 'zai-coding-cn') throw new Error('SIMULATED wrong target');}
        async run(){process.stdout.write('SIMULATED_GUIDE_OPEN');}
      }
    `)
    const result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../src/host/pi-login.mjs', import.meta.url)), join(dist, 'cli.js'), 'login', 'zai-coding-cn'], {
      cwd: f.root, env: { ...process.env, PI_CODING_AGENT_DIR: f.agent }, timeout: 10000,
    })
    expect(result.stdout).toBe('SIMULATED_GUIDE_OPEN'); expect(result.stderr).toBe('')
  })

})
