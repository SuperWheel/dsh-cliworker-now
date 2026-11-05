/** Session Controller adapter for React selector hooks and Slot scope data. */
import { Service, type Context } from '@deepseek-ai/cordis';
import type { ISessions, SessionBinding, SessionListState, SessionReference, SessionRetainInfo, SessionSnapshot, UseProjection } from '@deepseek-ai/dsh-api-session-controller/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { AccessEffect, RemoteEndpoint } from '@deepseek-ai/dsh-api-remote-access/client';
import type { HostObservable, KeyedStandardSource, MaybeSnapshotSelectorHook, SlotScopeAdapter, SnapshotSelectorHook, StandardSourceBinding } from '@deepseek-ai/dsh-client-ui-slots';
/** Selector hook over the Session Controller list and current selection. */
export type UseSessions = SnapshotSelectorHook<SessionListState>;
/** Selector hook over one Session's lifecycle and control state. */
export type SessionSnapshotSelector = SnapshotSelectorHook<SessionSnapshot>;
/** Public name for the Session lifecycle selector hook. */
export type UseSession = SessionSnapshotSelector;
/** Common identity carried by every Session-scoped pending interaction. */
export interface SessionPendingInteractionBase {
    /** Opaque request identity; a replacement request must use a new key. */
    readonly key: string;
    /** Domain-owned presentation discriminator. */
    readonly kind: string;
    /** Session whose UI can answer this interaction. */
    readonly sessionId: SessionId;
}
/** Declaration-merged map of domain keys to their pending-interaction values. */
export interface SessionPendingInteractionMap {
}
/** Union of every pending-interaction value contributed by the assembled Client. */
export type SessionPendingInteraction = [
    keyof SessionPendingInteractionMap
] extends [never] ? SessionPendingInteractionBase : SessionPendingInteractionMap[keyof SessionPendingInteractionMap];
/** Independent UI status facts for one Session identity. */
export interface SessionStatus {
    /** Latest known running state; absent until a baseline or event establishes it. */
    readonly running: boolean | undefined;
    /** Highest-precedence domain request currently awaiting user interaction. */
    readonly pendingInteraction: SessionPendingInteraction | undefined;
    /** Whether an observed stop outside the main view still needs acknowledgement. */
    readonly completionUnread: boolean;
}
/** Current UI status indexed by Session identity. */
export type SessionStatusSnapshot = ReadonlyMap<SessionId, SessionStatus>;
/** Selector hook over the unified Session UI status snapshot. */
export type UseSessionStatus = SnapshotSelectorHook<SessionStatusSnapshot>;
/** Selector hook for explicit or surrounding-Provider Session reference counts. */
export interface UseSessionRetainInfo {
    /**
     * Read the complete retain information for an explicit Session identity.
     * @param sessionId - Session identity to inspect without retaining it.
     * @returns current local reference counts, or absence while the source is unavailable.
     */
    (sessionId: SessionId): SessionRetainInfo | undefined;
    /**
     * Select from the retain information for an explicit Session identity.
     * @param sessionId - Session identity to inspect without retaining it.
     * @param selector - projection over the current value.
     * @param equal - optional selected-value equality.
     * @returns selected value.
     */
    <Selected>(sessionId: SessionId, selector: (value: SessionRetainInfo | undefined) => Selected, equal?: (left: Selected, right: Selected) => boolean): Selected;
    /**
     * Select from the surrounding Provider's Session retain information.
     * @param selector - projection receiving absence outside a Session binding.
     * @param equal - optional selected-value equality.
     * @returns selected value.
     */
    <Selected>(selector: (value: SessionRetainInfo | undefined) => Selected, equal?: (left: Selected, right: Selected) => boolean): Selected;
}
/** Publish one pending interaction and define how plugin teardown delegates it. */
export type PendingInteractionPublisher<T extends SessionPendingInteractionBase> = (interaction: T, delegate: () => Promise<void>) => () => void;
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotScopeTargetMap {
        session: SessionReference;
    }
    interface GlobalStandardProps {
        /** Session list and current selection. */
        useSessions: UseSessions;
        useSessionStatus: UseSessionStatus;
        useSessionRetainInfo: UseSessionRetainInfo;
        /** Whether the current Peer may call `action` on one Session resource. */
        useSessionAccess: (sessionId: SessionId, action: RemoteEndpoint) => boolean;
    }
    interface SessionStandardProps {
        /** Current Session lifecycle and control state. */
        useSession: SessionSnapshotSelector;
        /** Current Session identity. */
        sessionId: SessionId;
        /** Host-computed projection values addressed by projection key. */
        useProjection: UseProjection;
        /** Whether the current Peer may call `action` on this Session resource. */
        useAccess: (action: RemoteEndpoint) => boolean;
    }
    interface SessionMaybeStandardProps {
        /** Current Session state, absent while no Session is selected. */
        useSession: MaybeSnapshotSelectorHook<SessionSnapshot>;
        /** Current Session identity, absent while no Session is selected. */
        sessionId: SessionId | undefined;
        /** Host-computed projection values; every key is absent without a Session. */
        useProjection: UseProjection;
        /** The bound Session's access answer; `undefined` without a Session, which callers treat as not allowed. */
        useAccess: (action: RemoteEndpoint) => boolean | undefined;
    }
}
declare module '@deepseek-ai/dsh-api-session-controller/client' {
    interface SessionReferenceSourceMap {
        mainView: unknown;
    }
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Session Controller adapter and session-scoped source registry. */
        uiSession: UiSession;
    }
}
type SessionSourceRoster = readonly string[] | undefined;
type SessionSourceRecord<Roster extends SessionSourceRoster, Value> = Roster extends readonly string[] ? Readonly<Record<Roster[number], Value>> : never;
/** Bare values produced by one Session-scoped source contribution. */
export interface SessionSourceContribution<Hooks extends SessionSourceRoster = SessionSourceRoster, KeyedHooks extends SessionSourceRoster = SessionSourceRoster, Props extends SessionSourceRoster = SessionSourceRoster> {
    readonly hooks?: SessionSourceRecord<Hooks, HostObservable<unknown>>;
    readonly keyedHooks?: SessionSourceRecord<KeyedHooks, KeyedStandardSource>;
    readonly props?: SessionSourceRecord<Props, unknown>;
}
/** Static roster and per-Session resolver for one standard-props contribution. */
export interface SessionSourceDescriptor<Hooks extends SessionSourceRoster = SessionSourceRoster, KeyedHooks extends SessionSourceRoster = SessionSourceRoster, Props extends SessionSourceRoster = SessionSourceRoster> {
    readonly hooks?: Hooks;
    readonly keyedHooks?: KeyedHooks;
    readonly props?: Props;
    /**
     * Resolve every declared member for one Session binding.
     * @param binding - Controller-owned Session binding.
     * @returns all declared bare sources and stable props.
     */
    resolve(binding: SessionBinding): SessionSourceContribution<NoInfer<Hooks>, NoInfer<KeyedHooks>, NoInfer<Props>>;
}
/** Session-scoped source roster and renderer adapter. */
export declare class UiSession extends Service {
    private readonly sessions;
    private readonly descriptors;
    private readonly bindings;
    private readonly absent;
    private readonly current;
    private readonly pendingDomains;
    private pendingSnapshot;
    private readonly running;
    private readonly completionUnread;
    private statusSnapshot;
    private readonly statusListeners;
    private mainRetainId;
    private disposeMainRetain;
    private active;
    /** Root source combining running, pending-interaction, and completion-reminder facts. */
    readonly sessionStatus: HostObservable<SessionStatusSnapshot>;
    /** Renderer-facing adapter for `session` and `session-maybe` scopes. */
    readonly adapter: SlotScopeAdapter;
    /**
     * @param ctx - Client root context.
     * @param sessions - Controller-owned Session object layer.
     */
    constructor(ctx: Context, sessions: ISessions);
    /**
     * Resolve a stable renderer source for an owned Session reference or explicit absence.
     * @param reference - active reference supplied by the Provider owner, or absence.
     * @returns the binding source, which falls back to the absent projection when its generation ends.
     * @throws when the reference does not belong to the active Controller generation.
     */
    bindingSource(reference: SessionReference | undefined): HostObservable<StandardSourceBinding>;
    /**
     * Keep `callback`'s effects installed while the current Peer may call
     * `action` on one Session resource, with the semantics of
     * `ctx.remoteAccess.whenAccess`: `useSessionAccess` answers the same
     * question during render.
     * @param sessionId - the Session resource the guarded effects depend on.
     * @param action - endpoint action the guarded effects depend on.
     * @param callback - creates one disposer or an iterable of disposers.
     * @returns idempotent disposer owned by the caller's Cordis fiber.
     */
    whenAccess(sessionId: SessionId, action: RemoteEndpoint, callback: () => AccessEffect): () => void;
    /**
     * Register one Session-scoped standard-source contribution.
     * @param descriptor - static member roster and per-binding resolver.
     * @returns disposer owned by the caller's Cordis fiber.
     */
    provide<const Hooks extends SessionSourceRoster = undefined, const KeyedHooks extends SessionSourceRoster = undefined, const Props extends SessionSourceRoster = undefined>(descriptor: SessionSourceDescriptor<Hooks, KeyedHooks, Props>): () => void;
    /**
     * Register one pending-interaction domain and return its publication function.
     * Domain teardown first removes its visible values, then delegates and awaits
     * every still-active owner request.
     * @param precedence - deterministic cross-domain precedence; larger values win.
     * @returns a function that publishes one interaction and its teardown delegation.
     */
    registerPendingInteraction<T extends SessionPendingInteractionBase>(precedence: (interaction: T) => number): PendingInteractionPublisher<T>;
    private rebuildBindings;
    private sourceFor;
    private publishMain;
    private watchMainRetention;
    private publishPendingInteractions;
    private observeRunning;
    private reconcileStatus;
    private isMain;
    private publishStatus;
    private createMaterializedBinding;
    private materialize;
    private materializeAbsent;
}
/** Required Controller, renderer, Remote, and access services. */
export declare const inject: string[];
/**
 * Install the Session root source and scoped adapter.
 * @param ctx - Client Cordis context.
 */
export declare function apply(ctx: Context): void;
export {};
//# sourceMappingURL=index.d.ts.map