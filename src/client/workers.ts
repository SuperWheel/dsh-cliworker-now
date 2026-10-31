import { useEffect, useState } from 'react'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { CliId, Worker, WorkerSnapshot } from '../shared/types.ts'
import type { TaskMode, WorkerLevel } from '../shared/types.ts'
import { setLanguagePreference, t } from './i18n.ts'

export type Snapshot = WorkerSnapshot & { configuring?: boolean }
export type API = Pick<ClientRemote, '$stream'> & {
  cliworker: Omit<ClientRemote['cliworker'], 'ensureHarnessConversation' | 'repairHarnessConversation' | 'permissionForWorker' | 'configureWorkerPermission' | 'setWorkerGoal' | 'setWorkerGoalStatus' | 'clearWorkerGoal' | 'forkWorker' | 'accountRespond' | 'accountStartWith' | 'recoverCliCleanup'> & {
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
