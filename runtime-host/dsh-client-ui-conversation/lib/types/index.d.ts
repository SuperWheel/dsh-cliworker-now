import type { Volatile, Context } from '@deepseek-ai/cordis';
import type { BusyEnterBehavior } from './submission-settings.ts';
import z from '@deepseek-ai/schemastery';
export { BUSY_ENTER_BEHAVIORS, BUSY_ENTER_FIELD, CONVERSATION_SETTINGS_NAMESPACE, DEFAULT_BUSY_ENTER_BEHAVIOR, type BusyEnterBehavior, type ConversationSettings, } from './submission-settings.ts';
/** Runtime preferences projected to the browser. */
export interface Config {
    /** Enter key behavior while a turn is running. */
    busyEnter: Volatile<BusyEnterBehavior>;
}
/** Live preferences projected to the browser. */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    busyEnter: z<"queue" | "steer", "queue" | "steer", "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    busyEnter: z<"queue" | "steer", "queue" | "steer", "volatile-defined">;
}>>, "plain">;
/** Register browser conversation preferences.
 * @param ctx Plugin context used for optional settings presentation.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map