/**
 * Scope-addressed conversation send, cancel, and history orchestration.
 *
 * Scope addressing rides the cordis Service tracker: property access through
 * `ctx.conversation` rebinds `this.ctx` to the caller's context, so methods
 * read the session tag with `scopeOf`. Mutable state must remain reachable
 * through one property read; assignment through the tracker proxy and `#`
 * private fields bypass that rebinding.
 */
import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { ComposerAttachment, DraftFileUpload } from './contract/slots.ts';
import type { QueueAction } from '@deepseek-ai/dsh-api-session-controller/types';
import type { MessageId } from '@deepseek-ai/dsh-llm/brand';
import type { ComposerBlocks } from './contract/composer-blocks.ts';
import type { DraftAttachmentId, DraftAttachmentSerializationResult, SessionInputResolver, SubmitOutcome } from './contract/input.ts';
import type { InputSubmitMode } from './contract/composer-submission.ts';
/**
 * The outward conversation face (`ctx.conversation`): the scope-addressed
 * verbs and the input registry other plugins may reach — and exactly what a
 * test fake must supply.
 */
export interface IConversation {
    /** The per-session input machine registry (SessionInputResolver face). */
    readonly input: SessionInputResolver;
    /**
     * The per-session composer-block registry: how a plugin the composer
     * cannot import makes a session's input inert with its own reason.
     */
    readonly blocks: ComposerBlocks;
    /**
     * Send a prompt into the caller scope's session (queued turn).
     * @param text - prompt text, sent verbatim as one text block.
     * @returns completion; business failures reject (and land in promptError).
     */
    send(text: string): Promise<void>;
    /**
     * Apply one edit, remove, or Steer operation to a pending queue occurrence.
     * @param itemId - agent-owned inbox occurrence identity.
     * @param action - requested queue operation.
     * @returns completion; converged QueueDock races resolve, while other failures reject.
     */
    updateQueue(itemId: MessageId, action: QueueAction): Promise<void>;
    /**
     * Cancel the scoped session's in-flight turn while preserving its pending Queue.
     * @returns completion; failures reject as in send.
     */
    cancel(): Promise<void>;
    /**
     * Pull one older history page for the scoped session.
     * @returns completion of the page pull.
     */
    loadOlder(): Promise<void>;
}
/** Unsupported browser-declared image type, localized by the UI boundary. */
export declare class UnsupportedImageMediaTypeError extends Error {
    /** Browser-declared MIME value, possibly empty. */
    readonly mediaType: string;
    /** @param mediaType - Browser-declared MIME value, possibly empty. */
    constructor(mediaType: string);
}
/** Scope-addressed conversation service (root singleton, provided as `conversation`). */
export declare class ConversationController extends Service implements IConversation {
    /** The per-session input machine registry (SessionInputResolver face). */
    readonly input: SessionInputResolver;
    /** The per-session composer-block registry. */
    readonly blocks: ComposerBlocks;
    /** Live upload state per draft that uploads when added: every file draft and every uploaded image draft. */
    readonly fileUploads: SnapshotStore<Record<string, DraftFileUpload>>;
    private readonly draftAttachments;
    private readonly fileUploadOperations;
    private readonly pendingFileUploads;
    private readonly fileUploadQueue;
    private activeFileUploads;
    private readonly maxConcurrentFileUploads;
    /**
     * @param ctx - owning root context (the plugin apply context; the service
     * registers itself and follows that fiber's lifetime).
     * @param config - carries the SessionInputResolver and composer-block registry
     * constructed by the plugin apply (the same instances the slot inject
     * factories close over).
     */
    constructor(ctx: Context, config: {
        input: SessionInputResolver;
        blocks: ComposerBlocks;
        maxConcurrentFileUploads: number;
    });
    /**
     * Send a prompt into the scoped session. Business failures also land in the
     * session snapshot's promptError (object-layer state); the rejection here
     * exists for caller choreography (the composer restores the draft on it).
     * @param text - prompt text, sent verbatim as one text block.
     */
    send(text: string): Promise<void>;
    /**
     * Submit ordered draft attachments with text through one host admission. A
     * local submission echo is registered first and enters the session snapshot
     * once the Host accepts the prompt; serialization and the prompt round-trip
     * start after the browser can paint the composer's sending state. The
     * outcome is success as soon as the Host accepts the prompt, which an Inbox
     * row carrying the request id can show before the receipt. The echo's
     * observed retirement seeds admitted image previews into the durable cache
     * and removes every attachment from the draft registry; an accepted prompt
     * whose echo retires unobserved also releases them. Until the Host accepts
     * the prompt, every attachment remains registered for the composer.
     * @param session - target session.
     * @param text - serialized prompt text.
     * @param attachmentIds - ordered draft-local attachment ids.
     * @param mode - queue or steer delivery selected by composer policy.
     * @param signal - optional cancellation for the complete Host admission.
     * @param accept - called inside the Session's acceptance, before the echo renders, so the composer settles with it.
     * @returns the Host admission outcome; local attachment preparation failures reject.
     */
    sendSession(session: SessionFace, text: string, attachmentIds: readonly DraftAttachmentId[], mode: InputSubmitMode, signal?: AbortSignal, accept?: () => void): Promise<SubmitOutcome>;
    /**
     * Create runtime-only draft attachments. Files whose browser MIME is an
     * accepted image type become image drafts with an object URL preview; every
     * other file becomes a file draft. A file draft's background upload starts
     * immediately, and so does an image draft's when `uploadImages` is set; the
     * upload remains owned by this service across Session navigation until
     * completion or explicit removal. An image draft without an upload sends its
     * bytes with the prompt.
     * @param sessionId - target Agent-scope identity.
     * @param files - browser files to register.
     * @param uploadImages - whether the Session accepts image uploads; a subagent continuation does not.
     * @returns ordered draft descriptors.
     */
    createDrafts(sessionId: SessionId, files: readonly File[], uploadImages: boolean): readonly ComposerAttachment[];
    /**
     * Restart one failed file or image upload.
     * @param sessionId - target Agent-scope identity.
     * @param id - draft attachment id whose upload previously failed.
     */
    retryFileUpload(sessionId: SessionId, id: DraftAttachmentId): void;
    /**
     * Stage carried file and image drafts again for a new Session.
     * @param sessionId - target Agent-scope identity after a Workspace switch.
     * @param ids - carried draft attachment ids.
     * @param uploadImages - whether the target Session stages image uploads; an image draft otherwise sends inline.
     */
    rebindDraftFiles(sessionId: SessionId, ids: readonly DraftAttachmentId[], uploadImages: boolean): void;
    private beginFileUpload;
    /** Start queued upload Workers until the configured concurrency is occupied. */
    private pumpFileUploads;
    /**
     * Resolve ordered input-state ids to runtime-owned draft attachments.
     * @param ids - draft attachment ids.
     * @returns descriptors that remain live, in requested order.
     */
    resolveDraftAttachments(ids: readonly DraftAttachmentId[]): readonly ComposerAttachment[];
    /**
     * Serialize ordered draft attachments to command-submit wire payloads without
     * sending or releasing them. Images are encoded even when an upload already
     * stored them, because commands accept only file receipts; generic files cite
     * receipts from their completed background uploads and never reread browser bytes.
     * @param attachmentIds - ordered draft-local attachment ids.
     * @returns wire payloads in id order.
     */
    serializeDraftAttachments(attachmentIds: readonly DraftAttachmentId[]): Promise<DraftAttachmentSerializationResult>;
    /**
     * Release one browser-owned draft attachment, aborting its active upload.
     * @param id - draft attachment id.
     */
    releaseDraftAttachment(id: DraftAttachmentId): void;
    /** Abort one draft's active upload and drop its upload state. */
    private dropUpload;
    /** Drop one draft's upload state. */
    private forgetUpload;
    /**
     * Release a set of browser-owned draft attachments.
     * @param attachments - descriptors to release.
     */
    releaseDraftAttachments(attachments: readonly ComposerAttachment[]): void;
    /** Apply one operation to a pending queue occurrence. */
    updateQueue(itemId: MessageId, action: QueueAction): Promise<void>;
    /** Cancel the scoped session's in-flight turn while preserving Queue (failures land in promptError and reject, as in send). */
    cancel(): Promise<void>;
    /** Pull one older history page for the scoped Session. */
    loadOlder(): Promise<void>;
    /** Resolve the caller scope's session face or throw on root contexts. */
    private scopedSession;
    /** Read the caller's session scope tag via the sessions service; root contexts fail loud. */
    private scopeId;
    private requireSessions;
    /**
     * Settle one submission's draft attachments when its echo is observed: each
     * file is released, and each image leaves the registry, handing its preview
     * URL to the durable image cache (seeded under the admitted reference so the
     * transcript node renders immediately while the cache reads canonical
     * bytes) or revoking it when the cache already holds that reference.
     */
    private settleSubmittedAttachments;
    /** Canonical base64 wire form of one browser image file. */
    private encodeImage;
}
/**
 * Whether a browser-declared MIME selects the image draft path (all other files upload verbatim).
 * @param value - the browser's declared MIME type.
 * @returns whether the file is an accepted raster image.
 */
export declare function isImageMediaType(value: string): boolean;
//# sourceMappingURL=service.d.ts.map