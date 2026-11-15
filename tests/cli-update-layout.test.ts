import { afterEach, expect, it } from 'vitest'
import {
  advanceLayout,
  captureScrollAnchor,
  initialLayout,
  navIndicator,
  regroupAnnouncement,
  restoreScrollAnchor,
  type CliUpdateLayout,
} from '../src/client/cli-update-layout.ts'
import { setLanguagePreference } from '../src/client/i18n.ts'
import type { CliUpdateEntry, CliUpdateGroup, CliUpdateOperation, CliUpdateSnapshot } from '../src/shared/cli-management.ts'
import { CLI_IDS, type ActiveCliId } from '../src/shared/types.ts'

// Simulated Host snapshots only; no CLI is probed and no release source is queried.

type Row = Partial<CliUpdateEntry> & { group: CliUpdateGroup }
let revision = 0
function snapshot(
  rows: Partial<Record<ActiveCliId, Row>>,
  extra: Partial<Omit<CliUpdateSnapshot, 'entries' | 'revision'>> = {},
): CliUpdateSnapshot {
  revision += 1
  const entries = (Object.entries(rows) as [ActiveCliId, Row][]).map(([cli, row]) => ({ cli, installed: true, ...row }))
  return { revision, activity: 'idle', queue: [], results: [], ...extra, entries }
}
/** Every CLI with the same row, overridden per CLI. */
function all(row: Row, overrides: Partial<Record<ActiveCliId, Row>> = {}) {
  return Object.fromEntries(CLI_IDS.map((cli) => [cli, overrides[cli] ?? row])) as Record<ActiveCliId, Row>
}
const none = new Set<ActiveCliId>()
const nonEmpty = (layout: CliUpdateLayout) =>
  Object.fromEntries(Object.entries(layout.groups).filter(([, clis]) => clis.length > 0))
const operation = (cli: ActiveCliId, phase: CliUpdateOperation['phase']): CliUpdateOperation => ({
  id: `op-${cli}`,
  intent: 'update',
  cli,
  phase,
  startedAt: 1,
  outputTail: '',
})

afterEach(() => setLanguagePreference('follow'))

it('首次无缓存：读完本地版本重排一次，查完最新版本再重排一次，之后不再移动', () => {
  const checkingLocal = { group: 'checking', stage: 'local' } as const
  let layout = initialLayout(snapshot(all(checkingLocal), { activity: 'checking' }))
  expect(nonEmpty(layout)).toEqual({ checking: [...CLI_IDS] })
  expect(layout.regroups).toBe(0)

  // Some local reads done: the Host already knows Kimi is not installed, but the row stays put.
  layout = advanceLayout(layout, snapshot(all(checkingLocal, { kimi: { group: 'notInstalled', installed: false } }), { activity: 'checking' }), none)
  expect(nonEmpty(layout)).toEqual({ checking: [...CLI_IDS] })
  expect(layout.regroups).toBe(0)

  // Step 1 done: not installed and unreadable rows leave 「检查中」 together.
  const remote = { group: 'checking', stage: 'remote' } as const
  const step1 = all(remote, {
    kimi: { group: 'notInstalled', installed: false },
    hermes: { group: 'failed', reason: 'UNKNOWN_VERSION' },
  })
  layout = advanceLayout(layout, snapshot(step1, { activity: 'checking' }), none)
  expect(layout.regroups).toBe(1)
  expect(layout.groups.notInstalled).toEqual(['kimi'])
  expect(layout.groups.failed).toEqual(['hermes'])
  expect(layout.groups.checking).toHaveLength(15)

  // Step 2 results are written in place: Codex is updatable but stays in 「检查中」.
  layout = advanceLayout(layout, snapshot({ ...step1, codex: { group: 'updatable' }, opencode: { group: 'failed', reason: 'RELEASE_UNREACHABLE' } }, { activity: 'checking' }), none)
  expect(layout.regroups).toBe(1)
  expect(layout.groups.checking).toContain('codex')
  expect(layout.groups.checking).toContain('opencode')

  // Last release read: second regroup, 「检查中」 disappears.
  const done = all({ group: 'latest' }, {
    kimi: { group: 'notInstalled', installed: false },
    hermes: { group: 'failed', reason: 'UNKNOWN_VERSION' },
    codex: { group: 'updatable' },
    opencode: { group: 'failed', reason: 'RELEASE_UNREACHABLE' },
    zcode: { group: 'manual', reason: 'APP_MANAGED' },
  })
  layout = advanceLayout(layout, snapshot(done, { activity: 'checking' }), none)
  expect(layout.regroups).toBe(2)
  expect(layout.groups.checking).toEqual([])
  expect(layout.groups.updatable).toEqual(['codex'])
  expect(layout.groups.manual).toEqual(['zcode'])
  // Section order inside follows CLI_IDS, not result order.
  expect(layout.groups.failed).toEqual(['hermes', 'opencode'])

  // The Host then turns idle: no third regroup in the same round.
  layout = advanceLayout(layout, snapshot(done), none)
  expect(layout.regroups).toBe(2)
  expect(layout.groups.updatable).toEqual(['codex'])
})

it('首次两步若在同一快照间完成，只重排一次', () => {
  let layout = initialLayout(snapshot(all({ group: 'checking', stage: 'local' }), { activity: 'checking' }))
  layout = advanceLayout(layout, snapshot(all({ group: 'latest' }), { activity: 'checking' }), none)
  expect(layout.regroups).toBe(1)
  expect(layout.groups.latest).toHaveLength(17)
})

it('全部有缓存：直接按缓存分区显示，零重排，后续空闲快照不移动行', () => {
  const cached = all({ group: 'latest' }, { codex: { group: 'updatable' }, kimi: { group: 'notInstalled', installed: false } })
  let layout = initialLayout(snapshot(cached))
  expect(layout.regroups).toBe(0)
  expect(layout.groups.checking).toEqual([])
  expect(layout.groups.updatable).toEqual(['codex'])
  expect(layout.groups.notInstalled).toEqual(['kimi'])
  const before = layout.groups
  layout = advanceLayout(layout, snapshot(cached), none)
  expect(layout.regroups).toBe(0)
  expect(layout.groups).toEqual(before)
})

it('部分缺缓存：只有缺的行进「检查中」，两步读完后只重排一次', () => {
  const cached = all({ group: 'latest' }, { codex: { group: 'updatable' } })
  let layout = initialLayout(snapshot({ ...cached, kimi: { group: 'checking', stage: 'local' } }, { activity: 'checking' }))
  expect(layout.groups.checking).toEqual(['kimi'])
  expect(layout.groups.updatable).toEqual(['codex'])

  // Local read of Kimi done, release source pending: no regroup with cached rows on screen.
  layout = advanceLayout(layout, snapshot({ ...cached, kimi: { group: 'checking', stage: 'remote' } }, { activity: 'checking' }), none)
  expect(layout.regroups).toBe(0)
  expect(layout.groups.checking).toEqual(['kimi'])

  layout = advanceLayout(layout, snapshot({ ...cached, kimi: { group: 'updatable' } }, { activity: 'checking' }), none)
  expect(layout.regroups).toBe(1)
  expect(layout.groups.checking).toEqual([])
  expect(layout.groups.updatable).toEqual(['codex', 'kimi'])

  layout = advanceLayout(layout, snapshot({ ...cached, kimi: { group: 'updatable' } }), none)
  expect(layout.regroups).toBe(1)
})

it('「检查更新」重查：行原地写结果，查完统一重排一次；新一轮重新计数', () => {
  const cached = all({ group: 'latest' })
  let layout = initialLayout(snapshot(cached))
  // Every row re-reads in place.
  layout = advanceLayout(layout, snapshot(all({ group: 'latest', stage: 'remote' }), { activity: 'checking' }), none)
  expect(layout.regroups).toBe(0)
  layout = advanceLayout(layout, snapshot(all({ group: 'latest', stage: 'remote' }, { codex: { group: 'updatable' } }), { activity: 'checking' }), none)
  expect(layout.groups.latest).toContain('codex')
  layout = advanceLayout(layout, snapshot(all({ group: 'latest' }, { codex: { group: 'updatable' } }), { activity: 'checking' }), none)
  expect(layout.regroups).toBe(1)
  expect(layout.groups.updatable).toEqual(['codex'])
  layout = advanceLayout(layout, snapshot(all({ group: 'latest' }, { codex: { group: 'updatable' } })), none)

  // A second check starts a new round with its own count.
  layout = advanceLayout(layout, snapshot(all({ group: 'latest', stage: 'local' }, { codex: { group: 'updatable', stage: 'local' } }), { activity: 'checking' }), none)
  expect(layout.regroups).toBe(0)
  layout = advanceLayout(layout, snapshot(all({ group: 'latest' }), { activity: 'checking' }), none)
  expect(layout.regroups).toBe(1)
  expect(layout.groups.updatable).toEqual([])
})

it('没有标阶段的检查在 Host 空闲时归类一次', () => {
  let layout = initialLayout(snapshot(all({ group: 'latest' })))
  layout = advanceLayout(layout, snapshot(all({ group: 'latest' }, { pi: { group: 'updatable' } }), { activity: 'preloading' }), none)
  expect(layout.groups.updatable).toEqual([])
  layout = advanceLayout(layout, snapshot(all({ group: 'latest' }, { pi: { group: 'updatable' } })), none)
  expect(layout.regroups).toBe(1)
  expect(layout.groups.updatable).toEqual(['pi'])
})

it('展开的行在重排点不动，收起后到下一次重排点才归类', () => {
  const remote = { group: 'latest', stage: 'remote' } as const
  let layout = initialLayout(snapshot(all({ group: 'latest' }, { zcode: { group: 'updatable' } })))
  expect(layout.groups.updatable).toEqual(['zcode'])
  layout = advanceLayout(layout, snapshot(all(remote, { zcode: { group: 'updatable', stage: 'remote' } }), { activity: 'checking' }), none)

  const result = all({ group: 'latest' }, { zcode: { group: 'manual', reason: 'APP_MANAGED' }, codex: { group: 'updatable' } })
  const expanded = new Set<ActiveCliId>(['zcode'])
  layout = advanceLayout(layout, snapshot(result, { activity: 'checking' }), expanded)
  expect(layout.regroups).toBe(1)
  expect(layout.groups.updatable).toEqual(['codex', 'zcode'])
  expect(layout.groups.manual).toEqual([])

  // Still within the round: collapsing alone does not move the row.
  layout = advanceLayout(layout, snapshot(result, { activity: 'checking' }), none)
  expect(layout.groups.updatable).toEqual(['codex', 'zcode'])
  // The next snapshot after the round ends is the next regroup point.
  layout = advanceLayout(layout, snapshot(result), none)
  expect(layout.groups.updatable).toEqual(['codex', 'zcode'])
  layout = advanceLayout(layout, snapshot(result), none)
  expect(layout.groups.manual).toEqual(['zcode'])
  expect(layout.groups.updatable).toEqual(['codex'])
})

it('正在更新、排队中和刚有结果的行在空闲归类时不动，结果在下次检查时归类', () => {
  const before = all({ group: 'latest' }, { codex: { group: 'updatable' }, claude: { group: 'updatable' }, pi: { group: 'updatable' } })
  let layout = initialLayout(snapshot(before))
  const after = all({ group: 'latest' }, { claude: { group: 'updatable' }, pi: { group: 'updatable' } })
  // Codex just finished (result kept), Claude is running, Pi is queued; the Host already regrouped all three.
  const running = snapshot(
    { ...after, claude: { group: 'latest' }, pi: { group: 'latest' } },
    { operation: operation('claude', 'installing'), queue: ['pi'], results: [operation('codex', 'succeeded')] },
  )
  layout = advanceLayout(layout, running, none)
  expect(layout.groups.updatable).toEqual(['codex', 'claude', 'pi'])

  // A new check round regroups the finished row even though its result is still listed.
  layout = advanceLayout(layout, snapshot(all({ group: 'latest', stage: 'remote' }), { activity: 'checking', results: [operation('codex', 'succeeded')] }), none)
  layout = advanceLayout(layout, snapshot(all({ group: 'latest' }), { activity: 'checking', results: [operation('codex', 'succeeded')] }), none)
  expect(layout.groups.updatable).toEqual([])
})

it('新出现的 CLI 放进它的分区；从快照消失的行（含 pinned）被移除', () => {
  const rows = all({ group: 'latest' })
  const { workbuddy: _wb, ...withoutWorkbuddy } = rows
  let layout = initialLayout(snapshot(withoutWorkbuddy, { activity: 'checking' }))
  expect(Object.values(layout.groups).flat()).not.toContain('workbuddy')
  // Mid-round, frozen otherwise: the new row still appears in its own section.
  layout = advanceLayout(layout, snapshot({ ...withoutWorkbuddy, workbuddy: { group: 'notInstalled', installed: false }, pi: { group: 'updatable' } }, { activity: 'checking' }), none)
  expect(layout.groups.notInstalled).toEqual(['workbuddy'])
  expect(layout.groups.updatable).toEqual([])

  const { pi: _pi, ...withoutPi } = rows
  layout = advanceLayout(layout, snapshot(withoutPi, { activity: 'checking' }), new Set<ActiveCliId>(['pi']))
  expect(Object.values(layout.groups).flat()).not.toContain('pi')
})

it('空闲时新快照直接归类（例如操作结束后的快照）', () => {
  let layout = initialLayout(snapshot(all({ group: 'latest' }, { kimi: { group: 'notInstalled', installed: false } })))
  layout = advanceLayout(layout, snapshot(all({ group: 'latest' })), none)
  expect(layout.groups.notInstalled).toEqual([])
  expect(layout.groups.latest).toHaveLength(17)
  expect(layout.regroups).toBe(0)
})

it('导航指示：操作或队列 → 转圈；可更新数 → 数量；否则无', () => {
  expect(navIndicator(undefined)).toBeUndefined()
  const cached = all({ group: 'latest' }, { codex: { group: 'updatable' }, pi: { group: 'updatable' } })
  expect(navIndicator(snapshot(cached, { operation: operation('codex', 'downloading') }))).toEqual({ kind: 'spinner' })
  expect(navIndicator(snapshot(cached, { queue: ['pi'] }))).toEqual({ kind: 'spinner' })
  // A finished operation no longer counts as running.
  expect(navIndicator(snapshot(cached, { operation: operation('codex', 'succeeded') }))).toEqual({ kind: 'count', count: 2 })
  expect(navIndicator(snapshot(cached))).toEqual({ kind: 'count', count: 2 })
  expect(navIndicator(snapshot(all({ group: 'latest' })))).toBeUndefined()

  // Recheck after a finished check: cached count stays; only a check with no usable result spins.
  expect(navIndicator(snapshot(cached, { activity: 'checking', checkedAt: 1 }))).toEqual({ kind: 'count', count: 2 })
  expect(navIndicator(snapshot(all({ group: 'latest' }), { activity: 'checking', checkedAt: 1 }))).toBeUndefined()
  // First check ever: spins even once some rows already have a result.
  expect(navIndicator(snapshot(cached, { activity: 'checking' }))).toEqual({ kind: 'spinner' })
  expect(navIndicator(snapshot(all({ group: 'checking', stage: 'local' }), { activity: 'checking' }))).toEqual({ kind: 'spinner' })
  expect(
    navIndicator(snapshot(all({ group: 'checking', stage: 'remote' }, { kimi: { group: 'notInstalled', installed: false } }), { activity: 'checking' })),
  ).toEqual({ kind: 'spinner' })
  // Background preloading never spins.
  expect(navIndicator(snapshot(all({ group: 'checking', stage: 'local' }), { activity: 'preloading' }))).toBeUndefined()
})

/** Minimal DOM stand-in: rows laid out at fixed heights inside a scrolled container. */
function fakeContainer(rows: { cli: string; top: number; height: number }[], viewTop = 100, viewHeight = 300) {
  const elements = rows.map((row) => ({
    row,
    getAttribute: (name: string) => (name === 'data-cli' ? row.cli : null),
    // Content positions move up as the container scrolls.
    getBoundingClientRect: () => {
      const top = row.height > 0 ? viewTop + row.top - container.scrollTop : 0
      return { top, bottom: top + row.height, height: row.height }
    },
  }))
  const container = {
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: viewTop, bottom: viewTop + viewHeight, height: viewHeight }),
    querySelectorAll: (selector: string) => (selector === '[data-cli]' ? elements : []),
    rows,
  }
  return container
}

it('滚动锚点：记下视口内第一行的偏移，重排后把同一行放回原处', () => {
  const box = fakeContainer([
    { cli: 'antigravity', top: 0, height: 70 },
    { cli: 'codex', top: 70, height: 70 },
    { cli: 'kimi', top: 140, height: 70 },
    { cli: 'pi', top: 210, height: 70 },
  ])
  box.scrollTop = 100
  const anchor = captureScrollAnchor(box as unknown as HTMLElement)
  // Antigravity ends at 70 < 100: Codex is the first visible row, 30px above the top edge.
  expect(anchor).toEqual({ cli: 'codex', offset: -30 })

  // Regroup moved Codex 140px further down.
  box.rows[1]!.top = 210
  box.rows[3]!.top = 70
  restoreScrollAnchor(box as unknown as HTMLElement, anchor)
  expect(box.scrollTop).toBe(240)
  expect(captureScrollAnchor(box as unknown as HTMLElement)).toEqual({ cli: 'codex', offset: -30 })
})

it('滚动锚点：跳过隐藏行，找不到或已隐藏时不动', () => {
  const box = fakeContainer([
    { cli: 'antigravity', top: 0, height: 0 },
    { cli: 'not-a-cli', top: 0, height: 70 },
    { cli: 'codex', top: 70, height: 70 },
  ])
  expect(captureScrollAnchor(box as unknown as HTMLElement)).toEqual({ cli: 'codex', offset: 70 })
  box.scrollTop = 50
  restoreScrollAnchor(box as unknown as HTMLElement, { cli: 'kimi', offset: 0 })
  expect(box.scrollTop).toBe(50)
  restoreScrollAnchor(box as unknown as HTMLElement, { cli: 'antigravity', offset: 0 })
  expect(box.scrollTop).toBe(50)
  restoreScrollAnchor(box as unknown as HTMLElement, undefined)
  expect(box.scrollTop).toBe(50)
  expect(captureScrollAnchor(fakeContainer([]) as unknown as HTMLElement)).toBeUndefined()
})

it('重排播报：中英文各一句，不逐行播报', () => {
  const groups = (layout: Partial<Record<CliUpdateGroup, ActiveCliId[]>>) => ({
    ...initialLayout(snapshot({})).groups,
    ...layout,
  })
  const finished = groups({ updatable: ['codex', 'kimi', 'pi'], failed: ['opencode'], latest: ['claude'] })
  expect(regroupAnnouncement(finished)).toBe('检查完成：3 个可更新，1 个检查失败')
  expect(regroupAnnouncement(groups({ latest: ['claude'], notInstalled: ['kimi'] }))).toBe('检查完成：没有可更新的 CLI')
  expect(regroupAnnouncement(groups({ checking: ['codex', 'claude'], notInstalled: ['kimi'], failed: ['hermes'] }))).toBe(
    '已读取当前版本：1 个未安装，1 个检查失败，2 个正在查询最新版本',
  )
  setLanguagePreference('en')
  expect(regroupAnnouncement(finished)).toBe('Check finished: 3 can be updated, 1 failed to check')
  expect(regroupAnnouncement(groups({ manual: ['zcode'] }))).toBe('Check finished: 1 need a manual update')
})

// 模拟：只检查页面 CSS 规则文本，不渲染任何真实 CLI 行。
// DSH Desktop 0.2.2-rc.3 的最小窗口宽 520px：设置弹窗 min(800px,90vw)=468px，Modal 正文左右各 24px 余 420px，
// ≤640px 时导航列 clamp(112px,30vw,184px)=156px、列间距 16px，更新页只剩约 248px。
it('keeps narrow update rows readable: buttons and the channel tag move before the status text gets thinner than 10 characters', async () => {
  const { cliUpdateStyles: css } = await import('../src/client/cli-update-styles.ts')
  const rule = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:^|\\n|\\})${escaped}\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
  }
  // 10 characters at the 12px description size.
  expect(rule('.cwn-update-page')).toContain('--cwn-update-text-min:120px')
  // The row wraps: the main column claims icon + text minimum before the buttons get a place beside it.
  expect(rule('.cwn-update-row')).toContain('flex-wrap:wrap')
  expect(rule('.cwn-update-row')).toContain('row-gap:8px')
  expect(rule('.cwn-update-row-main')).toContain('flex:1 1 calc(44px + var(--cwn-update-text-min))')
  // Buttons that wrapped stay at the right edge.
  expect(rule('.cwn-update-actions')).toContain('margin-left:auto')
  expect(rule('.cwn-update-actions')).toContain('flex-shrink:0')
  // The tag flows inline after the text (one 18px line box) instead of squeezing it as a flex sibling.
  const chan = rule('.cwn-update-chan')
  expect(chan).toContain('display:inline-flex')
  expect(chan).toContain('vertical-align:top')
  expect(chan).toContain('margin:-1px 0 -1px 6px')
  expect(chan).toContain('white-space:nowrap')
  expect(chan).not.toContain('flex-shrink')
  // Progress line: the description keeps at least the same minimum; the resume count moves under it, right-aligned.
  expect(rule('.cwn-update-progress-meta')).toContain('flex-wrap:wrap')
  expect(rule('.cwn-update-meta-main')).toContain('flex:1 1 var(--cwn-update-text-min)')
  expect(rule('.cwn-update-meta-main')).toContain('white-space:nowrap')
  expect(rule('.cwn-update-meta-side')).toContain('margin-left:auto')
  // The ≤640px block narrows only the column gap; the 8px row gap stays.
  const narrow = /@media\(max-width:640px\)\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
  expect(narrow).toContain('.cwn-update-row{column-gap:12px}')
  expect(narrow).not.toMatch(/\.cwn-update-row\{gap:/)
})
