import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountTerminal, type AccountCloseControl } from '../src/client/account-terminal.tsx'
import type { API } from '../src/client/workers.ts'
import type {
  AccountAction,
  AccountFrame,
  AccountSource,
  AccountStatus,
  ZCodeLoginProvider,
} from '../src/shared/accounts.ts'
import type { CliId } from '../src/shared/types.ts'
import { AGY_GUIDES } from '../src/host/agy-account-guide.ts'
import { loginLink } from '../src/client/account-login/login-window.tsx'

// Simulated PTY/Gateway and renderer only; these tests never invoke an installed CLI.
const terminals = vi.hoisted(() => [] as any[])
const faults = vi.hoisted(() => ({ constructor: false, open: false }))
const clipboardWrites = vi.hoisted(() => vi.fn())
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, any>
    cols = 80
    rows = 24
    input?: (text: string) => void
    keyHandler?: (event: KeyboardEvent) => boolean
    write = vi.fn()
    resize = vi.fn()
    paste = vi.fn((text: string) => this.input?.(text))
    dispose = vi.fn()
    focus = vi.fn()
    hasSelection = vi.fn(() => false)
    getSelection = vi.fn(() => '')
    clearSelection = vi.fn()
    linkProvider?: any
    linkDisposal = vi.fn()
    registerLinkProvider = vi.fn((provider: any) => {
      this.linkProvider = provider
      return { dispose: this.linkDisposal }
    })
    open = vi.fn(() => {
      if (faults.open) {
        faults.open = false
        throw new Error('simulated renderer initialization failure')
      }
    })
    loadAddon = vi.fn()
    attachCustomKeyEventHandler = vi.fn((callback: (event: KeyboardEvent) => boolean) => {
      this.keyHandler = callback
    })
    constructor(options: Record<string, any>) {
      if (faults.constructor) {
        faults.constructor = false
        throw new Error('simulated terminal initialization failure')
      }
      this.options = options
      terminals.push(this)
    }
    onData(callback: (text: string) => void) {
      this.input = callback
      return {
        dispose: vi.fn(() => {
          this.input = undefined
        }),
      }
    }
  },
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
  },
}))
// Link range/wrap matching is tested in zcode-login-link-provider.test.ts. This
// fixture exposes callbacks solely to verify terminal lifetime and navigation.
vi.mock('../src/client/zcode-login-link-provider.ts', () => ({
  createZcodeLoginLinkProvider: (
    _terminal: unknown,
    currentUrl: () => string | undefined,
    open: (url: string) => void,
  ) => ({ currentUrl, activate: open }),
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: any) =>
    createElement('button', props, children),
  StateDot: ({ state }: any) => createElement('span', { 'data-state': state }),
  Input: (props: any) => createElement('input', props),
  IconCheckOutlineRegular: () => createElement('svg'),
  IconCheckCircleFillRegular: () => createElement('svg'),
  writeClipboard: clipboardWrites,
}))

function deferred<T = unknown>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const ok = (value: unknown = true) => ({ ok: true, value })
const started = (id: string) => ok(JSON.stringify({ id, instruction: '模拟账号交互' }))

class AccountStream {
  private queue: AccountFrame[] = []
  private done = false
  private failure?: Error
  private wake?: () => void
  accept = vi.fn()
  dispose = vi.fn(async () => {
    this.done = true
    this.wake?.()
  })
  push(frame: AccountFrame) {
    this.queue.push(frame)
    this.wake?.()
  }
  end() {
    this.done = true
    this.wake?.()
  }
  fail() {
    this.failure = new Error('simulated stream failure')
    this.wake?.()
  }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      if (this.failure) throw this.failure
      const frame = this.queue.shift()
      if (frame) yield { value: JSON.stringify(frame), accept: this.accept }
      else if (this.done) return
      else
        await new Promise<void>((resolve) => {
          this.wake = resolve
        })
    }
  }
}

const mounted: ReactTestRenderer[] = []
beforeEach(() => {
  terminals.length = 0
  faults.constructor = false
  faults.open = false
  clipboardWrites.mockReset().mockResolvedValue(true)
  vi.stubGlobal('document', { body: {} })
  vi.stubGlobal('navigator', { clipboard: { readText: vi.fn().mockResolvedValue('模拟剪贴板') } })
  vi.stubGlobal('window', { open: vi.fn() })
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }))
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(async () => {
  await act(async () => {
    for (const renderer of mounted.splice(0)) renderer.unmount()
  })
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function setup(initiallyOpen = true) {
  const starts: ReturnType<typeof deferred>[] = []
  const streams: AccountStream[] = []
  const pendingStart = () => {
    const pending = deferred()
    starts.push(pending)
    return pending.promise
  }
  const accountStart = vi.fn(pendingStart)
  const accountStartForSource = vi.fn(pendingStart)
  const accountStartForProvider = vi.fn(pendingStart)
  const accountStartWith = vi.fn(pendingStart)
  const accountWrite = vi.fn().mockResolvedValue(ok())
  const accountRespond = vi.fn().mockResolvedValue(ok(true))
  const accountStop = vi.fn().mockResolvedValue(ok())
  const accountResize = vi.fn().mockResolvedValue(ok())
  const accountWatch = vi.fn(() => {
    const stream = new AccountStream()
    streams.push(stream)
    return stream
  })
  const api = {
    $stream: (options: any) => options.open(new AbortController().signal),
    cliworker: {
      accountStart,
      accountStartForSource,
      accountStartForProvider,
      accountStartWith,
      accountWatch,
      accountWrite,
      accountRespond,
      accountStop,
      accountResize,
    },
  } as unknown as API
  const onClose = vi.fn(),
    onFinished = vi.fn()
  const closeControl: AccountCloseControl = { current: undefined }
  const container = new EventTarget()
  // Kimi keeps the native terminal; guided CLIs draw the login window instead.
  const render = (
    cli: CliId = 'kimi',
    action: AccountAction = 'login',
    source?: AccountSource,
    provider?: ZCodeLoginProvider | string,
    signedIn?: boolean,
    extra: { login?: string; replaces?: string; account?: AccountStatus } = {},
  ) => (
    <AccountTerminal
      signedIn={signedIn}
      account={extra.account}
      login={extra.login}
      replaces={extra.replaces}
      api={api}
      sessionId="parent"
      cli={cli}
      action={action}
      source={source}
      provider={provider}
      onClose={onClose}
      onFinished={onFinished}
      closeControl={closeControl}
    />
  )
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(initiallyOpen ? render() : null, {
      createNodeMock: (node) => (node.props.className === 'cwn-account-terminal-view' ? container : null),
    })
    mounted.push(renderer)
  })
  const update = async (
    cli: CliId = 'kimi',
    action: AccountAction = 'login',
    source?: AccountSource,
    provider?: ZCodeLoginProvider | string,
    signedIn?: boolean,
    extra: { login?: string; replaces?: string; account?: AccountStatus } = {},
  ) => {
    await act(async () => {
      renderer.update(render(cli, action, source, provider, signedIn, extra))
    })
  }
  const start = async (id = 'terminal-a', index = 0) => {
    await act(async () => {
      starts[index].resolve(started(id))
    })
  }
  const click = async (label: string) => {
    await act(async () => {
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.includes(label))!
        .props.onClick()
    })
  }
  // The guided window has no terminal header; the dialog closes it.
  const close = async () => {
    if (renderer.root.findAllByType('button').some((button) => button.children.includes('关闭终端'))) return click('关闭终端')
    await act(async () => {
      await closeControl.current?.()
    })
  }
  const contextClipboard = async () => {
    await act(async () => {
      renderer.root.findByProps({ className: 'cwn-account-terminal-view' }).props.onContextMenuCapture({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      })
    })
  }
  const unmount = async () => {
    await act(async () => {
      renderer.unmount()
    })
    mounted.splice(mounted.indexOf(renderer), 1)
  }
  return {
    renderer,
    starts,
    streams,
    accountStart,
    accountStartForSource,
    accountStartForProvider,
    accountStartWith,
    api,
    accountWatch,
    accountWrite,
    accountRespond,
    accountStop,
    onClose,
    onFinished,
    update,
    start,
    close,
    contextClipboard,
    click,
    unmount,
    closeControl,
    container,
  }
}

it('starts an account action only when explicitly mounted and never enters a prompt automatically', async () => {
  const fixture = await setup(false)
  expect(fixture.accountStart).not.toHaveBeenCalled()
  await fixture.update('kimi', 'manage')
  expect(fixture.accountStart).toHaveBeenCalledWith('parent', 'kimi', 'manage', expect.any(AbortSignal))
  expect(fixture.accountStartForSource).not.toHaveBeenCalled()
  expect(terminals[0].options.disableStdin).toBe(true)
  await fixture.start()
  expect(terminals[0].options.disableStdin).toBe(false)
  expect(terminals[0].options.cursorStyle).toBe('block')
  expect(terminals[0].options.cursorBlink).toBe(true)
  expect(terminals[0].options.theme.cursor).not.toBe(terminals[0].options.theme.cursorAccent)
  expect(terminals[0].focus).toHaveBeenCalledOnce()
  await act(async () =>
    fixture.renderer.root.findByProps({ className: 'cwn-account-terminal-view' }).props.onClick(),
  )
  expect(terminals[0].focus).toHaveBeenCalledTimes(2)
  expect(fixture.accountWatch).toHaveBeenCalledWith('parent', 'terminal-a', expect.any(AbortSignal))
  expect(fixture.accountWrite).not.toHaveBeenCalled()
  const text = JSON.stringify(fixture.renderer.toJSON())
  expect(text).toContain('模拟账号交互')
  expect(text).not.toMatch(/插件不保存|关闭此窗口会结束|cwn-account-privacy/)
  expect(fixture.renderer.root.findAllByType('button').map((button) => button.children.join(''))).toEqual([
    '关闭终端',
  ])
  expect(text).not.toContain('闪烁方块表示输入位置')
  expect(text).not.toContain('outline: 2px')
  expect(navigator.clipboard.readText).not.toHaveBeenCalled()
})

function clipboardEvent(text: string): Event {
  const event = new Event('paste', { cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
  })
  return event
}

it.each([
  { key: 'v', code: 'KeyV', ctrlKey: true },
  { key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true },
  { key: 'v', code: 'KeyV', metaKey: true },
  { key: 'Insert', shiftKey: true },
])('leaves paste shortcut $key to the native clipboard event and writes it exactly once', async (keys) => {
  const f = await setup()
  await f.start()
  const shortcut = {
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    type: 'keydown',
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
    ...keys,
  }
  expect(terminals[0].keyHandler(shortcut)).toBe(false)
  expect(shortcut.preventDefault).not.toHaveBeenCalled()
  expect(f.accountWrite).not.toHaveBeenCalled()
  const text = '模拟授权值 中文😀\r\n第二行\n第三行'
  const event = clipboardEvent(text)
  await act(async () => {
    f.container.dispatchEvent(event)
  })
  expect(event.defaultPrevented).toBe(true)
  expect(terminals[0].paste).toHaveBeenCalledExactlyOnceWith(text)
  expect(f.accountWrite).toHaveBeenCalledExactlyOnceWith('parent', 'terminal-a', text)
  expect(navigator.clipboard.readText).not.toHaveBeenCalled()
})

it('preserves ordinary terminal keys and IME combinations', async () => {
  const f = await setup()
  await f.start()
  for (const keys of [
    { key: 'c', ctrlKey: true },
    { key: 'c', metaKey: true },
    { key: 'v', altKey: true, metaKey: true },
    { key: 'v', ctrlKey: true, metaKey: true },
    { key: 'v', altKey: true, ctrlKey: true },
    { key: 'v', ctrlKey: true, isComposing: true },
    { key: 'v', metaKey: true, isComposing: true },
    { key: 'Insert' },
  ])
    expect(terminals[0].keyHandler({ ctrlKey: false, metaKey: false, ...keys })).toBe(true)
})

it('keeps the Mac Command-V key lifecycle native and does not paste again on keyup', async () => {
  const f = await setup()
  await f.start()
  const key = (type: string) => ({
    type,
    key: 'v',
    code: 'KeyV',
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  })
  const down = key('keydown')
  expect(terminals[0].keyHandler(down)).toBe(false)
  expect(down.preventDefault).not.toHaveBeenCalled()
  await act(async () => {
    f.container.dispatchEvent(clipboardEvent('Mac 原生粘贴😀'))
  })
  for (const type of ['keypress', 'keyup']) {
    const event = key(type)
    expect(terminals[0].keyHandler(event)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  }
  expect(navigator.clipboard.readText).not.toHaveBeenCalled()
  expect(terminals[0].paste).toHaveBeenCalledExactlyOnceWith('Mac 原生粘贴😀')
  expect(f.accountWrite).toHaveBeenCalledExactlyOnceWith('parent', 'terminal-a', 'Mac 原生粘贴😀')
})

it('accepts native Edit-menu paste without a keyboard event or async clipboard permission', async () => {
  const f = await setup()
  await f.start()
  vi.stubGlobal('navigator', {})
  await act(async () => {
    f.container.dispatchEvent(clipboardEvent('菜单粘贴\n第二行'))
  })
  expect(terminals[0].paste).toHaveBeenCalledExactlyOnceWith('菜单粘贴\n第二行')
  expect(f.accountWrite).toHaveBeenCalledExactlyOnceWith('parent', 'terminal-a', '菜单粘贴\n第二行')
})

it('reads the clipboard only on a deliberate right-click paste and adds no submit key', async () => {
  const f = await setup()
  const text = '测试粘贴 中文😀\n第二行'
  vi.mocked(navigator.clipboard.readText).mockResolvedValue(text)
  await f.start()
  expect(navigator.clipboard.readText).not.toHaveBeenCalled()
  await f.contextClipboard()
  expect(navigator.clipboard.readText).toHaveBeenCalledOnce()
  expect(terminals[0].paste).toHaveBeenCalledExactlyOnceWith(text)
  expect(f.accountWrite).toHaveBeenCalledExactlyOnceWith('parent', 'terminal-a', text)
})

it.each([{ ctrlKey: true }, { metaKey: true }])(
  'lets selected Ctrl/Command-C use xterm native copy without also writing the clipboard',
  async (modifier) => {
    const f = await setup()
    await f.start()
    terminals[0].hasSelection.mockReturnValue(true)
    const event = {
      key: 'c',
      code: 'KeyC',
      type: 'keydown',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      ...modifier,
    }
    expect(terminals[0].keyHandler(event)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(clipboardWrites).not.toHaveBeenCalled()
    expect(navigator.clipboard.readText).not.toHaveBeenCalled()
    expect(f.accountWrite).not.toHaveBeenCalled()
  },
)

it('keeps unselected Ctrl-C as the CLI interrupt instead of copying', async () => {
  const f = await setup()
  await f.start()
  expect(terminals[0].keyHandler({ key: 'c', ctrlKey: true, metaKey: false })).toBe(true)
  await act(async () => {
    terminals[0].input('\x03')
  })
  expect(f.accountWrite).toHaveBeenCalledExactlyOnceWith('parent', 'terminal-a', '\x03')
  expect(clipboardWrites).not.toHaveBeenCalled()
})

it('copies the selected terminal text on right click instead of pasting, without rendering it', async () => {
  const f = await setup()
  await f.start()
  const text = '模拟选区 中文😀\n第二行'
  terminals[0].hasSelection.mockReturnValue(true)
  terminals[0].getSelection.mockReturnValue(text)
  await f.contextClipboard()
  expect(clipboardWrites).toHaveBeenCalledExactlyOnceWith(text)
  expect(navigator.clipboard.readText).not.toHaveBeenCalled()
  expect(terminals[0].clearSelection).toHaveBeenCalledOnce()
  expect(f.accountWrite).not.toHaveBeenCalled()
  expect(JSON.stringify(f.renderer.toJSON())).not.toContain(text)
})

it('does not refocus or clear another terminal when a selected copy completes after closing', async () => {
  const f = await setup()
  await f.start()
  const copied = deferred<boolean>()
  clipboardWrites.mockReturnValueOnce(copied.promise)
  terminals[0].hasSelection.mockReturnValue(true)
  terminals[0].getSelection.mockReturnValue('模拟待完成复制')
  await f.contextClipboard()
  await f.close()
  await act(async () => {
    copied.resolve(true)
  })
  expect(terminals[0].clearSelection).not.toHaveBeenCalled()
  expect(terminals[0].focus).toHaveBeenCalledOnce()
  expect(navigator.clipboard.readText).not.toHaveBeenCalled()
})

it('reports a safe copy failure and preserves the selection for retry', async () => {
  const f = await setup()
  await f.start()
  terminals[0].hasSelection.mockReturnValue(true)
  terminals[0].getSelection.mockReturnValue('模拟不可外泄文本')
  clipboardWrites.mockRejectedValueOnce(new Error('模拟不可外泄文本'))
  await f.contextClipboard()
  expect(terminals[0].clearSelection).not.toHaveBeenCalled()
  expect(JSON.stringify(f.renderer.toJSON())).toContain('复制失败，请重新选择文本后重试')
  expect(JSON.stringify(f.renderer.toJSON())).not.toContain('模拟不可外泄文本')
})

it('does not race duplicate clipboard reads or strip the bracketed paste emitted by xterm', async () => {
  const f = await setup()
  await f.start()
  const read = deferred<string>()
  vi.mocked(navigator.clipboard.readText).mockReturnValue(read.promise)
  const bracketed = '\u001b[200~模拟中文😀\r第二行\u001b[201~'
  terminals[0].paste.mockImplementation(() => terminals[0].input(bracketed))
  await f.contextClipboard()
  await f.contextClipboard()
  expect(navigator.clipboard.readText).toHaveBeenCalledOnce()
  await act(async () => {
    read.resolve('模拟中文😀\n第二行')
  })
  expect(f.accountWrite).toHaveBeenCalledExactlyOnceWith('parent', 'terminal-a', bracketed)
})

it.each(['close', 'change', 'unmount'])(
  'discards a clipboard read that finishes after %s without leaking into another terminal',
  async (action) => {
    const f = await setup()
    await f.start()
    const read = deferred<string>()
    vi.mocked(navigator.clipboard.readText).mockReturnValue(read.promise)
    await f.contextClipboard()
    if (action === 'close') await f.close()
    else if (action === 'unmount') await f.unmount()
    else {
      await f.update('codex', 'manage')
      await f.start('next-terminal', 1)
    }
    await act(async () => {
      read.resolve('模拟迟到授权值')
    })
    expect(f.accountWrite).not.toHaveBeenCalled()
    expect(terminals[0].paste).not.toHaveBeenCalled()
    if (action === 'change') expect(terminals[1].paste).not.toHaveBeenCalled()
  },
)

it('reports unavailable or empty clipboard without exposing data or suppressing later native paste', async () => {
  const f = await setup()
  await f.start()
  vi.mocked(navigator.clipboard.readText).mockRejectedValueOnce(
    new Error('secret simulated clipboard failure'),
  )
  await f.contextClipboard()
  expect(JSON.stringify(f.renderer.toJSON())).toContain('无法读取剪贴板')
  expect(JSON.stringify(f.renderer.toJSON())).not.toContain('secret')
  vi.mocked(navigator.clipboard.readText).mockResolvedValueOnce('')
  await f.contextClipboard()
  expect(JSON.stringify(f.renderer.toJSON())).toContain('剪贴板中没有可粘贴的文本')
  expect(f.accountWrite).not.toHaveBeenCalled()
  await act(async () => {
    f.container.dispatchEvent(clipboardEvent('可用的原生粘贴'))
  })
  expect(f.accountWrite).toHaveBeenCalledExactlyOnceWith('parent', 'terminal-a', '可用的原生粘贴')
})

it('bounds pasted UTF-8 bytes before Gateway writes and removes the native paste listener on unmount', async () => {
  const f = await setup()
  await f.start()
  await act(async () => {
    f.container.dispatchEvent(clipboardEvent('中'.repeat(6_000)))
  })
  expect(f.accountWrite).not.toHaveBeenCalled()
  expect(JSON.stringify(f.renderer.toJSON())).toContain('输入过长或仍在发送')
  const accepted = '😀'.repeat(4_000)
  await act(async () => {
    f.container.dispatchEvent(clipboardEvent(accepted))
  })
  expect(f.accountWrite).toHaveBeenCalledExactlyOnceWith('parent', 'terminal-a', accepted)
  await f.unmount()
  const event = clipboardEvent('卸载后的内容')
  f.container.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
  expect(f.accountWrite).toHaveBeenCalledOnce()
})

// Simulated native prompt and OAuth URL only; never real authorization material.
const simulatedLoginUrl =
  'https://chat.z.ai/api/oauth/authorize?client_id=fixture&state=simulated-state&redirect_uri=https%3A%2F%2Fexample.invalid%2Fcallback&response_type=code'
const simulatedLoginPrompt = `Open this URL to sign in:\r\n${simulatedLoginUrl}\r\n`
const simulatedBigModelUrl =
  'https://bigmodel.cn/login?appId=fixture&redirect=https%3A%2F%2Fexample.invalid%2Fcallback&state=simulated-state'

it('opens a parsed ZCode login page once and registers its native terminal link without extra controls', async () => {
  const f = await setup(false)
  await f.update('zcode', 'login')
  await f.start()
  await act(async () => {
    f.streams[0].push({ seq: 1, data: simulatedLoginPrompt.slice(0, 31) })
    f.streams[0].push({ seq: 2, data: simulatedLoginPrompt.slice(31) })
  })
  expect(window.open).toHaveBeenCalledExactlyOnceWith(simulatedLoginUrl, '_blank', 'noopener,noreferrer')
  const rendered = JSON.stringify(f.renderer.toJSON())
  expect(rendered).not.toContain('打开登录网页')
  expect(rendered).not.toContain(simulatedLoginUrl)
  expect(rendered).not.toContain('simulated-state')
  expect(terminals[0].registerLinkProvider).toHaveBeenCalledOnce()
  expect(terminals[0].linkProvider.currentUrl()).toBe(simulatedLoginUrl)
  await act(async () => {
    f.streams[0].push({ seq: 2, data: simulatedLoginPrompt })
    f.streams[0].push({ seq: 3, data: simulatedLoginPrompt })
  })
  expect(window.open).toHaveBeenCalledOnce()
  await act(async () => {
    terminals[0].linkProvider.activate(simulatedLoginUrl)
  })
  expect(window.open).toHaveBeenCalledTimes(2)
  expect(f.accountWrite).not.toHaveBeenCalled()
})

it('does not open a Z.AI link during an explicitly selected BigModel login', async () => {
  const f = await setup(false)
  await f.update('zcode', 'login', undefined, 'bigmodel')
  await f.start()
  await act(async () => {
    f.streams[0].push({ seq: 1, data: simulatedLoginPrompt })
  })
  expect(window.open).not.toHaveBeenCalled()
  expect(terminals[0].linkProvider.currentUrl()).toBeUndefined()
  expect(f.accountWrite).not.toHaveBeenCalled()
})

it.each([
  ['bigmodel', simulatedBigModelUrl, simulatedLoginUrl],
  ['zai', simulatedLoginUrl, simulatedBigModelUrl],
] as const)(
  'automatically opens only the selected %s login URL once, preserving clickable text and cleanup',
  async (provider, selectedUrl, otherUrl) => {
    const f = await setup(false)
    await f.update('zcode', 'login', undefined, provider)
    await f.start()
    const prompt = `Open this URL to sign in:\r\n${selectedUrl}\r\n`
    await act(async () => {
      f.streams[0].push({ seq: 1, data: `Open this URL to sign in:\r\n${otherUrl}\r\n` })
    })
    expect(window.open).not.toHaveBeenCalled()
    await act(async () => {
      f.streams[0].push({ seq: 2, data: prompt.slice(0, 47) })
      f.streams[0].push({ seq: 3, data: prompt.slice(47) })
      f.streams[0].push({ seq: 4, data: prompt })
    })
    expect(window.open).toHaveBeenCalledExactlyOnceWith(selectedUrl, '_blank', 'noopener,noreferrer')
    const link = terminals[0].linkProvider
    expect(link.currentUrl()).toBe(selectedUrl)
    expect(JSON.stringify(f.renderer.toJSON())).not.toContain('simulated-state')
    expect(JSON.stringify(f.renderer.toJSON())).not.toContain('打开登录网页')
    await act(async () => {
      link.activate(selectedUrl)
    })
    expect(window.open).toHaveBeenCalledTimes(2)
    expect(f.accountWrite).not.toHaveBeenCalled()
    await f.close()
    expect(link.currentUrl()).toBeUndefined()
    await act(async () => {
      link.activate(selectedUrl)
    })
    expect(window.open).toHaveBeenCalledTimes(2)
  },
)

it.each([
  ['codex', 'login'],
  ['claude', 'login'],
  ['zcode', 'manage'],
  ['zcode', 'logout'],
] as const)('does not promote login-looking output to navigation for %s %s', async (cli, action) => {
  const f = await setup(false)
  await f.update(cli, action)
  await f.start()
  await act(async () => {
    f.streams[0].push({ seq: 1, data: simulatedLoginPrompt })
  })
  expect(JSON.stringify(f.renderer.toJSON())).not.toContain('打开登录网页')
  expect(terminals[0].registerLinkProvider).not.toHaveBeenCalled()
  expect(window.open).not.toHaveBeenCalled()
})

it('does not navigate arbitrary terminal links or OSC hyperlinks', async () => {
  const f = await setup(false)
  await f.update('zcode', 'login')
  await f.start()
  await act(async () => {
    f.streams[0].push({
      seq: 1,
      data: `https://example.invalid/login\r\n\u001b]8;;${simulatedLoginUrl}\u0007click\u001b]8;;\u0007\r\n`,
    })
    f.streams[0].push({
      seq: 2,
      data: 'Open this URL to sign in:\r\nhttps://example.invalid/api/oauth/authorize\r\n',
    })
  })
  terminals[0].options.linkHandler.activate({}, simulatedLoginUrl)
  expect(JSON.stringify(f.renderer.toJSON())).not.toContain('打开登录网页')
  expect(window.open).not.toHaveBeenCalled()
})

it.each(['close', 'closed', 'failed', 'change', 'retry', 'unmount'])(
  'invalidates the native login link on %s, including a stale link callback',
  async (action) => {
    const f = await setup(false)
    await f.update('zcode', 'login')
    await f.start()
    await act(async () => {
      f.streams[0].push({ seq: 1, data: simulatedLoginPrompt })
    })
    const link = terminals[0].linkProvider
    expect(window.open).toHaveBeenCalledOnce()
    if (action === 'close') await f.close()
    else if (action === 'change') {
      await f.update('kimi', 'login')
      await f.start('next-terminal', 1)
    } else if (action === 'unmount') await f.unmount()
    else {
      await act(async () => {
        f.streams[0].push({
          seq: 2,
          status: action === 'failed' ? 'failed' : 'closed',
          cleanupConfirmed: true,
        })
      })
      if (action === 'retry') {
        // ZCode signs in through the guided window.
        await f.click('重新开始登录')
        await f.start('retry-terminal', 1)
      }
    }
    await act(async () => {
      link.activate(simulatedLoginUrl)
    })
    expect(link.currentUrl()).toBeUndefined()
    expect(window.open).toHaveBeenCalledOnce()
    if (action !== 'unmount') expect(JSON.stringify(f.renderer.toJSON())).not.toContain('打开登录网页')
    if (['change', 'retry', 'unmount'].includes(action))
      expect(terminals[0].linkDisposal).toHaveBeenCalledOnce()
  },
)

it('does not restore a login link from output arriving during a pending close', async () => {
  const f = await setup(false)
  await f.update('zcode', 'login')
  await f.start()
  const cleanup = deferred()
  f.accountStop.mockReturnValueOnce(cleanup.promise)
  await f.close()
  await act(async () => {
    f.streams[0].push({ seq: 1, data: simulatedLoginPrompt })
  })
  expect(JSON.stringify(f.renderer.toJSON())).not.toContain('打开登录网页')
  expect(window.open).not.toHaveBeenCalled()
  await act(async () => {
    cleanup.resolve(ok())
  })
})
it.each(['bigmodel', 'zai'] as const)(
  'starts only the explicit ZCode %s provider and preserves cleanup',
  async (provider) => {
    const f = await setup(false)
    await f.update('zcode', 'login', undefined, provider)
    expect(f.accountStartForProvider).toHaveBeenCalledExactlyOnceWith(
      'parent',
      'zcode',
      'login',
      provider,
      expect.any(AbortSignal),
    )
    expect(f.accountStart).not.toHaveBeenCalled()
    expect(f.accountStartForSource).not.toHaveBeenCalled()
    await f.start()
    expect(f.accountWrite).not.toHaveBeenCalled()
    await f.close()
    expect(f.accountStop).toHaveBeenCalledExactlyOnceWith('parent', 'terminal-a')
  },
)
it('fails clearly instead of falling back to default login when the Host lacks provider selection', async () => {
  const f = await setup(false)
  delete (f.api.cliworker as any).accountStartForProvider
  await f.update('zcode', 'login', undefined, 'bigmodel')
  expect(f.accountStart).not.toHaveBeenCalled()
  expect(f.accountStartForSource).not.toHaveBeenCalled()
  expect(f.starts).toHaveLength(0)
  expect(JSON.stringify(f.renderer.toJSON())).toContain('当前插件 Host 不支持 ZCode 授权来源选择')
})
it('cancels provider startup and reclaims a late terminal without changing its provider', async () => {
  const f = await setup(false)
  await f.update('zcode', 'login', undefined, 'bigmodel')
  const signal = f.accountStartForProvider.mock.calls[0][4] as AbortSignal
  await f.unmount()
  expect(signal.aborted).toBe(true)
  await f.start('late-bigmodel')
  expect(f.accountStop).toHaveBeenCalledExactlyOnceWith('parent', 'late-bigmodel')
  expect(f.accountWatch).not.toHaveBeenCalled()
  expect(f.accountStart).not.toHaveBeenCalled()
})
it('keeps an unsupported BigModel capability failure visible and never retries another provider', async () => {
  const f = await setup(false)
  await f.update('zcode', 'login', undefined, 'bigmodel')
  await act(async () => {
    f.starts[0].reject(
      new Error(
        '当前 ZCode CLI 不支持智谱 BigModel 授权，请更新为支持 login bigmodel 的官方完整 CLI 后重试；不会改用 Z.AI 登录。',
      ),
    )
  })
  expect(JSON.stringify(f.renderer.toJSON())).toContain('不会改用 Z.AI 登录')
  expect(f.accountStartForProvider).toHaveBeenCalledOnce()
  expect(f.accountStart).not.toHaveBeenCalled()
  expect(f.accountWatch).not.toHaveBeenCalled()
})
it.each(['native', 'plugin'] as const)(
  'starts only the explicit %s account source through the scoped API',
  async (source) => {
    const fixture = await setup(false)
    await fixture.update('omp', 'logout', source)
    expect(fixture.accountStart).not.toHaveBeenCalled()
    expect(fixture.accountStartForSource).toHaveBeenCalledExactlyOnceWith(
      'parent',
      'omp',
      'logout',
      source,
      expect.any(AbortSignal),
    )
    await fixture.start()
    expect(fixture.accountWrite).not.toHaveBeenCalled()
    await fixture.close()
    expect(fixture.accountStop).toHaveBeenCalledWith('parent', 'terminal-a')
  },
)
it('aborts a source-specific start and cleans up its late terminal when the source changes', async () => {
  const fixture = await setup(false)
  await fixture.update('pi', 'logout', 'native')
  const signal = fixture.accountStartForSource.mock.calls[0][4] as AbortSignal
  await fixture.update('pi', 'logout', 'plugin')
  expect(signal.aborted).toBe(true)
  expect(fixture.accountStartForSource).toHaveBeenNthCalledWith(
    2,
    'parent',
    'pi',
    'logout',
    'plugin',
    expect.any(AbortSignal),
  )
  await fixture.start('late-native', 0)
  expect(fixture.accountStop).toHaveBeenCalledWith('parent', 'late-native')
  expect(fixture.accountWatch).not.toHaveBeenCalled()
  await fixture.start('current-plugin', 1)
  expect(fixture.accountWatch).toHaveBeenCalledExactlyOnceWith(
    'parent',
    'current-plugin',
    expect.any(AbortSignal),
  )
})

it('aborts an unmounted start and cleans up its late terminal id without opening a stream', async () => {
  const fixture = await setup()
  const signal = fixture.accountStart.mock.calls[0][3] as AbortSignal
  await fixture.unmount()
  expect(signal.aborted).toBe(true)
  expect(terminals[0].dispose).toHaveBeenCalledOnce()
  await fixture.start('late-terminal')
  expect(fixture.accountStop).toHaveBeenCalledWith('parent', 'late-terminal')
  expect(fixture.accountWatch).not.toHaveBeenCalled()
  expect(fixture.onFinished).not.toHaveBeenCalled()
})

it('keeps a cancelled pending start closed even if its parent has not unmounted yet', async () => {
  const fixture = await setup()
  const signal = fixture.accountStart.mock.calls[0][3] as AbortSignal
  await fixture.close()
  expect(signal.aborted).toBe(true)
  expect(fixture.onClose).toHaveBeenCalledOnce()
  await fixture.start('cancelled-terminal')
  expect(fixture.accountStop).toHaveBeenCalledWith('parent', 'cancelled-terminal')
  expect(fixture.accountWatch).not.toHaveBeenCalled()
  expect(terminals[0].options.disableStdin).toBe(true)
})

it('disables input on a terminal completion and notifies completion only once', async () => {
  const fixture = await setup()
  await fixture.start()
  await act(async () => {
    fixture.streams[0].push({ seq: 1, data: 'ready\r\n' })
    fixture.streams[0].push({ seq: 1, data: 'duplicate' })
    fixture.streams[0].push({ seq: 2, status: 'closed' })
  })
  expect(terminals[0].write.mock.calls).toEqual([['ready\r\n']])
  expect(terminals[0].options.disableStdin).toBe(true)
  expect(fixture.onFinished).toHaveBeenCalledOnce()
  await act(async () => {
    terminals[0].input('ignored input')
  })
  expect(fixture.accountWrite).not.toHaveBeenCalled()
  await fixture.close()
  expect(fixture.onFinished).toHaveBeenCalledOnce()
  expect(fixture.onClose).toHaveBeenCalledOnce()
})

it('also disables input when the remote stream ends without a final status frame', async () => {
  const fixture = await setup()
  await fixture.start()
  await act(async () => {
    fixture.streams[0].end()
  })
  expect(terminals[0].options.disableStdin).toBe(true)
  expect(fixture.onFinished).toHaveBeenCalledOnce()
  await act(async () => {
    terminals[0].input('ignored input')
  })
  expect(fixture.accountWrite).not.toHaveBeenCalled()
})

it.each(['closed', 'failed'] as const)(
  'closes an explicitly cleaned %s terminal after Host retention expires without another stop RPC',
  async (status) => {
    vi.useFakeTimers()
    const fixture = await setup()
    await fixture.start()
    await act(async () => {
      fixture.streams[0].push({ seq: 1, status, cleanupConfirmed: true })
      await vi.advanceTimersByTimeAsync(61_000)
    })
    fixture.accountStop.mockRejectedValue(new Error('synthetic expired terminal'))
    await fixture.close()
    await fixture.close()
    await fixture.unmount()
    expect(fixture.accountStop).not.toHaveBeenCalled()
    expect(fixture.onClose).toHaveBeenCalledTimes(2)
  },
)

it('keeps an unconfirmed failed terminal retryable until stop succeeds', async () => {
  const fixture = await setup()
  await fixture.start()
  await act(async () => {
    fixture.streams[0].push({ seq: 1, status: 'failed', cleanupConfirmed: false })
  })
  fixture.accountStop.mockRejectedValueOnce(new Error('synthetic cleanup failure'))
  await fixture.close()
  expect(fixture.onClose).not.toHaveBeenCalled()
  expect(JSON.stringify(fixture.renderer.toJSON())).toContain('终端关闭失败')
  await fixture.close()
  expect(fixture.accountStop).toHaveBeenCalledTimes(2)
  expect(fixture.onClose).toHaveBeenCalledOnce()
})

it('serializes typed chunks so a slow write cannot reorder CLI input', async () => {
  const fixture = await setup()
  await fixture.start()
  const first = deferred()
  fixture.accountWrite.mockImplementationOnce(() => first.promise)
  await act(async () => {
    terminals[0].input('first')
    terminals[0].input('second')
    terminals[0].input('\r')
  })
  expect(fixture.accountWrite.mock.calls).toEqual([['parent', 'terminal-a', 'first']])
  await act(async () => {
    first.resolve(ok())
  })
  expect(fixture.accountWrite.mock.calls).toEqual([
    ['parent', 'terminal-a', 'first'],
    ['parent', 'terminal-a', 'second'],
    ['parent', 'terminal-a', '\r'],
  ])
})

it('cleans up an old delayed start without stopping the newly selected CLI terminal', async () => {
  const fixture = await setup()
  const oldSignal = fixture.accountStart.mock.calls[0][3] as AbortSignal
  await fixture.update('claude', 'login')
  expect(oldSignal.aborted).toBe(true)
  await fixture.start('new-terminal', 1)
  await fixture.start('old-terminal', 0)
  expect(fixture.accountStop.mock.calls).toEqual([['parent', 'old-terminal']])
  expect(fixture.accountWatch.mock.calls.map((args) => args[1])).toEqual(['new-terminal'])
  expect(terminals[1].options.disableStdin).toBe(false)
  expect(fixture.onFinished).not.toHaveBeenCalled()
})

it('shows a recoverable error instead of an endless spinner when terminal construction fails', async () => {
  faults.constructor = true
  const fixture = await setup()
  expect(fixture.accountStart).not.toHaveBeenCalled()
  expect(JSON.stringify(fixture.renderer.toJSON())).toContain('账号终端显示未能初始化')
  expect(fixture.renderer.root.findAllByProps({ 'data-state': 'ongoing' })).toHaveLength(0)
  await fixture.click('重试')
  expect(fixture.accountStart).toHaveBeenCalledOnce()
  await fixture.start()
  expect(terminals[0].options.disableStdin).toBe(false)
})

it('disposes a partially initialized terminal and can retry without crashing the parent page', async () => {
  faults.open = true
  const fixture = await setup()
  expect(fixture.accountStart).not.toHaveBeenCalled()
  expect(terminals[0].dispose).toHaveBeenCalledOnce()
  await fixture.click('重试')
  expect(terminals[0].dispose).toHaveBeenCalledOnce()
  await fixture.start()
  expect(terminals[1].options.disableStdin).toBe(false)
})

it('bounds an unresponsive startup, supports retry, and still cleans a late old terminal', async () => {
  vi.useFakeTimers()
  const fixture = await setup()
  const oldSignal = fixture.accountStart.mock.calls[0][3] as AbortSignal
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000)
  })
  expect(oldSignal.aborted).toBe(true)
  expect(JSON.stringify(fixture.renderer.toJSON())).toContain('启动超过 20 秒')
  expect(fixture.renderer.root.findAllByProps({ 'data-state': 'ongoing' })).toHaveLength(0)
  await fixture.click('重试')
  expect(fixture.accountStart).toHaveBeenCalledTimes(2)
  await fixture.start('retry-terminal', 1)
  await fixture.start('timed-out-terminal', 0)
  expect(fixture.accountStop.mock.calls).toEqual([['parent', 'timed-out-terminal']])
  expect(fixture.accountWatch.mock.calls.map((args) => args[1])).toEqual(['retry-terminal'])
  expect(terminals[1].options.disableStdin).toBe(false)
})

it('lets a failed RPC be retried without automatically retrying the login action', async () => {
  const fixture = await setup()
  await act(async () => {
    fixture.starts[0].reject(new Error('simulated gateway failure'))
  })
  expect(fixture.accountStart).toHaveBeenCalledOnce()
  expect(fixture.renderer.root.findAllByProps({ 'data-state': 'ongoing' })).toHaveLength(0)
  await fixture.click('重试')
  expect(fixture.accountStart).toHaveBeenCalledTimes(2)
  await fixture.start('retry-terminal', 1)
  expect(terminals[1].options.disableStdin).toBe(false)
})

it('bounds the closing spinner and waits for cleanup before permitting a retry', async () => {
  vi.useFakeTimers()
  const fixture = await setup()
  await fixture.start()
  const cleanup = deferred()
  fixture.accountStop.mockImplementation(() => cleanup.promise)
  await fixture.close()
  expect(fixture.renderer.root.findAllByProps({ 'data-state': 'ongoing' })).toHaveLength(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12_000)
  })
  expect(fixture.renderer.root.findAllByProps({ 'data-state': 'ongoing' })).toHaveLength(0)
  expect(JSON.stringify(fixture.renderer.toJSON())).toContain('终端关闭失败，请重试')
  expect(fixture.onClose).not.toHaveBeenCalled()
  await fixture.click('重试')
  expect(fixture.accountStart).toHaveBeenCalledOnce()
  await act(async () => {
    cleanup.resolve(ok())
  })
  expect(fixture.accountStart).toHaveBeenCalledTimes(2)
  await fixture.start('retry-terminal', 1)
})

it('uses one close operation for modal and terminal controls and retries the same session after failure', async () => {
  const f = await setup()
  await f.start()
  const pending = deferred()
  f.accountStop.mockReturnValueOnce(pending.promise)
  let closed!: Promise<boolean>
  await act(async () => {
    closed = f.closeControl.current!()
    expect(f.closeControl.current!()).toBe(closed)
  })
  await f.close()
  expect(f.accountStop).toHaveBeenCalledOnce()
  await act(async () => pending.reject(new Error('fixture cleanup failure')))
  expect(await closed).toBe(false)
  expect(f.onClose).not.toHaveBeenCalled()
  expect(f.accountStart).toHaveBeenCalledOnce()
  await act(async () => {
    expect(await f.closeControl.current!()).toBe(true)
  })
  expect(f.accountStop.mock.calls).toEqual([
    ['parent', 'terminal-a'],
    ['parent', 'terminal-a'],
  ])
  expect(f.onClose).toHaveBeenCalledOnce()
})

it.each([
  ['当前 ZCode 未声明原生登录能力，请检查 CLI 安装', '当前 ZCode 未声明原生登录能力'],
  ['Codex Windows 应用包入口无法确认，请检查安装', 'Codex Windows 应用包入口无法确认'],
  ['检测到 Hermes 安装目录，但未找到可用 CLI 入口，请完成安装或配置已有入口', '未找到可用 CLI 入口'],
  ['secret token ABC https://private.example/account', '账号终端暂不可用'],
])('only displays whitelisted startup diagnostics: %s', async (message, expected) => {
  const f = await setup()
  await act(async () => f.starts[0].reject(new Error(message)))
  const text = JSON.stringify(f.renderer.toJSON())
  expect(text).toContain(expected)
  expect(text).not.toContain('secret token')
})

it('drops unsent input once the user starts closing the terminal', async () => {
  const fixture = await setup()
  await fixture.start()
  const first = deferred()
  const cleanup = deferred()
  fixture.accountWrite.mockImplementationOnce(() => first.promise)
  fixture.accountStop.mockImplementation(() => cleanup.promise)
  await act(async () => {
    terminals[0].input('first')
    terminals[0].input('queued')
  })
  await fixture.close()
  await act(async () => {
    first.resolve(ok())
  })
  expect(fixture.accountWrite.mock.calls).toEqual([['parent', 'terminal-a', 'first']])
  await act(async () => {
    cleanup.resolve(ok())
  })
})

it.each(['end', 'fail'] as const)('uses a connection diagnostic after startup when the stream %s (模拟)', async (method) => {
  const f = await setup()
  await f.start()
  await act(async () => f.streams[0][method]())
  const text = JSON.stringify(f.renderer.toJSON())
  expect(text).toContain('账号终端连接已结束，请重试')
  expect(text).not.toContain('账号终端暂不可用')
  expect(f.accountStop).toHaveBeenCalledWith('parent', 'terminal-a')
  expect(f.onFinished).toHaveBeenCalledOnce()
})

it('immediately releases a failed stream even while process cleanup is still pending', async () => {
  const fixture = await setup()
  await fixture.start()
  const cleanup = deferred()
  fixture.accountStop.mockImplementation(() => cleanup.promise)
  await act(async () => {
    fixture.streams[0].fail()
  })
  expect(fixture.streams[0].dispose).toHaveBeenCalledOnce()
  expect(fixture.accountStop).toHaveBeenCalledWith('parent', 'terminal-a')
  expect(terminals[0].options.disableStdin).toBe(true)
  expect(fixture.onFinished).toHaveBeenCalledOnce()
  await fixture.unmount()
  expect(fixture.streams[0].dispose).toHaveBeenCalledOnce()
  expect(fixture.accountStop).toHaveBeenCalledOnce()
  await act(async () => {
    cleanup.resolve(ok())
  })
})

describe('退出终端与结果页（模拟 Host 帧）', () => {
  const cases: { cli: CliId; login?: string }[] = [
    { cli: 'antigravity' }, { cli: 'codex' }, { cli: 'claude' }, { cli: 'qoder' },
    { cli: 'qodercn' }, { cli: 'grok' }, { cli: 'zcode' }, { cli: 'mimo' },
    { cli: 'kimi', login: 'kimi:kimi-code' }, { cli: 'omp', login: 'omp:anthropic:1' },
    { cli: 'pi', login: 'pi:anthropic' }, { cli: 'opencode', login: 'opencode:deepseek' },
    { cli: 'hermes', login: 'hermes:deepseek:a1b2c3' },
  ]
  const hidden = (f: Awaited<ReturnType<typeof setup>>) =>
    f.renderer.root.findByProps({ className: 'cwn-account-terminal-view' }).props.hidden

  it.each(cases)('$cli keeps native fallback and result hidden until manually opened', async ({ cli, login }) => {
    const f = await setup(false)
    await f.update(cli, 'logout', undefined, undefined, false, { login })
    await f.start()
    expect(hidden(f)).toBe(true)
    await act(async () => f.streams[0].push({
      seq: 1, guide: { step: 'native', tone: 'warning', template: 'native', text: '模拟未识别步骤' },
    }))
    expect(hidden(f)).toBe(true)
    expect(terminals[0].focus).not.toHaveBeenCalled()
    expect(JSON.stringify(f.renderer.toJSON())).toContain('请点击「显示原生终端」')
    await f.click('显示原生终端')
    expect(hidden(f)).toBe(false)
    expect(terminals[0].focus).toHaveBeenCalled()
    await act(async () => terminals[0].input('模拟菜单输入\r'))
    expect(f.accountWrite).toHaveBeenCalledWith('parent', 'terminal-a', '模拟菜单输入\r')
    await f.click('隐藏原生终端')
    await act(async () => {
      f.streams[0].push({
        seq: 2, guide: { step: 'loggedOut', tone: 'success', template: 'result', text: '模拟已退出' },
        message: '账号终端暂不可用，请确认此 CLI 没有运行任务且当前项目允许执行，再重试',
      })
      f.streams[0].push({ seq: 3, status: 'closed', cleanupConfirmed: true, message: '账号终端已关闭' })
    })
    expect(hidden(f)).toBe(true)
    expect(f.renderer.root.findByProps({ className: 'cwn-login-notice' }).children).toEqual([])
    expect(JSON.stringify(f.renderer.toJSON())).not.toContain('账号终端暂不可用')
    expect(JSON.stringify(f.renderer.toJSON())).not.toContain('账号终端已关闭')
    await f.click('显示原生终端')
    expect(hidden(f)).toBe(false)
    await f.click('完成')
    expect(f.onClose).toHaveBeenCalledOnce()
    expect(f.accountStop).not.toHaveBeenCalled()
  })

  it.each(['kimi', 'omp', 'pi', 'opencode', 'hermes'] as const)('%s preserves manual source-menu input without a login id', async (cli) => {
    const f = await setup(false)
    await f.update(cli, 'logout', 'native')
    await f.start()
    expect(f.accountStartForSource).toHaveBeenCalledWith('parent', cli, 'logout', 'native', expect.any(AbortSignal))
    expect(hidden(f)).toBe(true)
    expect(JSON.stringify(f.renderer.toJSON())).toContain('模拟账号交互')
    expect(JSON.stringify(f.renderer.toJSON())).toContain('请点击「显示原生终端」')
    await f.click('显示原生终端')
    await act(async () => terminals[0].input('/logout\r'))
    expect(f.accountWrite).toHaveBeenCalledExactlyOnceWith('parent', 'terminal-a', '/logout\r')
    await f.click('隐藏原生终端')
    await act(async () => f.streams[0].push({ seq: 1, status: 'closed', cleanupConfirmed: true }))
    expect(hidden(f)).toBe(true)
    expect(JSON.stringify(f.renderer.toJSON())).not.toContain('模拟已退出')
  })

  it.each([
    { cli: 'qoder' as const, action: 'login' as const, step: 'signedIn', tone: 'success' as const },
    { cli: 'zcode' as const, action: 'logout' as const, step: 'loggedOut', tone: 'success' as const },
    { cli: 'grok' as const, action: 'logout' as const, step: 'logoutUnconfirmed', tone: 'warning' as const },
  ])('$cli result suppresses notices even when the stream fails afterwards', async ({ cli, action, step, tone }) => {
    const f = await setup(false)
    await f.update(cli, action)
    await f.start()
    await act(async () => f.streams[0].push({
      seq: 1, guide: { step, tone, template: 'result', text: '模拟结果' },
      message: '账号终端暂不可用，请确认此 CLI 没有运行任务且当前项目允许执行，再重试',
    }))
    expect(JSON.stringify(f.renderer.toJSON())).not.toContain('账号终端暂不可用')
    await act(async () => f.streams[0].fail())
    expect(f.renderer.root.findByProps({ className: 'cwn-login-notice' }).children).toEqual([])
    expect(JSON.stringify(f.renderer.toJSON())).not.toContain('账号终端暂不可用')
    expect(JSON.stringify(f.renderer.toJSON())).toContain('模拟结果')
    expect(hidden(f)).toBe(true)
    expect(f.accountStop).toHaveBeenCalledWith('parent', 'terminal-a')
  })

  it('does not carry an expanded login terminal into the next sign-out', async () => {
    const f = await setup(false)
    await f.update('codex', 'login')
    await f.start()
    await f.click('显示原生终端')
    expect(hidden(f)).toBe(false)
    await f.update('codex', 'logout')
    await f.start('logout-terminal', 1)
    expect(hidden(f)).toBe(true)
  })
})

describe('Antigravity sign-in window (simulated Host frames)', () => {
  const LINK = 'https://accounts.google.com/o/oauth2/auth?client_id=synthetic&state=synthetic'
  const guide = (step: string, extra: Record<string, unknown> = {}) => ({ step, tone: 'action', text: '模拟引导', ...extra })
  const push = async (f: Awaited<ReturnType<typeof setup>>, frame: Omit<AccountFrame, 'seq'>, seq: number) => {
    await act(async () => {
      f.streams[0].push({ seq, ...frame } as AccountFrame)
    })
  }
  const buttons = (f: Awaited<ReturnType<typeof setup>>) =>
    f.renderer.root.findAllByType('button').map((button) => button.children.join(''))

  it('uses the Host grid for hidden output before fitting the visible terminal', async () => {
    const f = await setup(false)
    await f.update('codex', 'login')
    await act(async () => {
      f.starts[0].resolve(ok(JSON.stringify({ id: 'terminal-a', instruction: '模拟', size: { cols: 200, rows: 60 } })))
    })
    expect(terminals[0].resize).toHaveBeenCalledWith(200, 60)
    expect(f.renderer.root.findByProps({ className: 'cwn-account-terminal-view' }).props.hidden).toBe(true)
    expect(f.api.cliworker.accountResize).not.toHaveBeenCalled()
  })

  it('hides the native terminal, keeps it unsized and offers it as a fallback', async () => {
    const f = await setup(false)
    await f.update('antigravity', 'login')
    await f.start()
    const view = f.renderer.root.findByProps({ className: 'cwn-account-terminal-view' })
    expect(view.props.hidden).toBe(true)
    expect(terminals[0].focus).not.toHaveBeenCalled()
    expect(f.api.cliworker.accountResize).not.toHaveBeenCalled()
    expect(JSON.stringify(f.renderer.toJSON())).not.toContain('模拟账号交互')
    expect(buttons(f)).not.toContain('关闭终端')
    await f.click('显示原生终端')
    expect(f.renderer.root.findByProps({ className: 'cwn-account-terminal-view' }).props.hidden).toBe(false)
  })

  it('asks Grok for the callback address instead of an authorization code', async () => {
    const f = await setup(false)
    await f.update('grok', 'login')
    await f.start()
    // 模拟：Grok 浏览器回调未自动完成时的粘贴步骤（链接为虚构地址）。
    await push(f, {
      guide: {
        step: 'callback', tone: 'action', template: 'browserCode', stage: 0, text: '模拟',
        plan: ['在浏览器中授权', '粘贴回调网址（如未自动完成）', '确认登录'], link: 'https://auth.x.ai/simulated',
      },
    }, 1)
    const input = f.renderer.root.findByProps({ 'aria-label': '回调网址' })
    expect(input.props.placeholder).toContain('完整网址')
    expect(f.renderer.root.findAllByProps({ 'aria-label': '授权码' })).toHaveLength(0)
  })

  it.each([
    ['opencode', 'https://auth.openai.com/oauth/authorize?simulated=1'],
    ['hermes', 'https://portal.nousresearch.com/device?simulated=1'],
  ] as const)('opens the %s sign-in page its login prints', (cli, url) => {
    expect(loginLink(cli, url)).toBe(url)
    expect(loginLink(cli, 'https://example.com/')).toBeUndefined()
  })

  it('selects Google sign-in, opens only the Google page and submits a pasted code once', async () => {
    const f = await setup(false)
    await f.update('antigravity', 'login')
    await f.start()
    await push(f, { guide: AGY_GUIDES.method }, 1)
    expect(JSON.stringify(f.renderer.toJSON())).toContain('Google Cloud 项目')
    await f.click('使用 Google 账号登录')
    expect(f.accountRespond).toHaveBeenLastCalledWith('parent', 'terminal-a', JSON.stringify({ option: 'google' }))
    await push(f, { guide: { ...AGY_GUIDES.code, link: LINK } }, 2)
    await f.click('重新打开登录页面')
    expect(window.open).toHaveBeenCalledExactlyOnceWith(LINK, '_blank', 'noopener,noreferrer')
    const input = () => f.renderer.root.findByProps({ 'aria-label': '授权码' })
    expect(JSON.stringify(f.renderer.toJSON())).toContain('粘贴后按回车键')
    await act(async () => {
      input().props.onPaste()
      input().props.onChange({ target: { value: ' 4/synthetic-authorization-code\n' } })
    })
    const text = JSON.stringify(f.renderer.toJSON())
    expect(text).toContain('授权码已粘贴。')
    expect(text).toContain('按回车键完成登录')
    await act(async () => {
      f.renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() })
    })
    // The Host turns the code into agy's bracketed paste and Enter; the window never types keys itself.
    expect(f.accountRespond).toHaveBeenLastCalledWith('parent', 'terminal-a', JSON.stringify({ code: '4/synthetic-authorization-code' }))
    expect(f.accountWrite).not.toHaveBeenCalled()
    expect(JSON.stringify(f.renderer.toJSON())).toContain('正在确认登录…')
    await push(f, { guide: AGY_GUIDES.signedIn }, 3)
    await push(f, { status: 'closed', cleanupConfirmed: true }, 4)
    expect(JSON.stringify(f.renderer.toJSON())).toContain('已登录 Antigravity')
    await f.click('完成')
    expect(f.onClose).toHaveBeenCalledOnce()
  })

  it('ignores a sign-in link that is not a Google accounts page', async () => {
    const f = await setup(false)
    await f.update('antigravity', 'login')
    await f.start()
    await push(f, { guide: { ...AGY_GUIDES.code, link: 'https://example.com/phish' } }, 1)
    expect(buttons(f)).not.toContain('重新打开登录页面')
    expect(window.open).not.toHaveBeenCalled()
  })

  it('offers a fresh sign-in when the code is not confirmed', async () => {
    const f = await setup(false)
    await f.update('antigravity', 'login')
    await f.start()
    await push(f, { guide: AGY_GUIDES.unconfirmed }, 1)
    expect(JSON.stringify(f.renderer.toJSON())).toContain('授权码可能不完整或已过期')
    await f.click('重新开始登录')
    expect(f.accountStop).toHaveBeenCalledOnce()
    expect(f.accountStart).toHaveBeenCalledTimes(2)
  })

  it('shows sign-out progress and the result without any typing from the window', async () => {
    const f = await setup(false)
    await f.update('antigravity', 'logout')
    await f.start()
    expect(JSON.stringify(f.renderer.toJSON())).toContain('正在启动 Antigravity…')
    await push(f, { guide: AGY_GUIDES.loggingOut }, 1)
    expect(JSON.stringify(f.renderer.toJSON())).toContain('正在退出 Antigravity…')
    await push(f, { guide: AGY_GUIDES.loggedOut }, 2)
    await push(f, { status: 'closed', cleanupConfirmed: true }, 3)
    expect(JSON.stringify(f.renderer.toJSON())).toContain('已退出 Antigravity')
    expect(f.accountWrite).not.toHaveBeenCalled()
    expect(f.accountRespond).not.toHaveBeenCalled()
  })

  it('asks the user about folder trust before an automatic sign-out continues', async () => {
    const f = await setup(false)
    await f.update('antigravity', 'logout')
    await f.start()
    await push(f, { guide: AGY_GUIDES.trust }, 1)
    expect(JSON.stringify(f.renderer.toJSON())).toContain('是否信任该文件夹')
    expect(f.accountRespond).not.toHaveBeenCalled()
    await f.click('信任并继续')
    expect(f.accountRespond).toHaveBeenCalledExactlyOnceWith('parent', 'terminal-a', JSON.stringify({ confirm: 'trust' }))
  })

  it('agrees to Antigravity terms only on the user click, with data sharing off unless ticked', async () => {
    const f = await setup(false)
    await f.update('antigravity', 'logout')
    await f.start()
    await push(f, { guide: AGY_GUIDES.terms }, 1)
    expect(JSON.stringify(f.renderer.toJSON())).toContain('服务条款')
    const box = f.renderer.root.findByProps({ type: 'checkbox' })
    expect(box.props.checked).toBe(false)
    expect(f.accountRespond).not.toHaveBeenCalled()
    expect(f.accountWrite).not.toHaveBeenCalled()
    await f.click('同意并继续')
    expect(f.accountRespond).toHaveBeenCalledExactlyOnceWith('parent', 'terminal-a', JSON.stringify({ agree: 'terms', share: false }))
    // The step stays answerable until the Host moves on; a tick is passed through as given.
    await act(async () => box.props.onChange({ target: { checked: true } }))
    await f.click('同意并继续')
    expect(f.accountRespond).toHaveBeenLastCalledWith('parent', 'terminal-a', JSON.stringify({ agree: 'terms', share: true }))
  })

  it('shows the terminal status on the same footer line as the native terminal toggle', async () => {
    const f = await setup(false)
    await f.update('antigravity', 'logout')
    await f.start()
    await push(f, { message: '模拟终端状态' }, 1)
    const foot = f.renderer.root.findByProps({ className: 'cwn-login-foot' })
    expect(JSON.stringify(foot.findByProps({ className: 'cwn-login-notice' }).children)).toContain('模拟终端状态')
    expect(foot.findAllByType('button').map((button) => button.children.join(''))).toEqual(['显示原生终端'])
    expect(f.renderer.root.findAllByProps({ className: 'cwn-account-instruction' })).toEqual([])
  })

  it('shows the native terminal with keyboard focus when the Host cannot follow the screen', async () => {
    const f = await setup(false)
    await f.update('antigravity', 'login')
    await f.start()
    expect(terminals[0].focus).not.toHaveBeenCalled()
    await push(f, { guide: { step: 'native', tone: 'warning', template: 'native', text: '无法识别当前步骤，请在原生终端中继续。' } }, 1)
    expect(f.renderer.root.findByProps({ className: 'cwn-account-terminal-view' }).props.hidden).toBe(false)
    // The user's keys go to the CLI's own screen without clicking it first.
    expect(terminals[0].focus).toHaveBeenCalled()
  })

  it('keeps the plain terminal for Antigravity account management', async () => {
    const f = await setup(false)
    await f.update('antigravity', 'manage')
    await f.start()
    expect(f.renderer.root.findByProps({ className: 'cwn-account-terminal-view' }).props.hidden).toBe(false)
    expect(buttons(f)).toEqual(['关闭终端'])
  })
})


it('offers to switch a signed-in single-account CLI and signs out before the new login', async () => {
  const f = await setup(false)
  await f.update('codex', 'login', undefined, undefined, true)
  // Nothing starts until the user chooses to switch.
  expect(f.accountStart).not.toHaveBeenCalled()
  expect(JSON.stringify(f.renderer.toJSON())).toContain('当前已登录 Codex')
  await f.click('切换账号')
  expect(f.accountStart).toHaveBeenLastCalledWith('parent', 'codex', 'logout', expect.any(AbortSignal))
  await f.start()
  await act(async () => {
    f.streams[0].push({ seq: 1, guide: { step: 'loggedOut', tone: 'success', template: 'result', text: '已退出 Codex' } })
    f.streams[0].push({ seq: 2, status: 'closed', cleanupConfirmed: true })
  })
  await vi.waitFor(() => expect(f.accountStart).toHaveBeenLastCalledWith('parent', 'codex', 'login', expect.any(AbortSignal)))
  expect(f.accountStart.mock.calls.map((call) => call[2])).toEqual(['logout', 'login'])
})

it('shows the signed-in account as a card before switching', async () => {
  const f = await setup(false)
  // Simulated account status; no real credential.
  const account = {
    cli: 'mimo',
    state: 'authenticated',
    authMethod: 'api',
    accountLabel: 'user@example.com',
  } as AccountStatus
  await f.update('mimo', 'login', undefined, undefined, true, { account })
  const text = (className: string) => {
    const node = f.renderer.root.findByProps({ className })
    return node.findAll((item) => typeof item.props.children === 'string').map((item) => item.props.children).join('|')
  }
  expect(text('cwn-accounts-row-text')).toContain('API Key · user@example.com')
  expect(f.renderer.root.findByProps({ className: 'cwn-accounts-state' }).props.children).toBe('已登录')
  // Nothing runs on this page, so there is no native terminal to show.
  expect(f.renderer.root.findAllByProps({ className: 'cwn-login-foot' })).toEqual([])
  expect(f.renderer.root.findAllByType('button').map((button) => button.children.join(''))).toEqual(['关闭', '切换账号'])
  expect(f.accountStart).not.toHaveBeenCalled()
})

it('does not start a login after a sign-out that was not confirmed', async () => {
  const f = await setup(false)
  await f.update('codex', 'login', undefined, undefined, true)
  await f.click('切换账号')
  await f.start()
  await act(async () => {
    f.streams[0].push({ seq: 1, guide: { step: 'logoutUnconfirmed', tone: 'warning', template: 'result', text: '未确认退出' } })
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(f.accountStart).toHaveBeenCalledTimes(1)
})

it('starts a single-login sign-out through accountStartWith with only the login handle', async () => {
  const f = await setup(false)
  await f.update('opencode', 'logout', undefined, undefined, false, { login: 'opencode:deepseek' })
  expect(f.accountStart).not.toHaveBeenCalled()
  expect(f.accountStartWith).toHaveBeenCalledExactlyOnceWith(
    'parent',
    'opencode',
    'logout',
    JSON.stringify({ login: 'opencode:deepseek' }),
    expect.any(AbortSignal),
  )
})

it('replaces a Hermes key only after the new one is confirmed, then signs out the old one', async () => {
  const f = await setup(false)
  await f.update('hermes', 'login', undefined, 'deepseek', false, { replaces: 'hermes:deepseek:a1b2c3' })
  expect(f.accountStartWith).toHaveBeenLastCalledWith('parent', 'hermes', 'login', JSON.stringify({ provider: 'deepseek' }), expect.any(AbortSignal))
  await f.start()
  await act(async () => {
    f.streams[0].push({ seq: 1, guide: { step: 'key', tone: 'action', template: 'secret', text: '模拟密钥步骤' } })
  })
  expect(f.accountStartWith).toHaveBeenCalledTimes(1)
  await act(async () => {
    f.streams[0].push({ seq: 2, guide: { step: 'signedIn', tone: 'success', template: 'result', text: '已登录 Hermes' } })
    f.streams[0].push({ seq: 3, status: 'closed', cleanupConfirmed: true })
  })
  await vi.waitFor(() =>
    expect(f.accountStartWith).toHaveBeenLastCalledWith(
      'parent',
      'hermes',
      'logout',
      JSON.stringify({ login: 'hermes:deepseek:a1b2c3' }),
      expect.any(AbortSignal),
    ),
  )
  expect(f.accountStartWith).toHaveBeenCalledTimes(2)
  await f.start('old-entry', 1)
  await act(async () => {
    f.streams[1].push({ seq: 1, guide: { step: 'loggedOut', tone: 'success', template: 'result', text: '已退出 Hermes' } })
  })
  expect(JSON.stringify(f.renderer.toJSON())).toContain('已添加新凭据，并移除了原凭据')
})

it('asks for a Host update instead of a provider login on an older Host', async () => {
  const f = await setup(false)
  delete (f.api.cliworker as any).accountStartWith
  await f.update('opencode', 'login', undefined, 'deepseek')
  await vi.waitFor(() => expect(JSON.stringify(f.renderer.toJSON())).toContain('当前插件 Host 不支持此账号操作'))
  expect(f.accountStart).not.toHaveBeenCalled()
})
