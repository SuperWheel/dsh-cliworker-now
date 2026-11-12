import { expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { installHarnessNativeContent } from '../src/client/harness-native-content.tsx'
import { nativeSidebarConversation } from './fixtures/native-sidebar-conversation.ts'

const SOURCE = 'sidebar.chat.conversation'
const TARGET = 'cliworker.native.sidebar'
const native = nativeSidebarConversation()

function fixture() {
  const core = new SlotCore()
  core.register({ name: 'root', children: { 'fixture.owners': { kind: 'list', scope: 'root' } } } as any, () => null)
  const unsubscribe = vi.fn()
  const ctx: any = { slots: {
    register: core.register.bind(core),
    entriesOfSlot: core.entriesOfSlot.bind(core),
    subscribe: (name: string, listener: () => void) => {
      const off = core.subscribe(name, listener)
      return () => { off(); unsubscribe() }
    },
    inject: (name: string, run: () => () => void) => {
      let current: (() => void) | undefined
      const sync = () => {
        current?.()
        current = core.specDynamic(name) ? run() : undefined
      }
      const off = core.subscribeDeclaration(name, sync)
      sync()
      return () => { off(); current?.(); current = undefined }
    },
  } }
  const declare = (name: string) => core.register({
    name: 'fixture.owners', id: name, children: { [name]: { kind: 'single', scope: 'session' } },
  } as any, () => null)
  const registerNative = () => core.register(native.options as any, native.component)
  return { core, ctx, declare, registerNative, unsubscribe }
}

it('registers the exact official sidebar component without a local body, phase selector or view wrapper', () => {
  const f = fixture()
  f.declare(SOURCE)
  f.declare(TARGET)
  f.registerNative()
  const source = f.core.entriesOfSlot(SOURCE)[0]!
  const release = installHarnessNativeContent(f.ctx)
  const target = f.core.entriesOfSlot(TARGET)[0]!
  expect(target.component).toBe(source.component)
  expect(target.children).toBeUndefined()
  expect(f.core.entriesOfSlot(SOURCE)).toEqual([source])
  expect(f.core.factory('cliworker.native.frame')).toBeUndefined()
  release()
  expect(f.core.entriesOfSlot(TARGET)).toEqual([])
  expect(f.core.entriesOfSlot(SOURCE)).toEqual([source])
})

it.each([
  [{}, undefined, 'active', false],
  [{ blank: true, openState: 'loading' }, undefined, 'settling', false],
  [{ blank: true }, undefined, 'hero', true],
  [{ blank: true, openState: 'loading' }, true, 'hero', true],
  [{ blank: true, running: true }, undefined, 'active', false],
  [{ blank: true, promptAttempted: true }, undefined, 'active', false],
  // rc.2 continuation enters through the live tree root; a missing direct
  // parent's residency no longer blocks the sidebar phase.
  [{ subagent: { address: { mode: 'continuable' } } }, undefined, 'active', false],
])('lets the installed official component select its layout for the real child state: %j', (overrides, summaryBlank, phase, hero) => {
  const f = fixture()
  f.declare(SOURCE)
  f.declare(TARGET)
  f.registerNative()
  const release = installHarnessNativeContent(f.ctx)
  const Component = f.core.entriesOfSlot(TARGET)[0]!.component as any
  const renderFactorySlot = vi.fn()
  const session = {
    blank: false, awaitingFirstTurn: false, running: false, promptAttempted: false, openState: 'open',
    subagent: { address: { parentSessionId: 'parent', childSessionId: 'child', mode: 'continuable' }, parentAvailable: true },
    ...overrides,
  }
  Component({
    sessionId: 'child',
    useSession: (select: any) => select(session),
    useConversation: (select: any) => select({ activeTargets: new Set() }),
    useSessions: (select: any) => select({ byId: { child: { blank: summaryBlank }, parent: { blank: false } } }),
    renderFactorySlot,
  })
  expect(renderFactorySlot).toHaveBeenCalledOnce()
  const [name, owner, options] = renderFactorySlot.mock.calls[0]!
  expect(name).toBe('conversation.content')
  expect(owner).toEqual({ variant: 'embedded', phase, hero })
  expect(Object.keys(options.slots)).toEqual(['views'])
  const renderSlot = vi.fn()
  options.slots.views({ renderSlot })
  expect(renderSlot).toHaveBeenCalledExactlyOnceWith('conversation.session', { view: 'chat' })
  release()
})

it('waits for the native entry and releases it through late declaration, unload, reload and target disposal', async () => {
  const f = fixture()
  const release = installHarnessNativeContent(f.ctx)
  let removeTarget = f.declare(TARGET)
  expect(f.core.entriesOfSlot(TARGET)).toEqual([])
  let removeSource = f.declare(SOURCE)
  f.registerNative()
  await Promise.resolve()
  expect(f.core.entriesOfSlot(TARGET)[0]!.component).toBe(native.component)
  removeSource()
  await Promise.resolve()
  expect(f.core.entriesOfSlot(TARGET)).toEqual([])
  removeSource = f.declare(SOURCE)
  f.registerNative()
  await Promise.resolve()
  expect(f.core.entriesOfSlot(TARGET)[0]!.component).toBe(native.component)
  removeTarget()
  expect(f.unsubscribe).toHaveBeenCalledOnce()
  removeTarget = f.declare(TARGET)
  expect(f.core.entriesOfSlot(TARGET)[0]!.component).toBe(native.component)
  release()
  release()
  expect(f.unsubscribe).toHaveBeenCalledTimes(2)
  expect(f.core.entriesOfSlot(TARGET)).toEqual([])
  removeSource()
  f.declare(SOURCE)
  f.registerNative()
  await Promise.resolve()
  expect(f.core.entriesOfSlot(TARGET)).toEqual([])
  removeTarget()
})

it('tracks the native winning entry and preserves its renderer-owned contracts', async () => {
  const f = fixture()
  f.declare(SOURCE)
  f.declare(TARGET)
  f.registerNative()
  const release = installHarnessNativeContent(f.ctx)
  const replacement = () => null
  const inject = vi.fn()
  const store = { spec: { init: () => ({}), actions: {} }, create: vi.fn() }
  const removeReplacement = f.core.register({ name: SOURCE, priority: -10, inject, store, locale: 'native' } as any, replacement)
  await Promise.resolve()
  const target = f.core.entriesOfSlot(TARGET)[0]!
  expect(target.component).toBe(replacement)
  expect(target.inject).toBe(inject)
  expect(target.store).toBe(store)
  expect(target.locale).toBe('native')
  expect(inject).not.toHaveBeenCalled()
  expect(store.create).not.toHaveBeenCalled()
  removeReplacement()
  await Promise.resolve()
  expect(f.core.entriesOfSlot(TARGET)[0]!.component).toBe(native.component)
  release()
})

it('rejects an incompatible future ownership contract without borrowing or redeclaring source children', () => {
  const f = fixture()
  f.declare(SOURCE)
  f.declare(TARGET)
  f.core.register({ name: SOURCE, children: { 'native.future': { kind: 'single', scope: 'session' } } } as any, () => null)
  expect(() => installHarnessNativeContent(f.ctx)).toThrow('Slot 合同已变更')
  expect(f.core.entriesOfSlot(TARGET)).toEqual([])
  expect(f.core.specDynamic('native.future')).toBeDefined()
  expect(f.unsubscribe).toHaveBeenCalledOnce()
})
