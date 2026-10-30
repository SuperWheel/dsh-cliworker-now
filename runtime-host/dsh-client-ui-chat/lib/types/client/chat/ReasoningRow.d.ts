import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots';
import type { ChatViewSlotProps, UseDisclosure, UsePresentation } from '../contract/slots.ts';
/**
 * Render one assistant reasoning block collapsed until the reader opens it. The
 * collapsed summary omits double-asterisk markers; expanded content renders
 * the complete Markdown with secondary typography. A streaming preview advances
 * when a paragraph's first line completes. Mode changes toggle CSS display without unmounting
 * collapsed summaries. The Body Slot receives both original and display-ready text.
 * @param props.text - complete or streaming reasoning text.
 * @param props.running - whether this block is the streaming tail.
 * @param props.usePresentation - live display-policy selector for this reasoning row.
 * @param props.useDisclosure - independent open state with enclosing-Turn resets.
 * @param props.renderSlot - framework renderer for the standard reasoning Body Slot.
 * @param props.t - conversation locale seat for the disclosure and running status.
 * @returns the reasoning disclosure.
 */
export declare const ReasoningRow: import("react").MemoExoticComponent<({ text: rawText, running, usePresentation, useDisclosure, renderSlot, t }: {
    text: string;
    running: boolean;
    useDisclosure: UseDisclosure;
    usePresentation: UsePresentation;
    t: ChatViewSlotProps["t"];
} & Pick<PropsRenderSlots<"conversation.chat.reasoning.body">, "renderSlot">) => import("react").JSX.Element | null>;
//# sourceMappingURL=ReasoningRow.d.ts.map