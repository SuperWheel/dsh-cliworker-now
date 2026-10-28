import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, mkdir, symlink, link, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import { createNativeHarnessTools, classifyHarnessTool, type NativeHarnessToolsOptions } from '../src/host/native-harness-tools.ts'
import { buildNativeHarnessInjection, nativeHarnessMcpServers, nativeHarnessToolCapability } from '../src/host/native-harness-injection.mjs'
import { runNativeHarnessMcp, HARNESS_CONNECTION_ENV } from '../src/host/native-harness-mcp.mjs'
import { nativeCodexArgv } from '../src/host/native-codex.mjs'
import { prepareNativeWorker } from '../src/host/native-worker.ts'
import nativeHarnessExtension, { prepareNativeHarnessExtension, nativeHarnessExtensionToolName } from '../src/host/native-harness-extension.mjs'
import { HARNESS_FALLBACK_PREFIX } from '../src/host/cli-native-capabilities.mjs'

// All tool bodies, skills and native protocol input in this suite are synthetic.
const binding = { parentSessionId: 'parent', harnessSessionId: 'child', workerId: 'worker', runId: 'run', cli: 'codex' }
const clientId = '00000000-0000-4000-8000-000000000000'
const grant = { name: 'read_file', description: '模拟文件工具', inputSchema: { type: 'object' }, execution: 'host' as const }
const leases: Array<{ close(): Promise<void> }> = [], directories: string[] = []
afterEach(async () => { await Promise.all(leases.splice(0).map(lease => lease.close())); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); vi.unstubAllEnvs() })
async function lease(overrides: Partial<NativeHarnessToolsOptions> = {}) {
  const execute = vi.fn(async () => ({ simulated: true })), authorize = vi.fn(async () => {})
  const result = await createNativeHarnessTools({ binding, tools: [grant], execute, authorize, executionReady: true, ...overrides })
  leases.push(result)
  return { ...result, execute, authorize }
}
async function rpc(target: Awaited<ReturnType<typeof lease>>, method: string, params: unknown = {}, extra: Record<string, unknown> = {}, token = target.connection.token) {
  const response = await fetch(target.connection.url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ binding, clientId, id: 1, method, params, ...extra }) })
  return { status: response.status, ...await response.json() as Record<string, unknown> }
}
describe('run-isolated Harness MCP bridge (synthetic)', () => {
  it.each([6000, 9000])('rejects a %i-byte Chinese result before MCP wrapping and keeps the bridge usable', async bytes => {
    // SIMULATED multibyte payload: below max chars, over byte budget or envelope reserve.
    const maximum = 8192, text = '中'.repeat(bytes / 3)
    expect(text.length).toBeLessThan(maximum)
    expect(Buffer.byteLength(text)).toBeGreaterThan(maximum - 4096)
    const execute = vi.fn(async () => ({ content: [{ type: 'text', text }] }))
    const target = await lease({ maxBytes: maximum, execute })
    expect((await rpc(target, 'tools/call', { name: grant.name })).error).toBe('工具桥响应超过限制；不会自动重试')
    expect(execute).toHaveBeenCalledOnce()
    const input = new PassThrough(), output = new PassThrough()
    let data = ''; output.on('data', chunk => { data += String(chunk) })
    const carrier = runNativeHarnessMcp({ input, output, maximum, env: { [HARNESS_CONNECTION_ENV]: JSON.stringify(target.connection) } })
    try {
      input.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: grant.name } }) + '\n')
      await vi.waitFor(() => expect(data).toContain('工具桥响应超过限制；不会自动重试'))
      expect(Buffer.byteLength(data)).toBeLessThan(maximum)
      expect(execute).toHaveBeenCalledTimes(2)
    } finally { await carrier.close() }
    expect((await rpc(target, 'tools/list', {}, { id: 2 })).result).toMatchObject({ tools: [{ name: grant.name }] })
  })

  it('inherits exact scoped registry grants without treating a built-in name or MCP prefix as authorization', () => {
    const names = ['read', 'write', 'edit', 'bash', 'read_image', 'grep', 'mcp__configured__read', 'read_file']
    const schemas = names.map(name => ({ name }))
    for (const name of names) {
      expect(classifyHarnessTool(name)).toBe('unknown')
      expect(classifyHarnessTool(name, schemas)).toBe('host')
    }
    for (const name of ['send_message', 'subagent', 'subagents.prompt', 'interrupt_agent', 'run_code', 'cliworker_create'])
      expect(classifyHarnessTool(name, [{ name }])).toBe('dispatch')
    for (const name of ['mcp__arbitrary__read', 'read_canary', 'READ']) expect(classifyHarnessTool(name, schemas)).toBe('unknown')
  })
  it('refreshes the visible catalog and rejects new calls and cached receipts after revocation', async () => {
    const mcp = { ...grant, name: 'mcp__configured__lookup', description: '模拟已配置 MCP' }
    let visible = [grant, mcp]
    const target = await lease({ tools: () => visible })
    expect((await rpc(target, 'tools/list')).result).toMatchObject({ tools: [
      { name: grant.name }, { name: mcp.name },
    ] })
    const call = { name: mcp.name, arguments: { query: 'synthetic' } }
    const [first, retry] = await Promise.all([
      rpc(target, 'tools/call', call, { id: 2 }), rpc(target, 'tools/call', call, { id: 2 }),
    ])
    expect(first).toEqual(retry)
    expect(target.execute).toHaveBeenCalledOnce()
    expect(target.authorize).toHaveBeenCalledWith(binding, { method: 'tools/call', name: mcp.name })
    visible = [grant]
    expect((await rpc(target, 'tools/list', {}, { id: 3 })).result).toMatchObject({ tools: [{ name: grant.name }] })
    for (const id of [2, 4]) expect((await rpc(target, 'tools/call', call, { id })).error).toContain('授权目录')
    expect(target.execute).toHaveBeenCalledOnce()
    // Adding a newly authorized tool does not require restarting the CLI run.
    visible = [grant, { ...mcp, description: '重新注册的目录说明' }]
    expect((await rpc(target, 'tools/list', {}, { id: 5 })).result).toMatchObject({ tools: [
      { name: grant.name }, { name: mcp.name, description: `${HARNESS_FALLBACK_PREFIX}重新注册的目录说明` },
    ] })
  })
  it('fails closed on a changed invalid catalog and never executes a duplicate or reserved grant', async () => {
    let visible = [grant]
    const target = await lease({ tools: () => visible })
    visible = [grant, grant]
    expect((await rpc(target, 'tools/list')).error).toContain('重名')
    expect((await rpc(target, 'tools/call', { name: grant.name }, { id: 2 })).error).toContain('重名')
    visible = [{ ...grant, name: 'dsh_read_skill' }]
    expect((await rpc(target, 'tools/list', {}, { id: 3 })).error).toContain('重名')
    expect(target.execute).not.toHaveBeenCalled()
  })
  it('exports only explicit Host grants and invokes the guarded dependency once', async () => {
    const target = await lease({ tools: [grant, { ...grant, name: 'model', execution: 'model' }, { ...grant, name: 'dispatch', execution: 'dispatch' }, { ...grant, name: 'run_code' }] })
    expect((await rpc(target, 'tools/list')).result).toEqual({ tools: [{ name: grant.name, description: `${HARNESS_FALLBACK_PREFIX}${grant.description}`, inputSchema: grant.inputSchema }] })
    const args = { name: 'read_file', arguments: { path: 'simulated.txt' } }
    const [first, repeated] = await Promise.all([rpc(target, 'tools/call', args, { id: 2 }), rpc(target, 'tools/call', args, { id: 2 })])
    expect(first).toEqual(repeated); expect(target.execute).toHaveBeenCalledTimes(1)
    expect(target.execute.mock.calls[0]?.[0]).toMatchObject({ binding, name: 'read_file', arguments: { path: 'simulated.txt' } })
    expect((await rpc(target, 'tools/call', { ...args, arguments: { path: 'other' } }, { id: 2 })).error).toContain('不同参数')
    expect((await rpc(target, 'tools/call', { name: 'model' }, { id: 3 })).error).toContain('授权目录')
    expect(target.authorize).toHaveBeenCalled()
  })
  it('never exports or invokes agent-message and dispatch names even if mislabeled Host (synthetic)', async () => {
    const names = ['send_message', 'send_message.parent', 'interrupt_agent', 'subagent', 'subagents', 'subagents.prompt',
      'subagent_tool', 'spawn_agent', 'delegate_task', 'agent_subagent', 'list_subagent_models', 'resume_subagent']
    const target = await lease({ tools: [grant, ...names.map(name => ({ ...grant, name }))] })
    expect((await rpc(target, 'tools/list')).result).toEqual({ tools: [{ name: grant.name, description: `${HARNESS_FALLBACK_PREFIX}${grant.description}`, inputSchema: grant.inputSchema }] })
    for (const [index, name] of names.entries()) expect((await rpc(target, 'tools/call', { name }, { id: index + 10 })).error).toContain('授权目录')
    expect(target.execute).not.toHaveBeenCalled()
  })
  it('preserves the public ToolRuntime text projection and failure flag (synthetic)', async () => {
    const success = await lease({ execute: async () => ({ isError: false, value: 'private canonical value', meta: { internal: true }, content: [{ type: 'text', text: 'public tool output' }] }) })
    expect((await rpc(success, 'tools/call', { name: grant.name })).result).toEqual({ isError: false, content: [{ type: 'text', text: 'public tool output' }] })
    const failure = await lease({ execute: async () => ({ isError: true, error: { internal: 'not model-facing' }, content: [{ type: 'text', text: 'permission denied' }] }) })
    expect((await rpc(failure, 'tools/call', { name: grant.name })).result).toEqual({ isError: true, content: [{ type: 'text', text: 'permission denied' }] })
  })
  it('reports unsupported image/reference/context results as MCP errors instead of successful JSON (synthetic)', async () => {
    for (const content of [[{ type: 'image', ref: { id: 'PRIVATE_ATTACHMENT_REF' } }], [{ type: 'file', ref: { id: 'PRIVATE_FILE_REF' } }], [{ type: 'text', text: 123 }]]) {
      const target = await lease({ execute: async () => ({ isError: false, value: 'must not substitute value', content }) })
      const result = (await rpc(target, 'tools/call', { name: grant.name })).result
      expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringContaining('非文本') }] })
      expect(JSON.stringify(result)).not.toContain('PRIVATE_')
      expect(JSON.stringify(result)).not.toContain('must not substitute')
    }
    const contextual = await lease({ execute: async () => ({ isError: false, content: [{ type: 'text', text: 'partial' }], additionalContexts: [{ secret: 'must not drop silently' }] }) })
    expect((await rpc(contextual, 'tools/call', { name: grant.name })).result).toMatchObject({ isError: true, content: [{ text: 'partial' }, { text: expect.stringContaining('额外上下文') }] })
    const mixed = await lease({ execute: async () => ({ isError: false, content: [
      { type: 'text', text: 'before' }, { type: 'image', attachment: { id: 'PRIVATE_IMAGE_REF' } }, { type: 'text', text: 'after' },
    ] }) })
    expect((await rpc(mixed, 'tools/call', { name: grant.name })).result).toEqual({ isError: true, content: [
      { type: 'text', text: 'before' }, { type: 'text', text: expect.stringContaining('非文本') }, { type: 'text', text: 'after' },
    ] })
  })
  it('rejects authentication, run substitution, browser origin and revoked authorization', async () => {
    let allowed = true
    const target = await lease({ authorize: async () => { if (!allowed) throw new Error('private diagnostic') } })
    expect((await rpc(target, 'tools/list', {}, {}, 'invalid')).status).toBe(403)
    expect((await rpc(target, 'tools/list', {}, { binding: { ...binding, runId: 'stale' } })).status).toBe(400)
    const response = await fetch(target.connection.url, { method: 'POST', headers: { Authorization: `Bearer ${target.connection.token}`, Origin: 'https://example.invalid' }, body: '{}' })
    expect(response.status).toBe(403)
    allowed = false
    expect(await rpc(target, 'tools/call', { name: 'read_file' })).toMatchObject({ status: 400, error: '工具桥调用失败；未自动重试' })
    expect(target.execute).not.toHaveBeenCalled()
  })
  it('distinguishes transport from unverified execution', async () => {
    const target = await lease({ executionReady: false })
    expect(target.capabilities.ready).toBe(false)
    expect((await rpc(target, 'tools/list')).status).toBe(200)
    expect((await rpc(target, 'tools/call', { name: 'read_file' }, { id: 2 })).error).toContain('尚未核验')
    expect(target.execute).not.toHaveBeenCalled()
  })
  it('aborts then drains an active tool before close resolves', async () => {
    let settle!: () => void, entered!: () => void, signal!: AbortSignal
    const started = new Promise<void>(yes => { entered = yes })
    const target = await lease({ execute: async input => { signal = input.signal; entered(); await new Promise<void>(yes => { settle = yes }); return 'settled' } })
    const request = rpc(target, 'tools/call', { name: 'read_file' })
    await started
    let closed = false
    const closing = target.close().then(() => { closed = true })
    await new Promise(yes => setTimeout(yes, 10))
    expect(signal.aborted).toBe(true); expect(closed).toBe(false)
    settle(); expect((await request).status).toBe(400)
    await closing; expect(closed).toBe(true)
    await expect(fetch(target.connection.url)).rejects.toThrow()
  })
  it('cancels an exact MCP request without cancelling the run or retrying it', async () => {
    let entered!: () => void
    const started = new Promise<void>(yes => { entered = yes })
    const execute = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      entered(); await new Promise<void>(yes => signal.addEventListener('abort', () => yes(), { once: true })); return 'late simulated output'
    })
    const target = await lease({ execute })
    const pending = rpc(target, 'tools/call', { name: 'read_file' }, { id: 5 })
    await started
    expect((await rpc(target, 'rpc/cancel', { requestId: 5 }, { id: 'cancel:5' })).status).toBe(200)
    expect((await pending).error).toContain('已取消')
    expect((await rpc(target, 'tools/call', { name: 'read_file' }, { id: 5 })).status).toBe(400)
    expect(execute).toHaveBeenCalledTimes(1)
    expect((await rpc(target, 'tools/list', {}, { id: 6 })).status).toBe(200)
    await rpc(target, 'rpc/cancel', { requestId: 8 }, { id: 'cancel:8' })
    expect((await rpc(target, 'tools/call', { name: 'read_file' }, { id: 8 })).status).toBe(400)
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('loads scoped skills on demand and refuses missing tools and escaping resources', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cwn-harness-skills-')); directories.push(directory)
    const root = join(directory, 'skill'); await mkdir(root); await writeFile(join(root, 'example.txt'), 'synthetic resource')
    await writeFile(join(directory, 'outside.txt'), 'must not expose')
    await symlink(join(directory, 'outside.txt'), join(root, 'escape.txt'))
    await link(join(root, 'example.txt'), join(root, 'hard.txt'))
    const get = vi.fn(async (name: string) => ({ name, description: '模拟技能', content: 'simulated instructions', requiredTools: name === 'missing' ? ['unavailable'] : ['read_file'], resourceBase: { kind: 'directory' as const, path: root } }))
    let visibleSkills = [{ name: 'example', description: 'example' }, { name: 'missing', description: 'missing' }]
    const target = await lease({ skills: { list: async () => visibleSkills, get } })
    await rpc(target, 'tools/list'); expect(get).not.toHaveBeenCalled()
    expect((await rpc(target, 'tools/call', { name: 'dsh_read_skill', arguments: { name: 'example' } }, { id: 2 })).status).toBe(200)
    for (const [index, path] of ['../outside.txt', '/outside.txt', 'escape.txt', 'hard.txt', '%2e%2e/outside.txt'].entries())
      expect((await rpc(target, 'tools/call', { name: 'dsh_read_skill_resource', arguments: { name: 'example', path } }, { id: index + 3 })).status).toBe(400)
    expect((await rpc(target, 'tools/call', { name: 'dsh_read_skill', arguments: { name: 'missing' } }, { id: 9 })).error).toContain('所需工具')
    await writeFile(join(root, 'safe.txt'), 'safe')
    const resource = await rpc(target, 'resources/read', { uri: 'dsh-skill://example/safe.txt' }, { id: 10 })
    expect(resource.result).toMatchObject({ contents: [{ blob: Buffer.from('safe').toString('base64') }] })
    visibleSkills = []
    expect((await rpc(target, 'resources/read', { uri: 'dsh-skill://example/safe.txt' }, { id: 10 })).error).toContain('授权目录')
  })
  it('rechecks scoped skill visibility and live tool dependencies even for a cached skill receipt', async () => {
    let visibleTools = [grant], visibleSkills = [{ name: 'example', description: '模拟技能' }]
    const target = await lease({ tools: () => visibleTools, skills: {
      list: async () => visibleSkills,
      get: async name => ({ name, description: '模拟技能', content: 'scoped content', requiredTools: [grant.name] }),
    } })
    const call = { name: 'dsh_read_skill', arguments: { name: 'example' } }
    expect((await rpc(target, 'tools/call', call)).status).toBe(200)
    visibleTools = []
    expect((await rpc(target, 'tools/call', call)).error).toContain('所需工具')
    visibleTools = [grant]
    visibleSkills = []
    expect((await rpc(target, 'tools/call', call)).error).toContain('授权目录')
    expect(target.execute).not.toHaveBeenCalled()
  })
  it('carries MCP initialization and a tool call without leaking transport secrets', async () => {
    const target = await lease(), input = new PassThrough(), output = new PassThrough()
    let data = ''; output.on('data', chunk => { data += String(chunk) })
    const carrier = runNativeHarnessMcp({ input, output, env: { [HARNESS_CONNECTION_ENV]: JSON.stringify(target.connection) } })
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })}\n`)
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_file', arguments: {} } })}\n`)
    await vi.waitFor(() => expect(data).toContain('simulated'))
    expect(data).toContain('protocolVersion'); expect(data).not.toContain(target.connection.token)
    await carrier.close(); expect(target.execute).toHaveBeenCalledTimes(1)
  })
  it('runs the actual stdio carrier and exits after EOF with no model or CLI', async () => {
    const target = await lease()
    const child = spawn(process.execPath, [resolve('src/host/native-harness-mcp.mjs')], { env: { ...process.env, [HARNESS_CONNECTION_ENV]: JSON.stringify(target.connection) }, stdio: ['pipe', 'pipe', 'pipe'] })
    const closed = new Promise<number | null>(yes => child.once('close', yes))
    let output = ''; child.stdout.on('data', bytes => { output += String(bytes) })
    try {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })}\n${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_file', arguments: {} } })}\n`)
      await vi.waitFor(() => expect(output).toContain('simulated'))
      child.stdin.end()
      expect(await Promise.race([closed, new Promise(yes => setTimeout(() => yes('timeout'), 3000))])).toBe(0)
      expect(output).not.toContain(target.connection.token)
    } finally { if (child.exitCode === null) child.kill('SIGKILL'); await closed }
  })
})
describe('temporary native injection (synthetic)', () => {
  it.each(['codex', 'claude', 'opencode', 'mimo', 'kimi', 'grok', 'pi', 'qoder', 'qodercn'])('injects %s without putting secrets in argv', async cli => {
    const target = await lease({ binding: { ...binding, cli } })
    const argv = cli === 'claude' ? ['claude', '--print', '--model', 'fixture', 'prompt'] : [cli, 'serve']
    const result = buildNativeHarnessInjection({ cli, argv, env: {}, connection: target.connection, mcpEntryPath: '/synthetic/bridge.mjs' })
    expect(result.transport).toBe(true); expect(result.ready).toBe(true)
    expect(result.argv.join(' ')).not.toContain(target.connection.token)
    expect(result.env[HARNESS_CONNECTION_ENV]).toContain(target.connection.token)
    if (['kimi', 'grok'].includes(cli)) expect(result.acpMcpServers).toHaveLength(1)
    expect(argv).toEqual(cli === 'claude' ? ['claude', '--print', '--model', 'fixture', 'prompt'] : [cli, 'serve'])
  })
  it('has concrete unavailable reasons and refuses CLI/namespace conflicts', async () => {
    for (const cli of ['omp', 'hermes', 'zcode']) expect(nativeHarnessToolCapability(cli, undefined)).toMatchObject({ transport: false, ready: false, reason: expect.any(String) })
    const target = await lease()
    expect(() => buildNativeHarnessInjection({ cli: 'kimi', argv: ['kimi'], connection: target.connection })).toThrow('身份不匹配')
    expect(() => buildNativeHarnessInjection({ cli: 'opencode', argv: ['opencode'], connection: { ...target.connection, binding: { ...binding, cli: 'opencode' } }, env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: { dsh_worker_tools: {} } }) } })).toThrow('拒绝覆盖')
    expect(nativeHarnessMcpServers({ cli: 'kimi', argv: ['kimi'] }, {})).toEqual([])
  })
  it('registers Pi explicit extension schemas and preserves call identity', async () => {
    const cli = 'pi'
    const target = await lease({ binding: { ...binding, cli } })
    vi.stubEnv(HARNESS_CONNECTION_ENV, JSON.stringify(target.connection))
    const prepared = await prepareNativeHarnessExtension(target.connection)
    expect(prepared.argv).toEqual(['--extension', expect.stringMatching(/native-harness-extension\.mjs$/u)])
    expect(prepared.tools).toEqual([nativeHarnessExtensionToolName(grant.name)])
    expect(prepared.argv.join(' ')).not.toContain(target.connection.token)
    const registerTool = vi.fn()
    await nativeHarnessExtension({ registerTool })
    const tool = registerTool.mock.calls[0][0]
    expect(tool).toMatchObject({ name: prepared.tools[0], parameters: grant.inputSchema })
    expect(await tool.execute('native-call', { path: 'simulated' })).toMatchObject({ content: [{ type: 'text' }] })
    await tool.execute('native-call', { path: 'simulated' })
    expect(target.execute).toHaveBeenCalledTimes(1)
    await expect(tool.execute('native-call', { path: 'different' })).rejects.toThrow('不同参数')
    expect(await prepareNativeHarnessExtension({ ...target.connection, executionReady: false })).toEqual({ argv: [], tools: [] })
    await expect(prepareNativeHarnessExtension({ ...target.connection, binding: { ...target.connection.binding, cli: 'omp' } })).rejects.toThrow('尚未核验')
  })
  it('forwards extension cancellation to the exact Host tool operation', async () => {
    let entered!: () => void, toolSignal!: AbortSignal
    const started = new Promise<void>(yes => { entered = yes })
    const target = await lease({ binding: { ...binding, cli: 'pi' }, execute: async ({ signal }) => {
      toolSignal = signal; entered(); await new Promise<void>(yes => signal.addEventListener('abort', () => yes(), { once: true })); return 'late output'
    } })
    vi.stubEnv(HARNESS_CONNECTION_ENV, JSON.stringify(target.connection))
    const registerTool = vi.fn(); await nativeHarnessExtension({ registerTool })
    const tool = registerTool.mock.calls[0][0], controller = new AbortController()
    const operation = tool.execute('native-cancel', {}, controller.signal)
    await started; controller.abort()
    await expect(operation).rejects.toThrow('未自动重试')
    expect(toolSignal.aborted).toBe(true)
  })
  it('keeps Codex prompt last and credentials out of its private request file', async () => {
    const { readFile } = await import('node:fs/promises')
    const target = await lease(), root = await realpath(await mkdtemp(join(tmpdir(), 'cwn-harness-request-'))); directories.push(root)
    const executable = join(root, 'synthetic-codex.mjs')
    await writeFile(executable, '#!/usr/bin/env node\n// Synthetic entry, never executed by this request-construction test.\n', { mode: 0o700 })
    const prompt = 'synthetic', preference = { cli: 'codex' as const, model: 'fixture', effort: 'default' }
    const launch = await prepareNativeWorker({ argv: [executable, 'exec', '--json', '--model', 'fixture', `任务：\n${prompt}`] }, { cli: 'codex', project: root, preference, mode: 'write', prompt, stateDirectory: root, harnessTools: target.connection }, { timeoutMs: 1000, maxLineBytes: 10000, maxRunBytes: 10000 } as never)
    const raw = await readFile(launch.argv[2], 'utf8'), request = JSON.parse(raw)
    expect(raw).not.toContain(target.connection.token)
    expect(nativeCodexArgv(request)).toContain('app-server')
    expect(launch.env[HARNESS_CONNECTION_ENV]).toContain(target.connection.token)
    await launch.cleanup()
  })
})
