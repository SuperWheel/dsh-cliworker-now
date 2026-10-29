import type { AccountGuide } from '../../shared/accounts.ts'
import { ACCOUNT_LOGIN_HOSTS } from '../../shared/account-links.ts'
import { FlowGuide, type FlowDefinition, type FlowStep } from './engine.ts'

/*
 * One provider login of a CLI that keeps several. The plugin starts the CLI on
 * the provider the user chose (`opencode auth login -p <id>`, `hermes auth add
 * <id> --type api-key`) and signs out one login with the CLI's own command
 * (`opencode auth logout <id>`, `hermes auth remove <id> <entry>`), which ends
 * by itself. Markers come from screens captured in isolated homes with
 * simulated credentials on 2026-10-27 (OpenCode 1.19.0, Hermes 3f2abce7).
 */

const KEY_PLAN = ['填写 API Key', '确认登录']

/** A masked key prompt; the key goes to the CLI and nowhere else. */
const apiKey = (when: readonly string[], text: string): FlowStep => ({
  id: 'key',
  when,
  guide: () => ({ step: 'key', tone: 'action', template: 'secret', plan: KEY_PLAN, stage: 0, text }),
  respond: (response, ctx) =>
    'secret' in response ? { keys: FlowGuide.paste(response.secret.trim(), ctx), enter: true, confirm: 'login' } : undefined,
})

export const OPENCODE_FLOW: FlowDefinition = {
  name: 'OpenCode',
  targets: true,
  links: ACCOUNT_LOGIN_HOSTS.opencode,
  deviceCode: /Enter\s+code:\s*([A-Z0-9]{3,12}(?:-[A-Z0-9]{3,12})?)(?=\s|$)/i,
  login: {
    plan: KEY_PLAN,
    steps: [
      {
        // OpenCode reads its provider catalog first; this took ~15 s in a fresh home.
        id: 'loading',
        when: ['Add credential'],
        guide: () => ({ step: 'loading', tone: 'info', template: 'waiting', plan: KEY_PLAN, stage: 0, text: '正在读取服务商信息…' }),
      },
      {
        id: 'native-method',
        when: ['Login method', '└'],
        guide: () => ({ step: 'native-method', tone: 'action', template: 'native', text: '请在原生终端中选择此服务商的登录方式。' }),
      },
      {
        id: 'openai-method',
        when: (screen, ctx) => ctx.provider === 'openai' && screen.has(
          'Login method', '● ChatGPT Pro/Plus (browser)', '○ ChatGPT Pro/Plus (headless)', '○ Manually enter API Key',
        ),
        guide: () => ({
          step: 'openai-method', tone: 'action', template: 'choice', text: '选择 OpenAI 登录方式。',
          options: [
            { id: 'browser', label: 'ChatGPT 浏览器登录' },
            { id: 'device', label: 'ChatGPT 设备码登录' },
            { id: 'api-key', label: '使用 API Key' },
          ],
        }),
        respond: (response) => {
          if (!('option' in response)) return undefined
          if (response.option === 'browser') return { keys: '\r', resets: true }
          if (response.option === 'device') return { keys: '\x1b[B', enter: true, resets: true }
          if (response.option === 'api-key') return { keys: '\x1b[B\x1b[B', enter: true, resets: true }
          return undefined
        },
      },
      {
        ...apiKey(['Enter your API key'], '粘贴该服务商控制台中的 API Key。同一服务商已有的凭据会被替换。'),
        typedConfirms: 'login',
      },
      {
        id: 'browser',
        when: (screen) => screen.has('Go to:') && !!screen.link,
        guide: (screen) => ({
          step: 'browser', tone: 'action', template: 'browser',
          plan: ['在浏览器中授权', '确认登录'], stage: 0,
          text: '打开下方链接完成授权，随后会自动确认登录。', link: screen.link,
        }),
        watches: 'login',
      },
      {
        id: 'device',
        when: (screen) => screen.has('Enter code:') && !!screen.code && !!screen.link,
        guide: (screen) => ({
          step: 'device', tone: 'action', template: 'deviceCode',
          plan: ['在浏览器中确认验证码', '确认登录'], stage: 0,
          text: '打开下方链接，核对并填写本次登录的验证码，授权后会自动确认登录。',
          link: screen.link, code: screen.code,
        }),
        watches: 'login',
      },
      {
        id: 'saved',
        when: ['Login successful'],
        guide: () => ({ step: 'saved', tone: 'info', template: 'waiting', text: '正在确认登录…' }),
        confirms: 'login',
      },
      {
        id: 'failed',
        when: (screen) => screen.has('Failed to authorize') || screen.has('Unknown provider'),
        guide: () => ({ step: 'failed', tone: 'warning', template: 'native', text: 'OpenCode 未能完成登录，请查看原生终端中的提示。' }),
      },
    ],
  },
  logout: { steps: [] },
}

export const HERMES_FLOW: FlowDefinition = {
  name: 'Hermes',
  targets: true,
  login: {
    plan: KEY_PLAN,
    steps: [
      {
        // The label is optional; blank keeps Hermes' own `api-key-N`.
        id: 'label',
        when: ['Label / account name (optional)'],
        guide: () => ({ step: 'label', tone: 'info', template: 'waiting', plan: KEY_PLAN, stage: 0, text: '正在准备凭据…' }),
        auto: () => '\r',
      },
      {
        ...apiKey(['Paste your API key'], '粘贴该服务商控制台中的 API Key，它会作为新的凭据加入 Hermes。'),
        // Hermes saves the key only after its label prompt (auth_commands.py `_add_api_key_credential`).
        respond: (response, ctx) =>
          'secret' in response ? { keys: FlowGuide.paste(response.secret.trim(), ctx), enter: true } : undefined,
      },
      {
        // On a terminal Hermes asks for the label after the key; blank keeps its own `api-key-N`.
        id: 'saving',
        when: ['Label (optional, default:'],
        guide: () => ({ step: 'saving', tone: 'info', template: 'waiting', plan: KEY_PLAN, stage: 1, text: '正在保存凭据…' }),
        auto: () => '\r',
      },
      {
        id: 'added',
        when: (screen) => screen.has('Added') && screen.has('credential #'),
        guide: () => ({ step: 'added', tone: 'info', template: 'waiting', plan: KEY_PLAN, stage: 1, text: '正在确认登录…' }),
        confirms: 'login',
      },
    ],
  },
  logout: { steps: [] },
}

const NOUS_PLAN = ['在浏览器中确认验证码', '确认登录']
const nousWaiting = (step: string, text: string): AccountGuide => ({ step, tone: 'info', template: 'waiting', plan: NOUS_PLAN, stage: 0, text })

/** `hermes auth add nous --type oauth` (auth_commands.py, auth_nous.py, auth_device_flow.py; Hermes
 * 2026-10-29): a login already saved in the home's shared Nous store is imported first, otherwise a
 * device code is shown. Choosing Nous in the window answers the import prompt (user request
 * 2026-10-29). Completion still requires the target's reread account evidence. */
export const HERMES_NOUS_FLOW: FlowDefinition = {
  name: 'Hermes',
  targets: true,
  links: ACCOUNT_LOGIN_HOSTS.hermes,
  deviceCode: /enter code:\s*([A-Z0-9]{3,12}(?:-[A-Z0-9]{3,12})?)/i,
  login: {
    plan: NOUS_PLAN,
    steps: [
      {
        id: 'import',
        when: ['Import these credentials? [Y/n]'],
        guide: () => nousWaiting('import', '正在沿用已保存的 Nous 登录…'),
        auto: () => 'y\r',
      },
      {
        // Also where a failed import falls back to a new device login.
        id: 'starting',
        when: ['Starting Hermes login via'],
        guide: () => nousWaiting('starting', '正在连接 Nous Portal…'),
      },
      {
        id: 'device',
        when: (screen) => screen.has('To continue', 'enter code') && !!screen.code,
        guide: (screen) => ({
          step: 'device',
          tone: 'action',
          template: 'deviceCode',
          plan: NOUS_PLAN,
          stage: 0,
          text: screen.has('Opened browser for verification')
            ? '浏览器已打开 Nous Portal 授权页面。核对页面上的验证码与下方一致后再授权，只确认你自己发起的验证码。授权后会自动完成。'
            : '打开下方链接，在 Nous Portal 核对验证码与下方一致后再授权，只确认你自己发起的验证码。授权后会自动完成。',
          link: screen.link,
          code: screen.code,
        }),
        watches: 'login',
      },
      {
        id: 'saved',
        when: (screen) => screen.has('Imported nous OAuth credentials') || screen.has('Saved nous OAuth device-code credentials'),
        guide: () => nousWaiting('saved', '正在确认登录…'),
        confirms: 'login',
      },
    ],
  },
}
