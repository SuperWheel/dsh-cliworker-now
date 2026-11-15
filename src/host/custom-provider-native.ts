import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { isMap, isNode, isScalar, parseDocument } from 'yaml'
import { parseAccountLoginId } from '../shared/account-links.ts'
import { commitNativeFiles, nativeJson, NativeRollbackError, readNativeFile } from './custom-provider-files.ts'

type Cli = 'pi' | 'omp'
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const invalid = () => new Error('账号来源已变化，请刷新后重试')
export const sameProviderConfiguration = (a: unknown, b: unknown): boolean => object(a) && object(b) && isDeepStrictEqual(a, b)
const configName = (cli: Cli) => cli === 'pi' ? 'models.json' : 'models.yml'
function parseConfig(cli: Cli, text: string | undefined) {
  const doc = cli === 'omp' ? parseDocument(text ?? '', { uniqueKeys: true, keepSourceTokens: true }) : undefined
  if (doc?.errors.length || doc?.warnings.length) throw invalid()
  const value: unknown = cli === 'pi' ? nativeJson(text).value : doc!.toJS({ maxAliasCount: 0 }) ?? {}
  if (!object(value) || value.providers !== undefined && !object(value.providers)) throw invalid()
  return { value, doc }
}

/** Delete the selected node's original span; never serialize the rest of the YAML document. */
export function removeNativeConfigProvider(cli: Cli, text: string, provider: string): string {
  const { value, doc } = parseConfig(cli, text)
  if (!Object.hasOwn(value.providers ?? {}, provider)) throw invalid()
  let next: string
  if (cli === 'pi') next = nativeJson(text).remove(['providers', provider])
  else {
    const map = doc!.get('providers', true)
    if (!isMap(map)) throw invalid()
    const index = map.items.findIndex(pair => isScalar(pair.key) && pair.key.value === provider)
    const pair = map.items[index]
    if (!pair || !isScalar(pair.key) || !pair.key.range || !isNode(pair.value) || !pair.value.range) throw invalid()
    const start = pair.key.range[0], token = map.srcToken
    if (token?.type === 'block-map') {
      const line = text.lastIndexOf('\n', start - 1) + 1, indent = text.slice(line, start)
      if (!/^[ \t]*$/.test(indent)) throw invalid()
      const end = pair.value.range[2]
      // Keep the mapping explicit when deleting its only entry, rather than changing it to null.
      const replacement = map.items.length === 1 ? indent + '{}' + (text.slice(line, end).endsWith('\n') ? text.includes('\r\n') ? '\r\n' : '\n' : '') : ''
      next = text.slice(0, line) + replacement + text.slice(end)
    } else if (token?.type === 'flow-collection') {
      const comma = token.items[index + 1]?.start.find(item => item.type === 'comma')
        ?? token.items[index]?.start.find(item => item.type === 'comma')
      const spans = [[start, pair.value.range[1]], ...(comma ? [[comma.offset, comma.offset + comma.source.length]] : [])]
      next = text
      for (const [from, to] of spans.sort((a, b) => b[0]! - a[0]!)) next = next.slice(0, from) + next.slice(to)
    } else throw invalid()
  }
  const expected = { ...value, providers: { ...value.providers } }; delete expected.providers[provider]
  if (!isDeepStrictEqual(parseConfig(cli, next).value, expected)) throw invalid()
  return next
}

function selected(cli: Cli, stateDirectory: string, login: string, nativeHome = homedir()) {
  const target = parseAccountLoginId(login)
  if (target?.cli !== cli || target.entry !== 'native.config') throw invalid()
  const native = readNativeFile(join(nativeHome, `.${cli}`, 'agent', configName(cli)))
  const parsed = parseConfig(cli, native.text)
  return { target, native, parsed, snapshotPath: join(stateDirectory, 'accounts', cli, 'agent', configName(cli)) }
}

/** Native config existence is independent of credentials, model caches and environment variables. */
export function piOmpNativeConfigProviderExists(cli: Cli, stateDirectory: string, login: string, nativeHome?: string): boolean {
  const current = selected(cli, stateDirectory, login, nativeHome)
  return Object.hasOwn(current.parsed.value.providers ?? {}, current.target.provider)
}

/** Caller holds the CLI reservation. Persistent 0600 backups precede any source modification. */
export function deletePiOmpNativeConfigProvider(
  cli: Cli, stateDirectory: string, login: string, assertCurrent: () => void, nativeHome?: string,
): void {
  try {
    assertCurrent()
    const { target, native, parsed, snapshotPath } = selected(cli, stateDirectory, login, nativeHome)
    if (native.text === undefined || !object(parsed.value.providers?.[target.provider])) throw invalid()
    const snapshot = readNativeFile(snapshotPath)
    const copied = parseConfig(cli, snapshot.text)
    const changes = [{ file: native, text: removeNativeConfigProvider(cli, native.text, target.provider) }]
    // Identical content proves this is the copied provider. A separately edited private
    // provider remains intact, and keeps its separate row in the refreshed account list.
    if (snapshot.text !== undefined && sameProviderConfiguration(copied.value.providers?.[target.provider], parsed.value.providers[target.provider]))
      changes.push({ file: snapshot, text: removeNativeConfigProvider(cli, snapshot.text, target.provider) })
    const backupDirectory = join(stateDirectory, 'account-config-backups', cli, `${Date.now()}-${randomUUID()}`)
    const backups = changes.map(({ file }, index) => ({
      file: readNativeFile(join(backupDirectory, `${index === 0 ? 'native' : 'snapshot'}-${configName(cli)}`), true),
      text: file.text!,
    }))
    commitNativeFiles(backups, assertCurrent)
    // Backups are deliberately retained on both success and failure. Never expose their content.
    commitNativeFiles(changes, assertCurrent, () => {
      for (const change of changes) {
        const actual = readNativeFile(change.file.path)
        if (actual.text !== change.text || actual.mode !== change.file.mode ||
          Object.hasOwn(parseConfig(cli, actual.text).value.providers ?? {}, target.provider)) throw invalid()
      }
    })
  } catch (error) { throw error instanceof NativeRollbackError ? error : invalid() }
}
