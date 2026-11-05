/** Composes viewport operations, reading policy, and history navigation for Chat. */
import { type RefObject } from 'react';
import type { TranscriptViewMode } from '../../chat-settings.ts';
import type { ChatSnapshot } from '../contract/snapshot.ts';
import type { ChatViewSlotProps } from '../contract/slots.ts';
import { type ChatNavigation, type ChatNavigationInput } from './use-chat-navigation.ts';
import { type ChatReadingState } from './use-chat-reading.ts';
import type { FlowMotionRows } from './flow-motion.ts';
/** Committed content and Session operations used to reconcile scroll ownership. */
export interface ChatScrollInput extends ChatNavigationInput {
    readonly chatScroll: ChatViewSlotProps['chatScroll'];
    readonly ready: boolean;
    readonly order: readonly string[];
    readonly lastKey: string | null;
    readonly lastIsUser: boolean;
    readonly steeringId: string | null;
    readonly submissionId: string | null;
    /** The latest visible submission steers the running Turn instead of opening a new one. */
    readonly submissionSteers: boolean;
    readonly running: boolean;
    /** Enable the browser-local delayed-fold experiment and its input reveal animation. */
    readonly deferCompletedTurns: boolean;
    /** A changed work-details preference resets fold reservations after the layout settles. */
    readonly transcriptView: TranscriptViewMode;
    readonly loadedTurns: ReturnType<ChatSnapshot['navigation']['items']>;
}
interface ChatScrollState extends ChatReadingState {
    readonly listRef: RefObject<HTMLDivElement>;
    readonly columnRef: RefObject<HTMLDivElement>;
    readonly busyTurn: number | null;
    readonly navigateToTurn: ChatNavigation['navigateToTurn'];
    readonly loadEarlier: ChatNavigation['loadEarlier'];
    readonly returnToBottom: () => void;
    readonly motion: FlowMotionRows;
}
/**
 * Coordinate scroll policy after Chat content commits. Initial history must be ready
 * before automatic scroll or resize handling can initialize reading state and fold motion.
 * New submitted input supersedes pending reader sampling.
 * @param input - current Chat content, scroll memory, and history operations.
 * @returns element refs, visible reading state, and navigation callbacks.
 */
export declare function useChatScroll(input: ChatScrollInput): ChatScrollState;
export {};
//# sourceMappingURL=use-chat-scroll.d.ts.map