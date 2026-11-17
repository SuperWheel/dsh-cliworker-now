import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, statSync, writeSync, fsyncSync, rmSync } from 'node:fs'
import { readFile, stat, lstat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { readPeVersion } from './cli-management/pe-version.ts'
import { ProcessCleanupUnconfirmedError } from './process.ts'
import {
  zcodeAppLayout,
  zcodeAppRuntime,
  zcodeEntryArgv,
  zcodeEntryEnvironment,
  type ZCodeAppLayout,
} from './zcode-app-layout.mjs'

/**
 * How a ZCode Worker starts the CLI (openspec change v0.9.1-cli-update-in-place-leeyl).
 *
 * The desktop app's own `glm/zcode.cjs` runs the way ZCode.app runs it: under the
 * app's Electron with `ELECTRON_RUN_AS_NODE=1`, plus the plugin's preload for the
 * two packages the app keeps in `app.asar`. When that runtime fails its
 * `--version` probe the same entry runs under the Host's Node, with a notice.
 */
export const ZCODE_APP_RUNTIME_FALLBACK_NOTICE =
  'ZCode 桌面应用自带的运行环境没有通过启动检查，Worker 暂时改用 DSH 自带的 Node 运行同一份 CLI；钥匙串凭据和内置浏览器可能不可用。请更新或重装 ZCode 后重新检查。'
export const ZCODE_MIGRATION_PENDING_NOTICE =
  'ZCode Worker 仍在使用插件早期部署的独立 runtime：桌面应用没有通过身份或启动检查，路径记录未改动。请安装或修复 ZCode 桌面应用后重新检查。'

interface ProbeRecord {
  key: string
  ok: boolean
  version?: string
}
const probes = new Map<string, ProbeRecord>()
let migrationNotice: string | undefined
let migrationRetryAt = 0
/** A refused migration is not re-examined on every launch, status read and catalog. */
export const ZCODE_MIGRATION_RETRY_MS = 60_000

function identityKey(path: string): string | undefined {
  try {
    const info = statSync(path)
    return info.isFile() ? `${info.size}:${info.mtimeMs}` : undefined
  } catch {
    return undefined
  }
}
/** A replaced binary or entry (an app update) is probed again. */
function probeKey(executable: string): string | undefined {
  const runtime = zcodeAppRuntime(executable)
  if (!runtime) return undefined
  const entry = identityKey(executable), electron = identityKey(runtime.electron)
  return entry && electron ? `${runtime.electron}\0${electron}\0${entry}` : undefined
}
function probeRecord(executable: string): ProbeRecord | undefined {
  const record = probes.get(executable)
  return record && record.key === probeKey(executable) ? record : undefined
}
/** Unprobed installations use the app runtime; only a failed probe turns it off. */
const appRuntimeAllowed = (executable: string) => probeRecord(executable)?.ok !== false

export function zcodeLaunchPrefix(executable: string): string[] {
  return zcodeEntryArgv(executable, { appRuntime: appRuntimeAllowed(executable) })
}
/** `ELECTRON_RUN_AS_NODE` and the preload's resources directory, or nothing. */
export function zcodeLaunchEnvironment(executable: string): Record<string, string> {
  return zcodeEntryEnvironment(executable, { appRuntime: appRuntimeAllowed(executable) })
}
/** The provider file next to the entry this launch actually runs. */
export function zcodeAppBuiltinConfig(executable: string): string | undefined {
  return zcodeAppLayout(executable)?.builtinConfig
}
export function usesZCodeAppRuntime(executable: string): boolean {
  return appRuntimeAllowed(executable) && !!zcodeAppRuntime(executable)
}

/** Whole tokens only, as cli-management/versions.ts reads every other `--version`. */
export function zcodeVersionToken(raw: string): string | undefined {
  for (const [token] of stripVTControlCharacters(raw).matchAll(/[0-9A-Za-z.+-]+/g)) {
    const value = token.replace(/^v(?=\d)/, '')
    if (value.length < 128 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)) return value
  }
  return undefined
}

export type ZCodeProbeCapture = (argv: string[], env: Record<string, string>) => Promise<string>

/**
 * Run `--version` under the app runtime once per installed binary and entry.
 * `undefined` means the entry has no app runtime (nothing to probe). Cleanup
 * failures and the caller's cancellation propagate; every other failure is the
 * fallback decision.
 */
export async function probeZCodeAppRuntime(
  executable: string,
  capture: ZCodeProbeCapture,
  signal?: AbortSignal,
): Promise<{ ok: boolean; version?: string } | undefined> {
  const key = probeKey(executable)
  if (!key) {
    probes.delete(executable)
    return undefined
  }
  const known = probeRecord(executable)
  if (known) return { ok: known.ok, ...(known.version ? { version: known.version } : {}) }
  signal?.throwIfAborted()
  let version: string | undefined
  try {
    version = zcodeVersionToken(await capture(
      [...zcodeEntryArgv(executable), '--version'],
      zcodeEntryEnvironment(executable),
    ))
  } catch (error) {
    if (error instanceof ProcessCleanupUnconfirmedError) throw error
    signal?.throwIfAborted()
  }
  // Only a result for the files that were actually probed is kept.
  if (probeKey(executable) !== key) return { ok: !!version, ...(version ? { version } : {}) }
  if (probes.size >= 16 && !probes.has(executable)) probes.delete(probes.keys().next().value!)
  probes.set(executable, { key, ok: !!version, ...(version ? { version } : {}) })
  return { ok: !!version, ...(version ? { version } : {}) }
}
/** A later successful `--version` under the app runtime is the same evidence. */
export function recordZCodeAppRuntime(executable: string, version: string | undefined): void {
  const key = probeKey(executable)
  if (!key) return
  probes.set(executable, { key, ok: !!version, ...(version ? { version } : {}) })
}
export function setZCodeMigrationNotice(notice: string | undefined): void {
  migrationNotice = notice
  migrationRetryAt = notice ? Date.now() + ZCODE_MIGRATION_RETRY_MS : 0
}
export const zcodeMigrationDeferred = (): boolean => Date.now() < migrationRetryAt
/** Shown on the settings account row and the update row; never CLI output. */
export function zcodeRuntimeNotice(executable?: string): string | undefined {
  if (executable && probeRecord(executable)?.ok === false) return ZCODE_APP_RUNTIME_FALLBACK_NOTICE
  return migrationNotice
}
/** Test isolation only. */
export function resetZCodeLaunchState(): void {
  probes.clear()
  migrationNotice = undefined
  migrationRetryAt = 0
}

/**
 * The installation that owns a bundled entry, by its own evidence: bundle
 * identifier `dev.zcode.app` on macOS, PE ProductName `ZCode` on Windows, and
 * the provider file ZCode ships beside the CLI. A directory name is not identity.
 */
export async function verifiedZCodeApp(
  entry: string,
  platform: NodeJS.Platform = process.platform,
): Promise<ZCodeAppLayout | undefined> {
  const layout = zcodeAppLayout(entry, platform)
  if (!layout) return undefined
  try {
    if (!(await stat(entry)).isFile() || !(await stat(layout.builtinConfig)).isFile()) return undefined
    // lstat: a linked root or binary is somebody else's installation.
    if (!(await lstat(layout.root)).isDirectory() || !(await lstat(layout.electron)).isFile()) return undefined
    if (platform === 'win32')
      return (await readPeVersion(layout.electron))?.productName === 'ZCode' ? layout : undefined
    const file = join(layout.root, 'Contents', 'Info.plist'), info = await stat(file)
    if (!info.isFile() || info.size > 128 * 1024) return undefined
    return /<key>CFBundleIdentifier<\/key>\s*<string>dev\.zcode\.app<\/string>/.test(await readFile(file, 'utf8'))
      ? layout : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether the entry can load its terminal UI. The CLI imports `@zcode/tui` by
 * bare name; the desktop app does not ship it, the full runtime does. A native
 * (non-JavaScript) entry embeds its own and is decided by its `--help`.
 */
export function zcodeTuiResolvable(executable: string): boolean | undefined {
  if (!/\.[cm]?js$/i.test(executable)) return undefined
  for (let directory = dirname(resolve(executable)), depth = 0; depth < 64; depth++) {
    if (existsSync(join(directory, 'node_modules', '@zcode', 'tui', 'package.json'))) return true
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return false
}

/**
 * Give the plugin's own ZCode account directory a file-held encryption key, the
 * source ZCode itself reads before the OS store (`<data>/.zcode/v2/credential-secret`,
 * 0600, 32 random bytes as base64url).
 *
 * Created only when nothing has chosen a key source yet: no `ZCODE_CREDENTIAL_SECRET`
 * or `ZCODE_CREDENTIAL_SECRET_FILE`, no `credential-source` marker, no v2 record.
 * The user's own `~/.zcode` is never touched, and an existing file is never replaced.
 */
export function ensureZCodeCredentialSecret(
  authDirectory: string,
  options: { env?: NodeJS.ProcessEnv; home?: string } = {},
): 'created' | 'present' | 'skipped' {
  const env = options.env ?? process.env
  if (env.ZCODE_CREDENTIAL_SECRET || env.ZCODE_CREDENTIAL_SECRET_FILE) return 'skipped'
  const base = resolve(authDirectory)
  if (base === resolve(options.home ?? homedir())) return 'skipped'
  try {
    const root = lstatSync(base)
    if (!root.isDirectory() || root.isSymbolicLink()) return 'skipped'
  } catch {
    // The account directory is created by login; never before it.
    return 'skipped'
  }
  const directory = join(base, '.zcode', 'v2'), target = join(directory, 'credential-secret')
  try {
    for (const path of [join(base, '.zcode'), directory]) {
      let info
      try {
        info = lstatSync(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 'skipped'
        mkdirSync(path, { mode: 0o700 })
        info = lstatSync(path)
      }
      if (!info.isDirectory() || info.isSymbolicLink()) return 'skipped'
    }
    try {
      lstatSync(target)
      return 'present'
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 'skipped'
    }
    if (existsSync(join(directory, 'credential-source'))) return 'skipped'
    let records = ''
    try {
      const file = join(directory, 'credentials.json'), info = lstatSync(file)
      if (!info.isFile() || info.size > 4 * 1024 * 1024) return 'skipped'
      records = readFileSync(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 'skipped'
    }
    // `enc:v2:os:` is pinned to the OS store; `enc:v2:env:` already has a key elsewhere.
    if (records.includes('enc:v2:')) return 'skipped'
    let fd: number | undefined
    try {
      fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      writeSync(fd, randomBytes(32).toString('base64url'))
      fsyncSync(fd)
    } catch (error) {
      if (fd !== undefined) { closeSync(fd); fd = undefined; rmSync(target, { force: true }) }
      return (error as NodeJS.ErrnoException).code === 'EEXIST' ? 'present' : 'skipped'
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
    return 'created'
  } catch {
    return 'skipped'
  }
}
