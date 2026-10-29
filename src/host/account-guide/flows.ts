import type { AccountAction, AccountLoginMode } from '../../shared/accounts.ts'
import type { CliId } from '../../shared/types.ts'
import { AgyAccountGuide } from '../agy-account-guide.ts'
import { FlowGuide, type AccountGuideDriver, type FlowDefinition } from './engine.ts'
import { HERMES_FLOW, HERMES_NOUS_FLOW, OPENCODE_FLOW } from './multi-account.ts'
import { KIMI_FLOW } from './kimi-flow.ts'
import { OMP_FLOW } from './omp-flow.ts'
import { PI_FLOW } from './pi-flow.ts'
import { CLAUDE_FLOW, CODEX_FLOW, GROK_FLOW, MIMO_FLOW, QODERCN_FLOW, QODER_FLOW, ZCODE_FLOW } from './single-account.ts'

/** CLIs whose login/logout window the plugin draws; every other CLI keeps its native terminal. */
const FLOWS: Partial<Record<CliId, FlowDefinition>> = {
  codex: CODEX_FLOW,
  claude: CLAUDE_FLOW,
  qoder: QODER_FLOW,
  qodercn: QODERCN_FLOW,
  grok: GROK_FLOW,
  zcode: ZCODE_FLOW,
  mimo: MIMO_FLOW,
}

/** CLIs that keep several logins: guided only for a provider picked, or one login removed, in the account window. */
const MULTI_FLOWS: Partial<Record<CliId, FlowDefinition>> = {
  opencode: OPENCODE_FLOW,
  hermes: HERMES_FLOW,
  pi: PI_FLOW,
  omp: OMP_FLOW,
  kimi: KIMI_FLOW,
}

export function accountFlow(cli: CliId): FlowDefinition | undefined {
  return FLOWS[cli]
}

export function createAccountGuide(
  cli: CliId,
  action: AccountAction,
  options: { provider?: string; mode?: AccountLoginMode; login?: string; stores?: string } = {},
): AccountGuideDriver | undefined {
  if (action === 'manage') return undefined
  if (cli === 'antigravity') return new AgyAccountGuide(action)
  // Nous uses native device OAuth (including an optional shared-login prompt), not the API-key flow.
  if (cli === 'hermes' && action === 'login' && options.provider === 'nous')
    return new FlowGuide(HERMES_NOUS_FLOW, { action, ...options })
  // A provider picked in the window, or one login to remove; the native pickers stay native.
  const several = MULTI_FLOWS[cli]
  if (several) {
    if (action === 'login' ? !options.provider : !options.login) return undefined
    return new FlowGuide(several, { action, ...options })
  }
  const flow = FLOWS[cli]
  if (!flow || (action === 'login' ? !flow.login : !flow.logout)) return undefined
  return new FlowGuide(flow, { action, ...options })
}
