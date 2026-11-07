export const CODEBUDDY_PERMISSION_DENIED = '因拒绝审批而结束'
export function codebuddyPermissionDenied(result) {
  return result?.stopReason === 'cancelled' && result?._meta?.['codebuddy.ai/outcome'] === 'PERMISSION_DENIED'
}

/** Per-run, session-scoped cache. Never merge input/output or another session. */
export function createCodeBuddyAcpOutcome() {
  const calls = new Map()
  const key = (session, id) => JSON.stringify([session, id])
  return {
    receive(message) {
      const params = message?.params, update = params?.update
      if (message?.method === 'session/update' && typeof params?.sessionId === 'string' &&
          ['tool_call', 'tool_call_update'].includes(update?.sessionUpdate) && typeof update.toolCallId === 'string') {
        const id = key(params.sessionId, update.toolCallId), previous = calls.get(id) ?? {}
        for (const field of ['title', 'kind', 'locations'])
          if (update[field] !== undefined) previous[field] = update[field]
        calls.set(id, previous)
        if (calls.size > 1024) calls.delete(calls.keys().next().value)
      }
      if (message?.method !== 'session/request_permission' || typeof params?.sessionId !== 'string' ||
          typeof params.toolCall?.toolCallId !== 'string') return message
      const previous = calls.get(key(params.sessionId, params.toolCall.toolCallId))
      if (!previous) return message
      const toolCall = { ...params.toolCall }
      for (const field of ['title', 'kind', 'locations'])
        if (toolCall[field] === undefined || toolCall[field] === '') toolCall[field] = previous[field]
      return { ...message, params: { ...params, toolCall } }
    },
    clear() { calls.clear() },
    permissionDenied: codebuddyPermissionDenied,
  }
}
