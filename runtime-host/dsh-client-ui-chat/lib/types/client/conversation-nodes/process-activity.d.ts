import type { ProcessActivitySummary } from '../contract/process-groups.ts';
import type { ChatNode } from '../contract/chat-nodes.ts';
/**
 * Rank categories by distinct call count, breaking ties by first appearance.
 * A group whose members are all Context reports one `context` category counting those members; Context beside other members adds no count.
 * @param nodes - process members, including recursive tools.
 * @returns all ranked categories and the latest running tool category and bounded task detail.
 */
export declare function processActivity(nodes: readonly ChatNode[]): ProcessActivitySummary;
//# sourceMappingURL=process-activity.d.ts.map