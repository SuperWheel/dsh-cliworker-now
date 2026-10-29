import { expect, it, vi } from 'vitest'
import { installHarnessDomGuard, installHarnessSessionDomGuard } from '../src/client/harness-dom-guard.ts'
import type { HarnessConversationBinding } from '../src/shared/types.ts'

// SIMULATION: exact rc.2 accessible labels with fake DOM ownership. No Session or CLI is created.
function fixture() {
  class Button {
    disabled = false
    textContent: string | null = null
    children = new Map<string, Button>()
    attributes = new Map<string, string>()
    constructor(label: string) {
      this.attributes.set('aria-label', label)
    }
    getAttribute(key: string) {
      return this.attributes.get(key) ?? null
    }
    setAttribute(key: string, value: string) {
      this.attributes.set(key, value)
    }
    removeAttribute(key: string) {
      this.attributes.delete(key)
    }
    closest() {
      return this
    }
    querySelector(selector: string) {
      return this.children.get(selector) ?? null
    }
  }
  const stop = new Button('停止生成'),
    branch = new Button('在新对话中分支'),
    send = new Button('发送')
  const outside = new Button('停止生成')
  const nodes = [stop, branch, send]
  const listeners = new Map<string, EventListener>()
  let mutate!: () => void
  const disconnect = vi.fn()
  const root = {
    querySelectorAll: () => nodes,
    contains: (node: Button) => nodes.includes(node),
    addEventListener: (name: string, fn: EventListener) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
    ownerDocument: {
      defaultView: {
        MutationObserver: class {
          constructor(callback: () => void) {
            mutate = callback
          }
          observe() {}
          disconnect = disconnect
        },
      },
    },
  } as unknown as HTMLElement
  const binding = {
    capabilities: { stop: false, fork: false, attachments: false },
    reasons: { stop: '请使用停止 CLI 等待清理完成', fork: 'CLI 尚未接通分支' },
  } as HarnessConversationBinding
  const event = (target = stop, extra = {}) => ({
    target,
    type: 'click',
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...extra,
  })
  return {
    root,
    binding,
    stop,
    branch,
    send,
    outside,
    nodes,
    listeners,
    mutate: () => mutate(),
    disconnect,
    event,
    Button,
  }
}
it('leaves native send, stop, command menus and input handling with their original owners', () => {
  const f = fixture()
  const commands = new f.Button('添加文件或调用指令')
  f.nodes.push(commands)
  const targets = vi.fn()
  const dispose = installHarnessDomGuard(f.root, f.binding, targets)
  for (const button of [f.stop, f.send, commands]) {
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-disabled')).toBeNull()
    const click = f.event(button)
    f.listeners.get('click')!(click as unknown as Event)
    expect(click.preventDefault).not.toHaveBeenCalled()
  }
  expect(commands.getAttribute('aria-label')).toBe('调用指令（附件不可用）')
  // One tooltip per control: reasons go to the overlay targets, never a browser title.
  expect(commands.getAttribute('title')).toBeNull()
  expect(f.branch.disabled).toBe(true)
  expect(f.branch.getAttribute('title')).toBeNull()
  // The native tooltip bubble beside a guarded button is hidden; the reason replaces it.
  for (const button of [f.branch, commands]) expect(button.getAttribute('data-cwn-reason-tooltip')).toBe('')
  const reasons = targets.mock.lastCall![0].map((target: { reason: string }) => target.reason)
  expect(reasons).toContain('CLI 尚未接通分支')
  expect(reasons.some((reason: string) => reason.includes('仍可打开此菜单调用可用指令'))).toBe(true)
  const fork = f.event(f.branch)
  f.listeners.get('click')!(fork as unknown as Event)
  expect(fork.preventDefault).toHaveBeenCalledOnce()
  const escape = f.event(f.send, { type: 'keydown', key: 'Escape' })
  f.listeners.get('keydown')!(escape as unknown as Event)
  expect(escape.preventDefault).not.toHaveBeenCalled()
  dispose()
  expect(f.disconnect).toHaveBeenCalledOnce()
  expect(f.listeners.size).toBe(0)
  expect(f.branch.disabled).toBe(false)
  expect(commands.getAttribute('aria-label')).toBe('添加文件或调用指令')
  for (const button of [f.branch, commands]) expect(button.getAttribute('data-cwn-reason-tooltip')).toBeNull()
})
it('leaves native context readings, Popup clicks and keyboard interaction untouched', () => {
  const f = fixture()
  const meter = new f.Button('上下文已用 38%')
  meter.setAttribute('aria-haspopup', 'dialog')
  const reading = new f.Button('')
  reading.textContent = '38%'
  const fill = new f.Button('')
  fill.setAttribute('stroke-dasharray', '13 34')
  meter.children.set(':scope > span', reading)
  meter.children.set('circle[stroke-dasharray]', fill)
  f.nodes.push(meter)
  const targets = vi.fn()
  const dispose = installHarnessDomGuard(f.root, f.binding, targets)
  expect(meter.disabled).toBe(false)
  expect(meter.getAttribute('aria-label')).toBe('上下文已用 38%')
  expect(meter.getAttribute('title')).toBeNull()
  expect(reading.textContent).toBe('38%')
  expect(fill.getAttribute('stroke-dasharray')).toBe('13 34')
  const click = f.event(meter)
  f.listeners.get('click')!(click as unknown as Event)
  expect(click.preventDefault).not.toHaveBeenCalled()
  const key = f.event(meter, { type: 'keydown', key: 'Enter' })
  f.listeners.get('keydown')!(key as unknown as Event)
  expect(key.preventDefault).not.toHaveBeenCalled()
  meter.setAttribute('aria-label', '39% of context used')
  reading.textContent = '39%'
  f.mutate()
  expect(reading.textContent).toBe('39%')
  expect(targets.mock.calls.at(-1)?.[0].some((target: any) => target.element === meter)).toBe(false)
  dispose()
  expect(meter.getAttribute('aria-label')).toBe('39% of context used')
  expect(meter.disabled).toBe(false)
  expect(reading.textContent).toBe('39%')
  expect(fill.getAttribute('stroke-dasharray')).toBe('13 34')
})
it('scopes native main-frame guards to the exact CLI child and releases removed occurrences', () => {
  const child = fixture(),
    parent = fixture(),
    other = fixture()
  const roots = [child.root, parent.root, other.root]
  const branches = [child, parent, other].map((entry, index) => {
    Object.assign(entry.root, { getAttribute: () => ['owned-child', 'parent', 'other-child'][index] })
    return entry.branch
  })
  let changed!: () => void
  const document = {
    body: {},
    querySelectorAll: () => roots,
    defaultView: {
      MutationObserver: class {
        constructor(callback: () => void) {
          changed = callback
        }
        observe() {}
        disconnect() {}
      },
    },
  } as unknown as Document
  const targets = vi.fn()
  const release = installHarnessSessionDomGuard(
    document,
    { ...child.binding, sessionId: 'owned-child' },
    targets,
  )
  expect(branches.map((branch) => branch.disabled)).toEqual([true, false, false])
  expect(parent.listeners.size).toBe(0)
  expect(other.listeners.size).toBe(0)
  roots.shift()
  changed()
  expect(branches.map((branch) => branch.disabled)).toEqual([false, false, false])
  expect(child.listeners.size).toBe(0)
  expect(targets).toHaveBeenLastCalledWith([])
  release()
})
