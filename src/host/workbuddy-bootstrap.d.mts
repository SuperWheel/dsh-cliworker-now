import type { WorkBuddyInstallation } from './workbuddy-installation.ts'
export type WorkBuddyEnvironment = Record<string, string | undefined>
export function workbuddyChildEnv(base: WorkBuddyEnvironment | undefined, install: Pick<WorkBuddyInstallation, 'configDir'> & Partial<WorkBuddyInstallation>): WorkBuddyEnvironment
export interface WorkBuddyLaunch {
  env: WorkBuddyEnvironment
  deliver(io: any, pid: number): Promise<void>
  ready(timeoutMs?: number): Promise<{ port: number }>
  close(): Promise<void>
}
export function createWorkBuddyLaunch(options: {
  install: Pick<WorkBuddyInstallation, 'runtime' | 'configDir'> & Partial<WorkBuddyInstallation>
  platform?: NodeJS.Platform
  baseEnv?: WorkBuddyEnvironment
  signal?: AbortSignal
}): Promise<WorkBuddyLaunch>
