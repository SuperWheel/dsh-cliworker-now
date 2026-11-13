## Why

GitHub issue SuperWheel/dsh-cliworker-now#8（2026-11-01，Windows 11、0.8.3 与 0.8.5 均复现）：CLI Worker 执行一次超过 32768 字符的命令（如很长的内联 PowerShell 脚本）后，下次启动 DSH 时整个 Harness 无法启动。`WorkerStorage.append` 不限制 `toolCall.command` 长度，而 `WorkerStorage.history` 读取事件日志时按 `z.string().max(32768)` 严格校验；超限记录让 `history()` 抛出 `ZodError`，`new WorkerRuntime` 失败，required 插件 `cliworker-now` 无法激活。升级插件也不会修复已写入的数据，用户只能进安全模式手工改几百 MB 的 JSONL。

## What Changes

- `toolCall.command` 是展示文本：写入事件日志前截到 32768 个 UTF-16 码元以内（不拆开代理对），读取时对已有的超长记录同样截断而不报错。
- 其他校验不变：除最后一条被截断的半行外，事件日志中其余损坏仍按原样报错，不静默跳过。

## Capabilities

### Modified Capabilities

- `worker-management`：新增“超长工具命令不阻止加载历史”。

## Impact

- Host：`src/host/storage.ts`。
- 测试：`tests/storage.test.ts`。
- 已受影响的用户升级后无需手工修改 JSONL；超长命令在界面中只显示前 32768 个字符。
- 未处理：issue 提到的几百 MB 事件日志体积问题不在本变更范围。
