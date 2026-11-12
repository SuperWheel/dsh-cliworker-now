/** Chat-owned approval detail resolving a correlated Tool call's command. */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
interface ApprovalToolCall {
    readonly callId: string;
    readonly name: string;
    readonly argsRaw: string;
}
/**
 * Extract the command line from a correlated Tool call: a shell `command`, or the text `terminal_send` types into a terminal.
 * @param call - Tool call name and arguments, when a correlated call exists.
 * @returns command text, or undefined for absent, empty, malformed, or unrelated arguments.
 */
export declare function commandOf(call: ApprovalToolCall | undefined): string | undefined;
/**
 * Render the command of the Chat Tool node correlated with an approval.
 * @param props - Approval identity and Session-standard Chat selector hook.
 * @returns command text when the correlated call carries one.
 */
export declare function ApprovalCommand({ callId, useChat }: PropsRuntime<'conversation.approval.detail'>): string | null;
export {};
//# sourceMappingURL=ApprovalCommand.d.ts.map