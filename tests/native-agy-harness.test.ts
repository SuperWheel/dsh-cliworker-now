import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { createNativeHarnessTools } from '../src/host/native-harness-tools.ts'
import { prepareNativeWorker } from '../src/host/native-worker.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
import { HARNESS_CONNECTION_ENV } from '../src/host/native-harness-mcp.mjs'
import { nativeAgyArgv } from '../src/host/native-agy.mjs'
import { AGY_HARNESS_SESSION_FILE, prepareAgyHarnessWorkspace, recordAgyHarnessSession, agyHarnessHookDecision, agyHarnessServerName } from '../src/host/native-agy-harness.mjs'

// Synthetic tools and CLI identities; no account, external MCP or model is used.
const cleanup: Array<() => Promise<unknown> | unknown> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.unstubAllEnvs() })
async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-agy-harness-')))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  let visible = true
  const execute = vi.fn(async () => ({ content: [{ type: 'text', text: 'synthetic tool receipt' }] }))
  const lease = await createNativeHarnessTools({ binding: { parentSessionId: 'synthetic-parent', harnessSessionId: 'synthetic-child', workerId: 'synthetic-worker', runId: 'synthetic-run', cli: 'antigravity' },
    executionReady: true, authorize: () => {}, execute,
    tools: () => visible ? [{ name: 'read', description: 'synthetic read', inputSchema: { type: 'object' }, execution: 'host' as const }] : [],
  })
  cleanup.push(() => lease.close())
  const argv = ['agy', '--output-format', 'stream-json', '--model', 'synthetic-model', '--effort', 'low', '--mode', 'accept-edits', '--print', '任务：\nsynthetic']
  const prepared = prepareAgyHarnessWorkspace({ directory: root, argv, connection: lease.connection })
  const env = { ...prepared.env, [HARNESS_CONNECTION_ENV]: JSON.stringify(lease.connection) }
  const config = { stopDirectory: join(root, 'stop') }
  recordAgyHarnessSession(config, 'synthetic-native-session', env)
  const payload = { conversationId: 'synthetic-native-session', stepIdx: 3, toolCall: { name: `mcp_${agyHarnessServerName(lease.connection)}_read`, args: { path: 'synthetic' } } }
  return { root, lease, argv, prepared, env, config, payload, execute, revoke: () => { visible = false } }
}
it('loads sparse per-run configuration without credentials or permissions in the workspace (synthetic)', async () => {
  const f = await fixture(), path = join(f.root, 'agy-tools/.agents/mcp_config.json')
  const mcp = JSON.parse(readFileSync(path, 'utf8'))
  expect(Object.keys(mcp.mcpServers)).toEqual([agyHarnessServerName(f.lease.connection)])
  const server = Object.values(mcp.mcpServers)[0] as any
  expect(server.command).toBe(process.execPath)
  expect(server.args[0]).toMatch(/native-harness-mcp\.mjs$/)
  const hooks = readFileSync(join(f.root, 'agy-tools/.agents/hooks.json'), 'utf8')
  expect(hooks).toContain('PreToolUse')
  for (const value of [JSON.stringify(mcp), hooks, f.prepared.argv.join(' ')]) {
    expect(value).not.toContain(f.lease.connection.token)
    expect(value).not.toContain('dangerously-skip-permissions')
    expect(value).not.toContain('permissionOverrides')
  }
  expect(f.prepared.argv.slice(-2)).toEqual(f.argv.slice(-2))
  expect(f.prepared.argv[f.prepared.argv.indexOf('--add-dir') + 1]).toBe(join(f.root, 'agy-tools'))
  if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
  expect(nativeAgyArgv({ argv: f.prepared.argv, prompt: 'synthetic', preference: { model: 'synthetic-model', effort: 'low' }, mode: 'accept-edits' })).toContain(join(f.root, 'agy-tools'))
})
it('only admits a fully named live bridge tool and leaves unrelated native tools to native policy (synthetic)', async () => {
  const f = await fixture()
  expect(await agyHarnessHookDecision(f.payload, { env: f.env })).toMatchObject({ decision: 'auto_approve' })
  expect(await agyHarnessHookDecision({ ...f.payload, toolCall: { name: 'run_command', args: { CommandLine: f.payload.toolCall.name } } }, { env: f.env })).toEqual({ decision: 'allow' })
  expect(await agyHarnessHookDecision({ ...f.payload, toolCall: { name: f.payload.toolCall.name + '_unlisted' } }, { env: f.env })).toMatchObject({ decision: 'deny' })
  f.revoke()
  expect(await agyHarnessHookDecision(f.payload, { env: f.env })).toMatchObject({ decision: 'deny' })
  expect(f.execute).not.toHaveBeenCalled()
})
it('refuses native tool calls that name the private tools workspace and points to the project (synthetic)', async () => {
  const f = await fixture(), directory = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-agy-project-')))
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  // Prepared like a real run: the project is the first --add-dir workspace.
  const prepared = prepareAgyHarnessWorkspace({ directory, argv: ['agy', '--add-dir', f.root, ...f.argv.slice(1)], connection: f.lease.connection })
  const env = { ...prepared.env, [HARNESS_CONNECTION_ENV]: JSON.stringify(f.lease.connection) }
  const tools = join(directory, 'agy-tools')
  const decide = (toolCall: any, values = env) => agyHarnessHookDecision({ ...f.payload, toolCall }, { env: values })
  for (const toolCall of [
    { name: 'write_file', args: { Path: join(tools, 'cwn-task.txt') } },
    { name: 'write_to_file', input: { TargetFile: `file://${tools}/cwn-task.txt` } },
    { name: 'run_command', args: { CommandLine: `cat "${tools}/cwn-task.txt"` } },
    { name: 'write_file', args: JSON.stringify({ Path: join(tools, 'cwn-task.txt') }) },
    { name: 'list_dir', args: { DirectoryPath: tools } },
  ]) expect(await decide(toolCall)).toEqual({ decision: 'deny', reason: `这是本轮 Harness 工具桥的私有目录，不属于项目；请改在项目目录 ${f.root} 中操作` })
  for (const toolCall of [
    { name: 'write_file', args: { Path: join(f.root, 'cwn-task.txt') } },
    { name: 'write_file', args: { Path: `${tools}-other/cwn-task.txt` } },
    { name: 'list_dir', args: { DirectoryPath: directory } },
  ]) expect(await decide(toolCall)).toEqual({ decision: 'allow' })
  // A Windows host: case-insensitive, either separator, JSON-escaped backslashes.
  const windows = { ...env, CLIWORKER_AGY_TOOLS_DIR: 'C:\\Users\\SIMULATED\\.dsh\\native\\r\\agy-tools', CLIWORKER_AGY_PROJECT: 'C:\\Users\\SIMULATED\\live' }
  for (const Path of ['c:/users/simulated/.dsh/native/r/agy-tools/x.txt', JSON.stringify('C:\\Users\\SIMULATED\\.dsh\\native\\r\\agy-tools\\x.txt')])
    expect(await decide({ name: 'write_file', args: { Path } }, windows)).toMatchObject({ decision: 'deny', reason: expect.stringContaining('C:\\Users\\SIMULATED\\live') })
  expect(await decide({ name: 'write_file', args: { Path: 'C:\\Users\\SIMULATED\\live\\x.txt' } }, windows)).toEqual({ decision: 'allow' })
})
it('refuses changed native identities, missing steps, stale leases and missing private state (synthetic)', async () => {
  const f = await fixture()
  for (const payload of [{ ...f.payload, conversationId: 'other' }, { ...f.payload, stepIdx: -1 }, { ...f.payload, stepIdx: undefined }])
    expect(await agyHarnessHookDecision(payload, { env: f.env })).toMatchObject({ decision: 'deny' })
  expect(() => recordAgyHarnessSession(f.config, 'other', f.env)).toThrow('已变化')
  expect(await agyHarnessHookDecision(f.payload, { env: { ...f.env, [AGY_HARNESS_SESSION_FILE]: join(f.root, 'missing') } })).toMatchObject({ decision: 'deny' })
  await f.lease.close()
  expect(await agyHarnessHookDecision(f.payload, { env: f.env, signal: AbortSignal.timeout(1000) })).toMatchObject({ decision: 'deny' })
})
it.each(['darwin', 'win32'])('quotes the native Hook launcher and keeps paths separate on %s (synthetic)', async platform => {
  const f = await fixture(), dir = join(f.root, "space ' 中文")
  const { mkdirSync } = await import('node:fs'); mkdirSync(dir)
  const prepared = prepareAgyHarnessWorkspace({ directory: dir, argv: f.argv, connection: f.lease.connection, platform,
    nodeExecutable: platform === 'win32' ? 'C:\\Program Files\\nodejs\\node.exe' : "/synthetic/a b'c/node" })
  const hooks = JSON.parse(readFileSync(join(dir, 'agy-tools/.agents/hooks.json'), 'utf8'))
  const command = hooks['dsh-worker-tools'].PreToolUse[0].hooks[0].command
  expect(command).toEqual(platform === 'win32' ? '%CLIWORKER_AGY_HOOK_NODE% %CLIWORKER_AGY_HOOK_ENTRY%' : expect.stringContaining("'\\''"))
  expect(prepared.argv).toContain(join(dir, 'agy-tools'))
})
it('runs the real Hook entry through its private environment without executing a tool (synthetic)', async () => {
  const f = await fixture()
  const child = spawn(process.execPath, ['src/host/native-agy-harness.mjs'], { env: { ...process.env, ...f.env }, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', bytes => { stdout += String(bytes) }); child.stderr.on('data', bytes => { stderr += String(bytes) })
  const done = new Promise(resolve => child.once('close', resolve))
  child.stdin.end(JSON.stringify(f.payload))
  expect(await done).toBe(0)
  expect(JSON.parse(stdout)).toMatchObject({ decision: 'auto_approve' })
  expect(stdout + stderr).not.toContain(f.lease.connection.token)
  expect(f.execute).not.toHaveBeenCalled()
})
it('owns configuration and private identity through NativeWorker cleanup without persisting its connection (synthetic)', async () => {
  const f = await fixture()
  const launch = await prepareNativeWorker({ argv: f.argv }, { cli: 'antigravity', project: f.root, stateDirectory: f.root,
    preference: { cli: 'antigravity', model: 'synthetic-model', effort: 'low' }, mode: 'accept-edits', prompt: 'synthetic', harnessTools: f.lease.connection }, DEFAULT_CONFIG)
  const request = launch.argv.at(-1)!, body = readFileSync(request, 'utf8'), config = JSON.parse(body)
  expect(body).not.toContain(f.lease.connection.token)
  expect(config.argv).toContain('--add-dir')
  expect(launch.env[HARNESS_CONNECTION_ENV]).toContain(f.lease.connection.token)
  expect(existsSync(launch.env[AGY_HARNESS_SESSION_FILE])).toBe(false)
  await launch.cleanup()
  expect(existsSync(request)).toBe(false)
  expect(existsSync(config.argv[config.argv.indexOf('--add-dir') + 1])).toBe(false)
})
