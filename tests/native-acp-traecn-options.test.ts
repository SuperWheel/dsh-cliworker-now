import { describe, expect, it } from 'vitest'
import { runNativeAcp } from '../src/host/native-acp.mjs'
import { traecnAcpArgv } from '../src/host/native-traecn.mjs'
import { traecnFixture } from './fixtures/traecn-acp.ts'
const runner = (extra: Record<string, any> = {}) => (config: any, io: any) => runNativeAcp(config, io, {
  name: '模拟 ACP', agentName: 'traecli-acp', argv: traecnAcpArgv,
  editMode: config.access === 'danger-full-access' ? 'bypass_permissions' : 'default',
  fallbackModes: ['default'], modeConfigId: 'mode', encode: (v: any) => v, ...extra,
})
describe('模拟：共享 ACP 新选项默认关闭', () => {
  it.each([false, true])('deniedCancelEndsTurn opt-in=%s', async enabled => {
    const f = await traecnFixture('permission', {}, runner(enabled ? { deniedCancelEndsTurn: true } : {}))
    expect(f.result.status).toBe(enabled ? 'SUCCESS' : 'ERROR')
    expect(f.result.notice).toBe(enabled ? '因拒绝审批而结束：被拒操作未执行，可续聊继续' : undefined)
    expect(f.result.response).toBe('')
  })
  it.each([false, true])('modeLabel opt-in=%s keeps the default fallback wording', async enabled => {
    const f = await traecnFixture('fallback', { access: 'danger-full-access' }, runner(enabled ? { modeLabel: () => '仅工作区编辑' } : {}))
    expect(f.frames.find(v => v.event?.text?.includes('本轮按'))?.event.text)
      .toBe(`模拟 ACP 原生权限模式不可用，本轮按${enabled ? '仅工作区编辑' : '询问'}运行（default）`)
    expect(f.result.status).toBe('SUCCESS')
  })
})
