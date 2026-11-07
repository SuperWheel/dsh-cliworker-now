import { runNativeAcp } from './native-acp.mjs'

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
export const codebuddyDeniedTurnEnd = (result) => result?.stopReason === 'cancelled' &&
  result?._meta?.['codebuddy.ai/outcome'] === 'PERMISSION_DENIED'
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
  deniedTurnEnd: codebuddyDeniedTurnEnd,
  toolName: codebuddyToolName,
  sessionOption: codebuddySessionOption,
})

export const runNativeCodebuddy = (config, io) => runNativeAcp(
  { ...config, env: { ...config.env, DISABLE_AUTOUPDATER: '1' } }, io, codebuddyRunnerSettings(config),
)
