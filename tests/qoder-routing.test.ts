import { afterEach, describe, expect, it, vi } from 'vitest'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { CliWorkerService } from '../src/host/index.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
import {
  invocationResolution,
  isGenericQoderName,
  resolveAvailableCliName,
  resolveCliName,
} from '../src/host/routing.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { WindowsCliInstallationError } from '../src/host/windows-cli-installation.ts'
import type { ProcessBackend, RuntimeConfig } from '../src/host/process.ts'

// This suite tests dispatch routing, not platform installation discovery. Keep
// the Host entry real, but replace the resolver before index.ts is evaluated so
// Windows native ~/.qoder[-cn] and npm candidates never touch the user's machine.
// Production installation validation remains covered by its dedicated suites.
vi.mock('../src/host/adapters.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/host/adapters.ts')>()),
  resolveCliExecutable: async (
    cli: 'qoder' | 'qodercn',
    backend: ProcessBackend,
    config: RuntimeConfig,
    signal: AbortSignal,
  ) => {
    signal.throwIfAborted()
    if (cli !== 'qoder' && cli !== 'qodercn') throw new Error('Unexpected fixture CLI')
    if (config.cliExecutablePaths) throw new Error('Routing discovery must not persist paths')
    const path = await backend.resolveExecutable(config[`${cli}Executable`] ?? cli)
    signal.throwIfAborted()
    return path
  },
}))

// Synthetic path lookup and native question responses. No CLI/account/model is invoked.
afterEach(() => vi.restoreAllMocks())
const user = (text: string) =>
  createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const missing = () => Object.assign(new Error('synthetic missing executable'), { code: 'ENOENT' })

function fixture(installed: string[] = ['qoder', 'qodercn']) {
  const tools = new Map<string, any>()
  const controller = new AbortController()
  const ask = vi.fn()
  const backend = {
    resolveExecutable: vi.fn(async (name: string) => {
      if (!installed.includes(name)) throw missing()
      return '/synthetic/' + name
    }),
    spawn: vi.fn(() => {
      throw new Error('installation discovery must not spawn')
    }),
  }
  const agent = {
    id: 'synthetic-parent',
    session: { header: { cwd: process.cwd(), origin: 'user' } },
    ctx: {
      get: (name: string) =>
        name === 'userQuestions'
          ? { ask }
          : name === 'sandboxPolicy'
            ? { resolve: () => ({ mode: 'workspace-write' }) }
            : undefined,
    },
  }
  const service: any = Object.create(CliWorkerService.prototype)
  Object.assign(service, {
    ctx: {
      effect: (register: () => void) => register(),
      tools: { register: (tool: any) => tools.set(tool.name, tool) },
    },
    options: { ...DEFAULT_CONFIG },
    backend,
    disposed: new AbortController(),
    pending: new Map(),
    runtime: { changed: vi.fn(), assertCliEnabled: vi.fn(), blockCatalogOnCleanup: vi.fn() },
    chooseDispatch: vi.fn(async (_agent, _signal, cli) => ({
      preference: { cli, model: 'fixture', effort: 'default' },
      role: null,
    })),
    launch: vi.fn(() => 'synthetic-receipt'),
  })
  service.registerTools()
  const start = (cli = 'qoder') =>
    tools
      .get('cliworker_start')
      .execute(
        { cli, title: 'Synthetic task', prompt: 'Synthetic prompt' },
        { agent, signal: controller.signal },
      )
  const resolve = (name = 'qoder') =>
    tools.get('cliworker_resolve').execute({ name }, { signal: controller.signal })
  const answer = (label: string) => ({ answers: [{ id: 'cliworker_qoder_variant', selected: [label] }] })
  return { service, agent, start, resolve, controller, ask, backend, answer }
}

describe('availability-aware Qoder family routing', () => {
  it.each([
    [[], 'unavailable', undefined],
    [['qoder'], 'resolved', 'qoder'],
    [['qodercn'], 'resolved', 'qodercn'],
    [['qoder', 'qodercn'], 'ambiguous', undefined],
  ])('routes installed variants %j', async (available, status, cli) => {
    const probe = vi.fn(async (id) => (available as string[]).includes(id))
    expect(await resolveAvailableCliName('qoder', probe)).toMatchObject({ status, ...(cli ? { cli } : {}) })
    expect(probe.mock.calls.map(([id]) => id)).toEqual(['qoder', 'qodercn'])
  })
  it.each([
    'qodercn',
    'qoder CN',
    'Qoder CLI CN',
    'qoder中国版',
    '中国版 qoder',
    'qoder国际版',
    '国际版 qoder',
    'qoder international',
  ])('keeps explicit %s exact without installation fallback', async (name) => {
    const probe = vi.fn()
    expect(isGenericQoderName(name)).toBe(false)
    expect(await resolveAvailableCliName(name, probe)).toEqual(resolveCliName(name))
    expect(probe).not.toHaveBeenCalled()
  })
  it.each([
    ['调用 qoder 检查代码', 'qoder'],
    ['调用 qoder cli cn 检查代码', 'qodercn'],
    ['调用 qoder CLI 中国版 检查代码', 'qodercn'],
    ['使用 qoder CLI 国际版 检查代码', 'qoder'],
    ['使用 qoder国际版 cli 检查代码', 'qoder'],
    ['调用 中国版 qoder 检查代码', 'qodercn'],
  ])('recognizes %s', (text, cli) => {
    expect(invocationResolution([user(text)])).toMatchObject({ status: 'resolved', cli })
  })
  it('does not convert permission or cleanup failures into installation absence', async () => {
    const error = new Error('synthetic installation unreadable')
    await expect(
      resolveAvailableCliName('qoder', async (cli) => {
        if (cli === 'qoder') throw error
        return true
      }),
    ).rejects.toBe(error)
  })
})

describe('native Qoder variant question before model selection', () => {
  it('refuses a native question error before model selection or publication', async () => {
    const f = fixture()
    f.ask.mockRejectedValue(new Error('synthetic question failed'))
    await expect(f.start()).rejects.toThrow('synthetic question failed')
    expect(f.service.chooseDispatch).not.toHaveBeenCalled()
    expect(f.service.launch).not.toHaveBeenCalled()
    expect(f.service.pending.size).toBe(0)
  })
  it('checks parent and permission gates before probing installations', async () => {
    for (const gate of ['child', 'plan', 'read-only']) {
      const f = fixture()
      if (gate === 'child') f.agent.session.header.origin = 'subagent'
      else if (gate === 'plan') f.agent.ctx.get = () => ({ get: () => ({ active: true }) }) as any
      else f.agent.ctx.get = () => ({ resolve: () => ({ mode: 'read-only' }) }) as any
      await expect(f.start()).rejects.toThrow()
      expect(f.backend.resolveExecutable).not.toHaveBeenCalled()
      expect(f.ask).not.toHaveBeenCalled()
      expect(f.service.launch).not.toHaveBeenCalled()
    }
  })
  it.each([['qoder'], ['qodercn']])('uses only installed %s without version question', async (cli) => {
    const f = fixture([cli])
    expect(await f.start()).toBe('synthetic-receipt')
    expect(f.ask).not.toHaveBeenCalled()
    expect(f.service.chooseDispatch).toHaveBeenCalledWith(f.agent, expect.any(AbortSignal), cli, f.agent)
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it.each(['Qoder', 'Qoder CN'])(
    'asks for both installed and forwards %s only after answer',
    async (label) => {
      const f = fixture()
      let answer!: (value: unknown) => void
      f.ask.mockImplementation(
        () =>
          new Promise((resolve) => {
            answer = resolve
          }),
      )
      const pending = f.start()
      await vi.waitFor(() => expect(f.ask).toHaveBeenCalledOnce())
      expect(f.ask.mock.calls[0]![0].questions[0]).toMatchObject({
        id: 'cliworker_qoder_variant',
        options: [{ label: 'Qoder' }, { label: 'Qoder CN' }],
      })
      expect(f.service.chooseDispatch).not.toHaveBeenCalled()
      expect(f.service.launch).not.toHaveBeenCalled()
      answer(f.answer(label))
      await pending
      expect(f.service.chooseDispatch).toHaveBeenCalledWith(
        f.agent,
        expect.any(AbortSignal),
        label === 'Qoder' ? 'qoder' : 'qodercn',
        f.agent,
      )
      expect(f.service.pending.size).toBe(0)
    },
  )
  it('read-only resolve reports both candidates without questions, account lookup or persistence', async () => {
    const f = fixture()
    const store = { read: vi.fn(), remember: vi.fn(), reset: vi.fn() }
    f.service.options.cliExecutablePaths = store
    expect(JSON.parse(await f.resolve())).toEqual({ status: 'ambiguous', candidates: ['qoder', 'qodercn'] })
    expect(f.ask).not.toHaveBeenCalled()
    expect(f.service.chooseDispatch).not.toHaveBeenCalled()
    expect(store.remember).not.toHaveBeenCalled()
    expect(store.reset).not.toHaveBeenCalled()
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it('refuses no installation and does not substitute CN for an explicit international request', async () => {
    const f = fixture([])
    await expect(f.start()).rejects.toThrow('未找到 Qoder')
    expect(f.service.chooseDispatch).not.toHaveBeenCalled()
    expect(f.service.launch).not.toHaveBeenCalled()
    await f.start('qoder国际版')
    expect(f.service.chooseDispatch).toHaveBeenLastCalledWith(f.agent, expect.any(AbortSignal), 'qoder', f.agent)
    expect(f.ask).not.toHaveBeenCalled()
  })
  it('retains configured missing paths, broken installations and cleanup errors as errors', async () => {
    const f = fixture(['qodercn'])
    f.service.options.qoderExecutable = '/synthetic/manual-qoder'
    await expect(f.resolve()).rejects.toThrow('synthetic missing')
    f.service.options.qoderExecutable = 'qoder'
    for (const error of [
      new WindowsCliInstallationError('synthetic broken install', true),
      new ProcessCleanupUnconfirmedError(),
    ]) {
      f.backend.resolveExecutable.mockRejectedValue(error)
      await expect(f.start()).rejects.toBe(error)
    }
    expect(f.service.runtime.blockCatalogOnCleanup).toHaveBeenCalled()
    expect(f.service.launch).not.toHaveBeenCalled()
  })
  it('accepts native missing-executable error as absence', async () => {
    const f = fixture()
    f.backend.resolveExecutable.mockRejectedValue(new SubprocessExecutableNotFoundError('qoder'))
    expect(JSON.parse(await f.resolve())).toMatchObject({ status: 'unavailable' })
  })
  it.each([
    { answers: [] },
    { answers: [{ id: 'cliworker_qoder_variant', selected: ['Qoder', 'Qoder CN'] }] },
    { answers: [{ id: 'cliworker_qoder_variant', selected: ['Qoder'], custom: 'CN' }] },
  ])('refuses incomplete, multiple or custom answers before selection', async (answer) => {
    const f = fixture()
    f.ask.mockResolvedValue(answer)
    await expect(f.start()).rejects.toThrow('请选择 Qoder 或 Qoder CN')
    expect(f.service.chooseDispatch).not.toHaveBeenCalled()
    expect(f.service.launch).not.toHaveBeenCalled()
  })
  it('cancels a question and ignores late answers', async () => {
    const f = fixture()
    let answer!: (value: unknown) => void
    f.ask.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    const pending = f.start()
    const rejected = expect(pending).rejects.toThrow('synthetic cancel')
    await vi.waitFor(() => expect(f.ask).toHaveBeenCalledOnce())
    f.controller.abort(new Error('synthetic cancel'))
    await rejected
    answer(f.answer('Qoder CN'))
    await Promise.resolve()
    expect(f.service.chooseDispatch).not.toHaveBeenCalled()
    expect(f.service.launch).not.toHaveBeenCalled()
    expect(f.service.pending.size).toBe(0)
  })
  it('rechecks project and native permission after the version answer', async () => {
    for (const changed of ['project', 'plan', 'disabled']) {
      const f = fixture()
      f.ask.mockImplementation(async () => {
        if (changed === 'project') f.agent.session.header.cwd = '/synthetic/changed'
        if (changed === 'plan')
          f.agent.ctx.get = (name: string) =>
            name === 'planMode' ? ({ get: () => ({ active: true }) } as any) : undefined
        if (changed === 'disabled')
          f.service.runtime.assertCliEnabled.mockImplementation(() => {
            throw new Error('disabled')
          })
        return f.answer('Qoder CN')
      })
      await expect(f.start()).rejects.toThrow()
      expect(f.service.chooseDispatch).not.toHaveBeenCalled()
      expect(f.service.launch).not.toHaveBeenCalled()
    }
  })
})
