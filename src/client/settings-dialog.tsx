import { isWorkBuddy, WORKBUDDY_EXPERIMENTAL_NOTICE } from '../shared/workbuddy.ts'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  Modal,
  StateDot,
  Switch,
  Tooltip,
  IconChevronDownOutlineRegular,
  IconDownloadOutlineRegular,
  IconLinkOutlineRegular,
  IconRefreshOutlineRegular,
  IconSettingsOutlineRegular,
  IconUserOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  CLI_IDS,
  CLI_LABELS,
  isRetiredCli,
  type CliId,
  type Preference,
} from '../shared/types.ts'
import type { AccountAction, AccountSource, AccountStatus } from '../shared/accounts.ts'
import { modelName } from '../shared/models.ts'
import { visibleModelChoices } from '../shared/model-presentation.ts'
import { WorkBuddyDesktopWindow } from './account-login/workbuddy-desktop-window.tsx'
import { AccountTerminal, type AccountCloseControl } from './account-terminal.tsx'
import { AccountsWindow } from './account-login/accounts-window.tsx'
import { MULTI_ACCOUNT_CLIS } from '../shared/account-links.ts'
import { BrandIcon, Glyph } from './icons.tsx'
import { operationMessage } from './operation-error.ts'
import { value, type API } from './workers.ts'
import { RolePresetsPane } from './role-presets.tsx'
import { GeneralSettingsPane } from './general-settings.tsx'
import { useCliUpdateData } from './cli-update-data.ts'
import { navIndicator } from './cli-update-layout.ts'
import { CliUpdatePane } from './cli-update-page.tsx'
import { useScrollingMark } from './scrolling-mark.ts'
import { AccountQueryQueue } from './account-query-queue.ts'
import { CliExecutableSettings } from './cli-executable-settings.tsx'
import { NativeChoice } from './native-settings-choice.tsx'
import { preferenceReadVersion, SettingsPreferenceSaves } from './settings-preference-saves.ts'
import { settingsCacheMetadata, settingsDisplayPool, type SettingsDisplayCache,
  type SettingsCatalog as Catalog, type SettingsAccountEntry as AccountEntry, type SettingsCatalogEntry,
} from './settings-display-cache.ts'
import { effortLabel, t, useT } from './i18n.ts'
import { hostText } from './operation-error.ts'
import type { SettingsCacheMetadata } from '../shared/settings-cache.ts'
import type { ConnectionCacheInfo } from '../shared/settings-connection.ts'
import {
  accountEntryFromPart, actionsKnown, catalogEntryFromPart, CONNECTION_FRESH_MS, ConnectionReceipts, connectionState,
  freshReceipt, nextExpiry, parseConnectionStatus, slotNeed, type ConnectionChange,
} from './settings-connection-view.ts'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  api: API
  sessionId: string
  /** The CLI page to open; without one the dialog opens on 「CLI Worker 设置」. */
  initialCli?: CliId
  openNativeSettings?: () => void
}
type Enabled = Record<CliId, boolean>
function readEnabled(raw: string): Enabled {
  const parsed = JSON.parse(raw)
  if (!parsed?.enabled || CLI_IDS.some((id) => typeof parsed.enabled[id] !== 'boolean')) {
    throw new Error(t('CLI 开关状态不完整，请重新打开设置'))
  }
  return parsed.enabled
}
function providerLoginSummary(account: AccountStatus): { label: string; detail: string } | undefined {
  if (!Array.isArray(account.logins)) return undefined
  const unsafe = /\p{C}|[<>]|\b(?:Bearer|sk-|sk_|ghp_|ya29\.)/iu
  const logins = account.logins.flatMap((login) => {
    if (!login || !['oauth', 'api'].includes(login.authMethod)) return []
    const provider = typeof login.providerLabel === 'string' ? login.providerLabel.trim() : ''
    if (!provider || provider.length > 64 || unsafe.test(provider)) return []
    const identity =
      login.authMethod === 'oauth' && typeof login.accountLabel === 'string' ? login.accountLabel.trim() : ''
    const email =
      identity.length <= 254 && !unsafe.test(identity) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(identity)
        ? identity
        : ''
    return [
      {
        label: login.authMethod === 'api' ? t('{provider} API 登录', { provider }) : t('{provider}账号登录', { provider }),
        authMethod: login.authMethod,
        email,
      },
    ]
  })
  if (!logins.length) return undefined
  const oauth = logins.filter((login) => login.authMethod === 'oauth')
  const visible = oauth.length ? oauth : logins
  const detail = [...new Set(logins.map(({ label, email }) => (email ? `${label} ${email}` : label)))].join(
    ' · ',
  )
  return {
    label: [...new Set(visible.map(({ label }) => label))].join(' · '),
    detail,
  }
}
function authenticatedLabel(account: AccountStatus): string {
  if (isWorkBuddy(account.cli) && /^已登录（(?:www\.)?workbuddy\.(?:cn|ai)）$/u.test(account.summary)) return hostText(account.summary)
  return providerLoginSummary(account)?.label ?? (account.authMethod === 'api' ? t('API 登录') : t('已登录'))
}
function connectionStatus(enabled: boolean | undefined, account?: AccountEntry, settingsError = '', now = Date.now()) {
  const state = connectionState(enabled, account, settingsError, now)
  const data = account?.data
  switch (state) {
    case 'disabled':
      return { state, label: t('已关闭') }
    case 'pending':
      return { state, label: t('正在检查连接') }
    case 'failed':
      return {
        state,
        label: settingsError
          ? t('CLI 开关配置读取失败，请重新打开设置')
          : hostText(account?.error || data?.summary) || t('连接失败'),
      }
    case 'unconfigured':
      return { state, label: data!.installed ? (data!.cli === 'claude' ? hostText(data!.summary) : t('未登录')) : t('未安装') }
    case 'connected':
      return { state, label: data!.state === 'configured' ? hostText(data!.summary)?.trim() || t('已配置') : authenticatedLabel(data!) }
    case 'unverified':
      return {
        state,
        label: data!.state === 'authenticated' ? authenticatedLabel(data!) : hostText(data!.summary)?.trim() || t('已配置'),
      }
    // A sign-in receipt past its ten minutes is neutral until the Host has checked it again.
    case 'expired':
      return { state: 'unknown', label: t('登录状态已过期，等待重新核实') }
    default:
      return { state, label: hostText(data?.summary) || t('状态待确认') }
  }
}
/** The connection snapshot this dialog may reuse: this machine's CLIs, from the same response (Host instance) as the rest of settingsCache. */
function connectionSnapshot(api: API, metadata: SettingsCacheMetadata | undefined) {
  const connections = metadata?.connections
  if (!connections || !api.cliworker.settingsConnectionStatus || !api.cliworker.watchSettingsConnections) return
  return connections
}
const without = <T,>(entries: Partial<Record<CliId, T>>, id: CliId) => {
  if (!(id in entries)) return entries
  const next = { ...entries }
  delete next[id]
  return next
}

/** Native modal owns focus, dismissal, theme, elevation and entrance animation. */
export function SettingsDialog(props: SettingsDialogProps) {
  const fallbackSaves = useMemo(() => new SettingsPreferenceSaves(), [props.api, props.sessionId])
  // Discovery and terminals unmount on close. Explicit preference writes finish in the background.
  return props.open ? <OpenSettingsDialog {...props} fallbackSaves={fallbackSaves} /> : null
}
function OpenSettingsDialog({
  onClose,
  api,
  sessionId,
  initialCli,
  openNativeSettings,
  fallbackSaves,
}: SettingsDialogProps & { fallbackSaves: SettingsPreferenceSaves }) {
  useT()
  const scrolling = useScrollingMark()
  const [cli, setCli] = useState<CliId>(
    !initialCli ? 'antigravity' : isRetiredCli(initialCli) ? 'hermes' : initialCli,
  )
  const [page, setPage] = useState<'cli' | 'roles' | 'general' | 'update'>(initialCli ? 'cli' : 'general')
  const openCli = useRef<CliId>()
  openCli.current = page === 'cli' ? cli : undefined
  // One subscription per open dialog: the navigation badge and the page share it. The page itself
  // asks for checkCliUpdates('missing') when it mounts; opening the dialog only reads the cache.
  const updates = useCliUpdateData(api, sessionId)
  const indicator = navIndicator(updates.snapshot)
  const [cliExpanded, setCliExpanded] = useState(true)
  const cliGroupId = useId()
  const [enabled, setEnabled] = useState<Enabled>()
  const [order, setOrder] = useState<readonly CliId[]>(CLI_IDS)
  const [settingsError, setSettingsError] = useState('')
  const [togglingCli, setTogglingCli] = useState<CliId>()
  const [toggleErrors, setToggleErrors] = useState<Partial<Record<CliId, string>>>({})
  const [accounts, setAccounts] = useState<Partial<Record<CliId, AccountEntry>>>({})
  const [catalogEntries, setCatalogEntries] = useState<Partial<Record<CliId, SettingsCatalogEntry>>>({})
  const [warmCatalogs, setWarmCatalogs] = useState(false)
  const [preferenceSaves, setPreferenceSaves] = useState(fallbackSaves)
  const displayCache = useRef<SettingsDisplayCache>()
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const probes = useRef(new AccountQueryQueue<CliId>())
  const toggleController = useRef<AbortController>()
  const accountClose = useRef<() => Promise<boolean>>()
  const leaving = useRef(false)
  // Host connection snapshot (settingsCache.connections): receipts order its watch, status answers and
  // direct reads. `live` while the watch subscription of this open dialog is running.
  const receipts = useRef<ConnectionReceipts>()
  const connectionsSupported = useRef(false)
  const [live, setLive] = useState(false)
  const preferences = useRef<Partial<Record<CliId, Preference>>>({})
  const statusRequests = useRef(new Set<AbortController>())
  const requested = useRef(new Set<string>())
  const openedStatus = useRef<CliId>()
  // Re-renders when a receipt reaches its ten minutes, so no dot stays green past it.
  const [expiryTick, tick] = useState(0)
  const leave = async (transition: () => void) => {
    if (leaving.current) return
    leaving.current = true
    try {
      if (accountClose.current && !(await accountClose.current())) return
      transition()
    } finally {
      leaving.current = false
    }
  }

  /** A direct read is shown only when it is not older than the revision on screen. */
  const admitRead = useCallback((id: CliId, cache: ConnectionCacheInfo | undefined, slot: 'account' | 'catalog') => {
    const current = receipts.current
    if (!current) return true
    const verdict = current.read(id, cache)
    if (verdict === 'drop') return false
    if (verdict === 'newer') {
      // The Host invalidated after the last snapshot: the other slot and drafts belong to the old scope.
      ;(displayCache.current?.preferenceSaves ?? fallbackSaves).invalidate(id)
      if (slot === 'account') setCatalogEntries(old => without(old, id))
      else setAccounts(old => without(old, id))
    }
    return true
  }, [fallbackSaves])
  const applyConnection = useCallback((change: ConnectionChange) => {
    const id = change.cli
    if (!enabledRef.current?.[id]) return
    if (change.revisionChanged) {
      probes.current.cancel(id)
      displayCache.current?.invalidate(id)
      if (!displayCache.current) fallbackSaves.invalidate(id)
    }
    const { account, catalog } = change.parts
    if (change.revisionChanged || account)
      setAccounts(old => {
        const entry = account && accountEntryFromPart(account)
        return entry ? { ...old, [id]: entry } : without(old, id)
      })
    if (change.revisionChanged || catalog)
      setCatalogEntries(old => {
        const entry = catalog && catalogEntryFromPart(catalog, preferences.current[id])
        return entry ? { ...old, [id]: entry } : without(old, id)
      })
  }, [fallbackSaves])

  const readCatalog = useCallback(async (id: CliId, signal: AbortSignal, force = false,
    cache = displayCache.current, version = cache?.version(id)) => {
    try {
      if (cache && cache.version(id) !== version) throw new Error(t('设置来源已变化，请刷新状态'))
      const next: Catalog = JSON.parse(value(await (force
        ? api.cliworker.refreshCatalogForCli(sessionId, id, signal)
        : api.cliworker.catalogForCli(sessionId, id, signal))))
      if (next.cli !== id || !Array.isArray(next.models)) throw new Error(t('收到不匹配的 CLI 模型目录，请重试'))
      if (signal.aborted) return
      if (cache && cache.version(id) !== version) throw new Error(t('设置来源已变化，请刷新状态'))
      if (!admitRead(id, next.cache, 'catalog')) throw new Error(t('设置来源已变化，请刷新状态'))
      const entry = { data: next, loading: false }
      cache?.catalog(id, entry, version)
      setCatalogEntries(old => ({ ...old, [id]: entry }))
    } catch (error) {
      if (signal.aborted) return
      const entry = { loading: false, error: operationMessage(error) }
      cache?.catalog(id, entry, version)
      setCatalogEntries(old => ({ ...old, [id]: entry }))
    }
  }, [api, sessionId, admitRead])
  const refreshCatalog = useCallback((id: CliId, force = false) => {
    if (!enabledRef.current?.[id]) return
    if (force) (displayCache.current?.preferenceSaves ?? fallbackSaves).invalidate(id)
    if (probes.current.enqueue(id, signal => readCatalog(id, signal, force), force))
      setCatalogEntries(old => ({ ...old, [id]: { loading: true } }))
  }, [readCatalog, fallbackSaves])
  const refreshAccount = useCallback(
    (id: CliId, replace = false, clearPrevious = false, force = false) => {
      if (!enabledRef.current?.[id]) return
      if (probes.current.has(id) && !replace) {
        // The page was opened while this CLI still has a read in flight (often its catalog after a
        // cached account summary): read the account fresh once that slot is free.
        if (force) probes.current.whenIdle(id, () => {
          if (!mounted.current || openCli.current !== id || actionsKnown(accountsLatest.current[id])) return
          refreshAccountLatest.current(id, false, false, true)
        })
        return
      }
      displayCache.current?.invalidate(id, replace || clearPrevious)
      if (!displayCache.current && (replace || clearPrevious)) fallbackSaves.invalidate(id)
      const cache = displayCache.current, version = cache?.version(id)
      setAccounts((old) => ({
        ...old,
        [id]: { data: clearPrevious ? undefined : old[id]?.data, loading: true },
      }))
      if (displayCache.current) setCatalogEntries(old => ({ ...old, [id]: { loading: true } }))
      probes.current.enqueue(
        id,
        async (signal) => {
          try {
            const fresh = api.cliworker.refreshAccountStatus
            const read = async (refresh: boolean) => {
              const next: AccountStatus = JSON.parse(value(await (refresh && fresh
                ? fresh(sessionId, id, signal)
                : api.cliworker.accountStatus(sessionId, id, signal))))
              if (next.cli !== id) throw new Error(t('收到不匹配的 CLI 账号状态，请重试'))
              if (cache && cache.version(id) !== version) throw new Error(t('账号来源已变化，请刷新状态'))
              if (!signal.aborted && !admitRead(id, next.cache, 'account')) throw new Error(t('账号来源已变化，请刷新状态'))
              return next
            }
            const first = replace || force
            let next = await read(first)
            let handles = (first && !!fresh) || next.cache === undefined
            // An older Host without connection snapshots may answer from its background cache: the
            // summary is shown at once, but login and sign-out handles only come with a fresh read.
            // With snapshots the handles are read right before an account operation instead.
            if (!handles && fresh && !connectionsSupported.current && !signal.aborted &&
              (next.cache?.stale || openCli.current === id)) {
              setAccounts((old) => ({ ...old, [id]: { data: next, loading: true } }))
              next = await read(true)
              handles = true
            }
            if (!signal.aborted) {
              const entry = { data: next, loading: false, handles }
              cache?.account(id, entry, version)
              setAccounts((old) => ({ ...old, [id]: entry }))
            }
          } catch (error) {
            if (!signal.aborted) {
              const entry = { loading: false, error: operationMessage(error) }
              cache?.account(id, entry, version)
              setAccounts((old) => ({ ...old, [id]: entry }))
            }
          }
          if (!signal.aborted && cache) await readCatalog(id, signal, replace, cache, version)
        },
        replace || force,
      )
    },
    [api, sessionId, readCatalog, fallbackSaves, admitRead],
  )
  const refreshAccountLatest = useRef(refreshAccount)
  refreshAccountLatest.current = refreshAccount
  const accountsLatest = useRef(accounts)
  accountsLatest.current = accounts
  const catalogsLatest = useRef(catalogEntries)
  catalogsLatest.current = catalogEntries

  /** Missing or expired slots of a CLI that is not on screen: the bounded queue, never a forced refresh. */
  const queueMissing = useCallback((id: CliId, account: boolean, catalog: boolean) => {
    if (!enabledRef.current?.[id] || (!account && !catalog)) return
    const queued = probes.current.enqueue(id, async (signal) => {
      if (account) {
        try {
          const next: AccountStatus = JSON.parse(value(await api.cliworker.accountStatus(sessionId, id, signal)))
          if (next.cli !== id) throw new Error(t('收到不匹配的 CLI 账号状态，请重试'))
          if (!signal.aborted && admitRead(id, next.cache, 'account'))
            setAccounts(old => ({ ...old, [id]: { data: next, loading: false, handles: next.cache === undefined } }))
        } catch (error) {
          if (!signal.aborted) setAccounts(old => ({ ...old, [id]: { loading: false, error: operationMessage(error) } }))
        }
      }
      if (catalog && !signal.aborted) await readCatalog(id, signal)
    })
    if (!queued) return
    if (account) setAccounts(old => ({ ...old, [id]: { data: old[id]?.data, loading: true } }))
    if (catalog) setCatalogEntries(old => ({ ...old, [id]: { data: old[id]?.data, loading: true } }))
  }, [api, sessionId, admitRead, readCatalog])
  /** The CLI on screen: the Host answers at once and starts only its missing or expired reads. */
  const requestStatus = useCallback(async (id: CliId) => {
    const read = api.cliworker.settingsConnectionStatus, current = receipts.current
    if (!read || !current || !enabledRef.current?.[id]) return
    const ticket = current.ticket, controller = new AbortController()
    statusRequests.current.add(controller)
    try {
      const raw: unknown = JSON.parse(value(await read(sessionId, id, controller.signal)))
      if (controller.signal.aborted || receipts.current !== current) return
      const answer = parseConnectionStatus(raw)
      const change = current.status(raw, ticket)
      if (change) applyConnection(change)
      if (!answer) return
      // A slot the Host neither has nor is reading still gets the bounded direct read. A loading
      // account also gets one: it joins the Host's running read, and an account paused after an
      // unconfirmed cleanup is reported only by a direct read, never by the snapshot.
      const idle = (part: { value?: unknown; loading: boolean; error?: string }) =>
        part.value === undefined && !part.loading && !part.error
      queueMissing(id, idle(answer.account) || answer.account.loading, !!change && idle(answer.catalog))
    } catch {
      // Without a quick answer this CLI still gets the bounded direct read.
      if (!controller.signal.aborted && receipts.current === current && mounted.current) {
        const now = Date.now()
        queueMissing(id, !!slotNeed(accountsLatest.current[id], now), !!slotNeed(catalogsLatest.current[id], now))
      }
    } finally {
      statusRequests.current.delete(controller)
    }
  }, [api, sessionId, applyConnection, queueMissing])
  /** Right before an account operation: current actions and login ids, never cached handles. */
  const prepareAccount = useCallback(async (id: CliId, signal: AbortSignal): Promise<AccountStatus | undefined> => {
    const fresh = api.cliworker.refreshAccountStatus
    const shown = accountsLatest.current[id]
    if (!fresh || (!connectionsSupported.current && actionsKnown(shown))) return shown?.data
    setAccounts(old => ({ ...old, [id]: { data: old[id]?.data, loading: true } }))
    try {
      const next: AccountStatus = JSON.parse(value(await fresh(sessionId, id, signal)))
      if (next.cli !== id) throw new Error(t('收到不匹配的 CLI 账号状态，请重试'))
      if (signal.aborted) return
      if (!admitRead(id, next.cache, 'account')) throw new Error(t('账号来源已变化，请刷新状态'))
      setAccounts(old => ({ ...old, [id]: { data: next, loading: false, handles: true } }))
      return next
    } catch (error) {
      if (!signal.aborted) setAccounts(old => ({ ...old, [id]: { loading: false, error: operationMessage(error) } }))
    }
  }, [api, sessionId, admitRead])

  useEffect(() => {
    const controller = new AbortController()
    const requests = statusRequests.current
    void (async () => {
      try {
        const readVersion = preferenceReadVersion()
        const raw = value(await api.cliworker.cliSettings(sessionId, controller.signal))
        const next = readEnabled(raw)
        const metadata = settingsCacheMetadata(JSON.parse(raw).settingsCache)
        if (controller.signal.aborted) return
        displayCache.current = metadata ? settingsDisplayPool(api).resolve(metadata, next, readVersion) : undefined
        const saves = displayCache.current?.preferenceSaves ?? fallbackSaves
        if (!metadata) for (const id of CLI_IDS) saves.sync(id, readVersion)
        setPreferenceSaves(saves)
        preferences.current = { ...metadata?.preferences }
        // The Host's connection snapshot is reused only for this Host; without it, or
        // without its status and watch methods, the dialog keeps the older per-CLI reads.
        const connections = connectionSnapshot(api, metadata)
        receipts.current = connections ? new ConnectionReceipts() : undefined
        connectionsSupported.current = !!receipts.current
        requested.current.clear()
        openedStatus.current = undefined
        const initial = receipts.current?.snapshot(connections)
        if (initial) {
          const accounts: Partial<Record<CliId, AccountEntry>> = {}
          const catalogs: Partial<Record<CliId, SettingsCatalogEntry>> = {}
          for (const change of initial) {
            if (!next[change.cli]) continue
            const account = change.parts.account && accountEntryFromPart(change.parts.account)
            const catalog = change.parts.catalog && catalogEntryFromPart(change.parts.catalog, preferences.current[change.cli])
            if (account) accounts[change.cli] = account
            if (catalog) catalogs[change.cli] = catalog
          }
          setAccounts(accounts)
          setCatalogEntries(catalogs)
        } else {
          receipts.current = undefined
          connectionsSupported.current = false
          setAccounts(displayCache.current?.accountSnapshot() ?? {})
          setCatalogEntries(displayCache.current?.catalogSnapshot() ?? {})
        }
        setWarmCatalogs(metadata !== undefined)
        enabledRef.current = next
        setEnabled(next)
        setLive(!!receipts.current)
        // Keep this ordering for the lifetime of the open dialog. A toggle does
        // not move the row under the pointer; reopening applies the saved order.
        setOrder([...CLI_IDS].sort((a, b) => Number(next[b]) - Number(next[a])))
      } catch (error) {
        if (!controller.signal.aborted) setSettingsError(operationMessage(error))
      }
    })()
    return () => {
      controller.abort()
      toggleController.current?.abort()
      probes.current.clear()
      for (const request of requests) request.abort()
      requests.clear()
      receipts.current = undefined
      setLive(false)
      // Another Host session: nothing of the old connection state stays on screen.
      setAccounts({})
      setCatalogEntries({})
    }
  }, [api, sessionId, fallbackSaves])
  // One watch per open dialog: the full machine snapshot first, then each finished, failed or
  // invalidated read. It ends on close; a failed watch falls back to the bounded direct reads.
  useEffect(() => {
    const watch = api.cliworker.watchSettingsConnections
    const current = receipts.current
    if (!live || !watch || !current) return
    const controller = new AbortController()
    const stream = api.$stream<string>({
      name: `CLI connections ${sessionId}`,
      open: (signal) => watch(sessionId, signal),
      ended: () => new Error(t('连接已结束')),
    })
    void (async () => {
      try {
        for await (const item of stream) {
          if (controller.signal.aborted || receipts.current !== current) return
          let raw: unknown
          try { raw = JSON.parse(item.value) } catch { raw = undefined }
          for (const change of current.snapshot(raw, item.generation) ?? []) applyConnection(change)
          item.accept()
        }
      } catch {
        // Reported below as a fallback, not as a CLI connection failure.
      }
      if (!controller.signal.aborted && receipts.current === current) setLive(false)
    })()
    return () => {
      controller.abort()
      void stream.dispose().catch(() => undefined)
    }
  }, [live, api, sessionId, applyConnection])
  const wasLive = useRef(false)
  useEffect(() => {
    if (live) {
      wasLive.current = true
      return
    }
    if (!wasLive.current || !receipts.current) return
    wasLive.current = false
    // The watch ended while the Host was still reading: finish those through the bounded queue.
    for (const id of CLI_IDS) {
      if (!enabledRef.current?.[id]) continue
      if (accountsLatest.current[id]?.loading) refreshAccount(id)
      else if (catalogsLatest.current[id]?.loading) refreshCatalog(id)
    }
  }, [live, refreshAccount, refreshCatalog])
  useEffect(() => {
    if (!enabled) return
    probes.current.prioritize(cli)
    for (const id of [cli, ...CLI_IDS.filter((id) => id !== cli)]) {
      if (enabled[id]) {
        if (live) continue
        if (!accounts[id]) refreshAccount(id)
        else if (warmCatalogs && !catalogEntries[id]) refreshCatalog(id)
      } else {
        probes.current.cancel(id)
        displayCache.current?.invalidate(id)
        if (!displayCache.current) fallbackSaves.invalidate(id)
        for (const key of [...requested.current]) if (key.startsWith(`${id}:`)) requested.current.delete(key)
        if (accounts[id]) setAccounts((old) => without(old, id))
        if (catalogEntries[id]) setCatalogEntries((old) => without(old, id))
      }
    }
    // A completed or failed probe is cached until explicitly refreshed. This
    // Selection only reprioritizes pending work; it does not repeat settled reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cli, refreshAccount, refreshCatalog, warmCatalogs, live])
  // With connection snapshots: the CLI on screen asks the Host's status method (on opening it and
  // whenever a slot is missing or its receipt expired); the other enabled CLIs use the bounded
  // queue for missing or expired slots only. Each request is made once per receipt.
  useEffect(() => {
    if (!live || !enabled) return
    const now = Date.now()
    const current = page === 'cli' && enabled[cli] ? cli : undefined
    let opened = false
    if (current && openedStatus.current !== current) {
      openedStatus.current = current
      opened = true
    } else if (!current) openedStatus.current = undefined
    for (const id of [cli, ...CLI_IDS.filter((id) => id !== cli)]) {
      if (!enabled[id]) continue
      const scope = `${id}:${receipts.current?.revision(id) ?? 0}`
      const due = (slot: string, need: string | undefined) => {
        if (!need) return false
        const key = `${scope}:${slot}:${need}`
        if (requested.current.has(key)) return false
        requested.current.add(key)
        return true
      }
      const account = due('account', slotNeed(accounts[id], now))
      const catalog = due('catalog', slotNeed(catalogEntries[id], now))
      if (id === current) {
        if (opened || account || catalog) void requestStatus(id)
      } else queueMissing(id, account, catalog)
    }
  }, [live, enabled, cli, page, accounts, catalogEntries, expiryTick, requestStatus, queueMissing])
  useEffect(() => {
    const now = Date.now()
    const deadline = nextExpiry(
      [...Object.values(accounts), ...Object.values(catalogEntries)].map(entry => entry?.data?.cache),
      now,
    )
    if (deadline === undefined) return
    const timer = setTimeout(() => tick(n => n + 1), Math.min(CONNECTION_FRESH_MS, deadline - now) + 1)
    return () => clearTimeout(timer)
  }, [accounts, catalogEntries, expiryTick])

  const openAccount = page === 'cli' ? accounts[cli] : undefined
  useEffect(() => {
    // Only Hosts without connection snapshots: their cached summary has no handles.
    if (connectionsSupported.current) return
    if (page !== 'cli' || !openAccount || openAccount.loading || actionsKnown(openAccount)) return
    if (!api.cliworker.refreshAccountStatus) return
    refreshAccount(cli, false, false, true)
  }, [page, cli, openAccount, api, refreshAccount])
  const freshBeforeAction = !!api.cliworker.refreshAccountStatus &&
    (connectionsSupported.current || !actionsKnown(accounts[cli]))

  async function toggleCli(id: CliId, nextValue: boolean) {
    if (!enabled || toggleController.current) return
    const controller = new AbortController()
    toggleController.current = controller
    setTogglingCli(id)
    setToggleErrors((old) => ({ ...old, [id]: '' }))
    try {
      const next = readEnabled(
        value(await api.cliworker.setCliEnabled(sessionId, id, nextValue, controller.signal)),
      )
      if (!controller.signal.aborted) {
        enabledRef.current = next
        setEnabled(next)
      }
    } catch (error) {
      if (!controller.signal.aborted) setToggleErrors((old) => ({ ...old, [id]: operationMessage(error) }))
    } finally {
      if (!controller.signal.aborted) {
        toggleController.current = undefined
        setTogglingCli(undefined)
      }
    }
  }
  return (
    <Modal
      open
      onClose={() => void leave(onClose)}
      title={t('CLI Worker 设置')}
      closeLabel={t('关闭设置')}
      className="cwn-settings-dialog"
      contentClassName="cwn-settings-content"
    >
      <div className="cwn-settings-layout" ref={scrolling}>
        <nav className="cwn-settings-nav" aria-label={t('CLI 设置导航')}>
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="cwn-settings-nav-primary"
            aria-label={t('CLI Worker 设置')}
            aria-pressed={page === 'general'}
            onClick={() => void leave(() => setPage('general'))}
          >
            <span className="cwn-settings-nav-icon" aria-hidden="true">
              <IconSettingsOutlineRegular size={20} />
            </span>
            <span className="cwn-settings-nav-label">{t('CLI Worker 设置')}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="cwn-settings-nav-primary"
            aria-label={t('智能体设置')}
            aria-pressed={page === 'roles'}
            onClick={() => void leave(() => setPage('roles'))}
          >
            <span className="cwn-settings-nav-icon" aria-hidden="true">
              <IconUserOutlineRegular size={20} />
            </span>
            <span className="cwn-settings-nav-label">{t('智能体设置')}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="cwn-settings-nav-primary"
            aria-label={
              indicator?.kind === 'count'
                ? t('更新 CLI（{count} 个可更新）', { count: indicator.count })
                : indicator?.kind === 'spinner'
                  ? t('更新 CLI（正在进行）')
                  : t('更新 CLI')
            }
            aria-pressed={page === 'update'}
            onClick={() => void leave(() => setPage('update'))}
          >
            <span className="cwn-settings-nav-icon" aria-hidden="true">
              <IconDownloadOutlineRegular size={20} />
            </span>
            <span className="cwn-settings-nav-label">{t('更新 CLI')}</span>
            {indicator?.kind === 'count' ? (
              <span className="cwn-settings-nav-badge" aria-hidden="true">
                {indicator.count}
              </span>
            ) : indicator?.kind === 'spinner' ? (
              <span className="cwn-settings-nav-status" aria-hidden="true">
                <StateDot state="ongoing" size={12} />
              </span>
            ) : null}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="cwn-settings-nav-primary"
            aria-label={t('CLI 连接')}
            aria-expanded={cliExpanded}
            aria-controls={cliGroupId}
            onClick={() => setCliExpanded((expanded) => !expanded)}
          >
            <span className="cwn-settings-nav-icon" aria-hidden="true">
              <IconLinkOutlineRegular size={20} />
            </span>
            <span className="cwn-settings-nav-label">{t('CLI 连接')}</span>
            <IconChevronDownOutlineRegular size={14} className="cwn-settings-nav-chevron" />
          </Button>
          <div
            id={cliGroupId}
            className="cwn-settings-cli-group"
            data-expanded={cliExpanded}
            aria-hidden={!cliExpanded}
            {...(!cliExpanded ? { inert: '' } : {})}
          >
            <div className="cwn-settings-cli-group-inner">
              {order.map((id) => {
                const connection = connectionStatus(enabled?.[id], accounts[id], settingsError)
                return (
                  <Button
                    key={id}
                    type="button"
                    variant="ghost"
                    size="md"
                    className="cwn-settings-cli-item"
                    aria-label={t('{cli} 设置', { cli: CLI_LABELS[id] })}
                    title={isWorkBuddy(id) ? t(WORKBUDDY_EXPERIMENTAL_NOTICE) : undefined}
                    aria-pressed={page === 'cli' && cli === id}
                    tabIndex={cliExpanded ? undefined : -1}
                    data-enabled={enabled?.[id] !== false}
                    data-experimental={isWorkBuddy(id) || undefined}
                    onClick={() =>
                      void leave(() => {
                        setCli(id)
                        setPage('cli')
                      })
                    }
                  >
                    <BrandIcon cli={id} size={22} />
                    <span className="cwn-settings-nav-label">{CLI_LABELS[id]}</span>
                    <Tooltip label={connection.label} side="right" portal>
                      <span className="cwn-settings-nav-status" role="img" aria-label={connection.label}>
                        {connection.state === 'pending' ? (
                          <StateDot state="ongoing" size={12} />
                        ) : (
                          <span className="cwn-connection-dot" data-state={connection.state} />
                        )}
                      </span>
                    </Tooltip>
                  </Button>
                )
              })}
            </div>
          </div>
        </nav>
        {page === 'general' ? (
          <GeneralSettingsPane api={api} sessionId={sessionId} />
        ) : page === 'roles' ? (
          <RolePresetsPane api={api} sessionId={sessionId} />
        ) : page === 'update' ? (
          <CliUpdatePane
            api={api}
            sessionId={sessionId}
            data={updates}
            onOpenCli={(id) =>
              void leave(() => {
                setCli(id)
                setCliExpanded(true)
                setPage('cli')
              })
            }
          />
        ) : (
          <CliSettings
            accountClose={accountClose}
            openNativeSettings={openNativeSettings}
            key={`${sessionId}:${cli}`}
            api={api}
            sessionId={sessionId}
            cli={cli}
            enabled={enabled?.[cli]}
            account={accounts[cli]}
            warmCatalogs={warmCatalogs}
            catalogEntry={catalogEntries[cli]}
            preferenceSaves={preferenceSaves}
            onRefreshModels={() => refreshCatalog(cli, true)}
            onPreferenceSaved={preference => {
              const id = preference.cli ?? 'antigravity'
              preferences.current = { ...preferences.current, [id]: preference }
              displayCache.current?.preference(id, preference)
              if (!mounted.current) return
              setCatalogEntries(old => {
                const entry = old[id]
                return entry?.data ? { ...old, [id]: { ...entry, data: { ...entry.data, preference } } } : old
              })
            }}
            connection={connectionStatus(enabled?.[cli], accounts[cli], settingsError)}
            onRefreshAccount={(replace = true, clearPrevious) => refreshAccount(cli, replace, clearPrevious)}
            freshBeforeAction={freshBeforeAction}
            onPrepareAccount={signal => prepareAccount(cli, signal)}
            onToggle={(next) => void toggleCli(cli, next)}
            toggleBusy={!!togglingCli}
            toggling={togglingCli === cli}
            settingsError={settingsError}
            toggleError={toggleErrors[cli] || ''}
          />
        )}
      </div>
    </Modal>
  )
}


function SectionProgress({ loading, label }: { loading: boolean; label: string }) {
  return (
    <span className="cwn-section-progress" role="status" aria-label={loading ? label : undefined}>
      {loading && <StateDot state="ongoing" size={14} />}
    </span>
  )
}

/** Render only the Host's safe identity projection, never raw CLI output. */
function AccountSummary({
  account,
  enabled,
  loading,
  settingsError,
  logout,
  connection,
}: {
  logout?: ReactNode
  account?: AccountEntry
  enabled?: boolean
  loading: boolean
  settingsError: string
  connection: ReturnType<typeof connectionStatus>
}) {
  const data = account?.data
  const current = enabled === true && !settingsError && !account?.error
  const authenticated = current && data?.state === 'authenticated'
  const apiLogin = authenticated && data.authMethod === 'api'
  const providerLogins = authenticated ? providerLoginSummary(data) : undefined
  const state = connection.state
  const label =
    enabled === false
      ? t('已关闭')
      : settingsError
        ? t('设置读取失败，请重新打开')
        : loading && !data
          ? t('正在读取登录信息…')
          : account?.error
            ? hostText(account.error)
            : connection.state === 'failed'
              ? connection.label
              : connection.state === 'pending' && !data
                ? t('正在检查连接…')
                : authenticated && connection.state === 'unknown'
                  ? connection.label
                  : authenticated
                  ? authenticatedLabel(data)
                  : data?.state === 'unconfigured'
                    ? data.installed
                      ? data.cli === 'claude'
                        ? hostText(data.summary)
                        : t('未登录')
                      : t('未安装')
                    : data?.state === 'configured'
                      ? connection.label
                      : hostText(data?.summary) || t('状态待确认')
  return (
    <div
      className="cwn-account-summary"
      data-account-state={current ? data?.state : undefined}
      data-provider-logins={!!providerLogins}
      role="status"
    >
      <div className="cwn-account-status-line">
        <span className="cwn-account-login" data-state={state}>
          <span className="cwn-account-status-dot" data-state={state} aria-hidden="true" />
          {providerLogins ? (
            <span className="cwn-account-logins" title={providerLogins.detail} aria-label={label}>
              {label}
            </span>
          ) : (
            label
          )}
        </span>
        {authenticated && !data.logins?.length && !apiLogin && data.accountLabel && (
          <span className="cwn-account-label" title={data.accountLabel}>
            {data.accountLabel}
          </span>
        )}
        {authenticated && logout}
      </div>
    </div>
  )
}
function CliSettings({
  accountClose,
  openNativeSettings,
  api,
  sessionId,
  cli,
  enabled,
  account,
  warmCatalogs,
  catalogEntry,
  preferenceSaves,
  onRefreshModels,
  onPreferenceSaved,
  connection,
  onRefreshAccount,
  freshBeforeAction = false,
  onPrepareAccount,
  onToggle,
  toggleBusy,
  toggling,
  settingsError,
  toggleError,
}: {
  accountClose: AccountCloseControl
  openNativeSettings?: () => void
  api: API
  sessionId: string
  cli: CliId
  enabled?: boolean
  account?: AccountEntry
  warmCatalogs: boolean
  catalogEntry?: SettingsCatalogEntry
  preferenceSaves: SettingsPreferenceSaves
  onRefreshModels: () => void
  onPreferenceSaved: (preference: Preference) => void
  connection: ReturnType<typeof connectionStatus>
  onRefreshAccount: (replace?: boolean, clearPrevious?: boolean) => void
  /** Read the account fresh before every login, sign-out or account window (connection snapshots). */
  freshBeforeAction?: boolean
  onPrepareAccount?: (signal: AbortSignal) => Promise<AccountStatus | undefined>
  onToggle: (enabled: boolean) => void
  toggleBusy: boolean
  toggling: boolean
  settingsError: string
  toggleError: string
}) {
  const [catalog, setCatalog] = useState<Catalog>()
  const [modelLoading, setModelLoading] = useState(true)
  const [writeState, setWriteState] = useState(() => preferenceSaves.snapshot(cli))
  const saving = writeState.saving
  const saveError = writeState.error
  const [modelError, setModelError] = useState('')
  const [modelRevision, refreshModels] = useState(0)
  const forceCatalogRefresh = useRef(false)
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState<Preference['effort']>('default')
  const [action, setAction] = useState<AccountAction>()
  // Several-login CLIs: one 「账号」 window lists, adds and signs out each login.
  const [accountsOpen, setAccountsOpen] = useState(false)
  const multiAccount = MULTI_ACCOUNT_CLIS.has(cli)
  const accountBusy = !!action || accountsOpen
  const [chosenAction, setChosenAction] = useState<AccountStatus['actions'][number]>()
  const [accountSource, setAccountSource] = useState<AccountSource>()
  const [pathChanging, setPathChanging] = useState(false)
  // A CLI paused after an unconfirmed cleanup: the user confirms inline before it is released.
  const [release, setRelease] = useState<'confirm' | 'running'>()
  const [releaseError, setReleaseError] = useState('')
  const selection = useRef({ model: '', effort: 'default' as Preference['effort'] })
  // The account an operation window runs against: the fresh read taken right before it opened,
  // kept while snapshot updates replace the display entry.
  const [opStatus, setOpStatus] = useState<AccountStatus>()
  const preparing = useRef<AbortController>()
  const windowReads = useRef(new Set<AbortController>())
  useEffect(() => {
    const reads = windowReads.current
    return () => {
      preparing.current?.abort()
      for (const read of reads) read.abort()
    }
  }, [])
  const prepareInWindow = () => {
    const controller = new AbortController()
    windowReads.current.add(controller)
    return (onPrepareAccount?.(controller.signal) ?? Promise.resolve(undefined))
      .then((fresh) => (controller.signal.aborted ? undefined : fresh))
      .finally(() => windowReads.current.delete(controller))
  }
  // Each opening of an account window; a read begun for an earlier opening never lands in a later one.
  const windowGeneration = useRef(0)
  const endWindowReads = () => {
    windowGeneration.current += 1
    for (const read of windowReads.current) read.abort()
  }
  // After a login, a sign-out, a return to the list or a saved provider, the open window shows a
  // fresh read with its handles at once; a display-only snapshot would keep the old logins listed.
  const refreshWindow = () => {
    if (!freshBeforeAction || !onPrepareAccount) return onRefreshAccount(true)
    const generation = windowGeneration.current
    void prepareInWindow().then((fresh) => {
      if (fresh && generation === windowGeneration.current) setOpStatus(fresh)
    })
  }
  useEffect(() => {
    if ((action || accountsOpen) && account?.data && actionsKnown(account)) setOpStatus(account.data)
  }, [account, action, accountsOpen])
  // A display-only status has no actions yet: offer the buttons and read the real ones on click.
  const handlesPending = freshBeforeAction && !!account?.data && !actionsKnown(account)
  const runFresh = (use: (status: AccountStatus) => void) => {
    if (preparing.current) return
    if (!freshBeforeAction || !onPrepareAccount) {
      if (account?.data) use(account.data)
      return
    }
    const controller = new AbortController()
    preparing.current = controller
    return onPrepareAccount(controller.signal)
      .then((fresh) => {
        if (fresh && !controller.signal.aborted) use(fresh)
      })
      .finally(() => {
        if (preparing.current === controller) preparing.current = undefined
      })
  }
  useEffect(() => {
    const update = () => setWriteState(preferenceSaves.snapshot(cli))
    const unsubscribe = preferenceSaves.subscribe(cli, update)
    update()
    return () => {
      unsubscribe()
      preferenceSaves.flush(cli)
    }
  }, [preferenceSaves, cli])
  useEffect(() => {
    // A refreshed account/catalog owns a new model scope. Only subsequent
    // human choice events may write a preference in that scope.
    selection.current = { model: '', effort: 'default' }
    setCatalog(undefined)
    setModel('')
    setEffort('default')
    setModelError('')
    if (!enabled) {
      setModelLoading(false)
      return
    }
    setModelLoading(true)
    // A changed account invalidates the old model scope. Start discovery only
    // after this account check settles, including a fresh independent read if
    // the CLI cannot report an account identity.
    if (!account || account.loading) return
    const applyCatalog = (next: Catalog) => {
      setCatalog(next)
      if (!next.models.length)
        setModelError(next.notice ? operationMessage(next.notice) : t('此 CLI 未返回可用模型，请登录或刷新重试'))
      const preference = preferenceSaves.snapshot(cli).preference ?? next.preference
      const preferred = preference ? modelName(preference) : ''
      const saved = next.models.find(
        (item) =>
          item.id === preferred ||
          Object.values(item.variants ?? {}).includes(preference?.model ?? ''),
      )
      const chosen = preference ? saved : visibleModelChoices(next.models)[0]
      if (preference && !saved && next.models.length)
        setModelError(t('原默认模型已不可用，请重新选择模型'))
      const effort =
        preference && chosen?.efforts?.includes(preference.effort)
          ? preference.effort
          : (chosen?.efforts?.[0] ?? 'default')
      selection.current = { model: chosen?.id ?? '', effort }
      setModel(selection.current.model)
      setEffort(effort)
    }
    if (warmCatalogs) {
      // A catalog being re-read keeps its last list on screen; choices stay disabled meanwhile.
      if (!catalogEntry || (catalogEntry.loading && !catalogEntry.data)) return
      if (catalogEntry.data) applyCatalog(catalogEntry.data)
      else setModelError(hostText(catalogEntry.error) || t('模型目录不可用，请刷新重试'))
      setModelLoading(catalogEntry.loading)
      return
    }
    const controller = new AbortController()
    void (async () => {
      try {
        const force = forceCatalogRefresh.current
        forceCatalogRefresh.current = false
        const next: Catalog = JSON.parse(
          value(
            await (force
              ? api.cliworker.refreshCatalogForCli(sessionId, cli, controller.signal)
              : api.cliworker.catalogForCli(sessionId, cli, controller.signal)),
          ),
        )
        if (next.cli !== cli) throw new Error(t('收到不匹配的 CLI 模型目录，请重试'))
        if (controller.signal.aborted) return
        applyCatalog(next)
      } catch (error) {
        if (!controller.signal.aborted) {
          setCatalog(undefined)
          setModel('')
          setModelError(operationMessage(error))
        }
      } finally {
        if (!controller.signal.aborted) setModelLoading(false)
      }
    })()
    return () => {
      controller.abort()
    }
  }, [api, sessionId, cli, enabled, account, modelRevision, preferenceSaves, warmCatalogs,
    catalogEntry?.loading, catalogEntry?.error, catalogEntry?.data?.models, catalogEntry?.data?.notice])
  const inactive = !enabled || toggling
  const settingsPending = enabled === undefined && !settingsError
  const accountLoading = !settingsError && enabled !== false && (!account || account.loading)
  const supportedEfforts = catalog?.models.find((item) => item.id === model)?.efforts ?? []
  // A snapshot catalog past its receipt is display only until the Host has read it again.
  const catalogExpired = warmCatalogs && !!catalogEntry?.data?.cache && !freshReceipt(catalogEntry.data.cache, Date.now())
  const choiceDisabled = inactive || pathChanging || modelLoading || accountLoading || accountBusy || !catalog || catalogExpired
  function savePreference(preference: Preference) {
    preferenceSaves.stage(preference, async (next, signal) => {
      const saved = JSON.parse(value(await api.cliworker.configure(sessionId, JSON.stringify(next), signal)))
      return saved?.cli === cli && typeof saved.model === 'string' ? saved as Preference : next
    }, onPreferenceSaved)
  }
  const changeModel = (id: string) => {
    if (choiceDisabled) return
    const chosen = catalog?.models.find((item) => item.id === id)
    if (!chosen?.efforts?.length) return
    const effort = chosen.efforts.includes(selection.current.effort)
      ? selection.current.effort
      : chosen.efforts[0]!
    selection.current = { model: id, effort }
    setModel(id)
    setEffort(effort)
    setModelError('')
    savePreference({ cli, model: id, effort })
  }
  const changeEffort = (id: string) => {
    if (choiceDisabled) return
    const chosen = catalog?.models.find((item) => item.id === selection.current.model)
    const effort = chosen?.efforts?.find((effort) => effort === id)
    if (!chosen || !effort) return
    selection.current = { model: chosen.id, effort }
    setEffort(effort)
    savePreference({ cli, model: chosen.id, effort })
  }
  const cleanupBlocked = enabled === true && !account?.error && !!account?.data?.cleanupBlocked
  useEffect(() => {
    if (cleanupBlocked) return
    setRelease(undefined)
    setReleaseError('')
  }, [cleanupBlocked])
  const releasePause = async () => {
    setRelease('running')
    setReleaseError('')
    try {
      if (!api.cliworker.recoverCliCleanup) throw new Error(t('当前插件 Host 不支持此账号操作，请更新插件后重试'))
      value(await api.cliworker.recoverCliCleanup(sessionId, cli, new AbortController().signal))
      setRelease(undefined)
      preferenceSaves.invalidate(cli)
      onRefreshAccount(true)
    } catch (error) {
      setRelease('confirm')
      setReleaseError(operationMessage(error))
    }
  }
  const finishedAccountAction = () => {
    onRefreshAccount(true)
  }
  // A saved 「其他服务商」 changes both the logins and the models: the fresh account read re-reads the
  // catalog with snapshots; without them the next catalog read after it is forced here.
  const providerSaved = () => {
    if (!warmCatalogs) {
      forceCatalogRefresh.current = true
      refreshModels((n) => n + 1)
    }
    if (accountsOpen) refreshWindow()
    else onRefreshAccount(true)
  }
  const closeAccounts = () => {
    endWindowReads()
    setAccountsOpen(false)
    setOpStatus(undefined)
    onRefreshAccount(true)
  }
  const closeAccount = () => {
    endWindowReads()
    setAction(undefined)
    setAccountSource(undefined)
    setOpStatus(undefined)
    onRefreshAccount(true)
  }
  const operationAccount = opStatus ?? account?.data
  const sources = chosenAction?.sources?.filter(
    (source, index, all) =>
      ['native', 'plugin'].includes(source.id) && all.findIndex((item) => item.id === source.id) === index,
  )
  const choosingSource = action === 'logout' && chosenAction?.sources !== undefined && !accountSource
  const accountAction = (id: AccountAction) => {
    const item = account?.data?.actions.find((candidate) => candidate.id === id)
    // Before the fresh read only WorkBuddy's target is known: all of its account actions are desktop ones.
    const target = item ? item.target : handlesPending && isWorkBuddy(cli) ? 'desktop' : undefined
    const label =
      target === 'desktop' ? t(account?.data?.state === 'unconfigured' ? '登录' : '在桌面端管理') : target === 'models'
        ? id === 'login'
          ? t('登录设置')
          : t('打开原生设置')
        : (hostText(item?.label) ??
          (id === 'logout'
            ? t('退出登录')
            : id === 'manage'
              ? t('账号终端')
              : ['omp', 'pi', 'hermes', 'opencode'].includes(cli)
                ? t('登录设置')
                : t('登录 / 切换账号')))
    return (
      <Button
        type="button"
        variant={id === 'logout' ? 'ghost' : 'outline'}
        size="md"
        className={
          id === 'logout'
            ? 'cwn-account-logout'
            : id === 'manage'
              ? 'cwn-account-manage'
              : 'cwn-account-login-action'
        }
        aria-label={label}
        disabled={
          inactive ||
          accountLoading ||
          !!account?.error ||
          accountBusy ||
          saving ||
          pathChanging ||
          (!item && !handlesPending) ||
          (target === 'models' && !openNativeSettings)
        }
        onClick={() => {
          if (inactive) return
          return runFresh((fresh) => {
            const chosen = fresh.actions.find((candidate) => candidate.id === id)
            if (!chosen) return
            if (chosen.target === 'models') {
              openNativeSettings?.()
              return
            }
            preferenceSaves.invalidate(cli)
            setOpStatus(fresh)
            setChosenAction(chosen)
            setAccountSource(
              id === 'logout' &&
                chosen.sources?.length === 1 &&
                ['native', 'plugin'].includes(chosen.sources[0]!.id)
                ? chosen.sources[0]!.id
                : undefined,
            )
            setAction(chosen.id)
          })
        }}
      >
        {id === 'logout' ? (
          <>
            <Glyph name="logout" />
            {t('退出')}
          </>
        ) : target === 'models' || target === 'desktop' ? (
          label
        ) : id === 'manage' ? (
          <>
            <Glyph name="tool" />
            {t('账号终端')}
          </>
        ) : item?.label && item.label !== '登录 / 切换账号' ? (
          hostText(item.label)
        ) : account?.data?.state === 'authenticated' ? (
          t('切换账号')
        ) : (
          t('登录账号')
        )}
      </Button>
    )
  }
  return (
    <div className="cwn-settings-pane" aria-label={t('{cli} 配置', { cli: CLI_LABELS[cli] })}>
      <div className="cwn-cli-identity" data-enabled={enabled !== false}>
        <div className="cwn-settings-cli-name">
          <BrandIcon cli={cli} size={40} />
          <div>
            <h2>{CLI_LABELS[cli]}</h2>
            <p className="cwn-cli-subtitle">{isWorkBuddy(cli) ? t(WORKBUDDY_EXPERIMENTAL_NOTICE) : t('管理账号与模型偏好')}</p>
          </div>
        </div>
        <div className="cwn-cli-toggle">
          <SectionProgress
            loading={settingsPending || toggling}
            label={toggling ? t('正在保存 CLI 开关') : t('正在读取 CLI 开关')}
          />
          <Switch
            checked={enabled ?? false}
            onChange={onToggle}
            label={t('启用 {cli}', { cli: CLI_LABELS[cli] })}
            disabled={enabled === undefined || toggleBusy || saving || accountBusy || pathChanging}
            title={accountBusy ? t('请先关闭账号终端') : undefined}
          />
        </div>
      </div>
      <div className="cwn-cli-toggle-status" role="status">
        {settingsError || toggleError || (enabled === false ? t('已关闭') : '')}
      </div>
      <section className="cwn-settings-section" aria-label={t('账号与登录')}>
        <div className="cwn-settings-section-head">
          <h3>{t('账号与登录')}</h3>
          <div className="cwn-settings-section-tools">
            <SectionProgress loading={accountLoading} label={t('正在读取 {cli} 账号…', { cli: CLI_LABELS[cli] })} />
            <Tooltip label={t('刷新登录状态')} side="top" portal>
              <Button
                type="button"
                variant="ghost"
                size="md"
                className="cwn-refresh"
                aria-label={t('刷新状态')}
                disabled={inactive || accountLoading || saving || pathChanging}
                onClick={() => onRefreshAccount()}
              >
                <IconRefreshOutlineRegular size={16} />
              </Button>
            </Tooltip>
          </div>
        </div>
        <div className="cwn-account-row">
          <AccountSummary
            account={account}
            connection={connection}
            enabled={enabled}
            loading={accountLoading}
            settingsError={settingsError}
            logout={multiAccount || isWorkBuddy(cli) ? undefined : accountAction('logout')}
          />
          <div className="cwn-account-actions">
            {cleanupBlocked ? (
              <Button
                type="button"
                variant="outline"
                size="md"
                className="cwn-account-login-action"
                disabled={inactive || accountLoading || !!release || saving || pathChanging}
                onClick={() => {
                  setReleaseError('')
                  setRelease('confirm')
                }}
              >
                {t('解除暂停')}
              </Button>
            ) : isWorkBuddy(cli) ? (
              account?.data?.installed && ((handlesPending || account.data.actions.some(item => item.target === 'desktop')) &&
                api.cliworker.accountDesktopStart && api.cliworker.accountDesktopWatch && api.cliworker.accountDesktopRespond && api.cliworker.accountDesktopStop
                ? accountAction('manage') : <span className="cwn-cli-subtitle">{t('在 WorkBuddy 桌面端管理')}</span>)
            ) : multiAccount ? (
              <Button
                type="button"
                variant="outline"
                size="md"
                className="cwn-account-login-action"
                disabled={
                  inactive ||
                  accountLoading ||
                  !!account?.error ||
                  accountBusy ||
                  saving ||
                  pathChanging ||
                  (!handlesPending && !account?.data?.actions.some((item) => item.id === 'login' && item.target !== 'models'))
                }
                onClick={() => {
                  if (inactive) return
                  return runFresh((fresh) => {
                    if (!fresh.actions.some((item) => item.id === 'login' && item.target !== 'models')) return
                    preferenceSaves.invalidate(cli)
                    setOpStatus(fresh)
                    setAccountsOpen(true)
                  })
                }}
              >
                {account?.data?.state === 'authenticated' ? t('账号') : t('登录账号')}
              </Button>
            ) : (
              accountAction('login')
            )}
            {/* ZCode's desktop-bundled CLI has no terminal UI: once the Host says so, the entry is hidden, not disabled. */}
            {!cleanupBlocked && !isWorkBuddy(cli) &&
              !(cli === 'zcode' && !!account?.data?.installed && !account.data.actions.some((item) => item.id === 'manage')) &&
              accountAction('manage')}
          </div>
        </div>
        {enabled === true && !settingsError && !account?.error && account?.data?.installationNotice && (
          <p className="cwn-settings-notice cwn-settings-hint" role="status">
            {hostText(account.data.installationNotice)}
          </p>
        )}
        {cleanupBlocked && release && (
          <div className="cwn-cleanup-release" role="group" aria-label={t('解除暂停')}>
            <div className="cwn-accounts-confirm">
              <span>
                {t('请先在任务管理器（Windows）或活动监视器（macOS）中确认没有 {cli} 的残留进程，再解除暂停。解除后会重新读取账号和模型。', { cli: CLI_LABELS[cli] })}
              </span>
              <div className="cwn-login-actions">
                <Button
                  variant="ghost"
                  size="md"
                  disabled={release === 'running'}
                  onClick={() => {
                    setRelease(undefined)
                    setReleaseError('')
                  }}
                >
                  {t('取消')}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  disabled={release === 'running' || inactive}
                  onClick={() => void releasePause()}
                >
                  {release === 'running' ? t('正在解除暂停…') : t('确认解除')}
                </Button>
              </div>
            </div>
            <p className="cwn-settings-feedback-slot" role="status">{releaseError}</p>
          </div>
        )}
        {accountsOpen && enabled && (
          <Modal
            open
            onClose={() => {
              if (accountClose.current) void accountClose.current()
              else closeAccounts()
            }}
            title={`${CLI_LABELS[cli]} · ${t('账号')}`}
            closeLabel={t('关闭账号操作')}
            className="cwn-account-dialog"
            contentClassName="cwn-account-dialog-content"
          >
            <AccountsWindow
              api={api}
              sessionId={sessionId}
              cli={cli}
              status={operationAccount}
              closeControl={accountClose}
              onRefresh={refreshWindow}
              onClose={closeAccounts}
              prepare={freshBeforeAction && onPrepareAccount ? prepareInWindow : undefined}
              onProviderSaved={providerSaved}
            />
          </Modal>
        )}
        {action && enabled && (
          <Modal
            open
            onClose={() => {
              if (accountClose.current) void accountClose.current()
              else closeAccount()
            }}
            title={`${CLI_LABELS[cli]} · ${hostText(chosenAction?.label) ?? t('账号终端')}`}
            closeLabel={t('关闭账号操作')}
            className="cwn-account-dialog"
            contentClassName="cwn-account-dialog-content"
          >
            {chosenAction?.target === 'desktop' ? (
              <WorkBuddyDesktopWindow api={api} sessionId={sessionId} cli={cli} account={operationAccount}
                closeControl={accountClose} onClose={closeAccount} />
            ) : choosingSource ? (
              <section aria-label={t('选择退出账号来源')}>
                <p>{sources?.length ? t('选择要退出的账号来源') : t('账号来源不可用，请关闭后刷新状态')}</p>
                <div className="cwn-account-actions">
                  {sources?.map((source) => (
                    <Button
                      key={source.id}
                      variant="outline"
                      size="md"
                      onClick={() => setAccountSource(source.id)}
                    >
                      {hostText(source.label)}
                    </Button>
                  ))}
                </div>
              </section>
            ) : (
              <AccountTerminal
                closeControl={accountClose}
                api={api}
                sessionId={sessionId}
                cli={cli}
                action={action}
                source={accountSource}
                signedIn={operationAccount?.state === 'authenticated'}
                account={operationAccount}
                onClose={closeAccount}
                onFinished={finishedAccountAction}
              />
            )}
          </Modal>
        )}
      </section>
      <section className="cwn-settings-section" aria-label={t('项目默认设置')}>
        <div className="cwn-settings-section-head">
          <h3>{t('项目默认设置')}</h3>
          <div className="cwn-settings-section-tools">
            <SectionProgress
              loading={!settingsError && enabled !== false && (modelLoading || settingsPending)}
              label={t('正在读取 {cli} 模型…', { cli: CLI_LABELS[cli] })}
            />
            <Tooltip label={t('刷新模型列表')} side="top" portal>
              <Button
                type="button"
                variant="ghost"
                size="md"
                className="cwn-refresh"
                aria-label={t('刷新模型')}
                disabled={inactive || modelLoading || saving || pathChanging}
                onClick={() => {
                  preferenceSaves.invalidate(cli)
                  if (warmCatalogs) onRefreshModels()
                  else {
                    forceCatalogRefresh.current = true
                    refreshModels((n) => n + 1)
                  }
                }}
              >
                <IconRefreshOutlineRegular size={16} />
              </Button>
            </Tooltip>
          </div>
        </div>
        <form
          className="cwn-settings-form"
          onSubmit={(event) => {
            event.preventDefault()
          }}
        >
          <label className="cwn-setting-row">
            <span className="cwn-setting-row-text">
              <span>{t('模型')}</span>
              <span className="cwn-setting-description">{t('新对话沿用的默认模型')}</span>
            </span>
            <NativeChoice
              label={t('默认模型')}
              selected={model}
              choices={visibleModelChoices(catalog?.models ?? [], model).map((item) => ({
                id: item.id,
                label: item.label,
              }))}
              disabled={choiceDisabled}
              onChange={changeModel}
            />
          </label>
          <label className="cwn-setting-row">
            <span className="cwn-setting-row-text">
              <span>{t('思考强度')}</span>
              <span className="cwn-setting-description">{t('仅提供当前模型支持的选项')}</span>
            </span>
            <NativeChoice
              label={t('默认思考强度')}
              selected={effort}
              choices={supportedEfforts.map((id) => ({ id, label: effortLabel(id) }))}
              disabled={choiceDisabled || !supportedEfforts.length}
              onChange={changeEffort}
            />
          </label>
          <p className="cwn-settings-notice cwn-settings-hint" role="status">
            {modelError ||
              (((cli === 'claude' || cli === 'codex') && catalog?.notice?.includes('路由')) ||
              catalog?.notice?.includes('认证失败')
                ? hostText(catalog!.notice)
                : '')}
          </p>
          {(saving || saveError) && (
            <div className="cwn-settings-save">
              <span className="cwn-settings-feedback-slot" role="status">
                {saving && <StateDot state="ongoing" size={14} />}
                {saveError || t('正在保存默认设置…')}
              </span>
            </div>
          )}
        </form>
      </section>
      <CliExecutableSettings
        api={api}
        sessionId={sessionId}
        cli={cli}
        blocked={accountBusy || saving || toggling}
        accountLoading={accountLoading}
        accountRevision={account}
        onApplied={() => {
          if (enabled) onRefreshAccount(true, true)
        }}
        onBusyChange={setPathChanging}
      />
    </div>
  )
}
