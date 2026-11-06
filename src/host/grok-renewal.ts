import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GROK_RENEW_MARGIN_MS, GrokAccountReadError, GrokModelsError, readGrokOwnAccount } from './grok-models.ts'
import { ProcessCleanupUnconfirmedError, type ProcessBackend } from './process.ts'

/**
 * Grok renews its own OIDC session (refresh token, IdP request, locked atomic
 * write) whenever an authenticated command finds the access token due. The
 * plugin only starts that native command against the user's own auth file and
 * rereads the result; it never sends an OAuth request or reads a refresh token.
 * Verified 2026-11-06: `grok models` 1.0.50 (Windows) renewed an access token
 * expired for 854 minutes in 3.3 s, same identity, logging `auth: silent refresh`
 * with outcome `Renewed`.
 */
export type GrokRenewalFailure = 'relogin' | 'unavailable' | 'changed' | 'unsupported' | 'busy'
const messages: Record<GrokRenewalFailure, string> = {
  relogin: 'Grok 登录已失效，请在账号终端重新登录',
  unavailable: 'Grok 登录续期暂时失败，请检查网络后刷新',
  changed: 'Grok 账号已变化，请刷新',
  unsupported: '当前 Grok 版本暂不支持自动续期，请更新 Grok 或在账号终端重新登录',
  busy: 'Grok 账号终端正在运行，请关闭后刷新',
}
export class GrokRenewalError extends GrokModelsError {
  constructor(readonly state: GrokRenewalFailure) {
    super(messages[state])
  }
}
export interface GrokRenewalInput {
  backend: ProcessBackend
  executable: string
  /** A fresh private Grok home/tmp prepared like the catalog state (no leader, no telemetry). */
  env: Record<string, string>
  cwd: string
  /** Grok's own log in that private home; only `auth: silent refresh` outcomes are read. */
  logPath: string
  signal: AbortSignal
  graceMs?: number
  home?: string
  timeoutMs?: number
}
interface Flight {
  controller: AbortController
  operation: Promise<void>
  readers: Set<{ signal: AbortSignal }>
  settled: boolean
}
interface HomeState {
  flight?: Flight
  reserved?: symbol
  poisoned?: boolean
}
const homes = new Map<string, HomeState>()
/** Host memory only: credential-file fingerprints Grok itself refused to renew. */
const rejected = new Set<string>()

function homeKey(home = homedir()) {
  const canonical = resolve(home)
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}
function retire(key: string, state: HomeState) {
  if (!state.flight && !state.reserved && !state.poisoned && homes.get(key) === state) homes.delete(key)
}
function available(state: HomeState) {
  if (state.poisoned) throw new ProcessCleanupUnconfirmedError()
  if (state.reserved) throw new GrokRenewalError('busy')
}
/** Whether Grok refused to renew exactly this credential file (it changes after any re-login). */
export function grokRenewalRejected(fingerprint: string): boolean {
  return rejected.has(fingerprint)
}
/** The native auth path for renewal: always the user's real file, never a worker's link to it. */
export function grokNativeAuthPath(home = homedir()): string {
  return join(home, '.grok', 'auth.json')
}

/** Only a fixed message and its outcome value leave the bounded log scan. */
export async function grokRenewalOutcome(logPath: string): Promise<string | undefined> {
  let file
  try {
    file = await open(logPath, 'r')
    const size = Math.min((await file.stat()).size, 4 * 1024 * 1024)
    const buffer = Buffer.alloc(size)
    await file.read(buffer, 0, size, 0)
    let outcome: string | undefined
    for (const line of buffer.toString('utf8').split('\n')) {
      if (!line.includes('"auth: silent refresh"')) continue
      try {
        const event = JSON.parse(line)
        const value = event?.ctx?.outcome
        if (event?.msg === 'auth: silent refresh' && typeof value === 'string' && value.length <= 128)
          outcome = value
      } catch {
        /* a partial line is not evidence */
      }
    }
    return outcome
  } catch {
    return undefined
  } finally {
    await file?.close()
  }
}

async function run(input: GrokRenewalInput) {
  // Once Grok starts rotating, UI cancellation must not cut it between the IdP
  // reply and its locked write: only this bounded deadline stops the command.
  const deadline = AbortSignal.timeout(input.timeoutMs ?? 30_000)
  const child = input.backend.spawn({
    argv: [process.execPath, fileURLToPath(new URL('./private-launch.mjs', import.meta.url)), input.executable, 'models'],
    cwd: input.cwd,
    env: { ...input.env, GROK_AUTH_PATH: grokNativeAuthPath(input.home), ELECTRON_RUN_AS_NODE: '1' },
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: input.graceMs ?? 5000,
    signal: deadline,
  })
  void child.done.catch(() => undefined)
  let bytes = 0
  const drain = async (stream: typeof child.stdout) => {
    if (stream)
      for await (const chunk of stream) {
        bytes += Buffer.byteLength(chunk)
        if (bytes > 262_144) throw new GrokRenewalError('unavailable')
      }
  }
  const readers = [drain(child.stdout), drain(child.stderr)]
  try {
    await Promise.all(readers)
    const result = await child.done
    return { exitCode: result.exitCode, timedOut: deadline.aborted }
  } finally {
    let exited = false
    try {
      child.terminate()
      exited = await child.waitForExit()
    } catch {
      /* fail closed below */
    }
    if (!exited) throw new ProcessCleanupUnconfirmedError()
    await Promise.allSettled([...readers, child.done])
  }
}

async function renew(input: GrokRenewalInput, signal: AbortSignal) {
  signal.throwIfAborted()
  const before = await readGrokOwnAccount({ home: input.home })
  if (before.active && before.expires > Date.now() + GROK_RENEW_MARGIN_MS) return
  if (!before.refresh) throw new GrokRenewalError('relogin')
  const outcome = await run(input)
  // Always reread, even if every waiting caller left while Grok ran.
  let after
  try {
    after = await readGrokOwnAccount({ home: input.home })
  } catch (error) {
    if (error instanceof GrokAccountReadError) throw new GrokRenewalError('changed')
    throw error
  }
  if (after.userId !== before.userId || after.clientId !== before.clientId) throw new GrokRenewalError('changed')
  if (after.active && after.expires > Date.now() + 30_000) {
    rejected.delete(after.fingerprint)
    return
  }
  const native = await grokRenewalOutcome(input.logPath)
  if (native?.startsWith('Failed(ManualLogin')) {
    rejected.add(after.fingerprint)
    throw new GrokRenewalError('relogin')
  }
  // clap reports an unknown subcommand with exit 2 before any auth work.
  if (native === undefined && outcome.exitCode === 2 && !outcome.timedOut) throw new GrokRenewalError('unsupported')
  throw new GrokRenewalError('unavailable')
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort))
      .catch(() => {})
  })
}

/** Share only an in-flight renewal, never a completed authorization decision. */
export async function ensureGrokAccessFresh(input: GrokRenewalInput): Promise<void> {
  input.signal.throwIfAborted()
  const key = homeKey(input.home)
  const state = homes.get(key) ?? {}
  homes.set(key, state)
  available(state)
  let flight = state.flight
  if (!flight) {
    const controller = new AbortController()
    flight = { controller, operation: Promise.resolve(), readers: new Set(), settled: false }
    state.flight = flight
    const current = flight
    current.operation = Promise.resolve()
      .then(() => renew(input, controller.signal))
      .catch((error) => {
        if (error instanceof ProcessCleanupUnconfirmedError) state.poisoned = true
        if (error instanceof GrokModelsError || error instanceof ProcessCleanupUnconfirmedError) throw error
        controller.signal.throwIfAborted()
        throw new GrokRenewalError('unavailable')
      })
      .finally(() => {
        current.settled = true
        if (state.flight === current) state.flight = undefined
        retire(key, state)
      })
    void current.operation.catch(() => {})
  }
  const reader = { signal: input.signal }
  flight.readers.add(reader)
  try {
    await abortable(flight.operation, input.signal)
    input.signal.throwIfAborted()
  } finally {
    flight.readers.delete(reader)
  }
}

/** Hold off renewal while a Grok account terminal runs; wait for a renewal already writing. */
export async function reserveGrokAccount(signal: AbortSignal, home?: string): Promise<() => void> {
  signal.throwIfAborted()
  const key = homeKey(home)
  const state = homes.get(key) ?? {}
  homes.set(key, state)
  available(state)
  const owner = Symbol()
  state.reserved = owner
  const release = () => {
    if (state.reserved === owner) state.reserved = undefined
    retire(key, state)
  }
  try {
    if (state.flight)
      await state.flight.operation.catch((error) => {
        if (error instanceof ProcessCleanupUnconfirmedError) throw error
      })
    signal.throwIfAborted()
    if (state.poisoned) throw new ProcessCleanupUnconfirmedError()
    return release
  } catch (error) {
    release()
    throw error
  }
}

/** Test hook: forget Host-memory renewal state. */
export function resetGrokRenewalState(): void {
  homes.clear()
  rejected.clear()
}
