import type { Agent } from '@deepseek-ai/dsh-agent'

type PlanService = { get(agent: Agent): { active: boolean } }
type PlanProjections = { stateOf(session: Agent['session'], key: string): unknown }

/**
 * Whether the parent conversation is in DSH plan mode.
 *
 * DSH 0.2.2-rc.5 Desktop configuration disables the host-plane `plan-mode` plugin and mounts
 * it inside each Agent preset's `planning` group with `isolate: planMode`, so
 * neither the plugin context nor `agent.ctx` can resolve the service
 * (2026-11-14 rc.3 Mac Desktop probe: every `get('planMode')` was undefined while
 * the session's `plan` projection was active). The `plan` projection stays a
 * process-wide unit and carries the logged state, so it is read when the
 * service is not visible. A deployment without plan mode has no `plan` unit
 * (`stateOf` returns undefined). A present but unreadable unit fails closed:
 * treating it as active refuses execution instead of bypassing the boundary.
 *
 * @param agent - The parent Agent.
 * @param projections - Reads the `sessionProjections` service, only when the plan service is not visible.
 * @returns true while the logged plan state is active.
 */
export function readHostPlanActive(agent: Agent, projections: () => PlanProjections | undefined): boolean {
  const service = agent.ctx.get('planMode') as PlanService | undefined
  if (service) return !!service.get(agent).active
  const state = projections()?.stateOf(agent.session, 'plan')
  if (state === undefined) return false
  if (
    typeof state !== 'object' ||
    state === null ||
    typeof (state as { active?: unknown }).active !== 'boolean'
  )
    return true
  return (state as { active: boolean }).active
}
