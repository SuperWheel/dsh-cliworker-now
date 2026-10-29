import { afterEach, describe, expect, it, vi } from 'vitest'
import { lstat, mkdtemp, mkdir, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeHarnessTools, type NativeHarnessToolsOptions } from '../src/host/native-harness-tools.ts'
import { runNativeGrok } from '../src/host/native-grok.mjs'
import { buildNativeHarnessInjection, nativeHarnessGuidance, nativeHarnessToolCapability } from '../src/host/native-harness-injection.mjs'
import {
  codexDeveloperInstructionsConfigured, HARNESS_FALLBACK_PREFIX, nativeCliCapabilities, nativeCliMcpServers, nativeCoverage, nativeFirstGuidance, nativeSkillPaths, piOmpNativeTools,
  grokNativeMemory, grokTomlMemory, hermesNativeMemory, shareNativeMemory, unshareNativeMemory,
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
  it('gives Pi native bash wherever its tool_call gate can ask, and only under 完全权限 without the gate', async () => {
    for (const access of ['read-only', 'workspace-write', 'danger-full-access'])
      expect(piOmpNativeTools('pi', 'accept-edits', access)).toContain('bash')
    expect(piOmpNativeTools('pi', 'accept-edits', 'danger-full-access', false)).toContain('bash')
    for (const [mode, access, gate] of [
      ['accept-edits', 'workspace-write', false], ['accept-edits', 'read-only', false], ['plan', 'danger-full-access', true], ['accept-edits', undefined, true],
    ] as const)
      expect(piOmpNativeTools('pi', mode, access, gate)).not.toContain('bash')
    // OMP asks before each bash call and relays that question to DSH.
    for (const access of ['read-only', 'workspace-write', 'danger-full-access'])
      expect(piOmpNativeTools('omp', 'accept-edits', access)).toContain('bash')
    for (const [mode, access] of [['plan', 'danger-full-access'], ['accept-edits', undefined]] as const)
      expect(piOmpNativeTools('omp', mode, access)).not.toContain('bash')
    const full = await lease('pi', 'accept-edits', { native: nativeCliCapabilities({ cli: 'pi', mode: 'accept-edits', access: 'danger-full-access' }) })
    const names = await full.names()
    for (const name of ['bash', 'terminal_open', 'job_output']) expect(names).not.toContain(name)
    expect(names).toContain('web_search')
  })
  it('does not offer a DSH write as a plan-mode fallback', async () => {
    const plan = await lease('pi', 'plan')
    for (const name of ['write', 'edit']) expect(await plan.names()).not.toContain(name)
    expect(piOmpNativeTools('pi', 'plan')).toEqual(['read', 'grep', 'find', 'ls'])
  })
  it('gives Pi 询问 native writes and bash behind its gate, and reads only for an install without it', async () => {
    const native = nativeCliCapabilities({ cli: 'pi', mode: 'accept-edits', access: 'read-only' })
    const pi = await lease('pi', 'accept-edits', { native })
    expect(piOmpNativeTools('pi', 'accept-edits', 'read-only')).toEqual(['read', 'grep', 'find', 'ls', 'write', 'edit', 'bash'])
    expect(piOmpNativeTools('pi', 'accept-edits', 'read-only', false)).toEqual(['read', 'grep', 'find', 'ls'])
    expect(native.classes).toEqual(expect.arrayContaining(['file-write', 'shell']))
    // The native tools are covered, so no DSH duplicate is offered.
    for (const name of ['write', 'edit', 'bash']) expect(await pi.names()).not.toContain(name)
    expect(pi.execute).not.toHaveBeenCalled()
  })
  it.each([
    ['plan', 'danger-full-access', false],
    ['accept-edits', 'read-only', true],
    ['accept-edits', 'workspace-write', true],
    ['accept-edits', 'danger-full-access', true],
  ] as const)('OMP %s/%s keeps capability coverage aligned with native tools', async (mode, access, writable) => {
    const native = nativeCliCapabilities({ cli: 'omp', mode, access })
    expect(native.classes.includes('file-write')).toBe(writable)
    expect(native.classes.includes('shell')).toBe(writable)
    const omp = await lease('omp', mode, { native })
    for (const name of ['read', 'grep', 'write', 'edit']) expect(await omp.names()).not.toContain(name)
    expect((await omp.names()).includes('bash')).toBe(!writable)
  })
  it('drops a DSH MCP server only when the CLI loads the same server natively', () => {
    const native = nativeCliCapabilities({ cli: 'claude', mode: 'accept-edits', mcpServers: ['github', 'my.server'] })
    expect(nativeCoverage('mcp__github__search', native)).toContain('同名 MCP')
    expect(nativeCoverage('mcp__gitlab__search', native)).toBeUndefined()
    // Uncertain identities stay offered: a normalized native name may be a distinct
    // DSH server, and `github__enterprise` is not `github`.
    expect(nativeCoverage('mcp__my_server__lookup', native)).toBeUndefined()
    expect(nativeCoverage('mcp__github__enterprise__search', native)).toBeUndefined()
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
    const root = await mkdtemp(join(tmpdir(), 'cwn-codex-dev-')); directories.push(root)
    const home = join(root, 'home'), repo = join(root, 'repo'), nested = join(repo, 'packages', 'app')
    await mkdir(join(home, '.codex'), { recursive: true }); await mkdir(join(repo, '.codex'), { recursive: true }); await mkdir(nested, { recursive: true })
    // Example text inside a multi-line value is not a setting.
    await writeFile(join(home, '.codex', 'config.toml'), 'model = "x"\nnote = """\ndeveloper_instructions = "example"\n"""\n')
    expect(codexDeveloperInstructionsConfigured(nested, { HOME: home })).toBe(false)
    await writeFile(join(home, '.codex', 'config.toml'), 'model = "x"\ndeveloper_instructions = "mine"\n')
    expect(codexDeveloperInstructionsConfigured(nested, { HOME: home })).toBe(true)
    expect(codexDeveloperInstructionsConfigured(nested, { HOME: '/nonexistent', CODEX_HOME: join(home, '.codex') })).toBe(true)
    // An ancestor project layer applies to a nested working directory.
    await writeFile(join(home, '.codex', 'config.toml'), 'model = "x"\n')
    await writeFile(join(repo, '.codex', 'config.toml'), '[profiles.team]\ndeveloper_instructions = "team"\n')
    expect(codexDeveloperInstructionsConfigured(nested, { HOME: home })).toBe(true)
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

describe('OpenCode/MiMo user skill roots (synthetic directories)', () => {
  it('lists only existing user and project skill directories of the same CLI', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cwn-skills-'))
    directories.push(root)
    const home = join(root, 'home'), project = join(root, 'project'), xdg = join(root, 'xdg')
    for (const path of [join(xdg, 'opencode/skills'), join(home, '.opencode/skill'), join(project, '.opencode/skills'),
      join(project, '.claude/skills'), join(project, '.agents/skills'), join(home, '.mimocode/skills'), join(root, 'mimo-home/config/skill')])
      await mkdir(path, { recursive: true })
    await writeFile(join(project, '.opencode/skill'), 'not a directory')
    expect(nativeSkillPaths('opencode', { env: { XDG_CONFIG_HOME: xdg }, project, home }))
      .toEqual([join(xdg, 'opencode/skills'), join(home, '.opencode/skill'), join(project, '.opencode/skills')])
    expect(nativeSkillPaths('mimo', { env: { MIMOCODE_HOME: join(root, 'mimo-home') }, home }))
      .toEqual([join(root, 'mimo-home/config/skill'), join(home, '.mimocode/skills')])
    expect(nativeCliCapabilities({ cli: 'opencode', mode: 'plan' }).classes).toContain('skills')
  })
})

describe('native MCP server names (synthetic config)', () => {
  it('reads only server names from Codex and Claude native config', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cwn-native-mcp-')); directories.push(home)
    const project = join(home, 'project'); await mkdir(join(project, '.codex'), { recursive: true }); await mkdir(join(home, '.codex'))
    await writeFile(join(home, '.codex', 'config.toml'), [
      '[mcp_servers.github]', 'command = "secret-command" # [mcp_servers.comment]', '[mcp_servers."my.server"]', 'url = "x"',
      '[mcp_servers.off]', 'command = "x"', 'enabled = false', '[mcp_servers]', 'inline = { command = "x", enabled = false }',
      'developer_note = """', '[mcp_servers.docs]', 'example only', '"""', '[mcp_servers.later]', 'command = "x"', '[profiles.x]', '',
    ].join('\n'))
    // A nested project inherits the ancestor layer, which can disable a server.
    const nested = join(project, 'packages', 'app'); await mkdir(nested, { recursive: true })
    await writeFile(join(project, '.codex', 'config.toml'), '[mcp_servers.local]\ncommand = "x"\n[mcp_servers.later]\nenabled = false\n')
    expect(await nativeCliMcpServers('codex', nested, { HOME: home })).toEqual(['github', 'my.server', 'local'])
    await writeFile(join(home, '.claude.json'), JSON.stringify({ mcpServers: { user: { command: 'secret' }, paused: { disabled: true } },
      projects: { [project]: { mcpServers: { scoped: {} }, enabledMcpjsonServers: ['shared'], disabledMcpServers: ['scoped'] } } }))
    await writeFile(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { shared: {}, unapproved: {} } }))
    expect(await nativeCliMcpServers('claude', project, { HOME: home })).toEqual(['user', 'shared'])
    expect(await nativeCliMcpServers('grok', project, { HOME: home })).toEqual(['user', 'shared', 'unapproved'])
    await mkdir(join(home, '.kimi-code')); await mkdir(join(project, '.kimi-code')); await mkdir(join(project, '.git'))
    await writeFile(join(home, '.kimi-code', 'mcp.json'), JSON.stringify({ mcpServers: { kimiuser: {} } }))
    await writeFile(join(project, '.kimi-code', 'mcp.json'), JSON.stringify({ mcpServers: { kimiproject: {} } }))
    expect(await nativeCliMcpServers('kimi', project, { HOME: home })).toEqual(['kimiuser', 'shared', 'unapproved', 'kimiproject'])
    await mkdir(join(home, '.gemini', 'config'), { recursive: true })
    await writeFile(join(home, '.gemini', 'config', 'mcp_config.json'), JSON.stringify({ mcpServers: { agyuser: { env: { TOKEN: 'secret' } } } }))
    expect(await nativeCliMcpServers('antigravity', project, { HOME: home })).toEqual(['agyuser'])
    for (const cli of ['opencode', 'mimo', 'pi', 'qoder']) expect(await nativeCliMcpServers(cli, project, { HOME: home })).toEqual([])
  })
})

describe('native memory settings and shared directories (synthetic fixtures)', () => {
  async function memoryRoot() {
    const root = await mkdtemp(join(tmpdir(), 'cwn-native-memory-SYNTHETIC-'))
    directories.push(root)
    return root
  }

  it.each([
    ['memory section', '[memory]\nenabled = true\n', true],
    ['memory_v2 section', '[memory_v2]\nenabled = false\n', false],
    ['memory_v2 false takes precedence', '[memory_v2]\nenabled = false\n[memory]\nenabled = true\n', false],
    ['memory_v2 true takes precedence', '[memory]\nenabled = false\n[memory_v2]\nenabled = true\n', true],
    ['top-level dotted memory key', 'memory.enabled = true\n', true],
    ['top-level dotted memory_v2 precedence', 'memory_v2.enabled = false\nmemory.enabled = true\n', false],
    ['comments and whitespace', '# synthetic config\r\n[ memory ] # synthetic table\r\n  enabled = true # synthetic setting\r\n', true],
    ['unrelated table', '[other]\nenabled = true\n', undefined],
    ['nested memory index table', '[memory.index]\nenabled = true\n', undefined],
    ['nested memory_v2 index table', '[memory_v2.index]\nenabled = true\n', undefined],
    ['array memory table', '[[memory]]\nenabled = true\n', undefined],
    ['array memory_v2 table', '[[memory_v2]]\nenabled = true\n', undefined],
    ['array and unrelated tables keep earlier setting', '[memory]\nenabled = false\n[[other]]\nenabled = true\n[other]\nenabled = true\n', false],
    ['quoted boolean', '[memory]\nenabled = "true"\n', undefined],
    ['single-quoted boolean', "memory_v2.enabled = 'false'\n", undefined],
    ['inline table', 'memory = { enabled = true }\n', undefined],
    ['inline enabled value', '[memory]\nenabled = { value = true }\n', undefined],
    ['unreadable memory_v2 falls back', '[memory]\nenabled = true\n[memory_v2]\nenabled = "false"\n', true],
    ['unset', '', undefined],
  ] as const)('reads synthetic Grok TOML: %s', (_name, text, expected) => {
    expect(grokTomlMemory(text)).toBe(expected)
  })

  it.each([
    ['default off', undefined, undefined, undefined, false],
    ['config enables memory', '[memory]\nenabled = true\n', undefined, undefined, true],
    ['environment disables config', '[memory]\nenabled = true\n', '0', undefined, false],
    ['requirements override environment', '[memory]\nenabled = true\n', '1', '[memory]\nenabled = false\n', false],
    ['garbage environment falls through', '[memory]\nenabled = true\n', 'synthetic-garbage', undefined, true],
  ] as const)('resolves synthetic Grok native memory: %s', async (_name, config, switchValue, requirements, expected) => {
    const home = await memoryRoot()
    await mkdir(join(home, '.grok'))
    if (config !== undefined) await writeFile(join(home, '.grok', 'config.toml'), config)
    if (requirements !== undefined) await writeFile(join(home, '.grok', 'requirements.toml'), requirements)
    expect(await grokNativeMemory({ home, env: { GROK_MEMORY: switchValue } })).toBe(expected)
  })

  it.each([
    ['1', true], ['TRUE', true], [' yes ', true], ['on', true],
    ['0', false], ['FALSE', false], [' no ', false], ['off', false],
  ] as const)('reads synthetic GROK_MEMORY switch %s', async (value, expected) => {
    const home = await memoryRoot()
    expect(await grokNativeMemory({ home, env: { GROK_MEMORY: value } })).toBe(expected)
  })

  it('treats a synthetic requirements read error as off instead of falling through', async () => {
    const home = await memoryRoot()
    await mkdir(join(home, '.grok', 'requirements.toml'), { recursive: true })
    await writeFile(join(home, '.grok', 'config.toml'), '[memory]\nenabled = true\n')
    expect(await grokNativeMemory({ home, env: { GROK_MEMORY: '1' } })).toBe(false)
  })

  it.each([undefined, null, {}, { memory: null }, { memory: [] }, { memory: { memory_enabled: null, user_profile_enabled: null } }])(
    'defaults both synthetic Hermes memory flags on for %j', config => {
      expect(hermesNativeMemory(config)).toEqual({ memory_enabled: true, user_profile_enabled: true })
    },
  )

  it('disables synthetic Hermes memory for off/no strings and drops an external provider', () => {
    expect(hermesNativeMemory({ memory: { memory_enabled: ' off ', user_profile_enabled: 'NO', provider: 'honcho' } }))
      .toEqual({ memory_enabled: false, user_profile_enabled: false })
  })

  it.each(['1', 'true', 'YES', ' on '])('enables synthetic Hermes memory for truthy string %s', value => {
    expect(hermesNativeMemory({ memory: { memory_enabled: value, user_profile_enabled: value } }))
      .toEqual({ memory_enabled: true, user_profile_enabled: true })
  })

  it('uses Boolean coercion for synthetic Hermes non-string flags', () => {
    expect(hermesNativeMemory({ memory: { memory_enabled: 0, user_profile_enabled: 1 } }))
      .toEqual({ memory_enabled: false, user_profile_enabled: true })
  })

  it('copies only finite numeric synthetic Hermes memory limits', () => {
    expect(hermesNativeMemory({ memory: { memory_char_limit: 1200, user_char_limit: 600, nudge_interval: 0,
      provider: 'honcho', synthetic_extra: true } }))
      .toEqual({ memory_enabled: true, user_profile_enabled: true, memory_char_limit: 1200, user_char_limit: 600, nudge_interval: 0 })
    expect(hermesNativeMemory({ memory: { memory_char_limit: '1200', user_char_limit: Infinity, nudge_interval: NaN } }))
      .toEqual({ memory_enabled: true, user_profile_enabled: true })
  })

  it('creates a fresh synthetic native memory link and is idempotent', async () => {
    const root = await memoryRoot(), privatePath = join(root, 'worker', 'memories'), nativePath = join(root, 'native')
    await shareNativeMemory(privatePath, nativePath)
    const first = await lstat(privatePath)
    if (process.platform !== 'win32') {
      expect(first.isSymbolicLink()).toBe(true)
      expect((await lstat(nativePath)).mode & 0o777).toBe(0o700)
    }
    expect(await realpath(privatePath)).toBe(await realpath(nativePath))
    await writeFile(join(nativePath, 'synthetic-memory.txt'), 'synthetic shared memory')
    await shareNativeMemory(privatePath, nativePath)
    if (process.platform !== 'win32') expect((await lstat(privatePath)).ino).toBe(first.ino)
    expect(await realpath(privatePath)).toBe(await realpath(nativePath))
    expect(await readFile(join(privatePath, 'synthetic-memory.txt'), 'utf8')).toBe('synthetic shared memory')
    expect(await readdir(join(root, 'worker'))).toEqual(['memories'])
  })

  it('replaces an empty synthetic directory tree with a native memory link', async () => {
    const root = await memoryRoot(), privatePath = join(root, 'memories'), nativePath = join(root, 'native')
    await mkdir(join(privatePath, 'empty', 'nested'), { recursive: true })
    await shareNativeMemory(privatePath, nativePath)
    if (process.platform !== 'win32') expect((await lstat(privatePath)).isSymbolicLink()).toBe(true)
    expect(await realpath(privatePath)).toBe(await realpath(nativePath))
    expect(await readdir(nativePath)).toEqual([])
    expect((await readdir(root)).filter(name => name.startsWith('memories.private-'))).toEqual([])
  })

  it('keeps a non-empty synthetic private directory aside with its nested file intact', async () => {
    const root = await memoryRoot(), privatePath = join(root, 'memories'), nativePath = join(root, 'native')
    await mkdir(join(privatePath, 'nested'), { recursive: true })
    await writeFile(join(privatePath, 'nested', 'synthetic-memory.txt'), 'synthetic private memory')
    await shareNativeMemory(privatePath, nativePath)
    const backups = (await readdir(root)).filter(name => /^memories\.private-\d+$/.test(name))
    expect(backups).toHaveLength(1)
    expect(await readFile(join(root, backups[0]!, 'nested', 'synthetic-memory.txt'), 'utf8')).toBe('synthetic private memory')
    expect(await realpath(privatePath)).toBe(await realpath(nativePath))
    expect(await readdir(nativePath)).toEqual([])
  })

  it('repoints a stale synthetic memory link without changing its previous target', async () => {
    const root = await memoryRoot(), privatePath = join(root, 'memories'), nativePath = join(root, 'native'), oldPath = join(root, 'old')
    await mkdir(oldPath)
    await writeFile(join(oldPath, 'synthetic-memory.txt'), 'synthetic old memory')
    await symlink(oldPath, privatePath, process.platform === 'win32' ? 'junction' : 'dir')
    await shareNativeMemory(privatePath, nativePath)
    expect(await realpath(privatePath)).toBe(await realpath(nativePath))
    expect(await readFile(join(oldPath, 'synthetic-memory.txt'), 'utf8')).toBe('synthetic old memory')
  })

  it('rejects a synthetic regular file at the private memory path without changing it', async () => {
    const root = await memoryRoot(), privatePath = join(root, 'memories')
    await writeFile(privatePath, 'synthetic file')
    await expect(shareNativeMemory(privatePath, join(root, 'native'))).rejects.toThrow('Worker 私有记忆路径不是目录')
    expect(await readFile(privatePath, 'utf8')).toBe('synthetic file')
  })

  it('unshares only the synthetic link and preserves native memory files', async () => {
    const root = await memoryRoot(), privatePath = join(root, 'memories'), nativePath = join(root, 'native')
    await shareNativeMemory(privatePath, nativePath)
    await writeFile(join(nativePath, 'synthetic-memory.txt'), 'synthetic shared memory')
    await unshareNativeMemory(privatePath)
    await expect(lstat(privatePath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await lstat(nativePath)).isDirectory()).toBe(true)
    expect(await readFile(join(nativePath, 'synthetic-memory.txt'), 'utf8')).toBe('synthetic shared memory')
    await expect(unshareNativeMemory(privatePath)).resolves.toBeUndefined()
  })

  it('leaves a real synthetic private memory directory and its files when unsharing', async () => {
    const root = await memoryRoot(), privatePath = join(root, 'memories')
    await mkdir(privatePath)
    await writeFile(join(privatePath, 'synthetic-memory.txt'), 'synthetic private memory')
    await unshareNativeMemory(privatePath)
    expect((await lstat(privatePath)).isDirectory()).toBe(true)
    expect(await readFile(join(privatePath, 'synthetic-memory.txt'), 'utf8')).toBe('synthetic private memory')
  })
})
