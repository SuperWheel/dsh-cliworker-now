import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject as services } from '../src/client/index.tsx'
import { useWorkers } from '../src/client/workers.ts'
import { nativeSidebarConversation } from './fixtures/native-sidebar-conversation.ts'

const nativeSidebar = nativeSidebarConversation()

// Presentation, native store state and Cordis wiring are simulated. Official
// SlotCore enforces real slot ownership and shared root-handle scope rules.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: () => null, Tooltip: () => null, rankByName: (items: unknown[]) => items,
  IconBranchOutlineRegular: () => null, IconDataOutlineRegular: () => null, IconGoalOutlineRegular: () => null,
  IconPaperPlaneOutlineRegular: () => null, IconPaperclipOutlineRegular: () => null, IconPlanOutlineRegular: () => null,
  PermissionIconFullAccessRegular: () => null,
}))
vi.mock('../src/client/panel.tsx', () => ({ Panel: () => null }))
vi.mock('../src/client/icons.tsx', () => ({ BrandIcon: () => null }))
vi.mock('../src/client/workers.ts', () => ({ useWorkers: vi.fn(() => ({ snapshot: { workers: [] } })) }))
vi.mock('dsh-cliworker-now/remote', () => ({ default: {} }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(useWorkers).mockReturnValue({ snapshot: { workers: [] } } as any)
})

function fixture(hasOpenSection = true) {
  const core = new SlotCore()
  const noop = () => null
  core.register(
    {
      name: 'root',
      children: {
        'sidebar.settings': { kind: 'single', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
        'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
        'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
        'conversation.chat.turnTail': { kind: 'list', scope: 'session' },
        'conversation.chat.node': { kind: 'keyed', scope: 'session' },
        'conversation.composer': { kind: 'chain', scope: 'session' },
        'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
        'conversation.input.dock': { kind: 'list', scope: 'session' },
        'conversation.input.model': { kind: 'single', scope: 'session' },
        'conversation.input.permission': { kind: 'single', scope: 'session' },
        'conversation.input.plan': { kind: 'single', scope: 'session' },
        'sidebar.chat.conversation': { kind: 'single', scope: 'session' },
      },
    } as any,
    noop,
  )
  core.register(nativeSidebar.options as any, nativeSidebar.component)
  let state = { open: false, activeId: '' }
  const actions = {
    close: () => {
      state = { ...state, open: false }
    },
    ...(hasOpenSection
      ? {
          openSection: (id: string) => {
            state = { open: true, activeId: id }
          },
        }
      : {}),
  }
  const nativeInstance = { actions, getSnapshot: () => state }
  // Synthetic native shell handle: registration must share this exact object;
  // production code must let the renderer bind actions rather than call create.
  const nativeHandle = {
    spec: { init: () => state, actions },
    create: vi.fn(() => nativeInstance),
  }
  const nativeSettings = () =>
    core.register(
      {
        name: 'sidebar.settings',
        store: nativeHandle,
        children: { 'settings.section': { kind: 'list', scope: 'root' } },
      } as any,
      noop,
    )
  const disposers: (() => void)[] = []
  const effect = (run: () => unknown) => {
    const dispose = run()
    if (typeof dispose === 'function') disposers.push(dispose as () => void)
    return dispose
  }
  const ctx: any = {
    effect,
    inject: (names: string[], callback: (scope: unknown) => void) => {
      // Cordis starts an optional scope only after every requested service exists.
      if (names.every((name) => name.split('.').reduce((scope, key) => scope?.[key], ctx) != null))
        callback(ctx)
    },
    slots: {
      provideRoot: vi.fn(() => vi.fn()),
      inject: (name: string, callback: () => () => void) => {
        let current: (() => void) | undefined
        const update = () => {
          current?.()
          current = core.specDynamic(name) ? callback() : undefined
        }
        const off = core.subscribeDeclaration(name, update)
        update()
        return () => {
          off()
          current?.()
          current = undefined
        }
      },
      register: core.register.bind(core),
      registerFactory: core.registerFactory.bind(core),
      entriesOfSlot: core.entriesOfSlot.bind(core),
      entries: core.entries.bind(core),
      subscribe: core.subscribe.bind(core),
    },
    remote: { $mount: () => () => {}, cliworker: {} },
    configForms: { get: () => undefined },
    sidebarRightTabs: { register: () => () => {} },
  }
  vi.stubGlobal('document', {
    createElement: () => ({ textContent: '', remove: vi.fn() }),
    head: { append: vi.fn() },
  })
  return {
    core,
    ctx,
    nativeSettings,
    nativeHandle,
    nativeInstance,
    dispose: () => {
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

it('模拟：Client 加载时注册页头名称源，卸载时释放', () => {
  const f = fixture()
  apply(f.ctx)
  expect(f.ctx.slots.provideRoot).toHaveBeenCalledWith({
    props: { cliworkerHeaderNames: expect.any(Function) },
  })
  f.dispose()
  expect(f.ctx.slots.provideRoot.mock.results[0].value).toHaveBeenCalledOnce()
})

it('registers and releases native commands only when their optional services are available', () => {
  const f = fixture()
  const unregisterAttachments = vi.fn()
  const unregisterCommands = vi.fn()
  f.ctx.sessions = {}
  f.ctx.inputTriggers = { registerSource: vi.fn()
    .mockReturnValueOnce(unregisterAttachments)
    .mockReturnValueOnce(unregisterCommands) }
  f.ctx.commandUi = {}
  apply(f.ctx)
  expect(f.ctx.inputTriggers.registerSource).toHaveBeenCalledTimes(2)
  expect(f.ctx.inputTriggers.registerSource.mock.calls[0][0]).toMatchObject({
    trigger: '@',
    name: 'cliworker-selected-files',
    codec: { serialize: expect.any(Function) },
  })
  expect(f.ctx.inputTriggers.registerSource.mock.calls[1][0]).toMatchObject({
    trigger: '/',
    name: 'cliworker-settings',
  })
  f.dispose()
  expect(unregisterAttachments).toHaveBeenCalledOnce()
  expect(unregisterCommands).toHaveBeenCalledOnce()
})

it('declares the session projection service needed by the native child data attachment', () => {
  expect(services).toContain('uiSession')
})

it('preserves native process and tails without adding a second reasoning records entry', () => {
  const f = fixture()
  f.ctx.sessions = {}
  f.ctx.conversation = { blocks: {} }
  const NativeProcess = () => null
  const NativeTail = () => null
  f.core.register({ name: 'conversation.chat.node', key: 'turn-process' } as any, NativeProcess)
  f.core.register({ name: 'conversation.chat.turnTail', id: 'native-tail' } as any, NativeTail)
  const before = ['conversation.chat.node', 'conversation.chat.turnTail'].map((name) => f.core.entries(name))
  apply(f.ctx)
  expect(f.core.entries('conversation.chat.node')).toEqual(before[0])
  expect(f.core.entries('conversation.chat.turnTail')).toEqual(before[1])
  f.dispose()
  expect(f.core.entries('conversation.chat.node')[0]!.component).toBe(NativeProcess)
  expect(f.core.entries('conversation.chat.turnTail')[0]!.component).toBe(NativeTail)
})

it('preserves the native composer, queue and pending-interaction entries without a second data or action adapter', () => {
  const f = fixture()
  f.ctx.sessions = {}
  f.ctx.conversation = { blocks: {} }
  const NativeBar = () => null
  const NativeQueue = () => null
  const NativeApproval = () => null
  const inject = vi.fn(() => ({ keyboard: {}, hooks: {} }))
  f.core.register({ name: 'conversation.composer.bar', inject } as any, NativeBar)
  f.core.register({ name: 'conversation.input.dock', id: 'queue' } as any, NativeQueue)
  f.core.register({ name: 'conversation.composer', select: () => ({ pending: true }) } as any, NativeApproval)
  const before = ['conversation.composer.bar', 'conversation.input.dock', 'conversation.composer'].map(
    (name) => f.core.entries(name),
  )
  apply(f.ctx)
  for (const [index, name] of [
    'conversation.composer.bar',
    'conversation.input.dock',
    'conversation.composer',
  ].entries())
    expect(f.core.entries(name)).toEqual(before[index])
  expect(inject).not.toHaveBeenCalled()
  expect(f.core.specDynamic('cliworker.harness.conversation')).toBeUndefined()
  expect(f.core.entries('sidebar.right.pane.tab')[0]!.children).toEqual({ 'cliworker.native.sidebar': { kind: 'single', scope: 'session' } })
  expect(f.core.factory('cliworker.native.frame')).toBeUndefined()
  expect(f.core.entries('cliworker.native.sidebar')).toHaveLength(1)
  expect(f.core.entries('cliworker.native.sidebar')[0]!.component).toBe(nativeSidebar.component)
  f.dispose()
  expect(f.core.entries('conversation.composer.bar')[0]!.component).toBe(NativeBar)
  expect(f.core.entries('conversation.input.dock')[0]!.component).toBe(NativeQueue)
})

it('keeps CLI child runs in the native child conversation without automatically reopening the management sidebar', async () => {
  const f = fixture()
  let current = 'child'
  const openTab = vi.fn()
  f.ctx.sidebarRight = { mounted: { getSnapshot: () => current }, openTab }
  vi.mocked(useWorkers).mockReturnValue({
    snapshot: { workers: [{ id: 'worker', runId: 'active', status: 'running' }] },
  } as any)
  apply(f.ctx)
  const Header = f.core.entries('conversation.session.header.utilities')[0]!.component as any
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(
      createElement(Header, {
        sessionId: 'child',
        useSession: (select: any) =>
          select({
            subagent: {
              address: {
                parentSessionId: 'parent',
                childSessionId: 'child',
                mode: 'continuable',
              },
            },
          }),
      }),
    )
  })
  expect(openTab).not.toHaveBeenCalled()
  current = 'parent'
  await act(async () =>
    renderer.update(
      createElement(Header, {
        sessionId: 'parent',
        useSession: (select: any) => select({ subagent: null }),
      }),
    ),
  )
  expect(openTab).toHaveBeenCalledExactlyOnceWith('cliworker')
  await act(async () => renderer.unmount())
  f.dispose()
})

it.each(['native-first', 'plugin-first'])(
  'shares the native root store without claiming settings slots: %s',
  async (order) => {
    const f = fixture()
    if (order === 'native-first') f.nativeSettings()
    expect(() => apply(f.ctx)).not.toThrow()
    if (order === 'plugin-first') expect(f.nativeSettings).not.toThrow()
    expect(f.core.entries('sidebar.right.pane.tab')).toHaveLength(1)
    expect(f.core.entries('conversation.session.header.utilities')).toHaveLength(1)
    const panel = f.core.entries('sidebar.right.pane.tab')[0]!
    const openNative = panel.inject!().openNativeSettings as () => void
    expect(openNative).toThrow('Harness 原生设置入口暂不可用')
    const bridge = f.core.entries('shell.overlay')[0]!
    expect(bridge.store).toBe(f.nativeHandle)
    expect(f.nativeHandle.create).not.toHaveBeenCalled()
    expect(f.core.specDynamic('settings.section')).toEqual({ kind: 'list', scope: 'root' })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(
        createElement(bridge.component as any, bridge.inject!(f.nativeInstance.actions as never)),
      )
    })
    openNative()
    expect(f.nativeInstance.getSnapshot()).toEqual({ open: true, activeId: 'models' })
    expect(f.nativeHandle.create).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
    expect(openNative).toThrow('Harness 原生设置入口暂不可用')
    f.dispose()
    expect(f.core.entries('sidebar.right.pane.tab')).toHaveLength(0)
    expect(f.core.entries('conversation.session.header.utilities')).toHaveLength(0)
    expect(f.core.entries('shell.overlay')).toHaveLength(0)
    expect(f.core.specDynamic('settings.section')).toEqual({ kind: 'list', scope: 'root' })
    expect(f.core.entries('sidebar.settings')).toHaveLength(1)
    f.nativeInstance.actions.close()
    expect(f.nativeInstance.getSnapshot().open).toBe(false)
  },
)

it('keeps the plugin available when native settings has no compatible root-store action', () => {
  const f = fixture(false)
  f.nativeSettings()
  expect(() => apply(f.ctx)).not.toThrow()
  expect(f.core.entries('shell.overlay')).toHaveLength(0)
  expect(f.core.entries('conversation.session.header.utilities')).toHaveLength(1)
  const panel = f.core.entries('sidebar.right.pane.tab')[0]!
  expect(panel.inject!().openNativeSettings).toThrow('Harness 原生设置入口暂不可用')
  expect(f.nativeHandle.create).not.toHaveBeenCalled()
  f.dispose()
})

it('revokes native navigation immediately when its owner unloads while keeping plugin conversations registered', async () => {
  const f = fixture()
  const closeNative = f.nativeSettings()
  apply(f.ctx)
  const bridge = f.core.entries('shell.overlay')[0]!
  const panel = f.core.entries('sidebar.right.pane.tab')[0]!
  const openNative = panel.inject!().openNativeSettings as () => void
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(
      createElement(bridge.component as any, bridge.inject!(f.nativeInstance.actions as never)),
    )
  })
  closeNative()
  expect(f.core.entries('shell.overlay')).toHaveLength(0)
  expect(openNative).toThrow('Harness 原生设置入口暂不可用')
  expect(f.core.entries('sidebar.right.pane.tab')).toHaveLength(1)
  await act(async () => renderer.unmount())
  f.dispose()
})
