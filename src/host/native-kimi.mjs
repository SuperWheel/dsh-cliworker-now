import { replaceNativeArguments, runNativeAcp } from './native-acp.mjs'
import { KimiDurableUsageObserver } from './kimi-durable-usage.mjs'

export const kimiAcpArgv = (config) =>
  replaceNativeArguments(
    config.argv,
    ['--model', '--output-format', '--session', '-p', '--prompt'],
    ['--print', '--yolo', '-y', '--auto', '--plan'],
    ['acp'],
  )

export const runNativeKimi = (config, io) => {
  const usage = new KimiDurableUsageObserver(config)
  return runNativeAcp(config, io, {
    name: 'Kimi',
    argv: kimiAcpArgv,
    effortId: 'thinking',
    off: 'off',
    // Installed 2.3.3 maps yolo to Ask When Needed and auto to Never Ask.
    editMode: config.access === 'read-only' ? 'default' : config.access === 'danger-full-access' ? 'auto' : 'yolo',
    fallbackModes: config.access === 'read-only' ? [] : config.access === 'danger-full-access' ? ['yolo', 'default'] : ['default'],
    modeConfigId: 'mode',
    requireModeCatalog: true,
    // Kimi maps approve_always to a session-scoped grant.
    sessionOption: (options) => options.find((option) => option.kind === 'allow_always' && option.optionId === 'approve_always'),
    encode: (value) => value,
    awaitPostPromptUsage: true,
    // default auto-approves Git workspace edits; the menu names it 仅工作区编辑.
    onReady: (_state, sessionId, nativeIo) => usage.prepare(sessionId, nativeIo.signal),
    onResult: (result, sessionId, nativeIo) => usage.finish(result, sessionId, nativeIo),
  })
}

export async function forkNativeKimi(config, io) {
  const { forkNativeAcp } = await import('./native-acp.mjs')
  return forkNativeAcp(config, io, kimiAcpArgv(config))
}
