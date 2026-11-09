import { homedir } from 'node:os'
import { join } from 'node:path'
import { runNativeAcp } from './native-acp.mjs'
import { readCodebuddyDurableUsage } from './codebuddy-durable-usage.mjs'
import { inspectCodebuddyContext } from './codebuddy-context-inspection.mjs'
import { nativeHarnessMcpServers } from './native-harness-injection.mjs'

export const codebuddyAcpArgv = (config) => [...config.argv]
export const codebuddyModeFor = (access) => access === 'read-only' ? 'default'
  : access === 'danger-full-access' ? 'bypassPermissions' : 'auto'
export const codebuddyFallbackModes = (access) => access === 'read-only' ? []
  : access === 'danger-full-access' ? ['auto', 'default'] : ['default']
export function codebuddyVerifyInitialize(init) {
  const ids = Array.isArray(init?.authMethods) ? init.authMethods.map((method) => method?.id) : []
  if (init?.protocolVersion !== 1 || !ids.includes('internal') || !ids.includes('external'))
    return 'CodeBuddy 原生程序身份不匹配，请检查 CLI 路径'
}
export const codebuddyToolName = (update) => update._meta?.['codebuddy.ai/toolName'] ?? update.title
export const codebuddySessionOption = (options) => options.find((option) =>
  option.kind === 'allow_always' && option.optionId === 'allow_always')

/** Kept reusable for CodeBuddy-derived native clients. */
export const codebuddyRunnerSettings = (config) => ({
  name: 'CodeBuddy',
  argv: codebuddyAcpArgv,
  verifyInitialize: codebuddyVerifyInitialize,
  effortId: 'thought_level',
  defaultEffort: 'enabled',
  editMode: codebuddyModeFor(config.access),
  fallbackModes: codebuddyFallbackModes(config.access),
  modeConfigId: 'mode',
  requireModeCatalog: true,
  encode: (value) => value,
  approvalFromToolCall: true,
  deniedCancelEndsTurn: true,
  toolName: codebuddyToolName,
  sessionOption: codebuddySessionOption,
})

/**
 * CodeBuddy-family ACP results carry no token or credit receipt. After a
 * completed turn, read the exact request's records from the native durable
 * transcript (same conversationRequestId / userMessageId as the ACP result).
 * A turn the user ended by denying an approval is read too: its last billed
 * request is the denied tool call, matched by the ACP toolCallId.
 */
export function codebuddyUsageOnResult(config, home, turnStartedAt) {
  return async (result, sessionId, nativeIo, turn = {}) => {
    const deniedCallIds = [...(turn.deniedToolCallIds ?? [])]
    const deniedEnd = result?.stopReason === 'cancelled' && result?._meta?.['codebuddy.ai/outcome'] === 'PERMISSION_DENIED' &&
      deniedCallIds.length > 0 && !nativeIo.signal?.aborted
    if (result?.stopReason !== 'end_turn' && !deniedEnd) return
    const meta = result._meta ?? {}
    const observed = await readCodebuddyDurableUsage({ cli: config.cli, home, project: config.project, sessionId,
      model: config.preference.model, userMessageId: result.userMessageId,
      conversationRequestId: meta['codebuddy.ai/conversationRequestId'], turnStartedAt,
      ...(deniedEnd ? { deniedCallIds } : {}) }, { signal: nativeIo.signal })
    if (observed) nativeIo.native(observed)
  }
}

export const codebuddyHome = (env) => env?.CODEBUDDY_CONFIG_DIR?.trim() || join(homedir(), '.codebuddy')

export function runNativeCodebuddy(config, io) {
  const run = { ...config, env: { ...config.env, DISABLE_AUTOUPDATER: '1' } }
  return runNativeAcp(run, io, {
    ...codebuddyRunnerSettings(config),
    onResult: codebuddyUsageOnResult({ ...config, cli: 'codebuddy' }, codebuddyHome({ ...process.env, ...config.env }), Date.now()),
    // Native `/context` categories, read by a separate non-persistent process after the turn.
    afterClose: (sessionId, nativeIo) => inspectCodebuddyContext({ config: { ...run, cli: 'codebuddy' }, io: nativeIo, sessionId,
      mcpServers: nativeHarnessMcpServers(run),
      open: onMessage => nativeIo.openStdio([...codebuddyAcpArgv(run), '--no-session-persistence'],
        { env: run.env, cwd: run.project, onMessage, auxiliary: true, reportStderr: false }) }),
  })
}
