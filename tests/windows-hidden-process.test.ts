import { afterEach, describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { ProcessBackend } from '../src/host/process.ts'
import { cleanupManagedAgent } from '../src/host/managed-agent.ts'
import { nativeProcessBackend } from '../src/host/native-process.ts'
import { needsWindowsHiddenLaunch, spawnWindowsHidden } from '../src/host/windows-hidden-process.ts'

const roots: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }))
})
const spec: SubprocessSpawnSpec = {
  argv: ['synthetic-cli.exe', '--literal', '空格 & "参数"'],
  cwd: process.cwd(),
  stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 1000 } },
  graceMs: 500,
}
function fixture(control = true) {
  let finish!: (value: SubprocessOutcome) => void, reject!: (error: Error) => void
  const inner = {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: undefined,
    control: control ? new PassThrough() : undefined,
    collected: { stderr: { readFrom: vi.fn() } },
    done: new Promise<SubprocessOutcome>((yes, no) => { finish = yes; reject = no }),
    terminate: vi.fn(), waitForExit: vi.fn(async () => true),
  }
  const backend = { resolveExecutable: vi.fn(async value => value), spawn: vi.fn(() => inner) } as unknown as ProcessBackend
  return { inner, backend, finish, reject }
}

describe('Windows GUI bootstrap (synthetic SDK receipts; no account access)', () => {
  it('模拟 hidden native exit precedes Job runner exit without triggering terminate IPC EPIPE', async () => {
    const f = fixture()
    let poisoned = false
    f.inner.terminate.mockImplementation(() => { poisoned = true })
    let rangeExit!: () => void
    const range = new Promise<void>(resolve => { rangeExit = resolve })
    f.inner.waitForExit.mockImplementation(async () => {
      await range
      if (poisoned) throw new Error('write EPIPE')
      return true
    })
    const handle = spawnWindowsHidden(f.backend, spec)
    f.inner.control!.end(JSON.stringify({ kind: 'exit', exitCode: 0, signal: null }))
    expect((await handle.done).exitCode).toBe(0)
    let settled = false
    const cleanup = cleanupManagedAgent(handle, true, new AbortController().signal).then(value => { settled = true; return value })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(settled).toBe(false)
    expect(f.inner.terminate).not.toHaveBeenCalled()
    f.finish({ exitCode: 0, signal: null })
    rangeExit()
    expect(await cleanup).toBe(true)
    expect(f.inner.terminate).not.toHaveBeenCalled()
  })

  it('wraps only Windows Electron native targets, keeping existing GUI helpers and other platforms direct', () => {
    expect(needsWindowsHiddenLaunch(['synthetic.exe'], 'win32', true)).toBe(true)
    expect(needsWindowsHiddenLaunch([process.execPath.toUpperCase().replaceAll('/', '\\')], 'win32', true)).toBe(false)
    expect(needsWindowsHiddenLaunch(['synthetic.exe'], 'win32', false)).toBe(false)
    expect(needsWindowsHiddenLaunch(['synthetic.exe'], 'darwin', true)).toBe(false)
  })
  it('keeps a case-insensitive Windows GUI runtime direct while retaining its Node mode', () => {
    const f = fixture()
    const previous = Object.getOwnPropertyDescriptor(process, 'execPath')!
    Object.defineProperty(process, 'execPath', { ...previous, value: 'C:\\Synthetic\\Harness.exe' })
    try {
      const backend = nativeProcessBackend(f.backend, 'win32', { electron: true })
      const argv = ['c:/SYNTHETIC/HARNESS.EXE', 'synthetic-script.mjs']
      expect(backend.spawn({ ...spec, argv })).toBe(f.inner)
      const requested = vi.mocked(f.backend.spawn).mock.calls[0]![0]
      expect(requested.argv).toEqual(argv)
      expect(requested.env?.ELECTRON_RUN_AS_NODE).toBe('1')
      expect(requested.stdio.control).toBeUndefined()
    } finally { Object.defineProperty(process, 'execPath', previous) }
  })
  it('preserves stream and collection objects, literal argv, environment deletion and exact native exit facts', async () => {
    const f = fixture()
    vi.stubEnv('ELECTRON_RUN_AS_NODE', 'ambient')
    const handle = spawnWindowsHidden(f.backend, { ...spec, env: { SYNTHETIC: 'value', electron_run_as_node: undefined } })
    const requested = vi.mocked(f.backend.spawn).mock.calls[0]![0]
    expect(requested.argv[0]).toBe(process.execPath)
    expect(requested.argv[1]).toMatch(/windows-hidden-launch\.mjs$/)
    expect(JSON.parse(requested.argv[2]!)).toEqual({ nodeEnv: null })
    expect(requested.argv.slice(3)).toEqual(spec.argv)
    expect(requested.env?.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(requested.env?.SYNTHETIC).toBe('value')
    expect(requested.stdio).toEqual({ ...spec.stdio, control: 'pipe' })
    expect(handle.stdin).toBe(f.inner.stdin)
    expect(handle.stdout).toBe(f.inner.stdout)
    expect(handle.collected).toBe(f.inner.collected)
    expect(handle.control).toBeUndefined()
    // Preserve a Windows crash DWORD rather than truncating through Node exitCode.
    f.inner.control!.end(JSON.stringify({ kind: 'exit', exitCode: 3221225477, signal: null }) + '\n')
    f.finish({ exitCode: 0, signal: null })
    await expect(handle.done).resolves.toEqual({ exitCode: 3221225477, signal: null })
    const signal = new AbortController().signal
    await expect(handle.waitForExit(signal)).resolves.toBe(true)
    expect(f.inner.waitForExit).toHaveBeenCalledWith(signal)
  })
  it.each(['terminate', 'abort'] as const)('retains the SDK outcome and ownership on %s without requiring an exit receipt', async method => {
    const f = fixture(), controller = new AbortController()
    const handle = spawnWindowsHidden(f.backend, { ...spec, signal: controller.signal })
    if (method === 'terminate') handle.terminate()
    else { controller.abort(); f.inner.control!.destroy() }
    f.finish({ exitCode: 1, signal: null })
    await expect(handle.done).resolves.toEqual({ exitCode: 1, signal: null })
    await handle.waitForExit()
    expect(f.inner.waitForExit).toHaveBeenCalledOnce()
    if (method === 'terminate') expect(f.inner.terminate).toHaveBeenCalledOnce()
  })
  it('reports the native parent exit before a relay or descendants holding output pipes finish', async () => {
    const f = fixture(), handle = spawnWindowsHidden(f.backend, spec)
    f.inner.control!.end(JSON.stringify({ kind: 'exit', exitCode: 7, signal: null }))
    await expect(handle.done).resolves.toEqual({ exitCode: 7, signal: null })
    expect(f.inner.terminate).not.toHaveBeenCalled()
    f.inner.waitForExit.mockResolvedValueOnce(false)
    await expect(handle.waitForExit()).resolves.toBe(false)
    handle.terminate()
    f.finish({ exitCode: 1, signal: null })
    await expect(handle.waitForExit()).resolves.toBe(true)
  })
  it.each(['', 'not-json', '{"kind":"exit","exitCode":null,"signal":null}', 'x'.repeat(1025)])(
    'rejects missing, malformed or oversized receipts and starts SDK cleanup', async raw => {
      const f = fixture(), handle = spawnWindowsHidden(f.backend, spec)
      f.inner.control!.end(raw)
      f.finish({ exitCode: 0, signal: null })
      await expect(handle.done).rejects.toThrow('回执异常')
      expect(f.inner.terminate).toHaveBeenCalled()
    },
  )
  it('keeps native spawn failure distinct from a successful wrapper exit, without relaying raw diagnostics', async () => {
    const f = fixture(), handle = spawnWindowsHidden(f.backend, spec)
    f.inner.control!.end(JSON.stringify({ kind: 'spawn-error', code: 'ENOENT' }))
    f.finish({ exitCode: 0, signal: null })
    await expect(handle.done).rejects.toMatchObject({ message: 'Windows 后台 CLI 无法启动', code: 'ENOENT' })
  })
  it('starts SDK cleanup immediately when the receipt pipe fails while the native process is still running', async () => {
    const f = fixture(), handle = spawnWindowsHidden(f.backend, spec)
    f.inner.control!.emit('error', new Error('synthetic pipe failure'))
    // Cleanup cannot depend on a long-running native target first exiting.
    expect(f.inner.terminate).toHaveBeenCalledOnce()
    f.finish({ exitCode: 0, signal: null })
    await expect(handle.done).rejects.toThrow('回执异常')
  })
  it('preserves a provider startup failure with no control handle and still exposes cleanup', async () => {
    const f = fixture(false), handle = spawnWindowsHidden(f.backend, spec), error = new Error('synthetic provider startup failure')
    f.reject(error)
    await expect(handle.done).rejects.toBe(error)
    await handle.waitForExit()
    expect(f.inner.waitForExit).toHaveBeenCalledOnce()
  })
  it('never steals a requested external control channel', () => {
    const f = fixture()
    expect(() => spawnWindowsHidden(f.backend, { ...spec, stdio: { ...spec.stdio, control: 'pipe' } })).toThrow('已占用')
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it('normalizes a native pipe target but leaves terminal launch and already GUI targets on their original path', async () => {
    const f = fixture()
    const terminal = vi.fn(async () => ({} as any))
    f.backend.spawnTerminal = terminal
    const backend = nativeProcessBackend(f.backend, 'win32', { electron: true })
    const handle = backend.spawn(spec)
    expect(vi.mocked(f.backend.spawn).mock.calls[0]![0].argv[1]).toMatch(/windows-hidden-launch\.mjs$/)
    await backend.spawnTerminal!({ argv: spec.argv, cwd: spec.cwd, rows: 24, cols: 80, terminalType: 'xterm', graceMs: 500 })
    expect(terminal.mock.calls[0]![0].argv).toEqual(spec.argv)
    f.inner.control!.end(JSON.stringify({ kind: 'exit', exitCode: 0, signal: null }))
    f.finish({ exitCode: 0, signal: null })
    await handle.done
  })
  it('folds only the plugin private launcher into the Windows relay without changing its native argv or mask', async () => {
    const f = fixture(), backend = nativeProcessBackend(f.backend, 'win32', { electron: true })
    const launcher = fileURLToPath(new URL('../src/host/private-launch.mjs', import.meta.url))
    const native = ['synthetic-cli.exe', 'literal & argument']
    const handle = backend.spawn({ ...spec, argv: [process.execPath, launcher, ...native] })
    const requested = vi.mocked(f.backend.spawn).mock.calls[0]![0]
    expect(JSON.parse(requested.argv[2]!)).toEqual({ nodeEnv: '1', privateUmask: true })
    expect(requested.argv.slice(3)).toEqual(native)
    f.inner.control!.end(JSON.stringify({ kind: 'exit', exitCode: 7, signal: null }))
    await expect(handle.done).resolves.toEqual({ exitCode: 7, signal: null })
    f.finish({ exitCode: 0, signal: null })
  })
})

it('real bootstrap forwards synthetic binary streams, literal arguments and a nonzero exit separately from its receipt', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-hidden-bootstrap-synthetic-')))
  roots.push(root)
  const entry = join(root, 'echo.mjs')
  // Simulate the deployed package: this directory has no SDK/node_modules and
  // an ordinary helper process does not have the Harness custom module loader.
  const bootstrap = join(root, 'windows-hidden-launch.mjs')
  cpSync(fileURLToPath(new URL('../src/host/windows-hidden-launch.mjs', import.meta.url)), bootstrap)
  cpSync(fileURLToPath(new URL('../src/host/native-spawn.mjs', import.meta.url)), join(root, 'native-spawn.mjs'))
  writeFileSync(entry, `const chunks=[]; process.stdin.on('data',chunk=>chunks.push(chunk));
process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({args:process.argv.slice(2),hex:Buffer.concat(chunks).toString('hex'),nodeEnv:process.env.ELECTRON_RUN_AS_NODE,controlMarker:process.env.DSH_SUBPROCESS_CONTROL??null}));process.stderr.write('synthetic stderr');process.exitCode=17;});`)
  const literal = ['中文 空格', '& no-shell', 'quote"', '', '\\tail\\']
  const child = spawn(process.execPath, [
    bootstrap,
    JSON.stringify({ nodeEnv: '1' }), process.execPath, entry, ...literal,
  ], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_SUBPROCESS_CONTROL: 'pipe' },
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe', 'ignore', 'ignore', 'ignore', 'ignore', 'pipe'], windowsHide: true,
  })
  let stdout = '', stderr = '', receipt = ''
  child.stdout!.on('data', chunk => stdout += chunk)
  child.stderr!.on('data', chunk => stderr += chunk)
  child.stdio[7]!.on('data', chunk => receipt += chunk)
  const input = Buffer.from([0, 13, 10, 255, 32, 65])
  child.stdin!.end(input)
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
    expect(code, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ args: literal, hex: input.toString('hex'), nodeEnv: '1', controlMarker: null })
    expect(stderr).toBe('synthetic stderr')
    expect(JSON.parse(receipt)).toEqual({ kind: 'exit', exitCode: 17, signal: null })
  } finally { clearTimeout(timer) }
})
