import recordedMenuVt from './fixtures/codebuddy-menu-redraw-recorded.json'
import { describe, expect, it } from 'vitest'
import { FlowGuide, type AccountEvidence, type GuideEvent } from '../src/host/account-guide/engine.ts'
import { createAccountGuide } from '../src/host/account-guide/flows.ts'
import { CODEBUDDY_FLOW } from '../src/host/account-guide/codebuddy-flow.ts'
import { TRAECN_FLOW } from '../src/host/account-guide/traecn-flow.ts'
import { parseTraecnAccount } from '../src/host/traecn-accounts.ts'
import { codebuddyTrustRecorded, codebuddyEditorRecorded, codebuddySitesRecorded, codebuddyInternationalRecorded, codebuddyChinaBrowserRecorded, codebuddyIntlBrowserRecorded, codebuddyEnterpriseRecorded, codebuddyIoaRecorded, codebuddyCancelledRecorded, codebuddyLogoutRecorded, traePersonalRecorded, traeEnterpriseRecorded, traePatRecorded, traeSignedOutRecorded } from './fixtures/new-cli-login-recorded.ts'
const guides = (events: GuideEvent[]) => events.flatMap(event => 'guide' in event ? [event.guide] : [])
const writes = (events: GuideEvent[]) => events.filter(event => 'write' in event || 'command' in event)
const state = (state: AccountEvidence['state']): AccountEvidence => ({ state })

describe('CodeBuddy/TRAE recorded text replay and explicitly simulated states', () => {
  it.each(['login', 'logout'] as const)('CodeBuddy %s requires the user to confirm current-folder trust', action => {
    const flow = createAccountGuide('codebuddy', action)!
    const events = [...flow.output(codebuddyTrustRecorded), ...flow.settled()]
    expect(guides(events)).toContainEqual(expect.objectContaining({ template: 'trust' }))
    expect(writes(events)).toEqual([])
    expect(flow.output(codebuddyTrustRecorded)).toEqual([])
    expect(() => flow.respond({ option: 'internal' })).toThrow()
    expect(writes(flow.respond({ confirm: 'trust' }))).toEqual([{ write: '\r', enter: undefined }])
    expect(() => flow.respond({ confirm: 'trust' })).toThrow()
    if (action === 'login') expect(writes(flow.output(codebuddyEditorRecorded))).toEqual([{ write: '/login', enter: true }])
    else expect(writes(flow.output(codebuddyEditorRecorded))).toEqual([{ command: '/logout' }])
  })
  it('never accepts a different trust scope or terms', () => {
    for (const screen of [codebuddyTrustRecorded.replace('> 1.', '  1.').replace('2. Trust', '> 2. Trust'), 'SIMULATED Terms of Service: Enter to accept']) {
      const flow = createAccountGuide('codebuddy', 'login')!
      expect(guides(flow.output(screen))[0]?.template).toBe('native')
      expect(() => flow.respond({ confirm: 'trust' })).toThrow()
    }
  })
  it('opens login once from the recorded blank editor, never from partial text or the site menu', () => {
    const flow = createAccountGuide('codebuddy', 'login')!
    const events = [...codebuddyEditorRecorded].flatMap(char => flow.output(char))
    expect(writes(events)).toEqual([{ write: '/login', enter: true }])
    expect(writes(flow.output('\x1b[2J\x1b[H' + codebuddyEditorRecorded))).toEqual([])
    const initialMenu = createAccountGuide('codebuddy', 'login')!
    expect(writes(initialMenu.output(codebuddySitesRecorded))).toEqual([])
    expect(guides(initialMenu.output('\x1b[2J\x1b[H' + codebuddySitesRecorded + '\r\n' + codebuddyEditorRecorded)).map(g => g.step)).not.toContain('editor')
    const busy = createAccountGuide('codebuddy', 'login')!
    expect(writes(busy.output(codebuddyEditorRecorded.replace('>  ', '> SIMULATED input')))).toEqual([])
  })
  it.each(['china', 'international', 'enterprise', 'ioa'] as const)('answers %s from the current highlight and only once', option => {
    const flow = createAccountGuide('codebuddy', 'login')!
    expect(guides(flow.output(codebuddySitesRecorded))[0]).toMatchObject({ template: 'choice', options: [
      { id: 'china', label: '中国站' }, { id: 'international', label: '国际站' },
      { id: 'enterprise', label: '企业域', detail: expect.any(String) }, { id: 'ioa', label: 'iOA（仅腾讯员工）', detail: expect.any(String) },
    ] })
    flow.output('\x1b[2J\x1b[H' + codebuddyInternationalRecorded)
    const keys = { china: '\x1b[A', international: '', enterprise: '\x1b[B', ioa: '\x1b[B\x1b[B' }[option]
    expect(writes(flow.respond({ option }))).toEqual([{ write: keys, enter: true }])
    expect(() => flow.respond({ option })).toThrow()
  })
  it('replays the recorded VT menu and cursor redraw, preserving the actual highlight', () => {
    const flow = createAccountGuide('codebuddy', 'login')!
    expect(guides(flow.output(recordedMenuVt.menu)).at(-1)?.template).toBe('choice')
    expect(writes(flow.output(recordedMenuVt.arrowDown))).toEqual([])
    expect(writes(flow.respond({ option: 'china' }))).toEqual([{ write: '\x1b[A', enter: true }])
  })
  it('rejects an incomplete, reordered or ambiguously highlighted menu', () => {
    for (const screen of [codebuddySitesRecorded.replace('Select login method:', ''), codebuddySitesRecorded.replace('  Log in via International Site', '❯ Log in via International Site'), codebuddySitesRecorded.replace('Chinese Site', 'SIMULATED Site')]) {
      const flow = createAccountGuide('codebuddy', 'login')!
      expect(writes(flow.output(screen))).toEqual([])
      expect(() => flow.respond({ option: 'china' })).toThrow()
    }
  })
  it.each([codebuddyChinaBrowserRecorded, codebuddyIntlBrowserRecorded])('watches the recorded browser wait without collecting a code', screen => {
    const flow = createAccountGuide('codebuddy', 'login')!
    const events = [...screen].flatMap(char => flow.output(char))
    expect(guides(events)).toContainEqual(expect.objectContaining({ template: 'browser', link: expect.stringContaining('/login?') }))
    expect(events.filter(event => 'watch' in event)).toHaveLength(1)
    expect(writes(events)).toEqual([])
    expect(() => flow.respond({ code: 'SIMULATED' })).toThrow()
    expect(guides(flow.output('\x1b[2J\x1b[H' + codebuddyCancelledRecorded))[0]?.template).toBe('native')
    expect(guides(flow.output('\x1b[2J\x1b[H' + codebuddySitesRecorded))[0]?.template).toBe('choice')
  })
  it.each([codebuddyEnterpriseRecorded, codebuddyIoaRecorded])('keeps enterprise/iOA native without collecting secrets', screen => {
    const flow = createAccountGuide('codebuddy', 'login')!
    expect(guides(flow.output(screen))[0]?.template).toBe('native')
    expect(writes(flow.settled())).toEqual([])
    expect(() => flow.respond({ secret: 'SIMULATED' })).toThrow()
  })
  it.each(['http://copilot.tencent.com/login', 'https://copilot.tencent.com.evil.invalid/login', 'https://sub.copilot.tencent.com/login', 'https://evil@www.codebuddy.ai/login', 'https://codebuddy.ai/login'])('rejects unverified CodeBuddy URL %s', url => {
    const flow = createAccountGuide('codebuddy', 'login')!
    expect(guides(flow.output(codebuddyChinaBrowserRecorded.replace(/https:[^\r\n]+/, url)))[0]?.template).toBe('native')
  })
  it('CodeBuddy logout sends one command from the editor and never retries Enter on the login menu', () => {
    const flow = createAccountGuide('codebuddy', 'logout')!
    expect(writes(flow.output(codebuddyEditorRecorded))).toEqual([{ command: '/logout' }])
    expect(writes(flow.output('\x1b[2J\x1b[H' + codebuddyLogoutRecorded))).toEqual([])
    expect(flow.retryEnter()).toBe(false)
    expect(writes(flow.output(codebuddyEditorRecorded))).toEqual([])
    expect(flow.proves('logout', state('authenticated'), state('unknown'))).toBe(false)
  })
  it('CodeBuddy initial signed-out menu requires native state evidence and cannot start authorization', () => {
    const flow = createAccountGuide('codebuddy', 'logout')!
    const events = flow.output(codebuddySitesRecorded)
    expect(events).toContainEqual({ confirm: 'logout' })
    expect(events).not.toContainEqual({ finish: true })
    expect(writes(events)).toEqual([])
    expect(() => flow.respond({ option: 'china' })).toThrow()
    expect(flow.proves('logout', undefined, state('unauthenticated'))).toBe(true)
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
