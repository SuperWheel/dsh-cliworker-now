import { afterEach, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import { readFile, writeFile, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnAccountTerminal } from '../src/host/windows-account-terminal.ts'
import type { ProcessBackend } from '../src/host/process.ts'

// Explicit simulation of Job receipts and a pid=0 ConPTY provider. The native
// Job/PTY/detached-descendant behavior is covered by windows-process.test.ts.
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { resolve, promise }
}
function fixture(ready = true) {
  const ended = deferred<any>(),
    ownerEnded = deferred<any>()
  const output = new PassThrough()
  const terminal = {
    pid: 0,
    output,
    done: ended.promise,
    terminate: vi.fn(async () => {
      output.end()
      ended.resolve({ exitCode: 1, signal: null })
    }),
    write: vi.fn(),
    resize: vi.fn(),
    inspectForeground: vi.fn(),
    inspectActivity: vi.fn(),
    signalForeground: vi.fn(),
  }
  const owner = {
    done: ownerEnded.promise,
    terminate: vi.fn(() => ownerEnded.resolve({ exitCode: 2, signal: null })),
    waitForExit: vi.fn(async () => true),
  }
  let directory = ''
  const backend = {
    spawn: vi.fn((spec) => {
      directory = spec.argv.at(-1)
      directories.push(directory)
      void writeFile(join(directory, 'owner-ready'), 'owner-ready')
      return owner
    }),
    spawnTerminal: vi.fn(async () => {
      await writeFile(join(directory, 'pid'), '321')
      if (ready) await writeFile(join(directory, 'ready'), 'ready')
      return terminal
    }),
  } as unknown as ProcessBackend
  const spec = {
    argv: ['fixture.exe', 'literal & argument'],
    cwd: process.cwd(),
    rows: 24,
    cols: 80,
    terminalType: 'xterm-256color',
    graceMs: 5,
  }
  // Real Windows file scheduling under parallel workers can exceed 60 ms.
  // Keep bounded failure tests while leaving room for the simulated receipts.
  const options = { platform: 'win32' as const, handshakeMs: 500, cleanupMs: 500, terminalExitMs: 1 }
  const closeJob = async () => {
    await writeFile(join(directory, 'closed'), 'closed')
    ended.resolve({ exitCode: 143, signal: null })
    ownerEnded.resolve({ exitCode: 0, signal: null })
  }
  return { backend, spec, options, terminal, owner, closeJob, directory: () => directory }
}
it('waits for a Job receipt, exposes the bootstrap pid and preserves literal argv', async () => {
  const f = fixture()
  const handle = await spawnAccountTerminal(f.backend, f.spec, f.options)
  expect(handle.pid).toBe(321)
  const launch = vi.mocked(f.backend.spawnTerminal!).mock.calls[0]![0].argv
  expect(launch[0]).toMatch(/powershell\.exe$/)
  expect(launch[5]).toMatch(/windows-account-bootstrap\.ps1$/)
  expect(JSON.parse(Buffer.from(launch.at(-1)!, 'base64').toString('utf8'))).toEqual(f.spec.argv)
  const closing = handle.terminate()
  expect(handle.terminate()).toBe(closing)
  await vi.waitFor(() => expect(f.terminal.terminate).toHaveBeenCalledOnce())
  await f.closeJob()
  await closing
  expect(f.terminal.terminate).toHaveBeenCalledOnce()
  await expect(access(f.directory())).rejects.toThrow()
})

it.each(['\x1b[c', '\x1b[0c'])('answers a split bootstrap DA query %j before adoption and preserves all other bytes (模拟)', async query => {
  const f = fixture(false)
  const before = Buffer.from('\x1b[1t中文'), after = Buffer.from('\x1b[?1004h\x1b[?9001h')
  // Sanitized ConPTY startup bytes captured on Windows; the Chinese text and
  // chunk boundaries are simulated. No real CLI/account output is recorded.
  f.terminal.write.mockImplementation(async data => {
    expect(data).toBe('\x1b[?1;2c')
    await writeFile(join(f.directory(), 'ready'), 'ready')
  })
  vi.mocked(f.backend.spawnTerminal!).mockImplementation(async () => {
    await writeFile(join(f.directory(), 'pid'), '321')
    for (const byte of Buffer.concat([before, Buffer.from(query), after])) f.terminal.output.write(Buffer.from([byte]))
    return f.terminal as any
  })
  const handle = await spawnAccountTerminal(f.backend, f.spec, f.options)
  const chunks: Buffer[] = []
  const reading = (async () => { for await (const chunk of handle.output) chunks.push(Buffer.from(chunk)) })()
  // After adoption queries belong to the actual terminal UI, never the shim.
  f.terminal.output.write(query)
  await f.closeJob()
  await handle.terminate()
  await reading
  expect(Buffer.concat(chunks)).toEqual(Buffer.concat([before, after, Buffer.from(query)]))
  expect(f.terminal.write).toHaveBeenCalledOnce()
})

it('flushes an incomplete startup escape on adoption and leaves non-DA commands unchanged (模拟)', async () => {
  const f = fixture()
  f.terminal.output.write('\x1b[>c\x1b[6n\x1b[')
  const handle = await spawnAccountTerminal(f.backend, f.spec, f.options)
  const chunks: Buffer[] = []
  const reading = (async () => { for await (const chunk of handle.output) chunks.push(Buffer.from(chunk)) })()
  await f.closeJob()
  await handle.terminate()
  await reading
  expect(Buffer.concat(chunks).toString()).toBe('\x1b[>c\x1b[6n\x1b[')
  expect(f.terminal.write).not.toHaveBeenCalled()
})

it('does not answer startup queries for a different declared terminal type (模拟)', async () => {
  const f = fixture()
  f.terminal.output.write('\x1b[c')
  const handle = await spawnAccountTerminal(f.backend, { ...f.spec, terminalType: 'dumb' }, f.options)
  expect(handle.output).toBe(f.terminal.output)
  expect(f.terminal.write).not.toHaveBeenCalled()
  await f.closeJob()
  await handle.terminate()
})

it('still requires adoption and an empty Job receipt when the bootstrap reply fails (模拟)', async () => {
  const f = fixture(false)
  f.terminal.write.mockRejectedValueOnce(new Error('SIMULATED input failure'))
  f.terminal.output.write('\x1b[c')
  const starting = spawnAccountTerminal(f.backend, f.spec, f.options)
  void starting.catch(() => undefined)
  await vi.waitFor(async () => expect(await readFile(join(f.directory(), 'cancel'), 'utf8')).toBe('cancel'))
  expect(f.terminal.terminate).not.toHaveBeenCalled()
  await writeFile(join(f.directory(), 'ready'), 'ready')
  await vi.waitFor(() => expect(f.terminal.terminate).toHaveBeenCalledOnce())
  await f.closeJob()
  await expect(starting).rejects.toThrow('Windows 账号终端托管不可用')
  await expect(access(f.directory())).rejects.toThrow()
})
it('preserves identity and the Job receipt when SDK disposal fails and retries the same terminal', async () => {
  const f = fixture()
  const handle = await spawnAccountTerminal(f.backend, f.spec, f.options)
  await f.closeJob()
  f.terminal.terminate.mockRejectedValueOnce(new Error('fixture disposal failed'))
  await expect(handle.terminate()).rejects.toThrow('cleanup')
  expect(await readFile(join(f.directory(), 'pid'), 'utf8')).toBe('321')
  await handle.terminate()
  expect(f.backend.spawnTerminal).toHaveBeenCalledOnce()
  expect(f.terminal.terminate).toHaveBeenCalledTimes(2)
})
it('does not report success if the Job never confirms an empty process range', async () => {
  const f = fixture()
  const handle = await spawnAccountTerminal(f.backend, f.spec, f.options)
  await expect(handle.terminate()).rejects.toThrow('cleanup')
  await vi.waitFor(() => expect(f.terminal.terminate).toHaveBeenCalledOnce())
  await f.closeJob()
  await handle.terminate()
})
it('does not release an allocated pid=0 bootstrap on a pre-handshake timeout without an empty Job receipt', async () => {
  const f = fixture(false)
  await expect(spawnAccountTerminal(f.backend, f.spec, f.options)).rejects.toThrow('cleanup')
  expect(f.owner.terminate).toHaveBeenCalled()
  expect(f.terminal.terminate).toHaveBeenCalledOnce()
  expect(await readFile(join(f.directory(), 'pid'), 'utf8')).toBe('321')
})
it('does not allocate a PTY when the owner dies before its initialization receipt', async () => {
  const f = fixture(false)
  vi.mocked(f.backend.spawn).mockImplementation(() => f.owner as any)
  f.owner.terminate()
  await expect(spawnAccountTerminal(f.backend, f.spec, f.options)).rejects.toThrow(
    'Windows 账号终端托管不可用',
  )
  expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
})
it('removes its private directory if creating the owner synchronously fails', async () => {
  const f = fixture()
  let directory = ''
  vi.mocked(f.backend.spawn).mockImplementation((spec) => {
    directory = spec.argv.at(-1)!
    throw new Error('fixture spawn failed')
  })
  await expect(spawnAccountTerminal(f.backend, f.spec, f.options)).rejects.toThrow('fixture spawn failed')
  expect(f.backend.spawnTerminal).not.toHaveBeenCalled()
  await expect(access(directory)).rejects.toThrow()
})

it('reports native exit before the bootstrap exits, then disposes its still-live PTY', async () => {
  const f = fixture()
  const handle = await spawnAccountTerminal(f.backend, f.spec, f.options)
  await writeFile(join(f.directory(), 'exit'), JSON.stringify({ exitCode: 7, signal: null }))
  await expect(handle.done).resolves.toEqual({ exitCode: 7, signal: null })
  expect(f.terminal.terminate).not.toHaveBeenCalled()
  const closing = handle.terminate()
  await vi.waitFor(() => expect(f.terminal.terminate).toHaveBeenCalledOnce())
  await f.closeJob()
  await closing
})

it('waits for adoption before disposing a cancelled bootstrap and never releases without the empty receipt', async () => {
  const f = fixture(false)
  const controller = new AbortController()
  vi.mocked(f.backend.spawnTerminal!).mockImplementation(async () => {
    await writeFile(join(f.directory(), 'pid'), '321')
    controller.abort()
    return f.terminal as any
  })
  const starting = spawnAccountTerminal(
    f.backend,
    { ...f.spec, signal: controller.signal },
    { ...f.options, cleanupMs: 1000 },
  )
  void starting.catch(() => undefined)
  await vi.waitFor(async () => expect(await readFile(join(f.directory(), 'cancel'), 'utf8')).toBe('cancel'))
  expect(f.terminal.terminate).not.toHaveBeenCalled()
  await writeFile(join(f.directory(), 'ready'), 'ready')
  await vi.waitFor(() => expect(f.terminal.terminate).toHaveBeenCalledOnce())
  await f.closeJob()
  await expect(starting).rejects.toThrow()
  await expect(access(f.directory())).rejects.toThrow()
})
