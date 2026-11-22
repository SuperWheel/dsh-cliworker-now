# 停止以进程范围清理完成为准

结论：发出取消信号不是停止成功；Host 必须等受管理进程与工具清理完成，才结算该轮并释放互斥。

## 机制

`stopCurrent` 同时取消准备阶段、调度与当前任务，并等待精确 `task.done` 屏障。协议支持时先请求原生停止；随后仍执行 `terminate`、`waitForExit`，收拢输出读取与工具租约。清理无法确认会标记阻塞，拒绝后续派遣，避免旧写进程与新任务重叠。

正常用户停止映射到 `interrupted/user` 并保留已公开内容；真实失败、超时和结果冲突有独立状态。Host 冷启动将遗留活动任务记为中断，不自动重放。正常续聊使用已保存的 CLI 原生会话身份。

## 易错边界

关闭侧栏只释放显示引用。显示历史损坏的“修复显示会话”需要官方明确损坏回执、精确绑定和空闲保护，不能凭一般网络错误重建，更不能重跑原任务。工具结果未知时保留未知，禁止自动重试。跨平台进程范围实现与实际清理证据需要分别验收。

## 源码与验证入口

- [调度停止](../../../src/host/runtime.ts)：`stopCurrent`、`run`、`markCleanupBlocked`；[进程合同](../../../src/host/process.ts)：`ProcessCleanupUnconfirmedError`；[冷恢复](../../../src/host/storage.ts)：`WorkerStorage` 构造器。
- [进程回归](../../../tests/native-process.test.ts) · [清理回归](../../../tests/runtime-metadata-cleanup.test.ts) · [Windows 进程回归](../../../tests/windows-process.test.ts)。
- [显示恢复条件](../../protocols/native-conversation-ui.md)。

关联：[调度锁](scheduling-locks.md) · [三类身份](session-identities.md) · [返回分类索引](README.md)
