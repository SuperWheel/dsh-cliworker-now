/** Turn-aware DOM scrolling and geometry, without history-loading or follow policy. */
import { type RefObject } from 'react';
import type { ChatScrollPosition } from '../contract/slots.ts';
import type { ChatSnapshot } from '../contract/snapshot.ts';
import { ScrollFollow, type ViewportMetrics } from './use-scroll-follow.ts';
export type { ViewportMetrics } from './use-scroll-follow.ts';
/** Scroll geometry attributed against the last acknowledged position. */
export interface ViewportScroll {
    readonly metrics: ViewportMetrics;
    readonly movedByReader: boolean;
}
/** Actual clamped scroll result, including any known semantic anchor and turn. */
export interface ViewportLanding {
    readonly metrics: ViewportMetrics;
    readonly position: ChatScrollPosition | null;
    readonly turn: number | null;
}
interface ViewportEvents {
    scroll: (event: ViewportScroll) => void;
    scrollEnd: (outer: boolean) => void;
    resize: () => void;
    interact: () => void;
    /** Any reading gesture, before paging ownership is consulted. */
    intent?: () => void;
}
/** Reading policy that fold batches consult and report tail landings to. */
export interface FoldReader {
    /** Follow intent at batch start selects the tail landing; tail landings commit it. */
    readonly follow: ScrollFollow;
    /** @param landing - the actual geometry after a batch landed at the tail. */
    readonly landedAtTail: (landing: ViewportLanding) => void;
    /** @returns whether reader movement awaits sampling; until then follow intent is undecided. */
    readonly pending: () => boolean;
}
/** Owns one Chat scrollport's DOM operations, event listeners, and size observer. */
export declare class ChatViewport {
    private elements;
    private observer;
    private events;
    private turns;
    private observation;
    private paging;
    private reader;
    /** Rows measured before an instant close; see {@link ChatViewport.keepAboveClosing}. */
    private closing;
    /** Discards a closing measurement that no size observation consumed by the end of its frame. */
    private closingFrame;
    /** Content height without fold room at the latest size observation: the content that frame painted. */
    private settledContent;
    /** The pending or running fold batch lands at the tail. */
    private tailRequested;
    /** The tail request came from the reader's own input rather than from a content change. */
    private tailInput;
    /** Switches the running batch to a tail landing; null while no batch runs. */
    private retarget;
    /** Transition state and row callbacks owned by this viewport's attachment. */
    readonly motion: import("./flow-motion.ts").FlowMotion;
    /**
     * Bind to the containing scrollport and observe content and viewport sizes.
     * @param list - Chat root inside an optional shared conversation scrollport.
     * @param column - ordered outer Node/Group boxes; its size changes invalidate cached landings.
     */
    attach(list: HTMLElement, column: HTMLElement): void;
    /** Disconnect DOM resources and clear observations for the detached view. */
    detach(): void;
    /**
     * Connect business policy without changing DOM listener ownership.
     * @param events - business handlers for scroll and layout changes.
     * @returns a disposer that disconnects only these handlers.
     */
    connect(events: ViewportEvents): () => void;
    /**
     * Adopt the loaded turn anchors without querying the DOM.
     * @param turns - ordered loaded turns from the committed Chat snapshot.
     */
    updateTurns(turns: ReturnType<ChatSnapshot['navigation']['items']>): void;
    /**
     * Resolve the tail from the committed turn index.
     * @returns the latest loaded turn, or null for an empty window.
     */
    get latestTurn(): number | null;
    /** Discard geometry-dependent landing knowledge while retaining scroll attribution. */
    invalidate(): void;
    private spacerHeight;
    private setSpacer;
    /**
     * Connect the reading policy that fold batches consult.
     * @param reader - follow intent and the tail-landing commit.
     * @returns a disposer that disconnects only this reader.
     */
    bindReader(reader: FoldReader): () => void;
    /**
     * Land the pending or running fold batch at the tail instead of starting a separate scroll.
     * @param follow - follow controller whose native animation yields to the batch.
     * @param input - whether the reader's own input requests the landing; a content change, such as a Turn
     * ending, requests it in place of the immediate follow.
     * @returns whether a fold owns the tail movement.
     */
    followInputFold(follow: ScrollFollow, input: boolean): boolean;
    /**
     * Drive one fold batch on its frame clock. A tail landing ends at the floor, never above the reader's
     * compensated position; a reader landing keeps the visible content still. Both install only the room
     * the landing lacks.
     * @returns the batch driver, or null while detached or without a reading policy.
     */
    private foldDriver;
    /**
     * Find the first visible top-level row at or below the scrollport top that holds no batch box.
     * Binary search over the ordered top-level rows reads O(log n) boxes.
     * @returns the reference row, or null when every visible row folds.
     */
    private readingReference;
    /**
     * Measure, before the first row of a commit closes at once, the rows a following reader's shrink keeps
     * still: the first row visible in the last painted layout, the rows after it that were on screen, and the
     * rows above it within one scrollport.
     * Rows above the closing rows keep their painted screen positions, which the commit did not move; the same
     * commit can add rows between them and the closing rows, as a Turn's duration control does, so rows from
     * the closing rows on are placed against the current end. Reads happen only when rows close, never on the
     * following path's size observations. A measurement the same frame's size observation does not use is
     * discarded after that frame.
     * @param element - the first row of this commit to close.
     */
    private measureClosing;
    private dropClosing;
    /**
     * Keep a following reader's content still after rows closed at once, for example work details at Turn
     * completion: the first visible row keeps its screen position, or, when it closed, the first surviving row
     * that followed it on screen, else the nearest surviving row above it. Room below fills the gap, at most half
     * the scrollport; beyond that the content end stops at the scrollport's middle. Called from the size
     * observation, after layout and before paint; only the observation of the frame that closed the rows uses
     * the measurement, and only while the reader still follows the tail with no fold batch, native animation,
     * unsampled movement, or paging writing positions.
     */
    private keepAboveClosing;
    /** Clear fold reservations after a display-mode change, allowing the scroll range to shrink. */
    resetBelow(): void;
    /**
     * Give reserved room back after acknowledged scrolling or content growth without clamping the reader.
     * Holds still during folds and unsampled movement; following includes the room that remains.
     */
    reclaimBelow(): void;
    /**
     * Stop an outstanding native follow animation at its current position before a reading gesture.
     * @param follow - follow controller bound to this scrollport.
     */
    interruptFollow(follow: ScrollFollow): void;
    /**
     * Accept a sampled reader position without retaining a known landing.
     * @param metrics - settled reader position used as the next attribution baseline.
     */
    acknowledge(metrics: ViewportMetrics): void;
    /**
     * Compare the current scroll geometry with the last acknowledged position.
     * @returns current metrics and movement attribution, or null while detached.
     */
    readScroll(): ViewportScroll | null;
    private metrics;
    private anchor;
    /**
     * Capture visible transcript content, excluding Turn controls that relocate when history expands.
     * @returns a visible semantic anchor, or null when no anchor can be resolved.
     */
    capturePosition(): ChatScrollPosition | null;
    /**
     * Approximate the active Turn by binary-searching outer Node/Group boxes.
     * Gaps retain the last visited Turn candidate, not necessarily the immediate predecessor.
     * A known landing bypasses measurement while its position is unchanged.
     * @param metrics - reusable scroll metrics; omitted callers request a fresh read.
     * @returns the Turn near the reading line, or null while detached or empty.
     */
    readVisibleTurn(metrics?: ViewportMetrics | null): number | null;
    /**
     * Align a known loaded turn and return its actual clamped position.
     * A split Node anchor selects its first visible part.
     * @param turn - loaded turn to align below the scrollport's top edge.
     * @returns the actual landing, or null when its anchor is unavailable.
     */
    scrollToTurn(turn: number): ViewportLanding | null;
    /**
     * Align the nearest available fallback for an unavailable turn anchor.
     * @param turn - minimum turn number for a mounted fallback row.
     * @returns the fallback landing, or null when no eligible row exists.
     */
    scrollToTurnAtOrAfter(turn: number): ViewportLanding | null;
    /**
     * Restore a semantic anchor with a raw-position fallback.
     * @param position - semantic scroll memory; raw top is used only if its row is absent.
     * @returns the actual landing, or null while detached.
     */
    restore(position: ChatScrollPosition): ViewportLanding | null;
    /** Retain the first eligible transcript seat in DOM order; selection reads no geometry. */
    beginPaging(): void;
    /**
     * Retain one old row and its inner/outer offsets for paging and later content growth.
     * @param position - an explicit landing to retain; omitted callers capture the current reading position.
     */
    beginPreserving(position?: ChatScrollPosition | null): void;
    private retain;
    /** Release paging ownership and its content-size observation. */
    stopPreserving(): void;
    /**
     * Expose retained paging ownership to navigation and resize policy.
     * @returns whether a paging row is retained for subsequent layout changes.
     */
    get preserving(): boolean;
    /**
     * Compensate inner scrolling first, then the outer scrollport, within their actual scroll ranges.
     * An inner write pauses its bound follow controller so the reading anchor takes priority.
     * @returns the actual landing, or null when no visible retained row remains.
     */
    preserve(): ViewportLanding | null;
    /**
     * Align with the physical floor, including fold room that newer content has not yet filled.
     * @param follow - independent follow intent and scrolling controller.
     * @param behavior - immediate positioning, or one native animation for a reader-caused tail change.
     * @returns the actual floor landing, or null while detached. A smooth landing reports the starting
     * position; native scroll delivery moves it.
     */
    scrollToBottom(follow: ScrollFollow, behavior?: 'instant' | 'smooth'): ViewportLanding | null;
    private align;
    private write;
    private readonly onScroll;
    private readonly onScrollEnd;
    private readonly onIntent;
}
/**
 * Bind viewport resource ownership to the component's layout lifetime.
 * @returns one viewport owner and the element refs attached for this mount.
 */
export declare function useChatViewport(): {
    viewport: ChatViewport;
    listRef: RefObject<HTMLDivElement>;
    columnRef: RefObject<HTMLDivElement>;
};
//# sourceMappingURL=use-chat-viewport.d.ts.map