import { describe, expect, it } from 'vitest'
import { FlowGuide, GuideResponseError, type GuideEvent } from '../src/host/account-guide/engine.ts'
import { createAccountGuide } from '../src/host/account-guide/flows.ts'
import { GUIDED_ACCOUNT_CLIS } from '../src/shared/account-links.ts'
import { CLAUDE_FLOW, CODEX_FLOW, GROK_FLOW, MIMO_FLOW, QODER_FLOW, ZCODE_FLOW } from '../src/host/account-guide/single-account.ts'

// Synthetic screens: the lines are those of real captures in isolated homes
// (2026-10-26); addresses and codes are made up.
const CODEX_LOGIN =
  'Starting local login server on http://localhost:1455.\r\nIf your browser did not open, navigate to this URL to authenticate:\r\n\r\n' +
  'https://auth.openai.com/oauth/authorize?response_type=code&state=synthetic\r\n'
const CLAUDE_LOGIN =
  'Opening browser to sign in…\r\nIf the browser didn\'t open, visit:  ' +
  '\x1b]8;;https://claude.com/cai/oauth/authorize?code=true&state=synthetic\x07https://claude.com/cai/oauth/authorize?code=true&state=synthetic\x1b]8;;\x07\r\n\r\nPaste code here if prompted > '
const GROK_LOGIN =
  'To sign in, open this URL in your browser:\r\n  https://accounts.x.ai/oauth2/device?user_code=SYNT-HETC\r\n\r\n' +
  'Confirm this code in your browser:\r\n  SYNT-HETC\r\n\r\nOnly continue with a code you requested. Don\'t share it with anyone.\r\n\r\nWaiting for authorization...'
const QODER_LOGIN =
  'Starting browser login...\r\nPlease open the following URL in your browser to sign in:\r\n' +
  'https://qoder.com/device/selectAccounts?nonce=synthetic\r\nWaiting for browser authorization...'
const MIMO_MENU = '┌ Add credential\r\n│\r\n◆ 选择服务商\r\n│ ● MiMo (推荐)\r\n│ ○ MiMo Auto (free)\r\n│ ○ 其他 Provider\r\n└'
const MIMO_CODE =
  'Browser didn\'t open? Use the url below to sign in:\r\nhttps://platform.xiaomimimo.com/authorize?state=synthetic\r\nPaste code here if prompted >'

const guides = (events: GuideEvent[]) => events.flatMap((event) => ('guide' in event ? [event.guide] : []))
const kinds = (events: GuideEvent[]) => events.map((event) => Object.keys(event)[0])

describe('guided login flows (synthetic screens)', () => {
  it('draws every guided CLI from a flow, and never the manage terminal', () => {
    for (const cli of GUIDED_ACCOUNT_CLIS) {
      expect(createAccountGuide(cli, 'login'), cli).toBeDefined()
      expect(createAccountGuide(cli, 'logout'), cli).toBeDefined()
      expect(createAccountGuide(cli, 'manage'), cli).toBeUndefined()
    }
    expect(createAccountGuide('kimi', 'login')).toBeUndefined()
  })

  it('shows the Codex browser step with its own sign-in page and confirms when codex exits', () => {
    const guide = new FlowGuide(CODEX_FLOW, { action: 'login' })
    const [shown] = guides(guide.output(CODEX_LOGIN))
    expect(shown).toMatchObject({ step: 'browser', template: 'browser', stage: 0 })
    expect(shown!.link).toBe('https://auth.openai.com/oauth/authorize?response_type=code&state=synthetic')
    // The local callback server address is not a sign-in page.
    expect(shown!.link).not.toContain('localhost')
    expect(guide.output(CODEX_LOGIN)).toEqual([])
    const exited = guide.exited()
    expect(kinds(exited)).toEqual(['guide', 'confirm'])
    expect(guides(exited)[0]).toMatchObject({ step: 'confirming', stage: 1 })
  })

  it('never links an address outside the CLI allowlist', () => {
    const guide = new FlowGuide(CODEX_FLOW, { action: 'login' })
    const [shown] = guides(
      guide.output('If your browser did not open, navigate to this URL to authenticate:\r\nhttps://auth.openai.com.evil.example/x\r\n'),
    )
    expect(shown!.link).toBeUndefined()
  })

  it('submits a pasted Claude code as typed text and Enter, then confirms', () => {
    const guide = new FlowGuide(CLAUDE_FLOW, { action: 'login' })
    expect(guides(guide.output(CLAUDE_LOGIN))[0]).toMatchObject({
      step: 'code',
      template: 'browserCode',
      link: 'https://claude.com/cai/oauth/authorize?code=true&state=synthetic',
    })
    const events = guide.respond({ code: '  synthetic-code#synthetic-state ' })
    expect(events[0]).toEqual({ write: 'synthetic-code#synthetic-state', enter: true })
    expect(kinds(events)).toEqual(['write', 'guide', 'confirm'])
    expect(JSON.stringify(guides(events))).not.toContain('synthetic-code')
    // A late answer during confirmation is refused rather than typed twice.
    expect(() => guide.respond({ code: 'again' })).toThrow(GuideResponseError)
  })

  it('pastes bracketed only when the CLI enabled bracketed paste', () => {
    const guide = new FlowGuide(CLAUDE_FLOW, { action: 'login' })
    guide.output('\x1b[?2004h' + CLAUDE_LOGIN)
    expect(guide.respond({ code: 'synthetic' })[0]).toEqual({ write: '\x1b[200~synthetic\x1b[201~', enter: true })
  })

  it('rejects answers the current step does not take, and multi-line values', () => {
    const guide = new FlowGuide(CLAUDE_FLOW, { action: 'login' })
    expect(() => guide.respond({ code: 'x' })).toThrow(GuideResponseError)
    guide.output(CLAUDE_LOGIN)
    expect(() => guide.respond({ option: 'anything' })).toThrow(GuideResponseError)
    expect(() => guide.respond({ code: 'line\r\n/logout' })).toThrow(GuideResponseError)
    expect(() => guide.respond({ code: '   ' })).toThrow(GuideResponseError)
  })

  it('shows the Grok device code and its xAI page only', () => {
    const guide = new FlowGuide(GROK_FLOW, { action: 'login' })
    const [shown] = guides(guide.output(GROK_LOGIN))
    expect(shown).toMatchObject({ step: 'device', template: 'deviceCode', code: 'SYNT-HETC', link: 'https://accounts.x.ai/oauth2/device?user_code=SYNT-HETC' })
  })

  it('finishes a sign-out at once when the CLI reports nothing to sign out', () => {
    for (const [flow, text] of [
      [GROK_FLOW, 'No cached session to log out of.'],
      [CODEX_FLOW, 'Not logged in\r\n'],
      [MIMO_FLOW, '┌ Remove credential\r\n│\r\n└ No credentials found'],
    ] as const) {
      const events = new FlowGuide(flow, { action: 'logout' }).output(text)
      expect(guides(events)[0]).toMatchObject({ step: 'notSignedIn', template: 'result' })
      expect(events.at(-1)).toEqual({ finish: true })
    }
  })

  it('confirms a sign-out the CLI does by itself once it exits', () => {
    const guide = new FlowGuide(ZCODE_FLOW, { action: 'logout' })
    guide.output('Logged out from Coding Plan accounts.\r\nCredentials: /synthetic/credentials.json\r\n')
    expect(kinds(guide.exited())).toEqual(['guide', 'confirm'])
    expect(guide.confirmed('logout')).toEqual([{ guide: expect.objectContaining({ step: 'loggedOut' }) }, { finish: true }])
  })

  it('follows ZCode with or without a browser opener', () => {
    for (const screen of [
      'Opening browser for BigModel authorization.\r\nFallback URL: https://open.bigmodel.cn/login?state=synthetic\r\n',
      'Open this URL to sign in:\r\nhttps://chat.z.ai/api/oauth/authorize?state=synthetic\r\n',
    ]) {
      const [shown] = guides(new FlowGuide(ZCODE_FLOW, { action: 'login' }).output(screen))
      expect(shown).toMatchObject({ step: 'browser' })
      expect(shown!.link).toMatch(/^https:\/\/(open\.bigmodel\.cn|chat\.z\.ai)\//)
    }
  })

  it('selects MiMo in its provider menu only when the user picks it, then takes the code', () => {
    const guide = new FlowGuide(MIMO_FLOW, { action: 'login' })
    expect(guides(guide.output(MIMO_MENU))[0]).toMatchObject({ step: 'provider', template: 'choice' })
    expect(guide.respond({ option: 'mimo' })).toEqual([{ write: '\r', enter: undefined }])
    expect(guides(guide.output(MIMO_CODE))[0]).toMatchObject({ step: 'code', stage: 1, link: 'https://platform.xiaomimimo.com/authorize?state=synthetic' })
    // A redraw of the menu never moves the window back.
    expect(guide.output(MIMO_MENU)).toEqual([])
  })

  // Simulated screens shaped like MiMo 0.1.15's `auth logout` (isolated probe, 2026-10-27).
  const mimoRemove = (rows: [string, boolean][]) =>
    '┌  Remove credential\r\n│\r\n◆  Select provider\r\n' +
    rows.map(([row, on]) => `│  ${on ? '●' : '○'}  ${row}\r\n`).join('') +
    '└\r\n'
  const writes = (events: GuideEvent[]) => events.flatMap((event) => ('write' in event ? [event.write] : []))

  it('signs out of MiMo by pressing Enter only on the highlighted Xiaomi row', () => {
    const guide = new FlowGuide(MIMO_FLOW, { action: 'logout' })
    const first = guide.output(mimoRemove([['Xiaomi  (api)', true]]))
    expect(writes(first)).toEqual(['\r'])
    expect(guides(first)[0]).toMatchObject({ step: 'loggingOut' })
  })

  it('moves past other MiMo credentials and never presses Enter on them', () => {
    const guide = new FlowGuide(MIMO_FLOW, { action: 'logout' })
    expect(writes(guide.output(mimoRemove([['DeepSeek  (api)', true], ['Xiaomi  (api)', false]])))).toEqual(['\x1b[B'])
    expect(writes(guide.output(mimoRemove([['DeepSeek  (api)', false], ['Xiaomi  (api)', true]])))).toEqual(['\r'])
  })

  it('hands a MiMo list without Xiaomi to the native terminal', () => {
    const guide = new FlowGuide(MIMO_FLOW, { action: 'logout' })
    expect(writes(guide.output(mimoRemove([['DeepSeek  (api)', true]])))).toEqual(['\x1b[B'])
    // One row: the arrow redraws the same row, nothing else is pressed and the quiet list is handed over.
    expect(writes(guide.output(mimoRemove([['DeepSeek  (api)', true]])))).toEqual([])
    const quiet = guide.settled()
    expect(writes(quiet)).toEqual([])
    expect(guides(quiet)[0]).toMatchObject({ template: 'native' })
  })

  it('asks for folder trust before a Qoder sign-out, then signs out a settled signed-in screen', () => {
    const guide = new FlowGuide(QODER_FLOW, { action: 'logout' })
    expect(guides(guide.output('Do you trust the files in this folder?\r\n❯ 1. Trust folder\r\n  2. Don\'t trust and exit'))[0]).toMatchObject({
      step: 'trust',
      template: 'trust',
    })
    expect(guide.settled()).toEqual([])
    expect(guide.respond({ confirm: 'trust' })).toEqual([{ write: '\r', enter: undefined }])
    guide.output('\x1b[2Jsynthetic main screen')
    expect(guide.settled()).toEqual([{ identify: true }])
    expect(guide.identified({ state: 'authenticated' })).toEqual([
      { guide: expect.objectContaining({ step: 'loggingOut' }) },
      { command: '/logout' },
    ])
    guide.output('1. Sign in to continue')
    expect(guide.retryEnter()).toBe(false)
  })

  it('never types for a signed-out Qoder TUI, and asks the user when it cannot tell', () => {
    const signedOut = new FlowGuide(QODER_FLOW, { action: 'logout' })
    expect(signedOut.output('❯ 1. Sign in to continue\r\n  2. Exit the application').at(-1)).toEqual({ finish: true })
    const unknown = new FlowGuide(QODER_FLOW, { action: 'logout' })
    unknown.output('synthetic')
    unknown.settled()
    expect(guides(unknown.identified(undefined))[0]).toMatchObject({ template: 'native' })
  })

  it('hands an unrecognised login screen to the native terminal', () => {
    const guide = new FlowGuide(CODEX_FLOW, { action: 'login' })
    guide.output('synthetic screen of a newer version')
    expect(guides(guide.settled())[0]).toMatchObject({ step: 'native', template: 'native' })
  })

  it('proves a login only with a signed-in account that is new or changed, or a clean exit', () => {
    const guide = new FlowGuide(CODEX_FLOW, { action: 'login' })
    const signedIn = { state: 'authenticated' as const, accountLabel: 'a@example.com' }
    expect(guide.proves('login', { state: 'unconfigured' }, signedIn)).toBe(true)
    expect(guide.proves('login', signedIn, signedIn)).toBe(false)
    expect(guide.proves('login', signedIn, signedIn, 0)).toBe(true)
    expect(guide.proves('login', signedIn, { ...signedIn, accountLabel: 'b@example.com' })).toBe(true)
    expect(guide.proves('login', undefined, { state: 'unconfigured' }, 0)).toBe(false)
    expect(guide.proves('logout', signedIn, { state: 'unconfigured' })).toBe(true)
    expect(guide.proves('logout', signedIn, undefined)).toBe(false)
  })
})

describe('removable login handles (simulated stores)', () => {
  it('模拟 Nous 退出后菜单可添加，重新登录后使用同一条原生账号记录', async () => {
    const { loginProviders, isLoginProvider } = await import('../src/host/account-guide/providers.ts')
    const { createAccountGuide } = await import('../src/host/account-guide/flows.ts')
    expect(isLoginProvider('hermes', 'nous')).toBe(true)
    expect(loginProviders('hermes', [])?.find((item) => item.id === 'nous')).toEqual({ id: 'nous', label: 'Nous' })
    expect(loginProviders('hermes', [{ id: 'hermes:nous:a1b2c3', providerLabel: 'Nous', authMethod: 'oauth' }])?.find((item) => item.id === 'nous'))
      .toEqual({ id: 'nous', label: 'Nous', signedIn: true })
    // The Nous device flow must never ask for an API key or auto-answer native shared import.
    const guide = createAccountGuide('hermes', 'login', { provider: 'nous' })!
    expect(guide.output('Import these credentials? [Y/n]: ')).toEqual([])
    expect(guides(guide.settled())[0]).toMatchObject({ template: 'native' })
    expect(guide.proves('login', { state: 'unconfigured' }, { state: 'authenticated', logins: [{ id: 'hermes:nous:a1b2c3', providerLabel: 'Nous', authMethod: 'oauth' }] }, 0)).toBe(true)
    expect(guide.proves('login', { state: 'unconfigured' }, { state: 'unconfigured' }, 0)).toBe(false)
    expect(createAccountGuide('hermes', 'login', { provider: 'deepseek' })).toBeDefined()
  })
  it('keeps two Hermes keys of one provider as two rows with their pool ids', async () => {
    const { projectHermesIdentity } = await import('../src/host/hermes-accounts.ts')
    const identity = projectHermesIdentity({
      credential_pool: {
        deepseek: ['a1b2c3', 'd4e5f6'].map((id) => ({
          id,
          auth_type: 'api_key',
          source: 'manual',
          access_token: `simulated-deepseek-key-${id}`,
        })),
      },
    })
    expect(identity?.logins?.map((login) => login.id)).toEqual(['hermes:deepseek:a1b2c3', 'hermes:deepseek:d4e5f6'])
    expect(JSON.stringify(identity)).not.toContain('simulated-deepseek-key')
  })

  it('never builds a handle from a malformed provider or entry id', async () => {
    const { accountLoginId, parseAccountLoginId } = await import('../src/shared/account-links.ts')
    expect(accountLoginId('hermes', 'deepseek', '../x')).toBeUndefined()
    expect(accountLoginId('opencode', 'Deep Seek')).toBeUndefined()
    expect(parseAccountLoginId('opencode:deepseek')).toEqual({ cli: 'opencode', provider: 'deepseek' })
    expect(parseAccountLoginId('hermes:deepseek:a1b2c3:extra')).toBeUndefined()
  })

  it('marks a window provider as signed in only from its own handle', async () => {
    const { loginProviders } = await import('../src/host/account-guide/providers.ts')
    const providers = loginProviders('opencode', [
      { providerLabel: 'DeepSeek', authMethod: 'api', id: 'opencode:deepseek' },
      { providerLabel: 'OpenRouter', authMethod: 'api' },
    ])
    expect(providers?.find((item) => item.id === 'deepseek')?.signedIn).toBe(true)
    expect(providers?.find((item) => item.id === 'openrouter')?.signedIn).toBeUndefined()
    expect(loginProviders('grok', [])).toBeUndefined()
  })
})

describe('multi-account flows (synthetic screens)', () => {
  it('waits through the OpenCode catalog load, then asks for a key', async () => {
    const { OPENCODE_FLOW } = await import('../src/host/account-guide/multi-account.ts')
    const guide = new FlowGuide(OPENCODE_FLOW, { action: 'login', provider: 'deepseek' })
    expect(guides(guide.output('┌ Add credential'))[0]).toMatchObject({ step: 'loading', template: 'waiting' })
    expect(guide.settled()).toEqual([])
    expect(guides(guide.output('\r\n◆ Enter your API key\r\n│ _'))[0]).toMatchObject({ step: 'key', template: 'secret' })
    expect(guide.respond({ secret: 'simulated' })[0]).toEqual({ write: 'simulated', enter: true })
  })

  it('proves a provider login by that provider only, and a removal by the target only', async () => {
    const { HERMES_FLOW } = await import('../src/host/account-guide/multi-account.ts')
    const row = (id: string) => ({ providerLabel: id, authMethod: 'api' as const, id })
    const add = new FlowGuide(HERMES_FLOW, { action: 'login', provider: 'deepseek' })
    const before = { state: 'authenticated' as const, logins: [row('hermes:deepseek:a1b2c3')] }
    expect(add.proves('login', before, { ...before, logins: [...before.logins, row('hermes:openrouter:000001')] })).toBe(false)
    expect(add.proves('login', before, { ...before, logins: [...before.logins, row('hermes:deepseek:d4e5f6')] })).toBe(true)
    const remove = new FlowGuide(HERMES_FLOW, { action: 'logout', login: 'hermes:deepseek:a1b2c3' })
    expect(remove.proves('logout', before, before)).toBe(false)
    expect(remove.proves('logout', before, { state: 'unavailable' })).toBe(false)
    expect(remove.proves('logout', before, { state: 'unconfigured' })).toBe(true)
  })
})
