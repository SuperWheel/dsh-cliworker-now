/** General Settings row for work-details presentation. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type TranscriptViewMode } from '../../chat-settings.ts';
import { type CollapseTiming, type FoldedReplies } from '../presentation-policy.ts';
/** Registration-side work-details preference face. */
export interface TranscriptViewRowInjected {
    hooks: {
        /** Persisted work-details preference bound as useTranscriptView. */
        transcriptView: SnapshotStore<TranscriptViewMode>;
        /** Persisted collapse timing bound as useCollapseTiming. */
        collapseTiming: SnapshotStore<CollapseTiming>;
        /** Persisted folded-reply choice bound as useFoldedReplies. */
        foldedReplies: SnapshotStore<FoldedReplies>;
    };
    /** Change the work-details presentation. */
    setTranscriptView: (mode: TranscriptViewMode) => void;
    /** Persist collapse timing independently of the work-details mode. */
    setCollapseTiming: (timing: CollapseTiming) => void;
    /** Persist which Assistant replies stay visible in a folded Turn. */
    setFoldedReplies: (replies: FoldedReplies) => void;
}
/** Full Settings-row props. */
export type TranscriptViewRowProps = PropsRuntime<'settings.general.item'> & PropsLocale<'chat'> & InjectFace<TranscriptViewRowInjected>;
/**
 * Render the independent, Host-backed work-details, collapse-timing, and folded-reply selectors.
 * Verbose never folds a Turn, so it omits the folded-reply selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export declare function TranscriptViewRow({ useTranscriptView, setTranscriptView, useCollapseTiming, setCollapseTiming, useFoldedReplies, setFoldedReplies, t, }: TranscriptViewRowProps): import("react").JSX.Element;
//# sourceMappingURL=TranscriptViewRow.d.ts.map