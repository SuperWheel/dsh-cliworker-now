import type { AccountGuide } from '../../shared/accounts.ts'
import { ACCOUNT_LOGIN_HOSTS } from '../../shared/account-links.ts'
import { FlowGuide, guideTexts, type FlowDefinition, type FlowStep } from './engine.ts'

/*
 * Login windows of CLIs that hold one account. Markers come from real screens
 * captured in isolated homes on 2026-10-26 (200×60, nothing submitted); see
 * doc/tasks.md. A CLI that ends its own login or logout is confirmed from its
 * account status after it exits.
 */

const BROWSER_PLAN = ['在浏览器中授权', '确认登录']
const CODE_PLAN = ['在浏览器中授权', '粘贴授权码（如页面显示）']

const browser = (id: string, when: readonly string[], text: string): FlowStep => ({
  id,
  when,
  guide: (screen) => ({ step: id, tone: 'action', template: 'browser', plan: BROWSER_PLAN, stage: 0, text, link: screen.link }),
})

/** A browser sign-in that may show a code to paste back; Enter submits it. */
const browserCode = (id: string, when: readonly string[], text: string): FlowStep => ({
  id,
  when,
  guide: (screen) => ({ step: id, tone: 'action', template: 'browserCode', plan: CODE_PLAN, stage: 0, text, link: screen.link }),
  respond: (response, ctx) =>
    'code' in response ? { keys: FlowGuide.paste(response.code.trim(), ctx), enter: true, confirm: 'login' } : undefined,
  typedConfirms: 'login',
})

const notSignedIn = (name: string, id: string, when: readonly string[]): FlowStep => ({
  id,
  when,
  ends: true,
  guide: () => guideTexts(name).notSignedIn,
})

const trust = (text: string, keys: string): FlowStep => ({
  id: 'trust',
  when: [],
  guide: (): AccountGuide => ({ step: 'trust', tone: 'action', template: 'trust', text }),
  respond: (response) => ('confirm' in response && response.confirm === 'trust' ? { keys, resets: true } : undefined),
})

export const CODEX_FLOW: FlowDefinition = {
  name: 'Codex',
  links: ACCOUNT_LOGIN_HOSTS.codex,
  login: {
    plan: BROWSER_PLAN,
    steps: [
      browser(
        'browser',
        ['navigate to this URL to authenticate'],
        '浏览器已打开 ChatGPT 登录页面。登录并授权后会自动完成，无需回到这里操作。',
      ),
    ],
  },
  logout: { steps: [notSignedIn('Codex', 'notSignedIn', ['Not logged in'])] },
}

export const CLAUDE_FLOW: FlowDefinition = {
  name: 'Claude Code',
  links: ACCOUNT_LOGIN_HOSTS.claude,
  login: {
    plan: CODE_PLAN,
    steps: [
      browserCode(
        'code',
        ['Paste code here if prompted'],
        '浏览器已打开 Claude 登录页面。授权后通常会自动完成；如果页面显示授权码，把它复制下来粘贴到下方。',
      ),
    ],
  },
  logout: { steps: [] },
}

const qoder = (name: string): FlowDefinition => ({
  name,
  links: ACCOUNT_LOGIN_HOSTS[name === 'Qoder' ? 'qoder' : 'qodercn'],
  login: {
    plan: BROWSER_PLAN,
    steps: [
      browser(
        'browser',
        ['open the following URL in your browser to sign in'],
        `浏览器已打开 ${name} 登录页面。选择账号并授权后会自动完成。`,
      ),
    ],
  },
  logout: {
    // The TUI starts in the project folder; trust is the user's answer, never the plugin's.
    steps: [{ ...trust(`${name} 首次在此项目文件夹运行，需要你确认是否信任该文件夹，确认后插件会自动退出登录。`, '\r'), when: ['1. Trust folder'] }],
    command: {
      text: '/logout',
      // Signed out, the TUI asks to sign in before any prompt; Enter there would start a login.
      signedOut: ['Sign in to continue'],
      menu: ['Sign in to continue'],
    },
  },
})
export const QODER_FLOW = qoder('Qoder')
export const QODERCN_FLOW = qoder('Qoder CN')

export const GROK_FLOW: FlowDefinition = {
  name: 'Grok',
  links: ACCOUNT_LOGIN_HOSTS.grok,
  // Grok prints "Then enter" when the verification URL does not embed the code.
  deviceCode: /(?:Confirm this code in your browser|Then enter this code):\s*([A-Z0-9]{4,8}-[A-Z0-9]{4,8})/,
  login: {
    plan: ['在浏览器中确认验证码', '确认登录'],
    steps: [
      browser(
        'browser',
        ['Open this URL to sign in'],
        '打开 xAI 登录页面完成授权；如果浏览器没有自动打开，请点击下方链接。',
      ),
      {
        ...browserCode(
          'callback',
          ["Paste the URL here if it doesn't connect"],
          '在浏览器中完成 xAI 授权；如果未自动完成，请复制浏览器最后跳转的完整网址并粘贴到下方。',
        ),
        guide: (screen) => ({
          step: 'callback',
          tone: 'action',
          template: 'browserCode',
          plan: ['在浏览器中授权', '粘贴回调网址（如未自动完成）', '确认登录'],
          stage: 0,
          text: '在浏览器中完成 xAI 授权；如果未自动完成，请复制浏览器最后跳转的完整网址并粘贴到下方。',
          link: screen.link,
        }),
      },
      {
        id: 'device',
        when: (screen) =>
          (screen.has('Confirm this code in your browser') || screen.has('Then enter this code')) && !!screen.code,
        guide: (screen) => ({
          step: 'device',
          tone: 'action',
          template: 'deviceCode',
          plan: ['在浏览器中确认验证码', '确认登录'],
          stage: 0,
          text: '在浏览器中打开 xAI 验证页面，核对页面上的验证码与下方一致后再授权。只确认你自己发起的验证码。',
          link: screen.link,
          code: screen.code,
        }),
      },
      {
        // Windows 1.0.50 ConPTY capture: login can fail before printing any URL.
        // Show a fixed diagnosis, never echo the request URL or native error.
        id: 'networkError',
        when: (screen) =>
          screen.has('Error: error sending request for url') &&
          (screen.has('operation timed out') || screen.has('tcp connect error')),
        ends: true,
        guide: () => ({
          step: 'networkError',
          tone: 'warning',
          template: 'result',
          text: 'Grok 无法连接登录服务。请检查网络或 Grok 的代理设置，然后重新登录。',
        }),
      },
    ],
  },
  logout: { steps: [notSignedIn('Grok', 'notSignedIn', ['No cached session to log out of'])] },
}

export const ZCODE_FLOW: FlowDefinition = {
  name: 'ZCode',
  links: ACCOUNT_LOGIN_HOSTS.zcode,
  login: {
    plan: BROWSER_PLAN,
    steps: [
      browser(
        'browser',
        [],
        '浏览器已打开授权页面。登录并授权后会自动完成，无需回到这里操作。',
      ),
    ].map((step) => ({ ...step, when: (screen) => screen.has('Fallback URL') || screen.has('Open this URL to sign in') })),
  },
  logout: { steps: [] },
}

export const MIMO_FLOW: FlowDefinition = {
  name: 'MiMo',
  links: ACCOUNT_LOGIN_HOSTS.mimo,
  login: {
    plan: ['选择服务商', ...CODE_PLAN],
    steps: [
      {
        id: 'provider',
        when: ['Add credential', '选择服务商'],
        guide: () => ({
          step: 'provider',
          tone: 'action',
          template: 'choice',
          plan: ['选择服务商', ...CODE_PLAN],
          stage: 0,
          text: '使用小米 MiMo 账号登录。',
          options: [{ id: 'mimo', label: '使用 MiMo 账号登录', detail: '其他服务商请打开原生终端操作。' }],
        }),
        // The first, highlighted item is MiMo.
        respond: (response) => ('option' in response && response.option === 'mimo' ? { keys: '\r' } : undefined),
      },
      {
        ...browserCode(
          'code',
          ['Paste code here if prompted'],
          '浏览器已打开 MiMo 登录页面。授权后通常会自动完成；如果页面显示授权码，把它复制下来粘贴到下方。',
        ),
        guide: (screen) => ({
          step: 'code',
          tone: 'action',
          template: 'browserCode',
          plan: ['选择服务商', ...CODE_PLAN],
          stage: 1,
          text: '浏览器已打开 MiMo 登录页面。授权后通常会自动完成；如果页面显示授权码，把它复制下来粘贴到下方。',
          link: screen.link,
        }),
      },
    ],
  },
  logout: {
    steps: [
      notSignedIn('MiMo', 'notSignedIn', ['No credentials found']),
      {
        // `mimo auth logout` takes no provider: it lists every credential, the first highlighted.
        id: 'provider',
        when: ['Remove credential', 'Select provider'],
        guide: () => guideTexts('MiMo').loggingOut,
        pick: (lines) => mimoLogoutRow(lines),
      },
      { id: 'removed', when: ['Logout successful'], guide: () => guideTexts('MiMo').loggingOut, confirms: 'logout' },
    ],
  },
}

/** The provider MiMo's own login stores (`auth.json` key `xiaomi`), listed as "Xiaomi (api)". */
const MIMO_ROW = 'Xiaomi'
/** The highlighted row (●) of MiMo 0.1.15's "Remove credential" list, once drawn in full. */
export function mimoLogoutRow(lines: string[]): { row: string; target: boolean } | undefined {
  for (let at = lines.length - 1; at >= 0; at--) {
    const found = /●\s+(\S.*?)\s+\((\w+)\)/.exec(lines[at]!)
    if (found) return { row: `${found[1]} (${found[2]})`, target: found[1] === MIMO_ROW }
  }
  return undefined
}
