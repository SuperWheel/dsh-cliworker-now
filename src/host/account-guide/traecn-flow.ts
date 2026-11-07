import { ACCOUNT_LOGIN_HOSTS } from '../../shared/account-links.ts'
import { FlowGuide, type FlowDefinition } from './engine.ts'

// Recorded TRAE CLI 0.213.1, macOS 200×60, isolated HOME/TRAE_HOME,
// 2026-11-07; see the change's capture-2026-11-07.md. No authorization submitted.
const plan = ['在浏览器中授权', '粘贴回调网址（如未自动完成）', '确认登录']
export const TRAECN_FLOW: FlowDefinition = {
  name: 'TRAE CN',
  links: ACCOUNT_LOGIN_HOSTS.traecn,
  login: {
    plan,
    steps: [
      {
        id: 'enterpriseNative',
        when: (_screen, ctx) => ctx.provider !== 'personal',
        guide: () => ({ step: 'enterpriseNative', template: 'native', tone: 'info',
          text: '请在 TRAE 原生流程中完成企业登录；插件不收集企业 PAT。' }),
      },
      {
        id: 'callback',
        when: (screen, ctx) => ctx.provider === 'personal' && !!screen.link && screen.has(
          'Opening personal sign-in in your browser. If your browser did not open, visit:',
          'Paste callback URL to verify automatically:',
        ),
        guide: screen => ({ step: 'callback', template: 'browserCode', tone: 'action', plan, stage: 0,
          text: '在浏览器中完成 TRAE 个人登录；若未自动完成，粘贴浏览器最后跳转的完整 127.0.0.1 回调网址。', link: screen.link }),
        respond: (response, ctx) => 'code' in response
          ? { keys: FlowGuide.paste(response.code.trim(), ctx), enter: true, confirm: 'login' } : undefined,
        typedConfirms: 'login',
        // Monitor native status as well as process exit; both require a pre-launch signed-out baseline.
        watches: 'login',
      },
    ],
  },
  // Native `logout` exits by itself; its text is not evidence of success.
  logout: { steps: [] },
  proves(change, before, after, exitCode) {
    if (change === 'logout') return exitCode === 0 && after?.state === 'unconfigured'
    return before?.state === 'unconfigured' && after?.state === 'authenticated'
      && (exitCode === undefined || exitCode === 0)
  },
}
