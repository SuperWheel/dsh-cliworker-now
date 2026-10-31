# Tasks

## 1. Host 清理与恢复

- [x] 1.1 元数据查询与账号状态查询正常读完后先有界等待自然退出，超时才终止；取消与失败路径仍立即终止。
  - `process.ts` 新增 `METADATA_EXIT_GRACE_MS`（3000）；`adapters.ts` 的 `captureCatalogMetadata` 与 `accounts.ts` 的 `readStatus` 记录正常读完后才以 `AbortSignal.timeout` 等待。
- [x] 1.2 清理未确认保留原始原因，暂停说明附脱敏、截断的原因，持久标记不变。
  - `ProcessCleanupUnconfirmedError({ cause })` 与 `cleanupCauseText`；`runtime.blockCatalogOnCleanup` 与账号侧 `cleanupHold` 使用它。
- [x] 1.3 账号窗口确认登录、退出或识别画面时，身份读取的清理未确认登记保护并停止轮询。
  - `readEvidence` 只抛出清理未确认；Antigravity 身份读取在 `evidence()` 登记 `quarantineQuery`；`confirmAccount` 遇到即显示未能确认，`identifyScreen` 不再按猜测输入。
- [x] 1.4 暂停中的账号状态返回结构化 `unavailable` + `cleanupBlocked`，去掉「请重启应用」；新增 Remote `recoverCliCleanup`，账号侧与 Runtime 侧都同意才解除。
  - `index.ts` 的 `cleanupHeldStatus` / `recoverCliCleanup`；`runtime.ts` 的 `assertHostOpen` / `catalogCleanupMessage` / `recoverCatalogCleanup`；`storage.ts` 的 `clearCleanupBlock`（目录拒绝）；`accounts.ts` 的 `assertCleanupRecoverable` / `recoverCleanup`。

## 2. 设置页

- [x] 2.1 `cleanupBlocked` 时账号行显示「解除暂停」与内联确认，成功后刷新账号与模型，拒绝时保留确认区并显示原因；同步 `doc/settings-ui-design.md`。
  - `settings-dialog.tsx`、`styles.ts`（`.cwn-cleanup-release`）、`workers.ts` 可选 API 类型、`i18n-messages.ts` 与 `operation-error.ts` 的中英文词条和 Host 文本模式；账号终端启动错误白名单改为新文案。

## 3. 模拟回归

- [x] 3.1 关联测试、类型检查、OpenSpec 严格校验与 diff 检查。
  - 2026-10-31：关联测试文件（metadata-cleanup、authorized-catalog-windows-agy、accounts、cleanup-persistence、settings-dialog、windows-cli-resolution）全部通过；`pnpm typecheck` 通过；`pnpm spec:check` 严格校验通过；`git diff --check` 无问题。
  - 全量 `pnpm test` 与构建并发时 5401 项通过、10 项失败：9 项为负载下的超时类用例，单独重跑均通过；1 项是 `windows-cli-resolution` 仍断言旧的「必定终止」契约，已按新的有界等待契约改为 2 次 `waitForExit`。修正后未再跑全量。
- [x] 3.2 隔离预览包构建。
  - `pnpm build:preview` 通过，打包为 `preview-20261031-100709.tgz`（本地测试数据目录，不入 Git）。

## 4. 实机验证

- [x] 4.1 Windows：装入新预览包，对 Antigravity 与 Grok 使用「解除暂停」，确认标记删除、状态与模型恢复。
  - 2026-10-31 装入 `preview-20261031-100709`：两者设置页先显示暂停状态与「解除暂停」；确认解除后 `cleanup-blocked-antigravity.json`、`cleanup-blocked-grok.json` 删除，Antigravity 恢复「已登录」并重新读出模型；Grok 恢复后显示其原生续期提示「登录需要续期，请打开 Grok」（与暂停无关）。
- [x] 4.2 Windows：Antigravity 退出与登录（OAuth 由用户在浏览器完成）。
  - 同包：退出显示「已退出 Antigravity」→ 未登录；登录由用户粘贴授权码后显示「已登录 Antigravity」。之后无新的暂停标记，也无残留 agy 进程。截图证据在本地测试数据目录（0600，不入 Git）。
- [x] 4.3 Mac：正式构建更新 Desktop，Antigravity（agy 1.4.12）退出与登录，核对引导画面标记仍匹配。
  - 2026-10-31 首测未通过：正式构建并重启 Desktop 后，设置页显示已登录、无暂停；点「退出登录」后窗口停在「正在启动 Antigravity…」约 12 秒，随后显示「当前未登录 Antigravity，无需退出。」并关闭终端，实际未退出（钥匙串条目仍在）。判定来自画面上的登录菜单，没有核对身份读取；该缺陷在 `guide-agy-account-terminal` D15 修正。
  - 11:03 新构建复测：退出显示「已退出 Antigravity」，钥匙串条目已删除，无暂停标记、无残留；清理暂停相关改动在 Mac 上没有出现回归。用户粘贴授权码后登录成功（钥匙串条目 11:06:58 新建），无残留、无暂停标记。
- [ ] 4.4 两平台桥接复测：续聊（含旧 stream 会话经 ACP 载入）、换号续接、附件；最便宜模型、无害任务、不重试。

## 范围外与遗留

- 宿主 `subprocess-local` 的 Windows runner 诊断通道与 Mac 僵尸识别属上游，不在本变更修改。
- 历史 `catalog/<cli>/query-*` 目录不清理。
- 2026-10-31 Windows 那两次清理未确认的底层原因已无法还原（原因被替换且无宿主日志，157 次模拟复现未复现）；本变更修复可证实的缺口，不声称定位了那一次的原因。
- Mac 只读排查发现一个测试夹具遗留进程（来自 `tests/native-agy-account-permissions.test.ts` 清理缺口），未结束；夹具清理缺口另行处理。
