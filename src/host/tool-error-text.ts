/** CLI error payloads are untrusted text, never HTML or executable objects. */
const limit = 4096
const clip = (text: string) => text.length > limit ? `${text.slice(0, limit - 1)}…` : text

export function toolErrorText(value: unknown): string {
  const seen = new Set<object>()
  let remaining = 128
  const extract = (item: unknown, depth: number): string | undefined => {
    if (--remaining < 0 || depth > 6) return
    if (typeof item === 'string') return item.trim() ? clip(item) : undefined
    if (!item || typeof item !== 'object' || seen.has(item)) return
    seen.add(item)
    if (Array.isArray(item)) {
      const text = item.slice(0, 32).map(entry => extract(entry, depth + 1)).filter(Boolean).join('\n')
      return text ? clip(text) : undefined
    }
    const object = item as Record<string, unknown>
    for (const key of ['message', 'text', 'content', 'error']) {
      const text = extract(object[key], depth + 1)
      if (text) return text
    }
  }
  try {
    const text = extract(value, 0)
    if (text) return text
    // Bound traversal and output, including cycles and unusually wide payloads.
    const visited = new Set<object>()
    let nodes = 0
    const snapshot = (item: unknown, depth: number): unknown => {
      if (++nodes > 128 || depth > 6) return '[truncated]'
      if (typeof item === 'string') return clip(item)
      if (typeof item === 'bigint') return item.toString()
      if (!item || typeof item !== 'object') return item
      if (visited.has(item)) return '[circular]'
      visited.add(item)
      if (Array.isArray(item)) return item.slice(0, 32).map(entry => snapshot(entry, depth + 1))
      return Object.fromEntries(Object.keys(item).slice(0, 32)
        .map(key => [clip(key), snapshot((item as Record<string, unknown>)[key], depth + 1)]))
    }
    return clip(JSON.stringify(snapshot(value, 0)) ?? 'CLI 工具失败（未提供错误详情）')
  } catch {
    return 'CLI 工具失败（错误详情无法读取）'
  }
}

/** Preserve Harness's cancellation classification while making its object reason printable. */
export function toolReceiptError(error: unknown, signal: AbortSignal): Error {
  if (error instanceof Error) return error
  const cancelled = signal.aborted && error === signal.reason
  const reason = error && typeof error === 'object' ? error as Record<string, unknown> : undefined
  const normalized = new Error(cancelled && reason?.kind === 'user' ? '用户已停止任务' : toolErrorText(error))
  if (cancelled) normalized.name = 'AbortError'
  return normalized
}
