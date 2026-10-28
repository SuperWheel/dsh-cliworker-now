// A failed tool step stays a fact of that step; the native turn terminal decides the run.
export const LAST_TOOL_FAILED =
  '本轮最后的工具步骤失败后 CLI 直接结束；结果待核实，请先核查实际产物，不要自动重试'

export const recoveredNotice = (count) => `本轮有 ${count} 个工具步骤失败，CLI 已自行处理`

/**
 * Counts failed tool steps once per native identity and remembers whether the
 * latest evidence was a failure. Successful tools and non-empty replies after a
 * failure count as the CLI carrying on.
 */
export function createToolOutcomes() {
  const failed = new Set()
  let count = 0, lastFailed = false
  return {
    failed(id) {
      // A replayed report of the same step is not new evidence.
      if (id !== undefined && id !== null) {
        if (failed.has(id)) return
        failed.add(id)
      }
      count++
      lastFailed = true
    },
    succeeded() {
      lastFailed = false
    },
    get count() {
      return count
    },
    get lastFailed() {
      return lastFailed
    },
    /**
     * Terminal for a turn with no turn-level failure. A denied authorization is
     * the user's decision, not a failure: that turn completes without a notice.
     */
    settle(io, response, resultScope, denied = false) {
      if (denied) io.result('SUCCESS', response, undefined, resultScope)
      else if (lastFailed) io.result('UNCERTAIN', response, LAST_TOOL_FAILED, resultScope)
      else if (count) io.result('SUCCESS', response, undefined, resultScope, recoveredNotice(count))
      else io.result('SUCCESS', response, undefined, resultScope)
    },
  }
}
