import type { Worker } from '../shared/types.ts'
import type { HarnessConversationStore } from './harness-conversation-store.ts'
import type { HarnessConversationRecord } from './harness-conversation-types.ts'

export interface BindingReplacementRuntime {
  get(parent: string, id: string): Worker
  readonly storage: { readonly workers: ReadonlyMap<string, Worker>; save(worker: Worker): void }
  changed(): void
}

/**
 * Replaces a Worker's display child binding. The private store's CAS is
 * authoritative; the public Worker metadata is published only after it commits.
 * Issue #10: a Worker rebound from an earlier DS Bot segment may replace a
 * display child of that segment; one of the two parents must then be a
 * recorded former segment of the Worker.
 */
export function replaceWorkerBinding(
  runtime: BindingReplacementRuntime,
  records: Pick<HarnessConversationStore, 'replace'>,
  previous: HarnessConversationRecord,
  next: HarnessConversationRecord,
): void {
  if (previous.workerId !== next.workerId) throw new Error('Worker 原生会话替换的当前身份不匹配')
  const reparent = previous.parentSessionId !== next.parentSessionId
  const owner = reparent ? runtime.storage.workers.get(next.workerId)?.parentSessionId : previous.parentSessionId
  const worker = runtime.get(owner ?? previous.parentSessionId, previous.workerId)
  if (reparent) {
    const other = worker.parentSessionId === next.parentSessionId ? previous.parentSessionId
      : worker.parentSessionId === previous.parentSessionId ? next.parentSessionId : undefined
    if (!other || !worker.formerParentSessionIds?.includes(other))
      throw new Error('原生会话父身份不匹配')
  }
  if (worker.harnessConversation?.sessionId !== previous.sessionId)
    throw new Error('Worker 原生会话替换的当前身份不匹配')
  records.replace(previous, next, { reparent })
  const previousBinding = worker.harnessConversation
  worker.harnessConversation = {
    ...previousBinding,
    sessionId: next.sessionId,
    parentSessionId: next.parentSessionId,
  }
  try {
    runtime.storage.save(worker)
  } catch (error) {
    worker.harnessConversation = previousBinding
    const rollback = {
      ...previous,
      retiredSessionIds: [...(previous.retiredSessionIds ?? []), next.sessionId],
    }
    try {
      records.replace(next, rollback, { reparent })
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], '原生会话绑定替换及回滚未完成')
    }
    throw error
  }
  runtime.changed()
}
