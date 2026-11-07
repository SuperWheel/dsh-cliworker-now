import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { WorkerRuntime } from './fixtures/legacy-runtime.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { catalogFor } from '../src/host/adapters.ts'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import { CLI_IDS, type Preference } from '../src/shared/types.ts'

// Synthetic account metadata and process streams, with the real authorization/runtime guards.
vi.mock('../src/host/adapters.ts', async (original) => ({
  ...(await original<object>()),
  catalogFor: vi.fn(),
}))
vi.mock('../src/host/cli-account-binding.ts', () => ({ readCliAccountBinding: vi.fn() }))
const claudeRouteFixture = vi.hoisted(() => ({ selected: undefined as any }))
vi.mock('../src/host/claude-own-route.ts', async (original) => ({
  ...(await original<typeof import('../src/host/claude-own-route.ts')>()),
  readClaudeOwnRoute: async () => claudeRouteFixture.selected,
}))

const cleanup: (() => void | Promise<void>)[] = []
let account: string | undefined
let models = ['synthetic/model']
let efforts = ['low'] as ('low' | 'high')[]
const preference: Preference = { cli: 'antigravity', model: 'synthetic/model', effort: 'low' }

beforeEach(() => {
  claudeRouteFixture.selected = undefined
  account = 'synthetic-account-a'
  models = ['synthetic/model']
  efforts = ['low']
  vi.mocked(readCliAccountBinding).mockImplementation(async (_cli, _backend, _config, _project, signal) => {
    signal.throwIfAborted()
    if (!account) throw new Error('本 CLI 未登录')
    return account
  })
  vi.mocked(catalogFor).mockImplementation(async (cli) => ({
    cli,
    notice: 'Synthetic current account scope',
    models: models.map((id) => ({ id, label: id, efforts })),
  }))
})
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.resetAllMocks()
  vi.unstubAllEnvs()
})

function setup() {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-own-account-synthetic-')))
  cleanup.push(() => rmSync(project, { recursive: true, force: true }))
  const finishes: (() => void)[] = []
  const backend: ProcessBackend = {
    resolveExecutable: vi.fn(async () => '/synthetic/agy'),
    spawn: vi.fn(() => {
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      let resolve!: (value: { exitCode: number }) => void
      const done = new Promise<{ exitCode: number }>((yes) => {
        resolve = yes
      })
      const finish = () => {
        stdout.end(
          JSON.stringify({ event: 'init', conversation_id: 'synthetic-session' }) +
            '\n' +
            JSON.stringify({
              event: 'result',
              result: { conversation_id: 'synthetic-session', status: 'SUCCESS', response: 'Synthetic only' },
            }) +
            '\n',
        )
        stderr.end()
        resolve({ exitCode: 0 })
      }
      finishes.push(finish)
      return {
        stdout,
        stderr,
        done,
        terminate: vi.fn(),
        waitForExit: vi.fn(async () => true),
      } as unknown as SubprocessHandle
    }),
  }
  const storage = new WorkerStorage(join(project, 'state'))
  const runtime = new WorkerRuntime(storage, backend, { ...DEFAULT_CONFIG, maxConcurrent: 1 })
  cleanup.push(() => runtime.close())
  const submit = (selection = preference, previousId?: string) =>
    runtime.submit(
      'synthetic-parent',
      project,
      'Synthetic account task',
      'Synthetic prompt',
      selection,
      'accept-edits',
      previousId,
    )
  return { project, backend, runtime, storage, finishes, submit }
}

it.each(['win32', 'darwin'] as const)('AGY background task scopes updater suppression on %s without changing the parent', async system => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { ...platform, value: system })
  vi.stubEnv('AGY_CLI_DISABLE_AUTO_UPDATE', 'false')
  const { backend, finishes, submit } = setup()
  const task = submit()
  try {
    await vi.waitFor(() => expect(backend.spawn).toHaveBeenCalledOnce())
    const launch = vi.mocked(backend.spawn).mock.calls[0]![0]
    expect(launch.env).toEqual(system === 'win32' ? { AGY_CLI_DISABLE_AUTO_UPDATE: 'true' } : {})
    expect(launch.argv).toContain('--print')
    expect(launch.argv).toContain('synthetic/model')
    expect(process.env.AGY_CLI_DISABLE_AUTO_UPDATE).toBe('false')
  } finally {
    for (const finish of finishes) finish()
    await task.done
    Object.defineProperty(process, 'platform', platform)
  }
  expect((await task.done).status).toBe('completed')
})

it('rejects MiMo config interpolation before worker spawn even when metadata authorization succeeds', async () => {
  const { project, backend, submit } = setup()
  vi.stubEnv('MIMOCODE_HOME', join(project, 'mimo'))
  writeFileSync(
    join(project, 'mimocode.json'),
    JSON.stringify({ instructions: ['{file:~/.claude/.credentials.json}'] }),
  )
  expect(await submit({ ...preference, cli: 'mimo' }).done).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('MiMo 配置含外部引用'),
  })
  expect(backend.spawn).not.toHaveBeenCalled()
})

it.each(CLI_IDS)(
  '%s cannot start or restore a historical account from an unrelated credential',
  async (cli) => {
    const { backend, submit } = setup()
    account = undefined
    const task = submit({ ...preference, cli, ...(cli === 'traecn' ? { effort: 'default' as const } : {}) })
    expect(await task.done).toMatchObject({ status: 'failed', error: expect.stringContaining('未登录') })
    expect(backend.spawn).not.toHaveBeenCalled()
    expect(catalogFor).not.toHaveBeenCalled()
  },
)

it.each([false, true])('preserves split UTF-8 stderr diagnostics, including an incomplete tail: %s', async incomplete => {
  const { backend, storage, submit } = setup()
  const diagnostic = '鉴权失败：账号未登录 🐱'
  const bytes = Buffer.concat([Buffer.from(diagnostic), ...(incomplete ? [Buffer.from([0xe4, 0xb8])] : [])])
  vi.mocked(backend.spawn).mockImplementation(() => ({
    stdout: Readable.from([]),
    stderr: Readable.from((async function* () {
      for (const byte of bytes) {
        yield Buffer.from([byte])
        await new Promise(resolve => setImmediate(resolve))
      }
    })()),
    done: Promise.resolve({ exitCode: 1 }),
    terminate: vi.fn(),
    waitForExit: vi.fn(async () => true),
  }) as unknown as SubprocessHandle)
  const task = submit()
  expect(await task.done).toMatchObject({
    status: 'failed',
    error: `Error: CLI exited with 1: ${diagnostic}${incomplete ? '�' : ''}`,
  })
  expect(readFileSync(storage.rawPath(task.worker) + '.stderr')).toEqual(bytes)
})

it.each(['logout', 'model', 'effort'])('rechecks %s after waiting in the queue', async (change) => {
  const { backend, finishes, submit } = setup()
  const first = submit()
  await vi.waitFor(() => expect(backend.spawn).toHaveBeenCalledTimes(1))
  const second = submit()
  // Admission captures A; the queued turn must not adopt a later account or scope.
  await Promise.resolve()
  if (change === 'logout') account = undefined
  if (change === 'model') models = ['synthetic/another-model']
  if (change === 'effort') efforts = ['high']
  finishes[0]!()
  expect((await first.done).status).toBe('completed')
  expect((await second.done).status).toBe('failed')
  expect(backend.spawn).toHaveBeenCalledTimes(1)
})

it('starts a queued new task under the account signed in after it waited, without a notice', async () => {
  const { backend, storage, finishes, submit } = setup()
  const first = submit()
  await vi.waitFor(() => expect(backend.spawn).toHaveBeenCalledTimes(1))
  const second = submit()
  await Promise.resolve()
  account = 'synthetic-account-b'
  finishes[0]!()
  expect((await first.done).status).toBe('completed')
  await vi.waitFor(() => expect(backend.spawn).toHaveBeenCalledTimes(2))
  finishes[1]!()
  expect((await second.done).status).toBe('completed')
  expect(storage.accountBinding(second.worker.id)).toBe('synthetic-account-b')
  expect(storage.history(second.worker.id).filter((event) => event.text?.includes('账号'))).toEqual([])
})

it('authorizes again once, silently, when the account changes during launch preparation', async () => {
  const { backend, storage, finishes, submit } = setup()
  vi.mocked(backend.resolveExecutable).mockImplementation(async () => {
    account = 'synthetic-account-b'
    return '/synthetic/agy'
  })
  const task = submit()
  await vi.waitFor(() => expect(backend.spawn).toHaveBeenCalledTimes(1))
  finishes[0]!()
  expect((await task.done).status).toBe('completed')
  expect(storage.accountBinding(task.worker.id)).toBe('synthetic-account-b')
  expect(storage.history(task.worker.id).filter((event) => event.text?.includes('账号'))).toEqual([])
})

it('still sends no prompt when the account keeps changing during launch preparation', async () => {
  const { backend, submit } = setup()
  let flips = 0
  vi.mocked(backend.resolveExecutable).mockImplementation(async () => {
    account = `synthetic-account-${++flips}`
    return '/synthetic/agy'
  })
  expect(await submit().done).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('账号已变更'),
  })
  expect(flips).toBe(2)
  expect(backend.spawn).not.toHaveBeenCalled()
})

it('continues legacy history whose original account was never recorded under the current account', async () => {
  const { backend, storage, finishes, submit } = setup()
  const first = submit()
  await vi.waitFor(() => expect(backend.spawn).toHaveBeenCalledTimes(1))
  finishes[0]!()
  const completed = await first.done
  rmSync(join(storage.directory, `${completed.id}.account-binding.json`))
  account = 'synthetic-replacement-account'
  const continued = submit(preference, completed.id)
  await vi.waitFor(() => expect(backend.spawn).toHaveBeenCalledTimes(2))
  finishes[1]!()
  expect((await continued.done).status).toBe('completed')
  expect(storage.accountBinding(completed.id)).toBe('synthetic-replacement-account')
})

it('rejects a raw model variant paired with another variant effort instead of substituting it', async () => {
  const { backend, submit } = setup()
  vi.mocked(catalogFor).mockResolvedValue({
    cli: 'antigravity',
    notice: 'Synthetic variants',
    models: [
      {
        id: 'synthetic/group',
        label: 'Synthetic',
        efforts: ['low', 'high'],
        variants: { low: 'synthetic/low', high: 'synthetic/high' },
      },
    ],
  })
  expect(await submit({ ...preference, model: 'synthetic/high', effort: 'low' }).done).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('不匹配'),
  })
  expect(backend.spawn).not.toHaveBeenCalled()
})

it('binds history privately, permits the same account and rebinds a replacement account on continuation', async () => {
  const { backend, storage, runtime, finishes, submit } = setup()
  const first = submit()
  await vi.waitFor(() => expect(backend.spawn).toHaveBeenCalledTimes(1))
  finishes[0]!()
  await first.done
  expect(storage.accountBinding(first.worker.id)).toBe('synthetic-account-a')
  const bindingFile = statSync(join(storage.directory, `${first.worker.id}.account-binding.json`))
  expect(bindingFile.isFile()).toBe(true)
  // Windows stat mode does not represent its ACL; retain the POSIX assertion
  // only on platforms where these permission bits carry that meaning.
  if (process.platform !== 'win32') expect(bindingFile.mode & 0o777).toBe(0o600)
  expect(JSON.stringify(runtime.snapshot('synthetic-parent', first.worker.id))).not.toContain(
    'synthetic-account-a',
  )
  const same = submit(preference, first.worker.id)
  await vi.waitFor(() => expect(backend.spawn).toHaveBeenCalledTimes(2))
  finishes[1]!()
  expect((await same.done).status).toBe('completed')
  account = 'synthetic-account-b'
  const different = submit(preference, first.worker.id)
  await vi.waitFor(() => expect(backend.spawn).toHaveBeenCalledTimes(3))
  finishes[2]!()
  expect((await different.done).status).toBe('completed')
  expect(storage.accountBinding(first.worker.id)).toBe('synthetic-account-b')
  expect(storage.history(first.worker.id).filter((event) => event.text?.includes('账号'))).toEqual([])
  expect(JSON.stringify(runtime.snapshot('synthetic-parent', first.worker.id))).not.toContain(
    'synthetic-account-b',
  )
})

it('cancels during model discovery without spawning a task', async () => {
  const { backend, runtime, submit } = setup()
  vi.mocked(catalogFor).mockImplementation(async (_cli, _backend, _config, _project, signal) => {
    await new Promise<void>((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    )
    throw new Error('unreachable')
  })
  const task = submit()
  await vi.waitFor(() => expect(catalogFor).toHaveBeenCalledTimes(1))
  expect((await runtime.stop('synthetic-parent', task.worker.id)).status).toBe('interrupted')
  expect(backend.spawn).not.toHaveBeenCalled()
})

it.each([false, true])(
  'queued cancellation waits for account-query cleanup (failure=%s)',
  async (failure) => {
    const { backend, runtime, finishes, submit } = setup()
    const first = submit()
    await vi.waitFor(() => expect(backend.spawn).toHaveBeenCalledTimes(1))
    let reject!: (reason: unknown) => void
    vi.mocked(readCliAccountBinding).mockImplementationOnce(
      () =>
        new Promise((_yes, no) => {
          reject = no
        }),
    )
    const queued = submit()
    let settled = false
    void queued.done.then(() => {
      settled = true
    })
    const stopping = runtime.stop('synthetic-parent', queued.worker.id)
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(queued.worker.status).toBe('stopping')
    reject(failure ? new ProcessCleanupUnconfirmedError() : new Error('Synthetic query safely cancelled'))
    expect((await stopping).status).toBe(failure ? 'failed' : 'interrupted')
    if (failure) expect(() => submit()).toThrow('清理')
    finishes[0]!()
    await first.done
    expect(backend.spawn).toHaveBeenCalledTimes(1)
  },
)

it('rejects a Claude prepared B snapshot even when current configuration has returned to admitted A', async () => {
  const { backend, submit } = setup()
  claudeRouteFixture.selected = {
    kind: 'proxy',
    sourceIds: ['/synthetic/claude/settings.json'],
    source: {
      provider: 'anthropic',
      credential: { type: 'api', key: 'synthetic-B' },
      sourceIds: ['/synthetic/claude/settings.json'],
      baseUrl: 'http://127.0.0.1:15721',
      apiType: 'anthropic-messages',
      anthropicAuth: 'bearer',
      nativeModels: [],
    },
  }
  vi.mocked(readCliAccountBinding).mockImplementation(
    async (_cli, _backend, _config, _project, signal, selected) => {
      signal.throwIfAborted()
      // Admission, catalog validation and final current state are A; only the prepared snapshot is B.
      return selected ? 'synthetic-account-B' : 'synthetic-account-a'
    },
  )
  expect(await submit({ ...preference, cli: 'claude' }).done).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('账号已变更'),
  })
  expect(backend.spawn).not.toHaveBeenCalled()
  expect(
    vi.mocked(readCliAccountBinding).mock.calls.some((call) => call[5] === claudeRouteFixture.selected),
  ).toBe(true)
})
