import { describe, expect, it } from 'vitest'
import { FlowGuide, GuideResponseError, type GuideEvent } from '../src/host/account-guide/engine.ts'
import { OMP_FLOW } from '../src/host/account-guide/omp-flow.ts'

// 模拟画面：取自 2026-10-27 OMP 16.4.4 隔离 PTY 的实测字节片段。
// 账号全为模拟凭据；OAuth 地址、设备码与额外列表行使用模拟值。
// 完整原始字节及按键轨迹：scratchpad/probes/omp-window/*.bin / *.frames.json。
const READY = "\u001b[0m\u001b[K\u001b[38;2;107;114;128m│\u001b[39m                          \u001b[38;2;107;114;128m│\u001b[39m \u001b[38;2;107;114;128m/\u001b[39;38;2;156;163;176m for commands\u001b[39m                                                        \u001b[38;2;107;114;128m│\u001b[39m\u001b[0m\r\n"
const MENU = "\u001b[1mSelect OpenRouter account to log out:\u001b[22m\u001b[0m\u001b[K\r\n"
const API_FIRST = "\u001b[0m\u001b[K\u001b[38;2;0;180;255m❯ API key #1\u001b[39;38;2;156;163;176m (active)\u001b[39;38;2;107;114;128m  stored API key #1\u001b[39m\u001b[0m\r\n"
const API_SECOND = "  API key #2\u001b[38;2;156;163;176m (active)\u001b[39;38;2;107;114;128m  stored API key #2\u001b[39m\u001b[0m\u001b[K\r\n"
const API_DOWN = "  API key #1\u001b[38;2;108;108;108m (active)\u001b[39;38;2;118;118;118m  stored API key #1\u001b[39m\u001b[0m\u001b[K\r\n\u001b[0m\u001b[K\u001b[38;2;90;128;128m❯ API key #2\u001b[39;38;2;108;108;108m (active)\u001b[39;38;2;118;118;118m  stored API key #2\u001b[39m\u001b[0m\r\n"
const OAUTH_MENU = "\u001b[1mSelect Anthropic (Claude Pro/Max) account to log out:\u001b[22m\u001b[0m\u001b[K\r\n"
const OAUTH_FIRST = "\u001b[0m\u001b[K\u001b[38;2;0;180;255m❯ simulated-4@example.invalid\u001b[39;38;2;156;163;176m (active)\u001b[39;38;2;107;114;128m  oauth #4\u001b[39m\u001b[0m\r\n"
const OAUTH_SECOND = "  simulated-5@example.invalid\u001b[38;2;107;114;128m  oauth #5\u001b[39m\u001b[0m\u001b[K\r\n"
const OAUTH_DOWN = "  simulated-4@example.invalid\u001b[38;2;108;108;108m (active)\u001b[39;38;2;118;118;118m  oauth #4\u001b[39m\u001b[0m\u001b[K\r\n\u001b[0m\u001b[K\u001b[38;2;90;128;128m❯ simulated-5@example.invalid\u001b[39;38;2;118;118;118m  oauth #5\u001b[39m\u001b[0m\r\n"
const OPENROUTER_KEY = " \u001b[38;2;255;179;71mPaste your OpenRouter API key\u001b[39m                                                                                                                                                                          \u001b[0m\r\n"
const DEEPSEEK_KEY = " \u001b[38;2;255;179;71mPaste your DeepSeek API key\u001b[39m                                                                                                                                                                            \u001b[0m\r\n"

const BROWSER = '\x1b[38;2;107;114;128mhttps://claude.ai/oauth/authorize?state=simulated\x1b[39m\r\n' +
  'Tip: You can complete pairing with /login <redirect URL>.\r\nWaiting for browser authentication...\r\n'
const DEVICE = '\x1b[38;2;107;114;128mhttps://auth.openai.com/codex/device\x1b[39m\r\nEnter code: TEST-12345\r\nWaiting for browser authorization (code: TEST-12345)…\r\n'
const DOMAIN = '\x1b[38;2;255;179;71mGitHub Enterprise URL/domain (blank for github.com)\x1b[39m\r\n'
const guides = (events: GuideEvent[]) => events.flatMap((event) => 'guide' in event ? [event.guide] : [])
const writes = (events: GuideEvent[]) => events.flatMap((event) => 'write' in event ? [event.write] : [])
const logout = (id = '2', provider = 'openrouter', source = 'native') =>
  new FlowGuide(OMP_FLOW, { action: 'logout', login: `omp:${provider}:${source}.${id}` })
const login = (provider = 'openrouter') => new FlowGuide(OMP_FLOW, { action: 'login', provider })

// 模拟画面：提示取自 2026-10-29/30 Windows OMP 18.8.7 实采；行号为模拟值。
// 删除启动日志路径、图标动画及授权链接；输入值仅为模拟值。
const WINDOWS_READY = '\x1b[14;1H╰─ ⇧⇥ to change thinking effort\r\n'
const WINDOWS_BROWSER_INPUT = '\x1b[30;1H│ Waiting for browser authentication... │\r\n' +
  '\x1b[32;1H│ Paste the authorization code (or full redirect URL), then press ⏎: │\r\n'

describe('OMP 18.8.7 Windows ConPTY（模拟画面）', () => {
  it('waits through native model discovery and random welcome tips until the editor is ready', () => {
    const guide = login('deepseek')
    expect(writes(guide.output('Still starting after 10s — phase: createAgentSession > resolveModelDiscoveryFallback\r\n'))).toEqual([])
    expect(writes(guide.output('Tip: Spaghetti code? Try complaining with /omfg\r\n'))).toEqual([])
    expect(writes(guide.output('Tip: Type `/` at the start of your prompt to browse every command\r\n'))).toEqual([])
    expect(writes(guide.output(WINDOWS_READY))).toEqual(['/login deepseek\r'])
    expect(writes(guide.output(WINDOWS_READY))).toEqual([])
    const events = guide.output('\x1b[26;1H│ Paste your DeepSeek API key │\r\n')
    expect(guides(events).at(-1)?.template).toBe('secret')
    expect(writes(events)).toEqual([])
  })

  it('also recognizes the new editor footer for a precisely identified logout', () => {
    expect(writes(logout('2').output(WINDOWS_READY))).toEqual(['/logout openrouter\r'])
    expect(writes(new FlowGuide(OMP_FLOW, { action: 'login' }).output(WINDOWS_READY))).toEqual([])
  })

  it.each([false, true])('pastes only the code into the native manual input, bracketed=%s', (bracketed) => {
    const guide = login('openai-codex')
    const events = guide.output((bracketed ? '\x1b[?2004h' : '') + WINDOWS_BROWSER_INPUT)
    expect(guides(events).at(-1)).toMatchObject({ step: 'browser-input', template: 'browserCode' })
    expect(events).toContainEqual({ watch: 'login' })
    expect(writes(events)).toEqual([])
    const result = guide.respond({ code: ' synthetic-code ' })
    expect(result[0]).toEqual({ write: bracketed ? '\x1b[200~synthetic-code\x1b[201~' : 'synthetic-code', enter: true })
    expect(result).toContainEqual({ confirm: 'login' })
    expect(JSON.stringify(guides(result))).not.toContain('synthetic-code')
  })

  it('switches from the waiting message to direct input when ConPTY draws the prompt later', () => {
    const guide = login('openai-codex')
    guide.output('Waiting for browser authentication...\r\n')
    expect(guides(guide.output(WINDOWS_BROWSER_INPUT)).at(-1)?.step).toBe('browser-input')
    expect(guide.respond({ code: 'http://localhost/callback?code=synthetic' })[0]).toEqual({
      write: 'http://localhost/callback?code=synthetic', enter: true,
    })
  })
})

// These two native rows are actual captures, including styles and partial redraws.
const FIRST_SCREEN = MENU + API_FIRST + API_SECOND

describe('OMP 16.4.4 账号窗口（模拟画面，实测字节）', () => {
  it('waits for readiness, then submits the selected provider once in one write', () => {
    const guide = logout('2', 'openrouter', 'plugin')
    expect(writes(guide.output('omp v16.4.4'))).toEqual([])
    expect(writes(guide.output(READY))).toEqual(['/logout openrouter\r'])
    expect(writes(guide.output(READY))).toEqual([])
    const add = login('openai-codex-device')
    expect(writes(add.output(READY))).toEqual(['/login openai-codex-device\r'])
    expect(writes(add.output(READY))).toEqual([])
  })

  it.each(['omp:openrouter', 'pi:openrouter:native.2', 'omp:openrouter:native.x', 'omp:openrouter:2', 'omp:openrouter:native.0'])(
    'never sends a logout command for malformed or foreign handle %s', (id) => {
      const guide = new FlowGuide(OMP_FLOW, { action: 'logout', login: id })
      expect(writes(guide.output(READY + FIRST_SCREEN))).toEqual([])
    },
  )

  it('moves down only after seeing row 1, then enters row 2 on its partial redraw', () => {
    const guide = logout()
    guide.output(READY)
    expect(writes(guide.output(FIRST_SCREEN))).toEqual(['\x1b[B'])
    const events = guide.output(API_DOWN)
    expect(writes(events)).toEqual(['\r'])
    expect(events).toContainEqual({ confirm: 'logout' })
    expect(guide.output(API_DOWN)).toEqual([])
  })

  it('walks multiple highlighted rows until the target, without using list position', () => {
    const guide = logout('7')
    expect(writes(guide.output(FIRST_SCREEN))).toEqual(['\x1b[B'])
    expect(writes(guide.output(API_DOWN))).toEqual(['\x1b[B'])
    // 模拟额外第 7 号条目，使用实测的第二行重绘样式。
    expect(writes(guide.output(API_DOWN.replaceAll('#2', '#7')))).toEqual(['\r'])
  })

  it('enters immediately when the target is already highlighted', () => {
    const events = logout('1').output(FIRST_SCREEN)
    expect(writes(events)).toEqual(['\r'])
    expect(events).toContainEqual({ confirm: 'logout' })
  })

  it('selects OAuth by its native credential id, not its email or API position', () => {
    const guide = logout('5', 'anthropic')
    expect(writes(guide.output(OAUTH_MENU + OAUTH_FIRST + OAUTH_SECOND))).toEqual(['\x1b[B'])
    expect(writes(guide.output(OAUTH_DOWN))).toEqual(['\r'])
    expect(writes(logout('4', 'anthropic').output(OAUTH_MENU + OAUTH_FIRST + OAUTH_SECOND))).toEqual(['\r'])
  })

  it('hands a wrapped list with no target to the native terminal without pressing Enter', () => {
    const guide = logout('99')
    expect(writes(guide.output(FIRST_SCREEN))).toEqual(['\x1b[B'])
    expect(writes(guide.output(API_DOWN))).toEqual(['\x1b[B'])
    const events = guide.output(API_FIRST)
    expect(writes(events)).toEqual([])
    expect(guides(events).at(-1)?.template).toBe('native')
    expect(writes(guide.output(API_DOWN))).toEqual([])
  })

  it('does not repeat Down before the highlight moves, even across output chunks', () => {
    const guide = logout()
    expect(writes(guide.output(FIRST_SCREEN))).toEqual(['\x1b[B'])
    expect(writes(guide.output(API_FIRST))).toEqual([])
    expect(writes(guide.output(API_SECOND))).toEqual([])
    const pivot = API_DOWN.indexOf('❯')
    expect(writes(guide.output(API_DOWN.slice(0, pivot)))).toEqual([])
    expect(writes(guide.output(API_DOWN.slice(pivot)))).toEqual(['\r'])
  })

  it('ignores non-highlighted and parenthesized row details', () => {
    const guide = logout()
    expect(writes(guide.output(MENU + API_SECOND))).toEqual([])
    expect(writes(guide.output('\r(API key #2) stored API key #2\r\n'))).toEqual([])
    expect(writes(guide.output('\r2 API key #2 stored API key #2\r\n'))).toEqual([])
    expect(writes(guide.output(API_DOWN))).toEqual(['\r'])
  })

  it.each(['Logout skipped: account no longer exists', 'Successfully logged out API key #2 from openrouter'])(
    'confirms native account state for %s instead of declaring terminal-text success', (text) => {
      const guide = logout()
      const events = guide.output(text)
      expect(events).toContainEqual({ confirm: 'logout' })
      expect(events).not.toContainEqual({ finish: true })
      const before = { state: 'authenticated' as const, logins: [{ id: 'omp:openrouter:native.2', providerLabel: 'OpenRouter', authMethod: 'api' as const }] }
      expect(guide.proves('logout', before, before)).toBe(false)
      expect(guide.proves('logout', before, { state: 'unconfigured', logins: [] })).toBe(true)
    },
  )

  it.each([['openrouter', OPENROUTER_KEY], ['deepseek', DEEPSEEK_KEY]])('shows a secret template for %s and never emits the key in a guide', (provider, screen) => {
    const guide = login(provider)
    expect(guides(guide.output('\x1b[?2004h' + screen))[0]?.template).toBe('secret')
    const events = guide.respond({ secret: '  simulated-key-not-real  ' })
    expect(events[0]).toEqual({ write: '\x1b[200~simulated-key-not-real\x1b[201~', enter: true })
    expect(events).toContainEqual({ confirm: 'login' })
    expect(JSON.stringify(guides(events))).not.toContain('simulated-key-not-real')
    expect(JSON.stringify(guides(guide.output('simulated-key-not-real')))).not.toContain('simulated-key-not-real')
  })

  it('only allows github.com at the Copilot domain prompt', () => {
    const guide = login('github-copilot')
    expect(guides(guide.output(DOMAIN))[0]).toMatchObject({ template: 'choice', options: [{ id: 'github.com', label: 'github.com' }] })
    expect(() => guide.respond({ option: 'enterprise.example' })).toThrow(GuideResponseError)
    expect(() => guide.respond({ secret: 'simulated' })).toThrow(GuideResponseError)
    expect(guide.respond({ option: 'github.com' })).toEqual([{ write: '\r', enter: undefined }])
  })

  it('rejects answers from another step and multiline values', () => {
    const guide = login()
    expect(() => guide.respond({ secret: 'simulated' })).toThrow(GuideResponseError)
    guide.output(OPENROUTER_KEY)
    for (const response of [{ code: 'simulated' }, { option: 'github.com' }, { confirm: 'trust' as const }, { secret: 'x\r/logout' }, { secret: ' ' }]) {
      expect(() => guide.respond(response)).toThrow(GuideResponseError)
    }
    const device = login('kimi-code')
    device.output(DEVICE)
    expect(() => device.respond({ code: 'simulated' })).toThrow(GuideResponseError)
  })

  it('watches browser and device authorization without submitting or requiring process exit', () => {
    const browser = login('anthropic').output(BROWSER)
    expect(guides(browser)).toContainEqual(expect.objectContaining({ template: 'browserCode' }))
    expect(browser).toContainEqual({ watch: 'login' })
    expect(browser).not.toContainEqual({ confirm: 'login' })
    for (const provider of ['openai-codex-device', 'kimi-code', 'github-copilot']) {
      const guide = login(provider)
      const events = guide.output(DEVICE)
      expect(guides(events)).toContainEqual(expect.objectContaining({ template: 'deviceCode', code: 'TEST-12345' }))
      expect(events).toContainEqual({ watch: 'login' })
      expect(events).not.toContainEqual({ confirm: 'login' })
      expect(guide.output(DEVICE)).toEqual([])
    }
  })

  it('translates a browser fallback into /login plus the pasted value and Enter', () => {
    const guide = login('anthropic')
    guide.output(BROWSER)
    const events = guide.respond({ code: '  http://localhost/callback?code=simulated  ' })
    expect(events[0]).toEqual({ write: '/login http://localhost/callback?code=simulated', enter: true })
    expect(events).toContainEqual({ confirm: 'login' })
    expect(JSON.stringify(guides(events))).not.toContain('code=simulated')
  })

  it('keeps the browser template visible while checking native state', () => {
    const guide = login('anthropic')
    expect(guides(guide.output(BROWSER)).at(-1)?.template).toBe('browserCode')
    expect(guide.output(BROWSER)).toEqual([])
  })

  it('accepts the browser fallback while checking native state', () => {
    const guide = login('anthropic')
    guide.output(BROWSER)
    expect(guide.respond({ code: 'http://localhost/callback?code=simulated' })[0]).toEqual({
      write: '/login http://localhost/callback?code=simulated', enter: true,
    })
  })

  it('keeps the device code visible while checking native state', () => {
    const guide = login('openai-codex-device')
    expect(guides(guide.output(DEVICE)).at(-1)).toMatchObject({ template: 'deviceCode', code: 'TEST-12345' })
    expect(guide.confirmed('login')).toContainEqual({ finish: true })
    expect(guide.confirmed('login')).toEqual([])
    expect(guide.unconfirmed('login')).toEqual([])
  })

  it('confirms the stored Codex provider, not the device-login alias or another provider', () => {
    const guide = new FlowGuide(OMP_FLOW, { action: 'login', provider: 'openai-codex-device', stores: 'openai-codex' })
    const row = (id: string) => ({ id, providerLabel: '模拟', authMethod: 'oauth' as const })
    const before = { state: 'authenticated' as const, logins: [row('omp:openai-codex:plugin.1')] }
    expect(guide.proves('login', before, before)).toBe(false)
    expect(guide.proves('login', before, { ...before, logins: [...before.logins, row('omp:anthropic:plugin.2')] })).toBe(false)
    expect(guide.proves('login', before, { ...before, logins: [...before.logins, row('omp:openai-codex:plugin.2')] })).toBe(true)
  })
})
