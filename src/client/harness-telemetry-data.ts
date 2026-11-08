import type { CliId, HarnessConversationBinding, WorkerSnapshot } from '../shared/types.ts'
import { cliOf } from '../shared/types.ts'
import { nativeTokenUsage } from '../shared/native-token-usage.ts'
export { nativeTokenUsage } from '../shared/native-token-usage.ts'
import { creditBilledCli, type Telemetry } from '../shared/telemetry.ts'
import { nativeUsageReport, type NativeUsageReport } from '../shared/native-usage-report.ts'
import type { ExternalTurnUsage } from '../shared/native-turn-usage.ts'
import type { ExternalTurnAnswer } from '../shared/native-turn-answer.ts'
import { telemetryAvailability, type TelemetryAvailability, type ExternalRequestState } from '../shared/native-request-state.ts'

/** The exact numeric contracts consumed by the installed rc.2 native leaves. */
export interface NativeTelemetryProjections {
  telemetryAvailability: TelemetryAvailability | undefined
  externalRequestState: ExternalRequestState | undefined
  tokenUsage:
    | { uncachedInputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number;
        externalScope?: 'run' | 'reported'; externalRunId?: string; externalIsPrevious?: boolean }
    | { externalUsage: NativeUsageReport; externalCredits?: number; externalScope?: 'run' | 'reported' | 'session'; externalRunId?: string; externalIsPrevious?: boolean }
    | { externalUsage: undefined; externalCredits: number; externalScope: 'run'; externalRunId?: string; externalIsPrevious?: boolean }
    | undefined
  contextPressure: { pressureTokens?: number; contextWindow?: number; externalContext?: {
    ratio?: number;
    source?: string; estimated?: boolean;
    breakdown?: { systemTokens?: number; toolsTokens?: number; messageTokens?: number; estimated?: boolean; source?: string }
    categories?: { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }[]
  } } | undefined
  contextBreakdown: { systemTokens: number; toolsTokens: number; messageTokens: number } | undefined
  externalTurnUsage: ExternalTurnUsage | undefined
  externalTurnAnswer: ExternalTurnAnswer | undefined
}

export type NativeTelemetryBinding = HarnessConversationBinding & { workerId?: string }
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function nativeTelemetryProjections(cli: CliId, telemetry?: Telemetry, externalTurnUsage?: ExternalTurnUsage, activeRunId?: string,
  lifecycle?: { busy: boolean; externalRequestState?: ExternalRequestState; externalTurnAnswer?: ExternalTurnAnswer }): NativeTelemetryProjections {
  const pressureTokens = count(telemetry?.contextUsed) ? telemetry.contextUsed : undefined
  const contextWindow =
    count(telemetry?.contextCapacity) && telemetry.contextCapacity > 0 ? telemetry.contextCapacity : undefined
  const contextRatio = typeof telemetry?.contextRatio === 'number' && Number.isFinite(telemetry.contextRatio) &&
    telemetry.contextRatio >= 0 && telemetry.contextRatio <= 1 ? telemetry.contextRatio : undefined
  const breakdown = telemetry?.contextBreakdown
  const partialBreakdown = {
    ...(count(breakdown?.systemTokens) ? { systemTokens: breakdown.systemTokens } : {}),
    ...(count(breakdown?.toolTokens) ? { toolsTokens: breakdown.toolTokens } : {}),
    ...(count(breakdown?.messageTokens) ? { messageTokens: breakdown.messageTokens } : {}),
  }
  const buckets = nativeTokenUsage(cli, telemetry?.usage)
  const scope = telemetry?.usage?.scope
  const report = buckets ? undefined : nativeUsageReport(cli, telemetry?.usage)
  const credits = creditBilledCli(cli) && typeof telemetry?.providerCredits === 'number' &&
    Number.isFinite(telemetry.providerCredits) && telemetry.providerCredits >= 0 ? telemetry.providerCredits : undefined
  return {
    telemetryAvailability: lifecycle || creditBilledCli(cli) ? { ...telemetryAvailability(lifecycle?.busy ?? false),
      ...(creditBilledCli(cli) ? { statisticsBasis: 'harness-cli-adapter' as const, usageUnit: 'credits' as const } : {}) } : undefined,
    externalRequestState: lifecycle?.busy && lifecycle.externalRequestState?.runId === activeRunId
      ? lifecycle.externalRequestState : undefined,
    externalTurnUsage,
    externalTurnAnswer: lifecycle?.externalTurnAnswer,
    tokenUsage: (buckets || report) ? {
      ...(buckets ?? { externalUsage: report! }),
      ...(credits === undefined ? {} : { externalCredits: credits }),
      ...(scope === 'run' || scope === 'reported' ? {
        externalScope: scope,
        ...(telemetry?.usageRunId || activeRunId ? { externalRunId: telemetry?.usageRunId ?? activeRunId } : {}),
        externalIsPrevious: !!activeRunId && !!telemetry?.usageRunId && activeRunId !== telemetry.usageRunId,
      } : {}),
    } : credits !== undefined ? { externalUsage: undefined, externalCredits: credits, externalScope: 'run',
      ...(activeRunId ? { externalRunId: activeRunId } : {}), externalIsPrevious: false } : undefined,
    contextPressure:
      pressureTokens === undefined && contextWindow === undefined && contextRatio === undefined
        ? undefined
        : {
            ...(pressureTokens === undefined ? {} : { pressureTokens }),
            ...(contextWindow === undefined ? {} : { contextWindow }),
            externalContext: {
                ...(contextRatio === undefined ? {} : { ratio: contextRatio }),
                ...(telemetry?.contextSource ? { source: telemetry.contextSource } : {}),
                ...(telemetry?.contextEstimated === undefined ? {} : { estimated: telemetry.contextEstimated }),
                ...(Object.keys(partialBreakdown).length ? { breakdown: {
                  ...partialBreakdown,
                  ...(typeof breakdown?.estimated === 'boolean' ? { estimated: breakdown.estimated } : {}),
                  ...(breakdown?.source ? { source: breakdown.source } : {}),
                } } : {}),
                ...(breakdown?.categories?.length ? { categories: breakdown.categories.slice(0, 64).filter((item) =>
                  count(item.tokens) && typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 80 &&
                  ['used', 'free', 'buffer', 'deferred'].includes(item.kind)) } : {}),
            },
          },
    // The standard projection still requires all three categories. Partial
    // counts travel as optional metadata to the same native detail rows.
    contextBreakdown:
      count(breakdown?.systemTokens) && count(breakdown?.toolTokens) && count(breakdown?.messageTokens)
        ? {
            systemTokens: breakdown.systemTokens,
            toolsTokens: breakdown.toolTokens,
            messageTokens: breakdown.messageTokens,
          }
        : undefined,
  }
}

/** Only the exact Host-issued child/Worker pair may supply its telemetry. */
export function nativeTelemetryFromSnapshot(binding: NativeTelemetryBinding, snapshot: WorkerSnapshot) {
  const worker = snapshot.selected
  const child = worker?.harnessConversation
  if (
    !binding.workerId ||
    binding.sessionId === binding.parentSessionId ||
    worker?.id !== binding.workerId ||
    worker.parentSessionId !== binding.parentSessionId ||
    child?.sessionId !== binding.sessionId ||
    child.parentSessionId !== binding.parentSessionId ||
    child.mode !== binding.mode
  )
    return
  return { cli: cliOf(worker.preference), telemetry: snapshot.telemetry, externalTurnUsage: snapshot.externalTurnUsage, activeRunId: worker.runId,
    lifecycle: { busy: snapshot.selectedBusy === true || worker.status === 'running' || worker.status === 'queued', externalRequestState: snapshot.externalRequestState,
      externalTurnAnswer: snapshot.externalTurnAnswer } }
}

