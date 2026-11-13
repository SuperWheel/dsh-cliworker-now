## Context

宿主终端句柄 `terminate()` 在 macOS 回退实现中的顺序是：清理后代 → 有幸存者即失败 → 结束顶层 shell/CLI → 再清理后代。僵尸后代在父进程存活期间始终是“幸存者”。

## Decisions

### D1 在插件侧先结束 CLI，不修改宿主

`finish()` 在 `terminate()` 之前调用 `endForeground()`：非 Windows 且终端未退出时 `signalForeground('SIGTERM')`，与 `terminal.done` 竞速最多 `graceMs`，计时器在结束后清除。账号终端只运行用户打开的那个 CLI，前台进程组即该 CLI；登录类 CLI 收到 SIGTERM 会正常退出（真实 agy 主界面实测 928 ms 完成清理）。之后 `terminate()` 仍负责确认整个范围退出，失败语义与重试路径不变。

### D2 退出状态以 `terminal.done` 为准

会话新增 `exited`，由 `terminal.done` 的兑现或拒绝置位；已退出时不发送信号。`signalForeground` 失败（无法解析前台进程组等）时直接交给 `terminate()`。

## Risks

- 某 CLI 若忽略 SIGTERM 且保留僵尸后代，仍会清理失败（与修复前相同），用户可重试关闭或重启 DSH。
