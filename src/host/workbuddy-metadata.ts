import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { probeWorkBuddyMetadata } from './native-workbuddy.mjs'
import { resolveWorkBuddyInstallation } from './workbuddy-installation.ts'
import type { WorkBuddyCliId } from './workbuddy-variant.ts'
import { ProcessCleanupUnconfirmedError } from './process.ts'
import type { ModelChoice } from '../shared/types.ts'

interface Metadata {
  models: ModelChoice[]
  endpoint: string
  binding: string
}
interface Scope {
  cli: WorkBuddyCliId
  executable: string
  project: string
  signal: AbortSignal
  active: boolean
  reading?: Promise<Metadata>
}
const snapshots = new AsyncLocalStorage<Scope>()

/** One fresh native handshake per authorization. Never read credential files or
 * retain the native session/initialization payload beyond this operation. */
export async function readWorkBuddyMetadata(
  cli: WorkBuddyCliId, executable: string, project: string, signal: AbortSignal,
): Promise<Metadata> {
  signal.throwIfAborted()
  const scope = snapshots.getStore()
  const read = async () => {
    const install = await resolveWorkBuddyInstallation(cli, { manualPath: executable })
    signal.throwIfAborted()
    const result = await probeWorkBuddyMetadata({ cli, argv: [install.runtime, install.entry], project,
      env: process.env, signal, timeoutMs: 20_000 }).catch(error => {
        if (error instanceof Error && error.message === 'Native process exit is unconfirmed')
          throw new ProcessCleanupUnconfirmedError({ cause: error })
        throw error
      })
    signal.throwIfAborted()
    // This is an installation/site binding, not a claim of principal identity.
    // WorkBuddy exposes no verified account ID; each admission probes login afresh.
    const source = [cli, install.runtime, install.entry, install.cliVersion, install.configDir, result.endpoint]
    return { models: result.models, endpoint: result.endpoint,
      binding: `cli-account-v1:${createHash('sha256').update(JSON.stringify(source)).digest('hex')}` }
  }
  if (scope?.active && scope.cli === cli && scope.executable === executable && scope.project === project && scope.signal === signal)
    return scope.reading ??= read()
  return read()
}

export async function withWorkBuddyMetadataSnapshot<T>(
  cli: WorkBuddyCliId, executable: string, project: string, signal: AbortSignal, operation: () => Promise<T>,
): Promise<T> {
  const scope: Scope = { cli, executable, project, signal, active: true }
  return snapshots.run(scope, async () => {
    try { return await operation() }
    finally { scope.active = false; scope.reading = undefined }
  })
}
