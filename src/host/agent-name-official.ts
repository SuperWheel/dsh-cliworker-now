import { agentNameKey, assertDshAgentName, isDshAgentName } from '../shared/agent-names.ts'
import type { AgentNameOverrides, OfficialSubagentRename } from './agent-name-overrides.ts'

type RenameRequest = Parameters<OfficialSubagentRename['rename']>[0]

export async function renameThroughOfficial(
  official: OfficialSubagentRename | undefined,
  request: RenameRequest,
): Promise<void> {
  request.signal?.throwIfAborted()
  if (!official) throw new Error('DSH 官方改名接口不可用')
  assertDshAgentName(request.name)
  const receipt = await official.rename(request)
  if (
    receipt === false ||
    (receipt && typeof receipt === 'object' && 'accepted' in receipt && receipt.accepted === false)
  )
    throw new Error('DSH 官方接口拒绝改名')
}

interface CatalogName {
  id: string
  name?: string
  formerNames?: readonly string[]
}
export interface OfficialMigrationDependencies {
  overrides: AgentNameOverrides
  official: OfficialSubagentRename | undefined
  readCatalog(parent: string, signal: AbortSignal): Promise<readonly CatalogName[]>
  log(reason: string): void
}
interface MigratedChild {
  parent: string
  childId: string
}
export interface OfficialMigrationResult {
  migrated: MigratedChild[]
  kept: (MigratedChild & { reason: string })[]
}

function checkCatalog(catalog: readonly CatalogName[], childId: string, names: ReadonlySet<string>) {
  const child = catalog.find((row) => row.id === childId)
  if (!child) throw new Error('父会话目录中找不到原子会话 ID')
  for (const row of catalog) {
    if (row.id === childId) continue
    const conflict = [row.name, ...(row.formerNames ?? [])].find(
      (name) => name !== undefined && names.has(agentNameKey(name)),
    )
    if (conflict !== undefined) throw new Error(`名称冲突：“${conflict}”已属于其他子会话`)
  }
  return child
}

export async function migrateOverridesToOfficial(
  deps: OfficialMigrationDependencies,
  signal: AbortSignal,
): Promise<OfficialMigrationResult> {
  const { overrides, official, readCatalog, log } = deps
  const migrated: OfficialMigrationResult['migrated'] = []
  const kept: OfficialMigrationResult['kept'] = []
  signal.throwIfAborted()
  for (const parent of overrides.parents()) {
    for (const [childId, entry] of Object.entries(overrides.entries(parent))) {
      const checkCurrent = () => {
        signal.throwIfAborted()
        if (overrides.get(parent, childId) !== entry) throw new Error('迁移期间本地名称已变更，请重新核对')
      }
      try {
        checkCurrent()
        if (!official) throw new Error('DSH 官方改名接口不可用')
        assertDshAgentName(entry.name)
        const history = new Set(entry.formerNames)
        if (entry.registeredName) history.add(entry.registeredName)
        history.delete(entry.name)
        const names = new Set([...history, entry.name].map(agentNameKey))
        const checkSiblings = () => {
          for (const [otherId, sibling] of Object.entries(overrides.entries(parent))) {
            if (otherId === childId) continue
            if (
              [sibling.name, sibling.registeredName, ...sibling.formerNames].some(
                (name) => name !== undefined && names.has(agentNameKey(name)),
              )
            )
              throw new Error('本地名称覆盖项与同父会话内其他子 Agent 存在名称冲突')
          }
        }
        checkSiblings()
        const current = checkCatalog(await readCatalog(parent, signal), childId, names)
        checkCurrent()
        const owned = new Set([current.name, ...(current.formerNames ?? [])])
        const validHistory = [...history].filter(isDshAgentName)
        const steps = validHistory.filter((name) => !owned.has(name))
        // On restart a former target may only be an alias now. It must be the *current* name at the end.
        if (steps.length || current.name !== entry.name) steps.push(entry.name)
        for (const name of steps) {
          checkCurrent()
          checkSiblings()
          await renameThroughOfficial(official, {
            parentSessionId: parent,
            childSessionId: childId,
            name,
            signal,
          })
        }
        checkCurrent()
        const verified = checkCatalog(await readCatalog(parent, signal), childId, names)
        checkCurrent()
        if (verified.name !== entry.name) throw new Error('官方目录读回的现名与覆盖项不一致')
        if (validHistory.length !== history.size) throw new Error('历史名称不符合 DSH 规则，保留插件兼容别名')
        const verifiedHistory = verified.formerNames
        if (verifiedHistory && validHistory.some((name) => !verifiedHistory.includes(name)))
          throw new Error('官方目录未确认全部曾用名归属')
        checkSiblings()
        overrides.delete(parent, childId)
        migrated.push({ parent, childId })
      } catch (error) {
        signal.throwIfAborted()
        const reason = error instanceof Error ? error.message : '官方改名迁移失败'
        kept.push({ parent, childId, reason })
        log(`子 Agent 名称覆盖项已保留（父会话 ${parent}，子会话 ${childId}）：${reason}`)
      }
    }
  }
  return { migrated, kept }
}
