import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NativeLoginProviders, parseNativeLoginProviders } from '../src/host/native-login-providers.ts'
import { loginProviders, providerStores, isLoginProvider } from '../src/host/account-guide/providers.ts'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
import { captureCatalogMetadata } from '../src/host/adapters.ts'
vi.mock('../src/host/adapters.ts', () => ({ captureCatalogMetadata: vi.fn() }))
const capture = vi.mocked(captureCatalogMetadata)
const roots: string[] = []
afterEach(async () => { vi.resetAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, {recursive:true, force:true}))) })
const raw = (providers: unknown[]) => JSON.stringify({providers})
it('uses each installed registry, including China/international and version-specific entries (simulated Mac/Windows)', () => {
  const pi = parseNativeLoginProviders('pi', raw([{id:'zai-coding-cn',name:'ZAI CN'},{id:'zai',name:'ZAI'}]))
  const mac = parseNativeLoginProviders('omp', raw([{id:'zhipu-coding-plan',name:'Zhipu'},{id:'zai',name:'ZAI'}]))
  const windows = parseNativeLoginProviders('omp', raw([{id:'new-native-provider',name:'Synthetic native provider'}]))
  expect(pi.map(p=>p.id)).toEqual(['zai-coding-cn','zai'])
  expect(pi[0]?.label).toContain('BigModel')
  expect(mac.every(p=>p.multi)).toBe(true)
  expect(isLoginProvider('omp','zhipu-coding-plan',windows)).toBe(false)
  expect(isLoginProvider('omp','new-native-provider',windows)).toBe(true)
  expect(loginProviders('pi',[])).toEqual([])
  expect(loginProviders('omp',[])).toEqual([])
})
it('retains native credential aliases for signed-in state and login proof', () => {
  const entries = parseNativeLoginProviders('omp', raw([{id:'openai-codex-device',name:'Device',stores:'openai-codex'}]))
  expect(providerStores('omp','openai-codex-device',entries)).toBe('openai-codex')
  expect(loginProviders('omp',[{id:'omp:openai-codex:plugin.2',providerLabel:'Synthetic',authMethod:'oauth'}],entries)?.[0]?.signedIn).toBe(true)
})
it.each([null,{}, {providers:[{id:'x\n/logout',name:'bad'}]}, {providers:[{id:'x',name:'\u001b[31m'}]}, {providers:[{id:'x',name:'X'},{id:'x',name:'duplicate'}]}, {providers:Array.from({length:257},(_,i)=>({id:`p${i}`,name:'X'}))}])('rejects malformed/unbounded metadata %j', value => {
  expect(()=>parseNativeLoginProviders('omp',JSON.stringify(value))).toThrow()
})
it('caches only successful metadata for the installed entry, retries failures and cleans private homes', async () => {
  const root = await mkdtemp(join(tmpdir(),'synthetic-login-provider-test-')); roots.push(root)
  const exe = join(root,'omp.exe'); await writeFile(exe,'synthetic binary metadata, never executed')
  capture.mockImplementation(async (_backend,_config,_argv,cwd)=> {
    expect((await stat(cwd)).mode & 0o777).toBe(0o700)
    expect((await stat(join(cwd,'config.json'))).mode & 0o777).toBe(0o600)
    return raw([{id:'zhipu-coding-plan',name:'China'}])
  })
  const registry = new NativeLoginProviders({} as ProcessBackend,DEFAULT_CONFIG)
  const signal = new AbortController().signal
  await registry.read('omp',exe,signal); await registry.read('omp',exe,signal)
  expect(capture).toHaveBeenCalledTimes(1)
  await expect(stat(capture.mock.calls[0]![3])).rejects.toMatchObject({code:'ENOENT'})
  await writeFile(exe,'synthetic changed installed native version')
  capture.mockRejectedValueOnce(new Error('metadata failed'))
  await expect(registry.read('omp',exe,signal)).rejects.toThrow('metadata failed')
  await registry.read('omp',exe,signal)
  expect(capture).toHaveBeenCalledTimes(3)
  const abort = new AbortController(); abort.abort(new Error('cancelled'))
  await expect(registry.read('omp',exe,abort.signal)).rejects.toThrow('cancelled')
})
it('OMP metadata helper scrubs inherited credentials, asks only native metadata and waits for clean EOF (synthetic process)', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { realpath } = await import('node:fs/promises')
  const root = await realpath(await mkdtemp(join(tmpdir(),'synthetic-native-login-helper-'))); roots.push(root)
  const entry = join(root,'fixture.mjs')
  await writeFile(entry, `
    let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', s=>input+=s);
    process.stdin.on('end',()=>{
      const query=JSON.parse(input);
      if(query.type!=='get_login_providers' || process.env.PRIVATE_TEST_KEY || process.env.OMP_AUTH_BROKER_TOKEN || process.env.OPENAI_API_KEY!=='SYNTHETIC_CLIWORKER_METADATA_NO_INFERENCE' || process.env.HOME!==process.cwd()) process.exit(9);
      process.stdout.write(JSON.stringify({type:'response',id:query.id,command:query.type,success:true,data:{providers:[{id:'zai',name:'ZAI'},{id:'unavailable',name:'Hidden',available:false}]}})+'\\n');
    });
  `)
  const result = await promisify(execFile)(process.execPath,[new URL('../src/host/native-login-providers.mjs',import.meta.url).pathname,'omp',entry],{cwd:root,env:{...process.env,CLIWORKER_LOGIN_METADATA_HOME:root,PRIVATE_TEST_KEY:'SYNTHETIC_SECRET',OMP_AUTH_BROKER_TOKEN:'SYNTHETIC_BROKER'},timeout:10000})
  expect(JSON.parse(result.stdout)).toEqual({providers:[{id:'zai',name:'ZAI'}]})
  expect(result.stderr).toBe('')
})
