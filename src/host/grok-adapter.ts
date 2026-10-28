import { chmod, lstat, mkdir, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StringDecoder } from 'node:string_decoder'
import { EFFORTS, type Effort, type ModelChoice, type TaskMode } from '../shared/types.ts'
import type { EventInput, ProtocolResult } from './protocol.ts'
import { assertGrokNativeEnvironment, discoverGrokAccountModels } from './grok-models.ts'
import { GrokResponseTracker, grokResponseUsage } from './grok-response.mjs'
import { HARNESS_MCP_SERVER, nativeHarnessReadyConnection } from './native-harness-injection.mjs'
import { GROK_NATIVE_WEB, GROK_PLAN_TOOLS } from './cli-native-capabilities.mjs'
import type { NativeHarnessConnection } from './native-harness-tools.ts'
import type { NativeAccess } from './native-approval-policy.ts'

export interface GrokInput {
  executable: string
  project: string
  preference: { model: string; effort: Effort }
  mode: TaskMode
  access?: NativeAccess
  prompt: string
  conversationId?: string
  stateDirectory: string
  harnessTools?: NativeHarnessConnection
}
const record = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)
const baseConfig = `[cli]\nauto_update = false\nuse_leader = false\n[features]\nsupport_permission = true\nweb_fetch = ${GROK_NATIVE_WEB}\ntelemetry = false\nfeedback = false\ncodebase_indexing = false\n[telemetry]\ntrace_upload = false\nmixpanel_enabled = false\n[subagents]\nenabled = false\n[session]\nload_envrc = false\n[shell_environment_policy]\ninherit = "core"\nignore_default_excludes = false\n`
// `grok agent stdio` ignores the global --permission-mode/--deny flags, and its
// config ignores permission_mode = "dontAsk", so a read-only run denies edits
// by rule in this run's private config. Bare mkdir/touch skip prompts in every
// mode and are denied too. A ready DSH bridge is pre-approved; the Host still
// approves each execution. Web reads are pre-approved too: a plan run refuses
// every prompt, and web_fetch otherwise asks for each domain off Grok's list.
// The ask level asks before every edit and shell call; the middle level uses
// Grok's own auto-review classifier (config `ui.permission_mode`). An ignored
// key falls back to Grok's default ask mode, never to a wider one.
function grokConfig(readOnly?: { bridge: boolean }, level?: 'ask' | 'auto') {
  if (!readOnly) return level === 'ask'
    ? `${baseConfig}[ui]\npermission_mode = "ask"\n[permission]\nask = ["Bash", "Edit", "Write"]\n`
    : level === 'auto' ? `${baseConfig}[ui]\npermission_mode = "auto"\n` : baseConfig
  const allowed = [...(GROK_NATIVE_WEB ? ['WebSearch', 'WebFetch'] : []), ...(readOnly.bridge ? [`MCPTool(${HARNESS_MCP_SERVER}__*)`] : [])]
  const allow = allowed.length ? `allow = ${JSON.stringify(allowed).replaceAll(',', ', ')}\n` : ''
  return `${baseConfig}[permission]\ndeny = ["Edit", "Write", "Bash(mkdir)", "Bash(touch)"]\n${allow}`
}
function bridgePath() {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const path of [join(here, 'grok-catalog.mjs'), resolve(here, '../../grok-catalog.mjs')])
    if (existsSync(path)) return path
  throw new Error('Grok catalog bridge 未安装，请重新构建插件')
}
/**
 * Windows refuses to replace a file while another start replaces or reads it
 * (EPERM/EACCES/EBUSY); the next attempt succeeds once that handle closes.
 */
async function publish(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to)
    } catch (e) {
      if (process.platform !== 'win32' || attempt >= 20 || !record(e) || !['EPERM', 'EACCES', 'EBUSY'].includes(String(e.code)))
        throw e
      await new Promise((resolve) => setTimeout(resolve, 10 + attempt * 10))
    }
  }
}
async function state(stateDirectory: string, project?: string, readOnly?: { bridge: boolean }, level?: 'ask' | 'auto') {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
  if ((await lstat(stateDirectory)).isSymbolicLink()) throw new Error('Unsafe Grok state symlink')
  await chmod(stateDirectory, 0o700)
  const parent = join(await realpath(stateDirectory), 'grok')
  const identity = project
    ? createHash('sha256')
        .update(await realpath(project))
        .digest('hex')
    : 'catalog'
  const root = join(parent, identity),
    home = join(root, 'home'),
    tmp = join(root, 'tmp')
  for (const path of [parent, root, home, tmp]) {
    await mkdir(path, { recursive: true, mode: 0o700 })
    if ((await lstat(path)).isSymbolicLink()) throw new Error('Unsafe Grok state symlink')
    await chmod(path, 0o700)
  }
  const configPath = join(home, 'config.toml')
  // Do not follow a modified state's configuration symlink when updating the safety defaults.
  try {
    if ((await lstat(configPath)).isSymbolicLink()) throw new Error('Unsafe Grok configuration symlink')
  } catch (e) {
    if (!record(e) || e.code !== 'ENOENT') throw e
  }
  // Tasks of one project share this state and may start together: each file is
  // published whole by rename, so a concurrent start never sees or races a gap.
  const temporary = (path: string) => `${path}.${randomUUID()}.tmp`
  const configTemporary = temporary(configPath)
  try {
    await writeFile(configTemporary, grokConfig(readOnly, level), { mode: 0o600, flag: 'wx' })
    await publish(configTemporary, configPath)
  } finally {
    await rm(configTemporary, { force: true })
  }
  if (project) {
    const original = join(homedir(), '.grok', 'auth.json'),
      target = join(home, 'auth.json')
    // This path is a derived worker reference, never an account source. Replace
    // the link itself so logout cannot be undone by a surviving worker copy.
    try {
      const existing = await lstat(target)
      if (!existing.isFile() && !existing.isSymbolicLink()) throw new Error('Unsafe Grok auth snapshot')
    } catch (e) {
      if (!record(e) || e.code !== 'ENOENT') throw e
    }
    if (process.platform !== 'win32' && existsSync(original)) {
      const link = temporary(target)
      try {
        await symlink(original, link)
        await publish(link, target)
      } finally {
        await rm(link, { force: true })
      }
    } else
      try {
        await unlink(target)
      } catch (e) {
        if (!record(e) || e.code !== 'ENOENT') throw e
      }
  }
  return {
    root,
    env: {
      GROK_HOME: home,
      GROK_AUTH_PATH: process.platform === 'win32' && project
        ? join(homedir(), '.grok', 'auth.json')
        : join(home, 'auth.json'),
      XAI_API_KEY: '',
      GROK_CODE_XAI_API_KEY: '',
      TMPDIR: tmp,
      GROK_MEMORY: '0',
      GROK_SUBAGENTS: '0',
      GROK_WORKFLOWS: '0',
      GROK_WEB_FETCH: GROK_NATIVE_WEB ? '1' : '0',
      GROK_TELEMETRY_ENABLED: '0',
      GROK_TELEMETRY_TRACE_UPLOAD: '0',
      GROK_TELEMETRY_MIXPANEL_ENABLED: '0',
    },
  }
}
/** Offline help/ACP verified; subscription-dependent task execution remains unverified. */
export async function prepareGrok(
  input: GrokInput,
): Promise<{ argv: string[]; env: Record<string, string> }> {
  assertGrokNativeEnvironment()
  if (!input.preference.model.trim()) throw new Error('Grok model must be selected')
  if (!EFFORTS.includes(input.preference.effort)) throw new Error('Invalid Grok effort')
  if (!['plan', 'accept-edits'].includes(input.mode)) throw new Error('Invalid Grok mode')
  if (!input.prompt.trim()) throw new Error('Prompt must not be empty')
  const prepared = await state(input.stateDirectory, input.project, input.mode === 'plan'
    ? { bridge: !!nativeHarnessReadyConnection({ cli: 'grok', harnessTools: input.harnessTools }, {}) }
    : undefined, input.mode === 'plan' || input.access === 'danger-full-access' ? undefined : input.access === 'workspace-write' ? 'auto' : 'ask')
  return {
    argv: [
      input.executable,
      '--cwd',
      input.project,
      '--model',
      input.preference.model,
      ...(input.preference.effort === 'default' ? [] : ['--reasoning-effort', input.preference.effort]),
      '--output-format',
      'streaming-json',
      '--permission-mode',
      input.mode !== 'plan' && input.access === 'danger-full-access' ? 'bypassPermissions' : 'default',
      '--no-memory',
      '--no-subagents',
      ...(GROK_NATIVE_WEB ? [] : ['--disable-web-search']),
      ...(input.mode === 'plan' ? ['--tools', GROK_PLAN_TOOLS.join(',')] : []),
      ...(input.conversationId ? ['--resume', input.conversationId] : []),
      '--single',
      `任务：\n${input.prompt}`,
    ],
    env: prepared.env,
  }
}
export async function discoverGrok(
  executable: string,
  capture: (argv: string[], env?: Record<string, string>, phase?: 'native-candidates') => Promise<string>,
  stateDirectory: string,
  options: { signal?: AbortSignal; home?: string; fetch?: typeof fetch } = {},
): Promise<ModelChoice[]> {
  options.signal?.throwIfAborted()
  assertGrokNativeEnvironment()
  const prepared = await state(stateDirectory)
  const raw: unknown = JSON.parse(
    await capture(
      [process.execPath, bridgePath(), executable, prepared.root],
      prepared.env,
      'native-candidates',
    ),
  )
  if (!Array.isArray(raw)) throw new Error('Invalid Grok catalog')
  const models = raw.map((x): ModelChoice => {
    if (
      !record(x) ||
      typeof x.id !== 'string' ||
      !x.id ||
      typeof x.label !== 'string' ||
      !Array.isArray(x.efforts)
    )
      throw new Error('Invalid Grok model')
    const efforts = x.efforts.filter(
      (v): v is Effort => typeof v === 'string' && EFFORTS.includes(v as Effort),
    )
    if (!efforts.length || efforts.length !== x.efforts.length)
      throw new Error('Unsupported Grok reasoning levels')
    return { id: x.id, label: x.label, efforts }
  })
  if (!models.length || new Set(models.map((x) => x.id)).size !== models.length)
    throw new Error('Grok 模型目录为空或重复')
  options.signal?.throwIfAborted()
  const version = await capture([executable, '--version'], prepared.env, 'native-candidates')
  options.signal?.throwIfAborted()
  return discoverGrokAccountModels(models, {
    ...options,
    nativeDynamicSchema: version.trim() === 'grok 1.0.0 (3cd0d0cbcebe)',
  })
}
/** Native streaming-json parser from installed 1.0.0 docs; no fabricated execution evidence. */
export class GrokProtocol {
  private responses = new GrokResponseTracker((event) => this.emit(event))
  private decoder = new StringDecoder('utf8')
  private pending = ''
  private response = ''
  private thought = ''
  private thoughtStep = 0
  private thoughtEmittedAt = 0
  private terminal = false
  private failure?: string
  private ended = false
  private tools = new Map<string, { step: number; name: string; done: boolean }>()
  result?: ProtocolResult
  conversationId?: string
  constructor(
    private emit: (event: EventInput) => void,
    private identify: (id: string) => void,
    private maxLineBytes: number,
  ) {}
  feed(chunk: Buffer | string) {
    if (this.ended) throw new Error('Grok stream already ended')
    this.pending += typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
    let end: number
    while ((end = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, end).trim()
      this.pending = this.pending.slice(end + 1)
      if (line) this.line(line)
    }
    if (Buffer.byteLength(this.pending) > this.maxLineBytes) throw new Error('CLI event exceeds maxLineBytes')
  }
  end() {
    if (this.ended) return
    this.pending += this.decoder.end()
    if (this.pending.trim()) this.line(this.pending.trim())
    this.pending = ''
    this.ended = true
    if (!this.conversationId) return
    if (this.thought && !this.terminal)
      this.responses.emit({ kind: 'reasoning', step: this.thoughtStep, text: 'Grok 公开思考', detail: this.thought, state: 'RUNNING' }, 'reasoning')
    this.responses.finish()
    const error =
      this.failure ??
      (!this.terminal
        ? 'Grok 缺少 end 终态'
        : [...this.tools.values()].some((x) => !x.done)
          ? 'Grok 工具没有完成结果'
          : undefined)
    this.result = {
      conversationId: this.conversationId,
      status: error ? 'ERROR' : 'SUCCESS',
      response: this.response,
      ...(error ? { error } : {}),
    }
    this.emit({
      kind: 'result',
      text: this.response,
      state: this.result.status,
      ...(error ? { detail: error } : {}),
    })
  }
  private id(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid Grok session identity')
    if (this.conversationId && this.conversationId !== value) throw new Error('Grok session identity changed')
    if (!this.conversationId) this.identify(value)
    this.conversationId = value
  }
  private line(line: string) {
    if (Buffer.byteLength(line) > this.maxLineBytes) throw new Error('CLI event exceeds maxLineBytes')
    const e: unknown = JSON.parse(line)
    if (!record(e) || typeof e.type !== 'string') throw new Error('Invalid Grok event')
    if (this.terminal) throw new Error('Unexpected event after Grok end')
    if (e.sessionId !== undefined) this.id(e.sessionId)
    if (e.type === 'thought') {
      if (e.redacted === true) return
      if (typeof e.data !== 'string') throw new Error('Invalid Grok public thought')
      this.thought += e.data
      const now = Date.now()
      if (now - this.thoughtEmittedAt < 200) return
      this.thoughtEmittedAt = now
      this.responses.emit({
        kind: 'reasoning',
        step: this.thoughtStep,
        text: 'Grok 公开思考',
        detail: this.thought,
        state: 'RUNNING',
      }, 'reasoning')
      return
    }
    if (e.type === 'text') {
      if (typeof e.data !== 'string') throw new Error('Invalid Grok text')
      this.response += e.data
      this.responses.emit({ kind: 'assistant', step: this.thoughtStep, text: e.data }, 'text')
      return
    }
    if (e.type === 'tool_call' || e.type === 'tool_call_update') {
      if (typeof e.toolCallId !== 'string' || !e.toolCallId) throw new Error('Missing Grok tool identity')
      let tool = this.tools.get(e.toolCallId)
      if (e.type === 'tool_call') {
        if (tool) throw new Error('Duplicate Grok tool identity')
        tool = { step: this.tools.size + 1, name: String(e.toolName ?? e.title ?? '工具'), done: false }
        this.tools.set(e.toolCallId, tool)
      }
      if (!tool || tool.done) throw new Error('Unmatched Grok tool update')
      if (['failed', 'error', 'denied', 'cancelled'].includes(String(e.status))) {
        this.failure = `Grok 工具失败或被拒绝：${tool.name}`
        tool.done = true
      } else if (e.status === 'completed') tool.done = true
      else if (e.status !== undefined && !['pending', 'in_progress'].includes(String(e.status)))
        this.failure = `Grok 未识别的工具状态：${String(e.status)}`
      this.responses.emit({
        kind: 'tool',
        text: tool.name,
        step: tool.step,
        state: String(e.status ?? 'running'),
        detail: JSON.stringify(e.type === 'tool_call' ? e.rawInput : (e.rawOutput ?? e.content)),
        toolCall: { callId: e.toolCallId, name: tool.name,
          ...(Object.hasOwn(e, 'rawInput') ? { input: e.rawInput } : {}),
          ...(Object.hasOwn(e, 'rawOutput') ? { output: e.rawOutput } :
            Object.hasOwn(e, 'content') && tool.done ? { output: e.content } : {}) },
      }, `tool:${e.toolCallId}`)
      return
    }
    if (e.type === 'end') {
      if (!this.conversationId) throw new Error('Missing Grok end session identity')
      if (this.thought)
        this.responses.emit({
          kind: 'reasoning',
          step: this.thoughtStep,
          text: 'Grok 公开思考',
          detail: this.thought,
          state: 'COMPLETED',
        }, 'reasoning')
      this.responses.finish()
      this.terminal = true
      if (e.stopReason !== 'end_turn') this.failure ??= `Grok 未正常完成：${String(e.stopReason)}`
      return
    }
    if (e.type === 'error' || e.type === 'max_turns_reached') {
      this.failure = typeof e.message === 'string' ? e.message : `Grok ${e.type}`
      this.emit({ kind: 'diagnostic', text: this.failure, state: 'error' })
      return
    }
    if (e.type === 'usage') {
      if (this.thought)
        this.responses.emit({
          kind: 'reasoning',
          step: this.thoughtStep,
          text: 'Grok 公开思考',
          detail: this.thought,
          state: 'COMPLETED',
        }, 'reasoning')
      // TurnUsage also projects a usage line on older backends, without the
      // response identity/reason. It cannot settle a per-response bill.
      this.responses.finish(typeof e.messageId === 'string' || typeof e.stopReason === 'string'
        ? grokResponseUsage(e.usage) : undefined)
      this.thought = ''
      this.thoughtStep++
      this.thoughtEmittedAt = 0
      return
    }
    if (e.type === 'plan') {
      // The native ACP plan exposes content/status/priority only. Never copy
      // opaque extension metadata into the public process view.
      const entries = Array.isArray(e.entries) ? e.entries : []
      const detail = entries
        .filter((entry) => record(entry) && typeof entry.content === 'string')
        .map((entry) => `${typeof entry.status === 'string' ? `[${entry.status}] ` : ''}${entry.content}`)
        .join('\n')
      if (detail) this.emit({ kind: 'diagnostic', step: 0, text: 'Grok 工作计划', detail })
      return
    }
    if (e.type === 'available_commands') return
    this.emit({ kind: 'diagnostic', text: `未识别 Grok 事件：${e.type}`, detail: line })
  }
}
