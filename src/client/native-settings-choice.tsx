import { useEffect, useId, useRef, useState } from 'react'
import { Button, Menu, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { t } from './i18n.ts'

export function NativeChoice({
  label,
  selected,
  choices,
  disabled,
  onChange,
  placeholder,
  describedBy,
  className,
  menuWidth,
}: {
  label: string
  selected: string
  /**
   * `description` adds a second, tertiary line under the menu label; `buttonLabel` replaces the
   * label inside the closed control (e.g. without a trailing ellipsis); `separatorBefore` draws the
   * native menu hairline above the choice.
   */
  choices: { id: string; label: string; disabled?: boolean; description?: string; buttonLabel?: string; separatorBefore?: boolean }[]
  disabled: boolean
  onChange: (value: string) => void
  placeholder?: string
  describedBy?: string
  /** Extra class on the control wrapper, e.g. a minimum width. */
  className?: string
  /** Fixed menu width in px, aligned to the control's right edge; the default follows the control. */
  menuWidth?: number
}) {
  const [open, setOpen] = useState(false)
  const current = choices.find((choice) => choice.id === selected)
  const anchor = useRef<HTMLButtonElement>(null)
  const [anchorWidth, setAnchorWidth] = useState<number>()
  const menuClass = `cwn-settings-choice-menu-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])
  useEffect(() => {
    const button = anchor.current
    if (!open || !button) return
    const measure = () => {
      const width = button.getBoundingClientRect().width
      if (width > 0) setAnchorWidth(width)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(button)
    return () => observer.disconnect()
  }, [open])
  return (
    <>
      <style>
        {menuWidth !== undefined
          ? `.${menuClass}{--cwn-settings-choice-width:${Math.max(menuWidth, anchorWidth ?? 0)}px}`
          : anchorWidth === undefined ? '' : `.${menuClass}{--cwn-settings-choice-width:${anchorWidth}px}`}
      </style>
      <Menu
        open={open && !disabled}
        onClose={() => setOpen(false)}
        portal
        align={menuWidth === undefined ? 'start' : 'end'}
        className={className ? `cwn-settings-choice ${className}` : 'cwn-settings-choice'}
        listClassName={`cwn-settings-choice-menu ${menuClass}`}
        selectedId={selected}
        items={choices.flatMap((choice) => {
          const item = {
            id: choice.id,
            disabled: choice.disabled,
            label: choice.description === undefined ? choice.label : (
              <span className="cwn-settings-choice-text">
                <span>{choice.label}</span>
                <span className="cwn-settings-choice-description">{choice.description}</span>
              </span>
            ),
          }
          return choice.separatorBefore ? [{ type: 'separator' as const, id: `${choice.id}:separator` }, item] : [item]
        })}
        onSelect={(id) => {
          if (!choices.some((choice) => choice.id === id && !choice.disabled)) return
          onChange(id)
          setOpen(false)
        }}
        anchor={
          <Button
            ref={anchor}
            type="button"
            variant="outline"
            size="md"
            aria-label={label}
            aria-describedby={describedBy}
            aria-haspopup="menu"
            aria-expanded={open && !disabled}
            disabled={disabled}
            onClick={() => {
              if (!open) {
                const width = anchor.current?.getBoundingClientRect().width
                if (width && width > 0) setAnchorWidth(width)
              }
              setOpen((old) => !old)
            }}
          >
            <span>
              {current?.buttonLabel ??
                current?.label ??
                placeholder ??
                (label === t('默认思考强度') ? t('选择强度') : t('选择模型'))}
            </span>
            <IconChevronDownOutlineRegular size={14} />
          </Button>
        }
      />
    </>
  )
}
