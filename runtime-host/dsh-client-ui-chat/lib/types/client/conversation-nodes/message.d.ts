import type { Context } from '@deepseek-ai/cordis';
import type { ContextMessageNode, ConversationNodeDefinition, SteeringMessageNode, UserMessageNode } from '@deepseek-ai/dsh-client-ui-conversation/client';
interface ReferencedUserMessageNode extends UserMessageNode {
    /** Labels cited by the immediately following session-reference context. */
    readonly referenceLabels?: readonly string[];
    /** Skill names the same step's `skill-invocation` injections loaded. */
    readonly skillNames?: readonly string[];
}
interface ReferencedSteeringMessageNode extends SteeringMessageNode {
    /** Labels cited by the immediately following session-reference context. */
    readonly referenceLabels?: readonly string[];
    /** Skill names the same step's `skill-invocation` injections loaded. */
    readonly skillNames?: readonly string[];
    /**
     * First human message of its `next-step` claim that Chat orders after its Turn's process control;
     * the row keeps the Turn tail slot above it.
     */
    readonly batchStart?: true;
}
type MessageNode = ReferencedUserMessageNode | ReferencedSteeringMessageNode | (ContextMessageNode & {
    readonly waking?: boolean;
});
declare module '../contract/chat-nodes.ts' {
    interface ChatNodeDataMap {
        /** Ordinary turn-opening user message. */
        user: ReferencedUserMessageNode;
        /** User message admitted into an active turn. */
        steering: ReferencedSteeringMessageNode;
        /** Non-user context injected into model history. */
        context: ContextMessageNode;
        /** Non-human input that starts a Turn. */
        'turn-trigger': ContextMessageNode;
    }
}
/** User, steering, and injected-context message classification Definition. */
export declare const messageDefinition: ConversationNodeDefinition<MessageNode>;
/** Developer history uses the input-message lifecycle and context presentation. */
export declare const developerMessageDefinition: ConversationNodeDefinition<MessageNode>;
/**
 * Register user, steering, injected-context, and developer message contributions.
 * @param ctx - owning UI Conversation context.
 */
export declare function registerMessageConversationNode(ctx: Context): void;
export {};
//# sourceMappingURL=message.d.ts.map