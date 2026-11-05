/** Chat presentation derived from Host-backed detail, collapse timing, and folded replies. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store';
import { type CollapseTiming, type FoldedReplies, type TranscriptViewMode } from '../chat-settings.ts';
export { COLLAPSE_TIMINGS, FOLDED_REPLIES, type CollapseTiming, type FoldedReplies } from '../chat-settings.ts';
/** Presentation capabilities that one work-details mode enables. */
export interface ChatPresentationPolicy {
    /** Preference identity for layout resets and diagnostics; renderers select the capabilities below. */
    readonly mode: TranscriptViewMode;
    /** Saved collapse timing; completion retains the default immediate folding and scrolling. */
    readonly collapseTiming: CollapseTiming;
    /** Assistant replies that stay visible while a completed Turn folds: every reply, or only the final answer. */
    readonly foldedReplies: FoldedReplies;
    /** Whether a normally completed Turn folds its process rows behind the whole-Turn control. */
    readonly foldCompletedTurns: boolean;
    /** Collapsible group headers for all Turns, historical Turns only, or no Turns. */
    readonly stepGrouping: 'collapsed' | 'history' | 'none';
    /** Show the running command, path, query, or reasoning detail in group titles. */
    readonly liveProcessDetail: boolean;
    /** Whether a settled reasoning row previews its first line beside the Think title. */
    readonly settledReasoningPreview: boolean;
}
/**
 * Resolve a stable policy for one detail mode, collapse timing, and folded-reply choice.
 * @param mode - persisted work-details mode.
 * @param collapseTiming - persisted timing; defaults to immediate completion folding.
 * @param foldedReplies - persisted folded-reply choice; defaults to keeping every reply visible.
 * @returns the same policy object for the same choices.
 */
export declare function presentationPolicyFor(mode: TranscriptViewMode, collapseTiming?: CollapseTiming, foldedReplies?: FoldedReplies): ChatPresentationPolicy;
/**
 * Combine Host-backed detail, persisted timing, and folded replies without owning subscriptions.
 * @param mode - live work-details mode.
 * @param collapseTiming - live Host-backed collapse timing.
 * @param foldedReplies - live Host-backed folded-reply choice.
 * @returns observable policy whose subscriptions follow all three preferences.
 */
export declare function derivePresentationPolicy(mode: ObservableSnapshot<TranscriptViewMode>, collapseTiming: ObservableSnapshot<CollapseTiming>, foldedReplies: ObservableSnapshot<FoldedReplies>): ObservableSnapshot<ChatPresentationPolicy>;
//# sourceMappingURL=presentation-policy.d.ts.map