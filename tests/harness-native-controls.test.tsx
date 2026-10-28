import * as React from 'react'
import * as ReactJsx from 'react/jsx-runtime'
import * as ReactDom from 'react-dom'
import * as Cordis from '@deepseek-ai/cordis'
import * as Stores from '@deepseek-ai/dsh-client-store'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { selectBuildDependencies } from '../scripts/build-dependencies.mjs'
import { createElement, useSyncExternalStore, type ComponentType } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { HarnessBindingRegistry } from '../src/client/harness-binding-registry.ts'
import { installHarnessControlGuards } from '../src/client/harness-control-guards.tsx'
import { useWorkers } from '../src/client/workers.ts'
import type { HarnessConversationBinding, Worker } from '../src/shared/types.ts'
import { nativePermissionSelect } from './fixtures/native-permission-select.ts'

// SIMULATION: native leaf components, Worker watch and permission Gateway.
// Real SlotCore checks ownership; real business adapters run without a CLI.
vi.mock('../src/client/workers.ts', async (original) => ({
  ...(await original<typeof import('../src/client/workers.ts')>()),
  useWorkers: vi.fn(),
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Tooltip: ({ children, label }: any) => <span data-tooltip={label}>{children}</span>,
  Toast: ({ text }: any) => <span role="alert">{text}</span>,
}))
const trees: ReactTestRenderer[] = []
const releases: (() => void)[] = []
afterEach(async () => {
  await act(async () => {
    for (const tree of trees.splice(0)) tree.unmount()
  })
  for (const release of releases.splice(0)) release()
  vi.clearAllMocks()
})
const binding = {
  sessionId: 'child',
  parentSessionId: 'parent',
  mode: 'continuable',
  capabilities: { model: true, permission: true, plan: true },
} as HarnessConversationBinding
const worker: Worker = {
  id: 'worker',
  parentSessionId: 'parent',
  harnessConversation: binding,
  preference: { cli: 'codex', model: 'gpt-5.4', effort: 'high' },
  mode: 'accept-edits',
  status: 'completed',
} as Worker
const names = [
  'conversation.input.model',
  'conversation.input.permission',
  'conversation.input.plan',
] as const

function fixture(permissionComponent?: ComponentType<any>, modelRegistration?: { component: ComponentType<any>; children: Record<string, unknown> }) {
  const core = new SlotCore()
  core.register(
    {
      name: 'root',
      children: Object.fromEntries(names.map((name) => [name, { kind: 'single', scope: 'session' }])),
    } as any,
    () => null,
  )
  const native = Object.fromEntries(
    names.map((name) => [
      name,
      vi.fn((props: any) =>
        name === names[0] && modelRegistration ? createElement(modelRegistration.component, props) :
        name === names[1] && permissionComponent ? createElement(permissionComponent, props) :
        name.endsWith('.model') && props.available === false ? null : (
          <button data-native={name} disabled={props.locked} />
        ),
      ),
    ]),
  )
  const inject = () => ({ available: false, originalCallback: vi.fn() })
  const originalReleases = names.map(name =>
    core.register({ name, inject, locale: 'conversation',
      ...(name === names[0] && modelRegistration ? { children: modelRegistration.children } : {}),
    } as any, native[name] as any))
  const original = names.map((name) => core.entries(name)[0])
  const sessions = createSnapshotStore<any>({
    projectionsBySession: {
      parent: { values: { permissions: { currentValue: 'workspace-write' }, plan: { active: false, pending: false } } },
    },
  })
  const sessionListeners = new Set<() => void>()
  const subscribeSessions = (listener: () => void) => {
    sessionListeners.add(listener)
    const release = sessions.subscribe(listener)
    return () => { sessionListeners.delete(listener); release() }
  }
  const useSessions = (selector: (state: any) => unknown) =>
    selector(useSyncExternalStore(subscribeSessions, sessions.getSnapshot))
  let snapshot: any = { selected: worker, selectedBusy: false, queuedFollowups: [] }
  vi.mocked(useWorkers).mockImplementation(() => ({ snapshot, connecting: false }) as any)
  const api: any = {
    cliworker: {
      permissionForWorker: vi.fn(async () => ({
        ok: true,
        value: JSON.stringify({
          currentValue: 'auto',
          writable: true,
          options: [
            { value: 'ask', name: '询问', description: 'Synthetic CLI ask level' },
            { value: 'auto', name: '自动审批', description: 'Synthetic CLI middle level' },
          ],
          plan: { supported: true, active: false },
        }),
      })),
      configureWorkerPermission: vi.fn(async (_parent, _worker, setting) => ({
        ok: true,
        value: JSON.stringify(setting === 'plan' || setting === 'accept-edits' ? { ...worker, mode: setting } : { ...worker, level: setting }),
      })),
      catalogForWorker: vi.fn(async () => ({
        ok: true,
        value: JSON.stringify({
          cli: 'codex',
          models: [{ id: 'gpt-5.4', label: 'gpt-5.4', efforts: ['high'] }],
        }),
      })),
      configureWorker: vi.fn(),
    },
  }
  const bindings = new HarnessBindingRegistry()
  const release = installHarnessControlGuards({ slots: core } as any, bindings, api)
  releases.push(release)
  const inbox = { 'next-turn': [] as unknown[], 'next-step': [] as unknown[] }
  const useProjection = vi.fn((key: string, selector?: (value: unknown) => unknown) => {
    const state = key === 'inbox' ? inbox : { untouched: key }
    return selector ? selector(state) : state
  })
  const useSession = (selector: any) => selector({ running: false, pendingSubmissions: [] })
  const props = (sessionId = 'child') => ({
    sessionId,
    locked: false,
    available: false,
    useProjection,
    useSession,
    useSessions,
    directory: { native: true },
    select: vi.fn(),
    exitPlanMode: vi.fn(),
    t: (key: string, values?: { name?: string }) => values?.name ?? key,
  })
  const mount = async (name: (typeof names)[number], values = props()) => {
    let tree!: ReactTestRenderer
    await act(async () => {
      tree = create(createElement(core.entriesOfSlot(name)[0]!.component as any, values))
      trees.push(tree)
    })
    return tree
  }
  return {
    core,
    original,
    originalReleases,
    native,
    inject,
    api,
    bindings,
    release,
    props,
    mount,
    inbox,
    useProjection,
    sessions,
    sessionListeners,
    updateProjections(sessionId: string, values: Record<string, unknown>) {
      const previous = sessions.getSnapshot()
      sessions.set({
        ...previous,
        projectionsBySession: {
          ...previous.projectionsBySession,
          [sessionId]: { values: { ...previous.projectionsBySession[sessionId]?.values, ...values } },
        },
      })
    },
    updateSnapshot(value: any) {
      snapshot = value
    },
  }
}

it('uses the actual native model leaf for a cold child binding and keeps ordinary main controls untouched', async () => {
  const f = fixture()
  const parentProps = { ...f.props('parent'), available: true }
  const parent = await f.mount(names[0], parentProps)
  const child = await f.mount(names[0])
  expect(child.toJSON()).toBeNull()
  await act(async () => f.bindings.publish(binding, worker))
  expect(child.root.findByProps({ 'data-native': names[0] }).props.disabled).toBe(false)
  const childProps = f.native[names[0]]!.mock.calls.filter(([props]) => props.sessionId === 'child').at(
    -1,
  )![0]
  expect(childProps.available).toBe(true)
  expect(childProps.useProjection).toBe(f.useProjection)
  expect(childProps.directory.getSnapshot().current).toEqual({
    provider: 'cliworker:codex',
    model: 'gpt-5.4',
    reasoningEffort: 'high',
  })
  expect(childProps.load).toBeTypeOf('function')
  expect(childProps.select).toBeTypeOf('function')
  expect(parent.root.findByProps({ 'data-native': names[0] }).props.disabled).toBe(false)
  const unchanged = f.native[names[0]]!.mock.calls.filter(([props]) => props.sessionId === 'parent').at(
    -1,
  )![0]
  expect(unchanged.directory).toBe(parentProps.directory)
  expect(unchanged.select).toBe(parentProps.select)
  expect(unchanged.useProjection).toBe(parentProps.useProjection)
  expect(f.api.cliworker.catalogForWorker).toHaveBeenCalledTimes(1)
  expect(f.api.cliworker.configureWorker).not.toHaveBeenCalled()
  f.release()
  for (const [index, name] of names.entries()) {
    expect(f.core.entriesOfSlot(name)).toEqual([f.original[index]])
    expect(f.core.entriesOfSlot(name)[0]!.children).toBeUndefined()
  }
})

it.each([names[1], names[2]])(
  'maps only CLI setting data/actions for the native %s control',
  async (name) => {
    const f = fixture()
    f.bindings.publish(binding, worker)
    const parentProps = { ...f.props('parent'), available: true }
    await f.mount(name, parentProps)
    const child = await f.mount(name)
    expect(child.root.findByProps({ 'data-native': name }).props.disabled).toBe(false)
    const nativeProps = f.native[name]!.mock.calls.filter(([props]) => props.sessionId === 'child').at(-1)![0]
    expect(nativeProps.useProjection('inbox')).toBe(f.inbox)
    expect(nativeProps.useProjection('permissions')).toEqual({ currentValue: 'workspace-write' })
    expect(nativeProps.useProjection('plan')).toEqual({ active: false, pending: false })
    expect(nativeProps.usePermissionCatalog((state: any) => state.value.options.map((option: any) => option.value)))
      .toEqual(['read-only', 'workspace-write'])
    expect(nativeProps.useProjection('other')).toEqual({ untouched: 'other' })
    const parentActual = f.native[name]!.mock.calls.filter(([props]) => props.sessionId === 'parent').at(
      -1,
    )![0]
    expect(parentActual.useProjection).toBe(parentProps.useProjection)
    expect(parentActual.select).toBe(parentProps.select)
    expect(parentActual.exitPlanMode).toBe(parentProps.exitPlanMode)
    await act(async () => {
      expect(await nativeProps.select('read-only')).toBe(true)
    })
    expect(f.api.cliworker.configureWorkerPermission).toHaveBeenCalledWith(
      'parent',
      'worker',
      'ask',
      expect.any(AbortSignal),
    )
    // The level never stands in for the plan switch.
    expect(nativeProps.useProjection('plan')).toEqual({ active: false, pending: false })
    expect(f.api.cliworker.catalogForWorker).not.toHaveBeenCalled()
  },
)

it('lets the installed native PermissionSelect choose its glyph, trigger and menu, and maps only supported presets to Worker levels', async () => {
  // SIMULATION: glyph/portal surfaces are test markers. The installed, unchanged
  // PermissionSelect owns glyph selection, its trigger, menu options and clicks.
  const primitives = {
    PermissionIconWorkspaceWriteRegular: () => <svg data-native-glyph="workspace-write" />,
    PermissionIconReadOnlyRegular: () => <svg data-native-glyph="read-only" />,
    PermissionIconFullAccessRegular: () => <svg data-native-glyph="danger-full-access" />,
    IconChevronDownOutlineRegular: () => <svg data-native-glyph="chevron-down" />,
  }
  const menu = vi.fn(({ anchor }: any) => anchor)
  const Native = nativePermissionSelect({ ...primitives, Menu: menu })
  const f = fixture(Native)
  f.bindings.publish(binding, worker)
  const tree = await f.mount(names[1])
  expect(tree.root.findAllByType(Native)).toHaveLength(1)
  const trigger = tree.root.findByType('button')
  expect(trigger.props.className).toBe('iWlSmW_trigger')
  expect(trigger.findAllByType(primitives.PermissionIconWorkspaceWriteRegular)).toHaveLength(1)
  const currentMenu = () => menu.mock.calls.at(-1)![0]
  expect(currentMenu().open).toBe(false)
  await act(async () => trigger.props.onClick())
  expect(currentMenu().open).toBe(true)
  expect(currentMenu().portal).toBe(true)
  expect(currentMenu().side).toBe('top')
  expect(currentMenu().selectedId).toBe('workspace-write')
  expect(currentMenu().items.map((item: any) => [item.id, item.icon.type])).toEqual([
    ['read-only', primitives.PermissionIconReadOnlyRegular],
    ['workspace-write', primitives.PermissionIconWorkspaceWriteRegular],
  ])
  expect(currentMenu().items.map((item: any) => item.label)).toEqual(['询问', '自动审批'])
  await act(async () => currentMenu().onSelect('read-only'))
  expect(f.api.cliworker.configureWorkerPermission).toHaveBeenCalledExactlyOnceWith(
    'parent', 'worker', 'ask', expect.any(AbortSignal),
  )
  expect(tree.root.findByType('button').findAllByType(primitives.PermissionIconReadOnlyRegular)).toHaveLength(1)
  await act(async () => currentMenu().onSelect('workspace-write'))
  expect(f.api.cliworker.configureWorkerPermission).toHaveBeenLastCalledWith(
    'parent', 'worker', 'auto', expect.any(AbortSignal),
  )
  const props = f.native[names[1]]!.mock.calls.at(-1)![0]
  // Above the parent's cap, or not a DSH preset value at all.
  for (const unsupported of ['danger-full-access', 'auto', 'accept-edits', 'plan', 'ask'])
    expect(await props.select(unsupported)).toBe(false)
  expect(f.api.cliworker.configureWorkerPermission).toHaveBeenCalledTimes(2)
})

it('keeps the permission levels usable when the CLI has no plan mode', async () => {
  // SIMULATION: a CLI without plan mode (e.g. Qoder) still has its three levels.
  const f = fixture()
  f.api.cliworker.permissionForWorker.mockResolvedValue({
    ok: true,
    value: JSON.stringify({
      currentValue: 'auto',
      writable: true,
      options: [
        { value: 'ask', name: '询问', description: 'Synthetic ask level' },
        { value: 'auto', name: '自动审批', description: 'Synthetic middle level' },
      ],
      plan: { supported: false, active: false },
    }),
  })
  const planless = { ...binding, capabilities: { ...binding.capabilities, plan: false } }
  f.bindings.publish(planless, { ...worker, harnessConversation: planless })
  const tree = await f.mount(names[1])
  const props = f.native[names[1]]!.mock.calls.at(-1)![0]
  expect(props.useProjection('permissions')).toEqual({ currentValue: 'workspace-write' })
  expect(props.locked).toBe(false)
  expect(JSON.stringify(tree.toJSON())).not.toContain('一种权限模式')
  await act(async () => {
    expect(await props.select('read-only')).toBe(true)
  })
  expect(f.api.cliworker.configureWorkerPermission).toHaveBeenCalledExactlyOnceWith(
    'parent', 'worker', 'ask', expect.any(AbortSignal),
  )
})

it('exits native plan mode through the plan switch and keeps the level', async () => {
  // SIMULATION: a Worker planning at the ask level.
  const f = fixture()
  f.api.cliworker.permissionForWorker.mockResolvedValue({
    ok: true,
    value: JSON.stringify({
      currentValue: 'ask',
      writable: true,
      options: [
        { value: 'ask', name: '询问', description: 'Synthetic ask level' },
        { value: 'auto', name: '自动审批', description: 'Synthetic middle level' },
      ],
      plan: { supported: true, active: true },
    }),
  })
  f.bindings.publish(binding, { ...worker, mode: 'plan', level: 'ask' })
  await f.mount(names[2])
  const latest = () => f.native[names[2]]!.mock.calls.at(-1)![0]
  expect(latest().useProjection('plan')).toEqual({ active: true, pending: false })
  expect(latest().useProjection('permissions')).toEqual({ currentValue: 'read-only' })
  await act(async () => {
    expect(await latest().exitPlanMode()).toBeNull()
  })
  expect(f.api.cliworker.configureWorkerPermission).toHaveBeenCalledExactlyOnceWith(
    'parent', 'worker', 'accept-edits', expect.any(AbortSignal),
  )
  expect(latest().useProjection('plan')).toEqual({ active: false, pending: false })
  expect(latest().useProjection('permissions')).toEqual({ currentValue: 'read-only' })
})

it('keeps native controls locked when the selected receipt belongs to another Worker and cancels permission reads on unmount', async () => {
  const f = fixture()
  f.bindings.publish(binding, worker)
  f.updateSnapshot({ selected: { ...worker, id: 'other' }, queuedFollowups: [] })
  const mismatched = await f.mount(names[1])
  expect(mismatched.root.findByProps({ 'data-native': names[1] }).props.disabled).toBe(true)
  expect(f.api.cliworker.permissionForWorker).not.toHaveBeenCalled()
  f.updateSnapshot({ selected: worker, queuedFollowups: [] })
  f.api.cliworker.permissionForWorker.mockReturnValueOnce(new Promise(() => {}))
  const pending = await f.mount(names[1])
  const signal = f.api.cliworker.permissionForWorker.mock.calls.at(-1)![2] as AbortSignal
  expect(signal.aborted).toBe(false)
  await act(async () => pending.unmount())
  expect(signal.aborted).toBe(true)
  expect(f.api.cliworker.configureWorkerPermission).not.toHaveBeenCalled()
})

it('preserves native inbox ownership and locks CLI settings while a native queued message exists', async () => {
  const f = fixture()
  f.bindings.publish(binding, worker)
  f.inbox['next-step'].push({ rpcId: 'native-exact-rpc' })
  const tree = await f.mount(names[0])
  expect(tree.root.findByProps({ 'data-native': names[0] }).props.disabled).toBe(true)
  const props = f.native[names[0]]!.mock.calls.at(-1)![0]
  expect(props.useProjection).toBe(f.useProjection)
  expect(props.useProjection('inbox')['next-step']).toEqual([{ rpcId: 'native-exact-rpc' }])
  expect(f.api.cliworker.configureWorker).not.toHaveBeenCalled()
})

const permissionReceipt = (writable: boolean) => ({
  ok: true,
  value: JSON.stringify({
    currentValue: 'auto',
    writable,
    options: [
      { value: 'ask', name: '询问', description: 'Synthetic ask level' },
      { value: 'auto', name: '自动审批', description: 'Synthetic middle level' },
    ],
    plan: { supported: true, active: false },
    ...(!writable && { reason: 'Synthetic parent authorization is readonly' }),
  }),
})

it.each([
  [names[1], 'permissions'], [names[2], 'permissions'],
  [names[1], 'plan'], [names[2], 'plan'],
] as const)('refreshes native %s in both directions when its exact parent %s changes', async (name, key) => {
  const f = fixture()
  f.bindings.publish(binding, worker)
  const updateParent = (blocked: boolean) => f.updateProjections('parent', {
    [key]: key === 'permissions'
      ? { currentValue: blocked ? 'read-only' : 'workspace-write' }
      : { active: blocked, pending: false },
  })
  f.api.cliworker.permissionForWorker.mockImplementation(async () => {
    const values = f.sessions.getSnapshot().projectionsBySession.parent.values
    return permissionReceipt(values.permissions.currentValue !== 'read-only' && !values.plan.active)
  })
  updateParent(true)
  const parentProps = { ...f.props('parent'), available: true }
  const parent = await f.mount(name, parentProps)
  const child = await f.mount(name)
  const disabled = () => child.root.findByProps({ 'data-native': name }).props.disabled
  expect(disabled()).toBe(true)
  expect(parent.root.findByProps({ 'data-native': name }).props.disabled).toBe(false)
  await act(async () => updateParent(false))
  expect(disabled()).toBe(false)
  expect(f.api.cliworker.permissionForWorker).toHaveBeenCalledTimes(2)

  // Another parent or an unrelated projection must not invalidate this child.
  await act(async () => {
    f.updateProjections('foreign-parent', { [key]: { currentValue: 'read-only', active: true } })
    f.updateProjections('parent', { tokenUsage: { synthetic: true } })
    updateParent(false)
  })
  expect(f.api.cliworker.permissionForWorker).toHaveBeenCalledTimes(2)
  const refresh = Promise.withResolvers<ReturnType<typeof permissionReceipt>>()
  f.api.cliworker.permissionForWorker.mockReturnValueOnce(refresh.promise)
  await act(async () => updateParent(true))
  expect(disabled()).toBe(true)
  const nativeProps = f.native[name]!.mock.calls.filter(([props]) => props.sessionId === 'child').at(-1)![0]
  expect(await nativeProps.select('read-only')).toBe(false)
  await act(async () => refresh.resolve(permissionReceipt(false)))
  expect(disabled()).toBe(true)
  await act(async () => updateParent(false))
  expect(disabled()).toBe(false)
  expect(f.api.cliworker.permissionForWorker).toHaveBeenCalledTimes(4)
  expect(f.api.cliworker.configureWorkerPermission).not.toHaveBeenCalled()
  expect(parent.root.findByProps({ 'data-native': name }).props.disabled).toBe(false)
  expect(f.sessionListeners.size).toBeGreaterThan(0)
  await act(async () => child.unmount())
  expect(f.sessionListeners.size).toBe(0)
})

it('cancels stale parent permission reads and releases public store subscriptions on unmount', async () => {
  const f = fixture()
  f.bindings.publish(binding, worker)
  const first = Promise.withResolvers<ReturnType<typeof permissionReceipt>>()
  const second = Promise.withResolvers<ReturnType<typeof permissionReceipt>>()
  const last = Promise.withResolvers<ReturnType<typeof permissionReceipt>>()
  f.api.cliworker.permissionForWorker
    .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(last.promise)
  const child = await f.mount(names[1])
  const firstSignal = f.api.cliworker.permissionForWorker.mock.calls[0]![2] as AbortSignal
  await act(async () => f.updateProjections('parent', { permissions: { currentValue: 'read-only' } }))
  expect(firstSignal.aborted).toBe(true)
  await act(async () => first.resolve(permissionReceipt(true)))
  expect(child.root.findByProps({ 'data-native': names[1] }).props.disabled).toBe(true)
  await act(async () => second.resolve(permissionReceipt(false)))
  expect(child.root.findByProps({ 'data-native': names[1] }).props.disabled).toBe(true)
  await act(async () => f.updateProjections('parent', { permissions: { currentValue: 'workspace-write' } }))
  const lastSignal = f.api.cliworker.permissionForWorker.mock.calls.at(-1)![2] as AbortSignal
  expect(lastSignal.aborted).toBe(false)
  await act(async () => child.unmount())
  expect(lastSignal.aborted).toBe(true)
  expect(f.sessionListeners.size).toBe(0)
  await act(async () => {
    last.resolve(permissionReceipt(true))
    f.updateProjections('parent', { plan: { active: true, pending: false } })
  })
  expect(f.api.cliworker.permissionForWorker).toHaveBeenCalledTimes(3)
  expect(f.api.cliworker.configureWorkerPermission).not.toHaveBeenCalled()
})

it.each(['parent-changed', 'unmounted'] as const)(
  'cancels a pending native permission save when %s without accepting its late result',
  async (event) => {
    const f = fixture()
    f.bindings.publish(binding, worker)
    const child = await f.mount(names[1])
    const latest = () => f.native[names[1]]!.mock.calls.filter(([props]) => props.sessionId === 'child').at(-1)![0]
    const save = Promise.withResolvers<{ ok: boolean; value: string }>()
    f.api.cliworker.configureWorkerPermission.mockReturnValueOnce(save.promise)
    let result!: Promise<boolean>
    await act(async () => { result = latest().select('read-only') })
    const signal = f.api.cliworker.configureWorkerPermission.mock.calls[0]![3] as AbortSignal
    expect(signal.aborted).toBe(false)
    await act(async () => f.updateProjections('parent', {
      permissions: { currentValue: 'workspace-write' }, plan: { active: false, pending: false },
    }))
    expect(signal.aborted).toBe(false)
    expect(f.api.cliworker.permissionForWorker).toHaveBeenCalledTimes(1)
    if (event === 'parent-changed') {
      f.api.cliworker.permissionForWorker.mockResolvedValueOnce(permissionReceipt(false))
      await act(async () => f.updateProjections('parent', { plan: { active: true, pending: false } }))
    } else {
      await act(async () => child.unmount())
      expect(f.sessionListeners.size).toBe(0)
    }
    expect(signal.aborted).toBe(true)
    await act(async () => {
      save.resolve({ ok: true, value: JSON.stringify({ ...worker, level: 'ask' }) })
      expect(await result).toBe(false)
    })
    if (event === 'parent-changed') {
      expect(latest().useProjection('permissions')).toEqual({ currentValue: 'workspace-write' })
      expect(latest().locked).toBe(true)
    }
  },
)

it.each(['read-first', 'save-first'] as const)(
  'keeps newer watched permission state when an older save receipt arrives (%s)',
  async (order) => {
    const f = fixture()
    f.bindings.publish(binding, worker)
    const tree = await f.mount(names[1])
    const latest = () =>
      f.native[names[1]]!.mock.calls.filter(([props]) => props.sessionId === 'child').at(-1)![0]
    const stateReceipt = (currentValue: 'ask' | 'auto') => ({
      ok: true,
      value: JSON.stringify({
        currentValue,
        writable: true,
        options: [
          { value: 'ask', name: '询问' },
          { value: 'auto', name: '自动审批' },
        ],
        plan: { supported: true, active: false },
      }),
    })
    const oldSave = Promise.withResolvers<{ ok: boolean; value: string }>()
    f.api.cliworker.configureWorkerPermission.mockReturnValueOnce(oldSave.promise)
    let pending!: Promise<boolean>
    await act(async () => {
      pending = latest().select('read-only')
    })
    expect(latest().locked).toBe(true)
    const updateWatch = async (level: 'ask' | 'auto') => {
      await act(async () => {
        f.updateSnapshot({ selected: { ...worker, level }, selectedBusy: false, queuedFollowups: [] })
        tree.update(createElement(f.core.entriesOfSlot(names[1])[0]!.component as any, f.props()))
      })
    }
    // The save was accepted as ask, then another native control changed it back
    // to auto before this control received its older save response.
    f.api.cliworker.permissionForWorker.mockResolvedValueOnce(stateReceipt('ask'))
    await updateWatch('ask')
    expect(latest().useProjection('permissions')).toEqual({ currentValue: 'read-only' })
    const newRead = Promise.withResolvers<ReturnType<typeof stateReceipt>>()
    f.api.cliworker.permissionForWorker.mockReturnValueOnce(newRead.promise)
    await updateWatch('auto')
    expect(latest().useProjection('permissions')).toEqual({ currentValue: 'workspace-write' })
    const settleRead = async () => {
      await act(async () => {
        newRead.resolve(stateReceipt('auto'))
      })
    }
    const settleSave = async () => {
      await act(async () => {
        oldSave.resolve({ ok: true, value: JSON.stringify({ ...worker, level: 'ask' }) })
        expect(await pending).toBe(true)
      })
      // Even before the latest read resolves, the old response must not replace
      // the newer level already received from the Worker watch.
      expect(latest().useProjection('permissions')).toEqual({ currentValue: 'workspace-write' })
    }
    if (order === 'read-first') {
      await settleRead()
      await settleSave()
    } else {
      await settleSave()
      await settleRead()
    }
    expect(latest().useProjection('permissions')).toEqual({ currentValue: 'workspace-write' })
    expect(latest().useProjection('plan')).toEqual({ active: false, pending: false })
    expect(latest().locked).toBe(false)
    expect(f.api.cliworker.permissionForWorker).toHaveBeenCalledTimes(3)
    expect(f.api.cliworker.configureWorkerPermission).toHaveBeenCalledExactlyOnceWith(
      'parent',
      'worker',
      'ask',
      expect.any(AbortSignal),
    )
  },
)


/** Capture the unmodified published rc.2 ModelSelect and its real children table. */
function officialModelSeat() {
  const sdk = selectBuildDependencies(resolve('.'), {})
  const requireDsh = createRequire(sdk.require.resolve('@deepseek-ai/dsh/package.json'))
  const source = requireDsh.resolve('@deepseek-ai/dsh-client-ui-model-selection/client')
  const icon = () => null
  const primitives = new Proxy({}, { get: (_target, name) => name === 'rankByName' ? (rows: unknown[]) => rows : icon })
  const dependencies: Record<string, unknown> = { react: React, 'react/jsx-runtime': ReactJsx,
    'react-dom': ReactDom, '@deepseek-ai/cordis': Cordis, '@deepseek-ai/dsh-client-store': Stores,
    '@deepseek-ai/dsh-client-ui-primitives': primitives }
  let plugin: any, registration: any
  runInNewContext(readFileSync(source, 'utf8'), { window: { __ModuleLoader__: {
    load: ({ factory }: any) => { plugin = factory((id: string) => dependencies[id]) },
  } }, AbortController, AbortSignal })
  const scope: any = { modelDirectories: {}, sessions: {}, slots: {
    inject: (_name: string, run: () => void) => run(),
    register: (options: any, component: ComponentType<any>) => { registration = { ...options, component }; return () => {} },
  } }
  plugin.apply({ effect: (run: () => unknown) => run(), locale: { register: () => () => {}, bind: () => (key: string) => key },
    plugin() {}, inject: (services: string[], run: (ctx: unknown) => void) => { if (services.includes('slots')) run(scope) },
  })
  if (!registration?.children?.['conversation.input.model.label']) throw new Error('Expected official model label child slot')
  return registration as { component: ComponentType<any>; children: Record<string, unknown> }
}

it('preserves the official rc2 model label seat, child CLI directory and empty parent model control', async () => {
  const registration = officialModelSeat()
  const f = fixture(undefined, registration)
  const label = 'conversation.input.model.label'
  const renderLabel = vi.fn(({ model }: any) => <span data-native-model-label>{model.name}</span>)
  const labelRelease = f.core.register({ name: label } as any, renderLabel as any)
  releases.push(labelRelease)
  const labelEntry = f.core.entries(label)[0]
  const shadow = f.core.entriesOfSlot(names[0])[0]!
  expect(shadow).not.toBe(f.original[0])
  expect(shadow.children).toBe(f.original[0]!.children)
  const renderSlot = vi.fn((name: string, owner: any) => {
    expect(name).toBe(label)
    return createElement(f.core.entriesOfSlot(name)[0]!.component as any, owner)
  })
  const emptyParent = createSnapshotStore<any>({ current: null, routable: null, groups: [], failures: [],
    status: 'ready', pending: null, error: null })
  const parentProps = { ...f.props('parent'), available: true, directory: emptyParent, renderSlot,
    load: vi.fn(), t: (key: string) => key === 'trigger.fallback' ? '请选择模型' : key }
  const parent = await f.mount(names[0], parentProps)
  expect(parent.root.findByType('button').props.title).toBe('请选择模型')
  const child = await f.mount(names[0], { ...f.props(), directory: emptyParent, renderSlot } as any)
  expect(child.toJSON()).toBeNull()
  await act(async () => f.bindings.publish(binding, worker))
  expect(child.root.findByType('button').props.disabled).toBe(false)
  expect(child.root.findByProps({ 'data-native-model-label': true }).children).toEqual(['gpt-5.4'])
  const childProps = f.native[names[0]]!.mock.calls.filter(([props]) => props.sessionId === 'child').at(-1)![0]
  expect(childProps.available).toBe(true)
  expect(childProps.renderSlot).toBe(renderSlot)
  expect(childProps.directory.getSnapshot().current.model).toBe('gpt-5.4')
  expect(f.api.cliworker.catalogForWorker).toHaveBeenCalledTimes(1)
  expect(parent.root.findByType('button').props.title).toBe('请选择模型')
  f.release()
  expect(f.core.entriesOfSlot(names[0])).toEqual([f.original[0]])
  expect(f.core.entries(label)).toEqual([labelEntry])
  expect(f.original[0]!.children).toBeDefined()
  f.originalReleases[0]!()
  expect(f.core.entries(label)).toEqual([])
})

it('shares guard leases and releases borrowed child metadata without removing native labels', async () => {
  const registration = officialModelSeat()
  const f = fixture(undefined, registration)
  const label = 'conversation.input.model.label'
  const releaseLabel = f.core.register({ name: label } as any, () => <span>label plugin</span>)
  releases.push(releaseLabel)
  const first = f.core.entriesOfSlot(names[0])[0]!
  const secondLease = installHarnessControlGuards({ slots: f.core } as any, f.bindings, f.api)
  releases.push(secondLease)
  expect(f.core.entries(names[0])).toHaveLength(2) // Native + one shared shadow.
  expect(f.core.entriesOfSlot(names[0])[0]).toBe(first)
  f.release(); f.release()
  expect(f.core.entriesOfSlot(names[0])[0]).toBe(first)
  expect(f.core.entries(label)).toHaveLength(1)
  secondLease(); secondLease()
  expect(f.core.entriesOfSlot(names[0])).toEqual([f.original[0]])
  expect(f.core.entries(label)).toHaveLength(1)
  expect(first.children).toBeUndefined()
  expect(f.original[0]!.children).toBe(registration.children)
})

it('drops the shadow when its native seat unloads and follows a fresh seat without stale label authority', async () => {
  const registration = officialModelSeat()
  const f = fixture(undefined, registration)
  const label = 'conversation.input.model.label'
  const oldShadow = f.core.entriesOfSlot(names[0])[0]!
  const releaseLabel = f.core.register({ name: label } as any, () => null)
  releases.push(releaseLabel)
  f.originalReleases[0]!()
  await act(async () => {})
  expect(f.core.entries(names[0])).toEqual([])
  expect(f.core.isLive(oldShadow)).toBe(false)
  expect(oldShadow.children).toBeUndefined()
  expect(f.core.entries(label)).toEqual([]) // Native owner release removes its declarations.
  const freshChildren = { ...registration.children }
  const restoreNative = f.core.register({ name: names[0], inject: f.inject, locale: 'conversation', children: freshChildren } as any, f.native[names[0]] as any)
  releases.push(restoreNative)
  await act(async () => {})
  const newShadow = f.core.entriesOfSlot(names[0])[0]!
  expect(newShadow).not.toBe(oldShadow)
  expect(newShadow.children).toBe(freshChildren)
  const reattachLabel = f.core.register({ name: label } as any, () => <span>fresh label</span>)
  releases.push(reattachLabel)
  f.release()
  expect(f.core.entriesOfSlot(names[0])).toHaveLength(1)
  expect(f.core.entries(label)).toHaveLength(1)
  expect(newShadow.children).toBeUndefined()
})
