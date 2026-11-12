import { expect, it, vi } from 'vitest'
import { ownsDirectSubagent } from '../src/host/native-subagent-ownership.ts'

// SIMULATION: same-tree membership must not authorize a sibling or grandchild.
// The real SDK stale identity/unowned lineage checks run in harness-conversation-official.
it('requires a direct subagent edge as well as the exact live root', () => {
  const parent: any = { id: 'root', session: { header: {} } }
  const child: any = { id: 'child', session: { header: { origin: 'subagent', parentSession: 'root' } } }
  const grandchild: any = { id: 'grandchild', session: { header: { origin: 'subagent', parentSession: 'child' } } }
  const fork: any = { id: 'fork', session: { header: { parentSession: 'root' } } }
  const rootOf = vi.fn(() => parent)
  expect(ownsDirectSubagent({ rootOf }, parent, child)).toBe(true)
  expect(ownsDirectSubagent({ rootOf }, parent, grandchild)).toBe(false)
  expect(ownsDirectSubagent({ rootOf }, child, grandchild)).toBe(false)
  expect(ownsDirectSubagent({ rootOf }, parent, fork)).toBe(false)
  expect(ownsDirectSubagent(undefined, parent, child)).toBe(false)
  rootOf.mockReturnValue({ ...parent })
  expect(ownsDirectSubagent({ rootOf }, parent, child)).toBe(false)
  rootOf.mockImplementation(() => { throw new Error('unowned') })
  expect(ownsDirectSubagent({ rootOf }, parent, child)).toBe(false)
})
