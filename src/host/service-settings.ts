import { z as validate } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
import type { SettingsCacheMetadata } from '../shared/settings-cache.ts'
import { CLI_IDS, type CliId } from '../shared/types.ts'
import { machineDirectory } from './process.ts'
import { failure } from './service-errors.ts'
import type { ServiceContext } from './index.ts'

export async function cliSettings(
  host: ServiceContext,
  parentSessionId: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const parent = await host.parent(parentSessionId)
    signal.throwIfAborted()
    const settings = host.runtime.storage.cliSettings()
    // Reusing this machine's display list in another parent still pins
    // configure() to the original verified account; no CLI query is needed.
    for (const cli of CLI_IDS) {
      const binding =
        host.connectionCache().fresh(cli, 'catalog')?.binding ??
        host.settingsCatalogs?.displayBinding(host.machineDirectory(), cli)
      const key = JSON.stringify([parentSessionId, cli])
      if (binding) (host.displayedBindings ??= new Map()).set(key, binding)
    }
    return JSON.stringify({
      ...settings,
      settingsCache: host.settingsDisplayMetadata(host.preferenceProject(parent)),
    })
  } catch (error) {
    throw failure(error)
  }
}

/** `project` only scopes the saved model preferences; connections and model lists are machine-wide. */
export function settingsDisplayMetadata(
  this: ServiceContext,
  project: string | undefined,
): SettingsCacheMetadata {
  this.settingsInstance ??= randomUUID()
  return {
    policy: 1,
    connections: this.connectionCache().snapshot(),
    host: this.settingsInstance,
    project: project === undefined ? 'no-project' : createHash('sha256').update(project).digest('hex'),
    revisions: Object.fromEntries(
      CLI_IDS.map((cli) => [
        cli,
        `${this.settingsSourceRevisions?.get(cli) ?? 0}:${this.options.cliExecutablePaths?.revision(cli) ?? 0}`,
      ]),
    ) as Record<CliId, string>,
    catalogReady: Object.fromEntries(
      CLI_IDS.map((cli) => [
        cli,
        !!this.connectionCache().fresh(cli, 'catalog') ||
          !!this.settingsCatalogs?.displayBinding(this.machineDirectory(), cli),
      ]),
    ) as Record<CliId, boolean>,
    preferences: Object.fromEntries(
      CLI_IDS.flatMap((cli) => {
        const preference = project === undefined ? undefined : this.runtime.storage.preference(project, cli)
        return preference ? [[cli, preference]] : []
      }),
    ),
  }
}

export function invalidateSettingsDisplay(this: ServiceContext, cli: CliId) {
  if (cli !== 'harness') this.connections?.invalidate(cli)
  this.settingsCatalogs?.invalidate(cli)
  const revisions = (this.settingsSourceRevisions ??= new Map())
  revisions.set(cli, (revisions.get(cli) ?? 0) + 1)
  // Disk-cache failure must not preserve an in-memory account/catalog from before the mutation.
  if (cli !== 'harness') this.cliManagement?.cache.invalidateAccount(cli)
}

export async function generalSettings(
  host: ServiceContext,
  parentSessionId: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const parent = await host.parent(parentSessionId)
    signal.throwIfAborted()
    return JSON.stringify(host.runtime.generalSettings())
  } catch (error) {
    throw failure(error)
  }
}

export async function saveGeneralSettings(
  host: ServiceContext,
  parentSessionId: string,
  patch: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    return JSON.stringify(
      host.runtime.setGeneralSettings(JSON.parse(validate.string().max(4096).parse(patch))),
    )
  } catch (error) {
    throw failure(error)
  }
}

export async function setCliEnabled(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  enabled: boolean,
  signal: AbortSignal,
): Promise<string> {
  try {
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    const id = validate.enum(CLI_IDS).parse(cli)
    const next = validate.boolean().parse(enabled)
    // The check, persistence, and account startup reservation are synchronous;
    // a pending managed terminal cannot be disabled during its async startup.
    if (!next && host.accounts.isBusy(id)) throw new Error('此 CLI 正在管理账号，请先关闭账号终端再关闭 CLI')
    signal.throwIfAborted()
    const settings = host.runtime.setCliEnabled(id, next)
    host.invalidateSettingsDisplay(id)
    return JSON.stringify(settings)
  } catch (error) {
    throw failure(error)
  }
}
