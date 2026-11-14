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

const SECRET = 'sk-SIMULATED-0000'
const form: CustomProviderForm = {
  cli: 'pi',
  title: '添加其他服务商',
  description: '模拟：OpenAI 兼容服务商',
  target: '~/.pi/agent/models.json',
  nativeFallback: true,
  token: 'SIMULATED-TOKEN',
  fields: [
    { id: 'name', label: '名称', kind: 'text', required: true, placeholder: '例如 my-provider', help: '模拟说明：只用于区分服务商' },
    { id: 'baseUrl', label: 'Base URL', kind: 'url', required: true, placeholder: 'https://example.invalid/v1' },
    { id: 'api', label: 'API 协议', kind: 'select', required: true, defaultValue: 'openai-completions',
      options: [{ value: 'openai-completions', label: 'OpenAI Completions' }, { value: 'anthropic-messages', label: 'Anthropic Messages', detail: '模拟备注' }] },
    { id: 'apiKey', label: 'API Key', kind: 'secret', required: true },
    { id: 'models', label: '模型 ID', kind: 'list', required: true },
  ],
}

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
const fill = async (r: ReactTestRenderer) => {
  await type(r, 'name', 'simulated')
  await type(r, 'baseUrl', 'https://example.invalid/v1')
  await type(r, 'apiKey', `${SECRET}\n`)
  await type(r, 'models', 'model-a\n\n model-b \n')
}

it('模拟：renders the five field kinds from the description alone', async () => {
  const r = await render(createElement(ProviderForm, { form, submit: vi.fn(), onBack: vi.fn(), onDone: vi.fn() }))
  expect(text(r)).toContain('添加其他服务商')
  expect(text(r)).toContain('模拟：OpenAI 兼容服务商')
  // text, url, secret are inputs; list is a textarea; select is the settings choice button.
  expect(input(r, 'name').props).toMatchObject({ type: 'text', placeholder: '例如 my-provider', 'aria-required': true })
  expect(input(r, 'baseUrl').props.type).toBe('url')
  expect(input(r, 'apiKey').props).toMatchObject({ type: 'password', value: '', autoComplete: 'off' })
  expect(input(r, 'models').type).toBe('textarea')
  expect(input(r, 'models').props.placeholder).toBe('每行一项')
  expect(button(r, 'API 协议')!.props['aria-haspopup']).toBe('menu')
  expect(label(button(r, 'API 协议')!)).toBe('OpenAI Completions')
  // Required marks and hover help instead of permanent small text; the target is a tip too.
  expect(r.root.findAll((node) => node.props.className === 'cwn-provider-required')).toHaveLength(5)
  const tips = r.root.findAll((node) => node.props.className === 'cwn-provider-help').map((node) => node.props['aria-label'])
  expect(tips).toEqual(['保存到 ~/.pi/agent/models.json', '模拟说明：只用于区分服务商'])
  // Secret can be shown and hidden again.
  await click(r, '显示 API Key')
  expect(input(r, 'apiKey').props.type).toBe('text')
  await click(r, '隐藏 API Key')
  expect(input(r, 'apiKey').props.type).toBe('password')
  // Select picks from Host options.
  await click(r, 'API 协议')
  await act(async () => r.root.findAllByProps({ role: 'menuitem' })[1]!.props.onClick())
  expect(label(button(r, 'API 协议')!)).toBe('Anthropic Messages')
  // Buttons follow the login window rule: one primary, ghost back, outline alternative.
  expect(button(r, '保存')!.props).toMatchObject({ type: 'submit', 'data-variant': 'primary', 'data-size': 'md' })
  expect(button(r, '返回')!.props).toMatchObject({ 'data-variant': 'ghost', 'data-size': 'md' })
})

it('模拟：required fields stop the submit; Host issues land next to their field or on top', async () => {
  const submitForm = vi.fn(async () => ({
    ok: false as const,
    issues: [{ field: 'name', message: '名称已存在' }, { message: '模拟：整表错误' }, { field: 'unknown', message: '模拟：未知字段' }],
  }))
  const r = await render(createElement(ProviderForm, { form, submit: submitForm, onBack: vi.fn(), onDone: vi.fn() }))
  await submit(r)
  expect(submitForm).not.toHaveBeenCalled()
  expect(text(r)).toContain('请填写名称')
  expect(text(r)).toContain('请填写API Key')
  expect(text(r)).toContain('请填写模型 ID')
  expect(input(r, 'name').props['aria-invalid']).toBe(true)
  await type(r, 'name', 'simulated')
  // Editing a field clears its own message only.
  expect(text(r)).not.toContain('请填写名称')
  expect(text(r)).toContain('请填写API Key')
  await fill(r)
  await type(r, 'baseUrl', 'ftp://example.invalid')
  await submit(r)
  expect(submitForm).not.toHaveBeenCalled()
  expect(text(r)).toContain('请填写以 http:// 或 https:// 开头的地址')
  await type(r, 'baseUrl', 'https://example.invalid/v1')
  await submit(r)
  expect(submitForm).toHaveBeenCalledTimes(1)
  const nameField = r.root.findAll((node) => node.props.className === 'cwn-provider-field')[0]!
  expect(nameField.props['data-invalid']).toBe(true)
  expect(label(nameField)).toContain('名称已存在')
  const callout = r.root.find((node) => node.props.role === 'alert')
  expect(label(callout)).toBe('模拟：整表错误 模拟：未知字段')
  // A failed save keeps what was typed so only the wrong field needs fixing.
  expect(input(r, 'apiKey').props.value).toBe(`${SECRET}\n`)
})

it('模拟：shows the saving state, submits trimmed values, then the result view', async () => {
  let finish!: (value: any) => void
  const submitForm = vi.fn((_values: unknown, _signal: AbortSignal) => new Promise<any>((resolve) => (finish = resolve)))
  const onDone = vi.fn()
  const r = await render(createElement(ProviderForm, { form, submit: submitForm, onBack: vi.fn(), onDone, native: { label: '在原生终端中配置', onStart: vi.fn() } }))
  await fill(r)
  await submit(r)
  expect(submitForm.mock.calls[0]![0]).toEqual({
    name: 'simulated',
    baseUrl: 'https://example.invalid/v1',
    api: 'openai-completions',
    apiKey: SECRET,
    models: ['model-a', 'model-b'],
  })
  expect(button(r, '正在保存…')!.props.disabled).toBe(true)
  expect(button(r, '返回')!.props.disabled).toBe(true)
  expect(button(r, '在原生终端中配置')!.props.disabled).toBe(true)
  expect(input(r, 'apiKey').props.disabled).toBe(true)
  await act(async () => finish({ ok: true, title: '已添加 simulated', detail: '模拟提示' }))
  expect(text(r)).toContain('已添加 simulated')
  expect(text(r)).toContain('模拟提示')
  expect(text(r)).not.toContain(SECRET)
  await click(r, '完成')
  expect(onDone).toHaveBeenCalledTimes(1)
})

it('模拟：closing the window during a save abandons it', async () => {
  let signal!: AbortSignal
  const submitForm = vi.fn((_values: unknown, next: AbortSignal) => {
    signal = next
    return new Promise<any>(() => undefined)
  })
  const r = await render(createElement(ProviderForm, { form, submit: submitForm, onBack: vi.fn(), onDone: vi.fn() }))
  await fill(r)
  await submit(r)
  await act(async () => r.unmount())
  mounted.splice(0)
  expect(signal.aborted).toBe(true)
})

// ---- 「其他服务商」 in the account window ----

const piStatus: AccountStatus = {
  cli: 'pi',
  installed: true,
  state: 'unconfigured',
  summary: 'SIMULATED',
  actions: [{ id: 'login', label: '', description: '', providers: [{ id: 'deepseek', label: 'DeepSeek' }] }],
}
const ok = (value: unknown) => ({ ok: true as const, value: typeof value === 'string' ? value : JSON.stringify(value) })
async function openOther(cliworker: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const props = {
    api: { cliworker } as any,
    sessionId: 'SIMULATED-PARENT',
    cli: 'pi' as const,
    status: piStatus,
    closeControl: { current: undefined },
    onRefresh: vi.fn(),
    onClose: vi.fn(),
    ...extra,
  }
  const r = await render(createElement(AccountsWindow, props))
  await click(r, '添加账号')
  return { r, props }
}
const otherCard = (r: ReactTestRenderer) => r.root.findAllByProps({ role: 'radio' }).at(-1)!

it.each([
  ['an older Host without the method', {}],
  ['a CLI the Host does not support (null)', { customProviderForm: vi.fn(async () => ok('null')) }],
])('模拟：keeps the native terminal for %s', async (_name, cliworker) => {
  const { r } = await openOther(cliworker)
  expect(otherCard(r).props['aria-label']).toBe('其他服务商（在原生终端中选择）')
  await act(async () => otherCard(r).props.onClick())
  await click(r, '继续')
  expect(r.root.findByType('synthetic-terminal').props).toMatchObject({ action: 'login', provider: undefined })
})

it('模拟：a failed form read shows why and continues in the native terminal', async () => {
  const { r } = await openOther({ customProviderForm: vi.fn(async () => ({ ok: false, error: { message: '模拟读取失败' } })) })
  await act(async () => otherCard(r).props.onClick())
  expect(text(r)).toContain('无法读取图形化配置：模拟读取失败。继续将在原生终端中配置。')
  await click(r, '继续')
  expect(r.root.findAllByType('synthetic-terminal')).toHaveLength(1)
})

it('模拟：keeps the original copy while the form is still being read, then follows it', async () => {
  let answer!: (value: unknown) => void
  const customProviderForm = vi.fn(() => new Promise((resolve) => (answer = resolve)))
  const { r } = await openOther({ customProviderForm })
  expect(customProviderForm).toHaveBeenCalledWith('SIMULATED-PARENT', 'pi', expect.any(AbortSignal))
  expect(otherCard(r).props['aria-label']).toBe('其他服务商（在原生终端中选择）')
  await act(async () => otherCard(r).props.onClick())
  await click(r, '继续')
  expect(button(r, '正在读取…')!.props.disabled).toBe(true)
  await act(async () => answer(ok(form)))
  expect(r.root.findAllByType('form')).toHaveLength(1)
  expect(r.root.findAllByType('synthetic-terminal')).toHaveLength(0)
})

it('模拟：the form step keeps the native alternative, and returning clears the typed key', async () => {
  const setItem = vi.fn()
  vi.stubGlobal('localStorage', { setItem, getItem: () => null, removeItem: vi.fn() })
  vi.stubGlobal('sessionStorage', { setItem, getItem: () => null, removeItem: vi.fn() })
  const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'debug')]
  try {
    const { r } = await openOther({ customProviderForm: vi.fn(async () => ok(form)) })
    expect(otherCard(r).props['aria-label']).toBe('其他服务商（在本窗口中填写配置）')
    expect(text(r)).toContain('在本窗口中填写配置')
    await act(async () => otherCard(r).props.onClick())
    await click(r, '继续')
    await type(r, 'apiKey', SECRET)
    expect(input(r, 'apiKey').props.value).toBe(SECRET)
    await click(r, '返回')
    // Back on the cards; the next visit starts empty.
    expect(r.root.findAllByType('form')).toHaveLength(0)
    expect(text(r)).not.toContain(SECRET)
    await click(r, '继续')
    expect(input(r, 'apiKey').props.value).toBe('')
    expect(setItem).not.toHaveBeenCalled()
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET)
    // The native alternative starts the CLI's own picker.
    expect(button(r, '在原生终端中配置')!.props['data-variant']).toBe('outline')
    await click(r, '在原生终端中配置')
    expect(r.root.findByType('synthetic-terminal').props).toMatchObject({ action: 'login', provider: undefined })
  } finally {
    vi.unstubAllGlobals()
  }
})

it('模拟：no native alternative when the Host says there is none', async () => {
  const { r } = await openOther({ customProviderForm: vi.fn(async () => ok({ ...form, nativeFallback: false })) })
  await act(async () => otherCard(r).props.onClick())
  await click(r, '继续')
  expect(button(r, '在原生终端中配置')).toBeUndefined()
})

it('模拟：saves through the Host token, refreshes after success and returns to the list', async () => {
  const saveCustomProvider = vi.fn(async (..._args: unknown[]) =>
    ok({ ok: true, cli: 'pi', providerId: 'simulated', providerLabel: 'simulated', notice: '模拟：已写入' }),
  )
  const onProviderSaved = vi.fn()
  const { r, props } = await openOther(
    { customProviderForm: vi.fn(async () => ok(form)), saveCustomProvider },
    { onProviderSaved },
  )
  await act(async () => otherCard(r).props.onClick())
  await click(r, '继续')
  await fill(r)
  await submit(r)
  const [parent, cli, token, values, signal] = saveCustomProvider.mock.calls[0]!
  expect([parent, cli, token]).toEqual(['SIMULATED-PARENT', 'pi', 'SIMULATED-TOKEN'])
  expect(JSON.parse(values as string)).toMatchObject({ apiKey: SECRET, models: ['model-a', 'model-b'] })
  expect(signal).toBeInstanceOf(AbortSignal)
  expect(onProviderSaved).toHaveBeenCalledTimes(1)
  expect(props.onRefresh).not.toHaveBeenCalled()
  expect(text(r)).toContain('已添加 simulated')
  expect(text(r)).toContain('模拟：已写入')
  await click(r, '完成')
  expect(button(r, '添加账号')).toBeDefined()
})

it('模拟：Host issues after a save keep the form open', async () => {
  const saveCustomProvider = vi.fn(async () => ok({ ok: false, issues: [{ field: 'baseUrl', message: '模拟：地址不可用' }] }))
  const onProviderSaved = vi.fn()
  const { r } = await openOther({ customProviderForm: vi.fn(async () => ok(form)), saveCustomProvider }, { onProviderSaved })
  await act(async () => otherCard(r).props.onClick())
  await click(r, '继续')
  await fill(r)
  await submit(r)
  expect(text(r)).toContain('模拟：地址不可用')
  expect(onProviderSaved).not.toHaveBeenCalled()
  expect(r.root.findAllByType('form')).toHaveLength(1)
})
