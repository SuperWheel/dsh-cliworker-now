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
