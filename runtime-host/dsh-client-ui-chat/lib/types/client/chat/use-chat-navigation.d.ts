import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client';
import type { ChatNode } from '../contract/chat-nodes.ts';
import type { ChatViewSlotProps } from '../contract/slots.ts';
import type { TurnRailItem } from './turn-rail-items.ts';
import type { ChatReading, ReadingSample } from './use-chat-reading.ts';
import type { ChatViewport } from './use-chat-viewport.ts';
/** History availability and loading operations for the committed Chat window. */
export interface ChatNavigationInput extends Pick<ChatViewSlotProps, 'loadOlder' | 'loadThrough' | 'consumeOlder'> {
    readonly firstSeq: ChatNode['anchorSeq'] | null;
    readonly hasMore: boolean;
    readonly loadingOlder: boolean;
    readonly historyLoadStatus: SessionSnapshot['historyLoadStatus'];
    readonly isOpen: boolean;
}
type HistoryIntent = 'none' | 'auto' | 'manual';
/** Owns one replaceable turn jump and the anchor retained while history loads. */
export declare class ChatNavigation {
    private readonly viewport;
    private readonly reading;
    private input;
    private readonly onBusyTurn;
    private readonly onHistoryIntent;
    private jump;
    private settleFrame;
    private historyFrame;
    private historyIntent;
    private historyRequested;
    constructor(viewport: ChatViewport, reading: ChatReading, input: ChatNavigationInput, onBusyTurn: (turn: number | null) => void, onHistoryIntent?: (intent: HistoryIntent) => void);
    /**
     * Adopt committed history availability without starting a request.
     * @param input - history state from the latest committed render.
     */
    setInput(input: ChatNavigationInput): void;
    /** Cancel navigation when opening a Chat view. */
    reset(): void;
    /** Cancel local callbacks; late history completions cannot revive a task. */
    dispose(): void;
    /** Release the jump, paging anchor, and busy indicator without cancelling shared history I/O. */
    cancel(): void;
    /** Release a jump after reader input without cancelling an accepted history click. */
    readerInteracted(): void;
    private clearTask;
    /**
     * Replace the current jump with an explicit turn selection.
     * @param item - loaded anchor or unloaded turn to fetch before landing.
     */
    readonly navigateToTurn: (item: TurnRailItem) => void;
    /** Request and consume one page, retaining the click until success, exhaustion, or failure. */
    readonly loadEarlier: () => void;
    private setHistoryIntent;
    /** Coalesce event-driven checks; waiting never schedules its own next frame. */
    requestHistoryCheck(): void;
    private checkHistory;
    private consumeHistory;
    /**
     * Preserve reader ownership across pending history work.
     * @param sample - settled reader movement that can update or interrupt an anchor.
     */
    readerSampled(sample: ReadingSample): void;
    /**
     * Preserve one paging anchor after a commit or a later size change, regardless of head identity.
     * @returns whether the retained anchor handled the layout change.
     */
    contentCommitted(): boolean;
    /** Land, retry, or complete the current jump against the committed window. */
    reconcile(): void;
    private landJump;
    private request;
    private cancelFrame;
}
/**
 * Retain one navigation owner for the component's lifetime.
 * @param viewport - turn-aware DOM operations.
 * @param reading - reading and follow policy receiving navigation landings.
 * @param input - committed history state and load operations.
 * @returns the navigation owner and its visible busy turn.
 */
export declare function useChatNavigation(viewport: ChatViewport, reading: ChatReading, input: ChatNavigationInput): {
    navigation: ChatNavigation;
    busyTurn: number | null;
    historyPending: boolean;
    historyProcessing: boolean;
};
export {};
//# sourceMappingURL=use-chat-navigation.d.ts.map