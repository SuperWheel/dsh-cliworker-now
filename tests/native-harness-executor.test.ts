import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { executeToolBatch } from '@deepseek-ai/dsh-tools/pipeline'
import { createNativeHarnessExecutor } from '../src/host/native-harness-executor.ts'

vi.mock('@deepseek-ai/dsh-tools/pipeline', async original => ({
  ...await original<typeof import('@deepseek-ai/dsh-tools/pipeline')>(),
  executeToolBatch: vi.fn(),
}))
afterEach(() => vi.resetAllMocks())

const input = (signal = new AbortController().signal): ToolExecutionInput => ({
  callId: ToolCallId('cliworker:synthetic-call'), name: 'synthetic', arguments: {}, signal,
})

it('keeps the old scoped API usable without loading the new pipeline subpath (synthetic rc.5)', async () => {
  const ctx = new Context()
  const result = { isError: false as const, value: 'synthetic', content: [] }
  const dispose = vi.fn()
  const presentAs = vi.fn(() => dispose)
  const execute = vi.fn(async () => result)
  // This fixture models only the old public service; the new API is absent.
  Object.defineProperty(ctx, 'tools', { value: { presentAs, execute } })
  const executor = await createNativeHarnessExecutor(ctx)
  const call = input()
  expect(await executor.execute(call)).toBe(result)
  expect(presentAs).toHaveBeenCalledWith('native')
  expect(execute).toHaveBeenCalledWith(call)
  expect(executeToolBatch).not.toHaveBeenCalled()
  executor.dispose()
  expect(dispose).toHaveBeenCalledOnce()
  await ctx.fiber.dispose()
})

it.each([false, true])('fails explicitly when a batch omits the requested result (aborted=%s)', async aborted => {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ToolRuntime)
    vi.mocked(executeToolBatch).mockResolvedValue({ results: [], additionalContexts: [], concluded: false })
    const executor = await createNativeHarnessExecutor(ctx)
    const controller = new AbortController()
    if (aborted) controller.abort(new Error('synthetic cancellation'))
    await expect(executor.execute(input(controller.signal))).rejects.toThrow(aborted ? 'synthetic cancellation' : '未返回结果')
    expect(executeToolBatch).toHaveBeenCalledOnce()
    executor.dispose()
  } finally { await ctx.fiber.dispose() }
})
