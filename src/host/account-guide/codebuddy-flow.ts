import type { FlowDefinition, FlowStep } from './engine.ts'

// Recorded CodeBuddy 2.181.0, macOS 200×60, isolated HOME, 2026-11-07.
// C1 requires folder trust; C2–C6 were not reachable without accepting it.
// Do not type /login or /logout until their editor/menu paths are captured.
// See openspec/changes/add-new-cli-graphical-login/capture-2026-11-07.md.
const trust: FlowStep = {
  id: 'nativeTrust',
  when: ['Do you trust the files in this folder?', 'Enter to confirm', 'Esc to exit'],
  guide: () => ({ step: 'nativeTrust', tone: 'warning', template: 'native',
    text: 'CodeBuddy 需要确认文件夹信任，请在原生终端中自行处理。之后使用 /login 登录或 /logout 退出。' }),
}
const native: FlowStep = {
  id: 'native',
  when: screen => !!screen.plain.trim(),
  guide: (_screen, ctx) => ({ step: 'native', tone: 'info', template: 'native',
    text: ctx.action === 'logout' ? '在 CodeBuddy 原生终端输入 /logout 退出。'
      : '在 CodeBuddy 原生终端输入 /login，选择中国站或国际站等站点完成登录。' }),
}
export const CODEBUDDY_FLOW: FlowDefinition = {
  name: 'CodeBuddy Code',
  login: { steps: [native, trust] },
  logout: { steps: [native, trust] },
  proves(change, before, after) {
    if (change === 'logout') return after?.state === 'unauthenticated'
    return before?.state === 'unauthenticated' && after?.state === 'authenticated'
  },
}
