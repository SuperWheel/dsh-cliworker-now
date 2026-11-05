import type { RefObject } from 'react';
import type { TextInteractionGesture, TextInteractionSurface, TextInteractionTrigger } from '@deepseek-ai/dsh-client-ui-conversation/client';
/** Current area-owned surface and its actions. */
export interface TextInteractionBinding extends Omit<TextInteractionSurface, 'trigger'> {
    readonly active: {
        readonly id: string;
        readonly trigger: TextInteractionTrigger;
    } | null;
}
/**
 * Own text interactions for one positioned content area and its local surface.
 * @param rootRef - existing content element with position: relative.
 * @param surfaceRef - absolute surface inside that element; only the selected Slot consumer is mounted.
 * @param dispatchInteraction - framework-injected plugin gesture dispatch.
 * @param registeredIds - live registered owners used to dismiss removed plugins.
 * @returns current owner and area-local selection actions.
 */
export declare function useTextInteraction(rootRef: RefObject<HTMLElement>, surfaceRef: RefObject<HTMLElement>, dispatchInteraction: (gesture: TextInteractionGesture) => string | null, registeredIds: readonly string[]): TextInteractionBinding;
//# sourceMappingURL=text-interaction.d.ts.map