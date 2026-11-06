import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectPiInstallation } from './pi-installation.mjs'
import { captureCatalogMetadata } from './adapters.ts'
import { ProcessCleanupUnconfirmedError, type ProcessBackend, type RuntimeConfig } from './process.ts'
import { ACCOUNT_NAME } from '../shared/account-links.ts'
import type { AccountProvider } from '../shared/accounts.ts'

export type NativeLoginProvider = AccountProvider & { stores?: string }
const labels: Record<string, string> = {
  'zai-coding-cn': '智谱 BigModel Coding（中国）',
  'zhipu-coding-plan': '智谱 BigModel Coding（中国）',
  zai: 'Z.AI（国际）',
}

export function parseNativeLoginProviders(cli: 'pi' | 'omp', raw: string): NativeLoginProvider[] {
  const value: unknown = JSON.parse(raw)
  const rows = (value as { providers?: unknown })?.providers
  if (!Array.isArray(rows) || rows.length > 256) throw new Error('Invalid native login providers')
  const seen = new Set<string>()
  return rows.map(row => {
    if (!row || typeof row.id !== 'string' || !ACCOUNT_NAME.test(row.id) || seen.has(row.id) ||
        typeof row.name !== 'string' || !row.name.trim() || row.name.length > 160 ||
        /[\x00-\x1f\x7f]/u.test(row.name) ||
        (row.stores !== undefined && (typeof row.stores !== 'string' || !ACCOUNT_NAME.test(row.stores))))
      throw new Error('Invalid native login provider')
    seen.add(row.id)
    const stores = row.stores ?? (cli === 'omp' && row.id === 'openai-codex-device' ? 'openai-codex' : undefined)
    return { id: row.id, label: Object.hasOwn(labels, row.id) ? labels[row.id]! : row.name.trim(),
      ...(cli === 'omp' ? { multi: true } : {}), ...(stores ? { stores } : {}) }
  })
}

/** Successful metadata is cached only for the same installed native entry. */
export class NativeLoginProviders {
  private cache = new Map<string, NativeLoginProvider[]>()
  constructor(private backend: ProcessBackend, private config: RuntimeConfig) {}

  async read(cli: 'pi' | 'omp', executable: string, signal: AbortSignal): Promise<NativeLoginProvider[]> {
    signal.throwIfAborted()
    const entry = cli === 'pi' ? inspectPiInstallation(executable).executable : await realpath(executable)
    const info = await stat(entry)
    const key = JSON.stringify([cli, entry, info.size, info.mtimeMs, info.ino])
    const cached = this.cache.get(key)
    if (cached) return cached
    const root = await realpath(await mkdtemp(join(tmpdir(), 'cliworker-login-options-')))
    let cleanup = true
    try {
      await mkdir(join(root, 'agent'), { mode: 0o700 })
      await writeFile(join(root, 'config.json'), JSON.stringify({
        startup: { setupWizard: false, showSplash: false, checkUpdate: false },
        disabledProviders: ['native', 'claude', 'claude-plugins', 'codex', 'cursor', 'gemini',
          'opencode', 'mcp-json', 'vscode', 'windsurf', 'omp-plugins'],
        mcp: { enableProjectConfig: false }, memory: { backend: 'off' },
      }), { mode: 0o600 })
      // The helper scrubs inherited credentials before importing or spawning native code.
      const raw = await captureCatalogMetadata(this.backend, this.config,
        [process.execPath, fileURLToPath(new URL('./native-login-providers.mjs', import.meta.url)), cli, executable],
        root, signal, { CLIWORKER_LOGIN_METADATA_HOME: root, ELECTRON_RUN_AS_NODE: '1' })
      const providers = parseNativeLoginProviders(cli, raw)
      signal.throwIfAborted()
      // Bound memory and invalidate entries after installation changes.
      for (const old of this.cache.keys()) if (old.startsWith(`["${cli}",`)) this.cache.delete(old)
      this.cache.set(key, providers)
      return providers
    } catch (error) {
      if (error instanceof ProcessCleanupUnconfirmedError) cleanup = false
      throw error
    } finally {
      if (cleanup) await rm(root, { recursive: true, force: true })
    }
  }
}
