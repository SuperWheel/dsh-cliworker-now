import { useEffect, useState } from 'react'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { CliId, Worker, WorkerSnapshot, DshSubagent } from '../shared/types.ts'
import type { TaskMode, WorkerLevel } from '../shared/types.ts'
import { setLanguagePreference, t } from './i18n.ts'

export type Snapshot = WorkerSnapshot & { configuring?: boolean }
export type API = Pick<ClientRemote, '$stream'> & {
  cliworker: Omit<ClientRemote['cliworker'], 'ensureHarnessConversation' | 'repairHarnessConversation' | 'permissionForWorker' | 'configureWorkerPermission' | 'setWorkerGoal' | 'setWorkerGoalStatus' | 'clearWorkerGoal' | 'forkWorker' | 'accountRespond' | 'accountStartWith' | 'recoverCliCleanup' | 'listDshSubagents' | 'watchDshSubagents' | 'promptDshSubagent' | 'stopDshSubagent' | 'hideDshSubagent'> & {
    listDshSubagents?: (parentId: string, signal: AbortSignal) => Promise<RemoteResult<string>>
    watchDshSubagents?: (parentId: string, signal: AbortSignal) => ReturnType<ClientRemote['cliworker']['watch']>
    promptDshSubagent?: (parentId: string, childId: string, prompt: string, requestId: string, signal: AbortSignal) => Promise<RemoteResult<string>>
    stopDshSubagent?: (parentId: string, childId: string, signal: AbortSignal) => Promise<RemoteResult<string>>
    hideDshSubagent?: (parentId: string, childId: string, signal: AbortSignal) => Promise<RemoteResult<void>>
    /** Optional until an older Host has upgraded its native-conversation bridge. */
    ensureHarnessConversation?: (parentId: string, workerId: string) => Promise<RemoteResult<string>>
    /** Explicitly repair an unreadable owned display binding; never submits a CLI prompt. */
    repairHarnessConversation?: (parentId: string, workerId: string, expectedSessionId: string, signal: AbortSignal) => Promise<RemoteResult<string>>
    permissionForWorker?: (parentId: string, workerId: string, signal: AbortSignal) => Promise<RemoteResult<string>>
    configureWorkerPermission?: (parentId: string, workerId: string, setting: TaskMode | WorkerLevel, signal: AbortSignal) => Promise<RemoteResult<string>>
    setWorkerGoal?: (parentId: string, workerId: string, objective: string, expectedRevision: number, signal: AbortSignal) => Promise<RemoteResult<string>>
    setWorkerGoalStatus?: (parentId: string, workerId: string, status: 'active' | 'paused', expectedRevision: number, signal: AbortSignal) => Promise<RemoteResult<string>>
    clearWorkerGoal?: (parentId: string, workerId: string, expectedRevision: number, signal: AbortSignal) => Promise<RemoteResult<void>>
    forkWorker?: (parentId: string, workerId: string, atMessageId: string, signal: AbortSignal) => Promise<RemoteResult<string>>
    /** The user's answer to a plugin-drawn login window step (JSON); absent on older Hosts. */
    accountRespond?: (parentId: string, accountId: string, response: string) => Promise<RemoteResult<boolean>>
    /** A provider picked in the account window, or one login to sign out; absent on older Hosts. */
    accountStartWith?: (parentId: string, cli: CliId, action: string, options: string, signal?: AbortSignal) => Promise<RemoteResult<string>>
    /** Release one CLI paused after an unconfirmed cleanup, once the user confirmed; absent on older Hosts. */
    recoverCliCleanup?: (parentId: string, cli: CliId, signal: AbortSignal) => Promise<RemoteResult<string>>
  }
}
export const value = <T>(result: RemoteResult<T>): T => {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
const empty = (workers: Worker[] = []): Snapshot => ({ workers, timeline: [], revision: 0, truncated: false })

export function useWorkers(api: API, session: string, selected = '') {
  const key = JSON.stringify([session, selected])
  const [attempt, retry] = useState(0)
  const [state, setState] = useState(() => ({ key, session, snapshot: empty(), error: '', connecting: true }))
  useEffect(() => {
    let alive = true
    setState((old) => ({
      key,
      session,
      snapshot: old.key === key ? old.snapshot : empty(old.session === session ? old.snapshot.workers : []),
      error: '',
      connecting: true,
    }))
    const stream = api.$stream<string>({
      name: `CLI Worker ${session}`,
      open: (signal) => api.cliworker.watch(session, selected, signal),
      ended: () => new Error(t('连接已结束')),
    })
    void (async () => {
      try {
        for await (const item of stream) {
          const snapshot: Snapshot = JSON.parse(item.value)
          setLanguagePreference(snapshot.language)
          if (snapshot.selected && snapshot.selected.id !== selected) throw new Error(t('收到不匹配的任务记录'))
          if (alive) setState({ key, session, snapshot, error: '', connecting: false })
          item.accept()
        }
        if (alive) throw new Error(t('连接已结束'))
      } catch (error) {
        if (alive) setState((old) => ({ ...old, error: String(error), connecting: false }))
      }
    })()
    return () => {
      alive = false
      void stream.dispose().catch(() => undefined)
    }
  }, [api, session, selected, key, attempt])
  // React effects run after paint: never show the previous worker during that gap.
  const current =
    state.key === key
      ? state
      : {
          snapshot: empty(state.session === session ? state.snapshot.workers : []),
          error: '',
          connecting: true,
        }
  return { ...current, reconnect: () => retry((n) => n + 1) }
}

/** Separate failure domain: a missing native service cannot break the Worker stream. */
export function useDshSubagents(api: API, session: string, enabled: boolean) {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  const [attempt, retry] = useState(0)
  const [state, setState] = useState<{ session: string; rows: DshSubagent[]; error?: string }>({ session, rows: [] })
  useEffect(() => {
    if (typeof document === 'undefined') return
    const changed = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  useEffect(() => {
    if (!enabled || !visible) return
    const controller = new AbortController()
    const accept = (raw: string) => {
      const rows = JSON.parse(raw) as DshSubagent[]
      if (!Array.isArray(rows) || rows.some((row) => row.parentSessionId !== session))
        throw new Error(t('DSH 子 Agent 列表暂时不可用'))
      if (!controller.signal.aborted) setState({ session, rows })
    }
    const failed = () => { if (!controller.signal.aborted) setState({ session, rows: [], error: t('DSH 子 Agent 列表暂时不可用') }) }
    let dispose: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    if (api.cliworker.watchDshSubagents) {
      const stream = api.$stream<string>({
        name: `DSH subagents ${session}`,
        open: (signal) => api.cliworker.watchDshSubagents!(session, signal),
        ended: () => new Error(t('连接已结束')),
      })
      dispose = () => { void stream.dispose().catch(() => undefined) }
      void (async () => {
        try {
          for await (const item of stream) { accept(item.value); item.accept() }
          if (!controller.signal.aborted) failed()
        }
        catch { failed() }
      })()
    } else if (api.cliworker.listDshSubagents) {
      const poll = async () => {
        try { accept(value(await api.cliworker.listDshSubagents!(session, controller.signal))) }
        catch { failed() }
        if (!controller.signal.aborted) timer = setTimeout(() => { void poll() }, 2000)
      }
      void poll()
    }
    return () => { controller.abort(); dispose?.(); clearTimeout(timer) }
  }, [api, session, enabled, visible, attempt])
  return { rows: enabled && state.session === session ? state.rows : [],
    error: enabled && state.session === session ? state.error : undefined,
    refresh: () => retry((n) => n + 1) }
}

export function filterDshSubagents(rows: DshSubagent[], query: string, filter: string) {
  const search = query.trim().toLowerCase()
  return rows.filter((row) => `DSH ${row.agentName ?? ''} ${row.name} ${row.model ?? ''}`.toLowerCase().includes(search) &&
    (filter === 'all' || (filter === 'active' ? row.status === 'running'
      : filter === 'completed' ? row.status === 'completed' : row.status === 'failed' && !row.stopped)))
}
