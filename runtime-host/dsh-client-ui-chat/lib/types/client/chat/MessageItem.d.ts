import type { ReactNode } from 'react';
import type { PendingSubmission } from '@deepseek-ai/dsh-api-session-controller/client';
import type { PropsRenderFactories, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots';
import type { ChatNodeOwnerProps, ChatNodeViewProps, ChatViewSlotProps } from '../contract/slots.ts';
/**
 * Render one Host-authoritative pending steering item with the same visual
 * language as its eventual durable transcript node.
 * @param props - pending content, authorized image loader, and Factory/locale seats.
 * @returns the pending steering bubble.
 */
export declare function PendingSteeringBubble({ content, loadImage, renderFactorySlot, t }: {
    content: readonly unknown[];
    renderFactorySlot: PropsRenderFactories['renderFactorySlot'];
    t: ChatViewSlotProps['t'];
} & Pick<ChatNodeOwnerProps, 'loadImage'>): ReactNode;
/**
 * Render one local transcript or steering submission echo with the same
 * visual language and surface marker as the Host occurrence that replaces
 * it: draft text plus object-URL previews, visible from the submit click
 * until the durable `user/message` or steering occurrence renders.
 * @param props - the pending submission, authorized image loader, and render seats.
 * @returns the echoed user bubble.
 */
export declare function PendingSubmissionBubble({ submission, loadImage, renderFactorySlot, t }: {
    submission: PendingSubmission;
    renderFactorySlot: PropsRenderFactories['renderFactorySlot'];
    t: ChatViewSlotProps['t'];
} & Pick<ChatNodeOwnerProps, 'loadImage'>): ReactNode;
/**
 * Official user and admitted-steering keyed Chat renderer.
 *
 * Renders the durable-message chain seat directly above the bubble. The seat is
 * declared by the `user` registration alone, so a steering row renders the same
 * bubble without asking for it.
 */
export declare const UserMessageNodeView: import("react").MemoExoticComponent<({ node, renderFactorySlot, loadImage, renderSlotChain, t, }: ChatNodeViewProps<"user" | "steering"> & {
    /** Bound by the `user` keyed registration, the only entry that declares the seat. */
    renderSlotChain: PropsRenderSlots<"conversation.chat.user.before">["renderSlotChain"];
}) => import("react").JSX.Element>;
/** Injected-context keyed Chat renderer. */
export declare const ContextMessageNodeView: import("react").MemoExoticComponent<({ node, t }: ChatNodeViewProps<"context">) => import("react").JSX.Element>;
/** Automatic compaction keyed Chat renderer. */
export declare const CompactionNodeView: import("react").MemoExoticComponent<({ node, t }: ChatNodeViewProps<"compaction">) => import("react").JSX.Element>;
/** Correlated retry-chain keyed Chat renderer. */
export declare const RetryNodeView: import("react").MemoExoticComponent<({ node, t }: ChatNodeViewProps<"model-retry">) => import("react").JSX.Element>;
/** Terminal turn-error keyed Chat renderer. */
export declare const TurnErrorNodeView: import("react").MemoExoticComponent<({ node, t }: ChatNodeViewProps<"turn-error">) => import("react").JSX.Element>;
/** Max-tokens turn-end notice keyed Chat renderer. */
export declare const TurnMaxTokensNodeView: import("react").MemoExoticComponent<({ t }: ChatNodeViewProps<"turn-max-tokens">) => import("react").JSX.Element>;
/** Explicit unknown-surface keyed Chat renderer. */
export declare const UnknownNodeView: import("react").MemoExoticComponent<({ node, t }: ChatNodeViewProps<"unknown">) => import("react").JSX.Element>;
//# sourceMappingURL=MessageItem.d.ts.map