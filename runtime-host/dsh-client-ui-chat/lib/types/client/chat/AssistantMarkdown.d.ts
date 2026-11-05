import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots';
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ChatNodeOwnerProps, ChatViewSlotProps, UseDisclosure, UsePresentation, UseGroupAction } from '../contract/slots.ts';
import type { AssistantBlock } from '../contract/snapshot.ts';
/**
 * Standalone fallback for image destinations (query/fragment suffixes are ignored).
 * Chat fileImages resolves decoded file references against cwd; pathImages also
 * serves this component outside that provider and accepts legacy image URL suffixes.
 * Resolve an authored absolute image path against the document's file API.
 * @param base - canonical `document.baseURI` at render time.
 * @param value - authored Markdown destination; URL escapes are decoded once.
 * @returns an absolute Web or Desktop file-API URL, or undefined for unsupported
 * protocols and non-local paths.
 */
export declare function localPathMediaUrl(base: string, value: string): string | undefined;
export interface AssistantMarkdownProps extends Pick<PropsRenderSlots<'conversation.chat.reasoning.body' | 'conversation.chat.message.images'>, 'renderSlot'>, Pick<ChatNodeOwnerProps, 'loadImage'> {
    /** Render only the requested business portion, preserving original block indexes. */
    groupPart?: string | undefined;
    /** Stable Hook forwarded to each independently expandable reasoning block. */
    useDisclosure: UseDisclosure;
    blocks: readonly AssistantBlock[];
    streaming: boolean;
    /** Only finalized durable Assistant messages supply selection sources. */
    textInteractionSource?: boolean;
    /** Frozen partial of an aborted turn: rendered with a stopped marker. */
    interrupted?: boolean | undefined;
    /** Hide reasoning that belongs to the Turn-level process disclosure. */
    reasoningHidden?: boolean | undefined;
    /** Process hiding bound by the node slot to its current viewport. */
    useGroupAction: UseGroupAction;
    /** Live display policy for reasoning summaries. */
    usePresentation: UsePresentation;
    /** Reveal the disclosure that hides this reasoning. */
    revealProcess?: (() => void) | undefined;
    /** Resolved prose file mentions for this Assistant's closing turn. */
    mentions?: MarkdownFileMentions | undefined;
    /** The owning view's locale seat, passed down as a plain prop. */
    t: ChatViewSlotProps['t'];
}
/** Renders non-blank reasoning blocks as independent disclosures alongside the response. */
export declare const AssistantMarkdown: import("react").MemoExoticComponent<({ blocks, streaming, textInteractionSource, interrupted, loadImage, groupPart, useDisclosure, reasoningHidden, usePresentation, revealProcess, mentions, renderSlot, useGroupAction, t, }: AssistantMarkdownProps) => import("react").JSX.Element | null>;
//# sourceMappingURL=AssistantMarkdown.d.ts.map