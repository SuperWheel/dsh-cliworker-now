import type { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Real registry and native executor from the installed host; no model or CLI. */
export async function mountNativeTools(ctx: Context) {
  await ctx.plugin(ToolRuntime)
  // Older fixtures use the registry's native default and have no executor plugin.
  if ('presentAs' in ctx.tools) return
  const runtimeRequire = createRequire(process.env.CWN_TEST_HARNESS_PACKAGE
    ?? realpathSync(new URL('../../node_modules/@deepseek-ai/dsh/package.json', import.meta.url)))
  const native = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-tool-executor-native')).href)
  await ctx.plugin(native)
}
