import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { StatPopover } from '../src/client/stat-popover.tsx'

// SIMULATION: React interaction/portal contract only; no browser layout engine.
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Tooltip: ({ children }: any) => children,
  useDismissOnOutsidePointer: () => {},
}))
const listeners = new Map<string, Set<(event: any) => void>>()
class ElementStub { contains(node: unknown) { return node === this } }
let renderer: ReactTestRenderer | undefined
function emit(type: string, event: unknown) { for (const callback of [...(listeners.get(type) ?? [])]) callback(event) }
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
  expect([...listeners.values()].every(set => !set.size)).toBe(true)
  listeners.clear()
  vi.unstubAllGlobals()
})
it('anchors each portaled dialog to its own trigger and closes on Escape and sibling keyboard clicks', async () => {
  vi.stubGlobal('Node', ElementStub)
  vi.stubGlobal('document', {
    body: {},
    addEventListener: (type: string, callback: any) => {
      const set = listeners.get(type) ?? new Set(); set.add(callback); listeners.set(type, set)
    },
    removeEventListener: (type: string, callback: any) => listeners.get(type)?.delete(callback),
  })
  await act(async () => { renderer = create(<>
    <StatPopover label="usage" trigger="Usage">usage details</StatPopover>
    <StatPopover label="context" trigger="Context" context>context details</StatPopover>
  </>, { createNodeMock: () => new ElementStub() }) })
  const buttons = renderer!.root.findAllByType('button')
  await act(async () => buttons[0].props.onClick())
  let panel = renderer!.root.findByProps({ role: 'dialog' })
  const anchors = renderer!.root.findAllByProps({ className: 'cwn-stat-anchor' })
  expect(panel.props.style.positionAnchor).toBe(anchors[0].props.style.anchorName)
  expect(anchors[0].props.style.anchorName).not.toBe(anchors[1].props.style.anchorName)
  expect(buttons[0].props['aria-expanded']).toBe(true)
  await act(async () => emit('click', { target: new ElementStub() }))
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
  await act(async () => buttons[1].props.onClick())
  panel = renderer!.root.findByProps({ role: 'dialog' })
  expect(panel.props.style.positionAnchor).toBe(anchors[1].props.style.anchorName)
  expect(panel.props.className).toContain('cwn-context-panel')
  await act(async () => emit('keydown', { key: 'Escape' }))
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
})
