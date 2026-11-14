import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { removeTemporaryTree, markTemporaryTreeActive, prepareOmpNativesDirectory, pruneOmpNativesDirectory } from '../src/host/temporary-tree.mjs'
import { startTemporaryTreeMaintenance, sweepTemporaryTreesThrottled, sweepTemporaryTrees } from '../src/host/temporary-sweep.ts'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'synthetic-temp-cleanup-')); roots.push(root); return root }
async function old(path: string) { await mkdir(path, {recursive: true}); await utimes(path, new Date(0), new Date(0)); return path }

describe('temporary cleanup with simulated Windows locks', () => {
  it('Node rm retries EBUSY/EPERM/ENOTEMPTY and contains persistent cleanup failure', async () => {
    const root = await fixture()
    // Node caches its rimraf fs functions on first use: keep one fault injector
    // for the whole sequence rather than replacing it between scenarios.
    const fs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs')
    const original = fs.rmdir
    let target = '', code = '', failures = 0
    vi.spyOn(fs, 'rmdir').mockImplementation(((path: any, ...args: any[]) => {
      if (String(path) === target && (failures++ === 0 || code === 'EACCES'))
        return args.at(-1)(Object.assign(new Error('synthetic Windows lock'), {code}))
      return (original as any)(path, ...args)
    }) as typeof fs.rmdir)
    try {
      for (code of ['EBUSY', 'EPERM', 'ENOTEMPTY']) {
        target = await old(join(root, code)); failures = 0
        expect(await removeTemporaryTree(target)).toBe(true)
        expect(failures).toBeGreaterThan(1)
        await expect(stat(target)).rejects.toMatchObject({code:'ENOENT'})
      }
      code = 'EACCES'; target = await old(join(root,'denied')); failures = 0
      expect(await removeTemporaryTree(target)).toBe(false)
    } finally { target = '' }
  })
})

it('sweeps only old owned real directories, skips live owners, links, young and foreign names', async () => {
  const root = await fixture(), state = join(root,'state'), temp = join(root,'tmp')
  await mkdir(temp)
  const removed = [await old(join(temp,'cliworker-omp-identity-old')),await old(join(temp,'cliworker-login-options-old')),
    await old(join(temp,'cliworker-qodercn-metadata-old')),await old(join(temp,'cwn-old')),await old(join(temp,'dshwb-old')),
    await old(join(state,'catalog','omp','query-old'))]
  const foreign = await old(join(temp,'foreign-old')), unlisted = await old(join(temp,'cliworker-user-project'))
  const target = await old(join(root,'target')); await writeFile(join(target,'keep'),'untouched')
  const linked = join(temp,'cliworker-omp-identity-link'); await symlink(target,linked,process.platform === 'win32' ? 'junction' : 'dir')
  await symlink(target,join(state,'catalog','linked-cli'),process.platform === 'win32' ? 'junction' : 'dir')
  const young = join(temp,'cliworker-login-options-young'); await mkdir(young)
  const active = await old(join(temp,'cwn-active')); markTemporaryTreeActive(active); await utimes(active,new Date(0),new Date(0))
  const file = join(temp,'cwn-file'); await writeFile(file,'keep'); await utimes(file,new Date(0),new Date(0))
  await sweepTemporaryTrees(state,{temporaryRoot:temp})
  for (const path of removed) await expect(stat(path)).rejects.toMatchObject({code:'ENOENT'})
  for (const path of [foreign,unlisted,target,linked,young,active,file]) expect(await stat(path)).toBeDefined()
  expect(await readdir(target)).toEqual(['keep'])
})

it('also sweeps the separate ZCode scratch root (macOS /tmp) for cwn- trees only', async () => {
  const root = await fixture(), state = join(root,'state'), temp = join(root,'tmp'), zcode = join(root,'zcode-tmp')
  await mkdir(temp); await mkdir(zcode)
  const scratch = await old(join(zcode,'cwn-old')), other = await old(join(zcode,'cliworker-login-options-old'))
  await sweepTemporaryTrees(state,{temporaryRoot:temp,zcodeTemporaryRoot:zcode})
  await expect(stat(scratch)).rejects.toMatchObject({code:'ENOENT'})
  expect(await stat(other)).toBeDefined()
})

it('does not enter a linked catalog or scan after cancellation', async () => {
  const root = await fixture(), state = join(root,'state'), temp = join(root,'tmp'), target = join(root,'external')
  await mkdir(state); await mkdir(temp)
  const query = await old(join(target,'omp','query-old'))
  await symlink(target,join(state,'catalog'),process.platform === 'win32' ? 'junction' : 'dir')
  await sweepTemporaryTrees(state,{temporaryRoot:temp})
  expect(await stat(query)).toBeDefined()
  const preserved = await old(join(temp,'cwn-aborted'))
  await sweepTemporaryTrees(state,{temporaryRoot:temp,signal:AbortSignal.abort()})
  expect(await stat(preserved)).toBeDefined()
})

it('shares a private native cache and prunes only old versions beyond the newest three', async () => {
  const root = await fixture(), cache = await prepareOmpNativesDirectory(root)
  expect(await prepareOmpNativesDirectory(root)).toBe(cache)
  if (process.platform !== 'win32') expect((await stat(cache)).mode & 0o777).toBe(0o700)
  for (const version of ['1.0.0','2.0.0','9.0.0','10.0.0','11.0.0']) await old(join(cache,version))
  await mkdir(join(cache,'0.5.0')) // young: retain even though outside cap
  const external = await old(join(root,'external'))
  await symlink(external,join(cache,'0.1.0'),process.platform === 'win32' ? 'junction' : 'dir')
  await pruneOmpNativesDirectory(root)
  expect((await readdir(cache)).sort()).toEqual(['0.1.0','0.5.0','10.0.0','11.0.0','9.0.0'])
  expect(await stat(external)).toBeDefined()
})

it('Host maintenance is non-blocking, coalesces sweeps and joins on close', async () => {
  const root = await fixture(), state = join(root,'state'), temp = join(root,'tmp')
  const removed = await old(join(temp,'cliworker-omp-identity-old'))
  const maintenance = startTemporaryTreeMaintenance(state,temp)
  expect(typeof maintenance.close).toBe('function')
  const first = sweepTemporaryTreesThrottled(state)
  expect(sweepTemporaryTreesThrottled(state)).toBe(first)
  await first
  await expect(stat(removed)).rejects.toMatchObject({code:'ENOENT'})
  const deferred = await old(join(temp,'cliworker-omp-identity-next'))
  await sweepTemporaryTreesThrottled(state)
  expect(await stat(deferred)).toBeDefined() // throttled
  await maintenance.close()
})
