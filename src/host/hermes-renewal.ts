import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateHermesHomeDirectory } from './hermes-adapter.ts'
import { hermesAccountEnvironment } from './hermes-account-context.ts'
import {
  assertHermesOwnAccounts,
  HermesAccountSourceError,
  hermesPoolEntryUnavailable,
  readHermesAccountMaterial,
} from './hermes-models.ts'
import { hermesNativeCommand } from './hermes-installation.ts'
import {
  HermesNousError,
  hermesNousMinimumTtl,
  projectHermesNousSource,
  selectHermesNousSource,
  type HermesNousSource,
} from './hermes-nous.ts'
import { projectHermesUnsuppressedAuth, hermesUnsuppressedEnvironment } from './hermes-suppression.ts'
import { ProcessCleanupUnconfirmedError, type ProcessBackend } from './process.ts'

type Failure = 'relogin' | 'unavailable' | 'changed' | 'unsupported' | 'busy'
const messages: Record<Failure, string> = {
  relogin: 'Hermes 登录已失效，请重新登录',
  unavailable: 'Hermes 登录暂时无法续期，请稍后刷新',
  changed: 'Hermes 账号来源已变化，请刷新后重试',
  unsupported: '当前 Hermes 安装不支持安全续期，请更新原生 CLI 后重试',
  busy: 'Hermes 账号终端正在运行，请关闭后刷新',
}
export class HermesRenewalError extends HermesNousError {
  constructor(readonly state: Failure) {
    super(messages[state])
  }
}
export interface HermesRenewalContext {
  backend: ProcessBackend
  signal: AbortSignal
  graceMs?: number
}
export interface HermesRenewalInput {
  home: string
  signal: AbortSignal
  backend?: ProcessBackend
  executable?: string
  resolveExecutable?: (signal: AbortSignal) => Promise<string>
  graceMs?: number
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
function homeKey(home: string) {
  const canonical = validateHermesHomeDirectory(home)
  return { home: canonical, key: process.platform === 'win32' ? canonical.toLowerCase() : canonical }
}
function retire(key: string, state: HomeState) {
  if (!state.flight && !state.reserved && !state.poisoned && homes.get(key) === state) homes.delete(key)
}
function available(state: HomeState) {
  if (state.poisoned) throw new ProcessCleanupUnconfirmedError()
  if (state.reserved) throw new HermesRenewalError('busy')
}

/** No bearer, refresh token or email enters the command line or public result. */
export function hermesNousPrincipalDigest(source: HermesNousSource): string {
  const p = source.principal
  return createHash('sha256')
    .update(
      JSON.stringify([
        'hermes-nous-v1',
        p.subject,
        p.organization,
        p.issuer,
        p.clientId ?? '',
        source.route.portal,
        source.route.inference,
      ]),
    )
    .digest('hex')
}
async function snapshot(home: string, signal: AbortSignal) {
  try {
    await lstat(join(home, 'config.yaml'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const selected = await readHermesAccountMaterial(home, signal)
  if (selected.config.model?.provider !== 'nous' || selected.auth.active_provider !== 'nous') return
  const raw = await assertHermesOwnAccounts(home, signal)
  if (raw.config.model?.provider !== 'nous' || raw.auth.active_provider !== 'nous') return
  const material = {
    ...raw,
    auth: projectHermesUnsuppressedAuth(raw.auth),
    env: hermesUnsuppressedEnvironment(raw.auth, raw.env, 'nous'),
  }
  // Suppressed/deleted credentials never become a renewal source.
  if (!material.auth.providers?.nous) return
  const ttl = hermesNousMinimumTtl(material.env)
  // A healthy singleton already proves local login, even before native pool initialization.
  // Leave it alone; an actual renewal still requires the full runtime source below.
  const local = projectHermesNousSource(material.auth, 0, { allowExpired: true })
  if (local.expires > Date.now() + ttl * 1000 && !material.auth.credential_pool?.nous?.length) return
  const source = selectHermesNousSource(material, { allowExpired: true })
  const state = material.auth.providers.nous
  return {
    material,
    source,
    ttl,
    state,
    digest: hermesNousPrincipalDigest(source),
    identity: JSON.stringify([
      hermesNousPrincipalDigest(source),
      state.client_id || 'hermes-cli',
      source.route,
    ]),
  }
}

async function capture(
  input: HermesRenewalInput,
  home: string,
  digest: string,
  ttl: number,
  signal: AbortSignal,
) {
  if (!input.backend) throw new HermesRenewalError('unsupported')
  const executable = input.executable ?? (await input.resolveExecutable?.(signal))
  if (!executable) throw new HermesRenewalError('unsupported')
  const argv = await hermesNativeCommand(executable, ['--cliworker-nous-refresh', digest], signal)
  // Unknown standalone launchers must not receive our private protocol as a CLI command.
  if (argv[2] !== fileURLToPath(new URL('./hermes-native-entry.py', import.meta.url)))
    throw new HermesRenewalError('unsupported')
  signal.throwIfAborted()
  // Once rotation starts, cancellation waits for the bounded native transaction to
  // persist its new refresh token. Killing it on UI cancellation could spend the
  // old single-use grant without saving the replacement (especially Windows Job).
  const deadline = AbortSignal.timeout(8000)
  const child = input.backend.spawn({
    argv: [process.execPath, fileURLToPath(new URL('./private-launch.mjs', import.meta.url)), ...argv],
    cwd: home,
    env: {
      ...hermesAccountEnvironment(home),
      HERMES_SHARED_AUTH_DIR: join(home, 'shared'),
      HERMES_NOUS_MIN_KEY_TTL_SECONDS: String(ttl),
      PYTHONDONTWRITEBYTECODE: '1',
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: input.graceMs ?? 5000,
    signal: deadline,
  })
  void child.done.catch(() => undefined)
  let output = '',
    bytes = 0
  const read = async (stream: typeof child.stdout, keep: boolean) => {
    if (stream)
      for await (const chunk of stream) {
        bytes += Buffer.byteLength(chunk)
        if (bytes > 8192) throw new HermesRenewalError('unavailable')
        if (keep) output += String(chunk)
        if (output.length > 512) throw new HermesRenewalError('unavailable')
      }
  }
  const readers = [read(child.stdout, true), read(child.stderr, false)]
  try {
    await Promise.all(readers)
    const result = await child.done
    if (deadline.aborted || result.exitCode !== 0) throw new HermesRenewalError('unavailable')
    let receipt
    try {
      receipt = JSON.parse(output)
    } catch {
      throw new HermesRenewalError('unavailable')
    }
    if (
      !receipt ||
      receipt.version !== 1 ||
      Object.keys(receipt).sort().join(',') !== 'state,version' ||
      !['ready', 'relogin', 'unavailable', 'changed', 'unsupported'].includes(receipt.state)
    )
      throw new HermesRenewalError('unavailable')
    if (receipt.state !== 'ready') throw new HermesRenewalError(receipt.state)
  } finally {
    output = ''
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

async function renew(input: HermesRenewalInput, home: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const before = await snapshot(home, signal)
  if (!before || before.source.expires > Date.now() + before.ttl * 1000) return
  if (
    typeof before.state.refresh_token !== 'string' ||
    !before.state.refresh_token.trim() ||
    before.state.refresh_token.length > 32768 ||
    /[\x00-\x20\x7f]/.test(before.state.refresh_token)
  )
    throw new HermesRenewalError('relogin')
  if (
    before.material.auth.credential_pool.nous.some((row: any) =>
      hermesPoolEntryUnavailable(row, before.material.config.model?.default),
    )
  )
    throw new HermesRenewalError('unavailable')
  await capture(input, home, before.digest, before.ttl, signal)
  // Always reread even if all subscribers left while the native transaction ran.
  const after = await snapshot(home, new AbortController().signal)
  if (!after || after.identity !== before.identity) throw new HermesRenewalError('changed')
  if (after.source.expires <= Date.now() + after.ttl * 1000) throw new HermesRenewalError('unavailable')
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
export async function ensureHermesNousFresh(input: HermesRenewalInput): Promise<void> {
  input.signal.throwIfAborted()
  const { home, key } = homeKey(input.home)
  const state = homes.get(key) ?? {}
  homes.set(key, state)
  available(state)
  let flight = state.flight
  if (flight?.readers.size && [...flight.readers].every((reader) => reader.signal.aborted))
    flight.controller.abort()
  if (flight?.controller.signal.aborted) {
    await abortable(
      flight.operation.catch(() => {}),
      input.signal,
    )
    return ensureHermesNousFresh(input)
  }
  if (!flight) {
    const controller = new AbortController()
    flight = { controller, operation: Promise.resolve(), readers: new Set(), settled: false }
    state.flight = flight
    const current = flight
    current.operation = Promise.resolve()
      .then(() => renew(input, home, controller.signal))
      .catch((error) => {
        if (error instanceof ProcessCleanupUnconfirmedError) state.poisoned = true
        if (
          error instanceof HermesNousError ||
          error instanceof HermesAccountSourceError ||
          error instanceof ProcessCleanupUnconfirmedError
        )
          throw error
        controller.signal.throwIfAborted()
        throw new HermesRenewalError('unavailable')
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
    available(state)
  } finally {
    flight.readers.delete(reader)
    if (!flight.readers.size && !flight.settled) {
      flight.controller.abort()
      await flight.operation.catch((error) => {
        if (error instanceof ProcessCleanupUnconfirmedError) throw error
      })
    }
  }
}

/** Hold until the account terminal's entire managed range has exited. */
export async function reserveHermesAccount(home: string, signal: AbortSignal): Promise<() => void> {
  signal.throwIfAborted()
  const { key } = homeKey(home)
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
    if (state.flight) {
      state.flight.controller.abort()
      await state.flight.operation.catch((error) => {
        if (error instanceof ProcessCleanupUnconfirmedError) throw error
      })
    }
    signal.throwIfAborted()
    if (state.poisoned) throw new ProcessCleanupUnconfirmedError()
    return release
  } catch (error) {
    release()
    throw error
  }
}
