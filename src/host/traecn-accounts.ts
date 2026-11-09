import { StringDecoder } from 'node:string_decoder'
import { stripVTControlCharacters } from 'node:util'
import { homedir } from 'node:os'
import { join, delimiter } from 'node:path'
import type { AccountStatus } from '../shared/accounts.ts'
import type { ModelChoice } from '../shared/types.ts'
import { METADATA_EXIT_GRACE_MS, ProcessCleanupUnconfirmedError, type ProcessBackend, type RuntimeConfig } from './process.ts'

type Identity = Pick<AccountStatus, 'state' | 'summary' | 'verification'>

/** Keep TRAE's native configuration and inherited environment; Desktop does not source shell profiles. */
export function traecnEnvironment(env: NodeJS.ProcessEnv = process.env, platform = process.platform, home = homedir()): Record<string, string> {
  const local = join(home, '.local/bin'), path = env.PATH ?? ''
  // DSH scrubs credential-shaped ambient names; forward only TRAE's own route, in child env only.
  const own = Object.fromEntries(['TRAE_HOME', 'TRAECLI_HOST', 'TRAECLI_PERSONAL_ACCESS_TOKEN']
    .flatMap(name => env[name] === undefined ? [] : [[name, env[name]!]]))
  return { ...own, ...(platform === 'darwin' && !path.split(delimiter).includes(local)
    ? { PATH: path ? `${path}${delimiter}${local}` : local } : {}) }
}

/** Metadata only. Both streams are bounded, and timeout never bypasses process-range cleanup. */
export async function captureTraecnMetadata(backend: ProcessBackend, config: RuntimeConfig, argv: string[], cwd: string,
  signal: AbortSignal, timeoutMs: number): Promise<{ output: string; exitCode: number | null }> {
  const control = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  control.throwIfAborted()
  const child = backend.spawn({ argv, cwd, env: traecnEnvironment(), signal: control, graceMs: config.graceMs,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' } })
  void child.done.catch(() => undefined)
  let bytes = 0, finished = false
  const read = async (stream: typeof child.stdout) => {
    let text = ''
    const decoder = new StringDecoder('utf8')
    if (stream) for await (const chunk of stream) {
      bytes += Buffer.byteLength(chunk)
      if (bytes > Math.min(config.maxRunBytes, 1024 * 1024)) throw new Error('TRAE CN 元数据输出过大')
      text += decoder.write(chunk)
    }
    return text + decoder.end()
  }
  const readers = [read(child.stdout), read(child.stderr)]
  try {
    const [stdout, stderr] = await Promise.all(readers)
    const outcome = await child.done
    finished = true
    control.throwIfAborted()
    return { output: stripVTControlCharacters([stdout, stderr].filter(Boolean).join('\n')), exitCode: outcome.exitCode }
  } finally {
    let exited = false
    try {
      if (finished && !control.aborted) exited = await child.waitForExit(AbortSignal.timeout(METADATA_EXIT_GRACE_MS))
      if (!exited) { child.terminate(); exited = await child.waitForExit() }
    } catch (error) { throw new ProcessCleanupUnconfirmedError({ cause: error }) }
    if (!exited) throw new ProcessCleanupUnconfirmedError()
    await Promise.allSettled([...readers, child.done])
  }
}

export function parseTraecnAccount(output: string, exitCode?: number | null): Identity {
  const text = stripVTControlCharacters(output)
  const unsupported = text.split(/\r?\n/).find(line => line.includes('does not support CLI usage'))
  if (unsupported) return { state: 'unavailable', verification: 'cli', summary: unsupported.trim().slice(0, 200) }
  const lines = text.split(/\r?\n/).map(line => line.trim())
  const signedIn = lines.includes('Logged in using Trae'), signedOut = lines.includes('Not logged in')
  if (exitCode === 0 && signedIn && !signedOut)
    return { state: 'authenticated', verification: 'cli', summary: '已登录 TRAE（CLI 不区分个人与企业账号）' }
  if (exitCode === 1 && signedOut && !signedIn)
    return { state: 'unconfigured', verification: 'cli', summary: 'TRAE CN 未登录' }
  return { state: 'unknown', verification: 'cli', summary: '无法确认 TRAE CN 登录状态' }
}

export async function readTraecnAccount(backend: ProcessBackend, config: RuntimeConfig, executable: string, project: string, signal: AbortSignal): Promise<Identity> {
  const result = await captureTraecnMetadata(backend, config, [executable, 'login', 'status'], project, signal, 10_000)
  return parseTraecnAccount(result.output, result.exitCode)
}

export function traecnAccountArguments(action: string, provider?: string): string[] {
  if (action === 'logout') return ['logout']
  if (action !== 'login') throw new Error('TRAE CN 仅支持登录和退出')
  if (provider === 'personal') return ['--enable', 'personal_user_login', 'login', '--personal']
  if (provider === 'enterprise') return ['login', '--enterprise']
  if (provider === 'enterprise-pat') return ['login', '--with-trae-pat']
  throw new Error('不支持的登录方式')
}

export async function discoverTraecnModels(backend: ProcessBackend, config: RuntimeConfig, executable: string, project: string, signal: AbortSignal): Promise<ModelChoice[]> {
  const account = await readTraecnAccount(backend, config, executable, project, signal)
  if (account.state !== 'authenticated') throw new Error(account.summary)
  const { output, exitCode } = await captureTraecnMetadata(backend, config, [executable, 'models', '--json'], project, signal, 20_000)
  const unsupported = parseTraecnAccount(output)
  if (unsupported.state === 'unavailable') throw new Error(unsupported.summary)
  if (exitCode !== 0) throw new Error('TRAE CN 模型查询失败，请检查原生 CLI')
  let rows: unknown
  try { rows = JSON.parse(output) } catch { throw new Error('TRAE CN 模型目录格式无效') }
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row.config_name !== 'string' || !row.config_name.trim()))
    throw new Error('TRAE CN 模型目录格式无效')
  if (!rows.length) throw new Error('TRAE CN 当前账号暂无可确认模型，请刷新或检查套餐')
  // TRAE publishes no effort source: the only choice is the native default (same as Kimi OAuth / Claude own route).
  return rows.map(row => ({ id: row.config_name, label: typeof row.name === 'string' ? row.name : row.config_name, efforts: ['default'] }))
}
