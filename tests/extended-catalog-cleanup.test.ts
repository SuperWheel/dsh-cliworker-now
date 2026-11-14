import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile, utimes } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { sweepTemporaryTrees } from '../src/host/temporary-sweep.ts'
import { extendedCatalog } from '../src/host/extended-adapters.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError } from '../src/host/process.ts'

const ownHome = vi.hoisted(() => ({ path: '', denyCleanup: false }))
vi.mock('node:fs/promises', async load => {
  const fs = await load<typeof import('node:fs/promises')>()
  return { ...fs, rm: async (...args: Parameters<typeof fs.rm>) => {
    if (ownHome.denyCleanup && /[\\/]query-[^\\/]+$/.test(String(args[0])))
      throw Object.assign(new Error('synthetic locked tree'), {code:'EBUSY'})
    return fs.rm(...args)
  } }
})
vi.mock('node:os', async (load) => ({
  ...(await load<typeof import('node:os')>()),
  homedir: () => ownHome.path,
}))
const roots: string[] = []
afterEach(async () => {
  ownHome.denyCleanup = false;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  ownHome.path = ''
})
async function fixture(cli: 'pi' | 'omp') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cwn-cat-')))
  roots.push(root)
  ownHome.path = join(root, 'home')
  const native = join(ownHome.path, cli === 'pi' ? '.pi' : '.omp', 'agent')
  await mkdir(native, { recursive: true })
  const source = join(native, cli === 'pi' ? 'models.json' : 'models.yml')
  const original = JSON.stringify({ providers: { synthetic: { apiKey: 'synthetic-key-only', models: [] } } })
  await writeFile(source, original)
  const state = join(root, 'state')
  return { state, source, original }
}
const choices = [{ id: 'synthetic/model', label: 'Synthetic model', efforts: ['low', 'high'] }]

// Real snapshot and two-phase adapter flow; only native capture results and
// process-cleanup completion are simulated. No installed CLI or account is read.
describe.each(['pi', 'omp'] as const)('%s successful catalog directory lifecycle', (cli) => {
  it('keeps query files until capture cleanup completes, then removes only that query', async () => {
    const f = await fixture(cli)
    let release!: () => void
    const cleanup = new Promise<void>((resolve) => {
      release = resolve
    })
    let query = ''
    let nativeCache = ''
    let phases = 0
    const capture = async (argv: string[], env?: Record<string, string>) => {
      const request = JSON.parse(await readFile(argv.at(-1)!, 'utf8'))
      query = dirname(dirname(request.stateDirectory))
      if (cli === 'omp') expect(env?.PI_NATIVES_DIR).toBe(join(f.state, 'omp-natives'))
      else expect(env?.PI_NATIVES_DIR).toBeUndefined()
      phases++
      if (request.metadataPhase === 'native-candidates') {
        nativeCache = join(query, 'synthetic-native-cache.node')
        await writeFile(nativeCache, 'synthetic extracted native module')
        return JSON.stringify({ phase: 'native-candidates', count: 1 })
      }
      await cleanup
      return JSON.stringify(choices)
    }
    const result = extendedCatalog(cli, 'synthetic-cli', capture, f.state, DEFAULT_CONFIG)
    await vi.waitFor(() => expect(phases).toBe(2))
    expect(await readFile(nativeCache, 'utf8')).toBe('synthetic extracted native module')
    const sibling = join(dirname(query), 'query-other-owned-operation')
    await mkdir(sibling)
    await writeFile(join(sibling, 'active'), 'synthetic concurrent query')
    release()
    expect(await result).toEqual(choices)
    await expect(readdir(query)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(sibling, 'active'), 'utf8')).toBe('synthetic concurrent query')
    expect(await readFile(f.source, 'utf8')).toBe(f.original)
  })

  it.each(['failed', 'cleanup-unconfirmed'] as const)(
    'cleans confirmed failure but preserves unconfirmed query and own account on %s capture',
    async (kind) => {
      const f = await fixture(cli)
      let ownedFile = ''
      const failure =
        kind === 'cleanup-unconfirmed'
          ? new ProcessCleanupUnconfirmedError()
          : new Error('Synthetic native capture failure')
      const capture = async (argv: string[]) => {
        const request = JSON.parse(await readFile(argv.at(-1)!, 'utf8'))
        ownedFile = join(request.stateDirectory, 'still-used-by-capture')
        await writeFile(ownedFile, 'synthetic still-owned state')
        throw failure
      }
      const result = extendedCatalog(cli, 'synthetic-cli', capture, f.state, DEFAULT_CONFIG)
      if (kind === 'cleanup-unconfirmed') await expect(result).rejects.toBe(failure)
      else await expect(result).rejects.toThrow('无法读取 Pi/OMP 原生模型目录')
      if (kind === 'cleanup-unconfirmed') expect(await readFile(ownedFile, 'utf8')).toBe('synthetic still-owned state')
      else await expect(readFile(ownedFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(f.source, 'utf8')).toBe(f.original)
    },
  )
})

it('a locked catalog tree does not override a successful model result', async () => {
  const f = await fixture('omp')
  ownHome.denyCleanup = true
  const result = await extendedCatalog('omp', 'synthetic-cli', async argv => {
    const request = JSON.parse(await readFile(argv.at(-1)!, 'utf8'))
    return JSON.stringify(request.metadataPhase === 'native-candidates' ? {phase:'native-candidates',count:1} : choices)
  }, f.state, DEFAULT_CONFIG)
  expect(result).toEqual(choices)
  const queries = await readdir(join(f.state,'catalog','omp'))
  expect(queries).toHaveLength(1)
  const query = join(f.state,'catalog','omp',queries[0]!)
  expect(await readdir(query)).not.toContain(`.cliworker-owner-${process.pid}`)
  await utimes(query,new Date(0),new Date(0))
  await sweepTemporaryTrees(f.state,{temporaryRoot:join(f.state,'no-system-temp')})
  expect(await readdir(query)).toBeDefined() // still locked: skip without throwing
  ownHome.denyCleanup = false
  await sweepTemporaryTrees(f.state,{temporaryRoot:join(f.state,'no-system-temp')})
  await expect(readdir(query)).rejects.toMatchObject({code:'ENOENT'})
})
