/** Independent work-details preferences backed by the same Host configuration form. */
import { type SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { CollapseTiming, FoldedReplies } from './presentation-policy.ts';
import { type ChatSettings, type TranscriptViewMode } from '../chat-settings.ts';
/** Live work-details preference consumed by Chat and its Settings row. */
export declare class TranscriptViewPolicy {
    private readonly host;
    private readonly defaultMode;
    private readonly unsubscribe;
    /** Reactive current mode, including the client default before Host settings arrive. */
    readonly mode: SnapshotStore<TranscriptViewMode>;
    /** Reactive collapse timing, defaulting to completion until Host settings arrive. */
    readonly collapseTiming: SnapshotStore<CollapseTiming>;
    /** Reactive folded-reply choice, keeping every reply until Host settings arrive. */
    readonly foldedReplies: SnapshotStore<FoldedReplies>;
    /**
     * @param host - durable Chat settings scope.
     * @param defaultMode - presentation used without an explicit saved mode.
     */
    constructor(host: ConfigForm<ChatSettings>, defaultMode?: TranscriptViewMode);
    /** Release the accepted-value subscription. */
    dispose(): void;
    /**
     * Publish and persist one explicit user choice.
     * @param mode - Compact, Standard, Detailed, or Verbose work details.
     */
    setMode(mode: TranscriptViewMode): void;
    /**
     * Publish and persist collapse timing without changing the work-details mode.
     * @param timing - immediate completion folding or deferred folding at the next input.
     */
    setCollapseTiming(timing: CollapseTiming): void;
    /**
     * Publish and persist which Assistant replies stay visible in a folded Turn.
     * @param replies - every reply, or only the final answer.
     */
    setFoldedReplies(replies: FoldedReplies): void;
    /** Adopt the latest accepted Host section without writing it back. */
    private adopt;
}
//# sourceMappingURL=transcript-view.d.ts.map