import type { Context } from '@deepseek-ai/cordis';
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client';
import type { DraftInitializationOptions, DraftInitializationResult, InputTriggerController, SessionInputResolver, SessionInput } from '../contract/input.ts';
import type { ComposerKeyboard } from '../contract/draft-editor.ts';
import { SessionInputShell } from './facade.ts';
/** Session-addressed input facade registry (SessionInputResolver face + composer-layer extras). */
export declare class InputHub implements SessionInputResolver {
    private readonly rootCtx;
    private readonly t;
    private readonly shells;
    /**
     * @param ctx - client root context (services resolved lazily per call — boot order stays free).
     * @param t - conversation-namespace translate thunk (reads the active locale at call time).
     */
    constructor(rootCtx: Context, t: TranslateNS<'conversation'>);
    /**
     * Resolve the facade for one session-scope ctx (SessionInputResolver face).
     * @param actx - session-scope context.
     * @returns the resident per-session facade.
     */
    for(actx: Context): SessionInput;
    requestDraftInitialization(binding: SessionBinding, options: DraftInitializationOptions): DraftInitializationResult;
    /**
     * Resolve the resident shell for an already-retained, addressable Session binding.
     * Draft import completes before return. The Session scope owns input listeners,
     * the inject-managed catalog subscription, and shell teardown.
     * @param binding - session assembly handle.
     * @returns the shell.
     */
    shellFor(binding: SessionBinding): SessionInputShell;
    /**
     * Resident shell by session id (service-face path; the provide channel has
     * normally created it already — this covers direct id-addressed access).
     * @param id - session id.
     * @returns the shell.
     */
    shell(id: SessionId): SessionInputShell;
    /**
     * The InputBar-exclusive keyboard command face: the shell
     * satisfies it structurally; package-internal — handed through the
     * composer-bar entry's inject, never across a plugin boundary.
     * @param id - session id.
     * @returns the shell as the keyboard face.
     */
    keyboard(id: SessionId): ComposerKeyboard;
    /**
     * Query file intake without creating a Session input.
     * @param id - target Session.
     * @returns whether its mounted composer currently accepts files.
     */
    canPickFiles(id: SessionId): boolean;
    /**
     * Open the target composer's file dialog under its live intake policy.
     * @param id - target Session.
     */
    pickFiles(id: SessionId): void;
    /**
     * Resolve the optional slash controller for composer chrome that launches
     * the shared candidate menu without typing a trigger.
     * @param id - session id.
     * @returns the resident controller, or undefined when no trigger provider is installed.
     */
    inputTriggers(id: SessionId): InputTriggerController | undefined;
    /**
     * Default sink: prompt while the composer holds the sent draft. The session
     * is always a real host entity (materialized when its workspace was picked),
     * so there is exactly one path; a refused or failed prompt is an ordinary
     * prompt failure (banner via promptError, draft kept in the composer).
     */
    private sink;
    /**
     * Submit every still-pending queued message through QueueDock Steer, in FIFO
     * request order — the same operation as the queue dock's per-row button.
     * An Agent stopping before a command (`session/steer-unavailable`) or a row already
     * claimed by the agent (`session/queue-item-not-found`) converges silently, while a
     * genuine failure surfaces as one composer notice. Repeated triggers
     * (e.g. two rapid empty-draft chords) rely on that `session/queue-item-not-found`
     * convergence: the snapshot may still list a row the host already steered,
     * and the duplicate Steer is a silent no-op.
     * @param session - the addressed host session.
     * @param shell - the resident shell (notice outlet).
     */
    private steerQueue;
    private controller;
    private popup;
    private sessions;
    private conversation;
}
//# sourceMappingURL=hub.d.ts.map