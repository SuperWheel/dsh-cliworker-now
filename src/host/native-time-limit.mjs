// Run timers of one native bridge: the Host's absolute deadline and an optional
// idle window that every native frame renews. Errors match task-time-limit.ts.
export const TIME_LIMIT_ERRORS = {
  total: 'Native task timed out',
  idle: 'Native task idle timed out',
}
const MAX_LIMIT_MS = 86_400_000

/** Deadline and idle window of a request; requests without a deadline count from now. */
export function readTimeLimit(config, now = Date.now()) {
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > MAX_LIMIT_MS)
    return undefined
  const deadlineAt = config.deadlineAt ?? now + config.timeoutMs
  const idleMs = config.idleTimeoutMs ?? 0
  if (
    !Number.isSafeInteger(deadlineAt) ||
    deadlineAt - now > MAX_LIMIT_MS ||
    !Number.isSafeInteger(idleMs) ||
    idleMs < 0 ||
    idleMs > MAX_LIMIT_MS
  )
    return undefined
  return { deadlineAt, idleMs }
}

/** `onExpire` runs once, with the limit that was reached first. */
export function startRunTimers({ deadlineAt, idleMs }, onExpire) {
  let expired = false,
    holds = 0,
    idle
  const expire = (kind) => {
    if (expired) return
    expired = true
    clearTimeout(total)
    clearTimeout(idle)
    onExpire(kind)
  }
  const total = setTimeout(() => expire('total'), Math.max(0, deadlineAt - Date.now()))
  const arm = () => {
    clearTimeout(idle)
    idle = setTimeout(() => expire('idle'), idleMs)
  }
  if (idleMs > 0) arm()
  return {
    /** Any native frame or diagnostic output renews the idle window. */
    touch() {
      if (!expired && idleMs > 0 && !holds) arm()
    },
    /** Pauses the idle window (not the deadline) until the returned release runs, e.g. while a user decides an approval. */
    hold() {
      holds++
      clearTimeout(idle)
      let released = false
      return () => {
        if (released) return
        released = true
        holds--
        if (!holds && !expired && idleMs > 0) arm()
      }
    },
    close() {
      expired = true
      clearTimeout(total)
      clearTimeout(idle)
    },
  }
}
