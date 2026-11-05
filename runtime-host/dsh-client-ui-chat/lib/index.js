import z from "@deepseek-ai/schemastery";
//#region lib/types/chat-settings.js
/** Chat display preferences stored in the Host user-settings document. */
/** Settings namespace owned by the Chat target. */
const CHAT_SETTINGS_NAMESPACE = "ui-chat";
/** Field carrying the work-details presentation mode. */
const TRANSCRIPT_VIEW_FIELD = "transcriptView";
/** Field carrying the independent work-details collapse timing. */
const COLLAPSE_TIMING_FIELD = "collapseTiming";
/** Available points when a completed Turn returns to its historical presentation. */
const COLLAPSE_TIMINGS = ["completion", "next-input"];
/** Preserve completion-time folding when no timing preference is saved. */
const DEFAULT_COLLAPSE_TIMING = "completion";
/** Field carrying which Assistant replies stay visible in a folded Turn. */
const FOLDED_REPLIES_FIELD = "foldedReplies";
/** Assistant replies kept visible while a completed Turn folds its process: every reply, or only the final answer. */
const FOLDED_REPLIES = ["all", "final"];
/** Work-details presentation modes a user can choose. */
const TRANSCRIPT_VIEW_MODES = [
	"compact",
	"standard",
	"detailed",
	"verbose"
];
/**
* Saved value from the two-mode generation of this setting. Read as `detailed`;
* never offered as a choice and never written back.
*/
const LEGACY_TRANSCRIPT_VIEW_MODE = "normal";
/** Saved `expanded` values read as `detailed`, without being offered or written back. */
const LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE = "expanded";
/** Every value the durable field accepts: current modes plus legacy saved values. */
const TRANSCRIPT_VIEW_SETTING_VALUES = [
	...TRANSCRIPT_VIEW_MODES,
	LEGACY_TRANSCRIPT_VIEW_MODE,
	LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE
];
/** Default work details for non-Desktop Web clients. */
const DEFAULT_TRANSCRIPT_VIEW_MODE = "detailed";
/** Performance and usage detail levels accepted by user settings. */
const PERFORMANCE_USAGE_MODES = ["compact", "detailed"];
/** Preserve detailed accounting for users without an explicit preference. */
const DEFAULT_PERFORMANCE_USAGE = "detailed";
/** Preserve the built-in browser for users without an explicit preference. */
const DEFAULT_LINK_OPENING = "sidebar";
/** Durable Chat schema; also the wire envelope the browser scope validates against. */
const ChatSettingsFields = {
	[COLLAPSE_TIMING_FIELD]: z.union([...COLLAPSE_TIMINGS]).default(DEFAULT_COLLAPSE_TIMING),
	[FOLDED_REPLIES_FIELD]: z.union([...FOLDED_REPLIES]).default("all"),
	linkOpening: z.union(["sidebar", "new-tab"]).default(DEFAULT_LINK_OPENING),
	performanceUsage: z.union([...PERFORMANCE_USAGE_MODES]).default(DEFAULT_PERFORMANCE_USAGE),
	[TRANSCRIPT_VIEW_FIELD]: z.union([...TRANSCRIPT_VIEW_SETTING_VALUES]).loose()
};
z.object(ChatSettingsFields);
//#endregion
//#region lib/types/index.js
/** Live preferences projected to the browser. */
const Config = z.object({
	[TRANSCRIPT_VIEW_FIELD]: ChatSettingsFields[TRANSCRIPT_VIEW_FIELD].volatile(),
	collapseTiming: ChatSettingsFields.collapseTiming.volatile(),
	foldedReplies: ChatSettingsFields.foldedReplies.volatile(),
	performanceUsage: ChatSettingsFields["performanceUsage"].volatile(),
	linkOpening: ChatSettingsFields.linkOpening.volatile()
});
/** Host preferences are consumed through the configuration form projection.
* @param ctx Plugin context used for optional settings presentation.
*/
function apply(ctx) {
	ctx.inject(["settings"], (child) => {
		child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
	});
}
//#endregion
export { CHAT_SETTINGS_NAMESPACE, Config, DEFAULT_TRANSCRIPT_VIEW_MODE, LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE, LEGACY_TRANSCRIPT_VIEW_MODE, TRANSCRIPT_VIEW_FIELD, TRANSCRIPT_VIEW_MODES, apply };
