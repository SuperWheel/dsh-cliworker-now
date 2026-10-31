import { expect, it } from 'vitest'
import { AGY_GUIDES, AgyAccountGuide } from '../src/host/agy-account-guide.ts'

// Synthetic agy 1.4.7 screens, drawn with cursor moves and colours as a TUI does.
const SIGNED_OUT = '\x1b[2J\x1b[1;1HWelcome to the Antigravity CLI. You are\x1b[1Ccurrently not signed in.\r\n'
const METHOD = '\x1b[32mSelect login\x1b[0m method:\r\n> 1. Google OAuth\r\n  2. Use a Google Cloud project\r\n'
const CODE = 'If you aren\'t automatically redirected, paste the authori'
const CODE_TAIL = 'zation code below:\r\n authorization code...'
const TRUST = 'Do you trust the contents of this project?\r\n> Yes, I trust this folder\r\n'
const READY = '\x1b[3;1H>\x1b[K\r\n\x1b[90m?\x1b[1Cfor shortcuts\x1b[0m'
const steps = (events: ReturnType<AgyAccountGuide['output']>) =>
  events.flatMap((event) => ('guide' in event ? [event.guide.step] : []))

it('walks a sign-in through method, code, paste, Enter and confirmation', () => {
  const guide = new AgyAccountGuide('login')
  expect(steps(guide.output(SIGNED_OUT + METHOD))).toEqual(['method'])
  expect(guide.output(METHOD)).toEqual([])
  expect(steps(guide.output(CODE))).toEqual([])
  expect(steps(guide.output(CODE_TAIL))).toEqual(['code'])
  // A redraw of the menu never moves the guide back.
  expect(guide.output(METHOD)).toEqual([])
  expect(steps(guide.input('\x1b[200~synthetic-authorization-code\x1b[201~'))).toEqual(['pasted'])
  expect(guide.input('\r')).toEqual([{ guide: AGY_GUIDES.confirming }, { confirm: 'login' }])
})

it('treats a long single write as a paste and a typed code with Enter as a submission', () => {
  const pasted = new AgyAccountGuide('login')
  pasted.output(METHOD + CODE + CODE_TAIL)
  expect(steps(pasted.input('4/0AsyntheticAuthorizationCode'))).toEqual(['pasted'])
  const typed = new AgyAccountGuide('login')
  typed.output(METHOD + CODE + CODE_TAIL)
  for (const key of 'abc') expect(typed.input(key)).toEqual([])
  expect(typed.input('\r')).toContainEqual({ confirm: 'login' })
})

it('ignores Enter before anything was entered and input outside the code step', () => {
  const guide = new AgyAccountGuide('login')
  expect(guide.input('\r')).toEqual([])
  guide.output(METHOD)
  expect(guide.input('\r')).toEqual([])
  guide.output(CODE + CODE_TAIL)
  expect(guide.input('\r')).toEqual([])
})

it('lets a fresh code be pasted after an unconfirmed sign-in', () => {
  const guide = new AgyAccountGuide('login')
  guide.output(METHOD + CODE + CODE_TAIL)
  guide.input('\x1b[200~synthetic-expired-code\x1b[201~')
  guide.input('\r')
  expect(guide.unconfirmed()).toEqual([{ guide: AGY_GUIDES.unconfirmed }])
  expect(steps(guide.input('\x1b[200~synthetic-fresh-code\x1b[201~'))).toEqual(['pasted'])
  expect(guide.input('\r')).toContainEqual({ confirm: 'login' })
})

it('shows the trust step first and an already signed-in main screen without typing', () => {
  const trusting = new AgyAccountGuide('login')
  expect(steps(trusting.output(TRUST))).toEqual(['trust'])
  expect(steps(trusting.output(SIGNED_OUT + METHOD))).toEqual(['method'])
  const signedIn = new AgyAccountGuide('login')
  expect(signedIn.output(READY)).toEqual([{ guide: AGY_GUIDES.alreadySignedIn }])
})

it('types /logout once, only after the signed-in main screen is ready', () => {
  const guide = new AgyAccountGuide('logout')
  expect(guide.output('\x1b[2J Signing in...')).toEqual([])
  expect(guide.output(READY)).toEqual([{ guide: AGY_GUIDES.loggingOut }, { command: '/logout' }])
  expect(guide.output(READY)).toEqual([])
  expect(guide.input('/logout\r')).toEqual([])
})

it('never types for a signed-out or untrusted logout terminal, or for manage', () => {
  const signedOut = new AgyAccountGuide('logout')
  expect(signedOut.output(SIGNED_OUT + METHOD)).toEqual([{ identify: true }])
  expect(signedOut.output(READY)).toEqual([])
  expect(signedOut.identified('unconfigured')).toEqual([{ guide: AGY_GUIDES.notSignedIn }])
  expect(signedOut.output(READY)).toEqual([])
  const untrusted = new AgyAccountGuide('logout')
  expect(untrusted.output(TRUST)).toEqual([{ guide: AGY_GUIDES.trust }])
  expect(untrusted.output(READY)).toEqual([])
  const manage = new AgyAccountGuide('manage')
  expect(manage.output(READY + METHOD + CODE + CODE_TAIL)).toEqual([])
  expect(manage.input('\x1b[200~synthetic\x1b[201~\r')).toEqual([])
})

it('never ends or types into a sign-out on the login menu unless the native account is signed out', () => {
  // 2026-10-31 macOS Desktop: a signed-in agy drew the menu and the sign-out closed as "not signed in".
  for (const state of ['authenticated', 'unavailable', undefined] as const) {
    const guide = new AgyAccountGuide('logout')
    expect(guide.output(SIGNED_OUT + METHOD)).toEqual([{ identify: true }])
    expect(guide.output(METHOD)).toEqual([])
    expect(guide.identified(state)).toEqual([{ guide: AGY_GUIDES.menuUnresolved }])
    expect(guide.output(READY)).toEqual([])
    expect(guide.settled()).toEqual([])
  }
  // A menu drawn together with the main screen still waits for the native account.
  const mixed = new AgyAccountGuide('logout')
  expect(mixed.output(METHOD + '\x1b[2J' + READY)).toEqual([{ identify: true }])
  expect(mixed.identified('authenticated')).toEqual([{ guide: AGY_GUIDES.menuUnresolved }])
  // The menu arriving while a settled screen's read is in flight: that read decides, once.
  const late = new AgyAccountGuide('logout')
  late.output('\x1b[2J synthetic main screen without the guessed marker')
  expect(late.settled()).toEqual([{ identify: true }])
  expect(late.output(METHOD)).toEqual([])
  expect(late.identified('authenticated')).toEqual([{ guide: AGY_GUIDES.menuUnresolved }])
})

it('keeps every guide text Host-authored', () => {
  for (const guide of Object.values(AGY_GUIDES)) expect(guide.text).not.toMatch(/synthetic|\x1b/)
})

const osc8 = (url: string, label = url) => `\x1b]8;id=synthetic;${url}\x07${label}\x1b]8;;\x07`
const GOOGLE = 'https://accounts.google.com/o/oauth2/auth?client_id=synthetic&state=synthetic'

it('attaches the OSC 8 Google sign-in address to the code step, never another host', () => {
  const guide = new AgyAccountGuide('login')
  guide.output(METHOD)
  const [event] = guide.output(`Your browser should open automatically. If not:\r\n ${osc8(GOOGLE, 'https://accounts.go')}\r\n${CODE}${CODE_TAIL}`)
  expect(event).toEqual({ guide: { ...AGY_GUIDES.code, link: GOOGLE } })
  const other = new AgyAccountGuide('login')
  other.output(METHOD)
  expect(other.output(osc8('https://example.com/phish') + CODE + CODE_TAIL)).toEqual([{ guide: AGY_GUIDES.code }])
  expect(new AgyAccountGuide('logout').output(osc8(GOOGLE) + READY)).not.toContainEqual(expect.objectContaining({ guide: expect.objectContaining({ link: GOOGLE }) }))
})

it('updates the code step when the sign-in address arrives after the prompt', () => {
  const guide = new AgyAccountGuide('login')
  guide.output(METHOD + CODE + CODE_TAIL)
  expect(guide.output(osc8(GOOGLE))).toEqual([{ guide: { ...AGY_GUIDES.code, link: GOOGLE } }])
  expect(guide.output(osc8(GOOGLE))).toEqual([])
})

it('asks for the native account once a screen with no known step settles', () => {
  const logout = new AgyAccountGuide('logout')
  expect(logout.settled()).toEqual([])
  logout.output('\x1b[2J synthetic main screen without the guessed marker')
  expect(logout.settled()).toEqual([{ identify: true }])
  expect(logout.settled()).toEqual([])
  expect(logout.identified('authenticated')).toEqual([{ guide: AGY_GUIDES.loggingOut }, { command: '/logout' }])
  expect(logout.identified('authenticated')).toEqual([])

  const signedOut = new AgyAccountGuide('logout')
  signedOut.output('synthetic screen')
  signedOut.settled()
  expect(signedOut.identified('unconfigured')).toEqual([{ guide: AGY_GUIDES.notSignedIn }])

  const login = new AgyAccountGuide('login')
  login.output('synthetic screen')
  login.settled()
  expect(login.identified('authenticated')).toEqual([{ guide: AGY_GUIDES.alreadySignedIn }])
  const loginOut = new AgyAccountGuide('login')
  loginOut.output('synthetic screen')
  loginOut.settled()
  expect(loginOut.identified('unconfigured')).toEqual([])
})

it('never asks while a known step is on screen', () => {
  for (const screen of [METHOD, TRUST, CODE + CODE_TAIL]) {
    const guide = new AgyAccountGuide('logout')
    guide.output(screen)
    expect(guide.settled()).toEqual([])
  }
  const manage = new AgyAccountGuide('manage')
  manage.output('synthetic screen')
  expect(manage.settled()).toEqual([])
})

it('treats the signed-out line as a sign-in check, not as a signed-out account (real agy 1.4.7 start)', () => {
  const logout = new AgyAccountGuide('logout')
  expect(logout.output(SIGNED_OUT + '\u28fe  Signing in...')).toEqual([])
  expect(logout.output(READY)).toEqual([{ guide: AGY_GUIDES.loggingOut }, { command: '/logout' }])
  expect(logout.loginMenuAfterCommand()).toBe(false)
  logout.output(METHOD)
  expect(logout.loginMenuAfterCommand()).toBe(true)
  const login = new AgyAccountGuide('login')
  expect(login.output(SIGNED_OUT + READY)).toEqual([{ guide: AGY_GUIDES.alreadySignedIn }])
  const settling = new AgyAccountGuide('logout')
  settling.output(SIGNED_OUT)
  expect(settling.settled()).toEqual([{ identify: true }])
})

it('continues an automatic sign-out only after the user answers the folder trust question', () => {
  const guide = new AgyAccountGuide('logout')
  expect(guide.output(SIGNED_OUT + '\u28fe  Signing in...' + TRUST)).toEqual([{ guide: AGY_GUIDES.trust }])
  expect(guide.output(READY)).toEqual([])
  expect(guide.settled()).toEqual([])
  expect(guide.input('\r')).toEqual([])
  expect(guide.output(READY)).toEqual([{ guide: AGY_GUIDES.loggingOut }, { command: '/logout' }])
  const settling = new AgyAccountGuide('logout')
  settling.output(TRUST)
  settling.input('\r')
  settling.output('synthetic main screen')
  expect(settling.settled()).toEqual([{ identify: true }])
  expect(settling.identified('authenticated')).toContainEqual({ command: '/logout' })
})

// Synthetic first-run setup screens modelled on agy 1.4.7 on Windows (2026-10-27): a color
// scheme list, then the terms with a data-sharing box that starts ticked and [Previous] [Done].
const SCHEME_LIST = '\x1b[2J\x1b[1;1HWelcome to Antigravity CLI!\r\n\nChoose your color\x1b[1Cscheme:\r\n  > terminal\r\n    light\r\n'
const SCHEME_KEYS = '  [Next]\r\n\r\n   \x1b[1m↑/↓\x1b[m  Navigate ·  \x1b[1menter\x1b[m  Confirm'
const TERMS_TITLE = '\x1b[2J\x1b[1;1HTerms of Service\x1b[1C& Data Use\r\nAI coding agents are known to have certain security risks.\r\n'
const TERMS_BOX = (ticked: boolean) =>
  `  > [${ticked ? 'x' : ' '}] Yes, I agree to help improve Antigravity CLI by allowing\r\n  [Previous]        [Done]\r\n   ↑/↓  Navigate ·  enter  Toggle`
const PREVIOUS = '\r\x1b[15;3H  \x1b[26;3H> \x1b[34;7m Previous \x1b[m\x1b[29;24H\x1b[90mConfirm\x1b[m'
const DONE = '\x1b[26;3H  \x1b[34;1m[Previous]\x1b[m    > \x1b[32;7m Done \x1b[m'

it('takes the default color scheme, then agrees to the terms only when the user does, leaving data sharing off', () => {
  const guide = new AgyAccountGuide('logout')
  // The list alone is not enough: Enter waits for its [Next] and key hints.
  expect(guide.output(SCHEME_LIST)).toEqual([])
  expect(guide.output(SCHEME_KEYS)).toEqual([{ guide: AGY_GUIDES.preparing }, { write: '\r' }])
  expect(guide.output(TERMS_TITLE)).toEqual([])
  expect(guide.output(TERMS_BOX(true))).toEqual([{ guide: AGY_GUIDES.terms }])
  expect(AGY_GUIDES.terms.template).toBe('terms')
  // Nothing is typed into the terms screen by itself, whatever the account.
  expect(guide.settled()).toEqual([])
  expect(guide.identified('authenticated')).toEqual([])
  expect(guide.output(READY)).toEqual([])
  // agy ticks the box; the user left it off, so Enter toggles it before ↓ → reach [Done].
  expect(guide.respond({ agree: 'terms', share: false })).toEqual([
    { write: '\r\x1b[B\x1b[C' },
    { guide: AGY_GUIDES.preparing },
  ])
  expect(guide.output(PREVIOUS)).toEqual([])
  expect(guide.output(DONE)).toEqual([{ write: '\r' }])
  expect(guide.output(READY)).toEqual([{ guide: AGY_GUIDES.loggingOut }, { command: '/logout' }])

  const sharing = new AgyAccountGuide('logout')
  sharing.output(SCHEME_LIST + SCHEME_KEYS)
  sharing.output(TERMS_TITLE + TERMS_BOX(true))
  expect(sharing.respond({ agree: 'terms', share: true })).toContainEqual({ write: '\x1b[B\x1b[C' })
  const unticked = new AgyAccountGuide('login')
  unticked.output(TERMS_TITLE + TERMS_BOX(false))
  expect(unticked.respond({ agree: 'terms', share: false })).toContainEqual({ write: '\x1b[B\x1b[C' })
})

it('leaves the rest of the first-run setup to the user when it is not the screen the guide knows', () => {
  // [Done] never shows as selected: no Enter, and the user finishes in the terminal.
  const stuck = new AgyAccountGuide('logout')
  stuck.output(TERMS_TITLE + TERMS_BOX(true))
  stuck.respond({ agree: 'terms', share: false })
  stuck.output(PREVIOUS)
  expect(stuck.settled()).toEqual([{ guide: AGY_GUIDES.setup }])
  expect(AGY_GUIDES.setup.template).toBe('native')
  expect(stuck.output(DONE)).toEqual([])
  stuck.input('\r')
  expect(stuck.output(READY)).toContainEqual({ command: '/logout' })
  // An unknown wizard step after the terms is never mistaken for the main screen.
  const unknown = new AgyAccountGuide('logout')
  unknown.output(TERMS_TITLE + TERMS_BOX(true))
  unknown.respond({ agree: 'terms', share: false })
  unknown.output(DONE)
  unknown.output('\x1b[2J\x1b[1;1HImport from Gemini CLI\r\n  [Previous]   [Next]\r\n   ↑/↓ Navigate · enter Confirm')
  expect(unknown.settled()).toEqual([{ guide: AGY_GUIDES.setup }])
  expect(unknown.identified('authenticated')).toEqual([])
  // A box agy draws in a way the guide cannot read is the user's to answer.
  const odd = new AgyAccountGuide('logout')
  expect(odd.output(TERMS_TITLE + '  > (?) Yes, I agree to help improve Antigravity CLI\r\n')).toEqual([{ guide: AGY_GUIDES.setup }])
  expect(() => odd.respond({ agree: 'terms', share: false })).toThrow()
  // A resize redraws the color scheme before agy reads the Enter: no second Enter, and the terms follow.
  const resized = new AgyAccountGuide('logout')
  resized.output(SCHEME_LIST + SCHEME_KEYS)
  expect(resized.output(SCHEME_LIST + SCHEME_KEYS)).toEqual([])
  expect(resized.output(TERMS_TITLE + TERMS_BOX(true))).toEqual([{ guide: AGY_GUIDES.terms }])
  // Still on the color scheme once the screen is quiet: the user picks it in the terminal.
  const again = new AgyAccountGuide('logout')
  again.output(SCHEME_LIST + SCHEME_KEYS)
  again.output(SCHEME_LIST + SCHEME_KEYS)
  expect(again.settled()).toEqual([{ guide: AGY_GUIDES.setup }])
  expect(again.identified('authenticated')).toEqual([])
})

it('shows the folder trust question that follows the terms screen, and the terms before a sign-in', () => {
  const logout = new AgyAccountGuide('logout')
  logout.output(TERMS_TITLE + TERMS_BOX(true))
  logout.respond({ agree: 'terms', share: false })
  logout.output(DONE)
  expect(logout.output(TRUST)).toEqual([{ guide: AGY_GUIDES.trust }])
  expect(logout.respond({ confirm: 'trust' })).toEqual([{ write: '\r' }])
  expect(logout.output(READY)).toContainEqual({ command: '/logout' })
  const login = new AgyAccountGuide('login')
  login.output(SCHEME_LIST + SCHEME_KEYS)
  expect(steps(login.output(TERMS_TITLE + TERMS_BOX(true)))).toEqual(['terms'])
  login.respond({ agree: 'terms', share: false })
  login.output(DONE)
  expect(steps(login.output(SIGNED_OUT + METHOD))).toEqual(['method'])
})
