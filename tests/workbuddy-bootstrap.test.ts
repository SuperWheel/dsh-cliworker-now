import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { PassThrough } from 'node:stream'
import { createServer, createConnection, type Server, type Socket } from 'node:net'
import { mkdtemp, chmod, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { createWorkBuddyLaunch, workbuddyChildEnv } from '../src/host/workbuddy-bootstrap.mjs'

// The CJS export is invoked with an injected simulated binding. Never _linkedBinding.
const { runWorkBuddyKeyHelper } = createRequire(import.meta.url)('../src/host/workbuddy-key-helper.cjs')
const fakeKey = Buffer.alloc(32, 0x5a).toString('base64')
const fakeDerived = createHash('sha256').update(fakeKey).digest()
const roots: string[] = [], servers: Server[] = [], sockets: Socket[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const socket of sockets.splice(0)) socket.destroy()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function serverFixture(ack = JSON.stringify({ ok: true, policy: 'fields' }) + '\n') {
  const root = await mkdtemp(join(tmpdir(), 'wbh-')); roots.push(root)
  await chmod(root, 0o700)
  const socketPath = join(root, 'b.sock')
  let wire: any
  const server = createServer(socket => {
    sockets.push(socket)
    let value = ''
    socket.on('data', chunk => {
      value += chunk.toString()
      if (!value.includes('\n')) return
      wire = JSON.parse(value.trim())
      socket.end(ack)
    })
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve) })
  await chmod(socketPath, 0o600)
  return { socketPath, wire: () => wire }
}
async function helperRun(overrides: any = {}, request: any = undefined) {
  const input = new PassThrough(), output = new PassThrough()
  let stdout = ''
  output.on('data', chunk => { stdout += chunk.toString() })
  const promise = runWorkBuddyKeyHelper({ input, output, readBinding: () => ({ version: 1, atRestSecretKey: fakeKey }), timeoutMs: 100, retryMs: 5, ...overrides })
  input.end(typeof request === 'string' ? request : JSON.stringify(request ?? { socketPath: '/simulated-only', token: 'a'.repeat(64), sessionId: 'simulated-session', pid: 12345 }) + '\n')
  const result = await promise
  expect(stdout.includes(fakeKey)).toBe(false)
  expect(stdout.includes(fakeDerived.toString('base64'))).toBe(false)
  expect(stdout.trim().split('\n')).toHaveLength(1)
  return { result, stdout }
}
function helperIo(answer: any = { ok: true }, base: any = {}) {
  const spawn = vi.fn((_argv: string[], options: any) => {
    let resolveDone: (value: unknown) => void
    const done = new Promise(resolve => { resolveDone = resolve })
    return {
      process: { stdin: { end(_request: string) {
        options.onStdout(Buffer.from(JSON.stringify(answer) + '\n'))
        resolveDone({ exitCode: answer.ok ? 0 : 1, signal: null })
      } } }, done, assertHealthy() {}, stop: vi.fn(async () => {}),
    }
  })
  return { spawn, signal: new AbortController().signal, ...base }
}
function sendReady(env: Record<string, string | undefined>, changes = {}, suffix = '') {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection(env.CODEBUDDY_SIDECAR_READY_SOCKET!)
    sockets.push(socket)
    let reply = ''
    socket.on('error', reject)
    socket.on('data', chunk => { reply += chunk.toString() })
    socket.once('close', () => resolve(reply))
    socket.once('connect', () => socket.write(JSON.stringify({ jsonrpc: '2.0', id: 'ready-simulated', method: 'session.ready', params: {
      protocolVersion: 1, token: env.CODEBUDDY_SIDECAR_READY_TOKEN, sessionId: env.CODEBUDDY_SIDECAR_READY_SESSION_ID, pid: 12345, port: 42123, ...changes,
    } }) + '\n' + suffix))
  })
}
const install = { runtime: '/simulated/Electron', configDir: '/simulated/home/.workbuddy', dataFolderName: '.workbuddy' }

describe('模拟 WorkBuddy 密钥助手单次投递', () => {
  it('模拟成功：文本 SHA256、精确 wire keys、仅输出 ok 且清零已写 buffer', async () => {
    const server = await serverFixture()
    let wireBuffer: Buffer | undefined
    const connect = (options: any) => {
      const socket = createConnection(options), write = socket.write.bind(socket)
      socket.write = ((chunk: Buffer, ...args: any[]) => { wireBuffer = chunk; return (write as any)(chunk, ...args) }) as any
      return socket
    }
    const { result, stdout } = await helperRun({ connect }, { socketPath: server.socketPath, token: 'a'.repeat(64), sessionId: 'simulated-session', pid: 12345 })
    expect(result).toEqual({ ok: true }); expect(stdout).toBe('{"ok":true}\n')
    const wire = server.wire()
    expect(Object.keys(wire).sort()).toEqual(['bootstrap', 'pid', 'sessionId', 'token', 'version'])
    expect(wire.pid).toBe(12345)
    expect(wire.bootstrap.symmetricKey.keyBase64 === fakeDerived.toString('base64')).toBe(true)
    expect(wire.bootstrap.symmetricKey.keyId === createHash('sha256').update(fakeDerived).digest('hex').slice(0, 16)).toBe(true)
    expect(wire.bootstrap.policy).toBe('fields')
    expect(wire.bootstrap.asymmetricUnavailable).toBe('missing-key')
    expect(wireBuffer?.every(value => value === 0)).toBe(true)
  })
  it('模拟绑定异常不回传异常原文', async () => {
    expect((await helperRun({ readBinding: () => { throw new Error(fakeKey) } })).result).toEqual({ ok: false, reason: 'binding-unavailable' })
  })
  it.each([null, { version: 2, atRestSecretKey: fakeKey }, { version: 1, atRestSecretKey: 'invalid' }, { version: 1, atRestSecretKey: Buffer.alloc(32).toString('base64') }])('模拟拒绝无效绑定载荷 %#', async payload => {
    expect((await helperRun({ readBinding: () => payload })).result).toEqual({ ok: false, reason: 'payload-invalid' })
  })
  it.each(['{bad}\n', '{}\n', '{"pid":0}\n', 'x'.repeat(8193)])('模拟请求无效 %#', async request => {
    const readBinding = vi.fn()
    expect((await helperRun({ readBinding }, request)).result).toEqual({ ok: false, reason: 'request-invalid' })
    expect(readBinding).not.toHaveBeenCalled()
  })
  it('模拟连接失败类别固定', async () => {
    expect((await helperRun({ connect: () => { throw Object.assign(new Error(fakeKey), { code: 'EACCES' }) } })).result).toEqual({ ok: false, reason: 'connect-failed' })
  })
  it('模拟 ENOENT 与 ECONNREFUSED 重试后 timeout', async () => {
    let count = 0
    const result = await helperRun({ timeoutMs: 30, connect: () => { throw Object.assign(new Error(fakeKey), { code: count++ % 2 ? 'ENOENT' : 'ECONNREFUSED' }) } })
    expect(result.result).toEqual({ ok: false, reason: 'timeout' }); expect(count).toBeGreaterThan(1)
  })
  it('模拟连接拒绝后重试成功', async () => {
    const f = await serverFixture()
    let count = 0
    const connect = (options: any) => {
      if (count++ < 2) throw Object.assign(new Error('模拟尚未监听'), { code: 'ECONNREFUSED' })
      return createConnection(options)
    }
    expect((await helperRun({ connect }, { socketPath: f.socketPath, token: 'a'.repeat(64), sessionId: 'simulated', pid: 12 })).result).toEqual({ ok: true })
    expect(count).toBe(3)
  })
  it('模拟 ack 无响应时超时并关闭通道', async () => {
    const connect = () => {
      const stream = new PassThrough()
      // A simulated connected duplex with no server reply; writes are discarded.
      stream.write = (() => true) as any
      queueMicrotask(() => stream.emit('connect'))
      return stream
    }
    expect((await helperRun({ connect, timeoutMs: 15 })).result).toEqual({ ok: false, reason: 'timeout' })
  })
  it.each(['{}\n', '{"ok":true,"policy":"none"}\n', 'bad\n'])('模拟错误 ack %#', async ack => {
    const f = await serverFixture(ack)
    expect((await helperRun({}, { socketPath: f.socketPath, token: 'a'.repeat(64), sessionId: 'simulated', pid: 12 })).result).toEqual({ ok: false, reason: 'ack-invalid' })
  })
  it('模拟通道提前关闭', async () => {
    const f = await serverFixture('')
    expect((await helperRun({}, { socketPath: f.socketPath, token: 'a'.repeat(64), sessionId: 'simulated', pid: 12 })).result).toEqual({ ok: false, reason: 'channel-closed' })
  })
})

describe('模拟 WorkBuddy 环境与 ready 生命周期', () => {
  it('模拟混合大小写代理与继承凭据用 undefined 删除', () => {
    vi.stubEnv('hTtP_pRoXy', 'simulated-proxy')
    const base = { HTTPS_PROXY: 'simulated', no_proxy: '*', CODEBUDDY_API_KEY: fakeKey, CODEBUDDY_GATEWAY_PASSWORD: fakeKey,
      CODEBUDDY_SIDECAR_TOKEN: fakeKey, ACC_PRODUCT_CONFIG_PATH: '/simulated', WORKBUDDY_AT_REST_ENCRYPTION: 'none', KEEP: 'yes' }
    const env = workbuddyChildEnv(base, install)
    for (const key of ['hTtP_pRoXy', 'HTTPS_PROXY', 'no_proxy', 'CODEBUDDY_API_KEY', 'CODEBUDDY_GATEWAY_PASSWORD', 'CODEBUDDY_SIDECAR_TOKEN', 'ACC_PRODUCT_CONFIG_PATH'])
      expect(Object.hasOwn(env, key) && env[key] === undefined).toBe(true)
    expect(env).toMatchObject({ KEEP: 'yes', WORKBUDDY_AT_REST_ENCRYPTION: 'fields', CODEBUDDY_CONFIG_DIR: install.configDir, CODEBUDDY_DISABLE_CRON: '1', DISABLE_AUTOUPDATER: '1' })
    expect(JSON.stringify(env).includes(fakeKey)).toBe(false)
    expect(base.CODEBUDDY_API_KEY === fakeKey).toBe(true)
  })
  it('模拟 ready 成功前私有权限，成功后 socket 与目录删除，helper 环境白名单', async () => {
    const launch = await createWorkBuddyLaunch({ install, baseEnv: { NOT_ALLOWED: fakeKey, NODE_OPTIONS: '--inspect', PATH: '/simulated/path' } })
    const root = dirname(launch.env.CODEBUDDY_SIDECAR_READY_SOCKET!), io = helperIo()
    try {
      expect((await stat(root)).mode & 0o777).toBe(0o700)
      expect((await stat(launch.env.CODEBUDDY_SIDECAR_READY_SOCKET!)).mode & 0o777).toBe(0o600)
      await launch.deliver(io, 12345)
      const ready = launch.ready(1000), reply = await sendReady(launch.env)
      expect(await ready).toEqual({ port: 42123 })
      expect(JSON.parse(reply)).toEqual({ jsonrpc: '2.0', id: 'ready-simulated', result: { ok: true } })
      await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' })
      const options = io.spawn.mock.calls[0]![1]
      expect(options.reportStderr).toBe(false)
      const keys = Object.keys(options.env).filter(key => options.env[key] !== undefined)
      expect(keys.every(key => ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TMPDIR', 'TEMP', 'ELECTRON_RUN_AS_NODE'].includes(key))).toBe(true)
      expect(JSON.stringify(options.env).includes(fakeKey)).toBe(false)
    } finally { await launch.close() }
  })
  it.each([{ token: 'wrong' }, { sessionId: 'wrong' }, { pid: 9 }, { protocolVersion: 2 }, { port: 0 }, { port: 65536 }, { port: 1.5 }])('模拟拒绝 ready 身份或端口 %#', async changes => {
    const launch = await createWorkBuddyLaunch({ install })
    try {
      await launch.deliver(helperIo(), 12345)
      const ready = expect(launch.ready(1000)).rejects.toMatchObject({ reason: 'ready-invalid' })
      await sendReady(launch.env, changes); await ready
    } finally { await launch.close() }
    await expect(stat(dirname(launch.env.CODEBUDDY_SIDECAR_READY_SOCKET!))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('模拟 ready 超时与中断均可清理', async () => {
    const launch = await createWorkBuddyLaunch({ install })
    await expect(launch.ready(10)).rejects.toMatchObject({ reason: 'ready-timeout' })
    await launch.close(); await launch.close()
    const controller = new AbortController()
    const stopped = await createWorkBuddyLaunch({ install, signal: controller.signal })
    controller.abort()
    await expect(stopped.ready(100)).rejects.toMatchObject({ reason: 'stopped' })
    await stopped.close()
  })
  it('模拟拒绝多行 ready', async () => {
    const launch = await createWorkBuddyLaunch({ install })
    try {
      await launch.deliver(helperIo(), 12345)
      const failed = expect(launch.ready(500)).rejects.toMatchObject({ reason: 'ready-invalid' })
      await sendReady(launch.env, {}, '{}\n'); await failed
    } finally { await launch.close() }
  })
  it.each(['binding-unavailable', 'payload-invalid', 'ack-invalid'])('模拟助手错误 %s 不包含模拟密钥', async reason => {
    const launch = await createWorkBuddyLaunch({ install })
    try { await expect(launch.deliver(helperIo({ ok: false, reason }), 12345)).rejects.toMatchObject({ reason }) }
    finally { await launch.close() }
  })
  it('模拟 helper 输出成功后仍需确认退出，启动期停止立即终止等待', async () => {
    const controller = new AbortController(), launch = await createWorkBuddyLaunch({ install })
    let exited = false
    const io = { signal: controller.signal, spawn(_argv: any, options: any) {
      return { process: { stdin: { end() {
        options.onStdout(Buffer.from('{"ok":true}\n'))
        queueMicrotask(() => controller.abort())
      } } }, done: new Promise(() => {}), assertHealthy() {}, async stop() { exited = true } }
    } }
    try {
      await expect(launch.deliver(io, 12345)).rejects.toMatchObject({ reason: 'stopped' })
      expect(exited).toBe(true)
    } finally { await launch.close() }
  })
  it('模拟拒绝助手成功后的第二行或额外输出', async () => {
    const launch = await createWorkBuddyLaunch({ install })
    const io = { signal: new AbortController().signal, spawn(_argv: any, options: any) {
      let finish: (value: unknown) => void
      const done = new Promise(resolve => { finish = resolve })
      return { process: { stdin: { end() {
        options.onStdout(Buffer.from('{"ok":true}\n'))
        options.onStdout(Buffer.from('SIMULATED EXTRA OUTPUT\n'))
        finish({ exitCode: 0 })
      } } }, done, assertHealthy() {}, async stop() {} }
    } }
    try { await expect(launch.deliver(io, 12345)).rejects.toMatchObject({ reason: 'helper-result-invalid' }) }
    finally { await launch.close() }
  })
})
