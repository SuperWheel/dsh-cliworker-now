import { Fragment, useState, type ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { CLI_LABELS, cliOf, active, type TimelineItem, type Worker } from '../shared/types.ts'
import { creditBilledCli, messageClock } from '../shared/telemetry.ts'
import { UsageIndicator } from './telemetry.tsx'
import { CopyText } from './copy-text.tsx'
import {
  WorkerProcessGroup,
  WorkerProcessHeader,
  runOf,
  completedEmptyReply,
  processAlwaysOpen,
  processContent,
} from './worker-process.tsx'
import { useNativePresentation } from './native-presentation.tsx'
import { formatLocale, t, useT } from './i18n.ts'
import { hostText } from './operation-error.ts'
const markdownLabels = () => ({ code: { copyLabel: t('复制'), copiedLabel: t('已复制') }, footnotes: t('脚注') })
export function ConversationTimeline({
  items,
  latestItems = items,
  worker,
  messageFeedback,
}: {
  items: TimelineItem[]
  latestItems?: TimelineItem[]
  worker?: Worker
  messageFeedback?: Record<string, ReactNode>
}) {
  const t = useT()
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({})
  const policy = useNativePresentation()
  // Match rc.2 UserMessageNodeView / TurnTailNodeView. A newer user turn
  // hides the preceding assistant tail; a history page is never the live end.
  const latestUser = latestItems.findLast((item) => item.kind === 'user')?.id
  const lastContent = latestItems.findLast(
    (item) => ['user', 'assistant', 'tool'].includes(item.kind) && !completedEmptyReply(item, worker),
  )
  const latestReply =
    lastContent?.kind === 'assistant' &&
    lastContent.text.trim() &&
    !(worker && active(worker.status) && worker.runId === runOf(lastContent))
      ? lastContent.id
      : undefined
  const runs = new Map<string | undefined, TimelineItem[]>()
  for (const item of items) {
    const id = runOf(item)
    runs.set(id, [...(runs.get(id) ?? []), item])
  }
  // A queued turn publishes preparation status before its native-start user event.
  // Show that opening message before its process, while preserving mid-run input order.
  const displayItems = [...items]
  for (const rows of runs.values()) {
    const opening = rows.findIndex((row) => row.kind === 'user')
    if (opening <= 0 || !rows.slice(0, opening).every((row) => ['status', 'diagnostic'].includes(row.kind)))
      continue
    const user = rows[opening]!
    displayItems.splice(displayItems.indexOf(user), 1)
    displayItems.splice(displayItems.indexOf(rows[0]!), 0, user)
  }
  const flow: { item: TimelineItem; process?: TimelineItem[] }[] = []
  for (const item of displayItems) {
    const process = item.kind !== 'user' && (item.kind !== 'assistant' || completedEmptyReply(item, worker))
    const previous = flow.at(-1)
    if (process && previous?.process && runOf(previous.item) === runOf(item)) previous.process.push(item)
    else flow.push({ item, process: process ? [item] : undefined })
  }
  const seen = new Set<string | undefined>(),
    groupsSeen = new Set<string | undefined>()
  return (
    <>
      {flow.map(({ item, process }) => {
        const id = runOf(item)
        const rows = runs.get(id)!
        const first = item.kind !== 'user' && !seen.has(id)
        if (item.kind !== 'user') seen.add(id)
        const firstGroup = !!process && processContent(process, worker).length > 0 && !groupsSeen.has(id)
        if (firstGroup) groupsSeen.add(id)
        const open = processAlwaysOpen(rows, worker) || !policy.foldCompletedTurns || !!expandedRuns[id!]
        return (
          <Fragment key={item.kind === 'user' ? (item.queuedFollowupId ?? item.id) : item.id}>
            {first && (
              <WorkerProcessHeader
                rows={rows}
                worker={worker}
                open={open}
                toggle={() => setExpandedRuns((old) => ({ ...old, [id!]: !open }))}
              />
            )}
            {process && (
              <WorkerProcessGroup
                items={process}
                rows={rows}
                worker={worker}
                hidden={!open}
                first={firstGroup}
              />
            )}
            {(item.kind === 'user' || (item.kind === 'assistant' && !completedEmptyReply(item, worker))) && (
              <article
                className={`cwn-message ${item.kind}`}
                data-message-id={item.id}
                data-actions-reveal={
                  item.kind === 'user' ? (item.id === latestUser ? 'always' : 'hover') : undefined
                }
              >
                <div className={item.kind === 'assistant' ? 'cwn-markdown' : 'cwn-text'}>
                  {item.kind === 'assistant' ? (
                    <MarkdownText text={item.text} labels={markdownLabels()} />
                  ) : (
                    item.text
                  )}
                </div>
                <div
                  className="cwn-message-tail"
                  data-actions-reveal={
                    item.kind === 'assistant' ? (item.id === latestReply ? 'always' : 'hover') : undefined
                  }
                >
                  <div className="cwn-message-label">
                    <span className="cwn-sr-only">
                      {item.kind === 'user' ? t('你') : worker ? CLI_LABELS[cliOf(worker.preference)] : 'CLI'}
                    </span>
                    {item.kind === 'assistant' && item.text && (
                      <CopyText text={item.text} label={t('复制回复')} iconOnly />
                    )}
                    {item.kind === 'assistant' && <UsageIndicator usage={item.usage} providerCredits={item.providerCredits} creditsBased={creditBilledCli(worker?.preference.cli)} reply />}
                    <time dateTime={item.time} title={new Date(item.time).toLocaleString(formatLocale())}>
                      {messageClock(item.time)}
                    </time>
                    {item.kind === 'user' && item.text && (
                      <CopyText text={item.text} label={t('复制消息')} iconOnly />
                    )}
                  </div>
                  {messageFeedback?.[item.id] ??
                    (item.kind === 'user' && item.deliveryState && item.deliveryState === 'failed' ? (
                      <span role="status">
                        {item.deliveryError?.includes('结果待确认')
                          ? hostText(item.deliveryError)
                          : t('发送失败：{reason}', { reason: hostText(item.deliveryError) || t('插队未完成') })}
                      </span>
                    ) : null)}
                </div>
              </article>
            )}
          </Fragment>
        )
      })}
    </>
  )
}
