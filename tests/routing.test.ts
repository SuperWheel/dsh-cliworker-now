import { hostServiceFixture } from './fixtures/host-service.ts'
import { mountNativeTools } from './fixtures/harness-native-tools.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SystemPrompt, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { CLI_IDS } from '../src/shared/types.ts'
import {
  CLI_ALIASES,
  CLI_DELEGATION_GUIDANCE,
  DSH_NATIVE_ALIASES,
  delegationGuidance,
  invocationResolution,
  invocationTargets,
  registerCliRouting,
  requireCliName,
  resolveCliName,
} from '../src/host/routing.ts'

// Real Cordis prompt/tool services and scoped events. Parent sessions, preferences,
// roles and publication are synthetic; this fixture never invokes a model or CLI.
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})
const user = (text: string): UserMessage =>
  createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text }],
  })

describe('one CLI name registry', () => {
  it('normalizes every canonical name and alias, including CLI suffix/case/spacing', () => {
    for (const cli of CLI_IDS) {
      expect(resolveCliName(cli)).toMatchObject({ status: 'resolved', cli, match: 'canonical' })
      for (const alias of CLI_ALIASES[cli])
        expect(resolveCliName(` ${alias.toUpperCase()} CLI `), alias).toMatchObject({
          status: 'resolved',
          cli,
        })
    }
    expect(resolveCliName('agy')).toEqual({
      status: 'resolved',
      cli: 'antigravity',
      match: 'alias',
      matchedName: 'agy',
    })
    for (const alias of ['glm', 'zhipu', '智谱'])
      expect(resolveCliName(alias)).toMatchObject({ status: 'resolved', cli: 'zcode', match: 'alias' })
  })

  it('accepts only matching parenthesized CLI aliases and preserves conflicting or unknown selectors', () => {
    for (const name of [
      'Antigravity（agy）CLI',
      'AGY (antigravity)',
      'OMP（Oh My Pi）',
      'Pi（Pi Coding Agent）',
    ])
      expect(resolveCliName(name).status).toBe('resolved')
    expect(requireCliName('Antigravity（agy）CLI')).toBe('antigravity')
    expect(requireCliName('OMP（Oh My Pi）')).toBe('omp')
    for (const name of ['Antigravity（codex）', 'OMP（Pi）', 'Antigravity（frog）', 'frog（agy）']) {
      expect(resolveCliName(name).status).toBe('ambiguous')
      expect(() => requireCliName(name)).toThrow('无法确定 CLI')
    }
  })

  it('allows only one character error in longer names and refuses unknown, multiple and retired choices', () => {
    for (const [name, cli] of [
      ['codx', 'codex'],
      ['zode', 'zcode'],
      ['antigraviy', 'antigravity'],
    ])
      expect(resolveCliName(name!)).toMatchObject({ status: 'resolved', cli, match: 'fuzzy' })
    for (const name of ['p', 'om', 'gl', 'glm5.3flash', 'random-cli', '', 'zocde']) {
      expect(resolveCliName(name)).toMatchObject({ status: 'unknown' })
      expect(() => requireCliName(name)).toThrow('无法确定 CLI，可用名称：')
    }
    expect(resolveCliName('agy/codex')).toEqual({ status: 'ambiguous', candidates: ['antigravity', 'codex'] })
    expect(resolveCliName('code')).toEqual({ status: 'ambiguous', candidates: ['codex', 'zcode'] })
    expect(resolveCliName('glm 或 zcode')).toEqual({ status: 'ambiguous', candidates: ['zcode'] })
    for (const name of ['harness', 'DeepSeek Harness CLI']) {
      expect(resolveCliName(name)).toMatchObject({ status: 'retired' })
      expect(() => requireCliName(name)).toThrow('已移除')
    }
  })
})

describe('explicit requests from this human step', () => {
  it.each([
    ['调用 agy cli 帮我检查代码', 'antigravity'],
    ['用agy和我说你好', 'antigravity'],
    ['请帮我用 AGY CLI 检查代码', 'antigravity'],
    ['我希望调用 glm cli 完成检查', 'zcode'],
    ['麻烦你使用 zhipu cli 完成检查', 'zcode'],
    ['调用智谱 CLI 帮我检查', 'zcode'],
    ['Please use codx CLI to review the code', 'codex'],
    ['用 Pi 的 GLM 模型帮我检查代码', 'pi'],
    ['调用 OMP cli 用 GLM 模型检查代码', 'omp'],
    ['使用 Oh My Pi 检查代码', 'omp'],
    ['使用 oh-my-pi 检查代码', 'omp'],
    ['使用 Pi Coding Agent 检查代码', 'pi'],
    ['调用 harmes cli 检查代码', 'hermes'],
    [
      '请调用 CLI Worker 的 cliworker_start，只使用 Antigravity（agy）CLI 做一次最小 Windows 验收，模型 Gemini3.8Flash low',
      'antigravity',
    ],
    [
      '用 agy cli 创建 cwn-windows-agy-fix.txt，内容为 AGY_WINDOWS_OK 加换行。仅操作这个测试文件。任务名 Windows Antigravity 最小验收，智能体名 Win-AGY验收。请调用 cliworker_start，参数 cli 必须为 antigravity。',
      'antigravity',
    ],
    ['请调用 CLI Worker Now 的 cliworker_start，仅使用 Antigravity (agy) CLI 检查代码', 'antigravity'],
    ['使用 Antigravity CLI 检查代码，然后调用 agy cli 完成检查', 'antigravity'],
    ['请调用 1 次 CLI Worker 派遣工具，使用 Grok，设置 read_only 为 true', 'grok'],
    ['请调用一次 CLI Worker 派遣工具，使用 Grok', 'grok'],
    ['调用 2 次 codex cli 检查代码', 'codex'],
    ['使用两个 agy cli 并行检查代码', 'antigravity'],
    // 2026-11-14 Windows 实测：「名称（CLI Worker）」是插件入口标注，不能让识别落成未知。
    ['请派遣 Claude Code（CLI Worker）在规划模式下为工作区写一个最小方案。模型用 Sonnet。', 'claude'],
    ['请派遣 Antigravity（CLI Worker）：生成一张水彩小狗插画', 'antigravity'],
    ['请用 Codex (CLI Worker Now) 检查代码', 'codex'],
    ['调用 agy：生成图片', 'antigravity'],
  ])('%s routes to %s without choosing a model', (text, cli) => {
    expect(invocationResolution([user(text)])).toMatchObject({ status: 'resolved', cli })
  })

  it.each([
    '介绍 agy cli 的用法',
    'GLM 模型有哪些？',
    '如何调用 agy cli？',
    '调用 agy cli 是什么意思？',
    '用 Pi 的模型有什么区别？',
    '用 agy cli 和 codex cli 有什么区别？',
    '调用 agy cli 有没有用？',
    '用 agy cli 好还是 codex cli 好？',
    '不要调用 agy cli',
    '请不要调用 agy cli',
    '先别使用 glm cli',
    '调用 GLM 模型测试',
    '使用 codex 模型检查',
    '“调用 agy cli 帮我检查代码”是一个例子',
    '> 调用 agy cli 帮我检查代码',
    '```text\n调用 agy cli 帮我检查代码\n```',
    '调用已有智能体小林继续任务',
    '让小林继续调用 agy cli 帮我检查代码',
    '请调用 CLI Worker 的 cliworker_start',
    '请调用 1 次 CLI Worker 派遣工具',
    '请在同一步里同时调用 4 次 CLI Worker 派遣工具',
    '调用两次 cliworker_start',
    '请调用 cliworker_start，参数 cli 必须为 antigravity',
    '请调用 cliworker_resolve，参数 cli 仅为名称说明',
    '调用 CLI 做一次检查',
    '不要只使用 Antigravity（agy）CLI',
    '“只使用 Antigravity（agy）CLI”是一个例子',
    '只使用 Antigravity（agy）CLI 有什么区别？',
  ])('%s does not contribute an execution hint', (text) => {
    expect(invocationResolution([user(text)])).toBeUndefined()
  })

  it('returns unresolved multiple/unknown targets and ignores injected content', () => {
    expect(invocationResolution([user('调用 agy 和 codex cli 帮我检查代码')])).toMatchObject({
      status: 'ambiguous',
      candidates: ['antigravity', 'codex'],
    })
    expect(invocationResolution([user('调用 agy cli 检查代码，同时调用 codex cli 检查测试')])).toMatchObject({
      status: 'ambiguous',
      candidates: ['antigravity', 'codex'],
    })
    expect(invocationResolution([user('调用 agy cli 和 codex cli 帮我检查代码')])).toMatchObject({
      status: 'ambiguous',
      candidates: ['antigravity', 'codex'],
    })
    expect(invocationResolution([user('调用 agy cli 和 codex 帮我检查代码')])).toMatchObject({
      status: 'ambiguous',
      candidates: ['antigravity', 'codex'],
    })
    expect(invocationResolution([user('调用 frog cli 帮我检查代码')])).toMatchObject({ status: 'unknown' })
    const injected = {
      ...user('调用 agy cli 帮我检查代码'),
      source: { kind: 'system-prompt' },
    } as UserMessage
    expect(invocationResolution([injected])).toBeUndefined()
  })

  it('deduplicates only fully resolved identical targets in the current admitted batch', () => {
    expect(
      invocationResolution([user('使用 Antigravity（agy）CLI 检查代码'), user('请用 agy cli 完成检查')]),
    ).toMatchObject({ status: 'resolved', cli: 'antigravity' })
    for (const messages of [
      [user('用 agy cli 检查代码'), user('使用 codex cli 检查测试')],
      [user('请调用 CLI Worker 的 cliworker_start，只使用 agy CLI 检查，同时使用 codex CLI 检查')],
      [user('使用 Antigravity（codex）CLI 检查')],
      [user('用 agy cli 检查代码'), user('使用 frog cli 检查测试')],
      [user('使用 Antigravity（frog）CLI 检查')],
    ])
      expect(invocationResolution(messages)).toMatchObject({ status: 'ambiguous' })
  })
})

async function fixture() {
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await mountNativeTools(ctx)
  const agent = {
    id: 'synthetic-parent',
    session: { header: { cwd: '/synthetic/project' } },
    ctx: {
      get: (name: string) =>
        name === 'sandboxPolicy' ? { resolve: () => ({ mode: 'workspace-write' }) } : undefined,
    },
  } as unknown as Agent
  const chooseDispatch = vi.fn(async (_agent, _signal, cli) => ({
    preference: { cli, model: 'synthetic-selected', effort: 'default' },
    role: null,
    binding: 'synthetic-binding',
  }))
  const launch = vi.fn(() => 'synthetic-background-receipt')
  // The model tool continues through the shared path with origin 'agent'.
  const followup = vi.fn(async () => 'synthetic-followup-receipt')
  const resolveWorker = vi.fn(() => ({ id: 'synthetic-worker' }))
  const service = hostServiceFixture({
    nativeRunDone: new Map(),
    ctx,
    chooseDispatch,
    chooseQoderVariant: vi.fn(async () => 'qoder'),
    launch,
    continueWorker: followup,
    runtime: { resolveWorker },
    disposed: new AbortController(),
  })
  ;service['host'].registerTools()
  const ask = vi.fn(async () => 'ordinary question remains available')
  ctx.tools.register(
    defineTool({
      name: 'ask_user_question',
      description: 'Synthetic ordinary question',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: ask,
    }),
  )
  const disposeRouting = registerCliRouting(ctx)
  ctx.systemPrompt.section({
    name: 'cliworker:delegation',
    order: 80,
    text: delegationGuidance,
  })
  // Stand-in for DSH's own `subagent` tool; registered only by tests that need it visible.
  const nativeSubagent = vi.fn(async () => 'synthetic native receipt')
  const exposeSubagent = () =>
    ctx.tools.register(
      defineTool({
        name: 'subagent',
        description: 'Synthetic DSH native sub-agent tool',
        parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: nativeSubagent,
      }),
    )
  const signal = new AbortController().signal
  const preStep = (messages: UserMessage[], target = agent, admitted = messages) =>
    agentEvents(ctx, target).waterfall(
      'agent/pre-step',
      { messages, signal, turn: 1, step: 1 },
      async () => ({ kind: 'enter', messages: admitted }),
    )
  const assembly = (target = agent) => ctx.systemPrompt.assemble(assembleContextFor(target))
  // Match Harness AgentLoop.preStep: assembly occurs BEFORE pre-step admission.
  const request = async (messages: UserMessage[], target = agent, admitted = messages) => {
    const prompt = await assembly(target)
    const decision = await preStep(messages, target, admitted)
    return {
      prompt,
      decision,
      text:
        renderPrompt(prompt) +
        '\n' +
        (decision.kind === 'enter'
          ? decision.messages
              .flatMap((message) =>
                message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])),
              )
              .join('\n')
          : ''),
    }
  }
  const start = (cli?: string, extra = {}, target = agent) =>
    ctx.tools.get('cliworker_start')!.execute(
      {
        ...(cli === undefined ? {} : { cli }),
        title: 'Synthetic request',
        prompt: 'Synthetic task',
        ...extra,
      },
      { agent: target, signal } as any,
    )
  return {
    ctx,
    ask,
    request,
    agent,
    service,
    chooseDispatch,
    launch,
    followup,
    resolveWorker,
    signal,
    preStep,
    assembly,
    start,
    disposeRouting,
    exposeSubagent,
    nativeSubagent,
  }
}

describe('native prompt/tool integration', () => {
  it('preserves generic versus explicit international Qoder selectors in current-step guidance', async () => {
    const f = await fixture()
    const generic = await f.request([user('调用 qoder 检查代码')])
    expect(generic.text).toContain('必须显式传入 cli="qoder"')
    expect(generic.text).toContain('双版本先用宿主原生询问')
    const international = await f.request([user('调用 qoder国际版 检查代码')])
    expect(international.text).toContain('必须显式传入 cli="qoder国际版"')
    expect(international.text).not.toContain('必须显式传入 cli="qoder"')
    expect(f.launch).not.toHaveBeenCalled()
  })
  it('includes the screenshot request guidance in the FIRST model request, after native assembly order', async () => {
    const f = await fixture()
    const messages = [user('用agy和我说你好')]
    const original = structuredClone(messages)
    const first = await f.request(messages)
    expect(first.text).toContain('本步用户提出了明确的外部 CLI 调用')
    expect(first.text).toContain('cli=antigravity')
    expect(first.text).toContain('模型、思考强度与角色不是调用前置输入')
    expect(first.decision.kind).toBe('enter')
    if (first.decision.kind !== 'enter') throw new Error('expected admitted request')
    expect(first.decision.messages).toHaveLength(2)
    expect(first.decision.messages[0]).toBe(messages[0])
    expect(first.decision.messages[1]!.source).toEqual({ kind: 'cliworker-invocation', form: 'instructions' })
    expect(messages).toEqual(original)
    const start = first.prompt.tools.find((tool) => tool.name === 'cliworker_start')!
    expect(start.description).toContain('完成选型前不会启动任务')
    expect(start.description).toContain('agy')
    expect(start.description).toContain('智谱')
    expect(f.chooseDispatch).not.toHaveBeenCalled()
    expect(f.launch).not.toHaveBeenCalled()
    // No delayed state in the next assembly/step or in another parent.
    expect((await f.request([])).text).not.toContain('本步用户提出')
    expect((await f.request([user('请解释代码')], { ...f.agent, id: 'other' } as Agent)).text).not.toContain(
      '本步用户提出',
    )
  })

  it('keeps ordinary questions visible and executable, while the plugin owns dispatch selection', async () => {
    const f = await fixture()
    const first = await f.request([user('用agy和我说你好')])
    expect(first.prompt.tools.some((tool) => tool.name === 'ask_user_question')).toBe(true)
    expect(
      await f.ctx.tools.get('ask_user_question')!.execute({}, { agent: f.agent, signal: f.signal } as any),
    ).toBe('ordinary question remains available')
    expect(f.ask).toHaveBeenCalledOnce()
    expect(first.text).toContain('直接调用 cliworker_start')
    expect(first.text).toContain('完整选型')
    expect(first.text).toContain('是否沿用')
    for (const input of ['调用 frog cli 帮我检查代码', '调用 agy 和 codex cli 帮我检查代码']) {
      const unknown = await f.request([user(input)])
      expect(unknown.text).toContain('返回简短候选错误')
      expect(unknown.text).toContain('不增加询问')
    }
    expect(f.launch).not.toHaveBeenCalled()
  })

  it('does not carry rejected name hints into a subsequent accepted step or confuse tool instructions with names', async () => {
    const f = await fixture()
    const previous = await f.request([user('调用 frog cli 帮我检查代码')])
    expect(previous.text).toContain('本步用户调用的 CLI 无法确定')
    const text = '用 agy cli 创建测试文件。请调用 cliworker_start，参数 cli 必须为 antigravity。'
    const current = await f.request([user(text)])
    expect(current.text).toContain('必须显式传入 cli="antigravity"')
    expect(current.text).not.toContain('本步用户调用的 CLI 无法确定')
    expect(current.decision.kind).toBe('enter')
    if (current.decision.kind !== 'enter') throw new Error('expected admitted request')
    expect(current.decision.messages).toHaveLength(2)
    expect(current.decision.messages[0]!.content).toEqual([{ type: 'text', text }])
    const repeated = await f.request([
      user('用 agy cli 检查代码'),
      user('使用 Antigravity（agy）CLI 检查代码'),
    ])
    expect(repeated.text).toContain('必须显式传入 cli="antigravity"')
    expect(repeated.text).not.toContain('本步用户调用的 CLI 无法确定')
    const conflicting = await f.request([user('用 agy cli 检查代码'), user('使用 codex cli 检查代码')])
    expect(conflicting.text).toContain('本步用户调用的 CLI 无法确定')
    expect(f.chooseDispatch).not.toHaveBeenCalled()
    expect(f.launch).not.toHaveBeenCalled()
  })

  it('uses admitted human input only, leaving rejected, aborted and uninstalled requests unchanged', async () => {
    const f = await fixture()
    const request = [user('调用 agy cli 检查代码')]
    const admitted = [user('请解释代码')]
    expect((await f.request(request, f.agent, admitted)).decision).toEqual({
      kind: 'enter',
      messages: admitted,
    })
    for (const message of [
      user('“用agy和我说你好”是例子'),
      createUserMessage({
        source: { kind: 'cliworker-invocation', form: 'instructions' },
        content: [{ type: 'text', text: '用agy和我说你好' }],
      }),
    ])
      expect((await f.request([message])).decision).toEqual({ kind: 'enter', messages: [message] })
    const rejected = await agentEvents(f.ctx, f.agent).waterfall(
      'agent/pre-step',
      {
        messages: request,
        signal: f.signal,
        turn: 2,
        step: 1,
      },
      async () => ({ kind: 'reject' }),
    )
    expect(rejected).toEqual({ kind: 'reject' })
    const cancelled = await agentEvents(f.ctx, f.agent).waterfall(
      'agent/pre-step',
      {
        messages: request,
        signal: AbortSignal.abort(),
        turn: 3,
        step: 1,
      },
      async () => ({ kind: 'enter', messages: request }),
    )
    expect(cancelled).toEqual({ kind: 'enter', messages: request })
    await f.disposeRouting()
    expect((await f.request(request)).decision).toEqual({ kind: 'enter', messages: request })
  })

  it('does not add invocation guidance for hidden tools; visible children receive sibling guidance', async () => {
    const f = await fixture()
    const scope = createScope(f.ctx, f.agent)
    cleanup.push(() => scope.dispose())
    await scope.ctx.inject(['tools'], (ctx) => ctx.tools.restrict({ deny: ['cliworker_start'] }))
    const messages = [user('用agy和我说你好')]
    const hidden = await f.request(messages)
    expect(hidden.prompt.tools.some((tool) => tool.name === 'cliworker_start')).toBe(false)
    expect(hidden.decision).toEqual({ kind: 'enter', messages })
    const child = {
      ...f.agent,
      id: 'synthetic-child',
      session: { header: { origin: 'subagent' } },
    } as unknown as Agent
    expect((await f.request(messages, child)).text).toContain('cliworker_start')
  })

  it('resolves names read-only and forwards aliases through existing model and role selection', async () => {
    const f = await fixture()
    const resolved = await f.ctx.tools
      .get('cliworker_resolve')!
      .execute({ name: 'glm' }, { signal: f.signal } as any)
    expect(JSON.parse(resolved as string)).toMatchObject({ status: 'resolved', cli: 'zcode', match: 'alias' })
    expect(f.chooseDispatch).not.toHaveBeenCalled()
    expect(f.launch).not.toHaveBeenCalled()
    for (const [alias, cli] of [
      ['agy', 'antigravity'],
      ['glm', 'zcode'],
      ['codx', 'codex'],
      ['omp', 'omp'],
      ['Oh My Pi', 'omp'],
      ['pi', 'pi'],
      ['Pi Coding Agent', 'pi'],
      ['Antigravity（agy）CLI', 'antigravity'],
    ]) {
      expect(await f.start(alias)).toBe('synthetic-background-receipt')
      expect(f.chooseDispatch).toHaveBeenLastCalledWith(f.agent, expect.any(AbortSignal), cli, f.agent)
      expect(f.launch.mock.calls.at(-1)![3]).toMatchObject({ cli })
    }
    for (const cli of CLI_IDS) {
      // The international ID is also the human family selector; an explicit alias fixes the site.
      await f.start(cli === 'workbuddy' ? 'WorkBuddy AI' : cli)
      expect(f.chooseDispatch).toHaveBeenLastCalledWith(f.agent, expect.any(AbortSignal), cli, f.agent)
      expect(f.launch.mock.calls.at(-1)![3]).toMatchObject({ cli })
    }
  })

  it('requires cli in the model schema and never defaults an omitted selector after Hermes routing', async () => {
    const f = await fixture()
    await f.request([user('用agy和我说你好')])
    const current = await f.request([user('用hermes跟我说你好')])
    expect(current.text).toContain('必须显式传入 cli="hermes"')
    const schema = current.prompt.tools.find((tool) => tool.name === 'cliworker_start')!
    expect(schema.parameters.required).toContain('cli')
    // Exact shape from the incident: title + prompt, without cli. Native
    // defineTool validation must fail before account/selection or publication.
    await expect(f.start()).rejects.toThrow(/cli/)
    for (const cli of ['', '   ', null, 42]) await expect(f.start(undefined, { cli })).rejects.toThrow()
    expect(f.chooseDispatch).not.toHaveBeenCalled()
    expect(f.launch).not.toHaveBeenCalled()
    expect(f.ask).not.toHaveBeenCalled()
  })

  it('refuses unknown/ambiguous and preserves cancellation, role and permission gates before publication', async () => {
    const f = await fixture()
    for (const name of ['unknown-cli', 'agy/codex', 'harness', 'Antigravity（codex）', 'Antigravity（frog）'])
      await expect(f.start(name)).rejects.toThrow()
    expect(f.chooseDispatch).not.toHaveBeenCalled()
    expect(f.launch).not.toHaveBeenCalled()
    f.chooseDispatch.mockRejectedValueOnce(new Error('synthetic selection cancelled'))
    await expect(f.start('glm')).rejects.toThrow('selection cancelled')
    expect(f.launch).not.toHaveBeenCalled()
    f.chooseDispatch.mockRejectedValueOnce(new Error('synthetic role cancelled'))
    await expect(f.start('agy')).rejects.toThrow('role cancelled')
    expect(f.launch).not.toHaveBeenCalled()
    for (const target of [
      { ...f.agent, session: { header: { origin: 'subagent' } } },
      {
        ...f.agent,
        ctx: { get: (name: string) => (name === 'planMode' ? { get: () => ({ active: true }) } : undefined) },
      },
    ])
      await expect(f.start('glm', {}, target as unknown as Agent)).rejects.toThrow()
    await expect(f.start('kimi', { read_only: true })).rejects.toThrow('不支持只读')
    expect(f.launch).not.toHaveBeenCalled()
    // 仅可查看 now admits dispatch; the CLI runs in its native read-only mode.
    const readOnly = {
      ...f.agent,
      ctx: { get: (name: string) => (name === 'sandboxPolicy' ? { resolve: () => ({ mode: 'read-only' }) } : undefined) },
    }
    await expect(f.start('glm', {}, readOnly as unknown as Agent)).resolves.toBeDefined()
    expect(f.launch).toHaveBeenCalledTimes(1)
  })

  it('keeps exact named-worker followup on its existing worker', async () => {
    const f = await fixture()
    const result = await f.ctx.tools
      .get('cliworker_followup')!
      .execute({ worker_name: '小林', prompt: 'Synthetic next task' }, {
        agent: f.agent,
        signal: f.signal,
      } as any)
    expect(result).toBe('synthetic-followup-receipt')
    expect(f.resolveWorker).toHaveBeenCalledWith(f.agent.id, undefined, '小林')
    expect(f.followup).toHaveBeenCalledWith(f.agent.id, 'synthetic-worker', 'Synthetic next task', f.signal, 'agent')
    expect(f.launch).not.toHaveBeenCalled()
  })
})

// SIMULATION: synthetic human messages and a stand-in `subagent` tool; no model,
// DSH sub-agent or CLI runs. Real native dispatch is verified on rc.5 separately.
describe('native DSH dispatch from this human step', () => {
  const targets = (text: string) => invocationTargets([user(text)])

  it.each([
    '调用 dsh 帮我总结 README',
    '调用 DSH 帮我总结 README',
    '调用dsh帮我看看',
    '用 DeepSeek Harness 检查这个目录',
    '用 deepseek harness 检查这个目录',
    '调用 Deep Seek  Harness CLI 检查',
    '调用 DeepSeekHarness 检查',
    '用 deepseekharness 检查这个目录',
    '调用 harness 帮我审查',
    '调用 HARNESS 命令行帮我审查',
    '调用 dsh cli 检查代码',
    '用DSH命令行检查',
    '用 DeepSeek Harness 原生子 Agent 审查这个模块',
    '请帮我用 dsh 总结 README',
    'Please use DSH to review the code',
  ])('%s targets the native sub-agent only', (text) => {
    expect(targets(text)).toEqual({ native: true })
    expect(invocationResolution([user(text)])).toBeUndefined()
  })

  it.each([
    ['调用 dsh 和 codex 分别审查这个模块', 'codex'],
    ['调用 DSH 与 Codex 分别审查这个模块', 'codex'],
    ['调用 codex 和 dsh 分别审查', 'codex'],
    ['调用 codex cli 和 dsh 分别审查', 'codex'],
    ['调用 dsh cli 和 agy cli 分别检查', 'antigravity'],
    ['调用 agy（CLI Worker）和 harness 分别检查', 'antigravity'],
  ])('%s keeps DSH and %s as separate targets', (text, cli) => {
    expect(targets(text)).toMatchObject({ native: true, external: { status: 'resolved', cli } })
  })

  it.each([
    'dsh 的子 Agent 是什么',
    '调用 dsh 和 codex 有什么区别',
    '调用 dsh 有什么区别？',
    '如何调用 dsh？',
    '调用 dsh 是什么意思',
    '用 DeepSeek Harness 的模型有哪些',
    '不要调用 dsh',
    '请不要调用 harness',
    '“调用 dsh 帮我总结 README”是一个例子',
    '> 调用 dsh 帮我总结 README',
    '```text\n调用 dsh 帮我总结 README\n```',
    '调用 dsh-1 继续任务',
    '让 DSH-2 接着检查',
    '让 dsh 继续上次的任务',
    '调用 DSH 子 Agent dsh-1 再看一遍',
    '调用 dshx 检查',
    '调用 harnesses 检查',
  ])('%s is not a native dispatch request', (text) => {
    expect(targets(text)?.native ?? false).toBe(false)
  })

  it('refuses either-or, unknown and multi-CLI companions instead of dropping them', () => {
    expect(targets('调用 dsh 或 codex 审查')).toEqual({
      native: true,
      external: { status: 'ambiguous', candidates: ['codex'] },
    })
    expect(targets('调用 dsh 和 frog cli 检查')).toMatchObject({ native: true, external: { status: 'unknown' } })
    expect(targets('调用 dsh 和 codex 和 agy 审查')).toMatchObject({
      native: true,
      external: { status: 'ambiguous', candidates: ['codex', 'antigravity'] },
    })
    // Same batch, separate messages: DSH plus two different external CLIs stays ambiguous.
    expect(invocationTargets([user('调用 dsh 总结'), user('用 agy cli 检查'), user('用 codex cli 检查')]))
      .toMatchObject({ native: true, external: { status: 'ambiguous' } })
    // Repeated DSH names are one target, not an either-or choice, and do not taint other clauses.
    expect(targets('调用 dsh 或 harness 检查')).toEqual({ native: true })
    expect(targets('调用 DSH 或 Harness 总结 README。调用 Codex 审查代码')).toMatchObject({
      native: true,
      external: { status: 'resolved', cli: 'codex' },
    })
  })

  // Codex review 2026-11-19 failing inputs.
  it.each([
    ['调用 dsh 或者 codex 审查', { status: 'ambiguous', candidates: ['codex'] }],
    ['调用 dsh 或使用 codex 审查', { status: 'ambiguous', candidates: ['codex'] }],
    ['调用 dsh 还是 codex 审查', { status: 'ambiguous', candidates: ['codex'] }],
    ['调用 dsh 或者帮我直接改', { status: 'ambiguous' }],
    ['调用 dsh 和 Qoder CLI 中国版 分别审查', { status: 'resolved', cli: 'qodercn' }],
    ['调用 dsh 和 Codex （agy）CLI 分别审查', { status: 'ambiguous', candidates: ['codex', 'antigravity'] }],
    ['调用 dsh 和 Foo Bar CLI 分别审查', { status: 'unknown' }],
    ['调用 dsh、codex 分别审查', { status: 'resolved', cli: 'codex' }],
    ['调用 codex/dsh 分别审查', { status: 'resolved', cli: 'codex' }],
    ['用 DSH 总结 README，再用 Codex 审查代码', { status: 'resolved', cli: 'codex' }],
  ])('%s keeps every listed target', (text, external) => {
    expect(targets(text)).toMatchObject({ native: true, external })
  })

  it('keeps a named sub-agent followup out of new dispatch without losing the external target', () => {
    for (const text of ['调用 Codx CLI 和 DSH 子 Agent dsh-1 继续审查', '调用 Codex CLI 和 DSH 子 Agent dsh-1 继续审查'])
      expect(targets(text), text).toMatchObject({ native: false, external: { status: 'resolved', cli: 'codex' } })
  })

  it.each([
    '用 dsh，但不要实际运行，只告诉我调用步骤',
    '调用 dsh，不要真的运行，只告诉我怎么调',
    '用 dsh，但是不要真的启动',
    '调用 codex cli 和 dsh，不要执行',
  ])('%s forbids the dispatch it names', (text) => {
    expect(targets(text)?.native ?? false).toBe(false)
  })

  it('keeps constraints that are not about running the dispatch itself', () => {
    expect(targets('调用 dsh 审查代码，不要执行测试')).toEqual({ native: true })
    expect(targets('调用 dsh 检查，不要修改文件')).toEqual({ native: true })
  })

  it('never turns another CLI name into DSH, nor DSH into an external CLI', () => {
    for (const cli of CLI_IDS)
      for (const alias of CLI_ALIASES[cli]) {
        if (['glm', 'zhipu', '智谱'].includes(alias)) continue
        expect(targets(`调用 ${alias} 检查代码`)?.native, alias).toBe(false)
      }
    for (const alias of DSH_NATIVE_ALIASES) expect(targets(`调用 ${alias} 检查代码`), alias).toEqual({ native: true })
    // Tool selectors keep the external contract: retired Harness and unknown dsh never start.
    for (const name of ['harness', 'deepseekharness', 'DeepSeek Harness CLI'])
      expect(resolveCliName(name)).toMatchObject({ status: 'retired' })
    expect(resolveCliName('dsh')).toMatchObject({ status: 'unknown' })
    expect(() => requireCliName('dsh')).toThrow('无法确定 CLI')
  })

  it('guides the FIRST request to native subagent, without retirement, unknown or CLI selection hints', async () => {
    const f = await fixture()
    f.exposeSubagent()
    for (const text of [
      '调用 dsh 帮我总结 README',
      '用 DeepSeek Harness 检查这个目录',
      '调用 deepseekharness 检查',
      '调用 harness 帮我审查',
      '调用 dsh cli 检查代码',
    ]) {
      const messages = [user(text)]
      const current = await f.request(messages)
      expect(current.text).toContain('直接调用 DSH 原生工具 subagent')
      expect(current.text).toContain('description 写简短的任务说明，prompt 写用户交办的任务')
      expect(current.text).toContain('原样报告宿主的错误')
      expect(current.text).toContain('不调用 cliworker_start 或 cliworker_resolve')
      expect(current.text).not.toContain('外部 Harness CLI 入口已移除')
      expect(current.text).not.toContain('无法确定')
      expect(current.text).not.toContain('本步用户提出了明确的外部 CLI 调用')
      expect(current.decision.kind).toBe('enter')
      if (current.decision.kind !== 'enter') throw new Error('expected admitted request')
      expect(current.decision.messages).toHaveLength(2)
      expect(current.decision.messages[0]).toBe(messages[0])
      expect(current.decision.messages[1]!.source).toEqual({ kind: 'cliworker-invocation', form: 'instructions' })
      expect(current.prompt.tools.some((tool) => tool.name === 'ask_user_question')).toBe(true)
    }
    // The resident guidance names the same boundary.
    const prompt = await f.request([user('请解释代码')])
    expect(prompt.text).toContain('DeepSeek Harness 原生子 Agent，不是外部 CLI')
    expect(prompt.text).not.toContain('本步用户明确要求由 DeepSeek Harness')
    expect(f.nativeSubagent).not.toHaveBeenCalled()
    expect(f.chooseDispatch).not.toHaveBeenCalled()
    expect(f.launch).not.toHaveBeenCalled()
  })

  it('tells the user to enable the sub-agent tool when this agent cannot see subagent, without workarounds', async () => {
    const f = await fixture()
    const current = await f.request([user('调用 dsh 帮我总结 README')])
    expect(current.prompt.tools.some((tool) => tool.name === 'subagent')).toBe(false)
    expect(current.text).toContain('没有原生子 Agent 工具 subagent')
    expect(current.text).toContain('在「设置 → Agent 预设」中为新任务选择包含子智能体委派工具（subagent）的预设')
    expect(current.text).toContain('「标准模式」')
    expect(current.text).toContain('不要改用 workflow、agent()、subagent_fork、cliworker_start')
    expect(current.text).not.toContain('直接调用 DSH 原生工具 subagent')
    // A scope that denies subagent is the same as not having it.
    f.exposeSubagent()
    const scope = createScope(f.ctx, f.agent)
    cleanup.push(() => scope.dispose())
    await scope.ctx.inject(['tools'], (ctx) => ctx.tools.restrict({ deny: ['subagent'] }))
    expect((await f.request([user('调用 dsh 帮我总结 README')])).text).toContain('没有原生子 Agent 工具 subagent')
    expect(f.launch).not.toHaveBeenCalled()
  })

  it('routes DSH and Codex tasks separately and keeps Codex selection, also when one entry is missing', async () => {
    const f = await fixture()
    const missing = await f.request([user('调用 dsh 和 codex 分别审查这个模块')])
    expect(missing.text).toContain('分别交给 DSH 原生子 Agent 与外部 CLI')
    expect(missing.text).toContain('包含子智能体委派工具（subagent）的预设')
    expect(missing.text).toContain('必须显式传入 cli="codex"')
    f.exposeSubagent()
    const both = await f.request([user('调用 dsh 和 codex 分别审查这个模块')])
    expect(both.text).toContain('直接调用 DSH 原生工具 subagent')
    expect(both.text).toContain('必须显式传入 cli="codex"')
    expect(both.text).toContain('用户确认选型后才启动任务')
    expect(both.text).not.toContain('无法确定')
    // The native part does not depend on cliworker_start being visible.
    const scope = createScope(f.ctx, f.agent)
    cleanup.push(() => scope.dispose())
    await scope.ctx.inject(['tools'], (ctx) => ctx.tools.restrict({ deny: ['cliworker_start'] }))
    const hiddenExternal = await f.request([user('调用 dsh 和 codex 分别审查这个模块')])
    expect(hiddenExternal.text).toContain('直接调用 DSH 原生工具 subagent')
    expect(hiddenExternal.text).toContain('分别交给 DSH 原生子 Agent 与外部 CLI')
    expect(hiddenExternal.text).toContain('Codex 执行另一项任务，但当前 Agent 本轮看不到 CLI Worker 的派遣入口')
    expect(hiddenExternal.text).not.toContain('cli="codex"')
    expect(hiddenExternal.prompt.tools.some((tool) => tool.name === 'cliworker_start')).toBe(false)
    expect(f.chooseDispatch).not.toHaveBeenCalled()
    expect(f.launch).not.toHaveBeenCalled()
  })

  it('refuses ambiguous mixes and leaves discussion, rejected, cancelled and child steps without native guidance', async () => {
    const f = await fixture()
    f.exposeSubagent()
    for (const text of ['调用 dsh 或 codex 审查', '调用 dsh 和 frog cli 检查', '调用 dsh 和 codex 和 agy 审查']) {
      const current = await f.request([user(text)])
      expect(current.text, text).toContain('本步用户的派遣目标无法确定')
      expect(current.text, text).toContain('不派遣 DSH 原生子 Agent，也不启动外部 CLI')
      expect(current.text, text).not.toContain('直接调用 DSH 原生工具 subagent')
    }
    for (const text of ['调用 dsh 和 codex 有什么区别', 'dsh 的子 Agent 是什么', '调用 dsh-1 继续任务']) {
      const messages = [user(text)]
      expect((await f.request(messages)).decision, text).toEqual({ kind: 'enter', messages })
    }
    const request = [user('调用 dsh 帮我总结 README')]
    expect(
      await agentEvents(f.ctx, f.agent).waterfall(
        'agent/pre-step',
        { messages: request, signal: f.signal, turn: 2, step: 1 },
        async () => ({ kind: 'reject' }),
      ),
    ).toEqual({ kind: 'reject' })
    expect(
      await agentEvents(f.ctx, f.agent).waterfall(
        'agent/pre-step',
        { messages: request, signal: AbortSignal.abort(), turn: 3, step: 1 },
        async () => ({ kind: 'enter', messages: request }),
      ),
    ).toEqual({ kind: 'enter', messages: request })
    const child = {
      ...f.agent,
      id: 'synthetic-child',
      session: { header: { origin: 'subagent' } },
    } as unknown as Agent
    const childRequest = await f.request(request, child)
    expect(childRequest.decision).toEqual({ kind: 'enter', messages: request })
    // Resident guidance: the main agent has the native part, a sub-agent session does not.
    expect(childRequest.text).not.toContain('DeepSeek Harness 原生子 Agent，不是外部 CLI')
    expect(childRequest.text).toContain('CLI Worker Now 是调用外部 CLI 的插件入口')
    expect((await f.request(request)).text).toContain('DeepSeek Harness 原生子 Agent，不是外部 CLI')
    const mixed = await f.request([user('调用 dsh 和 codex 分别审查这个模块')], child)
    expect(mixed.text).not.toContain('DSH 原生工具 subagent')
    expect(mixed.text).not.toContain('分别交给 DSH 原生子 Agent')
    expect(mixed.text).toContain('你只能通过 cliworker_start 发起同级 Worker')
    expect(f.nativeSubagent).not.toHaveBeenCalled()
    expect(f.launch).not.toHaveBeenCalled()
  })
})
