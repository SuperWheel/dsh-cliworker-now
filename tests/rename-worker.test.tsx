import { createElement, forwardRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { RenameWorker } from '../src/client/rename-worker.tsx'
import { setLanguagePreference } from '../src/client/i18n.ts'
import type { Worker } from '../src/shared/types.ts'

// Native control skins are replaced; actual editing, RPC choice and cancellation run.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Modal: ({ title, children, onClose, closeLabel, contentClassName }: any) =>
    createElement(
      'section',
      { role: 'dialog', 'aria-label': title, 'data-content-class': contentClassName },
      createElement('button', { type: 'button', 'aria-label': closeLabel, onClick: onClose }),
      children,
    ),
  Input: forwardRef(({ className, ...props }: any, ref) =>
    createElement('span', { className }, createElement('input', { ...props, ref })),
  ),
  Button: ({ children, size: _size, variant: _variant, ...props }: any) =>
    createElement('button', props, children),
  StateDot: () => createElement('span', { 'data-saving': true }),
}))

const mounted: ReactTestRenderer[] = []
afterEach(async () => {
  await act(async () => {
    for (const renderer of mounted.splice(0)) renderer.unmount()
  })
  setLanguagePreference('follow')
})
const worker: Worker = {
  id: 'synthetic-worker',
  parentSessionId: 'synthetic-parent',
  project: '/synthetic',
  title: 'Synthetic chat',
  agentName: 'agy-1',
  preference: { cli: 'antigravity', model: 'synthetic-model', effort: 'low' },
  mode: 'accept-edits',
  status: 'completed',
  runId: 'synthetic-run',
  createdAt: '',
  updatedAt: '',
}

async function fixture(mode: 'name' | 'title') {
  const renameWorker = vi.fn().mockResolvedValue({ ok: true, value: undefined })
  const renameWorkerTitle = vi.fn().mockResolvedValue({ ok: true, value: undefined })
  const onClose = vi.fn()
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(
      <RenameWorker
        api={{ cliworker: { renameWorker, renameWorkerTitle } } as any}
        sessionId="synthetic-parent"
        worker={worker}
        mode={mode}
        onClose={onClose}
      />,
    )
    mounted.push(renderer)
  })
  const edit = async (text: string) =>
    act(async () => renderer.root.findByType('input').props.onChange({ target: { value: text } }))
  const submit = async () =>
    act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  return { renderer, renameWorker, renameWorkerTitle, onClose, edit, submit }
}

it.each(['name', 'title'] as const)(
  'uses the same compact %s editor without an empty error region, and preserves native initial focus',
  async (mode) => {
    const f = await fixture(mode)
    expect(f.renderer.root.findByProps({ role: 'dialog' }).props['data-content-class']).toBe(
      'cwn-rename-content',
    )
    expect(f.renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
    const input = f.renderer.root.findByType('input')
    expect(input.props.value).toBe(mode === 'title' ? worker.title : worker.agentName)
    expect(input.props.maxLength).toBe(mode === 'title' ? 160 : 32)
    if (mode === 'title') expect(f.renderer.root.findAllByType('p')).toHaveLength(0)
    expect(input.props['data-modal-autofocus']).toBe(true)
    expect(input.props.autoFocus).toBeUndefined()
    await f.edit(mode === 'title' ? '  Updated value  ' : 'updated-value')
    await f.submit()
    const action = mode === 'title' ? f.renameWorkerTitle : f.renameWorker
    const other = mode === 'title' ? f.renameWorker : f.renameWorkerTitle
    expect(action).toHaveBeenCalledWith(
      'synthetic-parent',
      worker.id,
      mode === 'title' ? 'Updated value' : 'updated-value',
      expect.any(AbortSignal),
    )
    expect(other).not.toHaveBeenCalled()
    expect(f.onClose).toHaveBeenCalledOnce()
  },
)

it.each([
  ['', '名称不能为空'],
  ['a'.repeat(33), '名称最多 32 个字符'],
  [' reviewer', '名称不能包含空格'],
  ['Reviewer', '名称不能使用大写字母，请改成小写'],
  ['review_er', '名称不能包含下划线，可改用连字符（-）'],
  ['审稿人', '名称只能使用小写英文字母、数字和连字符（-），不能包含中文或其他符号'],
  ['reviewer!', '名称只能使用小写英文字母、数字和连字符（-），不能包含中文或其他符号'],
  ['1reviewer', '名称必须以小写英文字母开头'],
  ['-reviewer', '名称必须以小写英文字母开头'],
  ['lead', '“lead” 保留给 DSH 主 Agent，请换一个名称'],
])('reports the concrete validation problem for %j as the user types', async (draft, problem) => {
  const f = await fixture('name')
  await f.edit(draft)
  expect(f.renderer.root.findByProps({ role: 'alert' }).children).toEqual([problem])
  expect(f.renderer.root.findByType('input').props['aria-invalid']).toBe(true)
  await f.submit()
  expect(f.renameWorker).not.toHaveBeenCalled()
  expect(f.renderer.root.findByType('input').props.value).toBe(draft)
  expect(f.onClose).not.toHaveBeenCalled()
})

it.each([
  '同父会话已有子 Agent 使用“reviewer”',
  '“reviewer”是另一个子 Agent 的曾用名',
  '无法读取 DSH 子 Agent 目录，请重试',
])('preserves the draft and displays the simulated Host rejection verbatim (%s)', async (message) => {
  const f = await fixture('name')
  f.renameWorker.mockResolvedValueOnce({ ok: false, error: { message } })
  await f.edit('reviewer')
  await f.submit()
  expect(f.renderer.root.findByProps({ role: 'alert' }).children).toEqual([message])
  expect(f.renderer.root.findByType('input').props.value).toBe('reviewer')
  expect(f.renderer.root.findByType('input').props.disabled).toBe(false)
  expect(f.onClose).not.toHaveBeenCalled()
  await f.edit('auditor')
  expect(f.renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  await f.submit()
  expect(f.renameWorker).toHaveBeenLastCalledWith(
    'synthetic-parent',
    worker.id,
    'auditor',
    expect.any(AbortSignal),
  )
  expect(f.onClose).toHaveBeenCalledOnce()
})

it('localizes the rename explanation and validation while retaining Host text verbatim', async () => {
  setLanguagePreference('en')
  const f = await fixture('name')
  expect(f.renderer.root.findAllByType('p').map((node) => node.children.join(''))).toContain(
    'Changing the name keeps the child session, history, and running tasks intact. You can still use the old name to continue the conversation, and it stays reserved for this agent. Other DSH views, such as the team board, may still show the old name.',
  )
  await f.edit('Reviewer')
  expect(f.renderer.root.findByProps({ role: 'alert' }).children).toEqual([
    'Use lowercase letters instead of uppercase letters.',
  ])
  await f.edit('reviewer')
  const message = '名称不能包含空格'
  f.renameWorker.mockResolvedValueOnce({ ok: false, error: { message } })
  await f.submit()
  expect(f.renderer.root.findByProps({ role: 'alert' }).children).toEqual([message])
})

it('keeps title validation and RPC failure visible while retaining the draft', async () => {
  const f = await fixture('title')
  await f.edit('   ')
  await f.submit()
  expect(f.renderer.root.findByProps({ role: 'alert' }).children).toEqual(['请输入聊天标题。'])
  expect(f.renameWorker).not.toHaveBeenCalled()
  expect(f.renameWorkerTitle).not.toHaveBeenCalled()
  f.renameWorkerTitle.mockResolvedValueOnce({ ok: false, error: { message: 'Synthetic edit failure' } })
  await f.edit('Retry this draft')
  await f.submit()
  expect(f.renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('Synthetic edit failure')
  expect(f.renderer.root.findByType('input').props.value).toBe('Retry this draft')
  expect(f.renderer.root.findByType('input').props.disabled).toBe(false)
  expect(f.onClose).not.toHaveBeenCalled()
})

it.each(['cancel', 'close', 'unmount'] as const)(
  '%s aborts an in-flight edit and ignores its late result',
  async (exit) => {
    const f = await fixture('name')
    let resolve!: (result: unknown) => void
    f.renameWorker.mockReturnValue(new Promise((done) => (resolve = done)))
    await f.edit('new-name')
    await f.submit()
    const signal: AbortSignal = f.renameWorker.mock.calls[0]![3]
    expect(signal.aborted).toBe(false)
    if (exit === 'unmount') await act(async () => f.renderer.unmount())
    else if (exit === 'close')
      await act(async () => f.renderer.root.findByProps({ 'aria-label': '关闭智能体命名' }).props.onClick())
    else
      await act(async () =>
        f.renderer.root
          .findAllByType('button')
          .find((button) => button.children.includes('取消'))!
          .props.onClick(),
      )
    expect(signal.aborted).toBe(true)
    const closeCount = f.onClose.mock.calls.length
    await act(async () => resolve({ ok: true, value: undefined }))
    expect(f.onClose).toHaveBeenCalledTimes(closeCount)
  },
)

it('does not submit duplicate edits while the same save is pending', async () => {
  const f = await fixture('title')
  let resolve!: (result: unknown) => void
  f.renameWorkerTitle.mockReturnValue(new Promise((done) => (resolve = done)))
  await f.edit('Changed title')
  await f.submit()
  await f.submit()
  expect(f.renameWorkerTitle).toHaveBeenCalledOnce()
  expect(f.renderer.root.findByType('input').props.disabled).toBe(true)
  await act(async () => resolve({ ok: true, value: undefined }))
  expect(f.onClose).toHaveBeenCalledOnce()
})
