import type { DraftInput, DraftQuote, DraftSnapshot, Occurrence } from './contract/draft-editor.ts';
/**
 * Copy input into the semantic draft representation without editor runtime identities.
 * @param input - plain text or caller-owned structured content.
 * @returns an owned snapshot ready for editor import.
 */
export declare function resolveDraftInput(input: DraftInput): DraftSnapshot;
/**
 * Decode persisted drafts, accepting the earlier plain-string representation.
 * @param value - JSON value read from browser storage.
 * @returns the decoded draft, or undefined for invalid data.
 */
export declare function parseStoredDraft(value: unknown): DraftSnapshot | undefined;
/**
 * Export reference identities without their editor-local occurrence ids.
 * @param text - current clipboard projection.
 * @param occurrences - matching reference projections from the same document revision.
 * @param commandToken - claim token of the command chip opening the document, if any.
 * @param quotes - atomic quotes from the same document revision.
 * @returns an editor-independent snapshot.
 */
export declare function snapshotDraft(text: string, occurrences: readonly Occurrence[], commandToken?: string, quotes?: readonly DraftQuote[]): DraftSnapshot;
//# sourceMappingURL=draft.d.ts.map