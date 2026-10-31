import type { AccountAction, AccountGuide, AccountResponse } from '../shared/accounts.ts'
import {
  CONTROL,
  compact,
  FlowGuide,
  GUIDE_SIZE,
  GuideResponseError,
  type AccountChange,
  type AccountEvidence,
  type AccountGuideDriver,
  type GuideEvent,
} from './account-guide/engine.ts'

/**
 * Screen texts of agy 1.4.7 (checked on macOS 2026-10-26). Whitespace is
 * ignored when matching, since a TUI may draw spaces as cursor moves.
 * `signedOut` is drawn before every sign-in check, also for a signed-in
 * account. The login method menu does not prove a signed-out start either (a
 * signed-in macOS Desktop run drew it, 2026-10-31): a sign-out drawn with it
 * asks the Host's native account read, and only an unconfigured read ends it.
 * `scheme` and `terms` are agy's first-run setup screens (Windows, 2026-10-27): a color
 * scheme list with `[Next]`, then the terms with a data-sharing checkbox that starts
 * ticked and `[Previous] [Done]`. On the checkbox Enter toggles it; ↓ moves to
 * `[Previous]`, → to `[Done]`, which is drawn as `> Done` once selected.
 */
const MARKERS = {
  trust: 'Do you trust the contents of this project?',
  scheme: 'Choose your color scheme',
  terms: 'Terms of Service & Data Use',
  next: '[Next]',
  agree: 'Yes, I agree to help improve',
  done: '> Done',
  nav: '↑/↓ Navigate',
  signedOut: 'You are currently not signed in.',
  method: 'Select login method',
  code: 'paste the authorization code',
  ready: '? for shortcuts',
} as const

const PLAN = ['选择登录方式', '在浏览器中授权', '粘贴授权码，按回车登录']
const login = { plan: PLAN } as const

export const AGY_GUIDES = {
  trust: { step: 'trust', tone: 'action', template: 'trust', ...login, stage: 0, text: 'Antigravity 首次在此项目文件夹运行，需要你确认是否信任该文件夹。' },
  setup: {
    step: 'setup',
    tone: 'action',
    template: 'native',
    ...login,
    stage: 0,
    text: 'Antigravity 首次运行，需要你在下方原生终端中完成剩余的初始设置。用方向键选择、回车确认，完成后插件会继续。',
  },
  preparing: { step: 'preparing', tone: 'info', template: 'waiting', text: '正在完成 Antigravity 首次运行设置…' },
  terms: {
    step: 'terms',
    tone: 'action',
    template: 'terms',
    text: 'Antigravity 首次运行，需要同意 Google Antigravity CLI 服务条款和 Google 隐私政策后才能继续。AI 编程智能体存在自主执行代码、数据外泄、提示注入和供应链等安全风险，请留意并核实它的每项操作。',
  },
  method: {
    step: 'method',
    tone: 'action',
    template: 'choice',
    ...login,
    stage: 0,
    text: '使用 Google 账号登录 Antigravity。',
    options: [{ id: 'google', label: '使用 Google 账号登录', detail: '如需使用 Google Cloud 项目登录，请打开原生终端操作。' }],
  },
  code: {
    step: 'code',
    tone: 'action',
    template: 'browserCode',
    ...login,
    stage: 1,
    text: '浏览器已打开 Google 登录页面。登录并点击「允许」后，页面会显示一串授权码，把它复制下来。',
  },
  pasted: { step: 'pasted', tone: 'action', template: 'browserCode', ...login, stage: 1, text: '授权码已粘贴，请按回车完成登录。' },
  confirming: { step: 'confirming', tone: 'info', template: 'waiting', ...login, stage: 2, text: '正在确认登录…' },
  signedIn: { step: 'signedIn', tone: 'success', template: 'result', text: '已登录 Antigravity' },
  unconfirmed: {
    step: 'unconfirmed',
    tone: 'warning',
    template: 'browserCode',
    ...login,
    stage: 1,
    text: '未能确认登录：授权码可能不完整或已过期。请重新开始登录，或查看原生终端中的提示。',
  },
  alreadySignedIn: { step: 'alreadySignedIn', tone: 'info', template: 'result', text: '当前已登录 Antigravity。如需切换账号，请先退出登录。' },
  loggingOut: { step: 'loggingOut', tone: 'info', template: 'waiting', text: '正在退出 Antigravity…' },
  loggedOut: { step: 'loggedOut', tone: 'success', template: 'result', text: '已退出 Antigravity' },
  notSignedIn: { step: 'notSignedIn', tone: 'info', template: 'result', text: '当前未登录 Antigravity，无需退出。' },
  logoutUnconfirmed: { step: 'logoutUnconfirmed', tone: 'warning', template: 'result', text: '未能确认已退出，请查看原生终端中的提示。' },
  menuUnresolved: {
    step: 'menuUnresolved',
    tone: 'warning',
    template: 'result',
    text: 'Antigravity 显示了登录菜单，但未能确认当前未登录，插件没有自动退出，也不会在菜单中输入。请点击「显示原生终端」查看当前画面。',
  },
} as const satisfies Record<string, AccountGuide>

export type AgyGuideEvent = GuideEvent

const SCREEN_LIMIT = 4096
// agy draws its sign-in address as an OSC 8 hyperlink; take the target, never the wrapped text.
const LINK = /\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]+)(?:\x07|\x1b\\)/g
const RAW_LIMIT = 8192
const googleSignIn = (value: string): string | undefined => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'accounts.google.com' && !url.username && !url.password
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}
/** Questions only the user answers; the guide waits for their answer before reading on. */
const GATES = new Set(['trust', 'setup', 'terms'])
const DOWN = '\x1b[B'
const RIGHT = '\x1b[C'
const PATTERNS = Object.fromEntries(
  Object.entries(MARKERS).map(([key, value]) => [key, compact(value)]),
) as Record<keyof typeof MARKERS, string>

/** Follows one Antigravity login or logout terminal; never stores what the user types. */
export class AgyAccountGuide implements AccountGuideDriver {
  readonly size = GUIDE_SIZE
  private screen = ''
  private raw = ''
  private link?: string
  private step?: string
  private typed = false
  private commandSent = false
  private identifying = false
  /** A sign-out drew the login menu: the pending native account read decides it. */
  private menuDrawn = false
  private afterCommand = ''
  /** The trust or setup question on screen was answered with Enter; judge what agy draws next. */
  private gateAnswered = false
  /** A first-run setup screen was drawn: a quiet screen may still be one of its steps. */
  private firstRun = false
  private schemeSkipped = false
  /** Whether the data-sharing box on the terms screen is ticked, as agy drew it. */
  private shared?: boolean
  /** The user agreed to the terms; Enter waits until `[Done]` is selected. */
  private toDone = false

  constructor(private readonly action: AccountAction) {}

  output(text: string): AgyGuideEvent[] {
    if (this.action === 'manage') return []
    this.screen = (this.screen + compact(text.replace(CONTROL, ''))).slice(-SCREEN_LIMIT)
    const seen = (marker: keyof typeof MARKERS) => this.screen.includes(PATTERNS[marker])
    const linked = this.action === 'login' ? this.readLink(text) : false
    if (this.action === 'logout') {
      if (this.commandSent) {
        this.afterCommand = (this.afterCommand + compact(text.replace(CONTROL, ''))).slice(-SCREEN_LIMIT)
        return []
      }
      const done = this.done(seen)
      if (done) return done
      // After the user answers the trust or setup question, the main screen follows.
      if (this.waiting()) return []
      const gate = this.gate(seen)
      if (gate) return gate
      // The menu wins over a main screen in the same text: nothing is typed while it may be drawn.
      if (seen('method')) {
        this.menuDrawn = true
        if (this.identifying) return []
        this.identifying = true
        return [{ identify: true }]
      }
      if (!seen('ready')) return []
      this.commandSent = true
      return [...this.show(AGY_GUIDES.loggingOut), { command: '/logout' }]
    }
    const done = this.done(seen)
    if (done) return done
    // Login steps only move forward; a redraw of an earlier screen is ignored.
    if (seen('code') && this.order('code')) return this.show(AGY_GUIDES.code)
    if (seen('method') && this.order('method')) return this.show(AGY_GUIDES.method)
    if (!this.waiting()) {
      const gate = this.gate(seen)
      if (gate) return gate
    }
    if (seen('ready') && !seen('method') && !this.waiting()) return this.show(AGY_GUIDES.alreadySignedIn)
    // A sign-in address drawn after the code prompt still reaches the open step.
    if (linked && this.step === 'code') return [{ guide: this.withLink(AGY_GUIDES.code) }]
    return []
  }

  /**
   * The screen stopped changing before any known step: ask the Host to read the
   * native account. The main screen's exact text is not relied on alone.
   */
  settled(): AgyGuideEvent[] {
    if (this.action === 'manage' || this.waiting() || this.commandSent || this.identifying || !this.screen)
      return []
    const seen = (marker: keyof typeof MARKERS) => this.screen.includes(PATTERNS[marker])
    // Still on the color scheme after its Enter: the user picks it in the terminal.
    if (seen('scheme') && this.schemeSkipped && !seen('terms')) {
      this.gateAnswered = false
      return this.show(AGY_GUIDES.setup)
    }
    if (seen('trust') || seen('scheme') || seen('terms') || seen('method') || seen('code')) return []
    // A first-run step the guide does not know: the user finishes it in the terminal.
    if (this.firstRun && !seen('ready') && (this.toDone || this.wizard(seen))) {
      this.toDone = false
      this.gateAnswered = false
      return this.show(AGY_GUIDES.setup)
    }
    this.identifying = true
    return [{ identify: true }]
  }

  /** agy redrew its login menu after `/logout`: a further Enter would start a sign-in. */
  loginMenuAfterCommand(): boolean {
    return this.afterCommand.includes(PATTERNS.method)
  }

  /** The native account state read after `settled`. */
  identified(evidence: AccountEvidence | string | undefined): AgyGuideEvent[] {
    const state = typeof evidence === 'string' ? evidence : evidence?.state
    this.identifying = false
    if (this.waiting() || this.commandSent) return []
    // `/logout` is never typed into a login menu; a signed-in or unread account is the user's to check.
    if (this.menuDrawn && this.action === 'logout')
      return this.show(state === 'unconfigured' ? AGY_GUIDES.notSignedIn : AGY_GUIDES.menuUnresolved)
    if (state === 'authenticated') {
      if (this.action === 'login') return this.show(AGY_GUIDES.alreadySignedIn)
      this.commandSent = true
      return [...this.show(AGY_GUIDES.loggingOut), { command: '/logout' }]
    }
    if (state === 'unconfigured' && this.action === 'logout') return this.show(AGY_GUIDES.notSignedIn)
    return []
  }

  input(data: string): AgyGuideEvent[] {
    // The trust or setup question is answered: judge only what agy draws next.
    if (this.step && GATES.has(this.step) && /[\r\n]/.test(data)) {
      this.screen = ''
      this.gateAnswered = true
    }
    if (this.action !== 'login' || (this.step !== 'code' && this.step !== 'pasted')) return []
    const enter = /[\r\n]/.test(data)
    const content = data.replace(/\x1b\[20[01]~/g, '').replace(/[\r\n]/g, '')
    // A bracketed or multi-character write is a paste; single keys are typing.
    const pasted = data.includes('\x1b[200~') || content.length >= 16
    if (content.length) this.typed = true
    if (enter && this.typed) return [...this.show(AGY_GUIDES.confirming), { confirm: 'login' }]
    if (pasted && this.step === 'code') return this.show(AGY_GUIDES.pasted)
    return []
  }

  /** The login could not be confirmed in time; the user may paste a fresh code. */
  unconfirmed(change: AccountChange = 'login'): AgyGuideEvent[] {
    if (change === 'logout') return [{ guide: AGY_GUIDES.logoutUnconfirmed }]
    this.typed = false
    this.step = 'code'
    return [{ guide: this.withLink(AGY_GUIDES.unconfirmed) }]
  }

  /** An answer from the plugin window, turned into the keys agy expects. */
  respond(response: AccountResponse): AgyGuideEvent[] {
    if (this.action === 'manage') throw new GuideResponseError()
    if ('agree' in response && this.step === 'terms' && !this.gateAnswered && this.shared !== undefined) {
      // Enter toggles the box; ↓ → selects [Done], pressed once agy draws it selected.
      this.screen = ''
      this.toDone = true
      return [{ write: (response.share === this.shared ? '' : '\r') + DOWN + RIGHT }, ...this.show(AGY_GUIDES.preparing)]
    }
    if ('confirm' in response && this.step === 'trust' && !this.gateAnswered) {
      if (response.confirm === 'decline') return [{ finish: true }]
      this.screen = ''
      this.gateAnswered = true
      return [{ write: '\r' }]
    }
    if (this.action !== 'login') throw new GuideResponseError()
    if ('option' in response && response.option === 'google' && this.step === 'method') return [{ write: '\r' }]
    if ('code' in response && ['code', 'pasted', 'unconfirmed'].includes(this.step ?? '')) {
      const value = response.code.trim()
      if (!value || value.length > 2048 || /[\x00-\x1f\x7f]/.test(value)) throw new GuideResponseError()
      // agy enables bracketed paste; a pasted code then Enter is what its input box expects.
      return [
        { write: FlowGuide.paste(value, { action: 'login', bracketedPaste: true }), enter: true },
        ...this.show(AGY_GUIDES.confirming),
        { confirm: 'login' },
      ]
    }
    throw new GuideResponseError()
  }

  exited(): AgyGuideEvent[] {
    return []
  }

  confirmed(change: AccountChange): AgyGuideEvent[] {
    return [...this.show(change === 'login' ? AGY_GUIDES.signedIn : AGY_GUIDES.loggedOut), { finish: true }]
  }

  retryEnter(): boolean {
    return !this.loginMenuAfterCommand()
  }

  proves(change: AccountChange, _before: AccountEvidence | undefined, after: AccountEvidence | undefined): boolean {
    return change === 'login' ? after?.state === 'authenticated' : after?.state === 'unconfigured'
  }

  /** A step other than an answered trust or setup question is on screen: wait for it. */
  private waiting(): boolean {
    return !!this.step && this.step !== 'preparing' && (!GATES.has(this.step) || !this.gateAnswered)
  }

  /**
   * A question on screen, shown before anything is typed. The color scheme is only a
   * look, so its preselected default is taken; terms and folder trust are the user's.
   */
  private gate(seen: (marker: keyof typeof MARKERS) => boolean): AgyGuideEvent[] | undefined {
    if (seen('terms')) {
      this.firstRun = true
      const at = this.screen.lastIndexOf(PATTERNS.agree)
      // Wait for the checkbox line; an unexpected box is left to the user.
      if (at < 0) return []
      const box = this.screen.slice(Math.max(0, at - 3), at)
      this.shared = box === '[x]' ? true : box.endsWith('[]') ? false : undefined
      this.gateAnswered = false
      return this.show(this.shared === undefined ? AGY_GUIDES.setup : AGY_GUIDES.terms)
    }
    if (seen('scheme')) {
      this.firstRun = true
      // A resize redraws the list before agy reads the Enter; a quiet screen decides.
      if (this.schemeSkipped) return []
      // Enter only once the whole list and its key hints are drawn.
      if (!seen('next') || !seen('nav')) return []
      this.schemeSkipped = true
      this.screen = ''
      return [...this.show(AGY_GUIDES.preparing), { write: '\r' }]
    }
    if (!seen('trust')) return undefined
    this.gateAnswered = false
    return this.show(AGY_GUIDES.trust)
  }

  /** The user agreed to the terms: press Enter once agy shows `[Done]` selected. */
  private done(seen: (marker: keyof typeof MARKERS) => boolean): AgyGuideEvent[] | undefined {
    if (!this.toDone) return undefined
    if (!seen('done')) return []
    this.toDone = false
    this.screen = ''
    return [{ write: '\r' }]
  }

  /** agy's setup wizard is drawn: its key hints or buttons. */
  private wizard(seen: (marker: keyof typeof MARKERS) => boolean): boolean {
    return seen('nav') || seen('next') || this.screen.includes(compact('[Previous]')) || this.screen.includes(compact('[Done]'))
  }

  private order(step: 'method' | 'code') {
    const rank = ['trust', 'method', 'code', 'pasted', 'confirming', 'signedIn', 'unconfirmed']
    return rank.indexOf(this.step ?? 'trust') < rank.indexOf(step) || !this.step
  }

  private show(guide: AccountGuide): AgyGuideEvent[] {
    this.step = guide.step
    return [{ guide: guide.step === 'code' ? this.withLink(guide) : guide }]
  }

  private withLink(guide: AccountGuide): AccountGuide {
    return this.link ? { ...guide, link: this.link } : guide
  }

  /** Keeps the latest Google sign-in address; true when it changed. */
  private readLink(text: string): boolean {
    this.raw = (this.raw + text).slice(-RAW_LIMIT)
    let found: string | undefined
    for (const match of this.raw.matchAll(LINK)) found = googleSignIn(match[1]) ?? found
    if (!found || found === this.link) return false
    this.link = found
    return true
  }
}
