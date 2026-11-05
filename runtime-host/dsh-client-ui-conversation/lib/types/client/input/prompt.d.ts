import type { DraftSnapshot } from '../contract/draft-editor.ts';
/**
 * Serialize the captured draft through reference codecs, formatting quotes as Markdown.
 * @param draft - one semantic draft revision.
 * @param serializeReference - owner-routed reference serializer.
 * @returns synchronous content without references, otherwise the resolving promise.
 */
export declare function serializeDraftPrompt(draft: DraftSnapshot, serializeReference: (source: string, ref: string) => Promise<string>): string | Promise<string>;
//# sourceMappingURL=prompt.d.ts.map