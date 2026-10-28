import { cliOf, type CliId, type Worker } from './types.ts'
import { workerPlanSupported } from './worker-permissions.ts'

/** Harness conversation features bridged onto a CLI Worker conversation. */
export type BridgedConversationFeature = 'goal' | 'plan' | 'feedback' | 'fork' | 'forkEarlier'

export interface BridgedFeatureSupport {
  supported: boolean
  /** Shown as the hover tooltip when the control is disabled. */
  reason?: string
}

/** Plugin-owned persistent objective. It is injected into each turn; it never starts a turn by itself. */
export interface WorkerGoal {
  objective: string
  status: 'active' | 'paused'
  revision: number
  updatedAt: string
}

export const GOAL_OBJECTIVE_LIMIT = 4000

/**
 * Native fork evidence per CLI (see openspec/changes/bridge-conversation-features/design.md).
 * `latest`: fork after the latest completed turn. `earlier`: fork at an earlier completed turn.
 */
export const forkSupport: Partial<Record<CliId, { latest: boolean; earlier: boolean }>> = {
  codex: { latest: true, earlier: true },
  opencode: { latest: true, earlier: false },
  pi: { latest: true, earlier: false },
  zcode: { latest: true, earlier: false },
  claude: { latest: true, earlier: false },
  kimi: { latest: true, earlier: false },
  mimo: { latest: true, earlier: false },
  qoder: { latest: true, earlier: false },
  qodercn: { latest: true, earlier: false },
}

export const noForkReason: Partial<Record<CliId, string>> = {
  antigravity: '当前 CLI 不支持会话分支：Antigravity 未公开原生分支接口',
  hermes: '当前 CLI 不支持会话分支：Hermes 原生分支会结束原会话',
  grok: '当前 CLI 不支持会话分支：已确认 --fork-session，但当前 ACP 的 x.ai/session/fork 参数和回执尚未核实',
  omp: '当前 CLI 不支持会话分支：RPC 只有从用户条目前分支的 branch，未确认包含最新完成轮的 clone 接口',
}

export function bridgedFeatureSupport(
  worker: Pick<Worker, 'preference' | 'transport'>,
): Record<BridgedConversationFeature, BridgedFeatureSupport> {
  const cli = cliOf(worker.preference)
  const plan = workerPlanSupported(worker)
  const expectedTransport: Partial<Record<CliId, string>> = { codex: 'codex-app-v1', claude: 'claude-stream-v1', kimi: 'kimi-acp-v1', mimo: 'mimo-http-v1', zcode: 'zcode-app-v1', pi: 'pi-rpc-v1', opencode: 'opencode-http-v1', qoder: 'qoder-acp-v1', qodercn: 'qodercn-acp-v1' }
  const fork = worker.transport === expectedTransport[cli] ? forkSupport[cli] : undefined
  return {
    goal: { supported: true },
    plan: plan ? { supported: true } : { supported: false, reason: '当前 CLI 不支持规划模式' },
    feedback: { supported: true },
    fork: fork?.latest
      ? { supported: true }
      : { supported: false, reason: noForkReason[cli] ?? '当前 CLI 通信协议不支持会话分支，请使用原生会话 Worker' },
    forkEarlier: fork?.earlier
      ? { supported: true }
      : { supported: false, reason: '当前 CLI 只支持从最新一轮分支' },
  }
}
