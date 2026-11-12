import type { SessionAssistantSettlementEntry, SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client';
import type { LlmAttemptId } from '@deepseek-ai/dsh-llm/brand';
import type { ConversationNodeDefinition, ConversationPublication, ConversationViewDefinition, ConversationViewSnapshotMap, ConversationViewSnapshotStore } from '../contract/conversation.ts';
import type { ConversationGroupData, ConversationGroupDefinition, ConversationGroupedView } from '../contract/groups.ts';
import type { ConversationEventRegistry } from './event-registry.ts';
/**
 * Failure of an incremental Conversation update.
 * When `rebuilt` is true, every active view already shows a complete rebuild of
 * the loaded window, and `cause` is the original failure. When it is false, the
 * rebuild or its view replacement also failed, and `cause` is an
 * `AggregateError` of both failures; the next flush retries that rebuild or replacement.
 */
export declare class ConversationUpdateError extends Error {
    /** Whether every active view shows the complete rebuild. */
    readonly rebuilt: boolean;
    /**
     * @param rebuilt - whether every active view shows the complete rebuild.
     * @param options - the original failure, or an `AggregateError` of both failures, as `cause`.
     */
    constructor(rebuilt: boolean, options: ErrorOptions);
}
/** Event Registry subset consumed by a Session-owned Assembler. */
export interface ConversationEventDefinitions extends Partial<Pick<ConversationEventRegistry, 'forEvent'>> {
    /** @returns ordinary Definitions in registration order. */
    entries(): readonly ConversationNodeDefinition[];
    /** @returns unmatched-event fallback, when registered. */
    fallbackEntry(): ConversationNodeDefinition | undefined;
}
/** View Registry subset consumed by a Session-owned Assembler. */
export interface ConversationViewDefinitions {
    /** @returns view builder factories in registration order. */
    entries(): readonly ConversationViewDefinition[];
}
/** Registered grouping rules consumed by the target-neutral assembler. */
export interface ConversationGroupDefinitions {
    /** @returns grouping Definitions in registration order. */
    entries(): readonly ConversationGroupDefinition[];
    /** @param target - View target. @returns its optional Group Definition. */
    forTarget(target: string): ConversationGroupDefinition | undefined;
}
/**
 * Session-owned incremental engine that assembles business Contexts from a
 * contiguous Event window and materializes registered view snapshots.
 */
export declare class ConversationNodeAssembler implements ConversationViewSnapshotStore {
    private readonly eventDefinitions;
    private readonly viewDefinitions;
    private readonly groupDefinitions;
    private readonly contexts;
    private readonly contextsByKind;
    private readonly contextsBySeq;
    private readonly contextsByTarget;
    private readonly inputs;
    private readonly locationIndex;
    private readonly dirty;
    private readonly dirtyByTarget;
    private readonly revised;
    private readonly dependents;
    private readonly views;
    private readonly groups;
    private readonly pendingGroupStores;
    private readonly activeTargets;
    /** Matches of the event in dispatch, kept by index; dispatch is not reentrant and reuses both arrays. */
    private readonly matchedDefinitions;
    private readonly matchedResults;
    private hasMore;
    private rebuildPending;
    private replacePending;
    private timelineDirty;
    /**
     * @param eventDefinitions - live Event Definition registry.
     * @param viewDefinitions - live view builder registry.
     * @param groupDefinitions - optional registered grouping rules, independent of presentation modes.
     */
    constructor(eventDefinitions: ConversationEventDefinitions, viewDefinitions: ConversationViewDefinitions, groupDefinitions?: ConversationGroupDefinitions);
    /**
     * Read the current open turn without activating a View.
     * @returns the latest turn number when its start is loaded and it remains open, otherwise undefined.
     */
    openTurn(): number | undefined;
    /**
     * Replace the complete loaded window after open, resync, or gap repair.
     * @param entries - complete contiguous window.
     * @param hasMore - whether older history remains outside the window.
     * @returns immediate publication request.
     */
    replaceWindow(entries: readonly SessionEventLikeEntry[], hasMore: boolean): ConversationPublication;
    /**
     * Add one contiguous live tail event without scanning existing Contexts.
     * @param record - appended Session event entry.
     * @returns highest requested publication cadence.
     */
    append(record: SessionEventLikeEntry): ConversationPublication;
    /**
     * Retire one Assistant attempt's transient matches and apply its optional durable settlement.
     * Empty Contexts retain their keys and published nodes until the loaded window is rebuilt;
     * Definitions may hide those nodes when no start remains instead of withdrawing their identities.
     * @param attemptId - process-local attempt whose transient presentation ended.
     * @param entry - durable message or attempt event committed for the stream.
     * @returns highest requested publication cadence.
     */
    settleAssistant(attemptId: LlmAttemptId, entry?: SessionAssistantSettlementEntry): ConversationPublication;
    /**
     * Add an older page while preserving existing Context and view identities.
     * @param entries - newly loaded older Events.
     * @param hasMore - whether history still precedes the expanded window.
     * @returns highest requested publication cadence.
     */
    prepend(entries: readonly SessionEventLikeEntry[], hasMore: boolean): ConversationPublication;
    /**
     * Rebuild against the current Registry set after a low-frequency plugin change.
     * @returns immediate publication request.
     */
    rebuildRegistry(): ConversationPublication;
    /**
     * Materialize dirty Contexts and advance every active view builder.
     * When an incremental update throws, the assembler replays the complete loaded
     * window into new Contexts and replaces every active view before it throws a
     * {@link ConversationUpdateError}. A Definition that throws on every incremental
     * update therefore makes each flush replay the whole window. A failure on the
     * complete-replacement path propagates unchanged, publishes no view, and keeps
     * the replacement pending for the next flush.
     * @returns whether any view snapshot was rebuilt or incrementally applied.
     * @throws {@link ConversationUpdateError} when an incremental update fails.
     */
    flush(): boolean;
    private flushReplacement;
    /** Replace partial incremental state with a complete rebuild, then report the original failure. */
    private recoverIncremental;
    /** Rebuild every Context from the loaded inputs; a failed rebuild stays pending for the next flush. */
    private rebuildWindow;
    private flushIncremental;
    /**
     * Add one target to the monotonic active set and materialize its current snapshot.
     * Pending Context work is flushed before the first complete replacement. When that
     * flush throws, the target stays inactive and a later activation retries it.
     * @param target - registered or subsequently registered view target.
     * @returns whether any active target snapshot changed.
     */
    activateTarget(target: string): boolean;
    /**
     * Read the latest snapshot of a registered target.
     * @param target - registered view target.
     * @returns target snapshot, or undefined before registration or activation.
     */
    snapshot(target: string): unknown;
    get<Target extends Extract<keyof ConversationViewSnapshotMap, string>>(target: Target): ConversationViewSnapshotMap[Target] | undefined;
    grouped<Target extends string>(target: Target): ConversationGroupedView<ConversationGroupData<Target>> | undefined;
    /**
     * Read targets whose owners classify their latest snapshot as visible activity.
     * @returns target ids contributing visible activity.
     */
    activityTargets(): ReadonlySet<string>;
    private sortedInputs;
    private matchInput;
    private collectInput;
    private dispatchInput;
    private createContext;
    private acceptMatch;
    private applyPendingMatches;
    private replayContexts;
    private refreshStarts;
    private replayContext;
    private indexTargetContext;
    private markDirty;
    private replaceDependencies;
    private replayRevisedDependents;
    private readerFor;
    private previousContext;
    /** Insert one newly discovered start into its Definition's ordered predecessor index. */
    private indexStartedContext;
    private indexStartedContexts;
    private replayDependencies;
    private refreshMatchLocations;
    private buildNode;
    private replaceView;
    private updateView;
    private publishViews;
    private buildTargetNodes;
    private buildTargetUpserts;
    private buildLocationData;
    private replaceLocationData;
    private applyDirtyLocationData;
    private resetViewBuilders;
}
//# sourceMappingURL=assembler.d.ts.map