import { describe, expect, it } from 'vitest'
import {
  accountEntryFromPart,
  actionsKnown,
  catalogEntryFromPart,
  CONNECTION_FRESH_MS,
  ConnectionReceipts,
  connectionState,
  freshReceipt,
  nextExpiry,
  slotNeed,
} from '../src/client/settings-connection-view.ts'
import type { AccountStatus } from '../src/shared/accounts.ts'
import type { ConnectionCacheInfo } from '../src/shared/settings-connection.ts'
import type { CliId } from '../src/shared/types.ts'

// Simulated Host receipts only: no CLI, account or model is read in these tests.
const NOW = 1_800_000_000_000
const receipt = (age = 0, changes: Partial<ConnectionCacheInfo> = {}): ConnectionCacheInfo =>
  ({ checkedAt: NOW - age, stale: false, revision: 0, displayOnly: true, ...changes })
const account = (changes: Partial<AccountStatus> = {}): AccountStatus =>
  ({ cli: 'codex', installed: true, state: 'authenticated', summary: '模拟：已登录', verification: 'cli', actions: [],
    cache: receipt(), ...changes })
const entry = (cli: CliId, revision = 0, changes: Record<string, unknown> = {}) => ({
  cli, revision,
  account: { loading: false, value: account({ cli, cache: undefined }), cache: receipt(0, { revision }) },
  catalog: { loading: false, value: { cli, models: [{ id: `${cli}-simulated`, efforts: ['low'] }], notice: '' },
    cache: receipt(0, { revision }) },
  ...changes,
})
const snapshot = (sequence: number, entries: unknown[]) => ({ sequence, entries })

describe('connection receipt freshness (simulated)', () => {
  it('counts only current receipts younger than ten minutes, never a clock rollback', () => {
    expect(freshReceipt(receipt(0), NOW)).toBe(true)
    expect(freshReceipt(receipt(CONNECTION_FRESH_MS - 1), NOW)).toBe(true)
    expect(freshReceipt(receipt(CONNECTION_FRESH_MS), NOW)).toBe(false)
    expect(freshReceipt(receipt(-1), NOW)).toBe(false)
    expect(freshReceipt(receipt(0, { stale: true }), NOW)).toBe(false)
    expect(freshReceipt(undefined, NOW)).toBe(false)
  })
  it('wakes at the earliest expiry of a fresh receipt', () => {
    expect(nextExpiry([receipt(100), receipt(5_000), receipt(0, { stale: true }), undefined], NOW))
      .toBe(NOW - 5_000 + CONNECTION_FRESH_MS)
    expect(nextExpiry([receipt(CONNECTION_FRESH_MS)], NOW)).toBeUndefined()
  })
})

describe('connection dot (simulated)', () => {
  const state = (data: AccountStatus | undefined, extra: { loading?: boolean; error?: string } = {}, enabled: boolean | undefined = true) =>
    connectionState(enabled, { loading: false, data, ...extra }, '', NOW)

  it('is green only for a verified, current, settled sign-in', () => {
    expect(state(account())).toBe('connected')
    expect(state(account({ verification: undefined }))).toBe('unverified')
    expect(state(account({ cache: receipt(0, { stale: true }) }))).toBe('expired')
    expect(state(account({ cache: receipt(CONNECTION_FRESH_MS) }))).toBe('expired')
    expect(state(account({ cache: receipt(-5) }))).toBe('expired')
    expect(state(account(), { loading: true })).toBe('pending')
    expect(state(account(), { error: '模拟：读取失败' })).toBe('failed')
    expect(state(account({ cleanupBlocked: true }))).toBe('failed')
  })
  it('keeps the other states neutral or red and never green', () => {
    expect(state(account({ state: 'unauthenticated' }))).toBe('failed')
    expect(state(account({ state: 'unavailable' }))).toBe('failed')
    expect(state(account({ state: 'unconfigured' }))).toBe('unconfigured')
    expect(state(account({ state: 'configured' }))).toBe('unverified')
    expect(state(account({ state: 'unknown' }))).toBe('unknown')
    expect(state(undefined)).toBe('failed')
    expect(connectionState(true, undefined, '', NOW)).toBe('pending')
    expect(state(account(), {}, false)).toBe('disabled')
    expect(connectionState(undefined, { loading: false, data: account() }, '', NOW)).toBe('pending')
    expect(connectionState(true, { loading: false, data: account() }, '模拟：设置读取失败', NOW)).toBe('failed')
  })
  it('treats a live answer from a Host without receipts as just read', () => {
    expect(state(account({ cache: undefined }))).toBe('connected')
  })
})

describe('slot needs (simulated)', () => {
  it('asks once for missing slots and re-checks expired receipts, not loading or failed ones', () => {
    expect(slotNeed(undefined, NOW)).toBe('missing')
    expect(slotNeed({ loading: false }, NOW)).toBe('missing')
    expect(slotNeed({ loading: true }, NOW)).toBeUndefined()
    expect(slotNeed({ loading: false, error: '模拟' }, NOW)).toBeUndefined()
    expect(slotNeed({ loading: false, data: { cache: receipt(10) } }, NOW)).toBeUndefined()
    expect(slotNeed({ loading: false, data: { cache: receipt(CONNECTION_FRESH_MS) } }, NOW))
      .toBe(`expired:${NOW - CONNECTION_FRESH_MS}`)
    expect(slotNeed({ loading: false, data: {} }, NOW)).toBeUndefined()
  })
  it('knows actions only from a fresh read or a Host without receipts', () => {
    expect(actionsKnown({ data: account(), handles: true })).toBe(true)
    expect(actionsKnown({ data: account({ cache: undefined }) })).toBe(true)
    expect(actionsKnown({ data: account() })).toBe(false)
    expect(actionsKnown(undefined)).toBe(false)
  })
})

describe('connection receipts ordering (simulated)', () => {
  it('applies the first snapshot and then only changed slots', () => {
    const receipts = new ConnectionReceipts()
    const first = receipts.snapshot(snapshot(3, [entry('codex'), entry('qoder')]))!
    expect(first.map(change => [change.cli, change.revisionChanged, Object.keys(change.parts)])).toEqual([
      ['codex', false, ['account', 'catalog']],
      ['qoder', false, ['account', 'catalog']],
    ])
    const loading = entry('qoder', 0, { catalog: { loading: true } })
    const next = receipts.snapshot(snapshot(4, [entry('codex'), loading]))!
    expect(next).toEqual([{ cli: 'qoder', revisionChanged: false, parts: { catalog: { loading: true } } }])
  })
  it('drops older sequences and malformed entries; a snapshot carries no project', () => {
    const receipts = new ConnectionReceipts()
    receipts.snapshot(snapshot(5, [entry('codex')]))
    expect(receipts.snapshot(snapshot(4, [entry('codex', 0, { catalog: { loading: true } })]))).toBeUndefined()
    expect(receipts.snapshot({ sequence: 'x', entries: [] })).toBeUndefined()
    const mixed = receipts.snapshot(snapshot(7, [
      { ...entry('kimi'), account: { loading: false, value: account({ cli: 'codex' }) } },
      { ...entry('mimo'), cli: 'not-a-cli' },
      entry('pi'),
    ]))!
    expect(mixed.map(change => change.cli)).toEqual(['pi'])
  })
  it('reports a revision change so old values and drafts are dropped, and ignores older revisions', () => {
    const receipts = new ConnectionReceipts()
    receipts.snapshot(snapshot(1, [entry('codex', 2)]))
    const cleared = entry('codex', 3, { account: { loading: true }, catalog: { loading: false } })
    expect(receipts.snapshot(snapshot(2, [cleared]))).toEqual([{
      cli: 'codex', revisionChanged: true, parts: { account: { loading: true }, catalog: { loading: false } },
    }])
    expect(receipts.snapshot(snapshot(3, [entry('codex', 2)]))).toEqual([])
    expect(receipts.revision('codex')).toBe(3)
  })
  it('resyncs on a new stream generation even at a lower sequence (Host restart)', () => {
    const receipts = new ConnectionReceipts()
    receipts.snapshot(snapshot(40, [entry('codex', 4)]), 1)
    expect(receipts.snapshot(snapshot(2, [entry('codex', 4)]), 1)).toBeUndefined()
    const restarted = receipts.snapshot(snapshot(2, [entry('codex', 0)]), 2)!
    expect(restarted).toHaveLength(1)
    expect(restarted[0]!.revisionChanged).toBe(true)
    expect(Object.keys(restarted[0]!.parts)).toEqual(['account', 'catalog'])
  })
  it('drops a status answer taken before a newer snapshot', () => {
    const receipts = new ConnectionReceipts()
    receipts.snapshot(snapshot(1, [entry('codex')]))
    const ticket = receipts.ticket
    const loading = entry('codex', 0, { account: { loading: true } })
    receipts.snapshot(snapshot(2, [entry('qoder')]))
    expect(receipts.status(loading, ticket)).toBeUndefined()
    expect(receipts.status(loading, receipts.ticket)).toEqual({
      cli: 'codex', revisionChanged: false, parts: { account: { loading: true } },
    })
  })
  it('orders direct reads by revision', () => {
    const receipts = new ConnectionReceipts()
    receipts.snapshot(snapshot(1, [entry('codex', 2)]))
    expect(receipts.read('codex', receipt(0, { revision: 1 }))).toBe('drop')
    expect(receipts.read('codex', receipt(0, { revision: 2 }))).toBe('same')
    expect(receipts.read('codex', undefined)).toBe('same')
    expect(receipts.read('codex', receipt(0, { revision: 3 }))).toBe('newer')
    // The snapshot that announces revision 3 later is not a second invalidation.
    expect(receipts.snapshot(snapshot(2, [entry('codex', 3)]))![0]!.revisionChanged).toBe(false)
  })
})

describe('snapshot slots as dialog entries (simulated)', () => {
  it('keeps the receipt, never handles, and the saved preference only when given', () => {
    const value = account({ cache: undefined })
    expect(accountEntryFromPart({ loading: false, value, cache: receipt() })).toEqual({
      loading: false, data: { ...value, cache: receipt() },
    })
    expect(accountEntryFromPart({ loading: true })).toEqual({ loading: true })
    expect(accountEntryFromPart({ loading: false, error: '模拟：失败' })).toEqual({ loading: false, error: '模拟：失败' })
    expect(accountEntryFromPart({ loading: false })).toBeUndefined()
    const models = [{ id: 'm', efforts: ['low' as const] }]
    const preference = { cli: 'codex' as const, model: 'm', effort: 'low' as const }
    expect(catalogEntryFromPart({ loading: true, value: { cli: 'codex', models, notice: '' }, cache: receipt() }, preference))
      .toEqual({ loading: true, data: { cli: 'codex', models, notice: '', preference, cache: receipt() } })
    expect(catalogEntryFromPart({ loading: false, value: { cli: 'codex', models, notice: '' } })!.data!.preference).toBeUndefined()
    expect(catalogEntryFromPart({ loading: false })).toBeUndefined()
  })
})
