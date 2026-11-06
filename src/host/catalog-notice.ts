// Account-scope explanations that travel with a discovered model list.
// Only counts and CLI labels: never credential IDs, accounts or secrets.

const notices = new WeakMap<object, string>()

/** Attach a settings notice to a discovered model list. */
export function withCatalogNotice<T extends object>(models: T, notice: string): T {
  notices.set(models, notice)
  return models
}

export function catalogNoticeOf(models: object): string | undefined {
  return notices.get(models)
}

/** The provider rejected every credential that could serve this CLI. */
export const catalogAuthenticationFailed = (label: string) =>
  `${label} 账号认证失败，请在账号窗口重新登录或退出失效凭据后刷新`

/** Models remain from other credentials; some were rejected by the provider. */
export const catalogSkippedCredentials = (count: number) =>
  `当前账号可用模型；已跳过 ${count} 条认证失败的凭据，可在账号窗口退出`

/**
 * Apply the shared rule to a list built while `rejected` credentials were skipped.
 * An empty list keeps the reason as its notice; the caller reports it after its
 * own cleanup instead of the generic empty-catalog message.
 */
export function explainAuthenticationScope<T extends object[]>(models: T, rejected: number, label: string): T {
  if (rejected <= 0) return models
  return withCatalogNotice(
    models,
    models.length ? catalogSkippedCredentials(rejected) : catalogAuthenticationFailed(label),
  )
}
