import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkBuddyDesktopWindow } from '../src/client/account-login/workbuddy-desktop-window.tsx'
import { setLanguagePreference } from '../src/client/i18n.ts'
import { hostText } from '../src/client/operation-error.ts'
import type { API } from '../src/client/workers.ts'
import type { AccountFrame } from '../src/shared/accounts.ts'

// SIMULATED UI / Gateway only; no PTY, desktop, metadata or real account access.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, variant: _v, size: _s, ...props }: any) => createElement('button', props, children),
  StateDot: () => createElement('span'), Input: (p: any) => createElement('input', p),
  IconCheckOutlineRegular: () => createElement('svg'), IconCheckCircleFillRegular: () => createElement('svg'),
  writeClipboard: vi.fn(),
}))
vi.mock('../src/client/icons.tsx', () => ({ BrandIcon: () => createElement('svg') }))
const ok = (value: unknown = true) => ({ ok: true, value })
const initial: AccountFrame = { seq: 1, status: 'running', guide: {
  step: 'desktop', template: 'choice', tone: 'info', text: '登录、退出或切换请在桌面端完成。',
  plan: ['在桌面端管理账号', '确认当前登录状态'], stage: 0,
}, desktop: { observing: false, account: { cli: 'workbuddycn', installed: true, state: 'authenticated', summary: '已登录（www.workbuddy.cn）', actions: [] } } }
class Stream {
  queue: AccountFrame[] = []; ended = false; wake?: () => void
  dispose = vi.fn(async () => { this.ended = true; this.wake?.() })
  push(frame: AccountFrame) { this.queue.push(frame); this.wake?.() }
  async *[Symbol.asyncIterator]() {
    while (!this.ended) {
      const frame = this.queue.shift()
      if (frame) yield { value: JSON.stringify(frame), accept: vi.fn() }
      else await new Promise<void>(r => { this.wake = r })
    }
  }
}
const renders: ReactTestRenderer[] = []
afterEach(async () => { await act(async () => { for (const r of renders.splice(0)) r.unmount() }); setLanguagePreference('follow') })
async function setup(overrides: Record<string, unknown> = {}, language: 'zh' | 'en' = 'zh') {
  setLanguagePreference(language)
  const stream = new Stream(), onClose = vi.fn(), closeControl = { current: undefined as undefined | (() => Promise<boolean>) }
  const remote = {
    accountDesktopStart: vi.fn(async () => ok(JSON.stringify({ id: 'SIMULATED/guide', frame: initial }))),
    accountDesktopWatch: vi.fn(), accountDesktopStop: vi.fn(async () => ok()), accountDesktopRespond: vi.fn(async () => ok()),
    accountStart: vi.fn(), accountWrite: vi.fn(), ...overrides,
  }
  const api = { cliworker: remote, $stream: vi.fn(() => stream) } as unknown as API
  let r!: ReactTestRenderer
  await act(async () => { r = create(<WorkBuddyDesktopWindow api={api} sessionId="SIMULATED/parent" cli="workbuddycn"
    closeControl={closeControl} onClose={onClose} />); renders.push(r) })
  const text = () => JSON.stringify(r.toJSON())
  const click = async (label: string) => act(async () => { r.root.findAllByType('button').find(b => b.children.includes(label))!.props.onClick() })
  return { r, api, remote, stream, onClose, closeControl, text, click }
}
describe('模拟 WorkBuddy desktop guide rendering', () => {
  it.each(['zh', 'en'] as const)('renders %s steps/current grey card, same-row controls, and no terminal/logout/switch promise', async lang => {
    const f = await setup({}, lang)
    expect(f.r.root.findAllByProps({ className: 'cwn-accounts-card' })).toHaveLength(1)
    const footer = f.r.root.findByProps({ className: 'cwn-login-foot' })
    expect(footer.findAllByType('button').length).toBe(4)
    expect(footer.findAllByProps({ className: 'cwn-login-notice' })).toHaveLength(1)
    expect(f.text()).toContain(lang === 'zh' ? '登录、退出或切换请在桌面端完成。' : 'Sign in, sign out, or switch accounts in the desktop app.')
    expect(f.text()).not.toMatch(/显示原生终端|Show native terminal|现在可以派遣|You can now dispatch|先退出当前/)
    await f.click(lang === 'zh' ? '打开桌面端' : 'Open desktop app')
    expect(f.remote.accountDesktopRespond).toHaveBeenCalledWith('SIMULATED/parent', 'SIMULATED/guide', 'open')
    await f.click(lang === 'zh' ? '刷新状态' : 'Refresh status')
    expect(f.remote.accountDesktopRespond).toHaveBeenLastCalledWith('SIMULATED/parent', 'SIMULATED/guide', 'refresh')
    expect(f.remote.accountStart).not.toHaveBeenCalled(); expect(f.remote.accountWrite).not.toHaveBeenCalled()
    await act(async () => { expect(await f.closeControl.current!()).toBe(true) })
    expect(f.remote.accountDesktopStop).toHaveBeenCalled(); expect(f.stream.dispose).toHaveBeenCalled(); expect(f.onClose).toHaveBeenCalledOnce()
  })
  it('old Host displays manual guidance without calling unknown RPCs or pretending to observe', async () => {
    const f = await setup({ accountDesktopStart: undefined, accountDesktopWatch: undefined, accountDesktopRespond: undefined, accountDesktopStop: undefined })
    expect(f.api.$stream).not.toHaveBeenCalled()
    expect(f.text()).toContain('在 WorkBuddy 桌面端管理')
    expect(f.text()).not.toContain('正在启动')
    expect(f.text()).not.toContain('显示原生终端')
    expect(f.r.root.findAllByType('button')).toHaveLength(1)
    await f.click('关闭'); expect(f.onClose).toHaveBeenCalledOnce()
  })
  it('ignores stale frame sequences and translates failure/manual-open/retry guidance', async () => {
    const f = await setup({}, 'en')
    await act(async () => {
      f.stream.push({ seq: 3, status: 'running', guide: { step: 'desktop', template: 'choice', tone: 'warning',
        text: '无法打开桌面端，请手动打开对应版本后刷新，或重试。' }, desktop: { observing: false } })
      f.stream.push({ seq: 2, guide: { step: 'desktop', text: 'SIMULATED STALE', tone: 'info' } })
    })
    expect(f.text()).toContain('Open the selected edition manually')
    expect(f.text()).not.toContain('SIMULATED STALE')
    await f.click('Open desktop app')
    expect(f.remote.accountDesktopRespond).toHaveBeenCalledOnce()
    expect(hostText('请在桌面端检查登录状态。')).toBe('Please check sign-in in the desktop app.')
  })
  it('a confirmed desktop result never claims tasks or a switched identity are verified', async () => {
    const f = await setup()
    await act(async () => f.stream.push({ seq: 2, guide: { step: 'desktop', template: 'result', tone: 'success', text: '已登录（www.workbuddy.cn）' } }))
    expect(f.text()).not.toContain('现在可以派遣')
    expect(f.text()).not.toContain('切换成功')
    await act(async () => f.stream.push({ seq: 3, status: 'closed', cleanupConfirmed: true }))
    expect(f.r.root.findAllByProps({ className: 'cwn-login-result' })).toHaveLength(1)
    expect(f.text()).not.toContain('正在启动')
  })
  it('startup failure offers a retry without closing the dialog or starting a PTY', async () => {
    const start = vi.fn().mockRejectedValueOnce(new Error('SIMULATED secret')).mockResolvedValueOnce(ok(JSON.stringify({ id: 'SIMULATED/retry', frame: initial })))
    const f = await setup({ accountDesktopStart: start })
    expect(f.text()).toContain('桌面管理暂不可用')
    expect(f.text()).not.toContain('SIMULATED secret')
    await f.click('重试')
    expect(start).toHaveBeenCalledTimes(2)
    expect(f.onClose).not.toHaveBeenCalled()
    expect(f.text()).toContain('登录、退出或切换请在桌面端完成。')
    expect(f.remote.accountStart).not.toHaveBeenCalled()
  })
  it('does not close or report successful cleanup on stop rejection', async () => {
    const f = await setup({ accountDesktopStop: vi.fn(async () => { throw new Error('SIMULATED raw secret') }) })
    await act(async () => { expect(await f.closeControl.current!()).toBe(false) })
    expect(f.onClose).not.toHaveBeenCalled(); expect(f.text()).toContain('账号查询未能确认进程已退出')
    expect(f.text()).not.toContain('raw secret')
  })
  it('disposes a late allocation after unmount without updating another window', async () => {
    let resolve!: (result: unknown) => void
    const allocation = new Promise(r => { resolve = r })
    const f = await setup({ accountDesktopStart: vi.fn(() => allocation) })
    await act(async () => { f.r.unmount() })
    await act(async () => { resolve(ok(JSON.stringify({ id: 'SIMULATED/late', frame: initial }))); await allocation })
    expect(f.remote.accountDesktopStop).toHaveBeenCalledWith('SIMULATED/parent', 'SIMULATED/late')
    expect(f.api.$stream).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled()
  })
})
