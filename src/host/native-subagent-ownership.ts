import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'

/** rc.2 moved live ownership into SubagentManager. A shared root alone is not a direct owner. */
export function ownsDirectSubagent(
  subagents: Pick<SubagentRuntime, 'rootOf'> | undefined, parent: Agent, child: Agent,
): boolean {
  if (!subagents || child.id === parent.id || parent.session.header.origin === 'subagent'
    || child.session.header.origin !== 'subagent' || child.session.header.parentSession !== parent.id) return false
  try {
    // rootOf verifies the exact registered Agent and its live runtime owner,
    // rejecting spoofed lineage and stale/reused Agent identities.
    return subagents.rootOf(parent) === parent && subagents.rootOf(child) === parent
  } catch {
    return false
  }
}
