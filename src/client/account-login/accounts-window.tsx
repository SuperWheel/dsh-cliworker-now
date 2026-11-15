import { useEffect, useRef, useState } from 'react'
import { Button, IconPlusOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountConfigurationDeleteResult, AccountLogin, AccountProvider, AccountSource, AccountStatus } from '../../shared/accounts.ts'
import { GUIDED_ACCOUNT_CLIS, parseAccountLoginId } from '../../shared/account-links.ts'
import type { CustomProviderForm, CustomProviderResult } from '../../shared/custom-provider.ts'
import { CLI_LABELS, type CliId } from '../../shared/types.ts'
import { ProviderCards } from './provider-cards.tsx'
import { ProviderForm, validProviderForm } from './provider-form.tsx'
import { AccountTerminal, type AccountCloseControl } from '../account-terminal.tsx'
import { t, useT } from '../i18n.ts'
import { hostText, operationMessage } from '../operation-error.ts'
import { value, type API } from '../workers.ts'

/** Optional while an older Host/client declaration is still installed. */
type AccountsAPI = API & { cliworker: {
  deleteAccountConfiguration?: (parent: string, cli: string, login: string, signal: AbortSignal) => ReturnType<NonNullable<API['cliworker']['saveCustomProvider']>>
} }

/** The account window's own choice for a native picker. */
const NATIVE = '__native__'

type Request = {
  action: 'login' | 'logout'
  provider?: string
  login?: string
  replaces?: string
  source?: AccountSource
  title: string
}

const order = (source?: AccountSource) => (source === 'native' ? 0 : source === 'plugin' ? 1 : 2)

const credentialNumber = (login: AccountLogin) => {
  const parsed = login.id ? parseAccountLoginId(login.id) : undefined
  return parsed?.cli === 'omp' ? parsed.entry?.match(/^(?:native|plugin)\.([1-9]\d*)$/)?.[1] : undefined
}
const loginText = (login: AccountLogin) => {
  const text = login.authMethod === 'api'
    ? t('{provider} API 登录', { provider: hostText(login.providerLabel) })
    : t('{provider}账号登录', { provider: hostText(login.providerLabel) })
  const id = credentialNumber(login)
  return id ? `${text} · ${t('凭据 #{id}', { id })}` : text
}

const removalTitle = (login: AccountLogin) => login.nativeConfiguration
  ? t('删除 {provider}', { provider: hostText(login.providerLabel) })
  : t('退出 {account}', { account: loginText(login) })

/**
 * The 「账号」 window of a CLI that keeps several logins (2026-10-26 decision):
 * every login with its own 退出, and 添加账号 with a 「登录到」 provider picker.
 */
export function AccountsWindow({
  api,
  sessionId,
  cli,
  status,
  closeControl,
  onRefresh,
  onClose,
  prepare,
  onProviderSaved,
}: {
  api: AccountsAPI
  sessionId: string
  cli: CliId
  status?: AccountStatus
  closeControl: AccountCloseControl
  onRefresh: () => void
  onClose: () => void
  /** Reads the account fresh right before one login is signed out; its login ids replace the shown ones. */
  prepare?: () => Promise<AccountStatus | undefined>
  /** After 「其他服务商」 was saved: re-read the account and the model catalog (defaults to `onRefresh`). */
  onProviderSaved?: () => void
}) {
  useT()
  const name = CLI_LABELS[cli]
  // Kimi reports API providers as configured, not verified; their rows are still signed out one by one.
  const logins =
    status?.state === 'authenticated' || status?.state === 'configured' ? (status.logins ?? []) : []
  // A signed-in CLI that reports no separate logins still has one row to sign out.
  const whole = !logins.length && status?.state === 'authenticated'
  const rows: AccountLogin[] = whole
    ? [{ providerLabel: '', authMethod: status.authMethod ?? 'oauth', accountLabel: status.accountLabel }]
    : logins
  const providers = status?.actions.find((item) => item.id === 'login')?.providers
  const sources = status?.actions.find((item) => item.id === 'logout')?.sources ?? []
  const [request, setRequest] = useState<Request>()
  const [adding, setAdding] = useState(false)
  const [confirming, setConfirming] = useState<number>()
  const [preparing, setPreparing] = useState(false)
  const [removalMessage, setRemovalMessage] = useState<{ error: boolean; text: string }>()
  const removal = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => removal.current?.abort(), [])
  const closingAll = useRef(false)
  const terminalClose: AccountCloseControl = useRef<(() => Promise<boolean>) | undefined>(undefined)
  // The dialog's close button ends a running window first, then the whole dialog.
  useEffect(() => {
    const request = async () => {
      if (removal.current) return false
      if (!terminalClose.current) {
        onClose()
        return true
      }
      closingAll.current = true
      return terminalClose.current()
    }
    closeControl.current = request
    return () => {
      if (closeControl.current === request) closeControl.current = undefined
    }
  })
  const back = () => {
    if (closingAll.current) return onClose()
    setRequest(undefined)
    setAdding(false)
    setConfirming(undefined)
    onRefresh()
  }

  if (request)
    return (
      <div className="cwn-accounts-run">
        <div className="cwn-accounts-run-head">
          <span>{request.title}</span>
        </div>
        <AccountTerminal
          api={api}
          sessionId={sessionId}
          cli={cli}
          action={request.action}
          source={request.source}
          provider={request.provider}
          login={request.login}
          replaces={request.replaces}
          closeControl={terminalClose}
          onClose={back}
          onFinished={onRefresh}
        />
      </div>
    )

  if (adding)
    return (
      <AddAccount
        api={api}
        sessionId={sessionId}
        cli={cli}
        providers={providers}
        logins={logins}
        onCancel={() => setAdding(false)}
        onStart={(next) => setRequest(next)}
        onSaved={onProviderSaved ?? onRefresh}
      />
    )

  const signOut = async (login: AccountLogin) => {
    if (preparing || removal.current) return
    if (login.id) {
      setPreparing(true)
      setRemovalMessage(undefined)
      const controller = new AbortController()
      removal.current = controller
      try {
        const current = prepare ? (await prepare())?.logins?.find(item => item.id === login.id) : login
        controller.signal.throwIfAborted()
        if (!current?.id) { setConfirming(undefined); return }
        const entry = parseAccountLoginId(current.id)?.entry
        if (((cli === 'pi' || cli === 'omp') && (entry === 'native.config' || entry === 'plugin.config')) ||
          (cli === 'zcode' && entry === 'plugin.config')) {
          const remove = api.cliworker?.deleteAccountConfiguration
          if (!remove) throw new Error(t('当前插件 Host 不支持此账号操作，请更新插件后重试'))
          try {
            const result = JSON.parse(value(await remove(sessionId, cli, current.id, controller.signal))) as AccountConfigurationDeleteResult
            if (result?.ok !== true) throw new Error(t('删除失败，请刷新后重试'))
            setRemovalMessage({ error: false, text: result.notice ? hostText(result.notice) : t('已删除该服务商配置。') })
            setConfirming(undefined)
          } finally { onRefresh() }
        } else {
          setConfirming(undefined)
          setRequest({ action: 'logout', login: current.id, title: removalTitle(current) })
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = operationMessage(error)
          const conflict = /^配置文件已被其他程序修改，未回滚；备份保留在 (.+)$/su.exec(message)
          setRemovalMessage({ error: true, text: conflict
            ? t('配置文件已被其他程序修改，未回滚；备份保留在 {path}', { path: conflict[1]! }) : message })
        }
      } finally { removal.current = undefined; setPreparing(false) }
      return
    }
    if (GUIDED_ACCOUNT_CLIS.has(cli))
      return setRequest({ action: 'logout', title: t('退出 {cli}', { cli: name }) })
    // No single-login removal for this row: the CLI's own menu, in the row's own location.
    const source = login.source ?? (sources.length === 1 ? sources[0]!.id : undefined)
    setRequest({
      action: 'logout',
      ...(source ? { source } : {}),
      title: t('在原生终端中退出 {cli}', { cli: name }),
    })
  }
  // Unaddressable/environment-only rows stay read-only; file-backed rows have Host handles.
  // ZCode API-key providers without a handle belong to ZCode Desktop's own configuration.
  const configOnly = (login: AccountLogin) =>
    !login.id && !whole && ((!login.source && (cli === 'pi' || cli === 'omp')) || (cli === 'zcode' && login.authMethod === 'api'))
  // Plugin-created ZCode providers are deleted directly, like native config rows; nothing signs in again.
  const deletes = (login: AccountLogin) => !!login.nativeConfiguration || (cli === 'zcode' && !!login.managedConfiguration)
  const card = ({ login, index }: { login: AccountLogin; index: number }) => {
    const removable = !!login.id || GUIDED_ACCOUNT_CLIS.has(cli)
    const title = whole ? t('当前账号') : hostText(login.providerLabel)
    const meta = [
      login.authMethod === 'api' ? 'API Key' : t('账号登录'),
      credentialNumber(login) ? t('凭据 #{id}', { id: credentialNumber(login)! }) : undefined,
      login.authMethod === 'oauth' ? login.accountLabel : undefined,
      configOnly(login) ? (cli === 'zcode' ? t('在 ZCode 桌面端管理') : t('在原配置中管理')) : undefined,
    ].filter(Boolean)
    return (
      <li
        key={login.id ?? `${login.source ?? ''}-${login.providerLabel}-${index}`}
        className="cwn-accounts-card"
        data-confirming={confirming === index || undefined}
      >
        <div className="cwn-accounts-card-main">
          <span className="cwn-accounts-mark" aria-hidden="true">
            {(title || name).trim().charAt(0).toUpperCase()}
          </span>
          <div className="cwn-accounts-row-text">
            <strong>{title}</strong>
            <span>{meta.join(' · ')}</span>
          </div>
          {confirming !== index &&
            !configOnly(login) &&
            (removable ? (
              <Button variant="ghost" size="md" disabled={preparing} onClick={() => setConfirming(index)}>
                {deletes(login) ? t('删除') : t('退出')}
              </Button>
            ) : (
              !native && (
                <Button variant="ghost" size="md" onClick={() => signOut(login)}>
                  {t('在原生终端中退出')}
                </Button>
              )
            ))}
        </div>
        {confirming === index && (
          <div className="cwn-accounts-confirm" role="group" aria-label={deletes(login) ? t('确认删除') : t('确认退出')}>
            <span>
              {cli === 'zcode' && login.managedConfiguration
                ? t('将删除插件目录中此服务商的配置和 API Key，ZCode 桌面端的配置不受影响。')
                : login.nativeConfiguration
                ? t('将从 {file} 删除该服务商，直接运行 {cli} 时也不再可用。', { file: cli === 'omp' ? '~/.omp/agent/models.yml' : '~/.pi/agent/models.json', cli: name })
                : login.managedConfiguration
                ? t('退出后会删除此服务商的配置和凭据，其他配置保留。')
                : cli === 'zcode' && !login.id
                ? t('BigModel 和 Z.AI 的登录会一起退出。')
                : t('退出后会删除这条凭据，其他账号保留。')}
            </span>
            <div className="cwn-login-actions">
              <Button variant="ghost" size="md" disabled={preparing} onClick={() => setConfirming(undefined)}>
                {t('取消')}
              </Button>
              <Button variant="primary" size="md" disabled={preparing} onClick={() => signOut(login)}>
                {deletes(login) ? t('确认删除') : t('确认退出')}
              </Button>
            </div>
          </div>
        )}
      </li>
    )
  }
  // Older Hosts give no location per row: one native button per location instead.
  const native = !GUIDED_ACCOUNT_CLIS.has(cli) && sources.length > 1 && !rows.some((login) => login.source)
  // Where a login is stored decides who uses it: the CLI run directly, or only the plugin.
  const place = (source?: AccountSource) =>
    source === 'native'
      ? { title: t('{cli} 原生目录', { cli: name }), hint: t('直接运行 {cli} 时也会使用', { cli: name }) }
      : source === 'plugin'
        ? { title: t('插件目录'), hint: t('只在 CLI Worker 中使用') }
        : { title: t('其他配置'), hint: t('来自环境变量或配置文件') }
  // Logins kept in several locations are listed under each one.
  const groups: { source?: AccountSource; rows: { login: AccountLogin; index: number }[] }[] = []
  rows.forEach((login, index) => {
    const group = groups.find((item) => item.source === login.source)
    if (group) group.rows.push({ login, index })
    else groups.push({ source: login.source, rows: [{ login, index }] })
  })
  groups.sort((a, b) => order(a.source) - order(b.source))
  const grouped = groups.some((group) => group.source)

  return (
    <div className="cwn-accounts-window">
      {removalMessage && <p className="cwn-login-callout" data-tone={removalMessage.error ? 'warning' : 'success'} role={removalMessage.error ? 'alert' : 'status'}>{removalMessage.text}</p>}
      {rows.length ? (
        grouped ? (
          groups.map((group) => {
            const { title, hint } = place(group.source)
            return (
              <section key={group.source ?? 'other'} className="cwn-accounts-group">
                <div className="cwn-accounts-group-head">
                  <h4 className="cwn-accounts-group-title">{title}</h4>
                  <span>{hint}</span>
                </div>
                <ul className="cwn-accounts-list" aria-label={title}>
                  {group.rows.map(card)}
                </ul>
              </section>
            )
          })
        ) : (
          <ul className="cwn-accounts-list" aria-label={t('{cli} 已登录账号', { cli: name })}>
            {groups.flatMap((group) => group.rows).map(card)}
          </ul>
        )
      ) : (
        <p className="cwn-accounts-empty">{t('尚未登录 {cli} 的任何账号。', { cli: name })}</p>
      )}
      {native && rows.length > 0 && (
        <div className="cwn-accounts-native">
          <span className="cwn-login-hint">
            {t('{cli} 只能在原生菜单中逐个退出，选择账号所在的位置：', { cli: name })}
          </span>
          <div className="cwn-login-actions">
            {sources.map((source) => (
              <Button
                key={source.id}
                variant="outline"
                size="md"
                onClick={() =>
                  setRequest({
                    action: 'logout',
                    source: source.id,
                    title: t('在原生终端中退出 {cli}', { cli: name }),
                  })
                }
              >
                {hostText(source.label)}
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="cwn-accounts-foot">
        {(status?.installationNotice || !providers?.length) && (
          <span className="cwn-login-hint">
            {status?.installationNotice
              ? hostText(status.installationNotice)
              : t('在原生终端中选择服务商并登录。')}
          </span>
        )}
        <Button
          variant="outline"
          size="md"
          disabled={preparing}
          onClick={() =>
            providers?.length
              ? setAdding(true)
              : setRequest({ action: 'login', title: t('在原生终端中添加 {cli} 账号', { cli: name }) })
          }
        >
          <IconPlusOutlineRegular size={16} />
          {t('添加账号')}
        </Button>
      </div>
    </div>
  )
}

/** The 「其他服务商」 form as read once when 添加账号 opens; `form: null` keeps the native terminal. */
type FormRead = { state: 'loading' } | { state: 'ready'; form: CustomProviderForm | null } | { state: 'failed'; error: string }

function AddAccount({
  api,
  sessionId,
  cli,
  providers,
  logins,
  onCancel,
  onStart,
  onSaved,
}: {
  api: API
  sessionId: string
  cli: CliId
  providers: AccountProvider[] | undefined
  logins: AccountLogin[]
  onCancel: () => void
  onStart: (request: Request) => void
  onSaved: () => void
}) {
  const name = CLI_LABELS[cli]
  const list = providers ?? []
  const [chosen, setChosen] = useState(list[0]?.id ?? NATIVE)
  const [replace, setReplace] = useState<string>()
  const readForm = api.cliworker?.customProviderForm
  // ZCode signs in to its two providers in the terminal; its own API-key providers need the Host form
  // (no native terminal configures them), so older Hosts keep only the two providers.
  const other = cli !== 'zcode' || !!readForm
  const [read, setRead] = useState<FormRead>(() =>
    other && readForm ? { state: 'loading' } : { state: 'ready', form: null },
  )
  const [waiting, setWaiting] = useState(false)
  const [editing, setEditing] = useState(false)
  // Read once when the page opens, so the card can say what 「继续」 will do; older Hosts have no form.
  useEffect(() => {
    if (!other || !readForm) return
    const controller = new AbortController()
    void (async () => {
      try {
        const raw = value(await readForm(sessionId, cli, controller.signal))
        const parsed: unknown = JSON.parse(raw)
        if (parsed !== null && (!validProviderForm(parsed) || parsed.cli !== cli))
          throw new Error(t('收到无效的服务商表单，请在原生终端中配置'))
        if (!controller.signal.aborted) setRead({ state: 'ready', form: parsed })
      } catch (error) {
        if (!controller.signal.aborted) setRead({ state: 'failed', error: operationMessage(error) })
      }
    })()
    return () => controller.abort()
  }, [other, readForm, sessionId, cli])
  const provider = list.find((item) => item.id === chosen)
  const form = read.state === 'ready' ? read.form : null
  // Hermes keeps several keys of one provider: add another, or replace one of them.
  const held = provider?.multi
    ? logins.filter((login) => login.id && parseAccountLoginId(login.id)?.provider === provider.id)
    : []
  useEffect(() => {
    setReplace(undefined)
    setWaiting(false)
  }, [chosen])
  const choices = [
    ...list.map((item) => ({
      id: item.id,
      name: hostText(item.label),
      label: item.signedIn ? t('{provider}（已登录）', { provider: hostText(item.label) }) : hostText(item.label),
      note: item.signedIn ? t('已登录') : undefined,
      signedIn: item.signedIn,
    })),
    ...(other && (cli !== 'zcode' || form)
      ? [
          form
            ? {
                id: NATIVE,
                mark: '…',
                name: t('其他服务商'),
                label: t('其他服务商（在本窗口中填写配置）'),
                note: t('在本窗口中填写配置'),
              }
            : {
                id: NATIVE,
                mark: '…',
                name: t('其他服务商'),
                label: t('其他服务商（在原生终端中选择）'),
                note: t('在原生终端中选择'),
              },
        ]
      : []),
  ]
  const native = () => onStart({ action: 'login', title: t('在原生终端中添加 {cli} 账号', { cli: name }) })
  // 「其他服务商」: the form when the Host gave one, otherwise the CLI's own picker.
  const continueOther = (current: FormRead) => {
    if (current.state === 'loading') return setWaiting(true)
    setWaiting(false)
    if (current.state === 'ready' && current.form) setEditing(true)
    else native()
  }
  useEffect(() => {
    if (waiting && read.state !== 'loading') continueOther(read)
  })
  const start = () => {
    if (!provider) return continueOther(read)
    onStart({
      action: 'login',
      provider: provider.id,
      ...(replace ? { replaces: replace } : {}),
      title: t('登录到 {provider}', { provider: hostText(provider.label) }),
    })
  }

  if (editing && form)
    return (
      <ProviderForm
        form={form}
        native={form.nativeFallback ? { label: t('在原生终端中配置'), onStart: native } : undefined}
        onBack={() => setEditing(false)}
        onDone={onCancel}
        submit={async (values, signal) => {
          const save = api.cliworker?.saveCustomProvider
          if (!save) throw new Error(t('当前插件 Host 不支持此账号操作，请更新插件后重试'))
          const result = JSON.parse(
            value(await save(sessionId, cli, form.token, JSON.stringify(values), signal)),
          ) as CustomProviderResult
          if (!result || typeof result.ok !== 'boolean') throw new Error(t('保存失败，请检查后重试'))
          if (!result.ok) return { ok: false, issues: Array.isArray(result.issues) ? result.issues : [] }
          onSaved()
          return {
            ok: true,
            title: t('已添加 {provider}', { provider: hostText(result.providerLabel) }),
            ...(result.notice ? { detail: hostText(result.notice) } : {}),
          }
        }}
      />
    )

  return (
    <div className="cwn-accounts-window">
      <div className="cwn-accounts-lead">
        <strong>{t('选择要登录的服务商')}</strong>
        <span>
          {provider
            ? t('在本窗口中完成授权或填写 API Key，原生终端在后台运行。')
            : form
              ? form.nativeFallback
                ? t('在本窗口中填写服务商配置，也可以改用原生终端。')
                : t('在本窗口中填写服务商配置。')
              : t('在原生终端中选择服务商并登录。')}
        </span>
      </div>
      <ProviderCards choices={choices} chosen={chosen} label={t('登录到')} onChoose={setChosen} />
      {!provider && read.state === 'failed' && (
        <p className="cwn-login-callout" data-tone="warning" role="status">
          <span>{t('无法读取图形化配置：{reason}。继续将在原生终端中配置。', { reason: read.error })}</span>
        </p>
      )}
      {provider?.signedIn && !provider.multi && (
        <p className="cwn-login-callout" data-tone="warning">
          <span>{t('{provider} 已登录，继续会替换它现有的凭据。', { provider: hostText(provider.label) })}</span>
        </p>
      )}
      {held.length > 0 && (
        <div
          className="cwn-accounts-panel cwn-accounts-mode"
          role="radiogroup"
          aria-label={t('{provider} 已有凭据', { provider: provider!.label })}
        >
          <label>
            <input
              type="radio"
              name="cwn-account-mode"
              checked={!replace}
              onChange={() => setReplace(undefined)}
            />
            {t('添加另一个凭据')}
          </label>
          {held.map((login, index) => (
            <label key={login.id}>
              <input
                type="radio"
                name="cwn-account-mode"
                checked={replace === login.id}
                onChange={() => setReplace(login.id)}
              />
              {credentialNumber(login)
                ? t('替换凭据 #{id}', { id: credentialNumber(login)! })
                : held.length === 1
                ? t('替换现有凭据')
                : login.accountLabel
                  ? t('替换 {account}', { account: login.accountLabel })
                  : t('替换第 {index} 个凭据', { index: String(index + 1) })}
            </label>
          ))}
          {replace && <span className="cwn-login-hint">{t('新凭据确认可用后，才会移除原凭据。')}</span>}
        </div>
      )}
      <div className="cwn-accounts-actions">
        <Button variant="ghost" size="md" onClick={onCancel}>
          {t('返回')}
        </Button>
        <Button variant="primary" size="md" disabled={waiting} onClick={start}>
          {waiting ? t('正在读取…') : t('继续')}
        </Button>
      </div>
    </div>
  )
}
