import {
  CLI_OPERATION_TERMINAL,
  CLI_UPDATE_GROUPS,
  type CliUpdateEntry,
  type CliUpdateGroup,
  type CliUpdateSnapshot,
} from '../shared/cli-management.ts'
import { CLI_IDS, type ActiveCliId } from '../shared/types.ts'
import { t, uiLanguage } from './i18n.ts'

/**
 * Section layout of the "Update CLI" page (PRD 5.2.1, spec "加载与重排").
 *
 * The Host reports where every row belongs (`entry.group`); the page decides
 * when rows may move. Displayed positions are frozen between regroup points so
 * results are first written in place, and sections are re-sorted at most twice
 * per check round:
 * - cold start (no cached row at all): once when every local read is done,
 *   once when the last release-source read is done;
 * - partial cache, 6-hour recheck or 「检查更新」: once when the last read is done.
 * Between rounds (no row is being read and the Host is idle) each new snapshot
 * is classified directly.
 *
 * Pure functions; the only side effect is `t()`／`uiLanguage()` reading the active language.
 */

export interface CliUpdateLayout {
  /** 当前显示的分区与每区内顺序（按 CLI_IDS 顺序）。 */
  groups: Record<CliUpdateGroup, ActiveCliId[]>
  /** 本轮检查已做的重排次数（0～2），供测试与调试。 */
  regroups: number
  /** 内部记账：上一次快照里各阶段行数、activity。 */
  memo: { local: number; remote: number; activity: CliUpdateSnapshot['activity'] }
}

const MAX_REGROUPS = 2

function emptyGroups(): Record<CliUpdateGroup, ActiveCliId[]> {
  return Object.fromEntries(CLI_UPDATE_GROUPS.map((group) => [group, []])) as unknown as Record<CliUpdateGroup, ActiveCliId[]>
}

function stageCounts(snapshot: CliUpdateSnapshot): CliUpdateLayout['memo'] {
  let local = 0
  let remote = 0
  for (const entry of snapshot.entries) {
    if (entry.stage === 'local') local += 1
    else if (entry.stage === 'remote') remote += 1
  }
  return { local, remote, activity: snapshot.activity }
}

function entriesById(snapshot: CliUpdateSnapshot): Map<ActiveCliId, CliUpdateEntry> {
  const byId = new Map<ActiveCliId, CliUpdateEntry>()
  for (const entry of snapshot.entries) {
    if (!byId.has(entry.cli) && (CLI_UPDATE_GROUPS as readonly string[]).includes(entry.group)) byId.set(entry.cli, entry)
  }
  return byId
}

function displayedGroups(layout: CliUpdateLayout): Map<ActiveCliId, CliUpdateGroup> {
  const where = new Map<ActiveCliId, CliUpdateGroup>()
  for (const group of CLI_UPDATE_GROUPS) for (const cli of layout.groups[group]) where.set(cli, group)
  return where
}

/** Place every row of `snapshot`; `place` returns the section for a row already on screen. */
function arrange(
  snapshot: CliUpdateSnapshot,
  shown: Map<ActiveCliId, CliUpdateGroup>,
  place: (cli: ActiveCliId, displayed: CliUpdateGroup, entry: CliUpdateEntry) => CliUpdateGroup,
): Record<CliUpdateGroup, ActiveCliId[]> {
  const groups = emptyGroups()
  const byId = entriesById(snapshot)
  for (const cli of CLI_IDS) {
    const entry = byId.get(cli)
    // Rows missing from the snapshot (pinned or not) are removed.
    if (!entry) continue
    const displayed = shown.get(cli)
    // A CLI never shown before goes straight to the section the Host reports.
    groups[displayed === undefined ? entry.group : place(cli, displayed, entry)].push(cli)
  }
  return groups
}

/** 首次打开：直接按 Host 给出的分区显示（缓存直显；缺缓存的行已由 Host 标为 checking）。 */
export function initialLayout(snapshot: CliUpdateSnapshot): CliUpdateLayout {
  return { groups: arrange(snapshot, new Map(), (_cli, displayed) => displayed), regroups: 0, memo: stageCounts(snapshot) }
}

/**
 * Rows that keep their place at a regroup point besides the caller's `pinned`
 * set: the running operation and the "update all" queue. Between rounds the
 * rows with a finished result stay too (PRD 5.7 第 4 条: the result stays in
 * its row until the page is reopened or the next check).
 */
function heldRows(snapshot: CliUpdateSnapshot, pinned: ReadonlySet<ActiveCliId>, betweenRounds: boolean): Set<ActiveCliId> {
  const held = new Set<ActiveCliId>(pinned)
  const operation = snapshot.operation
  if (operation && !CLI_OPERATION_TERMINAL.includes(operation.phase)) held.add(operation.cli)
  for (const cli of snapshot.queue) held.add(cli)
  if (betweenRounds) for (const result of snapshot.results) held.add(result.cli)
  return held
}

/**
 * pinned = 展开着的行和正在操作的行；它们保持当前显示位置，到下一次重排点才归类。
 *
 * Call once per new snapshot. A change of `pinned` alone is not a regroup
 * point: a row that is collapsed again moves at the next regroup point.
 */
export function advanceLayout(prev: CliUpdateLayout, snapshot: CliUpdateSnapshot, pinned: ReadonlySet<ActiveCliId>): CliUpdateLayout {
  const memo = stageCounts(snapshot)
  const before = prev.memo
  const stagedBefore = before.local + before.remote
  const staged = memo.local + memo.remote
  const busyBefore = stagedBefore > 0 || before.activity !== 'idle'
  const busy = staged > 0 || memo.activity !== 'idle'
  const shown = displayedGroups(prev)

  // A round runs from the first snapshot with a row being read or a non-idle
  // Host to the snapshot where both are gone.
  let regroups = busyBefore ? prev.regroups : busy ? 0 : prev.regroups
  let regroup = false
  if (!busyBefore && !busy) {
    // Between rounds (preload long finished, an operation ended): classify directly.
    regroup = true
  } else if (regroups === 0 && before.local > 0 && memo.local === 0 && memo.remote > 0 && coldStart(prev)) {
    // First regroup of a cold start: local reads finished, release sources still pending.
    regroup = true
    regroups += 1
  } else if (regroups < MAX_REGROUPS && stagedBefore > 0 && staged === 0) {
    // Last row read: the round's closing regroup.
    regroup = true
    regroups += 1
  } else if (regroups === 0 && before.activity !== 'idle' && memo.activity === 'idle' && staged === 0) {
    // A check or preload that ended without marking rows still closes the round once.
    regroup = true
    regroups += 1
  }

  if (!regroup) {
    return { groups: arrange(snapshot, shown, (_cli, displayed) => displayed), regroups, memo }
  }
  const held = heldRows(snapshot, pinned, !busyBefore && !busy)
  const groups = arrange(snapshot, shown, (cli, displayed, entry) => (held.has(cli) ? displayed : entry.group))
  return { groups, regroups, memo }
}

/**
 * Cold start = nothing usable was on screen: every displayed row sits in
 * 「检查中」. With partial cache or a recheck other rows already show results,
 * and the page re-sorts only once when every read is done.
 */
function coldStart(layout: CliUpdateLayout): boolean {
  return CLI_UPDATE_GROUPS.every((group) => group === 'checking' || layout.groups[group].length === 0) && layout.groups.checking.length > 0
}

/**
 * 导航指示：有操作或队列进行中 → 转圈；否则可更新数 > 0 → 数量；否则无。
 *
 * - PRD 5.1 第 3 条: an update or install in progress replaces the badge with a
 *   spinner. A finished operation (terminal phase) no longer counts as running.
 * - PRD 5.1 第 2 条: the count comes from the cached snapshot, so a foreground
 *   check with cached results keeps showing the cached count. Only while a
 *   foreground check runs with no usable release result at all (cold start:
 *   nothing in 可更新／需要手动更新／已是最新) does the badge show a spinner
 *   (PRD 5.2.1 第 1 条). Background preloading never shows a spinner.
 * - A count of 0 shows nothing.
 */
export function navIndicator(
  snapshot: CliUpdateSnapshot | undefined,
): { kind: 'spinner' } | { kind: 'count'; count: number } | undefined {
  if (!snapshot) return undefined
  const operation = snapshot.operation
  if ((operation && !CLI_OPERATION_TERMINAL.includes(operation.phase)) || snapshot.queue.length > 0) return { kind: 'spinner' }
  let count = 0
  let usable = false
  for (const entry of snapshot.entries) {
    if (entry.group === 'updatable') count += 1
    if (entry.group === 'updatable' || entry.group === 'manual' || entry.group === 'latest') usable = true
  }
  if (count > 0) return { kind: 'count', count }
  if (snapshot.activity === 'checking' && !usable) return { kind: 'spinner' }
  return undefined
}

export interface ScrollAnchor {
  cli: ActiveCliId
  offset: number
}

const isCliId = (value: string | null): value is ActiveCliId => value !== null && (CLI_IDS as readonly string[]).includes(value)

function rowElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-cli]'))
}

/** 行元素带 data-cli 属性；取视口内第一行与容器顶部的距离。 */
export function captureScrollAnchor(container: HTMLElement): ScrollAnchor | undefined {
  const view = container.getBoundingClientRect()
  for (const element of rowElements(container)) {
    const cli = element.getAttribute('data-cli')
    if (!isCliId(cli)) continue
    const box = element.getBoundingClientRect()
    // Hidden rows (collapsed section) have no box; partially visible rows count.
    if (box.height <= 0) continue
    if (box.bottom > view.top && box.top < view.bottom) return { cli, offset: box.top - view.top }
  }
  return undefined
}

/** Put the anchored row back at the same distance from the container top; leaves the scroll alone when it is gone or hidden. */
export function restoreScrollAnchor(container: HTMLElement, anchor: ScrollAnchor | undefined): void {
  if (!anchor) return
  const element = rowElements(container).find((candidate) => candidate.getAttribute('data-cli') === anchor.cli)
  if (!element) return
  const box = element.getBoundingClientRect()
  if (box.height <= 0) return
  const delta = box.top - container.getBoundingClientRect().top - anchor.offset
  if (delta !== 0) container.scrollTop += delta
}

/** 重排后播报的一句话，如「检查完成：3 个可更新，1 个检查失败」。 */
export function regroupAnnouncement(groups: CliUpdateLayout['groups']): string {
  // Dictionary keys must carry Chinese text, so the list separator follows the effective language instead.
  const separator = uiLanguage() === 'en' ? ', ' : '，'
  if (groups.checking.length > 0) {
    // First regroup of a cold start: local versions read, release sources pending.
    const parts: string[] = []
    if (groups.notInstalled.length > 0) parts.push(t('{count} 个未安装', { count: groups.notInstalled.length }))
    if (groups.failed.length > 0) parts.push(t('{count} 个检查失败', { count: groups.failed.length }))
    parts.push(t('{count} 个正在查询最新版本', { count: groups.checking.length }))
    return t('已读取当前版本：{parts}', { parts: parts.join(separator) })
  }
  const parts: string[] = []
  if (groups.updatable.length > 0) parts.push(t('{count} 个可更新', { count: groups.updatable.length }))
  if (groups.manual.length > 0) parts.push(t('{count} 个需要手动更新', { count: groups.manual.length }))
  if (groups.failed.length > 0) parts.push(t('{count} 个检查失败', { count: groups.failed.length }))
  if (parts.length === 0) return t('检查完成：没有可更新的 CLI')
  return t('检查完成：{parts}', { parts: parts.join(separator) })
}
