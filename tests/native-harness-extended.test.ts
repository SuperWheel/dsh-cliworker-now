import { createNativeHarnessExecutor } from '../src/host/native-harness-executor.ts'
import { mountNativeTools } from './fixtures/harness-native-tools.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { type Agent } from '@deepseek-ai/dsh-agent'
import { LlmRuntime, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { classifyHarnessTool, createNativeHarnessTools } from '../src/host/native-harness-tools.ts'
import { installHarnessModelGuard, withinCliTool } from '../src/host/harness-model-guard.ts'
import { HARNESS_CONNECTION_ENV } from '../src/host/native-harness-mcp.mjs'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
vi.mock('../src/host/opencode-adapter.ts', async original => ({
  ...await original<typeof import('../src/host/opencode-adapter.ts')>(),
  prepareOpenCode: vi.fn(async () => ({ argv: ['opencode', 'run', '--model', 'fixture/model', '--', 'synthetic'],
    env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: 'fixture/model' }) } })),
}))
import { extendedLaunch } from '../src/host/extended-adapters.ts'
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

// Installed rc.2 registry, scope restrictions, MCP adapter, and policy pipeline.
// The upstream MCP tool and Agent identities are synthetic; no external server,
// CLI, account, or model is called.
const runtimeRequire = createRequire(realpathSync(new URL('../node_modules/@deepseek-ai/dsh/package.json', import.meta.url)))
async function registryBridge() {
  const { createMcpToolDefinition } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-mcp-client')).href)
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await mountNativeTools(ctx)
  const parent = { id: 'synthetic-parent' } as Agent, child = { id: 'synthetic-child' } as Agent
  const parentScope = createScope(ctx, parent), childScope = createScope(ctx, child, { parent })
  let parentContext!: Context, childContext!: Context
  await parentScope.ctx.inject(['tools'], inner => { parentContext = inner })
  await childScope.ctx.inject(['tools'], inner => { childContext = inner })
  // A simulated PTC-shaped provider is already selected in this exact child.
  // Bridge calls must reach capability tools without replacing or using it.
  const selectedExecutor = {
    describe: () => ({ schemas: [{ name: 'run_code', description: 'Synthetic program executor', parameters: { type: 'object' as const } }] }),
    execute: vi.fn(async () => ({ results: [], additionalContexts: [], concluded: false })),
  }
  childContext.tools.setExecutor(selectedExecutor)
  const binding = { parentSessionId: parent.id, harnessSessionId: child.id, workerId: 'synthetic-worker', runId: 'synthetic-run', cli: 'codex' }
  const register = (name: string, call: (args: Record<string, unknown>, exec: { signal: AbortSignal }) => Promise<unknown>) =>
    ctx.tools.register(createMcpToolDefinition(ctx, { name, rawName: 'synthetic-tool', description: '模拟 MCP 工具', inputSchema: { type: 'object' }, call }))
  const executor = await createNativeHarnessExecutor(childContext)
  const execute = vi.fn(async (call) => withinCliTool(binding.runId, () => executor.execute({
    callId: ToolCallId(`cliworker:${call.callId}`), name: call.name, arguments: call.arguments, agent: child, signal: call.signal,
  })))
  const target = await createNativeHarnessTools({ binding, executionReady: true, authorize: () => {}, execute,
    tools: () => {
      const schemas = childContext.tools.schemas(child)
      return schemas.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters, execution: classifyHarnessTool(tool.name, schemas) }))
    },
  })
  const rpc = async (method: string, params: Record<string, unknown> = {}, id: string | number = 1) => {
    const response = await fetch(target.connection.url, { method: 'POST', headers: { Authorization: `Bearer ${target.connection.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ binding, clientId: '00000000-0000-4000-8000-000000000001', method, params, id }) })
    return { status: response.status, ...await response.json() as Record<string, any> }
  }
  return { ctx, child, parentContext, childContext, selectedExecutor, executor, register, execute, rpc, close: async () => {
    await target.close(); executor.dispose(); await childScope.dispose(); await parentScope.dispose(); await ctx.fiber.dispose()
  } }
}

it('routes registered MCP tools through real inherited visibility and pre-execution policy, with live revocation (synthetic)', async () => {
  const target = await registryBridge()
  try {
    const name = 'mcp__synthetic__lookup', hidden = 'mcp__synthetic__private'
    const body = vi.fn(async () => ({ content: [{ type: 'text', text: 'upstream public result' }] }))
    target.register(name, body)
    target.register(hidden, body)
    target.parentContext.tools.restrict({ deny: [hidden] })
    let admitted = false
    const policy = vi.fn(async (exec, next) => exec.name === name && !admitted ? { kind: 'deny' as const, reason: 'synthetic parent policy denied' } : next())
    target.parentContext.on('tools/pre-execute', policy)
    expect((await target.rpc('tools/list')).result.tools.map((tool: { name: string }) => tool.name)).toEqual([name])
    expect((await target.rpc('tools/call', { name: hidden }, 2)).error).toContain('授权目录')
    const refused = await target.rpc('tools/call', { name }, 3)
    expect(refused.result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('parent policy denied') }] })
    expect(policy).toHaveBeenCalledOnce()
    expect(policy.mock.calls[0]?.[0].agent).toBe(target.child)
    expect(body).not.toHaveBeenCalled()
    admitted = true
    const [first, replay] = await Promise.all([
      target.rpc('tools/call', { name }, 4), target.rpc('tools/call', { name }, 4),
    ])
    expect(first).toEqual(replay)
    expect(first.result).toEqual({ isError: false, content: [{ type: 'text', text: 'upstream public result' }] })
    expect(body).toHaveBeenCalledOnce()
    target.childContext.tools.restrict({ deny: [name] })
    expect((await target.rpc('tools/list', {}, 5)).result.tools).toEqual([])
    for (const id of [4, 6]) expect((await target.rpc('tools/call', { name }, id)).error).toContain('授权目录')
    expect(body).toHaveBeenCalledOnce()
    expect(target.selectedExecutor.execute).not.toHaveBeenCalled()
    target.executor.dispose()
    await target.childContext.tools.execute({ calls: [], agent: target.child, signal: new AbortController().signal })
    expect(target.selectedExecutor.execute).toHaveBeenCalledOnce()
  } finally { await target.close() }
})

it('preserves approval identity, inherited guards and post-execution policy under a different scoped executor (synthetic)', async () => {
  const target = await registryBridge()
  try {
    const name = 'mcp__synthetic__approved'
    const body = vi.fn(async () => ({ content: [{ type: 'text', text: 'upstream result' }] }))
    target.register(name, body)
    const request = vi.fn(async () => 'allowed-once')
    // Only the approval UI response is simulated; the shared pipeline routes it.
    target.ctx.provide('approval', { request } as never)
    target.parentContext.on('tools/pre-execute', async () => ({ kind: 'ask', reason: 'synthetic approval' }))
    const removeGuard = target.parentContext.tools.guard(() => 'synthetic inherited guard')
    const denied = await target.rpc('tools/call', { name }, 1)
    expect(denied.result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('inherited guard') }] })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      agent: target.child, callId: expect.stringMatching(/^cliworker:cwn-harness-/), toolName: name,
    }))
    expect(body).not.toHaveBeenCalled()
    removeGuard()
    target.parentContext.on('tools/post-execute', async () => ({ kind: 'block', feedback: [{ type: 'text', text: 'synthetic post block' }] }))
    expect((await target.rpc('tools/call', { name }, 2)).result).toMatchObject({ isError: true, content: [{ text: 'synthetic post block' }] })
    expect(body).toHaveBeenCalledOnce()
    expect(target.selectedExecutor.execute).not.toHaveBeenCalled()
  } finally { await target.close() }
})

it('retains real MCP error projections and cancels the exact upstream call without replaying it (synthetic)', async () => {
  const target = await registryBridge()
  let settle!: () => void
  try {
    const errorName = 'mcp__synthetic__failure', slowName = 'mcp__synthetic__slow'
    const errorBody = vi.fn(async () => ({ isError: true, content: [{ type: 'text', text: 'upstream refused this request' }] }))
    target.register(errorName, errorBody)
    expect((await target.rpc('tools/call', { name: errorName })).result).toMatchObject({
      isError: true, content: [{ text: expect.stringContaining('upstream refused this request') }],
    })
    let entered!: () => void, signal!: AbortSignal
    const started = new Promise<void>(done => { entered = done })
    const body = vi.fn(async (_args, exec) => {
      signal = exec.signal; entered()
      await new Promise<void>(done => { settle = done })
      return { content: [{ type: 'text', text: 'late upstream result' }] }
    })
    target.register(slowName, body)
    const pending = target.rpc('tools/call', { name: slowName }, 2)
    await started
    expect((await target.rpc('rpc/cancel', { requestId: 2 }, 'cancel:2')).status).toBe(200)
    expect(signal.aborted).toBe(true)
    settle()
    expect((await pending).error).toContain('已取消')
    expect((await target.rpc('tools/call', { name: slowName }, 2)).status).toBe(400)
    expect(body).toHaveBeenCalledOnce()
  } finally { settle?.(); await target.close() }
})

it('cannot use a visible MCP name to bypass the downstream DSH model guard (synthetic)', async () => {
  const target = await registryBridge()
  try {
    await target.ctx.plugin(LlmRuntime)
    const backend = vi.fn()
    target.ctx.on('llm/stream', async function* () {
      backend()
      yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
    })
    installHarnessModelGuard(target.ctx)
    const name = 'mcp__synthetic__model_assisted'
    target.register(name, async (_args, exec) => {
      for await (const _chunk of target.ctx.llm.stream({ provider: 'synthetic', model: 'synthetic', messages: [], signal: exec.signal })) {
        // Deliberately omit sessionId/purpose like an arbitrary third-party tool.
      }
      return { content: [{ type: 'text', text: 'must not reach this result' }] }
    })
    expect((await target.rpc('tools/call', { name })).result).toMatchObject({
      isError: true, content: [{ text: expect.stringContaining('禁止 DSH 模型 API') }],
    })
    expect(backend).not.toHaveBeenCalled()
    for await (const _chunk of target.ctx.llm.stream({ provider: 'synthetic', model: 'synthetic', messages: [] })) {
      // The run-local guard leaves independent DSH calls intact.
    }
    expect(backend).toHaveBeenCalledOnce()
  } finally { await target.close() }
})
it('forwards only the run-private Harness connection through the extended native runner path (synthetic)', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'cwn-harness-extended-'))); directories.push(directory)
  const connection = { url: 'http://127.0.0.1:1/rpc', token: 'A'.repeat(43), binding: {
    parentSessionId: 'simulated-parent', harnessSessionId: 'simulated-child', workerId: 'simulated-worker', runId: 'simulated-run', cli: 'opencode',
  }, executionReady: true }
  const launch = await extendedLaunch('opencode', 'opencode', directory, { cli: 'opencode', model: 'fixture/model', effort: 'default' },
    'plan', 'synthetic', directory, { ...DEFAULT_CONFIG, harnessTools: connection }, undefined, undefined, undefined, true)
  try {
    expect(launch.env?.[HARNESS_CONNECTION_ENV]).toBe(JSON.stringify(connection))
    expect(JSON.parse(launch.env!.OPENCODE_CONFIG_CONTENT!).mcp.dsh_worker_tools).toMatchObject({ type: 'local', enabled: true })
    expect(await readFile(launch.argv.at(-1)!, 'utf8')).not.toContain(connection.token)
    expect(launch.argv.join(' ')).not.toContain(connection.token)
  } finally { await launch.cleanup?.() }
})
