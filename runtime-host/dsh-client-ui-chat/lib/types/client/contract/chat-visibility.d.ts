/** Chat-only row visibility; durable events and trajectory inspection remain intact. */
import type { ChatNode } from './chat-nodes.ts';
/**
 * Exclude system prompts, permission commands, and normal Team toggle receipts.
 * Failed Team toggles remain visible.
 * @param node - projected Chat node.
 * @returns whether the node contributes a visible Chat row.
 */
export declare function isVisibleChatNode(node: ChatNode): boolean;
//# sourceMappingURL=chat-visibility.d.ts.map