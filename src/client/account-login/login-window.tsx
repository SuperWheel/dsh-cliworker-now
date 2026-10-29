import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  IconCheckCircleFillRegular,
  IconCheckOutlineRegular,
  Input,
  StateDot,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountAction, AccountGuide, AccountResponse, AccountStatus } from '../../shared/accounts.ts'
import { ACCOUNT_LOGIN_HOSTS, allowedLink } from '../../shared/account-links.ts'
import { CLI_LABELS, type CliId } from '../../shared/types.ts'
import { t, useT } from '../i18n.ts'
import { BrandIcon } from '../icons.tsx'
import { hostText } from '../operation-error.ts'

const MAX_ANSWER_LENGTH = 4096

export type LoginPhase = 'loading' | 'running' | 'closed' | 'failed' | 'stopping'
type StepState = 'pending' | 'active' | 'done'

/** The only addresses a window may open: the CLI's own sign-in pages, checked again here. */
export function loginLink(cli: CliId, value: string | undefined): string | undefined {
  return allowedLink(value, ACCOUNT_LOGIN_HOSTS[cli])
}

function Step({ index, state, title, children }: { index: number; state: StepState; title: string; children?: ReactNode }) {
  return (
    <li className="cwn-login-step" data-state={state} aria-current={state === 'active' ? 'step' : undefined}>
      <span className="cwn-login-step-mark" aria-hidden="true">
        {state === 'done' ? <IconCheckOutlineRegular size={14} /> : index}
      </span>
      <div className="cwn-login-step-main">
        <span className="cwn-login-step-title">{title}</span>
        {state === 'active' && children && <div className="cwn-login-step-body">{children}</div>}
      </div>
    </li>
  )
}

function Result({ tone, title, detail, children }: { tone: AccountGuide['tone']; title: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="cwn-login-result" data-tone={tone} role="status" aria-live="polite">
      {tone === 'success' && <IconCheckCircleFillRegular size={40} className="cwn-login-result-icon" />}
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
      {children && <div className="cwn-login-actions">{children}</div>}
    </div>
  )
}

function CurrentAccount({
  cli,
  account,
  onSwitch,
  onClose,
}: {
  cli: CliId
  account?: AccountStatus
  onSwitch?: () => void
  onClose: () => void
}) {
  const name = CLI_LABELS[cli]
  const only = account?.logins?.length === 1 ? account.logins[0] : undefined
  const method = account?.authMethod ?? only?.authMethod
  const email = account?.accountLabel ?? (only?.authMethod === 'oauth' ? only.accountLabel : undefined)
  const meta = [method === 'api' ? 'API Key' : method ? t('账号登录') : undefined, email]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="cwn-accounts-window" role="status" aria-live="polite">
      <div className="cwn-accounts-lead">
        <strong>{t('当前已登录 {cli}', { cli: name })}</strong>
        <span>
          {onSwitch
            ? t('切换账号会先退出当前账号，确认退出后再登录新账号。')
            : t('如需切换账号，请先退出登录。')}
        </span>
      </div>
      <ul className="cwn-accounts-list" aria-label={t('当前账号')}>
        <li className="cwn-accounts-card">
          <div className="cwn-accounts-card-main">
            <span className="cwn-accounts-mark" aria-hidden="true">
              <BrandIcon cli={cli} size={20} />
            </span>
            <div className="cwn-accounts-row-text">
              <strong>{only?.providerLabel ?? name}</strong>
              <span>{meta}</span>
            </div>
            <span className="cwn-accounts-state">{t('已登录')}</span>
          </div>
        </li>
      </ul>
      <div className="cwn-accounts-actions">
        {onSwitch ? (
          <>
            <Button variant="ghost" size="md" onClick={onClose}>
              {t('关闭')}
            </Button>
            <Button variant="primary" size="md" onClick={onSwitch}>
              {t('切换账号')}
            </Button>
          </>
        ) : (
          <Button variant="primary" size="md" onClick={onClose}>
            {t('关闭')}
          </Button>
        )}
      </div>
    </div>
  )
}

export function Waiting({ text }: { text: string }) {
  return (
    <div className="cwn-login-waiting" role="status">
      <StateDot state="ongoing" size={14} />
      {text}
    </div>
  )
}

function LinkActions({ link, onOpen }: { link?: string; onOpen: (url: string) => void }) {
  const [copied, setCopied] = useState(false)
  if (!link) return null
  return (
    <div className="cwn-login-actions">
      <Button variant="outline" size="sm" onClick={() => onOpen(link)}>
        {t('重新打开登录页面')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void writeClipboard(link).then((ok) => setCopied(!!ok), () => setCopied(false))}
      >
        {copied ? t('已复制链接') : t('复制登录链接')}
      </Button>
    </div>
  )
}

/** Antigravity's own terms pages, fixed plugin text rather than CLI output. */
const AGY_TERMS = [
  { label: '服务条款', url: 'https://antigravity.google/terms' },
  { label: '隐私政策', url: 'https://policies.google.com/privacy' },
] as const

/** A CLI's terms: the user agrees here; sharing data with the CLI's maker stays off unless ticked. */
function TermsAnswer({
  text,
  running,
  onAgree,
  onCancel,
}: {
  text: string
  running: boolean
  onAgree: (share: boolean) => void
  onCancel: () => void
}) {
  const [share, setShare] = useState(false)
  return (
    <>
      <p>{text}</p>
      <div className="cwn-login-actions">
        {AGY_TERMS.map((page) => (
          <Button key={page.url} variant="ghost" size="sm" onClick={() => window.open(page.url, '_blank', 'noopener,noreferrer')}>
            {t(page.label)}
          </Button>
        ))}
      </div>
      <label className="cwn-login-check">
        <input type="checkbox" checked={share} disabled={!running} onChange={(event) => setShare(event.target.checked)} />
        <span>{t('允许 Google 收集我的交互数据，用于改进 Antigravity CLI（之后可在 Antigravity 设置中关闭）')}</span>
      </label>
      <div className="cwn-login-actions">
        <Button variant="primary" size="md" disabled={!running} onClick={() => onAgree(share)}>
          {t('同意并继续')}
        </Button>
        <Button variant="ghost" size="md" onClick={onCancel}>
          {t('取消')}
        </Button>
      </div>
    </>
  )
}

/** One pasted value: an authorization code (shown) or a key (masked, cleared on submit). */
function AnswerForm({
  kind,
  running,
  retry,
  onSubmit,
  onRestart,
}: {
  kind: 'code' | 'secret'
  running: boolean
  retry: boolean
  onSubmit: (value: string) => void
  onRestart: () => void
}) {
  const [value, setValue] = useState('')
  const [pasted, setPasted] = useState(false)
  useEffect(() => {
    if (!retry) return
    setValue('')
    setPasted(false)
  }, [retry])
  const content = value.replace(/[\r\n]/g, '').trim()
  const label = kind === 'code' ? t('授权码') : t('API 密钥')
  return (
    <form
      className="cwn-login-code"
      onSubmit={(event) => {
        event.preventDefault()
        if (!content || !running) return
        onSubmit(content)
        if (kind === 'secret') setValue('')
      }}
    >
      <Input
        autoFocus
        type={kind === 'secret' ? 'password' : 'text'}
        value={value}
        maxLength={MAX_ANSWER_LENGTH}
        spellCheck={false}
        autoComplete="off"
        aria-label={label}
        placeholder={kind === 'code' ? t('在这里粘贴授权码（⌘V / Ctrl+V）') : t('在这里粘贴 API Key（⌘V / Ctrl+V）')}
        disabled={!running}
        onPaste={() => setPasted(true)}
        onChange={(event) => {
          setValue(event.target.value)
          if (!event.target.value) setPasted(false)
        }}
      />
      {content ? (
        <p className="cwn-login-callout" data-tone="success" role="status">
          <IconCheckCircleFillRegular size={16} />
          <span>
            {kind === 'code' ? (pasted ? t('授权码已粘贴。') : t('已输入授权码。')) : pasted ? t('API Key 已粘贴。') : t('已输入 API Key。')}
            <strong>{t('按回车键完成登录')}</strong>
          </span>
        </p>
      ) : (
        <p className="cwn-login-hint">{t('粘贴后按回车键，或点击「完成登录」。')}</p>
      )}
      <div className="cwn-login-actions">
        <Button type="submit" variant="primary" size="md" disabled={!running || !content}>
          {t('完成登录')}
        </Button>
        {retry && (
          <Button type="button" variant="outline" size="md" onClick={onRestart}>
            {t('重新开始登录')}
          </Button>
        )}
      </div>
    </form>
  )
}

function DeviceCode({ code, link, onOpen }: { code?: string; link?: string; onOpen: (url: string) => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <>
      {code && (
        <div className="cwn-login-device">
          <code aria-label={t('验证码')}>{code}</code>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void writeClipboard(code).then((ok) => setCopied(!!ok), () => setCopied(false))}
          >
            {copied ? t('已复制') : t('复制验证码')}
          </Button>
        </div>
      )}
      {link && (
        <div className="cwn-login-actions">
          <Button variant="primary" size="md" onClick={() => onOpen(link)}>
            {t('打开验证页面')}
          </Button>
        </div>
      )}
      <Waiting text={t('等待你在浏览器中确认…')} />
    </>
  )
}

/**
 * A sign-in or sign-out window drawn by the plugin from Host-authored steps.
 * The native terminal runs behind it; every key it receives answers a choice made here.
 */
export function LoginWindow({
  cli,
  action,
  phase,
  guide,
  rawVisible,
  notice,
  header,
  onToggleRaw,
  onRespond,
  onRestart,
  onDone,
  onSwitchAccount,
  account,
}: {
  cli: CliId
  action: AccountAction
  phase: LoginPhase
  guide?: AccountGuide
  rawVisible: boolean
  /** A short terminal status from the Host or the terminal shell, shown beside the toggle. */
  notice?: string
  /** Shown above the steps, e.g. the provider picker. */
  header?: ReactNode
  onToggleRaw: () => void
  onRespond: (response: AccountResponse) => void
  onRestart: () => void
  onDone: () => void
  onSwitchAccount?: () => void
  /** The account a single-account CLI holds, shown before switching. */
  account?: AccountStatus
}) {
  useT()
  const [submitted, setSubmitted] = useState(false)
  const lastStep = useRef<string>()
  const step = guide?.step
  useEffect(() => {
    // A new step from the Host takes the place of the pending answer.
    if (step !== lastStep.current) setSubmitted(false)
    lastStep.current = step
  }, [step, guide])

  const running = phase === 'running'
  const ended = phase === 'failed' || phase === 'closed'
  const name = CLI_LABELS[cli]
  const link = loginLink(cli, guide?.link)
  const open = (url: string) => {
    const safe = loginLink(cli, url)
    // Harness routes HTTP(S) new-window requests to the native browser.
    if (safe) window.open(safe, '_blank', 'noopener,noreferrer')
  }
  const respond = (response: AccountResponse) => {
    if (!running) return
    if (!('option' in response)) setSubmitted(true)
    onRespond(response)
  }
  const foot = (
    <div className="cwn-login-foot">
      {/* A finished window shows its result only; a late terminal status would contradict it. */}
      <span className="cwn-login-notice" role="status">
        {guide?.template === 'result' ? undefined : notice}
      </span>
      <Button variant="ghost" size="sm" onClick={onToggleRaw}>
        {rawVisible ? t('隐藏原生终端') : t('显示原生终端')}
      </Button>
    </div>
  )
  const frame = (body: ReactNode) => (
    <div className="cwn-login-window">
      {header}
      {body}
      {foot}
    </div>
  )

  // Nothing runs yet: the current account as a card, like the 「账号」 window.
  if (step === 'alreadySignedIn')
    return <CurrentAccount cli={cli} account={account} onSwitch={onSwitchAccount} onClose={onDone} />

  if (guide?.template === 'result') {
    const detail =
      step === 'signedIn'
        ? t('现在可以派遣 {cli} 任务了。', { cli: name })
        : step === 'loggedOut'
          ? t('需要时可在设置中重新登录。')
          : undefined
    const buttons =
      guide.tone === 'warning' ? (
        <Button variant="outline" size="md" onClick={onRestart}>
          {t('重试')}
        </Button>
      ) : (
        <Button variant="primary" size="md" onClick={onDone}>
          {t('完成')}
        </Button>
      )
    return frame(
      <Result tone={guide.tone} title={hostText(guide.text)} detail={detail}>
        {buttons}
      </Result>,
    )
  }

  const body = (template = guide?.template): ReactNode => {
    if (!guide || template === 'starting')
      return ended ? null : <Waiting text={guide ? hostText(guide.text) : t('正在启动 {cli}…', { cli: name })} />
    if (submitted && template !== 'choice' && template !== 'trust' && template !== 'terms')
      return <Waiting text={t('正在确认登录…')} />
    switch (template) {
      case 'trust':
        return (
          <>
            <p>{hostText(guide.text)}</p>
            <div className="cwn-login-actions">
              <Button variant="primary" size="md" disabled={!running} onClick={() => respond({ confirm: 'trust' })}>
                {t('信任并继续')}
              </Button>
              <Button variant="ghost" size="md" onClick={onDone}>
                {t('取消')}
              </Button>
            </div>
          </>
        )
      case 'terms':
        return (
          <TermsAnswer
            text={hostText(guide.text)}
            running={running}
            onAgree={(share) => respond({ agree: 'terms', share })}
            onCancel={onDone}
          />
        )
      case 'choice':
        return (
          <>
            <p>{hostText(guide.text)}</p>
            <div className="cwn-login-actions">
              {guide.options?.map((option, index) => (
                <Button
                  key={option.id}
                  variant={index === 0 ? 'primary' : 'outline'}
                  size="md"
                  disabled={!running}
                  onClick={() => respond({ option: option.id })}
                >
                  {hostText(option.label)}
                </Button>
              ))}
            </div>
            {guide.options?.map(
              (option) =>
                option.detail && (
                  <p key={option.id} className="cwn-login-hint">
                    {hostText(option.detail)}
                  </p>
                ),
            )}
          </>
        )
      case 'browser':
        return (
          <>
            <p>{hostText(guide.text)}</p>
            <LinkActions link={link} onOpen={open} />
            <Waiting text={t('等待浏览器完成授权…')} />
          </>
        )
      case 'deviceCode':
        return (
          <>
            <p>{hostText(guide.text)}</p>
            <DeviceCode code={guide.code} link={link} onOpen={open} />
          </>
        )
      case 'secret':
      case 'browserCode':
        return (
          <>
            {guide.tone === 'warning' ? (
              <p className="cwn-login-callout" data-tone="warning" role="alert">
                {hostText(guide.text)}
              </p>
            ) : (
              template === 'secret' && <p>{hostText(guide.text)}</p>
            )}
            <AnswerForm
              kind={template === 'secret' ? 'secret' : 'code'}
              running={running}
              retry={guide.tone === 'warning'}
              onSubmit={(value) => respond(template === 'secret' ? { secret: value } : { code: value })}
              onRestart={onRestart}
            />
          </>
        )
      case 'native':
        return (
          <>
            <p className="cwn-login-callout" data-tone="warning" role="status">
              {hostText(guide.text)}
            </p>
            {action === 'logout' && !rawVisible && (
              <p className="cwn-login-hint">{t('请点击「显示原生终端」，在 CLI 原生菜单中继续退出。')}</p>
            )}
          </>
        )
      default:
        return <Waiting text={hostText(guide.text)} />
    }
  }

  const plan = action === 'login' ? guide?.plan : undefined
  const stage = guide?.stage ?? 0
  let content: ReactNode
  if (plan?.length) {
    // A pasted code belongs to the step after the browser one when the plan has it.
    const split = guide?.template === 'browserCode' && stage + 1 < plan.length
    const confirming = submitted || guide?.template === 'waiting'
    content = (
      <ol className="cwn-login-steps">
        {plan.map((title, index) => {
          const active = index === stage || (split && index === stage + 1)
          const state: StepState = index < stage || (split && confirming && index === stage) ? 'done' : active ? 'active' : 'pending'
          let children: ReactNode = null
          if (state === 'active')
            children =
              split && index === stage ? (
                <>
                  <p>{guide.tone === 'warning' ? t('请重新在浏览器中授权，复制新的授权码。') : hostText(guide.text)}</p>
                  <LinkActions link={link} onOpen={open} />
                </>
              ) : (
                body()
              )
          return (
            <Step key={title} index={index + 1} state={state} title={hostText(title)}>
              {children}
            </Step>
          )
        })}
      </ol>
    )
  } else content = body()
  return frame(
    <>
      {content}
      {ended && (
        <p className="cwn-login-callout" data-tone="warning" role="alert">
          {action === 'logout' ? t('原生终端已关闭，请重试。') : t('登录窗口已结束。')}
          <Button variant="ghost" size="sm" onClick={onRestart}>
            {action === 'logout' ? t('重试') : t('重新开始登录')}
          </Button>
        </p>
      )}
    </>,
  )
}
