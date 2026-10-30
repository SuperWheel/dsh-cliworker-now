import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  Modal,
  StateDot,
  Switch,
  Tooltip,
  IconChevronDownOutlineRegular,
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
import { AccountTerminal, type AccountCloseControl } from './account-terminal.tsx'
import { AccountsWindow } from './account-login/accounts-window.tsx'
import { MULTI_ACCOUNT_CLIS } from '../shared/account-links.ts'
import { BrandIcon, Glyph } from './icons.tsx'
import { operationMessage } from './operation-error.ts'
import { value, type API } from './workers.ts'
import { RolePresetsPane } from './role-presets.tsx'
import { GeneralSettingsPane } from './general-settings.tsx'
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
  return providerLoginSummary(account)?.label ?? (account.authMethod === 'api' ? t('API 登录') : t('已登录'))
}
function connectionStatus(enabled: boolean | undefined, account?: AccountEntry, settingsError = '') {
  if (enabled === false) return { state: 'disabled', label: t('已关闭') }
  if (settingsError) return { state: 'failed', label: t('CLI 开关配置读取失败，请重新打开设置') }
  if (enabled === undefined || !account || (account.loading && !account.data))
    return { state: 'pending', label: t('正在检查连接') }
  if (!account.error && account.data?.state === 'unconfigured')
    return {
      state: 'unconfigured',
      label: account.data.installed
        ? account.data.cli === 'claude'
          ? hostText(account.data.summary)
          : t('未登录')
        : t('未安装'),
    }
  if (account.error || !account.data || ['unavailable', 'unauthenticated'].includes(account.data.state)) {
    return { state: 'failed', label: hostText(account.error || account.data?.summary) || t('连接失败') }
  }
  if (!['authenticated', 'configured'].includes(account.data.state)) {
    return {
      state: 'unknown',
      label: hostText(account.data.summary) || t('状态待确认'),
    }
  }
  if (account.data.state === 'authenticated')
    return { state: 'connected', label: authenticatedLabel(account.data) }
  return { state: 'unverified', label: hostText(account.data.summary)?.trim() || t('已配置') }
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
  const [page, setPage] = useState<'cli' | 'roles' | 'general'>(initialCli ? 'cli' : 'general')
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
      const entry = { data: next, loading: false }
      cache?.catalog(id, entry, version)
      setCatalogEntries(old => ({ ...old, [id]: entry }))
    } catch (error) {
      if (signal.aborted) return
      const entry = { loading: false, error: operationMessage(error) }
      cache?.catalog(id, entry, version)
      setCatalogEntries(old => ({ ...old, [id]: entry }))
    }
  }, [api, sessionId])
  const refreshCatalog = useCallback((id: CliId, force = false) => {
    if (!enabledRef.current?.[id]) return
    if (force) (displayCache.current?.preferenceSaves ?? fallbackSaves).invalidate(id)
    if (probes.current.enqueue(id, signal => readCatalog(id, signal, force), force))
      setCatalogEntries(old => ({ ...old, [id]: { loading: true } }))
  }, [readCatalog, fallbackSaves])
  const refreshAccount = useCallback(
    (id: CliId, replace = false, clearPrevious = false) => {
      if (!enabledRef.current?.[id]) return
      if (probes.current.has(id) && !replace) return
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
            const next: AccountStatus = JSON.parse(
              value(await api.cliworker.accountStatus(sessionId, id, signal)),
            )
            if (next.cli !== id) throw new Error(t('收到不匹配的 CLI 账号状态，请重试'))
            if (cache && cache.version(id) !== version) throw new Error(t('账号来源已变化，请刷新状态'))
            if (!signal.aborted) {
              const entry = { data: next, loading: false }
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
        replace,
      )
    },
    [api, sessionId, readCatalog, fallbackSaves],
  )

  useEffect(() => {
    const controller = new AbortController()
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
        setAccounts(displayCache.current?.accountSnapshot() ?? {})
        setCatalogEntries(displayCache.current?.catalogSnapshot() ?? {})
        setWarmCatalogs(metadata !== undefined)
        enabledRef.current = next
        setEnabled(next)
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
    }
  }, [api, sessionId, fallbackSaves])
  useEffect(() => {
    if (!enabled) return
    probes.current.prioritize(cli)
    for (const id of [cli, ...CLI_IDS.filter((id) => id !== cli)]) {
      if (enabled[id]) {
        if (!accounts[id]) refreshAccount(id)
        else if (warmCatalogs && !catalogEntries[id]) refreshCatalog(id)
      } else {
        probes.current.cancel(id)
        displayCache.current?.invalidate(id)
        if (!displayCache.current) fallbackSaves.invalidate(id)
        if (accounts[id])
          setAccounts((old) => {
            const next = { ...old }
            delete next[id]
            return next
          })
      }
    }
    // A completed or failed probe is cached until explicitly refreshed. This
    // Selection only reprioritizes pending work; it does not repeat settled reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cli, refreshAccount, refreshCatalog, warmCatalogs])

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
                    aria-pressed={page === 'cli' && cli === id}
                    tabIndex={cliExpanded ? undefined : -1}
                    data-enabled={enabled?.[id] !== false}
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
              displayCache.current?.preference(id, preference)
              if (!mounted.current) return
              setCatalogEntries(old => {
                const entry = old[id]
                return entry?.data ? { ...old, [id]: { ...entry, data: { ...entry.data, preference } } } : old
              })
            }}
            connection={connectionStatus(enabled?.[cli], accounts[cli], settingsError)}
            onRefreshAccount={(replace = true, clearPrevious) => refreshAccount(cli, replace, clearPrevious)}
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
              : connection.state === 'pending'
                ? t('正在检查连接…')
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
  const selection = useRef({ model: '', effort: 'default' as Preference['effort'] })
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
      if (!catalogEntry || catalogEntry.loading) return
      if (catalogEntry.data) applyCatalog(catalogEntry.data)
      else setModelError(hostText(catalogEntry.error) || t('模型目录不可用，请刷新重试'))
      setModelLoading(false)
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
  const choiceDisabled = inactive || pathChanging || modelLoading || accountLoading || accountBusy || !catalog
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
  const finishedAccountAction = () => {
    onRefreshAccount(true)
  }
  const closeAccounts = () => {
    setAccountsOpen(false)
    onRefreshAccount(true)
  }
  const closeAccount = () => {
    setAction(undefined)
    setAccountSource(undefined)
    onRefreshAccount(true)
  }
  const sources = chosenAction?.sources?.filter(
    (source, index, all) =>
      ['native', 'plugin'].includes(source.id) && all.findIndex((item) => item.id === source.id) === index,
  )
  const choosingSource = action === 'logout' && chosenAction?.sources !== undefined && !accountSource
  const accountAction = (id: AccountAction) => {
    const item = account?.data?.actions.find((candidate) => candidate.id === id)
    const label =
      item?.target === 'models'
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
          !item ||
          (item.target === 'models' && !openNativeSettings)
        }
        onClick={() => {
          if (!inactive && item) {
            if (item.target === 'models') {
              openNativeSettings?.()
              return
            }
            preferenceSaves.invalidate(cli)
            setChosenAction(item)
                    setAccountSource(
              id === 'logout' &&
                item.sources?.length === 1 &&
                ['native', 'plugin'].includes(item.sources[0]!.id)
                ? item.sources[0]!.id
                : undefined,
            )
            setAction(item.id)
          }
        }}
      >
        {id === 'logout' ? (
          <>
            <Glyph name="logout" />
            {t('退出')}
          </>
        ) : item?.target === 'models' ? (
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
            <p className="cwn-cli-subtitle">{t('管理账号与模型偏好')}</p>
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
            logout={multiAccount ? undefined : accountAction('logout')}
          />
          <div className="cwn-account-actions">
            {multiAccount ? (
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
                  !account?.data?.actions.some((item) => item.id === 'login' && item.target !== 'models')
                }
                onClick={() => {
                  if (inactive) return
                  preferenceSaves.invalidate(cli)
                  setAccountsOpen(true)
                }}
              >
                {account?.data?.state === 'authenticated' ? t('账号') : t('登录账号')}
              </Button>
            ) : (
              accountAction('login')
            )}
            {accountAction('manage')}
          </div>
        </div>
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
              status={account?.data}
              closeControl={accountClose}
              onRefresh={() => onRefreshAccount(true)}
              onClose={closeAccounts}
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
            {choosingSource ? (
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
                signedIn={account?.data?.state === 'authenticated'}
                account={account?.data}
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
              ((cli === 'claude' || cli === 'codex') && catalog?.notice?.includes('路由')
                ? hostText(catalog.notice)
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
