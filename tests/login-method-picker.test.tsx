import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { LoginMethodPicker } from '../src/client/account-login/login-method-picker.tsx'
import { ProviderCards } from '../src/client/account-login/provider-cards.tsx'
import { LoginWindow } from '../src/client/account-login/login-window.tsx'
import { setLanguagePreference, t } from '../src/client/i18n.ts'
import { hostText } from '../src/client/operation-error.ts'
import { createAccountGuide } from '../src/host/account-guide/flows.ts'
import { codebuddyTrustRecorded, codebuddySitesRecorded, codebuddyChinaBrowserRecorded, traePersonalRecorded, traePatRecorded } from './fixtures/new-cli-login-recorded.ts'
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, ...props }: any) => createElement('button', props, children),
  Input: (props: any) => createElement('input', props), StateDot: () => null,
  IconCheckCircleFillRegular: () => null, IconCheckOutlineRegular: () => null, writeClipboard: vi.fn(),
}))
vi.mock('../src/client/icons.tsx', () => ({ BrandIcon: () => null }))
afterEach(() => setLanguagePreference('zh'))
it.each(['zh', 'en'] as const)('模拟：method choices and fixed flow copy render in %s', async language => {
  setLanguagePreference(language)
  const onStart = vi.fn(), onCancel = vi.fn()
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(createElement(LoginMethodPicker, { supported: true, onStart, onCancel,
    providers: [{ id: 'personal', label: '个人账号（依赖 TRAE CLI 开发中特性）' }, { id: 'enterprise', label: '企业 SSO' }, { id: 'enterprise-pat', label: '企业 PAT' }],
  })) })
  expect(JSON.stringify(renderer.toJSON())).toContain(t('选择登录方式'))
  expect(JSON.stringify(renderer.toJSON())).toContain(hostText('个人账号（依赖 TRAE CLI 开发中特性）'))
  if (language === 'en') expect(JSON.stringify(renderer.toJSON())).not.toMatch(/[\u4e00-\u9fff]/)
  const radios = renderer.root.findAllByProps({ role: 'radio' })
  const preventDefault = vi.fn()
  await act(async () => radios[0]!.props.onKeyDown({ key: 'ArrowRight', preventDefault, currentTarget: {} }))
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(renderer.root.findAllByProps({ role: 'radio' })[1]!.props['aria-checked']).toBe(true)
  expect(onStart).not.toHaveBeenCalled()
  await act(async () => renderer.root.findAllByType('button').find(button => button.children.includes(t('继续')))!.props.onClick())
  expect(onStart).toHaveBeenCalledExactlyOnceWith('enterprise')
  await act(async () => renderer.unmount())
  for (const [cli, provider, screen] of [['codebuddy', undefined, codebuddyTrustRecorded], ['codebuddy', undefined, codebuddySitesRecorded], ['codebuddy', undefined, codebuddyChinaBrowserRecorded], ['traecn', 'personal', traePersonalRecorded], ['traecn', 'enterprise-pat', traePatRecorded]] as const) {
    const guide = createAccountGuide(cli, 'login', { provider })!.output(screen).find(event => 'guide' in event)
    if (!guide || !('guide' in guide)) throw new Error('missing fixture guide')
    await act(async () => { renderer = create(createElement(LoginWindow, { cli, action: 'login', phase: 'running', guide: guide.guide,
      rawVisible: false, notice: '', onToggleRaw: vi.fn(), onRespond: vi.fn(), onRestart: vi.fn(), onDone: vi.fn(),
    })) })
    expect(JSON.stringify(renderer.toJSON())).toContain(hostText(guide.guide.text))
    if (language === 'en') expect(JSON.stringify(renderer.toJSON())).not.toMatch(/[\u4e00-\u9fff]/)
    await act(async () => renderer.unmount())
  }
})
it('模拟：stale or unsupported Host methods cannot start', async () => {
  const start = vi.fn()
  let renderer!: ReturnType<typeof create>
  const props = { onStart: start, onCancel: vi.fn(), supported: true, providers: [{ id: 'personal', label: '个人账号（依赖 TRAE CLI 开发中特性）' }] }
  await act(async () => { renderer = create(createElement(LoginMethodPicker, props)) })
  await act(async () => renderer.root.findByProps({ role: 'radio' }).props.onClick())
  await act(async () => renderer.update(createElement(LoginMethodPicker, { ...props, providers: [] })))
  const button = renderer.root.findAllByType('button').find(button => button.children.includes('继续'))!
  expect(button.props.disabled).toBe(true)
  await act(async () => button.props.onClick())
  expect(start).not.toHaveBeenCalled()
  await act(async () => renderer.unmount())
})
it('模拟：shared card keyboard moves focus with selection and wraps', async () => {
  const choose = vi.fn(), focus = vi.fn()
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(createElement(ProviderCards, { label: '模拟', chosen: 'first', onChoose: choose,
    choices: [{ id: 'first', name: 'First', label: 'First' }, { id: 'last', name: 'Last', label: 'Last' }],
  })) })
  renderer.root.findAllByProps({ role: 'radio' })[0]!.props.onKeyDown({ key: 'ArrowLeft', preventDefault: vi.fn(),
    currentTarget: { parentElement: { querySelectorAll: () => [{ focus: vi.fn() }, { focus }] } },
  })
  expect(choose).toHaveBeenCalledWith('last'); expect(focus).toHaveBeenCalledOnce()
  await act(async () => renderer.unmount())
})
