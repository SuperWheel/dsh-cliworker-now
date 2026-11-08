import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountFrame, AccountStatus } from '../../shared/accounts.ts'
import type { CliId } from '../../shared/types.ts'
import { value, type API } from '../workers.ts'
import type { AccountCloseControl } from '../account-terminal.tsx'
import { t, useT } from '../i18n.ts'
import { hostText } from '../operation-error.ts'
import { en } from '../i18n-messages.ts'

/** Only fixed, translated Host reasons are shown; any other error text stays generic. */
function knownHostReason(reason: unknown): string | undefined {
  const raw = String((reason as { message?: unknown })?.message ?? reason)
    .replace(/^.*cliworker\/unavailable[^:]*:\s*/, '').replace(/^(?:(?:[A-Za-z_$][\w$]*Error|Error):\s*)+/, '').trim()
  return Object.hasOwn(en, raw) ? raw : undefined
}
import { CurrentAccount, LoginWindow } from './login-window.tsx'

/** Desktop-owned accounts never construct a terminal or enter the automatic logout flow. */
export function WorkBuddyDesktopWindow({ api, sessionId, cli, account, closeControl, onClose }: {
  api: API; sessionId: string; cli: CliId; account?: AccountStatus; closeControl?: AccountCloseControl; onClose: () => void
}) {
  useT()
  const [frame, setFrame] = useState<AccountFrame>()
  const [pending, setPending] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const respond = useRef<(action: string) => void>(() => {})
  const retry = useRef<() => void>(() => {})
  const stop = useRef<() => Promise<boolean>>(async () => false)
  const close = useRef(onClose); close.current = onClose
  useEffect(() => {
    const remote = api.cliworker
    if (!remote.accountDesktopStart || !remote.accountDesktopWatch || !remote.accountDesktopRespond || !remote.accountDesktopStop) {
      setPending(false); setError(t('在 WorkBuddy 桌面端管理'))
      stop.current = async () => { close.current(); return true }
      if (closeControl) closeControl.current = stop.current
      return () => { if (closeControl) closeControl.current = undefined }
    }
    let alive = true, id: string | undefined, sequence = -1, stopping: Promise<boolean> | undefined
    let stream: ReturnType<API['$stream']> | undefined
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 35_000)
    setFrame(undefined); setPending(true); setError('')
    const apply = (next: AccountFrame) => {
      if (alive && next.seq > sequence) {
        sequence = next.seq
        // A final cleanup-only frame must not replace a confirmed result with a spinner.
        setFrame(previous => ({ ...previous, ...next,
          guide: next.guide ?? previous?.guide, desktop: next.desktop ?? previous?.desktop }))
      }
    }
    const startup = (async () => {
      const started = JSON.parse(value(await remote.accountDesktopStart!(sessionId, cli, controller.signal))) as { id: string; frame: AccountFrame }
      id = started.id
      if (!alive || controller.signal.aborted) { value(await remote.accountDesktopStop!(sessionId, id)); return }
      apply(started.frame)
      stream = api.$stream<string>({ name: 'WorkBuddy desktop account',
        open: signal => remote.accountDesktopWatch!(sessionId, id!, signal), ended: () => new Error('desktop guide ended') })
      void (async () => {
        try {
          for await (const item of stream!) { apply(JSON.parse(item.value as string)); item.accept() }
        } catch {
          if (alive && !controller.signal.aborted) setError(t('桌面管理暂不可用，请关闭后重试。'))
        }
      })()
    })().catch((reason: unknown) => {
      if (alive) {
        // Show the Host's reason (for example a status read still running) instead of a generic failure.
        const message = controller.signal.aborted ? '' : knownHostReason(reason) ?? ''
        setError(message ? hostText(message) : t('桌面管理暂不可用，请关闭后重试。'))
        setFrame({ seq: 0, status: 'failed', guide: { step: 'desktop', template: 'result', tone: 'warning',
          text: message || '桌面管理暂不可用，请关闭后重试。' } })
      }
    })
      .finally(() => { clearTimeout(timer); if (alive) setPending(false) })
    const cleanup = () => stopping ??= (async () => {
      controller.abort(); clearTimeout(timer)
      try {
        await startup
        if (id) value(await remote.accountDesktopStop!(sessionId, id))
        await stream?.dispose()
        return true
      } catch {
        if (alive) { setError(t('账号查询未能确认进程已退出，已暂停此 CLI')); setPending(false) }
        stopping = undefined
        return false
      }
    })()
    retry.current = () => { void cleanup().then(ok => { if (ok && alive) setAttempt(n => n + 1) }) }
    stop.current = async () => {
      setPending(true)
      const ok = await cleanup()
      if (ok && alive) close.current()
      return ok
    }
    if (closeControl) closeControl.current = stop.current
    respond.current = action => {
      if (!id || controller.signal.aborted) return
      setPending(true); setError('')
      void remote.accountDesktopRespond!(sessionId, id, action).then(value)
        .catch(() => { if (alive) setError(t('桌面管理暂不可用，请关闭后重试。')) })
        .finally(() => { if (alive) setPending(false) })
    }
    return () => {
      alive = false
      if (closeControl) closeControl.current = undefined
      void cleanup()
    }
  }, [api, sessionId, cli, attempt, closeControl])
  const current = frame?.desktop?.account ?? account
  const supported = !!(api.cliworker.accountDesktopStart && api.cliworker.accountDesktopWatch && api.cliworker.accountDesktopRespond && api.cliworker.accountDesktopStop)
  return <>
    <LoginWindow cli={cli} action="manage" phase={pending ? 'loading' : 'running'} guide={supported ? frame?.guide : {
      step: 'desktop', template: 'choice', tone: 'info', text: '登录、退出或切换请在桌面端完成。',
    }}
      notice={error || t(frame?.desktop?.observing ? '正在观察桌面端登录状态' : '自动观察已暂停')}
      header={current?.state === 'authenticated' ? <CurrentAccount cli={cli} account={current}
        description={t('登录、退出或切换请在桌面端完成。')} actions={<></>} onClose={() => void stop.current()} /> : undefined}
      desktopActions={<div className="cwn-login-actions">
        <Button variant="ghost" size="sm" onClick={() => void stop.current()}>{t('关闭')}</Button>
        {supported && <>
          <Button variant="ghost" size="sm" disabled={pending || frame?.status === 'failed'} onClick={() => respond.current('refresh')}>{t('刷新状态')}</Button>
          {!frame?.desktop?.observing && <Button variant="ghost" size="sm" disabled={pending || frame?.status === 'failed'} onClick={() => respond.current('continue')}>{t('继续观察')}</Button>}
          <Button variant="outline" size="sm" disabled={pending || frame?.status === 'failed'} onClick={() => respond.current('open')}>{t('打开桌面端')}</Button>
        </>}
      </div>}
      resultDetail={t('登录、退出或切换请在桌面端完成。')}
      onRespond={() => {}} onRestart={() => retry.current()}
      onDone={() => void stop.current()} />
  </>
}
