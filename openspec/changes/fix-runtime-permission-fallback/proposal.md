## Why

2026-10-29 Mac Desktop 实操验收中，两个 CLI 在「自动审批」档位的降级路径上失败（证据在私有 `.test-data/mac-desktop-20261029/`）：

- **Claude Code**：Worker 首轮报 `Native session identity changed`，续聊报 `No conversation found with session ID: 7b6f9e0f…`。原始记录显示，第一个进程在发送任务前就把会话 ID 报给了 Host（SessionStart 一类钩子消息先带出 `session_id`）。初始化回读未确认 `auto` 后，运行器按设计改用询问模式重启，新进程有新的会话 ID，与已绑定的不一致。Claude 只在收到用户输入后才保存会话，所以续聊恢复的是一个不存在的会话。
- **Antigravity**：Worker 写文件被拒，结果待核实。agy stderr 原文为 `warning: --mode auto is not available for this account; continuing in the default mode.`，随后无头默认模式自动拒绝了 `write_file`。插件只在 `agy --help` 不列出 `auto` 时降级，而 help 始终列出 `auto`：账号层面不可用只能在运行时看到。
- 零模型实证（agy 1.4.x，stdin 0 字节，未发送模型请求）：同参数启动后约 1.2 秒 stderr 即出现该警告，约 8 秒后才输出 `init`，说明可在发送任务前识别。

## What Changes

- Claude：发送任务前观察到的会话 ID 只在本地记录，任务发出后才向 Host 绑定。降级重启时被弃用的进程不再占用这次运行的会话，续聊也只会恢复真正收到任务的会话。
- Antigravity：「自动审批」启动后，在发送任务前短暂观察（最多 5 秒且不超过时限的四分之一，收到 `init` 后再等 50 毫秒让 stderr 排空）。识别到账号不支持 `auto` 时，先确认旧进程退出，再按与 help 缺少 `auto` 相同的降级参数重启，时间线写明实际模式；旧进程的事件与会话一律丢弃。任务发出后才出现警告时立即停止本轮并报错，不重发任务、不自动重试。
- 不保存跨运行的账号能力缓存：每轮都按原生实际反馈判断，账号升级后自然恢复 `auto`。

## Capabilities

### Modified Capabilities

- `worker-permission-levels`：「原生模式不可用时降级」补充运行时才报告不可用的情形、降级重启的会话绑定，以及发送任务后不重试的边界。

## Impact

- Host：`src/host/native-claude.mjs`、`src/host/native-agy.mjs`。
- 测试：`tests/native-primary-runners.test.ts`（Claude 钩子先报会话的降级重启）、`tests/native-agy-account-permissions.test.ts`（新增，模拟 agy 输入前/后警告、取消、只读与规划档）。
- 未决：Antigravity 降级目标沿用现有「仅工作区编辑」（accept-edits + `--dangerously-skip-permissions` + `--sandbox`）。主规格要求按更严一档运行、不得以更宽模式代替，Antigravity 更严一档是「仅规划」；二者不一致，待用户决定（见 tasks.md 3.1）。
