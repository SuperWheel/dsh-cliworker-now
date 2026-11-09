import { IconDatabaseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { compactTokens, creditBilledCli, type Telemetry, type TokenUsage } from '../shared/telemetry.ts'
import type { Worker } from '../shared/types.ts'
import { StatPopover } from './stat-popover.tsx'
import { formatLocale, t, useT, type MessageKey } from './i18n.ts'

export function UsageIndicator({ usage, reply = false, providerCredits, creditsBased = false }: {
  usage?: TokenUsage; reply?: boolean; providerCredits?: number; creditsBased?: boolean
}) {
  const t = useT()
  const scope = {
    response: t('本次回复'),
    run: t('本轮任务'),
    session: t('CLI 会话累计'),
    reported: t('CLI 报告值（不跨轮重复相加）'),
  }
  const credits = typeof providerCredits === 'number' && Number.isFinite(providerCredits) && providerCredits >= 0 ? providerCredits : undefined
  const creditUsage = creditsBased || credits !== undefined
  const total = creditUsage
    ? `${credits === undefined ? '—' : credits > 0 && credits < 0.0001 ? '<0.0001' : credits.toLocaleString(formatLocale(), { maximumFractionDigits: 4 })}${t(' 积分')}`
    : usage ? `${compactTokens(usage.total)} tok` : '— tok'
  return (
    <StatPopover
      label={reply ? `${creditUsage ? t('积分用量') : t('用量')} ${total}` : total}
      className={`cwn-stat cwn-usage${reply ? ' cwn-reply-usage' : ''}`}
      trigger={
        <>
          <IconDatabaseOutlineRegular size={14} />
          <span>
            {reply ? creditUsage ? t('积分用量 ') : t('用量 ') : ''}
            {total}
          </span>
        </>
      }
    >
      <div className="cwn-stat-title">
        <span>
          <IconDatabaseOutlineRegular size={14} />
          {creditUsage ? t('积分用量') : t('Token 用量')}
        </span>
        <span>{creditUsage ? credits?.toLocaleString(formatLocale(), { maximumFractionDigits: 12 }) ?? '—' : usage ? `${usage.total.toLocaleString('en-US')} tok` : '—'}</span>
      </div>
      <div className="cwn-stat-rule" />
      {credits !== undefined && <dl className="cwn-stat-details"><dt>{t('本轮积分')}</dt><dd>{credits.toLocaleString(formatLocale(), { maximumFractionDigits: 12 })}</dd></dl>}
      {creditUsage ? null : usage ? (
        <dl className="cwn-stat-details">
          <dt>{t('统计范围')}</dt>
          <dd>{scope[usage.scope]}</dd>
          {usage.input !== undefined && (
            <>
              <dt>{t('输入')}</dt>
              <dd>{usage.input.toLocaleString('en-US')} tok</dd>
            </>
          )}
          {usage.cacheRead !== undefined && (
            <>
              <dt>{t('缓存读取')}</dt>
              <dd>{usage.cacheRead.toLocaleString('en-US')} tok</dd>
            </>
          )}
          {usage.output !== undefined && (
            <>
              <dt>{t('输出')}</dt>
              <dd>{usage.output.toLocaleString('en-US')} tok</dd>
            </>
          )}
        </dl>
      ) : (
        <dl className="cwn-stat-details"><dt>{t('用量')}</dt><dd>—</dd></dl>
      )}
    </StatPopover>
  )
}
const contextRows = [
  { key: 'systemTokens', label: '系统提示词' as MessageKey, color: 'system' },
  { key: 'toolTokens', label: '工具定义' as MessageKey, color: 'tools' },
  { key: 'messageTokens', label: '对话消息' as MessageKey, color: 'messages' },
] as const
const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

export function contextFigures(telemetry?: Telemetry) {
  const used = count(telemetry?.contextUsed),
    rawCapacity = count(telemetry?.contextCapacity)
  const capacity = rawCapacity !== undefined && rawCapacity > 0 ? rawCapacity : undefined
  const nativeRatio = telemetry?.contextRatio
  const percent = typeof nativeRatio === 'number' && Number.isFinite(nativeRatio) && nativeRatio >= 0 && nativeRatio <= 1
    ? Math.round(nativeRatio * 1000) / 10
    : used !== undefined && capacity !== undefined && capacity > 0
      ? Math.min(100, Math.round((used / capacity) * 100))
      : undefined
  const rows = contextRows.map((row) => ({ ...row, value: count(telemetry?.contextBreakdown?.[row.key]) }))
  const complete = rows.every((row) => row.value !== undefined)
  const total = complete ? rows.reduce((sum, row) => sum + row.value!, 0) : 0
  const segments =
    percent === undefined
      ? []
      : complete && total > 0
        ? rows
            .filter((row) => row.value! > 0)
            .map((row) => ({ key: row.key, color: row.color, width: (percent * row.value!) / total }))
        : [{ key: 'total', color: undefined, width: percent }]
  return { used, capacity, percent, rows, complete, segments }
}
/** rc.2 ContextMeter presentation, driven exclusively by this Worker's evidence. */
export function ContextDetails({ telemetry }: { telemetry?: Telemetry }) {
  useT()
  const { used, capacity, percent, rows, segments } = contextFigures(telemetry)
  const source = [
    telemetry?.contextSource,
    telemetry?.contextCapacitySource,
    telemetry?.contextBreakdown?.source,
  ]
    .filter(Boolean)
    .join('；')
  return (
    <>
      <div className="cwn-context-header" title={source || undefined}>
        <span className="cwn-context-headline">{t('上下文已用')}</span>
        <span className="cwn-context-percent">{percent === undefined ? '—' : `${percent}%`}</span>
        <strong>
          {used === undefined ? '—' : `${telemetry?.contextEstimated ? '~' : ''}${compactTokens(used)}`} /{' '}
          {capacity === undefined ? '—' : compactTokens(capacity)}
        </strong>
      </div>
      <div className="cwn-context-bar" aria-hidden="true">
        {segments
          .filter((segment) => segment.width > 0)
          .map((segment) => (
            <span
              key={segment.key}
              className={
                segment.color ? `cwn-context-segment cwn-context-${segment.color}` : 'cwn-context-segment'
              }
              style={{ width: `${segment.width}%` }}
            />
          ))}
      </div>
      <dl className="cwn-context-rows">
        {rows.map((row) => (
          <div className="cwn-context-row" key={row.key}>
            <dt>
              <span className={`cwn-context-swatch cwn-context-${row.color}`} aria-hidden="true" />
              {t(row.label)}
            </dt>
            <dd title={row.value === undefined ? t('CLI 未提供该分项') : telemetry?.contextBreakdown?.source}>
              {row.value === undefined
                ? '—'
                : `${telemetry?.contextBreakdown?.estimated ? '~' : ''}${compactTokens(row.value)}`}
            </dd>
          </div>
        ))}
      </dl>
    </>
  )
}
export function ComposerTelemetry({
  worker,
  telemetry,
  statusLabel,
}: {
  worker: Worker
  telemetry?: Telemetry
  statusLabel: string
}) {
  useT()
  const { percent } = contextFigures(telemetry)
  const label = percent === undefined ? t('上下文占用暂不可用') : t('上下文已用 {percent}%', { percent })
  return (
    <div className="cwn-compose-state cwn-telemetry">
      <span className="cwn-stat cwn-run-stat">
        <span className={`cwn-dot ${worker.status}`} />
        <span>{statusLabel}</span>
      </span>
      {/* traecn reports tokens; Qoder and the CodeBuddy family bill credits. */}
      <UsageIndicator usage={telemetry?.usage} providerCredits={telemetry?.providerCredits} creditsBased={creditBilledCli(worker.preference.cli)} />
      <StatPopover
        key={worker.id}
        label={label}
        tooltip={label}
        context
        className="cwn-stat cwn-context"
        trigger={
          <>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="7" cy="7" r="5.5" className="cwn-context-track" />
              {percent !== undefined && (
                <circle
                  cx="7"
                  cy="7"
                  r="5.5"
                  className="cwn-context-fill"
                  strokeDasharray={`${(percent * Math.PI * 11) / 100} ${Math.PI * 11}`}
                  transform="rotate(-90 7 7)"
                />
              )}
            </svg>
            <span>{percent === undefined ? '—' : `${percent}%`}</span>
          </>
        }
      >
        <ContextDetails telemetry={telemetry} />
      </StatPopover>
    </div>
  )
}
