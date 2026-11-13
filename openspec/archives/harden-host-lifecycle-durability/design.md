# Design

## Context

见 proposal。六项缺陷均在 Host 内，彼此独立；均保持现有协议和数据格式。

## Goals / Non-Goals

Goals：停止与卸载在写盘失败或同步异常下仍完成进程清理；存储锁跨进程独占；断尾恢复不丢完整前缀；Windows Codex 不扩大子进程环境；工具桥不泄漏；目录输出正确解码。
Non-Goals：不改变后续消息队列格式；不引入原生依赖（如 flock）；不修复其他模块中同类 `String(chunk)`（列为后续）；不做 Windows 实机或真实 CLI 验收。

## Decisions

- **停止顺序**：新增 `FollowupQueue.revokeGeneration`：先更新内存中的代际，再尝试写盘，返回 `{ previous, persistenceError }`；`advanceGeneration` 保持原有抛错语义。内存代际已推进，旧代际的 claim/dispatch 判定立即失效，所以写盘失败不会让旧消息被发送。`stop()` 先完成预约/插队/当前运行的中止，在 `stopCurrent` 完成后以该错误拒绝本次停止；不设置 `blocked`，因为 `blocked` 会让运行收尾跳过启动资源释放（Codex gpt-6.1-sol 复核指出，已加回归）。重启后队列项本来就统一置为 paused，内存与磁盘代际不一致不会恢复执行权。`close()` 用 `Promise.resolve().then(() => this.stop(...))` 包裹，同步异常转成被 `allSettled` 吸收的拒绝。
- **存储锁**：Node 无跨平台 flock。采用 Lamport/Dekker 式“先声明后检查”：
  1. 写临时文件后 `rename` 原子发布 `host.lock.<token>`（内容含 pid/token）。
  2. 扫描目录内 `host.lock` 与全部 `host.lock.<uuid>`：任一他人锁的 pid 存活（含 EPERM）则撤回自身候选并失败；无法解析则撤回并提示人工检查；已退出的记入失效列表。
  3. 两个并发 Host 均为“先写后读”，至少一方能看到另一方的候选，因此不会同时成功；最坏情况两者都失败（短随机退避后最多重试 3 次）。
  4. 获胜后删除失效的唯一名候选（唯一名保证不会删除存活 Host 的锁），再以 `wx` 写入兼容的 `host.lock`；若其属于已退出的旧版本则删除后重建（仅与不认识新协议的旧版本存在残余竞态，记录为兼容限制）。
  5. `close()` 只删除 token 匹配的候选与 `host.lock`。
  6. 进程号复用（2026-10-30 Windows 实机暴露）：只看 PID 存活会把已退出 Host 留下的锁误判为占用。Windows 上一个 Host 未释放锁就退出，其 PID 被后启动的 GameInputSvc 复用，之后每次启动都报「already owned」，cliworker 服务不注册。现在 PID 存活时再查该进程启动时间（Windows 用 CIM `Win32_Process.CreationDate`，经 PowerShell 以环境变量传 PID；macOS/Linux 用 `ps -o lstart=`）。Host 必然先启动再写锁，所以启动时间晚于锁文件 mtime（留 2 秒精度余量）即判定为复用、按失效处理。查询失败或超时仍按存活处理（保持偏安全）。只在遇到存活 PID 时查询，每个 PID 只查一次，不影响正常启动路径；对旧版本留下的锁同样生效，无需迁移。
- **断尾恢复**：按字节读取，定位最后一个 `\n`，仅解析完整前缀；若有残缺尾部，用 `r+` 打开并 `ftruncateSync` + `fsyncSync`。截断只缩短，不经过“清空再写”。
- **Windows Codex 环境**：传 `launch.env`。`windowsCodexBackgroundLaunch` 内部 `environmentValue` 已同时读取 `process.env` 判断包管理器，无需复制父环境；`native-process.ts` 路径本就只传 `spec.env`，两处保持一致。
- **lease 清理**：在 `native-harness-tools.ts` 新增 `adoptNativeHarnessLease(lease, resetPresentation, publish)`，发布失败时 `await lease.close()`、`resetPresentation()`；close 也失败时以 `AggregateError` 同时保留两个错误。`index.ts` 调用该函数。
- **解码**：`StringDecoder('utf8')`，字符串块原样追加，循环后 `decoder.end()`。字节上限仍按原字节计。

## Risks / Rollback

- 新锁文件名可能被外部核验脚本忽略；`host.lock` 仍保留，脚本行为不变。
- 并发启动可能两者都失败：仅影响同时启动的异常场景，重试后可恢复。
- 回退：各项独立，可逐文件还原。
