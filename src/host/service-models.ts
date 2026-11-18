import { isWorkBuddyCli } from './workbuddy-variant.ts'
import { readCliAccountBinding } from './cli-account-binding.ts'
import { setTimeout as sleep } from 'node:timers/promises'
import { SettingsCatalogCache } from './settings-catalog-cache.ts'
import { resolveModel } from '../shared/models.ts'
import { z as validate } from 'zod'
import { CLI_IDS, cliOf, EFFORTS, type CliId, type Preference } from '../shared/types.ts'
import { ProcessCleanupUnconfirmedError } from './process.ts'
import { explicitCredentialRead } from './os-credential-store.ts'
import { validatePreference } from './adapters.ts'
import { ACCOUNT_CHANGED, authorizedCatalog, authorizeSelection } from './authorized-catalog.ts'
import { ownAccountBusy as accountBusy } from './own-account-lease.mjs'
import { failure } from './service-errors.ts'
import type { ServiceContext } from './service-context.ts'

/** Catalog reads hold a busy Pi/OMP account for seconds; a run holds it longer. */
const BUSY_ACCOUNT_WAIT_MS = 30_000

const BUSY_ACCOUNT_RETRY_MS = 1000

const EXCLUSIVE_ACCOUNT_CLIS = new Set<CliId>(['omp', 'pi'])

export const preferenceSchema = validate.object({
  cli: validate.enum(CLI_IDS).optional(),
  model: validate.string().min(1),
  effort: validate.enum(EFFORTS),
})

export async function readAccountBinding(
  this: ServiceContext,
  ...args: Parameters<typeof readCliAccountBinding>
) {
  const release = this.options?.cliMaintenance?.using(args[0])
  // A dispatch or settings read the user asked for may ask the keychain again; background scopes stay background.
  try {
    return await explicitCredentialRead(() => readCliAccountBinding(...args))
  } catch (error) {
    if (error instanceof ProcessCleanupUnconfirmedError) this.runtime.blockCatalogOnCleanup(args[0], error)
    throw error
  } finally {
    release?.()
  }
}

export async function queryCatalog(this: ServiceContext, ...args: Parameters<typeof authorizedCatalog>) {
  const release = this.options?.cliMaintenance?.using(args[0])
  try {
    return await explicitCredentialRead(() => this.freshCatalog(...args))
  } catch (error) {
    if (error instanceof ProcessCleanupUnconfirmedError) this.runtime.blockCatalogOnCleanup(args[0], error)
    if (accountBusy(error)) return await this.busyAccountCatalog(error, ...args)
    throw error
  } finally {
    release?.()
  }
}

export async function freshCatalog(this: ServiceContext, ...args: Parameters<typeof authorizedCatalog>) {
  const [cli, , , project] = args
  const revision = this.settingsCatalogs?.revision(cli)
  const result = await authorizedCatalog(...args)
  // Parallel dispatches waiting on this exclusive account read the fresh result.
  if (EXCLUSIVE_ACCOUNT_CLIS.has(cli) && revision !== undefined)
    try {
      this.settingsCatalogs?.remember(project, result, revision)
    } catch {
      // A source change during the read is caught by the next fresh check.
    }
  return result
}

/**
 * A Pi/OMP OAuth account is exclusive while another run or catalog read holds
 * it. Dispatch only needs this account's choices to queue the task, and the run
 * authorizes afresh once the account is free, so a busy account uses its last
 * verified catalog. Without one, wait for the short catalog reads to finish.
 */
export async function busyAccountCatalog(
  this: ServiceContext,
  busy: unknown,
  ...args: Parameters<typeof authorizedCatalog>
) {
  const [cli, backend, config, project, signal, expected] = args
  const saved = async () => {
    const binding = await this.readAccountBinding(cli, backend, config, project, signal)
    if (expected && binding !== expected) throw new Error(ACCOUNT_CHANGED)
    const catalog = this.settingsCatalogs?.display(project, cli, binding)
    return catalog && { catalog, binding }
  }
  for (const deadline = Date.now() + BUSY_ACCOUNT_WAIT_MS; ; ) {
    const hit = await saved()
    if (hit) return hit
    if (Date.now() >= deadline) throw busy
    await sleep(BUSY_ACCOUNT_RETRY_MS, undefined, { signal })
    // Another read may have finished while this one slept.
    const later = await saved()
    if (later) return later
    try {
      return await this.freshCatalog(...args)
    } catch (error) {
      if (!accountBusy(error)) throw error
    }
  }
}

export async function authorizeChoice(this: ServiceContext, ...args: Parameters<typeof authorizeSelection>) {
  const release = this.options?.cliMaintenance?.using(cliOf(args[0]))
  try {
    return await this.querySelection(...args)
  } catch (error) {
    // A choice made under the previous account stands when the account signed in
    // now offers it too; the change itself is not announced.
    const [preference, backend, config, project, signal, expected] = args
    if (!expected || !(error instanceof Error) || error.message !== ACCOUNT_CHANGED) throw error
    signal.throwIfAborted()
    return await this.querySelection(preference, backend, config, project, signal)
  } finally {
    release?.()
  }
}

export async function querySelection(this: ServiceContext, ...args: Parameters<typeof authorizeSelection>) {
  const [preference, ...rest] = args
  try {
    return await authorizeSelection(...args)
  } catch (error) {
    if (error instanceof ProcessCleanupUnconfirmedError)
      this.runtime.blockCatalogOnCleanup(cliOf(preference), error)
    if (!accountBusy(error)) throw error
    const result = await this.busyAccountCatalog(error, cliOf(preference), ...rest)
    validatePreference(preference, result.catalog)
    return { ...result, preference: resolveModel(preference, result.catalog.models) }
  }
}

export async function catalog(
  host: ServiceContext,
  parentSessionId: string,
  signal: AbortSignal,
): Promise<string> {
  return host.remote.catalogForCli(parentSessionId, 'antigravity', signal)
}

export async function catalogForCli(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  signal: AbortSignal,
): Promise<string> {
  return host.settingsCatalog(parentSessionId, cli, signal, false)
}

export async function catalogForWorker(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  signal: AbortSignal,
): Promise<string> {
  let queriedCli: CliId | undefined
  let release: (() => void) | undefined
  try {
    const agent = await host.parent(parentSessionId)
    const control = AbortSignal.any([signal, host.disposed.signal])
    control.throwIfAborted()
    const worker = host.runtime.get(agent.id, workerId)
    const cli = cliOf(worker.preference)
    queriedCli = cli
    release = host.options?.cliMaintenance?.using(cli)
    host.runtime.assertCliEnabled(cli)
    host.settingsCatalogs ??= new SettingsCatalogCache(host.runtime.storage.directory)
    // An isolated conversation's account was verified against its copy.
    const directory = host.runtime.catalogDirectory(worker)
    const saved = host.runtime.storage.accountBinding(workerId)
    let catalog = saved ? host.settingsCatalogs.display(directory, cli, saved) : undefined
    // After an account change the choices come from the account signed in now.
    let expected = catalog
      ? saved!
      : await host.readAccountBinding(cli, host.backend, host.options, directory, control)
    catalog ??= host.settingsCatalogs.display(directory, cli, expected)
    for (let attempt = 0; !catalog; attempt++) {
      let result
      try {
        result = await host.settingsCatalogs.get({
          cli,
          project: directory,
          signal: control,
          selfVerifiedDiscovery: cli === 'qoder' || cli === 'qodercn' || isWorkBuddyCli(cli),
          binding: async () => {
            const current = await host.readAccountBinding(cli, host.backend, host.options, directory, control)
            if (current !== expected) throw new Error(ACCOUNT_CHANGED)
            return current
          },
          discover: () => host.queryCatalog(cli, host.backend, host.options, directory, control, expected),
        })
      } catch (error) {
        // The account changed during this read: show the one signed in now, silently.
        if (attempt > 0 || !(error instanceof Error) || error.message !== ACCOUNT_CHANGED) throw error
        expected = await host.readAccountBinding(cli, host.backend, host.options, directory, control)
        catalog = host.settingsCatalogs.display(directory, cli, expected)
        continue
      }
      catalog = result.catalog
    }
    control.throwIfAborted()
    host.runtime.assertCliEnabled(cli)
    return JSON.stringify(catalog)
  } catch (error) {
    if (queriedCli && error instanceof ProcessCleanupUnconfirmedError)
      host.runtime.blockCatalogOnCleanup(queriedCli, error)
    throw failure(error)
  } finally {
    release?.()
  }
}

export async function refreshCatalogForCli(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  signal: AbortSignal,
): Promise<string> {
  return host.settingsCatalog(parentSessionId, cli, signal, true)
}

export async function settingsCatalog(
  this: ServiceContext,
  parentSessionId: string,
  cli: string,
  signal: AbortSignal,
  refresh: boolean,
): Promise<string> {
  let queriedCli: CliId | undefined
  let release: (() => void) | undefined
  try {
    const id = validate.enum(CLI_IDS).parse(cli)
    queriedCli = id
    const parent = await this.parent(parentSessionId)
    const control = AbortSignal.any([signal, this.disposed.signal])
    release = this.options?.cliMaintenance?.using(id)
    this.runtime.assertCliEnabled(id)
    const { catalog, binding } = await this.loadSettingsCatalog(id, control, refresh)
    control.throwIfAborted()
    ;(this.displayedBindings ??= new Map()).set(JSON.stringify([parentSessionId, id]), binding)
    this.runtime.assertCliEnabled(id)
    const receipt = this.connectionCache().status(id).catalog
    if (!receipt.value || !receipt.cache) throw new Error('CLI 来源已变化，请刷新重试')
    const project = this.preferenceProject(parent)
    return JSON.stringify({
      ...catalog,
      preference: project === undefined ? undefined : this.runtime.storage.preference(project, id),
      cache: receipt.cache,
    })
  } catch (error) {
    if (queriedCli && error instanceof ProcessCleanupUnconfirmedError)
      this.runtime.blockCatalogOnCleanup(queriedCli, error)
    throw failure(error)
  } finally {
    release?.()
  }
}

export async function configure(
  host: ServiceContext,
  parentSessionId: string,
  selection: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const agent = await host.parent(parentSessionId)
    let preference: Preference = preferenceSchema.parse(JSON.parse(selection))
    const project = host.project(agent)
    host.runtime.assertCliEnabled(cliOf(preference))
    const { catalog } = await host.authorizeChoice(
      preference,
      host.backend,
      host.options,
      project,
      signal,
      host.displayedBindings?.get(JSON.stringify([parentSessionId, cliOf(preference)])),
    )
    validatePreference(preference, catalog)
    preference = resolveModel(preference, catalog.models)
    signal.throwIfAborted()
    host.runtime.assertCliEnabled(cliOf(preference))
    host.runtime.storage.setPreference(project, preference)
    host.runtime.changed()
    return JSON.stringify(preference)
  } catch (error) {
    throw failure(error)
  }
}

export async function configureWorker(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  selection: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const agent = await host.parent(parentSessionId)
    const worker = host.runtime.get(agent.id, workerId)
    const preference = preferenceSchema.parse(JSON.parse(selection))
    if (cliOf(preference) !== cliOf(worker.preference)) throw new Error('已有会话不能切换 CLI')
    host.runtime.assertCliEnabled(cliOf(preference))
    host.settingsCatalogs ??= new SettingsCatalogCache(host.runtime.storage.directory)
    const directory = host.runtime.catalogDirectory(worker)
    const saved = host.runtime.storage.accountBinding(workerId)
    const catalog =
      (saved && host.settingsCatalogs.display(directory, cliOf(preference), saved)) ||
      host.settingsCatalogs.display(
        directory,
        cliOf(preference),
        await host.readAccountBinding(cliOf(preference), host.backend, host.options, directory, signal),
      )
    if (!catalog) throw new Error('模型目录已失效，请重试读取或在设置中刷新')
    validatePreference(preference, catalog)
    signal.throwIfAborted()
    host.runtime.assertCliEnabled(cliOf(preference))
    host.assertNativeWorkerSettingsIdle(worker)
    return JSON.stringify(
      host.runtime.configureWorker(agent.id, workerId, resolveModel(preference, catalog.models)),
    )
  } catch (error) {
    throw failure(error)
  }
}
