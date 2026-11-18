import { z as validate } from 'zod'
import {
  projectExternalTurnUsage,
  recoverHarnessTurnRuns,
  type HarnessTurnObservation,
} from './harness-turn-usage.ts'
import { projectExternalTurnAnswer } from './harness-turn-answer.ts'
import { projectRequestState } from './native-request-state.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { CLI_IDS } from '../shared/types.ts'
import { RUNNING_MESSAGE_MODES } from '../shared/running-message.ts'
import { failure } from './service-errors.ts'
import type { ServiceContext } from './index.ts'

export async function* watch(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  signal: AbortSignal,
): AsyncIterable<string> {
  let wake: (() => void) | undefined
  let dirty = true
  let observedSessionId: string | undefined
  const notify = () => {
    dirty = true
    wake?.()
  }
  const unsubscribe = host.runtime.subscribe(notify)
  const unsubscribeSession = host.ctx.on(
    'session/event',
    (session, event) => {
      if (session.id === observedSessionId && event.type === 'turn/end') notify()
    },
    { global: true },
  )
  const lifetime = AbortSignal.any([signal, host.disposed.signal])
  lifetime.addEventListener('abort', notify)
  try {
    while (!lifetime.aborted) {
      if (!dirty)
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      wake = undefined
      if (lifetime.aborted) return
      dirty = false
      const snapshot = host.runtime.snapshot(parentSessionId, workerId || undefined)
      const selected = snapshot.selected
      const binding = selected?.harnessConversation
      observedSessionId = binding?.parentSessionId === parentSessionId ? binding.sessionId : undefined
      let record =
        binding &&
        host.harnessConversationStore
          ?.list()
          .find(
            (entry) =>
              entry.sessionId === binding.sessionId &&
              entry.workerId === selected.id &&
              entry.parentSessionId === parentSessionId,
          )
      const events = selected ? host.runtime.storage.history(selected.id) : []
      const needsRecovery = record?.nativeInputs?.some(
        (input) =>
          input.accepted &&
          events.some(
            (event) =>
              event.kind === 'user' &&
              event.queuedFollowupId === input.batchId &&
              event.admittedRunId === event.runId &&
              !record?.turnRuns?.some((entry) => entry.runId === event.runId),
          ),
      )
      let externalTurnAnswer: import('../shared/native-turn-answer.ts').ExternalTurnAnswer | undefined
      if (record && selected && (record.turnRuns?.length || (!snapshot.selectedBusy && needsRecovery))) {
        const query = host.ctx?.get('sessionQuery') as
          | {
              observeSession(
                id: SessionId,
                options: { signal: AbortSignal; projectionMode: 'none' },
              ): Promise<Disposable & HarnessTurnObservation>
            }
          | undefined
        if (query) {
          try {
            const observation = await query.observeSession(SessionId(record.sessionId), {
              signal: lifetime,
              projectionMode: 'none',
            })
            try {
              if (!snapshot.selectedBusy && needsRecovery)
                record = recoverHarnessTurnRuns(record, selected, events, observation)
              externalTurnAnswer = projectExternalTurnAnswer(record, selected, events, observation)
            } finally {
              observation[Symbol.dispose]()
            }
          } catch {
            if (lifetime.aborted) return
            // Read failures are not permission to guess or rewrite an old turn.
          }
          if (host.runtime.snapshot(parentSessionId, workerId || undefined).revision !== snapshot.revision) {
            dirty = true
            continue
          }
        }
      }
      yield JSON.stringify({
        ...snapshot,
        ...(selected && binding?.parentSessionId === parentSessionId
          ? {
              externalRequestState: projectRequestState(selected, events),
              externalTurnAnswer,
              externalTurnUsage: projectExternalTurnUsage(
                record,
                selected,
                !!snapshot.selectedBusy,
                events,
                (runId) => host.runtime.runUsage(parentSessionId, selected.id, runId),
                (runId) => host.runtime.runCredits(parentSessionId, selected.id, runId),
              ),
            }
          : {}),
        configuring: host.pending.has(parentSessionId),
      })
    }
  } finally {
    unsubscribe()
    unsubscribeSession()
    lifetime.removeEventListener('abort', notify)
  }
}

export async function history(
  host: ServiceContext,
  parentSessionId: string,
  workerId: string,
  anchor: string,
  direction: string,
): Promise<string> {
  try {
    return JSON.stringify(host.runtime.history(parentSessionId, workerId, anchor, direction))
  } catch (error) {
    throw failure(error)
  }
}

export async function runningMessageSettings(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const agent = await host.parent(parentSessionId)
    signal.throwIfAborted()
    return JSON.stringify(
      host.runtime.storage.runningMessageSettings(host.project(agent), validate.enum(CLI_IDS).parse(cli)),
    )
  } catch (error) {
    throw failure(error)
  }
}

export async function saveRunningMessageMode(
  host: ServiceContext,
  parentSessionId: string,
  cli: string,
  mode: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const agent = await host.parent(parentSessionId)
    signal.throwIfAborted()
    const result = host.runtime.storage.setRunningMessageMode(
      host.project(agent),
      validate.enum(CLI_IDS).parse(cli),
      validate.enum(RUNNING_MESSAGE_MODES).parse(mode),
    )
    host.runtime.changed()
    return JSON.stringify(result)
  } catch (error) {
    throw failure(error)
  }
}

export async function rolePresets(
  host: ServiceContext,
  parentSessionId: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    return JSON.stringify(host.runtime.storage.rolePresets())
  } catch (error) {
    throw failure(error)
  }
}

export async function saveRolePreset(
  host: ServiceContext,
  parentSessionId: string,
  requestJSON: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    const preset = host.runtime.storage.saveRolePreset(JSON.parse(requestJSON))
    host.runtime.changed()
    return JSON.stringify(preset)
  } catch (error) {
    throw failure(error)
  }
}

export async function deleteRolePreset(
  host: ServiceContext,
  parentSessionId: string,
  presetId: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    await host.parent(parentSessionId)
    signal.throwIfAborted()
    host.runtime.storage.deleteRolePreset(presetId)
    host.runtime.changed()
  } catch (error) {
    throw failure(error)
  }
}
