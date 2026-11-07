import { describe, expect, it } from 'vitest'
import { traecnAcpArgv, traecnPromptUsage, forkNativeTraecn } from '../src/host/native-traecn.mjs'
import { decideApproval } from '../src/host/native-approval-policy.ts'
import { traecnFixture } from './fixtures/traecn-acp.ts'

const notice = '因拒绝审批而结束：被拒操作未执行，可续聊继续'
const methods = (f: Awaited<ReturnType<typeof traecnFixture>>) => f.records.map(r => r.method)
describe('模拟：TRAE 原生 ACP 回执与权限边界', () => {
  it.each(['workspace-write', 'danger-full-access'])('uses exact %s argv and confirmed model, with public thought separate', async access => {
    const f = await traecnFixture('success', { access })
    expect(f.records[0].argv).toEqual(['--permission-mode', access === 'danger-full-access' ? 'bypass_permissions' : 'default', 'acp', 'serve'])
    expect(f.result).toMatchObject({ status: 'SUCCESS', response: '模拟新正文' })
    expect(f.frames.some(v => v.event?.kind === 'reasoning')).toBe(true)
    expect(f.records.find(v => v.method === 'session/set_config_option').params).toMatchObject({ configId: 'model', value: 'SIMULATED-model' })
    expect(f.exited).toBe(true)
  })
  it('launches default then confirms plan before prompt', async () => {
    const f = await traecnFixture('success', { mode: 'plan', access: 'read-only' })
    expect(f.records[0].argv).toEqual(['--permission-mode', 'default', 'acp', 'serve'])
    const selected = f.records.findIndex(v => v.method === 'session/set_config_option' && v.params.configId === 'mode')
    expect(f.records[selected].params.value).toBe('plan')
    expect(selected).toBeLessThan(methods(f).indexOf('session/prompt'))
    expect(f.result.status).toBe('SUCCESS')
  })
  it.each(['wrong-agent', 'model-missing', 'unconfirmed-mode', 'default-missing'])('rejects %s without prompt', async scenario => {
    const f = await traecnFixture(scenario, { mode: scenario === 'unconfirmed-mode' ? 'plan' : 'accept-edits' })
    expect(f.result.status).toBe('ERROR'); expect(methods(f)).not.toContain('session/prompt'); expect(f.exited).toBe(true)
  })
  it.each([{ effort: 'high' }, { access: 'read-only' }])('rejects unsupported selection before spawning %j', async options => {
    const f = await traecnFixture('success', options)
    expect(f.result.status).toBe('ERROR'); expect(f.records).toEqual([])
  })
  it('passes argv values literally and never enables personal login in tasks', () => {
    expect(traecnAcpArgv({ argv: ['/模拟 path/traecli'], mode: 'plan', preference: { effort: 'default' } }))
      .toEqual(['/模拟 path/traecli', '--permission-mode', 'default', 'acp', 'serve'])
  })
  it.each(['allow-once', 'deny'])('relays outside-workspace approval without session option: %s', async decision => {
    const f = await traecnFixture('permission', { decision })
    const approval = f.frames.find(v => v.type === 'approval')
    expect(approval).toBeDefined()
    expect(JSON.stringify(approval)).toContain('/SIMULATED/outside.txt')
    expect(approval.request?.allowSession ?? approval.allowSession).toBeFalsy()
    expect(f.records.find(v => v.id === 'SIMULATED-approval').result.outcome.optionId).toBe(decision === 'deny' ? 'abort' : 'approved')
    if (decision === 'deny') expect(f.result).toMatchObject({ status: 'SUCCESS', response: '', notice })
    expect(f.exited).toBe(true)
  })
  it('preserves response on denied cancellation and does not mask missing tool terminal', async () => {
    const f = await traecnFixture('permission-text')
    expect(f.result).toMatchObject({ status: 'SUCCESS', response: '模拟拒绝前正文', notice })
    for (const scenario of ['permission-pending', 'permission-other-failure']) {
      const failed = await traecnFixture(scenario)
      expect(failed.result.status).toBe('ERROR'); expect(failed.result.notice).toBeUndefined()
    }
  })
  it.each(['cancel', 'permission'])('user stop %s never becomes a denial success', async scenario => {
    const f = await traecnFixture(scenario, { abortAtApproval: true })
    expect(f.result.status).not.toBe('SUCCESS'); expect(f.result.notice).not.toBe(notice)
    expect(methods(f)).toContain('session/cancel'); expect(f.exited).toBe(true)
  })
  it('loads existing session and excludes history replay from this turn', async () => {
    const f = await traecnFixture('success', { resume: true })
    expect(methods(f)).toContain('session/load'); expect(methods(f)).not.toContain('session/new')
    expect(f.result.response).toBe('模拟新正文')
    expect(f.frames.some(v => v.event?.text?.includes('模拟历史'))).toBe(false)
  })
  it('never replaces a failed load with session/new', async () => {
    const f = await traecnFixture('load-error', { resume: true })
    expect(f.result.status).toBe('ERROR'); expect(methods(f)).not.toContain('session/new'); expect(methods(f)).not.toContain('session/prompt')
  })
  it.each(['mode-mismatch', 'config-mode-mismatch'])('stops on runtime %s', async scenario => {
    const f = await traecnFixture(scenario)
    expect(f.result.status).toBe('ERROR'); expect(f.result.error).toContain('实际权限'); expect(methods(f)).toContain('session/cancel')
  })
  it('reports end_turn usage and native context, suppressing zero/cancelled usage', async () => {
    const f = await traecnFixture('success')
    expect(f.frames.find(v => v.record?.type === 'cliworker.traecn_prompt_usage')?.record.usage)
      .toEqual({ inputTokens: 60, outputTokens: 7, totalTokens: 67, thoughtTokens: 2, cachedReadTokens: 20, cachedWriteTokens: 3 })
    expect(f.frames.find(v => v.record?.type === 'cliworker.traecn_context')?.record).toMatchObject({ used: 67, size: 128000 })
    for (const scenario of ['zero', 'cancel', 'permission']) {
      const other = await traecnFixture(scenario)
      expect(other.frames.filter(v => v.record?.type === 'cliworker.traecn_prompt_usage')).toEqual([])
      if (scenario !== 'zero') expect(other.frames.filter(v => v.record?.type === 'cliworker.traecn_context')).toEqual([])
    }
  })
  it.each([undefined, { inputTokens: 1, outputTokens: 2, totalTokens: 4 }, { inputTokens: -1, outputTokens: 2, totalTokens: 1 },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, { inputTokens: 1.5, outputTokens: 2, totalTokens: 3.5 }])('rejects unconfirmed usage %j', value => {
    expect(traecnPromptUsage(value)).toBeUndefined()
  })
  it('forks to a new native id and closes the fork without prompting', async () => {
    const f = await traecnFixture('success', { fork: true }, forkNativeTraecn)
    expect(f.frames.find(v => v.record?.type === 'cliworker.fork_created')?.record.id).toBe('SIMULATED-fork')
    expect(methods(f)).toContain('session/close'); expect(methods(f)).not.toContain('session/prompt'); expect(f.result.status).toBe('SUCCESS')
  })
})

it('模拟：完全权限不可用时以 TRAE 名称报告 default 降级', async () => {
  const f = await traecnFixture('fallback', { access: 'danger-full-access' })
  expect(f.result.status).toBe('SUCCESS')
  expect(f.frames.find(v => v.event?.text?.includes('本轮按'))?.event.text).toContain('本轮按仅工作区编辑运行')
})

it('模拟：规划模式审批由 Host 直接拒绝，不允许工作区外操作', async () => {
  const answer = decideApproval('plan', 'full', { planMode: true, sandbox: 'danger-full-access', approval: 'never' })
  expect(answer).toEqual({ decision: 'deny', source: 'plan' })
  const f = await traecnFixture('permission', { mode: 'plan', access: 'read-only', ...answer as object })
  expect(f.records.find(v => v.id === 'SIMULATED-approval').result.outcome.optionId).toBe('abort')
  expect(f.result).toMatchObject({ status: 'SUCCESS', notice: '因拒绝审批而结束：被拒操作未执行，可续聊继续' })
})
