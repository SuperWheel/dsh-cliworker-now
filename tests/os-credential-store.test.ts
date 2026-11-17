import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCipheriv, createHash, createHmac, hkdfSync, randomBytes, scryptSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, win32 } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
// 模拟：the real scrypt, optionally held back by a test to observe queueing and cancellation.
const derivation = vi.hoisted(() => ({ calls: 0, running: 0, peak: 0, gate: undefined as Promise<void> | undefined }))
vi.mock('node:crypto', async (original) => {
  const actual = await original<typeof import('node:crypto')>()
  return {
    ...actual,
    scrypt: (password: any, salt: any, length: number, options: any, callback: (error: Error | null, key: Buffer) => void) => {
      derivation.calls++
      derivation.peak = Math.max(derivation.peak, ++derivation.running)
      void (derivation.gate ?? Promise.resolve()).then(() =>
        actual.scrypt(password, salt, length, options, (error, key) => { derivation.running--; callback(error, key) }))
    },
  }
})
import {
  OsCredentialStoreError,
  backgroundCredentialRead,
  decodeMacSecurityHex,
  explicitCredentialRead,
  installOsCredentialStore,
  installedOsSecretReader,
  keyringHomeDigest,
  readGenericPassword,
  rustCanonicalPath,
  windowsCredentialTarget,
} from '../src/host/os-credential-store.ts'
import { decryptAgeScrypt, readCodexKeyringAuth } from '../src/host/codex-auth-store.ts'
import { decodeZCodeCredentials } from '../src/host/zcode-credentials.ts'
import { TRAE_KEYRING_SERVICES } from '../src/host/traecn-accounts.ts'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'

// 模拟：every credential store below is a mocked process transport over synthetic
// values. No real keychain, Credential Manager, Secret Service, CLI or network.
type Spec = Parameters<ProcessBackend['spawn']>[0]
type Answer = { output?: string; exitCode?: number | null; hang?: boolean; cleanup?: boolean }
const roots: string[] = []
const releases: (() => unknown)[] = []
const signal = () => new AbortController().signal
const temp = (label: string) => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), `cwn-store-SIMULATED-${label}-`)))
  roots.push(root)
  return root
}
const write = (path: string, value: string | Buffer) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, value, { mode: 0o600 })
}
afterEach(async () => {
  await Promise.all(releases.splice(0).map((release) => release()))
  Object.assign(derivation, { calls: 0, running: 0, peak: 0, gate: undefined })
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function processBackend(answer: (spec: Spec) => Answer) {
  const children: { signal: AbortSignal; terminate: ReturnType<typeof vi.fn>; exited: boolean }[] = []
  const spawn = vi.fn((spec: Spec) => {
    const reply = answer(spec)
    if (reply.hang) {
      const stdout = new PassThrough()
      const done = new Promise<{ exitCode: number | null }>((finish) =>
        spec.signal!.addEventListener('abort', () => { stdout.end(); finish({ exitCode: null }) }, { once: true }))
      const child = { signal: spec.signal!, terminate: vi.fn(), exited: false }
      children.push(child)
      // The process range takes a moment to empty after termination.
      const waitForExit = vi.fn(async () => { await new Promise((r) => setTimeout(r, 25)); child.exited = true; return reply.cleanup !== false })
      return { stdout, stderr: Readable.from([]), done, terminate: child.terminate, waitForExit }
    }
    return {
      stdout: Readable.from([reply.output ?? '']),
      stderr: Readable.from(['SIMULATED store diagnostic']),
      done: Promise.resolve({ exitCode: reply.exitCode ?? 0 }),
      terminate: vi.fn(),
      waitForExit: vi.fn(async () => reply.cleanup !== false),
    }
  }) as unknown as ProcessBackend['spawn'] & ReturnType<typeof vi.fn>
  return { resolveExecutable: vi.fn(), spawn, children } satisfies ProcessBackend & { children: unknown }
}
/** A synthetic store for whichever platform the test runs on; `false` is an unreadable item. */
function store(items: Record<string, string | false>) {
  const reads: string[] = []
  const backend = processBackend(({ argv }) => {
    let service: string, account: string
    if (argv[0] === '/usr/bin/security') [service, account] = [argv[3]!, argv[5]!]
    else if (argv[0] === 'secret-tool') [service, account] = [argv[3]!, argv[5]!]
    else {
      const target = Buffer.from(argv.at(-1)!, 'base64url').toString('utf8')
      // These synthetic accounts contain no dots. Decode the native target even
      // when the item is absent, so query evidence does not depend on its value.
      const separator = target.indexOf('.')
      expect(separator).toBeGreaterThan(0)
      ;[service, account] = [target.slice(separator + 1), target.slice(0, separator)]
    }
    reads.push(`${service} ${account}`)
    const value = items[`${service}\n${account}`]
    const windows = argv[0] !== '/usr/bin/security' && argv[0] !== 'secret-tool'
    if (value === false) return { exitCode: windows ? 1 : 51, output: windows ? '{"state":"unavailable"}' : '' }
    if (value === undefined)
      return windows ? { output: '{"state":"missing"}' } : { exitCode: argv[0] === 'secret-tool' ? 1 : 44 }
    return windows
      ? { output: JSON.stringify({ state: 'found', blob: Buffer.from(value, 'utf16le').toString('base64') }) }
      : { output: `${value}\n` }
  })
  return { backend, reads }
}

describe('模拟：系统凭据库只读读取', () => {
  const query = { service: 'SIMULATED Service', account: 'cli|0123456789abcdef' }

  it('模拟：macOS 用参数数组读取，44 表示条目不存在', async () => {
    const found = processBackend(() => ({ output: 'SIMULATED-value\n' }))
    expect(await readGenericPassword(found, DEFAULT_CONFIG, query, signal(), { platform: 'darwin' })).toBe('SIMULATED-value')
    expect(vi.mocked(found.spawn).mock.calls[0]![0].argv).toEqual([
      '/usr/bin/security', 'find-generic-password', '-s', 'SIMULATED Service', '-a', 'cli|0123456789abcdef', '-w',
    ])
    const missing = processBackend(() => ({ exitCode: 44 }))
    expect(await readGenericPassword(missing, DEFAULT_CONFIG, { ...query, account: 'missing' }, signal(), { platform: 'darwin' })).toBeUndefined()
    // A missing item is an answer, not a failure: it is asked again.
    await readGenericPassword(missing, DEFAULT_CONFIG, { ...query, account: 'missing' }, signal(), { platform: 'darwin' })
    expect(missing.spawn).toHaveBeenCalledTimes(2)
  })

  it('模拟：拒绝后后台路径不再读取该条目，直到 Host 重启；失败不带任何内容', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const denied = processBackend(() => ({ exitCode: 51, output: 'SIMULATED-SECRET' }))
      const item = { ...query, account: 'denied' }
      const read = () => readGenericPassword(denied, DEFAULT_CONFIG, item, signal(), { platform: 'darwin' })
      const failure = await read().catch((error) => error)
      expect(failure).toBeInstanceOf(OsCredentialStoreError)
      expect(JSON.stringify([failure.message, failure.cause ?? null])).not.toMatch(/SIMULATED|denied/)
      // Unscoped and background reads never reach the keychain again, however long the Host runs.
      for (const hours of [0, 1, 24, 24 * 30]) {
        vi.setSystemTime(Date.now() + hours * 3_600_000)
        await expect(read()).rejects.toBeInstanceOf(OsCredentialStoreError)
        await expect(backgroundCredentialRead(read)).rejects.toBeInstanceOf(OsCredentialStoreError)
        // An explicit entry point reached from background work stays background.
        await expect(backgroundCredentialRead(() => explicitCredentialRead(read))).rejects.toBeInstanceOf(OsCredentialStoreError)
      }
      expect(denied.spawn).toHaveBeenCalledOnce()
      // Another item is unaffected.
      await expect(readGenericPassword(denied, DEFAULT_CONFIG, { ...query, account: 'other' }, signal(), { platform: 'darwin' }))
        .rejects.toBeInstanceOf(OsCredentialStoreError)
      expect(denied.spawn).toHaveBeenCalledTimes(2)
      // A Host restart (release of the installation) forgets the denial.
      await installOsCredentialStore(denied, DEFAULT_CONFIG)()
      await expect(read()).rejects.toBeInstanceOf(OsCredentialStoreError)
      expect(denied.spawn).toHaveBeenCalledTimes(3)
    } finally { vi.useRealTimers() }
  })

  it('模拟：用户主动操作可重试一次，同一次操作的多次读取只询问一次，成功后恢复后台读取', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      let answer: Answer = { exitCode: 51 }
      const backend = processBackend(() => answer)
      const item = { ...query, account: 'retry' }
      const read = () => readGenericPassword(backend, DEFAULT_CONFIG, item, signal(), { platform: 'darwin' })
      await expect(read()).rejects.toBeInstanceOf(OsCredentialStoreError)
      vi.setSystemTime(Date.now() + 60_000)
      // One user action reads the binding several times: a single new attempt.
      await expect(explicitCredentialRead(async () => { await read().catch(() => undefined); return read() }))
        .rejects.toBeInstanceOf(OsCredentialStoreError)
      await expect(explicitCredentialRead(read)).rejects.toBeInstanceOf(OsCredentialStoreError)
      expect(backend.spawn).toHaveBeenCalledTimes(2)
      // Still denied: background stays suppressed.
      vi.setSystemTime(Date.now() + 3_600_000)
      await expect(read()).rejects.toBeInstanceOf(OsCredentialStoreError)
      expect(backend.spawn).toHaveBeenCalledTimes(2)
      // The next user action asks again; "Always Allow" lifts the suppression for everyone.
      answer = { output: 'SIMULATED-value\n' }
      expect(await explicitCredentialRead(read)).toBe('SIMULATED-value')
      expect(await read()).toBe('SIMULATED-value')
      expect(await backgroundCredentialRead(read)).toBe('SIMULATED-value')
      expect(backend.spawn).toHaveBeenCalledTimes(5)
    } finally { vi.useRealTimers() }
  })

  it('模拟：条目不存在不是拒绝，后台照常再读；非 macOS 的失败也不抑制', async () => {
    const missing = processBackend(() => ({ exitCode: 44 }))
    const item = { ...query, account: 'absent' }
    for (let attempt = 0; attempt < 3; attempt++)
      expect(await backgroundCredentialRead(() => readGenericPassword(missing, DEFAULT_CONFIG, item, signal(), { platform: 'darwin' }))).toBeUndefined()
    expect(missing.spawn).toHaveBeenCalledTimes(3)
    const failing = processBackend(() => ({ exitCode: 1, output: '{"state":"unavailable"}' }))
    for (let attempt = 0; attempt < 2; attempt++)
      await expect(readGenericPassword(failing, DEFAULT_CONFIG, { ...query, account: 'w-fail' }, signal(), { platform: 'win32' }))
        .rejects.toBeInstanceOf(OsCredentialStoreError)
    expect(failing.spawn).toHaveBeenCalledTimes(2)
  })

  it('模拟：等待超时按读取失败处理，调用方取消则原样抛出', async () => {
    const hanging = processBackend(() => ({ hang: true }))
    await expect(readGenericPassword(hanging, DEFAULT_CONFIG, { ...query, account: 'prompt' }, signal(), { platform: 'darwin', timeoutMs: 30 }))
      .rejects.toBeInstanceOf(OsCredentialStoreError)
    // A timed-out prompt counts as a denial for background reads.
    await expect(readGenericPassword(hanging, DEFAULT_CONFIG, { ...query, account: 'prompt' }, signal(), { platform: 'darwin', timeoutMs: 30 }))
      .rejects.toBeInstanceOf(OsCredentialStoreError)
    expect(hanging.spawn).toHaveBeenCalledOnce()
    const control = new AbortController()
    const reading = readGenericPassword(hanging, DEFAULT_CONFIG, { ...query, account: 'cancelled' }, control.signal, { platform: 'darwin' })
    control.abort(new Error('SIMULATED cancel'))
    await expect(reading).rejects.toThrow('SIMULATED cancel')
    // A cancelled read is not a denial: nothing is suppressed.
    const again = processBackend(() => ({ output: 'value\n' }))
    expect(await readGenericPassword(again, DEFAULT_CONFIG, { ...query, account: 'cancelled' }, signal(), { platform: 'darwin' })).toBe('value')
  })

  it('模拟：进程范围未确认退出时不吞掉清理错误', async () => {
    const leaking = processBackend(() => ({ output: 'value\n', cleanup: false }))
    await expect(readGenericPassword(leaking, DEFAULT_CONFIG, { ...query, account: 'leak' }, signal(), { platform: 'darwin' }))
      .rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
  })

  it('模拟：Windows 按 <account>.<service> 目标名读取 UTF-16LE 凭据', async () => {
    expect(windowsCredentialTarget(query)).toBe('cli|0123456789abcdef.SIMULATED Service')
    const blob = (text: string) => Buffer.from(text, 'utf16le').toString('base64')
    const found = processBackend(() => ({ output: JSON.stringify({ state: 'found', blob: blob('模拟-value {"a":1}') }) }))
    expect(await readGenericPassword(found, DEFAULT_CONFIG, query, signal(), { platform: 'win32' })).toBe('模拟-value {"a":1}')
    const argv = vi.mocked(found.spawn).mock.calls[0]![0].argv
    // Process-local Bypass: the default Restricted policy would refuse the unsigned helper.
    expect(argv.slice(1, 7)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'])
    expect(argv).toHaveLength(9)
    expect(argv[0]).toMatch(/powershell\.exe$/)
    expect(argv[7]).toMatch(/windows-credential-read\.ps1$/)
    expect(Buffer.from(argv[8]!, 'base64url').toString('utf8')).toBe('cli|0123456789abcdef.SIMULATED Service')
    expect(argv[8]).toMatch(/^[A-Za-z0-9_-]+$/)
    const missing = processBackend(() => ({ output: '{"state":"missing"}' }))
    expect(await readGenericPassword(missing, DEFAULT_CONFIG, { ...query, account: 'w-missing' }, signal(), { platform: 'win32' })).toBeUndefined()
    for (const [account, answer] of Object.entries({
      'w-unavailable': { output: '{"state":"unavailable"}', exitCode: 1 },
      'w-odd': { output: JSON.stringify({ state: 'found', blob: Buffer.from('abc').toString('base64') }) },
      'w-shape': { output: '{"state":"found"}' },
      'w-text': { output: 'SIMULATED-SECRET not json' },
    })) {
      const failure = await readGenericPassword(processBackend(() => answer), DEFAULT_CONFIG, { ...query, account }, signal(), { platform: 'win32' })
        .catch((error) => error)
      expect(failure).toBeInstanceOf(OsCredentialStoreError)
      expect(failure.message).not.toContain('SIMULATED')
    }
  })

  it('模拟：Linux 通过 secret-tool 按 service/username 属性读取', async () => {
    const found = processBackend(() => ({ output: 'SIMULATED-value\n' }))
    expect(await readGenericPassword(found, DEFAULT_CONFIG, query, signal(), { platform: 'linux' })).toBe('SIMULATED-value')
    expect(vi.mocked(found.spawn).mock.calls[0]![0].argv).toEqual(
      ['secret-tool', 'lookup', 'service', 'SIMULATED Service', 'username', 'cli|0123456789abcdef'])
    const missing = processBackend(() => ({ exitCode: 1 }))
    expect(await readGenericPassword(missing, DEFAULT_CONFIG, { ...query, account: 'l-missing' }, signal(), { platform: 'linux' })).toBeUndefined()
  })

  it('模拟：不合法的名称与不支持的平台直接失败，不启动进程', async () => {
    const backend = processBackend(() => ({ output: 'value\n' }))
    for (const bad of [{ service: '', account: 'a' }, { service: 's', account: 'a\nb' }, { service: 's', account: 'x'.repeat(513) }])
      await expect(readGenericPassword(backend, DEFAULT_CONFIG, bad, signal(), { platform: 'darwin' })).rejects.toBeInstanceOf(OsCredentialStoreError)
    await expect(readGenericPassword(backend, DEFAULT_CONFIG, query, signal(), { platform: 'freebsd' })).rejects.toBeInstanceOf(OsCredentialStoreError)
    expect(backend.spawn).not.toHaveBeenCalled()
  })

  it('模拟：账号名摘要与 Rust canonicalize 的路径文本一致', async () => {
    const home = temp('digest')
    expect(await keyringHomeDigest(home, 'darwin')).toBe(createHash('sha256').update(home).digest('hex').slice(0, 16))
    // A path that does not exist is hashed as given, like `unwrap_or_else(|_| codex_home.to_path_buf())`.
    expect(await rustCanonicalPath(join(home, 'missing'), 'darwin')).toBe(join(home, 'missing'))
    // Native Windows fixtures have a drive path; Node drops the verbatim prefix
    // that Rust canonicalize retains. On POSIX this is a simulated drive path.
    const windowsHome = process.platform === 'win32' ? win32.toNamespacedPath(realpathSync(home)) : `\\\\?\\${home}`
    expect(await rustCanonicalPath(home, 'win32')).toBe(windowsHome)
    expect(await keyringHomeDigest(home, 'win32')).toBe(createHash('sha256').update(windowsHome).digest('hex').slice(0, 16))
    expect(await rustCanonicalPath(join(home, 'missing'), 'win32')).toBe(join(home, 'missing'))
    expect(decodeMacSecurityHex(Buffer.from('{"名":"模拟"}').toString('hex'))).toBe('{"名":"模拟"}')
    expect(decodeMacSecurityHex('{"plain":1}')).toBe('{"plain":1}')
  })
})

describe('模拟：ZCode enc:v2:os 经系统凭据库解密', () => {
  const values = { 'oauth:active_provider': 'zai', 'oauth:zai:access_token': 'SIMULATED-OAUTH' }
  function record(key: Buffer) {
    const fingerprint = createHash('sha256').update(key).digest('hex').slice(0, 24)
    return Object.fromEntries(Object.entries(values).map(([name, value]) => {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return [name, `enc:v2:os:${fingerprint}:${[iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join('.')}`]
    }))
  }
  const fixture = () => {
    const root = temp('zcode'), credentials = join(root, '.zcode/v2/credentials.json'), key = randomBytes(32)
    const raw = record(key)
    write(credentials, JSON.stringify(raw))
    const item = `ZCode Credential Encryption\n${createHash('sha256').update(resolve(credentials)).digest('hex')}`
    return { credentials, key, raw, item }
  }

  it('模拟：Host 安装读取器后按原生服务名和路径摘要取密钥并解密', async () => {
    const f = fixture(), s = store({ [f.item]: f.key.toString('base64url') })
    // Not installed: fail closed without starting a process.
    await expect(decodeZCodeCredentials(f.raw, f.credentials, { env: {} })).rejects.toMatchObject({ state: 'unavailable' })
    releases.push(installOsCredentialStore(s.backend, DEFAULT_CONFIG))
    expect(await decodeZCodeCredentials(f.raw, f.credentials, { env: {} })).toEqual(values)
    expect(s.reads).toEqual([f.item.replace('\n', ' ')])
    await releases.pop()!()
    expect(installedOsSecretReader()).toBeUndefined()
    await expect(decodeZCodeCredentials(f.raw, f.credentials, { env: {} })).rejects.toMatchObject({ state: 'unavailable' })
    expect(s.backend.spawn).toHaveBeenCalledOnce()
  })

  it.each(['missing', 'denied', 'wrong-key', 'malformed'] as const)('模拟：密钥%s时为 unavailable 而不是未登录', async (kind) => {
    const f = fixture()
    const s = store(kind === 'missing' ? {} : {
      [f.item]: kind === 'denied' ? false : kind === 'wrong-key' ? randomBytes(32).toString('base64url') : 'SIMULATED-not-a-key',
    })
    releases.push(installOsCredentialStore(s.backend, DEFAULT_CONFIG))
    const failure = await decodeZCodeCredentials(f.raw, f.credentials, { env: {} }).catch((error) => error)
    expect(failure).toMatchObject({ state: 'unavailable' })
    expect(failure.message).not.toMatch(/SIMULATED|enc:/)
    expect(s.backend.spawn).toHaveBeenCalledOnce()
  })

  it('模拟：钥匙串询问超时为 unavailable', async () => {
    const f = fixture(), hanging = processBackend(() => ({ hang: true }))
    releases.push(installOsCredentialStore(hanging, DEFAULT_CONFIG, { timeoutMs: 30 }))
    await expect(decodeZCodeCredentials(f.raw, f.credentials, { env: {} })).rejects.toMatchObject({ state: 'unavailable' })
  })

  it('模拟：Host 释放时中止仍在进行的读取，并等其进程范围清理完才返回', async () => {
    const f = fixture(), hanging = processBackend(() => ({ hang: true }))
    const release = installOsCredentialStore(hanging, DEFAULT_CONFIG)
    // ZCode's preparation path passes no signal of its own.
    const decoding = decodeZCodeCredentials(f.raw, f.credentials, { env: {} }).catch((error) => error)
    await vi.waitFor(() => expect(hanging.children).toHaveLength(1))
    const child = hanging.children[0]!
    expect(child.signal.aborted).toBe(false)
    await release()
    expect(child.signal.aborted).toBe(true)
    expect(child.terminate).toHaveBeenCalledOnce()
    expect(child.exited).toBe(true)
    expect(installedOsSecretReader()).toBeUndefined()
    expect(await decoding).toMatchObject({ state: 'unavailable' })
    // The Host's own shutdown is not a keychain denial.
    releases.push(installOsCredentialStore(store({ [f.item]: f.key.toString('base64url') }).backend, DEFAULT_CONFIG))
    expect(await decodeZCodeCredentials(f.raw, f.credentials, { env: {} })).toEqual(values)
  })

  it('模拟：释放时不掩盖未确认的进程清理', async () => {
    const f = fixture(), leaking = processBackend(() => ({ hang: true, cleanup: false }))
    const release = installOsCredentialStore(leaking, DEFAULT_CONFIG)
    const decoding = decodeZCodeCredentials(f.raw, f.credentials, { env: {} }).catch((error) => error)
    await vi.waitFor(() => expect(leaking.children).toHaveLength(1))
    await expect(release()).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
    expect(await decoding).toBeInstanceOf(ProcessCleanupUnconfirmedError)
  })

  it('模拟：进程清理未确认时原样上抛', async () => {
    const f = fixture(), leaking = processBackend(() => ({ output: `${f.key.toString('base64url')}\n`, cleanup: false }))
    releases.push(installOsCredentialStore(leaking, DEFAULT_CONFIG))
    await expect(decodeZCodeCredentials(f.raw, f.credentials, { env: {} })).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
  })
})

describe('模拟：TRAE CN 按 cli_auth_credentials_store 读取登录', () => {
  const auth = {
    auth_mode: 'trae',
    trae: { user_id: 'SIMULATED-user', region: 'cn', login_method: 'personal', credential_kind: 'oauth',
      endpoints: { api_base_url: 'https://api.example.invalid' }, access_token: 'SIMULATED-access-secret', refresh_token: 'SIMULATED-refresh-secret' },
  }
  let shared: string, project: string, account: string
  beforeEach(async () => {
    shared = temp('trae')
    project = join(shared, 'project')
    mkdirSync(join(shared, 'cli'), { recursive: true })
    mkdirSync(project)
    vi.stubEnv('TRAE_HOME', shared)
    for (const name of ['TRAECLI_HOME', 'TRAECLI_HOST', 'TRAECLI_PERSONAL_ACCESS_TOKEN']) vi.stubEnv(name, '')
    account = `cli|${await keyringHomeDigest(join(shared, 'cli'))}`
  })
  const mode = (text: string) => write(join(shared, 'traecli.toml'), text)
  const file = (value: unknown = auth) => write(join(shared, 'cli/auth.json'), JSON.stringify(value))
  const binding = (backend: ProcessBackend) => readCliAccountBinding('traecn', backend, DEFAULT_CONFIG, project, signal())
  const item = (service: (typeof TRAE_KEYRING_SERVICES)[number], value: unknown = auth) =>
    ({ [`${service}\n${account}`]: JSON.stringify(value) })

  it('模拟：同一份登录在 keyring 与 file 模式下绑定相同，且不含密钥', async () => {
    file()
    const none = store({})
    const fromFile = await binding(none.backend)
    expect(none.backend.spawn).not.toHaveBeenCalled()
    rmSync(join(shared, 'cli/auth.json'))
    mode('cli_auth_credentials_store = "keyring"\n')
    // Rotated tokens in the keyring copy: identity fields alone decide the binding.
    const keyring = store(item('Codex Auth', { ...auth, trae: { ...auth.trae, access_token: 'SIMULATED-rotated' } }))
    const fromKeyring = await binding(keyring.backend)
    expect(fromKeyring).toBe(fromFile)
    expect(fromKeyring).not.toMatch(/SIMULATED/)
    expect(keyring.reads).toEqual([`Codex Auth ${account}`])
    const other = store(item('Codex Auth', { ...auth, trae: { ...auth.trae, user_id: 'SIMULATED-other-user' } }))
    expect(await binding(other.backend)).not.toBe(fromFile)
  })

  it('模拟：先查 Codex Auth，再查 TRAE CLI Auth', async () => {
    file()
    const fromFile = await binding(store({}).backend)
    mode('cli_auth_credentials_store = "keyring"\n')
    const second = store(item('TRAE CLI Auth'))
    expect(await binding(second.backend)).toBe(fromFile)
    expect(second.reads).toEqual([`Codex Auth ${account}`, `TRAE CLI Auth ${account}`])
    const both = store({ ...item('Codex Auth'), ...item('TRAE CLI Auth', { ...auth, trae: { ...auth.trae, user_id: 'SIMULATED-stale' } }) })
    expect(await binding(both.backend)).toBe(fromFile)
    expect(both.reads).toEqual([`Codex Auth ${account}`])
  })

  it('模拟：keyring 模式下条目不存在即「TRAE CN 未登录」，不回退到残留的 auth.json', async () => {
    file()
    mode('cli_auth_credentials_store = "keyring"\n')
    const empty = store({})
    await expect(binding(empty.backend)).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED', message: 'TRAE CN 未登录' })
    expect(empty.reads).toEqual([`Codex Auth ${account}`, `TRAE CLI Auth ${account}`])
    // Unreadable or undecodable is "cannot confirm", never "signed out".
    for (const items of [{ [`Codex Auth\n${account}`]: false as const }, { [`Codex Auth\n${account}`]: 'SIMULATED-SECRET not json' }]) {
      const failure = await binding(store(items).backend).catch((error) => error)
      expect(failure).toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
      expect(failure.message).not.toMatch(/未登录|SIMULATED/)
      await installOsCredentialStore(store({}).backend, DEFAULT_CONFIG)() // a Host restart forgets the denial
    }
  })

  it('模拟：auto 先读钥匙串，条目不存在或读不到时回退 auth.json', async () => {
    file()
    const fromFile = await binding(store({}).backend)
    mode('cli_auth_credentials_store = "auto"\n')
    const keyringAuth = { ...auth, trae: { ...auth.trae, user_id: 'SIMULATED-keyring-user' } }
    const preferred = store(item('Codex Auth', keyringAuth))
    const fromKeyring = await binding(preferred.backend)
    expect(fromKeyring).not.toBe(fromFile)
    const empty = store({})
    expect(await binding(empty.backend)).toBe(fromFile)
    expect(empty.reads).toHaveLength(2)
    expect(await binding(store({ [`Codex Auth\n${account}`]: false }).backend)).toBe(fromFile)
    await installOsCredentialStore(store({}).backend, DEFAULT_CONFIG)()
    rmSync(join(shared, 'cli/auth.json'))
    await expect(binding(store({}).backend)).rejects.toMatchObject({ message: 'TRAE CN 未登录' })
    const unread = await binding(store({ [`Codex Auth\n${account}`]: false }).backend).catch((error) => error)
    expect(unread).toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
    expect(unread.message).not.toContain('未登录')
  })

  it.each([
    ['带引号的顶层键', `"cli_auth_credentials_store" = 'keyring' # store\n`, 'keyring'],
    ['Unicode 转义键', '"cli_auth_credentials_\\u0073tore" = "keyring"\n', 'keyring'],
    ['表内同名键不生效', '[notice]\ncli_auth_credentials_store = "keyring"\n', 'file'],
    ['数组表内同名键不生效', 'model = "x"\n[[models]]\n"cli_auth_credentials_store" = "keyring"\n', 'file'],
    ['多行字符串中的假键不生效', 'notice = """\ncli_auth_credentials_store = "keyring"\n"""\n', 'file'],
    ['显式 file', 'cli_auth_credentials_store = "file"\n', 'file'],
  ])('模拟：存储设置解析：%s', async (_label, toml, expected) => {
    file()
    const fromFile = await binding(store({}).backend)
    mode(toml)
    const s = store(item('Codex Auth', { ...auth, trae: { ...auth.trae, user_id: 'SIMULATED-keyring-user' } }))
    const result = await binding(s.backend)
    expect(result === fromFile).toBe(expected === 'file')
    expect(s.reads.length > 0).toBe(expected === 'keyring')
  })

  it('模拟：项目级 .trae/traecli.toml 覆盖用户级；ephemeral 视为未登录；非法值报错', async () => {
    file()
    const fromFile = await binding(store({}).backend)
    mode('cli_auth_credentials_store = "keyring"\n')
    write(join(project, '.trae/traecli.toml'), 'cli_auth_credentials_store = "file"\n')
    const s = store({})
    expect(await binding(s.backend)).toBe(fromFile)
    expect(s.backend.spawn).not.toHaveBeenCalled()
    write(join(project, '.trae/traecli.toml'), 'cli_auth_credentials_store = "ephemeral"\n')
    await expect(binding(s.backend)).rejects.toMatchObject({ message: 'TRAE CN 未登录' })
    write(join(project, '.trae/traecli.toml'), 'cli_auth_credentials_store = "SIMULATED-invalid"\n')
    const failure = await binding(s.backend).catch((error) => error)
    expect(failure).toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
    expect(failure.message).toContain('TRAE')
    expect(s.backend.spawn).not.toHaveBeenCalled()
  })

  it.runIf(process.platform === 'darwin')('模拟：security 以十六进制输出的非 ASCII 登录文档同样可读', async () => {
    const named = { ...auth, trae: { ...auth.trae, display: '模拟用户' } }
    file(named)
    const fromFile = await binding(store({}).backend)
    mode('cli_auth_credentials_store = "keyring"\n')
    const hex = store({ [`Codex Auth\n${account}`]: Buffer.from(JSON.stringify(named)).toString('hex') })
    expect(await binding(hex.backend)).toBe(fromFile)
  })
})

/** Test-only age v1 writer for one scrypt recipient (work factor 10), mirroring the format spec. */
function ageEncrypt(plaintext: Buffer, passphrase: string, workFactor = 10): Buffer {
  const fileKey = randomBytes(16), salt = randomBytes(16)
  const seal = (key: Buffer, nonce: Buffer, data: Buffer) => {
    const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 })
    return Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()])
  }
  const wrapKey = scryptSync(passphrase, Buffer.concat([Buffer.from('age-encryption.org/v1/scrypt'), salt]), 32,
    { N: 2 ** workFactor, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  const unpadded = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '')
  const header = `age-encryption.org/v1\n-> scrypt ${unpadded(salt)} ${workFactor}\n${unpadded(seal(wrapKey, Buffer.alloc(12), fileKey))}\n---`
  const mac = createHmac('sha256', Buffer.from(hkdfSync('sha256', fileKey, Buffer.alloc(0), 'header', 32))).update(header).digest()
  const nonce = randomBytes(16), payloadKey = Buffer.from(hkdfSync('sha256', fileKey, nonce, 'payload', 32))
  const chunks: Buffer[] = []
  for (let offset = 0, counter = 0; ; offset += 65536, counter++) {
    const last = offset + 65536 >= plaintext.length
    const chunkNonce = Buffer.alloc(12)
    chunkNonce.writeUIntBE(counter, 5, 6)
    chunkNonce[11] = last ? 1 : 0
    chunks.push(seal(payloadKey, chunkNonce, plaintext.subarray(offset, offset + 65536)))
    if (last) break
  }
  return Buffer.concat([Buffer.from(`${header} ${unpadded(mac)}\n`), nonce, ...chunks])
}

describe('模拟：Codex 钥匙串登录存储（rust-v0.169.0）', () => {
  const jwt = (sub: string) =>
    `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub, iss: 'https://synthetic.example', exp: 4e9 })).toString('base64url')}.synthetic`
  const auth = (sub = 'SIMULATED-codex', refresh = 'SIMULATED-refresh') => ({
    auth_mode: 'chatgpt',
    tokens: { access_token: jwt(sub), refresh_token: refresh, id_token: jwt(sub), account_id: 'SIMULATED-workspace' },
  })
  let home: string, project: string, digest: string
  beforeEach(async () => {
    home = temp('codex')
    project = join(home, 'project')
    mkdirSync(project)
    vi.stubEnv('CODEX_HOME', home)
    for (const name of ['CODEX_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_BASE_URL', 'CHATGPT_BASE_URL', 'CODEX_PROFILE'])
      vi.stubEnv(name, '')
    digest = await keyringHomeDigest(home)
  })
  const binding = (backend: ProcessBackend) => readCliAccountBinding('codex', backend, DEFAULT_CONFIG, project, signal())
  const configure = (mode: string, secrets: boolean | string) =>
    write(join(home, 'config.toml'), `cli_auth_credentials_store = "${mode}"\n${
      typeof secrets === 'string' ? secrets : `[features]\nsecret_auth_storage = ${secrets}\n`}`)
  const fileBinding = async (value: unknown = auth()) => {
    write(join(home, 'auth.json'), JSON.stringify(value))
    write(join(home, 'config.toml'), '')
    const none = store({})
    const result = await binding(none.backend)
    expect(none.backend.spawn).not.toHaveBeenCalled()
    return result
  }

  it('模拟：age 官方测试向量（C2SP CCTV age/testdata/scrypt）可解', async () => {
    const header = 'age-encryption.org/v1\n-> scrypt rF0/NwblUHHTpgQgRpe5CQ 10\ngUjEymFKMVXQEKdMMHL24oYexjE3TIC0O0zGSqJ2aUY\n--- IOXiQYStkoT1mvZW2tFOqZdhRVvj58egABx/sWfZQbc\n'
    const payload = Buffer.from(CCTV_SCRYPT_PAYLOAD, 'base64')
    const plain = await decryptAgeScrypt(Buffer.concat([Buffer.from(header), payload]), 'password')
    expect(createHash('sha256').update(plain).digest('hex')).toBe('013f54400c82da08037759ada907a8b864e97de81c088a182062c4b5622fd2ab')
    await expect(decryptAgeScrypt(Buffer.concat([Buffer.from(header), payload]), 'SIMULATED-wrong')).rejects.toBeInstanceOf(OsCredentialStoreError)
    // age refuses excessive work factors before deriving anything.
    await expect(decryptAgeScrypt(Buffer.concat([Buffer.from(header.replace(' 10\n', ' 23\n')), payload]), 'password'))
      .rejects.toBeInstanceOf(OsCredentialStoreError)
    // Round trip over more than one 64 KiB chunk with the test writer.
    const large = randomBytes(150_000)
    expect((await decryptAgeScrypt(ageEncrypt(large, 'p'), 'p')).equals(large)).toBe(true)
    expect((await decryptAgeScrypt(ageEncrypt(Buffer.alloc(0), 'p'), 'p')).length).toBe(0)
    const tampered = ageEncrypt(large, 'p')
    tampered[tampered.length - 1]! ^= 1
    await expect(decryptAgeScrypt(tampered, 'p')).rejects.toBeInstanceOf(OsCredentialStoreError)
  })

  it('模拟：scrypt 派生全局串行，排队中取消立即拒绝且不再启动，运行中取消立即返回并占位到结束', async () => {
    const sealed = ageEncrypt(Buffer.from('SIMULATED'), 'p')
    // Overlapping reads never derive at the same time.
    const all = await Promise.all([1, 2, 3].map(() => decryptAgeScrypt(sealed, 'p')))
    expect(all.map(String)).toEqual(['SIMULATED', 'SIMULATED', 'SIMULATED'])
    expect([derivation.calls, derivation.peak]).toEqual([3, 1])
    // Hold the running derivation; abort the running one and a queued one.
    let open!: () => void
    derivation.gate = new Promise<void>((resolve) => { open = resolve })
    const running = new AbortController(), queued = new AbortController()
    const first = decryptAgeScrypt(sealed, 'p', running.signal).catch((error) => error)
    const second = decryptAgeScrypt(sealed, 'p', queued.signal).catch((error) => error)
    const third = decryptAgeScrypt(sealed, 'p')
    await vi.waitFor(() => expect(derivation.calls).toBe(4))
    queued.abort(new Error('SIMULATED queued cancel'))
    running.abort(new Error('SIMULATED running cancel'))
    // Both callers are released while the native job is still held.
    expect(await second).toMatchObject({ message: 'SIMULATED queued cancel' })
    expect(await first).toMatchObject({ message: 'SIMULATED running cancel' })
    expect([derivation.calls, derivation.running]).toEqual([4, 1])
    open()
    expect(String(await third)).toBe('SIMULATED')
    // The cancelled queued job never started: 3 + the held one + the third.
    expect([derivation.calls, derivation.peak, derivation.running]).toEqual([5, 1, 0])
    // An excessive work factor in the unauthenticated header is refused before any derivation.
    const header = sealed.toString('latin1').replace(/^(.*\n-> scrypt \S+) 10\n/, '$1 21\n')
    await expect(decryptAgeScrypt(Buffer.from(header, 'latin1'), 'p')).rejects.toBeInstanceOf(OsCredentialStoreError)
    expect(derivation.calls).toBe(5)
  })

  it('模拟：加密文件后端的读取时限覆盖派生，超时按读不到处理', async () => {
    const passphrase = randomBytes(32).toString('base64')
    write(join(home, 'secrets/codex_auth.age'), ageEncrypt(Buffer.from(JSON.stringify({ version: 1, secrets: { 'global/CODEX_AUTH': JSON.stringify(auth()) } })), passphrase))
    const items = { [`codex\nsecrets|${digest}`]: passphrase }
    let open!: () => void
    derivation.gate = new Promise<void>((resolve) => { open = resolve })
    const started = Date.now()
    await expect(readCodexKeyringAuth(store(items).backend, DEFAULT_CONFIG, { root: home, secrets: true }, signal(), { secretsTimeoutMs: 40 }))
      .rejects.toBeInstanceOf(OsCredentialStoreError)
    expect(Date.now() - started).toBeLessThan(2_000)
    // The caller's own cancellation is passed through as such.
    const control = new AbortController()
    const reading = readCodexKeyringAuth(store(items).backend, DEFAULT_CONFIG, { root: home, secrets: true }, control.signal).catch((error) => error)
    await new Promise((resolve) => setTimeout(resolve, 20))
    control.abort(new Error('SIMULATED cancel'))
    expect(await reading).toMatchObject({ message: 'SIMULATED cancel' })
    open()
    derivation.gate = undefined
    expect(await readCodexKeyringAuth(store(items).backend, DEFAULT_CONFIG, { root: home, secrets: true }, signal())).toEqual(auth())
  })

  it('模拟：直接钥匙串条目（Codex Auth / cli|摘要）与 file 模式绑定相同', async () => {
    const file = await fileBinding()
    rmSync(join(home, 'auth.json'))
    for (const mode of ['keyring', 'auto']) {
      configure(mode, false)
      const s = store({ [`Codex Auth\ncli|${digest}`]: JSON.stringify(auth('SIMULATED-codex', 'SIMULATED-rotated')) })
      expect(await binding(s.backend)).toBe(file)
      expect(s.reads).toEqual([`Codex Auth cli|${digest}`])
      // Exactly one read-only store process; no Codex app-server, no refresh.
      expect(s.backend.spawn).toHaveBeenCalledOnce()
    }
    expect(await binding(store({ [`Codex Auth\ncli|${digest}`]: JSON.stringify(auth('SIMULATED-other')) }).backend)).not.toBe(file)
  })

  it.each([
    ['[features] 表', '[features]\nsecret_auth_storage = true\n'],
    ['根表点号键', 'features.secret_auth_storage = true\n'],
    ['内联表', 'features = { other = false, secret_auth_storage = true }\n'],
  ])('模拟：加密文件后端（secret_auth_storage，%s）与 file 模式绑定相同', async (_label, toml) => {
    const file = await fileBinding()
    rmSync(join(home, 'auth.json'))
    const passphrase = randomBytes(32).toString('base64')
    write(join(home, 'secrets/codex_auth.age'), ageEncrypt(Buffer.from(JSON.stringify({
      version: 1, secrets: { 'global/CODEX_AUTH': JSON.stringify(auth('SIMULATED-codex', 'SIMULATED-rotated')), 'global/OTHER': 'SIMULATED-unrelated' },
    })), passphrase))
    configure('keyring', toml)
    const s = store({ [`codex\nsecrets|${digest}`]: passphrase, [`Codex Auth\ncli|${digest}`]: JSON.stringify(auth('SIMULATED-stale-direct')) })
    expect(await binding(s.backend)).toBe(file)
    expect(s.reads).toEqual([`codex secrets|${digest}`])
  })

  it('模拟：加密文件后端读不到时报错；文件不存在按原生规则视为无登录', async () => {
    const file = await fileBinding()
    const passphrase = randomBytes(32).toString('base64')
    const sealed = ageEncrypt(Buffer.from(JSON.stringify({ version: 1, secrets: { 'global/CODEX_AUTH': JSON.stringify(auth('SIMULATED-secrets')) } })), passphrase)
    // No secrets file: native loads nothing from the keyring; auto then reads auth.json.
    configure('auto', true)
    const untouched = store({ [`codex\nsecrets|${digest}`]: passphrase })
    expect(await binding(untouched.backend)).toBe(file)
    expect(untouched.backend.spawn).not.toHaveBeenCalled()
    configure('keyring', true)
    await expect(binding(untouched.backend)).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
    write(join(home, 'secrets/codex_auth.age'), sealed)
    const fromSecrets = await binding(untouched.backend)
    expect(fromSecrets).not.toBe(file)
    // Missing or wrong passphrase, a newer file version, or a damaged file: an error in keyring mode …
    const failures: [Record<string, string | false>, Buffer][] = [
      [{}, sealed],
      [{ [`codex\nsecrets|${digest}`]: randomBytes(32).toString('base64') }, sealed],
      [{ [`codex\nsecrets|${digest}`]: false }, sealed],
      [{ [`codex\nsecrets|${digest}`]: passphrase }, ageEncrypt(Buffer.from(JSON.stringify({ version: 2, secrets: {} })), passphrase)],
      [{ [`codex\nsecrets|${digest}`]: passphrase }, Buffer.from('SIMULATED-SECRET not an age file')],
    ]
    for (const [items, bytes] of failures) {
      write(join(home, 'secrets/codex_auth.age'), bytes)
      await installOsCredentialStore(store({}).backend, DEFAULT_CONFIG)() // a Host restart forgets the denial
      configure('keyring', true)
      const failure = await binding(store(items).backend).catch((error) => error)
      expect(failure).toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
      expect(failure.message).not.toContain('SIMULATED')
      // … and native auto's file fallback in auto mode.
      await installOsCredentialStore(store({}).backend, DEFAULT_CONFIG)()
      configure('auto', true)
      expect(await binding(store(items).backend)).toBe(file)
    }
    // The login was removed from the secrets file: no keyring login.
    write(join(home, 'secrets/codex_auth.age'), ageEncrypt(Buffer.from(JSON.stringify({ version: 1, secrets: {} })), passphrase))
    configure('keyring', true)
    await expect(binding(untouched.backend)).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
  })

  it('模拟：后端默认值随平台（Windows 为加密文件，其余为直接条目），项目层可覆盖', async () => {
    const direct = { [`Codex Auth\ncli|${digest}`]: JSON.stringify(auth()) }
    const query = { root: home, secrets: false }
    expect(await readCodexKeyringAuth(store(direct).backend, DEFAULT_CONFIG, query, signal())).toEqual(auth())
    expect(await readCodexKeyringAuth(store({}).backend, DEFAULT_CONFIG, query, signal())).toBeUndefined()
    const file = await fileBinding()
    rmSync(join(home, 'auth.json'))
    write(join(home, 'config.toml'), 'cli_auth_credentials_store = "keyring"\n')
    const s = store(direct)
    if (process.platform === 'win32') await expect(binding(s.backend)).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
    else expect(await binding(s.backend)).toBe(file)
    // A project layer flips the backend for that project only.
    write(join(project, '.codex/config.toml'), `[features]\nsecret_auth_storage = ${process.platform !== 'win32'}\n`)
    const flipped = store(direct)
    if (process.platform === 'win32') expect(await binding(flipped.backend)).toBe(file)
    else await expect(binding(flipped.backend)).rejects.toMatchObject({ code: 'CLI_OWN_ACCOUNT_REQUIRED' })
  })
})

// The 35-byte payload of the public C2SP CCTV vector `age/testdata/scrypt` (passphrase "password").
const CCTV_SCRYPT_PAYLOAD = 'GzXG5ofdANo6w3msn3QsIf0YWhuePe1znRSsappQEk24Ztg='
