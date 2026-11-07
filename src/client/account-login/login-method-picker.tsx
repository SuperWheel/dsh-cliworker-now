import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountProvider } from '../../shared/accounts.ts'
import { useT } from '../i18n.ts'
import { hostText } from '../operation-error.ts'
import { ProviderCards } from './provider-cards.tsx'

/** Host-supplied methods only; cancelling or choosing a card never starts a terminal. */
export function LoginMethodPicker({ providers, supported, onCancel, onStart }: {
  providers?: AccountProvider[]
  supported: boolean
  onCancel: () => void
  onStart: (provider: string) => void
}) {
  const t = useT()
  const [chosen, setChosen] = useState<string>()
  const selected = providers?.find(item => item.id === chosen)
  return <div className="cwn-accounts-window">
    <div className="cwn-accounts-lead">
      <strong>{t('选择登录方式')}</strong>
      <span>{t('个人登录依赖 TRAE CLI 开发中特性；企业 SSO 和 PAT 在原生流程中完成。')}</span>
    </div>
    <ProviderCards label={t('选择登录方式')} chosen={chosen} onChoose={setChosen}
      choices={(providers ?? []).map(item => ({ id: item.id, name: hostText(item.label), label: hostText(item.label) }))} />
    {(!supported || !providers?.length) && <p className="cwn-login-callout" data-tone="warning" role="status">
      {t('当前插件 Host 未提供登录方式选择，请更新插件或刷新账号状态。')}
    </p>}
    <div className="cwn-accounts-actions">
      <Button variant="ghost" size="md" onClick={onCancel}>{t('返回')}</Button>
      <Button variant="primary" size="md" disabled={!supported || !selected}
        onClick={() => { if (supported && selected) onStart(selected.id) }}>{t('继续')}</Button>
    </div>
  </div>
}
