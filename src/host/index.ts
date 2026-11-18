import { SettingsConnectionCache } from './settings-connection-cache.ts'
import { CustomProviders } from './custom-provider.ts'
import { CliManagementService } from './cli-management/service.ts'
import { isWorkBuddyCli } from './workbuddy-variant.ts'
import { WorkBuddyUnavailableError } from './workbuddy-installation.ts'
import { DshSubagents, readDshChildren } from './dsh-subagents.ts'
import { SettingsCatalogCache } from './settings-catalog-cache.ts'
import { resolveModel } from '../shared/models.ts'
import { visibleModelChoices } from '../shared/model-presentation.ts'
import { Context, withProps } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as validate } from 'zod'
import { join } from 'node:path'
import { HarnessConversationStore } from './harness-conversation-store.ts'
import type { HarnessConversationApi } from './harness-conversation-types.ts'
import { publishSiblingOutsideTool } from './harness-model-guard.ts'
import type { NativeAttachment } from './native-attachments.mjs'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-subprocess'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-plan-mode'
import { type RunOrigin } from './native-approval-policy.ts'
import {
  CLI_LABELS,
  cliOf,
  workerName,
  effortLabel,
  type CliId,
  type Preference,
  type TaskMode,
  type RoleSnapshot,
  type Worker,
} from '../shared/types.ts'
import { agentNameSchema, readRoleAnswer, roleQuestion } from './roles.ts'
import {
  DEFAULT_CONFIG,
  machineDirectory,
  ProcessCleanupUnconfirmedError,
  type ProcessBackend,
  type RuntimeConfig,
} from './process.ts'
import { validatePreference, configuredCliExecutable, resolveCliExecutable } from './adapters.ts'
import { RUNNING_MESSAGE_MODES } from '../shared/running-message.ts'
import { type WorkerPermissionReceipt } from '../shared/worker-permissions.ts'
import { WindowsCliNotFoundError } from './windows-cli-installation.ts'
import { type DispatchSetup } from './storage.ts'
import { WorkerRuntime, type Submission } from './runtime.ts'
import { integrationReport, isolationGuidance, readResolutions } from './isolated-merge-decisions.ts'
import { AccountManager } from './accounts.ts'
import {
  CLI_NAME_GUIDANCE,
  requireCliName,
  resolveCliName,
  isGenericQoderName,
  isGenericWorkBuddyName,
  resolveAvailableWorkBuddyName,
  resolveAvailableCliName,
} from './routing.ts'
import { failure, waitForInput } from './service-errors.ts'
import { preferenceSchema } from './service-models.ts'
import * as harness from './service-harness.ts'
import * as history from './service-history.ts'
import * as workers from './service-workers.ts'
import * as settings from './service-settings.ts'
import * as cliUpdates from './service-cli-updates.ts'
import * as accounts from './service-accounts.ts'
import * as connections from './service-connections.ts'
import * as models from './service-models.ts'
import * as permissions from './service-permissions.ts'
import * as lifecycle from './service-lifecycle.ts'

const messageSubmissionSchema = validate
  .object({
    id: validate.uuid(),
    clientId: validate.uuid(),
    sequence: validate.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    prompt: validate
      .string()
      .min(1)
      .max(100_000)
      .refine((text) => !!text.trim()),
    mode: validate.enum(RUNNING_MESSAGE_MODES),
    intent: validate.enum(['direct', 'running']),
    expectedRunId: validate.string().min(1).max(128),
  })
  .strict()

export type {
  Preference,
  Worker,
  WorkerSnapshot,
  ModelChoice,
  TimelineItem,
  TaskMode,
  Effort,
  WorkerStatus,
  RolePreset,
  RoleSnapshot,
} from '../shared/types.ts'

/** Deployment settings; all values are resolved by the plugin schema. */
export interface Config {
  /** CLI binary or absolute path (default agy). */
  executable?: string
  /** Codex CLI executable. */
  codexExecutable?: string
  /** Claude Code executable. */
  claudeExecutable?: string
  /** Kimi Code executable. */
  kimiExecutable?: string
  /** Official Xiaomi MiMo Code executable. */
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
  codebuddyExecutable?: string
  traecnExecutable?: string
  workbuddycnExecutable?: string
  workbuddyExecutable?: string
  zcodeAuthDirectory?: string
  zcodeBuiltinConfig?: string
  /** @deprecated Accepted for old deployments only; never read or forwarded. */
  zaiCredentialRef?: string
  /** Optional private state directory; defaults to DSH_HOME/cliworker-now. */
  stateDirectory?: string
  /** Maximum concurrent processes (default 2). */
  maxConcurrent?: number
  /** Maximum turn duration in milliseconds (default 1800000). */
  timeoutMs?: number
  /** Process termination grace in milliseconds (default 5000). */
  graceMs?: number
  /** Maximum NDJSON line bytes (default 1048576). */
  maxLineBytes?: number
  /** Maximum output bytes per run (default 16777216); for native CLIs, the run's display budget. */
  maxRunBytes?: number
  /** Maximum bytes of one native CLI protocol frame (default 33554432). */
  maxNativeLineBytes?: number
  /** Maximum shown bytes of one native tool output or reasoning block (default 262144). */
  maxToolPreviewBytes?: number
  /** Maximum logical timeline rows in one live view (default 1000). */
  maxTimelineItems?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** CLI worker lifecycle and browser API. */ cliworker: CliWorkerService
  }
}

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    cliworker: 'cliworker'
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** CLI worker operation could not proceed; unknown delivery must not be resent. */ 'cliworker/unavailable': {
      reason: string
      deliveryUnknown?: boolean
    }
  }
}
// Typert embeds the Remote signature text in Host metadata, including whitespace and trailing commas.
/** Host owner of CLI conversations, model tools and Remote streams. */
export class CliWorkerService extends TypertRemoteService {
  static inject = [
    'agents',
    'tools',
    'systemPrompt',
    'jobs',
    'subprocess',
    'userQuestions',
    'sandboxPolicy',
    'typert',
  ]
  static Config: z<Config> = z.object({
    executable: z.string().min(1).default(DEFAULT_CONFIG.executable),
    codexExecutable: z.string().min(1).default('codex'),
    claudeExecutable: z.string().min(1).default('claude'),
    kimiExecutable: z.string().min(1).default('kimi'),
    mimoExecutable: z.string().min(1).default('mimo'),
    zcodeExecutable: z.string(),
    grokExecutable: z.string(),
    ompExecutable: z.string(),
    piExecutable: z.string(),
    hermesExecutable: z.string(),
    hermesHome: z.string(),
    opencodeExecutable: z.string(),
    qoderExecutable: z.string().min(1).default('qoder'),
    qodercnExecutable: z.string().min(1).default('qodercn'),
    codebuddyExecutable: z.string().min(1).default('codebuddy'),
    traecnExecutable: z.string().min(1).default('traecli'),
    workbuddycnExecutable: z.string().min(1).default('workbuddycn'),
    workbuddyExecutable: z.string().min(1).default('workbuddy'),
    zcodeAuthDirectory: z.string(),
    zcodeBuiltinConfig: z.string(),
    zaiCredentialRef: z.string(),
    stateDirectory: z.string(),
    maxConcurrent: z.natural().min(1).max(8).default(DEFAULT_CONFIG.maxConcurrent),
    timeoutMs: z.natural().min(1000).max(86400000).default(DEFAULT_CONFIG.timeoutMs),
    graceMs: z.natural().min(100).max(30000).default(DEFAULT_CONFIG.graceMs),
    maxLineBytes: z.natural().min(1024).default(DEFAULT_CONFIG.maxLineBytes),
    maxRunBytes: z.natural().min(1024).default(DEFAULT_CONFIG.maxRunBytes),
    maxNativeLineBytes: z.natural().min(1024).max(67_108_864).default(DEFAULT_CONFIG.maxNativeLineBytes!),
    maxToolPreviewBytes: z.natural().min(1024).default(DEFAULT_CONFIG.maxToolPreviewBytes!),
    maxTimelineItems: z.natural().min(10).default(DEFAULT_CONFIG.maxTimelineItems),
  })

  private context?: ServiceContext
  private get host(): ServiceContext {
    const context = (this.context ??= new ServiceContext(this.ctx, this))
    // Cordis overlays ctx on the receiver at each call site. Keep state shared across those scopes.
    return context.remote === this ? context : withProps(context, { ctx: this.ctx, remote: this })
  }

  /** @param ctx - Harness services. @param config - Validated deployment options. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'cliworker', { namespace: 'cliworker' })
    lifecycle.initialize(this.host, ctx, config)
  }
  /** @param parentSessionId - Owning Harness parent. @param workerId - Existing Worker identity. @param signal - View lifetime. @returns Real native child binding; opening never submits the user task again. */
  @Remote('ensureHarnessConversation')
  async ensureHarnessConversation(
    parentSessionId: string,
    workerId: string,
    signal: AbortSignal,
  ): Promise<string> {
    return harness.ensureHarnessConversation(this.host, parentSessionId, workerId, signal)
  }
  /** @param parentSessionId - Exact owning parent. @param workerId - Existing Worker. @param expectedSessionId - Failed display binding shown by this Client. @param signal - Explicit repair lifetime. @returns Replacement display binding; never submits a CLI prompt. */
  @Remote('repairHarnessConversation')
  async repairHarnessConversation(
    parentSessionId: string,
    workerId: string,
    expectedSessionId: string,
    signal: AbortSignal,
  ): Promise<string> {
    return harness.repairHarnessConversation(this.host, parentSessionId, workerId, expectedSessionId, signal)
  }
  /** @param parentSessionId - Main conversation. @param signal - Read lifetime. @returns Native direct children JSON. */
  @Remote('listDshSubagents')
  async listDshSubagents(parentSessionId: string, signal: AbortSignal): Promise<string> {
    return harness.listDshSubagents(this.host, parentSessionId, signal)
  }
  /** @param parentSessionId - Main conversation. @param signal - Visible panel lifetime. @returns Native child snapshots. */
  @Remote({ mode: 'stream' })
  async *watchDshSubagents(parentSessionId: string, signal: AbortSignal): AsyncIterable<string> {
    yield* harness.watchDshSubagents(this.host, parentSessionId, signal)
  }
  // prettier-ignore
  /** @param parentSessionId - Main conversation. @param childSessionId - Direct child. @param prompt - Human message. @param requestId - Browser-minted prompt identity. @param signal - Admission lifetime. @returns Native inbox receipt JSON. */
  @Remote({ name: 'promptDshSubagent', resources: { session: (_parent, child) => SessionId(child) } })
  async promptDshSubagent(parentSessionId: string, childSessionId: string, prompt: string, requestId: string, signal: AbortSignal): Promise<string> {
    return harness.promptDshSubagent(this.host, parentSessionId, childSessionId, prompt, requestId, signal)
  }
  // prettier-ignore
  /** @param parentSessionId - Main conversation. @param childSessionId - Direct child. @param signal - Stop confirmation lifetime. @returns JSON only after native settlement. */
  @Remote({ name: 'stopDshSubagent', resources: { session: (_parent, child) => SessionId(child) } })
  async stopDshSubagent(parentSessionId: string, childSessionId: string, signal: AbortSignal): Promise<string> {
    return harness.stopDshSubagent(this.host, parentSessionId, childSessionId, signal)
  }
  /** @param parentSessionId - Main conversation. @param childSessionId - Direct child. @param signal - Mutation lifetime. @returns Nothing; only plugin visibility changes. */
  @Remote({ name: 'hideDshSubagent', resources: { session: (_parent, child) => SessionId(child) } })
  async hideDshSubagent(parentSessionId: string, childSessionId: string, signal: AbortSignal): Promise<void> {
    return harness.hideDshSubagent(this.host, parentSessionId, childSessionId, signal)
  }
  /** @param parentSessionId - Owning Harness session. @param workerId - Selected worker or empty string. @param signal - Stream lifetime. @returns JSON snapshots, initially and after changes. */
  @Remote({ mode: 'stream' })
  async *watch(parentSessionId: string, workerId: string, signal: AbortSignal): AsyncIterable<string> {
    yield* history.watch(this.host, parentSessionId, workerId, signal)
  }
  /** @param parentSessionId - Owning parent session. @param workerId - Worker identity. @param anchor - Stable logical row ID, excluded from the result. @param direction - before or after. @returns JSON historical page, at most 200 rows. */
  @Remote('history')
  async history(
    parentSessionId: string,
    workerId: string,
    anchor: string,
    direction: string,
  ): Promise<string> {
    return history.history(this.host, parentSessionId, workerId, anchor, direction)
  }
  /** @param parentSessionId - Owning Harness session. @param signal - Query lifetime. @returns Profile-wide CLI enablement JSON. */
  @Remote('cliSettings')
  async cliSettings(parentSessionId: string, signal: AbortSignal): Promise<string> {
    return settings.cliSettings(this.host, parentSessionId, signal)
  }
  /** @param parentSessionId - Active parent. @param cli - Explicit CLI. @param signal - Read lifetime. @returns Project/CLI running-message preference and native capability. */
  @Remote('runningMessageSettings')
  async runningMessageSettings(parentSessionId: string, cli: string, signal: AbortSignal): Promise<string> {
    return history.runningMessageSettings(this.host, parentSessionId, cli, signal)
  }
  /** @param parentSessionId - Active parent. @param cli - Explicit CLI. @param mode - Running submission preference. @param signal - Save lifetime. @returns Saved preference; never starts a CLI. */
  @Remote('saveRunningMessageMode')
  async saveRunningMessageMode(
    parentSessionId: string,
    cli: string,
    mode: string,
    signal: AbortSignal,
  ): Promise<string> {
    return history.saveRunningMessageMode(this.host, parentSessionId, cli, mode, signal)
  }
  /** @param parentSessionId - Active parent. @param signal - Query lifetime. @returns JSON role preset library. */
  @Remote('rolePresets')
  async rolePresets(parentSessionId: string, signal: AbortSignal): Promise<string> {
    return history.rolePresets(this.host, parentSessionId, signal)
  }
  /** @param parentSessionId - Active parent. @param requestJSON - Preset fields, optional existing id. @param signal - Mutation lifetime. @returns Saved preset JSON. */
  @Remote('saveRolePreset')
  async saveRolePreset(parentSessionId: string, requestJSON: string, signal: AbortSignal): Promise<string> {
    return history.saveRolePreset(this.host, parentSessionId, requestJSON, signal)
  }
  /** @param parentSessionId - Active parent. @param presetId - Preset to delete. @param signal - Mutation lifetime. @returns Completion. */
  @Remote('deleteRolePreset')
  async deleteRolePreset(parentSessionId: string, presetId: string, signal: AbortSignal): Promise<void> {
    return history.deleteRolePreset(this.host, parentSessionId, presetId, signal)
  }
  /** @param parentSessionId - Owning parent. @param workerId - Worker identity. @param name - Unique readable name. @param signal - Mutation lifetime. @returns Completion. */
  @Remote('renameWorker')
  async renameWorker(
    parentSessionId: string,
    workerId: string,
    name: string,
    signal: AbortSignal,
  ): Promise<void> {
    return workers.renameWorker(this.host, parentSessionId, workerId, name, signal)
  }
  /** @param parentSessionId - Owning parent. @param workerId - Worker identity. @param title - Single-line chat title, at most 160 characters. @param signal - Mutation lifetime. @returns Completion. */
  @Remote('renameWorkerTitle')
  async renameWorkerTitle(
    parentSessionId: string,
    workerId: string,
    title: string,
    signal: AbortSignal,
  ): Promise<void> {
    return workers.renameWorkerTitle(this.host, parentSessionId, workerId, title, signal)
  }
  // prettier-ignore
  /** @param parentSessionId - Owning parent. @param workerId - Worker identity. @param objective - Persistent objective. @param expectedRevision - Current goal revision, or zero when absent. @param signal - Mutation lifetime. @returns WorkerGoal JSON. */
  @Remote('setWorkerGoal')
  async setWorkerGoal(parentSessionId: string, workerId: string, objective: string, expectedRevision: number, signal: AbortSignal): Promise<string> {
    return workers.setWorkerGoal(this.host, parentSessionId, workerId, objective, expectedRevision, signal)
  }
  // prettier-ignore
  /** @param parentSessionId - Owning parent. @param workerId - Worker identity. @param status - Active or paused. @param expectedRevision - Current goal revision. @param signal - Mutation lifetime. @returns WorkerGoal JSON. */
  @Remote('setWorkerGoalStatus')
  async setWorkerGoalStatus(parentSessionId: string, workerId: string, status: 'active' | 'paused', expectedRevision: number, signal: AbortSignal): Promise<string> {
    return workers.setWorkerGoalStatus(this.host, parentSessionId, workerId, status, expectedRevision, signal)
  }
  // prettier-ignore
  /** @param parentSessionId - Owning parent. @param workerId - Worker identity. @param expectedRevision - Current goal revision. @param signal - Mutation lifetime. @returns Completion. */
  @Remote('clearWorkerGoal')
  async clearWorkerGoal(parentSessionId: string, workerId: string, expectedRevision: number, signal: AbortSignal): Promise<void> {
    return workers.clearWorkerGoal(this.host, parentSessionId, workerId, expectedRevision, signal)
  }
  /** @param parentSessionId - Owning parent. @param workerId - Idle Worker to hide. @param signal - Mutation lifetime. @returns Completion without deleting native data. */
  @Remote('deleteWorker')
  async deleteWorker(parentSessionId: string, workerId: string, signal: AbortSignal): Promise<void> {
    return workers.deleteWorker(this.host, parentSessionId, workerId, signal)
  }
  /** @param parentSessionId - Owning parent. @param workerId - Deleted Worker identity. @param signal - Mutation lifetime. @returns Completion with the original ID and history. */
  @Remote('restoreWorker')
  async restoreWorker(parentSessionId: string, workerId: string, signal: AbortSignal): Promise<void> {
    return workers.restoreWorker(this.host, parentSessionId, workerId, signal)
  }
  // prettier-ignore
  /** @param parentSessionId - Owning parent. @param workerId - Idle source Worker. @param atMessageId - Completed assistant message, or empty for latest. @param signal - Fork lifetime. @returns Worker and child session identities as JSON. */
  @Remote('forkWorker')
  async forkWorker(parentSessionId: string, workerId: string, atMessageId: string, signal: AbortSignal): Promise<string> {
    return workers.forkWorker(this.host, parentSessionId, workerId, atMessageId, signal)
  }
  /** @param parentSessionId - Owning session. @param signal - Query lifetime. @returns Profile-wide general settings JSON. */
  @Remote('generalSettings')
  async generalSettings(parentSessionId: string, signal: AbortSignal): Promise<string> {
    return settings.generalSettings(this.host, parentSessionId, signal)
  }
  /** @param parentSessionId - Owning session. @param patch - JSON object of changed fields; `null` restores a default. @param signal - Mutation admission lifetime. @returns Updated general settings JSON. */
  @Remote('saveGeneralSettings')
  async saveGeneralSettings(parentSessionId: string, patch: string, signal: AbortSignal): Promise<string> {
    return settings.saveGeneralSettings(this.host, parentSessionId, patch, signal)
  }
  /** @param parentSessionId - Owning session. @param cli - Selected CLI. @param enabled - Allow new CLI operations. @param signal - Mutation admission lifetime. @returns Updated profile-wide CLI enablement JSON. */
  @Remote('setCliEnabled')
  async setCliEnabled(
    parentSessionId: string,
    cli: string,
    enabled: boolean,
    signal: AbortSignal,
  ): Promise<string> {
    return settings.setCliEnabled(this.host, parentSessionId, cli, enabled, signal)
  }
  /** @param parentSessionId - Owning session. @param signal - Query lifetime. @returns Cached page JSON; never starts probes. */
  @Remote('cliUpdateSnapshot')
  async cliUpdateSnapshot(parentSessionId: string, signal: AbortSignal): Promise<string> {
    return cliUpdates.cliUpdateSnapshot(this.host, parentSessionId, signal)
  }
  // prettier-ignore
  /** @param parentSessionId - Owning session. @param scope - missing or all. @param signal - Request lifetime. @returns Immediate page JSON; watch carries results. */
  @Remote('checkCliUpdates')
  async checkCliUpdates(parentSessionId: string, scope: 'missing' | 'all', signal: AbortSignal): Promise<string> {
    return cliUpdates.checkCliUpdates(this.host, parentSessionId, scope, signal)
  }
  /** @param parentSessionId - Owning session. @param signal - Stream lifetime. @returns Revision-ordered page JSON. */
  @Remote({ name: 'watchCliUpdates', mode: 'stream' })
  async *watchCliUpdates(parentSessionId: string, signal: AbortSignal): AsyncIterable<string> {
    yield* cliUpdates.watchCliUpdates(this.host, parentSessionId, signal)
  }
  // prettier-ignore
  /** @param parentSessionId - Owning session. @param cli - Selected CLI. @param intent - update or install. @param planToken - Host fingerprint. @param installDirectory - Validated optional desktop location. @param requestId - Idempotency key. @param signal - Admission only; does not own the operation. @returns Page snapshot JSON. */
  @Remote('startCliOperation')
  async startCliOperation(parentSessionId: string, cli: string, intent: 'update' | 'install', planToken: string, installDirectory: string, requestId: string, signal: AbortSignal): Promise<string> {
    return cliUpdates.startCliOperation(
      this.host,
      parentSessionId,
      cli,
      intent,
      planToken,
      installDirectory,
      requestId,
      signal,
    )
  }
  /** @param parentSessionId - Owning session. @param requestId - Idempotency key. @param signal - Admission lifetime only. @returns Page snapshot JSON. */
  @Remote('updateAllClis')
  async updateAllClis(parentSessionId: string, requestId: string, signal: AbortSignal): Promise<string> {
    return cliUpdates.updateAllClis(this.host, parentSessionId, requestId, signal)
  }
  /** @param parentSessionId - Owning session. @param target - Operation id or queued CLI id. @param signal - Request lifetime. @returns Page snapshot JSON. */
  @Remote('cancelCliOperation')
  async cancelCliOperation(parentSessionId: string, target: string, signal: AbortSignal): Promise<string> {
    return cliUpdates.cancelCliOperation(this.host, parentSessionId, target, signal)
  }
  // prettier-ignore
  /** @param parentSessionId - Owning session. @param cli - Selected CLI. @param operationId - Exact running operation. @param signal - Admission only. @returns CliTakeoverResult JSON after official exit and cleanup. */
  @Remote('requestCliTakeover')
  async requestCliTakeover(parentSessionId: string, cli: string, operationId: string, signal: AbortSignal): Promise<string> {
    return cliUpdates.requestCliTakeover(this.host, parentSessionId, cli, operationId, signal)
  }
  /** @param parentSessionId - Owning session. @param cli - Desktop CLI. @param signal - Picker lifetime. @returns Directory check JSON; empty path on cancel. */
  @Remote('chooseInstallDirectory')
  async chooseInstallDirectory(parentSessionId: string, cli: string, signal: AbortSignal): Promise<string> {
    return cliUpdates.chooseInstallDirectory(this.host, parentSessionId, cli, signal)
  }
  // prettier-ignore
  /** @param parentSessionId - Owning session. @param cli - Desktop CLI. @param path - Proposed directory. @param signal - Query lifetime. @returns Directory check JSON. */
  @Remote('checkInstallDirectory')
  async checkInstallDirectory(parentSessionId: string, cli: string, path: string, signal: AbortSignal): Promise<string> {
    return cliUpdates.checkInstallDirectory(this.host, parentSessionId, cli, path, signal)
  }
  /** @param parentSessionId - Owning session. @param signal - Query lifetime. @returns Machine-local download settings JSON. */
  @Remote('cliDownloadSource')
  async cliDownloadSource(parentSessionId: string, signal: AbortSignal): Promise<string> {
    return cliUpdates.cliDownloadSource(this.host, parentSessionId, signal)
  }
  /** @param parentSessionId - Owning session. @param json - Download settings JSON. @param signal - Request lifetime. @returns Saved settings JSON. */
  @Remote('saveCliDownloadSource')
  async saveCliDownloadSource(parentSessionId: string, json: string, signal: AbortSignal): Promise<string> {
    return cliUpdates.saveCliDownloadSource(this.host, parentSessionId, json, signal)
  }
  /** @param parentSessionId - Owning session. @param url - HTTPS registry URL. @param signal - Query lifetime. @returns Connection check JSON. */
  @Remote('testCliDownloadSource')
  async testCliDownloadSource(parentSessionId: string, url: string, signal: AbortSignal): Promise<string> {
    return cliUpdates.testCliDownloadSource(this.host, parentSessionId, url, signal)
  }
  /** @param parentSessionId - Owning session. @param cli - Selected CLI. @param signal - Query lifetime. @returns Safe account status JSON. */
  @Remote('settingsConnectionStatus')
  async settingsConnectionStatus(parentSessionId: string, cli: string, signal: AbortSignal): Promise<string> {
    return connections.settingsConnectionStatus(this.host, parentSessionId, cli, signal)
  }
  @Remote({ name: 'watchSettingsConnections', mode: 'stream' })
  async *watchSettingsConnections(parentSessionId: string, signal: AbortSignal): AsyncIterable<string> {
    yield* connections.watchSettingsConnections(this.host, parentSessionId, signal)
  }
  @Remote('accountStatus')
  async accountStatus(parentSessionId: string, cli: string, signal: AbortSignal): Promise<string> {
    return accounts.accountStatus(this.host, parentSessionId, cli, signal)
  }
  /** @param parentSessionId - Owning session. @param cli - Selected CLI. @param signal - Read lifetime. @returns Fresh account status and action handles. */
  @Remote('refreshAccountStatus')
  async refreshAccountStatus(parentSessionId: string, cli: string, signal: AbortSignal): Promise<string> {
    return accounts.refreshAccountStatus(this.host, parentSessionId, cli, signal)
  }
  /** @param parentSessionId - Owning session. @param cli - CLI the user confirmed has no leftover process. @param signal - Mutation lifetime. @returns Fresh account status JSON. */
  @Remote('recoverCliCleanup')
  async recoverCliCleanup(parentSessionId: string, cli: string, signal: AbortSignal): Promise<string> {
    return accounts.recoverCliCleanup(this.host, parentSessionId, cli, signal)
  }
  /** @param parentSessionId - Owning session. @param cli - Selected CLI. @param signal - Query lifetime. @returns Machine-local executable path and availability JSON. */
  @Remote('cliExecutablePath')
  async cliExecutablePath(parentSessionId: string, cli: string, signal: AbortSignal): Promise<string> {
    return connections.cliExecutablePath(this.host, parentSessionId, cli, signal)
  }
  /** @param parentSessionId - Owning session. @param cli - Selected CLI. @param path - Full file path for manual selection. @param action - manual, refresh or auto. @param signal - Mutation/query lifetime. @returns Saved machine-local path and fresh availability JSON. */
  @Remote('refreshCliExecutablePath')
  async refreshCliExecutablePath(
    parentSessionId: string,
    cli: string,
    path: string,
    action: string,
    signal: AbortSignal,
  ): Promise<string> {
    return connections.refreshCliExecutablePath(this.host, parentSessionId, cli, path, action, signal)
  }
  /** @param parentSessionId - Owning parent. @param cli - WorkBuddy edition. @param signal - Startup lifetime. @returns No-PTY guide identity JSON. */
  @Remote('accountDesktopStart')
  async accountDesktopStart(parentSessionId: string, cli: string, signal: AbortSignal): Promise<string> {
    return accounts.accountDesktopStart(this.host, parentSessionId, cli, signal)
  }
  /** @param parentSessionId - Owning parent. @param accountId - Desktop guide identity. @param action - Fixed open/refresh/continue action. @returns Action accepted. */
  @Remote('accountDesktopRespond')
  async accountDesktopRespond(parentSessionId: string, accountId: string, action: string): Promise<boolean> {
    return accounts.accountDesktopRespond(this.host, parentSessionId, accountId, action)
  }
  // prettier-ignore
  /** @param parentSessionId - Owning parent. @param accountId - Desktop guide identity. @param signal - Watch lifetime. @returns Safe guide frames. */
  @Remote({ mode: 'stream' })
  async *accountDesktopWatch(parentSessionId: string, accountId: string, signal: AbortSignal): AsyncIterable<string> {
    yield* accounts.accountDesktopWatch(this.host, parentSessionId, accountId, signal)
  }
  /** @param parentSessionId - Owning parent. @param accountId - Desktop guide identity. @returns Query cleanup confirmed; never closes the desktop app. */
  @Remote('accountDesktopStop')
  async accountDesktopStop(parentSessionId: string, accountId: string): Promise<boolean> {
    return accounts.accountDesktopStop(this.host, parentSessionId, accountId)
  }
  /** @param parentSessionId - Owning session. @param cli - Selected CLI. @param action - Explicit human action. @param signal - Startup lifetime. @returns Managed account terminal identity and instruction JSON. */
  @Remote('accountStart')
  async accountStart(
    parentSessionId: string,
    cli: string,
    action: string,
    signal: AbortSignal,
  ): Promise<string> {
    return accounts.accountStart(this.host, parentSessionId, cli, action, signal)
  }
  /** @param source - One current CLI-native source, never a filesystem path. */
  @Remote('accountStartForSource')
  async accountStartForSource(
    parentSessionId: string,
    cli: string,
    action: string,
    source: string,
    signal: AbortSignal,
  ): Promise<string> {
    return accounts.accountStartForSource(this.host, parentSessionId, cli, action, source, signal)
  }
  /** @param provider - Explicit ZCode native login provider, never a URL or logout source. */
  @Remote('accountStartForProvider')
  async accountStartForProvider(
    parentSessionId: string,
    cli: string,
    action: string,
    provider: string,
    signal: AbortSignal,
  ): Promise<string> {
    return accounts.accountStartForProvider(this.host, parentSessionId, cli, action, provider, signal)
  }
  /**
   * @param options - JSON `{ provider?, login? }`: a login provider of the window's picker, or
   * one login (`AccountLogin.id`) to sign out. Host checks both against the installed CLI.
   */
  @Remote('accountStartWith')
  async accountStartWith(
    parentSessionId: string,
    cli: string,
    action: string,
    options: string,
    signal: AbortSignal,
  ): Promise<string> {
    return accounts.accountStartWith(this.host, parentSessionId, cli, action, options, signal)
  }
  /** @returns JSON form, or literal null for an unverified CLI/native configuration source. */
  @Remote('customProviderForm')
  async customProviderForm(parentSessionId: string, cli: string, signal: AbortSignal): Promise<string> {
    return accounts.customProviderForm(this.host, parentSessionId, cli, signal)
  }
  // prettier-ignore
  /** Write-only secret input. Never log valuesJson or put it into account/catalog snapshots. */
  @Remote('saveCustomProvider')
  async saveCustomProvider(parentSessionId: string, cli: string, token: string, valuesJson: string, signal: AbortSignal): Promise<string> {
    return accounts.saveCustomProvider(this.host, parentSessionId, cli, token, valuesJson, signal)
  }
  // prettier-ignore
  /** Direct config deletion: no CLI executable or terminal is required. */
  @Remote('deleteAccountConfiguration')
  async deleteAccountConfiguration(parentSessionId: string, cli: string, login: string, signal: AbortSignal): Promise<string> {
    return accounts.deleteAccountConfiguration(this.host, parentSessionId, cli, login, signal)
  }
  /** @param parentSessionId - Owning session. @param accountId - Account terminal identity. @param signal - Stream lifetime. @returns Ephemeral terminal frame JSON. */
  @Remote({ mode: 'stream' })
  async *accountWatch(
    parentSessionId: string,
    accountId: string,
    signal: AbortSignal,
  ): AsyncIterable<string> {
    yield* accounts.accountWatch(this.host, parentSessionId, accountId, signal)
  }
  /** @param parentSessionId - Owning session. @param accountId - Account terminal identity. @param data - Human keyboard input. @returns Input accepted. */
  @Remote('accountWrite')
  async accountWrite(parentSessionId: string, accountId: string, data: string): Promise<boolean> {
    return accounts.accountWrite(this.host, parentSessionId, accountId, data)
  }
  /** @param parentSessionId - Owning session. @param accountId - Account terminal identity. @param response - The user's answer to the window's current step (JSON). @returns Answer accepted. */
  @Remote('accountRespond')
  async accountRespond(parentSessionId: string, accountId: string, response: string): Promise<boolean> {
    return accounts.accountRespond(this.host, parentSessionId, accountId, response)
  }
  /** @param parentSessionId - Owning session. @param accountId - Account terminal identity. @param cols - Visible columns. @param rows - Visible rows. @returns Resize accepted. */
  @Remote('accountResize')
  async accountResize(
    parentSessionId: string,
    accountId: string,
    cols: number,
    rows: number,
  ): Promise<boolean> {
    return accounts.accountResize(this.host, parentSessionId, accountId, cols, rows)
  }
  /** @param parentSessionId - Owning session. @param accountId - Account terminal identity. @returns Process cleanup completed. */
  @Remote('accountStop')
  async accountStop(parentSessionId: string, accountId: string): Promise<boolean> {
    return accounts.accountStop(this.host, parentSessionId, accountId)
  }
  /** @param parentSessionId - Parent session identity. @param signal - Caller lifetime. @returns JSON model catalog and project preference. */
  @Remote('catalog')
  async catalog(parentSessionId: string, signal: AbortSignal): Promise<string> {
    return models.catalog(this.host, parentSessionId, signal)
  }
  /** @param parentSessionId - Parent session identity. @param cli - Selected CLI. @param signal - Caller lifetime. @returns CLI catalog and saved project preference. */
  @Remote('catalogForCli')
  async catalogForCli(parentSessionId: string, cli: string, signal: AbortSignal): Promise<string> {
    return models.catalogForCli(this.host, parentSessionId, cli, signal)
  }
  /** @param parentSessionId - Owning parent. @param workerId - Worker whose original account scopes the saved choices. @param signal - Caller lifetime. @returns Saved model choices; only a missing valid directory requires discovery. */
  @Remote('catalogForWorker')
  async catalogForWorker(parentSessionId: string, workerId: string, signal: AbortSignal): Promise<string> {
    return models.catalogForWorker(this.host, parentSessionId, workerId, signal)
  }
  /** @param parentSessionId - Parent session identity. @param cli - Selected CLI. @param signal - Caller lifetime. @returns Fresh model catalog and saved project preference. */
  @Remote('refreshCatalogForCli')
  async refreshCatalogForCli(parentSessionId: string, cli: string, signal: AbortSignal): Promise<string> {
    return models.refreshCatalogForCli(this.host, parentSessionId, cli, signal)
  }
  /** @param parentSessionId - Parent session identity. @param selection - JSON model and effort. @param signal - Caller lifetime. @returns Saved JSON preference. */
  @Remote('configure')
  async configure(parentSessionId: string, selection: string, signal: AbortSignal): Promise<string> {
    return models.configure(this.host, parentSessionId, selection, signal)
  }
  /** @param parentSessionId - Owning session. @param workerId - Idle worker. @param selection - JSON preference from saved choices. @param signal - Caller lifetime. @returns Saved preference; execution performs live authorization. */
  @Remote('configureWorker')
  async configureWorker(
    parentSessionId: string,
    workerId: string,
    selection: string,
    signal: AbortSignal,
  ): Promise<string> {
    return models.configureWorker(this.host, parentSessionId, workerId, selection, signal)
  }
  /** @param parentSessionId - Owning parent. @param workerId - Exact Worker. @param signal - Read lifetime. @returns Native permission control data; no task or permission change. */
  @Remote('permissionForWorker')
  async permissionForWorker(parentSessionId: string, workerId: string, signal: AbortSignal): Promise<string> {
    return permissions.permissionForWorker(this.host, parentSessionId, workerId, signal)
  }
  // prettier-ignore
  /** @param parentSessionId - Owning parent. @param workerId - Exact idle Worker. @param mode - An advertised native CLI mode. @param signal - Save lifetime. @returns Saved Worker; no task is launched. */
  @Remote('configureWorkerPermission')
  async configureWorkerPermission(parentSessionId: string, workerId: string, mode: string, signal: AbortSignal): Promise<string> {
    return permissions.configureWorkerPermission(this.host, parentSessionId, workerId, mode, signal)
  }
  /** @param parentSessionId - Owning parent. @param workerId - Conversation identity. @param requestJSON - Immutable click identity, text, mode and destination. @param signal - Admission lifetime. @returns Exact message acceptance receipt, not native completion. */
  @Remote('submitMessage')
  async submitMessage(
    parentSessionId: string,
    workerId: string,
    requestJSON: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      const request = messageSubmissionSchema.parse(JSON.parse(requestJSON))
      const key = `${parentSessionId}:${workerId}:${request.id}`
      const canonical = JSON.stringify(request)
      const submissions = (this.host.messageSubmissions ??= new Map())
      const prior = submissions.get(key)
      if (prior) {
        if (prior.request === canonical) return await prior.done
        const original = messageSubmissionSchema.parse(JSON.parse(prior.request))
        const promotion =
          original.mode === 'queue' &&
          original.intent === 'running' &&
          request.mode === 'interrupt' &&
          request.intent === 'running' &&
          request.prompt === original.prompt &&
          request.clientId === original.clientId &&
          request.sequence > original.sequence
        if (!promotion) throw new Error('重复提交标识对应的消息不同')
      }
      // Occupancy and the Stop boundary must exist before parent lookup or model preparation awaits.
      const reservation = this.host.runtime.reserveSubmission(parentSessionId, workerId, request.id)
      const control = AbortSignal.any([signal, this.host.disposed.signal, reservation.signal])
      const done = (async () => {
        const agent = await this.host.parent(parentSessionId)
        control.throwIfAborted()
        reservation.assertCurrent()
        this.host.assertExecution(agent, true)
        const worker = this.host.runtime.get(agent.id, workerId)
        if (this.host.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
        if (this.host.accounts.isBusy(cliOf(worker.preference))) throw new Error('请先关闭账号终端')
        if (request.intent === 'direct') {
          const receipt = this.host.runtime.directMessageReceipt(
            agent.id,
            workerId,
            request.prompt,
            request.id,
          )
          if (receipt) return JSON.stringify({ ...receipt, revision: this.host.runtime.revision })
          return await this.host.launch(
            agent,
            worker.title,
            request.prompt,
            worker.preference,
            worker.mode,
            workerId,
            undefined,
            control,
            undefined,
            undefined,
            undefined,
            request.id,
          )
        }
        if (request.mode === 'interrupt')
          return JSON.stringify(
            this.host.runtime.interruptMessage(
              agent.id,
              workerId,
              request.prompt,
              request.id,
              request.clientId,
              request.sequence,
              control,
            ),
          )
        const receipt = await this.host.runtime.sendRunningMessage(
          agent.id,
          workerId,
          request.prompt,
          request.expectedRunId,
          request.id,
          control,
          request.mode,
        )
        return JSON.stringify({ ...(receipt ?? { accepted: true }), revision: this.host.runtime.revision })
      })()
      const operation = { request: canonical, done }
      submissions.set(key, operation)
      try {
        return await done
      } finally {
        if (submissions.get(key) === operation) submissions.delete(key)
        reservation.release()
      }
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Worker to continue after this turn. @param prompt - Unsent message. @param expectedRunId - Run observed by the caller. @param requestId - Stable UUID for retries of this message. @param signal - Admission lifetime. @returns Accepted outbox item JSON. */
  @Remote('queueFollowup')
  async queueFollowup(
    parentSessionId: string,
    workerId: string,
    prompt: string,
    expectedRunId: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      const agent = await this.host.parent(parentSessionId)
      signal.throwIfAborted()
      this.host.assertExecution(agent, true)
      const worker = this.host.runtime.get(agent.id, workerId)
      if (this.host.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
      return JSON.stringify(
        this.host.runtime.queueFollowup(agent.id, workerId, prompt, expectedRunId, requestId),
      )
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Current native Worker. @param prompt - Current-run input. @param expectedRunId - Exact target run. @param requestId - Stable steering identity. @param signal - Receipt lifetime. @returns Native acceptance; never creates or schedules a later turn. */
  @Remote('steerMessage')
  async steerMessage(
    parentSessionId: string,
    workerId: string,
    prompt: string,
    expectedRunId: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      validate.uuid().parse(requestId)
      validate
        .string()
        .min(1)
        .max(100_000)
        .refine((text) => !!text.trim())
        .parse(prompt)
      const observed = this.host.runtime.get(parentSessionId, workerId)
      if (observed.runId !== expectedRunId) throw new Error('本轮状态已变化，请核对当前运行后发送引导')
      const control = AbortSignal.any([signal, this.host.disposed.signal])
      const agent = await this.host.parent(parentSessionId)
      control.throwIfAborted()
      this.host.assertExecution(agent, true)
      const worker = this.host.runtime.get(agent.id, workerId)
      if (this.host.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
      if (this.host.accounts.isBusy(cliOf(worker.preference))) throw new Error('请先关闭账号终端')
      // After an account switch the message is queued for the next turn instead.
      const queued = await this.host.runtime.steerMessage(
        agent.id,
        workerId,
        prompt,
        expectedRunId,
        requestId,
        control,
      )
      return JSON.stringify({
        accepted: true,
        requestId,
        runId: expectedRunId,
        ...(queued ? { queued } : {}),
        revision: this.host.runtime.revision,
      })
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Active Worker. @param prompt - New message. @param expectedRunId - Observed run. @param requestId - Stable submission UUID. @param signal - Admission lifetime. @returns Accepted submission using the saved mode. */
  @Remote('sendRunningMessage')
  async sendRunningMessage(
    parentSessionId: string,
    workerId: string,
    prompt: string,
    expectedRunId: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      const agent = await this.host.parent(parentSessionId)
      signal.throwIfAborted()
      this.host.assertExecution(agent, true)
      const worker = this.host.runtime.get(agent.id, workerId)
      if (this.host.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
      if (this.host.accounts.isBusy(cliOf(worker.preference))) throw new Error('请先关闭账号终端')
      const receipt = await this.host.runtime.sendRunningMessage(
        agent.id,
        workerId,
        prompt,
        expectedRunId,
        requestId,
        signal,
      )
      return JSON.stringify(receipt ?? { accepted: true })
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Current Worker. @param prompt - Message text. @param requestId - Stable message UUID, including a local queue item. @param clientId - Panel source UUID. @param sequence - Increasing click order for this source. @param signal - Admission transport lifetime. @returns JSON durable acceptance receipt; execution proceeds independently of this RPC. */
  @Remote('interruptMessage')
  async interruptMessage(
    parentSessionId: string,
    workerId: string,
    prompt: string,
    requestId: string,
    clientId: string,
    sequence: number,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      const agent = await this.host.parent(parentSessionId)
      signal.throwIfAborted()
      this.host.assertExecution(agent, true)
      const worker = this.host.runtime.get(agent.id, workerId)
      if (this.host.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
      if (this.host.accounts.isBusy(cliOf(worker.preference))) throw new Error('请先关闭账号终端')
      return JSON.stringify(
        this.host.runtime.interruptMessage(agent.id, workerId, prompt, requestId, clientId, sequence, signal),
      )
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Worker with pending messages. @param queuedId - Explicit priority message. @param expectedRunId - Observed run. @param signal - Admission lifetime. @returns JSON priority request receipt with queuedId and snapshot revision; not confirmation of native delivery. */
  @Remote('interruptQueuedFollowup')
  async interruptQueuedFollowup(
    parentSessionId: string,
    workerId: string,
    queuedId: string,
    expectedRunId: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      const agent = await this.host.parent(parentSessionId)
      signal.throwIfAborted()
      this.host.assertExecution(agent, true)
      const worker = this.host.runtime.get(agent.id, workerId)
      if (this.host.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
      if (this.host.accounts.isBusy(cliOf(worker.preference))) throw new Error('请先关闭账号终端')
      await this.host.runtime.interruptQueuedFollowup(agent.id, workerId, queuedId, expectedRunId, signal)
      return JSON.stringify({ queuedId, revision: this.host.runtime.revision })
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Owning Worker. @param queuedId - Unsent item identity. @param signal - Mutation lifetime. @returns Completion; already admitted messages cannot be cancelled here. */
  @Remote('cancelQueuedFollowup')
  async cancelQueuedFollowup(
    parentSessionId: string,
    workerId: string,
    queuedId: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const agent = await this.host.parent(parentSessionId)
      signal.throwIfAborted()
      this.host.runtime.cancelQueuedFollowup(agent.id, workerId, queuedId)
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Idle Worker with paused messages. @param expectedRunId - Current run identity. @param signal - Mutation lifetime. @returns Explicit queue reactivation; each turn rechecks native authorization. */
  @Remote('retryQueuedFollowups')
  async retryQueuedFollowups(
    parentSessionId: string,
    workerId: string,
    expectedRunId: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const agent = await this.host.parent(parentSessionId)
      signal.throwIfAborted()
      this.host.assertExecution(agent, true)
      const worker = this.host.runtime.get(agent.id, workerId)
      if (this.host.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
      this.host.runtime.retryQueuedFollowups(agent.id, workerId, expectedRunId)
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Parent session identity. @param workerId - Worker to continue. @param prompt - New task. @param signal - Admission lifetime. @returns Published background receipt. */
  @Remote('followup')
  async followup(
    parentSessionId: string,
    workerId: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    return this.host.continueWorker(parentSessionId, workerId, prompt, signal, 'user')
  }
  /** @param parentSessionId - Owning parent. @param workerId - Idle legacy history without an account binding. @param prompt - Explicit new-dialog task. @param signal - Admission lifetime. @returns JSON background receipt for a fresh Worker. */
  @Remote('restartWorker')
  async restartWorker(
    parentSessionId: string,
    workerId: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      const agent = await this.host.parent(parentSessionId)
      signal.throwIfAborted()
      this.host.assertExecution(agent, true)
      const worker = this.host.runtime.assertLegacyRestart(agent.id, workerId)
      if (this.host.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目新建对话')
      return await this.host.launch(
        agent,
        worker.title,
        prompt,
        { ...worker.preference },
        worker.mode,
        undefined,
        { role: worker.role ? structuredClone(worker.role) : undefined },
        signal,
        workerId,
      )
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning Harness session. @param workerId - Worker to stop. @returns Final worker state after cleanup. */
  @Remote('stop')
  async stop(parentSessionId: string, workerId: string): Promise<string> {
    try {
      return JSON.stringify(await this.host.runtime.stop(parentSessionId, workerId))
    } catch (error) {
      throw failure(error)
    }
  }
}

export default CliWorkerService

/** Per-instance dependencies and the operations shared across Host domains. */
class ServiceContext {
  runtime!: WorkerRuntime
  accounts!: AccountManager
  cliManagement!: CliManagementService
  accountParents = new Map<string, () => Promise<void>>()
  customProviders?: CustomProviders
  options!: RuntimeConfig
  backend!: ProcessBackend
  pending = new Map<string, number>()
  dispatchWaits = new Map<string, Promise<void>>()
  messageSubmissions = new Map<string, { request: string; done: Promise<string> }>()
  selectionBindings = new WeakMap<Preference, string>()
  selectionProjects = new WeakMap<Preference, string>()
  /** Turn origin by runId: the parent model's tool call, or the user in the Worker UI. */
  runOrigins?: Map<string, RunOrigin>
  /** Exact per-turn question surface; attribution never controls lifecycle. */
  runQuestionSessions?: Map<string, string>
  /** DSH tool calls the tool bridge is executing, by their DSH call id. */
  bridgeCalls = new Map<
    string,
    { worker: Worker; runId: string; child: Agent; name: string; arguments: unknown }
  >()
  displayedBindings = new Map<string, string>()
  connections?: SettingsConnectionCache
  connectionEpochs?: Map<string, { account: number; path: number; recorded: boolean; held: boolean }>
  settingsCatalogs?: SettingsCatalogCache
  settingsInstance?: string
  settingsSourceRevisions?: Map<CliId, number>
  dshSubagents!: DshSubagents
  disposed = new AbortController()
  harnessConversation?: HarnessConversationApi
  harnessConversationStore?: HarnessConversationStore
  nativeRunDone = new Map<string, Promise<Worker>>()
  repairingDisplays = new Set<string>()

  constructor(
    readonly ctx: Context,
    readonly remote: CliWorkerService,
  ) {}
  connectionCache = connections.connectionCache
  parent = harness.parent
  project = harness.project
  machineDirectory = harness.machineDirectory
  preferenceProject = harness.preferenceProject
  dshFallback = harness.dshFallback
  async dispatchSubject(caller: Agent): Promise<Agent> {
    if (caller.session.header.origin !== 'subagent') return caller
    const parentId = caller.session.header.parentSession
    // A background Worker can outlive its parent's resident Agent; load it the
    // same way native Remote Agent parameters do before deciding it is gone.
    if (parentId)
      try {
        await this.ctx.typert.lookups.get('agent')?.resolve(parentId)
      } catch {
        /* reported below */
      }
    const parent = parentId && this.ctx.agents.get(parentId)
    if (!parent) throw new Error('无法解析子 Agent 所属主对话；任务尚未创建')
    if (
      parent.id === caller.id ||
      parent.session.header.origin === 'subagent' ||
      parent.session.header.parentSession
    )
      throw new Error('只允许主对话的直接子 Agent 同级派遣；第三层调用被拒绝')
    return parent
  }
  async siblingDispatch(caller: Agent, parent: Agent, signal: AbortSignal) {
    if (caller === parent) return { questionAgent: parent }
    this.runtime.assertSiblingCapacity(parent.id)
    const worker = [...this.runtime.storage.workers.values()].find(
      (row) => row.parentSessionId === parent.id && row.harnessConversation?.sessionId === caller.id,
    )
    const surface =
      worker &&
      (this.runQuestionSessions?.get(worker.runId) ??
        (this.runOrigins?.get(worker.runId) === 'agent' ? parent.id : caller.id))
    const questionAgent = surface ? this.ctx.agents.get(surface as Agent['id']) : parent
    if (!questionAgent) throw new Error('发起者当前轮的询问会话不可用；任务尚未创建')
    const label = worker
      ? workerName(worker)
      : (await readDshChildren(this.ctx.get('sessionQuery'), parent.id, signal)).find(
          (row) => row.id === caller.id,
        )?.label
    return {
      questionAgent,
      initiator: {
        kind: worker ? ('worker' as const) : ('subagent' as const),
        id: worker?.id ?? caller.id,
        name: label || caller.id,
      },
    }
  }
  assertExecution = permissions.assertExecution
  assertAccessSupported = permissions.assertAccessSupported
  childPermission = permissions.childPermission
  permissionReceipt = permissions.permissionReceipt
  hostPlanActive = permissions.hostPlanActive
  permissionState = permissions.permissionState
  decideNativeApproval = permissions.decideNativeApproval
  answerHarnessApproval = permissions.answerHarnessApproval
  readAccountBinding = models.readAccountBinding
  queryCatalog = models.queryCatalog
  freshCatalog = models.freshCatalog
  busyAccountCatalog = models.busyAccountCatalog
  authorizeChoice = models.authorizeChoice
  querySelection = models.querySelection
  /** Read installation paths without saving discovery or opening a native account/model process. */
  async resolveDispatchName(name: string, signal: AbortSignal) {
    const installed = async (cli: 'qoder' | 'qodercn' | 'workbuddycn' | 'workbuddy') => {
      signal.throwIfAborted()
      const saved = this.options.cliExecutablePaths?.read(cli)
      const config = {
        ...this.options,
        cliExecutablePaths: undefined,
        ...(saved?.mode === 'manual' ? { [`${cli}Executable`]: saved.path } : {}),
      }
      try {
        await resolveCliExecutable(cli, this.backend, config, signal)
        signal.throwIfAborted()
        return true
      } catch (error) {
        if (error instanceof ProcessCleanupUnconfirmedError) {
          this.runtime.blockCatalogOnCleanup(cli, error)
          throw error
        }
        signal.throwIfAborted()
        // A missing manually configured entry is a broken selection, not absence.
        if (!saved || saved.mode !== 'manual') {
          if (
            !configuredCliExecutable(cli, config) &&
            ((error instanceof WorkBuddyUnavailableError && error.reason === 'not-installed') ||
              error instanceof WindowsCliNotFoundError ||
              error instanceof SubprocessExecutableNotFoundError ||
              ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code ?? ''))
          )
            return false
        }
        throw error
      }
    }
    return isGenericWorkBuddyName(name)
      ? resolveAvailableWorkBuddyName(name, installed)
      : resolveAvailableCliName(name, installed)
  }
  async chooseQoderVariant(agent: Agent, callerSignal: AbortSignal, name: string, questionAgent = agent) {
    const signal = AbortSignal.any([callerSignal, this.disposed.signal])
    signal.throwIfAborted()
    const project = this.project(agent)
    const key = JSON.stringify([agent.id, project, 'qoder-variant'])
    const waits = (this.dispatchWaits ??= new Map())
    const previous = waits.get(key) ?? Promise.resolve()
    let release!: () => void
    const owned = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => owned)
    waits.set(key, tail)
    void tail.then(() => {
      if (waits.get(key) === tail) waits.delete(key)
    })
    this.pending.set(agent.id, (this.pending.get(agent.id) ?? 0) + 1)
    this.runtime.changed()
    try {
      await waitForInput(previous, signal)
      this.assertExecution(agent, true)
      const resolution = await this.resolveDispatchName(name, signal)
      signal.throwIfAborted()
      let cli: 'qoder' | 'qodercn'
      if (resolution.status === 'resolved' && (resolution.cli === 'qoder' || resolution.cli === 'qodercn'))
        cli = resolution.cli
      else if (resolution.status === 'ambiguous') {
        const response = await waitForInput(
          questionAgent.ctx.get('userQuestions')!.ask({
            agent: questionAgent,
            signal,
            questions: [
              {
                id: 'cliworker_qoder_variant',
                header: 'Qoder 版本',
                question: '检测到 Qoder 和 Qoder CN，请选择本次使用的版本',
                options: [{ label: 'Qoder' }, { label: 'Qoder CN' }],
              },
            ],
          }),
          signal,
        )
        signal.throwIfAborted()
        const answer = response.answers.find((item) => item.id === 'cliworker_qoder_variant')
        if (
          answer?.custom !== undefined ||
          answer?.selected.length !== 1 ||
          !['Qoder', 'Qoder CN'].includes(answer.selected[0]!)
        )
          throw new Error('请选择 Qoder 或 Qoder CN；任务尚未启动')
        cli = answer.selected[0] === 'Qoder' ? 'qoder' : 'qodercn'
      } else throw new Error('未找到 Qoder 或 Qoder CN 安装，请先安装或配置 CLI 路径；任务尚未启动')
      signal.throwIfAborted()
      this.assertExecution(agent, true)
      if (this.project(agent) !== project) throw new Error('项目已变更，请重新选择')
      this.runtime.assertCliEnabled(cli)
      return cli
    } finally {
      release()
      const pending = (this.pending.get(agent.id) ?? 1) - 1
      if (pending) this.pending.set(agent.id, pending)
      else this.pending.delete(agent.id)
      this.runtime.changed()
    }
  }
  async chooseWorkBuddyVariant(agent: Agent, callerSignal: AbortSignal, name: string, questionAgent = agent) {
    const signal = AbortSignal.any([callerSignal, this.disposed.signal])
    signal.throwIfAborted()
    const project = this.project(agent)
    const key = JSON.stringify([agent.id, project, 'workbuddy-variant'])
    const waits = (this.dispatchWaits ??= new Map())
    const previous = waits.get(key) ?? Promise.resolve()
    let release!: () => void
    const owned = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => owned)
    waits.set(key, tail)
    void tail.then(() => {
      if (waits.get(key) === tail) waits.delete(key)
    })
    this.pending.set(agent.id, (this.pending.get(agent.id) ?? 0) + 1)
    this.runtime.changed()
    try {
      await waitForInput(previous, signal)
      this.assertExecution(agent, true)
      const resolution = await this.resolveDispatchName(name, signal)
      signal.throwIfAborted()
      let cli: 'workbuddycn' | 'workbuddy'
      if (resolution.status === 'resolved' && isWorkBuddyCli(resolution.cli)) cli = resolution.cli
      else if (resolution.status === 'ambiguous') {
        const response = await waitForInput(
          questionAgent.ctx.get('userQuestions')!.ask({
            agent: questionAgent,
            signal,
            questions: [
              {
                id: 'cliworker_workbuddy_variant',
                header: 'WorkBuddy 版本',
                question: '检测到 WorkBuddy CN 和 WorkBuddy（国际版），请选择本次使用的版本',
                options: [{ label: 'WorkBuddy CN' }, { label: 'WorkBuddy（国际版）' }],
              },
            ],
          }),
          signal,
        )
        signal.throwIfAborted()
        const answer = response.answers.find((item) => item.id === 'cliworker_workbuddy_variant')
        if (
          answer?.custom !== undefined ||
          answer?.selected.length !== 1 ||
          !['WorkBuddy CN', 'WorkBuddy（国际版）'].includes(answer.selected[0]!)
        )
          throw new Error('请选择 WorkBuddy CN 或 WorkBuddy（国际版）；任务尚未启动')
        cli = answer.selected[0] === 'WorkBuddy CN' ? 'workbuddycn' : 'workbuddy'
      } else
        throw new Error(
          '未找到 WorkBuddy CN 或 WorkBuddy（国际版）安装，请先安装或配置 CLI 路径；任务尚未启动',
        )
      signal.throwIfAborted()
      this.assertExecution(agent, true)
      if (this.project(agent) !== project) throw new Error('项目已变更，请重新选择')
      this.runtime.assertCliEnabled(cli)
      return cli
    } finally {
      release()
      const pending = (this.pending.get(agent.id) ?? 1) - 1
      if (pending) this.pending.set(agent.id, pending)
      else this.pending.delete(agent.id)
      this.runtime.changed()
    }
  }
  /**
   * Serialize only this conversation's questions; a cancelled waiter never owns
   * the question. A settled setup asks nothing, so its catalog check leaves the
   * queue and parallel dispatches of one conversation start together.
   */
  async chooseDispatch(
    agent: Agent,
    callerSignal: AbortSignal,
    cli: CliId,
    questionAgent = agent,
  ): Promise<DispatchSetup> {
    const signal = AbortSignal.any([callerSignal, this.disposed.signal])
    signal.throwIfAborted()
    this.runtime.assertCliEnabled(cli)
    const project = this.project(agent)
    const key = JSON.stringify([agent.id, project, cli])
    const waits = (this.dispatchWaits ??= new Map())
    const turn = () => {
      const previous = waits.get(key) ?? Promise.resolve()
      let release!: () => void
      const owned = new Promise<void>((resolve) => {
        release = resolve
      })
      const tail = previous.then(() => owned)
      waits.set(key, tail)
      void tail.then(() => {
        if (waits.get(key) === tail) waits.delete(key)
      })
      return { previous, release }
    }
    this.pending.set(agent.id, (this.pending.get(agent.id) ?? 0) + 1)
    this.runtime.changed()
    try {
      for (let queued = false; ; queued = true) {
        const { previous, release } = turn()
        let held = true
        try {
          await waitForInput(previous, signal)
          signal.throwIfAborted()
          this.assertExecution(agent, true)
          this.runtime.assertCliEnabled(cli)
          if (!queued && this.runtime.storage.conversationSetup(agent.id, project, cli)) {
            release()
            held = false
          }
          this.settingsCatalogs ??= new SettingsCatalogCache(this.runtime.storage.directory)
          const catalogRevision = this.settingsCatalogs.revision(cli)
          const queried = await this.queryCatalog(cli, this.backend, this.options, project, signal)
          const { catalog } = queried
          let { binding } = queried
          signal.throwIfAborted()
          this.runtime.assertCliEnabled(cli)
          this.settingsCatalogs.remember(project, { catalog, binding }, catalogRevision)
          const models = catalog.models
          const valid = (setup: DispatchSetup | undefined): setup is DispatchSetup => {
            // A saved choice outlives an account change: the current account must still offer it,
            // and launch authorizes it again under that account.
            if (!setup || cliOf(setup.preference) !== cli) return false
            try {
              validatePreference(setup.preference, catalog)
              return resolveModel(setup.preference, models).model === setup.preference.model
            } catch {
              return false
            }
          }
          let asked = false
          const ask = async (questions: AskUserQuestionItem[]) => {
            signal.throwIfAborted()
            asked = true
            const response = await waitForInput(
              questionAgent.ctx.get('userQuestions')!.ask({ agent: questionAgent, signal, questions }),
              signal,
            )
            signal.throwIfAborted()
            this.runtime.assertCliEnabled(cli)
            return response
          }
          const current = this.runtime.storage.conversationSetup(agent.id, project, cli)
          let setup: DispatchSetup | undefined = valid(current) ? current : undefined
          // The settled setup no longer fits this catalog: ask again in turn.
          if (!setup && !held) continue
          let selected = false
          // The only unasked start: the user turned asking off and the saved complete setup still checks out.
          if (!setup && this.runtime.storage.generalSettings().askBeforeDispatch === false) {
            const saved = this.runtime.storage.dispatchSetup(project, cli)
            if (valid(saved)) setup = saved
          } else if (!current) {
            const saved = this.runtime.storage.dispatchSetup(project, cli)
            if (valid(saved)) {
              const modelLabel =
                models.find(
                  (model) =>
                    model.id === saved.preference.model ||
                    Object.values(model.variants ?? {}).includes(saved.preference.model),
                )?.label ?? saved.preference.model
              const response = await ask([
                {
                  id: 'cliworker_reuse',
                  header: '沿用设定',
                  question: `是否沿用 ${modelLabel} · ${effortLabel(saved.preference.effort)} · ${saved.role?.name ?? '不使用角色预设'}？`,
                  options: [{ label: '沿用' }, { label: '重新选择' }],
                },
              ])
              const answer = response.answers.find((item) => item.id === 'cliworker_reuse')
              if (
                answer?.custom !== undefined ||
                answer?.selected.length !== 1 ||
                !['沿用', '重新选择'].includes(answer.selected[0]!)
              )
                throw new Error('请选择沿用或重新选择；任务尚未启动')
              if (answer.selected[0] === '沿用') setup = saved
            }
          }
          if (!setup) {
            const choices = visibleModelChoices(models)
            const response = await ask([
              {
                id: 'cliworker_model',
                header: `${CLI_LABELS[cli]} 模型`,
                question: '选择模型',
                options: choices.map((model) => ({ label: model.label })),
              },
            ])
            const answer = response.answers.find((item) => item.id === 'cliworker_model')
            const chosen =
              answer?.custom === undefined && answer?.selected.length === 1
                ? choices.find((model) => model.label === answer.selected[0])
                : undefined
            if (!chosen?.efforts?.length) throw new Error('请选择列表中的模型')
            const offered = structuredClone(this.runtime.storage.rolePresets())
            const questions: AskUserQuestionItem[] = []
            if (chosen.efforts.length > 1)
              questions.push({
                id: 'cliworker_effort',
                header: '思考强度',
                question: `选择 ${chosen.label} 的思考强度`,
                options: chosen.efforts.map((effort) => ({ label: effortLabel(effort) })),
              })
            questions.push(roleQuestion(offered))
            const selection = await ask(questions)
            const effortAnswer = selection.answers.find((item) => item.id === 'cliworker_effort')
            const effort =
              chosen.efforts.length === 1
                ? chosen.efforts[0]
                : effortAnswer?.custom === undefined && effortAnswer?.selected.length === 1
                  ? chosen.efforts.find((effort) => effortLabel(effort) === effortAnswer.selected[0])
                  : undefined
            const preference = resolveModel(preferenceSchema.parse({ cli, model: chosen.id, effort }), models)
            setup = { preference, role: readRoleAnswer(offered, selection) ?? null, binding }
            selected = true
          }
          // A remembered answer is never execution authority. Detect changes during any
          // question; an unasked setup was just checked, and launch checks it again.
          if (asked) {
            const checked = await this.authorizeChoice(
              setup.preference,
              this.backend,
              this.options,
              project,
              signal,
              binding,
            )
            if (checked.preference.model !== setup.preference.model)
              throw new Error('模型与思考强度已变更，请重新选择')
            binding = checked.binding
            setup = { ...setup, binding }
          }
          signal.throwIfAborted()
          this.assertExecution(agent, true)
          this.runtime.assertCliEnabled(cli)
          if (this.project(agent) !== project) throw new Error('项目已变更，请重新选择')
          if (selected) this.runtime.storage.setDispatchSetup(project, setup)
          if (current !== setup) this.runtime.storage.setConversationSetup(agent.id, project, setup)
          ;(this.selectionBindings ??= new WeakMap()).set(setup.preference, binding)
          ;(this.selectionProjects ??= new WeakMap()).set(setup.preference, project)
          return setup
        } finally {
          if (held) release()
        }
      }
    } finally {
      const pending = (this.pending.get(agent.id) ?? 1) - 1
      if (pending) this.pending.set(agent.id, pending)
      else this.pending.delete(agent.id)
      this.runtime.changed()
    }
  }
  async launch(
    agent: Agent,
    title: string,
    prompt: string,
    preference: Preference,
    mode: TaskMode,
    workerId?: string,
    identity?: { agentName?: string; role?: RoleSnapshot; initiator?: Worker['initiator'] },
    signal: AbortSignal = this.disposed.signal,
    restartSourceId?: string,
    queuedAdmission?: { id: string; expectedRunId: string; priority?: boolean },
    preparationId?: string,
    submissionId?: string,
    attachments?: readonly NativeAttachment[],
    origin: RunOrigin = 'user',
    questionSessionId?: string,
  ): Promise<string> {
    if (workerId && !preparationId)
      return this.runtime.prepareFollowup(
        agent.id,
        workerId,
        signal,
        (control, id) =>
          this.launch(
            agent,
            title,
            prompt,
            preference,
            mode,
            workerId,
            identity,
            control,
            restartSourceId,
            queuedAdmission,
            id,
            submissionId,
            attachments,
            origin,
            questionSessionId,
          ),
        queuedAdmission?.priority ? queuedAdmission.id : undefined,
      )
    this.assertExecution(agent, true)
    this.assertAccessSupported(
      agent,
      cliOf(preference),
      workerId ? this.runtime.get(agent.id, workerId).level : undefined,
    )
    this.runtime.assertCliEnabled(cliOf(preference))
    if (this.accounts.isBusy(cliOf(preference)))
      throw new Error('此 CLI 正在管理账号，请先关闭账号终端再启动任务')
    const project = this.project(agent)
    const selectedProject = this.selectionProjects?.get(preference)
    if (!workerId && selectedProject && selectedProject !== project) throw new Error('项目已变更，请重新选择')
    // An existing task continues under the own account signed in now; a new task's
    // choice is authorized again under it when the account changed after the choice.
    const expected = workerId ? undefined : this.selectionBindings?.get(preference)
    const { binding, preference: authorizedPreference } = await this.authorizeChoice(
      preference,
      this.backend,
      this.options,
      project,
      signal,
      expected,
    )
    if (authorizedPreference.model !== preference.model) throw new Error('模型与思考强度不匹配，请重新选择')
    signal.throwIfAborted()
    this.assertExecution(agent, true)
    this.runtime.assertCliEnabled(cliOf(preference))
    if (this.accounts.isBusy(cliOf(preference))) throw new Error('请先关闭账号终端')
    if (this.project(agent) !== project) throw new Error('项目已变更，请重新选择')
    if (restartSourceId) this.runtime.assertLegacyRestart(agent.id, restartSourceId)
    if (identity?.initiator && !workerId) this.runtime.assertSiblingCapacity(agent.id)
    let submission: Submission | undefined
    // Fixed when the turn is admitted: a later parent change applies from the next turn.
    let permission:
      | { permission: Pick<WorkerPermissionReceipt, 'level' | 'name' | 'source'>; permissionSummary: string }
      | undefined
    const publish = () =>
      agent.ctx.get('jobs')!.start({
        kind: 'cliworker',
        owner: agent.id,
        label: `${CLI_LABELS[cliOf(preference)]} · ${title} · ${workerId ? '续聊' : '新任务'}：${prompt.replace(/\s+/g, ' ').slice(0, 100)}`,
        outputLimitBytes: 12000,
        run: () => {
          const submitted = this.runtime.submit(
            agent.id,
            project,
            title,
            prompt,
            preference,
            mode,
            workerId,
            identity,
            binding,
            queuedAdmission,
            preparationId,
            submissionId,
            attachments,
          )
          submission = submitted
          const admittedPermission = (permission = this.permissionReceipt(agent, submitted.worker))
          // Approvals of this exact turn surface where it was started.
          const runId = submitted.worker.runId
          if (runId) {
            const origins = (this.runOrigins ??= new Map())
            origins.set(runId, origin)
            if (questionSessionId) (this.runQuestionSessions ??= new Map()).set(runId, questionSessionId)
            void submitted.done.finally(() => {
              origins.delete(runId)
              this.runQuestionSessions?.delete(runId)
            })
          }
          return {
            cancel: submitted.cancel,
            done: submitted.done.then((worker) => ({
              status:
                worker.status === 'completed'
                  ? ('completed' as const)
                  : worker.status === 'interrupted'
                    ? ('killed' as const)
                    : ('failed' as const),
              detail: worker.error,
              result: JSON.stringify({
                cli: cliOf(worker.preference),
                workerId: worker.id,
                agentName: workerName(worker),
                runId: worker.runId,
                task: prompt.slice(0, 300),
                status: worker.status,
                response: worker.lastResult,
                error: worker.error,
                ...(worker.status === 'completed' && worker.resultNotice
                  ? { notice: worker.resultNotice }
                  : {}),
                ...admittedPermission,
                guidance:
                  [
                    worker.status === 'uncertain'
                      ? '结果待核实；请先核查本轮输出和实际产物，不要自动重试。'
                      : undefined,
                    worker.status === 'completed' && worker.resultNotice ? worker.resultNotice : undefined,
                    isolationGuidance(worker),
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined,
              }),
            })),
          }
        },
      })
    const id = identity?.initiator ? publishSiblingOutsideTool(publish) : publish()
    if (!submission) throw new Error('Harness did not publish the worker job')
    this.nativeRunDone.set(submission.worker.runId, submission.done)
    const runId = submission.worker.runId
    void submission.done.then(
      () => {
        this.nativeRunDone.delete(runId)
      },
      () => {
        this.nativeRunDone.delete(runId)
      },
    )
    try {
      this.runtime.attachJob(submission.worker, id)
    } catch (error) {
      // Admission already happened. Do not leave a process running without a
      // receipt when the job binding cannot be persisted.
      const admitted = submission
      const outcomes = await Promise.allSettled([
        Promise.resolve().then(() => admitted.cancel()),
        admitted.done,
      ])
      const failures = outcomes.filter((item): item is PromiseRejectedResult => item.status === 'rejected')
      if (failures.length)
        throw new AggregateError(
          [error, ...failures.map((item) => item.reason)],
          '任务登记失败；取消或清理报告异常',
        )
      throw error
    }
    return JSON.stringify({
      cli: cliOf(submission.worker.preference),
      workerId: submission.worker.id,
      agentName: workerName(submission.worker),
      runId: submission.worker.runId,
      jobId: id,
      status: submission.worker.status,
      model: submission.worker.preference.model,
      effort: submission.worker.preference.effort,
      // Report this tier as is; a Worker without its own level follows the parent preset.
      ...(permission ?? this.permissionReceipt(agent, submission.worker)),
    })
  }
  waitHarnessRun = harness.waitHarnessRun
  registerTools(): void {
    const output = {
      schema: { type: 'string' as const },
      render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
    }
    this.ctx.effect(
      () =>
        this.ctx.tools.register(
          defineTool({
            name: 'cliworker_resolve',
            description: `只读解析明确调用中的 CLI 名称、别名或轻微拼写误差，不启动任务、不读取账号、不保存选型。${CLI_NAME_GUIDANCE}。未知、歧义或多个目标返回简短候选错误，不启动、不额外发问题卡。`,
            parameters: {
              name: {
                type: 'string',
                required: true,
                description: '用户要求调用的 CLI 名称；不是任务内容或模型名称。',
              },
            },
            output,
            isConcurrencySafe: () => true,
            execute: async (args, exec) =>
              JSON.stringify(
                isGenericQoderName(args.name) || isGenericWorkBuddyName(args.name)
                  ? await this.resolveDispatchName(
                      args.name,
                      AbortSignal.any([exec.signal, this.disposed.signal]),
                    )
                  : resolveCliName(args.name),
              ),
          }),
        ),
      'cliworker:resolve',
    )
    this.ctx.effect(
      () =>
        this.ctx.tools.register(
          defineTool({
            name: 'cliworker_start',
            description: `用户明确要求“调用 agy cli”或“用 glm cli 完成任务”时，调用本工具打开 CLI Worker 的选型流程。只需提供 CLI、任务标题和任务内容；模型、思考强度与角色由插件收集，完成选型前不会启动任务，不要把它们当作调用本工具的前置输入。${CLI_NAME_GUIDANCE}。泛称 qoder / WorkBuddy 在双版本均安装时先通过原生询问选择版本。Host 在首次选择模型、思考强度与角色，或同项目新对话确认是否沿用时提问；同对话后续不重复。不要提前自行提问或增加确认，不代答。返回后台 job、worker ID、agentName 与 permission（本轮实际权限档位；未选过档位的 Worker 跟随主对话权限预设），向用户说明权限时以 permission 为准，不要自行推断。主对话的直接子 Agent（包括 CLI Worker）可同级派遣，新 Worker 归属主对话并与发起者同级；发起者不提供模型、强度、角色或会话 ID，每个主对话最多 6 个未结束的子 Agent 派遣。主对话的已有智能体续聊用 cliworker_followup；除泛称 qoder / WorkBuddy 的双版本选择外，其他歧义返回简短候选错误，不启动、不额外发问题卡。`,
            parameters: {
              cli: {
                type: 'string',
                required: true,
                description: `本次用户明确指定的 CLI 规范 ID 或别名：${CLI_NAME_GUIDANCE}。每次调用必填，Antigravity 也不可省略；不得照搬历史调用中省略 cli 的写法。较长名称仅接受唯一轻微误差；短名须精确，不猜模型。`,
              },
              title: { type: 'string', required: true },
              prompt: { type: 'string', required: true },
              agent_name: {
                type: 'string',
                description:
                  'Optional user-requested unique worker name within this parent conversation. Otherwise assigned from the CLI short name and an ordinal. Use followup by worker_name to reuse an existing named worker.',
              },
              read_only: {
                type: 'boolean',
                description:
                  'Use native read-only/plan mode; unsupported by Kimi print mode. Omit or false for coding.',
              },
            },
            output,
            timeoutMs: 1800000,
            isConcurrencySafe: () => true,
            execute: async (args, exec) => {
              if (!exec.agent) throw new Error('A parent Agent is required')
              const parent = await this.dispatchSubject(exec.agent)
              this.assertExecution(parent, true)
              const { questionAgent, initiator } = await this.siblingDispatch(exec.agent, parent, exec.signal)
              let cli = requireCliName(args.cli)
              if (isGenericWorkBuddyName(args.cli))
                cli = await this.chooseWorkBuddyVariant(parent, exec.signal, args.cli, questionAgent)
              if (isGenericQoderName(args.cli))
                cli = await this.chooseQoderVariant(parent, exec.signal, args.cli, questionAgent)
              const agentName =
                args.agent_name === undefined ? undefined : agentNameSchema.parse(args.agent_name)
              if (cli === 'kimi' && args.read_only) throw new Error('Kimi 非交互模式不支持只读派遣')
              const setup = await this.chooseDispatch(
                parent,
                AbortSignal.any([exec.signal, this.disposed.signal]),
                cli,
                questionAgent,
              )
              exec.signal.throwIfAborted()
              return this.launch(
                parent,
                args.title,
                args.prompt,
                setup.preference,
                args.read_only ? 'plan' : 'accept-edits',
                undefined,
                { agentName, role: setup.role ?? undefined, ...(initiator ? { initiator } : {}) },
                AbortSignal.any([exec.signal, this.disposed.signal]),
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                'agent',
                initiator ? questionAgent.id : undefined,
              )
            },
          }),
        ),
      'cliworker:start',
    )
    this.ctx.effect(
      () =>
        this.ctx.tools.register(
          defineTool({
            name: 'cliworker_status',
            description:
              'Read the parent conversation’s CLI workers or one worker’s latest result. Background completion is announced automatically.',
            parameters: { worker_id: { type: 'string' }, worker_name: { type: 'string' } },
            output,
            isConcurrencySafe: () => true,
            execute: async (args, exec) => {
              if (!exec.agent) throw new Error('A parent Agent is required')
              const parent = await this.dispatchSubject(exec.agent)
              if (args.worker_id || args.worker_name) {
                const dsh = await this.dshFallback(parent.id, args, exec.signal, () =>
                  this.runtime.resolveWorker(parent.id, args.worker_id, args.worker_name),
                )
                if ('kind' in dsh) return JSON.stringify(dsh)
                return JSON.stringify({
                  ...dsh,
                  agentName: workerName(dsh),
                  guidance: isolationGuidance(dsh),
                })
              }
              const dshRows =
                this.runtime.snapshot(parent.id).showDshSubagents === false
                  ? []
                  : (await this.dshSubagents.list(parent.id, exec.signal)).map((row) => ({
                      kind: 'dsh-subagent',
                      workerId: row.id,
                      agentName: row.agentName,
                      title: row.name,
                      status: row.stopped ? 'stopped' : row.status,
                      model: row.model,
                      mode: row.mode,
                    }))
              return JSON.stringify([
                ...this.runtime.snapshot(parent.id).workers.map((worker) => ({
                  ...worker,
                  agentName: workerName(worker),
                  guidance: isolationGuidance(worker),
                })),
                ...dshRows,
              ])
            },
          }),
        ),
      'cliworker:status',
    )
    this.ctx.effect(
      () =>
        this.ctx.tools.register(
          defineTool({
            name: 'cliworker_followup',
            description:
              "Continue a specific idle CLI worker by worker_id or its exact agentName in worker_name. Retains its role, current model/effort and CLI conversation; never starts another worker. A DSH native subagent listed in the CLI Worker window is continued the same way by its `dsh-N` name; its reply returns as a DSH subagent message. The CLI Worker receipt includes permission: this turn's actual tier (a Worker without its own level follows the parent preset); report it as is.",
            parameters: {
              worker_id: { type: 'string' },
              worker_name: { type: 'string' },
              prompt: { type: 'string', required: true },
            },
            output,
            isConcurrencySafe: () => true,
            execute: async (args, exec) => {
              if (!exec.agent) throw new Error('A parent Agent is required')
              const agent = exec.agent
              const target = await this.dshFallback(
                agent.id,
                args,
                exec.signal,
                () => this.runtime.resolveWorker(agent.id, args.worker_id, args.worker_name),
                args.prompt,
              )
              if ('kind' in target) return JSON.stringify(target)
              return this.continueWorker(agent.id, target.id, args.prompt, exec.signal, 'agent')
            },
          }),
        ),
      'cliworker:followup',
    )
    this.ctx.effect(
      () =>
        this.ctx.tools.register(
          defineTool({
            name: 'cliworker_stop',
            description: 'Stop a CLI worker and await cleanup of its managed processes.',
            parameters: { worker_id: { type: 'string' }, worker_name: { type: 'string' } },
            output,
            isConcurrencySafe: () => true,
            execute: async (args, exec) => {
              if (!exec.agent) throw new Error('A parent Agent is required')
              const worker = this.runtime.resolveWorker(exec.agent.id, args.worker_id, args.worker_name)
              return JSON.stringify(await this.runtime.stop(exec.agent.id, worker.id))
            },
          }),
        ),
      'cliworker:stop',
    )
    this.ctx.effect(
      () =>
        this.ctx.tools.register(
          defineTool({
            name: 'cliworker_merge',
            description:
              '把空闲 CLI 智能体隔离副本中的改动三方合并回当前项目，作为未提交改动写回，不会提交。隔离运行的智能体完成后，由你核查结果再调用本工具。只有一边改过的文件直接写回；两边都改过的文件不是错误，返回 needs_integration 及基线、项目、副本三个版本的文件路径，由你按各任务目标整合，再带 resolutions 调用本工具（use=content 附完整最终内容，或 use=copy / use=project）。只有两边目标相互矛盾时才用 ask_user_question 请用户选择。决定齐全前项目不变、副本保留。不要让 CLI 改到原目录重做。',
            parameters: {
              worker_id: { type: 'string' },
              worker_name: { type: 'string' },
              resolutions: {
                type: 'array',
                description:
                  'Decisions for files a previous call returned in needs_integration. Each item: path, use (content | copy | project), and content (the complete final file text) when use is content.',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    path: { type: 'string', required: true },
                    use: { type: 'string', enum: ['content', 'copy', 'project'], required: true },
                    content: { type: 'string' },
                  },
                },
              },
            },
            output,
            isConcurrencySafe: () => false,
            execute: async (args, exec) => {
              if (!exec.agent) throw new Error('A parent Agent is required')
              const worker = this.runtime.resolveWorker(exec.agent.id, args.worker_id, args.worker_name)
              const resolutions = readResolutions(args.resolutions)
              const result = await this.mergeIsolatedWorker(exec.agent, worker.id, exec.signal, resolutions)
              return JSON.stringify(
                result.status === 'merged'
                  ? result
                  : integrationReport(
                      workerName(worker),
                      result,
                      resolutions && result.conflicts.map((item) => item.path),
                    ),
              )
            },
          }),
        ),
      'cliworker:merge',
    )
    this.ctx.effect(
      () =>
        this.ctx.tools.register(
          defineTool({
            name: 'cliworker_discard',
            description:
              '丢弃空闲 CLI 智能体的隔离副本。执行前会向用户确认；确认后副本中的改动永久删除，主目录不变。用户未确认时副本保留。',
            parameters: { worker_id: { type: 'string' }, worker_name: { type: 'string' } },
            output,
            isConcurrencySafe: () => false,
            execute: async (args, exec) => {
              if (!exec.agent) throw new Error('A parent Agent is required')
              const agent = exec.agent
              const worker = this.runtime.resolveWorker(agent.id, args.worker_id, args.worker_name)
              const signal = AbortSignal.any([exec.signal, this.disposed.signal])
              const response = await waitForInput(
                agent.ctx.get('userQuestions')!.ask({
                  agent,
                  signal,
                  questions: [
                    {
                      id: 'cliworker_discard',
                      header: '丢弃副本',
                      question: `丢弃 ${workerName(worker)} 的隔离副本？副本中的改动将永久删除，项目主目录不变。`,
                      options: [{ label: '丢弃' }, { label: '保留' }],
                    },
                  ],
                }),
                signal,
              )
              const answer = response.answers.find((item) => item.id === 'cliworker_discard')
              if (
                answer?.custom !== undefined ||
                answer?.selected.length !== 1 ||
                answer.selected[0] !== '丢弃'
              )
                return JSON.stringify({ status: 'kept', message: '用户未确认，隔离副本已保留' })
              await this.runtime.discardIsolation(agent.id, worker.id)
              return JSON.stringify({ status: 'discarded' })
            },
          }),
        ),
      'cliworker:discard',
    )
  }
  settingsDisplayMetadata = settings.settingsDisplayMetadata
  invalidateSettingsDisplay = settings.invalidateSettingsDisplay
  mergeIsolatedWorker = workers.mergeIsolatedWorker
  preloadSettingsConnection = connections.preloadSettingsConnection
  preloadSettingsConnectionNow = connections.preloadSettingsConnectionNow
  loadSettingsAccount = connections.loadSettingsAccount
  loadSettingsCatalog = connections.loadSettingsCatalog
  readAccountStatus = accounts.readAccountStatus
  cleanupHeldStatus = accounts.cleanupHeldStatus
  executablePathSnapshot = connections.executablePathSnapshot
  probeExecutablePath = connections.probeExecutablePath
  trackAccountParent = accounts.trackAccountParent
  customProviderSource = accounts.customProviderSource
  customProviderManager = accounts.customProviderManager
  startAccount = accounts.startAccount
  settingsCatalog = models.settingsCatalog
  assertNativeWorkerSettingsIdle = permissions.assertNativeWorkerSettingsIdle
  configureColdWorkerPermission = permissions.configureColdWorkerPermission
  /** Shared follow-up admission; `origin` decides where this turn's approvals appear. */
  async continueWorker(
    parentSessionId: string,
    workerId: string,
    prompt: string,
    signal: AbortSignal,
    origin: RunOrigin,
  ): Promise<string> {
    try {
      const agent = await this.parent(parentSessionId)
      signal.throwIfAborted()
      this.assertExecution(agent, true)
      const worker = this.runtime.get(agent.id, workerId)
      this.runtime.assertCliEnabled(cliOf(worker.preference))
      return this.launch(
        agent,
        worker.title,
        prompt,
        worker.preference,
        worker.mode,
        workerId,
        undefined,
        signal,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        origin,
      )
    } catch (error) {
      throw failure(error)
    }
  }
}

export type { ServiceContext }
