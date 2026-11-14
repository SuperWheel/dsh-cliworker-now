import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { configuredCliExecutable } from './adapters.ts'
import type { ActiveCliId } from '../shared/types.ts'
import type { RuntimeConfig } from './process.ts'

/** Pin the recorded entry, then use the normal discovery/renewal/cleanup path.
 * No PATH discovery, automatic path migration, or edits to the original store. */
export async function backgroundConnectionConfig(cli: ActiveCliId, config: RuntimeConfig, signal: AbortSignal): Promise<RuntimeConfig> {
  signal.throwIfAborted()
  const entry = config.cliExecutablePaths?.read(cli)
  const executable = entry?.mode === 'manual' ? entry.path : configuredCliExecutable(cli, config) || entry?.path
  if (!executable || !isAbsolute(executable) || !(await stat(executable)).isFile()) throw new Error('没有已记录的 CLI 入口')
  signal.throwIfAborted()
  return { ...config, [cli === 'antigravity' ? 'executable' : `${cli}Executable`]: executable, cliExecutablePaths: undefined }
}
