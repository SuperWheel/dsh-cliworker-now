import { registerTools } from '../src/host/service-tools.ts'
import { expect, it, vi } from 'vitest'
import type { DispatchSetup } from '../src/host/storage.ts'

// Real registered tool entry; complete setup and publication are synthetic.
// Complete question, cancellation and storage coverage lives in dispatch-flow.test.ts.
function setup() {
  const tools = new Map<string, any>()
  let answer!: (response: DispatchSetup) => void
  const waiting = new Promise<DispatchSetup>((resolve) => {
    answer = resolve
  })
  const chooseDispatch = vi.fn(() => waiting)
  const launch = vi.fn((..._args: unknown[]) => 'synthetic-receipt')
  const service: any = {
    ctx: {
      effect: (register: () => unknown) => register(),
      tools: { register: (definition: any) => tools.set(definition.name, definition) },
    },
    assertExecution: vi.fn(),
    dispatchSubject: async (agent: unknown) => agent,
    siblingDispatch: async (_caller: unknown, parent: unknown) => ({ questionAgent: parent }),
    chooseDispatch,
    disposed: new AbortController(),
    launch,
  }
  registerTools.call(service)
  const controller = new AbortController(),
    agent = { id: 'synthetic-parent' }
  const start = (name = 'reviewer') =>
    tools
      .get('cliworker_start')
      .execute(
        { cli: 'antigravity', title: '测试', prompt: '合成任务', agent_name: name },
        { agent, signal: controller.signal },
      )
  const selected: DispatchSetup = {
    preference: { cli: 'antigravity', model: 'fixture', effort: 'low' },
    role: { presetId: 'fixture-review', name: '审稿员', summary: '合成角色', prompt: '检查证据' },
    binding: 'synthetic-account',
  }
  return { service, chooseDispatch, launch, answer, controller, start, selected }
}

it('publishes only after the complete setup and passes the frozen role without another question', async () => {
  const f = setup(),
    pending = f.start()
  await vi.waitFor(() => expect(f.chooseDispatch).toHaveBeenCalledTimes(1))
  expect(f.launch).not.toHaveBeenCalled()
  f.answer(f.selected)
  expect(await pending).toBe('synthetic-receipt')
  expect(f.launch.mock.calls[0]![3]).toEqual(f.selected.preference)
  expect(f.launch.mock.calls[0]![6]).toMatchObject({ agentName: 'reviewer', role: f.selected.role })
})
it('cancellation before complete setup returns never publishes a background job', async () => {
  const f = setup(),
    pending = f.start()
  f.controller.abort(new Error('user cancelled'))
  f.answer(f.selected)
  await expect(pending).rejects.toThrow('user cancelled')
  expect(f.launch).not.toHaveBeenCalled()
})
it('explicit no-role setup starts without substituting any preset', async () => {
  const f = setup(),
    pending = f.start()
  f.answer({ ...f.selected, role: null })
  await pending
  expect(f.launch.mock.calls[0]![6]).toEqual({ agentName: 'reviewer', role: undefined })
})

it.each([
  ['小林', '中文'],
  ['bad_name', '下划线'],
  ['', '不能为空'],
  ['lead', '保留'],
])('rejects an invalid explicit tool name %s before selection or dispatch', async (name, reason) => {
  const f = setup()
  await expect(f.start(name)).rejects.toThrow(reason)
  expect(f.chooseDispatch).not.toHaveBeenCalled()
  expect(f.launch).not.toHaveBeenCalled()
})
