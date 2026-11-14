import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, lstat, readdir, realpath, rm, symlink, link, rename } from 'node:fs/promises'
import { dirname, join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { registerNativeResidueCleanup, nativeResidueCandidates, cleanNativeResidues, cleanNpmResidues, npmPrefixIdle, type NativeCleanupProof } from '../src/host/cli-management/update-residue.ts'
import { withUpdateCleanup, trackUpdateTemporary, updateCleanupIo, afterUpdateCleanup, finishUpdateCleanup } from '../src/host/cli-management/update-cleanup.ts'
import { ProcessCleanupUnconfirmedError, DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
import type { ActiveCliId } from '../src/shared/types.ts'
import { downloadCliArtifact } from '../src/host/cli-management/download.ts'
import { classifyInstallation } from '../src/host/cli-management/identity.ts'
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


describe('OMP observed Windows backup naming (synthetic)', () => {
  async function omp() {
    const home = await root(), current = await put(join(home,'AppData/Local/omp/omp.EXE'))
    const backup = await put(join(dirname(current),'omp.exe.1794693071300.27728.0.bak'))
    const proof: NativeCleanupProof = {runnable:true,version:'18.20.2',targetVersion:'18.20.2',identity:{executable:current,fingerprint:{realpath:current,size:4,mtimeMs:1},source:'self-update'}}
    return {home,current,backup,proof,location:{home,platform:'win32' as const}}
  }
  it('verified success removes only regular single-link exact backups and reports bytes', async () => {
    const f = await omp(), directory = dirname(f.current), output = vi.fn()
    const foreign = await put(join(directory,'other.exe.1.2.3.bak')), malformed = await put(join(directory,'omp.exe.1.2.bak'))
    const linked = join(directory,'omp.exe.1.2.3.bak'); await symlink(f.current,linked)
    const hard = join(directory,'omp.exe.2.3.4.bak'); await link(foreign,hard)
    const folder = join(directory,'omp.exe.3.4.5.bak'); await mkdir(folder)
    await withUpdateCleanup(output,()=>cleanNativeResidues('omp',new Set(),true,f.proof,f.location))
    expect(await exists(f.backup)).toBe(false)
    for (const path of [f.current,foreign,malformed,linked,hard,folder]) expect(await exists(path)).toBe(true)
    expect(output.mock.calls[0]![0]).toContain('OMP 原生备份 1 项，释放 4 B')
  })
  it.each(['failed','not-runnable','wrong-version','no-target','no-proof','unknown-source','posix'] as const)('%s keeps all OMP files', async condition => {
    const f = await omp()
    if (condition === 'not-runnable') f.proof.runnable = false
    if (condition === 'wrong-version') f.proof.version = '18.20.0'
    if (condition === 'no-target') delete f.proof.targetVersion
    if (condition === 'unknown-source') f.proof.identity.source = 'unknown'
    await cleanNativeResidues('omp',new Set(),condition !== 'failed',condition === 'no-proof' ? undefined : f.proof,{...f.location,platform:condition === 'posix' ? 'darwin' : 'win32'})
    expect(await exists(f.backup)).toBe(true); expect(await exists(f.current)).toBe(true)
  })
  it.each(['success','failure','mismatch','unconfirmed'] as const)('operation finalizer %s uses fresh version evidence before OMP removal', async outcome => {
    const f = await omp(), output = vi.fn(), version = vi.fn(async () => {
      if (outcome === 'unconfirmed') throw new ProcessCleanupUnconfirmedError()
      return outcome === 'mismatch' ? '18.20.0' : '18.20.2'
    })
    await withUpdateCleanup(output,async () => {
      await registerNativeResidueCleanup({cli:'omp',backend:{} as ProcessBackend,config:DEFAULT_CONFIG,
        success:()=>outcome !== 'failure',targetVersion:'18.20.2',location:f.location,
        identify:async()=>({...f.proof.identity,manifestVersion:'18.20.2'}),version})
      expect(await exists(f.backup)).toBe(true)
      expect(version).not.toHaveBeenCalled()
    })
    expect(await exists(f.backup)).toBe(outcome !== 'success')
    expect(await exists(f.current)).toBe(true)
    if (outcome === 'failure') expect(version).not.toHaveBeenCalled()
    else expect(version.mock.calls[0]?.[1]).toMatchObject({manifestVersion:undefined})
    if (outcome === 'unconfirmed') expect(output.mock.calls[0]![0]).toContain('进程退出未确认')
  })
  it('an install directory junction is not followed', async () => {
    const f = await omp(), directory = dirname(f.current), external = join(f.home,'external')
    const {rename} = await import('node:fs/promises')
    await rename(directory,external); await symlink(external,directory,process.platform === 'win32' ? 'junction' : 'dir')
    await cleanNativeResidues('omp',new Set(),true,f.proof,f.location)
    expect(await exists(join(external,basename(f.backup)))).toBe(true)
  })
})

describe('OMP macOS 官方自更新备份（模拟）', () => {
  async function omp() {
    const home = await root(), current = await put(join(home,'.local/bin/omp'))
    const backup = await put(join(dirname(current),'omp.1794698897770.88878.0.bak'))
    const proof: NativeCleanupProof = {runnable:true,version:'18.20.2',targetVersion:'18.20.2',identity:{executable:current,fingerprint:{realpath:current,size:4,mtimeMs:1},source:'self-update'}}
    return {home,current,backup,proof,location:{home,platform:'darwin' as const}}
  }
  it('成功且版本匹配时仅删除精确命名普通单链接备份，保留锁、异名、目录和链接', async () => {
    const f = await omp(), directory = dirname(f.current), output = vi.fn()
    expect(classifyInstallation('omp',f.current,undefined,f.home).source).toBe('self-update')
    const foreign = await Promise.all(['omp.1.2.bak','other.1.2.3.bak','OMP.4.5.6.bak','omp.4.5.6.BAK'].map(name=>put(join(directory,name))))
    const lock = await put(join(directory,'omp.lock'),'')
    const linked = join(directory,'omp.1.2.3.bak'); await symlink(f.current,linked)
    const hard = join(directory,'omp.2.3.4.bak'); await link(foreign[0]!,hard)
    const folder = join(directory,'omp.3.4.5.bak'); await mkdir(folder)
    expect((await nativeResidueCandidates('omp',f.location)).map(item=>item.path)).toEqual([f.backup])
    await withUpdateCleanup(output,()=>cleanNativeResidues('omp',new Set(),true,f.proof,f.location))
    expect(await exists(f.backup)).toBe(false)
    for (const path of [f.current,...foreign,lock,linked,hard,folder]) expect(await exists(path)).toBe(true)
    expect(await readFile(lock,'utf8')).toBe('')
    expect(output.mock.calls[0]![0]).toContain('OMP 原生备份 1 项，释放 4 B')
  })
  it.each(['success','failure','mismatch','unconfirmed'] as const)('最终化 %s 必须取得新鲜版本证据才回收', async outcome => {
    const f = await omp(), output = vi.fn(), version = vi.fn(async () => {
      if (outcome === 'unconfirmed') throw new ProcessCleanupUnconfirmedError()
      return outcome === 'mismatch' ? '18.20.0' : '18.20.2'
    })
    await withUpdateCleanup(output,async () => {
      await registerNativeResidueCleanup({cli:'omp',backend:{} as ProcessBackend,config:DEFAULT_CONFIG,
        success:()=>outcome !== 'failure',targetVersion:'18.20.2',location:f.location,
        identify:async()=>({...f.proof.identity,manifestVersion:'18.20.2'}),version})
      expect(await exists(f.backup)).toBe(true)
      expect(version).not.toHaveBeenCalled()
    })
    expect(await exists(f.backup)).toBe(outcome !== 'success')
    expect(await exists(f.current)).toBe(true)
    if (outcome === 'failure') expect(version).not.toHaveBeenCalled()
    else expect(version.mock.calls[0]?.[1]).toMatchObject({manifestVersion:undefined})
    if (outcome === 'unconfirmed') expect(output.mock.calls[0]![0]).toContain('进程退出未确认')
  })
  it.each(['symlink','hardlink','foreign-root','case-mismatch','linked-root'] as const)('入口 %s 保留备份且不启动版本探针', async condition => {
    const f = await omp(), version = vi.fn(async ()=>'18.20.2')
    let backup = f.backup
    if (condition === 'symlink') {
      const target = await put(join(f.home,'outside/omp')); await rm(f.current); await symlink(target,f.current)
    }
    if (condition === 'hardlink') await link(f.current,join(f.home,'entry-alias'))
    if (condition === 'foreign-root') f.proof.identity.fingerprint.realpath = await put(join(f.home,'custom/omp'))
    if (condition === 'case-mismatch') f.proof.identity.fingerprint.realpath = join(dirname(f.current),'OMP')
    if (condition === 'linked-root') {
      const external = join(f.home,'external'); await rename(dirname(f.current),external)
      await symlink(external,dirname(f.current),'dir'); backup = join(external,basename(f.backup))
    }
    await withUpdateCleanup(vi.fn(),()=>registerNativeResidueCleanup({cli:'omp',backend:{} as ProcessBackend,config:DEFAULT_CONFIG,
      success:()=>true,targetVersion:'18.20.2',location:f.location,identify:async()=>f.proof.identity,version}))
    expect(version).not.toHaveBeenCalled()
    await cleanNativeResidues('omp',new Set(),true,f.proof,f.location)
    expect(await exists(backup)).toBe(true)
  })
  it.each(['not-runnable','no-target','unknown-source'] as const)('证据 %s 保留全部备份', async condition => {
    const f = await omp()
    if (condition === 'not-runnable') f.proof.runnable = false
    if (condition === 'no-target') delete f.proof.targetVersion
    if (condition === 'unknown-source') f.proof.identity.source = 'unknown'
    await cleanNativeResidues('omp',new Set(),true,f.proof,f.location)
    expect(await exists(f.backup)).toBe(true)
  })
  it('Linux 即使同布局、成功且版本匹配也保留，不枚举候选或启动探针', async () => {
    const f = await omp(), location = {...f.location,platform:'linux' as const}, version = vi.fn(async ()=>'18.20.2')
    expect(await nativeResidueCandidates('omp',location)).toEqual([])
    await withUpdateCleanup(vi.fn(),()=>registerNativeResidueCleanup({cli:'omp',backend:{} as ProcessBackend,config:DEFAULT_CONFIG,
      success:()=>true,targetVersion:'18.20.2',location,identify:async()=>f.proof.identity,version}))
    expect(version).not.toHaveBeenCalled()
    await cleanNativeResidues('omp',new Set(),true,f.proof,location)
    expect(await exists(f.backup)).toBe(true)
  })
  it('更新进程退出未确认时跳过最终化并保留备份', async () => {
    const f = await omp(), version = vi.fn(async ()=>'18.20.2'), error = new ProcessCleanupUnconfirmedError()
    await expect(withUpdateCleanup(vi.fn(),async () => {
      await registerNativeResidueCleanup({cli:'omp',backend:{} as ProcessBackend,config:DEFAULT_CONFIG,
        success:()=>true,targetVersion:'18.20.2',location:f.location,identify:async()=>f.proof.identity,version})
      throw error
    })).rejects.toBe(error)
    expect(version).not.toHaveBeenCalled()
    expect(await exists(f.backup)).toBe(true)
  })
})
