import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeHarnessTools, type NativeHarnessToolsOptions } from '../src/host/native-harness-tools.ts'
import { runNativeGrok } from '../src/host/native-grok.mjs'
import { buildNativeHarnessInjection, nativeHarnessGuidance, nativeHarnessToolCapability } from '../src/host/native-harness-injection.mjs'
import {
  codexDeveloperInstructionsConfigured, HARNESS_FALLBACK_PREFIX, nativeCliCapabilities, nativeCliMcpServers, nativeCoverage, nativeFirstGuidance, piOmpNativeTools,
} from '../src/host/cli-native-capabilities.mjs'

// Catalog names follow the exported dsh-base 0.2.1-rc.2 child catalog; every
// tool body, MCP server and native config below is synthetic.
const schema = { type: 'object' }
const host = (name: string) => ({ name, description: `模拟 ${name}`, inputSchema: schema, execution: 'host' as const })
const dshCatalog = ['read', 'write', 'edit', 'read_image', 'grep', 'glob', 'bash', 'terminal_open', 'job_output', 'web_search', 'web_fetch',
  'skill', 'todo_write', 'ask_user_question', 'mcp__github__search', 'mcp__dsh_only__lookup'].map(host)
const leases: Array<{ close(): Promise<void> }> = [], directories: string[] = []
afterEach(async () => {
  await Promise.all(leases.splice(0).map(lease => lease.close()))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function lease(cli: string, mode: 'plan' | 'accept-edits', overrides: Partial<NativeHarnessToolsOptions> = {}, mcpServers: string[] = []) {
  const execute = vi.fn(async () => ({ isError: false, content: [{ type: 'text', text: 'simulated' }] })), authorize = vi.fn(async () => {})
  const binding = { parentSessionId: 'parent', harnessSessionId: 'child', workerId: 'worker', runId: 'run', cli }
  const result = await createNativeHarnessTools({ binding, tools: dshCatalog, execute, authorize, executionReady: true,
    native: nativeCliCapabilities({ cli, mode, mcpServers }), ...overrides })
  leases.push(result)
  let id = 0
  const rpc = async (method: string, params: unknown = {}) => {
    const response = await fetch(result.connection.url, { method: 'POST', headers: { Authorization: `Bearer ${result.connection.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ binding, clientId: '00000000-0000-4000-8000-000000000000', id: ++id, method, params }) })
    return await response.json() as { result?: any; error?: string }
  }
  const names = async () => ((await rpc('tools/list')).result.tools as Array<{ name: string }>).map(tool => tool.name)
  return { ...result, execute, authorize, rpc, names }
}

describe('native capability table (synthetic)', () => {
  it('keeps Codex overlapping tools native and offers only DSH-only ones as labelled fallbacks', async () => {
    const codex = await lease('codex', 'accept-edits', {}, ['github'])
    expect(await codex.names()).toEqual(['web_search', 'web_fetch', 'todo_write', 'ask_user_question', 'mcp__dsh_only__lookup'])
    for (const tool of (await codex.rpc('tools/list')).result.tools) expect(tool.description.startsWith(HARNESS_FALLBACK_PREFIX)).toBe(true)
    expect(codex.connection.tools).toEqual(['web_search', 'web_fetch', 'todo_write', 'ask_user_question', 'mcp__dsh_only__lookup'])
    // A covered tool is not callable through the bridge either.
    for (const name of ['read', 'bash', 'mcp__github__search', 'skill']) expect((await codex.rpc('tools/call', { name, arguments: {} })).error).toContain('授权目录')
    expect(codex.execute).not.toHaveBeenCalled()
  })
  it('offers Pi the DSH shell as a fallback that still runs through Host authorization', async () => {
    expect(piOmpNativeTools('pi', 'accept-edits')).not.toContain('bash')
    const pi = await lease('pi', 'accept-edits')
    const names = await pi.names()
    expect(names).toEqual(expect.arrayContaining(['bash', 'terminal_open', 'job_output', 'web_search', 'mcp__github__search']))
    for (const name of ['read', 'write', 'edit', 'grep', 'glob', 'read_image', 'skill']) expect(names).not.toContain(name)
    expect((await pi.rpc('tools/call', { name: 'bash', arguments: { command: 'true' } })).result).toEqual({ isError: false, content: [{ type: 'text', text: 'simulated' }] })
    expect(pi.authorize).toHaveBeenCalledWith(expect.objectContaining({ cli: 'pi' }), { method: 'tools/call', name: 'bash' })
    expect(pi.execute).toHaveBeenCalledOnce()
  })
  it('does not offer a DSH write as a plan-mode fallback', async () => {
    const plan = await lease('pi', 'plan')
    for (const name of ['write', 'edit']) expect(await plan.names()).not.toContain(name)
    expect(piOmpNativeTools('pi', 'plan')).toEqual(['read', 'grep', 'find', 'ls'])
  })
  it('drops a DSH MCP server only when the CLI loads the same server natively', () => {
    const native = nativeCliCapabilities({ cli: 'claude', mode: 'accept-edits', mcpServers: ['github', 'my.server'] })
    expect(nativeCoverage('mcp__github__search', native)).toContain('同名 MCP')
    expect(nativeCoverage('mcp__my_server__lookup', native)).toContain('同名 MCP')
    expect(nativeCoverage('mcp__gitlab__search', native)).toBeUndefined()
    // Rollback: an empty table offers every granted tool again.
    expect(nativeCoverage('read', undefined)).toBeUndefined()
    expect(nativeCoverage('read', nativeCliCapabilities({ cli: 'unknown', mode: 'accept-edits' }))).toBeUndefined()
  })
  it('keeps a DSH skill readable when its declared tools are covered natively', async () => {
    const codex = await lease('codex', 'accept-edits', { skills: {
      list: async () => [{ name: 'example', description: '模拟技能' }],
      get: async name => ({ name, description: '模拟技能', content: 'use read and bash', requiredTools: ['read', 'bash'] }),
    } })
    expect((await codex.rpc('tools/call', { name: 'dsh_read_skill', arguments: { name: 'example' } })).result.content[0].text).toContain('use read and bash')
    const missing = await lease('codex', 'accept-edits', { tools: [host('read')], skills: {
      list: async () => [{ name: 'example', description: '模拟技能' }],
      get: async name => ({ name, description: '模拟技能', content: 'x', requiredTools: ['bash'] }),
    } })
    expect((await missing.rpc('tools/call', { name: 'dsh_read_skill', arguments: { name: 'example' } })).error).toContain('所需工具')
  })
  it('lists exactly the offered tools in the native-first note', async () => {
    const codex = await lease('codex', 'accept-edits')
    const note = nativeFirstGuidance(codex.connection.tools)!
    for (const name of codex.connection.tools!) expect(note).toContain(name)
    for (const name of ['read', 'bash', 'grep']) expect(note).not.toMatch(new RegExp(`[：、]${name}[、。]`, 'u'))
    expect(nativeFirstGuidance([])).toBeUndefined()
  })
  it('passes an image result through only for a CLI whose MCP accepts images', async () => {
    const image = { isError: false, content: [{ type: 'text', text: 'shot' }, { type: 'image', attachment: { attachmentId: 'synthetic', mediaType: 'image/png' } }] }
    const resolveImage = vi.fn(async () => ({ data: 'aW1n', mimeType: 'image/png' }))
    const claude = await lease('claude', 'accept-edits', { execute: vi.fn(async () => image), resolveImage })
    expect((await claude.rpc('tools/call', { name: 'mcp__dsh_only__lookup', arguments: {} })).result).toEqual({ isError: false, content: [
      { type: 'text', text: 'shot' }, { type: 'image', data: 'aW1n', mimeType: 'image/png' },
    ] })
    // Codex's MCP image path is unverified: keep the explicit error projection.
    const codex = await lease('codex', 'accept-edits', { execute: vi.fn(async () => image), resolveImage })
    expect((await codex.rpc('tools/call', { name: 'mcp__dsh_only__lookup', arguments: {} })).result).toMatchObject({ isError: true, content: [{ text: 'shot' }, { text: expect.stringContaining('非文本') }] })
    expect(resolveImage).toHaveBeenCalledOnce()
  })
})

describe('native injection details (synthetic)', () => {
  it('does not inject a catalog into ZCode, whose bridge execution is unverified', async () => {
    expect(nativeHarnessToolCapability('zcode', undefined)).toMatchObject({ transport: false, reason: expect.stringContaining('ZCode') })
    const zcode = await lease('zcode', 'accept-edits')
    const result = buildNativeHarnessInjection({ cli: 'zcode', argv: ['zcode'], connection: zcode.connection })
    expect(result.acpMcpServers).toBeUndefined()
    expect(result.env).toEqual({})
  })
  it('appends the native-first note to Claude without touching the task', async () => {
    const claude = await lease('claude', 'accept-edits')
    const argv = buildNativeHarnessInjection({ cli: 'claude', argv: ['claude', '--print', '--model', 'fixture', '任务：\nprompt'], connection: claude.connection, mcpEntryPath: '/synthetic/bridge.mjs' }).argv
    const note = argv[argv.indexOf('--append-system-prompt') + 1]
    expect(note).toBe(nativeFirstGuidance(claude.connection.tools))
    expect(argv.indexOf('--append-system-prompt')).toBeLessThan(argv.indexOf('--print'))
    expect(argv.at(-1)).toBe('任务：\nprompt')
    expect(argv).not.toContain('--system-prompt')
    // Not ready: no note, nothing to prefer.
    expect(nativeHarnessGuidance({ cli: 'claude', harnessTools: { ...claude.connection, executionReady: false } }, {})).toBeUndefined()
    expect(nativeHarnessGuidance({ cli: 'claude', harnessTools: claude.connection }, {})).toBe(note)
  })
  it('leaves a user-configured Codex developer_instructions in charge', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cwn-codex-dev-')); directories.push(home)
    await mkdir(join(home, '.codex'))
    expect(codexDeveloperInstructionsConfigured(home, { HOME: home })).toBe(false)
    await writeFile(join(home, '.codex', 'config.toml'), 'model = "x"\ndeveloper_instructions = "mine"\n')
    expect(codexDeveloperInstructionsConfigured(home, { HOME: home })).toBe(true)
    expect(codexDeveloperInstructionsConfigured(home, { HOME: '/nonexistent', CODEX_HOME: join(home, '.codex') })).toBe(true)
  })
  it('appends Grok rules on a new ACP session only', async () => {
    const grok = await lease('grok', 'accept-edits')
    const requests: Array<{ method: string; params: any }> = []
    const peer = { request: async (method: string, params: any) => {
      requests.push({ method, params })
      if (method === 'initialize') return { protocolVersion: 1, agentCapabilities: { loadSession: true } }
      if (method === 'session/new' || method === 'session/load') return { sessionId: 'session', configOptions: [{ id: 'model', currentValue: 'chosen', options: [{ value: 'chosen' }] }] }
      if (method === 'session/prompt') return { stopReason: 'end_turn' }
      return {}
    }, send: async () => {}, end() {}, close: async () => {} }
    const run = (conversationId?: string) => runNativeGrok({ cli: 'grok', argv: ['mock'], project: '/synthetic', preference: { model: 'chosen', effort: 'default' }, mode: 'accept-edits', prompt: 'mock', harnessTools: grok.connection, ...(conversationId ? { conversationId } : {}) }, {
      signal: new AbortController().signal, native() {}, session() {}, event() {}, result() {}, openStdio: async () => peer,
    })
    await run()
    const created = requests.find(request => request.method === 'session/new')!
    expect(created.params._meta).toEqual({ rules: nativeFirstGuidance(grok.connection.tools) })
    expect(requests.find(request => request.method === 'session/prompt')!.params.prompt).not.toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('CLI Worker 说明') })]))
    requests.length = 0
    await run('session')
    expect(requests.find(request => request.method === 'session/load')!.params._meta).toBeUndefined()
  })
  it('offers Antigravity DSH search and web as fallbacks', () => {
    const agy = nativeCliCapabilities({ cli: 'antigravity', mode: 'accept-edits' })
    for (const name of ['grep', 'glob', 'web_search']) expect(nativeCoverage(name, agy)).toBeUndefined()
    for (const name of ['read', 'write', 'bash']) expect(nativeCoverage(name, agy)).toBeDefined()
  })
  it('bounds Codex MCP calls by the run time limit', async () => {
    const codex = await lease('codex', 'accept-edits')
    const argv = buildNativeHarnessInjection({ cli: 'codex', argv: ['codex'], connection: codex.connection, toolTimeoutMs: 1_800_000, mcpEntryPath: '/synthetic/bridge.mjs' }).argv
    expect(argv[argv.indexOf('mcp_servers.dsh_worker_tools.tool_timeout_sec=1800')]).toBeDefined()
  })
})

describe('native MCP server names (synthetic config)', () => {
  it('reads only server names from Codex and Claude native config', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cwn-native-mcp-')); directories.push(home)
    const project = join(home, 'project'); await mkdir(join(project, '.codex'), { recursive: true }); await mkdir(join(home, '.codex'))
    await writeFile(join(home, '.codex', 'config.toml'), '[mcp_servers.github]\ncommand = "secret-command"\n[mcp_servers."my.server"]\nurl = "x"\n[profiles.x]\n')
    await writeFile(join(project, '.codex', 'config.toml'), '[mcp_servers.local]\ncommand = "x"\n')
    expect(await nativeCliMcpServers('codex', project, { HOME: home })).toEqual(['github', 'my.server', 'local'])
    await writeFile(join(home, '.claude.json'), JSON.stringify({ mcpServers: { user: { command: 'secret' } }, projects: { [project]: { mcpServers: { scoped: {} } } } }))
    await writeFile(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { shared: {} } }))
    expect(await nativeCliMcpServers('claude', project, { HOME: home })).toEqual(['user', 'scoped', 'shared'])
    expect(await nativeCliMcpServers('grok', project, { HOME: home })).toEqual(['user', 'shared'])
    await mkdir(join(home, '.kimi-code')); await mkdir(join(project, '.kimi-code')); await mkdir(join(project, '.git'))
    await writeFile(join(home, '.kimi-code', 'mcp.json'), JSON.stringify({ mcpServers: { kimiuser: {} } }))
    await writeFile(join(project, '.kimi-code', 'mcp.json'), JSON.stringify({ mcpServers: { kimiproject: {} } }))
    expect(await nativeCliMcpServers('kimi', project, { HOME: home })).toEqual(['kimiuser', 'shared', 'kimiproject'])
    await mkdir(join(home, '.gemini', 'config'), { recursive: true })
    await writeFile(join(home, '.gemini', 'config', 'mcp_config.json'), JSON.stringify({ mcpServers: { agyuser: { env: { TOKEN: 'secret' } } } }))
    expect(await nativeCliMcpServers('antigravity', project, { HOME: home })).toEqual(['agyuser'])
    for (const cli of ['opencode', 'mimo', 'pi', 'qoder']) expect(await nativeCliMcpServers(cli, project, { HOME: home })).toEqual([])
  })
})
