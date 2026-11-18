import { Context, withProps } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-plan-mode'

import { DEFAULT_CONFIG } from './process.ts'
import { ServiceContext } from './service-context.ts'
import * as harness from './service-harness.ts'
import * as history from './service-history.ts'
import * as workers from './service-workers.ts'
import * as settings from './service-settings.ts'
import * as cliUpdates from './service-cli-updates.ts'
import * as accounts from './service-accounts.ts'
import * as connections from './service-connections.ts'
import * as models from './service-models.ts'
import * as permissions from './service-permissions.ts'
import * as messages from './service-messages.ts'
import * as lifecycle from './service-lifecycle.ts'

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

  private readonly context: ServiceContext
  private get host(): ServiceContext {
    // Cordis overlays ctx on the receiver at each call site. Keep state shared across those scopes.
    return this.context.remote === this
      ? this.context
      : withProps(this.context, { ctx: this.ctx, remote: this })
  }

  /** @param ctx - Harness services. @param config - Validated deployment options. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'cliworker', { namespace: 'cliworker' })
    this.context = new ServiceContext(ctx, this)
    lifecycle.initialize(this.context, ctx, config)
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
    return messages.submitMessage(this.host, parentSessionId, workerId, requestJSON, signal)
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
    return messages.queueFollowup(
      this.host,
      parentSessionId,
      workerId,
      prompt,
      expectedRunId,
      requestId,
      signal,
    )
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
    return messages.steerMessage(
      this.host,
      parentSessionId,
      workerId,
      prompt,
      expectedRunId,
      requestId,
      signal,
    )
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
    return messages.sendRunningMessage(
      this.host,
      parentSessionId,
      workerId,
      prompt,
      expectedRunId,
      requestId,
      signal,
    )
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
    return messages.interruptMessage(
      this.host,
      parentSessionId,
      workerId,
      prompt,
      requestId,
      clientId,
      sequence,
      signal,
    )
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
    return messages.interruptQueuedFollowup(
      this.host,
      parentSessionId,
      workerId,
      queuedId,
      expectedRunId,
      signal,
    )
  }
  /** @param parentSessionId - Owning parent. @param workerId - Owning Worker. @param queuedId - Unsent item identity. @param signal - Mutation lifetime. @returns Completion; already admitted messages cannot be cancelled here. */
  @Remote('cancelQueuedFollowup')
  async cancelQueuedFollowup(
    parentSessionId: string,
    workerId: string,
    queuedId: string,
    signal: AbortSignal,
  ): Promise<void> {
    return messages.cancelQueuedFollowup(this.host, parentSessionId, workerId, queuedId, signal)
  }
  /** @param parentSessionId - Owning parent. @param workerId - Idle Worker with paused messages. @param expectedRunId - Current run identity. @param signal - Mutation lifetime. @returns Explicit queue reactivation; each turn rechecks native authorization. */
  @Remote('retryQueuedFollowups')
  async retryQueuedFollowups(
    parentSessionId: string,
    workerId: string,
    expectedRunId: string,
    signal: AbortSignal,
  ): Promise<void> {
    return messages.retryQueuedFollowups(this.host, parentSessionId, workerId, expectedRunId, signal)
  }
  /** @param parentSessionId - Parent session identity. @param workerId - Worker to continue. @param prompt - New task. @param signal - Admission lifetime. @returns Published background receipt. */
  @Remote('followup')
  async followup(
    parentSessionId: string,
    workerId: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    return messages.followup(this.host, parentSessionId, workerId, prompt, signal)
  }
  /** @param parentSessionId - Owning parent. @param workerId - Idle legacy history without an account binding. @param prompt - Explicit new-dialog task. @param signal - Admission lifetime. @returns JSON background receipt for a fresh Worker. */
  @Remote('restartWorker')
  async restartWorker(
    parentSessionId: string,
    workerId: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    return messages.restartWorker(this.host, parentSessionId, workerId, prompt, signal)
  }
  /** @param parentSessionId - Owning Harness session. @param workerId - Worker to stop. @returns Final worker state after cleanup. */
  @Remote('stop')
  async stop(parentSessionId: string, workerId: string): Promise<string> {
    return messages.stop(this.host, parentSessionId, workerId)
  }
}

export default CliWorkerService
