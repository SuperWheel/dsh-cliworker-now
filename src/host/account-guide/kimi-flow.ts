import type { AccountGuide } from '../../shared/accounts.ts'
import { ACCOUNT_LOGIN_HOSTS } from '../../shared/account-links.ts'
import { guideTexts, type FlowDefinition, type FlowStep } from './engine.ts'

/*
 * Kimi login windows for a provider picked in the account window, and the sign-out of
 * one login. Markers come from screens captured in isolated homes with simulated
 * credentials on 2026-10-27 (Kimi Code 2.1.1 and its auto-installed 2.3.3; see doc/tasks.md).
 *
 * - `kimi login --region mainland-cn|global` prints a device code and its kimi.com /
 *   kimi.ai page, then exits by itself once the browser authorizes it.
 * - `kimi provider remove <key>` removes one API provider and exits by itself.
 * - The managed Kimi Code OAuth login has no CLI command: the bare TUI asks to trust
 *   the plugin's empty folder (the user's answer), then `/logout` opens Kimi's own
 *   list. That list is clamped, never wraps, and starts on the current model's
 *   provider; the Kimi Code row is always its first entry, so the plugin moves up to
 *   it and presses Enter only on that row.
 */

const NAME = 'Kimi'
const DEVICE_PLAN = ['在浏览器中确认验证码', '确认登录']
const LOGOUT_TITLE = 'Select a provider to log out'
/** The managed row of `/logout`: label PRODUCT_NAME, description "OAuth login". */
const OAUTH_LABEL = 'Kimi Code'
const OAUTH_DESCRIPTION = 'OAuth login'
const POINTER = '❯'
/** More than the list can hold; Kimi clamps the cursor at the first row. */
const TO_TOP = '\x1b[A'.repeat(40)

/*
 * A drawn row ends in Kimi's style resets, which the engine turns into spaces: the
 * text is complete only once two of them follow it. A row cut by a read is not a row.
 */
const highlightedRow = /❯\s+(\S.*?)\s{2,}/
const completeLine = (line: string, text: string) => new RegExp(`^\\s*${text}\\s{2,}`).test(line)

/** The highlighted row of Kimi's /logout list, when it is the managed Kimi Code login. */
export function kimiOAuthRow(lines: string[]): { row: string; target: boolean } | undefined {
  let at = lines.length - 1
  while (at >= 0 && !lines[at]!.includes(POINTER)) at--
  if (at < 0) return undefined
  const label = highlightedRow.exec(lines[at]!)?.[1]
  // Another row stays highlighted until the moves up land; never press anything on it.
  if (label !== OAUTH_LABEL) return undefined
  const next = lines.slice(at + 1).find((line) => line.trim())
  return next !== undefined && completeLine(next, OAUTH_DESCRIPTION) ? { row: label, target: true } : undefined
}

/** A whole first page of the list is drawn and has no Kimi Code row. */
function oauthMissing(plain: string): boolean {
  const at = plain.lastIndexOf(LOGOUT_TITLE)
  if (at < 0) return false
  const list = plain.slice(at)
  return (
    /Esc cancel[\s\S]*❯[\s\S]*─{8}/.test(list) &&
    !list.includes(OAUTH_DESCRIPTION) &&
    !/Page\s+(?:[2-9]|\d{2,})\//.test(list)
  )
}

const trust: FlowStep = {
  id: 'trust',
  when: ['Trust this folder?'],
  guide: (): AccountGuide => ({
    step: 'trust',
    tone: 'action',
    template: 'trust',
    text: 'Kimi 需要你确认是否信任插件的空账号目录（不含项目文件），确认后插件会自动退出 Kimi Code 登录。',
  }),
  // The first, highlighted choice trusts the folder; only the user's answer types it.
  respond: (response) => ('confirm' in response && response.confirm === 'trust' ? { keys: '\r', resets: true } : undefined),
}

const waiting = (step: string, text: string): AccountGuide => ({ step, tone: 'info', template: 'waiting', text })

export const KIMI_FLOW: FlowDefinition = {
  name: NAME,
  targets: true,
  links: ACCOUNT_LOGIN_HOSTS.kimi,
  // ConPTY may split a code between reads. The native prompt ends its code line
  // before printing the expiry; never display a prefix as a complete code.
  deviceCode: /enter code:[ \t]*([A-Z0-9]{3,12}(?:-[A-Z0-9]{3,12})?)[ \t]*\n/i,
  login: {
    plan: DEVICE_PLAN,
    steps: [
      {
        id: 'device',
        when: (screen) => screen.has('Kimi device login', 'enter code') && !!screen.code,
        guide: (screen) => ({
          step: 'device',
          tone: 'action',
          template: 'deviceCode',
          plan: DEVICE_PLAN,
          stage: 0,
          text: '浏览器已打开 Kimi Code 授权页面。核对页面上的验证码与下方一致后再授权，只确认你自己发起的验证码。授权后会自动完成。',
          link: screen.link,
          code: screen.code,
        }),
      },
    ],
  },
  logout: {
    steps: [
      trust,
      {
        // The TUI's prompt and footer are drawn: the editor takes the command.
        id: 'ready',
        when: ['Welcome to Kimi Code', 'context:'],
        guide: () => waiting('ready', '正在打开 Kimi 的退出列表…'),
        auto: () => '/logout\r',
      },
      {
        id: 'select',
        when: [LOGOUT_TITLE],
        guide: () => waiting('select', '正在选择 Kimi Code 登录…'),
        auto: () => TO_TOP,
        pick: (lines) => kimiOAuthRow(lines),
      },
      {
        id: 'missing',
        when: (screen) => oauthMissing(screen.plain),
        guide: () => ({
          step: 'missing',
          tone: 'warning',
          template: 'native',
          text: 'Kimi 的退出列表中没有 Kimi Code 登录，请在原生终端中查看。',
        }),
      },
      { id: 'nothing', when: ['Nothing to logout'], guide: () => guideTexts(NAME).loggingOut, confirms: 'logout' },
      {
        // `kimi provider remove <key>`; Kimi exits by itself right after.
        id: 'removed',
        when: (screen, ctx) => ctx.login !== 'kimi:kimi-code' && screen.has('Removed provider'),
        guide: () => guideTexts(NAME).loggingOut,
        confirms: 'logout',
      },
    ],
  },
}
