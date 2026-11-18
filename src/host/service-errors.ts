import { CliBusyError, MaintenanceError } from './cli-management/maintenance.ts'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

export const failure = (error: unknown) =>
  new RemoteError('cliworker/unavailable', String(error), {
    reason: String(error),
    ...(error instanceof CliBusyError
      ? { code: error.code, busyWorkers: error.busyWorkers }
      : error instanceof MaintenanceError
        ? { code: error.code }
        : {}),
    ...(error && typeof error === 'object' && 'code' in error && error.code === 'STEER_UNKNOWN'
      ? { deliveryUnknown: true }
      : {}),
  })

/** Cancel a question/wait independently; late answers cannot commit a selection. */
export function waitForInput<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener('abort', aborted)
      reject(signal.reason ?? new Error('选择已取消'))
    }
    signal.addEventListener('abort', aborted, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
  })
}
