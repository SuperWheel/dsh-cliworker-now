import { useEffect, useRef, useState } from 'react'
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  active,
  isUserInterrupted,
  workerName,
  type Worker,
  type WorkerStatus,
} from '../shared/types.ts'
import { displayModelName } from '../shared/model-presentation.ts'
import { Glyph } from './icons.tsx'
import { NameCopy } from './name-copy.tsx'
import { effortLabel, t, type MessageKey, useT } from './i18n.ts'

const status: Record<WorkerStatus, MessageKey> = {
  queued: '排队中',
  running: '运行中',
  stopping: '正在停止',
  completed: '已完成',
  failed: '失败',
  uncertain: '结果待核实',
  interrupted: '已中断',
}
export type WorkerManagementAction = 'title' | 'name' | 'delete'
export function WorkerCard({
  worker,
  collapsed,
  unavailable,
  busy,
  onOpen,
  onManage,
}: {
  worker: Worker
  collapsed: boolean
  unavailable: boolean
  busy: boolean
  onOpen: () => void
  onManage: (action: WorkerManagementAction) => void
}) {
  useT()
  const [menu, setMenu] = useState(false)
  const point = useRef<{ x: number; y: number }>()
  const card = useRef<HTMLDivElement>(null)
  const openButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (collapsed) setMenu(false)
  }, [collapsed])
  const locked = collapsed || unavailable || busy
  const openMenu = (x?: number, y?: number) => {
    if (collapsed) return
    point.current = x === undefined || y === undefined ? undefined : { x, y }
    setMenu(true)
  }
  const entries: MenuEntry[] = [
    { id: 'open', label: t('打开对话'), disabled: collapsed },
    { id: 'title', label: t('修改聊天标题'), disabled: locked },
    { id: 'name', label: t('修改智能体名称'), disabled: locked },
    { type: 'separator', id: 'separator' },
    { id: 'delete', label: t('删除'), disabled: locked || active(worker.status), danger: true },
  ]
  return (
    <div
      ref={card}
      className="cwn-worker"
      data-worker-id={worker.id}
      onClick={(event) => {
        // The native menu portal still bubbles through this React owner. Only
        // bare card/text areas open; every actual button owns its own action.
        if ((event.target as Element).closest?.('button,[role="menu"]')) return
        if (!collapsed) onOpen()
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
          if (id === 'open') onOpen()
          else if (id === 'title' || id === 'name' || id === 'delete') onManage(id)
        }}
        anchor={
          <div className="cwn-worker-layout">
            <button
              ref={openButton}
              type="button"
              className="cwn-worker-open"
              data-open-worker-id={worker.id}
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-keyshortcuts="Shift+F10"
              tabIndex={collapsed ? -1 : undefined}
              onClick={() => {
                if (!collapsed) onOpen()
              }}
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
                <span className="cwn-worker-title">{worker.title}</span>
                <span className={`cwn-worker-status ${worker.status}`}>
                  <span className={`cwn-dot ${worker.status}`} />
                  {isUserInterrupted(worker)
                    ? t('已停止')
                    : worker.status === 'running' && worker.approvalWaiting
                      ? t('等待审批')
                      : t(status[worker.status])}
                </span>
              </span>
            </button>
            <div className="cwn-worker-meta">
              <NameCopy name={workerName(worker)} disabled={collapsed} />
              <span className="cwn-meta-divider cwn-name-divider" aria-hidden="true" />
              <span className="cwn-worker-model" title={displayModelName(worker.preference)}>
                {displayModelName(worker.preference)}
              </span>
              <span className="cwn-meta-divider" aria-hidden="true">
                ·
              </span>
              <span>{effortLabel(worker.preference.effort)}</span>
            </div>
            <span className="cwn-worker-chevron" aria-hidden="true">
              <Glyph name="chevron" />
            </span>
          </div>
        }
      />
    </div>
  )
}
