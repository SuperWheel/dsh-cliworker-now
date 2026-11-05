/** Chat display preferences stored in the Host user-settings document. */
import z from '@deepseek-ai/schemastery';
/** Settings namespace owned by the Chat target. */
export declare const CHAT_SETTINGS_NAMESPACE = "ui-chat";
/** Field carrying the work-details presentation mode. */
export declare const TRANSCRIPT_VIEW_FIELD = "transcriptView";
/** Field carrying the independent work-details collapse timing. */
export declare const COLLAPSE_TIMING_FIELD = "collapseTiming";
/** Available points when a completed Turn returns to its historical presentation. */
export declare const COLLAPSE_TIMINGS: readonly ["completion", "next-input"];
/** When a completed Turn returns to its historical presentation. */
export type CollapseTiming = typeof COLLAPSE_TIMINGS[number];
/** Preserve completion-time folding when no timing preference is saved. */
export declare const DEFAULT_COLLAPSE_TIMING: CollapseTiming;
/** Field carrying which Assistant replies stay visible in a folded Turn. */
export declare const FOLDED_REPLIES_FIELD = "foldedReplies";
/** Assistant replies kept visible while a completed Turn folds its process: every reply, or only the final answer. */
export declare const FOLDED_REPLIES: readonly ["all", "final"];
/** Which Assistant replies stay visible while a completed Turn folds its process. */
export type FoldedReplies = typeof FOLDED_REPLIES[number];
/** Keep every Assistant reply visible when no folded-reply preference is saved. */
export declare const DEFAULT_FOLDED_REPLIES: FoldedReplies;
/** Work-details presentation modes a user can choose. */
export declare const TRANSCRIPT_VIEW_MODES: readonly ["compact", "standard", "detailed", "verbose"];
/** Work-details presentation mode. */
export type TranscriptViewMode = typeof TRANSCRIPT_VIEW_MODES[number];
/**
 * Saved value from the two-mode generation of this setting. Read as `detailed`;
 * never offered as a choice and never written back.
 */
export declare const LEGACY_TRANSCRIPT_VIEW_MODE = "normal";
/** Saved `expanded` values read as `detailed`, without being offered or written back. */
export declare const LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE = "expanded";
/** Default work details for non-Desktop Web clients. */
export declare const DEFAULT_TRANSCRIPT_VIEW_MODE: TranscriptViewMode;
/** Performance and usage detail levels accepted by user settings. */
export declare const PERFORMANCE_USAGE_MODES: readonly ["compact", "detailed"];
/** Performance and usage presentation. */
export type PerformanceUsageMode = typeof PERFORMANCE_USAGE_MODES[number];
/** Preserve detailed accounting for users without an explicit preference. */
export declare const DEFAULT_PERFORMANCE_USAGE: PerformanceUsageMode;
/** Destinations for ordinary clicks on Chat HTTP(S) links. */
export type LinkOpening = 'sidebar' | 'new-tab';
/** Preserve the built-in browser for users without an explicit preference. */
export declare const DEFAULT_LINK_OPENING: LinkOpening;
/** Durable Chat section shared by the Host schema and browser scope. */
export interface ChatSettings {
    /** Work-details preference; absence uses the client default, and legacy saved values remain accepted. */
    transcriptView?: TranscriptViewMode | typeof LEGACY_TRANSCRIPT_VIEW_MODE | typeof LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE | null;
    /** Independent collapse timing; absence preserves completion-time folding. */
    collapseTiming?: CollapseTiming;
    /** Replies kept visible in a folded Turn; absence keeps every reply. */
    foldedReplies?: FoldedReplies;
    /** Detail level for composer statistics and completed-Turn usage. */
    performanceUsage: PerformanceUsageMode;
    /** Default destination for Chat HTTP(S) links. */
    linkOpening: LinkOpening;
}
/** Durable Chat schema; also the wire envelope the browser scope validates against. */
export declare const ChatSettingsFields: {
    collapseTiming: z<"completion" | "next-input", "completion" | "next-input", "defined">;
    foldedReplies: z<"all" | "final", "all" | "final", "defined">;
    linkOpening: z<"sidebar" | "new-tab", "sidebar" | "new-tab", "defined">;
    performanceUsage: z<"compact" | "detailed", "compact" | "detailed", "defined">;
    transcriptView: z<"compact" | "standard" | "detailed" | "verbose" | "normal" | "expanded", "compact" | "standard" | "detailed" | "verbose" | "normal" | "expanded", "plain">;
};
/** Schema for shared configuration values. */
export declare const ChatSettingsSchema: z<Schemastery.ObjectS<NoInfer<{
    collapseTiming: z<"completion" | "next-input", "completion" | "next-input", "defined">;
    foldedReplies: z<"all" | "final", "all" | "final", "defined">;
    linkOpening: z<"sidebar" | "new-tab", "sidebar" | "new-tab", "defined">;
    performanceUsage: z<"compact" | "detailed", "compact" | "detailed", "defined">;
    transcriptView: z<"compact" | "standard" | "detailed" | "verbose" | "normal" | "expanded", "compact" | "standard" | "detailed" | "verbose" | "normal" | "expanded", "plain">;
}>>, Schemastery.ObjectT<NoInfer<{
    collapseTiming: z<"completion" | "next-input", "completion" | "next-input", "defined">;
    foldedReplies: z<"all" | "final", "all" | "final", "defined">;
    linkOpening: z<"sidebar" | "new-tab", "sidebar" | "new-tab", "defined">;
    performanceUsage: z<"compact" | "detailed", "compact" | "detailed", "defined">;
    transcriptView: z<"compact" | "standard" | "detailed" | "verbose" | "normal" | "expanded", "compact" | "standard" | "detailed" | "verbose" | "normal" | "expanded", "plain">;
}>>, "plain">;
//# sourceMappingURL=chat-settings.d.ts.map