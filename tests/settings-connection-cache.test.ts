/** 模拟：只有内存状态、模拟时钟和受控 Promise，不使用真实账号或 CLI。 */
import { afterEach, expect, it, vi } from 'vitest'
import { SettingsConnectionCache, CONNECTION_TTL } from '../src/host/settings-connection-cache.ts'
import { CliPreloader } from '../src/host/cli-management/preload.ts'
import { BACKGROUND_ACCOUNT_CLIS, BACKGROUND_CATALOG_CLIS } from '../src/host/cli-management/sources.ts'
import type { AccountStatus } from '../src/shared/accounts.ts'
const caches: SettingsConnectionCache[] = []
const signal = () => new AbortController().signal
const account: AccountStatus = { cli: 'zcode', installed: true, state: 'authenticated', verification: 'local', summary: '模拟账号原摘要', actions: [{ id: 'login', label: '模拟', description: '模拟' }], logins: [{ providerLabel: '模拟', authMethod: 'oauth', id: 'opaque-action' }] }
const catalog = { catalog: { cli: 'zcode' as const, models: [{ id: 'simulated', label: '模拟', efforts: ['low' as const, 'high' as const] }], notice: '模拟目录' }, binding: 'private-binding' }
function fixture() { const cache = new SettingsConnectionCache(); caches.push(cache); return cache }
afterEach(async () => { await Promise.all(caches.splice(0).map(c => c.close())); vi.useRealTimers() })
it('模拟：账号与模型命中不启动查询，按 CLI 存一份且不含项目，快照去除动作句柄和 binding', async () => {
  const cache = fixture(), load = vi.fn(async () => account), models = vi.fn(async () => catalog)
  await cache.read('zcode', 'account', signal(), load)
  await cache.read('zcode', 'catalog', signal(), models)
  await cache.read('zcode', 'account', signal(), load)
  await cache.read('zcode', 'catalog', signal(), models)
  expect(load).toHaveBeenCalledTimes(1); expect(models).toHaveBeenCalledTimes(1)
  expect(cache.fresh('codex', 'account')).toBeUndefined()
  const status = cache.status('zcode')
  expect(status.account.value).toMatchObject({ summary: account.summary, state: 'authenticated', actions: [] })
  expect(status.account.cache).toMatchObject({ checkedAt: expect.any(Number), revision: 0, stale: false })
  expect(JSON.stringify(cache.snapshot())).not.toContain('"project"')
  expect(JSON.stringify(status)).not.toMatch(/opaque-action|private-binding/)
  expect(status.catalog.value?.models[0]?.efforts).toEqual(['low', 'high'])
  expect(new SettingsConnectionCache().fresh('zcode', 'account')).toBeUndefined()
})
it('模拟：10 分钟到期先显示 unknown，重查后恢复；时钟回拨也过期', async () => {
  vi.useFakeTimers(); const cache = fixture(), load = vi.fn(async () => account)
  await cache.read('zcode', 'account', signal(), load)
  const now = Date.now(); vi.setSystemTime(now + CONNECTION_TTL)
  expect(cache.status('zcode').account).toMatchObject({ value: { state: 'unknown' }, cache: { stale: true } })
  await cache.read('zcode', 'account', signal(), load)
  expect(load).toHaveBeenCalledTimes(2)
  expect(cache.status('zcode').account.value?.state).toBe('authenticated')
  vi.setSystemTime(now - 1)
  expect(cache.status('zcode').account.cache?.stale).toBe(true)
})
it('模拟：未核实登录不会变绿；刷新失败不保留旧登录', async () => {
  const cache = fixture()
  await cache.read('zcode', 'account', signal(), async () => ({ ...account, verification: undefined }))
  expect(cache.status('zcode').account.value?.state).toBe('unknown')
  await expect(cache.read('zcode', 'account', signal(), async () => { throw new Error('模拟 failure') }, true)).rejects.toThrow()
  expect(cache.status('zcode').account).toMatchObject({ loading: false, error: expect.any(String) })
  expect(cache.status('zcode').account.value).toBeUndefined()
})
it('模拟：读取失败在快照中保留真实原因，不带错误类名，空原因才用通用文案', async () => {
  const cache = fixture()
  class SimulatedAccountError extends Error { name = 'SimulatedAccountError' }
  const reason = '模拟：返回的 16 个模型在当前账号下均为停用状态'
  await expect(cache.read('qoder', 'catalog', signal(), async () => { throw new SimulatedAccountError(reason) })).rejects.toThrow(reason)
  expect(cache.status('qoder').catalog).toEqual({ loading: false, error: reason, value: undefined, cache: undefined })
  expect(cache.snapshot().entries.find(entry => entry.cli === 'qoder')?.catalog.error).toBe(reason)
  expect(cache.fresh('qoder', 'catalog')).toBeUndefined()
  await expect(cache.read('qoder', 'catalog', signal(), async () => { throw new Error('  ') }, true)).rejects.toThrow()
  expect(cache.status('qoder').catalog.error).toBe('连接状态读取失败，请刷新重试')
  await expect(cache.read('qoder', 'catalog', signal(), async () => { throw new Error('模'.repeat(5000)) }, true)).rejects.toThrow()
  expect(cache.status('qoder').catalog.error).toHaveLength(1024)
  // A later successful read clears the reason.
  await cache.read('qoder', 'catalog', signal(), async () => ({ ...catalog, catalog: { ...catalog.catalog, cli: 'qoder' as const } }), true)
  expect(cache.status('qoder').catalog).toMatchObject({ loading: false, error: undefined, value: { models: [{ efforts: ['low', 'high'] }] } })
})
it('模拟：并发请求复用一次读取，作废等待旧清理后重查且旧结果不能回填', async () => {
  const cache = fixture(); let finish!: (value: AccountStatus) => void, active!: AbortSignal
  const load = vi.fn((control: AbortSignal) => { active = control; return new Promise<AccountStatus>(resolve => { finish = resolve }) })
  const first = cache.read('zcode', 'account', signal(), load)
  const rejected = expect(first).rejects.toThrow()
  await Promise.resolve(); cache.invalidate('zcode'); expect(active.aborted).toBe(true)
  const freshLoad = vi.fn(async () => ({ ...account, state: 'unconfigured' as const }))
  const next = cache.read('zcode', 'account', signal(), freshLoad)
  await Promise.resolve(); expect(freshLoad).not.toHaveBeenCalled()
  finish(account); await rejected; await next
  expect(cache.status('zcode').account).toMatchObject({ value: { state: 'unconfigured' }, cache: { revision: 1 } })
})
it('模拟：强制刷新排在正在读取之后，订阅发布变化并在取消后清理', async () => {
  const cache = fixture(), watch = new AbortController(), stream = cache.watch(watch.signal)
  expect((await stream.next()).value?.entries).toHaveLength(17)
  let finish!: (value: AccountStatus) => void
  const first = cache.read('zcode', 'account', signal(), () => new Promise(resolve => { finish = resolve }))
  await Promise.resolve()
  const update = await stream.next(); expect(update.value?.entries.find(e => e.cli === 'zcode')?.account.loading).toBe(true)
  const refresh = vi.fn(async () => ({ ...account, state: 'unconfigured' as const }))
  const second = cache.read('zcode', 'account', signal(), refresh, true)
  finish(account); await first; await second
  expect(refresh).toHaveBeenCalledTimes(1)
  expect((await stream.next()).value?.entries.find(e => e.cli === 'zcode')?.account.value?.state).toBe('unconfigured')
  const pending = stream.next(); watch.abort(); expect((await pending).done).toBe(true)
})
it('模拟：Host 关闭中止查询并等待清理，不复用上次 Host 的状态', async () => {
  const cache = fixture(); let finish!: (value: AccountStatus) => void, active!: AbortSignal
  const pending = cache.read('zcode', 'account', signal(), control => { active = control; return new Promise(resolve => { finish = resolve }) })
  const rejected = expect(pending).rejects.toThrow(); await Promise.resolve()
  let closed = false; const closing = cache.close().then(() => { closed = true })
  expect(active.aborted).toBe(true); await Promise.resolve(); expect(closed).toBe(false)
  finish(account); await rejected; await closing; expect(closed).toBe(true)
})
it('模拟：后台允许原生初始化与续期，排除会话和交互查询', () => {
  expect(BACKGROUND_ACCOUNT_CLIS).toEqual(['codex', 'claude', 'kimi', 'mimo', 'grok', 'omp', 'pi', 'hermes', 'opencode', 'zcode', 'codebuddy'])
  expect(BACKGROUND_CATALOG_CLIS).toEqual(['codex', 'claude', 'kimi', 'mimo', 'grok', 'omp', 'pi', 'hermes', 'opencode', 'zcode'])
})
it.each(['任务', '登录窗口'])('模拟：%s 打断后台，确认清理后 30 秒空闲重试，结束无计时器', async () => {
  vi.useFakeTimers(); let idle = true, n = 0, finish!: () => void, active!: AbortSignal
  const run = vi.fn((control: AbortSignal) => { active = control; return run.mock.calls.length === 1 ? new Promise<void>(resolve => { finish = resolve }) : Promise.resolve() })
  const preloader = new CliPreloader({ items: [{ run }], idle: () => idle, enabled: () => true, sample: () => [{ model: '模拟', speed: 0, times: { idle: ++n * 80, user: n * 20, sys: 0, nice: 0, irq: 0 } }] })
  try {
    preloader.start(); await vi.advanceTimersByTimeAsync(62_000)
    idle = false; preloader.changed(); expect(active.aborted).toBe(true)
    idle = true; preloader.changed(); await vi.advanceTimersByTimeAsync(40_000); expect(run).toHaveBeenCalledTimes(1)
    finish(); await vi.advanceTimersByTimeAsync(29_999); expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4001); expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2_000)
    const late = vi.fn(async () => {}); preloader.enqueue([{ run: late }]); await vi.advanceTimersByTimeAsync(4_000)
    expect(late).toHaveBeenCalledTimes(1)
  } finally { finish?.(); await preloader.close() }
  expect(vi.getTimerCount()).toBe(0)
})

it('模拟：后登记的项在版本后、发布源前执行，不打乱正在读取的项', async () => {
  vi.useFakeTimers(); let n = 0; const seen: string[] = []
  const item = (name: string) => ({ run: async () => { seen.push(name) } })
  const preloader = new CliPreloader({ items: [item('path'), item('version'), item('release')], idle: () => true,
    enabled: () => true, sample: () => [{ model: '模拟', speed: 0, times: { idle: ++n * 80, user: n * 20, sys: 0, nice: 0, irq: 0 } }] })
  try {
    preloader.start(); preloader.enqueue([item('account')], 2); preloader.enqueue([item('catalog')])
    await vi.advanceTimersByTimeAsync(85_000)
    expect(seen).toEqual(['path', 'version', 'account', 'release', 'catalog'])
  } finally { await preloader.close() }
})

it('模拟：同 CLI 的账号与目录排队，Host 关闭等待首项清理且不启动排队目录', async () => {
  const cache = fixture(); let finish!: (value: AccountStatus) => void
  const first = cache.read('zcode', 'account', signal(), () => new Promise(resolve => { finish = resolve }))
  const firstRejected = expect(first).rejects.toThrow()
  await Promise.resolve()
  const models = vi.fn(async () => catalog)
  const queued = cache.read('zcode', 'catalog', signal(), models)
  const queuedRejected = expect(queued).rejects.toThrow()
  await Promise.resolve(); expect(models).not.toHaveBeenCalled()
  let closed = false
  const closing = cache.close().then(() => { closed = true })
  await Promise.resolve(); expect(closed).toBe(false)
  finish(account); await Promise.all([firstRejected, queuedRejected, closing])
  expect(closed).toBe(true); expect(models).not.toHaveBeenCalled()
  expect(cache.status('zcode').catalog.value).toBeUndefined()
})

it.each(['account', 'catalog'] as const)('模拟：维护期 %s 被拒时清除旧错误、不缓存红点，释放后可重新读取', async kind => {
  const cache = fixture(), { MaintenanceError } = await import('../src/host/cli-management/maintenance.ts')
  await expect(cache.read('zcode', kind, signal(), async () => { throw new Error('模拟旧错误') })).rejects.toThrow('模拟旧错误')
  expect(cache.status('zcode')[kind].error).toBe('模拟旧错误')
  await expect(cache.read('zcode', kind, signal(), async () => { throw new MaintenanceError('zcode') }, true)).rejects.toMatchObject({ code: 'MAINTENANCE' })
  expect(cache.status('zcode')[kind]).toMatchObject({ value: undefined, error: undefined, loading: false, cache: undefined })
  await cache.read('zcode', kind, signal(), async () => kind === 'account' ? account : catalog)
  expect(cache.status('zcode')[kind].value).toBeDefined()
})
