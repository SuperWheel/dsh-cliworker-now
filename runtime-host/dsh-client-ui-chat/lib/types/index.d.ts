import type { Volatile, Context } from '@deepseek-ai/cordis';
import type { ChatSettings, CollapseTiming, FoldedReplies, LinkOpening, PerformanceUsageMode } from './chat-settings.ts';
import z from '@deepseek-ai/schemastery';
export { CHAT_SETTINGS_NAMESPACE, DEFAULT_TRANSCRIPT_VIEW_MODE, LEGACY_TRANSCRIPT_VIEW_MODE, LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE, TRANSCRIPT_VIEW_FIELD, TRANSCRIPT_VIEW_MODES, type ChatSettings, type TranscriptViewMode, } from './chat-settings.ts';
/** Runtime preferences projected to the browser. */
export interface Config {
    /** Completed turn transcript presentation. */
    transcriptView: Volatile<ChatSettings['transcriptView']>;
    /** When completed work details return to their historical presentation. */
    collapseTiming: Volatile<CollapseTiming>;
    /** Assistant replies kept visible while a completed Turn folds its process. */
    foldedReplies: Volatile<FoldedReplies>;
    /** Performance and usage detail level. */
    performanceUsage: Volatile<PerformanceUsageMode>;
    /** Default destination for Chat HTTP(S) links. */
    linkOpening: Volatile<LinkOpening>;
}
/** Live preferences projected to the browser. */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    transcriptView: z<"compact" | "standard" | "detailed" | "verbose" | "normal" | "expanded", "compact" | "standard" | "detailed" | "verbose" | "normal" | "expanded", "volatile">;
    collapseTiming: z<"completion" | "next-input", "completion" | "next-input", "volatile-defined">;
    foldedReplies: z<"all" | "final", "all" | "final", "volatile-defined">;
    performanceUsage: z<"compact" | "detailed", "compact" | "detailed", "volatile-defined">;
    linkOpening: z<"sidebar" | "new-tab", "sidebar" | "new-tab", "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    transcriptView: z<"compact" | "standard" | "detailed" | "verbose" | "normal" | "expanded", "compact" | "standard" | "detailed" | "verbose" | "normal" | "expanded", "volatile">;
    collapseTiming: z<"completion" | "next-input", "completion" | "next-input", "volatile-defined">;
    foldedReplies: z<"all" | "final", "all" | "final", "volatile-defined">;
    performanceUsage: z<"compact" | "detailed", "compact" | "detailed", "volatile-defined">;
    linkOpening: z<"sidebar" | "new-tab", "sidebar" | "new-tab", "volatile-defined">;
}>>, "plain">;
/** Host preferences are consumed through the configuration form projection.
 * @param ctx Plugin context used for optional settings presentation.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map