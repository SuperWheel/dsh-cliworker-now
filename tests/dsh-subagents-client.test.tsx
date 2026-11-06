import { createElement, useContext } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { DshConversation, DshConversationContext, DshNativeComposer } from '../src/client/dsh-subagents.tsx'
import { installHarnessControlGuards } from '../src/client/harness-control-guards.tsx'
import { installHarnessNativeCommandMenu } from '../src/client/harness-native-command-menu.tsx'
import { HarnessBindingRegistry } from '../src/client/harness-binding-registry.ts'
import { useDshSubagents } from '../src/client/workers.ts'
import type { DshSubagent } from '../src/shared/types.ts'

// SIMULATION: native Session reference, public slots and Gateway receipts.
// No real Desktop, models or CLI processes. Native renderer output is labelled.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Tooltip: ({ children }: any) => children,
  Toast: () => null,
  IconGoalOutlineRegular: () => null,
  IconPlanOutlineRegular: () => null,
  IconPaperPlaneOutlineRegular: () => null,
  IconBranchOutlineRegular: () => null,
  IconDataOutlineRegular: () => null,
  PermissionIconFullAccessRegular: () => null,
  rankByName: () => [],
}))
const trees: ReactTestRenderer[] = [],
  cleanup: (() => void)[] = []
afterEach(async () => {
  await act(async () => trees.splice(0).forEach((tree) => tree.unmount()))
  cleanup
    .splice(0)
    .reverse()
    .forEach((close) => close())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
const child: DshSubagent = {
  id: 'native',
  parentSessionId: 'parent',
  name: '模拟 DSH',
  mode: 'continuable',
  status: 'running',
  createdAt: 1,
}
const deferred = () => {
  let resolve!: (value: any) => void
  const promise = new Promise<any>((done) => {
    resolve = done
  })
  return { resolve, promise }
}
function services() {
  let block: any
  const listeners = new Set<() => void>()
  const session: any = {
    getSnapshot: () => ({ openState: 'open' }),
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  const reference: any = {
    sessionId: 'native',
    ready: Promise.resolve({ sessionId: 'native', session }),
    release: vi.fn(),
  }
  const services: any = {
    sessions: { retain: vi.fn(() => reference) },
    conversation: {
      blocks: {
        storeFor: () => ({ getSnapshot: () => block }),
        set: vi.fn((_id, value) => {
          block = value
        }),
      },
    },
  }
  return { services, reference, listeners, session, block: () => block }
}
it.each(['continuable', 'one-shot', 'unknown'] as const)(
  'retains the exact %s native child and releases its reference/observer/block',
  async (mode) => {
    const f = services(),
      api: any = { cliworker: {} }
    const Native = () => {
      const scope = useContext(DshConversationContext)
      return <p data-native-record={scope?.child.id}>模拟原生记录与统计</p>
    }
    const render = vi.fn((reference) => {
      expect(reference).toBe(f.reference)
      return <Native />
    })
    let tree!: ReactTestRenderer
    await act(async () => {
      tree = create(
        <DshConversation
          services={f.services}
          child={{ ...child, mode }}
          api={api}
          renderConversation={render}
        />,
      )
    })
    trees.push(tree)
    expect(f.services.sessions.retain).toHaveBeenCalledWith(
      { parentSessionId: 'parent', childSessionId: 'native', mode },
      { source: 'cliworkerConversation', signal: expect.any(AbortSignal) },
    )
    expect(tree.root.findByProps({ 'data-native-record': 'native' }).children).toEqual(['模拟原生记录与统计'])
    expect(f.block()).toEqual(mode === 'continuable' ? undefined : { reason: '此 DSH 子 Agent 只读' })
    expect(f.listeners.size).toBe(1)
    await act(async () => tree.unmount())
    expect(f.reference.release).toHaveBeenCalledOnce()
    expect(f.listeners.size).toBe(0)
    expect(f.block()).toBeUndefined()
  },
)
it('surfaces native open failures and does not render another session', async () => {
  const f = services()
  f.reference.ready = Promise.resolve({ sessionId: 'foreign', session: f.session })
  const render = vi.fn(() => null)
  let tree!: ReactTestRenderer
  await act(async () => {
    tree = create(
      <DshConversation services={f.services} child={child} api={{} as any} renderConversation={render} />,
    )
  })
  trees.push(tree)
  expect(tree.root.findByProps({ role: 'alert' }).children.join('')).toContain('原生会话身份')
  expect(render).not.toHaveBeenCalled()
})
it('keeps native composer/statistics/inputs intact and waits for the stop Gateway receipt', async () => {
  const reply = deferred(),
    stopDshSubagent = vi.fn(() => reply.promise)
  const Native = vi.fn((props: any) => (
    <div>
      <p>模拟原生统计</p>
      <button onClick={props.stop}>模拟停止</button>
    </div>
  ))
  const originalProps: any = { inputActions: { submit: vi.fn() }, useInput: vi.fn(), useProjection: vi.fn() }
  let tree!: ReactTestRenderer
  await act(async () => {
    tree = create(
      <DshNativeComposer
        Native={Native}
        nativeProps={originalProps}
        context={{ child, api: { cliworker: { stopDshSubagent } } as any }}
      />,
    )
  })
  trees.push(tree)
  await act(async () => {
    tree.root.findByType('button').props.onClick()
  })
  expect(stopDshSubagent).toHaveBeenCalledWith('parent', 'native', expect.any(AbortSignal))
  expect(JSON.stringify(tree.toJSON())).toContain('正在停止')
  expect(JSON.stringify(tree.toJSON())).not.toContain('已停止')
  const lastProps = Native.mock.calls.at(-1)![0]
  expect(lastProps.inputActions).toBe(originalProps.inputActions)
  expect(lastProps.useProjection).toBe(originalProps.useProjection)
  await act(async () => {
    reply.resolve({ ok: false, error: { message: '模拟停止失败' } })
  })
  expect(tree.root.findByProps({ role: 'alert' }).children.join('')).toContain('模拟停止失败')
  expect(JSON.stringify(tree.toJSON())).not.toContain('已停止')
})
it.each(['one-shot', 'unknown'] as const)('blocks native input and stop in %s mode', async (mode) => {
  const Native = vi.fn(() => null),
    stopDshSubagent = vi.fn()
  let tree!: ReactTestRenderer
  await act(async () => {
    tree = create(
      <DshNativeComposer
        Native={Native}
        nativeProps={{}}
        context={{ child: { ...child, mode }, api: { cliworker: { stopDshSubagent } } as any }}
      />,
    )
  })
  trees.push(tree)
  expect(Native.mock.calls[0][0]).toMatchObject({
    stop: undefined,
    blocked: { reason: '此 DSH 子 Agent 只读' },
  })
  expect(stopDshSubagent).not.toHaveBeenCalled()
})
it('uses the shared native slot and hides model/permission/plan only in the DSH occurrence', async () => {
  const core = new SlotCore(),
    bindings = new HarnessBindingRegistry()
  const names = [
    'conversation.composer.bar',
    'conversation.input.model',
    'conversation.input.permission',
    'conversation.input.plan',
  ] as const
  core.register(
    {
      name: 'root',
      children: Object.fromEntries(names.map((name) => [name, { kind: 'single', scope: 'session' }])),
    } as any,
    () => null,
  )
  for (const name of names)
    core.register(
      { name } as any,
      ((props: any) => <button data-native={name} onClick={props.stop} />) as any,
    )
  cleanup.push(installHarnessControlGuards({ slots: core } as any, bindings))
  cleanup.push(installHarnessNativeCommandMenu({ slots: core } as any, bindings))
  const seats = names.map(
    (name) =>
      core.entries(name).toSorted((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0))[0]
        .component,
  )
  const stopDshSubagent = vi.fn(async () => ({ ok: true, value: '{"stopped":true}' }))
  let tree!: ReactTestRenderer
  await act(async () => {
    tree = create(
      <DshConversationContext.Provider value={{ child, api: { cliworker: { stopDshSubagent } } as any }}>
        {seats.map((Component, index) =>
          createElement(Component as any, { key: index, sessionId: 'native' }),
        )}
        {seats
          .slice(1)
          .map((Component, index) =>
            createElement(Component as any, { key: `other-${index}`, sessionId: 'ordinary' }),
          )}
      </DshConversationContext.Provider>,
    )
  })
  trees.push(tree)
  expect(tree.root.findAllByType('button')).toHaveLength(4) // 1 DSH bar + 3 unaffected ordinary controls.
  await act(async () => tree.root.findByProps({ 'data-native': 'conversation.composer.bar' }).props.onClick())
  expect(stopDshSubagent).toHaveBeenCalledOnce()
})
it('polls only while enabled and document-visible, aborts reads, clears timers and ignores stale session results', async () => {
  vi.useFakeTimers()
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  vi.stubGlobal('document', doc)
  const calls: AbortSignal[] = []
  const pending = deferred()
  const listDshSubagents = vi.fn((parent: string, signal: AbortSignal) => {
    calls.push(signal)
    return parent === 'old'
      ? pending.promise
      : Promise.resolve({ ok: true, value: JSON.stringify([{ ...child, parentSessionId: parent }]) })
  })
  const api: any = { cliworker: { listDshSubagents } }
  function Probe({ parent, enabled }: { parent: string; enabled: boolean }) {
    const state = useDshSubagents(api, parent, enabled)
    return <p>{state.rows.map((row) => row.parentSessionId).join(',')}</p>
  }
  let tree!: ReactTestRenderer
  await act(async () => {
    tree = create(<Probe parent="old" enabled />)
  })
  trees.push(tree)
  await act(async () => {
    tree.update(<Probe parent="new" enabled />)
  })
  expect(calls[0].aborted).toBe(true)
  await act(async () => {
    pending.resolve({ ok: true, value: JSON.stringify([{ ...child, parentSessionId: 'old' }]) })
  })
  expect(tree.root.findByType('p').children).toEqual(['new'])
  await act(async () => {
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
  })
  const before = listDshSubagents.mock.calls.length
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000)
  })
  expect(listDshSubagents).toHaveBeenCalledTimes(before)
  expect(vi.getTimerCount()).toBe(0)
  await act(async () => {
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
  })
  expect(listDshSubagents).toHaveBeenCalledTimes(before + 1)
  await act(async () => tree.update(<Probe parent="new" enabled={false} />))
  expect(tree.root.findByType('p').children).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
})

it('disposes a native event stream when the panel is hidden and reopens it on return without polling', async () => {
  vi.useFakeTimers()
  const disposals: ReturnType<typeof vi.fn>[] = []
  const listDshSubagents = vi.fn()
  const api: any = {
    cliworker: { watchDshSubagents: vi.fn(), listDshSubagents },
    $stream: vi.fn(() => {
      const end = deferred()
      const dispose = vi.fn(async () => {
        end.resolve(undefined)
      })
      disposals.push(dispose)
      return {
        dispose,
        async *[Symbol.asyncIterator]() {
          yield { value: JSON.stringify([child]), accept: vi.fn() }
          await end.promise
        },
      }
    }),
  }
  function Probe({ visible }: { visible: boolean }) {
    const state = useDshSubagents(api, 'parent', visible)
    return <p>{state.rows.length}</p>
  }
  let tree!: ReactTestRenderer
  await act(async () => {
    tree = create(<Probe visible />)
  })
  trees.push(tree)
  expect(tree.root.findByType('p').children).toEqual(['1'])
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000)
  })
  expect(listDshSubagents).not.toHaveBeenCalled()
  await act(async () => {
    tree.update(<Probe visible={false} />)
  })
  expect(disposals[0]).toHaveBeenCalledOnce()
  await act(async () => {
    tree.update(<Probe visible />)
  })
  expect(api.$stream).toHaveBeenCalledTimes(2)
  await act(async () => {
    tree.unmount()
  })
  expect(disposals[1]).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
