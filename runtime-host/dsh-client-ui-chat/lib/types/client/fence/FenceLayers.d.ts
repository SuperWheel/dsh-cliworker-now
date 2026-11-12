import type { ReactNode } from 'react';
import type { HocShare, PropsLocale, PropsRuntime, SlotMap } from '@deepseek-ai/dsh-client-ui-slots';
/** Props of the math layer: the fence and the next inner content. */
export type MathFenceLayerProps = PropsRuntime<'conversation.chat.markdown.fence'> & HocShare<SlotMap['conversation.chat.markdown.fence']>;
/** Props of the diff layer: the fence and the Chat locale seat. */
export type DiffFenceLayerProps = PropsRuntime<'conversation.chat.markdown.fence'> & PropsLocale<'chat'>;
/**
 * Show a `math` fence as display TeX once its document settles; while it
 * streams, the inner code block shows the source so a partial formula never
 * renders as an error.
 * @param props - the fence and the inner content.
 * @returns the formula, or the inner content while streaming.
 */
export declare function MathFenceLayer({ code, streaming, children }: MathFenceLayerProps): ReactNode;
/**
 * Show a `diff` or `patch` fence as unified-diff rows in place of the inner code block.
 * @param props - the fence and the Chat locale seat.
 * @returns the diff code block.
 */
export declare function DiffFenceLayer({ lang, code, streaming, t }: DiffFenceLayerProps): ReactNode;
//# sourceMappingURL=FenceLayers.d.ts.map