import { StringDecoder } from 'node:string_decoder'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalSpawnSpec,
  SubprocessTerminalHandle,
} from '@deepseek-ai/dsh-subprocess'
import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, parse, resolve, sep } from 'node:path'
import type { ModelChoice, Preference, TaskMode } from '../shared/types.ts'
import type { CliExecutablePathStore } from './cli-executable-paths.ts'
import { agyBackgroundEnvironment } from './agy-background-environment.ts'
import type { NativeHarnessConnection } from './native-harness-tools.ts'
import type { NativeAttachment } from './native-attachments.mjs'

export interface ProcessBackend {
  resolveExecutable(name: string): Promise<string>
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle
  spawnTerminal?(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle>
}
/** A process range is still unconfirmed; callers must stop admitting work. */
export class ProcessCleanupUnconfirmedError extends Error {
  constructor() {
    super('CLI catalog process cleanup did not reach quiescence')
    this.name = 'ProcessCleanupUnconfirmedError'
  }
}
/** One task's limits, fixed when it starts; settings changed later apply to later tasks only. */
export interface TaskTimeLimit {
  /** Absolute end of the task (epoch ms), shared by every timer of the run. */
  deadlineAt: number
  /** Total limit this deadline came from, for the timeout note. */
  totalMs: number
  /** No native event for this long stops the task; 0 is off. */
  idleMs: number
}
export interface RuntimeConfig {
  /** Per-run time limit snapshot, never deployment settings. */
  timeLimit?: TaskTimeLimit
  /** Host-resolved upload references for one task, never deployment settings. */
  attachments?: readonly NativeAttachment[]
  /** Per-run Host-private tool connection; never persisted as deployment settings. */
  harnessTools?: NativeHarnessConnection
  /** Host-private machine-local CLI path preferences, shared by all entry points. */
  cliExecutablePaths?: CliExecutablePathStore
  executable: string
  codexExecutable?: string
  claudeExecutable?: string
  kimiExecutable?: string
  mimoExecutable?: string
  zcodeExecutable?: string
  grokExecutable?: string
  ompExecutable?: string
  piExecutable?: string
  hermesExecutable?: string
  hermesHome?: string
  opencodeExecutable?: string
  qoderExecutable?: string
  qodercnExecutable?: string
  zcodeAuthDirectory?: string
  zcodeBuiltinConfig?: string
  stateDirectory?: string
  /** @deprecated Legacy deployment input; own-account isolation ignores it. */
  zaiCredentialRef?: string
  /** @deprecated Test/old API compatibility only; must never be invoked. */
  resolveCredential?: (ref: string) => Promise<string | undefined>
  maxConcurrent: number
  /** Initial total task time limit until one is chosen in the CLI Worker settings. */
  timeoutMs: number
  graceMs: number
  maxLineBytes: number
  maxRunBytes: number
  /** Native CLI inbound single-frame protection, separate from display budgets. */
  maxNativeLineBytes?: number
  /** Shown output of one native tool step or reasoning block. */
  maxToolPreviewBytes?: number
  maxTimelineItems: number
}
export const DEFAULT_CONFIG: RuntimeConfig = {
  executable: 'agy',
  maxConcurrent: 2,
  timeoutMs: 1_800_000,
  graceMs: 5000,
  maxLineBytes: 1_048_576,
  maxRunBytes: 16_777_216,
  maxNativeLineBytes: 33_554_432,
  maxToolPreviewBytes: 262_144,
  maxTimelineItems: 1000,
}

export function projectDirectory(input: string): string {
  if (!isAbsolute(input)) throw new Error('Project must be an absolute directory')
  const path = realpathSync(input)
  const home = realpathSync(homedir())
  const key = (value: string) => (process.platform === 'win32' ? value.toLowerCase() : value)
  if (key(path) === key(parse(path).root) || key(path) === key(home) || key(home).startsWith(key(path + sep)))
    throw new Error('Refusing a root or home directory as workspace')
  const forbidden = [
    '.ssh',
    '.aws',
    '.codex',
    '.claude',
    '.kimi-code',
    '.config/mimocode',
    '.local/share/mimocode',
    '.agents',
    '.grok',
    '.pi',
    '.omp',
    '.dsh',
    '.hermes',
    '.zcode',
    '.qoder',
    '.qoder-cn',
    '.local/share/opencode',
    '.gemini',
    '.config',
    'Library/Keychains',
    'Library/Application Support/Google',
    'Library/Application Support/Microsoft Edge',
  ]
  if (
    forbidden.some((name) => {
      const root = resolve(home, name)
      return key(path) === key(root) || key(path).startsWith(key(root + sep))
    })
  )
    throw new Error('Refusing a credential or application configuration directory')
  if (!statSync(path).isDirectory()) throw new Error('Project is not a directory')
  accessSync(path, constants.R_OK | constants.X_OK)
  return path
}

export function agyArguments(
  executable: string,
  project: string,
  preference: Preference,
  mode: TaskMode,
  prompt: string,
  timeoutMs: number,
  conversationId?: string,
): string[] {
  // --disable-slash-commands also disables --mode plan in agy 1.2.16.
  // Prefix plain task text instead, and keep the native mode effective.
  return [
    executable,
    '--add-dir',
    project,
    '--sandbox',
    '--dangerously-skip-permissions',
    '--mode',
    mode,
    '--model',
    preference.model,
    ...(preference.effort === 'default' ? [] : ['--effort', preference.effort]),
    '--output-format',
    'stream-json',
    '--print-timeout',
    `${Math.ceil(timeoutMs / 1000)}s`,
    ...(conversationId ? ['--conversation', conversationId] : []),
    '--print',
    `任务：\n${prompt}`,
  ]
}

/** Bound discovery and always await managed process cleanup. No agent prompt is sent. */
export async function discoverModels(
  backend: ProcessBackend,
  config: RuntimeConfig,
  cwd: string,
  signal: AbortSignal,
): Promise<ModelChoice[]> {
  const executable = await backend.resolveExecutable(config.executable)
  signal.throwIfAborted()
  const control = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
  const process = backend.spawn({
    argv: [executable, 'models'],
    cwd,
    env: agyBackgroundEnvironment('antigravity'),
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: config.graceMs,
    signal: control,
  })
  void process.done.catch(() => undefined)
  let stdout = ''
  let stderr = ''
  const read = async (stream: typeof process.stdout, out: (s: string) => void) => {
    if (!stream) return
    // A multi-byte UTF-8 character may be split across chunks.
    const decoder = new StringDecoder('utf8')
    for await (const chunk of stream) out(decoder.write(chunk))
    const rest = decoder.end()
    if (rest) out(rest)
  }
  try {
    await Promise.all([
      read(process.stdout, (s) => {
        stdout += s
        if (stdout.length > config.maxLineBytes) throw new Error('Model catalog too large')
      }),
      read(process.stderr, (s) => {
        stderr = (stderr + s).slice(-4096)
      }),
    ])
    const outcome = await process.done
    control.throwIfAborted()
    if (outcome.exitCode !== 0) throw new Error(`无法读取 Antigravity 模型：${stderr || outcome.exitCode}`)
    const models = stdout.split(/\r?\n/).flatMap((line) => {
      const [id, ...label] = line.split('\t')
      return id && label.length && /^[A-Za-z0-9_.:/-]+$/.test(id)
        ? [{ id, label: label.join(' ').trim() }]
        : []
    })
    if (!models.length) throw new Error('Antigravity returned no model catalog; check login with agy models')
    return models
  } finally {
    process.terminate()
    await process.waitForExit()
    await process.done.catch(() => undefined)
  }
}
