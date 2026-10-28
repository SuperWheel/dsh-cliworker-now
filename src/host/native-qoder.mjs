import { runNativeAcp } from './native-acp.mjs'
import { readQoderDurableContextAsync } from './qoder-durable-context.mjs'

/** Qoder's ACP uses acceptEdits / yolo; its CLI flags are accept_edits / bypass_permissions. */
export const qoderAcpArgv = (config) => {
  if (config.mode !== 'accept-edits')
    throw new Error('Qoder 当前 ACP 未公开只读规划模式，无法安全执行规划任务')
  // Model is selected and confirmed again through ACP before prompt admission.
  return [...config.argv]
}

export const runNativeQoder = (config, io) =>
  runNativeAcp(config, io, {
    name: config.cli === 'qodercn' ? 'Qoder CN' : 'Qoder',
    agentName: config.cli === 'qodercn' ? 'qoder-cli-cn' : 'qoder-cli',
    argv: qoderAcpArgv,
    effortId: 'reasoning_effort',
    off: 'none',
    editMode: config.access === 'danger-full-access' ? 'yolo' : 'acceptEdits',
    modeConfigId: 'mode',
    // proceed_always is session-scoped; proceed_always_and_save persists and is never chosen.
    sessionOption: (options) => options.find((option) => option.kind === 'allow_always' && option.optionId === 'proceed_always'),
    encode: (value) => value,
    toolName: (update) => update._meta?.qoder?.toolName ?? update.title,
    onResult: async (result, sessionId, nativeIo) => {
      const usage = qoderPromptUsage(result?.usage) ?? qoderPromptUsage(result?._meta?.quota?.token_count)
      if (result?.stopReason === 'end_turn' && usage)
        nativeIo.native({
          type: `cliworker.${config.cli === 'qodercn' ? 'qodercn' : 'qoder'}_prompt_usage`,
          sessionId,
          model: config.preference.model,
          usage,
        })
      if (result?.stopReason === 'end_turn') {
        const context = await readQoderDurableContextAsync({ cli: config.cli === 'qodercn' ? 'qodercn' : 'qoder', home: config.cli === 'qodercn' ? (config.env ?? process.env).QODERCN_CONFIG_DIR : (config.env ?? process.env).QODER_CONFIG_DIR, project: config.project,
          sessionId, model: config.preference.model, userMessageId: result.userMessageId }, { signal: nativeIo.signal })
        if (context) nativeIo.native(context)
      }
    },
  })

/** Aggregate prompt accounting only; Qoder supplies no response/cache/context breakdown here. */
export function qoderPromptUsage(value) {
  if (value && !Object.hasOwn(value, 'inputTokens') && !Object.hasOwn(value, 'outputTokens')) {
    const input = value.input_tokens, output = value.output_tokens
    value = { inputTokens: input, outputTokens: output,
      totalTokens: value.total_tokens ?? (Number.isSafeInteger(input) && Number.isSafeInteger(output) ? input + output : undefined) }
  }
  if (
    !value ||
    !['inputTokens', 'outputTokens', 'totalTokens'].every(
      (key) => Number.isSafeInteger(value[key]) && value[key] >= 0,
    ) ||
    value.totalTokens !== value.inputTokens + value.outputTokens ||
    // Official Qoder routes mask all token counts as zero. ACP supplies no
    // disclosure flag, so a zero triple cannot establish a real zero bill.
    value.totalTokens === 0
  )
    return
  return { inputTokens: value.inputTokens, outputTokens: value.outputTokens, totalTokens: value.totalTokens }
}

export async function forkNativeQoder(config, io) {
  const { forkNativeAcp } = await import('./native-acp.mjs')
  return forkNativeAcp(config, io, qoderAcpArgv(config))
}
