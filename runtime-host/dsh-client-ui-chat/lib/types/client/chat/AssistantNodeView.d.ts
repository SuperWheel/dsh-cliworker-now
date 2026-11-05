import type { InjectFace, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots';
import type { ChatFileMentions, ChatNodeViewProps, PresentationInjected, TurnTailOwnerProps } from '../contract/slots.ts';
/** Business readers owned by the assistant renderer's existing Slot registration. */
export interface AssistantNodeInjected extends PresentationInjected {
    /** Resolve against the live Session directory. @param path - Recorded path. @returns Host path. */
    resolveFilePath: (path: string) => string;
    /** Resolve closing-Turn mentions with the supplied ordinary file gesture callback. */
    fileMentions: (owner: TurnTailOwnerProps, getFileTriggerProps: NonNullable<Parameters<ChatFileMentions['forClosing']>[2]>) => ReturnType<ChatFileMentions['forClosing']>;
}
type AssistantNodeViewProps = ChatNodeViewProps<'assistant-step'> & InjectFace<AssistantNodeInjected> & PropsRenderSlots<'conversation.chat.reasoning.body' | 'conversation.chat.message.images'>;
/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export declare const AssistantNodeView: import("react").MemoExoticComponent<({ node, groupPart, useDisclosure, useGroupAction, useTurnData, turnProcess, openFile, loadImage, fileMentions, usePresentation, renderSlot, t, sessionId, useContextMenu, resolveFilePath, }: AssistantNodeViewProps) => import("react").JSX.Element>;
export {};
//# sourceMappingURL=AssistantNodeView.d.ts.map