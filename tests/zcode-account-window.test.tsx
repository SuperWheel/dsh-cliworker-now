import { createElement, forwardRef } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { AccountsWindow } from '../src/client/account-login/accounts-window.tsx'
import { ProviderForm } from '../src/client/account-login/provider-form.tsx'
import type { AccountStatus } from '../src/shared/accounts.ts'
import type { CustomProviderForm } from '../src/shared/custom-provider.ts'

// Explicit simulation: no Host, CLI, provider or native terminal is involved. Every form, key and
// address below is a fixture value.
vi.mock('../src/client/account-terminal.tsx', () => ({
  AccountTerminal: (props: any) => createElement('synthetic-terminal', { action: props.action, provider: props.provider }),
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: forwardRef(({ children, variant, size, ...props }: any, ref) =>
    createElement('button', { type: 'button', ...props, 'data-variant': variant, 'data-size': size, ref }, children),
  ),
  Input: forwardRef(({ icon, className, ...props }: any, ref) =>
    createElement('span', { className }, icon, createElement('input', { ...props, ref })),
  ),
  Tooltip: ({ children }: any) => children,
  Menu: ({ anchor, open, items = [], onSelect }: any) =>
    createElement(
      'div',
      {},
      anchor,
      open &&
        createElement(
          'div',
          { role: 'menu' },
          items.map((item: any) => createElement('button', { key: item.id, role: 'menuitem', onClick: () => onSelect(item.id) }, item.label)),
        ),
    ),
  IconChevronDownOutlineRegular: () => null,
  IconEyeOutlineRegular: () => createElement('svg', { 'data-icon': 'eye' }),
  IconEyeOffOutlineRegular: () => createElement('svg', { 'data-icon': 'eye-off' }),
  IconInfoOutlineRegular: () => createElement('svg', { 'data-icon': 'info' }),
  IconPlusOutlineRegular: () => null,
  IconCheckCircleFillRegular: () => createElement('svg', { 'data-icon': 'success' }),
  IconCheckOutlineRegular: () => null,
  StateDot: () => null,
  writeClipboard: vi.fn(),
}))

const mounted: ReactTestRenderer[] = []
afterEach(async () => {
  await act(async () => {
    for (const r of mounted.splice(0)) r.unmount()
  })
  vi.restoreAllMocks()
})
const render = async (element: ReturnType<typeof createElement>) => {
  let r!: ReactTestRenderer
  await act(async () => {
    r = create(element)
    mounted.push(r)
  })
  return r
}
const text = (r: ReactTestRenderer) => JSON.stringify(r.toJSON())
const label = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : label(child))).join('')
const button = (r: ReactTestRenderer, name: string) =>
  r.root.findAllByType('button').find((item) => item.props['aria-label'] === name || label(item) === name)
const click = async (r: ReactTestRenderer, name: string) => {
  const target = button(r, name)
  if (!target) throw new Error(`no button ${name}`)
  await act(async () => target.props.onClick?.())
}
const input = (r: ReactTestRenderer, id: string) =>
  r.root.find((node) => (node.type === 'input' || node.type === 'textarea') && String(node.props.id ?? '').endsWith(`-${id}`))
const type = async (r: ReactTestRenderer, id: string, value: string) => {
  await act(async () => input(r, id).props.onChange({ target: { value } }))
}
const submit = async (r: ReactTestRenderer) => {
  await act(async () => r.root.findByType('form').props.onSubmit({ preventDefault() {} }))
}

const SECRET = 'SIMULATED-zcode-key-0000'
const zcodeForm: CustomProviderForm = {
  cli: 'zcode',
  title: '添加其他服务商',
  description: '模拟：ZCode 自己的 API Key',
  target: '/simulated/accounts/zcode/.zcode/v2/provider_config.json',
  nativeFallback: false,
  token: 'SIMULATED-TOKEN',
  fields: [
    { id: 'providerLabel', label: '名称', kind: 'text', required: true },
    { id: 'api', label: '接口类型', kind: 'select', required: true,
      options: [{ value: 'anthropic-messages', label: 'Anthropic Messages' }, { value: 'openai-chat-completions', label: 'OpenAI Chat Completions' }] },
    { id: 'baseUrl', label: 'Base URL', kind: 'url', required: true },
    { id: 'apiKey', label: 'API Key', kind: 'secret', required: true },
    { id: 'models', label: '模型 ID', kind: 'list', required: true },
    { id: 'contextWindow', label: '上下文窗口', kind: 'text' },
  ],
  presets: [
    { id: 'deepseek', label: 'DeepSeek', values: { providerLabel: 'DeepSeek', api: 'openai-chat-completions', baseUrl: 'https://deepseek.invalid/v1', models: 'ds-chat\nds-coder', apiKey: 'SHOULD-NOT-FILL' } },
    { id: 'broken' } as any,
  ],
}

it('模拟：a template prefills the public fields only and is not submitted', async () => {
  const submitForm = vi.fn(async () => ({ ok: true as const, title: '已添加 DeepSeek' }))
  const r = await render(createElement(ProviderForm, { form: zcodeForm, submit: submitForm, onBack: vi.fn(), onDone: vi.fn() }))
  expect(label(button(r, '从内置模板预填')!)).toBe('不使用模板')
  await click(r, '从内置模板预填')
  const items = r.root.findAllByProps({ role: 'menuitem' })
  expect(items.map(label)).toEqual(['DeepSeek'])
  await act(async () => items[0]!.props.onClick())
  expect(input(r, 'providerLabel').props.value).toBe('DeepSeek')
  expect(input(r, 'baseUrl').props.value).toBe('https://deepseek.invalid/v1')
  expect(input(r, 'models').props.value).toBe('ds-chat\nds-coder')
  expect(label(button(r, '接口类型')!)).toBe('OpenAI Chat Completions')
  expect(input(r, 'apiKey').props.value).toBe('')
  await type(r, 'providerLabel', 'My DeepSeek')
  await type(r, 'apiKey', SECRET)
  await act(async () => r.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  expect(submitForm.mock.calls[0]![0]).toEqual({
    providerLabel: 'My DeepSeek', api: 'openai-chat-completions', baseUrl: 'https://deepseek.invalid/v1', apiKey: SECRET, models: ['ds-chat', 'ds-coder'], contextWindow: '',
  })
})

it('模拟：no template picker when the Host sends none', async () => {
  const r = await render(createElement(ProviderForm, { form: { ...zcodeForm, presets: undefined }, submit: vi.fn(), onBack: vi.fn(), onDone: vi.fn() }))
  expect(button(r, '从内置模板预填')).toBeUndefined()
})

// ---- ZCode rows and 「其他服务商」 in the account window ----

const ok = (value: unknown) => ({ ok: true as const, value: typeof value === 'string' ? value : JSON.stringify(value) })
const MANAGED = 'zcode:22222222-2222-4222-8222-222222222222:plugin.config'
const zcodeStatus: AccountStatus = {
  cli: 'zcode',
  installed: true,
  state: 'configured',
  authMethod: 'api',
  summary: '已配置 ZCode API；模拟：订阅已过期',
  logins: [
    { providerLabel: 'Desktop Provider', authMethod: 'api', source: 'native' },
    { providerLabel: 'My Gateway', authMethod: 'api', source: 'plugin', id: MANAGED, managedConfiguration: true },
  ],
  actions: [{ id: 'login', label: '', description: '', providers: [{ id: 'zhipu', label: 'BigModel' }, { id: 'zai', label: 'Z.AI' }] }],
}
async function openZCode(cliworker: Record<string, unknown>, status: AccountStatus = zcodeStatus) {
  const props = {
    api: { cliworker } as any,
    sessionId: 'SIMULATED-PARENT',
    cli: 'zcode' as const,
    status,
    closeControl: { current: undefined },
    onRefresh: vi.fn(),
    onClose: vi.fn(),
  }
  return { r: await render(createElement(AccountsWindow, props)), props }
}
const card = (r: ReactTestRenderer, title: string) =>
  r.root.findAll((node) => node.type === 'li' && node.props.className === 'cwn-accounts-card').find((node) => label(node).includes(title))!

it('模拟：ZCode Desktop providers are read-only; plugin-created ones are deleted in place', async () => {
  const deleteAccountConfiguration = vi.fn(async (..._args: unknown[]) => ok({ ok: true }))
  const { r, props } = await openZCode({ deleteAccountConfiguration })
  const desktop = card(r, 'Desktop Provider')
  expect(label(desktop)).toContain('在 ZCode 桌面端管理')
  expect(desktop.findAllByType('button')).toHaveLength(0)
  const mine = card(r, 'My Gateway')
  const remove = mine.findAllByType('button').find((item) => label(item) === '删除')!
  await act(async () => remove.props.onClick())
  expect(text(r)).toContain('将删除插件目录中此服务商的配置和 API Key，ZCode 桌面端的配置不受影响。')
  await click(r, '确认删除')
  expect(deleteAccountConfiguration).toHaveBeenCalledWith('SIMULATED-PARENT', 'zcode', MANAGED, expect.any(AbortSignal))
  expect(props.onRefresh).toHaveBeenCalled()
  expect(r.root.findAllByType('synthetic-terminal')).toHaveLength(0)
})

it('模拟：the signed-in subscription row keeps the guided sign-out', async () => {
  const status: AccountStatus = {
    ...zcodeStatus, state: 'authenticated', authMethod: 'oauth',
    logins: [{ providerLabel: 'BigModel / Z.AI', authMethod: 'oauth', source: 'plugin' }, ...zcodeStatus.logins!],
  }
  const deleteAccountConfiguration = vi.fn()
  const { r } = await openZCode({ deleteAccountConfiguration }, status)
  const subscription = card(r, 'BigModel / Z.AI')
  await act(async () => subscription.findAllByType('button').find((item) => label(item) === '退出')!.props.onClick())
  expect(text(r)).toContain('BigModel 和 Z.AI 的登录会一起退出。')
  await click(r, '确认退出')
  expect(deleteAccountConfiguration).not.toHaveBeenCalled()
  expect(r.root.findByType('synthetic-terminal').props).toMatchObject({ action: 'logout' })
})

it('模拟：「其他服务商」 opens the Host form for ZCode, and older Hosts keep only the two providers', async () => {
  const older = await openZCode({})
  await click(older.r, '添加账号')
  expect(older.r.root.findAllByProps({ role: 'radio' }).map((item) => item.props['aria-label'])).toEqual(['BigModel', 'Z.AI'])

  const customProviderForm = vi.fn(async () => ok(zcodeForm))
  const { r } = await openZCode({ customProviderForm })
  await click(r, '添加账号')
  expect(customProviderForm).toHaveBeenCalledWith('SIMULATED-PARENT', 'zcode', expect.any(AbortSignal))
  const other = r.root.findAllByProps({ role: 'radio' }).at(-1)!
  expect(other.props['aria-label']).toBe('其他服务商（在本窗口中填写配置）')
  await act(async () => other.props.onClick())
  await click(r, '继续')
  expect(r.root.findAllByType('form')).toHaveLength(1)
  expect(button(r, '在原生终端中配置')).toBeUndefined()
})

it('模拟：a Host without a ZCode form shows no 「其他服务商」 card', async () => {
  const { r } = await openZCode({ customProviderForm: vi.fn(async () => ok('null')) })
  await click(r, '添加账号')
  expect(r.root.findAllByProps({ role: 'radio' }).map((item) => item.props['aria-label'])).toEqual(['BigModel', 'Z.AI'])
})
