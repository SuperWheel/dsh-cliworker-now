/** DOM selection validation and visible-text projection, independent of business actions. */
/** One browser range contained by an enabled text source. */
export interface TextSelection {
    readonly source: HTMLElement;
    readonly range: Range;
}
/**
 * Find a single noncollapsed selection inside one enabled source.
 * @param root - mounted interaction area.
 * @param selection - browser selection in that area's document.
 * @returns the selected source and range, or null across sources and excluded content.
 */
export declare function readTextSelection(root: HTMLElement, selection: Selection | null): TextSelection | null;
/**
 * Project selected DOM text with visible block boundaries and without renderer chrome.
 * @param selection - range and its source, obtained through readTextSelection.
 * @returns trimmed visible text; empty or excluded selections return null.
 */
export declare function selectedText(selection: TextSelection): string | null;
//# sourceMappingURL=text-selection.d.ts.map