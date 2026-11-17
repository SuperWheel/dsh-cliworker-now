import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CLI_OPERATION_PHASES,
  cliCancellationCheckSchema,
  cliUpdateIncompleteSchema,
  CLI_UPDATE_GROUPS,
  type CliUpdateOperation,
  type CliUpdateSnapshot,
} from '../shared/cli-management.ts'
import { CLI_IDS } from '../shared/types.ts'
import { operationMessage } from './operation-error.ts'
import { t } from './i18n.ts'
import { value, type API } from './workers.ts'

export interface CliUpdateData {
  /** undefined = 尚未拿到；Host 不支持时 supported=false。 */
  snapshot?: CliUpdateSnapshot
  supported: boolean
  /** 整页错误（Gateway 不通等）。 */
  error?: string
  retry(): void
  /**
   * 页面打开时调用 checkCliUpdates('missing')；「检查更新」调用 'all'。
   * Rejects with a display-ready Error when the Host refuses or answers with an invalid snapshot.
   */
  check(scope: 'missing' | 'all'): Promise<void>
}

/** Waits before each reconnect after the stream dropped; the page error shows once these run out. */
export const CLI_UPDATE_RECONNECT_DELAYS_MS = [1000, 2000, 4000] as const

const ACTIVITIES = new Set<unknown>(['idle', 'preloading', 'checking'])
const STAGES = new Set<unknown>([undefined, 'local', 'remote'])
const CLIS = new Set<unknown>(CLI_IDS)
const GROUPS = new Set<unknown>(CLI_UPDATE_GROUPS)
const PHASES = new Set<unknown>(CLI_OPERATION_PHASES)
const record = (input: unknown): input is Record<string, unknown> =>
  typeof input === 'object' && input !== null && !Array.isArray(input)
class InvalidCliUpdateSnapshot extends Error {}
const validOperation = (input: unknown): input is CliUpdateOperation =>
  record(input) &&
  typeof input.id === 'string' &&
  (input.intent === 'update' || input.intent === 'install') &&
  CLIS.has(input.cli) &&
  PHASES.has(input.phase) &&
  typeof input.outputTail === 'string' &&
  (input.officialTakeover === undefined || ['available', 'pending'].includes(input.officialTakeover as string)) &&
  (input.cancellationCheck === undefined || cliCancellationCheckSchema.safeParse(input.cancellationCheck).success) &&
  (input.resume === undefined || typeof input.resume === 'boolean') &&
  (input.incomplete === undefined || cliUpdateIncompleteSchema.safeParse(input.incomplete).success)

/**
 * Basic shape check of a Host snapshot. Any invalid part discards the whole snapshot:
 * a page half-built from a foreign or newer protocol would show wrong buttons.
 */
export function parseCliUpdateSnapshot(raw: string): CliUpdateSnapshot {
  let next: unknown
  try {
    next = JSON.parse(raw)
  } catch {
    next = undefined
  }
  const seen = new Set<unknown>()
  const valid =
    record(next) &&
    Number.isSafeInteger(next.revision) &&
    (next.revision as number) >= 0 &&
    ACTIVITIES.has(next.activity) &&
    Array.isArray(next.entries) &&
    next.entries.every((entry) => {
      if (!record(entry) || !CLIS.has(entry.cli) || !GROUPS.has(entry.group) || seen.has(entry.cli)) return false
      seen.add(entry.cli)
      return typeof entry.installed === 'boolean' && STAGES.has(entry.stage) &&
        (entry.incomplete === undefined || cliUpdateIncompleteSchema.safeParse(entry.incomplete).success)
    }) &&
    Array.isArray(next.queue) &&
    next.queue.every((cli) => CLIS.has(cli)) &&
    Array.isArray(next.results) &&
    next.results.every(validOperation) &&
    (next.operation === undefined || validOperation(next.operation))
  if (!valid) throw new InvalidCliUpdateSnapshot(t('收到无效的 CLI 更新状态，请重试'))
  return next as unknown as CliUpdateSnapshot
}

interface State {
  session: string
  snapshot?: CliUpdateSnapshot
  error?: string
}

/**
 * The 「更新 CLI」 data for one open settings dialog: the cached snapshot first, then the
 * Host stream. Snapshots only move forward by `revision`; after a dropped stream the
 * snapshot is read again before resubscribing, so a missed change cannot stay hidden.
 */
export function useCliUpdateData(api: API, sessionId: string): CliUpdateData {
  const service = api.cliworker
  const supported = !!service.cliUpdateSnapshot && !!service.watchCliUpdates
  const [state, setState] = useState<State>({ session: sessionId })
  const [attempt, setAttempt] = useState(0)
  /** Lowest revision still accepted; cleared before a resync so a restarted Host is taken as is. */
  const floor = useRef<{ session: string; revision?: number }>({ session: sessionId })
  const lifetime = useRef<AbortController>()

  const accept = useCallback((session: string, snapshot: CliUpdateSnapshot) => {
    const current = floor.current
    if (current.session !== session) return false
    if (current.revision !== undefined && snapshot.revision <= current.revision) return false
    floor.current = { session, revision: snapshot.revision }
    setState({ session, snapshot })
    return true
  }, [])
  const fail = useCallback((session: string, error: unknown) => {
    if (floor.current.session !== session) return
    const message = operationMessage(error)
    setState((old) => (old.session === session ? { ...old, error: message } : { session, error: message }))
  }, [])

  // Created on first use too: the page's own mount effect (check('missing')) runs before this hook's effects.
  useEffect(() => {
    if (!lifetime.current || lifetime.current.signal.aborted) lifetime.current = new AbortController()
    const controller = lifetime.current
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!supported) return
    const controller = new AbortController()
    const signal = controller.signal
    if (floor.current.session !== sessionId) {
      floor.current = { session: sessionId }
      setState({ session: sessionId })
    }
    let stream: { dispose(): Promise<void> } | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let wake: (() => void) | undefined
    const close = () => {
      const current = stream
      stream = undefined
      void current?.dispose().catch(() => undefined)
    }
    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        wake = resolve
        timer = setTimeout(resolve, ms)
      })
    void (async () => {
      let failures = 0
      let connected = false
      while (!signal.aborted) {
        try {
          // A resync replaces whatever the old connection showed, even at a lower revision.
          if (connected) floor.current = { session: sessionId }
          const initial = parseCliUpdateSnapshot(value(await service.cliUpdateSnapshot!(sessionId, signal)))
          if (signal.aborted) return
          accept(sessionId, initial)
          connected = true
          const live = api.$stream<string>({
            name: `CLI updates ${sessionId}`,
            open: (streamSignal) => service.watchCliUpdates!(sessionId, streamSignal),
            ended: () => new Error(t('连接已结束')),
          })
          stream = live
          let generation: number | undefined
          for await (const item of live) {
            if (signal.aborted) return
            // $stream reopens on its own after a carrier loss or Host restart. Each physical
            // generation starts with a full snapshot whose revision may be lower than what the old
            // Host reached, so it replaces the old view instead of being dropped as stale.
            if (generation !== undefined && item.generation !== generation) floor.current = { session: sessionId }
            generation = item.generation
            let next: CliUpdateSnapshot
            try {
              next = parseCliUpdateSnapshot(item.value)
            } catch (error) {
              fail(sessionId, error)
              continue
            }
            accept(sessionId, next)
            item.accept()
            failures = 0
          }
          if (signal.aborted) return
          throw new Error(t('连接已结束'))
        } catch (error) {
          if (signal.aborted) return
          close()
          // Before the first snapshot there is nothing to keep showing: report at once.
          if (!connected || failures >= CLI_UPDATE_RECONNECT_DELAYS_MS.length) {
            fail(sessionId, error)
            return
          }
          await pause(CLI_UPDATE_RECONNECT_DELAYS_MS[failures++]!)
        }
      }
    })().catch(() => undefined)
    return () => {
      controller.abort()
      clearTimeout(timer)
      wake?.()
      close()
    }
  }, [api, service, sessionId, supported, attempt, accept, fail])

  const retry = useCallback(() => {
    floor.current = { session: sessionId }
    setState((old) => (old.session === sessionId ? { session: sessionId, snapshot: old.snapshot } : { session: sessionId }))
    setAttempt((n) => n + 1)
  }, [sessionId])

  const check = useCallback(
    async (scope: 'missing' | 'all') => {
      lifetime.current ??= new AbortController()
      const signal = lifetime.current.signal
      if (!service.checkCliUpdates || signal.aborted) return
      let next: CliUpdateSnapshot
      try {
        next = parseCliUpdateSnapshot(value(await service.checkCliUpdates(sessionId, scope, signal)))
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof InvalidCliUpdateSnapshot) fail(sessionId, error)
        throw new Error(operationMessage(error))
      }
      if (!signal.aborted) accept(sessionId, next)
    },
    [service, sessionId, accept, fail],
  )

  const current = state.session === sessionId ? state : { session: sessionId }
  return useMemo(
    () => ({ snapshot: supported ? current.snapshot : undefined, supported, error: supported ? current.error : undefined, retry, check }),
    [supported, current.snapshot, current.error, retry, check],
  )
}
