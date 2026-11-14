/** 合成安装树、回执及进程；不运行 Hermes 或读取用户安装/账号。 */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, mkdir, writeFile, readFile, lstat, rm, symlink, utimes } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { cleanHermesResidues, hermesResidueLockState, hermesProcessState, type HermesCleanupProof } from '../src/host/cli-management/update-residue.ts'
import { afterUpdateCleanup, withUpdateCleanup, updateCleanupIo } from '../src/host/cli-management/update-cleanup.ts'
import { ProcessCleanupUnconfirmedError, DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
import { checked, finished, serviceFixture } from './cli-management-phase-b-fixture.ts'

const roots: string[] = [], services: ReturnType<typeof serviceFixture>[] = []
afterEach(async () => { for (const f of services.splice(0)) await f.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const p of roots.splice(0)) await rm(p,{recursive:true,force:true}) })
const proof: HermesCleanupProof = {success:true,receiptSucceeded:true,targetVersion:'0.23.1',verifiedVersion:'0.23.1'}
const exists = async (p: string) => !!await lstat(p).catch(()=>undefined)
async function put(p: string, value = 'fixture') { await mkdir(dirname(p),{recursive:true}); await writeFile(p,value); return p }
async function fixture(platform = 'darwin-arm64') {
  const home = await realpath(await mkdtemp(join(tmpdir(),'synthetic-hermes-residue-'))); roots.push(home)
  const versions = {node:['26.7.0','26.12.1'],python:['3.14.7+20260901','3.14.9+20261021'],uv:['0.12.3','0.13.5'],npm:['12.0.1','12.0.2'],ripgrep:['14.0.0','14.1.0'],ffmpeg:['7.0','7.1'],git:['2.50.0','2.51.0']}
  const packages: Record<string,{entry:string}> = {}, old: string[] = [], current: string[] = []
  for (const [name,[before,after]] of Object.entries(versions)) {
    const entry = `${name}-${after}-${platform}`; packages[name] = {entry}
    for (const [list,v] of [[old,before],[current,after]] as const) { const p = join(home,'tools',`${name}-${v}-${platform}`); await put(join(p,'binary')); list.push(p) }
  }
  const facts = await put(join(home,'tools/facts.json'),JSON.stringify({packages}))
  const marked = await put(join(home,'bin/hermes.exe.deleteme'))
  await put(join(home,'bin/helper.deleteme'))
  const foreign = await put(join(home,'tools/user-project/keep'))
  await put(join(home,'tools/.staging/keep')); await put(join(home,'tools/node-26.7.0/keep'))
  await put(join(home,'bin/.hidden.deleteme')); await put(join(home,'bin/actual-entry'))
  return {home,facts,packages,marked,old,current,foreign}
}
it.each(['darwin-arm64','win32-x64'])('%s: success removes only unreferenced full store names and marked real files', async platform => {
  const f = await fixture(platform)
  await cleanHermesResidues(f.home,proof)
  for (const p of f.old) expect(await exists(p)).toBe(false)
  for (const p of [...f.current,f.facts,f.foreign,join(f.home,'tools/.staging'),join(f.home,'tools/node-26.7.0'),join(f.home,'bin/.hidden.deleteme'),join(f.home,'bin/actual-entry')]) expect(await exists(p)).toBe(true)
  expect(await exists(f.marked)).toBe(false); expect(await exists(join(f.home,'bin/helper.deleteme'))).toBe(false)
})
it.each(['missing','json','array','empty','missing-entry','escape','missing-dir','linked-dir','linked-facts'])('invalid facts (%s) keep every Hermes candidate, including deleteme', async mode => {
  const f = await fixture()
  if (mode === 'missing') await rm(f.facts)
  if (mode === 'json') await writeFile(f.facts,'{')
  if (mode === 'array') await writeFile(f.facts,'{"packages":[]}')
  if (mode === 'empty') await writeFile(f.facts,'{"packages":{}}')
  if (mode === 'missing-entry') await writeFile(f.facts,'{"packages":{"node":{}}}')
  if (mode === 'escape') await writeFile(f.facts,'{"packages":{"node":{"entry":"../elsewhere"}}}')
  if (mode === 'missing-dir' || mode === 'linked-dir') { await rm(f.current[0]!,{recursive:true}); if (mode === 'linked-dir') await symlink(f.old[0]!,f.current[0]!,process.platform === 'win32' ? 'junction' : 'dir') }
  if (mode === 'linked-facts') { await rm(f.facts); const outside = await put(join(f.home,'outside-facts'),JSON.stringify({packages:f.packages})); await symlink(outside,f.facts) }
  await cleanHermesResidues(f.home,proof)
  for (const p of [...f.old,f.marked]) expect(await exists(p)).toBe(true)
})
it('candidate links/junctions and links inside removed stores never affect their external targets', async () => {
  const f = await fixture(), outside = dirname(await put(join(f.home,'outside/keep')))
  await rm(f.old[0]!,{recursive:true}); await symlink(outside,f.old[0]!,process.platform === 'win32' ? 'junction' : 'dir')
  await rm(f.marked); await symlink(join(outside,'keep'),f.marked)
  await symlink(outside,join(f.old[1]!,'external'),process.platform === 'win32' ? 'junction' : 'dir')
  await cleanHermesResidues(f.home,proof)
  expect((await lstat(f.old[0]!)).isSymbolicLink()).toBe(true); expect((await lstat(f.marked)).isSymbolicLink()).toBe(true)
  expect(await readFile(join(outside,'keep'),'utf8')).toBe('fixture')
})
it('facts references conservatively protect case variants on case-insensitive installations', async () => {
  const f = await fixture(), variant = join(f.home,'tools',f.packages.node!.entry.toUpperCase())
  await mkdir(variant,{recursive:true})
  await cleanHermesResidues(f.home,proof)
  expect(await exists(variant)).toBe(true); expect(await exists(f.current[0]!)).toBe(true)
})
it.each(['.hermes-update-in-progress.lock','.hermes-update-in-progress-child','tools/.install.lock'])('live owner of %s skips all deletion', async name => {
  const f = await fixture(), output = vi.fn()
  const lock = await put(join(f.home,name),JSON.stringify({pid:process.pid}))
  expect(await hermesResidueLockState(f.home)).toBe('active')
  await withUpdateCleanup(output,()=>cleanHermesResidues(f.home,proof))
  for (const p of [...f.old,f.marked,lock]) expect(await exists(p)).toBe(true)
  expect(output.mock.calls[0]![0]).toContain('仍存活')
})
it.each(['empty','unreadable-owner','live-writer','symlink'])('ambiguous/advisory lock (%s) is never declared stale by age', async mode => {
  const f = await fixture(), path = join(f.home,'.hermes-update-in-progress.lock'), output = vi.fn()
  if (mode === 'empty') { await put(path,''); await utimes(path,new Date(0),new Date(0)) }
  if (mode === 'unreadable-owner') { await put(path,'{"pid":12345}'); vi.spyOn(process,'kill').mockImplementation(()=>{ throw Object.assign(new Error('denied'),{code:'EPERM'}) }) }
  if (mode === 'live-writer') await put(path,JSON.stringify({pid:2147483647,writer_pid:process.pid}))
  if (mode === 'symlink') await symlink(f.facts,path)
  await withUpdateCleanup(output,()=>cleanHermesResidues(f.home,proof))
  for (const p of [...f.old,f.marked,path]) expect(await exists(p)).toBe(true)
  expect(output.mock.calls[0]![0]).toContain('保留原生残留')
})
it('a recorded owner proven dead permits cleanup and leaves lock files intact', async () => {
  const f = await fixture(), lock = await put(join(f.home,'tools/.install.lock'),'{"pid":2147483647}')
  vi.spyOn(process,'kill').mockImplementation(()=>{ throw Object.assign(new Error('absent'),{code:'ESRCH'}) })
  expect(await hermesResidueLockState(f.home)).toBe('stale')
  await cleanHermesResidues(f.home,proof)
  expect(await exists(f.marked)).toBe(false); expect(await exists(lock)).toBe(true)
})
it.each([{success:false},{receiptSucceeded:false},{verifiedVersion:undefined},{verifiedVersion:'0.21.7'},{verifiedVersion:'0.24.0'}])('failed/unverified evidence %j deletes nothing', async override => {
  const f = await fixture(); await cleanHermesResidues(f.home,{...proof,...override})
  for (const p of [...f.old,f.marked]) expect(await exists(p)).toBe(true)
})
it('locked marked files stay, successful result is unchanged, other stores can be removed', async () => {
  const f = await fixture(), remove = updateCleanupIo.remove
  vi.spyOn(updateCleanupIo,'remove').mockImplementation(path => path === f.marked ? Promise.resolve(false) : remove(path))
  expect(await withUpdateCleanup(()=>{},async()=>{ afterUpdateCleanup(()=>cleanHermesResidues(f.home,proof)); return 42 })).toBe(42)
  expect(await exists(f.marked)).toBe(true); expect(await exists(f.old[0]!)).toBe(false)
})
it('facts changing during cleanup stops deletion before pruning any tool store', async () => {
  const f = await fixture(), remove = updateCleanupIo.remove
  vi.spyOn(updateCleanupIo,'remove').mockImplementation(async path => { const result = await remove(path); await writeFile(f.facts,'{}'); return result })
  await cleanHermesResidues(f.home,proof)
  for (const p of f.old) expect(await exists(p)).toBe(true)
})
it('unconfirmed managed exit skips the registered Hermes finalizer', async () => {
  const f = await fixture()
  await expect(withUpdateCleanup(()=>{},async()=>{ afterUpdateCleanup(()=>cleanHermesResidues(f.home,proof)); throw new ProcessCleanupUnconfirmedError() })).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
  expect(await exists(f.marked)).toBe(true)
})

function processBackend(raw: string, exitCode = 0, exited = true) {
  const handle = {stdout:Readable.from([raw]),stderr:Readable.from([]),done:Promise.resolve({exitCode,signal:null}),terminate:vi.fn(),waitForExit:vi.fn(async()=>exited)}
  const spawn = vi.fn(()=>handle)
  return {backend:{spawn} as unknown as ProcessBackend,spawn,handle}
}
it.each(['bin/hermes.exe','installs/id/venv/Scripts/python.exe','tools/node-26.12.1-win32-x64/node.exe'])('Windows executable inside %s is an owner regardless of its process name', async subpath => {
  const home = 'C:\\Users\\Some User\\AppData\\Local\\hermes'
  const f = processBackend(JSON.stringify([{ProcessId:10,ExecutablePath:`c:/users/SOME USER/AppData/Local/hermes/${subpath}`}]))
  expect(await hermesProcessState(home,home + '\\hermes-agent',f.backend,DEFAULT_CONFIG,'win32')).toBe('active')
  expect(f.spawn.mock.calls[0]).toBeDefined(); expect(f.handle.waitForExit).toHaveBeenCalled()
  expect(f.handle.terminate).not.toHaveBeenCalled()
})
it.each(['win32','darwin'] as const)('%s path boundaries exclude foreign names and include a separate checkout', async platform => {
  const home = platform === 'win32' ? 'C:\\Users\\u\\hermes' : '/Users/u/hermes', checkout = platform === 'win32' ? 'C:\\src\\hermes-checkout' : '/src/hermes-checkout'
  const encode = (paths: string[]) => platform === 'win32' ? JSON.stringify(paths.map((p,i)=>({ProcessId:10+i,ExecutablePath:p}))) : paths.map((p,i)=>`${10+i} S ${p}`).join('\n')
  const outside = processBackend(encode([home + '-other/bin/hermes',platform === 'win32' ? 'C:\\outside\\hermes.exe' : '/outside/hermes']))
  expect(await hermesProcessState(home,checkout,outside.backend,DEFAULT_CONFIG,platform)).toBe('stale')
  const inside = processBackend(encode([checkout + (platform === 'win32' ? '\\bin\\python.exe' : '/bin/python')]))
  expect(await hermesProcessState(home,checkout,inside.backend,DEFAULT_CONFIG,platform)).toBe('active')
})
it('an unreadable path only blocks cleanup for Hermes lock hosts (Windows system processes, macOS bare names)', async () => {
  // 2026-11-15 Windows: 16 of 346 processes (svchost, csrss, services, …) had no ExecutablePath for a normal user.
  const system = processBackend(JSON.stringify([{ProcessId:600,Name:'svchost.exe',ExecutablePath:null},{ProcessId:700,Name:'csrss.exe',ExecutablePath:null},{ProcessId:800,Name:'Registry'}]))
  expect(await hermesProcessState('C:\\home\\hermes','C:\\home\\hermes\\hermes-agent',system.backend,DEFAULT_CONFIG,'win32')).toBe('stale')
  for (const name of ['hermes.exe','python3.12.exe','pythonw.exe','uv.exe']) {
    const host = processBackend(JSON.stringify([{ProcessId:900,Name:name,ExecutablePath:null}]))
    expect(await hermesProcessState('C:\\home\\hermes','C:\\home\\hermes\\hermes-agent',host.backend,DEFAULT_CONFIG,'win32')).toBe('unknown')
  }
  const bare = processBackend(['20 S ssh','21 S node','22 S codex'].join('\n'))
  expect(await hermesProcessState('/Users/u/hermes','/Users/u/hermes/hermes-agent',bare.backend,DEFAULT_CONFIG,'darwin')).toBe('stale')
  const python = processBackend('23 S python3.12')
  expect(await hermesProcessState('/Users/u/hermes','/Users/u/hermes/hermes-agent',python.backend,DEFAULT_CONFIG,'darwin')).toBe('unknown')
})
it.each(['invalid','missing-path','failed-command','unconfirmed'] as const)('process enumeration %s cannot authorize cleanup', async mode => {
  const f = processBackend(mode === 'invalid' ? 'broken' : JSON.stringify([{ProcessId:12,Name:'python.exe',ExecutablePath:mode === 'missing-path' ? null : 'C:\\outside\\hermes.exe'}]),mode === 'failed-command' ? 1 : 0,mode !== 'unconfirmed')
  const pending = hermesProcessState('C:\\home\\hermes','C:\\home\\hermes\\hermes-agent',f.backend,DEFAULT_CONFIG,'win32')
  if (mode === 'unconfirmed') await expect(pending).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
  else expect(await pending).toBe('unknown')
})
it.each(['empty','unknown-format'] as const)('%s lock with no installation process permits cleanup without changing locks', async mode => {
  const f = await fixture(), content = mode === 'empty' ? '' : 'unknown non-PID lock format'
  const locks = await Promise.all(['.hermes-update-in-progress.lock','tools/.install.lock'].map(p=>put(join(f.home,p),content)))
  const inspect = vi.fn(async()=>{
    const snapshot = processBackend('10 S /usr/bin/other\n11 S /outside/hermes\n')
    return hermesProcessState(f.home,join(f.home,'hermes-agent'),snapshot.backend,DEFAULT_CONFIG,'darwin')
  })
  await cleanHermesResidues(f.home,proof,inspect)
  expect(await exists(f.marked)).toBe(false); expect(inspect).toHaveBeenCalled()
  for (const p of locks) expect(await readFile(p,'utf8')).toBe(content)
})
it.each(['active','unknown','throws'] as const)('empty lock with %s process evidence preserves all candidates and explains skip', async mode => {
  const f = await fixture(), output = vi.fn(); await put(join(f.home,'tools/.install.lock'),'')
  await withUpdateCleanup(output,()=>cleanHermesResidues(f.home,proof,async()=>{
    if (mode === 'throws') throw new Error('enumeration unavailable')
    const snapshot = processBackend(mode === 'active' ? `10 S ${f.home}/installs/id/venv/bin/python` : 'unreadable')
    return hermesProcessState(f.home,join(f.home,'hermes-agent'),snapshot.backend,DEFAULT_CONFIG,'darwin')
  }))
  for (const p of [...f.old,f.marked]) expect(await exists(p)).toBe(true)
  expect(output.mock.calls[0]![0]).toContain(mode === 'active' ? '进程仍存活' : '进程枚举无法核实')
})
it('PID-bearing unknown/live locks are not overridden by an empty process snapshot', async () => {
  const f = await fixture(), inspect = vi.fn(async()=> 'stale' as const), lock = join(f.home,'tools/.install.lock')
  for (const pid of [0,process.pid]) {
    await put(lock,JSON.stringify({pid})); await cleanHermesResidues(f.home,proof,inspect)
    expect(await exists(f.marked)).toBe(true)
  }
  expect(inspect).not.toHaveBeenCalled()
})

it.each(['success','stale-locks','no-receipt','wrong-target','failed','unconfirmed'] as const)('service integration: %s uses post-update verification and never a Hermes version command', async mode => {
  const files = await fixture(), f = serviceFixture(['hermes']); services.push(f)
  vi.stubEnv('HERMES_HOME',files.home)
  // The service watches package-cache activity after a receipt. Keep those
  // filesystem observations inside the fixture too: the real user caches can
  // contain thousands of files and turn a simulated update into a host scan.
  vi.stubEnv('npm_config_cache', join(f.root, 'npm-cache'))
  vi.stubEnv('PNPM_HOME', join(f.root, 'pnpm-home'))
  const caches = await Promise.all([
    put(join(f.root, 'npm-cache/simulated-package')),
    put(join(f.root, 'pnpm-home/store/simulated-package')),
  ])
  if (mode === 'stale-locks') { await put(join(files.home,'.hermes-update-in-progress.lock'),''); await put(join(files.home,'tools/.install.lock'),'') }
  await mkdir(join(files.home,'hermes-agent'),{recursive:true}); await mkdir(join(files.home,'logs/update_receipts'),{recursive:true})
  const identity = {executable:join(files.home,'bin/hermes'),source:'self-update' as const,updateRoot:join(files.home,'hermes-agent'),manifestVersion:'0.21.7',fingerprint:{realpath:join(files.home,'bin/hermes'),size:4,mtimeMs:1}}
  f.identities.set('hermes',identity)
  vi.spyOn(f.releases,'native').mockResolvedValue({latest:'0.23.1',versions:['0.23.1'],checkedAt:Date.now(),registry:'https://api.github.com/repos/NousResearch/hermes-agent/releases/latest'})
  vi.mocked(f.backend.spawn).mockImplementation(options => {
    expect(options.argv).not.toContain('--version')
    if (options.argv[0] === '/bin/ps' || options.argv[0] === 'powershell.exe') {
      expect(mode).toBe('stale-locks')
      return processBackend(process.platform === 'win32' ? '[{"ProcessId":10,"ExecutablePath":"C:/outside/hermes.exe"}]' : '10 S /outside/hermes').handle
    }
    expect(options.argv).toContain('update')
    if (mode !== 'no-receipt') writeFileSync(join(files.home,'logs/update_receipts/latest.json'),JSON.stringify({outcome:'success',post_update:{version:mode === 'wrong-target' ? '0.21.7' : '0.23.1'}}))
    if (mode !== 'failed') f.identities.set('hermes',{...identity,manifestVersion:'0.23.1'})
    return {stdout:Readable.from([]),stderr:Readable.from([]),done:Promise.resolve({exitCode:mode === 'failed' ? 2 : 0,signal:null}),terminate:vi.fn(),waitForExit:vi.fn(async()=>mode !== 'unconfirmed')}
  })
  await checked(f.service)
  const entry = f.service.snapshot().entries.find(e=>e.cli === 'hermes')!
  f.service.start('hermes','update',entry.planToken!,'','synthetic-hermes-cleanup')
  const result = (await finished(f.service)).results.at(-1)!
  expect(result.phase).toBe(mode === 'failed' ? 'failed' : mode === 'unconfirmed' ? 'cleanup-unconfirmed' : 'succeeded')
  expect(await exists(files.marked)).toBe(mode !== 'success' && mode !== 'stale-locks')
  for (const p of files.current) expect(await exists(p)).toBe(true)
  for (const p of caches) expect(await readFile(p, 'utf8')).toBe('fixture')
})
