import { SettingsConnectionCache } from './settings-connection-cache.ts'
import { BACKGROUND_ACCOUNT_CLIS, BACKGROUND_CATALOG_CLIS } from './cli-management/sources.ts'
import { backgroundConnectionConfig } from './settings-connection-background.ts'
import { isWorkBuddyCli } from './workbuddy-variant.ts'
import { SettingsCatalogCache } from './settings-catalog-cache.ts'
import { z as validate } from 'zod'
import { CLI_IDS, type CliId, type ActiveCliId } from '../shared/types.ts'
import { ProcessCleanupUnconfirmedError } from './process.ts'
import { backgroundCredentialRead } from './os-credential-store.ts'
import { configuredCliExecutable, resolveCliExecutable } from './adapters.ts'
import type { CliExecutablePathStatus } from '../shared/cli-settings.ts'
import { WindowsCliInstallationError } from './windows-cli-installation.ts'
import { failure } from './service-errors.ts'
import type { ServiceContext } from './service-context.ts'

export function connectionCache(this: ServiceContext) {
  const cache = (this.connections ??= new SettingsConnectionCache())
  const epochs = (this.connectionEpochs ??= new Map())
  for (const cli of CLI_IDS) {
    const entry = this.options?.cliExecutablePaths?.read(cli)
    const epoch = {
      account: this.cliManagement?.cache.accountRevision(cli) ?? 0,
      path: this.options?.cliExecutablePaths?.revision(cli) ?? 0,
      recorded: !!entry,
      held: !!this.runtime?.catalogCleanupMessage?.(cli),
    }
    const previous = epochs.get(cli)
    // The first auto-discovery records the very entry just queried; it is not a source switch.
    const initialAuto = previous && !previous.recorded && entry?.mode === 'auto'
    if (
      previous &&
      (previous.account !== epoch.account ||
        previous.held !== epoch.held ||
        (previous.path !== epoch.path && !initialAuto))
    )
      cache.invalidate(cli)
    epochs.set(cli, epoch)
  }
  return cache
}

export async function settingsConnectionStatus(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const id = validate.enum(CLI_IDS).parse(cli)
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    // A cleanup pause is this CLI's displayed state; report it without scheduling reads that would only return it.
    const held = host.cleanupHeldStatus(id)
    if (held) {
      const status = host.connectionCache().status(id)
      return JSON.stringify({
        ...status,
        account: { loading: false, value: held },
        catalog: { ...status.catalog, loading: false },
      })
    }
    host.runtime.assertCliEnabled(id)
    // Host-owned refresh outlives this quick snapshot request; close/invalidation cancels it.
    const account = !host.connectionCache().fresh(id, 'account')
    const catalog = !host.connectionCache().fresh(id, 'catalog')
    if (account)
      void backgroundCredentialRead(() =>
        host.readAccountStatus(parentSessionId, id, host.disposed.signal, false),
      ).catch(() => undefined)
    if (catalog)
      void backgroundCredentialRead(() =>
        host.settingsCatalog(parentSessionId, id, host.disposed.signal, false),
      ).catch(() => undefined)
    const status = host.connectionCache().status(id)
    // These reads have been scheduled even if their parent lookup has not yielded yet.
    if (account) status.account.loading = true
    if (catalog) status.catalog.loading = true
    return JSON.stringify(status)
  } catch (error) {
    throw failure(error)
  }
}

export async function* watchSettingsConnections(
  host: ServiceContext,
  parentSessionId: string,
  signal: AbortSignal,
): AsyncIterable<string> {
  try {
    await host.parent(parentSessionId)
    for await (const snapshot of host
      .connectionCache()
      .watch(AbortSignal.any([signal, host.disposed.signal])))
      yield JSON.stringify(snapshot)
  } catch (error) {
    throw failure(error)
  }
}

export function preloadSettingsConnection(
  this: ServiceContext,
  cli: ActiveCliId,
  kind: 'account' | 'catalog',
  signal: AbortSignal,
) {
  return backgroundCredentialRead(() => this.preloadSettingsConnectionNow(cli, kind, signal))
}

export async function preloadSettingsConnectionNow(
  this: ServiceContext,
  cli: ActiveCliId,
  kind: 'account' | 'catalog',
  signal: AbortSignal,
) {
  const release = this.options.cliMaintenance?.using(cli)
  try {
    const allowed = kind === 'account' ? BACKGROUND_ACCOUNT_CLIS : BACKGROUND_CATALOG_CLIS
    if (!allowed.includes(cli)) throw new Error('此 CLI 的连接查询保留前台')
    this.runtime.assertCliEnabled(cli)
    const held = this.runtime.catalogCleanupMessage(cli)
    if (held) throw new Error(held)
    if (kind === 'account') await this.loadSettingsAccount(cli, signal, false, true)
    else await this.loadSettingsCatalog(cli, signal, false, true)
  } catch (error) {
    if (error instanceof ProcessCleanupUnconfirmedError) this.runtime.blockCatalogOnCleanup(cli, error)
    throw error
  } finally {
    release?.()
  }
}

export function loadSettingsAccount(
  this: ServiceContext,
  cli: ActiveCliId,
  signal: AbortSignal,
  refresh: boolean,
  background = false,
) {
  return this.connectionCache().read(
    cli,
    'account',
    AbortSignal.any([signal, this.disposed.signal]),
    (control) => this.accounts.status(cli, this.machineDirectory(), control, { background }),
    refresh,
  )
}

/** The machine-wide model list shown in settings. A project's own CLI configuration (for example a project-level
 * route) only takes effect when a task is dispatched or a model is chosen for that project. */
export async function loadSettingsCatalog(
  this: ServiceContext,
  cli: ActiveCliId,
  signal: AbortSignal,
  refresh: boolean,
  background = false,
) {
  const assertAccountIdle = () => {
    if (this.accounts?.isBusy?.(cli)) throw new Error('请先关闭账号终端')
  }
  // The terminal's reservation is also the catalog admission gate. It is
  // released by AccountManager only after terminal/range/runtime cleanup.
  assertAccountIdle()
  const machine = this.machineDirectory()
  return this.connectionCache().read(
    cli,
    'catalog',
    AbortSignal.any([signal, this.disposed.signal]),
    async (control) => {
      // A read may have queued before the terminal took the CLI.
      assertAccountIdle()
      const config = background ? await backgroundConnectionConfig(cli, this.options, control) : this.options
      control.throwIfAborted()
      assertAccountIdle()
      this.settingsCatalogs ??= new SettingsCatalogCache(this.runtime.storage.directory)
      return this.settingsCatalogs.get({
        cli,
        project: machine,
        signal: control,
        refresh: true,
        selfVerifiedDiscovery: cli === 'qoder' || cli === 'qodercn' || isWorkBuddyCli(cli),
        binding: () => this.readAccountBinding(cli, this.backend, config, machine, control),
        discover: () => this.queryCatalog(cli, this.backend, config, machine, control),
      })
    },
    refresh,
  )
}

export function executablePathSnapshot(this: ServiceContext, cli: CliId): CliExecutablePathStatus {
  const saved = this.options.cliExecutablePaths?.read(cli)
  const configured = configuredCliExecutable(cli, this.options)
  const manual = saved?.mode === 'manual'
  return {
    cli,
    path: manual ? saved.path : (configured ?? saved?.path ?? ''),
    source: manual ? 'manual' : configured ? 'configured' : saved ? 'auto' : 'none',
    available: false,
  }
}

export async function probeExecutablePath(
  this: ServiceContext,
  cli: CliId,
  signal: AbortSignal,
): Promise<CliExecutablePathStatus> {
  try {
    const path = await resolveCliExecutable(cli, this.backend, this.options, signal)
    signal.throwIfAborted()
    const current = this.executablePathSnapshot(cli)
    return { ...current, path: current.source === 'manual' ? current.path : path, available: true }
  } catch (error) {
    if (error instanceof ProcessCleanupUnconfirmedError) {
      this.runtime.blockCatalogOnCleanup(cli, error)
      throw error
    }
    signal.throwIfAborted()
    return {
      ...this.executablePathSnapshot(cli),
      error:
        error instanceof WindowsCliInstallationError
          ? error.message
          : 'CLI 路径不可用，请确认填写的是 CLI 文件的完整路径，再刷新重试',
    }
  }
}

export async function cliExecutablePath(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  signal: AbortSignal,
): Promise<string> {
  let release: (() => void) | undefined
  try {
    await host.parent(parentSessionId)
    const id = validate.enum(CLI_IDS).parse(cli)
    const control = AbortSignal.any([signal, host.disposed.signal])
    control.throwIfAborted()
    release = host.options?.cliMaintenance?.using(id)
    // While a CLI is in use, expose its saved selection without probing or
    // replacing an installation under an active task/account terminal.
    try {
      host.runtime.assertAccountIdle(id)
      if (host.accounts.isBusy(id)) throw new Error('请先关闭此 CLI 的账号终端再刷新路径')
    } catch (error) {
      return JSON.stringify({ ...host.executablePathSnapshot(id), error: String(error) })
    }
    return JSON.stringify(await host.probeExecutablePath(id, control))
  } catch (error) {
    throw failure(error)
  } finally {
    release?.()
  }
}

export async function refreshCliExecutablePath(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  path: string,
  action: string,
  signal: AbortSignal,
): Promise<string> {
  let release: (() => void) | undefined
  try {
    await host.parent(parentSessionId)
    const id = validate.enum(CLI_IDS).parse(cli)
    const operation = validate.enum(['manual', 'refresh', 'auto']).parse(action)
    const control = AbortSignal.any([signal, host.disposed.signal])
    control.throwIfAborted()
    release = host.options?.cliMaintenance?.using(id)
    host.runtime.assertAccountIdle(id)
    if (host.accounts.isBusy(id)) throw new Error('请先关闭此 CLI 的账号终端再修改路径')
    const store = host.options.cliExecutablePaths
    if (!store) throw new Error('CLI 路径存储尚未就绪')
    if (operation === 'manual') store.setManual(id, path)
    else if (operation === 'auto') store.reset(id)
    host.displayedBindings?.clear()
    host.invalidateSettingsDisplay(id)
    host.runtime.changed()
    return JSON.stringify(await host.probeExecutablePath(id, control))
  } catch (error) {
    throw failure(error)
  } finally {
    release?.()
  }
}
