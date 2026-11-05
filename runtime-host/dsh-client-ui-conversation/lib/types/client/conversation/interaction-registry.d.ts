/** Plugin-owned text gesture handlers, scoped by the dispatching conversation. */
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { TextInteractionDefinition, TextInteractionGesture } from '../contract/text-interaction.ts';
import { ConversationDefinitionRegistry } from './definition-registry.ts';
/** Effect-owned registrations; active surfaces belong to individual Chat views. */
export declare class ConversationInteractionRegistry extends ConversationDefinitionRegistry<TextInteractionDefinition> {
    private ids;
    /**
     * Register a synchronous handler and its keyed renderer identity.
     * @param definition - uniquely named plugin handler.
     * @returns idempotent disposer tied to the registering plugin's lifetime.
     */
    register(definition: TextInteractionDefinition): () => void;
    /**
     * Offer a gesture until one handler opens its surface; opening never prevents browser defaults.
     * @param sessionId - conversation where the gesture occurred.
     * @param gesture - synchronous access to the browser event and DOM text.
     * @returns selected renderer ID, or null when no plugin opens a surface.
     */
    dispatch(sessionId: SessionId, gesture: TextInteractionGesture): string | null;
    /**
     * Observe registration changes so Chat views can dismiss stale surfaces.
     * @returns stable IDs until the registry changes.
     */
    getSnapshot(): readonly string[];
    protected refresh(): void;
}
//# sourceMappingURL=interaction-registry.d.ts.map