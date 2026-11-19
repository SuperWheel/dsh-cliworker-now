import type { SettingsConnectionCache } from './settings-connection-cache.ts'
import type { CustomProviders } from './custom-provider.ts'
import type { CliManagementService } from './cli-management/service.ts'
import type { AgentNameOverrides, PendingAgentNames } from './agent-name-overrides.ts'
import type { DshSubagents } from './dsh-subagents.ts'
import type { SettingsCatalogCache } from './settings-catalog-cache.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { HarnessConversationStore } from './harness-conversation-store.ts'
import type { HarnessConversationApi } from './harness-conversation-types.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { RunOrigin } from './native-approval-policy.ts'
import type { CliId, Preference, Worker } from '../shared/types.ts'
import type { ProcessBackend, RuntimeConfig } from './process.ts'
import type { WorkerRuntime } from './runtime.ts'
import type { AccountManager } from './accounts.ts'
import type { CliWorkerService } from './index.ts'
import * as harness from './service-harness.ts'
import * as workers from './service-workers.ts'
import * as settings from './service-settings.ts'
import * as accounts from './service-accounts.ts'
import * as connections from './service-connections.ts'
import * as models from './service-models.ts'
import * as permissions from './service-permissions.ts'
import * as messages from './service-messages.ts'
import * as dispatch from './service-dispatch.ts'
import * as launch from './service-launch.ts'
import * as tools from './service-tools.ts'

/** Per-instance dependencies and the operations shared across Host domains. */
export class ServiceContext {
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
  agentNameOverrides!: AgentNameOverrides
  pendingAgentNames!: PendingAgentNames
  dshSubagents!: DshSubagents
  disposed = new AbortController()
  harnessConversation?: HarnessConversationApi
  harnessConversationStore?: HarnessConversationStore
  nativeRunDone = new Map<string, Promise<Worker>>()
  repairingDisplays = new Set<string>()
  renamingWorkers = new Set<string>()

  constructor(
    readonly ctx: Context,
    readonly remote: Pick<
      CliWorkerService,
      | 'catalogForCli'
      | 'clearWorkerGoal'
      | 'configureWorkerPermission'
      | 'forkWorker'
      | 'permissionForWorker'
      | 'setWorkerGoal'
      | 'setWorkerGoalStatus'
      | 'steerMessage'
    >,
  ) {}
  connectionCache = connections.connectionCache
  parent = harness.parent
  project = harness.project
  machineDirectory = harness.machineDirectory
  preferenceProject = harness.preferenceProject
  dshFallback = harness.dshFallback
  dispatchSubject = dispatch.dispatchSubject
  siblingDispatch = dispatch.siblingDispatch
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
  resolveDispatchName = dispatch.resolveDispatchName
  chooseQoderVariant = dispatch.chooseQoderVariant
  chooseWorkBuddyVariant = dispatch.chooseWorkBuddyVariant
  chooseDispatch = dispatch.chooseDispatch
  launch = launch.launch
  waitHarnessRun = harness.waitHarnessRun
  registerTools = tools.registerTools
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
  continueWorker = messages.continueWorker
}
