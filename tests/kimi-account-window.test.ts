import { describe, expect, it } from 'vitest'
import { FlowGuide, GuideResponseError, type GuideEvent } from '../src/host/account-guide/engine.ts'
import { createAccountGuide } from '../src/host/account-guide/flows.ts'
import { KIMI_FLOW, kimiOAuthRow } from '../src/host/account-guide/kimi-flow.ts'

/*
 * 模拟画面 (simulated screens): the byte sequences are those Kimi Code drew in isolated
 * homes with simulated credentials on 2026-10-27 (200×60 PTY; see doc/tasks.md). Folder
 * paths, device codes and links are made up; nothing here was ever submitted.
 */
const END = '\x1b[0m\x1b]8;;\x07\r\r\n'
const RULE = '─'.repeat(198)
const rule = ` \x1b[38;5;32m${RULE}\x1b[39m${END}`

// `kimi login --region mainland-cn|global` (stderr, then it waits for the browser).
const deviceLogin = (host: string, code: string) =>
  `\r\nOpening browser for Kimi device login: https://${host}/code/authorize_device?user_code=${code}\r\n` +
  `If the browser did not open, paste the URL above and enter code: ${code}\r\n` +
  'Code expires in 1800s.\r\nWaiting for authorization to complete…\r\n'

// Bare TUI in the plugin's empty account folder (2.3.3 wording; 2.1.1 says "Trust this folder" / "Don't trust").
const TRUST =
  '\x1b[?2026h' +
  rule +
  ` \x1b[38;5;32m\x1b[1m Trust this folder?\x1b[22m\x1b[39m${END}` +
  ` \x1b[38;5;240m ↑↓ navigate · Enter select · Esc exit\x1b[39m${END}` +
  ` ${END}  \x1b[38;5;234m/synthetic/account-runtime/kimi-x\x1b[39m${END} ${END}` +
  `  \x1b[38;5;240mNo project integrations or instructions to activate.\x1b[39m${END}` +
  ` \x1b[38;5;32m  ❯ \x1b[39m\x1b[38;5;32m\x1b[1mTrust and continue\x1b[22m\x1b[39m${END}` +
  ` \x1b[38;5;238m    \x1b[39m\x1b[38;5;234mExit\x1b[39m${END}` +
  ` \x1b[38;5;32m${RULE}\x1b[39m\x1b[0m\x1b]8;;\x07\x1b[?2026l\x1b[?25l`
const READY =
  '\x1b[?2026h\x1b[13A\r\x1b[2K \x1b[38;5;242m│\x1b[39m    ▐█▛█▛█▌     Welcome to Kimi Code!' +
  ' '.repeat(120) +
  `\x1b[38;5;242m│\x1b[39m${END}` +
  `\x1b[2K${' '.repeat(188)}\x1b[38;5;234mcontext: 0%\x1b[39m\x1b[0m\x1b]8;;\x07\x1b[?2026l`

type Row = { label: string; description: string; current?: boolean }
const OAUTH: Row = { label: 'Kimi Code', description: 'OAuth login' }
const DEEPSEEK: Row = { label: 'deepseek', description: 'https://api.deepseek.com/v1' }
const MOONSHOT: Row = { label: 'moonshot-cn', description: 'https://api.moonshot.cn/v1' }
const current = ' \x1b[38;5;29m← current\x1b[39m'
const label = (row: Row, selected: boolean) =>
  selected
    ? `\x1b[2K \x1b[38;5;32m  ❯ \x1b[39m\x1b[38;5;32m\x1b[1m${row.label}\x1b[22m\x1b[39m${row.current ? current : ''}`
    : `\x1b[2K \x1b[38;5;238m    \x1b[39m\x1b[38;5;234m${row.label}\x1b[39m${row.current ? current : ''}`
const description = (row: Row) => `\x1b[2K \x1b[38;5;240m    ${row.description}\x1b[39m${END}`

/** Kimi's whole `/logout` picker, as first drawn. */
const picker = (rows: Row[], selected: number) =>
  `\x1b[?2026h\x1b[2K${rule}` +
  `\x1b[2K \x1b[38;5;32m\x1b[1m Select a provider to log out\x1b[22m\x1b[39m${END}` +
  `\x1b[2K \x1b[38;5;240m ↑↓ navigate · Enter select · Esc cancel\x1b[39m${END}\x1b[2K ${END}` +
  rows.map((row, index) => label(row, index === selected) + END + description(row)).join('') +
  `\x1b[2K ${END}\x1b[2K${rule}\x1b[?2026l`
/** The redraw after the moves up: from the Kimi Code row down to the row that lost the highlight. */
const MOVED_UP =
  '\x1b[?2026h\x1b[9A\r' +
  label(OAUTH, true) +
  END +
  description(OAUTH) +
  label({ ...DEEPSEEK, current: true }, false) +
  '\x1b[0m\x1b]8;;\x07\x1b[?2026l\x1b[?25l'
const NOTHING = '\x1b[?2026h\x1b[2A\r\x1b[2K   \x1b[38;5;238mNothing to logout.\x1b[39m' + ' '.repeat(55)

const UP = '\x1b[A'.repeat(40)
const guides = (events: GuideEvent[]) => events.flatMap((event) => ('guide' in event ? [event.guide] : []))
const writes = (events: GuideEvent[]) => events.flatMap((event) => ('write' in event ? [event.write] : []))
const kinds = (events: GuideEvent[]) => events.map((event) => Object.keys(event)[0])

/** A sign-out of the managed login that the user already trusted in the window. */
function trusted() {
  const guide = createAccountGuide('kimi', 'logout', { login: 'kimi:kimi-code' })!
  guide.output(TRUST)
  expect(writes(guide.respond({ confirm: 'trust' }))).toEqual(['\r'])
  expect(writes(guide.output(READY))).toEqual(['/logout\r'])
  return guide
}

describe('Kimi account window (模拟画面)', () => {
  it('guides only a region picked, or one login removed, in the account window', () => {
    expect(createAccountGuide('kimi', 'login')).toBeUndefined()
    expect(createAccountGuide('kimi', 'logout')).toBeUndefined()
    expect(createAccountGuide('kimi', 'manage', { login: 'kimi:kimi-code' })).toBeUndefined()
    expect(createAccountGuide('kimi', 'login', { provider: 'kimi-code-cn', stores: 'kimi-code' })).toBeInstanceOf(FlowGuide)
  })

  it.each([
    ['kimi-code-cn', 'www.kimi.com', 'SYNT-HETC'],
    ['kimi-code-global', 'www.kimi.ai', 'AB12-CD34'],
  ])('shows the %s device code and Kimi page, typing nothing', (provider, host, code) => {
    const guide = createAccountGuide('kimi', 'login', { provider, stores: 'kimi-code' })!
    const events = guide.output(deviceLogin(host, code))
    expect(writes(events)).toEqual([])
    const [shown] = guides(events)
    expect(shown).toMatchObject({ step: 'device', template: 'deviceCode', stage: 0, code })
    expect(shown!.link).toBe(`https://${host}/code/authorize_device?user_code=${code}`)
    expect(() => guide.respond({ code })).toThrow(GuideResponseError)
    const exited = guide.exited(0)
    expect(kinds(exited)).toEqual(['guide', 'confirm'])
    expect(guides(exited)[0]).toMatchObject({ step: 'confirming', stage: 1 })
  })

  it('never links a device page outside the Kimi hosts', () => {
    const guide = createAccountGuide('kimi', 'login', { provider: 'kimi-code-cn', stores: 'kimi-code' })!
    const [shown] = guides(guide.output(deviceLogin('www.kimi.com.evil.example', 'SYNT-HETC')))
    expect(shown).toMatchObject({ step: 'device', code: 'SYNT-HETC' })
    expect(shown!.link).toBeUndefined()
  })

  it('模拟 Windows ConPTY 实采提示分片：整行到齐前不显示截断的验证码', () => {
    // Windows isolated ConPTY, 2026-10-29: wording/CRLF from the native login;
    // URL/code are synthetic replacements. Chunk boundaries exercise streaming,
    // not a claim that the real authorization code had these values or boundaries.
    const guide = createAccountGuide('kimi', 'login', { provider: 'kimi-code-global', stores: 'kimi-code' })!
    const prefix = '\r\nOpening browser for Kimi device login: https://www.kimi.ai/code/authorize_device?user_code=SYNT-HETC\r\n' +
      'If the browser did not open, paste the URL above and enter code: '
    for (const chunk of [prefix, 'SYNT', '-', 'HE', 'TC', '\r']) {
      const events = guide.output(chunk)
      expect(guides(events).some((shown) => shown.template === 'deviceCode')).toBe(false)
      expect(writes(events)).toEqual([])
    }
    const events = guide.output('\nCode expires in 1800s.\r\nWaiting for authorization to complete…\r\n')
    expect(guides(events)).toMatchObject([{ template: 'deviceCode', code: 'SYNT-HETC' }])
    expect(writes(events)).toEqual([])
  })

  it('proves a region login only by the Kimi Code login it files', () => {
    const guide = createAccountGuide('kimi', 'login', { provider: 'kimi-code-cn', stores: 'kimi-code' })!
    const api = { providerLabel: 'DeepSeek', authMethod: 'api' as const, id: 'kimi:deepseek' }
    const oauth = { providerLabel: 'Kimi Code', authMethod: 'oauth' as const, id: 'kimi:kimi-code' }
    const before = { state: 'configured' as const, logins: [api] }
    expect(guide.proves('login', before, { state: 'configured', logins: [api] }, 0)).toBe(false)
    expect(guide.proves('login', before, { state: 'authenticated', logins: [oauth, api] }, 1)).toBe(true)
  })

  it('waits for the user to trust the folder: no key is typed for them', () => {
    const guide = createAccountGuide('kimi', 'logout', { login: 'kimi:kimi-code' })!
    const events = guide.output(TRUST)
    expect(guides(events)).toMatchObject([{ step: 'trust', template: 'trust', tone: 'action' }])
    expect(writes(events)).toEqual([])
    expect(writes(guide.settled())).toEqual([])
    expect(writes(guide.output(TRUST))).toEqual([])
    // Answers of other steps, a decline and a skipped step are refused.
    expect(() => guide.respond({ option: 'trust' })).toThrow(GuideResponseError)
    expect(() => guide.respond({ code: 'SYNT-HETC' })).toThrow(GuideResponseError)
    expect(() => guide.respond({ confirm: 'decline' })).toThrow(GuideResponseError)
    expect(guide.respond({ confirm: 'trust' })).toEqual([{ write: '\r', enter: undefined }])
  })

  it('refuses window answers before any step and once the list is open', () => {
    const guide = createAccountGuide('kimi', 'logout', { login: 'kimi:kimi-code' })!
    expect(() => guide.respond({ confirm: 'trust' })).toThrow(GuideResponseError)
    const ready = trusted()
    expect(() => ready.respond({ confirm: 'trust' })).toThrow(GuideResponseError)
    ready.output(picker([OAUTH, DEEPSEEK], 1))
    expect(() => ready.respond({ confirm: 'trust' })).toThrow(GuideResponseError)
    expect(() => ready.respond({ option: 'kimi-code' })).toThrow(GuideResponseError)
  })

  it('opens /logout once, then presses Enter on a highlighted Kimi Code row', () => {
    const guide = trusted()
    expect(writes(guide.output(READY))).toEqual([])
    const events = guide.output(picker([OAUTH, DEEPSEEK, MOONSHOT], 0))
    expect(writes(events)).toEqual([UP, '\r'])
    expect(kinds(events).slice(-1)).toEqual(['confirm'])
    expect(guides(events).map((item) => item.step)).toEqual(['select', 'loggingOut'])
    expect(guide.output(MOVED_UP)).toEqual([])
    expect(guide.proves('logout', undefined, { state: 'configured', logins: [{ providerLabel: 'DeepSeek', authMethod: 'api', id: 'kimi:deepseek' }] })).toBe(true)
  })

  it('moves up from the current model provider and presses Enter only once Kimi Code is highlighted', () => {
    const guide = trusted()
    // The list opens on the current model's provider; Kimi never wraps, so the plugin moves up.
    const opened = guide.output(picker([OAUTH, { ...DEEPSEEK, current: true }, MOONSHOT], 1))
    expect(writes(opened)).toEqual([UP])
    expect(writes(guide.output(MOVED_UP))).toEqual(['\r'])
  })

  it('hands a list over when the moves up never land, pressing nothing else', () => {
    const guide = trusted()
    expect(writes(guide.output(picker([OAUTH, { ...DEEPSEEK, current: true }, MOONSHOT], 1)))).toEqual([UP])
    const quiet = guide.settled()
    expect(writes(quiet)).toEqual([])
    expect(guides(quiet)[0]).toMatchObject({ template: 'native' })
  })

  it('waits for a highlighted row cut by a read before pressing anything', () => {
    const guide = trusted()
    expect(writes(guide.output(picker([OAUTH, { ...DEEPSEEK, current: true }], 1)))).toEqual([UP])
    const cuts = [MOVED_UP.indexOf('Kimi Code') + 4, MOVED_UP.indexOf('OAuth login') + 5, MOVED_UP.indexOf('OAuth login') + 11]
    let from = 0
    for (const cut of cuts) {
      expect(writes(guide.output(MOVED_UP.slice(from, cut)))).toEqual([])
      from = cut
    }
    expect(writes(guide.output(MOVED_UP.slice(from)))).toEqual(['\r'])
  })

  it('reads only the Kimi Code row with its OAuth description as the target', () => {
    const lines = (text: string) => text.split(/\r\n|\r|\n/).map((line) => line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, ' '))
    expect(kimiOAuthRow(lines(picker([OAUTH, DEEPSEEK], 0)))).toEqual({ row: 'Kimi Code', target: true })
    expect(kimiOAuthRow(lines(picker([OAUTH, DEEPSEEK], 1)))).toBeUndefined()
    expect(kimiOAuthRow(lines(picker([{ label: 'Kimi Code', description: 'https://api.kimi.com/coding/v1' }], 0)))).toBeUndefined()
    expect(kimiOAuthRow(lines(TRUST))).toBeUndefined()
  })

  it('hands over to the native terminal when the list has no Kimi Code row, pressing nothing', () => {
    const guide = trusted()
    const events = guide.output(picker([{ ...DEEPSEEK, current: true }, MOONSHOT], 0))
    expect(guides(events)).toMatchObject([{ step: 'missing', template: 'native', tone: 'warning' }])
    expect(writes(events)).toEqual([])
    expect(writes(guide.output(MOVED_UP.replace('Kimi Code', 'deepseek')))).toEqual([])
  })

  it('never presses Enter on another row when the list arrives in pieces without Kimi Code', () => {
    const guide = trusted()
    const frame = picker([{ ...DEEPSEEK, current: true }, MOONSHOT], 0)
    const cut = frame.indexOf('moonshot-cn')
    const first = guide.output(frame.slice(0, cut))
    expect(writes(first)).toEqual([UP])
    const rest = guide.output(frame.slice(cut))
    expect(guides(rest).map((item) => item.step)).toEqual(['missing'])
    expect(writes(rest)).toEqual([])
  })

  it('starts the confirmation when Kimi has nothing to sign out', () => {
    const guide = trusted()
    const events = guide.output(NOTHING)
    expect(writes(events)).toEqual([])
    expect(kinds(events).at(-1)).toBe('confirm')
    expect(guides(events).map((item) => item.step)).toContain('loggingOut')
  })

  it('confirms one API provider removed by Kimi itself, typing nothing', () => {
    const guide = createAccountGuide('kimi', 'logout', { login: 'kimi:deepseek' })!
    const events = guide.output('Removed provider "deepseek".\r\n')
    expect(writes(events)).toEqual([])
    expect(kinds(events).at(-1)).toBe('confirm')
    const moonshot = { providerLabel: 'Moonshot', authMethod: 'api' as const, id: 'kimi:moonshot-cn' }
    const deepseek = { providerLabel: 'DeepSeek', authMethod: 'api' as const, id: 'kimi:deepseek' }
    expect(guide.proves('logout', undefined, { state: 'configured', logins: [deepseek, moonshot] })).toBe(false)
    expect(guide.proves('logout', undefined, { state: 'configured', logins: [moonshot] })).toBe(true)
    expect(guide.proves('logout', undefined, { state: 'unavailable' })).toBe(false)
  })

  it('confirms an API removal from its status after Kimi exits with an unknown screen', () => {
    const guide = createAccountGuide('kimi', 'logout', { login: 'kimi:deepseek' })!
    expect(writes(guide.output('Provider "deepseek" not found.\r\n'))).toEqual([])
    expect(kinds(guide.exited(1))).toEqual(['guide', 'confirm'])
  })

  it('keeps the flow definition targeted at one login at a time', () => {
    expect(KIMI_FLOW.targets).toBe(true)
  })
})
