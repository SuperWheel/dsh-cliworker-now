/** Web subagent catalog, navigation, and addressed-session composer owner. */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type SubagentKey } from './locales.ts';
export type * from './slots.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Subagent catalog and read-only composer copy. */
        'subagent': SubagentKey;
    }
}
export type { SubagentCatalogActionProps, SubagentCatalogInjected, SubagentCatalogActionInjected, SubagentHeaderLineageProps, } from './SubagentHeaderLineage.tsx';
export type { SubagentReadOnlyComposerProps, SubagentReadOnlyMatch, } from './SubagentReadOnlyComposer.tsx';
/** Required services for subagent presentation and navigation. */
export declare const inject: string[];
/**
 * Client plugin body: register the subagent catalog and read-only composer seats.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map