/**
 * Fold transitions owned by one Chat viewport. Every batch containing a closing row moves its boxes and
 * the scrollport on one frame clock; a batch that only reveals rows, or a viewport without a reading
 * policy, uses CSS transitions. Motion is opt-in under `[data-chat-motion]`, respects reduced motion,
 * and clears temporary styles.
 */
import { type RefObject } from 'react';
/** Row-local operations supplied by the containing viewport. */
export interface FlowMotionRows {
    /** @param element - visible row. @param done - commits hidden state before idle callbacks run. */
    collapse(element: HTMLElement, done: () => void): void;
    /** @param element - newly visible row to grow to its natural size. */
    reveal(element: HTMLElement): void;
    /** @param element - row whose active transition should be cancelled without hiding it. */
    cancelMotion(element: HTMLElement): void;
    /**
     * Hide a row at once, outside a motion scope; the owning viewport measures the layout first.
     * @param element - visible row.
     * @param commit - applies the hidden state.
     */
    hideNow?(element: HTMLElement, commit: () => void): void;
}
/** Geometry captured before one fold batch changes its boxes. */
export interface InputFoldBox {
    readonly element: HTMLElement;
    readonly height: number;
    readonly marginTop: number;
    readonly closing: boolean;
}
/** The viewport moves on the same progress that changes the folded boxes. */
export interface InputFoldDriver {
    /**
     * Capture geometry and choose the landing before the frame clock changes the boxes.
     * @param boxes - non-nested boxes whose layout changes on this clock.
     * @returns closing boxes that scroll with the content and stay opaque; the rest fade in place. The driver
     * may add boxes while the batch runs, when a newer tail request takes it over.
     */
    begin(boxes: readonly InputFoldBox[]): ReadonlySet<HTMLElement>;
    /**
     * Reserve scroll range before box writes.
     * @param progress - shared eased progress from zero to one.
     * @param cancelled - a reading gesture stopped a tail landing's automatic target; a landing that keeps
     * the reader's content still continues and includes the reader's own movement.
     */
    prepare(progress: number, cancelled: boolean): void;
    /**
     * Apply viewport geometry after box writes.
     * @param progress - shared eased progress from zero to one.
     * @param cancelled - a reading gesture stopped a tail landing's automatic target.
     * @returns actual scrollTop displacement from the batch start, for closing-content visual compensation.
     */
    frame(progress: number, cancelled: boolean): number;
    /**
     * Install the final geometry after the last frame or cancellation.
     * @param cancelled - a reading gesture stopped the automatic target, every closing row reopened, or the
     * viewport detached; the driver commits no obsolete landing.
     */
    finish(cancelled: boolean): void;
}
/** Animation lifetime and fold coordination for one viewport. */
export interface FlowMotion extends FlowMotionRows {
    /** @returns whether a row owned by this viewport is closing. */
    foldActive(): boolean;
    /** @param listener - callback after the last fold. @returns cancellation for a pending callback. */
    onFoldIdle(listener: () => void): () => void;
    /** Stop the running batch's automatic target while letting its boxes finish. */
    cancelInput(): void;
    /** Restore the running batch's automatic target after a newer request takes it over. */
    resumeInput(): void;
    /** @returns whether a fold batch runs, or one is scheduled for this commit's closing rows. */
    inputActive(): boolean;
    /** Cancel owned animations and pending work when the viewport detaches. */
    clear(): void;
}
/**
 * Decide whether a row may animate: inside a live scope and not under reduced motion.
 * @param element - row about to be hidden.
 * @returns whether the fade-then-close transition applies.
 */
export declare function motionEnabled(element: HTMLElement): boolean;
/**
 * Whether a row is already hidden or on its way there.
 * @param element - row under Turn-level visibility control.
 * @returns hidden attribute present or a collapse transition outstanding.
 */
export declare function hiddenOrCollapsing(element: HTMLElement): boolean;
/**
 * Create animation coordination without cross-viewport broadcasts.
 * @param driver - the viewport's driver for the next batch; null while detached.
 * @param foldingChanged - disable or restore this viewport's native scroll anchoring.
 * @param beforeInstantHide - measures the layout before a row hides at once outside a motion scope.
 * @returns stable callbacks and cleanup for this viewport's animations.
 */
export declare function createFlowMotion(driver: () => InputFoldDriver | null, foldingChanged: (active: boolean) => void, beforeInstantHide?: (element: HTMLElement) => void): FlowMotion;
/**
 * Apply searchable hiding with the containing Chat viewport's optional fold animation.
 * @param hidden - desired visibility.
 * @param reveal - browser-find and focus-protection callback.
 * @param motion - owning viewport's row callbacks; undefined applies visibility synchronously.
 * @returns the stable subtree ref.
 */
export declare function useFlowHidden(hidden: boolean, reveal: () => void, motion: FlowMotionRows | undefined): RefObject<HTMLDivElement>;
/**
 * Toggle a plain hidden attribute on the fold clock, growing newly revealed headers.
 * @param ref - element whose visibility follows hidden.
 * @param hidden - desired hidden state.
 * @param motion - containing viewport's row callbacks.
 */
export declare function useMotionHidden(ref: RefObject<HTMLElement | null>, hidden: boolean, motion: FlowMotionRows): void;
//# sourceMappingURL=flow-motion.d.ts.map