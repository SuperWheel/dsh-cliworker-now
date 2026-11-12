import { createElement, forwardRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { Panel } from '../src/client/panel.tsx'
import type { API, Snapshot } from '../src/client/workers.ts'
import type { Worker } from '../src/shared/types.ts'

// SIMULATION: native skins and Gateway are synthetic. The actual Panel,
// useWorkers and useMessageSubmissions run; no CLI, model or Desktop is used.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => ({
  ...(await import('./fixtures/process-primitives.tsx')).processPrimitives,
  writeClipboard: vi.fn().mockResolvedValue(true),
  Tooltip: ({ children }: any) => children,
  StateDot: () => createElement('span'),
  Switch: () => null,
  Modal: () => null,
  useDismissOnOutsidePointer: () => {},
  IconCheckOutlineRegular: () => createElement('svg'),
  IconChevronRightOutlineRegular: () => createElement('svg'),
  IconDatabaseOutlineRegular: () => createElement('svg'),
  IconGaugeOutlineRegular: () => createElement('svg'),
  IconSettingsOutlineRegular: () => createElement('svg'),
  IconSendOutlineRegular: () => createElement('svg'),
  IconCopyOutlineRegular: () => createElement('svg'),
  IconChevronDownOutlineRegular: () => createElement('svg'),
  IconTrashOutlineRegular: () => createElement('svg'),
  IconRefreshOutlineRegular: () => createElement('svg'),
  IconUserOutlineRegular: () => createElement('svg'),
  IconLinkOutlineRegular: () => createElement('svg'),
  MarkdownText: ({ text }: any) => createElement('div', {}, text),
  MenuItemButton: ({ children, onSelect, disabled }: any) =>
    createElement('button', { onClick: onSelect, disabled }, children),
  Menu: ({ anchor }: any) => anchor,
  Input: forwardRef(({ icon, className, ...props }: any, ref) =>
    createElement('span', { className }, icon, createElement('input', { ...props, ref })),
  ),
  Button: forwardRef(({ children, variant: _variant, size: _size, ...props }: any, ref) =>
    createElement('button', { type: 'button', ...props, ref }, children),
  ),
}))

const worker: Worker = {
  id: 'worker-native-composer',
  parentSessionId: 'parent',
  project: '/synthetic-native-composer',
  title: 'Synthetic native composer Worker',
  preference: { cli: 'opencode', model: 'synthetic-model', effort: 'low' },
  mode: 'accept-edits',
  status: 'completed',
  createdAt: '',
  updatedAt: '',
  runId: 'old-run',
  conversationId: 'synthetic-cli-session',
  harnessConversation: {
    sessionId: 'native-child',
    parentSessionId: 'parent',
    mode: 'continuable',
    capabilities: {
      send: true,
      queue: true,
      steer: true,
      stop: true,
      model: false,
      permission: false,
      plan: false,
      attachments: false,
      fork: false,
      skills: false,
      tools: false,
    },
  },
}

class Stream {
  private queue: string[] = []
  private wake?: () => void
  private closed = false
  accept = vi.fn()
  push(snapshot: Snapshot) {
    this.queue.push(JSON.stringify(snapshot))
    this.wake?.()
  }
  async dispose() {
    this.closed = true
    this.wake?.()
  }
  async *[Symbol.asyncIterator]() {
    while (!this.closed) {
      const text = this.queue.shift()
      if (text) yield { value: text, accept: this.accept }
      else
        await new Promise<void>((resolve) => {
          this.wake = resolve
        })
    }
  }
}

const mounted: ReactTestRenderer[] = []
afterEach(async () => {
  await act(async () => {
    for (const tree of mounted.splice(0)) tree.unmount()
  })
})

async function setup(overrides: Record<string, unknown> = {}, activeHarnessSessionId?: string) {
  const streams: Stream[] = []
  const native = vi.fn((_worker: Worker) => {
    return createElement('section', { 'data-native-content': true })
  })
  const submitMessage = vi.fn().mockResolvedValue({ ok: true, value: '{}' })
  const steerMessage = vi
    .fn()
    .mockResolvedValue({ ok: false, error: { message: 'Synthetic rejected steer' } })
  const retryQueuedFollowups = vi.fn().mockResolvedValue({ ok: true, value: '{}' })
  const api = {
    $stream: () => {
      const stream = new Stream()
      streams.push(stream)
      return stream
    },
    cliworker: {
      submitMessage,
      steerMessage,
      retryQueuedFollowups,
      catalogForWorker: vi.fn().mockResolvedValue({
        ok: true,
        value: JSON.stringify({
          cli: 'opencode',
          models: [{ id: 'synthetic-model', label: 'Synthetic model', efforts: ['low'] }],
        }),
      }),
      ...overrides,
    },
  } as unknown as API
  let tree!: ReactTestRenderer
  await act(async () => {
    tree = create(
      createElement(Panel, {
        api,
        sessionId: 'parent',
        renderHarnessConversation: native,
        activeHarnessSessionId,
      }),
    )
    mounted.push(tree)
  })
  let revision = 0
  const snapshot = (extra: Partial<Snapshot> = {}): Snapshot => ({
    workers: [worker],
    timeline: [],
    truncated: false,
    revision: ++revision,
    ...extra,
  })
  const push = async (extra: Partial<Snapshot> = {}) => {
    await act(async () => {
      streams.at(-1)!.push(snapshot({ selected: worker, ...extra }))
    })
  }
  await act(async () => {
    streams.at(-1)!.push(snapshot())
  })
  if (!activeHarnessSessionId)
    await act(async () => {
      tree.root.findByProps({ 'data-open-worker-id': worker.id }).props.onClick()
    })
  await push()
  return {
    tree,
    native,
    submitMessage,
    steerMessage,
    retryQueuedFollowups,
    push,
    text: () => JSON.stringify(tree.toJSON()),
  }
}

it('renders the native conversation with only its Worker identity and no legacy input, queue or submission actions', async () => {
  const t = await setup()
  await t.push({
    queuedFollowups: [{ id: 'old-paused', prompt: 'Synthetic paused', createdAt: '', state: 'paused' }],
  })
  expect(t.native).toHaveBeenCalled()
  expect(t.native.mock.calls.every((args) => args.length === 1)).toBe(true)
  expect(t.native.mock.calls.at(-1)?.[0]).toMatchObject({ id: worker.id })
  expect(t.tree.root.findAllByProps({ 'data-native-content': true })).toHaveLength(1)
  expect(t.tree.root.findAllByType('textarea')).toHaveLength(0)
  expect(t.tree.root.findAllByType('form')).toHaveLength(0)
  expect(t.tree.root.findAllByProps({ className: 'cwn-compose' })).toHaveLength(0)
  expect(t.tree.root.findAllByProps({ className: 'cwn-followup-row' })).toHaveLength(0)
  expect(t.tree.root.findAllByProps({ className: 'cwn-feed' })).toHaveLength(0)
  expect(t.submitMessage).not.toHaveBeenCalled()
  expect(t.steerMessage).not.toHaveBeenCalled()
  expect(t.retryQueuedFollowups).not.toHaveBeenCalled()
})

it('selects management for the native main child once and preserves an explicit return to the Worker list', async () => {
  const t = await setup({}, 'native-child')
  expect(t.native.mock.calls.at(-1)?.[0].id).toBe(worker.id)
  await act(async () =>
    t.tree.root
      .findAllByType('button')
      .find((button) => button.props['aria-label'] === '返回子 Agent 列表')!
      .props.onClick(),
  )
  await t.push()
  expect(t.tree.root.findAllByProps({ 'data-open-worker-id': worker.id })).toHaveLength(1)
  expect(t.tree.root.findAllByProps({ 'data-native-content': true })).toHaveLength(0)
  expect(t.submitMessage).not.toHaveBeenCalled()
})

it('keeps native input ownership during a running Worker and does not publish old queue rows as native inbox state', async () => {
  const t = await setup()
  await t.push({
    selected: { ...worker, status: 'running' },
    runningMessageMode: 'interrupt',
    queuedFollowups: [
      { id: 'old-paused', prompt: 'Synthetic old queue must stay private', createdAt: '', state: 'paused' },
    ],
  })
  expect(t.native.mock.calls.at(-1)).toEqual([expect.objectContaining({ id: worker.id, status: 'running' })])
  expect(t.text()).not.toContain('Synthetic old queue must stay private')
  expect(t.tree.root.findAllByType('textarea')).toHaveLength(0)
  expect(t.submitMessage).not.toHaveBeenCalled()
  expect(t.steerMessage).not.toHaveBeenCalled()
})

it('keeps the original Worker heading and task actions above the native body', async () => {
  const t = await setup()
  const head = t.tree.root.findByProps({ className: 'cwn-head' })
  expect(head.findByType('h2').children.join('')).toContain(worker.title)
  expect(head.findByProps({ 'aria-label': '返回子 Agent 列表' })).toBeTruthy()
  expect(head.findByProps({ 'aria-label': '任务选项' })).toBeTruthy()
  expect(t.tree.root.findAllByProps({ role: 'tablist' })).toHaveLength(0)
  await act(async () => head.findByProps({ 'aria-label': '返回子 Agent 列表' }).props.onClick())
  expect(t.tree.root.findAllByProps({ 'data-open-worker-id': worker.id })).toHaveLength(1)
  expect(t.tree.root.findAllByProps({ 'data-native-content': true })).toHaveLength(0)
  expect(t.submitMessage).not.toHaveBeenCalled()
  expect(t.retryQueuedFollowups).not.toHaveBeenCalled()
})
