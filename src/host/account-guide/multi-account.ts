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
  login: {
    plan: KEY_PLAN,
    steps: [
      {
        // OpenCode reads its provider catalog first; this took ~15 s in a fresh home.
        id: 'loading',
        when: ['Add credential'],
        guide: () => ({ step: 'loading', tone: 'info', template: 'waiting', plan: KEY_PLAN, stage: 0, text: '正在读取服务商信息…' }),
      },
      apiKey(['Enter your API key'], '粘贴该服务商控制台中的 API Key。同一服务商已有的凭据会被替换。'),
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
      apiKey(['Paste your API key'], '粘贴该服务商控制台中的 API Key，它会作为新的凭据加入 Hermes。'),
    ],
  },
  logout: { steps: [] },
}

/** Nous OAuth has a native shared-login prompt and device authorization, never an API-key prompt.
 * The empty steps deliberately hand the screen to the native terminal; completion still
 * requires the target's reread account evidence, not the CLI's success message. */
export const HERMES_NOUS_FLOW: FlowDefinition = {
  name: 'Hermes',
  targets: true,
  login: { steps: [] },
}
