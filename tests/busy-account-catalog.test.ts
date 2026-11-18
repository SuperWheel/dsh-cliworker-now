import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CliWorkerService } from '../src/host/index.ts'
import { SettingsCatalogCache } from '../src/host/settings-catalog-cache.ts'
import { OWN_ACCOUNT_BUSY } from '../src/host/own-account-lease.mjs'
import type { Catalog } from '../src/host/adapters.ts'

// Synthetic catalogs and accounts. The OMP account lease is simulated as busy; no CLI runs.
const state = vi.hoisted(() => ({ binding: 'synthetic-account-a', busyCalls: 0, calls: 0, error: '' }))
vi.mock('../src/host/cli-account-binding.ts', () => ({ readCliAccountBinding: async () => state.binding }))
vi.mock('../src/host/authorized-catalog.ts', async (actual) => ({
  ...(await actual<typeof import('../src/host/authorized-catalog.ts')>()),
  authorizedCatalog: async (cli: string) => {
    state.calls++
    if (state.error) throw new Error(state.error)
    if (state.busyCalls-- > 0) throw new Error(OWN_ACCOUNT_BUSY)
    return { binding: state.binding, catalog: { cli, models: [{ id: 'fresh', label: 'Fresh', efforts: ['default'] }], notice: '' } }
  },
  authorizeSelection: async (preference: { cli: string; model: string }) => {
    state.calls++
    if (state.busyCalls-- > 0) throw new Error(OWN_ACCOUNT_BUSY)
    return { binding: state.binding, catalog: { cli: preference.cli, models: [], notice: '' }, preference }
  },
}))
const cleanup: (() => void)[] = []
afterEach(() => {
  for (const close of cleanup.splice(0)) close()
  Object.assign(state, { binding: 'synthetic-account-a', busyCalls: 0, calls: 0, error: '' })
})
function service() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-busy-catalog-')))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const cache = new SettingsCatalogCache(root)
  const service: any = Object.create(CliWorkerService.prototype)
  Object.assign(service['host'], { settingsCatalogs: cache, runtime: { blockCatalogOnCleanup: vi.fn() }, backend: {}, options: {} })
  const remember = (binding: string) =>
    cache.remember(root, { binding, catalog: { cli: 'omp', models: [{ id: 'cached', label: 'Cached', efforts: ['default'] }], notice: '' } satisfies Catalog }, cache.revision('omp'))
  const query = (expected?: string) => service['host'].queryCatalog('omp', {}, {}, root, new AbortController().signal, expected)
  return { remember, query, select: (model: string) => service['host'].querySelection({ cli: 'omp', model, effort: 'default' }, {}, {}, root, new AbortController().signal) }
}

it('a busy account dispatches from its own last verified catalog without waiting for the holder', async () => {
  const f = service()
  f.remember('synthetic-account-a')
  state.busyCalls = 1
  const started = Date.now()
  expect((await f.query()).catalog.models.map((model: { id: string }) => model.id)).toEqual(['cached'])
  expect(Date.now() - started).toBeLessThan(500)
  state.busyCalls = 1
  expect((await f.select('cached')).preference.model).toBe('cached')
})

it('another account’s saved catalog is never used; a short holder is waited for instead', async () => {
  const f = service()
  f.remember('synthetic-account-b')
  state.busyCalls = 1
  expect((await f.query()).catalog.models.map((model: { id: string }) => model.id)).toEqual(['fresh'])
  expect(state.calls).toBe(2)
})

it('a changed account fails closed instead of using any saved catalog', async () => {
  const f = service()
  f.remember('synthetic-account-a')
  state.busyCalls = 1
  await expect(f.query('synthetic-account-old')).rejects.toThrow('账号已变更')
})

it('other catalog failures still fail even when a saved catalog exists', async () => {
  const f = service()
  f.remember('synthetic-account-a')
  state.error = '请先登录 OMP'
  await expect(f.query()).rejects.toThrow('请先登录 OMP')
  expect(state.calls).toBe(1)
})
