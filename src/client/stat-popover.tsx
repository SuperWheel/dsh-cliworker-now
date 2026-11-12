import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Tooltip,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Same positioning/dismissal primitives and geometry as Harness useStatDialog. */
export function StatPopover({
  label,
  tooltip,
  context = false,
  className = '',
  trigger,
  children,
}: {
  label: string
  tooltip?: string
  context?: boolean
  className?: string
  trigger: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null),
    panelRef = useRef<HTMLDivElement>(null)
  const anchorName = `--cwn-stat-${useId().replaceAll(':', '')}`
  useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)
        && !panelRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('click', onClick, true)
    }
  }, [open])
  const button = (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      {trigger}
    </button>
  )
  return (
    <span ref={rootRef} className="cwn-stat-anchor" style={{ anchorName }}>
      {tooltip ? (
        <Tooltip label={tooltip} side="top" delayMs={200} disabled={open} portal>
          {button}
        </Tooltip>
      ) : (
        button
      )}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label}
            className={`cwn-stat-panel${context ? ' cwn-context-panel' : ''}`}
            style={{ positionAnchor: anchorName }}
          >
            {children}
          </div>,
          document.body,
        )}
    </span>
  )
}
