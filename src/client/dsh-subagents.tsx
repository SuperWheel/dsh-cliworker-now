import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DshSubagent } from '../shared/types.ts'
import { retainHarnessComposerBlock } from './harness-conversation.tsx'
import { operationMessage } from './operation-error.ts'
import { value, type API } from './workers.ts'
import { t, useT, type MessageKey } from './i18n.ts'
import { Glyph } from './icons.tsx'
import { NameCopy } from './name-copy.tsx'

const labels: Record<DshSubagent['status'], MessageKey> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  unknown: '状态未知',
}
export const DshConversationContext = createContext<{ child: DshSubagent; api: API } | undefined>(undefined)
export function useDshConversation(sessionId?: string) {
  const context = useContext(DshConversationContext)
  return context?.child.id === sessionId ? context : undefined
}
export function DshSubagentCard({
  child,
  collapsed,
  onOpen,
  onHide,
  busy,
}: {
  child: DshSubagent
  collapsed: boolean
  busy: boolean
  onOpen(): void
  onHide(): void
}) {
  useT()
  const [menu, setMenu] = useState(false)
  const point = useRef<{ x: number; y: number }>()
  const card = useRef<HTMLDivElement>(null)
  const openButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (collapsed) setMenu(false)
  }, [collapsed])
  const visualStatus = child.stopped ? 'interrupted' : child.status
  const external = child.mode === 'external'
  const open = () => {
    if (!collapsed && !external) onOpen()
  }
  const openMenu = (x?: number, y?: number) => {
    if (collapsed) return
    point.current = x === undefined || y === undefined ? undefined : { x, y }
    setMenu(true)
  }
  // Same card grammar as CLI Workers. The title is DSH-owned, so only "delete"
  // (hide from this window) is offered; the native child and records remain.
  const entries: MenuEntry[] = [
    { id: 'open', label: t('打开对话'), disabled: collapsed || external },
    { type: 'separator', id: 'separator' },
    { type: 'label', id: 'delete-scope', text: t('仅在此窗口隐藏，不影响 DSH 原生会话与记录') },
    { id: 'delete', label: t('删除'), disabled: collapsed || busy, danger: true },
  ]
  return (
    <div
      ref={card}
      className="cwn-worker"
      data-dsh-child-id={child.id}
      title={external ? t('此外部 DSH 子 Agent 没有可打开的本地会话') : undefined}
      onClick={(event) => {
        if ((event.target as Element).closest?.('button,[role="menu"]')) return
        open()
      }}
      onContextMenu={(event) => {
        if (collapsed) return
        event.preventDefault()
        event.stopPropagation()
        openMenu(event.clientX, event.clientY)
      }}
    >
      <Menu
        open={menu}
        portal
        autoFocus
        className="cwn-worker-menu-anchor"
        listClassName="cwn-worker-menu"
        getAnchorRect={() => {
          if (point.current) return new DOMRect(point.current.x, point.current.y, 0, 0)
          return card.current?.getBoundingClientRect() ?? openButton.current?.getBoundingClientRect() ?? null
        }}
        onClose={() => setMenu(false)}
        items={entries}
        onSelect={(id) => {
          setMenu(false)
          if (id === 'open') open()
          else if (id === 'delete') onHide()
        }}
        anchor={
          <div className="cwn-worker-layout">
            <button
              ref={openButton}
              type="button"
              className="cwn-worker-open"
              tabIndex={collapsed ? -1 : undefined}
              data-open-worker-id={child.id}
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-keyshortcuts="Shift+F10"
              disabled={collapsed || external}
              onClick={open}
              onKeyDown={(event) => {
                if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
                  if (collapsed) return
                  event.preventDefault()
                  event.stopPropagation()
                  openMenu()
                }
              }}
            >
              <span className="cwn-worker-line">
                <span className="cwn-worker-title">{child.name}</span>
                <span className={`cwn-worker-status ${visualStatus}`}>
                  <span className={`cwn-dot ${visualStatus}`} />
                  {t(child.stopped ? '已停止' : labels[child.status])}
                </span>
              </span>
            </button>
            <div className="cwn-worker-meta">
              <NameCopy name={child.agentName} disabled={collapsed} />
              {child.model && <>
                <span className="cwn-meta-divider cwn-name-divider" aria-hidden="true" />
                <span className="cwn-worker-model" title={child.model}>{child.model}</span>
              </>}
            </div>
            {!external && <span className="cwn-worker-chevron" aria-hidden="true">
              <Glyph name="chevron" />
            </span>}
          </div>
        }
      />
    </div>
  )
}

/** Keep the exact native InputBar (including stats, queue, draft and keyboard).
 * Native Session.prompt already routes to DSH subagents.prompt. Only stop's
 * public action is replaced, so its receipt waits for confirmed settlement. */
export function DshNativeComposer({
  Native,
  nativeProps,
  context,
}: {
  Native: ComponentType<Record<string, unknown>>
  nativeProps: Record<string, unknown>
  context: NonNullable<ReturnType<typeof useDshConversation>>
}) {
  useT()
  const { child, api } = context
  const request = useRef<AbortController>()
  const [error, setError] = useState('')
  const [stopping, setStopping] = useState(false)
  useEffect(() => () => request.current?.abort(), [child.id])
  const readonly = child.mode !== 'continuable'
  const stop = async () => {
    if (readonly || request.current) return
    const controller = new AbortController()
    request.current = controller
    setError('')
    setStopping(true)
    try {
      if (!api.cliworker.stopDshSubagent) throw new Error(t('DSH 停止尚未确认，请重试'))
      const receipt = JSON.parse(
        value(await api.cliworker.stopDshSubagent(child.parentSessionId, child.id, controller.signal)),
      )
      if (receipt.stopped !== true) throw new Error(t('DSH 停止尚未确认，请重试'))
    } catch (error) {
      if (!controller.signal.aborted) setError(operationMessage(error))
    } finally {
      if (request.current === controller) request.current = undefined
      if (!controller.signal.aborted) setStopping(false)
    }
  }
  return (
    <>
      {createElement(Native, {
        ...nativeProps,
        ...(readonly ? { blocked: { reason: t('此 DSH 子 Agent 只读') } } : {}),
        stop:
          readonly || !api.cliworker.stopDshSubagent
            ? undefined
            : () => {
                void stop()
              },
      })}
      {stopping && (
        <p className="cwn-notice" role="status">
          {t('正在停止')}
        </p>
      )}
      {error && (
        <p className="cwn-error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}

/** Same native child content/SessionProvider as Workers, without CLI bindings
 * or synthetic telemetry. All records and statistics remain native projections. */
export function DshConversation({
  services,
  child,
  api,
  renderConversation,
}: {
  services: Pick<Context, 'sessions' | 'conversation'>
  child: DshSubagent
  api: API
  renderConversation(reference: SessionReference): ReactNode
}) {
  useT()
  const key = `${child.parentSessionId}:${child.id}:${child.mode}`
  const [state, setState] = useState<{ key: string; reference?: SessionReference; error?: string }>({ key })
  useLayoutEffect(
    () =>
      retainHarnessComposerBlock(
        services.conversation,
        child.id,
        child.mode !== 'continuable' ? t('此 DSH 子 Agent 只读') : undefined,
      ),
    [services.conversation, child.id, child.mode, t],
  )
  useEffect(() => {
    const controller = new AbortController()
    let reference: SessionReference | undefined, unsubscribe: (() => void) | undefined
    setState({ key })
    try {
      if (child.mode === 'external') throw new Error(t('无法打开原生会话'))
      reference = services.sessions.retain(
        {
          parentSessionId: child.parentSessionId as SessionId,
          childSessionId: child.id as SessionId,
          mode: child.mode,
        },
        { source: 'cliworkerConversation', signal: controller.signal },
      )
      const retained = reference
      void retained.ready
        .then((binding) => {
          if (controller.signal.aborted) return
          if (binding.sessionId !== child.id || retained.sessionId !== child.id)
            throw new Error(t('原生会话身份或能力与当前子 Agent 不一致'))
          const publish = () => {
            if (controller.signal.aborted) return
            const snapshot = binding.session.getSnapshot()
            setState({
              key,
              reference: retained,
              error:
                snapshot.openState === 'error'
                  ? snapshot.openError?.message || t('原生会话历史读取失败。')
                  : undefined,
            })
          }
          unsubscribe = binding.session.subscribe(publish)
          publish()
        })
        .catch((error) => {
          if (!controller.signal.aborted) setState({ key, error: operationMessage(error) })
        })
    } catch (error) {
      setState({ key, error: operationMessage(error) })
    }
    return () => {
      controller.abort()
      unsubscribe?.()
      reference?.release()
    }
  }, [services.sessions, key])
  const current = state.key === key ? state : undefined
  return (
    <DshConversationContext.Provider value={{ child, api }}>
      <div
        className="cwn-harness-conversation"
        data-dsh-conversation={child.id}
        aria-label={t('DSH 原生子会话')}
      >
        {current?.error ? (
          <p role="alert" className="cwn-error">
            {current.error}
          </p>
        ) : current?.reference ? (
          renderConversation(current.reference)
        ) : (
          <p role="status" className="cwn-notice">
            {t('正在打开原生子会话…')}
          </p>
        )}
      </div>
    </DshConversationContext.Provider>
  )
}
