import { GOAL_OBJECTIVE_LIMIT } from '../shared/conversation-features.ts'
import {
  appendFileSync,
  closeSync,
  constants,
  chmodSync,
  existsSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { z } from 'zod'
import { conversationTelemetrySchema, lastRunUsageSnapshotSchema, sessionUsageSchema } from './conversation-telemetry.ts'
import { contextTelemetrySchema } from './context-telemetry.ts'
import { LANGUAGE_PREFERENCES, MAX_CONCURRENT_LIMIT, type CliSettings } from '../shared/cli-settings.ts'
import { parseNativeResponse } from './native-response.mjs'
import {
  RUNNING_MESSAGE_MODES,
  defaultRunningMessageMode,
  supportsNativeSteering,
  type RunningMessageMode,
  type RunningMessageSettings,
} from '../shared/running-message.ts'
import { BUILTIN_ROLE_PRESETS } from '../shared/builtin-presets.ts'
import {
  agentNameSchema,
  availableAgentName,
  NO_ROLE_LABEL,
  rolePresetInputSchema,
  rolePresetSchema,
  roleSnapshotSchema,
} from './roles.ts'
import {
  CLI_IDS,
  CLI_LABELS,
  CLI_SHORT_NAMES,
  EFFORTS,
  active,
  cliOf,
  workerName,
  isRetiredCli,
  isUserInterrupted,
  RETIRED_HARNESS_NOTICE,
  type CliId,
  type Preference,
  type RolePreset,
  type RoleSnapshot,
  type Worker,
  type WorkerEvent,
} from '../shared/types.ts'

const preferenceSchema = z.object({
  cli: z.enum(CLI_IDS).optional(),
  model: z.string().min(1),
  effort: z.enum(EFFORTS),
})
/** Complete dispatch choices stay Host-private; public preferences omit role and binding. */
export interface DispatchSetup {
  preference: Preference
  role: RoleSnapshot | null
  binding: string
}
const dispatchBindingSchema = z.string().min(1).max(256)
const cleanupBlockSchema = z
  .object({
    policy: z.literal(1),
    state: z.literal('cleanup-unconfirmed'),
  })
  .strict()
const projectPreferenceSchema = preferenceSchema.extend({
  dispatchRole: roleSnapshotSchema.nullable().optional(),
  dispatchBinding: dispatchBindingSchema.optional(),
})
const dispatchSetupSchema = z.object({
  preference: preferenceSchema,
  role: roleSnapshotSchema.nullable(),
  binding: dispatchBindingSchema,
})
const conversationSetupSchema = z.object({
  policy: z.literal(1),
  parent: z.string().min(1),
  project: z.string().min(1),
  cli: z.enum(CLI_IDS),
  setup: dispatchSetupSchema,
})
// Read old Harness settings without exposing that retired entry as an active CLI.
const storedCliSchema = z.enum([...CLI_IDS, 'harness'])
const storedPreferenceSchema = preferenceSchema.extend({ cli: storedCliSchema.optional() })
const cliSettingsSchema = z.object({ enabled: z.partialRecord(storedCliSchema, z.boolean()) })
/** Every field is optional: an absent value keeps the deployment default. */
const generalSettingsSchema = z.object({
  maxConcurrent: z.int().min(1).max(MAX_CONCURRENT_LIMIT).optional(),
  language: z.enum(LANGUAGE_PREFERENCES).optional(),
  isolatedParallelWrites: z.boolean().optional(),
  askBeforeDispatch: z.boolean().optional(),
})
export type StoredGeneralSettings = z.infer<typeof generalSettingsSchema>
const enabledByDefault = () => Object.fromEntries(CLI_IDS.map((cli) => [cli, true])) as CliSettings['enabled']
const runningMessageSchema = z
  .object({
    policy: z.union([z.literal(1), z.literal(2)]),
    project: z.string().min(1),
    cli: z.enum(CLI_IDS),
    mode: z.enum(RUNNING_MESSAGE_MODES),
  })
  .strict()
const workerSchema = z.object({
  id: z.uuid(),
  parentSessionId: z.string().min(1),
  project: z.string().min(1),
  title: z.string(),
  agentName: agentNameSchema.optional(),
  agentNameOrigin: z.enum(['auto', 'custom']).optional(),
  nameAliases: z.array(agentNameSchema).max(32).optional(),
  archivedAt: z.string().datetime().optional(),
  role: roleSnapshotSchema.optional(),
  preference: storedPreferenceSchema,
  mode: z.enum(['plan', 'accept-edits']),
  conversationId: z.string().optional(),
  previousConversationIds: z.array(z.string().min(1)).max(64).optional().catch(undefined),
  reboundConversationId: z.string().min(1).max(1024).optional().catch(undefined),
  carryoverRunId: z.uuid().optional().catch(undefined),
  // Bad optional telemetry must not make an otherwise valid conversation unreadable.
  conversationTelemetry: conversationTelemetrySchema.optional().catch(undefined),
  previousSessionUsage: sessionUsageSchema.optional().catch(undefined),
  lastRunUsageSnapshot: lastRunUsageSnapshotSchema.optional().catch(undefined),
  contextTelemetry: contextTelemetrySchema.optional().catch(undefined),
  contextInvalidatedRunId: z.uuid().optional().catch(undefined),
  harnessConversation: z.object({
    sessionId: z.string().min(1),
    parentSessionId: z.string().min(1),
    mode: z.literal('continuable'),
    capabilities: z.object({
      send: z.boolean(), queue: z.boolean(), steer: z.boolean(), stop: z.boolean(),
      model: z.boolean(), permission: z.boolean(), plan: z.boolean(), attachments: z.boolean(),
      fork: z.boolean(), skills: z.boolean(), tools: z.boolean(),
      // Bindings persisted before the feature bridge lack these keys.
      forkEarlier: z.boolean().default(false), goal: z.boolean().default(false), feedback: z.boolean().default(false),
    }),
    reasons: z.record(z.string(), z.string()).optional(),
  }).optional(),
  transport: z.string().min(1).max(128).optional(),
  goal: z
    .object({
      objective: z.string().min(1).max(GOAL_OBJECTIVE_LIMIT),
      status: z.enum(['active', 'paused']),
      revision: z.number().int().nonnegative(),
      updatedAt: z.string(),
    })
    .optional(),
  goalRevision: z.number().int().nonnegative().optional(),
  status: z.enum(['queued', 'running', 'stopping', 'completed', 'failed', 'interrupted', 'uncertain']),
  createdAt: z.string(),
  updatedAt: z.string(),
  runId: z.uuid(),
  jobId: z.string().optional(),
  error: z.string().optional(),
  interruptionReason: z.literal('user').optional(),
  observedModel: z.string().optional(),
  lastResult: z.string().optional(),
  isolation: z
    .object({
      state: z.enum(['preparing', 'ready', 'merging', 'conflict', 'released']),
      path: z.string().min(1),
      createdAt: z.string().optional(),
      conflicts: z.array(z.object({ path: z.string(), reason: z.string() })).max(200).optional(),
      skippedLinks: z.number().int().nonnegative().optional(),
      message: z.string().max(2000).optional(),
    })
    .optional(),
  isolationNotice: z.string().max(2000).optional(),
  resultNotice: z.string().max(2000).optional(),
})
const eventSchema = z.object({
  requestState: z.object({
    nativeRunId: z.string().regex(/^[\w-]{1,256}$/),
    sequence: z.number().int().safe().positive(),
    phase: z.enum(['requesting', 'failed', 'completed']),
    statusCode: z.number().int().min(100).max(599).optional(),
    reason: z.string().regex(/^[a-z_]{1,80}$/).optional(),
    retryCount: z.number().int().safe().nonnegative().optional(),
    retryable: z.boolean().optional(),
  }).optional(),
  seq: z.number().int().positive(),
  runId: z.uuid(),
  time: z.string(),
  kind: z.enum(['user', 'assistant', 'reasoning', 'tool', 'status', 'diagnostic', 'result', 'submission']),
  text: z.string(),
  observedModel: z.string().optional(),
  step: z.number().optional(),
  state: z.string().optional(),
  detail: z.string().optional(),
  response: z.unknown().transform((value, context) => {
    if (value === undefined) return undefined
    try { return parseNativeResponse(value) }
    catch { context.addIssue({ code: 'custom', message: 'Invalid native response metadata' }); return z.NEVER }
  }).optional(),
  toolCall: z
    .object({
      callId: z.string().min(1).max(1024).optional(),
      parentCallId: z.string().min(1).max(1024).optional(),
      name: z.string().min(1).max(1024).optional(),
      input: z.unknown().optional(),
      output: z.unknown().optional(),
      command: z.string().max(32768).optional(),
      exitCode: z.number().int().safe().optional(),
    })
    .optional(),
  resultScope: z.enum(['run', 'response']).optional(),
  queuedFollowupId: z.uuid().optional(),
  deliveryState: z
    .enum(['pending', 'admitted', 'running', 'superseded', 'cancelled', 'failed', 'completed'])
    .optional(),
  deliveryError: z.string().optional(),
  admittedRunId: z.uuid().optional(),
  submissionClientId: z.uuid().optional(),
  submissionSequence: z.number().int().nonnegative().optional(),
})

export function atomicJSON(path: string, value: unknown): void {
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
    renameSync(temp, path)
  } finally {
    if (existsSync(temp)) rmSync(temp)
  }
}

const LOCK_CLAIM = /^host\.lock\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
function readLockOwner(path: string): { pid: number; token?: string } | 'missing' | 'invalid' {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid'
  }
  try {
    const owner = JSON.parse(raw) as { pid?: unknown; token?: unknown }
    if (!Number.isSafeInteger(owner?.pid) || (owner.pid as number) <= 0) return 'invalid'
    return { pid: owner.pid as number, ...(typeof owner.token === 'string' ? { token: owner.token } : {}) }
  } catch {
    return 'invalid'
  }
}
/** EPERM still proves that a process with this PID exists. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/** One host owns a private store; a live second host cannot resume the same CLI session. */
export class WorkerStorage {
  readonly workers = new Map<string, Worker>()
  private events = new Map<string, WorkerEvent[]>()
  private token = randomUUID()
  private lock: string
  private candidate: string
  private enabled = enabledByDefault()
  private general: StoredGeneralSettings = {}
  private presets: RolePreset[] = []
  /** Account epochs live outside public Worker records and event/history responses. */
  accountBinding(id: string): string | undefined {
    z.uuid().parse(id)
    const path = join(this.directory, `${id}.account-binding.json`)
    if (!existsSync(path)) return undefined
    return z
      .object({ policy: z.literal(1), binding: z.string().min(1).max(256) })
      .parse(JSON.parse(readFileSync(path, 'utf8'))).binding
  }
  bindAccount(id: string, binding: string): void {
    z.uuid().parse(id)
    z.string().min(1).max(256).parse(binding)
    atomicJSON(join(this.directory, `${id}.account-binding.json`), { policy: 1, binding })
  }
  /** Private quarantine survives Host restart; absence alone means no recorded quarantine. */
  cleanupBlockState(cli?: CliId): 'none' | 'blocked' | 'invalid' {
    const path = this.cleanupBlockPath(cli)
    let handle: number | undefined
    let buffer: Buffer | undefined
    try {
      let entry
      try {
        entry = lstatSync(path)
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'none' : 'invalid'
      }
      if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1 || entry.size > 1024)
        return 'invalid'
      handle = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      const before = fstatSync(handle)
      if (
        !before.isFile() ||
        before.nlink !== 1 ||
        before.dev !== entry.dev ||
        before.ino !== entry.ino ||
        before.size > 1024
      )
        return 'invalid'
      buffer = Buffer.alloc(1025)
      let offset = 0
      while (offset < buffer.length) {
        const size = readSync(handle, buffer, offset, buffer.length - offset, null)
        if (!size) break
        offset += size
      }
      const after = fstatSync(handle),
        current = lstatSync(path)
      if (
        offset !== before.size ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        current.isSymbolicLink() ||
        current.nlink !== 1 ||
        current.dev !== before.dev ||
        current.ino !== before.ino ||
        current.size !== after.size ||
        current.mtimeMs !== after.mtimeMs
      )
        return 'invalid'
      cleanupBlockSchema.parse(JSON.parse(buffer.subarray(0, offset).toString('utf8')))
      return 'blocked'
    } catch {
      return 'invalid'
    } finally {
      buffer?.fill(0)
      if (handle !== undefined) closeSync(handle)
    }
  }
  /** No automatic clearing: only trustworthy process-exit recovery can release a quarantine. */
  blockCleanup(cli?: CliId): void {
    atomicJSON(this.cleanupBlockPath(cli), { policy: 1, state: 'cleanup-unconfirmed' })
  }
  private cleanupBlockPath(cli?: CliId): string {
    // Only a known read-only query boundary may choose this narrower scope.
    // Old unattributed/task markers retain their original global meaning.
    return join(this.directory, cli === undefined
      ? 'cleanup-blocked.json'
      : `cleanup-blocked-${z.enum(CLI_IDS).parse(cli)}.json`)
  }
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
    this.lock = join(directory, 'host.lock')
    this.candidate = join(directory, `host.lock.${this.token}`)
    this.acquireLock()
    try {
      const rolesPath = join(directory, 'role-presets.json')
      if (existsSync(rolesPath)) {
        this.presets = z
          .array(rolePresetSchema)
          .max(200)
          .parse(JSON.parse(readFileSync(rolesPath, 'utf8')))
        chmodSync(rolesPath, 0o600)
      } else {
        this.presets = z.array(rolePresetSchema).parse(structuredClone(BUILTIN_ROLE_PRESETS))
        atomicJSON(rolesPath, this.presets)
      }
      const settingsPath = join(directory, 'cli-settings.json')
      if (existsSync(settingsPath)) {
        const settings = cliSettingsSchema.parse(JSON.parse(readFileSync(settingsPath, 'utf8')))
        for (const cli of CLI_IDS) {
          if (settings.enabled[cli] !== undefined) this.enabled[cli] = settings.enabled[cli]
        }
        chmodSync(settingsPath, 0o600)
      }
      const generalPath = join(directory, 'general-settings.json')
      if (existsSync(generalPath)) {
        this.general = generalSettingsSchema.parse(JSON.parse(readFileSync(generalPath, 'utf8')))
        chmodSync(generalPath, 0o600)
      }
      for (const file of readdirSync(directory).filter((name) => name.endsWith('.worker.json'))) {
        const worker = workerSchema.parse(JSON.parse(readFileSync(join(directory, file), 'utf8')))
        if (`${worker.id}.worker.json` !== file) throw new Error('Worker storage identity mismatch')
        this.workers.set(worker.id, worker)
        if (active(worker.status)) {
          worker.status = 'interrupted'
          worker.interruptionReason = undefined
          worker.error =
            worker.preference.cli === 'harness'
              ? RETIRED_HARNESS_NOTICE
              : '上次 Harness 运行中断；可继续原会话'
          this.save(worker)
          this.append(worker, { kind: 'status', text: worker.error, state: 'interrupted' })
        } else if (isUserInterrupted(worker) && worker.error) {
          // Normalize only the exact stop receipts from older plugin versions.
          // Keep the original event log intact as evidence of that older run.
          worker.error = undefined
          worker.interruptionReason = 'user'
          this.save(worker)
        }
      }
      this.migrateAutomaticNames()
      this.migrateRunningMessageSettings()
    } catch (error) {
      this.close()
      throw error
    }
  }
  /** Explicitly authorized one-time native-capability reset; later manual choices use policy 2. */
  private migrateRunningMessageSettings(): void {
    for (const name of readdirSync(this.directory).filter((file) => file.endsWith('.running-message.json'))) {
      const path = join(this.directory, name)
      let value: z.infer<typeof runningMessageSchema>
      try {
        value = this.readRunningMessageRecord(path)
        if (`${this.projectKey(value.project, value.cli)}.running-message.json` !== name) continue
      } catch {
        // A bad file remains untouched and is reported by its normal settings read.
        continue
      }
      if (value.policy === 1)
        atomicJSON(path, { ...value, policy: 2, mode: defaultRunningMessageMode(value.cli) })
    }
  }
  private readRunningMessageRecord(path: string): z.infer<typeof runningMessageSchema> {
    const info = lstatSync(path)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 16_384)
      throw new Error('运行中发送设置无法核验')
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const opened = fstatSync(fd)
      if (
        !opened.isFile() ||
        opened.ino !== info.ino ||
        opened.dev !== info.dev ||
        opened.nlink !== 1 ||
        opened.size > 16_384
      )
        throw new Error('运行中发送设置身份已变化')
      const bytes = Buffer.alloc(opened.size + 1)
      let length = 0
      while (length < bytes.length) {
        const read = readSync(fd, bytes, length, bytes.length - length, null)
        if (!read) break
        length += read
      }
      const after = fstatSync(fd),
        current = lstatSync(path)
      if (
        length !== opened.size ||
        after.size !== opened.size ||
        after.mtimeMs !== opened.mtimeMs ||
        after.nlink !== 1 ||
        current.isSymbolicLink() ||
        current.nlink !== 1 ||
        current.ino !== opened.ino ||
        current.dev !== opened.dev ||
        current.size !== after.size ||
        current.mtimeMs !== after.mtimeMs
      )
        throw new Error('运行中发送设置读取期间发生变化')
      return runningMessageSchema.parse(JSON.parse(bytes.subarray(0, length).toString('utf8')))
    } finally {
      closeSync(fd)
    }
  }
  /** Only the former CLI-default format and unnamed histories establish legacy automatic names. */
  private migrateAutomaticNames(): void {
    const ordered = [...this.workers.values()].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )
    for (const worker of ordered) {
      const cli = cliOf(worker.preference)
      if (isRetiredCli(cli) || worker.agentNameOrigin === 'custom') continue
      const previousName = workerName(worker)
      const stem = CLI_SHORT_NAMES[cli]
      const isNumbered = (name: string, prefix: string) =>
        name.startsWith(`${prefix}-`) && /^[1-9]\d*$/.test(name.slice(prefix.length + 1))
      if (worker.agentName && isNumbered(worker.agentName, stem)) continue
      if (
        worker.agentName &&
        worker.agentNameOrigin !== 'auto' &&
        !isNumbered(worker.agentName, `${CLI_LABELS[cli]}助手`)
      )
        continue
      // A malformed old duplicate cannot safely acquire a compatibility alias.
      if (
        ordered.some(
          (other) =>
            other.id !== worker.id &&
            other.parentSessionId === worker.parentSessionId &&
            [workerName(other), ...(other.nameAliases ?? [])].some(
              (name) => name.toLocaleLowerCase() === previousName.toLocaleLowerCase(),
            ),
        )
      )
        continue
      const migrated: Worker = {
        ...worker,
        agentName: availableAgentName(this.workers.values(), worker.parentSessionId, stem),
        agentNameOrigin: 'auto',
        nameAliases: [...new Set([...(worker.nameAliases ?? []), previousName])],
      }
      // Validate the additional compatibility data before its atomic write.
      workerSchema.parse(migrated)
      this.save(migrated)
    }
  }
  cliSettings(): CliSettings {
    return { enabled: { ...this.enabled } }
  }
  generalSettings(): StoredGeneralSettings {
    return { ...this.general }
  }
  /** Merges one validated patch; `null` restores that field's deployment default. */
  setGeneralSettings(patch: unknown): StoredGeneralSettings {
    const changes = z
      .object({
        maxConcurrent: z.int().min(1).max(MAX_CONCURRENT_LIMIT).nullable().optional(),
        language: z.enum(LANGUAGE_PREFERENCES).nullable().optional(),
        isolatedParallelWrites: z.boolean().nullable().optional(),
        askBeforeDispatch: z.boolean().nullable().optional(),
      })
      .strict()
      .parse(patch)
    const next: Record<string, unknown> = { ...this.general }
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) delete next[key]
      else if (value !== undefined) next[key] = value
    }
    const parsed = generalSettingsSchema.parse(next)
    atomicJSON(join(this.directory, 'general-settings.json'), parsed)
    this.general = parsed
    return this.generalSettings()
  }
  rolePresets(): RolePreset[] {
    return structuredClone(this.presets)
  }
  saveRolePreset(input: unknown): RolePreset {
    const value = rolePresetInputSchema.parse(input)
    const previous = value.id ? this.presets.find((preset) => preset.id === value.id) : undefined
    if (value.id && !previous) throw new Error('此角色预设已删除，请新建预设')
    if (
      value.name === NO_ROLE_LABEL ||
      this.presets.some(
        (preset) =>
          preset.id !== value.id && preset.name.toLocaleLowerCase() === value.name.toLocaleLowerCase(),
      )
    )
      throw new Error('此智能体名称已被使用，请换一个名称')
    if (!previous && this.presets.length >= 200) throw new Error('最多保存 200 个角色预设')
    const saved: RolePreset = { ...previous, ...value, id: previous?.id ?? randomUUID() }
    const next = previous
      ? this.presets.map((preset) => (preset.id === saved.id ? saved : preset))
      : [...this.presets, saved]
    atomicJSON(join(this.directory, 'role-presets.json'), next)
    this.presets = next
    return structuredClone(saved)
  }
  deleteRolePreset(id: string): void {
    if (!this.presets.some((preset) => preset.id === id)) throw new Error('此角色预设已删除')
    const next = this.presets.filter((preset) => preset.id !== id)
    atomicJSON(join(this.directory, 'role-presets.json'), next)
    this.presets = next
  }
  setCliEnabled(cli: CliId, enabled: boolean): CliSettings {
    if (isRetiredCli(cli)) throw new Error(RETIRED_HARNESS_NOTICE)
    const id = z.enum(CLI_IDS).parse(cli)
    const next = { ...this.enabled, [id]: z.boolean().parse(enabled) }
    atomicJSON(join(this.directory, 'cli-settings.json'), { enabled: next })
    this.enabled = next
    return this.cliSettings()
  }
  private projectKey(project: string, cli: CliId = 'antigravity'): string {
    z.string().min(1).parse(project)
    z.enum(CLI_IDS).parse(cli)
    return createHash('sha256')
      .update(cli === 'antigravity' ? project : JSON.stringify([project, cli]))
      .digest('hex')
  }
  private readProjectPreference(project: string, cli: CliId) {
    const path = join(this.directory, `${this.projectKey(project, cli)}.preference.json`)
    if (!existsSync(path)) return undefined
    const value = projectPreferenceSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    if ((value.cli ?? 'antigravity') !== cli) throw new Error('项目偏好的 CLI 标识不匹配')
    return value
  }
  runningMessageSettings(project: string, cli: CliId): RunningMessageSettings {
    if (isRetiredCli(cli)) return { cli, mode: 'queue', canSteer: false }
    const path = join(this.directory, `${this.projectKey(project, cli)}.running-message.json`)
    let mode = defaultRunningMessageMode(cli)
    if (existsSync(path)) {
      const value = this.readRunningMessageRecord(path)
      if (value.project !== project || value.cli !== cli) throw new Error('运行中发送设置的项目或 CLI 不匹配')
      if (value.mode === 'steer' && !supportsNativeSteering(cli))
        throw new Error('此 CLI 不支持引导，请重新选择运行中发送方式')
      mode = value.mode
    }
    return { cli, mode, canSteer: supportsNativeSteering(cli) }
  }
  setRunningMessageMode(project: string, cli: CliId, mode: RunningMessageMode): RunningMessageSettings {
    if (isRetiredCli(cli)) throw new Error(RETIRED_HARNESS_NOTICE)
    const value = runningMessageSchema.parse({ policy: 2, project, cli, mode })
    if (mode === 'steer' && !supportsNativeSteering(cli))
      throw new Error('此 CLI 不支持引导，请选择插队或排队')
    atomicJSON(join(this.directory, `${this.projectKey(project, cli)}.running-message.json`), value)
    return { cli, mode, canSteer: supportsNativeSteering(cli) }
  }
  preference(project: string, cli: CliId = 'antigravity'): Preference | undefined {
    if (isRetiredCli(cli)) return undefined
    const value = this.readProjectPreference(project, cli)
    return value ? preferenceSchema.parse(value) : undefined
  }
  setPreference(project: string, preference: Preference): void {
    if (preference.cli && isRetiredCli(preference.cli)) throw new Error(RETIRED_HARNESS_NOTICE)
    const value = preferenceSchema.parse(preference)
    const cli = value.cli ?? 'antigravity'
    const previous = this.readProjectPreference(project, cli)
    atomicJSON(join(this.directory, `${this.projectKey(project, cli)}.preference.json`), {
      ...previous,
      ...value,
    })
  }
  dispatchSetup(project: string, cli: CliId): DispatchSetup | undefined {
    if (isRetiredCli(cli)) return undefined
    const value = this.readProjectPreference(project, cli)
    // Missing fields are legacy/incomplete selections, never an implicit no-role choice.
    if (value?.dispatchRole === undefined || value.dispatchBinding === undefined) return undefined
    return {
      preference: preferenceSchema.parse(value),
      role: value.dispatchRole,
      binding: value.dispatchBinding,
    }
  }
  setDispatchSetup(project: string, setup: DispatchSetup): void {
    if (setup.preference.cli && isRetiredCli(setup.preference.cli)) throw new Error(RETIRED_HARNESS_NOTICE)
    const value = dispatchSetupSchema.parse(setup)
    const cli = value.preference.cli ?? 'antigravity'
    atomicJSON(join(this.directory, `${this.projectKey(project, cli)}.preference.json`), {
      ...value.preference,
      dispatchRole: value.role,
      dispatchBinding: value.binding,
    })
  }
  private conversationKey(parent: string, project: string, cli: CliId): string {
    z.string().min(1).parse(parent)
    z.string().min(1).parse(project)
    z.enum(CLI_IDS).parse(cli)
    return createHash('sha256')
      .update(JSON.stringify([parent, project, cli]))
      .digest('hex')
  }
  conversationSetup(parent: string, project: string, cli: CliId): DispatchSetup | undefined {
    if (isRetiredCli(cli)) return undefined
    const path = join(this.directory, `${this.conversationKey(parent, project, cli)}.conversation-setup.json`)
    if (!existsSync(path)) return undefined
    const value = conversationSetupSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    if (
      value.parent !== parent ||
      value.project !== project ||
      value.cli !== cli ||
      (value.setup.preference.cli ?? 'antigravity') !== cli
    )
      throw new Error('对话派遣设定的身份不匹配')
    return value.setup
  }
  setConversationSetup(parent: string, project: string, setup: DispatchSetup): void {
    if (setup.preference.cli && isRetiredCli(setup.preference.cli)) throw new Error(RETIRED_HARNESS_NOTICE)
    const value = dispatchSetupSchema.parse(setup)
    const cli = value.preference.cli ?? 'antigravity'
    const key = this.conversationKey(parent, project, cli)
    atomicJSON(join(this.directory, `${key}.conversation-setup.json`), {
      policy: 1,
      parent,
      project,
      cli,
      setup: value,
    })
  }
  save(worker: Worker): void {
    atomicJSON(join(this.directory, `${worker.id}.worker.json`), worker)
    this.workers.set(worker.id, worker)
  }
  history(id: string): WorkerEvent[] {
    if (!this.workers.has(id)) throw new Error('Unknown worker')
    const cached = this.events.get(id)
    if (cached) return cached
    const path = join(this.directory, `${id}.events.jsonl`)
    const rows: WorkerEvent[] = []
    if (existsSync(path)) {
      const raw = readFileSync(path)
      // Only a torn final append is discarded. Earlier corruption is never silently skipped.
      const end = raw.lastIndexOf(0x0a) + 1
      const complete = raw.subarray(0, end).toString('utf8').split('\n').slice(0, -1)
      for (const line of complete) {
        const event = eventSchema.parse(JSON.parse(line))
        if (event.seq !== rows.length + 1) throw new Error('Event sequence corruption')
        rows.push(event)
      }
      if (end !== raw.length) {
        // Shrink in place to the last complete newline. Rewriting would first
        // truncate the whole file, so a failed write could lose complete events.
        const handle = openSync(path, 'r+')
        try {
          ftruncateSync(handle, end)
          fsyncSync(handle)
        } finally {
          closeSync(handle)
        }
      }
    }
    this.events.set(id, rows)
    return rows
  }
  append(worker: Worker, event: Omit<WorkerEvent, 'seq' | 'runId' | 'time'>): void {
    const rows = this.history(worker.id)
    const row = { ...event, seq: rows.length + 1, runId: worker.runId, time: new Date().toISOString() }
    appendFileSync(join(this.directory, `${worker.id}.events.jsonl`), JSON.stringify(row) + '\n', {
      mode: 0o600,
    })
    rows.push(row)
  }
  rawPath(worker: Worker): string {
    return join(this.directory, `${worker.id}.${worker.runId}.raw.jsonl`)
  }
  /**
   * Cross-process exclusion without a native flock: every Host atomically
   * publishes a uniquely named claim, then looks for any other live claim.
   * Two concurrent Hosts each write before they read, so at least one sees the
   * other and withdraws. Stale claims are removed only by their unique name,
   * so a live Host's claim is never deleted by a racing reclaimer.
   */
  private acquireLock(): void {
    const body = JSON.stringify({ pid: process.pid, token: this.token })
    for (let attempt = 0; ; attempt++) {
      const temp = join(this.directory, `.host.lock.${this.token}.tmp`)
      try {
        writeFileSync(temp, body, { mode: 0o600, flag: 'wx' })
        renameSync(temp, this.candidate)
      } finally {
        rmSync(temp, { force: true })
      }
      const stale: string[] = []
      let conflict: 'live' | { invalid: string } | undefined
      for (const name of readdirSync(this.directory)) {
        const path = join(this.directory, name)
        if (path === this.candidate || (name !== 'host.lock' && !LOCK_CLAIM.test(name))) continue
        const owner = readLockOwner(path)
        if (owner === 'missing') continue
        if (owner === 'invalid') conflict = { invalid: name }
        else if (processAlive(owner.pid)) conflict ??= 'live'
        else if (name !== 'host.lock') stale.push(path)
        if (conflict && conflict !== 'live') break
      }
      if (!conflict) {
        for (const path of stale) rmSync(path, { force: true })
        break
      }
      rmSync(this.candidate, { force: true })
      if (conflict !== 'live') throw new Error(`Invalid store lock; inspect ${conflict.invalid} before recovery`)
      if (attempt >= 2) throw new Error('CLI Worker store is already owned by another Harness host')
      // Simultaneous claimants may both withdraw; a random pause breaks the tie.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 + Math.floor(Math.random() * 80))
    }
    // Keep the established name for older plugin builds and existing checks.
    // Only an older build that does not publish claims can still race here.
    try {
      try {
        writeFileSync(this.lock, body, { mode: 0o600, flag: 'wx' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const owner = readLockOwner(this.lock)
        if (owner === 'invalid') throw new Error('Invalid store lock; inspect host.lock before recovery')
        if (owner !== 'missing' && processAlive(owner.pid))
          throw new Error('CLI Worker store is already owned by another Harness host')
        rmSync(this.lock, { force: true })
        writeFileSync(this.lock, body, { mode: 0o600, flag: 'wx' })
      }
    } catch (error) {
      rmSync(this.candidate, { force: true })
      throw error
    }
  }
  close(): void {
    for (const path of [this.lock, this.candidate]) {
      const owner = readLockOwner(path)
      if (typeof owner === 'object' && owner.token === this.token) rmSync(path, { force: true })
    }
  }
}
