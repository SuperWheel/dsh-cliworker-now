/** Presentation of durable non-human messages claimed to begin a Turn. */
import type { ContextMessageNode } from '../contract/snapshot.ts';
import type { ChatKey } from '../locale.ts';
/** Existing primitive glyph selected for a Turn trigger's source family. */
export type TurnTriggerIcon = 'agent' | 'continue' | 'github' | 'goal' | 'job' | 'plugin' | 'request' | 'schedule' | 'subagent' | 'team' | 'webhook';
/**
 * Describe a waking message using its recorded source.
 * @param node - durable context, including the original notification body.
 * @returns localized title, source-family icon, and compact presentation for continuation receipts.
 */
export declare function turnTriggerDetails(node: ContextMessageNode): {
    title: ChatKey;
    icon: TurnTriggerIcon;
    compact?: true;
};
//# sourceMappingURL=turn-trigger.d.ts.map