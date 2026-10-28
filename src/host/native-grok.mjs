import { replaceNativeArguments, runNativeAcp } from './native-acp.mjs'
import { GrokResponseTracker, grokResponseUsage, grokPromptUsage, grokModelContext, grokContextStatus } from './grok-response.mjs'
import { GrokDurableContextObserver } from './grok-durable-context.mjs'

// `grok agent stdio` ignores the global permission flags before `agent`; the
// permission rules live in the run's private config (prepareGrok). Installed
// 1.0.62's ACP lists no modes. Full access uses the subcommand's --always-approve.
export const grokAcpArgv = (config) =>
  replaceNativeArguments(
    config.argv,
    ['--output-format', '--resume', '--single', '--tools', '--permission-mode'],
    ['--always-approve', '--yolo'],
    ['agent',
      ...(config.mode !== 'plan' && config.access === 'danger-full-access' ? ['--always-approve'] : []), '--no-leader', 'stdio'],
  )

export const runNativeGrok = (config, io) => {
  const seen = new Set()
  const durable = new GrokDurableContextObserver(config)
  let contextSeen = false
  return runNativeAcp(config, io, {
    name: 'Grok',
    argv: grokAcpArgv,
    effortId: 'reasoning_effort',
    off: 'none',
    // Ask and auto-review are set by the private config (prepareGrok); never invent an ACP mode id.
    editMode: undefined,
    // Read-only is set by the private config; an ACP that lists modes must still confirm plan.
    launchModes: ['plan'],
    // Installed 1.0.50 accepts the ACP scalar string. Its bundled guide still
    // shows { value }, which the live SessionConfigOptionValue decoder rejects.
    encode: (value) => value,
    clientCapabilities: { _meta: { 'x.ai/statusLine': true } },
    responseTracker: (io) => new GrokResponseTracker((event) => io.event(event), { requireStart: true }),
    onReady: async (state, sessionId, io) => {
      await durable.prepare(sessionId, io.signal)
      const contextCapacity = grokModelContext(state, config.preference.model)
      if (contextCapacity !== undefined) io.native({ type: 'cliworker.grok_model_context',
        sessionId, modelId: config.preference.model, contextCapacity })
    },
    onResult: async (result, sessionId, io) => {
      const receipt = grokPromptUsage(result?._meta?.usage)
      if (receipt) io.native({ type: 'cliworker.grok_prompt_usage', sessionId, ...receipt })
      if (!contextSeen) await durable.finish(result, sessionId, io)
    },
    receive: (message, sessionId, responses, finishThought) => {
      if (message.method === '_x.ai/models/update') {
        // This owned --no-leader process hosts exactly this confirmed session.
        // Do not overwrite a live sampling configuration with catalog defaults.
        const capacity = !contextSeen && grokModelContext({ models: message.params }, config.preference.model)
        if (capacity) io.native({ type: 'cliworker.grok_model_context', sessionId,
          modelId: config.preference.model, contextCapacity: capacity })
        return true
      }
      const context = grokContextStatus(message, { sessionId, modelId: config.preference.model, project: config.project })
      if (context) { contextSeen = true; io.native(context); return true }
      // Only the live extension rail. session/load replay is a different method.
      if (message.method !== '_x.ai/session_notification' || message.params?.sessionId !== sessionId)
        return false
      if (message.params._meta?.isReplay === true) return true
      const eventId = message.params._meta?.eventId
      if (typeof eventId === 'string' && eventId) {
        if (seen.has(eventId)) return true
        seen.add(eventId)
      }
      const update = message.params?.update
      if (update?.sessionUpdate === 'response_started') {
        finishThought()
        responses.start(update.message_id)
      } else if (update?.sessionUpdate === 'reasoning_completed') {
        // Encrypted signatures are neither public thought text nor response usage.
        finishThought()
      } else if (update?.sessionUpdate === 'response_completed') {
        if (responses.enabled && typeof update.message_id === 'string' && update.message_id &&
          responses.id !== `grok:${update.message_id}`)
          throw new Error('Grok response identity changed')
        finishThought()
        responses.finish(grokResponseUsage(update.usage))
      }
      return true
    },
  })
}
