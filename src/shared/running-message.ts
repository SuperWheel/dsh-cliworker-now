// traecn is intentionally absent from native steering: the advertised feature has not been verified.
import type { CliId, Worker } from './types.ts'

export const RUNNING_MESSAGE_MODES = ['steer', 'interrupt', 'queue'] as const
export type RunningMessageMode = (typeof RUNNING_MESSAGE_MODES)[number]
export const RUNNING_MESSAGE_LABELS: Record<RunningMessageMode, string> = {
  steer: '引导',
  interrupt: '插队',
  queue: '排队',
}
/** Only protocols with an implemented, acknowledged native steering channel. */
export const NATIVE_STEERING_TRANSPORTS: Partial<Record<CliId, string>> = {
  codex: 'codex-app-v1',
  hermes: 'hermes-http-v1',
  pi: 'pi-rpc-v1',
  omp: 'omp-rpc-v1',
}
export const supportsNativeSteering = (cli: CliId): boolean => !!NATIVE_STEERING_TRANSPORTS[cli]
/** Legacy Workers keep their original transport; an upgrade never changes their input protocol. */
export const supportsWorkerNativeSteering = (worker: Pick<Worker, 'preference' | 'transport'>): boolean => {
  const cli = worker.preference.cli ?? 'antigravity'
  return (
    cli === 'pi' ||
    cli === 'omp' ||
    (!!worker.transport && NATIVE_STEERING_TRANSPORTS[cli] === worker.transport)
  )
}
export const defaultRunningMessageMode = (cli: CliId): RunningMessageMode =>
  supportsNativeSteering(cli) ? 'steer' : 'queue'

export interface RunningMessageSettings {
  cli: CliId
  mode: RunningMessageMode
  canSteer: boolean
}
