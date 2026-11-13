# Proposal

## Why

2026-10-31 Windows 实机：打开设置刷新状态时，Antigravity 与 Grok 的元数据查询各有一次进程清理未确认，插件写下 `cleanup-blocked-antigravity.json`（09:08:17）和 `cleanup-blocked-grok.json`（09:08:25）。此后这两个 CLI 的登录、退出、模型目录与任务准入全部被拒绝，界面显示「元数据进程清理尚未确认，已暂停此 CLI」。核查时两者都已没有残留进程，但：

- `storage.ts` 的按 CLI 保护「No automatic clearing」，代码里也没有任何清除路径；重启照样封锁，提示里的「请重启应用」不能解决问题。用户只能手工删除私有文件。
- `adapters.ts` 的 `captureCatalogMetadata` 与 `accounts.ts` 的 `readStatus` 在 finally 中 `terminate()` 后 `waitForExit()`，任何异常都被替换为固定的 `ProcessCleanupUnconfirmedError`，原始原因丢失。Windows 上也没有宿主运行日志，所以这次的底层原因无法还原。另一会话在 Windows 用 DSH 自带 Job 提供者做了 157 次模拟复现，没有复现出来。
- 两个查询都是正常结束后仍立即 `terminate()`，宿主 Windows runner 因此会对一个即将清空的 Job 执行 `TerminateJobObject`。这一步失败就会以 127 退出，进而被判为清理未确认。这条时序没有被证实就是本次原因，但属于不必要的额外操作。
- Mac 只读排查发现：账号窗口确认登录或退出时，Antigravity 的身份读取异常被 `.catch(() => undefined)` 吞掉，包括清理未确认。插件不登记保护，继续轮询并启动新查询，最后只显示「未能确认」。

## What Changes

- 元数据查询正常完成后，先在短宽限内等待进程范围自然退出，仍未退出才 `terminate()` 并等待确认。取消、超限、读取失败等异常路径照旧立即终止。
- 清理未确认的错误保留原始原因（`cause`）；按 CLI 暂停时，界面说明附上经路径脱敏、截断的原因。持久保护记录格式不变，不写入原因、路径或输出。
- 新增用户确认的「解除暂停」：仅针对按 CLI 的元数据保护和账号查询/终端的内存占用，需该 CLI 没有运行或排队任务、没有打开的账号终端或在途查询。设置页在暂停提示旁提供按钮和确认说明，确认后清除该 CLI 的保护，并重新读取账号和模型。全局任务清理保护不提供此入口。
- 暂停中的账号状态改为返回结构化的 unavailable 状态（`cleanupBlocked`），不再以异常形式出现。账号提示不再写「请重启应用」。
- 账号窗口确认登录、退出或识别画面时，身份读取的清理未确认改为登记按 CLI 保护并停止轮询，显示未能确认，不再静默继续启动查询。

## 范围外

- 不修改宿主 `subprocess-local`（Windows runner 结果发出后的诊断通道、Mac 僵尸识别属上游问题，另行记录）。
- 不在没有用户确认时自动清除任何保护；不清理历史 `catalog/<cli>/query-*` 目录（资源回收另行处理）。
- 不改变原生登录/退出命令或账号判定；不改全局 `cleanup-blocked.json` 语义。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cli-model-discovery`: 元数据清理保护保留原因、正常完成先等自然退出，并提供用户确认的按 CLI 恢复。
- `cli-connection-health`: 账号窗口确认阶段的清理未确认必须登记保护并停止轮询；暂停状态以结构化账号状态呈现。

## Impact

- Host：`process.ts`、`adapters.ts`、`accounts.ts`、`runtime.ts`、`storage.ts`、`index.ts`（新增 Remote `recoverCliCleanup`）。
- Client：`settings-dialog.tsx` 账号区新增解除暂停按钮与确认；共享类型 `AccountStatus.cleanupBlocked`。
- 存储：只新增按 CLI 保护文件的删除，格式不变。版本保持 0.8.4。
- 文档：README、`doc/design.md`、`doc/settings-ui-design.md`。
