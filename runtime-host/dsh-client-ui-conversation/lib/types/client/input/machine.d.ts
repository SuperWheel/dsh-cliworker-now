import type { InputEffect, InputEvent, InputState, SubmitAttempt } from '../contract/input.ts';
/** The submit-plane slice of the published InputState. */
export interface SubmitSnapshot {
    readonly phase: InputState['phase'];
    readonly claim?: InputState['claim'];
}
/** Pure phase, claim, and attempt owner for one Session input. */
export declare class SubmitMachine {
    private phase;
    private claim;
    private seq;
    private inflight;
    /** Read-only snapshot of the submit-plane state. */
    get state(): SubmitSnapshot;
    /** The attempt of the message being sent; undefined outside the sending phase. */
    get sendingAttempt(): SubmitAttempt | undefined;
    /**
     * Feed one event through the machine.
     * @param ev - submit-plane event.
     * @returns effects for the SessionInput shell, in execution order.
     */
    dispatch(ev: InputEvent): readonly InputEffect[];
    /**
     * Outside a transaction the claim follows the document's leading command
     * chip: deleting or displacing the chip releases it, and a history restore
     * of the chip re-enters claimed. The claim event applies the same rule to a
     * chip the editor just inserted, before its update commits; busy phases
     * refuse both.
     */
    private followCommand;
    /** Occupy the frozen slot with the draft, references, quotes, and attachments the user sent. */
    private beginAttempt;
    /** Send the frozen message; the editor stays read-only until the Host accepts it. */
    private send;
    private onEnter;
    private onAdjudicated;
    private onAdjudicationFailed;
    /** Claimed command settlement; after a failure the claim follows the leading command chip again. */
    private onSubmitSettled;
    /** An accepted message clears the editor; a refused or failed one returns to editing unchanged. */
    private onSinkSettled;
    private onRelease;
}
//# sourceMappingURL=machine.d.ts.map