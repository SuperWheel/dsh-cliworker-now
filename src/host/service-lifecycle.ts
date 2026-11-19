import { startTemporaryTreeMaintenance } from './temporary-sweep.ts'
import { CliMaintenance } from './cli-management/maintenance.ts'
import { CliManagementService } from './cli-management/service.ts'
import { ownsDirectSubagent } from './native-subagent-ownership.ts'
import { AgentNameOverrides, PendingAgentNames, officialRename } from './agent-name-overrides.ts'
import { AgentNameResolutionError, registerAgentNameTools } from './agent-name-tools.ts'
import { migrateOverridesToOfficial } from './agent-name-official.ts'
import { agentNameKey } from '../shared/agent-names.ts'
import { DshSubagents, ownedHarnessSessions, type DshSubagentServices } from './dsh-subagents.ts'
import { Context } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DsBotLineage } from './parent-lineage.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { runAccess } from './native-approval-policy.ts'
import { CLI_IDS, cliOf, workerName } from '../shared/types.ts'
import { DEFAULT_CONFIG } from './process.ts'
import { nativeProcessBackend } from './native-process.ts'
import { WindowsSystemProxySource } from './windows-system-proxy.ts'
import { MacOSSystemProxySource } from './macos-system-proxy.ts'
import { hostProxyLookup } from './system-proxy.ts'
import { backgroundCredentialRead, installOsCredentialStore } from './os-credential-store.ts'
import { setHostProxy } from './host-fetch.mjs'
import { CliExecutablePathStore } from './cli-executable-paths.ts'
import { effectiveLevel, levelName } from '../shared/worker-permissions.ts'
import { WorkerStorage } from './storage.ts'
import { WorkerRuntime } from './runtime.ts'
import { AccountManager } from './accounts.ts'
import { delegationGuidance, registerCliRouting } from './routing.ts'
import type { ServiceContext } from './service-context.ts'
import type { Config } from './index.ts'
import * as harness from './service-harness.ts'

export function initialize(host: ServiceContext, ctx: Context, config: Config) {
  host.options = {
    ...DEFAULT_CONFIG,
    ...config,
  }

  const stateDirectory =
    config.stateDirectory ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'cliworker-now')

  host.options.cliMaintenance = new CliMaintenance()

  host.options.cliExecutablePaths = new CliExecutablePathStore(stateDirectory)

  // macOS/Windows: CLIs and Host HTTPS reads share the system proxy.
  const raw = nativeProcessBackend(ctx.subprocess)

  const systemProxy =
    process.platform === 'win32'
      ? new WindowsSystemProxySource((spec) => raw.spawn(spec))
      : process.platform === 'darwin'
        ? new MacOSSystemProxySource((spec) => raw.spawn(spec))
        : undefined

  host.backend = nativeProcessBackend(ctx.subprocess, process.platform, { systemProxy })

  if (systemProxy) {
    void systemProxy.refresh()
    setHostProxy(hostProxyLookup(systemProxy))
  }

  // ZCode's OS-held credential key is read through the Host's own process backend.
  const releaseCredentialStore = installOsCredentialStore(host.backend, host.options)

  host.accounts = new AccountManager(
    host.backend,
    host.options,
    undefined,
    (cli, error) => host.runtime.blockCatalogOnCleanup(cli, error),
    (cli) => host.invalidateSettingsDisplay(cli),
  )

  host.agentNameOverrides = new AgentNameOverrides(stateDirectory)
  host.pendingAgentNames = new PendingAgentNames()
  host.dshSubagents = new DshSubagents(
    stateDirectory,
    {
      subagents: () => host.ctx.get('subagents'),
      query: () => host.ctx.get('sessionQuery') as ReturnType<DshSubagentServices['query']>,
      assertLiveChild: (parentId, id) => {
        const child = host.ctx.agents.get(SessionId(id))
        if (!child) return // Cold prompt restoration validates its catalog ancestry in DSH.
        const parent = host.ctx.agents.get(SessionId(parentId))
        if (!parent || !ownsDirectSubagent(host.ctx.get('subagents'), parent, child))
          throw new Error('DSH 子会话所属主对话不匹配')
      },
      workers: () => host.runtime.storage.workers.values(),
      namesChanged: () => host.runtime.changed(),
      relatedSessions: (workerId) => {
        const record = host.harnessConversationStore?.list().find((row) => row.workerId === workerId)
        return record ? [record.sessionId, ...(record.retiredSessionIds ?? [])] : []
      },
      workerNames: (parent, excluding) => host.runtime.workerNames(parent, excluding),
      reconcile: (parent) => host.runtime.reconcileDirectory(parent),
      ownedSessions: () =>
        ownedHarnessSessions(host.runtime.storage.workers.values(), host.harnessConversationStore?.list()),
      hasWorker: (id) => host.runtime.storage.workers.has(id),
      subscribe: (notify) => {
        const offSession = host.ctx.on(
          'session/event',
          (session, event) => {
            if (
              [
                'subagent/catalog',
                'subagent/rename',
                'subagent/descriptor',
                'turn/start',
                'turn/end',
                'model/selection',
                'request/header',
              ].includes(event.type)
            )
              notify(session.id)
          },
          { global: true },
        )
        // Worker registration/hiding can change exclusion without a native event.
        const offWorkers = host.runtime.subscribe(() => {
          for (const worker of host.runtime.storage.workers.values()) notify(worker.parentSessionId)
        })
        return () => {
          offSession()
          offWorkers()
        }
      },
      log: (reason) => console.warn(`[CLI Worker / DSH] ${reason}`),
    },
    host.agentNameOverrides,
    host.pendingAgentNames,
  )

  host.runtime = new WorkerRuntime(
    new WorkerStorage(stateDirectory),
    host.backend,
    host.options,
    host.dshSubagents,
  )

  // REQ-0138 §7: until DSH has an official rename, overlay names reach the native
  // subagent tools through these hooks (creation guard, addressing, list_agents).
  ctx.effect(
    () =>
      registerAgentNameTools(ctx, {
        overrides: host.agentNameOverrides,
        pending: host.pendingAgentNames,
        occupied: (parent) => host.dshSubagents.occupiedNames(parent),
        workerAlias: (parent, name) => {
          const key = agentNameKey(name)
          const owners = new Set<string>()
          for (const worker of host.runtime.storage.workers.values()) {
            const child = worker.harnessConversation?.sessionId
            if (!child || worker.parentSessionId !== parent) continue
            if (
              [workerName(worker), ...(worker.nameAliases ?? [])].some((alias) => agentNameKey(alias) === key)
            )
              owners.add(child)
          }
          if (owners.size > 1) throw new AgentNameResolutionError('子 Agent 名称有歧义，请使用明确的会话 ID')
          return owners.values().next().value
        },
        subagents: () => host.ctx.get('subagents'),
        log: (reason) => console.warn(`[CLI Worker / names] ${reason}`),
      }),
    'cliworker:agent-name-tools',
  )

  // Official rename (future DSH): migrate overlay entries one by one; failures keep the entry.
  ctx.effect(() => {
    const controller = new AbortController()
    const official = officialRename(host.ctx.get('subagents'))
    if (official && host.agentNameOverrides.parents().length)
      void migrateOverridesToOfficial(
        {
          overrides: host.agentNameOverrides,
          official,
          readCatalog: (parent, signal) => host.dshSubagents.readDirectoryNames(parent, signal),
          log: (reason) => console.warn(`[CLI Worker / names] ${reason}`),
        },
        controller.signal,
      )
        .then((report) => {
          if (report.kept.length)
            console.warn(`[CLI Worker / names] ${report.kept.length} 项名称覆盖保留，待下次启动重试`)
        })
        .catch(() => {
          if (!controller.signal.aborted) console.warn('[CLI Worker / names] 官方改名迁移未完成，保留覆盖表')
        })
    return () => controller.abort()
  }, 'cliworker:agent-name-official-migration')

  host.cliManagement = new CliManagementService({
    root: stateDirectory,
    backend: host.backend,
    config: host.options,
    idle: () => !host.runtime.hasActiveCliWork() && !CLI_IDS.some((cli) => host.accounts.isBusy(cli)),
    enabled: () => host.runtime.generalSettings().backgroundCliCheck,
    cliEnabled: (cli) => host.runtime.storage.cliSettings().enabled[cli],
    account: (cli, signal) =>
      backgroundCredentialRead(() =>
        host.accounts.status(cli, host.machineDirectory(), signal, { background: true }),
      ),
    preloadConnection: (cli, kind, signal) => host.preloadSettingsConnection(cli, kind, signal),
    cleanup: (cli, error) => host.runtime.blockCatalogOnCleanup(cli, error),
    globalCleanup: (error) => host.runtime.blockOnCleanup(error),
    busy: (cli) => ({
      workers: host.runtime.busyCliWorkers(cli),
      accounts: host.accounts.isBusy(cli) || host.accounts.hasActiveQuery(cli),
    }),
    assertUpdateAllowed: (cli) => {
      host.runtime.assertHostOpen()
      const held = host.runtime.catalogCleanupMessage(cli)
      if (held) throw new Error(held)
    },
    invalidateModels: (cli) => host.invalidateSettingsDisplay(cli),
  })

  ctx.effect(
    () =>
      host.runtime.subscribe(() => {
        host.cliManagement.activityChanged()
        host.connectionCache()
      }),
    'cliworker:metadata-idle',
  )

  ctx.effect(
    () =>
      host.accounts.subscribeActivity((cli) => {
        host.cliManagement.activityChanged()
        host.invalidateSettingsDisplay(cli)
      }),
    'cliworker:metadata-accounts',
  )

  harness.registerConversationBridge(host)

  host.runtime.setFollowupLauncher(async (worker, item, admission, signal) => {
    const agent = await host.parent(worker.parentSessionId)
    const control = AbortSignal.any([signal, host.disposed.signal])
    control.throwIfAborted()
    await host.launch(
      agent,
      worker.title,
      item.prompt,
      worker.preference,
      worker.mode,
      worker.id,
      undefined,
      control,
      undefined,
      admission,
    )
  })

  host.runtime.setQueuedExecutionGuard((worker) => {
    const agent = host.ctx.agents.get(worker.parentSessionId as Agent['id'])
    if (!agent) throw new Error('父会话已关闭，请重新打开后继续发送')
    host.assertExecution(agent, true)
    host.assertAccessSupported(agent, cliOf(worker.preference), worker.level)
    if (host.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
    host.runtime.assertCliEnabled(cliOf(worker.preference))
    if (host.accounts.isBusy(cliOf(worker.preference))) throw new Error('请先关闭账号终端')
  })

  const temporarySweep = startTemporaryTreeMaintenance(stateDirectory)

  ctx.effect(
    () => () => {
      host.disposed.abort()
      host.customProviders?.close()
      host.dshSubagents.dispose()
      setHostProxy(undefined)
      return Promise.all([
        releaseCredentialStore(),
        temporarySweep.close(),
        systemProxy?.close(),
        host.cliManagement.close(),
        host.connections?.close(),
        host.runtime.close(),
        host.accounts.close(),
        ...[...host.accountParents.values()].map((dispose) => dispose()),
      ])
    },
    'cliworker:lifetime',
  )

  ctx.effect(
    () =>
      host.runtime.setApprovalHandler((worker, request, signal, mode) =>
        host.decideNativeApproval(worker, request, signal, mode),
      ),
    'cliworker:approvals',
  )

  // Issue #10: DS Bot moves a long conversation to a fresh root Session; its team file is the only proof of the chain.
  ctx.effect(() => host.runtime.setParentLineage(new DsBotLineage()), 'cliworker:parent-lineage')

  // Ahead of the Remote answerer, which would ask only in the Worker's child session.
  ctx.on('approval/request', (request, next) => host.answerHarnessApproval(request, next), true)

  ctx.effect(
    () =>
      host.runtime.setAccessSnapshot((worker) => {
        const parent = host.ctx.agents.get(worker.parentSessionId as Agent['id'])
        if (!parent) return undefined
        const state = host.permissionState(parent)
        const access = runAccess(worker.mode, worker.level, state)
        if (worker.mode === 'plan' || state.planMode) return { access, label: '规划模式' }
        return {
          access,
          label: levelName(cliOf(worker.preference), effectiveLevel(worker.level, state.sandbox)),
        }
      }),
    'cliworker:access',
  )

  host.registerTools()

  registerCliRouting(ctx)

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'cliworker:delegation',
        order: 80,
        text: delegationGuidance,
      }),
    'cliworker:guidance',
  )
}
