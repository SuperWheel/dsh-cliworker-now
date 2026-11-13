import { createElement, forwardRef } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { CliDownloadSourceSection } from '../src/client/cli-download-source.tsx'
import { setLanguagePreference } from '../src/client/i18n.ts'
import type { API } from '../src/client/workers.ts'

// 模拟：下载源设置与连接检查都由测试替身返回；不改 npm 配置，不访问任何源。
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  StateDot: () => createElement('svg', { 'data-loading': true }),
  IconChevronDownOutlineRegular: () => createElement('svg'),
  Menu: ({ anchor, open, items = [], onSelect }: any) =>
    createElement(
      'div',
      {},
      anchor,
      open &&
        createElement(
          'div',
          { role: 'menu' },
          items.map((item: any) =>
            item.type === 'separator'
              ? createElement('hr', { key: item.id })
              : createElement('button', { key: item.id, role: 'menuitem', disabled: item.disabled, onClick: () => onSelect(item.id) }, item.label),
          ),
        ),
    ),
  Button: forwardRef(({ children, variant, size, ...props }: any, ref) =>
    createElement('button', { type: 'button', 'data-variant': variant, 'data-size': size, ...props, ref }, children),
  ),
  Input: forwardRef(({ icon, className, ...props }: any, ref) =>
    createElement('span', { className }, icon, createElement('input', { ...props, ref })),
  ),
}))

const SESSION = 'simulation-parent'
const remote = (data: unknown) => ({ ok: true, value: JSON.stringify(data) })
const mounted: ReactTestRenderer[] = []
afterEach(async () => {
  await act(async () => {
    for (const renderer of mounted.splice(0)) renderer.unmount()
  })
  setLanguagePreference('follow')
})

const text = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(text).join('')

async function setup(cliworker: Record<string, unknown>) {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(<CliDownloadSourceSection api={{ cliworker } as unknown as API} sessionId={SESSION} />)
    mounted.push(renderer)
  })
  const root = renderer.root
  const choice = () => root.findAll((node) => node.type === 'button' && node.props['aria-haspopup'] === 'menu')[0]!
  const menuItems = () => root.findAll((node) => node.type === 'button' && node.props.role === 'menuitem')
  const pick = async (label: string) => {
    await act(async () => choice().props.onClick())
    const item = menuItems().find((node) => text(node).startsWith(label))!
    await act(async () => item.props.onClick())
  }
  const input = () => root.findAll((node) => node.type === 'input')[0]
  const type = async (value: string) => {
    await act(async () => input()!.props.onChange({ target: { value } }))
  }
  const button = (label: string) =>
    root.findAll((node) => node.type === 'button' && text(node) === label)[0]!
  return { renderer, root, choice, menuItems, pick, input, type, button, all: () => text(root) }
}

function host(initial: Record<string, unknown> = { source: 'follow', followRegistry: 'https://registry.example-company.cn/' }) {
  let current = initial
  const cliDownloadSource = vi.fn(async () => remote(current))
  const saveCliDownloadSource = vi.fn(async (_session: string, raw: string) => {
    current = { ...current, ...JSON.parse(raw) }
    return remote(current)
  })
  const testCliDownloadSource = vi.fn(async () => remote({ ok: true, elapsedMs: 412 }))
  return { cliDownloadSource, saveCliDownloadSource, testCliDownloadSource }
}

it('lists the four sources with their one-line descriptions and saves a preset at once', async () => {
  const service = host()
  const t = await setup(service)
  expect(text(t.choice())).toBe('跟随 npm 设置')
  expect(t.all()).toContain('npm 包从哪里下载。官方安装脚本、Homebrew 和桌面安装包不受影响')
  await act(async () => t.choice().props.onClick())
  expect(t.menuItems().map(text)).toEqual([
    '跟随 npm 设置使用这台电脑 npm 配置里的源，当前是 registry.example-company.cn',
    'npm 官方源registry.npmjs.org',
    '国内镜像npmmirror · registry.npmmirror.com',
    '自定义地址…公司内部源或其他镜像',
  ])
  // The custom address starts a new group below the native menu hairline.
  expect(t.root.findAllByType('hr')).toHaveLength(1)
  await act(async () => t.menuItems()[2]!.props.onClick())
  expect(service.saveCliDownloadSource).toHaveBeenCalledWith(SESSION, '{"source":"npmmirror"}', expect.any(AbortSignal))
  expect(text(t.choice())).toBe('国内镜像')
  expect(t.all()).not.toContain('正在保存下载源')
  expect(t.input()).toBeUndefined()
})

it('restores the saved choice and explains when the Host does not save a preset', async () => {
  const service = host({ source: 'official' })
  service.saveCliDownloadSource.mockResolvedValueOnce(remote({ source: 'official' }))
  const t = await setup(service)
  await t.pick('国内镜像')
  expect(text(t.choice())).toBe('npm 官方源')
  expect(t.all()).toContain('下载源未保存，请重试')
})

it('opens the custom address 16px below the row, validates while typing and saves on Enter or blur', async () => {
  const service = host()
  const t = await setup(service)
  await t.pick('自定义地址…')
  expect(text(t.choice())).toBe('自定义地址')
  // No address yet: nothing is saved and the field waits for input.
  expect(service.saveCliDownloadSource).not.toHaveBeenCalled()
  expect(t.all()).toContain('源地址')
  expect(t.all()).toContain('只支持 https，地址里不能带用户名或密码')
  expect(t.button('检查连接').props.disabled).toBe(true)
  expect(t.button('检查连接').props['data-size']).toBe('sm')
  expect(t.button('检查连接').props['data-variant']).toBe('outline')

  await t.type('http://npm.example.com/')
  expect(t.all()).toContain('只接受 https 地址')
  expect(t.input()!.props['aria-invalid']).toBe(true)
  expect(t.button('检查连接').props.disabled).toBe(true)
  await act(async () => t.input()!.props.onBlur())
  expect(service.saveCliDownloadSource).not.toHaveBeenCalled()

  await t.type('https://user:secret@npm.example.com/')
  expect(t.all()).toContain('地址里不能包含用户名或密码')

  await t.type(' https://npm.example.com/ ')
  expect(t.all()).toContain('只支持 https，地址里不能带用户名或密码')
  await act(async () => t.input()!.props.onKeyDown({ key: 'Enter', preventDefault: () => undefined }))
  expect(service.saveCliDownloadSource).toHaveBeenCalledWith(
    SESSION,
    '{"source":"custom","customUrl":"https://npm.example.com/"}',
    expect.any(AbortSignal),
  )
  // The same address again on blur is not saved twice.
  await act(async () => t.input()!.props.onBlur())
  expect(service.saveCliDownloadSource).toHaveBeenCalledTimes(1)
})

it('checks the connection and shows the round trip or the Host reason', async () => {
  const service = host({ source: 'custom', customUrl: 'https://npm.example.com/' })
  service.testCliDownloadSource
    .mockResolvedValueOnce(remote({ ok: true, elapsedMs: 412 }))
    .mockResolvedValueOnce(remote({ ok: false, message: '模拟：HTTP 503' }))
  const t = await setup(service)
  expect(t.input()!.props.value).toBe('https://npm.example.com/')
  await act(async () => t.button('检查连接').props.onClick())
  expect(service.testCliDownloadSource).toHaveBeenCalledWith(SESSION, 'https://npm.example.com/', expect.any(AbortSignal))
  expect(t.all()).toContain('连接正常 · 0.4 秒')
  await act(async () => t.button('检查连接').props.onClick())
  const result = t.root.findByProps({ className: 'cwn-download-source-result' })
  expect(result.props['data-state']).toBe('failed')
  expect(text(result)).toBe('模拟：HTTP 503')
  // Editing the address clears the old result.
  await t.type('https://npm.example.org/')
  expect(t.root.findAllByProps({ className: 'cwn-download-source-result' })).toHaveLength(0)
})

it('reuses a saved custom address when switching back to it', async () => {
  const service = host({ source: 'official', customUrl: 'https://npm.example.com/' })
  const t = await setup(service)
  await t.pick('自定义地址…')
  expect(service.saveCliDownloadSource).toHaveBeenCalledWith(
    SESSION,
    '{"source":"custom","customUrl":"https://npm.example.com/"}',
    expect.any(AbortSignal),
  )
  expect(text(t.choice())).toBe('自定义地址')
})

it('greys out the whole row with a reason on a Host without download source support', async () => {
  const t = await setup({})
  expect(t.choice().props.disabled).toBe(true)
  expect(t.root.findByProps({ className: 'cwn-settings-form cwn-download-source' }).props['data-supported']).toBe(false)
  expect(t.all()).toContain('插件服务尚未支持切换下载源，请重启 DeepSeek Harness 后重试')
  expect(t.all()).not.toContain('npm 包从哪里下载')
})

it('offers a re-read after a failed read and keeps the choice disabled meanwhile', async () => {
  const service = host()
  service.cliDownloadSource.mockResolvedValueOnce({ ok: false, error: { message: '模拟：读取失败' } } as never)
  const t = await setup(service)
  expect(t.choice().props.disabled).toBe(true)
  expect(t.all()).toContain('模拟：读取失败')
  await act(async () => t.button('重新读取下载源').props.onClick())
  expect(t.choice().props.disabled).toBe(false)
  expect(text(t.choice())).toBe('跟随 npm 设置')
})

it('shows English copy, including translated address problems', async () => {
  setLanguagePreference('en')
  const t = await setup(host())
  await t.pick('Custom address…')
  await t.type('http://npm.example.com/')
  expect(t.all()).toContain('Only https addresses are accepted')
  expect(text(t.button('Test connection'))).toBe('Test connection')
})
