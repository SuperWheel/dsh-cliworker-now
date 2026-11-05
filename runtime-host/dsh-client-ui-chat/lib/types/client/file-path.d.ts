/** Gesture-time path resolution for Chat-owned file references. */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
/**
 * Bind path resolution to the originating Session without capturing its current directory.
 * @param ctx - Chat plugin context.
 * @param sessionId - Original Session identity.
 * @returns Resolver using the live working directory, falling back to the workspace root.
 */
export declare function sessionFilePath(ctx: Context, sessionId: SessionId): (path: string) => string;
//# sourceMappingURL=file-path.d.ts.map