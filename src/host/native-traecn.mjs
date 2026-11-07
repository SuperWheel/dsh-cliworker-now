import { runNativeAcp, forkNativeAcp } from './native-acp.mjs'

export function traecnAcpArgv(config) {
  if (config.preference.effort !== 'default') throw new Error('TRAE CLI CN 不支持强度选择')
  if (config.access === 'read-only' && config.mode !== 'plan')
    throw new Error('TRAE CLI CN 不支持询问档，请在 Worker 菜单选择仅工作区编辑或完全权限')
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
  name: 'TRAE CLI CN', agentName: 'traecli-acp', argv: traecnAcpArgv,
  editMode: config.access === 'danger-full-access' ? 'bypass_permissions' : 'default',
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
