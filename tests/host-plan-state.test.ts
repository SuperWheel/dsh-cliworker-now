import { hostServiceFixture } from './fixtures/host-service.ts'
import { describe, expect, it, vi } from 'vitest'
import { readHostPlanActive } from '../src/host/host-plan-state.ts'

// SIMULATION: synthetic Agent/ctx objects shaped like DSH 0.2.2-rc.3 Desktop,
// where the plan service is isolated inside each Agent preset and only the
// process-wide `plan` session projection is visible to the plugin.
const session = { header: { cwd: '/synthetic/main' } }
function agent(service?: { active: boolean }) {
  return { id: 'main', session, ctx: { get: (name: string) => (name === 'planMode' && service ? { get: () => service } : undefined) } } as any
}
const projections = (state: unknown) => ({ stateOf: vi.fn((_session: unknown, key: string) => (key === 'plan' ? state : undefined)) })

describe('readHostPlanActive', () => {
  it('prefers a visible plan service and does not read projections', () => {
    const read = vi.fn(() => projections({ active: true }))
    expect(readHostPlanActive(agent({ active: false }), read)).toBe(false)
    expect(readHostPlanActive(agent({ active: true }), read)).toBe(true)
    expect(read).not.toHaveBeenCalled()
  })
  it('reads the session plan projection when the service is isolated', () => {
    const on = projections({ active: true, wanted: true, running: false, activeAtLastHeader: true, entered: 1 })
    expect(readHostPlanActive(agent(), () => on)).toBe(true)
    expect(on.stateOf).toHaveBeenCalledWith(session, 'plan')
    expect(readHostPlanActive(agent(), () => projections({ active: false, wanted: false }))).toBe(false)
  })
  it('treats a deployment without plan mode as not planning', () => {
    expect(readHostPlanActive(agent(), () => projections(undefined))).toBe(false)
    expect(readHostPlanActive(agent(), () => undefined)).toBe(false)
  })
  it.each([null, 'on', 1, {}, { active: 'yes' }])('fails closed on an unreadable plan unit %j', (state) => {
    expect(readHostPlanActive(agent(), () => projections(state))).toBe(true)
  })
})

describe('host plan boundary when the plan service is isolated', () => {
  function service(plan: boolean) {
    const parent: any = { id: 'main', session, ctx: { get: (name: string) => ({
      sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) },
      approval: { overrideOf: () => undefined, config: { policy: 'never' } },
    } as Record<string, unknown>)[name] } }
    const host: any = hostServiceFixture({
      ctx: { get: (name: string) => (name === 'sessionProjections' ? projections({ active: plan }) : undefined) },
    })
    return { host, parent }
  }
  it('refuses dispatch and reports plan mode while the projection is active', () => {
    const { host, parent } = service(true)
    expect(() => host['host'].assertExecution(parent, true)).toThrow('请先退出 Harness 规划模式')
    expect(host['host'].permissionState(parent)).toEqual({ planMode: true, sandbox: 'workspace-write', approval: 'never' })
  })
  it('admits dispatch after plan mode is off', () => {
    const { host, parent } = service(false)
    expect(() => host['host'].assertExecution(parent, true)).not.toThrow()
    expect(host['host'].permissionState(parent).planMode).toBe(false)
  })
})
