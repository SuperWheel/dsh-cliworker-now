import { useEffect, useId, useState } from 'react'
import {
  DisclosureRow,
  DiffBlock,
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  IconThinkOutlineRegular,
  IconFlatListOutlineRegular,
  IconCodeOutlineRegular,
  JsonTree,
  MarkdownText,
  StateDot,
  TerminalBlock,
  TextShimmer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { active, isUserInterrupted, outputSizeLabel, TRUNCATED_PLAIN, TRUNCATED_SIZED, type TimelineItem, type Worker } from '../shared/types.ts'
import { messageClock } from '../shared/telemetry.ts'
import { UsageIndicator } from './telemetry.tsx'
import { useNativePresentation } from './native-presentation.tsx'
import { nativeFileDiffs } from './tool-viewers.ts'
import { t, useT } from './i18n.ts'
import { hostText } from './operation-error.ts'

export const runOf = (item: TimelineItem) => item.admittedRunId ?? item.id.split(':')[0]
export const completedEmptyReply = (item: TimelineItem, worker?: Worker) =>
  item.kind === 'assistant' &&
  !item.text.trim() &&
  (item.state === 'DONE' ||
    !!item.runEndedAt ||
    (!!item.runOutcome && !active(item.runOutcome)) ||
    (worker?.runId === runOf(item) && !active(worker.status)))
const markdownLabels = () => ({ code: { copyLabel: t('复制'), copiedLabel: t('已复制') }, footnotes: t('脚注') })
const jsonLabels = () => ({
  copyValue: t('复制值'),
  copyJson: t('复制 JSON'),
  copyPath: t('复制路径'),
  copyPrettyJson: t('复制格式化 JSON'),
  copyCompactJson: t('复制紧凑 JSON'),
  copied: t('已复制'),
  copyFailed: t('复制失败'),
  collapseNode: t('收起'),
  expandNode: t('展开'),
  copyButtonTitle: (action: string) => action,
})
const terminalLabels = () => ({
  commandLine: (line: number) => t('命令第 {line} 行', { line }),
  signal: (signal: string) => t('信号 {signal}', { signal }),
  exitCode: (code: number) => t('退出码 {code}', { code }),
  noExitCode: t('未提供退出码'),
  running: t('运行中'),
  failed: t('失败'),
  done: t('已完成'),
  copy: t('复制'),
  copied: t('已复制'),
  noOutput: t('没有输出'),
  collapseAria: t('收起输出'),
  collapse: t('收起'),
  expandAria: (n: number) => t('展开 {n} 行输出', { n }),
  expand: (n: number) => t('展开 {n} 行', { n }),
})
export function processClosed(rows: TimelineItem[], worker?: Worker) {
  return (
    !!rows.some((row) => row.runEndedAt || (row.runOutcome && !active(row.runOutcome))) ||
    !worker ||
    worker.runId !== runOf(rows[0]!) ||
    !active(worker.status)
  )
}
export function processAlwaysOpen(rows: TimelineItem[], worker?: Worker) {
  return (
    !processClosed(rows, worker) ||
    rows.filter((row) => row.kind === 'user').length > 1 ||
    rows.some((row) => ['failed', 'interrupted', 'uncertain'].includes(row.runOutcome ?? '')) ||
    (worker?.runId === runOf(rows[0]!) && ['failed', 'interrupted', 'uncertain'].includes(worker.status))
  )
}
const normalStatus = new Set([
  'queued',
  'running',
  'stopping',
  'completed',
  'interrupted',
  '已停止',
  'CLI 已连接',
])
export function processContent(rows: TimelineItem[], worker?: Worker) {
  return rows.filter((row) =>
    row.kind === 'reasoning'
      ? !!row.detail?.trim()
      : row.kind === 'assistant'
        ? completedEmptyReply(row, worker)
        : row.kind === 'tool' ||
          (row.kind === 'diagnostic' && (!normalStatus.has(row.text) || !!row.detail?.trim())),
  )
}

/** Native rc.2 TurnProcessNodeView geometry; only recorded boundaries supply elapsed time. */
export function WorkerProcessHeader({
  rows,
  worker,
  open,
  toggle,
}: {
  rows: TimelineItem[]
  worker?: Worker
  open: boolean
  toggle: () => void
}) {
  useT()
  const policy = useNativePresentation()
  if (!processClosed(rows, worker)) return null
  const first = rows[0]!,
    outcome =
      rows.find((row) => row.runOutcome)?.runOutcome ??
      (worker?.runId === runOf(first) ? worker.status : undefined)
  const stopped =
    outcome === 'interrupted' ||
    (worker?.runId === runOf(first) && isUserInterrupted(worker)) ||
    rows.some((row) => row.text === '已停止')
  const failed = outcome === 'failed' || outcome === 'uncertain'
  const start = Date.parse(rows.find((row) => row.runStartedAt)?.runStartedAt ?? ''),
    end = Date.parse(rows.find((row) => row.runEndedAt)?.runEndedAt ?? '')
  const seconds =
    Number.isFinite(start) && Number.isFinite(end) ? Math.max(1, Math.floor((end - start) / 1000)) : undefined
  const duration =
    seconds === undefined
      ? ''
      : seconds < 60
        ? t('，用时 {seconds}秒', { seconds })
        : t('，用时 {minutes}分 {seconds}秒', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })
  const label = stopped ? t('已停止') : failed ? t('失败') : t('已完成{duration}', { duration })
  const foldable =
    policy.foldCompletedTurns && !processAlwaysOpen(rows, worker) && processContent(rows, worker).length > 0
  return (
    <div className="cwn-progress" data-process-run={runOf(first)}>
      <span className="cwn-sr-only" role="status">
        {stopped ? t('已停止') : failed ? t('失败') : t('已完成')}
      </span>
      <button
        type="button"
        className="cwn-process-control"
        disabled={!foldable}
        aria-expanded={foldable ? open : undefined}
        data-open={open || undefined}
        onClick={(event) => {
          event.currentTarget.focus()
          toggle()
        }}
      >
        <span>{label}</span>
        {foldable && <IconChevronDownOutlineRegular size={14} />}
      </button>
    </div>
  )
}

function rowState(item: TimelineItem) {
  const state = (item.state ?? '').toLowerCase()
  if (['completed', 'done', 'success', 'succeeded'].includes(state))
    return { state: 'done' as const, label: t('已完成'), running: false }
  if (['error', 'failed', 'failure'].includes(state))
    return { state: 'error' as const, label: t('失败'), running: false }
  if (item.runStatus || (item.runEndedAt && ['running', 'pending', 'in_progress', 'started'].includes(state)))
    return { state: 'warning' as const, label: t('未收到最终状态'), running: false }
  if (['stopped', 'interrupted', 'cancelled', 'canceled'].includes(state))
    return { state: 'warning' as const, label: t('已停止'), running: false }
  if (['running', 'pending', 'in_progress', 'started'].includes(state))
    return { state: 'ongoing' as const, label: t('进行中'), running: true }
  return { state: 'idle' as const, label: t('状态未提供'), running: false }
}
function reasoningSummary(text: string, running: boolean) {
  if (!running) return text.split(/\r?\n/, 1)[0]!.replaceAll('**', '')
  let summary = ''
  for (const paragraph of text.split(/\r?\n[\t ]*\r?\n/)) {
    const newline = paragraph.indexOf('\n')
    if (newline >= 0 && paragraph.slice(0, newline).trim()) summary = paragraph.slice(0, newline).trim()
  }
  return summary.replaceAll('**', '')
}
function Reasoning({ item }: { item: TimelineItem }) {
  const [open, setOpen] = useState(false),
    policy = useNativePresentation(),
    observed = rowState(item)
  const text = item.detail ?? '',
    summary = reasoningSummary(text, observed.running)
  return (
    <div
      className="cwn-reasoning-row"
      title={item.text}
      data-state={observed.state}
      data-expanded={open || undefined}
    >
      <DisclosureRow
        icon={<IconThinkOutlineRegular size={14} />}
        title={t('思考')}
        open={open}
        expandable
        expandOnRowClick
        running={observed.running}
        onToggle={() => setOpen(!open)}
        collapsedContent={
          (observed.running || policy.settledReasoningPreview) && summary ? (
            <>
              <span className="cwn-process-separator" />
              <span className="cwn-reasoning-summary">
                <TextShimmer active={observed.running}>{summary}</TextShimmer>
              </span>
            </>
          ) : undefined
        }
      >
        {open && (
          <div className="cwn-reasoning-body">
            <MarkdownText
              text={text}
              streaming={observed.running}
              labels={markdownLabels()}
              variant="compact"
            />
            <Truncated item={item} />
          </div>
        )}
      </DisclosureRow>
    </div>
  )
}
/** Shown content was cut to the display budget; the CLI kept running. */
function Truncated({ item }: { item: TimelineItem }) {
  if (!item.truncated) return null
  return (
    <p className="cwn-process-note" data-truncated>
      {item.outputBytes ? t(TRUNCATED_SIZED, { size: outputSizeLabel(item.outputBytes) }) : t(TRUNCATED_PLAIN)}
    </p>
  )
}
function Value({ value, label }: { value: unknown; label: string }) {
  if (value !== null && typeof value === 'object')
    return <JsonTree data={value as object} label={label} labels={jsonLabels()} expandTopLevel copyable />
  return <pre className="cwn-tool-raw">{typeof value === 'string' ? value : JSON.stringify(value)}</pre>
}
function detailValue(detail: string) {
  try {
    return JSON.parse(detail) as unknown
  } catch {
    return detail
  }
}
/** Validate only explicit identity links. Rendering order never follows a guessed name or timestamp. */
export function toolDepth(item: TimelineItem, rows: TimelineItem[]) {
  const call = item.toolCall
  if (!call?.callId || !call.parentCallId) return { depth: 0, unresolved: false }
  const byId = new Map(
    rows
      .filter((row) => row.kind === 'tool' && row.toolCall?.callId)
      .map((row) => [row.toolCall!.callId!, row]),
  )
  const seen = new Set([call.callId])
  let parent = call.parentCallId,
    depth = 0
  while (parent) {
    if (seen.has(parent) || depth >= 16) return { depth: 0, unresolved: true }
    seen.add(parent)
    const found = byId.get(parent)
    if (!found) return { depth: 0, unresolved: true }
    depth++
    parent = found.toolCall?.parentCallId ?? ''
  }
  return { depth, unresolved: false }
}
function Tool({ item, rows, worker }: { item: TimelineItem; rows: TimelineItem[]; worker?: Worker }) {
  const [open, setOpen] = useState(false),
    call = item.toolCall,
    observed = rowState(item),
    chain = toolDepth(item, rows)
  const hasInput = call?.input !== undefined,
    hasOutput = call?.output !== undefined
  const expandable = hasInput || hasOutput || !!call?.command || !!item.detail || !!item.truncated
  const title = call?.name || hostText(item.text)
  const summary =
    call?.command ??
    (hasInput ? (typeof call!.input === 'string' ? call!.input : JSON.stringify(call!.input)) : '')
  const terminal = typeof call?.command === 'string'
  const diffs = nativeFileDiffs(call)
  return (
    <div
      className={`cwn-process-tool${chain.depth ? ' cwn-tool-child' : ''}`}
      data-tool-call-id={call?.callId}
      data-parent-tool-call-id={call?.parentCallId}
      data-state={observed.state}
      style={chain.depth ? { marginLeft: `${chain.depth * 22}px` } : undefined}
      title={chain.unresolved ? t('父调用未在当前记录内或关系无法核对') : undefined}
    >
      <DisclosureRow
        icon={<StateDot state={observed.state} size={14} />}
        title={title}
        open={open}
        expandable={expandable}
        expandOnRowClick
        previewChevron
        running={observed.running}
        onToggle={() => setOpen(!open)}
        collapsedContent={
          <>
            <span className="cwn-process-separator" />
            <span className="cwn-tool-summary">{summary || observed.label}</span>
          </>
        }
      >
        {open && (
          <div className="cwn-tool-body">
            {terminal ? (
              <TerminalBlock
                command={call.command!}
                cwd={worker?.project}
                output={typeof call.output === 'string' ? call.output : undefined}
                exitCode={call.exitCode}
                running={observed.running}
                runStateDot={false}
                labels={terminalLabels()}
              />
            ) : null}
            {!terminal && hasInput && (
              <section className="cwn-tool-io">
                <span>{t('参数')}</span>
                <Value value={call!.input} label={t('{title} 参数', { title })} />
              </section>
            )}
            {diffs && (
              <section className="cwn-tool-diff">
                <p className="cwn-process-note">{t('CLI 提供的局部补丁，非文件完整内容。')}</p>
                <DiffBlock
                  diffs={diffs}
                  labels={{
                    codeLabel: t('代码'),
                    wrapLabel: t('自动换行'),
                    unwrapLabel: t('保持原列'),
                    copy: t('复制'),
                    copied: t('已复制'),
                    collapseAria: t('收起差异'),
                    collapse: t('收起'),
                    expandAria: (n) => t('展开其余 {n} 行差异', { n }),
                    expand: (n) => t('… 其余 {n} 行', { n }),
                  }}
                />
              </section>
            )}
            {hasOutput && !diffs && (!terminal || typeof call!.output !== 'string') && (
              <section className="cwn-tool-io">
                <span>{t('结果')}</span>
                <Value value={call!.output} label={t('{title} 结果', { title })} />
              </section>
            )}
            {!hasInput && !hasOutput && !terminal && item.detail && (
              <Value value={detailValue(item.detail)} label={t('{title} 详情', { title })} />
            )}
            <Truncated item={item} />
            {chain.unresolved && <p className="cwn-process-note">{t('父调用关系未完整提供；按已有顺序展示。')}</p>}
          </div>
        )}
      </DisclosureRow>
    </div>
  )
}
function ProcessItem({ item, rows, worker }: { item: TimelineItem; rows: TimelineItem[]; worker?: Worker }) {
  const [open, setOpen] = useState(false)
  if (item.kind === 'reasoning') return <Reasoning item={item} />
  if (item.kind === 'tool') return <Tool item={item} rows={rows} worker={worker} />
  if (item.kind === 'assistant')
    return (
      <div className="cwn-process-event" data-empty-reply-id={item.id}>
        {t('无正文回复')} · <UsageIndicator usage={item.usage} providerCredits={item.providerCredits} creditsBased={worker?.preference.cli === 'qoder' || worker?.preference.cli === 'qodercn'} reply />
        {item.durationSeconds !== undefined && t(' · CLI 报告耗时：{seconds}秒', { seconds: item.durationSeconds })} ·{' '}
        <time dateTime={item.time}>{messageClock(item.time)}</time>
        {item.sessionDurationSeconds !== undefined && t(' · CLI 会话累计耗时：{seconds}秒', { seconds: item.sessionDurationSeconds })}
      </div>
    )
  return (
    <DisclosureRow
      icon={<IconCodeOutlineRegular size={14} />}
      title={hostText(item.text)}
      open={open}
      expandable={!!item.detail}
      expandOnRowClick
      onToggle={() => setOpen(!open)}
    >
      {open && item.detail && (
        <div className="cwn-reasoning-body">
          <MarkdownText text={hostText(item.detail)} labels={markdownLabels()} variant="compact" />
        </div>
      )}
    </DisclosureRow>
  )
}

/** One consecutive process span. User/assistant boundaries stay outside it in native order. */
export function WorkerProcessGroup({
  items,
  rows,
  worker,
  hidden,
  first,
}: {
  items: TimelineItem[]
  rows: TimelineItem[]
  worker?: Worker
  hidden: boolean
  first: boolean
}) {
  useT()
  const [open, setOpen] = useState(false),
    policy = useNativePresentation(),
    bodyId = useId()
  const content = processContent(items, worker),
    closed = processClosed(rows, worker)
  const grouped = policy.stepGrouping === 'collapsed' || (policy.stepGrouping === 'history' && closed)
  useEffect(() => {
    if (hidden) setOpen(false)
  }, [hidden])
  if (!content.length) return null
  const tools = content.filter((row) => row.kind === 'tool')
  const latestRunning = content.findLast((row) => rowState(row).running)
  const liveDetail =
    !closed && policy.liveProcessDetail
      ? (latestRunning?.toolCall?.name ??
        latestRunning?.toolCall?.command ??
        (latestRunning?.kind === 'reasoning' ? reasoningSummary(latestRunning.detail ?? '', true) : ''))
      : ''
  const label =
    !closed && latestRunning
      ? latestRunning.kind === 'tool'
        ? t('正在调用工具')
        : t('正在分析请求')
      : tools.length
        ? t('已调用工具')
        : content.some((row) => row.kind === 'reasoning')
          ? t('已完成分析')
          : t('工作记录')
  const title = liveDetail ? `${label} · ${liveDetail}` : label
  const running = content.some((row) => rowState(row).running)
  const show = !hidden && (!grouped || open)
  return (
    <div className="cwn-process-group" hidden={hidden} data-process-group={runOf(items[0]!)}>
      {grouped && (
        <button
          type="button"
          className="cwn-process-group-title"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={(event) => {
            event.currentTarget.focus()
            setOpen(!open)
          }}
        >
          <span className="cwn-process-group-icon">
            <span className="cwn-process-activity">
              {tools.length ? (
                <IconFlatListOutlineRegular size={14} />
              ) : (
                <IconThinkOutlineRegular size={14} />
              )}
            </span>
            <span className="cwn-process-chevron">
              {open ? <IconChevronUpOutlineRegular size={14} /> : <IconChevronDownOutlineRegular size={14} />}
            </span>
          </span>
          <TextShimmer active={running}>{title}</TextShimmer>
        </button>
      )}
      <div id={bodyId} className="cwn-process-group-body" hidden={!show}>
        {show && (
          <>
            {first && !rows.some((row) => row.kind === 'reasoning' && row.detail?.trim()) && (
              <p className="cwn-process-note">{t('CLI 未提供公开思考摘要。')}</p>
            )}
            {content.map((item) => (
              <ProcessItem key={item.id} item={item} rows={rows} worker={worker} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
