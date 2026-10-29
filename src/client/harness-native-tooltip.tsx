import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GuardedNativeControl } from './harness-dom-guard.ts'

type AnchorProps = Pick<
  HTMLAttributes<HTMLElement>,
  'onMouseEnter' | 'onMouseLeave' | 'onFocus' | 'onBlur' | 'onClick'
> & { element: HTMLElement }
export function bindHarnessTooltipAnchor(
  element: HTMLElement,
  handlers: Omit<AnchorProps, 'element'>,
): () => void {
  const bindings = [
    ['mouseover', handlers.onMouseEnter],
    ['mouseout', handlers.onMouseLeave],
    ['focus', handlers.onFocus],
    ['blur', handlers.onBlur],
    ['click', handlers.onClick],
  ] as const
  const removers = bindings.flatMap(([eventName, handler]) => {
    if (!handler) return []
    // Events keep propagating: React derives the native tooltip's enter from the
    // previous element's mouseout, so stopping them here never hid it and only
    // left its leave undelivered. The native bubble is hidden by style instead.
    const listener = (event: Event) => {
      if (
        (eventName === 'mouseover' || eventName === 'mouseout') &&
        (event as MouseEvent).relatedTarget &&
        element.contains((event as MouseEvent).relatedTarget as Node)
      )
        return
      handler(event as never)
    }
    element.addEventListener(eventName, listener, true)
    return [() => element.removeEventListener(eventName, listener, true)]
  })
  return () => {
    for (const remove of removers) remove()
  }
}
/** Bind the public Tooltip primitive to an existing native element without moving or rendering it. */
const ExistingNativeAnchor = forwardRef<HTMLElement, AnchorProps>(function ExistingNativeAnchor(
  { element, ...handlers },
  ref,
) {
  useImperativeHandle(ref, () => element, [element])
  useLayoutEffect(
    () => bindHarnessTooltipAnchor(element, handlers),
    [
      element,
      handlers.onMouseEnter,
      handlers.onMouseLeave,
      handlers.onFocus,
      handlers.onBlur,
      handlers.onClick,
    ],
  )
  return null
})

/** The side each native control's own tooltip uses, so the reason appears where the user expects it. */
const NATIVE_SIDE = { fork: 'bottom', attachments: 'top' } as const

export function HarnessNativeTooltips({
  targets,
}: {
  targets: readonly Pick<GuardedNativeControl, 'element' | 'reason' | 'feature'>[]
}) {
  return (
    <>
      {targets.map(({ element, reason, feature }, index) => (
        <Tooltip key={index} label={reason} side={NATIVE_SIDE[feature]} portal>
          <ExistingNativeAnchor element={element} />
        </Tooltip>
      ))}
    </>
  )
}

/**
 * Explain why a wrapped native control is unavailable. The control's own browser
 * `title` would show as a second tooltip, so it is removed while the reason shows;
 * the control remounts without this wrapper once the reason clears.
 */
export function HarnessReasonTooltip({
  label,
  side,
  children,
}: {
  label: string
  side: 'top' | 'bottom'
  children: ReactNode
}) {
  const anchor = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const element = anchor.current
    if (!element) return
    const strip = () => {
      for (const node of element.querySelectorAll('[title]')) node.removeAttribute('title')
    }
    strip()
    const Observer = element.ownerDocument.defaultView?.MutationObserver
    const observer = Observer ? new Observer(strip) : undefined
    observer?.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] })
    return () => observer?.disconnect()
  }, [])
  return (
    <Tooltip label={label} side={side} portal>
      <span ref={anchor} tabIndex={0} aria-label={label}>
        {children}
      </span>
    </Tooltip>
  )
}
