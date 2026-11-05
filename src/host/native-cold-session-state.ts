import type { InboxState, TurnBoundaryProjection } from '@deepseek-ai/dsh-agent/types'
import type { PlanUnitState } from '@deepseek-ai/dsh-plan-mode/types'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { z } from 'zod'

// rc.1's string-keyed stateOf returns unknown, not the wire projection map.
// Validate only the host fields used for cold-session admission. In particular
// plan's wire { active, pending } cannot establish that no command is running.
// The consumed fields are unchanged in rc.5; rc.1 adds plan.entered.
type ColdInbox = { [K in keyof InboxState]: Pick<InboxState[K], 'length'> }
type ColdPlan = Pick<PlanUnitState, 'active' | 'wanted'> & {
  running: Pick<NonNullable<PlanUnitState['running']>, 'wanted'> | null
}
const inboxSchema: z.ZodType<ColdInbox> = z.object({
  'next-turn': z.array(z.unknown()),
  'next-step': z.array(z.unknown()),
})
const turnSchema: z.ZodType<Pick<TurnBoundaryProjection, 'openTurnStartSeq'>> = z.object({
  openTurnStartSeq: z.number().int().nonnegative().transform(SessionSeq).nullable(),
})
const planSchema: z.ZodType<ColdPlan> = z.object({
  active: z.boolean(),
  wanted: z.boolean().nullable(),
  running: z.object({ wanted: z.boolean() }).nullable(),
})

/** Fail closed before changing a cold session if a host projection is missing or incompatible. */
export function readNativeColdSessionState(inbox: unknown, turn: unknown, plan: unknown) {
  const parsedInbox = inboxSchema.safeParse(inbox)
  const parsedTurn = turnSchema.safeParse(turn)
  const parsedPlan = planSchema.safeParse(plan)
  if (!parsedInbox.success || !parsedTurn.success || !parsedPlan.success)
    throw new Error('原生历史会话投影尚未就绪或格式不兼容，未修改权限')
  return { inbox: parsedInbox.data, turn: parsedTurn.data, plan: parsedPlan.data }
}
