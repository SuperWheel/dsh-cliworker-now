import z from "@deepseek-ai/schemastery";
//#region lib/types/submission-settings.js
/** Busy-Enter preference stored in the Host user-settings document. */
/** Settings namespace owned by the conversation plugin. */
const CONVERSATION_SETTINGS_NAMESPACE = "ui-conversation";
/** Field carrying the delivery mode for plain Enter while an agent is busy. */
const BUSY_ENTER_FIELD = "busyEnter";
/** Busy-Enter behaviors accepted at settings and input boundaries. */
const BUSY_ENTER_BEHAVIORS = ["queue", "steer"];
/** Default preserves Enter-as-Queue for running conversations. */
const DEFAULT_BUSY_ENTER_BEHAVIOR = "queue";
/** Durable conversation schema; also the wire envelope the browser scope validates against. */
const ConversationSettingsFields = { [BUSY_ENTER_FIELD]: z.union([...BUSY_ENTER_BEHAVIORS]).default(DEFAULT_BUSY_ENTER_BEHAVIOR) };
z.object(ConversationSettingsFields);
//#endregion
//#region lib/types/index.js
/** Live preferences projected to the browser. */
const Config = z.object({ [BUSY_ENTER_FIELD]: ConversationSettingsFields[BUSY_ENTER_FIELD].volatile() });
/** Register browser conversation preferences.
* @param ctx Plugin context used for optional settings presentation.
*/
function apply(ctx) {
	ctx.inject(["settings"], (child) => {
		child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
	});
}
//#endregion
export { BUSY_ENTER_BEHAVIORS, BUSY_ENTER_FIELD, CONVERSATION_SETTINGS_NAMESPACE, Config, DEFAULT_BUSY_ENTER_BEHAVIOR, apply };
