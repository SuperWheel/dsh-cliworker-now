import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { type MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentDescendantListEntry, SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { defineTool, ToolRuntime } from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentNameOverrides, PendingAgentNames } from '../src/host/agent-name-overrides.ts'
import { AgentNameResolutionError, registerAgentNameTools } from '../src/host/agent-name-tools.ts'

const require = createRequire(import.meta.url)
const controlModule = createRequire(require.resolve('@deepseek-ai/dsh/package.json')).resolve(
  '@deepseek-ai/dsh-tool-subagent-control',
)
const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})

function agent(id: string) {
  return { id: SessionId(id) } as Agent
}
function member(id: string, path: string, parentId = 'root'): SubagentDescendantListEntry {
  return {
    kind: 'child',
    id: SessionId(id),
    path,
    parentId: SessionId(parentId),
    depth: path.split('/').length,
    activity: 'inactive',
    hasChildren: false,
    mode: 'continuable',
    label: 'agent-1 描述',
  }
}

// 模拟身份、子会话目录和消息接收端。Cordis、工具注册、三个控制工具及其结果渲染使用已安装的 DSH 包。
async function fixture() {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(ToolRuntime)
  const root = agent('root'),
    caller = agent('caller'),
    other = agent('other-root')
  const scope = createScope(ctx, caller)
  cleanups.push(() => scope.dispose())
  const rows: SubagentDescendantListEntry[] = [
    member('child', 'agent-1'),
    member('leaf', 'agent-1/check', 'child'),
  ]
  const service = {
    rootOf: vi.fn((sender: Agent) => (sender === caller ? root : sender)),
    listDescendants: vi.fn<SubagentRuntime['listDescendants']>(async (parent) =>
      parent === root.id ? rows : [],
    ),
    resolveName: vi.fn<SubagentRuntime['resolveName']>(
      async (_agent, path) => rows.find((row) => row.path === path)?.id ?? SessionId(path),
    ),
    interrupt: vi.fn<SubagentRuntime['interrupt']>(),
    sendMessage: vi.fn<SubagentRuntime['sendMessage']>(async () => 'simulated-message' as MessageId),
  }
  Object.defineProperty(ctx, 'subagents', { value: service })
  Object.defineProperty(ctx, 'agents', { value: { get: () => undefined } })
  const control = await import(pathToFileURL(controlModule).href)
  control.apply(ctx)
  const create = vi.fn(async () => 'created')
  for (const name of ['subagent', 'unrelated'])
    ctx.tools.register(
      defineTool({
        name,
        description: '模拟创建工具',
        parameters: { name: { type: 'string' } },
        output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
        execute: create,
      }),
    )
  const dir = mkdtempSync(join(import.meta.dirname, '模拟工具覆盖-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const overrides = new AgentNameOverrides(dir),
    pending = new PendingAgentNames()
  overrides.set(root.id, 'child', {
    name: 'reviewer',
    expected: 'agent-1',
    registeredName: 'agent-1',
    kind: 'native',
  })
  overrides.set(root.id, 'child', { name: 'audit', expected: 'reviewer', kind: 'native' })
  const deps = {
    overrides,
    pending,
    occupied: vi.fn((parent: string) => new Set(parent === caller.id ? ['local'] : [])),
    workerAlias: vi.fn((parent: string, name: string): string | undefined =>
      parent === root.id && name === '旧名' ? 'child' : undefined,
    ),
    subagents: vi.fn((): typeof service | undefined => service),
    log: vi.fn(),
  }
  const off = registerAgentNameTools(ctx, deps)
  const pipeline = new ToolExecutionPipeline(ctx)
  const call = async (name: string, args: unknown, sender = root, signal = new AbortController().signal) => {
    const prepared = await pipeline.prepare({
      callId: ToolCallId('模拟调用'),
      name,
      arguments: args,
      agent: sender,
      signal,
    })
    const outcome = prepared.kind === 'dispatch' ? await pipeline.dispatch(prepared.exec) : prepared
    return pipeline.complete(prepared.exec, outcome)
  }
  return { ctx, root, caller, other, scope, rows, service, deps, create, call, off }
}

describe('模拟子 Agent 创建与名称工具', () => {
  it('按实际创建者拦截现名、旧名、并发保留名，并将无关请求交给宿主', async () => {
    const f = await fixture()
    const create = (name: string, caller = f.root) => f.call('subagent', { name }, caller)
    const release = f.deps.pending.reserve(f.caller.id, 'pending')
    for (const [name, caller] of [
      ['audit', f.root],
      ['REVIEWER', f.root],
      ['pending', f.caller],
      ['local', f.caller],
    ] as const) {
      const result = await create(name, caller)
      expect(result).toMatchObject({
        isError: true,
        error: { message: expect.stringMatching(/含改名前的名称.*already used/u) },
      })
    }
    expect(f.create).not.toHaveBeenCalled()
    release()
    for (const result of [
      await create('pending', f.caller),
      await create('audit', f.other),
      await create('audit', f.caller),
      await create('local'),
      await f.call('subagent', {}),
      await f.call('unrelated', { name: 'audit' }),
    ])
      expect(result).toMatchObject({ isError: false, value: 'created' })
  })

  it('按现名、曾用名及 Worker 别名只发送一次，保留原调用者与回执', async () => {
    const f = await fixture()
    const signal = new AbortController().signal
    for (const address of ['audit', 'reviewer', '旧名']) {
      const result = await f.call('send_message', { agent: address, message: '模拟正文' }, f.caller, signal)
      expect(result).toMatchObject({
        isError: false,
        value: { messageId: 'simulated-message' },
        content: [{ type: 'text', text: `message delivered to agent ${address}` }],
      })
    }
    expect(f.service.resolveName).not.toHaveBeenCalled()
    expect(f.service.sendMessage).toHaveBeenCalledTimes(3)
    for (const args of f.service.sendMessage.mock.calls) {
      expect(args).toEqual([f.caller, 'child', [{ type: 'text', text: '模拟正文' }], { signal }])
    }
    expect(f.deps.log).not.toHaveBeenCalled()
  })

  it('多段引用只翻译首段；原登记名、未知引用和其他树走原生解析', async () => {
    const f = await fixture()
    const signal = new AbortController().signal
    await f.call('send_message', { agent: 'reviewer/check', message: 'x' }, f.caller, signal)
    expect(f.service.resolveName).toHaveBeenLastCalledWith(f.caller, 'agent-1/check', signal)
    expect(f.service.sendMessage.mock.lastCall?.[1]).toBe('leaf')
    for (const name of ['agent-1', 'agent-1/check', 'unknown']) {
      await f.call('send_message', { agent: name, message: 'x' }, f.caller, signal)
      expect(f.service.resolveName).toHaveBeenLastCalledWith(f.caller, name, signal)
    }
    f.service.sendMessage.mockImplementationOnce(async (sender, id) => {
      expect(sender).toBe(f.other)
      expect(id).toBe('audit')
      throw new Error('模拟：本树中没有该目标')
    })
    expect(await f.call('send_message', { agent: 'audit', message: 'x' }, f.other, signal)).toMatchObject({
      isError: true,
      error: { message: '模拟：本树中没有该目标' },
    })
    expect(f.service.resolveName).toHaveBeenLastCalledWith(f.other, 'audit', signal)
  })

  it('覆盖表歧义、Worker 别名冲突或另一子会话登记同名均产生宿主工具错误', async () => {
    const f = await fixture()
    const send = () => f.call('send_message', { agent: 'reviewer', message: '模拟正文' })
    const observed = vi.fn()
    f.ctx.on('tools/result', (_exec, result) => {
      observed(result)
    })
    f.rows.push(member('other', 'reviewer'))
    expect(await send()).toMatchObject({ isError: true, error: { message: expect.stringContaining('歧义') } })
    expect(observed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ isError: true }))
    f.rows.pop()
    f.deps.workerAlias.mockImplementationOnce(() => {
      throw new AgentNameResolutionError('多个 Worker 共享别名')
    })
    expect(await send()).toMatchObject({ isError: true, error: { message: '多个 Worker 共享别名' } })
    f.deps.workerAlias.mockReturnValueOnce('other')
    expect((await send()).isError).toBe(true)
    f.deps.overrides.set('root', 'other', { name: 'reader', expected: 'reviewer', kind: 'worker' })
    expect((await send()).isError).toBe(true)
    expect(f.service.resolveName).not.toHaveBeenCalled()
    expect(f.service.sendMessage).not.toHaveBeenCalled()
  })

  it('中断沿用 ancestor；自发消息与无祖先权限的拒绝不会转投', async () => {
    const f = await fixture()
    const interrupt = () => f.call('interrupt_agent', { agent: 'audit' }, f.caller)
    expect(await interrupt()).toMatchObject({
      isError: false,
      value: { accepted: true },
      content: [{ type: 'text', text: 'interrupt requested for agent audit' }],
    })
    expect(f.service.interrupt).toHaveBeenCalledWith('child', { kind: 'ancestor', agent: f.caller })
    f.service.interrupt.mockImplementationOnce(() => {
      throw new Error('模拟：无祖先权限')
    })
    expect(await interrupt()).toMatchObject({ isError: true, error: { message: '模拟：无祖先权限' } })
    const self = agent('child')
    f.service.rootOf.mockReturnValueOnce(f.root)
    f.service.sendMessage.mockImplementationOnce(async (sender, id) => {
      expect(sender).toBe(self)
      expect(id).toBe(sender.id)
      throw new Error('模拟：禁止自发消息')
    })
    expect(await f.call('send_message', { agent: 'audit', message: 'x' }, self)).toMatchObject({
      isError: true,
    })
    expect(f.service.sendMessage).toHaveBeenCalledOnce()
    expect(f.service.resolveName).not.toHaveBeenCalled()
  })

  it('目录读取期间取消时停止投递，失去工具权限或参数无效时也没有副作用', async () => {
    const f = await fixture()
    const controller = new AbortController()
    f.service.listDescendants.mockImplementationOnce(async (_root, signal) => {
      expect(signal).toBe(controller.signal)
      controller.abort(new Error('模拟取消'))
      return f.rows
    })
    const args = { agent: 'audit', message: 'x' }
    expect(await f.call('send_message', args, f.caller, controller.signal)).toMatchObject({ isError: true })
    expect(await f.call('send_message', { ...args, message: 42 })).toMatchObject({ isError: true })
    await f.scope.ctx.inject(['tools'], (ctx) => ctx.tools.restrict({ deny: ['send_message'] }))
    expect(await f.call('send_message', args, f.caller)).toMatchObject({ isError: true })
    expect(f.service.sendMessage).not.toHaveBeenCalled()
  })

  it('服务缺失或 rootOf 出错时使用原工具，日志不含正文', async () => {
    const f = await fixture()
    f.deps.subagents.mockReturnValueOnce(undefined)
    await f.call('send_message', { agent: 'audit', message: '模拟私密正文' })
    f.service.rootOf.mockImplementationOnce(() => {
      throw new Error('模拟私密正文')
    })
    await f.call('send_message', { agent: 'audit', message: '模拟私密正文' })
    expect(f.service.resolveName.mock.calls.map((call) => call[1])).toEqual(['audit', 'audit'])
    expect(f.deps.log).toHaveBeenCalledOnce()
    expect(JSON.stringify(f.deps.log.mock.calls)).not.toContain('私密正文')
  })

  it('list_agents 保留根、诊断、相似前缀、描述和状态，并由原渲染器呈现', async () => {
    const f = await fixture()
    f.rows.push(member('other', 'agent-10'), {
      kind: 'diagnostic',
      id: SessionId('bad'),
      reason: 'unavailable',
      parentId: SessionId('child'),
      depth: 2,
      path: 'agent-1/bad',
    })
    const result = await f.call('list_agents', {}, f.caller)
    const expected = [
      { name: 'lead', status: 'inactive', description: 'root agent' },
      { name: 'audit', status: 'inactive', description: 'agent-1 描述' },
      { name: 'audit/check', status: 'inactive', description: 'agent-1 描述' },
      { name: 'agent-10', status: 'inactive', description: 'agent-1 描述' },
      { name: 'agent-1/bad', status: 'unavailable' },
    ]
    expect(result).toMatchObject({ isError: false, value: expected })
    expect(result.content[0]).toEqual({
      type: 'text',
      text: expected
        .map((row) => `${row.name} [${row.status}]${row.description ? ' — ' + row.description : ''}`)
        .join('\n'),
    })
    f.service.listDescendants.mockRejectedValueOnce(new Error('agent-1 目录错误'))
    expect(await f.call('list_agents', {})).toMatchObject({
      isError: true,
      error: { message: 'agent-1 目录错误' },
    })
  })

  it('卸载移除三处钩子，重载后只处理一次', async () => {
    const f = await fixture()
    f.off()
    expect((await f.call('subagent', { name: 'audit' })).isError).toBe(false)
    await f.call('send_message', { agent: 'audit', message: 'x' })
    expect(f.service.resolveName.mock.lastCall?.[1]).toBe('audit')
    expect(await f.call('list_agents', {})).toMatchObject({
      value: expect.arrayContaining([expect.objectContaining({ name: 'agent-1' })]),
    })
    expect(f.deps.subagents).not.toHaveBeenCalled()
    const off = registerAgentNameTools(f.ctx, f.deps)
    await f.call('send_message', { agent: 'audit', message: 'x' })
    expect(f.deps.subagents).toHaveBeenCalledOnce()
    expect(f.service.sendMessage.mock.calls.map((call) => call[1])).toEqual(['audit', 'child'])
    off()
  })
})
