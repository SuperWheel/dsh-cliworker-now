import { createElement, useSyncExternalStore, type ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import {
  IconBranchOutlineRegular,
  MenuItemButton,
  Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { active } from '../shared/types.ts'
import { HarnessReasonTooltip } from './harness-native-tooltip.tsx'
import { harnessFeatureReason } from './harness-feature-support.ts'
import { useHarnessSessionBinding, type HarnessBindingRegistry } from './harness-binding-registry.ts'
import { shadowHarnessSlot } from './harness-slot-shadow.ts'
import { value, type API, type Snapshot } from './workers.ts'
import { t, useT } from './i18n.ts'

export interface WorkerForkTurn {
  turn: number
  seq: number
  messageId: string
}
export type WorkerForkCut = { atMessageId: string; reason?: string }
/** Only completed assistant turn boundaries can be addressed. Latest uses the wire sentinel. */
export function workerForkCut(
  turns: readonly WorkerForkTurn[],
  target?: { turn?: number; seq?: number },
): WorkerForkCut {
  if (!target) return { atMessageId: '' }
  const latest = turns.at(-1)
  const selected = turns.find((turn) =>
    target.turn !== undefined ? turn.turn === target.turn : turn.seq === target.seq,
  )
  if (!selected) return { atMessageId: '', reason: t('只能从已完成的助手轮次分支') }
  return { atMessageId: selected === latest ? '' : selected.messageId }
}

type ForkServices = Pick<Context, 'sessions' | 'uiConversation' | 'uiWorkspace'>
type ChatForkSnapshot = {
  timeline: {
    turns: ReadonlyMap<
      number,
      {
        turn: number
        end?: { seq: number; data: { reason: { kind: string } } }
        data: { get(key: string): { closing?: { finalNode: { messageId?: string } } } | undefined }
      }
    >
  }
}

export class HarnessWorkerFork {
  private readonly states = new Map<string, Snapshot>()
  private readonly pending = new Map<string, AbortController>()
  private readonly listeners = new Set<() => void>()
  private revision = 0
  private disposed = false
  private error = ''
  constructor(
    readonly services: ForkServices,
    readonly bindings: HarnessBindingRegistry,
    readonly api: API,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getSnapshot = () => this.revision
  getError = () => this.error
  private changed() {
    this.revision++
    this.listeners.forEach((listener) => listener())
  }
  update(sessionId: string, snapshot: Snapshot) {
    if (this.states.get(sessionId) === snapshot) return
    this.states.set(sessionId, snapshot)
    this.changed()
  }
  turns(sessionId: string): WorkerForkTurn[] {
    const source = this.services.sessions.binding(sessionId as SessionId)
    if (!source) return []
    const chat = this.services.uiConversation
      .binding(source)
      .target('chat' as never)
      .getSnapshot() as ChatForkSnapshot | undefined
    return [...(chat?.timeline.turns.values() ?? [])]
      .flatMap((turn) => {
        const messageId = turn.data.get('turn-tail')?.closing?.finalNode.messageId
        return turn.end?.data.reason.kind === 'completed' && messageId
          ? [{ turn: turn.turn, seq: turn.end.seq, messageId }]
          : []
      })
      .sort((a, b) => a.seq - b.seq)
  }
  cut(sessionId: string, target?: { turn?: number; seq?: number }) {
    return workerForkCut(this.turns(sessionId), target)
  }
  reason(sessionId: string, cut: WorkerForkCut = { atMessageId: '' }) {
    const binding = this.bindings.get(sessionId)
    if (!binding?.workerId) return t('正在读取当前 CLI 会话')
    const unsupported = harnessFeatureReason(binding, 'fork')
    if (unsupported) return unsupported
    const snapshot = this.states.get(sessionId)
    const session = this.services.sessions.binding(sessionId as SessionId)?.session
    const native = session?.getSnapshot()
    const inbox = session?.projections.faceOf('inbox').getSnapshot() as
      | { 'next-turn'?: unknown[]; 'next-step'?: unknown[] }
      | undefined
    if (
      this.pending.has(sessionId) ||
      native?.running ||
      native?.pendingSubmissions.length ||
      snapshot?.selectedBusy ||
      snapshot?.configuring ||
      (snapshot?.selected && active(snapshot.selected.status))
    )
      return t('请等待当前运行结束后再分支')
    if (snapshot?.queuedFollowups?.length || inbox?.['next-turn']?.length || inbox?.['next-step']?.length)
      return t('请发送或移除待发消息后再分支')
    if (!snapshot?.selected) return t('正在读取当前 CLI 状态')
    return cut.reason || (cut.atMessageId ? harnessFeatureReason(binding, 'forkEarlier') : undefined)
  }
  /** Unsupported/busy paths settle without a request or an error notification. */
  async fork(sessionId: string, cut: WorkerForkCut = { atMessageId: '' }): Promise<SessionId | undefined> {
    const binding = this.bindings.get(sessionId)
    if (this.disposed || !binding?.workerId || this.reason(sessionId, cut)) return
    const request = new AbortController()
    this.pending.set(sessionId, request)
    this.error = ''
    this.changed()
    try {
      if (!this.api.cliworker.forkWorker) throw new Error(t('Host 尚未提供 CLI 会话分支'))
      const result = JSON.parse(
        value(
          await this.api.cliworker.forkWorker(
            binding.parentSessionId,
            binding.workerId,
            cut.atMessageId,
            request.signal,
          ),
        ),
      ) as { workerId: string; childSessionId: SessionId }
      if (request.signal.aborted) return
      this.services.uiWorkspace.openSession({
        parentSessionId: binding.parentSessionId as SessionId,
        childSessionId: result.childSessionId,
        mode: 'continuable',
      })
      return result.childSessionId
    } catch (error) {
      if (!request.signal.aborted) this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.pending.delete(sessionId)
      this.changed()
    }
  }
  dismissError = () => {
    this.error = ''
    this.changed()
  }
  dispose() {
    this.disposed = true
    this.pending.forEach((request) => request.abort())
    this.pending.clear()
    this.states.clear()
    this.listeners.clear()
  }
}

/** Patch the shared public dispatch boundary, including existing shortcut closures.
 * defineProperty intentionally reaches the service instance through Cordis' tracker;
 * assignment would write only to the caller's temporary shadow object. */
export function installHarnessForkRouting(services: ForkServices, forks: HarnessWorkerFork) {
  const sessions = services.sessions
  const previous = Object.getOwnPropertyDescriptor(sessions, 'fork')
  const native = sessions.fork
  const routed: typeof native = async function (this: typeof sessions, options) {
    if (!forks.bindings.get(options.sessionId)?.workerId) return native.call(this, options)
    const cut =
      options.atSeq === undefined ? { atMessageId: '' } : forks.cut(options.sessionId, { seq: options.atSeq })
    const child = await forks.fork(options.sessionId, cut)
    if (child) options.onCreated?.(child)
    return child ?? options.sessionId
  }
  Object.defineProperty(sessions, 'fork', { configurable: true, writable: true, value: routed })
  return () => {
    // Preserve any later owner instead of restoring over it.
    if (Object.getOwnPropertyDescriptor(sessions, 'fork')?.value !== routed) return
    if (previous) Object.defineProperty(sessions, 'fork', previous)
    else delete (sessions as Partial<typeof sessions>).fork
  }
}

export function installHarnessForkMenu(
  ctx: Pick<Context, 'slots'>,
  bindings: HarnessBindingRegistry,
  forks: HarnessWorkerFork,
) {
  return shadowHarnessSlot(ctx.slots, 'sidebar.workspaces.session.menu.item', 'fork', (original) => {
    const Native = original.component as ComponentType<Record<string, unknown>>
    function Fork(props: Record<string, unknown> & { sessionId: string }) {
      const binding = useHarnessSessionBinding(bindings, props.sessionId)
      useSyncExternalStore(forks.subscribe, forks.getSnapshot)
      if (!binding?.workerId) return createElement(Native, props)
      return <WorkerForkMenu {...props} forks={forks} />
    }
    return { component: Fork, inject: original.inject }
  })
}
type ForkShortcut = NonNullable<Parameters<typeof MenuItemButton>[0]['shortcut']> & { id: string }
function WorkerForkMenu({
  forks,
  sessionId,
  useMenuOpenState,
  useShortcuts,
}: {
  forks: HarnessWorkerFork
  sessionId: string
  useMenuOpenState?: () => [boolean, (open: boolean) => void]
  useShortcuts?: (
    selector: (rows: readonly ForkShortcut[]) => ForkShortcut | undefined,
  ) => ForkShortcut | undefined
}) {
  useT()
  const menu = useMenuOpenState?.()
  const shortcut = useShortcuts?.((rows) => rows.find((row) => row.id === 'session.fork'))
  const reason = forks.reason(sessionId)
  const row = (
    <MenuItemButton
      shortcut={shortcut}
      disabled={!!reason}
      icon={<IconBranchOutlineRegular />}
      onSelect={() => {
        if (forks.reason(sessionId)) return
        menu?.[1](false)
        void forks.fork(sessionId)
      }}
    >
      {t('分支')}
    </MenuItemButton>
  )
  // Below, like the native message branch button's tooltip.
  return reason ? (
    <HarnessReasonTooltip label={reason} side="bottom">
      {row}
    </HarnessReasonTooltip>
  ) : (
    row
  )
}
export function HarnessForkNotice({ forks }: { forks: HarnessWorkerFork }) {
  useSyncExternalStore(forks.subscribe, forks.getSnapshot)
  return forks.getError() ? <Toast text={forks.getError()} onDone={forks.dismissError} /> : null
}
