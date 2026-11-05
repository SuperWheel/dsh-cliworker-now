import type { Context } from '@deepseek-ai/cordis';
import type { AssistantBlock, ConversationMatch, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { AssistantChatData } from '../contract/chat-nodes.ts';
declare module '../contract/chat-nodes.ts' {
    interface ChatNodeDataMap {
        /** Streaming, settled, or interrupted Assistant step. */
        'assistant-step': AssistantChatData;
    }
}
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
    interface ConversationStepDataMap {
        /** Streaming, settled, or interrupted Assistant material for this Step. */
        'assistant-step': AssistantChatData;
    }
}
interface AssistantState {
    readonly turn: number;
    readonly step: number;
    readonly blocks: readonly (AssistantBlock | undefined)[];
    /** Missing indices are invisible; same-kind appends preserve already-visible blocks. */
    readonly visibleByIndex: readonly boolean[];
    readonly visibleBlocks: number;
    readonly firstVisibleSeq: number | undefined;
    readonly firstVisibleTime: number | undefined;
    readonly firstTokenTime: number | undefined;
    readonly final: ConversationMatch | undefined;
    readonly usage: unknown;
}
/** Per-step Assistant lifecycle; materialized keys survive cleared stream content as hidden Nodes. */
export declare const assistantDefinition: ConversationNodeDefinition<AssistantState>;
/**
 * Register the Assistant lifecycle business contribution.
 * @param ctx - owning UI Conversation context.
 */
export declare function registerAssistantConversationNode(ctx: Context): void;
export {};
//# sourceMappingURL=assistant.d.ts.map