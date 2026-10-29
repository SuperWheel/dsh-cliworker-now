import { expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { bindHarnessTooltipAnchor, HarnessNativeTooltips, HarnessReasonTooltip } from '../src/client/harness-native-tooltip.tsx'
const tooltips = vi.hoisted(() => [] as Array<{ label: string; side: string }>)
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Tooltip: ({ label, side, children }: any) => {
    tooltips.push({ label, side })
    return children
  },
}))

// SIMULATION: native Tooltip's injected handlers are bound to an already-owned DOM anchor.
it('attaches hover and focus to the existing node without inserting or moving any native element', () => {
  const listeners = new Map<string, EventListener>()
  const inner = {}
  const element = {
    contains: (target: unknown) => target === inner,
    addEventListener: (name: string, fn: EventListener) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  } as unknown as HTMLElement
  const enter = vi.fn(),
    leave = vi.fn(),
    focus = vi.fn(),
    blur = vi.fn()
  const dispose = bindHarnessTooltipAnchor(element, {
    onMouseEnter: enter,
    onMouseLeave: leave,
    onFocus: focus,
    onBlur: blur,
  })
  const event = { relatedTarget: null, stopPropagation: vi.fn() }
  listeners.get('mouseover')!(event as unknown as Event)
  listeners.get('focus')!(event as unknown as Event)
  expect(enter).toHaveBeenCalledOnce()
  expect(focus).toHaveBeenCalledOnce()
  // React computes the native tooltip's enter/leave from these events; they keep propagating.
  expect(event.stopPropagation).not.toHaveBeenCalled()
  listeners.get('mouseover')!({ ...event, relatedTarget: inner } as unknown as Event)
  expect(enter).toHaveBeenCalledOnce()
  listeners.get('mouseout')!(event as unknown as Event)
  listeners.get('blur')!(event as unknown as Event)
  expect(leave).toHaveBeenCalledOnce()
  expect(blur).toHaveBeenCalledOnce()
  dispose()
  expect(listeners.size).toBe(0)
  expect(Object.keys(element).sort()).toEqual(['addEventListener', 'contains', 'removeEventListener'])
})

// SIMULATION: guarded native buttons with fake DOM nodes; no Harness page is rendered.
it('shows each reason on the side of the native tooltip it replaces', () => {
  tooltips.length = 0
  const element = { addEventListener() {}, removeEventListener() {} } as unknown as HTMLButtonElement
  act(() => {
    create(createElement(HarnessNativeTooltips, {
      targets: [
        { element, feature: 'fork', reason: 'SIMULATED fork reason' },
        { element, feature: 'attachments', reason: 'SIMULATED attachment reason' },
      ],
    }))
  })
  expect(tooltips).toEqual([
    { label: 'SIMULATED fork reason', side: 'bottom' },
    { label: 'SIMULATED attachment reason', side: 'top' },
  ])
})

it('removes the wrapped control\'s browser title while the reason shows', () => {
  const titled = new Map([['title', 'SIMULATED native title']])
  const node = { removeAttribute: (name: string) => titled.delete(name) }
  let observed: (() => void) | undefined
  const disconnect = vi.fn()
  const span = {
    querySelectorAll: () => (titled.has('title') ? [node] : []),
    ownerDocument: { defaultView: { MutationObserver: class {
      constructor(callback: () => void) { observed = callback }
      observe() {}
      disconnect = disconnect
    } } },
  }
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(createElement(HarnessReasonTooltip, { label: 'SIMULATED reason', side: 'top' }, 'control'), {
      createNodeMock: () => span,
    })
  })
  expect(titled.has('title')).toBe(false)
  // A native re-render that sets the title again is stripped by the observer.
  titled.set('title', 'SIMULATED native title')
  observed!()
  expect(titled.has('title')).toBe(false)
  act(() => renderer.unmount())
  expect(disconnect).toHaveBeenCalledOnce()
})
