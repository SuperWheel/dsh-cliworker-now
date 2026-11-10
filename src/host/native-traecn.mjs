import { runNativeAcp, forkNativeAcp } from './native-acp.mjs'

// 询问档：TRAE 原生只读沙箱 + 按需审批，由用户审批（不交给 auto_review 子代理）。
// TRAE 拒绝同时设置 sandbox_mode 与 permission_mode（0.213.1 实测），所以不带 --permission-mode。
export const TRAECN_ASK_OVERRIDES = Object.freeze(['sandbox_mode="read-only"', 'approval_policy="on-request"', 'approvals_reviewer="user"'])
const asksFirst = (config) => config.access === 'read-only' && config.mode !== 'plan'

export function traecnAcpArgv(config) {
  if (config.preference.effort !== 'default') throw new Error('TRAE CN 不支持强度选择')
  if (asksFirst(config)) return [...config.argv, ...TRAECN_ASK_OVERRIDES.flatMap((pair) => ['-c', pair]), 'acp', 'serve']
  const launchMode = config.mode === 'plan' || config.access !== 'danger-full-access' ? 'default' : 'bypass_permissions'
  return [...config.argv, '--permission-mode', launchMode, 'acp', 'serve']
}

export function traecnPromptUsage(value) {
  if (!value || !['inputTokens', 'outputTokens', 'totalTokens'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0) ||
    value.totalTokens === 0 || value.totalTokens !== value.inputTokens + value.outputTokens) return
  const usage = { inputTokens: value.inputTokens, outputTokens: value.outputTokens, totalTokens: value.totalTokens }
  for (const key of ['thoughtTokens', 'cachedReadTokens', 'cachedWriteTokens'])
    if (value[key] !== undefined) {
      if (!Number.isSafeInteger(value[key]) || value[key] < 0) return
      usage[key] = value[key]
    }
  return usage
}

export const runNativeTraecn = (config, io) => runNativeAcp(config, io, {
  name: 'TRAE CN', agentName: 'traecli-acp', argv: traecnAcpArgv,
  // The ask launch advertises no ACP modes; its protection is the native sandbox, so no mode is set or read back.
  editMode: asksFirst(config) ? undefined : config.access === 'danger-full-access' ? 'bypass_permissions' : 'default',
  fallbackModes: config.access === 'danger-full-access' ? ['default'] : [],
  modeConfigId: 'mode', encode: value => value,
  sessionOption: () => undefined,
  toolName: update => update.title,
  deniedCancelEndsTurn: true,
  modeLabel: candidate => candidate === 'default' ? '仅工作区编辑' : candidate === 'bypass_permissions' ? '完全权限' : candidate,
  onResult: (result, sessionId, nativeIo) => {
    if (result?.stopReason !== 'end_turn') return
    const source = 'traecn.session/prompt', model = config.preference.model
    const usage = traecnPromptUsage(result.usage)
    if (usage) nativeIo.native({ type: 'cliworker.traecn_prompt_usage', source, sessionId, model, usage })
    const context = result._meta?.['_trae/tokenUsage']?.contextWindow
    if (context && Number.isSafeInteger(context.used) && context.used >= 0 && Number.isSafeInteger(context.size) && context.size > 0 && context.used <= context.size)
      nativeIo.native({ type: 'cliworker.traecn_context', source, sessionId, model, used: context.used, size: context.size })
  },
})

export const forkNativeTraecn = (config, io) => forkNativeAcp(config, io, traecnAcpArgv(config))
