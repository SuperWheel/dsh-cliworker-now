import type { HarnessConversationBinding } from '../shared/types.ts'
import { t } from './i18n.ts'
import { hostText } from './operation-error.ts'

// These rc.2 controls have no separate public leaf slot. Match only their exact
// accessible labels inside a verified CLI child. Input and command ownership stays native.
type GuardedFeature = 'fork' | 'attachments'
/** Marks a native button whose own adjacent tooltip bubble is hidden while the plugin's reason shows. */
export const HARNESS_REASON_TOOLTIP = 'data-cwn-reason-tooltip'
interface Saved {
  feature: GuardedFeature
  disabled: boolean
  title: string | null
  ariaDisabled: string | null
  ariaLabel: string | null
  unavailable: string | null
  describedBy: string | null
}
export interface GuardedNativeControl {
  element: HTMLButtonElement
  feature: GuardedFeature
  reason: string
}
export interface HarnessDomForkActions {
  reason(button: HTMLButtonElement): string | undefined
  fork(button: HTMLButtonElement): void
}
/** Guard only one verified CLI child occurrence, never another Session or body portals. */
export function installHarnessDomGuard(
  root: HTMLElement,
  binding: HarnessConversationBinding,
  onTargets?: (targets: readonly GuardedNativeControl[]) => void,
  forks?: HarnessDomForkActions,
): () => void {
  const saved = new Map<HTMLButtonElement, Saved>()
  const feature = (button: Element): GuardedFeature | undefined => {
    const held = saved.get(button as HTMLButtonElement)
    if (held) return held.feature
    const label = button.getAttribute('aria-label') ?? ''
    if (['在新对话中分支', 'Branch into a new conversation'].includes(label))
      return 'fork'
    if (
      !binding.capabilities.attachments &&
      ['添加文件或调用指令', 'Add files or run commands'].includes(label)
    )
      return 'attachments'
    return undefined
  }
  const restore = (button: HTMLButtonElement, previous: Saved) => {
    button.removeAttribute(HARNESS_REASON_TOOLTIP)
    if (previous.feature !== 'attachments') button.disabled = previous.disabled
    for (const [name, old] of [
      ['title', previous.title],
      ...(previous.feature !== 'attachments' ? [['aria-disabled', previous.ariaDisabled] as const] : []),
      ['aria-label', previous.ariaLabel],
      ...(previous.feature !== 'attachments' ? [
        ['data-unavailable', previous.unavailable] as const,
        ['aria-describedby', previous.describedBy] as const,
      ] : []),
    ] as const)
      if (old === null) button.removeAttribute(name)
      else button.setAttribute(name, old)
  }
  const scan = () => {
    const targets: GuardedNativeControl[] = []
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[aria-label]')) {
      const capability = feature(button)
      if (!capability) continue
      if (!saved.has(button))
        saved.set(button, {
          feature: capability,
          disabled: button.disabled,
          title: button.getAttribute('title'),
          ariaDisabled: button.getAttribute('aria-disabled'),
          ariaLabel: button.getAttribute('aria-label'),
          unavailable: button.getAttribute('data-unavailable'),
          describedBy: button.getAttribute('aria-describedby'),
        })
      const reason =
        capability === 'fork'
          ? forks ? forks.reason(button) : hostText(binding.reasons?.fork) || t('CLI 子会话尚未接通原生分支，操作不可用。')
          : t('{reason}。仍可打开此菜单调用可用指令。', { reason: hostText(binding.reasons?.attachments) || t('此 CLI 子会话尚未接通文件和图片附件') })
      if (capability !== 'attachments') {
        if (button.disabled !== !!reason) button.disabled = !!reason
        if (button.getAttribute('aria-disabled') !== String(!!reason)) button.setAttribute('aria-disabled', String(!!reason))
        if (reason) {
          if (button.getAttribute('data-unavailable') === null) button.setAttribute('data-unavailable', '')
        } else button.removeAttribute('data-unavailable')
        button.removeAttribute('aria-describedby')
      }
      // One tooltip only: the overlay shows the reason; a title attribute would add a browser tooltip.
      const title = saved.get(button)!.title
      if (title === null) button.removeAttribute('title')
      else if (button.getAttribute('title') !== title) button.setAttribute('title', title)
      if (capability === 'attachments' && button.getAttribute('aria-label') !== t('调用指令（附件不可用）'))
        button.setAttribute('aria-label', t('调用指令（附件不可用）'))
      // An available fork keeps the native button's own tooltip; otherwise the
      // reason replaces it, so the two never show together.
      if (reason) {
        if (button.getAttribute(HARNESS_REASON_TOOLTIP) === null) button.setAttribute(HARNESS_REASON_TOOLTIP, '')
        targets.push({ element: button, feature: capability, reason })
      } else button.removeAttribute(HARNESS_REASON_TOOLTIP)
    }
    onTargets?.(targets)
  }
  const capture = (event: Event) => {
    const target = event.target as Element | null
    const button = target?.closest?.('button[aria-label]')
    const capability = button && root.contains(button) ? feature(button) : undefined
    if (capability && capability !== 'attachments') {
      if (event.type === 'keydown' && !['Enter', ' '].includes((event as KeyboardEvent).key)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (forks && !forks.reason(button as HTMLButtonElement)) forks.fork(button as HTMLButtonElement)
    }
  }
  const Observer = root.ownerDocument.defaultView?.MutationObserver
  const observer = Observer ? new Observer(scan) : undefined
  observer?.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-label', 'disabled', 'aria-disabled', 'data-unavailable', 'aria-describedby'],
  })
  root.addEventListener('click', capture, true)
  root.addEventListener('keydown', capture, true)
  scan()
  return () => {
    observer?.disconnect()
    root.removeEventListener('click', capture, true)
    root.removeEventListener('keydown', capture, true)
    for (const [button, previous] of saved) restore(button, previous)
    saved.clear()
  }
}

/** Locate native occurrences by their exact public Session identity, including the main frame. */
export function installHarnessSessionDomGuard(
  document: Document,
  binding: HarnessConversationBinding,
  onTargets: (targets: readonly GuardedNativeControl[]) => void,
  forks?: HarnessDomForkActions,
): () => void {
  const roots = new Map<HTMLElement, { release: () => void; targets: readonly GuardedNativeControl[] }>()
  const publish = () => onTargets([...roots.values()].flatMap((entry) => entry.targets))
  const sync = () => {
    const present = new Set(
      [
        ...document.querySelectorAll<HTMLElement>('[data-conversation-content][data-conversation-session]'),
      ].filter((root) => root.getAttribute('data-conversation-session') === binding.sessionId),
    )
    for (const [root, entry] of roots)
      if (!present.has(root)) {
        roots.delete(root)
        entry.release()
      }
    for (const root of present)
      if (!roots.has(root)) {
        const entry = { release: () => {}, targets: [] as readonly GuardedNativeControl[] }
        roots.set(root, entry)
        entry.release = installHarnessDomGuard(root, binding, (targets) => {
          entry.targets = targets
          publish()
        }, forks)
      }
    publish()
  }
  const Observer = document.defaultView?.MutationObserver
  const observer = Observer ? new Observer(sync) : undefined
  observer?.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-conversation-session'],
  })
  sync()
  return () => {
    observer?.disconnect()
    for (const entry of roots.values()) entry.release()
    roots.clear()
  }
}
