import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  ACTIVATION_WATCH_MS,
  DISPOSAL_WATCH_MS,
  RELOAD_GAP_MS,
  crashedRoot,
  hostRootRemount,
  installRootRecovery,
  recoverCrashedRoot,
  renderRestartNotice,
  type RootRecoveryEnv,
} from '../src/client/root-recovery.ts'

// Simulated page: a #root element with React's container marker and a child count.
type FakeRoot = { childElementCount: number; [key: string]: unknown }
const unmounted = (): FakeRoot => ({ childElementCount: 0 })
const mounted = (children: number): FakeRoot => ({ childElementCount: children, __reactContainer$abc: { tag: 3 } })

function fakeEnv(root: FakeRoot | null, storage = new Map<string, string>()) {
  let clock = 1_000_000
  const timers: { at: number; run: () => void; id: number }[] = []
  let nextId = 1
  const reload = vi.fn()
  const env: RootRecoveryEnv & { root: FakeRoot | null } = {
    root,
    getRoot: () => env.root,
    storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => void storage.set(key, value) },
    reload,
    now: () => clock,
    setTimeout: (run, ms) => {
      const id = nextId++
      timers.push({ at: clock + ms, run, id })
      return id
    },
    clearTimeout: (id) => {
      const index = timers.findIndex((timer) => timer.id === id)
      if (index !== -1) timers.splice(index, 1)
    },
    warn: vi.fn(),
  }
  const advance = (ms: number) => {
    const end = clock + ms
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const next = timers[0]
      if (!next || next.at > end) break
      timers.shift()
      clock = next.at
      next.run()
    }
    clock = end
  }
  return { env, reload, advance, timers, storage, setClock: (value: number) => { clock = value } }
}

describe('hot-switch blank page recovery (simulated page)', () => {
  it('treats only a mounted, empty React root as crashed', () => {
    expect(crashedRoot(null)).toBe(false)
    expect(crashedRoot(unmounted())).toBe(false)
    expect(crashedRoot(mounted(1))).toBe(false)
    expect(crashedRoot(mounted(0))).toBe(true)
    // root.unmount() sets the marker to null: a deliberate unmount is not a crash.
    expect(crashedRoot({ childElementCount: 0, __reactContainer$abc: null })).toBe(false)
  })

  it('reloads once when a live enable finds the page already blank', () => {
    const page = fakeEnv(mounted(0))
    installRootRecovery(page.env)
    page.advance(400)
    expect(page.reload).not.toHaveBeenCalled()
    page.advance(200)
    expect(page.reload).toHaveBeenCalledTimes(1)
    page.advance(ACTIVATION_WATCH_MS)
    expect(page.reload).toHaveBeenCalledTimes(1)
  })

  it('does nothing at cold boot, before React mounts the page', () => {
    const page = fakeEnv(unmounted())
    installRootRecovery(page.env)
    // The Harness mounts after plugin activation; even a later blank page is not this plugin's to reload.
    page.env.root = mounted(0)
    page.advance(ACTIVATION_WATCH_MS * 2)
    expect(page.reload).not.toHaveBeenCalled()
    expect(page.timers).toHaveLength(0)
  })

  it('leaves a healthy page alone and stops watching on its own', () => {
    const page = fakeEnv(mounted(1))
    installRootRecovery(page.env)
    page.advance(ACTIVATION_WATCH_MS + 1000)
    expect(page.reload).not.toHaveBeenCalled()
    expect(page.timers).toHaveLength(0)
  })

  it('does not reload if the page renders again before the settle delay ends', () => {
    const page = fakeEnv(mounted(0))
    installRootRecovery(page.env)
    page.env.root = mounted(1)
    page.advance(1000)
    expect(page.reload).not.toHaveBeenCalled()
  })

  it('keeps watching after disposal, because disabling the plugin blanks the page the same way', () => {
    const page = fakeEnv(mounted(1))
    const dispose = installRootRecovery(page.env)
    dispose()
    page.advance(2000)
    expect(page.reload).not.toHaveBeenCalled()
    page.env.root = mounted(0)
    page.advance(1000)
    expect(page.reload).toHaveBeenCalledTimes(1)
  })

  it('bounds the disposal watch', () => {
    const page = fakeEnv(mounted(1))
    installRootRecovery(page.env)()
    page.advance(DISPOSAL_WATCH_MS + 1000)
    expect(page.timers).toHaveLength(0)
    page.env.root = mounted(0)
    page.advance(5000)
    expect(page.reload).not.toHaveBeenCalled()
  })

  it('never reloads twice within the gap, across page loads of one tab', async () => {
    const storage = new Map<string, string>()
    const first = fakeEnv(mounted(0), storage)
    expect(await recoverCrashedRoot(first.env)).toBe(true)
    const second = fakeEnv(mounted(0), storage)
    second.setClock(1_000_000 + RELOAD_GAP_MS - 1)
    expect(await recoverCrashedRoot(second.env)).toBe(false)
    expect(second.reload).not.toHaveBeenCalled()
    expect(second.env.warn).toHaveBeenCalled()
    second.setClock(1_000_000 + RELOAD_GAP_MS)
    expect(await recoverCrashedRoot(second.env)).toBe(true)
  })

  it('still recovers when session storage is unavailable', async () => {
    const page = fakeEnv(mounted(0))
    page.env.storage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(await recoverCrashedRoot(page.env)).toBe(true)
    expect(page.reload).toHaveBeenCalledTimes(1)
  })

  it('is inert outside a page', () => {
    expect(installRootRecovery(undefined)).toBeTypeOf('function')
  })

  it('on DSH Desktop shows the restart notice instead of reloading, once', () => {
    const page = fakeEnv(mounted(0))
    const showNotice = vi.fn(() => { page.env.root = mounted(1) })
    page.env.showNotice = showNotice
    installRootRecovery(page.env)
    page.advance(ACTIVATION_WATCH_MS)
    expect(showNotice).toHaveBeenCalledTimes(1)
    expect(page.reload).not.toHaveBeenCalled()
    // The disposal watch after a Desktop disable also only shows the notice.
    const later = fakeEnv(mounted(1))
    later.env.showNotice = vi.fn()
    installRootRecovery(later.env)()
    later.env.root = mounted(0)
    later.advance(1000)
    expect(later.env.showNotice).toHaveBeenCalledTimes(1)
    expect(later.reload).not.toHaveBeenCalled()
  })

  it('renders the Desktop notice as plain text, never markup', () => {
    const created: { attributes: Record<string, string>; textContent: string; style: { cssText: string } }[] = []
    const document = {
      createElement: () => {
        const node = { attributes: {} as Record<string, string>, textContent: '', style: { cssText: '' },
          setAttribute(name: string, value: string) { node.attributes[name] = value } }
        created.push(node)
        return node
      },
    }
    const appended: unknown[] = []
    const text = '<img src=x onerror=alert(1)> 请完全退出后重新打开'
    renderRestartNotice({ append: (node: unknown) => { appended.push(node) }, ownerDocument: document } as unknown as Pick<HTMLElement, "append" | "ownerDocument">, text)
    expect(appended).toEqual([created[0]])
    expect(created[0]!.textContent).toBe(text)
    expect(created[0]!.attributes.role).toBe('alert')
    expect(created[0]!.style.cssText).toContain('var(--dsw-alias-label-primary')
  })
})

// Simulated DSH graph and React container, with real Cordis 4.1 lifecycle.
// The renderer models ownership: mounting an occupied container is an error;
// only the disposer returned to the web mount effect may release it.
async function hostFixture() {
  const ctx = new Context()
  const element = unmounted()
  const page = fakeEnv(element)
  const graph = { syncing: false, failures: [] as unknown[] }
  ctx.provide('modules', { version: 'client', entries: { state: { getSnapshot: () => graph } } })
  const events: string[] = []
  let liveRoots = 0
  let sequence = 0
  let beforeUnmount: (() => Promise<void>) | undefined
  const mount = vi.fn(() => {
    expect(liveRoots).toBe(0)
    expect(element.__reactContainer$abc ?? null).toBeNull()
    const id = ++sequence
    liveRoots++
    element.__reactContainer$abc = { id }
    element.childElementCount = 1
    events.push(`mount:${id}`)
    return async () => {
      await beforeUnmount?.()
      events.push(`unmount:${id}`)
      expect(liveRoots).toBe(1)
      liveRoots--
      element.childElementCount = 0
      element.__reactContainer$abc = null
    }
  })
  const provider = await ctx.plugin((scope) => { scope.provide('uiRenderer', { mount }) })
  // Mirrors packages/client/web/src/mount.ts; ownership stays under the root context.
  const owner = await ctx.inject(['uiRenderer'], scope => {
    scope.effect(() => scope.get('uiRenderer')!.mount(element as unknown as HTMLElement), 'web boot: application mount')
  })
  const plugin = await ctx.plugin(scope => { page.env.remount = hostRootRemount(scope) })
  const settle = async () => { await owner.await(); await Promise.resolve() }
  return { ctx, page, element, graph, mount, owner, plugin, provider, events, settle,
    live: () => liveRoots,
    blockUnmount: (wait: () => Promise<void>) => { beforeUnmount = wait },
    cleanup: () => ctx.fiber.dispose(),
  }
}

describe('host-owned in-place recovery (simulated DSH and React, real Cordis lifecycle)', () => {
  it.each(['desktop', 'browser'])('remounts on enable before any %s fallback', async (platform) => {
    const f = await hostFixture()
    try {
      f.element.childElementCount = 0
      if (platform === 'desktop') f.page.env.showNotice = vi.fn()
      installRootRecovery(f.page.env)
      f.page.advance(499)
      expect(f.mount).toHaveBeenCalledTimes(1)
      f.page.advance(1)
      await f.settle()
      expect(f.events).toEqual(['mount:1', 'unmount:1', 'mount:2'])
      expect(f.live()).toBe(1)
      expect(f.element.childElementCount).toBe(1)
      expect(f.page.reload).not.toHaveBeenCalled()
      if (platform === 'desktop') expect(f.page.env.showNotice).not.toHaveBeenCalled()
      expect(f.page.timers).toHaveLength(0)
    } finally { await f.cleanup() }
    expect(f.live()).toBe(0)
  })

  it('recovers after the plugin context is disposed, retaining DSH ownership through replacement and teardown', async () => {
    const f = await hostFixture()
    try {
      f.plugin.ctx.effect(() => installRootRecovery(f.page.env))
      await f.plugin.dispose()
      expect(f.plugin.uid).toBeNull()
      f.graph.syncing = true
      f.element.childElementCount = 0
      f.page.advance(2000)
      expect(f.mount).toHaveBeenCalledTimes(1)
      f.graph.syncing = false
      f.page.advance(1000)
      await f.settle()
      expect(f.events).toEqual(['mount:1', 'unmount:1', 'mount:2'])
      // A later renderer replacement must dispose the recovered root itself.
      await f.provider.restart()
      await f.settle()
      expect(f.events).toEqual(['mount:1', 'unmount:1', 'mount:2', 'unmount:2', 'mount:3'])
      expect(f.live()).toBe(1)
      expect(f.page.reload).not.toHaveBeenCalled()
      expect(f.page.timers).toHaveLength(0)
    } finally { await f.cleanup() }
    expect(f.events.at(-1)).toBe('unmount:3')
    expect(f.live()).toBe(0)
  })

  it('awaits the original owner disposer and coalesces overlapping watches', async () => {
    const f = await hostFixture()
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    try {
      f.blockUnmount(() => barrier)
      f.element.childElementCount = 0
      const recovery = recoverCrashedRoot(f.page.env)
      await Promise.resolve()
      expect(await recoverCrashedRoot(f.page.env)).toBe(false)
      expect(f.mount).toHaveBeenCalledTimes(1)
      expect(f.live()).toBe(1)
      release()
      expect(await recovery).toBe(true)
      expect(f.events).toEqual(['mount:1', 'unmount:1', 'mount:2'])
      expect(f.page.reload).not.toHaveBeenCalled()
    } finally { release(); await f.cleanup() }
  })

  it('does not mount during cold boot even when the host seam is available', () => {
    const page = fakeEnv(unmounted())
    const restart = vi.fn(async () => {})
    page.env.remount = vi.fn(() => ({ restart }))
    installRootRecovery(page.env)
    page.env.root = mounted(0)
    page.advance(ACTIVATION_WATCH_MS * 2)
    expect(page.env.remount).not.toHaveBeenCalled()
    expect(restart).not.toHaveBeenCalled()
    expect(page.reload).not.toHaveBeenCalled()
    expect(page.timers).toHaveLength(0)
  })

  it('waits for reconciliation again if it starts during the settle delay', async () => {
    const f = await hostFixture()
    try {
      f.element.childElementCount = 0
      installRootRecovery(f.page.env)
      f.graph.syncing = true
      f.page.advance(1000)
      expect(f.mount).toHaveBeenCalledTimes(1)
      f.graph.syncing = false
      f.page.advance(1000)
      await f.settle()
      expect(f.mount).toHaveBeenCalledTimes(2)
    } finally { await f.cleanup() }
  })

  it('bounds a graph that never settles and makes disposal idempotent', () => {
    const page = fakeEnv(mounted(0))
    page.env.remount = () => 'waiting'
    page.env.showNotice = vi.fn()
    const dispose = installRootRecovery(page.env)
    dispose()
    dispose()
    expect(page.timers).toHaveLength(1)
    page.advance(DISPOSAL_WATCH_MS)
    expect(page.timers).toHaveLength(0)
    expect(page.env.showNotice).toHaveBeenCalledTimes(1)
    expect(page.reload).not.toHaveBeenCalled()
  })

  it.each(['unavailable', 'throws', 'still-empty'])('falls back after %s, never reloading Desktop', async (mode) => {
    for (const desktop of [false, true]) {
      const page = fakeEnv(mounted(0))
      const order: string[] = []
      page.env.reload = vi.fn(() => { order.push('reload') })
      if (desktop) page.env.showNotice = vi.fn(() => { order.push('notice') })
      page.env.remount = () => mode === 'unavailable' ? 'unavailable' : {
        restart: async () => { order.push('restart'); if (mode === 'throws') throw new Error('simulated mount failure') },
      }
      expect(await recoverCrashedRoot(page.env)).toBe(true)
      expect(order).toEqual([...(mode === 'unavailable' ? [] : ['restart']), desktop ? 'notice' : 'reload'])
      if (desktop) expect(page.env.reload).not.toHaveBeenCalled()
    }
  })

  it('guards repeated in-place attempts even without session storage', async () => {
    const page = fakeEnv(mounted(0))
    delete page.env.storage
    const restart = vi.fn(async () => { page.env.root!.childElementCount = 1 })
    page.env.remount = () => ({ restart })
    expect(await recoverCrashedRoot(page.env)).toBe(true)
    page.env.root!.childElementCount = 0
    await recoverCrashedRoot(page.env)
    expect(restart).toHaveBeenCalledTimes(1)
    expect(page.reload).toHaveBeenCalledTimes(1)
    page.advance(RELOAD_GAP_MS)
    expect(await recoverCrashedRoot(page.env)).toBe(true)
    expect(restart).toHaveBeenCalledTimes(2)
  })

  it.each(['label', 'extra-effect', 'ambiguous', 'failed-graph', 'missing-modules'])('refuses an unproven mount owner: %s', async (mode) => {
    const f = await hostFixture()
    try {
      if (mode === 'label') vi.spyOn(f.owner, 'getEffects').mockReturnValue([{ label: 'another owner', children: [] }])
      if (mode === 'extra-effect') f.owner.ctx.effect(() => () => {}, 'unrelated resource')
      if (mode === 'ambiguous') await f.ctx.inject(['uiRenderer'], () => {})
      if (mode === 'failed-graph') f.graph.failures.push({ id: 'simulated' })
      if (mode === 'missing-modules') f.ctx.set('modules', undefined)
      expect(f.page.env.remount!()).toBe('unavailable')
      f.element.childElementCount = 0
      await recoverCrashedRoot(f.page.env)
      expect(f.mount).toHaveBeenCalledTimes(1)
      expect(f.page.reload).toHaveBeenCalledTimes(1)
    } finally { await f.cleanup() }
  })

  it('does not resurrect the app or fall back when teardown races the remount', async () => {
    const f = await hostFixture()
    try {
      f.element.childElementCount = 0
      const recovery = recoverCrashedRoot(f.page.env)
      await f.cleanup()
      expect(await recovery).toBe(false)
      expect(f.live()).toBe(0)
      expect(f.mount).toHaveBeenCalledTimes(1)
      expect(f.page.reload).not.toHaveBeenCalled()
    } finally { await f.cleanup() }
  })
})
