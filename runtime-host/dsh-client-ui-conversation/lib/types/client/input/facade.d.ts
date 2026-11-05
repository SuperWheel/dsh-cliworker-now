/**
 * SessionInput shell: owns the per-session Lexical editor (text + chip
 * truth) and the pure SubmitMachine (phase/claim/attempt), and choreographs
 * everything between them — projections and InputState publication, the
 * scoped-event application verbs, the submit transaction plumbing
 * (adjudicate via the session's InputTriggerController; claim.submit; default
 * sink), the notice channel, and the draft persistence mirror.
 * Package-private; the hub alone constructs it and wires the scoped event
 * listeners onto it.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { InboxState } from '@deepseek-ai/dsh-agent/types';
import { type ObservableSnapshot, type SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { LexicalEditor } from 'lexical';
import type { CommandClaim, ConsumeTokenRequest, DraftAttachmentId, DraftInitializationOptions, DraftInitializationResult, InputActions, InputNotice, InputState, InputTriggerController, SessionInput, SubmitAttachment, SubmitOutcome } from '../contract/input.ts';
import type { ArbitrateKey, ArbitrateOutcome, ComposerKeyboard, DraftInput, DraftSnapshot, ReferenceInsert, TokenSpan } from '../contract/draft-editor.ts';
import type { InputSubmitMode, MessageSubmission, MessageSubmissionState } from '../contract/composer-submission.ts';
/** Popup face the shell needs (dismissal only; typed structurally to avoid a value import). */
export interface PopupDismissFace {
    dismiss(): void;
}
/**
 * Construction dependencies of one input model. Trigger and popup callbacks
 * resolve the currently available Session-scoped services on demand. InputHub
 * owns the lexicon subscription through the Session scope's inject lifecycle.
 */
export interface SessionInputDeps {
    /** Session-scope ctx handed to claim.submit transactions. */
    actx: Context;
    /** Snapshot the Session facts before asynchronous command arbitration. */
    submissionState?: () => MessageSubmissionState;
    /** Notify one ordinary message attempt before reference serialization. */
    messageSubmitted?: (submission: MessageSubmission) => void;
    /** Enter adjudication face resolver; absent/undefined answer = every '/' line falls to the default sink. */
    inputTriggers?: (() => InputTriggerController | undefined) | undefined;
    /** PopupSelect shell face resolver (dismissal on submit lock / escape). */
    popup?: (() => PopupDismissFace | undefined) | undefined;
    /** Agent Inbox projection; its next-turn list is overlaid onto InputState.queue. */
    inbox?: ObservableSnapshot<InboxState | undefined> | undefined;
    /**
     * Steer every still-pending queued message into the running turn, in FIFO
     * order (the empty-draft accelerated-Enter gesture); absent = unsupported.
     */
    steerQueue?: (() => void) | undefined;
    /**
     * The plain-message sink (send choreography / materialize fork — the hub owns it).
     * `accept` settles the message as accepted at once; the sink calls it when
     * the Host's acceptance is known before the returned outcome, so the editor
     * shrinks before the message's echo renders.
     */
    defaultSink(text: string, attachmentIds: readonly DraftAttachmentId[], mode: InputSubmitMode, signal: AbortSignal, accept: () => void): Promise<SubmitOutcome>;
    /** Live Session and composer-block policy for transcript insertion. */
    quoteInsertionAllowed?: () => boolean;
    /** Current localized quote removal copy. */
    quoteRemoveLabel?: () => string;
    /** Command-plane attachment plumbing (the hub owns the conversation face and the copy). */
    commandAttachments: {
        /** Resolve ordered draft ids to wire payloads without sending them; rejects when an id no longer resolves. */
        serialize(ids: readonly DraftAttachmentId[]): Promise<readonly SubmitAttachment[]>;
        /** Free consumed draft attachments after a successful command submit. */
        release(ids: readonly DraftAttachmentId[]): void;
        /** Localized composer notice for a claimed command that does not accept attachments. */
        unsupportedNotice(token: string): string;
    };
}
/**
 * The per-session input facade: scoped-event application verbs +
 * setDraft/submit + the published InputState store, over a shell-owned
 * Lexical editor.
 */
export declare class SessionInputShell implements SessionInput {
    private readonly deps;
    /** Published editor projection + submit-plane state + queue overlay (the InputZone currency source). */
    readonly state: SnapshotStore<InputState>;
    /** Latest surfaced notice (null after clear); the bar renders errors as banners and information inline. */
    readonly notices: SnapshotStore<InputNotice | null>;
    /** The shell-owned editor (text + chip truth); the composer binds its contenteditable to it. */
    get editor(): LexicalEditor;
    /** The public provide-channel action face (one stable identity per session). */
    readonly actions: InputActions;
    private readonly core;
    private readonly draftEditor;
    private get projection();
    private rev;
    private readonly unregister;
    private noticeSeq;
    private lastPublishedDraft;
    private draftSnapshotCache;
    private attachmentIds;
    private disposed;
    /** Conversation store writer for the current semantic document. */
    private persistDraft;
    /** A restored draft's command token waiting for the trigger pipeline, with the revision its restore produced. */
    private pendingCommand;
    /** The in-flight claim resolution for a restored command chip. */
    private commandRestore;
    /** The mounted composer's file-picker opener (scoped pick-files event target). */
    private filePicker;
    private readonly unsubscribeInbox;
    constructor(deps: SessionInputDeps);
    /** Re-project, sync the claim with the leading command chip, publish, and feed trigger tracking after every editor commit. */
    private onEditorUpdate;
    /**
     * Replace the whole draft (persisted-draft seed and programmatic writes).
     * Placeholder-sanitized; newlines split paragraphs; the caret lands at the
     * end. Merged into history so a seed is not an undoable step of its own.
     * @param text - plain text or the complete semantic document.
     */
    setDraft(text: DraftInput): void;
    /** @param text - selected transcript text. @returns whether the editable draft accepted the quote. */
    insertQuote(text: string): boolean;
    /**
     * Reconnect optional catalog notifications and resume a pending command
     * chip restore without waiting for another edit.
     */
    refreshLexiconSubscription(): void;
    /**
     * Rebuild the command chip a restored draft carried once the trigger
     * pipeline can resolve its claim. The rebuild applies only at the revision
     * the restore produced: an edit made while the claim resolves keeps the
     * literal token, which Enter still adjudicates as the command.
     */
    private restoreCommand;
    /** Drop a pending or in-flight command chip restore. */
    private cancelCommandRestore;
    /** Current semantic document, stable until its content revision changes. */
    get draftSnapshot(): DraftSnapshot;
    /** Persist the latest document without changing the editor or binding a writer. */
    persistCurrentDraft(): void;
    /**
     * Apply one new-task request to this already-initialized input model.
     * @param options - content to adopt and the handling of an existing draft.
     * @returns applied when the requested text is adopted, even if unchanged;
     * preserved when the current draft is kept; blocked after disposal or during a pending submission.
     */
    requestDraftInitialization(options: DraftInitializationOptions): DraftInitializationResult;
    private draftInitializationBlocked;
    /** Append ordered attachment ids unless an admission transaction is locked. */
    addAttachments(ids: readonly DraftAttachmentId[]): boolean;
    /**
     * Add validated file references and attachment ids while admission is editable.
     * @param references - reference chips in source order.
     * @param ids - newly allocated attachment ids.
     * @returns false when admission is locked or the editor refuses the insertion.
     */
    addFiles(references: readonly ReferenceInsert[], ids: readonly DraftAttachmentId[]): boolean;
    /**
     * Remove one attachment id from this draft. Busy admission phases refuse, like
     * {@link addAttachments}: a removal landing while a send serializes would
     * otherwise vanish from the rail yet still ride the in-flight send.
     */
    removeAttachment(id: DraftAttachmentId): boolean;
    /**
     * Keep only ids that still resolve in the browser attachment registry.
     * @param available - live registry ids.
     */
    pruneAttachments(available: readonly DraftAttachmentId[]): void;
    /**
     * Insert pasted plain text over the current editor selection
     * (placeholder-sanitized). The paste event's own default is suppressed by
     * the caller; PASTE_TAG makes the paste its own history boundary, so one
     * undo never removes both the paste and typing inside the merge window.
     * @param text - pasted plain text.
     */
    paste(text: string): void;
    /**
     * Enter adjudication + submit transaction + default sink with the draft, its
     * reference chips, and its attachments as the user sent them. Effects fan
     * out from the machine; this method only feeds the event. Lock entry
     * (adjudicating/submitting/sending) force-closes the transient layers: the
     * popup dismisses and the menu tracks frozen.
     */
    submit(mode?: InputSubmitMode, source?: 'click' | 'enter'): void;
    /**
     * Keyboard arbitration while the menu is open.
     * @param key - the intercepted key.
     * @param composing - IME composition guard state.
     * @returns the menu's verdict; 'pass' when no pipeline is mounted.
     */
    arbitrate(key: ArbitrateKey, composing: boolean): ArbitrateOutcome;
    /**
     * Steer every still-pending queued message into the running turn (the
     * empty-draft accelerated-Enter gesture). Execution belongs to the hub's
     * queue choreography; absent dep = the gesture falls back to the machine's
     * empty-draft no-op.
     */
    steerQueue(): void;
    /**
     * Space adjudication over the controller's hot state.
     * @returns true = a claim/insert was applied — the caller preventDefaults.
     */
    space(): boolean;
    /** Dismiss the popupSelect shell (any interaction outside the box). */
    dismissPopup(): void;
    /**
     * The live selection as a detect-coordinate span (menu-launcher synthetic
     * hits replace it on pick); an absent selection answers a collapsed span at
     * the document end.
     * @returns the ordered [start, end) span in detect coordinates.
     */
    caretSpan(): {
        start: number;
        end: number;
    };
    /**
     * Hot plain-text reference lexicon source for the decoration scan:
     * delegates to the controller's aggregated store. Stable
     * identity per shell; without a pipeline the snapshot is the empty Map and
     * subscribers never fire.
     */
    readonly lexicon: ObservableSnapshot<ReadonlyMap<'/' | '@', readonly string[]>>;
    /**
     * Apply one command claim (scoped begin-command event listener body): the
     * editor replaces [0, span.end) with the command chip and its separator,
     * then the machine enters claimed.
     * @param claim - the command claim from the pick path.
     * @param span - pick-time span snapshot (detect coordinates).
     * @returns whether the edit applied (phase, span CAS, and leading guard passed).
     */
    beginCommand(claim: CommandClaim, span: TokenSpan): boolean;
    /**
     * Replace [0, span.end) with the command chip and enter claimed.
     * @param mergeHistory - merge the edit into the previous history entry.
     * @returns whether the edit applied.
     */
    private applyClaim;
    /**
     * Apply one reference insertion (scoped insert-reference event listener
     * body): the editor replaces the span with one chip node, followed by a
     * separating space unless one is already next.
     * @param ref - the reference insertion from the pick path.
     * @param span - pick-time span snapshot (detect coordinates).
     * @returns whether the edit applied.
     */
    insertReference(ref: ReferenceInsert, span: TokenSpan): boolean;
    /**
     * Consume one command token after business success (scoped consume-token
     * event listener body). Span guard: revision CAS then splice; bare-token
     * guard: trimmed-draft equality then clear.
     * @param guard - exact span or bare-token guard.
     * @returns whether the token was consumed.
     */
    consumeToken(guard: ConsumeTokenRequest['guard']): boolean;
    /**
     * Insert plain reference text over the pick-time span (scoped insert-text
     * event listener body; the plain-text reference path). The editor gains
     * ordinary characters — no chip node; the chip look is a scan-derived
     * decoration, never state.
     * @param text - the plain reference text to splice in (e.g. `/name `).
     * @param span - pick-time span snapshot (detect coordinates).
     * @param keepCompleting - contract passenger; completion re-opening is
     * automatic here (the update listener re-tracks at the settled caret, so an
     * open token — a directory pick's trailing slash — reopens the menu without
     * an explicit re-track).
     * @returns whether the text was applied.
     */
    insertText(text: string, span: TokenSpan, keepCompleting?: boolean): boolean;
    /**
     * Surface a notice from outside the machine (detached command results).
     * @param level - severity tier.
     * @param text - notice body.
     */
    notify(level: 'info' | 'error', text: string): void;
    /**
     * Return the keyboard to the composer with the caret it last held. Lexical's
     * own focus restores its stored selection; a bare DOM focus on the
     * contenteditable would land the caret at the start instead.
     */
    focus(): void;
    /**
     * Teardown the shell, abort the in-flight attempt, and return every
     * browser-owned attachment the draft still holds, including those of a
     * message the Host has not accepted yet.
     * @returns attachment ids the scope disposer must release.
     */
    dispose(): readonly DraftAttachmentId[];
    /** Read the live input state (guard derivation reads here). */
    get snapshot(): InputState;
    /**
     * Bind the Conversation store writer without importing or saving content.
     * @param write - semantic draft writer; persistCurrentDraft flushes the initial value.
     * @returns the unbind disposer.
     */
    bindDraftPersistence(write: (draft: DraftSnapshot) => void): () => void;
    /**
     * Bind the mounted composer's file action and live intake availability.
     * @param picker - availability query and native file-dialog opener.
     * @returns the unbind disposer.
     */
    bindFilePicker(picker: Parameters<ComposerKeyboard['bindFilePicker']>[0]): () => void;
    /**
     * Read the mounted composer's live file-intake availability.
     * @returns false when no accepting composer is mounted.
     */
    canPickFiles(): boolean;
    /**
     * Open the native file dialog when the mounted composer accepts files.
     * @returns whether the opener was called.
     */
    pickFiles(): boolean;
    /** Dispatch one machine event and execute its effects. */
    private dispatchRun;
    private run;
    private execute;
    /**
     * Execute the commit-draft effect: clear the committed content (retaining
     * a pure typed-during-flight suffix when the snapshot allows) and cut the
     * undo history so sent content cannot resurrect.
     */
    private commitDraft;
    /**
     * Prompt serialization before the sink: expand each chip occurrence of the
     * sent draft to its owner's model form via the session controller's codec
     * routing and format each quote as Markdown, then send it with the
     * attachments captured at Enter. Owner missing or serialization failure
     * settles the send as failed, which keeps the draft. Chip-free drafts skip
     * the async detour.
     */
    private sinkSerialized;
    private notifySubmission;
    /**
     * Settle the message being sent. Once the Host accepts it, its attachments
     * leave the draft before the editor clears; ConversationController releases
     * them when the message's echo retires. Any other outcome keeps the draft
     * and its attachments for correction.
     */
    private settleSink;
    /** Settle the message being sent as accepted when the sink learns the Host's acceptance before its outcome. */
    private acceptSink;
    private applySinkOutcome;
    /** Settle a send that ended without a Host outcome; the draft stays for correction. */
    private failSink;
    /** Enter adjudication: poll the session controller; failure = notice + draft retained (never a silent downgrade). */
    private adjudicate;
    /**
     * The submit transaction: claim.submit against the session scope; ok maps
     * from the outcome kind. An accepting claim receives the serialized draft
     * attachments, which are cleared and released only on a success outcome; a
     * failure (serialize, transport, or handler error) keeps draft and attachments
     * for correction.
     */
    private beginSubmit;
    /** Late-settlement guard: superseded attempts and disposed facades drop silently. */
    private dead;
    private compose;
    private publish;
}
//# sourceMappingURL=facade.d.ts.map