import { StringDecoder } from 'node:string_decoder'
import { stripVTControlCharacters } from 'node:util'
import { homedir } from 'node:os'
import { lstat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProcessBackend, RuntimeConfig } from '../process.ts'
import { ProcessCleanupUnconfirmedError, METADATA_EXIT_GRACE_MS } from '../process.ts'
import { bounded } from './versions.ts'
import { CliOperationError } from './planner.ts'
import { isQoderDispatcher } from './identity.ts'

/** Official dispatchers treat an existing first argument as an IDE path. */
async function guardDispatcherUpdate(argv: string[], cwd: string): Promise<void> {
  if (argv[1] !== 'update' || !argv[0]) return
  const dispatcher = (path: string) => isQoderDispatcher('qoder', path, cwd) || isQoderDispatcher('qodercn', path, cwd)
  if (!dispatcher(argv[0])) {
    // Also cover a recorded symlink to the official dispatcher.
    let target: string
    try { target = await realpath(argv[0]) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    if (!dispatcher(target)) return
  }
  try { await lstat(join(cwd, 'update')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw new CliOperationError('PREREQUISITE_MISSING', '无法检查主目录中的 update 路径，已阻止 Qoder 分发入口更新；请按官方说明手动更新')
  }
  throw new CliOperationError('PREREQUISITE_MISSING', '主目录中存在名为 update 的文件、目录或符号链接，Qoder 分发入口可能转入 IDE；请处理同名路径或按官方说明手动更新')
}

export function redactOutput(value: string): string {
  return stripVTControlCharacters(value)
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi, '[已脱敏]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s"'<>]+/gi, '[已脱敏]')
    .replace(/((?:access[_-]?token|refresh[_-]?token|token|password|secret|api[_-]?key|_authToken)\s*["']?\s*[:=]\s*["']?)[^\s"'&;,]+/gi, '$1[已脱敏]')
    .replace(/(https?:\/\/)[^\s/]+@/gi, '$1[已脱敏]@')
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_]+|npm_[A-Za-z0-9]+)\b/g, '[已脱敏]')
}
export const outputTail = (value: string) => Buffer.from(redactOutput(value)).subarray(-32 * 1024).toString('utf8').replace(/^\uFFFD+/, '')
/** Buffer a logical line before publishing, so split credentials cannot escape redaction.
 * Oversized unterminated lines are discarded rather than sliced through a secret. */
class SafeOutput {
  private line = ''
  private discarded = false
  constructor(private emit: (value: string) => void) {}
  push(text: string) {
    for (const piece of text.split(/(?<=\n)/)) {
      if (!this.discarded) this.line += piece
      if (Buffer.byteLength(this.line) > 64 * 1024) { this.line = ''; this.discarded = true }
      if (piece.endsWith('\n')) this.flush()
    }
  }
  flush() { if (this.discarded) this.emit('[超长输出行已省略]\n'); else if (this.line) this.emit(redactOutput(this.line)); this.line = ''; this.discarded = false }
}
/** Backend owns the whole process range. Neither abort nor exit(0) alone is an exit receipt. */
export async function executeCliOperation(backend: ProcessBackend, config: RuntimeConfig, argv: string[], signal: AbortSignal, output: (value: string) => void, timeoutMs = 10 * 60_000, env?: Record<string, string>): Promise<void> {
  signal.throwIfAborted()
  const timer = new AbortController(), timeout = setTimeout(() => timer.abort(), timeoutMs)
  const control = AbortSignal.any([signal, timer.signal])
  let child: ReturnType<ProcessBackend['spawn']> | undefined
  let readers: Promise<void>[] = [], finished = false
  const abort = () => child?.terminate()
  try {
    const cwd = homedir()
    if (argv[1] === 'update') await guardDispatcherUpdate(argv, cwd)
    control.throwIfAborted()
    child = backend.spawn({ argv, cwd, ...(env ? { env } : {}), signal: control, graceMs: config.graceMs, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' } })
    void child.done.catch(() => undefined)
    control.addEventListener('abort', abort, { once: true }); if (control.aborted) abort()
    const read = async (stream: ReturnType<ProcessBackend['spawn']>['stdout']) => {
      if (!stream) return
      const decoder = new StringDecoder('utf8'), safe = new SafeOutput(output)
      for await (const chunk of stream) safe.push(decoder.write(chunk))
      safe.push(decoder.end()); safe.flush()
    }
    readers = [read(child.stdout), read(child.stderr)]
    const [outcome] = await bounded(Promise.all([child.done, ...readers]), control); finished = true
    if (timer.signal.aborted && !signal.aborted) throw new CliOperationError('INSTALL_TIMEOUT', '安装阶段超过 10 分钟，请检查输出后重试')
    signal.throwIfAborted()
    if (outcome.exitCode !== 0) throw new CliOperationError('EXIT_CODE', `更新命令退出码 ${outcome.exitCode ?? '未知'}`)
  } catch (error) {
    if (timer.signal.aborted && !signal.aborted) throw new CliOperationError('INSTALL_TIMEOUT', '安装阶段超过 10 分钟，请检查输出后重试')
    throw error
  } finally {
    clearTimeout(timeout); control.removeEventListener('abort', abort)
    if (child) {
      let exited = false
      try {
        if (finished && !control.aborted) exited = await child.waitForExit(AbortSignal.timeout(METADATA_EXIT_GRACE_MS))
        if (!exited) { child.terminate(); exited = await child.waitForExit() }
      } catch (cause) { throw new ProcessCleanupUnconfirmedError({ cause }) }
      if (!exited) throw new ProcessCleanupUnconfirmedError()
      await Promise.allSettled([child.done, ...readers])
    }
  }
}
