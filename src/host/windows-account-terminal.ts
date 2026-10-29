import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { Transform } from 'node:stream'
import { attestElectronConsoleManifest } from './windows-console-manifest.mjs'
import type { SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { ProcessCleanupUnconfirmedError, type ProcessBackend } from './process.ts'

/** A fixed diagnostic; never derived from PowerShell or native output. */
export class WindowsAccountTerminalError extends Error {
  constructor() {
    super('Windows 账号终端托管不可用，请检查 PowerShell 后重试')
  }
}

/** ConPTY asks for primary device attributes before PowerShell executes the
 * bootstrap. The client cannot answer until we return the adopted terminal.
 * Answer its first startup query as the account UI's xterm, and consume that
 * query so replaying buffered output cannot inject a second reply into the CLI.
 * All other bytes, including split UTF-8 and subsequent queries, pass unchanged.
 */
function bootstrapOutput(terminal: SubprocessTerminalHandle) {
  const queries = [Buffer.from('\x1b[c'), Buffer.from('\x1b[0c')]
  let pending = Buffer.alloc(0), active = true
  const finish = () => {
    active = false
    if (pending.length) output.push(pending)
    pending = Buffer.alloc(0)
  }
  const output = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (!active) { callback(null, chunk); return }
      const bytes = Buffer.concat([pending, chunk])
      pending = Buffer.alloc(0)
      for (let i = 0; i < bytes.length; i++) {
        const rest = bytes.subarray(i)
        for (const query of queries) {
          if (rest.length >= query.length && rest.subarray(0, query.length).equals(query)) {
            active = false
            output.push(Buffer.concat([bytes.subarray(0, i), rest.subarray(query.length)]))
            // xterm 6's primary DA response (VT100 with advanced video).
            void Promise.resolve().then(() => terminal.write('\x1b[?1;2c')).then(
              () => callback(), () => callback(new WindowsAccountTerminalError()),
            )
            return
          }
          if (rest.length < query.length && query.subarray(0, rest.length).equals(rest)) {
            pending = Buffer.from(rest)
            callback(null, bytes.subarray(0, i))
            return
          }
        }
      }
      callback(null, bytes)
    },
    flush(callback) { finish(); callback() },
  })
  const failed = (error: Error) => output.destroy(error)
  terminal.output.on('error', failed)
  output.once('close', () => { terminal.output.off('error', failed); terminal.output.unpipe(output) })
  // A handshake failure can precede the caller's output reader.
  output.on('error', () => undefined)
  terminal.output.pipe(output)
  return { output, finish }
}

/** ConPTY publishes pid=0 during async allocation in the pinned Windows SDK.
 * Attach a waiting bootstrap to a lifecycle-only Job before allowing the CLI to
 * spawn. The separate owner is itself held by the Host's ordinary subprocess
 * Job, so closing/crashing the Host also closes the account process range.
 */
export async function spawnAccountTerminal(
  backend: ProcessBackend,
  spec: SubprocessTerminalSpawnSpec,
  options: {
    platform?: NodeJS.Platform
    handshakeMs?: number
    cleanupMs?: number
    terminalExitMs?: number
  } = {},
): Promise<SubprocessTerminalHandle> {
  if ((options.platform ?? process.platform) !== 'win32') return backend.spawnTerminal!(spec)
  spec.signal?.throwIfAborted()
  const directory = await mkdtemp(join(tmpdir(), 'cwn-account-job-'))
  const windows = process.env.SystemRoot ?? 'C:\\Windows'
  let terminal: SubprocessTerminalHandle | undefined
  let startupOutput: ReturnType<typeof bootstrapOutput> | undefined
  const owner = await (async () => {
    try {
      return backend.spawn({
        argv: [
          join(windows, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-File',
          fileURLToPath(new URL('./windows-account-owner.ps1', import.meta.url)),
          '-HostProcessId',
          String(process.pid),
          '-Directory',
          directory,
        ],
        cwd: spec.cwd,
        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
        graceMs: 1000,
      })
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  })()
  void owner.done.catch(() => undefined)
  owner.stdout?.resume()
  owner.stderr?.resume()
  let cleanup: Promise<void> | undefined
  const exists = async (name: string) => {
    try {
      return (await readFile(join(directory, name), 'utf8')).trim() === name
    } catch {
      return false
    }
  }
  let manifestRequest: string | undefined
  const serviceManifest = async () => {
    let raw: string
    try { raw = await readFile(join(directory, 'manifest-request'), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    if (raw === manifestRequest) return
    if (manifestRequest !== undefined || Buffer.byteLength(raw) > 4096) throw new WindowsAccountTerminalError()
    manifestRequest = raw
    const proof = await attestElectronConsoleManifest(JSON.parse(raw))
    await writeFile(join(directory, 'manifest-proof'), JSON.stringify(proof), { mode: 0o600, flag: 'wx' })
  }
  const terminate = (): Promise<void> =>
    (cleanup ??= (async () => {
      let stage = 'receipt'
      try {
        // Cancellation before the handshake must still let the owner adopt the
        // bootstrap/console, while preventing it from launching the native CLI.
        await writeFile(join(directory, 'cancel'), 'cancel', { mode: 0o600 })
        const adoptedUntil = Date.now() + (options.cleanupMs ?? 9000)
        while (!(await exists('ready'))) {
          await serviceManifest()
          if (Date.now() >= adoptedUntil) throw new ProcessCleanupUnconfirmedError()
          await delay(25)
        }
        // Dispose ConPTY while the bootstrap is still alive. With the pinned
        // node-pty provider, killing the Job first bypasses its worker disposal.
        // Native exit receipts keep the bootstrap alive for this same reason.
        const disposal = terminal?.terminate().then(
          () => true,
          () => false,
        )
        if (disposal) await Promise.race([disposal, delay(options.terminalExitMs ?? 2500)])
        await writeFile(join(directory, 'stop'), 'stop', { mode: 0o600 })
        const deadline = Date.now() + (options.cleanupMs ?? 9000)
        while (!(await exists('closed'))) {
          if (Date.now() >= deadline) throw new ProcessCleanupUnconfirmedError()
          await delay(25)
        }
        // The receipt follows ActiveProcesses == 0, not just the root's exit.
        stage = 'terminal'
        if (disposal && !(await Promise.race([disposal, delay(options.terminalExitMs ?? 2500, false)])))
          throw new ProcessCleanupUnconfirmedError()
        stage = 'owner'
        if (!(await owner.waitForExit())) throw new ProcessCleanupUnconfirmedError()
        await owner.done
        stage = 'directory'
        await rm(directory, { recursive: true, force: true })
      } catch {
        cleanup = undefined
        throw Object.assign(new ProcessCleanupUnconfirmedError(), { stage })
      }
    })())
  try {
    // Compile/validate the fixed owner before allocating any ConPTY resources.
    const ownerUntil = Date.now() + (options.handshakeMs ?? 15_000)
    while (!(await exists('owner-ready'))) {
      spec.signal?.throwIfAborted()
      if (Date.now() >= ownerUntil) throw new Error('Windows account owner handshake timed out')
      await Promise.race([
        delay(25),
        owner.done.then(() => {
          throw new Error('Windows account owner ended')
        }),
      ])
    }
    spec.signal?.throwIfAborted()
    terminal = await backend.spawnTerminal!({
      ...spec,
      signal: undefined,
      argv: [
        join(windows, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-File',
        fileURLToPath(new URL('./windows-account-bootstrap.ps1', import.meta.url)),
        '-Directory',
        directory,
        '-RuntimePath',
        process.execPath,
        '-LaunchPath',
        fileURLToPath(new URL('./windows-account-launch.mjs', import.meta.url)),
        '-ArgumentsBase64',
        Buffer.from(JSON.stringify(spec.argv), 'utf8').toString('base64'),
      ],
      env: { ...spec.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    void terminal.done.catch(() => undefined)
    if (spec.terminalType === 'xterm-256color' || spec.terminalType === 'xterm')
      startupOutput = bootstrapOutput(terminal)
    const until = Date.now() + (options.handshakeMs ?? 15_000)
    while (!(await exists('ready'))) {
      if (startupOutput?.output.errored) throw new WindowsAccountTerminalError()
      await serviceManifest()
      spec.signal?.throwIfAborted()
      if (Date.now() >= until) throw new Error('Windows account terminal handshake timed out')
      await Promise.race([
        delay(25),
        owner.done.then(() => {
          throw new Error('Windows account owner ended')
        }),
      ])
    }
    if (startupOutput?.output.errored) throw new WindowsAccountTerminalError()
    startupOutput?.finish()
    const current = terminal
    const done = (async () => {
      for (;;) {
        try {
          const receipt = JSON.parse(await readFile(join(directory, 'exit'), 'utf8'))
          if (Number.isInteger(receipt.exitCode)) return { exitCode: receipt.exitCode, signal: null }
        } catch {
          /* An interrupted bootstrap retains the SDK outcome. */
        }
        const outcome = await Promise.race([current.done, delay(50, undefined)])
        if (outcome) return outcome
      }
    })()
    void done.catch(() => undefined)
    return {
      pid: Number(await readFile(join(directory, 'pid'), 'utf8')),
      output: startupOutput?.output ?? current.output,
      done,
      write: (data) => current.write(data),
      resize: (cols, rows) => current.resize(cols, rows),
      inspectForeground: () => current.inspectForeground(),
      inspectActivity: () => current.inspectActivity(),
      signalForeground: (signal) => current.signalForeground(signal),
      terminate,
    }
  } catch (error) {
    startupOutput?.finish()
    if (terminal) {
      // A cancellation can precede ready: the bootstrap keeps waiting until
      // the owner adopts its console/Job, then observes stop without running
      // the CLI. Require the same empty-range receipt as a normal close.
      try {
        await terminate()
      } catch (failure) {
        owner.terminate()
        await terminal.terminate().catch(() => undefined)
        throw failure
      }
    } else {
      // No terminal was allocated; only the ordinary managed owner exists.
      await writeFile(join(directory, 'stop'), 'stop', { mode: 0o600 })
      owner.terminate()
      if (!(await owner.waitForExit())) throw new ProcessCleanupUnconfirmedError()
      await rm(directory, { recursive: true, force: true })
    }
    if (spec.signal?.aborted) throw error
    throw new WindowsAccountTerminalError()
  }
}
