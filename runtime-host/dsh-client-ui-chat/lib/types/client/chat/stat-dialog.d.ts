import { type MutableRefObject } from 'react';
/** Open state, refs, and CSS anchor identity for one stat dialog. */
export interface StatDialogSeat {
    open: boolean;
    setOpen: (open: boolean) => void;
    rootRef: MutableRefObject<HTMLSpanElement | null>;
    panelRef: MutableRefObject<HTMLDivElement | null>;
    anchorName: string;
}
/**
 * One trigger-anchored dialog seat: open state, CSS anchor placement, outside-close.
 * @returns the seat; assign the anchor name to the trigger and the portaled panel.
 */
export declare function useStatDialog(): StatDialogSeat;
//# sourceMappingURL=stat-dialog.d.ts.map