import type {
  AccountAction,
  AccountGuide,
  AccountLoginMode,
  AccountResponse,
  AccountStatus,
} from '../../shared/accounts.ts'
import { allowedLink, parseAccountLoginId } from '../../shared/account-links.ts'

/** What a guide asks the account manager to do. Keys only ever answer a user's choice. */
export type GuideEvent =
  | { guide: AccountGuide }
  /** Keys for the user's answer; `enter` presses Enter after a short pause. */
  | { write: string; enter?: boolean }
  /** An automatic sign-out command the user asked for by clicking「退出」. */
  | { command: string }
  | { confirm: 'login' | 'logout' }
  /** Read the native account in the background while the user authorizes elsewhere. */
  | { watch: 'login' }
  | { identify: true }
  | { finish: true }

export type AccountChange = 'login' | 'logout'
/** The native account state a guide judges, never terminal text. */
export type AccountEvidence = Pick<AccountStatus, 'state'> & Partial<Pick<AccountStatus, 'logins' | 'accountLabel'>>

/** The account manager's view of one guided terminal. */
export interface AccountGuideDriver {
  readonly size: { cols: number; rows: number }
  output(text: string): GuideEvent[]
  resize?(cols: number, rows: number): void
  /** Raw keys typed in the visible native terminal. */
  input(data: string): GuideEvent[]
  /** An answer from the plugin window; throws when the current step does not take it. */
  respond(response: AccountResponse): GuideEvent[]
  settled(): GuideEvent[]
  identified(state: AccountEvidence | undefined): GuideEvent[]
  /** The native process ended by itself. */
  exited(code: number | undefined): GuideEvent[]
  confirmed(change: AccountChange): GuideEvent[]
  unconfirmed(change: AccountChange): GuideEvent[]
  /** After an automatic command, whether one more Enter cannot start something else. */
  retryEnter(): boolean
  proves(change: AccountChange, before: AccountEvidence | undefined, after: AccountEvidence | undefined, exitCode?: number): boolean
}

export class GuideResponseError extends Error {
  constructor() {
    super('当前步骤不接受此操作，请按窗口提示继续')
  }
}

// Drawing sequences carry no text: drop CSI/OSC/charset controls before matching.
export const CONTROL = /\x1b\[[0-9;?<=>]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78]/g
export const compact = (text: string) => text.replace(/\s+/g, '').toLowerCase()
const URL_TEXT = /https:\/\/[^\s"'<>\x00-\x1f\x7f]+/g
const RAW_LIMIT = 16_384
const MAX_ANSWER = 4096
// No control characters, no line breaks: an answer is one pasted value.
const ANSWER = /^[^\x00-\x1f\x7f]+$/

/** Bounded text-only VT screen. OSC / APC payloads never become screen text or commands. */
class GuideScreen {
  private lines: string[][] = [[]]
  private wrapped = new Set<number>()
  private row = 0
  private col = 0
  private saved = [0, 0]
  private pending = ''
  private wrap = true
  private endings = new Map<number, number>()
  private drawn = new Map<number, number>()
  private sequence = 0
  bracketed = false
  links: string[] = []

  constructor(private cols: number, private rows: number) {}

  resize(cols: number, rows: number) {
    this.cols = Math.max(1, Math.min(500, cols))
    this.rows = Math.max(1, Math.min(200, rows))
    this.lines = this.lines.slice(0, this.rows).map((line) => line.slice(0, this.cols))
    this.row = Math.min(this.row, this.rows - 1)
    this.col = Math.min(this.col, this.cols - 1)
  }

  clear() {
    this.lines = [[]]
    this.wrapped.clear()
    this.links = []
    this.endings.clear()
    this.drawn.clear()
  }

  get plain() {
    return this.lines.map((line) => line.join('').trimEnd()).join('\n')
  }

  get linkText() {
    return this.lines.map((line, i) => (i && !this.wrapped.has(i) ? '\n' : '') +
      (this.wrapped.has(i + 1) ? line.join('') : line.join('').trimEnd())).join('')
  }

  get pickLines() {
    // Existing list readers use trailing style resets as evidence that a label
    // finished drawing. Keep that boundary without inserting spaces inside words.
    return [...this.drawn].sort((a, b) => a[1] - b[1]).map(([row]) =>
      (this.lines[row] ?? []).join('').trimEnd() + ' '.repeat(Math.min(2, this.endings.get(row) ?? 0)))
  }

  private nextLine(soft = false) {
    this.row++
    if (this.row >= this.rows) {
      this.lines.shift()
      this.row = this.rows - 1
      this.wrapped = new Set([...this.wrapped].filter((row) => row > 0).map((row) => row - 1))
      this.endings = new Map([...this.endings].filter(([row]) => row > 0).map(([row, count]) => [row - 1, count]))
      this.drawn = new Map([...this.drawn].filter(([row]) => row > 0).map(([row, count]) => [row - 1, count]))
    }
    this.lines[this.row] ??= []
    if (soft) this.wrapped.add(this.row)
    else this.wrapped.delete(this.row)
  }

  write(text: string) {
    const input = this.pending + text
    this.pending = ''
    for (let i = 0; i < input.length;) {
      if (input[i] === '\x1b') {
        const rest = input.slice(i)
        const kind = input[i + 1]
        if (!kind) { this.pending = rest; break }
        if (kind === '[') {
          const match = /^\x1b\[([0-?]*)([ -/]*)([@-~])/.exec(rest)
          if (!match) {
            if (/^\x1b\[[0-?]*[ -/]*$/.test(rest) && rest.length < RAW_LIMIT) this.pending = rest
            break
          }
          this.csi(match[1]!, match[2]!, match[3]!)
          i += match[0].length
          continue
        }
        if (']P_^X'.includes(kind)) {
          const end = /\x07|\x1b\\/.exec(rest.slice(2))
          if (!end) { if (rest.length < RAW_LIMIT) this.pending = rest; break }
          const payload = rest.slice(2, 2 + end.index)
          if (kind === ']' && payload.startsWith('8;')) {
            const link = payload.slice(payload.indexOf(';', 2) + 1)
            if (link) this.links = [...this.links.slice(-15), link]
            this.endings.set(this.row, (this.endings.get(this.row) ?? 0) + 1)
          }
          i += 2 + end.index + end[0].length
          continue
        }
        if ('()*+'.includes(kind)) {
          if (rest.length < 3) { this.pending = rest; break }
          i += 3
          continue
        }
        if (kind === '7') this.saved = [this.row, this.col]
        if (kind === '8') [this.row, this.col] = this.saved as [number, number]
        i += 2
        continue
      }
      const point = input.codePointAt(i)!
      // A stream chunk may end between the two UTF-16 units of a wide glyph.
      if (point >= 0xd800 && point <= 0xdbff && i === input.length - 1) { this.pending = input[i]!; break }
      const char = String.fromCodePoint(point)
      i += char.length
      if (char === '\r') { this.col = 0; continue }
      if (char === '\n') { this.endings.set(this.row, 2); this.nextLine(); this.col = 0; continue }
      if (char === '\b') { this.col = Math.max(0, this.col - 1); continue }
      if (char === '\t') { this.col = Math.min(this.cols - 1, (Math.floor(this.col / 8) + 1) * 8); continue }
      if (point < 32 || (point >= 127 && point < 160)) continue
      const combining = /[\p{Mark}\u200d\ufe0f]/u.test(char)
      const wide = point >= 0x1100 && (point <= 0x115f || point === 0x2329 || point === 0x232a ||
        (point >= 0x2e80 && point <= 0xa4cf && point !== 0x303f) || (point >= 0xac00 && point <= 0xd7a3) ||
        (point >= 0xf900 && point <= 0xfaff) || (point >= 0xfe10 && point <= 0xfe6f) ||
        (point >= 0xff00 && point <= 0xff60) || (point >= 0xffe0 && point <= 0xffe6) || point >= 0x1f300)
      const width = combining ? 0 : wide ? 2 : 1
      if (width && this.col + width > this.cols) {
        if (this.wrap) { this.nextLine(true); this.col = 0 }
        else this.col = Math.max(0, this.cols - width)
      }
      const line = this.lines[this.row] ??= []
      this.endings.delete(this.row)
      this.drawn.set(this.row, ++this.sequence)
      while (line.length < this.col) line.push(' ')
      if (!width) { if (this.col) line[this.col - 1] = (line[this.col - 1] ?? '') + char; continue }
      line[this.col] = char
      if (wide) line[this.col + 1] = ''
      this.col += width
    }
  }

  private csi(parameters: string, intermediate: string, final: string) {
    if (intermediate) return
    if (/^[<=>]/.test(parameters)) return
    if (parameters.startsWith('?')) {
      if (final === 'h' || final === 'l') {
        const modes = parameters.slice(1).split(';')
        if (modes.includes('2004')) this.bracketed = final === 'h'
        if (modes.includes('7')) this.wrap = final === 'h'
        if (modes.includes('1049')) { this.clear(); this.row = this.col = 0 }
      }
      return
    }
    const values = parameters.split(';').map(Number), n = values[0] || 1
    if (final === 'm') this.endings.set(this.row, (this.endings.get(this.row) ?? 0) + 1)
    const oldRow = this.row, oldCol = this.col
    if (final === 'H' || final === 'f') { this.row = n - 1; this.col = (values[1] || 1) - 1 }
    if (final === 'A') this.row -= n
    if (final === 'B') this.row += n
    if (final === 'C') this.col += n
    if (final === 'D') this.col -= n
    if (final === 'G' || final === '`') this.col = n - 1
    if (final === 'd') this.row = n - 1
    if (final === 'E' || final === 'F') { this.row += final === 'E' ? n : -n; this.col = 0 }
    if (final === 's') this.saved = [this.row, this.col]
    if (final === 'u') [this.row, this.col] = this.saved as [number, number]
    this.row = Math.max(0, Math.min(this.rows - 1, this.row))
    // SGR and visibility controls do not consume a pending soft wrap.
    if ('ABCDEFGH`dfu'.includes(final)) this.col = Math.max(0, Math.min(this.cols - 1, this.col))
    // ConPTY may encode a wrapped line as CR + CUP instead of a newline.
    if (this.row === oldRow + 1 && this.col === 0 &&
        (oldCol >= this.cols || (this.lines[oldRow]?.length ?? 0) >= this.cols)) this.wrapped.add(this.row)
    if (final === 'J') {
      if (values[0] === 2) this.clear()
      else if (!values[0]) { this.lines = this.lines.slice(0, this.row + 1); this.erase(0) }
      else if (values[0] === 1) { for (let r = 0; r < this.row; r++) this.lines[r] = []; this.erase(1) }
    }
    if (final === 'K') this.erase(values[0] || 0)
    if (final === 'X') {
      const line = this.lines[this.row] ??= []
      for (let c = this.col; c < Math.min(this.cols, this.col + n); c++) line[c] = ' '
    }
  }

  private erase(mode: number) {
    this.endings.delete(this.row)
    const line = this.lines[this.row] ??= []
    if (mode === 2) this.lines[this.row] = []
    else if (mode === 0) line.length = Math.min(line.length, this.col)
    else for (let c = 0; c <= Math.min(this.col, this.cols - 1); c++) line[c] = ' '
    this.wrapped.delete(this.row + 1)
  }
}

export interface ScreenView {
  /** Every marker, compared without whitespace or case, is on the recent screen. */
  has(...markers: string[]): boolean
  /** Visible screen text after cursor movement and erasure. */
  readonly plain: string
  readonly link?: string
  readonly code?: string
}

export interface FlowContext {
  action: AccountAction
  provider?: string
  mode?: AccountLoginMode
  /** The one login (`AccountLogin.id`) this sign-out removes. */
  login?: string
  /** The provider a login is stored under when the CLI files it elsewhere (OMP's device login). */
  stores?: string
  bracketedPaste: boolean
}

export interface FlowAnswer {
  keys: string
  enter?: boolean
  /** The answer submits the sign-in; start reading the native account. */
  confirm?: AccountChange
  /** The answer leaves this screen (e.g. folder trust); judge only what the CLI draws next. */
  resets?: boolean
}

export interface FlowStep {
  id: string
  when: readonly string[] | ((screen: ScreenView, ctx: FlowContext) => boolean)
  guide: (screen: ScreenView, ctx: FlowContext) => AccountGuide
  respond?: (response: AccountResponse, ctx: FlowContext) => FlowAnswer | undefined
  /** Keys written once when the step shows, for a choice the user already made in the window. */
  auto?: (screen: ScreenView, ctx: FlowContext) => string | undefined
  /** Reaching this step is itself a sign that the change may have taken effect. */
  confirms?: AccountChange
  /**
   * The CLI waits for a browser or device authorization and keeps running after it:
   * read the account in the background until it signs in, while the step still takes answers.
   */
  watches?: 'login'
  /** Enter typed in the visible terminal after content submits this step. */
  typedConfirms?: AccountChange
  /** The step is a final answer of the CLI (e.g. nothing to sign out); the window closes. */
  ends?: boolean
  /**
   * A native list in which the plugin finds the entry the user chose in the window.
   * Reads lines drawn since the last key; returns the highlighted row's own key and
   * whether it is that entry. Enter is pressed only on a match, the down arrow otherwise;
   * a highlighted row seen twice means the entry is not listed and the user takes over.
   */
  pick?: (lines: string[], ctx: FlowContext) => { row: string; target: boolean } | undefined
  /** What Enter on the picked row changes; logout by default. */
  pickConfirms?: AccountChange
}

export interface FlowDefinition {
  /** CLI name used in plugin texts. */
  name: string
  size?: { cols: number; rows: number }
  links?: readonly string[]
  /** Device code on the plain screen; group 1 is the code. */
  deviceCode?: RegExp
  /** `plan` titles the whole sign-in; the confirmation is its last step. */
  login?: { steps: FlowStep[]; plan?: readonly string[] }
  logout?: {
    steps?: FlowStep[]
    /**
     * A TUI command typed once its ready screen shows, or once the screen settles on a
     * signed-in account; `signedOut` proves nothing to do, `menu` that Enter is unsafe again.
     */
    command?: { ready?: readonly string[]; text: string; signedOut?: readonly string[]; menu?: readonly string[] }
  }
  proves?: FlowGuide['proves']
  /** Logins carry `cli:provider[:entry]` ids: a provider login is proven by that provider's own entry. */
  targets?: boolean
}

export const GUIDE_SIZE = { cols: 200, rows: 60 }
const DEVICE_CODE = /^[A-Z0-9]{3,12}(?:-[A-Z0-9]{3,12})?$/i
const PICK_LIMIT = 40
const DOWN = '\x1b[B'

/** Plugin texts shared by every CLI; a flow only adds its own steps. */
export function guideTexts(name: string) {
  return {
    starting: { step: 'starting', tone: 'info', template: 'starting', text: `正在启动 ${name}…` },
    confirming: { step: 'confirming', tone: 'info', template: 'waiting', text: '正在确认登录…' },
    signedIn: { step: 'signedIn', tone: 'success', template: 'result', text: `已登录 ${name}` },
    unconfirmed: {
      step: 'unconfirmed',
      tone: 'warning',
      template: 'result',
      text: '未能确认登录。请重新开始登录，或查看原生终端中的提示。',
    },
    loggingOut: { step: 'loggingOut', tone: 'info', template: 'waiting', text: `正在退出 ${name}…` },
    loggedOut: { step: 'loggedOut', tone: 'success', template: 'result', text: `已退出 ${name}` },
    notSignedIn: { step: 'notSignedIn', tone: 'info', template: 'result', text: `当前未登录 ${name}，无需退出。` },
    logoutUnconfirmed: {
      step: 'logoutUnconfirmed',
      tone: 'warning',
      template: 'result',
      text: '未能确认已退出，请查看原生终端中的提示。',
    },
    native: { step: 'native', tone: 'warning', template: 'native', text: '无法识别当前步骤，请在原生终端中继续。' },
  } as const satisfies Record<string, AccountGuide>
}

/** A guide driven by one CLI's flow definition. It never stores what the user types. */
export class FlowGuide implements AccountGuideDriver {
  readonly size: { cols: number; rows: number }
  private readonly texts: ReturnType<typeof guideTexts>
  private readonly steps: FlowStep[]
  private screen = ''
  private plain = ''
  private readonly terminal: GuideScreen
  private link?: string
  private code?: string
  private index = -1
  private shown?: AccountGuide
  private autoDone = new Set<string>()
  private typed = false
  private commandSent = false
  private afterCommand = ''
  private identifying = false
  private confirming = false
  private done = false
  private bracketed = false
  private picked = new Set<string>()
  private lastPicked?: string
  private pickDone = false
  private watching = false

  constructor(
    private readonly flow: FlowDefinition,
    private readonly ctx: Omit<FlowContext, 'bracketedPaste'>,
  ) {
    this.size = flow.size ?? GUIDE_SIZE
    this.terminal = new GuideScreen(this.size.cols, this.size.rows)
    this.texts = guideTexts(flow.name)
    this.steps = (ctx.action === 'login' ? flow.login?.steps : ctx.action === 'logout' ? flow.logout?.steps : undefined) ?? []
  }

  private get context(): FlowContext {
    return { ...this.ctx, bracketedPaste: this.bracketed }
  }

  private view(): ScreenView {
    const screen = this.screen
    return {
      has: (...markers) => markers.every((marker) => screen.includes(compact(marker))),
      plain: this.plain,
      link: this.link,
      code: this.code,
    }
  }

  output(text: string): GuideEvent[] {
    if (this.ctx.action === 'manage' || this.done) return []
    this.terminal.write(text)
    this.bracketed = this.terminal.bracketed
    this.plain = this.terminal.plain
    this.screen = compact(this.plain)
    this.readLinks()
    if (this.commandSent) {
      this.afterCommand = this.screen
      return []
    }
    const command = this.ctx.action === 'logout' ? this.flow.logout?.command : undefined
    if (command && this.index < 0) {
      const screen = this.view()
      if (command.signedOut?.length && screen.has(...command.signedOut)) return this.end(this.texts.notSignedIn)
      if (command.ready?.length && screen.has(...command.ready)) return this.sendCommand(command.text)
    }
    return this.advance()
  }

  resize(cols: number, rows: number) {
    this.terminal.resize(cols, rows)
  }

  private advance(): GuideEvent[] {
    if (this.confirming) return []
    const screen = this.view()
    const context = this.context
    for (let i = this.steps.length - 1; i >= Math.max(0, this.index); i--) {
      const step = this.steps[i]
      const matched = typeof step.when === 'function' ? step.when(screen, context) : screen.has(...step.when)
      if (!matched) continue
      const guide = step.guide(screen, context)
      if (i === this.index && sameGuide(guide, this.shown)) return step.pick ? this.pick(step) : []
      if (i !== this.index) this.typed = false
      this.index = i
      if (step.ends) return this.end(guide)
      const events = this.show(guide)
      if (step.auto && !this.autoDone.has(step.id)) {
        const keys = step.auto(screen, context)
        if (keys) {
          this.autoDone.add(step.id)
          events.push({ write: keys })
        }
      }
      if (step.confirms) events.push(...this.startConfirm(step.confirms))
      if (step.watches && !this.watching) {
        this.watching = true
        events.push({ watch: step.watches })
      }
      if (step.pick) events.push(...this.pick(step))
      return events
    }
    // Incremental list redraws may replace the header; the active picker still
    // requires its own fully drawn, highlighted target before submitting anything.
    const current = this.steps[this.index]
    if (current?.pick) return this.pick(current)
    return []
  }

  /** One key per drawn screen: Enter on the chosen row, the down arrow on any other. */
  private pick(step: FlowStep): GuideEvent[] {
    if (this.pickDone || !step.pick) return []
    const lines = this.terminal.pickLines
    const found = step.pick(lines, this.context)
    // The row highlighted before the last key may still be on screen until the key lands.
    if (!found || found.row === this.lastPicked) return []
    if (found.target) {
      this.pickDone = true
      return [{ write: '\r' }, ...this.startConfirm(step.pickConfirms ?? 'logout')]
    }
    if (this.picked.has(found.row) || this.picked.size >= PICK_LIMIT) {
      this.pickDone = true
      return this.show(this.texts.native)
    }
    this.picked.add(found.row)
    this.lastPicked = found.row
    return [{ write: DOWN }]
  }

  input(data: string): GuideEvent[] {
    const step = this.steps[this.index]
    if (!step?.typedConfirms || this.confirming) return []
    const content = data.replace(/\x1b\[20[01]~/g, '').replace(/[\r\n]/g, '')
    if (content.length) this.typed = true
    return /[\r\n]/.test(data) && this.typed ? this.startConfirm(step.typedConfirms) : []
  }

  respond(response: AccountResponse): GuideEvent[] {
    const step = this.steps[this.index]
    if (!step?.respond || this.confirming || this.done) throw new GuideResponseError()
    if ('code' in response || 'secret' in response) {
      const value = ('code' in response ? response.code : response.secret).trim()
      if (!value || value.length > MAX_ANSWER || !ANSWER.test(value)) throw new GuideResponseError()
    }
    const answer = step.respond(response, this.context)
    if (!answer) throw new GuideResponseError()
    const events: GuideEvent[] = [{ write: answer.keys, enter: answer.enter }]
    if (answer.resets) {
      this.screen = ''
      this.plain = ''
      this.terminal.clear()
      this.link = this.code = undefined
      this.index = -1
      this.shown = undefined
    }
    if (answer.confirm) events.push(...this.startConfirm(answer.confirm))
    return events
  }

  /** The user's own answer as keys: bracketed when the CLI asked for it, as typed otherwise. */
  static paste(value: string, ctx: FlowContext): string {
    return ctx.bracketedPaste ? `\x1b[200~${value}\x1b[201~` : value
  }

  settled(): GuideEvent[] {
    if (this.ctx.action === 'manage' || this.done || this.confirming || this.commandSent || this.identifying) return []
    // ConPTY initially emits only title / terminal negotiation, before the CLI draws anything.
    if (!this.plain.trim()) return []
    // A list that went quiet before its row was found cannot move on (one row, a lost key): hand it over.
    if (this.steps[this.index]?.pick && !this.pickDone) {
      this.pickDone = true
      return this.show(this.texts.native)
    }
    if (this.index >= 0) return []
    if (this.ctx.action === 'logout' && this.flow.logout?.command) {
      this.identifying = true
      return [{ identify: true }]
    }
    return sameGuide(this.texts.native, this.shown) ? [] : this.show(this.texts.native)
  }

  identified(state: AccountEvidence | undefined): GuideEvent[] {
    this.identifying = false
    if (this.done || this.commandSent || this.index >= 0) return []
    const command = this.flow.logout?.command
    if (this.ctx.action !== 'logout' || !command) return []
    if (state?.state === 'authenticated') return this.sendCommand(command.text)
    if (state?.state === 'unconfigured' || state?.state === 'unauthenticated') return this.end(this.texts.notSignedIn)
    return this.show(this.texts.native)
  }

  exited(): GuideEvent[] {
    if (this.done || this.ctx.action === 'manage') return []
    const change: AccountChange = this.ctx.action === 'logout' ? 'logout' : 'login'
    this.confirming = false
    return this.startConfirm(change)
  }

  confirmed(change: AccountChange): GuideEvent[] {
    if (this.done) return []
    return this.end(change === 'login' ? this.texts.signedIn : this.texts.loggedOut)
  }

  unconfirmed(change: AccountChange): GuideEvent[] {
    if (this.done) return []
    this.confirming = false
    this.typed = false
    if (change === 'logout') return this.show(this.texts.logoutUnconfirmed)
    // A pasted code or key may be retried in the same step; anything else starts over.
    const step = this.steps[this.index]
    if (step?.respond) {
      const guide = { ...this.texts.unconfirmed, template: this.shown?.template, plan: this.shown?.plan, stage: this.shown?.stage }
      return this.show({ ...guide, step: step.id, options: this.shown?.options, link: this.shown?.link, code: this.shown?.code })
    }
    return this.show(this.texts.unconfirmed)
  }

  retryEnter(): boolean {
    const menu = this.flow.logout?.command?.menu
    return !menu?.length || !menu.every((marker) => this.afterCommand.includes(compact(marker)))
  }

  proves(change: AccountChange, before: AccountEvidence | undefined, after: AccountEvidence | undefined, exitCode?: number): boolean {
    if (this.flow.proves) return this.flow.proves(change, before, after, exitCode)
    const { login, provider } = this.ctx
    // One of several logins: only the target's own change counts, never the account as a whole.
    if (change === 'logout' && login)
      return !!after && after.state !== 'unavailable' && after.state !== 'unknown' && !after.logins?.some((item) => item.id === login)
    if (change === 'login' && provider && this.flow.targets) {
      const stored = this.ctx.stores ?? provider
      const held = (evidence: AccountEvidence | undefined) =>
        new Set(
          (evidence?.logins ?? []).flatMap((item) =>
            item.id && parseAccountLoginId(item.id)?.provider === stored ? [item.id] : [],
          ),
        )
      const now = held(after),
        was = held(before)
      return [...now].some((id) => !was.has(id)) || (now.size > 0 && exitCode === 0)
    }
    if (change === 'logout') return !!after && after.state !== 'authenticated'
    if (after?.state !== 'authenticated') return false
    return before?.state !== 'authenticated' || exitCode === 0 || signature(before) !== signature(after)
  }

  private startConfirm(change: AccountChange): GuideEvent[] {
    if (this.confirming || this.done) return []
    this.confirming = true
    const plan = change === 'login' ? this.flow.login?.plan : undefined
    const guide = change === 'login' ? this.texts.confirming : this.texts.loggingOut
    return [...this.show(plan?.length ? { ...guide, plan: [...plan], stage: plan.length - 1 } : guide), { confirm: change }]
  }

  private sendCommand(text: string): GuideEvent[] {
    this.commandSent = true
    this.terminal.clear()
    return [...this.show(this.texts.loggingOut), { command: text }]
  }

  private end(guide: AccountGuide): GuideEvent[] {
    this.done = true
    return [...this.show(guide), { finish: true }]
  }

  private show(guide: AccountGuide): GuideEvent[] {
    this.shown = guide
    return [{ guide }]
  }

  private readLinks() {
    const hosts = this.flow.links
    this.link = undefined
    this.code = undefined
    if (hosts?.length) {
      let found: string | undefined
      for (const match of this.terminal.linkText.matchAll(URL_TEXT)) found = allowedLink(match[0], hosts) ?? found
      // The OSC target is complete even when its visible label is shortened or wrapped.
      for (const link of this.terminal.links) found = allowedLink(link, hosts) ?? found
      this.link = found
    }
    const device = this.flow.deviceCode?.exec(this.plain)
    if (device && DEVICE_CODE.test(device[1])) this.code = device[1]
  }
}

function sameGuide(a: AccountGuide, b: AccountGuide | undefined) {
  return !!b && a.step === b.step && a.link === b.link && a.code === b.code && a.text === b.text
}

function signature(state: AccountEvidence | undefined) {
  return JSON.stringify([state?.accountLabel, state?.logins])
}
