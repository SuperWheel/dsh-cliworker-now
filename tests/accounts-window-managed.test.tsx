/** 模拟 UI only; no real account or terminal. */
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { AccountsWindow } from '../src/client/account-login/accounts-window.tsx'
vi.mock('../src/client/account-terminal.tsx', () => ({ AccountTerminal: (props: any) => createElement('simulated-terminal', props) }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Button: ({ children, ...props }: any) => createElement('button', props, children), IconPlusOutlineRegular: () => null }))
const text = (node: any): string => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : ''
it.each(['pi', 'omp'] as const)('模拟 %s: receipt-backed config uses inline confirmation; external config has no delete action', async cli => {
  const managed = { id: `${cli}:custom-demo:plugin.config`, source: 'plugin' as const, providerLabel: 'Simulated managed', authMethod: 'api' as const, managedConfiguration: true }
  const status = { cli, installed: true, state: 'configured' as const, summary: '', actions: [], logins: [managed, { providerLabel: 'Simulated manual', authMethod: 'api' as const }] }
  const prepare = vi.fn(async () => status), refresh = vi.fn()
  const remove = vi.fn(async () => ({ ok: true, value: JSON.stringify({ ok: true }) }))
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(createElement(AccountsWindow, { api: { cliworker: { deleteAccountConfiguration: remove } } as any, cli, sessionId: 'SIMULATED', status, prepare, onRefresh: refresh,
    onClose: vi.fn(), closeControl: { current: undefined } })) })
  const cards = renderer.root.findAllByType('li')
  expect(cards[1]!.findAllByType('button')).toHaveLength(0)
  expect(text(cards[1])).toContain('在原配置中管理')
  await act(async () => cards[0]!.findByType('button').props.onClick())
  expect(renderer.root.findAllByType('simulated-terminal')).toHaveLength(0)
  expect(text(renderer.root.findByProps({ role: 'group', 'aria-label': '确认退出' }))).toContain('退出后会删除此服务商的配置和凭据，其他配置保留。')
  await act(async () => renderer.root.findAllByType('button').find(button => text(button) === '确认退出')!.props.onClick())
  expect(prepare).toHaveBeenCalledTimes(1)
  expect(remove).toHaveBeenCalledWith('SIMULATED', cli, managed.id, expect.any(AbortSignal))
  expect(renderer.root.findAllByType('simulated-terminal')).toHaveLength(0)
  expect(text(renderer.root.findByProps({ role: 'status' }))).toContain('已删除该服务商配置。')
  expect(refresh).toHaveBeenCalledTimes(1)
  await act(async () => renderer.unmount())
})

it.each(['pi', 'omp'] as const)('模拟 %s: native file deletion states its direct-CLI effect and refreshes after completion', async cli => {
  const login = { id: `${cli}:custom-demo:native.config`, source: 'native' as const, nativeConfiguration: true,
    providerLabel: 'Simulated native provider', authMethod: 'api' as const }
  const status = { cli, installed: true, state: 'configured' as const, summary: '', actions: [], logins: [login] }
  const refresh = vi.fn(), prepare = vi.fn(async () => status)
  const remove = vi.fn(async () => ({ ok: true, value: JSON.stringify({ ok: true }) }))
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(createElement(AccountsWindow, { api: { cliworker: { deleteAccountConfiguration: remove } } as any, cli, status, sessionId: 'SIMULATED',
    closeControl: { current: undefined }, onRefresh: refresh, onClose: vi.fn(), prepare })) })
  const button = renderer.root.findAllByType('button').find(button => text(button) === '删除')!
  expect(button).toBeDefined()
  await act(async () => button.props.onClick())
  const confirmation = renderer.root.findByProps({ role: 'group', 'aria-label': '确认删除' })
  expect(text(confirmation)).toContain(cli === 'omp' ? '~/.omp/agent/models.yml' : '~/.pi/agent/models.json')
  expect(text(confirmation)).toContain(`直接运行 ${cli === 'omp' ? 'OMP' : 'Pi'} 时也不再可用`)
  expect(renderer.root.findAllByType('simulated-terminal')).toHaveLength(0)
  await act(async () => confirmation.findAllByType('button').find(button => text(button) === '确认删除')!.props.onClick())
  expect(prepare).toHaveBeenCalledOnce()
  expect(remove).toHaveBeenCalledWith('SIMULATED', cli, login.id, expect.any(AbortSignal))
  expect(renderer.root.findAllByType('simulated-terminal')).toHaveLength(0)
  expect(text(renderer.root.findByProps({ role: 'status' }))).toContain('已删除该服务商配置。')
  expect(refresh).toHaveBeenCalledOnce()
  await act(async () => renderer.unmount())
})

 it('模拟：deletion waits for direct acknowledgment, prevents duplicate clicks and reports failure without a terminal', async () => {
  const login = { id: 'pi:custom-demo:native.config', source: 'native' as const, nativeConfiguration: true,
    providerLabel: 'Simulated native provider', authMethod: 'api' as const }
  let reject!: (error: Error) => void
  const remove = vi.fn(() => new Promise<never>((_, r) => { reject = r }))
  const refresh = vi.fn(), close = vi.fn(), closeControl = { current: undefined as undefined | (() => Promise<boolean>) }
  const status = { cli: 'pi' as const, installed: true, state: 'configured' as const, summary: '', actions: [], logins: [login] }
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(createElement(AccountsWindow, { api: { cliworker: { deleteAccountConfiguration: remove } } as any,
    cli: 'pi', sessionId: 'SIMULATED', status, closeControl, onRefresh: refresh, onClose: close })) })
  await act(async () => renderer.root.findAllByType('button').find(b => text(b) === '删除')!.props.onClick())
  const confirm = renderer.root.findAllByType('button').find(b => text(b) === '确认删除')!
  let operation!: Promise<void>
  await act(async () => { operation = confirm.props.onClick(); void confirm.props.onClick() })
  expect(remove).toHaveBeenCalledOnce(); expect(confirm.props.disabled).toBe(true)
  expect(refresh).not.toHaveBeenCalled(); expect(await closeControl.current!()).toBe(false); expect(close).not.toHaveBeenCalled()
  expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(0)
  await act(async () => { reject(new Error('配置文件已被其他程序修改，未回滚；备份保留在 /simulated/private.bak')); await operation })
  expect(text(renderer.root.findByProps({ role: 'alert' }))).toContain('备份保留在 /simulated/private.bak')
  expect(renderer.root.findAllByType('simulated-terminal')).toHaveLength(0)
  expect(refresh).toHaveBeenCalledOnce()
  expect(renderer.root.findAllByType('button').find(b => text(b) === '确认删除')!.props.disabled).toBe(false)
  await act(async () => renderer.unmount())
})
