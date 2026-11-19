import { createHash } from 'node:crypto'
import { mkdirSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { ACCOUNT_NAME, parseAccountLoginId } from '../shared/account-links.ts'
import { commitNativeFiles, nativeJson, NativeRollbackError, readNativeFile } from './custom-provider-files.ts'

type Cli = 'pi' | 'omp'
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const filename = 'cliworker-created-providers.json'
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : object(v)
  ? Object.fromEntries(Object.keys(v).sort().map(key => [key, stable(v[key])])) : v
const fingerprint = (config: unknown, auth: unknown) => createHash('sha256').update(JSON.stringify(stable([config, auth ?? null]))).digest('hex')
const invalid = () => new Error('账号来源已变化，请刷新后重试')
const validLabel = (label: unknown): label is string =>
  typeof label === 'string' && !!label.trim() && label.length <= 80 && !/[\x00-\x1f\x7f]/.test(label)
function receipt(directory: string) {
  const file = readNativeFile(join(directory, filename), true)
  const data = nativeJson(file.text).value
  if (file.text !== undefined && (data.version !== 1 || !object(data.providers) ||
    Object.entries(data.providers).some(([id, hash]) => !ACCOUNT_NAME.test(id) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) ||
    // Optional, non-secret display names; older receipts have none.
    data.labels !== undefined && (!object(data.labels) || Object.entries(data.labels).some(([id, label]) =>
      !Object.hasOwn(data.providers as object, id) || !validLabel(label))))) throw invalid()
  return { file, providers: (data.providers ?? {}) as Record<string, string>, labels: (data.labels ?? {}) as Record<string, string> }
}
const serialize = (providers: Record<string, string>, labels: Record<string, string>) =>
  JSON.stringify({ version: 1, providers, ...(Object.keys(labels).length ? { labels } : {}) }, null, 2) + '\n'

/** Include this change in the SAME atomic commit as the plugin's own provider write.
 * Never backfill from a name, URL, shape, or the private directory: snapshots copy user config there too.
 */
export function managedProviderReceiptChange(directory: string, provider: string, config: unknown, auth?: unknown, label?: string) {
  if (!ACCOUNT_NAME.test(provider) || !object(config) || label !== undefined && !validLabel(label)) throw invalid()
  const current = receipt(directory)
  if (Object.hasOwn(current.providers, provider)) throw invalid()
  return { file: current.file, text: serialize({ ...current.providers, [provider]: fingerprint(config, auth) },
    { ...current.labels, ...(label !== undefined && label !== provider ? { [provider]: label } : {}) }) }
}

/** The receipt without `provider`, for the SAME atomic commit that removes the provider. */
export function managedProviderReceiptRemoval(directory: string, provider: string) {
  const current = receipt(directory)
  if (!Object.hasOwn(current.providers, provider)) throw invalid()
  const remaining = { ...current.providers }, labels = { ...current.labels }
  delete remaining[provider]; delete labels[provider]
  return { file: current.file, text: serialize(remaining, labels) }
}

/** Display names the plugin saved for providers it still owns (unchanged since it wrote them). */
export function managedProviderLabels(directory: string, models: Record<string, any>, auth: Record<string, any>): Map<string, string> {
  try {
    const owned = managedPiOmpProviders(directory, models, auth)
    return new Map(Object.entries(receipt(directory).labels).filter(([id]) => owned.has(id)))
  } catch { return new Map() }
}

/** Safe metadata only. A missing/changed receipt never grants deletion. */
export function managedPiOmpProviders(directory: string, models: Record<string, any>, auth: Record<string, any>): Set<string> {
  try {
    return new Set(Object.entries(receipt(directory).providers).filter(([id, hash]) =>
      Object.hasOwn(models.providers ?? {}, id) && hash === fingerprint(models.providers[id], auth[id])).map(([id]) => id))
  } catch { return new Set() }
}

function readManaged(cli: Cli, stateDirectory: string, login: string) {
  const target = parseAccountLoginId(login)
  if (target?.cli !== cli || target.entry !== 'plugin.config') throw invalid()
  const directory = join(stateDirectory, 'accounts', cli, 'agent')
  const config = readNativeFile(join(directory, cli === 'pi' ? 'models.json' : 'models.yml'), true)
  const doc = cli === 'omp' ? parseDocument(config.text ?? '', { uniqueKeys: true }) : undefined
  if (doc?.errors.length || doc?.warnings.length) throw invalid()
  const models = cli === 'pi' ? nativeJson(config.text).value : doc!.toJS({ maxAliasCount: 0 })
  if (!object(models) || !object(models.providers)) throw invalid()
  const auth = cli === 'pi' ? readNativeFile(join(directory, 'auth.json'), true) : undefined
  const credentials = auth ? nativeJson(auth.text).value : {}
  return { target, directory, config, doc, models, auth, credentials }
}

/** Authoritative readback for the managed-config handle, separate from native credential row ids. */
export function piOmpManagedProviderExists(cli: Cli, stateDirectory: string, login: string): boolean {
  const current = readManaged(cli, stateDirectory, login)
  // Even an externally edited entry still exists; never misreport it as successfully deleted.
  return Object.hasOwn(current.models.providers as object, current.target.provider) || Object.hasOwn(current.credentials, current.target.provider)
}

/** Caller owns the CLI account/maintenance reservation; revalidate immediately before each rename. */
export function deletePiOmpManagedProvider(cli: Cli, stateDirectory: string, login: string, assertCurrent: () => void) {
  let unlock: (() => void) | undefined
  try {
    assertCurrent()
    const current = readManaged(cli, stateDirectory, login)
    const { target, directory, config, auth, credentials, models, doc } = current
    if (!managedPiOmpProviders(directory, models, credentials).has(target.provider)) throw invalid()
    const proof = receipt(directory)
    const remaining = { ...proof.providers }, labels = { ...proof.labels }
    delete remaining[target.provider]; delete labels[target.provider]
    // Cooperate with Pi's native proper-lockfile lock. Never steal or clear another writer's lock.
    if (auth) { mkdirSync(auth.path + '.lock', { mode: 0o700 }); unlock = () => rmdirSync(auth.path + '.lock') }
    if (doc) doc.deleteIn(['providers', target.provider])
    const changes = [
      ...(auth && Object.hasOwn(credentials, target.provider) ? [{ file: auth, text: nativeJson(auth.text).remove([target.provider]) }] : []),
      { file: config, text: doc ? doc.toString({ lineWidth: 0 }) : nativeJson(config.text).remove(['providers', target.provider]) },
      { file: proof.file, text: serialize(remaining, labels) },
    ]
    commitNativeFiles(changes, assertCurrent, () => {
      for (const change of changes) {
        const actual = readNativeFile(change.file.path)
        if (actual.text !== change.text || actual.mode !== change.file.mode) throw invalid()
      }
    })
  } catch (error) { throw error instanceof NativeRollbackError ? error : invalid() }
  finally { try { unlock?.() } catch { /* Never include file paths in account errors. */ } }
}
