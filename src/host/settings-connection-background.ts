import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { configuredCliExecutable } from './adapters.ts'
import { readCliAccountBinding } from './cli-account-binding.ts'
import { discoverZCode, zcodeAuthDirectory } from './zcode-adapter.ts'
import type { RuntimeConfig, ProcessBackend } from './process.ts'
import type { CatalogReceipt } from './settings-connection-cache.ts'

/** Only ZCode currently has a complete, process-free directory path. */
export async function backgroundZCodeCatalog(backend: ProcessBackend, config: RuntimeConfig, project: string, signal: AbortSignal): Promise<CatalogReceipt> {
  const entry = config.cliExecutablePaths?.read('zcode')
  const executable = entry?.mode === 'manual' ? entry.path : configuredCliExecutable('zcode', config) || entry?.path
  if (!executable || !isAbsolute(executable) || !(await stat(executable)).isFile()) throw new Error('没有已记录的 ZCode 入口')
  const reject = () => { throw new Error('后台目录禁止启动 CLI 进程') }
  const readonlyBackend: ProcessBackend = { ...backend, resolveExecutable: async path => {
    if (path !== executable) return reject()
    return executable
  }, spawn: reject, spawnTerminal: undefined }
  const pinned = { ...config, zcodeExecutable: executable, cliExecutablePaths: undefined }
  const binding = await readCliAccountBinding('zcode', readonlyBackend, pinned, project, signal)
  const models = await discoverZCode(executable, async () => reject(), '', zcodeAuthDirectory(config.zcodeAuthDirectory, config.stateDirectory), config.zcodeBuiltinConfig, { signal })
  signal.throwIfAborted()
  if (!models.length || binding !== await readCliAccountBinding('zcode', readonlyBackend, pinned, project, signal)) throw new Error('ZCode 模型来源已变化或目录为空')
  return { binding, catalog: { cli: 'zcode', models, notice: '当前账号可用模型' } }
}
