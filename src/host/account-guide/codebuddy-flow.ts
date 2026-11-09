import { ACCOUNT_LOGIN_HOSTS } from '../../shared/account-links.ts'
import type { FlowDefinition, FlowStep, ScreenView } from './engine.ts'

// CodeBuddy 2.181.0, isolated macOS 200×60, 2026-11-07. Stable recorded markers;
// paths, model names and ports are deliberately not readiness evidence.
// See openspec/changes/add-new-cli-graphical-login/capture-2026-11-07.md.
const sites = [
  { id: 'china', label: '中国站', native: 'Log in via Chinese Site' },
  { id: 'international', label: '国际站', native: 'Log in via International Site' },
  { id: 'enterprise', label: '企业域', native: 'Log in via Enterprise Domain' },
  { id: 'ioa', label: 'iOA（仅腾讯员工）', native: 'Log in via iOA (Tencent only)' },
] as const
const menuMarkers = ['Select login method:', ...sites.map(site => site.native), '(Use ↑↓ to select, Enter to login)']
function selectedSite(screen: ScreenView): number {
  if (!screen.has(...menuMarkers)) return -1
  const rows = screen.plain.split('\n').map(line => line.trim()).filter(line => /^(?:❯\s*)?Log in via /.test(line))
  if (rows.length !== sites.length || !rows.every((row, i) => row.replace(/^❯\s*/, '') === sites[i]!.native)) return -1
  const highlighted = rows.flatMap((row, i) => row.startsWith('❯ ') ? [i] : [])
  return highlighted.length === 1 ? highlighted[0]! : -1
}
const editorReady = (screen: ScreenView) => screen.has('CodeBuddy Code v', '← for agents · ? for shortcuts') &&
  /^>\s*$/m.test(screen.plain) && !screen.has('Select login method:') && !screen.has('Do you trust the files in this folder?')
const trustSelected = (screen: ScreenView) => screen.has('Do you trust the files in this folder?', 'Enter to confirm', 'Esc to exit') &&
  /^\s*(?:│\s*)?> 1\. Trust folder only \([^\n]+\)/m.test(screen.plain)
const trust: FlowStep = {
  id: 'trust', when: trustSelected,
  guide: () => ({ step: 'trust', tone: 'action', template: 'trust',
    text: 'CodeBuddy 首次在此项目文件夹运行，需要你确认是否信任该文件夹。确认后仅信任当前文件夹。' }),
  respond: (response, _ctx, screen) => 'confirm' in response && response.confirm === 'trust' && trustSelected(screen)
    ? { keys: '\r', resets: true } : undefined,
}
// Hands over unknown screens once a recorded CodeBuddy screen has been seen; the startup
// splash before the editor is not one, and falls back only if it settles unrecognized.
const native: FlowStep = {
  id: 'native', afterRecognized: true, when: screen => !!screen.plain.trim(),
  guide: () => ({ step: 'native', tone: 'warning', template: 'native', text: '无法识别当前步骤，请在原生终端中继续。' }),
}
const site: FlowStep = {
  id: 'site', when: screen => selectedSite(screen) >= 0,
  guide: () => ({ step: 'site', tone: 'action', template: 'choice', cards: true, text: '选择 CodeBuddy 登录站点。',
    options: sites.map(({ id, label }) => ({ id, label, ...(id === 'enterprise' || id === 'ioa' ? { detail: '在原生终端中继续' } : {}) })) }),
  respond: (response, _ctx, screen) => {
    const current = selectedSite(screen), target = 'option' in response ? sites.findIndex(site => site.id === response.option) : -1
    if (current < 0 || target < 0) return undefined
    // Compute movement from the *current* full redraw, never assume the first row.
    const delta = target - current
    return { keys: (delta < 0 ? '\x1b[A' : '\x1b[B').repeat(Math.abs(delta)), enter: true, resets: true }
  },
}
const browser: FlowStep = {
  id: 'browser',
  when: screen => screen.has("Browser didn't open? Use the url below to sign in:", 'Waiting for auth...', '(Press ESC to cancel)') &&
    !!screen.link && !new URL(screen.link).searchParams.has('ioa'),
  guide: screen => ({ step: 'browser', tone: 'action', template: 'browser', link: screen.link,
    plan: ['在浏览器中授权', '确认登录'], stage: 0,
    text: '打开 CodeBuddy 登录页面完成授权，插件会自动确认登录状态。' }),
  watches: 'login',
}
// A sign-in that did not finish: the browser page timed out after 5 minutes (TimeoutError,
// Windows 2026-11-08) or could not be opened (OpenExternalLinkError, isolated macOS capture).
// Esc returns to the site menu; the native reason is not shown in the window.
const failedMarker = 'Failed to login. Press esc to return to login'
const failed: FlowStep = {
  id: 'failed', when: [failedMarker],
  guide: screen => ({ step: 'failed', tone: 'warning', template: 'choice',
    text: /Login failed: TimeoutError/.test(screen.plain)
      ? 'CodeBuddy 浏览器授权已超时，登录未完成。'
      : 'CodeBuddy 登录未完成。',
    options: [{ id: 'retry', label: '重新登录' }] }),
  respond: (response, _ctx, screen) => 'option' in response && response.option === 'retry' && screen.has(failedMarker)
    ? { keys: '\x1b', resets: true } : undefined,
}
// Enterprise domain and iOA sign-in are answered in the native terminal on purpose (the site
// card says so); recorded screens, so they open it instead of the unrecognized-screen fallback.
const enterprise: FlowStep = {
  id: 'enterprise', when: ['Custom Endpoint', 'Enter your custom endpoint address', 'Enter to save · Esc to cancel'],
  guide: () => ({ step: 'enterprise', tone: 'action', template: 'native',
    text: '请在下方原生终端中输入企业域地址并按回车；插件不收集企业凭据。' }),
}
const ioa: FlowStep = {
  id: 'ioa',
  when: screen => screen.has('Waiting for auth...', '(Press ESC to cancel)') && !!screen.link && new URL(screen.link).searchParams.has('ioa'),
  guide: () => ({ step: 'ioa', tone: 'action', template: 'native', text: '请在下方原生终端中按 CodeBuddy 的提示完成 iOA 登录。' }),
}
// The editor after `/login` was already typed once: a sign-in left without finishing.
const editor: FlowStep = {
  id: 'editor', when: editorReady,
  guide: () => ({ step: 'editor', tone: 'info', template: 'waiting', text: '正在打开 CodeBuddy 登录站点选择…' }),
  auto: () => ({ keys: '/login', enter: true }),
  again: () => ({ step: 'editor', tone: 'warning', template: 'choice',
    text: 'CodeBuddy 已回到输入界面。浏览器授权完成后插件会自动确认登录；尚未授权可以重新登录。',
    options: [{ id: 'login', label: '重新登录' }] }),
  respond: (response, _ctx, screen) => 'option' in response && response.option === 'login' && editorReady(screen)
    ? { keys: '/login', enter: true, resets: true } : undefined,
}
export const CODEBUDDY_FLOW: FlowDefinition = {
  name: 'CodeBuddy Code', revisit: true, links: ACCOUNT_LOGIN_HOSTS.codebuddy,
  login: { steps: [native, trust, editor, site, browser, enterprise, ioa, failed] },
  logout: {
    steps: [native, trust],
    command: { text: '/logout', ready: editorReady, requireReady: true,
      signedOut: menuMarkers, menu: ['Select login method:'], verifySignedOut: true, retry: false },
  },
  proves(change, before, after) {
    if (change === 'logout') return after?.state === 'unauthenticated'
    return before?.state === 'unauthenticated' && after?.state === 'authenticated'
  },
}
