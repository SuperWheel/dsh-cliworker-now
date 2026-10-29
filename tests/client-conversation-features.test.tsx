import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { Context, Service } from '@deepseek-ai/cordis'
import type { HarnessConversationBinding, Worker } from '../src/shared/types.ts'
import { HarnessBindingRegistry } from '../src/client/harness-binding-registry.ts'
import { readHarnessConversationBinding } from '../src/client/harness-conversation.tsx'
import { installHarnessNativeCommands } from '../src/client/harness-native-commands.ts'
import { installHarnessNativeCommandMenu } from '../src/client/harness-native-command-menu.tsx'
import { installHarnessControlGuards } from '../src/client/harness-control-guards.tsx'
import { harnessGoalEditor, openHarnessWorkerGoal } from '../src/client/harness-goal-editor.ts'
import { installHarnessWorkerGoal, WorkerGoalBar } from '../src/client/harness-worker-goal.tsx'
import {
  HarnessWorkerFork,
  installHarnessForkRouting,
  installHarnessForkMenu,
  workerForkCut,
} from '../src/client/harness-worker-fork.tsx'
import { installHarnessDomGuard } from '../src/client/harness-dom-guard.ts'
import { harnessFeatureReason } from '../src/client/harness-feature-support.ts'
import { useWorkers } from '../src/client/workers.ts'

// 模拟：Harness 槽位、Gateway、原生会话及 UI 控件；不调用真实 CLI、账号或模型。
vi.mock('../src/client/workers.ts', async (original) => ({
  ...(await original<typeof import('../src/client/workers.ts')>()),
  useWorkers: vi.fn(),
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => {
  const Icon = () => <i />
  return {
    Tooltip: ({ children, label }: any) => <span data-tooltip={label}>{children}</span>,
    Button: ({ children, icon, ...props }: any) => (
      <button {...props}>
        {icon}
        {children}
      </button>
    ),
    InlineEditor: (props: any) => (
      <textarea
        aria-label={props.label}
        value={props.value}
        onChange={props.onChange}
        onSave={props.onSave}
      />
    ),
    MenuItemButton: ({ children, onSelect, disabled }: any) => (
      <button disabled={disabled} onClick={onSelect}>
        {children}
      </button>
    ),
    Toast: ({ text }: any) => <span role="alert">{text}</span>,
    IconGoalOutlineRegular: Icon,
    IconPauseOutlineRegular: Icon,
    IconPlayOutlineRegular: Icon,
    IconEditOutlineRegular: Icon,
    IconTrashOutlineRegular: Icon,
    IconCheckOutlineRegular: Icon,
    IconCloseOutlineRegular: Icon,
    IconBranchOutlineRegular: Icon,
    IconPlanOutlineRegular: Icon,
    IconDataOutlineRegular: Icon,
    IconPaperPlaneOutlineRegular: Icon,
    IconPaperclipOutlineRegular: Icon,
    PermissionIconFullAccessRegular: Icon,
    rankByName: (items: any[], query: string) => items.filter((item) => item.name.includes(query) || item.label?.includes(query)),
  }
})
const trees: ReactTestRenderer[] = []
const releases: (() => void)[] = []
afterEach(async () => {
  await act(async () => {
    trees.splice(0).forEach((tree) => tree.unmount())
  })
  releases
    .splice(0)
    .reverse()
    .forEach((release) => release())
  vi.clearAllMocks()
})
const receipt = (value: unknown) => ({ ok: true, value: JSON.stringify(value) })
const binding: HarnessConversationBinding = {
  sessionId: 'child',
  parentSessionId: 'parent',
  mode: 'continuable',
  capabilities: Object.fromEntries(
    [
      'send',
      'queue',
      'steer',
      'stop',
      'model',
      'permission',
      'plan',
      'attachments',
      'fork',
      'forkEarlier',
      'goal',
      'feedback',
      'skills',
      'tools',
    ].map((feature) => [feature, true]),
  ) as HarnessConversationBinding['capabilities'],
}
const worker = {
  id: 'worker',
  parentSessionId: 'parent',
  status: 'completed',
  mode: 'accept-edits',
  preference: { cli: 'codex', model: '模拟模型', effort: 'high' },
  harnessConversation: binding,
} as Worker
function registry(next = binding) {
  const bindings = new HarnessBindingRegistry()
  bindings.publish(next, worker)
  return bindings
}
function commandFixture(next = binding) {
  let source: any
  const popupFor = vi.fn()
  const api = { $stream: vi.fn(), cliworker: { configureWorkerPermission: vi.fn() } }
  const features = {
    openFeedback: vi.fn(),
    fork: vi.fn(),
    forkReason: vi.fn(() => undefined as string | undefined),
  }
  const bindings = registry(next)
  const scope = {}
  const sessions = {
    subagentAddress: () => ({ parentSessionId: 'parent', childSessionId: 'child' }),
    binding: () => scope,
  }
  const release = installHarnessNativeCommands(
    {
      sessions,
      commandUi: { popupFor },
      inputTriggers: {
        registerSource: (candidate: any) => {
          source = candidate
          return () => {}
        },
      },
    } as any,
    bindings,
    api as any,
    undefined,
    features,
  )
  releases.push(release)
  return { source, api, popupFor, features, bindings }
}
const req = () => ({ query: '', position: 'leading', drilled: false, signal: new AbortController().signal })
const pick = (name: string) => ({
  session: { sessionId: 'child' },
  candidate: { name },
  span: {},
  via: 'menu',
})

describe('模拟：能力与菜单', () => {
  it.each(['原生主视图', '原生子会话侧栏'])('%s 的共享 composer 使用桥接源且保留四项入口', async () => {
    const f = commandFixture()
    const core = new SlotCore()
    core.register({ name: 'root', children: {
      'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
    } } as any, () => null)
    const inject = vi.fn(() => ({ toggleCommandMenu: vi.fn() }))
    const Native = vi.fn(() => null)
    core.register({ name: 'conversation.composer.bar', inject, locale: 'conversation', children: {
      'conversation.input.left': { kind: 'list', scope: 'session' },
    } } as any, Native)
    const original = core.entriesOfSlot('conversation.composer.bar')[0]!
    const release = installHarnessNativeCommandMenu({ slots: core } as any, f.bindings)
    releases.push(release)
    const entry = core.entriesOfSlot('conversation.composer.bar')[0]!
    expect(entry.inject).toBe(original.inject)
    expect(entry.children).toBe(original.children)
    expect(entry.locale).toBe('conversation')
    const operations = entry.inject?.('child' as never)
    await act(async () => trees.push(create(createElement(entry.component as any, {
      sessionId: 'child', ...operations,
    }))))
    const owner = Native.mock.calls.at(-1)![0] as any
    expect(owner.commandSource).toBe(f.source.name)
    expect(owner.toggleCommandMenu).toBe((operations as any).toggleCommandMenu)
    const rows = await f.source.candidates({ sessionId: 'child' }, req())
    expect(rows.map((row: any) => row.name)).toEqual(expect.arrayContaining(['goal', 'feedback', 'plan', 'fork']))
    f.source.onPick(pick('goal'))
    f.source.onPick(pick('feedback'))
    f.source.onPick(pick('fork'))
    expect(harnessGoalEditor(f.bindings).requests.get('child')).toBe(1)
    expect(f.features.openFeedback).toHaveBeenCalledExactlyOnceWith('child')
    expect(f.features.fork).toHaveBeenCalledExactlyOnceWith('child')
    release()
    expect(core.entriesOfSlot('conversation.composer.bar')).toEqual([original])
    expect(core.specDynamic('conversation.input.left')).toBeDefined()
  })
  it('热重载时作用域先销毁替身注册，原生输入框子槽位及其控件仍保留', () => {
    const core = new SlotCore()
    core.register({ name: 'root', children: {
      'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
    } } as any, () => null)
    core.register({ name: 'conversation.composer.bar', children: {
      'conversation.input.model': { kind: 'single', scope: 'session' },
      'conversation.input.left': { kind: 'list', scope: 'session' },
    } } as any, () => null)
    const model = () => null
    core.register({ name: 'conversation.input.model' } as any, model)
    // Like ctx.slots.register: the Cordis scope owns each registration's disposer.
    const scoped: (() => void)[] = []
    const slots = new Proxy(core, { get: (target, key) => key === 'register'
      ? (options: any, component: any) => { const dispose = target.register(options, component); scoped.push(dispose); return dispose }
      : (target as any)[key]?.bind?.(target) ?? (target as any)[key] })
    const release = installHarnessNativeCommandMenu({ slots } as any, new HarnessBindingRegistry())
    const shadow = core.entriesOfSlot('conversation.composer.bar')[0]!
    expect(shadow.children).toBeDefined()
    // Scope disposal runs first (newest effect), then the plugin's own cleanup.
    for (const dispose of scoped.reverse()) dispose()
    release()
    expect(core.specDynamic('conversation.input.model')).toBeDefined()
    expect(core.specDynamic('conversation.input.left')).toBeDefined()
    expect(core.entriesOfSlot('conversation.input.model').map((entry) => entry.component)).toEqual([model])
    expect(shadow.children).toBeUndefined()
  })
  it('普通/无会话保留原命令源；CLI 绑定晚到及清除时更新原生 composer', async () => {
    const core = new SlotCore()
    core.register({ name: 'root', children: {
      'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
    } } as any, () => null)
    const Native = vi.fn((_props: any) => null)
    core.register({ name: 'conversation.composer.bar' } as any, Native)
    const bindings = new HarnessBindingRegistry()
    releases.push(installHarnessNativeCommandMenu({ slots: core } as any, bindings))
    const entry = core.entriesOfSlot('conversation.composer.bar')[0]!
    let tree!: ReactTestRenderer
    for (const sessionId of [undefined, 'ordinary', 'child']) {
      await act(async () => {
        if (tree) tree.update(createElement(entry.component as any, { sessionId, commandSource: 'command' }))
        else { tree = create(createElement(entry.component as any, { sessionId, commandSource: 'command' })); trees.push(tree) }
      })
      expect(Native.mock.calls.at(-1)![0].commandSource).toBe('command')
    }
    await act(async () => bindings.publish(binding, worker))
    expect(Native.mock.calls.at(-1)![0].commandSource).toBe('cliworker-settings')
    await act(async () => bindings.clear())
    expect(Native.mock.calls.at(-1)![0].commandSource).toBe('command')
  })
  it('旧绑定可读取，新增能力默认为不可用并给出原因', () => {
    const { goal, feedback, forkEarlier, ...old } = binding.capabilities
    const read = readHarnessConversationBinding({ ...binding, capabilities: old }, 'parent')
    expect(read.capabilities).toMatchObject({ goal: false, feedback: false, forkEarlier: false, plan: true })
    expect(harnessFeatureReason(read, 'goal')).toBe('当前 CLI 不支持目标')
    expect(harnessFeatureReason(read, 'feedback')).toBe('当前 CLI 不支持反馈')
  })
  it('不支持的入口仍可见；选取、输入命令均不请求 Host、不打开弹窗', async () => {
    const next = {
      ...binding,
      capabilities: { ...binding.capabilities, plan: false, goal: false, feedback: false, fork: false },
      reasons: { plan: '当前 CLI 不支持规划模式', fork: '当前 CLI 不支持会话分支' },
    }
    const f = commandFixture(next)
    const candidates = await f.source.candidates({ sessionId: 'child' }, req())
    expect(candidates.map((candidate: any) => candidate.name)).toEqual([
      'goal',
      'plan',
      'feedback',
      'permission',
      'model',
      'fork',
    ])
    expect(candidates.find((candidate: any) => candidate.name === 'plan').description).toBe(
      '当前 CLI 不支持规划模式',
    )
    // Without plan mode the permission levels still apply, so /permission stays usable.
    expect(candidates.find((candidate: any) => candidate.name === 'permission').description).toBe(
      '选择当前 CLI 的权限模式',
    )
    for (const name of ['plan', 'goal', 'feedback', 'fork']) {
      expect(f.source.onPick(pick(name))).toBe('handled')
      await expect(
        f.source.matchEnter({ sessionId: 'child' }, `/${name}`, req().signal, { attachments: 0 }),
      ).resolves.toBe('handled')
    }
    expect(f.api.$stream).not.toHaveBeenCalled()
    expect(f.popupFor).not.toHaveBeenCalled()
    expect(f.features.openFeedback).not.toHaveBeenCalled()
    expect(f.features.fork).not.toHaveBeenCalled()
    expect(harnessGoalEditor(f.bindings).requests.size).toBe(0)
  })
  it('反馈只打开 Harness 子会话反馈；目标打开插件编辑；最新分支调用插件入口', async () => {
    const f = commandFixture()
    f.source.onPick(pick('feedback'))
    expect(f.features.openFeedback).toHaveBeenCalledExactlyOnceWith('child')
    f.source.onPick(pick('goal'))
    expect(harnessGoalEditor(f.bindings).requests.get('child')).toBe(1)
    f.source.onPick(pick('fork'))
    expect(f.features.fork).toHaveBeenCalledExactlyOnceWith('child')
    f.features.forkReason.mockReturnValue('请等待当前运行结束后再分支')
    const rows = await f.source.candidates({ sessionId: 'child' }, req())
    expect(rows.find((row: any) => row.name === 'fork').description).toContain('等待')
    f.source.onPick(pick('fork'))
    expect(f.features.fork).toHaveBeenCalledTimes(1)
    expect(f.api.$stream).not.toHaveBeenCalled()
  })
})

function goalFixture(goal?: Worker['goal']) {
  const bindings = registry()
  let selected = { ...worker, goal }
  vi.mocked(useWorkers).mockImplementation(
    () => ({ snapshot: { selected }, connecting: false, error: '' }) as any,
  )
  const api = {
    cliworker: {
      setWorkerGoal: vi.fn(async (_p, _w, objective, revision) =>
        receipt({ objective, status: 'active', revision: revision + 1, updatedAt: '模拟' }),
      ),
      setWorkerGoalStatus: vi.fn(async (_p, _w, status, revision) =>
        receipt({
          ...goal,
          objective: goal?.objective ?? '新目标',
          status,
          revision: revision + 1,
          updatedAt: '模拟',
        }),
      ),
      clearWorkerGoal: vi.fn(async () => ({ ok: true, value: undefined })),
    },
  }
  let tree!: ReactTestRenderer
  const mount = async () => {
    await act(async () => {
      tree = create(<WorkerGoalBar api={api as any} bindings={bindings} binding={bindings.get('child')!} />)
      trees.push(tree)
    })
    return tree
  }
  const button = (label: string) => tree.root.findByProps({ 'aria-label': label, type: 'button' })
  return {
    bindings,
    api,
    mount,
    button,
    setWorker: (next: Worker) => {
      selected = next as typeof selected
    },
  }
}
describe('模拟：GoalBar 与 revision', () => {
  it('设置无目标时 revision=0，编辑、暂停、恢复和清除使用最新返回 revision', async () => {
    const f = goalFixture()
    const tree = await f.mount()
    expect(tree.toJSON()).toBeNull()
    await act(async () => openHarnessWorkerGoal(f.bindings, 'child'))
    await act(async () => tree.root.findByType('textarea').props.onChange('  新目标  '))
    await act(async () => f.button('保存目标').props.onClick())
    expect(f.api.cliworker.setWorkerGoal).toHaveBeenCalledExactlyOnceWith(
      'parent',
      'worker',
      '新目标',
      0,
      expect.any(AbortSignal),
    )
    expect(JSON.stringify(tree.toJSON())).toContain('新目标')
    await act(async () => f.button('暂停目标').props.onClick())
    expect(f.api.cliworker.setWorkerGoalStatus).toHaveBeenLastCalledWith(
      'parent',
      'worker',
      'paused',
      1,
      expect.any(AbortSignal),
    )
    expect(JSON.stringify(tree.toJSON())).toContain('已暂停的目标')
    await act(async () => f.button('恢复目标').props.onClick())
    expect(f.api.cliworker.setWorkerGoalStatus).toHaveBeenLastCalledWith(
      'parent',
      'worker',
      'active',
      2,
      expect.any(AbortSignal),
    )
    await act(async () => f.button('编辑目标').props.onClick())
    await act(async () => tree.root.findByType('textarea').props.onChange('编辑后的目标'))
    await act(async () => f.button('保存目标').props.onClick())
    expect(f.api.cliworker.setWorkerGoal).toHaveBeenLastCalledWith(
      'parent',
      'worker',
      '编辑后的目标',
      3,
      expect.any(AbortSignal),
    )
    await act(async () => f.button('清除目标').props.onClick())
    expect(f.api.cliworker.clearWorkerGoal).toHaveBeenCalledExactlyOnceWith(
      'parent',
      'worker',
      4,
      expect.any(AbortSignal),
    )
    expect(tree.toJSON()).toBeNull()
  })
  it('保留 Host revision 冲突错误，等待期间不重复发送；卸载中止请求', async () => {
    const f = goalFixture({ objective: '已有目标', status: 'paused', revision: 7, updatedAt: '模拟' })
    const tree = await f.mount()
    f.api.cliworker.setWorkerGoalStatus.mockResolvedValueOnce({
      ok: false,
      error: { message: '目标已被修改，请刷新后重试' },
    } as any)
    await act(async () => f.button('恢复目标').props.onClick())
    expect(JSON.stringify(tree.toJSON())).toContain('目标已被修改')
    let resolve!: (value: any) => void
    f.api.cliworker.setWorkerGoalStatus.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    await act(async () => {
      f.button('恢复目标').props.onClick()
      f.button('恢复目标').props.onClick()
    })
    expect(f.api.cliworker.setWorkerGoalStatus).toHaveBeenCalledTimes(2)
    const signal = f.api.cliworker.setWorkerGoalStatus.mock.calls[1]![4]
    await act(async () => tree.unmount())
    trees.splice(trees.indexOf(tree), 1)
    expect(signal.aborted).toBe(true)
    resolve(receipt({ objective: '旧响应', status: 'active', revision: 8 }))
  })
  it('同 id goal 槽位替换；普通会话委托原组件和原 inject，CLI 不创建原生目标服务', async () => {
    const f = goalFixture()
    const core = new SlotCore()
    core.register(
      { name: 'root', children: { 'conversation.input.dock': { kind: 'list', scope: 'session' } } } as any,
      () => null,
    )
    const inject = vi.fn(() => ({ marker: 'native' }))
    const Native = vi.fn((props: any) => <span>{props.marker}</span>)
    core.register({ name: 'conversation.input.dock', id: 'goal', inject } as any, Native)
    releases.push(installHarnessWorkerGoal({ slots: core } as any, f.bindings, f.api as any))
    const entry = core.entriesOfSlot('conversation.input.dock')[0]!
    expect(entry.options.id).toBe('goal')
    expect(entry.inject?.('child' as never)).toEqual({})
    expect(inject).not.toHaveBeenCalled()
    const props = entry.inject?.('ordinary' as never)
    await act(async () => {
      trees.push(create(createElement(entry.component as any, { sessionId: 'ordinary', ...props })))
    })
    expect(Native).toHaveBeenCalled()
    expect(inject).toHaveBeenCalledExactlyOnceWith('ordinary')
    expect(f.api.cliworker.setWorkerGoal).not.toHaveBeenCalled()
  })
})

function forkFixture(next = binding) {
  const bindings = registry(next)
  let state = { running: false, pendingSubmissions: [] as unknown[] }
  let inbox = { 'next-turn': [] as unknown[], 'next-step': [] as unknown[] }
  const nativeFork = vi.fn(async () => 'ordinary-child')
  const turns = [1, 2].map((turn) => ({
    turn,
    end: { seq: turn * 10, data: { reason: { kind: 'completed' } } },
    data: new Map([['turn-tail', { closing: { finalNode: { messageId: `assistant-${turn}` } } }]]),
  }))
  const services: any = {
    sessions: {
      fork: nativeFork,
      binding: () => ({
        session: { getSnapshot: () => state, projections: { faceOf: () => ({ getSnapshot: () => inbox }) } },
      }),
    },
    uiConversation: {
      binding: () => ({
        target: () => ({
          getSnapshot: () => ({ timeline: { turns: new Map(turns.map((turn) => [turn.turn, turn])) } }),
        }),
      }),
    },
    uiWorkspace: { openSession: vi.fn() },
  }
  const api = {
    cliworker: {
      forkWorker: vi.fn(async () => receipt({ workerId: 'new-worker', childSessionId: 'new-child' })),
    },
  }
  const forks = new HarnessWorkerFork(services, bindings, api as any)
  const snapshot: any = { selected: worker, workers: [], queuedFollowups: [] }
  forks.update('child', snapshot)
  releases.push(() => forks.dispose())
  return {
    bindings,
    services,
    api,
    forks,
    nativeFork,
    snapshot,
    turns,
    setState: (next: Partial<typeof state>) => {
      state = { ...state, ...next }
    },
    setInbox: (next: typeof inbox) => {
      inbox = next
    },
  }
}
describe('模拟：原生分支入口改道', () => {
  it.each(['error', 'interrupted'])('第一轮完成、第二轮输出后 %s，失败轮按钮保持禁用且不静默分支第一轮', async (kind) => {
    const f = forkFixture()
    f.turns[1]!.end.data.reason.kind = kind
    expect(f.forks.turns('child')).toEqual([{ turn: 1, seq: 10, messageId: 'assistant-1' }])
    expect(f.forks.cut('child', { turn: 1 })).toEqual({ atMessageId: '' })
    const cut = () => f.forks.cut('child', { turn: 2 })
    expect(cut().reason).toContain('已完成')
    const attrs = new Map([['aria-label', '在新对话中分支']])
    const button: any = { disabled: false,
      getAttribute: (name: string) => attrs.get(name) ?? null,
      setAttribute: (name: string, value: string) => attrs.set(name, value),
      removeAttribute: (name: string) => attrs.delete(name), closest: () => button,
    }
    const listeners = new Map<string, any>()
    const root: any = { querySelectorAll: () => [button], contains: () => true,
      addEventListener: (name: string, fn: any) => listeners.set(name, fn),
      removeEventListener: (name: string) => listeners.delete(name), ownerDocument: {},
    }
    releases.push(installHarnessDomGuard(root, binding, undefined, {
      reason: () => f.forks.reason('child', cut()), fork: () => { void f.forks.fork('child', cut()) },
    }))
    expect(button.disabled).toBe(true)
    expect(attrs.has('title')).toBe(false)
    for (const type of ['click', 'keydown']) listeners.get(type)({
      type, key: 'Enter', target: button, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(),
    })
    releases.push(installHarnessForkRouting(f.services, f.forks))
    await f.services.sessions.fork({ sessionId: 'child', atSeq: 20 })
    expect(f.api.cliworker.forkWorker).not.toHaveBeenCalled()
    expect(f.nativeFork).not.toHaveBeenCalled()
    expect(f.services.uiWorkspace.openSession).not.toHaveBeenCalled()
    expect(f.forks.getError()).toBe('')
    await f.forks.fork('child', f.forks.cut('child', { turn: 1 }))
    expect(f.api.cliworker.forkWorker).toHaveBeenCalledExactlyOnceWith('parent', 'worker', '', expect.any(AbortSignal))
  })
  it('completed 但没有助手消息的空轮不能作为截点', () => {
    const f = forkFixture()
    f.turns[1]!.data.clear()
    expect(f.forks.turns('child')).toHaveLength(1)
    expect(f.forks.cut('child', { turn: 2 }).reason).toContain('已完成')
  })
  it('最新完成助手轮用空串，较早轮用助手消息 id；拒绝非完成边界', () => {
    const turns = [
      { turn: 1, seq: 10, messageId: 'a1' },
      { turn: 2, seq: 20, messageId: 'a2' },
    ]
    expect(workerForkCut(turns)).toEqual({ atMessageId: '' })
    expect(workerForkCut(turns, { turn: 2 })).toEqual({ atMessageId: '' })
    expect(workerForkCut(turns, { seq: 10 })).toEqual({ atMessageId: 'a1' })
    expect(workerForkCut(turns, { seq: 12 }).reason).toContain('已完成')
  })
  it('共享 sessions.fork 接管工作区菜单/快捷键/消息截点，普通会话保留原生行为并在卸载恢复', async () => {
    const f = forkFixture()
    const release = installHarnessForkRouting(f.services, f.forks)
    await f.services.sessions.fork({ sessionId: 'child' })
    await f.services.sessions.fork({ sessionId: 'child', atSeq: 10 })
    await f.services.sessions.fork({ sessionId: 'child', atSeq: 20 })
    expect(f.api.cliworker.forkWorker.mock.calls.map((call: any) => call.slice(0, 3))).toEqual([
      ['parent', 'worker', ''],
      ['parent', 'worker', 'assistant-1'],
      ['parent', 'worker', ''],
    ])
    expect(f.nativeFork).not.toHaveBeenCalled()
    expect(f.services.uiWorkspace.openSession).toHaveBeenCalledWith({
      parentSessionId: 'parent',
      childSessionId: 'new-child',
      mode: 'continuable',
    })
    await f.services.sessions.fork({ sessionId: 'ordinary', atSeq: 10 })
    expect(f.nativeFork).toHaveBeenCalledExactlyOnceWith({ sessionId: 'ordinary', atSeq: 10 })
    release()
    expect(f.services.sessions.fork).toBe(f.nativeFork)
  })
  it('不支持分支/较早截点、运行中/待发时均不请求 Host、不执行 Harness 原生分支', async () => {
    const f = forkFixture({ ...binding, capabilities: { ...binding.capabilities, forkEarlier: false } })
    releases.push(installHarnessForkRouting(f.services, f.forks))
    expect(f.forks.reason('child', f.forks.cut('child', { turn: 1 }))).toBe('当前 CLI 只支持从最新一轮分支')
    await f.services.sessions.fork({ sessionId: 'child', atSeq: 10 })
    f.setState({ running: true })
    expect(f.forks.reason('child')).toContain('等待当前运行结束')
    await f.services.sessions.fork({ sessionId: 'child' })
    f.setState({ running: false })
    f.setInbox({ 'next-turn': [{ id: 'queued' }], 'next-step': [] })
    await f.services.sessions.fork({ sessionId: 'child' })
    f.bindings.publish(
      {
        ...binding,
        capabilities: { ...binding.capabilities, fork: false },
        reasons: { fork: '当前 CLI 不支持会话分支：模拟原因' },
      },
      worker,
    )
    expect(f.forks.reason('child')).toContain('模拟原因')
    await f.services.sessions.fork({ sessionId: 'child' })
    expect(f.api.cliworker.forkWorker).not.toHaveBeenCalled()
    expect(f.nativeFork).not.toHaveBeenCalled()
    expect(f.forks.getError()).toBe('')
  })
  it('Host 分支失败可见，卸载取消中的分支不导航', async () => {
    const f = forkFixture()
    f.api.cliworker.forkWorker.mockResolvedValueOnce({
      ok: false,
      error: { message: '模拟：原生分支失败' },
    } as any)
    await f.forks.fork('child')
    expect(f.forks.getError()).toContain('模拟：原生分支失败')
    let resolve!: (value: any) => void
    f.api.cliworker.forkWorker.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const pending = f.forks.fork('child')
    const signal = (f.api.cliworker.forkWorker.mock.calls[1] as any)[3]
    f.forks.dispose()
    resolve(receipt({ workerId: 'new', childSessionId: 'late' }))
    await pending
    expect(signal.aborted).toBe(true)
    expect(f.services.uiWorkspace.openSession).not.toHaveBeenCalled()
  })
  it('真实 Cordis Service 的跨作用域快捷键闭包命中同一分支路由，卸载恢复原型方法', async () => {
    const f = forkFixture()
    const root = new Context()
    const ordinary = vi.fn(async () => 'ordinary-child')
    class SimulatedSessions extends Service {
      constructor(ctx: Context) {
        super(ctx, 'sessions')
      }
      fork(options: any) {
        return ordinary(options)
      }
      binding = f.services.sessions.binding
    }
    new SimulatedSessions(root)
    const owner = root.extend()
    const caller = root.extend()
    // 模拟 Harness 在插件安装前已捕获 navigation 对象的快捷键。
    const keyboard = () => caller.sessions.fork({ sessionId: 'child' as any })
    const services = { ...f.services, sessions: owner.sessions }
    const controller = new HarnessWorkerFork(services, f.bindings, f.api as any)
    controller.update('child', f.snapshot)
    const restore = installHarnessForkRouting(services, controller)
    await keyboard()
    expect(f.api.cliworker.forkWorker).toHaveBeenCalledExactlyOnceWith(
      'parent',
      'worker',
      '',
      expect.any(AbortSignal),
    )
    expect(ordinary).not.toHaveBeenCalled()
    restore()
    controller.dispose()
    await keyboard()
    expect(ordinary).toHaveBeenCalledExactlyOnceWith({ sessionId: 'child' })
  })
  it('工作区分支菜单保留禁用项并显示具体原因', async () => {
    const f = forkFixture({
      ...binding,
      capabilities: { ...binding.capabilities, fork: false },
      reasons: { fork: '当前 CLI 不支持分支：模拟' },
    })
    const core = new SlotCore()
    core.register(
      {
        name: 'root',
        children: { 'sidebar.workspaces.session.menu.item': { kind: 'list', scope: 'root' } },
      } as any,
      () => null,
    )
    const Native = vi.fn(() => <button>native</button>)
    core.register(
      {
        name: 'sidebar.workspaces.session.menu.item',
        id: 'fork',
        inject: () => ({ forkSession: f.nativeFork }),
      } as any,
      Native,
    )
    releases.push(installHarnessForkMenu({ slots: core } as any, f.bindings, f.forks))
    const entry = core.entriesOfSlot('sidebar.workspaces.session.menu.item')[0]!
    let tree!: ReactTestRenderer
    await act(async () => {
      tree = create(
        createElement(entry.component as any, {
          sessionId: 'child',
          useMenuOpenState: () => [true, vi.fn()],
        }),
      )
      trees.push(tree)
    })
    expect(tree.root.findByType('button').props.disabled).toBe(true)
    expect(JSON.stringify(tree.toJSON())).toContain('当前 CLI 不支持分支：模拟')
    await act(async () => tree.root.findByType('button').props.onClick())
    expect(f.api.cliworker.forkWorker).not.toHaveBeenCalled()
    expect(f.nativeFork).not.toHaveBeenCalled()
  })
})

it('模拟：不支持规划的 CLI 子会话不显示规划按钮，普通会话保留原生 PlanChip，不读取/保存权限', async () => {
  const core = new SlotCore()
  const names = ['conversation.input.permission', 'conversation.input.plan']
  core.register(
    {
      name: 'root',
      children: Object.fromEntries(names.map((name) => [name, { kind: 'single', scope: 'session' }])),
    } as any,
    () => null,
  )
  const Native = (props: any) => (
    <button disabled={props.locked} onClick={() => props.select?.('read-only')}>
      权限
    </button>
  )
  names.forEach((name) => core.register({ name } as any, Native))
  const bindings = registry({
    ...binding,
    capabilities: { ...binding.capabilities, plan: false },
    reasons: { plan: '当前 CLI 不支持规划模式' },
  })
  const api = { cliworker: { permissionForWorker: vi.fn(), configureWorkerPermission: vi.fn() } }
  releases.push(installHarnessControlGuards({ slots: core } as any, bindings, api as any))
  for (const name of names.filter((name) => name.endsWith('.plan'))) {
    const entry = core.entriesOfSlot(name)[0]!
    let tree!: ReactTestRenderer
    await act(async () => {
      tree = create(createElement(entry.component as any, { sessionId: 'child' }))
      trees.push(tree)
    })
    // The seat stays empty; the "+" menu row still carries the reason.
    expect(tree.toJSON()).toBeNull()
    let other!: ReactTestRenderer
    await act(async () => {
      other = create(createElement(entry.component as any, { sessionId: 'unbound' }))
      trees.push(other)
    })
    expect(other.root.findByType('button').props.disabled).toBeFalsy()
  }
  expect(api.cliworker.permissionForWorker).not.toHaveBeenCalled()
  expect(api.cliworker.configureWorkerPermission).not.toHaveBeenCalled()
})

it('模拟：消息分支按钮捕获点击及键盘，禁用不调用，清理恢复原状态', () => {
  const attrs = new Map([
    ['aria-label', '在新对话中分支'],
    ['data-unavailable', ''],
    ['aria-disabled', 'true'],
  ])
  const button: any = {
    disabled: false,
    getAttribute: (key: string) => attrs.get(key) ?? null,
    setAttribute: (key: string, val: string) => attrs.set(key, val),
    removeAttribute: (key: string) => attrs.delete(key),
    closest: () => button,
  }
  const listeners = new Map<string, any>()
  const root: any = {
    querySelectorAll: () => [button],
    contains: () => true,
    addEventListener: (name: string, listener: any) => listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
    ownerDocument: {},
  }
  let reason: string | undefined
  const fork = vi.fn()
  const targets = vi.fn()
  const release = installHarnessDomGuard(root, binding, targets, { reason: () => reason, fork })
  expect(button.disabled).toBe(false)
  // An available fork keeps only the native button's tooltip.
  expect(targets).toHaveBeenLastCalledWith([])
  expect(attrs.has('title')).toBe(false)
  expect(attrs.has('data-cwn-reason-tooltip')).toBe(false)
  expect(attrs.has('data-unavailable')).toBe(false)
  const event = (extra = {}) => ({
    type: 'click',
    target: button,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...extra,
  })
  const click = event()
  listeners.get('click')(click)
  expect(click.stopImmediatePropagation).toHaveBeenCalledOnce()
  expect(fork).toHaveBeenCalledExactlyOnceWith(button)
  reason = '当前 CLI 只支持从最新一轮分支'
  const blocked = event({ type: 'keydown', key: 'Enter' })
  listeners.get('keydown')(blocked)
  expect(blocked.preventDefault).toHaveBeenCalledOnce()
  expect(fork).toHaveBeenCalledTimes(1)
  const arrow = event({ type: 'keydown', key: 'ArrowDown' })
  listeners.get('keydown')(arrow)
  expect(arrow.preventDefault).not.toHaveBeenCalled()
  release()
  expect(attrs.get('aria-disabled')).toBe('true')
  expect(attrs.get('data-unavailable')).toBe('')
  expect(listeners.size).toBe(0)
})
