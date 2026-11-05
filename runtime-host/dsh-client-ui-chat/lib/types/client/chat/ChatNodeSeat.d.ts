import type { ChatNodeOwnerProps, ChatFlowSlotProps, UsePresentation } from '../contract/slots.ts';
import type { ChatNodeStore } from '../contract/snapshot.ts';
interface ChatNodeSeatProps extends ChatNodeOwnerProps {
    readonly nodeKey: string;
    /** A replaced Builder must rebind keyed hooks even when references and keys survive. */
    readonly nodeStore: ChatNodeStore;
    readonly useChatNode: ChatFlowSlotProps['useChatNode'];
    readonly useChatNodeProcess: ChatFlowSlotProps['useChatNodeProcess'];
    readonly usePresentation: UsePresentation;
    readonly useStore: ChatFlowSlotProps['useStore'];
    readonly actions: ChatFlowSlotProps['actions'];
    readonly renderSlot: ChatFlowSlotProps['renderSlot'];
    readonly t: ChatFlowSlotProps['t'];
    readonly useChatNodeBottom: ChatFlowSlotProps['useChatNodeBottom'];
    readonly deferCollapse: boolean;
    readonly useGroupAction: ChatFlowSlotProps['useGroupAction'];
}
/**
 * Subscribe, apply Turn-process visibility, and dispatch one stable Context key.
 * Policy reads select this seat's own conclusion, so a mode change re-renders
 * only seats whose visibility actually changes.
 */
export declare const ChatNodeSeat: import("react").MemoExoticComponent<({ nodeKey, groupPart, useChatNode, useChatNodeProcess, usePresentation, cwd, openFile, inspectCall, forkAt, loadImage, useStore, actions, renderSlot, t, useChatNodeBottom, deferCollapse, useGroupAction, }: ChatNodeSeatProps) => import("react").JSX.Element | null>;
export {};
//# sourceMappingURL=ChatNodeSeat.d.ts.map