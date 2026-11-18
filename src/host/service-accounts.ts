import { CustomProviders, type CustomProviderSource } from './custom-provider.ts'
import { z as validate } from 'zod'
import type { AccountResponse, AccountStatus } from '../shared/accounts.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CLI_IDS, type CliId } from '../shared/types.ts'
import { ProcessCleanupUnconfirmedError } from './process.ts'
import { explicitCredentialRead } from './os-credential-store.ts'
import { failure } from './service-errors.ts'
import type { ServiceContext } from './service-context.ts'

export async function accountStatus(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  signal: AbortSignal,
): Promise<string> {
  return explicitCredentialRead(() => host.readAccountStatus(parentSessionId, cli, signal, false))
}

export async function refreshAccountStatus(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  signal: AbortSignal,
): Promise<string> {
  return explicitCredentialRead(() => host.readAccountStatus(parentSessionId, cli, signal, true))
}

export async function readAccountStatus(
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
    await this.parent(parentSessionId)
    signal.throwIfAborted()
    const held = () => this.cleanupHeldStatus(id)
    const before = held()
    if (before) return JSON.stringify(before)
    release = this.options?.cliMaintenance?.using(id)
    this.runtime.assertCliEnabled(id)
    if (!refresh && this.connectionCache().fresh(id, 'account')) {
      const receipt = this.connectionCache().status(id).account
      return JSON.stringify({ ...receipt.value, cache: receipt.cache })
    }
    const status = await this.loadSettingsAccount(id, signal, refresh)
    signal.throwIfAborted()
    const after = held()
    if (after) return JSON.stringify(after)
    this.runtime.assertCliEnabled(id)
    const receipt = this.connectionCache().status(id).account
    if (!receipt.value || !receipt.cache) throw new Error('CLI 来源已变化，请刷新重试')
    return JSON.stringify({ ...status, cache: receipt.cache })
  } catch (error) {
    if (queriedCli) this.runtime.assertCliEnabled(queriedCli)
    if (queriedCli && error instanceof ProcessCleanupUnconfirmedError)
      this.runtime.blockCatalogOnCleanup(queriedCli, error)
    throw failure(error)
  } finally {
    release?.()
  }
}

/** A CLI paused by its own unconfirmed cleanup reports that state instead of failing the read. */
export function cleanupHeldStatus(this: ServiceContext, cli: CliId): AccountStatus | undefined {
  const message = this.runtime.catalogCleanupMessage(cli)
  if (!message) return undefined
  // Shutdown and the unattributed global quarantine are not this CLI's to release.
  this.runtime.assertHostOpen()
  return { cli, installed: true, state: 'unavailable', summary: message, cleanupBlocked: true, actions: [] }
}

export async function recoverCliCleanup(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const id = validate.enum(CLI_IDS).parse(cli)
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    // Both checks precede either release, so a refusal leaves the CLI paused as it was.
    host.accounts.assertCleanupRecoverable(id)
    host.runtime.recoverCatalogCleanup(id)
    host.accounts.recoverCleanup(id)
    host.cliManagement?.recoverCleanup(id)
    host.invalidateSettingsDisplay(id)
    return JSON.stringify({ cli: id, recovered: true })
  } catch (error) {
    throw failure(error)
  }
}

export async function accountDesktopStart(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const id = validate.enum(['workbuddycn', 'workbuddy']).parse(cli)
    const parent = await host.parent(parentSessionId)
    const authorize = () => {
      host.disposed.signal.throwIfAborted()
      host.assertExecution(parent)
      host.runtime.assertCliEnabled(id)
      host.runtime.assertAccountIdle(id)
    }
    authorize()
    if (!host.accountParents.has(parent.id)) {
      const dispose = parent.ctx.effect(
        () => () => {
          host.accountParents.delete(parent.id)
          return host.accounts.closeParent(parent.id)
        },
        'cliworker:account-parent',
      )
      host.accountParents.set(parent.id, dispose)
    }
    return JSON.stringify(
      await host.accounts.desktop.start(
        parent.id,
        id,
        host.machineDirectory(),
        AbortSignal.any([signal, host.disposed.signal]),
        authorize,
      ),
    )
  } catch (error) {
    throw failure(error)
  }
}

export async function accountDesktopRespond(
  host: ServiceContext,
  parentSessionId: string,
  accountId: string,
  action: string,
): Promise<boolean> {
  try {
    await host.parent(parentSessionId)
    await host.accounts.desktop.respond(parentSessionId, accountId, action)
    return true
  } catch (error) {
    throw failure(error)
  }
}

export async function* accountDesktopWatch(
  host: ServiceContext,
  parentSessionId: string,
  accountId: string,
  signal: AbortSignal,
): AsyncIterable<string> {
  try {
    await host.parent(parentSessionId)
    for await (const frame of host.accounts.desktop.watch(parentSessionId, accountId, signal))
      yield JSON.stringify(frame)
  } catch (error) {
    throw failure(error)
  }
}

export async function accountDesktopStop(
  host: ServiceContext,
  parentSessionId: string,
  accountId: string,
): Promise<boolean> {
  try {
    await host.accounts.desktop.stop(parentSessionId, accountId)
    return true
  } catch (error) {
    throw failure(error)
  }
}

export async function accountStart(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  action: string,
  signal: AbortSignal,
): Promise<string> {
  return host.startAccount(parentSessionId, cli, action, signal)
}

export async function accountStartForSource(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  action: string,
  source: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const selected = validate.enum(['native', 'plugin']).parse(source)
    return host.startAccount(parentSessionId, cli, action, signal, selected)
  } catch (error) {
    throw failure(error)
  }
}

export async function accountStartForProvider(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  action: string,
  provider: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const selected = validate.enum(['bigmodel', 'zai']).parse(provider)
    if (cli !== 'zcode' || action !== 'login') throw new Error('不支持的 ZCode 授权来源')
    return host.startAccount(parentSessionId, cli, action, signal, undefined, selected)
  } catch (error) {
    throw failure(error)
  }
}

export async function accountStartWith(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  action: string,
  options: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const parsed: unknown = JSON.parse(
      typeof options === 'string' && options.length <= 1024 ? options : 'null',
    )
    const value =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined
    const name = (key: string) => {
      const item = value?.[key]
      if (item === undefined) return undefined
      if (typeof item !== 'string' || !item || item.length > 160) throw new Error('无效的账号操作')
      return item
    }
    if (!value || Object.keys(value).some((key) => key !== 'provider' && key !== 'login'))
      throw new Error('无效的账号操作')
    return host.startAccount(parentSessionId, cli, action, signal, undefined, name('provider'), name('login'))
  } catch (error) {
    throw failure(error)
  }
}

export function trackAccountParent(this: ServiceContext, parent: Agent) {
  if (this.accountParents.has(parent.id)) return
  const dispose = parent.ctx.effect(
    () => () => {
      this.accountParents.delete(parent.id)
      this.customProviders?.closeParent(parent.id)
      return this.accounts.closeParent(parent.id)
    },
    'cliworker:account-parent',
  )
  this.accountParents.set(parent.id, dispose)
}

export function customProviderSource(this: ServiceContext, parent: string, cli: CliId): CustomProviderSource {
  return {
    parent,
    cli,
    entry: this.options.cliExecutablePaths?.read(cli),
    revision: this.options.cliExecutablePaths?.revision(cli) ?? 0,
  }
}

export function customProviderManager(this: ServiceContext) {
  return (this.customProviders ??= new CustomProviders({
    stateDirectory: this.options.stateDirectory,
    hermesHome: this.options.hermesHome,
    zcodeAuthDirectory: this.options.zcodeAuthDirectory,
    zcodeBuiltinConfig: this.options.zcodeBuiltinConfig,
  }))
}

export async function customProviderForm(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  signal: AbortSignal,
): Promise<string> {
  let release: (() => void) | undefined, releaseAccount: (() => void) | undefined
  try {
    const id = validate.enum(CLI_IDS).parse(cli)
    const parent = await host.parent(parentSessionId)
    const control = AbortSignal.any([signal, host.disposed.signal])
    control.throwIfAborted()
    release = host.options.cliMaintenance?.using(id)
    host.runtime.assertCliEnabled(id)
    // Reading the form writes nothing, so it must not contend with the status read the account
    // window starts at the same moment; only saving takes the account reservation.
    host.trackAccountParent(parent)
    // Unsupported CLIs must not touch their entry stores (notably retired Harness).
    if (!['pi', 'opencode', 'hermes', 'zcode'].includes(id)) return 'null'
    return JSON.stringify(host.customProviderManager().form(host.customProviderSource(parent.id, id)))
  } catch (error) {
    throw failure(error)
  } finally {
    releaseAccount?.()
    release?.()
  }
}

export async function saveCustomProvider(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  token: string,
  valuesJson: string,
  signal: AbortSignal,
): Promise<string> {
  let release: (() => void) | undefined, releaseAccount: (() => void) | undefined
  try {
    const id = validate.enum(CLI_IDS).parse(cli)
    const parent = await host.parent(parentSessionId)
    const control = AbortSignal.any([signal, host.disposed.signal])
    control.throwIfAborted()
    host.assertExecution(parent)
    release = host.options.cliMaintenance?.using(id)
    host.runtime.assertCliEnabled(id)
    host.runtime.assertAccountIdle(id)
    // The account window refreshes status when it opens; wait for that read instead of refusing the save.
    await host.accounts.settleQueries(id, AbortSignal.any([control, AbortSignal.timeout(30_000)]))
    releaseAccount = host.accounts.reserveCustomProvider(id)
    host.trackAccountParent(parent)
    if (!['pi', 'opencode', 'hermes', 'zcode'].includes(id))
      return JSON.stringify({ ok: false, issues: [{ message: '请使用此 CLI 的原生终端配置' }] })
    const source = host.customProviderSource(parent.id, id)
    const result = host.customProviderManager().save(source, token, valuesJson, () => {
      control.throwIfAborted()
      host.runtime.assertCliEnabled(id)
      host.runtime.assertAccountIdle(id)
      if (JSON.stringify(host.customProviderSource(parent.id, id)) !== JSON.stringify(source))
        throw new Error('CLI 入口已变化')
    })
    if (result.ok) {
      try {
        host.invalidateSettingsDisplay(id)
      } catch {
        result.notice = '原生配置已保存；显示缓存持久化失败，请刷新账号与模型目录'
      }
    }
    return JSON.stringify(result)
  } catch (error) {
    throw failure(error)
  } finally {
    releaseAccount?.()
    release?.()
  }
}

export async function deleteAccountConfiguration(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  login: string,
  signal: AbortSignal,
): Promise<string> {
  let release: (() => void) | undefined
  try {
    const id = validate.enum(['pi', 'omp', 'zcode']).parse(cli)
    const selected = validate.string().min(1).max(512).parse(login)
    const parent = await host.parent(parentSessionId)
    const control = AbortSignal.any([signal, host.disposed.signal])
    control.throwIfAborted()
    host.assertExecution(parent)
    release = host.options.cliMaintenance?.using(id)
    host.runtime.assertCliEnabled(id)
    host.runtime.assertAccountIdle(id)
    host.trackAccountParent(parent)
    // Invalidate readers before waiting for their process cleanup under the account lease.
    host.invalidateSettingsDisplay(id)
    try {
      const result = await host.accounts.deleteConfiguration(parent.id, id, selected, control, async () => {
        await host.connections?.settle(id)
        control.throwIfAborted()
        host.runtime.assertCliEnabled(id)
        host.runtime.assertAccountIdle(id)
      })
      try {
        host.invalidateSettingsDisplay(id)
      } catch {
        result.notice = '配置已删除；显示缓存持久化失败，请刷新账号与模型目录'
      }
      return JSON.stringify(result)
    } catch (error) {
      // A conflict can leave a partial transaction/external edit. Never retain an old snapshot.
      try {
        host.invalidateSettingsDisplay(id)
      } catch {
        /* In-memory invalidation runs first. */
      }
      throw error
    }
  } catch (error) {
    throw failure(error)
  } finally {
    release?.()
  }
}

export async function startAccount(
  this: ServiceContext,
  parentSessionId: string,
  cli: string,
  action: string,
  signal: AbortSignal,
  source?: 'native' | 'plugin',
  provider?: string,
  login?: string,
): Promise<string> {
  try {
    const id = validate.enum(CLI_IDS).parse(cli)
    const operation = validate.enum(['login', 'logout', 'manage']).parse(action)
    const parent = await this.parent(parentSessionId)
    this.assertExecution(parent)
    this.runtime.assertCliEnabled(id)
    this.runtime.assertAccountIdle(id)
    this.trackAccountParent(parent)
    this.invalidateSettingsDisplay(id)
    return JSON.stringify(
      await this.accounts.start(
        parent.id,
        id,
        operation,
        this.machineDirectory(),
        signal,
        source,
        provider,
        login,
        async () => {
          // AccountManager has synchronously reserved the CLI. Invalidation
          // cancels reads but their process ranges can still be cleaning up.
          await this.connections?.settle(id)
          this.runtime.assertAccountIdle(id)
        },
      ),
    )
  } catch (error) {
    throw failure(error)
  }
}

export async function* accountWatch(
  host: ServiceContext,
  parentSessionId: string,
  accountId: string,
  signal: AbortSignal,
): AsyncIterable<string> {
  try {
    await host.parent(parentSessionId)
    for await (const frame of host.accounts.watch(parentSessionId, accountId, signal))
      yield JSON.stringify(frame)
  } catch (error) {
    throw failure(error)
  }
}

export async function accountWrite(
  host: ServiceContext,
  parentSessionId: string,
  accountId: string,
  data: string,
): Promise<boolean> {
  try {
    host.assertExecution(await host.parent(parentSessionId))
    await host.accounts.write(parentSessionId, accountId, data)
    return true
  } catch (error) {
    throw failure(error)
  }
}

export async function accountRespond(
  host: ServiceContext,
  parentSessionId: string,
  accountId: string,
  response: string,
): Promise<boolean> {
  try {
    host.assertExecution(await host.parent(parentSessionId))
    const parsed: unknown = JSON.parse(
      typeof response === 'string' && response.length <= 8192 ? response : 'null',
    )
    const value = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    const keys = Object.keys(value)
    const text = (name: 'option' | 'code' | 'secret') => keys.length === 1 && typeof value[name] === 'string'
    let answer: AccountResponse
    if (text('option')) answer = { option: value.option as string }
    else if (text('code')) answer = { code: value.code as string }
    else if (text('secret')) answer = { secret: value.secret as string }
    else if (keys.length === 1 && (value.confirm === 'trust' || value.confirm === 'decline'))
      answer = { confirm: value.confirm }
    else if (keys.length === 2 && value.agree === 'terms' && typeof value.share === 'boolean')
      answer = { agree: 'terms', share: value.share }
    else throw new Error('无效的账号窗口操作')
    await host.accounts.respond(parentSessionId, accountId, answer)
    return true
  } catch (error) {
    throw failure(error)
  }
}

export async function accountResize(
  host: ServiceContext,
  parentSessionId: string,
  accountId: string,
  cols: number,
  rows: number,
): Promise<boolean> {
  try {
    await host.parent(parentSessionId)
    await host.accounts.resize(parentSessionId, accountId, cols, rows)
    return true
  } catch (error) {
    throw failure(error)
  }
}

export async function accountStop(
  host: ServiceContext,
  parentSessionId: string,
  accountId: string,
): Promise<boolean> {
  try {
    await host.accounts.stop(parentSessionId, accountId)
    return true
  } catch (error) {
    throw failure(error)
  }
}
