import { ACCOUNT_LOGIN_HOSTS, ACCOUNT_NAME, parseAccountLoginId } from '../../shared/account-links.ts'
import { FlowGuide, guideTexts, type FlowContext, type FlowDefinition, type ScreenView } from './engine.ts'

const LOGIN_PLAN = ['完成服务商授权', '确认登录']

// 18.8.7 (Windows ConPTY) replaced the 16.x footer. Its welcome tip is random;
// wait for the editor's stable shortcut hint, not model-discovery progress.
const ready = (screen: ScreenView) => screen.has('for commands') ||
  screen.has('to change thinking effort')

function logoutTarget(ctx: FlowContext) {
  const target = ctx.login ? parseAccountLoginId(ctx.login) : undefined
  const entry = target?.entry?.match(/^(?:native|plugin)\.([1-9]\d*)$/)
  return target?.cli === 'omp' && entry ? { provider: target.provider, row: entry[1] } : undefined
}

/*
 * OMP 16.4.4 screens captured in isolated homes with simulated credentials.
 * The normal TUI accepts /login and /logout after its welcome screen; its
 * selector redraws only changed rows. Never select by label, email or position:
 * the detail's stored API key / oauth number is auth_credentials.id.
 */
export const OMP_FLOW: FlowDefinition = {
  name: 'OMP',
  targets: true,
  links: ACCOUNT_LOGIN_HOSTS.omp,
  deviceCode: /Enter code:\s*([A-Z0-9]{3,12}(?:-[A-Z0-9]{3,12})?)/i,
  login: {
    plan: LOGIN_PLAN,
    steps: [
      {
        id: 'ready',
        when: (screen, ctx) => ready(screen) && !!ctx.provider && ACCOUNT_NAME.test(ctx.provider),
        guide: () => ({ step: 'ready', tone: 'info', template: 'waiting', text: '正在打开所选服务商的登录步骤…' }),
        auto: (_screen, ctx) => `/login ${ctx.provider}\r`,
      },
      {
        id: 'githubDomain',
        when: (screen, ctx) => ctx.provider === 'github-copilot' && screen.has('GitHub Enterprise URL/domain (blank for github.com)'),
        guide: () => ({
          step: 'githubDomain', tone: 'action', template: 'choice',
          text: '选择 GitHub 账号所在站点。企业自建站点请在原生终端中继续。',
          options: [{ id: 'github.com', label: 'github.com' }],
        }),
        respond: (response) => 'option' in response && response.option === 'github.com' ? { keys: '\r' } : undefined,
      },
      {
        id: 'key',
        when: (screen) => screen.has('Paste your', 'API key'),
        guide: () => ({
          step: 'key', tone: 'action', template: 'secret', plan: ['填写 API Key', '确认登录'], stage: 0,
          text: '粘贴所选服务商的 API Key，它会作为新的凭据加入 OMP。',
        }),
        respond: (response, ctx) => 'secret' in response
          ? { keys: FlowGuide.paste(response.secret.trim(), ctx), enter: true, confirm: 'login' }
          : undefined,
        typedConfirms: 'login',
      },
      {
        id: 'browser',
        when: (screen) => screen.has('Waiting for browser authentication') || screen.has('Tip: You can complete pairing with /login'),
        guide: (screen) => ({
          step: 'browser', tone: 'action', template: 'browserCode', plan: LOGIN_PLAN, stage: 0,
          text: '在浏览器中完成授权。如果授权后没有自动完成，请将完整的跳转地址粘贴到下方。',
          link: screen.link,
        }),
        respond: (response, ctx) => 'code' in response
          ? { keys: FlowGuide.paste(`/login ${response.code.trim()}`, ctx), enter: true, confirm: 'login' }
          : undefined,
        watches: 'login',
      },
      {
        id: 'browser-input',
        // 18.x keeps focus in LoginDialog's manual-code input, rather than the
        // editor where 16.x accepted `/login <redirect URL>` as a command.
        when: (screen) => screen.has('Paste the authorization code (or full redirect URL)'),
        guide: (screen) => ({
          step: 'browser-input', tone: 'action', template: 'browserCode', plan: LOGIN_PLAN, stage: 0,
          text: '在浏览器中完成授权。如果授权后没有自动完成，请将授权码或完整的跳转地址粘贴到下方。',
          link: screen.link,
        }),
        respond: (response, ctx) => 'code' in response
          ? { keys: FlowGuide.paste(response.code.trim(), ctx), enter: true, confirm: 'login' }
          : undefined,
        typedConfirms: 'login',
        watches: 'login',
      },
      {
        id: 'device',
        when: (screen) => screen.has('Enter code:') && !!screen.code,
        guide: (screen) => ({
          step: 'device', tone: 'action', template: 'deviceCode', plan: LOGIN_PLAN, stage: 0,
          text: '打开服务商的授权页面，输入下方设备码并完成授权。只确认你自己发起的设备码。',
          link: screen.link, code: screen.code,
        }),
        watches: 'login',
      },
      {
        id: 'loginResult',
        when: ['Successfully logged in to'],
        guide: () => guideTexts('OMP').confirming,
        confirms: 'login',
      },
    ],
  },
  logout: {
    steps: [
      {
        id: 'ready',
        when: (screen, ctx) => ready(screen) && !!logoutTarget(ctx),
        guide: () => guideTexts('OMP').loggingOut,
        auto: (_screen, ctx) => `/logout ${logoutTarget(ctx)!.provider}\r`,
      },
      {
        id: 'account',
        when: ['account to log out'],
        guide: () => ({ step: 'account', tone: 'info', template: 'waiting', text: '正在定位所选凭据并退出…' }),
        pick: (lines, ctx) => {
          const target = logoutTarget(ctx)
          if (!target) return undefined
          // Last highlighted row wins when a read includes several partial redraws.
          for (const line of [...lines].reverse()) {
            const text = line.trimStart()
            if (!/^[^\p{L}\p{N}\s()[\]{}]\s+/u.test(text)) continue
            const row = text.match(/(?:stored API key|oauth) #([1-9]\d*)\s*$/)?.[1]
            if (row) return { row, target: row === target.row }
          }
          return undefined
        },
      },
      {
        id: 'logoutResult',
        when: (screen) => screen.has('Successfully logged out') || screen.has('Logout skipped:'),
        guide: () => guideTexts('OMP').loggingOut,
        confirms: 'logout',
      },
    ],
  },
}
