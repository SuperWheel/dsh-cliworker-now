import { useEffect } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Worker } from '../shared/types.ts'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    cliworkerApproval: unknown
  }
}

/**
 * DSH answers a Worker-UI turn's authorization request only for a native child
 * session this Client holds. Hold every running Worker's child while the CLI
 * Worker pane is mounted, so the native approval panel can appear in that
 * Worker's conversation even when the user is viewing another one.
 */
export function ApprovalSessionRetention({
  services,
  parentSessionId,
  workers,
}: {
  services: Pick<Context, 'sessions'>
  parentSessionId: string
  workers: readonly Worker[]
}) {
  const key = workers
    .filter(
      (worker) =>
        worker.status === 'running' && worker.harnessConversation?.parentSessionId === parentSessionId,
    )
    .map((worker) => worker.harnessConversation!.sessionId)
    .sort()
    .join('\n')
  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const held: SessionReference[] = []
    for (const childSessionId of key.split('\n'))
      try {
        const reference = services.sessions.retain(
          {
            parentSessionId: parentSessionId as SessionId,
            childSessionId: childSessionId as SessionId,
            mode: 'continuable',
          },
          { source: 'cliworkerApproval', signal: controller.signal },
        )
        // Opening history may fail; the Worker conversation reports it, not this holder.
        void Promise.resolve(reference.ready).catch(() => undefined)
        held.push(reference)
      } catch {
        // Without a held session DSH resolves the request as unanswered (denied).
      }
    return () => {
      controller.abort()
      for (const reference of held) reference.release()
    }
  }, [services.sessions, parentSessionId, key])
  return null
}
