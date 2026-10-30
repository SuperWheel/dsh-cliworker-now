import type { FactoryComponentPropsOf, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
type ReasoningBodyProps = PropsRuntime<'conversation.chat.reasoning.body'> & PropsRenderFactories;
/**
 * Render compact reasoning with caller-supplied labels or Chat's defaults.
 * @param props - display text, streaming state, optional localized labels, and the Factory's locale seat; no Session is required.
 * @returns the standard reasoning content; supplied labels are used without merging defaults.
 */
export declare const ReasoningContent: import("react").MemoExoticComponent<({ text, running, labels, t }: FactoryComponentPropsOf<"conversation.chat.reasoning.content">) => import("react").JSX.Element>;
/**
 * Render the default Body through the same Factory available to third-party wrappers.
 * @param props - display-ready reasoning and the framework's Factory renderer.
 * @returns an occurrence of the official reasoning Content Factory.
 */
export declare function DefaultReasoningBody({ text, running, renderFactorySlot }: ReasoningBodyProps): import("react").ReactNode;
export {};
//# sourceMappingURL=ReasoningContent.d.ts.map