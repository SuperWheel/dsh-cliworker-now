import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, lstat, readdir, realpath, rm, symlink } from 'node:fs/promises'
import { dirname, join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { nativeResidueCandidates, cleanNativeResidues, cleanNpmResidues, npmPrefixIdle, type NativeCleanupProof } from '../src/host/cli-management/update-residue.ts'
import { withUpdateCleanup, trackUpdateTemporary, updateCleanupIo, afterUpdateCleanup, finishUpdateCleanup } from '../src/host/cli-management/update-cleanup.ts'
import { ProcessCleanupUnconfirmedError, DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
import type { ActiveCliId } from '../src/shared/types.ts'
import { downloadCliArtifact } from '../src/host/cli-management/download.ts'
const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root,{recursive:true,force:true}))) })
async function root() { const value = await realpath(await mkdtemp(join(tmpdir(),'synthetic-update-cleanup-'))); roots.push(value); return value }
async function put(path: string, text = '1234') { await mkdir(dirname(path),{recursive:true}); await writeFile(path,text); return path }
const exists = async (path: string) => !!await lstat(path).catch(() => undefined)
async function fixture(cli: ActiveCliId, platform: 'darwin' | 'win32' = 'darwin') {
  const home = await root(), temp = join(home,'tmp'), location = {home,temp,username:'fixture-user',platform}, win = platform === 'win32'
  await mkdir(temp)
  let current: string, old: string, fresh: string, backup: string | undefined
  if (cli === 'grok') {
    current = await put(join(home,win ? '.grok/bin/grok.exe' : '.grok/bin/grok'))
    old = await put(join(home,'.grok/downloads/grok-1.0.0'))
    fresh = join(home,'.grok/downloads/grok-2.0.0')
    backup = join(home,win ? '.grok/bin/grok.exe.old' : '.grok/bin/grok.old')
  } else if (cli === 'qoder' || cli === 'qodercn') {
    const store = join(home,cli === 'qoder' ? '.qoder' : '.qoder-cn','bin',cli === 'qoder' ? 'qodercli' : 'qoderclicn'), bin = basename(store)
    const ext = win ? '.exe' : ''
    current = await put(join(store,`${bin}-1.2.0${ext}`)); await put(join(store,'version.txt'),'1.2.0\n')
    old = await put(join(store,`${bin}-1.0.0${ext}`)); fresh = join(store,`${bin}-2.0.0${ext}`)
  } else if (cli === 'claude') {
    const store = join(home,'.local/share/claude/versions')
    current = await put(join(store,'1.2.0')); old = await put(join(store,'1.0.0')); fresh = join(store,'2.0.0')
  } else if (cli === 'traecn') {
    const store = join(home,win ? 'AppData/Local/TraeCLI' : '.local/share/traecli')
    current = await put(join(store,'releases/1.2.0/bin/traex'))
    old = dirname(await put(join(store,'releases/1.0.0/traex')))
    fresh = join(store,'releases/2.0.0')
    await symlink(join(store,'releases/1.2.0'),join(store,'current'),'dir')
  } else throw new Error('Use the dedicated Hermes post-update fixture')

  const proof: NativeCleanupProof = {runnable:true,version:'1.2.0',identity:{executable:current,fingerprint:{realpath:current,size:4,mtimeMs:1},source:'self-update'}}
  const createFresh = async () => { if (cli === 'traecn') await put(join(fresh,'binary')); else await put(fresh); if (backup) await put(backup) }
  return {home,temp,location,current,old,fresh,backup,proof,createFresh}
}
describe.each((['grok','qoder','qodercn','claude','traecn'] as const).flatMap(cli => (['darwin','win32'] as const).map(platform => ({cli,platform}))))('$cli / $platform evidenced cleanup rule (synthetic)', ({cli,platform}) => {
  it.each([true,false])('success=%s preserves current; failure removes only new unused copies', async success => {
    const f = await fixture(cli,platform), before = new Set((await nativeResidueCandidates(cli,f.location)).map(x=>x.path))
    await f.createFresh()
    await cleanNativeResidues(cli,before,success,f.proof,f.location)
    expect(await exists(f.current)).toBe(true)
    expect(await exists(f.old)).toBe(!success)
    expect(await exists(f.fresh)).toBe(false)
    if (f.backup) expect(await exists(f.backup)).toBe(!success)
  })
  it('unverifiable current keeps all original and new native copies', async () => {
    const f = await fixture(cli,platform); await f.createFresh()
    await cleanNativeResidues(cli,new Set(),true,{...f.proof,runnable:false},f.location)
    expect(await exists(f.old)).toBe(true); expect(await exists(f.fresh)).toBe(true)
  })
  it('does not follow candidate links or delete foreign names', async () => {
    const f = await fixture(cli,platform), outside = await put(join(f.home,'outside/keep'))
    await rm(f.old,{recursive:true}); await symlink(dirname(outside),f.old,process.platform === 'win32' ? 'junction' : 'dir')
    const foreign = await put(join(dirname(f.old),'foreign-copy'))
    await cleanNativeResidues(cli,new Set(),true,f.proof,f.location)
    expect((await lstat(f.old)).isSymbolicLink()).toBe(true)
    expect(await readFile(outside,'utf8')).toBe('1234'); expect(await exists(foreign)).toBe(true)
  })
})
it('Qoder requires matching version.txt and removes only the current user old native cache', async () => {
  const f = await fixture('qoder'), own = dirname(await put(join(f.temp,'qodercli-natives-v1.0.0-fixture-user/addon'))), foreign = dirname(await put(join(f.temp,'qodercli-natives-v1.0.0-foreign/addon')))
  await put(join(dirname(f.current),'version.txt'),'9.9.9')
  await cleanNativeResidues('qoder',new Set(),true,f.proof,f.location); expect(await exists(own)).toBe(true)
  await put(join(dirname(f.current),'version.txt'),'1.2.0')
  await cleanNativeResidues('qoder',new Set(),true,f.proof,f.location)
  expect(await exists(own)).toBe(false); expect(await exists(foreign)).toBe(true)
})
it('TRAE external current junction and unknown lease preserve versions', async () => {
  const f = await fixture('traecn'), pointer = join(f.home,'.local/share/traecli/current')
  await rm(pointer); await symlink(f.temp,pointer,process.platform === 'win32' ? 'junction' : 'dir')
  await cleanNativeResidues('traecn',new Set(),true,f.proof,f.location); expect(await exists(f.old)).toBe(true)
  await rm(pointer); await symlink(join(f.home,'.local/share/traecli/releases/1.2.0'),pointer,process.platform === 'win32' ? 'junction' : 'dir')
  const lease = await put(join(f.home,'.local/share/traecli/.traex-release-lease.unknown'))
  await cleanNativeResidues('traecn',new Set(),true,f.proof,f.location)
  expect(await exists(f.old)).toBe(true); expect(await exists(lease)).toBe(true)
})
it.each(['darwin','win32'] as const)('npm %s only deletes exact package and declared bin reify names when idle', async platform => {
  const prefix = await root(), parent = join(prefix,platform === 'win32' ? 'node_modules' : 'lib/node_modules','@scope'), bins = join(prefix,platform === 'win32' ? '' : 'bin')
  const own = dirname(await put(join(parent,'.package-aB123456/content'))), foreign = dirname(await put(join(parent,'.other-aB123456/content')))
  const backups = await Promise.all(['.tool-aB123456','.tool.cmd-aB123456','.tool.ps1-aB123456'].map(n=>put(join(bins,n))))
  const undeclared = await put(join(bins,'.other-aB123456')), malformed = await put(join(bins,'.tool-aB12345!'))
  const linked = join(parent,'.package-12345678'); await symlink(foreign,linked,process.platform === 'win32' ? 'junction' : 'dir')
  const options = {prefix,packageName:'@scope/package',bins:['tool'],platform,idle:async()=>false}
  await cleanNpmResidues(options); expect(await exists(own)).toBe(true)
  await cleanNpmResidues({...options,idle:async()=>true})
  expect(await exists(own)).toBe(false)
  for (const path of backups) expect(await exists(path)).toBe(false)
  for (const path of [foreign,undeclared,malformed,linked]) expect(await exists(path)).toBe(true)
})
it.each([true,false])('operation success=%s removes private cache/partial and reports actual bytes once', async success => {
  const home = await root(), output = vi.fn(), error = new Error('original')
  const run = withUpdateCleanup(output,async()=>{
    const directory = trackUpdateTemporary(join(home,'download'))
    await put(join(directory,'npm-cache/tarball'),'123456'); await put(join(directory,'broken.part'),'789')
    if (!success) throw error
    return 'result'
  })
  if (success) expect(await run).toBe('result'); else await expect(run).rejects.toBe(error)
  expect(await exists(join(home,'download'))).toBe(false)
  expect(output).toHaveBeenCalledTimes(1); expect(output.mock.calls[0]![0]).toContain('释放 9 B')
})
it('cleanup exceptions never override successful or failed results', async () => {
  const home = await root(), output = vi.fn(), error = new Error('original')
  vi.spyOn(updateCleanupIo,'remove').mockRejectedValue(new Error('locked'))
  const run = (fail: boolean)=>withUpdateCleanup(output,async()=>{ trackUpdateTemporary(await put(join(home,'file'))); if (fail) throw error; return 42 })
  expect(await run(false)).toBe(42); await expect(run(true)).rejects.toBe(error)
  expect(output.mock.calls[0]![0]).toContain('部分残留未能清理')
})
it('unconfirmed process exit keeps private files and skips native finalizers', async () => {
  const home = await root(), output = vi.fn(), callback = vi.fn(), error = new ProcessCleanupUnconfirmedError()
  await expect(withUpdateCleanup(output,async()=>{ trackUpdateTemporary(await put(join(home,'file'))); afterUpdateCleanup(callback); throw error })).rejects.toBe(error)
  expect(callback).not.toHaveBeenCalled(); expect(await exists(join(home,'file'))).toBe(true)
  expect(output.mock.calls[0]![0]).toContain('清理延期')
})
it('download throwing before it returns a path still removes its registered partial', async () => {
  const home = await root(), output = vi.fn(), control = new AbortController()
  const error = new Error('synthetic connection closed')
  await expect(withUpdateCleanup(output,()=>downloadCliArtifact({root:home,url:'https://example.org/install.sh',officialScript:true,signal:control.signal,progress:()=>{},fetcher:()=>new Promise((_resolve,reject)=>setTimeout(()=>{ reject(error); control.abort(error) },0))}))).rejects.toBe(error)
  expect(await readdir(join(home,'cli-management/downloads'))).toEqual([])
})

it('a queued operation started by a finalized scope gets its own cleanup and summary', async () => {
  const home = await root(), output = vi.fn()
  await withUpdateCleanup(output,async()=>{
    trackUpdateTemporary(await put(join(home,'first')))
    await finishUpdateCleanup()
    await withUpdateCleanup(output,async()=>{ trackUpdateTemporary(await put(join(home,'second'))) })
  })
  expect(output).toHaveBeenCalledTimes(2)
  expect(await readdir(home)).toEqual([])
})

it.each(['darwin','win32'] as const)('npm %s process inventory fails closed and waits for exit', async platform => {
  const handle = (output: string, exitCode = 0, exited = true) => ({ stdout: Readable.from([output]), stderr: Readable.from([]), done: Promise.resolve({exitCode,signal:null}), waitForExit: vi.fn(async()=>exited), terminate: vi.fn() })
  const spawn = vi.fn(), backend = {spawn} as unknown as ProcessBackend
  spawn.mockReturnValue(handle('node /runtime/npm-cli.js install --global --prefix elsewhere'))
  expect(await npmPrefixIdle(backend,DEFAULT_CONFIG,platform)).toBe(false)
  spawn.mockReturnValue(handle('node /runtime/ordinary-app.js'))
  expect(await npmPrefixIdle(backend,DEFAULT_CONFIG,platform)).toBe(true)
  const denied = handle('',1); spawn.mockReturnValue(denied)
  expect(await npmPrefixIdle(backend,DEFAULT_CONFIG,platform)).toBe(false)
  expect(denied.waitForExit).toHaveBeenCalled()
  spawn.mockReturnValue(handle('',0,false))
  await expect(npmPrefixIdle(backend,DEFAULT_CONFIG,platform)).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
})
