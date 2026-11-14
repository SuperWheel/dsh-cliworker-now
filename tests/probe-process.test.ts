import { afterEach, expect, it, vi } from 'vitest'
import { lstat, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { spawnProbe } from '../src/host/probe-process.ts'
import { captureCatalogMetadata } from '../src/host/adapters.ts'
import { captureReadOnly } from '../src/host/cli-management/versions.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import { spawnManagedAgent } from '../src/host/managed-agent.ts'
import { executeCliOperation } from '../src/host/cli-management/executor.ts'

const roots: string[] = []
const originalPlatform = Object.getOwnPropertyDescriptor(process,'platform')!
afterEach(async () => {
  Object.defineProperty(process,'platform',originalPlatform)
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(path => rm(path,{recursive:true,force:true})))
})
const windows = () => Object.defineProperty(process,'platform',{...originalPlatform,value:'win32'})
function fixture(exited = true, exitCode = 0) {
  const child = { stdout: Readable.from(['synthetic output']), stderr: Readable.from([]),
    done: Promise.resolve({exitCode,signal:null}), terminate: vi.fn(), waitForExit: vi.fn(async () => exited) }
  const spawn = vi.fn((spec: any) => { if (spec.env?.TEMP?.includes('cliworker-probe-')) roots.push(spec.env.TEMP); return child })
  return {child,spawn,backend:{spawn} as unknown as ProcessBackend}
}
const spec = {argv:['synthetic-cli','--version'],cwd:'.',env:{HTTPS_PROXY:'http://proxy.test',https_proxy:'http://lower.test',NO_PROXY:'local',Temp:'inherited',TMP:'old'}}
it('simulated Windows query owns TMP/TEMP until range exit, including DLLs and owner marker', async () => {
  const f = fixture(), child = await spawnProbe(f.backend,spec,'win32'), env = f.spawn.mock.calls[0]![0].env
  expect(env).toMatchObject({HTTPS_PROXY:spec.env.HTTPS_PROXY,https_proxy:spec.env.https_proxy,NO_PROXY:'local'})
  expect(env.TMP).toBe(env.TEMP); expect(env.Temp).toBeUndefined()
  expect(spec.env.Temp).toBe('inherited')
  await writeFile(join(env.TEMP,'.1234567890abcdef-00000000.dll'),'synthetic DLL')
  expect(await readdir(env.TEMP)).toContain(`.cliworker-owner-${process.pid}`)
  await child.done
  expect(await lstat(env.TEMP)).toBeDefined() // root exit alone never authorizes deletion
  expect(await child.waitForExit()).toBe(true)
  await expect(lstat(env.TEMP)).rejects.toMatchObject({code:'ENOENT'})
})
it.each(['false','throw'] as const)('unconfirmed range %s preserves directory and live owner marker', async failure => {
  const f = fixture(false)
  if (failure === 'throw') f.child.waitForExit.mockRejectedValue(new Error('unconfirmed'))
  const child = await spawnProbe(f.backend,spec,'win32'), root = roots.at(-1)!
  if (failure === 'throw') await expect(child.waitForExit()).rejects.toThrow('unconfirmed')
  else expect(await child.waitForExit()).toBe(false)
  expect(await readdir(root)).toContain(`.cliworker-owner-${process.pid}`)
})
it('spawn failure removes the private directory and preserves the error', async () => {
  const f = fixture(), error = new Error('spawn failed')
  f.spawn.mockImplementation((s:any) => { roots.push(s.env.TEMP); throw error })
  await expect(spawnProbe(f.backend,spec,'win32')).rejects.toBe(error)
  await expect(lstat(roots.at(-1)!)).rejects.toMatchObject({code:'ENOENT'})
})
it.each(['catalog','version'] as const)('%s capture uses private Windows TEMP on success, failure and unconfirmed exit', async kind => {
  windows()
  for (const [exited,code] of [[true,0],[true,1],[false,0]] as const) {
    const f = fixture(exited,code), signal = new AbortController().signal
    const result = kind === 'catalog'
      ? captureCatalogMetadata(f.backend,DEFAULT_CONFIG,['synthetic-cli'],'/',signal,spec.env)
      : captureReadOnly(f.backend,DEFAULT_CONFIG,['synthetic-cli'],signal,false,spec.env)
    if (!exited) await expect(result).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
    else if (code) await expect(result).rejects.toThrow()
    else expect(await result).toBe('synthetic output')
    const root = roots.at(-1)!
    if (exited) await expect(lstat(root)).rejects.toMatchObject({code:'ENOENT'})
    else expect(await readdir(root)).toContain(`.cliworker-owner-${process.pid}`)
  }
})
it('POSIX probes, Windows Worker launches and official update executor keep their existing environment', async () => {
  const posix = fixture(); await spawnProbe(posix.backend,spec,'darwin')
  expect(posix.spawn.mock.calls[0]![0].env).toBe(spec.env)
  windows()
  const worker = fixture(); await spawnManagedAgent(worker.backend,spec)
  expect(worker.spawn.mock.calls[0]![0].env).toBe(spec.env)
  const update = fixture(); await executeCliOperation(update.backend,DEFAULT_CONFIG,['synthetic-cli','update'],new AbortController().signal,()=>{},1000,spec.env)
  expect(update.spawn.mock.calls[0]![0].env).toBe(spec.env)
  expect(roots).toEqual([])
})
