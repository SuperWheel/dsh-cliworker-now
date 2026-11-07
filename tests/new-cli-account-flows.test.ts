import { describe, expect, it } from 'vitest'
import { FlowGuide, type AccountEvidence, type GuideEvent } from '../src/host/account-guide/engine.ts'
import { createAccountGuide } from '../src/host/account-guide/flows.ts'
import { CODEBUDDY_FLOW } from '../src/host/account-guide/codebuddy-flow.ts'
import { TRAECN_FLOW } from '../src/host/account-guide/traecn-flow.ts'
import { parseTraecnAccount } from '../src/host/traecn-accounts.ts'
import { codebuddyTrustRecorded, traePersonalRecorded, traeEnterpriseRecorded, traePatRecorded, traeSignedOutRecorded } from './fixtures/new-cli-login-recorded.ts'
const guides = (events: GuideEvent[]) => events.flatMap(event => 'guide' in event ? [event.guide] : [])
const writes = (events: GuideEvent[]) => events.filter(event => 'write' in event || 'command' in event)
const state = (state: AccountEvidence['state']): AccountEvidence => ({ state })

describe('CodeBuddy/TRAE recorded text replay and explicitly simulated states', () => {
  it.each(['login', 'logout'] as const)('CodeBuddy %s never accepts trust or guesses uncaptured slash commands', action => {
    const flow = createAccountGuide('codebuddy', action)!
    const events = [...flow.output(codebuddyTrustRecorded), ...flow.settled()]
    expect(guides(events)).toContainEqual(expect.objectContaining({ template: 'native' }))
    expect(writes(events)).toEqual([])
    expect(flow.output(codebuddyTrustRecorded)).toEqual([])
    expect(flow.identified(state('authenticated'))).toEqual([])
    expect(() => flow.respond({ confirm: 'trust' })).toThrow()
    expect(() => flow.respond({ option: 'internal' })).toThrow()
  })
  it('CodeBuddy unknown editor text falls back without automatic writes, even if already signed in', () => {
    const flow = createAccountGuide('codebuddy', 'logout')!
    expect(guides(flow.output('SIMULATED unknown screen'))[0]?.template).toBe('native')
    expect(writes(flow.settled())).toEqual([])
    expect(flow.identified(state('authenticated'))).toEqual([])
  })
  it('personal recorded callback prompt survives single-character chunks and redraw without duplicate watches', () => {
    const flow = createAccountGuide('traecn', 'login', { provider: 'personal' })!
    const events = [...traePersonalRecorded].flatMap(char => flow.output(char))
    expect(guides(events)).toContainEqual(expect.objectContaining({ template: 'browserCode', link: 'https://www.trae.cn/authorization?state=SIMULATED' }))
    expect(events.filter(event => 'watch' in event)).toHaveLength(1)
    expect(writes(events)).toEqual([])
    expect(flow.output('\x1b[2J\x1b[H' + traePersonalRecorded)).toEqual([])
    const response = flow.respond({ code: 'http://127.0.0.1:12345/authorize?code=SIMULATED' })
    expect(response[0]).toEqual({ write: 'http://127.0.0.1:12345/authorize?code=SIMULATED', enter: true })
    expect(response).toContainEqual({ confirm: 'login' })
    expect(JSON.stringify(guides(response))).not.toContain('code=SIMULATED')
    expect(() => flow.respond({ code: 'again' })).toThrow()
  })
  it.each([
    'https://www.trae.cn.evil.invalid/authorization', 'https://sub.www.trae.cn/authorization',
    'https://attacker@www.trae.cn/authorization', 'http://www.trae.cn/authorization',
    'https://trae.cn/authorization', 'https://console.enterprise.trae.cn/authorization',
  ])('rejects unverified link %s and offers native fallback', url => {
    const flow = createAccountGuide('traecn', 'login', { provider: 'personal' })!
    const events = flow.output(traePersonalRecorded.replace('https://www.trae.cn/authorization?state=SIMULATED', url))
    expect(guides(events)).toEqual([])
    expect(guides(flow.settled())[0]?.template).toBe('native')
  })
  it.each([['enterprise', traeEnterpriseRecorded], ['enterprise-pat', traePatRecorded]])('keeps %s native and never collects a PAT', (provider, screen) => {
    const flow = createAccountGuide('traecn', 'login', { provider })!
    const events = flow.output(screen)
    expect(guides(events)[0]).toMatchObject({ template: 'native' })
    expect(guides(events)[0]?.link).toBeUndefined()
    expect(writes(events)).toEqual([])
    expect(() => flow.respond({ secret: 'SIMULATED' })).toThrow()
  })
  it('checks native state after TRAE logout exits, not after the recorded text alone', () => {
    const flow = new FlowGuide(TRAECN_FLOW, { action: 'logout' })
    expect(flow.output(traeSignedOutRecorded)).toEqual([])
    expect(flow.exited()).toContainEqual({ confirm: 'logout' })
    expect(flow.proves('logout', state('authenticated'), state('unconfigured'), 0)).toBe(true)
    expect(flow.proves('logout', state('authenticated'), state('unconfigured'), 1)).toBe(false)
  })
  it.each(['unknown', 'unavailable', 'configured', 'authenticated'] as const)('never proves logout with %s', value => {
    for (const definition of [CODEBUDDY_FLOW, TRAECN_FLOW]) {
      const flow = new FlowGuide(definition, { action: 'logout' })
      expect(flow.proves('logout', state('authenticated'), state(value), 0)).toBe(false)
      expect(flow.proves('logout', state('authenticated'), undefined, 0)).toBe(false)
    }
  })
  it('requires a known signed-out baseline, not mtime, same-site state or a zero exit', () => {
    for (const [definition, absent] of [[CODEBUDDY_FLOW, 'unauthenticated'], [TRAECN_FLOW, 'unconfigured']] as const) {
      const flow = new FlowGuide(definition, { action: 'login' })
      for (const before of [undefined, state('authenticated'), state('unknown'), state('unavailable')])
        expect(flow.proves('login', before, state('authenticated'), 0)).toBe(false)
      expect(flow.proves('login', state(absent), state('authenticated'), 0)).toBe(true)
      expect(flow.proves('login', state(absent), state('unknown'), 0)).toBe(false)
    }
  })
  it.each([
    ['Logged in using Trae', 0, 'authenticated'], ['Not logged in', 1, 'unconfigured'],
    ['Logged in using Trae', 1, 'unknown'], ['Not logged in', 0, 'unknown'],
    ['Logged in using Trae', undefined, 'unknown'], ['Not logged in', null, 'unknown'],
    ['Logged in using Trae\nNot logged in', 0, 'unknown'], ['Not logged in\nLogged in using Trae', 1, 'unknown'],
    ['prefix Logged in using Trae', 0, 'unknown'], ['Not logged in: connection failed', 1, 'unknown'],
    ['Current plan does not support CLI usage.', 0, 'unavailable'],
  ] as const)('status requires exact lines and exit: %s / %s', (output, code, expected) => {
    expect(parseTraecnAccount(output, code).state).toBe(expected)
  })
})
