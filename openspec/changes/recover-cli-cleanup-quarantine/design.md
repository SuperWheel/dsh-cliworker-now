# Design

## Context

见 proposal.md。按 CLI 的元数据保护由 `runtime.blockCatalogOnCleanup` 写入 `cleanup-blocked-<cli>.json`，启动时重新载入，原先没有任何清除路径。账号侧另有内存占用：`AccountManager.unsafeQueries`（状态读取未清理）与 `unsafeTerminals`（账号终端未清理），同样只在进程重启后消失，但 Runtime 的持久标记又会让它们在重启后以「元数据清理尚未确认」继续出现。

宿主 `subprocess-local` 的 Windows Job 提供者：`waitForExit()` 无信号时要么 resolve true，要么在 runner 非零退出（如 TerminateJobObject 或 isJobEmpty 报错，127）时抛出；`waitForExit(signal)` 在中止时返回 false。两个查询原先在正常读完后立即 `terminate()`，对一个本会自己清空的 Job 多做了一次终止。

## Goals / Non-Goals

**Goals:** 正常完成的查询不做多余终止；暂停时界面能看到原因；用户在确认没有残留进程后能自行解除单个 CLI 的暂停；账号窗口不再吞掉清理未确认。

**Non-Goals:** 不修改宿主 runner；不自动清除任何保护；不改变全局 `cleanup-blocked.json` 语义、持久标记格式及原生登录/退出命令；不清理历史 `query-*` 目录。

## Decisions

- **先等自然退出。** `captureCatalogMetadata` 与 `readStatus` 记录「已正常读完」；只有此时且未取消，才以 `AbortSignal.timeout(METADATA_EXIT_GRACE_MS)` 等待一次，返回 false 再 `terminate()` + 无界等待。读完前失败或取消仍直接终止。宽限 3 秒：足够 runner 发现 Job 已空，又不明显拖慢设置页。
- **保留原因，只在显示时脱敏。** 异常构造时传 `{ cause }`；`cleanupCauseText` 只取 message（AggregateError 逐条拼接），替换 Windows 盘符路径、UNC、多级 POSIX 路径为 `<path>`，去控制字符，截 160 字符。持久标记不写原因，重启后的说明只剩固定文案。
- **账号确认阶段。** `readEvidence` 只把 `ProcessCleanupUnconfirmedError` 往外抛，其余仍视为「这次没读到」。Antigravity 身份读取在 `evidence()` 中登记 `quarantineQuery`（写 `unsafeQueries` 并通知 Runtime 写持久标记）。`confirmAccount` 遇到它即停止轮询、显示未能确认；`identifyScreen` 遇到它不再按猜测输入命令。
- **结构化暂停状态。** `AccountStatus.cleanupBlocked?: boolean`（旧 Host 无此字段）。`accountStatus` 在读取前后都先看 Runtime 的按 CLI 保护，有则直接返回 `unavailable` + 原因 + `cleanupBlocked`，不启动读取；关闭中和全局保护仍抛错。账号侧 `cleanupHold` 用同样形态覆盖 `unsafeQueries`/`unsafeTerminals`，去掉「请重启应用」。
- **两侧都同意才解除。** `recoverCliCleanup` 先 `accounts.assertCleanupRecoverable`（未关闭、无该 CLI 的账号终端预留、无在途状态读取），再 `runtime.recoverCatalogCleanup`（`assertHostOpen` 拒绝全局保护；有该 CLI 的运行/排队/准备/停止中 Worker 则拒绝），最后 `accounts.recoverCleanup`。三步同步执行，任一拒绝时之前没有释放任何东西。`clearCleanupBlock` 用 `lstat`：不存在视为已解除；损坏记录同样删除；是目录则拒绝，不跟随、不递归删除。
- **界面。** 只有 `cleanupBlocked` 时出现「解除暂停」；内联确认说明去任务管理器或活动监视器核对残留进程，不读取或结束任何进程。成功后刷新账号（随后按现有逻辑重新读取模型）。按 `doc/settings-ui-design.md` 复用 `.cwn-accounts-confirm` 与现有间距。

## Risks / Trade-offs

- [用户未核对就解除] → 说明写明先核对；解除只恢复准入，残留进程若仍持有账号缓存，后续查询可能再次失败并重新暂停，不会扩大到其他 CLI。
- [宽限期内 runner 自身报错] → 等待抛出仍按清理未确认处理，并保留原因；不以吞掉异常换取通过。
- [本次 Windows 原始原因无法还原] → 修复针对可证实的缺口（无恢复路径、原因丢失、多余终止、账号确认吞错），不声称已定位那一次的底层原因。

## Migration Plan

已有的按 CLI 标记格式不变，升级后照常载入并显示固定说明与「解除暂停」。全局标记不受影响。回滚到旧版本时，已解除的 CLI 不会被重新暂停；未解除的仍按旧逻辑永久暂停。
