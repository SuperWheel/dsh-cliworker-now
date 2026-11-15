import { win32 } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { ProcessBackend } from './process.ts'

const failure = () => new Error('Windows 后台 CLI 启动回执异常')
const bootstrap = fileURLToPath(new URL('./windows-hidden-launch.mjs', import.meta.url))
export const isCurrentWindowsRuntime = (value: string) => win32.normalize(value).toLowerCase() === win32.normalize(process.execPath).toLowerCase()

/** Only console-subsystem targets need a GUI bootstrap. Existing Node helpers
 * already use Electron's GUI executable; terminal allocation stays untouched. */
export function needsWindowsHiddenLaunch(argv: readonly string[], platform: NodeJS.Platform, electron: boolean): boolean {
  return platform === 'win32' && electron && !isCurrentWindowsRuntime(argv[0]!)
}

function nodeEnvironment(env?: NodeJS.ProcessEnv): string | null {
  let value: string | undefined
  for (const [key, entry] of Object.entries(process.env))
    if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') value = entry
  for (const [key, entry] of Object.entries(env ?? {}))
    if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') value = entry
  return value ?? null
}

/** Window presentation only: all byte streams, collection and process-range
 * ownership remain the SDK's. Native exit facts travel over a private channel,
 * never stdout/stderr and never the native CLI's credential/session protocol. */
export function spawnWindowsHidden(backend: ProcessBackend, spec: SubprocessSpawnSpec, options: { privateUmask?: true; visibleWindow?: true } = {}): SubprocessHandle {
  // Current plugin calls do not use this channel. Never silently take a future
  // consumer's control protocol or downgrade to an unhidden spawn.
  if (spec.stdio.control) throw new Error('Windows 后台 CLI 启动不能复用已占用的控制通道')
  const inner = backend.spawn({
    ...spec,
    argv: [process.execPath, bootstrap, JSON.stringify({ nodeEnv: nodeEnvironment(spec.env), ...options }), ...spec.argv],
    env: { ...spec.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: { ...spec.stdio, control: 'pipe' },
  })
  let cancelled = false, bytes = 0, raw = '', invalid = false
  const channel = inner.control
  if (!channel) inner.terminate()
  // Attach readers immediately so a fast metadata process cannot fill a pipe.
  const reading = channel ? new Promise<void>((resolve) => {
    const decoder = new StringDecoder('utf8')
    const finish = () => { raw += decoder.end(); resolve() }
    channel.on('data', (chunk: Buffer) => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > 1024) {
        invalid = true
        channel.destroy()
        inner.terminate()
      } else raw += decoder.write(chunk)
    })
    channel.once('error', () => { invalid = true; inner.terminate(); resolve() })
    channel.once('end', finish)
    channel.once('close', finish)
  }) : Promise.resolve()
  // A native parent can exit while its descendants retain stdout/stderr. The
  // GUI relay must remain alive to forward those bytes, so its exit cannot be
  // used as the native process's completion signal. Keep range exit on the SDK.
  const outerDone = inner.done.then(async (outer) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([reading, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(failure()), 1000)
      })])
    } finally { clearTimeout(timer) }
    return outer
  })
  void outerDone.catch(() => inner.terminate())
  const done = (async (): Promise<SubprocessOutcome> => {
    try {
      if (!channel) { await inner.done; throw failure() }
      const outer = await Promise.race([reading.then(() => undefined), outerDone])
      if (cancelled || spec.signal?.aborted) return await inner.done
      if (invalid || (outer && (outer.exitCode !== 0 || outer.signal))) throw failure()
      const value = JSON.parse(raw)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure()
      if (value.kind === 'spawn-error' && ['ENOENT', 'EACCES', 'ENOEXEC', 'EINVAL', 'UNKNOWN'].includes(value.code))
        throw Object.assign(new Error('Windows 后台 CLI 无法启动'), { code: value.code })
      if (value.kind !== 'exit' ||
          !(value.exitCode === null || (Number.isInteger(value.exitCode) && value.exitCode >= -2147483648 && value.exitCode <= 4294967295)) ||
          !(value.signal === null || (typeof value.signal === 'string' && /^SIG[A-Z0-9]+$/.test(value.signal))) ||
          (value.exitCode === null) === (value.signal === null)) throw failure()
      return { exitCode: value.exitCode, signal: value.signal }
    } catch (error) {
      inner.terminate()
      if (error instanceof SyntaxError) throw failure()
      throw error
    } finally {
      channel?.destroy()
    }
  })()
  void done.catch(() => undefined)
  return {
    stdin: inner.stdin,
    stdout: inner.stdout,
    stderr: inner.stderr,
    collected: inner.collected,
    control: undefined,
    done,
    terminate: () => { cancelled = true; channel?.destroy(); inner.terminate() },
    waitForExit: (signal) => inner.waitForExit(signal),
  }
}
