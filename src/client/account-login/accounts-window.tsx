import { useEffect, useRef, useState } from 'react'
import { Button, IconPlusOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountLogin, AccountProvider, AccountSource, AccountStatus } from '../../shared/accounts.ts'
import { GUIDED_ACCOUNT_CLIS, parseAccountLoginId } from '../../shared/account-links.ts'
import { CLI_LABELS, type CliId } from '../../shared/types.ts'
import { AccountTerminal, type AccountCloseControl } from '../account-terminal.tsx'
import { t, useT } from '../i18n.ts'
import { hostText } from '../operation-error.ts'
import type { API } from '../workers.ts'

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
}: {
  api: API
  sessionId: string
  cli: CliId
  status?: AccountStatus
  closeControl: AccountCloseControl
  onRefresh: () => void
  onClose: () => void
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
  const closingAll = useRef(false)
  const terminalClose: AccountCloseControl = useRef<(() => Promise<boolean>) | undefined>(undefined)
  // The dialog's close button ends a running window first, then the whole dialog.
  useEffect(() => {
    const request = async () => {
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
        cli={cli}
        providers={providers}
        logins={logins}
        onCancel={() => setAdding(false)}
        onStart={(next) => setRequest(next)}
      />
    )

  const signOut = (login: AccountLogin) => {
    if (login.id)
      return setRequest({
        action: 'logout',
        login: login.id,
        title: t('退出 {account}', { account: loginText(login) }),
      })
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
  // A key from an environment variable or a config file is not a stored login: nothing to sign out here.
  const configOnly = (login: AccountLogin) =>
    !login.id && !login.source && !whole && (cli === 'pi' || cli === 'omp')
  const card = ({ login, index }: { login: AccountLogin; index: number }) => {
    const removable = !!login.id || GUIDED_ACCOUNT_CLIS.has(cli)
    const title = whole ? t('当前账号') : hostText(login.providerLabel)
    const meta = [
      login.authMethod === 'api' ? 'API Key' : t('账号登录'),
      credentialNumber(login) ? t('凭据 #{id}', { id: credentialNumber(login)! }) : undefined,
      login.authMethod === 'oauth' ? login.accountLabel : undefined,
      configOnly(login) ? t('在原配置中管理') : undefined,
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
              <Button variant="ghost" size="md" onClick={() => setConfirming(index)}>
                {t('退出')}
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
          <div className="cwn-accounts-confirm" role="group" aria-label={t('确认退出')}>
            <span>
              {cli === 'zcode' && !login.id
                ? t('BigModel 和 Z.AI 的登录会一起退出。')
                : t('退出后会删除这条凭据，其他账号保留。')}
            </span>
            <div className="cwn-login-actions">
              <Button variant="ghost" size="md" onClick={() => setConfirming(undefined)}>
                {t('取消')}
              </Button>
              <Button variant="primary" size="md" onClick={() => signOut(login)}>
                {t('确认退出')}
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
        {!providers?.length && <span className="cwn-login-hint">{t('在原生终端中选择服务商并登录。')}</span>}
        <Button
          variant="outline"
          size="md"
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

function AddAccount({
  cli,
  providers,
  logins,
  onCancel,
  onStart,
}: {
  cli: CliId
  providers: AccountProvider[] | undefined
  logins: AccountLogin[]
  onCancel: () => void
  onStart: (request: Request) => void
}) {
  const name = CLI_LABELS[cli]
  const list = providers ?? []
  const [chosen, setChosen] = useState(list[0]?.id ?? NATIVE)
  const [replace, setReplace] = useState<string>()
  const provider = list.find((item) => item.id === chosen)
  // Hermes keeps several keys of one provider: add another, or replace one of them.
  const held = provider?.multi
    ? logins.filter((login) => login.id && parseAccountLoginId(login.id)?.provider === provider.id)
    : []
  useEffect(() => setReplace(undefined), [chosen])
  const choices = [
    ...list.map((item) => ({
      id: item.id,
      name: hostText(item.label),
      label: item.signedIn ? t('{provider}（已登录）', { provider: hostText(item.label) }) : hostText(item.label),
      note: item.signedIn ? t('已登录') : undefined,
    })),
    // ZCode has only its two providers; other CLIs keep their own full picker.
    ...(cli === 'zcode'
      ? []
      : [
          {
            id: NATIVE,
            name: t('其他服务商'),
            label: t('其他服务商（在原生终端中选择）'),
            note: t('在原生终端中选择'),
          },
        ]),
  ]
  const start = () => {
    if (!provider) return onStart({ action: 'login', title: t('在原生终端中添加 {cli} 账号', { cli: name }) })
    onStart({
      action: 'login',
      provider: provider.id,
      ...(replace ? { replaces: replace } : {}),
      title: t('登录到 {provider}', { provider: hostText(provider.label) }),
    })
  }
  return (
    <div className="cwn-accounts-window">
      <div className="cwn-accounts-lead">
        <strong>{t('选择要登录的服务商')}</strong>
        <span>
          {provider
            ? t('在本窗口中完成授权或填写 API Key，原生终端在后台运行。')
            : t('在原生终端中选择服务商并登录。')}
        </span>
      </div>
      <div className="cwn-accounts-providers" role="radiogroup" aria-label={t('登录到')}>
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            role="radio"
            aria-checked={chosen === choice.id}
            aria-label={choice.label}
            title={choice.name}
            className="cwn-accounts-provider"
            data-selected={chosen === choice.id || undefined}
            onClick={() => setChosen(choice.id)}
          >
            <span className="cwn-accounts-mark" aria-hidden="true">
              {choice.id === NATIVE ? '…' : choice.name.trim().charAt(0).toUpperCase()}
            </span>
            <span className="cwn-accounts-provider-text">
              <strong>{choice.name}</strong>
              {choice.note && <span data-signed-in={choice.id !== NATIVE || undefined}>{choice.note}</span>}
            </span>
          </button>
        ))}
      </div>
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
        <Button variant="primary" size="md" onClick={start}>
          {t('继续')}
        </Button>
      </div>
    </div>
  )
}
