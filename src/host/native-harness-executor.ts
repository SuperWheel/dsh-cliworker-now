import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecutionInput, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

type NativeHarnessCall = Pick<ToolExecutionInput, 'callId' | 'name' | 'arguments' | 'agent' | 'signal'>

/** A run-owned, single-call native path, independent of the scope's model executor. */
export interface NativeHarnessExecutor {
  execute(input: NativeHarnessCall): Promise<ToolExecutionResult>
  dispose(): void
}

/** rc.5's scoped presentation API identifies its single-call execute contract. */
interface LegacyTools {
  presentAs(mode: 'native'): () => void
  execute(input: NativeHarnessCall): Promise<ToolExecutionResult>
}

function isLegacyTools(tools: unknown): tools is LegacyTools {
  return typeof tools === 'object' && tools !== null
    && 'presentAs' in tools && typeof tools.presentAs === 'function'
    && 'execute' in tools && typeof tools.execute === 'function'
}

/**
 * Use the same native scheduler/policy pipeline as NativeToolExecutor without
 * registering an executor (a child may already select PTC). Load the new
 * subpath only on new hosts; rc.5 keeps its scoped presentation and disposer.
 */
export async function createNativeHarnessExecutor(ctx: Context): Promise<NativeHarnessExecutor> {
  const tools = ctx.tools
  if (isLegacyTools(tools)) {
    const dispose = tools.presentAs('native')
    return { execute: input => tools.execute(input), dispose }
  }
  const { ToolExecutionPipeline, executeToolBatch } = await import('@deepseek-ai/dsh-tools/pipeline')
  const pipeline = new ToolExecutionPipeline(ctx)
  return {
    async execute(input) {
      const argumentsJson = JSON.stringify(input.arguments)
      if (argumentsJson === undefined) throw new Error('DSH 工具参数不是有效 JSON')
      const batch = await executeToolBatch({
        calls: [{ type: 'tool-call', id: input.callId, name: input.name, arguments: argumentsJson }],
        agent: input.agent,
        signal: input.signal,
        // No log: this call is outside a Harness model response.
      }, pipeline, () => 1)
      const settled = batch.results.find(result => result.callId === input.callId)
      if (settled) return settled.result
      input.signal.throwIfAborted()
      throw new Error(`DSH 工具调用未返回结果：${input.callId}；未自动重试`)
    },
    // The pipeline mounts no scoped effects or executor selection.
    dispose() {},
  }
}
