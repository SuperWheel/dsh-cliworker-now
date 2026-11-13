# Proposal

## Why

v0.8.1 全面审查（4 个 Codex gpt-6.1-sol 只读审查，主会话抽查源码确认）发现 Host 生命周期与持久化有 6 处高危缺陷，均为静态审查结论，尚未实测复现：

1. `src/host/runtime.ts` `stop()` 先调用 `followups.advanceGeneration()`（写盘），之后才中止预约、插队消息与当前运行；写盘抛错会跳过整个停止。`close()` 同步调用 `this.stop()`，任一同步异常会中断卸载，存储锁不释放。
2. `src/host/storage.ts` 回收 `host.lock` 时依次读旧锁、检查 PID、`rmSync`、`wx` 创建，并非原子操作；两个 Host 同时回收同一失效锁时可能都取得存储所有权。
3. `src/host/storage.ts` 事件文件断尾恢复用 `writeFileSync` 整体重写，先截断再写入；写入失败（如磁盘满）会丢失已完整记录的历史。
4. `src/host/native-worker.ts` Windows Codex 分支把 `{ ...process.env, ...launch.env }` 传给 `windowsCodexBackgroundLaunch`，其结果作为子进程环境，绕过宿主对 KEY/TOKEN/SECRET/DSH_* 的父环境过滤。
5. `src/host/index.ts` `createNativeHarnessTools` 成功后，`storage.save` 或 `runtime.changed` 抛错会泄漏工具桥监听服务与子 Agent 展示模式。
6. `src/host/adapters.ts`、`src/host/process.ts` 目录查询以 `String(chunk)` 逐块解码，跨块的多字节 UTF-8 字符被破坏。

## What Changes

- 停止先在内存撤销后续消息资格并启动取消，持久化失败在进程范围退出后作为本次停止的错误报告，不阻止取消与启动资源释放；卸载逐个隔离同步异常。
- `host.lock` 改为“唯一候选锁 + 先声明后扫描”的跨进程独占方案：每个 Host 原子发布自己唯一命名的候选锁，再检查其他存活候选；失效锁只按唯一名删除，不会误删存活 Host 的锁。保留 `host.lock` 兼容旧版本与现有核验脚本。
- 断尾恢复改为 `ftruncate` 到最后一个完整换行，绝不重写完整前缀。
- Windows Codex 后台启动只传 `launch.env`；包管理器检测仍读取宿主已过滤的 `process.env`，但不再把它复制进子进程环境。
- 工具桥 lease 从取得起由异常清理保护：发布失败时关闭 lease 并恢复展示模式，再抛出原错误。
- 目录查询使用 `StringDecoder` 按字节流解码。

## Capabilities

### New Capabilities

- `host-lifecycle-durability`：Host 停止/卸载顺序、存储独占锁、事件日志恢复、子进程环境边界、工具桥 lease 清理与 CLI 输出解码。

### Modified Capabilities

无。

## Impact

仅 Host：`runtime.ts`、`followup-queue.ts`、`storage.ts`、`native-worker.ts`、`native-harness-tools.ts`、`index.ts`、`adapters.ts`、`process.ts` 及对应测试。无协议、Client、安装方式变化；`host.lock` 仍存在，另新增同目录 `host.lock.<uuid>` 候选锁（0600），正常关闭时删除。保持 v0.8.1，不提交、不推送。Windows 实机、真实 CLI 与 Desktop 更新未在本次执行。
