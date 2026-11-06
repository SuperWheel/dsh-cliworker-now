import { expect, it, vi } from 'vitest'
import { createNativeIO } from '../src/host/native-transport.mjs'

// All native processes in this file are deliberately synthetic protocol fixtures.
const fixture = (code: string) => [process.execPath, '-e', code]
const context = (overrides = {}) => {
  const frames: any[] = []
  const lines: string[] = []
  const io = createNativeIO(
    { project: process.cwd(), maxLineBytes: 4096, maxRunBytes: 65536, ...overrides },
    (line: string) => { lines.push(line); frames.push(JSON.parse(line)) },
    new AbortController().signal,
  )
  return { io, frames, lines }
}
it('summarizes an oversized tool command without failing the turn', async () => {
  const maxLineBytes = 1_048_576
  const { io, frames, lines } = context({ maxLineBytes })
  const command = 'x'.repeat(1_269_672)
  io.session('synthetic')
  expect(() => io.event({ kind: 'tool', step: 1, state: 'RUNNING', text: command,
    toolCall: { callId: 'command-1', name: 'commandExecution', command } })).not.toThrow()
  expect(frames.at(-1)).toMatchObject({ type: 'event', event: { kind: 'tool', step: 1,
    state: 'RUNNING', truncated: true, toolCall: { callId: 'command-1', name: 'commandExecution' } } })
  const kept = frames.at(-1).event.toolCall.command
  expect(kept.length).toBeGreaterThan(0)
  expect(Buffer.byteLength(kept)).toBeLessThan(Buffer.byteLength(command))
  expect(command.startsWith(kept)).toBe(true)
  io.result('SUCCESS', 'synthetic completed turn')
  await io.close()
  expect(frames.at(-1)).toMatchObject({ type: 'result', status: 'SUCCESS' })
  expect(lines.every((line) => Buffer.byteLength(line) <= maxLineBytes)).toBe(true)
})
it('bounds every string in oversized tool metadata without splitting UTF-8 characters', () => {
  const maxLineBytes = 65_536
  const { io, frames, lines } = context({ maxLineBytes })
  const huge = '图片😀'.repeat(20_000)
  const fields = ['command', 'name', 'callId', 'parentCallId', 'futureText']
  expect(() => io.event({ kind: 'tool', text: 'synthetic',
    toolCall: { ...Object.fromEntries(fields.map((key) => [key, huge])), exitCode: 1 } })).not.toThrow()
  const event = frames.at(-1).event
  expect(event.truncated).toBe(true)
  expect(event.toolCall.exitCode).toBe(1)
  for (const key of fields) {
    expect(event.toolCall[key].length).toBeGreaterThan(0)
    expect(Buffer.byteLength(event.toolCall[key])).toBeLessThan(Buffer.byteLength(huge))
    expect(huge.startsWith(event.toolCall[key])).toBe(true)
    expect(event.toolCall[key]).not.toContain('\uFFFD')
  }
  expect(lines.every((line) => Buffer.byteLength(line) <= maxLineBytes)).toBe(true)
})
it.each([256, 4096])('reduces escaped tool events to a summary within a %i-byte frame', (maxLineBytes) => {
  const { io, frames, lines } = context({ maxLineBytes })
  const text = '\u0000"\\图片😀'.repeat(5000)
  expect(() => io.event({ kind: 'tool', step: 42, state: 'FAILED', text,
    extra: { large: text }, toolCall: { command: text, extra: { large: text } } })).not.toThrow()
  const event = frames.at(-1).event
  expect(event).toEqual({ kind: 'tool', step: 42, state: 'FAILED', text: expect.any(String), truncated: true })
  expect(event.text.length).toBeGreaterThan(0)
  expect(text.startsWith(event.text)).toBe(true)
  expect(event.text).not.toContain('\uFFFD')
  expect(lines.every((line) => Buffer.byteLength(line) <= maxLineBytes)).toBe(true)
})
it('emits the smallest summary when it fits and rejects only a smaller frame budget', () => {
  const minimal = { type: 'event', event: { kind: 'tool', text: '', truncated: true } }
  const maxLineBytes = Buffer.byteLength(JSON.stringify(minimal) + '\n')
  const event = { kind: 'tool', step: 1, state: 'RUNNING', text: 'x'.repeat(1000), toolCall: { command: 'x'.repeat(1000) } }
  const fits = context({ maxLineBytes })
  expect(() => fits.io.event(event)).not.toThrow()
  expect(fits.frames).toEqual([minimal])
  expect(Buffer.byteLength(fits.lines[0]!)).toBe(maxLineBytes)
  const tooSmall = context({ maxLineBytes: maxLineBytes - 1 })
  expect(() => tooSmall.io.event(event)).toThrow('Native bridge frame exceeds limit')
  expect(tooSmall.lines).toEqual([])
})
it('keeps ordinary tool frames intact and retains the assistant frame guard', () => {
  const { io, frames, lines } = context()
  const event = { kind: 'tool', text: 'synthetic', step: 1, state: 'COMPLETED',
    detail: 'metadata', toolCall: { command: 'echo synthetic', callId: 'one', name: 'commandExecution', output: 'synthetic' } }
  io.event(event)
  expect(frames).toEqual([{ type: 'event', event }])
  expect(() => io.event({ kind: 'assistant', text: 'x'.repeat(5000) })).toThrow('Native bridge frame exceeds limit')
  expect(lines).toHaveLength(1)
})
it('correlates concurrent RPC responses and handles reverse requests without a shell', async () => {
  const { io, frames } = context()
  const peer = io.openStdio(
    fixture(`
    const rl=require('readline').createInterface({input:process.stdin});
    rl.on('line', line=>{const v=JSON.parse(line);
      if(v.method==='hello') {console.log(JSON.stringify({id:'permission',method:'permission/request',params:{}}));console.log(JSON.stringify({id:v.id,result:{ready:true}}));}
      else if(v.method==='echo') console.log(JSON.stringify({jsonrpc:'2.0',id:v.id,result:v.params}));
      else if(v.id==='permission') console.log(JSON.stringify({method:'denied',params:v.result}));
    });
  `),
  )
  peer.onMessage(async (v: any) => {
    if (v.method === 'permission/request') await peer.send({ id: v.id, result: { allowed: false } })
  })
  const [a, b] = await Promise.all([
    peer.request('hello', {}),
    peer.request('echo', { text: '中文' }, { jsonrpc: true }),
  ])
  expect(a).toEqual({ ready: true })
  expect(b).toEqual({ text: '中文' })
  expect((await peer.waitFor((v: any) => v.method === 'denied')).params).toEqual({ allowed: false })
  io.session('synthetic-session')
  io.result('SUCCESS', 'done')
  expect(frames.some((v) => v.type === 'result')).toBe(false)
  peer.end()
  expect((await peer.done).exitCode).toBe(0)
  await io.close()
  expect(frames.at(-1)).toMatchObject({ type: 'result', status: 'SUCCESS' })
})
it.each(['{broken}\n', JSON.stringify({ type: 'x', text: 'a'.repeat(5000) }) + '\n'])(
  'rejects a malformed or oversized native frame and cleans up its process',
  async (line) => {
    const { io, frames } = context()
    const peer = io.openStdio(
      fixture(`process.stdout.write(${JSON.stringify(line)});setInterval(()=>{},1000)`),
    )
    await expect(peer.waitFor(() => true)).rejects.toThrow()
    await expect(peer.done).rejects.toThrow()
    await io.close(new Error('synthetic rejected frame'))
    expect(frames.at(-1)).toMatchObject({ status: 'ERROR' })
  },
)
it('times out an unacknowledged request without retrying or fabricating delivery', async () => {
  const { io, frames } = context()
  const peer = io.openStdio(
    fixture(`require('readline').createInterface({input:process.stdin}).on('line',()=>{});`),
  )
  await expect(peer.request('prompt', { text: 'synthetic' }, { timeoutMs: 20 })).rejects.toThrow('timed out')
  await peer.close()
  await io.close(new Error('delivery unknown'))
  expect(frames).toEqual([{ type: 'result', status: 'ERROR', response: '', error: 'delivery unknown', resultScope: 'run' }])
})
it('rejects a changed resume identity and preserves observed text on failure', async () => {
  const { io, frames } = context({ conversationId: 'original' })
  expect(() => io.session('another')).toThrow('resume identity')
  io.session('original')
  io.event({ kind: 'assistant', text: '本轮正文' })
  await io.close(new Error('failed after output'))
  expect(frames.at(-1)).toMatchObject({ status: 'ERROR', response: '本轮正文' })
})
it('does not let a nonzero process exit become a successful bridge result', async () => {
  const { io, frames } = context()
  const child = io.spawn(fixture('process.exit(7)'))
  expect((await child.done).exitCode).toBe(7)
  io.session('synthetic')
  io.result('SUCCESS', 'completion text is insufficient')
  await io.close()
  expect(frames.at(-1)).toMatchObject({ status: 'ERROR' })
})
it.skipIf(process.platform === 'win32').each([
  ['SIGTERM', 143, true, 'SUCCESS'], ['SIGTERM', 143, false, 'ERROR'], ['SIGTERM', 7, true, 'ERROR'],
  ['SIGINT', 130, true, 'SUCCESS'], ['SIGINT', 130, false, 'ERROR'], ['SIGINT', 143, true, 'ERROR'],
] as const)('handles owned %s cleanup exit %s with a protocol terminal=%s as %s', async (signal, exit, terminal, status) => {
  const { io, frames } = context()
  const peer = io.openStdio(fixture(`
    process.on('${signal}',()=>process.exit(${exit}));
    process.stdout.write(JSON.stringify({method:'ready'})+'\\n');
    process.stdin.resume();setInterval(()=>{},1000);
  `), { stopSignal: signal })
  await peer.waitFor((value: any) => value.method === 'ready')
  io.session('synthetic')
  if (terminal) io.result('SUCCESS', 'synthetic confirmed response')
  await peer.close()
  expect((await peer.done).exitCode).toBe(exit)
  await io.close()
  expect(frames.at(-1)).toMatchObject({ status })
})
it('does not accept a signal-shaped exit when kill returned false without delivering the signal', async () => {
  const { io, frames } = context()
  let ready!: () => void
  const started = new Promise<void>(resolve => { ready = resolve })
  const child = io.spawn(fixture(`
    process.stdout.write('ready');
    setTimeout(()=>process.exit(143),100);
  `), { onStdout: () => ready() })
  await started
  const kill = vi.spyOn(child.process, 'kill').mockReturnValue(false)
  try {
    io.session('synthetic')
    io.result('SUCCESS', 'synthetic response')
    await io.close()
    expect(kill).toHaveBeenCalledWith('SIGTERM')
    expect((await child.done).exitCode).toBe(143)
    expect(frames.at(-1)).toMatchObject({ status: 'ERROR' })
  } finally { kill.mockRestore() }
})
it('rejects a natural 143 exit even after a nominal protocol terminal', async () => {
  const { io, frames } = context()
  const child = io.spawn(fixture('process.exit(143)'))
  expect((await child.done).exitCode).toBe(143)
  io.session('synthetic')
  io.result('SUCCESS', 'synthetic response')
  await io.close()
  expect(frames.at(-1)).toMatchObject({ status: 'ERROR' })
})
it('rejects damaged trailing data even after a nominal terminal event', async () => {
  const { io, frames } = context()
  const peer = io.openStdio(
    fixture(`process.stdout.write('{"method":"finished"}\\n{broken}\\n');setInterval(()=>{},1000)`),
  )
  peer.onMessage((value: any) => {
    if (value.method === 'finished') {
      io.session('synthetic')
      io.result('SUCCESS', 'nominal')
    }
  })
  await expect(peer.done).rejects.toThrow()
  await expect(peer.close()).rejects.toThrow()
  await io.close()
  expect(frames.at(-1)).toMatchObject({ status: 'ERROR' })
})
it('deduplicates native guidance by stable identity, waits for receipt, and rejects changed text', async () => {
  const { io } = context()
  let calls = 0, accept!: () => void
  const receipt = new Promise<void>((resolve) => { accept = resolve })
  const release = io.registerSteer(async () => { calls++; await receipt })
  const first = io.steer('synthetic guidance', 'one', 'attempt-one')
  expect(io.steer('synthetic guidance', 'one', 'attempt-two')).toBe(first)
  await expect(io.steer('different text', 'one', 'attempt-three')).rejects.toThrow('其他消息')
  await Promise.resolve()
  expect(calls).toBe(1)
  accept()
  await first
  release()
  await expect(io.steer('late', 'two', 'attempt-four')).rejects.toMatchObject({ code: 'STEER_REJECTED' })
  await io.steer('synthetic guidance', 'one', 'attempt-five')
  expect(calls).toBe(1)
  await io.close(new Error('synthetic fixture complete'))
})
it('never redelivers guidance with an unknown receipt, but permits retry after explicit not-accepted', async () => {
  const { io } = context()
  let calls = 0
  io.registerSteer(async (message: string) => {
    calls++
    if (message === 'unknown') throw new Error('receipt unknown')
    if (calls === 2) throw Object.assign(new Error('not accepted'), { code: 'STEER_REJECTED' })
  })
  await expect(io.steer('unknown', 'one', 'a')).rejects.toThrow('unknown')
  await expect(io.steer('unknown', 'one', 'b')).rejects.toThrow('unknown')
  expect(calls).toBe(1)
  await expect(io.steer('rejected', 'two', 'c')).rejects.toMatchObject({ code: 'STEER_REJECTED' })
  await io.steer('rejected', 'two', 'd')
  expect(calls).toBe(3)
  io.session('synthetic')
  io.result('SUCCESS', '')
  await expect(io.steer('late', 'three', 'e')).rejects.toMatchObject({ code: 'STEER_REJECTED' })
  await io.close()
})
it('closes guidance admission synchronously when stopped before a deferred native write', async () => {
  const controller = new AbortController(), frames: string[] = []
  const io = createNativeIO({ project: process.cwd(), maxLineBytes: 4096, maxRunBytes: 65536 },
    (line: string) => frames.push(line), controller.signal)
  let calls = 0
  io.registerSteer(async () => { calls++ })
  const pending = io.steer('synthetic', 'one', 'a')
  controller.abort()
  await expect(pending).rejects.toMatchObject({ code: 'STEER_REJECTED' })
  expect(calls).toBe(0)
  await io.close(new Error('synthetic stopped'))
})
